"""Compute Optuna param importance per fold and aggregated.

Spawned by ``GET /api/hpo/sessions/:id/importance``.

Output JSON shape::

    {
        "folds": [{"fold": 0, "n_trials": 23, "importance": {"max_depth": 0.31, ...}}, ...],
        "aggregated": {"max_depth": 0.29, "learning_rate": 0.18, ...},
        "method": "fanova"
    }
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import optuna
    from optuna.importance import get_param_importances
except Exception as exc:  # noqa: BLE001
    print(json.dumps({"error": f"optuna import failed: {exc}"}))
    sys.exit(1)


def _per_fold(study_dir: Path, base_name: str, folds: list[int]) -> dict:
    out_folds = []
    accum: dict[str, list[float]] = {}
    for f in folds:
        study_path = study_dir / f"{base_name}_fold{f}.db"
        if not study_path.exists():
            continue
        try:
            study = optuna.load_study(
                study_name=f"{base_name}_fold{f}",
                storage=f"sqlite:///{study_path.as_posix()}",
            )
        except Exception as exc:  # noqa: BLE001
            out_folds.append({"fold": f, "error": f"load failed: {exc}"})
            continue
        n_trials = len([t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE])
        if n_trials < 4:
            out_folds.append({"fold": f, "n_trials": n_trials, "importance": {}})
            continue
        try:
            imp = get_param_importances(study)
        except Exception as exc:  # noqa: BLE001
            out_folds.append({"fold": f, "n_trials": n_trials, "error": str(exc)})
            continue
        out_folds.append({"fold": f, "n_trials": n_trials,
                          "importance": {k: float(v) for k, v in imp.items()}})
        for k, v in imp.items():
            accum.setdefault(k, []).append(float(v))

    aggregated = {}
    for k, vals in accum.items():
        aggregated[k] = sum(vals) / len(vals)

    return {"folds": out_folds, "aggregated": aggregated, "method": "fanova"}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--study-dir", required=True)
    p.add_argument("--base-name", required=True)
    p.add_argument("--folds", required=True, help="Comma-separated fold indices")
    args = p.parse_args()

    folds = [int(x.strip()) for x in args.folds.split(",") if x.strip()]
    out = _per_fold(Path(args.study_dir), args.base_name, folds)
    sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    main()
