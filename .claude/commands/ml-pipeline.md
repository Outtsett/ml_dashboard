# ML Pipeline

Manage the full machine learning workflow: features, labels, training, models, and explainability.

## Usage: /ml-pipeline [action]

Actions: features, labels, train, models, explain

### features
Two tiers of features:

**Config-driven inline features** (29 features in `src/config/features.json`):
- Computed at training time by `src/ml/features.py` from raw OHLCV
- 8 categories: returns, volatility, parkinson, volume, price_structure, momentum, ma_distance, swing
- Dispatch table maps feature type → compute function
- Adding a feature = add one JSON entry to `features.json` (+ compute function if new type)

Key files:
- `src/config/features.json` — single source of truth for inline feature registry
- `src/ml/shared/features.py` — config-driven computation with dispatch table
- `src/ml/shared/swing.py` — causal zigzag swing features (no lookahead)
- `server/routes/indicators/helpers.ts` — indicator query helpers (pre-computed tables removed)

### labels
Generate labels for supervised learning:
- POST `/api/labels/generate` with { symbol, generatorType, config }
- 15+ generators: direction, tripleBarrier, npmm, volatilityAdaptive, contrastive, regime, etc.
- GET `/api/labels/generators` for full list with parameter schemas

Key files:
- `server/lib/labels/sqlLabelGenerators.ts` — SQL-based generators (QuestDB CTE approach)
- `server/lib/labels/contrastivePairs.ts` — self-supervised pair generation

### train
Start model training via the dashboard (press "Run" button):
- POST `/api/training/start` with { modelId, symbol, timeframe, hyperparams }
- GET `/api/training/stream/:sessionId` for SSE progress events
- GET `/api/training/status` for current state

Training pipeline:
1. Orchestrator resolves config from `config/models.json`
2. PythonRunner spawns `src/ml/hdp_hmm/main.py` with CLI args
3. Python reads QuestDB directly via PG wire (`shared/data.py`, psycopg2)
4. `shared/features.py` computes 29 inline features from raw OHLCV
5. Model trains, saves artifacts to `data/models/` (assignments.csv, diagnostics.json, convergence.json)
6. Server reads results from disk for UI display

Key files:
- `server/training/orchestrator.ts` — central coordinator
- `server/training/runners/pythonRunner.ts` — spawns Python, parses stdout metrics
- `src/ml/hdp_hmm/main.py` — HDP-HMM entry point (CLI + orchestration)
- `src/ml/hdp_hmm/model.py` — StickyHDPHMM class + Numba JIT kernels
- `src/ml/shared/features.py` — config-driven feature computation
- `src/ml/hdp_hmm/io/save.py` — writes results to disk

### models
CRUD operations on ML models:
- GET/POST `/api/ml/models` — list/create
- GET/PUT `/api/ml/models/:id` — get/update
- Taxonomy: supervised/unsupervised/self-supervised/semi-supervised
- See `shared/mlTaxonomy.ts` for categories, subcategories, metrics

### explain
Run XAI explanations:
- POST `/api/xai/explain` with { method, input, modelId, symbol }
- GET `/api/xai/methods` — list available methods
- GET `/api/xai/shap/:modelId` — SHAP summary from diagnostics.json (per-bar SHAP table removed)
- GET `/api/xai/regime-importance/:modelId` — feature importance for regime models

Methods: shap, permutation, gradcam, lime, integratedGradients, saliency, featureInteractions, calibration, counterfactual

Key file: `server/lib/xai/xaiServiceCore.ts`
