"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import Avatar from "@/components/Avatar";
import { blockContact, unblockContact } from "@/lib/api";
import { useStore } from "@/store/useStore";
import type { Contact } from "@/types";

interface ProfileModalProps {
  contact: Contact;
  onClose: () => void;
}

export default function ProfileModal({ contact, onClose }: ProfileModalProps) {
  const loadContacts = useStore((s) => s.loadContacts);
  const [isBlocked, setIsBlocked] = useState(contact.is_blocked);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleToggleBlock = async () => {
    setLoading(true);
    setError("");
    try {
      if (isBlocked) {
        await unblockContact(contact.id);
        setIsBlocked(false);
      } else {
        await blockContact(contact.id);
        setIsBlocked(true);
      }
      await loadContacts();
    } catch {
      setError(isBlocked ? "Failed to unblock" : "Failed to block");
    } finally {
      setLoading(false);
    }
  };

  const user = contact.contact_user;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-panel p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Profile</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-3 py-4">
          <Avatar name={user.display_name} src={user.avatar_url} size="lg" />
          <div className="text-center">
            <p className="text-lg font-semibold text-foreground">
              {user.display_name}
            </p>
            {user.username && (
              <p className="text-sm text-muted">@{user.username}</p>
            )}
          </div>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              Phone number
            </p>
            <p className="text-sm text-foreground">{user.phone_number}</p>
          </div>
          {user.status_message && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted">
                About
              </p>
              <p className="text-sm text-foreground">{user.status_message}</p>
            </div>
          )}
        </div>

        {error && (
          <p className="mt-3 text-center text-sm text-red-500">{error}</p>
        )}

        <button
          type="button"
          onClick={handleToggleBlock}
          disabled={loading}
          className={`mt-6 w-full rounded-xl py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
            isBlocked
              ? "bg-accent/10 text-accent hover:bg-accent/20"
              : "bg-red-500/10 text-red-500 hover:bg-red-500/20"
          }`}
        >
          {loading
            ? isBlocked
              ? "Unblocking..."
              : "Blocking..."
            : isBlocked
              ? "Unblock"
              : "Block"}
        </button>
      </div>
    </div>
  );
}