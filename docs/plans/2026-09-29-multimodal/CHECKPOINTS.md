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

## CP-005 · 2026-09-29 · NQ history, level-free features, calendar, gate built and proven consistent

- **NQ history** (same index, same price, costed as MNQ): order flow 3,428,392 contract-minutes, labels 595,008
  rows over 2,281 sessions and features (148,822 decisions) for 2010-06 → 2019-05; `dataset.load(history="nq_mnq")`
  stacks it before MNQ: 252,131 decisions, 55 walk-forward quarters from 2011Q4.
- **Trial 4 — GBDT, NQ+MNQ, + context**: canonical window 2021Q2..2025Q2 PF 0.9515 (win 26.7%, net -$4,823);
  over all 53 policy-tuned quarters 2012Q2..2025Q2 (3,398 sessions) PF 0.933, win 27.6%, 28% of quarters positive.
  Improvement vs trial 1 (0.9511) is below 0.01 PF: counted as NOT an improvement (conservative reading of the
  stopping rule, recorded here before the next trial).
- **Found and fixed — level-dependent features.** Additive back-adjustment puts a 2019 bar's adjusted level 30%
  above what traded (1.30x in 2019 → 1.01x in 2025): log-return features were ~23% too small early on and carried
  later roll gaps. Every percentage change is now measured against the traded price (`raw_close`);
  `test_features_do_not_depend_on_the_back_adjusted_level` proves a constant shift moves no feature. Price and
  cross tables rebuilt (MNQ and NQ). Trials 1-4 used the old features; they stay counted.
- **Calendar**: 2019-05 → 2020-12 sourced from the publishers (240 releases + 18 FOMC statements incl. the 2020
  emergency cuts, every row with its URL; `evidence/calendar_2019_2020.json`); the lake calendar lacks the major
  releases for 2021-2022 → agent sourcing them now; calendar features restricted to families present every year.
- **Gate** (`src/ml/multimodal/gate.py`): policy fixed from the candidate's own development record, one budgeted
  holdout look, features/labels built in memory; `tests/test_multimodal_gate_consistency.py` proves the gate's
  build equals the development tables on January 2024 (all 95 feature columns and the labels).
- Trials without a 0.01 PF improvement: 3 (trials 2, 3, 4). Next: trial 5 = trial 4's configuration on the fixed
  features; then calendar and news.

## CP-006 · 2026-09-29 · trials 5-6; calendar complete; notebook on the dashboard

- **Trial 5 — GBDT, NQ+MNQ, time/price/flow/cross/context on the level-free features**: canonical PF 0.847
  (win 26.3%, net -$9,218, bootstrap P(profit) 0.012); all 53 quarters PF 0.854. Trial 4's 0.95 was partly noise
  carried on the superseded level-dependent features.
- **Rule interpretation (recorded before trial 7's result)**: trials 1-4 ran on superseded features and cannot be
  reproduced by the current code, so "best development PF" is taken over trials on the current feature code only
  (from trial 5). The 24-trial budget still counts every trial.
- **Calendar complete 2019-05 → 2025**: 2021-2022 releases sourced by the agent (240 rows, no gaps,
  `evidence/calendar_2021_2022.json`); every family now has its normal count in every year; calendar features use
  only those families. NQ-era (2010-2019) calendar is empty by design.
- **Trial 6 — trial 5 + calendar**: canonical PF 0.953 (win 27.6%, payoff 2.50, net -$3,137, P(profit) 0.25,
  47% of quarters positive); all 53 quarters PF 0.905. The calendar is the first modality with a clear lift
  (+0.106 canonical PF over trial 5). Best on current code: 0.953 (trial 6); trials without improvement: 0.
- **Notebook**: `notebooks/multimodal_model.py` (ml-dashboard group, /marimo) — every trial against the gate lines,
  equity and quarterly P&L, decile calibration, modality contributions, base rates by hour, the audit table, the
  gate record; exports clean.
- **FinBERT headline scorer**: `scripts/multimodal/score_gdelt_finbert.py` — core market / rates / central-bank /
  megacap headlines, deduplicated per day, batched fp16 at ~1,470 headlines/s (the datalake class ran 200/s); runs
  once the backfill reaches the development years.
- Next: trial 7 = fusion on all six modalities; then news (tone + FinBERT) when the backfill lands.

## CP-007 · 2026-09-29 · adversarial review before any holdout look; framework v3

- Review (3 opus reviewers + sonnet verifiers, read-only; full record `evidence/review_2026_09_29.json`). Confirmed
  and fixed:
  - **policy re-entry** in the minute the previous trade was still exiting (future information, two positions):
    827 of 18,906 trades in trials 1-6, avg -6.05 points; now an entry must come after the exit minute.
  - **news clock**: microseconds read as nanoseconds put every news row in January 1970 (no trial used news yet);
    `sources.utc_seconds` converts any unit; tested for ns/us/ms.
  - **coverage**: calendar columns are NaN before the sourced calendar (2019-05-01) instead of "no event"; news
    columns are NaN on any bar whose trailing 24 h reach a day not landed complete and scored.
  - **unscheduled FOMC statements** (2019-10-11, 2020-03-03 ...) no longer feed forward-looking calendar columns.
  - **incomplete sessions** (data ends before 10:00 PT: 43 per instrument) are left out of the labels; the forced
    trade no longer fires on "the last row" (grid forced times 07:00 / 09:00, before any early close).
  - **target fills** need one tick of trade-through (measured effect: target rate 0.2953 → 0.2934).
  - **gate**: fusion/ensemble candidates keep their sequence input; G5 uses the DEVELOPMENT quarters (plan wording);
    G6 counts data modalities (time/context belong to price) and requires a recorded ablation per modality;
    runs record provenance (commit, code hash, table versions) and the gate refuses a candidate whose inputs changed.
  - one assembly path (`multimodal.assemble`) for development tables and the gate's holdout build; daily closes are
    cut at the development end unless the gate has unlocked the holdout; backfill retries parse failures and never
    lands a partial day.
  - Not a defect (verifier): NQ-era labels are a cost-dominated trade (4-point stop floor on 28-81% of 2010-2017
    decisions) — real, reported; canonical trials now use `history=mnq`, nq_mnq only as a control.
- Rebuilt: labels MNQ 406,700 rows / 1,545 sessions, NQ 588,992 / 2,238; all feature tables (MNQ, NQ). CI green
  (44 tests incl. the gate consistency test on the shared assembly). Base rates unchanged in substance (PF 0.88-0.95).
- Trials 1-6 ran under the flawed policy and features: all superseded (still counted: 6 of 24 used). Trial 7 was
  killed with its server session before recording (not counted). Best on framework v3: none yet.

## CP-008 · 2026-09-29 · trial 8, the first on framework v3; trial 9 started

- **Trial 8** (7 of 24 counted): gbdt · blocks time,price,flow,cross,context,calendar · history mnq · test quarters
  from 2020Q3 · seed 7 · `MNQ_5m_multimodal_fusion+bracket_meta_label_20260929T200802` · commit 7957883 ·
  code sha256 5334feb3.
- Canonical window 2021Q2..2025Q2: 1,066 sessions, 2,633 trades (2.47 a session, 14.9% forced), win rate 0.3027,
  payoff 2.204, **profit factor 0.9567**, net -$5,421.24 (stressed -$8,054.24), bootstrap P(profit) 0.2025
  (95% lower bound -8,600 points), quarters positive 0.353, maximum drawdown $8,897.70. Gate: G2 only.
- It sits just above the coin-flip base-rate band (profit factor 0.88-0.95, CP-007): no directional edge yet.
- Best on v3: trial 8 (0.9567). Trials without improvement: 0.
- **Trial 9** started: fusion, same blocks, history and window (`..._20260929T201826`).
- GDELT backfill: every day from 2024-06-03 to 2026-09-29 landed (0 incomplete); the 2019-05-01..2025-12-31
  pass is at 450 of 2,420 days, newest first.

## CP-009 · 2026-09-29 · trial 9 (fusion) is the best on v3; gbdt measures G6 too

- **Trial 9** (8 of 24 counted): fusion · blocks time,price,flow,cross,context,calendar · history mnq · test
  quarters from 2020Q3 · seed 7 · `MNQ_5m_multimodal_fusion+bracket_meta_label_20260929T201826` (code sha256
  5334feb3, before the change below).
- Canonical 2021Q2..2025Q2: 1,066 sessions, 1,737 trades (1.63 a session, 14.3% forced), win rate 0.3149, payoff
  2.179, **profit factor 1.0018**, net +$140.14 (stressed -$1,596.86), bootstrap P(profit) 0.513 (95% lower
  bound -4,470 points), quarters positive 0.412, maximum drawdown $6,453.26. Gate: G1, G2.
- Diagnosis: mean test AUC per head 0.503 / 0.511 / 0.508 / 0.513 (long 2:1, short 2:1, long 3:1, short 3:1);
  token ablation (AUC drop) price +0.0014, flow +0.0029, cross -0.0013, calendar -0.0021. The network does
  not discriminate; the profit factor near 1.00 is the policy riding a coin flip, not an edge.
- Best on v3: **trial 9, 1.0018** (+0.045 over trial 8). Trials without improvement: 0.
- **Code change (plan change of the same date):** gbdt records a block ablation (each block's columns shuffled
  together across every test quarter, 3 shuffles), so G6 is measured whichever family is frozen; predictions
  are unchanged (`tests/test_multimodal_ablation.py`). The code hash moved, so trials 8 and 9 need a
  provenance refresh before either could be gated. CI green (45 tests).
- Trial 10 next: the ensemble of the two families, same blocks, history and window.
