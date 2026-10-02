"""Probabilistic graphical model: an undirected pairwise Markov random field with hidden regime nodes.

Nodes: the ``input_feature_count`` most informative feature columns (each cut
into ``bin_count`` training-quantile bins, always observed), the target y
(up / down) and ``hidden_node_count`` hidden regime nodes h_i with
``hidden_state_count`` states each. Pairwise potentials (log-linear tables):
y - x_j, h_i - x_j, y - h_i, and a chain h_i - h_i+1 between the hidden nodes,
plus unary potentials on y and on each h_i. With the features clamped, the
graph left over y and the hidden nodes has a cycle y - h_1 - h_2 - y once there
are two hidden nodes, so inference is loopy.

Learning (torch, CPU, float64): maximise the conditional likelihood of y given
the clamped features on the training span, the hidden nodes summed out
exactly by enumerating their joint states (``hidden_state_count ** hidden_node_count``
configurations), with an L2 penalty (``weight_decay``) by Adam over ``epochs``,
early-stopped on the validation rows. Seeded initialisation breaks the
symmetry between hidden states.

Inference at a bar: clamp its feature bins (a missing feature drops its
potentials), then run damped loopy belief propagation (``iteration_count``
sweeps, damping ``message_damping``, stopping once no message moves by more
than 1e-6) and read the belief of y. The score is the log-odds of that belief.
"""

from __future__ import annotations

import itertools

import numpy as np

from cycle.adapters_extra.decision_graph.graphs import Engine
from cycle.adapters_extra.decision_graph.structure import Discretizer, select_columns

MESSAGE_TOLERANCE = 1e-6


class MarkovRandomField(Engine):
    iterative = True

    # ── learning ──
    def begin(self, context, train_rows, target, direction):
        import torch

        p = self.parameters
        features = context.features
        bin_count = int(p["bin_count"])
        columns = select_columns(features, train_rows, direction, int(p["input_feature_count"]), bin_count)
        self.discretizer = Discretizer.fit(features, train_rows, columns, bin_count)
        codes = self.discretizer.codes(features, train_rows)
        y = np.asarray(direction, dtype=np.float64)[train_rows]
        keep = np.isfinite(y)
        self._codes = torch.as_tensor(codes[keep], dtype=torch.long)
        self._y = torch.as_tensor(y[keep], dtype=torch.long)
        self.hidden_nodes = int(p["hidden_node_count"])
        self.hidden_states = int(p["hidden_state_count"])
        self.cardinalities = self.discretizer.cardinalities
        width = max(self.cardinalities) if self.cardinalities else 1
        generator = torch.Generator().manual_seed(self.seed)
        m, h, s = len(self.cardinalities), self.hidden_nodes, self.hidden_states
        self.parameters_torch = {
            "target": torch.zeros(2, dtype=torch.float64),
            "target_feature": torch.zeros(m, 2, width, dtype=torch.float64),
            "hidden": 0.1 * torch.randn(h, s, generator=generator, dtype=torch.float64),
            "hidden_feature": 0.1 * torch.randn(h, m, s, width, generator=generator, dtype=torch.float64),
            "target_hidden": 0.1 * torch.randn(h, 2, s, generator=generator, dtype=torch.float64),
            "hidden_chain": 0.1 * torch.randn(max(h - 1, 0), s, s, generator=generator, dtype=torch.float64),
        }
        for tensor in self.parameters_torch.values():
            tensor.requires_grad_(True)
        self.optimizer = torch.optim.Adam(list(self.parameters_torch.values()), lr=float(p["learning_rate"]))
        self._configurations = torch.as_tensor(list(itertools.product(range(s), repeat=h)), dtype=torch.long) \
            .reshape(-1, h)
        self._sync()
        context.log(f"Markov random field: {m} feature nodes x {bin_count} bins, {h} hidden nodes x {s} states "
                    f"({self._configurations.shape[0]} hidden configurations summed exactly in training)")

    def _energies(self, codes, parameters):
        """(rows, 2, configurations) log-potential of every (y, hidden configuration) with the features clamped."""
        import torch

        rows = codes.shape[0]
        m = codes.shape[1]
        observed = (codes >= 0).to(torch.float64)
        safe = codes.clamp(min=0)
        feature_index = torch.arange(m)
        # y - x_j: (rows, 2)
        target_part = parameters["target"][None, :] + (
            parameters["target_feature"][feature_index[None, :], :, safe] * observed[:, :, None]).sum(dim=1)
        energy = target_part[:, :, None].expand(rows, 2, self._configurations.shape[0]).clone()
        for i in range(self.hidden_nodes):
            states = self._configurations[:, i]                                          # (configurations,)
            hidden_feature = parameters["hidden_feature"][i][feature_index[None, :], :, safe]     # (rows, m, s)
            unary = parameters["hidden"][i][None, :] + (hidden_feature * observed[:, :, None]).sum(dim=1)   # (rows, s)
            energy = energy + unary[:, states][:, None, :] + parameters["target_hidden"][i][:, states][None, :, :]
            if i + 1 < self.hidden_nodes:
                energy = energy + parameters["hidden_chain"][i][states, self._configurations[:, i + 1]][None, None, :]
        return energy

    def _loss(self):
        import torch

        energy = self._energies(self._codes, self.parameters_torch)
        by_target = torch.logsumexp(energy, dim=2)                                       # (rows, 2)
        log_likelihood = by_target.gather(1, self._y[:, None]).squeeze(1) - torch.logsumexp(by_target, dim=1)
        penalty = sum((tensor ** 2).sum() for tensor in self.parameters_torch.values())
        return -log_likelihood.mean() + float(self.parameters["weight_decay"]) * penalty

    def train_epoch(self, epoch, report_batch):
        self.optimizer.zero_grad()
        loss = self._loss()
        loss.backward()
        self.optimizer.step()
        self._sync()
        report_batch(1, 1, 0, max(int(self._codes.shape[0]) - 1, 0), float(loss.detach()))
        return float(loss.detach())

    def _sync(self) -> None:
        """numpy copies of the potentials (what inference and the saved model use)."""
        self.tables = {name: tensor.detach().cpu().numpy().copy() for name, tensor in self.parameters_torch.items()}

    def snapshot(self):
        return {name: table.copy() for name, table in self.tables.items()}

    def restore(self, saved):
        import torch

        self.tables = {name: table.copy() for name, table in saved.items()}
        with torch.no_grad():
            for name, tensor in self.parameters_torch.items():
                tensor.copy_(torch.as_tensor(saved[name]))

    # ── inference: damped loopy belief propagation ──
    def unaries(self, codes: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Log unary potentials with the features clamped: y (rows, 2) and hidden (rows, H, S)."""
        rows, m = codes.shape
        observed = (codes >= 0).astype(np.float64)
        safe = np.clip(codes, 0, None)
        feature_index = np.arange(m)
        target = self.tables["target"][None, :] + (
            self.tables["target_feature"][feature_index[None, :], :, safe] * observed[:, :, None]).sum(axis=1)
        hidden = np.zeros((rows, self.hidden_nodes, self.hidden_states))
        for i in range(self.hidden_nodes):
            hidden[:, i] = self.tables["hidden"][i][None, :] + (
                self.tables["hidden_feature"][i][feature_index[None, :], :, safe] * observed[:, :, None]).sum(axis=1)
        return target, hidden

    def belief_propagation(self, codes: np.ndarray) -> np.ndarray:
        """P(y = up) per row by damped loopy belief propagation (sum-product, log domain)."""
        target_unary, hidden_unary = self.unaries(codes)
        rows, h, s = hidden_unary.shape
        damping = float(self.parameters["message_damping"])
        # edges: (y, h_i) with log potential target_hidden[i] (2 x s); (h_i, h_i+1) with hidden_chain[i] (s x s)
        to_hidden = np.zeros((rows, h, s))              # message y -> h_i
        to_target = np.zeros((rows, h, 2))              # message h_i -> y
        forward = np.zeros((rows, max(h - 1, 0), s))    # message h_i -> h_i+1
        backward = np.zeros((rows, max(h - 1, 0), s))   # message h_i+1 -> h_i

        def normalise(log_message):
            return log_message - np.logaddexp.reduce(log_message, axis=-1, keepdims=True)

        def send(log_input, log_pair):
            """log sum_a exp(log_input[a] + log_pair[a, b]) over rows."""
            return normalise(np.logaddexp.reduce(log_input[:, :, None] + log_pair[None, :, :], axis=1))

        active = np.ones(rows, dtype=bool)          # each row stops on its own convergence
        for _ in range(int(self.parameters["iteration_count"])):
            target_belief = target_unary + to_target.sum(axis=1)
            new_to_hidden = np.empty_like(to_hidden)
            new_to_target = np.empty_like(to_target)
            new_forward = np.empty_like(forward)
            new_backward = np.empty_like(backward)
            for i in range(h):
                pair = self.tables["target_hidden"][i]                                   # (2, s)
                new_to_hidden[:, i] = send(target_belief - to_target[:, i], pair)
                incoming = hidden_unary[:, i] + to_hidden[:, i]
                if i > 0:
                    incoming = incoming + forward[:, i - 1]
                if i + 1 < h:
                    incoming = incoming + backward[:, i]
                new_to_target[:, i] = send(incoming - to_hidden[:, i], pair.T)
                if i + 1 < h:
                    new_forward[:, i] = send(incoming - backward[:, i], self.tables["hidden_chain"][i])
                if i > 0:
                    new_backward[:, i - 1] = send(incoming - forward[:, i - 1], self.tables["hidden_chain"][i - 1].T)
            change = np.zeros(rows)
            for old, new in ((to_hidden, new_to_hidden), (to_target, new_to_target), (forward, new_forward),
                             (backward, new_backward)):
                if old.size:
                    damped = normalise(np.logaddexp(np.log(damping + 1e-300) + old, np.log(1.0 - damping) + new))                         if damping > 0 else new
                    change = np.maximum(change, np.abs(damped - old).reshape(rows, -1).max(axis=1))
                    old[active] = damped[active]            # a converged row keeps its messages (batch-independent)
            active &= change >= MESSAGE_TOLERANCE
            if not active.any():
                break
        belief = normalise(target_unary + to_target.sum(axis=1))
        return np.exp(belief[:, 1])

    def exact(self, codes: np.ndarray) -> np.ndarray:
        """P(y = up) by enumerating the hidden configurations (the tests' reference)."""
        import torch

        energy = self._energies(torch.as_tensor(codes, dtype=torch.long),
                                {name: torch.as_tensor(table) for name, table in self.tables.items()})
        by_target = torch.logsumexp(energy, dim=2)
        return torch.softmax(by_target, dim=1)[:, 1].numpy()

    def score(self, context, rows):
        codes = self.discretizer.codes(context.features, rows)
        missing = np.all(codes < 0, axis=1)
        probability = self.belief_propagation(codes) if codes.shape[0] else np.empty(0)
        probability = np.clip(probability, 1e-9, 1 - 1e-9)
        out = np.log(probability / (1 - probability))
        out[missing] = np.nan
        return out

    def state(self):
        return {"discretizer": self.discretizer.to_dict(), "hiddenNodes": self.hidden_nodes,
                "hiddenStates": self.hidden_states, "tables": {name: table.tolist() for name, table in self.tables.items()}}

    def load(self, state):
        import torch

        self.discretizer = Discretizer.from_dict(state["discretizer"])
        self.cardinalities = self.discretizer.cardinalities
        self.hidden_nodes = int(state["hiddenNodes"])
        self.hidden_states = int(state["hiddenStates"])
        self.tables = {name: np.asarray(table, dtype=np.float64) for name, table in state["tables"].items()}
        self._configurations = torch.as_tensor(list(itertools.product(range(self.hidden_states), repeat=self.hidden_nodes)),
                                               dtype=torch.long).reshape(-1, self.hidden_nodes)
        self._posterior_cache = {}


__all__ = ["MarkovRandomField"]
