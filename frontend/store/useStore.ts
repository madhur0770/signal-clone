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
  logout as apiLogout,
  markConversationRead,
  removeReaction,
  sendMessage as apiSendMessage,
  setAuthToken,
  setReaction,
  setUnauthorizedHandler,
  updateConversation,
  updateProfile as apiUpdateProfile,
  uploadAttachment,
  verifyOtp,
} from "@/lib/api";
import {
  getLastMessagePreview,
  getUnreadCount,
  MAX_ATTACHMENT_BYTES,
  formatFileSize,
} from "@/lib/utils";
import { wsClient } from "@/lib/ws";
import {
  appendUnique,
  applyReactions,
  applyStatus,
  mergeUserEverywhere,
  prependOlder,
  replyPreviewFor,
  sortConversations,
  toggleReactionList,
  type ClientMessage,
} from "@/store/helpers";
import type {
  Contact,
  Conversation,
  ConversationPreview,
  DeliveryStatus,
  Message,
  Reaction,
  User,
} from "@/types";

export type { ClientMessage } from "@/store/helpers";

export const PAGE_SIZE = 50;

interface AppState {
  token: string | null;
  user: User | null;
  isHydrated: boolean;
  isLoading: boolean;
  conversations: Conversation[];
  contacts: Contact[];
  activeConversationId: number | null;
  messagesByConversation: Record<number, ClientMessage[]>;
  hasMoreByConversation: Record<number, boolean>;
  previews: Record<number, ConversationPreview>;
  typingByConversation: Record<number, number[]>;
  replyingTo: ClientMessage | null;
  darkMode: boolean;
  toasts: { id: string; title: string; body: string }[];

  setHydrated: () => void;
  setDarkMode: (dark: boolean) => void;
  login: (
    phone: string,
    otp: string,
    username?: string,
    displayName?: string
  ) => Promise<void>;
  logout: (options?: { remote?: boolean }) => void;
  bootstrap: () => Promise<void>;
  resync: () => Promise<void>;
  loadConversations: () => Promise<void>;
  loadContacts: () => Promise<void>;
  selectConversation: (id: number | null) => Promise<void>;
  loadOlderMessages: (conversationId: number) => Promise<void>;
  markActiveRead: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  sendAttachment: (file: File, caption: string) => Promise<void>;
  addIncomingMessage: (message: Message) => void;
  removeMessages: (conversationId: number, messageIds: number[]) => void;
  applyStatuses: (
    conversationId: number,
    messageIds: number[],
    userId: number,
    status: DeliveryStatus
  ) => void;
  setReplyingTo: (message: ClientMessage | null) => void;
  toggleReaction: (message: ClientMessage, emoji: string) => Promise<void>;
  setMessageReactions: (
    conversationId: number,
    messageId: number,
    reactions: Reaction[]
  ) => void;
  applyUserUpdate: (update: Partial<User> & { id: number }) => void;
  updateProfile: (changes: {
    display_name?: string;
    status_message?: string;
  }) => Promise<void>;
  setDisappearTimer: (conversationId: number, seconds: number | null) => Promise<void>;
  dropConversation: (conversationId: number) => void;
  setTyping: (conversationId: number, userId: number) => void;
  startDirectChat: (contactUserId: number) => Promise<Conversation>;
  startGroupChat: (name: string, memberIds: number[]) => Promise<Conversation>;
  addContactById: (contactUserId: number) => Promise<void>;
  addToast: (title: string, body: string) => void;
  removeToast: (id: string) => void;
}

function previewFor(
  message: Message | null | undefined,
  unreadCount: number
): ConversationPreview {
  return {
    lastMessage: message ? getLastMessagePreview(message) : null,
    lastMessageAt: message?.created_at ?? null,
    unreadCount,
  };
}

function bumpConversation(
  conversations: Conversation[],
  conversationId: number,
  updatedAt: string
): Conversation[] {
  return sortConversations(
    conversations.map((c) =>
      c.id === conversationId ? { ...c, updated_at: updatedAt } : c
    )
  );
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => {
      /** Optimistically show `temp`, then swap in what the server returns (or roll back). */
      const dispatchMessage = async (
        temp: ClientMessage,
        send: () => Promise<Message>
      ) => {
        const conversationId = temp.conversation_id;
        const user = get().user;
        if (!user) return;

        set((state) => {
          const updated = [...(state.messagesByConversation[conversationId] ?? []), temp];
          return {
            messagesByConversation: {
              ...state.messagesByConversation,
              [conversationId]: updated,
            },
            previews: {
              ...state.previews,
              [conversationId]: previewFor(temp, 0),
            },
            conversations: bumpConversation(
              state.conversations,
              conversationId,
              temp.created_at
            ),
          };
        });

        try {
          const message = await send();
          set((state) => {
            const existing = state.messagesByConversation[conversationId] ?? [];
            // The websocket push may have delivered the real message before this response.
            const updated = existing.some((m) => m.id === message.id)
              ? existing.filter((m) => m.id !== temp.id)
              : existing.map((m) => (m.id === temp.id ? message : m));
            return {
              messagesByConversation: {
                ...state.messagesByConversation,
                [conversationId]: updated,
              },
              previews: {
                ...state.previews,
                [conversationId]: previewFor(message, 0),
              },
              conversations: bumpConversation(
                state.conversations,
                conversationId,
                message.created_at
              ),
            };
          });
        } catch (error) {
          set((state) => {
            const updated = (state.messagesByConversation[conversationId] ?? []).filter(
              (m) => m.id !== temp.id
            );
            const last = updated[updated.length - 1];
            return {
              messagesByConversation: {
                ...state.messagesByConversation,
                [conversationId]: updated,
              },
              previews: {
                ...state.previews,
                [conversationId]: previewFor(
                  last,
                  getUnreadCount(updated, user.id)
                ),
              },
            };
          });
          throw error;
        }
      };

      const buildTemp = (
        conversationId: number,
        user: User,
        fields: Partial<ClientMessage>
      ): ClientMessage => ({
        id: -Date.now() - Math.floor(Math.random() * 1000),
        conversation_id: conversationId,
        sender_id: user.id,
        content: "",
        type: "text",
        reply_to_message_id: get().replyingTo?.id ?? null,
        reply_to: replyPreviewFor(get().replyingTo),
        created_at: new Date().toISOString(),
        expires_at: null,
        attachment_url: null,
        attachment_name: null,
        attachment_mime: null,
        attachment_size: null,
        sender: user,
        statuses: [],
        reactions: [],
        pending: true,
        ...fields,
      });

      return {
        token: null,
        user: null,
        isHydrated: false,
        isLoading: false,
        conversations: [],
        contacts: [],
        activeConversationId: null,
        messagesByConversation: {},
        hasMoreByConversation: {},
        previews: {},
        typingByConversation: {},
        replyingTo: null,
        darkMode: false,
        toasts: [],

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

        logout: ({ remote = true } = {}) => {
          if (remote && get().token) {
            // Revoke the server-side session; failing to is not worth blocking sign-out for.
            apiLogout().catch(() => undefined);
          }
          wsClient.disconnect();
          setAuthToken(null);
          set({
            token: null,
            user: null,
            conversations: [],
            contacts: [],
            activeConversationId: null,
            messagesByConversation: {},
            hasMoreByConversation: {},
            previews: {},
            typingByConversation: {},
            replyingTo: null,
            toasts: [],
          });
        },

        bootstrap: async () => {
          set({ isLoading: true });
          try {
            const user = await getMe();
            set({ user });
            await Promise.all([get().loadConversations(), get().loadContacts()]);
          } catch (error) {
            // A 401 already signed us out; anything else is a connectivity problem.
            if (get().token) {
              get().addToast("Can't reach the server", "Check your connection and try again.");
            }
            console.error("bootstrap failed", error);
          } finally {
            set({ isLoading: false });
          }
        },

        /** After a dropped connection: refresh everything that may have changed meanwhile. */
        resync: async () => {
          const { activeConversationId, messagesByConversation } = get();
          // Cached histories of other chats may be stale; they reload when opened.
          const kept: Record<number, ClientMessage[]> = {};
          if (activeConversationId != null && messagesByConversation[activeConversationId]) {
            kept[activeConversationId] = messagesByConversation[activeConversationId];
          }
          set({ messagesByConversation: kept });
          try {
            await Promise.all([get().loadConversations(), get().loadContacts()]);
            if (activeConversationId != null) {
              const fresh = await getMessages(activeConversationId, PAGE_SIZE);
              set((state) => ({
                messagesByConversation: {
                  ...state.messagesByConversation,
                  [activeConversationId]: fresh,
                },
                hasMoreByConversation: {
                  ...state.hasMoreByConversation,
                  [activeConversationId]: fresh.length >= PAGE_SIZE,
                },
              }));
              await get().markActiveRead();
            }
          } catch {
            // The next reconnect will try again.
          }
        },

        loadConversations: async () => {
          const conversations = await getConversations();
          const { activeConversationId } = get();
          const previews: Record<number, ConversationPreview> = {};
          for (const conversation of conversations) {
            previews[conversation.id] = previewFor(
              conversation.last_message,
              conversation.id === activeConversationId ? 0 : conversation.unread_count ?? 0
            );
          }
          set({ conversations: sortConversations(conversations), previews });
        },

        loadContacts: async () => {
          const contacts = await getContacts();
          set({ contacts });
        },

        selectConversation: async (id) => {
          set({ activeConversationId: id, typingByConversation: {}, replyingTo: null });
          if (id == null) return;

          if (!get().messagesByConversation[id]) {
            try {
              const messages = await getMessages(id, PAGE_SIZE);
              set((state) => ({
                messagesByConversation: {
                  ...state.messagesByConversation,
                  [id]: messages,
                },
                hasMoreByConversation: {
                  ...state.hasMoreByConversation,
                  [id]: messages.length >= PAGE_SIZE,
                },
              }));
            } catch {
              get().addToast("Couldn't load messages", "Please try again.");
              return;
            }
          }
          await get().markActiveRead();
        },

        loadOlderMessages: async (conversationId) => {
          const existing = get().messagesByConversation[conversationId] ?? [];
          const oldest = existing.find((m) => m.id > 0);
          if (!oldest) return;
          const older = await getMessages(conversationId, PAGE_SIZE, oldest.id);
          set((state) => ({
            messagesByConversation: {
              ...state.messagesByConversation,
              [conversationId]: prependOlder(
                state.messagesByConversation[conversationId] ?? [],
                older
              ),
            },
            hasMoreByConversation: {
              ...state.hasMoreByConversation,
              [conversationId]: older.length >= PAGE_SIZE,
            },
          }));
        },

        /** Tell the server the open conversation is read (one request) and mirror it locally. */
        markActiveRead: async () => {
          const { activeConversationId, user, messagesByConversation, previews } = get();
          if (activeConversationId == null || !user) return;
          const messages = messagesByConversation[activeConversationId] ?? [];
          const hasUnread =
            getUnreadCount(messages, user.id) > 0 ||
            (previews[activeConversationId]?.unreadCount ?? 0) > 0;
          if (!hasUnread) return;

          const conversationId = activeConversationId;
          try {
            const ids = await markConversationRead(conversationId);
            get().applyStatuses(conversationId, ids, user.id, "read");
          } catch {
            return;
          }
          set((state) => ({
            previews: {
              ...state.previews,
              [conversationId]: {
                ...(state.previews[conversationId] ?? previewFor(null, 0)),
                unreadCount: 0,
              },
            },
          }));
        },

        sendMessage: async (content) => {
          const { activeConversationId, user, replyingTo } = get();
          const text = content.trim();
          if (activeConversationId == null || !user || !text) return;

          const temp = buildTemp(activeConversationId, user, { content: text });
          set({ replyingTo: null });
          await dispatchMessage(temp, () =>
            apiSendMessage(activeConversationId, {
              content: text,
              replyToMessageId: replyingTo?.id,
            })
          );
        },

        sendAttachment: async (file, caption) => {
          const { activeConversationId, user, replyingTo } = get();
          if (activeConversationId == null || !user) return;
          if (file.size > MAX_ATTACHMENT_BYTES) {
            throw new Error(
              `That file is too large (max ${formatFileSize(MAX_ATTACHMENT_BYTES)})`
            );
          }

          const isImage = /^image\/(png|jpe?g|gif|webp)$/.test(file.type);
          const localUrl = isImage ? URL.createObjectURL(file) : null;
          const temp = buildTemp(activeConversationId, user, {
            content: caption.trim(),
            type: isImage ? "image" : "file",
            attachment_url: localUrl,
            attachment_name: file.name,
            attachment_mime: file.type || "application/octet-stream",
            attachment_size: file.size,
            uploadProgress: 0,
          });
          set({ replyingTo: null });

          const setProgress = (fraction: number) =>
            set((state) => ({
              messagesByConversation: {
                ...state.messagesByConversation,
                [temp.conversation_id]: (
                  state.messagesByConversation[temp.conversation_id] ?? []
                ).map((m) => (m.id === temp.id ? { ...m, uploadProgress: fraction } : m)),
              },
            }));

          try {
            await dispatchMessage(temp, async () => {
              const attachment = await uploadAttachment(file, setProgress);
              return apiSendMessage(temp.conversation_id, {
                content: caption.trim(),
                type: attachment.type,
                attachment,
                replyToMessageId: replyingTo?.id,
              });
            });
          } finally {
            if (localUrl) URL.revokeObjectURL(localUrl);
          }
        },

        addIncomingMessage: (message) => {
          const { user } = get();
          if (!user) return;
          const conversationId = message.conversation_id;
          const known = get().conversations.some((c) => c.id === conversationId);

          set((state) => {
            const cached = state.messagesByConversation[conversationId];
            if (cached?.some((m) => m.id === message.id)) return state;

            const isActive = state.activeConversationId === conversationId;
            const fromMe = message.sender_id === user.id;
            const previous = state.previews[conversationId]?.unreadCount ?? 0;
            const unread = isActive || fromMe ? 0 : previous + 1;

            return {
              messagesByConversation: cached
                ? {
                    ...state.messagesByConversation,
                    [conversationId]: appendUnique(cached, message),
                  }
                : state.messagesByConversation,
              previews: {
                ...state.previews,
                [conversationId]: previewFor(
                  message,
                  fromMe ? previous : unread
                ),
              },
              conversations: bumpConversation(
                state.conversations,
                conversationId,
                message.created_at
              ),
            };
          });

          if (!known) {
            // First message of a conversation we haven't heard about yet.
            get().loadConversations().catch(() => undefined);
          } else if (
            get().activeConversationId === conversationId &&
            message.sender_id !== user.id
          ) {
            get().markActiveRead();
          }
        },

        removeMessages: (conversationId, messageIds) => {
          const user = get().user;
          const gone = new Set(messageIds);
          set((state) => {
            const cached = state.messagesByConversation[conversationId];
            if (!cached) return state;
            const remaining = cached.filter((m) => !gone.has(m.id));
            const last = remaining[remaining.length - 1];
            return {
              messagesByConversation: {
                ...state.messagesByConversation,
                [conversationId]: remaining,
              },
              previews: {
                ...state.previews,
                [conversationId]: previewFor(
                  last,
                  user ? getUnreadCount(remaining, user.id) : 0
                ),
              },
            };
          });
          if (!(get().messagesByConversation[conversationId]?.length ?? 0)) {
            // Nothing left in memory to build a preview from; ask the server.
            get().loadConversations().catch(() => undefined);
          }
        },

        applyStatuses: (conversationId, messageIds, userId, status) => {
          set((state) => {
            const cached = state.messagesByConversation[conversationId];
            if (!cached) return state;
            const updated = applyStatus(cached, messageIds, userId, status);
            if (updated === cached) return state;
            return {
              messagesByConversation: {
                ...state.messagesByConversation,
                [conversationId]: updated,
              },
            };
          });
        },

        setReplyingTo: (message) => set({ replyingTo: message }),

        toggleReaction: async (message, emoji) => {
          const { user } = get();
          if (!user || message.id < 0) return;
          const before = message.reactions;
          // Tapping the emoji you already used takes it back; any other emoji replaces it.
          const removing = before.some((r) => r.user_id === user.id && r.emoji === emoji);
          const optimistic = toggleReactionList(before, user.id, emoji);

          get().setMessageReactions(message.conversation_id, message.id, optimistic);
          try {
            const confirmed = removing
              ? await removeReaction(message.id)
              : await setReaction(message.id, emoji);
            get().setMessageReactions(message.conversation_id, message.id, confirmed);
          } catch {
            get().setMessageReactions(message.conversation_id, message.id, before);
            get().addToast("Reaction failed", "Your reaction wasn't saved.");
          }
        },

        setMessageReactions: (conversationId, messageId, reactions) => {
          set((state) => {
            const cached = state.messagesByConversation[conversationId];
            if (!cached) return state;
            return {
              messagesByConversation: {
                ...state.messagesByConversation,
                [conversationId]: applyReactions(cached, messageId, reactions),
              },
            };
          });
        },

        applyUserUpdate: (update) => {
          set((state) => mergeUserEverywhere(update, state));
        },

        updateProfile: async (changes) => {
          const user = await apiUpdateProfile(changes);
          get().applyUserUpdate(user);
        },

        setDisappearTimer: async (conversationId, seconds) => {
          const updated = await updateConversation(conversationId, {
            disappear_after_seconds: seconds ?? 0,
          });
          set((state) => ({
            conversations: state.conversations.map((c) =>
              c.id === conversationId
                ? {
                    ...c,
                    disappear_after_seconds: updated.disappear_after_seconds,
                    name: updated.name,
                    members: updated.members,
                  }
                : c
            ),
          }));
        },

        dropConversation: (conversationId) => {
          set((state) => {
            const messagesByConversation = { ...state.messagesByConversation };
            const previews = { ...state.previews };
            delete messagesByConversation[conversationId];
            delete previews[conversationId];
            return {
              conversations: state.conversations.filter((c) => c.id !== conversationId),
              messagesByConversation,
              previews,
              activeConversationId:
                state.activeConversationId === conversationId
                  ? null
                  : state.activeConversationId,
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
            conversations: state.conversations.some((c) => c.id === conversation.id)
              ? state.conversations
              : [conversation, ...state.conversations],
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
            conversations: state.conversations.some((c) => c.id === conversation.id)
              ? state.conversations
              : [conversation, ...state.conversations],
          }));
          return conversation;
        },

        addContactById: async (contactUserId) => {
          const contact = await addContact(contactUserId);
          set((state) => ({ contacts: [...state.contacts, contact] }));
        },

        addToast: (title, body) => {
          const id = crypto.randomUUID();
          set((state) => ({ toasts: [...state.toasts, { id, title, body }] }));
          setTimeout(() => get().removeToast(id), 4000);
        },

        removeToast: (id) =>
          set((state) => ({
            toasts: state.toasts.filter((t) => t.id !== id),
          })),
      };
    },
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

// A 401 from any request means the session was revoked or expired: sign out locally.
setUnauthorizedHandler(() => {
  if (useStore.getState().token) {
    useStore.getState().logout({ remote: false });
  }
});
