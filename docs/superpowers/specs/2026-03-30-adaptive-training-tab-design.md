# Adaptive Training Tab Design

Complete redesign of the Training tab to be fully model-agnostic and self-populating. Models declare their metrics via `metric_declarations`; the UI auto-renders groups, tabs, and renderers with zero frontend changes per model. Includes a new `surface_3d` renderer for 3D loss surface visualization (live trajectory + post-training surface scan).

## Problem

The current Training tab is a flat scrollable page that dumps all metrics into one MetricGrid. With CNN+Transformer declaring 55 metrics across 6 groups and HDP-HMM having its own distinct set, the page becomes an unnavigable wall. Adding a new model type should require zero React code changes — only a Python script emitting `metric_declarations` and `emit_metric()`.

## Design Principles

1. **Model declares everything** — `metric_declarations` SSE event defines groups, renderers, ordering. No hardcoded per-model UI.
2. **Phase-aware layout** — live training shows focused streaming metrics + log; post-training shows full MetricGrid with group tabs.
3. **Zero-touch new models** — new model = new Python script. No React components, no routing, no adapter changes.
4. **Existing infrastructure preserved** — `SelfDescribingDiagnostics`, `MetricGrid`, 12-col grid, renderer registry all stay. We refactor the page layout and add tab navigation.

## Architecture

### Phase 1: Live Training

Layout (top to bottom):
```
ConfigStrip (model type, symbol, timeframe, hyperparameters, run/stop, progress)
├─ Error/SSE banners (conditional)
├─ Split View (50/50 horizontal)
│   ├─ LEFT: Live streaming metrics (only the "training" group from metric_declarations)
│   │   └─ Mini sparkline cards, gauges, numbers — auto-rendered from declarations
│   └─ RIGHT: Terminal log (xterm)
├─ Loss Trajectory (3D, full-width, if model declares loss_trajectory metric)
└─ Awaiting Groups (greyed-out pills showing post-training groups, e.g. "Classification (after training)")
```

**How it works:**
- When training starts, the model emits `metric_declarations` listing all metrics it will produce
- The UI identifies which metrics have `phase: "live"` or belong to the training process group — these render in the left panel
- Other groups are shown as greyed-out pills at the bottom ("after training")
- As `emit_metric()` events stream in, cards update in real-time
- The 3D loss trajectory (if declared) updates each epoch

### Phase 2: Post-Training

Layout (top to bottom):
```
ConfigStrip (model type, symbol, timeframe, completed status)
├─ Group Tabs (auto-generated from metric_declarations groups)
│   e.g. CNN+Transformer: Training | Architecture | Classification | Calibration | Trading | Regime
│   e.g. HDP-HMM: Convergence | Regimes | Quality | Features
├─ Active Group Content (MetricGrid filtered to selected group)
│   └─ 12-col responsive grid with renderer-specific spans
└─ Model Browser (collapsible, select any trained model to load its diagnostics)
```

**How it works:**
- When training completes (or a saved model is selected from ModelBrowser), `SelfDescribingDiagnostics` populates
- Unique group names from the diagnostics become horizontal tabs
- Tab order from the existing `GROUP_ORDER` map in MetricGrid (extensible)
- Selecting a tab filters MetricGrid to that group's metrics
- Different model types produce different tabs automatically — CNN+Transformer has 6 groups, HDP-HMM has 4, a future model could have any number

### Model Browser

Stays at the bottom of the page as a collapsible section. Selecting a trained model:
1. Fetches its `diagnostics.json` via `/api/training/models/:id/diagnostics`
2. Detects model type from the diagnostics
3. Re-generates group tabs from that model's declared groups
4. Renders the full MetricGrid for the selected group

## Component Changes

### Modified Components

**`Training.tsx` (page)**
- Add group tab state (`activeGroup: string | null`)
- Add phase detection (`isTraining ? 'live' : 'post'`)
- Live phase: render `LiveTrainingView` (new component)
- Post phase: render `GroupTabs` + `MetricGrid` with `filter={[activeGroup]}`

**`MetricGrid.tsx`**
- No changes needed — already supports `filter` prop for group filtering
- Already groups/sorts by `group` field, resolves renderers from registry

### New Components

**`LiveTrainingView.tsx`**
- Split layout: streaming metrics (left) + terminal log (right)
- Reads `metric_declarations` to know which metrics to expect
- Uses `useTrainingMetrics()` context for live values
- Renders mini sparkline cards for time_series metrics, gauges for accuracy metrics
- Below the split: 3D loss trajectory (if declared)
- Below that: awaiting group pills

**`GroupTabs.tsx`**
- Extracts unique group names from `SelfDescribingDiagnostics.metrics`
- Renders horizontal tabs with group colors from `SECTION_COLORS`
- Active tab has colored underline
- `onGroupChange(group: string)` callback
- Groups auto-sorted via existing `GROUP_ORDER` map

**`Surface3DRenderer.tsx`** (new renderer in the registry)
- Registered as `surface_3d` in the renderer registry
- Two modes based on data shape:
  - **Trajectory mode**: data is `{points: {pc1, pc2, loss}[], epochs: number[]}` — renders 3D line
  - **Surface mode**: data is `{grid: float[][], alphas: float[], betas: float[], trajectory_3d?: [number,number,number][]}` — renders wireframe mesh + optional trajectory overlay
- Uses Three.js/R3F (already in the stack)
- View toggle: 3D Surface | 2D Contour | Heatmap
- Grid span: 6 columns (surface_3d added to RENDERER_SPAN)
- OrbitControls for drag-to-rotate, scroll-to-zoom

### New Renderer: `surface_3d`

**Registration:**
Add to `RENDERER_SPAN` in MetricGrid: `surface_3d: 6`
Add to renderer registry: `surface_3d -> Surface3DRenderer`

**Live trajectory data format (emitted per epoch):**
```json
{
  "type": "metric",
  "name": "loss_trajectory",
  "value": {
    "points": [
      {"pc1": 0.42, "pc2": -0.18, "loss": 1.098, "epoch": 1},
      {"pc1": 0.31, "pc2": -0.12, "loss": 0.982, "epoch": 2}
    ],
    "explained_variance": [0.72, 0.18]
  },
  "iteration": 12,
  "total": 30
}
```

**Post-training surface data format (emitted once after training):**
```json
{
  "type": "metric",
  "name": "loss_surface",
  "value": {
    "alphas": [-1.0, -0.96, "...", 1.0],
    "betas": [-1.0, -0.96, "...", 1.0],
    "losses": [["2D array, 51x51"]],
    "resolution": 51,
    "range": [-1, 1],
    "trajectory_3d": [[0.42, 1.098, -0.18], ["..."]],
    "diagnostics": {
      "sharpness": 0.024,
      "condition_number": 12.3,
      "valley_width": 0.42,
      "locally_convex": true
    }
  }
}
```

**Metric declaration:**
```json
{
  "loss_surface": {
    "renderer": "surface_3d",
    "mission": "Loss landscape around trained checkpoint (Li et al. 2018)",
    "group": "deep_learning",
    "order": 20,
    "context": {}
  },
  "loss_trajectory": {
    "renderer": "surface_3d",
    "mission": "Optimizer trajectory through weight space (PCA-projected)",
    "group": "deep_learning",
    "order": 19,
    "context": {}
  }
}
```

## Python-Side Changes

### TrajectoryRecorder (new utility)

**File:** `src/ml/shared/trajectory.py`

Records model weight snapshots during training for PCA visualization.

```
class TrajectoryRecorder:
    __init__(model, record_every=5)
    record(model, epoch, loss) -> None  # stores flattened weights if epoch % record_every == 0
    get_live_trajectory() -> dict       # PCA on current snapshots, returns points for emit_metric
    compute_surface(model, criterion, data_loader, resolution=51, num_batches=8) -> dict
```

- Weight snapshots: ~9.6 MB each for 2.4M params. At record_every=5 and 100 epochs, 20 snapshots = 192 MB.
- PCA via sklearn: 2-5 seconds on the snapshot matrix.
- Live trajectory emitted each epoch via `emit_metric("loss_trajectory", recorder.get_live_trajectory(), epoch, total_epochs)`.

### Loss Surface Computation (new utility)

**File:** `src/ml/shared/loss_surface.py`

Computes filter-normalized random direction loss surface (Li et al. 2018).

```
def compute_loss_surface(model, criterion, data_loader, resolution=51, num_batches=8, seed=42) -> dict
```

- Filter-wise normalization: per-filter rescaling so `||d_filter|| == ||w_filter||`. 1D params (biases, BN, LN) zeroed out.
- Incremental: compute 11x11 first (~5-10s), emit to dashboard, then refine to 51x51 (~1-4 min).
- GPU memory: ~140 MB total (model + 2 directions + base weights + batch). No concern on 16GB VRAM.
- Returns `{alphas, betas, losses, trajectory_3d, diagnostics}`.

### Surface Diagnostics

Computed from the loss grid:
- **Sharpness**: trace of approximate Hessian (average second derivative along grid axes). Low = flat valley = good generalization.
- **Condition number**: ratio of max/min eigenvalues of the local curvature. High = anisotropic = optimizer sensitive to direction.
- **Valley width**: distance from minimum to the 1% loss contour. Wide = robust.
- **Local convexity**: whether all sampled second derivatives are positive around the minimum.

### Integration into CNN+Transformer Training

**File:** `src/ml/cnn_transformer/train.py`

In the training loop:
1. Create `TrajectoryRecorder(model, record_every=5)` before training starts
2. After each epoch: `recorder.record(model, epoch, val_loss)`
3. After each epoch: `emit_metric("loss_trajectory", recorder.get_live_trajectory(), epoch, epochs)`
4. After training completes: `surface = compute_loss_surface(model, criterion, val_loader, resolution=51)`
5. Emit surface: `emit_metric("loss_surface", surface, epochs, epochs)`

Add both metrics to `get_metric_declarations()` in `src/ml/cnn_transformer/io/save.py`.

### Integration into HDP-HMM

HDP-HMM uses Gibbs sampling (no gradient-based optimization), so:
- Loss trajectory: not applicable (no weight-space trajectory in the gradient sense)
- Loss surface: not applicable (no differentiable loss function)
- The model simply doesn't declare these metrics. The UI adapts — no surface_3d cards appear.

This is the model-agnostic design working as intended.

## R3F Rendering Details

### Surface Mesh
- `PlaneGeometry(width, height, resolution-1, resolution-1)` rotated to XZ plane
- Y axis = loss height (from `losses[][]` grid)
- Vertex colors via viridis colormap (5-stop linear interpolation on normalized log-loss)
- Dual render: solid mesh + wireframe overlay (opacity 0.15)
- `computeVertexNormals()` for proper lighting

### Trajectory Line
- drei `<CatmullRomLine>` with `points={trajectory_3d}` (format: `[alpha, loss, beta]`)
- Color-coded: red (high loss) -> yellow -> green (converged)
- Epoch marker spheres at each recorded point
- Final epoch: pulsing green sphere (during live training)

### Controls
- drei `<OrbitControls>` — rotate, zoom, pan
- Camera: position [2, 2, 2], fov 50
- Ambient light (0.4) + directional light (0.8) for depth perception
- Optional gridHelper for reference plane

### View Toggle
Three views accessible via button strip above the 3D canvas:
1. **3D Surface** — default, full wireframe mesh + trajectory
2. **2D Contour** — top-down orthographic view, contour lines extracted from loss grid
3. **Heatmap** — flat 2D color grid (same data, no 3D), useful for publication screenshots

## Files to Create

| File | Purpose |
|---|---|
| `src/client/src/components/training/LiveTrainingView.tsx` | Split layout for live training phase |
| `src/client/src/components/training/GroupTabs.tsx` | Auto-generated group tab navigation |
| `src/client/src/components/renderers/Surface3DRenderer.tsx` | 3D loss surface/trajectory renderer (R3F) |
| `src/ml/shared/trajectory.py` | Weight snapshot recorder + PCA |
| `src/ml/shared/loss_surface.py` | Filter-normalized loss surface computation |

## Files to Modify

| File | Change |
|---|---|
| `src/client/src/pages/Training.tsx` | Phase detection, group tab state, layout switch between live/post |
| `src/client/src/components/renderers/index.ts` | Register `surface_3d` renderer |
| `src/client/src/components/renderers/MetricGrid.tsx` | Add `surface_3d: 6` to RENDERER_SPAN, add `deep_learning` section color (if missing) |
| `src/ml/cnn_transformer/train.py` | Integrate TrajectoryRecorder, emit loss_trajectory per epoch |
| `src/ml/cnn_transformer/main.py` | Call compute_loss_surface after training, emit result |
| `src/ml/cnn_transformer/io/save.py` | Add loss_surface + loss_trajectory to metric_declarations |
| `src/shared/trainingTypes.ts` | Add Surface3D data types to MetricPayload |
| `src/config/models.json` | Add metric_declarations for loss_surface/loss_trajectory to cnn-transformer-fp entry |

## Verification

1. **Live training test**: Start a CNN+Transformer training run. Verify:
   - Split view renders (metrics left, log right)
   - Streaming metrics update in real-time
   - 3D trajectory appears and grows each epoch
   - Awaiting group pills show for post-training groups
   - No metrics from other model types appear

2. **Post-training test**: After training completes (or select a saved model). Verify:
   - Group tabs auto-generate from the model's diagnostics
   - Clicking each tab shows only that group's metrics in the 12-col grid
   - Loss surface renders as interactive 3D mesh with trajectory overlay
   - Surface diagnostics (sharpness, condition number, valley width) display correctly
   - View toggle works (3D Surface / 2D Contour / Heatmap)

3. **Model-agnostic test**: Switch to HDP-HMM. Verify:
   - Completely different tabs appear (Convergence, Regimes, Quality, Features)
   - No loss surface / trajectory cards (HDP-HMM doesn't declare them)
   - Live training shows HDP-HMM-specific metrics (log_likelihood, num_regimes, etc.)

4. **New model test** (simulation): Create a minimal Python script that emits `metric_declarations` with a custom group name and 3 metrics. Verify the Training tab auto-renders the new group as a tab with the correct renderers. No React code touched.

5. **Performance test**: Verify loss surface computation completes in < 5 minutes on RTX 5060 Ti with 8 validation batches. Verify 3D rendering at 60fps with 51x51 mesh + trajectory overlay.
