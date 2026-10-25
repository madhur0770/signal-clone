from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import (
    ConversationType,
    DeliveryStatus,
    MemberRole,
    MessageType,
)

MAX_MESSAGE_LENGTH = 4000
MAX_EMOJI_LENGTH = 16

# Signal's disappearing-message presets, in seconds (None / 0 turns the timer off).
DISAPPEAR_PRESETS = (30, 5 * 60, 60 * 60, 8 * 60 * 60, 24 * 60 * 60, 7 * 24 * 60 * 60)


class UserBase(BaseModel):
    phone_number: str
    username: str
    display_name: str
    avatar_url: Optional[str] = None
    status_message: Optional[str] = None


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    """Fields a user may change on their own profile."""

    display_name: Optional[str] = Field(default=None, max_length=50)
    avatar_url: Optional[str] = Field(default=None, max_length=500)
    status_message: Optional[str] = Field(default=None, max_length=140)

    @field_validator("display_name")
    @classmethod
    def display_name_not_blank(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("display_name cannot be blank")
        return value


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    last_seen: Optional[datetime] = None
    is_online: bool
    created_at: datetime


class OTPRequest(BaseModel):
    phone_number: str = Field(..., examples=["+15551234567"])


class OTPVerify(BaseModel):
    phone_number: str
    otp: str = Field(..., min_length=6, max_length=6)
    username: Optional[str] = Field(default=None, min_length=3, max_length=32)
    display_name: Optional[str] = Field(default=None, max_length=50)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class ContactCreate(BaseModel):
    contact_user_id: int
    nickname: Optional[str] = Field(default=None, max_length=50)


class ContactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    contact_user_id: int
    nickname: Optional[str] = None
    is_blocked: bool
    created_at: datetime
    contact_user: UserRead


class ContactUpdate(BaseModel):
    nickname: Optional[str] = Field(default=None, max_length=50)


class ConversationMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    user_id: int
    role: MemberRole
    joined_at: datetime
    user: UserRead


class ConversationCreate(BaseModel):
    type: ConversationType
    name: Optional[str] = Field(default=None, max_length=60)
    avatar_url: Optional[str] = Field(default=None, max_length=500)
    member_ids: list[int] = Field(..., min_length=1)


class ConversationUpdate(BaseModel):
    """Partial update; only fields present in the request body are applied."""

    name: Optional[str] = Field(default=None, max_length=60)
    disappear_after_seconds: Optional[int] = None

    @field_validator("disappear_after_seconds")
    @classmethod
    def valid_timer(cls, value: Optional[int]) -> Optional[int]:
        if value in (None, 0):
            return None
        if value not in DISAPPEAR_PRESETS:
            raise ValueError(
                f"disappear_after_seconds must be 0 or one of {list(DISAPPEAR_PRESETS)}"
            )
        return value


class MemberRoleUpdate(BaseModel):
    role: MemberRole


class MessageStatusRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    message_id: int
    user_id: int
    status: DeliveryStatus
    updated_at: datetime


class ReactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    emoji: str


class ReactionCreate(BaseModel):
    emoji: str = Field(..., min_length=1, max_length=MAX_EMOJI_LENGTH)

    @field_validator("emoji")
    @classmethod
    def emoji_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("emoji cannot be blank")
        return value


class ReplyPreview(BaseModel):
    """Snapshot of the message being replied to, so the client needn't have it loaded."""

    id: int
    sender_id: int
    sender_name: str
    content: str
    type: MessageType
    attachment_name: Optional[str] = None


class AttachmentRead(BaseModel):
    url: str
    name: str
    mime: str
    size: int
    type: MessageType


class MessageCreate(BaseModel):
    content: str = Field(default="", max_length=MAX_MESSAGE_LENGTH)
    type: MessageType = MessageType.TEXT
    reply_to_message_id: Optional[int] = None
    attachment_url: Optional[str] = None
    attachment_name: Optional[str] = Field(default=None, max_length=255)
    attachment_mime: Optional[str] = Field(default=None, max_length=100)
    attachment_size: Optional[int] = Field(default=None, ge=0)

    @model_validator(mode="after")
    def check_content(self) -> "MessageCreate":
        if self.type == MessageType.TEXT:
            self.content = self.content.strip()
            if not self.content:
                raise ValueError("content cannot be empty")
            if self.attachment_url:
                raise ValueError("text messages cannot carry an attachment")
        elif not self.attachment_url:
            raise ValueError("image and file messages need an attachment_url")
        return self


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    sender_id: int
    content: str
    type: MessageType
    reply_to_message_id: Optional[int] = None
    reply_to: Optional[ReplyPreview] = None
    created_at: datetime
    expires_at: Optional[datetime] = None
    attachment_url: Optional[str] = None
    attachment_name: Optional[str] = None
    attachment_mime: Optional[str] = None
    attachment_size: Optional[int] = None
    sender: UserRead
    statuses: list[MessageStatusRead] = []
    reactions: list[ReactionRead] = []


class MessageStatusUpdate(BaseModel):
    status: DeliveryStatus


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: ConversationType
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    created_by: int
    disappear_after_seconds: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    members: list[ConversationMemberRead] = []
    # Filled in by GET /conversations so the sidebar needs a single request.
    last_message: Optional[MessageRead] = None
    unread_count: int = 0
