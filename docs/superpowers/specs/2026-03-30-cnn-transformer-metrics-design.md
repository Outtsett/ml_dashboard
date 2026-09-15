# CNN+Transformer Metric Specification

> **Superseded data layer (2026-09-10).** Where this spec says QuestDB, read: the Iceberg lake
> at `E:\lake`, queried in-process by DuckDB (`from lake.serving import connect`). The QuestDB
> serving cache was emptied and retired — every table was copied to parquet in the lake and
> row-count verified first — and nothing may read or write it. The design below is kept as the
> record of what was decided at the time.

Complete metric inventory for the triple barrier predictor. Every metric listed here must be computed, emitted via `emit_metric()`, declared in `get_metric_declarations()`, and rendered in the dashboard.

## Renderer Reference

| Renderer | Visual | Grid | Data Format |
|----------|--------|------|-------------|
| `gauge` | Half-ring arc with severity zones | 3 col | `float` |
| `number` | Large animated number with unit | 3 col | `float` |
| `percent` | Horizontal fill bar 0-100% | 3 col | `float` (0-1) |
| `bars` | Vertical bar chart | 4 col | `list[float]` or `dict[str, float]` |
| `ring` | Donut chart with proportional slices | 3 col | `dict[str, float]` |
| `distribution` | Histogram with auto-binning | 4 col | `list[float]` |
| `time_series` | Multi-line chart with brush zoom | 6 col | `{epochs: [], metric: []}` |
| `confusion_matrix` | NxN heatmap, diagonal highlighted | 6 col | `list[list[float]]` |
| `precision_bars` | Grouped bars (precision/recall/F1) | 6 col | `dict[str, {p, r, f1}]` |
| `fold_bars` | Stacked train/val bars per fold | 6 col | `list[{fold, metric}]` |
| `heatmap` | 2D color grid | 6 col | `list[list[float]]` |
| `table` | Sortable data table | 12 col | `list[dict]` |
| `chart_overlay` | Candlestick + prediction arrows | 12 col | prediction array |

---

## Group 1: Training Process

Per-epoch metrics emitted during training. These diagnose convergence, stability, and learning dynamics.

| # | Metric | Renderer | Mission | Context |
|---|--------|----------|---------|---------|
| 1 | `train_loss` | `time_series` | Composite weighted CE across all 3 heads | `higher_is_better: false, good: 0.5, great: 0.3` |
| 2 | `val_loss` | `time_series` | Validation composite loss — divergence from train = overfitting | `higher_is_better: false, good: 0.5, great: 0.3` |
| 3 | `train_barrier_class_loss` | `time_series` | Train CE for primary TP/SL/timeout head (class-weighted) | `higher_is_better: false` |
| 4 | `val_barrier_class_loss` | `time_series` | Val CE for primary head | `higher_is_better: false` |
| 5 | `val_barrier_class_accuracy` | `gauge` | Val accuracy for barrier head vs 33% random baseline | `min: 0, max: 1, baseline: 0.33, good: 0.45, great: 0.55` |
| 6 | `train_vol_regime_loss` | `time_series` | Train CE for vol regime auxiliary head | `higher_is_better: false` |
| 7 | `val_vol_regime_loss` | `time_series` | Val CE for vol regime head | `higher_is_better: false` |
| 8 | `val_vol_regime_accuracy` | `gauge` | Val accuracy for vol regime head | `min: 0, max: 1, baseline: 0.33` |
| 9 | `train_return_bucket_loss` | `time_series` | Train CE for 8-bin return quantile head | `higher_is_better: false` |
| 10 | `val_return_bucket_loss` | `time_series` | Val CE for return bucket head | `higher_is_better: false` |
| 11 | `val_return_bucket_accuracy` | `gauge` | Val accuracy for return bucket head | `min: 0, max: 1, baseline: 0.125` |
| 12 | `overfit_gap` | `time_series` | val_loss - train_loss. Rising = memorizing | `higher_is_better: false, good: 0.05, great: 0.02, bad: 0.15` |
| 13 | `gradient_norm` | `time_series` | L2 grad norm. Spikes = instability, near-zero = vanishing | `good: 1.0, bad: 10.0` |
| 14 | `learning_rate` | `time_series` | OneCycleLR schedule: warmup -> peak -> cosine anneal | |
| 15 | `epoch_time_sec` | `time_series` | Wall-clock seconds per epoch | `unit: sec, decimals: 1` |
| 16 | `best_epoch` | `number` | Epoch with lowest val loss (early stopping checkpoint) | `unit: epoch, decimals: 0` |
| 17 | `param_count` | `number` | Total trainable parameters | `unit: params, decimals: 0` |

**What these drive:** If overfit_gap climbs while train_loss drops, increase dropout or reduce model capacity. If gradient_norm spikes, reduce learning rate or increase clipping. If per-head losses plateau at different rates, rebalance loss weights.

---

## Group 2: Architecture Diagnostics

Post-training metrics that verify internal components are functioning as designed.

| # | Metric | Renderer | Mission | Context |
|---|--------|----------|---------|---------|
| 18 | `codebook_utilization` | `gauge` | Fraction of 32 VQ codebook entries with assignment weight > threshold | `good: 0.75, great: 0.90, bad: 0.3, baseline: 0.5` |
| 19 | `codebook_entropy` | `gauge` | Shannon entropy of codebook assignment distribution. Max = log2(32) = 5.0 | `min: 0, max: 5.0, good: 3.5, great: 4.5, bad: 1.5, higher_is_better: true` |
| 20 | `attention_entropy` | `bars` | Per-head entropy averaged across layers. Uniform = not specializing. Near-zero = collapsed | `labels: [H1..H8]` |
| 21 | `vq_temperature` | `number` | Learned SoftVQ temperature. Low = sharp discrete assignments (good). High = blurred (no-op) | `decimals: 4` |

**What these drive:**
- **Codebook utilization < 50%:** Dead codes. Reduce K or add codebook diversity loss.
- **Codebook entropy < 2.0:** Codebook collapse — most inputs map to 2-3 entries. The VQ layer is learning a near-constant mapping. Increase temperature init or add commitment loss.
- **Attention entropy all equal across heads:** Heads aren't specializing. Consider head pruning or diverse initialization.
- **Temperature near init (1.0) after training:** VQ layer isn't learning to discretize. Check gradient flow through the codebook.

---

## Group 3: Classification Quality

Post-training metrics on the validation set. These measure prediction quality independent of trading outcomes.

| # | Metric | Renderer | Mission | Context |
|---|--------|----------|---------|---------|
| 22 | `roc_auc` | `gauge` | Macro-averaged one-vs-rest AUC from softmax probabilities | `min: 0.5, max: 1.0, baseline: 0.5, good: 0.65, great: 0.75` |
| 23 | `log_loss` | `number` | Val set cross-entropy on softmax outputs. Measures probability quality | `higher_is_better: false, good: 0.9, great: 0.7, decimals: 4` |
| 24 | `brier_score` | `number` | MSE of predicted probabilities vs one-hot actuals. Lower = better calibrated + sharper | `higher_is_better: false, good: 0.20, great: 0.15, bad: 0.30, decimals: 4` |
| 25 | `mcc` | `gauge` | Matthews Correlation Coefficient. Best single metric for imbalanced multiclass. -1 = inverse, 0 = random, +1 = perfect | `min: -1, max: 1, baseline: 0, good: 0.2, great: 0.4` |
| 26 | `f1_per_class` | `precision_bars` | Per-class F1 (harmonic mean of precision + recall) for TP, SL, Timeout | `baseline: 0.33, labels: [TP, SL, Timeout]` |
| 27 | `confusion_matrix` | `confusion_matrix` | Misclassification heatmap. Diagonal = correct, off-diagonal = errors | `labels: [TP, SL, Timeout]` |
| 28 | `weighted_confusion_matrix` | `confusion_matrix` | Cost-weighted: TP<->SL cells weighted by barrier distance (most expensive error) | `labels: [TP, SL, Timeout]` |
| 29 | `class_distribution` | `ring` | Distribution of PREDICTED classes. Skew = model bias toward one outcome | `labels: [TP, SL, Timeout]` |
| 30 | `class_metrics` | `precision_bars` | Per-class precision and recall | `baseline: 0.33, labels: [TP, SL, Timeout]` |
| 31 | `mae_barrier` | `number` | Mean absolute error of predicted class index vs actual (ordinal). Pred TP actual SL = error 2, pred TP actual timeout = error 1 | `higher_is_better: false, good: 0.6, great: 0.4, bad: 1.0, decimals: 3` |
| 32 | `qwk_return_bucket` | `number` | Quadratic Weighted Kappa for return bucket head (8 ordinal bins). Penalizes far-off bin predictions quadratically | `min: -1, max: 1, baseline: 0, good: 0.3, great: 0.5, decimals: 3` |

**What these drive:**
- **MCC near 0:** Model is no better than random despite what accuracy says. Rethink features or labels.
- **MAE_barrier > 1.0:** Model frequently confuses TP with SL (error=2). The features can't distinguish them — need more discriminative input data.
- **F1 imbalanced across classes:** If SL F1 is 0.20 but TP F1 is 0.55, the model can't detect stop-loss events. Class weights need adjustment or the SL barrier config is wrong.
- **QWK near 0 for return_bucket:** The auxiliary head is predicting random bins. It's not providing useful gradient signal — consider disabling it.
- **Weighted confusion matrix hot on TP<->SL:** The most expensive errors are happening most often. This is the #1 thing to fix.

---

## Group 4: Calibration & Confidence

Post-training metrics that determine whether model confidence is trustworthy. These unlock confidence-based position sizing.

| # | Metric | Renderer | Mission | Context |
|---|--------|----------|---------|---------|
| 33 | `ece` | `number` | Expected Calibration Error. When model says 70% TP, does TP hit 70% of the time? | `higher_is_better: false, good: 0.05, great: 0.02, bad: 0.15, decimals: 4` |
| 34 | `confidence_histogram` | `distribution` | Distribution of max(softmax) across all predictions. Bimodal = good discrimination, uniform ~0.33 = no signal | `labels: [Confidence]` |
| 35 | `reliability_diagram` | `heatmap` | Binned calibration: predicted confidence (x) vs actual accuracy (y). Perfect = diagonal | `labels: [0.1, 0.2, ..., 1.0]` |
| 36 | `selective_accuracy` | `table` | Accuracy and trade count at confidence thresholds [0.4, 0.5, 0.6, 0.7, 0.8] | columns: threshold, accuracy, n_trades, profit_factor |
| 37 | `nll_per_class` | `bars` | Negative log-likelihood broken out by TP/SL/Timeout. High NLL = model most uncertain about that class | `labels: [TP, SL, Timeout], higher_is_better: false` |

**What these drive:**
- **ECE > 0.10:** Model is miscalibrated. Apply temperature scaling or Platt scaling post-hoc.
- **Confidence histogram peaked at ~0.34:** Model outputs near-uniform probabilities for everything. The argmax "accuracy" is noise. The model has no real discriminative power.
- **Selective accuracy shows high PF at confidence > 0.6 but only 30 trades:** The model works, but only when highly confident. Trading strategy = only act on high-confidence signals. Accept lower trade frequency.
- **NLL for SL 3x higher than TP:** The model can identify TP events but is blind to SL events. Feature engineering needed for downside detection.

---

## Group 5: Trading Performance

Post-training metrics computed from simulated trades on the validation set. These determine deployment readiness.

| # | Metric | Renderer | Mission | Context |
|---|--------|----------|---------|---------|
| 38 | `profit_factor` | `gauge` | Gross profit / gross loss after $2.80 round-trip cost. >1.0 = net profitable | `breakeven: 1.0, good: 1.5, great: 2.0, min: 0, max: 4.0` |
| 39 | `sharpe_ratio` | `gauge` | Risk-adjusted return. Annualized by trades_per_year | `breakeven: 0, good: 1.0, great: 2.0, min: -2, max: 4` |
| 40 | `expectancy` | `number` | Expected $ per trade = (WR x avg_win) - (LR x avg_loss). THE deploy/no-deploy number | `unit: $, good: 1.0, great: 5.0, bad: 0, breakeven: 0, decimals: 2` |
| 41 | `payoff_ratio` | `number` | avg_winning_trade / avg_losing_trade. Makes win_rate interpretable | `good: 1.5, great: 2.0, bad: 0.5, decimals: 2` |
| 42 | `win_rate` | `percent` | Fraction of trades with positive net P&L | `baseline: 0.5, good: 0.55, great: 0.65` |
| 43 | `n_trades` | `number` | Total trades in validation period. Minimum ~200 for statistical significance | `good: 200, great: 500, unit: trades` |
| 44 | `max_drawdown` | `percent` | Worst peak-to-trough decline as fraction of peak equity | `higher_is_better: false, bad: 0.20, good: 0.10, great: 0.05` |
| 45 | `recovery_factor` | `number` | net_profit / max_drawdown. How efficiently the model recovers | `good: 3.0, great: 5.0, bad: 1.0, decimals: 2` |
| 46 | `consecutive_losses` | `number` | Maximum losing streak. Regime failure detector | `higher_is_better: false, good: 8, bad: 20, unit: trades, decimals: 0` |
| 47 | `avg_trade_duration` | `number` | Average bars held per trade | `unit: bars, good: 30, great: 15` |
| 48 | `cost_impact` | `number` | Average transaction cost per trade | `unit: $, higher_is_better: false` |
| 49 | `equity_curve` | `time_series` | Cumulative net P&L over sequential trades | `unit: $, breakeven: 0` |

**What these drive:**
- **Expectancy <= 0:** Model is not viable. Do not deploy. Go back to features/labels.
- **PF > 1.0 but expectancy < $1:** Edge is real but too thin to survive slippage variance. Widen barriers or improve features.
- **Win rate 60% but payoff ratio 0.5:** Wins are tiny, losses are large. The TP barrier is too tight relative to SL. Increase tp_multiplier in HPO.
- **Win rate 35% but payoff ratio 3.0:** Rare wins, but each win is 3x the average loss. Valid strategy — don't chase higher win rate at the expense of payoff ratio.
- **Consecutive losses > 15:** The model fails catastrophically in certain regimes. Cross-reference with per-regime performance.
- **Equity curve flat then spikes:** Edge is episodic, not persistent. The model only works in specific market conditions.

---

## Group 6: Regime & Consistency

Post-training metrics that test whether performance is robust across market conditions and time periods.

| # | Metric | Renderer | Mission | Context |
|---|--------|----------|---------|---------|
| 50 | `pf_per_regime` | `bars` | Profit factor in low / medium / high volatility separately | `labels: [Low Vol, Med Vol, High Vol], breakeven: 1.0` |
| 51 | `wr_per_regime` | `bars` | Win rate in low / medium / high volatility separately | `labels: [Low Vol, Med Vol, High Vol], baseline: 0.5` |
| 52 | `trades_per_regime` | `bars` | Number of trades in each vol regime (denominator for PF/WR) | `labels: [Low Vol, Med Vol, High Vol]` |
| 53 | `fold_profit_factor` | `fold_bars` | Per-fold PF across walk-forward folds | `breakeven: 1.0` |
| 54 | `fold_variance` | `number` | Standard deviation of per-fold profit factors. High = inconsistent | `higher_is_better: false, good: 0.3, bad: 1.0, decimals: 3` |
| 55 | `median_profit_factor` | `gauge` | Median PF across all walk-forward folds. HPO objective | `breakeven: 1.0, good: 1.5, great: 2.0, min: 0, max: 4.0` |

**What these drive:**
- **PF high in low vol, < 1.0 in high vol:** Model can't handle volatile regimes. Add vol-conditioned features, or gate the model off during high-vol (use the vol_regime head for this).
- **Fold variance > 0.8:** Performance swings wildly across time periods. The model is fitting to specific market epochs, not learning general patterns. More regularization or simpler architecture.
- **One fold with PF 4.0, rest at 1.1:** That one fold is carrying the median. The model got lucky in one period. Investigate what was unique about that period.

---

## Implementation Status

| Status | Metric #s | Count |
|--------|-----------|-------|
| Implemented + emitted | 1-18, 20, 22, 27, 29-30, 38-39, 42-44, 47-48, 53, 55 | 30 |
| Declared but not computed | 23 (log_loss) | 1 |
| Removed stub (needs reimplementation) | 24 (brier_score) | 1 |
| **New — must add** | 19, 21, 25-26, 28, 31-37, 40-41, 45-46, 49-52, 54 | 23 |
| **Total** | | **55** |

## Metric Dependency Map

```
Raw OHLCV (QuestDB)
  |
  v
Triple Barrier Labels + Vol Regime + Return Buckets
  |
  v
Train Model (emits Group 1 per epoch)
  |
  v
Best Checkpoint
  |
  v
Inference on Val Set --> softmax probabilities + argmax predictions
  |
  +---> Group 3 (classification quality): needs predictions + actuals + probabilities
  +---> Group 4 (calibration): needs probabilities + actuals
  +---> Group 5 (trading): needs predictions + actual barrier outcomes + returns_at_exit
  +---> Group 6 (regime): needs predictions + vol_regime labels + fold structure
  |
  v
Model Internals
  +---> Group 2 (architecture): needs model + sample input batch
```

## Computation Location

| Group | Where computed | When |
|-------|---------------|------|
| 1. Training Process | `train.py` `_run_epoch()` | Every epoch |
| 2. Architecture | `model.py` diagnostic methods | Post-training, on val batch |
| 3. Classification | `evaluate.py` | Post-training, on full val set |
| 4. Calibration | `evaluate.py` (new functions) | Post-training, on full val set |
| 5. Trading | `evaluate.py` | Post-training, on full val set |
| 6. Regime | `evaluate.py` (new functions) | Post-training, on full val set |

All metrics emitted via `emit_metric()` in `main.py` after training completes. Metric declarations via `get_metric_declarations()` in `io/save.py` before training starts.
