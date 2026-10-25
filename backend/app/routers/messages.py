from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, select

from app.auth import get_current_user
from app.database import get_session
from app.models import Conversation, DeliveryStatus, Message, MessageStatus, Reaction, User
from app.routers.websocket import manager, publish_message, publish_statuses
from app.schemas import (
    MessageCreate,
    MessageRead,
    MessageStatusRead,
    MessageStatusUpdate,
    ReactionCreate,
    ReactionRead,
)
from app.services import (
    build_message_reads,
    create_message,
    ensure_not_blocked,
    get_conversation_for_member,
    is_member,
    mark_conversation_status,
    not_expired,
    set_message_status,
)
from app.timeutil import utcnow

router = APIRouter(tags=["messages"])


def _get_visible_message(db: Session, message_id: int, user: User) -> Message:
    """Fetch a message the user is allowed to see (member of its conversation, not expired)."""
    message = db.get(Message, message_id)
    if message is None or (message.expires_at is not None and message.expires_at <= utcnow()):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if not is_member(db, message.conversation_id, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member")
    return message


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=list[MessageRead],
)
def list_messages(
    conversation_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    before_id: Annotated[Optional[int], Query(ge=1)] = None,
) -> list[MessageRead]:
    """Newest ``limit`` messages, oldest first. Pass ``before_id`` to page further back."""
    get_conversation_for_member(db, conversation_id, current_user)

    query = select(Message).where(
        Message.conversation_id == conversation_id, not_expired()
    )
    if before_id is not None:
        query = query.where(Message.id < before_id)
    messages = db.exec(
        query.order_by(Message.created_at.desc(), Message.id.desc())  # type: ignore[union-attr]
        .offset(offset)
        .limit(limit)
    ).all()
    messages.reverse()
    return build_message_reads(messages, db)


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
    conversation = get_conversation_for_member(db, conversation_id, current_user)
    message = create_message(db, conversation, current_user, payload, manager.online_user_ids())
    data = await publish_message(db, message)
    return MessageRead.model_validate(data)


@router.patch("/messages/{message_id}/status", response_model=MessageStatusRead)
async def update_message_status(
    message_id: int,
    payload: MessageStatusUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> MessageStatusRead:
    """Report that you've received/read a message. Statuses only ever move forward."""
    message = _get_visible_message(db, message_id, current_user)
    if message.sender_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You can't change the status of your own message",
        )
    if payload.status == DeliveryStatus.SENT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Status can only be set to 'delivered' or 'read'",
        )

    updated = set_message_status(db, message, current_user.id, payload.status)
    if updated is not None:
        await manager.broadcast_to_conversation(
            message.conversation_id,
            {
                "type": "message_status",
                "message_id": message_id,
                "user_id": current_user.id,
                "status": updated.status.value,
                "conversation_id": message.conversation_id,
            },
            db,
        )
        return MessageStatusRead.model_validate(updated)

    current = db.exec(
        select(MessageStatus).where(
            MessageStatus.message_id == message_id,
            MessageStatus.user_id == current_user.id,
        )
    ).first()
    assert current is not None
    return MessageStatusRead.model_validate(current)


@router.post("/conversations/{conversation_id}/read")
async def mark_conversation_read(
    conversation_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> dict[str, list[int]]:
    """Mark everything you've received in this conversation as read, in one request."""
    get_conversation_for_member(db, conversation_id, current_user)
    changed = mark_conversation_status(
        db, conversation_id, current_user.id, DeliveryStatus.READ
    )
    await publish_statuses(db, conversation_id, current_user.id, DeliveryStatus.READ, changed)
    return {"message_ids": changed}


def _reaction_reads(db: Session, message_id: int) -> list[ReactionRead]:
    rows = db.exec(
        select(Reaction)
        .where(Reaction.message_id == message_id)
        .order_by(Reaction.created_at, Reaction.id)  # type: ignore[arg-type]
    ).all()
    return [ReactionRead.model_validate(r) for r in rows]


async def _publish_reactions(db: Session, message: Message) -> list[ReactionRead]:
    reactions = _reaction_reads(db, message.id)
    await manager.broadcast_to_conversation(
        message.conversation_id,
        {
            "type": "reaction",
            "conversation_id": message.conversation_id,
            "message_id": message.id,
            "reactions": [r.model_dump(mode="json") for r in reactions],
        },
        db,
    )
    return reactions


def _ensure_can_react(db: Session, message: Message, user: User) -> None:
    conversation = db.get(Conversation, message.conversation_id)
    assert conversation is not None
    ensure_not_blocked(db, conversation, user)


@router.put("/messages/{message_id}/reaction", response_model=list[ReactionRead])
async def set_reaction(
    message_id: int,
    payload: ReactionCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> list[ReactionRead]:
    """React with an emoji. You have one reaction per message; reacting again replaces it."""
    message = _get_visible_message(db, message_id, current_user)
    _ensure_can_react(db, message, current_user)

    existing = db.exec(
        select(Reaction).where(
            Reaction.message_id == message_id, Reaction.user_id == current_user.id
        )
    ).first()
    if existing:
        existing.emoji = payload.emoji
        existing.created_at = utcnow()
        db.add(existing)
    else:
        db.add(Reaction(message_id=message_id, user_id=current_user.id, emoji=payload.emoji))
    db.commit()
    return await _publish_reactions(db, message)


@router.delete("/messages/{message_id}/reaction", response_model=list[ReactionRead])
async def remove_reaction(
    message_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> list[ReactionRead]:
    message = _get_visible_message(db, message_id, current_user)
    existing = db.exec(
        select(Reaction).where(
            Reaction.message_id == message_id, Reaction.user_id == current_user.id
        )
    ).first()
    if existing:
        db.delete(existing)
        db.commit()
    return await _publish_reactions(db, message)
