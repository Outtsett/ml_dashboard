# Deep Visual Training Analytics — Design Document

**Date**: 2026-02-28
**Status**: Approved
**Scope**: Production-grade training pipeline improvements + category-aware visualization framework

---

## Problem Statement

The current training pipeline trains models and shows basic results (quality score, SHAP values, regime assignments on chart). Missing: session persistence, model versioning, statistical evaluation, rich signal metadata, walk-forward validation, and — critically — deep visual analytics mapped to each model category so visualizations are ready before models are wired up.

## Design Principles

1. **Config-driven visualization registry** — `visualizations.json` maps category → components. OCP: new model auto-gets its category's visuals.
2. **Visual-first** — every metric has a corresponding visual component, not just a number in a table.
3. **Category-aware** — 8 model groups with distinct visualization needs, plus universal components.
4. **Persistent** — training sessions, metrics, and evaluations survive server restarts.
5. **Statistically rigorous** — permutation tests, calibration curves, significance testing.

---

## Phase 1 — Data Foundation + Signal Contract

### 1.1 Session Persistence

Evolve the existing `trainingSessions` SQLite table. New columns:

| Column | Type | Purpose |
|---|---|---|
| `modelType` | TEXT | hdp-hmm, 2-state-hmm, etc. |
| `symbol` | TEXT | ES, NQ, etc. |
| `timeframe` | TEXT | 1h, 4h, 1d |
| `versionedModelId` | TEXT | `ES_1h_hdp-hmm_20260227T143022` |
| `hyperparameters` | TEXT (JSON) | Full resolved hyperparameters |
| `featureCategories` | TEXT (JSON) | Which feature categories used |
| `trainDateStart` | INTEGER | Training window start (epoch ms) |
| `trainDateEnd` | INTEGER | Training window end (epoch ms) |
| `testDateStart` | INTEGER | Test window start |
| `testDateEnd` | INTEGER | Test window end |
| `totalBars` | INTEGER | Bars in training set |
| `totalFeatures` | INTEGER | Features used |
| `modelPath` | TEXT | Filesystem path to saved model |
| `diagnostics` | TEXT (JSON) | Full diagnostics blob |
| `qualityScore` | REAL | 0-100 composite quality |
| `evaluationGrade` | TEXT | A/B/C/D/F composite grade |
| `walkForwardGroupId` | TEXT | Links windows in same WF run |
| `windowIndex` | INTEGER | Which WF window (0, 1, 2...) |
| `errorMessage` | TEXT | Error details if failed |
| `elapsedSec` | REAL | Total wall-clock time |
| `resourcePeakMemoryMb` | REAL | Peak memory usage |
| `resourceAvgCpuPct` | REAL | Average CPU during training |

**Lifecycle**:
- Write on session create (status: running)
- Update on progress (currentEpoch, currentLoss)
- Finalize on done/error (status, diagnostics, qualityScore, elapsedSec)
- On server restart: mark in-flight sessions as `failed`

### 1.2 Model Versioning

Current: `modelId = ${sym}_${tf}_${modelType}` — overwrites previous.

New: `versionedModelId = ${sym}_${tf}_${modelType}_${ISO timestamp}`

Example: `ES_1h_hdp-hmm_20260227T143022`

- Every training run gets a unique version
- Model list page shows all versions, sortable by quality score
- `modelId` field (without timestamp) kept for "latest model" queries
- Old models are never auto-deleted — user manages disk space

### 1.3 Rich Signal Contract

Enrich QuestDB `model_regimes` table with 6 new columns:

| Column | Type | Source | Description |
|---|---|---|---|
| `confidence` | DOUBLE | max(posterior[t]) | Probability assigned to the chosen regime (0-1) |
| `entropy` | DOUBLE | -sum(p[k] log p[k]) | Uncertainty measure — high = model unsure |
| `magnitude` | DOUBLE | regime mean return | Expected return in this regime |
| `volatility` | DOUBLE | regime return stdev | Expected volatility in this regime |
| `duration_bars` | INT | avg consecutive run | Expected bars until regime transition |
| `transition_prob` | DOUBLE | 1 - P(stay) | Probability of regime change at this bar |

**Python implementation**:
- HDP-HMM: posteriors from Gibbs samples, transition matrix from sticky DP
- 2-State HMM: gamma posteriors from forward-backward, transition matrix A
- Magnitude/volatility: grouped return statistics per regime
- Duration: run-length statistics per regime
- All computed in `save.py` alongside existing regime/label columns

### 1.4 Training Metrics Table

New SQLite table `training_metrics`:

```
id              INTEGER PK
sessionId       INTEGER FK → trainingSessions
iteration       INTEGER
metricName      TEXT        -- 'log_likelihood', 'n_active_states', 'convergence_delta'
metricValue     REAL
timestamp       INTEGER     -- epoch ms
```

Index: `(sessionId, metricName, iteration)`

Python emits metrics via existing `emit_metric()` → server writes to this table as events arrive. Enables convergence curve comparison across runs.

### 1.5 Evaluation Results Table

New SQLite table `evaluation_results`:

```
id              INTEGER PK
sessionId       INTEGER FK → trainingSessions
stage           TEXT        -- regime_quality, significance, oos_validation, conditioned_performance, benchmark
testName        TEXT        -- silhouette_score, permutation_test, regime_sharpe, etc.
testValue       REAL
testPassed      INTEGER     -- 0/1
pValue          REAL        -- statistical significance (if applicable)
details         TEXT (JSON) -- full test output for drill-down
computedAt      INTEGER     -- epoch ms
```

Index: `(sessionId, stage, testName)`

### 1.6 Walk-Forward Validation

New fields in `TrainingRequest`:

```typescript
walkForward?: {
  trainMonths: number;      // in-sample window (e.g., 12)
  testMonths: number;       // out-of-sample window (e.g., 3)
  stepMonths?: number;      // roll step (default = testMonths)
}
```

**Orchestration**:
1. Compute N windows from date range
2. Spawn Python sequentially per window (same script, different date args)
3. Each window: versioned model ID with `_wN` suffix
4. All windows linked by `walkForwardGroupId` in SQLite
5. After all windows: compute aggregate walk-forward metrics

**Walk-forward aggregate metrics**:
- Regime count stability (std dev of N_regimes across windows)
- Transition matrix similarity (Frobenius norm)
- Out-of-sample confidence mean
- Confidence decay rate (linear regression of confidence vs window index)
- Regime-conditioned return consistency across windows
- Cross-window regime mapping (Hungarian matching on return profiles)

**SSE events**:
- `walk-forward-window-start`: `{ window, totalWindows, trainRange, testRange }`
- Regular `progress`, `metric`, `overlay` per window
- `walk-forward-window-done`: `{ window, qualityScore, nRegimes, confidence }`
- `walk-forward-summary`: `{ aggregateMetrics, perWindowSummary[] }`

### 1.7 Evaluation Stages 1-2 (Python-side)

Run after model training in the Python script.

**Stage 1: Regime Quality Assessment**

| Test | Pass Criteria |
|---|---|
| Silhouette score | > 0.2 |
| Calinski-Harabasz index | Higher = better separation |
| Davies-Bouldin index | < 1.5 |
| Regime return separation (Welch's t-test) | p < 0.05 for at least 2 pairs |
| Regime volatility separation (Levene's test) | p < 0.05 |
| Minimum regime duration | Median > 5 bars |

**Stage 2: Statistical Significance**

| Test | Method |
|---|---|
| Permutation test | Shuffle 1000x, compare real quality to random distribution. Opt-in via `--run-significance-tests` |
| Bootstrap confidence intervals | Resample 100x, compute regime assignment agreement |
| Information ratio vs random walk | Compare regime-conditioned returns against null model |
| Regime persistence test | Compare durations to Markov chain with same transition matrix |

Results written as structured JSON in `diagnostics`, also inserted into `evaluation_results` table via POST from Python.

### 1.8 Visualization Registry

New config file `config/visualizations.json`:

```json
{
  "version": 1,
  "universal": [
    "convergence-panel",
    "feature-correlation-matrix",
    "train-test-split-timeline",
    "walk-forward-windows",
    "confidence-calibration",
    "data-quality-panel",
    "resource-usage"
  ],
  "groups": {
    "clustering": {
      "subcategories": ["clustering", "self-organizing", "probabilistic-mixture"],
      "components": [
        "regime-timeline",
        "transition-sankey",
        "cluster-scatter",
        "posterior-heatmap",
        "cluster-profile-cards",
        "silhouette-plot",
        "elbow-bic-curve"
      ],
      "conditional": {
        "hierarchical": ["dendrogram"],
        "som": ["som-grid"]
      }
    },
    "dimensionality-reduction": {
      "subcategories": ["dimensionality-reduction"],
      "components": [
        "scatter-2d-3d",
        "explained-variance-bar",
        "component-loadings-heatmap",
        "reconstruction-error-plot",
        "biplot"
      ],
      "conditional": {
        "manifold": ["manifold-surface"],
        "umap": ["neighborhood-graph"],
        "tsne": ["neighborhood-graph"]
      }
    },
    "anomaly-detection": {
      "subcategories": ["anomaly-detection"],
      "components": [
        "anomaly-timeline",
        "score-distribution",
        "decision-boundary",
        "feature-contribution-breakdown",
        "anomaly-cluster-view"
      ]
    },
    "classification": {
      "subcategories": ["classification", "meta-learner"],
      "components": [
        "confusion-matrix-heatmap",
        "roc-curve",
        "precision-recall-curve",
        "feature-importance-bar",
        "shap-beeswarm",
        "shap-waterfall",
        "calibration-plot",
        "prediction-timeline",
        "profit-curve",
        "learning-curve"
      ]
    },
    "regression": {
      "subcategories": ["regression", "linear", "regression-techniques"],
      "components": [
        "residual-plot",
        "prediction-vs-actual",
        "residual-distribution",
        "coefficient-bar",
        "prediction-interval",
        "rolling-error",
        "quantile-fan"
      ],
      "conditional": {
        "lasso-regression": ["regularization-path"],
        "ridge-regression": ["regularization-path"],
        "elasticnet-regression": ["regularization-path"]
      }
    },
    "sequence": {
      "subcategories": ["sequence", "time-series", "recurrent-and-sequential", "attention-based"],
      "components": [
        "forecast-ribbon",
        "attention-heatmap",
        "hidden-state-timeline",
        "layer-activation-map",
        "gradcam-overlay",
        "multi-horizon-error",
        "sequence-embedding"
      ]
    },
    "ensemble-boosting": {
      "subcategories": ["ensemble", "boosting"],
      "components": [
        "boosting-loss-curve",
        "tree-count-vs-error",
        "feature-importance-3way",
        "shap-dependence-plot",
        "shap-interaction",
        "individual-tree-viz",
        "ensemble-diversity",
        "stacking-weights"
      ]
    },
    "deep-learning": {
      "subcategories": ["deep-learning", "convolutional-networks", "feedforward-and-mlps", "generative-and-latent-models"],
      "components": [
        "loss-surface-3d",
        "training-curves",
        "gradient-flow",
        "activation-distribution",
        "weight-distribution",
        "embedding-space",
        "reconstruction-grid",
        "latent-space-walk"
      ]
    }
  }
}
```

**Resolution logic** (client-side):
1. Look up model's `category` and `subcategory` from registry
2. Find matching group in `visualizations.json` (match on subcategory)
3. Collect: universal components + group components + conditional components (if model ID matches)
4. Render those components in the training results panel

---

## Phase 2 — Visualization Components

### Universal Components (all models)

#### 2.1 Convergence Panel
- Line chart of all metrics from `training_metrics` table
- X-axis: iteration. Y-axis: metric value. Multiple series (log_likelihood, n_active_states, etc.)
- Toggleable series. Zoom/pan.
- **Data**: `SELECT metricName, iteration, metricValue FROM training_metrics WHERE sessionId = ?`

#### 2.2 Feature Correlation Matrix
- Heatmap of input feature correlations
- Computed from the feature matrix used in training
- Highlights highly correlated pairs (potential multicollinearity)
- **Data**: correlation matrix emitted by Python as JSON in diagnostics

#### 2.3 Train/Test Split Timeline
- Horizontal bar showing the full date range
- Color segments: blue = train, orange = test
- Walk-forward mode: alternating blue/orange segments for each window
- Tick marks at window boundaries
- **Data**: trainDateStart/End, testDateStart/End from session

#### 2.4 Walk-Forward Windows
- Horizontal swimlane chart
- Each row = a walk-forward window
- Color intensity = quality score (dark green = high, red = low)
- Hover: shows metrics for that window
- Click: loads that window's detailed results
- Summary bar at bottom: aggregate metrics
- **Data**: walk-forward summary from diagnostics

#### 2.5 Confidence Calibration
- Reliability diagram: predicted confidence (x) vs actual accuracy (y)
- Perfect calibration = 45-degree line
- Histogram of prediction counts per confidence bin
- **Data**: confidence column from model_regimes + ground truth comparison

#### 2.6 Data Quality Panel
- Bar chart: missing values per feature
- Distribution plots: skew, kurtosis per feature
- Outlier count per feature
- Time-series coverage plot (gaps in data)
- **Data**: computed in Python during feature engineering, emitted in diagnostics

#### 2.7 Resource Usage
- Dual-axis time chart: memory (MB, left) + CPU (%, right)
- Peak markers annotated
- Wall-clock elapsed overlay
- **Data**: Python emits psutil metrics every 10s via emit_metric()

### Group 1: Clustering / Regime Visuals

#### 2.8 Regime Timeline (enhanced)
- Already exists. Enhance with:
  - Opacity = confidence (low confidence = faded regime color)
  - Transition probability as sub-chart (line, 0-1)
  - Entropy as sub-chart

#### 2.9 Transition Sankey
- D3 Sankey diagram
- Nodes = regimes, flows = transition counts/probabilities
- Flow width proportional to transition probability
- Color = regime color
- **Data**: transition matrix from diagnostics

#### 2.10 Cluster Scatter (2D/3D)
- R3F (Three.js) 3D scatter for >2 components, Recharts 2D for 2
- Points = bars, color = regime assignment
- Size = confidence (bigger = more certain)
- Centroids marked with larger symbols
- PCA projection of feature space
- **Data**: PCA-projected features + assignments from Python

#### 2.11 Posterior Heatmap
- Time (x) × Regime (y) matrix
- Cell color intensity = posterior probability
- Winner regime outlined/bolded
- Shows uncertainty: bright row = clear regime, diffuse = uncertain
- **Data**: posterior matrix from Python (new output)

#### 2.12 Cluster Profile Cards
- One card per discovered regime
- Each card contains:
  - Return distribution (histogram + KDE)
  - Volatility distribution
  - Feature radar chart (top 10 features)
  - Duration distribution (how long this regime typically lasts)
  - Entry pattern (average price action 10 bars before entering this regime)
  - Exit pattern (average price action 10 bars after leaving)
  - Sample count + proportion of total data
- **Data**: per-regime statistics from diagnostics

#### 2.13 Silhouette Plot
- Per-sample silhouette coefficient, grouped by cluster, sorted
- Good clusters: tall, uniform bars above 0
- Poor clusters: many bars below 0
- Average silhouette line
- **Data**: sklearn.metrics.silhouette_samples output from Python

#### 2.14 Elbow / BIC Curve
- X: number of clusters. Y: quality metric (inertia, BIC, silhouette)
- "Elbow" point annotated
- Only for models that require K (K-Means, GMM — not HDP-HMM)
- **Data**: multiple runs with different K values (opt-in)

#### 2.15 Dendrogram (conditional: hierarchical)
- D3 dendrogram tree
- Cut line showing chosen number of clusters
- Color-coded by cluster assignment
- **Data**: linkage matrix from scipy

#### 2.16 SOM Grid (conditional: som)
- 2D hex/grid colored by feature values
- Hit map (how many samples per node)
- U-matrix (distance between adjacent nodes)
- **Data**: SOM weight matrix + hit counts

### Group 2: Dimensionality Reduction Visuals

#### 2.17 Scatter Plot (2D/3D)
- Projected data points
- Color options: by regime, by return, by time, by volatility
- Interactive: hover shows original feature values
- Linked brushing with price chart (select points → highlight on chart)
- **Data**: projected coordinates from model output

#### 2.18 Explained Variance Bar
- Bar chart: variance explained per component
- Cumulative line overlay
- Threshold annotation (e.g., "95% variance at 5 components")
- **Data**: PCA/NMF explained_variance_ratio

#### 2.19 Component Loadings Heatmap
- Features (y) × Components (x) matrix
- Color = loading magnitude (diverging colormap)
- Rows sorted by max loading
- **Data**: PCA components_ / ICA mixing_ / NMF components_

#### 2.20 Reconstruction Error Plot
- X: number of components. Y: reconstruction error
- Diminishing returns visible
- Chosen N annotated
- **Data**: multiple reconstructions at different N

#### 2.21 Biplot (PCA-specific)
- Scatter + loading vectors
- Points colored by regime/return
- Arrows show feature directions in PC space
- **Data**: PCA scores + loadings

### Group 3: Anomaly Detection Visuals

#### 2.22 Anomaly Timeline
- Price chart with anomaly score overlay (semi-transparent area chart)
- Threshold line
- Detected anomalies marked with icons
- **Data**: anomaly scores per bar

#### 2.23 Score Distribution
- Histogram of anomaly scores
- Normal vs anomaly distributions overlaid
- Threshold line with count annotations
- **Data**: anomaly scores

#### 2.24 Decision Boundary
- 2D projection (PCA top-2) with decision boundary contour
- Normal region vs anomaly region
- Misclassified points highlighted
- **Data**: grid of model predictions + actual labels

#### 2.25 Feature Contribution Breakdown
- For each top-N anomaly: stacked bar showing which features contributed
- Waterfall chart style
- **Data**: per-anomaly feature contributions (if model supports)

#### 2.26 Anomaly Cluster View
- Group anomalies by type (proximity in feature space)
- Scatter plot colored by anomaly type
- Side panel: example anomalies from each type
- **Data**: clustering of anomaly instances

### Group 4: Classification Visuals

#### 2.27 Confusion Matrix Heatmap
- Already exists as component. Enhance with:
  - Normalized mode (percentages)
  - Per-class precision/recall annotations on margins
- **Data**: predictions vs actual labels

#### 2.28 ROC Curve
- Per-class ROC with AUC annotation
- Micro/macro average curves
- Random classifier diagonal reference
- **Data**: probability outputs + true labels

#### 2.29 Precision-Recall Curve
- Per-class PR curves with AP annotation
- Iso-F1 contour lines
- **Data**: probability outputs + true labels

#### 2.30 Feature Importance Bar
- Horizontal bar chart, sorted descending
- Color by feature category
- Error bars (if permutation importance)
- **Data**: model feature importances

#### 2.31 SHAP Beeswarm
- D3 beeswarm plot
- X: SHAP value, Y: feature (sorted by importance)
- Color: feature value (low=blue, high=red)
- **Data**: SHAP values matrix

#### 2.32 SHAP Waterfall
- For a single selected prediction
- Stacked bars showing each feature's push toward / away from prediction
- Base value → final prediction
- Interactive: select any bar on chart → waterfall updates
- **Data**: SHAP values for selected instance

#### 2.33 Calibration Plot
- Predicted probability vs actual frequency
- Binned (10-20 bins)
- Perfect calibration = diagonal
- Brier score annotation
- **Data**: predicted probabilities + actual outcomes

#### 2.34 Prediction Timeline
- Predicted class overlaid on price chart as background color
- Confidence as opacity
- Correct/incorrect markers
- **Data**: predictions + actuals per bar

#### 2.35 Profit Curve
- Cumulative return if trading the classification signals
- Long on "bull" prediction, short on "bear", flat on "neutral"
- Benchmark (buy & hold) overlay
- **Data**: predictions + price data

#### 2.36 Learning Curve
- Train size (x) vs accuracy (y) for both train and val
- Shows if model needs more data or is overfitting
- **Data**: training at multiple subset sizes (opt-in)

### Group 5: Regression Visuals

#### 2.37 Residual Plot
- Already exists as component. Enhance with:
  - Residuals vs predicted, vs time, vs each feature
  - LOESS smoothing line for pattern detection
- **Data**: predictions, actuals, features

#### 2.38 Prediction vs Actual
- Scatter plot + 45-degree reference line
- R-squared annotation
- Color by time (older=faded)
- **Data**: predictions, actuals

#### 2.39 Residual Distribution
- Histogram + KDE overlay
- Q-Q plot for normality check
- Shapiro-Wilk test result annotation
- **Data**: residuals

#### 2.40 Coefficient Bar
- Horizontal bars for each feature coefficient
- Positive = green, negative = red
- Sorted by absolute magnitude
- Confidence intervals (if available)
- **Data**: model coefficients

#### 2.41 Prediction Interval
- Price chart with prediction as center line
- Confidence band (e.g., 95% prediction interval)
- Actuals overlaid
- **Data**: predictions + intervals

#### 2.42 Rolling Error
- MAE/RMSE computed on rolling windows
- Time series chart showing error evolution
- Degradation detection: is error increasing?
- **Data**: rolling computation from predictions/actuals

#### 2.43 Quantile Fan (conditional: quantile regression)
- Multiple quantile predictions (10th, 25th, 50th, 75th, 90th) as fan chart
- Price line overlaid
- **Data**: quantile regression outputs

#### 2.44 Regularization Path (conditional: Lasso/Ridge/ElasticNet)
- X: regularization strength (log scale). Y: coefficient values
- Each line = one feature
- Shows which features survive stronger regularization
- **Data**: model trained at multiple alpha values

### Group 6: Sequence / Time-Series Visuals

#### 2.45 Forecast Ribbon
- Already exists as component. Enhance with:
  - Multi-step fan chart (wider = longer horizon)
  - Confidence bands from multiple model outputs
- **Data**: multi-step predictions + confidence

#### 2.46 Attention Heatmap
- X: input timestep. Y: output timestep (or query position)
- Color = attention weight
- Multi-head: tabs or small multiples
- Click output timestep → highlights which inputs it attended to
- **Data**: attention weight matrices

#### 2.47 Hidden State Timeline
- Time series of hidden state activations
- Color-coded by dimension
- Clustered dimensions shown as aggregate bands
- **Data**: RNN/LSTM hidden states per timestep

#### 2.48 Layer Activation Map (CNN)
- Grid of activation maps per convolutional filter
- Input → Layer 1 → Layer 2 → ... → Output
- Click a filter to see what it responds to
- **Data**: per-layer activations

#### 2.49 GradCAM Overlay
- Price chart with GradCAM heatmap overlay
- Highlights which input bars contributed to the prediction
- **Data**: GradCAM attribution per timestep

#### 2.50 Multi-Horizon Error
- X: forecast horizon (1, 5, 10, 20 bars). Y: error metric
- Shows error degradation with longer horizons
- Benchmark lines (naive persistence, random walk)
- **Data**: per-horizon error computation

#### 2.51 Sequence Embedding
- t-SNE/UMAP of learned representations per window
- Color by return, regime, time
- Clusters = similar market conditions
- **Data**: encoder output representations

### Group 7: Ensemble / Boosting Visuals

#### 2.52 Boosting Loss Curve
- Train + validation loss per boosting round
- Early stopping point annotated
- **Data**: per-round metrics from XGBoost/LightGBM training

#### 2.53 Tree Count vs Error
- X: number of trees. Y: error. Train + val curves
- Optimal point annotated (before overfitting)
- **Data**: per-tree metrics

#### 2.54 Feature Importance 3-Way
- Three side-by-side bar charts: Gain, Cover (split count), Frequency
- Same features, different importance orderings
- Highlights where rankings disagree
- **Data**: XGBoost/LightGBM feature importance by type

#### 2.55 SHAP Dependence Plot
- Per-feature: feature value (x) vs SHAP value (y)
- Color by interaction feature
- Reveals non-linear relationships
- **Data**: SHAP values + feature values

#### 2.56 SHAP Interaction
- Heatmap: feature × feature interaction strength
- Click cell to see dependence plot for that pair
- **Data**: SHAP interaction values

#### 2.57 Individual Tree Visualization
- D3 tree diagram of a single decision tree
- Node color = prediction direction
- Node size = sample count
- Selectable tree index
- **Data**: tree structure export from model

#### 2.58 Ensemble Diversity
- Pairwise disagreement matrix between base learners
- Higher diversity = better ensemble
- **Data**: per-learner predictions compared

#### 2.59 Stacking Weights
- Bar chart of base model weights in stacking ensemble
- **Data**: meta-learner coefficients

### Group 8: Deep Learning Visuals

#### 2.60 Loss Surface 3D
- Already exists as component. Enhance with:
  - Interactive rotation/zoom (Three.js)
  - Current position marker on surface
  - Trajectory path overlaid
- **Data**: loss evaluated on grid of 2 parameter directions

#### 2.61 Training Curves
- Train/val loss + accuracy over epochs
- LR schedule overlay (if applicable)
- **Data**: per-epoch metrics

#### 2.62 Gradient Flow
- Per-layer gradient magnitude over training
- Heatmap: layers (x) × epochs (y) → gradient magnitude (color)
- Detects vanishing/exploding gradients
- **Data**: gradient norms per layer per epoch

#### 2.63 Activation Distribution
- Per-layer activation histograms
- At different training stages (early, mid, late)
- Dead neuron detection (stuck at 0)
- **Data**: activation samples per layer

#### 2.64 Weight Distribution
- Per-layer weight histograms
- Before vs after training comparison
- **Data**: weight tensors

#### 2.65 Embedding Space
- t-SNE/UMAP of learned representations
- Color by label/return/regime
- Shows if model learned meaningful structure
- **Data**: penultimate layer activations

#### 2.66 Reconstruction Grid (conditional: autoencoder)
- Side-by-side: original input windows vs reconstructed
- Sorted by reconstruction error
- **Data**: encoder-decoder outputs

#### 2.67 Latent Space Walk (conditional: VAE/AE)
- Interpolation between two points in latent space
- Shows how reconstructed output changes
- **Data**: decoder outputs along interpolation path

---

## Phase 3 — Evaluation Depth + Polish

### 3.1 Evaluation Stages 3-5 (Server-side, Post-training)

**Stage 3: Out-of-Sample Validation**

| Metric | Method |
|---|---|
| OOS regime accuracy | Compare to re-trained model on test data |
| OOS confidence calibration | Reliability diagram on test periods only |
| OOS return separation | Welch's t-test on test-period returns per regime |
| Regime transition prediction | Precision/recall of P(transition)>0.5 signals |

**Stage 4: Regime-Conditioned Performance**

| Metric | Method |
|---|---|
| Regime-conditioned Sharpe | Sharpe ratio within each regime |
| Long in bull / short in bear | Cumulative return of regime-following strategy |
| Transition returns | Average N-bar return after regime transitions |
| Regime stability premium | Return in high-confidence vs low-confidence periods |
| Max regime drawdown | Worst drawdown within each regime |

**Stage 5: Benchmarking**

| Comparison | Method |
|---|---|
| vs. Buy & Hold | Total return comparison |
| vs. 50/200 SMA crossover | Simple trend-following baseline |
| vs. Fixed 2-state model | Is more complex model better than simplest HMM? |
| vs. Previous version | Compare to last training for same symbol/timeframe |
| Diebold-Mariano test | Statistical significance of forecast differences |

### 3.2 Evaluation Grade Rubric

| Grade | Criteria |
|---|---|
| **A** | All Stage 1 pass + Stage 2 permutation p < 0.01 + OOS calibrated + regime Sharpe > 1.0 |
| **B** | All Stage 1 pass + Stage 2 permutation p < 0.05 + OOS return separation |
| **C** | Most Stage 1 pass + OOS confidence > 0.6 mean |
| **D** | Some Stage 1 pass but significance tests fail |
| **F** | Cluster quality below random or regimes don't separate returns |

### 3.3 Interactive Drill-Down

- Click a regime on the chart → expands to cluster profile card
- Click a feature on the profile card → SHAP waterfall for that feature
- Click a walk-forward window → loads that window's full evaluation
- Click an evaluation test → shows full details + distribution plot

### 3.4 Model Degradation Tracking

- Compare quality scores across training sessions for same symbol/timeframe
- Sparkline per model showing score trajectory
- Alert when score drops >15% vs 3-session average

---

## Component Technology Stack

| Visual Type | Library | Rationale |
|---|---|---|
| Line/bar/area charts | Recharts | Already in stack, consistent |
| Heatmaps | D3 | More control for large matrices |
| 3D scatter/surface | Three.js / R3F | Already in stack |
| Sankey diagrams | D3-sankey | Standard for flow visualization |
| Tree diagrams | D3-hierarchy | Standard for dendrograms/trees |
| Beeswarm plots | D3 | Custom layout needed |
| Radar charts | Recharts | Built-in support |

---

## New Files (Estimated)

### Config
- `config/visualizations.json` — visualization registry

### Schema
- Evolve `trainingSessions` in `shared/schema.ts` (add columns)
- Add `training_metrics` table to `shared/schema.ts`
- Add `evaluation_results` table to `shared/schema.ts`

### Server
- `server/training/versioning.ts` — model ID generation + versioning logic
- `server/training/walkforward.ts` — walk-forward window computation + orchestration
- `server/training/evaluation.ts` — server-side evaluation stages 3-5
- `server/storage/trainingStorage.ts` — SQLite CRUD for sessions + metrics + evaluations
- `server/routes/training.ts` — extend with evaluation endpoints

### Python
- `shared/evaluation.py` — stages 1-2 (regime quality + significance)
- `shared/signals.py` — compute confidence, entropy, magnitude, volatility, duration, transition_prob
- Extend `hdp_hmm/io/save.py` — emit new signal columns
- Extend `hmm_2state/main.py` — emit new signal columns

### Client Components (60+ visualization components)
- `components/training/universal/` — 7 universal components
- `components/training/clustering/` — 9 clustering components
- `components/training/dimreduction/` — 5 dim-reduction components
- `components/training/anomaly/` — 5 anomaly components
- `components/training/classification/` — 10 classification components
- `components/training/regression/` — 8 regression components
- `components/training/sequence/` — 7 sequence components
- `components/training/ensemble/` — 8 ensemble/boosting components
- `components/training/deeplearning/` — 8 deep learning components
- `components/training/VisualizationRouter.tsx` — reads registry, renders components

### Client Hooks
- `hooks/useTrainingMetrics.ts` — fetch convergence data
- `hooks/useEvaluationResults.ts` — fetch evaluation stages
- `hooks/useWalkForward.ts` — fetch walk-forward summary
- `hooks/useVisualizationRegistry.ts` — resolve components for model category

---

## API Additions

| Route | Method | Purpose |
|---|---|---|
| `/training/sessions` | GET | List all persisted training sessions |
| `/training/sessions/:id` | GET | Full session detail + diagnostics |
| `/training/sessions/:id/metrics` | GET | Per-iteration metrics time series |
| `/training/sessions/:id/evaluation` | GET | All evaluation results by stage |
| `/training/sessions/:id/evaluation/:stage` | GET | Specific evaluation stage |
| `/training/walk-forward/:groupId` | GET | Walk-forward summary + per-window results |
| `/training/visualizations/:category` | GET | Component list for model category |

---

## Non-Goals (Explicitly Out of Scope)

- **Model tournament / arena leaderboard** — not needed
- **Automated retraining / scheduling** — future consideration
- **Real-time inference pipeline** — training analytics only
- **New model implementations** — visuals prepared, wiring deferred
