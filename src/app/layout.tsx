import { Metadata, type Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { UpdateProvider } from "@/components/update-provider";
import { I18nProvider } from "@/lib/i18n";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "喝水提醒",
    template: "%s - 喝水提醒",
  },
  // 静态导出下 metadata 在构建期固定，无法随界面语言切换；用中英双语覆盖两种受众。
  description: "帮助你保持健康饮水习惯的应用 · A healthy hydration reminder app",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    // 必须与 globals.css 的 --background、Android colors.xml 保持一致：
    // oklch(1 0 0) = #ffffff，oklch(0.129 0.042 264.695) = #020618。
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#020618" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>
          {/* UpdateProvider 必须挂在根布局：移动端的真实入口是 `/`（由
              app/page.tsx 渲染 MobileApp），不走 /setting 的 layout，
              只在那边挂会导致安卓端整个更新状态为空、红点永远不亮。
              也必须放在 I18nProvider 内部——它要用 t 做提示文案。 */}
          <I18nProvider>
            <UpdateProvider>{children}</UpdateProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
