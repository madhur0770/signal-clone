import axios from "axios";

import type {
  Attachment,
  Contact,
  Conversation,
  DeliveryStatus,
  MemberRole,
  Message,
  MessageStatus,
  MessageType,
  Reaction,
  TokenResponse,
  User,
} from "@/types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { "Content-Type": "application/json" },
});

export function setAuthToken(token: string | null) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

// When the server says our session is gone (expired, revoked), the store signs us out.
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url: string = error?.config?.url ?? "";
    const isLogin = url.includes("/auth/verify-otp") || url.includes("/auth/request-otp");
    if (error?.response?.status === 401 && !isLogin && api.defaults.headers.common.Authorization) {
      unauthorizedHandler?.();
    }
    return Promise.reject(error);
  }
);

/** Attachment URLs from the API are relative to the API origin. */
export function resolveAttachmentUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^(https?:|blob:|data:)/.test(url)) return url;
  return `${API_URL}${url}`;
}

// Auth
export async function requestOtp(phoneNumber: string) {
  const { data } = await api.post<{ message: string }>("/auth/request-otp", {
    phone_number: phoneNumber,
  });
  return data;
}

export async function verifyOtp(
  phoneNumber: string,
  otp: string,
  username?: string,
  displayName?: string
): Promise<TokenResponse> {
  const { data } = await api.post<TokenResponse>("/auth/verify-otp", {
    phone_number: phoneNumber,
    otp,
    username,
    display_name: displayName,
  });
  return data;
}

export async function getMe(): Promise<User> {
  const { data } = await api.get<User>("/auth/me");
  return data;
}

export async function updateProfile(changes: {
  display_name?: string;
  status_message?: string;
  avatar_url?: string;
}): Promise<User> {
  const { data } = await api.patch<User>("/auth/me", changes);
  return data;
}

export async function logout() {
  await api.post("/auth/logout");
}

// Contacts
export async function getContacts(): Promise<Contact[]> {
  const { data } = await api.get<Contact[]>("/contacts");
  return data;
}

export async function addContact(
  contactUserId: number,
  nickname?: string
): Promise<Contact> {
  const { data } = await api.post<Contact>("/contacts", {
    contact_user_id: contactUserId,
    nickname,
  });
  return data;
}

export async function searchUsers(query: string): Promise<User[]> {
  if (!query.trim()) return [];
  const { data } = await api.get<User[]>("/contacts/search", {
    params: { q: query },
  });
  return data;
}

export async function blockContact(contactId: number): Promise<Contact> {
  const { data } = await api.post<Contact>(`/contacts/${contactId}/block`);
  return data;
}

export async function unblockContact(contactId: number): Promise<Contact> {
  const { data } = await api.post<Contact>(`/contacts/${contactId}/unblock`);
  return data;
}

// Conversations
export async function getConversations(): Promise<Conversation[]> {
  const { data } = await api.get<Conversation[]>("/conversations");
  return data;
}

export async function createConversation(payload: {
  type: "direct" | "group";
  name?: string;
  member_ids: number[];
}): Promise<Conversation> {
  const { data } = await api.post<Conversation>("/conversations", payload);
  return data;
}

export async function updateConversation(
  conversationId: number,
  changes: { name?: string; disappear_after_seconds?: number | null }
): Promise<Conversation> {
  const { data } = await api.patch<Conversation>(
    `/conversations/${conversationId}`,
    changes
  );
  return data;
}

export async function addMember(
  conversationId: number,
  userId: number
): Promise<Conversation> {
  const { data } = await api.post<Conversation>(
    `/conversations/${conversationId}/members`,
    { user_id: userId }
  );
  return data;
}

export async function updateMemberRole(
  conversationId: number,
  userId: number,
  role: MemberRole
): Promise<Conversation> {
  const { data } = await api.patch<Conversation>(
    `/conversations/${conversationId}/members/${userId}`,
    { role }
  );
  return data;
}

export async function removeMember(
  conversationId: number,
  userId: number
): Promise<void> {
  await api.delete(`/conversations/${conversationId}/members/${userId}`);
}

// Messages
export async function getMessages(
  conversationId: number,
  limit = 50,
  beforeId?: number
): Promise<Message[]> {
  const { data } = await api.get<Message[]>(
    `/conversations/${conversationId}/messages`,
    { params: { limit, before_id: beforeId } }
  );
  return data;
}

export interface SendMessagePayload {
  content: string;
  type?: MessageType;
  replyToMessageId?: number | null;
  attachment?: Attachment;
}

export async function sendMessage(
  conversationId: number,
  { content, type = "text", replyToMessageId, attachment }: SendMessagePayload
): Promise<Message> {
  const { data } = await api.post<Message>(
    `/conversations/${conversationId}/messages`,
    {
      content,
      type,
      reply_to_message_id: replyToMessageId ?? undefined,
      attachment_url: attachment?.url,
      attachment_name: attachment?.name,
      attachment_mime: attachment?.mime,
      attachment_size: attachment?.size,
    }
  );
  return data;
}

export async function uploadAttachment(
  file: File,
  onProgress?: (fraction: number) => void
): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<Attachment>("/uploads", form, {
    // Let the browser set the multipart boundary.
    headers: { "Content-Type": undefined },
    onUploadProgress: (event) => {
      if (onProgress && event.total) onProgress(event.loaded / event.total);
    },
  });
  return data;
}

export async function updateMessageStatus(
  messageId: number,
  status: DeliveryStatus
): Promise<MessageStatus> {
  const { data } = await api.patch<MessageStatus>(
    `/messages/${messageId}/status`,
    { status }
  );
  return data;
}

export async function markConversationRead(
  conversationId: number
): Promise<number[]> {
  const { data } = await api.post<{ message_ids: number[] }>(
    `/conversations/${conversationId}/read`
  );
  return data.message_ids;
}

export async function setReaction(
  messageId: number,
  emoji: string
): Promise<Reaction[]> {
  const { data } = await api.put<Reaction[]>(`/messages/${messageId}/reaction`, {
    emoji,
  });
  return data;
}

export async function removeReaction(messageId: number): Promise<Reaction[]> {
  const { data } = await api.delete<Reaction[]>(`/messages/${messageId}/reaction`);
  return data;
}
