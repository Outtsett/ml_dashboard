"""Joint (unnormalised) densities: the energy-based model and the deep Boltzmann machine.

Both model p(x, k) up to ONE normaliser Z shared by every class, so the class
posterior is exact without it: P(k | x) = softmax_k(score_k(x)) with
score_k = log p(x, k) + log Z, and no class prior is added (the joint already
carries it). The adapter still fits one temperature on validation.

``JointEnergy`` — JEM (Grathwohl et al. 2020): an MLP f(x) with K outputs,
E(x, k) = -f(x)[k]. Training is cross-entropy on the labelled rows plus
``generative_weight`` times the maximum-likelihood gradient of
log p(x) = logsumexp_k f(x)[k] - log Z, with the log Z term estimated by
short-run stochastic gradient Langevin dynamics (``langevin_steps`` steps of
size ``langevin_step_size`` and noise ``langevin_noise``) from a persistent
replay buffer (5 % re-seeded from noise each step), and an
``energy_penalty`` on the squared energies. Real rows for the generative term
are the labelled batch plus the training span's unlabelled rows. A
non-finite or exploding generative term skips the step and re-seeds the
buffer (the usual SGLD divergence guard).

``DeepBoltzmannMachine`` — a two-hidden-layer Gaussian-Bernoulli DBM
(Salakhutdinov and Hinton 2009) whose visible layer is the standardised row
(unit-variance Gaussian units) plus a one-hot group of K class units.
Energy: E(x, y, h1, h2) = |x - b|^2 / 2 - x'W h1 - y'U h1 - h1'V h2 - c1'h1
- c2'h2 - d'y. Training: ``pretraining_epochs`` epochs of greedy layer-wise
CD-1 (the bottom RBM on (x, y), the top RBM on the bottom's hidden
probabilities), then ``epochs`` epochs of joint training with the mean-field
posterior for the data statistics and ``gibbs_chain_count`` persistent Gibbs
chains for the model statistics. The score is the mean-field variational
lower bound on log p~(x, y = k) after ``mean_field_steps`` fixed-point steps
from a fixed start: -E(x, k, mu1, mu2) + H(mu1) + H(mu2).
"""

from __future__ import annotations

import math

import torch
from torch import nn
from torch.nn import functional

from .common import TorchDensity, multilayer_perceptron

REPLAY_REINITIALISE_SHARE = 0.05
SAMPLE_CLAMP = 8.0


# ─── JEM ───────────────────────────────────────────────────────────────────


class JointEnergy(TorchDensity):
    joint = True
    selection = "posterior"

    def build(self) -> nn.Module:
        p = self.parameters
        return multilayer_perceptron(self.dimension, int(p["hidden_size"]), int(p["layer_count"]), self.class_count)

    def prepare(self, network, x, y, context) -> None:
        size = max(1, int(self.parameters["replay_buffer_size"]))
        self.replay = torch.randn(size, self.dimension, device=x.device)
        self.unlabelled = context.unlabelled

    def langevin(self, network, start: torch.Tensor) -> torch.Tensor:
        sample = start.clone().requires_grad_(True)
        step, noise = float(self.parameters["langevin_step_size"]), float(self.parameters["langevin_noise"])
        for _ in range(max(1, int(self.parameters["langevin_steps"]))):
            energy = torch.logsumexp(network(sample), dim=1).sum()
            gradient = torch.autograd.grad(energy, sample)[0]
            sample = (sample + step * gradient + noise * torch.randn_like(sample)).clamp(-SAMPLE_CLAMP, SAMPLE_CLAMP)
            sample = sample.detach().requires_grad_(True)
        return sample.detach()

    def train_epoch(self, network, optimizer, x, y, epoch, report_batch, context) -> float:
        batch_size = max(1, int(self.parameters["batch_size"]))
        order = torch.randperm(x.shape[0], device=x.device)
        batch_count = max(1, math.ceil(x.shape[0] / batch_size))
        weight = float(self.parameters["generative_weight"])
        penalty = float(self.parameters["energy_penalty"])
        total, seen = 0.0, 0
        for batch in range(batch_count):
            if batch:
                context.checkpoint()
            rows = order[batch * batch_size:(batch + 1) * batch_size]
            if rows.numel() == 0:
                continue
            real = x[rows]
            if self.unlabelled is not None and self.unlabelled.shape[0]:
                extra = torch.randint(0, self.unlabelled.shape[0], (max(1, rows.numel() // 4),), device=x.device)
                real = torch.cat([real, self.unlabelled[extra]])
            chosen = torch.randint(0, self.replay.shape[0], (rows.numel(),), device=x.device)
            start = self.replay[chosen]
            fresh = torch.rand(rows.numel(), device=x.device) < REPLAY_REINITIALISE_SHARE
            start = torch.where(fresh.unsqueeze(1), torch.randn_like(start), start)
            negative = self.langevin(network, start)
            self.replay[chosen] = negative
            optimizer.zero_grad(set_to_none=True)
            classification = functional.cross_entropy(network(x[rows]), y[rows])
            real_energy = torch.logsumexp(network(real), dim=1)
            negative_energy = torch.logsumexp(network(negative), dim=1)
            generative = -real_energy.mean() + negative_energy.mean()
            regulariser = penalty * ((real_energy ** 2).mean() + (negative_energy ** 2).mean())
            value = classification + weight * (generative + regulariser)
            if not torch.isfinite(value) or abs(float(generative.detach())) > 1e4:
                context.log(f"energy diverged at epoch {epoch}, batch {batch + 1}: step skipped, replay buffer re-seeded")
                self.replay = torch.randn_like(self.replay)
                continue
            value.backward()
            norm = float(torch.nn.utils.clip_grad_norm_(network.parameters(), 10.0))
            optimizer.step()
            total += float(value.detach()) * rows.numel()
            seen += rows.numel()
            report_batch(batch + 1, batch_count, context.train_start_row, context.train_end_row, float(value.detach()),
                         learning_rate=optimizer.param_groups[0]["lr"], gradient_norm=norm)
        return total / seen if seen else float("nan")

    def loss(self, network, x, y):          # the classification part alone (used by nothing but tests)
        return functional.cross_entropy(network(x), y)

    def class_scores(self, network, x):
        return network(x)


# ─── the deep Boltzmann machine ────────────────────────────────────────────


def _entropy(probability: torch.Tensor) -> torch.Tensor:
    p = probability.clamp(1e-7, 1.0 - 1e-7)
    return -(p * torch.log(p) + (1.0 - p) * torch.log(1.0 - p)).sum(dim=1)


class BoltzmannParameters(nn.Module):
    def __init__(self, dimension: int, class_count: int, first_hidden: int, second_hidden: int) -> None:
        super().__init__()
        self.visible_weight = nn.Parameter(torch.randn(dimension, first_hidden) * 0.01)       # W
        self.class_weight = nn.Parameter(torch.randn(class_count, first_hidden) * 0.01)       # U
        self.hidden_weight = nn.Parameter(torch.randn(first_hidden, second_hidden) * 0.01)    # V
        self.visible_bias = nn.Parameter(torch.zeros(dimension))                              # b
        self.class_bias = nn.Parameter(torch.zeros(class_count))                              # d
        self.first_bias = nn.Parameter(torch.zeros(first_hidden))                             # c1
        self.second_bias = nn.Parameter(torch.zeros(second_hidden))                           # c2

    def mean_field(self, x: torch.Tensor, y: torch.Tensor, steps: int) -> tuple[torch.Tensor, torch.Tensor]:
        """The fixed-point mean-field posterior q(h1) q(h2) given the visible (x, one-hot y)."""
        bottom_up = x @ self.visible_weight + y @ self.class_weight + self.first_bias
        first = torch.sigmoid(bottom_up)
        second = torch.sigmoid(first @ self.hidden_weight + self.second_bias)
        for _ in range(max(1, steps)):
            first = torch.sigmoid(bottom_up + second @ self.hidden_weight.T)
            second = torch.sigmoid(first @ self.hidden_weight + self.second_bias)
        return first, second

    def energy(self, x, y, first, second) -> torch.Tensor:
        return (0.5 * ((x - self.visible_bias) ** 2).sum(dim=1) - ((x @ self.visible_weight) * first).sum(dim=1)
                - ((y @ self.class_weight) * first).sum(dim=1) - ((first @ self.hidden_weight) * second).sum(dim=1)
                - first @ self.first_bias - second @ self.second_bias - y @ self.class_bias)

    def lower_bound(self, x, y, steps: int) -> torch.Tensor:
        first, second = self.mean_field(x, y, steps)
        return -self.energy(x, y, first, second) + _entropy(first) + _entropy(second)


class DeepBoltzmannMachine(TorchDensity):
    joint = True
    selection = "posterior"

    @property
    def pretraining_epochs(self) -> int:
        return int(self.parameters["pretraining_epochs"])

    @property
    def epoch_count(self) -> int:
        return self.pretraining_epochs + int(self.parameters["epochs"])

    def build(self) -> nn.Module:
        p = self.parameters
        return BoltzmannParameters(self.dimension, self.class_count, int(p["hidden_size"]), int(p["second_hidden_size"]))

    def one_hot(self, y: torch.Tensor, dtype) -> torch.Tensor:
        return functional.one_hot(y, self.class_count).to(dtype)

    def prepare(self, network, x, y, context) -> None:
        chains = max(1, int(self.parameters["gibbs_chain_count"]))
        start = torch.randint(0, x.shape[0], (chains,), device=x.device)
        self.chain_visible = x[start].clone()
        self.chain_class = self.one_hot(y[start], x.dtype)
        self.chain_second = torch.zeros(chains, network.second_bias.shape[0], device=x.device)

    def _set_gradients(self, network, statistics: dict) -> None:
        """Adam MINIMISES, so each gradient is minus (data statistic - model statistic)."""
        for name, value in statistics.items():
            getattr(network, name).grad = -value

    def _pretraining_step(self, network, x, y1):
        count = x.shape[0]
        first = torch.sigmoid(x @ network.visible_weight + y1 @ network.class_weight + network.first_bias)
        sampled = torch.bernoulli(first)
        visible = network.visible_bias + sampled @ network.visible_weight.T
        classes = torch.softmax(network.class_bias + sampled @ network.class_weight.T, dim=1)
        first_model = torch.sigmoid(visible @ network.visible_weight + classes @ network.class_weight + network.first_bias)
        second = torch.sigmoid(first @ network.hidden_weight + network.second_bias)
        second_sample = torch.bernoulli(second)
        first_reconstructed = torch.sigmoid(second_sample @ network.hidden_weight.T + network.first_bias)
        second_model = torch.sigmoid(first_reconstructed @ network.hidden_weight + network.second_bias)
        self._set_gradients(network, {
            "visible_weight": (x.T @ first - visible.T @ first_model) / count,
            "class_weight": (y1.T @ first - classes.T @ first_model) / count,
            "visible_bias": (x - visible).mean(dim=0),
            "class_bias": (y1 - classes).mean(dim=0),
            "first_bias": (first - first_model).mean(dim=0) + (first - first_reconstructed).mean(dim=0),
            "hidden_weight": (first.T @ second - first_reconstructed.T @ second_model) / count,
            "second_bias": (second - second_model).mean(dim=0),
        })
        return float(((x - visible) ** 2).mean())

    def _joint_step(self, network, x, y1, steps: int):
        count = x.shape[0]
        first, second = network.mean_field(x, y1, steps)
        # one Gibbs sweep of the persistent chains
        chain_first = torch.sigmoid(self.chain_visible @ network.visible_weight + self.chain_class @ network.class_weight
                                    + self.chain_second @ network.hidden_weight.T + network.first_bias)
        first_sample = torch.bernoulli(chain_first)
        chain_second = torch.sigmoid(first_sample @ network.hidden_weight + network.second_bias)
        self.chain_second = torch.bernoulli(chain_second)
        mean_visible = network.visible_bias + first_sample @ network.visible_weight.T
        self.chain_visible = (mean_visible + torch.randn_like(mean_visible)).clamp(-SAMPLE_CLAMP, SAMPLE_CLAMP)
        class_probability = torch.softmax(network.class_bias + first_sample @ network.class_weight.T, dim=1)
        self.chain_class = functional.one_hot(torch.multinomial(class_probability, 1).squeeze(1),
                                              self.class_count).to(x.dtype)
        chain_first = torch.sigmoid(self.chain_visible @ network.visible_weight + self.chain_class @ network.class_weight
                                    + self.chain_second @ network.hidden_weight.T + network.first_bias)
        chains = self.chain_visible.shape[0]
        self._set_gradients(network, {
            "visible_weight": x.T @ first / count - self.chain_visible.T @ chain_first / chains,
            "class_weight": y1.T @ first / count - self.chain_class.T @ chain_first / chains,
            "hidden_weight": first.T @ second / count - chain_first.T @ chain_second / chains,
            "visible_bias": x.mean(dim=0) - self.chain_visible.mean(dim=0),
            "class_bias": y1.mean(dim=0) - self.chain_class.mean(dim=0),
            "first_bias": first.mean(dim=0) - chain_first.mean(dim=0),
            "second_bias": second.mean(dim=0) - chain_second.mean(dim=0),
        })
        return float(-network.lower_bound(x, y1, steps).mean())

    def train_epoch(self, network, optimizer, x, y, epoch, report_batch, context) -> float:
        batch_size = max(1, int(self.parameters["batch_size"]))
        steps = int(self.parameters["mean_field_steps"])
        order = torch.randperm(x.shape[0], device=x.device)
        batch_count = max(1, math.ceil(x.shape[0] / batch_size))
        pretraining = epoch <= self.pretraining_epochs
        total, seen = 0.0, 0
        with torch.no_grad():
            for batch in range(batch_count):
                if batch:
                    context.checkpoint()
                rows = order[batch * batch_size:(batch + 1) * batch_size]
                if rows.numel() == 0:
                    continue
                batch_x, batch_y = x[rows], self.one_hot(y[rows], x.dtype)
                optimizer.zero_grad(set_to_none=True)
                value = self._pretraining_step(network, batch_x, batch_y) if pretraining else \
                    self._joint_step(network, batch_x, batch_y, steps)
                if not math.isfinite(value):
                    context.log(f"Boltzmann machine step {batch + 1} of epoch {epoch} was not finite; skipped")
                    continue
                norm = float(torch.nn.utils.clip_grad_norm_(network.parameters(), 10.0))
                optimizer.step()
                total += value * rows.numel()
                seen += rows.numel()
                report_batch(batch + 1, batch_count, context.train_start_row, context.train_end_row, value,
                             learning_rate=optimizer.param_groups[0]["lr"], gradient_norm=norm)
        if epoch == self.pretraining_epochs:
            context.log("greedy layer-wise pretraining finished; joint mean-field / persistent-chain training starts")
        return total / seen if seen else float("nan")

    def loss(self, network, x, y):
        return -network.lower_bound(x, self.one_hot(y, x.dtype), int(self.parameters["mean_field_steps"])).mean()

    def class_scores(self, network, x):
        steps = int(self.parameters["mean_field_steps"])
        return torch.stack([network.lower_bound(x, self.one_hot(torch.full((x.shape[0],), k, dtype=torch.long,
                                                                           device=x.device), x.dtype), steps)
                            for k in range(self.class_count)], dim=1)


__all__ = ["BoltzmannParameters", "DeepBoltzmannMachine", "JointEnergy"]
