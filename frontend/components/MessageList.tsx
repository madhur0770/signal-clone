"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import MessageBubble from "@/components/MessageBubble";
import { formatDayLabel, isExpired, isSameLocalDay } from "@/lib/utils";
import { useStore } from "@/store/useStore";
import type { ClientMessage } from "@/store/helpers";
import type { User } from "@/types";

interface MessageListProps {
  conversationId: number;
  messages: ClientMessage[];
  currentUser: User;
  isGroup: boolean;
  hasMore: boolean;
}

const NEAR_BOTTOM_PX = 120;

export default function MessageList({
  conversationId,
  messages,
  currentUser,
  isGroup,
  hasMore,
}: MessageListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const previousLastId = useRef<number | null>(null);
  const previousHeight = useRef<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [showJump, setShowJump] = useState(false);

  const setReplyingTo = useStore((s) => s.setReplyingTo);
  const toggleReaction = useStore((s) => s.toggleReaction);
  const loadOlderMessages = useStore((s) => s.loadOlderMessages);

  // A ticking clock hides disappearing messages the moment they expire, and drives countdowns.
  const hasTimed = messages.some((m) => m.expires_at);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!hasTimed) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasTimed]);

  const visible = useMemo(
    () => messages.filter((m) => !isExpired(m, nowMs)),
    [messages, nowMs]
  );

  // Follow new messages only if the reader is already at the bottom (or sent it themselves).
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const last = visible[visible.length - 1];

    if (previousHeight.current !== null) {
      // Older messages were prepended: keep what the reader was looking at in place.
      scroller.scrollTop += scroller.scrollHeight - previousHeight.current;
      previousHeight.current = null;
    } else if (last && last.id !== previousLastId.current) {
      if (nearBottomRef.current || last.sender_id === currentUser.id) {
        bottomRef.current?.scrollIntoView({ behavior: previousLastId.current ? "smooth" : "auto" });
      }
    }
    previousLastId.current = last?.id ?? null;
  }, [visible, currentUser.id]);

  const handleScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    nearBottomRef.current = distance < NEAR_BOTTOM_PX;
    setShowJump(distance > NEAR_BOTTOM_PX * 3);
  };

  const scrollToBottom = () => bottomRef.current?.scrollIntoView({ behavior: "smooth" });

  const handleLoadOlder = async () => {
    setLoadingOlder(true);
    previousHeight.current = scrollerRef.current?.scrollHeight ?? null;
    try {
      await loadOlderMessages(conversationId);
    } catch {
      previousHeight.current = null;
    } finally {
      setLoadingOlder(false);
    }
  };

  const jumpTo = useCallback((messageId: number) => {
    const element = scrollerRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"]`
    );
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("message-flash");
    setTimeout(() => element.classList.remove("message-flash"), 1500);
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-3 py-4 md:px-6"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {hasMore && (
          <button
            type="button"
            onClick={handleLoadOlder}
            disabled={loadingOlder}
            className="mx-auto mb-2 rounded-full border border-border bg-panel px-4 py-1.5 text-xs font-medium text-muted transition hover:text-foreground disabled:opacity-50"
          >
            {loadingOlder ? "Loading…" : "Load earlier messages"}
          </button>
        )}

        {visible.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">
            No messages yet. Say hello!
          </p>
        )}

        {visible.map((message, index) => {
          const isOwn = message.sender_id === currentUser.id;
          const prev = visible[index - 1];
          const next = visible[index + 1];
          const newDay = !prev || !isSameLocalDay(prev.created_at, message.created_at);
          const sameAsPrev = !newDay && prev?.sender_id === message.sender_id;
          const sameAsNext =
            !!next &&
            next.sender_id === message.sender_id &&
            isSameLocalDay(next.created_at, message.created_at);

          return (
            <div key={message.id}>
              {newDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-black/[0.06] px-3 py-1 text-xs font-medium text-muted dark:bg-white/[0.08]">
                    {formatDayLabel(message.created_at)}
                  </span>
                </div>
              )}
              <div className={sameAsPrev ? "mt-0.5" : "mt-3"}>
                <MessageBubble
                  message={message}
                  isOwn={isOwn}
                  currentUserId={currentUser.id}
                  nowMs={nowMs}
                  showTail={!sameAsNext}
                  showSender={isGroup && !sameAsPrev}
                  onReply={setReplyingTo}
                  onReact={toggleReaction}
                  onJumpTo={jumpTo}
                />
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
      {showJump && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Scroll to latest message"
          className="absolute bottom-4 right-4 rounded-full border border-border bg-panel p-2 text-muted shadow-lg transition hover:text-foreground md:right-8"
        >
          <ChevronDown className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
