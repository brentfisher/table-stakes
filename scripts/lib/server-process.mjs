// Spawn the game server for a check script, and reliably stop it again.
//
// Both smoke scripts need a running server, and `npm run check` must be able to run them
// unattended. They therefore start their own and kill exactly the child they started — by
// handle, never by matching a process name, which on a shared machine can kill somebody
// else's server.
//
// Set BASE to run against an already-running server instead; then nothing is spawned and
// nothing is killed.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '../..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve where to talk to the server, and whether we own it.
 * @param {number} defaultPort a high port, so it never collides with a human's `npm start`
 */
export function resolveBase(defaultPort) {
  const port = Number(process.env.PORT ?? defaultPort);
  return {
    port,
    base: process.env.BASE ?? `http://localhost:${port}`,
    external: Boolean(process.env.BASE),
  };
}

/**
 * Start `server/src/index.js` and wait for /health. Returns a handle whose `stop()` kills
 * only this child. Exits the process with a readable message if the server cannot start —
 * a MODULE_NOT_FOUND stack or a silent hang is a bad way to learn the deps are missing.
 */
export async function startServer({ base, port, external }) {
  if (external) return { stop() {} };

  if (!existsSync(join(repoRoot, 'server/node_modules'))) {
    console.error('server/node_modules is missing — run `npm run install:all` first.');
    process.exit(2);
  }

  const log = [];
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: join(repoRoot, 'server'),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => log.push(d.toString()));
  child.stderr.on('data', (d) => log.push(d.toString()));

  const handle = {
    stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    },
    output: () => log.join(''),
  };

  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) {
      console.error(`server exited during startup (code ${child.exitCode}):\n${handle.output()}`);
      process.exit(2);
    }
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return handle;
    } catch {
      // not listening yet
    }
    await sleep(100);
  }

  console.error(`server did not become healthy on port ${port} — is that port in use?\n${handle.output()}`);
  handle.stop();
  process.exit(2);
}
