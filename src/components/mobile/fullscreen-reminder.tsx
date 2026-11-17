"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { ArrowRight, Droplets } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { STORE_NAME } from "@/lib/constants";
import {
  normalizeDrinkDay,
  type DrinkHistoryValue,
  type DrinkReceipt,
} from "@/lib/drink-day";
import { getLocalDateKey } from "@/lib/drink-history";
import { notifyGoalReached } from "@/lib/mobile";

/** Same 15-layer rainbow backdrop as the desktop reminder, scoped to this card. */
const BACKDROP = [
  "radial-gradient(circle at 60% 90%, #ff7eb3, #0000 10%)",
  "radial-gradient(circle at 20px 20px, #7afcff, #0000 15%)",
  "radial-gradient(circle at 80% 30%, #ffd65f, #0000 12%)",
  "radial-gradient(circle at 40% 20%, #2ecc71, #0000 8%)",
  "radial-gradient(circle at 85% 60%, #ff9966, #0000 14%)",
  "radial-gradient(circle at 30% 70%, #99ccff, #0000 18%)",
  "radial-gradient(circle at 70% 50%, #ff99cc, #0000 16%)",
  "radial-gradient(circle at 15% 25%, #ffcc99, #0000 13%)",
  "radial-gradient(circle at 75% 80%, #99ffcc, #0000 11%)",
  "radial-gradient(circle at 95% 20%, #ff99ff, #0000 17%)",
  "radial-gradient(circle at 50% 40%, #ffff99, #0000 9%)",
  "radial-gradient(circle at 10% 90%, #99ff99, #0000 15%)",
  "radial-gradient(circle at 90% 10%, #ff9999, #0000 12%)",
  "radial-gradient(circle at 45% 60%, #9999ff, #0000 14%)",
  "radial-gradient(circle at 65% 15%, #ffb366, #0000 10%)",
  "rgba(255, 255, 255, 0.8)",
].join(", ");

const TEXTS = [
  "每天建议饮水 1500~1700ml，约 7~8 杯，保持健康水分 💧",
  "少量多次，每次不超过 200ml，呵护心肾健康 ❤️",
  "观察尿液颜色：淡黄色最健康，深黄需补水 🌟",
  "久坐办公记得每小时喝水 100~150ml，保持清醒专注 💻",
  "不要等到口渴才喝水，那时已经轻度脱水啦 💦",
  "喝 35~40℃ 的水最好，太烫可能伤害身体 🌡️",
  "白开水和矿泉水是最佳选择，安全又健康 ✨",
];

const OPTIONS = [50, 100, 200, 300];
/** 全屏提醒自动关闭的秒数。 */
const COUNTDOWN_SECONDS = 30;
type Outcome = "confirmed" | "skipped" | "timedOut";

/**
 * Foreground channel of the dual-channel reminder. The background channel is a
 * native notification with drink actions, which does not need a live WebView.
 * No monitors, no global shortcuts, no multiple windows here.
 */
export function FullscreenReminder({
  session,
  onClose,
}: {
  session: string | null;
  onClose: () => void;
}) {
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [water, setWater] = useState({ gold: 0, drink: 0 });
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState("");
  const [text] = useState(() => TEXTS[Math.floor(Math.random() * TEXTS.length)]);
  const busy = useRef(false);
  const closed = useRef(false);

  const finish = useCallback(
    async (outcome: Outcome) => {
      if (closed.current) return;
      closed.current = true;
      try {
        if (session) {
          await invoke("hide_reminder_windows", {
            outcome,
            expectedSession: session,
          });
        } else {
          // Android bridge: closes the session and writes the reminder outcome
          // so notification-mode reminders also count in the statistics tab.
          await invoke("finalize_mobile_reminder", { outcome });
        }
      } catch {
        // Browser preview / native bridge not wired yet: still close the UI.
      }
      setClosing(true);
      window.setTimeout(onClose, 260);
    },
    [onClose, session]
  );

  // 倒计时按绝对截止时间重算，而不是每秒累减。Android WebView 退到后台后
  // setInterval 会被系统节流甚至完全冻结，累减会停在原地，回到前台看起来
  // 就像倒计时被暂停了。以 deadline 为唯一时间源后，任何时刻（尤其是恢复
  // 前台时）都能立即校正到真实剩余秒数；后台待满 30s 回来则直接判超时。
  useEffect(() => {
    const deadline = Date.now() + COUNTDOWN_SECONDS * 1000;
    const sync = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setCountdown(remaining);
    };
    sync();
    // 500ms 轮询只为让秒数尽快贴合边界；真正的时间源是 deadline。
    const id = window.setInterval(sync, 500);
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  useEffect(() => {
    if (countdown === 0) void finish("timedOut");
  }, [countdown, finish]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [configStore, historyStore] = await Promise.all([
          load(STORE_NAME.config, { autoSave: false }),
          load(STORE_NAME.drink_history, { autoSave: false }),
        ]);
        const alert = await configStore.get<{ gold?: string | number }>("alert");
        const goal = Number(alert?.gold) || 0;
        const value = await historyStore.get<DrinkHistoryValue>(
          getLocalDateKey(new Date())
        );
        if (!cancelled) {
          setWater({ gold: goal, drink: normalizeDrinkDay(value, goal).total });
        }
      } catch {
        // Browser preview has no store.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function record(amount: number) {
    if (busy.current || closed.current) return;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const receipt = session
        ? await invoke<DrinkReceipt>("record_reminder_drink", {
            amount,
            session,
          })
        : await invoke<DrinkReceipt>("record_drink", {
            amount,
            requestId: crypto.randomUUID(),
          });
      setWater({ gold: receipt.goal, drink: receipt.total });
      if (receipt.goalReached) {
        toast.success("🎉 今日喝水目标已完成");
        // 全屏提醒正好盖住整屏，用户更容易忽略这条 toast，系统通知补一层。
        if (receipt.added) void notifyGoalReached(receipt.total, receipt.goal);
      }
      await finish("confirmed");
    } catch (failure) {
      console.error("保存饮水记录失败", failure);
      setError("保存失败，请重试，或在「今日」页补记");
      busy.current = false;
      setSaving(false);
    }
  }

  const progress = water.gold > 0 ? (water.drink / water.gold) * 100 : 0;

  return (
    <div
      className="mobile-root fixed inset-0 z-50 flex items-center justify-center px-5 transition-opacity duration-300"
      style={{ background: BACKDROP, opacity: closing ? 0 : 1 }}
      role="dialog"
      aria-modal="true"
      aria-label="喝水提醒"
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-white/50 bg-white/60 p-6 shadow-xl backdrop-blur-md transition-transform duration-200"
        style={{ transform: closing ? "scale(0.96)" : "scale(1)" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-700">
            <Droplets className="h-3.5 w-3.5" /> 该喝水啦
          </span>
          <span className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-medium tabular-nums text-slate-600">
            {countdown}s 后关闭
          </span>
        </div>

        <h2 className="text-center text-2xl font-bold text-blue-700">喝了么</h2>
        <p className="mt-2 min-h-10 text-center text-sm leading-5 text-slate-600">
          {text}
        </p>

        <div className="mb-5 mt-4">
          <div className="mb-2 flex justify-between text-xs text-slate-600">
            <span>今日已喝 {water.drink} ml</span>
            <span>目标 {water.gold || "--"} ml</span>
          </div>
          <Progress value={Math.min(progress, 100)} className="h-2" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {OPTIONS.map((amount) => (
            <button
              key={amount}
              type="button"
              disabled={saving}
              onClick={() => record(amount)}
              className="flex min-h-16 items-center justify-center rounded-2xl bg-blue-50/90 text-blue-700 shadow-sm transition-transform active:scale-95 disabled:opacity-60"
            >
              <span className="text-2xl font-semibold tabular-nums">
                {amount}
              </span>
              <span className="ml-1 text-sm">ml</span>
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-center text-xs text-red-600">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => void finish("skipped")}
          className="mx-auto mt-4 flex min-h-11 items-center gap-1 px-4 text-sm text-slate-600"
        >
          跳过 <ArrowRight className="h-4 w-4" />
        </button>
        <p className="mt-1 text-center text-[11px] leading-4 text-slate-500">
          没打开 App 时，这条提醒会以系统通知到达，通知里也能直接记一杯
        </p>
      </div>
    </div>
  );
}
