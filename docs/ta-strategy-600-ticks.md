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

## Multi-timeframe support/resistance and conditional strategies (Optuna-tuned, no model)

> **Superseded definition (2026-09-30).** The zones in this document (`src/ml/ta_strategy/levels.py`: session / week levels, round numbers,
> fractals, swing levels and VWAP bands merged within 0.25 ATR) were a second definition of support/resistance beside the Market
> chart's own (`market/lib/chart_overlays.ts`). The dashboard's definition, in numpy/pandas with a parity test and a causal per-bar
> version, is `src/ml/shared/zones.py`, landed as `derived_zone_features_<timeframe>`; rounds 3-13 stay as the record of what the
> merged-level zones did (nothing), and any new work uses the chart's zones.


### How the levels are calculated (`src/ml/ta_strategy/levels.py`)

Every level is an event with the moment it became knowable (`known_from`) and the moment it stops applying (`valid_until`).

| Family | Levels | Known from | Valid until |
|---|---|---|---|
| Prior session | High, low, close of the previous 15:00-14:00 CME session | The next session's first minute | The end of that session |
| Prior RTH | High, low, close of 06:30-13:00 Pacific | 13:00 | The end of the next session |
| Overnight | High and low before 06:30 | 06:30 | The session end |
| Opening range | 06:30-06:45 and 06:30-07:00 high and low | 06:45 and 07:00 | The session end |
| Prior week | High, low, close of Monday-Friday | The week's first session | The week's end |
| Round numbers | 100s and 50s in **traded** prices, shifted by the session's roll adjustment | The session open | The session end |
| Fractals | Williams fractals on 15m (k 3), 1h (k 3) and 4h (k 2, 15:00-anchored bars) | The close of bar i+k, the confirmation (never the extreme's own bar) | A close beyond it by 0.25 ATR, or an age cap |
| VWAP | Session VWAP from the 15:00 open, ±1σ and ±2σ (volume-weighted) | Each minute | — |

**Zones.** At every 15m bar the active levels within 6 ATR merge into zones by single linkage, with a gap of at most max(0.25 × ATR, 4 ticks). Support is the nearest zone below the close, resistance the nearest above. A zone's strength is the number of distinct families in it.

**Anchoring.** The 4h, session and week bars are anchored at 15:00 (`data.aggregate_session_anchored`). Epoch-aligned 4h bars straddle the 13:00 RTH close, the 14:00 break and the 15:00 open.

**Tests.** Truncation tests hold every level to causality: all 60,336 events known before a cut are identical when built from data up to the cut.

**Evidence** (Osler 2000/2003, Kavajecz & Odders-White 2004, Garzarelli et al. 2014, Chung & Bellotti 2021): published levels raise bounce probability by about 4-6 points in FX. That edge fades within days.

**Measured on MNQ, 2019-06..2025, first tests.** The hold rate is the share of first tests where price moves 1 ATR away before 1 ATR through. Two nulls:
- **Null A:** the same level at the same ATR distance in a random other session.
- **Null B:** the whole pipeline rebuilt on sessions whose minutes were shuffled. This measures the mechanical bounce, since a swing level sits where price just turned.

| Family | Lift over null A | Same, on shuffled sessions | **Edge net of mechanics** |
|---|---|---|---|
| fractal_15m | +0.091 | +0.196 | **−0.105** |
| fractal_1h | −0.026 | +0.032 | **−0.058** |
| fractal_4h | −0.052 | +0.006 | **−0.057** |
| prior RTH | −0.025 | +0.005 | −0.030 |
| prior week | −0.058 | −0.029 | −0.028 |
| opening range | −0.027 | +0.001 | −0.028 |
| overnight | −0.027 | 0.000 | −0.027 |
| prior session | −0.028 | −0.002 | −0.026 |
| round numbers | −0.006 | −0.005 | −0.001 |

**Every family breaks more often than chance.** On MNQ, levels act as breakout points, not walls. The 15m fractals' apparent +9-point "hold" is less than half of what the definition produces on random paths.

### Conditional strategies

| Piece | What it is |
|---|---|
| `strategy.py` | Compiles JSON specs. Series: any TA-Lib function via the abstract API, SMA/EMA/WMA of a series (e.g. RSI's signal line), arithmetic, lags, levels, level events, VWAP, and multi-timeframe series from the last *completed* higher-timeframe bar. |
| Conditions | `cross_above/below`, `above/below`, `rising/falling`, `within k bars`, `then`, `broke_above/below` (the level as it stood on the previous bar), `retest_above/below`, `near`, `session_window`, `pct_rank_below`, and `all/any/not`. |
| `engine.py` | The exit engine on the 1-minute path. It is a superset of the bracket simulator, with identical output held by a parity test. Exits: stop (ATR, ticks, or beyond a level), target (R, next level with a room filter, or none), breakeven, chandelier trail, signal exits at the next open, a time stop, and the session-end flatten. |
| `optimize.py` | Per template and per test year (2022-2025), Optuna TPE tunes up to 5 parameters on the **prior years only**. The objective is the per-day Sharpe of the excess over matched random entries: same session window, same count per hour, same long share, same exits. The top distinct trials are re-scored with fresh null seeds before the test year is touched. |
| Templates | `src/config/ta_conditional_templates.json` (add strategies there). Rounds: `src/config/ta_conditional_rounds.json`. Pre-registered confirmation: `confirm.py --round 3`. |
| Lake | `derived_ta_conditional_strategies_600_ticks_{rounds,templates,folds,trials,daily,trades,level_quality,level_events,zones_15m,level_tests,reviews,confirmation_rounds,confirmation_strategies,confirmation_daily,confirmation_trades,level_quality_fractal_window_fixed}` |

**Conditional round 1** (`round_1_20260929T043148`), stitched out-of-sample 2022-2025, tuned only on prior years:

| Template | Net ticks/day | Excess over matched random | PF | Target hit |
|---|---|---|---|---|
| Level breakout + momentum | +13.7 | +15.2 (t 1.68) | 1.12 | 0.25 |
| Opening-range breakout | +11.0 | +12.0 (t 1.58) | 1.12 | 0.30 |
| RSI-signal-line + MACD-histogram + VWAP (the example asked for) | −8.1 | — | 0.92 | 0.10 |
| Breakout retest | −10.4 | — | — | — |
| 1h-trend pullback | −3.5 | — | — | — |

**Review** (the `reviews` table):
- **Two defects in the significance columns**, neither of which changes net ticks or the chosen parameters.
  - The matched null drew from every year. With it fixed, level-breakout's excess is +21.9, t 2.45.
  - The deflated Sharpe used penalised trial values.
- **2022 is 96%** of level-breakout's net.
- **Level breaks hit the 2R target no more often** than momentum bars matched at random (29.1% vs 29.1%).
- **The level stop was the nearest zone**, not the broken one.
- **Tuning helps only weakly:** the in-sample to out-of-sample rank correlation is +0.17 on the two positive templates and about 0 overall.

**Conditional round 2** applies those fixes. It adds a level-free momentum control and no-target runner exits, which are reported as not 2:1.

**Conditional round 2 results** (stitched 2022-2025): the best template, `opening_range_breakout_runner`, nets +22.8 ticks/day (excess +22.6, t 2.77, PF 1.44). That is 3.8% of 600.
- 11 templates have now been scored on 2022-2025. White Reality Check p over them is 0.037, or 0.15 without 2022.
- Without 2022, the ORB runner nets +12.7 (t 1.54).
- The top 10 days carry 67-76% of every template's excess.
- Across 1,754 trials, train Sharpe against test excess has a rank correlation of 0.023.
- On 31,528 real 15m breaks, continuation is 0.519 against 0.520 for distance-matched random levels.

**Level quality with the fractal window fixed** (fractals are tested until an age cap, not until retirement). Every family breaks more often than chance, net of mechanics:
- fractal 4h −0.054, fractal 1h −0.047, fractal 15m −0.033;
- prior RTH −0.030, prior week −0.028, opening range −0.028;
- overnight −0.027, prior session −0.026, round numbers −0.001.

### Conditional round 3: pre-registered confirmation (`round_3_20260929T072558`)

**Design.** Three frozen specs (`momentum_expansion_two_to_one`, `level_breakout_momentum`, `opening_range_breakout_runner`) were committed before any NQ 2010-2019 result was seen. They run once on NQ 2010-06-07 → 2019-05-31 (2,306 sessions, 36 rolls, MNQ costs).
- The endpoint is the pooled daily excess over matched random entries: Newey-West t, a trimmed mean, and four sub-periods.
- Level-stop templates use geometry-matched null stops.

**Disclosure.** One smoke run on NQ 2014-06..2015-06 was seen before the pre-registration commit. Nothing was changed after it.

**Result: CONFIRMED.**
- Pooled excess +3.81 ticks/day (t 4.52); trimmed +2.80 (t 4.36).
- Sub-periods +0.9, +3.6, +4.4, +6.4.

| Template | Net ticks/day | Excess (t) | Win rate | PF | Trades/day |
|---|---|---|---|---|---|
| Momentum expansion 2:1 | +1.8 | +6.0 (4.71) | 43.5% | 1.10 | 0.55 |
| Level breakout + momentum | +0.6 | +3.6 (3.65) | 36.4% | 1.07 | 0.42 |
| Opening-range breakout runner | −0.5 | +1.8 (1.73) | 18.6% | 0.96 | 0.54 |

**Adversarial review.** The two skeptics did not refute the result.
- Under the strictest null the excess is still +2.16 (t 2.57, trimmed t 2.01).
- Against random sides, the choice of direction is worth +2.85 (t 3.55).
- Skeptic B found that `contract_sort_key` mapped single-digit contract years to 2019 or later. The first run silently stopped at 2018-12-21. The year now comes from the contract's first traded date, and this recipe is the re-run.

**Reading.** The directional edge is real but small. Net of costs, the three books sum to about +1.9 ticks/day on one contract, against a goal of 600. No template reached 40% win at 2:1 (PF ≥ 1.33) out of sample. Levels add nothing over momentum.


### Conditional round 4: frequency and session (`round_4_20260929T0900`, `frequency.py`)

**The question.** 600 ticks is the day's total: every trade, long or short, overnight (ETH, 13:00-06:30 PT) or regular hours
(RTH, 06:30-13:00). Rounds 1-3 capped each template at 2 entries per session inside an RTH window, so they traded about 0.5
times a day.

**What round 4 varies.** It keeps the three frozen specs and changes only:
- the session window: frozen / overnight / whole day (`session_window` now wraps midnight when end <= start);
- the entry cap: 2 / unlimited;
- the bar: 15m / 5m / 1m;
- a pre-declared threshold ladder: frozen / looser / loosest.

That makes 126 variants per market, each against matched random entries and random sides. Every variant is split long vs
short and RTH vs ETH, per year and per entry hour. The opening-range book is RTH-bound and stays on its frozen window in
every setting. A portfolio sums the three books at one contract each, so up to 3 contracts can be open at once.

**Disclosure.**
- Two-month smoke runs (MNQ Oct-Nov 2025) were seen before the full run. The loosest whole-day 15m setting showed about
  +640/day there; over 2019-2025 it is -50.3/day.
- The pre-registered hypothesis (no setting reaches 5% of 600) failed on MNQ (9.9%) and held on NQ.

| Market | Best setting | Trades/day | Net ticks/day | Share of 600 | Excess (t) |
|---|---|---|---|---|---|
| MNQ 2019-06..2025-12 (parameters tuned here: in-sample ceiling) | frozen RTH, 15m, frozen thresholds (cap makes no difference: +59.6 vs +59.5) | 1.61 | +59.6 | 9.9% | +62.2 (4.93) |
| NQ 2010-06..2019-06 (never used for tuning) | same | 1.55 | +2.0 | 0.3% | +11.9 (4.60) |

**Per year, MNQ best setting.**

| Year | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|---|---|---|
| Net ticks/day | +7.8 | +22.1 | +62.3 | +146.3 | +14.8 | +90.0 | +52.4 |

**Findings.**
- **More trades, fewer ticks.** Across the 54 settings per market, trades/day and net/day correlate -0.993 (MNQ) and
  -0.999 (NQ).
- **1m loses heavily.** 1m loosest whole-day MNQ makes 148 trades/day and -944 ticks/day. At 1m the gross per trade
  (median 0.6-1.8 ticks) is about the 5.56-tick cost.
- **The ladder is not monotone at 15m.** Looser gives +32.7 and loosest +43.0.
- **Overnight never pays.** 0 of 72 MNQ and 0 of 73 NQ variants net positive per overnight trade, and every overnight
  entry hour is negative when pooled. Profitable entries cluster at 06:00-09:00 PT.
- **Direction.** The median long and median short are both negative across the grid. In the best RTH setting both are
  positive.
- **40% win at PF 1.33.** One spec (momentum 2:1, frozen, at two cap settings) meets it on MNQ, in-sample. On NQ, 0 of 126
  do (43.8% / PF 1.10).
- **Single months are not the average.** Individual months exceed 600 (+903/day in Apr 2025, whole day uncapped 5m
  loosest), but that setting averages -210/day. No 63-session window of any setting reaches 600 (max +423).
- **Break-even.** At N trades a day, each trade must gross at least 600/N + 5.56 ticks, plus 1 per stopped trade.

**Review** (the `reviews` table, recipe `round_4_20260929T0900`). Three skeptics found no code bias against the overnight,
uncapped, looser or shorter-bar variants. Two caveats:
- Thresholds and ATR multiples were not re-tuned per timeframe.
- On NQ 2010-2019 a 1m ATR stop is often 4-6 ticks, so the cost is about 1R per trade by design.

**Lake:** `derived_ta_conditional_strategies_600_ticks_frequency_{rounds,variants,portfolio,years,hours,daily}`.
**Notebook:** section 11 has a trades-per-day slider against the gross each trade must capture.


## Time of day, ETH vs RTH, time events (round 5, confirmation rounds 6-7)

### What was built

**`seasonality.py`, the causal intraday profile.** It uses 5-minute buckets of the 15:00-14:00 PT session.
- **Shape:** each bucket's mean |1-minute return| over its session's mean. Half is the last 120 sessions and half the last
  40 same-weekday sessions, all strictly before the session it is used on.
- **Level:** an EWMA (half-life 60 minutes) of |r| / shape.
- **Heat:** the level over the median of the previous 60 sessions.
- **Expected efficiency:** the expected 30-minute efficiency ratio per bucket.
- **Derived values:**
  - `ahead_ratio(h)`: expected volatility of the next h minutes over the last h.
  - `expected_move_points(h)`: sqrt(8/pi) x sqrt(pi/2) x level x sqrt(sum of shape^2 over h) x price.

**Time events.**
- **Clock anchors (Pacific):**
  - 15:00 Globex open;
  - Tokyo 09:00 JST, which is 16:00 or 17:00 PT;
  - London 08:00, which is 00:00 PT, or 01:00 PT in the weeks US and UK daylight saving differ;
  - 05:30 and 07:00 US data, 06:30 RTH open, 13:00 cash close, 14:00 session end.
- **Calendar releases:** scheduled only, through `multimodal.sources.calendar_events` plus
  `docs/plans/2026-09-29-multimodal/evidence/calendar_2010_2019.json`. That file adds FOMC, CPI and NFP for 2010-01..2019-04,
  every row sourced from the Fed or BLS.
- **Release-group coverage:** a group counts only from where every one of its families is covered. NQ before 2019-05 has
  CPI and NFP only, so there is no 08:30-group flag there.
- **Calendar flags:** month start and end, and days before or after a holiday, come from the NYSE trading calendar
  (`holidays`). Expiry week and expiry day follow the third-Friday rule.

**Strategy compiler.**
- Series nodes `{"seasonal": shape | efficiency | heat | ahead_ratio | expected_move}`.
- Series nodes `{"time": minute_of_day | weekday | minutes_since | minutes_until | flag | event_high | event_low}`.
- Conditions `in_set` and `between`.
- Stop and target kind `series` (a distance in points from a series, times `mult`).

**Templates.**
- `seasonal_breakout_{rth,eth}`: enters only into rising expected volatility, stop = k x the expected 60-minute range, and
  exits when volatility is about to fall.
- `seasonal_fade_{rth,eth}`: ranging buckets, back to VWAP.
- `event_breakout_{rth_open,london_open,us_data_0830}`.
- `atr_breakout_control_{rth,eth}`: the same breakout with a trailing-ATR stop, as the control.

### Timing study (`timing.py`, `derived_ta_conditional_strategies_600_ticks_season_*`)

| | MNQ 2019-2025 | NQ 2010-2025 |
|---|---|---|
| Realised volatility, median session, overnight vs RTH | 51 vs 75 bp | 45 vs 65 bp |
| Range, median session | 562 vs 835 ticks | 105 vs 165 ticks |
| Efficiency x sqrt(minutes) (length-matched) | 0.91 vs 1.02 | 0.81 vs 0.90 |
| FOMC day, RTH volatility vs trailing median | +36% (t 7.2) | +23% (t 6.6) |
| Day before a holiday, RTH | -7% | -16% |
| Year-on-year profile correlation, by part | 0.90-0.99 | 0.85-0.99 |
| Causal profile, out-of-sample R^2 of log volatility | whole session 28-56%; within RTH 6-15% | 26-42%; within RTH up to 14% |

**Reading the ETH row.** Overnight is calmer, and after length matching it is about 10% less trending. Both parts are near
a random walk: overnight VR(5) is only 2-6% below 1.

**Around events** (multiple of the -60..-31 minute baseline):
- the 08:30 ET release minute is 10.9x (MNQ);
- the FOMC statement is 10.8x, and still 3.7x an hour later;
- the RTH open is 3.2x, London 2.0x, Tokyo 1.7x;
- the 06:30 bucket is 3.5x the session's average minute.

### Round 5 (`round_5_20260929T195018`, MNQ 5m, tuned on prior years, tested 2022-2025)

| Template | Net ticks/day | Excess over matched random (t) | Trades/day |
|---|---|---|---|
| seasonal_breakout_rth | **+22.8** (net t 1.78) | +26.1 (2.11) | 1.55 |
| atr_breakout_control_rth | -0.4 | +16.8 (1.16) | 4.6 |
| event_breakout_rth_open | +3.9 | +3.4 (0.35) | |
| seasonal_fade_rth | -1.4 | +1.3 (0.32) | |
| event_breakout_london_open | -8.1 | -3.4 | |
| event_breakout_us_data_0830 | -8.2 | -7.6 (-2.09) | |
| seasonal_fade_eth | -12.0 | +0.7 | |
| seasonal_breakout_eth | -39.9 | -23.4 | |
| atr_breakout_control_eth | -51.7 | -19.0 | |

**Robustness.**
- The seasonal RTH breakout's excess by year is +6.0, +4.1, +53.6 and +40.7.
- 70% of its exits are the falling-volatility signal and 4% the target.
- Its top 10 days are 69% of its net.
- Paired net against its control: +23.2 (t 1.32). White Reality Check over the 9 templates: p 0.196.

### Pre-registered confirmation on NQ 2010-06..2019-06 (rounds 6-7, frozen at the 2025-fold parameters)

- **Round 6, `seasonal_breakout_rth`: NOT CONFIRMED.**
  - Excess +2.2 (t 1.21; trimmed t 1.65); all 4 sub-periods positive.
  - -11.8 net ticks/day.
- **Round 7, `atr_breakout_control_rth`:** excess -0.4, -27.6 net.
- **The pre-registered paired net difference passes: +15.9 ticks/day, t 6.24, in all ten years.** On excess the difference
  is only +2.6 (t 1.1). The time conditioning mainly saves costs, trading 2.3 instead of 5.2 times a day. It does not
  improve direction.

### Review (the `reviews` table of round 5)

**No look-ahead.** A truncation test of 1,095 checks was identical before the cut for every new series, entry, plan and exit.

**Four defects, all in the descriptive tables, all fixed. None of the four entered rounds 5-7.**
- Unscheduled FOMC statements were counted as scheduled.
- Release coverage was tracked globally rather than per group.
- Month-end and holiday flags were read from the next data row.
- The ETH/RTH efficiency ratio was not matched for session length.

**Verdict.** 600 net ticks a day on one contract remains out of reach: the best out-of-sample template reaches 3.8% of it.


## Round 8 (seasonal and order-flow gates on the confirmed strategies) and round 9 (ES confirmation)

**Order flow.** The source is tick-rule signed volume per contract per minute: `derived/multimodal_orderflow`, recipe
`tick_rule_1s_v1`, built from 1-second bars.
- **How it is read:** joined to the rebuilt minutes on (minute, contract), and readable only before 2025-07-01, the multimodal
  project's locked holdout.
- **New series:** `{"flow": "imbalance" | "imbalance_zscore", "minutes": k, "window": n}`.
- **Checks:** a truncation test was identical on 14,453 bars, and the join matches 100% at shift 0.
- **What it measures:** 15-minute imbalance correlates 0.58 with the same bar's return and 0.003 with the next. It largely
  re-encodes the bar's own move.

**Round 8** (`round_8_20260930T022558`, MNQ 15m, tuned per fold on prior years, tested 2022-2025H1, 903 session days):

| Template | Net ticks/day | Excess (t) | Win | PF |
|---|---|---|---|---|
| momentum_two_to_one_control (round-2 momentum, tuned breakeven) | +24.1 | +24.3 (2.61) | 39.9% | 1.40 |
| seasonal_breakout_rth | +22.0 | +22.2 (1.78) | 45.8% | 1.19 |
| level_breakout_momentum | +16.0 | +10.9 (1.35) | 36.1% | 1.15 |
| seasonal_momentum_rth | +15.7 | +13.3 (1.60) | 41.6% | 1.33 |
| seasonal_breakout_flow_rth | +14.4 | +14.7 (1.83) | 46.8% | 1.22 |
| seasonal_momentum_flow_rth | +10.6 | +12.1 (1.52) | 43.2% | 1.21 |
| seasonal_level_breakout_flow_rth | +7.3 | +9.0 (1.15) | 43.1% | 1.08 |
| seasonal_level_breakout_rth | +5.2 | +6.5 (0.78) | 42.3% | 1.05 |

**How fragile the lead is.**
- **The momentum control's lead is 2025-H1:** 43% of its net, and one day, 2025-04-09, is 17%.
  - 2023 lost: -4.6/day, PF 0.83.
  - Without its top 10 days: +8.3/day, win 37.6%, PF 1.14.
  - Without 2025: +15.9/day (t 1.88).
- **The White Reality Check is fragile:** p 0.048 over the 8 templates, 0.036-0.053 by seed and block, and 0.18 without the
  momentum control.
- **Deflated Sharpe:** 0.845 over the templates and 0.224 over 1,967 distinct trials.

**Paired comparisons.**
- The seasonal variants (gate, wider window, expected-move stop, volatility-fall exit) did not beat their originals: momentum
  -8.4/day (t -0.88), level -10.7 (t -0.86).
- The flow gate did not help: -5.1, -7.6, +2.1 (all |t| < 1).

**Round 9** (`round_9_20260930T023710`, pre-registered): the momentum control, frozen at its 2025-fold parameters (move 1.75
ATR, RSI 58, stop 2.5 ATR, breakeven 1.25R, 2R target), run once on **ES 2010-06..2025-06 at MES costs**.
- **Result: NOT CONFIRMED.**
  - Excess -0.04 ticks/day (t -0.09); win 34.1%, PF 0.74, -1.8 net/day.
  - Sub-periods: +0.6, +0.3, -0.1, -1.0.
- **Correction from the review:** that control is the round-2 momentum template with a tuned breakeven, not the round-3 frozen
  spec, which had no breakeven. The description is fixed.
- **Reading:** the MNQ momentum edge does not transfer to the S&P 500.


## Multi-timeframe cascade, volume at levels, volatility indicators, level-bounce exits (rounds 10-11)

**The user's rule.** Support and resistance per timeframe (1m, 5m, 15m, 30m). A 1-minute close passing the 1m support, then the
5m, then the 15m, then the 30m is a downtrend; the mirror for resistance is an uptrend. Trade it long and short, many times a day,
through ETH and RTH, with volume, volatility and momentum confirmations combined, and close with profit when the next support or
resistance is reached and price bounces. One contract, one position at a time, no pyramiding.

**What was built** (`src/ml/ta_strategy/cascade.py`, `cascade_study.py`, `engine.py` trail bit 4).
- **Swing levels per timeframe:** Williams fractals (k = 3 on 1m and 5m, 2 on 15m and 30m), known only at the close of bar i + k,
  broken on the first 1-minute close beyond them by 0.1 x ATR(15m), otherwise retired at an age cap. MNQ 2019-2025: 394,863 (1m),
  83,507 (5m), 40,386 (15m), 20,456 (30m) levels; 81-84% are broken before their cap.
- **The cascade stage:** read top-down along the chain. Stage s is on when the stage-s timeframe's last break is in that direction and
  recent, at the minute it broke the next-lower timeframe's last break was in that direction at a level not beyond it, and so on down
  to the 1m level. `stage_up`, `stage_down`, `direction`, and an unordered `aligned` count as the control.
- **Volume:** a causal time-of-day volume profile (mean minute volume of the same 5-minute bucket over the previous 20 sessions);
  relative volume of the last k minutes and its OLS trend.
- **Level-bounce exit:** the next opposing zone (from the 5m/15m/30m swing levels) is a level, not a limit. Once price reaches it a
  trailing stop `bounce_ticks` from the running extreme is armed, so the trade closes with profit when price bounces.
- **Series available to any template:** `{"cascade": stage_up | stage_down | aligned_up | aligned_down | direction | broken_level_up |
  broken_level_down | minutes_since_break}`, `{"volume": relative | trend}`.

### The cascade study (`cascade_*` tables, MNQ 2019-06..2025-12 and NQ 2010-06..2019-06)

**Does the cascade point the way?** At the minute a cascade FIRST reaches a stage, the move over the next 60 minutes in the
cascade's direction (ticks; + = with it), its excess over the unconditional drift, and a session-block bootstrap 95% interval on
that excess (each drawn session weighted by its draw count; horizons kept inside the session):

| Stage, direction | MNQ, all hours | MNQ, regular hours | NQ 2010-2019, regular hours |
|---|---|---|---|
| 4 up (0.8-2.4 a day) | +6.5, excess +5.0 [-0.8, +10.0] | +15.0, excess +13.0 [-0.8, +27.4] | +1.8, excess +1.2 [-1.2, +3.6] |
| 4 down | +2.8 (with the cascade), excess +4.4 [-2.2, +10.9] | +7.8, excess +9.7 [-4.8, +22.8] | +2.1, excess +2.7 [-0.9, +6.4] |
| 2 down | -4.4 (against it), excess -2.9 [-5.9, +0.5] | -2.4 | -0.1 |
| 1 and 3 | within +/- 3 of drift | within +/- 5 | within +/- 2 |

The cascade fires often (3-11 stage-1 events a day, 0.7-2.5 stage-4 events). A full 4-stage cascade leans its own way by about
4-5 ticks at 60 minutes in both directions, but no cell is distinguishable from zero, the largest MNQ regular-hours cell is 0.8
events a day with an interval from -1 to +27, and on NQ 2010-2019 the same cell is +1.2 [-1.2, +3.6]. The test can only see effects of about
10 ticks or more (the mean absolute 60-minute move is ~110 ticks), so the data cannot rule out an edge as large as the 6.56-tick
round trip; it shows none.

**Does volume decide whether a level holds or breaks?** Barely. Spearman of the approach's relative volume with breaking is
+0.018 (MNQ) and +0.015 (NQ); once the approach's own range is taken out it is +0.002 / -0.003, nothing. The volume TREND keeps a
small residual, +0.02 given range: the break rate rises from 43.5% in the lowest trend decile to 50.8% in the highest (Wilson
intervals clear the shuffled-volume line in most deciles), a 7-point spread that cannot pay a 6.56-tick round trip. Volume
tracks range (+0.40 / +0.35) and range tracks breaking (+0.04): volume is mostly a volatility proxy here.

**Which volatility measure anticipates the next hour?** Against the next hour's range in ticks, every level measure does:
ATR(14) 0.77, Parkinson 0.74, NATR 0.72, realised volatility 0.70, Bollinger bandwidth 0.44, and the time-of-day expected move
best at 0.84 (MNQ). Against the range RELATIVE to the current ATR (does volatility change from here?) only the time-of-day ratio
is positive (0.50 MNQ, 0.48 NQ; 0.56 overnight, 0.28 in RTH); bandwidth, squeeze, ADX, choppiness and volume are at |rho| <= 0.05. Nothing predicts
follow-through in the cascade's direction (|rho| <= 0.02).

**The delayed-oracle ceiling** (enter at each confirmed swing, exit at the NEXT swing's exact price with hindsight, counting
only exits that print after the entry, skip losers, pay the round trip): MNQ 2019-2025 5,472 net ticks/day on the 1m ladder (110 trades/day),
2,796 (5m), 2,009 (15m), 1,446 (30m), so 600 needs 11-42% of a perfect-exit oracle for swing-anchored trading. NQ 2010-2019 at
2,000-7,000 points: 721 (1m) down to 278 (30m), so there 600 needs 83-216% of the ceiling. The figures are the `cascade_oracle`
table of recipe `cascade_20260929d`.

### Round 10 (`round_10_20260930T050100`, MNQ 5m bars, tuned per fold on prior years, tested 2022-2025, one contract)

| Template | Trades/day | Net ticks/day | Win | PF | Median hold |
|---|---|---|---|---|---|
| cascade_trend (whole session) | 5.2 | -32.1 | 36% | 0.74 | 4 min |
| cascade_aligned_control (unordered) | 10.1 | -65.2 | 32% | 0.73 | 6 min |
| cascade_trend_rth | 2.5 | -19.6 | 22% | 0.84 | 6 min |
| cascade_trend_volume | 17.8 | -120.9 | 27% | 0.76 | 6 min |
| cascade_trend_momentum (RSI + signal + MACD side) | 8.8 | -77.9 | 36% | 0.79 | 9 min |
| cascade_trend_momentum_cross (histogram and RSI crossings) | 6.8 | -53.6 | 33% | 0.74 | 6 min |
| cascade_trend_full (every confirmation) | 0.5 | -6.8 | 39% | 0.74 | 15 min |
| cascade_trend_full_rth | 0.2 | +0.4 | 27% | 1.02 | 11 min |

Every template nets -6 to -9 ticks per trade, about the round trip: the 1-minute breaks that start a cascade resolve within minutes.
The volume-confirmed entries beat matched-random entries by about 2 gross ticks per trade (t 3.9, 4 of 4 folds), a third of the
cost, so they net -121/day; that is the whole of the Reality Check's p 0.002. The aligned control as run had no recency window and
a degenerate opposite-cascade exit (fixed in code afterwards), so the ordered-vs-unordered comparison only says both lose about the
round trip per trade.

### Round 11 (`round_11_20260930T051645`, MNQ 1-minute bars, unlimited entries, level-bounce exit)

| Template | Trades/day | Net ticks/day | PF | Level-bounce exits |
|---|---|---|---|---|
| cascade_bounce_1m | 3.5 | -24.6 | 0.73 | 23% |
| cascade_limit_1m_control (limit at the level) | 2.9 | -21.6 | 0.72 | - |
| cascade_bounce_1m_rth | 1.0 | -3.8 | 0.89 | 20% |
| cascade_bounce_1m_volume | 12.2 | -94.4 | 0.67 | 19% |
| cascade_bounce_5m | 2.2 | -17.2 | 0.71 | 20% |

What the exit does, on all 3,583 entries of `cascade_bounce_1m`: 23% reach the next level and close on the bounce at +49.6 ticks
on average (median +30); 47% hit the stop first, at -51.0 and a median of 3 minutes; 66% end in a losing exit. Reaching the level
before the stop happens 33% of the time; break-even needs 51%. (The 89% win rate of the bounce exits themselves is conditional on
having reached the level and is not the exit's edge.) Wider stops, 0.75-2.5 ATR, leave the reach share at 20-23% and the sign
unchanged (-21.7 to -27.7); stage-4-only regular-hours long versions and 27 variants in all are negative (best -1.4/day). At equal
parameters and identical entries the bounce and the limit exit differ by about -0.5 ticks/day (|t| < 1); the ordering is not
identified at 1-minute resolution, because a bounce inside the arming minute fills at the next open (bounds -27.2 to -15.4
against the limit's -21.6), and settling it needs the lake's 1-second bars. Round 4's finding holds: more trades per day means
fewer net ticks (12 a day lost 94; 1 a day lost 4).

**Review** (three skeptics; the `reviews` table of round 10). No look-ahead: 186 series x cut pairs identical on real MNQ minutes.
Five measurement defects found and fixed before the final tables landed: the session bootstrap ignored duplicate draws (intervals
~22% too narrow), horizons could cross the session end, the oracle credited exits printed before entry (14-17% of its ceiling),
level tests began on the minute a level became known, and the range outcome was divided by ATR (which hid that ATR predicts range
at 0.77). One reading error corrected: a positive value in a down-cascade row means price FELL (with the cascade).

**Verdict.** 600 net ticks per session day on one contract is a forecasting limit, not a market-capacity limit: the market offers
1,400-5,400 ticks a day to a perfect-exit oracle, and every causal rule tested, including this multi-timeframe cascade with every
confirmation the user named, captures none of it after costs.

**Next:**
- add order-flow and book information;
- size and stack uncorrelated books;
- keep specs frozen;
- forward-test the momentum spec on 2026 data (the `reviews` table for round 3).

**Earlier next step (model rounds): a pre-registered test of a different family:**
- range-forecast-gated trading on predicted big-move sessions, or the 09:30 ET opening-range breakout;
- run on NQ from 2010 for power;
- with contract sizing only after an edge clears the joint-bootstrap line.

## Trading AT the multi-timeframe zones (rounds 12-13)

The user asked how the multi-timeframe support/resistance zones can be used for profit. Rounds 3-11 traded THROUGH
levels (breakouts, cascades) and lost; this round trades AT them: a touch that closes back away from the zone, a stop
beyond the zone, a target at an R multiple or at the next opposing zone, optionally the level-bounce exit at that zone.
Code: `src/ml/ta_strategy/zones.py` (the touch study), `zone_study.py` (the landing), templates `zone_*` in
`src/config/ta_conditional_templates.json`, rounds 12-13 with their falsifiers in `src/config/ta_conditional_rounds.json`;
notebook section 14. Every number below is out of sample or measured against a matched null on real MNQ / NQ minutes.

### How a zone is built, on the candles (notebook section 15)

Section 15 of `notebooks/ta_strategy_600_ticks.py` rebuilds `levels.zones_for_bars` for one session from the lake's rebuilt
minutes and shows every step: the level events of the chosen families while they are known and valid, the 5m / 15m / 30m
candles with the support (blue) and resistance (orange) band each bar hands to the next, a bar slider with the price ladder at
that bar (levels in reach sorted by price, the gap that cuts them into zones, strength = distinct families, the nearest zone below
the close = support, above = resistance) with the merge rule rendered and every symbol's current value, dials for the merge gap
w (default 0.25 ATR, floor 4 ticks) and the reach r (default 6 ATR; `zones_for_bars(reach_atr=...)`), and a button that draws the
session's four zone edges and its level events on the dashboard's Market chart through the chart link (source `zones_how`; the
roll offset between the back-adjusted series and the chart's raw prices is measured on the session's bars and removed).

### The zone-touch study (`zone_touches`, `zone_summary`, `zone_leak_check`; recipes `zones_20260930b_{MNQ,NQ}`)

A zone is what `levels.zones_for_bars` builds at each 5m bar close (every level family plus the 5m/15m/30m swing levels,
single-linked, strength = distinct families); the zones of bar b are used on the minutes of bar b + 1. A TOUCH is the first
minute whose low enters the support zone from above (mirror at resistance), one per 0.25 ATR of near edge per side and
session (the first run keyed touches by the exact edge and a drifting VWAP band re-counted the same zone every bar: 115 a day
became 40 after the review). **Bounce** = 1 ATR away from the edge before a close through the far edge; **next zone reached** =
the opposing zone's near edge first. Each is compared with the same test on a pseudo level at the same signed ATR distance,
same time of day, in a random other session (10 permutations; the pseudo race starts where the pseudo level is first tested;
pseudo gap-throughs excluded; same window after the test). Paired lifts get a session-block bootstrap (1,000 draws, p with the
(k+1)/(B+1) floor) and Benjamini-Hochberg at q = 0.10 over the 32 conditioned cells (the cells are nested subsets of one
population, so a survival count is not a count of independent effects). A deliberately leaky arm applies the touch bar's own
zone to its own minutes and must bounce more.

| | MNQ 2019-06..2026-01 | NQ 2010-06..2019-06 |
|---|---|---|
| First touches | 68,604 (40.3 a session day), 95% resolved, 0.5% gapped through | 82,184 (35.6 a day), 96%, 1.3% |
| Bounce vs matched random | 0.550 vs 0.549, lift **+0.000 [-0.003, +0.003]** | 0.542 vs 0.541, lift +0.001 [-0.002, +0.004] |
| Next zone reached vs matched pair | 0.484 vs 0.482 (+0.005) | 0.419 vs 0.403 (+0.017; every one of the 32 reach cells survives BH: one uniform shift) |
| Bounce lift by strength 1 / 2 / 3+ | +0.004 / -0.003 / -0.009 [-0.018, +0.000] | +0.004 / +0.003 / -0.008 [-0.015, -0.001] |
| Strength trend (Spearman, exact p) | rho -1.00, p 0.33 | rho -1.00, p 0.33 |
| Cells surviving BH (bounce / reach) | 5 / 14 of 32 | 4 / 32 of 32 |
| Break-even hit rate of the exact-edge bracket (median) | 0.332 (S about 10 ticks, T = next zone) | 0.637 (favourable median 5 ticks: the 4- and 8-tick floors bind on a 6-tick ATR) |
| Oracle zone-to-zone ceiling, all touches / one position | 1,061 / **826** ticks a day on 23 touches (RTH 490 / 387 on 7.7) | 169 / 129 on 11.7 |
| Leaky arm | 0.601 vs 0.550 honest | 0.608 vs 0.542 |

Reading: the zones carry **no location information at the honest touch** (F1 falsified on MNQ, where the interval is
[-0.003, +0.003] around zero), stronger zones bounce LESS (F4: the gradient is negative on both markets, and with three
buckets the smallest exact p is 1/3), and the +0.02 next-zone lift on NQ is one pooled shift that appears in every subset.
On MNQ the paper bracket at the exact edge (0.484 reached against a 0.332 break-even) would pay; nothing that fills at the
next open after a close-back, with a stop 0.25 ATR beyond the far edge, gets that geometry, which is what round 12 measures.
The one-position oracle (take a touch only when the previous one has resolved, exit at the best price before the break,
skip every loser, pay every cost) is 826 ticks a day on MNQ: the zones offer 600 only to hindsight.

### Round 12 (`round_12_20260930T153253`, MNQ 5m, tuned per fold on prior years, tested 2022-2025) and round 13 (`round_13_20260930T153253`)

| Template | Trades/day | Net/day | Net/trade | Excess over matched random (t) | Hit | PF |
|---|---|---|---|---|---|---|
| zone_bounce (touch + close back, R target) | 11.5 | -86.7 | -7.5 | -2.4 (-0.23) | 0.37 | 0.80 |
| zone_touch_unconfirmed (E0: the touch alone) | 14.4 | -121.2 | -8.4 | -18.4 (-1.68) | 0.35 | 0.76 |
| zone_bounce_rth | 5.1 | -37.1 | -7.4 | +2.6 (+0.29) | 0.37 | 0.86 |
| zone_to_zone (limit at the next zone, room filter) | 2.1 | -17.5 | -8.5 | +3.3 (+1.49) | 0.14 | 0.55 |
| zone_to_zone_bounce_exit (trail armed at the next zone) | 2.1 | -16.0 | -7.7 | +6.1 (+2.57, 4/4 years) | 0.16 | 0.60 |
| zone_bounce_rsi | 3.7 | -27.0 | -7.2 | -1.5 (-0.39) | 0.19 | 0.68 |
| zone_bounce_calm (time-of-day volatility not rising) | 2.5 | -15.3 | -6.2 | +2.8 (+0.84) | 0.37 | 0.77 |
| zone_bounce_higher_timeframe (1h/4h/session level in the zone) | 17.3 | -140.0 | -8.1 | -9.4 (-0.74) | 0.35 | 0.80 |
| zone_break_control (through the same zone; sign check) | 8.3 | -73.0 | -8.8 | -33.6 (-2.51, 0/4) | 0.21 | 0.85 |
| zone_bounce_swings_only (round 13: 5m/15m/30m swings only) | 4.0 | -36.3 | -9.2 | -10.6 (-2.49) | 0.23 | 0.62 |

White Reality Check across the nine templates p 0.043 (round 13: 0.998). Every template nets between -6 and -9 ticks a trade
(F3 fired: the 95% interval of net per trade is [-9.9, -6.1] for zone_to_zone and [-9.4, -5.1] for the bounce exit). The two
zone-to-zone books beat their matched random-entry control by +3 and +6 ticks a DAY (t 1.5 and 2.6), and the numbers review
showed why: the null draws one bar per real signal and the room filter rejects fewer of its draws (2025: 4,334 of 5,046 real
signals rejected vs 4,123 null), so the null trades a third more often (2.76 and 2.82 a day vs 2.07) and loses the same
per trade (the harness's 24-seed null: -7.54 vs -8.45 on zone_to_zone, -7.81 vs -7.73 on the bounce exit; excess per trade
-0.91 and +0.08; the reviewer's 8-seed reproduction gave -0.40 and +0.35 with |t| < 0.35). The tuner
found that: it chose min_room_r 2.0 and min_strength 4 in 7 of 8 folds because the daily-excess Sharpe rewards rejecting
real signals. The Reality Check p detects the count difference, not profit; the harness now lands the null's trades a day and
the excess per trade beside the daily excess (`matched_null_trades_per_session_day`, `excess_ticks_per_trade`), and F2 is
read on them: no zone template beats a random entry with the same geometry per trade. The unconfirmed touch trades
more and loses more than the close-back entry; the breakout control loses more than the bounce (sign check passed; the
control's loss is mostly the round trip on an 8-trade day). The higher-timeframe filter is not a filter (17 trades a day: the
zone map almost always holds a session level or a 1h/4h fractal). Against the swings-only control the full map's zone_bounce
loses more per day (-86.7 vs -36.3, at three times the trade rate) and less against its own control (-2.4 vs -10.6): the extra
families add trades, not edge. Exit mix on `zone_to_zone_bounce_exit`: 283 level-bounce exits at +78.5, 981 stops at -35.6,
758 trailing stops at -6.3, 3 limit fills; the next zone is reached on 14% of trades and the geometry needs about 32%.

**Falsifiers, as pre-registered:** F1 (no location edge) fired on MNQ; F2 (geometry only) fired: per trade no template
beats its matched control, and the net lower bound is below zero on every template; F3 fired; F4 fired (negative gradient);
F6 not testable (no limit-fill arm was run; the study's exact-edge bracket is the ceiling); F7 fired for zone_to_zone (2025
carries 51% of its daily excess; per trade its excess is positive only in 2025) and net per trade is below zero in every year
for every template (best year -5.9); F8: 2.1 trades a day x any upper bound cannot reach 600; F9: the one-position oracle is
826 a day, so the zones do hold 600 for a perfect exit and every causal rule captures none of it; F10: every net is below
zero. F5 (NQ confirmation) was not run: nothing passed F2/F3 on MNQ, so there is no frozen configuration to confirm.

**Review** (two lens finders and 34 skeptics on the code, then a numbers review; the `reviews` table of round 12). Confirmed
and fixed before the rerun (then the numbers review found the per-day excess above to be the null's trade count, and the
per-trade columns were added and the round rerun): the far-edge signal exit could never fire (a zone is chosen around its own bar's close, so "close
through it" was unsatisfiable) and now reads the previous bar's zone; the breakout control's lagged signal exit fired on ~77%
of bars and was removed; touches were re-keyed by drifting VWAP bands (115 -> 40 a day); the oracle summed overlapping windows
(2,797 -> 1,061, and 826 with one position); the null kept pseudo gap-throughs and had a shorter window; bootstrap p could be
exactly zero; the strength trend p came from a t-distribution on three points (0.00 -> 0.33). Refuted or noted: the break-even
uses the exact-edge geometry the engine never trades (a lower bound on the tradable break-even; the verdict only strengthens);
NQ's 4- and 8-tick floors bind on its 6-tick ATR, so NQ zones are coarser in ATR units and an NQ confirmation would not be the
same strategy; the study's touch population is not the templates' entry population (only F2's matched control speaks to the
templates). Also found: the per-family level study inside `optimize.py` reported swing levels "held 0.95" because their test
window ended at the break that defines them; fixed for later rounds (`cascade.level_events` now tests to the age cap); the
round-12 `levels` rows still carry the old value.

**Verdict.** The multi-timeframe zones are places, not predictions: price bounces from a zone exactly as often as from a
random level at the same distance, stronger zones bounce slightly less, every way of trading at them loses 6-9 ticks a trade
after the 5.56-tick round trip, and per trade none of them beats a random entry with the same stop and target (the per-day
"excess" was the null trading more often). 600 a day is available to a one-position perfect-exit oracle (826) and to nothing
causal.

**Next:** the unspent information is inside the bar: a limit order resting at the zone edge (the exact-edge bracket pays on
paper, 0.484 reached against a 0.332 break-even) with a queue model on the lake's 1-second and tick data is the one test this
line has not run.

