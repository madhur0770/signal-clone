"use client";

import { MessageSquare } from "lucide-react";

export default function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-surface px-8">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent/10">
        <MessageSquare className="h-10 w-10 text-accent" strokeWidth={1.5} />
      </div>
      <h2 className="text-xl font-semibold text-foreground">Select a conversation</h2>
      <p className="mt-2 max-w-sm text-center text-sm text-muted">
        Choose a chat from the sidebar or start a new conversation to begin messaging.
      </p>
    </div>
  );
}
