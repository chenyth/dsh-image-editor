import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LocalConnection } from '../src/connection.js';
import { PrivateStore } from '../src/store.js';
import { Workflow, TOOLS } from '../src/workflow.js';
import { FileTransfers } from '../src/files.js';

// Full SDK Streamable HTTP protocol and raw file transfer. This server is a
// contract fixture, not a production renderer or a paid model.
test('real MCP wire completes upload → quote → document → export → verified PSD and one-step PSD', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-layer-wire-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4ZkAAAAASUVORK5CYII=', 'base64');
  const psd = Buffer.alloc(43); psd.write('8BPS'); psd.writeUInt16BE(1, 4); psd.writeUInt16BE(3, 12); psd.writeUInt32BE(1, 14); psd.writeUInt32BE(1, 18); psd.writeUInt16BE(8, 22); psd.writeUInt16BE(3, 24);
  let origin, uploaded = false, now = Date.now(); const calls = [], accepted = new Map();
  const server = createServer(async (req, res) => {
    if (req.url.startsWith('/external/mcp-files/')) {
      assert.equal(req.headers.authorization, undefined);
      if (req.method === 'PUT') { const chunks = []; for await (const c of req) chunks.push(c); assert.deepEqual(Buffer.concat(chunks), png); uploaded = true; res.end('{}'); }
      else { res.setHeader('content-type', 'image/vnd.adobe.photoshop'); res.end(psd); }
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    let body = ''; for await (const c of req) body += c;
    const message = JSON.parse(body); if (!('id' in message)) { res.writeHead(202); res.end(); return; }
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
    else if (message.method === 'tools/list') result = { tools: [...TOOLS].map(name => ({ name, inputSchema: { type: 'object' } })) };
    else {
      const { name, arguments: a } = message.params; calls.push({ name, args: a }); let v;
      switch (name) {
        case 'get_account': v = { user: { id: 'wire-user' } }; break;
        case 'create_upload': v = { transfer_id: 'upload-1', upload_url: origin + '/external/mcp-files/upload', max_bytes: 20000000 }; break;
        case 'get_upload': v = uploaded ? { status: 'complete', receipt: { asset_id: 'asset-1', sha256: createHash('sha256').update(png).digest('hex') } } : { status: 'pending' }; break;
        case 'quote_layer_separation': v = { quote_id: 'quote-' + a.delivery_target, document_id: 'doc-1', delivery_target: a.delivery_target, estimated_credits: 60, can_run: true, expires_at: new Date(now + 600000).toISOString() }; break;
        case 'separate_layers': accepted.set(a.delivery_target, a.idempotency_key); v = { separation: { id: 'sep-' + a.delivery_target, status: 'processing', delivery_target: a.delivery_target }, poll_after_ms: 15000 }; break;
        case 'get_layer_separation': v = { separation: { id: a.separation_id, status: 'succeeded', delivery_target: a.separation_id.endsWith('psd') ? 'psd' : 'document', export_id: a.separation_id.endsWith('psd') ? 'exp-1' : null }, document: { id: 'doc-1', revision: 2 }, editor_url: 'https://www.shenhuoai.com/agent/layer-editor/doc-1' }; break;
        case 'get_layer_editor': v = { document_id: 'doc-1', document_revision: 2, editor_url: 'https://www.shenhuoai.com/agent/layer-editor/doc-1' }; break;
        case 'export_layer_psd': assert.equal(a.document_revision, 2); v = { job: { id: 'job-1', status: 'running' }, document_revision: 2 }; break;
        case 'get_layer_export': assert.equal(a.export_job_id, 'job-1'); v = { job: { id: 'job-1', status: 'succeeded', export: { id: 'exp-1' } } }; break;
        case 'get_layer_result': assert.equal(a.export_id, 'exp-1'); v = { filename: 'layers.psd', download_url: origin + '/external/mcp-files/SECRET', status: 'pending' }; break;
        default: throw new Error(name);
      }
      result = { structuredContent: v, content: [{ type: 'text', text: JSON.stringify(v) }] };
    }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const connection = new LocalConnection({ resource: origin + '/mcp', authenticatedFetch: fetch });
  t.after(async () => { await connection.dispose(); await new Promise(resolve => server.close(resolve)); });
  const store = new PrivateStore(join(dir, 'private'));
  const flow = new Workflow(connection, store, { now: () => now, sleep: async ms => { now += ms; } });
  const files = new FileTransfers(flow, { origin, allowLocalTest: true });
  await writeFile(join(dir, 'input.png'), png);
  const uploadedResult = await files.upload({ path: 'input.png', idempotency_key: 'up' }, dir);
  for (const delivery_target of ['document', 'psd']) {
    const quote = await flow.call('quote_layer_separation', { asset_id: uploadedResult.receipt.asset_id, delivery_target, idempotency_key: 'quote-' + delivery_target });
    const submitted = await flow.call('separate_layers', { document_id: quote.document_id, quote_id: quote.quote_id, delivery_target, user_confirmed: true, idempotency_key: 'submit-' + delivery_target });
    const done = await flow.wait({ kind: 'separation', task_id: submitted.separation.id });
    assert(done.done); assert(done.result.editor_url);
    if (delivery_target === 'document') {
      const editor = await flow.call('get_layer_editor', { separation_id: submitted.separation.id });
      const exported = await flow.call('export_layer_psd', { separation_id: submitted.separation.id, document_revision: editor.document_revision, idempotency_key: 'export' });
      const doneExport = await flow.wait({ kind: 'export', task_id: exported.job.id });
      assert.equal(doneExport.result.job.export.id, 'exp-1');
    }
    const downloaded = await files.download({ export_id: 'exp-1', idempotency_key: 'download-' + delivery_target }, dir);
    assert(downloaded.downloaded); assert.deepEqual(await readFile(downloaded.path), psd);
  }
  assert.equal(accepted.size, 2); assert.equal(calls.filter(c => c.name === 'export_layer_psd').length, 1);
  const saved = await readFile(store.path('tasks.json'), 'utf8'); assert(!saved.includes('SECRET'));
});
