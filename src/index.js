import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import manifest from '../package.json' with { type: 'json' };
import { PrivateStore } from './store.js';
import { OAuthSession } from './oauth.js';
import { LocalConnection, ConnectionRouter } from './connection.js';
import { Workflow, TOOLS } from './workflow.js';
import { FileTransfers } from './files.js';
import { EDITOR_HOME } from './client/urls.js';

export const name = 'dsh-image-editor';
export const inject = ['tools', 'skills'];
const PREFIX = 'shenhuo_editor_';
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = description => ({ type: 'string', description });
const key = string('本次操作稳定的 ASCII 幂等键；超时重试沿用原值。');
export function resolveCwd(exec) {
  for (const value of [exec?.agent?.cwd, exec?.agent?.meta?.cwd, exec?.agent?.session?.cwd, exec?.agent?.session?.header?.cwd]) if (typeof value === 'string' && value) return value;
  throw new Error('No local workspace is available. Select a workspace before transferring images or PSD files.');
}
export function definition(name, description, parameters, execute, timeoutMs = 90000) {
  return { name, description, parameters, timeoutMs,
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => execute(args ?? {}, exec) };
}
export async function apply(ctx, config = {}) {
  if (config.dataDir !== undefined && (typeof config.dataDir !== 'string' || !config.dataDir)) throw new Error('dataDir must be a directory path.');
  const store = new PrivateStore(config.dataDir), session = new OAuthSession(store);
  const connection = new ConnectionRouter(ctx, new LocalConnection(session));
  const flow = new Workflow(connection, store), files = new FileTransfers(flow);
  const disposers = [], remoteTools = new Map(); let disposed = false;
  ctx.effect(() => async () => {
    disposed = true; for (const off of remoteTools.values()) off(); remoteTools.clear();
    for (const off of disposers.splice(0)) off(); await connection.dispose();
  }, 'shenhuo-editor.lifecycle');
  const register = tool => disposers.push(ctx.tools.register(tool));
  const discover = async () => {
    const tools = (await connection.tools()).filter(t => TOOLS.has(t.name));
    const account = await flow.account();
    if (disposed) return {};
    for (const [name, off] of remoteTools) if (!tools.some(t => t.name === name)) { off(); remoteTools.delete(name); }
    for (const tool of tools) {
      if (remoteTools.has(tool.name)) continue;
      const parameters = structuredClone(tool.inputSchema);
      if (parameters.properties?.delivery_target) parameters.properties.delivery_target.default = 'document';
      const help = tool.description?.split('\n\n')[0] ?? tool.name;
      const suffix = tool.name === 'separate_layers' ? ' 必须先展示本次报价并得到用户明确同意，不能代替用户传 true。默认 document；断线保留原键。' : tool.name === 'quote_layer_separation' ? ' 默认 document；逐项展示预估、预占、余额、缺口和有效期，等待用户确认。' : '';
      remoteTools.set(tool.name, ctx.tools.register(definition(PREFIX + tool.name, help + suffix, parameters, (args, exec) => flow.call(tool.name, args, { signal: exec?.signal }))));
    }
    return { account, tools: tools.map(t => PREFIX + t.name), missing_tools: [...TOOLS].filter(name => !tools.some(t => t.name === name)) };
  };
  register(definition('shenhuo_image_editor_info', '查看神火图层编辑器的能力、授权和默认浏览器入口，不自动上传或消费积分。', schema(), async () => ({
    name, version: manifest.version, stage: 'mcp-layer-workflow', editor_url: EDITOR_HOME,
    authentication: 'personal_oauth_and_separate_website_session',
    message: '在 DSH 对话使用 /shenhuo-image-editor 上传图片、确认分离报价、领取文档或 PSD。成功后点击具体文档链接，在系统默认浏览器编辑。左侧神火按钮仍打开编辑器首页。网页须登录同一账号；OAuth 不代表网页登录完成。'
  })));
  register(definition(PREFIX + 'connect', '开始或恢复神火个人 OAuth；优先使用已安装神火设计师的共享连接，凭证不复制。显示返回的授权链接，用户完成后调用 status。已有授权直接复用。', schema(), async () => {
    const state = await connection.status();
    if (state.status === 'authorized') return { ...state, ...await discover() };
    return connection.authorize();
  }));
  register(definition(PREFIX + 'status', '检查原神火连接、实际账号与实时图层工具目录。缺权限时原连接自动刷新；失败后才重新授权。', schema(), async () => {
    const state = await connection.status();
    return state.status === 'authorized' ? { ...state, ...await discover() } : state;
  }));
  register(definition(PREFIX + 'upload_file', '上传本次用户提供的工作区图片原始字节，校验 SHA-256 并返回 receipt.asset_id。限图片；同次上传沿用原键。', schema({ path: string('当前工作区内的图片路径'), label: string('素材说明'), idempotency_key: key }, ['path', 'idempotency_key']), (args, exec) => files.upload(args, resolveCwd(exec), exec?.signal), 240000));
  register(definition(PREFIX + 'download_psd', '将成功导出的 PSD 保存到当前工作区，校验格式、字节数和哈希，返回真实路径。export_id 不是任务 ID。票据过期换领取键，不重新分离；不覆盖已有文件。', schema({ export_id: string('separation.export_id 或 job.export.id'), directory: string('工作区内输出目录，默认 shenhuo-layers'), idempotency_key: key }, ['export_id', 'idempotency_key']), (args, exec) => files.download(args, resolveCwd(exec), exec?.signal), 240000));
  register(definition(PREFIX + 'wait_for_result', '实际等待并查询原任务，遵守至少15秒及更长服务端间隔。每次最多45秒，done=false 时继续调用直到终态，不能声称后台会自动通知。document 成功即交付编辑器链接，无须等 PSD。', schema({ kind: { type: 'string', enum: ['separation', 'export'] }, task_id: string('separation.id 或独立导出的 job.id；不能混用'), seconds: { type: 'integer', minimum: 1, maximum: 45, default: 45 } }, ['kind', 'task_id']), (args, exec) => flow.wait(args, exec?.signal), 180000));
  register(definition(PREFIX + 'resume', '读取当前账号的原任务、原参数和幂等键，随后查询服务端实时状态。记录不是新增扣费。下载票据 pending 不代表分离未完成。', schema(), (_args, exec) => flow.resume(exec?.signal)));
  const skillRoot = new URL('../skills/shenhuo-image-editor/', import.meta.url);
  const skill = await readFile(new URL('SKILL.md', skillRoot), 'utf8');
  disposers.push(ctx.skills.register({ name: 'shenhuo-image-editor', description: '神火图文分层：上传图片、确认积分后分离，在默认浏览器编辑，按需导出和下载 PSD。', source: 'bundled', invocation: { modelInvocable: true, userInvocable: true }, resourceBase: { kind: 'directory', path: fileURLToPath(skillRoot) }, content: skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '') }));
  // Disconnected installation does not create an OAuth client or pin an owner.
  const shared = ctx.get?.('shenhuoMcpConnection');
  if ((shared && (await shared.status()).status === 'authorized') || (await session.status()).status === 'authorized') {
    try { await discover(); } catch { /* Explicit status/connect reports a recoverable failure. */ }
  }
}
