# ML Pipeline

Manage the full machine learning workflow: features, labels, training, models, and explainability.

## Usage: /ml-pipeline [action]

Actions: features, labels, train, models, explain

### features
Generate features via DuckDB SQL indicators:
- POST `/api/indicators/generate-sql` with { symbol, preset, period }
- Presets: momentum, volatility, trend, full
- Uses DuckDB SQL window functions (matches TypeScript math exactly)

Key files:
- `server/lib/indicators/registry.ts` — indicator definitions
- `server/lib/indicators/sqlGenerator.ts` — SQL generation (default table: ohlcv, timestamp col: ts)
- `server/lib/indicators/math.ts` — core math (SMA, EMA, RSI, etc.)

### labels
Generate labels for supervised learning:
- POST `/api/labels/generate` with { symbol, generatorType, config }
- 15+ generators: direction, tripleBarrier, npmm, volatilityAdaptive, contrastive, regime, etc.
- GET `/api/labels/generators` for full list with parameter schemas

Key files:
- `server/lib/labels/sqlLabelGenerators.ts` — SQL-based generators
- `server/lib/labels/contrastivePairs.ts` — self-supervised pair generation

### train
Start model training:
- POST `/api/ml/train/start` with { modelId, config }
- GET `/api/ml/train/stream` for SSE progress events
- GET `/api/ml/train/status` for current state

Key files:
- `server/ml/trainer.ts` — MLTrainer class (EventEmitter-based)
- `server/ml/cnn.ts` — CNN architecture

### models
CRUD operations on ML models:
- GET/POST `/api/ml/models` — list/create
- GET/PUT `/api/ml/models/:id` — get/update
- Taxonomy: supervised/unsupervised/self-supervised/semi-supervised
- See `shared/mlTaxonomy.ts` for categories, subcategories, metrics

### explain
Run XAI explanations:
- POST `/api/xai/explain` with { modelId, method, inputData }
- Methods: shap, permutation, gradcam, lime, integratedGradients, counterfactual, attentionWeights, ablation, prototypes
- GET `/api/xai/methods` for available methods

Key file: `server/lib/xai/xaiService.ts`
