"use client";

import { useMemo, useState } from "react";
import { Camera, Search, Settings, UserPlus, Users } from "lucide-react";
import Link from "next/link";

import Avatar from "@/components/Avatar";
import ConversationItem from "@/components/ConversationItem";
import NewChatModal from "@/components/NewChatModal";
import {
  getConversationAvatar,
  getConversationTitle,
} from "@/lib/utils";
import { useStore } from "@/store/useStore";

export default function Sidebar() {
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"direct" | "group" | null>(null);

  const user = useStore((s) => s.user)!;
  const conversations = useStore((s) => s.conversations);
  const previews = useStore((s) => s.previews);
  const activeId = useStore((s) => s.activeConversationId);
  const selectConversation = useStore((s) => s.selectConversation);
  const addToast = useStore((s) => s.addToast);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return conversations;
    return conversations.filter((c) =>
      getConversationTitle(c, user.id).toLowerCase().includes(q)
    );
  }, [conversations, search, user.id]);

  return (
    <>
      <aside className="flex h-full w-[360px] shrink-0 flex-col border-r border-border bg-panel">
        <div className="flex items-center justify-between px-4 pb-2 pt-5">
          <div className="flex items-center gap-3">
            <Avatar
              name={user.display_name}
              src={user.avatar_url}
              size="sm"
            />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {user.display_name}
              </p>
              <p className="text-xs text-muted">@{user.username}</p>
            </div>
          </div>
          <Link
            href="/settings"
            className="rounded-lg p-2 text-muted transition hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
            aria-label="Settings"
          >
            <Settings className="h-5 w-5" />
          </Link>
        </div>

        <div className="px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations"
              className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>

        <div className="px-4 pb-3">
          <button
            type="button"
            onClick={() => addToast("Stories", "Coming soon")}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-accent/40 hover:bg-accent/5"
          >
            <Camera className="h-4 w-4" />
            Stories
          </button>
        </div>

        <div className="flex gap-2 px-4 pb-3">
          <button
            type="button"
            onClick={() => setModal("direct")}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-surface py-2 text-sm font-medium text-foreground transition hover:border-accent/40 hover:bg-accent/5"
          >
            <UserPlus className="h-4 w-4" />
            New chat
          </button>
          <button
            type="button"
            onClick={() => setModal("group")}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-surface py-2 text-sm font-medium text-foreground transition hover:border-accent/40 hover:bg-accent/5"
          >
            <Users className="h-4 w-4" />
            New group
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">
              No conversations yet
            </p>
          ) : (
            filtered.map((conversation) => {
              const avatar = getConversationAvatar(conversation, user.id);
              return (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  preview={previews[conversation.id]}
                  title={getConversationTitle(conversation, user.id)}
                  avatarName={avatar.name}
                  avatarUrl={avatar.url}
                  isActive={activeId === conversation.id}
                  onClick={() => selectConversation(conversation.id)}
                />
              );
            })
          )}
        </div>
      </aside>

      {modal && (
        <NewChatModal mode={modal} onClose={() => setModal(null)} />
      )}
    </>
  );
}