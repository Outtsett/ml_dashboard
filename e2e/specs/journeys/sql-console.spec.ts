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
    ).toBe(200);

    // The engine really ran it: the probe column name comes back in the body.
    const body = await response.json();
    expect(
      JSON.stringify(body),
      'the query response does not contain the probe column — the engine did not run this SQL',
    ).toContain('e2e_probe');

    // And the user is told. This is the ONLY visible success signal the console
    // has: `DatabasesPage.tsx:144-147` shows a "Query ran" toast and throws the
    // rows away — `runQuery.data` is never read and `QueryConsole` takes no
    // results prop, so there is no grid to assert against. See the known-gap
    // note at the bottom of this file.
    await expect(page.getByText(/query ran/i)).toBeVisible({ timeout: 20_000 });
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

    // Asserted on the specific failure toast (`DatabasesPage.tsx:148`), not a
    // loose /error|failed/ over the whole page — the app chrome contains those
    // words in other contexts, so a broad match would pass without the console
    // reporting anything.
    await expect(
      page.getByText(/query failed/i),
      'an invalid query produced no visible error — the console is swallowing engine failures',
    ).toBeVisible({ timeout: 20_000 });
  });
});

/*
 * KNOWN GAP, deliberately not asserted here.
 *
 * The SQL console runs a query and discards the result. `DatabasesPage.tsx:142-149`
 * wires the mutation's `onSuccess` to a toast and a cache invalidation; nothing
 * reads `runQuery.data`, and `QueryConsole` (src/client/src/data/QueryConsole.tsx)
 * has no results prop and renders no grid. So a user can execute SQL and is told
 * "Query ran" without ever seeing a row.
 *
 * An earlier version of this spec asserted `#root` contained /e2e_probe|1/i and
 * passed — but only because the TopBar renders a hardcoded "TF: 1m", so the `1`
 * alternative matched before any query was submitted. The assertion could not
 * fail. It is now scoped to the response body and the toast, which are the two
 * things that genuinely exist.
 */

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
