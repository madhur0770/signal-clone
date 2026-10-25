"use client";

import { useEffect } from "react";

import { getConversationTitle, getLastMessagePreview } from "@/lib/utils";
import { wsClient } from "@/lib/ws";
import { useStore } from "@/store/useStore";
import type { DeliveryStatus, Message, Reaction, User } from "@/types";

/** Routes realtime server events into the store. Subscribes once per session. */
export default function WebSocketBridge() {
  const token = useStore((s) => s.token);

  useEffect(() => {
    if (!token) return;
    const store = () => useStore.getState();

    const unsubs = [
      wsClient.on("open", (data) => {
        // After a reconnect we may have missed events, so reload instead of trusting the cache.
        if (data.reconnect) store().resync();
      }),

      wsClient.on("message", (data) => {
        const message = data.message as Message | undefined;
        const me = store().user;
        if (!message || !me) return;

        const alreadyHave = store().messagesByConversation[message.conversation_id]?.some(
          (m) => m.id === message.id
        );
        store().addIncomingMessage(message);

        const isActive = store().activeConversationId === message.conversation_id;
        if (!alreadyHave && message.sender_id !== me.id && !isActive) {
          const conversation = store().conversations.find(
            (c) => c.id === message.conversation_id
          );
          store().addToast(
            conversation ? getConversationTitle(conversation, me.id) : "New message",
            getLastMessagePreview(message)
          );
        }
      }),

      wsClient.on("messages_status", (data) => {
        store().applyStatuses(
          data.conversation_id as number,
          data.message_ids as number[],
          data.user_id as number,
          data.status as DeliveryStatus
        );
      }),

      wsClient.on("message_status", (data) => {
        store().applyStatuses(
          data.conversation_id as number,
          [data.message_id as number],
          data.user_id as number,
          data.status as DeliveryStatus
        );
      }),

      wsClient.on("reaction", (data) => {
        store().setMessageReactions(
          data.conversation_id as number,
          data.message_id as number,
          data.reactions as Reaction[]
        );
      }),

      wsClient.on("messages_expired", (data) => {
        store().removeMessages(
          data.conversation_id as number,
          data.message_ids as number[]
        );
      }),

      wsClient.on("typing", (data) => {
        const conversationId = data.conversation_id as number;
        const userId = data.user_id as number;
        if (conversationId && userId) store().setTyping(conversationId, userId);
      }),

      wsClient.on("presence", (data) => {
        store().applyUserUpdate({
          id: data.user_id as number,
          is_online: data.is_online as boolean,
          last_seen: (data.last_seen as string | null) ?? null,
        });
      }),

      wsClient.on("user_updated", (data) => {
        const user = data.user as User | undefined;
        if (user) store().applyUserUpdate(user);
      }),

      // Anything that changes a conversation's shape: reload the (single-request) list.
      ...["conversation_created", "conversation_updated", "member_added"].map((type) =>
        wsClient.on(type, () => {
          store().loadConversations().catch(() => undefined);
        })
      ),

      wsClient.on("member_removed", (data) => {
        const conversationId = data.conversation_id as number;
        if (data.removed_user_id === store().user?.id) {
          // Leaving yourself already dropped it locally; only announce being removed by others.
          const stillListed = store().conversations.some((c) => c.id === conversationId);
          store().dropConversation(conversationId);
          if (stillListed) {
            store().addToast("Removed from group", "You're no longer in that conversation.");
          }
        } else {
          store().loadConversations().catch(() => undefined);
        }
      }),
    ];

    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [token]);

  return null;
}
