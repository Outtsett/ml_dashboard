# Control Terminal — Performance / Hygiene / Frameworks Track (A6)

> **Data-layer premise superseded (2026-09-10).** This spec was written against a local
> QuestDB serving cache reached over HTTP `:9000` / ILP `:9009` / PG wire `:8812`. That store
> was emptied and retired: all 41 objects were dropped after each was copied to parquet in the
> lake and row-count verified (39/39 exact), and nothing may read or write it again. Market
> data now lives in the Iceberg lake at `E:\lake` and is read **in-process by DuckDB**
> (`from lake.serving import connect`). Everything below that names a database host, port,
> Windows service, JVM process, WAL table, `SAMPLE BY`, materialized-view refresh or ILP
> write is stale and must be re-derived against the lake before it is built.

**Scope:** Design/audit only. No source was modified. Linters were run in report mode
(no `--fix` applied, nothing committed). Findings are captured, categorized, and
prioritized into a fix track for the Control Terminal build.

**Repo:** `E:\source\repos\ml_dashboard` — Electron 34 + React 19 + Vite 7 + Tailwind 4 +
NestJS 11/Express 5 + Python 3.13 ML engine; the Iceberg lake read by DuckDB + PostgreSQL (TypeORM) +
SQLite (Drizzle); uv-managed venv.

**Acronyms used in this doc:** LRU (Least-Recently-Used), TTL (Time-To-Live),
SSE (Server-Sent Events), GPU (Graphics Processing Unit), CPU (Central Processing Unit),
API (Application Programming Interface), SQL (Structured Query Language),
PG (PostGreSQL wire protocol), UI (User Interface), UX (User Experience),
DTO (Data Transfer Object), YAGNI (You Aren't Gonna Need It), WMI (Windows Management
Instrumentation), TS (TypeScript), CVD (Color Vision Deficiency), N+1 (one-query-per-row
anti-pattern), ILP (InfluxDB Line Protocol), WAL (Write-Ahead Log), SRP (Single
Responsibility Principle), mat view (materialized view).

---

## 1. Errors / Warnings Sweep Plan

### 1.1 Raw counts (report mode, whole tree)

| Linter | Command run | Files w/ problems | Errors | Warnings | Auto-fixable |
|---|---|---|---|---|---|
| ESLint | `npx eslint src/` (no `--fix`) | 191 | 14 | 719 | 11 err + 5 warn |
| Ruff | `python -m ruff check src/ml/ scripts/` (no `--fix`) | — | 46 total | — | 34 (F401+F841) |

> The package.json scripts (`lint:ts` = `eslint --fix`, `lint:py` = `ruff check --fix`)
> normally auto-fix a large chunk of this. The tree still carries the findings because
> `lint-staged` only lints *staged* files on commit, so unstaged legacy code never gets
> swept. A one-time whole-tree `npm run lint` clears every mechanical item below.

### 1.2 ESLint breakdown

**Errors (14):**

| Count | Rule | Nature | File(s) |
|---|---|---|---|
| 9 | `unused-imports/no-unused-imports` | mechanical | scattered |
| 2 | `prefer-const` | mechanical | `cache/parquet.ts:27`, `lib/agentDispatcher.ts:400` |
| 1 | `(parse/core)` — `parserOptions.project` missing | **real / latent** | `src/client/src/ml/components/index.tsx` |
| 1 | `@typescript-eslint/ban-ts-comment` (`@ts-ignore`) | **real** | `src/server/deployment/agents.events.ts:97` |
| 1 | `@typescript-eslint/no-require-imports` | **real** | `src/server/infrastructure/lib/ptyServer.ts:74` |

**Warnings (719):**

| Count | Rule | Nature |
|---|---|---|
| 518 | `@typescript-eslint/no-explicit-any` | mixed — mostly wire-shape boundaries |
| 125 | `@typescript-eslint/no-unused-vars` | mostly mechanical |
| 71 | `no-console` | intentional server logging (should route through a logger) |
| 5 | `(parse/core)` — unused `eslint-disable` directive | mechanical |

`no-explicit-any` top offenders (typed-boundary hotspots, not evenly spread):
`infrastructure/storage/types.ts` (39), `storage/modelStorage.ts` (27),
`training/training.router.ts` (25), `training/hpo-config/OptimizerConfigFields.tsx` (22),
`lib/backtest/backtestOrchestrator.ts` (19). These are DB-row / storage-blob shapes —
worth typing incrementally, not in one sweep.

`no-console` top offenders: `lib/ingestion/uploadProcessor.ts` (13),
`training/hpo.router.ts` (9).

### 1.3 Ruff breakdown (46 findings)

| Count | Code | Meaning | Nature |
|---|---|---|---|
| 26 | `F841` | unused local variable | mechanical (`--fix` clears) |
| 11 | `F811` | redefinition of unused name | **real, low-severity** |
| 8 | `F401` | unused import | mechanical (`--fix` clears) |
| 1 | `invalid-syntax` | expected indented block after `for` | **REAL BUG — critical** |

**The `F811` cluster is a codegen smell, not random:** 9 of the 11 are
`compute_fold_metrics` defined twice in generated model `main.py` files
(`moe_v1`, `moe_v1_sklearn`, `rf_w2`, `lightgbm_for_moe_v1_slot1`, `ghmm_smoke`,
`tft_mnq_1d`, `random_forest_*`, `logistic_regression_*`). The second definition wins;
the first is dead. This means the model-generation **template** emits the function twice —
fixing the `.j2` template kills all 9 at the source. The other two: `time` re-imported in
`tft_mnq_1d/main.py`, and `find_indicator_columns` redefined in
`scripts/orb_indicator_analysis.py`.

### 1.4 Runtime-warning / suppression grep

| Signal | Result |
|---|---|
| `@ts-ignore` (should be `@ts-expect-error`) | 1 — `agents.events.ts:97` (flagged by ESLint above) |
| Unused `eslint-disable` directives | 5 (BlockBootstrapCI, ExperimentLedger, WalkForwardPanel, ConfigStrip ×2) |
| `require()` in ESM server code | 1 — `ptyServer.ts:74` |
| `console.*` in server hot paths | 71 (logger candidates, not bugs) |

### 1.5 The one real bug found in the sweep

**`src/ml/shared/primitives/core.py` is truncated.** The file ends at line 300:

```python
@njit(cache=True)
def _second_diff(arr):
    ...
    out[0] = 0.0
    if n > 1:
        out[1] = 0.0
    for i in range(2, n):     # <-- line 300, file ends here. Empty loop body.
```

`wc -l` confirms the file is exactly 300 lines. `_second_diff` has an empty `for` body →
`SyntaxError` on import → **any module importing this primitives engine cannot load.**
This is the `invalid-syntax` ruff finding. It is mechanical to *spot* but it is a real,
import-breaking defect, not a style nit.

**Takeaway:** Fix `core.py` first — it is the only finding in the entire sweep that can
crash something at runtime, and a truncated file means the second-difference primitive is
silently missing from the engine. Everything else is style/typing debt. Verify whether the
lost tail was more than one function (git-diff against last-known-good) before patching, or
you will restore an empty stub and re-introduce the same class of bug the no-placeholder
rule forbids.

### 1.6 Prioritized fix list (plan only — do NOT fix as part of this audit)

| Prio | Item | Track | How |
|---|---|---|---|
| P0 | `core.py:300` truncated `_second_diff` | real bug | Restore full function body from git history; confirm no other lost tail. |
| P1 | `index.tsx` outside `tsconfig` include (unlinted island) | latent | Add the file's dir to the ESLint `parserOptions.project` include so type-aware rules actually run there. |
| P1 | `compute_fold_metrics` double-def in the model template | real | Fix the `.j2` template → clears all 9 `F811` at the generator, not per-file. |
| P2 | `ptyServer.ts:74` `require()` → ESM `import` | real | Convert to top-level `import` (matters directly for the terminal — ptyServer *is* the terminal backend). |
| P2 | `agents.events.ts:97` `@ts-ignore` → `@ts-expect-error` | real | One-line swap; surfaces if the underlying error ever resolves. |
| P3 | Mechanical sweep: 9 unused-imports, 2 prefer-const, 5 dead disables, 8 F401, 26 F841 | mechanical | One `npm run lint` on the whole tree (already configured with `--fix`). |
| P4 | 518 `no-explicit-any` at storage/router boundaries | debt | Incremental typing, hotspot files first; do NOT big-bang. |
| P4 | 71 `no-console` in server code | debt | Route through a single logger util over time; intentional today. |

**Takeaway:** Only P0–P2 are worth touching before/with the terminal build (and `ptyServer`
is literally the terminal's process backend, so P2 is in-scope not incidental). P3 is a
single command whenever you want a clean baseline. P4 is standing debt — schedule it, don't
gate the terminal on it.

---

## 2. Processing-Speed Profiling Plan + Known Hotspots

### 2.1 Hotspot A — Market cold-start front-month stitch (the big one)

**Path:** `charts.router.ts::GET /ohlcv` → `getStitchedOHLCV` → `getFrontMonthOHLCV` →
`getFrontMonthRanges` → **`getFullFrontMonthRanges`** (`marketData.ts:130`).

**Mechanism of the 11–18s cost.** To build a continuous futures contract the code must
decide *which expiration is front-month on each day*. It does that by scanning **every
1-second base row** for the root across all history and rolling it up daily:

```sql
SELECT symbol, timestamp, sum(volume) as volume FROM ohlcv
WHERE root = 'MNQ' AND asset_class = 'futures'
SAMPLE BY 1d ALIGN TO CALENDAR
ORDER BY timestamp
```

On a 200M+ row root this is the single heaviest query in the app (its own comment calls it
"the heaviest single query in the pipeline", 30s timeout). It runs on the **default Market
page cold load**, so first paint can exceed the route's own 15s timeout → `504`.

It *is* cached (`OHLCVCache.key('market', 'fm_MNQ', 'ranges_full')`, 60-min TTL) — but the
cache is a shared 500-entry LRU that chart scrolling churns, and it is **empty on every
fresh server boot**, which is exactly the cold-start the user hits.

Everything downstream is already optimized: the stitch itself uses `UNION ALL` (no N+1),
responses can go out as MessagePack (~50% smaller), and large PG-wire reads are
month-chunked. The cost is purely the full-history daily-volume scan.

**Fix (highest impact in this whole document):** replace the on-demand 200M-row scan with a
**Pre-aggregated lake view** of daily volume per (root, symbol):

```sql
CREATE MATERIALIZED VIEW front_month_daily AS
SELECT root, symbol, timestamp, sum(volume) AS volume
FROM ohlcv
WHERE asset_class = 'futures'
SAMPLE BY 1d
-- refreshes incrementally: only new base rows are processed
```

`getFullFrontMonthRanges` then reads a few thousand pre-aggregated daily rows and runs the
identical leader-detection JS on them — the 200M-row scan disappears. This is exactly the
"time-bucket aggregate → materialized view" rule already codified in the repo's own schema
section (candle-anatomy is already a mat view for the same reason). The lake refreshes the
view incrementally on ingest, so it stays current with whatever ILP feed writes for free.

- **Effort:** M (create + backfill the mat view, repoint `getFullFrontMonthRanges`, verify
  boundaries match the old scan on MNQ/NQ/ES).
- **Impact:** Very high — expected **11–18s → sub-500ms cold**, and it removes the only
  query that breaches the 15s route timeout.

**Takeaway:** Build the `front_month_daily` mat view and read ranges from it. This one change
fixes the worst UX in the app (Market page timing out on launch) and is a repo-idiomatic
move, not a new pattern.

### 2.2 Hotspot B — System manifest polling (already mitigated, confirm + extend)

`useSystemManifest.ts` `refetchInterval` was already changed 1000ms → 30000ms (it was
`count()`-ing an 863M-row table every second). Confirmed fixed. **For the terminal:** do
NOT re-introduce fast polling of any `count()`-class query. Row counts should come from
Iceberg partition metadata / cached snapshots, never a live full scan on an interval.

**Takeaway:** The manifest lesson is the terminal's design constraint — heavy introspection
is refreshed on a slow interval (or on-demand), streamed as deltas, never per-render-polled.

### 2.3 LRU cache assessment (`infrastructure/cache/ohlcv.ts`)

Sound baseline: `lru-cache` v11, 500 entries, 200 MB hard cap, 60-min TTL, O(1) eviction,
per-entry `sizeCalculation` (`value.length * 80` bytes, floored at 1 so empty results are
cacheable — a real bug they already fixed). Two weaknesses relevant to speed:

1. **The expensive `ranges_full` entry shares the same LRU as cheap chart scrolls** and can
   be evicted by them, forcing a re-scan of 200M rows. Once the mat view (2.1) lands this
   stops mattering; until then, a *separate* long-TTL / non-evicting cache for front-month
   ranges (Effort S) removes the eviction cliff.
2. `sizeCalculation` is a coarse `length*80` estimate — fine for eviction, but the reported
   `sizeMB` stat is approximate. Not a correctness issue; note it if the terminal surfaces
   cache stats so the number isn't presented as exact.

**Takeaway:** The cache design is good. Its only speed liability is that the one query worth
protecting is evictable by noise — the mat view makes that moot, so don't over-engineer the
cache; fix the query instead.

### 2.4 Python ML engine subprocess spawn cost

Every training / eval / preview call spawns a fresh `python -m` / `uv run` process. Cold
interpreter + `import torch` (with CUDA init) is ~3–8s before any work starts. For
**minutes-long training runs this is noise**; for **sub-second-expected interactive previews**
(features/labels/anatomy/data previews) it dominates and makes the UI feel sluggish.

Two levers, in order of value:
- **Lazy-import heavy deps in preview scripts.** Preview scripts that don't need torch
  should not pay its import. Audit `scripts/preview_features.py`, label/data previews, and
  `dump_model_trees.py` for top-level torch imports. Effort S, real win for preview UX.
- **A persistent Python worker for preview-class calls** (long-lived process, JSON-line
  stdin/stdout — matches the existing training-stdout-protocol) so previews skip cold start.
  Effort M. YAGNI-flag: only worth it if previews are a common interactive loop; a single
  warm worker per session, not a pool.

**Takeaway:** For the terminal, spawn cost only matters if it drives sub-second commands.
Lazy-import torch out of the preview scripts first (cheap); build a warm worker only if the
terminal turns previews into a tight interactive loop.

### 2.5 Where async/parallelism/workers already help (and where not to add them)

Already parallel and correct: the `/ohlcv` route fires the health check and the anchor query
concurrently (`Promise.all`), aborts on client disconnect, and stitching is a batched
`UNION ALL`. **Do not** add a worker thread to the stitch — the bottleneck is I/O in the store,
not CPU in Node; a worker would just move the wait. The correct parallelism lever here is the
database (mat view), not the runtime.

**Takeaway:** The Node side is already doing the right async things. Speed comes from the
query shape, not from more threads.

### 2.6 Speed items — effort/impact summary

| Item | Effort | Impact | Note |
|---|---|---|---|
| `front_month_daily` mat view → range lookup | M | **Very high** | Fixes cold-start timeout; repo-idiomatic |
| Separate non-evicting cache for FM ranges | S | Medium | Interim until mat view; moot after |
| Lazy-import torch in preview scripts | S | Medium | Direct preview-UX win |
| Warm persistent Python preview worker | M | Medium | YAGNI unless previews are a tight loop |
| Throttle+stream terminal introspection (30s) | S | High (terminal) | Prevents re-creating the manifest mistake |
| Keep manifest / count() off fast intervals | — | High | Standing constraint |

---

## 3. Framework Recommendations (Control Terminal build)

Bias: version-pin everything, domain-driven-flat, minimize new deps, reuse what exists.
**Net-new dependencies recommended: zero.** Every capability the terminal needs is already
installed; the recommendation is *reuse + one version bump*.

### 3.1 System / process / service / GPU introspection → `systeminformation` (ALREADY INSTALLED)

- **Problem it solves:** enumerate Windows processes, services, CPU/memory load, and GPU
  state for the terminal's live panels.
- **The dep:** `systeminformation` — **already a dependency at `^5.31.5`**, already imported
  in `src/server/system/telemetry.router.ts` (uses `si.graphics()` today). Latest stable is
  **`5.33.0`**; pin to `5.33.0` exactly (per the version-pin rule) rather than a caret range.
- **Windows coverage confirmed:** `si.processes()` (per-process CPU/mem/pid/command),
  `si.services('*')` (Windows services state), `si.graphics()` (GPU model/VRAM/util, already
  in use), `si.currentLoad()`, `si.mem()`, `si.osInfo()`. Covers everything the terminal's
  process/service/GPU views need on Win32.
- **Why not the alternatives:** `node-os-utils` (thinner — no services, no GPU),
  raw `wmic`/PowerShell spawns (fragile output parsing, slow WMI round-trips, per-call
  process spawn), `pidusage` (per-PID CPU/mem only — no services, no GPU enumeration).
- **Gotcha:** Windows `si.processes()` / `si.services()` hit WMI and can take 200–800ms.
  Cache + throttle (see 3.3) — never call them per-render.

### 3.2 Argument validation → **Zod (reuse, no new dep)**

- **Problem it solves:** validate terminal command args / request bodies before execution.
- **The dep:** `zod@3.25.76` — already pinned and the app's validation lingua franca
  (`drizzle-zod`, route guards, the `@shared/ohlcv` / `@shared/schema` contracts). Keep the
  `3.25.76` pin; do **not** let the Agent SDK's `zod@^4` peer-want drag it to v4 (that is
  exactly why `npm install` needs `--legacy-peer-deps`).
- **Why not the alternatives:** `class-validator` is present but coupled to Nest DTO
  decorators (wrong ergonomics for ad-hoc terminal args); `ajv` would be a new dep doing what
  Zod already does. Reuse Zod.

### 3.3 Telemetry streaming → **existing SSE bus (reuse, no new dep)**

- **Problem it solves:** push live process/GPU/log telemetry to the terminal UI.
- **The mechanism:** the app already runs an EventEmitter2 → `/api/events/*` SSE fabric with
  EventStore replay (`Last-Event-ID` / `?after_id`), used by deployments and agents. Add a
  terminal channel to it; the client uses the existing `EventSource` hook pattern
  (`useDeploymentEvents` / `useAgentDispatch` are the templates).
- **CRITICAL gotcha (from the repo's own hard-won rule):** SSE routes MUST stay excluded from
  the `compression()` middleware filter in `src/server/main.ts`, or Brotli buffers the stream
  and the browser `EventSource` receives nothing (a plain-curl test is a false positive —
  verify through a real browser or `curl --compressed`).
- **Why not the alternatives:** `ws` / socket.io add a new bidirectional transport (and a
  dep) for what is fundamentally a server→client push feed; SSE already handles it, reconnects
  natively, and is battle-tested in this codebase.

### 3.4 Job / queue → **the in-process queue in `agentDispatcher.ts` (reuse). BullMQ = NO.**

- **What exists:** `agentDispatcher.ts` owns an SRP job queue — `MAX_CONCURRENT=2`, a FIFO
  `queue[]` + `running` Set, SQLite-persisted run rows, boot recovery (stale `queued`/`running`
  → `failed` on import), a per-run ring buffer for SSE replay, and `queueMicrotask`-deferred
  workers. That is a real, crash-recoverable, concurrency-limited job queue.
- **YAGNI argument against BullMQ:** BullMQ requires **Redis** — a new external service — to
  serve a **single-user local desktop app**. The three things teams reach for BullMQ to get
  (persistence, concurrency control, crash recovery) are *already present* via SQLite + the
  existing queue. BullMQ only earns its keep with cross-process/distributed workers or
  large-scale scheduled/retryable job fan-out — none of which the terminal needs.
- **The minimal step up, if ever needed:** `p-queue` (zero runtime deps, priority +
  concurrency) — NOT BullMQ. But even that is unlikely; extend the existing dispatcher queue
  first.
- **Recommendation:** reuse the dispatcher's queue for terminal-launched jobs. If the terminal
  needs a *second* queue with different concurrency, copy the pattern (it is ~120 lines of
  well-factored code), don't add a library.

### 3.5 Long process-list rendering → **react-window + TanStack Query + TanStack Table (reuse)**

- **Problem it solves:** render hundreds/thousands of process rows without janking the UI.
- **The deps (all installed):** `react-window@^2.2.5` (already wrapped in
  `src/client/src/shared/ui/virtual-list.tsx` and `backtest/components/DenseTable.tsx`),
  `@tanstack/react-query@^5.60.5` (data fetching/caching), `@tanstack/react-table@^8.21.3`
  (column model/sort). Confirmed present — no install needed.
- **Note:** react-window is **v2** (`List`/`Grid`, not the old `FixedSizeList`/`VariableSizeList`).
  The existing `virtual-list.tsx` wrapper already targets the v2 API — reuse it rather than
  writing against the deprecated v1 shape.
- **Why not the alternatives:** `@tanstack/react-virtual` and `react-virtualized` are both
  redundant with react-window here and would be new deps.

### 3.6 Windows process-tree-kill → **reuse the native `taskkill /T /F` helper (no `tree-kill` dep)**

- **What exists:** a hard-kill-the-descendant-tree helper already ships in `electron/main.cjs`
  (`execFileSync("taskkill.exe", ["/PID", pid, "/T", "/F"])`) for port pre-flight, and the
  same `taskkill` pattern is used across ~10 server files (pythonRunner, hpo, training,
  eval, anatomy, startupManager, automation.service, etc.).
- **Recommendation:** extract the helper into a shared `infrastructure/lib/proc/kill.ts` and
  have the terminal call it. Windows `taskkill /T` already kills the whole process tree —
  the `tree-kill` npm package would be a new dep duplicating a native command that is already
  wired throughout the repo.
- **Why not `tree-kill`:** it just shells out to `taskkill` on Windows anyway — you would be
  adding a dependency to wrap a command you already call correctly.

### 3.7 What NOT to add (and why)

| Not adding | Because |
|---|---|
| BullMQ + Redis | New external service for a single-user desktop app; existing SQLite-backed dispatcher queue already gives persistence + concurrency + crash recovery. |
| `ws` / socket.io | New bidirectional transport for a server-push feed the existing SSE bus already handles + reconnects natively. |
| `tree-kill` | Wraps `taskkill`, which the repo already calls with `/T /F`. |
| `pidusage` | Per-PID CPU/mem only; `systeminformation.processes()` already returns this plus everything else. |
| `node-os-utils` | Subset of `systeminformation` (no services, no GPU). |
| `p-queue` (for now) | Only if a second independent queue is ever needed; extend the dispatcher pattern first. |
| `ajv` / another validator | Zod is already the app-wide validation layer. |
| Any new chart/table/virtualization lib | react-window + TanStack Query + TanStack Table + visx are all installed and wrapped. |

**Takeaway:** The terminal needs zero new runtime dependencies. The only dependency action is
a version bump of the already-present `systeminformation` to `5.33.0` (pinned). Everything
else is reuse of installed, battle-tested infrastructure — which is also the fastest path to
ship and the one least likely to break the fragile `--legacy-peer-deps` install graph.

---

## 4. Consolidated Recommendation Table

Track: **H**=hygiene, **P**=perf, **F**=framework. Effort: S/M/L. Phase 1 = do with/before the
terminal; Phase 2 = alongside; Phase 3 = standing debt.

| # | Item | Track | Effort | Impact | Risk | Phase |
|---|---|---|---|---|---|---|
| 1 | Restore truncated `core.py::_second_diff` (syntax error) | H | S | High (unbreaks import) | Low | 1 |
| 2 | `front_month_daily` mat view → range lookup (kills 200M-row cold scan) | P | M | **Very high** | Med (verify boundaries match) | 1 |
| 3 | Bump `systeminformation` → `5.33.0` (pinned); use for terminal proc/svc/GPU | F | S | High (enables terminal) | Low | 1 |
| 4 | Extract shared `proc/kill.ts` from existing `taskkill /T /F` helper | F | S | Med | Low | 1 |
| 5 | `ptyServer.ts:74` `require()` → ESM `import` (terminal backend) | H | S | Med | Low | 1 |
| 6 | Add terminal channel to existing SSE bus (keep excluded from `compression()`) | F | M | High | Med (SSE/compression gotcha) | 2 |
| 7 | Reuse `agentDispatcher` in-process queue for terminal jobs (no BullMQ) | F | S | High | Low | 2 |
| 8 | Reuse react-window v2 wrapper + TanStack Query/Table for process list | F | S | Med | Low | 2 |
| 9 | Reuse Zod (3.25.76) for terminal arg validation (no new dep) | F | S | Med | Low | 2 |
| 10 | Throttle+cache terminal `si.processes()`/`si.services()` (WMI is slow, 30s stream) | P | S | High (terminal) | Low | 2 |
| 11 | Fix `compute_fold_metrics` double-def in model `.j2` template (clears 9× F811) | H | S | Med | Low | 2 |
| 12 | Include `ml/components/index.tsx` in ESLint `project` (unlinted island) | H | S | Med | Low | 2 |
| 13 | Separate non-evicting cache for FM ranges (interim to #2) | P | S | Med | Low | 2 |
| 14 | Lazy-import torch in preview scripts (preview UX) | P | S | Med | Low | 2 |
| 15 | `@ts-ignore` → `@ts-expect-error` (`agents.events.ts:97`) | H | S | Low | Low | 2 |
| 16 | Whole-tree `npm run lint` sweep (9 imports, 2 const, 5 dead disables, 8 F401, 26 F841) | H | S | Low | Low | 3 |
| 17 | Warm persistent Python preview worker (only if previews become a tight loop) | P | M | Med | Med | 3 |
| 18 | Incremental typing of 518 `no-explicit-any` (storage/router hotspots first) | H | L | Med | Low | 3 |
| 19 | Route 71 `no-console` through a logger util | H | M | Low | Low | 3 |

> **Colorblind-safe note:** this document is text/tables only (no color-encoded chart), so it
> is deuteranopia-safe by construction. Any effort/impact heatmap rendered from this table in
> the terminal UI must use the Okabe-Ito palette / `cividis` (never red/green).

**Single highest-impact change:** Item #2 — the `front_month_daily` materialized view.
Expected win: Market page cold-start `/api/charts/ohlcv` drops from **~11–18s (often a 504
timeout) to sub-500ms**, by replacing an on-demand 200M+-row full-history daily-volume scan
with a pre-aggregated lake view that the range builder reads in milliseconds.
