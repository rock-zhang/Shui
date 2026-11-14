// Only the native-smoke feature injects this bridge. The frontend reports after
// real IPC has completed; the driver invokes the actual registered tray action.
(() => {
  const report = (kind) => window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
    event: "native-smoke-report", payload: { kind },
  }).catch(console.error);
  window.__SHUI_NATIVE_SMOKE__ = {
    timerReady: () => report("timer-listener"),
    setTrayAction: (action) => { window.__SHUI_SMOKE_TRAY_SETTINGS__ = action; },
    trayReady: () => report("tray-menu"),
  };
  document.addEventListener("DOMContentLoaded", () => {
    if (window.__TAURI_INTERNALS__.metadata.currentWindow.label.startsWith("reminder_")) {
      report("reminder-loaded");
    }
  });
})();
