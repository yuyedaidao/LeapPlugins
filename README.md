# LeapPlugins

Leap 插件仓库。每个插件目录可独立下载和安装，无需获取整个仓库。

## 插件

| 插件 | 功能 | 安装目录链接 |
| --- | --- | --- |
| [文本转换](plugins/text-convert/README.md) | 实时生成大写、小写文本候选 | [复制此链接到 Leap](https://github.com/yuyedaidao/LeapPlugins/tree/main/plugins/text-convert) |
| [数字枚举](plugins/number-enumeration/README.md) | 按数字和的余数生成列表，并复制选中标题 | [复制此链接到 Leap](https://github.com/yuyedaidao/LeapPlugins/tree/main/plugins/number-enumeration) |
| [Shell 执行器](plugins/shell-runner/README.md) | 输入 Shell 脚本，按 Enter 后台执行并收起 Leap | [复制此链接到 Leap](https://github.com/yuyedaidao/LeapPlugins/tree/main/plugins/shell-runner) |

## 安装

需要包含“从远程地址安装”功能的 Leap 构建；当前插件的最低宿主版本为 1.2.0。

1. 打开 Leap 设置的插件页，选择“安装插件 → 从远程地址安装”。
2. 粘贴上表中具体插件的目录链接。
3. 下载并检查来源、版本及命令，确认后安装。

Leap 只下载目标插件目录内的文件，并固定同一次提交，避免混合不同版本。仓库首页不能直接作为插件地址。也可手动下载单个插件目录，通过“从本地目录安装”选择该目录。

远程无登录安装要求仓库为公开状态。仓库保持私有时，首版 Leap 无法访问这些目录。

## 目录约定

```text
plugins/
  text-convert/
    manifest.json
    main.js
    README.md
    leap.d.ts
    jsconfig.json
  number-enumeration/
    ...
  shell-runner/
    ...
```

每个插件拥有独立的 ID 和版本，入口、资源及自带依赖都放在自己的目录中。不要引用兄弟插件目录，不使用符号链接、子模块或 Git LFS。Leap 提供运行时与全局 `leap`，安装时不执行 npm、pip 或安装脚本。

插件具有本机脚本权限。数字枚举的选择操作会写入剪贴板；Shell 执行器会以当前用户权限后台执行输入的脚本，请确认信任来源后再安装运行。这里分发的插件按自定义插件安装，不具有随 Leap 内置插件的信任身份。

## 验证

在仓库根目录执行：

```sh
node --test tests/*.test.cjs
```

测试仅使用 Node.js 内置模块，不需要安装依赖。
