"""Train on synthetic, test on real: the posterior classifier and the generator's health number.

``SyntheticPosterior`` is a small perceptron trained ONLY on the generator's
rows, the same number per class (``samples_per_class``). With balanced
classes its logits estimate log p_g(x | class) up to a shared constant, so
adding the log of the training class share gives Bayes' rule under the
generator's class laws:

    P(class k | x) = softmax_k( logit_k(x) + log prior_k )

It is early-stopped on the REAL validation rows (selection only; no validation
row is ever a training row of the classifier).

``real_versus_fake_accuracy`` measures how well the generator imitates the
market: a logistic regression on [x, x squared] (mean and spread differences)
learns to tell real training rows from generated rows, then is scored on real
validation rows against unseen generated rows. 0.5 means the two cannot be told
apart; near 1.0 means the synthetic rows the posterior was trained on are
visibly unlike real bars.
"""

from __future__ import annotations

import copy

import numpy as np
import torch
import torch.nn.functional as functional

from .layers import export_linears, multilayer, softmax


class SyntheticPosterior:
    def __init__(self, samples: np.ndarray, classes: np.ndarray, class_count: int, log_prior: np.ndarray,
                 parameters: dict, device: str, seed: int) -> None:
        self.device = torch.device(device)
        self.samples = torch.as_tensor(samples, dtype=torch.float32, device=self.device)
        self.classes = torch.as_tensor(classes, dtype=torch.long, device=self.device)
        self.log_prior = np.asarray(log_prior, dtype=np.float64)
        self.network = multilayer(samples.shape[1], int(parameters["hidden_size"]), 2, int(class_count)).to(self.device)
        self.optimizer = torch.optim.Adam(self.network.parameters(), lr=float(parameters["learning_rate"]))
        self.batch_size = max(32, int(parameters["batch_size"]))
        self.random = np.random.default_rng(seed)

    def train_epoch(self) -> float:
        self.network.train()
        order = self.random.permutation(self.samples.shape[0])
        count = max(1, int(round(order.size / self.batch_size)))
        losses = []
        for batch in np.array_split(order, count):
            index = torch.as_tensor(batch, device=self.device)
            loss = functional.cross_entropy(self.network(self.samples[index]), self.classes[index])
            self.optimizer.zero_grad(set_to_none=True)
            loss.backward()
            self.optimizer.step()
            losses.append(loss.item())
        return float(np.mean(losses))

    def probabilities(self, x: np.ndarray) -> np.ndarray:
        """(n, K) posterior in float64 (torch forward, then the prior)."""
        self.network.eval()
        with torch.no_grad():
            logits = self.network(torch.as_tensor(x, dtype=torch.float32, device=self.device)).double().cpu().numpy()
        return softmax(logits + self.log_prior[None, :])

    def snapshot(self) -> dict:
        return copy.deepcopy(self.network.state_dict())

    def restore(self, state: dict) -> None:
        self.network.load_state_dict(state)

    def export(self) -> list[tuple[np.ndarray, np.ndarray]]:
        self.network.eval()
        return export_linears(self.network)


def _quadratic(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    return np.concatenate([x, x * x], axis=1)


def real_versus_fake_accuracy(real_train: np.ndarray, fake_train: np.ndarray, real_validation: np.ndarray,
                              fake_validation: np.ndarray) -> float | None:
    """Held-out accuracy of a logistic regression telling real rows from generated ones (see the module docstring)."""
    from sklearn.linear_model import LogisticRegression

    if min(len(real_train), len(fake_train), len(real_validation), len(fake_validation)) == 0:
        return None
    train = np.concatenate([_quadratic(real_train), _quadratic(fake_train)])
    train_target = np.concatenate([np.ones(len(real_train)), np.zeros(len(fake_train))])
    centre, spread = train.mean(axis=0), train.std(axis=0) + 1e-9
    model = LogisticRegression(C=1.0, max_iter=500).fit((train - centre) / spread, train_target)
    held_out = np.concatenate([_quadratic(real_validation), _quadratic(fake_validation)])
    held_out_target = np.concatenate([np.ones(len(real_validation)), np.zeros(len(fake_validation))])
    # balanced accuracy: the two groups count equally whatever their sizes
    guess = model.predict((held_out - centre) / spread)
    real_hits = float(np.mean(guess[held_out_target == 1] == 1))
    fake_hits = float(np.mean(guess[held_out_target == 0] == 0))
    return 0.5 * (real_hits + fake_hits)


__all__ = ["SyntheticPosterior", "real_versus_fake_accuracy"]
