"""Dynamic decision network: a hidden market regime, filtered forward, planned by backward induction.

Two-slice network with a hidden regime R_t (``cluster_count`` states):
a Gaussian hidden Markov model (hmmlearn, diagonal covariances, Baum-Welch for
``iteration_count`` iterations) fitted on the training span's feature rows
projected onto their first ``latent_dimension`` principal components gives the
transition model P(R_t+1 | R_t) and the emission model. Regime-conditional
rewards come from the training span: each regime's belief-weighted mean
scaled h-bar move (and its up-rate), read from the filtered beliefs of the
training bars.

At bar t the belief b_t over regimes is the **forward filter only** (never the
smoother) run over the last ``history_bars`` bars ending at t, from the model's
start distribution; a bar with a missing feature is a transition without an
observation. Finite-horizon value iteration over ``planning_horizon`` stages
on (regime, position) with actions {short, flat, long}, a per-bar reward of
position x the regime's per-bar drift, a round-trip cost on every change of
position and ``discount_factor`` gives Q(R, flat, a); the decision value is
QMDP, Q(b_t, a) = sum_R b_t(R) Q(R, flat, a). Score = Q(b_t, long) -
Q(b_t, short); the price model is sum_R (b_t A^h)_R x the regime's mean move.
"""

from __future__ import annotations

import numpy as np

from cycle.adapters_extra.decision_graph.graphs import DECISIONS, Engine, scaled_cost


def _log_emission(x: np.ndarray, means: np.ndarray, variances: np.ndarray) -> np.ndarray:
    """(..., K) diagonal-Gaussian log densities of (..., D) rows."""
    difference = x[..., None, :] - means
    return -0.5 * (np.sum(difference ** 2 / variances, axis=-1) + np.sum(np.log(2 * np.pi * variances), axis=-1))


class DynamicDecisionNetwork(Engine):
    has_value = True

    @property
    def history(self) -> int:
        return int(self.parameters["history_bars"])

    def fit(self, context, train_rows, target, direction):
        from hmmlearn.hmm import GaussianHMM

        p = self.parameters
        features, view = context.features, context.view
        self.horizon = int(view.horizon)
        span = view.fit_rows(train_rows)
        matrix = np.asarray(features[span], dtype=np.float64)
        finite = np.all(np.isfinite(matrix), axis=1)
        self.mean = matrix[finite].mean(axis=0)
        _, _, components = np.linalg.svd(matrix[finite] - self.mean, full_matrices=False)
        self.components = components[: int(p["latent_dimension"])]
        projected = (matrix[finite] - self.mean) @ self.components.T
        # contiguous finite runs are separate sequences for Baum-Welch
        breaks = np.flatnonzero(np.diff(np.flatnonzero(finite)) > 1) + 1
        lengths = [len(part) for part in np.split(np.arange(projected.shape[0]), breaks) if len(part)]
        model = GaussianHMM(n_components=int(p["cluster_count"]), covariance_type="diag", n_iter=int(p["iteration_count"]),
                            random_state=self.seed, tol=1e-4)
        model.fit(projected, lengths)
        self.start = np.asarray(model.startprob_, dtype=np.float64)
        self.transition = np.asarray(model.transmat_, dtype=np.float64)
        self.means = np.asarray(model.means_, dtype=np.float64)
        self.variances = np.asarray([np.diag(c) for c in model.covars_], dtype=np.float64)
        beliefs = self.beliefs(features, train_rows)
        moves = np.asarray(view.price_targets, dtype=np.float64)[train_rows]
        labels = np.asarray(direction, dtype=np.float64)[train_rows]
        known = np.isfinite(moves) & np.all(np.isfinite(beliefs), axis=1)
        weight = beliefs[known]
        mass = weight.sum(axis=0) + 1e-9
        self.regime_move = (weight * moves[known, None]).sum(axis=0) / mass
        up_known = known & np.isfinite(labels)
        self.regime_up_rate = ((beliefs[up_known] * labels[up_known, None]).sum(axis=0) + 1.0) / \
            (beliefs[up_known].sum(axis=0) + 2.0)
        self.cost = scaled_cost(view, train_rows)
        self.q_values = self._plan()
        self.summary = {"regime_mean_move": self.regime_move.tolist(), "regime_up_rate": self.regime_up_rate.tolist(),
                        "transition_diagonal": np.diag(self.transition).tolist(), "baum_welch_converged": bool(model.monitor_.converged)}
        context.log("dynamic decision network: " + ", ".join(
            f"regime {k} move {self.regime_move[k]:+.3f} up-rate {self.regime_up_rate[k]:.3f} stay {self.transition[k, k]:.3f}"
            for k in range(self.transition.shape[0])))
        return None

    def _plan(self) -> np.ndarray:
        """Q(R, a) at stage 0 from a flat position, by backward induction over (regime, position)."""
        horizon_bars = max(int(self.horizon), 1)
        drift = self.regime_move / horizon_bars                     # per-bar scaled drift of each regime
        gamma = float(self.parameters["discount_factor"])
        regimes = self.transition.shape[0]
        positions = DECISIONS
        value = np.zeros((regimes, positions.size))                 # V(R, position)
        q = np.zeros((regimes, positions.size, positions.size))
        for _ in range(int(self.parameters["planning_horizon"])):
            future = self.transition @ value                          # E[V(R', a) | R] for each action's new position
            reward = positions[None, None, :] * drift[:, None, None] - \
                self.cost * np.abs(positions[None, None, :] - positions[None, :, None]) / 2.0
            q = reward + gamma * future[:, None, :]
            value = q.max(axis=2)
        return q[:, 1, :]                                            # from flat

    def beliefs(self, features, rows) -> np.ndarray:
        """(rows, regimes) forward-filtered belief at each row over its last history_bars bars."""
        rows = np.asarray(rows, dtype=np.int64)
        window = int(self.parameters["history_bars"])
        if rows.size == 0:
            return np.empty((0, self.start.size))
        first, last = max(0, int(rows.min()) - window + 1), int(rows.max()) + 1
        block = np.asarray(features[first:last], dtype=np.float64)                    # rows <= the last asked row
        block_observed = np.all(np.isfinite(block), axis=1)
        block_emission = _log_emission((np.nan_to_num(block) - self.mean) @ self.components.T, self.means, self.variances)
        index = rows[:, None] + np.arange(-window + 1, 1, dtype=np.int64)[None, :]
        valid = index >= 0
        local = np.clip(index - first, 0, None)
        observed = valid & block_observed[local]
        log_emission = block_emission[local]                                             # (rows, window, K)
        belief = np.tile(self.start, (rows.size, 1))
        for step in range(window):
            if step > 0:
                belief = belief @ self.transition
            live = observed[:, step]
            if live.any():
                log_joint = np.log(np.maximum(belief[live], 1e-300)) + log_emission[live, step]
                log_joint -= log_joint.max(axis=1, keepdims=True)
                joint = np.exp(log_joint)
                belief[live] = joint / joint.sum(axis=1, keepdims=True)
        belief[~observed[:, -1]] = np.nan                     # the bar itself must be observed
        return belief

    def score(self, context, rows):
        belief = self.beliefs(context.features, rows)
        decision = belief @ self.q_values                      # QMDP
        return decision[:, 2] - decision[:, 0]

    def value(self, context, rows):
        belief = self.beliefs(context.features, rows)
        ahead = belief @ np.linalg.matrix_power(self.transition, max(int(self.horizon), 1))
        return ahead @ self.regime_move

    def state(self):
        return {"mean": self.mean.tolist(), "components": self.components.tolist(), "start": self.start.tolist(),
                "transition": self.transition.tolist(), "means": self.means.tolist(), "variances": self.variances.tolist(),
                "regimeMove": self.regime_move.tolist(), "regimeUpRate": self.regime_up_rate.tolist(), "cost": self.cost,
                "horizon": int(self.horizon), "qValues": self.q_values.tolist()}

    def load(self, state):
        for name, key in (("mean", "mean"), ("components", "components"), ("start", "start"), ("transition", "transition"),
                          ("means", "means"), ("variances", "variances"), ("regime_move", "regimeMove"),
                          ("regime_up_rate", "regimeUpRate"), ("q_values", "qValues")):
            setattr(self, name, np.asarray(state[key], dtype=np.float64))
        self.cost = float(state["cost"])
        self.horizon = int(state["horizon"])


__all__ = ["DynamicDecisionNetwork"]
