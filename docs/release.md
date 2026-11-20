# 发布流程（维护者内部文档）

面向仓库维护者。普通用户安装请直接看 [README](../README.md) 的「下载安装」。

推送 `v*` 标签会触发 [GitHub Actions](../.github/workflows/publish.yaml)，自动完成多平台构建、创建 Release 并更新自动更新清单。

## 1. 发布新版本

**不要手工 `git tag`。** 版本号分散在 4 个文件里，统一由 `yarn release` 维护，它会把「改版本号 → 提交 → 打 tag」合成一步：

```shell
# 在 main 分支、index 干净时执行
git switch main && git pull --ff-only
yarn release 0.3.0          # 同步 4 处版本号 + 生成 commit + 打本地 tag v0.3.0
git push origin HEAD        # 先推版本提交
git push origin v0.3.0      # 再推 tag，推送即触发发布流水线
```

`package.json` 的 `version` 是唯一真源，`yarn release <version>` 同步 `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`Cargo.lock`，生成 `chore(release): vX` 提交并打 `vX` 标签。**脚本不会自动 push**；默认只允许在 `main` 上、index 干净时执行（4 个版本文件本身也不能有未提交改动），确需从其他分支发版可加 `--allow-branch`。只想检查一致性可以跑 `yarn version:check`。

> `Cargo.lock` 不能漏：日常 CI 用 `cargo build --locked`，manifest 与 lock 里的 `shui` 版本不一致会直接失败。

## 2. 发布前检查

- **版本号与 tag 一致**：`0.3.0` 对应 `v0.3.0`，已由脚本绑定；若手工打 tag 时写错，CI 会在编译前的 `Verify version matches tag` 步骤 10 秒内失败，不会白跑 7 个构建 job
- **`updater` Release 已存在且已发布**：自动更新端点固定为 `https://github.com/rock-zhang/Shui/releases/download/updater/latest.json`
- **Secrets 已配置**：`TAURI_SIGNING_PRIVATE_KEY`（更新签名私钥）；若私钥带密码，还需 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## 3. 流水线说明

| Job | 作用 |
| --- | --- |
| `create-release` | 先校验 tag 与 4 处版本号一致，再由 changelogithub 生成草稿 Release |
| `release` | 矩阵构建 macOS（aarch64 / x86_64）、Windows（x64 / x86 / arm64）、Linux（x64 / arm64），上传安装包与 `.sig`；设 `includeUpdaterJson: false`，**不生成** `latest.json`，避免 7 个 job 并发写同名资产互相覆盖 |
| `upload-assets` | 从当前 tag Release 的 `.sig` + 安装包资产**重建**完整 `latest.json`，校验签名、版本一致性与 7 个主平台齐全后，覆盖到 `updater` Release（仅正式标签执行，含 `test` / `beta` 的标签会跳过） |

版本检查共三道：`ci.yaml` 在日常 PR 校验 4 处版本号是否一致，`publish.yaml` 在编译前校验 tag，`upload-assets` 在上传更新清单前再兜底一次。

## 4. 发布后操作

CI 创建的 Release 是**草稿**状态，草稿 Release 的资产外部无法下载，自动更新不会生效。需要在 GitHub 上手动 **Publish release** 后，客户端才能检测到新版本。

## 5. 流水线失败后重跑

同一个 tag 不能直接重推（脚本会拒绝，旧草稿里的资产也会与新构建混在一起）。先清掉草稿 Release 和 tag：

```shell
gh release delete v0.3.0 --repo rock-zhang/Shui --yes
git push origin :refs/tags/v0.3.0
git tag -d v0.3.0
```

再按当前代码里的版本号分两种情况：

- **已经是 `0.3.0`**（之前跑过 `yarn release`）：提交并推送修复代码后重新打 tag：`git push origin HEAD && git tag v0.3.0 && git push origin v0.3.0`。不要再跑 `yarn release 0.3.0`，它会以「版本号没变」拒绝。
- **还是旧版本号**（当初手工打 tag、忘了升版本）：重新跑 `yarn release 0.3.0`，再按第 1 步依次 push commit 和 tag。

## 6. Android 双产物：Play 包 vs 侧载包

同一个 tag 会由 [android-release.yml](../.github/workflows/android-release.yml) 的 matrix 并行产出两个包，**必须严格区分**：

| | Play 包 | 侧载包 |
| --- | --- | --- |
| 产物 | `.aab` | `.apk` |
| 构建开关 | `SHUI_VARIANT=play`（默认） | `SHUI_VARIANT=sideload` + `-f sideload` |
| `REQUEST_INSTALL_PACKAGES` | **不含** | 含 |
| 自更新代码（Kotlin / Rust） | **不编译** | 编译 |
| 客户端更新方式 | Google Play 商店 | 应用内自更新 |

隔离由三层共同保证，任何一层失效都会导致 Play 拒审或侧载更新失效：

1. **Gradle**：`build.gradle.kts` 读 `SHUI_VARIANT`，控制 manifest placeholder（Play 占位成 `VIBRATE`）与 sideload 源码集是否编译。
2. **Rust**：`sideload` cargo feature 控制插件注册与 `sideload_update` 模块编译。
3. **前端**：Rust 注入 `window.__SHUI_SIDELOAD__`，「关于」页据此决定是否显示「检查更新」。

CI 内置两道门禁，任一不满足直接 fail：

- Play 包构建后 grep merged manifest，**发现** `REQUEST_INSTALL_PACKAGES` → 失败；
- 侧载包构建后 grep merged manifest，**缺失** `REQUEST_INSTALL_PACKAGES` → 失败。

侧载包会额外生成 `android-latest.json`（版本 / `apkUrl` / `sha256`）并随 APK 上传到同一个 Release。客户端固定从
`https://github.com/rock-zhang/Shui/releases/latest/download/android-latest.json` 拉清单，下载后强制校验 SHA-256。

**本地验证两个变体**（改隔离逻辑后务必各跑一次）：

```shell
# Play 变体（不应带安装权限）
yarn tauri android build --aab -t aarch64 --ci -c '{"build":{"beforeBuildCommand":""}}'
# 侧载变体（应带安装权限，并编译 SideloadUpdaterPlugin）
SHUI_VARIANT=sideload yarn tauri android build --apk -t aarch64 --ci \
  -c '{"build":{"beforeBuildCommand":""}}' -f sideload
```

检查合并后的 manifest：`src-tauri/gen/android/app/build/intermediates/merged_manifest*/**/AndroidManifest.xml`。

### 签名与「跨渠道覆盖」限制

两个包沿用同一个 `applicationId`（`com.shui.app`）与同一把 release keystore，因此：

- **侧载包能自更新自己**：新旧 APK 都由上传密钥签名，`versionCode` 递增即可覆盖安装。
- **若启用了 Play App Signing**，Google 会用另一把「应用签名密钥」重签下发的安装包。此时用侧载 APK 去覆盖「从 Play 装的应用」会因签名不一致报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，必须先卸载（会丢本地数据）。

因此两个渠道应视为**互不迁移**的分发通道：Play 用户靠商店更新，侧载用户靠应用内更新。若确实需要用户跨渠道迁移，只能另行设计数据导出/导入，不要指望直接覆盖安装。
