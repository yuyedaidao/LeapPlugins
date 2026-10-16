# Shell 执行器

最低要求 Leap 1.2.0，适用于 macOS。搜索「Shell 执行器」、`shell`、「脚本」或「终端」，按 Enter 进入插件，输入脚本，等待「后台执行 Shell 脚本」条目出现后按 Enter 执行。启动成功自动收起 Leap，不显示结果页面或完成通知。

例如输入：

```sh
mkdir -p "$HOME/Desktop/Leap 示例" && printf '你好，Leap\n' > "$HOME/Desktop/Leap 示例/hello.txt"
```

## 执行方式

- 每次从用户主目录启动独立的 `/bin/zsh -l -c` 进程，脚本原文不额外拼接或转义。支持管道、重定向、引号和组合命令。
- 继承 Leap 的环境，并读取 zsh 登录配置；不强制读取交互式 `.zshrc`。如需仅在 `.zshrc` 中配置的工具或别名，请在脚本中显式配置环境，或使用可执行文件的绝对路径。
- 需要其他目录时使用 `cd /目标目录 && 命令`；较长脚本建议直接输入 `zsh /绝对路径/script.zsh`。输入框沿用宿主的单行提交方式，不提供多行编辑器。
- 任务启动后不受插件会话的 3 秒回调时限影响；收起、退出插件或关闭 Leap 不会停止该任务。可重新进入插件启动其他任务。
- 标准输入关闭，不支持 `sudo` 密码输入、交互式提示和终端程序。

启动失败时窗口保留并显示错误。「已启动」只代表 Shell 进程创建成功，脚本语法错误或命令失败请查看日志。若启动后窗口未能收起，再次按 Enter 不会重复执行；退出并重新进入插件可发起下一次执行。

## 日志

每次执行生成一个日志文件，标准输出和标准错误合并写入：

```text
~/Library/Logs/Leap/shell-runner/<时间>-<唯一标识>.log
```

插件通过 `leap.getPath('logs')` 获取宿主日志目录，不写入受管插件副本。新建目录权限为 `0700`，文件权限为 `0600`。宿主调试日志仅记录启动时间、PID、日志路径及启动错误，不额外记录输入的脚本正文。

日志不自动清理；长期或大量输出会持续占用磁盘，可自行删除不再需要的日志。脚本自身输出可能包含敏感信息。

## 安装

在 Leap「设置 → 插件 → 安装插件 → 从本地目录安装」中选择整个 `shell-runner` 目录。修改源文件后需要重新安装受管副本。

发布到公开仓库后，也可以通过「从远程地址安装」使用：

```text
https://github.com/yuyedaidao/LeapPlugins/tree/main/plugins/shell-runner
```

无需额外运行时、npm 安装或第三方依赖。脚本以当前用户权限执行，请只运行自己理解且信任的内容；关闭 Leap 不能撤销脚本已经产生的修改。

## 图标生成记录

`icon.png` 使用内置 imagegen 生成，提示词如下：

> Use case: logo-brand. Asset type: square macOS Leap launcher plugin icon, final project asset. Create one polished icon for a Shell script runner. Full square charcoal/navy background extending to the canvas edges, no outside margin or mockup. A bold stylized dark terminal window with a slightly lighter top bar, large luminous mint-green terminal prompt '>_' as the main symbol, and one small simple mint forward execution arrow integrated into the lower-right area. Flat geometric shapes with restrained subtle depth, crisp high contrast, thick strokes and generous spacing, centered composition. It must remain instantly legible at 24 and 32 pixels. No words, letters, labels, slogans, watermark, multiple variations, or extra decorations. Deliver a single square PNG icon.
