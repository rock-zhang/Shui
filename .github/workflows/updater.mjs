// 生成并上传 updater release 上的 latest.json。
//
// 背景：publish.yaml 里 7 个 matrix job 并发构建，早期由 tauri-action 各自
// 写同名 latest.json，互相覆盖导致 platforms 残缺；一旦缺少 darwin-* 条目，
// macOS 客户端 check() 会抛 TargetNotFound，前端表现为「检查更新失败」。
//
// 现在 tauri-action 已设 includeUpdaterJson: false，改由本脚本在
// upload-assets 这个单 job 里，从版本 release 实际上传成功的 .sig / 安装包
// 资产重建完整 latest.json：无并发覆盖、URL 不会指向不存在的资产、签名必然
// 与 release 上的 .sig 一致。
//
// 注意：需要 devDependency @actions/github。
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { context, getOctokit } from "@actions/github";

// 每个 matrix target 都应该产出一个主平台条目。缺任一个说明有 job 没传完
// 产物，宁可让 CI 失败，也不要把残缺的 latest.json 推上线。
// 临时热更新可设 UPDATER_ALLOW_MISSING_PLATFORMS=1 降级为警告。
const REQUIRED_PLATFORMS = {
  "darwin-aarch64": "aarch64-apple-darwin",
  "darwin-x86_64": "x86_64-apple-darwin",
  "windows-x86_64": "x86_64-pc-windows-msvc",
  "windows-i686": "i686-pc-windows-msvc",
  "windows-aarch64": "aarch64-pc-windows-msvc",
  "linux-x86_64": "x86_64-unknown-linux-gnu",
  "linux-aarch64": "aarch64-unknown-linux-gnu",
};

// tauri-action 的 updaterJsonPreferNsis 默认 false，主 key 指向 msi
const ARCH_ALIAS = {
  x64: "x86_64",
  x86: "i686",
  arm64: "aarch64",
  amd64: "x86_64",
  aarch64: "aarch64",
};

/**
 * 把 Tauri 产物文件名映射到 latest.json 的 platforms key。
 * fixed 是固定后缀的 key；main 是主 key（带优先级，用于 AppImage > deb > rpm）。
 */
export function classify(assetName) {
  const fixed = [];
  let main = null;

  // macOS: Shui_aarch64.app.tar.gz / Shui_x64.app.tar.gz
  const mac = assetName.match(/_([a-z0-9]+)\.app\.tar\.gz$/);
  if (mac) {
    const arch =
      mac[1] === "aarch64" ? "aarch64" : mac[1] === "x64" ? "x86_64" : null;
    if (arch) {
      fixed.push(`darwin-${arch}-app`);
      main = { key: `darwin-${arch}`, priority: 10 };
    }
    return { fixed, main };
  }

  // Windows NSIS: Shui_0.2.32_x64-setup.exe
  const nsis = assetName.match(/_([a-z0-9]+)-setup\.exe$/);
  if (nsis) {
    const arch = ARCH_ALIAS[nsis[1]];
    if (arch) fixed.push(`windows-${arch}-nsis`);
    return { fixed, main };
  }

  // Windows MSI: Shui_0.2.32_x64_en-US.msi
  const msi = assetName.match(/_([a-z0-9]+)_en-US\.msi$/);
  if (msi) {
    const arch = ARCH_ALIAS[msi[1]];
    if (arch) {
      fixed.push(`windows-${arch}-msi`);
      main = { key: `windows-${arch}`, priority: 10 };
    }
    return { fixed, main };
  }

  // Linux: AppImage / deb / rpm
  const linuxArch = /amd64|x86_64/.test(assetName)
    ? "x86_64"
    : /arm64|aarch64/.test(assetName)
      ? "aarch64"
      : null;
  if (linuxArch) {
    if (assetName.endsWith(".AppImage")) {
      fixed.push(`linux-${linuxArch}-appimage`);
      main = { key: `linux-${linuxArch}`, priority: 30 };
    } else if (assetName.endsWith(".deb")) {
      fixed.push(`linux-${linuxArch}-deb`);
      main = { key: `linux-${linuxArch}`, priority: 20 };
    } else if (assetName.endsWith(".rpm")) {
      fixed.push(`linux-${linuxArch}-rpm`);
      main = { key: `linux-${linuxArch}`, priority: 10 };
    }
  }

  return { fixed, main };
}

function validateSignature(signature, bundleName) {
  let decoded;
  try {
    decoded = Buffer.from(signature, "base64").toString("utf8");
  } catch {
    throw new Error(`${bundleName}.sig 不是合法的 base64`);
  }
  if (
    !decoded.startsWith("untrusted comment: signature from tauri secret key") ||
    !decoded.includes("trusted comment:")
  ) {
    throw new Error(`${bundleName}.sig 不是 Tauri 生成的 minisign 签名`);
  }
}

/**
 * 从版本 release 的资产列表重建 latest.json。
 * loadSignature(sigAsset) 由调用方注入，便于本地测试。
 */
export async function buildUpdaterJson({
  assets,
  tag,
  owner,
  repo,
  version,
  notes,
  pubDate,
  loadSignature,
}) {
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  const sigAssets = assets.filter((asset) => asset.name.endsWith(".sig"));

  if (sigAssets.length === 0) {
    throw new Error(
      "版本 release 中没有任何 .sig 签名资产，无法重建 latest.json（检查构建产物是否上传成功）",
    );
  }

  const platforms = {};
  const mains = {};

  for (const sigAsset of sigAssets) {
    const bundleName = sigAsset.name.slice(0, -4);
    if (!byName.has(bundleName)) {
      throw new Error(`存在签名但缺少对应安装包：${bundleName}`);
    }

    const signature = (await loadSignature(sigAsset)).trim();
    validateSignature(signature, bundleName);

    const entry = {
      signature,
      url: `https://github.com/${owner}/${repo}/releases/download/${tag}/${bundleName}`,
    };

    const { fixed, main } = classify(bundleName);
    for (const key of fixed) platforms[key] = entry;
    if (
      main &&
      (!mains[main.key] || main.priority > mains[main.key].priority)
    ) {
      mains[main.key] = { priority: main.priority, entry };
    }
  }

  for (const [key, { entry }] of Object.entries(mains)) {
    platforms[key] = entry;
  }

  const missing = Object.entries(REQUIRED_PLATFORMS)
    .filter(([key]) => !platforms[key])
    .map(([key, target]) => `${key} (${target})`);
  if (missing.length > 0) {
    const message = `构建产物不完整，latest.json 缺少主平台：${missing.join(
      ", ",
    )}。请检查 publish.yaml 中对应 matrix job 是否成功上传安装包与 .sig。`;
    if (process.env.UPDATER_ALLOW_MISSING_PLATFORMS === "1") {
      console.warn(`[warn] ${message}`);
    } else {
      throw new Error(message);
    }
  }

  return {
    version,
    notes: notes || "",
    pub_date: pubDate,
    platforms: Object.fromEntries(
      Object.entries(platforms).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

// ---------- GitHub Actions 入口 ----------

const readAppVersion = () =>
  JSON.parse(
    readFileSync(
      new URL("../../src-tauri/tauri.conf.json", import.meta.url),
      "utf8",
    ),
  ).version;

// tauri-action 上传到当前 tag 的 release 可能是草稿，getReleaseByTag 查不到，
// 所以遍历 release 列表匹配
const getVersionRelease = async (octokit, owner, repo, tag) => {
  const releases = await octokit.paginate(octokit.rest.repos.listReleases, {
    owner,
    repo,
    per_page: 100,
  });
  const release = releases.find((item) => item.tag_name === tag);
  if (!release) throw new Error(`未找到 tag 为 ${tag} 的 release`);
  return release;
};

// 旧版本的更新端点固定指向 releases/download/updater/latest.json，
// 因此该 release 必须始终存在且为 published 状态
//（draft 的 release 资产对未认证请求返回 404）。
const getOrCreateUpdaterRelease = async (octokit, owner, repo) => {
  try {
    const { data: release } = await octokit.rest.repos.getReleaseByTag({
      owner,
      repo,
      tag: "updater",
    });
    if (!release.draft) return release;
    const { data: published } = await octokit.rest.repos.updateRelease({
      owner,
      repo,
      release_id: release.id,
      draft: false,
    });
    return published;
  } catch (error) {
    if (error.status !== 404) throw error;
    const { data: release } = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name: "updater",
      name: "Updater",
      body: "旧版本检查更新的固定端点；latest.json 由发布流程自动更新，请勿手动删除。",
      draft: false,
      prerelease: false,
    });
    return release;
  }
};

const downloadAsset = async (octokit, owner, repo, assetId) => {
  const { data } = await octokit.request(
    "GET /repos/{owner}/{repo}/releases/assets/{asset_id}",
    {
      owner,
      repo,
      asset_id: assetId,
      headers: { accept: "application/octet-stream" },
    },
  );
  return Buffer.from(data).toString("utf8");
};

const updateRelease = async () => {
  const octokit = getOctokit(process.env.GITHUB_TOKEN);
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const tag = process.env.GITHUB_REF_NAME;

  const versionRelease = await getVersionRelease(octokit, owner, repo, tag);
  const version = readAppVersion();
  const tagVersion = tag.replace(/^v/, "");
  if (version !== tagVersion) {
    throw new Error(
      `版本号不一致：tag=${tag}(${tagVersion}) / tauri.conf.json=${version}`,
    );
  }

  const latestJson = await buildUpdaterJson({
    assets: versionRelease.assets,
    tag,
    owner,
    repo,
    version,
    notes: versionRelease.body || "Feature",
    pubDate: new Date().toISOString(),
    loadSignature: (asset) =>
      downloadAsset(octokit, owner, repo, asset.id),
  });

  const release = await getOrCreateUpdaterRelease(octokit, owner, repo);

  await Promise.all(
    release.assets
      .filter((item) => item.name === "latest.json")
      .map((item) =>
        octokit.rest.repos.deleteReleaseAsset({
          owner,
          repo,
          asset_id: item.id,
        }),
      ),
  );

  await octokit.rest.repos.uploadReleaseAsset({
    owner,
    repo,
    release_id: release.id,
    name: "latest.json",
    data: Buffer.from(`${JSON.stringify(latestJson, null, 2)}\n`, "utf8"),
  });

  console.log(
    `latest.json 已更新：version=${version}，平台条目 ${
      Object.keys(latestJson.platforms).length
    } 个`,
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  updateRelease().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
