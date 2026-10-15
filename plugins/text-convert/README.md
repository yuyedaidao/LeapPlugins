# 文本转换

最低要求 Leap 1.2.0。搜索“文本转换”或 `convert`，按 Enter 进入原生列表；输入文字实时得到大小写转换候选，上下键选择，Enter 返回结果，Escape 返回搜索。

安装目录链接：

```text
https://github.com/yuyedaidao/LeapPlugins/tree/main/plugins/text-convert
```

在包含远程安装功能的 Leap 中，选择“设置 → 插件 → 安装插件 → 从远程地址安装”，粘贴上述链接并确认来源。也可以从本地目录安装整个 `text-convert` 文件夹。

脚本使用宿主提供的 `leap.onInputChange` 和 `leap.onSelect`，无需下载额外运行时或依赖。会话内复用 Node.js 进程，退出即释放。修改文件后需重新安装受管副本。
