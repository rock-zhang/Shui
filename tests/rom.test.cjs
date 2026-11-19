const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');

// rom.ts 只有 type import，transpile 后无运行时依赖，可直接用 Function 加载。
const api = (() => {
  const exports = {};
  new Function('exports', 'require', ts.transpileModule(readFileSync('src/lib/rom.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText)(exports, () => ({}));
  return exports;
})();

const HAS_CHINESE = /[\u3400-\u9fff]/;

const BRANDS = [
  ['OPPO', 'coloros'],
  ['Xiaomi', 'hyperos'],
  ['vivo', 'originos'],
  ['Huawei', 'harmony'],
  ['Meizu', 'flyme'],
  ['Samsung', 'oneui'],
  ['ASUS', 'unknown'],
];

function strings(profile) {
  const out = [];
  for (const value of Object.values(profile)) {
    if (typeof value === 'string') out.push(value);
    if (Array.isArray(value)) out.push(...value);
  }
  return out.filter(Boolean);
}

test('every ROM profile has an English copy with no Chinese left', () => {
  for (const [brand, key] of BRANDS) {
    const en = api.romProfile(brand, null, 'en-US');
    assert.equal(en.key, key, brand);
    const leftovers = strings(en).filter((s) => HAS_CHINESE.test(s));
    assert.deepEqual(leftovers, [], `${brand}: ${leftovers.join(' / ')}`);
  }
});

test('English menus use the real OEM setting names', () => {
  assert.deepEqual(api.romProfile('OPPO', null, 'en-US').autostartPath,
    ['Settings', 'Apps', 'Auto-Start Management']);
  assert.equal(api.romProfile('Xiaomi', null, 'en-US').backgroundLabel,
    'Battery saver: No restrictions');
  assert.ok(api.romProfile('Samsung', null, 'en-US').autostartPath.includes('Background usage limits'));
  assert.equal(api.romProfile('OPPO', null, 'zh-CN').autostartPath[2], '自启动管理');
});

test('language switch keeps identity and domestic flag', () => {
  const zh = api.romProfile('OPPO', null, 'zh-CN');
  const en = api.localizeRomProfile(zh, 'en-US');
  assert.equal(en.key, zh.key);
  assert.equal(en.domestic, zh.domestic);
  assert.notEqual(en.autostartLabel, zh.autostartLabel);

  const unknown = api.romProfile(null, null, 'en-US');
  assert.equal(unknown.key, 'unknown');
  assert.equal(unknown.domestic, false);
  assert.equal(unknown.name, null);
});
