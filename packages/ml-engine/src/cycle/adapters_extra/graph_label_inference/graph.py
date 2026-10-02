"""Geometry shared by the graph methods: scaling, nearest nodes, the heat-kernel
kNN graph, the harmonic solve, normalised spreading and the inductive extension.

Every function here is a pure function of the node matrix it is given (rows of
the training span, see ``nodes.py``) and, for scoring, of ONE query row at a
time: the distance from a query to the nodes is computed row by row with the
same arithmetic whether the query arrives alone or in a batch, so a bar gets
the same score alone or in a batch (the harness's 1e-9 gate).

    Standardiser           column mean / deviation of the nodes (fit on nodes only)
    nearest_nodes          the k nearest nodes of each query, ties broken by node order
    heat_graph             symmetric kNN graph, w = exp(-d^2 / (2 sigma^2)), sigma a quantile of kNN distances
    harmonic_solution      Zhu, Ghahramani and Lafferty (2003): L_uu f_u = W_ul f_l
    normalised_spreading   Zhou et al. (2004): (I - a S) F = (1 - a) Y, S = D^-1/2 W D^-1/2
    inductive_mean         heat-weighted mean of node values over a query's k nearest nodes
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import sparse
from scipy.sparse.linalg import spsolve

QUERY_CHUNK = 128
DEVIATION_FLOOR = 1e-9
# Harmonic solve: a pull of this size (times the mean degree) toward the labelled mean keeps a
# graph component with no labelled node solvable; ~1e-8 of a neighbour's weight, so a connected
# component's harmonic values move by ~1e-8 at most.
HARMONIC_PRIOR_PULL = 1e-8


@dataclass(frozen=True)
class Standardiser:
    mean: np.ndarray
    scale: np.ndarray

    @classmethod
    def fit(cls, matrix: np.ndarray) -> Standardiser:
        matrix = np.asarray(matrix, dtype=np.float64)
        scale = matrix.std(axis=0)
        return cls(matrix.mean(axis=0), np.where(scale > DEVIATION_FLOOR, scale, 1.0))

    def apply(self, matrix: np.ndarray) -> np.ndarray:
        return (np.asarray(matrix, dtype=np.float64) - self.mean) / self.scale


def squared_distances(queries: np.ndarray, nodes: np.ndarray) -> np.ndarray:
    """(q, n) squared Euclidean distances, each row computed from its own
    differences (identical arithmetic for one query or many)."""
    queries = np.asarray(queries, dtype=np.float64)
    nodes = np.asarray(nodes, dtype=np.float64)
    out = np.empty((queries.shape[0], nodes.shape[0]), dtype=np.float64)
    for start in range(0, queries.shape[0], QUERY_CHUNK):
        block = queries[start:start + QUERY_CHUNK]
        difference = block[:, None, :] - nodes[None, :, :]
        out[start:start + block.shape[0]] = np.einsum("qnf,qnf->qn", difference, difference, optimize=False)
    return out


def nearest_nodes(queries: np.ndarray, nodes: np.ndarray, k: int, exclude_self: bool = False
                  ) -> tuple[np.ndarray, np.ndarray]:
    """(indices (q, k), distances (q, k)) of each query's k nearest nodes, sorted
    by distance then node position. ``exclude_self`` drops node i from query i
    (the queries ARE the nodes)."""
    squared = squared_distances(queries, nodes)
    if exclude_self:
        np.fill_diagonal(squared, np.inf)
    k = int(min(k, nodes.shape[0] - (1 if exclude_self else 0)))
    order = np.argsort(squared, axis=1, kind="stable")[:, :k]
    distances = np.sqrt(np.maximum(np.take_along_axis(squared, order, axis=1), 0.0))
    return order.astype(np.int64), distances


def bandwidth(distances: np.ndarray, quantile: float) -> float:
    """The heat kernel's sigma: the ``quantile`` of the nodes' kNN distances (> 0)."""
    finite = distances[np.isfinite(distances) & (distances > 0)]
    if finite.size == 0:
        return 1.0
    return float(max(np.quantile(finite, float(quantile)), 1e-6))


def heat_weights(distances: np.ndarray, sigma: float) -> np.ndarray:
    return np.exp(-(np.asarray(distances, dtype=np.float64) ** 2) / (2.0 * sigma * sigma))


def heat_graph(nodes: np.ndarray, k: int, quantile: float) -> tuple[sparse.csr_matrix, float]:
    """Symmetric kNN graph over the nodes with heat weights; returns (W, sigma).
    W_ij = max(w_ij, w_ji): an edge exists when either node is among the other's k nearest."""
    count = nodes.shape[0]
    indices, distances = nearest_nodes(nodes, nodes, k, exclude_self=True)
    sigma = bandwidth(distances, quantile)
    weights = heat_weights(distances, sigma)
    rows = np.repeat(np.arange(count), indices.shape[1])
    graph = sparse.csr_matrix((weights.ravel(), (rows, indices.ravel())), shape=(count, count))
    return graph.maximum(graph.T).tocsr(), sigma


def laplacian(graph: sparse.csr_matrix) -> sparse.csr_matrix:
    degree = np.asarray(graph.sum(axis=1)).ravel()
    return (sparse.diags(degree) - graph).tocsr()


def harmonic_solution(graph, labelled_positions, labelled_values, prior_pull: float = HARMONIC_PRIOR_PULL
                      ) -> np.ndarray:
    """The harmonic function on ``graph`` (n x n, symmetric, non-negative):
    labelled nodes keep their values, the unlabelled ones solve
    (L_uu + e I) f_u = W_ul f_l + e * mean(f_l), with L = D - W and
    e = ``prior_pull`` x the mean degree (0 gives the exact harmonic solve,
    which needs every graph component to hold a labelled node)."""
    graph = sparse.csr_matrix(graph, dtype=np.float64)
    count = graph.shape[0]
    labelled_positions = np.asarray(labelled_positions, dtype=np.int64)
    labelled_values = np.asarray(labelled_values, dtype=np.float64)
    values = np.empty(count, dtype=np.float64)
    values[labelled_positions] = labelled_values
    is_labelled = np.zeros(count, dtype=bool)
    is_labelled[labelled_positions] = True
    unlabelled = np.flatnonzero(~is_labelled)
    if unlabelled.size == 0:
        return values
    degree = np.asarray(graph.sum(axis=1)).ravel()
    pull = float(prior_pull) * float(max(degree.mean(), 1e-12))
    system = laplacian(graph)[unlabelled][:, unlabelled] + pull * sparse.identity(unlabelled.size, format="csr")
    right = graph[unlabelled][:, labelled_positions] @ labelled_values + pull * float(labelled_values.mean())
    values[unlabelled] = np.atleast_1d(spsolve(system.tocsc(), right))
    return values


def normalised_spreading(graph, seeds: np.ndarray, clamping_factor: float) -> np.ndarray:
    """F = (1 - a) (I - a S)^-1 Y with S = D^-1/2 W D^-1/2 (the fixed point of
    F <- a S F + (1 - a) Y). ``seeds`` is (n,) or (n, c)."""
    graph = sparse.csr_matrix(graph, dtype=np.float64)
    degree = np.asarray(graph.sum(axis=1)).ravel()
    inverse_root = np.where(degree > 0, 1.0 / np.sqrt(np.maximum(degree, 1e-300)), 0.0)
    smoothing = sparse.diags(inverse_root) @ graph @ sparse.diags(inverse_root)
    system = (sparse.identity(graph.shape[0], format="csr") - float(clamping_factor) * smoothing).tocsc()
    seeds = np.asarray(seeds, dtype=np.float64)
    solved = spsolve(system, (1.0 - float(clamping_factor)) * seeds)
    return np.asarray(solved, dtype=np.float64).reshape(seeds.shape)


def inductive_mean(queries: np.ndarray, nodes: np.ndarray, node_values: np.ndarray, k: int, sigma: float
                   ) -> np.ndarray:
    """f(x) = sum_j w(x, x_j) f_j / sum_j w(x, x_j) over the k nearest nodes of x
    (heat weights; a plain mean when every weight underflows). Rows with a
    non-finite feature give NaN."""
    queries = np.asarray(queries, dtype=np.float64)
    out = np.full(queries.shape[0], np.nan, dtype=np.float64)
    usable = np.all(np.isfinite(queries), axis=1)
    if not usable.any():
        return out
    indices, distances = nearest_nodes(queries[usable], nodes, k)
    weights = heat_weights(distances, sigma)
    values = np.asarray(node_values, dtype=np.float64)[indices]
    total = weights.sum(axis=1)
    weighted = np.where(total > 0, (weights * values).sum(axis=1) / np.where(total > 0, total, 1.0),
                        values.mean(axis=1))
    out[usable] = weighted
    return out


__all__ = ["HARMONIC_PRIOR_PULL", "Standardiser", "bandwidth", "harmonic_solution", "heat_graph", "heat_weights",
           "inductive_mean", "laplacian", "nearest_nodes", "normalised_spreading", "squared_distances"]
