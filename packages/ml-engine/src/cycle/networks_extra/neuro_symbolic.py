"""Rule-aware networks as one Model Cycle network kind (``network: "neuro_symbolic"``).

Seven catalog specs, one module, told apart by the ``symbolic_integration``
parameter (each registry entry fixes its own, see
``packages/config/cycle_models/neuro_symbolic.json``):

    logic_layer            Differentiable Logic Layer
    neural_then_rules      Neuro-Symbolic Model
    rule_augmented         Rule-Augmented Neural Net
    residual_over_rules    Residual Learning over Rules
    probabilistic_program  Probabilistic Program + DeepNet
    predicate_gate         Neuro-Symbolic Reasoning Model (probabilistic-symbolic group)
    meta_router            Meta-Learned Symbolic Router (trained episodically by
                           ``cycle.adapters_extra.meta_symbolic_router``)

Trained, saved and loaded by ``cycle.networks.NeuralAdapter`` like every other
kind (the meta router by its NeuralAdapter subclass).

The symbolic side: the shared rule library
------------------------------------------
Every integration reasons over the atoms and rules of
``packages/config/cycle_rules.json`` (``cycle.bridges.rules``): an atom is one test
``input operator threshold`` on a causal indicator of the closes (relative
strength index, MACD histogram, Bollinger band position, least-squares trend
slope, volatility ratio) or on a raw feature column READ BY NAME from the run's
``MarketView``; a rule is a conjunction of atoms concluding up or down with a
certainty.

The atom inputs reach the network through the ``extra_channels(view)`` hook:
for each distinct atom input two channels are appended to the engine's
feature row, the input's value in its own units (0 where unknown) and a known
flag (1 / 0). Row t of every channel reads bars <= t only (the library's
indicators are trailing), so the prediction at t is unchanged when the bars
after t are cut. A feature atom whose column the run does not carry is
disabled (its known flag is 0 everywhere and ``prepare`` switches the atom and
every rule that needs it off).

``prepare(features, train_index, view)`` runs once per fit on TRAINING rows
only and fills buffers (restored by ``load_state_dict``, never recomputed at
load): each atom's threshold (a fixed number, or the training quantile the
library asks for), its soft width (the training standard deviation of its
input), which atoms and rules are enabled, and, for the logic layer, the
initial predicate thresholds (training quantiles of the engine features).

An atom's soft truth is ``sigmoid(sign * (value - threshold) / (width * temperature))``
(``sign`` +1 for ``>``, -1 for ``<``); its hard truth is the comparison itself.
An unknown or disabled atom is 0.5 in the soft integrations (no evidence
either way). A rule's truth is the product t-norm of its atoms' truths
(``AND(x, y) = x * y``).

The neural side and the window
------------------------------
Every integration reads the window of ``sequence_length`` bars the adapter
hands a sequence kind and summarises the ENGINE features (not the appended
channels) as ``[last row, mean over the window]``; the atoms are evaluated on
the last row, the bar being predicted.

Output convention (every kind): ``forward(window) -> (batch,)`` raw head output,
the log-odds of up for the direction model and the scaled move itself for the
price model. Only the probabilistic program computes differently per task (the
exact marginal P(up) versus the mixture mean), so every network carries a
``regression_task`` buffer, set by ``set_task`` or, when the adapter does not
call it, read from the calling ``NeuralAdapter`` in ``prepare``.

Auxiliary losses (``auxiliary_loss()``, added to each training batch by the
adapter) read the tensors of the batch's own forward pass, cached only while
the network is in training mode.
"""

from __future__ import annotations

import math
import sys

import numpy as np
import torch
import torch.nn.functional as functional
from torch import nn

from cycle.bridges.rules import RuleLibrary, indicator_values

SEQUENCE = True
ATTENTION = False

INTEGRATIONS = ("logic_layer", "neural_then_rules", "rule_augmented", "residual_over_rules",
                "probabilistic_program", "predicate_gate", "meta_router")
UNKNOWN_TRUTH = 0.5
_LOG_FLOOR = 1e-6
# Literal-selection logits are stored divided by this gain: an optimiser step moves a
# selection logit SELECTION_GAIN times as far, so a clause can gain or drop a literal within
# the few hundred steps a fold trains for (at the shared learning rate a raw logit would
# move about 0.002 per step and the clauses would stay where they were initialised).
SELECTION_GAIN = 5.0
# The logic layer's head reads the log-odds of its final truth values, clipped here: a linear
# head on raw truths in [0, 1] (spread about 0.1) needs weights far larger than a fold's few
# hundred steps can grow.
_ODDS_FLOOR = 1e-4

# ─── the library and its channels ───────────────────────────────────────────

LIBRARY = RuleLibrary.load()
# (source, input) of every distinct atom input, in library order; two channels each: value, known
CHANNEL_INPUTS: tuple[tuple[str, str], ...] = tuple(dict.fromkeys((atom.source, atom.input) for atom in LIBRARY.atoms))
CHANNEL_COUNT = 2 * len(CHANNEL_INPUTS)
ATOM_NAMES = tuple(atom.name for atom in LIBRARY.atoms)
RULE_NAMES = tuple(rule.name for rule in LIBRARY.rules)


def channel_values(view) -> tuple[np.ndarray, np.ndarray]:
    """(values, known), each float64 (n, inputs): every atom input over every
    row of ``view`` in its own units; a feature the view does not carry is
    unknown everywhere."""
    count = len(view)
    values = np.zeros((count, len(CHANNEL_INPUTS)), dtype=np.float64)
    known = np.zeros_like(values)
    for position, (source, name) in enumerate(CHANNEL_INPUTS):
        if source == "indicator":
            column = indicator_values(name, view, LIBRARY.indicators.get(name, {}))
        else:
            column = view.feature_column(name)
        if column is None:
            continue
        column = np.asarray(column, dtype=np.float64)
        finite = np.isfinite(column)
        values[finite, position] = column[finite]
        known[finite, position] = 1.0
    return values, known


def extra_channels(view) -> np.ndarray:
    """The NeuralAdapter hook: float32 (n, CHANNEL_COUNT), the atom inputs'
    values then their known flags. Row t reads bars <= t only."""
    values, known = channel_values(view)
    return np.concatenate([values, known], axis=1).astype(np.float32)


def expert_groups() -> list[tuple[str, int, int]]:
    """The meta router's symbolic experts: the library's rules grouped by name
    (``<group>_long`` / ``<group>_short``), as (group, long rule index, short
    rule index), -1 where the library has no rule of that side."""
    groups: dict[str, list[int]] = {}
    for index, rule in enumerate(LIBRARY.rules):
        base, _, side = rule.name.rpartition("_")
        if side not in ("long", "short") or not base:
            base, side = rule.name, "long" if rule.conclusion == "up" else "short"
        slot = groups.setdefault(base, [-1, -1])
        slot[0 if side == "long" else 1] = index
    return [(name, long_index, short_index) for name, (long_index, short_index) in groups.items()]


def _calling_adapter_task() -> str | None:
    """The task of the NeuralAdapter whose ``fit`` called ``prepare`` (the
    adapter hands the network no task; see the module docstring)."""
    frame = sys._getframe(2)
    while frame is not None:
        owner = frame.f_locals.get("self")
        if owner is not None and getattr(owner, "network_kind", None) == "neuro_symbolic" \
                and getattr(owner, "task", None) in ("classification", "regression"):
            return owner.task
        frame = frame.f_back
    return None


def _multilayer(width_in: int, hidden_size: int, layer_count: int, dropout: float) -> tuple[nn.Sequential, int]:
    layers: list[nn.Module] = []
    width = width_in
    for _ in range(max(0, int(layer_count))):
        layers += [nn.Linear(width, hidden_size), nn.GELU(), nn.Dropout(dropout)]
        width = hidden_size
    return nn.Sequential(*layers), width


def soft_and(literals: torch.Tensor, include_logits: torch.Tensor, literal_mask: torch.Tensor | None = None) -> torch.Tensor:
    """Product t-norm conjunction with soft literal selection: neuron m is
    ``prod_l (1 - s_ml * (1 - x_l))``, s = sigmoid(SELECTION_GAIN * logits); a
    literal with s = 0 is left out (contributes 1), and so is every literal
    whose ``literal_mask`` is 0 (a disabled atom). ``literals`` (batch, L) in
    [0, 1], ``include_logits`` (M, L); returns (batch, M)."""
    selection = torch.sigmoid(SELECTION_GAIN * include_logits)
    if literal_mask is not None:
        selection = selection * literal_mask
    terms = 1.0 - selection.unsqueeze(0) * (1.0 - literals.unsqueeze(1))
    return torch.exp(torch.log(terms.clamp_min(_LOG_FLOOR)).sum(-1))


def sparse_selection(neuron_count: int, width: int, chosen: int, generator: torch.Generator) -> torch.Tensor:
    """Initial literal-selection parameters: each neuron starts as a short clause
    of ``chosen`` random literals (selection 0.95) with every other literal
    almost left out (selection 0.02) but still reachable by the gradient. A
    dense small selection makes every conjunction of many literals the same
    near-constant product, which does not learn. Stored divided by
    ``SELECTION_GAIN`` (see there)."""
    logits = torch.full((neuron_count, width), -4.0)
    for neuron in range(neuron_count):
        picked = torch.randperm(width, generator=generator)[: min(chosen, width)]
        logits[neuron, picked] = 3.0
    return logits / SELECTION_GAIN


def soft_or(truths: torch.Tensor, include_logits: torch.Tensor) -> torch.Tensor:
    """Probabilistic-sum disjunction ``1 - prod_m (1 - s_km * x_m)`` with soft selection."""
    selection = torch.sigmoid(SELECTION_GAIN * include_logits)
    terms = 1.0 - selection.unsqueeze(0) * truths.unsqueeze(1)
    return 1.0 - torch.exp(torch.log(terms.clamp_min(_LOG_FLOOR)).sum(-1))


# ─── the base: atoms, rules, prepare ────────────────────────────────────────


class SymbolicNetwork(nn.Module):
    """What every integration shares: the window split, the atom buffers and
    their truths, the rules, ``prepare`` and the task flag."""

    integration = ""

    def __init__(self, feature_count: int, parameters: dict) -> None:
        super().__init__()
        engine_count = int(feature_count) - CHANNEL_COUNT
        if engine_count < 1:
            raise ValueError(
                f"the neuro_symbolic network needs the engine features plus {CHANNEL_COUNT} rule channels "
                f"(extra_channels), got {feature_count} input columns"
            )
        self.engine_feature_count = engine_count
        self.sequence_length = int(parameters.get("sequence_length", 1))
        self.temperature = float(parameters.get("temperature", 1.0))
        if not self.temperature > 0:
            raise ValueError(f"temperature must be positive, got {self.temperature}")
        self.summary_size = 2 * engine_count
        atoms = LIBRARY.atoms
        positions = {pair: index for index, pair in enumerate(CHANNEL_INPUTS)}
        self.register_buffer("atom_input_position", torch.tensor([positions[(a.source, a.input)] for a in atoms], dtype=torch.long))
        self.register_buffer("atom_sign", torch.tensor([1.0 if a.operator in (">", ">=") else -1.0 for a in atoms]))
        self.register_buffer("atom_inclusive", torch.tensor([1.0 if a.operator in (">=", "<=") else 0.0 for a in atoms]))
        self.register_buffer("atom_threshold", torch.tensor([a.threshold if a.threshold is not None else 0.0 for a in atoms]))
        self.register_buffer("atom_width", torch.ones(len(atoms)))
        self.register_buffer("atom_enabled", torch.ones(len(atoms)))
        self.register_buffer("atom_direction", torch.tensor(
            [1.0 if a.suggests == "up" else -1.0 if a.suggests == "down" else 0.0 for a in atoms]))
        index = {name: position for position, name in enumerate(ATOM_NAMES)}
        membership = torch.zeros(len(LIBRARY.rules), len(atoms))
        for row, rule in enumerate(LIBRARY.rules):
            for name in rule.when:
                membership[row, index[name]] = 1.0
        self.register_buffer("rule_membership", membership)
        self.register_buffer("rule_direction", torch.tensor([1.0 if r.conclusion == "up" else -1.0 for r in LIBRARY.rules]))
        self.register_buffer("rule_certainty", torch.tensor([float(r.certainty) for r in LIBRARY.rules]))
        self.register_buffer("rule_enabled", torch.ones(len(LIBRARY.rules)))
        self.register_buffer("regression_task", torch.zeros(()))
        self.register_buffer("prepared", torch.zeros(()))
        self.disabled_atoms: dict[str, str] = {}
        self._task_set = False
        self._cache: dict[str, torch.Tensor] | None = None

    # ── task and preparation ──

    def set_task(self, task: str) -> None:
        if task not in ("classification", "regression"):
            raise ValueError(f"task must be classification or regression, got {task!r}")
        self.regression_task.fill_(1.0 if task == "regression" else 0.0)
        self._task_set = True

    @property
    def is_regression(self) -> bool:
        return bool(self.regression_task.item() > 0.5)

    def prepare(self, features, train_index, view) -> None:
        """Fill every buffer from TRAINING rows (``train_index``) of ``view``."""
        if not self._task_set:
            task = _calling_adapter_task()
            if task is not None:
                self.set_task(task)
        if view is None:
            raise RuntimeError("the neuro_symbolic network reads its rule inputs from the market view; bind_market(view) first")
        rows = np.asarray(train_index, dtype=np.int64).reshape(-1)
        if rows.size == 0:
            raise ValueError("the neuro_symbolic network needs training rows to fit its rule thresholds")
        values, known = channel_values(view)
        names = set(view.feature_names) if view.raw_features is not None else set()
        thresholds = self.atom_threshold.clone()
        widths = torch.ones_like(self.atom_width)
        enabled = torch.ones_like(self.atom_enabled)
        self.disabled_atoms = {}
        for position, atom in enumerate(LIBRARY.atoms):
            column = int(self.atom_input_position[position])
            if atom.source == "feature" and atom.input not in names:
                enabled[position] = 0.0
                self.disabled_atoms[atom.name] = f"the run has no raw feature column {atom.input!r}"
                continue
            usable = rows[known[rows, column] > 0.5]
            sample = values[usable, column]
            if sample.size < 2:
                enabled[position] = 0.0
                self.disabled_atoms[atom.name] = f"{atom.input!r} has fewer than two known training values"
                continue
            if atom.train_quantile is not None:
                thresholds[position] = float(np.quantile(sample, atom.train_quantile))
            spread = float(np.std(sample))
            widths[position] = spread if math.isfinite(spread) and spread > 1e-12 else 1.0
        self.atom_threshold.copy_(thresholds)
        self.atom_width.copy_(widths)
        self.atom_enabled.copy_(enabled)
        needs_disabled = (self.rule_membership * (1.0 - enabled).unsqueeze(0)).sum(1) > 0
        self.rule_enabled.copy_((~needs_disabled).float())
        self.prepare_integration(np.asarray(features, dtype=np.float64), rows, view)
        self.prepared.fill_(1.0)

    def prepare_integration(self, features: np.ndarray, rows: np.ndarray, view) -> None:
        """Integration-specific training-row fills (none by default)."""

    def summary_rows(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        """The window summary ``[last row, window mean]`` of the engine features
        at ``rows`` (float64), as ``summary`` computes it on a window."""
        length = self.sequence_length
        offsets = np.arange(-length + 1, 1)
        windows = features[np.clip(rows[:, None] + offsets, 0, None)][:, :, : self.engine_feature_count]
        return np.concatenate([windows[:, -1], windows.mean(axis=1)], axis=1)

    # ── the window and the atoms ──

    def _check_prepared(self) -> None:
        if self.prepared.item() < 0.5:
            raise RuntimeError("the neuro_symbolic network is used before prepare() fitted its rule thresholds")

    def split(self, window: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """(summary (batch, 2E), atom input values (batch, inputs), known flags (batch, inputs)), float32."""
        if window.dim() == 2:
            window = window.unsqueeze(1)
        window = window.float()
        engine = window[:, :, : self.engine_feature_count]
        summary = torch.cat([engine[:, -1], engine.mean(dim=1)], dim=-1)
        channels = window[:, -1, self.engine_feature_count:]
        inputs = len(CHANNEL_INPUTS)
        return summary, channels[:, :inputs], channels[:, inputs:]

    def atom_truths(self, values: torch.Tensor, known: torch.Tensor, *, hard: bool = False,
                    unknown: float = UNKNOWN_TRUTH, temperature: float | None = None) -> torch.Tensor:
        """(batch, atoms): each atom's soft (or hard) truth; ``unknown`` where
        its input is unknown or the atom is disabled."""
        self._check_prepared()
        atom_values = values[:, self.atom_input_position]
        atom_known = known[:, self.atom_input_position] > 0.5
        difference = atom_values - self.atom_threshold
        if hard:
            signed = self.atom_sign * difference
            truth = ((signed > 0) | ((self.atom_inclusive > 0.5) & (difference == 0))).float()
        else:
            scale = self.atom_width * (self.temperature if temperature is None else temperature)
            truth = torch.sigmoid(self.atom_sign * difference / scale)
        usable = atom_known & (self.atom_enabled > 0.5)
        return torch.where(usable, truth, torch.full_like(truth, float(unknown)))

    def rule_truths(self, atoms: torch.Tensor) -> torch.Tensor:
        """(batch, rules): the product of each rule's atom truths (exact: a false
        atom gives exactly 0, all-true atoms exactly 1); 0 for a disabled rule."""
        members = self.rule_membership.unsqueeze(0) > 0.5
        factors = torch.where(members, atoms.unsqueeze(1), torch.ones_like(atoms).unsqueeze(1))
        return factors.prod(dim=-1) * self.rule_enabled

    def symbolic_evidence(self, window: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """(summary, soft atom truths, soft rule truths) for a window."""
        summary, values, known = self.split(window)
        atoms = self.atom_truths(values, known)
        return summary, atoms, self.rule_truths(atoms)

    # ── the adapter's hooks ──

    def _remember(self, **tensors: torch.Tensor) -> None:
        self._cache = tensors if self.training else None

    def auxiliary_loss(self):
        return None

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        return self.forward_detailed(window)[0]

    def forward_detailed(self, window: torch.Tensor) -> tuple[torch.Tensor, list[tuple[str, str, torch.Tensor]]]:
        raise NotImplementedError


# ─── 1. the differentiable logic layer ──────────────────────────────────────


class LogicLayerNetwork(SymbolicNetwork):
    """Learnable predicates ``p_k = sigmoid(a_k (x_c(k) - theta_k) / temperature)``
    over the window summary (thresholds initialised at training quantiles) plus
    the library's atom truths are the literals; each literal and its negation
    ``1 - x`` feed ``logic_layer_count`` pairs of a soft-AND layer and a soft-OR
    layer (learned literal selection); a linear head reads the last OR layer's
    truth values. Loss adds ``constraint_weight`` times the library rules'
    implication violation ``P (1 - Q)`` (the product implication ``1 - P + PQ``),
    Q = sigmoid(output) (for a down rule Q is the down side)."""

    integration = "logic_layer"

    def __init__(self, feature_count: int, parameters: dict) -> None:
        super().__init__(feature_count, parameters)
        self.predicate_count = int(parameters["predicate_count"])
        self.neuron_count = int(parameters["logic_neuron_count"])
        self.layer_pairs = int(parameters["logic_layer_count"])
        self.constraint_weight = float(parameters["constraint_weight"])
        if self.predicate_count < 1 or self.neuron_count < 1 or self.layer_pairs < 1:
            raise ValueError("predicate_count, logic_neuron_count and logic_layer_count must be at least 1")
        columns = torch.arange(self.predicate_count) % self.summary_size
        self.register_buffer("predicate_column", columns)
        self.predicate_threshold = nn.Parameter(torch.zeros(self.predicate_count))
        self.predicate_slope = nn.Parameter(torch.ones(self.predicate_count))
        literal_count = self.predicate_count + len(ATOM_NAMES)
        generator = torch.Generator().manual_seed(0)
        self.and_layers = nn.ParameterList()
        self.or_layers = nn.ParameterList()
        width = 2 * literal_count
        for _ in range(self.layer_pairs):
            self.and_layers.append(nn.Parameter(sparse_selection(self.neuron_count, width, 2, generator)))
            self.or_layers.append(nn.Parameter(sparse_selection(self.neuron_count, self.neuron_count, 3, generator)))
            width = 2 * self.neuron_count
        self.head = nn.Linear(self.neuron_count, 1)

    def prepare_integration(self, features, rows, view) -> None:
        summary = self.summary_rows(features, rows)
        rounds = math.ceil(self.predicate_count / self.summary_size)
        with torch.no_grad():
            for predicate in range(self.predicate_count):
                column = int(self.predicate_column[predicate])
                level = (predicate // self.summary_size + 1) / (rounds + 1)
                sample = summary[:, column]
                sample = sample[np.isfinite(sample)]
                self.predicate_threshold[predicate] = float(np.quantile(sample, level)) if sample.size else 0.0

    def forward_detailed(self, window):
        summary, atoms, rules = self.symbolic_evidence(window)
        chosen = summary[:, self.predicate_column]
        predicates = torch.sigmoid(self.predicate_slope * (chosen - self.predicate_threshold) / self.temperature)
        literals = torch.cat([predicates, atoms], dim=-1)
        recorded = [("Learned predicates (soft thresholds)", "predicate", predicates),
                    ("Rule library atoms (soft truth)", "atom", atoms)]
        enabled = torch.cat([torch.ones_like(predicates[0]), self.atom_enabled])
        mask = torch.cat([enabled, enabled])
        for number, (and_logits, or_logits) in enumerate(zip(self.and_layers, self.or_layers), 1):
            conjunctions = soft_and(torch.cat([literals, 1.0 - literals], dim=-1), and_logits, mask)
            mask = None
            literals = soft_or(conjunctions, or_logits)
            recorded += [(f"Logic layer {number}: soft AND (product t-norm)", "logic_and", conjunctions),
                         (f"Logic layer {number}: soft OR (probabilistic sum)", "logic_or", literals)]
        truth_odds = torch.logit(literals.clamp(_ODDS_FLOOR, 1.0 - _ODDS_FLOOR))
        recorded.append(("Log-odds of the final truth values (head input)", "logit", truth_odds))
        output = self.head(truth_odds).squeeze(-1)
        self._remember(output=output, rules=rules)
        return output, recorded

    def auxiliary_loss(self):
        if self._cache is None or self.constraint_weight <= 0:
            return None
        output, rules = self._cache["output"], self._cache["rules"]
        up = torch.sigmoid(output).unsqueeze(-1)
        conclusion = torch.where(self.rule_direction > 0, up, 1.0 - up)
        violation = rules * (1.0 - conclusion) * self.rule_certainty
        return self.constraint_weight * violation.mean()


# ─── 2. neural encoder, then rules over the embedding ───────────────────────


class NeuralThenRulesNetwork(SymbolicNetwork):
    """h = MLP(summary); ``predicate_count`` predicates ``sigmoid(W h / temperature)``
    on the embedding; ``rule_count`` differentiable rules, each a soft AND over
    the predicates and their negations; fusion MLP([h, rules]) -> head. Loss adds
    ``constraint_weight`` times the declared rule relations: rules 2i and 2i + 1
    are mutually exclusive (penalty r_2i * r_2i+1), and learned rule j is
    grounded on library rule j (squared difference of their truths)."""

    integration = "neural_then_rules"

    def __init__(self, feature_count: int, parameters: dict) -> None:
        super().__init__(feature_count, parameters)
        dropout = float(parameters["dropout"])
        self.encoder, width = _multilayer(self.summary_size, int(parameters["hidden_size"]),
                                          int(parameters["layer_count"]), dropout)
        self.predicate_count = int(parameters["predicate_count"])
        self.rule_count = int(parameters["rule_count"])
        self.constraint_weight = float(parameters["constraint_weight"])
        if self.predicate_count < 1 or self.rule_count < 1:
            raise ValueError("predicate_count and rule_count must be at least 1")
        self.predicates = nn.Linear(width, self.predicate_count)
        generator = torch.Generator().manual_seed(0)
        self.rule_logits = nn.Parameter(sparse_selection(self.rule_count, 2 * self.predicate_count, 2, generator))
        fusion = int(parameters["fusion_hidden_size"])
        self.fusion = nn.Sequential(nn.Linear(width + self.rule_count, fusion), nn.GELU(), nn.Dropout(dropout))
        self.head = nn.Linear(fusion, 1)
        self.grounded = min(self.rule_count, len(RULE_NAMES))

    def forward_detailed(self, window):
        summary, _atoms, library_rules = self.symbolic_evidence(window)
        embedding = self.encoder(summary)
        predicates = torch.sigmoid(self.predicates(embedding) / self.temperature)
        rules = soft_and(torch.cat([predicates, 1.0 - predicates], dim=-1), self.rule_logits)
        fused = self.fusion(torch.cat([embedding, rules], dim=-1))
        output = self.head(fused).squeeze(-1)
        self._remember(rules=rules, library_rules=library_rules)
        return output, [("Neural encoder", "dense", embedding), ("Predicates on the embedding", "predicate", predicates),
                        ("Learned rules (soft AND)", "logic_and", rules), ("Fusion (gelu)", "dense", fused)]

    def auxiliary_loss(self):
        if self._cache is None or self.constraint_weight <= 0:
            return None
        rules, library = self._cache["rules"], self._cache["library_rules"]
        pairs = self.rule_count // 2
        exclusive = (rules[:, 0: 2 * pairs: 2] * rules[:, 1: 2 * pairs: 2]).mean() if pairs else rules.new_zeros(())
        grounded = self.grounded
        mask = self.rule_enabled[:grounded]
        grounding = (((rules[:, :grounded] - library[:, :grounded]) ** 2) * mask).mean() if grounded else rules.new_zeros(())
        return self.constraint_weight * (exclusive + grounding)


# ─── 3. rule-augmented network ──────────────────────────────────────────────


class RuleAugmentedNetwork(SymbolicNetwork):
    """A plain network augmented three ways: (1) the library rules' truths are
    appended to its input (``rule_input``); (2) its output is gated by them
    (``output_gate``): ``y = y_net * 2 sigmoid(w0 + w . r) + b * sum_k d_k c_k r_k``,
    initialised to the identity; (3) ``rule_loss_weight`` times a hinge on
    predictions whose sign contradicts a confident rule (certainty at or above
    ``rule_confidence_threshold``): ``r_k * relu(-d_k y)``."""

    integration = "rule_augmented"

    def __init__(self, feature_count: int, parameters: dict) -> None:
        super().__init__(feature_count, parameters)
        self.rule_input = bool(parameters["rule_input"])
        self.output_gate = bool(parameters["output_gate"])
        self.rule_loss_weight = float(parameters["rule_loss_weight"])
        self.confidence_threshold = float(parameters["rule_confidence_threshold"])
        rule_count = len(RULE_NAMES)
        self.body, width = _multilayer(self.summary_size + (rule_count if self.rule_input else 0),
                                       int(parameters["hidden_size"]), int(parameters["layer_count"]),
                                       float(parameters["dropout"]))
        self.head = nn.Linear(width, 1)
        self.gate_weights = nn.Parameter(torch.zeros(rule_count))
        self.gate_bias = nn.Parameter(torch.zeros(()))
        self.rule_vote_scale = nn.Parameter(torch.zeros(()))

    def forward_detailed(self, window):
        summary, _atoms, rules = self.symbolic_evidence(window)
        inputs = torch.cat([summary, rules], dim=-1) if self.rule_input else summary
        hidden = self.body(inputs)
        neural = self.head(hidden).squeeze(-1)
        recorded = [("Library rules (soft truth)", "rule", rules), ("Network body", "dense", hidden)]
        if self.output_gate:
            gate = 2.0 * torch.sigmoid(self.gate_bias + rules @ self.gate_weights)
            votes = rules @ (self.rule_direction * self.rule_certainty)
            output = neural * gate + self.rule_vote_scale * votes
            recorded.append(("Rule gate on the output", "gate", gate.unsqueeze(-1)))
        else:
            output = neural
        self._remember(output=output, rules=rules)
        return output, recorded

    def auxiliary_loss(self):
        if self._cache is None or self.rule_loss_weight <= 0:
            return None
        output, rules = self._cache["output"], self._cache["rules"]
        confident = (self.rule_certainty >= self.confidence_threshold).float() * self.rule_enabled
        contradiction = rules * functional.relu(-self.rule_direction * output.unsqueeze(-1)) * confident
        return self.rule_loss_weight * contradiction.sum(-1).mean()


# ─── 4. residual learning over rules ────────────────────────────────────────


class ResidualOverRulesNetwork(SymbolicNetwork):
    """``output = b + sum_k a_k r_k(x) + s * f(x)``: a rule base on the library
    rules' truths plus a neural residual f. Trained in two stages by
    ``on_epoch``: for the first ``min(rule_stage_epochs, epochs - 1)`` epochs
    only the rule weights learn (s = 0: a regularised logistic regression on
    the rule votes for the direction, a regularised linear one for the price);
    then the residual learns on top (s = 1) with the rule weights frozen when
    ``freeze_rule_weights``. Loss adds ``rule_weight_penalty * |a|^2`` and
    ``residual_penalty_weight * mean(f^2)``, so the residual only corrects what
    the rules miss. ``residual_scale`` is a buffer: a best epoch from the first
    stage is kept, and reloaded, as the rules alone."""

    integration = "residual_over_rules"

    def __init__(self, feature_count: int, parameters: dict) -> None:
        super().__init__(feature_count, parameters)
        self.residual_penalty_weight = float(parameters["residual_penalty_weight"])
        self.rule_weight_penalty = float(parameters["rule_weight_penalty"])
        self.rule_stage_epochs = int(parameters["rule_stage_epochs"])
        self.freeze_rule_weights = bool(parameters["freeze_rule_weights"])
        certainty = self.rule_certainty.clamp(1e-3, 1 - 1e-3)
        self.rule_weights = nn.Parameter(self.rule_direction * torch.log(certainty / (1.0 - certainty)))
        self.rule_bias = nn.Parameter(torch.zeros(()))
        self.residual, width = _multilayer(self.summary_size, int(parameters["hidden_size"]),
                                           int(parameters["layer_count"]), float(parameters["dropout"]))
        self.residual_head = nn.Linear(width, 1)
        self.register_buffer("residual_scale", torch.ones(()))
        self.stage = 2

    def rule_parameters(self) -> list[nn.Parameter]:
        return [self.rule_weights, self.rule_bias]

    def residual_parameters(self) -> list[nn.Parameter]:
        return [*self.residual.parameters(), *self.residual_head.parameters()]

    def on_epoch(self, epoch: int, epoch_count: int) -> None:
        first_stage = min(self.rule_stage_epochs, max(0, int(epoch_count) - 1))
        self.stage = 1 if epoch <= first_stage else 2
        self.residual_scale.fill_(0.0 if self.stage == 1 else 1.0)
        for parameter in self.residual_parameters():
            parameter.requires_grad_(self.stage == 2)
        for parameter in self.rule_parameters():
            parameter.requires_grad_(self.stage == 1 or not self.freeze_rule_weights)

    def forward_detailed(self, window):
        summary, _atoms, rules = self.symbolic_evidence(window)
        rule_logit = self.rule_bias + rules @ self.rule_weights
        hidden = self.residual(summary)
        residual = self.residual_head(hidden).squeeze(-1)
        output = rule_logit + self.residual_scale * residual
        self._remember(residual=residual)
        return output, [("Library rules (soft truth)", "rule", rules),
                        ("Rule base (weighted rule votes)", "rule_base", rule_logit.unsqueeze(-1)),
                        ("Residual network", "dense", hidden),
                        ("Residual correction", "residual", (self.residual_scale * residual).unsqueeze(-1))]

    def auxiliary_loss(self):
        if self._cache is None:
            return None
        loss = self.rule_weight_penalty * (self.rule_weights ** 2).sum()
        if self.residual_scale.item() > 0:
            loss = loss + self.residual_penalty_weight * (self._cache["residual"] ** 2).mean()
        return loss


# ─── 5. probabilistic program + deep network ────────────────────────────────


class ProbabilisticProgramNetwork(SymbolicNetwork):
    """A small generative program whose parameters a deep network supplies:

        z ~ Categorical(softmax(f(summary, rules)))          a latent market state, S states
        u ~ Normal(0, 1)                                      optional per-bar noise (G fixed draws)
        up | z, x, u ~ Bernoulli(sigmoid(g_z(x) + sigma_z u))

    The direction output is the log-odds of the EXACT marginal
    ``P(up | x) = sum_z p(z | x) mean_u sigmoid(g_z(x) + sigma_z u)`` (the discrete
    state is summed out exactly; the Gaussian by ``gaussian_sample_count``
    fixed-seed draws, 0 leaves it out), so the adapter's cross-entropy is the
    marginal likelihood. The price output is the mixture mean
    ``sum_z p(z | x) g_z(x)``. The program declares its states ordered from the
    most bearish to the most bullish: ``constraint_weight * mean(relu(g_z - g_z+1))``."""

    integration = "probabilistic_program"

    def __init__(self, feature_count: int, parameters: dict) -> None:
        super().__init__(feature_count, parameters)
        self.state_count = int(parameters["state_count"])
        self.sample_count = int(parameters["gaussian_sample_count"])
        self.constraint_weight = float(parameters["constraint_weight"])
        if self.state_count < 2:
            raise ValueError(f"state_count must be at least 2, got {self.state_count}")
        self.encoder, width = _multilayer(self.summary_size, int(parameters["hidden_size"]),
                                          int(parameters["layer_count"]), float(parameters["dropout"]))
        self.state_logits = nn.Linear(width + len(RULE_NAMES), self.state_count)
        self.state_outputs = nn.Linear(width, self.state_count)
        self.noise_scale = nn.Parameter(torch.full((self.state_count,), -1.0))
        samples = torch.randn(max(self.sample_count, 1), generator=torch.Generator().manual_seed(0))
        self.register_buffer("noise_samples", samples if self.sample_count > 0 else torch.zeros(1))

    def forward_detailed(self, window):
        summary, _atoms, rules = self.symbolic_evidence(window)
        hidden = self.encoder(summary)
        log_state = torch.log_softmax(self.state_logits(torch.cat([hidden, rules], dim=-1)), dim=-1)
        state_output = self.state_outputs(hidden)
        if self.is_regression:
            output = (log_state.exp() * state_output).sum(-1)
        else:
            if self.sample_count > 0:
                noisy = state_output.unsqueeze(-1) + functional.softplus(self.noise_scale).unsqueeze(-1) * self.noise_samples
                log_up = torch.logsumexp(functional.logsigmoid(noisy), dim=-1) - math.log(self.sample_count)
                log_down = torch.logsumexp(functional.logsigmoid(-noisy), dim=-1) - math.log(self.sample_count)
            else:
                log_up, log_down = functional.logsigmoid(state_output), functional.logsigmoid(-state_output)
            output = torch.logsumexp(log_state + log_up, dim=-1) - torch.logsumexp(log_state + log_down, dim=-1)
        self._remember(state_output=state_output)
        return output, [("Deep network", "dense", hidden), ("State posterior p(z | x)", "state", log_state.exp()),
                        ("Per-state output g_z(x)", "state_output", state_output)]

    def auxiliary_loss(self):
        if self._cache is None or self.constraint_weight <= 0:
            return None
        state_output = self._cache["state_output"]
        return self.constraint_weight * functional.relu(state_output[:, :-1] - state_output[:, 1:]).mean()


# ─── 6. predicate gate (the neuro-symbolic reasoning model) ─────────────────


class PredicateGateNetwork(SymbolicNetwork):
    """Neural backbone h = MLP(summary) -> neural logit; the library atoms are
    the fixed predicates, relaxed by a sigmoid at an annealed temperature in
    training and HARD thresholds at inference; a learned combination of them
    (initialised at each atom's suggested direction) is the symbolic logit.
    Hard constraints GATE the sum: a library rule with certainty at or above
    ``constraint_certainty`` that concludes down forbids a long call, one that
    concludes up forbids a short call:

        out = y - v_long * relu(y) + v_short * relu(-y)

    with v the OR of the firing constraint rules (an unknown input never
    fires). At inference v is 0 or 1, so a firing long veto clamps the output
    to exactly min(y, 0). Loss adds ``consistency_weight`` times the squared
    gap between the neural and the symbolic head's probabilities."""

    integration = "predicate_gate"

    def __init__(self, feature_count: int, parameters: dict) -> None:
        super().__init__(feature_count, parameters)
        self.consistency_weight = float(parameters["consistency_weight"])
        self.constraint_certainty = float(parameters["constraint_certainty"])
        self.backbone, width = _multilayer(self.summary_size, int(parameters["embedding_size"]),
                                           int(parameters["layer_count"]), float(parameters["dropout"]))
        self.neural_head = nn.Linear(width, 1)
        self.symbolic_head = nn.Linear(len(ATOM_NAMES), 1)
        with torch.no_grad():
            self.symbolic_head.weight.copy_(0.5 * self.atom_direction.unsqueeze(0))
            self.symbolic_head.bias.zero_()
        constraint = (self.rule_certainty >= self.constraint_certainty).float()
        self.register_buffer("long_veto_rules", constraint * (self.rule_direction < 0).float())
        self.register_buffer("short_veto_rules", constraint * (self.rule_direction > 0).float())
        self.temperature_scale = 1.0

    def on_epoch(self, epoch: int, epoch_count: int) -> None:
        """Anneal the relaxation temperature geometrically to a tenth of its value."""
        progress = (epoch - 1) / max(1, int(epoch_count) - 1)
        self.temperature_scale = 0.1 ** progress

    def vetoes(self, values: torch.Tensor, known: torch.Tensor, hard: bool) -> tuple[torch.Tensor, torch.Tensor]:
        atoms = self.atom_truths(values, known, hard=hard, unknown=0.0,
                                 temperature=self.temperature * self.temperature_scale)
        rules = self.rule_truths(atoms)
        long_veto = 1.0 - torch.prod(1.0 - rules * self.long_veto_rules, dim=-1)
        short_veto = 1.0 - torch.prod(1.0 - rules * self.short_veto_rules, dim=-1)
        return long_veto, short_veto

    def forward_detailed(self, window):
        summary, values, known = self.split(window)
        hard = not self.training
        atoms = self.atom_truths(values, known, hard=hard, temperature=self.temperature * self.temperature_scale)
        embedding = self.backbone(summary)
        neural = self.neural_head(embedding).squeeze(-1)
        symbolic = self.symbolic_head(2.0 * atoms - 1.0).squeeze(-1)
        combined = neural + symbolic
        long_veto, short_veto = self.vetoes(values, known, hard)
        output = combined - long_veto * functional.relu(combined) + short_veto * functional.relu(-combined)
        self._remember(neural=neural, symbolic=symbolic)
        return output, [("Neural backbone embedding", "dense", embedding),
                        ("Predicates (" + ("hard" if hard else "relaxed") + " truth)", "predicate", atoms),
                        ("Neural and symbolic logits", "logit", torch.stack([neural, symbolic], dim=-1)),
                        ("Hard-constraint vetoes (long, short)", "gate", torch.stack([long_veto, short_veto], dim=-1))]

    def auxiliary_loss(self):
        if self._cache is None or self.consistency_weight <= 0:
            return None
        gap = torch.sigmoid(self._cache["neural"]) - torch.sigmoid(self._cache["symbolic"])
        return self.consistency_weight * (gap ** 2).mean()


# ─── 7. the meta-learned symbolic router ────────────────────────────────────


class MetaRouterNetwork(SymbolicNetwork):
    """K parametrised symbolic experts, one per rule group of the library
    (trend following, mean reversion, momentum with trend, stretch reversion,
    news), each ``r_k = b_k + g_k (L_k - S_k) (1 + m_k V)`` with L_k / S_k the
    group's long / short rule truths and V the truth of the volatility filter
    atom (``volatility_expanding``); a router MLP(summary) gives softmax weights
    w_k; ``output = sum_k w_k r_k``. The expert parameters (K, 3) are one tensor
    so an episodic trainer can adapt a copy of them (``forward(window,
    expert_parameters=...)``); see ``cycle.adapters_extra.meta_symbolic_router``."""

    integration = "meta_router"

    def __init__(self, feature_count: int, parameters: dict) -> None:
        super().__init__(feature_count, parameters)
        groups = expert_groups()
        self.expert_names = tuple(name for name, _, _ in groups)
        self.register_buffer("expert_long_rule", torch.tensor([long for _, long, _ in groups], dtype=torch.long))
        self.register_buffer("expert_short_rule", torch.tensor([short for _, _, short in groups], dtype=torch.long))
        self.volatility_atom = ATOM_NAMES.index("volatility_expanding") if "volatility_expanding" in ATOM_NAMES else -1
        count = len(groups)
        initial = torch.zeros(count, 3)
        initial[:, 1] = 2.0
        self.expert_parameters = nn.Parameter(initial)
        self.router, width = _multilayer(self.summary_size, int(parameters["hidden_size"]),
                                         int(parameters["layer_count"]), float(parameters["dropout"]))
        self.router_head = nn.Linear(width, count)

    def expert_outputs(self, rules: torch.Tensor, atoms: torch.Tensor, expert_parameters: torch.Tensor) -> torch.Tensor:
        padded = torch.cat([rules, rules.new_zeros(rules.shape[0], 1)], dim=-1)    # index -1 reads the zero column
        long_truth = padded[:, self.expert_long_rule]
        short_truth = padded[:, self.expert_short_rule]
        volatility = atoms[:, self.volatility_atom:self.volatility_atom + 1] if self.volatility_atom >= 0 else rules.new_zeros(rules.shape[0], 1)
        bias, gain, modulation = expert_parameters[:, 0], expert_parameters[:, 1], expert_parameters[:, 2]
        return bias + gain * (long_truth - short_truth) * (1.0 + modulation * volatility)

    def router_weights(self, summary: torch.Tensor) -> torch.Tensor:
        return torch.softmax(self.router_head(self.router(summary)), dim=-1)

    def forward(self, window: torch.Tensor, expert_parameters: torch.Tensor | None = None) -> torch.Tensor:
        return self.forward_detailed(window, expert_parameters)[0]

    def forward_detailed(self, window, expert_parameters=None):
        summary, atoms, rules = self.symbolic_evidence(window)
        experts = self.expert_outputs(rules, atoms, self.expert_parameters if expert_parameters is None else expert_parameters)
        weights = self.router_weights(summary)
        output = (weights * experts).sum(-1)
        return output, [("Library rules (soft truth)", "rule", rules), ("Symbolic experts", "expert", experts),
                        ("Router weights (softmax)", "router", weights)]


NETWORKS: dict[str, type[SymbolicNetwork]] = {
    "logic_layer": LogicLayerNetwork,
    "neural_then_rules": NeuralThenRulesNetwork,
    "rule_augmented": RuleAugmentedNetwork,
    "residual_over_rules": ResidualOverRulesNetwork,
    "probabilistic_program": ProbabilisticProgramNetwork,
    "predicate_gate": PredicateGateNetwork,
    "meta_router": MetaRouterNetwork,
}


def build(parameters: dict, feature_count: int) -> nn.Module:
    """The network for a registry entry with ``network: "neuro_symbolic"``;
    ``parameters["symbolic_integration"]`` picks the integration."""
    integration = parameters.get("symbolic_integration")
    if integration not in NETWORKS:
        raise ValueError(f"symbolic_integration must be one of {INTEGRATIONS}, got {integration!r}")
    return NETWORKS[integration](int(feature_count), dict(parameters))


def _layer(name: str, kind: str, tensor: torch.Tensor) -> dict:
    value = tensor.detach()[0].double().cpu()
    return {"name": name, "kind": kind, "shape": [int(size) for size in value.shape],
            "values": value.reshape(-1).tolist()}


def trace(network: nn.Module, window: torch.Tensor) -> dict:
    """``{"layers": [...], "attention": [], "logit": float}`` for a batch-of-one
    window: the integration's recorded intermediates (predicates, atoms, logic
    layers, rules, gates, states) and the raw head output. Eval mode only."""
    if network.training:
        raise RuntimeError("trace needs the network in eval mode")
    with torch.no_grad():
        output, recorded = network.forward_detailed(window)
    logit = float(output.reshape(-1)[0].item())
    if not math.isfinite(logit):
        raise RuntimeError(f"trace: the head output is not finite ({logit})")
    return {"layers": [_layer(name, kind, tensor) for name, kind, tensor in recorded], "attention": [], "logit": logit}


def describe(network: nn.Module) -> list[dict]:
    """The traced layers without values, from a trace of an all-zero window."""
    window = torch.zeros(1, network.sequence_length, network.engine_feature_count + CHANNEL_COUNT)
    was_training = network.training
    network.eval()
    try:
        traced = trace(network, window)
    finally:
        network.train(was_training)
    return [{"name": layer["name"], "kind": layer["kind"], "outputShape": layer["shape"]} for layer in traced["layers"]]


__all__ = ["ATOM_NAMES", "ATTENTION", "CHANNEL_COUNT", "CHANNEL_INPUTS", "INTEGRATIONS", "NETWORKS", "RULE_NAMES",
           "SEQUENCE", "SymbolicNetwork", "build", "channel_values", "describe", "expert_groups", "extra_channels",
           "soft_and", "soft_or", "trace"]
