"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Paperclip, Send, X } from "lucide-react";

import { formatFileSize } from "@/lib/utils";
import { wsClient } from "@/lib/ws";
import type { ClientMessage } from "@/store/helpers";

interface MessageInputProps {
  onSend: (content: string) => void;
  onAttach: (file: File, caption: string) => void;
  conversationId: number;
  currentUserId: number;
  replyingTo: ClientMessage | null;
  onCancelReply: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

export default function MessageInput({
  onSend,
  onAttach,
  conversationId,
  currentUserId,
  replyingTo,
  onCancelReply,
  disabled,
  disabledReason,
}: MessageInputProps) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const typingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Grow with the content up to the CSS max-height.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Replying focuses the box so you can just start typing.
  useEffect(() => {
    if (replyingTo) textareaRef.current?.focus();
  }, [replyingTo]);

  const canSend = !disabled && (file !== null || text.trim().length > 0);

  const handleSend = () => {
    if (!canSend) return;
    if (file) {
      onAttach(file, text.trim());
      setFile(null);
    } else {
      onSend(text.trim());
    }
    setText("");
    typingRef.current = false;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape") {
      if (replyingTo) onCancelReply();
      else if (file) setFile(null);
    }
  };

  const handleChange = (value: string) => {
    setText(value);
    if (!typingRef.current && value.length > 0) {
      typingRef.current = true;
      wsClient.sendTyping(conversationId);
      setTimeout(() => {
        typingRef.current = false;
      }, 2000);
    }
  };

  if (disabled && disabledReason) {
    return (
      <div className="border-t border-border bg-panel px-6 py-4 text-center text-sm text-muted">
        {disabledReason}
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-panel px-3 py-3 md:px-6 md:py-4">
      <div className="mx-auto max-w-3xl">
        {replyingTo && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border-l-4 border-accent bg-black/[0.04] px-3 py-2 text-sm dark:bg-white/[0.06]">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-accent">
                Replying to{" "}
                {replyingTo.sender_id === currentUserId
                  ? "yourself"
                  : replyingTo.sender.display_name}
              </p>
              <p className="truncate text-foreground/80">
                {replyingTo.content || replyingTo.attachment_name || "Attachment"}
              </p>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              aria-label="Cancel reply"
              className="rounded-full p-1 text-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {file && (
          <div className="mb-2 flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
            <FileText className="h-5 w-5 shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
              <p className="text-xs text-muted">{formatFileSize(file.size)}</p>
            </div>
            <button
              type="button"
              onClick={() => setFile(null)}
              aria-label="Remove attachment"
              className="rounded-full p-1 text-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2 md:gap-3">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            data-testid="file-input"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) setFile(picked);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            aria-label="Attach a file"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-black/[0.05] hover:text-foreground disabled:opacity-40 dark:hover:bg-white/[0.08]"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={file ? "Add a caption" : "Message"}
            rows={1}
            disabled={disabled}
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-[15px] text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-md transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Send message"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
