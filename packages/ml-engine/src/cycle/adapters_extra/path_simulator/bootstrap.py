"""Monte Carlo simulation: a conditional block bootstrap of future paths.

Fit (training span only): every usable training bar r is described by its
feature row projected on the span's first principal components, and stored
with the h one-bar steps that followed it, in units of its own move scale
((close[r+k] - close[r+k-1]) / move_scale[r]; their sum is its price target).

Simulate bar t: find its ``neighbor_count`` nearest training bars in the
component space (ties broken by row order). Each of ``path_count`` paths is h
steps long and is built from blocks of ``block_length_bars`` consecutive
steps, each block copied from a random neighbour's following steps at a random
offset — the moving-block bootstrap, conditioned on the state. The share of
paths that end above the start is the raw direction score; the mean path end
is the price forecast.
"""

from __future__ import annotations

import math

import numpy as np

from .common import (
    Embedding,
    Simulated,
    Simulator,
    chunked,
    forward_steps,
    logit_share,
    row_generator,
    rows_of,
    share_up,
    usable_training_rows,
)


class BlockBootstrap(Simulator):
    variant = "block_bootstrap"
    step_unit = "single_fit"

    def prepare(self, context) -> None:
        """Nothing to set up before the one fitting step."""

    def train_epoch(self, epoch, report_batch, context) -> float | None:
        p = self.parameters
        view, features = context.view, context.features
        rows = usable_training_rows(view, features, context.train_index, int(p["maximum_training_bars"]))
        if rows.size < 10:
            raise ValueError(f"block_bootstrap: only {rows.size} usable training bars; the library needs at least 10")
        steps = forward_steps(view, rows, self.horizon)
        keep = np.all(np.isfinite(steps), axis=1)
        rows, steps = rows[keep], steps[keep]
        self.embedding = Embedding.fit(features, rows, int(p["principal_component_count"]))
        self.library_states = self.embedding.apply(features, rows)
        self.library_steps = steps
        report_batch(1, 1, int(rows[0]), int(rows[-1]), None)
        context.reporter.log(f"block_bootstrap: library of {rows.size} training bars, "
                             f"{self.embedding.dimension} components, blocks of {self._block_length()} bars")
        # the in-sample spread of the library's h-bar moves (a loss the terminal can show)
        return float(np.mean(np.abs(steps.sum(axis=1))))

    def _block_length(self) -> int:
        return max(1, min(int(self.parameters["block_length_bars"]), self.horizon))

    def _neighbour_count(self) -> int:
        return max(1, min(int(self.parameters["neighbor_count"]), self.library_states.shape[0]))

    def simulate(self, features, view, rows) -> Simulated:
        rows = rows_of(rows)
        score = np.full(rows.size, np.nan)
        mean_move = np.full(rows.size, np.nan)
        share = np.full(rows.size, np.nan)
        horizon = self.horizon
        block = self._block_length()
        block_count = int(math.ceil(horizon / block))
        neighbours = self._neighbour_count()
        paths = self.path_count
        within = np.arange(block, dtype=np.int64)
        for start, chunk in chunked(rows):
            finite = np.all(np.isfinite(features[chunk]), axis=1)
            states = np.full((chunk.size, self.embedding.dimension), np.nan)
            if finite.any():
                states[finite] = self.embedding.apply(features, chunk[finite])
            for position, row in enumerate(chunk):
                if not finite[position]:
                    continue
                distance = np.sum((self.library_states - states[position]) ** 2, axis=1)
                nearest = np.argsort(distance, kind="stable")[:neighbours]
                generator = row_generator(self.seed, int(row))
                chosen = nearest[generator.integers(0, neighbours, size=(paths, block_count))]
                offsets = generator.integers(0, horizon - block + 1, size=(paths, block_count))
                columns = offsets[:, :, None] + within[None, None, :]
                path_steps = self.library_steps[chosen[:, :, None], columns].reshape(paths, block_count * block)[:, :horizon]
                moves = path_steps.sum(axis=1)
                up = share_up(moves)
                share[start + position] = up
                score[start + position] = logit_share(np.array([up]), paths)[0]
                mean_move[start + position] = float(moves.mean())
        return Simulated(score, mean_move, share)

    def state(self) -> tuple[dict, dict]:
        arrays = {"library_states": self.library_states, "library_steps": self.library_steps,
                  **self.embedding.arrays("embedding")}
        return arrays, {"library_size": int(self.library_states.shape[0])}

    def restore(self, arrays, document) -> None:
        self.library_states = arrays["library_states"]
        self.library_steps = arrays["library_steps"]
        self.embedding = Embedding.from_arrays(arrays, "embedding")

    def summary(self) -> dict:
        return {"library_size": int(self.library_states.shape[0]), "components": int(self.embedding.dimension),
                "block_length_bars": self._block_length()}
