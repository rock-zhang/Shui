# Shui — Google Play 上架材料包

> 适用版本：`0.4.2`（versionCode `4002`）
> 本文档里的文案可直接复制到 Play Console；仍需你补充的项见第 6 节。

---

## 0. 应用基础信息（取自代码，无需改动）

| 项目 | 值 | 来源 |
| --- | --- | --- |
| 应用名称 | Shui | `res/values/strings.xml` |
| 包名 / applicationId | `com.shui.app` | `app/build.gradle.kts` |
| versionName | `0.4.2` | `app/tauri.properties` |
| versionCode | `4002` | `app/tauri.properties`（由版本号推导） |
| minSdk | 24（Android 7.0） | `app/build.gradle.kts` |
| targetSdk | 36（Android 16） | `app/build.gradle.kts` |
| 上架产物 | AAB（`app-universal-release.aab`） | `README-ANDROID.md` |
| 签名 | release keystore 已配置（`~/.android-keys/shui-release.jks`） | `key.properties` |
| 是否联网 | 否，全部数据留在设备本地 | 代码中无任何网络请求 |
| 账号体系 | 无 | — |
| 广告 / 内购 | 无 | — |
| 第三方分析 / 广告 SDK | 无 | 依赖清单里只有 Tauri、React 等本地库 |

> 按 Google Play 的目标 API 要求，自 2026 年 8 月 31 日起新应用与更新必须 targetSdk ≥ 36（Android 16）。本项目已是 36，直接可提交，无需申请延期。

---

## 1. 商店信息（Store listing）

默认语言建议设为 **英语（美国）**，再补一份**简体中文**。Play 允许每种语言单独填写，两种语言的短描述、完整描述都要写。

### 1.1 应用名称（上限 30 字符）

| 语言 | 内容 | 字符数 |
| --- | --- | --- |
| en-US | `Shui: Water Reminder` | 21 |
| zh-CN | `Shui · 喝水提醒` | 11 |

> 名称里不要堆叠关键词（如「喝水提醒 闹钟 计时 健康」），会被审核判定为关键词堆砌。`Shui` 作为主品牌在前，功能词在后。

### 1.2 简短说明（上限 80 字符）

| 语言 | 内容 | 字符数 |
| --- | --- | --- |
| en-US | `Gentle hydration reminders, one-tap drink logging, and daily stats.` | 67 |
| zh-CN | `按你设定的节奏提醒喝水，一键记录每一杯，查看每日趋势与达标情况。` | 32 |

### 1.3 完整说明（上限 4000 字符）

**en-US**

```
Shui is a calm, reliable water reminder for people who forget to drink while they work.

Set an interval, choose your active hours, and Shui reminds you at a rhythm that fits your day — with a full-screen prompt when you're in the app and a system notification when you're not. Every reminder reads from the same timeline, so you never get the same nudge twice.

WHAT YOU GET

• Custom reminder interval — from every 15 minutes to a few hours
• Repeat days — weekday-only or any combination you need
• Active hours — no reminders during your off time
• Do Not Disturb window and a pause switch for meetings
• Full-screen reminder or system notification, your choice
• Reminder sound, or silent
• One-tap drink logging (50 / 100 / 200 / 300 ml), also from the notification
• Daily goal and progress
• 7-day and 30-day hydration trends, daily average, days on target
• Drink time distribution and interval analysis
• Reminder history: how many reminders fired, confirmed, skipped or timed out
• CSV export for your own analysis
• JSON backup and import — importing only fills missing dates, never overwrites
• Light, dark, or follow-system theme

PRIVACY FIRST

Shui has no account, no ads, no analytics, and no tracking. Your drink records, settings and stats stay in the app's private storage on your device. Nothing is uploaded to a server. Backups and CSV files are created only when you ask for them, and are handed to the app you pick.

BUILT FOR ANDROID

Reminders are scheduled with Android's alarm APIs so they keep arriving when the app is in the background. On some manufacturer ROMs you may need to allow auto-start or exclude Shui from battery optimization — the app walks you through it with a one-tap shortcut to the right settings screen.

Shui also runs on macOS, Windows and Linux with the same data model. This listing is for the Android app.
```

**zh-CN**

```
Shui 是一款安静、可靠的喝水提醒工具，专门为「一忙起来就忘了喝水」的人设计。

设定提醒间隔、选择生效时段，Shui 会按你习惯的节奏提醒你喝水：应用在前台时用全屏提醒，退到后台时用系统通知。两条通道共用同一条时间线，同一杯水不会提醒两次。

主要功能

• 自定义提醒间隔 —— 15 分钟到几小时，随你设置
• 重复日 —— 仅工作日，或任意组合
• 生效时段 —— 非工作时间不打扰
• 勿扰时段 + 一键暂停，开会时不弹提醒
• 全屏提醒或系统通知，二选一
• 提醒音效，也可静音
• 一键记录饮水（50 / 100 / 200 / 300 ml），通知栏里也能记
• 每日目标与完成进度
• 近 7 天 / 30 天饮水趋势、日均饮水量、达标天数
• 饮水时间分布与间隔分析
• 提醒记录 —— 触发、确认、跳过、超时的次数与展示时长
• CSV 导出，方便自己分析
• JSON 备份与导入 —— 导入只补充缺失日期，不覆盖已有记录
• 浅色 / 深色 / 跟随系统主题

隐私优先

没有账号、没有广告、没有统计 SDK、不追踪。饮水记录、设置与统计全部保存在本机应用私有目录，不会上传到任何服务器。只有你主动导出时才会生成备份或 CSV 文件，并交给你选择的应用。

为 Android 而做

提醒使用 Android 系统闹钟调度，应用退到后台也会照常触发。部分厂商 ROM 需要允许自启动或把 Shui 加入电池优化白名单，应用内提供了直达对应设置页的一键入口。

Shui 同时支持 macOS、Windows 与 Linux，数据模型完全一致。本页面为 Android 版本。
```

### 1.4 分类、标签与联系方式

| 字段 | 填写 |
| --- | --- |
| 应用类别 | **健康与健身（Health & Fitness）**（备选：工具） |
| 标签 | Health、Lifestyle、Productivity |
| 联系邮箱 | `hey47_zhang@163.com`（Play 会公开展示，也是隐私政策里的联系邮箱） |
| 网站（可选） | `https://github.com/rock-zhang/Shui` |
| 隐私政策 | `https://shui-6d906.web.app/privacy-policy.html`（Firebase Hosting，已部署） |
| 开发者名称 | 与 Play 开发者账号一致 |

> 「Health & Fitness」类别下不允许出现医疗宣称。文案里只写「提醒你喝水」，不要写「治疗脱水」「改善肾功能」这类表述。

### 1.5 图形素材

| 素材 | 规格 | 状态 |
| --- | --- | --- |
| 应用图标 | 512×512 PNG，32-bit，≤1 MB，无圆角遮罩（平台会自己切） | 已生成：`app-icon-512x512.png`（直角铺满、无透明，直接上传） |
| 宣传横幅 Feature graphic | 1024×500 PNG/JPEG，**不能带透明通道** | 已生成：`feature-graphic-1024x500.png` |
| 手机截图 | 2–8 张，16:9 或 9:16，每边 320–3840 px，短边 ≥320 | 需真机截取，见第 5 节 |
| 7 英寸 / 10 英寸平板截图 | 同上，可选 | 可选 |
| 宣传视频 | YouTube 链接，可选 | 可选 |

> 仓库里的 `src-tauri/icons/icon_512x512.png` 是桌面端风格的圆角白卡 + 投影，Play 会再套一层圆角遮罩，显示效果发脏，**不要直接上传**，用上面的 `app-icon-512x512.png`。

> 现有 `public/screenshot-*.png` 是桌面端窗口截图（680×460、1920×1080），**不能直接用于 Play 手机截图位**，会被裁切且展示效果差。必须用手机重新截。

---

## 2. App content 各表单填写答案

Play Console →「应用内容 / App content」里逐项完成，下面是每一项应选什么。

### 2.1 隐私政策（Privacy policy）

- 已部署到 Firebase Hosting，直接填这个地址：**`https://shui-6d906.web.app/privacy-policy.html`**
- URL 必须是**公开可访问的网页**，不能是 PDF、不能要求登录。Firebase Hosting 默认公开，**不要**在控制台给它开启身份验证。
- 页面内容更新后在仓库根目录执行 `firebase deploy --only hosting --project shui-6d906`，URL 不变，Play 侧无需修改。

### 2.2 应用访问权限（App access）

- 选择：**所有功能均可直接访问**（All functionality is available without special access）。
- 理由：应用无登录、无付费墙、无受限内容，审核员打开即可用。

### 2.3 广告（Ads）

- 选择：**不包含广告**。

### 2.4 内容分级（Content rating，IARC 问卷）

按以下答案填写，预期得到 **Everyone / 3+**：

| 问题 | 答案 |
| --- | --- |
| 应用类别 | 实用工具 / 健康与健身 |
| 是否包含暴力内容 | 否 |
| 是否包含性内容或裸露 | 否 |
| 是否包含粗俗语言 | 否 |
| 是否涉及受管制物质（酒精、烟草、毒品） | 否 |
| 是否包含赌博内容 | 否 |
| 是否包含恐怖或令人不安的内容 | 否 |
| 是否包含用户生成内容或用户间交流 | 否 |
| 是否分享用户位置 | 否 |
| 是否允许用户购买数字商品 | 否 |
| 是否包含广告 | 否 |
| 是否包含指向外部网站的链接 | 否（应用内无外链；导出交给系统分享面板，不算外链） |
| 是否收集或分享个人身份信息 | 否 |

> 注意：应用内「系统设置引导」会拉起厂商的电池/自启动设置页，属于跳到系统界面，不是外部网站，答「否」。

### 2.5 目标受众与内容（Target audience and content）

- 年龄组：**18 岁及以上**。
- 理由：面向职场成年人，避免触发 Families 政策（儿童向应用需满足额外广告与内容要求）。
- 不要勾选任何儿童年龄段，否则必须提供「家长可接受的使用说明」并通过 Families 审核。

### 2.6 新闻应用（News app）

- 选择：**否**。

### 2.7 数据安全（Data safety）

**核心答案：本应用不收集、不共享任何用户数据。**

逐项：

| 问题 | 答案 |
| --- | --- |
| 您的应用是否收集或共享任何必需的用户数据类型？ | **否** |
| 数据是否会在传输过程中加密？ | 不适用（无传输） |
| 您是否提供让用户请求删除数据的方式？ | 不适用（数据仅存本地，用户卸载即删除） |
| 是否使用数据用于广告或营销？ | 否 |
| 是否使用数据用于分析？ | 否 |
| 是否使用数据用于个性化？ | 否 |
| 是否使用数据用于应用功能？ | 否（不涉及收集） |
| 是否有第三方 SDK 收集数据？ | 否 |

补充说明（如果 Play 弹出「请说明为何声明无数据收集但申请了网络权限」）：

> The app declares `INTERNET` only because the Android WebView that renders the local UI requires it in the Tauri template. No network request is made: all records, settings and statistics are stored in the app's private directory (`files/`), and the app has no backend server.

> CSV/JSON 导出属于用户主动发起的本地文件操作，文件通过系统分享面板交给用户选择的其他应用，开发者无法访问，因此**不计入**「共享数据」。

### 2.8 健康应用（Health apps）

- 选择：**否 / 不使用 Health Connect**。
- 本应用不读取也不写入 Health Connect，仅记录用户手动输入的饮水量。

### 2.9 政府应用（Government apps）

- 选择：**否**。

### 2.10 敏感权限声明（Sensitive permissions）

应用申请了两个在 Play 需要单独说明的权限。首次上传 AAB 后，Play Console 的「应用内容」会依据 manifest 自动列出对应的申报项（Exact alarms / Battery optimization），按下面的用途和文案填写即可；不申报或用途不符会被拒。

**① 精确闹钟（Exact alarms / `SCHEDULE_EXACT_ALARM`）**

选择用途：**闹钟或提醒类应用（Alarm or reminder app）**

说明文案（直接粘贴，英文是审核语言）：

```
Shui is a hydration reminder app. The user chooses a reminder interval (from 15 minutes
to several hours), and the app must fire the reminder at that precise moment — in the
foreground with a full-screen prompt, or in the background with a notification.

We use AlarmManager.setExactAndAllowWhileIdle() so reminders are not batched or delayed
by Doze. Inexact alarms can slip by more than 15 minutes, which would make the user's
chosen cadence meaningless and break the core function of the app.

The permission is only used for user-configured reminder alarms. No other background
scheduling is performed.
```

**② 电池优化豁免（Battery optimization / `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`）**

选择用途：**闹钟或提醒类应用（Alarm or reminder app）**

说明文案：

```
Shui relies on AlarmManager broadcasts to deliver hydration reminders. On several
manufacturer ROMs, aggressive battery optimization delays or drops these broadcasts,
so reminders silently stop after the app has been in the background for a while.

The exemption is requested only when the user opens the in-app "background reliability"
guide and taps the button. The app never asks for it automatically, and it is used
exclusively to deliver the reminders the user configured. No data is collected or
transmitted as a result.
```

> 政策要求：不能一启动就弹「忽略电池优化」的系统对话框。当前实现（`ReminderPlugin.kt`）只在用户主动点击时才跳转 `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`，符合要求。

### 2.11 其他确认项

| 项目 | 选择 |
| --- | --- |
| 数据删除（Data deletion） | 不适用 / 无账号 |
| 金融功能（Financial features） | 无 |
| 广告 ID 使用 | 未使用 `AD_ID` 权限，无需声明 |
| COVID-19 接触者追踪 | 否 |
| 后台位置 | 未申请 |

---

## 3. 账号与发布流程注意事项

### 3.1 个人开发者账号的封闭测试要求（关键）

如果这是**个人（Individual）**开发者账号，且创建于 2023 年 11 月 13 日之后，Play 要求：

1. 创建**封闭测试（Closed testing）**轨道；
2. 至少 **12 名测试者**接受邀请、在设备上实际安装并打开应用；
3. 连续 **14 天**保持参与（仅 opt-in 不算，需要有真实使用行为，否则可能以「测试参与度不足」被拒）；
4. 之后才能申请**正式版发布（Apply for production）**。

此外新个人账号还有一步并行的**设备验证**：需要在真机上完成一次验证，确认你有可用的 Android 物理设备。

组织（Organization）账号不适用上述限制。如果账号是个人账号，请提前把 12 个测试邮箱收集好，别等到上传 AAB 才发现还有 14 天等待期。

### 3.2 Play App Signing

第一次上传 AAB 时选择**使用 Google Play 管理签名密钥**：

- 上传的 AAB 用你本地 keystore 签名（作为「上传密钥」）；
- Google 生成并保管「应用签名密钥」；
- 好处：上传密钥泄露或丢失可以找 Google 重置，不会永久失去更新能力。

上传后到「设置 → 应用完整性」核对 SHA-256，应与本地 `keytool -list -v` 输出一致（上传证书）。

### 3.3 首次发布前还要准备的账号材料

| 材料 | 说明 |
| --- | --- |
| 开发者身份验证 | 个人需身份证件 + 地址证明；组织需 D-U-N-S 编号 |
| 付款资料 | 即使是免费应用也要填写（用于税务与身份核验） |
| 应用内容声明 | 上面第 2 节全部完成 |
| 商店资料 | 上面第 1 节全部完成 |

### 3.4 审核时间与常见被拒原因

| 常见被拒 | 本项目如何规避 |
| --- | --- |
| 缺少隐私政策 | 已生成并托管 |
| 敏感权限未申报 | 第 2.10 节已给出文案 |
| 数据安全表单与实际行为不符 | 应用确实无网络请求、无 SDK，声明「不收集」成立 |
| 应用崩溃或无法打开 | 审核前用 release AAB 装一次真机验证 |
| 提权限前无说明 | 通知权限在首次进入时通过应用内引导申请，有说明页 |
| 使用 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 但非提醒类 | 已按提醒类申报；确保用户主动触发 |

---

## 4. 构建与发布前技术检查

```shell
# 1) 确认版本号（versionCode 会随版本号自动增大）
yarn version:check

# 2) 打 AAB（前端产物由 beforeBuildCommand 自动构建）
yarn tauri android build --aab -t aarch64

# 3) 验签：必须不是 CN=Android Debug
keytool -printcert -jarfile \
  src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab | head -3
```

产物：`src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`

检查项：

- [ ] AAB 签名证书不是 `CN=Android Debug`
- [ ] `versionCode` 大于线上已有版本（首次上传可忽略）
- [ ] 包含 64 位 `arm64-v8a`（Play 强制要求）
- [ ] release 包在真机上冷启动、提醒、通知、记录饮水均正常
- [ ] 未授予通知权限时，应用内提示正常出现（不是白屏/崩溃）
- [ ] 深色模式下状态栏图标可见

---

## 5. 手机截图拍摄清单

Play 手机截图要求：**2–8 张**，PNG/JPEG，16:9 或 9:16（竖屏 1080×1920 或 1080×2340 均可），短边 ≥320 px。

建议按这个顺序拍 6 张（真机或模拟器，浅色主题为主，至少 1 张深色）：

| # | 界面 | 要展示的重点 | 建议文案（可后期加在图上） |
| --- | --- | --- | --- |
| 1 | 今日页（有进度） | 今日进度环 + 最近一杯 | 今天喝够了吗？ |
| 2 | 今日页「提醒节奏」卡片 | 下次提醒时间、间隔 | 按你的节奏提醒 |
| 3 | 全屏提醒页 | 大字号提醒 + 记录按钮 | 该喝水了 |
| 4 | 记录饮水的操作后状态 | 一键 +200 ml | 一指记录 |
| 5 | 统计页 | 7/30 天趋势 + 达标天数 | 看见自己的变化 |
| 6 | 设置页（深色） | 提醒间隔、重复日、勿扰 | 深色模式 |

拍摄方式：

```shell
# 真机连上后
adb exec-out screencap -p > shot-1.png
```

注意：

- 截图里不要出现个人真实数据以外的敏感信息（无账号，不存在此问题）；
- 不要在截图上写「下载即送」「第一」等促销/排名用语；
- 不要伪造系统界面（比如自己 P 一个通知栏）。

---

## 6. 需要你补的信息

| 项目 | 说明 |
| --- | --- |
| 隐私政策公开 URL | 已完成：`https://shui-6d906.web.app/privacy-policy.html` |
| 联系邮箱 | 已填写 `hey47_zhang@163.com` |
| 开发者账号类型 | 个人 / 组织（决定是否需要 12 人 × 14 天封闭测试） |
| 应用名是否已被占用 | Play 不允许重名，上传时若提示冲突需加后缀 |

---

## 相关文件

- [隐私政策（可直接托管）](privacy-policy.html)
- [隐私政策（线上地址）](https://shui-6d906.web.app/privacy-policy.html)
- [宣传横幅](feature-graphic-1024x500.png)
- [Android 打包与签名流程](../../README-ANDROID.md)
