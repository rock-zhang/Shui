"use client";

import { useEffect, useState } from "react";
import { MobileApp } from "@/components/mobile/mobile-app";
import { detectPlatform } from "@/lib/mobile";

type Shell = "loading" | "mobile" | "desktop";

/**
 * Tauri mobile loads the root index.html, so the mobile shell lives here rather
 * than behind a redirect (which would flash a white page on a static export).
 * The desktop window still points at /setting/, so this stays a no-op for it.
 */
export default function Home() {
  const [shell, setShell] = useState<Shell>("loading");

  useEffect(() => {
    const kind = detectPlatform();
    setShell(kind === "android" || kind === "ios" ? "mobile" : "desktop");
  }, []);

  // Neutral first frame: no desktop flash, no hydration mismatch.
  if (shell === "loading") {
    return <div className="h-dvh w-full bg-background" aria-hidden="true" />;
  }
  if (shell === "mobile") return <MobileApp />;
  // 桌面窗口直接指向 /setting/，这里仅作为不应到达的中性兜底，不显示任何语言相关的占位文案。
  return <div className="h-dvh w-full bg-background" aria-hidden="true" />;
}
