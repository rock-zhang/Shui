import { load } from "@tauri-apps/plugin-store";
import { STORE_NAME } from "@/lib/constants";

/**
 * 记水成功后的一声确认音，与 Android `res/raw/confirm_bubble.mp3` 同一个文件。
 *
 * 跟随通用设置里的「提醒音效」（general.isSound，默认开）。这是 best-effort：
 * 音效失败绝不能影响记水本身，也不该打扰用户（不弹 toast、只在控制台留痕），
 * 与 Android 侧「播放失败静默降级」的口径一致。
 */
export async function playConfirmSound(): Promise<void> {
  try {
    const store = await load(STORE_NAME.config, { autoSave: false });
    const general = await store.get<{ isSound?: boolean }>("general");
    if (general?.isSound === false) return;
  } catch {
    // 读不到配置时按开启处理，宁可多响一声也不吞掉确认反馈。
  }

  try {
    const audio = new Audio("/sounds/confirm_bubble.mp3");
    audio.volume = 0.5;
    await audio.play();
  } catch (error) {
    console.log("确认音播放失败（不影响记水）", error);
  }
}
