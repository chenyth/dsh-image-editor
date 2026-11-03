import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { OAuthSession } from '../src/oauth.js';
import { PrivateStore } from '../src/store.js';

test('browser OAuth rejects the wrong state and issuer, then exchanges a PKCE code without exposing tokens', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-'));
  const requests = [];
  let origin;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, body });
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('.well-known')) res.end(JSON.stringify({ issuer: origin, authorization_endpoint: origin + '/authorize', registration_endpoint: origin + '/register', token_endpoint: origin + '/token', revocation_endpoint: origin + '/revoke' }));
    else if (req.url === '/register') res.end(JSON.stringify({ client_id: 'public-client' }));
    else res.end(JSON.stringify({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600, token_type: 'Bearer' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const session = new OAuthSession(new PrivateStore(dir), { issuer: origin, resource: origin + '/mcp', allowLocalTest: true });
  try {
    const started = await session.begin();
    const auth = new URL(started.authorization_url);
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(auth.searchParams.get('resource'), origin + '/mcp');
    const callback = new URL(auth.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: 'wrong', code: 'code', iss: origin }).toString();
    assert.equal((await fetch(callback)).status, 400);
    callback.searchParams.set('state', auth.searchParams.get('state'));
    callback.searchParams.set('iss', 'https://wrong.example');
    assert.equal((await fetch(callback)).status, 400);
    callback.searchParams.set('iss', origin);
    assert.equal((await fetch(callback)).status, 200);
    await session.wait();
    assert.equal(await session.accessToken(), 'private-access');
    assert(!JSON.stringify(await session.status()).includes('private-access'));
    const tokenRequest = requests.find(r => r.path === '/token');
    assert(new URLSearchParams(tokenRequest.body).get('code_verifier').length >= 43);
    assert.equal((await stat(join(dir, 'auth.json'))).mode & 0o777, 0o600);
  } finally {
    await session.dispose();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true });
  }
});

test('rotating refresh tokens are shared safely across two clients and never sent to another MCP origin', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-refresh-'));
  let origin; let refreshCount = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('.well-known')) { res.end(JSON.stringify({ issuer: origin, authorization_endpoint: origin + '/authorize', registration_endpoint: origin + '/register', token_endpoint: origin + '/token', revocation_endpoint: origin + '/revoke' })); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(new URLSearchParams(body).get('refresh_token'), 'old-refresh');
    refreshCount++;
    res.end(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'Bearer' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const store = new PrivateStore(dir);
  await store.write('auth.json', { issuer: origin, resource: origin + '/mcp', client_id: 'public-client', access_token: 'old-access', refresh_token: 'old-refresh', expires_at: 0 });
  const options = { issuer: origin, resource: origin + '/mcp', allowLocalTest: true };
  const a = new OAuthSession(store, options); const b = new OAuthSession(store, options);
  try {
    assert.deepEqual(await Promise.all([a.accessToken(), b.accessToken()]), ['new-access', 'new-access']);
    assert.equal(refreshCount, 1);
    assert.equal((await store.read('auth.json')).refresh_token, 'new-refresh');
    await assert.rejects(a.authenticatedFetch('https://wrong.example/mcp'), /outside/);
  } finally { await a.dispose(); await b.dispose(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true }); }
});

test('missing newly published scope refreshes the original grant once; unrelated 403 never refreshes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-scope-'));
  const store = new PrivateStore(dir);
  const issuer = 'https://www.shenhuoai.com', resource = 'https://api.shenhuoai.com/external/mcp';
  let refreshes = 0, reason = 'insufficient_scope'; const requests = [];
  await store.write('auth.json', { issuer, resource, client_id: 'original-client', access_token: 'old-access', refresh_token: 'refresh-original', expires_at: Date.now() + 3600000 });
  const session = new OAuthSession(store, { fetchImpl: async (url, options) => {
    if (String(url).includes('.well-known')) return Response.json({ issuer, authorization_endpoint: issuer + '/authorize', registration_endpoint: issuer + '/register', token_endpoint: issuer + '/token', revocation_endpoint: issuer + '/revoke' });
    if (String(url).endsWith('/token')) { refreshes++; assert.equal(new URLSearchParams(options.body).get('client_id'), 'original-client'); return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'Bearer' }); }
    requests.push(new Headers(options.headers).get('authorization'));
    if (requests.at(-1) === 'Bearer new-access' && reason === 'insufficient_scope') return Response.json({ ok: true });
    return Response.json({}, { status: 403, headers: { 'www-authenticate': `Bearer error="${reason}"` } });
  } });
  t.after(async () => { await session.dispose(); await rm(dir, { recursive: true, force: true }); });
  assert.equal((await session.authenticatedFetch(resource, { method: 'POST', body: '{}' })).status, 200);
  assert.equal(refreshes, 1); assert.deepEqual(requests, ['Bearer old-access', 'Bearer new-access']);
  reason = 'access_denied';
  assert.equal((await session.authenticatedFetch(resource)).status, 403);
  assert.equal(refreshes, 1);
});
