from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models import (
    ConversationType,
    DeliveryStatus,
    MemberRole,
    MessageType,
)


class UserBase(BaseModel):
    phone_number: str
    username: str
    display_name: str
    avatar_url: Optional[str] = None
    status_message: Optional[str] = None


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    status_message: Optional[str] = None
    is_online: Optional[bool] = None


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
    username: Optional[str] = None
    display_name: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class ContactCreate(BaseModel):
    contact_user_id: int
    nickname: Optional[str] = None


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
    nickname: Optional[str] = None


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
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    member_ids: list[int] = Field(..., min_length=1)


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: ConversationType
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    created_by: int
    created_at: datetime
    updated_at: datetime
    members: list[ConversationMemberRead] = []


class MessageStatusRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    message_id: int
    user_id: int
    status: DeliveryStatus
    updated_at: datetime


class MessageCreate(BaseModel):
    content: str
    type: MessageType = MessageType.TEXT
    reply_to_message_id: Optional[int] = None


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    sender_id: int
    content: str
    type: MessageType
    reply_to_message_id: Optional[int] = None
    created_at: datetime
    sender: UserRead
    statuses: list[MessageStatusRead] = []


class MessageStatusUpdate(BaseModel):
    status: DeliveryStatus