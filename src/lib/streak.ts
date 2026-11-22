import { invoke } from "@tauri-apps/api/core";

export interface StreakInfo {
  current: number;
  best: number;
  todayCompleted: boolean;
  /** 需要庆祝一次的里程碑；0 表示没有。 */
  milestone: number;
}

/** 读取连续达标信息；非 Tauri 环境（浏览器预览）返回 null。 */
export async function getStreak(): Promise<StreakInfo | null> {
  try {
    return await invoke<StreakInfo>("get_streak");
  } catch {
    return null;
  }
}

/** 记录已庆祝的里程碑，传 0 表示断连后允许重新庆祝。 */
export async function ackStreak(days: number): Promise<void> {
  try {
    await invoke("ack_streak", { days });
  } catch {
    // 浏览器预览或写入失败时静默；下次读取会重新提示一次，不影响数据。
  }
}
