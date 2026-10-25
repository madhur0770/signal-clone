"use client";

import { useState } from "react";
import { Check, Clock, Copy, CornerUpLeft, FileText, Smile } from "lucide-react";

import { resolveAttachmentUrl } from "@/lib/api";
import {
  formatClockTime,
  formatCountdown,
  formatFileSize,
  getOverallStatus,
  groupReactions,
} from "@/lib/utils";
import type { ClientMessage } from "@/store/helpers";

export const QUICK_REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🙏"];

function MessageStatusTicks({ status }: { status: "sent" | "delivered" | "read" }) {
  const isRead = status === "read";
  const showDouble = status === "delivered" || status === "read";
  return (
    <svg
      width="16"
      height="11"
      viewBox="0 0 16 11"
      fill="none"
      className={isRead ? "text-sky-300" : "text-white/70"}
      role="img"
      aria-label={status}
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
      role="img"
      aria-label="sending"
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
  currentUserId: number;
  nowMs: number;
  showTail?: boolean;
  showSender?: boolean;
  onReply?: (message: ClientMessage) => void;
  onReact?: (message: ClientMessage, emoji: string) => void;
  onJumpTo?: (messageId: number) => void;
}

export default function MessageBubble({
  message,
  isOwn,
  currentUserId,
  nowMs,
  showTail = true,
  showSender = false,
  onReply,
  onReact,
  onJumpTo,
}: MessageBubbleProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const time = formatClockTime(message.created_at);
  const overallStatus = getOverallStatus(message);
  const reactions = groupReactions(message.reactions, currentUserId);
  const attachmentUrl = resolveAttachmentUrl(message.attachment_url);
  const isImage = message.type === "image" && attachmentUrl;
  const isFile = message.type === "file" || (message.type === "image" && !attachmentUrl);
  const canInteract = !message.pending && message.id > 0;
  const muted = isOwn ? "text-white/70" : "text-muted";

  return (
    <div
      className={`group flex items-end gap-1 ${isOwn ? "flex-row-reverse" : "flex-row"}`}
      data-message-id={message.id}
    >
      <div className="min-w-0 max-w-[85%] md:max-w-[75%]">
        {showSender && !isOwn && (
          <p className="mb-0.5 ml-3 text-xs font-medium text-muted">
            {message.sender.display_name}
          </p>
        )}
        <div
          className={`relative px-3 py-2 ${
            isOwn
              ? `bubble-sent text-white ${showTail ? "rounded-bubble-sent" : "rounded-2xl rounded-br-md"}`
              : `bubble-received text-foreground ${showTail ? "rounded-bubble-received" : "rounded-2xl rounded-bl-md"}`
          } ${message.pending ? "opacity-70" : ""}`}
        >
          {message.reply_to && (
            <button
              type="button"
              onClick={() => onJumpTo?.(message.reply_to!.id)}
              className={`mb-1.5 block w-full overflow-hidden rounded-lg border-l-4 px-2.5 py-1.5 text-left text-xs ${
                isOwn
                  ? "border-white/70 bg-white/15"
                  : "border-accent bg-black/[0.05] dark:bg-white/[0.08]"
              }`}
            >
              <span className="block truncate font-semibold">
                {message.reply_to.sender_id === currentUserId
                  ? "You"
                  : message.reply_to.sender_name}
              </span>
              <span className="block truncate opacity-80">
                {message.reply_to.content ||
                  message.reply_to.attachment_name ||
                  (message.reply_to.type === "image" ? "Photo" : "Attachment")}
              </span>
            </button>
          )}
          {message.reply_to_message_id && !message.reply_to && (
            <p className={`mb-1.5 text-xs italic ${muted}`}>Original message unavailable</p>
          )}

          {isImage && (
            <a href={attachmentUrl} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachmentUrl}
                alt={message.attachment_name ?? "Photo"}
                className="mb-1 max-h-72 w-full max-w-xs rounded-xl object-cover"
              />
            </a>
          )}
          {isFile && (
            <a
              href={attachmentUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              download={message.attachment_name ?? undefined}
              className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-2 ${
                isOwn ? "bg-white/15" : "bg-black/[0.05] dark:bg-white/[0.08]"
              }`}
            >
              <FileText className="h-6 w-6 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {message.attachment_name ?? "File"}
                </span>
                <span className={`block text-xs ${muted}`}>
                  {formatFileSize(message.attachment_size)}
                </span>
              </span>
            </a>
          )}
          {message.uploadProgress !== undefined && message.uploadProgress < 1 && (
            <div className="mb-1 h-1 overflow-hidden rounded-full bg-white/30">
              <div
                className="h-full bg-white transition-all"
                style={{ width: `${Math.round(message.uploadProgress * 100)}%` }}
              />
            </div>
          )}

          {message.content && (
            <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
              {message.content}
            </p>
          )}

          <div className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${muted}`}>
            {message.expires_at && (
              <span
                className="flex items-center gap-0.5"
                title="Disappearing message"
                data-testid="expiry"
              >
                <Clock className="h-3 w-3" />
                {formatCountdown(message.expires_at, nowMs)}
              </span>
            )}
            <span>{time}</span>
            {isOwn &&
              (message.pending ? (
                <MessagePendingIcon />
              ) : (
                <MessageStatusTicks status={overallStatus} />
              ))}
          </div>
        </div>

        {reactions.length > 0 && (
          <div className={`-mt-1 flex flex-wrap gap-1 px-2 ${isOwn ? "justify-end" : ""}`}>
            {reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                disabled={!canInteract}
                onClick={() => onReact?.(message, reaction.emoji)}
                aria-label={`${reaction.emoji} ${reaction.count}`}
                aria-pressed={reaction.mine}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs shadow-sm ${
                  reaction.mine
                    ? "border-accent bg-accent/15 text-foreground"
                    : "border-border bg-panel text-foreground"
                }`}
              >
                <span>{reaction.emoji}</span>
                {reaction.count > 1 && <span>{reaction.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {canInteract && (
        <div
          className={`relative flex shrink-0 items-center gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-60 ${
            pickerOpen ? "!opacity-100" : ""
          }`}
        >
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            aria-label="React"
            className="rounded-full p-1.5 text-muted hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.1]"
          >
            <Smile className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onReply?.(message)}
            aria-label="Reply"
            className="rounded-full p-1.5 text-muted hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.1]"
          >
            <CornerUpLeft className="h-4 w-4" />
          </button>
          {message.content && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(message.content);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* clipboard unavailable (insecure context); nothing to do */
                }
              }}
              aria-label={copied ? "Copied" : "Copy text"}
              className="rounded-full p-1.5 text-muted hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.1]"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          )}
          {pickerOpen && (
            <div
              role="menu"
              className={`absolute bottom-full z-20 mb-1 flex gap-1 rounded-full border border-border bg-panel px-2 py-1 shadow-lg ${
                isOwn ? "right-0" : "left-0"
              }`}
            >
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onReact?.(message, emoji);
                    setPickerOpen(false);
                  }}
                  className="rounded-full p-1 text-lg transition hover:scale-125"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
