# JSON 格式化插件：记住上次格式化结果

## Context

`plugins/json-formatter` 现在是「进入时若文本框为空、且剪贴板里是合法 JSON，就自动填入并格式化」。剪贴板里没有可用 JSON 时，文本框留空，状态栏提示「剪贴板中没有可用的 JSON」，用户什么都拿不到。

需求：把**最后一次格式化出来的字符串**存下来；下次进入时如果剪贴板里没有可用的 JSON，就恢复上次保存的内容，用户一进来就有东西可以继续改。

用户已确认（本轮问答）：

- 保存时机：**每次格式化成功就保存**（粘贴、格式化、压缩、从剪贴板/参数填入都算）。
- 回退条件：剪贴板**为空或没有合法 JSON**时都恢复上次内容。
- 存储位置：**宿主数据库 `leap.db`**（`~/Library/Application Support/Leap/PluginData/com.padding.leap.json-formatter/db/`），单文档上限 1MB，写入带 `_rev` 版本校验。

## 现状要点（已读代码）

- `index.html` 只有一个自动填充入口 `fillFromClipboard()`：`window.leap.invoke('json-format.run', 'clipboard')` → `main.js` 用 `/usr/bin/pbpaste` 读剪贴板 → 能 parse 才填入。
- `main.js` 的 `leap.onInvoke` 只做两件事（读剪贴板 / 兜底格式化），**本次不需要改**。
- 页面里产生/确认格式化结果的地方：`apply(transform, done)`（粘贴、格式化、压缩共用）、`fillFromClipboard()`、`fillFromQuery()` 的成功分支。
- 宿主网页 SDK **已经提供 `window.leap.db`**：`Resources/Leap/PluginSDK/web.js:72` 把 `host-api.js` 的 `db` 合进 `window.leap`，实现为 `dbPut/dbGet/dbAllDocs/dbRemove`（`Sources/LeapCore/PluginHostAPI.swift:233-242`）。`db.get` 不存在时返回 `null`；`db.put` 更新已有文档必须带正确 `_rev`，否则报「数据库文档版本已变化，请重新读取后更新。」；超限报「单个数据库文档不能超过 1MB。」。
- 插件内的 `plugins/json-formatter/leap.d.ts` 是从旧版复制的，**缺 `db`/`runPlugin`**（宿主版 `Resources/Leap/PluginSDK/leap.d.ts` 有）。`jsconfig.json` 开了 `checkJs`，不补类型会报错。
- `JSFormat` 纯逻辑在 `format.js`，`tests/json-formatter.test.cjs` 用 `vm` 加载它和 `main.js`（无 DOM 环境）。

## Approach

页面侧改动为主，`main.js` 不动。

1. **抽一个可测的纯函数**放进 `format.js`：`chooseInitial({ query, clipboard, saved })` → `{ source, text }`，
   优先级 `query` > 剪贴板合法 JSON > `saved` > `none`。这次的新分支（回退判定）落在它里面，测试能直接断言；
   排版/状态栏文案仍留在页面。

2. **页面保存**（`index.html`）：新增 `remember(text)`，在 `apply()` 成功路径、`fillFromClipboard()`、`fillFromQuery()` 成功路径调用。
   - 文档形如 `{ _id: 'last-output', text, savedAt }`；`savedAt` 用 `Date.now()`，只在状态栏显示恢复时间。
   - `savedRev` 在页面启动 `loadLast()` 时拿到，后续 put 带上；put 失败且错误信息含「版本」时，`db.get` 刷新一次 `rev` 后重试一次。
   - 超过 1MB 或其它错误：静默放弃（`leap.log` 记一行），不打扰用户，不阻断格式化。

3. **页面恢复**（`index.html` 的 `onEnter`）：
   - `context.query` 非空 → 走现有 `fillFromQuery()`，行为不变。
   - 否则并行取剪贴板文本（失败当空）与 `loadLast()`，交给 `chooseInitial`：
     - `clipboard` → 现有「已从剪贴板填入并格式化」；
     - `saved` → 直接填回已格式化的原文（不再改写内容），状态栏「已恢复上次内容」+ 上次保存时间；
     - `none` → 保持「粘贴 JSON 后自动格式化」。
   - `loadLast()` 吞掉异常返回 `null`（宿主不支持 db 时退化成现在的行为）。

4. **类型**：`plugins/json-formatter/leap.d.ts` 补 `LeapDbDoc` / `LeapDbResult` / `LeapDatabase` 与 `readonly db: LeapDatabase`
   （照抄宿主 `Resources/Leap/PluginSDK/leap.d.ts` 的定义）。

5. **版本与索引**：`manifest.json` 版本 `1.1.1` → `1.2.0`，重跑 `node Scripts/build-index.mjs` 更新 `store.json`（生成物，不手写）。

## Files to modify

- `plugins/json-formatter/format.js` — 加 `chooseInitial`
- `plugins/json-formatter/index.html` — `remember()` / `loadLast()` / 新的进入流程与状态栏文案
- `plugins/json-formatter/leap.d.ts` — 补 `db` 类型
- `plugins/json-formatter/manifest.json` — 版本 `1.2.0`
- `store.json` — 由 `Scripts/build-index.mjs` 重新生成
- `plugins/json-formatter/README.md` — 用法/实现/权限（多了插件数据库）说明
- `README.md`（根）— 权限表「JSON 格式化」一行补「写插件数据库」
- `tests/json-formatter.test.cjs` — `chooseInitial` 的优先级与回退用例

## Reuse

- `window.leap.db`（`Resources/Leap/PluginSDK/host-api.js:38-53`）：`put/get`，不新增存储代码、不自己写文件。
- `plugins/json-formatter/format.js` 现有的 `format` / `parseError`：恢复与填入仍用同一套判断。
- `plugins/json-formatter/main.js` 的 `query === 'clipboard'` 分派：剪贴板读取完全复用，不改。
- `Resources/Leap/PluginSDK/leap.d.ts`：db 类型定义直接搬。
- `Scripts/build-index.mjs --check`：CI/测试已断言索引与清单一致。

## Steps

- [x] `format.js`：加 `chooseInitial({ query, clipboard, saved })`（返回值 `{ source, text }`；`clipboard`/`saved` 判空与 `JSON.parse` 校验复用现有写法）
- [x] `index.html`：加 `savedRev`、`remember(text)`、`loadLast()`；`apply`/`fillFromClipboard`/`fillFromQuery` 成功路径调 `remember`
- [x] `index.html`：`onEnter` 改为 query → `chooseInitial` 分派，三种状态栏文案
- [x] `leap.d.ts`：补 db 类型
- [x] `manifest.json` 升到 `1.2.0`，`node Scripts/build-index.mjs`
- [x] 更新两个 README（用法、实现、权限表）
- [x] `tests/json-formatter.test.cjs` 补 `chooseInitial` 用例
- [x] `node --test tests/*.test.cjs` + `node Scripts/build-index.mjs --check`

## Verification

自动化：

```sh
node --test tests/*.test.cjs
node Scripts/build-index.mjs --check
```

手动（Leap 内重新安装本插件目录后）：

1. 进入插件，粘贴一段 JSON → 自动格式化 → Escape 退出。
2. `printf '' | pbcopy`（清空剪贴板）→ 再进插件 → 文本框是上次格式化后的内容，状态栏显示「已恢复上次内容」+ 时间。
3. 剪贴板换成一段非 JSON 文本（如 `hello`）→ 再进 → 同样恢复上次内容，不出现旧的「剪贴板中没有可用的 JSON」占位空框。
4. 剪贴板换成另一段合法 JSON → 再进 → 优先用剪贴板内容（恢复让位）。
5. 点「压缩」后退出再进 → 恢复的是压缩后的单行内容（保存的是最后一次成功结果）。
6. 贴一段**非法** JSON → 退出再进 → 恢复的仍是一张合法的旧内容（失败不覆盖保存）。
7. 查看 `~/Library/Application Support/Leap/PluginData/com.padding.leap.json-formatter/db/last-output.json` 存在且内容为最后一次结果。
8. 超过 1MB 的 JSON：格式化照常，恢复内容为之前的较旧结果，页面无报错。

已知限制（需要写进 README）：只保留**最近一次**，上限 1MB（宿主文档限制），超限不保存；数据在插件数据目录，卸载插件后随目录一起清掉。
