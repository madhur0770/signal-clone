"use client";

import { useState } from "react";
import { ArrowLeft, Lock, Phone, Timer, Video } from "lucide-react";

import Avatar from "@/components/Avatar";
import DisappearingModal from "@/components/DisappearingModal";
import GroupInfoModal from "@/components/GroupInfoModal";
import ProfileModal from "@/components/ProfileModal";
import {
  formatLastSeen,
  formatTimerLabel,
  getConversationAvatar,
  getOtherMember,
} from "@/lib/utils";
import { useStore } from "@/store/useStore";
import type { Conversation, User } from "@/types";

interface ChatHeaderProps {
  conversation: Conversation;
  currentUser: User;
}

const iconButton =
  "rounded-lg p-2 text-muted transition hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]";

export default function ChatHeader({ conversation, currentUser }: ChatHeaderProps) {
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showTimer, setShowTimer] = useState(false);
  const contacts = useStore((s) => s.contacts);
  const addToast = useStore((s) => s.addToast);
  const selectConversation = useStore((s) => s.selectConversation);

  const avatar = getConversationAvatar(conversation, currentUser.id);
  const other = getOtherMember(conversation, currentUser.id);
  const matchedContact = other ? contacts.find((c) => c.contact_user_id === other.id) : null;

  const isGroup = conversation.type === "group";
  const isDirect = conversation.type === "direct";

  const title = isGroup ? conversation.name ?? "Group" : other?.display_name ?? "Unknown";
  const isBlocked = matchedContact?.is_blocked;

  const subtitle = isGroup
    ? `${conversation.members.length} members`
    : other && !isBlocked
      ? formatLastSeen(other)
      : "";

  const myRole = conversation.members.find((m) => m.user_id === currentUser.id)?.role;
  const canEditTimer = isDirect || myRole === "admin";
  const timer = conversation.disappear_after_seconds;

  return (
    <>
      <header className="flex items-center gap-2 border-b border-border bg-panel px-3 py-3 md:gap-3 md:px-6 md:py-4">
        <button
          type="button"
          onClick={() => selectConversation(null)}
          aria-label="Back to conversations"
          className={`${iconButton} md:hidden`}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div
          className={`flex min-w-0 flex-1 items-center gap-3 ${
            isGroup || (isDirect && matchedContact) ? "cursor-pointer" : ""
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
            <h1 className="truncate text-base font-semibold text-foreground">{title}</h1>
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
        </div>

        <div className="flex items-center gap-1 md:gap-2">
          <button
            type="button"
            onClick={() => setShowTimer(true)}
            aria-label={`Disappearing messages: ${formatTimerLabel(timer)}`}
            title={`Disappearing messages: ${formatTimerLabel(timer)}`}
            className={`${iconButton} flex items-center gap-1 ${timer ? "text-accent" : ""}`}
          >
            <Timer className="h-5 w-5" />
            {timer ? <span className="text-xs font-medium">{formatTimerLabel(timer)}</span> : null}
          </button>
          {isDirect && (
            <>
              <button
                type="button"
                aria-label="Voice call"
                onClick={() => addToast("Voice call", "Coming soon")}
                className={`${iconButton} hidden sm:block`}
              >
                <Phone className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Video call"
                onClick={() => addToast("Video call", "Coming soon")}
                className={`${iconButton} hidden sm:block`}
              >
                <Video className="h-5 w-5" />
              </button>
            </>
          )}
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
        <ProfileModal contact={matchedContact} onClose={() => setShowProfile(false)} />
      )}

      {showTimer && (
        <DisappearingModal
          conversation={conversation}
          canEdit={canEditTimer}
          onClose={() => setShowTimer(false)}
        />
      )}
    </>
  );
}
