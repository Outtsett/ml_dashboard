# Labels — audit, land, and a lifecycle for every label set

Date: 2026-09-26. Branch: `feat/realtime-dashboard-redesign`. Ask: "Audit all label generation. Label the data. And let's improve the labeling infrastructure and life cycles."

## What the user gets

1. **An audit record** of every label producer (17 SQL generators + 16 TA-Lib ids, the Python kernels, the Model Cycle labels, the quant workspace producers, six legacy lake tables), landed as a dataset (`s3://derived/label_audit/recipe=audit_2026_09_26/`) and read by the notebook `notebooks/label_catalog.py` (ML Dashboard group).
2. **One label contract** (`src/shared/labels/contract.ts`, mirrored in `src/ml/shared/label_sets.py`): every landed row carries the event bar, the bar it resolves on, the realized return in points and in volatility units, the causal volatility scale, cost-adjusted flags, AFML sample weights (average uniqueness, return attribution), a `usable` flag with a reason, all full-word column names.
3. **Correct generators.** Warmup rows are NULL, never zero. Triple barrier in volatility units with asymmetric multiples, a declared same-bar convention, barrier fills (gaps priced at the open), vertical exits labelled by sign. Trend scanning is a real OLS t-statistic on log close with a Šidák-adjusted threshold for the number of horizons tested, and the scaled statistic beside it. Future-return normalization and regime percentiles are trailing windows. Contrastive pairs read bars at the requested timeframe.
4. **A lifecycle for every label set**: specified → generated → validated → landed → cataloged → consumed → stale / retired, derived from artifacts (`src/server/infrastructure/lib/labels/labelLifecycle.ts`, contract in `src/shared/labels/contract.ts`), shown on `/labels` and in ML Studio's Labels stage. A recipe (`<generator>_<symbol>_<timeframe>_<hash>`) is the identity; regenerating the same recipe is idempotent.
5. **Validation gates before landing**: monotone resolution, no duplicate events, coverage, class balance with the eight-number distribution of the realized return, purge covers horizon, and a truncation test (labels recomputed on a shorter window must agree for every row that resolved inside it — this is the no-lookahead gate, and it fails on exactly the whole-series statistics the audit found).
6. **The lake data labelled**: a canonical suite for MNQ at 1m, 5m, 15m (plus ES/NQ 5m) landed under `s3://derived/labels/recipe=.../table=labels/` with a manifest line per set in `meta/ingest_manifests/labels.jsonl`, readable from the dashboard's own DuckDB as `derived_labels` (and every other manifested derived dataset as `derived_<dataset>[_<table>]`).
7. **Training consumes labels correctly**: purge is never below the label horizon (codegen clamps it; the Model Cycle already did), a persisted set hands the trainer its weights and purge, and every session records the label set it trained on.

## Audit findings that drive the work (verified by five parallel research passes, 2026-09-26)

Server SQL generators (`sqlLabelGenerators/`):
- `rollingStd` has no minimum-count guard: warmup rows evaluate to exactly 0, so triple-barrier barriers collapsed onto the entry price (live: upper = lower = close on row 2), and `future_volatility`, `regime`, `trend_scanning`, `volatility_adaptive`, `pseudo_confidence` inherit it.
- `trend_scanning` picks max |pseudo-t| over 18 horizons with no correction; 93% of MNQ 5m bars were "significant" at t ≥ 2. The statistic is |forward move| / trailing σ, not a regression t.
- `future_return normalize=true` and `regime`'s `PERCENT_RANK()` are whole-series statistics (non-causal).
- `triple_barrier`'s `exit_return` is always the horizon-end close-to-close return, even for rows that exited at a barrier; the same-bar double touch is resolved by proximity (a guess); `vol_scale` is a ratio to the whole-sample mean volatility (lookahead).
- Contrastive generators read raw sub-minute `ohlcv`, so `windowSize` is ticks, not bars.
- Label sets are not idempotent (three identical requests → ids 6, 7, 8) and store no horizon or resolution.
- Only 4 of 33 generator ids have their SQL executed by any test.
- Abbreviated output and parameter names (`rolling_vol`, `delta_pts`, `takeProfitPct`, `minProfitBps`, …).

Python:
- `src/ml/shared/labels.py` triple barrier is fixed basis points only; `xgb_classifier/labels.py` (ATR-scaled, with diagnostics) measured that fixed 5 bp keeps 14.6% of daily bars and ATR keeps 94%; every generated model uses the degenerate one.
- `_walk_forward.py.j2` purge defaults to 0 and is never derived from the label horizon (the Model Cycle derives it and asserts it).
- No sample weights anywhere in `src/ml`.

Lake:
- `mnq_tbl_5m` (1,409,553 rows) and `mnq_swing_5m` (469,851) have no producer in any repo.
- `mnq_labels_1m` and `mnq_labels_1m_new` are byte-identical (full EXCEPT both ways = 0 rows).
- No manifest exists for the serving snapshot `derived/recipe=questdb_full_2026-09-09/`.
- `mnq_zigzag_1m` carries 580 timestamps that are not in `mnq_ohlcv_1m`.
- Two `derived/` layouts coexist; the dashboard's DuckDB reads only the pinned snapshot.

## Design

**Identity.** `recipe = <generator>_<symbol>_<timeframe>_<hash12>`, hash12 = SHA-256 of the canonical JSON of `{contractVersion, generatorType, symbol, timeframeMinutes, params (normalized names, defaults filled), window}`. `generated_labels.recipe` is unique; a request whose recipe exists returns the existing set unless `force`.

**Layout.** `s3://derived/labels/recipe=<recipe>/table=labels/part-0.parquet` (the `lake.layout.derived_root` convention); manifest line appended to `s3://meta/ingest_manifests/labels.jsonl` with the standard fields plus `table`, `label_set_id`, `generator_type`, `symbol`, `timeframe_minutes`, `parameters`, `source_fingerprint`, `row_count`, `label_distribution`, `max_horizon_bars`, `purge_bars`, `embargo_bars`, `validation`.

**Row contract** (full words; `timestamp` is the event bar, `label` the value): generator columns + post-pass columns `resolution_bars`, `resolution_timestamp`, `resolution_close`, `realized_return_points`, `realized_return_fraction`, `trailing_volatility_points` (causal std of 1-bar close changes, 100 bars, NULL in warmup), `realized_return_volatility_units`, `round_trip_cost_points`, `realized_return_net_of_cost_points`, `clears_round_trip_cost`, `concurrent_label_count`, `sample_uniqueness_weight`, `return_attribution_weight`, `usable`, `usable_reason`.

**Stages** (`src/shared/labels/contract.ts`): specified (row) → generated (rows computed) → validated (report passed) → landed (parquet + manifest, count verified) → cataloged (readable as `derived_labels` in the serving DuckDB) → consumed (a training session references it) ; `stale` when the source bars' fingerprint moved past the recorded one; `retired` by request (parquet is never deleted).

**Serving.** `buildInstance()` defines `derived_<dataset>` (or `derived_<dataset>_<table>` when a dataset has several tables) over every dataset with lines in `meta/ingest_manifests/*.jsonl`, `union_by_name`, hive `recipe` column kept. `refreshDerivedViews()` runs after every landing. `lake.serving.derived_views(con)` mirrors it for notebooks.

**Purge.** `max_horizon_bars` from the rows; `purge_bars = max_horizon_bars`; `embargo_bars = max_horizon_bars`. Codegen renders `purge_bars = max(requested, label horizon)`; a persisted set's purge is passed to the runner (`--label-purge-bars`).

## Parts and order

1. Shared contract, recipe hashing, parameter normalization (TS + Python).
2. SQL helpers and generator fixes; every generator rendered by `scripts/dump_label_sql.ts`; smoke + parity + truncation tests in `tests/test_label_contract.py`.
3. SQLite schema (`generated_labels` lifecycle columns, `training_sessions.label_set_id`), invariants, migration 0006; lifecycle service; store (landing convention, post-pass, validation, manifest); async generate; routes; manifest-driven derived views.
4. Python consumption: ATR triple barrier in `shared/labels.py`, `label_sets.py` contract reader, templates' purge, runner flags, session lineage.
5. Land the suite; land the audit dataset; notebook.
6. Client: `/labels` page, ML Studio Labels stage with every generator and the lifecycle strip, landed-set overlay on the chart.
7. Docs, then the adversarial review workflow (leakage, DuckDB validity and cost, naming rule, lifecycle consistency, client, docs parity) and fixes.

## Done means

- Every generator's SQL executes on DuckDB over real MNQ bars, returns the contract columns, and passes the truncation test; pytest and vitest green; `tsc` 0.
- The suite is landed with manifests and validation reports; `SELECT recipe, count(*) FROM derived_labels GROUP BY 1` answers from the dashboard's SQL console.
- `/labels` shows every set with its stage; ML Studio trains from a set with purge ≥ horizon and records the set on the session.
- The notebook opens from `/marimo` and exports cleanly.
