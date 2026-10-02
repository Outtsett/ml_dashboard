"""Co-training (two views) and co-EM multi-view learning.

A view is a set of feature columns: ``bridges.groups.split_views`` groups the
run's columns by what they measure (price geometry, volume and order flow,
volatility, FinBERT news), merged down to the view count; a run whose names
are unknown falls back to a seeded random split of the columns.

``CoTraining`` is Blum and Mitchell (1998): one learner per view, fitted on the
labelled rows; each pass draws a working pool of ``candidate_pool_size`` rows
from the unlabelled rows, and each view labels its ``per_round_up_count`` most
confident up rows and ``per_round_down_count`` most confident down rows of that
pool; they join the shared labelled set, the pool is refilled from the
unlabelled rows, and both learners are refitted. P(up) combines the views as
independent evidence: p1 p2 / (p1 p2 + (1 - p1)(1 - p2)). The price form
(co-regression): the pool rows on which the two views' regressors agree most
join at the mean of the two.

``CoEM`` is Nigam and Ghani (2000): every pass refits each view's learner on
the labelled rows plus EVERY unlabelled row, carrying the other views' mean
P(up) from the previous pass as a soft label (the row twice, as up with weight
``consensus_weight`` x p and as down with weight ``consensus_weight`` x (1 - p));
the loop stops when the consensus moves less than 1e-3. P(up) is the mean of
the views. The price form uses the other views' mean prediction as the target.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from . import learners
from .base import FitContext, Loop, lowest_share, seeded

CONSENSUS_TOLERANCE = 1e-3


def combine_independent(probabilities: list[np.ndarray]) -> np.ndarray:
    """prod p / (prod p + prod (1 - p)), computed in log space."""
    stacked = np.clip(np.stack(probabilities), 1e-12, 1.0 - 1e-12)
    log_up = np.log(stacked).sum(axis=0)
    log_down = np.log1p(-stacked).sum(axis=0)
    return 1.0 / (1.0 + np.exp(np.clip(log_down - log_up, -500.0, 500.0)))


class ViewLoop(Loop):
    views: list[list[int]] = []

    def _new_members(self) -> list:
        base = str(self.parameters["base_learner"])
        strength = float(self.parameters["regularization_strength"])
        return [learners.make_learner(base, self.task, strength, self.seed + position)
                for position in range(len(self.views))]

    def view_scores(self, matrix: np.ndarray) -> list[np.ndarray]:
        matrix = np.asarray(matrix, dtype=np.float64)
        if self.task == "classification":
            return [learners.up_probability(learner, matrix[:, columns]) for learner, columns in zip(self.members, self.views)]
        return [learners.value(learner, matrix[:, columns]) for learner, columns in zip(self.members, self.views)]

    def save(self, folder: Path) -> dict:
        return {"members": learners.save_learners(folder, type(self).__name__.lower(), self.members),
                "views": [list(map(int, columns)) for columns in self.views]}

    def restore(self, folder: Path, layout: dict) -> None:
        self.members = learners.load_learners(folder, layout["members"])
        self.views = [list(columns) for columns in layout["views"]]


class CoTraining(ViewLoop):
    def fit(self, context: FitContext) -> dict:
        parameters = self.parameters
        up_count = int(parameters["per_round_up_count"])
        down_count = int(parameters["per_round_down_count"])
        generator = seeded(self.seed, 303)
        remaining = generator.permutation(context.unlabelled)
        pool_size = int(parameters["candidate_pool_size"])
        working, remaining = remaining[:pool_size], remaining[pool_size:]
        rows = context.labelled.copy()
        values = context.targets[context.labelled].astype(np.float64)
        if self.task == "classification":
            values = (values >= 0.5).astype(np.float64)
        self.members = self._new_members()
        state = {"added": 0, "final_pending": False, "working": working, "remaining": remaining, "passes": 0}
        maximum = int(parameters["maximum_rounds"])

        def refit() -> None:
            for learner, columns in zip(self.members, self.views):
                target = values.astype(np.int64) if self.task == "classification" else values
                learners.fit(learner, context.matrix(rows, columns), target)

        def step(number: int):
            nonlocal rows, values
            refit()
            if state["final_pending"]:
                return None, False
            state["passes"] += 1
            working = state["working"]
            if working.size == 0:
                state["final_pending"] = True
                return 0.0, False
            scores = self.view_scores(context.matrix(working))
            picked: dict[int, float] = {}
            if self.task == "classification":
                for probability in scores:
                    order = np.argsort(-probability, kind="stable")
                    ups = [position for position in order if position not in picked][:up_count]
                    for position in ups:
                        picked[int(position)] = 1.0
                    order = np.argsort(probability, kind="stable")
                    downs = [position for position in order if position not in picked][:down_count]
                    for position in downs:
                        picked[int(position)] = 0.0
            else:
                agreement = np.abs(scores[0] - scores[1]) if len(scores) > 1 else np.zeros(working.size)
                share = min(1.0, (up_count + down_count) / max(working.size, 1))
                mean = np.mean(scores, axis=0)
                for position in lowest_share(agreement, share):
                    picked[int(position)] = float(mean[position])
            positions = np.array(sorted(picked), dtype=np.int64)
            added = working[positions]
            rows = np.concatenate([rows, added])
            values = np.concatenate([values, np.array([picked[int(p)] for p in positions], dtype=np.float64)])
            self.record(added)
            state["added"] += int(added.size)
            keep = np.setdiff1d(np.arange(working.size), positions)
            refill = int(min(state["remaining"].size, positions.size))
            state["working"] = np.concatenate([working[keep], state["remaining"][:refill]])
            state["remaining"] = state["remaining"][refill:]
            if state["passes"] >= maximum or state["working"].size == 0:
                state["final_pending"] = True
            return float(added.size), True

        rounds = learners.run_rounds(context.reporter, maximum_rounds=maximum + 1, train_index=context.labelled,
                                     step=step, validate=lambda: self.validation_score(context), name=context.name)
        return {**rounds, "pseudo_labelled_count": state["added"], "views": [len(columns) for columns in self.views]}

    def score(self, matrix: np.ndarray) -> np.ndarray:
        scores = self.view_scores(matrix)
        if self.task == "classification":
            return combine_independent(scores)
        return np.mean(scores, axis=0)


class CoEM(ViewLoop):
    def fit(self, context: FitContext) -> dict:
        parameters = self.parameters
        weight = float(parameters["consensus_weight"])
        labelled = context.labelled
        pool = context.unlabelled
        truth = context.targets[labelled].astype(np.float64)
        if self.task == "classification":
            truth = (truth >= 0.5).astype(np.float64)
        self.members = self._new_members()
        state = {"consensus": None, "movement": None}
        if pool.size:
            self.record(pool)

        def step(number: int):
            previous = state["consensus"]
            for view, (learner, columns) in enumerate(zip(self.members, self.views)):
                labelled_matrix = context.matrix(labelled, columns)
                if previous is None or pool.size == 0 or weight <= 0.0:
                    target = truth.astype(np.int64) if self.task == "classification" else truth
                    learners.fit(learner, labelled_matrix, target)
                    continue
                others = np.mean([previous[other] for other in range(len(self.views)) if other != view], axis=0)
                pool_matrix = context.matrix(pool, columns)
                if self.task == "classification":
                    matrix = np.vstack([labelled_matrix, pool_matrix, pool_matrix])
                    target = np.concatenate([truth, np.ones(pool.size), np.zeros(pool.size)]).astype(np.int64)
                    sample_weight = np.concatenate([np.ones(labelled.size), weight * others, weight * (1.0 - others)])
                else:
                    matrix = np.vstack([labelled_matrix, pool_matrix])
                    target = np.concatenate([truth, others])
                    sample_weight = np.concatenate([np.ones(labelled.size), np.full(pool.size, weight)])
                learners.fit(learner, matrix, target, sample_weight)
            if pool.size == 0:
                return None, False
            current = self.view_scores(context.matrix(pool))
            state["consensus"] = current
            if previous is None:
                return None, True
            movement = float(max(np.max(np.abs(a - b)) for a, b in zip(current, previous)))
            state["movement"] = movement
            return movement, movement >= CONSENSUS_TOLERANCE

        rounds = learners.run_rounds(context.reporter, maximum_rounds=int(parameters["maximum_rounds"]),
                                     train_index=labelled, step=step, validate=lambda: self.validation_score(context),
                                     name=context.name)
        return {**rounds, "last_consensus_movement": state["movement"], "views": [len(columns) for columns in self.views]}

    def score(self, matrix: np.ndarray) -> np.ndarray:
        return np.mean(self.view_scores(matrix), axis=0)


__all__ = ["CoEM", "CoTraining", "combine_independent"]
