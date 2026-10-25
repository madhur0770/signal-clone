"use client";

import axios from "axios";

import ChatHeader from "@/components/ChatHeader";
import MessageInput from "@/components/MessageInput";
import MessageList from "@/components/MessageList";
import TypingIndicator from "@/components/TypingIndicator";
import { getOtherMember } from "@/lib/utils";
import { useStore } from "@/store/useStore";
import type { ClientMessage } from "@/store/helpers";
import type { Conversation } from "@/types";

const EMPTY_MESSAGES: ClientMessage[] = [];
const EMPTY_TYPING_IDS: number[] = [];

interface ChatPaneProps {
  conversation: Conversation;
}

function errorText(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err) && typeof err.response?.data?.detail === "string") {
    return err.response.data.detail;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function ChatPane({ conversation }: ChatPaneProps) {
  const user = useStore((s) => s.user)!;
  const messages = useStore(
    (s) => s.messagesByConversation[conversation.id] ?? EMPTY_MESSAGES
  );
  const hasMore = useStore((s) => s.hasMoreByConversation[conversation.id] ?? false);
  const typingIds = useStore(
    (s) => s.typingByConversation[conversation.id] ?? EMPTY_TYPING_IDS
  );
  const replyingTo = useStore((s) => s.replyingTo);
  const contacts = useStore((s) => s.contacts);
  const sendMessage = useStore((s) => s.sendMessage);
  const sendAttachment = useStore((s) => s.sendAttachment);
  const setReplyingTo = useStore((s) => s.setReplyingTo);
  const addToast = useStore((s) => s.addToast);

  const other = getOtherMember(conversation, user.id);
  const iBlockedThem =
    conversation.type === "direct" &&
    !!other &&
    contacts.some((c) => c.contact_user_id === other.id && c.is_blocked);

  const handleSend = async (content: string) => {
    try {
      await sendMessage(content);
    } catch (err) {
      addToast("Message not sent", errorText(err, "Failed to send message"));
    }
  };

  const handleAttach = async (file: File, caption: string) => {
    try {
      await sendAttachment(file, caption);
    } catch (err) {
      addToast("Attachment not sent", errorText(err, "Failed to send attachment"));
    }
  };

  const typingNames = typingIds
    .filter((id) => id !== user.id)
    .map((id) => {
      const member = conversation.members.find((m) => m.user_id === id);
      return member?.user.display_name ?? "Someone";
    });

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-surface">
      <ChatHeader conversation={conversation} currentUser={user} />
      <MessageList
        conversationId={conversation.id}
        messages={messages}
        currentUser={user}
        isGroup={conversation.type === "group"}
        hasMore={hasMore}
      />
      <TypingIndicator names={typingNames} />
      <MessageInput
        conversationId={conversation.id}
        currentUserId={user.id}
        onSend={handleSend}
        onAttach={handleAttach}
        replyingTo={replyingTo?.conversation_id === conversation.id ? replyingTo : null}
        onCancelReply={() => setReplyingTo(null)}
        disabled={iBlockedThem}
        disabledReason={
          iBlockedThem ? "You blocked this contact. Unblock them from their profile to chat." : undefined
        }
      />
    </div>
  );
}
