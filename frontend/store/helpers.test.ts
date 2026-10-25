import { describe, expect, it } from "vitest";

import { makeConversation, makeMessage, makeUser } from "@/tests/factories";

import {
  appendUnique,
  applyReactions,
  applyStatus,
  mergeUserEverywhere,
  prependOlder,
  replyPreviewFor,
  sortConversations,
  toggleReactionList,
} from "./helpers";

const row = (user_id: number, status: "sent" | "delivered" | "read") => ({
  id: user_id,
  message_id: 1,
  user_id,
  status,
  updated_at: "2026-10-25T10:00:00",
});

describe("appendUnique / prependOlder", () => {
  it("ignores a message that's already present", () => {
    const list = [makeMessage({ id: 1 })];
    expect(appendUnique(list, makeMessage({ id: 1 }))).toBe(list);
    expect(appendUnique(list, makeMessage({ id: 2 })).map((m) => m.id)).toEqual([1, 2]);
  });

  it("puts an older page in front without duplicating overlap", () => {
    const loaded = [makeMessage({ id: 5 }), makeMessage({ id: 6 })];
    const older = [makeMessage({ id: 3 }), makeMessage({ id: 4 }), makeMessage({ id: 5 })];
    expect(prependOlder(loaded, older).map((m) => m.id)).toEqual([3, 4, 5, 6]);
  });
});

describe("sortConversations", () => {
  it("orders by most recent activity without mutating the input", () => {
    const old = makeConversation({ id: 1, updated_at: "2026-10-01T00:00:00" });
    const fresh = makeConversation({ id: 2, updated_at: "2026-10-25T00:00:00" });
    const input = [old, fresh];
    expect(sortConversations(input).map((c) => c.id)).toEqual([2, 1]);
    expect(input.map((c) => c.id)).toEqual([1, 2]);
  });
});

describe("applyStatus", () => {
  const message = makeMessage({ id: 1, sender_id: 1, statuses: [row(1, "sent"), row(2, "sent")] });

  it("raises one user's status on the listed messages only", () => {
    const other = makeMessage({ id: 2, sender_id: 1, statuses: [row(2, "sent")] });
    const [first, second] = applyStatus([message, other], [1], 2, "delivered");
    expect(first.statuses.find((s) => s.user_id === 2)?.status).toBe("delivered");
    expect(first.statuses.find((s) => s.user_id === 1)?.status).toBe("sent");
    expect(second).toBe(other);
  });

  it("never moves a status backwards", () => {
    const read = makeMessage({ id: 1, statuses: [row(2, "read")] });
    const result = applyStatus([read], [1], 2, "delivered");
    expect(result[0].statuses[0].status).toBe("read");
  });

  it("returns the same array when nothing changed (so React can skip a render)", () => {
    const list = [message];
    expect(applyStatus(list, [99], 2, "read")).toBe(list);
    expect(applyStatus(list, [1], 2, "sent")).toBe(list);
  });
});

describe("reactions", () => {
  it("toggles, replaces and removes a user's reaction", () => {
    const start = [{ user_id: 2, emoji: "👍" }];
    const added = toggleReactionList(start, 1, "❤️");
    expect(added).toEqual([
      { user_id: 2, emoji: "👍" },
      { user_id: 1, emoji: "❤️" },
    ]);
    const replaced = toggleReactionList(added, 1, "😂");
    expect(replaced.filter((r) => r.user_id === 1)).toEqual([{ user_id: 1, emoji: "😂" }]);
    const removed = toggleReactionList(replaced, 1, "😂");
    expect(removed).toEqual([{ user_id: 2, emoji: "👍" }]);
  });

  it("applies a server-confirmed list to the right message", () => {
    const messages = [makeMessage({ id: 1 }), makeMessage({ id: 2 })];
    const result = applyReactions(messages, 2, [{ user_id: 1, emoji: "🎉" }]);
    expect(result[0].reactions).toEqual([]);
    expect(result[1].reactions).toEqual([{ user_id: 1, emoji: "🎉" }]);
  });
});

describe("mergeUserEverywhere", () => {
  it("updates the user in every cached copy", () => {
    const conversation = makeConversation();
    const state = {
      user: makeUser({ id: 1 }),
      conversations: [conversation],
      contacts: [
        {
          id: 1,
          owner_id: 1,
          contact_user_id: 2,
          nickname: null,
          is_blocked: false,
          created_at: "2026-10-01T00:00:00",
          contact_user: makeUser({ id: 2, display_name: "Bob Martinez" }),
        },
      ],
    };
    const next = mergeUserEverywhere({ id: 2, is_online: true, display_name: "Bobby" }, state);

    expect(next.contacts[0].contact_user.is_online).toBe(true);
    expect(next.conversations[0].members[1].user.display_name).toBe("Bobby");
    // Other people and the signed-in user are untouched.
    expect(next.conversations[0].members[0].user.display_name).toBe("Alice Chen");
    expect(next.user?.display_name).toBe("Alice Chen");
  });

  it("updates the signed-in user too", () => {
    const state = { user: makeUser({ id: 1 }), conversations: [], contacts: [] };
    expect(mergeUserEverywhere({ id: 1, status_message: "Busy" }, state).user?.status_message).toBe(
      "Busy"
    );
  });
});

describe("replyPreviewFor", () => {
  it("snapshots what the reply bar needs", () => {
    const message = makeMessage({ id: 7, content: "lunch?", sender: makeUser({ id: 2, display_name: "Bob" }) });
    expect(replyPreviewFor(message)).toMatchObject({ id: 7, sender_name: "Bob", content: "lunch?" });
    expect(replyPreviewFor(null)).toBeNull();
  });
});
