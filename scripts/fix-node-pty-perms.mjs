#!/usr/bin/env node
// pnpm extraction can drop the execute bit on node-pty's prebuilt
// `spawn-helper` binary (the macOS helper that posix_spawnp delegates to).
// When that happens the terminal panel boots, reaches mod.spawn(), and
// crashes with "posix_spawnp failed." Restore the bit on every install.
import { readdir, stat, chmod } from 'node:fs/promises';
import { join } from 'node:path';

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      // Skip deep walks that have no chance of containing node-pty.
      if (e.name === '.git' || e.name === '.cache') continue;
      yield* walk(full);
    } else if (e.isFile() && e.name === 'spawn-helper') {
      yield full;
    }
  }
}

const roots = ['node_modules/.pnpm', 'node_modules'];
let fixed = 0;
for (const root of roots) {
  for await (const file of walk(root)) {
    const s = await stat(file);
    if ((s.mode & 0o111) === 0) {
      await chmod(file, s.mode | 0o755);
      fixed += 1;
      console.log(`chmod +x ${file}`);
    }
  }
}
if (fixed === 0) {
  console.log('node-pty spawn-helper already executable (or not installed)');
}
