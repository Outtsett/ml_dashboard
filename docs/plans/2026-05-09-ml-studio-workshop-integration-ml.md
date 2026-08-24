# ML Studio Workshop — ML-Side Integration Plan

**Date:** 2026-05-09
**Project:** `E:\source\repos\ml_dashboard`
**Scope:** Phases W1, W3, W4, W5, W9 + cross-cutting (W2 ML templates, W6 bootstrap)
**Companion plan:** `docs/plans/2026-05-09-ml-studio-workshop-redesign.md`
**Authored by:** ml-lead

---

## 1. ML deliverables matrix

| Phase | File (absolute) | Purpose | Reuses / extends |
|---|---|---|---|
| W1 | `scripts/generate_model.py` | Jinja2 renderer + CLI; emits `main.py`/`labels.py`/`eval.py`/`manifest.json` per generated model | Adds `jinja2>=3.1` to `pyproject.toml` |
| W1 | `src/templates/architectures/_base.py.j2` | Common header: imports, argparse with std flags, `_PROJECT_ROOT` insert, `emit_log` boot | Reuses `protocol.emit*`, mirrors `xgb_classifier/main.py` lines 28-53 |
| W1 | `src/templates/architectures/_walk_forward.py.j2` | WF iteration block: yields `(fold_idx, train_idx, test_idx, embargo)` | Calls into NEW `src/ml/shared/walk_forward.py` |
| W1 | `src/templates/architectures/_eval_classification.py.j2` | Per-fold metrics + `oos_predictions.parquet` writer + `diagnostics.json` skeleton | Lifts metric functions from `src/ml/xgb_classifier/eval.py` |
| W1 | `src/templates/architectures/_eval_regression.py.j2` | Per-fold MSE/MAE/R²/directional accuracy + PnL sim using sign(prediction) | NEW; PnL sim borrowed from `xgb_classifier/eval.py::simulate_pnl` |
| W1 | `src/ml/shared/labels.py` | Move `make_labels`, `time_split_indices`; add adapters for next_close_direction / range_bucket / structural | **Lift** from `src/ml/xgb_classifier/labels.py`; adapters wrap `src/ml/shared/labeling/*.py` |
| W2 | `src/templates/architectures/sklearn.py.j2` | Generic sklearn estimator template | Imports `{{ catalog_spec.module_path }}` + `{{ catalog_spec.class_name }}` |
| W2 | `src/templates/architectures/tree.py.j2` | XGBoost/LightGBM/CatBoost (early-stopping + SHAP) | Direct extraction from `src/ml/xgb_classifier/main.py` |
| W2 | `src/templates/architectures/gmm.py.j2` | `sklearn.mixture.GaussianMixture` + `_eval_clustering` | NEW |
| W3 | `src/templates/architectures/pytorch_mlp.py.j2` | Configurable depth/width MLP, BCE loss, AdamW, early-stop | Imports `src/ml/blocks/{head,encoder}.py` |
| W3 | `src/templates/architectures/pytorch_cnn.py.j2` | 1D CNN over rolling OHLCV windows | Imports `src/ml/blocks/encoder.py::Conv1DEncoder` |
| W3 | `src/templates/architectures/pytorch_autoencoder.py.j2` | Symmetric encoder+decoder, MSE reconstruction | Imports `src/ml/blocks/{encoder,decoder}.py` |
| W3 | `src/templates/architectures/pytorch_vae.py.j2` | Variational version: mu/logvar heads + reparameterization + KLD | Imports `src/ml/blocks/{encoder,decoder}.py::VariationalHead` |
| W3 | `src/templates/architectures/transformer_seq.py.j2` | Generic encoder-only over price+volume windows; mean-pool → head | Mirrors `E:\source\repos\trading_model\src\ml\cnn_transformer\model.py` |
| W3 | `src/ml/blocks/__init__.py` | Public API exports | NEW domain-driven flat module |
| W3 | `src/ml/blocks/encoder.py` | `MLPEncoder`, `Conv1DEncoder`, `TransformerEncoder` (price+vol two-stream) | Lifts from trading_model |
| W3 | `src/ml/blocks/decoder.py` | `MLPDecoder`, `Conv1DDecoder` | NEW |
| W3 | `src/ml/blocks/attention.py` | `MultiHeadSelfAttention`, `CrossAttention`, sinusoidal `PositionalEncoding`, `ALiBi` | NEW |
| W3 | `src/ml/blocks/head.py` | `ClassificationHead(K)`, `RegressionHead(d)`, `RangeBucketHead(K)`, `BinaryDirectionHead`, `VariationalHead(latent_dim)` | NEW |
| W3 | `src/ml/blocks/gating.py` | `TopKGating`, `SoftmaxGating`, `HashGating` for MoE composer | NEW (W5 dep) |
| W3 | `src/ml/blocks/fusion.py` | `ConcatFusion`, `CrossAttentionFusion`, `GatedFusion` for multimodal | NEW (W5 dep) |
| W4 | `src/templates/architectures/hmm.py.j2` | `hmmlearn.hmm.GaussianHMM` / `GMMHMM`; transition matrix + viterbi | Adds `hmmlearn>=0.3` to pyproject |
| W4 | `src/templates/architectures/_eval_clustering.py.j2` | Silhouette, Davies-Bouldin, regime tag emission | Reuses `protocol.emit_overlay()` |
| W5 | `src/templates/architectures/composite_moe.py.j2` | Assembles N expert sub-models + gating + soft/topk routing | Imports generated sub-model classes + `src/ml/blocks/gating.py` |
| W5 | `src/templates/architectures/composite_stacking.py.j2` | Trains N base models, generates OOS preds, fits logistic meta | Sub-model train + sklearn LogisticRegression |
| W5 | `src/templates/architectures/composite_voting.py.j2` | Hard / soft / weighted voting over N base sub-models | Sub-model train + simple averaging |
| W5 | `src/templates/architectures/composite_multimodal.py.j2` | Per-modality encoder pickers + fusion strategy | `src/ml/blocks/fusion.py` + per-modality encoders |
| W6 | `src/ml/shared/bootstrap.py` | Block bootstrap CI95 over trade-PnL series; block size = √n; default 10k resamples | NEW |
| W9 | `src/templates/architectures/rl_dqn.py.j2` | DQN with experience replay + target network | Adds `gymnasium>=1.0`, `stable-baselines3>=2.4` |
| W9 | `src/templates/architectures/rl_ppo.py.j2` | PPO via stable-baselines3 wrapping the trading env | Same deps |
| W9 | `src/templates/architectures/rl_a2c.py.j2` | A2C via stable-baselines3 | Same deps |
| W9 | `src/ml/blocks/trading_env.py` | `gymnasium.Env` wrapping MNQ OHLCV; action ∈ {flat, long, short}, reward = realized PnL after costs | Reuses `src/ml/shared/data.py` + cost model |
| Cross | `src/ml/shared/walk_forward.py` | NEW. `iter_folds(timestamps, train_months, test_months, step_months, purge_bars)` | Used by every generated `main.py` |
| Cross | `scripts/migrate_generated.py` | Re-render generated models against current template versions; 3-way merge user edits | Uses `merge3` package or `git merge-file` shell-out |

---

## 2. Template-context contract

Every Jinja2 template receives this **base context dict**, populated by `scripts/generate_model.py` from the `POST /api/training/generate-code` payload:

```python
{
    # Identity
    "model_id":          str,    # slug for src/ml/<model_id>/
    "catalog_id":        str,    # original catalog spec slug
    "catalog_spec":      dict,   # ParsedModelSpec serialized + EXTENSIONS (see below)
    "template_id":       str,    # which .j2 was selected
    "template_version":  str,    # semver of template
    "generated_at":      str,    # ISO UTC

    # Hyperparameters (already type-coerced)
    "hyperparameters":   dict,

    # Walk-forward (None for single-fold)
    "walk_forward":      dict | None,

    # Labels
    "label_strategy":    str,    # triple_barrier | next_close_direction | range_bucket | structural | none
    "label_params":      dict,

    # Features
    "feature_pipeline":   str,
    "feature_categories": list[str],

    # Data context
    "symbol":            str,
    "timeframe":         str,
}
```

### Per-template additions

| Template family | Extra required keys | Source |
|---|---|---|
| `sklearn`, `tree`, `gmm` | `catalog_spec.class_name: str`, `catalog_spec.module_path: str` | **MISSING TODAY** — parser extension required |
| `pytorch_*` | `task_kind: "classification" \| "regression"`, `n_classes: int`, `window_size: int` | Frontend composer collects |
| `transformer_seq` | `d_model`, `n_layers`, `n_heads`, `d_ff`, `window_size`, `task_kind`, `n_classes` | Composer; defaults from registry |
| `hmm` | `n_states`, `covariance_type`, `emission: "gaussian" \| "gmm"` | Composer |
| `composite_moe` | `n_experts`, `expert_slots: list[{slot_idx, model_id, catalog_id}]`, `gating_type`, `gating_temperature` | Composer; recursive sub-model gen first |
| `composite_stacking` | `members: list[{slot_idx, model_id, catalog_id}]`, `combiner` | Composer + recursive |
| `composite_multimodal` | `modalities`, `fusion_strategy` | Composer |
| `rl_*` | `env_kwargs`, `total_timesteps`, `learning_rate` | Composer |

### Parser extension (REQUIRED for W2)

`ParsedModelSpec` (in `src/server/lib/modelImport/types.ts`) must gain `module_path`, `class_name`, `classOrigin: 'fenced-block' | 'class-map' | 'manual'`.

**Two-source extraction strategy:**
1. **Code-fence harvester** (`parser.ts::extractClassImport`): scan `## Implementation Details` for `python` blocks; regex `from\s+([\w.]+)\s+import\s+(\w+)`. Hits ~60% of specs.
2. **Class map fallback** (`src/server/lib/modelImport/classMap.ts`, NEW): hand-curated `Record<catalogId, {module_path, class_name}>` covering ~150 supervised/clustering/HMM specs.
3. **CI assertion**: for every `ParsedModelSpec` with `template_id ∈ {sklearn, tree, gmm, hmm}`, assert `class_name` is non-empty after extraction.

**Owner of parser change:** backend-lead.

### Pytorch templates: no `class_name` needed

For `pytorch_*`, `transformer_seq`, `composite_*`, `rl_*`, the template owns the `nn.Module` definition inline (using building blocks from `src/ml/blocks/`). The bridge's `pickTemplate(spec)` selects the template, and the template renders a self-contained model class.

### Custom Jinja filter

Generator must register a `python_repr` filter that round-trips Python values to source syntax (handles `True/False`, `None`, floats, strings, lists, dicts, `float('inf')` sentinel).

---

## 3. `xgb_classifier` → `tree.py.j2` extraction

The existing `src/ml/xgb_classifier/main.py` is **the canonical wired model**. The `tree.py.j2` template should match its structure ~90% verbatim.

### Template-static (verbatim copy)

| Section | Lines in `main.py` | Why static |
|---|---|---|
| File header docstring | 1-26 | Auto-rewritten with `{{ model_id }}` + `{{ generated_at }}` in `_base.py.j2` |
| `_PROJECT_ROOT` insert | 40-42 | Same path math for every generated model |
| Shared imports | 44-49 | All generated models import from `src.ml.shared.*` |
| `_load_features_with_cache` | 86-112 | Identical for every supervised model; lift to `src/ml/shared/features.py::load_features_with_cache` |
| `_emit_metric_declarations` | 115-172 | Goes to `_eval_classification.py.j2` (shared by sklearn + tree + pytorch classification) |
| `_StreamCallback` + `_make_xgb_callback` | 178-205 | **Tree-only**; lives in `tree.py.j2` only |
| `_shap_summary` | 211-226 | Tree-only; gated on `{% if has_shap %}` |
| Args→config translator | 232-256 | Pattern lifts to `_base.py.j2` macro |
| Triple-barrier label generation | 313-327 | Static IF `label_strategy == 'triple_barrier'`; otherwise replaced |
| Filter to valid + drop NaN | 329-339 | Identical |
| `time_split_indices` call | 341-345 | Replaced by `_walk_forward.py.j2` block when WF is set |
| `xgb.train` body | 376-388 | Tree-only; inlined |
| OOS predict + metrics | 393-409 | Mostly static; `simulate_pnl` shared |
| Diagnostics dict assembly | 446-494 | Built by `_eval_classification.py.j2` macro |
| Save artifacts | 428-444, 499-508 | Static |
| `main()` + try/except + `emit_done` | 513-525 | In `_base.py.j2` |

### Becomes `{{ jinja_var }}`

| Source line(s) | Becomes |
|---|---|
| arg names + types lines 67-83 | `{% for hp in hyperparameters %}ap.add_argument("--{{ hp.cli_name }}", type={{ hp.type }}, default={{ hp.default \| python_repr }}){% endfor %}` |
| `make_labels(...)` line 315 | `{{ label_strategy }}_labels(...)` with kwargs from `{{ label_params \| python_repr }}` |
| `params: dict` lines 355-368 | Variant-keyed `params` dict (xgboost → `tree_method=hist`, lightgbm → `boosting_type=gbdt`, catboost → `loss_function=Logloss`) |
| Importer line | `{% if template_variant == "xgboost" %}import xgboost as xgb{% elif template_variant == "lightgbm" %}import lightgbm as lgb{% elif template_variant == "catboost" %}import catboost as cb{% endif %}` |
| `train_one_fold` body | Wrapped in `{% block model_train %}...{% endblock %}` |

**Total target LOC for `tree.py.j2`:** ~280 lines vs. 526 LOC in source `main.py`, because shared blocks factor out 240 LOC.

---

## 4. Composite dependency order

### The problem
User picks an MoE composite where one expert is a non-WIRED sklearn entry. The composite template needs to import from `src.ml.<sub_id>.main` but that file doesn't exist.

### Generation order: depth-first, post-order
`scripts/generate_model.py --composite` walks the composition tree depth-first and generates leaves before internal nodes:

```
generate_composite(composite_spec):
    1. for each slot in composite_spec.expert_slots:
        if slot.model_id in registry (WIRED) and file exists:
            continue  # use as-is
        elif slot.catalog_id has a non-composite template:
            child_model_id = f"{slot.catalog_id}_for_{composite_spec.model_id}_slot{slot.slot_idx}"
            generate_atomic(catalog_id=slot.catalog_id, model_id=child_model_id, hp=slot.hyperparameters)
            slot.resolved_model_id = child_model_id
        elif slot.catalog_id is itself a composite:
            generate_composite(...)  # recursive
        else:
            raise UnsupportedExpert(slot.catalog_id)
    2. render composite template with slots[i].resolved_model_id → import paths
    3. write composite main.py LAST
```

### Composite template imports

```python
{% for slot in expert_slots %}
from src.ml.{{ slot.resolved_model_id }}.main import (
    train_one_fold as train_slot_{{ slot.slot_idx }},
    predict as predict_slot_{{ slot.slot_idx }},
)
{% endfor %}
```

**Required convention:** every generated atomic `main.py` exports both `train_one_fold(args)` and `predict(model, X) -> np.ndarray`.

### Storage: slot-private (chosen)
Each composite owns its own copies named `{catalog_id}_for_{composite_id}_slot{N}`. Hyperparameter independence per slot. Directory bloat mitigated by `src/ml/generated/` + `.gitignore`.

### Cycle prevention
Static composite catalog declares which composites can host which sub-types. Recursion depth capped at 3.

---

## 5. Walk-forward integration

**Recommendation: lift WF logic into `src/ml/shared/walk_forward.py`, have `_walk_forward.py.j2` produce a thin loop body that delegates.**

### `src/ml/shared/walk_forward.py` API

```python
def iter_folds(
    timestamps: np.ndarray,
    train_months: int,
    test_months: int,
    step_months: int,
    purge_bars: int = 0,
    embargo_bars: int = 0,
    *,
    expanding: bool = False,
) -> Iterator[Fold]:
    """Yield (fold_idx, train_start, train_end, test_start, test_end, train_idx, test_idx)."""
```

`Fold` is a frozen dataclass. Calendar-aware month boundaries via `numpy.datetime64[M]`.

### Template body
```jinja
{% if walk_forward %}
from src.ml.shared.walk_forward import iter_folds

fold_results = []
for fold in iter_folds(
    timestamps=ts_kept,
    train_months={{ walk_forward.train_months }},
    test_months={{ walk_forward.test_months }},
    step_months={{ walk_forward.step_months }},
    purge_bars={{ walk_forward.purge_bars | default(0) }},
):
    emit_log(f"[wf] Fold {fold.idx}: train {fold.train_start}→{fold.train_end} | test {fold.test_start}→{fold.test_end}")
    X_train, y_train = X[fold.train_idx], y[fold.train_idx]
    X_test,  y_test  = X[fold.test_idx],  y[fold.test_idx]
    model, preds = train_one_fold(X_train, y_train, X_test, y_test, args, fold_idx=fold.idx)
    fold_metrics = compute_fold_metrics(y_test, preds, fold_idx=fold.idx)
    for name, value in fold_metrics.items():
        emit_metric(name=f"fold_{fold.idx}_{name}", value=value, iteration=fold.idx)
    fold_results.append({"fold": fold.idx, "metrics": fold_metrics, "predictions": preds, "test_idx": fold.test_idx})
{% else %}
{% include "_single_fold.py.j2" %}
{% endif %}
```

**Add** `emit_fold_complete(fold_idx, metrics)` helper to `protocol.py` that emits both per-metric calls + a structured `{type: 'fold_complete', fold_idx, metrics}` event the ExperimentLedger consumes.

---

## 6. Specialist dispatch plan

| Phase | Specialist | Scope |
|---|---|---|
| W1 | **ml-data** | Lift `src/ml/xgb_classifier/labels.py` → `src/ml/shared/labels.py` adding adapters; unit tests against MNQ 1m parquet |
| W1 | **ml-eval** | Author `_eval_classification.py.j2` + `_eval_regression.py.j2` macros lifting metric functions from `xgb_classifier/eval.py` |
| W1 | **ml-trainer** | Author `_base.py.j2` + `_walk_forward.py.j2` + `scripts/generate_model.py` CLI; verify Jinja2 rendering pipeline |
| W1 | **ml-data** | Create `src/ml/shared/walk_forward.py` with `iter_folds` + dataclass + 6 unit tests |
| W2 | **ml-trainer** | Read `xgb_classifier/main.py` thoroughly, extract `tree.py.j2` per §3; render against XGBoost/LightGBM/CatBoost specs; train each on MNQ 1m |
| W2 | **ml-features** | Hoist `_load_features_with_cache` from `xgb_classifier/main.py` to `src/ml/shared/features.py::load_features_with_cache`; verify zero behavior change |
| W2 | **ml-trainer** | Author `sklearn.py.j2` + `gmm.py.j2`; render against Random Forest, Logistic Regression, SVM, KNN, GaussianMixture; smoke-train each |
| W3 | **ml-architect** | Build `src/ml/blocks/{encoder,decoder,attention,head,gating,fusion}.py` lifting from trading_model; unit tests for shape correctness + gradient flow |
| W3 | **ml-trainer** | Author `pytorch_mlp.py.j2`, `pytorch_cnn.py.j2`, `pytorch_autoencoder.py.j2`, `pytorch_vae.py.j2`, `transformer_seq.py.j2`; render + smoke-train each |
| W4 | **ml-architect** | Author `hmm.py.j2` (hmmlearn dep); add to `pyproject.toml`; smoke-fit on MNQ 1m returns |
| W4 | **ml-eval** | Author `_eval_clustering.py.j2` (silhouette + Davies-Bouldin + regime-tag emission via `protocol.emit_overlay`) |
| W5 | **ml-architect** | Build composite recursion + the four `composite_*.py.j2` templates; design slot-resolution logic per §4 |
| W6 | **ml-eval** | Build `src/ml/shared/bootstrap.py` (block bootstrap CI95, default 10k resamples); unit tests vs scipy reference |
| W9 | **ml-architect** | Build `src/ml/blocks/trading_env.py` (gymnasium.Env wrapper); RL templates; add `gymnasium>=1.0,stable-baselines3>=2.4` |
| Cross | **ml-trainer** | Build `scripts/migrate_generated.py` (3-way merge against per-file manifest); CI check renders every catalog spec against current templates |

Each dispatch prompt must include: "Create todos to track progress, mark complete as you finish, update CLAUDE.md after each completed todo, do not stop until all todos are complete."

---

## 7. ML-side risks not in plan §12

| Risk | Severity | Mitigation |
|---|---|---|
| `hmmlearn` and `stable-baselines3` are heavy + bring scipy/pytorch version constraints that can collide with `ml` env's `torch 2.11.0+cu130` | High | Pin to versions known compatible; test installation in `ml` env BEFORE shipping templates that import them |
| Numba JIT in `src/ml/shared/labels.py` requires per-architecture cold compile | Medium | `@njit(cache=True)` already caches; add one-shot warmup call at module import in `_base.py.j2` |
| Walk-forward fold count can blow up training wall-clock past UI patience | Medium | UI computes `predicted_n_folds` at form-edit time; warn at >20 folds; orchestrator hard-caps at 50 folds |
| Sub-model name collisions between two composites generating slot copies | Low | `_for_<parent>_slot<n>` naming convention is intentional; document in Monaco preview |
| Generated model imports brittleness if user renames `predict` | Medium | Standardize on `predict(model, X) -> np.ndarray` signature in `_base.py.j2`; composite uses `inspect` to verify |
| Triple_barrier labels' Numba inner loop is single-threaded | Low | Compute labels ONCE in composite template before slot loop; pass `(labels, valid)` to each sub-model |
| RL trading env reward shaping drives policy collapse if reward = raw PnL | High | Default reward = `realized_pnl - lambda * |position|`; expose lambda in template hyperparameters |
| Bootstrap CI on autocorrelated returns with √n block is rule-of-thumb only | Medium | Default to √n but expose `block_size_method = 'sqrt_n' \| 'politis_romano'`; gate evaluator pinpoints which method was used |
| Manifest 3-way merge edge case: user re-orders imports → spurious conflicts | Medium | `migrate_generated.py` normalizes whitespace + sorts imports via `isort` before diffing |
| `emit_metric` flood at ~1 event per (fold × metric × epoch) for deep-learning | Low | Existing protocol handles this fine via `os.write` atomic-append |

---

## 8. Smoke verification per phase

All commands run from `E:\source\repos\ml_dashboard\` in the `ml` conda env. Real data: `E:\source\repos\ml_dashboard\data\parquet\MNQ\1m.parquet`.

### W1 — generator infrastructure
```bash
python -c "import jinja2; print(jinja2.__version__)"  # >=3.1
python -c "from src.ml.shared.labels import make_labels, time_split_indices; print('ok')"
python scripts/generate_model.py \
    --catalog-id random-forest --model-id rf_smoke \
    --hyperparameters-json '{"n_estimators":100,"max_depth":8}' \
    --label-strategy triple_barrier --label-params-json '{"horizon_bars":5,"threshold_bp":5.0}' \
    --feature-pipeline default-35 --feature-categories-json '["price_action","volatility","volume"]' \
    --symbol MNQ --timeframe 1m --template-dir src/templates/architectures \
    --output-dir /tmp/rf_smoke --dry-run > /tmp/rf_smoke_main.py
python -m py_compile /tmp/rf_smoke_main.py && echo OK
pytest tests/test_walk_forward.py -v
```

### W2 — sklearn + tree + gmm
```bash
python scripts/generate_model.py --catalog-id random-forest --model-id rf_v1 \
    --hyperparameters-json '{"n_estimators":200,"max_depth":8}' \
    --label-strategy triple_barrier --label-params-json '{"horizon_bars":5,"threshold_bp":5.0}' \
    --feature-pipeline default-35 --feature-categories-json '["price_action","volatility","volume"]' \
    --walk-forward-json '{"train_months":12,"test_months":3,"step_months":3}' \
    --symbol MNQ --timeframe 1m --template-dir src/templates/architectures --output-dir src/ml/rf_v1
python -m py_compile src/ml/rf_v1/main.py
python src/ml/rf_v1/main.py --symbol MNQ --timeframe 1m --model-id rf_v1_smoke --json --max-bars 50000

# Verify oos_predictions schema parity
python -c "
import polars as pl
a = pl.read_parquet('data/models/rf_v1_smoke/oos_predictions.parquet')
b = pl.read_parquet('data/models/MNQ_1m_xgb_classifier_<latest>/oos_predictions.parquet')
assert set(a.columns) == set(b.columns)
print('schema parity ok')
"
# Same for LightGBM, GMM
```

### W3 — deep learning + blocks library
```bash
pytest tests/test_ml_blocks.py -v  # shape correctness + gradient flow
for catalog_id in autoencoder convolutional-neural-network-cnn transformer; do
  python scripts/generate_model.py --catalog-id $catalog_id --model-id ${catalog_id}_smoke \
    --hyperparameters-json '{"d_model":64,"n_layers":2,"window_size":64}' \
    --label-strategy next_close_direction --label-params-json '{}' \
    --feature-pipeline default-35 --feature-categories-json '["price_action"]' \
    --symbol MNQ --timeframe 1m --template-dir src/templates/architectures \
    --output-dir src/ml/${catalog_id}_smoke
  python -m py_compile src/ml/${catalog_id}_smoke/main.py
done
grep -c "from src.ml.blocks" src/ml/transformer_smoke/main.py  # >= 1
```

### W4 — HMM + clustering eval
```bash
python -c "import hmmlearn; print(hmmlearn.__version__)"
python scripts/generate_model.py --catalog-id gaussian-hmm --model-id ghmm_v1 ...
python -c "
import json
d = json.load(open('data/models/ghmm_v1/diagnostics.json'))
assert 'silhouette' in d['metrics'] and 'davies_bouldin' in d['metrics']
assert 'transition_matrix' in d
"
```

### W5 — composites
```bash
python scripts/generate_model.py --composite \
    --composite-spec-json '{
      "model_id":"moe_v1","template_id":"composite_moe",
      "expert_slots":[
        {"slot_idx":0,"catalog_id":"random-forest","hyperparameters":{"n_estimators":200}},
        {"slot_idx":1,"catalog_id":"lightgbm","hyperparameters":{"n_estimators":300}}
      ],
      "gating":{"type":"top_k","k":1,"temperature":1.0}
    }' ...
ls src/ml/random-forest_for_moe_v1_slot0/main.py
ls src/ml/lightgbm_for_moe_v1_slot1/main.py
ls src/ml/moe_v1/main.py
```

### W6 — bootstrap
```bash
pytest tests/test_bootstrap.py -v
```

### W9 — RL templates
```bash
python -c "import gymnasium, stable_baselines3; print(gymnasium.__version__, stable_baselines3.__version__)"
python scripts/generate_model.py --catalog-id dqn --model-id dqn_smoke \
    --hyperparameters-json '{"total_timesteps":1000,"learning_rate":1e-4,"buffer_size":1000}' ...
```

### Cross-cutting — migration
```bash
python scripts/migrate_generated.py --model-id rf_v1 --preserve-edits
diff src/ml/rf_v1/main.py.bak.<ts> src/ml/rf_v1/main.py | head -50
```

---

## Open dependencies for the parent plan

1. **Backend (W2)** must extend `ParsedModelSpec` + parser to populate `class_name`/`module_path` per §2 before sklearn/tree/gmm/hmm templates can render reliably.
2. **Backend (W2)** must add `pickTemplate(spec)` returning the family + variant tuple consumed by the generator.
3. **Frontend (W4)** composer must populate the §2 per-template extra keys and pass them through `POST /api/training/generate-code`.
4. **Infra**: `pyproject.toml` cumulative additions: `jinja2>=3.1` (W1), `hmmlearn>=0.3` (W4), `merge3>=0.0.8` (cross), `gymnasium>=1.0`, `stable-baselines3>=2.4` (W9). All compatibility-tested against `ml` conda env's `torch 2.11.0+cu130` BEFORE landing.
