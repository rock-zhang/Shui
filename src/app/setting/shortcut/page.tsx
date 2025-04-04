"use client";

export default function Shortcut() {
  return (
    <div>
      <h3 className="mb-4 text-lg font-medium">快捷键</h3>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            退出
          </label>
          <p
            id=":r233:-form-item-description"
            className="text-[0.8rem] text-muted-foreground"
          ></p>
        </div>
        <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground">
          Esc
        </span>
      </div>
    </div>
  );
}
