import axios from "axios";

import type {
  Contact,
  Conversation,
  Message,
  MessageStatus,
  TokenResponse,
  User,
} from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

export async function removeMember(
  conversationId: number,
  userId: number
): Promise<void> {
  await api.delete(`/conversations/${conversationId}/members/${userId}`);
}

// Messages
export async function getMessages(
  conversationId: number,
  limit = 50
): Promise<Message[]> {
  const { data } = await api.get<Message[]>(
    `/conversations/${conversationId}/messages`,
    { params: { limit } }
  );
  return data;
}

export async function sendMessage(
  conversationId: number,
  content: string
): Promise<Message> {
  const { data } = await api.post<Message>(
    `/conversations/${conversationId}/messages`,
    { content, type: "text" }
  );
  return data;
}

export async function updateMessageStatus(
  messageId: number,
  status: "sent" | "delivered" | "read"
): Promise<MessageStatus> {
  const { data } = await api.patch<MessageStatus>(
    `/messages/${messageId}/status`,
    { status }
  );
  return data;
}