# 📱 Shui — Android 端

Android 版作为独立 App 发布，与桌面端共用同一套饮水数据与业务逻辑，但原生能力（闹钟提醒、通知、电池白名单、系统栏样式）全部重写。本文档记录 Android 端与桌面端的差异，以及**生产包（APK / AAB）的完整打包流程**。

- 项目整体介绍、桌面端安装与发版流程见 [README.md](README.md)
- English version: [README-ANDROID.en.md](README-ANDROID.en.md)

---

## 与桌面端的差异

界面里不再保留与桌面端对照的说明；功能映射与取舍统一记录在这里，供开发维护参考。

| 桌面端 | Android 端 |
| --- | --- |
| 托盘实时倒计时 | 今日 →「提醒节奏」卡片 |
| 全局快捷键 | 系统通知里的「记一杯水」快捷操作 |
| 静默开机自启 | 系统闹钟在开机广播后重建 |
| 应用白名单 / 息屏、锁屏自动暂停 | 「勿扰时段」+「暂停提醒」 |
| 应用内自动更新 | 应用商店更新（商店政策不允许应用内自更新） |
| 已安装应用列表 | 不采集（涉及敏感权限） |

保持一致的部分：每日目标、提醒间隔（单位：分钟）、重复日、时间范围、全屏提醒 / 系统通知 / 提醒音效、饮水记录与撤销、趋势与习惯统计、CSV 导出、JSON 备份导入、外观主题。

后台到达依赖系统闹钟 + 通知权限 + 电池优化白名单；部分国产 ROM 还需在「自启动 / 后台锁定」中允许本应用。原生实现见 `src-tauri/gen/android/`。

**系统栏样式**：状态栏与手势导航条和页面同色，图标明暗随主题反转。颜色取自 `src/app/globals.css` 的 `background` token（亮 `#ffffff` / 暗 `#020618`），Android 侧定义在 `res/values/colors.xml`；`values/themes.xml` 与 `values-night/themes.xml` 负责冷启动首帧，运行时由 `set_system_bar_theme` 命令跟随 App 内 next-themes 的实际主题（用户可独立于系统选深色）。`tests/system-bars.test.cjs` 会校验 CSS、Android 颜色与 `themeColor` 三处一致，改主题 token 时必须同步。

**提醒链路**：前台由 Rust 定时线程给出全屏提醒，退后台由 Kotlin `AlarmManager` 精确闹钟发系统通知；两条通道读写同一份「上次提醒时间」账本（`last_reminder_at.txt`），任一路触发后另一路在间隔内不再重复，避免进 App 时通知与全屏双弹。

---

## 生产打包（APK / AAB）

Android 独立打包，**AAB 用于 Google Play 上架，APK 用于侧载和国内渠道分发**。桌面端的发版流程与本流程无关，见 [README.md](README.md) 的「📦 发布流程」一节。

`--debug` 包只适合自测：Rust 走未优化编译、保留调试符号（包体大两三倍）、用 debug 证书签名（Play 直接拒绝）。要分发或上架，必须打 release 包。

### 1. 一次性准备：生成 release keystore

```shell
keytool -genkeypair -v \
  -keystore ~/.android-keys/shui-release.jks \
  -alias shui \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Shui, O=Shui, C=CN"
```

`-validity 10000`（约 27 年）要覆盖 App 的生命周期——Google Play 要求签名证书有效期至少到 2033 年。

> ⚠️ **这个文件丢了就再也无法更新已上架的应用**。备份到密码管理器 + 离线介质，不要只留在本机。
> 强烈建议在 Play 控制台开启 **Play App Signing**，把这份当「上传密钥」：即使泄露或丢失，也能让 Google 重置。

生成后建议记下证书指纹，后续在 Play 控制台核对签名会用到：

```shell
keytool -list -v -keystore ~/.android-keys/shui-release.jks -alias shui | grep SHA256
```

### 2. 配置签名（二选一）

**方式 A：本地文件**（个人开发推荐）

新建 `src-tauri/gen/android/key.properties`（已在 `.gitignore` 中，不会误提交）：

```properties
storeFile=/Users/you/.android-keys/shui-release.jks
storePassword=你的store密码
keyAlias=shui
keyPassword=你的key密码
```

`storeFile` 写绝对路径最省事；相对路径以 `src-tauri/gen/android/` 为基准。

**方式 B：环境变量**（CI 或不想落盘时）

| 环境变量 | 含义 |
| --- | --- |
| `ANDROID_KEYSTORE_FILE` | keystore 绝对路径 |
| `ANDROID_KEYSTORE_PASSWORD` | store 密码 |
| `ANDROID_KEY_ALIAS` | key 别名 |
| `ANDROID_KEY_PASSWORD` | key 密码 |

> 四个都提供才会启用 release 签名。**缺任意一个会静默回退 debug 签名**——本地照样能装能跑，但 Play 会拒绝。所以打完务必验签（第 5 步）。

配置完可以先确认 Gradle 读到了证书，免得到打包时才发现回退：

```shell
cd src-tauri/gen/android && ./gradlew :app:signingReport | grep -A 4 Release
```

输出的 `Store` 应指向你的 jks，`SHA-256` 与第 1 步记下的指纹一致。

### 3. 升版本号

```shell
yarn release 0.3.0     # 同步 4 处版本号 + 生成提交 + 打 tag
```

Android 的 `versionCode` **不需要手填**：构建时由 `tauri.conf.json` 的 `version` 推导写入 `src-tauri/gen/android/app/tauri.properties`（规则 `major*1000000 + minor*1000 + patch`，如 `0.2.32` → `2032`）。该文件自动生成且不进仓库，**只要版本号递增，versionCode 必然递增**，Play 的「版本码必须大于线上」不会踩坑。

不要手工改 `tauri.properties`（文件头已标明自动生成，每次构建都会被覆盖）。

### 4. 打包

```shell
# AAB —— Google Play 上架用
yarn tauri android build --aab -t aarch64

# APK —— 侧载 / 国内渠道 / 内测分发
yarn tauri android build --apk -t aarch64
```

- **绝对不要把 `--apk` 和 `--aab` 写在同一条命令里**：Tauri CLI 2.x 的第二次 Gradle 调用会等一个永远不会建立的 socket 并永久挂起。必须拆成两次执行。
- `-t` 指定 ABI：`aarch64`（绝大多数手机，必选）、`armv7`（老机型）、`x86_64`（模拟器）。可传多个：`-t aarch64 armv7`；不传则打全部（体积显著变大）。
- `--ci` 可选，非交互模式，不弹确认。
- 前端产物不用手动准备：release 构建会自动执行 `beforeBuildCommand`（`yarn build`）。

产物路径（`-t` 传单个 ABI 时 Tauri 仍包成 universal 容器）：

```
src-tauri/gen/android/app/build/outputs/
├── bundle/universalRelease/app-universal-release.aab   # 上架用，约 11 MB
└── apk/universal/release/app-universal-release.apk     # 分发用，约 19 MB
```

### 5. 验签（每次打生产包都做一次）

```shell
# AAB：确认签名块存在且不是 debug 证书
unzip -l src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab \
  | grep -E 'META-INF/.*\.(RSA|DSA|EC|SF)'
keytool -printcert -jarfile src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab | head -3

# APK
$ANDROID_HOME/build-tools/34.0.0/apksigner verify --print-certs \
  src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk | head -3
```

输出里出现 `CN=Android Debug` 就说明回退成了 debug 签名，回去检查第 2 步的四个参数。

### 6. 走 CI 打包

仓库已有 [`.github/workflows/android-release.yml`](.github/workflows/android-release.yml)，在 Actions 页面手动触发，可分别选择产物类型（both / aab / apk）与 ABI。

需要先配置 4 个 secrets（与本地第 2 步一一对应）：

| Secret | 生成方式 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -i ~/.android-keys/shui-release.jks`（macOS）或 `base64 -w0 shui-release.jks`（Linux） |
| `ANDROID_KEYSTORE_PASSWORD` | 同本地 store 密码 |
| `ANDROID_KEY_ALIAS` | 同本地 key 别名 |
| `ANDROID_KEY_PASSWORD` | 同本地 key 密码 |

CI 会自己解码 keystore、校验 AAB 签名不是 debug，构建完删除密钥文件，产物通过 Actions artifact 下载（保留 14 天）。

### 7. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `next build` 报 `TypeError: Cannot read properties of undefined (reading 'length')`（栈里有 `WasmHash._updateWithBuffer`） | webpack 缓存损坏。`rm -rf .next dist && mkdir -p dist` 后重打。注意本项目 `distDir` 是 `dist` 而非默认的 `.next` |
| `beforeBuildCommand` 的 `yarn build` 失败，日志里有 safe-delete / `ENOENT` | 本地 Node 被注入了文件系统代理（某些 Agent/沙箱工具会做）。用 `NODE_OPTIONS= yarn tauri android build ...` 清空该变量后重试 |
| Play 提示「版本码已存在」 | 版本号没升，`tauri.properties` 里的 versionCode 没变。跑 `yarn release <新版本>` |
| Play 提示「APK/AAB 未签名或签名无效」 | 回退成了 debug 签名，第 2 步四个参数没配齐 |
| 构建卡住不动，日志停在 Gradle 第二步 | 大概率是同一条命令里同时传了 `--apk --aab`，拆开重跑 |
| 打出的包体积异常大（30 MB+） | 打成了 debug 包（漏了 `--apk` 之外的默认 release 行为被 `--debug` 覆盖），或 `-t` 传了全部 ABI |
| 手机上装 release 包报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 之前装的是 debug 包，两者签名不同。先卸载旧包再装（应用内数据会丢失，正式版上线前无妨） |

---

## 相关文档

- [数据结构与备份格式](docs/data-backup.md)
- [饮水记录设计](docs/drink-records.md)
- [补水统计口径](docs/hydration-statistics.md)
- [静默自启](docs/silent-autostart.md)
- [主题](docs/themes.md)
