"""Predictive pretexts: learn a representation by predicting something about the series.

    ContrastivePredictiveCoding   per-bar encoder z, GRU context c_t over the window; for
                                  k = 1..K a bilinear score z_{t+k}' W_k c_t trained with InfoNCE
                                  against the other anchors of the batch (van den Oord 2018).
                                  The future bars t+k come only from INSIDE the training span
                                  (the adapter hands a batch of window + K bars and checks the bound)
    PredictiveCoding              level 1 latents z_s of each bar, level 2 recurrent state
                                  predicting the next latent; prediction error + reconstruction
                                  + a latent variance floor. The embedding is [z_t refined by a
                                  few steps of predictive-coding inference, the top-down
                                  prediction of z_t, their difference (the surprise)]; every
                                  term reads bars <= t
    TransformationPrediction      RotNet for series: each window as itself, negated, time-reversed,
                                  and both; a 4-way classifier names the transformation
    SelfPredictiveRepresentations SPR: the online latent rolled forward K steps by a transition
                                  model must match an EMA target encoder's projection of the
                                  windows ending at t+1..t+K (inside the training span)
    TransformerSelfSupervision    a patch transformer trained on masked-patch reconstruction +
                                  CLS contrast between two masked views + CLS distillation from
                                  a momentum teacher (the spec's combined recipe)
"""

from __future__ import annotations

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
    variance_hinge,
)
from .encoders import (
    GatedRecurrentEncoder,
    MultilayerEncoder,
    PatchTransformer,
    TemporalConvolutionEncoder,
    projection_head,
)
from .reconstruction import normalised_patches

INFERENCE_STEP_SIZE = 0.1


class ContrastivePredictiveCoding(Pretext):
    windowed = True

    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        self.future_steps = int(self.settings["prediction_steps"])
        size, context = int(self.settings["embedding_size"]), int(self.settings["hidden_size"])
        self.encoder = MultilayerEncoder(feature_count, context, size)
        self.context = nn.GRU(size, context, batch_first=True)
        self.predictors = nn.ModuleList([nn.Linear(context, size, bias=False) for _ in range(self.future_steps)])

    @property
    def embedding_width(self) -> int:
        return int(self.settings["hidden_size"])

    def _context(self, window):
        _, last = self.context(self.encoder(window))
        return last[-1]

    def embed(self, inputs):
        return self._context(inputs)

    def pretext_loss(self, batch, generator, progress):
        window = self.window
        latents = self.encoder(batch)                                  # (B, window + K, size)
        _, last = self.context(latents[:, :window])
        context = last[-1]
        temperature = float(self.settings["temperature"])
        targets = torch.arange(batch.shape[0], device=batch.device)
        loss = batch.new_zeros(())
        accuracy = 0.0
        for step, predictor in enumerate(self.predictors, start=1):
            logits = predictor(context) @ latents[:, window - 1 + step].t() / temperature
            loss = loss + functional.cross_entropy(logits, targets)
            accuracy += float((logits.argmax(-1) == targets).to(batch.dtype).mean())
        steps = len(self.predictors)
        return loss / steps, {"future_match_accuracy": accuracy / steps}


class PredictiveCoding(Pretext):
    windowed = True

    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        latent, hidden = int(self.settings["latent_dimension"]), int(self.settings["hidden_size"])
        self.encoder = MultilayerEncoder(feature_count, hidden, latent)
        self.decoder = MultilayerEncoder(latent, hidden, feature_count)
        self.context = nn.GRU(latent, hidden, batch_first=True)
        self.predictor = nn.Linear(hidden, latent)
        self.initial_prediction = nn.Parameter(torch.zeros(latent))

    @property
    def embedding_width(self) -> int:
        return 3 * int(self.settings["latent_dimension"])

    def _levels(self, window):
        """z (B, L, D); the prediction of z_s from bars < s (B, L, D); the prediction of z_{s+1} (B, L, D)."""
        latents = self.encoder(window)
        states, _ = self.context(latents)
        following = self.predictor(states)
        first = self.initial_prediction.to(latents.dtype).expand(latents.shape[0], 1, -1)
        current = torch.cat([first, following[:, :-1]], dim=1)
        return latents, current, following

    def pretext_loss(self, batch, generator, progress):
        latents, _, following = self._levels(batch)
        prediction_error = ((latents[:, 1:] - following[:, :-1]) ** 2).mean()
        reconstruction = functional.mse_loss(self.decoder(latents), batch)
        floor = variance_hinge(latents.reshape(-1, latents.shape[-1]))
        loss = (float(self.settings["prediction_weight"]) * prediction_error
                + float(self.settings["reconstruction_weight"]) * reconstruction + floor)
        return loss, {"prediction_error": float(prediction_error.detach()), "reconstruction": float(reconstruction.detach())}

    def embed(self, inputs):
        latents, current, _ = self._levels(inputs)
        latent, prediction = latents[:, -1], current[:, -1]
        observed = inputs[:, -1]
        steps = int(self.settings["inference_steps"])
        if steps > 0:
            # predictive-coding inference: settle z_t between the bottom-up error (reconstruct the
            # bar) and the top-down error (match the prediction); each row's energy is its own
            with torch.enable_grad():
                state = latent.detach().clone().requires_grad_(True)
                for _ in range(steps):
                    energy = ((observed - self.decoder(state)) ** 2).sum() + ((state - prediction.detach()) ** 2).sum()
                    (gradient,) = torch.autograd.grad(energy, state)
                    state = (state - INFERENCE_STEP_SIZE * gradient).detach().requires_grad_(True)
            latent = state.detach()
        return torch.cat([latent, prediction, latent - prediction], dim=-1)


TRANSFORMATIONS = ("identity", "negation", "time_reversal", "negation_and_time_reversal")


def transformed(window: torch.Tensor, which: int) -> torch.Tensor:
    if which == 1:
        return -window
    if which == 2:
        return torch.flip(window, dims=[1])
    if which == 3:
        return -torch.flip(window, dims=[1])
    return window


class TransformationPrediction(Pretext):
    windowed = True

    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        size = int(self.settings["embedding_size"])
        self.encoder = TemporalConvolutionEncoder(feature_count, int(self.settings["hidden_size"]), size)
        self.classifier = nn.Linear(size, len(TRANSFORMATIONS))

    @property
    def embedding_width(self) -> int:
        return int(self.settings["embedding_size"])

    def embed(self, inputs):
        return self.encoder(inputs)

    def pretext_loss(self, batch, generator, progress):
        views = torch.cat([transformed(batch, which) for which in range(len(TRANSFORMATIONS))], dim=0)
        targets = torch.arange(len(TRANSFORMATIONS), device=batch.device).repeat_interleave(batch.shape[0])
        logits = self.classifier(self.encoder(views))
        loss = functional.cross_entropy(logits, targets)
        accuracy = float((logits.argmax(-1) == targets).to(batch.dtype).mean())
        return loss, {"transformation_accuracy": accuracy}


class SelfPredictiveRepresentations(Pretext):
    windowed = True

    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        self.future_steps = int(self.settings["prediction_steps"])
        size, hidden = int(self.settings["embedding_size"]), int(self.settings["hidden_size"])
        width = int(self.settings["projector_size"])
        self.encoder = GatedRecurrentEncoder(feature_count, hidden, size)
        self.transition = projection_head(size, hidden, size)
        self.projector = projection_head(size, width, width)
        self.predictor = projection_head(width, width, width)
        self.target_encoder = frozen_copy(self.encoder)
        self.target_projector = frozen_copy(self.projector)

    @property
    def embedding_width(self) -> int:
        return int(self.settings["embedding_size"])

    def embed(self, inputs):
        return self.encoder(inputs)

    def pretext_loss(self, batch, generator, progress):
        window = self.window
        online = augment.jitter(batch[:, :window], float(self.settings["jitter_strength"]), generator)
        latent = self.encoder(online)
        rolled = latent
        loss = batch.new_zeros(())
        copy_baseline = 0.0
        for step in range(1, self.future_steps + 1):
            rolled = rolled + self.transition(rolled)
            with torch.no_grad():
                target = self.target_projector(self.target_encoder(batch[:, step:step + window]))
                copy_baseline += float(negative_cosine(self.predictor(self.projector(latent)), target))
            loss = loss + negative_cosine(self.predictor(self.projector(rolled)), target)
        steps = self.future_steps
        loss = 1.0 + loss / steps
        return loss, {"prediction_cosine": float((1.0 - loss).detach()), "copy_latent_cosine": -copy_baseline / steps}

    def after_step(self, progress):
        momentum = float(self.settings["teacher_momentum"])
        ema_update(self.target_encoder, self.encoder, momentum)
        ema_update(self.target_projector, self.projector, momentum)


class TransformerSelfSupervision(Pretext):
    windowed = True

    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        self.encoder = PatchTransformer(feature_count, window, int(self.settings["patch_bars"]),
                                        int(self.settings["model_dimension"]), int(self.settings["head_count"]),
                                        int(self.settings["layer_count"]))
        dimension, width = int(self.settings["model_dimension"]), int(self.settings["projector_size"])
        self.decoder = nn.Linear(dimension, self.encoder.patch_bars * feature_count)
        self.projector = projection_head(dimension, width, width)
        self.teacher_encoder = frozen_copy(self.encoder)
        self.teacher_projector = frozen_copy(self.projector)

    @property
    def embedding_width(self) -> int:
        return int(self.settings["model_dimension"])

    def embed(self, inputs):
        return self.encoder(inputs)[0]

    def pretext_loss(self, batch, generator, progress):
        encoder = self.encoder
        target = normalised_patches(encoder.patches(batch))
        reconstruction = batch.new_zeros(())
        projections = []
        for _ in range(2):
            view = augment.window_views(batch, generator, jitter_strength=float(self.settings["jitter_strength"]),
                                        scaling_strength=float(self.settings["scaling_strength"]))
            tokens = encoder.patch_embedding(encoder.patches(view))
            masked = torch.rand(tokens.shape[:2], generator=generator, device=batch.device) < float(
                self.settings["mask_ratio"])
            head, outputs = encoder.encode(tokens, masked=masked)
            if bool(masked.any()):
                reconstruction = reconstruction + ((self.decoder(outputs) - target) ** 2).mean(-1)[masked].mean()
            projections.append(self.projector(head))
        temperature = float(self.settings["temperature"])
        contrastive = 0.5 * (info_nce(projections[0], projections[1], temperature)
                             + info_nce(projections[1], projections[0], temperature))
        with torch.no_grad():
            teacher = self.teacher_projector(self.teacher_encoder(batch)[0])
        distillation = 1.0 + 0.5 * (negative_cosine(projections[0], teacher) + negative_cosine(projections[1], teacher))
        loss = (float(self.settings["reconstruction_weight"]) * reconstruction / 2.0
                + float(self.settings["contrastive_weight"]) * contrastive
                + float(self.settings["distillation_weight"]) * distillation)
        return loss, {"reconstruction": float((reconstruction / 2.0).detach()), "contrastive": float(contrastive.detach()),
                      "distillation": float(distillation.detach()), "embedding_deviation": batch_deviation(projections[0])}

    def after_step(self, progress):
        momentum = cosine_momentum(float(self.settings["teacher_momentum"]), progress)
        ema_update(self.teacher_encoder, self.encoder, momentum)
        ema_update(self.teacher_projector, self.projector, momentum)


__all__ = ["ContrastivePredictiveCoding", "PredictiveCoding", "SelfPredictiveRepresentations", "TRANSFORMATIONS",
           "TransformationPrediction", "TransformerSelfSupervision", "transformed"]
