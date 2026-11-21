// One native E2E path: rotation -> personal dates -> file preview/import -> priority.
(async () => {
  const checks = [];
  const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
  const get = () => invoke("get_calendar_settings");
  const query = (selector) => document.querySelector(selector);
  const wait = async (predicate) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Calendar E2E timed out");
  };
  const fill = (name, value) => {
    const element = query(`[name="${name}"]`);
    const prototype = element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const saved = (predicate) => wait(async () => query('[data-reminder-settings-ready="true"]') && predicate(await get()));
  const check = (value, description) => { if (!value) throw new Error(description); checks.push(description); };
  let passed = false, error;
  try {
    await invoke("update_reminder_settings", { patch: { weekdays: [], scheduleMode: "weekly", dateOverrides: [], holidayCalendars: [] } });
    query('a[href="/setting/reminder/"]').click();
    await saved(() => true);
    fill("schedule-mode", "alternating");
    await saved((s) => s.config.scheduleMode === "alternating");
    fill("rotation-anchor", "2026-12-30");
    query('[data-calendar-rotation] button[type="submit"]').click();
    await saved((s) => s.config.alternatingWeeks.anchorDate === "2026-12-30");
    const initial = await get();
    check(initial.preview.every((day) => query(`[data-preview-date="${day.date}"]`).dataset.previewRemind === String(day.remind)),
      "native preview matches backend alternating-week decisions");

    const today = initial.today.date, tomorrow = initial.preview[1].date;
    fill("custom-start", today); fill("custom-end", tomorrow); fill("custom-name", "E2E vacation");
    query('[data-calendar-custom] button[type="submit"]').click();
    const section = query('[data-calendar-custom]').closest("section");
    await wait(() => section.querySelector('[role="status"] button'));
    section.querySelector('[role="status"] button').click();
    await saved((s) => s.config.dateOverrides.length === 2);
    check((await get()).today.reason === "custom_day_off", "batch personal dates persist through the real form");

    const file = new File([JSON.stringify({ year: Number(today.slice(0, 4)), days: [
      { date: today, name: "Makeup", isOffDay: false }, { date: tomorrow, name: "Holiday", isOffDay: true }
    ] })], "calendar.json", { type: "application/json" });
    const transfer = new DataTransfer(); transfer.items.add(file);
    query('[name="holiday-file"]').files = transfer.files;
    query('[name="holiday-file"]').dispatchEvent(new Event("change", { bubbles: true }));
    await wait(() => query('[data-import-preview]'));
    check(!(await get()).config.holidayCalendars.length, "file import previews without changing saved settings");
    query('[data-import-preview] button').click();
    await saved((s) => s.config.holidayCalendars.length === 1);
    check((await get()).today.reason === "custom_day_off", "personal dates retain priority over imported makeup days");
    passed = true;
  } catch (failure) { error = String(failure); }
  await invoke("plugin:event|emit", { event: "native-smoke-report", payload: { kind: "calendar-checks", passed, error, checks } });
})();
