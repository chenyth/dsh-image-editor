import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as plugin from '../src/index.js';

const hostModules = process.env.DSH_HOST_MODULE_DIR;
const load = name => import(pathToFileURL(join(hostModules, '@deepseek-ai', name, 'lib/index.js')).href);

test('published DSH reads localized display metadata and icon', { skip: !hostModules }, async () => {
  const { readPluginMeta } = await load('dsh-app-boot');
  const meta = readPluginMeta('dsh-image-editor', new URL('../package.json', import.meta.url).href);
  assert.equal(meta.error, undefined);
  assert.equal(meta.title.zh, '神火图层编辑器');
  assert.equal(meta.title.en, 'Image Editor');
  assert(meta.description.zh.includes('初始化'));
  assert(meta.description.en.includes('scaffold'));
  assert(meta.icon);
});

test('published DSH registers and disposes the plugin tool', { skip: !hostModules }, async () => {
  const { Context } = await load('cordis');
  const ctx = new Context();
  try {
    await ctx.plugin((await load('dsh-system-prompt')).default).await();
    await ctx.plugin((await load('dsh-tools')).default).await();
    const scope = ctx.plugin(plugin);
    await scope.await();
    assert(ctx.tools.schemas().some(tool => tool.name === 'shenhuo_image_editor_info'));
    await scope.dispose();
    assert(!ctx.tools.schemas().some(tool => tool.name === 'shenhuo_image_editor_info'));
  } finally {
    await ctx.fiber.dispose();
  }
});
