"use client";

import Avatar from "@/components/Avatar";
import { formatLastSeen, getConversationAvatar, getOtherMember } from "@/lib/utils";
import type { Conversation, User } from "@/types";

interface ChatHeaderProps {
  conversation: Conversation;
  currentUser: User;
}

export default function ChatHeader({ conversation, currentUser }: ChatHeaderProps) {
  const avatar = getConversationAvatar(conversation, currentUser.id);
  const other = getOtherMember(conversation, currentUser.id);
  const title =
    conversation.type === "group"
      ? conversation.name ?? "Group"
      : other?.display_name ?? "Unknown";

  const subtitle =
    conversation.type === "group"
      ? `${conversation.members.length} members`
      : other
        ? formatLastSeen(other)
        : "";

  return (
    <header className="flex items-center gap-3 border-b border-border bg-panel px-6 py-4">
      <Avatar name={avatar.name} src={avatar.url} size="md" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-foreground">{title}</h1>
        <p className="truncate text-sm text-muted">
          {other?.is_online && conversation.type === "direct" ? (
            <span className="text-online">Online</span>
          ) : (
            subtitle
          )}
        </p>
      </div>
    </header>
  );
}
