/**
 * Blueprints — Machine Learning / Unsupervised Learning.
 *
 * One entry per catalog spec id. Most of these algorithms have nothing that
 * matches a neural `P.*` formula — a k-means centroid, a tree split, a
 * kernel similarity is not a trainable weight in the PyTorch sense — so
 * `params` is omitted for them and the real quantity being stored (a
 * centroid table, a covariance matrix, a set of trees) is stated in
 * `detail` instead. Where a stage genuinely IS a linear map with a fixed
 * parameter count (a PCA projection, an autoencoder layer, a SOM codebook),
 * `P` is used.
 */

import type { ArchGraph } from '../types';
import type { NodeSpec } from '../blueprint';
import { DIM, P, blueprint, chain } from '../blueprint';

const F = DIM.features;

function inputNode(column: number, lane = 0): NodeSpec {
  return {
    id: 'input', kind: 'input', label: 'Bar features', sublabel: `${F} indicators, this bar`,
    outShape: `B × ${F}`, column, lane,
    analogy: 'Think of it as the trader glancing at this bar\'s 35 indicator readings the instant it closes — no history, just this snapshot.',
  };
}

function standardizeNode(column: number, lane = 0): NodeSpec {
  return {
    id: 'standardize', kind: 'norm', label: 'Standardize', sublabel: 'causal rolling z-score, per feature',
    inShape: `B × ${F}`, outShape: `B × ${F}`, column, lane,
  };
}

export const UNSUPERVISED_BLUEPRINTS: Record<string, ArchGraph> = {
  // ─── Anomaly detection ──────────────────────────────────────────────────

  'machine-learning-unsupervised-learning-anomaly-detection-isolation-forest-anomaly-detection': blueprint({
    title: 'Isolation Forest',
    subtitle: 'random-split trees — anomalies isolate in fewer splits',
    nodes: [
      inputNode(0),
      {
        id: 'random_split', kind: 'stochastic', label: 'Random partition', sublabel: 'random feature, random threshold',
        column: 1,
        analogy: 'Think of it as repeatedly cutting the data in half with a random guillotine — a bar that sits alone gets isolated in just a couple of cuts, a normal bar takes many.',
      },
      {
        id: 'isolation_trees', kind: 'tree', label: 'Isolation trees', sublabel: 'T trees, each on a random subsample m',
        column: 2,
        detail: { splits: 'no split criterion — purely random feature + threshold, repeated until isolated' },
      },
      { id: 'path_length', kind: 'pool', label: 'Average path length', sublabel: 'E[h(x)] across T trees', column: 3 },
      {
        id: 'anomaly_score', kind: 'compare', label: 'Anomaly score', sublabel: 's(x,n) = 2^(−E[h(x)]/c(n))',
        column: 4,
        analogy: 'Think of it as comparing how few cuts it took to isolate this bar against how many cuts an average, unremarkable bar needs.',
      },
      { id: 'output', kind: 'output', label: 'Normal / anomaly', sublabel: 'score > threshold, or top-k% by contamination', column: 5 },
    ],
    edges: chain('input', 'random_split', 'isolation_trees', 'path_length', 'anomaly_score', 'output'),
  }),

  'machine-learning-unsupervised-learning-anomaly-detection-lof-local-outlier-factor': blueprint({
    title: 'Local Outlier Factor (LOF)',
    subtitle: 'density of a point vs. density of its k neighbors',
    nodes: [
      inputNode(0),
      { id: 'knn', kind: 'compare', label: 'k-nearest neighbors', sublabel: 'Euclidean distance, k typically 10–50', column: 1 },
      {
        id: 'reach_dist', kind: 'compare', label: 'Reachability distance', sublabel: 'max(k-distance(o), dist(p,o))',
        column: 2,
      },
      {
        id: 'lrd', kind: 'pool', label: 'Local reachability density', sublabel: '1 / mean reachability distance to neighbors',
        column: 3,
        analogy: 'Think of it as measuring how crowded this bar\'s neighborhood feels — lots of close neighbors means dense, a few far-off ones means sparse.',
      },
      {
        id: 'lof_score', kind: 'compare', label: 'LOF score', sublabel: 'mean(neighbor LRD) / own LRD',
        column: 4,
        analogy: 'Think of it as asking "am I in a neighborhood as dense as my neighbors\' neighborhoods?" — a score near 1 says yes, a score far above 1 says this point is unusually isolated.',
      },
      { id: 'output', kind: 'output', label: 'Normal / anomaly', sublabel: 'LOF ≫ 1 → outlier', column: 5 },
    ],
    edges: chain('input', 'knn', 'reach_dist', 'lrd', 'lof_score', 'output'),
  }),

  'machine-learning-unsupervised-learning-anomaly-detection-one-class-svm': blueprint({
    title: 'One-Class SVM',
    subtitle: 'RBF hyperplane enclosing the normal region, ν-controlled margin',
    nodes: [
      inputNode(0), standardizeNode(1),
      { id: 'kernel', kind: 'compare', label: 'RBF kernel', sublabel: 'K(xᵢ,xⱼ) = exp(−γ‖xᵢ−xⱼ‖²)', column: 2 },
      {
        id: 'hyperplane', kind: 'head', label: 'Enclosing hyperplane', sublabel: 'f(x) = Σ αᵢK(xᵢ,x) − ρ',
        column: 3,
        analogy: 'Think of it as drawing the tightest possible fence around "normal" market behavior, using only examples that are already assumed normal — anything that falls outside the fence is flagged.',
      },
      { id: 'output', kind: 'output', label: 'Normal / anomaly', sublabel: 'f(x) ≥ 0 → normal', column: 4 },
      { id: 'margin_loss', kind: 'compare', label: 'ν-SVM objective', sublabel: '½‖w‖² + (1/νN)Σξᵢ − ρ', column: 5 },
      { id: 'fit', kind: 'compare', label: 'SMO solver', sublabel: 'solves dual for α, ρ', column: 6 },
    ],
    edges: [
      ...chain('input', 'standardize', 'kernel', 'hyperplane', 'output'),
      ['output', 'margin_loss', 'context'],
      ['margin_loss', 'fit', 'context'],
      ['fit', 'hyperplane', 'context', 'sets α, ρ'],
    ],
  }),

  'machine-learning-unsupervised-learning-anomaly-detection-robust-covariance-estimation': blueprint({
    title: 'Robust Covariance Estimation',
    subtitle: 'Minimum Covariance Determinant (MCD) + Mahalanobis distance',
    nodes: [
      inputNode(0), standardizeNode(1),
      {
        id: 'subset_select', kind: 'stochastic', label: 'Random h-subset', sublabel: 'h = ⌊(N+p+1)/2⌋ points',
        column: 2,
        analogy: 'Think of it as repeatedly guessing which half of the bars are the "clean" ones and fitting a bell curve to just that half.',
      },
      {
        id: 'mean_cov', kind: 'memory', label: 'Robust mean & covariance', sublabel: 'μ_h, Σ_h — refined each C-step',
        outShape: `${F} × ${F}`, column: 3,
      },
      {
        id: 'mahalanobis', kind: 'compare', label: 'Mahalanobis distance', sublabel: '√((x−μ_h)ᵀΣ_h⁻¹(x−μ_h))',
        column: 4,
        analogy: 'Think of it as ordinary distance, except it stretches or shrinks along each direction to account for how the "normal" cluster is actually shaped — not just how far, but how far given the correlations.',
      },
      { id: 'threshold_test', kind: 'compare', label: 'Threshold test', sublabel: 'MD(x) > √χ²_{p,1−α}', column: 5 },
      { id: 'output', kind: 'output', label: 'Normal / anomaly', column: 6 },
    ],
    edges: [
      ...chain('input', 'standardize', 'subset_select', 'mean_cov', 'mahalanobis', 'threshold_test', 'output'),
      ['mahalanobis', 'mean_cov', 'context', 're-estimate from the h smallest-distance points, repeat'],
    ],
  }),

  // ─── Clustering ─────────────────────────────────────────────────────────

  'machine-learning-unsupervised-learning-clustering-affinity-propagation': blueprint({
    title: 'Affinity Propagation',
    subtitle: 'exemplars chosen by iterative message passing, no k required',
    nodes: [
      inputNode(0),
      { id: 'similarity', kind: 'compare', label: 'Similarity matrix', sublabel: 's(i,j) = −‖xᵢ−xⱼ‖²', column: 1 },
      {
        id: 'responsibility', kind: 'memory', label: 'Responsibility r(i,k)', sublabel: 'how well k suits as exemplar for i',
        column: 2, lane: 0,
        analogy: 'Think of it as every bar sending a note to every candidate "typical bar": "here\'s how well you represent me, compared to my other options."',
      },
      { id: 'availability', kind: 'memory', label: 'Availability a(i,k)', sublabel: 'how appropriate k is, given everyone else\'s notes', column: 2, lane: 1 },
      {
        id: 'exemplar_select', kind: 'cluster', label: 'Exemplar assignment', sublabel: 'k* = argmax_k[r(i,k) + a(i,k)]',
        column: 3,
        analogy: 'Think of it as the message-passing settling down until every bar has picked the one "most typical" bar it most resembles — and that typical bar becomes its cluster.',
      },
      { id: 'output', kind: 'output', label: 'Cluster labels + exemplars', column: 4 },
    ],
    edges: [
      ['input', 'similarity', 'flow'],
      ['similarity', 'responsibility', 'flow'],
      ['responsibility', 'availability', 'context', 'r(i,k)'],
      ['availability', 'responsibility', 'context', 'a(i,k)'],
      ['responsibility', 'exemplar_select', 'flow'],
      ['availability', 'exemplar_select', 'flow'],
      ['exemplar_select', 'output', 'flow'],
    ],
  }),

  'machine-learning-unsupervised-learning-clustering-dbscan-density-based-spatial-clustering': blueprint({
    title: 'DBSCAN',
    subtitle: 'density-connected regions, arbitrary shape, marks noise',
    nodes: [
      inputNode(0), standardizeNode(1),
      { id: 'neighbor_query', kind: 'compare', label: 'ε-neighborhood query', sublabel: 'points within radius eps', column: 2 },
      {
        id: 'core_test', kind: 'compare', label: 'Core point test', sublabel: 'neighbor count ≥ min_samples?',
        column: 3,
        analogy: 'Think of it as asking whether this bar has enough close company to be the center of a crowd, or whether it\'s too alone to start one.',
      },
      {
        id: 'region_growing', kind: 'cluster', label: 'Region growing', sublabel: 'recursively absorb density-reachable points',
        column: 4,
        analogy: 'Think of it as a crowd growing by chain reaction — anyone close enough to a core member joins, then anyone close to them joins too.',
      },
      { id: 'output', kind: 'output', label: 'Cluster labels (−1 = noise)', column: 5 },
    ],
    edges: chain('input', 'standardize', 'neighbor_query', 'core_test', 'region_growing', 'output'),
  }),

  'machine-learning-unsupervised-learning-clustering-gaussian-mixture-model-gmm': blueprint({
    title: 'Gaussian Mixture Model (GMM)',
    subtitle: 'K=4 Gaussian components, EM-fit, soft assignment',
    nodes: [
      inputNode(0), standardizeNode(1),
      {
        id: 'e_step', kind: 'compare', label: 'E-step: responsibilities', sublabel: 'γ_ik = πₖN(x|μₖ,Σₖ) / Σⱼ πⱼN(x|μⱼ,Σⱼ)',
        column: 2,
        analogy: 'Think of it as asking, for this bar, "how much does each of the 4 candidate regimes think this bar belongs to it?" — never a hard yes/no, always a percentage.',
      },
      {
        id: 'm_step', kind: 'cluster', label: 'M-step: refit components', sublabel: 'update πₖ, μₖ, Σₖ from weighted points',
        column: 3,
        detail: { stored: 'K=4 components × (mean: 35 values, full covariance: 630 values, weight: 1 scalar)' },
      },
      { id: 'log_likelihood', kind: 'compare', label: 'Log-likelihood', sublabel: 'convergence check, Δ < ε', column: 4 },
      { id: 'output', kind: 'output', label: 'Soft cluster assignment', sublabel: 'one probability per component, summing to 1', outShape: `B × 4`, column: 5 },
    ],
    edges: [
      ...chain('input', 'standardize', 'e_step', 'm_step', 'log_likelihood', 'output'),
      ['log_likelihood', 'e_step', 'context', 'iterate E/M until Δlog-likelihood < ε'],
    ],
  }),

  'machine-learning-unsupervised-learning-clustering-hierarchical-clustering-agglomerative-divisive': blueprint({
    title: 'Hierarchical Clustering (Agglomerative)',
    subtitle: 'bottom-up merges by Ward linkage, cut the dendrogram at k',
    nodes: [
      inputNode(0), standardizeNode(1),
      { id: 'pairwise_distance', kind: 'compare', label: 'Pairwise cluster distance', sublabel: 'Ward: variance increase after merging', column: 2 },
      {
        id: 'merge', kind: 'cluster', label: 'Merge closest pair', sublabel: 'the two nearest clusters become one',
        column: 3,
        analogy: 'Think of it as two market regimes that behave almost identically being folded into a single one, over and over, building a family tree of regimes from the leaves up.',
      },
      { id: 'dendrogram_cut', kind: 'cluster', label: 'Dendrogram cut', sublabel: 'cut the tree at the height giving k clusters', column: 4 },
      { id: 'output', kind: 'output', label: 'Cluster labels', column: 5 },
    ],
    edges: [
      ...chain('input', 'standardize', 'pairwise_distance', 'merge', 'dendrogram_cut', 'output'),
      ['merge', 'pairwise_distance', 'context', 'recompute distances to the new merged cluster, repeat'],
    ],
  }),

  'machine-learning-unsupervised-learning-clustering-k-means-clustering': blueprint({
    title: 'K-Means Clustering',
    subtitle: 'k=4 centroids, alternating assign / average',
    nodes: [
      inputNode(0), standardizeNode(1),
      {
        id: 'init_centroids', kind: 'stochastic', label: 'k-means++ init', sublabel: 'seeded draw, weighted by distance',
        column: 2,
      },
      {
        id: 'assign', kind: 'cluster', label: 'Assign to nearest centroid', sublabel: 'argmin_k ‖x−μₖ‖²',
        column: 3,
        analogy: 'Think of it as every bar walking over to whichever of the 4 flagged "typical" bars it most resembles.',
      },
      {
        id: 'update_centroids', kind: 'pool', label: 'Recompute centroids', sublabel: 'μₖ = mean of assigned points',
        column: 4,
        analogy: 'Think of it as each group electing a new center of gravity — the average of everyone who just joined it.',
      },
      { id: 'output', kind: 'output', label: 'Cluster labels + centroids', column: 5 },
    ],
    edges: [
      ...chain('input', 'standardize', 'init_centroids', 'assign', 'update_centroids', 'output'),
      ['update_centroids', 'assign', 'context', 'repeat until WCSS stabilizes'],
    ],
  }),

  'machine-learning-unsupervised-learning-clustering-mean-shift-clustering': blueprint({
    title: 'Mean Shift Clustering',
    subtitle: 'points climb toward density peaks, no k required',
    nodes: [
      inputNode(0), standardizeNode(1),
      {
        id: 'kernel_density', kind: 'pool', label: 'Kernel-weighted local mean', sublabel: 'Gaussian kernel, bandwidth h',
        column: 2,
      },
      {
        id: 'shift', kind: 'memory', label: 'Shifted position', sublabel: 'x ← x + m(x), carried across iterations',
        column: 3,
        analogy: 'Think of it as every bar taking small steps uphill toward wherever its neighborhood is most crowded, and stopping once it reaches a peak.',
      },
      { id: 'mode_merge', kind: 'cluster', label: 'Merge modes', sublabel: 'peaks closer than h become one cluster', column: 4 },
      { id: 'output', kind: 'output', label: 'Cluster labels + modes', column: 5 },
    ],
    edges: [
      ...chain('input', 'standardize', 'kernel_density', 'shift', 'mode_merge', 'output'),
      ['shift', 'kernel_density', 'context', 'recompute local mean at the new position, repeat to convergence'],
    ],
  }),

  'machine-learning-unsupervised-learning-clustering-spectral-clustering': blueprint({
    title: 'Spectral Clustering',
    subtitle: 'graph Laplacian eigenvectors, then k-means in that space',
    nodes: [
      inputNode(0), standardizeNode(1),
      { id: 'similarity_graph', kind: 'compare', label: 'Similarity graph', sublabel: 'Gaussian kernel or k-NN edges', inShape: `B × ${F}`, outShape: 'N × N', column: 2 },
      {
        id: 'laplacian', kind: 'reshape', label: 'Graph Laplacian', sublabel: 'L = I − D⁻¹ᐟ²WD⁻¹ᐟ²',
        inShape: 'N × N', outShape: 'N × N', column: 3,
      },
      {
        id: 'eigen_embed', kind: 'embedding', label: 'Spectral embedding', sublabel: 'top-4 eigenvectors of L, smallest eigenvalues',
        inShape: 'N × N', outShape: `B × 4`, column: 4,
        analogy: 'Think of it as unrolling a spiral-shaped cluster of bars into a straight line first, using the connectivity of the similarity graph, THEN clustering the straightened version.',
      },
      { id: 'kmeans_final', kind: 'cluster', label: 'K-means on embedding', sublabel: 'k=4, ordinary Euclidean k-means', inShape: `B × 4`, column: 5 },
      { id: 'output', kind: 'output', label: 'Cluster labels', column: 6 },
    ],
    edges: chain('input', 'standardize', 'similarity_graph', 'laplacian', 'eigen_embed', 'kmeans_final', 'output'),
  }),

  // ─── Dimensionality reduction ───────────────────────────────────────────

  'machine-learning-unsupervised-learning-dimensionality-reduction-principal-component-analysis-pca': blueprint({
    title: 'Principal Component Analysis (PCA)',
    subtitle: 'orthogonal projection onto the 8 directions of maximum variance',
    nodes: [
      inputNode(0), standardizeNode(1),
      { id: 'covariance', kind: 'reshape', label: 'Covariance matrix', sublabel: 'C = X̃ᵀX̃ / (N−1)', inShape: `B × ${F}`, outShape: `${F} × ${F}`, column: 2, lane: 1 },
      {
        id: 'eigen_decompose', kind: 'embedding', label: 'Eigen-decomposition', sublabel: 'sort eigenvectors by eigenvalue (explained variance)',
        inShape: `${F} × ${F}`, outShape: `${F} × 8`, column: 3, lane: 1,
        analogy: 'Think of it as finding the single direction through the 35-dimensional cloud of bars along which they are most spread out, then the next most-spread direction perpendicular to it, and so on.',
      },
      {
        id: 'project', kind: 'linear', label: 'Project', sublabel: 'z = x̃ · U_k, no bias — data is already centered',
        inShape: `B × ${F}`, outShape: `B × 8`, params: P.linear(F, 8, false), column: 4,
      },
      { id: 'output', kind: 'output', label: 'Reduced representation', outShape: `B × 8`, column: 5 },
    ],
    edges: [
      ...chain('input', 'standardize', 'project', 'output'),
      ...chain('standardize', 'covariance', 'eigen_decompose'),
      ['eigen_decompose', 'project', 'context', 'the top 8 eigenvectors BECOME the projection weights'],
    ],
  }),

  'machine-learning-unsupervised-learning-dimensionality-reduction-independent-component-analysis-ica': blueprint({
    title: 'Independent Component Analysis (ICA)',
    subtitle: 'FastICA — unmix into 8 maximally non-Gaussian sources',
    nodes: [
      inputNode(0),
      { id: 'center_whiten', kind: 'norm', label: 'Center + whiten', sublabel: 'PCA/SVD whitening: unit variance, decorrelated', inShape: `B × ${F}`, outShape: `B × ${F}`, column: 1 },
      {
        id: 'unmixing', kind: 'linear', label: 'Unmixing matrix W', sublabel: 's = Wx',
        inShape: `B × ${F}`, outShape: `B × 8`, params: P.linear(F, 8, false), column: 2,
        analogy: 'Think of it as trying to un-blend 35 correlated indicators back into 8 independent underlying "drivers" — like separating overlapping conversations recorded on the same microphone.',
      },
      { id: 'output', kind: 'output', label: 'Independent components', outShape: `B × 8`, column: 3 },
      { id: 'nongaussian_max', kind: 'compare', label: 'Maximize non-Gaussianity', sublabel: 'negentropy J(y) ≈ [E{G(y)} − E{G(v)}]²', column: 4 },
      { id: 'orthogonalize', kind: 'reshape', label: 'Orthogonalize W', sublabel: 'Gram-Schmidt / symmetric — stops all 8 components collapsing onto one', column: 5 },
    ],
    edges: [
      ...chain('input', 'center_whiten', 'unmixing', 'output'),
      ['output', 'nongaussian_max', 'context', 'how non-Gaussian is each component so far'],
      ['nongaussian_max', 'orthogonalize', 'context'],
      ['orthogonalize', 'unmixing', 'context', 'updates W, repeat to convergence'],
    ],
  }),

  'machine-learning-unsupervised-learning-dimensionality-reduction-non-negative-matrix-factorization-nmf': blueprint({
    title: 'Non-Negative Matrix Factorization (NMF)',
    subtitle: 'V ≈ WH, all entries ≥ 0 — additive, interpretable parts',
    nodes: [
      inputNode(0),
      { id: 'nonneg_init', kind: 'stochastic', label: 'Non-negative init', sublabel: 'random or NNDSVD, W ≥ 0, H ≥ 0', column: 1 },
      {
        id: 'encode', kind: 'compare', label: 'Non-negative least squares', sublabel: 'solve h ≥ 0 minimizing ‖v − hH‖²',
        inShape: `B × ${F}`, outShape: `B × 8`, column: 2,
        analogy: 'Think of it as describing this bar as a positive-only recipe of 8 basic "ingredient" patterns — never a negative amount of any ingredient, only additive combinations.',
      },
      { id: 'output', kind: 'output', label: 'Reduced representation h', outShape: `B × 8`, column: 3 },
      {
        id: 'decode', kind: 'linear', label: 'Basis H', sublabel: 'r=8 non-negative basis rows, reconstructs v̂ = hH',
        inShape: `B × 8`, outShape: `B × ${F}`, params: P.linear(8, F, false), column: 3, lane: 1,
      },
      { id: 'recon_error', kind: 'compare', label: 'Reconstruction error', sublabel: '‖V − WH‖²_F', inShape: `B × ${F}`, column: 4, lane: 1 },
    ],
    edges: [
      ...chain('input', 'nonneg_init', 'encode', 'output'),
      ['encode', 'decode', 'flow'],
      ['decode', 'recon_error', 'flow'],
      ['input', 'recon_error', 'context', 'the original V it is scored against'],
      ['recon_error', 'decode', 'context', 'multiplicative update, iterate'],
    ],
  }),

  // ─── Manifold learning ──────────────────────────────────────────────────

  'machine-learning-unsupervised-learning-manifold-learning-manifold-learning-isomap-lle': blueprint({
    title: 'Manifold Learning (Isomap)',
    subtitle: 'geodesic distances over a k-NN graph, embedded via classical MDS',
    nodes: [
      inputNode(0), standardizeNode(1),
      { id: 'knn_graph', kind: 'compare', label: 'k-NN graph', sublabel: 'edge weight = Euclidean distance', column: 2 },
      {
        id: 'geodesic_distance', kind: 'compare', label: 'Geodesic distance', sublabel: 'shortest path over the graph (Dijkstra)',
        column: 3,
        analogy: 'Think of it as measuring distance the way a hiker would — along the trail over the terrain, not as the crow flies through solid rock.',
      },
      { id: 'mds_embed', kind: 'embedding', label: 'Classical MDS', sublabel: 'eigen-decompose double-centered D², top-2', column: 4 },
      { id: 'output', kind: 'output', label: '2D embedding', outShape: `B × 2`, column: 5 },
    ],
    edges: chain('input', 'standardize', 'knn_graph', 'geodesic_distance', 'mds_embed', 'output'),
  }),

  'machine-learning-unsupervised-learning-manifold-learning-t-sne-t-distributed-stochastic-neighbor-embedding': blueprint({
    title: 't-SNE',
    subtitle: 'matches high-dim Gaussian neighborhoods to low-dim t-distributed ones',
    nodes: [
      inputNode(0), standardizeNode(1),
      {
        id: 'affinity_hi', kind: 'compare', label: 'High-dim affinities P', sublabel: 'Gaussian kernel, perplexity-tuned σᵢ',
        column: 2,
      },
      { id: 'init_embed', kind: 'stochastic', label: 'Initialize Y', sublabel: 'random or PCA-seeded 2D points', column: 3 },
      {
        id: 'affinity_lo', kind: 'compare', label: 'Low-dim affinities Q', sublabel: 'Student-t kernel: (1+‖yᵢ−yⱼ‖²)⁻¹',
        column: 4,
        analogy: 'Think of it as arranging the bars on a 2D page so that bars which were close neighbors in 35-D stay close on the page — the heavy-tailed t-distribution gives crowded points room to spread out.',
      },
      {
        id: 'kl_minimize', kind: 'compare', label: 'Minimize KL(P‖Q)', sublabel: 'gradient descent, early exaggeration first',
        column: 5,
      },
      { id: 'output', kind: 'output', label: '2D embedding', outShape: `B × 2`, column: 6 },
    ],
    edges: [
      ...chain('input', 'standardize', 'affinity_hi', 'init_embed', 'affinity_lo', 'kl_minimize', 'output'),
      ['kl_minimize', 'affinity_lo', 'context', 'update Y, recompute Q, repeat'],
    ],
  }),

  'machine-learning-unsupervised-learning-manifold-learning-umap-uniform-manifold-approximation-and-projection': blueprint({
    title: 'UMAP',
    subtitle: 'fuzzy simplicial set matched across dimensions, cross-entropy optimized',
    nodes: [
      inputNode(0), standardizeNode(1),
      {
        id: 'knn_graph', kind: 'compare', label: 'Fuzzy k-NN graph', sublabel: 'w_ij = exp(−(dist−ρᵢ)/σᵢ)',
        column: 2,
      },
      { id: 'init_embed', kind: 'stochastic', label: 'Initialize Y', sublabel: 'spectral or random 2D points', column: 3 },
      {
        id: 'lowdim_membership', kind: 'compare', label: 'Low-dim membership', sublabel: 'q_ij = 1/(1+a‖yᵢ−yⱼ‖^2b)',
        column: 4,
        analogy: 'Think of it as attractive and repulsive forces between points on the page — neighbors pull toward each other, everyone else pushes apart — settling into a layout that mirrors the original neighborhood structure.',
      },
      { id: 'cross_entropy', kind: 'compare', label: 'Minimize cross-entropy', sublabel: 'SGD, attraction + repulsion', column: 5 },
      { id: 'output', kind: 'output', label: '2D/3D embedding', outShape: `B × 2`, column: 6 },
    ],
    edges: [
      ...chain('input', 'standardize', 'knn_graph', 'init_embed', 'lowdim_membership', 'cross_entropy', 'output'),
      ['cross_entropy', 'lowdim_membership', 'context', 'update Y, repeat'],
    ],
  }),

  // ─── Matrix factorization & decomposition ───────────────────────────────

  'machine-learning-unsupervised-learning-matrix-factorization-decomposition-autoencoder-unsupervised': blueprint({
    title: 'Autoencoder (Unsupervised)',
    subtitle: '35 → 64 → 8 → 64 → 35, MSE reconstruction',
    nodes: [
      inputNode(0),
      { id: 'encoder', kind: 'linear', label: 'Encoder', sublabel: `${F} → 64, ReLU`, inShape: `B × ${F}`, outShape: `B × 64`, params: P.linear(F, 64), column: 1 },
      {
        id: 'bottleneck', kind: 'linear', label: 'Bottleneck', sublabel: '64 → 8 (latent dim)', inShape: `B × 64`, outShape: `B × 8`, params: P.linear(64, 8), column: 2,
        analogy: 'Think of it as squeezing this bar\'s 35 measurements through a narrow gate that can only carry 8 numbers — forcing the network to keep only what matters most to reconstruct the bar.',
      },
      { id: 'latent', kind: 'output', label: 'Latent code z', outShape: `B × 8`, column: 3 },
      { id: 'decoder', kind: 'linear', label: 'Decoder', sublabel: '8 → 64, ReLU', inShape: `B × 8`, outShape: `B × 64`, params: P.linear(8, 64), column: 4 },
      { id: 'reconstruct', kind: 'linear', label: 'Reconstruction layer', sublabel: `64 → ${F}`, inShape: `B × 64`, outShape: `B × ${F}`, params: P.linear(64, F), column: 5 },
      { id: 'recon_out', kind: 'output', label: 'x̂ reconstruction', sublabel: 'training signal only', outShape: `B × ${F}`, column: 6 },
      {
        id: 'recon_loss', kind: 'compare', label: 'MSE', sublabel: '‖x − x̂‖²',
        inShape: `B × ${F}`, column: 7,
        analogy: 'Think of it as grading the network purely on how well it can rebuild the original 35 numbers from its own 8-number summary — the better the rebuild, the more useful the summary.',
      },
    ],
    edges: [
      ...chain('input', 'encoder', 'bottleneck', 'latent'),
      ['latent', 'decoder', 'flow'],
      ...chain('decoder', 'reconstruct', 'recon_out'),
      ['recon_out', 'recon_loss', 'context'],
      ['recon_loss', 'encoder', 'context', 'backprop'],
      ['recon_loss', 'bottleneck', 'context', 'backprop'],
      ['recon_loss', 'decoder', 'context', 'backprop'],
      ['recon_loss', 'reconstruct', 'context', 'backprop'],
    ],
  }),

  'machine-learning-unsupervised-learning-matrix-factorization-decomposition-deep-clustering-network': blueprint({
    title: 'Deep Clustering Network (DCN)',
    subtitle: 'autoencoder + Student-t soft clustering, jointly optimized',
    nodes: [
      inputNode(0),
      { id: 'encoder', kind: 'linear', label: 'Encoder', sublabel: `${F} → 64, ReLU`, inShape: `B × ${F}`, outShape: `B × 64`, params: P.linear(F, 64), column: 1 },
      { id: 'latent', kind: 'linear', label: 'Latent z', sublabel: '64 → 8', inShape: `B × 64`, outShape: `B × 8`, params: P.linear(64, 8), column: 2 },
      {
        id: 'soft_assign', kind: 'cluster', label: 'Soft cluster membership', sublabel: 'q_ik ∝ (1+‖z−μₖ‖²)⁻¹, K=4 centroids',
        inShape: `B × 8`, outShape: `B × 4`, params: P.embedding(4, 8), column: 3,
        detail: { formula: 'P.embedding(4 centroids, 8-dim latent) = 32 — the centroids are trainable, moved by the same optimizer as the weights' },
        analogy: 'Think of it as compressing each bar down to 8 numbers, THEN asking which of 4 learned "regime centers" that compressed bar sits closest to — the compressing and the grouping are trained together, not as separate steps.',
      },
      { id: 'output', kind: 'output', label: 'Soft cluster assignment', outShape: `B × 4`, column: 4 },
      { id: 'decoder', kind: 'linear', label: 'Decoder', sublabel: '8 → 64, ReLU', inShape: `B × 8`, outShape: `B × 64`, params: P.linear(8, 64), column: 3, lane: 1 },
      { id: 'reconstruct', kind: 'linear', label: 'Reconstruction', sublabel: `64 → ${F}`, inShape: `B × 64`, outShape: `B × ${F}`, params: P.linear(64, F), column: 4, lane: 1 },
      { id: 'recon_compare', kind: 'compare', label: 'Reconstruction MSE', inShape: `B × ${F}`, column: 5, lane: 1 },
      {
        id: 'target_sharpen', kind: 'compare', label: 'Sharpen target', sublabel: 'p_ik ∝ q_ik² / Σq, then KL(P‖Q)',
        inShape: `B × 4`, column: 5, lane: 0,
      },
      {
        id: 'combined_loss', kind: 'compare', label: 'Combined loss', sublabel: 'L_recon + λ·L_cluster',
        column: 6,
      },
    ],
    edges: [
      ...chain('input', 'encoder', 'latent', 'soft_assign', 'output'),
      ['latent', 'decoder', 'flow'],
      ...chain('decoder', 'reconstruct'),
      ['reconstruct', 'recon_compare', 'context', 'scored against the original x'],
      ['soft_assign', 'target_sharpen', 'context', 'current q_ik'],
      ['target_sharpen', 'soft_assign', 'context', 'sharpened target, iterate'],
      ['recon_compare', 'combined_loss', 'context'],
      ['target_sharpen', 'combined_loss', 'context'],
      ['combined_loss', 'encoder', 'context', 'joint backprop'],
      ['combined_loss', 'decoder', 'context', 'joint backprop'],
      ['combined_loss', 'soft_assign', 'context', 'joint backprop, moves centroids too'],
    ],
  }),

  // ─── Self-organizing systems ────────────────────────────────────────────

  'machine-learning-unsupervised-learning-self-organizing-systems-self-organizing-maps-som': blueprint({
    title: 'Self-Organizing Maps (SOM)',
    subtitle: '10×10 codebook grid, competitive + neighborhood learning',
    nodes: [
      inputNode(0), standardizeNode(1),
      { id: 'topology_grid', kind: 'reshape', label: 'Fixed 2D lattice', sublabel: '10×10 grid, neighbor adjacency never changes', column: 2, lane: 1 },
      {
        id: 'bmu_search', kind: 'compare', label: 'Best matching unit', sublabel: 'argmin_j ‖x − w_j‖',
        inShape: `B × ${F}`, outShape: `B × 1`, column: 2,
        analogy: 'Think of it as this bar looking across a 10×10 grid of "prototype" bars and finding the single closest match.',
      },
      {
        id: 'weight_update', kind: 'memory', label: 'Codebook weights', sublabel: `100 nodes × ${F} dims, pulled toward x`,
        outShape: `100 × ${F}`, params: P.embedding(100, F), column: 3,
        detail: { formula: `P.embedding(100 grid nodes, ${F} dims) = 3,500`, neighborhood: 'Gaussian, radius σ(t) shrinks over training' },
        analogy: 'Think of it as the winning prototype — and its neighbors on the grid — nudging themselves slightly toward this bar, so nearby grid cells end up representing similar market conditions.',
      },
      { id: 'output', kind: 'output', label: 'Grid coordinates / cluster', outShape: `B × 2`, column: 4 },
    ],
    edges: [
      ...chain('input', 'standardize', 'bmu_search', 'weight_update', 'output'),
      ['topology_grid', 'weight_update', 'context', 'which nodes count as neighbors of the winner'],
      ['weight_update', 'bmu_search', 'context', 'next input, updated codebook'],
    ],
  }),
};
