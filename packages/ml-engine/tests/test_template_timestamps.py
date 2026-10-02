"""Regression test for the row-index-as-timestamp template bug.

Every architecture template that writes `oos_predictions.parquet` (or, for
hmm, the regime-tag overlay + evaluator ts_test) must thread the model's own
epoch-second bar timestamps through single-fold AND walk-forward training,
never fall back to `np.arange(N)` as the *primary* path. The templates keep
a defensive `np.arange(...)` fallback for the case where the accumulated
timestamp array is missing or size-mismatched (never expected in practice),
so this test asserts the literal-assignment shape (`ts=np.arange(` /
`timestamp=np.arange(`) is gone from the OOS writer call sites, and that the
timestamp-threading plumbing (`ts_test` parameter, `_FOLD_STATE["ts"]`
accumulation) is present in every affected family's rendered source.

Each template is rendered via `scripts/generate_model.py --dry-run` (the same
renderer the dashboard's codegen endpoint spawns) so this test exercises the
real CLI contract, not a hand-rolled Jinja2 call. The rendered `main.py` for
every family must also `compile()` cleanly.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
GENERATOR = REPO_ROOT / "scripts" / "generate_model.py"
TEMPLATE_DIR = REPO_ROOT / "src" / "templates" / "architectures"

# Forbidden literal shapes: the OOS/overlay writer assigning a bare
# `np.arange(...)` directly as the ts/timestamp value instead of the real
# per-fold accumulated array. This is the exact bug pattern
# (`_walk_forward.py.j2:36` before the fix, and each family's OOS writer).
_FORBIDDEN_PATTERNS = ("ts=np.arange(", "timestamp=np.arange(")

# Plumbing that must be present in every family that writes OOS predictions
# with real timestamps — proves ts_test is threaded end-to-end rather than
# just having the forbidden pattern removed.
_REQUIRED_MARKERS = ("ts_test", '_FOLD_STATE["ts"]')

# (catalog_id, template_id_override, template_variant, walk_forward) for every
# atomic family listed in the task + discovered via the np.arange/_FOLD_STATE
# grep sweep. None walk_forward exercises _single_fold.py.j2; a dict exercises
# _walk_forward.py.j2.
_WALK_FORWARD = {"train_months": 6, "test_months": 2, "step_months": 2}

ATOMIC_CASES: list[tuple[str, str, str | None, dict | None]] = [
    ("random-forest", "sklearn", None, None),
    ("random-forest", "sklearn", None, _WALK_FORWARD),
    ("xgboost", "tree", "xgboost", None),
    ("xgboost", "tree", "xgboost", _WALK_FORWARD),
    ("multilayer-perceptron-mlp", "pytorch_mlp", None, None),
    ("multilayer-perceptron-mlp", "pytorch_mlp", None, _WALK_FORWARD),
    ("convolutional-neural-network-cnn", "pytorch_cnn", None, None),
    ("convolutional-neural-network-cnn", "pytorch_cnn", None, _WALK_FORWARD),
    ("transformer", "transformer_seq", None, None),
    ("transformer", "transformer_seq", None, _WALK_FORWARD),
    ("temporal-fusion-transformer", "temporal_fusion_transformer", None, None),
    ("temporal-fusion-transformer", "temporal_fusion_transformer", None, _WALK_FORWARD),
    ("gaussian-hmm", "hmm", None, None),
    ("gaussian-hmm", "hmm", None, _WALK_FORWARD),
]

# Families whose OOS artifact carries no row-level classification labels
# (unsupervised score/reconstruction-error outputs) but still write
# oos_predictions.parquet keyed by ts and must be checked the same way.
UNSUPERVISED_CASES: list[tuple[str, str, str | None, dict | None]] = [
    ("autoencoder", "pytorch_autoencoder", None, None),
    ("variational-autoencoder", "pytorch_vae", None, None),
]

COMPOSITE_CASES: list[dict] = [
    {
        "model_id": "lens_ts_check_moe",
        "template_id": "composite_moe",
        "gating": {"type": "top_k", "k": 1, "temperature": 1.0},
        "expert_slots": [
            {"slot_idx": 0, "catalog_id": "random-forest", "hyperparameters": {"n_estimators": 10}},
            {"slot_idx": 1, "catalog_id": "logistic-regression", "hyperparameters": {}},
        ],
    },
    {
        "model_id": "lens_ts_check_voting",
        "template_id": "composite_voting",
        "members": [
            {"slot_idx": 0, "catalog_id": "random-forest", "hyperparameters": {"n_estimators": 10}},
            {"slot_idx": 1, "catalog_id": "logistic-regression", "hyperparameters": {}},
        ],
    },
    {
        "model_id": "lens_ts_check_stacking",
        "template_id": "composite_stacking",
        "members": [
            {"slot_idx": 0, "catalog_id": "random-forest", "hyperparameters": {"n_estimators": 10}},
            {"slot_idx": 1, "catalog_id": "logistic-regression", "hyperparameters": {}},
        ],
    },
    {
        "model_id": "lens_ts_check_multimodal",
        "template_id": "composite_multimodal",
        "modalities": [
            {"name": "price", "feature_slice": [0, 8], "encoder": "mlp", "d_out": 32},
            {"name": "volume", "feature_slice": [8, 16], "encoder": "mlp", "d_out": 32},
        ],
        "fusion_strategy": "concat",
    },
]


def _run_atomic_dry_run(
    catalog_id: str,
    template_id: str,
    template_variant: str | None,
    walk_forward: dict | None,
) -> dict:
    args = [
        sys.executable,
        str(GENERATOR),
        "--catalog-id", catalog_id,
        "--model-id", f"lens_ts_check_{template_id}",
        "--template-id", template_id,
        "--hyperparameters-json", "{}",
        "--label-strategy", "triple_barrier",
        "--label-params-json", json.dumps({"horizon_bars": 5, "threshold_bp": 5.0}),
        "--feature-pipeline", "default-35",
        "--feature-categories-json", json.dumps(["price_action", "volatility"]),
        "--symbol", "MNQ",
        "--timeframe", "1d",
        "--template-dir", str(TEMPLATE_DIR),
        "--output-dir", str(REPO_ROOT / "src" / "ml" / f"lens_ts_check_{template_id}"),
        "--dry-run",
    ]
    if template_variant:
        args += ["--template-variant", template_variant]
    if walk_forward is not None:
        args += ["--walk-forward-json", json.dumps(walk_forward)]

    result = subprocess.run(
        args, cwd=REPO_ROOT, capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, (
        f"generate_model.py --dry-run failed for catalog_id={catalog_id} "
        f"template_id={template_id}:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
    )
    return json.loads(result.stdout)


def _run_composite_dry_run(spec: dict) -> dict:
    args = [
        sys.executable,
        str(GENERATOR),
        "--composite",
        "--composite-spec-json", json.dumps(spec),
        "--hyperparameters-json", "{}",
        "--label-strategy", "triple_barrier",
        "--label-params-json", json.dumps({"horizon_bars": 5, "threshold_bp": 5.0}),
        "--feature-pipeline", "default-35",
        "--feature-categories-json", json.dumps(["price_action", "volatility"]),
        "--symbol", "MNQ",
        "--timeframe", "1d",
        "--template-dir", str(TEMPLATE_DIR),
        "--dry-run",
    ]
    result = subprocess.run(
        args, cwd=REPO_ROOT, capture_output=True, text=True, timeout=90,
    )
    assert result.returncode == 0, (
        f"generate_model.py --composite --dry-run failed for "
        f"template_id={spec['template_id']}:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
    )
    return json.loads(result.stdout)


def _assert_main_py_clean(main_py: str, *, label: str, check_plumbing: bool) -> None:
    compile(main_py, filename=f"<{label}>", mode="exec")
    for pattern in _FORBIDDEN_PATTERNS:
        assert pattern not in main_py, (
            f"{label}: found forbidden row-index-as-timestamp pattern {pattern!r} "
            f"in the rendered OOS writer."
        )
    if check_plumbing:
        for marker in _REQUIRED_MARKERS:
            assert marker in main_py, (
                f"{label}: expected timestamp-threading marker {marker!r} missing "
                f"from rendered main.py — ts_test is not plumbed through this family."
            )


@pytest.mark.parametrize(
    "catalog_id,template_id,template_variant,walk_forward",
    ATOMIC_CASES,
    ids=[
        f"{tid}{'_wf' if wf else '_single'}" for _, tid, _, wf in ATOMIC_CASES
    ],
)
def test_atomic_family_threads_real_timestamps(catalog_id, template_id, template_variant, walk_forward):
    result = _run_atomic_dry_run(catalog_id, template_id, template_variant, walk_forward)
    main_py = result["files"]["main.py"]
    _assert_main_py_clean(
        main_py,
        label=f"{template_id}({'wf' if walk_forward else 'single-fold'})",
        check_plumbing=True,
    )


@pytest.mark.parametrize(
    "catalog_id,template_id,template_variant,walk_forward",
    UNSUPERVISED_CASES,
    ids=[tid for _, tid, _, _ in UNSUPERVISED_CASES],
)
def test_unsupervised_family_threads_real_timestamps(catalog_id, template_id, template_variant, walk_forward):
    result = _run_atomic_dry_run(catalog_id, template_id, template_variant, walk_forward)
    main_py = result["files"]["main.py"]
    _assert_main_py_clean(main_py, label=template_id, check_plumbing=True)


@pytest.mark.parametrize("spec", COMPOSITE_CASES, ids=[s["template_id"] for s in COMPOSITE_CASES])
def test_composite_family_threads_real_timestamps(spec):
    result = _run_composite_dry_run(spec)
    composite_main_py = result["files"]["main.py"]
    # composite_multimodal has no expert/member sub-slots (modalities are
    # inline blocks, not separately-trained models) and does not itself
    # accumulate a per-slot ts — it still must not regress to np.arange.
    check_plumbing = spec["template_id"] != "composite_multimodal"
    _assert_main_py_clean(composite_main_py, label=spec["template_id"], check_plumbing=check_plumbing)

    # Sub-slot atomic models are generated depth-first via the exact same
    # _build_context/_render_files path exercised directly by
    # test_atomic_family_threads_real_timestamps — the composite generator's
    # sub-model result only carries a manifest, not the rendered source, so
    # sub-slot cleanliness is covered there rather than re-rendered here.
    if spec["template_id"] != "composite_multimodal":
        assert result.get("subModels"), f"{spec['template_id']}: expected non-empty subModels"


def test_single_fold_partial_threads_ts_test():
    """_single_fold.py.j2 itself must call train_one_fold with ts_test=."""
    text = (TEMPLATE_DIR / "_single_fold.py.j2").read_text(encoding="utf-8")
    assert "ts_test = ts_kept[test_idx]" in text
    assert "ts_test=ts_test" in text


def test_walk_forward_partial_threads_ts_test():
    """_walk_forward.py.j2 itself must call train_one_fold with ts_test=."""
    text = (TEMPLATE_DIR / "_walk_forward.py.j2").read_text(encoding="utf-8")
    assert "ts_test = ts_kept[fold.test_idx]" in text
    assert "ts_test=ts_test" in text
