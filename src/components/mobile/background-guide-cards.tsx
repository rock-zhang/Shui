"use client";

import { Fragment, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import type { RomProfile } from "@/lib/rom";
import { useI18n } from "@/lib/i18n";

type Command = "open_autostart_settings" | "open_app_settings";

/**
 * 打开后台相关系统设置页。三步引导、漏提醒弹窗、通知体检共用这一条路径，
 * 保证三处点「去设置」落到同一页，埋点口径也一致。
 */
export async function openBackgroundSetting(command: Command, source: string) {
  track("settings_opened", {
    target: command === "open_autostart_settings" ? "autostart" : "app_details",
    source,
  });
  // 只有三步引导内的点击才算 guide_step_action；其它入口只记 settings_opened。
  if (source.startsWith("guide")) {
    track("guide_step_action", {
      step: 2,
      action:
        command === "open_autostart_settings" ? "open_autostart" : "open_app_details",
    });
  }
  await invoke(command);
}

/**
 * 两个后台开关的分步引导。
 *
 * 自启动和「完全后台行为」是两道独立的门、入口也常常不在同一页，所以分别
 * 给出路径、分别提供入口。厂商开关没有公开 API，App 读不到真实状态，因此
 * 不保存、也不展示「已开启」——每次出现都请用户按路径自己检查一遍。
 */
export function BackgroundGuideCards({
  rom,
  source = "unknown",
}: {
  rom: RomProfile;
  /** 埋点来源：三步引导 guide_step3 / 漏提醒弹窗 missed_dialog。 */
  source?: string;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState<Command | null>(null);

  async function open(command: Command) {
    setPending(command);
    try {
      await openBackgroundSetting(command, source);
    } catch {
      toast.error(t("mobile.guide.background.openFailed"));
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <div className="space-y-2">
        <SettingCard
          step={1}
          label={rom.autostartLabel}
          path={rom.autostartPath}
          hint={rom.autostartHint}
          alternate={rom.autostartAlt}
          disabled={pending !== null}
          onOpen={() => void open("open_autostart_settings")}
        />
        <SettingCard
          step={2}
          label={rom.backgroundLabel}
          path={rom.backgroundPath}
          hint={rom.backgroundHint}
          alternate={rom.backgroundAlt}
          disabled={pending !== null}
          onOpen={() => void open("open_app_settings")}
        />
      </div>
      <p className="mt-1.5 px-1 text-[11px] leading-4 text-muted-foreground">
        {t("mobile.guide.background.footnote")}
      </p>
    </div>
  );
}

function SettingCard({
  step,
  label,
  path,
  hint,
  alternate,
  disabled,
  onOpen,
}: {
  step: number;
  label: string;
  path: string[];
  hint: string;
  alternate?: string;
  disabled: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-semibold text-amber-600 dark:text-amber-400">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-5 text-foreground">
            {t("mobile.guide.background.check", { label })}
          </p>

          {/* 面包屑按真实设置层级排列，相当于给用户一张可照抄的路径截图。 */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1">
            {path.map((node, index) => {
              const last = index === path.length - 1;
              return (
                <Fragment key={`${node}-${index}`}>
                  {index > 0 && (
                    <ChevronRight
                      aria-hidden="true"
                      className="h-3 w-3 shrink-0 text-muted-foreground/50"
                    />
                  )}
                  <span
                    className={
                      last
                        ? "rounded-md bg-background/90 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-foreground ring-1 ring-border/70"
                        : "rounded-md bg-background/60 px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground ring-1 ring-border/50"
                    }
                  >
                    {node}
                  </span>
                </Fragment>
              );
            })}
          </div>

          <p className="mt-1.5 text-xs leading-[18px] text-foreground/75">{hint}</p>
          {alternate && (
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              {alternate}
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={onOpen}
        className="mt-2.5 flex min-h-8 w-full items-center justify-center gap-1 rounded-xl border border-amber-500/40 bg-amber-500/10 py-1.5 text-xs font-medium text-amber-700 transition-colors active:bg-amber-500/15 disabled:opacity-60 dark:text-amber-300"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        {t("mobile.guide.background.openSettings")}
      </button>
    </div>
  );
}
