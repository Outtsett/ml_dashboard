import fs from 'fs';
import path from 'path';
import type { FullConfig } from '@playwright/test';

/**
 * Refuse to test a server that is serving a different build than `dist/`.
 *
 * `webServer.reuseExistingServer` is true outside CI, which is what makes local
 * iteration fast — you rebuild, re-run the specs, and Playwright talks to the
 * server you already have up. The trap is that the server you already have up is
 * running the code it was STARTED with. Rebuild and re-run, and Playwright
 * happily reuses the old process: the specs exercise the previous build while
 * the fix sits unused in `dist/`.
 *
 * That is not hypothetical. A rate-limiter change was made, rebuilt, and the
 * suite kept failing with 429s from a server started before the change — three
 * full runs spent debugging a fix that was already correct.
 *
 * The check is cheap and exact. Vite emits a content-hashed entry bundle, so the
 * script src in `dist/public/index.html` changes whenever the client changes.
 * Comparing it against what the running server returns answers "is this process
 * serving the bytes on disk?" in one request. When they disagree the run stops
 * with an instruction instead of a hundred confusing failures.
 *
 * The server bundle is not hashed, so a server-only change is invisible to this.
 * Reuse is therefore also bounded by uptime: a process older than the build's
 * mtime cannot contain it, whatever it is serving.
 */

const ENTRY_SCRIPT = /<script[^>]+src="(\/assets\/[^"]+\.js)"/;

async function globalSetup(config: FullConfig): Promise<void> {
  const webServer = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;
  const url = webServer?.url;
  if (!url) return;

  const origin = new URL(url).origin;

  // Nothing is listening yet → Playwright is about to start a fresh server,
  // which is by definition current. Nothing to check.
  let running = false;
  try {
    const res = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2500) });
    running = res.ok;
  } catch {
    return;
  }
  if (!running) return;

  const indexPath = path.resolve(import.meta.dirname, '..', 'dist', 'public', 'index.html');
  if (!fs.existsSync(indexPath)) return; // the config's own build check reports this

  const onDisk = fs.readFileSync(indexPath, 'utf-8').match(ENTRY_SCRIPT)?.[1];
  if (!onDisk) return; // shell shape changed; not this guard's business to guess

  let served: string | undefined;
  try {
    const res = await fetch(`${origin}/`, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(10_000),
    });
    served = (await res.text()).match(ENTRY_SCRIPT)?.[1];
  } catch {
    return;
  }

  if (served && served !== onDisk) {
    throw new Error(
      `The server already running on ${origin} is serving a DIFFERENT build than dist/.\n\n` +
        `  dist/public/index.html references : ${onDisk}\n` +
        `  the running server references      : ${served}\n\n` +
        `Playwright reuses an existing server outside CI, so this run would test stale code ` +
        `and any fix you just made would appear not to work.\n\n` +
        `Stop that process and re-run — Playwright will start a fresh one:\n` +
        `  Windows:  netstat -ano | findstr :${new URL(origin).port}   then  taskkill /PID <pid> /F\n` +
        `  POSIX:    lsof -ti :${new URL(origin).port} | xargs kill\n\n` +
        `Or run with E2E_PORT set to a free port.`,
    );
  }

  // Server-only changes cannot be detected by a client hash, so fall back to
  // "is this process older than the build?".
  const builtAt = fs.statSync(path.resolve(import.meta.dirname, '..', 'dist', 'index.cjs')).mtimeMs;
  try {
    const health = await (
      await fetch(`${origin}/health`, { signal: AbortSignal.timeout(5_000) })
    ).json();
    const startedAt = Date.now() - Number(health.uptime ?? 0) * 1000;
    if (Number.isFinite(startedAt) && startedAt < builtAt) {
      throw new Error(
        `The server on ${origin} started BEFORE the current server build was produced, so it ` +
          `cannot contain it.\n\n` +
          `  dist/index.cjs built : ${new Date(builtAt).toISOString()}\n` +
          `  server started       : ${new Date(startedAt).toISOString()}\n\n` +
          `Stop it and re-run so Playwright starts a fresh process, or set E2E_PORT to a free port.`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('The server on')) throw err;
    // A malformed /health is not this guard's problem to report.
  }
}

export default globalSetup;
