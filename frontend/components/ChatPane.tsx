"use client";

import ChatHeader from "@/components/ChatHeader";
import MessageInput from "@/components/MessageInput";
import MessageList from "@/components/MessageList";
import TypingIndicator from "@/components/TypingIndicator";
import { getConversationTitle } from "@/lib/utils";
import { useStore } from "@/store/useStore";
import type { Conversation, Message } from "@/types";

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_TYPING_IDS: number[] = [];

interface ChatPaneProps {
  conversation: Conversation;
}

export default function ChatPane({ conversation }: ChatPaneProps) {
  const user = useStore((s) => s.user)!;
  const messages = useStore(
    (s) => s.messagesByConversation[conversation.id] ?? EMPTY_MESSAGES
  );
  const typingIds = useStore(
    (s) => s.typingByConversation[conversation.id] ?? EMPTY_TYPING_IDS
  );
  const sendMessage = useStore((s) => s.sendMessage);

  const typingNames = typingIds
    .filter((id) => id !== user.id)
    .map((id) => {
      const member = conversation.members.find((m) => m.user_id === id);
      return member?.user.display_name ?? "Someone";
    });

  return (
    <div className="flex h-full flex-1 flex-col bg-surface">
      <ChatHeader conversation={conversation} currentUser={user} />
      <MessageList messages={messages} currentUser={user} />
      <TypingIndicator names={typingNames} />
      <MessageInput
        conversationId={conversation.id}
        onSend={sendMessage}
      />
    </div>
  );
}