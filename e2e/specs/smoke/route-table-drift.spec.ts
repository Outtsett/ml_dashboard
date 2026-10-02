import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { ROUTE_PATHS } from '../../support/routes';

/**
 * The drift guard.
 *
 * `e2e/support/routes.ts` is a hand-written copy of the router in
 * `apps/web/src/App.tsx`. That duplication is deliberate — importing the real
 * table would make the route sweep agree with any change automatically, so a
 * deleted route would silently delete its own test rather than fail one.
 *
 * The cost of the duplication is that the copy can go stale, and a stale copy
 * reduces coverage without ever going red. This spec pays that cost: it reads
 * App.tsx as text, extracts the paths, and fails when the two lists disagree —
 * naming exactly which route was added or removed.
 *
 * Adding a route to the app is therefore a two-line change: the `<AppRoute>` and
 * the entry here. That is the intended friction.
 */

const APP_TSX = path.resolve(import.meta.dirname, '../../../apps/web/src/App.tsx');

/**
 * Pull every `path="..."` out of the `<Switch>` block. Both `<AppRoute path=>`
 * and the bare `<Route path=>` used for the `/ml-hub` redirect are matched; the
 * catch-all `<Route>` carries no path and is correctly not captured.
 */
function routePathsFromApp(source: string): string[] {
  const switchBlock = source.slice(source.indexOf('<Switch>'), source.indexOf('</Switch>'));
  expect(switchBlock.length, 'could not locate the <Switch> block in App.tsx').toBeGreaterThan(0);

  const paths = [...switchBlock.matchAll(/<(?:AppRoute|Route)\s+path="([^"]+)"/g)].map((m) => m[1]!);
  return [...new Set(paths)];
}

test.describe('route table drift', () => {
  test('e2e/support/routes.ts matches the router in App.tsx', { tag: ['@smoke', '@static'] }, () => {
    const source = fs.readFileSync(APP_TSX, 'utf-8');
    const appPaths = routePathsFromApp(source);

    const missingFromTable = appPaths.filter((p) => !ROUTE_PATHS.includes(p));
    const staleInTable = ROUTE_PATHS.filter((p) => !appPaths.includes(p));

    expect(
      missingFromTable,
      `App.tsx mounts route(s) the E2E route table does not cover, so they are UNTESTED. ` +
        `Add them to e2e/support/routes.ts with the right tier:\n  ${missingFromTable.join('\n  ')}`,
    ).toEqual([]);

    expect(
      staleInTable,
      `The E2E route table lists route(s) App.tsx no longer mounts, so the sweep is asserting ` +
        `against the catch-all NotFound page and passing for the wrong reason. Remove them from ` +
        `e2e/support/routes.ts:\n  ${staleInTable.join('\n  ')}`,
    ).toEqual([]);

    // Belt and braces: equal sets of equal size means equal lists here.
    expect(new Set(ROUTE_PATHS).size, 'duplicate path in the E2E route table').toBe(
      ROUTE_PATHS.length,
    );
  });

  test('every sidebar nav target is a real route', { tag: ['@smoke', '@static'] }, () => {
    // `LeftSidebar.tsx` and `App.tsx` are kept in sync by hand — the sidebar's
    // own comment (lines 23-29) says so. A nav item pointing at a path with no
    // route renders the NotFound page on click, which is a dead link the user
    // finds before any test does.
    const sidebar = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../../apps/web/packages/shared/src/quant-layout/LeftSidebar.tsx'),
      'utf-8',
    );
    const hrefs = [...sidebar.matchAll(/href:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);

    expect(hrefs.length, 'found no nav items in LeftSidebar.tsx — did NAV_ITEMS move?').toBeGreaterThan(0);

    const dead = hrefs.filter((h) => !ROUTE_PATHS.includes(h));
    expect(dead, `sidebar link(s) point at paths with no route:\n  ${dead.join('\n  ')}`).toEqual([]);
  });
});
