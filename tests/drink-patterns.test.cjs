const { test } = require('node:test');
const assert = require('node:assert/strict');

const api = require('./load-typescript.cjs')('src/lib/drink-history.ts');
const event = (day, hour, minute = 0, amount = 100) => ({
  amount,
  timestamp: new Date(2026, 9, day, hour, minute).toISOString(),
});
const analyze = (entries) => api.analyzeDrinkPatterns(entries, 1500);

test('legacy totals do not create time samples', () => {
  const result = analyze([['20261021', 1500], ['20261022', undefined]]);
  assert.equal(result.totalEntries, 0);
  assert.equal(result.averageIntervalMinutes, null);
});

test('six-hour bucket boundaries use local time', () => {
  const result = analyze([['20261022', { entries: [
    event(22, 0), event(22, 6), event(22, 12), event(22, 18),
  ] }]]);
  assert.deepEqual(result.timeBuckets.map(b => b.amount), [100, 100, 100, 100]);
  assert.deepEqual(result.timeBuckets.map(b => b.percentage), [25, 25, 25, 25]);
});

test('sorts events, excludes zero intervals and does not bridge nights', () => {
  const result = analyze([
    ['20261021', { entries: [event(21, 11), event(21, 9), event(21, 9), event(21, 9, 30)] }],
    ['20261022', { entries: [event(22, 8), event(22, 9)] }],
  ]);
  assert.equal(result.totalEntries, 6);
  assert.equal(result.intervalCount, 3);
  assert.equal(result.averageIntervalMinutes, 60);
  assert.equal(result.medianIntervalMinutes, 60);
  assert.equal(result.shortestIntervalMinutes, 30);
  assert.equal(result.longestIntervalMinutes, 90);
});

test('uses timestamp dates even when a stored day contains a midnight crossing', () => {
  const result = analyze([
    ['20261021', { entries: [event(21, 23, 50), event(22, 0, 10)] }],
    ['20261022', { entries: [event(22, 0, 40)] }],
  ]);
  assert.equal(result.intervalCount, 1);
  assert.equal(result.averageIntervalMinutes, 30);
});

test('ignores invalid timestamps, invalid amounts and dates outside the range', () => {
  const result = analyze([['20261022', { entries: [
    event(22, 9), event(23, 9), event(22, 10, 0, -100),
    { amount: 200, timestamp: 'invalid' },
  ] }]]);
  assert.equal(result.totalEntries, 1);
  assert.equal(result.totalAmount, 100);
  assert.equal(result.intervalCount, 0);
});

test('retains sub-minute intervals and computes an even-sample median', () => {
  const start = new Date(2026, 9, 22, 9).getTime();
  const result = analyze([['20261022', { entries: [0, 15000, 60000].map(offset => ({
    amount: 100, timestamp: new Date(start + offset).toISOString(),
  })) }]]);
  assert.equal(result.intervalCount, 2);
  assert.equal(result.medianIntervalMinutes, 0.5);
  assert.equal(result.shortestIntervalMinutes, 0.25);
});
