"""
Model-agnostic PyTorch training diagnostics + loss-surface logging helpers.

Any PyTorch training loop can import this module to stream two classes of
verbose telemetry to the dashboard over the JSON-line stdout protocol:

  (a) Per-step training diagnostics — gradient norm, learning rate,
      throughput (samples/s), and peak VRAM — rendered as live time-series.
  (b) A filter-normalized loss surface (Li et al. 2018) plus the PCA-projected
      optimizer trajectory through weight space — rendered as a 3D surface.

This module is *glue*. It does NOT reimplement the loss-surface math or the
emit protocol — it imports the existing (previously orphaned) infrastructure:

  - ``protocol.emit_metric`` / ``protocol.emit_metric_declarations``
        Self-describing metric schema + per-iteration numeric emit.
        Signatures (src/ml/shared/protocol.py):
          emit_metric(name, value, iteration, total=0)          # line 33
          emit_metric_declarations(declarations: dict)          # line 110
          emit_log(message, level="info")                       # line 94
  - ``loss_surface.compute_loss_surface``
        Filter-normalized 2D loss grid.
        Signature (src/ml/shared/loss_surface.py:379):
          compute_loss_surface(
              model, criterion, data_loader,
              resolution=51, alpha_range=(-1.0, 1.0), num_batches=8,
              device='cuda', seed=42,
              trajectory_recorder=None, emit_coarse=None) -> dict
        Return dict keys (src/ml/shared/loss_surface.py:515-533):
          alphas: list[float]
          betas: list[float]
          losses: list[list[float]]
          resolution: int
          range: [float, float]
          diagnostics: {sharpness, condition_number, valley_width, locally_convex}
          trajectory_3d: list[[float, float, float]]  # optional (alpha, loss, beta)
  - ``trajectory.TrajectoryRecorder``
        PCA weight-trajectory recorder.
        Constructor (src/ml/shared/trajectory.py:38):
          TrajectoryRecorder(model, record_every=5)
        Methods used here:
          record(model, epoch, loss) -> None                    # line 51
          snapshot_count (property)                             # line 47

Renderer contract (the *consumer* of the loss_surface payload):
  - src/client/src/components/renderers/Surface3DRenderer.tsx
        isSurfaceGridData() (line 93) requires Array ``alphas``, ``betas``,
        ``losses``; Surface3DScene/SurfaceContourFallback additionally read
        ``resolution``, ``range``, optional ``trajectory_3d`` (as
        [alpha, loss, beta] triples), and optional ``diagnostics``
        {sharpness, condition_number, valley_width, locally_convex}.
  - src/shared/trainingTypes.ts:279 ``Surface3DGridData`` is the TS contract:
        { alphas, betas, losses, resolution, range, trajectory_3d?, diagnostics }
  - src/client/src/lib/diagnostics-schema.ts:41 confirms the ``surface_3d``,
        ``time_series`` and ``number`` RendererType union members exist; the
        MetricDeclaration shape (line 76) is
        { value?, renderer, mission, context, group?, order? }.

How ``LossSurfaceProbe.compute_and_emit`` maps closure -> compute_loss_surface
------------------------------------------------------------------------------
``compute_loss_surface`` is data-loader driven: per grid point it perturbs the
model weights, then for each batch does ``output = model(inputs)`` followed by
``loss = criterion(output, targets)`` and averages ``loss.item()`` over
``num_batches`` (see _evaluate_loss, src/ml/shared/loss_surface.py:152-206).

The shared logging contract asked for here is *closure driven*: caller supplies
a zero-arg ``loss_closure`` that returns a scalar loss tensor for a fixed eval
batch. We bridge the two without touching loss_surface.py by constructing:

  * ``_ClosureCriterion`` — an ``nn.Module`` whose ``forward(output, targets)``
    ignores both arguments and returns ``loss_closure()``. Because the closure
    closes over the (perturbed) ``model`` and the fixed eval batch, the returned
    loss correctly reflects the perturbed weights at each grid point.
  * ``_SingleBatchLoader`` — a 1-element iterable yielding a placeholder
    ``(input, target)`` pair so loss_surface's ``_evaluate_loss`` loop runs
    exactly once per grid point with ``num_batches=1``. The placeholder input is
    fed through ``model(inputs)`` (cheap, output discarded by the criterion).

The dict returned by ``compute_loss_surface`` already has EXACTLY the
``Surface3DGridData`` keys the renderer consumes, so the payload is forwarded
verbatim (the mapping is 1:1, no field renaming needed).
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable

import torch
import torch.nn as nn

# ── Import the existing shared infrastructure ───────────────────────────────
# Prefer package-relative imports (matches the rest of src/ml/shared/*). When
# this file is run directly as __main__ (``uv run python src/ml/shared/
# torch_logging.py``) there is no parent package, so fall back to putting
# ``src/`` on sys.path and importing via the ``ml.shared`` package path.
try:
    from .loss_surface import compute_loss_surface
    from .protocol import emit_log, emit_metric, emit_metric_declarations
    from .trajectory import TrajectoryRecorder
except ImportError:  # pragma: no cover - exercised only under direct execution
    _SRC_ROOT = Path(__file__).resolve().parents[2]  # .../ml_dashboard/src
    if str(_SRC_ROOT) not in sys.path:
        sys.path.insert(0, str(_SRC_ROOT))
    from ml.shared.loss_surface import compute_loss_surface
    from ml.shared.protocol import emit_log, emit_metric, emit_metric_declarations
    from ml.shared.trajectory import TrajectoryRecorder


# ── Diagnostic metric names (single source of truth) ────────────────────────
# Ordered so declare_diagnostics_metrics and emit_step_diagnostics agree.
GRAD_NORM = "grad_norm"
LEARNING_RATE = "learning_rate"
THROUGHPUT = "throughput_samples_s"
VRAM = "vram_mb"

# Order in which the four diagnostics render (lower = first).
_DIAGNOSTIC_ORDER = (GRAD_NORM, LEARNING_RATE, THROUGHPUT, VRAM)


# ── Scalar diagnostics ──────────────────────────────────────────────────────

def global_grad_norm(model: nn.Module) -> float:
    """L2 norm of all gradients across the model (post-backward, pre-step).

    Computes ``sqrt(sum_p ||p.grad||_2^2)`` over every parameter that currently
    has a populated ``.grad``. Call this AFTER ``loss.backward()`` and BEFORE
    ``optimizer.step()`` (and before any in-place gradient clipping if you want
    the raw, unclipped magnitude).

    Parameters
    ----------
    model : torch.nn.Module
        Model whose parameter gradients are aggregated.

    Returns
    -------
    float
        The global L2 gradient norm. Returns ``0.0`` if no parameter has a
        gradient (e.g. called before the first ``backward()``).
    """
    total_sq = 0.0
    found = False
    for p in model.parameters():
        if p.grad is None:
            continue
        found = True
        # .detach() to avoid building autograd graph over the norm computation.
        param_norm = p.grad.detach().norm(2)
        total_sq += float(param_norm.item()) ** 2
    if not found:
        return 0.0
    return float(total_sq ** 0.5)


def current_lr(optimizer: torch.optim.Optimizer) -> float:
    """Learning rate of the optimizer's first parameter group.

    Reads ``optimizer.param_groups[0]["lr"]``. For schedulers that maintain a
    single global LR (the common case) this is the effective LR. For multi-group
    optimizers (e.g. per-layer LRs) this reports group 0 only by design.

    Parameters
    ----------
    optimizer : torch.optim.Optimizer
        The optimizer to read from.

    Returns
    -------
    float
        Current learning rate of param group 0.
    """
    return float(optimizer.param_groups[0]["lr"])


def vram_mb() -> float:
    """Peak CUDA memory allocated since the last reset, in megabytes.

    Returns ``torch.cuda.max_memory_allocated() / 1e6`` when CUDA is available,
    else ``0.0``. Pair with ``torch.cuda.reset_peak_memory_stats()`` at the
    start of an epoch if you want per-epoch peaks rather than run-to-date peaks.

    Returns
    -------
    float
        Peak allocated VRAM in MB (0.0 on CPU-only runs).
    """
    if torch.cuda.is_available():
        return float(torch.cuda.max_memory_allocated() / 1e6)
    return 0.0


# ── Self-describing declarations + per-step emit ────────────────────────────

def declare_diagnostics_metrics() -> None:
    """Declare the four training diagnostics so the dashboard can pre-render.

    Emits a single ``metric_declarations`` event registering ``grad_norm``,
    ``learning_rate``, ``throughput_samples_s`` and ``vram_mb``, each as a
    ``time_series`` renderer in the ``diagnostics`` group with a clear
    ``mission`` (the question the chart answers) and a ``context`` carrying its
    display unit. Call this once, before the training loop starts streaming
    per-step metrics.

    Notes
    -----
    The declaration order matches ``_DIAGNOSTIC_ORDER`` via the ``order`` field
    so the cards lay out gradient -> LR -> throughput -> VRAM left to right.
    """
    declarations = {
        GRAD_NORM: {
            "renderer": "time_series",
            "mission": "Is the gradient signal stable, or exploding/vanishing?",
            "context": {
                "unit": "L2 norm",
                "decimals": 4,
                "higher_is_better": False,
            },
            "group": "diagnostics",
            "order": 0,
        },
        LEARNING_RATE: {
            "renderer": "time_series",
            "mission": "How is the scheduler driving the learning rate over time?",
            "context": {
                "unit": "LR",
                "decimals": 6,
                "min": 0.0,
            },
            "group": "diagnostics",
            "order": 1,
        },
        THROUGHPUT: {
            "renderer": "time_series",
            "mission": "How many samples per second is training processing?",
            "context": {
                "unit": "samples/s",
                "decimals": 1,
                "higher_is_better": True,
                "min": 0.0,
            },
            "group": "diagnostics",
            "order": 2,
        },
        VRAM: {
            "renderer": "time_series",
            "mission": "How much GPU memory is the run consuming (headroom check)?",
            "context": {
                "unit": "MB",
                "decimals": 1,
                "higher_is_better": False,
                "min": 0.0,
            },
            "group": "diagnostics",
            "order": 3,
        },
    }
    emit_metric_declarations(declarations)


def emit_step_diagnostics(
    step: int,
    total: int,
    *,
    grad_norm: float,
    lr: float,
    throughput: float,
    vram: float,
) -> None:
    """Emit one ``metric`` event per diagnostic for a single training step.

    Parameters
    ----------
    step : int
        Current global step / iteration index (the chart x-coordinate).
    total : int
        Total expected steps (for progress scaling on the chart).
    grad_norm : float
        Value from :func:`global_grad_norm`.
    lr : float
        Value from :func:`current_lr`.
    throughput : float
        Samples processed per second for this step.
    vram : float
        Value from :func:`vram_mb`.
    """
    values = {
        GRAD_NORM: grad_norm,
        LEARNING_RATE: lr,
        THROUGHPUT: throughput,
        VRAM: vram,
    }
    # Emit in declared order so downstream consumers see a stable sequence.
    for name in _DIAGNOSTIC_ORDER:
        emit_metric(name, values[name], iteration=step, total=total)


# ── Loss-surface bridging shims ─────────────────────────────────────────────

class _ClosureCriterion(nn.Module):
    """Adapter criterion: ignores (output, targets) and returns loss_closure().

    ``compute_loss_surface`` evaluates ``loss = criterion(output, targets)``
    per batch. Our caller supplies a zero-arg closure that already computes the
    loss for a fixed eval batch against the (perturbed) model, so this criterion
    discards the loader-provided arguments and delegates to the closure.
    """

    def __init__(self, loss_closure: Callable[[], torch.Tensor]):
        super().__init__()
        self._loss_closure = loss_closure

    def forward(self, output, targets):  # noqa: D401 - adapter, args unused
        loss = self._loss_closure()
        if not torch.is_tensor(loss):
            loss = torch.as_tensor(float(loss))
        return loss


class _SingleBatchLoader:
    """1-element iterable yielding a placeholder (input, target) pair.

    Drives ``compute_loss_surface``'s ``_evaluate_loss`` loop exactly once per
    grid point (use with ``num_batches=1``). The placeholder input is consumed
    by :class:`_PassthroughModel` (which ignores it), and the loss is produced
    by :class:`_ClosureCriterion` (which ignores both args and calls the
    closure). The tensors are therefore shape-agnostic w.r.t. the real model.
    """

    def __init__(self, device: torch.device):
        # Trivial 1x1 tensors — never fed to the real model (see
        # _PassthroughModel) so their shape is irrelevant to the user's network.
        self._input = torch.zeros((1, 1), device=device)
        self._target = torch.zeros((1,), dtype=torch.long, device=device)

    def __iter__(self):
        yield (self._input, self._target)

    def __len__(self):
        return 1


class _PassthroughModel(nn.Module):
    """Wraps the real model so ``compute_loss_surface`` perturbs ITS weights.

    ``compute_loss_surface`` iterates ``model.parameters()`` to perturb/restore
    weights AND calls ``model(inputs)`` per batch. We need the perturbation to
    hit the user's real network, but the placeholder loader input is not shaped
    for that network's forward pass. This wrapper re-exports the real model's
    parameters (so perturbation/restore operate on them) while overriding
    ``forward`` to ignore the loader input and return a constant — the real
    forward happens inside the closure-backed criterion instead.
    """

    def __init__(self, real_model: nn.Module, device: torch.device):
        super().__init__()
        # Registering the submodule means self.parameters() == real model
        # parameters in the SAME ORDER, which is what compute_loss_surface's
        # base_weights/_perturb_weights/_restore_weights rely on.
        self.inner = real_model
        self._const = torch.zeros((1, 1), device=device)

    def forward(self, inputs):  # noqa: D401 - placeholder forward, input unused
        return self._const


class LossSurfaceProbe:
    """Records a weight trajectory and emits a filter-normalized loss surface.

    Wraps :class:`TrajectoryRecorder` (PCA weight-path) and
    :func:`compute_loss_surface` (Li et al. 2018 filter-normalized grid),
    producing a payload that matches the ``Surface3DGridData`` renderer contract
    exactly and forwarding it over the metric-declarations channel under the
    ``loss_surface`` key with ``renderer="surface_3d"``.

    Parameters
    ----------
    model : torch.nn.Module
        Model to track. Used at construction only to size the trajectory vector.
    record_every : int
        Forwarded to :class:`TrajectoryRecorder`. Record a snapshot every N
        epochs. Default 1 (record every call) so short runs still accumulate
        enough snapshots for a PCA-aligned surface.
    """

    def __init__(self, model: nn.Module, record_every: int = 1):
        self._recorder = TrajectoryRecorder(model, record_every=record_every)
        self._epoch = 0

    @property
    def snapshot_count(self) -> int:
        """Number of weight snapshots recorded so far."""
        return self._recorder.snapshot_count

    def record(self, model: nn.Module, loss: float) -> None:
        """Record one trajectory point (call once per epoch).

        Uses an internal monotonic epoch counter so callers that just want
        "record another point" don't have to track epoch numbers. The counter
        is what :class:`TrajectoryRecorder` filters against ``record_every``.

        Parameters
        ----------
        model : torch.nn.Module
            Current model state.
        loss : float
            Loss (typically validation) at this epoch — used as the trajectory
            point's height.
        """
        self._recorder.record(model, self._epoch, float(loss))
        self._epoch += 1

    def compute_and_emit(
        self,
        model: nn.Module,
        loss_closure: Callable[[], torch.Tensor],
        *,
        resolution: int = 25,
        distance: float = 1.0,
        device=None,
    ) -> dict:
        """Compute the loss surface and emit it as a ``surface_3d`` metric.

        Parameters
        ----------
        model : torch.nn.Module
            Trained model to probe. Its weights are perturbed and restored
            internally by :func:`compute_loss_surface` (non-destructive).
        loss_closure : Callable[[], torch.Tensor]
            Zero-arg callable returning a scalar loss tensor for a FIXED eval
            batch evaluated against ``model``. Must close over both the model
            and the eval batch so that, after each weight perturbation, calling
            it reflects the perturbed weights. Example::

                xb, yb = next(iter(val_loader))
                xb, yb = xb.to(dev), yb.to(dev)
                loss_closure = lambda: criterion(model(xb), yb)

        resolution : int
            Grid resolution (resolution x resolution points). Default 25.
        distance : float
            Half-width of the perturbation range; maps to
            ``alpha_range=(-distance, +distance)``. Default 1.0.
        device : str | torch.device | None
            Compute device. Defaults to the model's parameter device, else cuda
            if available, else cpu.

        Returns
        -------
        dict
            The Surface3DGridData payload (the same dict returned by
            :func:`compute_loss_surface`): keys ``alphas``, ``betas``,
            ``losses``, ``resolution``, ``range``, ``diagnostics`` and optional
            ``trajectory_3d``.
        """
        # Resolve compute device.
        if device is None:
            try:
                resolved = next(model.parameters()).device
            except StopIteration:
                resolved = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            resolved = torch.device(device)

        criterion = _ClosureCriterion(loss_closure).to(resolved)
        data_loader = _SingleBatchLoader(resolved)
        # Wrap so compute_loss_surface perturbs the REAL model's params (via
        # wrapped.parameters() -> inner params, same tensor objects, same order)
        # while model(inputs) on the placeholder loader input is a no-op. The
        # closure re-evaluates the real (now-perturbed) model on the fixed batch.
        wrapped = _PassthroughModel(model, resolved)

        # compute_loss_surface perturbs weights per grid point and calls
        # criterion(model(inputs), targets); our criterion ignores those args
        # and returns loss_closure() (which re-evaluates the perturbed model on
        # the fixed eval batch). num_batches=1 -> one closure call per cell.
        payload = compute_loss_surface(
            model=wrapped,
            criterion=criterion,
            data_loader=data_loader,
            resolution=resolution,
            alpha_range=(-float(distance), float(distance)),
            num_batches=1,
            device=str(resolved),
            seed=42,
            trajectory_recorder=(
                self._recorder if self._recorder.snapshot_count >= 3 else None
            ),
            emit_coarse=None,
        )

        # payload already matches Surface3DGridData 1:1 — forward verbatim.
        emit_metric_declarations(
            {
                "loss_surface": {
                    "value": payload,
                    "renderer": "surface_3d",
                    "group": "diagnostics",
                    "mission": (
                        "Did training settle in a flat, well-conditioned basin "
                        "(generalizes) or a sharp/saddle region (fragile)?"
                    ),
                    "context": {
                        "unit": "loss",
                        "resolution": payload.get("resolution", resolution),
                        "range": payload.get("range", [-distance, distance]),
                        "method": "filter-normalized (Li et al. 2018)",
                    },
                    "order": 4,
                }
            }
        )
        return payload


# ── Unit smoke test ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    # NOTE: This is a UNIT SMOKE of the logging utility, NOT a training run.
    # Small random tensors are acceptable here because we are validating the
    # SHAPE of the emitted JSON events (and that the math wiring runs end to
    # end), not producing any trading results. No real market data is involved
    # and nothing here is used for evaluation or deployment.
    import io
    import json
    from contextlib import redirect_stdout

    torch.manual_seed(0)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # Tiny model: 2 dense layers (gives 2D weight tensors for filter-norm).
    model = nn.Sequential(
        nn.Linear(4, 8),
        nn.ReLU(),
        nn.Linear(8, 3),
    ).to(device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
    criterion = nn.CrossEntropyLoss()

    # Fixed eval batch (random — see note above; shape validation only).
    xb = torch.randn(16, 4, device=device)
    yb = torch.randint(0, 3, (16,), device=device)

    # 1. One backward pass, then assert grad norm > 0 and LR matches.
    optimizer.zero_grad(set_to_none=True)
    loss = criterion(model(xb), yb)
    loss.backward()

    gn = global_grad_norm(model)
    assert gn > 0.0, f"expected positive grad norm, got {gn}"
    lr = current_lr(optimizer)
    assert abs(lr - 1e-3) < 1e-12, f"expected lr=1e-3, got {lr}"
    vram = vram_mb()
    assert vram >= 0.0, f"vram must be non-negative, got {vram}"
    print(f"[smoke] grad_norm={gn:.6f} lr={lr:.6f} vram_mb={vram:.3f}")

    # 2. Declarations event — capture stdout, assert it's metric_declarations
    #    covering all four diagnostics in the diagnostics group.
    buf = io.StringIO()
    with redirect_stdout(buf):
        declare_diagnostics_metrics()
    decl_lines = [ln for ln in buf.getvalue().splitlines() if ln.strip()]
    assert len(decl_lines) == 1, f"expected 1 declaration line, got {len(decl_lines)}"
    decl_evt = json.loads(decl_lines[0])
    assert decl_evt["type"] == "metric_declarations", decl_evt["type"]
    decls = decl_evt["declarations"]
    for name in (GRAD_NORM, LEARNING_RATE, THROUGHPUT, VRAM):
        assert name in decls, f"missing declaration: {name}"
        assert decls[name]["renderer"] == "time_series", name
        assert decls[name]["group"] == "diagnostics", name
        assert decls[name]["mission"], f"empty mission for {name}"
        assert "unit" in decls[name]["context"], f"missing unit for {name}"
    print(f"[smoke] declared {len(decls)} diagnostics metrics")

    # 3. Per-step emit — capture stdout, assert exactly 4 metric events.
    buf = io.StringIO()
    with redirect_stdout(buf):
        emit_step_diagnostics(
            step=1, total=10,
            grad_norm=gn, lr=lr, throughput=1234.5, vram=vram,
        )
    metric_lines = [ln for ln in buf.getvalue().splitlines() if ln.strip()]
    assert len(metric_lines) == 4, f"expected 4 metric lines, got {len(metric_lines)}"
    metric_evts = [json.loads(ln) for ln in metric_lines]
    assert all(e["type"] == "metric" for e in metric_evts), \
        [e["type"] for e in metric_evts]
    emitted_names = [e["name"] for e in metric_evts]
    assert emitted_names == list(_DIAGNOSTIC_ORDER), emitted_names
    assert all(e["iteration"] == 1 and e["total"] == 10 for e in metric_evts)
    print(f"[smoke] emitted step diagnostics: {emitted_names}")

    # 4. LossSurfaceProbe — record two trajectory points, then compute + emit
    #    at resolution=5, asserting the payload satisfies the Surface3DRenderer
    #    contract (isSurfaceGridData requires arrays alphas/betas/losses).
    probe = LossSurfaceProbe(model, record_every=1)

    # Two epochs: train a step, record loss.
    for _ in range(2):
        optimizer.zero_grad(set_to_none=True)
        step_loss = criterion(model(xb), yb)
        step_loss.backward()
        optimizer.step()
        probe.record(model, float(step_loss.item()))
    assert probe.snapshot_count == 2, probe.snapshot_count

    # Fixed-batch closure that re-evaluates the (perturbed) model.
    def loss_closure() -> torch.Tensor:
        return criterion(model(xb), yb)

    buf = io.StringIO()
    with redirect_stdout(buf):
        payload = probe.compute_and_emit(
            model, loss_closure, resolution=5, distance=1.0, device=device,
        )
    surf_lines = [ln for ln in buf.getvalue().splitlines() if ln.strip()]
    assert len(surf_lines) == 1, f"expected 1 surface line, got {len(surf_lines)}"
    surf_evt = json.loads(surf_lines[0])
    assert surf_evt["type"] == "metric_declarations", surf_evt["type"]
    surf_decl = surf_evt["declarations"]["loss_surface"]
    assert surf_decl["renderer"] == "surface_3d", surf_decl["renderer"]
    assert surf_decl["group"] == "diagnostics", surf_decl["group"]

    # The renderer's isSurfaceGridData() guard requires these three arrays.
    grid = surf_decl["value"]
    for required in ("alphas", "betas", "losses"):
        assert isinstance(grid[required], list) and grid[required], \
            f"surface payload missing array: {required}"
    # Surface3DGridData full contract (trainingTypes.ts:279).
    assert grid["resolution"] == 5, grid["resolution"]
    assert isinstance(grid["range"], list) and len(grid["range"]) == 2, grid["range"]
    assert isinstance(grid["losses"][0], list), "losses must be 2D"
    assert len(grid["losses"]) == 5 and len(grid["losses"][0]) == 5, \
        (len(grid["losses"]), len(grid["losses"][0]))
    for dk in ("sharpness", "condition_number", "valley_width", "locally_convex"):
        assert dk in grid["diagnostics"], f"missing diagnostic: {dk}"
    # The returned payload is the same object that was emitted.
    assert payload is grid or payload == grid
    print(
        f"[smoke] loss_surface payload keys={sorted(grid.keys())} "
        f"grid={len(grid['losses'])}x{len(grid['losses'][0])}"
    )

    # emit_log is part of the public protocol re-exported here — exercise it.
    emit_log("torch_logging smoke complete", level="info")

    print("LOSS_LOG_SMOKE_OK")
