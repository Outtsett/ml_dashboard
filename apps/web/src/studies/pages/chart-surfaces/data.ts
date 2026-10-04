/**
 * What was measured on 2026-10-04, reading the code rather than the intent:
 * which surfaces sit beside the Market chart, how each one is reached, and
 * which of the chart's three published context channels each one consumes.
 *
 *   pair    symbol + timeframe      SymbolContext, the one shared selection
 *   window  the bars now on screen  useChartContextPublisher -> visibleRange
 *   bar     the bar last clicked    useChartContextPublisher -> selectedMs
 *
 * Every `evidence` line is a file and line in this repository.
 */

export type Channel = "pair" | "window" | "bar";

export interface Surface {
  id: string;
  label: string;
  route: string;
  idiom: string;
  channels: Channel[];
  /** The window this surface defines for itself, when it does not use the chart's. */
  ownWindow: string | null;
  verdict: string;
  evidence: string[];
}

export const CHANNELS: Array<{ id: Channel; label: string; glyph: string; color: string; blurb: string }> = [
  {
    id: "pair",
    label: "symbol + timeframe",
    glyph: "S",
    color: "#56B4E9",
    blurb: "The one shared selection (SymbolContext). Every market surface reads it.",
  },
  {
    id: "window",
    label: "visible window",
    glyph: "W",
    color: "#E69F00",
    blurb: "The bars the chart is showing, from its own scroll. Published, never read back.",
  },
  {
    id: "bar",
    label: "selected bar",
    glyph: "B",
    color: "#CC79A7",
    blurb: "The bar last clicked. Published on purpose, so a question is asked about one bar.",
  },
];

export const SOURCE = {
  label: "Market chart",
  route: "/",
  idiom: "Three resizable panes: chart, ML workflow, terminal",
  publishes: ["pair", "window", "bar"] as Channel[],
};

export const SURFACES: Surface[] = [
  {
    id: "analytics",
    label: "Analytics",
    route: "/analytics",
    idiom: "One page holding four vertical tabs",
    channels: ["pair", "window"],
    ownWindow: "follows the chart's window; a fixed 5,000 / 20,000 / 50,000 is still offered",
    verdict: "Same bars as the chart by default. Pick a fixed count and it stops following again.",
    evidence: [
      "apps/web/src/analytics/AnalyticsPage.tsx window select: \"the chart's window\" plus the fixed counts",
      "apps/web/src/market/lib/useChartWindow.ts chartWindowFrom, clamped to the route's own 500-100,000",
    ],
  },
  {
    id: "regression",
    label: "Regression",
    route: "/regression",
    idiom: "One page, one scatter per variable",
    channels: ["pair", "window"],
    ownWindow: "follows the chart's window; the fixed counts are behind one checkbox",
    verdict: "Same bars as the chart by default, so a scatter describes the window you were just looking at.",
    evidence: [
      "apps/web/src/market/regression/RegressionPage.tsx followChartWindow in StoredSettings, default true",
      "apps/web/src/market/regression/RegressionPage.tsx \"the chart's window\" checkbox beside the Bars control",
    ],
  },
  {
    id: "cycle",
    label: "Model Cycle",
    route: "/cycle",
    idiom: "Its own route, now also a sidebar entry",
    channels: [],
    ownWindow: null,
    verdict: "One home. It used to be duplicated as a fifth Analytics tab held in place by -mx-4 -mb-4.",
    evidence: [
      "apps/web/src/App.tsx:206 Route path=\"/cycle\"",
      "apps/web/src/shared/hooks/navigation.ts Research group now lists Model Cycle",
    ],
  },
  {
    id: "studio",
    label: "ML Studio",
    route: "/ml-studio",
    idiom: "Its own page, follows the shared selection",
    channels: ["pair"],
    ownWindow: null,
    verdict: "Correct as it stands: it is a pipeline, not a view of the chart.",
    evidence: ["apps/web/src/ml/StudioSelectionSync.tsx follows SymbolContext"],
  },
  {
    id: "notebooks",
    label: "Notebooks",
    route: "/marimo",
    idiom: "Iframes beside the chart, fed by postMessage",
    channels: ["pair", "window", "bar"],
    ownWindow: null,
    verdict: "Still the only surface that reads the clicked bar, and the reason the bridge was written.",
    evidence: [
      "apps/web/src/market/lib/chartContextBridge.ts:37-53 posts to every /marimo/ frame",
      "apps/web/src/studies/pages/chart-companion/Page.tsx:104 reads followed.context?.selectedMs",
    ],
  },
  {
    id: "lens",
    label: "Model Lens",
    route: "/lens",
    idiom: "Its own page, scoped to a model",
    channels: [],
    ownWindow: null,
    verdict: "Rightly not a chart tab: the subject is a model, not a symbol.",
    evidence: ["apps/web/src/App.tsx:204 Route path=\"/lens\""],
  },
  {
    id: "studies",
    label: "Studies",
    route: "/studies",
    idiom: "An index of 58 pages",
    channels: [],
    ownWindow: null,
    verdict: "Its own subject and its own windows. What it cannot do is read the lake: the serving snapshot is unreachable, so every page and the listing answer an error.",
    evidence: [
      "measured: GET /api/studies answers 500 — connection.ts:336 \"Lake serving snapshot s3://derived/recipe=lake_snapshot_2026-09-09/ is empty or unreachable\"",
      "measured: all 55 handlers are registered (scripts/build_study_index.mjs now points at apps/api)",
    ],
  },
];

/** What was removed on 2026-10-04, and what it cost. */
export const REMOVED = {
  file: "apps/web/src/market/IntegratedTabs.tsx",
  lines: 225,
  what: "A PRICE / ML STUDIO / TERMINAL tab strip, replaced by the three-pane grid, with no importer anywhere.",
  alsoRemoved: [
    "apps/web/src/market/MarketDataPage.tsx activeTab state and the keys 1 / 2 / 3 that wrote it",
    "activeTab and onTabChange props on both toolbars, which destructured them to _activeTab and dropped them",
    "apps/web/src/analytics/AnalyticsPage.tsx the Models & Cycles tab and its -mx-4 -mb-4 escape hatch",
    "apps/web/src/analytics/AnalyticsPage.tsx the Mandatory Analytics Structure box above every tab",
  ],
  givenARealTarget:
    "The toolbar's ML Tools button called onOpenMlPanel, which set a tab nothing read. It now navigates to /ml-studio.",
};

/** Still to do. */
export const REMAINING = {
  title: "One tab strip, and the chart stays mounted under it",
  why:
    "Analytics and Regression now know which bars the chart was showing, so the data is shared. The navigation is not: the chart still unmounts when you leave it, and three navigations (the sidebar, the top bar and the activity bar) still describe the dashboard three different ways. This is a product decision about where the strip lives, not a defect.",
};

export const PUBLISHER = {
  what: "Everything needed to send the window and the selected bar already ships",
  evidence: [
    "apps/web/src/market/lib/useChartContextPublisher.ts:14-15 takes visibleRange and selectedMs",
    "apps/web/src/market/MarketDataPage.tsx:250-259 publishes symbol, timeframe, window, selected bar, first and last bar",
    "apps/web/src/market/lib/chartContextBridge.ts:87 dispatches dashboard:chart-context on window",
    "apps/web/src/market/lib/useChartWindow.ts is the one reader: usePublishedChartContext plus chartWindowFrom",
  ],
};

export interface Change {
  order: number;
  title: string;
  why: string;
  size: string;
  impact: string;
  done: boolean;
}

export const CHANGES: Change[] = [
  {
    order: 1,
    title: "Subscribe Analytics and Regression to the published context",
    why:
      "chartContextBridge already dispatches dashboard:chart-context on the window. useChartWindow.ts turns \"last 20,000 bars\" into the bars on screen. Nothing else on this list unlocks as much.",
    size: "1 new module, 2 pages",
    impact: "high",
    done: true,
  },
  {
    order: 2,
    title: "One window, defined once",
    why:
      "The chart's visible window is now the default on both surfaces, converted to the bar count each route accepts and clamped to that route's own range, with the fixed counts still one click away.",
    size: "1 new module, 2 pages",
    impact: "high",
    done: true,
  },
  {
    order: 3,
    title: "Delete the dead tab bar, or wire it",
    why:
      "IntegratedTabs.tsx is deleted, the activeTab state and the keys that wrote it are gone, and the ML Tools button that wrote it now navigates to /ml-studio.",
    size: "1 file deleted, 4 edited",
    impact: "medium",
    done: true,
  },
  {
    order: 4,
    title: "Move Model Cycle out of the Analytics tab",
    why:
      "The fifth Analytics tab is gone; /cycle is the single home and is now a sidebar entry, so the surface did not lose its place in the navigation.",
    size: "AnalyticsPage.tsx, navigation.ts",
    impact: "medium",
    done: true,
  },
  {
    order: 5,
    title: "Delete the Mandatory Analytics Structure box",
    why:
      "Three lines of prompt-to-the-agent rendered as permanent chrome above every tab of every visit.",
    size: "10 lines",
    impact: "low",
    done: true,
  },
  {
    order: 6,
    title: "Repoint the study index generator and regenerate",
    why:
      "scripts/build_study_index.mjs wrote to src/server/studies/handlers/index.ts, a path from before the apps/ split, so 4 of the 55 handlers were registered. All 55 are registered now. The listing still answers 500, but for a different and stated reason: the lake serving snapshot itself is unreachable.",
    size: "1 path, then run the script",
    impact: "medium",
    done: true,
  },
  {
    order: 7,
    title: "One tab strip, with the chart mounted underneath",
    why:
      "The data plumbing is shared; the navigation is not. The chart still unmounts when you navigate away, and the clicked bar still reaches only the notebooks. Where the strip lives is a product decision, so it is listed here rather than done.",
    size: "1 new component, App.tsx, navigation.ts",
    impact: "high",
    done: false,
  },
];

export const STUDIO_CHROME = {
  what: "Three navigations still describe the dashboard three different ways",
  evidence: [
    "apps/web/src/shared/hooks/navigation.ts: the left sidebar, grouped by research lifecycle",
    "apps/web/src/shared/quant-layout/HorizontalNav.tsx:6-13 a top bar: Assets, Models, Inference, Datasets, Experiments, Knowledge",
    "apps/web/src/shared/quant-layout/ActivityBar.tsx:8 a third strip, same six labels",
  ],
};