from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.auth import get_current_user
from app.database import get_session
from app.models import (
    Contact,
    Conversation,
    ConversationMember,
    ConversationType,
    DeliveryStatus,
    Message,
    MessageStatus,
    User,
)
from app.schemas import (
    MessageCreate,
    MessageRead,
    MessageStatusRead,
    MessageStatusUpdate,
    UserRead,
)

router = APIRouter(tags=["messages"])


def _user_is_member(conversation_id: int, user_id: int, db: Session) -> bool:
    member = db.exec(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id,
        )
    ).first()
    return member is not None


def _build_message_read(message: Message, db: Session) -> MessageRead:
    sender = db.get(User, message.sender_id)
    statuses = db.exec(
        select(MessageStatus).where(MessageStatus.message_id == message.id)
    ).all()
    return MessageRead(
        id=message.id,
        conversation_id=message.conversation_id,
        sender_id=message.sender_id,
        content=message.content,
        type=message.type,
        reply_to_message_id=message.reply_to_message_id,
        created_at=message.created_at,
        sender=UserRead.model_validate(sender),
        statuses=[MessageStatusRead.model_validate(s) for s in statuses],
    )


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=list[MessageRead],
)
def list_messages(
    conversation_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
    limit: int = 50,
    offset: int = 0,
) -> list[MessageRead]:
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )
    if not _user_is_member(conversation_id, current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member")

    messages = db.exec(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    messages.reverse()
    return [_build_message_read(m, db) for m in messages]


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=MessageRead,
    status_code=status.HTTP_201_CREATED,
)
async def send_message(
    conversation_id: int,
    payload: MessageCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> MessageRead:
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )
    if not _user_is_member(conversation_id, current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member")

    if conversation.type == ConversationType.DIRECT:
        members = db.exec(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id
            )
        ).all()
        other_member = next((m for m in members if m.user_id != current_user.id), None)
        
        if other_member:
            i_blocked_them = db.exec(
                select(Contact).where(
                    Contact.owner_id == current_user.id,
                    Contact.contact_user_id == other_member.user_id,
                    Contact.is_blocked == True,
                )
            ).first()
            
            they_blocked_me = db.exec(
                select(Contact).where(
                    Contact.owner_id == other_member.user_id,
                    Contact.contact_user_id == current_user.id,
                    Contact.is_blocked == True,
                )
            ).first()
            
            if i_blocked_them or they_blocked_me:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot send message: this contact is blocked",
                )

    if payload.reply_to_message_id:
        reply_msg = db.get(Message, payload.reply_to_message_id)
        if not reply_msg or reply_msg.conversation_id != conversation_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid reply_to_message_id",
            )

    # Simulated encryption: plaintext stored as-is for demo purposes.
    message = Message(
        conversation_id=conversation_id,
        sender_id=current_user.id,
        content=payload.content,
        type=payload.type,
        reply_to_message_id=payload.reply_to_message_id,
    )
    db.add(message)
    conversation.updated_at = datetime.utcnow()
    db.add(conversation)
    db.commit()
    db.refresh(message)

    members = db.exec(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation_id
        )
    ).all()
    for member in members:
        if member.user_id == current_user.id:
            status_value = DeliveryStatus.SENT
        else:
            status_value = DeliveryStatus.DELIVERED
        db.add(
            MessageStatus(
                message_id=message.id,
                user_id=member.user_id,
                status=status_value,
            )
        )
    db.commit()

    from app.routers.websocket import manager
    
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

    return _build_message_read(message, db)


@router.patch("/messages/{message_id}/status", response_model=MessageStatusRead)
def update_message_status(
    message_id: int,
    payload: MessageStatusUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> MessageStatusRead:
    message = db.get(Message, message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if not _user_is_member(message.conversation_id, current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member")

    msg_status = db.exec(
        select(MessageStatus).where(
            MessageStatus.message_id == message_id,
            MessageStatus.user_id == current_user.id,
        )
    ).first()
    if not msg_status:
        msg_status = MessageStatus(
            message_id=message_id,
            user_id=current_user.id,
            status=payload.status,
        )
    else:
        msg_status.status = payload.status
        msg_status.updated_at = datetime.utcnow()
    db.add(msg_status)
    db.commit()
    db.refresh(msg_status)
    return MessageStatusRead.model_validate(msg_status)