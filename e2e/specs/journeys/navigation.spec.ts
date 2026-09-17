import { test, expect } from '../../fixtures/app';
import { NAV_ROUTES, tagsForRoute } from '../../support/routes';

/**
 * Navigation through the app shell.
 *
 * The route sweep (`smoke/routes.spec.ts`) proves each route renders when you
 * navigate to its URL directly. This proves a user can actually GET there —
 * which is a different claim. A route can be perfectly healthy and completely
 * unreachable because its sidebar link points at the wrong path, and a URL-based
 * sweep would never notice.
 *
 * Selectors key on `data-testid="nav-<slug>"` rather than link text, because the
 * label span is conditional on the rail being expanded
 * (`LeftSidebar.tsx`) — a text selector would pass today and break the moment
 * anyone collapses the sidebar.
 */

test.describe('sidebar navigation', () => {
  test('the shell renders with all sixteen nav links', { tag: ['@smoke', '@static'] }, async ({ page, app }) => {
    // `/glossary`, not `/`. The sidebar is identical on every route, and `/`
    // mounts MarketDataPage, which needs the lake — asserting chrome from a
    // lake-dependent page would make this spec unrunnable in CI for no reason.
    await app.goto('/glossary');

    for (const route of NAV_ROUTES) {
      const slug = route.path === '/' ? 'market' : route.path.slice(1);
      await expect(
        page.getByTestId(`nav-${slug}`),
        `sidebar is missing the ${route.navLabel} link`,
      ).toBeVisible();
    }

    // Exactly the routes in the table — an extra link means the table is stale
    // and a page is being shipped without route-sweep coverage.
    const count = await page.locator('[data-testid^="nav-"]').count();
    expect(count, 'sidebar link count drifted from the E2E route table').toBe(NAV_ROUTES.length);
  });

  for (const route of NAV_ROUTES) {
    const slug = route.path === '/' ? 'market' : route.path.slice(1);

    // Inherits the destination route's tier tag, so `--grep-invert @lake` in CI
    // skips the journeys whose destination needs data a runner does not have.
    test(`clicking "${route.navLabel}" navigates to ${route.path}`, { tag: tagsForRoute(route, '@nav') }, async ({
      page,
      app,
    }) => {
      // Start somewhere that is not the destination, so a no-op click cannot
      // pass by accident.
      await app.goto(route.path === '/glossary' ? '/' : '/glossary');

      await page.getByTestId(`nav-${slug}`).click();
      await app.waitForMount();

      // wouter pushes state; the URL is the observable outcome.
      const pathname = new URL(page.url()).pathname;
      expect(pathname, `"${route.navLabel}" led to ${pathname}`).toBe(route.path);

      expect(
        await app.hasCrashed(),
        `${route.component} crashed when reached via the sidebar`,
      ).toBe(false);
    });
  }

  test('the active link is marked while on its route', { tag: ['@nav'] }, async ({ page, app }) => {
    // Without this the user has no idea where they are. It is also the only
    // thing distinguishing the active item, since the styling is the state.
    await app.goto('/glossary');
    const active = page.getByTestId('nav-glossary');
    await expect(active).toBeVisible();

    // The active item gets the gold accent colour; asserting the class would
    // couple to Tailwind internals, so this asserts the rendered colour instead.
    const color = await active.locator('span').first().evaluate(
      (el) => getComputedStyle(el).color,
    );
    await app.goto('/settings');
    const inactiveColor = await page.getByTestId('nav-glossary').locator('span').first().evaluate(
      (el) => getComputedStyle(el).color,
    );

    expect(
      color,
      'the active sidebar item is styled identically to an inactive one — there is no "you are here"',
    ).not.toBe(inactiveColor);
  });
});

test.describe('browser history', () => {
  test('back and forward move through client-side routes', { tag: ['@nav', '@backend'] }, async ({ page, app }) => {
    // A pushState router that does not handle popstate strands the user: Back
    // changes the URL and leaves the old page on screen.
    //
    // Uses /settings and /glossary rather than `/`, so the spec exercises the
    // router without dragging in the lake-backed market page.
    await app.goto('/settings');
    await page.getByTestId('nav-glossary').click();
    await app.waitForMount();
    expect(new URL(page.url()).pathname).toBe('/glossary');

    await page.goBack();
    await app.waitForMount();
    expect(new URL(page.url()).pathname, 'Back did not return to the previous route').toBe('/settings');

    await page.goForward();
    await app.waitForMount();
    expect(new URL(page.url()).pathname, 'Forward did not re-enter the route').toBe('/glossary');
    expect(await app.hasCrashed()).toBe(false);
  });

  test('/ml-hub redirects to /ml-studio', { tag: ['@nav', '@smoke'] }, async ({ page, app }) => {
    // The one redirect in the router. It exists so an old bookmark keeps working,
    // which is precisely the kind of thing that breaks unnoticed.
    await app.goto('/ml-hub');
    await expect(async () => {
      expect(new URL(page.url()).pathname).toBe('/ml-studio');
    }).toPass({ timeout: 10_000 });
  });
});
