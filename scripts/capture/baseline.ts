import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, preview } from 'vite';
import type { loadSave } from '../../e2e/watch.ts';

/** A pinned, unmodified build for before/after captures; never fetches media history. */
export async function withBaseline(
  commit: string,
  use: (base: string, load: typeof loadSave) => Promise<void>,
) {
  const root = mkdtempSync(join(tmpdir(), 'map-baseline-'));
  try {
    try {
      execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`]);
    } catch {
      execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', commit]);
    }
    const archive = execFileSync('git', ['archive', commit], { maxBuffer: 16 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', root], { input: archive });
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    // The pinned revision writes its own save envelope. Never teach the current
    // game to accept legacy formats just to make a historical screenshot load.
    const historical = (await import(pathToFileURL(join(root, 'e2e/watch.ts')).href)) as {
      loadSave: typeof loadSave;
    };
    await build({ root, logLevel: 'error' });
    const server = await preview({
      root,
      logLevel: 'error',
      preview: { host: '127.0.0.1', port: 0 },
    });
    try {
      const address = server.httpServer.address();
      if (!address || typeof address === 'string') throw new Error('baseline server has no port');
      await use(`http://127.0.0.1:${address.port}`, historical.loadSave);
    } finally {
      await new Promise<void>((done, reject) =>
        server.httpServer.close((error) => (error ? reject(error) : done())),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
