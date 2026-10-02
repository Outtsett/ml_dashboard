"""Denoising classifiers: DDPM (MLP or 1-D U-Net), score matching, perceptual diffusion.

Every model here is trained to undo Gaussian noise added to the standardised
row, conditioned on the class, and classifies by the diffusion-classifier
rule (Li et al. 2023; Clark and Jaini 2023): the class whose model denoises
the row best is the likely one. The denoising error is a surrogate of the
ELBO, so its scale is set by the validation temperature. The noise is ONE
fixed grid — ``scoring_noise_draws`` (step or level, noise vector) pairs,
steps spread evenly over the schedule, vectors drawn once from the seed and
stored with the model — reused for every row, so a bar's score is a
deterministic number whether it is scored alone or in a batch.

- ``Diffusion`` (``denoiser`` ``multilayer_perceptron`` or ``unet``): DDPM (Ho
  et al. 2020) with a cosine schedule of ``diffusion_steps`` steps and
  epsilon prediction; score_k = -mean_j |eps_j - eps_hat(x_t_j, t_j, k)|^2.
  The U-Net treats the row as a one-channel signal (zero-padded to a power of
  two) plus four learned position channels: residual blocks with GroupNorm
  and SiLU, the time and class embedding as a scale and shift in every
  block, strided down-sampling, self-attention at the bottleneck,
  transposed-convolution up-sampling with skip concatenation.
- ``ScoreMatching``: NCSN (Song and Ermon 2019) — a noise-conditional score
  network over ``noise_level_count`` geometric levels from
  ``largest_noise_level`` to ``smallest_noise_level``, trained by denoising
  score matching with weight sigma^2; score_k = -mean_j |sigma_j s(x + sigma_j
  n_j, sigma_j, k) + n_j|^2.
- ``PerceptualDiffusion``: the DDPM predicting the clean row, trained on the
  pixel error plus ``perceptual_weight`` times the distance between the
  clean and denoised rows in the hidden layers of a FROZEN denoising
  autoencoder fitted first on the training rows (``perceptual_epochs``
  epochs, ``perceptual_layer_count`` tapped layers): Johnson et al.'s
  perceptual loss with a learned feature space in place of VGG. The score is
  minus the same combined error.
"""

from __future__ import annotations

import math

import torch
from torch import nn

from .common import TorchDensity, fixed_normal, multilayer_perceptron, sinusoidal_embedding

TIME_EMBEDDING_SIZE = 32
POSITION_CHANNELS = 4


def cosine_signal_share(step_count: int) -> torch.Tensor:
    """alpha-bar_t for t = 1..T (index t - 1): the share of the clean row's variance left at step t."""
    s = 0.008
    grid = torch.arange(step_count + 1, dtype=torch.float64) / step_count
    curve = torch.cos((grid + s) / (1 + s) * math.pi / 2) ** 2
    return (curve / curve[0])[1:].clamp(1e-5, 0.9999).float()


def _groups(channels: int) -> int:
    for groups in (8, 4, 2, 1):
        if channels % groups == 0:
            return groups
    return 1


class Conditioning(nn.Module):
    """The time (or noise level) and class embedding every denoiser block receives."""

    def __init__(self, class_count: int, embedding_size: int, output_size: int) -> None:
        super().__init__()
        self.class_embedding = nn.Embedding(class_count, embedding_size)
        self.mix = nn.Sequential(nn.Linear(TIME_EMBEDDING_SIZE + embedding_size, output_size), nn.SiLU(),
                                 nn.Linear(output_size, output_size))

    def forward(self, time: torch.Tensor, classes: torch.Tensor) -> torch.Tensor:
        return self.mix(torch.cat([sinusoidal_embedding(time, TIME_EMBEDDING_SIZE), self.class_embedding(classes)], dim=1))


class PerceptronDenoiser(nn.Module):
    def __init__(self, dimension: int, class_count: int, hidden_size: int, layer_count: int, embedding_size: int) -> None:
        super().__init__()
        self.conditioning = Conditioning(class_count, embedding_size, hidden_size)
        self.network = multilayer_perceptron(dimension + hidden_size, hidden_size, layer_count, dimension)

    def forward(self, noisy, time, classes):
        return self.network(torch.cat([noisy, self.conditioning(time, classes)], dim=1))


class ResidualBlock(nn.Module):
    def __init__(self, input_channels: int, output_channels: int, embedding_size: int) -> None:
        super().__init__()
        self.first_norm = nn.GroupNorm(_groups(input_channels), input_channels)
        self.first = nn.Conv1d(input_channels, output_channels, 3, padding=1)
        self.embedding = nn.Linear(embedding_size, 2 * output_channels)          # scale and shift (FiLM)
        self.second_norm = nn.GroupNorm(_groups(output_channels), output_channels)
        self.second = nn.Conv1d(output_channels, output_channels, 3, padding=1)
        self.skip = nn.Conv1d(input_channels, output_channels, 1) if input_channels != output_channels else nn.Identity()

    def forward(self, h, embedding):
        a = self.first(nn.functional.silu(self.first_norm(h)))
        scale, shift = self.embedding(embedding).unsqueeze(2).chunk(2, dim=1)
        a = self.second(nn.functional.silu(self.second_norm(a) * (1.0 + scale) + shift))
        return self.skip(h) + a


class BottleneckAttention(nn.Module):
    def __init__(self, channels: int) -> None:
        super().__init__()
        self.norm = nn.GroupNorm(_groups(channels), channels)
        self.attention = nn.MultiheadAttention(channels, 1, batch_first=True)

    def forward(self, h):
        sequence = self.norm(h).transpose(1, 2)
        attended, _ = self.attention(sequence, sequence, sequence, need_weights=False)
        return h + attended.transpose(1, 2)


class UNetDenoiser(nn.Module):
    """A 1-D U-Net over the row as a one-channel signal (see the module docstring)."""

    def __init__(self, dimension: int, class_count: int, base_channel_count: int, stage_count: int,
                 embedding_size: int) -> None:
        super().__init__()
        self.dimension = dimension
        self.stage_count = max(1, int(stage_count))
        self.length = max(2 ** self.stage_count, 1 << max(0, math.ceil(math.log2(max(1, dimension)))))
        width = int(base_channel_count)
        emb = 4 * width
        self.conditioning = Conditioning(class_count, embedding_size, emb)
        # learned position channels: the columns are not translation invariant (column 0 is not column 7)
        self.position = nn.Parameter(torch.randn(POSITION_CHANNELS, self.length) * 0.1)
        self.input = nn.Conv1d(1 + POSITION_CHANNELS, width, 3, padding=1)
        self.down_blocks, self.down_samples = nn.ModuleList(), nn.ModuleList()
        channels = width
        for _ in range(self.stage_count):
            self.down_blocks.append(ResidualBlock(channels, channels, emb))
            self.down_samples.append(nn.Conv1d(channels, 2 * channels, 3, stride=2, padding=1))
            channels *= 2
        self.middle_first = ResidualBlock(channels, channels, emb)
        self.middle_attention = BottleneckAttention(channels)
        self.middle_second = ResidualBlock(channels, channels, emb)
        self.up_samples, self.up_blocks = nn.ModuleList(), nn.ModuleList()
        for _ in range(self.stage_count):
            self.up_samples.append(nn.ConvTranspose1d(channels, channels // 2, 2, stride=2))
            channels //= 2
            self.up_blocks.append(ResidualBlock(2 * channels, channels, emb))
        self.output_norm = nn.GroupNorm(_groups(channels), channels)
        self.output = nn.Conv1d(channels, 1, 3, padding=1)
        nn.init.zeros_(self.output.weight)
        nn.init.zeros_(self.output.bias)

    def forward(self, noisy, time, classes):
        embedding = self.conditioning(time, classes)
        signal = nn.functional.pad(noisy, (0, self.length - self.dimension)).unsqueeze(1)
        position = self.position.to(noisy.dtype).unsqueeze(0).expand(noisy.shape[0], -1, -1)
        h = self.input(torch.cat([signal, position], dim=1))
        skips = []
        for block, down in zip(self.down_blocks, self.down_samples):
            h = block(h, embedding)
            skips.append(h)
            h = down(h)
        h = self.middle_second(self.middle_attention(self.middle_first(h, embedding)), embedding)
        for up, block in zip(self.up_samples, self.up_blocks):
            h = block(torch.cat([up(h), skips.pop()], dim=1), embedding)
        return self.output(nn.functional.silu(self.output_norm(h))).squeeze(1)[:, :self.dimension]


class DenoisingNetwork(nn.Module):
    """A denoiser plus its schedule and the fixed scoring grid (buffers, saved with the weights)."""

    def __init__(self, denoiser: nn.Module, signal_share: torch.Tensor, grid_steps: torch.Tensor,
                 grid_noise: torch.Tensor) -> None:
        super().__init__()
        self.denoiser = denoiser
        self.register_buffer("signal_share", signal_share)
        self.register_buffer("grid_steps", grid_steps)
        self.register_buffer("grid_noise", grid_noise)

    def forward(self, noisy, time, classes):
        return self.denoiser(noisy, time, classes)


def _grid_steps(draws: int, step_count: int) -> torch.Tensor:
    """Evenly spread steps 1..T (0-based indices), deterministic."""
    positions = torch.linspace(0, step_count - 1, max(1, draws))
    return positions.round().long()


class Diffusion(TorchDensity):
    surrogate = True

    @property
    def draws(self) -> int:
        return max(1, int(self.parameters["scoring_noise_draws"]))

    @property
    def evaluations_per_row(self) -> int:
        return self.draws

    def make_denoiser(self) -> nn.Module:
        p = self.parameters
        if str(p.get("denoiser", "multilayer_perceptron")) == "unet":
            return UNetDenoiser(self.dimension, self.class_count, int(p["base_channel_count"]), int(p["stage_count"]),
                                int(p["embedding_size"]))
        return PerceptronDenoiser(self.dimension, self.class_count, int(p["hidden_size"]), int(p["layer_count"]),
                                  int(p["embedding_size"]))

    def build(self) -> nn.Module:
        steps = int(self.parameters["diffusion_steps"])
        return DenoisingNetwork(self.make_denoiser(), cosine_signal_share(steps), _grid_steps(self.draws, steps),
                                fixed_normal((self.draws, self.dimension), self.seed, 501))

    def noisy(self, network, x, steps, noise):
        share = network.signal_share.to(x.dtype)[steps].unsqueeze(1)
        return torch.sqrt(share) * x + torch.sqrt(1.0 - share) * noise

    def time(self, network, steps, dtype):
        return (steps.to(dtype) + 1.0) / network.signal_share.shape[0]

    def error(self, network, x, classes, steps, noise):
        """Per row: the denoising error the class's model makes (lower is more likely)."""
        predicted = network(self.noisy(network, x, steps, noise), self.time(network, steps, x.dtype), classes)
        return ((predicted - noise) ** 2).sum(dim=1)

    def loss(self, network, x, y):
        steps = torch.randint(0, network.signal_share.shape[0], (x.shape[0],), device=x.device)
        return self.error(network, x, y, steps, torch.randn_like(x)).mean() / self.dimension

    def grid(self, network, x):
        """The fixed grid, one (step, noise) per draw, repeated for every row: (n * D,) steps, (n * D, d) noise."""
        draws = network.grid_steps.shape[0]
        return network.grid_steps.repeat(x.shape[0]), network.grid_noise.to(x.dtype).repeat(x.shape[0], 1), draws

    def class_scores(self, network, x):
        steps, noise, draws = self.grid(network, x)
        rows = x.repeat_interleave(draws, dim=0)
        scores = []
        for k in range(self.class_count):
            classes = torch.full((rows.shape[0],), k, dtype=torch.long, device=x.device)
            scores.append(-self.error(network, rows, classes, steps, noise).reshape(x.shape[0], draws).mean(dim=1))
        return torch.stack(scores, dim=1)


class ScoreMatching(Diffusion):
    def build(self) -> nn.Module:
        p = self.parameters
        levels = torch.exp(torch.linspace(math.log(float(p["largest_noise_level"])),
                                          math.log(float(p["smallest_noise_level"])), max(1, int(p["noise_level_count"]))))
        grid = torch.arange(self.draws) % levels.shape[0]
        denoiser = PerceptronDenoiser(self.dimension, self.class_count, int(p["hidden_size"]), int(p["layer_count"]),
                                      int(p["embedding_size"]))
        return DenoisingNetwork(denoiser, levels.float(), grid.long(), fixed_normal((self.draws, self.dimension), self.seed, 601))

    def error(self, network, x, classes, steps, noise):
        """sigma^2 |s(x + sigma n, sigma, k) + n / sigma|^2 with s = network / sigma (the NCSN parametrisation)."""
        levels = network.signal_share.to(x.dtype)                     # here: the noise levels sigma
        sigma = levels[steps].unsqueeze(1)
        position = torch.log(sigma.squeeze(1) / levels.min()) / torch.log(levels.max() / levels.min()).clamp_min(1e-6)
        output = network(x + sigma * noise, position, classes)        # sigma * score
        return ((output + noise) ** 2).sum(dim=1)


class PerceptualNetwork(DenoisingNetwork):
    def __init__(self, denoiser, signal_share, grid_steps, grid_noise, dimension: int, hidden_size: int,
                 perceptual_layer_count: int) -> None:
        super().__init__(denoiser, signal_share, grid_steps, grid_noise)
        widths = [max(4, hidden_size // (2 ** layer)) for layer in range(max(1, perceptual_layer_count))]
        encoder, width = [], dimension
        for size in widths:
            encoder.append(nn.Sequential(nn.Linear(width, size), nn.SiLU()))
            width = size
        self.feature_encoder = nn.ModuleList(encoder)
        self.feature_decoder = nn.Linear(width, dimension)

    def features(self, x):
        taps, h = [], x
        for layer in self.feature_encoder:
            h = layer(h)
            taps.append(h)
        return taps

    def reconstruct(self, x):
        return self.feature_decoder(self.features(x)[-1])


class PerceptualDiffusion(Diffusion):
    def build(self) -> nn.Module:
        p = self.parameters
        steps = int(p["diffusion_steps"])
        denoiser = PerceptronDenoiser(self.dimension, self.class_count, int(p["hidden_size"]), int(p["layer_count"]),
                                      int(p["embedding_size"]))
        return PerceptualNetwork(denoiser, cosine_signal_share(steps), _grid_steps(self.draws, steps),
                                 fixed_normal((self.draws, self.dimension), self.seed, 701), self.dimension,
                                 int(p["hidden_size"]), int(p["perceptual_layer_count"]))

    def prepare(self, network, x, y, context) -> None:
        """Stage 0: the denoising autoencoder whose hidden layers are the perceptual feature space,
        fitted on the training rows, then frozen."""
        parameters = list(network.feature_encoder.parameters()) + list(network.feature_decoder.parameters())
        optimizer = torch.optim.Adam(parameters, lr=float(self.parameters["learning_rate"]))
        batch_size = max(1, int(self.parameters["batch_size"]))
        epochs = max(1, int(self.parameters["perceptual_epochs"]))
        last = float("nan")
        for _ in range(epochs):
            context.checkpoint()
            order = torch.randperm(x.shape[0], device=x.device)
            for start in range(0, x.shape[0], batch_size):
                rows = order[start:start + batch_size]
                optimizer.zero_grad(set_to_none=True)
                clean = x[rows]
                value = ((network.reconstruct(clean + 0.3 * torch.randn_like(clean)) - clean) ** 2).mean()
                value.backward()
                optimizer.step()
                last = float(value.detach())
        for parameter in parameters:
            parameter.requires_grad_(False)
        context.log(f"perceptual feature network: {epochs} denoising-autoencoder epochs on the training rows, "
                    f"final reconstruction error {last:.4f}; frozen")

    def error(self, network, x, classes, steps, noise):
        clean_estimate = network(self.noisy(network, x, steps, noise), self.time(network, steps, x.dtype), classes)
        pixel = ((clean_estimate - x) ** 2).sum(dim=1)
        perceptual = sum(((a - b) ** 2).sum(dim=1) for a, b in zip(network.features(clean_estimate), network.features(x)))
        return pixel + float(self.parameters["perceptual_weight"]) * perceptual


__all__ = ["Diffusion", "PerceptualDiffusion", "ScoreMatching", "UNetDenoiser", "cosine_signal_share"]
