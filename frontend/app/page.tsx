"use client";

import AuthGuard from "@/components/AuthGuard";
import ChatPane from "@/components/ChatPane";
import EmptyState from "@/components/EmptyState";
import Sidebar from "@/components/Sidebar";
import WebSocketBridge from "@/components/WebSocketBridge";
import { useStore } from "@/store/useStore";

function ChatApp() {
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeConversationId);

  const activeConversation = conversations.find((c) => c.id === activeId);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      {activeConversation ? (
        <ChatPane conversation={activeConversation} />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <AuthGuard>
      <WebSocketBridge />
      <ChatApp />
    </AuthGuard>
  );
}
