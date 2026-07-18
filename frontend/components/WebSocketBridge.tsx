"use client";

import { useEffect } from "react";

import { getMessages, updateMessageStatus } from "@/lib/api";
import { getConversationTitle, getLastMessagePreview, getUnreadCount } from "@/lib/utils";
import { wsClient } from "@/lib/ws";
import { useStore } from "@/store/useStore";

export default function WebSocketBridge() {
  const token = useStore((s) => s.token);
  const user = useStore((s) => s.user);
  const setTyping = useStore((s) => s.setTyping);
  const loadConversations = useStore((s) => s.loadConversations);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const addToast = useStore((s) => s.addToast);

  useEffect(() => {
    if (!token) return;

    const unsubMessage = wsClient.on("message", async (data) => {
      const payload = data.message as {
        id: number;
        conversation_id: number;
        sender_id: number;
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

        // Handle active conversation read marking
        if (payload.conversation_id === activeConversationId && payload.sender_id !== user.id) {
          updateMessageStatus(payload.id, "read");
        }

        if (last && payload.conversation_id !== activeConversationId && last.sender_id !== user.id) {
          const conversation = useStore.getState().conversations.find((c) => c.id === payload.conversation_id);
          const title = conversation ? getConversationTitle(conversation, user.id) : "New message";
          const body = getLastMessagePreview(last);
          addToast(title, body);
        }
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

    const unsubConversationCreated = wsClient.on("conversation_created", () => {
      loadConversations();
    });

    const unsubStatus = wsClient.on("message_status", (data) => {
      const { message_id, user_id, status, conversation_id } = data as {
        message_id: number;
        user_id: number;
        status: string;
        conversation_id: number;
      };

      if (!user) return;

      useStore.setState((state) => {
        const messages = state.messagesByConversation[conversation_id] ?? [];
        const updatedMessages = messages.map((msg) => {
          if (msg.id !== message_id) return msg;
          return {
            ...msg,
            statuses: msg.statuses.map((s) =>
              s.user_id === user_id ? { ...s, status: status as any } : s
            ),
          };
        });

        return {
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversation_id]: updatedMessages,
          },
          previews: {
            ...state.previews,
            [conversation_id]: {
              ...state.previews[conversation_id],
              unreadCount: getUnreadCount(updatedMessages, user.id),
            },
          },
        };
      });
    });

    return () => {
      unsubMessage();
      unsubTyping();
      unsubConversationCreated();
      unsubStatus();
    };
  }, [token, user, setTyping, loadConversations, activeConversationId, addToast]);

  return null;
}