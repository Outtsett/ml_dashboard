# Triple Barrier CNN+Transformer Training

> **Superseded data layer (2026-09-10).** Where this spec says QuestDB, read: the Iceberg lake
> at `E:\lake`, queried in-process by DuckDB (`from lake.serving import connect`). The QuestDB
> serving cache was emptied and retired — every table was copied to parquet in the lake and
> row-count verified first — and nothing may read or write it. The design below is kept as the
> record of what was decided at the time.

## Context

The existing CNN+Transformer model (962K params) predicts swing direction labels that barely change between bars, inflating accuracy to 91.8% without producing a tradeable signal. The forward return head scores 51.3% — coin flip.

The architecture itself is sound (Conv1d temporal feature extraction + Transformer attention + dual heads). The problem is the labeling. Replacing swing labels with triple barrier labels (Lopez de Prado, 2018) directly encodes trade outcomes: which of {take-profit, stop-loss, time-expiry} gets hit first. The model learns to predict the result of an actual trade, not the direction of an autocorrelated label.

Goal: retrain the CNN+Transformer with triple barrier labels and parameterized barrier configs optimized via HPO. Produce a model that predicts tradeable outcomes on MNQ 1m data.

## Triple Barrier Label Generation

### Algorithm

For each bar `i`:

1. Compute ATR(atr_period) at bar `i` using trailing high/low (no lookahead)
2. Set `upper = close[i] + tp_multiplier * ATR[i]`
3. Set `lower = close[i] - sl_multiplier * ATR[i]`
4. Walk forward from `i+1` to `i + vertical_bars`:
   - If `high[j] >= upper` first: label = **+1** (TP hit)
   - If `low[j] <= lower` first: label = **-1** (SL hit)
   - If both crossed on same bar: use open-to-barrier distance to determine which hit first; if ambiguous, label by close position relative to entry
   - If vertical barrier reached: label = **0** (no decisive move)
5. Record: label, exit_bar offset, barrier_type, return_at_exit, ATR_at_entry

### Parameters (HPO Search Space)

| Parameter | Range | Type | Description |
|-----------|-------|------|-------------|
| `atr_period` | [10, 14, 20, 30] | categorical | ATR lookback for barrier scaling |
| `tp_multiplier` | [1.0, 4.0] | float | Take-profit distance in ATRs |
| `sl_multiplier` | [0.5, 3.0] | float | Stop-loss distance in ATRs |
| `vertical_bars` | [15, 30, 60, 120] | categorical | Max hold time in bars |

### Barrier Hit Detection

Check `high[j]` and `low[j]` (not close) — intrabar excursions trigger real stops.

**Same-bar dual hit**: When both `high[j] >= upper` AND `low[j] <= lower` on bar j, resolve by open direction:
- `open[j] >= close[i]` → bar opened at/above entry, likely hit upper first → label +1
- `open[j] < close[i]` → bar opened below entry, likely hit lower first → label -1

**Implementation**: Numba JIT-compiled loop. ~1.87M bars x up to 120 forward steps = ~224M comparisons, runs in seconds with Numba.

### Continuous 24h Labels

No session filtering. Barriers extend through ETH/overnight. All bars are labeled regardless of session.

### Lookahead Bias Prevention

- ATR computed from trailing bars only (no future data)
- Labels whose exit_bar >= split_idx are masked to NaN in the training set
- Same `apply_split_mask()` pattern as existing code, using exit_bar as the horizon

### Class Balance

Triple barrier labels are often imbalanced (e.g., 40% TP, 35% SL, 25% timeout). Handle via:
- Class weights in CrossEntropyLoss (inverse frequency)
- Report per-class precision/recall, not just overall accuracy

## Model Architecture (Scaled + Quantized)

### Previous Architecture (963K params — replaced)
```
Raw OHLCV (B, 128, 5) -> Linear(5, 64) -> Conv1d x3 (64->128, 4x downsample)
-> Positional Encoding -> [CLS] token -> TransformerEncoder(4L, 4H, d=128)
-> CLS + mean pool -> Shared trunk (256->128) -> 2 binary heads
```

### New Architecture (~6M params)
```
Raw OHLCV (B, 128, 5)
  -> Linear(5, 128)
  -> Conv1d x3 (128->256, k=3/5/5, BatchNorm, GELU, MaxPool 2x) — 4x downsample
  -> Soft Quantization Layer (K=32 codebook, d=256)
  -> Sinusoidal Positional Encoding
  -> Prepend learnable [CLS] token
  -> TransformerEncoder(8 layers, 8 heads, d_model=256, pre-LN, GELU)
  -> CLS output + mean pool -> concat (512)
  -> Shared trunk (512 -> 256)
  -> Head 1: Barrier class (3-class)
  -> Head 2: Vol regime (3-class)
  -> Head 3: Return magnitude bucket (8-class, auxiliary)
```

### Soft Quantization Layer

Inserted between CNN and Transformer. Forces the model to learn discrete market states rather than memorizing continuous noise.

- Learnable codebook: K=32 embeddings of dimension 256
- Per time step: compute softmax similarity to all K codebook entries
- Output: weighted sum of codebook embeddings (soft assignment, differentiable)
- Temperature parameter (learned or HPO) controls sharpness of assignment
- Acts as information bottleneck and regularizer
- Gradient flows through softmax — no straight-through estimator needed

### Three Output Heads

| Head | Input | Output | Loss | Purpose |
|------|-------|--------|------|---------|
| Barrier class | trunk (256) | 3 logits -> softmax (+1, -1, 0) | CrossEntropyLoss (class-weighted) | Primary trading signal |
| Vol regime | trunk (256) | 3 logits -> softmax (low, med, high) | CrossEntropyLoss | Stop/target scaling |
| Return bucket | trunk (256) | 8 logits -> softmax (quantile bins) | CrossEntropyLoss | Auxiliary gradient signal |

### Volatility Regime Labels

Derived from realized volatility percentile over trailing 250 bars:
- Low: percentile < 33rd
- Medium: 33rd <= percentile < 67th
- High: percentile >= 67th

No lookahead — percentile computed from trailing window only.

### Return Magnitude Bucket Labels

Bucket the actual return-at-exit (from triple barrier) into 8 quantile bins:
- Bins computed from training set return distribution (not validation)
- Ranges from "large loss" to "large gain"
- Provides richer gradient signal than the coarse 3-class barrier label
- Auxiliary head — contributes to loss but not used for trading decisions

### Loss Function

```
total_loss = alpha * barrier_loss + beta * vol_regime_loss + gamma * return_bucket_loss
```

- `alpha`: HPO parameter, range [0.5, 0.8]. Barrier prediction is primary.
- `beta`: HPO parameter, range [0.05, 0.25]. Vol regime is secondary.
- `gamma`: HPO parameter, range [0.05, 0.2]. Return bucket is auxiliary.
- Constraint: alpha + beta + gamma = 1.0
- Barrier loss: CrossEntropyLoss with per-class weights from training set distribution
- Vol regime loss: CrossEntropyLoss (unweighted, roughly balanced by construction)
- Return bucket loss: CrossEntropyLoss (unweighted, balanced by quantile construction)

### GPU Utilization Target

- ~6M params with optimizer states (AdamW): ~150MB
- Batch 4096 × 128 bars × 5 floats: ~10MB
- Activations + gradients: ~500MB-1GB
- Total VRAM: ~1.5-2GB (~10-12% of 16GB)
- Headroom for torch.compile memory overhead and larger batches

## Cost Model (AMP/CQG MNQ)

Costs are NOT baked into barrier labels — labels encode pure market behavior. Costs are subtracted during profit factor evaluation so the optimizer selects configs that are profitable after friction.

### Fee Structure (from trade confirmation 2026-03-25)

| Component | Per side | Round trip |
|-----------|----------|------------|
| Exchange (CME) | $0.35 | $0.70 |
| NFA | $0.02 | $0.04 |
| Clearing | $0.13 | $0.26 |
| CQG Transfer | $0.10 | $0.20 |
| Commission (AMP) | $0.30 | $0.60 |
| Slippage (1 tick) | $0.50 | $1.00 |
| **Total** | **$1.40** | **$2.80** |

- MNQ tick size: 0.25 pts, tick value: $0.50
- Total round-trip friction: 5.6 ticks = 1.40 pts = $2.80
- Breakeven threshold: every trade must clear 1.40 pts to be profitable
- Cost config stored in `src/config/cost_model.json` — updatable if broker/fees change without retraining

## Hyperparameter Optimization

### Framework

Optuna (already integrated via `src/ml/shared/optimizer.py` and `hpo_runner.py`).

### Search Space

**Barrier parameters** (label generation):
- atr_period, tp_multiplier, sl_multiplier, vertical_bars (see table above)

**Training parameters**:
- learning_rate: [1e-5, 5e-4] log-uniform
- batch_size: [256, 512, 1024] categorical
- loss_alpha: [0.5, 0.95] float
- epochs: fixed at 30 (early stopping patience=5)

### Objective Metric

Not accuracy. Not loss. A trading metric computed from OOS predictions:

**Primary: Profit Factor** = gross_profit / gross_loss (after costs)
- Simulate trades on validation set: enter on +1/-1 predictions (ignore 0), exit at the barrier that hits
- Subtract $2.80 round-trip cost from each trade's raw P&L
- Profit factor > 1.0 means net profitable after all friction
- Ties broken by Sharpe ratio

**Secondary: Per-class precision**
- Precision on +1 predictions (what % of predicted TPs actually hit TP)
- Precision on -1 predictions (what % of predicted SLs actually hit SL)

### Trial Flow

Each Optuna trial:
1. Sample barrier params + training params
2. Generate triple barrier labels with sampled barrier config
3. Compute class weights from label distribution
4. Train model (30 epochs, early stopping)
5. Run OOS predictions on validation set
6. Simulate trades: enter on model's +1/-1 calls, measure profit factor
7. Return profit factor as objective

### Budget

- 30 trials, full 8-fold walk-forward per trial
- TPE sampler (Optuna default, Bayesian)
- Pruning: MedianPruner after epoch 5 (kill trials that are clearly underperforming)
- Estimated runtime: ~3 hours on RTX 5060 Ti

### Performance Optimizations

- Batch size 4096 (963K param model is trivial for 5060 Ti)
- `torch.compile` on model (fuses ops, eliminates Python overhead)
- AMP FP16 (existing)
- DataLoader: `pin_memory=True`, `persistent_workers=True`, `prefetch_factor=4`
- Label generation cached per barrier config, sliced per fold
- Full dataset loaded to GPU memory once (1.87M × 5 × float32 = 37MB)

## Training Data

- Source: QuestDB `ohlcv` table, symbol=MNQ, timeframe=1m
- Total: ~2.34M bars (2019-05-05 to 2025-12-30)

### Walk-Forward Validation (8 folds, expanding window)

| Fold | Train | Purge (120 bars) | Test |
|------|-------|-------------------|------|
| 1 | 2019-05 → 2021-12 | gap | 2022-01 → 2022-06 |
| 2 | 2019-05 → 2022-06 | gap | 2022-07 → 2022-12 |
| 3 | 2019-05 → 2022-12 | gap | 2023-01 → 2023-06 |
| 4 | 2019-05 → 2023-06 | gap | 2023-07 → 2023-12 |
| 5 | 2019-05 → 2023-12 | gap | 2024-01 → 2024-06 |
| 6 | 2019-05 → 2024-06 | gap | 2024-07 → 2024-12 |
| 7 | 2019-05 → 2024-12 | gap | 2025-01 → 2025-06 |
| 8 | 2019-05 → 2025-06 | gap | 2025-07 → 2025-12 |

- Purge gap = 120 bars (max `vertical_bars` in HPO range) to prevent label leakage
- HPO objective: **median profit factor** across all 8 folds (robust to outlier folds)
- Each fold trains from scratch (no weight carryover)

## Cleanup (Before Training)

- Delete `src/ml/hdp_hmm/` entirely
- Delete `src/ml/hmm_2state/` entirely
- Rename `data/models/MNQ_1m_cnn_transformer/checkpoint_best.pt` → `checkpoint_swing_baseline.pt`
- Delete stale model outputs in `data/models/` for HDP-HMM and HMM-2State models

## Data Storage Architecture

Follows existing codebase patterns: all queries server-side via Express API, client never touches databases.

### QuestDB (time-series only — per-bar predictions)

| Table | Columns | Partition | Volume | Purpose |
|-------|---------|-----------|--------|---------|
| `prediction_log` | `timestamp TIMESTAMP, symbol SYMBOL, model_id SYMBOL, barrier_class INT, prob_tp DOUBLE, prob_sl DOUBLE, prob_timeout DOUBLE, vol_regime INT, return_bucket INT` | DAY | ~468K rows per OOS pass (~45MB) | Per-bar predictions for PredictionsPanel chart overlay. Time-range queries via PG wire. |

Created via `CREATE TABLE IF NOT EXISTS` in `src/server/database/questdb/tables.ts` (existing pattern). WAL + DEDUP on `(symbol, model_id, timestamp)`. No views, no materialization — query directly.

### SQLite (relational metadata — everything else)

New tables defined via Drizzle schema in `src/shared/schema.ts` (existing pattern):

| Table | Key Columns | Volume | Purpose |
|-------|-------------|--------|---------|
| `hpo_trials` | `trial_id, model_id, barrier_config JSON, training_config JSON, median_profit_factor, sharpe, rank, status, created_at` | 30 rows per HPO run | Trial configs and results |
| `walk_forward_folds` | `fold_id, trial_id, fold_number, train_start, train_end, test_start, test_end, profit_factor, sharpe, class_distribution JSON, n_trades` | 8 per trial | Per-fold results for WalkForwardPanel |
| `trade_simulations` | `id, trial_id, fold, side, entry_bar, exit_bar, entry_price, exit_price, barrier_hit TEXT, raw_pnl, cost, net_pnl, hold_bars` | ~10K-50K per run | Simulated trades for profit factor calculation |
| `training_sessions` | Existing table — extend with `model_type`, `best_trial_id` | 1 per run | Session metadata |

Per-epoch training metrics use the existing `training_metrics` table (SQLite) — same `emit_metric()` → parser → SQLite insert pattern already in the codebase. No QuestDB for metrics (that was tried and removed).

### JSON Files (snapshots — existing pattern)

| File | Content | When Written |
|------|---------|--------------|
| `diagnostics.json` | Full diagnostics snapshot for dashboard panels | After best trial selected |
| `convergence.json` | Per-epoch metric arrays for convergence charts | After each fold |

### Data Flow

```
Python training loop
  → emit_metric() to stdout → parser → SQLite training_metrics + SSE to browser
  → emit_done() with diagnostics → JSON files to disk

Python HPO orchestrator
  → per-trial: write SQLite hpo_trials
  → per-fold: write SQLite walk_forward_folds
  → per-trade: write SQLite trade_simulations
  → OOS predictions: write QuestDB prediction_log (ILP batch insert)
```

### Dashboard Data Access

| Panel | Data Source | API Endpoint |
|-------|------------|--------------|
| Live MetricPanels | SSE stream | `GET /api/training/stream/:modelId` (existing) |
| OverviewPanel | JSON diagnostics | `GET /api/training/models/:id/diagnostics` (existing) |
| PerformancePanel | SQLite hpo_trials + trade_simulations | `GET /api/training/models/:id/performance` (new) |
| PredictionsPanel | QuestDB prediction_log | `GET /api/training/models/:id/predictions?start=...&end=...` (new) |
| WalkForwardPanel | SQLite walk_forward_folds | `GET /api/training/models/:id/walkforward` (new) |
| ConvergencePanel | JSON convergence | `GET /api/training/models/:id/convergence` (existing) |

All server-side queries. PredictionsPanel uses QuestDB PG wire with time-range filter. Everything else uses SQLite via Drizzle ORM. No compression changes needed — QuestDB snappy + Express gzip handles it.

## Output Artifacts

Per HPO trial:
- `data/models/MNQ_1m_cnn_transformer/hpo_trial_{n}/` — checkpoint, diagnostics, convergence

Best trial:
- `data/models/MNQ_1m_cnn_transformer/checkpoint_best.pt` — overwrites existing
- `data/models/MNQ_1m_cnn_transformer/diagnostics.json` — updated with barrier config, class metrics, profit factor
- `data/models/MNQ_1m_cnn_transformer/convergence.json` — per-epoch metrics
- `data/models/MNQ_1m_cnn_transformer/oos_predictions.npz` — regenerated with triple barrier predictions

## Files to Modify

### Python (Training Pipeline)

| File | Change |
|------|--------|
| `src/ml/cnn_transformer/labels.py` | Delete `generate_swing_labels()` and `generate_forward_labels()`. Replace with `generate_triple_barrier_labels()` and `generate_vol_regime_labels()`. Keep `apply_split_mask()`. |
| `src/ml/cnn_transformer/model.py` | Replace dual binary heads with 3-class barrier + 3-class vol regime + 8-class return bucket heads. Scale to ~6M params. Add soft quantization layer. |
| `src/ml/cnn_transformer/train.py` | Update loss computation for 3 heads, add class weighting, add profit factor eval per fold, walk-forward loop |
| `src/ml/cnn_transformer/dataset.py` | Update dataset to return barrier labels + vol regime labels + return bucket labels |
| `src/ml/cnn_transformer/main.py` | Wire new label generation, add HPO loop via Optuna, add barrier config args, walk-forward orchestration |
| `src/ml/cnn_transformer/io/save.py` | Update diagnostics JSON to include barrier config, per-class metrics, profit factor, walk-forward fold results, cost model |
| `src/config/cost_model.json` | New file: MNQ cost structure (commission, fees, slippage) for profit factor eval |

### TypeScript (Dashboard Integration)

| File | Change |
|------|--------|
| `src/server/routes/training.ts` | Add endpoint `GET /api/training/models/:id/predictions` to serve OOS predictions for chart overlay |
| `src/server/training/training.service.ts` | Update model type registry to include `cnn-transformer` with its hyperparameter definitions |

### Dashboard — Model-Type-Aware Metric System

**The core problem:** Currently, panels hard-code which metrics they display. Every model gets the same panels rendering the same fields. A regime model and a barrier model have completely different performance metrics — rendering regime silhouette scores on a barrier model is wrong.

**Solution:** Each model type declares its own metric set and panel configuration. The Training tab reads `model_type` from diagnostics, then renders only the metrics and panels relevant to that type. No shared assumptions about what metrics exist.

#### Model Type Config (`src/client/src/config/model-types/`)

New directory. One config file per model type:

**`cnn-transformer.json`:**
```json
{
  "id": "cnn-transformer",
  "label": "CNN+Transformer",
  "live_metrics": ["barrier_accuracy", "barrier_precision_tp", "barrier_precision_sl",
                   "vol_regime_accuracy", "return_bucket_accuracy", "profit_factor",
                   "fold_number", "learning_rate", "train_loss", "val_loss"],
  "sub_tabs": ["overview", "performance", "predictions", "walkforward", "convergence", "log"],
  "overview_cells": ["profit_factor", "barrier_config", "cost_adjusted_pnl",
                     "class_distribution", "walk_forward_summary"],
  "primary_metric": "profit_factor"
}
```

**`hdp-hmm.json`:** (existing model type, refactored from hard-coded)
```json
{
  "id": "hdp-hmm",
  "label": "HDP-HMM",
  "live_metrics": ["log_likelihood", "num_regimes", "assignment_stability",
                   "mean_self_transition", "switch_rate", "avg_dwell", "beta_entropy"],
  "sub_tabs": ["overview", "regimes", "convergence", "walkforward", "oos", "fit", "log"],
  "overview_cells": ["quality_score", "regime_distribution", "shap_importance",
                     "walk_forward_heatmap", "oos_comparison"],
  "primary_metric": "quality_score"
}
```

#### Metric Descriptions (per model type)

| File | Change |
|------|--------|
| `src/client/src/config/metric-descriptions.json` | Split into `metric-descriptions/cnn-transformer.json` and `metric-descriptions/hdp-hmm.json`. Each defines only the metrics for that model type. `useMetricDescriptions(modelType)` already accepts model type — just point it at the right file. |

#### Panel Rendering (model-type-driven)

| File | Change |
|------|--------|
| `src/client/src/components/training/model-tabs/index.tsx` | Read `model_type` from diagnostics. Load the model type config. Filter sub-tabs and overview cells from the config instead of hard-coding. Render only the panels declared for that model type. |
| `src/client/src/components/training/model-tabs/constants.ts` | Remove hard-coded `SUB_TABS` array. Replace with a `getSubTabsForModel(modelType: string)` function that reads from model type config. |
| `src/client/src/components/training/model-tabs/OverviewPanel.tsx` | Make cell rendering data-driven: iterate `overview_cells` from config, render each cell only if (a) it's in the config for this model type AND (b) the diagnostics data for it exists. No more hard-coded `quality_score` or `regime_stats` assumptions. |
| `src/client/src/components/training/live/LiveTrainingDashboard.tsx` | Read `live_metrics` from model type config. Only render MetricPanels for metrics declared in that model's config. |

This way:
- Regime models show regime panels with regime metrics
- Barrier models show performance/prediction panels with trading metrics
- Adding a new model type = adding one JSON config file + its panel components
- No existing code is modified to support new model types

### Dashboard — New Panels (ML Studio → Training tab → model sub-tabs)

| File | Change |
|------|--------|
| `src/client/src/components/training/model-tabs/PerformancePanel.tsx` | **New.** CNN-Transformer only. Profit factor gauge, Sharpe ratio, cost breakdown table, per-class precision/recall bars, confusion matrix heatmap, comparison to random baseline. Props: narrow `TradingPerformance` interface, not full diagnostics blob. |
| `src/client/src/components/training/model-tabs/PredictionsPanel.tsx` | **New.** CNN-Transformer only. Candlestick chart with triple barrier predictions overlaid via `useChartMarkers` (green arrow = predicted TP, red arrow = predicted SL, gray dot = predicted timeout). Toggle actual vs predicted outcomes. Date range navigation. |
| `src/client/src/components/training/model-tabs/WalkForwardPanel.tsx` | **Update existing.** Model-type-aware: if barrier model, show per-fold profit factor bars and class distributions. If regime model, show existing stability/confidence view. Same component, different rendering path based on `model_type`. |

### Dashboard — Chart Integration

| File | Change |
|------|--------|
| `src/client/src/components/chart/useChartMarkers.ts` | Already supports `PredictionMarker[]`. Triple barrier predictions (+1/-1/0) map to existing buy/sell/hold marker types. Add barrier zone rendering (TP/SL horizontal lines per active prediction). |

### Dashboard — Training Config Form

| File | Change |
|------|--------|
| Model definition (hyperparameters) | Expose barrier params (atr_period, tp/sl multiplier, vertical_bars) and training params (learning_rate, loss weights) in the HyperparameterForm. These become the HPO search space when "Optimize" is selected. |

### Cleanup

| File | Change |
|------|--------|
| `src/ml/hdp_hmm/` | Delete entire directory |
| `src/ml/hmm_2state/` | Delete entire directory |
| `data/models/MNQ_1m_cnn_transformer/checkpoint_best.pt` | Rename to `checkpoint_swing_baseline.pt` |
| `data/models/` | Delete stale HDP-HMM and HMM-2State model outputs |
| `scripts/prediction_viewer.py` | Delete — functionality moves into dashboard PredictionsPanel |

## Verification

1. **Label sanity check**: After generating labels, verify class distribution is reasonable (no class < 10%). Print distribution and avg hold time per class.
2. **Live training metrics**: Start training from dashboard UI. Verify MetricPanels display: barrier_accuracy, profit_factor, per_class_precision, vol_regime_accuracy in real-time via SSE.
3. **Walk-forward results**: After HPO completes, verify WalkForwardPanel shows per-fold profit factors, class distributions, and median profit factor across folds.
4. **Performance panel**: Verify PerformancePanel displays profit factor gauge, Sharpe ratio, confusion matrix, cost-adjusted P&L, and random baseline comparison.
5. **Predictions panel**: Navigate to PredictionsPanel. Verify candlestick chart shows prediction markers (green/red/gray) at correct timestamps. Toggle actual outcomes overlay. Navigate across date ranges.
6. **Overview panel**: Verify profit factor ring, barrier config summary, and net P&L display correctly for the best HPO trial.
7. **OOS evaluation**: After best trial, verify all metrics are stored in diagnostics.json and displayed correctly across all dashboard panels.
