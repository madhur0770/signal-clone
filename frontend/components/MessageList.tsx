"use client";

import { useEffect, useRef } from "react";

import MessageBubble from "@/components/MessageBubble";
import type { Message, User } from "@/types";

interface MessageListProps {
  messages: Message[];
  currentUser: User;
}

export default function MessageList({ messages, currentUser }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {messages.map((message, index) => {
          const isOwn = message.sender_id === currentUser.id;
          const prev = messages[index - 1];
          const next = messages[index + 1];
          const sameAsPrev = prev?.sender_id === message.sender_id;
          const sameAsNext = next?.sender_id === message.sender_id;

          return (
            <div key={message.id} className={sameAsPrev ? "mt-0.5" : "mt-3"}>
              <MessageBubble
                message={message}
                isOwn={isOwn}
                showTail={!sameAsNext}
              />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
