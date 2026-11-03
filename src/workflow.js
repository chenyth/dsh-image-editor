import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { resultValue } from './result.js';
import { editorUrl } from './client/urls.js';

export const TOOLS = new Set(['get_account', 'create_upload', 'get_upload', 'quote_layer_separation', 'separate_layers', 'get_layer_separation', 'get_layer_editor', 'export_layer_psd', 'get_layer_export', 'get_layer_result', 'cancel_layer_separation']);
const WRITES = new Set(['create_upload', 'quote_layer_separation', 'separate_layers', 'export_layer_psd', 'get_layer_result', 'cancel_layer_separation']);
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'canceled']);
const ordered = v => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
const fingerprint = v => createHash('sha256').update(JSON.stringify(ordered(v))).digest('hex');
export function stableKey(key) {
  if (typeof key !== 'string' || !/^[\x21-\x7e]{1,160}$/.test(key)) throw new Error('A stable 1–160 character ASCII idempotency_key is required.');
}
function record(value) {
  // Whitelist public recovery fields. File tickets and credentials are never saved.
  const out = {};
  for (const k of ['quote_id', 'document_id', 'document_revision', 'source_asset_id', 'delivery_target', 'expires_at', 'can_run', 'estimated_credits', 'reservation_credits', 'available_credits', 'shortage_credits', 'transfer_id', 'export_id', 'status', 'poll_after_ms']) if (value[k] !== undefined) out[k] = value[k];
  for (const [k, keys] of Object.entries({ separation: ['id', 'document_id', 'status', 'render_status', 'delivery_target', 'export_id', 'consumed_credits', 'settlement_status'], document: ['id', 'project_id', 'revision', 'status'], job: ['id', 'status', 'error_code'], receipt: ['asset_id', 'sha256'] })) {
    if (value[k]) out[k] = Object.fromEntries(keys.filter(f => value[k][f] !== undefined).map(f => [f, value[k][f]]));
  }
  if (value.job?.export?.id) out.job.export = { id: value.job.export.id };
  if (value.editor_url) out.editor_url = editorUrl(value.editor_url);
  return out;
}

export class Workflow {
  constructor(connection, store, { now = Date.now, sleep = (ms, signal) => delay(ms, undefined, { signal }) } = {}) {
    this.connection = connection; this.store = store; this.now = now; this.sleep = sleep;
  }
  async account(signal) {
    const value = resultValue(await this.connection.call('get_account', {}, { signal }));
    if (!value.user?.id) throw new Error('No authorized personal account.');
    return value;
  }
  async update(action) {
    return this.store.locked('tasks.json', async () => {
      const journal = await this.store.read('tasks.json') ?? { operations: [], tasks: [], files: [] };
      const result = await action(journal); await this.store.write('tasks.json', journal); return result;
    });
  }
  async call(name, input = {}, { signal } = {}) {
    signal?.throwIfAborted();
    if (!TOOLS.has(name)) throw new Error('Unsupported layer tool.');
    const args = { ...input };
    if (name === 'quote_layer_separation' || name === 'separate_layers') args.delivery_target ??= 'document';
    if (!(await this.connection.tools()).some(t => t.name === name)) throw new Error('LAYER_TOOLS_UNAVAILABLE: restore or upgrade the original connection.');
    const account = await this.account(signal), userId = account.user.id;
    if (name === 'get_account') return account;
    const write = WRITES.has(name), hash = fingerprint({ name, args });
    if (write) {
      stableKey(args.idempotency_key);
      await this.update(j => {
        const existing = j.operations.find(o => o.user_id === userId && o.key === args.idempotency_key);
        if (existing && existing.fingerprint !== hash) throw new Error('IDEMPOTENCY_CONFLICT: use the original parameters and key.');
        if (name === 'separate_layers') {
          if (args.user_confirmed !== true) throw new Error('LAYER_QUOTE_REQUIRED: obtain explicit confirmation of the current quote.');
          const replay = existing && ['submitted_or_unknown', 'accepted'].includes(existing.state);
          if (!replay) {
            const quote = j.operations.find(o => o.user_id === userId && o.tool === 'quote_layer_separation' && o.state === 'accepted' && o.result?.quote_id === args.quote_id)?.result;
            if (!quote || quote.document_id !== args.document_id || quote.delivery_target !== args.delivery_target || quote.can_run !== true || !(Date.parse(quote.expires_at) > this.now())) throw new Error('LAYER_QUOTE_STALE: obtain an affordable matching quote and ask the user to confirm.');
            if (j.operations.some(o => o.user_id === userId && o.tool === name && o.args.quote_id === args.quote_id && o.key !== args.idempotency_key && ['submitted_or_unknown', 'accepted'].includes(o.state))) throw new Error('QUOTE_ALREADY_SUBMITTED: recover the original separation; do not submit another key.');
          }
        }
        if (!existing) j.operations.push({ user_id: userId, tool: name, key: args.idempotency_key, args, fingerprint: hash, state: 'submitted_or_unknown', created_at: new Date(this.now()).toISOString() });
        else if (existing.state !== 'accepted') existing.state = 'submitted_or_unknown';
      });
    }
    let value;
    try { value = resultValue(await this.connection.call(name, args, { signal })); }
    catch (error) {
      if (write && error.serviceError) await this.update(j => {
        const op = j.operations.find(o => o.user_id === userId && o.key === args.idempotency_key);
        if (op.state !== 'accepted') op.state = 'service_error';
        op.error_code = error.code;
      });
      if (error.serviceError || signal?.aborted) throw error;
      throw new Error('MCP request interrupted. Original parameters and key are saved; query the original task or replay that exact operation. No replacement task was submitted.');
    }
    // Validate external editor targets before delivery or persistence.
    if (value.editor_url) editorUrl(value.editor_url);
    await this.update(j => {
      const saved = record(value);
      if (write) {
        const op = j.operations.find(o => o.user_id === userId && o.key === args.idempotency_key);
        op.state = 'accepted'; op.result = saved;
      }
      const kind = ['export_layer_psd', 'get_layer_export'].includes(name) ? 'export' : 'separation';
      const id = kind === 'export' ? value.job?.id : value.separation?.id;
      if (id) {
        const state = (kind === 'export' ? value.job : value.separation).status;
        const task = { user_id: userId, kind, id, status: state, result: saved, observed_at: new Date(this.now()).toISOString(), next_poll_at: TERMINAL.has(state) ? null : this.now() + Math.max(15000, Number(value.poll_after_ms) || 0) };
        const i = j.tasks.findIndex(t => t.user_id === userId && t.kind === kind && t.id === id);
        if (i < 0) j.tasks.push(task); else j.tasks[i] = task;
      }
    });
    return value;
  }
  async resume(signal) {
    const account = await this.account(signal), j = await this.store.read('tasks.json');
    const owned = key => (j?.[key] ?? []).filter(o => o.user_id === account.user.id);
    return { account_id: account.user.id, observed_at: new Date(this.now()).toISOString(), operations: owned('operations'), tasks: owned('tasks'), files: owned('files'), message: 'Saved records only, not live status or additional charges. Query separation IDs with get_layer_separation, export job IDs with get_layer_export. File ticket pending does not mean the task is pending. Replay unknown writes with original keys and parameters.' };
  }
  async wait({ kind, task_id, seconds = 45 }, signal) {
    if (!['separation', 'export'].includes(kind) || typeof task_id !== 'string' || !task_id || !Number.isInteger(seconds) || seconds < 1 || seconds > 45) throw new Error('Use separation/export, the original task_id, and 1–45 seconds.');
    const account = await this.account(signal), deadline = this.now() + seconds * 1000;
    let value;
    while (true) {
      signal?.throwIfAborted();
      const journal = await this.store.read('tasks.json');
      const saved = journal?.tasks.find(t => t.user_id === account.user.id && t.kind === kind && t.id === task_id);
      const wait = Math.max(0, (saved?.next_poll_at ?? 0) - this.now());
      if (this.now() + wait >= deadline) {
        const remaining = Math.max(0, deadline - this.now());
        if (remaining) await this.sleep(remaining, signal);
        return { done: false, kind, task_id, result: value ?? saved?.result ?? null, next_poll_after_ms: Math.max(0, (saved?.next_poll_at ?? 0) - this.now()), next: 'Call shenhuo_editor_wait_for_result again for this same kind and task_id until terminal. No background watcher is running.' };
      }
      if (wait) await this.sleep(wait, signal);
      value = await this.call(kind === 'export' ? 'get_layer_export' : 'get_layer_separation', kind === 'export' ? { export_job_id: task_id } : { separation_id: task_id }, { signal });
      const status = (kind === 'export' ? value.job : value.separation)?.status;
      if (TERMINAL.has(status)) return { done: true, kind, task_id, status, result: value };
      if (!status) throw new Error('Missing task status; preserve the original ID and inspect the service response.');
    }
  }
}
