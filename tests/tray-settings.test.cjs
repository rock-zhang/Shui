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
      Submenu: { new: async options => options },
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
