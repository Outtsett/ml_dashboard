# `src/features` — Market-State Feature Pipeline

Turns 1m OHLCV into binary market-state flags, a ternary trend state, forward direction labels, and the keys needed for relational joins and vector search.

## Files
| File | Role |
|---|---|
| `Registry.py` | `FeatureSpec` / `FeatureRegistry`: permanent `feature_id`s, state-code bits, leakage guard (LABEL specs cannot take a bit). |
| `Blocks.py` | `FeatureBlock` ABC + `TrendBlock`, `MacdBlock`, `VolumeRocBlock`, `FlowBlock`, `VolatilityBlock`, `LabelBlock`. New family = new subclass. |
| `Build.py` | `FeaturePipeline` (lazy Polars graph) + CLI that writes the artifacts below. |
| `Vectors.py` | `state_matrix` (n_bars × 14 float32, bit order) and `decode_state` for vector DB / clustering. |
| `../../tests/test_features.py` | Invariants: one-hot/ternary, MACD cross definition, label alignment, roll isolation, state-code ↔ events round-trip. |

## Run
```powershell
cd trading_models
..\.venv\Scripts\python.exe -m src.features.Build `
  --source ..\data\.cache\candle_vision\mnq_next_candles_1m_2021-01-01_2025-07-01_bars.parquet `
  --out ..\data\features\MNQ\1m          # optional: --lookback 15 --horizon 15 --band-k 0.5
..\.venv\Scripts\python.exe -m pytest tests/test_features.py -q
```
1.59M bars → ~1.3 s end to end.

## Feature IDs (permanent — never renumber, only append)
| id | key | kind | bit | definition |
|---|---|---|---|---|
| 101 | `trend_up` | flag | 0 | trailing 15-bar log return > +k·σ₁·√N |
| 102 | `trend_down` | flag | 1 | < −k·σ₁·√N |
| 103 | `trend_flat` | flag | 2 | inside the band |
| 110 | `trend_dir` | state | – | 1 up / 0 flat / −1 down |
| 201 | `macd_cross_up` | flag | 3 | MACD(12,26,9) crosses above signal |
| 202 | `macd_cross_down` | flag | 4 | crosses below signal |
| 203 | `macd_hist_rising` | flag | 5 | hist > previous hist |
| 204 | `macd_hist_falling` | flag | 6 | hist < previous hist |
| 205 | `macd_hist_below_zero` | flag | 7 | hist < 0 |
| 301 | `vol_roc_up` | flag | 8 | ROC(SMA5 volume, 5) > 0 |
| 302 | `vol_roc_down` | flag | 9 | ROC < 0 |
| 401 | `flow_buy_dominant_est` | flag | 10 | est. buy vol > sell vol (5 bars) |
| 402 | `flow_sell_dominant_est` | flag | 11 | est. sell vol > buy vol |
| 501 | `volatility_rising` | flag | 12 | ATR(14) > ATR 5 bars ago |
| 502 | `volatility_falling` | flag | 13 | ATR(14) < ATR 5 bars ago |
| 120/121, 220–222, 320, 420, 520 | continuous values | value | – | `trend_ret`, `trend_band`, `macd_line/signal/hist`, `vol_roc`, `flow_buy_ratio_est`, `atr` |
| 901–903 | `LBL_UP/DOWN/FLAT_15M` | label | – | forward 15-bar one-hot (1/0) |
| 910 | `DIR_TERN_15M` | label | – | forward 1 up / 0 flat / −1 down |
| 920 | `RET_LOG_15M` | label | – | forward 15-bar log return |

## Artifacts (`data/features/<SYMBOL>/<TF>/`)
| File | Grain | Keys |
|---|---|---|
| `features.parquet` | 1 row / bar | PK (`symbol`, `timeframe`, `bar_id` = epoch-minute); `state_code` UInt32 bitmask of the 14 flags |
| `feature_registry.parquet` | 1 row / feature | PK `feature_id` |
| `events.parquet` | 1 row / active flag / bar | (`bar_id`, `feature_id`) → FK to registry |
| `manifest.json` | run | `dataset_version` (sha256 of source identity + config + registry + `PIPELINE_VERSION`), counts, flag rates, label balance |

## Design rules
- **Contract isolation:** every window is `.over("contract_symbol")`; roll gaps never produce returns or crosses.
- **No leakage:** labels are LABEL kind and cannot occupy a state bit; drop `LBL_*`, `DIR_TERN_*`, `RET_LOG_*` from model inputs.
- **Warm-up:** indicator nulls are dropped (1,140 rows on MNQ). Label nulls (last 15 bars of each contract) are kept.
- **Flow is estimated:** close-location proxy `V·(C−L)/(H−L)`; the source has no aggressor side.

## Known limitation
Horizons/lookbacks count **bars**, not wall-clock minutes. A window spanning the daily 22:00–23:00 UTC halt or a weekend covers more than 15 minutes of time. Partitioning by `trading_day` would fix this; it's not done yet.
