"use client";

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "next-themes";
import { usePlatform } from "./use-platform";

/**
 * Android 的状态栏 / 手势导航条与页面用同一底色。
 *
 * XML 主题（values / values-night）只能跟随系统深浅色，而 App 内的
 * next-themes 可以独立选择「浅色 / 深色 / 跟随系统」。用户在亮色系统里
 * 手动选深色时，若不做这一层同步，状态栏会留成白色、图标也是深色。
 *
 * resolvedTheme 是 next-themes 解析后的实际主题（system 会自动展开），
 * 且会随系统 matchMedia 变化更新，所以覆盖手动切换与跟随系统两种情况。
 */
export function useSystemBars() {
  const { resolvedTheme } = useTheme();
  const { isAndroid } = usePlatform();

  useEffect(() => {
    if (!isAndroid || !resolvedTheme) return;

    const dark = resolvedTheme === "dark";
    const apply = () => {
      invoke("set_system_bar_theme", { dark }).catch(() => {
        // 桌面浏览器预览没有这个原生命令，静默忽略。
      });
    };

    apply();
    // 从系统设置页 / 分享面板返回时，部分 ROM 会重绘系统栏，再刷一次。
    const onVisible = () => {
      if (document.visibilityState === "visible") apply();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [isAndroid, resolvedTheme]);
}
