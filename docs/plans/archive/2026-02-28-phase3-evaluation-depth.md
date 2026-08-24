# Phase 3: Evaluation Depth + Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add server-side evaluation stages 3-5 (OOS validation, regime-conditioned performance, benchmarking), composite grading, interactive drill-down in Phase 2 components, and model degradation tracking across training sessions.

**Architecture:** Python `evaluation.py` grows 3 new stage functions that compute metrics from existing QuestDB data (model_regimes + OHLCV). Server-side `evaluation.ts` orchestrates post-training evaluation and enriches the diagnostics blob. Client-side Phase 2 components gain onClick handlers that expand detail panels. A new `ModelHistory` component shows quality score sparklines across sessions.

**Tech Stack:** Python (numpy, scipy.stats), TypeScript (Express routes, Drizzle ORM), React (Recharts, Framer Motion for expand/collapse), QuestDB SQL queries, SQLite evaluation_results table.

**Phases 1-2 Already Built:**
- `src/ml/shared/evaluation.py` — Stage 1 (regime quality) + Stage 2 (significance)
- `src/server/storage/trainingStorage.ts` — Full CRUD for sessions, metrics, evaluations
- `src/server/routes/training.ts` — All session/metrics/evaluation API routes
- `src/client/src/hooks/useEvaluationResults.ts` — React hooks for evaluation data
- `src/client/src/components/training/analytics/` — 14 components (ConfidenceCalibration, ClusterProfileCards, WalkForwardWindows, SilhouettePlot, etc.)
- `src/client/src/components/training/types.ts` — Diagnostics, RegimeStat, OOSResult, Verdict interfaces

**Data Availability (what we can actually compute):**
- `model_regimes` table: per-bar regime, confidence, entropy, magnitude, volatility, duration_bars, transition_prob, close, split (train/test)
- `model_shap` table: per-bar SHAP values for 29 features
- QuestDB `ohlcv` table: 759.5M rows of OHLCV for benchmark computation
- `diagnostics.json`: regime_stats, transition_matrix, convergence_summary, walk_forward, out_of_sample, evaluation (stages 1-2), shap_summary
- SQLite `trainingSessions`: historical sessions with qualityScore, evaluationGrade, symbol, timeframe, modelType

---

## Milestone 1: Evaluation Stages 3-5 (Python)

### Task 1: Stage 3 — OOS Validation Metrics

**Files:**
- Modify: `src/ml/shared/evaluation.py`

**Context:** Stages 1-2 already exist in this file. Stage 3 adds OOS-specific statistical tests that compare train vs test performance. These use the `split` column in model_regimes to separate train/test data. The existing `out_of_sample` section in diagnostics gives distribution similarity — Stage 3 goes deeper with statistical tests.

**SOLID:** OCP — add `run_stage3_oos_validation()` function alongside existing stage functions. Same return contract: `dict[str, {value, passed, p_value, details}]`.

**Implementation:**

Add after `run_stage2_significance()`:

```python
def run_stage3_oos_validation(
    train_assignments: np.ndarray,   # (T_train,) regime ids
    test_assignments: np.ndarray,    # (T_test,) regime ids
    train_close: np.ndarray,         # (T_train,) prices
    test_close: np.ndarray,          # (T_test,) prices
    train_confidence: np.ndarray,    # (T_train,) confidence values
    test_confidence: np.ndarray,     # (T_test,) confidence values
    transition_matrix: np.ndarray,   # (K, K) transition probabilities
    iteration: int = 0,
) -> dict:
    """
    Stage 3: Out-of-Sample Validation.

    Tests:
    - OOS confidence calibration (mean test confidence vs train)
    - OOS return separation (Welch's t-test on test-period returns per regime)
    - Regime transition prediction (P(transition) > 0.5 → precision/recall)
    - Regime distribution drift (chi-squared test: train vs test regime counts)
    """
```

**Tests to implement:**

1. **oos_confidence_calibration**: Compare mean confidence in train vs test. Pass if test_mean >= 0.7 * train_mean (confidence doesn't collapse OOS).
2. **oos_return_separation**: Same Welch's t-test as Stage 1, but on TEST data only. Pass if ≥1 pair significant at p < 0.05.
3. **regime_transition_prediction**: Use `transition_prob` column. Where transition_prob > 0.5, check if regime actually changed next bar. Compute precision and recall. Pass if precision > 0.3 (better than random).
4. **regime_distribution_drift**: Chi-squared test on regime counts (train vs test proportions). Pass if p > 0.05 (distributions NOT significantly different = good).

Each test follows the same dict format: `{value, passed, p_value, details}`.

Emit metrics via `emit_metric()` for each test.

**Step 1:** Add the function with all 4 tests.
**Step 2:** Add a helper `_compute_regime_log_returns(assignments, close)` that returns `{regime_id: array_of_returns}` — reuse in both Stage 1 and Stage 3.
**Commit:** `feat(eval): add Stage 3 OOS validation metrics`

---

### Task 2: Stage 4 — Regime-Conditioned Performance

**Files:**
- Modify: `src/ml/shared/evaluation.py`

**Context:** This stage answers "if you traded these regimes, would you make money?" It computes financial performance metrics per regime using the OHLCV close prices and regime assignments.

**SOLID:** OCP — add `run_stage4_conditioned_performance()`. Same contract.

**Implementation:**

```python
def run_stage4_conditioned_performance(
    assignments: np.ndarray,    # (T,) full dataset assignments
    close: np.ndarray,          # (T,) close prices
    split_idx: int,             # index where test period starts
    iteration: int = 0,
) -> dict:
    """
    Stage 4: Regime-Conditioned Performance.

    Tests:
    - regime_sharpe: Per-regime annualized Sharpe ratio. Pass if any regime Sharpe > 0.5.
    - long_bull_short_bear: Cumulative return of long-in-highest-return-regime, short-in-lowest.
      Pass if strategy return > 0 on test data.
    - transition_returns: Average 5-bar return after regime transitions. Pass if magnitude > 0.
    - stability_premium: Compare returns in high-confidence (>0.7) vs low-confidence periods.
      Pass if high-confidence returns are better.
    - max_regime_drawdown: Worst drawdown within each regime. Report only (no pass/fail).
    """
```

**Tests to implement:**

1. **regime_sharpe**: For each regime, compute log returns, annualize (×√252 for daily or √(252×bars_per_day)). Pass if max regime Sharpe > 0.5. Details: per-regime Sharpe dict.
2. **long_bull_short_bear**: Identify highest avg-return regime ("bull") and lowest ("bear"). Compute cumulative return: +1 when in bull, -1 when in bear, 0 otherwise. Evaluate on TEST portion only. Pass if cumulative > 0.
3. **transition_returns**: Find all bars where regime changes. Compute average 5-bar forward return after transitions. Pass if abs(mean) > 0.001 (transitions have predictive content).
4. **stability_premium**: Split bars into high-confidence (>0.7) and low-confidence. Compare mean returns. Pass if high-confidence absolute returns are larger.
5. **max_regime_drawdown**: Per-regime max drawdown. Report-only (value = worst across regimes, passed = true always, details = per-regime drawdowns).

**Step 1:** Implement all 5 tests.
**Step 2:** Add helper `_annualized_sharpe(returns, bars_per_year=252)`.
**Commit:** `feat(eval): add Stage 4 regime-conditioned performance`

---

### Task 3: Stage 5 — Benchmarking

**Files:**
- Modify: `src/ml/shared/evaluation.py`

**Context:** Compares the regime model's signals against naive baselines. Uses OHLCV close prices for buy-and-hold and SMA crossover. "vs previous version" requires access to the previous model's diagnostics — we'll skip that for now (server-side concern) and focus on the 3 self-contained benchmarks.

**SOLID:** OCP — add `run_stage5_benchmarking()`. Same contract.

**Implementation:**

```python
def run_stage5_benchmarking(
    assignments: np.ndarray,    # (T,) regime assignments
    close: np.ndarray,          # (T,) close prices
    split_idx: int,             # test period start
    iteration: int = 0,
) -> dict:
    """
    Stage 5: Benchmarking.

    Tests:
    - vs_buy_and_hold: Compare regime-following strategy return to B&H on test data.
      Pass if regime strategy outperforms.
    - vs_sma_crossover: 50/200 SMA crossover baseline on test data.
      Pass if regime strategy outperforms.
    - regime_information_ratio: Annualized IR of regime strategy vs B&H.
      Pass if IR > 0.
    """
```

**Tests:**

1. **vs_buy_and_hold**: Regime strategy = +1 in highest-return regime, -1 in lowest, 0 otherwise. Buy-and-hold = always +1. Compare cumulative returns on test data. Pass if regime > B&H.
2. **vs_sma_crossover**: Compute 50-period and 200-period SMA on close. SMA strategy = +1 when SMA50 > SMA200, -1 otherwise. Compare to regime strategy on test data. Pass if regime > SMA.
3. **regime_information_ratio**: IR = mean(regime_excess_returns) / std(regime_excess_returns) × sqrt(252). Excess = regime strategy returns - B&H returns. Pass if IR > 0.

**Step 1:** Implement all 3 tests.
**Step 2:** Add helper `_sma(close, window)` for the SMA crossover benchmark.
**Commit:** `feat(eval): add Stage 5 benchmarking vs baselines`

---

### Task 4: Wire Stages 3-5 into Model Training Pipeline

**Files:**
- Modify: `src/ml/hdp_hmm/io/save.py`
- Modify: `src/ml/shared/evaluation.py` (add `run_all_stages()` orchestrator)

**Context:** Currently `save.py` calls `run_stage1_regime_quality()` and optionally `run_stage2_significance()`. We need to add calls for stages 3-5. The new stages need train/test split data which `save.py` already has (via the `split` column).

**Implementation:**

In `evaluation.py`, add an orchestrator:

```python
def run_all_stages(
    features: np.ndarray,
    assignments: np.ndarray,
    close: np.ndarray,
    split_mask: np.ndarray,          # boolean array: True = train, False = test
    confidence: Optional[np.ndarray],
    transition_matrix: Optional[np.ndarray],
    run_significance: bool = False,
    iteration: int = 0,
) -> dict:
    """Run all evaluation stages, return combined results."""
    train_mask = split_mask
    test_mask = ~split_mask
    split_idx = int(np.argmax(test_mask))  # first test bar index

    stage1 = run_stage1_regime_quality(features, assignments, close, iteration)
    stage2 = run_stage2_significance(features, assignments, close, iteration=iteration) if run_significance else {}
    stage3 = run_stage3_oos_validation(
        assignments[train_mask], assignments[test_mask],
        close[train_mask], close[test_mask],
        confidence[train_mask] if confidence is not None else np.ones(train_mask.sum()) * 0.5,
        confidence[test_mask] if confidence is not None else np.ones(test_mask.sum()) * 0.5,
        transition_matrix if transition_matrix is not None else np.eye(int(assignments.max()) + 1),
        iteration,
    )
    stage4 = run_stage4_conditioned_performance(assignments, close, split_idx, iteration)
    stage5 = run_stage5_benchmarking(assignments, close, split_idx, iteration)

    grade = compute_evaluation_grade_v2(stage1, stage2, stage3, stage4)

    return {
        "stage1": stage1, "stage2": stage2, "stage3": stage3,
        "stage4": stage4, "stage5": stage5, "grade": grade,
    }
```

In `save.py`, replace the separate stage1/stage2 calls with `run_all_stages()`, passing the split mask, confidence, and transition matrix that are already computed there.

**Also update `compute_evaluation_grade()` → `compute_evaluation_grade_v2()`:**

```python
def compute_evaluation_grade_v2(stage1, stage2, stage3, stage4) -> str:
    """
    Enhanced grading rubric incorporating Stages 3-4.

    A: All Stage 1 pass + Stage 2 perm p<0.01 + Stage 3 all pass + any Stage 4 Sharpe > 1.0
    B: All Stage 1 pass + Stage 2 perm p<0.05 + Stage 3 OOS return separation
    C: ≥60% Stage 1 pass + Stage 3 confidence calibration pass
    D: >0% Stage 1 pass
    F: No tests pass
    """
```

Keep backward compatibility: `compute_evaluation_grade()` still works (for any code calling it directly).

**Step 1:** Add `run_all_stages()` and `compute_evaluation_grade_v2()` to evaluation.py.
**Step 2:** Update `save.py` to call `run_all_stages()` instead of individual stages.
**Step 3:** Verify the diagnostics JSON includes all 5 stages in the `evaluation` key.
**Commit:** `feat(eval): wire stages 3-5 into training pipeline`

---

## Milestone 2: Server-Side Evaluation API

### Task 5: Extend Training Routes for Stage 3-5 Data

**Files:**
- Modify: `src/server/routes/training.ts`
- Modify: `src/server/lib/modelResults.ts`

**Context:** The existing `/api/training/sessions/:id/evaluation` route already returns all evaluation results from SQLite. The new stages will flow through the same path (Python emits → orchestrator persists → route serves). But we need a new route for **benchmark comparison** that queries QuestDB OHLCV data server-side.

**New route:**

```
GET /api/training/models/:id/benchmarks
```

This computes buy-and-hold and SMA crossover returns for the same symbol/timeframe/date range as the model — allowing the client to overlay benchmark curves on the regime strategy chart.

**Implementation in `modelResults.ts`:**

```typescript
export async function getModelBenchmarks(
  baseDir: string,
  id: string,
): Promise<BenchmarkResult | null> {
  const safe = sanitizeModelId(id);
  const diagPath = path.join(baseDir, safe, "diagnostics.json");
  if (!fs.existsSync(diagPath)) return null;

  const diag = JSON.parse(fs.readFileSync(diagPath, "utf-8"));
  const { symbol, date_range } = diag;
  if (!symbol || !date_range?.start || !date_range?.end) return null;

  // Query OHLCV from QuestDB for the model's date range
  const ohlcv = await questdbHttpQuery<{ ts: string; close: number }>(
    `SELECT timestamp as ts, close FROM ohlcv
     WHERE symbol = '${symbol}'
       AND timestamp >= '${date_range.start}'
       AND timestamp <= '${date_range.end}'
     ORDER BY timestamp ASC
     LIMIT 0, 100000`
  );

  if (ohlcv.length < 200) return null; // Need enough data for SMA200

  // Compute benchmarks
  const closes = ohlcv.map(r => r.close);
  const buyAndHold = computeBuyAndHold(closes);
  const smaCrossover = computeSMACrossover(closes, 50, 200);

  return { buyAndHold, smaCrossover, dates: ohlcv.map(r => r.ts) };
}
```

Add helper functions `computeBuyAndHold()` and `computeSMACrossover()` in the same file.

**Route in `training.ts`:**

```typescript
router.get("/training/models/:id/benchmarks", async (req, res) => {
  const id = String(req.params.id);
  const result = await getModelBenchmarks(MODELS_DIR, id);
  if (!result) return res.status(404).json({ error: "Benchmark data unavailable" });
  res.json(result);
});
```

**Step 1:** Add benchmark computation functions to `modelResults.ts`.
**Step 2:** Add the route to `training.ts`.
**Commit:** `feat(api): add benchmark comparison endpoint`

---

### Task 6: Model History API (Cross-Session Comparison)

**Files:**
- Modify: `src/server/storage/trainingStorage.ts`
- Modify: `src/server/routes/training.ts`

**Context:** For degradation tracking, the client needs historical quality scores for a given symbol+modelType combination. The existing `listSessions()` already filters by symbol and modelType, but we need a lightweight endpoint that returns just the quality trajectory.

**New storage function:**

```typescript
/** Get quality score history for a symbol+modelType combo. */
export function getQualityHistory(symbol: string, modelType: string): Array<{
  id: number;
  versionedModelId: string;
  qualityScore: number | null;
  evaluationGrade: string | null;
  startedAt: number;
  elapsedSec: number | null;
  nRegimes: number | null;
}> {
  return db.select({
    id: trainingSessions.id,
    versionedModelId: trainingSessions.versionedModelId,
    qualityScore: trainingSessions.qualityScore,
    evaluationGrade: trainingSessions.evaluationGrade,
    startedAt: trainingSessions.startedAt,
    elapsedSec: trainingSessions.elapsedSec,
    // Extract n_regimes from diagnostics JSON
  })
  .from(trainingSessions)
  .where(and(
    eq(trainingSessions.symbol, symbol),
    eq(trainingSessions.modelType, modelType),
    eq(trainingSessions.status, "completed"),
  ))
  .orderBy(trainingSessions.startedAt)
  .all();
}
```

**New route:**

```
GET /api/training/history?symbol=ES&modelType=hdp-hmm
```

Returns `{ sessions: [...quality trajectory...] }`.

**Step 1:** Add `getQualityHistory()` to trainingStorage.ts.
**Step 2:** Add the route to training.ts.
**Commit:** `feat(api): add model quality history endpoint`

---

## Milestone 3: Enhanced Evaluation Display (Client)

### Task 7: Extend Diagnostics Interface with Stages 3-5

**Files:**
- Modify: `src/client/src/components/training/types.ts`

**Context:** The existing `Diagnostics` interface doesn't have an `evaluation` field. Phase 2 components access it via `(diagnostics as any).evaluation`. We need to formalize this.

**Implementation:**

Add to `types.ts`:

```typescript
export interface EvaluationTestResult {
  value: number | null;
  passed: boolean;
  p_value: number | null;
  details?: Record<string, unknown>;
}

export interface EvaluationResults {
  stage1: Record<string, EvaluationTestResult>;
  stage2: Record<string, EvaluationTestResult>;
  stage3: Record<string, EvaluationTestResult>;
  stage4: Record<string, EvaluationTestResult>;
  stage5: Record<string, EvaluationTestResult>;
  grade: string;
}

export interface BenchmarkResult {
  buyAndHold: { cumulative: number[]; totalReturn: number };
  smaCrossover: { cumulative: number[]; totalReturn: number; signals: number[] };
  dates: string[];
}
```

Extend `Diagnostics`:

```typescript
export interface Diagnostics {
  // ...existing fields...
  evaluation?: EvaluationResults;
}
```

This eliminates all `(diagnostics as any).evaluation` casts in Phase 2 components.

**Step 1:** Add interfaces and extend Diagnostics.
**Step 2:** Update ConfidenceCalibration.tsx and SilhouettePlot.tsx to use typed `diagnostics.evaluation` instead of `(diagnostics as any).evaluation`.
**Commit:** `refactor(types): formalize evaluation interfaces, remove as-any casts`

---

### Task 8: Enhanced ConfidenceCalibration — 5-Stage Evaluation Display

**Files:**
- Modify: `src/client/src/components/training/analytics/ConfidenceCalibration.tsx`

**Context:** Currently shows Stage 1 + Stage 2 in a 2-column grid. We need to extend it to show all 5 stages, with expandable detail panels.

**Implementation:**

Rework the component to render 5 stage sections (collapsed by default for stages 3-5 if empty):

```typescript
const STAGE_LABELS: Record<string, string> = {
  stage1: "Stage 1: Regime Quality",
  stage2: "Stage 2: Statistical Significance",
  stage3: "Stage 3: OOS Validation",
  stage4: "Stage 4: Conditioned Performance",
  stage5: "Stage 5: Benchmarking",
};

const TEST_LABELS: Record<string, string> = {
  // ...existing...
  oos_confidence_calibration: "OOS Confidence Calibration",
  oos_return_separation: "OOS Return Separation",
  regime_transition_prediction: "Transition Prediction",
  regime_distribution_drift: "Distribution Drift",
  regime_sharpe: "Regime Sharpe Ratio",
  long_bull_short_bear: "Long Bull / Short Bear",
  transition_returns: "Transition Returns",
  stability_premium: "Stability Premium",
  max_regime_drawdown: "Max Regime Drawdown",
  vs_buy_and_hold: "vs. Buy & Hold",
  vs_sma_crossover: "vs. SMA Crossover",
  regime_information_ratio: "Information Ratio",
};
```

Each test row becomes clickable — clicking expands a detail sub-panel showing the `details` JSON formatted as key-value pairs.

Use state: `const [expandedTest, setExpandedTest] = useState<string | null>(null)`.

When a test is clicked, show its `details` object rendered as:
```tsx
<div className="pl-6 py-2 text-[8px] font-mono text-muted-foreground/40 space-y-0.5">
  {Object.entries(details).map(([k, v]) => (
    <div key={k}>{k}: {JSON.stringify(v)}</div>
  ))}
</div>
```

**Step 1:** Extend with all 5 stages + TEST_LABELS.
**Step 2:** Add expandable detail panel per test.
**Commit:** `feat(analytics): 5-stage evaluation display with drill-down details`

---

### Task 9: Benchmark Comparison Chart Component

**Files:**
- Create: `src/client/src/components/training/analytics/BenchmarkComparison.tsx`
- Modify: `src/client/src/components/training/analytics/index.tsx` (add to COMPONENT_MAP)
- Modify: `src/config/visualizations.json` (add to universal list)

**Context:** New component that shows cumulative returns of the regime-following strategy vs buy-and-hold vs SMA crossover. Fetches from the new `/api/training/models/:id/benchmarks` endpoint.

**SOLID:** SRP — renders benchmark comparison chart only. DIP — fetches its own data via useQuery hook.

**Implementation:**

```typescript
export default function BenchmarkComparison({ diagnostics, modelId }: AnalyticsComponentProps) {
  const { data } = useQuery({
    queryKey: ["benchmarks", modelId],
    queryFn: async () => {
      const res = await fetch(`/api/training/models/${modelId}/benchmarks`);
      if (!res.ok) return null;
      return res.json() as Promise<BenchmarkResult>;
    },
    enabled: !!modelId,
    staleTime: 60_000,
  });

  if (!data) return <ChartCard title="Benchmark Comparison"><EmptyState message="No benchmark data" /></ChartCard>;

  // Recharts LineChart with 3 series: Regime Strategy, Buy & Hold, SMA Crossover
  // X-axis: dates, Y-axis: cumulative return %
}
```

Add to `COMPONENT_MAP`:
```typescript
"benchmark-comparison": lazy(() => import("./BenchmarkComparison")),
```

Add `"benchmark-comparison"` to `visualizations.json` universal array.

**Step 1:** Create the component.
**Step 2:** Wire into COMPONENT_MAP + visualizations.json.
**Commit:** `feat(analytics): add benchmark comparison chart`

---

### Task 10: Interactive ClusterProfileCards — Click to Expand

**Files:**
- Modify: `src/client/src/components/training/analytics/ClusterProfileCards.tsx`

**Context:** Currently shows compact stat cards per regime. Phase 3 adds click-to-expand: clicking a regime card reveals a full-width detail panel with:
1. Full feature z-score list (not just top 3)
2. SHAP feature importance for that regime (from diagnostics.shap_summary)
3. Duration distribution text summary

**Implementation:**

Add state: `const [expandedRegime, setExpandedRegime] = useState<number | null>(null)`.

Wrap each card in a clickable container. When expanded, render a detail panel below the card grid:

```tsx
{expandedRegime !== null && (
  <div className="lg:col-span-full bg-white/[0.02] rounded-xl border p-4 mt-2">
    <h5>Regime {expandedRegime} Details</h5>

    {/* All feature z-scores (not just top 3) */}
    <div className="grid grid-cols-3 gap-1">
      {Object.entries(regime.characteristics)
        .sort(([,a],[,b]) => Math.abs(b) - Math.abs(a))
        .map(([feat, z]) => (
          <div key={feat} className="flex justify-between text-[8px]">
            <span>{feat}</span>
            <span>{z > 0 ? "+" : ""}{z.toFixed(2)}σ</span>
          </div>
        ))}
    </div>

    {/* SHAP top features for this regime */}
    {diagnostics.shap_summary?.find(s => s.regime_id === expandedRegime)?.top_features && (
      <div>
        <h6>SHAP Feature Importance</h6>
        {/* Horizontal bars */}
      </div>
    )}
  </div>
)}
```

**Step 1:** Add expand/collapse state and click handler.
**Step 2:** Render detail panel with full characteristics + SHAP summary.
**Commit:** `feat(analytics): interactive cluster profile drill-down`

---

### Task 11: Interactive WalkForwardWindows — Click to Show Window Details

**Files:**
- Modify: `src/client/src/components/training/analytics/WalkForwardWindows.tsx`

**Context:** Currently shows a bar chart of per-window confidence. Phase 3 adds: click a bar → show that window's details below the chart (train_size, test_size, regime_distribution, switch_rate, failed status).

**Implementation:**

Add state: `const [selectedWindow, setSelectedWindow] = useState<number | null>(null)`.

Add `onClick` handler to BarChart:

```tsx
<BarChart data={chartData} onClick={(data) => {
  if (data?.activePayload?.[0]) {
    const idx = data.activeTooltipIndex;
    setSelectedWindow(idx === selectedWindow ? null : idx);
  }
}}>
```

Below the chart, render a detail panel when `selectedWindow !== null`:

```tsx
{selectedWindow !== null && (() => {
  const w = wf.window_results[selectedWindow];
  return (
    <div className="bg-white/[0.02] rounded-xl p-3 border mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-[9px]">
      <div><span className="text-muted-foreground/50">Train size</span><div className="font-mono">{w.train_size.toLocaleString()} bars</div></div>
      <div><span className="text-muted-foreground/50">Test size</span><div className="font-mono">{w.test_size.toLocaleString()} bars</div></div>
      <div><span className="text-muted-foreground/50">Switch rate</span><div className="font-mono">{((w.switch_rate ?? 0) * 100).toFixed(1)}%</div></div>
      <div><span className="text-muted-foreground/50">Confidence</span><div className="font-mono">{((w.avg_confidence ?? 0) * 100).toFixed(1)}%</div></div>
      {w.regime_distribution && (
        <div className="col-span-full">
          <span className="text-muted-foreground/50">Regime distribution</span>
          <div className="flex gap-1 mt-1">
            {w.regime_distribution.map((pct, i) => (
              <div key={i} className="h-4 rounded" style={{ width: `${pct * 100}%`, backgroundColor: getRegimeColor(i).fill, minWidth: 4 }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
})()}
```

**Step 1:** Add state + click handler on BarChart.
**Step 2:** Render detail panel for selected window.
**Commit:** `feat(analytics): interactive walk-forward window drill-down`

---

### Task 12: Interactive SilhouettePlot — Expandable Test Details

**Files:**
- Modify: `src/client/src/components/training/analytics/SilhouettePlot.tsx`

**Context:** Currently shows 3 cluster quality metrics (Silhouette, Calinski-Harabasz, Davies-Bouldin). Phase 3 adds: click a metric card to see its interpretation and thresholds.

**Implementation:**

Add state: `const [expandedMetric, setExpandedMetric] = useState<string | null>(null)`.

Add interpretation text for each metric:

```typescript
const METRIC_INFO: Record<string, { description: string; goodRange: string; badRange: string }> = {
  silhouette_score: {
    description: "Measures how similar each bar is to its own regime vs other regimes. Think of it as: how clearly does each market mood stand out from the others?",
    goodRange: "> 0.2 means regimes are meaningfully different",
    badRange: "< 0.2 means regime boundaries are fuzzy",
  },
  calinski_harabasz: {
    description: "Ratio of between-regime variance to within-regime variance. Think of it as: are the regime 'centers' far apart compared to the noise within each regime?",
    goodRange: "> 10 means well-separated regime centers",
    badRange: "< 10 means regimes overlap too much",
  },
  davies_bouldin: {
    description: "Average similarity between each regime and its most similar neighbor. Think of it as: do any two regimes look confusingly alike?",
    goodRange: "< 1.5 means each regime is distinct",
    badRange: "> 1.5 means some regimes could be merged",
  },
};
```

Clicking a metric card toggles the interpretation panel below it.

**Step 1:** Add expand state + interpretation data.
**Step 2:** Render expandable interpretation text.
**Commit:** `feat(analytics): interactive silhouette metric drill-down`

---

## Milestone 4: Model Degradation Tracking

### Task 13: Model History Hook

**Files:**
- Create: `src/client/src/hooks/useModelHistory.ts`

**Context:** Fetches the quality score trajectory for a given symbol+modelType from the new `/api/training/history` endpoint (Task 6).

**Implementation:**

```typescript
interface ModelHistoryEntry {
  id: number;
  versionedModelId: string;
  qualityScore: number | null;
  evaluationGrade: string | null;
  startedAt: number;
  elapsedSec: number | null;
}

export function useModelHistory(symbol: string | null, modelType: string | null) {
  return useQuery<{ sessions: ModelHistoryEntry[] }>({
    queryKey: ["modelHistory", symbol, modelType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (symbol) params.set("symbol", symbol);
      if (modelType) params.set("modelType", modelType);
      const res = await fetch(`/api/training/history?${params}`);
      if (!res.ok) throw new Error("Failed to fetch model history");
      return res.json();
    },
    enabled: !!symbol && !!modelType,
    staleTime: 30_000,
  });
}
```

**Step 1:** Create the hook file.
**Commit:** `feat(hooks): add useModelHistory for quality trajectory`

---

### Task 14: Model History Sparkline Component

**Files:**
- Create: `src/client/src/components/training/analytics/ModelHistory.tsx`
- Modify: `src/client/src/components/training/analytics/index.tsx` (add to COMPONENT_MAP)
- Modify: `src/config/visualizations.json` (add to universal list)

**Context:** Shows a sparkline of quality scores across training sessions for the same symbol+modelType. Alerts if score dropped >15% from 3-session moving average.

**SOLID:** SRP — renders quality trajectory only. DIP — fetches via useModelHistory hook.

**Implementation:**

```typescript
export default function ModelHistory({ diagnostics, modelId }: AnalyticsComponentProps) {
  const { data } = useModelHistory(diagnostics.symbol, /* extract modelType from modelId */);

  if (!data?.sessions?.length || data.sessions.length < 2) {
    return (
      <ChartCard title="Model History">
        <EmptyState message="Train multiple sessions to see history" hint="Re-train the same symbol to track quality over time" />
      </ChartCard>
    );
  }

  const sessions = data.sessions.filter(s => s.qualityScore != null);

  // Compute 3-session moving average
  const movingAvg = sessions.map((s, i) => {
    if (i < 2) return null;
    const avg = (sessions[i-2].qualityScore + sessions[i-1].qualityScore + s.qualityScore) / 3;
    return avg;
  });

  // Detect degradation: current score >15% below moving average
  const latest = sessions[sessions.length - 1];
  const latestAvg = movingAvg[movingAvg.length - 1];
  const degraded = latestAvg != null && latest.qualityScore < latestAvg * 0.85;

  // Recharts LineChart sparkline + degradation alert badge
  return (
    <ChartCard
      title="Model History"
      subtitle={`${sessions.length} sessions for ${diagnostics.symbol}`}
      badge={degraded ? (
        <span className="text-[9px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400">
          ⚠ Score Degrading
        </span>
      ) : null}
    >
      {/* Sparkline */}
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={sessions.map((s, i) => ({
          name: new Date(s.startedAt).toLocaleDateString(),
          score: s.qualityScore,
          grade: s.evaluationGrade,
          avg: movingAvg[i],
        }))}>
          <CartesianGrid {...CHART_GRID} />
          <XAxis dataKey="name" {...CHART_AXIS} />
          <YAxis {...CHART_AXIS} domain={[0, 100]} />
          <Tooltip {...CHART_TOOLTIP} />
          <Line dataKey="score" stroke="#10b981" dot={{ r: 3 }} strokeWidth={2} />
          <Line dataKey="avg" stroke="#f59e0b60" strokeDasharray="3 3" dot={false} />
        </LineChart>
      </ResponsiveContainer>

      {/* Grade badges per session */}
      <div className="flex gap-1 mt-2 flex-wrap">
        {sessions.map((s, i) => (
          <span key={i} className={`text-[8px] px-1.5 py-0.5 rounded ${GRADE_COLORS[s.evaluationGrade || "F"]}`}>
            {s.evaluationGrade || "?"}
          </span>
        ))}
      </div>
    </ChartCard>
  );
}
```

Add to `COMPONENT_MAP`:
```typescript
"model-history": lazy(() => import("./ModelHistory")),
```

Add `"model-history"` to `visualizations.json` universal array.

**Step 1:** Create the component.
**Step 2:** Wire into COMPONENT_MAP + visualizations.json.
**Commit:** `feat(analytics): add model history sparkline with degradation alerts`

---

## Milestone 5: Verification + Commit

### Task 15: TypeScript Verification

**Files:** None (verification only)

**Step 1:** Run `npm run check` from the project root.
**Step 2:** Verify zero NEW errors from files we created/modified. Pre-existing errors (explainable-ai, IndicatorPanel, forecast-visualizer, backtest, useTrainingConfig, useIndicatorData) are expected and not our concern.
**Step 3:** Grep the output for `analytics/` and `evaluation` to confirm no errors in our files.

---

### Task 16: Visual Verification

**Files:** None (verification only)

**Step 1:** Start the dev server: `npm run dev`
**Step 2:** Open the dashboard, navigate to Training, select a trained model.
**Step 3:** Click the Analytics tab.
**Step 4:** Verify:
- 5-stage evaluation display renders (ConfidenceCalibration shows stages 1-5)
- Benchmark comparison chart renders (or shows empty state if no benchmark data)
- Model history sparkline renders (or shows "train multiple sessions" message)
- Clicking a regime card in ClusterProfileCards expands detail panel
- Clicking a walk-forward bar expands window details
- Clicking a silhouette metric expands interpretation

**Step 5:** Check browser console for React errors — should be none from our components.

---

### Task 17: Final Commit + Plan Update

**Step 1:** Stage all files and commit:
```
git add src/ml/shared/evaluation.py
git add src/server/lib/modelResults.ts
git add src/server/storage/trainingStorage.ts
git add src/server/routes/training.ts
git add src/client/src/components/training/types.ts
git add src/client/src/components/training/analytics/
git add src/client/src/hooks/useModelHistory.ts
git add src/config/visualizations.json
git commit -m "feat: Phase 3 evaluation depth + polish"
```

**Step 2:** Commit this plan document:
```
git add docs/plans/2026-02-28-phase3-evaluation-depth.md
git commit -m "docs: add Phase 3 evaluation depth implementation plan"
```

---

## Summary

| # | Task | Type | Files | SOLID |
|---|------|------|-------|-------|
| 1 | Stage 3: OOS Validation | Python | evaluation.py | OCP |
| 2 | Stage 4: Conditioned Performance | Python | evaluation.py | OCP |
| 3 | Stage 5: Benchmarking | Python | evaluation.py | OCP |
| 4 | Wire Stages 3-5 into Pipeline | Python | evaluation.py, save.py | OCP, DIP |
| 5 | Benchmark API Route | Server | modelResults.ts, training.ts | SRP, DIP |
| 6 | Model History API | Server | trainingStorage.ts, training.ts | SRP, ISP |
| 7 | Extend Diagnostics Interface | Types | types.ts | ISP |
| 8 | 5-Stage Evaluation Display | Client | ConfidenceCalibration.tsx | SRP |
| 9 | Benchmark Comparison Chart | Client | BenchmarkComparison.tsx, index.tsx | SRP, OCP |
| 10 | Interactive ClusterProfileCards | Client | ClusterProfileCards.tsx | SRP |
| 11 | Interactive WalkForwardWindows | Client | WalkForwardWindows.tsx | SRP |
| 12 | Interactive SilhouettePlot | Client | SilhouettePlot.tsx | SRP |
| 13 | Model History Hook | Client | useModelHistory.ts | SRP, ISP |
| 14 | Model History Sparkline | Client | ModelHistory.tsx, index.tsx | SRP, OCP |
| 15 | TypeScript Verification | Verify | — | — |
| 16 | Visual Verification | Verify | — | — |
| 17 | Final Commit | Git | — | — |
