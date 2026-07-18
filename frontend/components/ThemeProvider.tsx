"use client";

import { useEffect } from "react";

import { useStore } from "@/store/useStore";

export default function ThemeProvider() {
  const darkMode = useStore((s) => s.darkMode);
  const isHydrated = useStore((s) => s.isHydrated);

  useEffect(() => {
    if (isHydrated) {
      document.documentElement.classList.toggle("dark", darkMode);
    }
  }, [darkMode, isHydrated]);

  return null;
}
