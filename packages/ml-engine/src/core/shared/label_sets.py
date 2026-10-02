"""
Persisted label sets, and the one parameter contract every label path shares.

Two things broke the label lifecycle at the training boundary, and this module
is where both are settled.

**The parameter contract.** The dashboard previews a strategy through the SQL
generators, whose parameters are named the way the taxonomy declares them
(``horizonBars``, ``pivotLookbackBars``, ``bucketCount``...). The Python kernels
in ``labels.py`` that a model actually trains on read different names
(``horizon_bars``, ``lookback_bars``, ``n_buckets``...). The generated runner
passed the UI dict straight through, so the kernel fell back to its own
defaults — ``range_bucket`` previewed at a 16-bar horizon trained at 1, and
``structural`` previewed with a 5-bar pivot trained with 20 — while
``triple_barrier`` raised on a missing key. Measured on identical bars, the two
implementations agree 100% once the names are translated; the disagreement was
never in the maths. :func:`translate_label_params` is that translation, applied
at render time and again defensively at load time, so it cannot be skipped.
Both the current names and the pre-2026-09-26 abbreviations (``horizon``,
``pivotLookback``, ``takeProfitPct``...) are accepted, so a saved config keeps
meaning what it meant.

**Persisted sets.** ``generateLabels`` writes a set's rows to the lake as
parquet under the label contract (see ``packages/shared/src/labels/contract.ts``):
beside ``timestamp`` and ``label`` every row carries ``resolution_bars``,
``sample_uniqueness_weight``, ``return_attribution_weight`` and ``usable``.
:func:`load_label_set` reads one back and aligns it to a training run's bar
timestamps, so a run trains on exactly the rows a person previewed and saved
rather than recomputing something similar, and receives the weights and the
purge the set implies.
"""
from __future__ import annotations

import os
import warnings
from dataclasses import dataclass, field
from typing import Any

import numpy as np

# ─── Parameter contract ─────────────────────────────────────────────────────

# UI / SQL-generator name  ->  labels.py kernel name, per strategy. Both the
# current full-word names and the legacy abbreviations are listed.
_PARAM_ALIASES: dict[str, dict[str, str]] = {
    "next_close_direction": {
        "horizonBars": "horizon_bars", "horizon": "horizon_bars",
        "thresholdPoints": "threshold_pts", "thresholdPts": "threshold_pts",
    },
    "range_bucket": {
        "horizonBars": "horizon_bars", "horizon": "horizon_bars",
        "bucketCount": "n_buckets", "nBuckets": "n_buckets",
        "bucketWidthPoints": "bucket_width_pts", "bucketWidthPts": "bucket_width_pts",
    },
    "structural": {"pivotLookbackBars": "lookback_bars", "pivotLookback": "lookback_bars"},
    "triple_barrier": {
        "holdingPeriodBars": "horizon_bars", "maxHoldingPeriod": "horizon_bars",
        "volatilityWindowBars": "atr_window", "volatilityWindow": "atr_window",
    },
}

# Parameters of the SQL triple barrier that the kernel does not read directly.
_TRIPLE_BARRIER_UI_ONLY = (
    "barrierUnits", "upperBarrierMultiple", "lowerBarrierMultiple", "volatilityMeasure",
    "takeProfitPercent", "stopLossPercent", "takeProfitPct", "stopLossPct",
    "minimumReturnPercent", "minReturn", "sameBarTouchConvention", "volatilityAdjust",
)


def translate_label_params(strategy: str, params: dict[str, Any] | None) -> dict[str, Any]:
    """Return the kernel-named parameter dict for ``strategy``.

    Kernel-named keys pass through untouched, so a dict that is already in the
    Python vocabulary is a no-op. Unknown keys are kept: the kernels ignore
    what they do not read, and dropping them would hide a caller's mistake.

    The triple barrier is the one strategy whose two implementations differ in
    shape: the SQL generator takes asymmetric barriers in volatility units
    (or percent), the kernel one symmetric barrier as an ATR multiple (or a
    fixed number of basis points). The translation keeps the UPPER barrier's
    width and warns when the lower one differs, because a model trained on a
    symmetric barrier is a different model from the one previewed.
    """
    p = dict(params or {})
    out: dict[str, Any] = {}
    aliases = _PARAM_ALIASES.get(strategy, {})
    for key, value in p.items():
        out[aliases.get(key, key)] = value

    if strategy == "triple_barrier":
        units = out.pop("barrierUnits", None)
        legacy_percent = any(k in p for k in ("takeProfitPct", "stopLossPct", "volatilityAdjust"))
        if units is None and legacy_percent:
            units = "percent"
        if units is None:
            units = "volatility"

        if "threshold_mode" not in out:
            if units == "percent":
                tp = out.get("takeProfitPercent", out.get("takeProfitPct"))
                sl = out.get("stopLossPercent", out.get("stopLossPct"))
                if tp is not None:
                    out["threshold_mode"] = "fixed_bp"
                    out["threshold_bp"] = float(tp) * 100.0
                    if sl is not None and abs(float(sl) - float(tp)) > 1e-9:
                        warnings.warn(
                            f"triple_barrier: takeProfitPercent={tp} and stopLossPercent={sl} are unequal; "
                            f"the training kernel uses one symmetric barrier of {float(tp) * 100.0:.1f}bp "
                            "(the take-profit side).",
                            stacklevel=2,
                        )
            else:
                upper = out.get("upperBarrierMultiple")
                lower = out.get("lowerBarrierMultiple")
                measure = out.get("volatilityMeasure", "average_true_range")
                out["threshold_mode"] = "atr"
                if upper is not None:
                    out["atr_multiple"] = float(upper)
                if lower is not None and upper is not None and abs(float(lower) - float(upper)) > 1e-9:
                    warnings.warn(
                        f"triple_barrier: upperBarrierMultiple={upper} and lowerBarrierMultiple={lower} are "
                        f"unequal; the training kernel uses one symmetric barrier of {float(upper)} ATR "
                        "(the upper side).",
                        stacklevel=2,
                    )
                if measure != "average_true_range":
                    warnings.warn(
                        f"triple_barrier: the training kernel scales by average true range, not {measure!r}.",
                        stacklevel=2,
                    )
        for key in _TRIPLE_BARRIER_UI_ONLY:
            out.pop(key, None)
    return out


def label_horizon_bars(strategy: str, params: dict[str, Any] | None) -> int:
    """Bars after the event bar at which the strategy's label is known — the
    purge a walk-forward split needs. Accepts UI or kernel parameter names."""
    from core.shared.labels import label_horizon_bars as _kernel_horizon

    return _kernel_horizon(strategy, translate_label_params(strategy, params))


# ─── Persisted sets ─────────────────────────────────────────────────────────

def _duckdb_with_lake():
    """A DuckDB connection that can read the lake's S3 objects."""
    import duckdb

    con = duckdb.connect()
    con.execute("SET TimeZone='UTC'")
    con.execute("INSTALL httpfs; LOAD httpfs;")
    endpoint = os.environ.get("LAKE_S3_ENDPOINT", "http://127.0.0.1:9100")
    host = endpoint.replace("http://", "").replace("https://", "")
    user, password = os.environ.get("MINIO_USER"), os.environ.get("MINIO_PASSWORD")
    if not user or not password:
        raise RuntimeError("MINIO_USER and MINIO_PASSWORD must be set: the lake credentials never come from code")
    con.execute(
        "CREATE OR REPLACE SECRET lake_s3 (TYPE s3, KEY_ID ?, SECRET ?, ENDPOINT ?, "
        "URL_STYLE 'path', USE_SSL ?, REGION ?)",
        [
            user,
            password,
            host,
            endpoint.startswith("https"),
            os.environ.get("LAKE_REGION", "us-east-1"),
        ],
    )
    return con


@dataclass
class LabelSetRows:
    """A persisted set's rows in the label contract, ascending by timestamp."""

    timestamps_epoch_seconds: np.ndarray
    labels: np.ndarray
    resolution_bars: np.ndarray
    sample_uniqueness_weight: np.ndarray
    return_attribution_weight: np.ndarray
    usable: np.ndarray
    columns: list[str] = field(default_factory=list)

    @property
    def purge_bars(self) -> int:
        """The largest resolution horizon in the set: the purge a trainer must keep."""
        finite = self.resolution_bars[np.isfinite(self.resolution_bars)]
        return int(finite.max()) if finite.size else 0


def read_label_set(parquet_path: str) -> LabelSetRows:
    """Every usable row of a persisted set. Sets landed before the 2026-09-26
    contract carry only ``timestamp`` and ``label``; their missing columns come
    back as NaN weights, ``resolution_bars`` from ``outcome_offset`` when present,
    and ``usable`` = True."""
    con = _duckdb_with_lake()
    try:
        columns = [
            str(row[0]) for row in con.execute(
                "SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet(?))", [parquet_path]
            ).fetchall()
        ]
        select = ["CAST(epoch(timestamp) AS BIGINT) AS t", "CAST(label AS DOUBLE) AS label"]
        if "resolution_bars" in columns:
            select.append("CAST(resolution_bars AS DOUBLE) AS resolution_bars")
        elif "outcome_offset" in columns:
            select.append("CAST(outcome_offset AS DOUBLE) AS resolution_bars")
        else:
            select.append("CAST(NULL AS DOUBLE) AS resolution_bars")
        for name in ("sample_uniqueness_weight", "return_attribution_weight"):
            select.append(f"CAST({name} AS DOUBLE) AS {name}" if name in columns else f"CAST(NULL AS DOUBLE) AS {name}")
        select.append("CAST(usable AS BOOLEAN) AS usable" if "usable" in columns else "TRUE AS usable")
        where = "label IS NOT NULL" + (" AND usable" if "usable" in columns else "")
        rows = con.execute(
            f"SELECT {', '.join(select)} FROM read_parquet(?) WHERE {where} ORDER BY timestamp",
            [parquet_path],
        ).fetchnumpy()
    finally:
        con.close()

    def _float(name: str) -> np.ndarray:
        values = rows[name]
        if hasattr(values, "filled"):
            values = values.filled(np.nan)
        return np.asarray(values, dtype=np.float64)

    return LabelSetRows(
        timestamps_epoch_seconds=np.asarray(rows["t"]).astype(np.int64),
        labels=_float("label"),
        resolution_bars=_float("resolution_bars"),
        sample_uniqueness_weight=_float("sample_uniqueness_weight"),
        return_attribution_weight=_float("return_attribution_weight"),
        usable=np.asarray(rows["usable"]).astype(np.bool_),
        columns=columns,
    )


def load_label_set(
    parquet_path: str,
    bar_timestamps_epoch_seconds: np.ndarray,
    *,
    binary: bool = True,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """Align a persisted label set to a run's bars.

    Returns ``(labels, valid, diagnostics)`` in the same contract the kernels
    use: ``labels.shape == valid.shape == bars.shape`` and rows with
    ``valid[i] == False`` are dropped by the caller.

    ``binary=True`` maps a signed vocabulary onto the classifier's ``{0, 1}``:
    ``> 0`` is 1 (up), ``< 0`` is 0 (down), and exactly 0 (flat / contradicted)
    is invalid, because a direction classifier has no class for "neither".
    ``binary=False`` keeps the set's own integer classes.

    Alignment is exact on the bar timestamp. A label whose timestamp is not one
    of the run's bars is counted, not silently dropped — a large count means the
    set and the run disagree on timeframe or bar series.

    ``diagnostics`` also carries ``purge_bars`` (the set's largest resolution
    horizon) and, aligned to the bars, ``sample_uniqueness_weight`` and
    ``return_attribution_weight`` (NaN where the set has none).
    """
    rows = read_label_set(parquet_path)
    set_ts, set_labels = rows.timestamps_epoch_seconds, rows.labels
    bars = np.asarray(bar_timestamps_epoch_seconds, dtype=np.int64)
    n = bars.shape[0]

    labels = np.full(n, -1, dtype=np.int16)
    valid = np.zeros(n, dtype=np.bool_)
    uniqueness = np.full(n, np.nan, dtype=np.float64)
    attribution = np.full(n, np.nan, dtype=np.float64)

    order = np.argsort(bars, kind="stable")
    sorted_bars = bars[order]
    pos = np.searchsorted(sorted_bars, set_ts)
    in_range = pos < n
    hit = np.zeros(set_ts.shape[0], dtype=np.bool_)
    hit[in_range] = sorted_bars[pos[in_range]] == set_ts[in_range]

    matched_rows = order[pos[hit]]
    matched_labels = set_labels[hit]
    uniqueness[matched_rows] = rows.sample_uniqueness_weight[hit]
    attribution[matched_rows] = rows.return_attribution_weight[hit]
    if binary:
        up = matched_labels > 0
        down = matched_labels < 0
        labels[matched_rows[up]] = 1
        labels[matched_rows[down]] = 0
        valid[matched_rows[up | down]] = True
        flat = int((~(up | down)).sum())
    else:
        labels[matched_rows] = np.rint(matched_labels).astype(np.int16)
        valid[matched_rows] = True
        flat = 0

    diagnostics: dict[str, Any] = {
        "label_set_rows": int(set_ts.shape[0]),
        "matched_bars": int(hit.sum()),
        "unmatched_label_rows": int((~hit).sum()),
        "flat_dropped": flat,
        "bars_without_label": int(n - hit.sum()),
        "purge_bars": rows.purge_bars,
        "sample_uniqueness_weight": uniqueness,
        "return_attribution_weight": attribution,
    }
    return labels, valid, diagnostics
