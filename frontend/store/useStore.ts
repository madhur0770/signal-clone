"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  addContact,
  createConversation,
  getContacts,
  getConversations,
  getMe,
  getMessages,
  sendMessage as apiSendMessage,
  setAuthToken,
  updateMessageStatus,
  verifyOtp,
} from "@/lib/api";
import { getLastMessagePreview, getUnreadCount } from "@/lib/utils";
import { wsClient } from "@/lib/ws";
import type {
  Contact,
  Conversation,
  ConversationPreview,
  Message,
  User,
} from "@/types";

const EMPTY_MESSAGES: Message[] = [];

interface AppState {
  token: string | null;
  user: User | null;
  isHydrated: boolean;
  isLoading: boolean;
  conversations: Conversation[];
  contacts: Contact[];
  activeConversationId: number | null;
  messagesByConversation: Record<number, Message[]>;
  previews: Record<number, ConversationPreview>;
  typingByConversation: Record<number, number[]>;
  darkMode: boolean;

  setHydrated: () => void;
  setDarkMode: (dark: boolean) => void;
  login: (
    phone: string,
    otp: string,
    username?: string,
    displayName?: string
  ) => Promise<void>;
  logout: () => void;
  bootstrap: () => Promise<void>;
  loadConversations: () => Promise<void>;
  loadContacts: () => Promise<void>;
  selectConversation: (id: number) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  addIncomingMessage: (message: Message) => void;
  setTyping: (conversationId: number, userId: number) => void;
  startDirectChat: (contactUserId: number) => Promise<Conversation>;
  startGroupChat: (name: string, memberIds: number[]) => Promise<Conversation>;
  addContactById: (contactUserId: number) => Promise<void>;
}

function updatePreview(
  previews: Record<number, ConversationPreview>,
  conversationId: number,
  message: Message,
  userId: number,
  messages: Message[]
): Record<number, ConversationPreview> {
  return {
    ...previews,
    [conversationId]: {
      lastMessage: getLastMessagePreview(message),
      lastMessageAt: message.created_at,
      unreadCount: getUnreadCount(messages, userId),
    },
  };
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isHydrated: false,
      isLoading: false,
      conversations: [],
      contacts: [],
      activeConversationId: null,
      messagesByConversation: {},
      previews: {},
      typingByConversation: {},
      darkMode: false,

      setHydrated: () => set({ isHydrated: true }),

      setDarkMode: (dark) => {
        set({ darkMode: dark });
        document.documentElement.classList.toggle("dark", dark);
      },

      login: async (phone, otp, username, displayName) => {
        const res = await verifyOtp(phone, otp, username, displayName);
        setAuthToken(res.access_token);
        set({ token: res.access_token, user: res.user });
        wsClient.connect(res.access_token);
        await get().bootstrap();
      },

      logout: () => {
        wsClient.disconnect();
        setAuthToken(null);
        set({
          token: null,
          user: null,
          conversations: [],
          contacts: [],
          activeConversationId: null,
          messagesByConversation: {},
          previews: {},
          typingByConversation: {},
        });
      },

      bootstrap: async () => {
        set({ isLoading: true });
        try {
          const user = await getMe();
          set({ user });
          await get().loadConversations();
          await get().loadContacts();
        } finally {
          set({ isLoading: false });
        }
      },

      loadConversations: async () => {
        const conversations = await getConversations();
        set({ conversations });

        const { user } = get();
        if (!user) return;

        const previews: Record<number, ConversationPreview> = {};
        await Promise.all(
          conversations.map(async (conversation) => {
            try {
              const messages = await getMessages(conversation.id, 50);
              const last = messages[messages.length - 1];
              if (last) {
                previews[conversation.id] = {
                  lastMessage: getLastMessagePreview(last),
                  lastMessageAt: last.created_at,
                  unreadCount: getUnreadCount(messages, user.id),
                };
              }
            } catch {
              // skip failed preview fetch
            }
          })
        );
        set((state) => ({ previews: { ...state.previews, ...previews } }));
      },

      loadContacts: async () => {
        const contacts = await getContacts();
        set({ contacts });
      },

      selectConversation: async (id) => {
        set({ activeConversationId: id, typingByConversation: {} });
        const { user, messagesByConversation } = get();
        if (!user) return;

        if (!messagesByConversation[id]) {
          const messages = await getMessages(id);
          set((state) => {
            const last = messages[messages.length - 1];
            return {
              messagesByConversation: {
                ...state.messagesByConversation,
                [id]: messages,
              },
              previews: last
                ? updatePreview(state.previews, id, last, user.id, messages)
                : state.previews,
            };
          });

          for (const msg of messages) {
            if (msg.sender_id !== user.id) {
              const myStatus = msg.statuses.find((s) => s.user_id === user.id);
              if (myStatus && myStatus.status !== "read") {
                await updateMessageStatus(msg.id, "read");
              }
            }
          }

          const refreshed = await getMessages(id);
          set((state) => {
            const last = refreshed[refreshed.length - 1];
            return {
              messagesByConversation: {
                ...state.messagesByConversation,
                [id]: refreshed,
              },
              previews: last
                ? updatePreview(state.previews, id, last, user.id, refreshed)
                : state.previews,
            };
          });
        }
      },

      sendMessage: async (content) => {
        const { activeConversationId, user } = get();
        if (!activeConversationId || !user || !content.trim()) return;

        const message = await apiSendMessage(
          activeConversationId,
          content.trim()
        );
        set((state) => {
          const existing = state.messagesByConversation[activeConversationId] ?? [];
          const updated = [...existing, message];
          return {
            messagesByConversation: {
              ...state.messagesByConversation,
              [activeConversationId]: updated,
            },
            previews: updatePreview(
              state.previews,
              activeConversationId,
              message,
              user.id,
              updated
            ),
            conversations: state.conversations
              .map((c) =>
                c.id === activeConversationId
                  ? { ...c, updated_at: message.created_at }
                  : c
              )
              .sort(
                (a, b) =>
                  new Date(b.updated_at).getTime() -
                  new Date(a.updated_at).getTime()
              ),
          };
        });
      },

      addIncomingMessage: (message) => {
        const { user, activeConversationId } = get();
        if (!user) return;

        set((state) => {
          const existing = state.messagesByConversation[message.conversation_id] ?? [];
          if (existing.some((m) => m.id === message.id)) return state;

          const updated = [...existing, message];
          const isActive = activeConversationId === message.conversation_id;

          if (isActive && message.sender_id !== user.id) {
            updateMessageStatus(message.id, "read");
          }

          return {
            messagesByConversation: {
              ...state.messagesByConversation,
              [message.conversation_id]: updated,
            },
            previews: updatePreview(
              state.previews,
              message.conversation_id,
              message,
              user.id,
              updated
            ),
            conversations: state.conversations
              .map((c) =>
                c.id === message.conversation_id
                  ? { ...c, updated_at: message.created_at }
                  : c
              )
              .sort(
                (a, b) =>
                  new Date(b.updated_at).getTime() -
                  new Date(a.updated_at).getTime()
              ),
          };
        });
      },

      setTyping: (conversationId, userId) => {
        set((state) => {
          const current = state.typingByConversation[conversationId] ?? [];
          if (current.includes(userId)) return state;
          return {
            typingByConversation: {
              ...state.typingByConversation,
              [conversationId]: [...current, userId],
            },
          };
        });
        setTimeout(() => {
          set((state) => ({
            typingByConversation: {
              ...state.typingByConversation,
              [conversationId]: (
                state.typingByConversation[conversationId] ?? []
              ).filter((id) => id !== userId),
            },
          }));
        }, 3000);
      },

      startDirectChat: async (contactUserId) => {
        const conversation = await createConversation({
          type: "direct",
          member_ids: [contactUserId],
        });
        set((state) => ({
          conversations: [conversation, ...state.conversations],
        }));
        return conversation;
      },

      startGroupChat: async (name, memberIds) => {
        const conversation = await createConversation({
          type: "group",
          name,
          member_ids: memberIds,
        });
        set((state) => ({
          conversations: [conversation, ...state.conversations],
        }));
        return conversation;
      },

      addContactById: async (contactUserId) => {
        const contact = await addContact(contactUserId);
        set((state) => ({ contacts: [...state.contacts, contact] }));
      },
    }),
    {
      name: "signal-clone-store",
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        darkMode: state.darkMode,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.token) {
          setAuthToken(state.token);
          wsClient.connect(state.token);
        }
        state?.setHydrated();
      },
    }
  )
);