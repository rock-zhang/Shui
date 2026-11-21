const { test } = require('node:test');
const assert = require('node:assert/strict');

const api = require('./load-typescript.cjs')('src/lib/reminder-schedule.ts');
const { findNextReminder, describeNextReminder, describeNextAt } = api;

// 2026-11-15 is a Sunday (getDay() === 0), same weekday indexing as Kotlin.
const sunday = new Date(2026, 10, 15, 18, 48);
const base = (patch = {}) => ({
  gap: '20',
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  timeStart: '09:00',
  timeEnd: '18:00',
  quietEnabled: false,
  quietStart: '22:00',
  quietEnd: '07:00',
  isPaused: false,
  goal: '1500',
  todayTotal: 0,
  ...patch,
});

test('Sunday is not selected: next reminder is Monday, not today', () => {
  const result = findNextReminder(base({ weekdays: [1, 2, 3, 4, 5, 6] }), sunday);
  assert.equal(result.kind, 'time');
  assert.equal(result.date.getDay(), 1);
  assert.equal(
    `${String(result.date.getHours()).padStart(2, '0')}:${String(result.date.getMinutes()).padStart(2, '0')}`,
    '09:00'
  );
  assert.deepEqual(describeNextReminder(result, sunday), {
    kind: 'later',
    weekday: null,
    time: '09:00',
  });
});

test('selected weekday inside the time window estimates the next cup today', () => {
  const now = new Date(2026, 10, 15, 10, 0);
  const result = findNextReminder(base(), now);
  assert.equal(result.kind, 'time');
  assert.equal(result.date.getDay(), 0);
  assert.deepEqual(describeNextReminder(result, now), {
    kind: 'today',
    time: '10:20',
    minutes: null,
  });
});

test('time window already over: rolls to tomorrow', () => {
  const now = new Date(2026, 10, 15, 19, 0);
  const result = findNextReminder(base(), now);
  assert.equal(result.kind, 'time');
  assert.equal(result.date.getDay(), 1);
  assert.deepEqual(describeNextReminder(result, now), {
    kind: 'later',
    weekday: null,
    time: '09:00',
  });
});

test('grid offset from window start is realigned: next day starts at window start, not on the grid', () => {
  // 复现线上问题：时段 08:00–19:00、间隔 10 分钟，最后一杯落在 :55 网格上。
  // 旧行为沿网格整夜步进，次日首提醒会落在 08:05；修复后应对齐到 08:00。
  const now = new Date(2026, 10, 15, 18, 55);
  const result = findNextReminder(
    base({ gap: '10', timeStart: '08:00', timeEnd: '19:00' }),
    now
  );
  assert.equal(result.kind, 'time');
  assert.equal(result.date.getDate(), 16);
  assert.equal(result.date.getHours(), 8);
  assert.equal(result.date.getMinutes(), 0);
});

test('paused and goal-reached never show a next-cup estimate', () => {
  assert.equal(findNextReminder(base({ isPaused: true }), sunday).kind, 'paused');
  const reached = findNextReminder(base({ todayTotal: 1500 }), sunday);
  assert.equal(reached.kind, 'goalReached');
  assert.deepEqual(describeNextReminder(reached, sunday), { kind: 'goalReached' });
});

test('empty weekday list turns weekly reminders off', () => {
  const now = new Date(2026, 10, 15, 10, 0);
  const result = findNextReminder(base({ weekdays: [] }), now);
  assert.equal(result.kind, 'none');
});

test('quiet hours are skipped', () => {
  const now = new Date(2026, 10, 15, 10, 0);
  const result = findNextReminder(
    base({ quietEnabled: true, quietStart: '10:00', quietEnd: '11:00' }),
    now
  );
  assert.equal(result.kind, 'time');
  assert.ok(result.date.getHours() * 60 + result.date.getMinutes() >= 11 * 60 + 20);
});

test('end 00:00 is treated as a cross-midnight window', () => {
  const now = new Date(2026, 10, 15, 23, 0);
  const result = findNextReminder(base({ timeEnd: '00:00' }), now);
  assert.equal(result.kind, 'time');
  assert.equal(result.date.getDate(), 15);
});

test('native next time keeps the absolute clock and shows remaining minutes', () => {
  const now = new Date(2026, 10, 16, 10, 0).getTime();
  const at = new Date(2026, 10, 16, 10, 30).getTime();
  assert.deepEqual(describeNextAt(at, now), {
    kind: 'today',
    time: '10:30',
    minutes: 30,
  });
});

test('1-minute test gap does not round up to 2 minutes when now lags a few seconds', () => {
  // 1 分钟测试档：闹钟排在锚点+1分钟，now 快照滞后约 15 秒时真实剩余仍应报 1 分钟。
  // ceil 会把 75 秒报成 2 分钟，round 稳定报 1。
  const at = new Date(2026, 10, 16, 10, 1, 0).getTime();
  const laggedNow = new Date(2026, 10, 16, 9, 59, 45).getTime(); // 差 75 秒
  assert.deepEqual(describeNextAt(at, laggedNow), {
    kind: 'today',
    time: '10:01',
    minutes: 1,
  });
});

test('native next time rolls to tomorrow wording', () => {
  const now = new Date(2026, 10, 16, 18, 48).getTime();
  const at = new Date(2026, 10, 17, 9, 0).getTime();
  assert.deepEqual(describeNextAt(at, now), {
    kind: 'later',
    weekday: null,
    time: '09:00',
  });
});

test('overdue native next time is reported as imminent', () => {
  const now = new Date(2026, 10, 16, 10, 0).getTime();
  const at = new Date(2026, 10, 16, 9, 30).getTime();
  assert.deepEqual(describeNextAt(at, now), { kind: 'imminent' });
});
