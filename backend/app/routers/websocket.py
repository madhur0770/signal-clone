import json
import logging
from collections.abc import Iterable
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from sqlmodel import Session

from app import database
from app.auth import get_current_user_from_token
from app.models import Conversation, DeliveryStatus, Message, User
from app.schemas import MessageCreate
from app.services import (
    build_message_read,
    co_member_ids,
    create_message,
    is_member,
    mark_delivered_for_user,
    member_user_ids,
)
from app.timeutil import utcnow

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])


class ConnectionManager:
    """Tracks live sockets per user and fans events out to them."""

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

    def is_connected(self, user_id: int) -> bool:
        return bool(self.active_connections.get(user_id))

    def online_user_ids(self) -> set[int]:
        return set(self.active_connections)

    async def send_personal(self, user_id: int, message: dict[str, Any]) -> None:
        # Iterate over a copy: a failed send drops the socket from the list.
        for connection in list(self.active_connections.get(user_id, [])):
            try:
                await connection.send_json(message)
            except Exception:  # dead socket; the receive loop will clean it up too
                logger.debug("dropping dead websocket for user %s", user_id)
                self.disconnect(user_id, connection)

    async def broadcast_to_users(
        self, user_ids: Iterable[int], message: dict[str, Any]
    ) -> None:
        for user_id in set(user_ids):
            await self.send_personal(user_id, message)

    async def broadcast_to_conversation(
        self,
        conversation_id: int,
        message: dict[str, Any],
        db: Session,
        *,
        exclude_user_id: Optional[int] = None,
        also_users: Iterable[int] = (),
    ) -> None:
        recipients = set(member_user_ids(db, conversation_id)) | set(also_users)
        recipients.discard(exclude_user_id)  # type: ignore[arg-type]
        await self.broadcast_to_users(recipients, message)


manager = ConnectionManager()


async def publish_message(db: Session, message: Message) -> dict[str, Any]:
    """Broadcast a freshly stored message (full payload) to every member."""
    payload = build_message_read(message, db).model_dump(mode="json")
    await manager.broadcast_to_conversation(
        message.conversation_id, {"type": "message", "message": payload}, db
    )
    return payload


async def publish_statuses(
    db: Session,
    conversation_id: int,
    user_id: int,
    status_value: DeliveryStatus,
    message_ids: list[int],
) -> None:
    if not message_ids:
        return
    await manager.broadcast_to_conversation(
        conversation_id,
        {
            "type": "messages_status",
            "conversation_id": conversation_id,
            "user_id": user_id,
            "status": status_value.value,
            "message_ids": message_ids,
        },
        db,
    )


async def publish_presence(user_id: int) -> None:
    with Session(database.engine) as db:
        user = db.get(User, user_id)
        if user is None:
            return
        audience = co_member_ids(db, user_id)
        event = {
            "type": "presence",
            "user_id": user_id,
            "is_online": user.is_online,
            "last_seen": user.last_seen.isoformat() if user.last_seen else None,
        }
    await manager.broadcast_to_users(audience, event)


async def _handle_event(user_id: int, websocket: WebSocket, payload: dict[str, Any]) -> None:
    event_type = payload.get("type")

    if event_type == "ping":
        await websocket.send_json({"type": "pong"})
        return

    conversation_id = payload.get("conversation_id")
    if not isinstance(conversation_id, int):
        await websocket.send_json(
            {"type": "error", "message": f"conversation_id required for '{event_type}'"}
        )
        return

    with Session(database.engine) as db:
        if event_type == "typing":
            if not is_member(db, conversation_id, user_id):
                return
            await manager.broadcast_to_conversation(
                conversation_id,
                {"type": "typing", "conversation_id": conversation_id, "user_id": user_id},
                db,
                exclude_user_id=user_id,
            )
            return

        if event_type == "message":
            conversation = db.get(Conversation, conversation_id)
            user = db.get(User, user_id)
            if conversation is None or user is None:
                await websocket.send_json(
                    {"type": "error", "message": "Conversation not found"}
                )
                return
            try:
                create = MessageCreate(
                    content=payload.get("content") or "",
                    reply_to_message_id=payload.get("reply_to_message_id"),
                )
                message = create_message(
                    db, conversation, user, create, manager.online_user_ids()
                )
            except ValidationError:
                await websocket.send_json(
                    {"type": "error", "message": "content must be 1-4000 characters"}
                )
                return
            except HTTPException as exc:
                await websocket.send_json({"type": "error", "message": exc.detail})
                return
            await publish_message(db, message)
            return

    await websocket.send_json(
        {"type": "error", "message": f"Unknown event type: {event_type}"}
    )


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str) -> None:
    with Session(database.engine) as db:
        try:
            user = get_current_user_from_token(token, db)
        except HTTPException:
            await websocket.close(code=1008)
            return
        user_id = user.id
        user.is_online = True
        db.add(user)
        db.commit()

    first_connection = not manager.is_connected(user_id)
    await manager.connect(user_id, websocket)
    try:
        with Session(database.engine) as db:
            delivered = mark_delivered_for_user(db, user_id)
            for conversation_id, message_ids in delivered.items():
                await publish_statuses(
                    db, conversation_id, user_id, DeliveryStatus.DELIVERED, message_ids
                )
        if first_connection:  # a second tab doesn't change anything others can see
            await publish_presence(user_id)
        await manager.send_personal(
            user_id,
            {"type": "connected", "user_id": user_id, "message": "WebSocket connected"},
        )

        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                continue
            if not isinstance(payload, dict):
                await websocket.send_json({"type": "error", "message": "Invalid payload"})
                continue
            await _handle_event(user_id, websocket, payload)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("websocket error for user %s", user_id)
    finally:
        manager.disconnect(user_id, websocket)
        if not manager.is_connected(user_id):
            with Session(database.engine) as db:
                user = db.get(User, user_id)
                if user is not None:
                    user.is_online = False
                    user.last_seen = utcnow()
                    db.add(user)
                    db.commit()
            await publish_presence(user_id)
