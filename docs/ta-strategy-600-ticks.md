# TA-indicator strategy vs 600 MNQ ticks a day

The study behind the question "can the TA-indicators strategy capture 600 ticks a day on MNQ?".
One tick is 0.25 index points, which is $0.50 on one MNQ contract. 600 ticks is 150 points, or $300 a day.
A round trip costs $2.78, which is 5.56 ticks (`src/config/cost_model.json`: $0.89 fees plus 1 tick of slippage per side).

## How it runs

| Piece | Where |
|---|---|
| Rounds (a grid per round, hypothesis, pre-registered primary, pass criteria) | `src/config/ta_strategy_rounds.json` |
| Study code | `src/ml/ta_strategy/`: `data.py` loads bars and rolls, `features.py` is the battery, `evaluate.py` does walk-forward, gate and simulation, `metrics.py`, `oracle.py`, `store.py`, `reviews.py`, `main.py` |
| Dashboard runner | `ta_indicator_battery+ticks_per_day_goal`: ML Studio, or `POST /api/training/start` with `hyperparameters.round` |
| Lake | `s3://derived/ta_strategy_600_ticks/recipe=round_<n>_<stamp>/table=<t>/`, served as `derived_ta_strategy_600_ticks_<t>` |
| Tables | `rounds`, `configurations`, `folds`, `daily`, `trades`, `predictions`, `feature_importance`, `rolls`, `oracle_by_session`, `reviews` |
| Notebook | `notebooks/ta_strategy_600_ticks.py` (ml-dashboard group, `/marimo/ml-dashboard/`) |
| Tests | `tests/test_ta_strategy.py` |

**The loop:** run a round, review it, land the review, then write the next round.

1. **Run a round.** Round *n* runs from the dashboard.
2. **Review it.** A review workflow reads the round's tables from four lenses: statistics, trading economics, model/features, and an adversarial code audit.
3. **Rank and verify.** A synthesis ranks the improvements by expected ticks per day. A skeptic then tries to refute each one.
4. **Land the review.** `reviews.py` lands the verdicts as the `reviews` table under the round's recipe.
5. **Write the next round.** The surviving recommendations become round *n+1* in the rounds JSON.

## What the harness guarantees

These guarantees are the corrections the 2026-09-28 research pass found in `Trading/quant/model/scripts/train_direction_ta.py`.

- **Lake bars, back-adjusted at every roll.**
  - Bars come from `ohlcv_full_<timeframe>`. It carries the stitched root and every contract from 2019-05.
  - Rolls are found by `cycle.rolls`.
  - A position held across a real roll pays one more round trip. The 2019-2020 flip-flops between two contracts are not charged.
- **Every feature is invariant to a price shift.** A back-adjusted level contains the gaps of later rolls, so a feature that moves under a shift reads the future.
  - Price-level indicators are differences divided by ATR.
  - TA-Lib's Hilbert family, MAMA/FAMA and the money flow index move under a shift, so they are excluded.
  - Causality and invariance are both tested.
- **Labels are the trade the signal asks for.** The fill is the next open. The label is whether the open H bars later is above that fill. Ties are unlabelled.
- **Gate threshold from validation rows, never the test fold.**
  - Round 2 onward: conviction is centred on the mean P(up) the fold's model gives its own fitting rows (`gate_centre: fit_mean`). This matters because a model centred on the upward drift reads every bar as "confident long".
- **Next-open fills through the Model Cycle simulator** (`cycle/simulate.py`), with costs on every fill.
- **Folds are cut at CME session opens** (15:00 Pacific). A session day is `date(timestamp + 9 h)`, and weekend stamps move to Monday.
- **Scored per session day.** Each configuration gets:
  - net ticks, with all eight numbers of its daily distribution and a 10-day block-bootstrap interval;
  - buy-and-hold over the same days;
  - alpha after beta (OLS on buy-and-hold) with a Newey-West t, and its bootstrap interval;
  - folds with positive alpha and the best fold's share;
  - the mean without the 10 best days;
  - a deflated Sharpe probability on alpha, with the effective trial count taken from the grid's eigenvalues.
- **Grid-wide:** a White Reality Check p-value for the best alpha, and whether the pre-registered primary passes.
- **Ceiling:** per session, a perfect-hindsight zigzag at 8/20/40/80/160-tick swings, each leg charged a round trip.

## Results

### Round 1: the TA battery made honest (recipe `round_1_20260928T230747`)

**Setup:** 42 configurations (15m/1h/4h × horizons × logistic/LightGBM × gates 10/30/100%), 9 folds, 2021-07 to 2025-12, 1,167 session days.

**Headline:**
- The best configuration is `1h_h12_logistic_gate30`: +38.5 net ticks/day, interval [-1.4, +77.2].
- Buy-and-hold made +27.5 on the same days.
- No configuration's interval clears zero.

**Review verdict (the `reviews` table): no edge above noise or buy-and-hold.**

| Finding | Evidence |
|---|---|
| The best result is mostly market exposure | +38.5 = 13.9 beta + 24.5 alpha. Alpha t is 1.34 (HAC). |
| It rests on one half-year and a few days | 80% of its alpha comes from 2025 H1. Without its top 10 days it earns 9.6. |
| The whole grid looks like noise | Grid-wide Reality Check p is 0.52. |
| LightGBM's results are buy-and-hold | Beta is 0.96-0.99, and it is long 98-99% of held time. The gate measured distance from 0.5, but the models centre on the up-drift. |
| The accounting is sound | The adversarial audit reproduced all 42 configurations to 1e-8 ticks. Every bookkeeping defect it found moves the headline by under 1 tick/day. |

**Why 600 is out of reach:**
- A fixed-hold direction rule needs a hit rate of 0.85 at 1h H12, or 0.64 at 15m H4 with 23 trades a day.
- The observed hit rate is 0.51-0.54.
- Even with zero cost, the highest gross in the grid is 52 ticks/day.
- The market itself offers far more: the median 40-tick-swing ceiling is 9,973 net ticks a session.

### Round 2: the review applied (see the `rounds` and `reviews` tables)

The gate is centred on each fold's own base rate and scoring is on alpha. Models are logistic only, at C 0.05 and 0.01. The candlestick columns are dropped, and there is a +1 tick slippage sensitivity.

The pre-registered primary is `1h_h12_logistic_c005_gate10_centred`. It passes only if all three hold:
- its alpha t is at least 2;
- the grid Reality Check p is at most 0.05;
- its alpha is positive in at least 7 of 9 folds.
