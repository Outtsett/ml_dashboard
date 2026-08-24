# Lib — Client Utilities and Registries

Core utilities, registries, and business logic for the React client. Includes the 151-indicator calculation engine, model catalog definitions, and data infrastructure.

## Key Files

| File | Purpose |
|---|---|
| `query_client.ts` | TanStack Query client (5min global staleTime) |
| `api_service.ts` | API fetch wrapper with error handling |
| `prefetch.ts` | Route prefetching + component factory registration |
| `ohlcv_cache.ts` | IndexedDB OHLCV cache (24h TTL, instant chart reload) |
| `ring_buffer.ts` | O(1) push `RingBuffer<T>` for SSE event accumulation |
| `diagnostics-schema.ts` | `SelfDescribingDiagnostics` TypeScript schema (mirrors Python Pydantic) |
| `error_logger.ts` | `logError()` / `logWarn()` structured client-side logging |
| `utils.ts` | General utilities (cn, formatting) |
| `navigation.ts` | Route navigation helpers |
| `timeframes.ts` | Timeframe definitions and conversions |
| `types.ts` | Shared client type definitions |

## Indicator Engine

151 technical indicators computed 100% client-side from raw OHLCV bars.

| File | Purpose |
|---|---|
| `indicator_registry.ts` | All 151 indicator definitions with typed parameters |
| `indicator_compute.ts` | Dispatcher: routes each indicator ID to its calculator |
| `indicator_panels.ts` | Panel layout configuration for subchart indicators |
| `indicator_colors.ts` | Category colors, `colorToRgba()` utility |
| `indicator_display.ts` | Display formatting for indicator values |
| `indicator.worker.ts` | Web Worker for off-main-thread indicator computation |
| `candle_patterns.ts` | 60 CDL_* candlestick pattern detectors |
| `chart_overlays.ts` | Chart overlay rendering logic |
| `overlay_calculators.ts` | Overlay indicator calculations |
| `subchart_calculators.ts` | Subchart indicator calculations |
| `fetch_array.ts` | Typed array fetch utilities |
| `upload_utils.ts` | File upload utilities |

### `calculators/` — Indicator Math (8 modules)
| Module | Indicators |
|---|---|
| `math_primitives.ts` | SMA, EMA, WMA, DEMA, TEMA, StdDev, rolling stats |
| `overlay_extra.ts` | Bollinger, Keltner, Donchian, Ichimoku, Supertrend, envelopes |
| `momentum_extra.ts` | RSI, MACD, Stochastic, StochRSI, CCI, Williams %R, ROC, AO, PPO, TSI, Fisher, KDJ, Squeeze, STC, TRIX |
| `volatility_extra.ts` | ATR, NATR, True Range, Ulcer Index, Chaikin Volatility |
| `volume_extra.ts` | OBV, AD, ADOSC, CMF, EFI, EMV, KVO, MFI, NVI, PVI, VWAP, VPOC |
| `trend_extra.ts` | ADX, Aroon, CHOP, DPO, PSAR, Vortex, VHF |
| `statistics_extra.ts` | Entropy, Kurtosis, MAD, Median, Skew, Variance, Z-Score |
| `cycle_performance.ts` | EBSW, Reflex, Log Return, Percent Return |

### `candles/` — Candlestick Pattern Detection
60 candlestick patterns organized by complexity:
- `single_bar.ts` — Single-bar patterns (Doji, Hammer, Marubozu, etc.)
- `double_bar.ts` — Two-bar patterns (Engulfing, Harami, etc.)
- `triple_bar.ts` — Three-bar patterns (Morning Star, Three Soldiers, etc.)
- `complex.ts` — Complex multi-bar patterns
- `helpers.ts` — Pattern detection utilities
- `registry.ts` — Pattern registry

### `models/` — ML Model Catalog (300+ specs)
Model definitions organized by category:
- `supervised.ts`, `unsupervised.ts`, `neural_networks.ts`
- `reinforcement.ts`, `self_supervised.ts`, `semi_supervised.ts`
- `probabilistic.ts`, `generative.ts`, `optimization.ts`
- `simulation.ts`, `statistical.ts`, `hybrid.ts`
- `registry.ts` — Unified model registry
- `types.ts` — Model type definitions

### `training/` — Training Utilities
- `sse_handlers.ts` — SSE event handler utilities

### `curriculum/` — Learning Curriculum
- `paths.ts` — Learning path definitions
- `types.ts` — Curriculum type definitions
