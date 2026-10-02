"""Bayesian neural hybrid behind the Model Cycle's ``ModelAdapter`` contract.

Built by ``models.build_adapter`` for the registry entry with ``adapter ==
"bayesian_neural_hybrid"`` (``packages/config/cycle_models/bayesian_neural_hybrid.json``)
through the registry constructor
``BayesianNeuralHybridAdapter(key, entry, parameters, device, seed, task=task)``.

WHAT THIS IS, PLAINLY
---------------------
Monte Carlo dropout (Gal and Ghahramani, 2016, "Dropout as a Bayesian
approximation"): a multilayer perceptron trained with dropout whose dropout
stays ON at prediction time. ``sample_count`` stochastic forward passes are
run for every bar; their MEAN is the prediction (P(up) for the direction model,
the volatility-scaled forward move for the price model) and their STANDARD
DEVIATION is the epistemic (model) uncertainty. This is an APPROXIMATION to a
Bayesian neural network: the approximate posterior over the weights is the
Bernoulli distribution dropout induces, and each pass is one network sampled
from it. It is NOT variational inference over Gaussian weight distributions
(Blundell et al., 2015), NOT Markov chain Monte Carlo, and it models no
aleatoric (data) noise term. The Gaussian prior on the weights is expressed as
weight decay, the paper's reduction of the KL term to an L2 penalty, applied
here by AdamW as decoupled decay.

The sampled networks
--------------------
At prediction every pass applies one dropout mask per hidden layer to EVERY
row of the batch, which is exactly "sample one network from the approximate
posterior, evaluate it on the inputs". The ``sample_count`` mask sets are
drawn once, from a CPU generator seeded with the run's seed, and reused for
every prediction of the fitted model (and regenerated from the same seed on
``load``), so a bar's prediction does not depend on which other bars are in
the batch, one row at a time equals the batch, the validation scoring inside
``fit`` is the model's real prediction, and a reloaded model reproduces the
walk bit for bit. Training uses ordinary per-element dropout.

Training (the ``fit`` loop, written after ``networks.NeuralAdapter``'s)
------------------------------------------------------------------------
The feature matrix is uploaded to the device once; batches are contiguous
blocks of the chronologically sorted training index whose order is shuffled
each epoch (seeded), so every batch report names one unbroken span;
BCEWithLogitsLoss with ``pos_weight = negatives / positives`` for the direction
model, HuberLoss (delta 1.0) on the raw head for the price model; AdamW with
``weight_decay`` as the prior, OneCycle learning rate stepped per batch,
gradient clipping at 1.0 (the reported norm is the pre-clip norm), float32
throughout (no mixed precision: the network is small). After each epoch the
validation rows are scored with the sampled networks; early stopping on the
validation log loss (Huber loss for the price model) with ``patience``; the
best weights are restored. Nothing is fitted on validation or test rows.

Attributes: ``.network`` (the fitted module), ``.sample_count``,
``.last_uncertainty`` (float64, one standard deviation per row of the last
``predict_*`` call), ``.fit_summary`` (carries
``mean_validation_uncertainty`` at the kept epoch), ``.best_iteration`` (the
kept epoch), ``.parameters``, ``.step_unit``, ``.task``; ``predict_uncertainty``
returns the spread without the mean. The registry marks this model
``explainKind: opaque``: there is no "Inside the model" trace for it.
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

from .. import catalog
from ..adapter import MODEL_TASKS, BatchReport, EpochReport, check_index
from ..models import (
    _as_index,
    _base_metadata,
    _require_both_classes,
    _require_varying_target,
    _training_summary,
    _wrong_task_error,
    binary_scores,
    huber_loss,
    regression_scores,
    write_metadata,
)

ADAPTER = "bayesian_neural_hybrid"
MODEL_FILE = "model.pt"
NETWORK_KIND = "monte_carlo_dropout_perceptron"
_HUBER_DELTA = 1.0
_GRADIENT_CLIP = 1.0
_PREDICTION_CHUNK_ROWS = 4096


# ─── network ────────────────────────────────────────────────────────────────


class MonteCarloDropoutPerceptron(nn.Module):
    """(Linear -> GELU -> dropout) x layer_count -> Linear(1). Input (batch, features).

    ``forward(rows)`` applies ordinary per-element dropout, ALWAYS (training
    and prediction alike: that is Monte Carlo dropout). ``forward(rows, masks)``
    applies the given mask per hidden layer instead, one mask broadcast over
    the batch, i.e. one sampled network; ``sample_masks`` draws such a set."""

    def __init__(self, feature_count: int, hidden_size: int, layer_count: int, dropout: float) -> None:
        super().__init__()
        if not 0.0 < dropout < 1.0:
            raise ValueError(f"Monte Carlo dropout needs 0 < dropout < 1, got {dropout!r}")
        self.dropout = float(dropout)
        layers: list[nn.Module] = []
        width = feature_count
        for _ in range(layer_count):
            layers.append(nn.Linear(width, hidden_size))
            width = hidden_size
        self.hidden = nn.ModuleList(layers)
        self.head = nn.Linear(width, 1)

    def sample_masks(self, generator: torch.Generator, device: torch.device) -> list[torch.Tensor]:
        """One inverted-dropout mask per hidden layer, shape (1, units), drawn on the CPU
        generator (so the draw is the same on every device) and moved to ``device``."""
        keep = 1.0 - self.dropout
        masks = []
        for layer in self.hidden:
            drawn = torch.rand(1, layer.out_features, generator=generator) < keep
            masks.append((drawn.to(torch.float32) / keep).to(device))
        return masks

    def forward(self, rows: torch.Tensor, masks: list[torch.Tensor] | None = None) -> torch.Tensor:
        hidden = rows
        for number, layer in enumerate(self.hidden):
            hidden = functional.gelu(layer(hidden))
            if masks is None:
                hidden = functional.dropout(hidden, self.dropout, training=True)
            else:
                hidden = hidden * masks[number]
        return self.head(hidden).squeeze(-1)


# ─── device / seeding ───────────────────────────────────────────────────────


def _resolve_device(device: str) -> tuple[str, str | None]:
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
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cuda.matmul.allow_tf32 = False


# ─── adapter ────────────────────────────────────────────────────────────────


class BayesianNeuralHybridAdapter:
    """ModelAdapter for the Monte Carlo dropout perceptron (see module docstring)."""

    available = True
    step_unit = "epoch"

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        if task not in MODEL_TASKS:
            raise ValueError(f"unknown task {task!r}; valid tasks: {', '.join(MODEL_TASKS)}")
        if not isinstance(entry, dict) or entry.get("adapter") != ADAPTER:
            raise ValueError(f"{key}: its registry adapter is {(entry or {}).get('adapter')!r}, not {ADAPTER!r}")
        self.role = "direction" if task == "classification" else "price"
        if (entry["direction"] if self.role == "direction" else entry["price"]) is None:
            raise ValueError(f"{entry['displayName']} ({key}) has no {self.role} model in the registry")
        self.key = key
        self.family = key
        self.entry = entry
        self.task = task
        self.label = entry["displayName"]
        self.parameters = catalog.resolve_parameters(key, parameters)
        self.device, device_note = _resolve_device(device)
        self.seed = int(seed)
        self.notes: list[str] = [device_note] if device_note else []
        self.sample_count = int(self.parameters["sample_count"])
        if self.sample_count < 1:
            raise ValueError(f"{key}: sample_count must be at least 1, got {self.sample_count}")
        if not 0.0 < float(self.parameters["dropout"]) < 1.0:
            raise ValueError(f"{key}: Monte Carlo dropout needs 0 < dropout < 1, got {self.parameters['dropout']!r}")
        self.network: MonteCarloDropoutPerceptron | None = None
        self.feature_count: int | None = None
        self.best_iteration: int | None = None
        self.fit_summary: dict = {}
        self.last_uncertainty: np.ndarray | None = None
        self._masks: list[list[torch.Tensor]] | None = None

    def minimum_history(self) -> int:
        return 1

    # ── the sampled networks ──

    def _sampled_masks(self) -> list[list[torch.Tensor]]:
        """The ``sample_count`` mask sets, drawn once per fitted / loaded network."""
        if self._masks is None:
            if self.network is None:
                raise RuntimeError(f"{self.key}: no network to sample from")
            generator = torch.Generator().manual_seed(self.seed)
            device = torch.device(self.device)
            self._masks = [self.network.sample_masks(generator, device) for _ in range(self.sample_count)]
        return self._masks

    def _output(self, raw: torch.Tensor) -> torch.Tensor:
        return raw if self.task == "regression" else torch.sigmoid(raw)

    def _sample_tensor(self, rows: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """Mean and standard deviation (population, over the sampled networks) of
        the task's output for ``rows`` already on the device; float64."""
        network = self.network
        outputs = torch.stack([self._output(network(rows, masks)).double() for masks in self._sampled_masks()])
        return outputs.mean(dim=0), outputs.std(dim=0, unbiased=False)

    def _score_device(self, matrix: torch.Tensor, rows: torch.Tensor) -> tuple[np.ndarray, np.ndarray]:
        """Prediction and uncertainty for rows already on the device (validation during fit)."""
        self.network.eval()
        means, spreads = [], []
        with torch.inference_mode():
            for start in range(0, rows.shape[0], _PREDICTION_CHUNK_ROWS):
                chunk = rows[start:start + _PREDICTION_CHUNK_ROWS]
                mean, spread = self._sample_tensor(matrix[chunk])
                means.append(mean)
                spreads.append(spread)
        self.network.train()
        return torch.cat(means).cpu().numpy(), torch.cat(spreads).cpu().numpy()

    # ── fit ──

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        reporter.step_unit = self.step_unit
        regression = self.task == "regression"
        train_index = _as_index(train_index)
        validation_index = _as_index(validation_index)
        if train_index.size == 0:
            raise ValueError(f"{self.key}: the training index is empty")
        check_index(features, labels, train_index, "train_index")
        check_index(features, labels, validation_index, "validation_index")
        train_labels = labels[train_index]
        if regression:
            _require_varying_target(self.key, train_labels.astype(np.float64))
        else:
            _require_both_classes(self.key, train_labels)
        for note in self.notes:
            reporter.log(note, "warn")

        _seed_everything(self.seed)
        p = self.parameters
        self.feature_count = int(features.shape[1])
        device = torch.device(self.device)
        network = MonteCarloDropoutPerceptron(
            self.feature_count, int(p["hidden_size"]), int(p["layer_count"]), float(p["dropout"])
        ).to(device)
        self.network = network
        self._masks = None
        self.last_uncertainty = None

        matrix = torch.from_numpy(np.ascontiguousarray(features, dtype=np.float32)).to(device)
        label_tensor = torch.from_numpy(
            np.nan_to_num(np.asarray(labels, dtype=np.float32), nan=0.0 if regression else -1.0)
        ).to(device)
        train_rows = torch.from_numpy(train_index).to(device)
        validation_rows = torch.from_numpy(validation_index).to(device)
        validation_labels = labels[validation_index].astype(np.float64)

        if regression:
            positive_weight = None
            loss_function = nn.HuberLoss(delta=_HUBER_DELTA)
        else:
            positives = float(np.sum(train_labels >= 0.5))
            negatives = float(train_labels.size - positives)
            positive_weight = negatives / positives
            loss_function = nn.BCEWithLogitsLoss(
                pos_weight=torch.tensor(positive_weight, dtype=torch.float32, device=device)
            )
        optimizer = torch.optim.AdamW(
            network.parameters(), lr=float(p["learning_rate"]), weight_decay=float(p["weight_decay"])
        )
        batch_size = min(int(p["batch_size"]), train_index.size)
        blocks = [
            (start, min(start + batch_size, train_index.size))
            for start in range(0, train_index.size, batch_size)
        ]
        batch_count = len(blocks)
        epoch_count = int(p["epochs"])
        scheduler = torch.optim.lr_scheduler.OneCycleLR(
            optimizer, max_lr=float(p["learning_rate"]), total_steps=epoch_count * batch_count, pct_start=0.1,
        )
        block_order_generator = np.random.default_rng(self.seed)

        parameter_count = sum(t.numel() for t in network.parameters())
        objective = (
            f"Huber loss (delta {_HUBER_DELTA:g}) on the price target, early stopping on validation Huber "
            "loss of the sampled mean, losses reported as mean absolute error"
            if regression else f"positive class weight {positive_weight:.3f}, early stopping on validation log loss"
        )
        reporter.log(
            f"{self.label} on {self.device} (float32): Monte Carlo dropout perceptron, {parameter_count:,} parameters, "
            f"{int(p['layer_count'])} hidden layer(s) of {int(p['hidden_size'])}, dropout {float(p['dropout']):g} kept on "
            f"at prediction, {self.sample_count} sampled networks per prediction, weight decay {float(p['weight_decay']):g} "
            f"as the Gaussian prior; {train_index.size} training rows in {batch_count} contiguous blocks of up to "
            f"{batch_size}, {validation_index.size} validation rows, {objective}"
        )
        selection_name = "Huber loss" if regression else "log loss"

        best_loss = math.inf
        best_epoch = 0
        best_state = None
        best_reported_loss = None
        best_uncertainty: float | None = None
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
                targets = label_tensor[rows]
                learning_rate = optimizer.param_groups[0]["lr"]
                optimizer.zero_grad(set_to_none=True)
                logits = network(matrix[rows])
                loss = loss_function(logits.float(), targets)
                loss.backward()
                norm = torch.nn.utils.clip_grad_norm_(network.parameters(), _GRADIENT_CLIP)
                optimizer.step()
                scheduler.step()
                if regression:
                    loss_value = float((logits.detach().float() - targets).abs().mean().item())
                else:
                    loss_value = float(loss.item())
                norm_value = float(norm.item())
                if math.isfinite(norm_value):
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
                    gradient_norm=norm_value if math.isfinite(norm_value) else None,
                    samples_per_second=(end - start) / elapsed,
                ))
            train_loss = loss_sum / train_index.size

            scores = {"loss": None, "accuracy": None, "f1_score": None}
            selection_loss = None
            uncertainty = None
            if validation_index.size:
                reporter.checkpoint()
                reporter.validating(epoch, epoch_count)
                prediction, spread = self._score_device(matrix, validation_rows)
                uncertainty = float(np.mean(spread))
                if regression:
                    regression_score = regression_scores(prediction, validation_labels)
                    scores = {"loss": regression_score["mean_absolute_error"],
                              "accuracy": regression_score["accuracy"], "f1_score": None}
                    selection_loss = huber_loss(prediction, validation_labels, _HUBER_DELTA)
                else:
                    binary = binary_scores(prediction, validation_labels)
                    scores = {"loss": binary["log_loss"], "accuracy": binary["accuracy"],
                              "f1_score": binary["f1_score"]}
                    selection_loss = binary["log_loss"]
            is_best = False
            if selection_loss is not None and selection_loss < best_loss:
                is_best = True
                best_loss = selection_loss
                best_reported_loss = scores["loss"]
                best_uncertainty = uncertainty
                best_epoch = epoch
                best_state = copy.deepcopy(network.state_dict())
                epochs_without_improvement = 0
            elif selection_loss is not None:
                epochs_without_improvement += 1
            stop_now = selection_loss is not None and epochs_without_improvement >= int(p["patience"])
            reporter.epoch_finished(EpochReport(
                epoch=epoch, epoch_count=epoch_count,
                train_loss=train_loss if math.isfinite(train_loss) else None,
                validation_loss=scores["loss"],
                validation_accuracy=scores["accuracy"],
                validation_f1_score=scores["f1_score"],
                learning_rate=optimizer.param_groups[0]["lr"],
                gradient_norm=(norm_sum / norm_count) if norm_count else None,
                is_best=is_best,
                stopped_early=stop_now and epoch < epoch_count,
            ))
            if uncertainty is not None:
                reporter.log(
                    f"epoch {epoch}: mean validation uncertainty {uncertainty:.4f} "
                    f"(standard deviation over {self.sample_count} sampled networks)"
                )
            if stop_now:
                if epoch < epoch_count:
                    reporter.log(
                        f"early stopping after epoch {epoch}: validation {selection_name} has not improved "
                        f"for {int(p['patience'])} epochs (best {best_loss:.4f} at epoch {best_epoch})"
                    )
                break

        if best_state is not None:
            network.load_state_dict(best_state)
            reporter.log(f"restored the weights of epoch {best_epoch} (lowest validation {selection_name})")
        else:
            best_epoch = last_epoch
        network.eval()
        del matrix, label_tensor, train_rows, validation_rows
        summary = {
            **_training_summary(train_index, validation_index, timestamps),
            "trained_epochs": last_epoch,
            "best_epoch": best_epoch,
            "sample_count": self.sample_count,
            "mean_validation_uncertainty": best_uncertainty,
            "gaussian_prior_weight_decay": float(p["weight_decay"]),
        }
        if regression:
            summary["loss_function"] = f"huber (delta {_HUBER_DELTA:g})"
            summary["best_validation_huber_loss"] = None if math.isinf(best_loss) else best_loss
            summary["best_validation_loss"] = best_reported_loss  # mean absolute error
        else:
            summary["best_validation_loss"] = None if math.isinf(best_loss) else best_loss
            summary["positive_class_weight"] = positive_weight
        summary["parameter_count"] = parameter_count
        summary["fit_seconds"] = time.perf_counter() - started
        self.fit_summary = summary
        self.best_iteration = best_epoch

    # ── predict ──

    def _predict(self, features, index, method: str) -> tuple[np.ndarray, np.ndarray]:
        if self.network is None:
            raise RuntimeError(f"{self.key}: {method} called before fit")
        index = _as_index(index)
        if index.size == 0:
            empty = np.empty(0, dtype=np.float64)
            return empty, empty.copy()
        if self.feature_count is not None and int(features.shape[1]) != self.feature_count:
            raise ValueError(
                f"{self.key}: {method} got {int(features.shape[1])} features, the model was fitted on {self.feature_count}"
            )
        network = self.network
        network.eval()
        device = torch.device(self.device)
        means, spreads = [], []
        with torch.inference_mode():
            for start in range(0, index.size, _PREDICTION_CHUNK_ROWS):
                chunk = index[start:start + _PREDICTION_CHUNK_ROWS]
                rows = torch.from_numpy(np.ascontiguousarray(features[chunk], dtype=np.float32)).to(device)
                mean, spread = self._sample_tensor(rows)
                means.append(mean)
                spreads.append(spread)
        return torch.cat(means).cpu().numpy(), torch.cat(spreads).cpu().numpy()

    def predict_probability(self, features, index) -> np.ndarray:
        if self.task != "classification":
            raise _wrong_task_error(self.key, self.task, "predict_probability")
        mean, spread = self._predict(features, index, "predict_probability")
        self.last_uncertainty = spread
        return np.clip(mean, 0.0, 1.0)

    def predict_value(self, features, index) -> np.ndarray:
        if self.task != "regression":
            raise _wrong_task_error(self.key, self.task, "predict_value")
        mean, spread = self._predict(features, index, "predict_value")
        self.last_uncertainty = spread
        return mean

    def predict_uncertainty(self, features, index) -> np.ndarray:
        """The epistemic uncertainty alone: one standard deviation per row of
        ``index`` over the sampled networks (P(up) units for the direction
        model, target units for the price model)."""
        mean, spread = self._predict(features, index, "predict_uncertainty")
        self.last_uncertainty = spread
        return spread

    # ── save / load ──

    def save(self, directory: str) -> str:
        if self.network is None:
            raise RuntimeError(f"{self.key}: save called before fit")
        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / MODEL_FILE
        temporary = folder / (MODEL_FILE + ".tmp")
        state = {
            "state_dict": {name: value.detach().cpu() for name, value in self.network.state_dict().items()},
            "key": self.key,
            "family": self.family,
            "network": NETWORK_KIND,
            "task": self.task,
            "parameters": dict(self.parameters),
            "feature_count": self.feature_count,
            "seed": self.seed,
            "best_iteration": self.best_iteration,
        }
        torch.save(state, temporary)
        os.replace(temporary, path)
        metadata = _base_metadata(self, path.name, {"torch": torch.__version__, "cuda": str(torch.version.cuda)})
        metadata["network"] = NETWORK_KIND
        metadata["best_iteration"] = self.best_iteration
        write_metadata(folder, metadata)
        return str(path)

    @classmethod
    def load(cls, directory: str, device: str = "cpu", metadata: dict | None = None) -> BayesianNeuralHybridAdapter:
        """Rebuild a saved model from ``model.pt`` (its own key, parameters, seed
        and task, so a later registry edit cannot change it); the sampled
        networks are redrawn from the saved seed, so predictions are the same."""
        state = torch.load(Path(directory) / MODEL_FILE, map_location="cpu", weights_only=True)
        if state.get("network") != NETWORK_KIND:
            raise ValueError(f"{directory}: model.pt holds a {state.get('network')!r} network, not {NETWORK_KIND!r}")
        key = state.get("key", state.get("family"))
        adapter = cls(key, catalog.entry(key), state["parameters"], device, int(state.get("seed", 0)),
                      task=state.get("task", "classification"))
        adapter.feature_count = int(state["feature_count"])
        adapter.best_iteration = state.get("best_iteration")
        parameters = adapter.parameters
        network = MonteCarloDropoutPerceptron(
            adapter.feature_count, int(parameters["hidden_size"]), int(parameters["layer_count"]),
            float(parameters["dropout"]),
        )
        network.load_state_dict(state["state_dict"])
        adapter.network = network.to(torch.device(adapter.device)).eval()
        if metadata:
            adapter.fit_summary = {
                name: metadata[name]
                for name in ("fit_seconds", "best_validation_loss", "mean_validation_uncertainty", "best_epoch")
                if name in metadata
            }
        return adapter


__all__ = ["BayesianNeuralHybridAdapter", "MonteCarloDropoutPerceptron"]
