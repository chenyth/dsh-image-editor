# Image Editor · 神火图层编辑器

[中文](README.md)

Separate an uploaded image into editable layers from DeepSeek Harness, open the original document in the **system default browser**, then export and download a PSD when needed. This plugin uses Shenhuo's existing web editor and remote MCP service.

Version `0.2.0`. Prebuilt packages and SHA-256 checksums are available in [GitHub Releases](https://github.com/chenyth/dsh-image-editor/releases). See [acceptance evidence](docs/acceptance.md) for protocol fixtures, DSH checks and paid production testing. Marketplace inclusion requires maintainer review.

## Usage

1. In DSH, open Plugins → Add plugin, enter the release package URL below, install and enable it. If Image Designer is already installed, update it to [0.1.3](https://github.com/chenyth/dsh-image-designer/releases/tag/v0.1.3) or later first. The editor reuses its owner-managed connection without copying tokens. Image Designer is optional for standalone installations.
2. In a local workspace, invoke `/shenhuo-image-editor` or ask to separate an image. Complete personal-account OAuth when prompted.
3. Review the current credit quote. Separation starts only after explicit confirmation.
4. Click the returned document link to edit and save in the default browser. Website login is separate from OAuth and must use the same Shenhuo account.
5. Ask for the current saved document as a PSD. The plugin reads its revision, exports it without repeating AI separation, then verifies and saves the file. Request PSD initially for one-step delivery.

```text
https://github.com/chenyth/dsh-image-editor/releases/download/v0.2.0/dsh-image-editor-0.2.0.tgz
```

Use the prebuilt `.tgz`; no build approval is needed inside DSH. The source repository does not track `dist/`. Build it using the development steps below when working from source.

The red sidebar footer button opens the editor homepage. A keyboard shortcut can be assigned under Settings → General → Edit shortcuts. The plugin does not embed a right sidebar editor. Web-hosted DSH opens a browser tab. Official editor links use this external route even when DSH opens ordinary chat links in its sidebar; unrelated link preferences are unchanged.

PNG/JPEG/WebP/GIF uploads must be inside the current local workspace (20 MiB maximum). PSD downloads are streamed with a 512 MiB limit, verified by header/size/SHA-256, and saved under `shenhuo-layers/` by default without overwriting files. The plugin does not guarantee that every text/effect is editable.

Recovery records preserve typed task IDs, parameters and idempotency keys per account. Use `shenhuo_editor_resume` after interruption; failed downloads never trigger another separation. Standalone credentials live in `~/.dsh-image-editor/` (0700 directory, 0600 files). Shared credentials remain with Image Designer. Temporary transfer tickets are not stored in recovery records. SSH/remote workspaces and Windows need separate validation.

## Development

Node.js 24.9+:

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm test
npm pack
```

The package includes readable source, a bundled runtime Skill and a prebuilt client bundle; no install-time build runs. React is supplied by DSH, and the MCP SDK version is pinned. For host tests, set `DSH_HOST_MODULE_DIR` to a Node modules directory containing `@deepseek-ai/dsh@0.2.1-rc.5`.

[Architecture and open-source boundary](docs/architecture.md) · [MIT license](LICENSE).
