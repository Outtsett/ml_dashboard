# HDP-HMM Training Pipeline Design

**Date**: 2026-02-25
**Status**: Design approved, pending implementation plan

## Goal

Press "Train" for HDP-HMM → see terminal logs streaming, live metrics updating, and chart overlays painting regime zones in real-time. Fully implemented pipeline — user just presses the button.

## Architecture Overview

```
QuestDB OHLCV (source of truth)
    │
    ▼
dataExporter.ts → temp parquet (raw OHLCV only)
    │
    ▼
hdp_hmm.py (Python)
    ├── Computes features from raw OHLCV (on the fly)
    ├── Normalizes features (on the fly)
    ├── Trains Sticky HDP-HMM via Gibbs sampling
    └── Emits JSON events on stdout
            │
            ▼
    PythonRunner → stdout parser → SSE stream
            │
            ├──→ Market Data page: Terminal tab (formatted logs)
            ├──→ Market Data page: Chart overlays (regime zones)
            └──→ Training Center page: Live analytics panels
```

## Section 1: Data Flow

1. **Server** receives POST /api/training/start with `{modelId: "hdp-hmm", symbol: "ES", timeframe: "1h"}`
2. **Orchestrator** looks up "hdp-hmm" in `config/models.json` registry
3. **DataExporter** queries QuestDB via `getOHLCVSampleBy()` → writes temp parquet with raw OHLCV columns (timestamp, open, high, low, close, volume)
4. **PythonRunner** spawns `src/ml/hdp_hmm.py` with args: `--data <temp.parquet> --config <hyperparams.json>`
5. Python script reads parquet, computes its own features, normalizes, trains, emits JSON events on stdout
6. **PythonRunner** reads stdout line-by-line → parses via registered parser → emits SSE events
7. **SSE stream** at GET /api/training/stream/:modelId delivers events to all connected clients

Key decisions:
- Model receives **raw OHLCV only** — no pre-computed indicators, no external feature pipeline
- Model computes and normalizes its own features internally — self-contained
- No artificial constraint on feature count — the model decides what's relevant for regime discovery

## Section 2: HDP-HMM Python Model

`src/ml/hdp_hmm.py` — single-file, self-contained model.

**Feature computation**: The model computes whatever features it needs from raw OHLCV. Returns at multiple horizons, volatility measures, volume dynamics, price structure features — all determined by what's useful for regime discovery. Feature selection is the model's responsibility, defined in the script itself.

**Normalization**: Rolling z-score computed on the fly within the script. No dependency on `data/features/` parquets.

**Training — Sticky HDP-HMM via Gibbs sampling**:
- Nonparametric: discovers the number of regimes automatically (no K to tune)
- Sticky: self-transition bias so regimes persist (not flickering every bar)
- Numba JIT for the forward-backward pass (performance critical on large datasets)
- Emits JSON events per iteration via stdout

**Stdout protocol** — every line is a JSON object:
```json
{"type":"progress", "iteration": 50, "total": 500}
{"type":"metric", "name":"log_likelihood", "value":-12345.6, "iteration": 50}
{"type":"metric", "name":"num_regimes", "value": 4, "iteration": 50}
{"type":"overlay", "overlayType":"regime_zones", "data": [{"start":"2024-01-05","end":"2024-02-10","regime":0,"color":"#4CAF50","label":"Low Vol Bull"}]}
{"type":"log", "level":"info", "message":"Gibbs iteration 50/500 complete"}
{"type":"done", "modelPath":"data/models/hdp_hmm_ES_1h_abc123.pkl"}
```

The overlay events are the key innovation — as the Gibbs sampler converges, regime assignments stabilize, and the model emits updated regime zones every N iterations. The chart paints these in real-time.

**Hyperparameters** (exposed in UI via models.json):
- `gamma` — concentration parameter for top-level DP
- `alpha` — concentration parameter for state-level DP
- `kappa` — sticky parameter (self-transition bias)
- `num_iterations` — Gibbs sampling iterations
- `burn_in` — iterations to discard before collecting samples
- `overlay_interval` — emit regime overlay every N iterations

## Section 3: Terminal Log Integration (Market Data Page)

The terminal in the bottom panel of Market Data already has xterm.js + PTY support. For training, add a **training log stream** that reads from the SSE stream.

**Two tabs in the terminal panel:**

1. **Shell** — existing PTY terminal (bash/powershell, interactive)
2. **Training** — read-only log viewer subscribed to `/api/training/stream/:modelId`

The Training tab renders SSE events as formatted terminal output:
- `progress` → progress bar line (`[████████░░] 50/500 iterations`)
- `metric` → colored key-value (`log_likelihood: -12345.6 ▼` with trend arrows)
- `log` → plain text with level-based coloring (info=white, warn=yellow, error=red)
- `overlay` → brief notification (`Regime update: 4 regimes identified`)

Auto-activates when training starts. Always formatted — raw JSON never shown.

## Section 4: Training Center Analytics Overhaul

Replace current stubs with real visualizations fed by SSE metric events.

**Live panels (during training):**
- **Convergence chart** — log-likelihood over iterations (Recharts line chart, live updating)
- **Regime count tracker** — discovered regime count over iterations (shows model exploring then settling)
- **Transition matrix heatmap** — N×N grid updating as model refines regime transitions
- **Regime characteristics table** — per-regime stats (mean return, volatility, duration, frequency)
- **Iteration metrics** — current iteration, elapsed time, iter/sec, ETA

**Post-training panels (after `done` event):**
- **Regime timeline** — full history of regime assignments as colored bar
- **Regime distribution** — time spent in each regime (pie/bar chart)
- **Feature importance** — which features most differentiate regimes
- **Model diagnostics** — convergence assessment, effective sample size, log-likelihood autocorrelation

All panels consume the same SSE stream. `TrainingLiveCtx` (fast) feeds convergence chart + iteration metrics. `TrainingControlCtx` (slow) feeds regime discovery panels.

## Section 5: Chart Overlay Integration

The overlay system in ChartPanel supports 7 overlay types. For HDP-HMM:

**During training**: As the model emits `overlay` events with `regime_zones`, the chart paints colored background zones on the price chart. Each regime gets a distinct color and label. As the Gibbs sampler iterates, zones shift and stabilize — the user watches the model "figure out" market structure in real-time.

**After training**: Final regime assignment becomes a persistent overlay saved alongside the model checkpoint in `data/models/`. Can be reloaded without retraining.

**Wiring**: SSE event → TrainingContext → useTrainingSync → ChartPanel props → IndicatorChartLayout → colored zones on Lightweight Charts. The `useTrainingSync` hook already exists and subscribes to overlay events.

## What Needs to Be Built

| Component | Status | Work needed |
|---|---|---|
| `config/models.json` HDP-HMM entry | EMPTY | Register model with runner, script path, hyperparams |
| `src/ml/hdp_hmm.py` | DOES NOT EXIST | Full implementation from first principles |
| HDP-HMM stdout parser | DOES NOT EXIST | Register in parser registry (OCP) |
| Training tab in terminal | DOES NOT EXIST | SSE-fed formatted log viewer component |
| Training Center live panels | STUBS | Replace with real SSE-driven visualizations |
| Chart overlay wiring | 90% DONE | Verify regime_zones overlay type works end-to-end |
| models.json / features.json | EMPTY/STUB | Populate with HDP-HMM config |

## What Already Works

- SSE streaming with reconnection + replay
- PythonRunner spawns Python, routes stdout to parsers
- Orchestrator with session management
- Chart overlay system (7 types including regime coloring)
- Terminal component (xterm.js + WebSocket PTY, multi-tab)
- Training hooks (useTraining, useTrainingSSE, useTrainingSync)
- TrainingContext with split contexts (fast/slow)
- DataExporter (QuestDB → temp parquet)
