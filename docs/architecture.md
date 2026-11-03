# MCP 图层工作流与外部浏览器

2026-11-03。使用现有神火服务端能力，不修改神火网站或 DSH 主程序。

```text
DSH 对话 / shenhuo-image-editor Skill
  → 共享原神火连接，或独立个人 OAuth
  → 上传原图 → 分离报价 → 用户明确确认
  → 提交分离 → 查询原 separation.id
  → 真实文档链接 → 默认浏览器编辑、保存
  → 按需导出指定文档版本 → 查询 job.id
  → export_id 领取文件 → 校验并保存 PSD
```

## 模块

- `connection.js`：Streamable HTTP MCP 发现与调用，实际 get_account 验证；选择已有 Cordis `shenhuoMcpConnection`，否则独立连接。连接选定后不会因原插件离线而切换到另一账号。
- `oauth.js`：公共客户端 DCR、PKCE、回环回调、state/issuer 校验、串行刷新。独立授权省略 scope 子集，由神火授权服务器展示并授予当前全部已发布权限。401 或 403 insufficient_scope 只在原连接刷新一次，不绕过权限拒绝。
- `workflow.js`：实时工具允许列表；默认 document；本地报价匹配、有效期、余额、确认标志检查；按账号持久化原请求与原键后提交。未知结果只允许原键原参数恢复；原报价已用于提交时禁止换键再次分离。
- `files.js`：工作区路径与符号链接约束；上传原始字节及哈希核对；PSD 流式下载、文件头/长度校验、SHA-256、独占新文件名及失败临时文件清理。仅官方 MCP 文件端点，无 OAuth header、无重定向。
- `index.js`：引导工具、按实时 Schema 注册业务工具、Skill 与生命周期清理。
- `src/client/`：外部浏览器按钮和快捷键。点击内同步 `window.open`；文档结果链接由聊天交付。客户端以可卸载的 click capture 处理器仅接管无参数、无凭证的神火官方编辑器链接，绕过 DSH 聊天的侧栏链接偏好；不改变全局设置、其他站点或修饰键点击。首页入口不代表某个任务完成。

单次等待最多 45 秒，按至少 15 秒与服务端更长间隔查询。长任务由 Skill 继续调用等待工具直至终态；取消调用只停止等待，不自动取消服务端任务，也没有会话结束后的常驻通知。

## 连接共享合同

配套 `dsh-image-designer@0.1.3` 提供进程内 Cordis 服务：apiVersion=1、固定 resource、source，以及 status/authorize/tools/call 四个方法。仅允许账号、上传和图层工具；不暴露 Token、Cookie、凭证路径或私有 session。图层插件自己的报价约束和恢复记录仍在每次业务调用前执行；服务端保持最终归属、权限与计费检查。设计师原有 12 个模型工具和设计流程不变。

旧设计师或同名原生 MCP 连接缺少可验证共享接口时明确要求升级/适配，不以同 URL 推断共享，不自动创建第二份授权。网页会话始终由默认浏览器管理。

## 开源边界

公开：DSH 接入、OAuth 公共客户端、MCP 编排、文件交付、安全约束、运行 Skill、测试与构建。部分客户端模块沿用同作者 MIT 项目 dsh-image-designer。

不公开或打包：用户凭证、恢复记录、真实验收素材与文档、临时下载票据、内部 Designer Skill、模型配置、提示词、字体拟合/校色/Node PSD 服务端算法。恢复数据权限保护不等于加密；遵循本机账号保护边界。

历史 WebView 与桥接实验保留为历史说明，不纳入运行路径或发行包的实验源码。

宿主依据：[DSH 工具合同](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.md)、[Skill 合同](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md)。兼容性以已安装的 `0.2.1-rc.5` 模块测试与实机记录为准。
