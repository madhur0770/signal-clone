"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, Monitor, Moon, Shield, Sun } from "lucide-react";

import Avatar from "@/components/Avatar";
import { unblockContact } from "@/lib/api";
import { useStore } from "@/store/useStore";

export default function SettingsPage() {
  const router = useRouter();
  const { user, token, isHydrated, darkMode, setDarkMode, logout } = useStore();
  const contacts = useStore((s) => s.contacts);
  const loadContacts = useStore((s) => s.loadContacts);
  const updateProfile = useStore((s) => s.updateProfile);
  const addToast = useStore((s) => s.addToast);

  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);

  useEffect(() => {
    if (isHydrated && !token) {
      router.replace("/login");
    }
  }, [isHydrated, token, router]);

  // Contacts aren't loaded if you open /settings directly.
  useEffect(() => {
    if (isHydrated && token) loadContacts().catch(() => undefined);
  }, [isHydrated, token, loadContacts]);

  // Fill the form once per signed-in user (not on every keystroke-triggered re-render).
  if (user && loadedFor !== user.id) {
    setLoadedFor(user.id);
    setName(user.display_name);
    setAbout(user.status_message ?? "");
  }

  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

  if (!isHydrated || !user) {
    return (
      <div className="flex h-dvh items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  const blocked = contacts.filter((c) => c.is_blocked);
  const dirty =
    name.trim() !== user.display_name || about.trim() !== (user.status_message ?? "");

  const handleSave = async () => {
    if (!name.trim()) {
      addToast("Profile", "Your name can't be empty.");
      return;
    }
    setSaving(true);
    try {
      await updateProfile({ display_name: name.trim(), status_message: about.trim() });
      addToast("Profile", "Saved");
    } catch {
      addToast("Profile", "Couldn't save your changes.");
    } finally {
      setSaving(false);
    }
  };

  const handleUnblock = async (contactId: number) => {
    try {
      await unblockContact(contactId);
      await loadContacts();
    } catch {
      addToast("Privacy", "Couldn't unblock this contact.");
    }
  };

  return (
    <div className="min-h-dvh bg-surface">
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
          <div className="flex items-center gap-4 border-b border-border px-5 py-4">
            <Avatar name={user.display_name} src={user.avatar_url} size="lg" />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Profile</p>
              <p className="truncate font-medium text-foreground">@{user.username}</p>
              <p className="text-sm text-muted">{user.phone_number}</p>
            </div>
          </div>
          <div className="space-y-4 px-5 py-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-foreground">Name</span>
              <input
                value={name}
                maxLength={50}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-foreground">About</span>
              <input
                value={about}
                maxLength={140}
                placeholder="Say something about yourself"
                onChange={(e) => setAbout(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </label>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </section>

        <section className="mb-6 overflow-hidden rounded-2xl border border-border bg-panel shadow-sm">
          <button
            type="button"
            onClick={() => setShowBlocked((open) => !open)}
            aria-expanded={showBlocked}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <div className="flex items-center gap-3">
              <span className="text-muted">
                <Shield className="h-5 w-5" />
              </span>
              <div>
                <p className="font-medium text-foreground">Blocked contacts</p>
                <p className="text-sm text-muted">
                  {blocked.length === 0 ? "No one is blocked" : `${blocked.length} blocked`}
                </p>
              </div>
            </div>
            <ChevronRight
              className={`h-5 w-5 text-muted transition ${showBlocked ? "rotate-90" : ""}`}
            />
          </button>
          {showBlocked && (
            <ul className="border-t border-border">
              {blocked.length === 0 && (
                <li className="px-5 py-4 text-sm text-muted">
                  Block someone from their profile in a chat.
                </li>
              )}
              {blocked.map((contact) => (
                <li
                  key={contact.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      name={contact.contact_user.display_name}
                      src={contact.contact_user.avatar_url}
                      size="sm"
                    />
                    <span className="truncate text-sm font-medium text-foreground">
                      {contact.nickname || contact.contact_user.display_name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUnblock(contact.id)}
                    className="shrink-0 rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/20"
                  >
                    Unblock
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-6 overflow-hidden rounded-2xl border border-border bg-panel shadow-sm">
          <div className="flex items-center justify-between px-5 py-4">
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
              aria-label="Dark mode"
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
          <div className="flex w-full items-center justify-between border-t border-border px-5 py-4 opacity-50">
            <div className="flex items-center gap-3">
              <span className="text-muted">
                <Monitor className="h-5 w-5" />
              </span>
              <div>
                <p className="font-medium text-foreground">Linked Devices</p>
                <p className="text-sm text-muted">Coming Soon</p>
              </div>
            </div>
          </div>
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
