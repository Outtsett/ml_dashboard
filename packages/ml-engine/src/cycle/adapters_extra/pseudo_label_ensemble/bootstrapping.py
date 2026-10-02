"""Self-training and tri-training: one learner (or three) labelling its own pool.

``SelfTraining`` is scikit-learn's ``SelfTrainingClassifier`` loop written out so
every iteration is one reported solver pass: fit the base learner on the rows
labelled so far, predict the unlabelled pool, admit every row whose largest
class probability is ABOVE ``confidence_threshold`` with its predicted class,
repeat until nothing is admitted, everything is labelled or
``maximum_rounds`` iterations ran; then one last fit (its own pass). Its
pseudo-labels equal sklearn's ``transduction_`` (tested). The price form
(sklearn has none): a bootstrap committee of three regressors admits, per
iteration, the ``pseudo_target_share`` of the pool it agrees on most (smallest
spread), at the committee mean.

``TriTraining`` is Zhou and Li (2005): three learners from bootstrap samples of
the labelled rows; in each pass learner i receives the pool rows on which the
other two agree, when their joint error on the labelled rows fell (e_i < e'_i)
and the paper's size conditions hold (subsampling the new set when needed),
and is refitted on the labelled rows plus them; the loop ends when no learner
changes. P(up) is the mean of the three learners' probabilities. The price form
(tri-regression): learner i receives the pool rows where the other two disagree
least (``pseudo_target_share``), at their mean.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np

from . import learners
from .base import FitContext, Loop, bootstrap, lowest_share, seeded

COMMITTEE_SIZE = 3


class SelfTraining(Loop):
    def fit(self, context: FitContext) -> dict:
        parameters = self.parameters
        base = str(parameters["base_learner"])
        strength = float(parameters["regularization_strength"])
        maximum = int(parameters["maximum_rounds"])
        pool = np.concatenate([context.labelled, context.unlabelled])
        order = np.argsort(pool, kind="stable")
        pool = pool[order]
        has_label = np.isin(pool, context.labelled)
        transduction = np.where(has_label, context.targets[pool], np.nan)
        state = {"iterations": 0, "final_pending": False, "admitted": 0}
        if self.task == "classification":
            self.members = [learners.make_learner(base, "classification", strength, self.seed)]
        else:
            self.members = [learners.make_learner(base, "regression", strength, self.seed + member)
                            for member in range(COMMITTEE_SIZE)]

        def fit_members() -> None:
            rows = pool[has_label]
            targets = transduction[has_label]
            if self.task == "classification":
                learners.fit(self.members[0], context.matrix(rows), targets.astype(np.int64))
                return
            for member, learner in enumerate(self.members):
                sample = bootstrap(np.arange(rows.size), seeded(self.seed, member, state["iterations"]))
                learners.fit(learner, context.matrix(rows[sample]), targets[sample])

        def step(number: int):
            if state["final_pending"]:
                fit_members()
                return None, False
            state["iterations"] += 1
            fit_members()
            open_positions = np.flatnonzero(~has_label)
            matrix = context.matrix(pool[open_positions])
            if self.task == "classification":
                up = learners.up_probability(self.members[0], matrix)
                # sklearn's rule: the arg-max class, admitted when its probability is ABOVE the threshold
                # (the threshold is >= 0.5, so an admitted row is never a tie)
                confident = np.maximum(up, 1.0 - up) > float(parameters["confidence_threshold"])
                selected = open_positions[confident]
                transduction[selected] = (up[confident] > 0.5).astype(np.float64)
            else:
                predictions = np.stack([learners.value(learner, matrix) for learner in self.members])
                picked = lowest_share(predictions.std(axis=0), float(parameters["pseudo_target_share"])) \
                    if open_positions.size else np.empty(0, dtype=np.int64)
                selected = open_positions[picked]
                transduction[selected] = predictions.mean(axis=0)[picked]
            has_label[selected] = True
            state["admitted"] += int(selected.size)
            self.record(pool[selected])
            if selected.size == 0 or has_label.all() or state["iterations"] >= maximum:
                state["final_pending"] = True
            return float(selected.size), True

        rounds = learners.run_rounds(context.reporter, maximum_rounds=maximum + 1, train_index=pool, step=step,
                                     validate=lambda: self.validation_score(context), name=context.name)
        self.transduction_rows = pool[has_label]
        self.transduction = transduction[has_label]
        return {**rounds, "self_training_iterations": state["iterations"], "pseudo_labelled_count": state["admitted"]}

    def score(self, matrix: np.ndarray) -> np.ndarray:
        if self.task == "classification":
            return learners.up_probability(self.members[0], matrix)
        return np.mean([learners.value(learner, matrix) for learner in self.members], axis=0)

    def save(self, folder: Path) -> dict:
        return {"members": learners.save_learners(folder, "self_training", self.members)}

    def restore(self, folder: Path, layout: dict) -> None:
        self.members = learners.load_learners(folder, layout["members"])


def _agreement_error(first: np.ndarray, second: np.ndarray, truth: np.ndarray) -> float:
    """Tri-training's e_i: among labelled rows where the other two learners
    agree, the share they get wrong (0.5 when they never agree)."""
    agree = first == second
    if not agree.any():
        return 0.5
    return float(np.mean(first[agree] != truth[agree]))


class TriTraining(Loop):
    def fit(self, context: FitContext) -> dict:
        if self.task == "regression":
            return self._fit_regression(context)
        parameters = self.parameters
        base = str(parameters["base_learner"])
        strength = float(parameters["regularization_strength"])
        labelled = context.labelled
        truth = (context.targets[labelled] >= 0.5).astype(np.int64)
        labelled_matrix = context.matrix(labelled)
        pool = context.unlabelled
        pool_matrix = context.matrix(pool)
        self.members = [learners.make_learner(base, "classification", strength, self.seed + member)
                        for member in range(3)]
        previous_error = [0.5, 0.5, 0.5]
        previous_size = [0, 0, 0]
        state = {"updates": 0}

        def predicted(learner, matrix):
            return (learners.up_probability(learner, matrix) >= 0.5).astype(np.int64)

        def step(number: int):
            if number == 1:
                for member, learner in enumerate(self.members):
                    positions = bootstrap(np.arange(labelled.size), seeded(self.seed, 101, member))
                    if np.unique(truth[positions]).size < 2:          # a one-class resample: use every row
                        positions = np.arange(labelled.size)
                    learners.fit(learner, labelled_matrix[positions], truth[positions])
                return None, pool.size > 0
            on_labelled = [predicted(learner, labelled_matrix) for learner in self.members]
            on_pool = [predicted(learner, pool_matrix) for learner in self.members]
            updates = []
            for member in range(3):
                first, second = [other for other in range(3) if other != member]
                error = _agreement_error(on_labelled[first], on_labelled[second], truth)
                chosen = np.empty(0, dtype=np.int64)
                update = False
                if error < previous_error[member]:
                    agreeing = np.flatnonzero(on_pool[first] == on_pool[second])
                    chosen = agreeing
                    if previous_size[member] == 0:
                        previous_size[member] = int(math.floor(error / (previous_error[member] - error) + 1))
                    if previous_size[member] < chosen.size:
                        if error * chosen.size < previous_error[member] * previous_size[member]:
                            update = True
                        elif previous_size[member] > error / (previous_error[member] - error):
                            keep = int(math.ceil(previous_error[member] * previous_size[member] / error - 1))
                            generator = seeded(self.seed, 202, number, member)
                            chosen = np.sort(generator.choice(chosen, size=keep, replace=False))
                            update = True
                updates.append((member, update, chosen, error, on_pool[first][chosen]))
            changed = False
            for member, update, chosen, error, labels in updates:
                if not update:
                    continue
                changed = True
                rows = np.concatenate([labelled, pool[chosen]])
                classes = np.concatenate([truth, labels])
                learners.fit(self.members[member], context.matrix(rows), classes)
                previous_error[member] = error
                previous_size[member] = int(chosen.size)
                self.record(pool[chosen])
                state["updates"] += 1
            return float(sum(item[2].size for item in updates if item[1])), changed

        rounds = learners.run_rounds(context.reporter, maximum_rounds=int(parameters["maximum_rounds"]) + 1,
                                     train_index=labelled, step=step,
                                     validate=lambda: self.validation_score(context), name=context.name)
        return {**rounds, "learner_updates": state["updates"], "final_agreement_errors": previous_error}

    def _fit_regression(self, context: FitContext) -> dict:
        parameters = self.parameters
        base = str(parameters["base_learner"])
        strength = float(parameters["regularization_strength"])
        labelled = context.labelled
        truth = context.targets[labelled]
        pool = context.unlabelled
        pool_matrix = context.matrix(pool)
        self.members = [learners.make_learner(base, "regression", strength, self.seed + member) for member in range(3)]
        previous: list[np.ndarray | None] = [None, None, None]

        def step(number: int):
            if number == 1:
                for member, learner in enumerate(self.members):
                    positions = bootstrap(np.arange(labelled.size), seeded(self.seed, 101, member))
                    learners.fit(learner, context.matrix(labelled[positions]), truth[positions])
                return None, pool.size > 0
            on_pool = [learners.value(learner, pool_matrix) for learner in self.members]
            changed = False
            chosen_sets = []
            for member in range(3):
                first, second = [other for other in range(3) if other != member]
                chosen = lowest_share(np.abs(on_pool[first] - on_pool[second]), float(parameters["pseudo_target_share"]))
                chosen_sets.append((member, chosen, 0.5 * (on_pool[first] + on_pool[second])[chosen]))
            for member, chosen, targets in chosen_sets:
                if previous[member] is not None and np.array_equal(previous[member], chosen):
                    continue
                changed = True
                previous[member] = chosen
                rows = np.concatenate([labelled, pool[chosen]])
                learners.fit(self.members[member], context.matrix(rows), np.concatenate([truth, targets]))
                self.record(pool[chosen])
            return None, changed

        rounds = learners.run_rounds(context.reporter, maximum_rounds=int(parameters["maximum_rounds"]) + 1,
                                     train_index=labelled, step=step,
                                     validate=lambda: self.validation_score(context), name=context.name)
        return rounds

    def score(self, matrix: np.ndarray) -> np.ndarray:
        if self.task == "classification":
            return np.mean([learners.up_probability(learner, matrix) for learner in self.members], axis=0)
        return np.mean([learners.value(learner, matrix) for learner in self.members], axis=0)

    def save(self, folder: Path) -> dict:
        return {"members": learners.save_learners(folder, "tri_training", self.members)}

    def restore(self, folder: Path, layout: dict) -> None:
        self.members = learners.load_learners(folder, layout["members"])



__all__ = ["SelfTraining", "TriTraining"]
