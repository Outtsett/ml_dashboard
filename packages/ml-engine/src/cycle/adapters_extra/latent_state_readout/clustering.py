"""Clusterings as state models: k-means, hierarchical, DBSCAN, mean shift, affinity propagation, spectral.

Each is fitted by scikit-learn on the standardised training rows (the
quadratic ones on an evenly spread subsample of at most ``maximum_fit_rows``)
and assigns a new bar by its own rule, stored as plain arrays:

- ``KMeansStates``: Lloyd's k-means (k-means++ seeding, ``initialization_count``
  restarts); a bar takes its nearest centroid.
- ``HierarchicalStates``: agglomerative (Ward, average, complete or single
  linkage) or divisive (bisecting k-means) clustering cut at ``cluster_count``;
  neither has a predict of its own, so a bar takes a distance-weighted vote of
  its ``neighbor_count`` nearest fitted rows (soft states).
- ``DensityStates`` (DBSCAN): on the training rows' leading principal
  components; the radius is the ``neighborhood_radius_quantile`` of the
  training k-distance curve, a core point needs ``core_point_share`` of the
  fitted rows around it; a bar takes the cluster of its nearest core point
  when it lies within the radius, else the noise state (a real state with its
  own up-rate).
- ``MeanShiftStates``: modes of the kernel density on the leading principal
  components (bandwidth from the ``bandwidth_quantile`` of pairwise
  distances); modes holding less than ``minimum_state_share`` of the fitted
  rows are merged into one "other" state; a bar takes its nearest mode.
- ``AffinityPropagationStates``: exemplars chosen by message passing over
  negative squared distances (preference at the ``preference_percentile`` of
  the similarities, ``damping``); a bar takes its nearest exemplar.
- ``SpectralStates``: k-means on the normalised Laplacian eigenvectors of the
  ``affinity_neighbor_count``-nearest-neighbour graph; a bar takes a neighbour
  vote as for the hierarchical states (no predict of its own).
"""

from __future__ import annotations

import warnings

import numpy as np

from .common import Projection, nearest, neighbour_vote, one_hot, single_thread, spread_rows
from .state_model import FitContext, StateModel, occupancy


def _subsample(space: np.ndarray, maximum: int) -> np.ndarray:
    return np.asarray(space[spread_rows(np.arange(space.shape[0]), maximum)], dtype=np.float64)


class KMeansStates(StateModel):
    variant = "kmeans"

    def fit(self, space: np.ndarray, context: FitContext) -> None:
        from sklearn.cluster import KMeans

        count = int(self.parameters["cluster_count"])
        if space.shape[0] < count:
            raise ValueError(f"{space.shape[0]} training rows cannot make {count} clusters")
        with single_thread():
            model = KMeans(n_clusters=count, n_init=int(self.parameters["initialization_count"]),
                           random_state=self.seed).fit(space)
        self.centers = np.asarray(model.cluster_centers_, dtype=np.float64)
        self._codes = nearest(space, self.centers)[0]

    @property
    def state_count(self) -> int:
        return int(self.centers.shape[0])

    def responsibilities(self, space: np.ndarray) -> np.ndarray:
        return one_hot(nearest(space, self.centers)[0], self.state_count)

    def arrays(self) -> dict[str, np.ndarray]:
        return {"centers": self.centers}

    def restore(self, arrays: dict[str, np.ndarray]) -> None:
        self.centers = np.asarray(arrays["centers"], dtype=np.float64)

    def describe(self) -> str:
        return f"{self.state_count} k-means clusters, training rows per cluster {occupancy(self._codes, self.state_count)}"


class NeighbourExtended(StateModel):
    """A clustering without a predict: fitted rows and their clusters, extended by a neighbour vote."""

    soft = True

    def _store(self, references: np.ndarray, labels: np.ndarray) -> None:
        labels = np.asarray(labels, dtype=np.int64)
        # clusters renumbered 0..C-1 in order of first appearance in time (a refit names them the same)
        _, first = np.unique(labels, return_index=True)
        order = labels[np.sort(first)]
        mapping = {int(old): new for new, old in enumerate(order)}
        self.references = np.asarray(references, dtype=np.float64)
        self.reference_states = np.asarray([mapping[int(label)] for label in labels], dtype=np.int64)
        self.cluster_count = len(order)

    @property
    def state_count(self) -> int:
        return int(self.cluster_count)

    def responsibilities(self, space: np.ndarray) -> np.ndarray:
        return neighbour_vote(space, self.references, self.reference_states, self.state_count,
                              int(self.parameters["neighbor_count"]))

    def arrays(self) -> dict[str, np.ndarray]:
        return {"references": self.references, "reference_states": self.reference_states}

    def restore(self, arrays: dict[str, np.ndarray]) -> None:
        self.references = np.asarray(arrays["references"], dtype=np.float64)
        self.reference_states = np.asarray(arrays["reference_states"], dtype=np.int64)
        self.cluster_count = int(self.reference_states.max()) + 1 if self.reference_states.size else 1


class HierarchicalStates(NeighbourExtended):
    variant = "hierarchical"

    def fit(self, space: np.ndarray, context: FitContext) -> None:
        from sklearn.cluster import AgglomerativeClustering, BisectingKMeans

        sample = _subsample(space, int(self.parameters["maximum_fit_rows"]))
        count = min(int(self.parameters["cluster_count"]), sample.shape[0])
        direction = str(self.parameters["hierarchy_direction"])
        with single_thread():
            if direction == "agglomerative":
                labels = AgglomerativeClustering(n_clusters=count, linkage=str(self.parameters["linkage_rule"])).fit(sample).labels_
            elif direction == "divisive":
                labels = BisectingKMeans(n_clusters=count, random_state=self.seed, n_init=1).fit(sample).labels_
            else:
                raise ValueError(f"unknown hierarchy_direction {direction!r}")
        self._store(sample, labels)
        self.direction = direction
        self._fitted_rows = sample.shape[0]

    def describe(self) -> str:
        what = f"{getattr(self, 'direction', 'hierarchical')} clusters cut at {self.state_count}"
        return (f"{what} on {self._fitted_rows} spread training rows, fitted rows per cluster "
                f"{occupancy(self.reference_states, self.state_count)}; new bars vote over "
                f"{int(self.parameters['neighbor_count'])} nearest fitted rows")


class SpectralStates(NeighbourExtended):
    variant = "spectral"

    def fit(self, space: np.ndarray, context: FitContext) -> None:
        from sklearn.cluster import SpectralClustering

        sample = _subsample(space, int(self.parameters["maximum_fit_rows"]))
        count = min(int(self.parameters["cluster_count"]), sample.shape[0] - 1)
        neighbours = min(int(self.parameters["affinity_neighbor_count"]), sample.shape[0] - 1)
        with single_thread(), warnings.catch_warnings():
            warnings.simplefilter("ignore")        # "graph is not fully connected": a spectral embedding still exists
            model = SpectralClustering(n_clusters=count, affinity="nearest_neighbors", n_neighbors=neighbours,
                                       assign_labels="cluster_qr", random_state=self.seed, n_jobs=1).fit(sample)
        self._store(sample, model.labels_)
        self._fitted_rows = sample.shape[0]

    def describe(self) -> str:
        return (f"{self.state_count} spectral clusters of the {int(self.parameters['affinity_neighbor_count'])}-nearest-"
                f"neighbour graph on {self._fitted_rows} spread training rows, fitted rows per cluster "
                f"{occupancy(self.reference_states, self.state_count)}")


class DensityStates(StateModel):
    """DBSCAN (see the module docstring); the last state is noise."""

    variant = "dbscan"

    def fit(self, space: np.ndarray, context: FitContext) -> None:
        from sklearn.cluster import DBSCAN
        from sklearn.neighbors import NearestNeighbors

        self.projection = Projection.fit(space, int(self.parameters["principal_component_count"]))
        sample = self.projection.transform(_subsample(space, int(self.parameters["maximum_fit_rows"])))
        dimension = sample.shape[1]
        core_count = max(2 * dimension, int(round(float(self.parameters["core_point_share"]) * sample.shape[0])))
        core_count = min(core_count, sample.shape[0])
        with single_thread():
            distance = NearestNeighbors(n_neighbors=core_count).fit(sample).kneighbors(sample)[0][:, -1]
            radius = float(np.quantile(distance, float(self.parameters["neighborhood_radius_quantile"])))
            radius = radius if radius > 0 else 1e-6
            model = DBSCAN(eps=radius, min_samples=core_count).fit(sample)
        labels = np.asarray(model.labels_, dtype=np.int64)
        cores = np.asarray(model.core_sample_indices_, dtype=np.int64)
        self.radius = radius
        self.cores = sample[cores] if cores.size else np.zeros((0, dimension))
        self.core_states = labels[cores] if cores.size else np.zeros(0, dtype=np.int64)
        self.cluster_count = int(labels.max()) + 1 if cores.size else 0
        self._noise_share = float(np.mean(labels < 0))
        self._core_count = core_count

    @property
    def state_count(self) -> int:
        return int(self.cluster_count) + 1

    def responsibilities(self, space: np.ndarray) -> np.ndarray:
        points = self.projection.transform(space)
        codes = np.full(points.shape[0], self.cluster_count, dtype=np.int64)
        if self.cores.shape[0]:
            index, distance = nearest(points, self.cores)
            inside = distance <= self.radius ** 2
            codes[inside] = self.core_states[index[inside]]
        return one_hot(codes, self.state_count)

    def arrays(self) -> dict[str, np.ndarray]:
        return {**{f"projection_{k}": v for k, v in self.projection.arrays().items()}, "radius": np.asarray(self.radius),
                "cores": self.cores, "core_states": self.core_states, "cluster_count": np.asarray(self.cluster_count)}

    def restore(self, arrays: dict[str, np.ndarray]) -> None:
        self.projection = Projection.from_arrays({k[len("projection_"):]: v for k, v in arrays.items()
                                                  if k.startswith("projection_")})
        self.radius = float(arrays["radius"])
        self.cores = np.asarray(arrays["cores"], dtype=np.float64)
        self.core_states = np.asarray(arrays["core_states"], dtype=np.int64)
        self.cluster_count = int(arrays["cluster_count"])

    def describe(self) -> str:
        return (f"DBSCAN: {self.cluster_count} density clusters plus noise ({self._noise_share:.0%} of fitted rows) on "
                f"{self.projection.components.shape[0] or 'all'} principal components, radius {self.radius:.3f}, "
                f"{self._core_count} rows make a core point, {self.cores.shape[0]} core points")


class MeanShiftStates(StateModel):
    variant = "mean_shift"

    def fit(self, space: np.ndarray, context: FitContext) -> None:
        from sklearn.cluster import MeanShift, estimate_bandwidth

        self.projection = Projection.fit(space, int(self.parameters["principal_component_count"]))
        sample = self.projection.transform(_subsample(space, int(self.parameters["maximum_fit_rows"])))
        with single_thread():
            bandwidth = float(estimate_bandwidth(sample, quantile=float(self.parameters["bandwidth_quantile"]),
                                                 n_samples=min(sample.shape[0], 3000), random_state=self.seed))
            bandwidth = bandwidth if bandwidth > 0 else 1.0
            model = MeanShift(bandwidth=bandwidth, bin_seeding=True, cluster_all=True, n_jobs=1).fit(sample)
        modes = np.asarray(model.cluster_centers_, dtype=np.float64)
        codes = nearest(sample, modes)[0]
        share = np.bincount(codes, minlength=modes.shape[0]) / max(sample.shape[0], 1)
        kept = np.flatnonzero(share >= float(self.parameters["minimum_state_share"]))
        if kept.size == 0:
            kept = np.asarray([int(np.argmax(share))])
        merged = modes.shape[0] > kept.size
        mode_states = np.full(modes.shape[0], kept.size, dtype=np.int64)
        mode_states[kept] = np.arange(kept.size)
        self.modes = modes
        self.mode_states = mode_states
        self.bandwidth = bandwidth
        self.kept_count = int(kept.size)
        self.has_other = bool(merged)
        self._codes = mode_states[codes]

    @property
    def state_count(self) -> int:
        return self.kept_count + (1 if self.has_other else 0)

    def responsibilities(self, space: np.ndarray) -> np.ndarray:
        index = nearest(self.projection.transform(space), self.modes)[0]
        return one_hot(self.mode_states[index], self.state_count)

    def arrays(self) -> dict[str, np.ndarray]:
        return {**{f"projection_{k}": v for k, v in self.projection.arrays().items()}, "modes": self.modes,
                "mode_states": self.mode_states, "bandwidth": np.asarray(self.bandwidth),
                "kept_count": np.asarray(self.kept_count), "has_other": np.asarray(self.has_other)}

    def restore(self, arrays: dict[str, np.ndarray]) -> None:
        self.projection = Projection.from_arrays({k[len("projection_"):]: v for k, v in arrays.items()
                                                  if k.startswith("projection_")})
        self.modes = np.asarray(arrays["modes"], dtype=np.float64)
        self.mode_states = np.asarray(arrays["mode_states"], dtype=np.int64)
        self.bandwidth = float(arrays["bandwidth"])
        self.kept_count = int(arrays["kept_count"])
        self.has_other = bool(arrays["has_other"])

    def describe(self) -> str:
        other = " plus one state merging the smaller modes" if self.has_other else ""
        return (f"mean shift: {self.modes.shape[0]} modes at bandwidth {self.bandwidth:.3f}, {self.kept_count} kept{other}; "
                f"fitted rows per state {occupancy(self._codes, self.state_count)}")


class AffinityPropagationStates(StateModel):
    variant = "affinity_propagation"

    def fit(self, space: np.ndarray, context: FitContext) -> None:
        from sklearn.cluster import AffinityPropagation
        from sklearn.exceptions import ConvergenceWarning

        from .common import squared_distances

        sample = _subsample(space, int(self.parameters["maximum_fit_rows"]))
        similarity = -squared_distances(sample, sample)
        off_diagonal = similarity[~np.eye(sample.shape[0], dtype=bool)]
        preference = float(np.percentile(off_diagonal, float(self.parameters["preference_percentile"])))
        damping = float(self.parameters["damping"])
        exemplars = np.zeros(0, dtype=np.int64)
        self.converged = False
        for attempt in range(3):
            with single_thread(), warnings.catch_warnings():
                warnings.simplefilter("ignore", ConvergenceWarning)
                model = AffinityPropagation(damping=damping, max_iter=int(self.parameters["max_iterations"]),
                                            convergence_iter=15, preference=preference, affinity="precomputed",
                                            random_state=self.seed).fit(similarity)
            exemplars = np.asarray(model.cluster_centers_indices_, dtype=np.int64).reshape(-1)
            iterations = int(getattr(model, "n_iter_", 0))
            if exemplars.size and iterations < int(self.parameters["max_iterations"]):
                self.converged = True
                break
            context.log(f"affinity propagation did not converge at damping {damping:.2f}; retrying with more damping")
            damping = min(0.99, damping + 0.1)
        if exemplars.size == 0:
            context.log("affinity propagation found no exemplar; one state (the training mean) is used")
            self.exemplars = sample.mean(axis=0, keepdims=True)
        else:
            self.exemplars = sample[np.sort(exemplars)]
        self.damping_used = damping
        self._codes = nearest(sample, self.exemplars)[0]

    @property
    def state_count(self) -> int:
        return int(self.exemplars.shape[0])

    def responsibilities(self, space: np.ndarray) -> np.ndarray:
        return one_hot(nearest(space, self.exemplars)[0], self.state_count)

    def arrays(self) -> dict[str, np.ndarray]:
        return {"exemplars": self.exemplars}

    def restore(self, arrays: dict[str, np.ndarray]) -> None:
        self.exemplars = np.asarray(arrays["exemplars"], dtype=np.float64)

    def describe(self) -> str:
        converged = "converged" if self.converged else "did not converge"
        return (f"affinity propagation {converged} (damping {self.damping_used:.2f}): {self.state_count} exemplars, "
                f"fitted rows per exemplar {occupancy(self._codes, self.state_count)}")


__all__ = ["AffinityPropagationStates", "DensityStates", "HierarchicalStates", "KMeansStates", "MeanShiftStates",
           "SpectralStates"]
