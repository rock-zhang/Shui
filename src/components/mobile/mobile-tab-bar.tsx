"use client";

import {
  BellRing,
  ChartNoAxesCombined,
  Droplets,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { MobileTabId } from "@/lib/mobile";
import { cn } from "@/lib/utils";

export const MOBILE_TABS: ReadonlyArray<{
  id: MobileTabId;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "today", label: "今日", icon: Droplets },
  { id: "reminder", label: "提醒", icon: BellRing },
  { id: "data", label: "数据", icon: ChartNoAxesCombined },
  { id: "me", label: "我的", icon: UserRound },
];

export function MobileTabBar({
  active,
  onChange,
}: {
  active: MobileTabId;
  onChange: (id: MobileTabId) => void;
}) {
  return (
    <nav
      className="mobile-tab-bar flex shrink-0 items-stretch px-2 pt-1.5"
      aria-label="主导航"
    >
      {MOBILE_TABS.map((tab) => {
        const selected = active === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl transition-colors",
              selected ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon
              className="h-[22px] w-[22px]"
              strokeWidth={selected ? 2.2 : 1.8}
            />
            <span
              className={cn(
                "text-[11px] leading-none",
                selected && "font-semibold"
              )}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
