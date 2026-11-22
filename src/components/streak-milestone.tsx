"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { onRefresh } from "@/lib/mobile";
import { ackStreak, getStreak } from "@/lib/streak";
import { useDayChange } from "@/hooks/use-day-change";

/**
 * 桌面端的连续达标里程碑提示。
 *
 * 连续天数与里程碑都由 Rust 计算；这里只在启动、刷新广播与跨天时复查一次，
 * 把未庆祝的里程碑提示一次并写回。移动端在「今日」页内处理同一件事，
 * 两端不会同时挂载。
 */
export function StreakMilestoneWatcher() {
  const { t } = useI18n();
  const lastCurrent = useRef<number | null>(null);
  const shownMilestone = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const streak = await getStreak();
      if (cancelled || !streak) return;
      if (streak.current === 0) {
        if (lastCurrent.current !== 0) void ackStreak(0);
      } else if (streak.milestone > 0 && shownMilestone.current !== streak.milestone) {
        shownMilestone.current = streak.milestone;
        toast.success(t("streak.milestone", { days: streak.milestone }));
        void ackStreak(streak.milestone);
      }
      lastCurrent.current = streak.current;
    };

    void check();
    const stop = onRefresh(() => void check());
    return () => {
      cancelled = true;
      stop();
    };
  }, [t]);

  // 设置窗口常开时跨过零点不会重新挂载，主动复查一次。
  useDayChange(() => {
    void getStreak().then((streak) => {
      if (!streak) return;
      if (streak.current === 0 && lastCurrent.current !== 0) void ackStreak(0);
      lastCurrent.current = streak.current;
    });
  });

  return null;
}
