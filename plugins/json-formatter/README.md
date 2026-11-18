# JSON 格式化

在 Leap 里粘贴 JSON，自动缩进对齐。搜索「JSON 格式化」、`json`、`format`、「美化」或 `minify` 进入。

最低要求 Leap 0.0.2，适用于 macOS。

## 用法

- 进入后显示一个文本框。粘贴 JSON 会立刻格式化（两空格缩进），非法内容不会被覆盖。
- 不是合法 JSON 时保留你的原文，底部红字提示原因；改完可点「格式化」重试。JavaScriptCore 只给原因、不报字符位置（Chromium 里的「第 X 行第 Y 列」提示在这里不会出现）。
- 进入时如果剪贴板里是一段合法 JSON 且文本框为空，会自动填入并格式化；剪贴板里没有可用 JSON（为空或不是 JSON）时，
  恢复上次保存的格式化结果，状态栏写「已恢复上次内容」和保存时间，一进来就能接着改。
- 每次格式化成功（粘贴、点「格式化」、点「压缩」、从剪贴板或参数填入）都会把结果存到插件自己的数据库，只保留最近一次。
  保存不成功（例如超过宿主单文档 1MB 上限）不影响格式化本身，也不会报错。
- 其他插件可用 `leap.runPlugin('com.padding.leap.json-formatter', 'json-format.run', 文本)` 把文本当参数传进来，页面优先格式化传入的文本、不再读剪贴板；传入的不是合法 JSON 时原样显示并报错，不丢内容。
- 点「压缩」把当前内容压成一行；已经是单行 JSON 时提示「已是该格式」，不做无意义改写。
- 点「复制」把内容写入剪贴板，内容不合法时按钮禁用。
- 在内嵌页里 Enter 只会换行（不提交）；Escape 退出插件、回到搜索。

## 实现

- 内嵌网页（`presentation: "web"`）：Leap 的原生列表只有宿主单行输入，多行文本框只能由网页提供。`input.enabled` 为 `false`，进入后焦点直接在网页里。
- 格式化在页面内完成（`format.js` 暴露 `window.JSONFormat`），不经过脚本入口，没有每键一次 IPC。
- 网页没有读剪贴板文本的 API，所以进入时由 `main.js` 的 `leap.onInvoke` 用 `/usr/bin/pbpaste` 读出剪贴板（`query` 为 `clipboard`）；页面确认能解析后才填入。调用时显式指定 `LANG`/`LC_ALL` 为 UTF-8，因为 Leap 的插件进程没有 locale，`pbpaste` 会退化成 GBK 输出，中文会变成乱码。
- 页面本身不参与滚动（`html, body` 为 `overflow: hidden`），横向滚动只发生在输入框内，整页不会被左右拖动。
- 上次结果存在宿主的插件数据库（`window.leap.db`）里，文档 `_id` 为 `last-output`，字段 `text` 与 `savedAt`：
  写入带 `_rev` 做版本校验，遇到「版本已变化」时重读一次版本后重试一次，其它失败只 `leap.log` 记一行。
  恢复判定集中在 `format.js` 的 `chooseInitial`（参数 > 剪贴板里的 JSON > 上次结果），便于单测。
- 被其他插件用 `runPlugin` 启动时，文本作为查询放进页面上下文的 `query`，`leap.onEnter` 收到后优先于剪贴板处理。
- 脚本入口同时接受把文本直接作为 `query` 传入调用，返回格式化结果，便于在网页之外复用同一套规则。
- 修改源目录后需要在 Leap 的插件设置里重新安装，更新受管副本。

```text
json-formatter/
  manifest.json      清单：命令、内嵌网页入口、图标
  main.js            脚本入口：读剪贴板、格式化传入文本
  index.html         内嵌页面：文本框、状态栏、格式化/压缩/复制
  format.js          纯逻辑：format、minify、parseError、chooseInitial
  icon.png           1254×1254 图标
```

## 安装

在 Leap「设置 → 插件 → 安装插件 → 从本地目录安装」中选择整个 `json-formatter` 目录。修改源文件后需要重新安装受管副本。

也可以通过「从远程地址安装」使用目录链接：

```text
https://github.com/yuyedaidao/LeapPlugins/tree/main/plugins/json-formatter
```

无需额外运行时、npm 安装或第三方依赖。插件申请的系统授权只有一次性的剪贴板读取（`pbpaste`），不发起网络请求；
唯一写入是插件自己的数据库 `~/Library/Application Support/Leap/PluginData/com.padding.leap.json-formatter/db/`
（存上次格式化结果，单文档上限 1MB，卸载插件后随目录一起清掉）。

## 图标生成记录

`icon.png` 在 Figma 里手工绘制（1254×1254，与仓库内其它插件一致），采用 macOS 系统图标语言：满幅方形薄荷绿渐变底（`#7DF3C8 → #0B8B5D`），中央一对白色花括号，笔画端点为圆头。圆角由 Leap 宿主按 9pt 连续圆角裁切，所以图源本身是满幅方形、不带圆角。

花括号是贝塞尔矢量而非字体字形。两括号合并进同一条矢量路径，墨迹边界精确居中（1254 画布上中心为 627），括号间留出约 15% 画布宽度的空档，24 与 32 像素缩略下仍能看清 `{ }` 结构。
