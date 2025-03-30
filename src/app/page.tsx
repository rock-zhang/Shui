"use client";
import Image from "next/image";
import { useEffect } from "react";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { resolveResource } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const TRAY_ID = "app-tray";

export default function Home() {
  useEffect(() => {
    let trayInstance: TrayIcon | null = null;

    const initTray = async () => {
      try {
        // 检查是否已存在托盘实例
        trayInstance = await TrayIcon.getById(TRAY_ID);
        console.log("trayInstance", trayInstance);

        if (trayInstance) {
          return;
        }

        const menu = await Menu.new();

        // 添加菜单项
        await menu.append(
          await MenuItem.new({
            text: "call reminder",
            action: async () => {
              console.log("call reminder");
              console.log("xxxx", await invoke("call_reminder"));
            },
          })
        );

        // 添加菜单项
        await menu.append(
          await MenuItem.new({
            text: "设置",
            action: async () => {
              console.log("打开设置");
              (await WebviewWindow.getByLabel("main"))?.show();
              // const result = await invoke("setting");
              // console.log("result", result, typeof result);
            },
          })
        );

        // await menu.append(PredefinedMenuItem.new({ item: "Separator" }));

        await menu.append(
          await MenuItem.new({
            text: "检查更新",
            action: () => {
              console.log("检查更新");
            },
          })
        );

        // await menu.append(await PredefinedMenuItem.new("separator"));

        await menu.append(
          await MenuItem.new({
            text: "退出",
            action: () => {
              console.log("退出应用");
            },
          })
        );

        // 创建托盘图标
        const iconPath = "./icons/tray-mac.ico";
        const icon = await resolveResource(iconPath);

        console.log("icon", icon);

        trayInstance = await TrayIcon.new({
          menu,
          icon,
          id: TRAY_ID,
          tooltip: "我的应用",
          iconAsTemplate: true,
          menuOnLeftClick: true,
        });
      } catch (error) {
        console.error("创建托盘失败:", error);
      }
    };

    initTray();

    // 清理函数
    return () => {
      if (trayInstance) {
        TrayIcon.removeById(TRAY_ID);
      }
    };
  }, []);

  const closeWindow = async () => {
    invoke("close_window", { label: "main" });
  };

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <div data-tauri-drag-region className="DragArea">
        Drag Me
      </div>
      <button onClick={closeWindow}>关闭窗口</button>
      <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start">
        <Image
          className="dark:invert"
          src="/next.svg"
          alt="Next.js logo"
          width={180}
          height={38}
          priority
        />
        <ol className="list-inside list-decimal text-sm/6 text-center sm:text-left font-[family-name:var(--font-geist-mono)]">
          <li className="mb-2 tracking-[-.01em]">
            Get started by editing{" "}
            <code className="bg-black/[.05] dark:bg-white/[.06] px-1 py-0.5 rounded font-[family-name:var(--font-geist-mono)] font-semibold">
              src/app/page.tsx
            </code>
            .
          </li>
          <li className="tracking-[-.01em]">
            Save and see your changes instantly.
          </li>
        </ol>

        <div className="flex gap-4 items-center flex-col sm:flex-row">
          <a
            className="rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background gap-2 hover:bg-[#383838] dark:hover:bg-[#ccc] font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 sm:w-auto"
            href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image
              className="dark:invert"
              src="/vercel.svg"
              alt="Vercel logomark"
              width={20}
              height={20}
            />
            Deploy now
          </a>
          <a
            className="rounded-full border border-solid border-black/[.08] dark:border-white/[.145] transition-colors flex items-center justify-center hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] hover:border-transparent font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 w-full sm:w-auto md:w-[158px]"
            href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            Read our docs
          </a>
        </div>
      </main>
      <footer className="row-start-3 flex gap-[24px] flex-wrap items-center justify-center">
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="/file.svg"
            alt="File icon"
            width={16}
            height={16}
          />
          Learn
        </a>
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="/window.svg"
            alt="Window icon"
            width={16}
            height={16}
          />
          Examples
        </a>
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://nextjs.org?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="/globe.svg"
            alt="Globe icon"
            width={16}
            height={16}
          />
          Go to nextjs.org →
        </a>
      </footer>
    </div>
  );
}
