import { load } from "@tauri-apps/plugin-store";
import { STORE_NAME } from "@/lib/constants";

export async function getGeneralConfig() {
  const store = await load(STORE_NAME.config, { autoSave: false });
  const [generalSetting] = await Promise.all([
    store.get<{
      isAutoStart: boolean;
      isCountDown: boolean;
      isFullScreen: boolean;
    }>("general"),
  ]);

  // 旧版本升级上来的用户，没有 isFullScreen 配置，默认开启全屏
  const isFullScreen = generalSetting?.isFullScreen === false ? false : true;

  return {
    ...generalSetting,
    isFullScreen,
  };
}
