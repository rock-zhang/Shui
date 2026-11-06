const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadModule = require('./load-typescript.cjs');
const water = loadModule('src/lib/drink-history.ts');
const { summarizeReminders } = loadModule('src/lib/reminder-history.ts');

test('detail normalization preserves stable IDs without inventing legacy entries', () => {
  assert.deepEqual(water.normalizeDrinkDay(800, 1000).entries, []);
  const day = water.normalizeDrinkDay({total: 900, entries: [
    { amount: 100, timestamp: '2026-10-22T01:00:00Z', requestId: 'manual:one' },
    { amount: 50, timestamp: '2026-10-22T02:00:00Z' },
  ]}, 1000);
  assert.equal(day.entries[0].requestId, 'manual:one');
  assert.equal(day.entries[1].requestId, undefined);
});

test('revoked IDs do not appear in trends, time analysis or CSV', () => {
  const date = new Date(2026, 9, 22, 12);
  const key = water.getLocalDateKey(date);
  const value = {schemaVersion: 1, total: 800, goal: 1000, entries: [], revokedRequestIds: ['manual:one']};
  assert.equal(water.summarizeDrinkDays([date], [value], 1000)[0].total, 800);
  assert.equal(water.analyzeDrinkPatterns([[key, value]], 1000).totalEntries, 0);
  const csv = water.exportDrinkHistoryCsv([[key, value]], 1000);
  assert.ok(csv.includes('"800","1000","否","",""'));
  assert.ok(!csv.includes('manual:one'));
});

test('reminder totals handle missing days and malformed fields without NaN', () => {
  const result = summarizeReminders([undefined, null, 4, { completed: 2, confirmed: 1, skipped: 1, displaySeconds: 19 },
    { completed: 1, timedOut: 1, displaySeconds: 30 }, { completed: -1, skipped: '4', displaySeconds: Infinity }]);
  assert.deepEqual(result, { completed: 3, confirmed: 1, skipped: 1, timedOut: 1, displaySeconds: 49 });
  assert.deepEqual(summarizeReminders([]), { completed: 0, confirmed: 0, skipped: 0, timedOut: 0, displaySeconds: 0 });
});

test('trend summaries preserve saved goals and flag legacy estimates', () => {
  const dates = water.getRecentDates(3, new Date(2026, 0, 1));
  assert.deepEqual(dates.map(water.getLocalDateKey), ['20251230', '20251231', '20260101']);
  const result = water.summarizeDrinkDays(dates, [1500, { total: 1000, goal: 1000 }, undefined], 2000);
  assert.deepEqual(result.map(day => day.completed), [false, true, false]);
  assert.deepEqual(result.map(day => day.hasHistoricalGoal), [false, true, false]);
});

test('CSV export still includes both legacy totals and new drink events', () => {
  const csv = water.exportDrinkHistoryCsv([
    ['20261022', { total: 1000, goal: 1000, entries: [{ amount: 200, timestamp: '2026-10-22T01:00:00.000Z' }] }],
    ['20261021', 500], ['metadata', 999],
  ], 1500);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"2026-10-21","500","1500","否","",""'));
  assert.ok(csv.includes('"2026-10-22","1000","1000","是","200","2026-10-22T01:00:00.000Z"'));
  assert.equal(csv.trim().split('\r\n').length, 3);
});
