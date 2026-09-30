/**
 * The client route table, as data.
 *
 * Mirrors the `<Switch>` in `src/client/src/App.tsx`. Kept as a literal rather
 * than imported from the app because the point of the route-coverage spec is to
 * fail when App.tsx changes and this file does not — importing the real table
 * would make the spec agree with any regression automatically.
 *
 * `e2e/specs/smoke/route-table-drift.spec.ts` reads App.tsx and asserts the two
 * lists still agree, so drift is caught in one place instead of silently
 * reducing coverage everywhere.
 */

/** What a route needs before it can render anything meaningful. */
export type RouteTier =
  /** Renders fully with no server data. Safe on a runner with no lake, no DB. */
  | 'static'
  /** Needs the API, and therefore SQLite. Degrades to an empty state without data. */
  | 'backend'
  /** Needs the Iceberg lake at `E:\lake` through DuckDB for its primary content. */
  | 'lake'
  /** Holds an SSE stream or WebSocket open for live content. */
  | 'stream';

export interface RouteSpec {
  /** URL path as wouter matches it. */
  path: string;
  /** Component that renders it, for failure messages. */
  component: string;
  tier: RouteTier;
  /**
   * A string that must appear in the rendered page. Deliberately loose — the
   * assertion is "this route rendered its own content", not "this markup is
   * frozen".
   */
  expectText?: RegExp;
  /** Sidebar nav label, when the route has one (`LeftSidebar.tsx`). */
  navLabel?: string;
  /** Skip in the route sweep, with a reason. Never skip without one. */
  skip?: string;
}

/**
 * Every route mounted by App.tsx. 12 carry a sidebar link; 6 are URL-only
 * (`/forecast`, `/curriculum`, `/fourier`, `/terminals`, `/hardware`,
 * `/training`), which makes this table their only discovery path; 3 are
 * redirects left behind by the 2026-09-16 nav consolidation.
 */
export const ROUTES: RouteSpec[] = [
  { path: '/', component: 'MarketDataPage', tier: 'lake', navLabel: 'Market' },
  { path: '/watchlist', component: 'WatchlistPage', tier: 'backend', navLabel: 'Watchlist' },
  // Holds the Positions and Risk tabs. `/risk` redirects here.
  { path: '/portfolio', component: 'PortfolioPage', tier: 'backend', navLabel: 'Portfolio' },
  // Holds the Pipeline and RL Console tabs. `/rl-console` and `/ml-hub` redirect here.
  { path: '/ml-studio', component: 'MLStudioPage', tier: 'stream', navLabel: 'ML Studio' },
  { path: '/model-catalog', component: 'ModelCatalogPage', tier: 'backend', navLabel: 'Catalog' },
  { path: '/databases', component: 'DatabasesPage', tier: 'backend', navLabel: 'Data' },
  { path: '/lens', component: 'LensPage', tier: 'backend', navLabel: 'Lens' },
  { path: '/studies', component: 'StudiesPage', tier: 'backend', navLabel: 'Studies' },
  { path: '/studies/:slug', component: 'StudyPage', tier: 'lake' },
  { path: '/marimo', component: 'MarimoPage', tier: 'backend', navLabel: 'Notebooks' },
  { path: '/glossary', component: 'GlossaryPage', tier: 'static', navLabel: 'Glossary' },
  { path: '/paper', component: 'PaperPage', tier: 'stream', navLabel: 'Paper' },
  { path: '/news', component: 'NewsPage', tier: 'stream', navLabel: 'News' },
  { path: '/settings', component: 'SettingsPage', tier: 'backend', navLabel: 'System' },

  // URL-only — no sidebar entry points at these.
  { path: '/forecast', component: 'ForecastPage', tier: 'backend' },
  { path: '/curriculum', component: 'CurriculumPage', tier: 'backend' },
  { path: '/fourier', component: 'FourierTransformPage', tier: 'backend' },
  { path: '/terminals', component: 'TerminalsPage', tier: 'stream' },
  { path: '/hardware', component: 'HardwarePage', tier: 'stream' },
  { path: '/training', component: 'TrainingPage', tier: 'stream' },

  // Redirects, not components. Each is swept like any other route: the sweep
  // navigates and asserts something mounted, which for these means the redirect
  // fired and the DESTINATION rendered. A redirect that silently stops firing
  // lands on NotFound, and `hasCrashed()` plus the non-empty <main> assertion
  // would not catch that on their own — `journeys/navigation.spec.ts` asserts
  // the resulting pathname, which is the claim that matters.
  //
  // Their tier is the DESTINATION's tier, because that is what actually renders:
  // tagging `/rl-console` `@static` would let CI run it on a runner where the
  // ML Studio page it lands on cannot work.
  { path: '/ml-hub', component: 'Redirect → /ml-studio', tier: 'stream' },
  { path: '/rl-console', component: 'Redirect → /ml-studio', tier: 'stream' },
  { path: '/risk', component: 'Redirect → /portfolio', tier: 'backend' },
];

/**
 * Routes as they appear in `App.tsx`. Used by the drift guard.
 *
 * The app currently mounts no parameterized route. `/hpo/:sessionId` was the
 * only one and went with the HPO page; `concretePath` below is kept because the
 * next one should not have to re-derive it.
 */
export const ROUTE_PATHS = ROUTES.map((r) => r.path);

/** Turn a `:param` segment into something navigable. */
export function concretePath(path: string): string {
  return path.replace(/:(\w+)/g, (_, name: string) => `e2e-${name}`);
}

/**
 * Tier → Playwright tag.
 *
 * Every spec that NAVIGATES to a route must carry that route's tier tag, not
 * just the route sweep. The tags are how CI selects a runnable subset, and a
 * GitHub runner has no Iceberg lake: `/` mounts MarketDataPage, which requests
 * `/api/charts/ohlcv` unconditionally, so on a runner that request fails and the
 * fixture's network guard — correctly — fails the test.
 *
 * Tagging only the sweep left the navigation and accessibility specs visiting
 * `/` untagged, so `--grep-invert @lake` would have run them anyway and they
 * would have failed for an environmental reason. That is the failure mode that
 * teaches people to ignore a red E2E job.
 */
export const TIER_TAG: Record<RouteTier, string> = {
  static: '@static',
  backend: '@backend',
  lake: '@lake',
  stream: '@stream',
};

/** The tags a spec visiting this route must declare. */
export function tagsForRoute(route: RouteSpec, ...extra: string[]): string[] {
  return [TIER_TAG[route.tier], ...extra];
}

/** Routes reachable by clicking the sidebar, in sidebar order. */
export const NAV_ROUTES = ROUTES.filter((r) => r.navLabel);

/** Routes that render without any server data — the hermetic-safe subset. */
export const STATIC_ROUTES = ROUTES.filter((r) => r.tier === 'static');

/**
 * A path that matches no route, so `NotFound` (`shared/layout/not-found.tsx`)
 * renders. Deliberately odd so it cannot collide with a route added later.
 */
export const UNKNOWN_ROUTE = '/this-route-does-not-exist-e2e';

/**
 * The redirects, as (from → to) pairs, so the navigation spec asserts where each
 * one lands rather than merely that it rendered something.
 */
export const REDIRECTS: Array<{ from: string; to: string }> = [
  { from: '/ml-hub', to: '/ml-studio' },
  { from: '/rl-console', to: '/ml-studio' },
  { from: '/risk', to: '/portfolio' },
];
