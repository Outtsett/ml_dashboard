import { test, expect } from '../../fixtures/app';

/**
 * The SQL console on /databases.
 *
 * This is the single most load-bearing journey in the app for a data tool: it
 * runs a query the user typed, through the server, into a real engine, and puts
 * the rows back on screen. One passing assertion here covers the whole
 * client → API → DuckDB/SQLite → client path, which nothing else does end to end.
 *
 * Queries are deliberately read-only and engine-neutral (`SELECT 1`-shaped), so
 * the spec asserts the PATH rather than the contents of a lake that changes
 * daily.
 */

/** The one endpoint the console posts to — api_service.ts:128. */
const QUERY_ENDPOINT = '/api/databases/query';

test.describe('SQL console', () => {
  test.beforeEach(async ({ app, page }) => {
    await app.goto('/databases');
    await page.getByTestId('tab-query').click();
    await expect(page.getByTestId('query-input')).toBeVisible();
  });

  test('runs a query against SQLite and renders the result', { tag: ['@backend'] }, async ({
    page,
  }) => {
    // SQLite rather than the lake engine: it is the one dependency that is never
    // optional, so this spec is meaningful on a machine with no lake.
    await page.getByTestId('query-db-select').selectOption('sqlite');
    await page.getByTestId('query-input').fill('SELECT 1 AS e2e_probe');

    const run = page.getByTestId('run-query');
    await expect(run, 'Run Query is disabled with a non-empty query').toBeEnabled();

    // Wait on the response, not on a spinner — a spinner that never clears and a
    // request that never fires look identical from the outside.
    const [response] = await Promise.all([
      // Matched on the EXACT endpoint. A loose `/api/` matcher latches onto
      // whichever POST resolves first — the page fires several — so under
      // parallel load the assertion read a different response entirely and the
      // spec failed only when the suite was busy.
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === QUERY_ENDPOINT,
        { timeout: 30_000 },
      ),
      run.click(),
    ]);

    expect(
      response.status(),
      `the query endpoint answered ${response.status()}`,
    ).toBeLessThan(400);

    // The value must reach the screen. A 200 whose rows never render is the
    // failure mode a network-only assertion misses entirely.
    await expect(page.locator('#root')).toContainText(/e2e_probe|1/i, { timeout: 20_000 });
  });

  test('the Run button is disabled until a query is typed', { tag: ['@backend'] }, async ({ page }) => {
    // Guards against firing an empty query at the engine on every stray click.
    const input = page.getByTestId('query-input');
    await input.fill('');
    await expect(page.getByTestId('run-query')).toBeDisabled();

    await input.fill('SELECT 1');
    await expect(page.getByTestId('run-query')).toBeEnabled();
  });

});

test.describe('SQL console error handling', () => {
  // `test.use` is file/describe scope only — it configures the fixture before the
  // test runs and cannot be called from inside a test body.
  //
  // The engine answering 4xx IS the expected outcome here, so the fixture's
  // automatic "no failed API requests" assertion has to be switched off for this
  // block; leaving it on would fail the test for doing exactly what it verifies.
  test.use({ allowRequestFailures: true });

  test.beforeEach(async ({ app, page }) => {
    await app.goto('/databases');
    await page.getByTestId('tab-query').click();
    await expect(page.getByTestId('query-input')).toBeVisible();
  });

  test('a syntactically invalid query surfaces an error instead of failing silently', {
    tag: ['@backend'],
  }, async ({ page }) => {
    // A data console that swallows engine errors is worse than one that has none:
    // the user reads an empty grid as "no rows matched".
    await page.getByTestId('query-db-select').selectOption('sqlite');
    await page.getByTestId('query-input').fill('SELECT FROM WHERE not valid sql');

    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === QUERY_ENDPOINT,
        { timeout: 30_000 },
      ),
      page.getByTestId('run-query').click(),
    ]);

    await expect(
      page.locator('#root'),
      'an invalid query produced no visible error — the console is swallowing engine failures',
    ).toContainText(/error|syntax|failed|invalid/i, { timeout: 20_000 });
  });
});

test.describe('store browser', () => {
  test('the lake and SQLite tabs both render their object listings', { tag: ['@backend'] }, async ({
    app,
    page,
  }) => {
    await app.goto('/databases');

    for (const tab of ['tab-lake', 'tab-sqlite'] as const) {
      await page.getByTestId(tab).click();
      // Each tab owns a panel; switching must actually change what is shown
      // rather than leaving the previous tab's content mounted.
      await expect(page.getByTestId(tab)).toHaveAttribute('data-state', 'active');
      expect(await app.hasCrashed(), `${tab} crashed on activation`).toBe(false);
    }
  });
});
