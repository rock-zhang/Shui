"use client";
import { invoke } from "@tauri-apps/api/core";
import {
  isRegistered,
  register,
  unregisterAll,
} from "@tauri-apps/plugin-global-shortcut";
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
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { STORE_NAME } from "@/lib/constants";

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

// 添加音效播放函数
const playSound = () => {
  const audio = new Audio("/sounds/water-drop.mp3");
  audio.volume = 0.5; // 设置音量为 50%
  audio.play().catch((err) => console.log("音频播放失败:", err));
};

const sendNativeNotification = async () => {
  let permissionGranted = await isPermissionGranted();

  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === "granted";
  }

  // Once permission has been granted we can send the notification
  if (permissionGranted) {
    playSound(); // 添加音效

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

const waterOptions = [{ ml: 50 }, { ml: 100 }, { ml: 200 }, { ml: 300 }];

const reminderTexts = [
  "每天建议饮水1500~1700ml，约7~8杯，保持健康水分 💧",
  "建议少量多次饮水，每次不超过200ml，呵护心肾健康 ❤️",
  "观察尿液颜色：淡黄色最健康，深黄需补水，无色可能过量 🌟",
  "晨起来杯温水(200~300ml)，补充夜间水分，促进代谢 🌅",
  "餐前1小时喝水(100~150ml)，帮助消化，事半功倍 🍽️",
  "睡前1小时少量饮水(约100ml)，但别太多影响睡眠 😴",
  "运动后15分钟内补充200~300ml，平衡身体电解质 💪",
  "久坐办公记得每小时喝水100~150ml，保持清醒专注 💻",
  "喝35~40℃的水最好，太烫可能伤害身体，要适温 🌡️",
  "白开水和矿泉水是最佳选择，安全又健康 ✨",
  "不要用饮料代替水，果汁奶茶糖分高，咖啡浓茶会利尿 🥤",
  "饭中少喝水，可能影响消化，建议餐后半小时再补水 ⏰",
  "不要等到口渴才喝水，那时已经轻度脱水啦 💦",
  "水肿不是因为喝太多水，反而可能是喝得太少 💭",
  "高温天气补充淡盐水，平衡身体流失的钠钾 🌞",
  "乘坐飞机要多喝水，机舱很干燥，每小时喝100~150ml ✈️",
];

export default function ReminderPage() {
  const [reminderText, setReminderText] = useState("");
  const [water, setWater] = useState({
    gold: 0,
    drink: 0,
  });
  const [countdown, setCountdown] = useState(30);
  const [monitorName, setMonitorName] = useState("");
  // 按天存储饮水量
  const todayDate = getTodayDate();

  // 根据饮水量随机选择提醒文案
  useEffect(() => {
    setTimeout(
      () => {
        setReminderText(
          reminderTexts[Math.floor(Math.random() * reminderTexts.length)]
        );
      },
      reminderText ? 1000 : 0
    );
  }, [water.drink]);

  useEffect(() => {
    registerEscShortcut();

    listen("countdown", (event) => {
      setCountdown(event.payload as number);
      if (event.payload === 0) {
        setTimeout(hideWindowAction, 500);
      }
    });

    // TODO:被其他窗口隐藏时，注销快捷键
    // 待确认多屏场景下，是否需要注销快捷键
    listen("reminder_already_hidden", () => {
      unregisterAll();
    });

    // 监听窗口显示事件
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
      sendNativeNotification();
    }

    // 添加关闭动画
    setIsClosing(true);
    setTimeout(() => {
      hideWindowAction();
      setIsClosing(false);
    }, 300); // 等待动画完成后关闭
  };

  const progress = (water.drink / water.gold) * 100;

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
        {countdown}s 后自动关闭
      </div>
      <div
        className={`bg-white/30 backdrop-blur-sm p-8 rounded-2xl shadow-lg max-w-md w-full z-10 border border-white/20 transition-all duration-100 ${
          isClosing ? "scale-95 opacity-0" : "scale-100 opacity-100"
        }`}
      >
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
          <button
            onClick={hideWindowAction}
            tabIndex={-1}
            className="text-gray-500 hover:text-gray-700 text-sm inline-flex items-center gap-1.5 transition-colors duration-300 cursor-pointer"
          >
            跳过
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
