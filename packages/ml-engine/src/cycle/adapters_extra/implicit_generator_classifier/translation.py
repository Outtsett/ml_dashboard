"""CycleGAN between the two direction domains (Zhu et al., 2017).

Domain A is the training rows whose outcome was down (the label, or a price
target <= 0), domain B those whose outcome was up; nothing pairs a row of A
with a row of B. Two residual translators G: A -> B and F: B -> A and two
least-squares discriminators D_A, D_B are trained with

    adversarial (LSGAN)  + cycle_consistency_weight * (|F(G(a)) - a| + |G(F(b)) - b|)
                         + identity_weight          * (|G(b) - b| + |F(a) - a|)

and the discriminators see generated rows through a replay buffer of the last
``replay_buffer_size`` generated rows (half of each batch is swapped with old
ones, as in the paper).

The identity term makes G leave a row that already looks like B almost
unchanged and F move it, and the reverse for an A-like row, so the direction
first direction score of a bar is the translation displacement

    displacement(x) = mean |F(x) - x| - mean |G(x) - x|      (positive = up-like)

and the second is the discriminator gap D_B(x) - D_A(x): how much more the bar
looks like a real up bar to D_B than like a real down bar to D_A. Neither is a
likelihood; the adapter maps the pair to P(up) with a three-parameter logistic
fitted on validation rows (``ValidationLogistic``), which weights each score by
how well it separated the validation bars (the displacement alone swings from
informative to inverted between epochs on overlapping domains, the
discriminator gap is steadier). The price model regresses the target on the two
displacement vectors and the gap.
"""

from __future__ import annotations

import copy

import numpy as np
import torch
from torch import nn

from .layers import ResidualTranslator, export_linears, multilayer, numpy_forward, numpy_translate

VALIDATION_PENALTY = 1e-3
NEWTON_ITERATIONS = 50


class ReplayBuffer:
    """The generated-row history the discriminator sees (Shrivastava et al., 2017)."""

    def __init__(self, size: int, random: np.random.Generator) -> None:
        self.size = int(size)
        self.random = random
        self.rows: torch.Tensor | None = None

    def query(self, fake: torch.Tensor) -> torch.Tensor:
        fake = fake.detach()
        if self.size <= 0:
            return fake
        if self.rows is None:
            self.rows = fake[: self.size].clone()
            return fake
        if self.rows.shape[0] < self.size:
            room = self.size - self.rows.shape[0]
            self.rows = torch.cat([self.rows, fake[:room]])
            return fake
        out = fake.clone()
        swap = self.random.random(fake.shape[0]) < 0.5
        slots = self.random.integers(0, self.size, fake.shape[0])
        for position in np.flatnonzero(swap):
            slot = int(slots[position])
            old = self.rows[slot].clone()
            self.rows[slot] = fake[position]
            out[position] = old
        return out


def _translator_blocks(translator: ResidualTranslator):
    layers = export_linears(translator)
    return [(layers[2 * position], layers[2 * position + 1]) for position in range(len(layers) // 2)]


class CycleTranslation:
    def __init__(self, x: np.ndarray, domain_b: np.ndarray, parameters: dict, device: str, seed: int) -> None:
        self.device = torch.device(device)
        self.random = np.random.default_rng(seed)
        feature_count = int(x.shape[1])
        hidden, layer_count = int(parameters["hidden_size"]), int(parameters["layer_count"])
        blocks = int(parameters["residual_block_count"])
        self.forward_translator = ResidualTranslator(feature_count, hidden, blocks).to(self.device)     # G: A -> B
        self.backward_translator = ResidualTranslator(feature_count, hidden, blocks).to(self.device)    # F: B -> A
        self.critic_a = multilayer(feature_count, hidden, layer_count, 1).to(self.device)
        self.critic_b = multilayer(feature_count, hidden, layer_count, 1).to(self.device)
        learning_rate = float(parameters["learning_rate"])
        self.translator_optimizer = torch.optim.Adam(
            [*self.forward_translator.parameters(), *self.backward_translator.parameters()], lr=learning_rate, betas=(0.5, 0.999))
        self.critic_optimizer = torch.optim.Adam([*self.critic_a.parameters(), *self.critic_b.parameters()],
                                                 lr=learning_rate, betas=(0.5, 0.999))
        self.cycle_weight = float(parameters["cycle_consistency_weight"])
        self.identity_weight = float(parameters["identity_weight"])
        self.batch_size = int(parameters["batch_size"])
        domain_b = np.asarray(domain_b, dtype=bool)
        self.domain_a = torch.as_tensor(x[~domain_b], dtype=torch.float32, device=self.device)
        self.domain_b = torch.as_tensor(x[domain_b], dtype=torch.float32, device=self.device)
        if self.domain_a.shape[0] < 2 or self.domain_b.shape[0] < 2:
            raise ValueError(f"CycleGAN needs training rows in both domains (down {self.domain_a.shape[0]}, "
                             f"up {self.domain_b.shape[0]})")
        self.buffer_a = ReplayBuffer(int(parameters["replay_buffer_size"]), self.random)
        self.buffer_b = ReplayBuffer(int(parameters["replay_buffer_size"]), self.random)
        self.last_losses: dict[str, float] = {}

    def modules(self) -> dict[str, nn.Module]:
        return {"forward_translator": self.forward_translator, "backward_translator": self.backward_translator,
                "critic_a": self.critic_a, "critic_b": self.critic_b}

    def train_epoch(self) -> float:
        size_a, size_b = self.domain_a.shape[0], self.domain_b.shape[0]
        count = max(1, int(round(max(size_a, size_b) / self.batch_size)))
        order_a = np.array_split(self.random.permutation(np.resize(np.arange(size_a), count * self.batch_size)), count)
        order_b = np.array_split(self.random.permutation(np.resize(np.arange(size_b), count * self.batch_size)), count)
        translator_losses, critic_losses, cycle_losses = [], [], []
        for batch_a, batch_b in zip(order_a, order_b):
            a = self.domain_a[torch.as_tensor(batch_a, device=self.device)]
            b = self.domain_b[torch.as_tensor(batch_b, device=self.device)]
            fake_b, fake_a = self.forward_translator(a), self.backward_translator(b)
            adversarial = ((self.critic_b(fake_b) - 1.0) ** 2).mean() + ((self.critic_a(fake_a) - 1.0) ** 2).mean()
            cycle = (self.backward_translator(fake_b) - a).abs().mean() + (self.forward_translator(fake_a) - b).abs().mean()
            identity = (self.forward_translator(b) - b).abs().mean() + (self.backward_translator(a) - a).abs().mean()
            loss = adversarial + self.cycle_weight * cycle + self.identity_weight * identity
            self.translator_optimizer.zero_grad(set_to_none=True)
            loss.backward()
            self.translator_optimizer.step()
            old_b, old_a = self.buffer_b.query(fake_b), self.buffer_a.query(fake_a)
            critic = 0.5 * (((self.critic_b(b) - 1.0) ** 2).mean() + (self.critic_b(old_b) ** 2).mean()
                            + ((self.critic_a(a) - 1.0) ** 2).mean() + (self.critic_a(old_a) ** 2).mean())
            self.critic_optimizer.zero_grad(set_to_none=True)
            critic.backward()
            self.critic_optimizer.step()
            translator_losses.append(loss.item())
            critic_losses.append(critic.item())
            cycle_losses.append(cycle.item())
        self.last_losses = {"translator": float(np.mean(translator_losses)), "discriminator": float(np.mean(critic_losses)),
                            "cycle": float(np.mean(cycle_losses))}
        return self.last_losses["translator"]

    def export(self) -> dict:
        for module in self.modules().values():
            module.eval()
        blocks = {"forward": _translator_blocks(self.forward_translator), "backward": _translator_blocks(self.backward_translator),
                  "critic_a": export_linears(self.critic_a), "critic_b": export_linears(self.critic_b)}
        for module in self.modules().values():
            module.train()
        return blocks

    def snapshot(self) -> dict:
        return {name: copy.deepcopy(module.state_dict()) for name, module in self.modules().items()}

    def restore(self, state: dict) -> None:
        for name, module in self.modules().items():
            module.load_state_dict(state[name])

    def state(self) -> dict:
        return {name: module.state_dict() for name, module in self.modules().items()}


def displacements(blocks: dict, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(G(x) - x, F(x) - x) in float64."""
    x = np.asarray(x, dtype=np.float64)
    return numpy_translate(blocks["forward"], x) - x, numpy_translate(blocks["backward"], x) - x


def discriminator_gap(blocks: dict, x: np.ndarray) -> np.ndarray:
    """D_B(x) - D_A(x) in float64: positive when the bar looks more like a real up bar."""
    x = np.asarray(x, dtype=np.float64)
    return (numpy_forward(blocks["critic_b"], x) - numpy_forward(blocks["critic_a"], x))[:, 0]


def direction_scores(blocks: dict, x: np.ndarray) -> np.ndarray:
    """(n, 2): the displacement score mean |F(x) - x| - mean |G(x) - x| and the discriminator gap."""
    forward, backward = displacements(blocks, x)
    return np.column_stack([np.abs(backward).mean(axis=1) - np.abs(forward).mean(axis=1), discriminator_gap(blocks, x)])


def displacement_design(blocks: dict, x: np.ndarray) -> np.ndarray:
    """[G(x) - x, F(x) - x, D_B(x) - D_A(x), 1]: the price model's regressors."""
    forward, backward = displacements(blocks, x)
    return np.concatenate([forward, backward, discriminator_gap(blocks, x)[:, None], np.ones((forward.shape[0], 1))], axis=1)


class ValidationLogistic:
    """P(up) = sigmoid(w . standardised scores + b), fitted on validation rows by
    Newton's method with a small ridge penalty on w (finite on separated or
    one-class rows). ``coefficients`` = [w_1, w_2, b], ``centre`` / ``spread``
    the validation scores' mean and standard deviation."""

    def __init__(self, coefficients, centre, spread) -> None:
        self.coefficients = np.asarray(coefficients, dtype=np.float64)
        self.centre = np.asarray(centre, dtype=np.float64)
        self.spread = np.asarray(spread, dtype=np.float64)

    @classmethod
    def fit(cls, scores: np.ndarray, label: np.ndarray) -> "ValidationLogistic":
        scores = np.asarray(scores, dtype=np.float64)
        label = np.asarray(label, dtype=np.float64)
        keep = np.all(np.isfinite(scores), axis=1) & np.isfinite(label)
        scores, label = scores[keep], (label[keep] >= 0.5).astype(np.float64)
        width = scores.shape[1]
        if scores.shape[0] == 0:
            return cls(np.zeros(width + 1), np.zeros(width), np.ones(width))
        centre = scores.mean(axis=0)
        spread = scores.std(axis=0)
        spread = np.where(spread > 1e-12, spread, 1.0)
        design = np.column_stack([(scores - centre) / spread, np.ones(scores.shape[0])])
        penalty = np.full(width + 1, VALIDATION_PENALTY * scores.shape[0])
        penalty[-1] = 1e-6 * scores.shape[0]
        weights = np.zeros(width + 1)
        for _ in range(NEWTON_ITERATIONS):
            probability = 1.0 / (1.0 + np.exp(-np.clip(design @ weights, -500, 500)))
            gradient = design.T @ (probability - label) + penalty * weights
            hessian = (design * (probability * (1 - probability))[:, None]).T @ design + np.diag(penalty)
            step = np.linalg.solve(hessian, gradient)
            weights = weights - step
            if float(np.max(np.abs(step))) < 1e-10:
                break
        return cls(weights, centre, spread)

    def apply(self, scores: np.ndarray) -> np.ndarray:
        scores = np.asarray(scores, dtype=np.float64)
        linear = ((scores - self.centre) / self.spread) @ self.coefficients[:-1] + self.coefficients[-1]
        out = 1.0 / (1.0 + np.exp(-np.clip(linear, -500, 500)))
        out[~np.all(np.isfinite(scores), axis=1)] = np.nan
        return out

    def to_array(self) -> np.ndarray:
        return np.concatenate([self.coefficients, self.centre, self.spread])

    @classmethod
    def from_array(cls, values: np.ndarray) -> "ValidationLogistic":
        values = np.asarray(values, dtype=np.float64)
        width = (values.size - 1) // 3
        return cls(values[: width + 1], values[width + 1: 2 * width + 1], values[2 * width + 1:])


__all__ = ["CycleTranslation", "ReplayBuffer", "ValidationLogistic", "direction_scores", "discriminator_gap",
           "displacement_design", "displacements"]
