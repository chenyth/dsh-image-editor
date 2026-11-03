import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const RESOURCE = 'https://api.shenhuoai.com/external/mcp';
export const ISSUER = 'https://www.shenhuoai.com';
const random = () => randomBytes(32).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class OAuthSession {
  constructor(store, { issuer = ISSUER, resource = RESOURCE, allowLocalTest = false, fetchImpl = fetch } = {}) {
    this.store = store; this.issuer = issuer; this.resource = resource; this.fetch = fetchImpl;
    if (!allowLocalTest && (issuer !== ISSUER || resource !== RESOURCE)) throw new Error('Only the official Shenhuo service is supported.');
  }
  async request(url, options = {}) {
    if (new URL(url).origin !== new URL(this.issuer).origin) throw new Error('OAuth endpoint origin mismatch.');
    const response = await this.fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      let code = 'oauth_error'; try { const data = await response.json(); if (/^[a-z_]+$/.test(data.error)) code = data.error; } catch {}
      const error = new Error(`OAuth ${response.status}: ${code}. Reconnect if authorization expired.`);
      error.code = code; throw error;
    }
    return response.json();
  }
  async metadata() {
    if (!this.meta) {
      const meta = await this.request(this.issuer + '/.well-known/oauth-authorization-server');
      if (meta.issuer !== this.issuer) throw new Error('OAuth issuer mismatch.');
      for (const field of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint']) {
        if (new URL(meta[field]).origin !== new URL(this.issuer).origin) throw new Error('OAuth endpoint origin mismatch.');
      }
      this.meta = meta;
    }
    return this.meta;
  }
  async status() {
    const auth = await this.store.read('auth.json');
    const pending = ['starting', 'awaiting_authorization', 'exchanging_code'].includes(this.pending?.status);
    return { status: pending ? this.pending.status : (auth?.access_token ? 'authorized' : (this.pending?.status === 'authorized' ? 'not_connected' : this.pending?.status ?? 'not_connected')), expires_at: auth?.expires_at ?? null };
  }
  async begin() {
    if (this.pending?.status === 'awaiting_authorization') return { status: this.pending.status, authorization_url: this.pending.url };
    await this.dispose();
    const meta = await this.metadata();
    const saved = await this.store.read('registration.json');
    const verifier = random(); const state = random();
    let resolveDone;
    this.done = new Promise(resolve => { resolveDone = resolve; });
    this.pending = { status: 'starting' };
    const server = this.server = createServer((req, res) => { void this.callback(req, res, { state, verifier, resolveDone }).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('Authorization could not be completed. Return to DSH and reconnect.');
      this.finish('authorization_failed', resolveDone);
    }); });
    const listen = port => new Promise((resolve, reject) => {
      const failure = error => { server.off('listening', ready); reject(error); };
      const ready = () => { server.off('error', failure); resolve(); };
      server.once('error', failure); server.once('listening', ready); server.listen(port, '127.0.0.1');
    });
    try { await listen(saved?.port ?? 0); } catch (error) { if (error.code !== 'EADDRINUSE') throw error; await listen(0); }
    const port = server.address().port;
    const redirect = `http://127.0.0.1:${port}/oauth/callback`;
    try {
      let registration = saved;
      if (!registration || registration.port !== port || registration.issuer !== this.issuer) {
        const value = await this.request(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Shenhuo Image Editor for DSH', client_uri: 'https://github.com/chenyth/dsh-image-editor', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
        if (typeof value.client_id !== 'string') throw new Error('OAuth registration did not return a client ID.');
        registration = { client_id: value.client_id, port, issuer: this.issuer };
        await this.store.write('registration.json', registration);
      }
      this.pending.client_id = registration.client_id; this.pending.redirect = redirect;
      const url = new URL(meta.authorization_endpoint);
      url.search = new URLSearchParams({ response_type: 'code', client_id: registration.client_id, redirect_uri: redirect, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: this.resource }).toString();
      this.pending.url = url.href; this.pending.status = 'awaiting_authorization';
      this.timer = setTimeout(() => this.finish('authorization_expired', resolveDone), 600_000); this.timer.unref();
      return { status: this.pending.status, authorization_url: url.href, message: 'Open the authorization link in a browser on the same computer as DSH, log into Shenhuo, and approve. Then return to DSH and check status. Registration: https://www.shenhuoai.com/register' };
    } catch (error) { await this.dispose(); throw error; }
  }
  finish(status, resolveDone) {
    if (this.pending) this.pending.status = status;
    clearTimeout(this.timer); this.server?.close(); resolveDone({ status });
  }
  async callback(req, res, { state, verifier, resolveDone }) {
    res.setHeader('cache-control', 'no-store'); res.setHeader('referrer-policy', 'no-referrer'); res.setHeader('content-type', 'text/plain; charset=utf-8');
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/oauth/callback') { res.writeHead(404); res.end(); return; }
    if (this.pending?.status !== 'awaiting_authorization' || !equal(url.searchParams.get('state'), state) || url.searchParams.get('iss') !== this.issuer || [...url.searchParams.keys()].some(k => url.searchParams.getAll(k).length !== 1)) {
      res.writeHead(400); res.end('Invalid authorization state or issuer.'); return;
    }
    if (url.searchParams.has('error')) { res.writeHead(200); res.end('Authorization was declined. Return to DSH.'); this.finish('authorization_denied', resolveDone); return; }
    if (!url.searchParams.get('code')) { res.writeHead(400); res.end('Missing authorization code.'); return; }
    this.pending.status = 'exchanging_code';
    const tokens = await this.request((await this.metadata()).token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code'), client_id: this.pending.client_id, redirect_uri: this.pending.redirect, code_verifier: verifier, resource: this.resource }).toString() });
    await this.saveTokens(tokens, this.pending.client_id);
    res.writeHead(200); res.end('神火授权完成。请返回 DSH，回复“已授权”。\nShenhuo authorization complete. Return to DSH.');
    this.finish('authorized', resolveDone);
    try { await this.onAuthorized?.(); } catch { /* The next tool call retries MCP discovery. */ }
  }
  async saveTokens(tokens, clientId, oldRefresh) {
    if (tokens.token_type?.toLowerCase() !== 'bearer' || typeof tokens.access_token !== 'string' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new Error('Invalid OAuth token response.');
    await this.store.write('auth.json', { client_id: clientId, access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? oldRefresh, expires_at: Date.now() + tokens.expires_in * 1000, issuer: this.issuer, resource: this.resource });
  }
  async accessToken(force = false, rejectedToken) {
    return this.store.locked('auth.json', async () => {
      const auth = await this.store.read('auth.json');
      if (!auth?.access_token || auth.issuer !== this.issuer || auth.resource !== this.resource) throw new Error('OAUTH_REAUTHORIZATION_REQUIRED: use shenhuo_editor_connect and authorize in the browser.');
      if ((!force || (rejectedToken && auth.access_token !== rejectedToken)) && auth.expires_at > Date.now() + 60_000) return auth.access_token;
      if (!auth.refresh_token) throw new Error('OAUTH_REAUTHORIZATION_REQUIRED: reconnect to Shenhuo.');
      try {
        const tokens = await this.request((await this.metadata()).token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refresh_token, client_id: auth.client_id, resource: this.resource }).toString() });
        await this.saveTokens(tokens, auth.client_id, auth.refresh_token);
        return tokens.access_token;
      } catch (error) { if (error.code === 'invalid_grant') await this.store.remove('auth.json'); throw error; }
    });
  }
  async authenticatedFetch(url, options = {}) {
    const target = new URL(url);
    const resource = new URL(this.resource);
    if (target.origin !== resource.origin || target.pathname !== resource.pathname) throw new Error('Refusing to send authorization outside the official MCP endpoint.');
    const token = await this.accessToken();
    const send = value => { const headers = new Headers(options.headers); headers.set('authorization', `Bearer ${value}`); return this.fetch(url, { ...options, headers, redirect: 'error' }); };
    let response = await send(token);
    if (response.status === 401 || (response.status === 403 && /insufficient_scope/.test(response.headers.get('www-authenticate') ?? ''))) { await response.body?.cancel(); response = await send(await this.accessToken(true, token)); }
    return response;
  }
  async disconnect() {
    const auth = await this.store.read('auth.json');
    if (auth?.access_token) await this.request((await this.metadata()).revocation_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: auth.refresh_token ?? auth.access_token, client_id: auth.client_id }).toString() });
    await this.store.remove('auth.json'); await this.dispose();
    return { status: 'disconnected', message: 'Authorization revoked. Existing design task records are preserved.' };
  }
  wait() { return this.done ?? this.status(); }
  async dispose() { clearTimeout(this.timer); if (this.server?.listening) await new Promise(resolve => this.server.close(resolve)); this.server = null; }
}
