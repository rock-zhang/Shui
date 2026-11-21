const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calendarDay, parseHolidayCalendar, dateRange } = require('./load-typescript.cjs')('src/lib/work-calendar.ts');

test('alternating weeks retain parity across years, Sundays and dates before the reference week', () => {
  const config = { scheduleMode: 'alternating', alternatingWeeks: {
    anchorDate: '2026-12-30', bigWeekdays: [1,2,3,4,5,6], smallWeekdays: [1,2,3,4,5],
  }};
  for (const [date, remind] of [['2026-12-26',false],['2027-01-02',true],['2027-01-03',false],['2027-01-09',false],['2027-01-16',true]]) {
    assert.equal(calendarDay(date, config).remind, remind, date);
  }
});

test('holiday-cn imports distinguish days off and makeup workdays; personal dates keep priority on annual updates', () => {
  const imported = parseHolidayCalendar(JSON.stringify({ year: 2026, days: [
    { date: '2026-01-01', name: '元旦', isOffDay: true },
    { date: '2026-01-04', name: '元旦', isOffDay: false },
  ]}), '2026.json');
  const config = { weekdays: [1,2,3,4,5], holidayCalendars: [imported], dateOverrides: [{ date: '2026-01-01', remind: true }] };
  assert.equal(calendarDay('2026-01-01', config).reason, 'custom_workday');
  assert.equal(calendarDay('2026-01-04', config).reason, 'holiday_workday');
  config.dateOverrides = [];
  assert.equal(calendarDay('2026-01-01', config).reason, 'holiday_day_off');
  imported.enabled = false;
  assert.equal(calendarDay('2026-01-01', config).reason, 'weekly_workday');
});

test('batch custom vacations include both endpoints through a leap day', () => {
  assert.deepEqual(dateRange('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29', '2028-03-01']);
});
