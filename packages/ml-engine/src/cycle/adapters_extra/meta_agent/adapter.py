"""``MetaAgentAdapter``: the meta-reinforcement-learning family of the Model Cycle.

One adapter, ten mechanisms, picked by the registry entry's
``direction.fixed.variant`` (``packages/config/cycle_models/meta_agent.json``):

    maml                     gradient_meta.ModelAgnosticMetaLearner
    reptile                  gradient_meta.ReptileMetaLearner
    rl_squared               recurrent.RecurrentMetaPolicy
    pearl                    latent_context.ProbabilisticContextActorCritic
    meta_policy_gradient     meta_gradient.MetaGradientActorCritic
    learned_optimizer        learned_optimizer.LearnedOptimizerPolicy
    task_aware               task_embedding.TaskAwareActorCritic
    distral                  distral.DistralPolicies
    hypernetwork_policy      hyper_policy.HypernetworkPolicy
    successor_features       successor.SuccessorFeatureAgent

What they share (see ``common.py``): the market does not react to the agent's
position, so each is cost-aware reward maximisation on the training span's
price tape; the agent's own position is not in its state, so a bar's
prediction never depends on earlier calls; every test-time adaptation reads
only outcomes already realised at the bar (rows <= t - h), cached per block of
bars. Only ``maml`` and ``reptile`` build a price model (a regression head
adapted the same way); the others have none (``NoPriceModel``).
"""

from __future__ import annotations

import importlib
from pathlib import Path

import numpy as np

from cycle.adapters_extra.meta_agent.common import one_thread
from cycle.bridges import persistence
from cycle.bridges.base import BridgeAdapter
from cycle.models import _training_summary

MECHANISMS = {
    "maml": "gradient_meta:ModelAgnosticMetaLearner",
    "reptile": "gradient_meta:ReptileMetaLearner",
    "rl_squared": "recurrent:RecurrentMetaPolicy",
    "pearl": "latent_context:ProbabilisticContextActorCritic",
    "meta_policy_gradient": "meta_gradient:MetaGradientActorCritic",
    "learned_optimizer": "learned_optimizer:LearnedOptimizerPolicy",
    "task_aware": "task_embedding:TaskAwareActorCritic",
    "distral": "distral:DistralPolicies",
    "hypernetwork_policy": "hyper_policy:HypernetworkPolicy",
    "successor_features": "successor:SuccessorFeatureAgent",
}


def mechanism_class(variant: str):
    if variant not in MECHANISMS:
        raise ValueError(f"meta_agent: unknown variant {variant!r}; the family has: {', '.join(MECHANISMS)}")
    module_name, _, name = MECHANISMS[variant].partition(":")
    module = importlib.import_module(f"{__package__}.{module_name}")
    return getattr(module, name)


class MetaAgentAdapter(BridgeAdapter):
    model_file = "model.pt"

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        cls = mechanism_class(self.variant)
        if task == "regression" and not cls.has_regression:
            raise ValueError(f"{key}: the {self.variant} mechanism has no price model (its registry price is null)")
        self.step_unit = cls.step_unit
        self.mechanism = None
        # tiny float64 networks walked one bar at a time: the CPU, whatever the run's device
        self.device = "cpu"

    def minimum_history(self) -> int:
        return int(mechanism_class(self.variant).minimum_history(self.parameters))

    def _on_bind(self, view) -> None:
        if self.mechanism is not None:
            self.mechanism.bind(view)

    def _build(self, feature_count: int):
        return mechanism_class(self.variant)(self.key, self.parameters, self.seed, self.task, feature_count)

    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        self.mechanism = self._build(int(features.shape[1]))
        self.mechanism.bind(self.market)
        with one_thread():
            summary = self.mechanism.fit(features, labels, train_index, validation_index, reporter)
        self.best_iteration = summary.get("best_epoch")
        self.fit_summary = {**_training_summary(train_index, validation_index, timestamps), **summary}

    def _predict_probability(self, features, index) -> np.ndarray:
        with one_thread():
            return self.mechanism.predict(features, index)

    def _predict_value(self, features, index) -> np.ndarray:
        with one_thread():
            return self.mechanism.predict(features, index)

    def _save_state(self, folder: Path) -> str:
        persistence.save_torch(folder / self.model_file, self.mechanism.state())
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        cls = mechanism_class(self.variant)
        self.step_unit = cls.step_unit
        self.mechanism = self._build(int(metadata["feature_count"]))
        self.mechanism.load_state(persistence.load_torch(folder / metadata.get("model_file", self.model_file)))

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "torch", "scikit-learn")


__all__ = ["MECHANISMS", "MetaAgentAdapter", "mechanism_class"]
