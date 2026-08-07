# Real-Time Dashboard Redesign — Design

**Date:** 2026-08-06
**Status:** Complete. W0 `187977f`, W1 `2b27b45`, W0b `e7d63d7`, W2 `a80eb0e`,
W3 `4cdb0e8`, W4 `0043058`.

## What changed against this spec during implementation

Recorded here rather than silently edited, because each was a case of the plan
being wrong about the code.

- **W0b was not in the original decomposition.** W0 corrected the token layer,
  but 230 files bypassed it with hardcoded classes and hex — 1380 occurrences.
  The fix covered the definition and almost none of the usage, so a sweep was
  added as its own workstream.
- **`--data-warn` is yellow, not vermillion.** Measured under deuteranopia
  simulation, vermillion-vs-orange scores 50.9 against yellow-vs-orange 79.2.
- **The categorical palette is ordered by measured separation**, not Wong's
  published sequence. Blue and green are its tightest pair (37.4) and now sit at
  opposite ends.
- **The CPU gauge needed no server work.** `system.matrix` already carried
  `cpu.load`, cores, and temp on the same endpoint as `system.gpu`.
- **`ExperimentLedger` was not split.** It is a working TanStack table; the new
  card and leaderboard views sit alongside it rather than replacing it.
- **W4 replays from QuestDB, not the Quantower history.** QuestDB holds real
  stored bars behind an already-working query layer; the Quantower `history.db`
  format was unverified and would have added risk for no gain.

Three silent-failure bugs were found only by checking build or wire output, and
each now has a regression gate:

- `hover:surface-raised` produced no CSS — Tailwind v4 does not generate
  variants for plain `@layer utilities` classes. Gated by
  `tests/client/css-utilities.test.ts`.
- The client bar hook subscribed to `/api/events/system`, but the SSE adapter
  routes `market.` to the pipeline channel. It would have connected and
  received nothing forever.
- The colour codemod flattened an EMA ramp, merged two indicator lines onto one
  blue, duplicated a series colour, and merged two model categories. Gated by
  `tests/client/color-contract.test.ts`.
**Scope:** `ml_dashboard` client surface (ML Studio shell, telemetry, experiment tracker) plus market-data ingestion backend.

## Problem

The dashboard should read as a live trading/research terminal: numbers that flow, a
visible pipeline heartbeat, and a research view that makes experiment quality obvious
at a glance. Today three things block that:

1. **Direction is encoded red-vs-green.** The global theme in `src/client/src/index.css`
   defines `--data-pos` as green (`152 60% 45%`) and `--data-neg` as red (`0 65% 55%`),
   with matching `.status-positive` / `.status-negative` utilities and a diverging ramp
   documented as "red ↔ neutral ↔ green". The maintainer has deuteranopia. Every feature
   below colors numbers by direction, so this must be corrected before anything is built
   on top of it.
2. **There is no live market data.** The newest `ohlcv_1m` row in QuestDB is
   `2026-03-30T17:19Z`. The MotiveWave ingestion path was deleted on 2026-07-27 and
   nothing replaced it; `src/server/market/` now contains only `charts.router.ts`,
   `instruments.router.ts`, and `news.router.ts`. Animated candles and a
   Profit-and-Loss (PnL) ticker are downstream of a feed that does not exist.
3. **Training telemetry streams but is not surfaced.** Server-Sent Events (SSE) already
   deliver training metrics, Graphics Processing Unit (GPU) load, and regime updates.
   Nothing renders them as continuous motion.

## Non-goals

- Rebuilding charts that already work (`GaugeRenderer`, `RingRenderer`, `mini-charts`,
  `ComparisonMatrix`, `TimeSeriesRenderer`).
- Replacing SSE with WebSocket. The existing SSE infrastructure is sufficient and already
  handles reconnection.
- Any absolute-price analytic. Per the standing normalization rule, only the quote box,
  candle tooltip, axis tick labels, and currency PnL accounting may show raw price.

## Decomposition

Five workstreams. W0 blocks the other four; W1–W3 are mutually independent.

```
W0  Color foundation ─┬─→ W1  Live training telemetry
                      ├─→ W2  Shell polish
                      ├─→ W3  Experiment tracker
                      └─→ W4  Ingestion + tick surface
```

---

## W0 — Colorblind-safe semantic foundation

**Why first:** every other workstream colors a number by direction. Landing this second
means repainting all of it.

### Changes

`src/client/src/index.css`:

| Token | From | To |
|---|---|---|
| `--data-pos` | `152 60% 45%` (green) | `39 100% 45%` — Okabe-Ito orange `#E69F00` |
| `--data-neg` | `0 65% 55%` (red) | `202 100% 35%` — Okabe-Ito blue `#0072B2` |
| `--data-neutral` | `220 10% 55%` | unchanged |
| `--data-warn` | `35 80% 55%` | `56 85% 60%` — yellow `#F0E442` |
| `.status-positive` | `hsl(150, 50%, 50%)` | `var(--data-pos)` |
| `.status-negative` | `hsl(0, 55%, 55%)` | `var(--data-neg)` |
| `--data-div-neg-*` | red | blue ramp |
| `--data-div-pos-*` | green | orange ramp |
| `--data-cat-1..10` | ad-hoc hues | Wong 2011 hues, separation-ordered |

**Corrected during implementation.** This spec originally called for vermillion
`#D55E00` as `--data-warn`, reasoning that a yellow would not separate from
orange. Measurement showed the reverse: under deuteranopia simulation,
vermillion-vs-orange scores 50.9 while yellow-vs-orange scores 79.2, because
yellow separates by lightness where vermillion does not. `--data-warn` is
yellow `#F0E442`.

The categorical palette is likewise ordered by **measured** separation rather
than Wong's published sequence, since most charts here plot 2-5 series and the
leading slots carry the weight. Blue and green are the tightest pair in Wong
(37.4) and cannot be fixed by substituting hues, so they are placed at opposite
ends of the draw order — they only co-occur at 8 series, where a legend is
mandatory. Slots 1-2 remain blue/orange to match the semantic tokens. Resulting
order: blue, orange, yellow, pink, sky, vermillion, neutral, green, with a
worst-pair separation of 79.2 across slots 1-5.

New `src/client/src/shared/theme/dataColors.ts`:

- Move `WONG_PALETTE` and `paletteColor()` here from
  `src/client/src/ml/stages/evaluate/palette.ts`.
- Re-export from the original path so existing importers keep working.
- Add `trendTone(delta: number): "up" | "down" | "flat"` and
  `trendGlyph(tone): "▲" | "▼" | "—"` so the second channel is available everywhere.

`src/client/src/ml/StageStepper.tsx`:

- "Complete" state moves off emerald (`bg-emerald-500/20`, `text-emerald-300`,
  `border-emerald-500/30`) and the connector rail off `bg-emerald-500/40`. Completion is
  already reinforced by a `Check` icon; the color becomes primary blue so complete and
  active are distinguished by icon and elevation rather than hue alone.

`src/client/src/ml/StatusFooter.tsx`:

- `Chip` tone `good` moves off emerald to the same primary treatment; `warn` moves to
  vermillion.

### The rule this establishes

Color never carries meaning alone. Any element encoding direction, pass/fail, or state
must also carry a glyph, sign, icon, or text label. This applies to every subsequent
workstream.

### Verification

- `npm run check` and `npm run test` pass.
- Grep gate: no component under `src/client/src` introduces a raw green or red hex/HSL
  for a semantic (non-decorative) purpose. Existing violations outside the four files
  above are catalogued but not fixed in this workstream.

---

## W1 — Live training telemetry

**Depends on:** W0.

Everything here is driven by streams that already work: `useTrainingSSE.ts`,
`useGpuMetrics.ts`, `useSSEConnection.ts`.

### Components

**`ml/telemetry/DeltaValue.tsx`** — the primitive the rest builds on. Wraps a numeric
value; on change it cross-fades old to new and floats a signed delta chip
(`+0.25%`) that decays over ~1.2s. Tone and glyph come from `trendTone`/`trendGlyph`.
Honors `prefers-reduced-motion` by swapping the value without animation.

**`ml/telemetry/MetricTicker.tsx`** — a horizontal strip above `StageStepper`. Subscribes
to `training:metric` events and renders one `DeltaValue` per metric. The metric list is
read from the `metric_declarations` SSE event rather than hardcoded, so the ticker stays
self-describing as new runners declare new metrics.

**`ml/telemetry/LoadGauge.tsx`** — radial variant built on the existing
`GaugeRenderer.tsx`. Fed by `useGpuMetrics()`, which already streams utilization, memory,
temperature, and power draw over `/api/events/system`. Numeric percentage centered, with
a sparkline of the retained 300-sample history beneath. The Central Processing Unit (CPU)
gauge requires a matching server-side metric added to the existing `src/server/system/`
module.

**`ml/telemetry/StageProgressRibbon.tsx`** — per-stage completion percentage and
Estimated Time of Arrival (ETA). `progress` SSE events already carry iteration and total.
ETA uses a trailing-median rate over the last N iterations, not linear extrapolation from
the start, so it stays stable when early iterations are slow.

### Testing

Vitest with a mocked `EventSource`: assert `DeltaValue` renders the correct tone and
glyph for positive, negative, and zero deltas; assert `MetricTicker` adds a column when a
new metric declaration arrives; assert ETA is null until enough samples exist.

---

## W2 — ML Studio shell polish

**Depends on:** W0.

The background is already deep graphite (`220 15% 5%`), not pure black — no change needed
there. The real gaps are consistency and rhythm.

- **Elevation ladder.** Formalize three surfaces — `panel` (8% lightness),
  `panel-elevated` (10%), popover (12%) — and apply them consistently. Today the stages
  mix `bg-card/10`, `bg-white/5`, and `bg-white/[0.02]` with no rule.
- **Spatial rhythm.** The shell is packed tight (`mb-1.5`, `py-1.5`, `gap-1.5`) against a
  14px root font. Adopt a 4/8/12/16px scale and give panels breathing room while keeping
  information density.
- **Active stage.** Replace the current 1px ring with an accent left-edge bar, raised
  surface, and a subtle outer glow. The edge bar carries the state; the glow is intensity
  only.
- **Motion vocabulary.** One shared set of durations and easings, reused by stage
  transitions, `DeltaValue` fades, and gauge sweeps, so the surface feels like one system.
  `tw-animate-css` is already a dependency.

---

## W3 — Experiment tracker

**Depends on:** W0. Benefits from W1's `DeltaValue` but does not require it.

- **Experiment cards.** Model name, timestamp, metric-curve thumbnail, headline score,
  status. Curves are downsampled with the existing `stages/evaluate/lttb.ts`. Hover
  expands hyperparameters and notes.
- **Leaderboard.** Ranked by cost-adjusted Sharpe, per the standing headline-metric rule.
  Updates as folds complete via the existing `fold_done` SSE bridge. Rank changes animate
  through `DeltaValue`.
- **Comparison grid.** Keep `stages/evaluate/ComparisonMatrix.tsx`; add card-to-matrix
  selection so choosing cards drives the comparison.
- **Refactor.** `stages/train/ExperimentLedger.tsx` is 455 lines and now carries three
  responsibilities. Split into `ExperimentCard.tsx`, `ExperimentList.tsx`, and
  `Leaderboard.tsx`, with the ledger reduced to composition and data access.

---

## W4 — Market data ingestion and tick surface

**Depends on:** W0 for the client half. The backend half has no dependency and may start
at any time.

### Backend first

Nothing visual is possible until bars flow again. Three candidate sources:

| Source | Nature | Trade-off |
|---|---|---|
| Quantower / AMP tick history | 3.36 GB local, 58.9M `LAST` ticks, 39 symbols | Real data, zero cost, historical replay only |
| Databento | Paid API, live and historical | True live stream; metered by bytes retrieved |
| Interactive Brokers connector | Live snapshots and price history | Free with account; rate-limited, not tick-grade |

**Decision: build against the Quantower history first.** It exercises the entire path —
producer → QuestDB → SSE → chart — with real bars at zero cost. A live producer then
swaps in behind the same adapter interface without touching anything downstream.

New `src/server/market/ingestion/`:

- A `BarSource` interface with a `replay` implementation reading the Quantower history
  and a stub `live` implementation for the eventual real feed.
- Writes to QuestDB via Influx Line Protocol using the existing client, with
  deduplication so a replay re-run does not double-insert.
- Publishes to the existing SSE adapter so the client subscribes exactly as it does for
  training and system events.

### Client

- Animated candle updates on the existing chart rather than full refreshes: the in-progress
  bar mutates in place; a closed bar commits and a new one opens.
- Tick and PnL ticker in the top bar, built on `DeltaValue`.
- Per the normalization rule, every derived statistic in this surface is a log return,
  ratio, or causal rolling z-score. Absolute price appears only in the quote box, candle
  tooltip, axis tick labels, and currency PnL.

---

## Risks

- **Concurrent edits.** Other agents may be working in this repo. `index.css`,
  `StageStepper.tsx`, `StatusFooter.tsx`, and `ExperimentLedger.tsx` are the collision
  surfaces. W0 must be landed and merged before parallel UI work proceeds.
- **Grep gate false positives.** Decorative gradients legitimately use warm and cool
  hues. The gate covers semantic usage in components, not the background gradients in
  `index.css` `body`.
- **ETA instability.** Walk-forward folds have uneven cost. Trailing-median rate mitigates
  this but will still be wrong at fold boundaries; the design accepts that and shows no
  ETA rather than a bad one when variance is high.

## Sequencing

1. W0 — foundation, mechanical, gated by typecheck and tests.
2. W1, W2, W3 in any order or in parallel, once W0 is merged.
3. W4 backend may proceed in parallel with all of the above; W4 client follows W0 and W1.
