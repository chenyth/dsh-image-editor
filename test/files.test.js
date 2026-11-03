import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FileTransfers, psdHeader } from '../src/files.js';

export function psdFixture() {
  // Actual minimal 1x1 RGB PSD: header, three empty sections, raw image data.
  const b = Buffer.alloc(43); b.write('8BPS'); b.writeUInt16BE(1, 4); b.writeUInt16BE(3, 12);
  b.writeUInt32BE(1, 14); b.writeUInt32BE(1, 18); b.writeUInt16BE(8, 22); b.writeUInt16BE(3, 24); b.fill(255, 40); return b;
}
test('original image bytes upload; PSD streaming verifies header/hash and never overwrites or escapes workspace', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-layer-files-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4ZkAAAAASUVORK5CYII=', 'base64');
  const sha256 = createHash('sha256').update(png).digest('hex'), psd = psdFixture(), journal = { files: [] };
  let received, authorization, failDownload = false;
  const server = createServer(async (req, res) => {
    authorization = req.headers.authorization;
    if (req.method === 'PUT') { const chunks = []; for await (const c of req) chunks.push(c); received = Buffer.concat(chunks); res.end('{}'); }
    else { res.setHeader('content-type', failDownload ? 'text/html' : 'image/vnd.adobe.photoshop'); res.end(failDownload ? '<html>Login</html>' : psd); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const flow = { account: async () => ({ user: { id: 'user-a' } }), update: async fn => fn(journal), async call(name, args) {
    if (name === 'create_upload') return { transfer_id: 'upload-1', upload_url: origin + '/external/mcp-files/upload', max_bytes: 20000000 };
    if (name === 'get_upload') return received ? { status: 'complete', receipt: { asset_id: 'asset-1', sha256 } } : { status: 'pending' };
    assert.equal(name, 'get_layer_result'); assert.equal(args.export_id, 'exp-1');
    return { download_url: origin + '/external/mcp-files/download', filename: 'result.psd' };
  } };
  const files = new FileTransfers(flow, { origin, allowLocalTest: true });
  await writeFile(join(cwd, 'input.png'), png);
  const upload = await files.upload({ path: 'input.png', idempotency_key: 'upload-1' }, cwd);
  assert.equal(upload.receipt.asset_id, 'asset-1'); assert.deepEqual(received, png); assert.equal(authorization, undefined);
  const a = await files.download({ export_id: 'exp-1', idempotency_key: 'delivery-1' }, cwd);
  const b = await files.download({ export_id: 'exp-1', idempotency_key: 'delivery-2' }, cwd);
  assert.notEqual(a.path, b.path); assert.deepEqual(await readFile(a.path), psd);
  assert.equal(a.sha256, createHash('sha256').update(psd).digest('hex'));
  assert.equal(a.width, 1); assert.equal(a.downloaded, true);
  failDownload = true;
  await assert.rejects(files.download({ export_id: 'exp-1', idempotency_key: 'bad' }, cwd), /PSD/);
  assert(!(await readdir(join(cwd, 'shenhuo-layers'))).some(f => f.endsWith('.part')));
  await assert.rejects(files.upload({ path: '../outside.png', idempotency_key: 'outside' }, cwd), /workspace/);
  await symlink(tmpdir(), join(cwd, 'outside'));
  await assert.rejects(files.download({ export_id: 'exp-1', directory: 'outside', idempotency_key: 'outside' }, cwd), /workspace/);
  await assert.rejects(files.request('https://wrong.example/external/mcp-files/ticket'), /Invalid/);
  await assert.rejects(files.request(origin + '/external/mcp-files/ticket?token=bad'), /Invalid/);
  assert.throws(() => psdHeader(Buffer.from('8BPS')), /PSD/);
});
