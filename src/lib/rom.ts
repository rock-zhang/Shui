/**
 * 国产 ROM 的系统名与私有开关叫法。
 *
 * 为什么需要这个：ColorOS 的「应用速冻」、小米的「省电策略 → 无限制」、华为的
 * 「应用启动管理」说的是同一件事，但用户在自己手机上找不到我们写的那一个。
 * 文案里点名具体的系统名和开关名，用户才能照着找到；认不出品牌时一律走中性
 * 表述（「系统」「电池设置里对 Shui 的后台限制」），绝不硬写某一个 ROM 的名字。
 *
 * 中英各一套：英文按各 ROM 英文界面的真实菜单名写（Auto-Start Management、
 * Autostart / No restrictions、Background usage limits / Sleeping apps 等），
 * 不是把中文逐字翻译——用户在英文系统里要能照着找到同一处开关。
 *
 * 数据来源只有 Build.MANUFACTURER / Build.BRAND —— 这已经足够区分系统家族，
 * 再细的版本号（ColorOS 13/14、MIUI/HyperOS）拿不到，也不必区分：开关的叫法
 * 在同一家族里变化很小，实在改了用户也能靠「后台运行 / 省电」找到。
 */
import type { Locale } from "./i18n";
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

/** 与语言无关的字段提到外层，避免每个 ROM 把 key/domestic 写两遍。 */
interface RomCopy {
  name: string | null;
  autostartLabel: string;
  autostartPath: string[];
  autostartHint: string;
  autostartAlt?: string;
  backgroundLabel: string;
  backgroundPath: string[];
  backgroundHint: string;
  backgroundAlt?: string;
  batteryLabel: string;
}

type RomDefinition = Record<Locale, RomCopy> & { domestic: boolean };

const PROFILES: Record<RomKey, RomDefinition> = {
  coloros: {
    domestic: true,
    "zh-CN": {
      name: "ColorOS",
      autostartLabel: "允许自启动",
      autostartPath: ["设置", "应用", "自启动管理"],
      autostartHint: "在列表里找到 Shui，打开开关",
      autostartAlt: "或：手机管家 → 权限隐私 → 自启动管理",
      backgroundLabel: "允许完全后台行为",
      backgroundPath: ["设置", "应用", "应用管理", "Shui", "耗电管理"],
      backgroundHint: "选「允许完全后台行为」",
      batteryLabel: "耗电管理里的「应用速冻」",
    },
    "en-US": {
      name: "ColorOS",
      autostartLabel: "Auto-start",
      autostartPath: ["Settings", "Apps", "Auto-Start Management"],
      autostartHint: "Find Shui in the list and turn the switch on",
      autostartAlt: "Or: Security → Privacy → Auto-Start Management",
      backgroundLabel: "Allow background activity",
      backgroundPath: ["Settings", "Apps", "App management", "Shui", "Battery usage"],
      backgroundHint: "Select \"Allow background activity\"",
      batteryLabel: "App freeze in Battery usage",
    },
  },
  hyperos: {
    domestic: true,
    "zh-CN": {
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
    },
    "en-US": {
      name: "Xiaomi (MIUI / HyperOS)",
      autostartLabel: "Autostart",
      autostartPath: ["Settings", "Apps", "Manage apps", "Shui"],
      autostartHint: "Turn on \"Autostart\"",
      autostartAlt: "Or: Security → App management → Permissions → Autostart",
      backgroundLabel: "Battery saver: No restrictions",
      backgroundPath: ["Settings", "Apps", "Manage apps", "Shui", "Battery saver"],
      backgroundHint: "Select \"No restrictions\"",
      batteryLabel: "\"No restrictions\" and \"Background activity\" in Battery saver",
    },
  },
  originos: {
    domestic: true,
    "zh-CN": {
      name: "OriginOS",
      autostartLabel: "自启动",
      autostartPath: ["设置", "应用与权限", "权限管理", "自启动"],
      autostartHint: "打开 Shui 的开关",
      autostartAlt: "或：i 管家 → 应用管理 → 权限管理 → 自启动",
      backgroundLabel: "后台高耗电",
      backgroundPath: ["设置", "应用与权限", "应用管理", "Shui", "耗电"],
      backgroundHint: "选「允许后台高耗电」",
      batteryLabel: "后台耗电管理里的限制项",
    },
    "en-US": {
      name: "OriginOS",
      autostartLabel: "Autostart",
      autostartPath: ["Settings", "Apps & permissions", "Permission management", "Autostart"],
      autostartHint: "Turn Shui's switch on",
      autostartAlt: "Or: iManager → App management → Permission management → Autostart",
      backgroundLabel: "Background power consumption",
      backgroundPath: ["Settings", "Apps & permissions", "App management", "Shui", "Battery"],
      backgroundHint: "Select \"Allow background power consumption\"",
      batteryLabel: "Background power consumption restrictions",
    },
  },
  harmony: {
    domestic: true,
    "zh-CN": {
      name: "HarmonyOS",
      autostartLabel: "自启动",
      autostartPath: ["设置", "应用和服务", "应用启动管理", "Shui"],
      autostartHint: "关掉「自动管理」，打开「允许自启动」",
      backgroundLabel: "允许后台活动",
      backgroundPath: ["设置", "应用和服务", "应用启动管理", "Shui"],
      backgroundHint: "和自启动同一页，打开「允许后台活动」",
      batteryLabel: "应用启动管理里的「允许后台活动」",
    },
    "en-US": {
      name: "HarmonyOS",
      autostartLabel: "Auto-launch",
      autostartPath: ["Settings", "Apps & services", "App launch", "Shui"],
      autostartHint: "Turn off \"Manage automatically\", then turn on \"Auto-launch\"",
      backgroundLabel: "Run in background",
      backgroundPath: ["Settings", "Apps & services", "App launch", "Shui"],
      backgroundHint: "Same page as auto-launch — turn on \"Run in background\"",
      batteryLabel: "\"Run in background\" in App launch",
    },
  },
  flyme: {
    domestic: true,
    "zh-CN": {
      name: "Flyme",
      autostartLabel: "自启动",
      autostartPath: ["手机管家", "权限管理", "自启动管理", "Shui"],
      autostartHint: "打开开关",
      backgroundLabel: "后台运行",
      backgroundPath: ["设置", "应用管理", "Shui", "耗电管理"],
      backgroundHint: "允许后台运行",
      batteryLabel: "待机耗电管理里的限制项",
    },
    "en-US": {
      name: "Flyme",
      autostartLabel: "Autostart",
      autostartPath: ["Security", "Permission management", "Auto-start management", "Shui"],
      autostartHint: "Turn the switch on",
      backgroundLabel: "Background running",
      backgroundPath: ["Settings", "App management", "Shui", "Battery usage"],
      backgroundHint: "Allow background running",
      batteryLabel: "Standby power consumption restrictions",
    },
  },
  oneui: {
    domestic: true,
    "zh-CN": {
      name: "One UI",
      autostartLabel: "自动运行",
      autostartPath: ["设置", "电池", "后台使用限制", "休眠应用"],
      autostartHint: "把 Shui 移出休眠应用，允许自动运行",
      backgroundLabel: "允许后台活动",
      backgroundPath: ["设置", "应用", "Shui", "电池"],
      backgroundHint: "打开「允许后台活动」",
      batteryLabel: "电池设置里的「后台使用限制」",
    },
    "en-US": {
      name: "One UI",
      autostartLabel: "Auto run",
      autostartPath: ["Settings", "Battery", "Background usage limits", "Sleeping apps"],
      autostartHint: "Remove Shui from Sleeping apps and allow auto run",
      backgroundLabel: "Allow background activity",
      backgroundPath: ["Settings", "Apps", "Shui", "Battery"],
      backgroundHint: "Turn on \"Allow background activity\"",
      batteryLabel: "\"Background usage limits\" in Battery settings",
    },
  },
  unknown: {
    domestic: false,
    "zh-CN": {
      // 认不出就不点名：硬写品牌比不写更容易误导。
      name: null,
      autostartLabel: "允许自启动",
      autostartPath: ["设置", "应用管理", "Shui"],
      autostartHint: "找到「自启动」并打开",
      backgroundLabel: "允许后台运行",
      backgroundPath: ["设置", "应用管理", "Shui", "耗电管理"],
      backgroundHint: "允许 Shui 后台运行",
      batteryLabel: "电池设置里对 Shui 的后台限制",
    },
    "en-US": {
      name: null,
      autostartLabel: "Allow auto-start",
      autostartPath: ["Settings", "App management", "Shui"],
      autostartHint: "Find \"Autostart\" and turn it on",
      backgroundLabel: "Allow background running",
      backgroundPath: ["Settings", "App management", "Shui", "Battery usage"],
      backgroundHint: "Allow Shui to run in the background",
      batteryLabel: "Background restrictions for Shui in Battery settings",
    },
  },
};

function buildProfile(key: RomKey, locale: Locale, domestic: boolean): RomProfile {
  return { key, domestic, ...PROFILES[key][locale] };
}

/** 按厂商信息识别系统家族；认不出返回中性档案。 */
export function romProfile(
  manufacturer?: string | null,
  brand?: string | null,
  locale: Locale = "zh-CN"
): RomProfile {
  const text = `${manufacturer ?? ""} ${brand ?? ""}`.trim().toLowerCase();
  if (!text) return buildProfile("unknown", locale, false);

  if (/(oppo|realme|oneplus|coloros)/.test(text)) return buildProfile("coloros", locale, true);
  if (/(xiaomi|redmi|poco|miui|hyperos)/.test(text)) return buildProfile("hyperos", locale, true);
  if (/(vivo|iqoo)/.test(text)) return buildProfile("originos", locale, true);
  if (/(huawei|honor)/.test(text)) return buildProfile("harmony", locale, true);
  if (/meizu/.test(text)) return buildProfile("flyme", locale, true);
  if (/samsung/.test(text)) return buildProfile("oneui", locale, true);

  // 华硕 / 联想这类少见的国产 ROM：认不出具体系统，但「应用级开关默认全关」
  // 的共性成立，仍按国内系统处理，避免引导对它们整段消失。
  if (/(asus|lenovo|zuk)/.test(text)) return buildProfile("unknown", locale, true);
  return buildProfile("unknown", locale, false);
}

/** 已识别的档案切换语言时用：保留 key 与 domestic，只换文案。 */
export function localizeRomProfile(profile: RomProfile, locale: Locale): RomProfile {
  return buildProfile(profile.key, locale, profile.domestic);
}

export function romFromHealth(
  health: NotificationHealth | null,
  locale: Locale = "zh-CN"
): RomProfile {
  return romProfile(health?.manufacturer, health?.brand, locale);
}

export function romFromDiagnostics(
  diag: Diagnostics | null,
  locale: Locale = "zh-CN"
): RomProfile {
  return romProfile(diag?.manufacturer, diag?.brand, locale);
}
