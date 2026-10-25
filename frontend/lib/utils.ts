import {
  format,
  formatDistanceToNow,
  isSameDay,
  isToday,
  isYesterday,
  parseISO,
} from "date-fns";

import type {
  Conversation,
  DeliveryStatus,
  Message,
  Reaction,
  User,
} from "@/types";

export function parseUtcDate(dateStr: string): Date {
  // Backend sends naive UTC timestamps without a timezone marker.
  // Force UTC interpretation by appending "Z" if it's missing.
  const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(dateStr);
  return parseISO(hasTimezone ? dateStr : `${dateStr}Z`);
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function getConversationTitle(
  conversation: Conversation,
  currentUserId: number
): string {
  if (conversation.type === "group" && conversation.name) {
    return conversation.name;
  }

  const other = conversation.members.find((m) => m.user_id !== currentUserId);
  return other?.user.display_name ?? "Unknown";
}

export function getConversationAvatar(
  conversation: Conversation,
  currentUserId: number
): { url: string | null; name: string } {
  if (conversation.type === "group") {
    return {
      url: conversation.avatar_url,
      name: conversation.name ?? "Group",
    };
  }

  const other = conversation.members.find((m) => m.user_id !== currentUserId);
  return {
    url: other?.user.avatar_url ?? null,
    name: other?.user.display_name ?? "?",
  };
}

export function getOtherMember(
  conversation: Conversation,
  currentUserId: number
): User | null {
  if (conversation.type === "group") return null;
  const member = conversation.members.find((m) => m.user_id !== currentUserId);
  return member?.user ?? null;
}

export function formatMessageTime(dateStr: string): string {
  const date = parseUtcDate(dateStr);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d");
}

/** Time of day only, for use inside a bubble (the day is shown by the date divider). */
export function formatClockTime(dateStr: string): string {
  return format(parseUtcDate(dateStr), "h:mm a");
}

export function formatDayLabel(dateStr: string): string {
  const date = parseUtcDate(dateStr);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return format(date, sameYear ? "EEEE, MMM d" : "MMM d, yyyy");
}

export function isSameLocalDay(a: string, b: string): boolean {
  return isSameDay(parseUtcDate(a), parseUtcDate(b));
}

export function formatLastSeen(user: User): string {
  if (user.is_online) return "Online";
  if (!user.last_seen) return "Offline";
  return `Last seen ${formatDistanceToNow(parseUtcDate(user.last_seen), { addSuffix: true })}`;
}

/** The single status a sender sees on one of their messages. */
export function getOverallStatus(message: Message): DeliveryStatus {
  const recipients = message.statuses.filter((s) => s.user_id !== message.sender_id);
  if (recipients.length === 0) return "sent";
  // "Read" only once everyone has read it; "delivered" as soon as anyone has received it.
  if (recipients.every((s) => s.status === "read")) return "read";
  if (recipients.some((s) => s.status === "delivered" || s.status === "read")) {
    return "delivered";
  }
  return "sent";
}

export function getUnreadCount(messages: Message[], userId: number): number {
  return messages.filter((msg) => {
    if (msg.sender_id === userId) return false;
    const status = msg.statuses.find((s) => s.user_id === userId);
    return status?.status === "delivered" || status?.status === "sent";
  }).length;
}

export function getLastMessagePreview(message: Message | undefined | null): string {
  if (!message) return "No messages yet";
  const caption = message.content.trim();
  if (message.type === "image") return caption ? `📷 ${caption}` : "📷 Photo";
  if (message.type === "file") {
    return `📎 ${message.attachment_name ?? (caption || "File")}`;
  }
  return caption.length > 48 ? `${caption.slice(0, 48)}…` : caption;
}

export function isExpired(message: Pick<Message, "expires_at">, nowMs: number): boolean {
  if (!message.expires_at) return false;
  return parseUtcDate(message.expires_at).getTime() <= nowMs;
}

/** "42s", "5m", "3h", "2d" — how long until a disappearing message goes away. */
export function formatCountdown(expiresAt: string, nowMs: number): string {
  const seconds = Math.max(
    0,
    Math.ceil((parseUtcDate(expiresAt).getTime() - nowMs) / 1000)
  );
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.ceil(seconds / 3600)}h`;
  return `${Math.ceil(seconds / 86400)}d`;
}

export const DISAPPEAR_OPTIONS: { seconds: number | null; label: string }[] = [
  { seconds: null, label: "Off" },
  { seconds: 30, label: "30 seconds" },
  { seconds: 5 * 60, label: "5 minutes" },
  { seconds: 60 * 60, label: "1 hour" },
  { seconds: 8 * 60 * 60, label: "8 hours" },
  { seconds: 24 * 60 * 60, label: "1 day" },
  { seconds: 7 * 24 * 60 * 60, label: "1 week" },
];

export function formatTimerLabel(seconds: number | null | undefined): string {
  if (!seconds) return "Off";
  return (
    DISAPPEAR_OPTIONS.find((option) => option.seconds === seconds)?.label ??
    `${seconds}s`
  );
}

/** Matches the server's default MAX_UPLOAD_MB; the server is the source of truth. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  mine: boolean;
}

/** Collapse a message's reactions into one chip per emoji, most popular first. */
export function groupReactions(reactions: Reaction[], currentUserId: number): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const reaction of reactions) {
    const group = groups.get(reaction.emoji) ?? {
      emoji: reaction.emoji,
      count: 0,
      mine: false,
    };
    group.count += 1;
    group.mine ||= reaction.user_id === currentUserId;
    groups.set(reaction.emoji, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
