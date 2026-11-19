const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');

function client(invoke) {
  const api = {};
  new Function('exports', 'require', ts.transpileModule(readFileSync('src/lib/data-backup.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText)(api, () => ({ invoke }));
  return api;
}

test('file selection and backup cancellation stay explicit', async () => {
  const calls = [];
  const api = client(async (...args) => { calls.push(args); return null; });
  assert.equal(await api.exportDrinkBackup(), null);
  assert.equal(await api.previewDrinkImport(), null);
  assert.deepEqual(calls.map(([command]) => command), ['export_drink_backup', 'preview_drink_import']);
});

test('confirmation uses the backend preview token and preserves retry identity', async () => {
  const calls = [];
  const receipt = { importedDays: 1, skippedDays: 2, importedAmount: 800, alreadyImported: false };
  const api = client(async (...args) => { calls.push(args); return receipt; });
  assert.equal(await api.confirmDrinkImport('preview-token'), receipt);
  await api.confirmDrinkImport('preview-token');
  assert.deepEqual(calls, [
    ['confirm_drink_import', { token: 'preview-token' }],
    ['confirm_drink_import', { token: 'preview-token' }],
  ]);
});

test('native errors propagate to the view with readable messages', async () => {
  const api = client(async () => { throw '备份包含重复的记录标识'; });
  await assert.rejects(api.previewDrinkImport(), error => error === '备份包含重复的记录标识');
  assert.equal(api.backupError('无法写入'), '无法写入');
  assert.equal(api.backupError(new Error('disk full')), 'disk full');
  assert.equal(api.backupError(null), '操作失败，请重试');
  assert.equal(api.formatBackupDate('20261106'), '2026-11-06');
});

test('English UI replaces Chinese native errors with the generic fallback', () => {
  const original = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const api = client();
    assert.equal(
      api.backupError('备份超过 16 MB，暂不支持导出', 'Could not complete the operation', 'en-US'),
      'Could not complete the operation'
    );
    // 英文原生错误保留具体原因，中文界面也照常显示中文原文。
    assert.equal(api.backupError('disk full', 'Could not complete the operation', 'en-US'), 'disk full');
    assert.equal(api.backupError('备份超过 16 MB', '操作失败，请重试', 'zh-CN'), '备份超过 16 MB');
    assert.equal(logs.length, 1);
    assert.match(logs[0][1], /备份超过 16 MB/);
  } finally {
    console.error = original;
  }
});
