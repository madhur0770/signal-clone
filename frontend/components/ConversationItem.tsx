"use client";

import { formatMessageTime } from "@/lib/utils";
import Avatar from "@/components/Avatar";
import type { Conversation, ConversationPreview } from "@/types";

interface ConversationItemProps {
  conversation: Conversation;
  preview?: ConversationPreview;
  title: string;
  avatarName: string;
  avatarUrl: string | null;
  isActive: boolean;
  onClick: () => void;
}

export default function ConversationItem({
  conversation,
  preview,
  title,
  avatarName,
  avatarUrl,
  isActive,
  onClick,
}: ConversationItemProps) {
  const unread = preview?.unreadCount ?? 0;
  const time = preview?.lastMessageAt
    ? formatMessageTime(preview.lastMessageAt)
    : formatMessageTime(conversation.updated_at);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
        isActive
          ? "bg-accent/10"
          : "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
      }`}
    >
      <Avatar name={avatarName} src={avatarUrl} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold text-foreground">{title}</span>
          <span className="shrink-0 text-xs text-muted">{time}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-sm text-muted">
            {preview?.lastMessage ?? "No messages yet"}
          </p>
          {unread > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
