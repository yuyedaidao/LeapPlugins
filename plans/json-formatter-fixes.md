# JSON 格式化插件：中文乱码 + 页面横向拖动

## Context

用户反馈 `plugins/json-formatter` 两个问题：

1. 剪贴板自动填入的中文显示乱码。
2. 网页整体能轻微左右拖动（松手复位），期望只有输入框内容在不够宽时才横向滚动。

两处都在插件内，宿主不用改。

### 问题 1 根因（已用实验确认）

`main.js` 的 `readClipboard()` 用 `execFile('/usr/bin/pbpaste', { encoding: 'utf8' })`，**没有传 `env`**，子进程继承宿主进程的环境。

- Leap 宿主的插件进程在 `Sources/LeapCore/PluginProcessSession.swift:88` 只设置 `executableURL/arguments/currentDirectoryURL/stdio`，**不设置 `process.environment`**，所以继承 `/Applications/Leap.app` 的环境；`launchctl getenv LANG` / `LC_ALL` 都为空，即进程没有 locale。
- `pbpaste` 在没有 locale 时按 GBK 输出字节，Node 按 UTF-8 解码 → `{"名称":"中文测试"}` 变成 `{"����":"���Ĳ���"}`。

实测（`/tmp/pbtest.js`，先 `printf '{"名称":"中文测试"}' | pbcopy`）：

| 调用方式 | 结果 |
| --- | --- |
| `env -i node pbtest.js`（模拟宿主） | 乱码 |
| `execFile('/usr/bin/pbpaste', { env: { PATH: '/usr/bin:/bin' } })` | 乱码 |
| 加 `LC_ALL=en_US.UTF-8` / `LANG=zh_CN.UTF-8` / `LC_CTYPE=UTF-8` | 正常 `{"名称":"中文测试"}` |

把 `env -i pbpaste` 的输出 `iconv -f GBK -t UTF-8` 能完整还原，确认是 pbpaste 的 locale 导致的编码，不是页面或文件编码问题。页面本身正常（`document.characterSet` 为 `UTF-8`，按钮/占位文字都是正确中文），乱码只出现在剪贴板这条路径。

**注意**：修复不能写成 `env: { ...process.env, LC_ALL: ... }`。`tests/json-formatter.test.cjs` 用 `vm.runInNewContext` 加载 `main.js`，沙箱里只有 `{ leap, require }`，**没有 `process`**，会直接 `ReferenceError`。

### 问题 2 根因

页面把滚动权交给了文档本身：`html`/`body` 默认 `overflow: visible`，WKWebView 的文档滚动就是那个"轻微左右拖动、松手回弹"的橡皮筋。textarea 自己的 `overflow: auto` 已经能横向滚长行，文档层不需要这份能力。

用 WKWebView 加载 `index.html` 实测（宽 500–782，含超长中文与长状态栏）：`documentElement.scrollWidth == clientWidth`、`body`/`footer` 同；`#status` 有 `min-width: 0` 不会撑宽。也就是说布局本身不溢出，能拖动的只有文档级 overscroll —— 所以把文档层滚动关掉即可，不会影响可见布局。

> 风险：这一条是静态实测 + CSS 推断，没有在真实 Leap 里做事件级复现（模拟横向滚动滚轮的 swift 实验被工具确认提示拦下）。若改完仍能拖动，退路是给 `#status` 加 `min-width: 0` 之外的兜底（`body { overflow: clip }`）或反馈给宿主 `PluginWebView`，但先按最小改动走。

## Approach

只改插件目录内文件，两个改动都很小：

1. `main.js`：给 `pbpaste` 显式指定 UTF-8 locale（只传需要的两个变量，不展开 `process.env`）。
2. `index.html`：文档层禁横向滚动，输入框保留自己横向滚动。
3. 版本升到 `1.1.1`，重跑索引脚本（`store.json` 是生成物）。
4. 测试断言 `execFile` 带了 UTF-8 locale。

## Files to modify

- `plugins/json-formatter/main.js` — `readClipboard()` 传 `env`
- `plugins/json-formatter/index.html` — `<style>` 加文档滚动约束
- `plugins/json-formatter/manifest.json` — `version: 1.1.0` → `1.1.1`
- `plugins/json-formatter/README.md` — 实现段落补一句 locale 说明（可选，一行）
- `tests/json-formatter.test.cjs` — 断言 `env`
- `store.json` — 由 `node Scripts/build-index.mjs` 重新生成，不手写

## Reuse

- `tests/json-formatter.test.cjs` 的 `loadEntry()` 桩已经在 `calls.execFile` 里记录 `[file, options]`，直接读 `options.env` 断言，不改桩结构。
- `Scripts/build-index.mjs --check` 是现成的索引一致性校验，`tests/index.test.cjs` 已在跑。

## Steps

- [x] `main.js` 的 `readClipboard()`：

  ```js
  // Leap 的插件进程没有 LANG，pbpaste 会退化成 GBK 输出，必须显式指定 UTF-8。
  execFile('/usr/bin/pbpaste', {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
  }, callback)
  ```

  `/usr/bin/pbpaste` 是绝对路径，清空环境也不影响执行（已验证）。

- [x] `index.html` 的 `<style>`：`body` 现有规则旁加

  ```css
  html, body { overflow: hidden; }
  ```

  `textarea` 的 `overflow: auto` 保持不动（长行仍可横向滚）。

- [x] `manifest.json` 版本改 `1.1.1`
- [x] `README.md`「实现」段补一句：读剪贴板时显式指定 UTF-8 locale，否则无 locale 环境下中文会乱码
- [x] `tests/json-formatter.test.cjs` 在「入口用 pbpaste 返回剪贴板」用例里加断言：`plugin.calls.execFile[0][1].env` 含 `LC_ALL: 'en_US.UTF-8'`
- [x] `node Scripts/build-index.mjs` 重新生成 `store.json`

## Verification

- `node --check plugins/json-formatter/main.js`
- `node --test tests/` —— 含公共清单校验、索引一致性与新增的 `env` 断言
- 乱码复现对照（无 locale 复刻宿主环境）：

  ```sh
  printf '{"名称":"中文测试"}' | pbcopy
  env -i node -e 'require("node:child_process").execFile("/usr/bin/pbpaste",{encoding:"utf8",env:{LANG:"en_US.UTF-8",LC_ALL:"en_US.UTF-8"}},(e,o)=>console.log(o))'
  ```

  应输出正确中文，而不是 `{"����":…}`

- 手动（需重新安装受管副本）：Leap 设置 → 插件 → 从本地目录安装 `plugins/json-formatter` → 清空文本框、把一段带中文的 JSON 拷到剪贴板 → 进入插件，应正常显示中文；把一行很长（远宽于窗口）的 JSON 粘进去，输入框内可横向滚动，页面本身左右拖不动。
