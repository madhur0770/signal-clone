"use client";

import { useState } from "react";

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
          <p className="truncate text-sm text-muted">
            {other?.is_online && !isGroup && !isBlocked ? (
              <span className="text-online">Online</span>
            ) : (
              subtitle
            )}
          </p>
        </div>
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