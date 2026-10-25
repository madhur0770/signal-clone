"""Shared business logic used by both the REST routers and the WebSocket handler."""

from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import timedelta
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import delete, func, update
from sqlmodel import Session, or_, select

from app.models import (
    Contact,
    Conversation,
    ConversationMember,
    ConversationType,
    DeliveryStatus,
    Message,
    MessageStatus,
    Reaction,
    User,
)
from app.schemas import (
    ConversationMemberRead,
    ConversationRead,
    MessageCreate,
    MessageRead,
    MessageStatusRead,
    ReactionRead,
    ReplyPreview,
    UserRead,
)
from app.timeutil import utcnow
from app.uploads import delete_upload, validate_attachment_url

REPLY_SNIPPET_LENGTH = 140
IN_CHUNK = 500

STATUS_RANK = {
    DeliveryStatus.SENT: 0,
    DeliveryStatus.DELIVERED: 1,
    DeliveryStatus.READ: 2,
}


def _chunks(values: Sequence[int], size: int = IN_CHUNK) -> Iterable[Sequence[int]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


def not_expired():
    """SQL condition matching messages that haven't disappeared yet."""
    return or_(Message.expires_at.is_(None), Message.expires_at > utcnow())  # type: ignore[union-attr]


# --------------------------------------------------------------------------- membership


def get_member(
    db: Session, conversation_id: int, user_id: int
) -> Optional[ConversationMember]:
    return db.exec(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id,
        )
    ).first()


def is_member(db: Session, conversation_id: int, user_id: int) -> bool:
    return get_member(db, conversation_id, user_id) is not None


def member_user_ids(db: Session, conversation_id: int) -> list[int]:
    return list(
        db.exec(
            select(ConversationMember.user_id).where(
                ConversationMember.conversation_id == conversation_id
            )
        ).all()
    )


def get_conversation_for_member(
    db: Session, conversation_id: int, user: User
) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )
    if not is_member(db, conversation_id, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member")
    return conversation


def co_member_ids(db: Session, user_id: int) -> set[int]:
    """Everyone who shares at least one conversation with ``user_id``."""
    conversation_ids = db.exec(
        select(ConversationMember.conversation_id).where(
            ConversationMember.user_id == user_id
        )
    ).all()
    others: set[int] = set()
    for chunk in _chunks(list(conversation_ids)):
        others.update(
            db.exec(
                select(ConversationMember.user_id).where(
                    ConversationMember.conversation_id.in_(chunk),  # type: ignore[attr-defined]
                    ConversationMember.user_id != user_id,
                )
            ).all()
        )
    return others


# ----------------------------------------------------------------------------- blocking


def is_blocked_between(db: Session, user_a: int, user_b: int) -> bool:
    return (
        db.exec(
            select(Contact.id).where(
                Contact.is_blocked == True,  # noqa: E712
                or_(
                    (Contact.owner_id == user_a) & (Contact.contact_user_id == user_b),
                    (Contact.owner_id == user_b) & (Contact.contact_user_id == user_a),
                ),
            )
        ).first()
        is not None
    )


def ensure_not_blocked(db: Session, conversation: Conversation, user: User) -> None:
    """Direct conversations are closed in both directions once either side blocks."""
    if conversation.type != ConversationType.DIRECT:
        return
    other_id = next(
        (uid for uid in member_user_ids(db, conversation.id) if uid != user.id), None
    )
    if other_id is not None and is_blocked_between(db, user.id, other_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot send message: this contact is blocked",
        )


# --------------------------------------------------------------------------- read models


def _snippet(message: Message) -> str:
    text = message.content or ""
    if len(text) > REPLY_SNIPPET_LENGTH:
        text = text[:REPLY_SNIPPET_LENGTH] + "…"
    return text


def build_message_reads(messages: Sequence[Message], db: Session) -> list[MessageRead]:
    """Serialise many messages with a fixed number of queries (no per-message lookups)."""
    if not messages:
        return []

    message_ids = [m.id for m in messages]
    reply_ids = sorted({m.reply_to_message_id for m in messages if m.reply_to_message_id})

    reply_targets: dict[int, Message] = {}
    for chunk in _chunks(reply_ids):
        for target in db.exec(select(Message).where(Message.id.in_(chunk))).all():  # type: ignore[attr-defined]
            reply_targets[target.id] = target

    user_ids = {m.sender_id for m in messages} | {t.sender_id for t in reply_targets.values()}
    users: dict[int, User] = {}
    for chunk in _chunks(sorted(user_ids)):
        for user in db.exec(select(User).where(User.id.in_(chunk))).all():  # type: ignore[attr-defined]
            users[user.id] = user

    statuses: dict[int, list[MessageStatus]] = defaultdict(list)
    reactions: dict[int, list[Reaction]] = defaultdict(list)
    for chunk in _chunks(message_ids):
        for item in db.exec(
            select(MessageStatus).where(MessageStatus.message_id.in_(chunk))  # type: ignore[attr-defined]
        ).all():
            statuses[item.message_id].append(item)
        for reaction in db.exec(
            select(Reaction)
            .where(Reaction.message_id.in_(chunk))  # type: ignore[attr-defined]
            .order_by(Reaction.created_at, Reaction.id)
        ).all():
            reactions[reaction.message_id].append(reaction)

    reads: list[MessageRead] = []
    for message in messages:
        reply_preview = None
        target = reply_targets.get(message.reply_to_message_id or -1)
        if target is not None:
            target_sender = users.get(target.sender_id)
            reply_preview = ReplyPreview(
                id=target.id,
                sender_id=target.sender_id,
                sender_name=target_sender.display_name if target_sender else "Unknown",
                content=_snippet(target),
                type=target.type,
                attachment_name=target.attachment_name,
            )
        reads.append(
            MessageRead(
                id=message.id,
                conversation_id=message.conversation_id,
                sender_id=message.sender_id,
                content=message.content,
                type=message.type,
                reply_to_message_id=message.reply_to_message_id,
                reply_to=reply_preview,
                created_at=message.created_at,
                expires_at=message.expires_at,
                attachment_url=message.attachment_url,
                attachment_name=message.attachment_name,
                attachment_mime=message.attachment_mime,
                attachment_size=message.attachment_size,
                sender=UserRead.model_validate(users[message.sender_id]),
                statuses=[MessageStatusRead.model_validate(s) for s in statuses[message.id]],
                reactions=[ReactionRead.model_validate(r) for r in reactions[message.id]],
            )
        )
    return reads


def build_message_read(message: Message, db: Session) -> MessageRead:
    return build_message_reads([message], db)[0]


def build_conversation_reads(
    conversations: Sequence[Conversation],
    db: Session,
    viewer_id: Optional[int] = None,
) -> list[ConversationRead]:
    """Serialise conversations; with ``viewer_id`` also attach last message + unread count."""
    if not conversations:
        return []

    conversation_ids = [c.id for c in conversations]

    members_by_conversation: dict[int, list[ConversationMember]] = defaultdict(list)
    member_users: dict[int, User] = {}
    for chunk in _chunks(conversation_ids):
        for member in db.exec(
            select(ConversationMember)
            .where(ConversationMember.conversation_id.in_(chunk))  # type: ignore[attr-defined]
            .order_by(ConversationMember.joined_at, ConversationMember.id)
        ).all():
            members_by_conversation[member.conversation_id].append(member)
    all_user_ids = sorted({m.user_id for ms in members_by_conversation.values() for m in ms})
    for chunk in _chunks(all_user_ids):
        for user in db.exec(select(User).where(User.id.in_(chunk))).all():  # type: ignore[attr-defined]
            member_users[user.id] = user

    last_by_conversation: dict[int, MessageRead] = {}
    unread_by_conversation: dict[int, int] = {}
    if viewer_id is not None:
        last_ids: list[int] = []
        for chunk in _chunks(conversation_ids):
            last_ids.extend(
                db.exec(
                    select(func.max(Message.id))
                    .where(Message.conversation_id.in_(chunk), not_expired())  # type: ignore[attr-defined]
                    .group_by(Message.conversation_id)
                ).all()
            )
        last_messages = []
        for chunk in _chunks([i for i in last_ids if i is not None]):
            last_messages.extend(
                db.exec(select(Message).where(Message.id.in_(chunk))).all()  # type: ignore[attr-defined]
            )
        for read in build_message_reads(last_messages, db):
            last_by_conversation[read.conversation_id] = read

        for chunk in _chunks(conversation_ids):
            rows = db.exec(
                select(Message.conversation_id, func.count(MessageStatus.id))
                .join(MessageStatus, MessageStatus.message_id == Message.id)
                .where(
                    Message.conversation_id.in_(chunk),  # type: ignore[attr-defined]
                    Message.sender_id != viewer_id,
                    MessageStatus.user_id == viewer_id,
                    MessageStatus.status != DeliveryStatus.READ,
                    not_expired(),
                )
                .group_by(Message.conversation_id)
            ).all()
            unread_by_conversation.update({cid: count for cid, count in rows})

    reads: list[ConversationRead] = []
    for conversation in conversations:
        members = [
            ConversationMemberRead(
                id=m.id,
                conversation_id=m.conversation_id,
                user_id=m.user_id,
                role=m.role,
                joined_at=m.joined_at,
                user=UserRead.model_validate(member_users[m.user_id]),
            )
            for m in members_by_conversation[conversation.id]
            if m.user_id in member_users
        ]
        reads.append(
            ConversationRead(
                id=conversation.id,
                type=conversation.type,
                name=conversation.name,
                avatar_url=conversation.avatar_url,
                created_by=conversation.created_by,
                disappear_after_seconds=conversation.disappear_after_seconds,
                created_at=conversation.created_at,
                updated_at=conversation.updated_at,
                members=members,
                last_message=last_by_conversation.get(conversation.id),
                unread_count=unread_by_conversation.get(conversation.id, 0),
            )
        )
    return reads


# ----------------------------------------------------------------------------- messages


def create_message(
    db: Session,
    conversation: Conversation,
    sender: User,
    payload: MessageCreate,
    online_user_ids: set[int],
) -> Message:
    """Validate and persist a message plus one status row per member.

    Recipients who are connected right now start as ``delivered``; everyone else stays
    ``sent`` until they next connect (see :func:`mark_delivered_for_user`).
    """
    if not is_member(db, conversation.id, sender.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member")
    ensure_not_blocked(db, conversation, sender)

    if payload.reply_to_message_id:
        target = db.get(Message, payload.reply_to_message_id)
        if not target or target.conversation_id != conversation.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid reply_to_message_id",
            )

    attachment_size = payload.attachment_size
    if payload.attachment_url:
        path = validate_attachment_url(payload.attachment_url)
        attachment_size = path.stat().st_size

    now = utcnow()
    expires_at = (
        now + timedelta(seconds=conversation.disappear_after_seconds)
        if conversation.disappear_after_seconds
        else None
    )

    # Simulated encryption: plaintext stored as-is for demo purposes.
    message = Message(
        conversation_id=conversation.id,
        sender_id=sender.id,
        content=payload.content,
        type=payload.type,
        reply_to_message_id=payload.reply_to_message_id,
        created_at=now,
        expires_at=expires_at,
        attachment_url=payload.attachment_url,
        attachment_name=payload.attachment_name,
        attachment_mime=payload.attachment_mime,
        attachment_size=attachment_size,
    )
    db.add(message)
    db.flush()

    for user_id in member_user_ids(db, conversation.id):
        if user_id == sender.id:
            value = DeliveryStatus.SENT
        elif user_id in online_user_ids:
            value = DeliveryStatus.DELIVERED
        else:
            value = DeliveryStatus.SENT
        db.add(MessageStatus(message_id=message.id, user_id=user_id, status=value))

    conversation.updated_at = now
    db.add(conversation)
    db.commit()
    db.refresh(message)
    return message


def set_message_status(
    db: Session, message: Message, user_id: int, new_status: DeliveryStatus
) -> Optional[MessageStatus]:
    """Raise a recipient's status; never downgrades. Returns None if nothing changed."""
    row = db.exec(
        select(MessageStatus).where(
            MessageStatus.message_id == message.id, MessageStatus.user_id == user_id
        )
    ).first()
    if row is None:
        row = MessageStatus(message_id=message.id, user_id=user_id, status=new_status)
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    if STATUS_RANK[new_status] <= STATUS_RANK[row.status]:
        return None
    row.status = new_status
    row.updated_at = utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def mark_conversation_status(
    db: Session, conversation_id: int, user_id: int, new_status: DeliveryStatus
) -> list[int]:
    """Raise every message the user received in a conversation to ``new_status``."""
    rows = db.exec(
        select(MessageStatus)
        .join(Message, Message.id == MessageStatus.message_id)
        .where(
            Message.conversation_id == conversation_id,
            Message.sender_id != user_id,
            MessageStatus.user_id == user_id,
            not_expired(),
        )
    ).all()
    now = utcnow()
    changed: list[int] = []
    for row in rows:
        if STATUS_RANK[new_status] > STATUS_RANK[row.status]:
            row.status = new_status
            row.updated_at = now
            db.add(row)
            changed.append(row.message_id)
    if changed:
        db.commit()
    return changed


def mark_delivered_for_user(db: Session, user_id: int) -> dict[int, list[int]]:
    """Called when a user connects: everything still ``sent`` to them becomes ``delivered``."""
    rows = db.exec(
        select(MessageStatus, Message.conversation_id)
        .join(Message, Message.id == MessageStatus.message_id)
        .where(
            MessageStatus.user_id == user_id,
            MessageStatus.status == DeliveryStatus.SENT,
            Message.sender_id != user_id,
            not_expired(),
        )
    ).all()
    now = utcnow()
    by_conversation: dict[int, list[int]] = defaultdict(list)
    for row, conversation_id in rows:
        row.status = DeliveryStatus.DELIVERED
        row.updated_at = now
        db.add(row)
        by_conversation[conversation_id].append(row.message_id)
    if rows:
        db.commit()
    return dict(by_conversation)


# ------------------------------------------------------------------------------ cleanup


def _delete_messages(db: Session, messages: Sequence[Message]) -> dict[int, list[int]]:
    """Delete messages and everything hanging off them. Returns ids grouped by conversation."""
    if not messages:
        return {}
    by_conversation: dict[int, list[int]] = defaultdict(list)
    for message in messages:
        by_conversation[message.conversation_id].append(message.id)
    ids = [m.id for m in messages]
    urls = {m.attachment_url for m in messages if m.attachment_url}

    for chunk in _chunks(ids):
        db.exec(delete(MessageStatus).where(MessageStatus.message_id.in_(chunk)))  # type: ignore[call-overload,attr-defined]
        db.exec(delete(Reaction).where(Reaction.message_id.in_(chunk)))  # type: ignore[call-overload,attr-defined]
        db.exec(
            update(Message)  # type: ignore[call-overload]
            .where(Message.reply_to_message_id.in_(chunk))  # type: ignore[union-attr]
            .values(reply_to_message_id=None)
        )
        db.exec(delete(Message).where(Message.id.in_(chunk)))  # type: ignore[call-overload,attr-defined]
    db.commit()

    for url in urls:
        still_used = db.exec(
            select(Message.id).where(Message.attachment_url == url)
        ).first()
        if still_used is None:
            delete_upload(url)
    return dict(by_conversation)


def purge_expired(db: Session) -> dict[int, list[int]]:
    """Remove messages whose disappearing-message timer has run out."""
    expired = db.exec(
        select(Message).where(
            Message.expires_at.is_not(None),  # type: ignore[union-attr]
            Message.expires_at <= utcnow(),
        )
    ).all()
    return _delete_messages(db, expired)


def delete_conversation(db: Session, conversation: Conversation) -> None:
    messages = db.exec(
        select(Message).where(Message.conversation_id == conversation.id)
    ).all()
    _delete_messages(db, messages)
    db.exec(
        delete(ConversationMember).where(  # type: ignore[call-overload]
            ConversationMember.conversation_id == conversation.id
        )
    )
    db.delete(conversation)
    db.commit()
