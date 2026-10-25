export type ConversationType = "direct" | "group";
export type MessageType = "text" | "image" | "file";
export type DeliveryStatus = "sent" | "delivered" | "read";
export type MemberRole = "admin" | "member";

export interface User {
  id: number;
  phone_number: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  status_message: string | null;
  last_seen: string | null;
  is_online: boolean;
  created_at: string;
}

export interface Contact {
  id: number;
  owner_id: number;
  contact_user_id: number;
  nickname: string | null;
  is_blocked: boolean;
  created_at: string;
  contact_user: User;
}

export interface ConversationMember {
  id: number;
  conversation_id: number;
  user_id: number;
  role: MemberRole;
  joined_at: string;
  user: User;
}

export interface MessageStatus {
  id: number;
  message_id: number;
  user_id: number;
  status: DeliveryStatus;
  updated_at: string;
}

export interface Reaction {
  user_id: number;
  emoji: string;
}

export interface ReplyPreview {
  id: number;
  sender_id: number;
  sender_name: string;
  content: string;
  type: MessageType;
  attachment_name: string | null;
}

export interface Attachment {
  url: string;
  name: string;
  mime: string;
  size: number;
  type: MessageType;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  type: MessageType;
  reply_to_message_id: number | null;
  reply_to: ReplyPreview | null;
  created_at: string;
  expires_at: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  sender: User;
  statuses: MessageStatus[];
  reactions: Reaction[];
}

export interface Conversation {
  id: number;
  type: ConversationType;
  name: string | null;
  avatar_url: string | null;
  created_by: number;
  disappear_after_seconds: number | null;
  created_at: string;
  updated_at: string;
  members: ConversationMember[];
  last_message?: Message | null;
  unread_count?: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface ConversationPreview {
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}
