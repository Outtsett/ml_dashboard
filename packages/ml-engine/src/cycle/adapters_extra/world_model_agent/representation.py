"""The representation blocks of the world-model agents (torch).

Each block turns the window of the last L feature rows into a state, and
carries the self-supervised loss that trains it:

    RowVariationalAutoencoder    World Models' V: one feature row -> z (reconstruction + KL)
    RecurrentStateSpaceModel     PlaNet / Dreamer RSSM: deterministic GRU path h and stochastic z,
                                 prior p(z|h), posterior q(z|h, x); decoders for the row, the
                                 reward (the scaled tape move) and the continuation (no session gap)
    VariationalRecurrentModel    VRNN (Chung et al. 2015): prior p(z_t|h_t-1), posterior
                                 q(z_t|x_t, h_t-1), decoder p(x_t|z_t, h_t-1), h_t = GRU(x_t, z_t, h_t-1)
    ContrastivePredictiveCoder   CPC (van den Oord et al. 2018): row encoder, GRU context, one
                                 linear predictor per step ahead, InfoNCE against the other windows
                                 of the batch
    WindowEncoder                a perceptron over the flattened window (DeepMDP, bisimulation,
                                 the model-free paths)
    HierarchicalVariationalModel a two-level VAE: z_top from the whole window, z_bottom from its
                                 last rows conditioned on z_top, with a learned p(z_bottom|z_top)

No block takes the agent's action as an input: the market does not react to
the agent's position, so an action-conditioned transition would learn to
ignore it. Prediction runs the deterministic path (posterior means); sampling
happens only in training, from a ``torch.Generator`` the adapter seeds.

``planning_agent`` imports ``RecurrentStateSpaceModel`` (read-only).
"""

from __future__ import annotations

import torch
from torch import nn
from torch.nn import functional

MINIMUM_STANDARD_DEVIATION = 0.1


def perceptron(input_size: int, hidden_size: int, output_size: int, layer_count: int = 2,
               activation: type[nn.Module] = nn.ELU) -> nn.Sequential:
    """``layer_count`` hidden layers of ``hidden_size`` then a linear output."""
    layers: list[nn.Module] = []
    size = int(input_size)
    for _ in range(max(0, int(layer_count))):
        layers += [nn.Linear(size, int(hidden_size)), activation()]
        size = int(hidden_size)
    layers.append(nn.Linear(size, int(output_size)))
    return nn.Sequential(*layers)


def gaussian(parameters: torch.Tensor, minimum: float = MINIMUM_STANDARD_DEVIATION) -> tuple[torch.Tensor, torch.Tensor]:
    """(mean, standard deviation) from a tensor whose last axis is [mean, raw scale]."""
    mean, raw = parameters.chunk(2, dim=-1)
    return mean, functional.softplus(raw) + minimum


def kullback_leibler(mean_q, std_q, mean_p, std_p) -> torch.Tensor:
    """KL(q || p) of two diagonal Gaussians, summed over the last axis."""
    variance_ratio = (std_q / std_p) ** 2
    difference = ((mean_q - mean_p) / std_p) ** 2
    return 0.5 * (variance_ratio + difference - 1.0 - torch.log(variance_ratio)).sum(-1)


def standard_kullback_leibler(mean, std) -> torch.Tensor:
    """KL(q || N(0, I)), summed over the last axis."""
    return 0.5 * (mean ** 2 + std ** 2 - 1.0 - 2.0 * torch.log(std)).sum(-1)


def sample(mean: torch.Tensor, std: torch.Tensor, generator: torch.Generator | None) -> torch.Tensor:
    """mean + std * noise (the reparameterisation); the mean when ``generator`` is None."""
    if generator is None:
        return mean
    noise = torch.randn(mean.shape, generator=generator, dtype=mean.dtype, device=mean.device)
    return mean + std * noise


def masked_mean(values: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    mask = mask.to(values.dtype)
    return (values * mask).sum() / mask.sum().clamp_min(1.0)


class RowVariationalAutoencoder(nn.Module):
    """World Models' vision model V on one feature row."""

    def __init__(self, feature_count: int, hidden_size: int, latent_dimension: int) -> None:
        super().__init__()
        self.latent_dimension = int(latent_dimension)
        self.encoder = perceptron(feature_count, hidden_size, 2 * latent_dimension, 1)
        self.decoder = perceptron(latent_dimension, hidden_size, feature_count, 1)

    def encode(self, rows: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        return gaussian(self.encoder(rows), 1e-3)

    def loss(self, rows: torch.Tensor, generator, kullback_leibler_weight: float) -> tuple[torch.Tensor, dict]:
        mean, std = self.encode(rows)
        latent = sample(mean, std, generator)
        reconstruction = ((self.decoder(latent) - rows) ** 2).sum(-1).mean()
        divergence = standard_kullback_leibler(mean, std).mean()
        return reconstruction + kullback_leibler_weight * divergence, {
            "reconstruction": float(reconstruction.detach()), "divergence": float(divergence.detach())}


class RecurrentStateSpaceModel(nn.Module):
    """The RSSM (Hafner et al. 2019), without an action input (see the module docstring)."""

    def __init__(self, feature_count: int, hidden_size: int, deterministic_size: int, stochastic_size: int) -> None:
        super().__init__()
        self.deterministic_size = int(deterministic_size)
        self.stochastic_size = int(stochastic_size)
        self.state_size = self.deterministic_size + self.stochastic_size
        self.embed = perceptron(feature_count, hidden_size, hidden_size, 1)
        self.cell = nn.GRUCell(self.stochastic_size, self.deterministic_size)
        self.prior = perceptron(self.deterministic_size, hidden_size, 2 * self.stochastic_size, 1)
        self.posterior = perceptron(self.deterministic_size + hidden_size, hidden_size, 2 * self.stochastic_size, 1)
        self.decoder = perceptron(self.state_size, hidden_size, feature_count, 1)
        self.reward = perceptron(self.state_size, hidden_size, 1, 1)
        self.continuation = perceptron(self.state_size, hidden_size, 1, 1)

    def initial(self, batch: int, like: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        return (like.new_zeros(batch, self.deterministic_size), like.new_zeros(batch, self.stochastic_size))

    def observe(self, window: torch.Tensor, generator=None) -> dict:
        """Filter the window: per step the deterministic h, the posterior z (sampled
        with ``generator``, the mean without) and both distributions."""
        batch, length, _ = window.shape
        h, z = self.initial(batch, window)
        embedded = self.embed(window)
        out = {key: [] for key in ("h", "z", "prior_mean", "prior_std", "posterior_mean", "posterior_std")}
        for step in range(length):
            h = self.cell(z, h)
            prior_mean, prior_std = gaussian(self.prior(h))
            posterior_mean, posterior_std = gaussian(self.posterior(torch.cat([h, embedded[:, step]], -1)))
            z = sample(posterior_mean, posterior_std, generator)
            for key, value in (("h", h), ("z", z), ("prior_mean", prior_mean), ("prior_std", prior_std),
                               ("posterior_mean", posterior_mean), ("posterior_std", posterior_std)):
                out[key].append(value)
        return {key: torch.stack(values, 1) for key, values in out.items()}

    def state(self, window: torch.Tensor) -> torch.Tensor:
        """The deterministic state [h_t, mean z_t] at the window's last bar."""
        observed = self.observe(window, None)
        return torch.cat([observed["h"][:, -1], observed["z"][:, -1]], -1)

    def imagine_step(self, h: torch.Tensor, z: torch.Tensor, generator=None) -> tuple[torch.Tensor, torch.Tensor]:
        """One step of the prior: h' = GRU(z, h), z' ~ p(z | h')."""
        h = self.cell(z, h)
        mean, std = gaussian(self.prior(h))
        return h, sample(mean, std, generator)

    def loss(self, batch: dict, generator, free_bits: float, kullback_leibler_weight: float,
             reward_key: str = "move_series") -> tuple[torch.Tensor, dict, dict]:
        """Reconstruction + reward + continuation + KL with free bits, over every window step."""
        observed = self.observe(batch["window"], generator)
        features = torch.cat([observed["h"], observed["z"]], -1)
        reconstruction = ((self.decoder(features) - batch["window"]) ** 2).sum(-1).mean()
        reward = masked_mean((self.reward(features).squeeze(-1) - batch[reward_key]) ** 2, batch[reward_key + "_mask"])
        continuation = functional.binary_cross_entropy_with_logits(
            self.continuation(features).squeeze(-1), batch["continuation_series"])
        divergence = kullback_leibler(observed["posterior_mean"], observed["posterior_std"],
                                      observed["prior_mean"], observed["prior_std"]).mean()
        total = reconstruction + reward + continuation + kullback_leibler_weight * torch.clamp(divergence, min=free_bits)
        return total, {"reconstruction": float(reconstruction.detach()), "reward": float(reward.detach()),
                       "divergence": float(divergence.detach())}, observed


class VariationalRecurrentModel(nn.Module):
    """The VRNN: the recurrence reads the observation, the decoder the previous context."""

    def __init__(self, feature_count: int, hidden_size: int, context_size: int, latent_dimension: int) -> None:
        super().__init__()
        self.context_size = int(context_size)
        self.latent_dimension = int(latent_dimension)
        self.state_size = self.context_size
        self.observation_features = perceptron(feature_count, hidden_size, hidden_size, 1)
        self.latent_features = perceptron(latent_dimension, hidden_size, hidden_size, 1)
        self.prior = perceptron(self.context_size, hidden_size, 2 * latent_dimension, 1)
        self.posterior = perceptron(hidden_size + self.context_size, hidden_size, 2 * latent_dimension, 1)
        self.decoder = perceptron(hidden_size + self.context_size, hidden_size, feature_count, 1)
        self.cell = nn.GRUCell(2 * hidden_size, self.context_size)
        self.reward = perceptron(self.context_size, hidden_size, 1, 1)

    def run(self, window: torch.Tensor, generator=None) -> dict:
        batch, length, _ = window.shape
        h = window.new_zeros(batch, self.context_size)
        observation = self.observation_features(window)
        out = {key: [] for key in ("h", "prior_mean", "prior_std", "posterior_mean", "posterior_std", "decoded")}
        for step in range(length):
            prior_mean, prior_std = gaussian(self.prior(h))
            posterior_mean, posterior_std = gaussian(self.posterior(torch.cat([observation[:, step], h], -1)))
            z = sample(posterior_mean, posterior_std, generator)
            latent = self.latent_features(z)
            decoded = self.decoder(torch.cat([latent, h], -1))
            h = self.cell(torch.cat([observation[:, step], latent], -1), h)
            for key, value in (("h", h), ("prior_mean", prior_mean), ("prior_std", prior_std),
                               ("posterior_mean", posterior_mean), ("posterior_std", posterior_std),
                               ("decoded", decoded)):
                out[key].append(value)
        return {key: torch.stack(values, 1) for key, values in out.items()}

    def state(self, window: torch.Tensor) -> torch.Tensor:
        return self.run(window, None)["h"][:, -1]

    def loss(self, batch: dict, generator, kullback_leibler_weight: float,
             reward_key: str = "move_series") -> tuple[torch.Tensor, dict, dict]:
        out = self.run(batch["window"], generator)
        reconstruction = ((out["decoded"] - batch["window"]) ** 2).sum(-1).mean()
        divergence = kullback_leibler(out["posterior_mean"], out["posterior_std"], out["prior_mean"],
                                      out["prior_std"]).mean()
        reward = masked_mean((self.reward(out["h"]).squeeze(-1) - batch[reward_key]) ** 2, batch[reward_key + "_mask"])
        total = reconstruction + reward + kullback_leibler_weight * divergence
        return total, {"reconstruction": float(reconstruction.detach()), "reward": float(reward.detach()),
                       "divergence": float(divergence.detach())}, out


class ContrastivePredictiveCoder(nn.Module):
    """CPC over the window; the context at the last bar is the state."""

    def __init__(self, feature_count: int, hidden_size: int, latent_dimension: int, prediction_step_count: int) -> None:
        super().__init__()
        self.latent_dimension = int(latent_dimension)
        self.prediction_step_count = int(prediction_step_count)
        self.state_size = int(hidden_size)
        self.encoder = perceptron(feature_count, hidden_size, latent_dimension, 1)
        self.context = nn.GRU(latent_dimension, hidden_size, batch_first=True)
        self.predictors = nn.Linear(hidden_size, latent_dimension * self.prediction_step_count)

    def run(self, window: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        latent = self.encoder(window)
        context, _ = self.context(latent)
        return latent, context

    def state(self, window: torch.Tensor) -> torch.Tensor:
        return self.run(window)[1][:, -1]

    def loss(self, window: torch.Tensor, temperature: float) -> tuple[torch.Tensor, dict, torch.Tensor]:
        """InfoNCE: from the context at step p, pick the true z_{p+k} among the z_{p+k} of every
        window in the batch (all training windows: the negatives never come from validation)."""
        latent, context = self.run(window)
        batch, length, _ = latent.shape
        predictions = self.predictors(context).view(batch, length, self.prediction_step_count, self.latent_dimension)
        target = functional.normalize(latent, dim=-1)
        losses = []
        labels = torch.arange(batch, device=window.device)
        for ahead in range(1, min(self.prediction_step_count, length - 1) + 1):
            predicted = functional.normalize(predictions[:, : length - ahead, ahead - 1], dim=-1)     # (B, P, Z)
            actual = target[:, ahead:]                                                                 # (B, P, Z)
            logits = torch.einsum("bpz,cpz->pbc", predicted, actual) / float(temperature)             # (P, B, B)
            losses.append(functional.cross_entropy(logits.reshape(-1, batch), labels.repeat(logits.shape[0])))
        total = torch.stack(losses).mean() if losses else context.sum() * 0.0
        return total, {"information_noise_contrastive": float(total.detach())}, context[:, -1]


class WindowEncoder(nn.Module):
    """A perceptron over the flattened window."""

    def __init__(self, feature_count: int, length: int, hidden_size: int, output_size: int) -> None:
        super().__init__()
        self.state_size = int(output_size)
        self.network = perceptron(int(feature_count) * int(length), hidden_size, output_size, 2)

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        return self.network(window.flatten(1))


class HierarchicalVariationalModel(nn.Module):
    """Two latent levels: z_top summarises the whole window (slow context), z_bottom the last
    ``bottom_length`` rows given z_top; p(z_top) = N(0, I), p(z_bottom | z_top) learned."""

    def __init__(self, feature_count: int, hidden_size: int, top_dimension: int, bottom_dimension: int,
                 bottom_length: int) -> None:
        super().__init__()
        self.bottom_length = int(bottom_length)
        self.top_dimension = int(top_dimension)
        self.bottom_dimension = int(bottom_dimension)
        self.state_size = self.top_dimension + self.bottom_dimension
        self.top_reader = nn.GRU(feature_count, hidden_size, batch_first=True)
        self.top_posterior = nn.Linear(hidden_size, 2 * top_dimension)
        self.bottom_posterior = perceptron(feature_count * self.bottom_length + top_dimension, hidden_size,
                                           2 * bottom_dimension, 1)
        self.bottom_prior = perceptron(top_dimension, hidden_size, 2 * bottom_dimension, 1)
        self.top_decoder = perceptron(top_dimension, hidden_size, feature_count, 1)
        self.bottom_decoder = perceptron(top_dimension + bottom_dimension, hidden_size,
                                         feature_count * self.bottom_length, 1)
        self.reward = perceptron(self.state_size, hidden_size, 1, 1)

    def run(self, window: torch.Tensor, generator=None) -> dict:
        read, _ = self.top_reader(window)
        top_mean, top_std = gaussian(self.top_posterior(read[:, -1]), 1e-3)
        top = sample(top_mean, top_std, generator)
        recent = window[:, -self.bottom_length:].flatten(1)
        bottom_mean, bottom_std = gaussian(self.bottom_posterior(torch.cat([recent, top], -1)), 1e-3)
        bottom = sample(bottom_mean, bottom_std, generator)
        prior_mean, prior_std = gaussian(self.bottom_prior(top), 1e-3)
        return {"top": top, "bottom": bottom, "top_mean": top_mean, "top_std": top_std, "bottom_mean": bottom_mean,
                "bottom_std": bottom_std, "prior_mean": prior_mean, "prior_std": prior_std, "recent": recent}

    def state(self, window: torch.Tensor) -> torch.Tensor:
        out = self.run(window, None)
        return torch.cat([out["top"], out["bottom"]], -1)

    def loss(self, batch: dict, generator, kullback_leibler_weight: float,
             reward_key: str = "move") -> tuple[torch.Tensor, dict, torch.Tensor]:
        window = batch["window"]
        out = self.run(window, generator)
        slow = ((self.top_decoder(out["top"]) - window.mean(1)) ** 2).sum(-1).mean()
        fast = ((self.bottom_decoder(torch.cat([out["top"], out["bottom"]], -1)) - out["recent"]) ** 2).sum(-1).mean()
        top_divergence = standard_kullback_leibler(out["top_mean"], out["top_std"]).mean()
        bottom_divergence = kullback_leibler(out["bottom_mean"], out["bottom_std"], out["prior_mean"],
                                             out["prior_std"]).mean()
        state = torch.cat([out["top"], out["bottom"]], -1)
        reward = masked_mean((self.reward(state).squeeze(-1) - batch[reward_key]) ** 2, batch[reward_key + "_mask"])
        total = slow + fast + reward + kullback_leibler_weight * (top_divergence + bottom_divergence)
        return total, {"reconstruction": float((slow + fast).detach()), "reward": float(reward.detach()),
                       "divergence": float((top_divergence + bottom_divergence).detach())}, state


__all__ = ["ContrastivePredictiveCoder", "HierarchicalVariationalModel", "RecurrentStateSpaceModel",
           "RowVariationalAutoencoder", "VariationalRecurrentModel", "WindowEncoder", "gaussian", "kullback_leibler",
           "masked_mean", "perceptron", "sample", "standard_kullback_leibler"]
