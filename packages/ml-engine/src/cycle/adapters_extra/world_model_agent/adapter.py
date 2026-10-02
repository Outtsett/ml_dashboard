"""``WorldModelAgentAdapter``: the fourteen world-model and imagination agents of the
reinforcement-learning catalog as Model Cycle adapters.

Built by ``models.build_adapter`` for every registry entry with ``adapter ==
"world_model_agent"`` (``packages/config/cycle_models/world_model_agent.json``); the
entry's ``direction.fixed.variant`` picks the agent (``agents.AGENTS``):

    world_models                          V (row VAE) + M (MDN-LSTM) + C (linear, CMA-ES)
    recurrent_state_space_model           RSSM + actor-critic on (h, z)
    variational_world_model               VRNN with KL warmup + actor-critic on h
    deep_markov_decision_process          DeepMDP latent transition / reward losses + actor-critic
    temporal_predictive_coding_agent      CPC (InfoNCE) + actor-critic on the context
    state_space_abstraction               bisimulation encoder + k-means + value iteration
    hierarchical_latent_variable_model    two-level VAE + actor-critic
    dreamer                               RSSM + actor-critic learned in imagination, jointly
    latent_imagination_policy             frozen RSSM, then actor-critic in imagination only
    simulated_policy_learning             SimPLe: environment model + PPO in simulation
    hybrid_model_free_model_based_agent   Dyna mixture of real and model rollouts + lookahead
    imagination_augmented_agent           I2A rollout encoders + model-free path
    action_conditioned_dynamics_transformer   causal transformer scoring candidate actions
    neural_ode_dynamics_learner           ODE-RNN over the real elapsed time

How the Model Cycle's contract is met
-------------------------------------
- **The market.** The market does not react to the agent's position, so each
  agent maximises cost-aware reward on the training span's price tape
  (``bridges.tape.RewardTape``: next-open fills, one round trip per decision,
  held for the label horizon h), and its own position is left out of its state.
  Fitting needs the bound ``MarketView`` (``require_market``); the reward tape
  reads open prices, which only a fit may.
- **Causality.** A bar's state is rebuilt from its window of the last
  ``sequence_length`` feature rows on every call; the fit reads rewards and
  targets only for the training span (``data.build_fit_data``), features only up
  to the last validation row, and validation rows only for early stopping and,
  for the two validation-curve agents, the temperature.
- **P(up)** is the controller's share of long over long + short
  (``predict_proba``), or, for the transformer and the state abstraction, the
  sigmoid of the long-minus-short value gap scaled by an inverse temperature
  fitted on validation (``logistic_curve_on_validation``).
- **The price model** is the world model with its return head trained on the
  price target over the training span (the ODE integrates to the horizon first;
  the environment-model agents use the model's own reward head; the state
  abstraction the abstract state's mean target).
- **Reproducibility.** Everything runs on the CPU (``gpu: false``: the models
  are small, and CPU arithmetic is what makes a clean and a poisoned fit give
  bit-identical weights). Initial weights come from the seed inside
  ``torch.random.fork_rng``; minibatches, latent samples and imagined rollouts
  from generators seeded by the run's seed; prediction runs on a float64 copy
  of the weights with posterior means (no sampling), except I2A, whose model
  noise is drawn per bar from (seed, bar). One bar alone equals the batch.
- **Progress.** One epoch = one pass (or one CMA-ES generation, or one SimPLe
  cycle); ``bridges.training.run_epochs`` reports it, validates it, keeps the
  best epoch and stops early after ``patience`` epochs without improvement.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cycle.bridges import persistence
from cycle.bridges.base import BridgeAdapter
from cycle.bridges.calibration import TemperatureScale
from cycle.bridges.training import ValidationScore, run_epochs, score

from .data import build_fit_data, elapsed_bars, gather_series, gather_windows

PREDICT_CHUNK = 2048


def validation_net_reward(probability: np.ndarray, move: np.ndarray, cost: np.ndarray) -> float | None:
    """Mean scaled net reward on the validation rows of the position 2 P(up) - 1 (the checkpoint
    selection of every agent: an RL policy is kept for what it earns, not for how calibrated its
    long share is). None when no validation row has a known tape reward."""
    position = 2.0 * np.asarray(probability, dtype=np.float64) - 1.0
    reward = position * move - np.abs(position) * cost
    known = np.isfinite(reward)
    return float(np.mean(reward[known])) if known.any() else None


class WorldModelAgentAdapter(BridgeAdapter):
    step_unit = "epoch"
    model_file = "world_model.pt"

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        from .agents import AGENTS

        if self.variant not in AGENTS:
            raise ValueError(f"{key}: unknown world-model variant {self.variant!r}; known: {', '.join(sorted(AGENTS))}")
        self.agent = None
        self._inference = None

    def minimum_history(self) -> int:
        return int(self.parameters["sequence_length"])

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "torch", "torchdiffeq", "cma", "stable_baselines3",
                                            "scikit-learn", "gymnasium")

    # ── building agents ──
    def _new_agent(self, feature_count: int):
        import torch

        from .agents import build_agent

        with torch.random.fork_rng(devices=[]):
            torch.manual_seed(self.seed)
            return build_agent(self.variant, int(feature_count), self.parameters, self.task, self.seed)

    def _inference_copy(self, agent):
        """A float64, eval-mode copy of ``agent``'s current weights (prediction runs on it)."""
        clone = self._new_agent(agent.feature_count)
        clone.load_state_dict(agent.state_dict())
        return clone.double().eval()

    def _inference_model(self):
        if self._inference is None:
            self._inference = self._inference_copy(self.agent)
        return self._inference

    # ── inputs ──
    def _inputs(self, model, features: np.ndarray, rows: np.ndarray, elapsed: np.ndarray | None) -> dict:
        import torch

        inputs = {"window": torch.from_numpy(gather_windows(features, rows, model.length, dtype=np.float64))}
        if model.uses_elapsed:
            series = gather_series(elapsed, rows, model.length, fill=1.0)
            inputs["elapsed_series"] = torch.from_numpy(series)
        if model.uses_noise:
            inputs["noise"] = torch.from_numpy(model.noise(rows))
        return inputs

    def _predict_elapsed(self, model, rows: np.ndarray) -> np.ndarray | None:
        if not model.uses_elapsed:
            return None
        if self.market is None:
            raise RuntimeError(f"{self.key}: the neural ODE integrates over the time between bars, which it reads "
                               "from the run's market view; bind it with bind_market(view) before predicting")
        last = int(rows.max())
        return elapsed_bars(np.asarray(self.market.timestamps)[: last + 1], float(model.bar_seconds))

    # ── fit ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        import torch

        view = self.require_market()
        data = build_fit_data(features, labels, train_index, validation_index, view, self.task,
                              int(self.parameters["sequence_length"]), int(self.parameters["maximum_training_bars"]))
        if data.train_rows.size < 2:
            raise ValueError(f"{self.key}: {data.train_rows.size} training rows; a world model needs at least 2")
        if self.task == "classification" and not np.isfinite(data.move[data.train_rows]).any():
            raise ValueError(f"{self.key}: no training row has a known tape reward (open prices past the span?)")
        agent = self._new_agent(features.shape[1])
        agent.configure(data)
        generator = torch.Generator().manual_seed(self.seed)
        self.agent = agent
        self._inference = None
        reporter.log(f"{self.key}: fitting the {self.variant.replace('_', ' ')} on {data.train_rows.size} training "
                     f"bars, windows of {agent.length} bars, on the CPU")
        summary = run_epochs(
            reporter, epoch_count=agent.epoch_count(), train_index=data.train_rows,
            train_epoch=lambda epoch, report_batch: agent.train_epoch(epoch, data, report_batch, generator, reporter),
            validate=lambda epoch: self._validate(agent, data, epoch),
            snapshot=lambda: {name: value.detach().clone() for name, value in agent.state_dict().items()},
            restore=agent.load_state_dict, patience=int(self.parameters["patience"]), name=self.key)
        agent.eval()
        self._inference = None
        self.best_iteration = int(summary["best_epoch"])
        self.fit_summary = {
            "variant": self.variant, "train_row_count": int(data.train_rows.size),
            "validation_row_count": int(data.validation_rows.size), "trained_epochs": int(summary["trained_epochs"]),
            "best_epoch": int(summary["best_epoch"]), "best_validation_loss": summary["best_validation_loss"],
            "inverse_temperature": float(agent.inverse_temperature), "fit_seconds": float(summary["fit_seconds"]),
            **agent.summary(),
        }

    def _validate(self, agent, data, epoch: int) -> ValidationScore:
        import torch

        rows = data.validation_rows
        if rows.size == 0 or not agent.validation_ready(epoch):
            return ValidationScore(None, None, None, None)
        model = self._inference_copy(agent)
        inputs = self._inputs(model, data.features, rows, data.elapsed)
        with torch.no_grad():
            if self.task == "classification":
                direction = model.direction_score(inputs).numpy().astype(np.float64)
                if agent.probability_source == "logistic_curve_on_validation":
                    scale = TemperatureScale.fit(direction, data.validation_targets)
                    agent.inverse_temperature.fill_(float(scale.inverse_temperature))
                    direction = scale.apply(direction)
                result = score("classification", direction, data.validation_targets)
                reward = validation_net_reward(direction, data.validation_move, data.validation_cost)
                return result if reward is None else ValidationScore(result.loss, result.accuracy, result.f1_score,
                                                                     -reward)
            value = model.price_value(inputs).numpy().astype(np.float64)
        return score("regression", value, data.validation_targets)

    # ── predict ──
    def _predict(self, features: np.ndarray, index: np.ndarray, what: str) -> np.ndarray:
        import torch

        model = self._inference_model()
        index = np.asarray(index, dtype=np.int64)
        elapsed = self._predict_elapsed(model, index)
        out = []
        for start in range(0, index.size, PREDICT_CHUNK):
            rows = index[start: start + PREDICT_CHUNK]
            inputs = self._inputs(model, features, rows, elapsed)
            with torch.no_grad():
                values = model.probability(inputs) if what == "probability" else model.price_value(inputs)
            out.append(values.detach().numpy().astype(np.float64).reshape(-1))
        return np.concatenate(out) if out else np.empty(0, dtype=np.float64)

    def _predict_probability(self, features, index) -> np.ndarray:
        return self._predict(features, index, "probability")

    def _predict_value(self, features, index) -> np.ndarray:
        return self._predict(features, index, "value")

    # ── save / load ──
    def _save_state(self, folder: Path) -> str:
        persistence.save_torch(folder / self.model_file, dict(self.agent.state_dict()))
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        state = persistence.load_torch(folder / metadata.get("model_file", self.model_file))
        self.agent = self._new_agent(int(metadata["feature_count"]))
        self.agent.load_state_dict(state)
        self.agent.eval()
        self._inference = None


__all__ = ["WorldModelAgentAdapter"]
