"""MAML (Finn et al. 2017) and Reptile (Nichol et al. 2018): an initialisation
that adapts to the current market in a few gradient steps.

Tasks are the blocks of ``adaptation_interval_bars`` bars of the training span
(anchored at absolute bar numbers, the blocks the test walk uses). A task's
support set is its realised context: the ``context_bars`` rows before the
block's first bar whose outcome is already known there (r <= anchor - h), with
their realised rewards (direction) or price targets (price model).

- **MAML**: the inner loop takes ``inner_step_count`` SGD steps of size
  ``inner_learning_rate`` from theta on the support set; the outer loss is the
  adapted network's loss on the block itself — the tape reward of the trade it
  would take (next-open fills, round trip) for the direction model, the Huber
  loss of the price target for the price model — and Adam moves theta through
  the inner steps (second order through ``torch.autograd.grad(create_graph=True)``,
  or first order when ``first_order_gradient`` is set).
- **Reptile**: clone theta, take the inner steps on the block's own rows,
  and move theta toward the adapted weights by ``outer_step_size`` (annealed
  linearly to ``outer_step_size / epochs``), averaged over a meta-batch.

At prediction both take the same inner steps from the meta-learned theta on
the realised context of the bar's block and score the bar with the adapted
network; the adapted weights are cached per block. P(up) is the adapted
policy's long share pi(long) / (pi(long) + pi(short)) over {short, flat, long};
the price model predicts the scaled move.
"""

from __future__ import annotations

import numpy as np
import torch
from torch.func import functional_call

from cycle.adapters_extra.meta_agent.common import (
    MINIMUM_CONTEXT_ROWS,
    as_tensor,
    context_rows,
    expected_reward_loss,
    finite_rows,
    group_by_anchor,
    huber,
    module_state,
    numpy_generator,
    perceptron,
    policy_score,
    realised_rewards,
    restore,
    seeded,
    snapshot,
    softmax_numpy,
    tape_rewards,
    up_share,
)
from cycle.adapters_extra.meta_agent.mechanism import Mechanism
from cycle.bridges.training import run_epochs, score


class GradientMetaLearner(Mechanism):
    has_regression = True
    variant = "maml"

    def __init__(self, key, parameters, seed, task, feature_count) -> None:
        super().__init__(key, parameters, seed, task, feature_count)
        p = self.parameters
        self.outputs = 3 if task == "classification" else 1
        self.network = seeded(self.seed, lambda: perceptron(self.feature_count, p["hidden_size"], p["layer_count"],
                                                            self.outputs))
        self.interval = int(p["adaptation_interval_bars"])
        self.context_count = int(p["context_bars"])
        self.steps = int(p["inner_step_count"])
        self.inner_rate = float(p["inner_learning_rate"])
        self.entropy = float(p["entropy_coefficient"])

    # ── the inner loop ──
    def _loss(self, parameters: dict, inputs: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        output = functional_call(self.network, parameters, (inputs,))
        if self.task == "classification":
            return expected_reward_loss(output, targets, self.entropy)
        return huber(output[:, 0], targets)

    def _adapt(self, parameters: dict, inputs: torch.Tensor, targets: torch.Tensor, create_graph: bool) -> dict:
        for _ in range(self.steps):
            loss = self._loss(parameters, inputs, targets)
            gradients = torch.autograd.grad(loss, list(parameters.values()), create_graph=create_graph)
            parameters = {name: value - self.inner_rate * gradient
                          for (name, value), gradient in zip(parameters.items(), gradients)}
        return parameters

    def _targets(self, rows: np.ndarray) -> np.ndarray:
        """Realised-form targets (what a test-time adaptation can read)."""
        if self.task == "classification":
            return realised_rewards(self.view, rows)
        return np.asarray(self.view.price_targets[rows], dtype=np.float64)

    def _support(self, features: np.ndarray, anchor: int, first_row: int):
        rows = context_rows(self.view, features, anchor, self.context_count, first_row)
        if rows.size < MINIMUM_CONTEXT_ROWS:
            return None
        return as_tensor(features[rows]), as_tensor(self._targets(rows))

    def _adapted(self, features: np.ndarray, anchor: int, first_row: int) -> dict:
        key = (int(anchor), int(first_row))
        if key in self.cache:
            return self.cache[key]
        base = {name: value.detach() for name, value in self.network.named_parameters()}
        support = self._support(features, anchor, first_row)
        if support is None:
            adapted = base
        else:
            with torch.enable_grad():
                start = {name: value.clone().requires_grad_(True) for name, value in base.items()}
                adapted = {name: value.detach() for name, value in self._adapt(start, *support, False).items()}
        self.cache[key] = adapted
        return adapted

    def _outputs(self, features: np.ndarray, rows: np.ndarray, first_row: int = 0) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        out = np.full((rows.size, self.outputs), np.nan)
        usable = np.all(np.isfinite(features[rows]), axis=1)
        anchors = (rows // self.interval) * self.interval
        for anchor in np.unique(anchors[usable]):
            positions = np.flatnonzero(usable & (anchors == anchor))
            parameters = self._adapted(features, int(anchor), first_row)
            with torch.no_grad():
                output = functional_call(self.network, parameters, (as_tensor(features[rows[positions]]),))
            out[positions] = softmax_numpy(output) if self.task == "classification" else output.numpy()
        return out

    def predict(self, features, rows) -> np.ndarray:
        self.require_view()
        out = self._outputs(features, rows)
        return up_share(out) if self.task == "classification" else out[:, 0]

    # ── fitting ──
    def _training_tasks(self, features, labels, train_index) -> list[dict]:
        train = np.asarray(train_index, dtype=np.int64)
        first = int(train[0])
        if self.task == "classification":
            outer = tape_rewards(self.view, train, train)
        else:
            outer = np.asarray(labels, dtype=np.float64)[train]
        rows = finite_rows(features, train, outer)
        outer_by_row = dict(zip(train.tolist(), range(train.size)))
        tasks = []
        for anchor, block in group_by_anchor(rows, self.interval):
            if block.size < 2:
                continue
            outer_values = outer[[outer_by_row[int(row)] for row in block]]
            task = {"anchor": anchor, "rows": block, "query_inputs": as_tensor(features[block]),
                    "query_targets": as_tensor(outer_values),
                    "own_targets": as_tensor(self._targets(block))}
            if self.variant == "maml":
                support = self._support(features, anchor, first)
                if support is None:
                    continue
                task["support_inputs"], task["support_targets"] = support
            tasks.append(task)
        if not tasks:
            raise ValueError(f"{self.key}: the training span holds no block of {self.interval} bars with "
                             f"{MINIMUM_CONTEXT_ROWS} realised context rows; shorten adaptation_interval_bars or "
                             "lengthen the training span")
        return tasks

    def fit(self, features, labels, train_index, validation_index, reporter) -> dict:
        p = self.parameters
        train = np.asarray(train_index, dtype=np.int64)
        validation = np.asarray(validation_index, dtype=np.int64)
        first = int(train[0])
        tasks = self._training_tasks(features, labels, train)
        reporter.log(f"{self.key}: {len(tasks)} tasks of up to {self.interval} bars, "
                     f"{self.steps} inner steps of {self.inner_rate:g}")
        epochs = int(p["epochs"])
        meta_batch = max(1, int(p["meta_batch_size"]))
        optimizer = torch.optim.Adam(self.network.parameters(), lr=float(p["learning_rate"])) \
            if self.variant == "maml" else None

        def train_epoch(epoch: int, report_batch) -> float:
            self.cache = {}
            generator = numpy_generator(self.seed, epoch)
            order = generator.permutation(len(tasks))
            groups = [order[start:start + meta_batch] for start in range(0, order.size, meta_batch)]
            losses = []
            for number, group in enumerate(groups, start=1):
                chosen = [tasks[int(index)] for index in group]
                if self.variant == "maml":
                    loss = self._maml_step(chosen, optimizer, bool(p["first_order_gradient"]))
                else:
                    step = float(p["outer_step_size"]) * (1.0 - (epoch - 1) / max(1, epochs))
                    loss = self._reptile_step(chosen, step)
                losses.append(loss)
                report_batch(number, len(groups), min(int(task["rows"][0]) for task in chosen),
                             max(int(task["rows"][-1]) for task in chosen), loss)
            return float(np.mean(losses))

        def validate(epoch: int):
            self.cache = {}
            output = self._outputs(features, validation, first)
            self.cache = {}
            if self.task == "classification":
                return policy_score(output, np.asarray(labels)[validation], realised_rewards(self.view, validation))
            return score("regression", output[:, 0], np.asarray(labels)[validation])

        summary = run_epochs(reporter, epoch_count=epochs, train_index=train, train_epoch=train_epoch,
                             validate=validate if validation.size else None,
                             snapshot=lambda: snapshot(self.network), restore=lambda state: restore(state, self.network),
                             patience=int(p["patience"]), name=self.key)
        self.cache = {}
        summary["task_count"] = len(tasks)
        return summary

    def _maml_step(self, tasks: list[dict], optimizer, first_order: bool) -> float:
        optimizer.zero_grad()
        parameters = dict(self.network.named_parameters())
        total = 0.0
        for task in tasks:
            adapted = self._adapt(parameters, task["support_inputs"], task["support_targets"], not first_order)
            total = total + self._loss(adapted, task["query_inputs"], task["query_targets"])
        loss = total / len(tasks)
        loss.backward()
        optimizer.step()
        return float(loss.detach())

    def _reptile_step(self, tasks: list[dict], step: float) -> float:
        base = {name: value.detach().clone() for name, value in self.network.named_parameters()}
        moved = {name: torch.zeros_like(value) for name, value in base.items()}
        losses = []
        for task in tasks:
            parameters = {name: value.clone().requires_grad_(True) for name, value in base.items()}
            for _ in range(self.steps):
                loss = self._loss(parameters, task["query_inputs"], task["own_targets"])
                gradients = torch.autograd.grad(loss, list(parameters.values()))
                parameters = {name: (value - self.inner_rate * gradient).detach().requires_grad_(True)
                              for (name, value), gradient in zip(parameters.items(), gradients)}
            losses.append(float(loss.detach()))
            for name in moved:
                moved[name] += parameters[name].detach() - base[name]
        with torch.no_grad():
            for name, value in self.network.named_parameters():
                value.add_(moved[name], alpha=step / len(tasks))
        return float(np.mean(losses))

    # ── persistence ──
    def state(self) -> dict:
        return {"network": module_state(self.network)}

    def load_state(self, state: dict) -> None:
        self.network.load_state_dict(state["network"])


class ModelAgnosticMetaLearner(GradientMetaLearner):
    variant = "maml"


class ReptileMetaLearner(GradientMetaLearner):
    variant = "reptile"


__all__ = ["GradientMetaLearner", "ModelAgnosticMetaLearner", "ReptileMetaLearner"]
