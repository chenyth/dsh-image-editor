import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const id = 'dsh-image-editor-download-probe', runId = randomUUID(), version = `0.0.1-probe.${Date.now()}`;
const output = join(root, 'artifacts', 'download-bridge', runId), pkg = join(output, 'package');
await mkdir(pkg, { recursive: true });
const temporary = createServer(); await new Promise(resolve => temporary.listen(0, '127.0.0.1', resolve));
const port = temporary.address().port; await new Promise(resolve => temporary.close(resolve));
const config = { runId, port, pageKey: randomBytes(24).toString('hex'), clientKey: randomBytes(32).toString('hex'), output: join(output, 'downloads') };
await writeFile(join(pkg, 'config.json'), JSON.stringify(config), { mode: 0o600 });
for (const name of ['server.mjs', 'page.html']) await copyFile(new URL(name, import.meta.url), join(pkg, name));
await copyFile(join(root, 'assets/icon-red-transparent.png'), join(pkg, 'icon.png'));
const bundle = await build({ stdin: { contents: await readFile(new URL('client.js', import.meta.url), 'utf8'),
  resolveDir: pkg, sourcefile: 'probe-client.js' }, bundle: true, format: 'cjs', platform: 'browser',
  external: ['react'], write: false, target: 'chrome130' });
await writeFile(join(pkg, 'client.js'), `window.__ModuleLoader__.load({id:${JSON.stringify(id)},factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${bundle.outputFiles[0].text}\nreturn module.exports;}});`);
await writeFile(join(pkg, 'cordis.patch.yml'), `- insert:\n    - id: ${id}\n      name: ${id}\n`);
await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: id, version, type: 'module',
  description: 'Local-only PNG download bridge probe. Not a production release.', main: './server.mjs',
  exports: { '.': './server.mjs', './client': './client.js', './package.json': './package.json' },
  icon: './icon.png', dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-sidebar-right'] } },
  engines: { node: '>=24.9.0', dsh: '>=0.2.1-rc.5 <0.3.0-0' }, license: 'MIT' }, null, 2));
const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', output], { cwd: pkg, encoding: 'utf8' }));
console.log(JSON.stringify({ runId, port, package: join(output, packed[0].filename), evidence: output }, null, 2));
