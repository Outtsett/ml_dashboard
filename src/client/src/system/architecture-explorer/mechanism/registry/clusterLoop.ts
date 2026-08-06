/**
 * cluster-loop family — models whose mechanism is an ITERATED loop over points
 * that repeats until the structure settles.
 *
 * Every entry is researched from the markdown spec named in `specPath`, under
 * ALGO_MODELS_ROOT (default
 * E:/source/repos/Trading/_architecture/educational/algo_models).
 *
 * KERNELS ARE NOT SHARED ACROSS THE FAMILY. These ten models animate with the
 * same visual vocabulary — points, membership, an iteration counter, a
 * monotone objective — but their algorithms genuinely differ. DBSCAN grows
 * density-reachable regions; Mean Shift climbs a kernel density estimate;
 * Affinity Propagation passes responsibility/availability messages; Hierarchical
 * merges by linkage. Only the entries carrying `kernelId: 'kmeans'` are
 * reproduced by compute/kmeans.ts. The rest declare `kernelId: null` and the UI
 * states that their engine is pending, because drawing a k-means run under the
 * name "DBSCAN" would be a plausible-looking lie.
 */

import type { MechanismSpec } from './types';

/** Every clustering entry below is browse-only in the catalog except SOM/DCN. */
const BROWSE_ONLY = {
  templateId: 'none',
  note:
    'Browse-only catalog spec — this repo has no runner for it, so pressing ' +
    'Run would train nothing. The mechanism above is the published algorithm.',
} as const;

const MLP_NOTE = {
  templateId: 'pytorch_mlp',
  note:
    'This repo has no runner for this architecture. Training this spec renders ' +
    'the generic pytorch_mlp template — a plain MLP over the 35-feature vector, ' +
    'with none of the mechanism shown above.',
} as const;

export const CLUSTER_LOOP: MechanismSpec[] = [
  {
    catalogKey: 'k-means-clustering',
    name: 'K-Means Clustering',
    archetype: 'cluster-loop',
    provenance: 'analytic',
    specPath: 'Machine Learning/Unsupervised Learning/Clustering/K-Means Clustering.md',
    analogy:
      'Think of it as sorting every bar into k trading "moods", then moving each ' +
      'mood to the average of the bars that chose it — repeat until nobody moves.',
    stages: [
      { id: 'points', role: 'input', label: 'Feature points', detail: 'one point per bar' },
      { id: 'init', role: 'transform', label: 'Initialize centroids', detail: 'random or k-means++' },
      { id: 'assign', role: 'transform', label: 'Assign', detail: 'each point to its nearest centroid' },
      { id: 'update', role: 'update', label: 'Update', detail: 'each centroid to the mean of its members' },
      { id: 'wcss', role: 'score', label: 'WCSS', detail: 'within-cluster sum of squares' },
    ],
    beats: [
      {
        id: 'hard',
        at: 'assign',
        label: 'hard assignment',
        detail:
          'Each point belongs to exactly one cluster — unlike GMM, no point is ' +
          'allowed to be partly one regime and partly another.',
      },
      {
        id: 'spherical',
        at: 'assign',
        label: 'spherical assumption',
        detail:
          'Nearest-centroid assignment under Euclidean distance implicitly ' +
          'assumes clusters are spherical and of similar extent.',
      },
      {
        id: 'wcss-descent',
        at: 'wcss',
        label: 'WCSS never increases',
        detail:
          'Assignment and update each minimize the within-cluster sum of ' +
          'squares over one variable, so the objective descends monotonically ' +
          'and the loop provably terminates.',
      },
    ],
    repoRunner: BROWSE_ONLY,
    kernelId: 'kmeans',
  },

  {
    catalogKey: 'gaussian-mixture-model-gmm',
    name: 'Gaussian Mixture Model (GMM)',
    archetype: 'cluster-loop',
    provenance: 'analytic',
    specPath: 'Machine Learning/Unsupervised Learning/Clustering/Gaussian Mixture Model (GMM).md',
    analogy:
      'Think of it as K-Means that admits uncertainty: a bar can be 70% one ' +
      'regime and 30% another, and each regime has its own spread and tilt.',
    stages: [
      { id: 'points', role: 'input', label: 'Feature points', detail: 'one point per bar' },
      { id: 'init', role: 'transform', label: 'Initialize components', detail: 'weights, means, covariances' },
      { id: 'estep', role: 'transform', label: 'E-step', detail: 'responsibilities gamma_ik' },
      { id: 'mstep', role: 'update', label: 'M-step', detail: 're-fit pi_k, mu_k, Sigma_k' },
      { id: 'll', role: 'score', label: 'Log-likelihood' },
    ],
    beats: [
      {
        id: 'soft',
        at: 'estep',
        label: 'soft assignment',
        detail:
          'Each point holds a posterior probability across all components rather ' +
          'than one hard label, so overlapping regimes stay representable.',
      },
      {
        id: 'cov',
        at: 'mstep',
        label: 'full covariance',
        detail:
          'Each component carries its own covariance matrix, so clusters can be ' +
          'elliptical and tilted — the shape K-Means cannot express.',
      },
      {
        id: 'em',
        at: 'll',
        label: 'EM monotonicity',
        detail:
          'Expectation-Maximization cannot decrease the log-likelihood, which is ' +
          'the convergence guarantee replacing K-Means\u2019 WCSS argument.',
      },
    ],
    repoRunner: BROWSE_ONLY,
    kernelId: null,
  },

  {
    catalogKey: 'dbscan-density-based-spatial-clustering',
    name: 'DBSCAN (Density-Based Spatial Clustering of Applications with Noise)',
    archetype: 'cluster-loop',
    provenance: 'analytic',
    specPath:
      'Machine Learning/Unsupervised Learning/Clustering/DBSCAN (Density-Based Spatial Clustering).md',
    analogy:
      'Think of it as walking the tape and growing a cluster outward while bars ' +
      'stay crowded — the moment the crowd thins, the cluster stops and the ' +
      'stragglers are called noise.',
    stages: [
      { id: 'points', role: 'input', label: 'Feature points', detail: 'all unvisited' },
      { id: 'core', role: 'transform', label: 'Core points', detail: '>= min_samples neighbours within eps' },
      { id: 'expand', role: 'transform', label: 'Density-reachable expansion' },
      { id: 'noise', role: 'output', label: 'Noise', detail: 'label -1' },
    ],
    beats: [
      {
        id: 'no-k',
        at: 'core',
        label: 'no k to choose',
        detail:
          'The cluster count is discovered from density rather than specified up ' +
          'front, unlike K-Means which requires K in advance.',
      },
      {
        id: 'arbitrary-shape',
        at: 'expand',
        label: 'arbitrary shapes',
        detail:
          'Clusters grow along chains of density-reachable points, so they can ' +
          'be any shape rather than spherical blobs.',
      },
      {
        id: 'outliers',
        at: 'noise',
        label: 'explicit noise label',
        detail:
          'Points that are neither core nor border are labelled -1 rather than ' +
          'forced into a cluster, which is why DBSCAN is robust to outliers.',
      },
    ],
    repoRunner: BROWSE_ONLY,
    kernelId: null,
  },

  {
    catalogKey: 'mean-shift-clustering',
    name: 'Mean Shift Clustering',
    archetype: 'cluster-loop',
    provenance: 'analytic',
    specPath: 'Machine Learning/Unsupervised Learning/Clustering/Mean Shift Clustering.md',
    analogy:
      'Think of it as letting every bar roll uphill on a density map until it ' +
      'reaches a peak — the bars that arrive at the same peak are one cluster.',
    stages: [
      { id: 'points', role: 'input', label: 'Feature points' },
      { id: 'kde', role: 'transform', label: 'Kernel density estimate', detail: 'bandwidth h' },
      { id: 'shift', role: 'update', label: 'Mean shift vector', detail: 'm(x) toward higher density' },
      { id: 'modes', role: 'output', label: 'Modes', detail: 'merged when closer than h' },
    ],
    beats: [
      {
        id: 'bandwidth',
        at: 'kde',
        label: 'bandwidth sets granularity',
        detail:
          'The single hyperparameter h controls neighbourhood size, and through ' +
          'it the number of clusters — there is no K to set.',
      },
      {
        id: 'ascent',
        at: 'shift',
        label: 'gradient ascent on density',
        detail:
          'Each point moves to the weighted mean of its neighbourhood, which is ' +
          'a step up the kernel density estimate rather than toward a centroid.',
      },
      {
        id: 'merge',
        at: 'modes',
        label: 'mode merging',
        detail:
          'Modes closer than the bandwidth are merged, so the final cluster ' +
          'count emerges from the data instead of being specified.',
      },
    ],
    repoRunner: BROWSE_ONLY,
    kernelId: null,
  },

  {
    catalogKey: 'spectral-clustering',
    name: 'Spectral Clustering',
    archetype: 'cluster-loop',
    provenance: 'analytic',
    specPath: 'Machine Learning/Unsupervised Learning/Clustering/Spectral Clustering.md',
    analogy:
      'Think of it as redrawing the map before clustering: bars become nodes in ' +
      'a similarity graph, the graph is flattened into a space where the groups ' +
      'pull apart, and only then are centroids run.',
    stages: [
      { id: 'points', role: 'input', label: 'Feature points' },
      { id: 'graph', role: 'transform', label: 'Similarity graph', detail: 'Gaussian kernel, bandwidth sigma' },
      { id: 'laplacian', role: 'transform', label: 'Normalized Laplacian', detail: 'L = I - D^-1/2 W D^-1/2' },
      { id: 'embed', role: 'latent', label: 'Eigenvector embedding', detail: 'K smallest non-zero eigenvalues' },
      { id: 'kmeans', role: 'update', label: 'K-means on the embedding' },
    ],
    beats: [
      {
        id: 'graph-first',
        at: 'graph',
        label: 'connectivity, not proximity',
        detail:
          'Similarity is expressed as a graph, so points far apart in raw space ' +
          'can still be one cluster if they are densely connected through others.',
      },
      {
        id: 'spectrum',
        at: 'embed',
        label: 'the spectral step',
        detail:
          'The eigenvectors of the graph Laplacian give a space in which ' +
          'non-convex clusters become linearly separable — this is the step that ' +
          'makes the name.',
      },
      {
        id: 'kmeans-tail',
        at: 'kmeans',
        label: 'K-means only at the end',
        detail:
          'The final partition is ordinary K-means, but run on the embedding ' +
          'rather than the raw features, which is why it can find shapes plain ' +
          'K-means cannot.',
      },
    ],
    repoRunner: BROWSE_ONLY,
    kernelId: null,
  },

  {
    catalogKey: 'hierarchical-clustering-agglomerative-divisive',
    name: 'Hierarchical Clustering (Agglomerative, Divisive)',
    archetype: 'cluster-loop',
    provenance: 'analytic',
    specPath:
      'Machine Learning/Unsupervised Learning/Clustering/Hierarchical Clustering (Agglomerative, Divisive).md',
    analogy:
      'Think of it as building a family tree of bars: start with everyone alone, ' +
      'repeatedly marry the two closest groups, and cut the tree wherever you ' +
      'want that many clusters.',
    stages: [
      { id: 'points', role: 'input', label: 'Each point its own cluster' },
      { id: 'linkage', role: 'transform', label: 'Linkage criterion', detail: 'single / complete / average / Ward' },
      { id: 'merge', role: 'update', label: 'Merge the two closest clusters' },
      { id: 'dendrogram', role: 'output', label: 'Dendrogram', detail: 'cut height selects the cluster count' },
    ],
    beats: [
      {
        id: 'no-k-upfront',
        at: 'dendrogram',
        label: 'K chosen after the fact',
        detail:
          'The whole hierarchy is built once, then cut at a height — the cluster ' +
          'count is a reading of the result rather than an input to it.',
      },
      {
        id: 'linkage-shape',
        at: 'linkage',
        label: 'linkage decides the shape',
        detail:
          'Single linkage chains along thin structures, complete linkage forces ' +
          'compact groups, and Ward minimizes the variance increase on merge.',
      },
      {
        id: 'irreversible',
        at: 'merge',
        label: 'merges are irreversible',
        detail:
          'A greedy merge is never undone, so an early mistake propagates all ' +
          'the way up the tree — the cost of not iterating like K-Means does.',
      },
    ],
    repoRunner: BROWSE_ONLY,
    kernelId: null,
  },

  {
    catalogKey: 'affinity-propagation',
    name: 'Affinity Propagation',
    archetype: 'cluster-loop',
    provenance: 'analytic',
    specPath: 'Machine Learning/Unsupervised Learning/Clustering/Affinity Propagation.md',
    analogy:
      'Think of it as bars campaigning to represent each other: each sends out ' +
      'how well another would speak for it, and how available that one is to ' +
      'take the job, until a set of representatives emerges.',
    stages: [
      { id: 'similarity', role: 'input', label: 'Similarity matrix', detail: 's(i,j) = -||xi - xj||^2' },
      { id: 'responsibility', role: 'transform', label: 'Responsibility r(i,k)', detail: 'how well k suits i as exemplar' },
      { id: 'availability', role: 'transform', label: 'Availability a(i,k)', detail: 'how appropriate choosing k is' },
      { id: 'exemplars', role: 'output', label: 'Exemplars', detail: 'argmax_k r(i,k) + a(i,k)' },
    ],
    beats: [
      {
        id: 'real-exemplars',
        at: 'exemplars',
        label: 'centres are real data points',
        detail:
          'Each cluster is represented by an actual bar chosen as exemplar, not ' +
          'a synthetic mean — so the centre is always something that happened.',
      },
      {
        id: 'messages',
        at: 'responsibility',
        label: 'message passing',
        detail:
          'Responsibility and availability are exchanged between every pair and ' +
          'iterated to a fixed point, replacing the assign/update alternation.',
      },
      {
        id: 'preference',
        at: 'similarity',
        label: 'preference sets the count',
        detail:
          'The diagonal s(k,k) controls how readily a point becomes an exemplar, ' +
          'so the cluster count is tuned through preference rather than set as K.',
      },
    ],
    repoRunner: BROWSE_ONLY,
    kernelId: null,
  },

  {
    catalogKey: 'semi-supervised-clustering',
    name: 'Semi-Supervised Clustering',
    archetype: 'cluster-loop',
    provenance: 'analytic',
    specPath:
      'Machine Learning/Semi-Supervised Learning/Clustering-Based Methods/Semi-Supervised Clustering.md',
    analogy:
      'Think of it as K-Means with a few hand-labelled bars pinned in place, ' +
      'plus rules saying "these two are the same regime" and "these two never are".',
    stages: [
      { id: 'points', role: 'input', label: 'Mostly unlabeled points' },
      { id: 'constraints', role: 'input', label: 'Pairwise constraints', detail: 'must-link / cannot-link' },
      { id: 'assign', role: 'transform', label: 'Constrained assignment', detail: 'COP-KMeans' },
      { id: 'update', role: 'update', label: 'Update centroids' },
    ],
    beats: [
      {
        id: 'ml-cl',
        at: 'constraints',
        label: 'must-link / cannot-link',
        detail:
          'Supervision enters as pairwise constraints rather than labels, so a ' +
          'trader can say two bars belong together without naming the regime.',
      },
      {
        id: 'seeded',
        at: 'assign',
        label: 'seeded initialization',
        detail:
          'Labelled points seed the initial centroids, which removes the bad ' +
          'local minima plain K-Means can fall into.',
      },
      {
        id: 'infeasible',
        at: 'assign',
        label: 'constraints can fail',
        detail:
          'COP-KMeans refuses assignments that violate a constraint, and if none ' +
          'is feasible the algorithm can fail to converge at all.',
      },
    ],
    repoRunner: BROWSE_ONLY,
    kernelId: null,
  },

  {
    catalogKey: 'self-organizing-maps-som',
    name: 'Self-Organizing Maps (SOM)',
    archetype: 'cluster-loop',
    provenance: 'trained-live',
    specPath:
      'Machine Learning/Unsupervised Learning/Self-Organizing Systems/Self-Organizing Maps (SOM).md',
    analogy:
      'Think of it as a rubber grid laid over the market: each bar tugs the ' +
      'nearest grid knot toward itself and drags the neighbouring knots along, ' +
      'until the grid has moulded to the shape of the data.',
    stages: [
      { id: 'grid', role: 'input', label: 'Node lattice', detail: 'm x n grid, weight vector per node' },
      { id: 'bmu', role: 'transform', label: 'Best matching unit', detail: 'argmin_j ||x - w_j||' },
      { id: 'neighbourhood', role: 'update', label: 'Neighbourhood update', detail: 'Gaussian h, radius sigma(t)' },
      { id: 'decay', role: 'update', label: 'Decay', detail: 'learning rate and radius shrink over t' },
    ],
    beats: [
      {
        id: 'topology',
        at: 'neighbourhood',
        label: 'topology preservation',
        detail:
          'Updating the winner\u2019s neighbours as well as the winner keeps nearby ' +
          'grid nodes responsive to similar bars, so the map stays continuous.',
      },
      {
        id: 'competitive',
        at: 'bmu',
        label: 'competitive learning',
        detail:
          'Only the closest node wins the input, which is what makes this ' +
          'competitive rather than a gradient step over all nodes.',
      },
      {
        id: 'annealing',
        at: 'decay',
        label: 'annealed radius',
        detail:
          'The neighbourhood radius and learning rate both shrink over time, so ' +
          'the map first organizes globally and then refines locally.',
      },
    ],
    repoRunner: MLP_NOTE,
    kernelId: null,
  },

  {
    catalogKey: 'deep-clustering-network',
    name: 'Deep Clustering Network (DCN)',
    archetype: 'cluster-loop',
    provenance: 'trained-live',
    specPath:
      'Machine Learning/Unsupervised Learning/Matrix Factorization & Decomposition/Deep Clustering Network.md',
    analogy:
      'Think of it as learning a better chart before clustering it: an ' +
      'autoencoder compresses each bar, and the clustering objective pushes back ' +
      'on that compression until the latent space is one clusters live in.',
    stages: [
      { id: 'input', role: 'input', label: 'Feature vector' },
      { id: 'encoder', role: 'transform', label: 'Encoder', detail: 'z = f_theta(x)' },
      { id: 'latent', role: 'latent', label: 'Latent space', detail: 'd < p' },
      { id: 'decoder', role: 'transform', label: 'Decoder', detail: 'x_hat = g_phi(z)' },
      { id: 'loss', role: 'loss', label: 'L_recon + lambda L_cluster' },
    ],
    beats: [
      {
        id: 'joint',
        at: 'loss',
        label: 'joint objective',
        detail:
          'Reconstruction and clustering losses are optimized together, so the ' +
          'embedding is shaped by the clustering rather than fixed beforehand.',
      },
      {
        id: 'kl-target',
        at: 'loss',
        label: 'self-sharpening target',
        detail:
          'The clustering loss is KL(Q||P) against an auxiliary distribution ' +
          'built from Q itself, which sharpens confident assignments over time.',
      },
      {
        id: 'lambda',
        at: 'loss',
        label: 'lambda trades the two off',
        detail:
          'Too much clustering weight collapses the latent space; too little and ' +
          'it is just an autoencoder that happens to be clustered afterwards.',
      },
    ],
    repoRunner: MLP_NOTE,
    kernelId: null,
  },
];
