"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BellRing,
  Check,
  CheckCircle2,
  ChevronRight,
  Settings,
  Timer,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { emitRefresh, readNotificationHealth, type NotificationHealth } from "@/lib/mobile";
import { localizeRomProfile, romFromHealth, romProfile, type RomProfile } from "@/lib/rom";
import { useNotificationPermission } from "./notification-permission-context";
import { BackgroundGuideCards } from "./background-guide-cards";

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

const STEP_LABEL_KEYS: MessageKey[] = [
  "mobile.guide.step.permission",
  "mobile.guide.step.switches",
  "mobile.guide.step.background",
];
/** 埋点用英文步骤名，避免中文参数在分析平台里出现编码问题。 */
const STEP_NAMES = ["permission", "switches", "background"] as const;
const STEP_COUNT = STEP_LABEL_KEYS.length;

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
function PermissionDiagram({ t }: { t: ReturnType<typeof useI18n>["t"] }) {
  return (
    <svg
      viewBox="0 0 220 116"
      className="h-[116px] w-auto"
      role="img"
      aria-label={t("mobile.guide.diagram.permissionAria")}
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
        {t("mobile.guide.diagram.allowTitle")}
      </text>
      <text x="110" y="84" textAnchor="middle" fontSize="9" className="fill-muted-foreground">
        {t("mobile.guide.diagram.allowBody")}
      </text>
      <rect x="28" y="93" width="76" height="18" rx="9" className="fill-muted" />
      <text x="66" y="105.5" textAnchor="middle" fontSize="9.5" className="fill-muted-foreground">
        {t("mobile.guide.diagram.deny")}
      </text>
      <rect x="116" y="93" width="76" height="18" rx="9" fill="url(#guide-allow)" />
      <text x="154" y="105.5" textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#ffffff">
        {t("mobile.guide.diagram.allow")}
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
function SwitchDiagram({ t }: { t: ReturnType<typeof useI18n>["t"] }) {
  const rows = [
    t("mobile.guide.diagram.banner"),
    t("mobile.guide.diagram.lockscreen"),
    t("mobile.guide.diagram.ringtone"),
    t("mobile.guide.diagram.vibration"),
  ];
  return (
    <svg
      viewBox="0 0 220 164"
      className="h-[158px] w-auto"
      role="img"
      aria-label={t("mobile.guide.diagram.switchesAria")}
    >
      <defs>
        <linearGradient id="guide-switch" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect x="8" y="4" width="204" height="156" rx="18" className="fill-card stroke-border" strokeWidth="1.2" />
      <text x="22" y="27" fontSize="11" fontWeight="600" className="fill-foreground">
        {t("mobile.guide.diagram.manageTitle")}
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
function StepRail({ step, t }: { step: Step; t: ReturnType<typeof useI18n>["t"] }) {
  return (
    <div
      className="mt-4 flex items-start"
      aria-label={t("mobile.guide.stepAria", { current: step + 1, total: STEP_COUNT })}
    >
      {STEP_LABEL_KEYS.map((labelKey, index) => {
        const label = t(labelKey);
        const done = index < step;
        const active = index === step;
        return (
          <Fragment key={labelKey}>
            {index > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "mt-[13px] h-0.5 min-w-2 flex-1 rounded-full transition-colors duration-300",
                  index <= step ? "bg-sky-500/80" : "bg-border"
                )}
              />
            )}
            <span className="flex w-auto min-w-[68px] max-w-[96px] shrink-0 flex-col items-center gap-1.5">
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
                  "text-center text-[10px] leading-tight transition-colors",
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
  const { t, locale } = useI18n();
  const { permission, canRequest, request, refresh } = useNotificationPermission();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<Step>(0);
  const [pending, setPending] = useState(false);
  // 系统名与私有开关叫法随 ROM 变，文案不能写死某一个品牌。
  // state 只存识别结果（key/domestic），渲染时再按当前语言取文案：
  // 异步读 health 后 setRom 也不会把已切换的英文覆盖回中文。
  const [romProfileState, setRom] = useState<RomProfile>(() => romProfile());
  const rom = localizeRomProfile(romProfileState, locale);
  // 检测守卫或用户手动唤起过：本次挂载内不要再让首启逻辑改 step。
  const manualOpenRef = useRef(false);
  const showStartedAt = useRef(Date.now());
  const loggedSteps = useRef<Set<number>>(new Set());

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
        // 已经由检测守卫（或用户手动）打开过的话，别把 step 覆盖回首启进度。
        if (manualOpenRef.current) return;
        const startStep = readStep();
        setStep(startStep);
        setVisible(true);
        showStartedAt.current = Date.now();
        loggedSteps.current = new Set();
        track("guide_shown", {
          trigger: "auto_first_launch",
          entry_source: "startup",
          start_step: startStep,
          domestic_rom: profile.domestic,
        });
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
      manualOpenRef.current = true;
      const detail = (event as CustomEvent<{ step?: number; source?: string }>)
        .detail;
      const requested = detail?.step;
      const next: Step = requested === 2 ? 2 : requested === 1 ? 1 : 0;
      setStep(next);
      writeStep(next);
      setVisible(true);
      refresh();
      showStartedAt.current = Date.now();
      loggedSteps.current = new Set();
      track("guide_shown", {
        trigger: "manual",
        entry_source: detail?.source ?? "unknown",
        start_step: next,
        domestic_rom: rom.domestic,
      });
    };
    window.addEventListener(OPEN_GUIDE_EVENT, open);
    return () => window.removeEventListener(OPEN_GUIDE_EVENT, open);
  }, [refresh, rom.domestic]);

  // 第一步可检测：系统权限一旦通过就自动推进，不让用户做无谓确认。
  useEffect(() => {
    if (visible && step === 0 && permission === "granted") {
      setStep(1);
      writeStep(1);
    }
  }, [permission, step, visible]);

  // 每一步只记一次浏览；自动推进或来回切换都不会刷出重复的 step_view。
  useEffect(() => {
    if (!visible) return;
    if (loggedSteps.current.has(step)) return;
    loggedSteps.current.add(step);
    track("guide_step_view", {
      step,
      step_name: STEP_NAMES[step],
    });
  }, [visible, step]);

  const dismiss = useCallback(() => {
    // 跳过不立刻标记已看过：前两次关闭只关掉本次，下次启动还会再提示一次；
    // 连按三次才视为「用户明确不想要」，从此只在体检卡里留入口。
    const next = bumpDismissCount();
    if (next >= DISMISS_LIMIT) writeSeen();
    setVisible(false);
    track("guide_dismiss", {
      step,
      dismiss_count: next,
      will_auto_show_again: next < DISMISS_LIMIT,
    });
  }, [step]);

  const finish = useCallback(() => {
    writeSeen();
    try {
      window.localStorage.removeItem(DISMISS_KEY);
    } catch {
      // 计数残留无害：seen 已置位，不会再读它。
    }
    setVisible(false);
    const durationMs = Date.now() - showStartedAt.current;
    // 完成时再读一次健康状态：用户可能刚在系统设置里打开了精确闹钟/电池。
    void readNotificationHealth()
      .then((health) => {
        track("guide_complete", {
          steps_seen: 3,
          notification_granted: health?.notificationsEnabled ?? false,
          exact_alarm: health?.exactAlarm ?? false,
          battery_ignored: health?.batteryIgnored ?? false,
          duration_ms: Math.max(0, durationMs),
        });
      })
      .catch(() => {
        track("guide_complete", {
          steps_seen: 3,
          duration_ms: Math.max(0, durationMs),
        });
      });
    // 引导里可能改了通知/精确闹钟/渠道，完成后主动通知体检卡重读，
    // 否则它的「打开引导」主按钮和检查项会停留在改之前的状态。
    emitRefresh();
    toast.success(t("mobile.guide.doneToast"));
  }, [t]);

  const goTo = useCallback(
    (next: Step) => {
      track("guide_step_nav", {
        from_step: step,
        to_step: next,
        direction: next > step ? "next" : "back",
      });
      setStep(next);
      writeStep(next);
    },
    [step]
  );

  async function openSetting(command: string) {
    const target =
      command === "open_notification_settings"
        ? "notification"
        : command === "open_exact_alarm_settings"
          ? "exact_alarm"
          : "battery";
    track("settings_opened", { target, source: `guide_step${step + 1}` });
    track("guide_step_action", {
      step,
      action:
        command === "open_notification_settings"
          ? "open_notification_settings"
          : command === "open_exact_alarm_settings"
            ? "open_exact_alarm"
            : "open_battery",
    });
    setPending(true);
    try {
      await invoke(command);
    } catch {
      toast.error(t("mobile.notif.openSettingsFailed"));
    } finally {
      setPending(false);
    }
  }

  async function allowNotifications() {
    setPending(true);
    track("guide_step_action", { step: 0, action: "allow_notification" });
    try {
      await request("guide_step1");
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
                    {t("mobile.guide.title")}
                  </h2>
                  <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold leading-4 text-sky-700 dark:text-sky-300">
                    {t("mobile.guide.stepsBadge", { count: STEP_COUNT })}
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-[18px] text-muted-foreground">
                  {t("mobile.guide.subtitle")}
                </p>
              </div>
              <button
                type="button"
                aria-label={t("mobile.guide.later")}
                onClick={dismiss}
                className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <StepRail step={step} t={t} />
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
                <StepHeading title={t("mobile.guide.step0.title")}>
                  {t("mobile.guide.step0.bodyStart")}
                  <span className="font-medium text-foreground">
                    {t("mobile.guide.step0.bodyEmphasis")}
                  </span>
                  {t("mobile.guide.step0.bodyEnd")}
                </StepHeading>
                <DiagramFrame caption={t("mobile.guide.step0.caption")}>
                  <PermissionDiagram t={t} />
                </DiagramFrame>
              </>
            )}

            {step === 1 && (
              <>
                <StepHeading title={t("mobile.guide.step1.title")}>
                  {t("mobile.guide.step1.bodyStart")}
                  <span className="font-medium text-foreground">
                    {t("mobile.guide.step1.bodyEmphasis")}
                  </span>
                  {t("mobile.guide.step1.bodyEnd")}
                </StepHeading>
                <DiagramFrame caption={t("mobile.guide.step1.caption")}>
                  <SwitchDiagram t={t} />
                </DiagramFrame>
                <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
                  <span aria-hidden="true" className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                  {t("mobile.guide.step1.silentHint")}
                </p>
              </>
            )}

            {step === 2 && (
              <>
                <StepHeading title={t("mobile.guide.step2.title")}>
                  {t("mobile.guide.step2.bodyStart")}
                  <span className="font-medium text-foreground">
                    {t("mobile.guide.step2.bodyEmphasis")}
                  </span>
                  {t("mobile.guide.step2.bodyEnd")}
                </StepHeading>

                {/* 与漏提醒弹窗共用同一套分步引导：同样的路径、同样的跳转。
                    厂商开关读不到状态，每次出现都只请用户按路径检查。 */}
                <div className="mt-3.5">
                  <BackgroundGuideCards rom={rom} source="guide_step3" />
                </div>

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
                        {t("mobile.guide.step2.exactTitle")}
                      </span>
                      <span className="block text-[11px] leading-4 text-muted-foreground">
                        {t("mobile.guide.step2.exactHint")}
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
                      {t("mobile.guide.step2.battery", { label: rom.batteryLabel })}
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
                    {t("mobile.guide.step2.lockHint")}
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
                  {t("mobile.notif.enabled")}
                </p>
                <PrimaryAction onClick={() => goTo(1)}>
                  {t("mobile.guide.next")}
                  <ChevronRight className="h-4 w-4" />
                </PrimaryAction>
              </>
            ) : (
              <PrimaryAction disabled={pending} onClick={() => void allowNotifications()}>
                {canRequest ? t("mobile.guide.allow") : t("mobile.guide.goEnable")}
              </PrimaryAction>
            ))}

          {step === 1 && (
            <>
              <PrimaryAction
                disabled={pending}
                onClick={() => void openSetting("open_notification_settings")}
              >
                <Settings className="h-4 w-4" />
                {t("mobile.guide.goNotificationSettings")}
              </PrimaryAction>
              <div className="mt-1 flex items-center justify-between">
                <GhostAction onClick={() => goTo(0)}>{t("mobile.guide.prev")}</GhostAction>
                <GhostAction disabled={pending} onClick={() => goTo(2)}>
                  {t("mobile.guide.openedNext")}
                  <ChevronRight className="h-3.5 w-3.5" />
                </GhostAction>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <PrimaryAction onClick={finish}>
                <Check className="h-4 w-4" />
                {t("mobile.guide.finish")}
              </PrimaryAction>
              <div className="mt-1 flex items-center justify-start">
                <GhostAction onClick={() => goTo(1)}>{t("mobile.guide.prev")}</GhostAction>
              </div>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
