"use client";

export default function About() {
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
        </div>
      </div>

      <div className="rounded-lg border p-3 shadow-xs space-y-4 mb-4">
        <label className="block text-sm font-medium">联系我们</label>

        <div className="flex gap-4">
          <div className="flex items-center space-x-3 p-3 rounded-lg bg-muted/50 w-2/6">
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
          <div className="flex items-center space-x-3 p-3 rounded-lg bg-muted/50 w-4/6">
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

        <div className="mt-4 flex justify-center space-x-6">
          <div className="text-center">
            <div className="mb-2">
              <img
                src="/qrcode.png"
                alt="微信群"
                className="w-32 h-32 rounded-lg border"
              />
            </div>
            <p className="text-sm text-muted-foreground">加入微信群</p>
          </div>
        </div>
      </div>

      <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs mb-4">
        <div>
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            版本
          </label>
          <p className="text-[0.8rem] text-muted-foreground">
            {process.env.APP_VERSION}
          </p>
        </div>
      </div>
    </div>
  );
}
