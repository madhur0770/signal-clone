"use client";

import { formatMessageTime } from "@/lib/utils";
import type { ClientMessage } from "@/store/useStore";

function MessageStatusTicks({ status }: { status: "sent" | "delivered" | "read" }) {
  const isRead = status === "read";
  const showDouble = status === "delivered" || status === "read";
  return (
    <svg
      width="16"
      height="11"
      viewBox="0 0 16 11"
      fill="none"
      className={isRead ? "text-sky-400" : "text-white/70"}
    >
      <path
        d="M1 5.5L4.5 9L11 1.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showDouble && (
        <path
          d="M5 5.5L8.5 9L15 1.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function MessagePendingIcon() {
  return (
    <svg
      width="16"
      height="11"
      viewBox="0 0 16 11"
      fill="none"
      className="text-white/50"
    >
      <circle cx="8" cy="5.5" r="4.25" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 3.5V5.5L9.5 7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface MessageBubbleProps {
  message: ClientMessage;
  isOwn: boolean;
  showTail?: boolean;
}

export default function MessageBubble({
  message,
  isOwn,
  showTail = true,
}: MessageBubbleProps) {
  const time = formatMessageTime(message.created_at);
  
  const recipientStatuses = message.statuses.filter((s) => s.user_id !== message.sender_id);
  let overallStatus: "sent" | "delivered" | "read" = "sent";
  
  if (recipientStatuses.length > 0) {
    if (recipientStatuses.every((s) => s.status === "read")) {
      overallStatus = "read";
    } else if (recipientStatuses.some((s) => s.status === "delivered" || s.status === "read")) {
      overallStatus = "delivered";
    }
  }

  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
      <div
        className={`group relative max-w-[75%] px-4 py-2.5 ${
          isOwn
            ? `bubble-sent text-white ${showTail ? "rounded-bubble-sent" : "rounded-2xl rounded-br-md"}`
            : `bubble-received text-foreground ${showTail ? "rounded-bubble-received" : "rounded-2xl rounded-bl-md"}`
        } ${message.pending ? "opacity-70" : ""}`}
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
          {isOwn && (
            message.pending ? (
              <MessagePendingIcon />
            ) : (
              <MessageStatusTicks status={overallStatus} />
            )
          )}
        </div>
      </div>
    </div>
  );
}