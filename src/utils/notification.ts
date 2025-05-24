import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export const sendReminderNotification = async () => {
  let permissionGranted = await isPermissionGranted();

  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === "granted";
  }

  if (permissionGranted) {
    sendNotification({
      title: "⏰该喝水啦",
      body: "站起来喝杯水，顺便活动一下身体吧！",
      channelId: "reminder",
    });
    // await registerActionTypes([
    //   {
    //     id: "reminder",
    //     actions: [
    //       {
    //         id: "50ml",
    //         title: "50ml",
    //       },
    //       {
    //         id: "100ml",
    //         title: "100ml",
    //       },
    //     ],
    //   },
    // ]);

    // await createChannel({
    //   id: "reminder",
    //   name: "Messages",
    //   description: "Notifications for new messages",
    //   importance: Importance.High,
    //   visibility: Visibility.Private,
    //   lights: true,
    //   lightColor: "#ff0000",
    //   vibration: true,
    //   sound: "notification_sound",
    // });
    // await onAction((notification) => {
    //   console.log("Action performed:", notification);
    // });
  }
};
