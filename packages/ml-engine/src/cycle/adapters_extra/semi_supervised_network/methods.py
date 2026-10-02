"""The shared network and the discriminative semi-supervised variants.

``Method`` is the plain multilayer perceptron every variant here extends: a
network, AdamW, the supervised loss (binary cross-entropy on the logit for the
direction model, Huber on the value for the price model) and one training step.
A variant adds ``unsupervised_loss(labelled_x, labelled_y, unlabelled_x)``; the
step minimises

    supervised_loss + weight * unsupervised_loss

where ``weight`` is ``unlabeled_weight`` times the ramp at this point of the
fit (the trainer computes it). The unsupervised term runs inside
``isolated_random_state``: torch's random state is forked, reseeded from the
fit's own unsupervised stream and restored afterwards, so the supervised path
(dropout masks, batch order) is the same whether or not the term runs. With
``unlabeled_weight`` = 0 the term is skipped and every variant below trains
exactly the plain network (the family's gate).

    pseudo_label          Lee 2013: the network's own hard prediction on an
                          unlabelled row (evaluation mode, no gradient) is its
                          target; weight ramped linearly from ``ramp_start_epoch``
    consistency           Laine and Aila 2017 Pi-model (two noisy passes of one
                          network) or Tarvainen and Valpola 2017 Mean Teacher
                          (the target from an exponential moving average of
                          the weights, which is also the network that predicts)
    fixmatch              Sohn et al. 2020: a confident weak-view prediction is
                          the hard target of the strong view
    mixmatch              Berthelot et al. 2019: guessed and sharpened labels,
                          MixUp across labelled and unlabelled rows
    virtual_adversarial   Miyato et al. 2018: the divergence between the
                          prediction at x and at x + r_adv, r_adv found by power
                          iteration within radius epsilon
    entropy_minimization  Grandvalet and Bengio 2005: the mean binary entropy of
                          P(up) on unlabelled rows
"""

from __future__ import annotations

import contextlib
import copy
import math

import numpy as np
import torch
import torch.nn.functional as F
from torch import nn

from . import augment

GRADIENT_CLIP = 5.0
HUBER_DELTA = 1.0
MONTE_CARLO_DROPOUT_DRAWS = 4
MINIMUM_LEARNING_RATE_SHARE = 0.1


def resolve_device(device: str) -> str:
    """"cuda" / "cuda:<n>" when CUDA is available, "auto" -> CUDA when available, anything else the CPU."""
    device = str(device or "cpu")
    if device == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if device.startswith("cuda"):
        return device if torch.cuda.is_available() else "cpu"
    return "cpu"


@contextlib.contextmanager
def isolated_random_state(device: str, seed: int):
    """Fork torch's random state (CPU and the device in use), seed it, restore it on exit."""
    devices = [torch.cuda.current_device()] if str(device).startswith("cuda") else []
    with torch.random.fork_rng(devices=devices):
        torch.manual_seed(int(seed))
        yield


def multilayer_perceptron(input_size: int, hidden_size: int, layer_count: int, dropout: float,
                          output_size: int = 1) -> nn.Sequential:
    layers: list[nn.Module] = []
    width = int(input_size)
    for _ in range(int(layer_count)):
        layers += [nn.Linear(width, int(hidden_size)), nn.GELU()]
        if dropout > 0:
            layers.append(nn.Dropout(float(dropout)))
        width = int(hidden_size)
    layers.append(nn.Linear(width, int(output_size)))
    return nn.Sequential(*layers)


def binary_divergence(logit_target: torch.Tensor, logit: torch.Tensor) -> torch.Tensor:
    """KL(Bernoulli(sigmoid(logit_target)) || Bernoulli(sigmoid(logit))) per row."""
    p = torch.sigmoid(logit_target)
    return (p * (F.logsigmoid(logit_target) - F.logsigmoid(logit))
            + (1.0 - p) * (F.logsigmoid(-logit_target) - F.logsigmoid(-logit)))


def binary_entropy(logit: torch.Tensor) -> torch.Tensor:
    """-p log p - (1 - p) log(1 - p) of p = sigmoid(logit), per row."""
    p = torch.sigmoid(logit)
    return -(p * F.logsigmoid(logit) + (1.0 - p) * F.logsigmoid(-logit))


def update_teacher(teacher: nn.Module, student: nn.Module, decay: float) -> None:
    """teacher <- decay * teacher + (1 - decay) * student, parameter by parameter (buffers copied)."""
    with torch.no_grad():
        for teacher_parameter, student_parameter in zip(teacher.parameters(), student.parameters()):
            teacher_parameter.mul_(decay).add_(student_parameter, alpha=1.0 - decay)
        for teacher_buffer, student_buffer in zip(teacher.buffers(), student.buffers()):
            teacher_buffer.copy_(student_buffer)


class Method:
    """The plain network (the reference every variant equals at ``unlabeled_weight`` = 0)."""

    name = "supervised"
    #: "hidden": the masked and natively unlabelled span rows; "all": every span row (the consistency methods)
    unlabelled_source = "hidden"
    #: how the unsupervised weight rises over ``ramp_epochs``: "linear" or "gaussian" (exp(-5 (1 - t)^2))
    ramp_shape = "linear"
    has_price = True
    uses_unlabelled = False
    predictor_name = "network"

    def __init__(self, task: str, feature_count: int, parameters: dict, device: str, seed: int) -> None:
        self.task = task
        self.feature_count = int(feature_count)
        self.parameters = dict(parameters)
        self.device = device
        self.seed = int(seed)
        self.modules: dict[str, nn.Module] = {}
        self.optimizers: list[torch.optim.Optimizer] = []
        self.step_count = 0
        self.unsupervised_seeds = np.random.default_rng((self.seed, 13))
        self.last_parts: dict[str, float] = {}

    # ── parameters ──
    def value(self, name: str, default=None):
        return self.parameters.get(name, default)

    @property
    def regression(self) -> bool:
        return self.task == "regression"

    # ── building ──
    def build(self) -> None:
        """Create the modules (under the caller's seeded random state)."""
        self.modules = {"network": multilayer_perceptron(self.feature_count, int(self.value("hidden_size", 128)),
                                                         int(self.value("layer_count", 2)),
                                                         float(self.value("dropout", 0.0)))}

    def make_optimizers(self) -> None:
        self.optimizers = [self._adam(self.modules["network"].parameters())]

    def _adam(self, parameters, learning_rate: float | None = None, betas=(0.9, 0.999)) -> torch.optim.Optimizer:
        rate = float(self.value("learning_rate", 1e-3) if learning_rate is None else learning_rate)
        optimizer = torch.optim.AdamW(parameters, lr=rate, betas=betas, weight_decay=float(self.value("weight_decay", 0.0)))
        for group in optimizer.param_groups:
            group["base_learning_rate"] = rate
        return optimizer

    def to(self, device: str) -> Method:
        for module in self.modules.values():
            module.to(device)
        self.device = device
        return self

    def set_learning_rate_share(self, share: float) -> float:
        """Scale every optimizer's rate to ``share`` of its base rate; returns the first rate."""
        first = None
        for optimizer in self.optimizers:
            for group in optimizer.param_groups:
                group["lr"] = group["base_learning_rate"] * share
                first = group["lr"] if first is None else first
        return float(first or 0.0)

    def train_mode(self) -> None:
        for module in self.modules.values():
            module.train()

    def eval_mode(self) -> None:
        for module in self.modules.values():
            module.eval()

    def predictor(self) -> nn.Module:
        return self.modules[self.predictor_name]

    def output(self, module: nn.Module, x: torch.Tensor) -> torch.Tensor:
        """The logit of P(up) (direction) or the value (price), one per row."""
        return module(x).squeeze(-1)

    def squash(self, output: torch.Tensor) -> torch.Tensor:
        return output if self.regression else torch.sigmoid(output)

    # ── losses ──
    def supervised_loss(self, output: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        if self.regression:
            return F.huber_loss(output, target, delta=HUBER_DELTA)
        return F.binary_cross_entropy_with_logits(output, target)

    def unsupervised_loss(self, labelled_x: torch.Tensor, labelled_y: torch.Tensor,
                          unlabelled_x: torch.Tensor) -> torch.Tensor | None:
        return None

    # ── one step ──
    def next_unsupervised_seed(self) -> int:
        return int(self.unsupervised_seeds.integers(0, 2 ** 62))

    def train_step(self, labelled_x: torch.Tensor, labelled_y: torch.Tensor, unlabelled_x: torch.Tensor | None,
                   weight: float) -> float:
        network = self.modules["network"]
        self.train_mode()
        supervised = self.supervised_loss(self.output(network, labelled_x), labelled_y)
        total = supervised
        parts = {"supervised": float(supervised.detach())}
        if self.uses_unlabelled and weight > 0 and unlabelled_x is not None and unlabelled_x.shape[0]:
            with isolated_random_state(self.device, self.next_unsupervised_seed()):
                unsupervised = self.unsupervised_loss(labelled_x, labelled_y, unlabelled_x)
            if unsupervised is not None:
                total = total + weight * unsupervised
                parts["unsupervised"] = float(unsupervised.detach())
        self.optimise(total)
        self.after_step()
        self.last_parts = parts
        return float(total.detach())

    def optimise(self, loss: torch.Tensor, optimizers=None, modules=None) -> None:
        optimizers = self.optimizers if optimizers is None else optimizers
        for optimizer in optimizers:
            optimizer.zero_grad(set_to_none=True)
        loss.backward()
        parameters = [parameter for module in (modules or self.modules.values()) for parameter in module.parameters()
                      if parameter.grad is not None]
        if parameters:
            torch.nn.utils.clip_grad_norm_(parameters, GRADIENT_CLIP)
        for optimizer in optimizers:
            optimizer.step()
        self.step_count += 1

    def after_step(self) -> None:
        """Called after every optimiser step (the Mean Teacher's average)."""

    def diagnostics(self) -> dict:
        """What the fit summary and the log report about the unlabelled term (a variant override)."""
        return {}

    # ── state ──
    def snapshot(self) -> dict:
        return {name: {key: value.detach().clone() for key, value in module.state_dict().items()}
                for name, module in self.modules.items()}

    def restore(self, state: dict) -> None:
        for name, module in self.modules.items():
            module.load_state_dict(state[name])

    def cpu_state(self) -> dict:
        return {name: {key: value.detach().to("cpu").clone() for key, value in module.state_dict().items()}
                for name, module in self.modules.items()}


class PseudoLabel(Method):
    """Lee 2013: the unlabelled target is the network's own hard prediction."""

    name = "pseudo_label"
    has_price = False
    uses_unlabelled = True

    def pseudo_labels(self, unlabelled_x: torch.Tensor) -> torch.Tensor:
        """The class the network in evaluation mode (dropout off) predicts, as a 0 / 1 target, without gradient."""
        network = self.modules["network"]
        network.eval()
        with torch.no_grad():
            pseudo = (self.output(network, unlabelled_x) >= 0).to(unlabelled_x.dtype)
        network.train()
        return pseudo

    def unsupervised_loss(self, labelled_x, labelled_y, unlabelled_x):
        pseudo = self.pseudo_labels(unlabelled_x)
        return F.binary_cross_entropy_with_logits(self.output(self.modules["network"], unlabelled_x), pseudo)


class Consistency(Method):
    """Pi-model (``consistency_teacher`` = pi_model) or Mean Teacher (= mean_teacher)."""

    name = "consistency"
    unlabelled_source = "all"
    ramp_shape = "gaussian"
    uses_unlabelled = True

    @property
    def mean_teacher(self) -> bool:
        return str(self.value("consistency_teacher", "mean_teacher")) == "mean_teacher"

    @property
    def predictor_name(self) -> str:        # the Mean Teacher predicts with the averaged weights
        return "teacher" if self.mean_teacher else "network"

    def build(self) -> None:
        super().build()
        if self.mean_teacher:
            teacher = copy.deepcopy(self.modules["network"])
            for parameter in teacher.parameters():
                parameter.requires_grad_(False)
            self.modules["teacher"] = teacher

    def make_optimizers(self) -> None:
        self.optimizers = [self._adam(self.modules["network"].parameters())]

    def perturb(self, x: torch.Tensor) -> torch.Tensor:
        return augment.gaussian_noise(x, float(self.value("noise_standard_deviation", 0.15)))

    def unsupervised_loss(self, labelled_x, labelled_y, unlabelled_x):
        x = torch.cat([labelled_x, unlabelled_x])
        network = self.modules["network"]
        student = self.squash(self.output(network, self.perturb(x)))
        if self.mean_teacher:
            teacher = self.modules["teacher"]
            teacher.train()
            with torch.no_grad():
                target = self.squash(self.output(teacher, self.perturb(x)))
        else:
            # the Pi-model: a second stochastic pass of the same network, gradient through both (Laine and Aila)
            target = self.squash(self.output(network, self.perturb(x)))
        return torch.mean((student - target) ** 2)

    def teacher_decay(self) -> float:
        """Tarvainen's warm-up: min(1 - 1 / (step + 1), teacher_decay)."""
        return min(1.0 - 1.0 / (self.step_count + 1.0), float(self.value("teacher_decay", 0.99)))

    def after_step(self) -> None:
        if self.mean_teacher:
            update_teacher(self.modules["teacher"], self.modules["network"], self.teacher_decay())


class FixMatch(Method):
    """A weak view's confident prediction is the hard target of a strong view."""

    name = "fixmatch"
    uses_unlabelled = True
    ramp_shape = "linear"

    def weak(self, x):
        return augment.gaussian_noise(x, float(self.value("weak_noise_standard_deviation", 0.05)))

    def strong(self, x):
        return augment.strong_view(x, float(self.value("strong_noise_standard_deviation", 0.4)),
                                   float(self.value("feature_mask_fraction", 0.25)))

    def confident_targets(self, unlabelled_x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """(target, mask) from the weak view. Direction: the hard class where max(p, 1 - p) >=
        ``confidence_threshold``. Price: the mean of Monte-Carlo dropout passes where their spread is at
        or below the batch's ``price_confidence_quantile`` spread (an adaptation; the paper has no regression)."""
        network = self.modules["network"]
        weak = self.weak(unlabelled_x)
        with torch.no_grad():
            if not self.regression:
                network.eval()
                probability = torch.sigmoid(self.output(network, weak))
                network.train()
                confidence = torch.maximum(probability, 1.0 - probability)
                mask = (confidence >= float(self.value("confidence_threshold", 0.8))).to(unlabelled_x.dtype)
                return (probability >= 0.5).to(unlabelled_x.dtype), mask
            network.train()
            draws = torch.stack([self.output(network, weak) for _ in range(MONTE_CARLO_DROPOUT_DRAWS)])
            mean, spread = draws.mean(0), draws.std(0)
            threshold = torch.quantile(spread, float(self.value("price_confidence_quantile", 0.5)))
            return mean, (spread <= threshold).to(unlabelled_x.dtype)

    def __init__(self, *arguments, **keywords) -> None:
        super().__init__(*arguments, **keywords)
        self.confident_rows = 0
        self.unlabelled_rows = 0

    def diagnostics(self) -> dict:
        share = self.confident_rows / self.unlabelled_rows if self.unlabelled_rows else None
        return {"confident_share": share}

    def unsupervised_loss(self, labelled_x, labelled_y, unlabelled_x):
        target, mask = self.confident_targets(unlabelled_x)
        self.confident_rows += int(mask.sum().item())
        self.unlabelled_rows += int(mask.numel())
        output = self.output(self.modules["network"], self.strong(unlabelled_x))
        if self.regression:
            per_row = F.huber_loss(output, target, delta=HUBER_DELTA, reduction="none")
        else:
            per_row = F.binary_cross_entropy_with_logits(output, target, reduction="none")
        # FixMatch averages over the whole unlabelled batch, so few confident rows mean a small term
        return (mask * per_row).mean()


class MixMatch(Method):
    """Guessed and sharpened labels, MixUp across the labelled and the unlabelled rows.

    The whole step is MixMatch's own (the supervised term is on MIXED labelled
    rows), so this variant does not reduce to the plain network at weight 0: it
    reduces to MixUp on the labelled rows."""

    name = "mixmatch"
    uses_unlabelled = True
    ramp_shape = "linear"

    def augmented(self, x):
        return augment.gaussian_noise(x, float(self.value("noise_standard_deviation", 0.1)))

    def guess(self, unlabelled_x: torch.Tensor, count: int) -> tuple[torch.Tensor, torch.Tensor]:
        """(the ``count`` augmented copies stacked, the guessed target per copy): the mean prediction over
        the copies, sharpened with ``temperature`` for the direction model (the mean alone for the price)."""
        network = self.modules["network"]
        copies = torch.cat([self.augmented(unlabelled_x) for _ in range(count)])
        network.eval()
        with torch.no_grad():
            predictions = self.squash(self.output(network, copies)).reshape(count, -1).mean(0)
        network.train()
        if not self.regression:
            predictions = augment.sharpen(predictions, float(self.value("temperature", 0.5)))
        return copies, predictions.repeat(count)

    def train_step(self, labelled_x, labelled_y, unlabelled_x, weight):
        network = self.modules["network"]
        self.train_mode()
        labelled = self.augmented(labelled_x)
        if unlabelled_x is not None and unlabelled_x.shape[0]:
            copies, guessed = self.guess(unlabelled_x, int(self.value("augmentation_count", 2)))
        else:
            copies, guessed = labelled_x[:0], labelled_y[:0]
        rows = torch.cat([labelled, copies])
        targets = torch.cat([labelled_y, guessed])
        order = torch.randperm(rows.shape[0], device=rows.device)
        shuffled_rows, shuffled_targets = rows[order], targets[order]
        mix = augment.mixing_weight(float(self.value("mixup_concentration", 0.75)))
        count = labelled.shape[0]
        mixed_labelled = augment.mixup(labelled, shuffled_rows[:count], mix)
        mixed_labelled_target = augment.mixup(labelled_y, shuffled_targets[:count], mix)
        supervised = self.supervised_loss(self.output(network, mixed_labelled), mixed_labelled_target)
        total = supervised
        parts = {"supervised": float(supervised.detach())}
        if copies.shape[0] and weight > 0:
            mixed_unlabelled = augment.mixup(copies, shuffled_rows[count:], mix)
            mixed_unlabelled_target = augment.mixup(guessed, shuffled_targets[count:], mix)
            unsupervised = torch.mean((self.squash(self.output(network, mixed_unlabelled)) - mixed_unlabelled_target) ** 2)
            total = total + weight * unsupervised
            parts["unsupervised"] = float(unsupervised.detach())
        self.optimise(total)
        self.last_parts = parts
        return float(total.detach())


class VirtualAdversarial(Method):
    """The divergence between the prediction at x and at the most sensitive nearby point x + r_adv."""

    name = "virtual_adversarial"
    unlabelled_source = "all"
    uses_unlabelled = True

    def divergence(self, reference: torch.Tensor, output: torch.Tensor) -> torch.Tensor:
        if self.regression:
            return (reference - output) ** 2
        return binary_divergence(reference, output)

    @staticmethod
    def unit_rows(direction: torch.Tensor) -> torch.Tensor:
        return direction / (direction.norm(dim=1, keepdim=True) + 1e-12)

    def adversarial_direction(self, x: torch.Tensor) -> torch.Tensor:
        """r_adv with ||r_adv|| = ``perturbation_radius`` per row, by ``power_iteration_count`` power
        iterations from a random direction probed at radius ``probe_radius``. The network is in
        evaluation mode here (dropout off), so the direction is the network's, not the dropout mask's."""
        network = self.modules["network"]
        with torch.no_grad():
            reference = self.output(network, x)
        direction = torch.randn_like(x)
        for _ in range(int(self.value("power_iteration_count", 1))):
            probe = (float(self.value("probe_radius", 0.1)) * self.unit_rows(direction)).requires_grad_(True)
            divergence = self.divergence(reference, self.output(network, x + probe)).sum()
            (gradient,) = torch.autograd.grad(divergence, probe)
            direction = gradient.detach()
        return float(self.value("perturbation_radius", 1.0)) * self.unit_rows(direction)

    def unsupervised_loss(self, labelled_x, labelled_y, unlabelled_x):
        network = self.modules["network"]
        x = torch.cat([labelled_x, unlabelled_x])
        network.eval()
        try:
            adversarial = self.adversarial_direction(x)
            with torch.no_grad():
                reference = self.output(network, x)
            return self.divergence(reference, self.output(network, x + adversarial)).mean()
        finally:
            network.train()


class EntropyMinimization(Method):
    """The mean binary entropy of P(up) on unlabelled rows, pushing the boundary into low-density regions."""

    name = "entropy_minimization"
    has_price = False
    uses_unlabelled = True

    def unsupervised_loss(self, labelled_x, labelled_y, unlabelled_x):
        return binary_entropy(self.output(self.modules["network"], unlabelled_x)).mean()


def ramp(shape: str, progress_epochs: float, start_epoch: float, ramp_epochs: float) -> float:
    """The share of the unsupervised weight at ``progress_epochs`` (0 at the start of the fit):
    0 before ``start_epoch``, then rising over ``ramp_epochs`` linearly or as exp(-5 (1 - t)^2)."""
    elapsed = float(progress_epochs) - float(start_epoch)
    if elapsed < 0:
        return 0.0
    if ramp_epochs <= 0:
        return 1.0
    fraction = min(1.0, elapsed / float(ramp_epochs))
    if shape == "gaussian":
        return float(math.exp(-5.0 * (1.0 - fraction) ** 2))
    return float(fraction)


def cosine_share(epoch: int, epoch_count: int) -> float:
    """The learning-rate share of an epoch: cosine from 1 down to MINIMUM_LEARNING_RATE_SHARE."""
    if epoch_count <= 1:
        return 1.0
    position = (int(epoch) - 1) / float(epoch_count - 1)
    return MINIMUM_LEARNING_RATE_SHARE + (1.0 - MINIMUM_LEARNING_RATE_SHARE) * 0.5 * (1.0 + math.cos(math.pi * position))


__all__ = ["Consistency", "EntropyMinimization", "FixMatch", "Method", "MixMatch", "PseudoLabel", "VirtualAdversarial",
           "binary_divergence", "binary_entropy", "cosine_share", "isolated_random_state", "multilayer_perceptron",
           "ramp", "resolve_device", "update_teacher"]
