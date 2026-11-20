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
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useUpdate } from "@/components/update-provider";
import { UpdateDot } from "@/components/ui/update-dot";

export const MOBILE_TABS: ReadonlyArray<{
  id: MobileTabId;
  labelKey: MessageKey;
  icon: LucideIcon;
}> = [
  { id: "today", labelKey: "mobile.tab.today", icon: Droplets },
  { id: "reminder", labelKey: "mobile.tab.reminder", icon: BellRing },
  { id: "data", labelKey: "mobile.tab.data", icon: ChartNoAxesCombined },
  { id: "me", labelKey: "mobile.tab.me", icon: UserRound },
];

export function MobileTabBar({
  active,
  onChange,
}: {
  active: MobileTabId;
  onChange: (id: MobileTabId) => void;
}) {
  const { t } = useI18n();
  const { available, seen } = useUpdate();
  // 红点只挂「我」tab：更新入口在那儿（版本号 + 立即更新）。
  // 看过一次就灭（seen），避免红点常驻变成视觉噪音；版本行里的
  // 「新版本 x.y.z」标记会一直留着，直到真正装上。
  const showUpdateDot = available && !seen;
  return (
    <nav
      className="mobile-tab-bar flex shrink-0 items-stretch px-2 pt-1.5"
      aria-label={t("mobile.nav.label")}
    >
      {MOBILE_TABS.map((tab) => {
        const selected = active === tab.id;
        const Icon = tab.icon;
        const dot = tab.id === "me" && active !== "me" && showUpdateDot;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={selected ? "page" : undefined}
            aria-label={
              dot
                ? `${t(tab.labelKey)} - ${t("updater.badgeNew")}`
                : undefined
            }
            className={cn(
              "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl transition-colors",
              selected ? "text-primary" : "text-muted-foreground"
            )}
          >
            <span className="relative inline-flex">
              <Icon
                className="h-[22px] w-[22px]"
                strokeWidth={selected ? 2.2 : 1.8}
              />
              {dot && <UpdateDot className="-right-1 -top-0.5" />}
            </span>
            <span
              className={cn(
                "text-[11px] leading-none",
                selected && "font-semibold"
              )}
            >
              {t(tab.labelKey)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
