"use client";

import { formatMessageTime } from "@/lib/utils";
import type { Message } from "@/types";

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  showTail?: boolean;
}

export default function MessageBubble({
  message,
  isOwn,
  showTail = true,
}: MessageBubbleProps) {
  const time = formatMessageTime(message.created_at);
  const status = message.statuses.find((s) => s.user_id === message.sender_id);

  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
      <div
        className={`group relative max-w-[75%] px-4 py-2.5 ${
          isOwn
            ? `bubble-sent text-white ${showTail ? "rounded-bubble-sent" : "rounded-2xl rounded-br-md"}`
            : `bubble-received text-foreground ${showTail ? "rounded-bubble-received" : "rounded-2xl rounded-bl-md"}`
        }`}
      >
        <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
          {message.content}
        </p>
        <div
          className={`mt-1 flex items-center gap-1 text-[11px] ${
            isOwn ? "justify-end text-white/70" : "justify-end text-muted"
          }`}
        >
          <span>{time}</span>
          {isOwn && status && (
            <span className="uppercase tracking-wide">
              {status.status === "read" ? "Read" : status.status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
