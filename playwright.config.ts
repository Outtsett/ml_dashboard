import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * End-to-end configuration for the ML Dashboard.
 *
 * The dashboard is one process serving both the API and the client. In
 * production that process reads the built client out of `dist/public`
 * (`src/server/infrastructure/core/static.ts`); in development it mounts Vite
 * as middleware and compiles on demand
 * (`src/server/infrastructure/core/vite.ts`). E2E targets the PRODUCTION path,
 * because that is the artifact a release ships and because Vite's
 * compile-on-first-request adds seconds of variance to the first navigation of
 * every spec.
 *
 * PORT ISOLATION. The suite never binds 5000. Tyler runs the real dashboard
 * there all day and a test run must not take it down or inherit its state.
 * `E2E_PORT` (default 5099) is passed through `webServer.env`, which wins over
 * the `PORT=5000` line in `.env`: `main.ts` reads `process.env.PORT` through
 * `loadAppConfig()` (`src/server/infrastructure/core/config/app.config.ts:139`)
 * and `dotenv` does not overwrite a variable that is already set.
 */

const PORT = Number(process.env.E2E_PORT ?? 5099);
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;
const IS_CI = !!process.env.CI;

/**
 * The server refuses to start in production mode without a built client —
 * `serveStatic()` throws on a missing `dist/public`. Failing here names the
 * cause; failing there surfaces as an opaque webServer timeout.
 */
const DIST_INDEX = path.resolve(import.meta.dirname, 'dist', 'public', 'index.html');
if (!process.env.E2E_SKIP_BUILD_CHECK && !fs.existsSync(DIST_INDEX)) {
  throw new Error(
    `E2E needs a production build. ${DIST_INDEX} is missing — run \`npm run build\` first ` +
      `(or \`npm run test:e2e\`, which builds for you).`,
  );
}

export default defineConfig({
  testDir: './e2e/specs',
  outputDir: './test-results',
  snapshotDir: './e2e/snapshots',

  /* Refuses to run against a reused server that is serving a stale build. See
     the file for why this is worth a round-trip on every run. */
  globalSetup: './e2e/global-setup.ts',

  /* A spec that has no `await expect` racing a stream should finish well inside
     this. Raised from the 30s default because the dashboard's first paint pulls
     a 67MB asset tree off disk and the market pages query DuckDB over the lake. */
  timeout: 90_000,
  expect: { timeout: 15_000 },

  fullyParallel: true,
  /* A spec that mutates server state opts out per-file with
     `test.describe.configure({ mode: 'serial' })`. */
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,

  /* The app is a SINGLE server process backed by one SQLite file. Workers are
     browser contexts against that one instance, not isolated stacks, so this is
     capped well below the core count on purpose — 24 parallel contexts hammering
     one Express process produces timeouts that look like product bugs. */
  workers: IS_CI ? 2 : 4,

  reporter: IS_CI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'test-results/junit.xml' }],
        ['list'],
      ]
    : [['html', { open: 'never', outputFolder: 'playwright-report' }], ['list']],

  use: {
    baseURL: BASE_URL,
    /* Retained on failure only — a trace is ~10MB and a green run needs none. */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,

    /* NO `extraHTTPHeaders`.
     *
     * An `X-E2E-Run: 1` marker header lived here briefly and broke a third of
     * the suite. Playwright applies extraHTTPHeaders to EVERY request the page
     * makes, cross-origin ones included, and a custom header promotes an
     * otherwise-simple request to a CORS preflight. The app loads JetBrains Mono
     * from fonts.gstatic.com, which does not allow `x-e2e-run` in
     * Access-Control-Allow-Headers, so every page load logged two console errors
     * and the console guard — correctly — failed the test.
     *
     * Nothing read the header. If a future marker is genuinely needed, set it
     * per-request via `page.route`, scoped to the app's own origin. */
  },

  projects: [
    /* API contract specs need no browser. Running them as their own project
       keeps a browser launch off the critical path and lets CI gate the API
       surface even when a browser binary is unavailable. */
    {
      name: 'api',
      testMatch: /.*\.api\.spec\.ts/,
      use: { baseURL: BASE_URL },
    },
    {
      name: 'chromium',
      testIgnore: /.*\.api\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
      },
    },
  ],

  webServer: {
    /* `dist/index.cjs` is the esbuild bundle `npm run build` produces. It is
       started directly rather than through `npm start` so the child process is
       the server itself — an npm shim in between swallows the SIGTERM Playwright
       sends at teardown and leaves the port held. */
    command: 'node dist/index.cjs',
    url: `${BASE_URL}/health`,
    /* Cold boot measured at ~25s on this machine: Nest DI graph, SQLite invariant
       enforcement, DuckDB view definition over the lake, symbol-catalog warm. */
    timeout: 180_000,
    reuseExistingServer: !IS_CI,
    /* The server logs every request at info level. Piping stdout puts ~400KB of
       `GET /api/instruments 200` into the reporter output and buries the actual
       results; stderr is kept because a boot failure arrives there. Set
       `E2E_SERVER_STDOUT=pipe` when debugging a server-side problem. */
    stdout: (process.env.E2E_SERVER_STDOUT as 'pipe' | 'ignore') ?? 'ignore',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      HUSKY: '0',
      /* Marks the process so a spec can assert it is talking to the harness
         instance and not something a developer left running on the port. */
      E2E: '1',
      /* Several browser contexts plus the API project all originate from
         127.0.0.1, so they share one rate-limit bucket. At stock ceilings
         (`queryRateLimiter`: 50 per 10s) a full run trips 429s and a different
         random set of specs fails each time. Scaling keeps the middleware in the
         request path — it is still exercised — while giving a trusted local
         client room. Never set in production. */
      RATE_LIMIT_MULTIPLIER: process.env.RATE_LIMIT_MULTIPLIER ?? '20',
    },
  },
});
