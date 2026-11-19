const { test } = require('node:test');
const assert = require('node:assert/strict');

const api = require('./load-typescript.cjs')('src/lib/onboarding.ts');
const {
  ONBOARDING_STEPS,
  ONBOARDING_DISMISS_LIMIT,
  nextOnboardingIndex,
  computeBubbleLayout,
  clampBubbleLeft,
} = api;

test('time range is split into separate start and end steps', () => {
  assert.deepEqual(
    ONBOARDING_STEPS.map((step) => step.key),
    ['goal', 'gap', 'weekdays', 'timeStart', 'timeEnd']
  );
});

test('the last step returns done instead of overflowing', () => {
  assert.equal(nextOnboardingIndex(0), 1);
  assert.equal(nextOnboardingIndex(3), 4);
  assert.equal(nextOnboardingIndex(4), 'done');
  assert.equal(nextOnboardingIndex(9), 'done');
});

test('bubble prefers below the target when there is room', () => {
  const layout = computeBubbleLayout({
    targetTop: 100,
    targetBottom: 220,
    bubbleHeight: 180,
    viewportHeight: 800,
  });
  assert.equal(layout.top, 232);
});

test('bubble flips above when the target sits near the bottom', () => {
  const layout = computeBubbleLayout({
    targetTop: 560,
    targetBottom: 700,
    bubbleHeight: 180,
    viewportHeight: 800,
  });
  assert.equal(layout.top, 368);
});

test('bubble stays inside a short viewport instead of going off-screen', () => {
  const layout = computeBubbleLayout({
    targetTop: 200,
    targetBottom: 420,
    bubbleHeight: 360,
    viewportHeight: 500,
    safeTop: 8,
    safeBottom: 8,
  });
  assert.equal(layout.top, 132);
  assert.ok(layout.top >= 8);
  assert.ok(layout.top + 360 <= 500);
});

test('bubble left edge never crosses the gutters', () => {
  assert.equal(clampBubbleLeft(4, 300, 390), 16);
  assert.equal(clampBubbleLeft(200, 300, 390), 74);
  assert.equal(clampBubbleLeft(0, 500, 390), 16);
});

test('dismiss limit matches the notification guide', () => {
  assert.equal(ONBOARDING_DISMISS_LIMIT, 3);
});
