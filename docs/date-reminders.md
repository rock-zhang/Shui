# 日期与排期

对应 [Issue #33](https://github.com/rock-zhang/Shui/issues/33)。桌面“提醒”页和 Android“提醒”页共用配置。

## 排期

- **按星期**：选择需要提醒的星期；全部取消表示没有星期提醒。
- **大小周**：选一个大周参考日期，分别设置大周、小周的提醒星期，再保存。参考日期所在周是大周，以周一为界交替，跨年不重置，不受一年有 52 或 53 周影响。
- **个人自定义日期**：添加、编辑或删除补班日和休假日，可填写备注；连续日期支持批量设置，确认前展示天数和已有安排冲突数。删除后恢复下一级规则。

优先级：**个人自定义日期 → 已启用的节假日安排 → 大小周或星期规则**。今日计划和未来四周预览显示最终结果及原因。全部按系统本地日期计算；提醒时段、目标、暂停、勿扰及原有平台限制继续生效。

## 节假日导入

输入年份获取中国年度节假日，或选择本地 `holiday-cn` 格式 JSON 文件。导入前可预览休假和补班日期及数量，确认后保存。更新同一年份会替换该年的旧导入，保留其他年份和个人自定义日期；每个年份可独立停用或移除。

在线数据来自 [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn)，是依据公开公告整理的非官方数据。仅在主动获取时联网，未发布的年份或网络失败会提示重试，不改变现有排期。导入后可离线使用，数据源后续更新需要重新获取并确认。

本地文件示例（`isOffDay: true` 为休假，`false` 为补班）：

```json
{
  "year": 2026,
  "days": [
    { "date": "2026-01-01", "name": "元旦", "isOffDay": true },
    { "date": "2026-01-04", "name": "元旦调休", "isOffDay": false }
  ]
}
```

## 验证

```sh
node --test tests/*.test.cjs
corepack yarn eslint -c src/eslint.config.mjs src
corepack yarn build
cargo test --workspace --locked
python3 tests/native/startup_smoke.py --build --artifacts artifacts/native-smoke
```

关键回归覆盖跨年周轮换、规则优先级、节假日解析及下一次提醒推算。原生冒烟测试在隔离配置的真实 WebView 中验证排期保存、文件导入预览与确认、休假抑制提醒、补班触发提醒及冷启动恢复。其他界面操作通过本地应用端到端验收；Linux CI 使用 Xvfb 和 Openbox。
