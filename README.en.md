# Image Editor · 神火图层编辑器

[中文](README.md)

`dsh-image-editor` aims to bring Shenhuo AI layer editing to **DeepSeek Harness (DSH)**: open an image, edit text/image/shape layers, use AI layer separation, and save or export the result.

**Status: initial development scaffold. Image editing is not available yet.** This repository contains a native DSH plugin entry, localized metadata, a brand icon, validation and packaging workflows, and an integration roadmap. There is no formal release, marketplace submission or Desktop acceptance yet.

## Development

Requires Node.js `24.9+`. The initial host contract baseline is DSH `0.2.1-rc.5`.

```bash
npm ci --ignore-scripts
npm run check
npm test
npm pack --dry-run
```

To run the actual DSH host contract tests:

```bash
npm install --prefix /tmp/dsh-image-editor-host --ignore-scripts @deepseek-ai/dsh@0.2.1-rc.5
DSH_HOST_MODULE_DIR=/tmp/dsh-image-editor-host/node_modules npm test
```

The only registered tool is `shenhuo_image_editor_info`. It reports that the editor is under development. It makes no network requests, reads no images, links no account and consumes no credits. The initial package has no runtime dependencies.

## Integration plan

Reuse the existing Shenhuo editor's renderer and host adapter boundaries. First validate the editor UI surface available to DSH plugins, then implement local file access, manual editing and exports. Personal OAuth, cloud persistence and paid AI layer separation follow after the service contract is available.

See [architecture](docs/architecture.md), [roadmap](docs/roadmap.md) and [contributing](CONTRIBUTING.md). `dsh-image-designer` handles designer-led generation; this separately released plugin will handle layer editing. Existing designer MCP tools do not provide a layer editing contract.

## License

New code in this repository is [MIT licensed](LICENSE). Shenhuo names and flame artwork are brand identifiers; their use must not imply unauthorized official endorsement. Future third-party dependencies and assets retain their respective licenses and notices.
