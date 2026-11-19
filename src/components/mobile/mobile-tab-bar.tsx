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
  return (
    <nav
      className="mobile-tab-bar flex shrink-0 items-stretch px-2 pt-1.5"
      aria-label={t("mobile.nav.label")}
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
              {t(tab.labelKey)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
