# 外观主题

外观主题功能已合入 `main`，在通用设置中提供主题选择，不依赖饮水记录或统计页面。

通用设置提供浅色、深色、跟随系统三种外观。通过现有 `next-themes` 依赖设置根节点的 `class`，使用 `shui-theme` 本地存储键持久化，并同步同源窗口的选择。初始跟随系统，系统模式会响应操作系统外观变化。

同时调整关于页面的深色配色。这里提供预设外观，不包含自选主题色、图片背景或主题导入导出。

## 验证

```sh
corepack yarn install --frozen-lockfile
corepack yarn eslint -c src/eslint.config.mjs src
corepack yarn build
cargo test --workspace --locked
```

浏览器检查主题切换、刷新后持久化、系统外观变化和同源窗口同步。主题模块不改变饮水记录与统计使用的数据格式，也不引入新的运行时依赖。
