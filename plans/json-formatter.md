# JSON 格式化插件

## Context

需要一个 Leap 插件：搜索进入后显示一个文本框，粘贴 JSON 文本即自动缩进对齐格式化。

仓库 `/Users/wyq/Work/Project/2026/LeapPlugins` 现有 `plugins/shell-runner`、`plugins/shutdown` 都是 `presentation: "list"`（宿主单行搜索栏 + 宿主绘制列表）。
按 `v0.0.2` 的 `Docs/PluginDevelopment.md`，**原生列表不提供多行文本框**，只有网页（`presentation: "web"` 内嵌 / 无 presentation 的独立窗口）能自绘 `<textarea>`。
所以本插件是 **JavaScript + 内嵌网页**。

用户已确认（本轮问答）：

- 承载方式：**内嵌网页**（`presentation: "web"`，宽度跟随宿主，不弹独立窗口）。
- 格式化落点：**就地替换**文本框内容；非法 JSON 保留原文。
- Enter：**什么都不做**（textarea 正常换行，不注册 `window.leap.onSubmit`）。
- 附加：**一键复制按钮** + **从剪贴板自动填充**。

参考资料（读自 `v0.0.2` tag）：`Docs/PluginDevelopment.md`、`Examples/Plugins/WebEcho`（最小内嵌网页）、`Examples/Plugins/HostAPI`（`window.leap` 系统 API 用法）。

## Approach

- 新插件目录 `plugins/json-formatter/`，自包含。
- `manifest.json`：`presentation: "web"` + `webEntry: "index.html"`，`input: { enabled: false }`（网页自己画文本框），不声明 `webWindow`（未配置时内嵌网页按 600 高度参考）。
- 页面结构：`<textarea>` 占满主体 + 底部一行状态文本 + 「格式化」「复制」「压缩」按钮（复制为用户要求，格式化为粘贴失效时的兜底，压缩保持最小、一行）。
- 接事件：`paste` 事件（DOM 层，粘贴后立即读值）触发格式化；**不做逐键格式化**，否则用户一开始输入 `{` 就会报错、且会打断编辑。剪贴板按钮/自动填充也走同一套格式化函数。
- 纯逻辑放在 `plugins/json-formatter/format.js`：
  - `format(text)`：`JSON.parse` → `JSON.stringify(value, null, 2)`；已是格式化结果时返回原文（避免无谓改动光标）。
  - `parseError(error)`：从 V8 的 `Unexpected token } in JSON at position 12` 里取出 `position`，换算成 `行:列` 给用户看。
  - `minify(text)`：`JSON.stringify(JSON.parse(text))`。
- 剪贴板自动填充：网页没有读剪贴板文本的 API（`leap.d.ts` 只有 `copyText` / `getCopyedFiles`），所以由 Node 入口读：
  - `main.js` 的 `leap.onInvoke(({ commandID, query }))`：`query === 'clipboard'` 时用 `execFile('/usr/bin/pbpaste')` 返回剪贴板文本；其他 query 返回格式化结果（网页当前不依赖它，留作入口可用性兜底）。
  - 网页 `onEnter` 时若文本框为空，`window.leap.invoke('json-format.run', 'clipboard')` 取文本，`JSON.parse` 通过才填入并格式化；不通过则静默不填，状态行写「剪贴板中没有可用的 JSON」。
- 复用现有仓库约定：`jsconfig.json`、`leap.d.ts` 直接从 `plugins/shutdown/` 复制；`icon.png` 用 PIL 脚本生成 1254×1254（与另两个插件同尺寸），画圆角方块 + `{}` 字形，深色/浅色都看清。
- 样式：`system-ui` / `ui-monospace`、`color-scheme: light dark`、圆角、`body { margin: 0 }` 让 textarea 填满 WKWebView。

## Files to modify

新增（全部在 `plugins/json-formatter/`）：

- `manifest.json`
- `index.html`（UI + 事件绑定）
- `format.js`（纯逻辑，浏览器全局 + Node 可测）
- `main.js`（`onInvoke`：读剪贴板 / 兜底格式化）
- `icon.png`
- `README.md`
- `leap.d.ts`、`jsconfig.json`（复制自 `plugins/shutdown/`）

修改：

- `README.md`（根，插件表格加一行「JSON 格式化」）
- `tests/json-formatter.test.cjs`（新增测试，见下）

## Reuse

- `tests/plugins.test.cjs` 已自动遍历 `plugins/`：要求 `runtime === "javascript"`、`minimumHostVersion === "0.0.2"`、入口/图标在目录内、目录内无符号链接 —— 新插件自动被覆盖，不改它。
- `tests/shutdown.test.cjs` 的 `vm` + 桩 `leap` 加载入口写法，用于测 `main.js` 的 `onInvoke` 分派与 `pbpaste` 失败分支。
- `plugins/shutdown/leap.d.ts`、`plugins/shutdown/jsconfig.json` 原样复制。

## Steps

- [x] `manifest.json`：`id: com.padding.leap.json-formatter`、`name: JSON 格式化`、`version: 1.0.0`、`minimumHostVersion: "0.0.2"`、`runtime: javascript`、`entry: main.js`、`webEntry: index.html`、`icon: icon.png`；命令 `json-format.run` / 标题「JSON 格式化」/ `mode: interactive` / `presentation: web` / `input: {enabled: false}` / `keywords: ["json", "格式化", "format", "美化", "minify"]`
- [x] `format.js`：`format` / `minify` / `parseError`，通过 `(function (root) { ... root.JSONFormat = {...} })(typeof window === 'undefined' ? globalThis : window)` 同时供页面和测试使用
- [x] `index.html`：textarea、状态行、三个按钮；`paste` 与按钮都调用同一 `applyFormat()`；格式化失败只在状态行显示 `第 X 行 Y 列：<错误>`，不覆盖原文；复制按钮在无合法内容时禁用
- [x] `main.js`：`onInvoke` 按 `query === 'clipboard'` 读 `pbpaste`，其余返回格式化结果；`pbpaste` 失败抛中文错误
- [x] `icon.png`：PIL 生成脚本跑一次，输出到目录内
- [x] `leap.d.ts`、`jsconfig.json` 复制
- [x] `README.md`：用法（搜索标题、粘贴即格式化、Enter 换行、复制/压缩按钮、剪贴板自动填充）、错误提示行为、参考 Leap 版本 0.0.2
- [x] 根 `README.md` 表格加一行
- [x] `tests/json-formatter.test.cjs`：`format`/`minify`/`parseError` 的合法、已格式化、非法、空输入；`main.js` 的 clipboard 分派与失败分支

## Verification

- `node --check plugins/json-formatter/main.js plugins/json-formatter/format.js`
- `python3 -c "import json;json.load(open('plugins/json-formatter/manifest.json'))"`
- `node --test tests/`（含公共清单校验 `plugins.test.cjs`）
- 手动：Leap 设置 → 安装插件 → 从本地目录安装 `plugins/json-formatter` → 搜索「JSON 格式化」→ 粘贴 `{"a":1,"b":[1,2]}` 应立刻缩进；粘贴 `{a:1}` 应保留原文并提示行列；点复制后到别处粘贴验证；先在别处复制一段 JSON 再进入插件，应自动填入并格式化；Enter 只换行。

## 结果

已实现并静态验证：

- `node --check plugins/json-formatter/main.js`、`format.js` 通过；`manifest.json` 可解析。
- `node --test tests/` 29 项全通过（含新增 `tests/json-formatter.test.cjs` 5 项与公共清单校验）。
- 用 Chrome headless 加载 `index.html`（桩 `window.leap`）实测：粘贴格式化、非法 JSON 保留原文并提示「第 X 行第 Y 列」、剪贴板自动填充、复制按钮启用/禁用状态。
- 未在 Leap 内实测：需手动“从本地目录安装” `plugins/json-formatter`。

与计划的两处偏差：`parseError` 只在解析器给出字符位置时才附行列，因为 WKWebView 的 JavaScriptCore 只报原因、不带 `position N`；`main.js` 的非 clipboard 查询按计划「返回格式化结果」实现（对合法 JSON 缩进，非法则报中文错误）。
