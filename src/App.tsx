import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { resolveResource } from "@tauri-apps/api/path";
import { useEffect, useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { TrayIcon, TrayIconOptions } from "@tauri-apps/api/tray";

const TRAY_ID = "app-tray";
function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke("greet", { name }));
  }

  // useEffect(() => {
  //   createTrayIcon();
  //   // async function getGreet() {
  //   //   const tray = await TrayIcon.new({ tooltip: "awesome tray tooltip" });
  //   //   tray.setTooltip("new tooltip");
  //   // }

  //   // getGreet();
  // }, []);

  // // 通过 id 获取托盘图标
  // const getTrayById = () => {
  //   return TrayIcon.getById(TRAY_ID);
  // };

  // // 创建托盘图标
  // const createTrayIcon = async () => {
  //   // if (!globalStore.app.showMenubarIcon) return;

  //   // const tray = await getTrayById();

  //   // if (tray) return;

  //   const menu = await getTrayMenu();

  //   const iconPath = "assets/tray-mac.ico";
  //   const icon = await resolveResource(iconPath);

  //   const options: TrayIconOptions = {
  //     menu,
  //     icon,
  //     id: TRAY_ID,
  //     tooltip: "appname appversion",
  //     iconAsTemplate: true,
  //     menuOnLeftClick: true,
  //     action: (event) => {
  //       console.log(event);
  //     },
  //   };

  //   return TrayIcon.new(options);
  // };

  // // 获取托盘菜单
  // const getTrayMenu = async () => {
  //   const items = await Promise.all([
  //     MenuItem.new({
  //       text: "component.tray.label.preference",
  //       // accelerator: isMac() ? "Cmd+," : void 0,
  //       action: () => {
  //         console.log("preference");
  //       },
  //     }),

  //     PredefinedMenuItem.new({ item: "Separator" }),
  //     MenuItem.new({
  //       text: "component.tray.label.check_update",
  //       action: () => {
  //         console.log("check_update");
  //       },
  //     }),
  //   ]);

  //   console.log("getTrayMenu");

  //   return Menu.new({ items });
  // };

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
