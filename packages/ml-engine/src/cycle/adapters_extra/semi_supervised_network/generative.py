"""The generative and hybrid semi-supervised variants.

    ladder                    Rasmus et al. 2015: a clean encoder, a noisy
                              encoder (Gaussian noise at every layer, batch
                              normalisation) and a top-down decoder whose
                              vanilla combinator g(z_noisy, u) denoises each
                              layer; the unsupervised cost is the per-layer
                              squared error between the clean encoder's
                              normalised activations and the decoder's
                              (renormalised with the clean batch statistics),
                              weighted per layer. The supervised term reads the
                              NOISY path; prediction reads the clean path with
                              the running statistics.
    generative_discriminative Kingma et al. 2014 M2: classifier q(y|x), encoder
                              q(z|x,y), Gaussian decoder p(x|y,z). Labelled rows
                              minimise L(x, y) + classification_loss_weight *
                              cross-entropy; unlabelled rows minimise U(x) =
                              sum_y q(y|x) L(x, y) - H(q(y|x)). P(up) is q(up|x).
                              The price model is M1 plus a regression head: a
                              VAE of the row (all span rows) whose encoder mean
                              feeds a Huber head fitted on labelled rows.
    k_plus_one_gan            Salimans et al. 2016: the discriminator's two
                              class logits l (down, up) with the fake class
                              implicit, D(real | x) = Z / (Z + 1), Z = sum exp(l);
                              labelled rows add cross-entropy over the two
                              classes, the unlabelled rows and generator samples
                              the real / fake terms; the generator is trained by
                              feature matching. P(up) = softmax(l)[up].
"""

from __future__ import annotations

import math

import torch
import torch.nn.functional as F
from torch import nn

from .methods import HUBER_DELTA, Method, binary_entropy, multilayer_perceptron

BATCH_NORM_EPSILON = 1e-5
RUNNING_MOMENTUM = 0.1
LOG_VARIANCE_LIMIT = 8.0
LOG_TWO_PI = math.log(2.0 * math.pi)


# ═══ ladder network ═════════════════════════════════════════════════════════


class Combinator(nn.Module):
    """The vanilla combinator of Rasmus et al., per unit:
    mu(u) = a1 sigmoid(a2 u + a3) + a4 u + a5, v(u) = a6 sigmoid(a7 u + a8) + a9 u + a10,
    z_hat = (z_noisy - mu(u)) * v(u) + mu(u); initialised as in the paper's code (a2 = a7 = 1, others 0)."""

    def __init__(self, width: int) -> None:
        super().__init__()
        initial = torch.zeros(10, int(width))
        initial[1] = 1.0
        initial[6] = 1.0
        self.coefficients = nn.Parameter(initial)

    def forward(self, noisy: torch.Tensor, top_down: torch.Tensor) -> torch.Tensor:
        a = self.coefficients
        mean = a[0] * torch.sigmoid(a[1] * top_down + a[2]) + a[3] * top_down + a[4]
        gain = a[5] * torch.sigmoid(a[6] * top_down + a[7]) + a[8] * top_down + a[9]
        return (noisy - mean) * gain + mean


def batch_normalise(values: torch.Tensor) -> torch.Tensor:
    mean = values.mean(0)
    variance = values.var(0, unbiased=False)
    return (values - mean) / torch.sqrt(variance + BATCH_NORM_EPSILON)


class LadderNetwork(nn.Module):
    """widths = [features, hidden x layer_count, 1]; layer l = 1..L: z = BN(W_l h_{l-1}) (+ noise),
    h_l = relu(gamma_l (z + beta_l)), the top layer linear (the logit or the value)."""

    def __init__(self, feature_count: int, hidden_size: int, layer_count: int) -> None:
        super().__init__()
        self.widths = [int(feature_count)] + [int(hidden_size)] * int(layer_count) + [1]
        depth = len(self.widths) - 1
        self.encoder = nn.ModuleList(nn.Linear(self.widths[l - 1], self.widths[l], bias=False) for l in range(1, depth + 1))
        self.gamma = nn.ParameterList(nn.Parameter(torch.ones(self.widths[l])) for l in range(1, depth + 1))
        self.beta = nn.ParameterList(nn.Parameter(torch.zeros(self.widths[l])) for l in range(1, depth + 1))
        self.decoder = nn.ModuleList(nn.Linear(self.widths[l + 1], self.widths[l], bias=False) for l in range(depth))
        self.combinators = nn.ModuleList(Combinator(self.widths[l]) for l in range(depth + 1))
        for l in range(1, depth + 1):
            self.register_buffer(f"running_mean_{l}", torch.zeros(self.widths[l]))
            self.register_buffer(f"running_variance_{l}", torch.ones(self.widths[l]))

    @property
    def depth(self) -> int:
        return len(self.widths) - 1

    def encode(self, x: torch.Tensor, noise: float = 0.0, update_running: bool = False,
               use_running: bool = False) -> tuple[torch.Tensor, list[torch.Tensor], list[tuple[torch.Tensor, torch.Tensor]]]:
        """(top output, [z_0 .. z_L] normalised pre-activations (z_0 = the input), [(batch mean, variance)] per layer)."""
        h = x + noise * torch.randn_like(x) if noise > 0 else x
        activations = [h]
        statistics: list[tuple[torch.Tensor, torch.Tensor]] = []
        for l in range(1, self.depth + 1):
            pre = self.encoder[l - 1](h)
            if use_running:
                mean, variance = getattr(self, f"running_mean_{l}"), getattr(self, f"running_variance_{l}")
            else:
                mean, variance = pre.mean(0), pre.var(0, unbiased=False)
                if update_running:
                    with torch.no_grad():
                        running_mean = getattr(self, f"running_mean_{l}")
                        running_variance = getattr(self, f"running_variance_{l}")
                        running_mean.mul_(1.0 - RUNNING_MOMENTUM).add_(mean.detach(), alpha=RUNNING_MOMENTUM)
                        running_variance.mul_(1.0 - RUNNING_MOMENTUM).add_(variance.detach(), alpha=RUNNING_MOMENTUM)
            z = (pre - mean) / torch.sqrt(variance + BATCH_NORM_EPSILON)
            if noise > 0:
                z = z + noise * torch.randn_like(z)
            activations.append(z)
            statistics.append((mean, variance))
            h = self.gamma[l - 1] * (z + self.beta[l - 1])
            if l < self.depth:
                h = F.relu(h)
        return h, activations, statistics

    def denoising_costs(self, noisy: list[torch.Tensor], noisy_top: torch.Tensor, clean: list[torch.Tensor],
                        clean_statistics: list[tuple[torch.Tensor, torch.Tensor]]) -> list[torch.Tensor]:
        """Per layer l = 0..L: mean over rows of ||z_clean_l - BN_clean(z_hat_l)||^2 / width_l."""
        costs: list[torch.Tensor] = [torch.zeros((), device=noisy_top.device)] * (self.depth + 1)
        estimate = None
        for l in range(self.depth, -1, -1):
            top_down = batch_normalise(noisy_top) if l == self.depth else batch_normalise(self.decoder[l](estimate))
            estimate = self.combinators[l](noisy[l], top_down)
            if l > 0:
                mean, variance = clean_statistics[l - 1]
                normalised = (estimate - mean) / torch.sqrt(variance + BATCH_NORM_EPSILON)
            else:
                normalised = estimate
            costs[l] = ((clean[l] - normalised) ** 2).sum(1).mean() / self.widths[l]
        return costs

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """The clean path with the running statistics (validation and prediction)."""
        output, _, _ = self.encode(x, 0.0, use_running=True)
        return output


class Ladder(Method):
    name = "ladder"
    unlabelled_source = "all"
    uses_unlabelled = True

    def build(self) -> None:
        self.modules = {"network": LadderNetwork(self.feature_count, int(self.value("hidden_size", 128)),
                                                 int(self.value("layer_count", 2)))}

    def layer_weights(self) -> list[float]:
        network = self.modules["network"]
        return [float(self.value("input_denoising_weight", 1.0))] + \
            [float(self.value("hidden_denoising_weight", 0.1))] * network.depth

    def train_step(self, labelled_x, labelled_y, unlabelled_x, weight):
        network: LadderNetwork = self.modules["network"]
        self.train_mode()
        x = torch.cat([labelled_x, unlabelled_x]) if unlabelled_x is not None and unlabelled_x.shape[0] else labelled_x
        count = labelled_x.shape[0]
        noise = float(self.value("noise_standard_deviation", 0.3))
        clean_top, clean, clean_statistics = network.encode(x, 0.0, update_running=True)
        noisy_top, noisy, _ = network.encode(x, noise)
        supervised = self.supervised_loss(noisy_top[:count].squeeze(-1), labelled_y)
        total = supervised
        parts = {"supervised": float(supervised.detach())}
        if weight > 0:
            costs = network.denoising_costs(noisy, noisy_top, clean, clean_statistics)
            denoising = sum(layer_weight * cost for layer_weight, cost in zip(self.layer_weights(), costs))
            total = total + weight * denoising
            parts["unsupervised"] = float(denoising.detach())
        self.optimise(total)
        self.last_parts = parts
        return float(total.detach())


# ═══ M2 (and M1 plus a head for the price) ═════════════════════════════════


class GenerativeModel(nn.Module):
    """Direction: classifier q(y|x), encoder q(z|x,y), decoder p(x|y,z) with a learned per-feature
    log-variance. Price: encoder q(z|x), decoder p(x|z), a regression head on the encoder mean."""

    def __init__(self, feature_count: int, hidden_size: int, layer_count: int, latent_dimension: int, dropout: float,
                 regression: bool) -> None:
        super().__init__()
        self.regression = bool(regression)
        self.latent_dimension = int(latent_dimension)
        label_width = 0 if regression else 2
        if not regression:
            self.classifier = multilayer_perceptron(feature_count, hidden_size, layer_count, dropout)
        self.encoder = multilayer_perceptron(feature_count + label_width, hidden_size, layer_count, 0.0,
                                             2 * self.latent_dimension)
        self.decoder = multilayer_perceptron(self.latent_dimension + label_width, hidden_size, layer_count, 0.0,
                                             feature_count)
        self.log_variance = nn.Parameter(torch.zeros(int(feature_count)))
        if regression:
            self.head = multilayer_perceptron(self.latent_dimension, hidden_size, 1, dropout)

    def encode(self, x: torch.Tensor, label: torch.Tensor | None = None) -> tuple[torch.Tensor, torch.Tensor]:
        inputs = x if label is None else torch.cat([x, label], dim=1)
        mean, log_variance = self.encoder(inputs).chunk(2, dim=1)
        return mean, log_variance.clamp(-LOG_VARIANCE_LIMIT, LOG_VARIANCE_LIMIT)

    def negative_bound(self, x: torch.Tensor, label: torch.Tensor | None, divergence_weight: float) -> torch.Tensor:
        """L(x, y) per row: -log p(x | y, z) (one reparameterised z) + divergence_weight * KL(q(z|x,y) || N(0, I))
        - log p(y) (the uniform prior over the two classes)."""
        mean, log_variance = self.encode(x, label)
        z = mean + torch.exp(0.5 * log_variance) * torch.randn_like(mean)
        decoded = self.decoder(z if label is None else torch.cat([z, label], dim=1))
        variance_log = self.log_variance.clamp(-LOG_VARIANCE_LIMIT, LOG_VARIANCE_LIMIT)
        reconstruction = 0.5 * (((x - decoded) ** 2) * torch.exp(-variance_log) + variance_log + LOG_TWO_PI).sum(1)
        divergence = -0.5 * (1.0 + log_variance - mean ** 2 - torch.exp(log_variance)).sum(1)
        prior = 0.0 if label is None else math.log(2.0)
        return reconstruction + divergence_weight * divergence + prior

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if self.regression:
            mean, _ = self.encode(x)
            return self.head(mean)
        return self.classifier(x)


def one_hot(classes: torch.Tensor) -> torch.Tensor:
    return torch.stack([1.0 - classes, classes], dim=1)


class GenerativeDiscriminative(Method):
    name = "generative_discriminative"
    uses_unlabelled = True

    def build(self) -> None:
        self.modules = {"network": GenerativeModel(self.feature_count, int(self.value("hidden_size", 128)),
                                                   int(self.value("layer_count", 2)),
                                                   int(self.value("latent_dimension", 8)),
                                                   float(self.value("dropout", 0.0)), self.regression)}

    def unlabelled_bound(self, unlabelled_x: torch.Tensor) -> torch.Tensor:
        """U(x) per row = sum_y q(y|x) L(x, y) - H(q(y|x)) (Kingma et al. eq. 7)."""
        model: GenerativeModel = self.modules["network"]
        weight = float(self.value("divergence_weight", 1.0))
        logit = model.classifier(unlabelled_x).squeeze(-1)
        up = torch.sigmoid(logit)
        ones = torch.ones_like(up)
        down_bound = model.negative_bound(unlabelled_x, one_hot(0.0 * ones), weight)
        up_bound = model.negative_bound(unlabelled_x, one_hot(ones), weight)
        return (1.0 - up) * down_bound + up * up_bound - binary_entropy(logit)

    def train_step(self, labelled_x, labelled_y, unlabelled_x, weight):
        model: GenerativeModel = self.modules["network"]
        self.train_mode()
        divergence_weight = float(self.value("divergence_weight", 1.0))
        has_unlabelled = unlabelled_x is not None and unlabelled_x.shape[0] and weight > 0
        if self.regression:
            mean, _ = model.encode(labelled_x)
            supervised = F.huber_loss(model.head(mean).squeeze(-1), labelled_y, delta=HUBER_DELTA)
            total = supervised
            parts = {"supervised": float(supervised.detach())}
            if has_unlabelled:
                bound = model.negative_bound(torch.cat([labelled_x, unlabelled_x]), None, divergence_weight).mean()
                total = total + weight * bound
                parts["unsupervised"] = float(bound.detach())
        else:
            labelled_bound = model.negative_bound(labelled_x, one_hot(labelled_y), divergence_weight).mean()
            classification = F.binary_cross_entropy_with_logits(model.classifier(labelled_x).squeeze(-1), labelled_y)
            supervised = labelled_bound + float(self.value("classification_loss_weight", 10.0)) * classification
            total = supervised
            parts = {"supervised": float(supervised.detach()), "classification": float(classification.detach())}
            if has_unlabelled:
                bound = self.unlabelled_bound(unlabelled_x).mean()
                total = total + weight * bound
                parts["unsupervised"] = float(bound.detach())
        self.optimise(total)
        self.last_parts = parts
        return float(total.detach())


# ═══ K + 1 GAN ═════════════════════════════════════════════════════════════


class AdversarialModel(nn.Module):
    """A discriminator (Gaussian input noise in training, hidden body, two class logits) and a generator
    (noise -> a standardised feature row). ``forward`` is the logit of P(up): l_up - l_down."""

    def __init__(self, feature_count: int, hidden_size: int, layer_count: int, dropout: float, noise_size: int,
                 generator_hidden_size: int, input_noise: float) -> None:
        super().__init__()
        body: list[nn.Module] = []
        width = int(feature_count)
        for _ in range(int(layer_count)):
            body += [nn.Linear(width, int(hidden_size)), nn.LeakyReLU(0.2)]
            if dropout > 0:
                body.append(nn.Dropout(float(dropout)))
            width = int(hidden_size)
        self.body = nn.Sequential(*body)
        self.classes = nn.Linear(width, 2)
        self.noise_size = int(noise_size)
        self.input_noise = float(input_noise)
        self.generator = nn.Sequential(
            nn.Linear(self.noise_size, int(generator_hidden_size)), nn.ReLU(),
            nn.Linear(int(generator_hidden_size), int(generator_hidden_size)), nn.ReLU(),
            nn.Linear(int(generator_hidden_size), int(feature_count)))

    def features(self, x: torch.Tensor) -> torch.Tensor:
        if self.training and self.input_noise > 0:
            x = x + self.input_noise * torch.randn_like(x)
        return self.body(x)

    def logits(self, x: torch.Tensor) -> torch.Tensor:
        return self.classes(self.features(x))

    def generate(self, count: int, device) -> torch.Tensor:
        return self.generator(torch.randn(int(count), self.noise_size, device=device))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        logits = self.logits(x)
        return (logits[:, 1] - logits[:, 0]).unsqueeze(-1)


def log_real_probability(logits: torch.Tensor) -> torch.Tensor:
    """log D(real | x) = log(Z / (Z + 1)) = lse(l) - softplus(lse(l))."""
    total = torch.logsumexp(logits, dim=1)
    return total - F.softplus(total)


def log_fake_probability(logits: torch.Tensor) -> torch.Tensor:
    """log D(fake | x) = log(1 / (Z + 1)) = -softplus(lse(l))."""
    return -F.softplus(torch.logsumexp(logits, dim=1))


class KPlusOneGan(Method):
    name = "k_plus_one_gan"
    has_price = False
    uses_unlabelled = True

    def build(self) -> None:
        self.modules = {"network": AdversarialModel(
            self.feature_count, int(self.value("hidden_size", 128)), int(self.value("layer_count", 2)),
            float(self.value("dropout", 0.2)), int(self.value("generator_noise_size", 32)),
            int(self.value("generator_hidden_size", 128)), float(self.value("noise_standard_deviation", 0.1)))}

    def make_optimizers(self) -> None:
        model: AdversarialModel = self.modules["network"]
        discriminator = [parameter for name, parameter in model.named_parameters() if not name.startswith("generator.")]
        self.optimizers = [self._adam(discriminator, betas=(0.5, 0.999)),
                           self._adam(model.generator.parameters(), float(self.value("generator_learning_rate", 5e-4)),
                                      betas=(0.5, 0.999))]

    def train_step(self, labelled_x, labelled_y, unlabelled_x, weight):
        model: AdversarialModel = self.modules["network"]
        self.train_mode()
        discriminator_optimizer, generator_optimizer = self.optimizers
        supervised = F.binary_cross_entropy_with_logits(self.output(model, labelled_x), labelled_y)
        total = supervised
        parts = {"supervised": float(supervised.detach())}
        adversarial = unlabelled_x is not None and unlabelled_x.shape[0] and weight > 0
        if adversarial:
            fake = model.generate(unlabelled_x.shape[0], unlabelled_x.device).detach()
            unsupervised = -log_real_probability(model.logits(unlabelled_x)).mean() \
                - log_fake_probability(model.logits(fake)).mean()
            total = total + weight * unsupervised
            parts["unsupervised"] = float(unsupervised.detach())
        discriminator_modules = [model.body, model.classes]
        self._step(total, discriminator_optimizer, discriminator_modules)
        if adversarial and self.step_count % max(1, int(self.value("discriminator_steps", 1))) == 0:
            real_features = model.features(unlabelled_x).detach().mean(0)
            fake_features = model.features(model.generate(unlabelled_x.shape[0], unlabelled_x.device)).mean(0)
            matching = ((real_features - fake_features) ** 2).sum()
            self._step(matching, generator_optimizer, [model.generator], count=False)
            parts["feature_matching"] = float(matching.detach())
        self.last_parts = parts
        return float(total.detach())

    def _step(self, loss: torch.Tensor, optimizer: torch.optim.Optimizer, modules: list[nn.Module],
              count: bool = True) -> None:
        model: AdversarialModel = self.modules["network"]
        model.zero_grad(set_to_none=True)
        loss.backward()
        parameters = [parameter for module in modules for parameter in module.parameters() if parameter.grad is not None]
        if parameters:
            torch.nn.utils.clip_grad_norm_(parameters, 5.0)
        optimizer.step()
        if count:
            self.step_count += 1


__all__ = ["AdversarialModel", "Combinator", "GenerativeDiscriminative", "GenerativeModel", "KPlusOneGan", "Ladder",
           "LadderNetwork", "log_fake_probability", "log_real_probability"]
