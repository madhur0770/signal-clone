from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
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
from app.schemas import (
    ConversationCreate,
    ConversationMemberRead,
    ConversationRead,
    UserRead,
)

router = APIRouter(prefix="/conversations", tags=["conversations"])


class AddMemberRequest(BaseModel):
    user_id: int


def _build_conversation_read(
    conversation: Conversation, db: Session
) -> ConversationRead:
    members = db.exec(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation.id
        )
    ).all()
    member_reads = []
    for member in members:
        user = db.get(User, member.user_id)
        member_reads.append(
            ConversationMemberRead(
                id=member.id,
                conversation_id=member.conversation_id,
                user_id=member.user_id,
                role=member.role,
                joined_at=member.joined_at,
                user=UserRead.model_validate(user),
            )
        )
    return ConversationRead(
        id=conversation.id,
        type=conversation.type,
        name=conversation.name,
        avatar_url=conversation.avatar_url,
        created_by=conversation.created_by,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        members=member_reads,
    )


def _user_is_member(conversation_id: int, user_id: int, db: Session) -> bool:
    member = db.exec(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id,
        )
    ).first()
    return member is not None


@router.get("", response_model=list[ConversationRead])
def list_conversations(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> list[ConversationRead]:
    memberships = db.exec(
        select(ConversationMember).where(ConversationMember.user_id == current_user.id)
    ).all()
    conversation_ids = [m.conversation_id for m in memberships]
    if not conversation_ids:
        return []

    conversations = db.exec(
        select(Conversation).where(Conversation.id.in_(conversation_ids))
    ).all()
    conversations.sort(key=lambda c: c.updated_at, reverse=True)
    return [_build_conversation_read(c, db) for c in conversations]


@router.post("", response_model=ConversationRead, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    payload: ConversationCreate,
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

    for member_id in member_ids:
        if not db.get(User, member_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User {member_id} not found",
            )

    if payload.type == ConversationType.DIRECT:
        existing = db.exec(
            select(Conversation).where(Conversation.type == ConversationType.DIRECT)
        ).all()
        for conv in existing:
            conv_members = db.exec(
                select(ConversationMember).where(
                    ConversationMember.conversation_id == conv.id
                )
            ).all()
            conv_user_ids = {m.user_id for m in conv_members}
            if conv_user_ids == set(member_ids):
                return _build_conversation_read(conv, db)

    conversation = Conversation(
        type=payload.type,
        name=payload.name,
        avatar_url=payload.avatar_url,
        created_by=current_user.id,
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    for member_id in member_ids:
        role = MemberRole.ADMIN if member_id == current_user.id else MemberRole.MEMBER
        if payload.type == ConversationType.GROUP and member_id == current_user.id:
            role = MemberRole.ADMIN
        db.add(
            ConversationMember(
                conversation_id=conversation.id,
                user_id=member_id,
                role=role,
            )
        )
    db.commit()
    db.refresh(conversation)

    # Broadcast creation event to all members
    from app.routers.websocket import manager

    conversation_data = _build_conversation_read(conversation, db)
    event = {
        "type": "conversation_created",
        "conversation": conversation_data.model_dump(mode="json"),
    }
    await manager.broadcast_to_conversation(conversation.id, event, db)

    return conversation_data


@router.get("/{conversation_id}", response_model=ConversationRead)
def get_conversation(
    conversation_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> ConversationRead:
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )
    if not _user_is_member(conversation_id, current_user.id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member")
    return _build_conversation_read(conversation, db)


@router.post("/{conversation_id}/members", response_model=ConversationRead)
async def add_member(
    conversation_id: int,
    payload: AddMemberRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> ConversationRead:
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    if conversation.type != ConversationType.GROUP:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add members to a direct conversation",
        )

    current_member = db.exec(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == current_user.id,
        )
    ).first()
    
    if not current_member or current_member.role != MemberRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can add members")

    target_user = db.get(User, payload.user_id)
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if _user_is_member(conversation_id, payload.user_id, db):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already a member")

    new_member = ConversationMember(
        conversation_id=conversation.id,
        user_id=payload.user_id,
        role=MemberRole.MEMBER,
    )
    db.add(new_member)
    db.commit()

    from app.routers.websocket import manager

    conversation_data = _build_conversation_read(conversation, db)
    event = {
        "type": "member_added",
        "conversation": conversation_data.model_dump(mode="json"),
    }
    await manager.broadcast_to_conversation(conversation.id, event, db)

    return conversation_data


@router.delete("/{conversation_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    conversation_id: int,
    user_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> None:
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    if conversation.type != ConversationType.GROUP:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove members from a direct conversation")

    current_member = db.exec(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == current_user.id,
        )
    ).first()

    # Must be admin unless they are removing themselves
    if current_user.id != user_id:
        if not current_member or current_member.role != MemberRole.ADMIN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can remove members")

    target_member = db.exec(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id,
        )
    ).first()

    if not target_member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User is not a member")

    db.delete(target_member)
    db.commit()

    from app.routers.websocket import manager

    event = {
        "type": "member_removed",
        "conversation_id": conversation_id,
        "removed_user_id": user_id,
    }
    await manager.broadcast_to_conversation(conversation.id, event, db)