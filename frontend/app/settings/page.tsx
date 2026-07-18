"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, Monitor, Moon, Shield, Sun } from "lucide-react";

import { useStore } from "@/store/useStore";

export default function SettingsPage() {
  const router = useRouter();
  const { user, token, isHydrated, darkMode, setDarkMode, logout } = useStore();

  useEffect(() => {
    if (isHydrated && !token) {
      router.replace("/login");
    }
  }, [isHydrated, token, router]);

  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

  if (!isHydrated || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-panel px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-lg p-2 text-muted transition hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold text-foreground">Settings</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <section className="mb-6 overflow-hidden rounded-2xl border border-border bg-panel shadow-sm">
          <div className="border-b border-border px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Account
            </p>
            <p className="mt-1 font-medium text-foreground">{user.display_name}</p>
            <p className="text-sm text-muted">{user.phone_number}</p>
          </div>
        </section>

        <section className="mb-6 overflow-hidden rounded-2xl border border-border bg-panel shadow-sm">
          <SettingsRow
            icon={<Shield className="h-5 w-5" />}
            title="Privacy"
            subtitle="Blocked contacts, read receipts"
          />
          <SettingsRow
            icon={<Monitor className="h-5 w-5" />}
            title="Notifications"
            subtitle="Sounds, previews, mute"
          />
          <div className="flex items-center justify-between border-t border-border px-5 py-4">
            <div className="flex items-center gap-3">
              {darkMode ? (
                <Moon className="h-5 w-5 text-muted" />
              ) : (
                <Sun className="h-5 w-5 text-muted" />
              )}
              <div>
                <p className="font-medium text-foreground">Appearance</p>
                <p className="text-sm text-muted">Dark mode</p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={darkMode}
              onClick={() => setDarkMode(!darkMode)}
              className={`relative h-7 w-12 rounded-full transition ${
                darkMode ? "bg-accent" : "bg-zinc-300"
              }`}
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${
                  darkMode ? "left-5" : "left-0.5"
                }`}
              />
            </button>
          </div>
          <SettingsRow
            icon={<Monitor className="h-5 w-5" />}
            title="Linked Devices"
            subtitle="Coming Soon"
            disabled
          />
        </section>

        <button
          type="button"
          onClick={handleLogout}
          className="w-full rounded-2xl border border-red-200 bg-panel py-3 text-sm font-semibold text-red-600 transition hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30"
        >
          Log out
        </button>
      </main>
    </div>
  );
}

function SettingsRow({
  icon,
  title,
  subtitle,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="flex w-full items-center justify-between border-t border-border px-5 py-4 text-left first:border-t-0 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="flex items-center gap-3">
        <span className="text-muted">{icon}</span>
        <div>
          <p className="font-medium text-foreground">{title}</p>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
      </div>
      {!disabled && <ChevronRight className="h-5 w-5 text-muted" />}
    </button>
  );
}
