from datetime import datetime
from enum import Enum
from typing import Optional

from sqlmodel import Field, Relationship, SQLModel, UniqueConstraint

from app.timeutil import utcnow


class ConversationType(str, Enum):
    DIRECT = "direct"
    GROUP = "group"


class MemberRole(str, Enum):
    ADMIN = "admin"
    MEMBER = "member"


class MessageType(str, Enum):
    TEXT = "text"
    IMAGE = "image"
    FILE = "file"


class DeliveryStatus(str, Enum):
    SENT = "sent"
    DELIVERED = "delivered"
    READ = "read"


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: Optional[int] = Field(default=None, primary_key=True)
    phone_number: str = Field(unique=True, index=True)
    username: str = Field(unique=True, index=True)
    display_name: str
    avatar_url: Optional[str] = None
    status_message: Optional[str] = None
    last_seen: Optional[datetime] = None
    is_online: bool = False
    created_at: datetime = Field(default_factory=utcnow)

    owned_contacts: list["Contact"] = Relationship(
        back_populates="owner",
        sa_relationship_kwargs={"foreign_keys": "[Contact.owner_id]"},
    )
    contact_of: list["Contact"] = Relationship(
        back_populates="contact_user",
        sa_relationship_kwargs={"foreign_keys": "[Contact.contact_user_id]"},
    )
    memberships: list["ConversationMember"] = Relationship(back_populates="user")
    sent_messages: list["Message"] = Relationship(
        back_populates="sender",
        sa_relationship_kwargs={"foreign_keys": "[Message.sender_id]"},
    )
    message_statuses: list["MessageStatus"] = Relationship(back_populates="user")
    sessions: list["Session"] = Relationship(back_populates="user")
    created_conversations: list["Conversation"] = Relationship(back_populates="creator")


class Contact(SQLModel, table=True):
    __tablename__ = "contacts"

    id: Optional[int] = Field(default=None, primary_key=True)
    owner_id: int = Field(foreign_key="users.id", index=True)
    contact_user_id: int = Field(foreign_key="users.id", index=True)
    nickname: Optional[str] = None
    is_blocked: bool = Field(default=False)
    created_at: datetime = Field(default_factory=utcnow)

    owner: User = Relationship(
        back_populates="owned_contacts",
        sa_relationship_kwargs={"foreign_keys": "[Contact.owner_id]"},
    )
    contact_user: User = Relationship(
        back_populates="contact_of",
        sa_relationship_kwargs={"foreign_keys": "[Contact.contact_user_id]"},
    )


class Conversation(SQLModel, table=True):
    __tablename__ = "conversations"

    id: Optional[int] = Field(default=None, primary_key=True)
    type: ConversationType
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    created_by: int = Field(foreign_key="users.id")
    # Disappearing messages: new messages expire this many seconds after sending.
    disappear_after_seconds: Optional[int] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    creator: User = Relationship(back_populates="created_conversations")
    members: list["ConversationMember"] = Relationship(back_populates="conversation")
    messages: list["Message"] = Relationship(back_populates="conversation")


class ConversationMember(SQLModel, table=True):
    __tablename__ = "conversation_members"

    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="conversations.id", index=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    role: MemberRole = MemberRole.MEMBER
    joined_at: datetime = Field(default_factory=utcnow)

    conversation: Conversation = Relationship(back_populates="members")
    user: User = Relationship(back_populates="memberships")


class Message(SQLModel, table=True):
    __tablename__ = "messages"

    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="conversations.id", index=True)
    sender_id: int = Field(foreign_key="users.id", index=True)
    # Simulated encryption: content is stored as plaintext for this demo.
    content: str
    type: MessageType = MessageType.TEXT
    reply_to_message_id: Optional[int] = Field(default=None, foreign_key="messages.id")
    created_at: datetime = Field(default_factory=utcnow)
    expires_at: Optional[datetime] = Field(default=None, index=True)
    attachment_url: Optional[str] = None
    attachment_name: Optional[str] = None
    attachment_mime: Optional[str] = None
    attachment_size: Optional[int] = None

    conversation: Conversation = Relationship(back_populates="messages")
    sender: User = Relationship(
        back_populates="sent_messages",
        sa_relationship_kwargs={"foreign_keys": "[Message.sender_id]"},
    )
    reply_to: Optional["Message"] = Relationship(
        sa_relationship_kwargs={
            "remote_side": "Message.id",
            "foreign_keys": "[Message.reply_to_message_id]",
        }
    )
    statuses: list["MessageStatus"] = Relationship(back_populates="message")


class MessageStatus(SQLModel, table=True):
    __tablename__ = "message_status"

    id: Optional[int] = Field(default=None, primary_key=True)
    message_id: int = Field(foreign_key="messages.id", index=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    status: DeliveryStatus = DeliveryStatus.SENT
    updated_at: datetime = Field(default_factory=utcnow)

    message: Message = Relationship(back_populates="statuses")
    user: User = Relationship(back_populates="message_statuses")


class Reaction(SQLModel, table=True):
    """One emoji reaction per user per message (reacting again replaces it)."""

    __tablename__ = "message_reactions"
    __table_args__ = (UniqueConstraint("message_id", "user_id", name="uq_reaction_user"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    message_id: int = Field(foreign_key="messages.id", index=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    emoji: str
    created_at: datetime = Field(default_factory=utcnow)


class Session(SQLModel, table=True):
    __tablename__ = "sessions"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    token: str = Field(unique=True, index=True)
    created_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime

    user: User = Relationship(back_populates="sessions")
