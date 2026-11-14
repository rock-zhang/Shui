# 饮水统计与 CSV 导出

饮水统计与 CSV 导出已合入 `main`，在 `/setting/statistics/` 提供近 7/30 天趋势、日均、达标天数、饮水时间分布与间隔分析，以及全量饮水历史的 CSV 导出。

兼容旧版数字总量及新版 `{ schemaVersion, total, goal, entries }` 数据。旧记录没有时间明细时只展示每日总量，不补造时间样本。沿用上游的后端串行记水：全屏提醒和饮水记录页的手动补记都会产生带时间戳的明细。撤销后的总量与明细会在重新进入或刷新统计页时反映到图表和时间分析中，CSV 导出也读取修正后的记录。

提醒统计观察通用 `reminder_session.rs` 发出的结束事件，按开始日期合并多屏，区分确认、跳过和超时。展示时长最多每次 30 秒，不作为真实休息时长；系统通知与异常退出不计入。保存失败恢复内存，并保留关闭提醒和恢复计时的行为。

CSV 导出所有日期，不限于当前图表范围，包含 UTF-8 BOM 和逐笔明细。旧数据的目标按当前配置估算。CSV 用于查看和分析，未保留请求 ID、撤销墓碑及提醒统计，不能作为完整备份。需要保留饮水明细、历史目标及撤销信息时，请使用 [JSON 备份与导入](data-backup.md)；导入后重新进入或刷新统计页查看更新结果。饮水记录的导入不会改变提醒统计。

## 验证

```sh
corepack yarn install --frozen-lockfile
node --test tests/*.test.cjs
corepack yarn eslint -c src/eslint.config.mjs src
corepack yarn build
cargo test --workspace --locked
```

测试覆盖旧总量兼容、历史目标、跨年日期、时段边界、同日间隔、无效时间、撤销后分析、CSV 与提醒结果。浏览器使用模拟 Tauri IPC 验证统计页、日期切换、全量导出和取消保存。原生保存对话框及多屏仍需实机验收。
