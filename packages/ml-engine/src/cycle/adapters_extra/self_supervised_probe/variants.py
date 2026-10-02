"""Variant name (``direction.fixed.variant`` in the registry) -> pretext class.

The variant names are the registry keys of ``packages/config/cycle_models/self_supervised_probe.json``.
"""

from __future__ import annotations

from .predictive import (
    ContrastivePredictiveCoding,
    PredictiveCoding,
    SelfPredictiveRepresentations,
    TransformationPrediction,
    TransformerSelfSupervision,
)
from .reconstruction import (
    DenoisingAutoencoder,
    MaskedAutoencoder,
    MaskedFeatureModeling,
    MaskedGraphModeling,
)
from .siamese import (
    BarlowTwins,
    BootstrapYourOwnLatent,
    CrossViewPrediction,
    MomentumContrastV3,
    PatchSelfDistillation,
    SelfAugmentedContrastive,
    SelfDistillation,
    SimclrMomentumContrast,
    SimpleSiamese,
    SwappedAssignments,
)

VARIANTS = {
    "denoising_autoencoder": DenoisingAutoencoder,
    "self_distillation": SelfDistillation,
    "barlow_twins": BarlowTwins,
    "bootstrap_your_own_latent": BootstrapYourOwnLatent,
    "simclr_momentum_contrast": SimclrMomentumContrast,
    "cross_view_prediction": CrossViewPrediction,
    "momentum_contrast_v3": MomentumContrastV3,
    "patch_self_distillation": PatchSelfDistillation,
    "self_augmented_contrastive": SelfAugmentedContrastive,
    "simple_siamese": SimpleSiamese,
    "swapped_assignments": SwappedAssignments,
    "masked_autoencoder": MaskedAutoencoder,
    "masked_graph_modeling": MaskedGraphModeling,
    "masked_feature_modeling": MaskedFeatureModeling,
    "contrastive_predictive_coding": ContrastivePredictiveCoding,
    "predictive_coding": PredictiveCoding,
    "transformation_prediction": TransformationPrediction,
    "self_predictive_representations": SelfPredictiveRepresentations,
    "transformer_self_supervision": TransformerSelfSupervision,
}


def future_steps(variant: str, parameters: dict) -> int:
    """Bars after the anchor a pretext batch of this variant carries (CPC and SPR read the
    next ``prediction_steps`` bars, all inside the training span)."""
    if variant in ("contrastive_predictive_coding", "self_predictive_representations"):
        return int(parameters["prediction_steps"])
    return 0


__all__ = ["VARIANTS", "future_steps"]
