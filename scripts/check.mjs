import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await check(path);
    else if (/\.(m?js)$/.test(path)) execFileSync(process.execPath, ['--check', path], { stdio: 'inherit' });
  }
}
await check('src'); await check('scripts');
