#!/usr/bin/env node
/**
 * Deployment smoke test.
 *
 * Proves the built artifact actually RUNS. `npm run build` only proves esbuild
 * and Vite produced files; it says nothing about whether `dist/index.cjs` boots,
 * binds a port, opens SQLite, serves the client, or answers its own API. Those
 * are separate failures and every one of them has shipped in a green build
 * before — the CORS allow-list that rejected the server's own origin on any port
 * but 5000 passed `npm run build` and every unit test, and broke every asset
 * request at runtime.
 *
 * This is deliberately NOT Playwright. It has no browser dependency, runs in a
 * couple of seconds, and can gate a release job on a runner where installing
 * Chromium is not worth the minutes. Playwright answers "does the app work";
 * this answers "does the artifact start and serve".
 *
 *   node scripts/smoke.mjs                # build if needed, start, probe, stop
 *   node scripts/smoke.mjs --port 5123    # pick the port
 *   node scripts/smoke.mjs --no-build     # assume dist/ is current
 *   node scripts/smoke.mjs --keep-alive   # leave the server up for poking at
 *   node scripts/smoke.mjs --json         # machine-readable result
 *
 * Exit code is 0 only when every REQUIRED probe passed.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = path.join(ROOT, 'dist', 'index.cjs');
const CLIENT_INDEX = path.join(ROOT, 'dist', 'public', 'index.html');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const OPTIONS = {
  port: Number(value('--port', process.env.SMOKE_PORT ?? '0')),
  build: !flag('--no-build'),
  keepAlive: flag('--keep-alive'),
  json: flag('--json'),
  /* Boot does up to 30s of lake probing before it gives up (main.ts races
     runStartupSequence against a 30s timeout), so the budget has to clear that
     on a machine with no AIStor reachable. */
  bootTimeoutMs: Number(value('--boot-timeout', '180000')),
};

/* ── tiny output helpers ─────────────────────────────────────────────────── */

const SYMBOLS = { pass: '+', fail: 'x', skip: '-', info: '·' };
const results = [];

function record(name, status, detail, { required = true } = {}) {
  results.push({ name, status, detail, required });
  if (!OPTIONS.json) {
    console.log(`  ${SYMBOLS[status] ?? '?'} ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  if (!OPTIONS.json) console.log(`\n${title}`);
}

/* ── port selection ──────────────────────────────────────────────────────── */

/**
 * Ask the OS for a free port. Never defaults to 5000: the dashboard Tyler keeps
 * running lives there, EADDRINUSE is a hard `process.exit(1)` in the server, and
 * a smoke test must not be able to take the real instance down.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/* ── build ───────────────────────────────────────────────────────────────── */

function run(command, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, cmdArgs, {
      cwd: ROOT,
      stdio: OPTIONS.json ? 'ignore' : 'inherit',
      shell: process.platform === 'win32',
      ...opts,
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

async function ensureBuild() {
  const haveArtifacts = existsSync(SERVER_ENTRY) && existsSync(CLIENT_INDEX);

  if (!OPTIONS.build) {
    if (!haveArtifacts) {
      throw new Error(
        `--no-build was passed but the artifacts are missing:\n` +
          `  ${existsSync(SERVER_ENTRY) ? 'ok' : 'MISSING'} ${SERVER_ENTRY}\n` +
          `  ${existsSync(CLIENT_INDEX) ? 'ok' : 'MISSING'} ${CLIENT_INDEX}`,
      );
    }
    record('build', 'skip', 'reused existing dist/ (--no-build)');
    return;
  }

  section('Build');
  const started = Date.now();
  await run('npm', ['run', 'build']);

  // `serveStatic` throws at boot when dist/public is absent, so the failure
  // would otherwise arrive as an unexplained boot timeout.
  if (!existsSync(CLIENT_INDEX)) {
    throw new Error(`build finished but ${CLIENT_INDEX} does not exist`);
  }
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(`build finished but ${SERVER_ENTRY} does not exist`);
  }
  record('build', 'pass', `${((Date.now() - started) / 1000).toFixed(1)}s`);
}

/* ── server lifecycle ────────────────────────────────────────────────────── */

let serverProcess = null;
let serverLog = '';

async function startServer(port) {
  section('Boot');

  serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HUSKY: '0',
      SMOKE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const capture = (chunk) => {
    serverLog += chunk.toString();
    // Keep only the tail; the server logs every request and this can run long.
    if (serverLog.length > 64_000) serverLog = serverLog.slice(-64_000);
  };
  serverProcess.stdout.on('data', capture);
  serverProcess.stderr.on('data', capture);

  let exited = null;
  serverProcess.on('exit', (code, signal) => {
    exited = { code, signal };
  });

  const deadline = Date.now() + OPTIONS.bootTimeoutMs;
  const started = Date.now();

  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(
        `server exited during boot (code ${exited.code}, signal ${exited.signal})\n` +
          `--- server output ---\n${serverLog.slice(-4000)}`,
      );
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        record('server boots and binds', 'pass', `${((Date.now() - started) / 1000).toFixed(1)}s on :${port}`);
        return;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(
    `server did not answer /health within ${OPTIONS.bootTimeoutMs}ms\n` +
      `--- server output ---\n${serverLog.slice(-4000)}`,
  );
}

async function stopServer() {
  // `exitCode` is null for a process killed by a SIGNAL — only `signalCode` is
  // set — so testing exitCode alone treated an already-SIGTERMed child as still
  // running and sent it a second kill.
  if (!serverProcess) return;
  if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) return;

  const ended = new Promise((resolve) => serverProcess.once('exit', resolve));
  // The server installs a graceful shutdown on SIGTERM (closes SSE, PTY,
  // marimo groups, databases). SIGINT/SIGTERM semantics differ on Windows, so
  // fall back to a hard kill if it does not go quietly.
  serverProcess.kill('SIGTERM');

  const timer = setTimeout(() => {
    if (serverProcess.exitCode === null && serverProcess.signalCode === null) {
      serverProcess.kill('SIGKILL');
    }
  }, 10_000);

  await ended;
  clearTimeout(timer);
}

/* ── probes ──────────────────────────────────────────────────────────────── */

async function probe(base, { name, path: urlPath, required = true, check }) {
  try {
    const res = await fetch(`${base}${urlPath}`, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/json, text/html' },
    });
    const outcome = await check(res);
    record(name, outcome.ok ? 'pass' : 'fail', outcome.detail, { required });
  } catch (err) {
    record(name, 'fail', err.message, { required });
  }
}

async function runProbes(port) {
  const base = `http://127.0.0.1:${port}`;
  section('Probes');

  // Liveness. The only probe with no legitimate failure mode.
  await probe(base, {
    name: 'GET /health is 200',
    path: '/health',
    check: async (res) => {
      if (!res.ok) return { ok: false, detail: `status ${res.status}` };
      const body = await res.json();
      return body.status === 'ok'
        ? { ok: true, detail: `uptime ${Math.round(body.uptime)}s, rss ${body.memory?.rss}MB` }
        : { ok: false, detail: `status field was ${JSON.stringify(body.status)}` };
    },
  });

  // The client actually being served is the half of the artifact `npm run build`
  // cannot vouch for. A navigation must return the SPA shell with the mount
  // point in it.
  await probe(base, {
    name: 'GET / serves the client shell',
    path: '/',
    check: async (res) => {
      if (!res.ok) return { ok: false, detail: `status ${res.status}` };
      const html = await res.text();
      if (!html.includes('<div id="root"')) {
        return { ok: false, detail: 'response has no #root mount point' };
      }
      if (!/<script[^>]+src="\/assets\//.test(html)) {
        return { ok: false, detail: 'shell references no hashed asset bundle' };
      }
      return { ok: true, detail: `${html.length} bytes` };
    },
  });

  // THE regression this script was written for. The asset request carries an
  // Origin header, so a CORS allow-list that does not track the configured port
  // rejects the server's own bundle and the page renders blank while every
  // other check stays green.
  const assetUrl = await (async () => {
    const html = await (await fetch(`${base}/`, { signal: AbortSignal.timeout(15_000) })).text();
    return html.match(/<script[^>]+src="(\/assets\/[^"]+)"/)?.[1] ?? null;
  })();

  if (assetUrl) {
    try {
      const res = await fetch(`${base}${assetUrl}`, {
        signal: AbortSignal.timeout(20_000),
        // Exactly what the browser sends for a module script: same-origin
        // request that still carries Origin.
        headers: { Origin: `http://127.0.0.1:${port}`, Accept: '*/*' },
      });
      record(
        'client bundle loads with an Origin header',
        res.ok ? 'pass' : 'fail',
        res.ok ? assetUrl : `status ${res.status} for ${assetUrl} — the CORS allow-list does not cover port ${port}`,
      );
    } catch (err) {
      record('client bundle loads with an Origin header', 'fail', err.message);
    }
  } else {
    record('client bundle loads with an Origin header', 'fail', 'could not find a bundle URL in the shell');
  }

  // API surface. SQLite is never optional; the lake is.
  await probe(base, {
    name: 'GET /api/instruments returns the catalog',
    path: '/api/instruments',
    check: async (res) => {
      if (!res.ok) return { ok: false, detail: `status ${res.status}` };
      const body = await res.json();
      return Array.isArray(body)
        ? { ok: true, detail: `${body.length} instruments` }
        : { ok: false, detail: 'body was not an array' };
    },
  });

  await probe(base, {
    name: 'GET /api/docs/json serves the OpenAPI spec',
    path: '/api/docs/json',
    check: async (res) => {
      if (!res.ok) return { ok: false, detail: `status ${res.status}` };
      const body = await res.json();
      const paths = Object.keys(body.paths ?? {}).length;
      return paths > 0 ? { ok: true, detail: `${paths} paths` } : { ok: false, detail: 'zero paths' };
    },
  });

  await probe(base, {
    name: 'an unmounted /api path 404s as JSON',
    path: '/api/__smoke_not_a_route__',
    check: async (res) => {
      if (res.status !== 404) return { ok: false, detail: `status ${res.status}, expected 404` };
      const ct = res.headers.get('content-type') ?? '';
      return ct.includes('application/json')
        ? { ok: true, detail: '404 application/json' }
        : { ok: false, detail: `content-type ${ct} — the SPA fallback is shadowing the API` };
    },
  });

  // Dependency reporting. NOT required: a runner with no lake legitimately
  // reports degraded here, and failing the build for that would make the gate
  // unusable in CI. It is reported so a degraded deploy is visible.
  await probe(base, {
    name: 'dependency health (informational)',
    path: '/api/health',
    required: false,
    check: async (res) => {
      const body = await res.json().catch(() => ({}));
      const details = body.details ?? {};
      const summary = Object.entries(details)
        .map(([k, v]) => `${k}=${v?.status ?? '?'}`)
        .join(' ');
      const sqlite = details.sqlite?.status;
      if (sqlite && sqlite !== 'up') {
        return { ok: false, detail: `SQLite is ${sqlite} — that is never optional. ${summary}` };
      }
      return { ok: true, detail: summary || `status ${res.status}` };
    },
  });
}

/* ── main ────────────────────────────────────────────────────────────────── */

async function main() {
  const port = OPTIONS.port || (await freePort());

  if (!OPTIONS.json) {
    console.log(`ML Dashboard — deployment smoke test`);
    console.log(`  root: ${ROOT}`);
    console.log(`  port: ${port}${OPTIONS.port ? '' : ' (auto-selected free port)'}`);
  }

  await ensureBuild();
  await startServer(port);
  await runProbes(port);

  const failures = results.filter((r) => r.status === 'fail' && r.required);
  const soft = results.filter((r) => r.status === 'fail' && !r.required);

  if (OPTIONS.json) {
    console.log(JSON.stringify({ ok: failures.length === 0, port, results }, null, 2));
  } else {
    console.log('');
    console.log(
      failures.length === 0
        ? `SMOKE PASSED — ${results.filter((r) => r.status === 'pass').length} probes green` +
            (soft.length ? `, ${soft.length} informational failure(s)` : '')
        : `SMOKE FAILED — ${failures.length} required probe(s) failed:\n` +
            failures.map((f) => `    ${f.name}: ${f.detail}`).join('\n'),
    );
  }

  if (OPTIONS.keepAlive) {
    console.log(`\nServer left running at http://127.0.0.1:${port} (--keep-alive). Ctrl-C to stop.`);
    await new Promise(() => {});
  }

  await stopServer();
  process.exit(failures.length === 0 ? 0 : 1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    // `.catch` rather than a bare async handler: nothing observes a rejected
    // handler promise, so a throw inside stopServer would surface as an
    // unhandled rejection instead of an exit.
    stopServer()
      .catch((err) => console.error(`[smoke] shutdown failed: ${err.message}`))
      .finally(() => process.exit(130));
  });
}

main().catch(async (err) => {
  console.error(`\nSMOKE FAILED — ${err.message}`);
  await stopServer();
  process.exit(1);
});
