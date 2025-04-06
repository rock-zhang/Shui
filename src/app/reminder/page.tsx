"use client";
import { invoke } from "@tauri-apps/api/core";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { useEffect, useState } from "react";
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

function hideWindowAction() {
  invoke("hide_reminder_windows");
  invoke("reset_timer");
}

function registerEscShortcut() {
  console.log("registerEscShortcut");
  register("Esc", async () => {
    hideWindowAction();
  });
}

const sendNativeNotification = async () => {
  let permissionGranted = await isPermissionGranted();

  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === "granted";
  }

  // Once permission has been granted we can send the notification
  if (permissionGranted) {
    sendNotification({
      title: "🎉 太棒了！完成今日喝水目标",
      body: "再接再厉，继续保持健康好习惯！",
    });
  }
};

function getTodayDate() {
  const today = new Date();
  return `${today.getFullYear()}${String(today.getMonth() + 1).padStart(
    2,
    "0"
  )}${String(today.getDate()).padStart(2, "0")}`;
}

const waterOptions = [
  { ml: 100, label: "中杯" },
  { ml: 200, label: "大杯" },
  { ml: 300, label: "超大杯" },
  { ml: 50, label: "小杯" },
];

const reminderTexts = [
  "补充一下能量吧，让身体充满活力 ✨",
  "每一口水都是对健康的投资 💧",
  "喝水时刻，让生活更有滋味 🌊",
  "来杯水，让身体清爽一下 ⚡️",
  "保持水分，保持好心情 🎵",
  "给细胞们补充点能量吧 💪",
  "每天八杯水，健康不用愁 🎯",
  "喝水时间到，让身体充电啦 🔋",
  "水是生命之源，别让身体缺水哦 💎",
  "来一杯清凉，让大脑更清醒 🧊",
  "喝水小憩，让工作更高效 ⭐️",
  "每一口水都是对自己的关爱 💝",
  "保持水分，保持美丽 ✨",
  "让水分滋润你的一天 🌈",
  "喝水时刻，让身体更轻松 🎐",
  "补充能量的最佳时机 ⚡️",
  "来杯水，让心情更舒畅 🎵",
  "每一口水都是健康的积累 🌱",
  "保持水分，保持活力 💫",
  "让水分为你的健康加分 🎯",
];

export default function ReminderPage() {
  const [reminderText, setReminderText] = useState("");
  const [water, setWater] = useState({
    gold: 0,
    drink: 0,
  });
  const [countdown, setCountdown] = useState(30);
  const shouldResetTimer = countdown === 30;
  // 按天存储饮水量
  const todayDate = getTodayDate();

  // 根据饮水量随机选择提醒文案
  useEffect(() => {
    setReminderText(
      reminderTexts[Math.floor(Math.random() * reminderTexts.length)]
    );
  }, [water.drink]);

  useEffect(() => {
    async function loadConfig() {
      const store = await load("config_store.json", { autoSave: false });
      const [goldSetting, drinkHistory] = await Promise.all([
        store.get<{
          gold: number;
        }>("alert"),
        store.get<{
          [todayDate]: number;
        }>("drink_history"),
      ]);

      setWater({
        ...water,
        gold: Number(goldSetting?.gold),
        drink: drinkHistory?.[todayDate] || 0,
      });
    }

    loadConfig();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          hideWindowAction();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [shouldResetTimer]); // 当倒计时重置为 30 时重新开始计时

  useEffect(() => {
    // 首次打开，注册快捷键
    registerEscShortcut();

    // 监听窗口显示事件
    listen(TauriEvent.WINDOW_FOCUS, () => {
      drinkAmoutUpdate();
      registerEscShortcut();
      setCountdown(30); // 重置倒计时
    });
    listen(TauriEvent.WINDOW_BLUR, () => {
      unregisterAll();
    });

    return () => {
      unregisterAll();
    };
  }, []);

  const drinkAmoutUpdate = async () => {
    const store = await load("config_store.json", { autoSave: false });
    const drinkHistory = await store.get<{
      [todayDate]: number;
    }>("drink_history");

    await store.set("drink_history", {
      [todayDate]: drinkHistory?.[todayDate] || 0,
    });
  };

  const handleWaterSelection = async (ml: number) => {
    const totalDrink = water.drink + ml;
    setWater({
      ...water,
      drink: totalDrink,
    });
    const store = await load("config_store.json", { autoSave: false });
    await store.set("drink_history", {
      [todayDate]: totalDrink,
    });
    await store.save();

    if (totalDrink >= water.gold) {
      sendNativeNotification();
    }

    hideWindowAction();
  };

  const progress = (water.drink / water.gold) * 100;

  return (
    <div
      onContextMenu={(e) => {
        if (process.env.NODE_ENV === "production") e.preventDefault();
      }}
      className="reminder-page min-h-screen flex items-center justify-center relative"
    >
      <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-white/30 backdrop-blur-sm px-4 py-2 rounded-full text-gray-700 text-base font-medium shadow-sm border border-white/20">
        {countdown}s 后自动关闭
      </div>
      <div className="bg-white/30 backdrop-blur-sm p-8 rounded-2xl shadow-lg max-w-md w-full z-10 border border-white/20">
        <h2 className="text-2xl font-bold text-center mb-6 text-blue-600">
          喝了么
        </h2>
        <p className="text-gray-600 text-center mb-8">{reminderText}</p>

        <div className="mb-8">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>今日已喝: {water.drink}ml</span>
            <span>目标: {water.gold}ml</span>
          </div>
          <Progress value={progress <= 100 ? progress : 100} className="h-2" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {waterOptions.map((option) => (
            <button
              key={option.ml}
              onClick={() => handleWaterSelection(option.ml)}
              className="p-4 rounded-xl transition-all duration-200 cursor-pointer bg-blue-50 hover:bg-blue-100 text-blue-700"
            >
              <div className="text-lg font-semibold">{option.label}</div>
              <div className="text-sm">{option.ml}ml</div>
            </button>
          ))}
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={hideWindowAction}
            className="text-gray-500 hover:text-gray-700 text-sm inline-flex items-center gap-1.5 transition-colors duration-200 cursor-pointer"
          >
            跳过
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
