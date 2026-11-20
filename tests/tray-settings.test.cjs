const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const ts = require('typescript');

// Run the real tray hook with an in-memory native menu/window boundary. No desktop
// state or autostart registration is changed by these regression tests.
async function settingsAction({ minimized = false, missing = false } = {}) {
  const effects = [], items = [], calls = [];
  let installed;
  const ready = new Promise(resolve => { installed = resolve; });
  const mainWindow = {
    async isMinimized() { return minimized; },
    async unminimize() { calls.push('restore'); },
    async show() { calls.push('show'); },
    async setFocus() { calls.push('focus'); },
  };
  const modules = {
    react: { useEffect: effect => effects.push(effect), useCallback: fn => fn },
    '@tauri-apps/api/tray': {
      TrayIcon: { getById: async id => {
        assert.equal(id, 'main-tray');
        return { setMenu: installed };
      } },
    },
    '@tauri-apps/api/menu': {
      Menu: { new: async () => ({ append: async item => { items.push(item); } }) },
      MenuItem: { new: async options => options },
      PredefinedMenuItem: { new: async options => options },
      Submenu: { new: async options => ({ ...options, append: async item => { items.push(item); } }) },
    },
    '@tauri-apps/api/core': { invoke: async () => {} },
    '@tauri-apps/api/webviewWindow': {
      WebviewWindow: { getByLabel: async label => {
        assert.equal(label, 'main');
        return missing ? null : mainWindow;
      } },
    },
    '@tauri-apps/api/app': { getVersion: async () => '0.2.32' },
    '@tauri-apps/plugin-os': { platform: () => 'macos' },
    'sonner': { toast: { error: () => {} } },
    '@/lib/mobile': { emitRefresh: () => {} },
    '@/lib/analytics': { trackDrinkRecorded: () => {} },
    '@/utils/sound': { playConfirmSound: async () => {} },
    '@/lib/i18n': {
      useI18n: () => ({
        locale: 'zh-CN',
        // 托盘菜单本地化后按 key 取词；测试里给中文值，保持原有断言语义。
        t: key => ({
          'tray.preferences': '偏好设置',
          'tray.restNow': '立即休息',
          'tray.recordDrink': '记录喝水',
          'tray.timerControl': '计时控制',
          'tray.pause': '暂停计时',
          'tray.restart': '重新计时',
          'tray.quit': '退出',
        }[key] ?? key),
      }),
    },
  };
  const code = ts.transpileModule(readFileSync('src/hooks/use-tray.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const api = {};
  new Function('exports', 'require', code)(api, name => {
    assert.ok(modules[name], `Unexpected tray dependency: ${name}`);
    return modules[name];
  });
  api.useTray();
  effects.forEach(effect => effect());
  await ready;
  const action = items.find(item => item.text === '偏好设置')?.action;
  assert.equal(typeof action, 'function', 'settings remains reachable from the tray');
  await action();
  return calls;
}

test('tray preferences shows and focuses the hidden settings window', { timeout: 2000 }, async () => {
  assert.deepEqual(await settingsAction(), ['show', 'focus']);
});

test('tray preferences restores minimized settings before showing and focusing', { timeout: 2000 }, async () => {
  assert.deepEqual(await settingsAction({ minimized: true }), ['restore', 'show', 'focus']);
});

test('tray preferences tolerates an unavailable main window', { timeout: 2000 }, async () => {
  assert.deepEqual(await settingsAction({ missing: true }), []);
});
