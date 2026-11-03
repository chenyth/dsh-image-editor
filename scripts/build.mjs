import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const result = await build({ absWorkingDir: root, entryPoints: ['src/client/index.js'], bundle: true,
  format: 'cjs', platform: 'browser', target: 'chrome130', write: false, sourcemap: false,
  external: ['react'], loader: { '.png': 'dataurl' }, legalComments: 'inline' });
// The DSH browser loader owns the React instance. Bundle evaluation
// only registers a lazy factory; it must not mount UI before materialization.
const bundle = `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory:(require)=>{\nvar module={exports:{}};var exports=module.exports;\n${result.outputFiles[0].text}\nreturn module.exports;\n}});\n`;
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/client.js', import.meta.url), bundle);
console.log(`Built dist/client.js (${Buffer.byteLength(bundle)} bytes)`);
