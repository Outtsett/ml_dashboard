# Routes — API Route Modules

17 Express router modules mounted on `/api`. Each route file handles HTTP concerns only: parse params, call storage/service, return JSON.

## Route Files

| File | Mount | Purpose |
|---|---|---|
| `charts.ts` | `/api/charts` | OHLCV candles + symbol listing (QuestDB SAMPLE BY, futures stitching, anchor caching) |
| `training.ts` | `/api/training` | Start/stop training, SSE stream, config, history, diagnostics, SHAP |
| `training-artifacts.ts` | `/api/training` | Training artifact management (convergence, loss surface) |
| `hpo.ts` | `/api/hpo` | Optuna HPO lifecycle: start, stop, SSE stream, sessions, trials, apply best |
| `upload.ts` | `/api/upload` | File upload + OHLCV ingestion (CSV, ZST, Parquet, DBN; 500MB max) |
| `instruments.ts` | `/api/instruments` | Instrument metadata, feature importance |
| `backtest.ts` | `/api/backtest` | Walk-forward, Monte Carlo, benchmark, SSE progress, trade markers |
| `system.ts` | `/api/system` | GPU/CPU telemetry (Python subprocess + systeminformation fallback) |
| `settings.ts` | `/api/settings` | User preferences, server config, connectivity tests |
| `modelCatalog.ts` | `/api/model-catalog` | 300+ ML model specs browsing, taxonomy, search/filter |
| `models.ts` | `/api/models` | Model checkpoints + predictions (12 endpoints: GET/POST/PATCH/DELETE) |
| `curriculum.ts` | `/api/curriculum` | Learning progress tracking, bookmarks, time logging |
| `motivewave.ts` | `/api/motivewave` | MotiveWave file watcher config, manual import, status |
| `news.ts` | `/api/news` | News articles + sentiment (Yahoo Finance RSS, Alpha Vantage) |
| `events.ts` | `/api/events` | SSE event bus (per-channel: pipeline, training, system) |
| `pipelines.ts` | `/api/pipelines` | Event-sourced pipeline state (CQRS pattern) |
| `chat.ts` | `/api/chat` | Ollama LLM chat (streaming SSE, dashboard context injection) |
| `helpers.ts` | - | Shared route helper utilities |

### `ml/` Subroutes
| File | Mount | Purpose |
|---|---|---|
| `observatory.ts` | `/api/ml` | Model outputs, coherence snapshots, ensemble configs |
| `sessions.ts` | `/api/ml/sessions` | Training session queries |
| `labels.ts` | `/api/ml/labels` | Label generation (16 generators), preview, bulk create |
| `xai.ts` | `/api/ml/xai` | XAI methods (9): SHAP, LIME, GradCAM, etc. |
| `forecasts.ts` | `/api/ml/forecasts` | Chronos time-series forecasting |

### `databases/` Subroutes
| File | Mount | Purpose |
|---|---|---|
| `explorer.ts` | `/api/databases` | Table listing, column inspection, data preview, query console |
| `infrastructure.ts` | `/api/databases` | Health status, circuit breakers, rate limits, cache stats |
