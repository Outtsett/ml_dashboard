# Analytics page (`/analytics`)

Four questions about the symbol and timeframe on the Market chart, each a tab:

| Tab | Question | What it shows |
|---|---|---|
| Descriptive | What is happening? | Last close and window change; the price path; the eight numbers (plus the count) for return percent, bar range and volume, with a return histogram; mean absolute return and volume by hour; return per session day; articles and mean FinBERT score per day; the latest headlines; every Model Cycle run on the symbol |
| Diagnostic | Why is it happening? | Every move of 3+ trailing standard deviations with the first recorded cause beside it — a reopen after a session gap, news in the previous 60 minutes whose FinBERT tone points the way the price moved, the session open (06:30–06:45 Pacific for futures, London 07:00 / New York 13:30 UTC for forex), a volume surge (3x the median of the previous 100 bars) — the share each cause explains, the hours and weekdays where 2-sigma moves are likelier than on any bar (lift), whether bars move more in the hour after news, and where the latest model run made and lost money (by side, exit reason, entry confidence and hour) |
| Predictive | What will happen? | The state at the last bar (volatility: the last 20 bars' standard deviation against its median over 500; trend: the close against 50 bars ago) and how often each outcome followed that state within the horizon in the symbol's own history: closes higher, beats the round-trip cost up / down, a one-standard-deviation rise / fall, each with its Wilson 95% interval; the forward-move histogram with 10th / 50th / 90th percentiles; every state against all bars; the latest model's P(up) and what that probability meant in its calibration record |
| Prescriptive | What should we do? | Pick a goal (most expected profit per trade, highest chance a trade wins, best reward for the risk taken): the action for the next horizon (long, short or flat) with the reason in numbers, each action's expected result after the round trip, 10th / 90th percentiles, chance of profit and half-Kelly size; the Model Cycle run that best served the goal, the entry-confidence levels that earned a positive expectancy over 20+ trades, and the hours where that run's positions lost money |

## Where the numbers come from

- **Bars** — the chart's own series (`getOHLCVSampleBy`, futures roots front-month stitched), the newest 5,000 / 20,000 / 50,000 bars before the symbol's last bar. The lake's history ends 2025-12-30 (futures) and 2026-03-26 (forex); the page states its window.
- **News** — `s3://curated/news_articles` (root = the symbol) joined to FinBERT scores in `s3://curated/news_sentiment`, re-stamped onto the bars' clock (futures: Pacific wall clock as UTC). One GDELT week (2025-12-15 → 12-22) plus what the live hub lands, so news covers a few days of any window.
- **Model Cycle runs** — `derived_model_cycle_runs_{runs,trading_metrics,calibration_bins,predictions}` for the symbol.
- **Costs** — `src/config/cost_model.json` round trip (MNQ $2.78 = 1.39 points). Forex has no entry: its prescriptive tab works in points before costs and says so.

## Rules the calculations keep (`src/shared/analytics/compute.ts`)

- Futures roots are front-month stitched and **ratio back-adjusted at every roll** (`getStitchedOHLCV(..., "ratio")`): raw spliced prices read the MNQZ5 → MNQH6 roll as a +0.98% move at z 38.
- News counts at the time it was **known**: a GDELT row at its 15-minute bucket + 15 minutes (`docs/finbert.md`). A move is credited to news only if the article was known before the bar closed and its FinBERT tone points the way the price moved.
- **Intervals use the independent cases**: forward windows of the horizon overlap, so n windows carry about n / horizon independent outcomes; every Wilson interval is computed on that (`effectiveTotal`). At MNQ 5m, horizon 12, P(up) 0.525 is [0.477, 0.572], not the [0.511, 0.539] the overlapping count would claim.
- A **gap** is a silence of 3+ bar intervals, or an hour-long halt that is 1.5+ intervals (the CME 14:00–15:00 Pacific break on 1h bars). A **session open** is credited to the bar that contains the open's first 15 minutes (futures 06:30 Pacific; forex London 08:00 and New York 09:30 local, so daylight saving moves with the city); never on daily bars.
- The news comparison ("bars move more after news") only uses bars inside the span the news record covers, and gives no ratio unless each side has 100+ bars — GDELT sweeps every 15 minutes, so inside its week almost every bar follows an article.
- **Model Cycle runs** are read for the symbol AND the timeframe; a run ranks for a goal only with 20+ trades.
- **No cost model, no trade**: forex has no entry in `cost_model.json`, so every goal says no trade is recommended and the moves are shown before costs.
- The page says how old its newest bar is: the lake ends months ago for every symbol, so "now" means that bar.

- Causal: every trailing statistic uses only the bars before (or at) the bar it describes; a window not yet full is null, never zero. `tests/shared/analytics.test.ts` re-runs the frame on a truncated series and requires every early value to be identical.
- A silence longer than 3x the typical bar interval is a session gap: the return across it stays out of every distribution, and no forward window crosses it.
- Probabilities are frequencies in the symbol's own history, with Wilson 95% intervals; the prescriptive tab stays flat when no side's expected result beats the round trip.

## Code

`src/shared/analytics/{types,compute}.ts` (pure), `src/server/analytics/{sources,analytics.router}.ts` (`GET /api/analytics?symbol=&timeframe=&bars=&horizon=`, cached 5 minutes), `src/client/src/analytics/` (page and one panel per tab). Tests: `tests/shared/analytics.test.ts`, `tests/server/analyticsRoute.test.ts`.
