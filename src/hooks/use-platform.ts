import { useState, useEffect } from "react";
import { platform } from "@tauri-apps/plugin-os";
import { PLATFORM_OS } from "@/lib/constants";

export function usePlatform() {
  const [isMacOS, setIsMacOS] = useState(false);
  const [isWindows, setIsWindows] = useState(false);

  useEffect(() => {
    // 检查操作系统
    const currentPlatform = platform();
    setIsMacOS(currentPlatform === PLATFORM_OS.MACOS);
    setIsWindows(currentPlatform === PLATFORM_OS.WINDOWS);
  }, []);

  return {
    isWindows,
    isMacOS,
  };
}
