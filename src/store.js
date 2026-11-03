import { mkdir, readFile, writeFile, rename, rm, chmod, lstat, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

export class PrivateStore {
  constructor(directory = process.env.DSH_IMAGE_EDITOR_DATA_DIR || join(homedir(), '.dsh-image-editor')) { this.directory = directory; }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if ((await lstat(this.directory)).isSymbolicLink()) throw new Error('Private storage must not be a symbolic link.');
    await chmod(this.directory, 0o700);
  }
  path(name) {
    if (!/^[a-z-]+\.json$/.test(name)) throw new Error('Invalid state filename.');
    return join(this.directory, name);
  }
  async read(name) {
    try {
      if ((await lstat(this.path(name))).isSymbolicLink()) throw new Error('Private state must not be a symbolic link.');
      return JSON.parse(await readFile(this.path(name), 'utf8'));
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async write(name, value) {
    await this.init();
    const temporary = join(this.directory, `.write-${randomUUID()}`);
    try {
      await writeFile(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.path(name));
    } finally { await rm(temporary, { force: true }); }
  }
  async remove(name) { await rm(this.path(name), { force: true }); }
  async locked(name, action) {
    await this.init();
    const path = this.path(name) + '.lock';
    let handle;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { handle = await open(path, 'wx', 0o600); break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; await delay(100); }
    }
    if (!handle) throw new Error('State is busy. Retry after the other DSH process finishes. If it crashed, remove the stale .lock file in the private data directory.');
    try { return await action(); }
    finally { await handle.close(); await rm(path, { force: true }); }
  }
}
