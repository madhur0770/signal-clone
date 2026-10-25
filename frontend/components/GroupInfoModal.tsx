"use client";

import { useEffect, useState } from "react";
import { Pencil, Timer, X } from "lucide-react";

import Avatar from "@/components/Avatar";
import ProfileModal from "@/components/ProfileModal";
import DisappearingModal from "@/components/DisappearingModal";
import {
  addMember,
  removeMember,
  searchUsers,
  updateConversation,
  updateMemberRole,
} from "@/lib/api";
import { formatTimerLabel } from "@/lib/utils";
import { useStore } from "@/store/useStore";
import type { Contact, Conversation, User } from "@/types";

interface GroupInfoModalProps {
  conversation: Conversation;
  currentUser: User;
  onClose: () => void;
}

export default function GroupInfoModal({
  conversation,
  currentUser,
  onClose,
}: GroupInfoModalProps) {
  const loadConversations = useStore((s) => s.loadConversations);
  const contacts = useStore((s) => s.contacts);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [loading, setLoading] = useState<Record<number, boolean>>({});
  const [error, setError] = useState("");
  const [profileContact, setProfileContact] = useState<Contact | null>(null);
  const [showTimer, setShowTimer] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(conversation.name ?? "");
  const dropConversation = useStore((s) => s.dropConversation);

  const currentUserMember = conversation.members.find(
    (m) => m.user_id === currentUser.id
  );
  const isAdmin = currentUserMember?.role === "admin";

  useEffect(() => {
    if (!searchQuery.trim()) return;
    const timer = setTimeout(async () => {
      try {
        const results = await searchUsers(searchQuery);
        setSearchResults(
          results.filter(
            (u) => !conversation.members.some((m) => m.user_id === u.id)
          )
        );
      } catch (err) {
        console.error("Search failed", err);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, conversation.members]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleAdd = async (userId: number) => {
    setLoading((prev) => ({ ...prev, [userId]: true }));
    setError("");
    try {
      await addMember(conversation.id, userId);
      await loadConversations();
      setSearchQuery("");
      setSearchResults([]);
    } catch {
      setError("Failed to add member");
    } finally {
      setLoading((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const handleRemove = async (userId: number) => {
    setLoading((prev) => ({ ...prev, [userId]: true }));
    setError("");
    try {
      await removeMember(conversation.id, userId);
      await loadConversations();
    } catch {
      setError("Failed to remove member");
    } finally {
      setLoading((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const handleRename = async () => {
    const name = nameDraft.trim();
    if (!name || name === conversation.name) {
      setEditingName(false);
      return;
    }
    setError("");
    try {
      await updateConversation(conversation.id, { name });
      await loadConversations();
      setEditingName(false);
    } catch {
      setError("Failed to rename group");
    }
  };

  const handleRole = async (userId: number, role: "admin" | "member") => {
    setLoading((prev) => ({ ...prev, [userId]: true }));
    setError("");
    try {
      await updateMemberRole(conversation.id, userId, role);
      await loadConversations();
    } catch {
      setError("Failed to change role");
    } finally {
      setLoading((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const handleLeave = async () => {
    setLoading((prev) => ({ ...prev, [currentUser.id]: true }));
    setError("");
    try {
      await removeMember(conversation.id, currentUser.id);
      dropConversation(conversation.id);
      await loadConversations();
      onClose();
    } catch {
      setError("Failed to leave group");
      setLoading((prev) => ({ ...prev, [currentUser.id]: false }));
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
        <div className="flex w-full max-w-md max-h-[90vh] flex-col rounded-2xl bg-panel p-6 shadow-xl">
          <div className="mb-4 flex shrink-0 items-center justify-between">
            {editingName ? (
              <input
                autoFocus
                value={nameDraft}
                maxLength={60}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setNameDraft(conversation.name ?? "");
                    setEditingName(false);
                  }
                }}
                aria-label="Group name"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-lg font-semibold focus:border-accent focus:outline-none"
              />
            ) : (
              <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-foreground">
                <span className="truncate">{conversation.name ?? "Group Info"}</span>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setEditingName(true)}
                    aria-label="Rename group"
                    className="rounded p-1 text-muted hover:text-foreground"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </h2>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-muted hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto pr-2">
            <button
              type="button"
              onClick={() => setShowTimer(true)}
              className="flex w-full items-center justify-between rounded-xl border border-border px-4 py-3 text-left text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
            >
              <span className="flex items-center gap-3 font-medium text-foreground">
                <Timer className="h-4 w-4 text-muted" />
                Disappearing messages
              </span>
              <span className="text-muted">{formatTimerLabel(conversation.disappear_after_seconds)}</span>
            </button>

            <div>
              <h3 className="mb-3 text-sm font-medium text-muted">
                Members ({conversation.members.length})
              </h3>
              <ul className="space-y-3">
                {conversation.members.map((member) => (
                  <li
                    key={member.id}
                    onClick={() => {
                      if (member.user_id !== currentUser.id) {
                        const contact = contacts.find(c => c.contact_user_id === member.user_id);
                        if (contact) setProfileContact(contact);
                      }
                    }}
                    className={`flex items-center justify-between ${member.user_id !== currentUser.id ? "cursor-pointer rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.02]" : ""}`}
                  >
                    <div className="flex overflow-hidden items-center gap-3">
                      <Avatar
                        name={member.user.display_name}
                        src={member.user.avatar_url ?? null}
                        size="sm"
                      />
                      <div className="truncate">
                        <span className="text-sm font-medium text-foreground">
                          {member.user_id === currentUser.id ? "You" : member.user.display_name}
                        </span>
                      </div>
                      {member.role === "admin" && (
                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                          Admin
                        </span>
                      )}
                    </div>

                    {isAdmin && member.user_id !== currentUser.id && (
                      <div className="ml-2 flex shrink-0 items-center gap-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRole(member.user_id, member.role === "admin" ? "member" : "admin");
                          }}
                          disabled={loading[member.user_id]}
                          className="text-xs font-semibold text-accent transition hover:opacity-80 disabled:opacity-50"
                        >
                          {member.role === "admin" ? "Remove admin" : "Make admin"}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemove(member.user_id);
                          }}
                          disabled={loading[member.user_id]}
                          className="text-xs font-semibold text-red-500 transition hover:text-red-600 disabled:opacity-50"
                        >
                          {loading[member.user_id] ? "Working..." : "Remove"}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {isAdmin && (
              <div className="border-t border-border pt-4">
                <h3 className="mb-3 text-sm font-medium text-muted">Add Member</h3>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by username or phone"
                  className="mb-3 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />

                {searchQuery.trim() && (
                  <ul className="max-h-40 space-y-1 overflow-y-auto">
                    {searchResults.length === 0 ? (
                      <p className="py-2 text-center text-xs text-muted">No users found.</p>
                    ) : (
                      searchResults.map((u) => (
                        <li
                          key={u.id}
                          className="flex items-center justify-between rounded-xl px-2 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                        >
                          <span className="mr-2 truncate text-sm font-medium text-foreground">
                            {u.display_name || u.username || u.phone_number}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleAdd(u.id)}
                            disabled={loading[u.id]}
                            className="shrink-0 rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
                          >
                            {loading[u.id] ? "Adding..." : "Add"}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            )}

            {error && <p className="text-center text-sm text-red-500">{error}</p>}
          </div>

          <div className="mt-4 shrink-0 border-t border-border pt-4">
            <button
              type="button"
              onClick={handleLeave}
              disabled={loading[currentUser.id]}
              className="w-full rounded-xl bg-red-500/10 py-2.5 text-sm font-semibold text-red-500 transition hover:bg-red-500/20 disabled:opacity-50"
            >
              {loading[currentUser.id] ? "Leaving..." : "Leave group"}
            </button>
          </div>
        </div>
      </div>

      {showTimer && (
        <DisappearingModal
          conversation={conversation}
          canEdit={isAdmin}
          onClose={() => setShowTimer(false)}
        />
      )}

      {profileContact && (
        <ProfileModal
          contact={profileContact}
          onClose={() => setProfileContact(null)}
        />
      )}
    </>
  );
}