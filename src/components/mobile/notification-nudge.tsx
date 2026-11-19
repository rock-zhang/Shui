"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { useI18n } from "@/lib/i18n";
import { useMobileConfig } from "./config-context";
import { useNotificationPermission } from "./notification-permission-context";

/**
 * 「稍后」的静默期。刻意不做「永久关闭」：这张卡是未授权状态下唯一的入口，
 * 永久关掉等于用户亲手把这个 App 的核心功能藏起来，以后再也找不到。
 */
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const SNOOZE_KEY = "shui:notif-nudge-until";

function readSnoozeUntil(): number {
  try {
    const raw = Number(window.localStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(raw) ? raw : 0;
  } catch {
    // 存储被禁用时当作没点过「稍后」。
    return 0;
  }
}

/**
 * 今日 tab 顶部的通知权限提示卡。
 *
 * 没有 POST_NOTIFICATIONS 时，Kotlin 里 `manager.notify()` 抛的 SecurityException
 * 被吞掉，闹钟照常触发、通知被系统丢弃——用户看到的是「提醒已开启」但在外面
 * 一整天毫无动静。这种静默失效必须有一处可见提示，否则只能等用户卸载。
 *
 * 只提通知权限，不提精确闹钟 / 电池白名单：前者的后果是 100% 收不到，
 * 后两者只是「可能延迟」，混在一起会稀释这句话的分量。
 */
export function NotificationNudge() {
  const { t } = useI18n();
  const { general, hydrated } = useMobileConfig();
  const { permission, canRequest, request } = useNotificationPermission();
  const [snoozeUntil, setSnoozeUntil] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  // 在 effect 里读，避免静态导出时首帧与客户端不一致。读到之前保持 null，
  // 否则点过「稍后」的用户每次冷启动都会看到卡片闪一下再消失。
  useEffect(() => {
    setSnoozeUntil(readSnoozeUntil());
  }, []);

  const snooze = useCallback(() => {
    track("notification_nudge_action", {
      action: "snooze",
      can_request: canRequest,
    });
    const until = Date.now() + SNOOZE_MS;
    setSnoozeUntil(until);
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(until));
    } catch {
      // 只在本次会话内生效，不影响功能。
    }
  }, [canRequest]);

  async function go() {
    setPending(true);
    track("notification_nudge_action", {
      action: "allow",
      can_request: canRequest,
    });
    try {
      await request("nudge");
    } finally {
      setPending(false);
    }
  }

  // 用户自己关掉了「系统通知」开关、或者暂停了提醒，就是明确表示不想被提醒，
  // 此时再催权限纯属骚扰。
  const wanted = general.isNotification && !general.isPaused;
  const visible =
    hydrated &&
    wanted &&
    permission === "denied" &&
    snoozeUntil !== null &&
    Date.now() >= snoozeUntil;

  const shownLogged = useRef(false);
  useEffect(() => {
    if (!visible || shownLogged.current) return;
    shownLogged.current = true;
    track("notification_nudge_shown", { can_request: canRequest });
  }, [visible, canRequest]);

  if (!visible) return null;

  return (
    <section
      aria-label={t("mobile.nudge.aria")}
      className="mb-3 mt-1 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5"
    >
      <div className="flex gap-2.5">
        <BellOff
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-5 text-amber-700 dark:text-amber-300">
            {t("mobile.nudge.title")}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-amber-700/80 dark:text-amber-300/70">
            {canRequest
              ? t("mobile.nudge.body.requestable")
              : t("mobile.nudge.body.blocked")}
          </p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="min-h-9 text-amber-700 hover:bg-amber-500/15 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-400/15 dark:hover:text-amber-200"
          onClick={snooze}
        >
          {t("mobile.nudge.later")}
        </Button>
        <Button
          size="sm"
          disabled={pending}
          className="min-h-9 bg-amber-600 text-white shadow-none hover:bg-amber-700 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
          onClick={() => void go()}
        >
          {t("mobile.nudge.allow")}
        </Button>
      </div>
    </section>
  );
}
