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
