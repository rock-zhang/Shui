import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export const sendReminderNotification = async (t: (key: string) => string) => {
  let permissionGranted = await isPermissionGranted();

  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === "granted";
  }

  if (permissionGranted) {
    sendNotification({
      title: t("reminder.waterNotification.title"),
      body: t("reminder.waterNotification.body"),
      channelId: "reminder",
    });
  }
};
