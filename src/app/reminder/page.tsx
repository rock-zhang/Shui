"use client";
import { invoke } from "@tauri-apps/api/core";
import {
  isRegistered,
  register,
  unregisterAll,
} from "@tauri-apps/plugin-global-shortcut";
import { useEffect, useRef, useState } from "react";
import { listen, TauriEvent } from "@tauri-apps/api/event";
import { Progress } from "@/components/ui/progress";
import { ArrowRight } from "lucide-react";
import { load } from "@tauri-apps/plugin-store";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import "./index.css";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { STORE_NAME } from "@/lib/constants";
import { usePlatform } from "@/hooks/use-platform";
import { normalizeDrinkDay, type DrinkHistoryValue, type DrinkReceipt } from "@/lib/drink-day";
import { progressBucket, track, trackDrinkRecorded } from "@/lib/analytics";
import { useI18n, type MessageKey } from "@/lib/i18n";

async function hideWindowAction(outcome: "confirmed" | "skipped" = "confirmed", expectedSession?: string) {
  track("reminder_outcome", { outcome, trigger: "desktop" });
  if (outcome === "skipped") {
    track("fullscreen_skip", { trigger: "desktop" });
  }
  try {
    await invoke("hide_reminder_windows", { outcome, expectedSession: expectedSession ?? null });
  } finally {
    // 关闭失败或 IPC 异常时也要释放全局 Esc，避免系统级按键被永久占用
    await unregisterAll();
  }
}

async function registerEscShortcut() {
  if (await isRegistered("Esc")) return;
  register("Esc", async () => {
    hideWindowAction("skipped");
  });
}

// 添加音效播放函数
const playSound = () => {
  const audio = new Audio("/sounds/water-drop.mp3");
  audio.volume = 0.5; // 设置音量为 50%
  audio.play().catch((err) => console.log("音频播放失败:", err));
};

const sendNativeNotification = async (title: string, body: string) => {
  let permissionGranted = await isPermissionGranted();

  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === "granted";
  }

  // Once permission has been granted we can send the notification
  if (permissionGranted) {
    playSound(); // 添加音效

    sendNotification({ title, body });
  }
};

function getTodayDate() {
  const today = new Date();
  return `${today.getFullYear()}${String(today.getMonth() + 1).padStart(
    2,
    "0"
  )}${String(today.getDate()).padStart(2, "0")}`;
}

const waterOptions = [{ ml: 50 }, { ml: 100 }, { ml: 200 }, { ml: 300 }];

const REMINDER_TEXT_KEYS: MessageKey[] = [
  "desktop.reminder.tip1",
  "desktop.reminder.tip2",
  "desktop.reminder.tip3",
  "desktop.reminder.tip4",
  "desktop.reminder.tip5",
  "desktop.reminder.tip6",
  "desktop.reminder.tip7",
  "desktop.reminder.tip8",
  "desktop.reminder.tip9",
  "desktop.reminder.tip10",
  "desktop.reminder.tip11",
  "desktop.reminder.tip12",
  "desktop.reminder.tip13",
  "desktop.reminder.tip14",
  "desktop.reminder.tip15",
  "desktop.reminder.tip16",
];

export default function ReminderPage() {
  const { t } = useI18n();
  const [reminderTextKey, setReminderTextKey] = useState<MessageKey | null>(null);
  const shownLogged = useRef(false);
  const [water, setWater] = useState({
    gold: 0,
    drink: 0,
  });
  const [countdown, setCountdown] = useState(30);
  const [monitorName, setMonitorName] = useState("");
  const { isLinux } = usePlatform();
  const saving = useRef(false);
  const [saveError, setSaveError] = useState<MessageKey | null>(null);
  // 按天存储饮水量
  const todayDate = getTodayDate();

  // 根据饮水量随机选择提醒文案
  useEffect(() => {
    setTimeout(
      () => {
        setReminderTextKey(
          REMINDER_TEXT_KEYS[Math.floor(Math.random() * REMINDER_TEXT_KEYS.length)]
        );
      },
      reminderTextKey ? 1000 : 0
    );
  }, [water.drink]);

  useEffect(() => {
    registerEscShortcut();

    const countdownListener = listen("countdown", (event) => {
      const countdownValue = event.payload as number;
      setCountdown(countdownValue);
      // 提醒窗口会被复用，新一次提醒要靠倒计时事件重新注册 Esc。
      // 不要监听 WINDOW_FOCUS：关闭提醒时窗口隐藏会让焦点转移到另一个提醒窗口，
      // 可能在前端 unregisterAll() 之后重新注册 Esc，造成关闭后全局 Esc 失效。
      if (countdownValue > 0) registerEscShortcut();
    });

    // TODO:被其他窗口隐藏时，注销快捷键
    // 待确认多屏场景下，是否需要注销快捷键
    listen("reminder_already_hidden", () => {
      unregisterAll();
    });

    currentMonitor().then((mo) => {
      setMonitorName(mo?.name || "");
    });

    return () => {
      countdownListener.then(unlisten => unlisten());
      unregisterAll();
    };
  }, []);

  useEffect(() => {
    // 添加键盘事件监听作为 Linux 下的备选方案
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        console.log("Esc key detected via keyboard event");
        hideWindowAction("skipped");
      }
    };

    // 在 Linux 系统上添加键盘事件监听
    if (isLinux) {
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      if (isLinux) {
        document.removeEventListener("keydown", handleKeyDown);
      }
    };
  }, [isLinux]);

  useEffect(() => {
    if (!monitorName) return;
    listen(TauriEvent.WINDOW_MOVED, async () => {
      console.log("TauriEvent.WINDOW_MOVED", monitorName);
      const mo = await currentMonitor();
      if (mo?.name !== monitorName) {
        // 外接屏幕变化时，隐藏窗口
        const win = await getCurrentWindow();
        invoke("hide_reminder_window", { label: win.label });
      }
    });
  }, [monitorName]);

  useEffect(() => {
    const storeUpdate = async () => {
      const config_store = await load(STORE_NAME.config, { autoSave: false });
      const drinkHistory = await load(STORE_NAME.drink_history, {
        autoSave: false,
      });
      const [goldSetting, drink = 0] = await Promise.all([
        config_store.get<{
          gold: number;
        }>("alert"),
        drinkHistory.get<DrinkHistoryValue>(todayDate),
      ]);

      setWater({
        gold: Number(goldSetting?.gold) || 0,
        drink: normalizeDrinkDay(drink, Number(goldSetting?.gold) || 0).total,
      });
      if (!shownLogged.current) {
        shownLogged.current = true;
        const goal = Number(goldSetting?.gold) || 0;
        const total = normalizeDrinkDay(drink, goal).total;
        track("fullscreen_reminder_shown", {
          trigger: "desktop",
          progress_bucket: progressBucket(total, goal),
          total_ml: total,
          goal_ml: goal,
        });
      }
    };

    storeUpdate();
  }, [countdown]);

  const [isClosing, setIsClosing] = useState(false);

  const handleWaterSelection = async (ml: number) => {
    if (saving.current) return;
    saving.current = true;
    setSaveError(null);
    track("fullscreen_drink_click", { amount: ml, source: "fullscreen" });
    try {
      // Refresh on click: a reused window can still hold the previous session
      // before the first countdown event of its next presentation arrives.
      const session = await invoke<string | null>("get_reminder_session");
      if (!session) throw new Error(t("mobile.fullscreen.sessionEnded"));
      const updated = await invoke<DrinkReceipt>("record_reminder_drink", { amount: ml, session });
      setWater({ gold: updated.goal, drink: updated.total });
      trackDrinkRecorded(updated, ml, "fullscreen");
      if (updated.goalReached) {
        sendNativeNotification(
          t("desktop.reminder.goalToast.title"),
          t("desktop.reminder.goalToast.body")
        ).catch(console.error);
      }
      setIsClosing(true);
      setTimeout(() => {
        hideWindowAction("confirmed", session).catch(console.error);
        setIsClosing(false);
        saving.current = false;
      }, isLinux ? 100 : 300);
    } catch (error) {
      console.error("保存饮水记录失败:", error);
      setSaveError("desktop.reminder.saveFailed");
      saving.current = false;
    }
  };

  const progress = water.gold > 0 ? (water.drink / water.gold) * 100 : 0;

  return (
    <div
      onContextMenu={(e) => {
        if (process.env.NODE_ENV === "production") e.preventDefault();
      }}
      className={`reminder-page min-h-screen flex items-center justify-center relative transition-opacity duration-300 ${
        isClosing ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-white/30 backdrop-blur-sm px-4 py-2 rounded-full text-gray-700 text-base font-medium shadow-sm border border-white/20 transition-transform duration-300">
        {t("desktop.reminder.autoClose", { seconds: countdown })}
      </div>
      <div
        className={`bg-white/30 backdrop-blur-sm p-8 rounded-2xl shadow-lg max-w-lg w-full z-10 border border-white/20 transition-all duration-100 ${
          isClosing ? "scale-95 opacity-0" : "scale-100 opacity-100"
        }`}
      >
        <h2 className="text-2xl font-bold text-center mb-6 text-blue-600">
          {t("mobile.fullscreen.heading")}
        </h2>
        <p className="text-gray-600 text-center mb-8">
          {reminderTextKey ? t(reminderTextKey) : ""}
        </p>

        <div className="mb-8">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>{t("desktop.reminder.drank", { amount: water.drink })}</span>
            <span>{t("desktop.reminder.goal", { amount: water.gold })}</span>
          </div>
          <Progress value={progress <= 100 ? progress : 100} className="h-2" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {waterOptions.map((option) => (
            <button
              key={option.ml}
              tabIndex={-1}
              onClick={() => handleWaterSelection(option.ml)}
              className="group relative p-6 rounded-xl transition-all duration-300 cursor-pointer bg-blue-50 hover:bg-blue-100 hover:scale-105 active:scale-95 text-blue-700 flex items-center justify-center"
            >
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-medium">{option.ml}</span>
                <span className="text-lg text-blue-600/90">ml</span>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-6 text-center">
          {saveError && <p role="alert" className="mb-2 text-red-600">{t(saveError)}</p>}
          <button
            onClick={() => hideWindowAction("skipped")}
            tabIndex={-1}
            className="text-gray-500 hover:text-gray-700 text-sm inline-flex items-center gap-1.5 transition-colors duration-300 cursor-pointer"
          >
            {t("mobile.fullscreen.skip")}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
