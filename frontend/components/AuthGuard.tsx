"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useStore } from "@/store/useStore";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token, isHydrated, bootstrap, isLoading, conversations } = useStore();

  useEffect(() => {
    if (isHydrated && !token) {
      router.replace("/login");
    }
  }, [isHydrated, token, router]);

  useEffect(() => {
    if (isHydrated && token) {
      bootstrap();
    }
  }, [isHydrated, token, bootstrap]);

  if (!isHydrated || !token) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (isLoading && conversations.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
