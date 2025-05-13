"use client";
import { AlarmClock, Keyboard, Settings, Info } from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";

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

export function AppSidebar() {
  const { t } = useI18n();
  const { isMacOS } = usePlatform();
  const pathname = usePathname();
  console.log("pathname", pathname);

  const items = [
    {
      title: t("settings.title"),
      url: "/setting",
      icon: Settings,
    },
    {
      title: t("settings.reminder.title"),
      url: "/setting/reminder",
      icon: AlarmClock,
    },
    {
      title: t("settings.shortcut.title"),
      url: "/setting/shortcut",
      icon: Keyboard,
    },
    {
      title: t("settings.about.title"),
      url: "/setting/about",
      icon: Info,
    },
  ];

  return (
    <Sidebar collapsible="none" className={`${isMacOS ? "pt-8" : "pt-0"}`}>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                console.log(
                  "pathname === item.url",
                  pathname === item.url,
                  pathname,
                  item.url
                );
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      className={cn(
                        pathname === item.url &&
                          "bg-accent text-accent-foreground"
                      )}
                    >
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
