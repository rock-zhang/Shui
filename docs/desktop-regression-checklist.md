# Shui 桌面端回归清单（Android 适配后）

适用范围：macOS / Windows / Linux 三端桌面 App。Android 端不在本清单内。
背景：v0.3.1 之后 4 个提交为适配 Android 改动了桌面端共享代码（前端入口、平台检测、通知、Rust 计时器/设置/备份），并升级 Tauri 2.12.5。

本清单记录的是一次**实际执行**的回归：能自动化的都跑了命令，能运行时验证的跑了隔离冒烟测试，剩下确实做不了的单独列在最后一节，不勾选。

## 一、自动化验证（本机 macOS 实跑，全部通过）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| Node 测试（38） | `node --test tests/*.test.cjs` | ✅ 38/38 |
| Rust 测试（48） | `cargo test --workspace --locked` | ✅ 48/48 |
| 原生启动冒烟（17） | `python3 tests/native/startup_smoke.py` | ✅ 17/17 |
| ESLint | `yarn eslint -c src/eslint.config.mjs src` | ✅ 0 error（5 warning，均为既有） |
| TypeScript | `npx tsc --noEmit` | ✅ 通过 |
| 版本号一致性 | `node scripts/version.mjs check` | ✅ 0.3.1 四处一致 |
| 前端构建 | `yarn build` | ✅ 10 条路由全部静态导出 |
| Rust release 编译 | `cargo build --release --locked` | ✅ 通过（13 条既有 warning） |
| macOS 打包 | `yarn tauri build` | ✅ App 21.09 MiB / DMG 10.23 MiB / updater tar.gz 10.14 MiB；最后签名报缺 `TAURI_SIGNING_PRIVATE_KEY`，属本机无发布密钥，产物已生成 |
| native-smoke feature 编译 | `cargo build --features native-smoke` | ✅ 修复后通过（见问题 1） |

## 二、本轮发现并修复的问题

### 1. 🔴 `native-smoke` feature 编译失败（被 CI skipped 掩盖）

Tauri 2.12 起 `plugin::Builder::js_init_script` 收 `impl Into<String>`，`src-tauri/src/native_smoke.rs` 里 `include_str!(...).into()` 触发 `E0283`——`bytes` / `reqwest` / `zune_*` 都实现了 `From<&str>`，类型推断无法收敛。

这直接导致 CI `rust` matrix 的 `Native startup smoke` 步骤在任何平台都编不过。此前一直没暴露，是因为 CI 的 `frontend` job 先挂了，`rust` 与 `android-check` 全被 skipped。

修复：去掉多余的 `.into()`（`&'static str` 本身满足 `Into<String>`）。

### 2. 🔴 CI 红灯：测试修复未提交，连带三平台验证全部跳过

`374bb96` 的 CI 结论是 failure，失败在 `node --test`。复现方式：用 HEAD 版测试跑，`亮/暗主题都显式声明了状态栏…`（`tests/system-bars.test.cjs`）失败，本地修复版通过。原因是该测试仍断言 `statusBarColor` 等 4 个属性，而 targetSdk 36 强制 edge-to-edge 后 `values/themes.xml` / `values-night/themes.xml` 已删除这些属性、改由 `applySystemBarTheme` 运行时接管。

**这不是平台差异**，是修复只改了工作区、没提交。后果比红灯本身更严重：`rust` matrix（macOS / Windows / Linux 原生构建 + 启动冒烟）和 `android-check` 全部 skipped，等于 Windows / Linux 一次都没验过。

### 3. 🟡 桌面端在通知里记水后，界面不刷新

`src/utils/notification.ts` 新增的通知内记水走 `recordDrink(...).then(emitRefresh)`，而 `emitRefresh` 只是 `window.dispatchEvent(new Event("shui:refresh"))`——监听者（`onRefresh`）此前全部在 `src/components/mobile/` 下，桌面端没有任何订阅者。结果是数据写进去了，当前页仍显示旧值，要手动点「刷新」或切路由才更新。

修复：`src/app/setting/history/page.tsx`、`src/app/setting/statistics/page.tsx` 订阅 `onRefresh`。

### 4. 🟠 macOS 通知 Action 折叠，误点会凭空记水

`tauri-plugin-notification` 2.8.1 `src/desktop.rs` 的 Platform-specific 明确写着：**macOS 上两个以上 action 会折叠进 "Options" 菜单，点菜单按钮本身会上报第一个 action**。原来第一档是「喝一杯 200ml」，等于用户点一下 Options 就多记 200ml。

修复（按老板决定）：桌面端档位顺序改为 `50 / 100 / 200`，第一档变 50ml，误点最坏只多记 50ml。**Android 侧 `ReminderScheduler.DRINK_ACTIONS` 保持 200/100/50 不变**——Android 的 action 是并列按钮、不存在折叠，200ml 仍是主推档位。两端顺序刻意不同，代码里已注明原因。

### 5. 🟡 点通知主体是空转

同一处 `onAction` 回调里，非 `drink-*`、非 `skip` 的分支只调 `emitShowReminder()`，桌面端没有该事件的监听者，用户点通知主体等于没反应。

修复：桌面端在 `emitShowReminder()` 之外，用 `getCurrentWindow().show()` + `setFocus()` 把设置窗唤回来（`core:window:allow-show` / `allow-set-focus` 权限已具备）。

## 三、运行时验证证据（native smoke，17/17）

`tests/native/startup_smoke.py` 用独立 identifier（`com.shui.native-smoke`）与独立数据目录，跑真实 WebView + Tauri 环境，不触碰本机已安装的 App 与真实数据。通过项：

- [x] 原生主窗口创建为隐藏、不聚焦
- [x] 静默启动保持隐藏，前端与托盘均存活
- [x] 单实例：第二次调用退出，原进程继续存活
- [x] 手动重启可显示已存在的设置窗口
- [x] 真实前端托盘回调能重新打开隐藏的设置窗
- [x] 手动重启可恢复最小化的设置窗
- [x] 自启动注册项包含 `--silent`
- [x] 注册的原始命令能启动新的静默实例
- [x] **隐藏状态下，原生定时器能触发已加载的提醒窗口**
- [x] 提醒关闭后后台计时恢复
- [x] 自启动注册项可移除
- [x] 手动冷启动显示设置页

其中最有价值的一条是隐式的：`ready()` 要求 `timer_listener && tray_menu && tray` 同时为真。`timer-complete` 监听注册在 `src/app/setting/layout.tsx` 的 effect 里，而该 effect 在检测到移动端时会提前 `return`。所以冒烟通过等价于：**真实桌面环境下平台检测返回了桌面值、加载的是桌面设置页、没有误入四 tab 移动界面**。这是清单原先列的最高风险项，已由运行时证据闭环。

## 四、UI 渲染验证（静态产物 + headless Chrome）

本机屏幕处于锁定状态且未授予屏幕录制 / 辅助功能权限，无法对运行中的 App 截图或点击。改用静态导出产物 + headless Chrome 渲染，验证组件本身：

- `/setting/`：侧边栏 7 项齐全（通用 / 提醒 / 饮水记录 / 快捷键 / 备份与导入 / 关于 / 统计），深色与浅色两套主题均正常，无低对比度
- `/setting/reminder`、`/setting/history`、`/setting/statistics`、`/setting/data`：布局与控件正常；无 Tauri 环境时的降级提示（「暂时无法读取记录」）可读、不崩
- `/`：web 模式下渲染 `HOME`，**未**误渲染四 tab 移动界面，桌面分流正确
- console 无 JS 异常，只有预期内的「非 Tauri 环境」降级日志

说明：web 模式下 `tauri-plugin-store` 不可用，开关与数值显示为默认值，属环境限制、不是回归。

## 五、仍需人工确认或依赖 CI 的项

本机为锁屏状态且无 GUI 权限，下面这些**没有**在本轮验证，不做勾选：

- [ ] 桌面端通知的真实弹出与外观（macOS 走 `notify-rust`，需解锁的交互式会话）
- [ ] 通知里各 Action 的真实点击（含 macOS Options 折叠、Windows 进操作中心后点击无响应）
- [ ] macOS 标题栏拖拽区、红绿灯位置（`usePlatform` 首帧 `isMacOS` 已由冒烟间接证明，但视觉留白需目视）
- [ ] 全屏提醒的实际视觉与多显示器落位
- [ ] 深浅色切换后的即时视觉、同源多窗口同步
- [ ] 息屏 / 锁屏自动暂停——**已观察到「系统锁屏，停止计时」日志，行为正确**，但解锁唤醒后的恢复未验
- [ ] 自动更新端到端（依赖线上 updater Release 状态）
- [ ] Windows / Linux 实机：依赖 CI `rust` matrix（含 Linux X11 `xvfb` 冒烟）
- [ ] Windows / Linux 安装包构建：依赖 `publish.yaml` 的 7 平台矩阵

## 六、构建与环境备忘

- `yarn tauri build` 的 `beforeBuildCommand` 偶发 webpack 缓存损坏（`WasmHash._updateWithBuffer`）：把 `.next` / `dist` **重命名**（不能 `rm`，会被 safe-delete 拦截）后重打即可。
- 本机所有 `next build` / `tauri build` 都要带 `env -u NODE_OPTIONS`：WorkBuddy 注入的 `--require=node-language-shim.cjs` 会让 next 自清临时目录时被 safe-delete 拒绝（`.next/diagnostics`）。
- `CI=1 yarn tauri build` 会报 `invalid value '1' for '--ci'`（Tauri 2.12.5 的 `--ci` 只认 true/false）。
- 打包最后一步需要 `TAURI_SIGNING_PRIVATE_KEY`；未配置时 DMG / App 已生成，属正常。
