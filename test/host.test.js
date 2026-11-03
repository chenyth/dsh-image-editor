import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as plugin from '../src/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const hostModules = process.env.DSH_HOST_MODULE_DIR;
const load = name => import(pathToFileURL(join(hostModules, '@deepseek-ai', name, 'lib/index.js')).href);

test('published DSH reads localized display metadata and icon', { skip: !hostModules }, async () => {
  const { readPluginMeta } = await load('dsh-app-boot');
  const meta = readPluginMeta('dsh-image-editor', new URL('../package.json', import.meta.url).href);
  assert.equal(meta.error, undefined);
  assert.equal(meta.title.zh, '神火图层编辑器');
  assert.equal(meta.title.en, 'Image Editor');
  assert(meta.description.zh.includes('默认浏览器'));
  assert(meta.description.en.includes('default browser'));
  assert(meta.icon);
});

test('published DSH registers and disposes the plugin tool', { skip: !hostModules }, async () => {
  const { Context } = await load('cordis');
  const ctx = new Context();
  const directory = await mkdtemp(join(tmpdir(), 'dsh-editor-host-'));
  try {
    await ctx.plugin((await load('dsh-system-prompt')).default).await();
    await ctx.plugin((await load('dsh-tools')).default).await();
    await ctx.plugin((await load('dsh-skill')).default).await();
    const scope = ctx.plugin({ ...plugin, apply: c => plugin.apply(c, { dataDir: directory }) });
    await scope.await();
    assert(ctx.tools.schemas().some(tool => tool.name === 'shenhuo_image_editor_info'));
    assert(ctx.tools.schemas().some(tool => tool.name === 'shenhuo_editor_download_psd'));
    assert((await ctx.skills.list({})).some(s => s.name === 'shenhuo-image-editor'));
    await scope.dispose();
    assert(!ctx.tools.schemas().some(tool => tool.name === 'shenhuo_image_editor_info'));
  } finally {
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
