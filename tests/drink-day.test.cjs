const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const api = {};
new Function('exports', ts.transpileModule(readFileSync('src/lib/drink-day.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText)(api);

test('numeric history remains visible without fabricated entries', () => {
  assert.deepEqual(api.normalizeDrinkDay(800, 1500), { schemaVersion: 1, total: 800, goal: 1500, entries: [] });
});

test('saved goals and request IDs survive normalization', () => {
  const day = api.normalizeDrinkDay({ total: 900, goal: 1000, entries: [
    { amount: 100, timestamp: '2026-10-22T01:00:00Z', requestId: 'manual:one' },
    { amount: 50, timestamp: 'unknown' },
  ] }, 1500);
  assert.equal(day.goal, 1000);
  assert.equal(day.entries[0].requestId, 'manual:one');
  assert.equal(day.entries[1].requestId, undefined);
});

test('today prefers the latest setting goal over the saved snapshot', () => {
  const day = api.normalizeDrinkDay({ total: 900, goal: 1000, entries: [] }, 2000,
    { preferFallbackGoal: true });
  assert.equal(day.goal, 2000);
  // 历史日期不带该选项时仍沿用当天保存的目标快照。
  const history = api.normalizeDrinkDay({ total: 900, goal: 1000, entries: [] }, 2000);
  assert.equal(history.goal, 1000);
  // 设置为 0（未配置）时不覆盖快照。
  const noGoal = api.normalizeDrinkDay({ total: 900, goal: 1000, entries: [] }, 0,
    { preferFallbackGoal: true });
  assert.equal(noGoal.goal, 1000);
});

test('invalid totals and non-positive entries do not pollute views', () => {
  const day = api.normalizeDrinkDay({ total: -100, goal: -1, entries: [null,
    { amount: -50, timestamp: 'today' }, { amount: Infinity, timestamp: 'today' },
    { amount: 50, timestamp: 'today' },
  ] }, 1000);
  assert.equal(day.total, 0);
  assert.equal(day.goal, 1000);
  assert.equal(day.entries.length, 1);
});

test('recent dates cross year boundaries in local time', () => {
  assert.deepEqual(api.getRecentDates(3, new Date(2026, 0, 1, 23)).map(api.getLocalDateKey),
    ['20251230', '20251231', '20260101']);
});
