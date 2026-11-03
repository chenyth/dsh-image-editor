import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apply } from '../src/index.js';
import { TOOLS } from '../src/workflow.js';
import { RESOURCE } from '../src/oauth.js';
import { ConnectionRouter } from '../src/connection.js';

async function fixture(t, shared) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-editor-plugin-')), tools = new Map(), skills = new Map(), effects = [];
  t.after(async () => { for (const off of effects) await off(); await rm(directory, { recursive: true, force: true }); });
  const ctx = { get: () => shared, tools: { schemas: () => [...tools.values()], register: tool => { assert(tool.output.schema); assert(!tools.has(tool.name)); tools.set(tool.name, tool); return () => tools.delete(tool.name); } }, skills: { register: skill => { skills.set(skill.name, skill); return () => skills.delete(skill.name); } }, effect: fn => effects.push(fn()) };
  await apply(ctx, { dataDir: directory });
  return { tools, skills, effects };
}

test('unconnected install registers the full Skill and bootstrap without authorizing or opening a page', async t => {
  const f = await fixture(t);
  assert.equal(f.tools.size, 7);
  const info = await f.tools.get('shenhuo_image_editor_info').execute({});
  assert.equal(info.stage, 'mcp-layer-workflow');
  assert.equal((await f.tools.get('shenhuo_editor_status').execute({})).status, 'not_connected');
  const skill = f.skills.get('shenhuo-image-editor');
  assert(skill.invocation.modelInvocable && skill.invocation.userInvocable);
  assert(skill.content.includes('user_confirmed=true'));
  await assert.rejects(f.tools.get('shenhuo_editor_upload_file').execute({ path: 'x' }, {}), /workspace/);
});

test('authorized companion supplies live tools and account; no duplicate OAuth or credential access', async t => {
  let authorizations = 0;
  const inputSchema = { type: 'object', properties: { delivery_target: { type: 'string', enum: ['document', 'psd'], default: 'psd' } } };
  const shared = { apiVersion: 1, resource: RESOURCE, source: 'dsh-image-designer', status: async () => ({ status: 'authorized' }), authorize: async () => { authorizations++; }, tools: async () => [...TOOLS].map(name => ({ name, inputSchema })), call: async name => { assert.equal(name, 'get_account'); return { structuredContent: { user: { id: 'shared-user' } } }; } };
  const f = await fixture(t, shared);
  const status = await f.tools.get('shenhuo_editor_connect').execute({});
  assert.equal(status.account.user.id, 'shared-user');
  assert.equal(status.connection_source, 'dsh-image-designer');
  assert.equal(authorizations, 0);
  assert.equal(f.tools.get('shenhuo_editor_quote_layer_separation').parameters.properties.delivery_target.default, 'document');
  assert.equal(inputSchema.properties.delivery_target.default, 'psd');
  for (const off of f.effects.splice(0)) await off();
  assert.equal(f.tools.size, 0); assert.equal(f.skills.size, 0);
});

test('connection selection rejects legacy duplicates and never falls back after the owner disappears', async () => {
  const local = { resource: RESOURCE, source: 'dsh-image-editor', status: async () => ({ status: 'not_connected' }) };
  const legacy = new ConnectionRouter({ get: () => undefined, tools: { schemas: () => [{ name: 'shenhuo_connect' }] } }, local);
  await assert.rejects(legacy.status(), /UPGRADE_REQUIRED/);
  let shared = { apiVersion: 1, resource: RESOURCE, source: 'dsh-image-designer', status: async () => ({ status: 'authorized' }), authorize() {}, tools() {}, call() {} };
  const router = new ConnectionRouter({ get: () => shared }, local);
  assert.equal((await router.status()).connection_source, 'dsh-image-designer');
  shared = undefined;
  await assert.rejects(router.status(), /unavailable/);
});
