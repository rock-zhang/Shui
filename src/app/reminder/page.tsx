"use client";
import { invoke } from "@tauri-apps/api/core";
import { isRegistered, register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { useEffect, useState } from "react";
import { listen, TauriEvent } from "@tauri-apps/api/event";
import { Progress } from "@/components/ui/progress";
import { ArrowRight } from "lucide-react";
import { load } from "@tauri-apps/plugin-store";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import "./index.css";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { STORE_NAME } from "@/lib/constants";
import { useI18n } from "@/i18n/provider";

function hideWindowAction() {
  invoke("hide_reminder_windows");
  invoke("reset_timer");
  unregisterAll();
}

async function registerEscShortcut() {
  if (await isRegistered("Esc")) return;
  register("Esc", async () => {
    hideWindowAction();
  });
}

const playSound = () => {
  const audio = new Audio("/sounds/water-drop.mp3");
  audio.volume = 0.5;
  audio.play().catch((err) => console.log("音频播放失败:", err));
};

const waterOptions = [{ ml: 50 }, { ml: 100 }, { ml: 200 }, { ml: 300 }];

export default function ReminderPage() {
  const { t } = useI18n();
  const [reminderText, setReminderText] = useState("");
  const [water, setWater] = useState({
    gold: 0,
    drink: 0,
  });
  const [countdown, setCountdown] = useState(30);
  const [monitorName, setMonitorName] = useState("");
  const todayDate = getTodayDate();

  useEffect(() => {
    const index = Math.floor(Math.random() * 20);
    setReminderText(t(`reminder.messages.${index}`));
  }, [water.drink, t]);

  useEffect(() => {
    registerEscShortcut();

    listen("countdown", (event) => {
      setCountdown(event.payload as number);
      if (event.payload === 0) {
        setTimeout(hideWindowAction, 500);
      }
    });

    listen("reminder_already_hidden", () => {
      unregisterAll();
    });

    listen(TauriEvent.WINDOW_FOCUS, () => {
      console.log("TauriEvent.WINDOW_FOCUS");
      registerEscShortcut();
    });

    currentMonitor().then((mo) => {
      setMonitorName(mo?.name || "");
    });

    return () => {
      unregisterAll();
    };
  }, []);

  useEffect(() => {
    if (!monitorName) return;
    listen(TauriEvent.WINDOW_MOVED, async () => {
      console.log("TauriEvent.WINDOW_MOVED", monitorName);
      const mo = await currentMonitor();
      if (mo?.name !== monitorName) {
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
        drinkHistory.get<number>(todayDate),
      ]);

      setWater({
        gold: Number(goldSetting?.gold),
        drink,
      });
    };

    storeUpdate();
  }, [countdown]);

  const [isClosing, setIsClosing] = useState(false);

  const handleWaterSelection = async (ml: number) => {
    const totalDrink = water.drink + ml;
    setWater({
      ...water,
      drink: totalDrink,
    });
    const store = await load(STORE_NAME.drink_history, { autoSave: false });
    await store.set(todayDate, totalDrink);
    await store.save();

    if (totalDrink >= water.gold) {
      let permissionGranted = await isPermissionGranted();

      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === "granted";
      }

      if (permissionGranted) {
        playSound();
        sendNotification({
          title: t("reminder.notification.title"),
          body: t("reminder.notification.body"),
        });
      }
    }

    setIsClosing(true);
    setTimeout(() => {
      hideWindowAction();
      setIsClosing(false);
    }, 800);
  };

  const progress = (water.drink / water.gold) * 100;

  return (
    <div
      onContextMenu={(e) => {
        if (process.env.NODE_ENV === "production") e.preventDefault();
      }}
      className={`reminder-page min-h-screen flex items-center justify-center relative transition-opacity duration-800 ${
        isClosing ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-white/30 backdrop-blur-sm px-4 py-2 rounded-full text-gray-700 text-base font-medium shadow-sm border border-white/20 transition-transform duration-300">
        {t("reminder.autoClose", { countdown })}
      </div>
      <div
        className={`bg-white/30 backdrop-blur-sm p-8 rounded-2xl shadow-lg max-w-md w-full z-10 border border-white/20 transition-all duration-300 ${
          isClosing ? "scale-95 opacity-0" : "scale-100 opacity-100"
        }`}
      >
        <h2 className="text-2xl font-bold text-center mb-6 text-blue-600">
          {t("reminder.title")}
        </h2>
        <p className="text-gray-600 text-center mb-8">{reminderText}</p>

        <div className="mb-8">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>{t("reminder.today.drunk", { amount: water.drink })}</span>
            <span>{t("reminder.today.target", { amount: water.gold })}</span>
          </div>
          <Progress value={progress <= 100 ? progress : 100} className="h-2" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {waterOptions.map((option) => (
            <button
              key={option.ml}
              tabIndex={-1}
              onClick={() => handleWaterSelection(option.ml)}
              className="group relative p-6 rounded-xl transition-all duration-200 cursor-pointer bg-blue-50 hover:bg-blue-100 hover:scale-105 active:scale-95 text-blue-700 flex items-center justify-center"
            >
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-medium">{option.ml}</span>
                <span className="text-lg text-blue-600/90">ml</span>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={hideWindowAction}
            tabIndex={-1}
            className="text-gray-500 hover:text-gray-700 text-sm inline-flex items-center gap-1.5 transition-colors duration-200 cursor-pointer"
          >
            {t("reminder.skip")}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function getTodayDate() {
  const today = new Date();
  return `${today.getFullYear()}${String(today.getMonth() + 1).padStart(
    2,
    "0"
  )}${String(today.getDate()).padStart(2, "0")}`;
}
