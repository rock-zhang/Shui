#!/usr/bin/env node
/**
 * 版本号唯一入口。
 *
 * 真源是 package.json 的 `version`。tauri.conf.json / src-tauri/Cargo.toml /
 * Cargo.lock 三处由 `yarn release <version>` 自动同步，不再人工维护。
 *
 *   node scripts/version.mjs check              # 检查 4 处是否一致
 *   node scripts/version.mjs check v0.3.0      # 发版门禁：额外校验 tag
 *   node scripts/version.mjs bump 0.3.0        # 同步 4 处 + commit + tag（不 push）
 *   node scripts/version.mjs bump 0.3.0 --no-git  # 只改文件，不提交（测试用）
 *   node scripts/version.mjs bump 0.3.0 --allow-branch  # 允许在非 main 分支发版
 *
 * 只用 Node 内置模块：CI 无需 yarn install 就能在编译前跑 check。
 * 之所以要管 Cargo.lock：ci.yaml 用 `cargo build --locked`，manifest 与 lock
 * 里的 crate 版本不一致会直接让日常 CI 变红。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// 每条正则的捕获组固定为：1=前缀，2=版本号，3=后缀。
// 这样读写共用一套定义，新增/移除版本字段只改这一张表。
const FILES = [
  {
    file: "package.json",
    pattern: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    file: "src-tauri/tauri.conf.json",
    pattern: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    file: "src-tauri/Cargo.toml",
    pattern: /(\[package\][\s\S]*?^\s*version\s*=\s*")([^"]+)(")/m,
  },
  {
    file: "Cargo.lock",
    pattern: /(\[\[package\]\]\s*\nname = "shui"\s*\nversion = ")([^"]+)(")/,
  },
];

const readOne = (spec) => {
  const text = readFileSync(resolve(ROOT, spec.file), "utf8");
  const match = text.match(spec.pattern);
  if (!match) {
    throw new Error(`${spec.file} 中找不到版本号字段，检查文件结构是否变了`);
  }
  return { ...spec, text, match, version: match[2] };
};

/** 读取 4 处版本号。 */
export const readVersions = () =>
  FILES.map((spec) => {
    const { file, version } = readOne(spec);
    return { file, version };
  });

/**
 * 校验 4 处版本号彼此一致；传 tag 时额外要求 tag = v + 版本号。
 * 返回 { version, rows }，失败时把所有位置的实际值都打印出来。
 */
export const assertVersions = ({ tag } = {}) => {
  const rows = readVersions();
  const expected = tag ? tag.replace(/^v/, "") : rows[0].version;
  const mismatched = rows.filter((row) => row.version !== expected);

  if (mismatched.length > 0) {
    const table = rows
      .map(
        (row) =>
          `  ${row.version === expected ? "OK  " : "FAIL"} ${row.file.padEnd(30)} ${row.version}`,
      )
      .join("\n");
    const reason = tag
      ? `tag=${tag} 与代码版本不一致`
      : "4 处版本号彼此不一致";
    throw new Error(
      `${reason}（期望 ${expected}）：\n${table}\n\n` +
        `修复：yarn release ${expected}\n` +
        `若只是 tag 打错了，删除后重打：git tag -d ${tag || `v${expected}`}`,
    );
  }

  return { version: expected, rows };
};

/** 把 4 处版本号同步写成 target，保持文件原有格式（只替换版本串）。 */
export const writeVersion = (target) => {
  for (const spec of FILES) {
    const { text, match } = readOne(spec);
    const next =
      text.slice(0, match.index) +
      match[1] +
      target +
      match[3] +
      text.slice(match.index + match[0].length);
    writeFileSync(resolve(ROOT, spec.file), next, "utf8");
  }
};

const git = (args) =>
  execFileSync("git", ["-C", ROOT, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const bump = (target, { noGit = false, allowBranch = false } = {}) => {
  if (!SEMVER.test(target)) {
    throw new Error(`版本号不合法：${target}（需要 semver，如 0.3.0 或 0.3.0-beta.1）`);
  }

  const { version: current } = assertVersions();
  if (target === current) {
    throw new Error(`版本号没变（当前就是 ${current}）`);
  }

  if (!noGit) {
    let branch = "";
    try {
      branch = git(["symbolic-ref", "--short", "HEAD"]);
    } catch {
      // detached HEAD
    }
    if (branch !== "main" && branch !== "master" && !allowBranch) {
      throw new Error(
        `当前在 ${branch || "detached HEAD"}，release commit 默认只应落在 main。\n` +
          `先切到 main，或确认就是要从当前分支发版后加 --allow-branch：` +
          `yarn release ${target} --allow-branch`,
      );
    }

    const staged = git(["diff", "--cached", "--name-only"]);
    if (staged) {
      throw new Error(
        `index 里已有其他暂存改动，会被一起提交进 release commit，先处理：\n${staged}`,
      );
    }

    const dirty = git(["status", "--porcelain", "--", ...FILES.map((f) => f.file)]);
    if (dirty) {
      throw new Error(
        `版本文件本身有未提交改动，先处理再 bump，避免覆盖：\n${dirty}`,
      );
    }
    // tag 不存在时 git rev-parse 会以非 0 退出，属正常情况。
    let exists = "";
    try {
      exists = git(["rev-parse", "-q", "--verify", `refs/tags/v${target}`]);
    } catch {
      // tag 不存在
    }
    if (exists) {
      throw new Error(
        `tag v${target} 已存在（${exists.slice(0, 8)}）。` +
          `先删远端 tag 与草稿 release，再重打：\n` +
          `  gh release delete v${target} --repo rock-zhang/Shui --yes\n` +
          `  git push origin :refs/tags/v${target}\n` +
          `  git tag -d v${target}`,
      );
    }
  }

  writeVersion(target);
  const { rows } = assertVersions();
  console.log(`版本号已同步为 ${target}：`);
  for (const row of rows) console.log(`  ${row.file.padEnd(30)} ${row.version}`);

  if (noGit) return;

  git(["add", "--", ...FILES.map((f) => f.file)]);
  git(["commit", "-m", `chore(release): v${target}`]);
  git(["tag", `v${target}`]);
  console.log(`\n已提交并打 tag v${target}。确认无误后手动推送：\n` +
    `  git push origin HEAD && git push origin v${target}\n` +
    `（push tag 会触发 publish workflow；脚本不会替你 push）`);
};

const main = async () => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "check") {
    const tag = rest.find((arg) => !arg.startsWith("--"));
    const { version, rows } = assertVersions({ tag });
    console.log(
      `版本号一致：${version}${tag ? ` (tag=${tag})` : ""}，${rows.length} 处全部匹配`,
    );
  } else if (command === "bump") {
    const target = rest.find((arg) => !arg.startsWith("--"));
    if (!target) throw new Error("用法：yarn release <version>，例如 yarn release 0.3.0");
    bump(target, {
      noGit: rest.includes("--no-git"),
      allowBranch: rest.includes("--allow-branch"),
    });
  } else {
    console.log(
      "用法：\n" +
        "  node scripts/version.mjs check [tag]       校验版本号\n" +
        "  node scripts/version.mjs bump <version>    同步版本号 + commit + tag\n" +
        "                                          (--allow-branch 允许非 main 分支)\n",
    );
    if (command) throw new Error(`未知命令：${command}`);
  }
};

// 被 .github/workflows/updater.mjs import 时不执行 CLI。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n[version] ${err.message}\n`);
    process.exit(1);
  });
}
