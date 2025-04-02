"use client";

import { Switch } from "@/components/ui/switch";

export default function Home() {
  return (
    <div>
      <h3 className="mb-4 text-lg font-medium">通用</h3>

      <div className="space-y-2 flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm mb-4">
        <div>
          <label
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            // for=":r233:-form-item"
          >
            开机自启动
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            电脑重启之后自动开始计时
          </p>
        </div>
        <Switch checked onCheckedChange={() => {}} />
      </div>

      <div className="space-y-2 flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
        <div>
          <label
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            // for=":r233:-form-item"
          >
            倒计时
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          >
            开启后将在菜单栏显示倒计时
          </p>
        </div>
        <Switch checked onCheckedChange={() => {}} />
      </div>
    </div>
  );
}
