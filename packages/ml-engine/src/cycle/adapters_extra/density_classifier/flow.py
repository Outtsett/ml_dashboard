"""Exact class-conditional densities by change of variables.

``NormalizingFlow`` — a conditional RealNVP (Dinh, Sohl-Dickstein and Bengio
2017): ``coupling_layer_count`` blocks of ActNorm (data-initialised on the
training rows), a fixed permutation and an affine coupling whose conditioner
MLP reads the kept half of the row plus the class embedding; the scale is
soft-clamped to +/- ``scale_limit``. log p(x | k) = log N(f_k(x); 0, I) +
sum log|det J| exactly.

``ContinuousFlow`` — FFJORD (Grathwohl et al. 2019), the "neural ODE
generator": dz/ds = g(z, s, k) carries the row to the base N(0, I) over
s in [0, 1] (fixed-step RK4 through torchdiffeq, ``solver_steps`` steps) and
log p(x | k) = log N(z(1)) + integral of Tr(dg/dz) ds. Training uses the
Hutchinson trace estimator with one Gaussian probe per batch (or the exact
trace) plus the RNODE kinetic-energy penalty; every score the model keeps
uses the EXACT trace (``torch.func.jacrev`` under ``vmap``), so a bar's
density is a deterministic number. Generating a row is the same ODE run
backwards from a base draw; the classifier never needs it.
"""

from __future__ import annotations

import torch
from torch import nn

from .common import TorchDensity, fixed_uniform, multilayer_perceptron, standard_normal_log_density

# ─── RealNVP ───────────────────────────────────────────────────────────────


class ActNorm(nn.Module):
    def __init__(self, dimension: int) -> None:
        super().__init__()
        self.location = nn.Parameter(torch.zeros(dimension))
        self.log_scale = nn.Parameter(torch.zeros(dimension))

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        y = (x + self.location) * torch.exp(self.log_scale)
        return y, self.log_scale.sum().expand(x.shape[0])

    @torch.no_grad()
    def initialise(self, x: torch.Tensor) -> None:
        """Zero mean and unit spread on the rows given (training rows only)."""
        self.location.copy_(-x.mean(dim=0))
        self.log_scale.copy_(-torch.log(x.std(dim=0, unbiased=False).clamp_min(1e-3)))


class AffineCoupling(nn.Module):
    def __init__(self, dimension: int, kept: torch.Tensor, embedding_size: int, hidden_size: int, layer_count: int,
                 scale_limit: float) -> None:
        super().__init__()
        self.register_buffer("kept", kept.float())
        self.scale_limit = float(scale_limit)
        self.conditioner = multilayer_perceptron(dimension + embedding_size, hidden_size, layer_count, 2 * dimension,
                                                 zero_last=True)

    def forward(self, x: torch.Tensor, class_embedding: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        kept = self.kept.to(x.dtype)
        moved = 1.0 - kept
        shift_and_scale = self.conditioner(torch.cat([x * kept, class_embedding], dim=1))
        log_scale, shift = shift_and_scale.chunk(2, dim=1)
        log_scale = self.scale_limit * torch.tanh(log_scale / self.scale_limit) * moved
        y = x * kept + moved * (x * torch.exp(log_scale) + shift)
        return y, log_scale.sum(dim=1)


class ConditionalRealNVP(nn.Module):
    def __init__(self, dimension: int, class_count: int, embedding_size: int, hidden_size: int, layer_count: int,
                 coupling_layer_count: int, scale_limit: float, seed: int) -> None:
        super().__init__()
        self.class_embedding = nn.Embedding(class_count, embedding_size)
        self.normalisations = nn.ModuleList()
        self.couplings = nn.ModuleList()
        half = max(1, dimension // 2)
        for layer in range(int(coupling_layer_count)):
            order = torch.argsort(fixed_uniform((dimension,), seed, 101 + layer))
            self.register_buffer(f"permutation_{layer}", order)
            kept = torch.zeros(dimension)
            kept[:half] = 1.0 if layer % 2 == 0 else 0.0
            kept[half:] = 0.0 if layer % 2 == 0 else 1.0
            if dimension == 1:
                kept[:] = 0.0                  # one column: an affine map conditioned on the class alone
            self.normalisations.append(ActNorm(dimension))
            self.couplings.append(AffineCoupling(dimension, kept, embedding_size, hidden_size, layer_count, scale_limit))

    def permutation(self, layer: int) -> torch.Tensor:
        return getattr(self, f"permutation_{layer}")

    def forward(self, x: torch.Tensor, classes: torch.Tensor, initialise: bool = False) -> torch.Tensor:
        """log p(x | class) for each row."""
        embedding = self.class_embedding(classes)
        z = x
        log_determinant = torch.zeros(x.shape[0], dtype=x.dtype, device=x.device)
        for layer, (normalisation, coupling) in enumerate(zip(self.normalisations, self.couplings)):
            if initialise:
                normalisation.initialise(z)
            z, change = normalisation(z)
            log_determinant = log_determinant + change
            z = z[:, self.permutation(layer)]         # a permutation has |det| = 1
            z, change = coupling(z, embedding)
            log_determinant = log_determinant + change
        return standard_normal_log_density(z) + log_determinant

    def transform(self, x: torch.Tensor, classes: torch.Tensor) -> torch.Tensor:
        """f_k(x), the base-space point (for the change-of-variables test)."""
        embedding = self.class_embedding(classes)
        z = x
        for layer, (normalisation, coupling) in enumerate(zip(self.normalisations, self.couplings)):
            z, _ = normalisation(z)
            z = z[:, self.permutation(layer)]
            z, _ = coupling(z, embedding)
        return z


class NormalizingFlow(TorchDensity):
    def build(self) -> nn.Module:
        p = self.parameters
        return ConditionalRealNVP(self.dimension, self.class_count, int(p["embedding_size"]), int(p["hidden_size"]),
                                  int(p["layer_count"]), int(p["coupling_layer_count"]), float(p["scale_limit"]),
                                  self.seed)

    def prepare(self, network, x, y, context) -> None:
        with torch.no_grad():
            network(x, y, initialise=True)

    def loss(self, network, x, y):
        return -network(x, y).mean() / self.dimension

    def class_scores(self, network, x):
        return torch.stack([network(x, torch.full((x.shape[0],), k, dtype=torch.long, device=x.device))
                            for k in range(self.class_count)], dim=1)


# ─── FFJORD ────────────────────────────────────────────────────────────────


class ConditionalDynamics(nn.Module):
    """g(z, s, k): the velocity field of the continuous flow."""

    def __init__(self, dimension: int, class_count: int, embedding_size: int, hidden_size: int, layer_count: int) -> None:
        super().__init__()
        self.class_embedding = nn.Embedding(class_count, embedding_size)
        self.field = multilayer_perceptron(dimension + 1 + embedding_size, hidden_size, layer_count, dimension,
                                           activation="tanh")

    def forward(self, time: torch.Tensor, z: torch.Tensor, embedding: torch.Tensor) -> torch.Tensor:
        return self.field(torch.cat([z, time.to(z.dtype).reshape(1, 1).expand(z.shape[0], 1), embedding], dim=1))


def _exact_trace(dynamics: ConditionalDynamics, time: torch.Tensor, z: torch.Tensor, embedding: torch.Tensor) -> torch.Tensor:
    from torch.func import jacrev, vmap

    def one_row(row, row_embedding):
        return dynamics(time, row.unsqueeze(0), row_embedding.unsqueeze(0)).squeeze(0)

    jacobian = vmap(jacrev(one_row, argnums=0))(z, embedding)          # (n, d, d)
    return torch.diagonal(jacobian, dim1=1, dim2=2).sum(dim=1)


class ContinuousFlow(TorchDensity):
    def build(self) -> nn.Module:
        p = self.parameters
        return ConditionalDynamics(self.dimension, self.class_count, int(p["embedding_size"]), int(p["hidden_size"]),
                                   int(p["layer_count"]))

    @property
    def steps(self) -> int:
        return max(1, int(self.parameters["solver_steps"]))

    def log_density(self, network: ConditionalDynamics, x: torch.Tensor, classes: torch.Tensor, *, training: bool
                    ) -> tuple[torch.Tensor, torch.Tensor]:
        """(log p(x | class), the integrated kinetic energy) per row."""
        from torchdiffeq import odeint

        embedding = network.class_embedding(classes)
        estimator = str(self.parameters.get("training_trace_estimator", "hutchinson")) if training else "exact"
        probe = torch.randn_like(x) if estimator == "hutchinson" else None

        def velocity(time, state):
            z = state[0]
            with torch.enable_grad():
                if training:
                    if not z.requires_grad:
                        z = z.requires_grad_(True)
                else:
                    z = z.detach().requires_grad_(True)
                if estimator == "hutchinson":
                    dz = network(time, z, embedding)
                    product = torch.autograd.grad(dz, z, probe, create_graph=True)[0]
                    trace = (product * probe).sum(dim=1)
                else:
                    dz = network(time, z, embedding)
                    trace = _exact_trace(network, time, z, embedding)
            if not training:
                dz, trace = dz.detach(), trace.detach()
            return dz, trace, (dz ** 2).sum(dim=1)

        zero = torch.zeros(x.shape[0], dtype=x.dtype, device=x.device)
        times = torch.tensor([0.0, 1.0], dtype=x.dtype, device=x.device)
        z, trace, kinetic = odeint(velocity, (x, zero, zero), times, method="rk4",
                                   options={"step_size": 1.0 / self.steps})
        return standard_normal_log_density(z[-1]) + trace[-1], kinetic[-1]

    def loss(self, network, x, y):
        log_density, kinetic = self.log_density(network, x, y, training=True)
        return -log_density.mean() / self.dimension + float(self.parameters["kinetic_energy_weight"]) * kinetic.mean()

    def class_scores(self, network, x):
        scores = []
        for k in range(self.class_count):
            classes = torch.full((x.shape[0],), k, dtype=torch.long, device=x.device)
            scores.append(self.log_density(network, x, classes, training=False)[0])
        return torch.stack(scores, dim=1)

    @property
    def evaluations_per_row(self) -> int:
        return 4 * self.steps * max(1, self.dimension)


__all__ = ["ConditionalRealNVP", "ContinuousFlow", "NormalizingFlow"]
