# LeapPlugins

Leap 插件仓库。每个插件目录可独立下载和安装，无需获取整个仓库。

## 插件

| 插件 | 功能 | 安装目录链接 |
| --- | --- | --- |
| [Shell 执行器](plugins/shell-runner/README.md) | 输入 Shell 脚本，按 Enter 后台执行并收起 Leap | [复制此链接到 Leap](https://github.com/yuyedaidao/LeapPlugins/tree/main/plugins/shell-runner) |
| [关机](plugins/shutdown/README.md) | 立即关机或按分钟/小时定时关机，可取消定时 | [复制此链接到 Leap](https://github.com/yuyedaidao/LeapPlugins/tree/main/plugins/shutdown) |
| [JSON 格式化](plugins/json-formatter/README.md) | 粘贴 JSON 自动缩进对齐，支持压缩与复制 | [复制此链接到 Leap](https://github.com/yuyedaidao/LeapPlugins/tree/main/plugins/json-formatter) |

## 安装

Leap 设置的插件页有「插件商店」入口，直接浏览、搜索本仓库的插件并一键安装或更新；商店读取仓库根的 `store.json`。

也可以手动安装：需要包含“从远程地址安装”功能的 Leap 构建；当前插件的最低宿主版本为 0.0.2，与 `Leap/Project.swift` 里的 `CFBundleShortVersionString` 一致。

1. 打开 Leap 设置的插件页，选择“安装插件 → 从远程地址安装”。
2. 粘贴上表中具体插件的目录链接。
3. 下载并检查来源、版本及命令，确认后安装。

清单里的 `minimumHostVersion` 是**三段数字**（如 `0.0.2`），且不得高于本机 Leap 版本；宿主用当前 App 的 `CFBundleShortVersionString` 与之做数字比较，高于本机时会直接拒绝安装并提示「插件要求的 Leap 版本无效或高于当前版本」。遇到这个提示只有两条路：升级 Leap，或使用清单里不带该字段（或写得更低）的插件版本。字段可省略，省略即不校验版本。

Leap 只下载目标插件目录内的文件，并固定同一次提交，避免混合不同版本。仓库首页不能直接作为插件地址。也可手动下载单个插件目录，通过“从本地目录安装”选择该目录。

远程无登录安装要求仓库为公开状态。仓库保持私有时，首版 Leap 无法访问这些目录。

## 商店索引 store.json

`store.json` 是商店列表的唯一数据源，**由脚本生成，不要手写**：

```sh
node Scripts/build-index.mjs          # 从 plugins/*/manifest.json 与各插件 README 首段生成
node Scripts/build-index.mjs --check  # 只校验是否与清单一致，CI 与测试用这个
```

上架一个插件 = 在 `plugins/` 下建目录写好 `manifest.json`，然后重跑一次生成脚本。`node --test tests/*.test.cjs` 会断言索引与清单一致，忘记重跑时测试失败。

索引条目字段：`id`、`name`、`version`、`path` 来自清单；`summary` 取插件 README 首段的第一句（自动剥掉「最低要求…」这类句子）；`commands` 是命令标题列表。

## 目录约定

```text
plugins/
  shell-runner/
    manifest.json
    main.js
    icon.png
    README.md
    leap.d.ts
    jsconfig.json
  shutdown/
    （同上）
  json-formatter/
    manifest.json
    main.js
    index.html
    format.js
    icon.png
    README.md
    leap.d.ts
    jsconfig.json
```

每个插件拥有独立的 ID 和版本，入口、资源及自带依赖都放在自己的目录中。不要引用兄弟插件目录，不使用符号链接、子模块或 Git LFS。Leap 提供运行时与全局 `leap`，安装时不执行 npm、pip 或安装脚本。

需要多行文本或自定义布局的插件用网页呈现：清单里写 `presentation: "web"` 和 `webEntry`，网页文件与脚本入口放在同一目录。JSON 格式化插件即属此类（`index.html` + `format.js`）；页面逻辑不必经过脚本入口，宿主不提供读剪贴板文本的接口，需要时由 `main.js` 调用系统命令。

插件具有本机脚本权限。Shell 执行器会以当前用户权限后台执行输入的脚本，请确认信任来源后再安装运行。关机插件会真的关掉这台 Mac：首次使用需允许 Leap 控制 System Events，到点前请保存工作。这里分发的插件按自定义插件安装，不具有随 Leap 内置插件的信任身份。

## 权限与日志

| 插件 | 需要的系统授权 | 日志目录 |
| --- | --- | --- |
| Shell 执行器 | 无；以当前用户权限执行 | `~/Library/Logs/Leap/shell-runner/` |
| JSON 格式化 | 无；读取剪贴板文本用 `pbpaste` | 无 |
| 关机 | 自动化：允许 Leap 控制「系统事件」（**必需**，否则关机不会执行；首次安排或关机时弹窗，可在“系统设置 → 隐私与安全性 → 自动化”修改）。系统通知只用于确认安排与取消，未授权不影响关机本身 | `~/Library/Logs/Leap/shutdown/` |

插件数据写在 `~/Library/Application Support/Leap/PluginData/<插件 ID>/`，由插件自己管理权限；日志目录为 `0700`、日志文件为 `0600`，不自动清理。

## 验证

在仓库根目录执行：

```sh
node --test tests/*.test.cjs
```

测试仅使用 Node.js 内置模块，不需要安装依赖。
