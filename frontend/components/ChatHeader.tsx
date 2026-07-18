"use client";

import { useState } from "react";
import { Lock, Phone, Video } from "lucide-react";

import Avatar from "@/components/Avatar";
import GroupInfoModal from "@/components/GroupInfoModal";
import ProfileModal from "@/components/ProfileModal";
import { formatLastSeen, getConversationAvatar, getOtherMember } from "@/lib/utils";
import { useStore } from "@/store/useStore";
import type { Conversation, User } from "@/types";

interface ChatHeaderProps {
  conversation: Conversation;
  currentUser: User;
}

export default function ChatHeader({ conversation, currentUser }: ChatHeaderProps) {
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const contacts = useStore((s) => s.contacts);
  const addToast = useStore((s) => s.addToast);

  const avatar = getConversationAvatar(conversation, currentUser.id);
  const other = getOtherMember(conversation, currentUser.id);
  const matchedContact = other ? contacts.find((c) => c.contact_user_id === other.id) : null;
  
  const isGroup = conversation.type === "group";
  const isDirect = conversation.type === "direct";
  
  const title = isGroup
    ? conversation.name ?? "Group"
    : other?.display_name ?? "Unknown";

  const isBlocked = matchedContact?.is_blocked;

  const subtitle = isGroup
    ? `${conversation.members.length} members`
    : (other && !isBlocked)
      ? formatLastSeen(other)
      : "";

  return (
    <>
      <header
        className={`flex items-center gap-3 border-b border-border bg-panel px-6 py-4 ${
          isGroup || (isDirect && matchedContact)
            ? "cursor-pointer transition hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
            : ""
        }`}
        onClick={() => {
          if (isGroup) {
            setShowGroupInfo(true);
          } else if (isDirect && matchedContact) {
            setShowProfile(true);
          }
        }}
      >
        <Avatar name={avatar.name} src={avatar.url} size="md" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-foreground">
            {title}
          </h1>
          <div className="flex items-center gap-1.5 text-sm text-muted">
            <p className="truncate">
              {other?.is_online && !isGroup && !isBlocked ? (
                <span className="text-online">Online</span>
              ) : (
                subtitle
              )}
            </p>
          </div>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
            <Lock className="h-2.5 w-2.5" />
            Messages are end-to-end encrypted
          </p>
        </div>

        {isDirect && (
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                addToast("Voice call", "Coming soon");
              }}
              className="rounded-lg p-2 text-muted transition hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
            >
              <Phone className="h-5 w-5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                addToast("Video call", "Coming soon");
              }}
              className="rounded-lg p-2 text-muted transition hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
            >
              <Video className="h-5 w-5" />
            </button>
          </div>
        )}
      </header>

      {isGroup && showGroupInfo && (
        <GroupInfoModal
          conversation={conversation}
          currentUser={currentUser}
          onClose={() => setShowGroupInfo(false)}
        />
      )}

      {isDirect && showProfile && matchedContact && (
        <ProfileModal
          contact={matchedContact}
          onClose={() => setShowProfile(false)}
        />
      )}
    </>
  );
}