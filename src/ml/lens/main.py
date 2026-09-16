"""Model Lens builder CLI.

    python -m ml.lens.main --model-id xgb_baseline_post [--json]
    python -m ml.lens.main --inspect --model-id xgb_baseline_post
    python -m ml.lens.main --inspect-all

Writes ``data/models/<id>/lens/{manifest.json, bars.parquet, attribution.parquet}``
per the contract in ``src/shared/lens/types.ts``. Every path prints exactly one
JSON object as its last stdout line, which is what the Node server reads.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

if __package__ in (None, ""):  # `python src/ml/lens/main.py`
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lens import LENS_BUILDER_VERSION  # noqa: E402
from lens.adapters import (  # noqa: E402
    PROJECT_ROOT,
    TIMEFRAME_SECONDS,
    Record,
    Refusal,
    check,
    detect_schema,
    load_cost,
    load_record,
)
from lens.families import assign_families  # noqa: E402
from lens.interval import causal_conformal_quantiles  # noqa: E402

MODELS_ROOT = PROJECT_ROOT / "data" / "models"

QUANTILE_COLUMNS = [
    "predicted_return_quantile_05_basis_points",
    "predicted_return_quantile_10_basis_points",
    "predicted_return_quantile_25_basis_points",
    "predicted_return_quantile_50_basis_points",
    "predicted_return_quantile_75_basis_points",
    "predicted_return_quantile_90_basis_points",
    "predicted_return_quantile_95_basis_points",
]


def _now_iso() -> str:
    return datetime.datetime.now(datetime.UTC).isoformat()


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _prediction_artifact(model_dir: Path) -> Path | None:
    for name in ("oos_predictions.parquet", "oos_predictions.npz"):
        candidate = model_dir / name
        if candidate.exists():
            return candidate
    return None


def _duplicate_of(model_dir: Path, models_root: Path) -> str | None:
    """Another model whose prediction artifact is byte-identical to this one."""
    mine = _prediction_artifact(model_dir)
    if mine is None:
        return None
    digest = _sha256(mine)
    matches = []
    for other in sorted(p for p in models_root.iterdir() if p.is_dir() and p.name != model_dir.name):
        theirs = _prediction_artifact(other)
        if theirs is not None and theirs.name == mine.name and _sha256(theirs) == digest:
            matches.append(other.name)
    return matches[0] if matches else None


# ─── Build ───────────────────────────────────────────────────────────────────


def build(model_id: str, models_root: Path = MODELS_ROOT) -> dict:
    model_dir = models_root / model_id
    if not model_dir.is_dir():
        raise Refusal(f"no model directory data/models/{model_id}")

    record = load_record(model_dir)
    lens_dir = model_dir / "lens"
    lens_dir.mkdir(parents=True, exist_ok=True)

    quantiles, interval_meta = causal_conformal_quantiles(
        record.probability_up,
        record.realized_return_basis_points,
        record.horizon_bars,
    )

    verification = list(record.verification)
    verification.append(
        check(
            "forward_return_horizon_consistent",
            _horizon_is_consistent(record),
            f"realized return recomputed from close over {record.horizon_bars} rows "
            f"differs by at most {_horizon_error(record):.3e} basis points",
            "< 1e-3 basis points (the stored realized return matches the stored prices)",
        )
    )
    verification.append(
        check(
            "interval_is_causal",
            interval_meta["coveredBarCount"] < record.row_count,
            f"{interval_meta['coveredBarCount']} of {record.row_count} bars carry an interval; "
            f"the first {record.row_count - interval_meta['coveredBarCount']} are warm-up",
            "early bars carry no interval (calibration uses only rows whose horizon has elapsed)",
        )
    )

    _write_bars(lens_dir, record, quantiles)
    attribution_block = _write_attribution(lens_dir, record)

    manifest = {
        "modelId": record.model_id,
        "builderVersion": LENS_BUILDER_VERSION,
        "builtAtIso": _now_iso(),
        "sourceSchema": record.source_schema,
        "sourceFiles": record.source_files,
        "symbol": record.symbol,
        "timeframe": record.timeframe,
        "barSeconds": TIMEFRAME_SECONDS.get(record.timeframe, 60),
        "horizonBars": record.horizon_bars,
        "horizonSource": record.horizon_source,
        "labelDefinition": record.label_definition,
        "defaultThreshold": record.default_threshold,
        "cost": load_cost(record.symbol),
        "barCount": record.row_count,
        "firstTimestampSeconds": int(record.timestamp_seconds[0]),
        "lastTimestampSeconds": int(record.timestamp_seconds[-1]),
        "interval": {k: v for k, v in interval_meta.items() if k != "recalibrationCount"},
        "attribution": attribution_block,
        "reference": record.reference,
        "verification": verification,
        "notes": record.notes,
    }
    (lens_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def _horizon_error(record: Record) -> float:
    n = record.row_count
    h = record.horizon_bars
    if n <= h:
        return float("nan")
    recomputed = np.log(record.close[h:] / record.close[: n - h]) * 10_000.0
    stored = record.realized_return_basis_points[: n - h]
    finite = np.isfinite(recomputed) & np.isfinite(stored)
    return float(np.max(np.abs(recomputed[finite] - stored[finite]))) if finite.any() else float("nan")


def _horizon_is_consistent(record: Record) -> bool:
    error = _horizon_error(record)
    return bool(np.isfinite(error) and error < 1e-3)


def _write_bars(lens_dir: Path, record: Record, quantiles: np.ndarray) -> None:
    import polars as pl

    n = record.row_count
    label = np.where(np.isfinite(record.label), record.label, np.nan)
    columns = {
        "row_index": pl.Series(np.arange(n, dtype=np.int32)),
        "timestamp_seconds": pl.Series(record.timestamp_seconds.astype(np.int64)),
        "open": pl.Series(record.open.astype(np.float64)),
        "high": pl.Series(record.high.astype(np.float64)),
        "low": pl.Series(record.low.astype(np.float64)),
        "close": pl.Series(record.close.astype(np.float64)),
        "volume": pl.Series(record.volume.astype(np.float64)),
        "probability_up": pl.Series(record.probability_up.astype(np.float32)),
        "label": pl.Series(label).cast(pl.Int8, strict=False),
        "realized_return_basis_points": pl.Series(record.realized_return_basis_points.astype(np.float32)),
    }
    for index, name in enumerate(QUANTILE_COLUMNS):
        columns[name] = pl.Series(quantiles[:, index].astype(np.float32))
    pl.DataFrame(columns).write_parquet(lens_dir / "bars.parquet", compression="zstd", compression_level=3)


def _write_attribution(lens_dir: Path, record: Record) -> dict:
    import polars as pl

    target = lens_dir / "attribution.parquet"
    if record.attribution is None:
        target.unlink(missing_ok=True)
        return {"available": False, "reason": record.attribution_reason or "no attribution artifact"}

    names, shap, values = record.attribution
    families, blocks, unmapped = assign_families(names)
    n, feature_count = shap.shape
    rows = np.arange(n, dtype=np.int32)

    frame = pl.DataFrame({
        "row_index": pl.Series(np.repeat(rows, feature_count)),
        "feature_name": pl.Series(names * n),
        "feature_family": pl.Series(families * n),
        "shap_value": pl.Series(shap.reshape(-1).astype(np.float32)),
        "feature_value": pl.Series(
            (values.reshape(-1).astype(np.float32) if values is not None else np.full(n * feature_count, np.nan, dtype=np.float32))
        ),
    })
    # Rows whose attribution is absent carry no entries at all rather than zeros.
    frame = frame.filter(pl.col("shap_value").is_not_nan())
    frame.write_parquet(target, compression="zstd", compression_level=3)

    block = {
        "available": True,
        "method": record.attribution_method,
        "featureCount": feature_count,
        "families": blocks,
    }
    if unmapped:
        block["reason"] = f"features with no registry category, counted under macro: {', '.join(unmapped)}"
    return block


# ─── Inspect ─────────────────────────────────────────────────────────────────


def inspect(model_id: str, models_root: Path = MODELS_ROOT) -> dict:
    """Status of one model without building: cheap header reads only."""
    model_dir = models_root / model_id
    out: dict = {
        "modelId": model_id,
        "status": "refused",
        "reason": None,
        "sourceSchema": None,
        "symbol": None,
        "timeframe": None,
        "barCount": None,
        "firstTimestampSeconds": None,
        "lastTimestampSeconds": None,
        "duplicateOf": None,
        "notes": [],
    }
    if not model_dir.is_dir():
        out["reason"] = f"no model directory data/models/{model_id}"
        return out

    try:
        out["sourceSchema"] = detect_schema(model_dir)
    except Refusal as refusal:
        out["reason"] = str(refusal)
        return out
    except Exception as error:  # unreadable artifact — say so, do not crash the listing
        out["reason"] = f"could not read the prediction artifact: {error}"
        return out

    out["duplicateOf"] = _duplicate_of(model_dir, models_root)
    manifest_path = model_dir / "lens" / "manifest.json"
    if not manifest_path.exists():
        out["status"] = "not_built"
        out["reason"] = "lens has not been built for this model yet"
        return out

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    out.update({
        "symbol": manifest.get("symbol"),
        "timeframe": manifest.get("timeframe"),
        "barCount": manifest.get("barCount"),
        "firstTimestampSeconds": manifest.get("firstTimestampSeconds"),
        "lastTimestampSeconds": manifest.get("lastTimestampSeconds"),
        "notes": manifest.get("notes", []),
    })

    stale = [
        entry["path"]
        for entry in manifest.get("sourceFiles", [])
        if not (PROJECT_ROOT / entry["path"]).exists() or _sha256(PROJECT_ROOT / entry["path"]) != entry["sha256"]
    ]
    missing_tables = [
        name for name in ("bars.parquet",) if not (model_dir / "lens" / name).exists()
    ]
    if manifest.get("builderVersion") != LENS_BUILDER_VERSION:
        out["status"] = "stale"
        out["reason"] = f"built by lens version {manifest.get('builderVersion')}, current is {LENS_BUILDER_VERSION}"
    elif stale:
        out["status"] = "stale"
        out["reason"] = f"source artifact changed since the lens was built: {', '.join(stale)}"
    elif missing_tables:
        out["status"] = "stale"
        out["reason"] = f"lens table missing: {', '.join(missing_tables)}"
    else:
        out["status"] = "ready"
        out["reason"] = None
    return out


def inspect_all(models_root: Path = MODELS_ROOT) -> dict:
    models = [inspect(p.name, models_root) for p in sorted(models_root.iterdir()) if p.is_dir()]
    # Ready models first, then the largest record — the default view should open
    # on the model with the most out-of-sample evidence behind it.
    order = {"ready": 0, "stale": 1, "not_built": 2, "failed": 3, "refused": 4}
    models.sort(key=lambda m: (order.get(m["status"], 9), -(m["barCount"] or 0), m["modelId"]))
    return {"models": models}


# ─── Entry point ─────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the Model Lens artifacts for a trained model.")
    parser.add_argument("--model-id")
    parser.add_argument("--models-root", default=str(MODELS_ROOT))
    parser.add_argument("--inspect", action="store_true", help="report status without building")
    parser.add_argument("--inspect-all", action="store_true", help="report status for every model directory")
    parser.add_argument("--json", action="store_true", help="accepted for symmetry with the trainers; output is always JSON")
    args = parser.parse_args()

    models_root = Path(args.models_root)

    if args.inspect_all:
        print(json.dumps(inspect_all(models_root)))
        return 0

    if not args.model_id:
        print(json.dumps({"status": "failed", "reason": "--model-id is required"}))
        return 2

    if args.inspect:
        print(json.dumps(inspect(args.model_id, models_root)))
        return 0

    try:
        manifest = build(args.model_id, models_root)
    except Refusal as refusal:
        print(json.dumps({"status": "refused", "reason": str(refusal)}))
        return 0
    except Exception as error:  # noqa: BLE001 — the reason is the product here
        import traceback

        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"status": "failed", "reason": f"{type(error).__name__}: {error}"}))
        return 1

    print(json.dumps({"status": "ready", "manifest": manifest}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
