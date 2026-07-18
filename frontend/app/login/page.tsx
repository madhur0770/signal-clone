"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";

import { requestOtp } from "@/lib/api";
import { useStore } from "@/store/useStore";

type Step = "phone" | "otp";

export default function LoginPage() {
  const router = useRouter();
  const { token, isHydrated, login } = useStore();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("+15550010001");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isHydrated && token) {
      router.replace("/");
    }
  }, [isHydrated, token, router]);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await requestOtp(phone);
      setStep("otp");
    } catch {
      setError("Could not send OTP. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(
        phone,
        otp,
        username || undefined,
        displayName || undefined
      );
      router.replace("/");
    } catch {
      setError("Invalid OTP. Use 123456 for the mock code.");
    } finally {
      setLoading(false);
    }
  };

  if (!isHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-login-gradient">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-login-gradient px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
            <MessageSquare className="h-8 w-8 text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Signal</h1>
          <p className="mt-2 text-sm text-white/75">
            Private messaging, beautifully simple
          </p>
        </div>

        <div className="rounded-2xl bg-panel p-8 shadow-2xl">
          {step === "phone" ? (
            <form onSubmit={handleRequestOtp} className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  Sign in
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Enter your phone number to receive a verification code.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Phone number
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+15551234567"
                  required
                  className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Username <span className="font-normal text-muted">(new users)</span>
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="alice"
                  className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Display name <span className="font-normal text-muted">(new users)</span>
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Alice Chen"
                  className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !phone.trim()}
                className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white shadow-md transition hover:bg-accent-hover disabled:opacity-50"
              >
                {loading ? "Sending…" : "Continue"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerify} className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  Enter verification code
                </h2>
                <p className="mt-1 text-sm text-muted">
                  We sent a code to{" "}
                  <span className="font-medium text-foreground">{phone}</span>.
                  Mock code: <span className="font-mono font-semibold text-accent">123456</span>
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  6-digit code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  required
                  autoFocus
                  className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-center text-2xl font-semibold tracking-[0.4em] text-foreground placeholder:tracking-normal placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>

              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white shadow-md transition hover:bg-accent-hover disabled:opacity-50"
              >
                {loading ? "Verifying…" : "Verify & sign in"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setOtp("");
                  setError("");
                }}
                className="w-full text-sm text-muted transition hover:text-foreground"
              >
                ← Change phone number
              </button>
            </form>
          )}

          {error && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-white/60">
          Seeded users: +15550010001 – +15550010005 · OTP always 123456
        </p>
      </div>
    </div>
  );
}
