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

export interface Conversation {
  id: number;
  type: ConversationType;
  name: string | null;
  avatar_url: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  members: ConversationMember[];
}

export interface MessageStatus {
  id: number;
  message_id: number;
  user_id: number;
  status: DeliveryStatus;
  updated_at: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  type: MessageType;
  reply_to_message_id: number | null;
  created_at: string;
  sender: User;
  statuses: MessageStatus[];
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
