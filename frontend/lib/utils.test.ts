import { describe, expect, it } from "vitest";

import { makeConversation, makeMessage } from "@/tests/factories";

import {
  formatCountdown,
  formatFileSize,
  formatTimerLabel,
  getConversationAvatar,
  getConversationTitle,
  getInitials,
  getLastMessagePreview,
  getOtherMember,
  getOverallStatus,
  getUnreadCount,
  groupReactions,
  isExpired,
  isSameLocalDay,
  parseUtcDate,
} from "./utils";

const status = (user_id: number, value: "sent" | "delivered" | "read") => ({
  id: user_id,
  message_id: 1,
  user_id,
  status: value,
  updated_at: "2026-10-25T10:00:00",
});

describe("parseUtcDate", () => {
  it("treats timestamps without a zone as UTC", () => {
    expect(parseUtcDate("2026-10-25T10:00:00").toISOString()).toBe("2026-10-25T10:00:00.000Z");
  });

  it("leaves explicit offsets alone", () => {
    expect(parseUtcDate("2026-10-25T10:00:00+02:00").toISOString()).toBe(
      "2026-10-25T08:00:00.000Z"
    );
    expect(parseUtcDate("2026-10-25T10:00:00Z").toISOString()).toBe("2026-10-25T10:00:00.000Z");
  });
});

describe("getInitials", () => {
  it("uses the first letters of up to two words", () => {
    expect(getInitials("alice chen")).toBe("AC");
    expect(getInitials("Madonna")).toBe("M");
    expect(getInitials("A B C")).toBe("AB");
  });

  it("copes with stray whitespace", () => {
    expect(getInitials("  bob   martinez ")).toBe("BM");
    expect(getInitials("")).toBe("");
  });
});

describe("conversation helpers", () => {
  const direct = makeConversation();

  it("names a direct chat after the other person", () => {
    expect(getConversationTitle(direct, 1)).toBe("Bob Martinez");
    expect(getConversationTitle(direct, 2)).toBe("Alice Chen");
    expect(getOtherMember(direct, 1)?.id).toBe(2);
  });

  it("uses the group name for groups", () => {
    const group = makeConversation({ type: "group", name: "Weekend Plans" });
    expect(getConversationTitle(group, 1)).toBe("Weekend Plans");
    expect(getConversationAvatar(group, 1).name).toBe("Weekend Plans");
    expect(getOtherMember(group, 1)).toBeNull();
  });
});

describe("getOverallStatus", () => {
  const base = { sender_id: 1 };

  it("is 'sent' with no recipients or nobody reached", () => {
    expect(getOverallStatus(makeMessage({ ...base, statuses: [] }))).toBe("sent");
    expect(
      getOverallStatus(makeMessage({ ...base, statuses: [status(1, "sent"), status(2, "sent")] }))
    ).toBe("sent");
  });

  it("ignores the sender's own row", () => {
    expect(
      getOverallStatus(makeMessage({ ...base, statuses: [status(1, "read"), status(2, "sent")] }))
    ).toBe("sent");
  });

  it("becomes 'delivered' once any recipient has it", () => {
    expect(
      getOverallStatus(
        makeMessage({ ...base, statuses: [status(1, "sent"), status(2, "delivered"), status(3, "sent")] })
      )
    ).toBe("delivered");
  });

  it("is 'read' only when every recipient has read it", () => {
    const partial = makeMessage({
      ...base,
      statuses: [status(1, "sent"), status(2, "read"), status(3, "delivered")],
    });
    expect(getOverallStatus(partial)).toBe("delivered");
    const all = makeMessage({
      ...base,
      statuses: [status(1, "sent"), status(2, "read"), status(3, "read")],
    });
    expect(getOverallStatus(all)).toBe("read");
  });
});

describe("getUnreadCount", () => {
  it("counts received messages that aren't read yet", () => {
    const messages = [
      makeMessage({ id: 1, sender_id: 2, statuses: [status(1, "delivered")] }),
      makeMessage({ id: 2, sender_id: 2, statuses: [status(1, "sent")] }),
      makeMessage({ id: 3, sender_id: 2, statuses: [status(1, "read")] }),
      makeMessage({ id: 4, sender_id: 1, statuses: [status(2, "sent")] }), // my own message
    ];
    expect(getUnreadCount(messages, 1)).toBe(2);
  });
});

describe("getLastMessagePreview", () => {
  it("handles missing, short, long, image and file messages", () => {
    expect(getLastMessagePreview(undefined)).toBe("No messages yet");
    expect(getLastMessagePreview(makeMessage({ content: "hi" }))).toBe("hi");
    expect(getLastMessagePreview(makeMessage({ content: "x".repeat(60) }))).toBe(`${"x".repeat(48)}…`);
    expect(getLastMessagePreview(makeMessage({ type: "image", content: "" }))).toBe("📷 Photo");
    expect(getLastMessagePreview(makeMessage({ type: "image", content: "sunset" }))).toBe("📷 sunset");
    expect(
      getLastMessagePreview(makeMessage({ type: "file", content: "", attachment_name: "map.pdf" }))
    ).toBe("📎 map.pdf");
  });
});

describe("disappearing messages", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");

  it("knows when a message has expired", () => {
    expect(isExpired({ expires_at: null }, now)).toBe(false);
    expect(isExpired({ expires_at: "2026-10-25T12:00:01" }, now)).toBe(false);
    expect(isExpired({ expires_at: "2026-10-25T12:00:00" }, now)).toBe(true);
    expect(isExpired({ expires_at: "2026-10-25T11:00:00" }, now)).toBe(true);
  });

  it("formats the countdown in the largest sensible unit", () => {
    expect(formatCountdown("2026-10-25T12:00:42", now)).toBe("42s");
    expect(formatCountdown("2026-10-25T12:05:00", now)).toBe("5m");
    expect(formatCountdown("2026-10-25T15:00:00", now)).toBe("3h");
    expect(formatCountdown("2026-10-27T12:00:00", now)).toBe("2d");
    expect(formatCountdown("2026-10-25T11:00:00", now)).toBe("0s");
  });

  it("labels timer presets", () => {
    expect(formatTimerLabel(null)).toBe("Off");
    expect(formatTimerLabel(0)).toBe("Off");
    expect(formatTimerLabel(3600)).toBe("1 hour");
    expect(formatTimerLabel(604800)).toBe("1 week");
    expect(formatTimerLabel(17)).toBe("17s");
  });
});

describe("formatFileSize", () => {
  it("scales units", () => {
    expect(formatFileSize(null)).toBe("");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(300 * 1024)).toBe("300 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("groupReactions", () => {
  it("groups by emoji, flags mine and sorts by popularity", () => {
    const groups = groupReactions(
      [
        { user_id: 2, emoji: "👍" },
        { user_id: 3, emoji: "❤️" },
        { user_id: 1, emoji: "👍" },
        { user_id: 4, emoji: "👍" },
      ],
      1
    );
    expect(groups).toEqual([
      { emoji: "👍", count: 3, mine: true },
      { emoji: "❤️", count: 1, mine: false },
    ]);
  });

  it("returns nothing for no reactions", () => {
    expect(groupReactions([], 1)).toEqual([]);
  });
});

describe("isSameLocalDay", () => {
  it("compares calendar days", () => {
    expect(isSameLocalDay("2026-10-25T10:00:00", "2026-10-25T10:30:00")).toBe(true);
    expect(isSameLocalDay("2026-10-20T10:00:00", "2026-10-25T10:00:00")).toBe(false);
  });
});
