import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { startProbe } from './server.mjs';

test('real HTTP PNG handoff enforces the page session, client capability, ticket expiry and one-file save', async () => {
  const output = await mkdtemp(join(tmpdir(), 'dsh-download-probe-'));
  const config = { runId: 'test-run', pageKey: randomBytes(24).toString('hex'), clientKey: randomBytes(32).toString('hex'), output };
  let now = Date.now();
  const png = await readFile(new URL('../../assets/icon-red-transparent.png', import.meta.url));
  const probe = await startProbe(config, { html: '<p>probe</p>', icon: png, clock: () => now });
  const create = async (authenticated = true) => fetch(`${probe.origin}/exports`, { method: 'POST',
    headers: { Origin: probe.origin, 'Content-Type': 'image/png', ...(authenticated ? { Cookie: `probe_session=${config.pageKey}` } : {}) }, body: png });
  const issue = async () => {
    const response = await create(); assert.equal(response.status, 201);
    return new URLSearchParams(new URL((await response.json()).handoff).hash.slice(1)).get('ticket');
  };
  const save = (ticket, authorized = true) => fetch(`${probe.origin}/save`, { method: 'POST',
    headers: { Origin: 'dsh-app://app', 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${config.clientKey}` } : {}) }, body: JSON.stringify({ ticket }) });
  try {
    assert.equal((await create(false)).status, 403);
    const valid = await issue();
    assert.equal((await save(valid, false)).status, 403);
    const tampered = `${valid.slice(0, -3)}xyz`;
    assert.equal((await save(tampered)).status, 400);
    assert.equal((await fetch(`${probe.origin}/download`)).status, 400);
    assert.deepEqual(await readdir(output), []);
    const response = await save(valid); assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'dsh-app://app');
    const receipt = await response.json();
    assert.equal(receipt.usedWebsiteCookies, false);
    assert.deepEqual(await readFile(receipt.path), png);
    assert.equal(receipt.sha256, createHash('sha256').update(png).digest('hex'));
    assert.equal((await save(valid)).status, 409);
    const expired = await issue(); now += 61000;
    assert.equal((await save(expired)).status, 410);
    const concurrent = await issue();
    assert.deepEqual((await Promise.all([save(concurrent), save(concurrent)])).map(response => response.status).sort(), [200, 409]);
    assert.equal((await readdir(output)).filter(name => name.endsWith('.png')).length, 2);
  } finally { await probe.close(); await rm(output, { recursive: true, force: true }); }
});
