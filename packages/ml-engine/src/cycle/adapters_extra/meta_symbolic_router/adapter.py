"""``MetaSymbolicRouterAdapter``: episodic first-order meta-learning of the symbolic router.

The network is the ``meta_router`` integration of the ``neuro_symbolic`` kind:
K parametrised symbolic experts (one per rule group of the shared library,
``expert_parameters`` of shape (K, 3)) mixed by a router network's softmax
weights. NeuralAdapter trains every other kind on shuffled contiguous batches;
the spec asks for meta-learning, which that loop cannot express, so this
subclass replaces ``fit`` only:

1. **Episodes.** The chronologically sorted training rows are cut into
   consecutive blocks of ``episode_block_bars`` rows (at most half the span).
   Episode e pairs block e (the SUPPORT) with block e + 1 (the QUERY), keeping
   only the query rows after ``support[-1] + horizon``: every support label is
   realised before the first query bar, so the query is strictly after the
   support. Every row of both is a training row (the fit reads no validation
   or test label).
2. **Inner loop.** A copy of the expert parameters takes ``inner_step_count``
   plain gradient steps of ``inner_learning_rate`` on the support loss, with
   the router held fixed.
3. **Outer step (first-order MAML).** The query loss is evaluated with the
   ADAPTED experts and the live router; its gradient with respect to the
   router updates the router, and its gradient with respect to the adapted
   experts (the first-order approximation of the meta-gradient) updates the
   meta expert parameters. AdamW with ``learning_rate`` and ``weight_decay``,
   gradient clipping at 1.0.
4. **Epochs.** One epoch is every episode once, in a seeded order; after each
   the validation rows are scored with the META parameters (no adaptation),
   early stopping on validation log loss (Huber for the price model) with
   ``patience``, the best epoch's weights restored.

Prediction uses the meta-learned parameters frozen: no test-time adaptation,
so a bar's prediction never reads a label that is not realised. The loss is the
Cycle's (class-weighted binary cross-entropy for the direction, Huber on the
scaled move for the price), as in every NeuralAdapter kind.
"""

from __future__ import annotations

# isort: off
import torch  # first: torch before numpy avoids a CUDA initialisation stall on Windows

# isort: on
import copy
import math
import time

import numpy as np
from torch import nn

from cycle.adapter import BatchReport, EpochReport, check_index
from cycle.models import (
    _as_index,
    _require_both_classes,
    _require_varying_target,
    _training_summary,
    binary_scores,
    huber_loss,
    regression_scores,
)
from cycle.networks import _HUBER_DELTA, NeuralAdapter, _seed_everything, build_network


def make_episodes(train_index: np.ndarray, block_bars: int, horizon: int) -> list[tuple[np.ndarray, np.ndarray]]:
    """(support rows, query rows) per episode: consecutive blocks of the sorted
    training rows, the query kept only after ``support[-1] + horizon``."""
    rows = np.sort(np.asarray(train_index, dtype=np.int64).reshape(-1))
    if rows.size < 4:
        return []
    block = int(max(2, min(int(block_bars), rows.size // 2)))
    blocks = [rows[start:start + block] for start in range(0, rows.size, block)]
    episodes = []
    for support, query in zip(blocks[:-1], blocks[1:]):
        query = query[query > int(support[-1]) + int(horizon)]
        if support.size >= 2 and query.size >= 1:
            episodes.append((support, query))
    return episodes


class MetaSymbolicRouterAdapter(NeuralAdapter):
    """NeuralAdapter with the episodic meta-learning ``fit`` (see the module docstring)."""

    def __init__(self, key: str, *arguments, task: str = "classification") -> None:
        super().__init__(key, *arguments, task=task)
        if self.network_kind != "neuro_symbolic" or self.parameters.get("symbolic_integration") != "meta_router":
            raise ValueError(
                f"{key}: the meta_symbolic_router adapter trains the neuro_symbolic network's meta_router "
                f"integration, got network {self.network_kind!r} with "
                f"symbolic_integration {self.parameters.get('symbolic_integration')!r}"
            )

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        reporter.step_unit = self.step_unit
        regression = self.task == "regression"
        train_index = _as_index(train_index)
        validation_index = _as_index(validation_index)
        if train_index.size == 0:
            raise ValueError(f"{self.family}: the training index is empty")
        check_index(features, labels, train_index, "train_index")
        check_index(features, labels, validation_index, "validation_index")
        self._check_history(train_index, "train_index")
        self._check_history(validation_index, "validation_index")
        train_labels = labels[train_index]
        if regression:
            _require_varying_target(self.family, train_labels.astype(np.float64))
        else:
            _require_both_classes(self.family, train_labels)
        for note in self.notes:
            reporter.log(note, "warn")

        p = self.parameters
        horizon = int(self.market.horizon) if self.market is not None else 0
        episodes = make_episodes(train_index, p["episode_block_bars"], horizon)
        if not episodes:
            raise ValueError(
                f"{self.family}: {train_index.size} training rows make no episode of blocks of "
                f"{p['episode_block_bars']} bars with a query after the support plus the {horizon}-bar horizon"
            )

        _seed_everything(self.seed)
        inputs = self._inputs(features)
        self.extra_channel_count = int(inputs.shape[1]) - int(features.shape[1])
        self.feature_count = int(inputs.shape[1])
        device = torch.device(self.device)
        network = build_network(self.network_kind, p, self.feature_count)
        network.set_task(self.task)
        network.prepare(features, train_index, self.market)
        network = network.to(device)
        self.network = network
        self._amp_dtype = torch.float32

        matrix = torch.from_numpy(np.ascontiguousarray(inputs, dtype=np.float32)).to(device)
        label_tensor = torch.from_numpy(
            np.nan_to_num(np.asarray(labels, dtype=np.float32), nan=0.0 if regression else -1.0)
        ).to(device)
        validation_rows = torch.from_numpy(validation_index).to(device)
        validation_labels = labels[validation_index].astype(np.float64)
        if regression:
            positive_weight = None
            loss_function = nn.HuberLoss(delta=_HUBER_DELTA)
        else:
            positives = float(np.sum(train_labels >= 0.5))
            positive_weight = (float(train_labels.size) - positives) / positives
            loss_function = nn.BCEWithLogitsLoss(
                pos_weight=torch.tensor(positive_weight, dtype=torch.float32, device=device)
            )

        def episode_loss(rows: np.ndarray, expert_parameters: torch.Tensor) -> torch.Tensor:
            tensor_rows = torch.from_numpy(rows).to(device)
            outputs = network(self._gather_device(matrix, tensor_rows), expert_parameters=expert_parameters)
            return loss_function(outputs.float(), label_tensor[tensor_rows])

        optimizer = torch.optim.AdamW(network.parameters(), lr=p["learning_rate"], weight_decay=p["weight_decay"])
        inner_steps = int(p["inner_step_count"])
        inner_learning_rate = float(p["inner_learning_rate"])
        epoch_count = int(p["epochs"])
        order_generator = np.random.default_rng(self.seed)
        parameter_count = sum(t.numel() for t in network.parameters())
        support_sizes = [support.size for support, _ in episodes]
        query_sizes = [query.size for _, query in episodes]
        objective = ("Huber loss (delta 1) on the price target" if regression
                     else f"positive class weight {positive_weight:.3f}")
        reporter.log(
            f"{self.family} on {self.device}: {parameter_count:,} parameters, {len(network.expert_names)} symbolic "
            f"experts ({', '.join(network.expert_names)}), {len(episodes)} episodes per epoch (support "
            f"{min(support_sizes)}-{max(support_sizes)} bars, query {min(query_sizes)}-{max(query_sizes)} bars "
            f"after a {horizon}-bar embargo), {inner_steps} inner steps at {inner_learning_rate:g}, "
            f"first-order outer updates, {validation_index.size} validation rows, {objective}"
        )
        disabled = getattr(network, "disabled_atoms", {})
        if disabled:
            reporter.log(f"rule atoms disabled for this run: {', '.join(sorted(disabled))}")
        selection_name = "Huber loss" if regression else "log loss"

        best_loss = math.inf
        best_epoch = 0
        best_state = None
        best_reported_loss = None
        epochs_without_improvement = 0
        started = time.perf_counter()
        last_epoch = 0
        for epoch in range(1, epoch_count + 1):
            last_epoch = epoch
            reporter.checkpoint()
            reporter.epoch_started(epoch, epoch_count)
            network.train()
            loss_sum = 0.0
            row_sum = 0
            norm_sum = 0.0
            norm_count = 0
            episode_order = order_generator.permutation(len(episodes))
            for batch_number, episode in enumerate(episode_order, 1):
                reporter.checkpoint()
                batch_started = time.perf_counter()
                support, query = episodes[int(episode)]
                adapted = network.expert_parameters.detach().clone()
                for _ in range(inner_steps):
                    adapted.requires_grad_(True)
                    (gradient,) = torch.autograd.grad(episode_loss(support, adapted), adapted)
                    adapted = (adapted - inner_learning_rate * gradient).detach()
                adapted.requires_grad_(True)
                optimizer.zero_grad(set_to_none=True)
                query_loss = episode_loss(query, adapted)
                query_loss.backward()
                network.expert_parameters.grad = adapted.grad.detach().clone()
                norm = torch.nn.utils.clip_grad_norm_(network.parameters(), 1.0)
                optimizer.step()
                if regression:
                    with torch.no_grad():
                        rows = torch.from_numpy(query).to(device)
                        outputs = network(self._gather_device(matrix, rows), expert_parameters=adapted.detach())
                        loss_value = float((outputs.float() - label_tensor[rows]).abs().mean().item())
                else:
                    loss_value = float(query_loss.item())
                norm_value = float(norm.item())
                if math.isfinite(norm_value):
                    norm_sum += norm_value
                    norm_count += 1
                loss_sum += loss_value * query.size
                row_sum += query.size
                elapsed = max(time.perf_counter() - batch_started, 1e-9)
                reporter.batch(BatchReport(
                    epoch=epoch, epoch_count=epoch_count, batch=batch_number, batch_count=len(episodes),
                    span_start_index=int(support[0]), span_end_index=int(query[-1]),
                    train_loss=loss_value if math.isfinite(loss_value) else None,
                    learning_rate=optimizer.param_groups[0]["lr"],
                    gradient_norm=norm_value if math.isfinite(norm_value) else None,
                    samples_per_second=(support.size * inner_steps + query.size) / elapsed,
                ))
            train_loss = loss_sum / max(row_sum, 1)

            scores = {"loss": None, "accuracy": None, "f1_score": None}
            selection_loss = None
            if validation_index.size:
                reporter.checkpoint()
                reporter.validating(epoch, epoch_count)
                prediction = self._score_device(matrix, validation_rows)
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
                best_epoch = epoch
                best_state = copy.deepcopy(network.state_dict())
                epochs_without_improvement = 0
            elif selection_loss is not None:
                epochs_without_improvement += 1
            stop_now = selection_loss is not None and epochs_without_improvement >= p["patience"]
            reporter.epoch_finished(EpochReport(
                epoch=epoch, epoch_count=epoch_count,
                train_loss=train_loss if math.isfinite(train_loss) else None,
                validation_loss=scores["loss"], validation_accuracy=scores["accuracy"],
                validation_f1_score=scores["f1_score"], learning_rate=optimizer.param_groups[0]["lr"],
                gradient_norm=(norm_sum / norm_count) if norm_count else None,
                is_best=is_best, stopped_early=stop_now and epoch < epoch_count,
            ))
            if stop_now:
                if epoch < epoch_count:
                    reporter.log(
                        f"early stopping after epoch {epoch}: validation {selection_name} has not improved for "
                        f"{p['patience']} epochs (best {best_loss:.4f} at epoch {best_epoch})"
                    )
                break

        if best_state is not None:
            network.load_state_dict(best_state)
            reporter.log(f"restored the weights of epoch {best_epoch} (lowest validation {selection_name})")
        else:
            best_epoch = last_epoch
        network.eval()
        del matrix, label_tensor, validation_rows
        summary = {
            **_training_summary(train_index, validation_index, timestamps),
            "trained_epochs": last_epoch,
            "best_epoch": best_epoch,
            "episode_count": len(episodes),
            "expert_names": list(network.expert_names),
        }
        if regression:
            summary["loss_function"] = f"huber (delta {_HUBER_DELTA:g})"
            summary["best_validation_huber_loss"] = None if math.isinf(best_loss) else best_loss
            summary["best_validation_loss"] = best_reported_loss
        else:
            summary["best_validation_loss"] = None if math.isinf(best_loss) else best_loss
            summary["positive_class_weight"] = positive_weight
        summary["parameter_count"] = parameter_count
        summary["fit_seconds"] = time.perf_counter() - started
        self.fit_summary = summary
        self.best_iteration = best_epoch


__all__ = ["MetaSymbolicRouterAdapter", "make_episodes"]
