"""Latent-variable densities: VAE, Dirichlet-process mixture, masked autoencoder.

``VariationalAutoencoder`` — a class-conditional VAE (Kingma and Welling 2014):
q(z | x, k) and p(x | z, k) Gaussian, prior N(0, I), trained on the ELBO with
``divergence_weight`` on the KL term. The score is the importance-weighted
bound (Burda et al. 2016) with ``importance_sample_count`` draws from ONE
fixed noise tensor: log p(x | k) >= logmeanexp_s [log p(x | z_s, k) +
log p(z_s) - log q(z_s | x, k)].

``BayesianMixture`` — the "Bayesian generator": per class, a Gaussian mixture
with a Dirichlet-process (stick-breaking) prior over its weights fitted by
variational Bayes (scikit-learn ``BayesianGaussianMixture``), on the
training rows whitened by a principal-component projection fitted on all
training rows. The prior prunes unused components, so the number of latent
states is inferred. The score is the log density of the posterior-mean
mixture (a proper density; the projection's Jacobian is shared by every class
and cancels). Scoring is numpy on the saved arrays.

``MaskedAutoencoder`` — the class-conditional masked autoencoder of the spec:
the row is cut into tokens of ``features_per_token`` columns, ``mask_ratio``
of them are hidden, a transformer encoder sees the visible tokens plus the
class token, a light decoder with mask tokens reconstructs the hidden ones
under a Gaussian with a learned per-column variance. The score is minus the
masked Gaussian negative log-likelihood averaged over ``scoring_mask_count``
FIXED masks (a pseudo-likelihood). ``mask_style = autoregressive_made``
replaces the random masks by MADE's autoregressive masks (Germain et al.
2015): a masked perceptron whose output i reads only columns < i, which is an
exact likelihood.
"""

from __future__ import annotations

import math

import numpy as np
import torch
from torch import nn

from .common import (
    LOG_TWO_PI,
    TorchDensity,
    fixed_normal,
    fixed_uniform,
    gaussian_log_density,
    multilayer_perceptron,
)

LOG_VARIANCE_RANGE = (-7.0, 5.0)


# ─── the variational autoencoder ───────────────────────────────────────────


class ConditionalVAE(nn.Module):
    def __init__(self, dimension: int, class_count: int, latent_dimension: int, hidden_size: int, layer_count: int,
                 embedding_size: int, importance_sample_count: int, seed: int) -> None:
        super().__init__()
        self.latent_dimension = int(latent_dimension)
        self.class_embedding = nn.Embedding(class_count, embedding_size)
        self.encoder = multilayer_perceptron(dimension + embedding_size, hidden_size, layer_count, 2 * latent_dimension)
        self.decoder = multilayer_perceptron(latent_dimension + embedding_size, hidden_size, layer_count, dimension)
        self.decoder_log_variance = nn.Parameter(torch.zeros(dimension))
        self.register_buffer("importance_noise", fixed_normal((max(1, importance_sample_count), latent_dimension), seed, 301))

    def encode(self, x, embedding):
        mean, log_variance = self.encoder(torch.cat([x, embedding], dim=1)).chunk(2, dim=1)
        return mean, log_variance.clamp(*LOG_VARIANCE_RANGE)

    def decode_log_density(self, x, z, embedding):
        mean = self.decoder(torch.cat([z, embedding], dim=-1))
        log_variance = self.decoder_log_variance.clamp(*LOG_VARIANCE_RANGE).to(x.dtype)
        return gaussian_log_density(x, mean, log_variance)


class VariationalAutoencoder(TorchDensity):
    def build(self) -> nn.Module:
        p = self.parameters
        return ConditionalVAE(self.dimension, self.class_count, int(p["latent_dimension"]), int(p["hidden_size"]),
                              int(p["layer_count"]), int(p["embedding_size"]), int(p["importance_sample_count"]), self.seed)

    def loss(self, network, x, y):
        embedding = network.class_embedding(y)
        mean, log_variance = network.encode(x, embedding)
        z = mean + torch.exp(0.5 * log_variance) * torch.randn_like(mean)
        reconstruction = network.decode_log_density(x, z, embedding)
        divergence = -0.5 * (1.0 + log_variance - mean ** 2 - torch.exp(log_variance)).sum(dim=1)
        return (-reconstruction + float(self.parameters["divergence_weight"]) * divergence).mean() / self.dimension

    def bound(self, network, x, classes):
        """The importance-weighted bound on log p(x | class), one fixed noise tensor for every row."""
        embedding = network.class_embedding(classes)
        mean, log_variance = network.encode(x, embedding)
        noise = network.importance_noise.to(x.dtype)                               # (S, L)
        spread = torch.exp(0.5 * log_variance)
        z = mean.unsqueeze(1) + spread.unsqueeze(1) * noise.unsqueeze(0)             # (n, S, L)
        samples = noise.shape[0]
        repeated_x = x.unsqueeze(1).expand(-1, samples, -1)
        repeated_embedding = embedding.unsqueeze(1).expand(-1, samples, -1)
        log_likelihood = network.decode_log_density(repeated_x, z, repeated_embedding)                 # (n, S)
        log_prior = -0.5 * (z ** 2).sum(dim=2) - 0.5 * z.shape[2] * LOG_TWO_PI
        log_posterior = gaussian_log_density(z, mean.unsqueeze(1), log_variance.unsqueeze(1))
        weights = log_likelihood + log_prior - log_posterior
        return torch.logsumexp(weights, dim=1) - math.log(samples)

    def class_scores(self, network, x):
        return torch.stack([self.bound(network, x, torch.full((x.shape[0],), k, dtype=torch.long, device=x.device))
                            for k in range(self.class_count)], dim=1)

    @property
    def evaluations_per_row(self) -> int:
        return int(self.parameters["importance_sample_count"])


# ─── the Dirichlet-process mixture (numpy) ─────────────────────────────────


def mixture_log_density(x: np.ndarray, weights: np.ndarray, means: np.ndarray, covariances: np.ndarray,
                        covariance_type: str) -> np.ndarray:
    """log sum_j w_j N(x; mean_j, covariance_j), float64; full covariances (m, p, p) or diagonal (m, p)."""
    count, width = x.shape
    columns = []
    for component in range(means.shape[0]):
        difference = x - means[component]
        if covariance_type == "full":
            factor = np.linalg.cholesky(covariances[component])
            solved = np.linalg.solve(factor, difference.T).T
            log_determinant = 2.0 * np.sum(np.log(np.diag(factor)))
        else:
            solved = difference / np.sqrt(covariances[component])
            log_determinant = float(np.sum(np.log(covariances[component])))
        columns.append(math.log(max(weights[component], 1e-300)) - 0.5 * (np.sum(solved ** 2, axis=1)
                                                                          + log_determinant + width * LOG_TWO_PI))
    stacked = np.column_stack(columns) if columns else np.full((count, 1), -np.inf)
    peak = stacked.max(axis=1, keepdims=True)
    return (peak + np.log(np.exp(stacked - peak).sum(axis=1, keepdims=True))).ravel()


class BayesianMixture:
    """Per-class Dirichlet-process Gaussian mixtures on whitened rows (see the module docstring)."""

    joint = False
    surrogate = False

    def __init__(self, dimension: int, class_count: int, parameters: dict, seed: int) -> None:
        self.dimension = int(dimension)
        self.class_count = int(class_count)
        self.parameters = dict(parameters)
        self.seed = int(seed)
        self.covariance_type = str(parameters.get("mixture_covariance", "full"))
        self.center = np.zeros(dimension)
        self.projection = np.eye(dimension)
        self.components: list[dict] = []

    def whiten(self, x: np.ndarray) -> np.ndarray:
        return (np.asarray(x, dtype=np.float64) - self.center) @ self.projection

    def fit(self, x: np.ndarray, y: np.ndarray, log) -> None:
        from sklearn.mixture import BayesianGaussianMixture
        from threadpoolctl import threadpool_limits

        x = np.asarray(x, dtype=np.float64)
        self.center = x.mean(axis=0)
        covariance = np.cov(x - self.center, rowvar=False).reshape(self.dimension, self.dimension)
        values, vectors = np.linalg.eigh(covariance)
        order = np.argsort(values)[::-1]
        keep = max(1, min(int(self.parameters["projection_component_count"]), self.dimension))
        chosen = order[:keep]
        self.projection = vectors[:, chosen] / np.sqrt(np.maximum(values[chosen], 1e-9))
        z = self.whiten(x)
        self.components = []
        for k in range(self.class_count):
            rows = z[y == k]
            if rows.shape[0] < 2:
                rows = z                                   # an empty bin borrows the pooled rows (its prior is tiny)
            count = int(min(int(self.parameters["component_count"]), max(1, rows.shape[0] // 5)))
            with threadpool_limits(1):
                model = BayesianGaussianMixture(
                    n_components=count, covariance_type=self.covariance_type,
                    weight_concentration_prior_type="dirichlet_process",
                    weight_concentration_prior=float(self.parameters["weight_concentration_prior"]),
                    max_iter=int(self.parameters["iteration_count"]), reg_covar=1e-4, init_params="kmeans",
                    random_state=self.seed + k).fit(rows)
            effective = int(np.sum(model.weights_ > 0.01))
            log(f"class {k}: {rows.shape[0]} rows, {count} components offered, {effective} kept by the "
                f"Dirichlet-process prior (weight > 0.01), converged {bool(model.converged_)}")
            self.components.append({"weights": np.asarray(model.weights_, dtype=np.float64),
                                    "means": np.asarray(model.means_, dtype=np.float64),
                                    "covariances": np.asarray(model.covariances_, dtype=np.float64)})

    def class_scores(self, x: np.ndarray) -> np.ndarray:
        z = self.whiten(x)
        return np.column_stack([mixture_log_density(z, c["weights"], c["means"], c["covariances"], self.covariance_type)
                                for c in self.components])

    def to_arrays(self) -> dict[str, np.ndarray]:
        arrays = {"center": self.center, "projection": self.projection}
        for k, component in enumerate(self.components):
            for name, values in component.items():
                arrays[f"class_{k}_{name}"] = values
        return arrays

    def from_arrays(self, arrays: dict[str, np.ndarray]) -> None:
        self.center = arrays["center"]
        self.projection = arrays["projection"]
        self.components = [{name: arrays[f"class_{k}_{name}"] for name in ("weights", "means", "covariances")}
                           for k in range(self.class_count)]


# ─── the masked autoencoder (random masks or MADE) ─────────────────────────


class MaskedLinear(nn.Linear):
    def __init__(self, input_size: int, output_size: int, mask: torch.Tensor) -> None:
        super().__init__(input_size, output_size)
        self.register_buffer("mask", mask.float())

    def forward(self, x):
        return nn.functional.linear(x, self.weight * self.mask.to(self.weight.dtype), self.bias)


class ConditionalMADE(nn.Module):
    """Gaussian autoregressive MADE: output i (mean, log variance) reads columns < i and the class."""

    def __init__(self, dimension: int, class_count: int, hidden_size: int, layer_count: int) -> None:
        super().__init__()
        self.class_count = class_count
        input_degrees = torch.arange(1, dimension + 1)
        top = max(1, dimension - 1)
        degrees = [input_degrees]
        layers = []
        width = dimension
        for _ in range(max(1, layer_count)):
            hidden_degrees = torch.arange(hidden_size) % top + 1
            mask = (hidden_degrees.unsqueeze(1) >= degrees[-1].unsqueeze(0))            # (out, in)
            layers.append(MaskedLinear(width, hidden_size, mask))
            degrees.append(hidden_degrees)
            width = hidden_size
        self.hidden_layers = nn.ModuleList(layers)
        self.class_input = nn.Linear(class_count, hidden_size)
        output_degrees = torch.cat([input_degrees, input_degrees])
        self.output = MaskedLinear(width, 2 * dimension, output_degrees.unsqueeze(1) > degrees[-1].unsqueeze(0))
        self.class_output = nn.Linear(class_count, 2 * dimension)
        self.activation = nn.SiLU()

    def forward(self, x, classes):
        one_hot = nn.functional.one_hot(classes, self.class_count).to(x.dtype)
        h = x
        for position, layer in enumerate(self.hidden_layers):
            h = layer(h)
            if position == 0:
                h = h + self.class_input(one_hot)
            h = self.activation(h)
        mean, log_variance = (self.output(h) + self.class_output(one_hot)).chunk(2, dim=1)
        return mean, log_variance.clamp(*LOG_VARIANCE_RANGE)

    def log_likelihood(self, x, classes):
        mean, log_variance = self(x, classes)
        return gaussian_log_density(x, mean, log_variance)


class ConditionalMaskedAutoencoder(nn.Module):
    def __init__(self, dimension: int, class_count: int, features_per_token: int, hidden_size: int,
                 decoder_hidden_size: int, layer_count: int, head_count: int, mask_ratio: float,
                 scoring_mask_count: int, seed: int) -> None:
        super().__init__()
        self.dimension = dimension
        self.width = max(1, int(features_per_token))
        self.token_count = math.ceil(dimension / self.width)
        self.visible_count = max(1, min(self.token_count - 1, round(self.token_count * (1.0 - mask_ratio)))) \
            if self.token_count > 1 else 1
        self.token_embedding = nn.Linear(self.width, hidden_size)
        self.class_token = nn.Embedding(class_count, hidden_size)
        self.encoder_position = nn.Parameter(torch.randn(self.token_count, hidden_size) * 0.02)
        heads = head_count if hidden_size % head_count == 0 else 1
        encoder_layer = nn.TransformerEncoderLayer(hidden_size, heads, 2 * hidden_size, 0.0, batch_first=True,
                                                   norm_first=True)
        self.encoder = nn.TransformerEncoder(encoder_layer, max(1, layer_count), enable_nested_tensor=False)
        self.bridge = nn.Linear(hidden_size, decoder_hidden_size)
        self.mask_token = nn.Parameter(torch.zeros(decoder_hidden_size))
        self.decoder_position = nn.Parameter(torch.randn(self.token_count, decoder_hidden_size) * 0.02)
        self.decoder_class = nn.Embedding(class_count, decoder_hidden_size)
        decoder_heads = head_count if decoder_hidden_size % head_count == 0 else 1
        decoder_layer = nn.TransformerEncoderLayer(decoder_hidden_size, decoder_heads, 2 * decoder_hidden_size, 0.0,
                                                   batch_first=True, norm_first=True)
        self.decoder = nn.TransformerEncoder(decoder_layer, 1, enable_nested_tensor=False)
        self.reconstruction = nn.Linear(decoder_hidden_size, self.width)
        self.column_log_variance = nn.Parameter(torch.zeros(self.token_count * self.width))
        padding = torch.zeros(self.token_count * self.width)
        padding[:dimension] = 1.0
        self.register_buffer("real_columns", padding.reshape(self.token_count, self.width))
        # the fixed scoring masks: each row of `scoring_orders` is a token permutation, the first
        # visible_count tokens visible
        uniform = fixed_uniform((max(1, scoring_mask_count), self.token_count), seed, 401)
        self.register_buffer("scoring_orders", torch.argsort(uniform, dim=1))

    def tokens(self, x):
        padded = nn.functional.pad(x, (0, self.token_count * self.width - self.dimension))
        return padded.reshape(x.shape[0], self.token_count, self.width)

    def masked_negative_log_likelihood(self, x, classes, orders):
        """Per row: the Gaussian NLL of the hidden tokens' real columns given the visible ones, for the
        token order of each row (n, T)."""
        count = x.shape[0]
        tokens = self.tokens(x)
        embedded = self.token_embedding(tokens) + self.encoder_position.to(x.dtype)
        visible = orders[:, :self.visible_count]
        gathered = embedded.gather(1, visible.unsqueeze(2).expand(-1, -1, embedded.shape[2]))
        encoded = self.encoder(torch.cat([self.class_token(classes).unsqueeze(1), gathered], dim=1))
        encoded_visible = self.bridge(encoded[:, 1:])
        sequence = self.mask_token.to(x.dtype).reshape(1, 1, -1).expand(count, self.token_count, -1).clone()
        sequence = sequence.scatter(1, visible.unsqueeze(2).expand(-1, -1, sequence.shape[2]), encoded_visible)
        sequence = sequence + self.decoder_position.to(x.dtype) + self.decoder_class(classes).unsqueeze(1)
        reconstructed = self.reconstruction(self.decoder(sequence))                     # (n, T, width)
        hidden = torch.ones(count, self.token_count, dtype=x.dtype, device=x.device)
        hidden = hidden.scatter(1, visible, 0.0)
        log_variance = self.column_log_variance.clamp(*LOG_VARIANCE_RANGE).to(x.dtype).reshape(self.token_count, self.width)
        per_value = 0.5 * ((tokens - reconstructed) ** 2 * torch.exp(-log_variance) + log_variance + LOG_TWO_PI)
        weight = hidden.unsqueeze(2) * self.real_columns.to(x.dtype).unsqueeze(0)
        return (per_value * weight).sum(dim=(1, 2))


class MaskedAutoencoder(TorchDensity):
    surrogate = True

    @property
    def style(self) -> str:
        return str(self.parameters.get("mask_style", "random_patch"))

    def build(self) -> nn.Module:
        p = self.parameters
        if self.style == "autoregressive_made":
            return ConditionalMADE(self.dimension, self.class_count, int(p["hidden_size"]), int(p["layer_count"]))
        return ConditionalMaskedAutoencoder(self.dimension, self.class_count, int(p["features_per_token"]),
                                            int(p["hidden_size"]), int(p["decoder_hidden_size"]), int(p["layer_count"]),
                                            4, float(p["mask_ratio"]), int(p["scoring_mask_count"]), self.seed)

    def loss(self, network, x, y):
        if self.style == "autoregressive_made":
            return -network.log_likelihood(x, y).mean() / self.dimension
        orders = torch.argsort(torch.rand(x.shape[0], network.token_count, device=x.device), dim=1)
        return network.masked_negative_log_likelihood(x, y, orders).mean() / self.dimension

    def class_scores(self, network, x):
        scores = []
        for k in range(self.class_count):
            classes = torch.full((x.shape[0],), k, dtype=torch.long, device=x.device)
            if self.style == "autoregressive_made":
                scores.append(network.log_likelihood(x, classes))
                continue
            masks = network.scoring_orders.shape[0]
            rows = x.repeat_interleave(masks, dim=0)
            orders = network.scoring_orders.repeat(x.shape[0], 1)
            negative = network.masked_negative_log_likelihood(rows, classes.repeat_interleave(masks), orders)
            scores.append(-negative.reshape(x.shape[0], masks).mean(dim=1))
        return torch.stack(scores, dim=1)

    @property
    def evaluations_per_row(self) -> int:
        return 1 if self.style == "autoregressive_made" else int(self.parameters["scoring_mask_count"])


__all__ = ["BayesianMixture", "ConditionalMADE", "MaskedAutoencoder", "VariationalAutoencoder", "mixture_log_density"]
