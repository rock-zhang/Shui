"use client";

import { useEffect, useState } from "react";
import { PLATFORM_OS } from "@/lib/constants";
import { detectPlatform, type PlatformKind } from "@/lib/mobile";

/**
 * Synchronous, first-paint-correct platform detection.
 * The old effect-based version reported `false` for every platform on frame 1,
 * which made desktop-only controls briefly look enabled on mobile.
 */
export function usePlatform() {
  const [kind, setKind] = useState<PlatformKind>(() => detectPlatform());

  // On some webviews the native bridge is injected a tick after the first
  // render; retry once so macOS drag regions never get stuck disabled.
  useEffect(() => {
    if (kind !== "web") return;
    const retry = detectPlatform();
    if (retry !== "web") setKind(retry);
  }, [kind]);

  const isAndroid = kind === PLATFORM_OS.ANDROID;
  const isIOS = kind === PLATFORM_OS.IOS;
  const isMacOS = kind === PLATFORM_OS.MACOS;
  const isWindows = kind === PLATFORM_OS.WINDOWS;
  const isLinux = kind === PLATFORM_OS.LINUX;
  const isMobile = isAndroid || isIOS;

  return {
    kind,
    isAndroid,
    isIOS,
    isMacOS,
    isWindows,
    isLinux,
    isMobile,
    isDesktop: !isMobile,
    isTauri: kind !== "web",
  };
}
