"""``SelfSupervisedProbeAdapter``: a self-supervised encoder read out by a linear probe.

Fit, per fold (``BridgeAdapter._fit``):

1. **Inputs.** The engine's causal features, standardised with the mean and
   deviation of the pool rows (clipped at +/-6). A row variant reads the bar's
   own row; a window variant reads the ``sequence_length`` bars ending at the
   bar, so ``minimum_history() == sequence_length``.
2. **Pool.** ``cycle.bridges.pool.unlabelled_pool``: every row of the span
   ``train_index[0] .. train_index[-1]`` whose history is finite, labelled or
   not; no validation or test row. A pretext that reads K bars after the
   anchor (CPC, SPR) uses only anchors t with t + K <= train_index[-1] and
   finite rows t + 1 .. t + K. The anchors and the last row each batch reads
   are kept on ``pretext_anchor_rows`` / ``pretext_last_rows`` (the test's gate).
3. **Pretext.** ``pretext_epochs`` epochs of the variant's own objective
   (AdamW, or SGD with momentum and cosine decay for SimSiam), gradient norm
   clipped at 5, seeded batches, augmentations and masks.
4. **Probe.** The encoder is frozen (a float64 CPU copy: the path prediction
   uses), the training rows are embedded, the embedding standardised with the
   training rows' statistics, and a linear head fitted for ``head_epochs``
   epochs of full-batch Adam: class-balanced logistic loss for P(up), Huber
   loss (delta 1) for the price model. Selection and early stopping
   (``patience``) read the validation rows only; the best epoch's head is kept.

The reporter sees one stream: pretext epochs 1..P (train loss = the pretext
loss, no validation score), then probe epochs P+1..P+H (validation log loss or
Huber loss). Prediction for bar t reads its window of features (rows <= t)
and nothing else, in float64, so one row alone equals the batch.
"""

from __future__ import annotations

import copy
import math
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as functional

from cycle.bridges import persistence
from cycle.bridges.base import BridgeAdapter
from cycle.bridges.pool import unlabelled_pool
from cycle.bridges.training import ValidationScore, run_epochs, score

from .variants import VARIANTS, future_steps

INPUT_CLIP = 6.0
GRADIENT_CLIP = 5.0
HEAD_STEPS_PER_EPOCH = 25
HEAD_LEARNING_RATE = 0.01
HEAD_WEIGHT_DECAY = 1e-4
MINIMUM_PRETEXT_ROWS = 16
PREDICT_CHUNK = 2048
STATE_FILE = "state.json"


class SelfSupervisedProbeAdapter(BridgeAdapter):
    step_unit = "epoch"
    needs_market = False          # the pretext and the probe read the feature matrix and the fit targets only
    model_file = "model.pt"

    def __init__(self, key, entry, parameters, device, seed, task="classification"):
        super().__init__(key, entry, parameters, device, seed, task)
        self._set_up()

    def _set_up(self) -> None:
        if self.variant not in VARIANTS:
            raise ValueError(f"{self.key}: unknown self-supervised variant {self.variant!r}; "
                             f"the family has {', '.join(VARIANTS)}")
        self.pretext_class = VARIANTS[self.variant]
        self.window = int(self.parameters["sequence_length"]) if self.pretext_class.windowed else 1
        self.future = future_steps(self.variant, self.parameters)
        self.config: dict = {}
        self.inference = None
        self.pretext_state: dict | None = None
        self.head_weight: np.ndarray | None = None
        self.head_bias = 0.0
        self.input_mean: np.ndarray | None = None
        self.input_deviation: np.ndarray | None = None
        self.embedding_mean: np.ndarray | None = None
        self.embedding_deviation: np.ndarray | None = None
        self.pretext_anchor_rows: np.ndarray | None = None
        self.pretext_last_rows: np.ndarray | None = None

    def minimum_history(self) -> int:
        return self.window

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "torch")

    def _training_device(self) -> torch.device:
        if self.device in ("cuda", "auto") and torch.cuda.is_available():
            return torch.device("cuda")
        return torch.device("cpu")

    # ── inputs ──
    def _inputs(self, features: np.ndarray, rows: np.ndarray, after: int = 0) -> tuple[np.ndarray, np.ndarray]:
        """Standardised float64 inputs of ``rows`` ((n, F), or (n, window + after, F))
        and whether each row's inputs are all finite."""
        rows = np.asarray(rows, dtype=np.int64).reshape(-1)
        if self.window == 1 and after == 0:
            values = features[rows].astype(np.float64)
            valid = np.all(np.isfinite(values), axis=1)
        else:
            offsets = np.arange(-(self.window - 1), after + 1, dtype=np.int64)
            positions = rows[:, None] + offsets[None, :]
            inside = (positions >= 0) & (positions < features.shape[0])
            values = features[np.clip(positions, 0, features.shape[0] - 1)].astype(np.float64)
            values[~inside] = np.nan
            valid = np.all(np.isfinite(values), axis=(1, 2))
        standardised = np.clip((values - self.input_mean) / self.input_deviation, -INPUT_CLIP, INPUT_CLIP)
        return standardised, valid

    def _anchors(self, features: np.ndarray, train_index: np.ndarray) -> np.ndarray:
        pool_rows = unlabelled_pool(features, train_index, self.window)
        if self.future == 0:
            return pool_rows
        span_end = int(train_index[-1])
        finite = np.all(np.isfinite(features), axis=1)
        keep = pool_rows + self.future <= span_end
        for step in range(1, self.future + 1):
            keep &= finite[np.minimum(pool_rows + step, features.shape[0] - 1)]
        return pool_rows[keep]

    # ── fit ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        parameters = self.parameters
        device = self._training_device()
        anchors = self._anchors(features, train_index)
        if anchors.size < MINIMUM_PRETEXT_ROWS:
            raise ValueError(f"{self.key}: only {anchors.size} rows of the training span have {self.window} bars of "
                             f"finite history{' and ' + str(self.future) + ' bars after them' if self.future else ''}; "
                             f"the pretext needs at least {MINIMUM_PRETEXT_ROWS}")
        self.pretext_anchor_rows = anchors.copy()
        self.pretext_last_rows = anchors + self.future
        own_rows = features[anchors].astype(np.float64)
        self.input_mean = own_rows.mean(axis=0)
        deviation = own_rows.std(axis=0)
        self.input_deviation = np.where(deviation > 1e-8, deviation, 1.0)

        pool_inputs, _ = self._inputs(features, anchors, self.future)
        pretext_inputs = torch.as_tensor(pool_inputs, dtype=torch.float32)
        names = None
        if self.market is not None and self.market.feature_names is not None \
                and len(self.market.feature_names) == features.shape[1]:
            names = list(self.market.feature_names)
        # the anchors' own inputs: (A, F) for a row variant, the window (A, window, F) otherwise
        own_inputs = pool_inputs[:, : self.window] if pool_inputs.ndim == 3 else pool_inputs
        self.config = self.pretext_class.plan_config(own_inputs, names, parameters, self.seed)
        with torch.random.fork_rng(devices=[]):
            torch.manual_seed(self.seed)
            module = self.pretext_class(features.shape[1], self.window, parameters, self.config)
        module.configure(torch.as_tensor(own_inputs, dtype=torch.float32))
        module.to(device)
        pretext_inputs = pretext_inputs.to(device)
        generator = torch.Generator(device=device)
        generator.manual_seed(self.seed)

        pretext_epochs = int(parameters["pretext_epochs"])
        head_epochs = int(parameters["head_epochs"])
        batch_count = max(1, math.ceil(anchors.size / int(parameters["batch_size"])))
        total_steps = pretext_epochs * batch_count
        learning_rate = float(parameters["learning_rate"])
        training_parameters = module.training_parameters()
        if module.optimizer_kind == "sgd":
            optimizer = torch.optim.SGD(training_parameters, lr=learning_rate, momentum=0.9,
                                        weight_decay=float(parameters["weight_decay"]))
        else:
            optimizer = torch.optim.AdamW(training_parameters, lr=learning_rate,
                                          weight_decay=float(parameters["weight_decay"]))
        state = {"step": 0, "head": None}
        targets = np.asarray(labels, dtype=np.float64)

        def pretext_epoch(epoch: int, report_batch) -> float:
            module.train()
            order = np.random.default_rng((self.seed, epoch)).permutation(anchors.size)
            losses: list[float] = []
            logs: dict[str, list[float]] = {}
            for number, chunk in enumerate(np.array_split(order, batch_count), start=1):
                reporter.checkpoint()
                progress = state["step"] / max(total_steps - 1, 1)
                if module.optimizer_kind == "sgd":
                    for group in optimizer.param_groups:
                        group["lr"] = learning_rate * 0.5 * (1.0 + math.cos(math.pi * progress))
                batch = pretext_inputs[torch.as_tensor(chunk, device=device)]
                loss, values = module.pretext_loss(batch, generator, progress)
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                module.before_optimizer_step()
                norm = torch.nn.utils.clip_grad_norm_(training_parameters, GRADIENT_CLIP)
                optimizer.step()
                module.after_step(progress)
                state["step"] += 1
                losses.append(float(loss.detach()))
                for name, value in values.items():
                    logs.setdefault(name, []).append(float(value))
                rows = anchors[chunk]
                report_batch(number, batch_count, int(rows.min()), int(rows.max()) + self.future, losses[-1],
                             learning_rate=optimizer.param_groups[0]["lr"], gradient_norm=float(norm))
            summary = ", ".join(f"{name} {np.mean(value):.4f}" for name, value in {**logs, **{
                key: [value] for key, value in module.describe().items()}}.items())
            reporter.log(f"{self.key}: pretext epoch {epoch}/{pretext_epochs} loss {np.mean(losses):.4f}"
                         + (f" ({summary})" if summary else ""))
            if epoch == pretext_epochs:
                self._freeze(module, features, train_index, validation_index, reporter)
                state["head"] = self._head_state(features, targets, train_index, validation_index)
            return float(np.mean(losses))

        def train_epoch(epoch: int, report_batch) -> float | None:
            if epoch <= pretext_epochs:
                return pretext_epoch(epoch, report_batch)
            return self._head_epoch(state["head"])

        def validate(epoch: int) -> ValidationScore:
            if epoch <= pretext_epochs or validation_index.size == 0:
                return ValidationScore(None, None, None, None)
            head = state["head"]
            prediction = self._head_output(head["validation_embedding"])
            return score(self.task, prediction, targets[validation_index])

        def snapshot():
            return (self.head_weight.copy(), float(self.head_bias))

        def restore(saved) -> None:
            self.head_weight, self.head_bias = saved[0].copy(), saved[1]
            head = state["head"]
            with torch.no_grad():
                head["linear"].weight.copy_(torch.as_tensor(self.head_weight).view(1, -1))
                head["linear"].bias.fill_(self.head_bias)

        summary = run_epochs(reporter, epoch_count=pretext_epochs + head_epochs, train_index=train_index,
                             train_epoch=train_epoch, validate=validate, snapshot=snapshot, restore=restore,
                             patience=int(parameters["patience"]), name=self.key)
        self.pretext_state = {name: value.detach().cpu().clone() for name, value in module.state_dict().items()}
        self.best_iteration = int(summary["best_epoch"])
        self.fit_summary = {
            "trained_epochs": int(summary["trained_epochs"]), "best_epoch": int(summary["best_epoch"]),
            "best_validation_loss": summary["best_validation_loss"], "fit_seconds": summary["fit_seconds"],
            "pretext_epochs": pretext_epochs, "pretext_row_count": int(anchors.size),
            "pretext_first_row": int(anchors[0]), "pretext_last_row": int(anchors[-1] + self.future),
            "embedding_width": int(module.embedding_width),
        }

    def _freeze(self, module, features, train_index, validation_index, reporter) -> None:
        """The float64 CPU copy prediction uses, and the embedding statistics of the training rows."""
        module.eval()
        inference = copy.deepcopy(module).cpu().double().eval()
        for parameter in inference.parameters():
            parameter.requires_grad_(False)
        self.inference = inference
        train_embedding = self._embed(features, train_index)
        self.embedding_mean = train_embedding.mean(axis=0)
        deviation = train_embedding.std(axis=0)
        self.embedding_deviation = np.where(deviation > 1e-8, deviation, 1.0)
        healthy = float(np.mean(deviation > 1e-3))
        reporter.log(f"{self.key}: embedding of the training rows - width {deviation.size}, per-dimension standard "
                     f"deviation median {np.median(deviation):.4f} (min {deviation.min():.4f}, max {deviation.max():.4f}); "
                     f"{healthy:.0%} of dimensions carry variance")

    def _head_state(self, features, targets, train_index, validation_index) -> dict:
        width = int(self.embedding_mean.size)
        linear = torch.nn.Linear(width, 1).double()
        with torch.no_grad():
            linear.weight.zero_()
            linear.bias.zero_()
        train = self._standardised_embedding(self._embed(features, train_index))
        target = torch.as_tensor(targets[train_index], dtype=torch.float64)
        weight = None
        if self.task == "classification":
            # class-balanced: each class carries half the loss, so the zero head starts at P(up) = 0.5
            share = float(np.clip(np.mean(targets[train_index]), 1e-3, 1 - 1e-3))
            weight = torch.where(target >= 0.5, torch.tensor(0.5 / share, dtype=torch.float64),
                                 torch.tensor(0.5 / (1.0 - share), dtype=torch.float64))
        else:
            with torch.no_grad():
                linear.bias.fill_(float(np.median(targets[train_index])))
        self.head_weight = np.zeros(width)
        self.head_bias = float(linear.bias.item())
        validation = self._embed(features, validation_index) if validation_index.size else np.zeros((0, width))
        return {"linear": linear, "train": torch.as_tensor(train), "target": target, "weight": weight,
                "optimizer": torch.optim.Adam(linear.parameters(), lr=HEAD_LEARNING_RATE),
                "validation_embedding": self._standardised_embedding(validation)}

    def _head_epoch(self, head: dict) -> float:
        linear, inputs, target = head["linear"], head["train"], head["target"]
        loss_value = math.nan
        for _ in range(HEAD_STEPS_PER_EPOCH):
            output = linear(inputs).squeeze(-1)
            if self.task == "classification":
                loss = functional.binary_cross_entropy_with_logits(output, target, weight=head["weight"])
            else:
                loss = functional.huber_loss(output, target, delta=1.0)
            loss = loss + HEAD_WEIGHT_DECAY * (linear.weight ** 2).sum()
            head["optimizer"].zero_grad(set_to_none=True)
            loss.backward()
            head["optimizer"].step()
            loss_value = float(loss.detach())
        self.head_weight = linear.weight.detach().numpy().reshape(-1).copy()
        self.head_bias = float(linear.bias.detach().item())
        return loss_value

    # ── prediction ──
    def _embed(self, features: np.ndarray, rows) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64).reshape(-1)
        width = int(self.inference.embedding_width)
        out = np.full((rows.size, width), np.nan)
        for start in range(0, rows.size, PREDICT_CHUNK):
            chunk = rows[start:start + PREDICT_CHUNK]
            inputs, valid = self._inputs(features, chunk)
            if valid.any():
                with torch.no_grad():
                    embedded = self.inference.embed(torch.as_tensor(inputs[valid], dtype=torch.float64))
                out[start:start + chunk.size][valid] = embedded.numpy()
        return out

    def _standardised_embedding(self, embedding: np.ndarray) -> np.ndarray:
        return (embedding - self.embedding_mean) / self.embedding_deviation

    def _head_output(self, standardised: np.ndarray) -> np.ndarray:
        value = standardised @ self.head_weight + self.head_bias
        if self.task == "classification":
            return 1.0 / (1.0 + np.exp(-np.clip(value, -500.0, 500.0)))
        return value

    def embedding(self, features: np.ndarray, index) -> np.ndarray:
        """The frozen encoder's representation of each row (n, width); NaN rows lack history."""
        self._require_fitted("embedding")
        return self._embed(features, index)

    def _predict_probability(self, features, index):
        return self._head_output(self._standardised_embedding(self._embed(features, index)))

    def _predict_value(self, features, index):
        return self._head_output(self._standardised_embedding(self._embed(features, index)))

    # ── save / load ──
    def _save_state(self, folder: Path) -> str:
        persistence.save_torch(folder / self.model_file, {
            "pretext": self.pretext_state,
            "head_weight": torch.as_tensor(self.head_weight, dtype=torch.float64),
            "head_bias": torch.tensor(float(self.head_bias), dtype=torch.float64),
            "input_mean": torch.as_tensor(self.input_mean, dtype=torch.float64),
            "input_deviation": torch.as_tensor(self.input_deviation, dtype=torch.float64),
            "embedding_mean": torch.as_tensor(self.embedding_mean, dtype=torch.float64),
            "embedding_deviation": torch.as_tensor(self.embedding_deviation, dtype=torch.float64),
        })
        persistence.save_json(folder / STATE_FILE, {"variant": self.variant, "window": self.window,
                                                    "futureSteps": self.future, "config": self.config})
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        self._set_up()
        stored = persistence.load_torch(folder / metadata.get("model_file", self.model_file))
        document = persistence.load_json(folder / STATE_FILE)
        self.config = dict(document.get("config") or {})
        with torch.random.fork_rng(devices=[]):
            module = self.pretext_class(int(self.feature_count), self.window, self.parameters, self.config)
        module.load_state_dict(stored["pretext"])
        self.pretext_state = stored["pretext"]
        inference = module.double().eval()
        for parameter in inference.parameters():
            parameter.requires_grad_(False)
        self.inference = inference
        self.head_weight = stored["head_weight"].numpy().copy()
        self.head_bias = float(stored["head_bias"].item())
        self.input_mean = stored["input_mean"].numpy().copy()
        self.input_deviation = stored["input_deviation"].numpy().copy()
        self.embedding_mean = stored["embedding_mean"].numpy().copy()
        self.embedding_deviation = stored["embedding_deviation"].numpy().copy()


__all__ = ["SelfSupervisedProbeAdapter"]
