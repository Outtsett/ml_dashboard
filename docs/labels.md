# Labels — the contract, the lifecycle, the suite

Written 2026-09-26 with the label audit (`docs/plans/2026-09-26-label-lifecycle.md`). This is the on-demand
reference; `CLAUDE.md` carries the summary.

## Think of it as

A label is a crate packed by a generator: inside is the value (`label`) and how many bars later it was known
(`resolution_bars`). The contract is what is printed on the outside so the chart, a notebook or a trainer can
read any crate without knowing who packed it: where it resolved, what it was worth in points and in volatility
units, whether it clears the round trip, how many other labels were open at the same time (its uniqueness), and
whether it may train at all (`usable`). The lifecycle is the paperwork that follows the crate from the request to
the training run that consumed it.

## Where things are

| Layer | Path |
|---|---|
| Contract (columns, stages, manifest, validation report) | `src/shared/labels/contract.ts` |
| Generators (SQL over the serving DuckDB) | `src/server/infrastructure/lib/labels/sqlLabelGenerators/*.ts`, registry `index.ts` |
| Parameter names, defaults, legacy aliases, recipe hash | `src/server/infrastructure/lib/labels/labelRecipe.ts` |
| Generation job (generate → validate → land → catalog) | `labelGenerator.ts` |
| Enrichment post-pass (resolution, realised return, weights, `usable`) | `labelEnrichment.ts` |
| Validation gates | `labelValidation.ts` |
| Landing, manifest, read-back | `labelSetStore.ts`, `src/server/infrastructure/lake/objects.ts` |
| Lifecycle derivation | `labelLifecycle.ts` (pure `buildLabelLifecycle` + gatherer) |
| The canonical suite | `labelSuite.ts`, `scripts/run_label_suite.ts` |
| Routes | `src/server/ml/labels.router.ts` (`/api/labels/*`) |
| Serving views over every manifested derived dataset | `src/server/infrastructure/database/questdb/derivedDatasets.ts`; Python mirror `lake.serving.derived_views` |
| Python consumption | `src/ml/shared/label_sets.py` (`load_label_set`, `translate_label_params`, `label_horizon_bars`), `src/ml/shared/labels.py` (kernels) |
| Client | `src/client/src/labels/` (`/labels`), `ml/stages/LabelsStage.tsx`, `market/lib/useLabelOverlay.ts` (landed sets on the chart) |
| Notebook | `notebooks/label_catalog.py` (ML Dashboard group) |
| Audit record | `s3://derived/label_audit/recipe=audit_2026_09_26/` (`scripts/land_label_audit.py`) |
| Tests | `tests/test_label_contract.py` (parity, smoke of every generator, truncation gate, warmup), `tests/labels/label-set-store.test.ts` |

## Identity

`recipe = <generator>_<SYMBOL>_<timeframe>_<hash12>`, where the hash is SHA-256 over the canonical JSON of
`{contractVersion, generatorType, symbol, timeframeMinutes, params (normalised names, defaults filled), window}`.
`generated_labels.recipe` is unique: asking for the same set twice returns the first; `force` regenerates it in
place; a failed set is retried in place.

Layout: `s3://derived/labels/recipe=<recipe>/table=labels/part-0.parquet` (the `lake.layout.derived_root`
convention) and one line per set in `s3://meta/ingest_manifests/labels.jsonl`. A set that fails a gate is written
under `s3://derived/labels/_rejected/…` (outside the serving glob) with no manifest line.

## Row contract

Every generator emits `timestamp` (the event bar), `symbol`, `close`, `label`, `resolution_bars`, plus its own
full-word columns (`future_return_fraction`, `upper_barrier_price`, `t_statistic_scaled`, …). The post-pass appends:

| column | meaning |
|---|---|
| `resolution_timestamp`, `resolution_close` | the bar the label resolves on |
| `realized_price` | the fill: the barrier level (or the gap open) when one was hit, else the resolution close |
| `realized_return_points`, `realized_return_fraction` | `realized_price − close`, and ÷ close |
| `trailing_volatility_points` | causal standard deviation of 1-bar close changes over 100 bars, NULL in warmup |
| `realized_return_volatility_units` | points ÷ (volatility × √resolution_bars) |
| `round_trip_cost_points`, `realized_return_net_of_cost_points`, `clears_round_trip_cost` | `src/config/cost_model.json`; NULL for an unpriced symbol |
| `concurrent_label_count` | labels whose span covers the event bar (AFML 4.2) |
| `sample_uniqueness_weight` | mean of 1 / concurrency over the span, in (0, 1] (AFML 4.5) |
| `return_attribution_weight` | \|Σ log return ÷ concurrency\| over the span, mean 1 across the set (AFML 4.10) |
| `usable`, `usable_reason` | `ok`, `unresolved`, `volatility_warmup`, `zero_volatility`, `ambiguous_same_bar_touch`, `below_minimum_return` |

Encodings per set (recorded in the manifest): `signed_direction` (−1 / 0 / +1), `class_id`, `continuous`,
`binary_meta`.

## Validation gates

Run over the staged rows before anything lands; a failed gate is written into the report, and the set stays out of
the lake's glob.

1. `resolutionMonotone` — every resolution bar is at or after its event bar.
2. `noDuplicateEvents` — one row per event bar.
3. `coverage` — rows over bars in the set's span.
4. `classBalance` — counts per class (a continuous label is binned into 20 buckets) with the eight numbers of the
   realised return in points and in volatility units and of the uniqueness weight; a rare class warns, it does not fail.
5. `purgeCoversHorizon` — the recorded purge is at least the longest horizon.
6. `noLookahead` — the generator re-run on the first 60% of the window gives the same label to every row that
   resolved inside it. A whole-series statistic fails this; a trailing window passes.
7. `usableShare` — some rows are usable.

## Lifecycle

`specified → generated → validated → landed → cataloged → consumed`, with `stale` and `retired` beside the ladder.
Derived from artifacts (`buildLabelLifecycle`): the ledger row, the validation report, the parquet + manifest, the
recipe's presence in `labels.jsonl` or in `derived_labels` (a landing from another process is cataloged the moment
its manifest line exists), `training_sessions.label_set_id`, and the source bars' coverage against the fingerprint
recorded at generation (`stale`). `GET /api/labels/lifecycle`; the `/labels` page and ML Studio's Labels stage
draw it. `generated_labels.stage` is only the furthest rung the generation job reached; the live stage is always
the derived one. A set that failed a gate keeps its rows under `derived/labels/_rejected/` for inspection, and
`GET /api/labels/:id/rows` answers 409 for it unless `?rejected=1` is passed.

## Purge and embargo

`purge_bars = embargo_bars = max(resolution_bars)` of the set. The runner passes `--label-purge-bars`; the trainer
template uses `max(configured, label horizon)` for both walk-forward folds and the plain 80/20 split (the last
`purge_bars` training rows before the boundary are dropped), and the codegen routes clamp a requested purge below
the horizon (with a warning in the response) for the four kernel strategies. For a landed-set generator the codegen
cannot know the horizon, so it warns that the set's `purge_bars` is the floor instead of clamping to zero.
`generate_model.py` accepts any generator id (`[a-z0-9_]+`) and maps signed / binary encodings to the direction
head, continuous and many-class ones to `custom`. The Model Cycle already derived its purge from the horizon and
asserts it.

## The suite

`LABEL_SUITE`: MNQ at 1, 5 and 15 minutes × ten generators (next close direction, direction 12 bars 3 classes,
triple barrier 2 / 1.5 ATR 24 bars, volatility-adaptive 12 bars 1.5 σ, trend scanning 5–60 step 5, future return 12
bars trailing z, range bucket 16 bars 21 × 2 points, structural 5-bar pivot, regime 4 states, meta-label trailing
momentum 10 bars) plus ES and NQ at 5 minutes (next close direction, triple barrier). `POST /api/labels/suite`
runs it in the server; `npx tsx --env-file=.env scripts/run_label_suite.ts` runs it in its own process (the dev
server restarts on every source change and would take a running suite with it) and asks the dashboard to refresh
its catalog when done.

## Generators — what the audit changed

- `helpers.rollingStd` and every trailing aggregate are NULL until the frame is full (a one-row frame used to give
  exactly 0, so a volatility-unit barrier sat on the entry price).
- `triple_barrier`: volatility units (ATR or return std) with asymmetric multiples; fill at the barrier or the gap
  open; both barriers in one bar flagged (`sameBarTouchConvention`); vertical exit labelled by sign; minimum return
  marks `usable = false` instead of dropping the row. Percent barriers remain (`barrierUnits = 'percent'`), and a
  legacy request (`takeProfitPct`, `volatilityAdjust`) means percent.
- `trend_scanning`: least-squares t of log close on time over the forward window, selection by max |t| (AFML),
  Šidák-adjusted threshold for the horizons tested, `t_statistic_scaled` beside the raw t.
- `future_return normalize`: trailing statistics of the backward return, never the whole range.
- `regime`: trailing median of volatility (`regimeLookbackBars`), 3-regime cutoff in volatility units.
- Contrastive pairs read the sampled bars at the requested timeframe.
- Parameter names are full words with units (`horizonBars`, `takeProfitPercent`, `bucketWidthPoints`, …); the old
  names are accepted at the API (`LEGACY_PARAM_ALIASES`).

## Legacy tables (reported, not touched)

`mnq_labels_1m` and `mnq_labels_1m_new` are byte-identical; `mnq_tbl_5m` and `mnq_swing_5m` have no producer in
any repository; `mnq_zigzag_1m` carries 580 timestamps that are not in `mnq_ohlcv_1m`; the serving snapshot
`derived/recipe=questdb_full_2026-09-09` has no manifest. All six use abbreviated columns
(`docs/column-naming-migration.md`). Deleting or re-stamping any of them is a person's decision.

## Adversarial review (2026-09-26)

A 48-agent review of the shipped work (`wf_1a7dcfbd-3e6`: independent finders per dimension, three refuters per
finding) confirmed nine findings and refuted twelve. Every confirmed one is fixed and gated:

| Finding | Fix | Gate |
| --- | --- | --- |
| DuckDB `GREATEST` skips NULL, so the first bar's true range was `high - low` and the ATR filled one bar early | `trueRangeExpression()` is NULL when there is no previous close | `test_average_true_range_warmup_is_the_full_window_plus_one` |
| Triple-barrier sets landed `realized_return_points` / `realized_return_fraction` twice (generator + enrichment) | the enrichment pass drops any staged column it recomputes | the six sets regenerated; `derived_labels` has one of each |
| `GET /api/labels/:id/rows` served a set that failed its gates | 409 with the failure unless `?rejected=1` | route |
| `cataloged` needed this process's `derived_labels` view, so a landing from the suite runner read as `landed` | manifest membership counts, cached 30 s | `labelLifecycle.ts` |
| `appendJsonLine` was read-modify-write with no guard | in-process chain per object plus read-back and re-append, three attempts | `lake/objects.ts` |
| `generate_model.py` rejected every non-kernel label strategy | any `[a-z0-9_]+` id; `LABEL_TO_TASK` covers all seventeen | `tests/codeGenerator.test.ts` |
| `labelHorizonBars` returned 0 for non-kernel strategies, so the purge clamp was silently skipped | returns `null`; the route warns that the set supplies the purge | `tests/codeGenerator.test.ts` |
| The single-fold template computed the purge and never applied it | `train_end = split - label_purge_bars` | template |
| `generated_labels.stage` and the derived stage could disagree | the column is documented as the job's furthest rung; the lifecycle is the authority | schema comment |

Refuted (kept as is): the recipe hash's parameter normalisation, the Šidák threshold direction, `sample_uniqueness_weight`
on overlapping horizons, the whole-day truncation cut, `hive_partitioning = false` on reads, the `boundByWindow`
alias, the histogram binning for continuous labels, the contrastive `wrapWithSampleBy` path, the meta-label
routing, the `retired` precedence over `stale`, the manifest-driven view planning, and the `usable_reason` vocabulary.
