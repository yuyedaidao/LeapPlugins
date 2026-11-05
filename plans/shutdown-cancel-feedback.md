# 关机插件：取消定时关机后的收尾反馈

## Context

现象（用户实测）：在「关机」插件列表里选中「取消定时关机」后，**界面上没有任何可感知的变化**——列表还是那一行（仍写着「将于 16:30 关机（剩余 9 分钟）」），输入框仍聚焦、光标还在，看不出到底取消了没有。

用户已确认：列表下方那行小字「已取消定时关机（原定 16:30）。」**确实出现过**。所以反馈机制是通的，问题在于：一行小字太弱，而它下方的列表项仍是过时且可再次回车的状态，两者互相抵消；成功后的收尾又与本插件其它动作不一致。用户已选定方案 A（取消成功后收起启动器 + 系统通知）。

宿主的实际行为（`Sources/Leap/PluginInteractionView.swift`、`Sources/LeapCore/PluginListSession.swift`）：

- `PluginListSession.select()` 取回 `onSelect` 返回的字符串后 `display()` → `message`，由 `PluginResultList` 渲染成列表下方一行小字（`plugin.listFeedback`，`PluginInteractionView.swift:100-106`）。
- 选中成功后**不会重新查询列表**：`select()` 末尾只调用 `startQueryIfReady()`，而 `queryReady` 只在 `updateInput()`（用户改输入）时置位。`setList` 也只存在于 `onInputChange` 的回调参数里（`Resources/Leap/PluginSDK/bootstrap.cjs:126-145`，`select` 分支没有 `setList`）。
- 结论：**宿主没有从 `onSelect` 刷新列表的 API**，所以「保持窗口但让列表变成『当前没有定时关机任务』」在当前宿主上做不到；能做的只有「收起窗口」或「显示一行反馈文字」。
- 另外 `PluginInteractionView` 的输入框在选中后并不会失焦，所以「聚焦到输入框」实际上是一个空操作（焦点本来就在），这也是「没有任何反应」的直接来源。

所以问题不是逻辑错了（取消确实执行了、状态文件已删、进程已杀），而是**成功后没有任何明确、不可错过的收尾**：一行小字 + 一行过时且仍可再按的列表项。

## 方案对比

| 方案 | 用户感知 | 代价 |
| --- | --- | --- |
| A. 取消成功后收起启动器 + 系统通知（**用户已选**） | 窗口消失 = 动作生效；通知写明「已取消定时关机（原定 16:30）」 | 每次取消一条通知 |
| B. 取消成功后收起启动器，不发通知 | 窗口消失即反馈；重开插件能看到「当前没有定时关机任务」 | 没有文字确认，容易怀疑是否点错 |
| C. 保持窗口，只靠列表下方反馈文字（现状） | 反馈弱且与过时列表项矛盾，可重复回车 | 无 |
| D. 保持窗口并就地刷新列表 | 最好 | **宿主无 API，做不到**（见上）；要改 Leap 宿主，超出本仓库范围 |

与本插件其它动作保持一致也很重要：**立即关机**和**定时安排**成功后都会 `hideMainWindow()`（`plugins/shutdown/main.js` 的 `shutDownNow` / `schedule`）。只有取消留在原地，是不一致的那一个。而通知也已有先例：安排成功会发「已安排在 … 关机」。

## Approach（方案 A，用户已确认）

1. `cancelSchedule()`：真正取消了任务（或清理了失效记录）时，先发通知，再 `hideMainWindow()`，与 `schedule()` 的收尾顺序一致（先通知后隐藏，避免会话先被关掉）。
2. 没有任务可取消时：**不收起窗口**，只返回「当前没有定时关机任务。」——列表项本身已经写着「当前没有定时关机任务」，这是一次空操作，关掉窗口反而突兀。（若用户希望这里也收起，改一行即可。）
3. 返回值仍然给出文字，作为宿主能渲染时的额外反馈；不影响通知与收起。
4. README 补一句取消后的表现（收起 + 通知），避免用户以为没生效。

## Files to modify

- `plugins/shutdown/main.js` — `cancelSchedule()` 的收尾（notify + hide），`stop()` 语义不变。
- `tests/shutdown.test.cjs` — 取消成功的用例补断言：`hide` 调用一次、通知文本匹配；无任务用例断言**不**收起、不发通知；失效记录用例确认清理并收起。
- `plugins/shutdown/README.md` — 「取消」一行补充：成功后收起 Leap 并发通知。

## Reuse

- `notify(body)`、`hide()`、`clock(date)`、`label(minutes)`：`plugins/shutdown/main.js` 里已有，取消路径直接复用。
- `schedule()` 里「先 `notify` 后 `hide`」的顺序：直接照搬，保证宿主在 `hideMainWindow` 之后不再执行后续 RPC。
- 测试假宿主 `load()`：`tests/shutdown.test.cjs` 里已有 `calls.hide` / `calls.notify` 计数，无需新装置。

## Steps

- [x] 1. `cancelSchedule()` 成功分支改为 `await notify(...)` + `await hide()`，返回文案保持「已取消定时关机（原定 …）」；失效记录分支同样收起，通知文案区分（「定时关机已失效」）。
- [x] 2. 无任务分支保持不变（不收起、不通知）。
- [x] 3. 更新 `tests/shutdown.test.cjs` 三个取消相关用例的断言。
- [x] 4. `node --test tests/*.test.cjs` 全绿。
- [x] 5. 更新 `plugins/shutdown/README.md` 的取消说明。
- [ ] 6. 重装插件实测：安排 30 分钟 → 重开插件选「取消定时关机」→ 窗口收起 + 通知 → 再开插件确认列表显示「当前没有定时关机任务」。

## Verification

- 单测断言：取消成功后 `calls.hide === 1`、`calls.notify[0]` 匹配 `/^已取消定时关机（原定 .*）。$/`、状态文件已删、`process.kill(-pid)` 恰好一次。
- 无任务时：`calls.hide === 0`、`calls.notify.length === 0`，返回「当前没有定时关机任务。」。
- 手动：`ps` 确认定时进程已消失，`~/Library/Application Support/Leap/PluginData/com.padding.leap.shutdown/state.json` 不存在。
