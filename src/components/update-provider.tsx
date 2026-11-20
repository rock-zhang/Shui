"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { detectPlatform, isSideloadBuild } from "@/lib/mobile";

/** 侧载 Android 版本清单响应，与 Rust `sideload_check_update` 对齐。 */
export type SideloadCheck = {
  available: boolean;
  currentVersion: string;
  latest: {
    version: string;
    notes: string;
    apkUrl: string;
    sha256: string;
  } | null;
};

/**
 * 冷启动时网络还没回来，先用上次结果点亮红点，避免「刚打开没提示、
 * 过几秒突然冒出来」的跳变。存的是「服务端最新版本号」而不是布尔值，
 * 这样覆盖安装后版本追平，恢复时比对当前版本就能自动归零。
 */
const CACHE_KEY = "shui:update-state";

/** 启动后延迟首查：避开首屏渲染与启动期的资源争抢。 */
const FIRST_CHECK_DELAY_MS = 8_000;
/** 常驻轮询周期。6 小时足够——发版不是分钟级事件。 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 回前台补查的最小间隔，避免频繁切前后台反复打接口。 */
const FOREGROUND_MIN_GAP_MS = 60 * 60 * 1000;

type CachedState = {
  version: string | null;
  checkedAt: number;
  seen: boolean;
};

/** 语义版本比较：a > b 返回 true。解析失败按 0 处理，不抛异常。 */
function versionGt(a: string, b: string): boolean {
  const parse = (value: string) =>
    value
      .trim()
      .replace(/^v/i, "")
      .split(/[.\-+]/)
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

function readCache(): CachedState | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedState> | null;
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      version: typeof parsed.version === "string" ? parsed.version : null,
      checkedAt: typeof parsed.checkedAt === "number" ? parsed.checkedAt : 0,
      seen: parsed.seen === true,
    };
  } catch {
    return null;
  }
}

function writeCache(next: CachedState) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式 / 存储写满：红点退化为单次会话内有效，不影响功能。
  }
}

/** 当前包是否具备自更新能力：桌面恒 true，Android 仅侧载包。 */
function canSelfUpdate(): boolean {
  if (detectPlatform() !== "android") return true;
  return isSideloadBuild();
}

function isAndroidSideload(): boolean {
  return detectPlatform() === "android" && isSideloadBuild();
}

export type UpdateContextValue = {
  /** 是否有可用更新。 */
  available: boolean;
  latestVersion: string | null;
  /** 用户是否已经在「我」/关于页看过，用于决定 tab 红点是否显示。 */
  seen: boolean;
  checking: boolean;
  installing: boolean;
  /** 0-100。Android 侧载来自原生下载回调，桌面来自 updater 事件。 */
  progress: number;
  /** 手动检查（无更新 / 失败会 toast）。 */
  checkNow: () => Promise<void>;
  /** 进入「我」tab 或关于页时调用，灭掉 tab 红点。 */
  markSeen: () => void;
  /** 下载并拉起安装。 */
  install: () => Promise<void>;
};

const UpdateContext = createContext<UpdateContextValue | null>(null);

/**
 * 全局更新状态。
 *
 * 为什么要在 Provider 里统一：tab 红点、关于页版本号、移动端「我」tab 的
 * 更新行是三个互不相邻的位置，各自 new 一个 hook 会各自发请求、各自维护
 * 状态，出现「红点亮着但按钮说已是最新」这种自相矛盾。
 *
 * Play 包整个链路不启用：不发请求、不亮红点——原生产物里既没有安装权限
 * 也没有自更新代码，前端再显示入口就是骗人。
 */
export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [seen, setSeen] = useState(true);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const lastCheckedAt = useRef(0);
  // 检查中不并发再来一次（定时器与回前台可能撞上）。
  const inFlight = useRef(false);
  /**
   * 检查结果同时写进 ref：`runCheck` 必须保持引用稳定，否则它一变，
   * 下面的定时器 effect 就会重建——首查延迟被无限推迟，永远查不到。
   */
  const latestVersionRef = useRef<string | null>(null);
  const seenRef = useRef(true);

  useEffect(() => {
    setEnabled(canSelfUpdate());
  }, []);

  /** 拉一次远端最新版本号；无更新返回 null。 */
  const fetchLatest = useCallback(async (): Promise<string | null> => {
    if (isAndroidSideload()) {
      const result = await invoke<SideloadCheck>("sideload_check_update");
      return result.available && result.latest ? result.latest.version : null;
    }
    const update = await check();
    return update?.version ?? null;
  }, []);

  /** 落一次检查结果：同步 state、ref 与缓存，避免三处漂移。 */
  const applyResult = useCallback((version: string | null, at: number) => {
    const sameVersion = version !== null && latestVersionRef.current === version;
    // 同一个版本重复检查不要重置「已读」，否则每次轮询红点都重新冒出来。
    const nextSeen = version === null ? true : sameVersion ? seenRef.current : false;
    latestVersionRef.current = version;
    seenRef.current = nextSeen;
    setLatestVersion(version);
    setSeen(nextSeen);
    writeCache({ version, checkedAt: at, seen: nextSeen });
    return { sameVersion, nextSeen };
  }, []);

  /**
   * 执行一次检查。`manual` 为 false 时全程静默——定时检查失败不能弹 toast
   * 打断用户（离线、GitHub 抽风都会走到这里）。
   */
  const runCheck = useCallback(
    async (manual: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setChecking(true);
      try {
        const version = await fetchLatest();
        const now = Date.now();
        lastCheckedAt.current = now;
        applyResult(version, now);
        if (manual) {
          if (version) {
            toast.success(t("settings.about.updateFound", { version }));
          } else {
            toast(t("updater.upToDate"));
          }
        }
      } catch (error) {
        // 定时检查静默；手动才把真实原因露出来（清单 404、TargetNotFound 等）。
        if (manual) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("检查更新失败:", error);
          toast.error(t("updater.checkFailed"), { description: message });
        }
      } finally {
        inFlight.current = false;
        setChecking(false);
      }
    },
    [applyResult, fetchLatest, t]
  );

  // 冷启动：用缓存先点亮，再按当前版本校准，避免覆盖安装后误报。
  useEffect(() => {
    if (!enabled) return;
    const cached = readCache();
    if (!cached) return;
    lastCheckedAt.current = cached.checkedAt;
    if (!cached.version) return;
    getVersion()
      .then((current) => {
        if (versionGt(cached.version as string, current)) {
          latestVersionRef.current = cached.version;
          seenRef.current = cached.seen;
          setLatestVersion(cached.version);
          setSeen(cached.seen);
        }
      })
      .catch(() => {
        // 浏览器预览拿不到原生版本号：直接采信缓存，便于调 UI。
        latestVersionRef.current = cached.version;
        seenRef.current = cached.seen;
        setLatestVersion(cached.version);
        setSeen(cached.seen);
      });
  }, [enabled]);

  // 定时检查：延迟首查 + 常驻轮询。
  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(
      () => void runCheck(false),
      FIRST_CHECK_DELAY_MS
    );
    const timer = window.setInterval(
      () => void runCheck(false),
      CHECK_INTERVAL_MS
    );
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [enabled, runCheck]);

  // 回前台补查：手机上 App 可能挂后台好几天，定时器会被系统冻结/节流。
  // 已有待装更新时强制重查——用户很可能刚从安装界面回来，版本已经变了。
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const stale = Date.now() - lastCheckedAt.current;
      if (latestVersionRef.current || stale > FOREGROUND_MIN_GAP_MS) {
        void runCheck(false);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, runCheck]);

  // Android 侧载：原生下载线程派发 DOM 事件上报进度。
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<number>).detail;
      if (typeof detail === "number") {
        setProgress(Math.min(100, Math.max(0, Math.round(detail))));
      }
    };
    window.addEventListener("shui:update-progress", handler);
    return () => window.removeEventListener("shui:update-progress", handler);
  }, [enabled]);

  const checkNow = useCallback(() => runCheck(true), [runCheck]);

  const markSeen = useCallback(() => {
    if (seenRef.current) return;
    seenRef.current = true;
    setSeen(true);
    writeCache({
      version: latestVersionRef.current,
      checkedAt: lastCheckedAt.current,
      seen: true,
    });
  }, []);

  /** Android 侧载：授权检查 → 下载校验 → 拉起系统安装器。 */
  const installAndroid = useCallback(async () => {
    const canInstall = await invoke<boolean>("sideload_can_install").catch(
      () => false
    );
    if (!canInstall) {
      await invoke("sideload_open_install_settings").catch(() => {});
      throw new Error(t("updater.needInstallPermission"));
    }
    // 重新取一次清单：缓存里的版本可能已过期，下载地址与摘要以最新为准。
    const result = await invoke<SideloadCheck>("sideload_check_update");
    if (!result.available || !result.latest) {
      throw new Error(t("updater.noUpdate"));
    }
    const path = await invoke<string>("sideload_download_update", {
      info: result.latest,
    });
    await invoke("sideload_install_apk", { path });
  }, [t]);

  const install = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setInstalling(true);
    setProgress(0);
    try {
      if (isAndroidSideload()) {
        await installAndroid();
        return;
      }

      const update = await check();
      if (!update) throw new Error(t("updater.noUpdate"));

      let downloaded = 0;
      let contentLength = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = (event.data.contentLength as number) ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setProgress(
                Math.min(100, Math.round((downloaded / contentLength) * 100))
              );
            }
            break;
          case "Finished":
            setProgress(100);
            break;
        }
      });
      await relaunch();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("更新安装失败:", error);
      toast.error(t("updater.installFailed"), { description: message });
      setProgress(0);
    } finally {
      inFlight.current = false;
      setInstalling(false);
    }
  }, [installAndroid, t]);

  const value: UpdateContextValue = {
    available: latestVersion !== null,
    latestVersion,
    seen,
    checking,
    installing,
    progress,
    checkNow,
    markSeen,
    install,
  };

  return (
    <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
  );
}

/**
 * 读取全局更新状态。
 *
 * Provider 之外调用返回一个安全的空状态，而不是抛错——这样单独渲染某个
 * 组件（测试、局部预览）不会整个白屏。
 */
export function useUpdate(): UpdateContextValue {
  const context = useContext(UpdateContext);
  if (context) return context;
  return {
    available: false,
    latestVersion: null,
    seen: true,
    checking: false,
    installing: false,
    progress: 0,
    checkNow: async () => {},
    markSeen: () => {},
    install: async () => {},
  };
}
