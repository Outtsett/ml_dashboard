"""The semi-supervised adversarial autoencoder (Makhzani et al., 2015, section 5).

The encoder q(z, y | x) splits a feature row into a continuous style code z
and a class distribution y (softmax over the classes); the decoder p(x | z, y)
rebuilds the row from both. Every training batch runs the paper's three phases:

1. reconstruction: the encoder and decoder minimise the squared error of the
   rebuilt row (``reconstruction_weight``) plus, on the batch's labelled rows,
   the cross-entropy of q(y | x) against the class (``supervised_weight``);
2. regularisation, discriminators: one discriminator tells z from N(0, I)
   draws, another tells q(y | x) from one-hot draws of the training class
   prior;
3. regularisation, encoder: the encoder is updated to fool both
   (``adversarial_weight``).

Rows of the training span whose target is not read (no label yet, or not a
training row) take part in phases 1 (reconstruction only) to 3: they are the
unlabelled pool that makes the model semi-supervised.

Prediction is the class head alone, q(y | x): the model's own posterior, no
synthetic-sample detour. ``sample`` draws rows from the decoder with z ~
N(0, I) and a one-hot class, which the adapter uses for the real-versus-fake
health number.
"""

from __future__ import annotations

import copy

import numpy as np
import torch
import torch.nn.functional as functional
from torch import nn

from .layers import NEGATIVE_SLOPE, export_linears, multilayer
from .problem import ClassProblem


class AdversarialAutoencoder:
    def __init__(self, problem: ClassProblem, parameters: dict, device: str, seed: int) -> None:
        self.problem = problem
        self.device = torch.device(device)
        self.random = np.random.default_rng(seed)
        self.noise_source = torch.Generator().manual_seed(int(seed))
        feature_count, class_count = problem.feature_count, problem.class_count
        hidden, latent = int(parameters["hidden_size"]), int(parameters["latent_dimension"])
        self.latent = latent
        self.class_count = class_count
        self.trunk = nn.Sequential(nn.Linear(feature_count, hidden), nn.LeakyReLU(NEGATIVE_SLOPE),
                                   nn.Linear(hidden, hidden), nn.LeakyReLU(NEGATIVE_SLOPE)).to(self.device)
        self.style_head = nn.Linear(hidden, latent).to(self.device)
        self.class_head = nn.Linear(hidden, class_count).to(self.device)
        self.decoder = multilayer(latent + class_count, hidden, 2, feature_count).to(self.device)
        self.style_critic = multilayer(latent, hidden, 2, 1).to(self.device)
        self.class_critic = multilayer(class_count, hidden, 2, 1).to(self.device)
        self.reconstruction_weight = float(parameters["reconstruction_weight"])
        self.adversarial_weight = float(parameters["adversarial_weight"])
        self.supervised_weight = float(parameters["supervised_weight"])
        self.batch_size = int(parameters["batch_size"])
        self.autoencoder_optimizer = torch.optim.Adam(
            [*self.trunk.parameters(), *self.style_head.parameters(), *self.class_head.parameters(),
             *self.decoder.parameters()], lr=float(parameters["learning_rate"]))
        self.critic_optimizer = torch.optim.Adam([*self.style_critic.parameters(), *self.class_critic.parameters()],
                                                 lr=float(parameters["discriminator_learning_rate"]), betas=(0.5, 0.999))
        present = problem.present
        prior = np.where(present, np.exp(np.where(present, problem.log_prior, 0.0)), 0.0)
        self.prior = prior / prior.sum()
        # labelled rows carry their class, the unlabelled pool -1
        self.x = torch.as_tensor(np.concatenate([problem.x, problem.unlabelled_x]), dtype=torch.float32, device=self.device)
        self.y = torch.as_tensor(np.concatenate([problem.classes, np.full(len(problem.unlabelled_x), -1)]),
                                 dtype=torch.long, device=self.device)
        self.last_losses: dict[str, float] = {}

    def modules(self) -> dict[str, nn.Module]:
        return {"trunk": self.trunk, "style_head": self.style_head, "class_head": self.class_head,
                "decoder": self.decoder, "style_critic": self.style_critic, "class_critic": self.class_critic}

    def encode(self, x):
        h = self.trunk(x)
        return self.style_head(h), self.class_head(h)

    def prior_classes(self, count: int) -> torch.Tensor:
        drawn = self.random.choice(self.class_count, size=int(count), p=self.prior)
        return functional.one_hot(torch.as_tensor(drawn, device=self.device), self.class_count).float()

    def train_epoch(self) -> float:
        for module in self.modules().values():
            module.train()
        order = self.random.permutation(self.x.shape[0])
        count = max(1, int(round(order.size / self.batch_size)))
        reconstruction_losses, supervised_losses, critic_losses, fooling_losses = [], [], [], []
        for batch in np.array_split(order, count):
            index = torch.as_tensor(batch, device=self.device)
            x, y = self.x[index], self.y[index]
            # 1. reconstruction (+ supervision on the labelled rows)
            style, logits = self.encode(x)
            rebuilt = self.decoder(torch.cat([style, functional.softmax(logits, dim=1)], dim=1))
            reconstruction = functional.mse_loss(rebuilt, x)
            labelled = y >= 0
            supervised = functional.cross_entropy(logits[labelled], y[labelled]) if bool(labelled.any()) else x.new_zeros(())
            loss = self.reconstruction_weight * reconstruction + self.supervised_weight * supervised
            self.autoencoder_optimizer.zero_grad(set_to_none=True)
            loss.backward()
            self.autoencoder_optimizer.step()
            # 2. the discriminators: prior draws are "real", the encoder's codes "fake"
            with torch.no_grad():
                style, logits = self.encode(x)
                class_code = functional.softmax(logits, dim=1)
            prior_style = torch.randn(x.shape[0], self.latent, generator=self.noise_source).to(self.device)
            prior_class = self.prior_classes(x.shape[0])
            critic = (functional.softplus(-self.style_critic(prior_style)).mean() + functional.softplus(self.style_critic(style)).mean()
                      + functional.softplus(-self.class_critic(prior_class)).mean()
                      + functional.softplus(self.class_critic(class_code)).mean())
            self.critic_optimizer.zero_grad(set_to_none=True)
            critic.backward()
            self.critic_optimizer.step()
            # 3. the encoder fools both (only the encoder's parameters receive gradients)
            style, logits = self.encode(x)
            fooling = (functional.softplus(-self.style_critic(style)).mean()
                       + functional.softplus(-self.class_critic(functional.softmax(logits, dim=1))).mean())
            self.autoencoder_optimizer.zero_grad(set_to_none=True)
            (self.adversarial_weight * fooling).backward()
            self.autoencoder_optimizer.step()
            reconstruction_losses.append(reconstruction.item())
            supervised_losses.append(supervised.item())
            critic_losses.append(critic.item())
            fooling_losses.append(fooling.item())
        self.last_losses = {"reconstruction": float(np.mean(reconstruction_losses)),
                            "supervised": float(np.mean(supervised_losses)),
                            "discriminator": float(np.mean(critic_losses)), "encoder_adversarial": float(np.mean(fooling_losses))}
        return self.reconstruction_weight * self.last_losses["reconstruction"] + self.supervised_weight * self.last_losses["supervised"]

    def class_probabilities(self, x: np.ndarray) -> np.ndarray:
        self.trunk.eval()
        with torch.no_grad():
            logits = self.class_head(self.trunk(torch.as_tensor(x, dtype=torch.float32, device=self.device)))
            return functional.softmax(logits.double(), dim=1).cpu().numpy()

    def sample(self, class_index: int, count: int) -> np.ndarray:
        with torch.no_grad():
            style = torch.randn(int(count), self.latent, generator=self.noise_source).to(self.device)
            classes = torch.full((int(count),), int(class_index), dtype=torch.long, device=self.device)
            code = functional.one_hot(classes, self.class_count).float()
            return self.decoder(torch.cat([style, code], dim=1)).float().cpu().numpy()

    def snapshot(self) -> dict:
        return {name: copy.deepcopy(module.state_dict()) for name, module in self.modules().items()}

    def restore(self, state: dict) -> None:
        for name, module in self.modules().items():
            module.load_state_dict(state[name])

    def export(self) -> list[tuple[np.ndarray, np.ndarray]]:
        """The class path, trunk then class head, as ``numpy_forward`` layers."""
        self.trunk.eval()
        return export_linears(self.trunk) + export_linears(self.class_head)

    def state(self) -> dict:
        return {name: module.state_dict() for name, module in self.modules().items()}


__all__ = ["AdversarialAutoencoder"]
