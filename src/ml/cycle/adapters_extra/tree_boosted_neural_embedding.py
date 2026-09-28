"""Tree-boosted neural embedding behind the Model Cycle's `ModelAdapter` contract.

Catalog spec: Hybrid and composite architectures / Composite controllers /
Tree-Boosted Neural Embedding (He et al. 2014 leaf features; Ke et al. 2019
DeepGBM; Guo and Berkhahn 2016 entity embeddings). Built by
``models.build_adapter`` for the registry entry with ``adapter ==
"tree_boosted_neural_embedding"`` through the registry constructor
``TreeBoostedNeuralEmbeddingAdapter(key, entry, parameters, device, seed, task=task)``.

Two stages, fitted in that order on the TRAINING rows only:

1. **Trees.** A LightGBM ensemble of ``tree_count`` trees, each at most
   ``max_depth`` deep (``2 ** max_depth`` leaves), shrinkage
   ``tree_learning_rate``, at least 20 training bars per leaf; the binary
   objective for the direction model, squared error on the training target
   clipped at its TRAINING 1st / 99th percentiles for the price model (the
   Cycle's convention for every tree price model). The trees see the raw
   causal features (splits are invariant to scale) and are frozen after this
   fit: no early stopping, no validation row moves a leaf boundary.
2. **Embedding and head.** Every tree maps a row to the index of the leaf it
   reaches; each (tree, leaf) pair owns a row of one embedding table (one table
   per tree, laid end to end) and the ``tree_count`` looked-up vectors are
   SUMMED into one ``embedding_size`` vector, the "market bucket" the row sits
   in. The continuous path standardises the same features with the training
   rows' mean and deviation and projects them to ``embedding_size``; the two
   are added and a one-hidden-layer perceptron (``hidden_size``, GELU,
   ``dropout``) reads the sum. Trained with the same loop as
   ``cycle.networks.NeuralAdapter``: contiguous chronological blocks of
   ``batch_size`` rows in a seeded shuffled order, AdamW with a one-cycle
   learning rate, gradient clipping at 1.0, BCEWithLogitsLoss with the
   negatives / positives class weight (direction) or Huber loss with delta 1.0
   on the raw target (price), validation scored after every epoch, early
   stopping after ``patience`` flat epochs on the validation log loss (Huber
   loss for the price model), the best epoch's weights restored.

Two details from the spec's training methodology are kept: the embedding
tables start small (normal, standard deviation 0.01) so the head begins near
the continuous-feature-only solution, and they receive NO weight decay
(decaying a sparse lookup table punishes leaves that fired a handful of times).
The head's output bias is warm-started at the ensemble's own constant estimate
(the training base-rate log-odds, or the mean of the clipped target).

Causality: a tabular model; the prediction for bar t reads feature row t only
(its leaf indices, its standardised features). ``minimum_history()`` is 1.

``save`` writes ``trees.txt`` (the LightGBM model), ``head.pt`` (the torch
state, the standardisation vectors and the sizes) and ``model.json``;
``load(directory, metadata, device)`` rebuilds both and predicts the same.
Attributes the explainer reads (``explainKind: opaque``, so only the shared
part): ``.parameters``, ``.step_unit``, ``.task``, ``.fit_summary``,
``.best_iteration`` (the epoch whose head weights were kept), ``.booster``
(the fitted LightGBM model) and ``.network`` (the fitted torch module).
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
    clip_training_target,
    huber_loss,
    regression_scores,
    write_metadata,
)

ADAPTER = "tree_boosted_neural_embedding"
TREE_FILE = "trees.txt"
HEAD_FILE = "head.pt"
MINIMUM_BARS_PER_LEAF = 20
EMBEDDING_INITIAL_STANDARD_DEVIATION = 0.01
HUBER_DELTA = 1.0
PREDICTION_CHUNK_ROWS = 4096
SMALL_BATCH_ROWS = 256
STANDARD_DEVIATION_FLOOR = 1e-12


class TreeBoostedNeuralEmbeddingNetwork(nn.Module):
    """Leaf embeddings (one table per tree, summed) + a projection of the
    standardised features -> one hidden layer -> one output.

    ``leaves`` is int64 (batch, tree_count), the leaf index each frozen tree
    assigns the row; ``features`` is float32 (batch, feature_count), already
    standardised. Output (batch,): the log-odds of up for the direction model,
    the target itself for the price model."""

    def __init__(self, tree_count: int, leaves_per_tree: int, feature_count: int,
                 embedding_size: int, hidden_size: int, dropout: float) -> None:
        super().__init__()
        self.tree_count = int(tree_count)
        self.leaves_per_tree = int(leaves_per_tree)
        self.leaf_embedding = nn.Embedding(self.tree_count * self.leaves_per_tree, int(embedding_size))
        nn.init.normal_(self.leaf_embedding.weight, std=EMBEDDING_INITIAL_STANDARD_DEVIATION)
        self.register_buffer(
            "tree_offsets", torch.arange(self.tree_count, dtype=torch.int64) * self.leaves_per_tree, persistent=False,
        )
        self.feature_projection = nn.Linear(int(feature_count), int(embedding_size))
        self.hidden = nn.Linear(int(embedding_size), int(hidden_size))
        self.activation = nn.GELU()
        self.dropout = nn.Dropout(float(dropout))
        self.head = nn.Linear(int(hidden_size), 1)

    def bucket_embedding(self, leaves: torch.Tensor) -> torch.Tensor:
        """The summed leaf embedding, (batch, embedding_size): the dense
        coordinate of the market bucket the row falls into."""
        return self.leaf_embedding(leaves + self.tree_offsets).sum(dim=1)

    def forward(self, leaves: torch.Tensor, features: torch.Tensor) -> torch.Tensor:
        fused = self.bucket_embedding(leaves) + self.feature_projection(features)
        return self.head(self.dropout(self.activation(self.hidden(fused)))).squeeze(-1)


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
    # single-row and batched predictions of the same bar must agree
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cuda.matmul.allow_tf32 = False


class TreeBoostedNeuralEmbeddingAdapter:
    available = True
    step_unit = "epoch"

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        if task not in MODEL_TASKS:
            raise ValueError(f"unknown task {task!r}; valid tasks: {', '.join(MODEL_TASKS)}")
        if entry["adapter"] != ADAPTER:
            raise ValueError(f"{key}: its registry adapter is {entry['adapter']!r}, not {ADAPTER!r}")
        self.role = "direction" if task == "classification" else "price"
        if (entry["direction"] if self.role == "direction" else entry["price"]) is None:
            raise ValueError(f"{entry['displayName']} ({key}) has no {self.role} model in the registry")
        self.key = key
        self.family = key
        self.entry = entry
        self.task = task
        self.parameters = dict(parameters)
        self.device, device_note = _resolve_device(device)
        self.notes: list[str] = [device_note] if device_note else []
        self.seed = int(seed)
        self.label = entry["displayName"]
        self.leaves_per_tree = int(2 ** int(self.parameters["max_depth"]))
        self.booster = None
        self.network: TreeBoostedNeuralEmbeddingNetwork | None = None
        self.feature_count: int | None = None
        self.tree_count_fitted: int | None = None
        self.feature_mean: np.ndarray | None = None
        self.feature_scale: np.ndarray | None = None
        self.target_clip: tuple[float, float] | None = None
        self.best_iteration: int | None = None
        self.fit_summary: dict = {}

    def minimum_history(self) -> int:
        return 1

    # ── stage 1: the trees ──

    def _fit_trees(self, train_matrix: np.ndarray, target: np.ndarray):
        import lightgbm as lgb

        p = self.parameters
        training_parameters = {
            "objective": "regression" if self.task == "regression" else "binary",
            "num_leaves": self.leaves_per_tree,
            "max_depth": int(p["max_depth"]),
            "learning_rate": float(p["tree_learning_rate"]),
            "min_child_samples": MINIMUM_BARS_PER_LEAF,
            "seed": self.seed,
            "deterministic": True,
            "force_col_wise": True,
            "verbosity": -1,
        }
        return lgb.train(
            training_parameters,
            lgb.Dataset(train_matrix, label=target, free_raw_data=False),
            num_boost_round=int(p["tree_count"]),
        )

    def _leaves(self, rows: np.ndarray) -> np.ndarray:
        """int64 (rows, tree_count_fitted): the leaf every frozen tree assigns each row."""
        threads = 1 if rows.shape[0] <= SMALL_BATCH_ROWS else 0
        leaves = self.booster.predict(rows, pred_leaf=True, num_threads=threads)
        leaves = np.asarray(leaves, dtype=np.int64).reshape(rows.shape[0], -1)
        if leaves.shape[1] != self.tree_count_fitted:
            raise RuntimeError(
                f"{self.key}: the trees returned {leaves.shape[1]} leaf indices per row, expected {self.tree_count_fitted}"
            )
        if leaves.size and (int(leaves.max()) >= self.leaves_per_tree or int(leaves.min()) < 0):
            raise RuntimeError(f"{self.key}: a leaf index is outside 0..{self.leaves_per_tree - 1}")
        return leaves

    def _standardise(self, rows: np.ndarray) -> np.ndarray:
        return np.ascontiguousarray((rows - self.feature_mean) / self.feature_scale, dtype=np.float32)

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
        train_labels = np.asarray(labels[train_index], dtype=np.float64)
        if regression:
            _require_varying_target(self.key, train_labels)
        else:
            _require_both_classes(self.key, train_labels)
        for note in self.notes:
            reporter.log(note, "warn")
        _seed_everything(self.seed)
        p = self.parameters
        self.feature_count = int(features.shape[1])
        started = time.perf_counter()
        train_matrix = np.ascontiguousarray(features[train_index], dtype=np.float32)
        validation_matrix = np.ascontiguousarray(features[validation_index], dtype=np.float32)
        has_validation = validation_index.size > 0

        # stage 1: the trees, on the training rows only, then frozen
        clip_summary: dict = {}
        if regression:
            tree_target, low, high = clip_training_target(train_labels)
            self.target_clip = (low, high)
            clip_summary = {"target_clip_low": low, "target_clip_high": high,
                            "clipped_train_row_count": int(np.sum(tree_target != train_labels))}
        else:
            tree_target = np.asarray(train_labels >= 0.5, dtype=np.float64)
        reporter.checkpoint()
        reporter.log(
            f"{self.label} stage 1: lightgbm {'squared error' if regression else 'binary log loss'} ensemble of "
            f"{int(p['tree_count'])} trees, depth <= {int(p['max_depth'])} ({self.leaves_per_tree} leaves each), "
            f"shrinkage {float(p['tree_learning_rate']):g}, at least {MINIMUM_BARS_PER_LEAF} bars per leaf, "
            f"on {train_index.size} training rows (raw features; validation rows never move a leaf boundary)"
        )
        if regression:
            reporter.log(
                f"{self.label} stage 1 price target clipped to [{low:.3f}, {high:.3f}] "
                f"({clip_summary['clipped_train_row_count']} rows moved); the head fits the raw target with Huber loss"
            )
        stage_one_started = time.perf_counter()
        self.booster = self._fit_trees(train_matrix, tree_target)
        self.tree_count_fitted = int(self.booster.num_trees())
        stage_one_seconds = time.perf_counter() - stage_one_started
        reporter.checkpoint()
        if self.tree_count_fitted < int(p["tree_count"]):
            reporter.log(
                f"{self.label} stage 1: lightgbm stopped at {self.tree_count_fitted} of {int(p['tree_count'])} trees "
                "(no further split met the leaf requirements)", "warn",
            )
        train_leaves = self._leaves(train_matrix)
        validation_leaves = (self._leaves(validation_matrix) if has_validation
                             else np.empty((0, self.tree_count_fitted), dtype=np.int64))
        used_rows = int(np.unique(train_leaves + np.arange(self.tree_count_fitted) * self.leaves_per_tree).size)
        reporter.log(
            f"{self.label} stage 1 done in {stage_one_seconds:.1f} s: {self.tree_count_fitted} trees frozen; leaf "
            f"index matrix ({train_index.size}, {self.tree_count_fitted}) precomputed, {used_rows} of "
            f"{self.tree_count_fitted * self.leaves_per_tree} embedding rows reached by a training bar"
        )

        # the continuous path: standardised with the training rows' mean and deviation
        mean = train_matrix.astype(np.float64).mean(axis=0)
        deviation = train_matrix.astype(np.float64).std(axis=0)
        self.feature_mean = mean.astype(np.float32)
        self.feature_scale = np.where(deviation > STANDARD_DEVIATION_FLOOR, deviation, 1.0).astype(np.float32)

        # stage 2: the embedding tables and the head
        device = torch.device(self.device)
        network = TreeBoostedNeuralEmbeddingNetwork(
            self.tree_count_fitted, self.leaves_per_tree, self.feature_count,
            int(p["embedding_size"]), int(p["hidden_size"]), float(p["dropout"]),
        ).to(device)
        if regression:
            positive_weight = None
            warm_start = float(np.mean(tree_target))
            loss_function = nn.HuberLoss(delta=HUBER_DELTA)
        else:
            positives = float(np.sum(train_labels >= 0.5))
            negatives = float(train_labels.size - positives)
            positive_weight = negatives / positives
            rate = positives / train_labels.size
            warm_start = math.log(rate / (1.0 - rate))
            loss_function = nn.BCEWithLogitsLoss(
                pos_weight=torch.tensor(positive_weight, dtype=torch.float32, device=device)
            )
        with torch.no_grad():
            network.head.bias.fill_(warm_start)
        self.network = network

        leaf_tensor = torch.from_numpy(train_leaves).to(device)
        feature_tensor = torch.from_numpy(self._standardise(train_matrix)).to(device)
        target_tensor = torch.from_numpy(train_labels.astype(np.float32)).to(device)
        validation_leaf_tensor = torch.from_numpy(validation_leaves).to(device)
        validation_feature_tensor = torch.from_numpy(self._standardise(validation_matrix)).to(device)
        validation_labels = np.asarray(labels[validation_index], dtype=np.float64)

        embedding_parameters = list(network.leaf_embedding.parameters())
        embedding_ids = {id(parameter) for parameter in embedding_parameters}
        other_parameters = [parameter for parameter in network.parameters() if id(parameter) not in embedding_ids]
        optimizer = torch.optim.AdamW(
            [
                {"params": embedding_parameters, "weight_decay": 0.0},
                {"params": other_parameters, "weight_decay": float(p["weight_decay"])},
            ],
            lr=float(p["learning_rate"]),
        )
        batch_size = min(int(p["batch_size"]), train_index.size)
        blocks = [(start, min(start + batch_size, train_index.size)) for start in range(0, train_index.size, batch_size)]
        batch_count = len(blocks)
        epoch_count = int(p["epochs"])
        scheduler = torch.optim.lr_scheduler.OneCycleLR(
            optimizer, max_lr=float(p["learning_rate"]), total_steps=epoch_count * batch_count, pct_start=0.1,
        )
        block_order_generator = np.random.default_rng(self.seed)
        parameter_count = sum(parameter.numel() for parameter in network.parameters())
        objective = (
            f"Huber loss (delta {HUBER_DELTA:g}) on the price target, early stopping on validation Huber loss, "
            "losses reported as mean absolute error"
            if regression else f"positive class weight {positive_weight:.3f}"
        )
        reporter.log(
            f"{self.label} stage 2 on {self.device} (float32): {parameter_count:,} parameters "
            f"({self.tree_count_fitted * self.leaves_per_tree} x {int(p['embedding_size'])} embedding table, no weight "
            f"decay on it; head bias warm-started at {warm_start:.3f}), {train_index.size} training rows in "
            f"{batch_count} contiguous blocks of up to {batch_size}, {validation_index.size} validation rows, {objective}"
        )
        selection_name = "Huber loss" if regression else "log loss"

        best_loss = math.inf
        best_epoch = 0
        best_state = None
        best_reported_loss = None
        epochs_without_improvement = 0
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
                learning_rate = optimizer.param_groups[0]["lr"]
                optimizer.zero_grad(set_to_none=True)
                logits = network(leaf_tensor[start:end], feature_tensor[start:end])
                targets = target_tensor[start:end]
                loss = loss_function(logits.float(), targets)
                loss.backward()
                norm = torch.nn.utils.clip_grad_norm_(network.parameters(), 1.0)
                optimizer.step()
                scheduler.step()
                if regression:
                    loss_value = float((logits.detach().float() - targets).abs().mean().item())
                else:
                    loss_value = float(loss.item())
                norm_value = float(norm.item())
                norm_reported = None
                if math.isfinite(norm_value):
                    norm_reported = norm_value
                    norm_sum += norm_value
                    norm_count += 1
                loss_sum += loss_value * (end - start)
                elapsed = max(time.perf_counter() - batch_started, 1e-9)
                reporter.batch(BatchReport(
                    epoch=epoch, epoch_count=epoch_count, batch=batch_number, batch_count=batch_count,
                    span_start_index=int(train_index[start]), span_end_index=int(train_index[end - 1]),
                    train_loss=loss_value if math.isfinite(loss_value) else None,
                    learning_rate=learning_rate, gradient_norm=norm_reported,
                    samples_per_second=(end - start) / elapsed,
                ))
            train_loss = loss_sum / train_index.size

            scores = {"loss": None, "accuracy": None, "f1_score": None}
            selection_loss = None
            if has_validation:
                reporter.checkpoint()
                reporter.validating(epoch, epoch_count)
                prediction = self._score_tensors(validation_leaf_tensor, validation_feature_tensor)
                if regression:
                    regression_score = regression_scores(prediction, validation_labels)
                    scores = {"loss": regression_score["mean_absolute_error"],
                              "accuracy": regression_score["accuracy"], "f1_score": None}
                    selection_loss = huber_loss(prediction, validation_labels, HUBER_DELTA)
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
                best_epoch = epoch
                best_state = copy.deepcopy(network.state_dict())
                epochs_without_improvement = 0
            elif selection_loss is not None:
                epochs_without_improvement += 1
            stop_now = selection_loss is not None and epochs_without_improvement >= int(p["patience"])
            reporter.epoch_finished(EpochReport(
                epoch=epoch, epoch_count=epoch_count,
                train_loss=train_loss if math.isfinite(train_loss) else None,
                validation_loss=scores["loss"], validation_accuracy=scores["accuracy"],
                validation_f1_score=scores["f1_score"],
                learning_rate=optimizer.param_groups[0]["lr"],
                gradient_norm=(norm_sum / norm_count) if norm_count else None,
                is_best=is_best, stopped_early=stop_now and epoch < epoch_count,
            ))
            if stop_now:
                if epoch < epoch_count:
                    reporter.log(
                        f"early stopping after epoch {epoch}: validation {selection_name} has not improved for "
                        f"{int(p['patience'])} epochs (best {best_loss:.4f} at epoch {best_epoch})"
                    )
                break

        if best_state is not None:
            network.load_state_dict(best_state)
            reporter.log(f"restored the head weights of epoch {best_epoch} (lowest validation {selection_name})")
        else:
            best_epoch = last_epoch
        network.eval()
        del leaf_tensor, feature_tensor, target_tensor, validation_leaf_tensor, validation_feature_tensor
        summary = {
            **_training_summary(train_index, validation_index, timestamps),
            **clip_summary,
            "tree_count_fitted": self.tree_count_fitted,
            "leaves_per_tree": self.leaves_per_tree,
            "embedding_row_count": self.tree_count_fitted * self.leaves_per_tree,
            "embedding_rows_reached_by_training": used_rows,
            "stage_one_seconds": stage_one_seconds,
            "trained_epochs": last_epoch,
            "best_epoch": best_epoch,
            "parameter_count": parameter_count,
        }
        if regression:
            summary["loss_function"] = f"huber (delta {HUBER_DELTA:g})"
            summary["best_validation_huber_loss"] = None if math.isinf(best_loss) else best_loss
            summary["best_validation_loss"] = best_reported_loss   # mean absolute error
        else:
            summary["best_validation_loss"] = None if math.isinf(best_loss) else best_loss
            summary["positive_class_weight"] = positive_weight
        summary["fit_seconds"] = time.perf_counter() - started
        self.fit_summary = summary
        self.best_iteration = best_epoch

    # ── predict ──

    def _output(self, raw: torch.Tensor) -> torch.Tensor:
        return raw if self.task == "regression" else torch.sigmoid(raw)

    def _score_tensors(self, leaves: torch.Tensor, standardised: torch.Tensor) -> np.ndarray:
        """The task's prediction for rows already on the device (validation
        during fit), in float32 like ``predict_*`` so both agree."""
        self.network.eval()
        outputs = []
        with torch.inference_mode():
            for start in range(0, leaves.shape[0], PREDICTION_CHUNK_ROWS):
                stop = start + PREDICTION_CHUNK_ROWS
                outputs.append(self._output(self.network(leaves[start:stop], standardised[start:stop])))
        self.network.train()
        return torch.cat(outputs).double().cpu().numpy()

    def _predict(self, features, index, method: str) -> np.ndarray:
        if self.network is None or self.booster is None:
            raise RuntimeError(f"{self.key}: {method} called before fit")
        index = _as_index(index)
        if index.size == 0:
            return np.empty(0, dtype=np.float64)
        rows = np.ascontiguousarray(features[index], dtype=np.float32)
        network = self.network
        network.eval()
        device = torch.device(self.device)
        outputs = []
        with torch.inference_mode():
            for start in range(0, rows.shape[0], PREDICTION_CHUNK_ROWS):
                chunk = rows[start:start + PREDICTION_CHUNK_ROWS]
                leaves = torch.from_numpy(self._leaves(chunk)).to(device)
                standardised = torch.from_numpy(self._standardise(chunk)).to(device)
                outputs.append(self._output(network(leaves, standardised)))
        return torch.cat(outputs).double().cpu().numpy()

    def predict_probability(self, features, index) -> np.ndarray:
        if self.task != "classification":
            raise _wrong_task_error(self.key, self.task, "predict_probability")
        return np.clip(self._predict(features, index, "predict_probability"), 0.0, 1.0)

    def predict_value(self, features, index) -> np.ndarray:
        if self.task != "regression":
            raise _wrong_task_error(self.key, self.task, "predict_value")
        return self._predict(features, index, "predict_value")

    def bucket_embedding(self, features, index) -> np.ndarray:
        """The summed leaf embedding of each row in ``index``, float64
        (rows, embedding_size): the spec's reusable dense coordinate of the
        market bucket (for clustering or nearest-neighbour retrieval)."""
        if self.network is None or self.booster is None:
            raise RuntimeError(f"{self.key}: bucket_embedding called before fit")
        rows = np.ascontiguousarray(features[_as_index(index)], dtype=np.float32)
        network = self.network
        network.eval()
        with torch.inference_mode():
            leaves = torch.from_numpy(self._leaves(rows)).to(torch.device(self.device))
            return network.bucket_embedding(leaves).double().cpu().numpy()

    # ── save / load ──

    def save(self, directory: str) -> str:
        import lightgbm as lgb

        if self.network is None or self.booster is None:
            raise RuntimeError(f"{self.key}: save called before fit")
        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        tree_path = folder / TREE_FILE
        temporary = folder / "trees.tmp.txt"
        self.booster.save_model(str(temporary))
        os.replace(temporary, tree_path)
        head_path = folder / HEAD_FILE
        temporary = folder / "head.pt.tmp"
        torch.save({
            "state_dict": {name: value.detach().cpu() for name, value in self.network.state_dict().items()},
            "feature_mean": torch.from_numpy(np.asarray(self.feature_mean, dtype=np.float32)),
            "feature_scale": torch.from_numpy(np.asarray(self.feature_scale, dtype=np.float32)),
            "key": self.key,
            "task": self.task,
            "parameters": dict(self.parameters),
            "feature_count": int(self.feature_count),
            "tree_count_fitted": int(self.tree_count_fitted),
            "leaves_per_tree": int(self.leaves_per_tree),
            "best_iteration": self.best_iteration,
        }, temporary)
        os.replace(temporary, head_path)
        metadata = _base_metadata(
            self, tree_path.name, {"lightgbm": lgb.__version__, "torch": torch.__version__, "cuda": str(torch.version.cuda)},
        )
        metadata["head_file"] = head_path.name
        metadata["best_iteration"] = self.best_iteration
        metadata["tree_count_fitted"] = self.tree_count_fitted
        metadata["leaves_per_tree"] = self.leaves_per_tree
        write_metadata(folder, metadata)
        return str(tree_path)

    @classmethod
    def load(cls, directory: str, metadata: dict, device: str = "cpu") -> TreeBoostedNeuralEmbeddingAdapter:
        import lightgbm as lgb

        key = metadata["key"]
        adapter = cls(key, catalog.entry(key), metadata["parameters"], device, metadata["seed"],
                      task=metadata.get("task", "classification"))
        folder = Path(directory)
        adapter.booster = lgb.Booster(model_file=str(folder / metadata["model_file"]))
        state = torch.load(folder / metadata.get("head_file", HEAD_FILE), map_location="cpu", weights_only=True)
        adapter.feature_count = int(state["feature_count"])
        adapter.tree_count_fitted = int(state["tree_count_fitted"])
        adapter.leaves_per_tree = int(state["leaves_per_tree"])
        if adapter.tree_count_fitted != int(adapter.booster.num_trees()):
            raise ValueError(
                f"{directory}: {TREE_FILE} holds {adapter.booster.num_trees()} trees but {HEAD_FILE} expects "
                f"{adapter.tree_count_fitted}"
            )
        adapter.feature_mean = state["feature_mean"].numpy().astype(np.float32)
        adapter.feature_scale = state["feature_scale"].numpy().astype(np.float32)
        adapter.best_iteration = state.get("best_iteration")
        p = adapter.parameters
        network = TreeBoostedNeuralEmbeddingNetwork(
            adapter.tree_count_fitted, adapter.leaves_per_tree, adapter.feature_count,
            int(p["embedding_size"]), int(p["hidden_size"]), float(p["dropout"]),
        )
        network.load_state_dict(state["state_dict"])
        adapter.network = network.to(torch.device(adapter.device)).eval()
        if "target_clip_low" in metadata and "target_clip_high" in metadata:
            adapter.target_clip = (float(metadata["target_clip_low"]), float(metadata["target_clip_high"]))
        return adapter


__all__ = ["TreeBoostedNeuralEmbeddingAdapter", "TreeBoostedNeuralEmbeddingNetwork"]
