"""
Loss surface computation via filter-normalized random directions.

Implements the visualization method from:
  Li et al. 2018 "Visualizing the Loss Landscape of Neural Nets"

Computes a 2D grid of loss values by perturbing model weights along
two random, filter-normalized directions. Supports incremental
resolution (11x11 -> 51x51) and optional PCA-based directions from
a TrajectoryRecorder.
"""

import numpy as np
import torch


def _normalize_filter_wise(
    direction: list[torch.Tensor],
    weights: list[torch.Tensor],
) -> None:
    """In-place filter-wise normalization of a random direction.

    For convolutional and dense layers, scales each filter (row) of the
    direction tensor so that its norm matches the corresponding filter
    norm from the model weights. This removes the scale ambiguity
    between layers and produces comparable perturbation magnitudes.

    For 1D tensors (biases, LayerNorm params), the direction is zeroed
    out since these parameters have negligible effect on the loss
    landscape geometry.

    Parameters
    ----------
    direction : list[torch.Tensor]
        Random direction tensors, one per parameter. Modified in-place.
    weights : list[torch.Tensor]
        Corresponding model weight tensors (same shapes as direction).
    """
    for d, w in zip(direction, weights):
        if d.dim() <= 1:
            d.fill_(0.0)
        else:
            for i in range(d.shape[0]):
                d_norm = d[i].norm() + 1e-10
                w_norm = w[i].norm()
                d[i].mul_(w_norm / d_norm)


def _generate_random_directions(
    weights: list[torch.Tensor],
    seed: int,
    device: torch.device,
) -> tuple[list[torch.Tensor], list[torch.Tensor]]:
    """Generate two random directions with the same shapes as model weights.

    Parameters
    ----------
    weights : list[torch.Tensor]
        Base model weights. Shapes are mirrored for the directions.
    seed : int
        RNG seed for reproducibility.
    device : torch.device
        Device to place direction tensors on.

    Returns
    -------
    tuple[list[torch.Tensor], list[torch.Tensor]]
        Two lists of random direction tensors (dir1, dir2).
    """
    # Generate on CPU with a seeded CPU generator (reproducible across CUDA
    # backends), then move each direction tensor to the target device. A CPU
    # generator cannot drive torch.randn(..., device='cuda') — PyTorch requires
    # the generator's device to match the allocation device.
    gen = torch.Generator(device="cpu").manual_seed(seed)
    dir1 = []
    dir2 = []
    for w in weights:
        dir1.append(torch.randn(w.shape, generator=gen).to(device))
        dir2.append(torch.randn(w.shape, generator=gen).to(device))
    return dir1, dir2


def _pca_to_param_directions(
    pc_vector: np.ndarray,
    weights: list[torch.Tensor],
    device: torch.device,
) -> list[torch.Tensor]:
    """Convert a flattened PCA component vector into per-parameter tensors.

    Parameters
    ----------
    pc_vector : np.ndarray
        Flattened PCA direction of shape (total_params,).
    weights : list[torch.Tensor]
        Model parameter list, used to determine shapes and split points.
    device : torch.device
        Device to place direction tensors on.

    Returns
    -------
    list[torch.Tensor]
        Direction tensors matching the shapes of weights.
    """
    direction = []
    offset = 0
    for w in weights:
        numel = w.numel()
        chunk = pc_vector[offset : offset + numel]
        direction.append(torch.from_numpy(chunk.copy()).float().reshape(w.shape).to(device))
        offset += numel
    return direction


def _perturb_weights(
    model: torch.nn.Module,
    base_weights: list[torch.Tensor],
    dir1: list[torch.Tensor],
    dir2: list[torch.Tensor],
    alpha: float,
    beta: float,
) -> None:
    """Set model parameters to base + alpha*dir1 + beta*dir2.

    Parameters
    ----------
    model : torch.nn.Module
        Model whose parameters are overwritten in-place.
    base_weights : list[torch.Tensor]
        Original parameter values.
    dir1, dir2 : list[torch.Tensor]
        Filter-normalized direction tensors.
    alpha, beta : float
        Perturbation magnitudes along each direction.
    """
    for p, w, d1, d2 in zip(model.parameters(), base_weights, dir1, dir2):
        p.data.copy_(w + alpha * d1 + beta * d2)


def _restore_weights(
    model: torch.nn.Module,
    base_weights: list[torch.Tensor],
) -> None:
    """Restore model parameters to the base weights.

    Parameters
    ----------
    model : torch.nn.Module
        Model whose parameters are restored in-place.
    base_weights : list[torch.Tensor]
        Original parameter values to restore.
    """
    for p, w in zip(model.parameters(), base_weights):
        p.data.copy_(w)


def _evaluate_loss(
    model: torch.nn.Module,
    criterion: torch.nn.Module,
    data_loader,
    num_batches: int,
    device: torch.device,
) -> float:
    """Evaluate average loss over a fixed number of batches.

    Parameters
    ----------
    model : torch.nn.Module
        Model in eval mode.
    criterion : torch.nn.Module
        Loss function (e.g., CrossEntropyLoss).
    data_loader : DataLoader
        Data source. Iterates from the beginning each call.
    num_batches : int
        Maximum number of batches to evaluate.
    device : torch.device
        Compute device.

    Returns
    -------
    float
        Mean loss across evaluated batches.
    """
    total_loss = 0.0
    count = 0
    for i, batch in enumerate(data_loader):
        if i >= num_batches:
            break
        # Support (input, target) and (input, target, mask) batch formats
        if len(batch) == 2:
            inputs, targets = batch
        elif len(batch) >= 3:
            inputs, targets = batch[0], batch[1]
        else:
            raise ValueError(f"Unexpected batch length: {len(batch)}")

        inputs = inputs.to(device, non_blocking=True)
        targets = targets.to(device, non_blocking=True)

        output = model(inputs)
        # Handle multi-head models that return dicts
        if isinstance(output, dict):
            # Use first head's output
            output = next(iter(output.values()))
        loss = criterion(output, targets)
        total_loss += loss.item()
        count += 1

    if count == 0:
        return float("inf")
    return total_loss / count


def _compute_surface_diagnostics(
    alphas: np.ndarray,
    betas: np.ndarray,
    losses: np.ndarray,
) -> dict:
    """Compute geometric diagnostics from the loss surface grid.

    Analyzes the curvature, conditioning, and convexity of the loss
    landscape around its minimum point on the sampled grid.

    Parameters
    ----------
    alphas : np.ndarray
        1D array of alpha values (first direction coordinates).
    betas : np.ndarray
        1D array of beta values (second direction coordinates).
    losses : np.ndarray
        2D array of shape (len(alphas), len(betas)) containing loss values.

    Returns
    -------
    dict
        Diagnostic metrics::

            {
                "sharpness": float,       # Average |d2L/dx2| at minimum (higher = sharper)
                "condition_number": float, # Ratio of max/min 2nd derivatives (higher = more elongated valley)
                "valley_width": float,     # Distance from min to nearest point with loss > 1.01 * min_loss
                "locally_convex": bool,    # Whether all sampled 2nd derivatives around min are positive
            }
    """
    n_alpha = len(alphas)
    n_beta = len(betas)

    # Find minimum location on grid
    min_idx = np.unravel_index(np.argmin(losses), losses.shape)
    i_min, j_min = min_idx
    min_loss = losses[i_min, j_min]

    # Step sizes
    da = alphas[1] - alphas[0] if n_alpha > 1 else 1.0
    db = betas[1] - betas[0] if n_beta > 1 else 1.0

    # Second derivatives at minimum via finite differences
    # d2L/dalpha2 at (i_min, j_min)
    second_derivs = []

    if 1 <= i_min < n_alpha - 1:
        d2_alpha = (
            losses[i_min + 1, j_min] - 2 * losses[i_min, j_min] + losses[i_min - 1, j_min]
        ) / (da**2)
        second_derivs.append(d2_alpha)
    else:
        d2_alpha = None

    if 1 <= j_min < n_beta - 1:
        d2_beta = (
            losses[i_min, j_min + 1] - 2 * losses[i_min, j_min] + losses[i_min, j_min - 1]
        ) / (db**2)
        second_derivs.append(d2_beta)
    else:
        d2_beta = None

    # Sharpness: average absolute second derivative at minimum
    if second_derivs:
        sharpness = float(np.mean(np.abs(second_derivs)))
    else:
        sharpness = 0.0

    # Condition number: ratio of max/min absolute second derivatives
    if len(second_derivs) == 2:
        abs_derivs = [abs(d) for d in second_derivs]
        max_d = max(abs_derivs)
        min_d = min(abs_derivs)
        condition_number = float(max_d / (min_d + 1e-10))
    else:
        condition_number = 1.0

    # Valley width: distance from minimum to nearest point with loss > 1.01 * min_loss
    threshold = 1.01 * min_loss
    min_distance = float("inf")

    for i in range(n_alpha):
        for j in range(n_beta):
            if losses[i, j] > threshold:
                dist = np.sqrt((alphas[i] - alphas[i_min]) ** 2 + (betas[j] - betas[j_min]) ** 2)
                if dist < min_distance:
                    min_distance = dist

    valley_width = float(min_distance) if np.isfinite(min_distance) else 0.0

    # Local convexity: check all second derivatives in a neighborhood around minimum
    locally_convex = True
    radius = max(1, min(3, n_alpha // 4, n_beta // 4))
    i_lo = max(1, i_min - radius)
    i_hi = min(n_alpha - 1, i_min + radius + 1)
    j_lo = max(1, j_min - radius)
    j_hi = min(n_beta - 1, j_min + radius + 1)

    for i in range(i_lo, i_hi):
        for j in range(j_lo, j_hi):
            if i >= 1 and i < n_alpha - 1:
                d2a = losses[i + 1, j] - 2 * losses[i, j] + losses[i - 1, j]
                if d2a < -1e-8:
                    locally_convex = False
                    break
            if j >= 1 and j < n_beta - 1:
                d2b = losses[i, j + 1] - 2 * losses[i, j] + losses[i, j - 1]
                if d2b < -1e-8:
                    locally_convex = False
                    break
        if not locally_convex:
            break

    return {
        "sharpness": round(sharpness, 6),
        "condition_number": round(condition_number, 6),
        "valley_width": round(valley_width, 6),
        "locally_convex": locally_convex,
    }


def _compute_grid(
    model: torch.nn.Module,
    criterion: torch.nn.Module,
    data_loader,
    base_weights: list[torch.Tensor],
    dir1: list[torch.Tensor],
    dir2: list[torch.Tensor],
    alphas: np.ndarray,
    betas: np.ndarray,
    num_batches: int,
    device: torch.device,
) -> np.ndarray:
    """Evaluate loss at every (alpha, beta) grid point.

    Parameters
    ----------
    model : torch.nn.Module
        Model (will have weights perturbed and restored).
    criterion : torch.nn.Module
        Loss function.
    data_loader : DataLoader
        Data source for loss evaluation.
    base_weights : list[torch.Tensor]
        Original model weights.
    dir1, dir2 : list[torch.Tensor]
        Filter-normalized perturbation directions.
    alphas, betas : np.ndarray
        1D coordinate arrays for the grid.
    num_batches : int
        Batches to evaluate per grid point.
    device : torch.device
        Compute device.

    Returns
    -------
    np.ndarray
        2D loss grid of shape (len(alphas), len(betas)).
    """
    n_alpha = len(alphas)
    n_beta = len(betas)
    losses = np.zeros((n_alpha, n_beta), dtype=np.float64)

    for i, alpha in enumerate(alphas):
        for j, beta in enumerate(betas):
            _perturb_weights(model, base_weights, dir1, dir2, alpha, beta)
            losses[i, j] = _evaluate_loss(model, criterion, data_loader, num_batches, device)

    return losses


def compute_loss_surface(
    model: torch.nn.Module,
    criterion: torch.nn.Module,
    data_loader,
    resolution: int = 51,
    alpha_range: tuple[float, float] = (-1.0, 1.0),
    num_batches: int = 8,
    device: str = "cuda",
    seed: int = 42,
    trajectory_recorder=None,
    emit_coarse=None,
) -> dict:
    """Compute a 2D loss surface via filter-normalized perturbations.

    Implements the method from Li et al. 2018 "Visualizing the Loss
    Landscape of Neural Nets." Perturbs model weights along two
    orthogonal directions in parameter space, evaluating the loss at
    each grid point.

    Parameters
    ----------
    model : torch.nn.Module
        Trained model to analyze.
    criterion : torch.nn.Module
        Loss function (e.g., CrossEntropyLoss).
    data_loader : DataLoader
        Evaluation data. Should yield (input, target) or (input, target, mask) batches.
    resolution : int
        Grid resolution (resolution x resolution points). Default 51.
    alpha_range : tuple[float, float]
        Range for both alpha and beta axes. Default (-1.0, 1.0).
    num_batches : int
        Number of batches to evaluate per grid point. More batches = more
        accurate but slower. Default 8.
    device : str
        Compute device. Default 'cuda'.
    seed : int
        RNG seed for reproducible random directions. Default 42.
    trajectory_recorder : TrajectoryRecorder | None
        If provided and has >= 3 snapshots, PCA directions from the
        training trajectory are used instead of random directions. This
        aligns the surface with the actual optimization path.
    emit_coarse : callable | None
        If provided, a coarse 11x11 surface is computed first and passed
        to this callback for early visualization before the full grid.

    Returns
    -------
    dict
        Loss surface data::

            {
                "alphas": list[float],
                "betas": list[float],
                "losses": list[list[float]],
                "resolution": int,
                "range": [float, float],
                "diagnostics": {
                    "sharpness": float,
                    "condition_number": float,
                    "valley_width": float,
                    "locally_convex": bool,
                },
                "trajectory_3d": {           # Only if trajectory_recorder provided
                    "points": [{"pc1": float, "pc2": float, "loss": float, "epoch": int}, ...],
                    "explained_variance": [float, float],
                }
            }
    """
    torch_device = torch.device(device)
    was_training = model.training
    model.eval()

    # 1. Extract base weights
    base_weights = [p.data.clone() for p in model.parameters()]

    try:
        # 2. Generate or compute directions
        use_pca = trajectory_recorder is not None and trajectory_recorder.snapshot_count >= 3

        if use_pca:
            pc1_flat, pc2_flat, _center = trajectory_recorder.get_pca_directions()
            dir1 = _pca_to_param_directions(pc1_flat, base_weights, torch_device)
            dir2 = _pca_to_param_directions(pc2_flat, base_weights, torch_device)
        else:
            dir1, dir2 = _generate_random_directions(base_weights, seed, torch_device)

        # 3. Filter-wise normalize both directions
        _normalize_filter_wise(dir1, base_weights)
        _normalize_filter_wise(dir2, base_weights)

        # 4. Coarse grid for early feedback
        with torch.no_grad():
            if emit_coarse is not None:
                coarse_res = 11
                coarse_alphas = np.linspace(alpha_range[0], alpha_range[1], coarse_res)
                coarse_betas = np.linspace(alpha_range[0], alpha_range[1], coarse_res)
                coarse_losses = _compute_grid(
                    model,
                    criterion,
                    data_loader,
                    base_weights,
                    dir1,
                    dir2,
                    coarse_alphas,
                    coarse_betas,
                    num_batches,
                    torch_device,
                )
                _restore_weights(model, base_weights)

                coarse_diag = _compute_surface_diagnostics(
                    coarse_alphas, coarse_betas, coarse_losses
                )
                coarse_result = {
                    "alphas": coarse_alphas.tolist(),
                    "betas": coarse_betas.tolist(),
                    "losses": coarse_losses.tolist(),
                    "resolution": coarse_res,
                    "range": list(alpha_range),
                    "diagnostics": coarse_diag,
                }
                emit_coarse(coarse_result)

            # 5. Full resolution grid
            alphas = np.linspace(alpha_range[0], alpha_range[1], resolution)
            betas = np.linspace(alpha_range[0], alpha_range[1], resolution)
            losses = _compute_grid(
                model,
                criterion,
                data_loader,
                base_weights,
                dir1,
                dir2,
                alphas,
                betas,
                num_batches,
                torch_device,
            )

    finally:
        # 6. Always restore original weights
        _restore_weights(model, base_weights)
        if was_training:
            model.train()

    # 7. Diagnostics
    diagnostics = _compute_surface_diagnostics(alphas, betas, losses)

    result = {
        "alphas": alphas.tolist(),
        "betas": betas.tolist(),
        "losses": losses.tolist(),
        "resolution": resolution,
        "range": list(alpha_range),
        "diagnostics": diagnostics,
    }

    # 8. Trajectory projection if recorder available
    # Convert PCA points to [alpha, loss, beta] tuples matching the grid coordinate space
    if trajectory_recorder is not None:
        trajectory_data = trajectory_recorder.get_live_trajectory()
        if trajectory_data and trajectory_data.get("points"):
            result["trajectory_3d"] = [
                [float(pt["pc1"]), float(pt["loss"]), float(pt["pc2"])]
                for pt in trajectory_data["points"]
            ]

    return result
