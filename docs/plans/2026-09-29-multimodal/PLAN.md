# Multimodal trading model — plan of record

**Started 2026-09-29.** Read `CHECKPOINTS.md` (same folder) first: it is the append-only log of every step
taken, with its evidence and the next step. `state.json` is the machine-readable pointer to where the job
stands. This file changes only when the plan itself changes, and says so under *Plan changes*.

## The ask (Tyler, 2026-09-29, verbatim in substance)

Create workflows to assess and audit all analysis notebooks regarding training; use all the data to
architect, end to end, a multimodal model that is profitable; data-engineer and recursively analyse
results and metrics to get there; document every step with checkpoints; integrate continuously until the
job is complete. The job is complete after thorough backtesting shows the multimodal model is profitable,
trades every day, wins 40% of trades, and has a 2:1 profit ratio.

## What "done" is measured by (the acceptance gate)

Measured on the **locked holdout** (below), after costs, by `src/ml/multimodal/gate.py`, once:

| # | Criterion | Threshold |
|---|---|---|
| G1 | Profitable | net profit after AMP costs (`src/config/cost_model.json`, 1 tick slippage per side, stops filled 1 tick worse) > 0 |
| G2 | Trades every day | at least one closed trade on every CME session day in the holdout |
| G3 | Win rate | winning trades / all trades >= 40% |
| G4 | 2:1 profit ratio (Tyler: "Both") | average net win / average net loss >= 2.0 **and** profit factor (gross net wins / gross net losses) >= 2.0 — with a 40% win rate this needs about 3:1 reward-to-risk, or about 50% wins at 2:1 |
| G5 | Not luck (robustness, mine) | block-bootstrap (by session day) 95% lower bound of total net profit > 0; net positive in at least 75% of development walk-forward quarters; still profitable with +1 extra tick of slippage per side |
| G6 | Multimodal | the model that passes uses more than one modality, and its ablations are reported (each modality's contribution measured) |

G1-G4 are Tyler's criteria. G5 is what makes "ensure it is profitable" mean something: a backtest that
passes G1-G4 by luck or by fitting the holdout does not count. G6 keeps the deliverable what was asked for.
If no model passes on the holdout, the job ends with that finding and its evidence — never with a
threshold moved or a holdout re-used to make a number pass.

## Evaluation protocol (fixed before any model is built)

- **Instrument (Tyler, 2026-09-29):** MNQ, intraday, flat by the session close. Price history for learning may come from NQ
  (the same index, same price) back to 2010; costs and the tick grid are MNQ's.
- **Locked holdout:** 2025-07-01 00:00 to 2025-12-31 00:00 (Pacific wall clock, as the lake stamps
  futures) — the last six months of the lake's dense MNQ history. No design decision, feature choice,
  hyperparameter or threshold may be informed by it. Every data loader in `src/ml/multimodal/` refuses
  timestamps inside it unless the gate unlocks it; every unlock is written to `CHECKPOINTS.md` as a
  "holdout look". One look is the budget; a second look means the holdout is burnt and a fresh
  out-of-sample period (forward paper test on live-hub data) becomes the gate instead.
- **Development:** everything before 2025-07-01, evaluated by purged, embargoed walk-forward (purge and
  embargo >= the label horizon).
- **Trials are counted:** every configuration evaluated is logged, so the deflated Sharpe ratio and the
  probability of backtest overfitting can be reported against the number of trials actually run.
- **Costs and fills:** entries at the next bar's open; bracket exits on the tick grid; when stop and
  target both fall inside one bar, the stop is assumed first; positions flat by the session close.

## Phases and their gates

| Phase | Goal | Gate that closes it |
|---|---|---|
| P0 Setup | plan, checkpoints, memory pointer, holdout registered | this file committed; holdout guard tested |
| P1 Audit | every training-related analysis notebook assessed: purpose, data, findings with numbers, validity, reusable assets, evidence of edge | audit table landed in the lake + `AUDIT.md`; claims of edge adversarially checked |
| P2 Data | inventory of every modality (price, order flow, cross-asset, news/FinBERT, calendar, chart image), gaps measured, backfills built, each modality's features causal and tested | coverage matrix + causality tests pass; datasets landed with manifests |
| P3 Baselines | the label (2:1 bracket), the policy (daily selection), the backtester; random, persistence and gradient-boosted baselines under the exact same rules | baselines reported; backtester unit-tested against hand-computed trades |
| P4 Architecture | the multimodal network (per-modality encoders, fusion, bracket heads), trainer on the dashboard's stdout protocol | smoke run live in the dashboard; tests pass |
| P5 Recursive loop | train → evaluate on development walk-forward → diagnose (ablations, errors by regime/hour/modality) → change → retrain | development walk-forward passes G1-G5 or the loop plateaus (reported) |
| P6 Final test | one look at the locked holdout | gate verdict written, with every number |
| P7 Delivery | marimo notebook + dashboard surface, docs, report | on Tyler's screen |

## Continuous integration

Every step ends with `python scripts/multimodal/ci.py` (unit tests, leakage/causality tests, holdout
guard test, lint) green, a checkpoint appended to `CHECKPOINTS.md`, `state.json` updated, and a commit
pushed. A red CI stops the step.

## Decisions (Tyler, 2026-09-29)

- Training runs: started by me through the dashboard's own Play path (`/api/training/start`), so each run streams live on the dashboard and lands in the lake. Nothing trains from a terminal.
- "2:1 profit ratio": both average win >= 2x average loss and profit factor >= 2 (G4).
- Instrument: MNQ, intraday, flat by the close.

## Plan changes

- **2026-09-29, before any model was built — G5 restated.** "Positive in each development quarter" was
  replaced by "positive in at least 75% of quarters". Reason: the P1 power analysis
  (`AUDIT.md` §5) shows a model with a TRUE 40% win rate at 1 trade a day passes every one of ~25
  quarters only 0.9% of the time, so the clause would reject real edges; it tested luck, not skill.
- **2026-09-29 — a clean confirmation period is added.** P1 found that H2-2025 has already been viewed by
  other studies (the ta_strategy frozen specs were selected on 2022-2025, and crossover, TrendState and
  candle_vocab were scored on it), so it is not pristine for those families. The verdict therefore also
  reports G1-G4 on a forward period nobody has seen: MNQ 5-minute bars after the lake's end (Yahoo
  MNQ=F keeps 60 days of 5m history; the live hub lands 1m from 2026-09-15), landed write-once before the
  model is frozen and read once. Failing it makes the verdict "not confirmed".
- **2026-09-29 — the prior is stated.** P1's synthesis puts the probability of clearing the gate as
  first written (average win >= 2x loss only) at about 3%; "Both" (profit factor >= 2 too) lowers it
  further. The job continues to the gate as Tyler set it; the thresholds do not move.
