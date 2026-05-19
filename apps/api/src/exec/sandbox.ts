import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface Sandbox {
  dir: string;
  filename: string;
  cleanup: () => Promise<void>;
}

export async function makeSandbox(filename: string, source: string): Promise<Sandbox> {
  const dir = await mkdtemp(path.join(tmpdir(), 'opencoder-run-'));
  const filePath = path.join(dir, filename);
  await writeFile(filePath, source, 'utf8');
  return {
    dir,
    filename,
    cleanup: async () => {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}
