"""The fourteen world-model agents: one class per registry variant.

Every agent is an ``nn.Module`` whose ``state_dict`` is the whole fitted model
(weights, the linear controller, cluster centroids, the value table, the
validation temperature, the cost and bar-interval constants), so saving,
snapshotting the best epoch and reloading are one call each. Fit-only objects
(optimizers, the CMA-ES search, the PPO learner) are plain attributes that are
never saved.

An agent trains through ``train_epoch`` (minibatches of the training rows,
``batch_loss`` per minibatch) and predicts through:

    probability(inputs)   P(up) for the direction model (``probability_source``
                          "predict_proba": the policy's long share; or
                          "logistic_curve_on_validation": sigmoid of a value gap
                          times the inverse temperature fitted on validation)
    price_value(inputs)   the scaled h-bar move for the price model

``inputs`` holds the window (B, L, F) and, for the agents that need them, the
elapsed bar intervals (B, L) and the per-row noise. The adapter builds them
from rows <= t only and runs these methods on a float64 copy, so one bar alone
equals the batch.

Direction model = world model + controller; price model = world model + the
return head trained on the price target over the training span (no controller).
"""

from __future__ import annotations

import math

import numpy as np
import torch
from torch import nn
from torch.nn import functional

from .controllers import (
    ActorCriticHead,
    CovarianceMatrixSearch,
    LinearController,
    PolicyNetwork,
    RolloutEncoder,
    abstract_value_iteration,
    action_rewards,
    actor_critic_loss,
    controller_fitness,
    imagination_actor_critic,
    long_share,
)
from .data import FitData, minibatches, row_noise
from .dynamics import (
    ACTION_POSITIONS,
    DifferentialEquationRecurrent,
    DynamicsTransformer,
    GaussianTransition,
    MixtureDensityRecurrent,
    WindowEnvironmentModel,
)
from .representation import (
    ContrastivePredictiveCoder,
    HierarchicalVariationalModel,
    RecurrentStateSpaceModel,
    RowVariationalAutoencoder,
    VariationalRecurrentModel,
    WindowEncoder,
    masked_mean,
    perceptron,
)

GRADIENT_CLIP = 10.0
CHECKPOINT_EVERY_BATCHES = 20
POSITIONS = torch.tensor(ACTION_POSITIONS)


def to_tensors(arrays: dict, dtype=torch.float32) -> dict:
    """numpy batch -> tensors (floats as ``dtype``, masks as bool); ``rows`` stays numpy."""
    out = {}
    for key, value in arrays.items():
        if key == "rows":
            out[key] = value
        elif value.dtype == bool:
            out[key] = torch.from_numpy(np.ascontiguousarray(value))
        else:
            out[key] = torch.from_numpy(np.ascontiguousarray(value)).to(dtype)
    return out


def huber(prediction: torch.Tensor, target: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    return masked_mean(functional.huber_loss(prediction, target, reduction="none", delta=1.0), mask)


class Agent(nn.Module):
    """What every variant shares (see the module docstring)."""

    variant = ""
    probability_source = "predict_proba"
    uses_elapsed = False
    uses_noise = False

    def __init__(self, feature_count: int, parameters: dict, task: str, seed: int) -> None:
        super().__init__()
        self.construction = {"feature_count": int(feature_count), "parameters": dict(parameters), "task": task,
                             "seed": int(seed)}
        self.feature_count = int(feature_count)
        self.settings = dict(parameters)
        self.task = task
        self.seed = int(seed)
        self.length = int(parameters["sequence_length"])
        self.hidden_size = int(parameters.get("hidden_size", 64))
        self.register_buffer("inverse_temperature", torch.ones((), dtype=torch.float64))
        self.register_buffer("mean_cost", torch.zeros((), dtype=torch.float64))
        self.register_buffer("bar_seconds", torch.ones((), dtype=torch.float64))
        self.register_buffer("horizon_bars", torch.ones((), dtype=torch.float64))
        self.representation_history: list[float] = []
        self.optimizer = None

    @property
    def classification(self) -> bool:
        return self.task == "classification"

    @property
    def reward_key(self) -> str:
        """The per-row reward a world model learns: the tape move (direction) or the price target."""
        return "move" if self.classification else "target"

    # ── fitting ──
    def configure(self, data: FitData) -> None:
        """Constants from the fit and the optimizer (called once before the first epoch)."""
        self.mean_cost.fill_(float(data.mean_cost))
        self.bar_seconds.fill_(float(data.bar_seconds))
        self.horizon_bars.fill_(float(data.horizon))
        self.optimizer = torch.optim.Adam(self.parameters(), lr=float(self.settings["learning_rate"]))

    def epoch_count(self) -> int:
        return int(self.settings["epochs"])

    def validation_ready(self, epoch: int) -> bool:
        return True

    def batch_loss(self, batch: dict, generator: torch.Generator, epoch: int) -> tuple[torch.Tensor, float]:
        raise NotImplementedError

    def step(self, loss: torch.Tensor, optimizer=None, parameters=None) -> None:
        optimizer = optimizer or self.optimizer
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(list(parameters) if parameters is not None else list(self.parameters()),
                                       GRADIENT_CLIP)
        optimizer.step()

    def batch_inputs(self, data: FitData, rows: np.ndarray) -> dict:
        arrays = data.batch(rows)
        if self.uses_noise:
            arrays["noise"] = self.noise(rows).astype(np.float32)
        return to_tensors(arrays)

    def train_epoch(self, epoch: int, data: FitData, report_batch, generator: torch.Generator, reporter) -> float:
        self.train()
        batches = minibatches(data.train_rows, int(self.settings["batch_size"]), self.seed, epoch)
        losses, representation = [], []
        for number, rows in enumerate(batches, 1):
            if number > 1 and number % CHECKPOINT_EVERY_BATCHES == 0:
                reporter.checkpoint()
            loss, part = self.batch_loss(self.batch_inputs(data, rows), generator, epoch)
            self.step(loss)
            losses.append(float(loss.detach()))
            representation.append(part)
            report_batch(number, len(batches), int(rows[0]), int(rows[-1]), losses[-1])
        self.representation_history.append(float(np.mean(representation)))
        self.end_epoch(epoch, data)
        return float(np.mean(losses))

    def end_epoch(self, epoch: int, data: FitData) -> None:
        """After an epoch's minibatches, before validation (clustering, planning tables)."""

    # ── prediction ──
    def noise(self, rows: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    def direction_score(self, inputs: dict) -> torch.Tensor:
        raise NotImplementedError

    def probability(self, inputs: dict) -> torch.Tensor:
        score = self.direction_score(inputs)
        if self.probability_source == "logistic_curve_on_validation":
            return torch.sigmoid(self.inverse_temperature.to(score.dtype) * score)
        return score

    def price_value(self, inputs: dict) -> torch.Tensor:
        raise NotImplementedError

    def summary(self) -> dict:
        history = [round(value, 10) for value in self.representation_history]
        return {"representation_loss_by_epoch": history}


# ─── state + head: a representation and an actor-critic (or return) head ────


class StateHeadAgent(Agent):
    """A representation trained by its own loss, then the all-action actor-critic on the
    frozen (detached) state for the direction model, or a return head on the state
    (trained jointly) for the price model."""

    state_size = 0

    def build_heads(self, state_size: int) -> None:
        self.state_size = int(state_size)
        if self.classification:
            self.controller = ActorCriticHead(state_size, self.hidden_size)
        else:
            self.price_head = perceptron(state_size, self.hidden_size, 1, 1)

    def representation_loss(self, batch: dict, generator, epoch: int) -> tuple[torch.Tensor, torch.Tensor]:
        """(the representation's own loss, the training-pass state at the window's last bar)."""
        raise NotImplementedError

    def state(self, inputs: dict) -> torch.Tensor:
        raise NotImplementedError

    def head_loss(self, state: torch.Tensor, batch: dict) -> torch.Tensor:
        if self.classification:
            return actor_critic_loss(self.controller, state.detach(), batch["move"], batch["cost"], batch["move_mask"],
                                     float(self.settings["entropy_coefficient"]))
        return huber(self.price_head(state).squeeze(-1), batch["target"], batch["target_mask"])

    def batch_loss(self, batch, generator, epoch):
        representation, state = self.representation_loss(batch, generator, epoch)
        return representation + self.head_loss(state, batch), float(representation.detach())

    def direction_score(self, inputs):
        return long_share(self.controller(self.state(inputs))[0])

    def price_value(self, inputs):
        return self.price_head(self.state(inputs)).squeeze(-1)


def warmup_weight(settings: dict, epoch: int) -> float:
    """The KL weight, ramped linearly over ``kullback_leibler_warmup_epochs``."""
    weight = float(settings["kullback_leibler_weight"])
    warmup = int(settings.get("kullback_leibler_warmup_epochs", 0))
    return weight if warmup <= 0 else weight * min(1.0, epoch / float(warmup))


class RecurrentStateSpaceAgent(StateHeadAgent):
    """Latent Dynamics Model (RSSM): the RSSM world model, then an actor-critic on (h, z)."""

    variant = "recurrent_state_space_model"

    def __init__(self, feature_count, parameters, task, seed):
        super().__init__(feature_count, parameters, task, seed)
        self.world = RecurrentStateSpaceModel(feature_count, self.hidden_size, self.hidden_size,
                                              int(parameters["latent_dimension"]))
        self.build_heads(self.world.state_size)

    def representation_loss(self, batch, generator, epoch):
        loss, _, observed = self.world.loss(batch, generator, float(self.settings["free_bits"]),
                                            float(self.settings["kullback_leibler_weight"]), self.reward_key + "_series")
        return loss, torch.cat([observed["h"][:, -1], observed["z"][:, -1]], -1)

    def state(self, inputs):
        return self.world.state(inputs["window"])


class VariationalWorldModelAgent(StateHeadAgent):
    """Variational World Model: a VRNN (the recurrence reads the observation) with KL warmup,
    then an actor-critic on the context h."""

    variant = "variational_world_model"

    def __init__(self, feature_count, parameters, task, seed):
        super().__init__(feature_count, parameters, task, seed)
        self.world = VariationalRecurrentModel(feature_count, self.hidden_size, self.hidden_size,
                                               int(parameters["latent_dimension"]))
        self.build_heads(self.world.state_size)

    def representation_loss(self, batch, generator, epoch):
        loss, _, out = self.world.loss(batch, generator, warmup_weight(self.settings, epoch), self.reward_key + "_series")
        return loss, out["h"][:, -1]

    def state(self, inputs):
        return self.world.state(inputs["window"])


class DeepMarkovDecisionAgent(StateHeadAgent):
    """DeepMDP: an encoder trained only by the latent transition and latent reward losses,
    with a Lipschitz gradient penalty on both models; no decoder."""

    variant = "deep_markov_decision_process"

    def __init__(self, feature_count, parameters, task, seed):
        super().__init__(feature_count, parameters, task, seed)
        latent = int(parameters["latent_dimension"])
        self.encoder = WindowEncoder(feature_count, self.length, self.hidden_size, latent)
        self.transition = GaussianTransition(latent, self.hidden_size)
        self.reward_model = perceptron(latent, self.hidden_size, 1, 1)
        self.build_heads(latent)

    def encode(self, window: torch.Tensor) -> torch.Tensor:
        """The latent, bounded by tanh: the transition target is the encoder's own (stop-gradient)
        next latent, and an unbounded encoder lets that target's scale drift away from the model."""
        return torch.tanh(self.encoder(window))

    def representation_loss(self, batch, generator, epoch):
        latent = self.encode(batch["window"])
        with torch.no_grad():
            following = self.encode(batch["next_window"])
        mean, std = self.transition(latent)
        transition = masked_mean((0.5 * ((following - mean) / std) ** 2 + torch.log(std)).sum(-1), batch["next_mask"])
        key = self.reward_key
        reward = masked_mean((self.reward_model(latent).squeeze(-1) - batch[key]) ** 2, batch[key + "_mask"])
        # Lipschitz penalty (one-sided gradient penalty) on points between pairs of latents
        mixing = torch.rand(latent.shape[0], 1, generator=generator, dtype=latent.dtype)
        between = (mixing * latent.detach() + (1 - mixing) * latent.detach().roll(1, 0)).requires_grad_(True)
        outputs = self.reward_model(between).sum() + self.transition(between)[0].sum()
        gradient = torch.autograd.grad(outputs, between, create_graph=True)[0]
        penalty = (functional.relu(gradient.norm(dim=-1) - 1.0) ** 2).mean()
        loss = transition + reward + float(self.settings["gradient_penalty_weight"]) * penalty
        return loss, latent

    def state(self, inputs):
        return self.encode(inputs["window"])


class PredictiveCodingAgent(StateHeadAgent):
    """Temporal Predictive Coding Agent: CPC (InfoNCE over the steps ahead inside the window),
    then an actor-critic on the context."""

    variant = "temporal_predictive_coding_agent"

    def __init__(self, feature_count, parameters, task, seed):
        super().__init__(feature_count, parameters, task, seed)
        steps = max(1, min(int(parameters["prediction_step_count"]), self.length - 1))
        self.world = ContrastivePredictiveCoder(feature_count, self.hidden_size, int(parameters["latent_dimension"]), steps)
        self.build_heads(self.world.state_size)

    def representation_loss(self, batch, generator, epoch):
        loss, _, state = self.world.loss(batch["window"], float(self.settings["temperature"]))
        return loss, state

    def state(self, inputs):
        return self.world.state(inputs["window"])


class HierarchicalLatentAgent(StateHeadAgent):
    """Hierarchical Latent Variable Model: a two-level VAE (slow top latent over the window,
    fast bottom latent over its last bars), then an actor-critic on both means."""

    variant = "hierarchical_latent_variable_model"

    def __init__(self, feature_count, parameters, task, seed):
        super().__init__(feature_count, parameters, task, seed)
        bottom_length = max(1, min(int(parameters["bottom_sequence_length"]), self.length))
        self.world = HierarchicalVariationalModel(feature_count, self.hidden_size, int(parameters["top_latent_dimension"]),
                                                  int(parameters["latent_dimension"]), bottom_length)
        self.build_heads(self.world.state_size)

    def representation_loss(self, batch, generator, epoch):
        loss, _, state = self.world.loss(batch, generator, warmup_weight(self.settings, epoch), self.reward_key)
        return loss, state

    def state(self, inputs):
        return self.world.state(inputs["window"])


class DifferentialEquationAgent(StateHeadAgent):
    """Neural ODE-based Dynamics Learner: an ODE-RNN over the real elapsed time between bars;
    the price model integrates the latent to the label horizon and decodes the return."""

    variant = "neural_ode_dynamics_learner"
    uses_elapsed = True

    def __init__(self, feature_count, parameters, task, seed):
        super().__init__(feature_count, parameters, task, seed)
        self.world = DifferentialEquationRecurrent(feature_count, self.hidden_size, int(parameters["latent_dimension"]),
                                                   str(parameters["differential_equation_solver"]))
        if self.classification:
            self.controller = ActorCriticHead(self.world.state_size, self.hidden_size)

    def representation_loss(self, batch, generator, epoch):
        loss, _, latent = self.world.loss(batch, self.reward_key)
        return loss, latent

    def head_loss(self, state, batch):
        if self.classification:
            return super().head_loss(state, batch)
        return huber(self.world.forecast(state, int(self.horizon_bars)), batch["target"], batch["target_mask"])

    def state(self, inputs):
        return self.world.state(inputs["window"], inputs["elapsed_series"])

    def price_value(self, inputs):
        return self.world.forecast(self.state(inputs), int(self.horizon_bars))


# ─── World Models (Ha and Schmidhuber): V, M, then C by CMA-ES ──────────────


class WorldModelsAgent(Agent):
    """V (a VAE per feature row) and M (an MDN-LSTM over the V latents) for ``epochs``
    epochs, then C (a linear controller on [z; h]) searched by CMA-ES for
    ``iteration_count`` generations against the training tape's net reward."""

    variant = "world_models"

    def __init__(self, feature_count, parameters, task, seed):
        super().__init__(feature_count, parameters, task, seed)
        latent = int(parameters["latent_dimension"])
        self.vision = RowVariationalAutoencoder(feature_count, self.hidden_size, latent)
        self.memory = MixtureDensityRecurrent(latent, self.hidden_size, int(parameters["component_count"]))
        state_size = latent + self.hidden_size
        if self.classification:
            self.controller = LinearController(state_size)
        else:
            self.price_head = perceptron(state_size, self.hidden_size, 1, 1)
        self.search = None
        self.search_states = None

    def epoch_count(self):
        return int(self.settings["epochs"]) + (int(self.settings["iteration_count"]) if self.classification else 0)

    def validation_ready(self, epoch):
        return not self.classification or epoch > int(self.settings["epochs"])

    def latents(self, window: torch.Tensor) -> torch.Tensor:
        return self.vision.encode(window)[0]

    def state(self, inputs):
        latent = self.latents(inputs["window"])
        hidden = self.memory.run(latent)
        return torch.cat([latent[:, -1], hidden[:, -1]], -1)

    def batch_loss(self, batch, generator, epoch):
        window = batch["window"]
        vision, _ = self.vision.loss(window.flatten(0, 1), generator, float(self.settings["kullback_leibler_weight"]))
        latent = self.latents(window).detach()
        hidden = self.memory.run(latent)
        following = torch.cat([latent[:, 1:], self.latents(batch["next_series"][:, -1:]).detach()], 1)
        known = torch.cat([torch.ones_like(batch["next_mask"]).unsqueeze(1).expand(-1, latent.shape[1] - 1),
                           batch["next_mask"].unsqueeze(1)], 1)
        memory = masked_mean(self.memory.negative_log_likelihood(hidden, following), known)
        key = self.reward_key + "_series"
        reward = masked_mean((self.memory.reward(hidden).squeeze(-1) - batch[key]) ** 2, batch[key + "_mask"])
        loss = vision + memory + reward
        if not self.classification:
            state = torch.cat([latent[:, -1], hidden[:, -1]], -1)
            loss = loss + huber(self.price_head(state).squeeze(-1), batch["target"], batch["target_mask"])
        return loss, float((vision + memory + reward).detach())

    def train_epoch(self, epoch, data, report_batch, generator, reporter):
        if epoch <= int(self.settings["epochs"]):
            return super().train_epoch(epoch, data, report_batch, generator, reporter)
        if self.search is None:
            rows = data.train_rows[np.isfinite(data.move[data.train_rows])]
            self.eval()
            with torch.no_grad():
                states = [self.state(self.batch_inputs(data, chunk)) for chunk in np.array_split(rows, max(1, rows.size // 2048))]
            self.search_states = (torch.cat(states).double().numpy(), data.move[rows], data.cost[rows])
            self.search = CovarianceMatrixSearch(self.controller.parameter_count, int(self.settings["population_size"]),
                                                 self.seed)
        states, move, cost = self.search_states
        coefficient = float(self.settings["entropy_coefficient"])
        best = self.search.generation(lambda vectors: controller_fitness(vectors, states, move, cost, coefficient))
        self.controller.set_vector(self.search.best_vector)
        report_batch(1, 1, int(data.train_rows[0]), int(data.train_rows[-1]), -best)
        return -self.search.best_fitness

    def direction_score(self, inputs):
        return long_share(self.controller(self.state(inputs)))

    def price_value(self, inputs):
        return self.price_head(self.state(inputs)).squeeze(-1)


# ─── Dreamer and the latent imagination policy ─────────────────────────────


class DreamerAgent(Agent):
    """Dreamer: the RSSM world model and, on every minibatch, the actor and critic trained
    on imagined rollouts from the batch's posterior states (V1 "dynamics" or V2/V3
    "reinforce" actor gradient, optional return normalisation)."""

    variant = "dreamer"
    joint = True

    def __init__(self, feature_count, parameters, task, seed):
        super().__init__(feature_count, parameters, task, seed)
        self.world = RecurrentStateSpaceModel(feature_count, self.hidden_size, self.hidden_size,
                                              int(parameters["latent_dimension"]))
        if self.classification:
            self.controller = ActorCriticHead(self.world.state_size, self.hidden_size)
        else:
            self.price_head = perceptron(self.world.state_size, self.hidden_size, 1, 1)

    def configure(self, data):
        super().configure(data)
        rate = float(self.settings["learning_rate"])
        world = list(self.world.parameters()) + (list(self.price_head.parameters()) if not self.classification else [])
        self.world_optimizer = torch.optim.Adam(world, lr=rate)
        if self.classification:
            self.behaviour_optimizer = torch.optim.Adam(self.controller.parameters(), lr=rate)

    def world_loss(self, batch, generator):
        loss, _, observed = self.world.loss(batch, generator, float(self.settings["free_bits"]),
                                            float(self.settings["kullback_leibler_weight"]), self.reward_key + "_series")
        if not self.classification:
            state = torch.cat([observed["h"][:, -1], observed["z"][:, -1]], -1)
            loss = loss + huber(self.price_head(state).squeeze(-1), batch["target"], batch["target_mask"])
        return loss, observed

    def behaviour_loss(self, batch, observed, generator, actor_gradient: str, return_normalization: bool):
        starts_h = observed["h"].detach().flatten(0, 1)
        starts_z = observed["z"].detach().flatten(0, 1)
        cost = batch["cost"].unsqueeze(1).expand(-1, observed["h"].shape[1]).flatten()
        actor, critic, _ = imagination_actor_critic(
            self.world, self.controller, starts_h, starts_z, cost, horizon=int(self.settings["planning_horizon"]),
            discount_factor=float(self.settings["discount_factor"]), trace_decay=float(self.settings["trace_decay"]),
            entropy_coefficient=float(self.settings["entropy_coefficient"]), actor_gradient=actor_gradient,
            return_normalization=return_normalization, generator=generator)
        return actor + 0.5 * critic

    def train_epoch(self, epoch, data, report_batch, generator, reporter):
        self.train()
        batches = minibatches(data.train_rows, int(self.settings["batch_size"]), self.seed, epoch)
        losses, representation = [], []
        for number, rows in enumerate(batches, 1):
            if number > 1 and number % CHECKPOINT_EVERY_BATCHES == 0:
                reporter.checkpoint()
            batch = self.batch_inputs(data, rows)
            world, observed = self.world_loss(batch, generator)
            self.step(world, self.world_optimizer, self.world_optimizer.param_groups[0]["params"])
            total = float(world.detach())
            if self.classification:
                behaviour = self.behaviour_loss(batch, observed, generator, str(self.settings["actor_gradient"]),
                                                bool(self.settings["return_normalization"]))
                self.step(behaviour, self.behaviour_optimizer, self.controller.parameters())
                total += float(behaviour.detach())
            losses.append(total)
            representation.append(float(world.detach()))
            report_batch(number, len(batches), int(rows[0]), int(rows[-1]), total)
        self.representation_history.append(float(np.mean(representation)))
        return float(np.mean(losses))

    def state(self, inputs):
        return self.world.state(inputs["window"])

    def direction_score(self, inputs):
        return long_share(self.controller(self.state(inputs))[0])

    def price_value(self, inputs):
        return self.price_head(self.state(inputs)).squeeze(-1)


class LatentImaginationAgent(DreamerAgent):
    """Latent Imagination Policy Network: the RSSM is fitted first (``epochs``) and frozen;
    then (``imagination_epochs``) the actor and critic learn only from imagined rollouts,
    the actor through the rollout's differentiable reward, with the entropy bonus."""

    variant = "latent_imagination_policy"

    def epoch_count(self):
        return int(self.settings["epochs"]) + (int(self.settings["imagination_epochs"]) if self.classification else 0)

    def validation_ready(self, epoch):
        return not self.classification or epoch > int(self.settings["epochs"])

    def train_epoch(self, epoch, data, report_batch, generator, reporter):
        self.train()
        model_stage = epoch <= int(self.settings["epochs"])
        batches = minibatches(data.train_rows, int(self.settings["batch_size"]), self.seed, epoch)
        losses, representation = [], []
        for number, rows in enumerate(batches, 1):
            if number > 1 and number % CHECKPOINT_EVERY_BATCHES == 0:
                reporter.checkpoint()
            batch = self.batch_inputs(data, rows)
            if model_stage:
                world, _ = self.world_loss(batch, generator)
                self.step(world, self.world_optimizer, self.world_optimizer.param_groups[0]["params"])
                total = float(world.detach())
                representation.append(total)
            else:
                with torch.no_grad():
                    observed = self.world.observe(batch["window"], generator)
                behaviour = self.behaviour_loss(batch, observed, generator, "dynamics", False)
                self.step(behaviour, self.behaviour_optimizer, self.controller.parameters())
                total = float(behaviour.detach())
            losses.append(total)
            report_batch(number, len(batches), int(rows[0]), int(rows[-1]), total)
        if representation:
            self.representation_history.append(float(np.mean(representation)))
        return float(np.mean(losses))


# ─── State-Space Abstraction: bisimulation encoder, clusters, value iteration ─


class StateAbstractionAgent(Agent):
    """An encoder trained so latent L1 distance matches the bisimulation distance
    |r_i - r_j| + discount * W2(P(.|z_i), P(.|z_j)); k-means over the training latents
    gives the abstract states; value iteration on the abstract MDP gives Q(k, a)."""

    variant = "state_space_abstraction"
    probability_source = "logistic_curve_on_validation"

    def __init__(self, feature_count, parameters, task, seed):
        super().__init__(feature_count, parameters, task, seed)
        latent = int(parameters["latent_dimension"])
        clusters = int(parameters["cluster_count"])
        self.encoder = WindowEncoder(feature_count, self.length, self.hidden_size, latent)
        self.transition = GaussianTransition(latent, self.hidden_size)
        self.reward_model = perceptron(latent, self.hidden_size, 1, 1)
        self.register_buffer("centroids", torch.zeros(clusters, latent))
        self.register_buffer("q_table", torch.zeros(clusters, 3, dtype=torch.float64))
        self.register_buffer("cluster_value", torch.zeros(clusters, dtype=torch.float64))

    def batch_loss(self, batch, generator, epoch):
        latent = self.encoder(batch["window"])
        with torch.no_grad():
            following = self.encoder(batch["next_window"])
        mean, std = self.transition(latent.detach())
        transition = masked_mean((0.5 * ((following - mean) / std) ** 2 + torch.log(std)).sum(-1), batch["next_mask"])
        key = self.reward_key
        reward, known = batch[key], batch[key + "_mask"]
        reward_loss = masked_mean((self.reward_model(latent).squeeze(-1) - reward) ** 2, known)
        order = torch.randperm(latent.shape[0], generator=generator)
        with torch.no_grad():
            wasserstein = torch.sqrt(((mean - mean[order]) ** 2).sum(-1) + ((std - std[order]) ** 2).sum(-1))
            target = (reward - reward[order]).abs() + float(self.settings["discount_factor"]) * wasserstein
        distance = (latent - latent[order]).abs().sum(-1)
        bisimulation = masked_mean((distance - target) ** 2, known & known[order])
        loss = bisimulation + transition + reward_loss
        return loss, float(loss.detach())

    def encode_rows(self, data: FitData, rows: np.ndarray) -> np.ndarray:
        self.eval()
        with torch.no_grad():
            chunks = [self.encoder(self.batch_inputs(data, chunk)["window"]) for chunk in
                      np.array_split(rows, max(1, rows.size // 4096))]
        self.train()
        return torch.cat(chunks).double().numpy()

    def end_epoch(self, epoch, data):
        from sklearn.cluster import KMeans
        from threadpoolctl import threadpool_limits

        rows = data.train_rows
        latents = self.encode_rows(data, rows)
        count = int(self.settings["cluster_count"])
        # one thread: the clustering is small, and OpenMP threads competing with the rest of the
        # process (or the machine) make it orders of magnitude slower, not faster
        with threadpool_limits(limits=1):
            clustering = KMeans(n_clusters=min(count, rows.size), n_init=3,
                                random_state=self.seed % (2 ** 31)).fit(latents)
        centroids = np.zeros((count, latents.shape[1]))
        centroids[: clustering.cluster_centers_.shape[0]] = clustering.cluster_centers_
        if clustering.cluster_centers_.shape[0] < count:           # unused slots never win the nearest-centroid test
            centroids[clustering.cluster_centers_.shape[0]:] = 1e6
        assigned = clustering.labels_.astype(np.int64)
        position = {int(row): index for index, row in enumerate(rows)}
        successors = np.full(rows.size, -1, dtype=np.int64)
        for index, row in enumerate(rows):
            following = position.get(int(row) + 1)
            if following is not None and data.continuation[row] > 0.5:
                successors[index] = assigned[following]
        if self.classification:
            known = np.isfinite(data.move[rows])
            rewards = np.stack([-data.move[rows] - data.cost[rows], np.zeros(rows.size),
                                data.move[rows] - data.cost[rows]], -1)
            q_table = abstract_value_iteration(assigned[known], rewards[known], successors[known], count,
                                               float(self.settings["discount_factor"]))
            self.q_table.copy_(torch.from_numpy(q_table))
        else:
            known = np.isfinite(data.target[rows])
            values = np.zeros(count)
            for cluster in range(count):
                members = known & (assigned == cluster)
                if members.any():
                    values[cluster] = float(np.mean(data.target[rows][members]))
            self.cluster_value.copy_(torch.from_numpy(values))
        self.centroids.copy_(torch.from_numpy(centroids).to(self.centroids.dtype))

    def cluster(self, inputs) -> torch.Tensor:
        latent = self.encoder(inputs["window"]).to(torch.float64)
        return torch.cdist(latent, self.centroids.to(torch.float64)).argmin(-1)

    def direction_score(self, inputs):
        q_values = self.q_table[self.cluster(inputs)]
        return q_values[:, 2] - q_values[:, 0]

    def price_value(self, inputs):
        return self.cluster_value[self.cluster(inputs)]


# ─── the environment-model agents: hybrid, I2A, SimPLe ─────────────────────


class HybridAgent(Agent):
    """Hybrid Model-Free & Model-Based Agent: a model-free actor-critic trained on real tape
    rewards mixed with k-step model rollouts (Dyna), their weight shrunk when the model's
    error on the held-out tail of the training span passes ``model_error_threshold``;
    at prediction a one-step model lookahead is added to the policy's logits."""

    variant = "hybrid_model_free_model_based_agent"
    TAIL_SHARE = 0.2

    def __init__(self, feature_count, parameters, task, seed):
        super().__init__(feature_count, parameters, task, seed)
        self.environment = WindowEnvironmentModel(feature_count, self.length, self.hidden_size)
        if self.classification:
            self.encoder = WindowEncoder(feature_count, self.length, self.hidden_size, self.hidden_size)
            self.controller = ActorCriticHead(self.hidden_size, self.hidden_size)
        self.register_buffer("model_confidence", torch.ones((), dtype=torch.float64))
        self.model_rows_end = None

    def configure(self, data):
        super().configure(data)
        rows = data.train_rows
        self.model_rows_end = int(rows[max(0, int(math.floor(rows.size * (1 - self.TAIL_SHARE))) - 1)])

    def batch_loss(self, batch, generator, epoch):
        in_model_block = torch.from_numpy(batch["rows"] <= self.model_rows_end)
        if not self.classification:
            model_loss, _ = self.environment.loss(batch, "target")
            return model_loss, float(model_loss.detach())
        mean, std, reward = self.environment(batch["window"])
        following = batch["next_series"][:, -1]
        transition = masked_mean((0.5 * ((following - mean) / std) ** 2 + torch.log(std)).sum(-1),
                                 batch["next_mask"] & in_model_block)
        reward_loss = masked_mean((reward - batch["move"]) ** 2, batch["move_mask"] & in_model_block)
        model_loss = transition + reward_loss
        coefficient = float(self.settings["entropy_coefficient"])
        real = actor_critic_loss(self.controller, self.encoder(batch["window"]), batch["move"], batch["cost"],
                                 batch["move_mask"], coefficient)
        ratio = float(self.settings["model_data_ratio"]) * float(self.model_confidence)
        imagined_loss = real * 0.0
        if ratio > 0:
            with torch.no_grad():
                window = batch["window"]
                imagined_windows, imagined_moves = [], []
                for _ in range(int(self.settings["planning_horizon"])):
                    window, _, _ = self.environment.step(window)
                    imagined_windows.append(window)
                    imagined_moves.append(self.environment(window)[2])
                windows = torch.cat(imagined_windows)
                moves = torch.cat(imagined_moves)
            cost = batch["cost"].repeat(len(imagined_windows))
            imagined_loss = actor_critic_loss(self.controller, self.encoder(windows), moves, cost,
                                              torch.ones_like(moves, dtype=torch.bool), coefficient)
        return model_loss + (real + ratio * imagined_loss) / (1.0 + ratio), float(model_loss.detach())

    def end_epoch(self, epoch, data):
        """The model's reward error on the held-out training tail sets its confidence."""
        if not self.classification:
            return
        rows = data.train_rows[data.train_rows > self.model_rows_end]
        rows = rows[np.isfinite(data.move[rows])]
        if rows.size < 2:
            return
        self.eval()
        with torch.no_grad():
            predicted = self.environment(self.batch_inputs(data, rows)["window"])[2].double().numpy()
        self.train()
        actual = data.move[rows]
        error = float(np.mean((predicted - actual) ** 2) / max(np.var(actual), 1e-12))
        threshold = float(self.settings["model_error_threshold"])
        self.model_confidence.fill_(1.0 if error <= threshold else threshold / error)

    def direction_score(self, inputs):
        window = inputs["window"]
        logits, _ = self.controller(self.encoder(window))
        move = self.environment(window)[2]
        lookahead = action_rewards(move, self.mean_cost.to(move.dtype).expand_as(move))
        weight = float(self.settings["lookahead_weight"]) * self.model_confidence.to(move.dtype)
        return long_share(logits + weight * lookahead)

    def price_value(self, inputs):
        return self.environment(inputs["window"])[2]


class ImaginationAugmentedAgent(Agent):
    """I2A: an environment model, a rollout policy distilled from the agent, one imagined
    trajectory per first action (short, flat, long) encoded backwards by an LSTM, and a
    model-free path; the actor-critic reads both. Imagination is regenerated at every
    call from the window, its model noise drawn per bar from (seed, bar)."""

    variant = "imagination_augmented_agent"
    uses_noise = True

    def __init__(self, feature_count, parameters, task, seed):
        super().__init__(feature_count, parameters, task, seed)
        self.environment = WindowEnvironmentModel(feature_count, self.length, self.hidden_size)
        if self.classification:
            self.rollout_policy = nn.Linear(feature_count, 3)
            self.rollout_encoder = RolloutEncoder(feature_count, self.hidden_size)
            self.model_free = WindowEncoder(feature_count, self.length, self.hidden_size, self.hidden_size)
            self.controller = ActorCriticHead(4 * self.hidden_size, self.hidden_size)

    def noise(self, rows):
        return row_noise(self.seed, rows, (3, int(self.settings["planning_horizon"]), self.feature_count))

    def imagine(self, window: torch.Tensor, noise: torch.Tensor) -> torch.Tensor:
        """(B, 3H): the encodings of the three imagined trajectories (frozen model and policy)."""
        batch = window.shape[0]
        steps = int(self.settings["planning_horizon"])
        positions = POSITIONS.to(window.dtype)
        with torch.no_grad():
            current = window.repeat(3, 1, 1)
            first = torch.arange(3).repeat_interleave(batch)
            cost = self.mean_cost.to(window.dtype)
            rows, rewards = [], []
            action = first
            for step in range(steps):
                if step > 0:
                    action = self.rollout_policy(current[:, -1]).argmax(-1)
                move = self.environment(current)[2]
                position = positions[action]
                rewards.append(position * move - position.abs() * cost)
                step_noise = noise[:, :, step].transpose(0, 1).reshape(3 * batch, -1)
                current, row, _ = self.environment.step(current, step_noise)
                rows.append(row)
            rows = torch.stack(rows, 1)
            rewards = torch.stack(rewards, 1)
        codes = self.rollout_encoder(rows, rewards)                      # (3B, H), trained by the actor-critic
        return codes.view(3, batch, -1).transpose(0, 1).reshape(batch, -1)

    def policy_state(self, inputs):
        return torch.cat([self.imagine(inputs["window"], inputs["noise"]), self.model_free(inputs["window"])], -1)

    def batch_loss(self, batch, generator, epoch):
        model_loss, _ = self.environment.loss(batch, self.reward_key)
        if not self.classification:
            return model_loss, float(model_loss.detach())
        state = self.policy_state(batch)
        coefficient = float(self.settings["entropy_coefficient"])
        agent = actor_critic_loss(self.controller, state, batch["move"], batch["cost"], batch["move_mask"], coefficient)
        with torch.no_grad():
            target = torch.softmax(self.controller(state)[0], -1)
        distillation = -(target * torch.log_softmax(self.rollout_policy(batch["window"][:, -1]), -1)).sum(-1).mean()
        return model_loss + agent + distillation, float(model_loss.detach())

    def direction_score(self, inputs):
        return long_share(self.controller(self.policy_state(inputs))[0])

    def price_value(self, inputs):
        return self.environment(inputs["window"])[2]


class SimulatedPolicyAgent(Agent):
    """SimPLe: each epoch is one cycle — fit the stochastic environment model (with scheduled
    sampling of its own predicted rows), then train a PPO policy (Stable-Baselines3) only
    inside simulated episodes started from real training windows; the PPO actor is copied
    out and is what predicts. Re-collecting real data is a replay of the same tape."""

    variant = "simulated_policy_learning"

    def __init__(self, feature_count, parameters, task, seed):
        super().__init__(feature_count, parameters, task, seed)
        self.environment = WindowEnvironmentModel(feature_count, self.length, self.hidden_size)
        if self.classification:
            self.policy = PolicyNetwork(feature_count * self.length, self.hidden_size)
        self.learner = None

    def epoch_count(self):
        return int(self.settings["simulation_cycle_count"])

    def configure(self, data):
        super().configure(data)
        self.optimizer = torch.optim.Adam(self.environment.parameters(), lr=float(self.settings["learning_rate"]))

    def model_loss(self, batch, generator, progress: float):
        key = self.reward_key
        loss, _ = self.environment.loss(batch, key)
        # scheduled sampling: the next window is built from the model's own sampled row with
        # probability ``progress`` (else the true row), and must still predict the next reward
        with torch.no_grad():
            mean, std, _ = self.environment(batch["window"])
            noise = torch.randn(mean.shape, generator=generator)
            own = mean + std * noise
            use_own = (torch.rand(mean.shape[0], 1, generator=generator) < progress).to(own.dtype)
            row = use_own * own + (1 - use_own) * batch["next_series"][:, -1]
            window = torch.cat([batch["window"][:, 1:], row.unsqueeze(1)], 1)
        second = masked_mean((self.environment(window)[2] - batch["next_reward"]) ** 2, batch["next_reward_mask"])
        return loss + second

    def train_epoch(self, epoch, data, report_batch, generator, reporter):
        self.train()
        passes = int(self.settings["epochs"])
        cycles = int(self.settings["simulation_cycle_count"])
        losses = []
        number = 0
        rows_by_pass = [minibatches(data.train_rows, int(self.settings["batch_size"]), self.seed, epoch * 1000 + index)
                        for index in range(passes)]
        total_batches = sum(len(batches) for batches in rows_by_pass) + (1 if self.classification else 0)
        for index, batches in enumerate(rows_by_pass):
            progress = ((epoch - 1) * passes + index) / max(1.0, cycles * passes - 1.0)
            for rows in batches:
                number += 1
                if number % CHECKPOINT_EVERY_BATCHES == 0:
                    reporter.checkpoint()
                loss = self.model_loss(self.batch_inputs(data, rows), generator, progress)
                self.step(loss, self.optimizer, self.environment.parameters())
                losses.append(float(loss.detach()))
                report_batch(number, total_batches, int(rows[0]), int(rows[-1]), losses[-1])
        self.representation_history.append(float(np.mean(losses)))
        if self.classification:
            reward = self.train_policy(data, epoch, reporter)
            report_batch(total_batches, total_batches, int(data.train_rows[0]), int(data.train_rows[-1]), -reward)
        return float(np.mean(losses))

    def train_policy(self, data: FitData, epoch: int, reporter) -> float:
        """PPO inside the simulator for ``simulated_step_count`` steps; returns the mean simulated reward."""
        from stable_baselines3 import PPO
        from stable_baselines3.common.callbacks import BaseCallback

        environment = SimulatedMarket(self, data, seed=self.seed + epoch)
        if self.learner is None:
            steps = int(self.settings["simulated_step_count"])
            rollout = int(min(256, max(32, steps // 4)))
            self.learner = PPO("MlpPolicy", environment, learning_rate=float(self.settings["learning_rate"]),
                               n_steps=rollout, batch_size=int(min(64, rollout)), n_epochs=4,
                               gamma=float(self.settings["discount_factor"]),
                               ent_coef=float(self.settings["entropy_coefficient"]), seed=self.seed, device="cpu",
                               verbose=0, policy_kwargs={"net_arch": {"pi": [self.hidden_size, self.hidden_size],
                                                                      "vf": [self.hidden_size, self.hidden_size]},
                                                         "activation_fn": nn.Tanh})
        else:
            self.learner.set_env(environment)

        class Checkpoints(BaseCallback):
            def _on_rollout_start(self) -> None:
                reporter.checkpoint()

            def _on_step(self) -> bool:
                return True

        self.learner.learn(total_timesteps=int(self.settings["simulated_step_count"]), reset_num_timesteps=False,
                           callback=Checkpoints())
        self.policy.copy_from(self.learner.policy)
        return float(environment.mean_reward())

    def direction_score(self, inputs):
        return long_share(self.policy(inputs["window"].flatten(1)))

    def price_value(self, inputs):
        return self.environment(inputs["window"])[2]


class SimulatedMarket:
    """The learned simulator as a gymnasium environment (built lazily so gymnasium is imported
    only for SimPLe). Episodes start at a real training window (seeded) and run
    ``planning_horizon`` imagined bars: reward a * m_hat(window) - |a| * cost, then the window
    rolls forward by a row sampled from the model."""

    def __new__(cls, agent: SimulatedPolicyAgent, data: FitData, seed: int):
        import gymnasium
        from gymnasium import spaces

        class Simulator(gymnasium.Env):
            metadata = {"render_modes": []}

            def __init__(self) -> None:
                super().__init__()
                rows = data.train_rows[data.finite_rows[data.train_rows]]
                self.rows = rows
                self.observation_space = spaces.Box(-np.inf, np.inf, shape=(agent.length * agent.feature_count,),
                                                    dtype=np.float32)
                self.action_space = spaces.Discrete(3)
                self.generator = np.random.default_rng((int(seed), 17))
                self.window = None
                self.step_count = 0
                self.rewards: list[float] = []

            def reset(self, *, seed=None, options=None):
                super().reset(seed=seed)
                row = int(self.rows[self.generator.integers(0, self.rows.size)])
                self.window = torch.from_numpy(data.windows(np.array([row])))
                self.cost = float(data.cost[row]) if np.isfinite(data.cost[row]) else float(data.mean_cost)
                self.step_count = 0
                return self.window.flatten(1)[0].numpy().copy(), {}

            def step(self, action):
                position = float(ACTION_POSITIONS[int(action)])
                noise = torch.from_numpy(self.generator.standard_normal((1, agent.feature_count)).astype(np.float32))
                with torch.no_grad():
                    move = float(agent.environment(self.window)[2][0])
                    self.window, _, _ = agent.environment.step(self.window, noise)
                reward = position * move - abs(position) * self.cost
                self.rewards.append(reward)
                self.step_count += 1
                terminated = self.step_count >= int(agent.settings["planning_horizon"])
                return self.window.flatten(1)[0].numpy().copy(), reward, terminated, False, {}

            def mean_reward(self) -> float:
                return float(np.mean(self.rewards)) if self.rewards else 0.0

        return Simulator()


# ─── Action-Conditioned Dynamics Transformer ───────────────────────────────


class DynamicsTransformerAgent(Agent):
    """A causal transformer over the window's bar tokens and a candidate-action token,
    trained by teacher forcing to predict each next row and the action's reward; the
    controller scores long and short through the model and P(up) is the validation-fitted
    temperature curve on the predicted reward gap."""

    variant = "action_conditioned_dynamics_transformer"
    probability_source = "logistic_curve_on_validation"

    def __init__(self, feature_count, parameters, task, seed):
        super().__init__(feature_count, parameters, task, seed)
        dimension, heads = int(parameters["model_dimension"]), int(parameters["head_count"])
        if dimension % heads:
            raise ValueError(f"model_dimension {dimension} must be a multiple of head_count {heads}")
        self.world = DynamicsTransformer(feature_count, self.length, dimension, heads, int(parameters["layer_count"]))

    def bar_tokens(self, window: torch.Tensor) -> torch.Tensor:
        """The bar-token outputs; under the causal mask they never see the action token."""
        flat = torch.ones(window.shape[0], dtype=torch.long, device=window.device)
        return self.world(window, flat)[0]

    def batch_loss(self, batch, generator, epoch):
        if self.classification:
            rewards, bars = self.world.action_rewards(batch["window"])
            target = action_rewards(batch["move"], batch["cost"])
            reward = masked_mean(((rewards - target) ** 2).sum(-1), batch["move_mask"])
        else:
            bars = self.bar_tokens(batch["window"])
            reward = huber(self.world.value(bars[:, -1]).squeeze(-1), batch["target"], batch["target_mask"])
        next_rows = self.world.next_row(bars)
        dynamics = masked_mean(((next_rows - batch["next_series"]) ** 2).sum(-1), batch["next_series_mask"])
        return dynamics + reward, float(dynamics.detach())

    def direction_score(self, inputs):
        rewards, _ = self.world.action_rewards(inputs["window"])
        return rewards[:, 2] - rewards[:, 0]

    def price_value(self, inputs):
        return self.world.value(self.bar_tokens(inputs["window"])[:, -1]).squeeze(-1)


AGENTS: dict[str, type[Agent]] = {cls.variant: cls for cls in (
    WorldModelsAgent, RecurrentStateSpaceAgent, VariationalWorldModelAgent, DeepMarkovDecisionAgent,
    PredictiveCodingAgent, StateAbstractionAgent, HierarchicalLatentAgent, DreamerAgent, LatentImaginationAgent,
    SimulatedPolicyAgent, HybridAgent, ImaginationAugmentedAgent, DynamicsTransformerAgent, DifferentialEquationAgent,
)}


def build_agent(variant: str, feature_count: int, parameters: dict, task: str, seed: int) -> Agent:
    if variant not in AGENTS:
        raise ValueError(f"unknown world-model variant {variant!r}; known: {', '.join(sorted(AGENTS))}")
    return AGENTS[variant](feature_count, parameters, task, seed)


__all__ = ["AGENTS", "Agent", "build_agent", "to_tensors"]
