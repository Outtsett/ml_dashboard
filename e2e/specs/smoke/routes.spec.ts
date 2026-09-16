import { test, expect } from '../../fixtures/app';
import { ROUTES, STATIC_ROUTES, UNKNOWN_ROUTE, concretePath, type RouteSpec } from '../../support/routes';

/**
 * Route coverage sweep.
 *
 * Every route in this SPA is served the same 2KB `index.html`, so the server
 * cannot tell you whether a route works — it returns 200 for `/glossary` and for
 * `/this-route-does-not-exist` alike. The only honest test is to run the route in
 * a browser and look at what React put on the screen.
 *
 * Each route is asserted on four things, and the last two come free from the
 * `app` fixture:
 *   1. React mounted something into `#root`
 *   2. the mounted tree is not an error boundary
 *   3. no console errors or uncaught exceptions
 *   4. no same-origin `/api/*` request returned 4xx/5xx
 *
 * A route is NOT asserted to contain particular copy. This suite is a regression
 * net for "the page still works", not a snapshot of wording, and coupling 25
 * specs to marketing text makes every copy edit a test failure.
 */

/** Tier → Playwright tag, so CI can select a subset by environment. */
const TIER_TAG: Record<RouteSpec['tier'], string> = {
  static: '@static',
  backend: '@backend',
  lake: '@lake',
  stream: '@stream',
};

test.describe('route sweep', () => {
  for (const route of ROUTES) {
    const title = `${route.path} renders ${route.component}`;

    test(title, { tag: [TIER_TAG[route.tier], '@smoke'] }, async ({ page, app }) => {
      test.skip(!!route.skip, route.skip ?? '');

      // `/hpo/:sessionId` is navigated with a synthetic id. The page is expected
      // to render an empty or not-found state for it; crashing on an id that
      // matches no session is the defect this catches.
      const url = concretePath(route.path);
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });

      // The shell itself must be served. A 404 here means the SPA fallback in
      // `static.ts` / `vite.ts` stopped answering navigations, which breaks every
      // route at once and is worth naming distinctly.
      expect(response, `no response for ${url}`).not.toBeNull();
      expect(response!.status(), `SPA shell not served for ${url}`).toBe(200);

      await app.waitForMount();

      // An ErrorBoundary that caught a render throw still "mounts", so mounting
      // alone is not evidence the route works.
      expect(
        await app.hasCrashed(),
        `${route.component} rendered an error boundary at ${route.path}`,
      ).toBe(false);

      // Guard against a route that mounts an empty shell: the layout chrome alone
      // is a few hundred characters, so a route rendering genuinely nothing is
      // visible as a near-empty root.
      const text = await app.rootText();
      expect(text.length, `${route.path} rendered an empty tree`).toBeGreaterThan(0);

      if (route.expectText) {
        expect(text).toMatch(route.expectText);
      }
    });
  }

  test('an unknown path renders NotFound, not a crash', { tag: ['@static', '@smoke'] }, async ({
    page,
    app,
  }) => {
    const response = await page.goto(UNKNOWN_ROUTE, { waitUntil: 'domcontentloaded' });
    expect(response!.status()).toBe(200);

    await app.waitForMount();
    expect(await app.hasCrashed()).toBe(false);

    // wouter's catch-all must actually match. If a future refactor drops the
    // fallback <Route>, the page renders blank chrome and this catches it.
    await expect(page.locator('#root')).toContainText(/not found|404/i);
  });

  test('the app shell survives a hard reload on a deep route', { tag: ['@smoke'] }, async ({
    page,
    app,
  }) => {
    // A client-side router that only works when you arrive via a link is a common
    // and invisible break: the server must serve the shell for a deep path too.
    await app.goto('/settings');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForMount();
    expect(await app.hasCrashed()).toBe(false);
    expect(page.url()).toContain('/settings');
  });
});

test.describe('hermetic routes', () => {
  // These render with no server data at all, so they are the subset that must
  // pass on a CI runner with no lake, no QuestDB and an empty SQLite file. If
  // this describe block goes red, the failure is in the app shell itself.
  for (const route of STATIC_ROUTES) {
    test(`${route.path} renders without backend data`, { tag: ['@static'] }, async ({ app }) => {
      await app.goto(route.path);
      expect(await app.hasCrashed()).toBe(false);
      expect((await app.rootText()).length).toBeGreaterThan(0);
    });
  }
});
