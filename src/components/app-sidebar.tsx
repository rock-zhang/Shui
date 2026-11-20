"use client";
import { AlarmClock, Keyboard, Settings, Info, Droplets } from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChartNoAxesCombined } from "lucide-react";
import { cn } from "@/lib/utils";
import { DatabaseBackup } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { usePlatform } from "@/hooks/use-platform";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useUpdate } from "@/components/update-provider";
import { UpdateDot } from "@/components/ui/update-dot";

const items: Array<{ titleKey: MessageKey; url: string; icon: typeof Settings }> = [
  {
    titleKey: "settings.nav.general",
    url: "/setting/",
    icon: Settings,
  },
  {
    titleKey: "settings.nav.reminder",
    url: "/setting/reminder/",
    icon: AlarmClock,
  },
  {
    titleKey: "settings.nav.history",
    url: "/setting/history/",
    icon: Droplets,
  },
  {
    titleKey: "settings.nav.shortcut",
    url: "/setting/shortcut/",
    icon: Keyboard, // 使用 Keyboard 图标替换 Search
  },
  {
    titleKey: "settings.nav.data",
    url: "/setting/data/",
    icon: DatabaseBackup,
  },
  {
    titleKey: "settings.nav.statistics",
    url: "/setting/statistics/",
    icon: ChartNoAxesCombined,
  },
  {
    titleKey: "settings.nav.about",
    url: "/setting/about/",
    icon: Info,
  },
];

export function AppSidebar() {
  const { isMacOS } = usePlatform();
  const { t } = useI18n();
  const { available, seen } = useUpdate();

  const pathname = usePathname();
  // 「关于」是桌面端唯一的更新入口，红点挂在它上面；进过关于页就灭。
  const showUpdateDot = available && !seen;

  return (
    <Sidebar collapsible="none" className={`${isMacOS ? "pt-8" : "pt-0"}`}>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    className={cn(
                      pathname === item.url &&
                        "bg-accent text-accent-foreground"
                    )}
                  >
                    <Link href={item.url} className="relative">
                      <item.icon />
                      <span>{t(item.titleKey)}</span>
                      {item.url === "/setting/about/" && showUpdateDot && (
                        <UpdateDot className="right-2 top-1/2 -translate-y-1/2" />
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
