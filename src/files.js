import { readFile, mkdir, realpath, stat, open, link, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join, parse } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { stableKey } from './workflow.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function assertWithin(root, target) {
  const part = relative(root, target);
  if (part === '..' || part.startsWith('../') || part.startsWith('..\\') || isAbsolute(part)) throw new Error('File must be inside the current local workspace. Copy the selected image there first.');
}
export async function workspacePath(cwd, path, directory = false) {
  const root = await realpath(cwd), target = resolve(root, path);
  assertWithin(root, target);
  if (!directory) { const actual = await realpath(target); assertWithin(root, actual); return actual; }
  let current = root;
  for (const part of relative(root, target).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    await mkdir(current, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
    assertWithin(root, await realpath(current));
  }
  return realpath(target);
}
export function imageType(b) {
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString())) return 'image/gif';
  return null;
}
export function psdHeader(b) {
  if (b.length < 26 || b.toString('ascii', 0, 4) !== '8BPS' || b.readUInt16BE(4) !== 1 || b.subarray(6, 12).some(v => v !== 0)) throw new Error('Download is not a PSD document.');
  const channels = b.readUInt16BE(12), height = b.readUInt32BE(14), width = b.readUInt32BE(18), depth = b.readUInt16BE(22);
  if (channels < 1 || channels > 56 || width < 1 || height < 1 || width > 30000 || height > 30000 || ![1, 8, 16, 32].includes(depth)) throw new Error('Invalid PSD header.');
  return { width, height, channels, depth };
}
export class FileTransfers {
  constructor(flow, { origin = 'https://api.shenhuoai.com', allowLocalTest = false, fetchImpl = fetch } = {}) {
    if (!allowLocalTest && origin !== 'https://api.shenhuoai.com') throw new Error('Only official Shenhuo file transfers are supported.');
    this.flow = flow; this.origin = origin; this.fetch = fetchImpl;
  }
  async request(url, options = {}) {
    const u = new URL(url);
    if (u.origin !== this.origin || !/^\/external\/mcp-files\/[^/]+$/.test(u.pathname) || u.username || u.password || u.search || u.hash) throw new Error('Invalid file ticket origin or path.');
    const timeout = AbortSignal.timeout(180000);
    // The short-lived ticket authorizes these bytes. No OAuth header or website cookies.
    const response = await this.fetch(u, { ...options, redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`File transfer HTTP ${response.status}. Query the upload or request a fresh download ticket with a new delivery key; never repeat separation.`); }
    return response;
  }
  async upload(args, cwd, signal) {
    stableKey(args.idempotency_key);
    const path = await workspacePath(cwd, args.path), info = await stat(path);
    if (!info.isFile() || info.size < 1 || info.size > 20 * 1024 * 1024) throw new Error('Upload needs a nonempty image of at most 20 MiB.');
    const bytes = await readFile(path), sha256 = hash(bytes), mime = imageType(bytes);
    if (!mime) throw new Error('Layer separation accepts only uploaded PNG, JPEG, WebP or GIF images.');
    const userId = (await this.flow.account(signal)).user.id;
    await this.flow.update(j => {
      const previous = j.files.find(f => f.user_id === userId && f.kind === 'upload' && f.key === args.idempotency_key);
      if (previous && previous.sha256 !== sha256) throw new Error('IDEMPOTENCY_CONFLICT: this upload key belongs to different image bytes.');
      if (!previous) j.files.push({ user_id: userId, kind: 'upload', key: args.idempotency_key, sha256, path });
    });
    const ticket = await this.flow.call('create_upload', { filename: parse(path).base, mime_type: mime, role: 'reference', label: args.label ?? '', idempotency_key: args.idempotency_key }, { signal });
    const prior = await this.flow.call('get_upload', { transfer_id: ticket.transfer_id }, { signal });
    if (!prior.receipt?.asset_id) {
      if (!Number.isFinite(ticket.max_bytes) || bytes.length > ticket.max_bytes) throw new Error('Image exceeds the upload ticket limit.');
      const response = await this.request(ticket.upload_url, { method: 'PUT', headers: { 'content-type': mime }, body: bytes, signal });
      await response.body?.cancel();
    }
    const result = await this.flow.call('get_upload', { transfer_id: ticket.transfer_id }, { signal });
    if (!result.receipt?.asset_id || result.receipt.sha256 !== sha256) throw new Error('Upload receipt or SHA-256 mismatch. Do not submit this asset.');
    await this.flow.update(j => Object.assign(j.files.find(f => f.user_id === userId && f.kind === 'upload' && f.key === args.idempotency_key), { transfer_id: ticket.transfer_id, asset_id: result.receipt.asset_id }));
    return { ...result, transfer_id: ticket.transfer_id, sha256 };
  }
  async download(args, cwd, signal) {
    const directory = await workspacePath(cwd, args.directory ?? 'shenhuo-layers', true);
    const ticket = await this.flow.call('get_layer_result', { export_id: args.export_id, idempotency_key: args.idempotency_key }, { signal });
    const filename = ticket.filename;
    if (typeof filename !== 'string' || /[\\/:\x00-\x1f]/.test(filename) || !/\.psd$/i.test(filename) || filename.length > 240) throw new Error('Unsafe or missing PSD filename.');
    const response = await this.request(ticket.download_url, { signal });
    const limit = 512 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('PSD exceeds the 512 MiB download limit.'); }
    const temporary = join(directory, `.shenhuo-${randomUUID()}.part`);
    const handle = await open(temporary, 'wx', 0o600), digest = createHash('sha256');
    let length = 0, header = Buffer.alloc(0), path;
    try {
      for await (const chunk of response.body) {
        signal?.throwIfAborted(); length += chunk.length;
        if (length > limit) throw new Error('PSD exceeds the 512 MiB download limit.');
        if (header.length < 26) header = Buffer.concat([header, chunk.subarray(0, 26 - header.length)]);
        digest.update(chunk); await handle.writeFile(chunk);
      }
      const dimensions = psdHeader(header);
      if (length < 40) throw new Error('Truncated PSD file.');
      const declaredLength = response.headers.get('content-length');
      if (declaredLength && Number(declaredLength) !== length) throw new Error('PSD content length mismatch.');
      await handle.sync(); await handle.close();
      const parsed = parse(filename);
      for (let n = 0; n < 1000; n++) {
        const candidate = join(directory, n ? `${parsed.name}-${n}${parsed.ext}` : filename);
        try { await link(temporary, candidate); path = candidate; break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
      }
      if (!path) throw new Error('No unused output filename.');
      const result = { export_id: args.export_id, path, filename: parse(path).base, bytes: length, sha256: digest.digest('hex'), mime_type: 'image/vnd.adobe.photoshop', ...dimensions, downloaded: true };
      const userId = (await this.flow.account(signal)).user.id;
      await this.flow.update(j => { j.files.push({ user_id: userId, kind: 'download', ...result }); });
      return result;
    } finally { await handle.close().catch(() => {}); await rm(temporary, { force: true }); }
  }
}
