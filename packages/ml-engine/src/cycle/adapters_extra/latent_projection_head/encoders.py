"""The label-free encoders the head reads, and what they share.

Every encoder here is fitted on feature rows only (``fit(train_matrix,
validation_matrix, ...)``: the finite rows of the fold's training span and,
for early stopping, the validation rows' features). None of them is handed a
label or a price target: ``tests/test_cycle_bridge_latent_projection_head.py``
fits each twice with different labels and requires identical encoder state.

``transform(matrix)`` maps rows to codes and is row-independent: a row's code
depends on that row (and the frozen fit) only, so one row alone and the same
row inside a batch give the same code. Where a library's own batch transform
is not row-independent (UMAP's transform optimises a batch together; sklearn's
NMF initialises from the batch mean) the rows are transformed one at a time or
solved exactly here.

This module holds the linear decompositions (PCA, FastICA, NMF) and the
manifold learners (Isomap / LLE, UMAP, openTSNE); the torch encoders are in
``networks.py``.
"""

from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np

from cycle.bridges import persistence

ENCODER_FILE = "encoder.npz"
ESTIMATOR_FILE = "encoder_estimator.joblib"


class Standardiser:
    """z = (x - mean) / scale with the TRAINING rows' mean and deviation."""

    def __init__(self, mean: np.ndarray, scale: np.ndarray) -> None:
        self.mean = np.asarray(mean, dtype=np.float64)
        self.scale = np.asarray(scale, dtype=np.float64)

    @classmethod
    def fit(cls, matrix: np.ndarray) -> Standardiser:
        matrix = np.asarray(matrix, dtype=np.float64)
        scale = matrix.std(axis=0)
        return cls(matrix.mean(axis=0), np.where(scale > 1e-12, scale, 1.0))

    def apply(self, matrix: np.ndarray) -> np.ndarray:
        return (np.asarray(matrix, dtype=np.float64) - self.mean) / self.scale


def evenly_spaced(count: int, limit: int) -> np.ndarray:
    """``limit`` positions spread evenly over ``range(count)`` (all when count <= limit)."""
    if count <= limit:
        return np.arange(count, dtype=np.int64)
    return np.unique(np.linspace(0, count - 1, int(limit)).round().astype(np.int64))


def _bounded_components(requested: int, feature_count: int, row_count: int) -> int:
    return int(max(1, min(int(requested), int(feature_count), max(1, int(row_count) - 1))))


class Encoder:
    """Base: a label-free map from a feature row to a latent code."""

    name = ""
    epoch_trained = False
    validation_limit: int | None = None

    def training_codes(self) -> tuple[np.ndarray, np.ndarray] | None:
        """The fitted coordinates of the fit rows when the method has its own (a manifold's embedding)."""
        return None

    def __init__(self, parameters: dict, seed: int) -> None:
        self.parameters = dict(parameters)
        self.seed = int(seed)
        self.standardiser: Standardiser | None = None
        self.notes: list[str] = []

    @property
    def code_size(self) -> int:
        raise NotImplementedError

    def fit(self, train_matrix: np.ndarray, validation_matrix: np.ndarray) -> dict:
        raise NotImplementedError

    def transform(self, matrix: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    def state_arrays(self) -> dict[str, np.ndarray]:
        """Everything the fit learned, as arrays (the label-blindness test compares these)."""
        raise NotImplementedError

    def save(self, folder: Path) -> None:
        persistence.save_arrays(folder / ENCODER_FILE, **self.state_arrays())

    def restore(self, folder: Path) -> None:
        raise NotImplementedError

    # a reconstruction error per row (features only), reported as the fit's train loss
    def reconstruction_error(self, matrix: np.ndarray) -> float | None:
        return None


# ─── linear decompositions ─────────────────────────────────────────────────


class PrincipalComponents(Encoder):
    """sklearn PCA (full SVD of the covariance) on train-standardised rows; the
    code is W'(z - mean), divided by the component deviations when whitened."""

    name = "pca"

    def __init__(self, parameters: dict, seed: int) -> None:
        super().__init__(parameters, seed)
        self.center = self.components = self.deviations = None
        self.whiten = bool(parameters.get("whiten_components", False))

    @property
    def code_size(self) -> int:
        return int(self.components.shape[0])

    def fit(self, train_matrix, validation_matrix) -> dict:
        from sklearn.decomposition import PCA

        self.standardiser = Standardiser.fit(train_matrix)
        standard = self.standardiser.apply(train_matrix)
        count = _bounded_components(self.parameters["component_count"], standard.shape[1], standard.shape[0])
        model = PCA(n_components=count, svd_solver="full").fit(standard)
        self.center = model.mean_.astype(np.float64)
        self.components = model.components_.astype(np.float64)
        self.deviations = np.sqrt(np.maximum(model.explained_variance_, 1e-12)).astype(np.float64)
        explained = float(np.sum(model.explained_variance_ratio_))
        return {"component_count": count, "explained_variance_share": explained}

    def transform(self, matrix) -> np.ndarray:
        codes = (self.standardiser.apply(matrix) - self.center) @ self.components.T
        return codes / self.deviations if self.whiten else codes

    def reconstruction_error(self, matrix) -> float:
        standard = self.standardiser.apply(matrix)
        codes = (standard - self.center) @ self.components.T
        rebuilt = codes @ self.components + self.center
        return float(np.mean((standard - rebuilt) ** 2))

    def state_arrays(self):
        return {"mean": self.standardiser.mean, "scale": self.standardiser.scale, "center": self.center,
                "components": self.components, "deviations": self.deviations}

    def restore(self, folder):
        arrays = persistence.load_arrays(folder / ENCODER_FILE)
        self.standardiser = Standardiser(arrays["mean"], arrays["scale"])
        self.center, self.components, self.deviations = arrays["center"], arrays["components"], arrays["deviations"]


class IndependentComponents(Encoder):
    """sklearn FastICA (fixed-point negentropy iteration with the chosen
    contrast function, unit-variance whitening) on train-standardised rows; the
    code is the unmixed sources s = W(z - mean), a fixed linear map."""

    name = "fast_ica"

    def __init__(self, parameters: dict, seed: int) -> None:
        super().__init__(parameters, seed)
        self.center = self.unmixing = self.mixing = None

    @property
    def code_size(self) -> int:
        return int(self.unmixing.shape[0])

    def fit(self, train_matrix, validation_matrix) -> dict:
        from sklearn.decomposition import FastICA
        from sklearn.exceptions import ConvergenceWarning

        self.standardiser = Standardiser.fit(train_matrix)
        standard = self.standardiser.apply(train_matrix)
        count = _bounded_components(self.parameters["component_count"], standard.shape[1], standard.shape[0])
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always", ConvergenceWarning)
            model = FastICA(n_components=count, fun=str(self.parameters["contrast_function"]),
                            max_iter=int(self.parameters["iteration_count"]), whiten="unit-variance",
                            random_state=self.seed, tol=1e-4).fit(standard)
        converged = not any(issubclass(item.category, ConvergenceWarning) for item in caught)
        if not converged:
            self.notes.append(f"FastICA did not converge in {int(self.parameters['iteration_count'])} iterations; "
                              "the last unmixing matrix is used")
        self.center = model.mean_.astype(np.float64)
        self.unmixing = model.components_.astype(np.float64)
        self.mixing = model.mixing_.astype(np.float64)
        return {"component_count": count, "solver_iterations": int(model.n_iter_), "converged": converged}

    def transform(self, matrix) -> np.ndarray:
        return (self.standardiser.apply(matrix) - self.center) @ self.unmixing.T

    def reconstruction_error(self, matrix) -> float:
        standard = self.standardiser.apply(matrix)
        rebuilt = self.transform(matrix) @ self.mixing.T + self.center
        return float(np.mean((standard - rebuilt) ** 2))

    def state_arrays(self):
        return {"mean": self.standardiser.mean, "scale": self.standardiser.scale, "center": self.center,
                "unmixing": self.unmixing, "mixing": self.mixing}

    def restore(self, folder):
        arrays = persistence.load_arrays(folder / ENCODER_FILE)
        self.standardiser = Standardiser(arrays["mean"], arrays["scale"])
        self.center, self.unmixing, self.mixing = arrays["center"], arrays["unmixing"], arrays["mixing"]


class NonNegativeFactorisation(Encoder):
    """sklearn NMF (coordinate descent, NNDSVDa start) factorising the shifted
    training rows X ~ W H. The features are signed z-scores, so each column is
    shifted by a constant fixed on the training rows (minus its training
    minimum) and a later value below that minimum is clipped to 0. The parts H
    are frozen; a bar's code is its activation w = argmin_{w >= 0} ||x - w H||,
    solved exactly per row (scipy's NNLS), which is NMF.transform's objective
    without the batch-dependent start."""

    name = "nmf"

    def __init__(self, parameters: dict, seed: int) -> None:
        super().__init__(parameters, seed)
        self.shift = self.parts = None

    @property
    def code_size(self) -> int:
        return int(self.parts.shape[0])

    def _shifted(self, matrix) -> np.ndarray:
        return np.maximum(np.asarray(matrix, dtype=np.float64) + self.shift, 0.0)

    def fit(self, train_matrix, validation_matrix) -> dict:
        from sklearn.decomposition import NMF
        from sklearn.exceptions import ConvergenceWarning

        train_matrix = np.asarray(train_matrix, dtype=np.float64)
        self.shift = -train_matrix.min(axis=0)
        shifted = self._shifted(train_matrix)
        count = _bounded_components(self.parameters["component_count"], shifted.shape[1], shifted.shape[0])
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always", ConvergenceWarning)
            model = NMF(n_components=count, init="nndsvda", solver="cd", max_iter=int(self.parameters["iteration_count"]),
                        random_state=self.seed).fit(shifted)
        converged = not any(issubclass(item.category, ConvergenceWarning) for item in caught)
        if not converged:
            self.notes.append(f"NMF did not converge in {int(self.parameters['iteration_count'])} iterations")
        self.parts = model.components_.astype(np.float64)
        return {"component_count": count, "solver_iterations": int(model.n_iter_),
                "reconstruction_error": float(model.reconstruction_err_), "converged": converged}

    def transform(self, matrix) -> np.ndarray:
        from scipy.optimize import nnls

        shifted = self._shifted(matrix)
        codes = np.full((shifted.shape[0], self.parts.shape[0]), np.nan, dtype=np.float64)
        basis = self.parts.T
        for position in range(shifted.shape[0]):
            row = shifted[position]
            if np.all(np.isfinite(row)):
                codes[position], _ = nnls(basis, row)
        return codes

    def reconstruction_error(self, matrix) -> float:
        shifted = self._shifted(matrix)
        return float(np.mean((shifted - self.transform(matrix) @ self.parts) ** 2))

    def state_arrays(self):
        return {"shift": self.shift, "parts": self.parts}

    def restore(self, folder):
        arrays = persistence.load_arrays(folder / ENCODER_FILE)
        self.shift, self.parts = arrays["shift"], arrays["parts"]


# ─── manifold learners (fitted on an evenly spaced subsample of the span) ────


class _EstimatorEncoder(Encoder):
    """An encoder whose fitted state is a library object (saved with joblib)."""

    #: validation bars the fit report scores (the per-bar placement is the slow part)
    validation_limit = 300

    def __init__(self, parameters: dict, seed: int) -> None:
        super().__init__(parameters, seed)
        self.estimator = None
        self.fit_rows = 0
        self.sample_positions: np.ndarray | None = None

    def _subsample(self, train_matrix) -> np.ndarray:
        train_matrix = np.asarray(train_matrix, dtype=np.float64)
        keep = evenly_spaced(train_matrix.shape[0], int(self.parameters["maximum_training_bars"]))
        self.fit_rows = int(keep.size)
        self.sample_positions = keep
        return train_matrix[keep]

    def training_codes(self) -> tuple[np.ndarray, np.ndarray]:
        """(positions in the fit matrix, their fitted coordinates): the head learns
        from the map itself, and later bars are placed into that map."""
        return self.sample_positions, self._embedding()

    def save(self, folder: Path) -> None:
        persistence.save_arrays(folder / ENCODER_FILE, mean=self.standardiser.mean, scale=self.standardiser.scale)
        persistence.save_joblib(folder / ESTIMATOR_FILE, self.estimator)

    def restore(self, folder):
        arrays = persistence.load_arrays(folder / ENCODER_FILE)
        self.standardiser = Standardiser(arrays["mean"], arrays["scale"])
        self.estimator = persistence.load_joblib(folder / ESTIMATOR_FILE)

    def _embedding(self) -> np.ndarray:
        raise NotImplementedError

    def state_arrays(self):
        return {"mean": self.standardiser.mean, "scale": self.standardiser.scale, "embedding": self._embedding()}

    def _per_row(self, matrix, transform_one) -> np.ndarray:
        standard = self.standardiser.apply(matrix)
        codes = np.full((standard.shape[0], self.code_size), np.nan, dtype=np.float64)
        for position in range(standard.shape[0]):
            row = standard[position: position + 1]
            if np.all(np.isfinite(row)):
                codes[position] = np.asarray(transform_one(row), dtype=np.float64).reshape(-1)
        return codes


class ManifoldEmbedding(_EstimatorEncoder):
    """Isomap (k-nearest-neighbour graph, geodesic shortest paths, kernel MDS)
    or locally linear embedding (reconstruction weights, bottom eigenvectors),
    both scikit-learn with the dense eigen-solver (deterministic), fitted on an
    evenly spaced subsample of the training span. A later bar is placed by the
    estimator's own out-of-sample map against the fitted points only (its
    geodesics through its nearest fitted neighbours / its barycentric weights)."""

    name = "isomap_lle"

    @property
    def code_size(self) -> int:
        return int(self._embedding().shape[1])

    def _embedding(self):
        return np.asarray(self.estimator.embedding_, dtype=np.float64)

    def fit(self, train_matrix, validation_matrix) -> dict:
        from sklearn.manifold import Isomap, LocallyLinearEmbedding

        self.standardiser = Standardiser.fit(train_matrix)
        sample = self.standardiser.apply(self._subsample(train_matrix))
        count = _bounded_components(self.parameters["component_count"], sample.shape[1], sample.shape[0])
        neighbours = int(min(int(self.parameters["neighbor_count"]), sample.shape[0] - 1))
        method = str(self.parameters["manifold_method"])
        if method == "isomap":
            self.estimator = Isomap(n_neighbors=neighbours, n_components=count, eigen_solver="dense").fit(sample)
            error = float(self.estimator.reconstruction_error())
        else:
            self.estimator = LocallyLinearEmbedding(n_neighbors=neighbours, n_components=count, eigen_solver="dense",
                                                    method="standard", random_state=self.seed).fit(sample)
            error = float(self.estimator.reconstruction_error_)
        return {"manifold_method": method, "component_count": count, "fit_row_count": self.fit_rows,
                "embedding_error": error}

    def transform(self, matrix) -> np.ndarray:
        return self._per_row(matrix, self.estimator.transform)


class UniformManifoldProjection(_EstimatorEncoder):
    """umap-learn: a fuzzy simplicial set from the k-nearest-neighbour graph of
    an evenly spaced training subsample, laid out by stochastic cross-entropy
    optimisation (fixed random_state, one thread: deterministic). A later bar is
    placed by ``UMAP.transform`` against the frozen layout, one bar per call:
    UMAP's transform optimises a batch together and prunes edges by the batch's
    largest weight, so a batch would move each bar's coordinates."""

    name = "umap"

    @property
    def code_size(self) -> int:
        return int(self._embedding().shape[1])

    def _embedding(self):
        return np.asarray(self.estimator.embedding_, dtype=np.float64)

    def fit(self, train_matrix, validation_matrix) -> dict:
        import umap

        self.standardiser = Standardiser.fit(train_matrix)
        sample = self.standardiser.apply(self._subsample(train_matrix))
        count = _bounded_components(self.parameters["component_count"], sample.shape[1], sample.shape[0])
        neighbours = int(max(2, min(int(self.parameters["neighbor_count"]), sample.shape[0] - 1)))
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            self.estimator = umap.UMAP(n_neighbors=neighbours, n_components=count,
                                       min_dist=float(self.parameters["minimum_distance"]), metric="euclidean",
                                       random_state=self.seed, n_jobs=1, n_epochs=200, low_memory=True,
                                       transform_seed=self.seed).fit(sample)
        return {"component_count": count, "neighbor_count": neighbours, "fit_row_count": self.fit_rows}

    def transform(self, matrix) -> np.ndarray:
        import numba

        def one(row):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                return self.estimator.transform(row)

        # one bar per call: numba's thread pool only adds synchronisation (and stalls on a busy machine)
        threads = numba.get_num_threads()
        numba.set_num_threads(1)
        try:
            return self._per_row(matrix, one)
        finally:
            numba.set_num_threads(threads)


class StochasticNeighbourEmbedding(_EstimatorEncoder):
    """openTSNE: t-SNE (perplexity-calibrated affinities, early exaggeration,
    FFT-interpolated gradients in 2-D, Barnes-Hut in 3-D) on an evenly spaced
    training subsample, minimising KL(P || Q). t-SNE has no native
    out-of-sample map; ``TSNEEmbedding.transform`` places a later bar by
    optimising only that bar against the frozen embedding (its affinities to
    the fitted points, median-of-neighbours start), one bar per call."""

    name = "open_tsne"

    @property
    def code_size(self) -> int:
        return int(self._embedding().shape[1])

    def _embedding(self):
        return np.asarray(self.estimator, dtype=np.float64)

    def fit(self, train_matrix, validation_matrix) -> dict:
        from openTSNE import TSNE

        self.standardiser = Standardiser.fit(train_matrix)
        sample = self.standardiser.apply(self._subsample(train_matrix))
        count = int(min(3, max(1, int(self.parameters["component_count"]))))
        perplexity = float(min(float(self.parameters["perplexity"]), max(2.0, (sample.shape[0] - 1) / 3.0)))
        method = "fft" if count <= 2 else "bh"
        self.estimator = TSNE(n_components=count, perplexity=perplexity, random_state=self.seed, n_jobs=1,
                              negative_gradient_method=method, verbose=False).fit(sample)
        return {"component_count": count, "perplexity": perplexity, "fit_row_count": self.fit_rows,
                "kl_divergence": float(self.estimator.kl_divergence)}

    def transform(self, matrix) -> np.ndarray:
        iterations = int(self.parameters["placement_iterations"])
        return self._per_row(matrix, lambda row: self.estimator.transform(row, n_iter=iterations))


LINEAR_AND_MANIFOLD = {
    "pca": PrincipalComponents,
    "fast_ica": IndependentComponents,
    "nmf": NonNegativeFactorisation,
    "isomap_lle": ManifoldEmbedding,
    "umap": UniformManifoldProjection,
    "open_tsne": StochasticNeighbourEmbedding,
}

__all__ = ["ENCODER_FILE", "Encoder", "LINEAR_AND_MANIFOLD", "Standardiser", "evenly_spaced"]
