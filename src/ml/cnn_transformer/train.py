"""
Training loop for CNN+Transformer with composable loss heads.

Handles:
  - Composable loss heads (LossHeadConfig) — per-head enable/disable, weight, criterion
  - Mixed precision (AMP) training with GradScaler
  - Gradient clipping
  - OneCycleLR scheduling (stepped per batch)
  - Early stopping on validation loss
  - Per-head metric emission via SSE protocol
  - Best checkpoint restore after training
"""

import copy
import time
from dataclasses import dataclass, field

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset

from shared.protocol import emit_log, emit_metric, emit_progress


@dataclass
class LossHeadConfig:
    """Configuration for a single classification loss head."""
    name: str           # must match model head name and dataset label key
    criterion: nn.Module  # e.g. CrossEntropyLoss(weight=class_weights)
    weight: float       # loss weight
    enabled: bool = True


@dataclass
class TrainConfig:
    """Training hyperparameters."""
    epochs: int = 30
    batch_size: int = 4096
    learning_rate: float = 1e-4
    weight_decay: float = 1e-4
    grad_clip: float = 1.0
    patience: int = 5
    num_workers: int = 0
    loss_heads: list = field(default_factory=list)  # list[LossHeadConfig]


def _run_epoch(
    model: nn.Module,
    loader: DataLoader,
    config: TrainConfig,
    device: torch.device,
    optimizer: torch.optim.Optimizer | None = None,
    scaler: torch.amp.GradScaler | None = None,
    scheduler=None,
    is_train: bool = True,
) -> dict[str, float]:
    """Run one epoch (train or eval).

    Parameters
    ----------
    model : nn.Module
        Model on device.
    loader : DataLoader
        DataLoader yielding (window, labels_dict, masks_dict).
    config : TrainConfig
        Training configuration including loss_heads.
    device : torch.device
        Compute device.
    optimizer : Optimizer | None
        Required for training; None → eval mode.
    scaler : GradScaler | None
        AMP grad scaler; used only when is_train=True.
    scheduler : LRScheduler | None
        OneCycleLR scheduler stepped per batch during training.
    is_train : bool
        If True, runs in train mode with gradient updates.

    Returns
    -------
    dict[str, float]
        Keys: "loss", and per-head "{name}_loss", "{name}_accuracy".
    """
    model.train() if is_train else model.eval()

    total_loss = 0.0
    head_losses: dict[str, float] = {}
    head_correct: dict[str, int] = {}
    head_total: dict[str, int] = {}

    # Initialize per-head accumulators
    for head_cfg in config.loss_heads:
        if head_cfg.enabled:
            head_losses[head_cfg.name] = 0.0
            head_correct[head_cfg.name] = 0
            head_total[head_cfg.name] = 0

    n_batches = 0
    ctx = torch.no_grad() if not is_train else torch.enable_grad()

    with ctx:
        for window, labels_dict, masks_dict in loader:
            window = window.to(device, non_blocking=True)

            if is_train:
                optimizer.zero_grad(set_to_none=True)

            with torch.amp.autocast("cuda" if device.type == "cuda" else "cpu",
                                    enabled=(device.type == "cuda")):
                outputs = model(window)  # dict[str, Tensor | None]
                batch_loss = torch.tensor(0.0, device=device)

                for head_cfg in config.loss_heads:
                    if not head_cfg.enabled:
                        continue
                    if head_cfg.name not in outputs:
                        continue
                    logits = outputs[head_cfg.name]
                    if logits is None:
                        continue
                    if head_cfg.name not in labels_dict:
                        continue

                    target = labels_dict[head_cfg.name].to(device, non_blocking=True).long()
                    mask = masks_dict[head_cfg.name].to(device, non_blocking=True)

                    if mask.any():
                        loss = head_cfg.criterion(logits[mask], target[mask])
                        batch_loss = batch_loss + head_cfg.weight * loss
                        head_losses[head_cfg.name] += loss.item()

                        # Accuracy
                        preds = logits[mask].argmax(dim=1)
                        head_correct[head_cfg.name] += (preds == target[mask]).sum().item()
                        head_total[head_cfg.name] += mask.sum().item()

            if is_train and batch_loss.requires_grad:
                if scaler is not None:
                    scaler.scale(batch_loss).backward()
                    scaler.unscale_(optimizer)
                    nn.utils.clip_grad_norm_(model.parameters(), config.grad_clip)
                    scaler.step(optimizer)
                    scaler.update()
                else:
                    batch_loss.backward()
                    nn.utils.clip_grad_norm_(model.parameters(), config.grad_clip)
                    optimizer.step()

                if scheduler is not None:
                    scheduler.step()

            total_loss += batch_loss.item()
            n_batches += 1

    metrics: dict[str, float] = {
        "loss": total_loss / max(n_batches, 1),
    }
    for head_cfg in config.loss_heads:
        if not head_cfg.enabled:
            continue
        name = head_cfg.name
        metrics[f"{name}_loss"] = head_losses[name] / max(n_batches, 1)
        metrics[f"{name}_accuracy"] = (
            head_correct[name] / max(head_total[name], 1)
        )

    return metrics


def train_model(
    model: nn.Module,
    train_ds: "Dataset",
    val_ds: "Dataset",
    config: TrainConfig,
    device: str = "cuda",
    on_epoch=None,
) -> dict:
    """Full training loop with early stopping and metric emission.

    Parameters
    ----------
    model : nn.Module
        Model to train (moved to device internally).
    train_ds : Dataset
        Training dataset — __getitem__ returns (window, labels_dict, masks_dict).
    val_ds : Dataset
        Validation dataset — same format as train_ds.
    config : TrainConfig
        Training hyperparameters and loss head configuration.
    device : str
        Device string ("cuda" or "cpu").
    on_epoch : callable(epoch_history, best_metrics) -> None, optional
        Called after every epoch for live convergence monitoring.

    Returns
    -------
    dict with keys:
        best_epoch (int), best_val_loss (float), best_metrics (dict),
        epoch_history (list[dict]), total_time_sec (float)
    """
    dev = torch.device(device if torch.cuda.is_available() or device == "cpu" else "cpu")
    model = model.to(dev)

    use_pin_memory = config.num_workers > 0

    train_loader = DataLoader(
        train_ds,
        batch_size=config.batch_size,
        shuffle=True,
        num_workers=config.num_workers,
        pin_memory=use_pin_memory,
        persistent_workers=config.num_workers > 0,
        drop_last=True,
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=config.batch_size,
        shuffle=False,
        num_workers=config.num_workers,
        pin_memory=use_pin_memory,
        persistent_workers=config.num_workers > 0,
    )

    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=config.learning_rate,
        weight_decay=config.weight_decay,
    )

    total_steps = config.epochs * len(train_loader)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer,
        max_lr=config.learning_rate,
        total_steps=total_steps,
        pct_start=0.1,
        anneal_strategy="cos",
    )

    scaler = torch.amp.GradScaler("cuda") if dev.type == "cuda" else None

    best_val_loss = float("inf")
    patience_counter = 0
    best_weights: dict | None = None
    epoch_history: list[dict] = []
    best_metrics: dict = {}
    best_epoch = 0
    t_start = time.time()

    for epoch in range(1, config.epochs + 1):
        t_epoch = time.time()
        emit_progress(epoch, config.epochs, "training")

        # Train
        train_metrics = _run_epoch(
            model, train_loader, config, dev,
            optimizer=optimizer, scaler=scaler, scheduler=scheduler, is_train=True,
        )

        # Validate
        val_metrics = _run_epoch(
            model, val_loader, config, dev,
            optimizer=None, scaler=None, scheduler=None, is_train=False,
        )

        epoch_time = time.time() - t_epoch
        current_lr = optimizer.param_groups[0]["lr"]

        # Emit metrics
        emit_metric("train_loss", train_metrics["loss"], epoch, config.epochs)
        emit_metric("val_loss", val_metrics["loss"], epoch, config.epochs)
        emit_metric("learning_rate", current_lr, epoch, config.epochs)
        emit_metric("epoch_time_sec", epoch_time, epoch, config.epochs)

        # Per-head metrics
        for head_cfg in config.loss_heads:
            if not head_cfg.enabled:
                continue
            name = head_cfg.name
            train_key_loss = f"{name}_loss"
            val_key_loss = f"{name}_loss"
            val_key_acc = f"{name}_accuracy"
            if train_key_loss in train_metrics:
                emit_metric(f"train_{name}_loss", train_metrics[train_key_loss], epoch, config.epochs)
            if val_key_loss in val_metrics:
                emit_metric(f"val_{name}_loss", val_metrics[val_key_loss], epoch, config.epochs)
            if val_key_acc in val_metrics:
                emit_metric(f"val_{name}_accuracy", val_metrics[val_key_acc], epoch, config.epochs)

        # Build log line
        head_str = " ".join(
            f"{h.name}_acc={val_metrics.get(f'{h.name}_accuracy', 0.0):.4f}"
            for h in config.loss_heads if h.enabled
        )
        emit_log(
            f"Epoch {epoch}/{config.epochs}: "
            f"train_loss={train_metrics['loss']:.4f} val_loss={val_metrics['loss']:.4f} "
            f"{head_str} lr={current_lr:.2e} [{epoch_time:.1f}s]"
        )

        # Build epoch record
        epoch_record: dict = {
            "epoch": epoch,
            "train_loss": train_metrics["loss"],
            "val_loss": val_metrics["loss"],
            "learning_rate": current_lr,
            "epoch_time_sec": epoch_time,
        }
        for head_cfg in config.loss_heads:
            if not head_cfg.enabled:
                continue
            name = head_cfg.name
            epoch_record[f"train_{name}_loss"] = train_metrics.get(f"{name}_loss", 0.0)
            epoch_record[f"val_{name}_loss"] = val_metrics.get(f"{name}_loss", 0.0)
            epoch_record[f"val_{name}_accuracy"] = val_metrics.get(f"{name}_accuracy", 0.0)

        epoch_history.append(epoch_record)

        if on_epoch is not None:
            on_epoch(epoch_history, best_metrics)

        # Early stopping + checkpoint
        if val_metrics["loss"] < best_val_loss:
            best_val_loss = val_metrics["loss"]
            patience_counter = 0
            best_epoch = epoch
            best_metrics = epoch_record.copy()
            # Deep copy weights — restore at end
            best_weights = copy.deepcopy(model.state_dict())
            emit_log(f"  -> New best val_loss={best_val_loss:.4f}, weights saved")
        else:
            patience_counter += 1
            if patience_counter >= config.patience:
                emit_log(f"Early stopping at epoch {epoch} (patience={config.patience})")
                break

    # Restore best weights
    if best_weights is not None:
        model.load_state_dict(best_weights)
        emit_log(f"Restored best weights from epoch {best_epoch}")

    total_time_sec = time.time() - t_start
    return {
        "best_epoch": best_epoch,
        "best_val_loss": best_val_loss,
        "best_metrics": best_metrics,
        "epoch_history": epoch_history,
        "total_time_sec": total_time_sec,
    }
