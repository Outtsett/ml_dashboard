"""``PolicyAgentAdapter``: a policy agent as a Model Cycle adapter.

The fit builds two reward tapes from the bound market view: the TRAINING tape
(prices through ``train_index[-1] + h + 1``, ``bridges.tape``) the agent learns
on, and the VALIDATION tape (prices through ``validation_index[-1] + h``, the
last price a validation label reads) its checkpoints are chosen on. The agent's
observation is the bar's own causal feature row (the multi-modal agent: the
last ``sequence_length`` rows plus calendar channels), never its own position,
so a bar's P(up) does not depend on earlier calls. Actions are short / flat /
long (a position in [-1, 1] for SAC, DDPG, TD3 and NAF); a decision's reward is
the whole h-bar trade it opens at the next bar's open, net of the round-trip
cost, in move-scale units.

Variants and their backends (``direction.fixed.variant``):
    ppo, a2c, trpo, sac, ddpg, td3                    ``sb3_backend``
    reinforce, vanilla_policy_gradient, actor_critic,
    a3c, q_prop, naf, modality_policy                 ``trainers``
    cem                                               ``cem``

Only ``modality_policy`` has a price model (task ``regression``): the same
network, its auxiliary Huber head read as the price-target forecast.

Saved files: ``policy.pt`` (torch weights), ``state.json`` (architecture,
calibration), ``arrays.npz`` (the cross-entropy method's mean and spread).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cycle.bridges import persistence
from cycle.bridges.base import BridgeAdapter
from cycle.bridges.tape import RewardTape

from .cem import CrossEntropyMethod
from .readout import (
    FitContext,
    ValidationEvaluator,
    long_share,
    observation_rows,
    reward_table,
    validation_tape,
)
from .sb3_backend import SB3_VARIANTS, StableBaselinesAgent
from .trainers import TRAINERS, modality_columns, thread_cap

VARIANTS = (*SB3_VARIANTS, *TRAINERS, "cem")
PRICE_VARIANTS = ("modality_policy",)
WEIGHTS_FILE = "policy.pt"
STATE_FILE = "state.json"
ARRAYS_FILE = "arrays.npz"


class PolicyAgentAdapter(BridgeAdapter):
    model_file = WEIGHTS_FILE

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in VARIANTS:
            raise ValueError(f"{key}: unknown policy agent variant {self.variant!r}; valid: {', '.join(VARIANTS)}")
        if task == "regression" and self.variant not in PRICE_VARIANTS:
            raise ValueError(f"{key}: the {self.variant} agent has no price model")
        self.device = "cpu"          # small policy networks: the CPU is faster than a round trip to the GPU
        self.backend = None

    def minimum_history(self) -> int:
        if self.variant == "modality_policy":
            return int(self.parameters["sequence_length"])
        return 1

    # ── fitting ──
    def _architecture(self, feature_count: int) -> dict:
        architecture = {"input_size": int(feature_count)}
        if self.variant == "modality_policy":
            groups, labels = modality_columns(self.market.feature_names, feature_count)
            heads = int(self.parameters["head_count"])
            embedding = int(self.parameters["embedding_size"])
            embedding = max(heads, int(np.ceil(embedding / heads)) * heads)   # attention needs a multiple of the heads
            architecture.update(groups=groups, modalities=labels, head_count=heads, embedding_size=embedding)
        return architecture

    def _new_backend(self, architecture: dict):
        if self.variant in SB3_VARIANTS:
            return StableBaselinesAgent(self.parameters, self.seed, architecture, self.variant)
        if self.variant == "cem":
            return CrossEntropyMethod(self.parameters, self.seed, architecture)
        return TRAINERS[self.variant](self.parameters, self.seed, architecture)

    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        view = self.require_market()
        features = np.asarray(features)
        tape = RewardTape.from_view(view, np.asarray(train_index, dtype=np.int64))
        span = view.fit_rows(train_index)
        rows = tape.usable_rows(span)
        _, complete = observation_rows(features, rows)
        rows = rows[complete]
        if rows.size < 2:
            raise ValueError(f"{self.key}: {rows.size} training rows have a known reward and a complete feature row; "
                             "the agent needs at least 2")
        validation_rows = np.asarray(validation_index, dtype=np.int64)
        evaluator = ValidationEvaluator(features, np.asarray(labels), validation_rows,
                                        validation_tape(view, validation_rows))
        context = FitContext(features=features, labels=np.asarray(labels), train_rows=rows,
                             reward_table=reward_table(tape, rows), tape=tape, evaluator=evaluator,
                             parameters=self.parameters, seed=self.seed, reporter=reporter, task=self.task,
                             name=self.key, view=view)
        reporter.log(f"{self.key}: {self.variant} agent on {rows.size} training bars of the reward tape "
                     f"(holding {tape.holding_bars} bars, round trip {tape.round_trip_cost_points:.3f} points)")
        self.backend = self._new_backend(self._architecture(features.shape[1]))
        summary = dict(self.backend.fit(context) or {})
        self.fit_summary = {key: value for key, value in summary.items() if not key.endswith("_seconds")}
        self.best_iteration = summary.get("best_epoch")

    # ── prediction ──
    def _predict_probability(self, features, index) -> np.ndarray:
        with thread_cap():
            if self.variant == "modality_policy":
                view = self.require_market()
                probabilities, _ = self.backend.outputs(features, view.timestamps, index)
                return long_share(probabilities)
            return self.backend.probability(features, index)

    def _predict_value(self, features, index) -> np.ndarray:
        view = self.require_market()
        with thread_cap():
            _, price = self.backend.outputs(features, view.timestamps, index)
        return price

    # ── persistence ──
    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "torch", "stable-baselines3", "sb3-contrib", "gymnasium")

    def _save_state(self, folder: Path) -> str:
        state = self.backend.state()
        persistence.save_json(folder / STATE_FILE, {"variant": self.variant, "architecture": state["architecture"],
                                                    "extra": state.get("extra") or {}})
        if "arrays" in state:
            persistence.save_arrays(folder / ARRAYS_FILE, **state["arrays"])
            return ARRAYS_FILE
        persistence.save_torch(folder / WEIGHTS_FILE, state["weights"])
        return WEIGHTS_FILE

    def _load_state(self, folder: Path, metadata: dict) -> None:
        document = persistence.load_json(folder / STATE_FILE)
        state = {"architecture": document["architecture"], "extra": document.get("extra") or {}}
        if self.variant == "cem":
            state["arrays"] = persistence.load_arrays(folder / ARRAYS_FILE)
            self.backend = CrossEntropyMethod.from_state(self.parameters, self.seed, state)
        else:
            state["weights"] = persistence.load_torch(folder / WEIGHTS_FILE)
            if self.variant in SB3_VARIANTS:
                self.backend = StableBaselinesAgent.from_state(self.parameters, self.seed, state, self.variant)
            else:
                self.backend = TRAINERS[self.variant].from_state(self.parameters, self.seed, state)
        self.model_file = metadata.get("model_file", WEIGHTS_FILE)


__all__ = ["PRICE_VARIANTS", "PolicyAgentAdapter", "VARIANTS"]
