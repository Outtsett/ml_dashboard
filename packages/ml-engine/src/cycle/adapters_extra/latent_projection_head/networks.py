"""The torch encoders: autoencoder, deep clustering network, variational
autoencoder and the autoencoder-GAN fusion.

Each is trained on feature rows only (the finite rows of the fold's training
span), with early stopping on the VALIDATION rows' reconstruction (features,
never labels), through ``cycle.bridges.training.run_epochs`` so the Model
Cycle shows every epoch live. After training the encoder is frozen and copied
to float64 on the CPU for prediction: one bar alone and the same bar in a batch
give the same code, and a reloaded model gives the same code as the fitted one.

- ``autoencoder``: MLP encoder f(x) = z, decoder g(z) = x_hat, minimising the
  reconstruction MSE, optionally denoising (``input_noise``: Gaussian noise of
  that deviation added to the input only) and sparse (``sparsity_weight`` times
  the mean absolute code).
- ``deep_clustering``: the autoencoder pretrained for ``pretrain_epochs``, then
  cluster centres initialised by k-means on the codes and trained jointly on
  reconstruction + ``clustering_loss_weight`` * KL(P || Q), with Q the
  Student-t soft assignment of each code to the centres and P its sharpened
  target, recomputed over the whole training span every
  ``target_update_interval`` epochs. The head reads [z, Q].
- ``variational``: the encoder outputs a posterior mean and log-variance, a
  reparameterised draw is decoded, the loss is the negative ELBO: reconstruction
  + beta * KL(q(z|x) || N(0, I)), beta = ``divergence_weight`` warmed up linearly
  over ``warmup_epochs``. The head reads the posterior mean.
- ``adversarial_autoencoder``: encoder E, decoder / generator G, a latent
  discriminator D_z (the prior N(0, I) versus E(x)) and a data discriminator
  D_x (real rows versus G(z) from the prior), updated alternately:
  ``discriminator_steps`` discriminator updates, then one encoder / decoder
  update on reconstruction + ``adversarial_weight`` * (the non-saturating
  generator losses of both). The head reads E(x).
"""

from __future__ import annotations

import copy
import math
from pathlib import Path

import numpy as np

from cycle.bridges import persistence
from cycle.bridges.training import ValidationScore, run_epochs

from .encoders import ENCODER_FILE, Encoder, Standardiser

NETWORK_FILE = "encoder.pt"
TARGET_POWER = 2.0


def resolve_device(device: str) -> str:
    import torch

    if device in ("auto", "", None):
        return "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        return "cpu"
    return "cuda" if device == "cuda" else "cpu"


def _torch_modules():
    import torch
    from torch import nn

    class MultilayerPerceptron(nn.Module):
        def __init__(self, input_size: int, hidden_size: int, layer_count: int, output_size: int, dropout: float) -> None:
            super().__init__()
            layers: list[nn.Module] = []
            width = input_size
            for _ in range(max(1, layer_count)):
                layers += [nn.Linear(width, hidden_size), nn.SiLU()]
                if dropout > 0:
                    layers.append(nn.Dropout(dropout))
                width = hidden_size
            layers.append(nn.Linear(width, output_size))
            self.layers = nn.Sequential(*layers)

        def forward(self, values):
            return self.layers(values)

    class LatentAutoencoder(nn.Module):
        """Encoder, decoder and (deep clustering only) the cluster centres."""

        def __init__(self, feature_count: int, hidden_size: int, layer_count: int, latent_dimension: int,
                     dropout: float, variational: bool, cluster_count: int) -> None:
            super().__init__()
            self.variational = variational
            self.latent_dimension = latent_dimension
            self.encoder = MultilayerPerceptron(feature_count, hidden_size, layer_count,
                                                latent_dimension * (2 if variational else 1), dropout)
            self.decoder = MultilayerPerceptron(latent_dimension, hidden_size, layer_count, feature_count, dropout)
            self.centres = nn.Parameter(torch.zeros(cluster_count, latent_dimension)) if cluster_count > 0 else None

        def encode(self, values):
            output = self.encoder(values)
            if not self.variational:
                return output, None
            mean, log_variance = output[:, : self.latent_dimension], output[:, self.latent_dimension:]
            return mean, log_variance.clamp(-12.0, 8.0)

        def soft_assignment(self, codes):
            distance = torch.cdist(codes, self.centres) ** 2
            kernel = 1.0 / (1.0 + distance)
            return kernel / kernel.sum(dim=1, keepdim=True)

    return torch, nn, MultilayerPerceptron, LatentAutoencoder


def _sharpened(assignment):
    """DEC's target distribution: p_ik = (q_ik^2 / f_k) / sum_j (q_ij^2 / f_j), f_k = sum_i q_ik."""
    weight = assignment ** TARGET_POWER / assignment.sum(dim=0, keepdim=True)
    return weight / weight.sum(dim=1, keepdim=True)


class NetworkEncoder(Encoder):
    """One torch encoder variant (see the module docstring)."""

    epoch_trained = True

    def __init__(self, parameters: dict, seed: int, variant: str, device: str = "cpu") -> None:
        super().__init__(parameters, seed)
        self.name = variant
        self.device = device
        self.network = None             # the float64 CPU copy used for prediction
        self.feature_count = 0
        self.latent_dimension = 0

    # ── architecture ──
    @property
    def cluster_count(self) -> int:
        return int(self.parameters["cluster_count"]) if self.name == "deep_clustering" else 0

    @property
    def code_size(self) -> int:
        return self.latent_dimension + self.cluster_count

    def _build(self, feature_count: int):
        torch, _nn, _mlp, autoencoder = _torch_modules()
        self.feature_count = int(feature_count)
        self.latent_dimension = int(max(1, int(self.parameters["latent_dimension"])))
        return autoencoder(self.feature_count, int(self.parameters["hidden_size"]), int(self.parameters["layer_count"]),
                           self.latent_dimension, float(self.parameters["dropout"]), self.name == "variational",
                           self.cluster_count)

    # ── training ──
    def fit_epochs(self, train_matrix: np.ndarray, validation_matrix: np.ndarray, reporter, train_rows: np.ndarray) -> dict:
        torch, nn, mlp, _ = _torch_modules()
        torch.manual_seed(self.seed)
        generator = torch.Generator().manual_seed(self.seed)
        device = torch.device(self.device)
        self.standardiser = Standardiser.fit(train_matrix)
        train = torch.from_numpy(self.standardiser.apply(train_matrix).astype(np.float32))
        validation = torch.from_numpy(self.standardiser.apply(validation_matrix).astype(np.float32)).to(device)
        model = self._build(train.shape[1]).to(device)
        parameters = self.parameters
        learning_rate, weight_decay = float(parameters["learning_rate"]), float(parameters["weight_decay"])
        optimiser = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=weight_decay)
        batch_size = int(max(8, min(int(parameters["batch_size"]), train.shape[0])))
        epochs = int(parameters["epochs"])
        adversarial = self.name == "adversarial_autoencoder"
        if adversarial:
            hidden = int(parameters["hidden_size"])
            latent_critic = mlp(self.latent_dimension, hidden, 1, 1, 0.0).to(device)
            data_critic = mlp(train.shape[1], hidden, 1, 1, 0.0).to(device)
            critic_optimiser = torch.optim.Adam(list(latent_critic.parameters()) + list(data_critic.parameters()),
                                                lr=learning_rate, betas=(0.5, 0.999))
            binary = nn.BCEWithLogitsLoss()
        pretrain = int(min(int(parameters.get("pretrain_epochs", 0) or 0), max(0, epochs - 1))) \
            if self.name == "deep_clustering" else 0
        state = {"target": None, "critic_loss": None, "cluster_sizes": None}

        def normal(shape):
            return torch.randn(shape, generator=generator).to(device)

        def beta(epoch: int) -> float:
            warmup = int(parameters.get("warmup_epochs", 0) or 0)
            weight = float(parameters.get("divergence_weight", 1.0))
            return weight * min(1.0, epoch / warmup) if warmup > 0 else weight

        def encode_all(values):
            model.eval()
            with torch.no_grad():
                codes, _ = model.encode(values)
            model.train()
            return codes

        def initialise_centres() -> None:
            from sklearn.cluster import KMeans

            codes = encode_all(train.to(device)).cpu().double().numpy()
            centres = KMeans(n_clusters=self.cluster_count, n_init=10, random_state=self.seed).fit(codes).cluster_centers_
            with torch.no_grad():
                model.centres.copy_(torch.from_numpy(centres.astype(np.float32)).to(device))

        def update_target() -> None:
            with torch.no_grad():
                assignment = model.soft_assignment(encode_all(train.to(device)))
                state["target"] = _sharpened(assignment)
                sizes = torch.bincount(assignment.argmax(dim=1), minlength=self.cluster_count).cpu().numpy()
                state["cluster_sizes"] = sizes.tolist()
            reporter.log(f"deep clustering: cluster sizes on the training span {state['cluster_sizes']}")
            if int(sizes.max()) >= 0.95 * int(sizes.sum()):
                reporter.log("deep clustering: one cluster holds 95% of the bars or more (collapse)", "warning")

        def loss_on(batch, epoch: int, rows=None):
            """(total loss, reconstruction MSE) of one batch in training mode."""
            inputs = batch
            noise = float(parameters.get("input_noise", 0.0) or 0.0)
            if noise > 0:
                inputs = batch + noise * normal(batch.shape)
            mean, log_variance = model.encode(inputs)
            codes = mean
            if log_variance is not None:
                codes = mean + torch.exp(0.5 * log_variance) * normal(mean.shape)
            rebuilt = model.decoder(codes)
            reconstruction = ((rebuilt - batch) ** 2).mean()
            total = reconstruction
            sparsity = float(parameters.get("sparsity_weight", 0.0) or 0.0)
            if sparsity > 0:
                total = total + sparsity * mean.abs().mean()
            if log_variance is not None:
                divergence = (-0.5 * (1 + log_variance - mean ** 2 - log_variance.exp()).sum(dim=1)).mean()
                total = reconstruction * batch.shape[1] + beta(epoch) * divergence
            if self.cluster_count and epoch > pretrain and rows is not None:
                assignment = model.soft_assignment(mean)
                target = state["target"][rows]
                clustering = (target * (torch.log(target + 1e-10) - torch.log(assignment + 1e-10))).sum(dim=1).mean()
                total = total + float(parameters["clustering_loss_weight"]) * clustering
            if adversarial:
                prior = normal(mean.shape)
                total = total + float(parameters["adversarial_weight"]) * (
                    binary(latent_critic(mean), torch.ones(mean.shape[0], 1, device=device))
                    + binary(data_critic(model.decoder(prior)), torch.ones(mean.shape[0], 1, device=device)))
            return total, reconstruction

        def critic_step(batch) -> float:
            with torch.no_grad():
                codes, _ = model.encode(batch)
                prior = normal(codes.shape)
                generated = model.decoder(normal(codes.shape))
            ones = torch.ones(batch.shape[0], 1, device=device)
            zeros = torch.zeros(batch.shape[0], 1, device=device)
            loss = (binary(latent_critic(prior), ones) + binary(latent_critic(codes), zeros)
                    + binary(data_critic(batch), ones) + binary(data_critic(generated), zeros))
            critic_optimiser.zero_grad(set_to_none=True)
            loss.backward()
            critic_optimiser.step()
            return float(loss.detach().cpu())

        def train_epoch(epoch: int, report_batch) -> float:
            if self.cluster_count and epoch == pretrain + 1:
                initialise_centres()
                reporter.log(f"deep clustering: pretraining done after {pretrain} epochs; centres from k-means on the codes")
            if self.cluster_count and epoch > pretrain and (epoch - pretrain - 1) % int(parameters["target_update_interval"]) == 0:
                update_target()
            model.train()
            order = torch.randperm(train.shape[0], generator=generator)
            total_loss, total_rows, critic_losses = 0.0, 0, []
            batch_count = math.ceil(train.shape[0] / batch_size)
            for batch_number in range(batch_count):
                rows = order[batch_number * batch_size: (batch_number + 1) * batch_size]
                batch = train[rows].to(device)
                if adversarial:
                    for _ in range(int(parameters["discriminator_steps"])):
                        critic_losses.append(critic_step(batch))
                loss, reconstruction = loss_on(batch, epoch, rows.to(device))
                optimiser.zero_grad(set_to_none=True)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
                optimiser.step()
                total_loss += float(reconstruction.detach().cpu()) * batch.shape[0]
                total_rows += batch.shape[0]
            if critic_losses:
                state["critic_loss"] = float(np.mean(critic_losses))
            report_batch(1, 1, int(train_rows[0]), int(train_rows[-1]), total_loss / max(total_rows, 1),
                         learning_rate=learning_rate)
            return total_loss / max(total_rows, 1)

        def validate(epoch: int) -> ValidationScore:
            model.eval()
            with torch.no_grad():
                mean, _ = model.encode(validation)
                reconstruction = float(((model.decoder(mean) - validation) ** 2).mean().cpu())
                selection = reconstruction
                if self.cluster_count:
                    if epoch <= pretrain:
                        selection = None            # only joint-phase epochs compete for the best
                    else:
                        assignment = model.soft_assignment(mean)
                        target = _sharpened(assignment)
                        clustering = float((target * (torch.log(target + 1e-10) - torch.log(assignment + 1e-10)))
                                           .sum(dim=1).mean().cpu())
                        selection = reconstruction + float(parameters["clustering_loss_weight"]) * clustering
            model.train()
            return ValidationScore(reconstruction, None, None, selection)

        summary = run_epochs(
            reporter, epoch_count=epochs, train_index=train_rows, train_epoch=train_epoch, validate=validate,
            snapshot=lambda: copy.deepcopy(model.state_dict()), restore=model.load_state_dict,
            patience=int(parameters["patience"]), name=self.name,
        )
        self._freeze(model)
        summary = {key: value for key, value in summary.items() if key != "fit_seconds"}
        summary["encoder_trained_epochs"] = summary.pop("trained_epochs")
        summary["encoder_best_epoch"] = summary.pop("best_epoch")
        summary["encoder_validation_reconstruction"] = summary.pop("best_validation_loss")
        summary.pop("best_selection", None)
        summary["latent_dimension"] = self.latent_dimension
        if state["cluster_sizes"] is not None:
            summary["cluster_sizes"] = state["cluster_sizes"]
        if state["critic_loss"] is not None:
            summary["last_discriminator_loss"] = state["critic_loss"]
        return summary

    def _freeze(self, model) -> None:
        torch = _torch_modules()[0]
        frozen = copy.deepcopy(model).to(torch.device("cpu")).double().eval()
        for parameter in frozen.parameters():
            parameter.requires_grad_(False)
        self.network = frozen

    # ── prediction ──
    def posterior(self, matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray | None]:
        """The code (posterior mean for the VAE) and, for the VAE, the posterior deviation."""
        torch = _torch_modules()[0]
        standard = self.standardiser.apply(matrix)
        finite = np.all(np.isfinite(standard), axis=1)
        mean = np.full((standard.shape[0], self.latent_dimension), np.nan)
        deviation = np.full_like(mean, np.nan) if self.name == "variational" else None
        if finite.any():
            with torch.no_grad():
                code, log_variance = self.network.encode(torch.from_numpy(standard[finite]))
            mean[finite] = code.numpy()
            if deviation is not None:
                deviation[finite] = torch.exp(0.5 * log_variance).numpy()
        return mean, deviation

    def transform(self, matrix: np.ndarray) -> np.ndarray:
        codes, _ = self.posterior(matrix)
        if not self.cluster_count:
            return codes
        torch = _torch_modules()[0]
        assignment = np.full((codes.shape[0], self.cluster_count), np.nan)
        finite = np.all(np.isfinite(codes), axis=1)
        if finite.any():
            with torch.no_grad():
                assignment[finite] = self.network.soft_assignment(torch.from_numpy(codes[finite])).numpy()
        return np.concatenate([codes, assignment], axis=1)

    def reconstruction_error(self, matrix: np.ndarray) -> float:
        torch = _torch_modules()[0]
        codes, _ = self.posterior(matrix)
        with torch.no_grad():
            rebuilt = self.network.decoder(torch.from_numpy(codes)).numpy()
        return float(np.mean((rebuilt - self.standardiser.apply(matrix)) ** 2))

    # ── persistence ──
    def state_arrays(self) -> dict[str, np.ndarray]:
        arrays = {"mean": self.standardiser.mean, "scale": self.standardiser.scale}
        for name, tensor in self.network.state_dict().items():
            arrays["network." + name] = tensor.detach().cpu().numpy()
        return arrays

    def save(self, folder: Path) -> None:
        persistence.save_arrays(folder / ENCODER_FILE, mean=self.standardiser.mean, scale=self.standardiser.scale,
                                shape=np.array([self.feature_count, self.latent_dimension], dtype=np.int64))
        persistence.save_torch(folder / NETWORK_FILE, {name: tensor.detach().cpu().clone()
                                                       for name, tensor in self.network.state_dict().items()})

    def restore(self, folder: Path) -> None:
        arrays = persistence.load_arrays(folder / ENCODER_FILE)
        self.standardiser = Standardiser(arrays["mean"], arrays["scale"])
        model = self._build(int(arrays["shape"][0]))
        state = persistence.load_torch(folder / NETWORK_FILE)
        model = model.double()
        model.load_state_dict(state)
        self._freeze(model)


__all__ = ["NETWORK_FILE", "NetworkEncoder", "resolve_device"]
