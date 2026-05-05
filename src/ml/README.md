# ML — Python Machine Learning Engine

Python ML models and shared utilities for quantitative trading research. Model packages + shared infrastructure. All models communicate with the Node.js server via a JSON stdout protocol (`shared/protocol.py`).

## Architecture

```mermaid
graph TD
    Server["Node.js Server<br/>PythonRunner"] -->|spawn + parse stdout| Main["Model main.py<br/>CLI entry point"]
    Main --> Data["shared/data.py<br/>QuestDB PG wire"]
    Data --> QDB["QuestDB :8812"]
    Main --> Features["shared/features.py<br/>35 features, 10 categories"]
    Main --> Model["model.py<br/>Architecture + training"]
    Model --> Protocol["shared/protocol.py<br/>emit_metric, emit_done"]
    Protocol -->|stdout JSON| Server
    Model --> Save["io/save.py<br/>Checkpoint + diagnostics"]
    Save --> Disk["data/models/<br/>Checkpoints + JSON"]

    subgraph Packages
        TFlow["tensionflow/<br/>Signal scorer"]
        Opt["optimizers/<br/>Custom optimizers"]
    end

    subgraph "External (separate repos)"
        CNN["cnn_transformer<br/>E:\source\repos\trading_model"]
        Prim["primitives_discovery<br/>E:\source\repos\primitives_discovery"]
    end
```

## Directory Structure

```
src/ml/
  shared/               Shared across ALL models
    protocol.py         JSON stdout event emitters (emit_metric, emit_done, etc.)
    data.py             QuestDB OHLCV loading via PG wire (psycopg2)
    features.py         Config-driven feature computation (35 features, 10 categories, Numba JIT)
    normalizer.py       Feature classification (8 types) + transform functions
    feature_extract.py  Indicator-to-feature derivation (8 transforms, Numba JIT, joblib parallel)
    feature_correlation.py  Pairwise correlation, hierarchical clustering, batch VIF
    feature_importance.py   Permutation importance, mutual information, SHAP wrapper
    diagnostics.py      Diagnostics output formatting
    diagnostics_schema.py   Pydantic schema mirroring TypeScript SelfDescribingDiagnostics
    trajectory.py       Weight snapshot recorder + PCA projection for 3D visualization
    loss_surface.py     Li et al. 2018 filter-normalized 2D loss landscape
    swing.py            Causal zigzag detection (no lookahead)
    optimizer.py        Custom optimizer implementations
    signals.py          Signal processing utilities
    shmem.py            Shared memory utilities
    labeling/           Label generation strategies
    primitives/         Pattern primitive detection

  (extracted to separate repos)
    cnn_transformer/    -> E:\source\repos\trading_model
    primitives_discovery/ -> E:\source\repos\primitives_discovery

  tensionflow/          Physics-based signal scorer
    scorer.py           Main scorer (5 signals, confluence + alignment gates)
    config.py           Configuration constants
    features/           Spatial, volume, derived features
    signals/            Band direction, momentum, spatial, structure, volume profile
    tension/            Composite tension + delta computation
    state/              History, hysteresis, regime tracking
    risk/               Confidence, drawdown, sizing, stops
    trade/              Confluence, context, flip, strength, threshold
    patterns/           Pattern detection

  optimizers/           Custom optimizer implementations
```

## Stdout Protocol

All models communicate with the server via JSON lines on stdout. The protocol is defined in `shared/protocol.py`:

| Event Type | Purpose | Receiver |
|---|---|---|
| `progress` | Iteration/phase progress bar | Training UI progress |
| `metric` | Per-iteration numeric metric | SSE -> streaming metric panels |
| `metric_declarations` | Self-describing metric schema | Dashboard pre-configures renderers |
| `overlay` | Chart overlay (regime zones, predictions) | TradingChart regime coloring |
| `model_state` | Full model state snapshot | Visualization components |
| `log` | Human-readable log message | Training log panel |
| `done` | Training complete + diagnostics JSON | Checkpoint persistence |
| `error` | Training failed | Error handling |

## Extracted Model Repos

The transformer-based predictors were lifted out of this directory to live as
their own repos. They keep the same `src/ml/<module> + src/ml/shared` layout
internally so import paths and the SSE protocol stay unchanged:

- **`E:\source\repos\trading_model`** — `CnnTransformerModel` triple barrier
  predictor (8L/8H/d=256, ~6.8M params, 128-bar OHLCV input). Branched from
  `feature/personalized-ollama` working tree at extraction time.
- **`E:\source\repos\primitives_discovery`** — `PrimitivesDiscoveryModel`
  feature-attention CNN+Transformer over ~510 mathematical primitives
  (4L/8H/d=256, ~3.1M params).

## Key Performance Optimizations

- **Numba JIT**: Rolling z-score, rolling stats, percentile rank (~50x vs pandas on 500k+ rows)
- **O(1) memory normalization**: Online algorithm instead of sliding_window_view (avoids OOM at 2.3M rows)
- **Joblib parallel**: Feature extraction + permutation importance parallelized across cores
- **Polars correlation**: Rust-native ranking + numpy corrcoef (~3x vs scipy)
- **Batch VIF**: Single matrix inverse instead of D separate OLS regressions
