"""
ML Studio model generator — Jinja2 template renderer + CLI.

Authored 2026-05-10 as part of W1.a of the ML Studio workshop redesign
(`docs/plans/2026-05-09-ml-studio-workshop-redesign.md`).

Renders an architecture template from `src/templates/architectures/*.py.j2`
into a fresh `src/ml/<model_id>/` package containing:

    main.py          — single-file trainer with argparse + walk-forward loop
    labels.py        — label generator delegating to src/ml/shared/labels.py
    eval.py          — evaluation helpers (per-fold metrics + diagnostics)
    manifest.json    — full generation context (catalog id, hp, template version, ...)

Usage (atomic / supervised model) — writes files to disk:

    python scripts/generate_model.py \\
        --catalog-id random-forest \\
        --model-id rf_v1 \\
        --hyperparameters-json '{"n_estimators":500,"max_depth":8}' \\
        --label-strategy triple_barrier \\
        --label-params-json '{"horizon_bars":5,"threshold_bp":5.0}' \\
        --feature-pipeline default-35 \\
        --feature-categories-json '["price_action","volatility","volume"]' \\
        --symbol MNQ --timeframe 1m \\
        --walk-forward-json '{"train_months":12,"test_months":3,"step_months":3}' \\
        --template-dir src/templates/architectures \\
        --output-dir src/ml/rf_v1

Pure preview — emit one JSON object on stdout, write nothing:

    python scripts/generate_model.py ... --dry-run

The TypeScript wrapper (`src/server/lib/codeGenerator.ts`, owned by backend-lead
in W1.d) spawns this script with `--dry-run` for previews. The JSON shape is the
cross-domain contract documented at the top of the W1.a brief:

    {"files": {"main.py": "...", "labels.py": "...", "eval.py": "...",
               "manifest.json": "..."},
     "templateUsed": "<id>",
     "warnings": [...]}

Atomic writes — every file is written via tempfile.NamedTemporaryFile in the
same directory + os.replace, so a half-finished render never lands on disk.

Template selection (W1 stub — full rules land in W2 via backend-lead's
pickTemplate() bridge function): default to `sklearn` for atomic supervised
models. Override with --template-id.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import jinja2

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

TEMPLATE_VERSION = "0.1.0"  # Bumped when any architecture template changes shape.

# Strategies the trainer can compute itself (src/ml/shared/labels.py); every
# other generator id (src/shared/mlTaxonomy.ts LABEL_GENERATORS) trains from a
# landed label set and is accepted as long as it is a plain identifier.
VALID_LABEL_STRATEGIES = {
    "triple_barrier",
    "next_close_direction",
    "range_bucket",
    "structural",
    "none",
    "direction", "signal", "regime", "future_return", "future_volatility", "multi_step",
    "npmm", "volatility_adaptive", "trend_scanning", "meta_label",
    "pseudo_confidence", "consistency_perturbation",
}
_LABEL_STRATEGY_PATTERN = re.compile(r"^[a-z0-9_]+$")

# Family → template-id resolution. Backend-lead's pickTemplate() owns the full
# rule table in W2; this module-level fallback exists so the W1 dry-run gate
# can exercise the renderer end-to-end even before pickTemplate() lands.
DEFAULT_FAMILY_FOR_CATALOG: dict[str, str] = {
    "random-forest": "sklearn",
    "logistic-regression": "sklearn",
    "support-vector-machine-svm": "sklearn",
    "k-nearest-neighbors-knn": "sklearn",
    "gaussian-mixture-model-gmm": "gmm",
    "xgboost": "tree",
    "lightgbm": "tree",
    "catboost": "tree",
    # W3.b — pytorch + transformer family templates
    "perceptron": "pytorch_mlp",
    "multilayer-perceptron-mlp": "pytorch_mlp",
    "multi-layer-perceptron-mlp": "pytorch_mlp",
    "convolutional-neural-network-cnn": "pytorch_cnn",
    "autoencoder": "pytorch_autoencoder",
    "autoencoder-ae": "pytorch_autoencoder",
    "autoencoder-unsupervised": "pytorch_autoencoder",
    "variational-autoencoder": "pytorch_vae",
    "variational-autoencoder-vae": "pytorch_vae",
    "transformer": "transformer_seq",
    "transformer-encoder-decoder": "transformer_seq",
    "transformer_2s": "transformer_seq",
    "transformer_tiny": "transformer_seq",
    # Temporal Fusion Transformer (Lim et al. 2019) — interpretable TFT family.
    "temporal-fusion-transformer": "temporal_fusion_transformer",
    "tft": "temporal_fusion_transformer",
    # W4.a — hmmlearn HMM family (GaussianHMM default, GMMHMM via emission='gmm')
    "gaussian-hmm": "hmm",
    "gmm-hmm": "hmm",
    "hidden-markov-model": "hmm",
    "hidden-markov-model-hmm": "hmm",
    # W9.a — stable-baselines3 RL families. Catalog IDs derived from
    # E:/documents/algo_models/Deep Learning/Reinforcement Learning/* via the
    # slugify() rule in src/server/lib/modelImport/parser.ts.
    # Value-based / Q-learning → DQN template
    "deep-q-network-dqn": "rl_dqn",
    "double-dqn": "rl_dqn",
    "dueling-dqn": "rl_dqn",
    "noisy-dqn": "rl_dqn",
    "rainbow-dqn": "rl_dqn",
    "q-learning": "rl_dqn",
    "sarsa-state-action-reward-state-action": "rl_dqn",
    "hierarchical-dqn-h-dqn": "rl_dqn",
    # Policy-gradient / PPO family → PPO template
    "proximal-policy-optimization-ppo": "rl_ppo",
    "trust-region-policy-optimization-trpo": "rl_ppo",
    "reinforce": "rl_ppo",
    "vanilla-policy-gradient": "rl_ppo",
    # Actor-critic family → A2C template
    "actor-critic": "rl_a2c",
    "advantage-actor-critic-a2c": "rl_a2c",
    "asynchronous-advantage-actor-critic-a3c": "rl_a2c",
    "soft-actor-critic-sac": "rl_a2c",
}

# When the catalog_id maps to family `tree`, this table picks the booster
# variant the template renders against. Backend's pickTemplate() in W2.a may
# pass the variant explicitly via --template-variant; this fallback table
# keeps the standalone CLI usable without that arg.
DEFAULT_TREE_VARIANT_FOR_CATALOG: dict[str, str] = {
    "xgboost": "xgboost",
    "lightgbm": "lightgbm",
    "catboost": "catboost",
}

# When the catalog_id maps to family `sklearn`, this table populates the
# (module_path, class_name) pair the sklearn template needs at render time.
# Backend's parser extension in W2.a will eventually populate these on
# ParsedModelSpec; this fallback covers the W2.b verification gate so the
# generator works standalone before that lands.
DEFAULT_SKLEARN_CLASS_FOR_CATALOG: dict[str, tuple[str, str]] = {
    "random-forest": ("sklearn.ensemble", "RandomForestClassifier"),
    "logistic-regression": ("sklearn.linear_model", "LogisticRegression"),
    "support-vector-machine-svm": ("sklearn.svm", "SVC"),
    "k-nearest-neighbors-knn": ("sklearn.neighbors", "KNeighborsClassifier"),
    "gaussian-mixture-model-gmm": ("sklearn.mixture", "GaussianMixture"),
}

# Label strategy → default task id. The runners.json key is `${algorithm}+${task}`;
# --register uses this to derive the task when --task is not passed explicitly.
LABEL_TO_TASK: dict[str, str] = {
    "triple_barrier": "direction_classifier",
    "next_close_direction": "direction_classifier",
    "structural": "direction_classifier",
    "range_bucket": "range_classifier",
    "none": "custom",
    # Landed-set generators: signed and binary labels train the direction head;
    # a continuous or many-class label has no matching head yet and stays custom.
    "direction": "direction_classifier",
    "signal": "direction_classifier",
    "volatility_adaptive": "direction_classifier",
    "trend_scanning": "direction_classifier",
    "npmm": "direction_classifier",
    "meta_label": "direction_classifier",
    "multi_step": "direction_classifier",
    "pseudo_confidence": "direction_classifier",
    "consistency_perturbation": "direction_classifier",
    "regime": "custom",
    "future_return": "custom",
    "future_volatility": "custom",
}

# Strategies the trainer can compute itself (src/ml/shared/labels.py). Any other
# generator id trains from a landed label set passed as --label-set-parquet.
KERNEL_LABEL_STRATEGIES = ("triple_barrier", "next_close_direction", "range_bucket", "structural")


def _humanize(name: str) -> str:
    """snake_case / kebab-case → Title Case, for generated HP labels + display names."""
    return name.replace("_", " ").replace("-", " ").strip().title()


def _infer_hp_type(value: Any) -> str:
    """Infer a HyperparameterDef `type` from a concrete value (bool before int)."""
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "categorical"
    return "float"


# --------------------------------------------------------------------------- #
# Jinja filter: python_repr — round-trip Python values to source syntax
# --------------------------------------------------------------------------- #


def python_repr(value: Any) -> str:
    """Render a Python value as its source-code literal.

    Handles the exact set of edge cases the W1.a brief calls out:
      True / False / None / floats / strings / lists / dicts / float('inf').

    Why not just `repr()`?  `repr(float('inf'))` is `'inf'` which is NOT a
    valid Python expression — you'd need `float('inf')`.  Same for `nan`.
    Strings get repr-quoted (single quotes, escapes preserved).  Numpy/Pandas
    types are coerced to their Python equivalents.  Tuples are rendered as
    parens-with-trailing-comma for the singleton case so a 1-tuple round-trips.
    """
    # Bool first — bool is subclass of int in Python.
    if value is True:
        return "True"
    if value is False:
        return "False"
    if value is None:
        return "None"

    # Floats: cover NaN / +Inf / -Inf which `repr()` butchers.
    if isinstance(value, float):
        if math.isnan(value):
            return "float('nan')"
        if math.isinf(value):
            return "float('-inf')" if value < 0 else "float('inf')"
        return repr(value)

    if isinstance(value, int):
        return repr(value)

    if isinstance(value, str):
        # Python's repr already quote-escapes — wraps in single quotes when
        # possible, double when single appears, etc. That's exactly what we
        # want for source-faithful round-trip.
        return repr(value)

    if isinstance(value, list):
        return "[" + ", ".join(python_repr(v) for v in value) + "]"

    if isinstance(value, tuple):
        if len(value) == 1:
            return "(" + python_repr(value[0]) + ",)"
        return "(" + ", ".join(python_repr(v) for v in value) + ")"

    if isinstance(value, set):
        if not value:
            return "set()"
        return "{" + ", ".join(python_repr(v) for v in value) + "}"

    if isinstance(value, dict):
        items = [f"{python_repr(k)}: {python_repr(v)}" for k, v in value.items()]
        return "{" + ", ".join(items) + "}"

    # Numpy / pandas escape hatch — coerce to Python scalar then re-dispatch.
    if hasattr(value, "item") and callable(value.item):
        try:
            return python_repr(value.item())
        except Exception:
            pass

    # Fallback: repr() and hope it round-trips. This branch is intentionally
    # last so first-class types above never reach it.
    return repr(value)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="Render an ML Studio model from a Jinja2 architecture template",
    )

    # ----- Mode selector --------------------------------------------------- #
    ap.add_argument(
        "--composite",
        action="store_true",
        help="Composite mode: read --composite-spec-json and recurse "
        "into each expert/member slot, generating the atomic "
        "sub-models depth-first BEFORE rendering the parent "
        "composite. Mutually exclusive with the atomic CLI.",
    )
    ap.add_argument(
        "--composite-spec-json",
        default=None,
        help="(--composite mode) JSON describing the composite tree. "
        "Schema in scripts/generate_model.py docstring section "
        "'Composite spec'.",
    )

    # ----- Atomic-mode flags (also reused by composite recursion) --------- #
    # Identity
    ap.add_argument(
        "--catalog-id",
        default=None,
        help="Slug of the source catalog spec (e.g. 'random-forest'). "
        "Required in atomic mode; ignored in composite mode.",
    )
    ap.add_argument(
        "--model-id",
        default=None,
        help="Slug for the new src/ml/<model_id>/ package. "
        "Required in atomic mode; ignored in composite mode "
        "(model_id comes from --composite-spec-json).",
    )
    ap.add_argument(
        "--template-id",
        default=None,
        help="Override family resolution (e.g. 'sklearn', 'tree'). "
        "Defaults to the family inferred from --catalog-id.",
    )
    ap.add_argument(
        "--template-variant",
        default=None,
        help="Optional variant within a family (e.g. 'xgboost' for tree).",
    )

    # Hyperparameters + WF + labels
    ap.add_argument(
        "--hyperparameters-json",
        default=None,
        help="JSON dict of user-chosen hyperparameter values "
        "(required atomic; in composite mode the per-slot "
        "hyperparameters live inside --composite-spec-json).",
    )
    ap.add_argument(
        "--label-strategy",
        default=None,
        type=str,
        help="Which labeling function the generated model invokes.",
    )
    ap.add_argument(
        "--label-params-json",
        default=None,
        help="JSON dict of label-strategy params (may be empty {}).",
    )
    ap.add_argument(
        "--walk-forward-json",
        default=None,
        help="JSON dict {train_months, test_months, step_months, "
        "purge_bars?, embargo_bars?, expanding?}; omit for single-fold.",
    )

    # Features + data context
    ap.add_argument(
        "--feature-pipeline", default=None, help="Pipeline ID consumed by src.ml.shared.features."
    )
    ap.add_argument(
        "--feature-categories-json", default=None, help="JSON list of feature category names."
    )
    ap.add_argument("--symbol", default=None)
    ap.add_argument("--timeframe", default=None)

    # IO
    ap.add_argument(
        "--template-dir", required=True, help="Directory containing architecture .j2 files."
    )
    ap.add_argument(
        "--output-dir",
        default=None,
        help="Where to write the generated package "
        "(ignored when --dry-run; ignored in composite mode "
        "where output dirs are derived from each model_id).",
    )
    ap.add_argument(
        "--src-ml-root",
        default="src/ml",
        help="Where to write generated packages in composite mode "
        "(default: src/ml). Each sub-model and the composite "
        "land at <src-ml-root>/<model_id>/.",
    )

    # Modes
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the {files, templateUsed, warnings} JSON to stdout. Write nothing.",
    )
    ap.add_argument(
        "--register",
        action="store_true",
        help="Also patch src/config/runners.json with a runner entry "
        "so the generated model becomes trainable from the dashboard.",
    )
    ap.add_argument(
        "--algorithm",
        default=None,
        help="Algorithm id for the runners.json key `${algorithm}+${task}`. "
        "Defaults to a slug of --catalog-id.",
    )
    ap.add_argument(
        "--task",
        default=None,
        help="Task id for the runners.json key. Defaults to the task "
        "implied by --label-strategy (see LABEL_TO_TASK).",
    )
    ap.add_argument(
        "--files-override-json",
        default=None,
        help="JSON {path: content} of user-edited files to write verbatim "
        "instead of re-rendering the templates (Monaco round-trip).",
    )

    args = ap.parse_args(argv)

    # Mode-specific required-arg validation.
    if args.composite:
        if not args.composite_spec_json:
            ap.error("--composite mode requires --composite-spec-json")
    else:
        # Atomic mode required args.
        missing: list[str] = []
        if not args.catalog_id:
            missing.append("--catalog-id")
        if not args.model_id:
            missing.append("--model-id")
        if not args.hyperparameters_json:
            missing.append("--hyperparameters-json")
        if not args.label_strategy:
            missing.append("--label-strategy")
        elif not _LABEL_STRATEGY_PATTERN.match(args.label_strategy):
            raise SystemExit(f"--label-strategy must be a generator id ([a-z0-9_]), got {args.label_strategy!r}")
        if not args.label_params_json:
            missing.append("--label-params-json")
        if not args.feature_pipeline:
            missing.append("--feature-pipeline")
        if not args.feature_categories_json:
            missing.append("--feature-categories-json")
        if not args.symbol:
            missing.append("--symbol")
        if not args.timeframe:
            missing.append("--timeframe")
        if not args.output_dir:
            missing.append("--output-dir")
        if missing:
            ap.error(f"atomic mode requires: {', '.join(missing)}")

    return args


# --------------------------------------------------------------------------- #
# Template resolution + context assembly
# --------------------------------------------------------------------------- #


def _resolve_template_id(catalog_id: str, override: str | None) -> str:
    """Pick the .j2 template for a catalog entry. Backend's pickTemplate() in
    W2 will replace this fallback for HTTP requests — but the generator script
    must remain runnable standalone (it's invoked from CI, dev shells, and the
    backend wrapper)."""
    if override:
        return override
    if catalog_id in DEFAULT_FAMILY_FOR_CATALOG:
        return DEFAULT_FAMILY_FOR_CATALOG[catalog_id]
    return "sklearn"  # Best-effort default — sklearn template renders against
    #                  almost any (module_path, class_name) pair.


def _build_context(args: argparse.Namespace) -> dict:
    """Assemble the dict every Jinja2 template receives.

    Schema mirrors `docs/plans/2026-05-09-ml-studio-workshop-integration-ml.md`
    §2 exactly so backend-lead's TS spawner can populate the same fields from
    the POST body."""
    hyperparameters = json.loads(args.hyperparameters_json)
    label_params = json.loads(args.label_params_json)
    feature_categories = json.loads(args.feature_categories_json)

    if isinstance(label_params, dict) and args.label_strategy:
        # The UI sends the SQL generators' parameter names; the kernels the
        # generated runner imports read different ones. Untranslated, the
        # kernel silently used its own defaults (range_bucket horizon 16 -> 1,
        # structural pivot 5 -> 20) or raised on a missing key.
        repo_root = str(Path(__file__).resolve().parents[1])
        if repo_root not in sys.path:
            sys.path.insert(0, repo_root)
        from src.ml.shared.label_sets import translate_label_params
        label_params = translate_label_params(args.label_strategy, label_params)
    walk_forward = json.loads(args.walk_forward_json) if args.walk_forward_json else None

    if not isinstance(hyperparameters, dict):
        raise ValueError("--hyperparameters-json must decode to a JSON object")
    if not isinstance(label_params, dict):
        raise ValueError("--label-params-json must decode to a JSON object")
    if not isinstance(feature_categories, list):
        raise ValueError("--feature-categories-json must decode to a JSON array")
    if walk_forward is not None and not isinstance(walk_forward, dict):
        raise ValueError("--walk-forward-json must decode to a JSON object")

    template_id = _resolve_template_id(args.catalog_id, args.template_id)
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    # Variant resolution — currently only tree-family booster variants need
    # picking; other families ignore the field. Honor explicit override first.
    template_variant = args.template_variant
    if template_variant is None and template_id == "tree":
        template_variant = DEFAULT_TREE_VARIANT_FOR_CATALOG.get(args.catalog_id, "xgboost")

    # catalog_spec.{module_path,class_name} — backend's W2.a parser will
    # eventually populate these. Until then the standalone CLI seeds them
    # from this fallback table so sklearn/gmm templates render end-to-end.
    catalog_spec: dict = {}
    sklearn_lookup = DEFAULT_SKLEARN_CLASS_FOR_CATALOG.get(args.catalog_id)
    if sklearn_lookup is not None:
        module_path, class_name = sklearn_lookup
        catalog_spec["module_path"] = module_path
        catalog_spec["class_name"] = class_name

    return {
        # Identity
        "model_id": args.model_id,
        "catalog_id": args.catalog_id,
        "catalog_spec": catalog_spec,
        "template_id": template_id,
        "template_variant": template_variant,
        "template_version": TEMPLATE_VERSION,
        "generated_at": generated_at,
        # Hyperparameters (already type-coerced by upstream caller)
        "hyperparameters": hyperparameters,
        # Walk-forward
        "walk_forward": walk_forward,
        # Labels
        "label_strategy": args.label_strategy,
        "label_params": label_params,
        # Features + data
        "feature_pipeline": args.feature_pipeline,
        "feature_categories": feature_categories,
        "symbol": args.symbol,
        "timeframe": args.timeframe,
    }


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #


def _make_env(template_dir: Path) -> jinja2.Environment:
    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(str(template_dir)),
        # keep_trailing_newline ensures `__main__` blocks always end with \n.
        keep_trailing_newline=True,
        # trim_blocks/lstrip_blocks keep generated whitespace clean.
        trim_blocks=True,
        lstrip_blocks=True,
        # Don't auto-escape — we are emitting Python source, not HTML.
        autoescape=False,
        # StrictUndefined surfaces context-key typos at render time instead of
        # silently rendering empty strings into generated code.
        undefined=jinja2.StrictUndefined,
    )
    env.filters["python_repr"] = python_repr
    return env


def _render_files(context: dict, template_dir: Path) -> tuple[dict[str, str], list[str]]:
    """Render every file in the generated package.

    Returns (files_by_name, warnings).  Files dict keys: 'main.py', 'labels.py',
    'eval.py', 'manifest.json'.  W1 stub: labels.py + eval.py are tiny shims
    that delegate to src/ml/shared.  W2/W3 templates expand them per-family.
    """
    env = _make_env(template_dir)
    warnings: list[str] = []

    template_id = context["template_id"]
    family_template_name = f"{template_id}.py.j2"
    family_template_path = template_dir / family_template_name

    if not family_template_path.exists():
        # W1 stub fallback: render only the _base outline so the dry-run gate
        # exercises the generator end-to-end even before family templates land
        # in W2. The warning surfaces in the JSON output.
        warnings.append(
            f"Family template '{family_template_name}' not found in {template_dir}; "
            f"falling back to _base.py.j2 outline only. Provide the family "
            f"template before running --register."
        )
        family_template_name = "_base.py.j2"

    main_py = env.get_template(family_template_name).render(**context)
    labels_py = _render_labels_shim(context)
    eval_py = _render_eval_shim(context)
    manifest_json = json.dumps(_build_manifest(context), indent=2, sort_keys=True)

    return {
        "main.py": main_py,
        "labels.py": labels_py,
        "eval.py": eval_py,
        "manifest.json": manifest_json,
    }, warnings


def _render_labels_shim(context: dict) -> str:
    """Tiny re-export shim. Family templates may override this in W2/W3 by
    moving label specifics into the family template directly."""
    strategy = context["label_strategy"]
    if strategy == "none":
        body = (
            "def make_labels(*args, **kwargs):\n"
            "    raise RuntimeError('label_strategy=none — generated model "
            "should not call make_labels')\n"
        )
    elif strategy not in KERNEL_LABEL_STRATEGIES:
        body = (
            "def make_labels(*args, **kwargs):\n"
            f"    raise RuntimeError('label_strategy={strategy!r} has no in-process kernel; "
            "train this model from a landed label set (--label-set-parquet)')\n"
        )
    else:
        body = f"from src.ml.shared.labels import {strategy}_labels as make_labels  # noqa: F401\n"
    return (
        f'"""Labels shim for generated model {context["model_id"]!r}.\n\n'
        f"Auto-generated {context['generated_at']} from template "
        f"{context['template_id']}@{context['template_version']}.\n"
        f"Edit freely — the canonical implementation lives in src/ml/shared/labels.py.\n"
        f'"""\n\n{body}'
    )


def _render_eval_shim(context: dict) -> str:
    """Eval shim that re-exports from src.ml.shared.eval (W1.c lands the real
    classification/regression evaluators)."""
    return (
        f'"""Eval shim for generated model {context["model_id"]!r}.\n\n'
        f"Auto-generated {context['generated_at']} from template "
        f"{context['template_id']}@{context['template_version']}.\n"
        f"Override per-family eval logic by editing this file or the family\n"
        f"template at src/templates/architectures/{context['template_id']}.py.j2.\n"
        f'"""\n\n'
        f"# Family templates in W2 will inline classification/regression metric\n"
        f"# functions here via {{% include '_eval_classification.py.j2' %}}.\n"
        f"# For now this shim is a placeholder so the generated package is\n"
        f"# importable as src.ml.{context['model_id']}.eval.\n"
    )


def _build_manifest(context: dict) -> dict:
    """Manifest captured alongside generated files — used by
    `scripts/migrate_generated.py` for 3-way merge against future template
    versions.  Schema kept stable: anything captured here is part of the
    'generated_from' provenance contract."""
    return {
        "manifestVersion": 1,
        "generator": "scripts/generate_model.py",
        "generatedAt": context["generated_at"],
        "templateId": context["template_id"],
        "templateVariant": context["template_variant"],
        "templateVersion": context["template_version"],
        "modelId": context["model_id"],
        "catalogId": context["catalog_id"],
        "hyperparameters": context["hyperparameters"],
        "labelStrategy": context["label_strategy"],
        "labelParams": context["label_params"],
        "featurePipeline": context["feature_pipeline"],
        "featureCategories": context["feature_categories"],
        "symbol": context["symbol"],
        "timeframe": context["timeframe"],
        "walkForward": context["walk_forward"],
    }


# --------------------------------------------------------------------------- #
# Atomic write helpers
# --------------------------------------------------------------------------- #


def _atomic_write(path: Path, content: str) -> None:
    """Write `content` to `path` via a temp file in the same directory + os.replace.

    Same-directory temp is required so os.replace stays an atomic rename
    (cross-device renames degrade to copy+unlink, which is non-atomic on NTFS).
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        newline="\n",
        dir=str(path.parent),
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    )
    try:
        tmp.write(content)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp.close()
        os.replace(tmp.name, str(path))
    except Exception:
        # Best-effort cleanup on failure — do not mask the original exception.
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        raise


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


# --------------------------------------------------------------------------- #
# Composite mode — depth-first post-order generation per ml sub-plan §4
# --------------------------------------------------------------------------- #
#
# Composite spec JSON shape:
# {
#   "model_id":    "moe_v1",                              // composite slug
#   "template_id": "composite_moe",                       // which composite template
#   "expert_slots" | "members" | "modalities": [...],     // child slot list
#   <composite-specific keys>                             // gating / combiner / fusion / etc.
# }
#
# Algorithm:
#   1. Parse spec.
#   2. For every child slot in {expert_slots, members}: if child has a real
#      `model_id` already pointing at a generated dir, use it as-is. Else
#      synthesize child_model_id = f"{catalog_id}_for_{parent_id}_slot{N}",
#      generate the atomic sub-model via the existing atomic flow, and write
#      it to disk. Set slot.resolved_model_id = child_model_id.
#   3. Render the composite template with slots[i].resolved_model_id
#      populated -> import paths.
#   4. Write composite main.py LAST (so all sub-modules already exist on disk).
#
# Recursion depth capped at MAX_COMPOSITE_DEPTH (3).  The "modalities" slot
# kind on composite_multimodal does NOT trigger recursion - modality
# encoders are inline blocks, not separately-trained models.
#
# Manifest references children by relative path:
#   "expert_slots": [
#     {"slot_idx": 0, "resolved_model_id": "random-forest_for_moe_v1_slot0",
#      "manifest": "../random-forest_for_moe_v1_slot0/manifest.json"},
#     ...
#   ]


MAX_COMPOSITE_DEPTH = 3

# Composite template ID -> the slot list key it consumes from the spec.
_COMPOSITE_SLOT_KEY: dict[str, str] = {
    "composite_moe": "expert_slots",
    "composite_stacking": "members",
    "composite_voting": "members",
}

# Composite template IDs that DO recurse on children; multimodal does not
# because its modality encoders are inline blocks.
_RECURSIVE_COMPOSITE_TEMPLATES: set[str] = set(_COMPOSITE_SLOT_KEY.keys())


def _slot_child_model_id(parent_model_id: str, catalog_id: str, slot_idx: int) -> str:
    """Slot-private naming convention from ml sub-plan §4.

    Hyphens in catalog_id are converted to underscores so the resulting slot
    dir name (`<catalog_id>_for_<parent>_slot<N>`) is a valid Python package
    identifier - composite templates do `from src.ml.<resolved_id>.main import ...`
    and Python module names cannot contain hyphens.
    """
    safe_catalog = catalog_id.replace("-", "_")
    safe_parent = parent_model_id.replace("-", "_")
    return f"{safe_catalog}_for_{safe_parent}_slot{slot_idx}"


def _render_atomic_for_slot(
    *,
    parent_args,
    catalog_id: str,
    model_id: str,
    hyperparameters: dict,
    template_dir: Path,
    output_root: Path,
    dry_run: bool,
) -> tuple[Path, dict]:
    """Generate one atomic sub-model in composite mode.

    Reuses _build_context + _render_files exactly so the sub-model is
    indistinguishable from one a user would have generated atomically.
    Inherits label_strategy / label_params / feature_pipeline /
    feature_categories / symbol / timeframe / walk_forward from parent_args.
    Returns (slot_dir_path, manifest_dict).
    """
    # Build a synthetic argparse.Namespace mirroring atomic-mode flags.
    slot_ns = argparse.Namespace(
        composite=False,
        composite_spec_json=None,
        catalog_id=catalog_id,
        model_id=model_id,
        template_id=None,
        template_variant=None,
        hyperparameters_json=json.dumps(hyperparameters),
        label_strategy=parent_args.label_strategy,
        label_params_json=parent_args.label_params_json,
        walk_forward_json=parent_args.walk_forward_json,
        feature_pipeline=parent_args.feature_pipeline,
        feature_categories_json=parent_args.feature_categories_json,
        symbol=parent_args.symbol,
        timeframe=parent_args.timeframe,
        template_dir=parent_args.template_dir,
        output_dir=str(output_root / model_id),
        src_ml_root=parent_args.src_ml_root,
        dry_run=dry_run,
        register=False,
    )
    slot_context = _build_context(slot_ns)
    slot_files, slot_warnings = _render_files(slot_context, template_dir)
    slot_manifest = json.loads(slot_files["manifest.json"])

    if not dry_run:
        slot_dir = output_root / model_id
        for fname, fcontent in slot_files.items():
            _atomic_write(slot_dir / fname, fcontent)
        # Drop a __init__.py so `import src.ml.<model_id>.main` works.
        _atomic_write(slot_dir / "__init__.py", "")
    else:
        slot_dir = output_root / model_id  # informational only

    return slot_dir, slot_manifest


def _build_composite_context(spec: dict, parent_args, *, depth: int) -> dict:
    """Assemble the Jinja2 context for a composite template.

    Expects the spec to already have `resolved_model_id` populated on every
    slot (handled by `_generate_composite_recursive` before calling this).
    """
    if depth > MAX_COMPOSITE_DEPTH:
        raise RecursionError(
            f"composite generation exceeded MAX_COMPOSITE_DEPTH={MAX_COMPOSITE_DEPTH}; "
            f"cap is set to prevent runaway recursion in malformed specs."
        )

    template_id = spec["template_id"]
    if template_id not in {
        "composite_moe",
        "composite_stacking",
        "composite_voting",
        "composite_multimodal",
    }:
        raise ValueError(
            f"composite spec.template_id={template_id!r} is not a known "
            "composite template (expected composite_moe/stacking/voting/multimodal)"
        )

    # Inherit common fields from parent_args (atomic flags reused)
    hyperparameters = (
        json.loads(parent_args.hyperparameters_json) if parent_args.hyperparameters_json else {}
    )
    label_params = json.loads(parent_args.label_params_json or "{}")
    feature_categories = json.loads(parent_args.feature_categories_json or "[]")
    walk_forward = (
        json.loads(parent_args.walk_forward_json) if parent_args.walk_forward_json else None
    )
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    context: dict[str, Any] = {
        "model_id": spec["model_id"],
        "catalog_id": spec.get("catalog_id", spec["template_id"]),
        "catalog_spec": {},
        "template_id": template_id,
        "template_variant": None,
        "template_version": TEMPLATE_VERSION,
        "generated_at": generated_at,
        "hyperparameters": hyperparameters,
        "walk_forward": walk_forward,
        "label_strategy": parent_args.label_strategy,
        "label_params": label_params,
        "feature_pipeline": parent_args.feature_pipeline,
        "feature_categories": feature_categories,
        "symbol": parent_args.symbol,
        "timeframe": parent_args.timeframe,
    }

    # Composite-specific keys
    if template_id == "composite_moe":
        context["expert_slots"] = spec["expert_slots"]
        context["gating"] = spec.get("gating", {"type": "top_k", "k": 1, "temperature": 1.0})
    elif template_id in ("composite_stacking", "composite_voting"):
        context["members"] = spec["members"]
        context["combiner"] = spec.get(
            "combiner",
            "logistic_meta" if template_id == "composite_stacking" else "soft",
        )
    elif template_id == "composite_multimodal":
        context["modalities"] = spec["modalities"]
        context["fusion_strategy"] = spec.get("fusion_strategy", "concat")
        for k in ("d_fused", "n_classes", "epochs", "batch_size", "learning_rate"):
            if k in spec:
                context[k] = spec[k]

    return context


def _generate_composite_recursive(
    spec: dict,
    parent_args,
    *,
    template_dir: Path,
    output_root: Path,
    dry_run: bool,
    depth: int = 0,
) -> dict:
    """Walk the composite tree depth-first; generate atomic sub-models first.

    Returns a JSON-serializable result dict shaped:
        {
          "modelId": <composite slug>,
          "templateId": <composite template>,
          "writtenTo": <abs path>,
          "warnings": [...],
          "subModels": [
            {"slotIdx": 0, "resolvedModelId": ..., "writtenTo": ..., "manifest": {...}},
            ...
          ]
        }
    """
    if depth > MAX_COMPOSITE_DEPTH:
        raise RecursionError(
            f"composite generation exceeded MAX_COMPOSITE_DEPTH={MAX_COMPOSITE_DEPTH}"
        )

    template_id = spec["template_id"]
    parent_model_id = spec["model_id"]

    sub_results: list[dict] = []
    warnings: list[str] = []

    # Recurse on slots that own atomic sub-models.
    if template_id in _RECURSIVE_COMPOSITE_TEMPLATES:
        slot_key = _COMPOSITE_SLOT_KEY[template_id]
        slot_list = spec.get(slot_key, [])
        if not slot_list:
            raise ValueError(
                f"composite spec for {template_id} requires non-empty '{slot_key}' list"
            )
        for slot in slot_list:
            slot_idx = int(slot["slot_idx"])
            slot_catalog_id = slot["catalog_id"]
            slot_hp = slot.get("hyperparameters", {})

            # Existing-slot bypass: caller already pointed at a generated dir.
            existing_id = slot.get("model_id")
            if existing_id:
                existing_main = output_root / existing_id / "main.py"
                if existing_main.exists():
                    slot["resolved_model_id"] = existing_id
                    sub_results.append(
                        {
                            "slotIdx": slot_idx,
                            "resolvedModelId": existing_id,
                            "writtenTo": str(existing_main.parent),
                            "reused": True,
                        }
                    )
                    continue

            # Detect if this catalog_id is itself a composite (nested case).
            is_nested_composite = isinstance(slot.get("template_id"), str) and slot[
                "template_id"
            ].startswith("composite_")
            if is_nested_composite:
                # Synthesize a child composite spec; recurse one level deeper.
                child_model_id = _slot_child_model_id(
                    parent_model_id,
                    slot_catalog_id,
                    slot_idx,
                )
                child_spec = dict(slot)
                child_spec["model_id"] = child_model_id
                child_result = _generate_composite_recursive(
                    child_spec,
                    parent_args,
                    template_dir=template_dir,
                    output_root=output_root,
                    dry_run=dry_run,
                    depth=depth + 1,
                )
                slot["resolved_model_id"] = child_model_id
                sub_results.append(
                    {
                        "slotIdx": slot_idx,
                        "resolvedModelId": child_model_id,
                        "writtenTo": child_result.get("writtenTo"),
                        "nested": True,
                        "subModels": child_result.get("subModels", []),
                    }
                )
                continue

            # Atomic leaf: synthesize child id + render via existing atomic flow.
            child_model_id = _slot_child_model_id(
                parent_model_id,
                slot_catalog_id,
                slot_idx,
            )
            slot_dir, slot_manifest = _render_atomic_for_slot(
                parent_args=parent_args,
                catalog_id=slot_catalog_id,
                model_id=child_model_id,
                hyperparameters=slot_hp,
                template_dir=template_dir,
                output_root=output_root,
                dry_run=dry_run,
            )
            slot["resolved_model_id"] = child_model_id
            sub_results.append(
                {
                    "slotIdx": slot_idx,
                    "resolvedModelId": child_model_id,
                    "writtenTo": str(slot_dir),
                    "manifest": slot_manifest,
                }
            )

    # Now every slot has resolved_model_id. Render the composite parent itself.
    composite_context = _build_composite_context(spec, parent_args, depth=depth)
    env = _make_env(template_dir)
    family_template_name = f"{template_id}.py.j2"
    if not (template_dir / family_template_name).exists():
        raise FileNotFoundError(
            f"composite template {family_template_name} not found in {template_dir}"
        )
    main_py = env.get_template(family_template_name).render(**composite_context)
    labels_py = _render_labels_shim(composite_context)
    eval_py = _render_eval_shim(composite_context)

    # Composite manifest references child manifests by relative path
    composite_manifest = _build_manifest(composite_context)
    composite_manifest["compositeKind"] = template_id.replace("composite_", "")
    if template_id in _RECURSIVE_COMPOSITE_TEMPLATES:
        composite_manifest["subModelRefs"] = [
            {
                "slotIdx": r["slotIdx"],
                "resolvedModelId": r["resolvedModelId"],
                "manifest": f"../{r['resolvedModelId']}/manifest.json",
            }
            for r in sub_results
        ]
    elif template_id == "composite_multimodal":
        composite_manifest["modalities"] = composite_context["modalities"]
        composite_manifest["fusionStrategy"] = composite_context["fusion_strategy"]

    composite_files = {
        "main.py": main_py,
        "labels.py": labels_py,
        "eval.py": eval_py,
        "manifest.json": json.dumps(composite_manifest, indent=2, sort_keys=True),
    }

    composite_dir = output_root / parent_model_id
    if not dry_run:
        for fname, fcontent in composite_files.items():
            _atomic_write(composite_dir / fname, fcontent)
        _atomic_write(composite_dir / "__init__.py", "")

    return {
        "modelId": parent_model_id,
        "templateId": template_id,
        "writtenTo": str(composite_dir),
        "warnings": warnings,
        "subModels": sub_results,
        "files": composite_files if dry_run else list(composite_files.keys()),
    }


# --------------------------------------------------------------------------- #
# runners.json registration — makes a generated model trainable from the
# dashboard. The runner key is `${algorithm}+${task}`; the orchestrator also
# accepts `legacyId` (= model_id) so /api/training/start resolves either way.
# --------------------------------------------------------------------------- #


def _runner_key(args: argparse.Namespace, context: dict) -> tuple[str, str, str]:
    """Return (runner_key, algorithm, task)."""
    algorithm = args.algorithm or str(context["catalog_id"]).replace("-", "_")
    task = args.task or LABEL_TO_TASK.get(context["label_strategy"], "custom")
    return f"{algorithm}+{task}", algorithm, task


def _build_runner_entry(args: argparse.Namespace, context: dict, output_dir: Path) -> dict:
    """Construct a runners.json entry for a freshly-generated model.

    `defaultHyperparameters` carries minimal HyperparameterDefs (type + default +
    label) derived from the chosen values so ArchitectureComposer can re-render
    the form after save; `cliFlags` mirrors the generated main.py argparse
    convention exactly (`--<hp-name-with-dashes>`, _base.py.j2:116).
    """
    repo_root = Path.cwd().resolve()
    try:
        script_rel = str((output_dir / "main.py").resolve().relative_to(repo_root)).replace(
            "\\", "/"
        )
    except ValueError:
        script_rel = f"src/ml/{context['model_id']}/main.py"

    default_hps: dict = {}
    cli_flags: dict = {}
    for name, value in context["hyperparameters"].items():
        default_hps[name] = {
            "type": _infer_hp_type(value),
            "default": value,
            "label": _humanize(name),
            "group": "Generated",
        }
        cli_flags[name] = "--" + str(name).replace("_", "-")

    return {
        "legacyId": context["model_id"],
        "displayName": f"{_humanize(context['catalog_id'])} ({context['template_id']})",
        "runner": "python",
        "script": script_rel,
        "outputDir": "data/models",
        "outputs": ["checkpoint.json", "diagnostics.json", "oos_predictions.parquet"],
        "featurePipeline": context.get("feature_pipeline") or "default-35",
        "estimatedTrainingTime": "generated",
        "tags": ["generated", context["template_id"]],
        "featureCategories": context.get("feature_categories") or [],
        "generated": True,
        "generatedAt": context["generated_at"],
        "catalogId": context["catalog_id"],
        "templateId": context["template_id"],
        "defaultHyperparameters": default_hps,
        "cliFlags": cli_flags,
    }


def _register_runner(
    args: argparse.Namespace, context: dict, output_dir: Path
) -> tuple[str, list[str]]:
    """Patch src/config/runners.json with an entry for the generated model.

    Idempotent (re-registering the same key overwrites + warns). Atomic
    (read → mutate → atomic_write). Returns (runner_key, warnings).
    """
    warnings: list[str] = []
    runners_path = (Path.cwd() / "src" / "config" / "runners.json").resolve()
    if not runners_path.exists():
        warnings.append(f"runners.json not found at {runners_path}; skipped registration.")
        return "", warnings

    try:
        registry = json.loads(runners_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        warnings.append(f"could not read runners.json ({exc}); skipped registration.")
        return "", warnings

    runners = registry.setdefault("runners", {})
    key, algorithm, task = _runner_key(args, context)
    if key in runners:
        existing = runners[key]
        if not (isinstance(existing, dict) and existing.get("generated")):
            # Never clobber a hand-curated runner — namespace this generated
            # entry by model_id so it coexists with the curated one.
            key = f"{algorithm}+{task}+{context['model_id']}"
            warnings.append(
                f"'{algorithm}+{task}' is a curated runner; registered the generated "
                f"model under {key!r} to avoid overwriting it."
            )
        else:
            warnings.append(
                f"runner key {key!r} already existed — overwritten with the regenerated entry."
            )
    runners[key] = _build_runner_entry(args, context, output_dir)

    _atomic_write(runners_path, json.dumps(registry, indent=2) + "\n")
    return key, warnings


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    template_dir = Path(args.template_dir).resolve()
    if not template_dir.is_dir():
        raise SystemExit(f"--template-dir not found: {template_dir}")

    # ----- Composite mode --------------------------------------------------- #
    if args.composite:
        spec = json.loads(args.composite_spec_json)
        if not isinstance(spec, dict):
            raise SystemExit("--composite-spec-json must decode to a JSON object")
        if "model_id" not in spec or "template_id" not in spec:
            raise SystemExit("--composite-spec-json must include 'model_id' and 'template_id'")

        # Resolve output root (composite mode: derive per-slot dirs from <root>/<model_id>)
        if args.output_dir:
            # Caller may have passed output_dir explicitly; treat it as the root
            # for THIS composite (the parent directory holding both the parent
            # and slot subdirs).
            output_root = Path(args.output_dir).resolve().parent
        else:
            output_root = (Path.cwd() / args.src_ml_root).resolve()

        try:
            result = _generate_composite_recursive(
                spec,
                args,
                template_dir=template_dir,
                output_root=output_root,
                dry_run=args.dry_run,
            )
        except RecursionError as exc:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": "RecursionError",
                        "message": str(exc),
                    }
                )
            )
            return 2

        result["ok"] = True
        result["compositeRoot"] = str(output_root)
        print(json.dumps(result))
        return 0

    # ----- Atomic mode (original W1 flow) --------------------------------- #
    context = _build_context(args)
    files, warnings = _render_files(context, template_dir)

    # Honor user-edited files (Monaco round-trip): write them verbatim instead
    # of the freshly-rendered templates.
    if args.files_override_json:
        try:
            override = json.loads(args.files_override_json)
            if isinstance(override, dict) and override:
                files = {str(k): str(v) for k, v in override.items()}
            else:
                warnings.append(
                    "--files-override-json was empty or not an object; using rendered files."
                )
        except json.JSONDecodeError as exc:
            warnings.append(
                f"--files-override-json was not valid JSON ({exc}); using rendered files."
            )

    if args.dry_run:
        print(
            json.dumps(
                {
                    "files": files,
                    "templateUsed": context["template_id"],
                    "warnings": warnings,
                }
            )
        )
        return 0

    output_dir = Path(args.output_dir).resolve()
    saved_paths: list[str] = []
    for name, content in files.items():
        dest = output_dir / name
        _atomic_write(dest, content)
        saved_paths.append(str(dest))
    # Package marker so `import src.ml.<model_id>.main` resolves for the orchestrator.
    init_path = output_dir / "__init__.py"
    _atomic_write(init_path, "")
    saved_paths.append(str(init_path))

    runner_key = ""
    if args.register:
        runner_key, reg_warnings = _register_runner(args, context, output_dir)
        warnings.extend(reg_warnings)

    print(
        json.dumps(
            {
                "savedPaths": saved_paths,
                "runnerKey": runner_key,
                "templateUsed": context["template_id"],
                "warnings": warnings,
                "writtenTo": str(output_dir),
                "files": list(files.keys()),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
