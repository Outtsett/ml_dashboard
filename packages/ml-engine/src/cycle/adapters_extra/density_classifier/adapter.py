"""``DensityClassifierAdapter``: a generative model of the feature row, used through Bayes' rule.

The fit (training rows only):

1. standardise the causal feature row with the training rows' mean and
   spread, clipped at +/- 6;
2. cut the target into classes: K = 2 (the label: 0 down, 1 up) for the
   direction model, K train-quantile bins of the price target
   (``bridges.binning.TargetBins``, ``bin_count``) for the price model, and
   take the class priors from the training counts (+1 each);
3. fit the variant's density (``direction.fixed.variant``) on the labelled
   training rows — the energy-based model also reads the training span's
   unlabelled rows (``MarketView.fit_rows``) as real data for its generative
   term — epoch by epoch through ``bridges.training.run_epochs``, selecting
   the epoch on the validation rows (the validation negative log density of
   the true class, or the posterior log loss for the joint models, whose
   scores carry an unknown normaliser);
4. fit ONE inverse temperature on the validation rows (golden-section search
   of the multinomial log-likelihood; 1.0 when there are none) — the scores of
   a density ratio in 40 dimensions are over-confident, and a denoising
   surrogate has no natural scale at all.

The prediction at bar t reads row t of the feature matrix only:

    P(k | x_t) = softmax_k( inverse_temperature * score_k(x_t) + log prior_k )

(no prior term for a joint model), P(up) = P(1 | x_t), and the price forecast
is sum_k P(k | x_t) * the mean training target of bin k. Every kept score is
computed in float64 on the CPU from a copy of the trained network, so one row
scored alone equals the same row in a batch. A row with a missing feature
gets NaN.
"""

from __future__ import annotations

import importlib
import math
from dataclasses import replace
from pathlib import Path

import numpy as np

from cycle.bridges import persistence, training
from cycle.bridges.base import BridgeAdapter
from cycle.bridges.binning import TargetBins

FEATURE_CLIP = 6.0
GOLDEN_ITERATIONS = 120
MAXIMUM_STANDARDISED_INVERSE_TEMPERATURE = 50.0
MINIMUM_TRAINING_ROWS = 20

# variant -> (module, class) inside this package
VARIANTS: dict[str, tuple[str, str]] = {
    "normalizing_flow": ("flow", "NormalizingFlow"),
    "continuous_flow": ("flow", "ContinuousFlow"),
    "pixel_autoregressive": ("autoregressive", "AutoregressiveTokens"),
    "generative_transformer": ("autoregressive", "GenerativeTransformer"),
    "variational_autoencoder": ("latent", "VariationalAutoencoder"),
    "bayesian_mixture": ("latent", "BayesianMixture"),
    "masked_autoencoder": ("latent", "MaskedAutoencoder"),
    "joint_energy": ("energy", "JointEnergy"),
    "deep_boltzmann_machine": ("energy", "DeepBoltzmannMachine"),
    "diffusion": ("diffusion", "Diffusion"),
    "score_matching": ("diffusion", "ScoreMatching"),
    "perceptual_diffusion": ("diffusion", "PerceptualDiffusion"),
}
NUMPY_VARIANTS = ("bayesian_mixture",)


def density_class(variant: str):
    if variant not in VARIANTS:
        raise ValueError(f"unknown density variant {variant!r}; valid: {', '.join(VARIANTS)}")
    module_name, attribute = VARIANTS[variant]
    module = importlib.import_module(f"{__package__}.{module_name}")
    return getattr(module, attribute)


def softmax_rows(logits: np.ndarray) -> np.ndarray:
    shifted = logits - np.max(logits, axis=1, keepdims=True)
    weights = np.exp(shifted)
    return weights / weights.sum(axis=1, keepdims=True)


def class_log_likelihood(scores: np.ndarray, classes: np.ndarray, inverse_temperature: float,
                         offset: np.ndarray) -> float:
    """Mean log P(class | x) under softmax(inverse_temperature * scores + offset)."""
    logits = inverse_temperature * scores + offset
    peak = np.max(logits, axis=1, keepdims=True)
    log_normaliser = (peak + np.log(np.exp(logits - peak).sum(axis=1, keepdims=True))).ravel()
    return float(np.mean(logits[np.arange(classes.size), classes] - log_normaliser))


def fit_inverse_temperature(scores: np.ndarray, classes: np.ndarray, offset: np.ndarray) -> float:
    """The inverse temperature >= 0 that maximises the validation likelihood of the classes
    (the objective is concave in it, so a golden-section search finds the optimum; deterministic)."""
    scores = np.asarray(scores, dtype=np.float64)
    classes = np.asarray(classes, dtype=np.int64)
    keep = np.all(np.isfinite(scores), axis=1) & (classes >= 0)
    scores, classes = scores[keep], classes[keep]
    if classes.size == 0 or scores.shape[1] < 2:
        return 1.0
    centred = scores - scores.mean(axis=1, keepdims=True)
    spread = float(np.sqrt(np.mean(centred ** 2)))
    if not math.isfinite(spread) or spread < 1e-12:
        return 1.0
    low, high = 0.0, MAXIMUM_STANDARDISED_INVERSE_TEMPERATURE / spread
    ratio = (math.sqrt(5.0) - 1.0) / 2.0
    left, right = high - ratio * (high - low), low + ratio * (high - low)
    left_value = class_log_likelihood(scores, classes, left, offset)
    right_value = class_log_likelihood(scores, classes, right, offset)
    for _ in range(GOLDEN_ITERATIONS):
        if left_value >= right_value:
            high, right, right_value = right, left, left_value
            left = high - ratio * (high - low)
            left_value = class_log_likelihood(scores, classes, left, offset)
        else:
            low, left, left_value = left, right, right_value
            right = low + ratio * (high - low)
            right_value = class_log_likelihood(scores, classes, right, offset)
    return float(0.5 * (low + high))


class DensityClassifierAdapter(BridgeAdapter):
    model_file = "density.pt"

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in VARIANTS:
            raise ValueError(f"{key}: direction.fixed.variant {self.variant!r} is not a density variant "
                             f"({', '.join(VARIANTS)})")
        fixed = ((entry or {}).get("direction") or {}).get("fixed", {}) or {}
        self.settings = {name: value for name, value in fixed.items() if name != "variant"}
        self._reset_state()

    def _reset_state(self) -> None:
        self.step_unit = "single_fit" if self.variant in NUMPY_VARIANTS else "epoch"
        self.density = None
        self.scorer = None
        self.network_state: dict | None = None
        self.mean: np.ndarray | None = None
        self.scale: np.ndarray | None = None
        self.log_prior: np.ndarray | None = None
        self.bin_means: np.ndarray | None = None
        self.bin_edges: np.ndarray | None = None
        self.class_count = 2
        self.inverse_temperature = 1.0

    def minimum_history(self) -> int:
        return 1

    @property
    def density_parameters(self) -> dict:
        return {**self.parameters, **self.settings}

    @property
    def joint(self) -> bool:
        return bool(getattr(self.density, "joint", False))

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "torch", "torchdiffeq", "scikit-learn")

    # ── data ──
    def standardise(self, features: np.ndarray, rows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """(standardised rows, finite mask) of ``features[rows]``."""
        values = np.asarray(features[rows], dtype=np.float64).reshape(len(rows), np.shape(features)[1])
        finite = np.all(np.isfinite(values), axis=1)
        standardised = np.clip((values - self.mean) / self.scale, -FEATURE_CLIP, FEATURE_CLIP)
        standardised[~finite] = 0.0
        return standardised, finite

    def classes_of(self, target: np.ndarray) -> np.ndarray:
        target = np.asarray(target, dtype=np.float64)
        if self.task == "classification":
            classes = (target >= 0.5).astype(np.int64)
        else:
            # the bin of a target: QuantileBins.assign's rule on the stored training edges
            classes = np.searchsorted(self.bin_edges, target, side="right").astype(np.int64)
        classes[~np.isfinite(target)] = -1
        return classes

    # ── the fit ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        view = self.require_market()
        features = np.asarray(features)
        target = np.asarray(labels, dtype=np.float64)
        finite_rows = np.all(np.isfinite(np.asarray(features[train_index], dtype=np.float64)), axis=1)
        rows = train_index[finite_rows & np.isfinite(target[train_index])]
        if rows.size < MINIMUM_TRAINING_ROWS:
            raise ValueError(f"{self.key}: {rows.size} usable training rows; a density needs at least "
                             f"{MINIMUM_TRAINING_ROWS}")
        values = np.asarray(features[rows], dtype=np.float64)
        self.mean = values.mean(axis=0)
        scale = values.std(axis=0)
        self.scale = np.where(scale > 1e-6, scale, 1.0)
        if self.task == "classification":
            self.class_count = 2
            self.bin_edges = np.array([0.5])
            self.bin_means = np.array([0.0, 1.0])
        else:
            bins = TargetBins.fit(target, rows, int(self.parameters["bin_count"]))
            self.bin_edges = np.asarray(bins.bins.edges, dtype=np.float64)
            self.bin_means = np.asarray(bins.means, dtype=np.float64)
            self.class_count = bins.bins.bin_count
        classes = self.classes_of(target[rows])
        counts = np.bincount(classes, minlength=self.class_count).astype(np.float64)
        self.log_prior = np.log((counts + 1.0) / (counts.sum() + self.class_count))
        x_train, _ = self.standardise(features, rows)
        usable_validation = validation_index[np.isfinite(target[validation_index])] if validation_index.size else validation_index
        x_validation, finite_validation = self.standardise(features, usable_validation)
        usable_validation = usable_validation[finite_validation]
        x_validation = x_validation[finite_validation]
        validation_classes = self.classes_of(target[usable_validation])
        span = view.fit_rows(train_index)
        unlabelled_rows = span[~np.isfinite(target[span])]
        x_unlabelled, finite_unlabelled = self.standardise(features, unlabelled_rows)
        x_unlabelled = x_unlabelled[finite_unlabelled]
        reporter.log(f"{self.key}: {self.variant} density on {rows.size} training rows, {self.dimension_text(values)}, "
                     f"{self.class_count} classes (counts {', '.join(str(int(c)) for c in counts)}), "
                     f"{usable_validation.size} validation rows for the epoch choice and the temperature")
        self.density = density_class(self.variant)(values.shape[1], self.class_count, self.density_parameters, self.seed)
        if self.variant in NUMPY_VARIANTS:
            summary = self._fit_numpy(x_train, classes, x_validation, validation_classes, target[usable_validation],
                                      rows, reporter)
        else:
            summary = self._fit_torch(x_train, classes, x_validation, validation_classes, target[usable_validation],
                                      x_unlabelled, rows, reporter)
        final_scores = self.class_scores(x_validation) if x_validation.shape[0] else np.empty((0, self.class_count))
        self.inverse_temperature = fit_inverse_temperature(final_scores, validation_classes, self.offset) \
            if final_scores.shape[0] else 1.0
        reporter.log(f"{self.key}: validation inverse temperature {self.inverse_temperature:.6g}"
                     + (" (no validation rows: 1)" if not final_scores.shape[0] else ""))
        self.fit_summary = {
            "trained_epochs": summary.get("trained_epochs"), "best_epoch": summary.get("best_epoch"),
            "best_validation_loss": summary.get("best_validation_loss"), "fit_seconds": summary.get("fit_seconds"),
            "class_count": int(self.class_count), "class_counts": [int(c) for c in counts],
            "inverse_temperature": float(self.inverse_temperature), "joint_density": self.joint,
            "unlabelled_row_count": int(x_unlabelled.shape[0]),
        }
        self.best_iteration = summary.get("best_epoch")

    @staticmethod
    def dimension_text(values: np.ndarray) -> str:
        return f"{values.shape[1]} feature columns"

    @property
    def offset(self) -> np.ndarray:
        return np.zeros(self.class_count) if self.joint else np.asarray(self.log_prior, dtype=np.float64)

    def _validation_score(self, scores: np.ndarray, classes: np.ndarray, target: np.ndarray) -> training.ValidationScore:
        inverse_temperature = fit_inverse_temperature(scores, classes, self.offset)
        posterior = softmax_rows(inverse_temperature * scores + self.offset)
        prediction = posterior[:, 1] if self.task == "classification" else posterior @ self.bin_means
        result = training.score(self.task, prediction, target)
        known = classes >= 0
        if not known.any():
            return result
        if getattr(self.density, "selection", "density") == "posterior":
            selection = -float(np.mean(np.log(np.clip(posterior[known, classes[known]], 1e-12, 1.0))))
        else:
            selection = -float(np.mean(scores[known, classes[known]])) / max(1, self.density.dimension)
        return replace(result, selection=selection)

    def _fit_numpy(self, x_train, classes, x_validation, validation_classes, validation_target, rows, reporter) -> dict:
        def fit_once():
            self.density.fit(x_train, classes, lambda message: reporter.log(f"{self.key}: {message}"))
            scores = self.density.class_scores(x_train)
            return -float(np.mean(scores[np.arange(classes.size), classes])) / x_train.shape[1]

        def validate():
            return self._validation_score(self.density.class_scores(x_validation), validation_classes, validation_target)

        return training.single_fit(reporter, train_index=rows, fit=fit_once,
                                   validate=validate if x_validation.shape[0] else None, name=self.key)

    def _fit_torch(self, x_train, classes, x_validation, validation_classes, validation_target, x_unlabelled, rows,
                   reporter) -> dict:
        import torch

        from .common import TrainingContext, resolve_device, scoring_copy, state_snapshot, to_numpy

        device = resolve_device(self.device)
        forked = [torch.cuda.current_device()] if device == "cuda" else []
        with torch.random.fork_rng(devices=forked):
            torch.manual_seed(self.seed)
            train_x = torch.as_tensor(x_train, dtype=torch.float32, device=device)
            train_y = torch.as_tensor(classes, dtype=torch.long, device=device)
            validation_x = torch.as_tensor(x_validation, dtype=torch.float32, device=device)
            context = TrainingContext(
                train_start_row=int(rows[0]), train_end_row=int(rows[-1]),
                unlabelled=torch.as_tensor(x_unlabelled, dtype=torch.float32, device=device) if x_unlabelled.shape[0] else None,
                log=lambda message: reporter.log(f"{self.key}: {message}"), checkpoint=reporter.checkpoint)
            network = self.density.build().to(device)
            self.density.prepare(network, train_x, train_y, context)
            optimizer = self.density.make_optimizer(network)

            def train_epoch(epoch, report_batch):
                network.train()
                return self.density.train_epoch(network, optimizer, train_x, train_y, epoch, report_batch, context)

            def validate(epoch):
                network.eval()
                with torch.no_grad():
                    scores = to_numpy(self.density.score_rows(network, validation_x, self.density.evaluations_per_row))
                return self._validation_score(scores, validation_classes, validation_target)

            summary = training.run_epochs(
                reporter, epoch_count=self.density.epoch_count, train_index=rows, train_epoch=train_epoch,
                validate=validate if x_validation.shape[0] else None, snapshot=lambda: state_snapshot(network),
                restore=network.load_state_dict, patience=int(self.parameters.get("patience", 0)) or None,
                step_unit=self.step_unit, name=self.key)
        network.eval()
        self.network_state = {name: value.detach().to("cpu").clone() for name, value in network.state_dict().items()}
        self.scorer = scoring_copy(network)
        return summary

    # ── scoring ──
    def class_scores(self, x: np.ndarray) -> np.ndarray:
        """(n, K) float64 class scores of standardised rows (the kept, float64 path)."""
        if x.shape[0] == 0:
            return np.empty((0, self.class_count))
        if self.variant in NUMPY_VARIANTS:
            return np.asarray(self.density.class_scores(x), dtype=np.float64)
        import torch

        with torch.no_grad():
            scores = self.density.score_rows(self.scorer, torch.as_tensor(x, dtype=torch.float64),
                                             self.density.evaluations_per_row)
        return scores.detach().numpy().astype(np.float64)

    def posterior(self, features, index) -> np.ndarray:
        rows = np.asarray(index, dtype=np.int64)
        x, finite = self.standardise(features, rows)
        out = np.full((rows.size, self.class_count), np.nan)
        if finite.any():
            scores = self.class_scores(x[finite])
            out[finite] = softmax_rows(self.inverse_temperature * scores + self.offset)
        return out

    def _predict_probability(self, features, index) -> np.ndarray:
        return self.posterior(features, index)[:, 1]

    def _predict_value(self, features, index) -> np.ndarray:
        return self.posterior(features, index) @ np.asarray(self.bin_means, dtype=np.float64)

    # ── save / load ──
    def _save_state(self, folder: Path) -> str:
        persistence.save_arrays(folder / "adapter.npz", mean=self.mean, scale=self.scale, log_prior=self.log_prior,
                                bin_means=self.bin_means, bin_edges=self.bin_edges)
        persistence.save_json(folder / "density.json", {
            "variant": self.variant, "settings": self.settings, "class_count": int(self.class_count),
            "dimension": int(self.mean.shape[0]), "inverse_temperature": float(self.inverse_temperature),
        })
        if self.variant in NUMPY_VARIANTS:
            persistence.save_arrays(folder / "density.npz", **self.density.to_arrays())
            return "density.npz"
        persistence.save_torch(folder / "density.pt", {"network": self.network_state})
        return "density.pt"

    def _load_state(self, folder: Path, metadata: dict) -> None:
        document = persistence.load_json(folder / "density.json")
        self.settings = dict(document.get("settings") or {})
        self._reset_state()
        arrays = persistence.load_arrays(folder / "adapter.npz")
        self.mean, self.scale = arrays["mean"], arrays["scale"]
        self.log_prior, self.bin_means, self.bin_edges = arrays["log_prior"], arrays["bin_means"], arrays["bin_edges"]
        self.class_count = int(document["class_count"])
        self.inverse_temperature = float(document["inverse_temperature"])
        self.density = density_class(self.variant)(int(document["dimension"]), self.class_count,
                                                   self.density_parameters, self.seed)
        if self.variant in NUMPY_VARIANTS:
            self.density.from_arrays(persistence.load_arrays(folder / "density.npz"))
            return
        import torch

        from .common import scoring_copy

        with torch.random.fork_rng(devices=[]):
            network = self.density.build()
        self.network_state = persistence.load_torch(folder / "density.pt")["network"]
        network.load_state_dict(self.network_state)
        self.scorer = scoring_copy(network)


__all__ = ["DensityClassifierAdapter", "VARIANTS", "fit_inverse_temperature", "softmax_rows"]
