# 关机插件（macOS）实现计划

> 已执行完毕的计划存档。文中写的 `minimumHostVersion: 1.2.0` 是当时的错误取值：宿主版本以 App 的 `CFBundleShortVersionString` 为准（当时为 0.0.2），两个插件的清单现已统一为 `0.0.2`。

## Context

需要一个 Leap 插件：搜索「关机」进入后，可立即关机、N 分钟后 / N 小时后定时关机、取消定时关机。
macOS 关机要么 root（`shutdown -h`，需要 sudo 密码），要么 Apple Events。用户已确认走 **AppleScript 免密码**
（`osascript -e 'tell application "System Events" to shut down'`），首次使用需在「系统设置 → 隐私与安全性 → 自动化」允许 Leap 控制 System Events
（Leap 的 `Info.plist` 已声明 `NSAppleEventsUsageDescription`，`Project.swift:35`）。

仓库：`/Users/wyq/Work/Project/2026/LeapPlugins`（public，main 分支）。已有 `plugins/shell-runner` 作为 JavaScript 原生列表插件范例，
`tests/plugins.test.cjs` 自动遍历 `plugins/` 校验清单：**要求 `runtime === "javascript"`、`minimumHostVersion === "1.2.0"`**、
入口/图标必须在插件目录内、目录内不得有符号链接。

用户已确认：列表 + 输入时长；AppleScript 免密码；要生成 `icon.png`；安排成功后发系统通知。

## 交互设计

命令「关机」：`mode: interactive`、`presentation: list`、输入框开启，placeholder
`输入分钟或小时，如 30、30分钟、1.5h；留空立即关机`。

| 输入 | 列表 |
| --- | --- |
| `""` | `立即关机`（描述：立即执行，没有确认步骤）；`取消定时关机`（有安排时描述 `将于 21:30 关机（剩余 12 分钟）`，无安排时 `当前没有定时关机任务`） |
| `30` | `30 分钟后关机`，描述 `21:30` |
| `30分钟` / `30m` / `1.5h` / `2小时` / `1小时` | 按单位换算成分钟（默认分钟），描述是绝对时间 |
| `0` / `0分钟` | `立即关机` |
| `取消` / `cancel` / `off` | `取消定时关机` |
| 其他 | 抛中文错误：`无法识别的时长，可输入 30、30分钟、1.5h 或「取消」。` |
| 超过 7 天 | 抛错：`最长支持 7 天。` |

解析只支持单个数值 + 单位（不做 `1小时30分` 复合写法），`1天`、`90s` 之类一律报错，README 写清楚。

## 实现要点（`plugins/shutdown/main.js`）

- 统一走一个 `launch(fireAt)`：`spawn('/bin/zsh', ['-l', '-c', script], { detached: true, stdio: ['ignore', fd, fd] })` + `unref()`，
  与 `plugins/shell-runner/main.js:40-52` 相同机制，Leap 退出后任务继续存活。

  ```zsh
  # leap-shutdown <fireAt ISO> <uuid>      ← 注释里带唯一 token，供取消时校验
  /usr/bin/osascript -e 'tell application "System Events" to return name of first process' >/dev/null 2>&1
  while [ "$(/bin/date +%s)" -lt <fireAtEpoch> ]; do /bin/sleep 10; done
  exec /usr/bin/osascript -e 'tell application "System Events" to shut down'
  ```

  - 用绝对时间轮询而不是 `sleep N`：系统休眠不推进 `sleep`，会晚关机；10 秒轮询足够准，也顺带让取消窗口覆盖休眠。
  - 首行那次无害的 System Events 读取把**授权弹窗提前到安排时**，避免 21:30 到点才静默失败（输出丢弃，不打扰）。
- 立即关机 = `fireAt` 已过（`minutes < 1` 归一化为立即），同一路径、不写状态文件；随后 `hideMainWindow()`。
- 定时：先取消已有安排（若存在，替换而不是叠加），再写状态文件
  `${userData}/PluginData/com.padding.leap.shutdown/state.json`：`{ pid, fireAt, minutes, token }`（目录 `0700`、文件 `0600`）。
- 取消：读状态 → `ps -p <pid> -o command=` 输出必须包含 `token`（防 PID 复用误杀）→ `process.kill(-pid, 'SIGTERM')`
  （detached 子进程是进程组组长，负 PID 连 `sleep` 一起终止）→ 删除状态文件 → 返回 `已取消定时关机（原定 21:30）。`。
  进程不存在或命令不含 token → 清掉状态，返回 `定时关机已失效，记录已清理。`；没有状态 → `当前没有定时关机任务。` 不报错。
- 通知：安排/立即关机成功后 `await leap.showNotification('已安排在 21:30 关机（30 分钟后）')`，用 `try/catch` 包住并只记日志，
  通知权限被拒不能算关机失败（`PluginHostAPI.swift:419-423` 在未授权时抛错）。
- 日志：`~/Library/Logs/Leap/shutdown/<时间>-<uuid>.log`，`0700/0600`，记录启动时间、PID、fireAt、osascript 输出。
- 防重复提交：`busy`/`launched` 标志，沿用 shell-runner 的写法（窗口收起失败后重复回车不重复安排）。
- select 里按 `parse(text)` 重新解析（不信任列表项里缓存的时长），`kind === 'menu'` 时才用 `item.id`。

## Files

- 新增 `plugins/shutdown/manifest.json`：`id: com.padding.leap.shutdown`、`name: 关机`、`version: 1.0.0`、
  `minimumHostVersion: 1.2.0`、`runtime: javascript`、`entry: main.js`、`icon: icon.png`，
  命令 `{ id: "shutdown.run", title: "关机", mode: "interactive", presentation: "list", input: { enabled: true, placeholder }, keywords: ["关机","定时关机","shutdown","power off"] }`
- 新增 `plugins/shutdown/main.js`
- 新增 `plugins/shutdown/leap.d.ts`、`plugins/shutdown/jsconfig.json`（照抄 shell-runner，仓库约定）
- 新增 `plugins/shutdown/README.md`（安装、用法、权限、日志、限制、图标生成记录）
- 新增 `plugins/shutdown/icon.png`（imagegen 生成，缩放到 1024×1024）
- 新增 `tests/shutdown.test.cjs`
- 更新仓库 `README.md` 插件表格

## Reuse

- `plugins/shell-runner/main.js`：detached spawn + `unref` + 日志文件（`mkdir 0700` / `open 'wx' 0600`）+ `hideMainWindow` + 重复提交保护。
- `plugins/shell-runner/leap.d.ts`、`plugins/shell-runner/jsconfig.json`：SDK 类型提示、编辑器配置。
- `plugins/shell-runner/README.md`：README 结构与「图标生成记录」写法。
- `tests/shell-runner.test.cjs`：`vm.runInNewContext` + 假 `leap`/假 `require` 的加载器（直接改造复用）。
- `leap.getPath('userData')`（`PluginHostAPI.swift:294`）指向 `~/Library/Application Support/Leap`，与 `PluginData/com.padding.leap.clipboard` 同级约定一致。

## Steps

- [x] 写 `manifest.json`、`leap.d.ts`、`jsconfig.json`
- [x] 实现 `parse(text)` 与列表生成（预设、时长、取消、错误、7 天上限）
- [x] 实现 `launch(fireAt)`（日志、detached zsh 脚本、spawn 成功后才继续）、立即关机、定时安排（替换旧安排）、通知
- [x] 实现状态文件读写与取消（`ps` token 校验 + 进程组 SIGTERM + 清理）
- [x] 写 `tests/shutdown.test.cjs`：解析（空/数字/`30分钟`/`1.5h`/`2小时`/`0`/`取消`/非法/超上限）、
      空输入列表与 cancel 描述、定时 spawn 参数（`detached`、脚本含 fireAt 与 token、无 `signal`）、状态写入、
      立即关机不写状态、取消成功（kill 负 PID + unlink）、过期/不含 token 的取消、重复提交、spawn 失败释放句柄并报错
- [x] `node --test tests/*.test.cjs`
- [x] 生成图标，写插件 README，更新仓库 README 表格
- [ ] 手动安装到 Leap 实测

## Verification

- `node --test tests/*.test.cjs` 全绿（含 `tests/plugins.test.cjs` 的清单/图标校验）。
- 手动：设置 → 插件 → 从本地目录安装 `plugins/shutdown`；搜「关机」→ 输入 `1分钟` → 列表出现「1 分钟后关机」→ Enter →
  弹出自动化授权 → 允许，收到「已安排在 HH:mm 关机」通知，Leap 收起；再次搜「关机」→ 空输入看到「将于 HH:mm 关机（剩余 …）」→
  选取消 → `ps -p <pid>` 确认 zsh 进程已消失，到点不再关机。
- 立即关机：空输入选「立即关机」，机器真的关机（最后一次实测）。
- 日志与权限：拒绝自动化授权后查看 `~/Library/Logs/Leap/shutdown/*.log` 中的 osascript 报错，README 给出修复步骤。
