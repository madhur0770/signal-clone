import type { Conversation, Message, User } from "@/types";

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    phone_number: "+15550010001",
    username: "alice",
    display_name: "Alice Chen",
    avatar_url: null,
    status_message: null,
    last_seen: null,
    is_online: false,
    created_at: "2026-07-01T10:00:00",
    ...overrides,
  };
}

export function makeMessage(overrides: Partial<Message> = {}): Message {
  const sender = overrides.sender ?? makeUser();
  return {
    id: 1,
    conversation_id: 10,
    sender_id: sender.id,
    content: "hello",
    type: "text",
    reply_to_message_id: null,
    reply_to: null,
    created_at: "2026-10-25T10:00:00",
    expires_at: null,
    attachment_url: null,
    attachment_name: null,
    attachment_mime: null,
    attachment_size: null,
    sender,
    statuses: [],
    reactions: [],
    ...overrides,
  };
}

export function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  const alice = makeUser();
  const bob = makeUser({ id: 2, username: "bob", display_name: "Bob Martinez" });
  return {
    id: 10,
    type: "direct",
    name: null,
    avatar_url: null,
    created_by: alice.id,
    disappear_after_seconds: null,
    created_at: "2026-10-01T10:00:00",
    updated_at: "2026-10-25T10:00:00",
    members: [
      { id: 1, conversation_id: 10, user_id: alice.id, role: "member", joined_at: "2026-10-01T10:00:00", user: alice },
      { id: 2, conversation_id: 10, user_id: bob.id, role: "member", joined_at: "2026-10-01T10:00:00", user: bob },
    ],
    ...overrides,
  };
}
