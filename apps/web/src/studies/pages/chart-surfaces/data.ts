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
    idiom: "One page holding five vertical tabs",
    channels: ["pair"],
    ownWindow: "last 5,000 / 20,000 / 50,000 bars, horizon 3-96 bars",
    verdict: "A different dataset under the chart's own name. \"MNQ 1m\" here is not what the chart is showing.",
    evidence: [
      "apps/web/src/analytics/AnalyticsPage.tsx:29-30 BAR_WINDOWS and HORIZONS",
      "apps/web/src/analytics/AnalyticsPage.tsx:68-71 reads only SymbolContext",
    ],
  },
  {
    id: "regression",
    label: "Regression",
    route: "/regression",
    idiom: "One page, one scatter per variable",
    channels: ["pair"],
    ownWindow: "1,000-20,000 bars, response horizon 5 bars",
    verdict: "Same split. Its bar count is stored per browser, not taken from the chart.",
    evidence: [
      "apps/web/src/market/regression/RegressionPage.tsx:36-37 BAR_COUNTS, SETTINGS_KEY",
      "apps/web/src/market/regression/RegressionPage.tsx:59-75 defaults: barCount 5000, horizonBars 5",
    ],
  },
  {
    id: "cycle-tab",
    label: "Model Cycle (tab)",
    route: "/analytics, tab 5",
    idiom: "A whole page pushed into a tab, held in place with -mx-4 -mb-4",
    channels: ["pair"],
    ownWindow: null,
    verdict: "A page pretending to be a tab, and it exists twice: this and /cycle.",
    evidence: ["apps/web/src/analytics/AnalyticsPage.tsx:179-181 <TabsContent value=\"models\"> holding CyclePage"],
  },
  {
    id: "cycle",
    label: "Model Cycle",
    route: "/cycle",
    idiom: "Its own route",
    channels: [],
    ownWindow: null,
    verdict: "The real home. The tab above is a copy of it.",
    evidence: ["apps/web/src/App.tsx:206 Route path=\"/cycle\""],
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
    verdict: "The proof the plumbing works: the only surface that reads all three, and the only one that needed no new code to do it.",
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
    verdict: "The pages are separate subjects with their own windows; the index does not even resolve which data is landed.",
    evidence: [
      "measured: GET /api/studies answers 500, so apps/web/src/studies/StudiesPage.tsx:58 finds no datasets and prints no badge",
    ],
  },
];

export const DEAD_TAB_BAR = {
  file: "apps/web/src/market/IntegratedTabs.tsx",
  lines: 225,
  importers: 0,
  what: "A PRICE / ML STUDIO / TERMINAL tab strip with 30 props, replaced by the three-pane grid.",
  evidence: [
    "measured: 0 files in the repository import IntegratedTabs",
    "apps/web/src/market/MarketDataPage.tsx:638 renders MarketGridLayout instead",
  ],
};

export const DEAD_STATE = {
  what: "activeTab still exists, and three things still write to it",
  evidence: [
    "apps/web/src/market/MarketDataPage.tsx:59 const [activeTab, setActiveTab] = useState(\"price\")",
    "apps/web/src/market/MarketDataPage.tsx:80-93 keys 1, 2, 3 call setActiveTab",
    "apps/web/src/market/MarketDataPage.tsx:416 handleOpenMlPanel calls setActiveTab(\"ml-studio\")",
    "apps/web/src/market/MarketDataPage.tsx:457 passes it to Toolbar, which drops it: apps/web/src/market/Toolbar.tsx:89 activeTab: _activeTab, onTabChange: _onTabChange",
  ],
};

export const PUBLISHER = {
  what: "Everything needed to send the window and the selected bar already ships",
  evidence: [
    "apps/web/src/market/lib/useChartContextPublisher.ts:14-15 takes visibleRange and selectedMs",
    "apps/web/src/market/MarketDataPage.tsx:250-259 publishes symbol, timeframe, window, selected bar, first and last bar",
    "apps/web/src/market/lib/chartContextBridge.ts:87 dispatches dashboard:chart-context on window",
  ],
};

export interface Change {
  order: number;
  title: string;
  why: string;
  size: string;
  impact: string;
}

export const CHANGES: Change[] = [
  {
    order: 1,
    title: "Subscribe Analytics and Regression to the published context",
    why:
      "chartContextBridge already dispatches dashboard:chart-context on the window. A ten-line hook turns \"last 20,000 bars\" into the 340 bars on screen and makes the clicked bar the value every panel highlights. Nothing else on this list unlocks as much.",
    size: "2 files, ~30 lines",
    impact: "high",
  },
  {
    order: 2,
    title: "One window, defined once",
    why:
      "Three definitions of \"how much data\" exist today: the chart's scroll, Analytics' bar count, Regression's bar count. Collapse them to the chart's window with a bar-count fallback for a cold chart, so one word means one thing on every surface.",
    size: "3 files",
    impact: "high",
  },
  {
    order: 3,
    title: "One tab strip, and the chart stays mounted under it",
    why:
      "Navigating to /analytics unmounts the chart, which is the mechanical reason no surface downstream can know what you were looking at. A single strip above the chart route group, with the chart alive underneath and only the panel below changing, keeps the window and the selected bar alive for free.",
    size: "1 new component, App.tsx, navigation.ts",
    impact: "high",
  },
  {
    order: 4,
    title: "Delete the dead tab bar, or wire it",
    why:
      "IntegratedTabs.tsx is 225 lines with no importer, keys 1/2/3 set state nothing reads, and the toolbar's ML button does the same. A shortcut that silently does nothing is worse than no shortcut.",
    size: "delete 1 file, 4 edits",
    impact: "medium",
  },
  {
    order: 5,
    title: "Move Model Cycle out of the Analytics tab",
    why:
      "CyclePage sits in a TabsContent held in place by -mx-4 -mb-4, and /cycle already exists as its own route. Two homes for one surface; the negative margins are the tell that it does not belong there.",
    size: "AnalyticsPage.tsx, App.tsx, navigation.ts",
    impact: "medium",
  },
  {
    order: 6,
    title: "Delete the Mandatory Analytics Structure box",
    why:
      "Three lines of prompt-to-the-agent rendered as permanent chrome above every tab of every visit (AnalyticsPage.tsx:137-146). It is an instruction to me, not information for the reader.",
    size: "10 lines",
    impact: "low",
  },
  {
    order: 7,
    title: "Repoint the study index generator and regenerate",
    why:
      "scripts/build_study_index.mjs:16 writes to src/server/studies/handlers/index.ts, a path from before the apps/ split, so only 4 of the 55 handlers on disk are registered. Every other study answers 404 and the listing answers 500.",
    size: "1 path, then run the script",
    impact: "medium",
  },
];

export const STUDIO_CHROME = {
  what: "Two more navigations already exist, which is why nothing feels like a tab",
  evidence: [
    "apps/web/src/shared/hooks/navigation.ts: the left sidebar, grouped by research lifecycle",
    "apps/web/src/shared/quant-layout/HorizontalNav.tsx:6-13 a top bar: Assets, Models, Inference, Datasets, Experiments, Knowledge",
    "apps/web/src/shared/quant-layout/ActivityBar.tsx:8 a third strip, same six labels",
  ],
};