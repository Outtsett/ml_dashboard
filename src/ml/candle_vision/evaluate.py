"""Scores for the pattern recognizer: per class, per split and source (real bars / synthetic).

Each class is a yes/no question ("did TA-Lib fire <pattern> <direction> on this bar?"), so every
class gets its own counts at the threshold chosen on the validation split (the one maximising F1
there), plus threshold-free AUROC and average precision.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

THRESHOLD_GRID = np.round(np.arange(0.05, 0.96, 0.01), 2)


def best_thresholds(scores: np.ndarray, labels: np.ndarray) -> np.ndarray:
    """Per class, the grid threshold with the highest F1 on these rows (0.5 when the class is absent)."""
    out = np.full(scores.shape[1], 0.5)
    for k in range(scores.shape[1]):
        y = labels[:, k].astype(bool)
        if not y.any():
            continue
        s = scores[:, k]
        predicted = s[:, None] >= THRESHOLD_GRID[None]
        tp = (predicted & y[:, None]).sum(0)
        fp = (predicted & ~y[:, None]).sum(0)
        fn = y.sum() - tp
        f1 = 2 * tp / np.maximum(2 * tp + fp + fn, 1)
        out[k] = THRESHOLD_GRID[int(np.argmax(f1))]
    return out


def macro_average_precision(scores: np.ndarray, labels: np.ndarray) -> float:
    values = [average_precision_score(labels[:, k], scores[:, k]) for k in range(labels.shape[1]) if labels[:, k].any()]
    return float(np.mean(values)) if values else float("nan")


def class_table(scores: np.ndarray, labels: np.ndarray, thresholds: np.ndarray, names: list[str],
                split: str, source: str) -> pd.DataFrame:
    rows = []
    predicted = scores >= thresholds[None]
    for k, name in enumerate(names):
        y = labels[:, k].astype(bool); p = predicted[:, k]
        tp = int((y & p).sum()); fp = int((~y & p).sum()); fn = int((y & ~p).sum()); tn = int((~y & ~p).sum())
        both = 0 < y.sum() < len(y)
        precision = tp / (tp + fp) if tp + fp else float("nan")
        recall = tp / (tp + fn) if tp + fn else float("nan")
        rows.append({
            "class_name": name, "pattern": name.split(":")[0], "direction": name.split(":")[1],
            "split": split, "source": source, "windows": len(y), "positives": int(y.sum()),
            "true_positives": tp, "false_positives": fp, "false_negatives": fn, "true_negatives": tn,
            "threshold": float(thresholds[k]), "precision": precision, "recall": recall,
            "f1": 2 * precision * recall / (precision + recall) if tp else (0.0 if y.any() else float("nan")),
            "area_under_roc_curve": float(roc_auc_score(y, scores[:, k])) if both else float("nan"),
            "average_precision": float(average_precision_score(y, scores[:, k])) if y.any() else float("nan"),
        })
    return pd.DataFrame(rows)


def pattern_confusion(scores: np.ndarray, labels: np.ndarray, thresholds: np.ndarray, classes: list[tuple]) -> pd.DataFrame:
    """Pattern-level (direction merged) co-occurrence: for bars where TA-Lib fired pattern A, the
    share on which the model called pattern B. The diagonal is recall; off-diagonal mass is confusion
    — or genuine co-firing, which the ``talib_share_percent`` column (TA-Lib calling B on those bars) shows."""
    patterns = sorted({c[0].split(":")[0] for c in classes})
    index = {p: i for i, p in enumerate(patterns)}
    truth = np.zeros((len(labels), len(patterns)), bool)
    called = np.zeros_like(truth)
    predicted = scores >= thresholds[None]
    for k, c in enumerate(classes):
        j = index[c[0].split(":")[0]]
        truth[:, j] |= labels[:, k].astype(bool)
        called[:, j] |= predicted[:, k]
    rows = []
    for a in range(len(patterns)):
        on = truth[:, a]
        if not on.any():
            continue
        model_share = called[on].mean(0) * 100
        talib_share = truth[on].mean(0) * 100
        for b in range(len(patterns)):
            if model_share[b] > 0 or a == b:
                rows.append({"true_pattern": patterns[a], "called_pattern": patterns[b], "bars_with_true_pattern": int(on.sum()),
                             "model_share_percent": float(model_share[b]), "talib_share_percent": float(talib_share[b])})
    return pd.DataFrame(rows)
