"""The five graph and cluster label-inference methods.

Every method fits on the node matrix of one training span (standardised rows,
``nodes.py``): ``labelled`` marks the nodes whose target is used, ``targets``
holds 1 up / 0 down (task ``classification``) or the clipped scaled move (task
``regression``) on those nodes and NaN elsewhere; an unlabelled node's target
is never read. ``score(queries)`` scores standardised query rows against the
fitted nodes ONLY (the inductive extension: a validation or test bar is never
added to the graph), one row at a time in effect (``graph.nearest_nodes``).

    variant             class                    score (classification / regression)
    label_propagation   PropagatedLabels         mean up-share of the k nearest nodes (knn) or the
                                                 RBF-weighted share over all nodes, sklearn
                                                 LabelPropagation's own inductive rule / (no price)
    label_spreading     PropagatedLabels         the same over sklearn LabelSpreading's soft-clamped
                                                 labels / spread move over spread labelled mass
    harmonic            HarmonicField            harmonic function + class mass normalisation /
                                                 harmonic regression
    laplacian_rls       LaplacianRegularisedLeastSquares   f(x) = sum_i a_i k(x_i, x) (the adapter maps
                                                 it to P(up) with a validation curve) / f(x) + mean
    constrained_kmeans  ConstrainedKMeans        soft assignment x smoothed purity of each centroid /
                                                 soft assignment x smoothed member mean
"""

from __future__ import annotations

import warnings

import numpy as np

from . import graph

KERNELS = ("knn", "rbf")
PAIRWISE_SAMPLE = 500
DENSE_SOLVE_THREADS = 4


def _require_both_classes(targets: np.ndarray, labelled: np.ndarray, what: str) -> None:
    values = targets[labelled]
    if not (np.any(values >= 0.5) and np.any(values < 0.5)):
        raise ValueError(f"{what}: the labelled nodes hold one class only; raise labeled_fraction or the training span")


class PropagatedLabels:
    """sklearn ``LabelPropagation`` (hard clamping) or ``LabelSpreading`` (soft
    clamping, ``clamping_factor``) for P(up); for the price, the move spread over
    the heat-kernel kNN graph divided by the spread labelled mass."""

    def __init__(self, parameters: dict, seed: int, task: str, spreading: bool) -> None:
        self.parameters = parameters
        self.seed = int(seed)
        self.task = task
        self.spreading = bool(spreading)
        self.kernel = str(parameters.get("kernel", "knn"))
        if self.kernel not in KERNELS:
            raise ValueError(f"kernel must be one of {KERNELS}, got {self.kernel!r}")
        self.neighbor_count = int(parameters["neighbor_count"])
        self.nodes: np.ndarray | None = None
        self.node_values: np.ndarray | None = None
        self.sigma = 1.0
        self.inverse_width = 0.0            # sklearn's gamma for the rbf kernel

    def fit(self, nodes: np.ndarray, labelled: np.ndarray, targets: np.ndarray) -> dict:
        self.nodes = np.asarray(nodes, dtype=np.float64)
        _, distances = graph.nearest_nodes(self.nodes, self.nodes, self.neighbor_count, exclude_self=True)
        self.sigma = graph.bandwidth(distances, float(self.parameters["bandwidth_quantile"]))
        if self.task == "regression":
            return self._fit_price(labelled, targets)
        from sklearn.exceptions import ConvergenceWarning
        from sklearn.semi_supervised import LabelPropagation, LabelSpreading

        _require_both_classes(targets, labelled, "label inference")
        classes = np.full(self.nodes.shape[0], -1, dtype=np.int64)
        classes[labelled] = (targets[labelled] >= 0.5).astype(np.int64)
        self.inverse_width = 1.0 / (2.0 * self.sigma * self.sigma)
        common = dict(kernel=self.kernel, n_neighbors=self.neighbor_count, gamma=self.inverse_width,
                      max_iter=int(self.parameters["max_iterations"]), tol=1e-3)
        if self.spreading:
            estimator = LabelSpreading(alpha=float(self.parameters["clamping_factor"]), **common)
        else:
            estimator = LabelPropagation(**common)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            with np.errstate(invalid="ignore", divide="ignore"):
                estimator.fit(self.nodes, classes)
        converged = not any(issubclass(item.category, ConvergenceWarning) for item in caught)
        distribution = np.asarray(estimator.label_distributions_, dtype=np.float64)
        up = distribution[:, list(estimator.classes_).index(1)]
        base_rate = float(np.mean(classes[labelled]))
        # a node the propagation never reached (a graph component with no labelled node) holds the base rate
        unreached = ~np.isfinite(up)
        up[unreached] = base_rate
        self.node_values = up
        self.estimator = estimator
        return {"propagation_iterations": int(estimator.n_iter_), "propagation_converged": bool(converged),
                "unreached_node_count": int(unreached.sum()), "kernel_sigma": self.sigma}

    def _fit_price(self, labelled: np.ndarray, targets: np.ndarray) -> dict:
        weights, _ = graph.heat_graph(self.nodes, self.neighbor_count, float(self.parameters["bandwidth_quantile"]))
        mask = labelled.astype(np.float64)
        seeds = np.column_stack([np.where(labelled, targets, 0.0), mask])
        clamping = float(self.parameters["clamping_factor"]) if self.spreading else 0.99
        spread = graph.normalised_spreading(weights, seeds, clamping)
        mean = float(np.mean(targets[labelled]))
        reached = spread[:, 1] > 1e-12
        self.node_values = np.where(reached, spread[:, 0] / np.where(reached, spread[:, 1], 1.0), mean)
        return {"unreached_node_count": int((~reached).sum()), "kernel_sigma": self.sigma}

    def score(self, queries: np.ndarray) -> np.ndarray:
        queries = np.asarray(queries, dtype=np.float64)
        if self.task == "regression":
            return graph.inductive_mean(queries, self.nodes, self.node_values, self.neighbor_count, self.sigma)
        out = np.full(queries.shape[0], np.nan, dtype=np.float64)
        usable = np.all(np.isfinite(queries), axis=1)
        if not usable.any():
            return out
        if self.kernel == "knn":
            # sklearn's inductive rule: the mean label distribution of the k nearest fitted nodes
            indices, _ = graph.nearest_nodes(queries[usable], self.nodes, self.neighbor_count)
            out[usable] = self.node_values[indices].mean(axis=1)
            return out
        squared = graph.squared_distances(queries[usable], self.nodes)
        weights = np.exp(-self.inverse_width * squared)
        total = weights.sum(axis=1)
        nearest = self.node_values[np.argmin(squared, axis=1)]
        out[usable] = np.where(total > 0, (weights @ self.node_values) / np.where(total > 0, total, 1.0), nearest)
        return out

    def arrays(self) -> dict:
        return {"nodes": self.nodes, "node_values": self.node_values,
                "scalars": np.array([self.sigma, self.inverse_width], dtype=np.float64)}

    def restore(self, arrays: dict) -> None:
        self.nodes, self.node_values = arrays["nodes"], arrays["node_values"]
        self.sigma, self.inverse_width = (float(value) for value in arrays["scalars"])


class HarmonicField:
    """Zhu, Ghahramani and Lafferty (2003): the Gaussian random field on the
    heat-kernel kNN graph, labelled nodes clamped, unlabelled nodes the harmonic
    solve; class mass normalisation re-weights the two classes to the labelled up-rate."""

    def __init__(self, parameters: dict, seed: int, task: str) -> None:
        self.parameters = parameters
        self.task = task
        self.neighbor_count = int(parameters["neighbor_count"])
        self.normalise = bool(parameters.get("class_mass_normalization", True))
        self.nodes = self.node_values = None
        self.sigma = 1.0
        self.class_prior = 0.5
        self.up_mass = self.down_mass = 1.0

    def fit(self, nodes: np.ndarray, labelled: np.ndarray, targets: np.ndarray) -> dict:
        self.nodes = np.asarray(nodes, dtype=np.float64)
        weights, self.sigma = graph.heat_graph(self.nodes, self.neighbor_count,
                                               float(self.parameters["bandwidth_quantile"]))
        positions = np.flatnonzero(labelled)
        if self.task == "classification":
            _require_both_classes(targets, labelled, "harmonic function")
            values = (targets[positions] >= 0.5).astype(np.float64)
        else:
            values = targets[positions].astype(np.float64)
        self.node_values = graph.harmonic_solution(weights, positions, values)
        unlabelled = ~labelled
        pool = self.node_values[unlabelled] if unlabelled.any() else self.node_values
        if self.task == "classification":
            self.class_prior = float(values.mean())
            self.up_mass = float(max(np.sum(pool), 1e-12))
            self.down_mass = float(max(np.sum(1.0 - pool), 1e-12))
        from scipy.sparse.csgraph import connected_components

        component_count, component = connected_components(weights, directed=False)
        labelled_components = np.unique(component[positions]).size
        return {"graph_edge_count": int(weights.nnz // 2), "graph_component_count": int(component_count),
                "components_without_labels": int(component_count - labelled_components), "kernel_sigma": self.sigma}

    def score(self, queries: np.ndarray) -> np.ndarray:
        field = graph.inductive_mean(queries, self.nodes, self.node_values, self.neighbor_count, self.sigma)
        if self.task == "regression" or not self.normalise:
            return field
        field = np.clip(field, 0.0, 1.0)
        up = self.class_prior * field / self.up_mass
        down = (1.0 - self.class_prior) * (1.0 - field) / self.down_mass
        total = up + down
        with np.errstate(invalid="ignore", divide="ignore"):
            return np.where(total > 0, up / np.where(total > 0, total, 1.0), 0.5)

    def arrays(self) -> dict:
        return {"nodes": self.nodes, "node_values": self.node_values,
                "scalars": np.array([self.sigma, self.class_prior, self.up_mass, self.down_mass], dtype=np.float64)}

    def restore(self, arrays: dict) -> None:
        self.nodes, self.node_values = arrays["nodes"], arrays["node_values"]
        self.sigma, self.class_prior, self.up_mass, self.down_mass = (float(value) for value in arrays["scalars"])


class LaplacianRegularisedLeastSquares:
    """Belkin, Niyogi and Sindhwani (2006), Laplacian RLS: with K the RBF kernel
    over the nodes, L the heat-graph Laplacian, J the labelled indicator,
    l labelled of n nodes: a = (J K + g_A l I + (g_I l / n^2) L K)^-1 Y, and
    f(x) = sum_i a_i k(x_i, x). Y is +-1 (direction) or the centred move (price)."""

    def __init__(self, parameters: dict, seed: int, task: str) -> None:
        self.parameters = parameters
        self.task = task
        self.nodes = self.coefficients = None
        self.kernel_sigma = 1.0
        self.offset = 0.0

    def fit(self, nodes: np.ndarray, labelled: np.ndarray, targets: np.ndarray) -> dict:
        self.nodes = np.asarray(nodes, dtype=np.float64)
        count = self.nodes.shape[0]
        weights, graph_sigma = graph.heat_graph(self.nodes, int(self.parameters["neighbor_count"]),
                                                float(self.parameters["bandwidth_quantile"]))
        sample = self.nodes[np.unique(np.round(np.linspace(0, count - 1, min(count, PAIRWISE_SAMPLE))).astype(np.int64))]
        pairwise = np.sqrt(graph.squared_distances(sample, sample)[np.triu_indices(sample.shape[0], 1)])
        median = float(np.median(pairwise)) if pairwise.size else 1.0
        self.kernel_sigma = max(median * float(self.parameters["kernel_width_multiple"]), 1e-6)
        kernel = np.exp(-graph.squared_distances(self.nodes, self.nodes) / (2.0 * self.kernel_sigma ** 2))
        labelled_count = int(labelled.sum())
        if self.task == "classification":
            _require_both_classes(targets, labelled, "Laplacian RLS")
            response = np.where(labelled, np.where(targets >= 0.5, 1.0, -1.0), 0.0)
            self.offset = 0.0
        else:
            self.offset = float(np.mean(targets[labelled]))
            response = np.where(labelled, targets - self.offset, 0.0)
        ambient = float(self.parameters["ambient_regularization"])
        intrinsic = float(self.parameters["intrinsic_regularization"])
        # a dense n x n solve: a few BLAS threads (an unbounded pool thrashes on a busy machine)
        from threadpoolctl import threadpool_limits

        with threadpool_limits(limits=DENSE_SOLVE_THREADS):
            system = (kernel * labelled.astype(np.float64)[:, None]
                      + ambient * labelled_count * np.eye(count)
                      + (intrinsic * labelled_count / float(count) ** 2) * (graph.laplacian(weights) @ kernel))
            self.coefficients = np.linalg.solve(system, response)
        return {"kernel_sigma": self.kernel_sigma, "graph_sigma": graph_sigma,
                "coefficient_norm": float(np.linalg.norm(self.coefficients))}

    def score(self, queries: np.ndarray) -> np.ndarray:
        queries = np.asarray(queries, dtype=np.float64)
        out = np.full(queries.shape[0], np.nan, dtype=np.float64)
        usable = np.all(np.isfinite(queries), axis=1)
        if usable.any():
            kernel = np.exp(-graph.squared_distances(queries[usable], self.nodes) / (2.0 * self.kernel_sigma ** 2))
            out[usable] = np.array([float(row @ self.coefficients) for row in kernel]) + self.offset
        return out

    def arrays(self) -> dict:
        return {"nodes": self.nodes, "coefficients": self.coefficients,
                "scalars": np.array([self.kernel_sigma, self.offset], dtype=np.float64)}

    def restore(self, arrays: dict) -> None:
        self.nodes, self.coefficients = arrays["nodes"], arrays["coefficients"]
        self.kernel_sigma, self.offset = (float(value) for value in arrays["scalars"])


class ConstrainedKMeans:
    """Seeded, constrained k-means (Basu et al. 2002; Wagstaff et al. 2001): half
    the centroids seeded by k-means inside the labelled up rows, half inside the
    labelled down rows (for the price: the rows with a positive / non-positive
    move); Lloyd iterations over every node where a labelled node may only join
    a centroid of its own class (cannot-link across classes) and an unlabelled
    node joins the nearest centroid. Readout: softmax(-d^2 / (F T)) over the
    centroids times each centroid's smoothed up-share (price: smoothed mean
    move) of its labelled members."""

    def __init__(self, parameters: dict, seed: int, task: str) -> None:
        self.parameters = parameters
        self.seed = int(seed)
        self.task = task
        self.temperature = float(parameters["temperature"])
        self.centroids = self.readout = self.centroid_class = None

    def fit(self, nodes: np.ndarray, labelled: np.ndarray, targets: np.ndarray) -> dict:
        from sklearn.cluster import KMeans

        nodes = np.asarray(nodes, dtype=np.float64)
        up = targets >= 0.5 if self.task == "classification" else targets > 0.0
        if self.task == "classification":
            _require_both_classes(targets, labelled, "constrained k-means")
        up_rows = np.flatnonzero(labelled & up)
        down_rows = np.flatnonzero(labelled & ~up)
        if up_rows.size == 0 or down_rows.size == 0:
            raise ValueError("constrained k-means: the labelled nodes hold one class only")
        total = max(2, int(self.parameters["cluster_count"]))
        up_count = int(min(max(1, total // 2), up_rows.size))
        down_count = int(min(max(1, total - total // 2), down_rows.size))
        seeds = []
        for rows, count in ((up_rows, up_count), (down_rows, down_count)):
            estimator = KMeans(n_clusters=count, n_init=3, random_state=self.seed).fit(nodes[rows])
            seeds.append(np.asarray(estimator.cluster_centers_, dtype=np.float64))
        centroids = np.vstack(seeds)
        centroid_up = np.concatenate([np.ones(up_count, dtype=bool), np.zeros(down_count, dtype=bool)])
        node_class = np.where(labelled, np.where(up, 1, 0), -1)
        assignment = np.full(nodes.shape[0], -1, dtype=np.int64)
        iterations = 0
        for iterations in range(1, int(self.parameters["max_iterations"]) + 1):
            distance = graph.squared_distances(nodes, centroids)
            # the constraints: a labelled node may join only a centroid of its own class
            forbidden = ((node_class[:, None] == 1) & ~centroid_up[None, :]) | ((node_class[:, None] == 0) & centroid_up[None, :])
            distance[forbidden] = np.inf
            new_assignment = np.argmin(distance, axis=1)
            if np.array_equal(new_assignment, assignment):
                break
            assignment = new_assignment
            for cluster in range(centroids.shape[0]):
                members = assignment == cluster
                if members.any():
                    centroids[cluster] = nodes[members].mean(axis=0)
        prior = float(self.parameters["readout_prior_strength"])
        values = (targets >= 0.5).astype(np.float64) if self.task == "classification" else targets
        overall = float(np.mean(values[labelled]))
        readout = np.empty(centroids.shape[0], dtype=np.float64)
        sizes = np.zeros(centroids.shape[0], dtype=np.int64)
        for cluster in range(centroids.shape[0]):
            members = (assignment == cluster) & labelled
            sizes[cluster] = int(members.sum())
            readout[cluster] = (float(np.sum(values[members])) + prior * overall) / (sizes[cluster] + prior)
        self.centroids, self.readout, self.centroid_class = centroids, readout, centroid_up.astype(np.float64)
        return {"lloyd_iterations": int(iterations), "up_centroid_count": up_count,
                "down_centroid_count": down_count, "labelled_members_per_centroid": sizes.tolist()}

    def responsibilities(self, queries: np.ndarray) -> np.ndarray:
        distance = graph.squared_distances(queries, self.centroids)
        logits = -distance / (self.centroids.shape[1] * max(self.temperature, 1e-9))
        logits -= logits.max(axis=1, keepdims=True)
        weights = np.exp(logits)
        return weights / weights.sum(axis=1, keepdims=True)

    def score(self, queries: np.ndarray) -> np.ndarray:
        queries = np.asarray(queries, dtype=np.float64)
        out = np.full(queries.shape[0], np.nan, dtype=np.float64)
        usable = np.all(np.isfinite(queries), axis=1)
        if usable.any():
            responsibility = self.responsibilities(queries[usable])
            out[usable] = np.array([float(row @ self.readout) for row in responsibility])
        return out

    def arrays(self) -> dict:
        return {"centroids": self.centroids, "readout": self.readout, "centroid_class": self.centroid_class,
                "scalars": np.array([self.temperature], dtype=np.float64)}

    def restore(self, arrays: dict) -> None:
        self.centroids, self.readout, self.centroid_class = arrays["centroids"], arrays["readout"], arrays["centroid_class"]
        self.temperature = float(arrays["scalars"][0])


def build_method(variant: str, parameters: dict, seed: int, task: str):
    if variant == "label_propagation":
        return PropagatedLabels(parameters, seed, task, spreading=False)
    if variant == "label_spreading":
        return PropagatedLabels(parameters, seed, task, spreading=True)
    if variant == "harmonic":
        return HarmonicField(parameters, seed, task)
    if variant == "laplacian_rls":
        return LaplacianRegularisedLeastSquares(parameters, seed, task)
    if variant == "constrained_kmeans":
        return ConstrainedKMeans(parameters, seed, task)
    raise ValueError(f"unknown graph label inference variant {variant!r}")


VARIANTS = ("label_propagation", "label_spreading", "harmonic", "laplacian_rls", "constrained_kmeans")

__all__ = ["ConstrainedKMeans", "HarmonicField", "LaplacianRegularisedLeastSquares", "PropagatedLabels", "VARIANTS",
           "build_method"]
