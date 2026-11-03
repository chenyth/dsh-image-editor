# 神火图层编辑器 · Image Editor

[English](README.en.md)

在 DeepSeek Harness（DSH）对话中把图片分离成可编辑图层，在**系统默认浏览器**打开原文档修改，再按需导出 PSD。复用神火线上编辑器与远程 MCP，不另建画布。

当前版本 `0.2.0`。预构建安装包与 SHA-256 校验文件见 [GitHub Releases](https://github.com/chenyth/dsh-image-editor/releases)。源码/协议测试、DSH 实机与真实付费分离的验收状态分别见[验收记录](docs/acceptance.md)。插件市场收录需等待维护者审核。

## 使用

1. 在 DSH 的“插件 → 添加插件”输入下方安装包地址，安装并启用。已有“神火设计师”时，先更新到配套的 [0.1.3](https://github.com/chenyth/dsh-image-designer/releases/tag/v0.1.3) 或更高版本；图层插件沿用它管理的个人账号授权，不复制凭证。不要求单独安装设计师插件。
2. 在有本地工作区的对话中输入 `/shenhuo-image-editor`，或者说“把工作区 poster.png 的文字与背景分开”。首次使用按提示通过浏览器 OAuth 连接神火账号。
3. 插件上传原图、展示当前报价，**得到你明确确认后**才启动分离，并查询进度。
4. 完成后点击对应文档的“打开图层编辑器”链接，在默认浏览器查看、编辑和保存。网页登录与 MCP OAuth 独立，须使用同一神火账号。
5. 需要 PSD 时告诉 DSH“导出当前已保存版本的 PSD”。插件读取当前文档版本、提交独立导出、下载并验证文件，返回工作区中的真实路径。也可以一开始就要求一步交付 PSD。

```text
https://github.com/chenyth/dsh-image-editor/releases/download/v0.2.0/dsh-image-editor-0.2.0.tgz
```

使用预构建 `.tgz` 安装，无需在 DSH 内批准构建脚本。源码仓库的 `dist/` 不跟踪到 Git；从源码开发时先执行下方构建步骤。

左侧底部红色神火按钮继续打开编辑器首页；“设置 → 通用设置 → 编辑快捷键”可为该动作绑定快捷键。DSH Desktop 使用默认浏览器，Web 宿主打开新标签页。具体文档使用分离结果的链接，不以首页替代。插件会让神火编辑器链接使用外部浏览器，DSH 其他链接的打开偏好保持原样。

## 任务与文件

- 默认交付网页文档，成功时没有 PSD 是正常结果。后续导出不会重新做 AI 分离。
- 分离前分别展示实际报价、预占和余额。费用只引用服务端回执；不承诺所有文字或效果完全可编辑。
- 原任务 ID、资源类型与幂等键按账号保存在本机。断线后使用 `shenhuo_editor_resume` 恢复；下载失败只重新领取文件，不重新分离。
- 本地上传只接收工作区内 PNG/JPEG/WebP/GIF，最大 20 MiB；PSD 下载上限 512 MiB，默认输出 `shenhuo-layers/`，同名文件自动加序号。远程/SSH 工作区与 Windows 尚需实机验证。
- 默认数据目录 `~/.dsh-image-editor/`，目录/文件权限为 0700/0600。单独运行时存放 OAuth 凭证；复用设计师连接时凭证仍由原插件保管。任务记录不保存短期下载票据。
- 使用已结算的神火生成图分层时，先明确选图并同意分层，再下载原图、上传得到新素材、另行报价确认。设计项目与分层项目可能不同。

## 开发

Node.js `24.9+`：

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm test
npm pack
```

发行包带可读 `src/`、运行 Skill 和预构建 `dist/client.js`，无安装期构建。MCP SDK 为固定依赖。React 由宿主提供。

真实宿主模块检查：

```sh
npm install --prefix /tmp/dsh-image-editor-host --ignore-scripts @deepseek-ai/dsh@0.2.1-rc.5
DSH_HOST_MODULE_DIR=/tmp/dsh-image-editor-host/node_modules npm test
```

[架构与开源边界](docs/architecture.md) · [路线](docs/roadmap.md) · [参与开发](CONTRIBUTING.md)

## 许可

代码采用 [MIT](LICENSE)。神火名称和火焰图标是品牌标识，不代表对第三方衍生项目的官方认可。DSH、浏览器与线上服务遵循各自许可和条款。
