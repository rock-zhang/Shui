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
import { emitRefresh } from "@/lib/mobile";
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
import {
  useI18n,
  WEEKDAY_LONG_KEYS,
  WEEKDAY_SHORT_KEYS,
  type Locale,
} from "@/lib/i18n";

const goldList = ["1000", "1500", "2000", "2500", "3000", "3500", "4000"];
const gapList = ["10", "20", "30", "45", "60"];
/** 星期缩写与全称共用一份映射，避免此处再手抄七行 key。 */
const weekdayKeys = WEEKDAY_SHORT_KEYS;

if (process.env.NODE_ENV === "development") {
  gapList.unshift("1");
}

export default function Home() {
  const { t, locale } = useI18n();
  const [config, setConfig] = useState({
    gold: goldList[0],
    gap: gapList[0],
    weekdays: [] as number[],
    timeStart: "09:00",
    timeEnd: "18:00",
    whitelist_apps: [] as string[],
  });
  const [installedApps, setInstalledApps] = useState<string[]>([]);
  const { isMacOS } = usePlatform();

  useEffect(() => {
    // 加载已安装应用列表
    if (isMacOS) {
      invoke<string[]>("get_installed_apps").then(setInstalledApps);
    }
  }, [isMacOS]);

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
      // 正式包的 gapList 不含 1 分钟测试档。旧 debug 配置若残留 gap="1"，
      // 下拉会显示空白、原生仍按 1 分钟提醒；归一到合法值并写回。
      if (val?.gap && !gapList.includes(val.gap)) {
        const normalized = { ...val, gap: "20" };
        await store.set("alert", normalized);
        await store.save();
        setConfig({ ...config, ...normalized });
        return;
      }
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
    // 目标等配置落盘后广播刷新，让喝水历史、统计等已挂载页面立即重读。
    emitRefresh();
  };

  const selectedApp = config.whitelist_apps.filter((app) =>
    installedApps.includes(app)
  );

  return (
    <div>
      <h3 className="mb-4 text-lg font-medium">
        {t("settings.reminder.title")}
      </h3>

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

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {t("settings.reminder.weekdays.title")}
          </label>
          <p className="text-[0.8rem] text-muted-foreground">
            {t("settings.reminder.weekdays.description")}
          </p>
        </div>
        <div className="flex gap-2">
          {weekdayKeys.map((key, index) => (
            <button
              key={key}
              type="button"
              aria-pressed={Boolean(config.weekdays?.includes(index))}
              aria-label={t(WEEKDAY_LONG_KEYS[index])}
              className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-medium transition-colors cursor-pointer
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
              <span aria-hidden="true">{t(key)}</span>
            </button>
          ))}
        </div>
      </div>

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
                saveConfig("timeEnd", newEndTime);
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
