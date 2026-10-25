import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeConversation, makeMessage, makeUser } from "@/tests/factories";

vi.mock("@/lib/api", () => ({
  addContact: vi.fn(),
  createConversation: vi.fn(),
  getContacts: vi.fn().mockResolvedValue([]),
  getConversations: vi.fn().mockResolvedValue([]),
  getMe: vi.fn(),
  getMessages: vi.fn().mockResolvedValue([]),
  logout: vi.fn().mockResolvedValue(undefined),
  markConversationRead: vi.fn().mockResolvedValue([]),
  removeReaction: vi.fn(),
  sendMessage: vi.fn(),
  setAuthToken: vi.fn(),
  setReaction: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  updateConversation: vi.fn(),
  updateProfile: vi.fn(),
  uploadAttachment: vi.fn(),
  verifyOtp: vi.fn(),
}));
vi.mock("@/lib/ws", () => ({
  wsClient: { connect: vi.fn(), disconnect: vi.fn(), sendTyping: vi.fn(), on: vi.fn() },
}));

import * as api from "@/lib/api";
import { wsClient } from "@/lib/ws";

import { useStore } from "./useStore";

const me = makeUser({ id: 1 });
const CID = 10;

function resetStore(extra: Partial<ReturnType<typeof useStore.getState>> = {}) {
  useStore.setState({
    token: "tok",
    user: me,
    conversations: [makeConversation({ id: CID })],
    contacts: [],
    activeConversationId: CID,
    messagesByConversation: { [CID]: [] },
    hasMoreByConversation: {},
    previews: {},
    typingByConversation: {},
    replyingTo: null,
    toasts: [],
    ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getMessages).mockResolvedValue([]);
  vi.mocked(api.getConversations).mockResolvedValue([]);
  vi.mocked(api.getContacts).mockResolvedValue([]);
  vi.mocked(api.markConversationRead).mockResolvedValue([]);
  vi.mocked(api.logout).mockResolvedValue(undefined);
  resetStore();
});

const messages = () => useStore.getState().messagesByConversation[CID];

describe("sendMessage", () => {
  it("shows the message immediately, then swaps in the server copy", async () => {
    let resolve!: (m: ReturnType<typeof makeMessage>) => void;
    vi.mocked(api.sendMessage).mockReturnValue(new Promise((r) => (resolve = r)));

    const pending = useStore.getState().sendMessage("  hi there ");
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({ content: "hi there", pending: true });
    expect(messages()[0].id).toBeLessThan(0);

    resolve(makeMessage({ id: 77, conversation_id: CID, sender_id: 1, content: "hi there" }));
    await pending;
    expect(messages().map((m) => m.id)).toEqual([77]);
    expect(messages()[0].pending).toBeUndefined();
    expect(useStore.getState().previews[CID].lastMessage).toBe("hi there");
  });

  it("doesn't duplicate when the websocket push beats the HTTP response", async () => {
    const real = makeMessage({ id: 77, conversation_id: CID, sender_id: 1, content: "hi" });
    vi.mocked(api.sendMessage).mockImplementation(async () => {
      useStore.getState().addIncomingMessage(real);
      return real;
    });
    await useStore.getState().sendMessage("hi");
    expect(messages().map((m) => m.id)).toEqual([77]);
  });

  it("rolls the optimistic message back and rethrows on failure", async () => {
    vi.mocked(api.sendMessage).mockRejectedValue(new Error("blocked"));
    await expect(useStore.getState().sendMessage("nope")).rejects.toThrow("blocked");
    expect(messages()).toEqual([]);
  });

  it("sends the reply target and clears the reply bar", async () => {
    const target = makeMessage({ id: 5, sender_id: 2, sender: makeUser({ id: 2 }) });
    useStore.setState({ replyingTo: target });
    vi.mocked(api.sendMessage).mockResolvedValue(makeMessage({ id: 9, sender_id: 1 }));

    const pending = useStore.getState().sendMessage("agreed");
    expect(messages()[0].reply_to?.id).toBe(5);
    expect(useStore.getState().replyingTo).toBeNull();
    await pending;
    expect(api.sendMessage).toHaveBeenCalledWith(CID, { content: "agreed", replyToMessageId: 5 });
  });

  it("ignores blank input", async () => {
    await useStore.getState().sendMessage("   ");
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(messages()).toEqual([]);
  });
});

describe("sendAttachment", () => {
  it("uploads then sends a message that references the file", async () => {
    const attachment = { url: "/api/uploads/x.png", name: "x.png", mime: "image/png", size: 3, type: "image" as const };
    vi.mocked(api.uploadAttachment).mockResolvedValue(attachment);
    vi.mocked(api.sendMessage).mockResolvedValue(
      makeMessage({ id: 12, sender_id: 1, type: "image", attachment_url: attachment.url })
    );
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));

    const file = new File(["abc"], "x.png", { type: "image/png" });
    await useStore.getState().sendAttachment(file, " look ");

    expect(api.sendMessage).toHaveBeenCalledWith(CID, {
      content: "look",
      type: "image",
      attachment,
      replyToMessageId: undefined,
    });
    expect(messages().map((m) => m.id)).toEqual([12]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });

  it("rejects oversized files before uploading", async () => {
    const big = new File([new Uint8Array(11 * 1024 * 1024)], "big.bin");
    await expect(useStore.getState().sendAttachment(big, "")).rejects.toThrow(/too large/);
    expect(api.uploadAttachment).not.toHaveBeenCalled();
  });
});

describe("addIncomingMessage", () => {
  const incoming = (id: number, over = {}) =>
    makeMessage({ id, conversation_id: CID, sender_id: 2, sender: makeUser({ id: 2 }), ...over });

  it("appends to an open conversation without counting it as unread", () => {
    useStore.getState().addIncomingMessage(incoming(1));
    expect(messages().map((m) => m.id)).toEqual([1]);
    expect(useStore.getState().previews[CID].unreadCount).toBe(0);
  });

  it("marks the open conversation read", async () => {
    useStore.getState().addIncomingMessage(
      incoming(1, {
        statuses: [{ id: 1, message_id: 1, user_id: 1, status: "delivered", updated_at: "" }],
      })
    );
    await vi.waitFor(() => expect(api.markConversationRead).toHaveBeenCalledWith(CID));
  });

  it("counts unread messages for conversations you're not looking at", () => {
    resetStore({ activeConversationId: null, messagesByConversation: {} });
    useStore.getState().addIncomingMessage(incoming(1));
    useStore.getState().addIncomingMessage(incoming(2));
    expect(useStore.getState().previews[CID].unreadCount).toBe(2);
    expect(useStore.getState().previews[CID].lastMessage).toBe("hello");
  });

  it("ignores a message it already has", () => {
    useStore.getState().addIncomingMessage(incoming(1));
    useStore.getState().addIncomingMessage(incoming(1));
    expect(messages()).toHaveLength(1);
  });

  it("moves the conversation to the top", () => {
    const other = makeConversation({ id: 11, updated_at: "2026-10-26T00:00:00" });
    resetStore({ conversations: [other, makeConversation({ id: CID, updated_at: "2026-10-01T00:00:00" })] });
    useStore.getState().addIncomingMessage(incoming(1, { created_at: "2026-10-27T00:00:00" }));
    expect(useStore.getState().conversations.map((c) => c.id)).toEqual([CID, 11]);
  });

  it("reloads the list when a message arrives for an unknown conversation", () => {
    resetStore({ conversations: [] });
    useStore.getState().addIncomingMessage(incoming(1));
    expect(api.getConversations).toHaveBeenCalled();
  });
});

describe("selectConversation", () => {
  it("loads history once and marks it read in a single request", async () => {
    const received = makeMessage({
      id: 3,
      conversation_id: CID,
      sender_id: 2,
      statuses: [{ id: 1, message_id: 3, user_id: 1, status: "delivered", updated_at: "" }],
    });
    resetStore({ activeConversationId: null, messagesByConversation: {} });
    vi.mocked(api.getMessages).mockResolvedValue([received]);
    vi.mocked(api.markConversationRead).mockResolvedValue([3]);

    await useStore.getState().selectConversation(CID);

    expect(api.getMessages).toHaveBeenCalledTimes(1);
    expect(api.markConversationRead).toHaveBeenCalledTimes(1);
    expect(messages()[0].statuses[0].status).toBe("read");

    await useStore.getState().selectConversation(CID);
    expect(api.getMessages).toHaveBeenCalledTimes(1); // cached
  });

  it("can close the conversation (mobile back button)", async () => {
    await useStore.getState().selectConversation(null);
    expect(useStore.getState().activeConversationId).toBeNull();
  });

  it("pages older messages in front of the loaded ones", async () => {
    resetStore({ messagesByConversation: { [CID]: [makeMessage({ id: 50, conversation_id: CID })] } });
    vi.mocked(api.getMessages).mockResolvedValue([
      makeMessage({ id: 48, conversation_id: CID }),
      makeMessage({ id: 49, conversation_id: CID }),
    ]);
    await useStore.getState().loadOlderMessages(CID);
    expect(api.getMessages).toHaveBeenCalledWith(CID, 50, 50);
    expect(messages().map((m) => m.id)).toEqual([48, 49, 50]);
    expect(useStore.getState().hasMoreByConversation[CID]).toBe(false);
  });
});

describe("loadConversations", () => {
  it("builds previews and unread counts from one response", async () => {
    vi.mocked(api.getConversations).mockResolvedValue([
      makeConversation({ id: 10, last_message: makeMessage({ content: "latest" }), unread_count: 4 }),
      makeConversation({ id: 11, last_message: null, unread_count: 0 }),
    ]);
    resetStore({ activeConversationId: null });
    await useStore.getState().loadConversations();

    const { previews } = useStore.getState();
    expect(previews[10]).toMatchObject({ lastMessage: "latest", unreadCount: 4 });
    expect(previews[11]).toMatchObject({ lastMessage: null, unreadCount: 0 });
    expect(api.getMessages).not.toHaveBeenCalled(); // no per-conversation fetches any more
  });

  it("never shows an unread badge on the open conversation", async () => {
    vi.mocked(api.getConversations).mockResolvedValue([
      makeConversation({ id: CID, last_message: makeMessage(), unread_count: 3 }),
    ]);
    await useStore.getState().loadConversations();
    expect(useStore.getState().previews[CID].unreadCount).toBe(0);
  });
});

describe("reactions", () => {
  const seed = () =>
    resetStore({ messagesByConversation: { [CID]: [makeMessage({ id: 5, conversation_id: CID })] } });

  it("applies optimistically and keeps the server's answer", async () => {
    seed();
    vi.mocked(api.setReaction).mockResolvedValue([{ user_id: 1, emoji: "👍" }, { user_id: 2, emoji: "❤️" }]);
    await useStore.getState().toggleReaction(messages()[0], "👍");
    expect(messages()[0].reactions).toHaveLength(2);
  });

  it("removes your reaction when you tap the same emoji", async () => {
    resetStore({
      messagesByConversation: {
        [CID]: [makeMessage({ id: 5, conversation_id: CID, reactions: [{ user_id: 1, emoji: "👍" }] })],
      },
    });
    vi.mocked(api.removeReaction).mockResolvedValue([]);
    await useStore.getState().toggleReaction(messages()[0], "👍");
    expect(api.removeReaction).toHaveBeenCalledWith(5);
    expect(messages()[0].reactions).toEqual([]);
  });

  it("reverts and warns when the request fails", async () => {
    seed();
    vi.mocked(api.setReaction).mockRejectedValue(new Error("offline"));
    await useStore.getState().toggleReaction(messages()[0], "👍");
    expect(messages()[0].reactions).toEqual([]);
    expect(useStore.getState().toasts[0].title).toBe("Reaction failed");
  });

  it("doesn't react to messages that haven't reached the server", async () => {
    resetStore({ messagesByConversation: { [CID]: [makeMessage({ id: -4, conversation_id: CID })] } });
    await useStore.getState().toggleReaction(messages()[0], "👍");
    expect(api.setReaction).not.toHaveBeenCalled();
  });
});

describe("expiry and removal", () => {
  it("drops expired messages and refreshes the preview", () => {
    resetStore({
      messagesByConversation: {
        [CID]: [makeMessage({ id: 1, content: "keep" }), makeMessage({ id: 2, content: "gone" })],
      },
    });
    useStore.getState().removeMessages(CID, [2]);
    expect(messages().map((m) => m.id)).toEqual([1]);
    expect(useStore.getState().previews[CID].lastMessage).toBe("keep");
  });

  it("asks the server for a fresh preview when nothing is left in memory", () => {
    resetStore({ messagesByConversation: { [CID]: [makeMessage({ id: 1 })] } });
    useStore.getState().removeMessages(CID, [1]);
    expect(api.getConversations).toHaveBeenCalled();
  });
});

describe("conversations, presence and profile", () => {
  it("drops a conversation you were removed from and closes it", () => {
    useStore.getState().dropConversation(CID);
    const state = useStore.getState();
    expect(state.conversations).toEqual([]);
    expect(state.activeConversationId).toBeNull();
    expect(state.messagesByConversation[CID]).toBeUndefined();
  });

  it("applies presence updates to members", () => {
    useStore.getState().applyUserUpdate({ id: 2, is_online: true });
    expect(useStore.getState().conversations[0].members[1].user.is_online).toBe(true);
  });

  it("updates the profile through the API and everywhere locally", async () => {
    vi.mocked(api.updateProfile).mockResolvedValue({ ...me, display_name: "Alice C." });
    await useStore.getState().updateProfile({ display_name: "Alice C." });
    expect(useStore.getState().user?.display_name).toBe("Alice C.");
    expect(useStore.getState().conversations[0].members[0].user.display_name).toBe("Alice C.");
  });

  it("stores the new disappearing-message timer", async () => {
    vi.mocked(api.updateConversation).mockResolvedValue(
      makeConversation({ id: CID, disappear_after_seconds: 3600 })
    );
    await useStore.getState().setDisappearTimer(CID, 3600);
    expect(api.updateConversation).toHaveBeenCalledWith(CID, { disappear_after_seconds: 3600 });
    expect(useStore.getState().conversations[0].disappear_after_seconds).toBe(3600);
    await useStore.getState().setDisappearTimer(CID, null);
    expect(api.updateConversation).toHaveBeenLastCalledWith(CID, { disappear_after_seconds: 0 });
  });
});

describe("logout", () => {
  it("revokes the session, closes the socket and clears everything", () => {
    useStore.getState().logout();
    expect(api.logout).toHaveBeenCalled();
    expect(wsClient.disconnect).toHaveBeenCalled();
    const state = useStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(state.conversations).toEqual([]);
  });

  it("skips the server call when the server already ended the session", () => {
    useStore.getState().logout({ remote: false });
    expect(api.logout).not.toHaveBeenCalled();
    expect(useStore.getState().token).toBeNull();
  });
});
