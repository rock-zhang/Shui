// 注意要安装@actions/github依赖
import { context, getOctokit } from "@actions/github";

// 在容器中可以通过env环境变量来获取参数
const octokit = getOctokit(process.env.GITHUB_TOKEN);
const owner = context.repo.owner;
const repo = context.repo.repo;
// 当前触发的 tag，例如 v1.2.3
const tag = process.env.GITHUB_REF_NAME;

// tauri-action 会把 latest.json 上传到当前 tag 对应的 release，
// 但该 release 是草稿，getReleaseByTag 查不到，所以遍历 release 列表匹配
const getVersionRelease = async () => {
  const releases = await octokit.paginate(octokit.rest.repos.listReleases, {
    owner,
    repo,
    per_page: 100,
  });
  const release = releases.find((item) => item.tag_name === tag);
  if (!release) throw new Error(`未找到 tag 为 ${tag} 的 release`);
  return release;
};

// 获取或创建 updater tag 的 release。旧版本的更新端点固定指向
// `releases/download/updater/latest.json`，因此该 release 必须始终存在且为
// published 状态（draft 的 release 资产对未认证请求返回 404）。
const getOrCreateUpdaterRelease = async () => {
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

const updateRelease = async () => {
  const versionRelease = await getVersionRelease();
  const latestAsset = versionRelease.assets.find(
    (item) => item.name === "latest.json",
  );
  if (!latestAsset) {
    throw new Error(`tag ${tag} 的 release 中不存在 latest.json`);
  }

  // 下载 tauri-action 生成（已包含全部平台）的 latest.json
  const { data } = await octokit.request(
    "GET /repos/{owner}/{repo}/releases/assets/{asset_id}",
    {
      owner,
      repo,
      asset_id: latestAsset.id,
      headers: { accept: "application/octet-stream" },
    },
  );
  const latestJson = Buffer.from(data);

  // 获取（不存在时创建）updater tag 的 release
  const release = await getOrCreateUpdaterRelease();

  // 删除旧的的文件
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

  // 上传新的文件
  await octokit.rest.repos.uploadReleaseAsset({
    owner,
    repo,
    release_id: release.id,
    name: "latest.json",
    data: latestJson,
  });
};

updateRelease().catch((error) => {
  console.error(error);
  process.exit(1);
});
