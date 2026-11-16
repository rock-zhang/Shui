const { test } = require('node:test');
const assert = require('node:assert/strict');

const api = require('./load-typescript.cjs')('src/lib/reminder-schedule.ts');
const { findNextReminder, describeNextReminder } = api;

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

test('Sunday is not selected: next reminder is Monday, not "预计下一杯"', () => {
  const result = findNextReminder(base({ weekdays: [1, 2, 3, 4, 5, 6] }), sunday);
  assert.equal(result.kind, 'time');
  assert.equal(result.date.getDay(), 1);
  assert.equal(
    `${String(result.date.getHours()).padStart(2, '0')}:${String(result.date.getMinutes()).padStart(2, '0')}`,
    '09:08'
  );
  assert.match(describeNextReminder(result, sunday), /今天不提醒/);
  assert.doesNotMatch(describeNextReminder(result, sunday), /预计下一杯约/);
});

test('selected weekday inside the time window estimates the next cup today', () => {
  const now = new Date(2026, 10, 15, 10, 0);
  const result = findNextReminder(base(), now);
  assert.equal(result.kind, 'time');
  assert.equal(result.date.getDay(), 0);
  assert.match(describeNextReminder(result, now), /^预计下一杯约/);
});

test('time window already over: rolls to tomorrow', () => {
  const now = new Date(2026, 10, 15, 19, 0);
  const result = findNextReminder(base(), now);
  assert.equal(result.kind, 'time');
  assert.equal(result.date.getDay(), 1);
  assert.match(describeNextReminder(result, now), /今天不提醒 · 下次明天/);
});

test('paused and goal-reached never show a next-cup estimate', () => {
  assert.equal(findNextReminder(base({ isPaused: true }), sunday).kind, 'paused');
  const reached = findNextReminder(base({ todayTotal: 1500 }), sunday);
  assert.equal(reached.kind, 'goalReached');
  assert.equal(describeNextReminder(reached, sunday), '今日目标已达成，暂停提醒');
});

test('empty weekday list means every day (native behaviour)', () => {
  const now = new Date(2026, 10, 15, 10, 0);
  const result = findNextReminder(base({ weekdays: [] }), now);
  assert.equal(result.kind, 'time');
  assert.equal(result.date.getDay(), 0);
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
