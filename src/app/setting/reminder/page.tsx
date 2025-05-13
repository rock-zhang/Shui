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
import { load } from "@tauri-apps/plugin-store";
import { useTray } from "@/hooks/use-tray";
import { invoke } from "@tauri-apps/api/core";
import { STORE_NAME } from "@/lib/constants";
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
import { useI18n } from "@/i18n/provider";

const goldList = ["1000", "1500", "2000", "2500", "3000", "3500", "4000"];
const gapList = ["10", "20", "30", "45", "60"];

if (process.env.NODE_ENV === "development") {
  gapList.unshift("1");
}

// 在文件顶部添加时间列表
const timeList = Array.from({ length: 24 }, (_, i) => {
  const hour = i.toString().padStart(2, "0");
  return [`${hour}:00`, `${hour}:30`];
}).flat();

export default function Home() {
  const { t } = useI18n();
  const [config, setConfig] = useState({
    gold: goldList[0],
    gap: gapList[0],
    weekdays: [] as number[],
    timeStart: "09:00",
    timeEnd: "18:00",
    whitelist_apps: [] as string[],
  });
  const [installedApps, setInstalledApps] = useState<string[]>([]);
  const { isWindows } = usePlatform();

  useEffect(() => {
    // 加载已安装应用列表
    if (!isWindows) {
      invoke<string[]>("get_installed_apps").then(setInstalledApps);
    }
  }, [isWindows]);

  useTray();

  useEffect(() => {
    async function loadConfig() {
      const store = await load(STORE_NAME.config, { autoSave: false });
      const val = await store.get<{
        gold: string;
        gap: string;
        weekdays: number[];
        timeStart: string;
        timeEnd: string;
      }>("alert");
      setConfig({
        ...config,
        ...val,
      });
    }

    loadConfig();
  }, []);

  const saveConfig = async (
    filed: string,
    value: string | number[] | string[]
  ) => {
    setConfig({
      ...config,
      [filed]: value,
    });

    const store = await load(STORE_NAME.config, { autoSave: false });
    await store.set("alert", {
      ...config,
      [filed]: value,
    });
    await store.save();

    // 重置计时器
    invoke("reset_timer");
  };

  const selectedApp = config.whitelist_apps.filter((app) =>
    installedApps.includes(app)
  );

  // const weekDays = JSON.parse(t("settings.reminder.repeat.days")) as string[];

  return (
    <div>
      <h3 className="mb-4 text-lg font-medium">
        {t("settings.reminder.title")}
      </h3>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {t("settings.reminder.dailyGoal.title")}
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            {t("settings.reminder.dailyGoal.description")}
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
            <SelectValue
              placeholder={t("settings.reminder.dailyGoal.placeholder")}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>
                {t("settings.reminder.dailyGoal.suggestion")}
              </SelectLabel>
              {goldList.map((gold) => (
                <SelectItem key={gold} value={gold}>
                  {gold}ml
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {t("settings.reminder.interval.title")}
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          ></p>
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
              placeholder={t("settings.reminder.interval.placeholder")}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {gapList.map((gap) => (
                <SelectItem key={gap} value={gap}>
                  {gap}
                  {t("settings.reminder.interval.unit")}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {t("settings.reminder.repeat.title")}
          </label>
          <p className="text-[0.8rem] text-muted-foreground">
            {t("settings.reminder.repeat.description")}
          </p>
        </div>
        <div className="flex gap-2">
          {JSON.parse(t("settings.reminder.repeat.days")).map(
            (day: string, index: number) => (
              <button
                key={day}
                className={`h-8 w-8 rounded-full text-sm font-medium transition-colors cursor-pointer
                ${
                  config.weekdays?.includes(index)
                    ? "bg-primary text-primary-foreground"
                    : "border bg-background hover:bg-accent hover:text-accent-foreground"
                }`}
                onClick={() => {
                  const weekdays = config.weekdays || [];
                  const newWeekdays = weekdays.includes(index)
                    ? weekdays.filter((d) => d !== index)
                    : [...weekdays, index];

                  saveConfig("weekdays", newWeekdays);
                }}
              >
                {day}
              </button>
            )
          )}
        </div>
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {t("settings.reminder.timeRange.title")}
          </label>
          <p className="text-[0.8rem] text-muted-foreground">
            {t("settings.reminder.timeRange.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={config.timeStart}
            onValueChange={(value) => {
              if (value >= config.timeEnd && config.timeEnd !== "00:00") {
                const nextTimeIndex = timeList.indexOf(value) + 1;
                const newEndTime = timeList[nextTimeIndex] || "00:00";
                saveConfig("timeEnd", newEndTime);
              }
              saveConfig("timeStart", value);
            }}
            defaultValue={config.timeStart}
          >
            <SelectTrigger className="w-[90px]">
              <SelectValue
                placeholder={t("settings.reminder.timeRange.start")}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {timeList.slice(0, -1).map((time) => (
                  <SelectItem key={time} value={time}>
                    {time}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {t("settings.reminder.timeRange.to")}
          </span>
          <Select
            value={config.timeEnd}
            onValueChange={(value) => {
              saveConfig("timeEnd", value);
            }}
            defaultValue={config.timeEnd}
          >
            <SelectTrigger className="w-[90px]">
              <SelectValue placeholder={t("settings.reminder.timeRange.end")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {timeList.map((time) => (
                  <SelectItem key={time} value={time}>
                    {time}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {!isWindows && (
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
                  placeholder={t(
                    "settings.reminder.whitelist.searchPlaceholder"
                  )}
                />
                <CommandEmpty>{t("settings.reminder.whitelist.empty")}</CommandEmpty>
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
