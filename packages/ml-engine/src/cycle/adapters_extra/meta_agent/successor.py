"""Successor features for transfer (Barreto et al. 2017): evaluate a library of
policies once, then re-weight them for whatever reward the market is paying now.

- **Exposures and cumulants.** u(s) = [1, x_j for the ``base_policy_count``
  features with the largest training-span |information coefficient| against
  the price target]. The cumulant of taking position p(a) at bar s for one bar
  is phi(s, a) = [p(a) * u(s), -|p(a)| * c(s)], c(s) the round trip spread over
  the label horizon, in scaled units. A one-bar reward is
  r = p(a) * delta(s) - |p(a)| c(s), delta the scaled one-bar close move, and
  delta ~ u(s) . w: w are the "prices" the market pays per unit of each
  exposure (a drift and one factor return per followed feature).
- **The base policies**: flat, always long, always short, and follow / fade
  each followed feature (sign of x_j). Their successor features
  psi_i(s, a) = E[sum_k gamma^k phi(s_{t+k}, a_{t+k})], a_t = a, then pi_i,
  are learned by LSTD-Q (closed-form least-squares temporal difference, every
  action at every training bar, a session gap ends an episode) on a linear
  basis onehot(a) x [1, x_selected(s), c(s)].
- **Transfer (the causal part).** Once per block of ``adaptation_interval_bars``
  bars, w is re-fitted by ridge regression of the realised one-bar moves of the
  ``context_bars`` bars before the block (a move of bar r is known at r + 1)
  on their exposures, pulled toward the training span's w by
  ``regularization_strength`` (in bars' worth of evidence).
- **Action by generalised policy improvement**: Q(s, a) = max_i psi_i(s, a) . [w, 1];
  P(up) = sigmoid((Q(s, long) - Q(s, short)) / T), the temperature T fitted on
  validation rows only (``bridges.calibration.TemperatureScale``).

The position does not move the market, so the base policies' futures after
the first bar are the same whichever action is taken now, and the long-short
gap is essentially the current exposure priced at the re-fitted w: a rolling
factor-return call, which is what successor features reduce to here.
"""

from __future__ import annotations

import numpy as np
import torch

from cycle.adapters_extra.meta_agent.common import DTYPE, as_tensor, one_bar_moves
from cycle.adapters_extra.meta_agent.mechanism import Mechanism
from cycle.bridges.calibration import TemperatureScale
from cycle.bridges.training import score, single_fit

LSTD_RIDGE = 1e-7
TRAINING_RIDGE = 1e-3
ACTION_POSITIONS = (-1.0, 0.0, 1.0)


class SuccessorFeatureAgent(Mechanism):
    step_unit = "single_fit"

    def __init__(self, key, parameters, seed, task, feature_count) -> None:
        super().__init__(key, parameters, seed, task, feature_count)
        p = self.parameters
        self.followed = min(int(p["base_policy_count"]), self.feature_count)
        self.columns = np.arange(self.followed, dtype=np.int64)
        self.discount = float(p["discount_factor"])
        self.interval = int(p["adaptation_interval_bars"])
        self.context_count = int(p["context_bars"])
        self.ridge = float(p["regularization_strength"])
        self.successor: torch.Tensor | None = None       # (policies, 3 * basis, cumulants)
        self.training_weights = np.zeros(self.followed + 1)
        self.temperature = TemperatureScale(0.0, 0)

    # ── exposures, basis, cumulants ──
    def _cost(self, rows: np.ndarray) -> np.ndarray:
        view = self.view
        with np.errstate(invalid="ignore", divide="ignore"):
            return float(view.round_trip_cost_points) / np.asarray(view.move_scale[rows], dtype=np.float64) / int(view.horizon)

    def _exposure(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        return np.column_stack([np.ones(rows.size), features[rows][:, self.columns].astype(np.float64)])

    def _basis(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        """(n, 3, 3 * basis) the linear basis onehot(a) x [1, x_selected, c] of every action."""
        state = np.column_stack([self._exposure(features, rows), self._cost(rows)])
        width = state.shape[1]
        out = np.zeros((rows.size, 3, 3 * width))
        for action in range(3):
            out[:, action, action * width:(action + 1) * width] = state
        return out

    def _cumulants(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        """(n, 3, followed + 2) phi(s, a) for every action."""
        exposure = self._exposure(features, rows)
        cost = self._cost(rows)
        out = np.zeros((rows.size, 3, exposure.shape[1] + 1))
        for action, position in enumerate(ACTION_POSITIONS):
            out[:, action, :-1] = position * exposure
            out[:, action, -1] = -abs(position) * cost
        return out

    def _policy_actions(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        """(policies, n) the action index of each base policy at each row."""
        count = rows.size
        actions = [np.full(count, 1), np.full(count, 2), np.full(count, 0)]          # flat, long, short
        for column in self.columns:
            sign = np.sign(features[rows, column])
            actions.append(np.where(sign > 0, 2, np.where(sign < 0, 0, 1)))           # follow
            actions.append(np.where(sign > 0, 0, np.where(sign < 0, 2, 1)))           # fade
        return np.asarray(actions, dtype=np.int64)

    # ── fitting ──
    def fit(self, features, labels, train_index, validation_index, reporter) -> dict:
        train = np.asarray(train_index, dtype=np.int64)
        validation = np.asarray(validation_index, dtype=np.int64)
        first = int(train[0])
        view = self.view

        def fit_once():
            span = view.fit_rows(train)
            usable = span[np.all(np.isfinite(features[span]), axis=1) & np.isfinite(self._cost(span))]
            targets = np.asarray(view.price_targets[usable], dtype=np.float64)
            known = np.isfinite(targets)
            information = np.array([abs(np.corrcoef(features[usable[known], column], targets[known])[0, 1])
                                    for column in range(features.shape[1])])
            information = np.where(np.isfinite(information), information, 0.0)
            self.columns = np.sort(np.argsort(-information, kind="stable")[:self.followed]).astype(np.int64)
            reporter.log(f"{self.key}: followed features " + ", ".join(str(int(c)) for c in self.columns)
                         + f"; {3 + 2 * self.followed} base policies")
            current = usable[np.isin(usable + 1, usable)]
            following = current + 1
            terminal = np.asarray(view.one_bar_crosses_gap[current], dtype=bool)
            self.successor = self._lstd(features, current, following, terminal)
            moves = one_bar_moves(view, current)
            rows = current[np.isfinite(moves)]
            exposure = self._exposure(features, rows)
            gram = exposure.T @ exposure + TRAINING_RIDGE * rows.size * np.eye(exposure.shape[1])
            self.training_weights = np.linalg.solve(gram, exposure.T @ moves[np.isfinite(moves)])
            residual = moves[np.isfinite(moves)] - exposure @ self.training_weights
            self.cache = {}
            gap = self._gap(features, validation, first)
            self.temperature = TemperatureScale.fit(gap, np.asarray(labels, dtype=np.float64)[validation])
            reporter.log(f"{self.key}: temperature {self.temperature.temperature:.4g} from {self.temperature.row_count} "
                         "validation bars")
            self.cache = {}
            return float(np.mean(residual ** 2)) if residual.size else None

        def validate():
            probability = self.temperature.apply(self._gap(features, validation, first))
            self.cache = {}
            return score("classification", probability, np.asarray(labels)[validation])

        summary = single_fit(reporter, train_index=train, fit=fit_once, validate=validate if validation.size else None,
                             name=self.key)
        summary["followed_features"] = [int(column) for column in self.columns]
        return summary

    def _lstd(self, features, current, following, terminal) -> torch.Tensor:
        basis_now = as_tensor(self._basis(features, current))                       # (n, 3, D)
        basis_next = as_tensor(self._basis(features, following))
        cumulants = as_tensor(self._cumulants(features, current))                   # (n, 3, d)
        actions = torch.as_tensor(self._policy_actions(features, following))        # (P, n)
        continuing = as_tensor((~terminal).astype(np.float64))
        rows = torch.arange(current.size)
        width = basis_now.shape[-1]
        flat_now = basis_now.reshape(-1, width)                                      # every (row, action)
        right = flat_now.T @ cumulants.reshape(-1, cumulants.shape[-1])
        solutions = []
        for policy in range(actions.shape[0]):
            chosen_next = basis_next[rows, actions[policy]] * (self.discount * continuing)[:, None]  # (n, D)
            difference = basis_now - chosen_next[:, None, :]                        # (n, 3, D)
            matrix = flat_now.T @ difference.reshape(-1, width)
            matrix = matrix + LSTD_RIDGE * current.size * torch.eye(width, dtype=DTYPE)
            solutions.append(torch.linalg.solve(matrix, right))
        return torch.stack(solutions)

    # ── prediction ──
    def _weights(self, features: np.ndarray, anchor: int, first_row: int) -> np.ndarray:
        key = (int(anchor), int(first_row))
        if key in self.cache:
            return self.cache[key]
        start = max(int(first_row), int(anchor) - self.context_count, 0)
        rows = np.arange(start, int(anchor), dtype=np.int64)
        rows = rows[rows < features.shape[0]]
        rows = rows[np.all(np.isfinite(features[rows]), axis=1)] if rows.size else rows
        moves = one_bar_moves(self.view, rows) if rows.size else np.empty(0)
        known = np.isfinite(moves)
        exposure = self._exposure(features, rows[known])
        # the ridge pulls toward the training weights; a hair more keeps an empty context solvable
        pull = self.ridge + 1e-9
        gram = exposure.T @ exposure + pull * np.eye(exposure.shape[1])
        weights = np.linalg.solve(gram, exposure.T @ moves[known] + pull * self.training_weights)
        self.cache[key] = weights
        return weights

    def _gap(self, features: np.ndarray, rows: np.ndarray, first_row: int = 0) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        out = np.full(rows.size, np.nan)
        usable = np.all(np.isfinite(features[rows]), axis=1) & np.isfinite(self._cost(rows))
        anchors = (rows // self.interval) * self.interval
        for anchor in np.unique(anchors[usable]):
            positions = np.flatnonzero(usable & (anchors == anchor))
            weights = as_tensor(np.append(self._weights(features, int(anchor), first_row), 1.0))
            basis = as_tensor(self._basis(features, rows[positions]))                   # (m, 3, D)
            values = torch.einsum("mad,pdc,c->pma", basis, self.successor, weights)     # (P, m, 3)
            best = values.max(dim=0).values                                              # (m, 3)
            out[positions] = (best[:, 2] - best[:, 0]).numpy()
        return out

    def predict(self, features, rows) -> np.ndarray:
        self.require_view()
        return self.temperature.apply(self._gap(features, rows))

    # ── persistence ──
    def state(self) -> dict:
        return {"successor": self.successor.detach().clone(), "columns": [int(column) for column in self.columns],
                "training_weights": torch.as_tensor(self.training_weights, dtype=DTYPE),
                "temperature": self.temperature.to_dict()}

    def load_state(self, state: dict) -> None:
        self.successor = state["successor"].to(DTYPE)
        self.columns = np.asarray(state["columns"], dtype=np.int64)
        self.training_weights = state["training_weights"].numpy().astype(np.float64)
        self.temperature = TemperatureScale.from_dict(state["temperature"])


__all__ = ["SuccessorFeatureAgent"]
