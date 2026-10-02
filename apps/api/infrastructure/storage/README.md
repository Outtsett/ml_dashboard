# Storage — Drizzle Query Layer

Domain-specific query interfaces for the SQLite database. Routes call `storage.*` methods (never inline Drizzle queries in route handlers).

## Files

| File | Domain | Tables |
|---|---|---|
| `core.ts` | Users, settings, instruments | `users`, `instruments` |
| `modelStorage.ts` | ML models, outputs, ensembles | `ml_models`, `model_outputs`, `ensemble_configs`, `model_checkpoints` |
| `trainingStorage.ts` | Training sessions, loss history | `training_sessions`, `loss_history`, `feature_sets` |
| `regimeStorage.ts` | Market regimes, coherence | `market_regimes`, `coherence_snapshots` |
| `tradeStorage.ts` | Trades, broker configs | `trades`, `broker_configs` |
| `backtesting.ts` | Backtest runs and trades | `backtest_runs`, `backtest_trades` |
| `curriculum.ts` | Learning progress | `curriculum_progress` |
| `types.ts` | Shared storage type definitions | - |
| `index.ts` | Barrel exports (unified storage object) | - |

## Pattern

All storage methods follow the same pattern:
1. Accept typed parameters
2. Execute Drizzle ORM query
3. Return typed results
4. No HTTP concerns, no formatting, no side-effects

Route handlers import specific methods from `storage` and never construct raw SQL or Drizzle queries inline.
