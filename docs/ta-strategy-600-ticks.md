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

**Result (recipe `round_2_20260928T235330`):**
- **Beta is gone.** Beta is -0.23 to 0.00 across all 60 configurations, and the long share is 0.35-0.45.
- **The primary does not pass.** Its alpha is +17.0 ticks/day, t 1.15, positive in 6 of 9 folds.
- **Best by alpha:** `1h_h12_logistic_c005_gate5_centred` at +28.8 ticks/day (t 2.72, interval [8, 51], 7 of 9 folds). Its net is +27.1 at 0.29 trades/day.
- **Grid:** the Reality Check p is 0.064, and 2 of 60 configurations have t > 2. The null expects 1.5.

**Review verdict:**

| Finding | Evidence |
|---|---|
| The best is what a best-of-60 search produces | The null 95th-percentile maximum t is 2.78-2.94, and the observed t is 2.72. |
| Its alpha lives on big-move days | The 58 largest-move days carry 63% of it. It wins 21 of 28 big days, but only 51.0% of ordinary days. |
| Adding a convexity term leaves little alpha | The Treynor-Mazuy alpha is 9.4 (t 0.72). |
| The accounting is sound | The audit found nothing larger than 0.2 ticks/day. |
| 600 is out of reach | The best's alpha upper bound is 51. |

**Surviving recommendations** (the `reviews` table has all 11, with the skeptic's verdict on each):
1. **Fix the gate centre.** The fit-row centre builds in a short bias: 4h H6 is 0% long in 5 of 9 folds. Replace it with a two-sided rank gate fitted on validation rows.
2. **Fix the pass line.** Use a joint-bootstrap maximum-t critical value (about 2.8 for 60 configurations), count trials across rounds, and add robustness gates (Treynor-Mazuy, and alpha without the largest-move days).
3. **Separate the hold from the label horizon.** Renewed holds carry 61% of the primary's net, but its label never scored them.
4. **Buy power.** Prune the grid to 1-3 pre-registered configurations and add NQ from 2010. At 1,164 days the smallest detectable alpha is about 29-39 ticks/day.

**Refuted:**
- The 800-tick take-profit: it was selected after the fact, and it moved net by +0.9.
- A range-conditioned big-day strategy as a sure path: the big-day win rate was found after the fact on a selected configuration, and the upper bound is about 18 ticks/day. It is still the only hypothesis worth a pre-registered test.
- Sizing as a finding: 23 contracts reach $300/day at the point estimate, but the maximum drawdown is -$53.7k. It adds no evidence about the edge.

**Conclusion after two rounds:**
- TA-indicator direction is worth at most about 10-30 ticks/day per contract, and that has not been shown to be above noise.
- 600 ticks/day on one contract is not reachable with this family. The market's hindsight ceiling is 16-20 times 600, so the limit is signal, not opportunity.

## Conditional (rule-based) TA-Lib strategies: 40% win rate at 2:1

The model rounds above answered the wrong question. The ask was conditional TA-Lib rules with a
bracket, judged against a 40% win rate at 2:1 reward-to-risk. That is a profit factor of 1.33
before costs, and it is 600 ticks a day at `N × (0.2 × stop − 5.56)`.

| Piece | Where |
|---|---|
| Rules and gates | `src/ml/ta_strategy/rules.py`: 16 TA-Lib families, `union`, `gate_mask` (rth, open30, first_hour, `natr_pct_below_N`, `bbwidth_squeeze_20_last6`, `htf_ema50_200_side`) |
| Bracket simulator | `src/ml/ta_strategy/bracket.py`: numba; next-open entry, whole-tick levels, stop-first inside one minute, gap fills, flat at the session's last bar, stop slippage |
| Driver | `src/ml/ta_strategy/rule_search.py`. Rounds are in `src/config/ta_rule_rounds.json`. |
| Data | `data.load_minutes_rebuilt`: one contract per session. `aggregate` builds 15m/30m/1h from those minutes. |
| Lake | `derived_ta_rule_strategies_600_ticks_{rounds,strategies,yearly,trades,daily,random_entry_baselines,random_entry_win_rate_by_bracket,reviews}` |
| Tests | `tests/test_ta_rules.py`, 46 tests |

**Rule round 1** (`round_1_20260929T014217`, commit 8e1e93d)

- **Setup:** 3,024 strategies: 21 rules × 4 filters × 9 stops × 1m/5m/15m/1h.
- **Headline:** 9 met a 40% win and PF 1.33 in-sample, 14 out-of-sample, **0 in both**.
- **Review:** counting only trades that hit the 2:1 target, 0 of 3,024 reach 40%. Every one that "met" the target did so by holding to the session close.
- **Random baseline:** random entries win 33% on narrow brackets, but 46% on 1h 3×ATR brackets.
- **Defects found:** round 1 also exposed 4,833 intra-session contract flips in the stitched 2019-2020 bars.

**Rule round 2** (`round_2_20260929T021709`)

- **Harness:** one contract per session (27 clean rolls), fills on the minute path, 1 tick of stop slippage, and two nulls: random entries matched to gate, hours and side, and the rule's own bars with random sides.
- **Grid:** 223 strategies, mostly 15m breakouts × session and volatility gates.
- **Strict 2:1 test:** 2 met it (target hit ≥ 40%, PF ≥ 1.333, session-end exits ≤ 25%) over all years, 1 in both periods. Its edge was not confirmed.
- **Confirmed edges:** 6, each a lift over the matched null in 7 of 7 years at z above 3.07.
- **Frontier:** +5 to +25 net ticks/day per contract, at 0.1-0.5 trades/day.
- **Review verdict:** the edge is real but small, about +5 points of target-hit rate over random. PF 1.33 at 2:1 needs +9 to +12.

**Rule round 3, pre-registered** (`round_3_*`, frozen in commit 6db0019 before the run)

The three best round-2 strategies were tested once on NQ 2010-06..2019-06, which no round had touched. NQ has the same 0.25 tick, and the cost used is MNQ's 5.56 ticks plus 1 tick of slippage.

| Strategy | Target hit | Matched null | Needed for PF 1.333 | PF | Net ticks/day |
|---|---|---|---|---|---|
| Donchian 20, open30 + quiet, 2×ATR | 0.346 | 0.294 | 0.47 | 0.93 | −0.2 |
| 5-trigger union, open30 + NATR < 70, 2×ATR | 0.319 | 0.300 | 0.47 | 0.83 | −2.2 |
| Donchian 55, open30 + quiet, 1.5×ATR | 0.384 | 0.340 | 0.49 | 0.89 | −0.2 |

**0 of 3 were confirmed.**
- **The small edge showed up again:** Donchian 20's lift is positive in 7 of 9 years, and z is 0.8-1.4.
- **It is not significant, and it does not pay:** it falls below the break-even hit rate once the cost of a round trip is counted. In 2010-2019, NQ's ATR in ticks was smaller, so the cost weighs more.

By the pre-registered rule, **the rule-based 40%-at-2:1 line is closed**. No conditional TA-Lib strategy tested here reaches 40% target hits at 2:1 with PF 1.33, and none approaches 600 ticks/day.

**What remains, from the reviews:**
- **Sizing and instruments:** 600 ticks/day on one contract is not a rule-search target. At a real +10 to +20 ticks/day it needs 30-60 contracts, and that edge is itself unconfirmed out of sample.
- **Different information:** order flow and depth (Quantower DomFlow capture), news and event timing, or cross-instrument signals, rather than more TA-Lib combinations of the same OHLC.

**Earlier next step (model rounds): a pre-registered test of a different family:**
- range-forecast-gated trading on predicted big-move sessions, or the 09:30 ET opening-range breakout;
- run on NQ from 2010 for power;
- with contract sizing only after an edge clears the joint-bootstrap line.
