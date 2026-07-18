import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from "date-fns";

import type { Conversation, Message, User } from "@/types";

export function getInitials(name: string): string {
  return name
    .split(" ")
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
  const date = parseISO(dateStr);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d");
}

export function formatLastSeen(user: User): string {
  if (user.is_online) return "Online";
  if (!user.last_seen) return "Offline";
  return `Last seen ${formatDistanceToNow(parseISO(user.last_seen), { addSuffix: true })}`;
}

export function getUnreadCount(messages: Message[], userId: number): number {
  return messages.filter((msg) => {
    if (msg.sender_id === userId) return false;
    const status = msg.statuses.find((s) => s.user_id === userId);
    return status?.status === "delivered" || status?.status === "sent";
  }).length;
}

export function getLastMessagePreview(message: Message | undefined): string {
  if (!message) return "No messages yet";
  if (message.type === "image") return "Photo";
  if (message.type === "file") return "File";
  return message.content.length > 48
    ? `${message.content.slice(0, 48)}…`
    : message.content;
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
