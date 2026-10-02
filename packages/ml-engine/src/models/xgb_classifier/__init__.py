"""XGBoost direction-classifier model package.

Modules:
  - labels:  triple-barrier-style binary direction labels with embargo
  - eval:    classification + cost-adjusted PnL diagnostics
  - main:    single-fold trainer (CLI entry point)
  - wf_main: walk-forward driver
  - hpo_main: nested HPO-per-fold driver (Optuna SQLite persistence)
"""
