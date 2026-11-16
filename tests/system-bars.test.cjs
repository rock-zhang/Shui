const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) =>
  fs.readFileSync(path.join(root, relative), "utf8");

/** OKLCH -> sRGB hex，和 CSS 主题 token 用同一套转换矩阵。 */
function oklchToHex(lch) {
  const [L, C, H] = lch.trim().split(/\s+/).map(Number);
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  const encode = (x) => {
    const clamped = Math.min(1, Math.max(0, x));
    const gamma =
      clamped <= 0.0031308
        ? 12.92 * clamped
        : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    return Math.round(gamma * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  };
  return `#${linear.map(encode).join("")}`;
}

function cssBackground(source, selector) {
  const pattern = new RegExp(
    `${selector}\\s*\\{[\\s\\S]*?--background:\\s*oklch\\(([^)]+)\\)`
  );
  const match = source.match(pattern);
  assert.ok(match, `找不到 ${selector} 的 --background token`);
  return oklchToHex(match[1]);
}

function androidColor(source, name) {
  const match = source.match(
    new RegExp(`<color name="${name}">#[0-9A-Fa-f]{2}([0-9A-Fa-f]{6})</color>`)
  );
  assert.ok(match, `找不到 Android 颜色 ${name}`);
  return `#${match[1].toUpperCase()}`;
}

test("Android 系统栏颜色与 Web 主题 token 完全一致", () => {
  const css = read("src/app/globals.css");
  const colors = read(
    "src-tauri/gen/android/app/src/main/res/values/colors.xml"
  );
  const light = cssBackground(css, ":root");
  const dark = cssBackground(css, "\\.dark");

  assert.equal(light, androidColor(colors, "shui_surface_light"));
  assert.equal(dark, androidColor(colors, "shui_surface_dark"));
});

test("themeColor 元信息同样跟随 CSS 主题 token", () => {
  const css = read("src/app/globals.css");
  const layout = read("src/app/layout.tsx");
  const pick = (scheme) => {
    const match = layout.match(
      new RegExp(
        `prefers-color-scheme:\\s*${scheme}\\)",\\s*color:\\s*"#([0-9a-fA-F]{6})"`
      )
    );
    assert.ok(match, `找不到 ${scheme} 的 themeColor`);
    return `#${match[1].toUpperCase()}`;
  };

  assert.equal(pick("light"), cssBackground(css, ":root"));
  assert.equal(pick("dark"), cssBackground(css, "\\.dark"));
});

test("亮/暗主题都显式声明了状态栏、导航条与图标明暗", () => {
  const cases = [
    {
      file: "values/themes.xml",
      surface: "@color/shui_surface_light",
      lightIcons: "true",
    },
    {
      file: "values-night/themes.xml",
      surface: "@color/shui_surface_dark",
      lightIcons: "false",
    },
  ];

  for (const item of cases) {
    const xml = read(
      `src-tauri/gen/android/app/src/main/res/${item.file}`
    );
    for (const attr of [
      "android:windowBackground",
      "android:statusBarColor",
      "android:navigationBarColor",
      "android:windowLightStatusBar",
      "android:windowLightNavigationBar",
    ]) {
      assert.ok(xml.includes(attr), `${item.file} 缺少 ${attr}`);
    }
    assert.ok(xml.includes(item.surface), `${item.file} 未引用 ${item.surface}`);
    assert.ok(
      xml.includes(
        `<item name="android:windowLightStatusBar">${item.lightIcons}</item>`
      ),
      `${item.file} 的状态栏图标明暗不对`
    );
  }
});

test("系统栏主题同步链路在 Kotlin / Rust / Web 三侧都接上了", () => {
  const plugin = read(
    "src-tauri/gen/android/app/src/main/java/com/shui/app/ReminderPlugin.kt"
  );
  const activity = read(
    "src-tauri/gen/android/app/src/main/java/com/shui/app/MainActivity.kt"
  );
  const rust = read("src-tauri/src/mobile.rs");
  const registry = read("src-tauri/src/lib.rs");
  const hook = read("src/hooks/use-system-bars.ts");
  const app = read("src/components/mobile/mobile-app.tsx");

  assert.match(plugin, /fun setSystemBarTheme\(invoke: Invoke\)/);
  assert.match(plugin, /fun applySystemBarTheme\(activity: Activity\)/);
  assert.match(activity, /onConfigurationChanged/);
  assert.match(activity, /onResume/);
  assert.match(rust, /pub fn set_system_bar_theme/);
  assert.match(registry, /mobile::set_system_bar_theme/);
  assert.match(hook, /invoke\("set_system_bar_theme"/);
  assert.match(app, /useSystemBars\(\)/);
});
