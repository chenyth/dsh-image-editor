# 参与开发

当前目标是验证 DSH 内的图层编辑闭环。请先阅读 [架构](docs/architecture.md) 和 [路线](docs/roadmap.md)，围绕一个可验收行为提交改动。

使用 Node.js 24.9+，执行 `npm ci --ignore-scripts`、`npm run check`、`npm test` 与 `npm pack --dry-run`。修改宿主注册、元数据或清单时，还需运行 README 中的真实 DSH 合同测试。桌面操作与实际画布输出需要独立验收。

请保留用户原图，显式处理文档修订、幂等重试、资源释放和取消。涉及云端能力时先确认官方接口与授权范围；新增依赖附上许可信息。提交中不要包含个人图片、账号凭证、签名下载地址或运行时状态。
