# 参与开发

当前目标是在 DSH 完成 MCP 上传、报价确认、分离与 PSD 交付，并在系统默认浏览器编辑原文档。请先阅读 [架构](docs/architecture.md) 和 [路线](docs/roadmap.md)，围绕一个可验收行为提交改动。画布、字体、文档与 AI 分离复用神火线上服务。

使用 Node.js 24.9+，执行 `npm ci --ignore-scripts`、`npm run check`、`npm run build`、`npm test` 与 `npm pack --dry-run`。修改宿主注册、元数据或清单时运行 README 中的真实 DSH 合同测试。默认浏览器打开与实际网页操作需要桌面验收。不要覆盖已有版本安装包，内容变更使用新版本号。

使用公开槽位和命令接口。不要复制登录凭证、注入网页脚本或修改 DSH 的下载策略。新增依赖附许可信息；提交中不得包含个人图片、凭证、签名下载地址、文档 ID、截图或运行时状态。
