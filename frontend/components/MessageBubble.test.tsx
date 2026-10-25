import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { makeMessage, makeUser } from "@/tests/factories";

import MessageBubble from "./MessageBubble";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const bob = makeUser({ id: 2, display_name: "Bob Martinez" });

function renderBubble(
  overrides: Parameters<typeof makeMessage>[0] = {},
  props: Partial<React.ComponentProps<typeof MessageBubble>> = {}
) {
  const message = makeMessage({ id: 5, ...overrides });
  const handlers = { onReply: vi.fn(), onReact: vi.fn(), onJumpTo: vi.fn() };
  render(
    <MessageBubble
      message={message}
      isOwn={message.sender_id === 1}
      currentUserId={1}
      nowMs={NOW}
      {...handlers}
      {...props}
    />
  );
  return { message, ...handlers };
}

describe("MessageBubble", () => {
  it("shows the text and send time", () => {
    renderBubble({ content: "see you at noon" });
    expect(screen.getByText("see you at noon")).toBeInTheDocument();
  });

  it("shows tick state for own messages", () => {
    renderBubble({
      sender_id: 1,
      statuses: [
        { id: 1, message_id: 5, user_id: 1, status: "sent", updated_at: "" },
        { id: 2, message_id: 5, user_id: 2, status: "read", updated_at: "" },
      ],
    });
    expect(screen.getByRole("img", { name: "read" })).toBeInTheDocument();
  });

  it("shows a clock instead of ticks while pending, and no ticks on received messages", () => {
    renderBubble({ sender_id: 1 }, { message: { ...makeMessage({ id: -3, sender_id: 1 }), pending: true } });
    expect(screen.getByRole("img", { name: "sending" })).toBeInTheDocument();
  });

  it("doesn't show ticks for messages from others", () => {
    renderBubble({ sender: bob, sender_id: 2 });
    expect(screen.queryByRole("img", { name: /sent|delivered|read/ })).not.toBeInTheDocument();
  });

  it("renders a reply quote that jumps to the original", async () => {
    const { onJumpTo } = renderBubble({
      sender: bob,
      sender_id: 2,
      reply_to_message_id: 3,
      reply_to: {
        id: 3,
        sender_id: 1,
        sender_name: "Alice Chen",
        content: "lunch?",
        type: "text",
        attachment_name: null,
      },
    });
    expect(screen.getByText("You")).toBeInTheDocument();
    await userEvent.click(screen.getByText("lunch?"));
    expect(onJumpTo).toHaveBeenCalledWith(3);
  });

  it("says so when the original message is gone", () => {
    renderBubble({ reply_to_message_id: 3, reply_to: null });
    expect(screen.getByText("Original message unavailable")).toBeInTheDocument();
  });

  it("groups reactions into chips and toggles on click", async () => {
    const { onReact, message } = renderBubble({
      reactions: [
        { user_id: 1, emoji: "👍" },
        { user_id: 2, emoji: "👍" },
        { user_id: 3, emoji: "❤️" },
      ],
    });
    const thumbs = screen.getByRole("button", { name: "👍 2" });
    expect(thumbs).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "❤️ 1" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(thumbs);
    expect(onReact).toHaveBeenCalledWith(message, "👍");
  });

  it("offers reply and the quick-reaction picker", async () => {
    const { onReply, onReact, message } = renderBubble();
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(onReply).toHaveBeenCalledWith(message);

    await userEvent.click(screen.getByRole("button", { name: "React" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "😂" }));
    expect(onReact).toHaveBeenCalledWith(message, "😂");
  });

  it("hides actions on messages that aren't on the server yet", () => {
    renderBubble({}, { message: { ...makeMessage({ id: -1 }), pending: true } });
    expect(screen.queryByRole("button", { name: "Reply" })).not.toBeInTheDocument();
  });

  it("renders image attachments as links to the full image", () => {
    renderBubble({
      type: "image",
      content: "",
      attachment_url: "/api/uploads/abc.png",
      attachment_name: "abc.png",
    });
    const image = screen.getByRole("img", { name: "abc.png" });
    expect(image).toHaveAttribute("src", "http://localhost:8000/api/uploads/abc.png");
    expect(image.closest("a")).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders file attachments with name and size", () => {
    renderBubble({
      type: "file",
      content: "",
      attachment_url: "/api/uploads/abc.pdf",
      attachment_name: "map.pdf",
      attachment_size: 2048,
    });
    expect(screen.getByText("map.pdf")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("shows a countdown for disappearing messages", () => {
    renderBubble({ expires_at: "2026-10-25T12:05:00" });
    expect(screen.getByTestId("expiry")).toHaveTextContent("5m");
  });

  it("labels the sender in group chats", () => {
    renderBubble({ sender: bob, sender_id: 2 }, { showSender: true });
    expect(screen.getByText("Bob Martinez")).toBeInTheDocument();
  });
});
