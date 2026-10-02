"""Anomaly detectors as state models: isolation forest, local outlier factor, one-class SVM, robust covariance.

Each detector is fitted by scikit-learn on the standardised training rows and
scores a bar by its own rule, re-implemented here in numpy from the fitted
detector's arrays (so a saved model is plain arrays, and a single row scores
without scikit-learn's per-call overhead); the family tests check every score
against scikit-learn's own ``score_samples`` / ``decision_function``.

- isolation forest: the mean path length of the bar through random isolation
  trees, as the anomaly score 2^(-E[h(x)] / c(max_samples)) (negated, as
  scikit-learn's ``score_samples``: lower is more abnormal);
- local outlier factor (novelty mode): the bar's local reachability density
  against its ``neighbor_count`` nearest fitted rows, over theirs (negated);
- one-class SVM: sum_i alpha_i K(x_i, x) - rho with an RBF kernel (higher is
  more normal);
- robust covariance: the squared Mahalanobis distance to the minimum
  covariance determinant location and scatter (higher is more abnormal).

**States.** The score has no direction, so the states are the training
quantile bins of the score (``bin_count`` of them). With
``principal_axis_split`` each bin is split in two by the side of the training
median along the training rows' first principal axis — an unsupervised
half-space, oriented by the data, never by a label — so the readout can learn
that abnormal bars on one side of the centre were followed by different moves
than abnormal bars on the other. Without the split P(up) is what followed each
score bin, which sits near the base rate.
"""

from __future__ import annotations

import warnings

import numpy as np

from cycle.bridges.binning import QuantileBins

from .common import Projection, one_hot, single_thread, spread_rows, squared_distances
from .state_model import FitContext, StateModel, occupancy


def _average_path_length(counts: np.ndarray) -> np.ndarray:
    """c(n): the average path length of an unsuccessful binary-search-tree search (Liu et al. 2008)."""
    counts = np.asarray(counts, dtype=np.float64)
    out = np.zeros(counts.shape)
    out[counts == 2] = 1.0
    large = counts > 2
    out[large] = 2.0 * (np.log(counts[large] - 1.0) + np.euler_gamma) - 2.0 * (counts[large] - 1.0) / counts[large]
    return out


class AnomalyStates(StateModel):
    """Shared: score -> quantile bins (x half-space) -> one-hot states."""

    def _score(self, space: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    def _fit_detector(self, space: np.ndarray, context: FitContext) -> None:
        raise NotImplementedError

    def _detector_arrays(self) -> dict[str, np.ndarray]:
        raise NotImplementedError

    def _detector_restore(self, arrays: dict[str, np.ndarray]) -> None:
        raise NotImplementedError

    def fit(self, space: np.ndarray, context: FitContext) -> None:
        self._fit_detector(space, context)
        scores = self._score(space)
        self.bins = QuantileBins.fit(scores, int(self.parameters["bin_count"]))
        self.split = bool(self.parameters["principal_axis_split"])
        axis = Projection.fit(space, 1)
        self.axis = axis.components[0] if axis.components.shape[0] else np.zeros(space.shape[1])
        side = space @ self.axis
        self.axis_median = float(np.median(side)) if side.size else 0.0
        self._codes = self._codes_of(space, scores)

    def _codes_of(self, space: np.ndarray, scores: np.ndarray) -> np.ndarray:
        codes = self.bins.assign(scores)
        if self.split:
            side = (space @ self.axis > self.axis_median).astype(np.int64)
            codes = np.where(codes >= 0, codes * 2 + side, -1)
        return codes

    @property
    def state_count(self) -> int:
        return self.bins.bin_count * (2 if self.split else 1)

    def responsibilities(self, space: np.ndarray) -> np.ndarray:
        return one_hot(self._codes_of(space, self._score(space)), self.state_count)

    def score(self, space: np.ndarray) -> np.ndarray:
        """The detector's score of standardised rows (for tests and diagnostics)."""
        return self._score(space)

    def arrays(self) -> dict[str, np.ndarray]:
        return {**self._detector_arrays(), "bin_edges": self.bins.edges, "split": np.asarray(self.split),
                "axis": self.axis, "axis_median": np.asarray(self.axis_median)}

    def restore(self, arrays: dict[str, np.ndarray]) -> None:
        self._detector_restore(arrays)
        self.bins = QuantileBins(np.asarray(arrays["bin_edges"], dtype=np.float64))
        self.split = bool(arrays["split"])
        self.axis = np.asarray(arrays["axis"], dtype=np.float64)
        self.axis_median = float(arrays["axis_median"])

    def describe(self) -> str:
        split = " x 2 sides of the first principal axis" if self.split else ""
        return (f"{self.detector_name}: {self.bins.bin_count} score bins{split} = {self.state_count} states, training rows "
                f"per state {occupancy(self._codes, self.state_count)}")


class IsolationForestStates(AnomalyStates):
    variant = "isolation_forest"
    detector_name = "isolation forest"

    def _fit_detector(self, space: np.ndarray, context: FitContext) -> None:
        from sklearn.ensemble import IsolationForest

        samples = max(2, min(int(self.parameters["samples_per_tree"]), space.shape[0]))
        with single_thread():
            model = IsolationForest(n_estimators=int(self.parameters["tree_count"]), max_samples=samples,
                                    random_state=self.seed, n_jobs=1).fit(space)
        self.model_for_tests = model
        lefts, rights, features, thresholds, values, roots = [], [], [], [], [], []
        offset = 0
        for tree, columns in zip(model.estimators_, model.estimators_features_):
            structure = tree.tree_
            count = structure.node_count
            left = np.asarray(structure.children_left, dtype=np.int64)
            right = np.asarray(structure.children_right, dtype=np.int64)
            leaf = left < 0
            lefts.append(np.where(leaf, -1, left + offset))
            rights.append(np.where(leaf, -1, right + offset))
            feature = np.asarray(structure.feature, dtype=np.int64)
            features.append(np.where(leaf, -1, np.asarray(columns, dtype=np.int64)[np.maximum(feature, 0)]))
            thresholds.append(np.asarray(structure.threshold, dtype=np.float64))
            depth = np.asarray(structure.compute_node_depths(), dtype=np.float64)
            values.append(np.where(leaf, depth + _average_path_length(structure.n_node_samples) - 1.0, 0.0))
            roots.append(offset)
            offset += count
        self.left = np.concatenate(lefts)
        self.right = np.concatenate(rights)
        self.feature = np.concatenate(features)
        self.threshold = np.concatenate(thresholds)
        self.leaf_value = np.concatenate(values)
        self.roots = np.asarray(roots, dtype=np.int64)
        self.denominator = float(len(model.estimators_) * _average_path_length(np.asarray([model.max_samples_]))[0])

    def _score(self, space: np.ndarray) -> np.ndarray:
        # scikit-learn's trees compare float32 inputs against float64 thresholds
        points = np.asarray(space, dtype=np.float32).astype(np.float64)
        depth = np.zeros(points.shape[0])
        rows = np.arange(points.shape[0])
        for root in self.roots:
            node = np.full(points.shape[0], root, dtype=np.int64)
            active = self.left[node] >= 0
            while active.any():
                where = np.flatnonzero(active)
                current = node[where]
                go_left = points[rows[where], self.feature[current]] <= self.threshold[current]
                node[where] = np.where(go_left, self.left[current], self.right[current])
                active = self.left[node] >= 0
            depth += self.leaf_value[node]
        if self.denominator <= 0:
            return -np.ones(points.shape[0])
        return -(2.0 ** (-depth / self.denominator))

    def _detector_arrays(self) -> dict[str, np.ndarray]:
        return {"left": self.left, "right": self.right, "feature": self.feature, "threshold": self.threshold,
                "leaf_value": self.leaf_value, "roots": self.roots, "denominator": np.asarray(self.denominator)}

    def _detector_restore(self, arrays: dict[str, np.ndarray]) -> None:
        self.left = np.asarray(arrays["left"], dtype=np.int64)
        self.right = np.asarray(arrays["right"], dtype=np.int64)
        self.feature = np.asarray(arrays["feature"], dtype=np.int64)
        self.threshold = np.asarray(arrays["threshold"], dtype=np.float64)
        self.leaf_value = np.asarray(arrays["leaf_value"], dtype=np.float64)
        self.roots = np.asarray(arrays["roots"], dtype=np.int64)
        self.denominator = float(arrays["denominator"])


class LocalOutlierStates(AnomalyStates):
    variant = "local_outlier_factor"
    detector_name = "local outlier factor"

    def _fit_detector(self, space: np.ndarray, context: FitContext) -> None:
        from sklearn.neighbors import LocalOutlierFactor

        sample = np.asarray(space[spread_rows(np.arange(space.shape[0]), int(self.parameters["maximum_fit_rows"]))],
                            dtype=np.float64)
        neighbours = max(1, min(int(self.parameters["neighbor_count"]), sample.shape[0] - 1))
        with single_thread():
            model = LocalOutlierFactor(n_neighbors=neighbours, novelty=True, algorithm="brute", n_jobs=1).fit(sample)
        self.model_for_tests = model
        self.references = sample
        self.k_distance = np.asarray(model._distances_fit_X_[:, model.n_neighbors_ - 1], dtype=np.float64)
        self.reachability_density = np.asarray(model._lrd, dtype=np.float64)
        self.neighbour_count = int(model.n_neighbors_)

    def _score(self, space: np.ndarray) -> np.ndarray:
        distance = np.sqrt(squared_distances(space, self.references))
        order = np.argsort(distance, axis=1, kind="stable")[:, : self.neighbour_count]
        near = np.take_along_axis(distance, order, axis=1)
        reach = np.maximum(near, self.k_distance[order])
        density = 1.0 / (np.mean(reach, axis=1) + 1e-10)
        return -np.mean(self.reachability_density[order] / density[:, None], axis=1)

    def _detector_arrays(self) -> dict[str, np.ndarray]:
        return {"references": self.references, "k_distance": self.k_distance,
                "reachability_density": self.reachability_density, "neighbour_count": np.asarray(self.neighbour_count)}

    def _detector_restore(self, arrays: dict[str, np.ndarray]) -> None:
        self.references = np.asarray(arrays["references"], dtype=np.float64)
        self.k_distance = np.asarray(arrays["k_distance"], dtype=np.float64)
        self.reachability_density = np.asarray(arrays["reachability_density"], dtype=np.float64)
        self.neighbour_count = int(arrays["neighbour_count"])


class OneClassSupportStates(AnomalyStates):
    variant = "one_class_svm"
    detector_name = "one-class SVM"

    def _fit_detector(self, space: np.ndarray, context: FitContext) -> None:
        from sklearn.svm import OneClassSVM

        sample = np.asarray(space[spread_rows(np.arange(space.shape[0]), int(self.parameters["maximum_fit_rows"]))],
                            dtype=np.float64)
        variance = float(sample.var()) or 1.0
        self.kernel_scale = float(self.parameters["kernel_width_scale"]) / (sample.shape[1] * variance)
        with single_thread():
            model = OneClassSVM(kernel="rbf", gamma=self.kernel_scale, nu=float(self.parameters["outlier_share"])).fit(sample)
        self.model_for_tests = model
        self.support = np.asarray(model.support_vectors_, dtype=np.float64)
        self.dual = np.asarray(model.dual_coef_, dtype=np.float64).reshape(-1)
        self.intercept = float(np.asarray(model.intercept_).reshape(-1)[0])

    def _score(self, space: np.ndarray) -> np.ndarray:
        kernel = np.exp(-self.kernel_scale * squared_distances(space, self.support))
        return kernel @ self.dual + self.intercept

    def _detector_arrays(self) -> dict[str, np.ndarray]:
        return {"support": self.support, "dual": self.dual, "intercept": np.asarray(self.intercept),
                "kernel_scale": np.asarray(self.kernel_scale)}

    def _detector_restore(self, arrays: dict[str, np.ndarray]) -> None:
        self.support = np.asarray(arrays["support"], dtype=np.float64)
        self.dual = np.asarray(arrays["dual"], dtype=np.float64)
        self.intercept = float(arrays["intercept"])
        self.kernel_scale = float(arrays["kernel_scale"])


class RobustCovarianceStates(AnomalyStates):
    variant = "robust_covariance"
    detector_name = "robust covariance (minimum covariance determinant)"

    def _fit_detector(self, space: np.ndarray, context: FitContext) -> None:
        from scipy.linalg import pinvh
        from sklearn.covariance import MinCovDet

        sample = np.asarray(space[spread_rows(np.arange(space.shape[0]), int(self.parameters["maximum_fit_rows"]))],
                            dtype=np.float64)
        with single_thread(), warnings.catch_warnings():
            # "Determinant has increased": a C-step on a near-singular scatter; the best subset is still kept
            warnings.simplefilter("ignore", RuntimeWarning)
            model = MinCovDet(support_fraction=float(self.parameters["support_fraction"]), random_state=self.seed).fit(sample)
        self.model_for_tests = model
        self.location = np.asarray(model.location_, dtype=np.float64)
        self.precision = np.asarray(pinvh(model.covariance_), dtype=np.float64)

    def _score(self, space: np.ndarray) -> np.ndarray:
        centred = np.asarray(space, dtype=np.float64) - self.location
        return np.einsum("ij,jk,ik->i", centred, self.precision, centred)

    def _detector_arrays(self) -> dict[str, np.ndarray]:
        return {"location": self.location, "precision": self.precision}

    def _detector_restore(self, arrays: dict[str, np.ndarray]) -> None:
        self.location = np.asarray(arrays["location"], dtype=np.float64)
        self.precision = np.asarray(arrays["precision"], dtype=np.float64)


__all__ = ["IsolationForestStates", "LocalOutlierStates", "OneClassSupportStates", "RobustCovarianceStates"]
