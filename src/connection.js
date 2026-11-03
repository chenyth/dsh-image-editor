import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RESOURCE } from './oauth.js';
import { resultValue } from './result.js';
import manifest from '../package.json' with { type: 'json' };

// This interface exposes calls, never the owner's tokens, cookies or storage.
export const SHARED_SERVICE = 'shenhuoMcpConnection';
export class LocalConnection {
  constructor(session) { this.session = session; this.resource = session.resource; this.source = 'dsh-image-editor'; }
  status() { return this.session.status(); }
  async authorize() { await this.dispose(); return this.session.begin(); }
  async connect() {
    if (this.client) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const client = new Client({ name: manifest.name, version: manifest.version });
      const transport = new StreamableHTTPClientTransport(new URL(this.resource), { fetch: (url, options) => this.session.authenticatedFetch(url, options) });
      try {
        await client.connect(transport, { timeout: 30000 });
        const definitions = [], seen = new Set(); let cursor;
        do {
          const page = await client.listTools(cursor ? { cursor } : {});
          definitions.push(...page.tools); cursor = page.nextCursor;
          if (definitions.length > 100 || (cursor && seen.has(cursor))) throw new Error('Unexpected MCP tool catalogue.');
          if (cursor) seen.add(cursor);
        } while (cursor);
        const account = resultValue(await client.callTool({ name: 'get_account', arguments: {} }));
        if (!account.user?.id) throw new Error('No authorized Shenhuo account was returned.');
        this.client = client; this.definitions = definitions;
      } catch (error) { await client.close().catch(() => {}); throw error; }
    })();
    try { await this.connecting; } finally { this.connecting = null; }
  }
  async tools() { await this.connect(); return this.definitions; }
  async call(name, args, { signal } = {}) {
    await this.connect();
    if (!this.definitions.some(t => t.name === name)) throw new Error('Requested tool is not offered by the service.');
    try { return await this.client.callTool({ name, arguments: args }, undefined, { signal, timeout: 60000 }); }
    catch { await this.dispose(); throw new Error('MCP connection interrupted. Recover the original task or replay its original key and parameters.'); }
  }
  async dispose() {
    if (this.connecting) await this.connecting.catch(() => {});
    const client = this.client; this.client = null;
    await client?.close().catch(() => {});
  }
}

export class ConnectionRouter {
  constructor(ctx, local) { this.ctx = ctx; this.local = local; }
  select() {
    const shared = this.ctx.get?.(SHARED_SERVICE);
    if (this.selected) {
      if (this.selected !== this.local && shared !== this.selected) {
        if (shared?.apiVersion !== 1 || shared.resource !== RESOURCE || shared.source !== this.selected.source || !['status', 'authorize', 'tools', 'call'].every(k => typeof shared[k] === 'function')) throw new Error('Original Shenhuo connection is unavailable. Re-enable its owner; no fallback account was opened.');
        this.selected = shared;
      }
      return this.selected;
    }
    if (shared) {
      if (shared.apiVersion !== 1 || shared.resource !== RESOURCE || !['status', 'authorize', 'tools', 'call'].every(k => typeof shared[k] === 'function')) throw new Error('Conflicting Shenhuo connection. Check the enabled plugin and endpoint.');
      this.selected = shared;
    } else {
      // A legacy designer connection is private. Do not silently create a second authorization.
      const names = this.ctx.tools.schemas?.().map(t => t.name) ?? [];
      if (names.includes('shenhuo_connect') || names.some(n => /^mcp__shenhuo[-_]designers__/.test(n))) throw new Error('SHENHUO_CONNECTION_UPGRADE_REQUIRED: an existing Shenhuo connection has no sharing interface. Update Image Designer to the companion version, or configure a compatible shared connection. Credentials will not be copied.');
      this.selected = this.local;
    }
    return this.selected;
  }
  async status() {
    const previous = this.selected, owner = this.select();
    const state = await owner.status();
    if (!previous && state.status !== 'authorized') this.selected = undefined;
    return { ...state, connection_source: owner.source, resource: owner.resource };
  }
  async authorize() { const owner = this.select(); return { ...await owner.authorize(), connection_source: owner.source }; }
  tools() { return this.select().tools(); }
  call(name, args, options) { return this.select().call(name, args, options); }
  async dispose() { await this.local.dispose(); await this.local.session.dispose(); }
}
