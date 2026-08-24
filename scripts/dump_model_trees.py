"""Dump tree structure + forest summaries from trained tree-ensemble artifacts.

Consumed by src/server/ml/anatomy.router.ts (the /api/anatomy/* endpoints).
Emits a SINGLE JSON line on stdout per invocation. Errors emit
{"error": "..."} on stdout and exit 2. ASCII-only output (Windows cp1252).

Supported artifacts (first match wins, checked in this order):
  model.ubj              -> xgboost.Booster; trees via
                            get_dump(dump_format='json', with_stats=True)
  model.pkl / model.joblib -> sklearn ensemble (RandomForest* /
                            GradientBoosting*); estimator.tree_ arrays are
                            re-emitted in the SAME XgbTreeNode schema so the
                            client renders both learners identically.

XgbTreeNode schema (raw xgboost JSON dump node):
  { nodeid, depth?, split?, split_condition?, yes?, no?, missing?,
    gain?, cover, leaf?, children? }

sklearn -> XgbTreeNode mapping:
  split           = feature name (feature_names_in_ or f<i> fallback)
  split_condition = threshold  (sklearn routes X <= threshold left; we map
                    yes = left child, no = right child, missing = left)
  cover           = n_node_samples
  gain            = weighted impurity decrease, sklearn feature_importances_
                    formula: (n_t/n_root) * (imp - (n_r/n_t)*imp_r
                                                 - (n_l/n_t)*imp_l)
  leaf            = regression: raw value;
                    binary classification: class margin p1 - p0;
                    multiclass: max class proportion.

Modes (exactly one required):
  --list-meta   -> {"learner", "nTrees", "nFeatures", "features"}
  --trees --start N --count N
                -> {"learner", "nTrees", "features", "start", "count",
                    "trees": [XgbTreeNode, ...]}   (slice clamped to range)
  --summary     -> {"learner", "nTrees", "features", "maxDepth", "avgLeaves",
                    "featureUsage": [{feature, nSplits, totalGain,
                                      totalCover}, ...],   # totalGain desc
                    "depthHistogram": [{depth, count}, ...],  # LEAF depths
                    "leafValues": {min, max, mean,
                                   "histogram": [{x0, x1, count} x 12]}}

Usage:
  python scripts/dump_model_trees.py --model-dir <abs path> --list-meta
  python scripts/dump_model_trees.py --model-dir <abs path> --trees --start 0 --count 4
  python scripts/dump_model_trees.py --model-dir <abs path> --summary
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.setrecursionlimit(20000)  # sklearn trees can nest deeply

XGB_ARTIFACT = "model.ubj"
SKLEARN_ARTIFACTS = ("model.pkl", "model.joblib")
LEAF_HISTOGRAM_BINS = 12


class DumpError(Exception):
    """Raised for any user-facing failure; message goes to stdout JSON."""


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------

def _load_xgboost(artifact: Path) -> tuple[str, list[str], list[str]]:
    """Return (learner, raw_json_dumps, feature_names) for a .ubj booster.

    raw_json_dumps holds one JSON string per tree (lazy-parsed by callers so
    --list-meta never pays the parse cost for large forests).
    """
    import xgboost as xgb  # imported only when a .ubj artifact is present

    try:
        booster = xgb.Booster(model_file=str(artifact))
    except Exception as exc:  # noqa: BLE001 - surface loader failure verbatim
        raise DumpError(f"failed to load xgboost model: {exc}") from exc

    dumps = booster.get_dump(dump_format="json", with_stats=True)
    features = booster.feature_names
    if not features:
        features = [f"f{i}" for i in range(booster.num_features())]
    return "xgboost", dumps, [str(f) for f in features]


def _sklearn_leaf_value(tree, node_id: int, is_classifier: bool) -> float:
    value = tree.value[node_id][0]
    if not is_classifier:
        return float(value[0])
    total = float(sum(value))
    if total <= 0.0:
        return 0.0
    proportions = [float(v) / total for v in value]
    if len(proportions) == 2:
        # Binary class margin: p(class 1) - p(class 0), in [-1, 1].
        return proportions[1] - proportions[0]
    return max(proportions)


def _sklearn_gain(tree, node_id: int, left: int, right: int) -> float:
    """Weighted impurity decrease (sklearn feature_importances_ formula)."""
    w = tree.weighted_n_node_samples
    imp = tree.impurity
    n_root = float(w[0])
    n_t = float(w[node_id])
    if n_root <= 0.0 or n_t <= 0.0:
        return 0.0
    decrease = (
        float(imp[node_id])
        - (float(w[right]) / n_t) * float(imp[right])
        - (float(w[left]) / n_t) * float(imp[left])
    )
    return (n_t / n_root) * decrease


def _sklearn_tree_to_node(estimator, features: list[str], is_classifier: bool) -> dict:
    """Convert one fitted sklearn tree to the XgbTreeNode nested-dict schema."""
    tree = estimator.tree_

    def build(node_id: int, depth: int) -> dict:
        left = int(tree.children_left[node_id])
        right = int(tree.children_right[node_id])
        cover = float(tree.n_node_samples[node_id])
        if left == -1:  # sklearn TREE_LEAF sentinel
            return {
                "nodeid": int(node_id),
                "depth": depth,
                "cover": cover,
                "leaf": _sklearn_leaf_value(tree, node_id, is_classifier),
            }
        feature_idx = int(tree.feature[node_id])
        if feature_idx < 0 or feature_idx >= len(features):
            raise DumpError(
                f"sklearn tree references feature index {feature_idx} outside "
                f"the {len(features)}-feature name table"
            )
        return {
            "nodeid": int(node_id),
            "depth": depth,
            "split": features[feature_idx],
            "split_condition": float(tree.threshold[node_id]),
            "yes": left,
            "no": right,
            "missing": left,
            "gain": _sklearn_gain(tree, node_id, left, right),
            "cover": cover,
            "children": [build(left, depth + 1), build(right, depth + 1)],
        }

    return build(0, 0)


def _load_sklearn(artifact: Path) -> tuple[str, list[dict], list[str]]:
    """Return (learner, parsed_tree_nodes, feature_names) for a pickled ensemble.

    SECURITY: joblib/pickle deserialization executes arbitrary code, so this
    loader must only ever see TRUSTED artifacts. That holds here by design:
    the only caller (anatomy.router.ts) restricts --model-dir to direct
    children of the repo-local data/models/ directory (path-traversal guarded,
    modelId regex validated), and everything in data/models/ is produced by
    this project's own training pipeline on this machine. No user-uploaded or
    network-sourced pickles ever reach this code path.
    """
    try:
        import joblib

        model = joblib.load(artifact)
    except ImportError:
        import pickle

        with open(artifact, "rb") as fh:
            model = pickle.load(fh)
    except Exception as exc:  # noqa: BLE001 - corrupt/incompatible pickle
        raise DumpError(f"failed to load sklearn model: {exc}") from exc

    cls_name = type(model).__name__
    if cls_name.startswith("RandomForest"):
        estimators = list(model.estimators_)
    elif cls_name.startswith("GradientBoosting"):
        # estimators_ is an ndarray of shape (n_stages, n_classes_or_1).
        estimators = [est for row in model.estimators_ for est in row]
    else:
        raise DumpError(
            f"unsupported sklearn model class '{cls_name}' "
            "(expected RandomForest* or GradientBoosting*)"
        )

    if not estimators:
        raise DumpError(f"sklearn model '{cls_name}' has no fitted estimators")

    names = getattr(model, "feature_names_in_", None)
    if names is not None:
        features = [str(n) for n in names]
    else:
        n_features = int(getattr(model, "n_features_in_", 0))
        if n_features <= 0:
            raise DumpError("sklearn model exposes neither feature_names_in_ nor n_features_in_")
        features = [f"f{i}" for i in range(n_features)]

    # GradientBoosting stage trees are always regressors; only RandomForest
    # classifiers carry class-count leaf values.
    is_classifier = cls_name.startswith("RandomForest") and cls_name.endswith("Classifier")
    trees = [_sklearn_tree_to_node(est, features, is_classifier) for est in estimators]
    return "sklearn", trees, features


def load_model(model_dir: Path) -> tuple[str, list, list[str], bool]:
    """Return (learner, trees, features, trees_are_raw_json).

    For xgboost, `trees` holds unparsed JSON strings (parse lazily);
    for sklearn, `trees` holds already-built XgbTreeNode dicts.
    """
    if not model_dir.is_dir():
        raise DumpError(f"model dir not found: {model_dir}")

    xgb_path = model_dir / XGB_ARTIFACT
    if xgb_path.is_file():
        learner, dumps, features = _load_xgboost(xgb_path)
        return learner, dumps, features, True

    for name in SKLEARN_ARTIFACTS:
        candidate = model_dir / name
        if candidate.is_file():
            learner, trees, features = _load_sklearn(candidate)
            return learner, trees, features, False

    raise DumpError(
        f"no supported model artifact in {model_dir} "
        f"(looked for {XGB_ARTIFACT}, {', '.join(SKLEARN_ARTIFACTS)})"
    )


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

def mode_list_meta(learner: str, trees: list, features: list[str]) -> dict:
    return {
        "learner": learner,
        "nTrees": len(trees),
        "nFeatures": len(features),
        "features": features,
    }


def mode_trees(
    learner: str,
    trees: list,
    features: list[str],
    raw_json: bool,
    start: int,
    count: int,
) -> dict:
    n_trees = len(trees)
    end = min(start + count, n_trees)
    window = trees[start:end] if start < n_trees else []
    parsed = [json.loads(t) if raw_json else t for t in window]
    return {
        "learner": learner,
        "nTrees": n_trees,
        "features": features,
        "start": start,
        "count": len(parsed),
        "trees": parsed,
    }


def _walk(node: dict, depth: int, acc: dict) -> None:
    acc["max_depth"] = max(acc["max_depth"], depth)
    children = node.get("children")
    if not children:
        # Leaf. xgboost leaves carry only {nodeid, leaf, cover}.
        acc["leaf_values"].append(float(node.get("leaf", 0.0)))
        acc["leaf_depths"][depth] = acc["leaf_depths"].get(depth, 0) + 1
        acc["n_leaves"] += 1
        return
    feature = str(node.get("split", ""))
    usage = acc["feature_usage"].setdefault(
        feature, {"nSplits": 0, "totalGain": 0.0, "totalCover": 0.0}
    )
    usage["nSplits"] += 1
    usage["totalGain"] += float(node.get("gain", 0.0))
    usage["totalCover"] += float(node.get("cover", 0.0))
    for child in children:
        _walk(child, depth + 1, acc)


def _leaf_histogram(values: list[float], n_bins: int) -> list[dict]:
    if not values:
        return []
    lo = min(values)
    hi = max(values)
    if hi == lo:
        return [{"x0": lo, "x1": hi, "count": len(values)}]
    width = (hi - lo) / n_bins
    counts = [0] * n_bins
    for v in values:
        idx = int((v - lo) / width)
        if idx >= n_bins:  # v == hi lands in the last bin
            idx = n_bins - 1
        counts[idx] += 1
    return [
        {"x0": lo + i * width, "x1": lo + (i + 1) * width, "count": counts[i]}
        for i in range(n_bins)
    ]


def mode_summary(learner: str, trees: list, features: list[str], raw_json: bool) -> dict:
    acc: dict = {
        "max_depth": 0,
        "n_leaves": 0,
        "leaf_values": [],
        "leaf_depths": {},
        "feature_usage": {},
    }
    n_trees = len(trees)
    for tree in trees:
        root = json.loads(tree) if raw_json else tree
        _walk(root, 0, acc)

    feature_usage = [
        {
            "feature": name,
            "nSplits": stats["nSplits"],
            "totalGain": stats["totalGain"],
            "totalCover": stats["totalCover"],
        }
        for name, stats in acc["feature_usage"].items()
    ]
    feature_usage.sort(key=lambda row: row["totalGain"], reverse=True)

    depth_histogram = [
        {"depth": depth, "count": count}
        for depth, count in sorted(acc["leaf_depths"].items())
    ]

    leaf_values: list[float] = acc["leaf_values"]
    if leaf_values:
        leaf_summary = {
            "min": min(leaf_values),
            "max": max(leaf_values),
            "mean": sum(leaf_values) / len(leaf_values),
            "histogram": _leaf_histogram(leaf_values, LEAF_HISTOGRAM_BINS),
        }
    else:
        leaf_summary = {"min": 0.0, "max": 0.0, "mean": 0.0, "histogram": []}

    return {
        "learner": learner,
        "nTrees": n_trees,
        "features": features,
        "maxDepth": acc["max_depth"],
        "avgLeaves": (acc["n_leaves"] / n_trees) if n_trees else 0.0,
        "featureUsage": feature_usage,
        "depthHistogram": depth_histogram,
        "leafValues": leaf_summary,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Dump tree ensemble structure as XgbTreeNode JSON.",
    )
    parser.add_argument(
        "--model-dir",
        required=True,
        help="Absolute path to a data/models/<id> directory",
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--list-meta", action="store_true", help="Emit learner/nTrees/features metadata")
    mode.add_argument("--trees", action="store_true", help="Emit a slice of parsed trees")
    mode.add_argument("--summary", action="store_true", help="Emit whole-forest aggregate statistics")
    parser.add_argument("--start", type=int, default=0, help="First tree index for --trees (default 0)")
    parser.add_argument("--count", type=int, default=4, help="Number of trees for --trees (default 4)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.trees:
        if args.start < 0:
            raise DumpError(f"--start must be >= 0 (got {args.start})")
        if args.count < 1:
            raise DumpError(f"--count must be >= 1 (got {args.count})")

    learner, trees, features, raw_json = load_model(Path(args.model_dir))

    if args.list_meta:
        result = mode_list_meta(learner, trees, features)
    elif args.trees:
        result = mode_trees(learner, trees, features, raw_json, args.start, args.count)
    else:
        result = mode_summary(learner, trees, features, raw_json)

    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except DumpError as exc:
        sys.stdout.write(json.dumps({"error": str(exc)}, ensure_ascii=True) + "\n")
        sys.exit(2)
    except Exception as exc:  # noqa: BLE001 - last-resort guard, still JSON on stdout
        sys.stdout.write(
            json.dumps({"error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=True) + "\n"
        )
        sys.exit(2)
