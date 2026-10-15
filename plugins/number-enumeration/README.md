# 数字枚举

最低要求 Leap 1.2.0。搜索“数字枚举”或 `number`，按 Enter 进入原生列表，输入非负整数。

各位数字之和对 10 取余，余数决定列表长度：`123` 生成标题 0 至标题 5，`19` 返回空列表。允许首尾空白、前导零和最多 1000 位数字；负数、小数和其他字符会显示中文错误。

上下键选择，Enter 或数字快捷键执行当前条目，将标题复制到系统剪贴板并显示“已复制：标题 N”；Escape 返回搜索。动态列表标题和数字快捷键需 Leap 构建包含对应能力。

安装目录链接：

```text
https://github.com/yuyedaidao/LeapPlugins/tree/main/plugins/number-enumeration
```

在包含远程安装功能的 Leap 中，选择“设置 → 插件 → 安装插件 → 从远程地址安装”，粘贴上述链接并确认来源。也可以从本地目录安装整个 `number-enumeration` 文件夹。

脚本使用宿主提供的 `leap.onInputChange`、`leap.onSelect` 和 `leap.copyText`，无需额外依赖。写入剪贴板失败时会报告错误。修改文件后需重新安装受管副本。
