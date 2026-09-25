"""PyTorch model families for the Model Cycle, all trained by ONE loop.

Families: multilayer_perceptron, lstm, temporal_convolution_network,
transformer_encoder. Built by `models.build_adapter`, which imports this
module lazily so a tree-only run never loads torch.

The loop (`NeuralAdapter.fit`):
  * the whole feature matrix is uploaded to the device once (float32); rows
    are gathered by index, a sequence sample for row t is rows t-L+1..t;
  * batches are CONTIGUOUS blocks of the chronologically sorted training
    index; only the order of the blocks is shuffled each epoch (seeded), so
    every batch report names one unbroken time span the chart can highlight;
  * BCEWithLogitsLoss with pos_weight = negatives / positives, AdamW,
    OneCycle learning rate stepped per batch, gradient clipping at 1.0 (the
    reported norm is the pre-clip norm), AMP on CUDA (bfloat16 when the GPU
    supports it, else float16 with a GradScaler);
  * after each epoch the validation index is scored in eval mode; early
    stopping on validation log loss with `patience`; the best weights are
    kept in memory and restored at the end.

Every network reads only the window it is given, and the sequence networks
are causal inside the window as well: position k of `sequence_output` never
depends on positions after k (causal left-padded convolutions, a causal
attention mask, a forward-only LSTM). The prediction head reads the last
position, which is the bar being predicted.
"""

from __future__ import annotations

# isort: off
import torch  # first: torch before numpy avoids a CUDA initialisation stall on Windows

# isort: on
import copy
import math
import os
import random
import time
from pathlib import Path

import numpy as np
import torch.nn.functional as functional
from torch import nn

from .adapter import SEQUENCE_FAMILIES, BatchReport, EpochReport, check_index
from .models import (
    _as_index,
    _base_metadata,
    _require_both_classes,
    _training_summary,
    binary_scores,
    resolve_parameters,
    write_metadata,
)

_PREDICTION_CHUNK_ROWS = 4096


# ─── networks ──────────────────────────────────────────────────────────────

class MultilayerPerceptron(nn.Module):
    """(Linear -> GELU -> Dropout) x layer_count -> Linear(1). Input (batch, features)."""

    def __init__(self, feature_count: int, hidden_size: int, layer_count: int, dropout: float):
        super().__init__()
        layers: list[nn.Module] = []
        width = feature_count
        for _ in range(layer_count):
            layers += [nn.Linear(width, hidden_size), nn.GELU(), nn.Dropout(dropout)]
            width = hidden_size
        self.body = nn.Sequential(*layers)
        self.head = nn.Linear(width, 1)

    def forward(self, rows: torch.Tensor) -> torch.Tensor:
        return self.head(self.body(rows)).squeeze(-1)


class LongShortTermMemoryNetwork(nn.Module):
    """Forward-only LSTM; the head reads the hidden state at the last bar."""

    def __init__(self, feature_count: int, hidden_size: int, layer_count: int, dropout: float):
        super().__init__()
        self.recurrent = nn.LSTM(
            feature_count, hidden_size, num_layers=layer_count, batch_first=True,
            dropout=dropout if layer_count > 1 else 0.0,
        )
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(hidden_size, 1)

    def sequence_output(self, window: torch.Tensor) -> torch.Tensor:
        output, _ = self.recurrent(window)
        return output

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        return self.head(self.dropout(self.sequence_output(window)[:, -1])).squeeze(-1)


class _CausalConvolutionBlock(nn.Module):
    """Two dilated convolutions, each left-padded by (kernel_size - 1) * dilation
    so output position k sees inputs <= k only, plus a residual connection."""

    def __init__(self, in_channels: int, out_channels: int, kernel_size: int, dilation: int,
                 dropout: float):
        super().__init__()
        self.padding = (kernel_size - 1) * dilation
        self.first = nn.Conv1d(in_channels, out_channels, kernel_size, dilation=dilation)
        self.second = nn.Conv1d(out_channels, out_channels, kernel_size, dilation=dilation)
        self.dropout = nn.Dropout(dropout)
        self.residual = (
            nn.Conv1d(in_channels, out_channels, 1) if in_channels != out_channels else nn.Identity()
        )

    def forward(self, series: torch.Tensor) -> torch.Tensor:  # (batch, channels, length)
        hidden = self.dropout(functional.gelu(self.first(functional.pad(series, (self.padding, 0)))))
        hidden = self.dropout(functional.gelu(self.second(functional.pad(hidden, (self.padding, 0)))))
        return functional.gelu(hidden + self.residual(series))


class TemporalConvolutionNetwork(nn.Module):
    """Stack of causal dilated blocks, dilation 2^k; head on the last bar."""

    def __init__(self, feature_count: int, channel_count: int, kernel_size: int,
                 layer_count: int, dropout: float):
        super().__init__()
        blocks = []
        width = feature_count
        for level in range(layer_count):
            blocks.append(
                _CausalConvolutionBlock(width, channel_count, kernel_size, 2 ** level, dropout)
            )
            width = channel_count
        self.blocks = nn.Sequential(*blocks)
        self.head = nn.Linear(channel_count, 1)

    def sequence_output(self, window: torch.Tensor) -> torch.Tensor:
        return self.blocks(window.transpose(1, 2)).transpose(1, 2)

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        return self.head(self.sequence_output(window)[:, -1]).squeeze(-1)


class TransformerEncoderNetwork(nn.Module):
    """Linear projection + learned positions -> pre-norm transformer encoder
    with a causal attention mask -> head on the last token."""

    def __init__(self, feature_count: int, sequence_length: int, model_dimension: int,
                 head_count: int, layer_count: int, dropout: float):
        super().__init__()
        self.projection = nn.Linear(feature_count, model_dimension)
        self.position = nn.Parameter(torch.zeros(1, sequence_length, model_dimension))
        nn.init.normal_(self.position, std=0.02)
        layer = nn.TransformerEncoderLayer(
            model_dimension, head_count, dim_feedforward=4 * model_dimension, dropout=dropout,
            activation="gelu", batch_first=True, norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(
            layer, layer_count, norm=nn.LayerNorm(model_dimension), enable_nested_tensor=False,
        )
        self.register_buffer(
            "causal_mask",
            nn.Transformer.generate_square_subsequent_mask(sequence_length),
            persistent=False,
        )
        self.head = nn.Linear(model_dimension, 1)

    def sequence_output(self, window: torch.Tensor) -> torch.Tensor:
        length = window.shape[1]
        hidden = self.projection(window) + self.position[:, :length]
        mask = self.causal_mask[:length, :length]
        return self.encoder(hidden, mask=mask, is_causal=True)

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        return self.head(self.sequence_output(window)[:, -1]).squeeze(-1)


def build_network(family: str, parameters: dict, feature_count: int) -> nn.Module:
    p = parameters
    if family == "multilayer_perceptron":
        return MultilayerPerceptron(feature_count, p["hidden_size"], p["layer_count"], p["dropout"])
    if family == "lstm":
        return LongShortTermMemoryNetwork(
            feature_count, p["hidden_size"], p["layer_count"], p["dropout"]
        )
    if family == "temporal_convolution_network":
        return TemporalConvolutionNetwork(
            feature_count, p["channel_count"], p["kernel_size"], p["layer_count"], p["dropout"]
        )
    if family == "transformer_encoder":
        return TransformerEncoderNetwork(
            feature_count, p["sequence_length"], p["model_dimension"], p["head_count"],
            p["layer_count"], p["dropout"],
        )
    raise ValueError(f"not a neural family: {family!r}")


# ─── device / seeding ──────────────────────────────────────────────────────

def resolve_device(device: str) -> tuple[str, str | None]:
    """("cuda" | "cpu", note). "auto" picks CUDA when available; an explicit
    "cuda" without a GPU falls back to the CPU with a note."""
    available = torch.cuda.is_available()
    if device == "cuda" and not available:
        return "cpu", "CUDA was requested but no GPU is available; training on the CPU"
    if device in ("auto", "", None):
        return ("cuda" if available else "cpu"), None
    return ("cuda" if device == "cuda" else "cpu"), None


def _seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed % (2 ** 32))
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    # Full float32 precision outside autocast: single-row and batched predictions
    # of the same bar must agree, which TF32 convolutions do not guarantee.
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cuda.matmul.allow_tf32 = False


# ─── adapter ───────────────────────────────────────────────────────────────

class NeuralAdapter:
    """ModelAdapter for the four PyTorch families (see module docstring)."""

    step_unit = "epoch"

    def __init__(self, family: str, parameters: dict, device: str, seed: int) -> None:
        self.family = family
        self.parameters = resolve_parameters(family, parameters)
        self.device, device_note = resolve_device(device)
        self.seed = int(seed)
        self.notes: list[str] = [device_note] if device_note else []
        self.sequence_length = (
            int(self.parameters["sequence_length"]) if family in SEQUENCE_FAMILIES else 1
        )
        if family == "transformer_encoder":
            dimension = self.parameters["model_dimension"]
            heads = self.parameters["head_count"]
            if dimension % heads:
                rounded = int(math.ceil(dimension / heads) * heads)
                self.notes.append(
                    f"model_dimension {dimension} is not divisible by head_count {heads}; "
                    f"rounded up to {rounded}"
                )
                self.parameters["model_dimension"] = rounded
        self.network: nn.Module | None = None
        self.feature_count: int | None = None
        self.fit_summary: dict = {}
        self._offsets = np.arange(-self.sequence_length + 1, 1, dtype=np.int64)

    def minimum_history(self) -> int:
        return self.sequence_length

    # ── helpers ──

    def _check_history(self, index: np.ndarray, name: str) -> None:
        if index.size and int(index[0]) < self.sequence_length - 1:
            raise ValueError(
                f"{self.family}: {name} starts at row {int(index[0])} but a prediction needs "
                f"{self.sequence_length} rows of history (first usable row "
                f"{self.sequence_length - 1})"
            )

    def _gather_device(self, matrix: torch.Tensor, rows: torch.Tensor) -> torch.Tensor:
        if self.sequence_length == 1:
            return matrix[rows]
        offsets = torch.arange(-self.sequence_length + 1, 1, device=matrix.device)
        return matrix[rows[:, None] + offsets]

    def _gather_host(self, features: np.ndarray, index: np.ndarray) -> np.ndarray:
        if self.sequence_length == 1:
            return np.ascontiguousarray(features[index], dtype=np.float32)
        return np.ascontiguousarray(features[index[:, None] + self._offsets], dtype=np.float32)

    def _autocast(self):
        if self.device != "cuda":
            return torch.autocast(device_type="cpu", enabled=False)
        return torch.autocast(device_type="cuda", dtype=self._amp_dtype)

    # ── fit ──

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        reporter.step_unit = self.step_unit
        train_index = _as_index(train_index)
        validation_index = _as_index(validation_index)
        if train_index.size == 0:
            raise ValueError(f"{self.family}: the training index is empty")
        check_index(features, labels, train_index, "train_index")
        check_index(features, labels, validation_index, "validation_index")
        self._check_history(train_index, "train_index")
        self._check_history(validation_index, "validation_index")
        train_labels = labels[train_index]
        _require_both_classes(self.family, train_labels)
        for note in self.notes:
            reporter.log(note, "warn")

        _seed_everything(self.seed)
        p = self.parameters
        self.feature_count = int(features.shape[1])
        device = torch.device(self.device)
        network = build_network(self.family, p, self.feature_count).to(device)
        self.network = network

        use_amp = self.device == "cuda"
        self._amp_dtype = (
            torch.bfloat16 if use_amp and torch.cuda.is_bf16_supported() else torch.float16
        )
        scaler = (
            torch.amp.GradScaler("cuda") if use_amp and self._amp_dtype == torch.float16 else None
        )

        matrix = torch.from_numpy(np.ascontiguousarray(features, dtype=np.float32)).to(device)
        label_tensor = torch.from_numpy(
            np.nan_to_num(np.asarray(labels, dtype=np.float32), nan=-1.0)
        ).to(device)
        train_rows = torch.from_numpy(train_index).to(device)
        validation_rows = torch.from_numpy(validation_index).to(device)
        validation_labels = labels[validation_index].astype(np.float64)

        positives = float(np.sum(train_labels >= 0.5))
        negatives = float(train_labels.size - positives)
        positive_weight = negatives / positives
        loss_function = nn.BCEWithLogitsLoss(
            pos_weight=torch.tensor(positive_weight, dtype=torch.float32, device=device)
        )
        optimizer = torch.optim.AdamW(
            network.parameters(), lr=p["learning_rate"], weight_decay=p["weight_decay"]
        )
        batch_size = min(p["batch_size"], train_index.size)
        blocks = [
            (start, min(start + batch_size, train_index.size))
            for start in range(0, train_index.size, batch_size)
        ]
        batch_count = len(blocks)
        epoch_count = p["epochs"]
        scheduler = torch.optim.lr_scheduler.OneCycleLR(
            optimizer, max_lr=p["learning_rate"], total_steps=epoch_count * batch_count,
            pct_start=0.1,
        )
        block_order_generator = np.random.default_rng(self.seed)

        parameter_count = sum(t.numel() for t in network.parameters())
        precision = (
            f"automatic mixed precision {str(self._amp_dtype).removeprefix('torch.')}"
            + (" with gradient scaling" if scaler else "")
            if use_amp else "float32"
        )
        reporter.log(
            f"{self.family} on {self.device} ({precision}): {parameter_count:,} parameters, "
            f"sequence length {self.sequence_length}, {train_index.size} training rows in "
            f"{batch_count} contiguous blocks of up to {batch_size}, "
            f"{validation_index.size} validation rows, positive class weight {positive_weight:.3f}"
        )

        best_loss = math.inf
        best_epoch = 0
        best_state = None
        epochs_without_improvement = 0
        started = time.perf_counter()
        last_epoch = 0
        for epoch in range(1, epoch_count + 1):
            last_epoch = epoch
            reporter.checkpoint()
            reporter.epoch_started(epoch, epoch_count)
            network.train()
            loss_sum = 0.0
            norm_sum = 0.0
            norm_count = 0
            for batch_number, block in enumerate(block_order_generator.permutation(batch_count), 1):
                reporter.checkpoint()
                batch_started = time.perf_counter()
                start, end = blocks[int(block)]
                rows = train_rows[start:end]
                window = self._gather_device(matrix, rows)
                targets = label_tensor[rows]
                learning_rate = optimizer.param_groups[0]["lr"]
                optimizer.zero_grad(set_to_none=True)
                with self._autocast():
                    logits = network(window)
                loss = loss_function(logits.float(), targets)
                if scaler is not None:
                    scaler.scale(loss).backward()
                    scaler.unscale_(optimizer)
                    norm = torch.nn.utils.clip_grad_norm_(network.parameters(), 1.0)
                    scaler.step(optimizer)
                    scaler.update()
                else:
                    loss.backward()
                    norm = torch.nn.utils.clip_grad_norm_(network.parameters(), 1.0)
                    optimizer.step()
                scheduler.step()
                loss_value = float(loss.item())
                norm_value = float(norm.item())
                if not math.isfinite(norm_value):
                    norm_value_reported = None
                else:
                    norm_value_reported = norm_value
                    norm_sum += norm_value
                    norm_count += 1
                loss_sum += loss_value * (end - start)
                elapsed = max(time.perf_counter() - batch_started, 1e-9)
                reporter.batch(BatchReport(
                    epoch=epoch, epoch_count=epoch_count,
                    batch=batch_number, batch_count=batch_count,
                    span_start_index=int(train_index[start]),
                    span_end_index=int(train_index[end - 1]),
                    train_loss=loss_value if math.isfinite(loss_value) else None,
                    learning_rate=learning_rate,
                    gradient_norm=norm_value_reported,
                    samples_per_second=(end - start) / elapsed,
                ))
            train_loss = loss_sum / train_index.size

            scores = {"log_loss": None, "accuracy": None, "f1_score": None}
            if validation_index.size:
                reporter.checkpoint()
                reporter.validating(epoch, epoch_count)
                probability = self._score_device(matrix, validation_rows)
                scores = binary_scores(probability, validation_labels)
            validation_loss = scores["log_loss"]
            is_best = False
            if validation_loss is not None and validation_loss < best_loss:
                is_best = True
                best_loss = validation_loss
                best_epoch = epoch
                best_state = copy.deepcopy(network.state_dict())
                epochs_without_improvement = 0
            elif validation_loss is not None:
                epochs_without_improvement += 1
            stop_now = (
                validation_loss is not None and epochs_without_improvement >= p["patience"]
            )
            reporter.epoch_finished(EpochReport(
                epoch=epoch, epoch_count=epoch_count,
                train_loss=train_loss if math.isfinite(train_loss) else None,
                validation_loss=validation_loss,
                validation_accuracy=scores["accuracy"],
                validation_f1_score=scores["f1_score"],
                learning_rate=optimizer.param_groups[0]["lr"],
                gradient_norm=(norm_sum / norm_count) if norm_count else None,
                is_best=is_best,
                stopped_early=stop_now and epoch < epoch_count,
            ))
            if stop_now:
                if epoch < epoch_count:
                    reporter.log(
                        f"early stopping after epoch {epoch}: validation log loss has not "
                        f"improved for {p['patience']} epochs (best {best_loss:.4f} at epoch "
                        f"{best_epoch})"
                    )
                break

        if best_state is not None:
            network.load_state_dict(best_state)
            reporter.log(f"restored the weights of epoch {best_epoch} (lowest validation log loss)")
        else:
            best_epoch = last_epoch
        network.eval()
        del matrix, label_tensor, train_rows, validation_rows
        self.fit_summary = {
            **_training_summary(train_index, validation_index, timestamps),
            "trained_epochs": last_epoch,
            "best_epoch": best_epoch,
            "best_validation_loss": None if math.isinf(best_loss) else best_loss,
            "positive_class_weight": positive_weight,
            "parameter_count": parameter_count,
            "fit_seconds": time.perf_counter() - started,
        }

    def _score_device(self, matrix: torch.Tensor, rows: torch.Tensor) -> np.ndarray:
        """P(up) for rows already on the device (validation during fit). Runs in
        float32, like `predict_probability`, so both agree."""
        self.network.eval()
        outputs = []
        with torch.inference_mode():
            for start in range(0, rows.shape[0], _PREDICTION_CHUNK_ROWS):
                chunk = rows[start:start + _PREDICTION_CHUNK_ROWS]
                outputs.append(torch.sigmoid(self.network(self._gather_device(matrix, chunk))))
        self.network.train()
        return torch.cat(outputs).double().cpu().numpy()

    # ── predict ──

    def predict_probability(self, features, index):
        if self.network is None:
            raise RuntimeError(f"{self.family}: predict_probability called before fit")
        index = _as_index(index)
        if index.size == 0:
            return np.empty(0, dtype=np.float64)
        if int(index.min()) < self.sequence_length - 1:
            raise ValueError(
                f"{self.family}: row {int(index.min())} has fewer than {self.sequence_length} "
                "rows of history"
            )
        network = self.network
        network.eval()
        device = torch.device(self.device)
        outputs = []
        with torch.inference_mode():
            if index.size == 1:
                row = int(index[0])
                window = np.ascontiguousarray(
                    features[row - self.sequence_length + 1:row + 1], dtype=np.float32
                )
                if self.sequence_length == 1:
                    window = window.reshape(1, -1)
                else:
                    window = window[None]
                tensor = torch.from_numpy(window).to(device, non_blocking=False)
                outputs.append(torch.sigmoid(network(tensor)))
            else:
                for start in range(0, index.size, _PREDICTION_CHUNK_ROWS):
                    chunk = index[start:start + _PREDICTION_CHUNK_ROWS]
                    tensor = torch.from_numpy(self._gather_host(features, chunk)).to(device)
                    outputs.append(torch.sigmoid(network(tensor)))
        probability = torch.cat(outputs).double().cpu().numpy()
        return np.clip(probability, 0.0, 1.0)

    # ── save / load ──

    def save(self, directory: str) -> str:
        if self.network is None:
            raise RuntimeError(f"{self.family}: save called before fit")
        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "model.pt"
        temporary = folder / "model.pt.tmp"
        state = {
            "state_dict": {k: v.detach().cpu() for k, v in self.network.state_dict().items()},
            "family": self.family,
            "parameters": dict(self.parameters),
            "feature_count": self.feature_count,
            "sequence_length": self.sequence_length,
        }
        torch.save(state, temporary)
        os.replace(temporary, path)
        metadata = _base_metadata(
            self, path.name,
            {"torch": torch.__version__, "cuda": str(torch.version.cuda)},
        )
        metadata["sequence_length"] = self.sequence_length
        write_metadata(folder, metadata)
        return str(path)

    @classmethod
    def load(cls, directory: str, device: str = "cpu") -> NeuralAdapter:
        state = torch.load(Path(directory) / "model.pt", map_location="cpu", weights_only=True)
        adapter = cls(state["family"], state["parameters"], device, 0)
        adapter.feature_count = int(state["feature_count"])
        network = build_network(adapter.family, adapter.parameters, adapter.feature_count)
        network.load_state_dict(state["state_dict"])
        adapter.network = network.to(torch.device(adapter.device)).eval()
        return adapter
