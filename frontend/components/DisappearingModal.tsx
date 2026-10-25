"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Check, X } from "lucide-react";

import { DISAPPEAR_OPTIONS } from "@/lib/utils";
import { useStore } from "@/store/useStore";
import type { Conversation } from "@/types";

interface DisappearingModalProps {
  conversation: Conversation;
  /** Groups restrict this setting to admins. */
  canEdit: boolean;
  onClose: () => void;
}

export default function DisappearingModal({
  conversation,
  canEdit,
  onClose,
}: DisappearingModalProps) {
  const setDisappearTimer = useStore((s) => s.setDisappearTimer);
  const addToast = useStore((s) => s.addToast);
  const [saving, setSaving] = useState<number | null | undefined>(undefined);
  const current = conversation.disappear_after_seconds ?? null;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const choose = async (seconds: number | null) => {
    if (!canEdit || seconds === current) return;
    setSaving(seconds);
    try {
      await setDisappearTimer(conversation.id, seconds);
      onClose();
    } catch (err) {
      const detail =
        axios.isAxiosError(err) && typeof err.response?.data?.detail === "string"
          ? err.response.data.detail
          : "Couldn't change the timer";
      addToast("Disappearing messages", detail);
    } finally {
      setSaving(undefined);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-label="Disappearing messages"
        className="w-full max-w-sm rounded-2xl bg-panel p-6 shadow-xl"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Disappearing messages</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-muted hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm text-muted">
          {canEdit
            ? "New messages in this chat will disappear after the time you choose."
            : "Only group admins can change this setting."}
        </p>
        <ul className="space-y-1">
          {DISAPPEAR_OPTIONS.map((option) => (
            <li key={option.label}>
              <button
                type="button"
                disabled={!canEdit || saving !== undefined}
                onClick={() => choose(option.seconds)}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm text-foreground transition hover:bg-black/[0.04] disabled:opacity-60 dark:hover:bg-white/[0.06]"
              >
                {option.label}
                {current === option.seconds && <Check className="h-4 w-4 text-accent" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
