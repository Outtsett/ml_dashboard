"""Siamese and teacher-student pretexts: two (or more) views of the same bar
must agree, with something that keeps the encoder from mapping every bar to
the same vector.

Row variants read one feature row; window variants read the causal window of
``sequence_length`` bars ending at the bar.

    SelfDistillation        K views; the student matches an EMA teacher's projected
                            output AND its hidden layer on another view; a variance
                            hinge guards against collapse (no prototypes, no negatives)
    BarlowTwins             cross-correlation of two views' batch-standardised
                            projections pushed to the identity (redundancy reduction)
    BootstrapYourOwnLatent  online predictor chases an EMA target (momentum rising to 1)
    SimclrMomentumContrast  NT-Xent over in-batch negatives (SimCLR); with a queue,
                            a momentum key encoder and a FIFO of past keys (MoCo)
    CrossViewPrediction     the feature columns split into two views by modality;
                            each view's embedding predicts the other's, plus a
                            reconstruction of the other view's raw columns
    SimpleSiamese           stop-gradient and a predictor only, SGD with momentum
    SwappedAssignments      Sinkhorn-equipartitioned prototype codes, predicted across views
    MomentumContrastV3      patch-transformer (CLS) + projector + predictor against a
                            momentum encoder, symmetrised InfoNCE, in-window crops
    PatchSelfDistillation   DINO on windows: EMA teacher on two global views, student
                            also on local crops (contiguous patches), centred and
                            sharpened teacher targets, plus a patch-level term on masked patches
    SelfAugmentedContrastive  GRU encoder, NT-Xent, and augmentation strengths that are
                            themselves learned by gradient ASCENT on the contrastive loss
                            under a log barrier
"""

from __future__ import annotations

import math

import torch
import torch.nn.functional as functional
from torch import nn

from . import augment
from .base import (
    Pretext,
    batch_deviation,
    cosine_momentum,
    ema_update,
    frozen_copy,
    info_nce,
    negative_cosine,
    nt_xent,
    variance_hinge,
)
from .encoders import GatedRecurrentEncoder, MultilayerEncoder, PatchTransformer, projection_head


class _RowPretext(Pretext):
    """A row pretext whose embedding is ``self.encoder(row)``."""

    def _build_encoder(self) -> None:
        self.encoder = MultilayerEncoder(self.feature_count, int(self.settings["hidden_size"]),
                                         int(self.settings["embedding_size"]))

    @property
    def embedding_width(self) -> int:
        return int(self.settings["embedding_size"])

    def embed(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.encoder(inputs)

    def view(self, rows: torch.Tensor, generator: torch.Generator) -> torch.Tensor:
        return augment.row_views(rows, generator, jitter_strength=float(self.settings["jitter_strength"]),
                                 scaling_strength=float(self.settings["scaling_strength"]),
                                 dropout_rate=float(self.settings["feature_dropout"]))


class SelfDistillation(_RowPretext):
    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        self._build_encoder()
        size = int(self.settings["embedding_size"])
        self.projector = projection_head(size, int(self.settings["hidden_size"]), size)
        self.teacher_encoder = frozen_copy(self.encoder)
        self.teacher_projector = frozen_copy(self.projector)

    def pretext_loss(self, batch, generator, progress):
        view_count = int(self.settings["view_count"])
        views = [self.view(batch, generator) for _ in range(view_count)]
        student = []
        for view in views:
            output, hidden = self.encoder.forward_with_hidden(view)
            student.append((output, self.projector(output), hidden))
        with torch.no_grad():
            teacher = []
            for view in views:
                output, hidden = self.teacher_encoder.forward_with_hidden(view)
                teacher.append((self.teacher_projector(output), hidden))
        distillation = batch.new_zeros(())
        pairs = 0
        for teacher_view in range(view_count):
            for student_view in range(view_count):
                if teacher_view == student_view:
                    continue
                distillation = distillation + negative_cosine(student[student_view][1], teacher[teacher_view][0])
                distillation = distillation + negative_cosine(student[student_view][2], teacher[teacher_view][1])
                pairs += 1
        distillation = 2.0 + distillation / pairs
        hinge = sum(variance_hinge(output) for output, _, _ in student) / view_count
        loss = distillation + float(self.settings["variance_weight"]) * hinge
        return loss, {"distillation": float(distillation.detach()), "variance_hinge": float(hinge.detach()),
                      "embedding_deviation": batch_deviation(student[0][0])}

    def after_step(self, progress):
        momentum = float(self.settings["teacher_momentum"])
        ema_update(self.teacher_encoder, self.encoder, momentum)
        ema_update(self.teacher_projector, self.projector, momentum)


class BarlowTwins(_RowPretext):
    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        self._build_encoder()
        width = int(self.settings["projector_size"])
        self.projector = projection_head(int(self.settings["embedding_size"]), width, width, depth=3)

    def pretext_loss(self, batch, generator, progress):
        first = self.projector(self.encoder(self.view(batch, generator)))
        second = self.projector(self.encoder(self.view(batch, generator)))
        count = first.shape[0]

        def standardised(values):
            return (values - values.mean(0)) / (values.std(0, unbiased=False) + 1e-5)

        correlation = standardised(first).t() @ standardised(second) / count
        diagonal = torch.diagonal(correlation)
        on_diagonal = ((1.0 - diagonal) ** 2).sum()
        off_diagonal = (correlation ** 2).sum() - (diagonal ** 2).sum()
        loss = on_diagonal + float(self.settings["off_diagonal_weight"]) * off_diagonal
        return loss, {"on_diagonal": float(on_diagonal.detach()), "off_diagonal": float(off_diagonal.detach())}


class BootstrapYourOwnLatent(_RowPretext):
    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        self._build_encoder()
        width = int(self.settings["projector_size"])
        self.projector = projection_head(int(self.settings["embedding_size"]), width, width)
        self.predictor = projection_head(width, int(self.settings["predictor_size"]), width)
        self.target_encoder = frozen_copy(self.encoder)
        self.target_projector = frozen_copy(self.projector)

    def pretext_loss(self, batch, generator, progress):
        first, second = self.view(batch, generator), self.view(batch, generator)
        online_first = self.predictor(self.projector(self.encoder(first)))
        online_second = self.predictor(self.projector(self.encoder(second)))
        with torch.no_grad():
            target_first = self.target_projector(self.target_encoder(first))
            target_second = self.target_projector(self.target_encoder(second))
        loss = 4.0 + 2.0 * (negative_cosine(online_first, target_second) + negative_cosine(online_second, target_first))
        return loss, {"embedding_deviation": batch_deviation(online_first)}

    def after_step(self, progress):
        momentum = cosine_momentum(float(self.settings["teacher_momentum"]), progress)
        ema_update(self.target_encoder, self.encoder, momentum)
        ema_update(self.target_projector, self.projector, momentum)


class SimclrMomentumContrast(_RowPretext):
    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        self._build_encoder()
        width = int(self.settings["projector_size"])
        self.projector = projection_head(int(self.settings["embedding_size"]), width, width)
        self.queue_size = int(self.settings["queue_size"])
        if self.queue_size > 0:
            self.key_encoder = frozen_copy(self.encoder)
            self.key_projector = frozen_copy(self.projector)
            self.register_buffer("queue", functional.normalize(torch.randn(self.queue_size, width), dim=-1))
            self.register_buffer("queue_pointer", torch.zeros(1, dtype=torch.long))
            self.register_buffer("queue_filled", torch.zeros(1, dtype=torch.long))

    def pretext_loss(self, batch, generator, progress):
        temperature = float(self.settings["temperature"])
        first, second = self.view(batch, generator), self.view(batch, generator)
        query_first = self.projector(self.encoder(first))
        query_second = self.projector(self.encoder(second))
        if self.queue_size <= 0:
            return nt_xent(query_first, query_second, temperature), {}
        with torch.no_grad():
            key_first = functional.normalize(self.key_projector(self.key_encoder(first)), dim=-1)
            key_second = functional.normalize(self.key_projector(self.key_encoder(second)), dim=-1)
        negatives = self.queue[: int(self.queue_filled.item())]
        loss = 0.5 * (info_nce(query_first, key_second, temperature, negatives)
                      + info_nce(query_second, key_first, temperature, negatives))
        self._enqueue(key_first)
        return loss, {"queue_filled": float(self.queue_filled.item())}

    @torch.no_grad()
    def _enqueue(self, keys: torch.Tensor) -> None:
        keys = keys[: self.queue_size]
        start = int(self.queue_pointer.item())
        positions = (torch.arange(keys.shape[0], device=keys.device) + start) % self.queue_size
        self.queue[positions] = keys.to(self.queue.dtype)
        self.queue_pointer.fill_((start + keys.shape[0]) % self.queue_size)
        self.queue_filled.fill_(min(int(self.queue_filled.item()) + keys.shape[0], self.queue_size))

    def after_step(self, progress):
        if self.queue_size > 0:
            momentum = float(self.settings["teacher_momentum"])
            ema_update(self.key_encoder, self.encoder, momentum)
            ema_update(self.key_projector, self.projector, momentum)


class CrossViewPrediction(Pretext):
    """Two views are two disjoint sets of feature COLUMNS (``config["views"]``)."""

    @classmethod
    def plan_config(cls, pool_inputs, feature_names, parameters, seed):
        from cycle.bridges.groups import split_views

        count = pool_inputs.shape[-1]
        names = list(feature_names) if feature_names is not None and len(feature_names) == count else \
            [f"column_{column}" for column in range(count)]
        views = split_views(names, 2, int(seed))
        if len(views) < 2 or not all(views):
            raise ValueError(f"cross-view prediction needs at least two feature columns, got {count}")
        return {"views": [list(map(int, view)) for view in views]}

    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        first, second = self.config["views"]
        self.register_buffer("first_columns", torch.tensor(first, dtype=torch.long), persistent=False)
        self.register_buffer("second_columns", torch.tensor(second, dtype=torch.long), persistent=False)
        hidden, size = int(self.settings["hidden_size"]), int(self.settings["embedding_size"])
        predictor = int(self.settings["predictor_size"])
        self.first_encoder = MultilayerEncoder(len(first), hidden, size)
        self.second_encoder = MultilayerEncoder(len(second), hidden, size)
        self.first_to_second = projection_head(size, predictor, size)
        self.second_to_first = projection_head(size, predictor, size)
        self.second_reconstruction = nn.Linear(size, len(second))
        self.first_reconstruction = nn.Linear(size, len(first))

    @property
    def embedding_width(self) -> int:
        return 2 * int(self.settings["embedding_size"])

    def _encode(self, rows):
        return (self.first_encoder(rows.index_select(-1, self.first_columns)),
                self.second_encoder(rows.index_select(-1, self.second_columns)))

    def embed(self, inputs):
        first, second = self._encode(inputs)
        return torch.cat([first, second], dim=-1)

    def pretext_loss(self, batch, generator, progress):
        noisy = augment.jitter(batch, float(self.settings["jitter_strength"]), generator)
        first, second = self._encode(noisy)
        predicted_second, predicted_first = self.first_to_second(first), self.second_to_first(second)
        agreement = 2.0 + negative_cosine(predicted_second, second) + negative_cosine(predicted_first, first)
        reconstruction = (functional.mse_loss(self.second_reconstruction(predicted_second),
                                              batch.index_select(-1, self.second_columns))
                          + functional.mse_loss(self.first_reconstruction(predicted_first),
                                                batch.index_select(-1, self.first_columns)))
        loss = agreement + float(self.settings["reconstruction_weight"]) * reconstruction
        return loss, {"agreement": float(agreement.detach()), "reconstruction": float(reconstruction.detach())}


class SimpleSiamese(_RowPretext):
    optimizer_kind = "sgd"

    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        self._build_encoder()
        width = int(self.settings["projector_size"])
        self.projector = projection_head(int(self.settings["embedding_size"]), width, width)
        self.predictor = projection_head(width, int(self.settings["predictor_size"]), width)

    def pretext_loss(self, batch, generator, progress):
        first = self.projector(self.encoder(self.view(batch, generator)))
        second = self.projector(self.encoder(self.view(batch, generator)))
        loss = 0.5 * (negative_cosine(self.predictor(first), second) + negative_cosine(self.predictor(second), first))
        return loss, {"embedding_deviation": batch_deviation(first)}


def sinkhorn(scores: torch.Tensor, smoothing: float, iterations: int) -> torch.Tensor:
    """SwAV's online equipartition: soft codes (B, K) whose columns share the
    batch equally and whose rows sum to 1."""
    logits = scores / float(smoothing)
    codes = torch.exp(logits - logits.max()).t()          # (K, B)
    codes = codes / codes.sum()
    prototype_count, batch = codes.shape
    for _ in range(int(iterations)):
        codes = codes / codes.sum(dim=1, keepdim=True) / prototype_count
        codes = codes / codes.sum(dim=0, keepdim=True) / batch
    return (codes * batch).t()


class SwappedAssignments(_RowPretext):
    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        self._build_encoder()
        width = int(self.settings["projector_size"])
        self.projector = projection_head(int(self.settings["embedding_size"]), width, width)
        self.prototypes = nn.Parameter(torch.randn(int(self.settings["prototype_count"]), width) / math.sqrt(width))

    def _scores(self, rows):
        projected = functional.normalize(self.projector(self.encoder(rows)), dim=-1)
        return projected @ functional.normalize(self.prototypes, dim=-1).t()

    def pretext_loss(self, batch, generator, progress):
        temperature = float(self.settings["temperature"])
        first = self._scores(self.view(batch, generator))
        second = self._scores(self.view(batch, generator))
        with torch.no_grad():
            smoothing, iterations = float(self.settings["sinkhorn_smoothing"]), int(self.settings["sinkhorn_iterations"])
            codes_first = sinkhorn(first.detach(), smoothing, iterations)
            codes_second = sinkhorn(second.detach(), smoothing, iterations)
        loss = -0.5 * ((codes_second * functional.log_softmax(first / temperature, dim=-1)).sum(-1).mean()
                       + (codes_first * functional.log_softmax(second / temperature, dim=-1)).sum(-1).mean())
        with torch.no_grad():
            usage = codes_first.mean(0)
            entropy = float(-(usage * torch.log(usage + 1e-12)).sum())
        return loss, {"prototype_usage_entropy": entropy}


# ─── window variants ───────────────────────────────────────────────────────


def _patch_transformer(feature_count: int, window: int, settings: dict, layer_key: str = "layer_count") -> PatchTransformer:
    return PatchTransformer(feature_count, window, int(settings["patch_bars"]), int(settings["model_dimension"]),
                            int(settings["head_count"]), int(settings[layer_key]))


class _WindowPretext(Pretext):
    windowed = True

    def window_view(self, window, generator, crop_fraction: float = 1.0):
        return augment.window_views(window, generator, jitter_strength=float(self.settings["jitter_strength"]),
                                    scaling_strength=float(self.settings["scaling_strength"]),
                                    crop_fraction=crop_fraction)


class MomentumContrastV3(_WindowPretext):
    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        self.encoder = _patch_transformer(feature_count, window, self.settings)
        width = int(self.settings["projector_size"])
        self.projector = projection_head(int(self.settings["model_dimension"]), width, width)
        self.predictor = projection_head(width, width, width)
        self.momentum_encoder = frozen_copy(self.encoder)
        self.momentum_projector = frozen_copy(self.projector)

    @property
    def embedding_width(self) -> int:
        return int(self.settings["model_dimension"])

    def embed(self, inputs):
        return self.encoder(inputs)[0]

    def pretext_loss(self, batch, generator, progress):
        temperature = float(self.settings["temperature"])
        crop = float(self.settings["crop_minimum_fraction"])
        first, second = self.window_view(batch, generator, crop), self.window_view(batch, generator, crop)
        query_first = self.predictor(self.projector(self.encoder(first)[0]))
        query_second = self.predictor(self.projector(self.encoder(second)[0]))
        with torch.no_grad():
            key_first = self.momentum_projector(self.momentum_encoder(first)[0])
            key_second = self.momentum_projector(self.momentum_encoder(second)[0])
        loss = 2.0 * temperature * (info_nce(query_first, key_second, temperature)
                                    + info_nce(query_second, key_first, temperature))
        return loss, {"embedding_deviation": batch_deviation(query_first)}

    def after_step(self, progress):
        momentum = cosine_momentum(float(self.settings["teacher_momentum"]), progress)
        ema_update(self.momentum_encoder, self.encoder, momentum)
        ema_update(self.momentum_projector, self.projector, momentum)


class PrototypeHead(nn.Module):
    """DINO's head: an MLP to a bottleneck, then a weight-normalised linear map to K prototype scores."""

    def __init__(self, input_size: int, hidden_size: int, bottleneck: int, prototype_count: int) -> None:
        super().__init__()
        self.body = projection_head(input_size, hidden_size, bottleneck)
        self.prototypes = nn.Parameter(torch.randn(prototype_count, bottleneck) / math.sqrt(bottleneck))

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        return functional.normalize(self.body(values), dim=-1) @ functional.normalize(self.prototypes, dim=-1).t()


class PatchSelfDistillation(_WindowPretext):
    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        self.student_encoder = _patch_transformer(feature_count, window, self.settings)
        dimension = int(self.settings["model_dimension"])
        self.student_head = PrototypeHead(dimension, 2 * dimension, dimension, int(self.settings["prototype_count"]))
        self.teacher_encoder = frozen_copy(self.student_encoder)
        self.teacher_head = frozen_copy(self.student_head)
        count = int(self.settings["prototype_count"])
        self.register_buffer("center", torch.zeros(1, count))
        self.register_buffer("patch_center", torch.zeros(1, count))

    @property
    def embedding_width(self) -> int:
        return int(self.settings["model_dimension"])

    def embed(self, inputs):
        return self.teacher_encoder(inputs)[0]

    def _local_crop(self, window, generator):
        """A contiguous run of about half the patches (anywhere inside the window), with its own positions."""
        encoder = self.student_encoder
        tokens = encoder.patch_embedding(encoder.patches(window))
        patch_count = encoder.patch_count
        length = max(1, patch_count // 2)
        start = torch.randint(0, patch_count - length + 1, (window.shape[0], 1), generator=generator,
                              device=window.device)
        positions = start + torch.arange(length, device=window.device).unsqueeze(0)
        chosen = tokens.gather(1, positions.unsqueeze(-1).expand(-1, -1, tokens.shape[-1]))
        return encoder.encode(chosen, positions=positions)[0]

    def pretext_loss(self, batch, generator, progress):
        teacher_temperature = float(self.settings["teacher_temperature"])
        student_temperature = float(self.settings["student_temperature"])
        global_views = [self.window_view(batch, generator), self.window_view(batch, generator)]
        with torch.no_grad():
            teacher_outputs = [self.teacher_encoder(view) for view in global_views]
            teacher_scores = [self.teacher_head(output[0]) for output in teacher_outputs]
        student_scores = [self.student_head(self.student_encoder(view)[0]) for view in global_views]
        for _ in range(int(self.settings["local_crop_count"])):
            student_scores.append(self.student_head(self._local_crop(self.window_view(batch, generator), generator)))
        loss = batch.new_zeros(())
        pairs = 0
        for teacher_index, scores in enumerate(teacher_scores):
            target = torch.softmax((scores - self.center) / teacher_temperature, dim=-1)
            for student_index, student in enumerate(student_scores):
                if student_index == teacher_index:
                    continue
                loss = loss + (-target * functional.log_softmax(student / student_temperature, dim=-1)).sum(-1).mean()
                pairs += 1
        loss = loss / pairs
        # the patch-level term: masked patches of the first global view against the teacher's patch tokens
        patch_count = self.student_encoder.patch_count
        masked = torch.rand((batch.shape[0], patch_count), generator=generator, device=batch.device) < float(
            self.settings["mask_ratio"])
        patch_term = batch.new_zeros(())
        teacher_patch_scores = self.teacher_head(teacher_outputs[0][1]) if patch_count else None
        if bool(masked.any()):
            student_tokens = self.student_encoder(global_views[0], masked=masked)[1]
            student_patch_scores = self.student_head(student_tokens)
            patch_target = torch.softmax((teacher_patch_scores - self.patch_center) / teacher_temperature, dim=-1)
            per_patch = (-patch_target * functional.log_softmax(student_patch_scores / student_temperature, dim=-1)).sum(-1)
            patch_term = per_patch[masked].mean()
        loss = loss + float(self.settings["patch_loss_weight"]) * patch_term
        with torch.no_grad():
            momentum = float(self.settings["center_momentum"])
            self.center.mul_(momentum).add_(torch.cat(teacher_scores).mean(0, keepdim=True), alpha=1.0 - momentum)
            self.patch_center.mul_(momentum).add_(teacher_patch_scores.reshape(-1, teacher_patch_scores.shape[-1]).mean(
                0, keepdim=True), alpha=1.0 - momentum)
            sharpened = torch.softmax((teacher_scores[0] - self.center) / teacher_temperature, dim=-1)
            entropy = float(-(sharpened * torch.log(sharpened + 1e-12)).sum(-1).mean())
        return loss, {"patch_term": float(patch_term.detach()), "teacher_entropy": entropy}

    def after_step(self, progress):
        momentum = cosine_momentum(float(self.settings["teacher_momentum"]), progress)
        ema_update(self.teacher_encoder, self.student_encoder, momentum)
        ema_update(self.teacher_head, self.student_head, momentum)


STRENGTH_FLOOR = 0.01
STRENGTH_CEILING = 0.5
STRENGTH_NAMES = ("jitter", "scaling", "trend")
TEMPORAL_MASK_RATE = 0.1


class SelfAugmentedContrastive(_WindowPretext):
    """Three augmentation strengths (jitter, per-feature scaling, a random linear
    trend that is zero at the embedded bar) live in (floor, ceiling) through a
    sigmoid and are pushed UP the contrastive loss (plus a log barrier that keeps
    them off both bounds) while the encoder pushes the loss down."""

    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        size = int(self.settings["embedding_size"])
        self.encoder = GatedRecurrentEncoder(feature_count, int(self.settings["hidden_size"]), size)
        width = int(self.settings["projector_size"])
        self.projector = projection_head(size, width, width)
        self.strength_logits = nn.Parameter(torch.zeros(len(STRENGTH_NAMES)))

    @property
    def embedding_width(self) -> int:
        return int(self.settings["embedding_size"])

    def embed(self, inputs):
        return self.encoder(inputs)

    def strengths(self) -> torch.Tensor:
        return STRENGTH_FLOOR + (STRENGTH_CEILING - STRENGTH_FLOOR) * torch.sigmoid(self.strength_logits)

    def training_parameters(self):
        return [parameter for name, parameter in self.named_parameters() if name != "strength_logits"]

    def _view(self, window, generator):
        strength = self.strengths().to(window.dtype)
        batch, length, count = window.shape

        def normal(shape):
            return torch.randn(shape, generator=generator, device=window.device, dtype=window.dtype)

        view = window * (1.0 + strength[1] * normal((batch, 1, count)))
        view = view + strength[0] * normal(window.shape)
        ramp = torch.linspace(-1.0, 0.0, length, device=window.device, dtype=window.dtype).view(1, length, 1)
        view = view + strength[2] * normal((batch, 1, count)) * ramp
        return augment.temporal_mask(view, TEMPORAL_MASK_RATE, generator)

    def pretext_loss(self, batch, generator, progress):
        first = self.projector(self.encoder(self._view(batch, generator)))
        second = self.projector(self.encoder(self._view(batch, generator)))
        contrastive = nt_xent(first, second, float(self.settings["temperature"]))
        strength = self.strengths()
        barrier = float(self.settings["strength_barrier_weight"]) * (
            torch.log(strength - STRENGTH_FLOOR + 1e-6) + torch.log(STRENGTH_CEILING - strength + 1e-6)).sum()
        # backward of (contrastive + barrier): the encoder's gradient is the contrastive one (the barrier
        # does not depend on it); the strengths ASCEND contrastive + barrier in before_optimizer_step
        return contrastive + barrier, {"contrastive": float(contrastive.detach())}

    def before_optimizer_step(self):
        gradient = self.strength_logits.grad
        if gradient is not None:
            with torch.no_grad():
                self.strength_logits.add_(float(self.settings["augmentation_learning_rate"]) * gradient)
            self.strength_logits.grad = None

    def describe(self):
        return {f"{name}_strength": float(value) for name, value in zip(STRENGTH_NAMES, self.strengths().detach())}


__all__ = ["BarlowTwins", "BootstrapYourOwnLatent", "CrossViewPrediction", "MomentumContrastV3",
           "PatchSelfDistillation", "PrototypeHead", "SelfAugmentedContrastive", "SelfDistillation",
           "SimclrMomentumContrast", "SimpleSiamese", "SwappedAssignments", "sinkhorn"]
