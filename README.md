# 神火图层编辑器 · Image Editor

[English](README.en.md)

`dsh-image-editor` 旨在将神火 AI 的图层编辑功能集成到 **DeepSeek Harness（DSH）**：打开图片，编辑文字、图片与图形图层，使用 AI 图层分离，并保存和导出作品。

**当前状态：项目初始化，尚未提供图片编辑功能。** 仓库包含 DSH 原生插件入口、中英文显示信息、品牌图标、检查与打包流程，以及后续集成设计。尚未发布正式 Release、提交插件市场或完成 DSH 桌面实测。

## 已初始化

- 可由 DSH 加载的 ESM / Cordis 插件与 `dsh.bundle` 清单。
- 中文名称“神火图层编辑器”、英文名称“Image Editor”及各自介绍。
- 神火官方红色火焰、透明背景图标，与 `dsh-image-designer` 保持品牌一致。
- 只读工具 `shenhuo_image_editor_info`，准确报告开发状态。
- Node.js 检查、自动测试、GitHub Actions 与 npm 格式打包。

## 开发

环境：Node.js `24.9+`；首个宿主验证基线为 DSH `0.2.1-rc.5`。

```bash
npm ci --ignore-scripts
npm run check
npm test
npm pack --dry-run
```

真实 DSH 宿主合同测试：

```bash
npm install --prefix /tmp/dsh-image-editor-host --ignore-scripts @deepseek-ai/dsh@0.2.1-rc.5
DSH_HOST_MODULE_DIR=/tmp/dsh-image-editor-host/node_modules npm test
```

当前入口只注册状态查询工具，不访问网络、读取图片、绑定账号、创建项目或消费积分。初始化阶段保持零运行时依赖，后续按实际集成需要加入依赖。

## 集成方向

优先复用神火现有图层编辑器的渲染与宿主适配边界，保留图层数据、资产、字体和导出语义。下一步先验证 DSH 编辑器界面的承载方式，再接入本地文件、手工编辑和导出，最后完成个人账号授权、云端保存及 AI 分离。

[架构与边界](docs/architecture.md) · [开发路线](docs/roadmap.md) · [参与开发](CONTRIBUTING.md)

`dsh-image-designer` 负责委托设计师生成作品，本项目负责已有图片的图层编辑；两者独立发行。当前已有设计师 MCP 接口不能直接视为图层编辑 API。

## 开源许可

本仓库新增代码采用 [MIT](LICENSE)。神火名称和火焰图标是品牌标识，使用时不得暗示未经授权的官方认可。后续引入 OpenPencil、CanvasKit、字体或其他第三方资产时保留各自许可和版权声明。

[GitHub Issues](https://github.com/chenyth/dsh-image-editor/issues) · [神火 AI](https://www.shenhuoai.com) · [dsh-image-designer](https://github.com/chenyth/dsh-image-designer)
