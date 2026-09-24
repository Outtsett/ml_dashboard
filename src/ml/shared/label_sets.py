"""
Persisted label sets, and the one parameter contract every label path shares.

Two things broke the label lifecycle at the training boundary, and this module
is where both are settled.

**The parameter contract.** The dashboard previews a strategy through the SQL
generators, whose parameters are named the way the taxonomy declares them
(``horizon``, ``pivotLookback``, ``nBuckets``...). The Python kernels in
``labels.py`` that a model actually trains on read different names
(``horizon_bars``, ``lookback_bars``, ``n_buckets``...). The generated runner
passed the UI dict straight through, so the kernel fell back to its own
defaults — ``range_bucket`` previewed at a 16-bar horizon trained at 1, and
``structural`` previewed with a 5-bar pivot trained with 20 — while
``triple_barrier`` raised on a missing key. Measured on identical bars, the two
implementations agree 100% once the names are translated; the disagreement was
never in the maths. :func:`translate_label_params` is that translation, applied
at render time and again defensively at load time, so it cannot be skipped.

**Persisted sets.** ``generateLabels`` now writes a set's rows to the lake as
parquet (see ``labelSetStore.ts``). :func:`load_label_set` reads one back and
aligns it to a training run's bar timestamps, so a run can train on exactly the
rows a person previewed and saved rather than recomputing something similar.
"""
from __future__ import annotations

import os
import warnings
from typing import Any

import numpy as np

# ─── Parameter contract ─────────────────────────────────────────────────────

# UI / SQL-generator name  ->  labels.py kernel name, per strategy.
_PARAM_ALIASES: dict[str, dict[str, str]] = {
    "next_close_direction": {"horizon": "horizon_bars", "thresholdPts": "threshold_pts"},
    "range_bucket": {
        "horizon": "horizon_bars",
        "nBuckets": "n_buckets",
        "bucketWidthPts": "bucket_width_pts",
    },
    "structural": {"pivotLookback": "lookback_bars"},
    "triple_barrier": {"maxHoldingPeriod": "horizon_bars"},
}


def translate_label_params(strategy: str, params: dict[str, Any] | None) -> dict[str, Any]:
    """Return the kernel-named parameter dict for ``strategy``.

    Kernel-named keys pass through untouched, so a dict that is already in the
    Python vocabulary is a no-op. Unknown keys are kept: the kernels ignore
    what they do not read, and dropping them would hide a caller's mistake.
    """
    p = dict(params or {})
    out: dict[str, Any] = {}
    aliases = _PARAM_ALIASES.get(strategy, {})
    for key, value in p.items():
        out[aliases.get(key, key)] = value

    if strategy == "triple_barrier" and "threshold_bp" not in out:
        # The SQL generator takes an asymmetric take-profit / stop-loss in
        # percent; the kernel takes one symmetric barrier in basis points. The
        # barrier is the take-profit distance; an unequal stop is reported,
        # not silently averaged, because a model trained on a symmetric
        # barrier is a different model from the one previewed.
        tp = out.pop("takeProfitPct", None)
        sl = out.pop("stopLossPct", None)
        if tp is not None:
            out["threshold_bp"] = float(tp) * 100.0
            if sl is not None and abs(float(sl) - float(tp)) > 1e-9:
                warnings.warn(
                    f"triple_barrier: takeProfitPct={tp} and stopLossPct={sl} are unequal; "
                    f"the training kernel uses one symmetric barrier of {float(tp) * 100.0:.1f}bp "
                    "(the take-profit side).",
                    stacklevel=2,
                )
    return out


# ─── Persisted sets ─────────────────────────────────────────────────────────

def _duckdb_with_lake():
    """A DuckDB connection that can read the lake's S3 objects."""
    import duckdb

    con = duckdb.connect()
    con.execute("SET TimeZone='UTC'")
    con.execute("INSTALL httpfs; LOAD httpfs;")
    endpoint = os.environ.get("LAKE_S3_ENDPOINT", "http://127.0.0.1:9100")
    host = endpoint.replace("http://", "").replace("https://", "")
    con.execute(
        "CREATE OR REPLACE SECRET lake_s3 (TYPE s3, KEY_ID ?, SECRET ?, ENDPOINT ?, "
        "URL_STYLE 'path', USE_SSL ?, REGION ?)",
        [
            os.environ.get("MINIO_USER", "lakeadmin"),
            os.environ.get("MINIO_PASSWORD", "lakeadmin-dev"),
            host,
            endpoint.startswith("https"),
            os.environ.get("LAKE_REGION", "us-east-1"),
        ],
    )
    return con


def read_label_set(parquet_path: str) -> tuple[np.ndarray, np.ndarray]:
    """``(timestamps_epoch_seconds int64, labels float64)`` of a persisted set, ascending."""
    con = _duckdb_with_lake()
    try:
        rows = con.execute(
            "SELECT CAST(epoch(timestamp) AS BIGINT) AS t, CAST(label AS DOUBLE) AS label "
            "FROM read_parquet(?) WHERE label IS NOT NULL ORDER BY timestamp",
            [parquet_path],
        ).fetchnumpy()
    finally:
        con.close()
    return rows["t"].astype(np.int64), rows["label"].astype(np.float64)


def load_label_set(
    parquet_path: str,
    bar_timestamps_epoch_seconds: np.ndarray,
    *,
    binary: bool = True,
) -> tuple[np.ndarray, np.ndarray, dict[str, int]]:
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
    """
    set_ts, set_labels = read_label_set(parquet_path)
    bars = np.asarray(bar_timestamps_epoch_seconds, dtype=np.int64)
    n = bars.shape[0]

    labels = np.full(n, -1, dtype=np.int16)
    valid = np.zeros(n, dtype=np.bool_)

    order = np.argsort(bars, kind="stable")
    sorted_bars = bars[order]
    pos = np.searchsorted(sorted_bars, set_ts)
    in_range = pos < n
    hit = np.zeros(set_ts.shape[0], dtype=np.bool_)
    hit[in_range] = sorted_bars[pos[in_range]] == set_ts[in_range]

    matched_rows = order[pos[hit]]
    matched_labels = set_labels[hit]
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

    diagnostics = {
        "label_set_rows": int(set_ts.shape[0]),
        "matched_bars": int(hit.sum()),
        "unmatched_label_rows": int((~hit).sum()),
        "flat_dropped": flat,
        "bars_without_label": int(n - hit.sum()),
    }
    return labels, valid, diagnostics
