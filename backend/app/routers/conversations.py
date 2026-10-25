from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import aliased
from sqlmodel import Session, select

from app.auth import get_current_user
from app.database import get_session
from app.models import (
    Conversation,
    ConversationMember,
    ConversationType,
    MemberRole,
    User,
)
from app.routers.websocket import manager
from app.schemas import (
    ConversationCreate,
    ConversationRead,
    ConversationUpdate,
    MemberRoleUpdate,
)
from app.services import (
    build_conversation_reads,
    delete_conversation,
    get_conversation_for_member,
    get_member,
    is_member,
    member_user_ids,
)
from app.timeutil import utcnow

router = APIRouter(prefix="/conversations", tags=["conversations"])


class AddMemberRequest(BaseModel):
    user_id: int


def _read_one(conversation: Conversation, db: Session, viewer_id: int | None = None) -> ConversationRead:
    return build_conversation_reads([conversation], db, viewer_id)[0]


def _require_admin(db: Session, conversation: Conversation, user: User, detail: str) -> None:
    member = get_member(db, conversation.id, user.id)
    if not member or member.role != MemberRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _get_group(db: Session, conversation_id: int, action: str) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    if conversation.type != ConversationType.GROUP:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot {action} a direct conversation",
        )
    return conversation


def _find_direct_conversation(db: Session, user_a: int, user_b: int) -> Conversation | None:
    first = aliased(ConversationMember)
    second = aliased(ConversationMember)
    return db.exec(
        select(Conversation)
        .join(first, first.conversation_id == Conversation.id)
        .join(second, second.conversation_id == Conversation.id)
        .where(
            Conversation.type == ConversationType.DIRECT,
            first.user_id == user_a,
            second.user_id == user_b,
        )
    ).first()


@router.get("", response_model=list[ConversationRead])
def list_conversations(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> list[ConversationRead]:
    conversations = db.exec(
        select(Conversation)
        .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
        .where(ConversationMember.user_id == current_user.id)
        .order_by(Conversation.updated_at.desc())  # type: ignore[attr-defined]
    ).all()
    return build_conversation_reads(conversations, db, current_user.id)


@router.post("", response_model=ConversationRead, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    payload: ConversationCreate,
    response: Response,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> ConversationRead:
    member_ids = list(dict.fromkeys([current_user.id, *payload.member_ids]))

    if payload.type == ConversationType.DIRECT:
        if len(member_ids) != 2:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Direct conversations require exactly two members",
            )
    else:
        if not (payload.name and payload.name.strip()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Group conversations need a name",
            )
        if len(member_ids) < 2:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Add at least one other member to the group",
            )

    for member_id in member_ids:
        if not db.get(User, member_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User {member_id} not found",
            )

    if payload.type == ConversationType.DIRECT:
        existing = _find_direct_conversation(db, member_ids[0], member_ids[1])
        if existing:
            response.status_code = status.HTTP_200_OK
            return _read_one(existing, db, current_user.id)

    conversation = Conversation(
        type=payload.type,
        name=payload.name.strip() if payload.name else None,
        avatar_url=payload.avatar_url,
        created_by=current_user.id,
    )
    db.add(conversation)
    db.flush()

    for member_id in member_ids:
        is_creator_of_group = payload.type == ConversationType.GROUP and member_id == current_user.id
        db.add(
            ConversationMember(
                conversation_id=conversation.id,
                user_id=member_id,
                role=MemberRole.ADMIN if is_creator_of_group else MemberRole.MEMBER,
            )
        )
    db.commit()
    db.refresh(conversation)

    data = _read_one(conversation, db)
    await manager.broadcast_to_users(
        member_ids,
        {
            "type": "conversation_created",
            "conversation_id": conversation.id,
            "conversation": data.model_dump(mode="json"),
        },
    )
    return _read_one(conversation, db, current_user.id)


@router.get("/{conversation_id}", response_model=ConversationRead)
def get_conversation(
    conversation_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> ConversationRead:
    conversation = get_conversation_for_member(db, conversation_id, current_user)
    return _read_one(conversation, db, current_user.id)


@router.patch("/{conversation_id}", response_model=ConversationRead)
async def update_conversation(
    conversation_id: int,
    payload: ConversationUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> ConversationRead:
    """Rename a group and/or set the disappearing-messages timer.

    Anyone in a direct chat can change the timer; in a group only admins can.
    """
    conversation = get_conversation_for_member(db, conversation_id, current_user)
    fields = payload.model_fields_set
    if conversation.type == ConversationType.GROUP:
        _require_admin(db, conversation, current_user, "Only admins can change group settings")

    if "name" in fields:
        if conversation.type != ConversationType.GROUP:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only groups have a name",
            )
        if not (payload.name and payload.name.strip()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Group name cannot be empty"
            )
        conversation.name = payload.name.strip()
    if "disappear_after_seconds" in fields:
        conversation.disappear_after_seconds = payload.disappear_after_seconds

    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    await manager.broadcast_to_conversation(
        conversation.id,
        {"type": "conversation_updated", "conversation_id": conversation.id},
        db,
    )
    return _read_one(conversation, db, current_user.id)


@router.post("/{conversation_id}/members", response_model=ConversationRead)
async def add_member(
    conversation_id: int,
    payload: AddMemberRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> ConversationRead:
    conversation = _get_group(db, conversation_id, "add members to")
    _require_admin(db, conversation, current_user, "Only admins can add members")

    if not db.get(User, payload.user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if is_member(db, conversation_id, payload.user_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="User is already a member"
        )

    db.add(
        ConversationMember(
            conversation_id=conversation.id,
            user_id=payload.user_id,
            role=MemberRole.MEMBER,
        )
    )
    db.commit()

    data = _read_one(conversation, db)
    await manager.broadcast_to_conversation(
        conversation.id,
        {
            "type": "member_added",
            "conversation_id": conversation.id,
            "user_id": payload.user_id,
            "conversation": data.model_dump(mode="json"),
        },
        db,
    )
    return _read_one(conversation, db, current_user.id)


@router.patch("/{conversation_id}/members/{user_id}", response_model=ConversationRead)
async def update_member_role(
    conversation_id: int,
    user_id: int,
    payload: MemberRoleUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> ConversationRead:
    conversation = _get_group(db, conversation_id, "change roles in")
    _require_admin(db, conversation, current_user, "Only admins can change roles")

    target = get_member(db, conversation_id, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User is not a member")

    if target.role == MemberRole.ADMIN and payload.role == MemberRole.MEMBER:
        admins = db.exec(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.role == MemberRole.ADMIN,
            )
        ).all()
        if len(admins) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A group needs at least one admin",
            )

    target.role = payload.role
    db.add(target)
    db.commit()

    await manager.broadcast_to_conversation(
        conversation.id,
        {"type": "conversation_updated", "conversation_id": conversation.id},
        db,
    )
    return _read_one(conversation, db, current_user.id)


@router.delete("/{conversation_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    conversation_id: int,
    user_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> None:
    conversation = _get_group(db, conversation_id, "remove members from")

    # Admins can remove anyone; everyone can remove themselves (leave).
    if current_user.id != user_id:
        _require_admin(db, conversation, current_user, "Only admins can remove members")

    target = get_member(db, conversation_id, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User is not a member")

    audience = member_user_ids(db, conversation_id)  # includes the user being removed
    was_admin = target.role == MemberRole.ADMIN
    db.delete(target)
    db.commit()

    remaining = db.exec(
        select(ConversationMember)
        .where(ConversationMember.conversation_id == conversation_id)
        .order_by(ConversationMember.joined_at, ConversationMember.id)  # type: ignore[arg-type]
    ).all()

    if not remaining:
        # Last person out: nothing left to keep.
        delete_conversation(db, conversation)
    else:
        if was_admin and not any(m.role == MemberRole.ADMIN for m in remaining):
            remaining[0].role = MemberRole.ADMIN
            db.add(remaining[0])
        conversation.updated_at = utcnow()
        db.add(conversation)
        db.commit()

    await manager.broadcast_to_users(
        audience,
        {
            "type": "member_removed",
            "conversation_id": conversation_id,
            "removed_user_id": user_id,
        },
    )
