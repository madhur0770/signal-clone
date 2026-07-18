import json
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlmodel import Session, select

from app.auth import get_current_user_from_token
from app.database import get_session, engine
from app.models import ConversationMember, Message, MessageStatus, User
from app.models import DeliveryStatus

router = APIRouter(tags=["websocket"])


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: dict[int, list[WebSocket]] = {}

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.setdefault(user_id, []).append(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        connections = self.active_connections.get(user_id, [])
        if websocket in connections:
            connections.remove(websocket)
        if not connections:
            self.active_connections.pop(user_id, None)

    async def send_personal(self, user_id: int, message: dict) -> None:
        for connection in self.active_connections.get(user_id, []):
            await connection.send_json(message)

    async def broadcast_to_conversation(
        self, conversation_id: int, message: dict, db: Session
    ) -> None:
        members = db.exec(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id
            )
        ).all()
        for member in members:
            await self.send_personal(member.user_id, message)


manager = ConnectionManager()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str) -> None:
    with Session(engine) as db:
        try:
            user = get_current_user_from_token(token, db)
        except Exception:
            await websocket.close(code=1008)
            return

        user.is_online = True
        db.add(user)
        db.commit()

        await manager.connect(user.id, websocket)
        await manager.send_personal(
            user.id,
            {"type": "connected", "user_id": user.id, "message": "WebSocket connected"},
        )

        try:
            while True:
                data = await websocket.receive_text()
                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                    continue

                event_type = payload.get("type")

                if event_type == "ping":
                    await websocket.send_json({"type": "pong"})
                    continue

                if event_type == "typing":
                    conversation_id = payload.get("conversation_id")
                    if conversation_id:
                        await manager.broadcast_to_conversation(
                            conversation_id,
                            {
                                "type": "typing",
                                "conversation_id": conversation_id,
                                "user_id": user.id,
                            },
                            db,
                        )
                    continue

                if event_type == "message":
                    conversation_id = payload.get("conversation_id")
                    content = payload.get("content")
                    if not conversation_id or not content:
                        await websocket.send_json(
                            {"type": "error", "message": "conversation_id and content required"}
                        )
                        continue

                    member = db.exec(
                        select(ConversationMember).where(
                            ConversationMember.conversation_id == conversation_id,
                            ConversationMember.user_id == user.id,
                        )
                    ).first()
                    if not member:
                        await websocket.send_json(
                            {"type": "error", "message": "Not a conversation member"}
                        )
                        continue

                    # Simulated encryption: plaintext stored as-is for demo purposes.
                    message = Message(
                        conversation_id=conversation_id,
                        sender_id=user.id,
                        content=content,
                    )
                    db.add(message)
                    db.commit()
                    db.refresh(message)

                    members = db.exec(
                        select(ConversationMember).where(
                            ConversationMember.conversation_id == conversation_id
                        )
                    ).all()
                    for m in members:
                        status_value = (
                            DeliveryStatus.SENT
                            if m.user_id == user.id
                            else DeliveryStatus.DELIVERED
                        )
                        db.add(
                            MessageStatus(
                                message_id=message.id,
                                user_id=m.user_id,
                                status=status_value,
                            )
                        )
                    db.commit()

                    event = {
                        "type": "message",
                        "message": {
                            "id": message.id,
                            "conversation_id": message.conversation_id,
                            "sender_id": message.sender_id,
                            "content": message.content,
                            "created_at": message.created_at.isoformat(),
                        },
                    }
                    await manager.broadcast_to_conversation(conversation_id, event, db)
                    continue

                await websocket.send_json(
                    {"type": "error", "message": f"Unknown event type: {event_type}"}
                )

        except WebSocketDisconnect:
            manager.disconnect(user.id, websocket)
            user.is_online = False
            user.last_seen = datetime.utcnow()
            db.add(user)
            db.commit()
