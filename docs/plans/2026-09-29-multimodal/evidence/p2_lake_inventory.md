DATA INVENTORY OF THE LAKE (MNQ multimodal), measured 2026-09-29. All numbers come from read-only SQL through `POST /api/databases/query`, except the spool file listing, which came from a directory listing.

## Findings that change training design

1. **Two clocks in one lake.**
   - **Test:** for MNQH5, the Iceberg `bars` `ts` equals `ohlcv_1m.timestamp` plus 7 h in March 2025 and plus 8 h in January 2025. Matching close and volume: 5520 of 5520 rows in March, 5070 of 5070 in January. At offset 0 nothing matches.
   - **`bars`** (1s, 1m, 1h, 1d) is true UTC. CME's break is hour 21 in March 2025 (591 rows against about 2400 in a normal hour).
   - **All `ohlcv_*`, `ohlcv_full_*`, `mnq_*`, `candle_anatomy*` and `derived_labels`** use Pacific wall clock stored as UTC. Hour 14 is empty in the `ohlcv_1m` and `ohlcv_full_1m` views.
   - **Not measured:** the derived MNQ tables (`candle_anatomy`, `mnq_indicators_norm_1m`) share the 2019-05-05 15:03 first stamp with `mnq_ohlcv_1m` (Pacific wall clock, not UTC). I did not test the other derived tables.
   - **Forex** (`bars`, OANDA) is true UTC (week opens 22:00 Sunday UTC).
   - **Rule:** join across sources only after normalising.
2. **The "MNQ 1m dense only 2024-03 → 2025-12" note is only true of the capped `ohlcv_1m` family.** MNQ 1m is dense from 2019-05-05 through 2025-12-30. Sources: `ohlcv_full_1m`, `mnq_ohlcv_1m` (stitched bare root `MNQ`) and `bars`. `bars` covers 2020-12-31 onward, with 1s from 2019-05-05.
3. **MNQ price data ends 2025-12-30.**
   - **Partial days after that:** `bars` and `ohlcv_full_1m` have 5 thin days in 2026 (03-02, 03-24 through 03-27; 584 minutes).
   - **Live spool:** `derived_live_bars` (Yahoo, 1m) has MNQ only for 2026-09-21 → 09-28, 7 days.
   - **Training gap:** 2026-01 → 2026-09-20 is missing for every futures root.
4. **Order flow is essentially absent.** `vol_at_bid`, `vol_at_ask`, `trades`, `trades_at_bid` and `trades_at_ask` are non-null for MNQ on one session only, 2026-03-27 (19 one-minute rows, 7 five-minute rows). Every other root has 0 non-null rows, in `bars` too.
5. **News covers 0.35% of MNQ session days:** 6 of 1718 (see section 4).

## 1. Price coverage

### 1a. `bars` (Iceberg, 882,665,821 rows; true UTC)

`bars` timeframe mix: 1s 817.6M, 1m 62.9M, 1d 2.02M, 1h 110k. There are no 5m, 15m or 4h rows in `bars`.

**1m futures** (SQL: `SELECT root, year(ts), count(DISTINCT ts), count(DISTINCT CAST(ts AS DATE)) FROM bars WHERE timeframe='1m' AND asset_class='futures' GROUP BY 1,2`):

| root | first | last | contracts | distinct minutes per year, 2021–2025 |
|---|---|---|---|---|
| MNQ | 2020-12-31 | 2026-03-27 | 25 | 353k, 354k, 353k, 355k, 351k |
| NQ, ES, MES, RTY, M2K, YM, MYM | 2020-12-31 | 2025-12-30 | 22–26 | see below |

- **Days per year:** 310–313.
- **Minutes per active calendar day:** about 1130–1142 for MNQ, NQ, ES, MES and YM, out of a possible 1380 (about 82%). Minutes with no trade have no bar.
- **Thinner roots:** RTY runs about 1097–1116 and M2K about 1072–1129 minutes per day.
- **Spreads:** `asset_class='spread'` rows are also in the table (MNQ 50,641 1m rows).

**1s futures** (first stamps; all end 2025-12-30):

| root | first | rows |
|---|---|---|
| MNQ | 2019-05-05 | 201.3M |
| NQ | 2010-06-06 | 143.6M |
| ES | 2010-06-06 | 154.3M |
| YM | 2010-06-06 | 99.5M |
| RTY | 2017-07-09 | 52.5M |
| MES | 2019-05-05 | 79.3M |
| M2K | 2019-05-05 | 35.4M |
| MYM | 2019-05-05 | 42.7M |

**1d futures:** MNQ, NQ, ES, MES, RTY, M2K, YM and MYM run 2020-12-31 → 2025-12-30, 1556 days each. The `ohlcv_1d` view goes back further: ES, NQ, YM from 2016-01-03; RTY from 2017-07; MES from 2017-03; MNQ, M2K, MYM from 2019-05.

**Cross-asset** (all from vendor yfinance, continuous; source of the 1d/1h rows: `bars`):

| root | 1d | 1h |
|---|---|---|
| ZN, ZB, ZF | 2000-09-21 → 2026-09-18, about 6530 rows | 2024-04-26 → 2026-09-18, about 13.7k rows |
| ZT | 2000-06-02 → 2026-09-18 | same 1h range |
| GC, SI, HG | 2000-08-30 → 2026-09-18 | same 1h range |
| DXY (index) | 2000-01-03 → 2026-09-18 | same 1h range |

- **Rates and dollar series:** FRED `derived_fred_daily_series`: DGS2, DGS5, DGS10, DGS30 (from 1962/1976/1977 → 2026-09-17), DTWEXBGS (2006 → 2026-09-11).
- **Not in the lake:** CL, 6E, VIX and 6J/6B/NG. `symbols` and `ohlcv` return 0 rows for them.
- **Intraday cross-asset for ZN, GC and the rest:** only Yahoo live 1m from 2026-09-21 (`derived_live_bars`).

**Forex** (OANDA, `bars` 1m, 18 pairs, true UTC):
- **Coverage:** 2020-01-01 → 2026-08-26.
- **EURUSD, USDJPY, GBPUSD:** about 0.81–0.82 of 1440 minutes on active days each year. Each has 311–314 active days per year.
- **Older snapshot views:** `fx_ohlcv_1m` stops 2026-01-05 (CHFJPY, EURAUD, NZDJPY stop 2025-03-11). Use `bars` for forex.
- **Live:** OANDA 1m from 2026-09-14 in `derived_live_bars`.

### 1b. Views (Pacific wall-clock-as-UTC)

- **`ohlcv_1m`, `ohlcv_5m` and `ohlcv_15m`:** 2024-03-01 → 2025-12-30. The MNQ tail runs to 2026-03-27.
- **`ohlcv_30m` and `ohlcv_1h_v`:** from 2023-03-01.
- **`ohlcv_4h`:** from 2021-01-03.
- **`ohlcv_1d`:** from 2016 or 2019, per root (see 1a).
- **`ohlcv_full_1m` and `ohlcv_full_5m`** (per contract, no order flow):

| root | first |
|---|---|
| ES, NQ, YM | 2010-06-06 |
| RTY | 2017-07-09 |
| MNQ, MES, M2K, MYM | 2019-05-05 |

- **`mnq_ohlcv_1m`** is the stitched bare root `MNQ`:
  - **Rows and range:** 2,344,645 rows, 2019-05-05 15:03 → 2025-12-30 15:59.
  - **Coverage:** RTH presence is 98.1–98.8% of 390 minutes per RTH day (171 to 259 RTH days per year); the full session is 79.9–82.8% of 1380 minutes.
  - **`mnq_ohlcv_5m`:** 469,851 bars. RTH share of 78 bars per day is 97.9–98.8% for 2019–2025; the full session is 81.2–82.8% of 276.
  - **Density:** thinnest year 2019, 79.9% (1m) and 81.2% (5m).

### 1c. Stitching and rolls

- **Front-month rule:** highest daily volume among dated contracts. Spreads never lead; a dated contract beats the bare root; ties are broken by symbol name (`marketData.ts` lines 271–310; served by `getFrontMonthOHLCV` / `getStitchedOHLCV`).
- **Adjustment:** `mnq_ohlcv_*` is raw traded prices spliced at rolls, not back-adjusted. The Model Cycle back-adjusts additively in `src/ml/cycle/rolls.py`: +241.75 points at 2025-09-15 and +256.75 at 2025-12-15.
- **MNQ roll dates** (daily-volume leader change, `bars` 1d): 20 rolls from 2021-03-14 to 2025-12-16. The dates fall on the second Monday of the roll month, before the third Friday. The 2021–2023 rolls carry Sunday dates (03-14, 06-13, 09-12), the Sunday evening session.

| Year | Roll dates |
|---|---|
| 2021 | 03-14, 06-11, 09-10, 12-10 |
| 2022 | 03-13, 06-12, 09-12, 12-12 |
| 2023 | 03-12, 06-12, 09-11, 12-11 |
| 2024 | 03-11, 06-17, 09-16, 12-17 |
| 2025 | 03-18, 06-16, 09-16, 12-16 |

- **NQ rolls:** the same 20 rolls. They differ by a day at 2021-06-13, 2021-09-12, 2022-06-13, 2023-03-13, 2025-09-15 and 2025-12-15.

### 1d. NQ vs MNQ, bar for bar (same expiry, all contracts, 1m, `bars`)

| year | pairs | close equal | mean abs diff (pts) | within 0.5 pt | MNQ/NQ volume ratio |
|---|---|---|---|---|---|
| 2021 | 430,625 | 31.1% | 0.54 | 83.9% | 1.76 |
| 2022 | 442,796 | 24.2% | 0.80 | 76.2% | 2.12 |
| 2023 | 438,969 | 30.9% | 0.54 | 84.4% | 1.69 |
| 2024 | 451,498 | 25.9% | 0.72 | 77.7% | 2.23 |
| 2025 | 443,224 | 21.2% | 0.98 | 70.1% | 2.90 |

- **Returns:** the 1-minute return correlation is 0.939–0.947 for 2021–2025 (0.98 in the 2020 sample). This includes non-front contracts. The 2020 sample is a single day.
- **Max close difference:** up to 291.75 points, at roll edges or on illiquid contracts.
- **Conclusion:** NQ is not a bar-for-bar substitute for MNQ. It works as a correlated proxy, or as a longer-history feature. NQ 1s/1m reaches 2010-06; MNQ starts 2019-05.

## 2. Order flow and other rich tables

- **Rich columns in `bars` (MNQ):** `vol_at_bid`, `trades` and `bid_close` counts are 0 on 1s, 1m and 1d (SQL: `count(col)` per timeframe). Vendor is `databento` for all MNQ rows.
- **Rich `ohlcv_<tf>` family:** non-null `vol_at_bid` only on 2026-03-27 06:00–06:58 (19 one-minute rows, 7 five-minute rows).
- **live_source quotes** (Iceberg, `lakehouse/6e6…/data`): 15,775,688 rows, MNQ, 2026-09-02 22:20 → 2026-09-08 17:33, 3 calendar days.
- **live_source book** (`lakehouse/d8b…/data`): 4,522,230 rows, MNQ, same span, 4 calendar days (level, bid, ask, sizes, orders).
- **Ticks:** no data-file prefix carries ticks; the four prefixes are bars, book, quotes and one AUDJPY file. The dashboard's DuckDB defines only `bars`, so I read the quotes and book tables by path.
- **Stale file group** (`lakehouse/b66…/data`): 1,116,657 AUDJPY 1m rows, 2020-01-01 → 2022-12-30 (OANDA). Its role is unknown.
- **`E:\qtcapture`:** does not exist on disk.
- **`candle_anatomy`:** 96,735,629 MNQ 1-second bars, 2019-05-05 15:03:17 → 2025-12-30 15:59:55.
- **`candle_anatomy_1m` and `candle_geometry_1m`:** 23,062,859 rows each, 2024-03-01 → 2026-03-30 (futures 258 symbols, 7.8M rows; forex 20 symbols, 15.2M rows).
- **`mnq_indicators_norm_1m`:** 2,344,645 rows, 2019-05-05 → 2025-12-30, 19 columns (open_norm … rsi_14).
- **`ta_indicators_1m`:** 2,383,290 rows, 2025-12-10 → 2026-03-30. MNQ 54,949 rows; the rest is forex.
- **`talib_candle_patterns`:** 216,540 rows. MNQ 1m: 169,552 rows, 2025-09-30 → 2025-12-30.

## 3. Derived datasets

- **`derived_labels`:** 30,753,250 rows, 40 recipes, MNQ 2019-05-05 → 2025-12-30.
  - **Generators:** direction, future_return, meta_label, next_close_direction, range_bucket, regime, structural, trend_scanning, triple_barrier, volatility_adaptive.
  - **Symbols and timeframes:** MNQ at 1m, 5m and 15m for the full-history sets. ES 5m and NQ 5m for triple_barrier and next_close_direction, from 2016-01-03.
  - **Small sets:** some 5m sets cover only 2024-06-02 → 2024-07-31 (probe sets, about 11.8k rows).
  - **Largest sets:** for example `triple_barrier_MNQ_1m_ff66b5c0272f` has 2,344,605 rows (2,337,295 usable) and `triple_barrier_MNQ_5m_e79baabef522` has 469,826 rows (467,200 usable).
- **`derived_model_cycle_runs_*`:** 3 runs, all MNQ 5m XGBoost.
  - **Complete:** two runs. One, `…T094307`, covers 2025-10-01 → 2025-12-29 (17,122 bars). The other, `…T185403`, has 28,942 bars (2025-08-01 → 12-29).
  - **Failed:** `…T185221`, no fold fits 10,882 bars with train_days=60, test_days=10.
  - **Tables:** 15 in total; predictions 83,817 rows, trades 1,728 rows, folds 60 rows.
- **`derived_ta_strategy_600_ticks_*`:** daily 119,046 rows, 102 configurations, 1171 session dates, 2021-07-01 → 2025-12-31. Predictions 1,013,782 rows (from 2021-06-30 15:00). Trades 138,903 rows.
- **`derived_ta_conditional_strategies_600_ticks_daily`:** 11,363 rows, 1033 session dates, 2022-01-03 → 2025-12-31. Trades 9,786 rows.
- **`derived_ta_rule_strategies_600_ticks_*`:** trades 223,837 rows, daily 461,016 rows.
- **`derived_trend_state_calibration_*`:** episodes 770, sample_bars 49,020.
- **`derived_label_audit_*`:** suite 34 rows, generators 18, findings 19, legacy_tables 6.
- **`derived_mnq_*` (candle windows, next_candles, embeddings, talib):**
  - **`candle_windows`:** 1m 1,767,369 rows, 2021-01-03 → 2025-12-30. 1h and 4h: 29,497 and 7,995 rows.
  - **`next_candles`:** 1m 1,767,369; 5m 353,478; 15m 117,826; 1h 29,497; 4h 7,711.
  - **`candle_shape_embedding`:** 1m 1,766,844; 1h 28,972; 4h 7,470.
- **`derived_news_features`:** 41,208 rows, 2025-12-15 → 12-21.
- **Calendar modality:** `derived/recipe=market_calendar_v1` holds event rows with family, timestamp and affected markets. Example: ISM manufacturing and services PMI at 10:00 New York, from 2021-01. `recipe=fomc_decisions_v1` has FOMC decisions from 2021-01-27. Row counts and full ranges were not measured.
- **Other derived recipes present, contents not opened:** `mnq_features_v1`, `pandasta_v1`, `zscore_norm_v1`, `dashboard_label_sets`, `quantgo_oos_v1`, `questdb_legacy_2026-08-27`, `questdb_only_symbols_2026-08-27`, `lens_vector_space_study`.

## 4. News and FinBERT

Read from `s3://curated/news_articles/**`, `news_sentiment/**` and `news_coverage/**`.

- **Articles by vendor and range:** gdelt has 2025-12-15 → 12-21 plus 2 rows on 2026-09-28. alphavantage and rss start 2026-09-28. Only 2025-12-15 → 12-22 and 2026-09-28 have any news; nothing between.
- **MNQ rows by month:**

| month | vendor | rows | unique articles | days with articles |
|---|---|---|---|---|
| 2025-12 | gdelt | 2,811 | 1,611 | 8 |
| 2026-09 | alphavantage | 192 | 176 | 1 |
| 2026-09 | rss | 96 | 77 | 1 |
| 2026-09 | gdelt | 2 | 2 | 1 |

- **MNQ session-day coverage:** 6 of 1718 RTH days (2019-05 → 2025-12) have any article, 0.35%. Within 2025-12-15 → 12-30, 6 of 11 days.
- **Per root:** every futures and forex root has about 1,000–3,200 rows, all dated 2025-12-15 → 2026-09-28. MNQ has 3,101 rows and 1,866 unique articles.
- **FinBERT (`news_sentiment`):** 2,967 scored articles, model `ProsusAI/finbert`. By month: 2025-12 has 1,638 and 2026-09 has 1,329.
- **`news_coverage`:** gdelt 246 records, alphavantage 9, rss 644. alphavantage and rss coverage start 2026-09-27 and 09-28.
- **`derived_news_features`:** windows of 30, 60 and 240 minutes, 2025-12-15 → 12-21 only.
- **Training implication:** the only overlap between news and price data is 2025-12-15 → 12-30. Any 2019–2025 training window has no news signal.

## 5. Live hub spool and `derived_live_bars`

- **`derived_live_bars`:** 396,228 rows, 1m, 2026-09-14 08:39 → 09-28 23:59.
  - **OANDA forex:** 272,989 rows, 18 roots, from 2026-09-14.
  - **Yahoo futures:** 115,674 rows across 15 roots (ES, NQ, MNQ, MES, M2K, YM, MYM, RTY, ZN, ZB, ZF, ZT, GC, SI, HG), and Yahoo DXY 7,565 rows, all from 2026-09-21. MNQ is 7,986 rows over 7 days. Order-flow columns are 0.
- **Spool (`data/live/spool`):** `bars/pending.parquet` has 18,673 rows, 34 symbols, 2026-09-29 00:00 → 09:26.
  - **Landed dates:** the 13 dates in `live_bars_landed.json` run 2026-09-14 → 09-28, skipping the weekend days 09-19 and 09-26.
  - **`curated/`:** three day files for 2026-09-29. `news_articles` has 3,195 rows (seen_ts 2026-09-28 23:45 → 09-29 09:26). `news_sentiment` has 770 rows. `news_coverage` was not counted.

## 6. Gaps that matter for training

1. Intraday MNQ ends 2025-12-30. There is nothing usable for 2026-01 → 2026-09-20 in any futures root; the live Yahoo feed starts 2026-09-21.
2. Order flow (bid/ask volume, trades) is missing across the price history. Order-flow-style signals can only come from the live_source quotes and book tables, which cover 2026-09-02 → 09-08 for MNQ only. That is insufficient for training.
3. News coverage is 0.35% of session days (see section 4). There is no news history for the 2019–2025 span.
4. The intraday cross-asset series (ZN, ZB, GC, SI, HG, DXY) exist only at 1h from 2024-04-26 and at daily resolution. Intraday cross-asset for 2019–2025 is not in the lake. CL, 6E and VIX are absent.
5. The two clocks (see finding 1) must be normalised before joining `bars`, `ohlcv_*`, `mnq_*` and `derived_labels`, or news and calendar timestamps, which are UTC.
6. MNQ coverage of full sessions is about 82% because minutes with no trade have no bar. RTH is 98%. Sparse overnight bars need explicit handling, not zero-fill.
7. Roll steps are not adjusted in the stored bare-root series. Adjust additively, as the Model Cycle does (`src/ml/cycle/rolls.py`).
8. Chart images are not stored anywhere. They must be rendered from bars.
9. `derived_labels` is MNQ 1m/5m/15m only, plus ES and NQ 5m. No label sets exist for other roots or timeframes.
10. Calendar events (market_calendar_v1, FOMC) exist as data, but their counts, coverage and any pre-2021 range were not measured.

Query helper: `/tmp/w/q.sh` (a wrapper over the dashboard query endpoint; not in the repo).