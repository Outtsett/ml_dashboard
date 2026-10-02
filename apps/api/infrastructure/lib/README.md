# Lib — Server Business Logic

Shared business logic libraries used by route handlers and services. Contains the core domain logic for backtesting, label generation, XAI, ingestion, and integrations.

## Subdirectories

### `backtest/` — Backtesting Engine
| File | Purpose |
|---|---|
| `backtestOrchestrator.ts` | Coordinates backtest execution pipeline |
| `strategyEngine.ts` | Strategy rule evaluation |
| `tradeSimulator.ts` | Simulates trades with cost model |
| `metricsCalculator.ts` | Computes performance metrics (Sharpe, drawdown, etc.) |
| `walkForwardBacktest.ts` | Walk-forward validation framework |
| `monteCarloAnalysis.ts` | Monte Carlo simulation for confidence intervals |
| `benchmarkComparison.ts` | Compare against buy-and-hold and other benchmarks |
| `modelInference.ts` | Run model inference during backtest |
| `backtestSSE.ts` | Stream backtest progress via SSE |
| `forexEnhancements.ts` | Forex-specific backtest logic (pip calculations, swap) |

### `labels/` — Label Generation
16+ label generators following a registry pattern. Callers iterate the registry, never reference specific generator types.

| Key File | Purpose |
|---|---|
| `labelService.ts` | Label service facade |
| `labelGenerator.ts` | Generator interface + dispatch |
| `labelRepository.ts` | Label persistence |
| `sqlLabelGenerators/` | Individual generators: direction, signal, regime, future_return, future_volatility, multi_step, triple_barrier, npmm, volatility_adaptive, trend_scanning, meta_label, semi-supervised |

### `xai/` — Explainability (9 Methods)
| Method File | Technique |
|---|---|
| `methods/shap.ts` | SHAP values (Shapley Additive Explanations) |
| `methods/permutation.ts` | Permutation importance |
| `methods/gradcam.ts` | Gradient-weighted Class Activation Mapping |
| `methods/integratedGradients.ts` | Integrated Gradients attribution |
| `methods/saliency.ts` | Saliency maps |
| `methods/lime.ts` | Local Interpretable Model-agnostic Explanations |
| `methods/featureInteractions.ts` | Feature interaction detection |
| `methods/calibration.ts` | Confidence calibration analysis |
| `methods/counterfactuals.ts` | Counterfactual explanations |

### Other Files
| File | Purpose |
|---|---|
| `circuitBreaker.ts` | Auto-disable failing DB connections (closed -> open -> half-open) |
| `rateLimiter.ts` | Rate limiting: API 100/min, ML 50/min, upload 10/min |
| `metrics.ts` | Performance tracking and metrics collection |
| `log.ts` | Structured logging utility |
| `startupManager.ts` | Server startup sequence orchestration |
| `ptyServer.ts` | PTY (pseudo-terminal) server for embedded terminal |
| `futures.ts` | Futures contract utilities |
| `continuousContract.ts` | Continuous contract stitching logic |
| `normalize.ts` | Data normalization utilities |
| `ohlcvCache.ts` | OHLCV cache utilities |
| `parquetCache.ts` | Parquet file cache management |
| `catalogBridge.ts` | Model catalog data bridge |
| `modelResults.ts` | Model results formatting |
| `cacheHeaders.ts` | HTTP cache header utilities |

### `ingestion/` — File Upload Pipeline
| File | Purpose |
|---|---|
| `standardize.ts` | Normalize uploaded data formats to standard OHLCV schema |
| `uploadProcessor.ts` | Process uploaded files (CSV, ZST, Parquet, DBN) |

### `news/` — News Feed
| File | Purpose |
|---|---|
| `newsFetcher.ts` | Yahoo Finance RSS + Alpha Vantage API |
| `sentiment.ts` | News sentiment analysis |
| `symbolMapping.ts` | Map symbols to news search terms |
