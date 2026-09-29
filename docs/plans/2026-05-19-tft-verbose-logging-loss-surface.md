# ML Studio End-to-End: TFT + Verbose Logging + Loss-Surface Framework

> Phase 3 (Weights & Biases) was removed from the project on 2026-05-28; the TFT, verbose-logging and
> loss-surface work stands, and all telemetry flows through the dashboard's stdout protocol and SSE.

Date: 2026-05-19 · Status: IN PROGRESS

## Goal (verbatim intent)

1. **Model-agnostic verbose logging + deep analytical insights** — works no matter which architecture trains.
2. **Embedded loss-surface visualization** — WebGL/D3, aesthetic, fully wired to real training.
3. **A real Temporal Fusion Transformer (TFT)** trading model, selectable from the ML Studio dropdown, created + trained end-to-end through the dashboard, validating the whole ML Studio pipeline.

## What recon established (file:line)

The system is **code-generation based**:

```
Catalog dropdown (state.modelType)
  → ArchitectureComposer renders HP form from registry entry.defaultHyperparameters
  → POST /api/training/generate-code  (codegen.ts:111 → codeGenerator.generatePreview → generate_model.py --dry-run)
  → Monaco preview (CodePreviewPane)
  → POST /api/training/save-generated (codegen.ts:140 → saveAndRegister → generate_model.py --register)
  → POST /api/training/start (training.ts:473 → orchestrator → PythonRunner spawns .venv python src/ml/<id>/main.py --json + hp flags)
  → JSON-line stdout protocol (src/ml/shared/protocol.py)
  → GeneratedParser (Zod) → SSE /api/training/stream/:modelId
  → split contexts (TrainingMetricsCtx…) → LiveTrainingView + MetricGrid renderers + analytics tabs
```

- **Trainable catalog** = `getTrainableModels()` (catalogBridge.ts:758) merging `runners.json` (registry.ts `listModels`, key `${algorithm}+${task}`) + markdown specs + `composite_catalog_extras.json`. A model is `wired` (script on disk), `generate` (no script but `pickTemplate()` resolves a TemplateId), or `browse-only`.
- **Self-describing diagnostics** = the model-agnostic viz system. Python `emit_metric_declarations({name:{value,renderer,mission,context,group,order}})` → `RENDERER_REGISTRY` (15 renderers incl. `surface_3d`) auto-renders. `LiveTrainingView` auto-renders any metric group.
- **Generated main.py CLI contract** (`_base.py.j2:99-129`): standard flags + one `--<hp-name-dashed>` per hyperparameter; type inferred. `cliFlags` is therefore mechanically derivable.

## Confirmed blockers (must fix first)

| # | Blocker | Evidence | Impact |
|---|---|---|---|
| B1 | `generate_model.py --register` is a **stub** | generate_model.py:988-992 (appends warning only) | Save never patches runners.json → saved model never becomes trainable |
| B2 | Save path emits `{writtenTo,…}` not `{savedPaths,runnerKey,…}` | generate_model.py:1006-1011 vs codeGenerator.ts:401 (`extractResultJson(stdout,'savedPaths')`) | `saveAndRegister` throws "no parseable JSON result line" |
| B3 | `--files-override-json` not a parsed arg | absent from `_parse_args` (generate_model.py:234-329); TS sends it (codeGenerator.ts:206) | argparse rejects unknown arg → save fails when user edits in Monaco |
| B4 | Atomic mode never writes `__init__.py` | generate_model.py:1002-1004 writes only the 4 files | `import src.ml.<id>.main` fails → orchestrator can't spawn |
| B5 | W&B wired nowhere | grep zero in protocol.py / templates / scripts | Violated the mandatory-W&B rule (rule retired with W&B on 2026-05-28) |
| B6 | Loss-surface infra orphaned | `loss_surface.py` + `trajectory.py` imported by nothing; `Surface3DRenderer` registered but no emitter | No loss surface renders |
| B7 | Verbose training internals not emitted | `_base.py.j2` emits only losses; no grad_norm/lr/throughput/VRAM/histograms | Shallow insight |

## Design decisions (locked)

- **TFT variant**: Interpretable TFT (Lim et al. 2019) adapted to the existing **classification** task infra (not quantile multi-horizon forecasting, which would need new task+label+eval). Components: Variable Selection Networks (VSN), Gated Residual Networks (GRN), GLU gating, LSTM local-context encoder, Interpretable Multi-Head Attention over the temporal window, output GRN → classification head. Interpretability outputs (variable-selection weights, temporal attention weights) feed the "deep insights" panel.
- **Codegen-first**: TFT ships as a `generate` family — catalog extra + `temporal_fusion_transformer.py.j2` + `pickTemplate()` routing — so the Generate→Save→Train flow is exercised. Phase 0 makes Save real. Algorithm `tft` + task `direction_classifier` (reuse) gives a clean runner key `tft+direction_classifier` on save.
- **Verbose logging is model-agnostic**: a shared `emit_training_diagnostics()` helper (protocol.py) + a `TrainingDiagnostics` mixin used in `_base.py.j2`'s pytorch train loops. Emits grad_norm (global L2), lr, throughput (samples/s), VRAM (MB), weight/grad histograms (`distribution` renderer), per-layer grad norm (`heatmap`). Group `diagnostics`. Any pytorch family inherits it; TFT uses it.
- **Loss surface**: wire `compute_loss_surface` + `TrajectoryRecorder` via a shared helper into the pytorch train loop. Record trajectory per epoch; post-train compute filter-normalized 2D surface at bounded resolution (default 25×25, configurable, GPU-batched) over the final model; emit `surface_3d` declaration + payload; existing `Surface3DRenderer` (R3F/WebGL + SVG fallback) renders it. Delete synthetic `LossSurface3D.tsx`. Polish colormap + trajectory overlay.
- **Data**: real bars from QuestDB (verify symbol availability first; MNQ@1m or @1d).
- **Test**: dashboard-driven (`POST /api/training/start` = the Run button; optional Playwright click). Never raw-CLI training (per project rule).

## Phases

### Phase 0 — Fix codegen save/register pipeline (prerequisite, unblocks all) ✅ DONE 2026-05-19
- `generate_model.py`: add `--files-override-json` arg + honor it; write `__init__.py` in atomic mode; implement real `--register` (patch `src/config/runners.json`: build `${algorithm}+${task}` entry with `script: src/ml/<id>/main.py`, `defaultHyperparameters` from passed hp, `cliFlags` = `{hp:"--"+hp.replace("_","-")}`, `outputs`, `featurePipeline`, `legacyId`, `displayName`); emit `{savedPaths,runnerKey,templateUsed,warnings}` JSON result line. Algorithm/task derivation: accept new `--algorithm`/`--task` flags (TS passes them; default algorithm=catalogId-slug, task from label/headKind).
- `codeGenerator.ts`/`codegen.ts`: pass `algorithm`/`task` through `SaveGeneratedRequest` if needed.
- **Gate**: CLI `--register` on `xgboost` writes a runner + `__init__.py`, emits `savedPaths`; `getTrainableModels()` shows it `wired`. Revert test artifacts.

### Phase 1 — TFT architecture (Python) ✅ DONE 2026-05-19
Verified: blocks/tft.py smoke (TFT_SMOKE_OK), torch_logging smoke (LOSS_LOG_SMOKE_OK),
template renders from catalog-id (no --template-id), generated main.py imports
(train_one_fold/predict/build_diagnostics), TFT shows in trainable catalog as
runnerSource='generate' with 12 HPs, tsc green.

- `src/ml/blocks/tft.py` (new): `GatedLinearUnit`, `GatedResidualNetwork`, `VariableSelectionNetwork`, `InterpretableMultiHeadAttention`, `TemporalFusionTransformer` (classification). Add to `blocks/__init__.py`.
- `src/templates/architectures/temporal_fusion_transformer.py.j2` (new): extends `_base.py.j2`; overrides `model_imports`, `train_loop` (windowed seq build + train_one_fold + predict), `compute_fold_metrics`/`eval_helpers`/`eval_block` (reuse `_eval_classification.py.j2`); calls verbose-logging + loss-surface helpers; emits interpretability overlays.
- Routing: `pickTemplate()` transformer case → `temporal_fusion_transformer` for temporal-fusion specs; add to `TemplateId` union; `generate_model.py` `DEFAULT_FAMILY_FOR_CATALOG`.
- Catalog presence: add TFT entry (curated HPs) via an extras mechanism so the dropdown shows it pre-save with clean hyperparameters; algorithm `tft` in algorithms.json.
- **Gate**: dropdown lists "Temporal Fusion Transformer" as GENERATE; Generate code renders valid Python (dry-run); `python -c "import"` of rendered main.py compiles.

### Phase 2 — Model-agnostic verbose logging ✅ DONE 2026-05-20
Wired torch_logging (grad_norm/lr/throughput/vram under group "diagnostics") into ALL 6
neural families: temporal_fusion_transformer, transformer_seq, pytorch_mlp, pytorch_cnn,
pytorch_autoencoder, pytorch_vae. Windowed supervised families (transformer_seq, cnn)
also got the compute_fold_metrics tail-alignment fix. All render AST-clean with
emit_step_diagnostics present; TFT proven streaming at runtime.

- `protocol.py`: `emit_training_diagnostics(step,total,*,grad_norm,lr,throughput,vram_mb,extra)`; histogram/heatmap declaration helpers.
- `_base.py.j2`: shared pytorch logging in train loop (grad norm pre-clip, lr, samples/s, VRAM); `emit_metric_declarations` for group `diagnostics`. TFT inherits.
- Client: confirm `distribution`/`heatmap`/`time_series` renderers + LiveTrainingView render the new group; add a "Deep Insights" affordance if needed.
- **Gate**: a short pytorch run streams grad_norm/lr/throughput/VRAM + a weight histogram to the live UI.

### Phase 3 — W&B (done 2026-05-19, removed 2026-05-28)
Wired into protocol.py and every generated model on 2026-05-19, then removed from the project on
2026-05-28.

NOTE Phase 2 (verbose logging) + Phase 4 (loss surface): the shared
src/ml/shared/torch_logging.py helper is WIRED into the TFT template
(declare_diagnostics_metrics + emit_step_diagnostics every epoch; LossSurfaceProbe
records per-epoch + compute_and_emit post-train). REMAINING: propagate the same
3-line wiring into the other pytorch family templates (transformer_seq, pytorch_mlp/
cnn/autoencoder/vae) for true model-agnostic coverage; delete synthetic
LossSurface3D.tsx + confirm Surface3DRenderer mounts the surface_3d metric.
- **Gate** (retired with W&B): the run appeared in W&B within 60 s and its metrics mirrored SSE.

### Phase 4 — Loss-surface framework ✅ DONE 2026-05-20
Wired into TFT via torch_logging.LossSurfaceProbe (emits surface_3d → Surface3DRenderer).
Deleted synthetic src/client/src/components/LossSurface3D.tsx (orphaned, no importers).

- Shared helper wrapping `TrajectoryRecorder` + `compute_loss_surface`; `_base.py.j2` records trajectory per epoch, computes surface post-train, emits `surface_3d`.
- Delete synthetic `LossSurface3D.tsx`; verify `Surface3DRenderer` consumes the emitted dict; polish aesthetics (colormap, trajectory path, contour fallback, WebGL detect).
- **Gate**: trained TFT renders a real filter-normalized 3D loss surface + optimization trajectory in the UI.

### Phase 5 — End-to-end validation (dashboard-driven) ✅ DONE 2026-05-20
VALIDATED through live server: generate-code → save-generated (runner wired) → start
on real MNQ@1d (2074 bars) → completed clean (done, no error). 3 epochs, all verbose
diagnostics + 7x7 loss surface + TFT interpretability + full classification metrics +
diagnostics.json. Fixes: algorithms.json key tft→temporal_fusion_transformer (registry
join); TFT eval_helpers compute_fold_metrics tail-alignment for windowed preds;
generate_model.py --register collision-safe. REMAINING (follow-ups): propagate torch_logging into the other 5 pytorch family
templates; optional Playwright UI visual confirmation.

- Verify QuestDB data; launch dashboard; via the Run path (and/or Playwright) create TFT from dropdown → Generate → Save → Train on real bars → watch verbose logging + loss surface → Evaluate → (Promote).
- **Gate**: full ML Studio loop completes on a real model with all telemetry; no console errors.

## Verification spine (every phase)
`npm run check` (tsc) · `npx eslint --max-warnings 0` (new files) · `python -c "import ast; ast.parse(...)"` on rendered templates · dashboard SSE shows live metrics before declaring done · zero synthetic data.
