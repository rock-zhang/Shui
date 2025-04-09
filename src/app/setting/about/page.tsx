"use client";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";

export default function About() {
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion);
  }, []);

  const openGithub = async () => {
    await openUrl("https://github.com/rock-zhang/Shui");
  };

  const handleCopyAppInfo = async () => {
    const appInfo = await invoke("get_app_runtime_info");
    await writeText(JSON.stringify(appInfo));
    toast.success("复制成功");
  };

  return (
    <div>
      <h3 className="mb-4 text-lg font-medium">关于</h3>

      <div className="relative overflow-hidden rounded-lg border bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-3 shadow-xs mb-4">
        <div className="relative z-10 p-2">
          <div className="flex items-center gap-2 mb-2">
            <svg
              className="h-5 w-5 text-blue-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            <label className="text-lg font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              关于项目
            </label>
          </div>
          <p className="text-sm leading-relaxed text-blue-800/70">
            这是一个帮助你养成健康饮水习惯的小工具。它会根据你设定的目标，在合适的时间提醒你喝水，帮助你保持充足的水分摄入，提升身体健康。
          </p>
          <p className="text-sm leading-relaxed text-blue-800/70 mt-2">
            如果你有任何想法或遇到问题，欢迎通过以下方式与我们联系。你的反馈将帮助我们做得更好！
          </p>
        </div>
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            版本
          </label>
          <p className="text-[0.8rem] text-muted-foreground">{version}</p>
        </div>
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            软件信息
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            复制软件信息并提供给 Bug Issue
          </p>
        </div>
        <Button onClick={handleCopyAppInfo}>复制</Button>
      </div>

      <div className="rounded-lg border p-3 shadow-xs space-y-4 mb-4">
        <label className="block text-sm font-medium">联系我们</label>

        <div className="flex gap-4">
          <div className="flex items-center space-x-3 p-3 rounded-lg bg-muted/50 w-4/10">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-muted-foreground"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted-foreground">微信号：slash__z</p>
            </div>
          </div>
          <div className="flex items-center space-x-3 p-3 rounded-lg bg-muted/50 w-6/10">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-muted-foreground"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted-foreground">
                hey47_zhang@163.com
              </p>
            </div>
          </div>
        </div>

        <div
          className="flex items-center space-x-3 p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors"
          onClick={openGithub}
        >
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-muted-foreground"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">
              https://github.com/rock-zhang/Shui
            </p>
          </div>
        </div>

        <div className="mt-4 flex justify-center space-x-6">
          <div className="text-center">
            <div className="mb-2">
              <img
                src="/qrcode.jpg"
                alt="微信群"
                className="w-[300px] rounded-lg border"
              />
            </div>
            <p className="text-sm text-muted-foreground">加入微信群</p>
          </div>
        </div>
      </div>
    </div>
  );
}
