"""The class-conditional generators: six GAN mechanisms at tabular scale.

Each trainer learns p(feature row | class) on the training rows of a
``ClassProblem`` and can then ``sample(class_index, count)`` exactly ``count``
synthetic rows of that class. One call of ``train_epoch`` is one pass over the
training rows; it returns the mean generator loss and leaves the other losses
in ``last_losses`` (logged by the adapter).

- ``PerClassGan`` (Goodfellow et al., 2014): one unconditional GAN per class,
  fitted on that class's rows only; non-saturating loss.
- ``ConditionalGan`` (Mirza and Osindero, 2014): one G(z, y) and one D(x, y),
  the condition concatenated as a one-hot; one-sided label smoothing.
- ``WassersteinGan`` (Gulrajani et al., 2017, WGAN-GP): a linear critic with a
  gradient penalty on interpolates, ``critic_step_count`` critic steps per
  generator step, Adam(0, 0.9); the Wasserstein estimate is logged.
- ``BigGan`` (Brock et al., 2018): class-conditional batch normalisation from a
  shared class embedding, skip-z (a latent chunk into every block), residual
  blocks, spectral norm in G and D, a projection discriminator, hinge loss,
  two learning rates, orthogonal regularisation, an exponential moving average
  of G sampled from, and the truncation trick.
- ``StyleGan`` (Karras et al., 2019/2020): a mapping network z + class -> w, a
  synthesis network from a learned constant whose layers are modulated and
  demodulated by w, per-layer noise injection, style mixing, truncation of w
  toward the class's mean w; a discriminator with a minibatch standard
  deviation feature, non-saturating loss and the R1 penalty.
- ``SelfSupervisedGan`` (Chen et al., 2019, with a SimCLR-style task): a
  spectral-norm projection hinge GAN whose discriminator body also solves a
  contrastive task (InfoNCE between two augmented views of a row) on real rows,
  and the generator is trained so the task is solvable on its rows too.

Randomness: initial weights come from the caller's seeded torch RNG; every
noise draw uses this trainer's own CPU ``torch.Generator`` and batching its own
numpy generator, so a fit is reproducible bit for bit on the CPU.
"""

from __future__ import annotations

import copy
import math

import numpy as np
import torch
import torch.nn.functional as functional
from torch import nn

from .layers import NEGATIVE_SLOPE, multilayer, spectral
from .problem import ClassProblem

SAMPLE_CHUNK = 4096


class GeneratorTrainer:
    """What every generator shares: tensors, noise, batching, sampling."""

    name = "generator"

    def __init__(self, problem: ClassProblem, parameters: dict, device: str, seed: int) -> None:
        self.problem = problem
        self.parameters = parameters
        self.device = torch.device(device)
        self.random = np.random.default_rng(seed)
        self.noise_source = torch.Generator().manual_seed(int(seed))
        self.x = torch.as_tensor(problem.x, dtype=torch.float32, device=self.device)
        self.y = torch.as_tensor(problem.classes, dtype=torch.long, device=self.device)
        self.feature_count = problem.feature_count
        self.class_count = problem.class_count
        self.latent = int(parameters["latent_dimension"])
        self.hidden = int(parameters["hidden_size"])
        self.layer_count = int(parameters["layer_count"])
        self.batch_size = int(parameters["batch_size"])
        self.learning_rate = float(parameters["learning_rate"])
        self.last_losses: dict[str, float] = {}

    # ── helpers ──
    def noise(self, count: int, size: int | None = None) -> torch.Tensor:
        return torch.randn(int(count), int(size or self.latent), generator=self.noise_source).to(self.device)

    def uniform(self, *shape: int) -> torch.Tensor:
        return torch.rand(*shape, generator=self.noise_source).to(self.device)

    def one_hot(self, classes: torch.Tensor) -> torch.Tensor:
        return functional.one_hot(classes, self.class_count).float()

    def batches(self, rows: np.ndarray) -> list[np.ndarray]:
        """``rows`` shuffled and split into about len / batch_size near-equal batches."""
        rows = np.asarray(rows, dtype=np.int64)
        count = max(1, int(round(rows.size / self.batch_size)))
        return [chunk for chunk in np.array_split(self.random.permutation(rows), count) if chunk.size]

    def present_classes(self) -> list[int]:
        return [int(k) for k in np.flatnonzero(self.problem.present)]

    # ── the contract ──
    def train_epoch(self) -> float:
        raise NotImplementedError

    def generate(self, class_index: int, count: int) -> torch.Tensor:
        raise NotImplementedError

    def networks(self) -> dict[str, nn.Module]:
        raise NotImplementedError

    def eval(self) -> None:
        for network in self.networks().values():
            network.eval()

    def train(self) -> None:
        for network in self.networks().values():
            network.train()

    def sample(self, class_index: int, count: int) -> np.ndarray:
        """Exactly ``count`` synthetic rows of class ``class_index`` (float32)."""
        count = int(count)
        chunks = []
        self.eval()
        try:
            with torch.no_grad():
                remaining = count
                while remaining > 0:
                    size = min(SAMPLE_CHUNK, remaining)
                    chunks.append(self.generate(int(class_index), size).float().cpu().numpy())
                    remaining -= size
        finally:
            self.train()
        out = np.concatenate(chunks, axis=0) if chunks else np.empty((0, self.feature_count), dtype=np.float32)
        return np.ascontiguousarray(out, dtype=np.float32)

    def state(self) -> dict:
        return {name: network.state_dict() for name, network in self.networks().items()}


def _adam(parameters, learning_rate: float, betas: tuple[float, float]) -> torch.optim.Adam:
    return torch.optim.Adam(parameters, lr=float(learning_rate), betas=betas)


def _mean(values: list[float]) -> float:
    return float(np.mean(values)) if values else float("nan")


# ─── 1. one unconditional GAN per class ────────────────────────────────────


class PerClassGan(GeneratorTrainer):
    name = "per_class_gan"

    def __init__(self, problem, parameters, device, seed) -> None:
        super().__init__(problem, parameters, device, seed)
        self.generators = nn.ModuleDict()
        self.discriminators = nn.ModuleDict()
        for k in self.present_classes():
            self.generators[str(k)] = multilayer(self.latent, self.hidden, self.layer_count, self.feature_count)
            self.discriminators[str(k)] = multilayer(self.feature_count, self.hidden, self.layer_count, 1)
        self.generators.to(self.device)
        self.discriminators.to(self.device)
        self.generator_optimizers = {k: _adam(g.parameters(), self.learning_rate, (0.5, 0.999))
                                     for k, g in self.generators.items()}
        self.discriminator_optimizers = {k: _adam(d.parameters(), self.learning_rate, (0.5, 0.999))
                                         for k, d in self.discriminators.items()}

    def train_epoch(self) -> float:
        generator_losses, discriminator_losses = [], []
        for k in self.present_classes():
            name = str(k)
            generator, discriminator = self.generators[name], self.discriminators[name]
            for batch in self.batches(self.problem.class_rows(k)):
                real = self.x[torch.as_tensor(batch, device=self.device)]
                fake = generator(self.noise(real.shape[0]))
                loss = functional.softplus(-discriminator(real)).mean() + functional.softplus(discriminator(fake.detach())).mean()
                self.discriminator_optimizers[name].zero_grad(set_to_none=True)
                loss.backward()
                self.discriminator_optimizers[name].step()
                generator_loss = functional.softplus(-discriminator(fake)).mean()        # non-saturating
                self.generator_optimizers[name].zero_grad(set_to_none=True)
                generator_loss.backward()
                self.generator_optimizers[name].step()
                generator_losses.append(generator_loss.item())
                discriminator_losses.append(loss.item())
        self.last_losses = {"generator": _mean(generator_losses), "discriminator": _mean(discriminator_losses)}
        return self.last_losses["generator"]

    def generate(self, class_index, count):
        return self.generators[str(class_index)](self.noise(count))

    def networks(self):
        return {"generators": self.generators, "discriminators": self.discriminators}


# ─── 2. conditional GAN ────────────────────────────────────────────────────


class ConditionalGan(GeneratorTrainer):
    name = "conditional_gan"

    def __init__(self, problem, parameters, device, seed) -> None:
        super().__init__(problem, parameters, device, seed)
        self.generator = multilayer(self.latent + self.class_count, self.hidden, self.layer_count, self.feature_count).to(self.device)
        self.discriminator = multilayer(self.feature_count + self.class_count, self.hidden, self.layer_count, 1).to(self.device)
        self.smoothing = float(parameters.get("label_smoothing", 1.0))
        self.generator_optimizer = _adam(self.generator.parameters(), self.learning_rate, (0.5, 0.999))
        self.discriminator_optimizer = _adam(self.discriminator.parameters(), self.learning_rate, (0.5, 0.999))

    def forward_generator(self, z, condition):
        return self.generator(torch.cat([z, condition], dim=1))

    def train_epoch(self) -> float:
        generator_losses, discriminator_losses = [], []
        for batch in self.batches(np.arange(self.x.shape[0])):
            index = torch.as_tensor(batch, device=self.device)
            real, condition = self.x[index], self.one_hot(self.y[index])
            fake = self.forward_generator(self.noise(real.shape[0]), condition)
            real_score = self.discriminator(torch.cat([real, condition], dim=1))
            fake_score = self.discriminator(torch.cat([fake.detach(), condition], dim=1))
            # one-sided label smoothing: real rows are aimed at `label_smoothing`, not 1
            loss = (functional.binary_cross_entropy_with_logits(real_score, torch.full_like(real_score, self.smoothing))
                    + functional.binary_cross_entropy_with_logits(fake_score, torch.zeros_like(fake_score)))
            self.discriminator_optimizer.zero_grad(set_to_none=True)
            loss.backward()
            self.discriminator_optimizer.step()
            score = self.discriminator(torch.cat([fake, condition], dim=1))
            generator_loss = functional.binary_cross_entropy_with_logits(score, torch.ones_like(score))
            self.generator_optimizer.zero_grad(set_to_none=True)
            generator_loss.backward()
            self.generator_optimizer.step()
            generator_losses.append(generator_loss.item())
            discriminator_losses.append(loss.item())
        self.last_losses = {"generator": _mean(generator_losses), "discriminator": _mean(discriminator_losses)}
        return self.last_losses["generator"]

    def generate(self, class_index, count):
        classes = torch.full((int(count),), int(class_index), dtype=torch.long, device=self.device)
        return self.forward_generator(self.noise(count), self.one_hot(classes))

    def networks(self):
        return {"generator": self.generator, "discriminator": self.discriminator}


# ─── 3. Wasserstein GAN with gradient penalty ──────────────────────────────


class WassersteinGan(ConditionalGan):
    name = "wasserstein_gan"

    def __init__(self, problem, parameters, device, seed) -> None:
        super().__init__(problem, parameters, device, seed)
        self.critic = self.discriminator                     # linear output, no sigmoid anywhere
        self.critic_steps = int(parameters["critic_step_count"])
        self.penalty = float(parameters["gradient_penalty_weight"])
        self.generator_optimizer = _adam(self.generator.parameters(), self.learning_rate, (0.0, 0.9))
        self.discriminator_optimizer = _adam(self.critic.parameters(), self.learning_rate, (0.0, 0.9))
        self.critic_step = 0

    def critic_score(self, x, condition):
        return self.critic(torch.cat([x, condition], dim=1))

    def generator_step(self, count: int) -> float:
        classes = self.y[torch.as_tensor(self.random.integers(0, self.x.shape[0], int(count)), device=self.device)]
        condition = self.one_hot(classes)
        loss = -self.critic_score(self.forward_generator(self.noise(condition.shape[0]), condition), condition).mean()
        self.generator_optimizer.zero_grad(set_to_none=True)
        loss.backward()
        self.generator_optimizer.step()
        return loss.item()

    def train_epoch(self) -> float:
        generator_losses, critic_losses, distances = [], [], []
        for batch in self.batches(np.arange(self.x.shape[0])):
            index = torch.as_tensor(batch, device=self.device)
            real, condition = self.x[index], self.one_hot(self.y[index])
            with torch.no_grad():
                fake = self.forward_generator(self.noise(real.shape[0]), condition)
            mix = self.uniform(real.shape[0], 1)
            between = (mix * real + (1.0 - mix) * fake).requires_grad_(True)
            gradient = torch.autograd.grad(self.critic_score(between, condition).sum(), between, create_graph=True)[0]
            penalty = ((gradient.norm(2, dim=1) - 1.0) ** 2).mean()
            real_mean = self.critic_score(real, condition).mean()
            fake_mean = self.critic_score(fake, condition).mean()
            loss = fake_mean - real_mean + self.penalty * penalty
            self.discriminator_optimizer.zero_grad(set_to_none=True)
            loss.backward()
            self.discriminator_optimizer.step()
            critic_losses.append(loss.item())
            distances.append((real_mean - fake_mean).item())
            self.critic_step += 1
            if self.critic_step % self.critic_steps == 0:
                generator_losses.append(self.generator_step(real.shape[0]))
        if not generator_losses:                                      # every epoch moves the generator at least once
            generator_losses.append(self.generator_step(min(self.batch_size, self.x.shape[0])))
        self.last_losses = {"generator": _mean(generator_losses), "critic": _mean(critic_losses),
                            "wasserstein_estimate": _mean(distances)}
        return self.last_losses["generator"]

    def networks(self):
        return {"generator": self.generator, "critic": self.critic}


# ─── 4. BigGAN ─────────────────────────────────────────────────────────────


class ConditionalBatchNorm(nn.Module):
    """Batch normalisation whose gain and bias are linear in a conditioning vector."""

    def __init__(self, size: int, condition_size: int) -> None:
        super().__init__()
        self.normalise = nn.BatchNorm1d(size, affine=False)
        self.gain = spectral(nn.Linear(condition_size, size), True)
        self.bias = spectral(nn.Linear(condition_size, size), True)

    def forward(self, h, condition):
        return self.normalise(h) * (1.0 + self.gain(condition)) + self.bias(condition)


class BigGanBlock(nn.Module):
    def __init__(self, size: int, condition_size: int) -> None:
        super().__init__()
        self.first_norm = ConditionalBatchNorm(size, condition_size)
        self.first = spectral(nn.Linear(size, size), True)
        self.second_norm = ConditionalBatchNorm(size, condition_size)
        self.second = spectral(nn.Linear(size, size), True)

    def forward(self, h, condition):
        inner = self.first(functional.relu(self.first_norm(h, condition)))
        return h + self.second(functional.relu(self.second_norm(inner, condition)))


class BigGanGenerator(nn.Module):
    def __init__(self, latent: int, hidden: int, block_count: int, feature_count: int, class_count: int,
                 embedding_size: int) -> None:
        super().__init__()
        pieces = max(1, block_count + 1)
        sizes = [len(chunk) for chunk in np.array_split(np.arange(latent), pieces)]
        if min(sizes) < 1:
            raise ValueError(f"latent_dimension {latent} cannot give one latent chunk to each of {pieces} stages")
        self.chunk_sizes = sizes
        self.embedding = nn.Embedding(class_count, embedding_size)                # shared by every block
        self.first = spectral(nn.Linear(sizes[0], hidden), True)
        self.blocks = nn.ModuleList(BigGanBlock(hidden, size + embedding_size) for size in sizes[1:])
        self.last_norm = nn.BatchNorm1d(hidden)
        self.out = spectral(nn.Linear(hidden, feature_count), True)

    def forward(self, z, classes):
        chunks = torch.split(z, self.chunk_sizes, dim=1)
        embedded = self.embedding(classes)
        h = self.first(chunks[0])
        for block, chunk in zip(self.blocks, chunks[1:]):                          # skip-z
            h = block(h, torch.cat([chunk, embedded], dim=1))
        return self.out(functional.relu(self.last_norm(h)))


class ProjectionDiscriminator(nn.Module):
    """phi = body(x); score = w . phi + <embedding(y), phi> (Miyato and Koyama, 2018)."""

    def __init__(self, feature_count: int, hidden: int, layer_count: int, class_count: int,
                 minibatch_deviation: bool = False) -> None:
        super().__init__()
        layers: list[nn.Module] = []
        size = feature_count
        for _ in range(max(1, layer_count)):
            layers += [spectral(nn.Linear(size, hidden), True), nn.LeakyReLU(NEGATIVE_SLOPE)]
            size = hidden
        self.body = nn.Sequential(*layers)
        self.minibatch_deviation = minibatch_deviation
        self.head = spectral(nn.Linear(hidden + (1 if minibatch_deviation else 0), 1), True)
        self.embedding = spectral(nn.Embedding(class_count, hidden), True)

    def features(self, x):
        return self.body(x)

    def forward(self, x, classes):
        phi = self.body(x)
        head_input = phi
        if self.minibatch_deviation:
            deviation = phi.std(dim=0, unbiased=False).mean() if phi.shape[0] > 1 else phi.new_zeros(())
            head_input = torch.cat([phi, deviation.expand(phi.shape[0], 1)], dim=1)
        return self.head(head_input) + (self.embedding(classes) * phi).sum(dim=1, keepdim=True)


def _original_weights(module: nn.Module):
    for child in module.modules():
        if isinstance(child, nn.Linear):
            parametrizations = getattr(child, "parametrizations", None)
            yield parametrizations.weight.original if parametrizations is not None else child.weight


class BigGan(GeneratorTrainer):
    name = "big_gan"

    def __init__(self, problem, parameters, device, seed) -> None:
        super().__init__(problem, parameters, device, seed)
        embedding = int(parameters["embedding_size"])
        self.generator = BigGanGenerator(self.latent, self.hidden, self.layer_count, self.feature_count,
                                         self.class_count, embedding).to(self.device)
        self.discriminator = ProjectionDiscriminator(self.feature_count, self.hidden, self.layer_count,
                                                     self.class_count).to(self.device)
        self.average = copy.deepcopy(self.generator)                               # the EMA generator
        for parameter in self.average.parameters():
            parameter.requires_grad_(False)
        self.decay = float(parameters["moving_average_decay"])
        self.orthogonal = float(parameters["orthogonal_penalty_weight"])
        self.truncation = float(parameters["truncation_threshold"])
        self.generator_optimizer = _adam(self.generator.parameters(), self.learning_rate, (0.0, 0.999))
        self.discriminator_optimizer = _adam(self.discriminator.parameters(),
                                             float(parameters["discriminator_learning_rate"]), (0.0, 0.999))

    def orthogonal_penalty(self) -> torch.Tensor:
        total = torch.zeros((), device=self.device)
        for weight in _original_weights(self.generator):
            gram = weight @ weight.T
            off = gram * (1.0 - torch.eye(gram.shape[0], device=self.device))
            total = total + (off ** 2).sum()
        return total

    def update_average(self) -> None:
        with torch.no_grad():
            for averaged, live in zip(self.average.parameters(), self.generator.parameters()):
                averaged.mul_(self.decay).add_(live.detach(), alpha=1.0 - self.decay)

    def train_epoch(self) -> float:
        generator_losses, discriminator_losses = [], []
        for batch in self.batches(np.arange(self.x.shape[0])):
            if batch.size < 2:                                                     # batch norm needs two rows
                continue
            index = torch.as_tensor(batch, device=self.device)
            real, classes = self.x[index], self.y[index]
            fake = self.generator(self.noise(real.shape[0]), classes)
            loss = (functional.relu(1.0 - self.discriminator(real, classes)).mean()
                    + functional.relu(1.0 + self.discriminator(fake.detach(), classes)).mean())    # hinge
            self.discriminator_optimizer.zero_grad(set_to_none=True)
            loss.backward()
            self.discriminator_optimizer.step()
            generator_loss = -self.discriminator(fake, classes).mean()
            total = generator_loss + self.orthogonal * self.orthogonal_penalty()
            self.generator_optimizer.zero_grad(set_to_none=True)
            total.backward()
            self.generator_optimizer.step()
            self.update_average()
            generator_losses.append(generator_loss.item())
            discriminator_losses.append(loss.item())
        self.last_losses = {"generator": _mean(generator_losses), "discriminator": _mean(discriminator_losses)}
        return self.last_losses["generator"]

    def truncated_noise(self, count: int) -> torch.Tensor:
        """z ~ N(0, I) with every entry beyond +-truncation_threshold redrawn (0 = no truncation)."""
        z = torch.randn(int(count), self.latent, generator=self.noise_source)
        if self.truncation > 0:
            for _ in range(100):
                outside = z.abs() > self.truncation
                if not bool(outside.any()):
                    break
                z = torch.where(outside, torch.randn(z.shape, generator=self.noise_source), z)
            z = z.clamp(-self.truncation, self.truncation)
        return z.to(self.device)

    def eval(self) -> None:
        # the EMA generator carries the live generator's batch-norm statistics and power-iteration vectors
        for averaged, live in zip(self.average.buffers(), self.generator.buffers()):
            averaged.copy_(live)
        super().eval()

    def generate(self, class_index, count):
        classes = torch.full((int(count),), int(class_index), dtype=torch.long, device=self.device)
        return self.average(self.truncated_noise(count), classes)

    def networks(self):
        return {"generator": self.generator, "moving_average_generator": self.average, "discriminator": self.discriminator}


# ─── 5. StyleGAN ───────────────────────────────────────────────────────────


class ModulatedLinear(nn.Module):
    """A linear layer whose input scales come from a style vector (StyleGAN2
    modulation), optionally demodulated to unit output variance."""

    def __init__(self, input_size: int, output_size: int, style_size: int, demodulate: bool = True) -> None:
        super().__init__()
        self.weight = nn.Parameter(torch.randn(output_size, input_size) / math.sqrt(input_size))
        self.bias = nn.Parameter(torch.zeros(output_size))
        self.affine = nn.Linear(style_size, input_size)
        nn.init.ones_(self.affine.bias)
        self.demodulate = demodulate

    def forward(self, h, style):
        scales = self.affine(style)                                                # (n, in)
        weight = self.weight[None, :, :] * scales[:, None, :]                      # (n, out, in)
        if self.demodulate:
            weight = weight * torch.rsqrt((weight ** 2).sum(dim=2, keepdim=True) + 1e-8)
        return torch.einsum("noi,ni->no", weight, h) + self.bias


class StyleGenerator(nn.Module):
    def __init__(self, latent: int, hidden: int, synthesis_layer_count: int, mapping_layer_count: int,
                 feature_count: int, class_count: int, embedding_size: int) -> None:
        super().__init__()
        self.class_embedding = nn.Embedding(class_count, embedding_size)
        self.mapping = multilayer(latent + embedding_size, latent, max(0, mapping_layer_count - 1), latent)
        self.constant = nn.Parameter(torch.randn(hidden))
        self.layers = nn.ModuleList(ModulatedLinear(hidden, hidden, latent) for _ in range(synthesis_layer_count))
        self.noise_scales = nn.ParameterList(nn.Parameter(torch.zeros(hidden)) for _ in range(synthesis_layer_count))
        self.to_features = ModulatedLinear(hidden, feature_count, latent, demodulate=False)

    @property
    def style_count(self) -> int:
        return len(self.layers) + 1

    def map(self, z, classes):
        return self.mapping(torch.cat([z, self.class_embedding(classes)], dim=1))

    def synthesise(self, styles: list[torch.Tensor], noises: list[torch.Tensor]):
        h = self.constant[None, :].expand(styles[0].shape[0], -1)
        for layer, scale, style, noise in zip(self.layers, self.noise_scales, styles, noises):
            h = functional.leaky_relu(layer(h, style) + scale * noise, NEGATIVE_SLOPE)
        return self.to_features(h, styles[-1])


class StyleGan(GeneratorTrainer):
    name = "style_gan"

    def __init__(self, problem, parameters, device, seed) -> None:
        super().__init__(problem, parameters, device, seed)
        self.generator = StyleGenerator(self.latent, self.hidden, self.layer_count, int(parameters["mapping_layer_count"]),
                                        self.feature_count, self.class_count,
                                        int(parameters["embedding_size"])).to(self.device)
        self.discriminator = ProjectionDiscriminator(self.feature_count, self.hidden, self.layer_count, self.class_count,
                                                     minibatch_deviation=True).to(self.device)
        self.mixing = float(parameters["style_mixing_probability"])
        self.penalty = float(parameters["gradient_penalty_weight"])
        self.truncation = float(parameters["truncation_weight"])
        mapping = list(self.generator.mapping.parameters()) + list(self.generator.class_embedding.parameters())
        mapping_ids = {id(parameter) for parameter in mapping}
        synthesis = [parameter for parameter in self.generator.parameters() if id(parameter) not in mapping_ids]
        # the mapping network learns 100x slower (StyleGAN's learning-rate multiplier 0.01)
        self.generator_optimizer = torch.optim.Adam([{"params": synthesis, "lr": self.learning_rate},
                                                     {"params": mapping, "lr": self.learning_rate * 0.01}],
                                                    betas=(0.0, 0.99))
        self.discriminator_optimizer = _adam(self.discriminator.parameters(), self.learning_rate, (0.0, 0.99))
        self.mean_styles: torch.Tensor | None = None                               # (K, latent): per-class mean w

    def layer_noises(self, count: int) -> list[torch.Tensor]:
        return [self.noise(count, self.hidden) for _ in self.generator.layers]

    def styles(self, classes: torch.Tensor, mix: bool) -> list[torch.Tensor]:
        count = classes.shape[0]
        first = self.generator.map(self.noise(count), classes)
        styles = [first] * self.generator.style_count
        if mix and self.mixing > 0 and float(self.uniform(1)) < self.mixing:
            second = self.generator.map(self.noise(count), classes)
            crossover = int(self.random.integers(1, self.generator.style_count))
            styles = [first if layer < crossover else second for layer in range(self.generator.style_count)]
        return styles

    def train_epoch(self) -> float:
        generator_losses, discriminator_losses = [], []
        for batch in self.batches(np.arange(self.x.shape[0])):
            index = torch.as_tensor(batch, device=self.device)
            real, classes = self.x[index], self.y[index]
            fake = self.generator.synthesise(self.styles(classes, mix=True), self.layer_noises(real.shape[0]))
            real_input = real.detach().requires_grad_(self.penalty > 0)
            real_score = self.discriminator(real_input, classes)
            loss = functional.softplus(-real_score).mean() + functional.softplus(
                self.discriminator(fake.detach(), classes)).mean()
            if self.penalty > 0:                                                   # R1 on real rows
                gradient = torch.autograd.grad(real_score.sum(), real_input, create_graph=True)[0]
                loss = loss + 0.5 * self.penalty * (gradient ** 2).sum(dim=1).mean()
            self.discriminator_optimizer.zero_grad(set_to_none=True)
            loss.backward()
            self.discriminator_optimizer.step()
            generator_loss = functional.softplus(-self.discriminator(fake, classes)).mean()
            self.generator_optimizer.zero_grad(set_to_none=True)
            generator_loss.backward()
            self.generator_optimizer.step()
            generator_losses.append(generator_loss.item())
            discriminator_losses.append(loss.item())
        self.mean_styles = None
        self.last_losses = {"generator": _mean(generator_losses), "discriminator": _mean(discriminator_losses)}
        return self.last_losses["generator"]

    def class_mean_styles(self) -> torch.Tensor:
        if self.mean_styles is None:
            with torch.no_grad():
                means = []
                for k in range(self.class_count):
                    classes = torch.full((SAMPLE_CHUNK,), k, dtype=torch.long, device=self.device)
                    means.append(self.generator.map(self.noise(SAMPLE_CHUNK), classes).mean(dim=0))
                self.mean_styles = torch.stack(means)
        return self.mean_styles

    def generate(self, class_index, count):
        classes = torch.full((int(count),), int(class_index), dtype=torch.long, device=self.device)
        style = self.generator.map(self.noise(count), classes)
        if self.truncation < 1.0:                                                  # w <- w_mean + psi (w - w_mean)
            mean = self.class_mean_styles()[int(class_index)]
            style = mean + self.truncation * (style - mean)
        return self.generator.synthesise([style] * self.generator.style_count, self.layer_noises(count))

    def networks(self):
        return {"generator": self.generator, "discriminator": self.discriminator}


# ─── 6. self-supervised GAN ────────────────────────────────────────────────


def information_noise_contrastive(first: torch.Tensor, second: torch.Tensor, temperature: float) -> torch.Tensor:
    """InfoNCE (symmetric): row i of ``first`` must pick row i of ``second`` among all rows."""
    first = functional.normalize(first, dim=1)
    second = functional.normalize(second, dim=1)
    logits = first @ second.T / float(temperature)
    target = torch.arange(first.shape[0], device=first.device)
    return 0.5 * (functional.cross_entropy(logits, target) + functional.cross_entropy(logits.T, target))


class SelfSupervisedGan(GeneratorTrainer):
    name = "self_supervised_gan"
    PROJECTION_SIZE = 32

    def __init__(self, problem, parameters, device, seed) -> None:
        super().__init__(problem, parameters, device, seed)
        self.generator = multilayer(self.latent + self.class_count, self.hidden, self.layer_count, self.feature_count).to(self.device)
        self.discriminator = ProjectionDiscriminator(self.feature_count, self.hidden, self.layer_count,
                                                     self.class_count).to(self.device)
        self.projector = nn.Sequential(nn.Linear(self.hidden, self.hidden), nn.LeakyReLU(NEGATIVE_SLOPE),
                                       nn.Linear(self.hidden, self.PROJECTION_SIZE)).to(self.device)
        self.weight = float(parameters["contrastive_weight"])
        self.temperature = float(parameters["temperature"])
        self.jitter = float(parameters["augmentation_noise"])
        self.generator_optimizer = _adam(self.generator.parameters(), self.learning_rate, (0.5, 0.999))
        self.discriminator_optimizer = _adam(list(self.discriminator.parameters()) + list(self.projector.parameters()),
                                             self.learning_rate, (0.5, 0.999))

    def forward_generator(self, z, classes):
        return self.generator(torch.cat([z, self.one_hot(classes)], dim=1))

    def augment(self, x: torch.Tensor) -> torch.Tensor:
        """Gaussian jitter plus a random 10% of the columns masked to 0 (the row's mean z-score)."""
        keep = (self.uniform(*x.shape) >= 0.1).float()
        return (x + self.jitter * self.noise(x.shape[0], x.shape[1])) * keep

    def contrastive(self, x: torch.Tensor) -> torch.Tensor:
        views = [self.projector(self.discriminator.features(self.augment(x))) for _ in range(2)]
        return information_noise_contrastive(views[0], views[1], self.temperature)

    def train_epoch(self) -> float:
        generator_losses, discriminator_losses, contrastive_losses = [], [], []
        for batch in self.batches(np.arange(self.x.shape[0])):
            if batch.size < 2:
                continue
            index = torch.as_tensor(batch, device=self.device)
            real, classes = self.x[index], self.y[index]
            fake = self.forward_generator(self.noise(real.shape[0]), classes)
            adversarial = (functional.relu(1.0 - self.discriminator(real, classes)).mean()
                           + functional.relu(1.0 + self.discriminator(fake.detach(), classes)).mean())
            self_supervised = self.contrastive(real)
            loss = adversarial + self.weight * self_supervised
            self.discriminator_optimizer.zero_grad(set_to_none=True)
            loss.backward()
            self.discriminator_optimizer.step()
            # the generator is also asked for rows on which the discriminator's own task stays solvable
            generator_loss = -self.discriminator(fake, classes).mean()
            total = generator_loss + self.weight * self.contrastive(fake)
            self.generator_optimizer.zero_grad(set_to_none=True)
            total.backward()
            self.generator_optimizer.step()
            generator_losses.append(generator_loss.item())
            discriminator_losses.append(adversarial.item())
            contrastive_losses.append(self_supervised.item())
        self.last_losses = {"generator": _mean(generator_losses), "discriminator": _mean(discriminator_losses),
                            "contrastive": _mean(contrastive_losses)}
        return self.last_losses["generator"]

    def generate(self, class_index, count):
        classes = torch.full((int(count),), int(class_index), dtype=torch.long, device=self.device)
        return self.forward_generator(self.noise(count), classes)

    def networks(self):
        return {"generator": self.generator, "discriminator": self.discriminator, "projector": self.projector}


TRAINERS = {
    "generative_adversarial_network": PerClassGan,
    "conditional_gan": ConditionalGan,
    "wasserstein_gan": WassersteinGan,
    "big_gan": BigGan,
    "style_gan": StyleGan,
    "self_supervised_gan": SelfSupervisedGan,
}

__all__ = ["BigGan", "ConditionalGan", "GeneratorTrainer", "PerClassGan", "SelfSupervisedGan", "StyleGan", "TRAINERS",
           "WassersteinGan", "information_noise_contrastive"]
