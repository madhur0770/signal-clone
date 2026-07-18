"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { useStore } from "@/store/useStore";

interface NewChatModalProps {
  mode: "direct" | "group";
  onClose: () => void;
}

export default function NewChatModal({ mode, onClose }: NewChatModalProps) {
  const contacts = useStore((s) => s.contacts);
  const startDirectChat = useStore((s) => s.startDirectChat);
  const startGroupChat = useStore((s) => s.startGroupChat);
  const selectConversation = useStore((s) => s.selectConversation);

  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggleMember = (id: number) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleDirect = async (contactUserId: number) => {
    setLoading(true);
    setError("");
    try {
      const conversation = await startDirectChat(contactUserId);
      await selectConversation(conversation.id);
      onClose();
    } catch {
      setError("Could not start chat");
    } finally {
      setLoading(false);
    }
  };

  const handleGroup = async () => {
    if (!groupName.trim() || selected.length === 0) return;
    setLoading(true);
    setError("");
    try {
      const conversation = await startGroupChat(groupName.trim(), selected);
      await selectConversation(conversation.id);
      onClose();
    } catch {
      setError("Could not create group");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-panel p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {mode === "direct" ? "New chat" : "New group"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {mode === "group" && (
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group name"
            className="mb-4 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        )}

        {contacts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            No contacts yet. Add contacts via the API or seed data.
          </p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {contacts.map((contact) => (
              <li key={contact.id}>
                {mode === "direct" ? (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleDirect(contact.contact_user_id)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.06] disabled:opacity-50"
                  >
                    <span className="font-medium text-foreground">
                      {contact.nickname ?? contact.contact_user.display_name}
                    </span>
                  </button>
                ) : (
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]">
                    <input
                      type="checkbox"
                      checked={selected.includes(contact.contact_user_id)}
                      onChange={() => toggleMember(contact.contact_user_id)}
                      className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
                    />
                    <span className="font-medium text-foreground">
                      {contact.contact_user.display_name}
                    </span>
                  </label>
                )}
              </li>
            ))}
          </ul>
        )}

        {mode === "group" && (
          <button
            type="button"
            onClick={handleGroup}
            disabled={loading || !groupName.trim() || selected.length === 0}
            className="mt-4 w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:opacity-50"
          >
            Create group
          </button>
        )}

        {error && (
          <p className="mt-3 text-center text-sm text-red-500">{error}</p>
        )}
      </div>
    </div>
  );
}
