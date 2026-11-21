"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useState } from "react";
import { useTray } from "@/hooks/use-tray";
import { invoke } from "@tauri-apps/api/core";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { usePlatform } from "@/hooks/use-platform";
import { track } from "@/lib/analytics";
import { useI18n, type Locale } from "@/lib/i18n";
import { useCalendarSettings } from "@/hooks/use-calendar-settings";
import { WorkCalendarSettings } from "@/components/work-calendar-settings";

const goldList = ["1000", "1500", "2000", "2500", "3000", "3500", "4000"];
const gapList = ["10", "20", "30", "45", "60"];
if (process.env.NODE_ENV === "development") {
  gapList.unshift("1");
}

export default function Home() {
  const { t, locale } = useI18n();
  const { config, ready, saving, loadError, loadConfig, savePatch } = useCalendarSettings(gapList);
  const [installedApps, setInstalledApps] = useState<string[]>([]);
  const { isMacOS } = usePlatform();

  useEffect(() => {
    // 加载已安装应用列表
    if (isMacOS) {
      invoke<string[]>("get_installed_apps").then(setInstalledApps);
    }
  }, [isMacOS]);

  useTray();

  const saveConfig = async (
    filed: string,
    value: string | number[] | string[]
  ) => {
    const mapping: Record<string, string> = {
      gold: "goal_ml",
      gap: "gap",
      weekdays: "weekdays",
    };
    const format = (input: unknown) =>
      Array.isArray(input) ? input.join(",") : String(input ?? "none");
    track("setting_changed", {
      key: mapping[filed] ?? filed,
      from: format(
        (config as unknown as Record<string, unknown>)[filed]
      ),
      to: format(value),
      reschedule: true,
    });

    return savePatch({ [filed]: value });
  };

  const selectedApp = config.whitelist_apps.filter((app) =>
    installedApps.includes(app)
  );

  return (
    <div>
      <h3 className="mb-4 text-lg font-medium">
        {t("settings.reminder.title")}
      </h3>

      {loadError && <div role="alert" className="text-sm text-destructive mb-4">{t("calendar.loadFailed")} <Button variant="outline" size="sm" onClick={loadConfig}>{t("common.refresh")}</Button></div>}
      {!ready && !loadError && <p className="text-sm text-muted-foreground">{t("calendar.loading")}</p>}
      <fieldset disabled={!ready || saving} aria-busy={saving} className="min-w-0" data-reminder-settings-ready={String(ready && !saving)}>
      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {t("settings.reminder.goal.title")}
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            {t("settings.reminder.goal.description")}
          </p>
        </div>
        <Select
          value={config.gold}
          onValueChange={(value) => {
            saveConfig("gold", value);
          }}
          defaultValue={config.gold}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder={t("settings.reminder.goal.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{t("settings.reminder.goal.hint")}</SelectLabel>
              {goldList.map((gold) => (
                <SelectItem key={gold} value={gold}>
                  {t("settings.reminder.goal.option", { amount: gold })}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {t("settings.reminder.gap.title")}
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >{t("mobile.reminder.gap.description")}</p>
        </div>
        <Select
          value={config.gap}
          onValueChange={(value) => {
            saveConfig("gap", value);
          }}
          defaultValue={config.gap}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue
              placeholder={t("settings.reminder.gap.placeholder")}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {/* <SelectLabel>分钟</SelectLabel> */}
              {gapList.map((gap) => (
                <SelectItem key={gap} value={gap}>
                  {t("settings.reminder.gap.option", { minutes: gap })}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {ready && <WorkCalendarSettings config={config} onSave={savePatch} />}

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {t("settings.reminder.time.title")}
          </label>
          <p className="text-[0.8rem] text-muted-foreground">
            {t("settings.reminder.time.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={config.timeStart}
            onValueChange={(value) => {
              if (value >= config.timeEnd && config.timeEnd !== "00:00") {
                const nextTimeIndex = timeList.indexOf(value) + 1;
                const newEndTime = timeList[nextTimeIndex] || "00:00";
                savePatch({ timeStart: value, timeEnd: newEndTime });
                return;
              }
              saveConfig("timeStart", value);
            }}
            defaultValue={config.timeStart}
          >
            <SelectTrigger className="w-[104px]">
              <SelectValue
                placeholder={t("settings.reminder.time.start")}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {timeList.slice(0, -1).map((time) => (
                  <SelectItem key={time} value={time}>
                    {formatTimeOption(time, locale)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {t("settings.reminder.time.separator")}
          </span>
          <Select
            value={config.timeEnd}
            onValueChange={(value) => {
              saveConfig("timeEnd", value);
            }}
            defaultValue={config.timeEnd}
          >
            <SelectTrigger className="w-[104px]">
              <SelectValue placeholder={t("settings.reminder.time.end")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {[
                  ...timeList.filter((time) => time > config.timeStart),
                  "00:00",
                ].map((time) => (
                  <SelectItem key={time} value={time}>
                    {formatTimeOption(time, locale)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isMacOS && (
        <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
          <div>
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              {t("settings.reminder.whitelist.title")}
            </label>
            <p className="text-[0.8rem] text-muted-foreground">
              {t("settings.reminder.whitelist.description")}
            </p>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-[200px] h-auto min-h-[36px] justify-between"
              >
                <div className="flex flex-wrap gap-1 pr-2">
                  {selectedApp.length > 0 ? (
                    selectedApp.map((app) => (
                      <Badge
                        variant="secondary"
                        key={app}
                        className="truncate max-w-[120px]"
                      >
                        {app}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-muted-foreground">
                      {t("settings.reminder.whitelist.placeholder")}
                    </span>
                  )}
                </div>
                <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[200px] p-0"
              style={{ maxHeight: "300px" }}
            >
              <Command>
                <CommandInput
                  placeholder={t("settings.reminder.whitelist.search")}
                />
                <CommandEmpty>
                  {t("settings.reminder.whitelist.empty")}
                </CommandEmpty>
                <CommandGroup className="max-h-[250px] overflow-y-auto">
                  {installedApps.map((app) => (
                    <CommandItem
                      key={app}
                      onSelect={() => {
                        const newApps = selectedApp.includes(app)
                          ? selectedApp.filter((a) => a !== app)
                          : [...selectedApp, app];
                        saveConfig("whitelist_apps", newApps);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedApp.includes(app)
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      {app}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}

      </fieldset>
      {/* <div className="flex justify-end">
        <Button
          onClick={() => {
            invoke("call_reminder");
          }}
        >
          预览
        </Button>
      </div> */}
    </div>
  );
}

// 在文件顶部添加时间列表
// 修改时间列表生成逻辑
const timeList = [
  ...Array.from({ length: 24 }, (_, i) => {
    const hour = i.toString().padStart(2, "0");
    return [`${hour}:00`, `${hour}:30`];
  }).flat(),
  "00:00", // 添加 0 点选项
];

/** 存储值始终是 24h 字符串，仅在显示层按语言派生 12/24 小时制标签。 */
function formatTimeOption(value: string, locale: Locale): string {
  if (locale !== "en-US") return value;
  const [hour, minute] = value.split(":").map(Number);
  const suffix = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute.toString().padStart(2, "0")} ${suffix}`;
}
