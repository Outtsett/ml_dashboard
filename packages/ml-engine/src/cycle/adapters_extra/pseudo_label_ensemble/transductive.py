"""The transductive support vector machine (Joachims 1999), the S3VM spec.

1. Fit an SVM on the labelled rows (per-row penalty ``labeled_penalty``).
2. Label the unlabelled rows with the sign of its decision value under the
   class-balance constraint: the ``r`` share with the largest decision values
   are up, r = the labelled up-rate.
3. Anneal: the unlabelled rows' penalties start at 1e-5 (down side) and
   1e-5 x (up count / down count) (up side) and double each pass until both
   reach ``unlabeled_penalty``. Inside a pass the SVM is refitted on every row
   and, while some up-labelled row m and down-labelled row l both have slack
   (xi_m > 0, xi_l > 0, xi_m + xi_l > 2), their labels are swapped (the pair
   swap keeps the balance). Pairs are swapped in batches per refit — the
   largest remaining slacks paired first — for at most ``maximum_switches``
   refits per pass (SVMlight swaps one pair per warm-started step; scikit-learn
   has no warm start).

Rows are capped at ``maximum_fit_rows`` (half labelled, evenly spaced). The
kernel is linear (``LinearSVC``, hinge loss) or RBF (``SVC``). The decision
function is saved as plain arrays (weights, or support vectors with their
coefficients) and evaluated here, one row at a time. The adapter maps it to
P(up) with a logistic curve fitted on the validation rows. There is no price
form.
"""

from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np

from cycle.bridges import persistence

from . import learners
from .base import FitContext, Loop

STARTING_PENALTY = 1e-5
ARRAYS_FILE = "transductive_svm.npz"


def evenly_spaced(rows: np.ndarray, limit: int) -> np.ndarray:
    rows = np.asarray(rows, dtype=np.int64)
    if rows.size <= limit:
        return rows
    return rows[np.unique(np.round(np.linspace(0, rows.size - 1, max(1, limit))).astype(np.int64))]


class TransductiveSupportVectorMachine(Loop):
    decision_score = True

    def __init__(self, parameters: dict, seed: int, task: str) -> None:
        super().__init__(parameters, seed, task)
        if task != "classification":
            raise ValueError("the transductive SVM has no price form")
        self.kernel = str(parameters["kernel"])
        self.weights = None
        self.intercept = 0.0
        self.support_vectors = None
        self.dual_coefficients = None
        self.kernel_inverse_width = 0.0

    # ── one SVM fit, kept as arrays ──
    def _fit_svm(self, matrix: np.ndarray, signs: np.ndarray, penalties: np.ndarray) -> None:
        from sklearn.exceptions import ConvergenceWarning

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", ConvergenceWarning)
            if self.kernel == "linear":
                from sklearn.svm import LinearSVC

                machine = LinearSVC(C=1.0, loss="hinge", dual=True, max_iter=20000,
                                    random_state=self.seed % (2 ** 31 - 1))
                learners.fit(machine, matrix, signs, penalties)
                self.weights = np.asarray(machine.coef_, dtype=np.float64).ravel()
                self.intercept = float(np.asarray(machine.intercept_).ravel()[0])
            else:
                from sklearn.svm import SVC

                machine = SVC(C=1.0, kernel="rbf", gamma=self.kernel_inverse_width)
                learners.fit(machine, matrix, signs, penalties)
                self.support_vectors = np.asarray(machine.support_vectors_, dtype=np.float64)
                self.dual_coefficients = np.asarray(machine.dual_coef_, dtype=np.float64).ravel()
                # sklearn orders the classes (-1, +1): dual_coef_ . k(sv, x) + intercept_ is positive for +1
                self.intercept = float(np.asarray(machine.intercept_).ravel()[0])

    def decision(self, matrix: np.ndarray) -> np.ndarray:
        matrix = np.asarray(matrix, dtype=np.float64)
        if self.kernel == "linear":
            return np.array([float(row @ self.weights) for row in matrix]) + self.intercept
        out = np.empty(matrix.shape[0], dtype=np.float64)
        for position, row in enumerate(matrix):
            difference = self.support_vectors - row
            kernel = np.exp(-self.kernel_inverse_width * np.einsum("nf,nf->n", difference, difference))
            out[position] = float(kernel @ self.dual_coefficients) + self.intercept
        return out

    def fit(self, context: FitContext) -> dict:
        parameters = self.parameters
        cap = int(parameters["maximum_fit_rows"])
        labelled = evenly_spaced(context.labelled, max(2, cap // 2))
        unlabelled = evenly_spaced(context.unlabelled, max(0, cap - labelled.size))
        labelled_matrix = context.matrix(labelled)
        unlabelled_matrix = context.matrix(unlabelled)
        signs = np.where(context.targets[labelled] >= 0.5, 1, -1).astype(np.int64)
        if np.unique(signs).size < 2:
            raise ValueError(f"{context.name}: the labelled rows hold one class only")
        if self.kernel == "rbf":
            variance = float(labelled_matrix.var())
            self.kernel_inverse_width = 1.0 / (labelled_matrix.shape[1] * variance) if variance > 0 else 1.0
        labelled_penalty = float(parameters["labeled_penalty"])
        final_penalty = float(parameters["unlabeled_penalty"])
        switch_limit = int(parameters["maximum_switches"])
        up_share = float(np.mean(signs == 1))
        up_count = int(round(up_share * unlabelled.size))
        guessed = np.full(unlabelled.size, -1, dtype=np.int64)
        state = {"down_penalty": STARTING_PENALTY,
                 "up_penalty": STARTING_PENALTY * max(up_count, 1) / max(unlabelled.size - up_count, 1),
                 "swaps": 0, "refits": 0, "annealing_passes": 0}
        both = np.vstack([labelled_matrix, unlabelled_matrix])

        def fit_all() -> None:
            penalties = np.concatenate([np.full(labelled.size, labelled_penalty),
                                        np.where(guessed == 1, state["up_penalty"], state["down_penalty"])])
            self._fit_svm(both, np.concatenate([signs, guessed]), penalties)
            state["refits"] += 1

        def step(number: int):
            if number == 1:
                self._fit_svm(labelled_matrix, signs, np.full(labelled.size, labelled_penalty))
                state["refits"] += 1
                if unlabelled.size:
                    order = np.argsort(-self.decision(unlabelled_matrix), kind="stable")
                    guessed[order[:up_count]] = 1
                    self.record(unlabelled)
                return None, unlabelled.size > 0
            state["annealing_passes"] += 1
            swapped_here = 0
            for _ in range(max(1, switch_limit)):
                fit_all()
                slack = np.maximum(0.0, 1.0 - guessed * self.decision(unlabelled_matrix))
                ups = np.flatnonzero((guessed == 1) & (slack > 0))
                downs = np.flatnonzero((guessed == -1) & (slack > 0))
                ups = ups[np.argsort(-slack[ups], kind="stable")]
                downs = downs[np.argsort(-slack[downs], kind="stable")]
                pairs = 0
                for first, second in zip(ups, downs):
                    if slack[first] + slack[second] <= 2.0:
                        break
                    guessed[first], guessed[second] = -1, 1
                    pairs += 1
                if pairs == 0:
                    break
                swapped_here += pairs
            else:
                fit_all()           # the last swaps' labels are what the final SVM fits
            state["swaps"] += swapped_here
            if state["down_penalty"] >= final_penalty and state["up_penalty"] >= final_penalty:
                return float(swapped_here), False
            state["down_penalty"] = min(2.0 * state["down_penalty"], final_penalty)
            state["up_penalty"] = min(2.0 * state["up_penalty"], final_penalty)
            return float(swapped_here), True

        # passes: the labelled fit, then one per doubling until both penalties reach the final one
        start = min(state["down_penalty"], state["up_penalty"])
        doublings = int(np.ceil(np.log2(max(final_penalty / max(start, 1e-300), 1.0)))) + 1
        rounds = learners.run_rounds(context.reporter, maximum_rounds=1 + max(1, doublings), train_index=labelled,
                                     step=step, validate=lambda: self.validation_score(context), name=context.name)
        self.transductive_rows = unlabelled
        self.transductive_signs = guessed.copy()
        return {**rounds, "label_swaps": state["swaps"], "svm_refits": state["refits"],
                "annealing_passes": state["annealing_passes"], "labelled_fit_rows": int(labelled.size),
                "unlabelled_fit_rows": int(unlabelled.size), "unlabelled_up_count": int(up_count)}

    def score(self, matrix: np.ndarray) -> np.ndarray:
        return self.decision(matrix)

    def save(self, folder: Path) -> dict:
        arrays = {"intercept": np.array([self.intercept]), "kernel_inverse_width": np.array([self.kernel_inverse_width])}
        if self.kernel == "linear":
            arrays["weights"] = self.weights
        else:
            arrays["support_vectors"] = self.support_vectors
            arrays["dual_coefficients"] = self.dual_coefficients
        persistence.save_arrays(folder / ARRAYS_FILE, **arrays)
        return {"arrays": ARRAYS_FILE, "kernel": self.kernel}

    def restore(self, folder: Path, layout: dict) -> None:
        arrays = persistence.load_arrays(folder / layout["arrays"])
        self.kernel = layout["kernel"]
        self.intercept = float(arrays["intercept"][0])
        self.kernel_inverse_width = float(arrays["kernel_inverse_width"][0])
        self.weights = arrays.get("weights")
        self.support_vectors = arrays.get("support_vectors")
        self.dual_coefficients = arrays.get("dual_coefficients")


__all__ = ["TransductiveSupportVectorMachine"]
