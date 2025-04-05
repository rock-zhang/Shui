"use client";
import { invoke } from "@tauri-apps/api/core";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { useEffect, useState } from "react";
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { listen, TauriEvent } from "@tauri-apps/api/event";
import { Progress } from "@/components/ui/progress";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { load } from "@tauri-apps/plugin-store";
import "./index.css";

function registerEscShortcut() {
  console.log("registerEscShortcut");
  register("Esc", async () => {
    await invoke("hide_reminder_windows");
    invoke("reset_timer");
  });
}

function getTodayDate() {
  const today = new Date();
  return `${today.getFullYear()}${String(today.getMonth() + 1).padStart(
    2,
    "0"
  )}${String(today.getDate()).padStart(2, "0")}`;
}

// 按天存储饮水量
const todayDate = getTodayDate();

const waterOptions = [
  { ml: 100, label: "中杯" },
  { ml: 200, label: "大杯" },
  { ml: 300, label: "超大杯" },
  { ml: 50, label: "小杯" },
];

export default function Home() {
  const [water, setWater] = useState({
    gold: 1500,
    drink: 0,
  });
  const [countdown, setCountdown] = useState(30);
  const shouldResetTimer = countdown === 30;

  useEffect(() => {
    async function loadConfig() {
      const store = await load("config_store.json", { autoSave: false });
      const goldSetting = await store.get<{
        gold: number;
      }>("alert");
      setWater({
        ...water,
        gold: Number(goldSetting?.gold),
      });
      const val = await store.get<{
        todayDate: number;
      }>("reminder_drink");
      setWater({
        ...water,
        drink: val?.todayDate || 0,
      });
    }

    loadConfig();
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          invoke("hide_reminder_windows");
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
      registerEscShortcut();
      setCountdown(30); // 重置倒计时
    });
    listen(TauriEvent.WINDOW_BLUR, () => {
      unregisterAll();
    });

    getAllWebviewWindows().then((windows) => {
      console.log("windows", windows);
    });

    return () => {
      unregisterAll();
    };
  }, []);

  const handleWaterSelection = async (ml: number) => {
    const totalDrink = water.drink + ml;
    setWater({
      ...water,
      drink: totalDrink,
    });
    const store = await load("config_store.json", { autoSave: false });
    await store.set("reminder_drink", {
      todayDate: totalDrink,
    });
    await store.save();

    if (totalDrink >= water.gold) {
    }
    await invoke("hide_reminder_windows");
  };

  return (
    <div className="reminder-page min-h-screen flex items-center justify-center">
      <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-white/30 backdrop-blur-sm px-4 py-2 rounded-full text-gray-700 text-base font-medium shadow-sm border border-white/20">
        {countdown}s 后自动关闭
      </div>
      <div className="bg-white/30 backdrop-blur-sm p-8 rounded-2xl shadow-lg max-w-md w-full z-10 border border-white/20">
        <h2 className="text-2xl font-bold text-center mb-6 text-blue-600">
          喝了么
        </h2>
        <p className="text-gray-600 text-center mb-8">
          请选择这次要喝多少水 💧
        </p>

        <div className="mb-8">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>今日已喝: {water.drink}ml</span>
            <span>目标: {water.gold}ml</span>
          </div>
          <Progress value={(water.drink / water.gold) * 100} className="h-2" />
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
            onClick={() => invoke("hide_reminder_windows")}
            className="text-gray-500 hover:text-gray-700 text-sm inline-flex items-center gap-1.5 transition-colors duration-200 cursor-pointer"
          >
            跳过
            <ArrowRightIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
