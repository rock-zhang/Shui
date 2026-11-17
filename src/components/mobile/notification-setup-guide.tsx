"use client";

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BellRing,
  Check,
  CheckCircle2,
  ChevronRight,
  Power,
  Settings,
  Timer,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { emitRefresh, readNotificationHealth, type NotificationHealth } from "@/lib/mobile";
import { romFromHealth, romProfile, type RomProfile } from "@/lib/rom";
import { useNotificationPermission } from "./notification-permission-context";

/**
 * 国产 ROM「通知三步引导」。
 *
 * 真机 adb 实锤：OPPO / 小米 / vivo / 华为等系统有两类 App 级开关，新装默认全关，
 * 且没有公开 API 可读写——① 通知管理页的横幅/锁屏/铃声/振动；② 自启动/后台运行。
 * 它们会把通知 importance 从渠道的 4 压成 3，表现就是「下拉有，但没横幅、没声音、
 * 没震动」，以及「杀掉多任务后收不到」。App 检测不到也开不了，只能引导用户手动一次。
 *
 * 做成三步而不是一页卡片：每一步只要求一个动作、跳一个系统页，转化率高得多；
 * 第一步（通知权限）可自动检测，通过后自动推进，不让用户做无谓的确认。
 */
const SEEN_KEY = "shui:notif-setup-guide-seen";
const STEP_KEY = "shui:notif-setup-step";

/**
 * 引导内容版本：引导结构有一次实质升级（后台运行升为「必开」）时就 +1，
 * 老用户下次启动会自动再看到一次。否则覆盖安装会带着旧的 seen 标记，
 * 新加的关键步骤永远到不了他们眼前。
 */
const SEEN_VERSION = "2";

/** 外部唤起引导：体检卡里「重新查看设置引导」用。 */
export const OPEN_GUIDE_EVENT = "shui:open-notif-guide";

/**
 * 「稍后」计数。点一次 ✕ 就永久写 seen 太狠：用户首次打开常常是
 * 「先看看这是啥」直接关掉，之后关键的后台运行那一步就永远见不到了。
 * 允许跳过两次，第三次才彻底停止自动弹出（体检卡里的入口一直都在）。
 */
const DISMISS_KEY = "shui:notif-guide-dismiss";
const DISMISS_LIMIT = 3;

function readDismissCount(): number {
  try {
    const raw = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

function bumpDismissCount(): number {
  const next = readDismissCount() + 1;
  try {
    window.localStorage.setItem(DISMISS_KEY, String(next));
  } catch {
    // 存储不可用时按「已连续跳过」处理，本次会话内不再自动弹。
  }
  return next;
}

type Step = 0 | 1 | 2;

const STEP_LABELS = ["允许通知", "打开开关", "后台运行"] as const;
const STEP_COUNT = STEP_LABELS.length;

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === SEEN_VERSION;
  } catch {
    return false;
  }
}

function writeSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, SEEN_VERSION);
    window.localStorage.removeItem(STEP_KEY);
  } catch {
    // 存储不可用时仅本次会话内生效。
  }
}

function readStep(): Step {
  try {
    const raw = Number(window.localStorage.getItem(STEP_KEY));
    return raw === 1 || raw === 2 ? raw : 0;
  } catch {
    return 0;
  }
}

function writeStep(step: Step) {
  try {
    window.localStorage.setItem(STEP_KEY, String(step));
  } catch {
    // 存储不可用时仅本次会话内生效。
  }
}

/* ──────────────────────────── 视觉组件 ──────────────────────────── */

/** 示意图外框：统一的柔底、圆角与图注，各步视觉语言保持一致。 */
function DiagramFrame({
  caption,
  children,
}: {
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-border/60 bg-gradient-to-b from-muted/45 to-muted/15 px-3 pb-2.5 pt-3.5">
      <div className="flex justify-center">{children}</div>
      <p className="mt-2 text-center text-[10px] leading-4 text-muted-foreground/80">
        {caption}
      </p>
    </div>
  );
}

/** 第一步：系统授权弹窗——高亮「允许」，其余元素压暗。 */
function PermissionDiagram() {
  return (
    <svg
      viewBox="0 0 220 116"
      className="h-[116px] w-auto"
      role="img"
      aria-label="系统授权弹窗示意图：弹窗出现时点右侧的「允许」"
    >
      <defs>
        <linearGradient id="guide-allow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      {/* 弹窗本身就是唯一的框：外层 DiagramFrame 已经是「屏幕」，
          再套一层手机外框就是三重边框，视觉上只会显得啰嗦。 */}
      <rect x="1" y="1" width="218" height="114" rx="18" className="fill-background stroke-border" strokeWidth="1.2" />
      <circle cx="110" cy="35" r="12" className="fill-sky-500/12" />
      <path d="M105.5 35a4.5 4.5 0 0 1 9 0v3.5h-9z" className="fill-sky-500/70" />
      <text x="110" y="67" textAnchor="middle" fontSize="12.5" fontWeight="600" className="fill-foreground">
        允许通知？
      </text>
      <text x="110" y="84" textAnchor="middle" fontSize="9" className="fill-muted-foreground">
        「Shui」想向你发送通知
      </text>
      <rect x="28" y="93" width="76" height="18" rx="9" className="fill-muted" />
      <text x="66" y="105.5" textAnchor="middle" fontSize="9.5" className="fill-muted-foreground">
        不允许
      </text>
      <rect x="116" y="93" width="76" height="18" rx="9" fill="url(#guide-allow)" />
      <text x="154" y="105.5" textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#ffffff">
        允许
      </text>
    </svg>
  );
}

/**
 * 第二步：通知管理页的四项开关。
 *
 * 开关一律画成**已打开**状态（滑块在右、品牌渐变底）：这是目标状态，
 * 画成关闭状态会让人以为「现在这样就行」。
 */
function SwitchDiagram() {
  const rows = ["横幅", "锁屏", "铃声", "振动"];
  return (
    <svg
      viewBox="0 0 220 164"
      className="h-[158px] w-auto"
      role="img"
      aria-label="通知管理页示意图：示例中横幅、锁屏、铃声、振动四个开关都已打开"
    >
      <defs>
        <linearGradient id="guide-switch" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect x="8" y="4" width="204" height="156" rx="18" className="fill-card stroke-border" strokeWidth="1.2" />
      <text x="22" y="27" fontSize="11" fontWeight="600" className="fill-foreground">
        通知管理
      </text>
      <text x="22" y="41" fontSize="8.5" className="fill-muted-foreground">
        Shui
      </text>
      <line x1="8" y1="50" x2="212" y2="50" className="stroke-border" strokeWidth="1" />
      {rows.map((row, index) => {
        const y = 64 + index * 25;
        return (
          <g key={row}>
            <text x="22" y={y + 10} fontSize="10" className="fill-foreground">
              {row}
            </text>
            <rect x="158" y={y} width="32" height="15" rx="7.5" fill="url(#guide-switch)" />
            <circle cx="182.5" cy={y + 7.5} r="5.5" fill="#ffffff" />
          </g>
        );
      })}
      {/* 需要操作的区域用琥珀色虚线框标出来 */}
      <rect
        x="150"
        y="56"
        width="48"
        height="96"
        rx="10"
        fill="none"
        stroke="#f59e0b"
        strokeWidth="1.6"
        strokeDasharray="5 3.5"
        opacity="0.9"
      />
    </svg>
  );
}

/** 顶部步骤条：已完成打勾、当前步带光环、未到灰显，均带文字标签。 */
function StepRail({ step }: { step: Step }) {
  return (
    <div
      className="mt-4 flex items-start"
      aria-label={`第 ${step + 1} 步，共 ${STEP_COUNT} 步`}
    >
      {STEP_LABELS.map((label, index) => {
        const done = index < step;
        const active = index === step;
        return (
          <Fragment key={label}>
            {index > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "mt-[13px] h-0.5 min-w-2 flex-1 rounded-full transition-colors duration-300",
                  index <= step ? "bg-sky-500/80" : "bg-border"
                )}
              />
            )}
            <span className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
              <span
                className={cn(
                  "flex h-[26px] w-[26px] items-center justify-center rounded-full text-[11px] font-semibold transition-all duration-300",
                  done && "bg-sky-500 text-white",
                  active &&
                    "bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-md shadow-sky-500/30 ring-4 ring-sky-500/15",
                  !done && !active && "bg-muted text-muted-foreground/80"
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}
              </span>
              <span
                className={cn(
                  "text-[10px] leading-none transition-colors",
                  active
                    ? "font-semibold text-foreground"
                    : done
                      ? "font-medium text-sky-600 dark:text-sky-400"
                      : "text-muted-foreground/70"
                )}
              >
                {label}
              </span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

/** 主操作按钮：全宽、品牌渐变、按下有轻微回弹。 */
function PrimaryAction({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-[15px] font-semibold text-white",
        "bg-gradient-to-r from-sky-500 to-indigo-500 shadow-lg shadow-sky-500/20",
        "transition-all duration-150 active:scale-[0.985] disabled:opacity-60 disabled:active:scale-100"
      )}
    >
      {children}
    </button>
  );
}

/** 次操作：低调的文字按钮，用于「上一步」「已打开」这类推进动作。 */
function GhostAction({
  children,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-9 items-center justify-center gap-1 rounded-lg px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  );
}

/** 每步的大标题与说明，字级与行高统一。 */
function StepHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h3 className="text-[19px] font-semibold leading-7 tracking-tight">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-[22px] text-muted-foreground">{children}</p>
    </>
  );
}

/* ──────────────────────────── 主组件 ──────────────────────────── */

export function NotificationSetupGuide() {
  const { permission, canRequest, request, refresh } = useNotificationPermission();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<Step>(0);
  const [pending, setPending] = useState(false);
  // 系统名与私有开关叫法随 ROM 变，文案不能写死某一个品牌。
  const [rom, setRom] = useState<RomProfile>(() => romProfile());

  useEffect(() => {
    let alive = true;
    (async () => {
      let health: NotificationHealth | null = null;
      try {
        health = await readNotificationHealth();
      } catch {
        return;
      }
      if (!alive || !health) return;
      // 先取 ROM 信息：即使引导已经看过、不再自动弹，第 3 步文案里也要用。
      const profile = romFromHealth(health);
      setRom(profile);
      if (readSeen()) return;
      /**
       * 只按「国产 ROM + 没看过」决定是否展示，**刻意不看通知权限**。
       *
       * 曾经这里还有 `health.notificationsEnabled` 条件，理由是「未授权交给权限
       * nudge 处理」。但清除数据 / 全新安装都会重置 POST_NOTIFICATIONS，于是
       * notificationsEnabled 恒为 false —— 引导对所有首次用户都是隐藏的，
       * 而 nudge 只是一张卡，跳完设置页就没了，关键的后台运行那一步永远到不了
       * 用户眼前。第 1 步本来就是「允许通知」，能自己处理未授权状态。
       */
      if (profile.domestic) {
        setStep(readStep());
        setVisible(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 手动唤起：体检卡里的「重新查看设置引导」，以及今日页漏提醒提示的「看设置步骤」。
  // 这里刻意不看 readSeen()，用户主动点进来就是要看，不能因为之前点过「稍后」就拒绝打开。
  useEffect(() => {
    const open = (event: Event) => {
      const requested = (event as CustomEvent<{ step?: number }>).detail?.step;
      const next: Step = requested === 2 ? 2 : requested === 1 ? 1 : 0;
      setStep(next);
      writeStep(next);
      setVisible(true);
      refresh();
    };
    window.addEventListener(OPEN_GUIDE_EVENT, open);
    return () => window.removeEventListener(OPEN_GUIDE_EVENT, open);
  }, [refresh]);

  // 第一步可检测：系统权限一旦通过就自动推进，不让用户做无谓确认。
  useEffect(() => {
    if (visible && step === 0 && permission === "granted") {
      setStep(1);
      writeStep(1);
    }
  }, [permission, step, visible]);

  const dismiss = useCallback(() => {
    // 跳过不立刻标记已看过：前两次关闭只关掉本次，下次启动还会再提示一次；
    // 连按三次才视为「用户明确不想要」，从此只在体检卡里留入口。
    if (bumpDismissCount() >= DISMISS_LIMIT) writeSeen();
    setVisible(false);
  }, []);

  const finish = useCallback(() => {
    writeSeen();
    try {
      window.localStorage.removeItem(DISMISS_KEY);
    } catch {
      // 计数残留无害：seen 已置位，不会再读它。
    }
    setVisible(false);
    // 引导里可能改了通知/精确闹钟/渠道，完成后主动通知体检卡重读，
    // 否则它的「打开引导」主按钮和检查项会停留在改之前的状态。
    emitRefresh();
    toast.success("设置完成，到点会有横幅、声音和震动");
  }, []);

  const goTo = useCallback((next: Step) => {
    setStep(next);
    writeStep(next);
  }, []);

  async function openSetting(command: string) {
    setPending(true);
    try {
      await invoke(command);
    } catch {
      toast.error("无法打开该设置页，请到系统设置中手动完成");
    } finally {
      setPending(false);
    }
  }

  async function allowNotifications() {
    setPending(true);
    try {
      await request();
      // 系统弹窗返回后立刻读一次；通过则上面的 effect 会自动推进。
      refresh();
    } finally {
      setPending(false);
    }
  }

  if (!visible) return null;

  const granted = permission === "granted";

  return (
    // 全局浮层：不能挂在某个 tab 里——tab 用 display:none 切换，用户停在「提醒」
    // tab 时挂在「今日」里的引导会被一起隐藏，装完包就永远看不到。遮罩同时阻止
    // 误触底层内容，首启一次性引导用模态更合适。
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="notif-guide-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] animate-in fade-in duration-200"
    >
      <section
        className={cn(
          "flex max-h-[88vh] w-full max-w-[420px] flex-col overflow-hidden",
          "rounded-[26px] border border-border/80 bg-card shadow-2xl shadow-slate-950/25",
          "animate-in slide-in-from-bottom-6 duration-300"
        )}
      >
        {/* ── 头部：品牌渐变 + 步骤条 ── */}
        <header className="relative shrink-0 overflow-hidden px-5 pb-4 pt-5">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-400/12 via-transparent to-indigo-500/12"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-8 -top-14 h-32 w-32 rounded-full bg-sky-400/15 blur-2xl"
          />
          <div className="relative">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-lg shadow-sky-500/25">
                <BellRing className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <h2
                    id="notif-guide-title"
                    className="text-[15px] font-semibold leading-5 tracking-tight"
                  >
                    让提醒真正弹出来
                  </h2>
                  <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold leading-4 text-sky-700 dark:text-sky-300">
                    3 步
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-[18px] text-muted-foreground">
                  只做一次，长期有效 · 大约 1 分钟
                </p>
              </div>
              <button
                type="button"
                aria-label="稍后设置"
                onClick={dismiss}
                className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <StepRail step={step} />
          </div>
        </header>

        {/* ── 内容：key 变化触发一次淡入，切换有方向感 ── */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-1 pt-4">
          <div
            key={step}
            className="animate-in fade-in slide-in-from-right-2 duration-300"
          >
            {step === 0 && (
              <>
                <StepHeading title="允许通知">
                  系统要允许 Shui 发送通知，否则所有提醒都会被直接丢弃——
                  <span className="font-medium text-foreground">
                    界面里显示「已开启」也没用
                  </span>
                  。
                </StepHeading>
                <DiagramFrame caption="示意图 · 弹窗出现时点「允许」">
                  <PermissionDiagram />
                </DiagramFrame>
              </>
            )}

            {step === 1 && (
              <>
                <StepHeading title="打开 4 个开关">
                  国产系统（OPPO / 小米 / vivo / 华为等）默认全部关闭。不打开的话，
                  到点只会静静躺在通知栏里——
                  <span className="font-medium text-foreground">
                    不弹窗、不响、不震
                  </span>
                  。
                </StepHeading>
                <DiagramFrame caption="示意图 · 横幅、锁屏、铃声、振动逐个打开">
                  <SwitchDiagram />
                </DiagramFrame>
                <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
                  <span aria-hidden="true" className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                  顺带确认「静默通知 / 设为不重要通知」是关闭的。
                </p>
              </>
            )}

            {step === 2 && (
              <>
                <StepHeading title="让后台也能准时提醒">
                  这一步决定「从多任务划掉 App 后还收不收得到」。
                  <span className="font-medium text-foreground">
                    第一项不打开，基本就收不到任何提醒
                  </span>
                  。即使打开了，也建议给 Shui 加锁：划掉卡片时系统会连排好的闹钟一起删掉。
                </StepHeading>

                {/* 必开项：视觉上必须压过其余两项，它是「收不到」的头号原因 */}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void openSetting("open_autostart_settings")}
                  className={cn(
                    "mt-3.5 flex w-full items-start gap-2.5 rounded-2xl border-2 border-amber-500/65 bg-amber-500/[0.09] p-3 text-left",
                    "transition-all duration-150 hover:border-amber-500 hover:bg-amber-500/[0.13] active:scale-[0.99] disabled:opacity-60"
                  )}
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                    <Power className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[14px] font-semibold text-amber-800 dark:text-amber-200">
                        后台运行 / 自启动
                      </span>
                      <span className="rounded bg-amber-500 px-1.5 py-px text-[9px] font-bold leading-4 text-white dark:text-amber-950">
                        必开
                      </span>
                    </span>
                    <span className="mt-1 block text-[12px] leading-[18px] text-amber-800/85 dark:text-amber-200/75">
                      不开这一项，划掉 App 后闹钟会被系统一起清掉，锁屏也不会有任何提醒。
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {["允许自启动", "允许后台活动", "允许后台运行"].map((alias) => (
                        <span
                          key={alias}
                          className="rounded-md bg-amber-500/12 px-1.5 py-0.5 text-[10px] leading-4 text-amber-700/90 dark:text-amber-300/80"
                        >
                          {alias}
                        </span>
                      ))}
                    </span>
                  </span>
                  <ChevronRight className="mt-1.5 h-4 w-4 shrink-0 text-amber-600/60 dark:text-amber-400/60" />
                </button>

                <div className="mt-2 space-y-1.5">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void openSetting("open_exact_alarm_settings")}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-background/50 px-3 py-2.5 text-left",
                      "transition-colors hover:border-sky-400/60 hover:bg-background disabled:opacity-60"
                    )}
                  >
                    <Timer className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium leading-5">
                        精确闹钟
                      </span>
                      <span className="block text-[11px] leading-4 text-muted-foreground">
                        允许「闹钟和提醒」，到点才准，否则可能晚十几分钟
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                  </button>

                  {/* 补充项：本机用 setExactAndAllowWhileIdle 已能穿透 Doze，
                      电池白名单不是硬门槛，只用来顺带关掉厂商的省电冻结开关。 */}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void openSetting("open_battery_settings")}
                    className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] leading-4 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-60"
                  >
                    <Settings className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      顺带把电池设为「不限制」，并关掉{rom.batteryLabel}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  </button>
                </div>

                <div className="mt-3 flex items-start gap-1.5 rounded-xl bg-muted/40 px-2.5 py-2">
                  <span
                    aria-hidden="true"
                    className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50"
                  />
                  <p className="text-[11px] leading-[18px] text-muted-foreground">
                    再回最近任务里长按 Shui 选「加锁 / 锁定」（多数国产系统支持），
                    可以避免被一键清理。
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── 底部：固定在卡片里的操作区，不随内容滚动 ── */}
        <footer className="shrink-0 border-t border-border/60 bg-card px-5 pb-4 pt-3">
          {step === 0 &&
            (granted ? (
              <>
                <p className="mb-2.5 flex items-center justify-center gap-1.5 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  通知权限已开启
                </p>
                <PrimaryAction onClick={() => goTo(1)}>
                  下一步
                  <ChevronRight className="h-4 w-4" />
                </PrimaryAction>
              </>
            ) : (
              <PrimaryAction disabled={pending} onClick={() => void allowNotifications()}>
                {canRequest ? "允许通知" : "去设置开启"}
              </PrimaryAction>
            ))}

          {step === 1 && (
            <>
              <PrimaryAction
                disabled={pending}
                onClick={() => void openSetting("open_notification_settings")}
              >
                <Settings className="h-4 w-4" />
                去通知设置
              </PrimaryAction>
              <div className="mt-1 flex items-center justify-between">
                <GhostAction onClick={() => goTo(0)}>上一步</GhostAction>
                <GhostAction disabled={pending} onClick={() => goTo(2)}>
                  已打开，下一步
                  <ChevronRight className="h-3.5 w-3.5" />
                </GhostAction>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <PrimaryAction onClick={finish}>
                <Check className="h-4 w-4" />
                完成设置
              </PrimaryAction>
              <div className="mt-1 flex items-center justify-start">
                <GhostAction onClick={() => goTo(1)}>上一步</GhostAction>
              </div>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
