import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workflow, TOOLS } from '../src/workflow.js';
import { PrivateStore } from '../src/store.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'shenhuo-layers-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new PrivateStore(dir), calls = [];
  let now = Date.now(), user = 'user-a', dropped = false, polls = 0;
  const connection = {
    async tools() { return [...TOOLS].map(name => ({ name, inputSchema: { type: 'object' } })); },
    async call(name, args) {
      calls.push({ name, args });
      let value;
      if (name === 'get_account') value = { user: { id: user } };
      if (name === 'quote_layer_separation') value = { quote_id: 'quote-' + args.asset_id, document_id: 'doc-' + args.asset_id, delivery_target: args.delivery_target, can_run: args.asset_id !== 'poor', estimated_credits: 60, expires_at: new Date(now + 600000).toISOString() };
      if (name === 'separate_layers') {
        if (dropped) { dropped = false; throw new Error('connection reset'); }
        value = { separation: { id: 'sep-1', status: 'processing', delivery_target: args.delivery_target }, document: { id: args.document_id, revision: 1 }, poll_after_ms: 15000 };
      }
      if (name === 'get_layer_separation') value = { separation: { id: args.separation_id, status: ++polls > 1 ? 'succeeded' : 'processing', delivery_target: 'document', export_id: null }, document: { id: 'doc-image', revision: 2 }, ...(polls > 1 ? { editor_url: 'https://www.shenhuoai.com/agent/layer-editor/doc-image' } : {}), poll_after_ms: 15000 };
      if (name === 'export_layer_psd') value = { job: { id: 'job-1', status: 'running' }, document_id: 'doc-image', document_revision: args.document_revision };
      if (name === 'get_layer_export') value = { job: { id: args.export_job_id, status: 'succeeded', export: { id: 'exp-1' } } };
      if (name === 'get_layer_result') value = { status: 'pending', download_url: 'https://api.shenhuoai.com/external/mcp-files/SECRET-TICKET', filename: 'result.psd' };
      return { structuredContent: value, content: [] };
    }
  };
  const flow = new Workflow(connection, store, { now: () => now, sleep: async ms => { now += ms; } });
  return { flow, store, calls, connection, setUser: v => { user = v; }, advance: ms => { now += ms; }, drop: () => { dropped = true; } };
}
const quote = { asset_id: 'image', delivery_target: 'document', idempotency_key: 'quote-1' };
const submit = { document_id: 'doc-image', quote_id: 'quote-image', delivery_target: 'document', user_confirmed: true, idempotency_key: 'separate-1' };

test('paid separation needs an affordable matching quote and explicit confirmation; rejected calls never reach MCP', async t => {
  const f = await fixture(t);
  await assert.rejects(f.flow.call('separate_layers', submit), /QUOTE_STALE/);
  await f.flow.call('quote_layer_separation', quote);
  await assert.rejects(f.flow.call('separate_layers', { ...submit, user_confirmed: false }), /QUOTE_REQUIRED/);
  await assert.rejects(f.flow.call('separate_layers', { ...submit, delivery_target: 'psd' }), /QUOTE_STALE/);
  await f.flow.call('quote_layer_separation', { ...quote, asset_id: 'poor', idempotency_key: 'poor-quote' });
  await assert.rejects(f.flow.call('separate_layers', { ...submit, quote_id: 'quote-poor', document_id: 'doc-poor' }), /QUOTE_STALE/);
  assert.equal(f.calls.filter(c => c.name === 'separate_layers').length, 0);
  await f.flow.call('separate_layers', submit);
  await assert.rejects(f.flow.call('separate_layers', { ...submit, idempotency_key: 'second-separation' }), /QUOTE_ALREADY_SUBMITTED/);
});

test('timeout survives restart with original parameters; expiry permits only the same unknown write, never new spending', async t => {
  const f = await fixture(t);
  await f.flow.call('quote_layer_separation', quote);
  f.drop();
  await assert.rejects(f.flow.call('separate_layers', submit), /original|原/);
  f.advance(700000);
  const resumed = new Workflow(f.connection, f.store);
  const history = await resumed.resume();
  assert.deepEqual(history.operations.find(o => o.tool === 'separate_layers').args, submit);
  assert.equal((await resumed.call('separate_layers', submit)).separation.id, 'sep-1');
  await assert.rejects(resumed.call('separate_layers', { ...submit, document_id: 'other' }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(resumed.call('separate_layers', { ...submit, idempotency_key: 'second' }), /QUOTE_ALREADY_SUBMITTED|QUOTE_STALE/);
  f.setUser('user-b');
  assert.equal((await resumed.resume()).operations.length, 0);
  await assert.rejects(resumed.call('separate_layers', submit), /QUOTE_STALE/);
});

test('document delivery is terminal without a PSD; independent export uses job ID and file delivery uses export ID', async t => {
  const f = await fixture(t);
  await f.flow.call('quote_layer_separation', quote);
  await f.flow.call('separate_layers', submit);
  const result = await f.flow.wait({ kind: 'separation', task_id: 'sep-1', seconds: 45 });
  assert.equal(result.done, true);
  assert.equal(result.result.separation.export_id, null);
  assert.equal(result.result.editor_url, 'https://www.shenhuoai.com/agent/layer-editor/doc-image');
  const exp = await f.flow.call('export_layer_psd', { separation_id: 'sep-1', document_revision: 2, idempotency_key: 'export-1' });
  const exported = await f.flow.wait({ kind: 'export', task_id: exp.job.id, seconds: 45 });
  assert.equal(exported.result.job.export.id, 'exp-1');
  await f.flow.call('get_layer_result', { export_id: 'exp-1', idempotency_key: 'download-1' });
  const journal = await readFile(f.store.path('tasks.json'), 'utf8');
  assert(!journal.includes('SECRET-TICKET'));
  assert(journal.includes('sep-1') && journal.includes('job-1') && journal.includes('exp-1'));
  assert.equal(f.calls.filter(c => c.name === 'separate_layers').length, 1);
});

test('expired unsubmitted quote is rejected, and stopping a wait does not cancel the remote task', async t => {
  const f = await fixture(t);
  await f.flow.call('quote_layer_separation', quote);
  f.advance(700000);
  await assert.rejects(f.flow.call('separate_layers', submit), /QUOTE_STALE/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.flow.wait({ kind: 'separation', task_id: 'sep-1' }, abort.signal), /abort/i);
  assert.equal(f.calls.filter(c => c.name === 'cancel_layer_separation').length, 0);
});

test('long server interval causes a real bounded wait, then resumes the same task; failed export does not repeat separation', async t => {
  const f = await fixture(t); let time = Date.now(), slept = 0;
  const original = f.connection.call;
  f.connection.call = async (name, args) => name === 'get_layer_export' ? { structuredContent: { job: { id: args.export_job_id, status: 'failed', error_code: 'RENDER_FAILED' } } } : original(name, args);
  await f.store.write('tasks.json', { operations: [], files: [], tasks: [{ user_id: 'user-a', kind: 'export', id: 'job-slow', next_poll_at: time + 90000 }] });
  const flow = new Workflow(f.connection, f.store, { now: () => time, sleep: async ms => { slept += ms; time += ms; } });
  const a = await flow.wait({ kind: 'export', task_id: 'job-slow' });
  assert.equal(a.done, false); assert.equal(slept, 45000); assert.equal(a.next_poll_after_ms, 45000);
  const b = await flow.wait({ kind: 'export', task_id: 'job-slow' });
  assert.equal(b.done, false); assert.equal(slept, 90000);
  const c = await flow.wait({ kind: 'export', task_id: 'job-slow' });
  assert.equal(c.done, true); assert.equal(c.status, 'failed');
  assert.equal(f.calls.filter(c => c.name === 'separate_layers').length, 0);
});

test('version conflicts remain visible and do not silently select another revision', async t => {
  const f = await fixture(t); const original = f.connection.call;
  f.connection.call = async (name, args) => name === 'export_layer_psd' ? { isError: true, structuredContent: { error: { code: 'REVISION_CONFLICT', message: 'Read and confirm the current revision.' } } } : original(name, args);
  await assert.rejects(f.flow.call('export_layer_psd', { separation_id: 'sep-1', document_revision: 2, idempotency_key: 'exp' }), /REVISION_CONFLICT/);
  const history = await f.flow.resume();
  assert.equal(history.operations[0].error_code, 'REVISION_CONFLICT');
  assert.equal(history.operations[0].args.document_revision, 2);
  assert.equal(f.calls.filter(c => c.name === 'separate_layers').length, 0);
});
