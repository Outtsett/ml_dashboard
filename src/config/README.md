# Config — JSON Configuration Files

Centralized JSON configuration files that drive the application's behavior. These configs are the single source of truth for model definitions, feature pipelines, training infrastructure, and UI visualization.

## Files

| File | Purpose | Consumed By |
|---|---|---|
| `models.json` | Model registry: runner, script path, hyperparams, CLI flags, metric declarations | Server training orchestrator, client metric renderers |
| `features.json` | Feature registry: 35 features across 10 categories with normalization config | Python `features.py` (dispatch table), feature research scripts |
| `feature_extraction.json` | Per-indicator transform specs (13 categories, 8 transform types) | Python `feature_extract.py` (ML training pipeline) |
| `training.json` | Infrastructure config: paths, resource limits, timeframe map | Server training orchestrator |
| `cost_model.json` | Trading cost model: commissions + slippage per broker (AMP/CQG: $2.80 RT for MNQ) | Python trade simulator, backtest engine |
| `visualizations.json` | Config-driven visualization component registry | Client visualization system |
| `metric-descriptions.json` | Legacy metric annotations (superseded by `metricDeclarations` in `models.json`) | Deprecated, kept for reference |
| `model-templates.json` | Model template definitions | Model creation UI |

## Key Patterns

- **Config-driven features**: Adding a new feature = add a JSON entry in `features.json`. Python `features.py` reads this config via dispatch table. No code changes needed.
- **Self-describing metrics**: `models.json` contains `metricDeclarations` per model type. Each declaration specifies renderer type, mission text, context thresholds, and group. The dashboard renders any metric the model declares.
- **Cost injection**: `cost_model.json` provides broker-specific costs that are injected into trade simulation and backtest evaluation. Keeps cost assumptions explicit and auditable.
