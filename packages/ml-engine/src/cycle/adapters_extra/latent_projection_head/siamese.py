"""The Siamese network: a weight-tied window encoder trained on outcome
pairs, read out by an analogue search over a frozen training index.

The encoder f reads a window of ``sequence_length`` bars (the feature rows
t - L + 1 .. t, standardised with the training rows' statistics, flattened)
and returns an L2-normalised embedding of ``embedding_size``. One encoder, one
set of weights, is applied to every member of a pair, so "similar" means the
same thing on both sides.

Training (batch-hard triplet loss, Hermans et al. 2017): in each batch of
training windows, every window is an anchor; its hardest positive is the
furthest window in the batch with the SAME outcome (up / down for the direction
model, the sign of the scaled move for the price model) and its hardest
negative the nearest window with the other outcome; the loss is
max(0, d(anchor, positive) - d(anchor, negative) + ``triplet_margin``).

After training every training window is embedded into a frozen index (rows of
the fold's ``train_index`` only, never a validation or test bar, and the index
is never extended as the walk proceeds). A bar's P(up) is the inverse-distance
weighted share of up outcomes among its ``neighbor_count`` nearest indexed
windows, with a Laplace prior of one up and one down; the price model returns
the weighted mean scaled move of the same neighbours. Early stopping reads the
validation windows' log loss (Huber loss for the price model) of that readout.
The search is exact and done one bar at a time, so a bar's answer never
depends on the other bars scored with it.
"""

from __future__ import annotations

import copy
import math
from pathlib import Path

import numpy as np

from cycle.bridges import persistence
from cycle.bridges.training import run_epochs, score

from .encoders import Standardiser
from .networks import _torch_modules

INDEX_FILE = "siamese_index.npz"
NETWORK_FILE = "siamese_encoder.pt"
DISTANCE_FLOOR = 0.05


def windows(standard: np.ndarray, rows: np.ndarray, length: int) -> tuple[np.ndarray, np.ndarray]:
    """(flattened windows, usable mask) for ``rows``: the ``length`` rows ending at each, all finite."""
    rows = np.asarray(rows, dtype=np.int64)
    out = np.full((rows.size, length * standard.shape[1]), np.nan, dtype=np.float64)
    usable = np.zeros(rows.size, dtype=bool)
    for position, row in enumerate(rows):
        start = int(row) - length + 1
        if start < 0 or int(row) >= standard.shape[0]:
            continue
        block = standard[start: int(row) + 1]
        if np.all(np.isfinite(block)):
            out[position] = block.reshape(-1)
            usable[position] = True
    return out, usable


class SiameseNeighbours:
    """Fit, predict and save the Siamese analogue model (see the module docstring)."""

    def __init__(self, parameters: dict, seed: int, task: str, device: str = "cpu") -> None:
        self.parameters = dict(parameters)
        self.seed = int(seed)
        self.task = task
        self.device = device
        self.sequence_length = int(parameters["sequence_length"])
        self.standardiser: Standardiser | None = None
        self.network = None
        self.index_embeddings: np.ndarray | None = None
        self.index_targets: np.ndarray | None = None
        self.index_rows: np.ndarray | None = None
        self.feature_count = 0

    def _build(self, feature_count: int):
        _torch, _nn, mlp, _ = _torch_modules()
        self.feature_count = int(feature_count)
        return mlp(self.sequence_length * self.feature_count, int(self.parameters["hidden_size"]),
                   int(self.parameters["layer_count"]), int(self.parameters["embedding_size"]),
                   float(self.parameters["dropout"]))

    @staticmethod
    def _outcome(target: np.ndarray, task: str) -> np.ndarray:
        return (target >= 0.5) if task == "classification" else (target > 0)

    # ── the readout ──
    def _embed(self, flattened: np.ndarray) -> np.ndarray:
        torch = _torch_modules()[0]
        with torch.no_grad():
            output = self.network(torch.from_numpy(np.asarray(flattened, dtype=np.float64)))
            return torch.nn.functional.normalize(output, dim=1).numpy()

    def _readout(self, embeddings: np.ndarray) -> np.ndarray:
        """Exact k-nearest-neighbour readout, one bar at a time."""
        count = int(min(int(self.parameters["neighbor_count"]), self.index_embeddings.shape[0]))
        out = np.full(embeddings.shape[0], np.nan, dtype=np.float64)
        for position in range(embeddings.shape[0]):
            query = embeddings[position]
            if not np.all(np.isfinite(query)):
                continue
            distance = np.sqrt(np.sum((self.index_embeddings - query) ** 2, axis=1))
            nearest = np.argsort(distance, kind="stable")[:count]
            weight = 1.0 / (distance[nearest] + DISTANCE_FLOOR)
            target = self.index_targets[nearest]
            if self.task == "classification":
                out[position] = (float(np.sum(weight * (target >= 0.5))) + 1.0) / (float(np.sum(weight)) + 2.0)
            else:
                out[position] = float(np.sum(weight * target) / np.sum(weight))
        return out

    def predict(self, features: np.ndarray, index: np.ndarray) -> np.ndarray:
        index = np.asarray(index, dtype=np.int64)
        start = max(0, int(index.min()) - self.sequence_length + 1)
        stop = int(index.max()) + 1
        standard = np.full((stop, self.feature_count), np.nan, dtype=np.float64)
        standard[start:stop] = self.standardiser.apply(np.asarray(features[start:stop], dtype=np.float64))
        flattened, usable = windows(standard, index, self.sequence_length)
        out = np.full(index.size, np.nan, dtype=np.float64)
        if usable.any():
            out[usable] = self._readout(self._embed(flattened[usable]))
        return out

    # ── fitting ──
    def fit(self, features: np.ndarray, targets: np.ndarray, train_index: np.ndarray, validation_index: np.ndarray,
            reporter) -> dict:
        torch, _nn, _mlp, _ = _torch_modules()
        torch.manual_seed(self.seed)
        generator = torch.Generator().manual_seed(self.seed)
        device = torch.device(self.device)
        length = self.sequence_length
        train_index = np.asarray(train_index, dtype=np.int64)
        validation_index = np.asarray(validation_index, dtype=np.int64)
        last = int(max(train_index.max(), validation_index.max() if validation_index.size else 0))
        span = np.asarray(features[: last + 1], dtype=np.float64)
        train_rows_matrix = span[train_index]
        self.standardiser = Standardiser.fit(train_rows_matrix[np.all(np.isfinite(train_rows_matrix), axis=1)])
        standard = self.standardiser.apply(span)
        target = np.asarray(targets, dtype=np.float64)
        train_windows, usable = windows(standard, train_index, length)
        usable &= np.isfinite(target[train_index])
        rows = train_index[usable]
        if rows.size < 4:
            raise ValueError(f"siamese network: only {rows.size} training windows of {length} bars")
        train_windows = train_windows[usable]
        train_target = target[rows]
        outcome = self._outcome(train_target, self.task)
        validation_windows, validation_usable = windows(standard, validation_index, length)
        validation_usable &= np.isfinite(target[validation_index])
        validation_windows = validation_windows[validation_usable]
        validation_target = target[validation_index][validation_usable]

        model = self._build(standard.shape[1]).to(device)
        learning_rate = float(self.parameters["learning_rate"])
        optimiser = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=float(self.parameters["weight_decay"]))
        batch_size = int(max(8, min(int(self.parameters["batch_size"]), rows.size)))
        margin = float(self.parameters["triplet_margin"])
        train_tensor = torch.from_numpy(train_windows.astype(np.float32))
        outcome_tensor = torch.from_numpy(outcome.astype(np.int64))

        def train_epoch(epoch: int, report_batch) -> float:
            model.train()
            order = torch.randperm(rows.size, generator=generator)
            losses, active = [], []
            for batch_number in range(math.ceil(rows.size / batch_size)):
                chosen = order[batch_number * batch_size: (batch_number + 1) * batch_size]
                if chosen.numel() < 4:
                    continue
                embedding = torch.nn.functional.normalize(model(train_tensor[chosen].to(device)), dim=1)
                same = (outcome_tensor[chosen].unsqueeze(0) == outcome_tensor[chosen].unsqueeze(1)).to(device)
                distance = torch.cdist(embedding, embedding)
                eye = torch.eye(chosen.numel(), dtype=torch.bool, device=device)
                positive = torch.where(same & ~eye, distance, torch.zeros_like(distance)).max(dim=1).values
                negative = torch.where(~same, distance, torch.full_like(distance, 4.0)).min(dim=1).values
                has_both = (same & ~eye).any(dim=1) & (~same).any(dim=1)
                if not bool(has_both.any()):
                    continue
                triplet = torch.relu(positive - negative + margin)[has_both]
                loss = triplet.mean()
                optimiser.zero_grad(set_to_none=True)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
                optimiser.step()
                losses.append(float(loss.detach().cpu()))
                active.append(float((triplet > 0).float().mean().cpu()))
            report_batch(1, 1, int(rows[0]), int(rows[-1]), float(np.mean(losses)) if losses else None,
                         learning_rate=learning_rate)
            return float(np.mean(losses)) if losses else None

        def freeze_and_index() -> None:
            frozen = copy.deepcopy(model).to(torch.device("cpu")).double().eval()
            for parameter in frozen.parameters():
                parameter.requires_grad_(False)
            self.network = frozen
            self.index_embeddings = self._embed(train_windows)
            self.index_targets = train_target.copy()
            self.index_rows = rows.copy()

        def validate(epoch: int):
            freeze_and_index()
            prediction = self._readout(self._embed(validation_windows)) if validation_windows.shape[0] else np.empty(0)
            return score(self.task, prediction, validation_target)

        summary = run_epochs(reporter, epoch_count=int(self.parameters["epochs"]), train_index=rows,
                             train_epoch=train_epoch, validate=validate,
                             snapshot=lambda: copy.deepcopy(model.state_dict()), restore=model.load_state_dict,
                             patience=int(self.parameters["patience"]), name="siamese network")
        freeze_and_index()
        return {"encoder_trained_epochs": summary["trained_epochs"], "encoder_best_epoch": summary["best_epoch"],
                "best_validation_loss": summary["best_validation_loss"], "index_row_count": int(rows.size),
                "index_up_share": float(np.mean(outcome))}

    # ── persistence ──
    def state_arrays(self) -> dict[str, np.ndarray]:
        arrays = {"mean": self.standardiser.mean, "scale": self.standardiser.scale,
                  "index_embeddings": self.index_embeddings, "index_targets": self.index_targets,
                  "index_rows": self.index_rows, "feature_count": np.array([self.feature_count], dtype=np.int64)}
        return arrays

    def save(self, folder: Path) -> None:
        persistence.save_arrays(folder / INDEX_FILE, **self.state_arrays())
        persistence.save_torch(folder / NETWORK_FILE, {name: tensor.detach().cpu().clone()
                                                       for name, tensor in self.network.state_dict().items()})

    def restore(self, folder: Path) -> None:
        arrays = persistence.load_arrays(folder / INDEX_FILE)
        self.standardiser = Standardiser(arrays["mean"], arrays["scale"])
        self.index_embeddings, self.index_targets = arrays["index_embeddings"], arrays["index_targets"]
        self.index_rows = arrays["index_rows"]
        model = self._build(int(arrays["feature_count"][0])).double()
        model.load_state_dict(persistence.load_torch(folder / NETWORK_FILE))
        model.eval()
        for parameter in model.parameters():
            parameter.requires_grad_(False)
        self.network = model


__all__ = ["SiameseNeighbours", "windows"]
