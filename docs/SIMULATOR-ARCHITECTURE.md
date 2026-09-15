# ML Train Simulator — Architecture Plan

> Think of it as **QuantConnect's Research Notebook + Strategy Lab**, but every "algorithm" is one of your ML models (CNN, HDP-HMM, Random Forest, etc.), and the simulator feeds it bars one at a time — exactly like it would in live trading — then grades it.

---

## The Big Picture: What the Simulator Does

```
┌─────────────────────────────────────────────────────────────┐
│  Iceberg lake (759.5M bars)  ←  source of truth              │
│        │                                                     │
│        ▼                                                     │
│  ┌──────────────┐   slice    ┌──────────────────────────┐    │
│  │ Data Windower│──────────▶│  TRAIN window  │ TEST win │    │
│  └──────────────┘           └──────────────────────────┘    │
│        │                            │                        │
│        ▼                            ▼                        │
│  Model trains on it         Model predicts on it             │
│                                     │                        │
│                                     ▼                        │
│                            Trade Simulator                    │
│                            (fills, stops, P&L)               │
│                                     │                        │
│                                     ▼                        │
│                            Metrics + Equity Curve            │
└─────────────────────────────────────────────────────────────┘
```

**Think of it as:** A rookie trader paper-trading on last year's data. The model only ever *sees* what a live trader would have seen at that moment — no peeking at future bars.

---

## 5 Simulation Modes

| Mode             | Analogy                   | What It Does                                                               |
| ---------------- | ------------------------- | -------------------------------------------------------------------------- |
| **Single Run**   | One exam                  | Train once → test once → get grade                                         |
| **Walk-Forward** | Rolling report card       | Slide a window forward, train→test→slide→repeat (10+ folds)                |
| **K-Fold CV**    | Multiple teachers grading | Split data into K chunks, take turns holding each one out as test          |
| **Tournament**   | Model Olympics            | Run ALL models on same data window → rank by Sharpe/WinRate                |
| **Paper Trader** | Practice with live ammo   | Connect to the latest bars in the lake → run model inference live → simulate fills |

---

## New File Structure

```
src/server/lib/simulation/          ← NEW (6 files)
  types.ts                          — SimulationSession, SimMode, WindowConfig
  dataWindower.ts                   — slices lake data into Train/Test windows
  walkForwardRunner.ts              — slides window, calls train+backtest per fold
  crossValidator.ts                 — k-fold temporal splits
  modelTournament.ts                — runs N models on same window in parallel
  paperTrader.ts                    — polls the lake, runs live inference + sim fills

src/server/routes/simulator.ts      ← NEW (1 file, mounted at /api/simulator)

src/shared/simulationTypes.ts       ← NEW (shared contract server ↔ client)

src/client/src/pages/Simulator.tsx  ← NEW page (router entry in App.tsx)

src/client/src/components/simulator/    ← NEW (8 visual components)
  SimulatorLayout.tsx               — page shell, mode selector
  TimelineSplitBar.tsx              — visual TRAIN/TEST/OOS bar
  WalkForwardGrid.tsx               — fold-by-fold results table
  ModelTournamentBoard.tsx          — live leaderboard (racing bar chart)
  BarReplayPlayer.tsx               — step/scrub through bars + see signal
  EquityCurveComparison.tsx         — overlay N equity curves
  FoldMetricsChart.tsx              — Sharpe / Win Rate across folds
  SimulatorConfigPanel.tsx          — window size, step size, model picker
```

---

## System Architecture (layered)

```
╔══════════════════════════════════════════════════════════════╗
║  FRONTEND — Simulator Page                                   ║
║  ┌──────────────┐  ┌─────────────────┐  ┌─────────────────┐ ║
║  │ Mode Selector│  │TimelineSplitBar │  │ SimulatorConfig │ ║
║  └──────────────┘  └─────────────────┘  └─────────────────┘ ║
║  ┌──────────────────────────────────────────────────────────┐║
║  │  Live Results Area (SSE-driven)                          │║
║  │  WalkForwardGrid | TournamentBoard | EquityCurves        │║
║  └──────────────────────────────────────────────────────────┘║
║  ┌──────────────────────────────────────────────────────────┐║
║  │  BarReplayPlayer — scrub through test window on chart    │║
║  └──────────────────────────────────────────────────────────┘║
╠══════════════════════════════════════════════════════════════╣
║  API LAYER                                                   ║
║  POST /api/simulator/start    → returns sessionId           ║
║  GET  /api/simulator/stream/:id → SSE (same protocol as     ║
║                                    /api/training/stream)    ║
║  GET  /api/simulator/results/:id → full fold results        ║
║  POST /api/simulator/stop/:id   → cancel                    ║
╠══════════════════════════════════════════════════════════════╣
║  SIMULATION ENGINE                                          ║
║  SimulationOrchestrator                                     ║
║    ├── DataWindower (reads the lake)                       ║
║    ├── WalkForwardRunner                                    ║
║    │     └── [per fold] train → backtest → emit SSE event  ║
║    ├── ModelTournament                                      ║
║    │     └── [per model] backtest on shared window (async) ║
║    ├── CrossValidator                                       ║
║    │     └── k-fold temporal splits                        ║
║    └── PaperTrader                                         ║
║          └── poll lake → inference → sim fill             ║
╠══════════════════════════════════════════════════════════════╣
║  EXISTING (REUSED — no modification)                        ║
║  TrainingOrchestrator → trains model (PythonRunner)         ║
║  TradeSimulator → runs backtest, returns equity curve       ║
║  MetricsCalculator → Sharpe, Sortino, MaxDD, etc.          ║
║  DuckDB over the lake → marketQuery() for data             ║
╚══════════════════════════════════════════════════════════════╝
```

---

## Shared Types Contract (`src/shared/simulationTypes.ts`)

```typescript
export type SimMode = 'single' | 'walk-forward' | 'kfold' | 'tournament' | 'paper';

export interface SimulationRequest {
  mode: SimMode;
  symbol: string;
  timeframe: string;
  modelTypes: string[];         // one or many from config/models.json

  // Walk-forward / k-fold
  trainWindowBars: number;      // e.g. 5000 bars of training data
  testWindowBars: number;       // e.g. 1000 bars held out
  stepBars: number;             // how far to slide each fold (walk-forward)
  kFolds?: number;              // for kfold mode

  // Date range (optional — defaults to all available)
  start?: string;
  end?: string;

  // Backtest config (passed through to TradeSimulator)
  backtestConfig: BacktestSimConfig;
}

export interface FoldResult {
  foldIndex: number;
  trainStart: number;           // epoch ms
  trainEnd: number;
  testStart: number;
  testEnd: number;
  modelType: string;
  metrics: FoldMetrics;
  equityCurve: { ts: number; equity: number }[];
  tradeCount: number;
  trainedModelId?: number;      // if model was actually trained (not pre-trained)
}

export interface FoldMetrics {
  sharpe: number;
  sortino: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  totalReturnPct: number;
  tradeCount: number;
  calmar: number;
}

export interface SimulationSession {
  sessionId: string;
  mode: SimMode;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  totalFolds: number;
  completedFolds: number;
  folds: FoldResult[];
  startedAt: number;
  completedAt?: number;
  aggregateMetrics?: AggregateMetrics;  // averaged across folds
}

export interface AggregateMetrics {
  avgSharpe: number;
  avgWinRate: number;
  avgMaxDD: number;
  avgReturn: number;
  consistency: number;          // % of folds profitable
  bestFold: number;
  worstFold: number;
}

// SSE events (extends existing TrainingEvent format)
export type SimSSEEvent =
  | { type: 'fold_started';   foldIndex: number; trainBars: number; testBars: number }
  | { type: 'fold_training';  foldIndex: number; epoch: number; loss: number }
  | { type: 'fold_testing';   foldIndex: number; progress: number }
  | { type: 'fold_complete';  foldIndex: number; result: FoldResult }
  | { type: 'sim_complete';   session: SimulationSession }
  | { type: 'sim_error';      error: string }
  | { type: 'ticker';         ts: number; close: number; signal: number; pnl: number }  // paper mode
```

---

## Data Windower — The Core Building Block

**Think of it as:** A magnifying glass that slides left-to-right across your historical data, showing the model a limited view at a time.

```
 All bars from the lake (e.g. 20,000 bars of ES 5m):
 ├───────────────────────────────────────────────────────┤
 
 Walk-forward with trainWindow=5000, testWindow=1000, step=1000:
 
 Fold 1: [████████████ TRAIN 5000 ████████████][TEST 1000]
 Fold 2:      [████████████ TRAIN 5000 ████████████][TEST 1000]
 Fold 3:           [████████████ TRAIN 5000 ████████████][TEST 1000]
 ...
```

**Key rule:** The model NEVER sees bars from the TEST window during training. This prevents "look-ahead bias" (cheating with future data).

---

## Walk-Forward Runner Flow

```
WalkForwardRunner.run(request)
  │
  ├─ 1. DataWindower.createFolds(symbol, tf, trainW, testW, step)
  │       returns: Fold[] = [{ trainBars, testBars }]
  │
  ├─ 2. For each fold:
  │      a. Export trainBars → parquet (via DuckDB in-memory)
  │      b. TrainingOrchestrator.startTraining(modelType, trainParquet)
  │         ↓ SSE stream fold_training events
  │      c. Wait for model ready
  │      d. Load model → generate signals on testBars
  │      e. TradeSimulator.runBacktest(signals, testBars, brokerConfig)
  │      f. MetricsCalculator.compute(trades, equityCurve)
  │      g. Emit SSE: fold_complete { foldIndex, metrics, equityCurve }
  │
  └─ 3. AggregateMetrics across all folds → emit sim_complete
```

---

## Model Tournament Flow

```
ModelTournament.run(modelTypes[], testBars, brokerConfig)
  │
  ├─ Pre-condition: models already trained (or train each first)
  │
  ├─ For each modelType (run in parallel with Promise.allSettled):
  │    a. Load model outputs for testBars window
  │    b. TradeSimulator.runBacktest(signals, testBars, brokerConfig)
  │    c. Emit SSE: fold_complete { modelType, metrics }
  │       → frontend TournamentBoard updates live
  │
  └─ Final ranking by Sharpe ratio → emit sim_complete
```

---

## Paper Trader Flow

```
PaperTrader.start(symbol, tf, modelType)
  │
  ├─ Load latest trained model (from SQLite)
  │
  ├─ Bootstrap: fetch last N bars from the lake (for feature window)
  │
  ├─ Poll loop (every tfMs milliseconds):
  │    a. GET latest bar from the lake (max timestamp per symbol)
  │    b. Append to rolling window (drop oldest bar)
  │    c. Run model inference → signal (0/1/2) + confidence
  │    d. SimulatedPortfolio.processSignal(signal, bar)
  │       fills at close price, applies commissions/slippage
  │    e. Emit SSE: ticker { ts, close, signal, pnl, openPositions }
  │
  └─ Stop: close all open positions, emit final summary
```

---

## Frontend Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  🎯 ML Train Simulator                           [▶ Run] [■ Stop]│
├─────────────────┬───────────────────────────────────────────────┤
│ Config Panel    │  Timeline Split Bar                            │
│                 │  [████████ TRAIN ████████][████ TEST ████]    │
│ Symbol: ES      │  Jan 2023 ─────────────────────── Dec 2024    │
│ TF: 5m          │                                               │
│ Mode: ▼         ├───────────────────────────────────────────────┤
│  ○ Single Run   │  Results (live, SSE-driven)                   │
│  ● Walk-Fwd     │  ┌──────────────────────────────────────────┐ │
│  ○ K-Fold       │  │ Walk-Forward Grid                        │ │
│  ○ Tournament   │  │ Fold │ Train      │ Test       │ Sharpe  │ │
│  ○ Paper        │  │  1   │ Jan-Jun'23 │ Jul'23     │  1.42  │ │
│                 │  │  2   │ Apr-Sep'23 │ Oct'23     │  0.87  │ │
│ Models:         │  │  3   │ Jul-Dec'23 │ Jan'24     │  1.11  │ │
│ [x] HDP-HMM     │  └──────────────────────────────────────────┘ │
│ [x] CNN         │  ┌──────────────────────────────────────────┐ │
│ [ ] RandomForest│  │ Equity Curves (fold 1 = blue, 2 = green) │ │
│                 │  │    /\/\  /\___/\/\                       │ │
│ Train: 5000 bars│  │   /    \/               ← fold 2        │ │
│ Test:  1000 bars│  │──────────────────────────                │ │
│ Step:  1000 bars│  └──────────────────────────────────────────┘ │
│                 │  ┌──────────────────────────────────────────┐ │
│ Broker: NinjaFx │  │ Aggregate: Avg Sharpe 1.13 | Win 61%     │ │
└─────────────────┴──┴──────────────────────────────────────────┘─┘
```

---

## Build Phases

### Phase 1 — Types + Data Windower (2-3 days)
- `src/shared/simulationTypes.ts` — full type contract
- `src/server/lib/simulation/types.ts` — server-side interfaces
- `src/server/lib/simulation/dataWindower.ts` — folds from the lake
- Unit tests for windowing math

### Phase 2 — Walk-Forward Runner (3-4 days)
- `src/server/lib/simulation/walkForwardRunner.ts`
- `src/server/lib/simulation/crossValidator.ts`
- Integrates with existing `TrainingOrchestrator` + `TradeSimulator`
- SSE event emission per fold

### Phase 3 — API Route + SSE Stream (1-2 days)
- `src/server/routes/simulator.ts`
- Mounted at `/api/simulator`
- Same SSE reconnect pattern as `/api/training/stream`

### Phase 4 — Model Tournament (2-3 days)
- `src/server/lib/simulation/modelTournament.ts`
- Uses `Promise.allSettled` for parallel model runs
- Live SSE leaderboard updates

### Phase 5 — Paper Trader (3-4 days)
- `src/server/lib/simulation/paperTrader.ts`
- Latest-bar polling over the lake
- Simulated portfolio state machine

### Phase 6 — Frontend Page (4-5 days)
- `src/client/src/pages/Simulator.tsx` + all 8 components
- TanStack Query hooks: `useSimulatorSession`, `useSimulatorSSE`
- Route entry in `App.tsx`

---

## SOLID Compliance

| Principle | How                                                                                  |
| --------- | ------------------------------------------------------------------------------------ |
| **SRP**   | Each runner file does ONE thing (window, train, backtest, aggregate)                 |
| **OCP**   | New sim mode = new runner class, no changes to orchestrator                          |
| **LSP**   | `ISimulationRunner` interface → every mode is a drop-in                              |
| **ISP**   | Frontend hooks split: `useSimulatorConfig`, `useSimulatorSSE`, `useSimulatorResults` |
| **DIP**   | Orchestrator depends on `ISimulationRunner` interface, not concrete classes          |

---

## What Gets REUSED (no changes needed)

| Existing Code           | Role in Simulator                               |
| ----------------------- | ----------------------------------------------- |
| `TradeSimulator`        | Runs backtest per fold — unchanged              |
| `MetricsCalculator`     | Computes Sharpe/Sortino/DD per fold — unchanged |
| `PythonRunner`          | Trains model per fold — unchanged               |
| `marketQuery` (DuckDB)  | Fetches bars for windows — unchanged            |
| `SSE streaming pattern` | Same event format — extended                    |
| `BrokerConfigs`         | Cost model per fold — unchanged                 |

---

## Key Metrics the Simulator Tracks

### Per-Fold
- Sharpe Ratio, Sortino Ratio, Calmar Ratio
- Win Rate, Profit Factor, Expectancy
- Max Drawdown %, Total Return %
- Avg Holding Bars, Trade Count

### Aggregate (across all folds)
- Avg Sharpe (stability score)
- Consistency % (% of folds profitable)
- Best fold / Worst fold
- Overfitting score (train Sharpe - test Sharpe gap)
- Equity curve smoothness (Ulcer Index over folds)
