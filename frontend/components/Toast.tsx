"use client";

import { X } from "lucide-react";

import { useStore } from "@/store/useStore";

export default function ToastContainer() {
  const toasts = useStore((s) => s.toasts);
  const removeToast = useStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-start gap-3 rounded-xl bg-panel px-4 py-3 shadow-2xl ring-1 ring-black/5 animate-in slide-in-from-bottom-2"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {toast.title}
            </p>
            <p className="truncate text-sm text-muted">{toast.body}</p>
          </div>
          <button
            type="button"
            onClick={() => removeToast(toast.id)}
            className="shrink-0 rounded-lg p-1 text-muted hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}