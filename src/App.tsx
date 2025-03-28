import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { resolveResource } from "@tauri-apps/api/path";
import { useEffect, useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { TrayIcon } from "@tauri-apps/api/tray";

const TRAY_ID = "app-tray";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke("greet", { name }));
  }

  useEffect(() => {
    let trayInstance: TrayIcon | null = null;

    const initTray = async () => {
      try {
        // 检查是否已存在托盘实例
        trayInstance = await TrayIcon.getById(TRAY_ID);
        console.log("trayInstance", trayInstance);

        if (trayInstance) {
          return;
        }

        const menu = await Menu.new();

        // 添加菜单项
        await menu.append(
          await MenuItem.new({
            text: "设置",
            action: () => {
              TrayIcon.removeById(TRAY_ID);
              console.log("打开设置");
            },
          })
        );

        // await menu.append(PredefinedMenuItem.new({ item: "Separator" }));

        await menu.append(
          await MenuItem.new({
            text: "检查更新",
            action: () => {
              console.log("检查更新");
            },
          })
        );

        // await menu.append(await PredefinedMenuItem.new("separator"));

        await menu.append(
          await MenuItem.new({
            text: "退出",
            action: () => {
              console.log("退出应用");
            },
          })
        );

        // 创建托盘图标
        const iconPath = "./icons/tray-mac.ico";
        const icon = await resolveResource(iconPath);

        console.log("icon", icon);

        trayInstance = await TrayIcon.new({
          menu,
          icon,
          id: TRAY_ID,
          tooltip: "我的应用",
          iconAsTemplate: true,
          menuOnLeftClick: true,
        });
      } catch (error) {
        console.error("创建托盘失败:", error);
      }
    };

    initTray();

    // 清理函数
    return () => {
      if (trayInstance) {
        TrayIcon.removeById(TRAY_ID);
      }
    };
  }, []);

  return (
    <main className="container">
      <h1>Welcome to Tauri + React</h1>

      <div className="row">
        <a href="https://vitejs.dev" target="_blank">
          <img src="/vite.svg" className="logo vite" alt="Vite logo" />
        </a>
        <a href="https://tauri.app" target="_blank">
          <img src="/tauri.svg" className="logo tauri" alt="Tauri logo" />
        </a>
        <a href="https://reactjs.org" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <p>Click on the Tauri, Vite, and React logos to learn more.</p>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          id="greet-input"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <button type="submit">Greet</button>
      </form>
      <p>{greetMsg}</p>
    </main>
  );
}

export default App;
