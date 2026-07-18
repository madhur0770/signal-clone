"use client";

import { useRef, useState } from "react";
import { Send } from "lucide-react";

import { wsClient } from "@/lib/ws";

interface MessageInputProps {
  onSend: (content: string) => void;
  conversationId: number;
  disabled?: boolean;
}

export default function MessageInput({
  onSend,
  conversationId,
  disabled,
}: MessageInputProps) {
  const [text, setText] = useState("");
  const typingRef = useRef(false);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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

  return (
    <div className="border-t border-border bg-panel px-6 py-4">
      <div className="mx-auto flex max-w-3xl items-end gap-3">
        <textarea
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message"
          rows={1}
          disabled={disabled}
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-[15px] text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-md transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Send message"
        >
          <Send className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
