"use client";

import { useEffect } from "react";

import { getMessages } from "@/lib/api";
import { getLastMessagePreview, getUnreadCount } from "@/lib/utils";
import { wsClient } from "@/lib/ws";
import { useStore } from "@/store/useStore";

export default function WebSocketBridge() {
  const token = useStore((s) => s.token);
  const user = useStore((s) => s.user);
  const setTyping = useStore((s) => s.setTyping);
  const loadConversations = useStore((s) => s.loadConversations);

  useEffect(() => {
    if (!token) return;

    const unsubMessage = wsClient.on("message", async (data) => {
      const payload = data.message as {
        id: number;
        conversation_id: number;
      } | undefined;

      if (!payload || !user) return;

      try {
        const messages = await getMessages(payload.conversation_id);
        const last = messages[messages.length - 1];
        useStore.setState((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [payload.conversation_id]: messages,
          },
          previews: last
            ? {
                ...state.previews,
                [payload.conversation_id]: {
                  lastMessage: getLastMessagePreview(last),
                  lastMessageAt: last.created_at,
                  unreadCount: getUnreadCount(messages, user.id),
                },
              }
            : state.previews,
        }));
      } catch {
        // ignore
      }

      loadConversations();
    });

    const unsubTyping = wsClient.on("typing", (data) => {
      const conversationId = data.conversation_id as number;
      const userId = data.user_id as number;
      if (conversationId && userId) {
        setTyping(conversationId, userId);
      }
    });

    return () => {
      unsubMessage();
      unsubTyping();
    };
  }, [token, user, setTyping, loadConversations]);

  return null;
}
