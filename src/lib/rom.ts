/**
 * 国产 ROM 的系统名与私有开关叫法。
 *
 * 为什么需要这个：ColorOS 的「应用速冻」、小米的「省电策略 → 无限制」、华为的
 * 「应用启动管理」说的是同一件事，但用户在自己手机上找不到我们写的那一个。
 * 文案里点名具体的系统名和开关名，用户才能照着找到；认不出品牌时一律走中性
 * 表述（「系统」「电池设置里对 Shui 的后台限制」），绝不硬写某一个 ROM 的名字。
 *
 * 数据来源只有 Build.MANUFACTURER / Build.BRAND —— 这已经足够区分系统家族，
 * 再细的版本号（ColorOS 13/14、MIUI/HyperOS）拿不到，也不必区分：开关的叫法
 * 在同一家族里变化很小，实在改了用户也能靠「后台运行 / 省电」找到。
 */
import type { Diagnostics, NotificationHealth } from "./mobile";

export type RomKey =
  | "coloros"
  | "hyperos"
  | "originos"
  | "harmony"
  | "flyme"
  | "oneui"
  | "unknown";

export interface RomProfile {
  key: RomKey;
  /** 系统显示名；null 表示认不出，文案用「系统」兜底。 */
  name: string | null;
  /** 「自启动」这一项在本系统的叫法。 */
  autostartLabel: string;
  /** 自启动在设置里的完整路径，用于照着点的逐步引导。 */
  autostartPath: string[];
  /** 进到该页后要打开的具体开关。 */
  autostartHint: string;
  /** 部分系统有两条常见入口。 */
  autostartAlt?: string;
  /**
   * 「允许完全后台行为 / 后台运行」这一项的叫法。
   *
   * 和自启动是两个独立开关，入口也往往不在同一个页面：只开自启动、
   * 不给完全后台行为，锁屏后仍会被冻结。所以两项必须分开引导。
   */
  backgroundLabel: string;
  /** 完全后台行为在设置里的完整路径。 */
  backgroundPath: string[];
  backgroundHint: string;
  backgroundAlt?: string;
  /** 省电 / 冻结类设置在该系统的位置与叫法，可直接接在「关闭…」后面。 */
  batteryLabel: string;
  /** 是否有「默认全关且无公开 API」的厂商私有开关，需要引导用户手动开一次。 */
  domestic: boolean;
}

const PROFILES: Record<RomKey, RomProfile> = {
  coloros: {
    key: "coloros",
    name: "ColorOS",
    autostartLabel: "允许自启动",
    autostartPath: ["设置", "应用", "自启动管理"],
    autostartHint: "在列表里找到 Shui，打开开关",
    autostartAlt: "或：手机管家 → 权限隐私 → 自启动管理",
    backgroundLabel: "允许完全后台行为",
    backgroundPath: ["设置", "应用", "应用管理", "Shui", "耗电管理"],
    backgroundHint: "选「允许完全后台行为」",
    batteryLabel: "耗电管理里的「应用速冻」",
    domestic: true,
  },
  hyperos: {
    key: "hyperos",
    // 小米 / 红米同属一套体系，但老机型还叫 MIUI，写「小米系统」不会说错。
    name: "小米系统",
    autostartLabel: "自启动",
    autostartPath: ["设置", "应用设置", "应用管理", "Shui"],
    autostartHint: "打开「自启动」",
    autostartAlt: "或：手机管家 → 应用管理 → 权限 → 自启动",
    backgroundLabel: "省电策略：无限制",
    backgroundPath: ["设置", "应用设置", "应用管理", "Shui", "省电策略"],
    backgroundHint: "选「无限制」",
    batteryLabel: "省电策略里的「无限制」和「后台活动」",
    domestic: true,
  },
  originos: {
    key: "originos",
    name: "OriginOS",
    autostartLabel: "自启动",
    autostartPath: ["设置", "应用与权限", "权限管理", "自启动"],
    autostartHint: "打开 Shui 的开关",
    autostartAlt: "或：i 管家 → 应用管理 → 权限管理 → 自启动",
    backgroundLabel: "后台高耗电",
    backgroundPath: ["设置", "应用与权限", "应用管理", "Shui", "耗电"],
    backgroundHint: "选「允许后台高耗电」",
    batteryLabel: "后台耗电管理里的限制项",
    domestic: true,
  },
  harmony: {
    key: "harmony",
    name: "HarmonyOS",
    autostartLabel: "自启动",
    autostartPath: ["设置", "应用和服务", "应用启动管理", "Shui"],
    autostartHint: "关掉「自动管理」，打开「允许自启动」",
    backgroundLabel: "允许后台活动",
    backgroundPath: ["设置", "应用和服务", "应用启动管理", "Shui"],
    backgroundHint: "和自启动同一页，打开「允许后台活动」",
    batteryLabel: "应用启动管理里的「允许后台活动」",
    domestic: true,
  },
  flyme: {
    key: "flyme",
    name: "Flyme",
    autostartLabel: "自启动",
    autostartPath: ["手机管家", "权限管理", "自启动管理", "Shui"],
    autostartHint: "打开开关",
    backgroundLabel: "后台运行",
    backgroundPath: ["设置", "应用管理", "Shui", "耗电管理"],
    backgroundHint: "允许后台运行",
    batteryLabel: "待机耗电管理里的限制项",
    domestic: true,
  },
  oneui: {
    key: "oneui",
    name: "One UI",
    autostartLabel: "自动运行",
    autostartPath: ["设置", "电池", "后台使用限制", "休眠应用"],
    autostartHint: "把 Shui 移出休眠应用，允许自动运行",
    backgroundLabel: "允许后台活动",
    backgroundPath: ["设置", "应用", "Shui", "电池"],
    backgroundHint: "打开「允许后台活动」",
    batteryLabel: "电池设置里的「后台使用限制」",
    domestic: true,
  },
  unknown: {
    key: "unknown",
    // 认不出就不点名：硬写品牌比不写更容易误导。
    name: null,
    autostartLabel: "允许自启动",
    autostartPath: ["设置", "应用管理", "Shui"],
    autostartHint: "找到「自启动」并打开",
    backgroundLabel: "允许后台运行",
    backgroundPath: ["设置", "应用管理", "Shui", "耗电管理"],
    backgroundHint: "允许 Shui 后台运行",
    batteryLabel: "电池设置里对 Shui 的后台限制",
    domestic: false,
  },
};

/** 按厂商信息识别系统家族；认不出返回中性档案。 */
export function romProfile(
  manufacturer?: string | null,
  brand?: string | null
): RomProfile {
  const text = `${manufacturer ?? ""} ${brand ?? ""}`.trim().toLowerCase();
  if (!text) return PROFILES.unknown;

  if (/(oppo|realme|oneplus|coloros)/.test(text)) return PROFILES.coloros;
  if (/(xiaomi|redmi|poco|miui|hyperos)/.test(text)) return PROFILES.hyperos;
  if (/(vivo|iqoo)/.test(text)) return PROFILES.originos;
  if (/(huawei|honor)/.test(text)) return PROFILES.harmony;
  if (/meizu/.test(text)) return PROFILES.flyme;
  if (/samsung/.test(text)) return PROFILES.oneui;

  // 华硕 / 联想这类少见的国产 ROM：认不出具体系统，但「应用级开关默认全关」
  // 的共性成立，仍按国内系统处理，避免引导对它们整段消失。
  if (/(asus|lenovo|zuk)/.test(text)) {
    return { ...PROFILES.unknown, domestic: true };
  }
  return PROFILES.unknown;
}

export function romFromHealth(health: NotificationHealth | null): RomProfile {
  return romProfile(health?.manufacturer, health?.brand);
}

export function romFromDiagnostics(diag: Diagnostics | null): RomProfile {
  return romProfile(diag?.manufacturer, diag?.brand);
}
