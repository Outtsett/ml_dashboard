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
