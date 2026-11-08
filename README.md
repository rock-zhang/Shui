# Shui - 喝水提醒助手

<p align="center">
  <img src="public/screenshot-0.png" alt="Shui Screenshot" width="350"/>
  <br/>
</p>

一个专注喝水提醒的跨端桌面 App，关注打工人健康 💪 ，改善你的喝水习惯。

## ✨ 主要特性

- 🎯 每日饮水目标设定
- 🖥️ 全屏提醒 - 优雅且不可忽视的休息提示
- ⏰ 智能时间管理
  - 自定义提醒间隔
  - 工作日智能提醒
  - 自定义时间范围
- 🔔 多样化提醒方式
  - 全屏通知页面
  - 系统原生通知
  - 托盘实时倒计时
  - 目标完成音效提醒
- 💡 智能且人性化
  - 自动识别工作日
  - 息屏、锁屏自动暂停
  - 托盘快捷操作
  - 应用白名单（默认：腾讯会议, Zoom, Google Meet, Microsoft Teams）
- 📝 饮水记录（[使用说明](docs/drink-records.md)）
  - 手动记录 50/100/200/300 ml，系统通知模式下也可补记
  - 查看近 7 天或 30 天的每日总量与逐笔明细
  - 二次确认后撤销新记录，多屏操作和失败重试不重复记水
- 🎨 外观主题（[使用说明](docs/themes.md)）
  - 浅色、深色和跟随系统，保存选择并同步同源窗口
- 📊 饮水统计与分析（[使用说明](docs/hydration-statistics.md)）
  - 近 7 天或 30 天饮水趋势、日均饮水量与达标天数
  - 饮水时间分布及同一天内的饮水间隔分析
  - 全屏提醒次数、确认/跳过/超时结果及展示时长统计
  - CSV 导出全部日期的饮水总量与逐笔明细

## 🖥 应用界面

<p align="center">
  <img src="public/screenshot-2.png" alt="Settings"/>
  <br/>
  <img src="public/screenshot-3.png" alt="Notification"/>
</p>

## 🚀 开始使用

### Platform Support

- ✅ macOS
- ✅ Windows
- ✅ Linux
- 🚧 Android (coming soon)

### 下载安装

从 [Releases](https://github.com/rock-zhang/Shui/releases/) 页面下载最新版本。

#### macOS

- Apple Silicon：下载 `Shui_x.x.x_aarch64.dmg`
- Intel Chip：下载 `Shui_x.x.x_x64.dmg`

#### Windows

- 64 位系统：下载 `Shui_x.x.x_x64-setup.exe`
- 32 位系统：下载 `Shui_x.x.x_x86-setup.exe`
- ARM64 架构：下载 `Shui_x.x.x_arm64-setup.exe`

#### Linux

- x86_64 架构：下载 `Shui_x.x.x_amd64.deb`
- ARM64 架构：下载 `Shui_x.x.x_arm64.deb`

#### 注意

<img src="public/install_error.png" />

`macOS`下如果遇到`"Shui"已损坏，无法打开`的提示，请在终端运行

```shell
sudo xattr -r -d com.apple.quarantine /Applications/Shui.app
```

## 🛣 开发路线

### 已实现功能

- [x] 基础提醒功能
- [x] 自定义提醒间隔
- [x] 工作日智能提醒
- [x] 系统托盘支持
- [x] 全局快捷键
- [x] 应用白名单管理
- [x] 息屏、锁屏自动暂停
- [x] 托盘快捷操作
- [x] 自定义时间范围
- [x] 系统原生通知
- [x] 托盘实时倒计时
- [x] 手动饮水记录（50/100/200/300 ml）
- [x] 饮水明细查看（近 7 天或 30 天）
- [x] 饮水记录安全撤销与请求去重

### 开发计划

- [x] Windows 适配
- [x] Linux 适配
- [x] 提醒音效
- [ ] 多语言支持
- [x] 数据统计与分析
  - [x] 饮水量趋势图表（近 7 天或 30 天）
  - [x] 休息提醒统计（次数与展示时长）
  - [x] 饮水记录导出（CSV）
  - [x] 饮水时间分布
  - [x] 饮水时间间隔分析
- [x] 外观主题切换（浅色、深色、跟随系统）
- [ ] 饮水记录备份与导入（JSON）

提醒展示时长不代表实际休息时长；CSV 用于查看和分析，不是完整备份。JSON 备份与导入尚未合入本分支。

## 🛠 技术栈

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [Next.js](https://nextjs.org/) - React 应用框架
- [React](https://reactjs.org/) - 用户界面框架
- [Rust](https://www.rust-lang.org/) - 后端逻辑实现
- [shadcn/ui](https://ui.shadcn.com/) - UI 组件库

## 📦 发布流程

推送 `v*` 标签会触发 [GitHub Actions](.github/workflows/publish.yaml)，自动完成多平台构建、创建 Release 并更新自动更新清单。

### 1. 发布前检查

- **版本号统一**：以 `src-tauri/tauri.conf.json` 的 `version` 为准，同步修改 `src-tauri/Cargo.toml` 和 `package.json`
- **tag 与版本号一致**：`0.2.32` 对应标签 `v0.2.32`
- **`updater` Release 已存在且已发布**：自动更新端点固定为 `https://github.com/rock-zhang/Shui/releases/download/updater/latest.json`
- **Secrets 已配置**：`TAURI_SIGNING_PRIVATE_KEY`（更新签名私钥）；若私钥带密码，还需 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

### 2. 触发发布

```shell
git tag v0.2.32
git push origin v0.2.32
```

### 3. 流水线说明

| Job | 作用 |
| --- | --- |
| `create-release` | 通过 changelogithub 生成草稿 Release |
| `release` | 矩阵构建 macOS（aarch64 / x86_64）、Windows（x64 / x86 / arm64）、Linux（x64 / arm64），上传安装包与 `.sig`，并生成包含全部平台的 `latest.json` |
| `upload-assets` | 从当前 tag 的 Release 下载 `latest.json`，覆盖到 `updater` Release（仅正式标签执行，含 `test` / `beta` 的标签会跳过） |

### 4. 发布后操作

CI 创建的 Release 是**草稿**状态，草稿 Release 的资产外部无法下载，自动更新不会生效。需要在 GitHub 上手动 **Publish release** 后，客户端才能检测到新版本。

## 社区交流

欢迎 PR 和 Issue，一起探讨和改进 Shui！
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/rock-zhang/Shui)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/qrcode_wechat_dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="public/qrcode_wechat_light.png" />
  <img width="300px" src="public/qrcode_wechat_light.png" />
</picture>

## ☕ 支持

如果你觉得本项目帮助到了你，请给作者一个免费的 Star，感谢你的支持！

## Star History

<a href="https://www.star-history.com/#rock-zhang/Shui&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=rock-zhang/Shui&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=rock-zhang/Shui&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=rock-zhang/Shui&type=Date" />
 </picture>
</a>
