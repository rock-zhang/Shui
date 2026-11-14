// Defined by the opt-in native-smoke Rust plugin, absent in normal builds.
interface Window {
  __SHUI_NATIVE_SMOKE__?: {
    timerReady(): void;
    setTrayAction(action: () => Promise<void>): void;
    trayReady(): void;
  };
}
