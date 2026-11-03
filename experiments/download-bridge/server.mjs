// Local integration probe only. Never install this as the production plugin.
import { createServer } from 'node:http';
import { randomBytes, createHmac, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
export async function startProbe(config, { html, icon, clock = Date.now } = {}) {
  const secret = randomBytes(32), exports = new Map(), receipts = [];
  let origin;
  const sign = body => createHmac('sha256', secret).update(body).digest('base64url');
  const ticket = value => { const body = Buffer.from(JSON.stringify(value)).toString('base64url'); return `${body}.${sign(body)}`; };
  const verify = value => {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('invalid-ticket');
    const [body, mac, extra] = value.split('.');
    if (extra || !mac || !same(mac, sign(body))) throw new Error('invalid-ticket');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.aud !== config.runId || payload.exp <= clock()) throw new Error('expired-ticket');
    const row = exports.get(payload.id);
    if (!row || row.sha256 !== payload.sha256) throw new Error('invalid-ticket');
    return row;
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const browserOrigin = req.headers.origin;
    if (browserOrigin === 'dsh-app://app') {
      res.setHeader('Access-Control-Allow-Origin', browserOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    }
    const reply = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.host !== new URL(origin).host) return reply(403, { error: 'host-refused' });
      if (req.method === 'OPTIONS') { res.writeHead(browserOrigin === 'dsh-app://app' ? 204 : 403); return res.end(); }
      const url = new URL(req.url, origin);
      const authorizedPage = (req.headers.cookie ?? '').split('; ').includes(`probe_session=${config.pageKey}`);
      const authorizedClient = same(req.headers.authorization, `Bearer ${config.clientKey}`);
      const body = async () => {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('too-large'); chunks.push(chunk); }
        return Buffer.concat(chunks);
      };
      if (req.method === 'GET' && url.pathname === `/probe/${config.pageKey}`) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8',
          'Set-Cookie': `probe_session=${config.pageKey}; HttpOnly; SameSite=Strict; Path=/` });
        return res.end(html);
      }
      if (req.method === 'GET' && url.pathname === '/icon.png' && authorizedPage) {
        res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(icon);
      }
      if (req.method === 'POST' && url.pathname === '/exports') {
        if (!authorizedPage || browserOrigin !== origin) return reply(403, { error: 'page-session-required' });
        const bytes = await body();
        if (!bytes.subarray(0, 8).equals(PNG) || bytes.length < 24) return reply(400, { error: 'png-required' });
        const id = randomUUID(), sha256 = digest(bytes);
        const row = { id, bytes, sha256, used: false, saving: false };
        exports.set(id, row);
        return reply(201, { id, byteLength: bytes.length, sha256,
          handoff: `${origin}/handoff#ticket=${ticket({ id, sha256, aud: config.runId, exp: clock() + 60000 })}` });
      }
      if (req.method === 'GET' && url.pathname === '/download') {
        const row = verify((req.headers.authorization ?? '').replace(/^Bearer /, ''));
        if (row.used) return reply(409, { error: 'already-saved' });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': row.bytes.length }); return res.end(row.bytes);
      }
      if (req.method === 'POST' && url.pathname === '/save') {
        if (!authorizedClient) return reply(403, { error: 'client-capability-required' });
        const request = JSON.parse((await body()).toString());
        const row = verify(request.ticket);
        if (row.used || row.saving) return reply(409, { error: 'already-saved' });
        row.saving = true;
        try {
          // Read using only the one-file ticket: no WebView session/cookies.
          const response = await fetch(`${origin}/download`, { headers: { Authorization: `Bearer ${request.ticket}` }, redirect: 'error' });
          if (!response.ok) throw new Error('download-failed');
          const bytes = Buffer.from(await response.arrayBuffer());
          if (digest(bytes) !== row.sha256) throw new Error('digest-mismatch');
          await mkdir(config.output, { recursive: true });
          const path = join(config.output, `bridge-${row.id}.png`);
          await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
          row.used = true;
          const receipt = { status: 'saved', path, sha256: row.sha256, byteLength: bytes.length,
            usedWebsiteCookies: false, savedBy: 'dsh-plugin-host', runId: config.runId };
          receipts.push(receipt);
          await writeFile(join(config.output, 'receipt.json'), JSON.stringify(receipts, null, 2), { mode: 0o600 });
          return reply(200, receipt);
        } finally { row.saving = false; }
      }
      return reply(404, { error: 'not-found' });
    } catch (error) {
      const message = ['invalid-ticket', 'expired-ticket', 'too-large', 'digest-mismatch'].includes(error.message) ? error.message : 'probe-request-failed';
      reply(message === 'expired-ticket' ? 410 : 400, { error: message });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port ?? 0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}

export const name = 'dsh-image-editor-download-probe';
export function apply(ctx) {
  ctx.effect(() => {
    const ready = Promise.all([
      readFile(new URL('./config.json', import.meta.url), 'utf8').then(JSON.parse),
      readFile(new URL('./page.html', import.meta.url)), readFile(new URL('./icon.png', import.meta.url)),
    ]).then(([config, html, icon]) => startProbe(config, { html, icon }));
    return async () => { await (await ready).close(); };
  });
}
