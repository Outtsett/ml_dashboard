# Shared — ML Shared Utilities

Shared Python utilities used across all ML model packages. Contains feature engineering, data loading, normalization, the stdout protocol, and visualization infrastructure.

## Core Files

| File | Purpose |
|---|---|
| `protocol.py` | JSON stdout event emitters: `emit_metric`, `emit_done`, `emit_progress`, `emit_overlay`, `emit_model_state`, `emit_metric_declarations`, `emit_error`. The communication bridge between Python and Node.js. |
| `data.py` | OHLCV loading from the Iceberg lake via DuckDB (`lake.serving.connect()`, in-process). Fetches raw bars for training. |
| `data_mbp.py` | MBP-10 order book data loading |
| `features.py` | Config-driven feature computation: 35 features across 10 categories. Reads `src/config/features.json` via dispatch table. Numba JIT rolling stats. `normalize_features()` uses O(1) memory online rolling z-score. |
| `normalizer.py` | Feature classification (8 types) + transform functions: rolling_zscore, scale_bounded, pct_from_close, price_ratio, cumulative_roc. Constants: `ROLLING_WINDOW=50`, `CLIP_RANGE=5.0`. |
| `feature_extract.py` | Indicator-to-feature derivation: 8 transforms (roc, distance_from, percentile_rank, zscore, divergence, squeeze, crossover_dist, acceleration). Numba JIT kernels, joblib parallel across categories, parquet cache layer. |
| `feature_correlation.py` | Pairwise correlation (polars + numpy corrcoef), hierarchical clustering, batch VIF via matrix inverse, redundancy detection |
| `feature_importance.py` | Permutation importance (joblib-parallelized), mutual information (subsampled to 100k), SHAP wrapper, cumulative importance |
| `diagnostics.py` | Diagnostics output formatting |
| `diagnostics_schema.py` | Pydantic schema mirroring TypeScript `SelfDescribingDiagnostics`. Validates diagnostic JSON before emission. |
| `trajectory.py` | `TrajectoryRecorder`: records weight snapshots during training, PCA projection for 3D trajectory visualization |
| `loss_surface.py` | `compute_loss_surface()`: Li et al. 2018 filter-normalized random directions for 2D loss landscape visualization. Incremental resolution, surface diagnostics. |
| `swing.py` | Causal zigzag detection (no lookahead) for swing label generation |
| `optimizer.py` | Custom optimizer implementations |
| `signals.py` | Signal processing utilities |
| `evaluation.py` | Model evaluation utilities |
| `first_principles.py` | First-principles feature computation |
| `hpo_runner.py` | HPO runner utilities |
| `microstructure.py` | Market microstructure analysis |
| `shmem.py` | Shared memory utilities for inter-process communication |
| `primitives.py` | Pattern primitive computation |

## Subdirectories

### `labeling/` — Label Generation Strategies
| File | Purpose |
|---|---|
| `base.py` | Base labeling interface |
| `simple.py` | Simple direction labels |
| `bull_bear.py` | Bull/bear regime labels |
| `structural.py` | Structural market labels |
| `colors.py` | Label color mapping |
| `renumber.py` | Label renumbering utilities |

### `primitives/` — Pattern Primitives
| File | Purpose |
|---|---|
| `core.py` | Core primitive types |
| `engine.py` | Primitive detection engine |
| `features.py` | Primitive-derived features |
