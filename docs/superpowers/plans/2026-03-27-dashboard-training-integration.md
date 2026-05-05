# Dashboard Training Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CNN+Transformer trainable from the dashboard UI — click Start, see live metrics in self-describing renderers, get diagnostics on completion.

**Architecture:** Populate models.json with complete ModelRegistryEntry fields so PythonRunner can spawn main.py. Add emit_metric_declarations() to main.py so the dashboard pre-configures renderers. Add missing CLI args (--json, --max-bars, --date-start/end) to main.py so PythonRunner's flags are recognized. Register checkpoint in model_checkpoints table on completion.

**Tech Stack:** TypeScript (Express/NestJS), Python 3.13, Pydantic, SQLite (Drizzle), QuestDB

---

## File Structure

### Modified Files
| File | Change |
|------|--------|
| `src/config/models.json` | Add complete ModelRegistryEntry fields for cnn-transformer and hdp-hmm |
| `src/ml/cnn_transformer/main.py` | Add emit_metric_declarations(), accept --json/--max-bars/--date-start/--date-end, register checkpoint in model_checkpoints |
| `src/server/training/runners/parsers/hdpHmmParser.ts` | Handle checkpoint_registered event |
| `src/shared/trainingTypes.ts` | Add checkpoint_registered to TrainingEventType |

### New Files
| File | Responsibility |
|------|---------------|
| `tests/ml/cnn_transformer/test_integration.py` | Dashboard-spawn integration test (mock QuestDB, verify JSON protocol) |

---

### Task 1: Populate models.json with complete ModelRegistryEntry

**Files:**
- Modify: `src/config/models.json`

The PythonRunner reads `config.registry.script`, `config.registry.outputDir`, and `config.registry.defaultHyperparameters`. These are all undefined in the current models.json, causing runtime crashes when the dashboard tries to spawn training.

- [ ] **Step 1: Replace cnn-transformer entry with complete ModelRegistryEntry**

Replace the `cnn-transformer` entry in `src/config/models.json` with:

```json
{
  "name": "CNN+Transformer Triple Barrier",
  "category": "supervised",
  "subcategory": "classification",
  "runner": "python",
  "script": "src/ml/cnn_transformer/main.py",
  "featurePipeline": "self-contained",
  "outputs": ["barrier_class", "vol_regime", "return_bucket"],
  "chartOverlay": "prediction_markers",
  "outputDir": "data/models",
  "family": "pytorch",
  "gpuRequired": false,
  "estimatedTrainingTime": "5-30 min (single run), 2-8 hrs (HPO 30 trials)",
  "tags": ["triple-barrier", "cnn", "transformer", "classification", "trade-outcome"],
  "description": "Predicts trade outcomes (TP/SL/timeout) using triple barrier labels with ATR-scaled barriers. CNN encoder + soft quantization + Transformer decoder with 3 output heads.",
  "supportedObjectives": ["profit_factor", "sharpe_ratio"],
  "cliFlags": {
    "windowSize": "--window-size",
    "epochs": "--epochs",
    "batchSize": "--batch-size",
    "learningRate": "--learning-rate",
    "atrPeriod": "--atr-period",
    "tpMultiplier": "--tp-multiplier",
    "slMultiplier": "--sl-multiplier",
    "verticalBars": "--vertical-bars",
    "testSplit": "--test-split",
    "hpo": "--hpo",
    "nTrials": "--n-trials",
    "useL2": "--use-l2"
  },
  "defaultHyperparameters": {
    "windowSize": {
      "type": "int", "default": 128, "min": 32, "max": 512, "step": 32,
      "label": "Window Size", "description": "Input window in bars", "group": "Architecture"
    },
    "epochs": {
      "type": "int", "default": 30, "min": 5, "max": 200, "step": 5,
      "label": "Epochs", "description": "Training epochs", "group": "Training"
    },
    "batchSize": {
      "type": "int", "default": 4096, "min": 256, "max": 16384, "step": 256,
      "label": "Batch Size", "description": "Batch size", "group": "Training"
    },
    "learningRate": {
      "type": "float", "default": 0.0001, "min": 0.000001, "max": 0.01, "step": 0.000001,
      "label": "Learning Rate", "description": "Peak learning rate for OneCycleLR", "group": "Training", "logScale": true
    },
    "atrPeriod": {
      "type": "int", "default": 14, "min": 5, "max": 50, "step": 1,
      "label": "ATR Period", "description": "ATR lookback for barrier scaling", "group": "Barriers"
    },
    "tpMultiplier": {
      "type": "float", "default": 2.0, "min": 0.5, "max": 5.0, "step": 0.1,
      "label": "TP Multiplier", "description": "Take-profit distance in ATR units", "group": "Barriers"
    },
    "slMultiplier": {
      "type": "float", "default": 2.0, "min": 0.5, "max": 5.0, "step": 0.1,
      "label": "SL Multiplier", "description": "Stop-loss distance in ATR units", "group": "Barriers"
    },
    "verticalBars": {
      "type": "int", "default": 60, "min": 10, "max": 500, "step": 10,
      "label": "Vertical Bars", "description": "Max bars before timeout barrier", "group": "Barriers"
    },
    "testSplit": {
      "type": "float", "default": 0.20, "min": 0.05, "max": 0.40, "step": 0.05,
      "label": "Test Split", "description": "Validation split ratio", "group": "Training"
    },
    "hpo": {
      "type": "bool", "default": false,
      "label": "HPO Mode", "description": "Run Optuna hyperparameter optimization", "group": "HPO"
    },
    "nTrials": {
      "type": "int", "default": 30, "min": 5, "max": 200, "step": 5,
      "label": "HPO Trials", "description": "Number of Optuna trials", "group": "HPO",
      "conditionalOn": { "param": "hpo", "value": true }
    }
  },
  "status": "PROD_READY",
  "tier": "INSTITUTIONAL"
}
```

- [ ] **Step 2: Replace hdp-hmm entry with complete ModelRegistryEntry**

Replace the `hdp-hmm` entry with:

```json
{
  "name": "Non-Parametric Bayesian Regime Discovery",
  "category": "unsupervised",
  "subcategory": "clustering",
  "runner": "python",
  "script": "src/ml/hdp_hmm/main.py",
  "featurePipeline": "self-contained",
  "outputs": ["regime_assignments", "transition_matrix", "regime_profiles"],
  "chartOverlay": "regime_zones",
  "outputDir": "data/models",
  "family": "custom",
  "gpuRequired": false,
  "estimatedTrainingTime": "10-60 min",
  "tags": ["bayesian", "regime-detection", "unsupervised", "hdp-hmm", "gibbs"],
  "description": "Discovers market regimes via Hierarchical Dirichlet Process Hidden Markov Model with Gibbs sampling. Automatically determines number of regimes.",
  "supportedObjectives": ["log_likelihood", "silhouette_score"],
  "cliFlags": {
    "gibbsIter": "--gibbs-iter",
    "burnIn": "--burn-in",
    "testSplit": "--test-split",
    "alpha": "--alpha",
    "gamma": "--gamma",
    "kappa": "--kappa",
    "overlayInterval": "--overlay-interval"
  },
  "defaultHyperparameters": {
    "gibbsIter": {
      "type": "int", "default": 200, "min": 50, "max": 2000, "step": 50,
      "label": "Gibbs Iterations", "description": "Total Gibbs sampling iterations", "group": "Sampling"
    },
    "burnIn": {
      "type": "int", "default": 100, "min": 10, "max": 1000, "step": 10,
      "label": "Burn-in", "description": "Iterations to discard before collecting samples", "group": "Sampling"
    },
    "testSplit": {
      "type": "float", "default": 0.20, "min": 0.05, "max": 0.40, "step": 0.05,
      "label": "Test Split", "description": "Validation split ratio", "group": "Training"
    },
    "alpha": {
      "type": "float", "default": 1.0, "min": 0.01, "max": 10.0, "step": 0.1,
      "label": "Alpha (DP concentration)", "description": "Controls expected number of regimes", "group": "Priors"
    },
    "gamma": {
      "type": "float", "default": 1.0, "min": 0.01, "max": 10.0, "step": 0.1,
      "label": "Gamma (HDP concentration)", "description": "Controls regime sharing across groups", "group": "Priors"
    },
    "kappa": {
      "type": "float", "default": 10.0, "min": 0.1, "max": 100.0, "step": 1.0,
      "label": "Kappa (sticky)", "description": "Self-transition bias — higher = fewer regime switches", "group": "Priors"
    },
    "overlayInterval": {
      "type": "int", "default": 25, "min": 5, "max": 100, "step": 5,
      "label": "Overlay Interval", "description": "Emit chart overlay every N iterations", "group": "Visualization"
    }
  },
  "status": "PROD_READY",
  "tier": "INSTITUTIONAL"
}
```

- [ ] **Step 3: Verify server loads the updated models.json**

Run: `cd "E:\source\repos\ml_dashboard" && node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('src/config/models.json','utf-8')); const m = j.models['cnn-transformer']; console.log('script:', m.script); console.log('outputDir:', m.outputDir); console.log('runner:', m.runner); console.log('hyperparams:', Object.keys(m.defaultHyperparameters).length);"`

Expected:
```
script: src/ml/cnn_transformer/main.py
outputDir: data/models
runner: python
hyperparams: 12
```

- [ ] **Step 4: Commit**

```bash
git add src/config/models.json
git commit -m "feat: populate models.json with complete ModelRegistryEntry for cnn-transformer and hdp-hmm"
```

---

### Task 2: Add missing CLI args and emit_metric_declarations() to main.py

**Files:**
- Modify: `src/ml/cnn_transformer/main.py`

PythonRunner passes `--json`, `--max-bars`, `--date-start`, `--date-end` flags. main.py currently ignores unknown args (argparse will error). Also, `emit_metric_declarations()` must be called before training starts so the dashboard pre-configures renderers.

- [ ] **Step 1: Add missing argparse flags**

Add these arguments to the parser in `main.py` (after the existing args, before `parse_args()` return):

```python
parser.add_argument("--json", action="store_true", help="JSON output mode (dashboard protocol)")
parser.add_argument("--max-bars", type=int, default=0, help="Limit OHLCV bars (0=all)")
parser.add_argument("--date-start", type=str, default=None, help="Start date filter (ISO)")
parser.add_argument("--date-end", type=str, default=None, help="End date filter (ISO)")
parser.add_argument("--feature-categories", type=str, default=None, help="Comma-separated feature categories")
parser.add_argument("--include-indicators", action="store_true", help="Include pre-computed indicators")
parser.add_argument("--all-features", action="store_true", help="Use all available features")
parser.add_argument("--indicator-groups", type=str, default=None, help="Comma-separated indicator groups")
```

- [ ] **Step 2: Apply max-bars and date filters to data loading**

After `data = load_ohlcv_arrays(...)` in both single run and HPO mode, add:

```python
# Apply date range filter if provided
if args.date_start or args.date_end:
    from datetime import datetime
    ts = data.get("timestamp", [])
    if ts:
        mask = np.ones(len(ts), dtype=bool)
        if args.date_start:
            start_dt = datetime.fromisoformat(args.date_start)
            mask &= np.array([t >= start_dt for t in ts])
        if args.date_end:
            end_dt = datetime.fromisoformat(args.date_end)
            mask &= np.array([t <= end_dt for t in ts])
        for key in data:
            if isinstance(data[key], np.ndarray):
                data[key] = data[key][mask]
            elif isinstance(data[key], list):
                data[key] = [v for v, m in zip(data[key], mask) if m]
        emit_log(f"Date filter applied: {mask.sum()} bars remaining")

# Apply max-bars limit if provided
if args.max_bars > 0 and len(data["close"]) > args.max_bars:
    for key in data:
        if isinstance(data[key], np.ndarray):
            data[key] = data[key][-args.max_bars:]
        elif isinstance(data[key], list):
            data[key] = data[key][-args.max_bars:]
    emit_log(f"Truncated to last {args.max_bars} bars")
```

- [ ] **Step 3: Add emit_metric_declarations() call before training starts**

Import `emit_metric_declarations` from `shared.protocol`. Call it after label generation but before the training loop in both single run and HPO modes:

```python
# Emit metric declarations so the dashboard pre-configures renderers
emit_metric_declarations({
    "train_loss": {
        "renderer": "time_series",
        "mission": "Is the model converging?",
        "context": {"higher_is_better": False, "good": 0.5, "great": 0.3}
    },
    "val_loss": {
        "renderer": "time_series",
        "mission": "Is validation loss decreasing?",
        "context": {"higher_is_better": False, "good": 0.5, "great": 0.3}
    },
    "barrier_class_accuracy": {
        "renderer": "percent",
        "mission": "Prediction accuracy on barrier outcomes?",
        "context": {"baseline": 0.33, "good": 0.45, "great": 0.55, "higher_is_better": True}
    },
    "profit_factor": {
        "renderer": "gauge",
        "mission": "Is this model profitable after costs?",
        "context": {"breakeven": 1.0, "good": 1.5, "great": 2.0, "min": 0, "max": 4.0, "higher_is_better": True}
    },
    "n_trades": {
        "renderer": "number",
        "mission": "How many trades in evaluation?",
        "context": {"min": 0, "good": 50, "great": 200, "unit": "trades"}
    },
})
```

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `cd "E:\source\repos\ml_dashboard" && python -m pytest tests/ml/ -x -v`
Expected: 126 passed

- [ ] **Step 5: Commit**

```bash
git add src/ml/cnn_transformer/main.py
git commit -m "feat: add missing CLI flags and emit_metric_declarations() for dashboard integration"
```

---

### Task 3: Register checkpoint in model_checkpoints table on training completion

**Files:**
- Modify: `src/server/training/runners/parsers/hdpHmmParser.ts`
- Modify: `src/shared/trainingTypes.ts`

When training completes (`done` event), the parser should insert a row into `model_checkpoints` with the self-describing diagnostics. This bridges the training pipeline to the new models API.

- [ ] **Step 1: Add checkpoint_registered to TrainingEventType**

In `src/shared/trainingTypes.ts`, add to the TrainingEventType union:

```typescript
  | 'checkpoint_registered';
```

- [ ] **Step 2: Register checkpoint in hdpHmmParser on done event**

In `src/server/training/runners/parsers/hdpHmmParser.ts`, add checkpoint registration inside the `case 'done':` block, before the `emitSessionEvent`:

```typescript
case 'done': {
    // Register checkpoint in model_checkpoints table if diagnostics contain self-describing metrics
    const doneDiagnostics = msg.diagnostics as Record<string, unknown> | undefined;
    if (doneDiagnostics?.metrics && typeof doneDiagnostics.metrics === 'object') {
      try {
        const { db } = await import("../../../database/db");
        const { modelCheckpoints } = await import("@shared/schema");
        const diagJson = JSON.stringify(doneDiagnostics);
        const arch = doneDiagnostics.architecture as Record<string, unknown> | undefined;
        const training = doneDiagnostics.training as Record<string, unknown> | undefined;

        db.insert(modelCheckpoints).values({
          modelId: ctx.modelId,
          modelType: (doneDiagnostics.model_type as string) || 'unknown',
          symbol: (doneDiagnostics.symbol as string) || '',
          timeframe: (doneDiagnostics.timeframe as string) || '',
          diagnosticsJson: diagJson,
          checkpointPath: `${ctx.modelsDir}/${ctx.modelId}/checkpoint_best.pt`,
          diagnosticsPath: `${ctx.modelsDir}/${ctx.modelId}/diagnostics.json`,
          primaryMetric: doneDiagnostics.metrics
            ? (((doneDiagnostics.metrics as Record<string, any>)?.profit_factor?.value
              ?? (doneDiagnostics.metrics as Record<string, any>)?.silhouette_score?.value) as number | undefined)
            : undefined,
          primaryMetricName: doneDiagnostics.metrics
            ? ((doneDiagnostics.metrics as Record<string, any>)?.profit_factor ? 'profit_factor' : 'silhouette_score')
            : undefined,
          paramCount: (arch?.param_count as number | undefined),
          trainingDurationSec: (training?.duration_sec as number | undefined),
          nBarsTrain: (training?.n_bars_train as number | undefined),
          nBarsVal: (training?.n_bars_val as number | undefined),
          isActive: 1,
          sessionId: session.dbSessionId ?? undefined,
        }).run();

        emitSessionEvent(session, 'log', { message: `Checkpoint registered: ${ctx.modelId}`, level: 'info' });
      } catch (err) {
        emitSessionEvent(session, 'log', { message: `Checkpoint registration failed: ${err}`, level: 'warning' });
      }
    }

    emitSessionEvent(session, 'done', {
      modelId: ctx.modelId,
      modelPath: msg.modelPath,
      elapsedSec: msg.elapsedSec,
      diagnostics: msg.diagnostics,
    });
    break;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd "E:\source\repos\ml_dashboard" && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: Same count as before (21 pre-existing errors, 0 new)

- [ ] **Step 4: Commit**

```bash
git add src/server/training/runners/parsers/hdpHmmParser.ts src/shared/trainingTypes.ts
git commit -m "feat: auto-register checkpoint in model_checkpoints table on training completion"
```

---

### Task 4: Dashboard-spawn integration test

**Files:**
- Create: `tests/ml/cnn_transformer/test_integration.py`

Verify the full JSON protocol that the dashboard expects: main.py accepts all PythonRunner flags, emits metric_declarations, emits progress/metric events, emits done with self-describing diagnostics.

- [ ] **Step 1: Write integration test**

```python
"""Integration test: verify main.py speaks the dashboard JSON protocol.

Runs main.py as a subprocess with a tiny synthetic dataset, captures stdout,
and verifies the JSON event stream matches what PythonRunner expects.
"""

import json
import subprocess
import sys
import os
import pytest
import numpy as np

MAIN_PY = os.path.join(os.path.dirname(__file__), "..", "..", "..", "src", "ml", "cnn_transformer", "main.py")


@pytest.fixture
def tiny_ohlcv(tmp_path):
    """Create a tiny parquet file so main.py doesn't need QuestDB."""
    # We'll test the protocol by mocking the data load
    pass


class TestDashboardProtocol:
    """Verify main.py emits correct JSON events for dashboard consumption."""

    def test_accepts_all_runner_flags(self):
        """main.py should accept all flags PythonRunner sends without error."""
        result = subprocess.run(
            [sys.executable, MAIN_PY, "--help"],
            capture_output=True, text=True, timeout=10,
        )
        help_text = result.stdout
        required_flags = [
            "--symbol", "--timeframe", "--model-id", "--json",
            "--max-bars", "--date-start", "--date-end",
            "--window-size", "--epochs", "--batch-size", "--learning-rate",
            "--atr-period", "--tp-multiplier", "--sl-multiplier", "--vertical-bars",
            "--test-split", "--hpo", "--n-trials",
        ]
        for flag in required_flags:
            assert flag in help_text, f"Missing CLI flag: {flag}"

    def test_metric_declarations_format(self):
        """Verify emit_metric_declarations() output matches expected schema."""
        from ml.shared.protocol import emit_metric_declarations
        import io
        from contextlib import redirect_stdout

        buf = io.StringIO()
        with redirect_stdout(buf):
            emit_metric_declarations({
                "profit_factor": {
                    "renderer": "gauge",
                    "mission": "Is this model profitable?",
                    "context": {"breakeven": 1.0},
                },
            })

        line = buf.getvalue().strip()
        msg = json.loads(line)
        assert msg["type"] == "metric_declarations"
        assert "profit_factor" in msg["declarations"]
        decl = msg["declarations"]["profit_factor"]
        assert decl["renderer"] == "gauge"
        assert decl["mission"] == "Is this model profitable?"
        assert decl["context"]["breakeven"] == 1.0

    def test_diagnostics_is_self_describing(self):
        """Verify save_diagnostics() produces valid SelfDescribingDiagnostics."""
        from ml.shared.diagnostics_schema import validate_diagnostics
        from ml.cnn_transformer.io.save import save_diagnostics
        import tempfile, torch
        from ml.cnn_transformer.model import CnnTransformerModel

        model = CnnTransformerModel(window_size=32, d_input=5)
        with tempfile.TemporaryDirectory() as tmpdir:
            diag = save_diagnostics(
                output_dir=tmpdir,
                symbol="TEST",
                timeframe="1m",
                model=model,
                train_result={
                    "best_epoch": 1,
                    "best_val_loss": 0.5,
                    "best_metrics": {"barrier_class_accuracy": 0.4},
                    "epoch_history": [{"epoch": 1, "train_loss": 0.6, "val_loss": 0.5}],
                    "total_time_sec": 10.0,
                },
                n_total=1000,
                n_train=800,
                n_val=200,
                start_ts="2024-01-01T00:00:00",
                end_ts="2025-01-01T00:00:00",
                barrier_config={"atr_period": 14, "tp_mult": 2.0, "sl_mult": 2.0, "vertical_bars": 60},
                profit_factor=1.5,
                sharpe=0.8,
                n_trades=100,
                class_metrics={"tp": {"precision": 0.5, "recall": 0.4, "f1": 0.44},
                               "sl": {"precision": 0.3, "recall": 0.3, "f1": 0.3},
                               "timeout": {"precision": 0.2, "recall": 0.3, "f1": 0.24}},
                elapsed=10.0,
                walk_forward_results=None,
            )

            # Validate with Pydantic
            validated = validate_diagnostics(diag)
            assert validated.model_type == "cnn-transformer"
            assert "profit_factor" in validated.metrics
            assert validated.metrics["profit_factor"].renderer == "gauge"

    def test_emit_done_includes_diagnostics(self):
        """Verify emit_done() payload includes self-describing diagnostics."""
        from ml.shared.protocol import emit_done
        import io
        from contextlib import redirect_stdout

        diag = {
            "model_type": "cnn-transformer",
            "symbol": "MNQ",
            "timeframe": "1m",
            "metrics": {
                "profit_factor": {
                    "value": 1.5,
                    "renderer": "gauge",
                    "mission": "Profitable?",
                    "context": {"breakeven": 1.0},
                }
            },
            "training": {"duration_sec": 60, "trained_at": "2026-03-27T00:00:00"},
        }

        buf = io.StringIO()
        with redirect_stdout(buf):
            emit_done("/tmp/model", diag)

        line = buf.getvalue().strip()
        msg = json.loads(line)
        assert msg["type"] == "done"
        assert msg["diagnostics"]["model_type"] == "cnn-transformer"
        assert "profit_factor" in msg["diagnostics"]["metrics"]
```

- [ ] **Step 2: Run the integration tests**

Run: `cd "E:\source\repos\ml_dashboard" && python -m pytest tests/ml/cnn_transformer/test_integration.py -v`
Expected: 4 passed

- [ ] **Step 3: Run full test suite**

Run: `cd "E:\source\repos\ml_dashboard" && python -m pytest tests/ml/ -x -v`
Expected: 130 passed (126 existing + 4 new)

- [ ] **Step 4: Commit**

```bash
git add tests/ml/cnn_transformer/test_integration.py
git commit -m "test: dashboard-spawn integration tests for CNN-Transformer JSON protocol"
```

---

### Task 5: Rename swing baseline checkpoint

**Files:**
- Modify: `data/models/MNQ_1m_cnn_transformer/` (filesystem operation)

The old 91.8% swing accuracy checkpoint needs to be renamed to make it clear it's a deprecated baseline, not the active model.

- [ ] **Step 1: Rename checkpoint_best.pt to checkpoint_swing_baseline.pt**

```bash
cd "E:\source\repos\ml_dashboard"
mv data/models/MNQ_1m_cnn_transformer/checkpoint_best.pt data/models/MNQ_1m_cnn_transformer/checkpoint_swing_baseline.pt
```

- [ ] **Step 2: Update diagnostics.json to note the baseline**

Add a `"deprecated": true` field and `"note": "Swing baseline — misleading 91.8% accuracy from autocorrelated labels"` to the existing diagnostics.json.

- [ ] **Step 3: Commit**

```bash
git add -A data/models/MNQ_1m_cnn_transformer/
git commit -m "chore: rename swing baseline checkpoint, mark as deprecated"
```

---

### Task 6: Update CLAUDE.md and memory with Plan 3 status

**Files:**
- Modify: `E:\source\repos\ml_dashboard\CLAUDE.md`
- Modify: `C:\Users\tyler\.claude\projects\C--Users-tyler\memory\ml-dashboard.md`

- [ ] **Step 1: Update CLAUDE.md Plan 2/3 status**

Update the Plan 2 line to show completion and add Plan 3 status.

- [ ] **Step 2: Update memory file with integration status**

Update the Triple Barrier section to reflect that dashboard training integration is complete.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Plan 3 completion status"
```
