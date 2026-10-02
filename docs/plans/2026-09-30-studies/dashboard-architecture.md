# How a new analytic page is added to the ML Dashboard, and a study-page framework for retiring the marimo notebooks

All paths are under `E:\source\repos\ml_dashboard` unless stated. Line numbers are as of branch `feat/realtime-dashboard-redesign`. Nothing was written, run or started. I did not run any lake queries.

## 0. What "every notebook" means

`src/config/notebooks.json` holds 6 groups and 52 marimo notebooks. I counted them with the same rule `catalog.ts` uses: direct-child `*.py` files containing `marimo.App(` in the first 64 KB.

| Group | Notebooks | What they read |
|---|---|---|
| `ml-dashboard` | 12 (6,412 lines in `notebooks/`) | `lake.serving` views, `derived_*` tables |
| `datalake` | 17 | `lake.catalog` with `read_parquet`, plus standalone `.duckdb` files |
| `quant` | 15 | lake loaders, mostly static |
| `chart-cnn` | 3 | local files |
| `forexmodel` | 3 | local files |
| `quantlab` | 2 | local files |

Data-source classes that decide the work per page (by grep of the notebook source; classification is approximate):

- **A, derived lake tables (about 12):** `model_cycle_runs.py`, `label_catalog.py`, `ta_strategy_600_ticks.py`, `multimodal_model.py` and similar. The dashboard's DuckDB can already read these as `derived_<dataset>[_<table>]`.
- **B, `lake.catalog` with `read_parquet` and Python compute (about 10 datalake notebooks):**
  - `candle_pattern_scorecard`, `candlestick_pattern_census`, `frozen_candle_encoder`, `single_candle_recognizer`, `volume_candle_anatomy` and `what_to_encode`.
  - The heavy ones: `mnq_candle_vectors.py` (2,023 lines, uses torch and scipy) and `mnq_indicator_study.py` (1,936 lines).
  - They need either SQL in a router or a precompute runner.
- **C, standalone `.duckdb` files, which the dashboard DuckDB cannot read:**
  - `lake_explorer.py` opens `E:\lake\_meta\workspace.duckdb`.
  - `tails.py` opens `E:/lake/_meta/tails.duckdb`.
  - `data_format_inventory.py` opens `INVENTORY_DATABASE`.
  - `findings_casebook.py` opens `CASEBOOK`.
  - `market_bars_columns.py` and `mnq_talib_1m.py` open `WORKSPACE`.
  - The dashboard's DuckDB is `:memory:` with no `ATTACH`, so these tables must be landed under `derived/` first.
- **D, not lake data:** `timescaledb_load.py` (psycopg), `process_census.py` (process list), `contract_specifications.py` (JSON).

Some notebooks compute at view time. `ta_strategy_600_ticks.py` (1,714 lines, 92 `mo.ui` controls, 113 Altair charts) imports `ta_strategy` and TA-Lib for section 15, "how a zone is built". A page cannot rerun that in Express, so those pages need a precompute runner (section 3).

---

## 1. Client: adding a page

### 1.1 Route registration (`src/client/src/App.tsx`)

- **Lazy loading:** every page is lazy-loaded through `lazyRetry` (lines 28-47). It retries stale-chunk failures twice, then reloads the window.
- **Factory and prefetch:** each route has a factory constant plus `registerComponentFactory(route, factory)`, which feeds hover-prefetch (`infrastructure/lib/prefetch.ts:10`).
  ```tsx
  const LabelsFactory = () => import("@/labels/LabelsPage");        // :143
  const Labels = lazyRetry(LabelsFactory, "Labels");
  registerComponentFactory("/labels", LabelsFactory);
  ```
- **Mounting:** every non-Market route mounts inside `<ResizableSidePanel>` over the persistent Market chart (`App.tsx:170-211`). Pages never own the full window. The panel is 380 px minimum and 45% wide by default; `requestSidePanelWidth("wide")` widens it to 72%. The layout must be fluid and use `grid xl:grid-cols-2`.
  ```tsx
  <Route path="/labels"><ErrorBoundary><Suspense fallback={<PageLoader />}><Labels /></Suspense></ErrorBoundary></Route>   // :197
  ```
- **Catch-all:** `<Route>` with no path at line 203 renders NotFound.
- **Test drift guard:** `e2e/specs/smoke/route-table-drift.spec.ts` regexes `<(?:AppRoute|Route)\s+path="…"` out of the `<Switch>` block. It fails unless `e2e/support/routes.ts` lists the same paths with a tier: `static`, `backend`, `lake` or `stream`. `concretePath()` turns `:slug` into `e2e-slug`. A second test requires every `href:` in `LeftSidebar.tsx` to be a listed route.

### 1.2 Navigation has two separate lists

Both must be edited today. `LeftSidebar.tsx` lines 6-12 say so in a comment.

1. **`shared/quant-layout/LeftSidebar.tsx:24-40`** is what users see. It is a flat `NAV_ITEMS = [{label, href, icon}]` of 15 entries.
   - Active state is `location.startsWith(href)` (line 55).
   - Each item gets a test id of `nav-${href.slice(1)}`.
   - The Notebooks entry is `{ label: "Notebooks", href: "/marimo", icon: NotebookPen }`.
2. **`shared/hooks/navigation.ts:57-229`** is `NAVIGATION_CONFIG`, grouped by Live / Research / Validate / Operate / System. Its only consumer is `shared/layout/CommandPalette.tsx:13,90`.
   - Entries carry `description` and `pending`.
   - `ROUTE_META` and `ALL_NAV_ITEMS` (lines 254-273) derive from it.

Fifty pages cannot go in a 15-item rail. Put one "Studies" rail entry in the sidebar and have the command palette list every study from the registry (section 6).

### 1.3 How an existing multi-tab analytic page is built

**`src/client/src/analytics/`** is the closest template, 7 files:

| File | Role |
|---|---|
| `AnalyticsPage.tsx` (155 lines) | `PageShell` from `@/backtest/components`. `useSymbolContext()` supplies symbol and timeframe. Local `useState` holds window and horizon. The tab is remembered in `localStorage` (`analytics-tab-v1`, try/catch-wrapped). shadcn `Tabs`, one `*Panel` per tab. |
| `data.ts` (33 lines) | The one data hook pattern (below). |
| `common.tsx` (186 lines) | De-facto kit: `OKABE`, `AXIS`, `GRID`, `TOOLTIP`, `toneOf`, `fmt/fmtInt/fmtPercent/fmtUsd/fmtTime`, `Section`, `Stat`, `SummaryTable` (the eight-number rule), `Histogram` (Recharts, blue below zero, orange above), `ProbabilityBar`, `Empty`. Axis and tooltip styles are imported from `@/lens/panels/format`. |
| `DescriptivePanel.tsx` etc. | A `Stat` grid, then `Section`s holding Recharts `LineChart`/`BarChart` with `isAnimationActive={false}` and `Cell fill={toneOf(v)}` for orange/blue direction. |

**Data hook pattern** (`analytics/data.ts`):
```ts
export function useAnalytics(request) {
  return useQuery({
    queryKey: ["analytics", request.symbol, request.timeframe, request.bars, request.horizon],
    queryFn: ({ signal }) => fetchAnalytics(request, signal),   // fetch(`/api/analytics?${URLSearchParams}`, { signal })
    staleTime: 5 * 60_000, enabled: Boolean(request.symbol) });
}
```
- Every control value is in the query key.
- The body is typed from `@shared/analytics/types`. Both server and client import the same contract.
- Errors throw `body.error ?? "…failed (status)"`.
- The global query client (`infrastructure/api/query_client.ts:87-95`) has `staleTime` 5 min and `retry` 1.

**`labels/` and `cycle/`:**
- `labels/` is page + `useLabelLifecycle.ts`. It is one hook per concern: `useLabelLifecycle`, `useLabelSets`, `useLabelSuite`, `useLabelActions`. It exports `LABEL_QUERY_KEYS` and polls with `refetchInterval` 15 s while a job is running. Contract types come from `@shared/labels/contract`.
- `cycle/` is the heavier stateful pattern: a zustand store, a per-run SSE connection (`connection.ts`), and `report/useReport.ts`.
  ```ts
  fetchCycleReport → cycleReportSchema.parse(await response.json())
  useQuery({ refetchInterval: live ? 15_000 : false, staleTime: live ? 0 : Infinity })
  ```
  A 404 maps to `null` and the UI says "tables arrive with the first finished fold".
- Both mount `ReadByNotebooks` (`labels/LabelsPage.tsx:12`, `cycle/CyclePage.tsx:14`).

**Shared page chrome:** `backtest/components/` (barrel `index.ts`; its comment still says `@/components/quant`, which does not exist).
- `PageShell`: props `title`, `subtitle`, `icon`, `status` (live/idle/warn/error/info pill), `actions`, `kpis` (`Kpi { label, value, delta, spark, hint }`), `footer`, `dense`, `fillHeight`.
- `KpiStrip`, `KpiCard`, `MetricCell`, `Sparkline`, `DenseTable` (TanStack Table v8: sortable, zebra, sticky header, `meta.align/tone/width`), `CorrelationMatrix` (visx heatmap), `DrawdownChart`, `RollingSharpe`, `ExposureBars`, `RegimeBadge`.

**Other shared pieces:** `shared/ui/` holds shadcn/Radix (`tabs`, `select`, `slider`, `toggle-group`, `switch`, `table`, `card`, `tooltip`, `popover`, `resizable`, `virtual-list`, `chart`, `skeleton`, …). `shared/layout/` has `ErrorBoundary`, `LoadingSkeletons`, `ResizableSidePanel`. `lens/Frame.tsx` (`LensFrame`) is a card with title, question, an n/method line and a drag-resizable height remembered per frame. `SymbolContext` (`shared/contexts/SymbolContext.tsx`) holds one symbol/timeframe, persisted as `dashboard-selection-v1`.

**Chart stacks in use** (all in `package.json`):
- **Recharts 2.15:** most panels.
- **visx** (axis, brush, heatmap, stats, zoom, tooltip, scale, shape): `backtest/components/CorrelationMatrix`, `Sparkline`, `ml/components/HeatmapRenderer`, `cycle/inside/neural/Heatmap.tsx`.
- **D3:** `d3-contour` in `market/regression/ScatterPlot.tsx`. It is a canvas-plus-SVG scatter that draws 20k points, with density contours, edge histograms and a LOESS trend, plus `useMeasuredWidth` (ResizeObserver).
- **lightweight-charts 5.1:** `lens/charts/EquityLens.tsx` and `PriceLens.tsx`. They use `createChart(el, createChartOptions())` (`market/components/chartConfig.ts:71`) and `DATA_COLORS.pos/neg` for orange/blue.
- **Plotly:** `plotly.js-dist-min` and `react-plotly.js` are installed. `surface_3d` uses Three.js.
- **KaTeX:** `market/regression/Formula.tsx` renders TeX with a symbol legend that shows the live value of each symbol, and hover-linked symbols. Its `probeX` slider feeds the numbers. This implements the "formulas are operated objects" rule.
- **Small multiples:** `market/regression/ScatterPanel.tsx` (40 panels) plus `usePanels.ts`, `panels.worker.ts` (Web Worker) and sort/filter controls. `ml/components/MetricGrid.tsx` is the other grid.
- **Heatmap:** `market/components/Heatmap.tsx` (props `data, rowLabels, colLabels, colorRange`).

**Colour tokens (`shared/theme/dataColors.ts`):**
- `DATA_COLORS {pos:#E69F00, neg:#0072B2, neutral:#808A99, warn:#F0E442}`
- `WONG_PALETTE`, `WONG_PALETTE_DARK` and `paletteColor[Dark](i)`
- `trendTone`, `trendGlyph` (▲▼—), `trendToneClass`, `trendToneColor`
- CSS tokens `--data-pos/neg/neutral/warn` and `--data-cat-1..10` in `index.css`, used in markup as `text-(--color-data-pos)`.
- The rule in the file: colour never carries meaning alone, so pair it with a glyph, sign or label.
- `analytics/common.tsx` keeps a second, slightly different `OKABE` constant (it adds `green` and `grey`). Fold it into `dataColors.ts` when promoting the kit.

---

## 2. Server: routers, lake queries, derived views

### 2.1 Router pattern (`analytics/analytics.router.ts` is the template)

- **Shape:** `createAnalyticsRouter(sources = lake, now = Date.now)` takes injected sources so tests run with no lake. `export default createAnalyticsRouter()`.
- **Validation:** a Zod schema (lines 35-40): `symbol: z.string().regex(/^[A-Za-z0-9_.\-]{1,32}$/)`, `timeframe: refine(set.has)`, and bounded `z.coerce.number()`.
- **Flow:** `queryRateLimiter` middleware, `request.setTimeout(120_000)` for cold reads, a `LRUCache` (max 50, ttl 5 min), then `Cache-Control: private, max-age=60`. Errors answer `{ error }`: 400 invalid, 404 too little data, 500 otherwise.
- **Partial failure:** each optional source has its own `.catch`, which pushes a string into `notes[]` instead of failing the page.
- **Mounting:** `infrastructure/core/routes.ts` imports at line 10 and mounts `app.use("/api", analyticsRouter)` at line 97, before `mlRouter` (98). Order matters because `mlRouter` has greedy `/training/:id`-style routes.
  - The 404 catch-all `/api/{*path}` comes after all mounts.
  - `app.use('/api', apiRateLimiter)` is applied to everything first.
  - Routers that are not in `routes.ts` (labels) self-prefix inside `src/server/ml/index.ts`.

### 2.2 Querying the lake (`infrastructure/database/questdb/`)

- **`connection.ts`:**
  - `queryQuestDB<T>(sql, timeoutMs?)` (line 494) and `queryQuestDBFast<T>(sql, signal?)` (line 490) share one path: a new `DuckDBConnection` per call, `con.interrupt()` on timeout or abort, and a `SLOW QUERY` warning.
  - `queryQuestDBStream(sql, onChunk, chunkSize)` is for large results, and `queryQuestDBValidated(sql, zodSchema)` validates rows.
  - `bigint` values are normalised by `normalizeRows`.
- **No parameter binding.** The call is `con.runAndReadAll(sql)` and the only API is a SQL string. The repo's protection is validate-then-interpolate:
  - **Identifier allowlists:** regexes such as `RECIPE_PATTERN = /^[A-Za-z0-9_.\-]{1,160}$/` (`analytics/sources.ts:40`) and `SAFE_NAME = /^[a-z0-9_]+$/` (`derivedDatasets.ts:32`).
  - **Escapers:** `quote()` and `literal()` in `market/bucketing.ts:30-36`.
  - **Catalog allowlists:** `series.router.ts` and `regression.router.ts` accept only catalog ids from `series_catalog.json`, so "no query text comes from the browser".
  - **Allowlist lookups use a `Map`:** a plain object lets `timeframe=constructor` through (CLAUDE.md pitfall).
- **Per-connection state:** a `TEMP VIEW` does not survive to the next query.
- **Missing views** read as zero rows via the `rows()` wrapper in `analytics/sources.ts:50-59`, which catches "does not exist / not found / No files found".
- **Bars:** use `getStitchedOHLCV(symbol, tf, start, end, limit, "ratio")` for futures and `getOHLCVSampleBy` for forex, both exported from `questdb/index.ts`.
- **Generic SQL console:** `POST /api/databases/query` (`data/explorer.router.ts:220`) is guarded by `READ_ONLY_STATEMENT` (tested in `tests/server/explorerQueryGate.test.ts`). The browser must never send SQL to it from a study page; per-study endpoints are the pattern.

### 2.3 Derived views (`questdb/derivedDatasets.ts`)

- **Registry:** the manifest `s3://meta/ingest_manifests/<dataset>.jsonl` is the registry. `defineDerivedViews(con)` (line 109) globs the manifests, plans views with `planDerivedViews` and runs `CREATE OR REPLACE VIEW "<view>" AS SELECT * [EXCLUDE ("table")] FROM read_parquet('s3://derived/<dataset>/recipe=*/[table=<t>/]**/*.parquet', hive_partitioning = true, union_by_name = true)`.
- **Naming:** one table gives `derived_<dataset>`; several tables give `derived_<dataset>_<table>`. The hive `recipe` column is kept, so one query can compare recipes.
- **Refresh:**
  - `refreshDerivedViews()` (`connection.ts:345`) runs at boot.
  - It runs after `labelSetStore.ts:307`, after a finished cycle run (`training/cycle.ts:194`), and on `POST /api/labels/catalog/refresh` (`ml/labels.router.ts:159`).
  - `training/cycleReport.ts` shows the read pattern: `hasView()` via `derivedViews()`, a throttled re-`refreshDerivedViews()` (at most every 60 s) when a view is missing, then `SELECT * FROM derived_model_cycle_runs_<t> WHERE recipe = '<literal>' ORDER BY …`. `wireRow()` camelCases columns, turns bigints into numbers and drops `recipe`.
  - Reading `derived_*` views therefore needs no new server infrastructure: write `SELECT … FROM derived_<dataset>_<table> WHERE recipe = …`, validate the recipe and column names, and cache.
- **Caching:** `lru-cache` in the router (analytics, series, regression: 5 min). There is also a parquet cache in `infrastructure/cache/` and a 15 s chart-route timeout; cold futures stitching takes 9-13 s.

---

## 3. Python runners and precompute into the lake

### 3.1 Launching and streaming

- **Registry:** `src/config/runners.json` has 8 curated runners, keyed `${algorithm}+${task}`.
  - An entry carries `script` (for example `src/ml/ta_strategy/main.py`), `outputDir`, `outputs`, `cliFlags` (`{"round":"--round"}`), `defaultHyperparameters` and `estimatedTrainingTime`.
  - The Model Cycle's 40 `<key>+walk_forward_cycle` runners are generated from `src/config/cycle_models/*.json` by `training/cycleRunners.ts`.
  - The runner for a one-off study is `"ta_indicator_battery+ticks_per_day_goal"`. The `+` key lets it appear in the registry without an algorithm catalog entry.
- **Start:** `POST /api/training/start` (`training/training.router.ts:498`) returns 202 and is handled by `TrainingService`.
  - `training/runners/pythonRunner.ts` spawns `pythonExe` with `cwd: process.cwd()` and `PYTHONUNBUFFERED=1` plus provenance env (lines 223-225).
  - It line-buffers stdout (`splitBufferedLines`, line 41) and feeds `getParser(modelType)` (`runners/parsers/index.ts`: exact match, `generated_` prefix, else `GeneratedParser`).
  - It caps the retained stdout and taskkills the tree on stop. `sendControl()` writes commands to stdin.
  - Events become `emitSessionEvent` → the event bus → SSE at `GET /training/stream/:modelId` and the tab-wide mux (`openEventStream`, never `new EventSource`). Runs are also recorded in SQLite `training_sessions`.
- **Protocol (`src/ml/shared/protocol.py`):** `emit_config`, `emit_log`, `emit_progress(iteration,total,phase)`, `emit_metric(name,value,iteration,total)`, `emit_fold_complete(fold_idx, metrics)`, `emit_done(model_path, diagnostics)`, `emit_error`, `emit_overlay`, `dumps_safe` (NaN-safe). The cycle adds `emit_cycle_*` events.
  - `ta_strategy/main.py` is the clean study-runner example: argparse with `--round`, `--model-id`, `--output-dir`, `--no-land`; `emit_config`, then `emit_progress` per fit, `emit_metric`, `emit_fold_complete` per fold, and `emit_done` (lines 62-276).
  - Training-run rule: start the dashboard first so metrics stream live.

### 3.2 Landing a derived dataset

- **Directory layout:** `s3://derived/<dataset>/recipe=<recipe>/table=<name>/part-0.parquet`, zstd parquet, plus one manifest line per (recipe, table) in `meta/ingest_manifests/<dataset>.jsonl`.
  ```python
  # src/ml/cycle/store.py:575  _land_job(job)
  root = derived_root(job["dataset"], job["recipe"]) / f"table={name}"
  key = arrow_key(root / "part-0.parquet")
  with arrow_fs().open_output_stream(key) as sink:
      pq.write_table(table, sink, compression=COMPRESSION, compression_level=COMPRESSION_LEVEL)
  entry = {"written_at": …, "dataset": …, "table": name, "zone": "derived", "recipe": …, "source": …,
           "rows": …, "duplicates_removed": 0, "file_count": 1, "bytes": size, "ts_min": None, "ts_max": None}
  _append_manifest_line(dataset, json.dumps(entry))    # one line per (recipe, table); re-landing replaces its line
  ```
  - `lake.layout` and `lake.writer` come from the datalake package. When the caller's interpreter lacks them, it runs `_LANDING_SCRIPT` in `CYCLE_LAKE_PYTHON` (default `E:/source/repos/datalake/.venv/Scripts/python.exe`) with the job as JSON argv.
  - **Reusable wrapper for study runners:** `src/ml/ta_strategy/store.py` has `write_local(tables: dict[str, DataFrame], dir)` and `land(paths, recipe, source, dataset=DATASET)`, which reuse `cycle.store._land_job`. A study runner can copy this.
  - **Standalone script alternative:** `scripts/land_regression_tab_performance.py` uses the datalake interpreter directly, writes the same layout and appends the manifest line.
- **Naming inside landed tables:** full words and units in column names. The naming rule applies (CLAUDE.md).
- **Serving lag:** a dataset with a new `table=` needs `POST /api/labels/catalog/refresh` or the next boot; `cycle.ts:194` does this after a run.
- **Pattern for a heavy study:**
  1. Write a runner script under `src/ml/<study>/main.py` that does the Python compute.
  2. Register it in `runners.json`.
  3. Land its tables under `derived/<dataset>/`.
  4. The page reads `derived_<dataset>_<table>` via a thin router and offers a "Run" action that calls `/api/training/start`. The page then shows the SSE progress, as `/cycle` does.
- **Short on-demand Python** (seconds, JSON out): `ml/anatomy.router.ts:247` (`spawnDump`) shows the spawn-with-timeout-and-kill pattern, with `resolvePythonExecutable()` and a `DUMP_TIMEOUT_MS` kill. Use it only for fast jobs.
- **Long-lived compute:** the label job (`infrastructure/lib/labels/labelGenerator.ts`) stages locally and lands after validation. `scripts/run_label_suite.ts` runs it in its own process, because the dev server restarts on every file save (`tsx --watch`) and kills in-process jobs.

---

## 4. Tests and gates

- **Vitest (`vitest.config.ts`):**
  - `tests/**/*.test.{ts,tsx}`, pool `forks`, timeout 30 s.
  - `tests/client/**` runs in jsdom, everything else in node.
  - Aliases `@` → `src/client/src`, `@shared` → `src/shared`.
  - Coverage thresholds are a ratchet (11/6/7/11). `npm run test:ci` excludes `tests/client/**`.
- **Layout:**
  - `tests/server/` (route tests, for example `analyticsRoute.test.ts`).
  - `tests/shared/` (pure compute, for example `analytics.test.ts`).
  - `tests/client/` (component tests, for example `marimo-page-links.test.tsx`; note the `// @vitest-environment jsdom` pragma).
  - `tests/` also holds `test_*.py` files for Python (pytest).
- **Route test pattern (`tests/server/analyticsRoute.test.ts`):**
  - Mount `createXRouter(fakeSources, fixedNow)` on a bare `express()` with `server.listen(0)`.
  - Assert validation 400, the 404 for too little data, the layers in one body, and that a failing optional source degrades to a `notes[]` line.
  - Tests use no lake, because sources are injected.
- **Client test pattern:** `@testing-library/react` with a `QueryClientProvider`, `vi.fn` fetch, `StrictMode`, and `waitFor`.
- **E2E (`e2e/`, Playwright):**
  - `e2e/support/routes.ts` (`ROUTES` with `tier`, `navLabel`, `expectText`).
  - `specs/smoke/routes.spec.ts` sweeps every route. It asserts React mounted, no error boundary, no console errors, and **no same-origin `/api/*` 4xx/5xx**. A study page that 404s on an empty lake fails the sweep, so it must return empty states, not errors, on `lake` tier.
  - `route-table-drift.spec.ts` (section 1.1).
  - `e2e/specs/a11y` with `e2e/a11y-baseline.json`.
- **`scripts/verify.mjs`:** detection only, never mutates.
  - `--files` runs eslint and ruff only (fast, no tsc or vitest).
  - `--changed` adds whole-program `tsc` (errors outside changed files count as `preExistingCount`, non-blocking) and `vitest related`.
  - `--full` is whole repo. `--json` is machine-readable. Exit 1 only on error severity.
  - The Stop hook (`.claude/hooks/quality_gate.py`) runs `--changed` and blocks turn end on errors.
  - `npm run verify`, `npm run check` (tsc), `pre-push` runs tsc.
- **Notebook health gate (today):** `marimo export html <nb>.py` executes every cell. The Notebooks tab runs this as "health" (`src/server/marimo/health.ts`). The equivalent gate for a page is the route sweep plus a router test per study.

---

## 5. The marimo integration to retire

**Server, `src/server/marimo/` (11 files, about 1,950 lines):**

| File | Job |
|---|---|
| `config.ts` | Loads `notebooks.json`. |
| `catalog.ts` | Scans roots; titles, descriptions and cell counts. |
| `servers.ts` (674) | Per-group `marimo run` lifecycle: pinned ports, adopt, tree-kill, `startMarimoBackground`, `stopAllGroups`, `startEditor`, idle stop. |
| `proxy.ts` | `registerMarimoProxies` (HTTP and WebSocket). |
| `health.ts` | `marimo export` checks, two at a time. |
| `lineage.ts` | Table names read by each notebook's code; `GET /api/marimo/lineage`. |
| `git.ts`, `store.ts`, `template.ts`, `activity.ts`, `marimo.router.ts` | Git state, pins and health store (`data/notebook_*.json`), new-notebook template, idle counters, 11 routes. |

**Wiring outside the folder:**
- `main.ts:31-32` imports the proxy and the start/stop functions. The proxy is mounted before the body parsers at `main.ts:231`, and `startMarimoBackground` runs at `:438` and `stopAllMarimoGroups` at `:456`.
- Other spots in `main.ts`: SSE/compression and timeout exemptions for `/marimo/` (lines 176, 193-197) and `X-Frame-Options: SAMEORIGIN` for `/marimo` (lines 250-254).
- `routes.ts` mounts `marimoRouter` and `chartLinkRouter`.

**Client, `src/client/src/marimo/` (13 files):** `MarimoPage` (343), `NotebookList`, `NotebookTabs` (iframes), `EnvironmentPanel`, `NewNotebookDialog`, `Markers`, `ChartLinkChip`, `api.ts`, `format.ts`, `links.ts`, `types.ts`, `ReadByNotebooks`.

**Client consumers outside the folder:**
- `ReadByNotebooks` is used in `cycle/CyclePage.tsx`, `labels/LabelsPage.tsx` and `data/stores/ColumnProfiles.tsx:15,309`.
- `App.tsx:131-133,195` (route), `LeftSidebar.tsx:35`, `navigation.ts:150-155`, and `e2e/support/routes.ts:59`.
- `shared/layout/ResizableSidePanel.tsx` has an iframe-drag overlay comment.
- `claude/tools.ts:43` lists `/marimo` as a navigation route.

**Chart link (Market chart ↔ notebook), separate from the notebook host:**
- Contract `src/shared/chartLink.ts` (`ChartContextSchema`: symbol, timeframe, visible range, cursor, selected bar), server `market/chartLink.ts` and `chartLink.router.ts`.
- Client `market/lib/useNotebookOverlays.ts`, `chartContextBridge.ts`, `market/components/notebookDrawings.ts`, and the use in `MarketDataPage.tsx:185,232,651`.
- A notebook beside the chart pushed markers, levels and drawings to it. Native pages do not need this, since they share `SymbolContext` and can push overlays. Keep it until the last notebook that uses it is gone (`chart_companion.py`, and the "push to the Market chart" step of `ta_strategy_600_ticks.py` section 15).

**Config and docs:**
- `src/config/notebooks.json`, which also holds the editor group (port 17190) and `idleStopMinutes` 30.
- The in-dashboard notebook ports 17181-17190 are in `sidecar/ports.ts`, and `sidecar/` is the generic supervisor (`supervisor.ts`, `proxy.ts`, `config.ts`); it also supervises the live hub (17192) and the Claude host (17191).
- Tests: `tests/server/marimoNotebooks.test.ts`, `tests/client/marimo-page-links.test.tsx`.
- Scripts: `scripts/smoke.mjs` and `scripts/process_census.py` mention marimo.
- Docs mentioning marimo: `CLAUDE.md` (sections "This repo is where all data analytics lands", "In-dashboard notebooks", pitfalls), `docs/CLAUDE-archive.md`, `docs/CLAUDE-reference.md`, `docs/finbert.md`, `docs/ta-strategy-600-ticks.md`, `docs/plans/*`.
- Memory/global rule: the global `~/.claude/CLAUDE.md` and `hooks/dashboard_guard.py` still gate `marimo edit|run`.
- Retirement order (nothing deleted here): native page, then "Read by" replaced by a study link, then drop the notebook's `notebooks.json` root, and only when a group has no notebooks, delete its group, the `marimo` routes, proxies, servers, sidebar entry and docs.

---

## 6. Recommendation: one "study page" framework built from existing parts

### Decision
Use **one route family plus one registry**, not 50 bespoke pages or 50 top-level routes. The 50 pages collapse to a few shapes: a stat grid, sections, controls, per-column small multiples, eight-number tables, formulas.

1. **Route:** `/studies` (index) and `/studies/:slug` in `App.tsx`, both in the side-panel `<Switch>` with the normal `ErrorBoundary` and `Suspense` wrapper.
   - `e2e/support/routes.ts` needs two lines, `{ path: '/studies', tier: 'backend' }` and `{ path: '/studies/:slug', tier: 'lake' }`. The drift test reads `path="…"`, which `:slug` matches.
   - Rail: one entry `{ label: "Studies", href: "/studies", icon: … }` in `LeftSidebar.tsx`, where `nav-studies` becomes the test id.
   - Replace the "Notebooks" entry when the last notebook retires.
   - Do not touch the two nav lists per study. Make `navigation.ts` append `STUDIES` from the registry into `NAVIGATION_CONFIG` so the command palette lists them.
   - Keep the existing pages (`/analytics`, `/labels`, `/cycle`, …) as they are; link to them from related studies.
2. **Registry (new, `src/client/src/studies/registry.ts`):**
   ```ts
   export interface StudyDefinition {
     slug: string;                 // "ta-strategy-600-ticks"
     title: string; summary: string; category: string;      // category mirrors notebooks.json categories
     replaces: string;             // notebook path, for the retirement checklist
     datasets: string[];           // derived_* views it reads, for the index page and the "Read by" replacement
     load: () => Promise<{ default: ComponentType }>;       // lazyRetry factory, one chunk per study
     precompute?: { runnerKey: string; flags?: Record<string,string> };   // for heavy studies
   }
   ```
   One `StudyPage` (`/studies/:slug`) does `useParams()`, finds the definition, `registerComponentFactory`, `lazyRetry`, and wraps the result in `PageShell`. The index lists studies grouped by category with their datasets and a health dot.
3. **Shared kit: promote `analytics/common.tsx` to `src/client/src/shared/study/`.** Re-export it from the old path so `/analytics` does not change.
   - Reuse as-is: `Section`, `Stat`, `SummaryTable`, `Histogram`, `ProbabilityBar`, `Empty`, `fmt*`, `toneOf`.
   - Add: `ColumnGrid` (small multiples, every column its own graphic with re-bin / log / sort / brush controls, modelled on `market/regression/ScatterPanel` + `usePanels`), `EightNumberTable`, `FormulaLegend` (extract the KaTeX + symbol-legend logic from `market/regression/Formula.tsx`), `ControlBar` (shadcn `select`, `slider`, `toggle-group`, `switch`), and `useStudyControls` (see below).
   - `StudyFrame` wraps `LensFrame` from `lens/Frame.tsx` for the question line, the n/method line and the resizable card.
   - Charts: Recharts for bars, lines and histograms; visx heatmap for matrices and calendars; `ScatterPlot` (canvas + d3-contour) for large scatters; lightweight-charts for price, equity and bar-aligned series; Plotly only for 3D or surfaces.
   - Colours: only `DATA_COLORS`/`WONG_PALETTE_DARK` with glyph or label redundancy, never red/green.
4. **One data hook pattern:** each study owns a `useStudy<Name>(controls)` built on a generic helper.
   ```ts
   export function useStudyQuery<T>(slug: string, controls: Record<string, unknown>, parse: (raw: unknown) => T) {
     return useQuery({
       queryKey: ["study", slug, controls],
       queryFn: async ({ signal }) => {
         const r = await fetch(`/api/studies/${slug}?${new URLSearchParams(toStrings(controls))}`, { signal });
         if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${slug} failed (${r.status})`);
         return parse(await r.json());               // Zod schema in src/shared/studies/<slug>.ts
       },
       staleTime: 5 * 60_000, placeholderData: keepPreviousData });  // keep the picture while a slider drags
   }
   ```
   `useStudyControls` mirrors control state into the URL query string and, in `localStorage` inside try/catch, the tab and the last values. That replaces marimo's reactive widgets and makes every view linkable.
5. **Server: one study router, one file per study.**
   - `src/server/studies/studies.router.ts` mounts `GET /api/studies/:slug` by looking the slug up in a **`Map`** of handlers (the Map allowlist pattern, because a plain object would let `constructor` through).
   - Each `src/server/studies/<slug>.ts` exports `{ querySchema, run(query, sources) }` and gets its own LRU cache, Zod query schema and `notes[]` degradation, exactly like `analytics.router.ts`. The router mounts once in `routes.ts` before `mlRouter`.
   - SQL comes only from the handler, over `derived_<dataset>_<table>` views with the recipe validated (`RECIPE_PATTERN`) and identifiers quoted by `quote()`/`literal()`.
   - Add a small shared helper, `readDerived(dataset, table, { recipe, where, orderBy })`, next to `cycleReport.ts`'s `hasView / ensureViews / wireRow`, so 50 handlers do not each re-implement them.
6. **Precompute (class B, C and heavy A notebooks):**
   - For each notebook that computes in Python, move the compute into `src/ml/studies/<slug>.py`, with flags and the JSON-line protocol, and land tables with `ta_strategy/store.land(...)` under `derived/<slug_dataset>/recipe=…/table=…`. Register a runner in `runners.json`.
   - The study page shows a "Recompute" action that `POST`s `/api/training/start` with the runner key and streams progress through the existing SSE, and reads the tables after `refreshDerivedViews()`. Dashboard-up-first applies.
   - Class C notebooks (standalone `.duckdb`) are first re-landed as derived datasets by a script following `scripts/land_regression_tab_performance.py`, then read the same way. Do not `ATTACH`.
   - Class D stays as small server sources: a router that reads the JSON file or process list, with `loadX` injected for tests.
7. **Testing per study (three small files, all patterns already in the repo):**
   - `tests/shared/studies/<slug>.test.ts` for pure compute, if any.
   - `tests/server/studies/<slug>.test.ts` using injected sources on a bare express app.
   - One line in `e2e/support/routes.ts` only for the `/studies/:slug` tier. For the registry, add a single test that loads every `StudyDefinition`, checks each slug is unique, each `datasets` name is a real `derived_*` view or known table, and each `replaces` path exists in `notebooks.json`.
8. **Retirement ledger.** `replaces` in the registry makes migration auditable.
   - A notebook is "done" when its study renders against the real lake with no console errors, and its numbers match the notebook's (run `marimo export` once, compare the headline table; this is the parity gate, same idea as the Lens parity test).
   - Then remove it from `notebooks.json`, and replace `ReadByNotebooks` usages with a study link driven by `datasets`.

### Components to reuse, by name
`PageShell`, `KpiStrip`, `DenseTable`, `MetricCell`, `Sparkline`, `CorrelationMatrix`, `DrawdownChart` (`backtest/components`); `LensFrame` (`lens/Frame.tsx`); `Section`, `Stat`, `SummaryTable`, `Histogram`, `ProbabilityBar`, `Empty`, `OKABE` (`analytics/common.tsx`); `Formula` and `Tex` (`market/regression/Formula.tsx`); `ScatterPlot`, `ScatterPanel`, `usePanels` and its worker (`market/regression/`); `Heatmap` (`market/components/Heatmap.tsx`); `EquityLens` and `createChartOptions` (`lens/charts`, `market/components/chartConfig.ts`); `Tabs`, `Select`, `Slider`, `ToggleGroup`, `Switch`, `Tooltip`, `Skeleton` (`shared/ui`); `ErrorBoundary`, `PageLoader` (`shared/layout`); `useSymbolContext`; `lazyRetry` plus `registerComponentFactory` (extract `lazyRetry` from `App.tsx` so the registry can import it); `DATA_COLORS`, `WONG_PALETTE_DARK`, `trendGlyph` (`shared/theme/dataColors.ts`); `openEventStream` for any live run.

### Constraints any page must respect
- The page lives in a 380 px to 72% side panel. Use fluid grids, `min-w-0`, and `ResizeObserver` (`useMeasuredWidth`) for canvas charts.
- React Compiler is on, so no manual `useMemo`, `React.memo` or `useCallback`.
- Never `new EventSource`; use `openEventStream` (Chrome allows six connections per host).
- No request held open for a long operation; use `?wait=0` and poll, or 202 plus SSE.
- Futures timestamps in the lake are Pacific wall clock stored as UTC. Reuse `fmtTime` and the page's "clock" label.
- Every page returns an empty state rather than an HTTP error when its dataset has not been landed, or the e2e network guard fails the sweep.
- Every column in the frame gets its own graphic, plus the eight-number table.
- A heavy study's numbers must land in the lake, not only in the page.

### Suggested build order
1. **Framework (one change):** registry, `StudyPage`, `/studies` index, `studies.router.ts` with `readDerived`, the shared kit promotion and `useStudyQuery`, the e2e entries and the registry test.
2. **Pilot on the 4 class A notebooks that already read derived tables** (`label_catalog`, `model_cycle_runs`, `multimodal_model`, `process_census`), because views and manifests exist.
3. **Class C landing scripts,** then the `datalake` group studies.
4. **Heavy Python studies** (`ta_strategy_600_ticks`, `mnq_candle_vectors`, `mnq_indicator_study`) via precompute runners.
5. **Retire groups,** then delete the marimo server, client, config, sidecar ports and docs.