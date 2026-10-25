import { parseUtcDate } from "@/lib/utils";
import type {
  Contact,
  Conversation,
  DeliveryStatus,
  Message,
  Reaction,
  User,
} from "@/types";

export type ClientMessage = Message & {
  /** True while the message is only on this device (not yet confirmed by the server). */
  pending?: boolean;
  /** 0..1 while an attachment is uploading. */
  uploadProgress?: number;
};

const STATUS_RANK: Record<DeliveryStatus, number> = { sent: 0, delivered: 1, read: 2 };

/** Append a message unless it's already there (REST response and WS push can race). */
export function appendUnique<T extends { id: number }>(list: T[], message: T): T[] {
  return list.some((m) => m.id === message.id) ? list : [...list, message];
}

/** Put older messages (a page fetched with before_id) in front of the loaded ones. */
export function prependOlder<T extends { id: number }>(list: T[], older: T[]): T[] {
  const known = new Set(list.map((m) => m.id));
  return [...older.filter((m) => !known.has(m.id)), ...list];
}

export function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort(
    (a, b) =>
      parseUtcDate(b.updated_at).getTime() - parseUtcDate(a.updated_at).getTime()
  );
}

/** Raise `userId`'s status on the given messages; statuses never move backwards. */
export function applyStatus<T extends Message>(
  messages: T[],
  messageIds: number[],
  userId: number,
  status: DeliveryStatus
): T[] {
  const ids = new Set(messageIds);
  let changed = false;
  const next = messages.map((message) => {
    if (!ids.has(message.id)) return message;
    let touched = false;
    const statuses = message.statuses.map((s) => {
      if (s.user_id !== userId || STATUS_RANK[status] <= STATUS_RANK[s.status]) return s;
      touched = true;
      return { ...s, status };
    });
    if (!touched) return message;
    changed = true;
    return { ...message, statuses };
  });
  return changed ? next : messages;
}

export function applyReactions<T extends Message>(
  messages: T[],
  messageId: number,
  reactions: Reaction[]
): T[] {
  return messages.map((m) => (m.id === messageId ? { ...m, reactions } : m));
}

/** What a message's reactions look like after `userId` taps `emoji` (toggle / replace). */
export function toggleReactionList(
  reactions: Reaction[],
  userId: number,
  emoji: string
): Reaction[] {
  const mine = reactions.find((r) => r.user_id === userId);
  const others = reactions.filter((r) => r.user_id !== userId);
  if (mine?.emoji === emoji) return others;
  return [...others, { user_id: userId, emoji }];
}

/** Merge fresh fields for one user into every place the client keeps a copy of them. */
export function mergeUserEverywhere(
  update: Partial<User> & { id: number },
  state: { user: User | null; conversations: Conversation[]; contacts: Contact[] }
): { user: User | null; conversations: Conversation[]; contacts: Contact[] } {
  const merge = (user: User): User => (user.id === update.id ? { ...user, ...update } : user);
  return {
    user: state.user ? merge(state.user) : state.user,
    conversations: state.conversations.map((c) => ({
      ...c,
      members: c.members.map((m) => ({ ...m, user: merge(m.user) })),
    })),
    contacts: state.contacts.map((c) => ({ ...c, contact_user: merge(c.contact_user) })),
  };
}

/** Local stand-in for a reply preview, shown on a pending message before the server answers. */
export function replyPreviewFor(message: Message | null) {
  if (!message) return null;
  return {
    id: message.id,
    sender_id: message.sender_id,
    sender_name: message.sender.display_name,
    content: message.content,
    type: message.type,
    attachment_name: message.attachment_name,
  };
}
