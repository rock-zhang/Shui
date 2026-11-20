"use client";

import { cn } from "@/lib/utils";

/**
 * 「有新版本」红点。
 *
 * 绝对定位，父元素必须是 `relative`。位置交给调用方——贴在 22px 图标上
 * 和贴在整行右侧需要完全不同的偏移量，写死一个值在哪都用不对。
 *
 * 不加 ping 循环动画：移动端 WebView 里常驻动画会持续唤醒渲染管线，
 * 一个提示红点不值得耗这个电。
 */
export function UpdateDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute h-2 w-2 rounded-full bg-red-500 ring-2 ring-background",
        className
      )}
    />
  );
}
