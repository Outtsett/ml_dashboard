# Checkpoints — multimodal trading model

Append-only. Newest last. Each entry: what was done, the evidence (numbers, files, commits), what is next.
Resume rule after any break or compaction: read `PLAN.md`, then the last three entries here, then `state.json`.

## CP-000 · 2026-09-29 02:30 PDT · P0 Setup started

- Ask recorded in `PLAN.md` with the acceptance gate (G1-G6), the locked holdout (2025-07-01 → 2025-12-31,
  Pacific wall clock) and the phase plan.
- Notebook inventory taken for P1: 50 marimo notebooks under the six groups in `src/config/notebooks.json`
  (datalake 17, quant 15, ml-dashboard 10, chart-cnn 3, forexmodel 3, quantlab 2) plus 23 Jupyter
  notebooks (Trading/forexmodel 17, LEAN research 4, scripts/candle_range_analysis 2).
- Pending Tyler: how training runs are started (his standing rule is that he starts them from the UI),
  the meaning of "2:1 profit ratio", the instrument and holding style.
- Next: P1 audit workflow; P2 data inventory in parallel.

## CP-001 · 2026-09-29 · P0 Setup closed

- Tyler's decisions recorded in `PLAN.md`: I start runs through the dashboard; "2:1" = both average win >= 2x
  average loss and profit factor >= 2; MNQ intraday, flat by the close.
- Holdout lock in code: `src/ml/multimodal/holdout.py` (`guard`, `look` with a budget of one, recorded in
  `state.json`); 4 tests in `tests/test_multimodal_holdout.py`.
- CI gate: `scripts/multimodal/ci.py` (ruff + the project's tests + holdout budget) — all green.

## CP-002 · 2026-09-29 · P1 Audit closed, P2 inventory taken

- 72 notebooks audited (51 relevant to training): edge evidence strong 1, moderate 2, weak 11, none 37,
  n/a 21. The 3 edge claims were re-tested by skeptics: all "partly" — each is a VOLATILITY / range
  forecast (HAR+clock next-hour realised variance R² +0.24 to +0.52, median ~0.39), none a direction edge.
- Direction: the best honest lift anywhere is about +5 points of 2:1 target-hit rate over random entries
  (ta_strategy momentum books, pre-registered on NQ 2010-2019: win 43.5%, PF 1.10, payoff 1.43).
  Candles (0 of 883 survive), chart CNN (AUC 0.498-0.506), kNN, path geometry, S/R, TrendState, regime
  gating, every Model Cycle family (AUC 0.486-0.498): no edge.
- Data (measured): MNQ 1m dense 2019-05-05 → 2025-12-30 (not only 2024+); NQ/ES/YM 1s from 2010-06;
  two clocks (bars = true UTC, ohlcv_*/mnq_*/derived_labels = Pacific wall clock as UTC); order flow
  columns empty (1 session) → build proxies from 1s bars; news 0.35% of session days → GDELT GKG filtered
  backfill needed (raw 173-273 GB/yr); calendar from 2021 only → scrape Fed/BLS; nothing after 2025-12-30
  except the live hub.
- Label design from the base rates: stop = 1x 5m ATR20, target = 2 x stop + 3 x cost (so net payoff stays
  >= 2 after costs); unconditional target-hit rate 0.30-0.31 = the random-walk value; the model must add
  about +9-10 points to reach 40%, and more for profit factor >= 2.
- Landed: `derived_multimodal_notebook_audit_{notebooks,edge_verdicts}` (72 + 3 rows). Docs: `AUDIT.md`,
  `evidence/` (audits JSON, verdicts, lake inventory, outside sources, synthesis).
- Plan changes (before any model): G5 restated with the power analysis; a clean forward confirmation
  period added; the ~3% prior stated.
- Next (P2): bracket label + measured base rates (landed), order-flow proxies from the 1s bars,
  intraday cross-asset (ES/NQ/RTY/YM), calendar scrape, the clean forward period (Yahoo 5m) landed, and
  the GDELT filtered-landing decision for Tyler.

## CP-003 · 2026-09-29 · P2 data (part) + P3 baseline

- Clean forward period landed write-once before any model exists: Yahoo 5m from 2026-07-21 and 1m from
  2026-08-31 for MNQ, NQ, ES, RTY, YM, ZN, GC, DX-Y.NYB (`raw/vendor=yahoo/dataset=chart-history/received=2026-09-29`,
  47 objects); locked in code like the holdout (`holdout.guard` refuses 2026-01-01+; `look(period="forward")`).
- News backfill (Tyler approved the filtered landing): `scripts/multimodal/backfill_gdelt_gkg.py`, GDELT GKG 2.1
  streamed, md5-checked against GDELT's master list, filtered to ECON_/EPU_ themes + market organisations,
  one parquet per UTC day under `raw/vendor=gdelt_gkg/dataset=gkg-finance-filtered/filter=finance_v1/` with a
  sources manifest; ~85k rows and 6.5 MB per day, page titles on 100%; running with 24 workers
  (`logs/gdelt-gkg-backfill.log`), forward period first, then 2025-12 back to 2019-05.
- Order-flow proxies: `scripts/multimodal/build_orderflow.py` — tick rule on the 1-second MNQ bars, 3,465,202
  contract-minutes 2019-05 → 2025-12 (buy + sell = volume to 1e-5), `derived_multimodal_orderflow_minutes`.
- Label: `src/ml/multimodal/labels.py` — 2:1 and 3:1 brackets on the 1-minute path, stop = 1x ATR20 (5m RTH),
  target = R x stop + (R+1) x cost + R x slip so the net win is >= R x the net loss; 413,516 candidates over
  1,588 development sessions (`derived_multimodal_labels_{labels,base_rates}`). Base rates (coin-flip entries
  at the same times): 2:1 win 0.30-0.32, payoff ~2.0, PF 0.88-0.94; 3:1 win 0.25-0.27, payoff 2.5-2.8, PF 0.90-0.95.
  G4 (PF >= 2) therefore needs ~44% wins at 3:1 or ~50% at 2:1.
- Features: `src/ml/multimodal/features.py`, one lake table per modality (`derived_multimodal_features_*`):
  time 8, price 28, flow 13, cross 30 columns; truncation test proves every block causal.
- Runner: `multimodal_fusion+bracket_meta_label` registered (algorithms/tasks/runners.json); runs start through
  `/api/training/start`, stream live, land `derived_multimodal_runs_*`, and append to `trials.jsonl`.
- **Trial 1 — GBDT baseline** (time, price, flow, cross; LightGBM per head; policy chosen per quarter from
  earlier quarters): out-of-sample 2021Q2..2025Q2, 2,188 trades on 1,095 sessions (every session traded),
  win 24.9%, payoff 2.87, PF 0.95, net -$5,302, 29% of quarters positive → G1 no, G2 yes, G3 no, G4 no, G5 no.
  Per-quarter AUC 0.40-0.59. Deciles: realised win rate flat across predicted probability for 3 of 4 heads;
  only long 3:1's top decile lifts (0.317 vs ~0.27, EV +3.7 points) — consistent with MNQ's upward drift.
- Next: calendar (backfill agent running) and news blocks; the fusion network (P4); primary-signal and
  opening-range / overnight context features; each as a counted trial.

## CP-004 · 2026-09-29 · P4 fusion network + trials 2-3; search budget fixed

- Fusion network: `src/ml/multimodal/models/fusion.py` — per-modality MLP encoders, a dilated temporal
  convolution over the last 48 five-minute bars, a 2-layer transformer across modality tokens, 4 bracket heads,
  modality dropout, Platt calibration; the test (`tests/test_multimodal_fusion.py`) proves it learns a planted
  signal (AUC > 0.7) and its ablation names the modality that carries it.
- **Trial 2 — fusion** (time, price, flow, cross + sequence): 1,155 trades, win 27.7%, payoff 2.27, PF 0.870,
  net -$6,756, 41% of quarters positive. Modality ablation (AUC drop when the token is zeroed): flow +0.002 to
  +0.008, price +0.003 to +0.009, cross / time / sequence ~0.
- **Trial 3 — GBDT + context** (overnight session, opening range, previous sessions; `context_` block, 16 columns,
  causal incl. ETH minutes): 1,619 trades, win 25.2%, payoff 2.63, PF 0.886, net -$8,686; 3 early-close sessions
  untraded → policy fixed: the forced trade also fires on the session's last decision bar.
- Development base rates by hour: the best cell is long 3:1 at 06:00-08:00 with PF 0.98-0.99 (the index's drift);
  no hour is near PF 2.
- Search budget fixed in `PLAN.md` before trial 4: at most 24 trials; stop after 6 without a better development PF.
- Best development PF so far: 0.951 (trial 1). Next: calendar and news modalities (backfills running), then
  all-modality GBDT and fusion.
