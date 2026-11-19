# 安卓桌面小组件（待实现）

> 状态：设计已确认方向，尚未开发。后续有空按本文档的清单实现。

## 目标

在安卓桌面提供 Shui 的饮水小组件，围绕「今日进度 + 快捷记录 + 下一杯」三件事，复用今日页与通知栏已有的口径，不引入第二套数据来源。

## 设计稿

三档尺寸，主推 4×2：

| 尺寸 | 内容 | 定位 |
|---|---|---|
| **4×2**（主推） | 进度环 + 今日总量 / 目标 + 下一杯时间 + `+50/+100/+200` | 信息完整 |
| **2×2** | 大进度环 + 总量 / 目标 + 下一杯时间 | 只占一格，看进度 |
| **4×1** | 水滴图标 + 总量 + 细进度条 + `+100/+200` | 极简横条，不挡桌面 |

视觉要点：

- 品牌水蓝：亮色 `#0EA5E9`，深色 `#38BDF8`；进度环轨道用中性灰。
- 达标时环变绿（`#10B981`）并显示「已达成」徽章。
- 小组件跟随**系统**深浅色，而不是 App 内手动选择的主题——App 深色 + 系统浅色时，桌面仍显示浅色。
- 圆角、间距、字号按启动器实际 dp 适配（4×2 ≈ 250×110dp），预览图需提供 `targetCellWidth/Height`。

## 状态与边界

- 三种主状态：进行中 / 已达标 / 提醒已暂停（灰环 + 「已暂停」）。
- 跨天：快照带 `dateKey`，零点后首次渲染自动归零，不依赖闹钟。
- 点击区域：整卡点击进今日页；`+` 按钮只记录，不拉起 App。
- 未设置目标：显示「先设置每日目标」入口，不显示 0/0。

## 数据与刷新

必须遵守项目已有的硬约束：**小组件不自己算下一次提醒时间**，只展示原生已排定的绝对时间。

1. 快照：Rust 侧在记录饮水、保存配置、drain 通知记水后，把以下字段写入 SharedPreferences（或 `app_data_dir/widget_snapshot.json`）：

   ```json
   {
     "dateKey": "20261118",
     "todayTotal": 1200,
     "goal": 1600,
     "nextAt": 0,
     "paused": false,
     "goalReached": false,
     "streak": 0
   }
   ```

   `nextAt` 取原生 `ReminderScheduler.nextReminderAt()` 的绝对时间戳，与今日页「预计下一杯」同源。

2. 刷新：仅在记录饮水、配置变更、跨天三个时机调用 `AppWidgetManager.updateAppWidget()`，**不做定时轮询**。

3. 快捷按钮：
   - 点击后写入现有 `pending_drinks.json` 队列（与通知栏 Action 同一套结构），并做本地乐观累加，界面立即 +N。
   - Rust 的 `drain_pending_drinks` 落库后写新快照，小组件再对齐。
   - **已知取舍**：App 进程完全被杀时，点击只能排队，下次打开 App 才真正入库。推荐保持此行为（不拉起界面）；若要即时入库，需按钮拉起 App，代价是界面闪一下。

4. 实现方式：传统 `RemoteViews` + Kotlin 侧 `Canvas.drawArc` 自绘进度环 Bitmap，不引入 Glance / Compose，控制包体与 ROM 兼容性。快捷按钮用 `PendingIntent` 指向 `BroadcastReceiver`，复用静默写队列逻辑。

## 待确认（实现前先定）

- [ ] 默认主推尺寸：4×2 / 2×2 / 4×1（建议 4×2，其余同时提供）
- [ ] 快捷水量：固定 `50/100/200`（与通知栏一致）还是 `50/100/200/300`（与今日页一致）
- [ ] 是否显示连续打卡天数（「连续 N 天」）
- [ ] 4×1 是否保留 `+` 按钮，或只做纯展示
- [ ] 达标后环是否封顶 100%（建议封顶 + 绿色对勾，不显示 120%）

## 实现清单

- [ ] 定稿上述 5 个待确认项
- [ ] 定义小组件快照结构，Rust 侧在记录 / 保存配置 / drain 后的统一出口写快照
      （参考 `src-tauri/src/mobile.rs` 的 `schedule_payload`、`reanchor_after_drink`、`drain_pending_drinks`）
- [ ] 新增 `DrinkWidgetProvider`（AppWidgetProvider）+ `widget_info.xml` + 三档布局与预览图
- [ ] 自绘进度环 Bitmap（含达标绿、暂停灰、深色适配）
- [ ] 快捷按钮 `BroadcastReceiver`：写 `pending_drinks.json` + 本地乐观累加 + 触发刷新
- [ ] 整卡点击跳今日页；跨天自动归零
- [ ] 在 `AndroidManifest.xml` 注册 provider（含 `android:exported="false"` 与 `APPWIDGET_UPDATE`）
- [ ] 设置页「快捷方式」补一条添加指引（长按桌面 → 小组件 → 找到 Shui）
- [ ] 验收：记录饮水后 1 秒内小组件同步；杀进程后点 `+` 再打开 App 能正确补记；零点后归零；深浅色与三种状态显示正确

## 相关文件

- 原生通知与静默记账：`src-tauri/gen/android/app/src/main/java/com/shui/app/ReminderReceiver.kt`
- 原生插件（配置快照 / 排期）：`src-tauri/gen/android/app/src/main/java/com/shui/app/ReminderPlugin.kt`
- Rust 侧 Android 桥接与 pending 队列：`src-tauri/src/mobile.rs`
- 今日页视觉参考：`src/components/mobile/today-tab.tsx`
