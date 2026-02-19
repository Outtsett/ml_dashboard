export type ModelCategory = 'unsupervised' | 'supervised' | 'self-supervised' | 'semi-supervised';
export type ModelSubcategory = 'dimensionality-reduction' | 'clustering' | 'anomaly-detection' | 'self-organizing' | 'linear' | 'ensemble' | 'boosting' | 'meta-learner' | 'deep-learning' | 'classification' | 'regression' | 'sequence';

export interface MLModelDefinition {
  id: string;
  name: string;
  shortName: string;
  category: ModelCategory;
  subcategory: ModelSubcategory;
  overview: string;
  principles: string[];
  applications: string[];
  keyFeatures: string[];
  hyperparameters: {
    name: string;
    type: 'number' | 'select' | 'boolean';
    default: number | string | boolean;
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
    description: string;
  }[];
}

export const unsupervisedModels: MLModelDefinition[] = [
  {
    id: 'pca',
    name: 'Principal Component Analysis',
    shortName: 'PCA',
    category: 'unsupervised',
    subcategory: 'dimensionality-reduction',
    overview: 'Transforms data into a lower-dimensional space by projecting it onto principal components that maximize variance. Widely used to reduce noise and extract key features from high-dimensional market data.',
    principles: [
      'Variance Maximization: Identifies orthogonal principal components capturing maximum variance',
      'Linear Transformation: Projects data onto eigenvectors of the covariance matrix',
      'Feature Decorrelation: Ensures components are uncorrelated, addressing multicollinearity',
      'Lossy Compression: Minimizes reconstruction error for retained components'
    ],
    applications: [
      'Reduces dimensionality of OHLC and indicator data, improving prediction accuracy by 5-10%',
      'Compresses market data for clustering or classification tasks',
      'Filters noise from price movements for cleaner signals',
      'Identifies principal factors driving instrument correlations'
    ],
    keyFeatures: [
      'Fast computation for moderate datasets',
      'Eliminates multicollinearity common in market indicators',
      'Components represent linear combinations tied to market factors',
      'Scalable with randomized SVD for large datasets'
    ],
    hyperparameters: [
      { name: 'n_components', type: 'number', default: 3, min: 1, max: 50, description: 'Number of components to retain' },
      { name: 'svd_solver', type: 'select', default: 'auto', options: ['auto', 'full', 'arpack', 'randomized'], description: 'SVD solver algorithm' },
      { name: 'whiten', type: 'boolean', default: false, description: 'Whiten components to unit variance' }
    ]
  },
  {
    id: 'ica',
    name: 'Independent Component Analysis',
    shortName: 'ICA',
    category: 'unsupervised',
    subcategory: 'dimensionality-reduction',
    overview: 'Separates a multivariate signal into additive, statistically independent components. Unlike PCA which focuses on variance, ICA seeks components that are maximally independent, ideal for blind source separation of market signals.',
    principles: [
      'Statistical Independence: Assumes observed data is a linear mixture of independent sources',
      'Non-Gaussianity: Maximizes non-Gaussianity via kurtosis or negentropy',
      'Linear Mixing: Models data as X = AS where S contains independent components',
      'Blind Source Separation: Separates mixed signals without prior knowledge'
    ],
    applications: [
      'Extracts independent market signals (trend, volatility) improving prediction accuracy by 5-10%',
      'Reduces dimensionality while preserving key information',
      'Separates noise from meaningful price movements',
      'Identifies independent factors driving instrument correlations'
    ],
    keyFeatures: [
      'Signal separation unlike PCA\'s variance-based approach',
      'Captures non-linear relationships in market data',
      'Robust to noisy financial data with whitening',
      'Flexible non-linearity functions (logcosh, exp, cube)'
    ],
    hyperparameters: [
      { name: 'n_components', type: 'number', default: 3, min: 1, max: 50, description: 'Number of independent components' },
      { name: 'algorithm', type: 'select', default: 'parallel', options: ['parallel', 'deflation'], description: 'ICA algorithm' },
      { name: 'fun', type: 'select', default: 'logcosh', options: ['logcosh', 'exp', 'cube'], description: 'Non-linearity function' },
      { name: 'max_iter', type: 'number', default: 200, min: 50, max: 1000, description: 'Maximum iterations' }
    ]
  },
  {
    id: 'nmf',
    name: 'Non-Negative Matrix Factorization',
    shortName: 'NMF',
    category: 'unsupervised',
    subcategory: 'dimensionality-reduction',
    overview: 'Decomposes a non-negative data matrix into two lower-rank non-negative matrices, revealing latent features. Unlike PCA/ICA, NMF ensures all components are non-negative, making it interpretable for inherently positive data.',
    principles: [
      'Non-Negative Decomposition: Approximates V ≈ WH where W, H are non-negative',
      'Latent Features: Identifies additive components capturing underlying patterns',
      'Additive Structure: Components combine linearly with positive weights',
      'Objective: Minimizes reconstruction error via Frobenius norm or divergence'
    ],
    applications: [
      'Extracts latent market signals improving prediction accuracy by 5-8%',
      'Reduces dimensionality for clustering/classification of market patterns',
      'Identifies additive market behaviors (momentum, mean reversion)',
      'Decomposes instrument correlations into independent factors'
    ],
    keyFeatures: [
      'Non-negative components resemble market factors like trends/volatility',
      'Interpretable additive representations',
      'Handles noisy data with proper initialization',
      'Adapts to various loss functions and sparsity levels'
    ],
    hyperparameters: [
      { name: 'n_components', type: 'number', default: 3, min: 1, max: 50, description: 'Number of components' },
      { name: 'init', type: 'select', default: 'nndsvd', options: ['random', 'nndsvd', 'nndsvda', 'nndsvdar'], description: 'Initialization method' },
      { name: 'solver', type: 'select', default: 'mu', options: ['cd', 'mu'], description: 'Solver (coordinate descent or multiplicative update)' },
      { name: 'beta_loss', type: 'select', default: 'frobenius', options: ['frobenius', 'kullback-leibler'], description: 'Loss function' }
    ]
  },
  {
    id: 'tsne',
    name: 't-Distributed Stochastic Neighbor Embedding',
    shortName: 't-SNE',
    category: 'unsupervised',
    subcategory: 'dimensionality-reduction',
    overview: 'Projects high-dimensional data into 2D/3D for visualization by preserving local structures through probability-based modeling. Captures non-linear manifolds and mitigates crowding with t-distributions.',
    principles: [
      'Local Structure Preservation: Models high-dimensional similarities as conditional probabilities',
      'Probability-Based Embedding: Uses Gaussian (high-dim) and t-distributions (low-dim)',
      'Non-Linear Reduction: Handles complex manifolds unlike PCA',
      'Crowding Mitigation: t-distributions enhance cluster separation'
    ],
    applications: [
      'Visualizes market patterns in OHLC and indicator data',
      'Reveals clusters of similar price behaviors (volatility regimes)',
      'Projects high-dimensional data into 2D/3D for exploratory analysis',
      'Enhances downstream clustering by reducing dimensionality'
    ],
    keyFeatures: [
      'Captures complex non-linear structures',
      'Emphasizes local neighborhoods for pattern visualization',
      'Visual embeddings reveal market behaviors intuitively',
      'Flexible preprocessing with PCA for high-dimensional data'
    ],
    hyperparameters: [
      { name: 'n_components', type: 'number', default: 2, min: 2, max: 3, description: 'Output dimensions (2 or 3)' },
      { name: 'perplexity', type: 'number', default: 30, min: 5, max: 50, description: 'Balances local/global structure' },
      { name: 'learning_rate', type: 'number', default: 200, min: 10, max: 1000, description: 'Learning rate' },
      { name: 'n_iter', type: 'number', default: 1000, min: 250, max: 5000, description: 'Maximum iterations' }
    ]
  },
  {
    id: 'umap',
    name: 'Uniform Manifold Approximation and Projection',
    shortName: 'UMAP',
    category: 'unsupervised',
    subcategory: 'dimensionality-reduction',
    overview: 'Projects high-dimensional data using a topological approach, preserving both local and global structures. Faster and more scalable than t-SNE with superior preservation of data topology.',
    principles: [
      'Topological Structure Preservation: Models data as a manifold preserving neighborhoods',
      'Riemannian Geometry: Constructs fuzzy simplicial complex to approximate manifold',
      'Cross-Entropy Optimization: Minimizes difference between high/low-dim fuzzy sets',
      'Scalability: Efficient nearest-neighbor algorithms for large datasets'
    ],
    applications: [
      'Visualizes market patterns aiding insights and strategy development',
      'Reveals clusters of similar price behaviors (volatility regimes)',
      'Reduces dimensionality for clustering/predictive models (+5-10% performance)',
      'Visualizes correlations/groupings of instruments'
    ],
    keyFeatures: [
      'Preserves both local and global topology',
      'Faster and more memory-efficient than t-SNE',
      'Native out-of-sample embedding support',
      'Adapts to custom metrics and supervised tasks'
    ],
    hyperparameters: [
      { name: 'n_components', type: 'number', default: 2, min: 2, max: 100, description: 'Output dimensions' },
      { name: 'n_neighbors', type: 'number', default: 15, min: 5, max: 100, description: 'Neighbors for local structure' },
      { name: 'min_dist', type: 'number', default: 0.1, min: 0.0, max: 1.0, step: 0.1, description: 'Minimum distance in embedding' },
      { name: 'metric', type: 'select', default: 'euclidean', options: ['euclidean', 'manhattan', 'cosine', 'correlation'], description: 'Distance metric' }
    ]
  },
  {
    id: 'manifold',
    name: 'Manifold Learning (Isomap/LLE)',
    shortName: 'Manifold',
    category: 'unsupervised',
    subcategory: 'dimensionality-reduction',
    overview: 'Non-linear dimensionality reduction techniques that discover low-dimensional manifolds in high-dimensional data. Isomap preserves geodesic (global) distances, while LLE preserves local linear relationships between neighbors.',
    principles: [
      'Isomap: Preserves geodesic distances via graph shortest paths (global structure)',
      'LLE: Models each point as linear combination of neighbors (local structure)',
      'Non-Linear Mapping: Both capture curved manifolds unlike PCA',
      'Eigenvalue Methods: Use spectral decomposition for embedding computation'
    ],
    applications: [
      'Reduces dimensionality improving downstream model accuracy by 5-8%',
      'Compresses data for clustering/classification of market patterns',
      'Uncovers non-linear market behaviors (trend, mean reversion cycles)',
      'Projects high-dimensional data into 2D/3D for visual analysis'
    ],
    keyFeatures: [
      'Isomap: Captures global manifold geometry via geodesic distances',
      'LLE: Preserves local linear relationships between neighbors',
      'Both handle complex non-linear structures',
      'Flexible neighborhood definitions (k-NN or radius)'
    ],
    hyperparameters: [
      { name: 'algorithm', type: 'select', default: 'isomap', options: ['isomap', 'lle', 'modified_lle'], description: 'Manifold algorithm' },
      { name: 'n_components', type: 'number', default: 2, min: 2, max: 10, description: 'Number of dimensions' },
      { name: 'n_neighbors', type: 'number', default: 5, min: 2, max: 50, description: 'Number of neighbors' },
      { name: 'metric', type: 'select', default: 'euclidean', options: ['euclidean', 'manhattan', 'minkowski'], description: 'Distance metric (Isomap only)' }
    ]
  },
  {
    id: 'kmeans',
    name: 'K-Means Clustering',
    shortName: 'K-Means',
    category: 'unsupervised',
    subcategory: 'clustering',
    overview: 'Partitions data into K clusters by minimizing within-cluster variance. Assigns points to clusters based on proximity to centroids, iteratively refining until convergence. Simple, efficient, and scalable.',
    principles: [
      'Centroid-Based: Assigns points to nearest cluster centroid',
      'Iterative Optimization: Updates centroids and reassigns points until convergence',
      'Euclidean Distance: Assumes spherical clusters',
      'Hard Clustering: Each point belongs to exactly one cluster'
    ],
    applications: [
      'Clusters similar price patterns achieving silhouette scores of 0.4-0.6',
      'Groups trading behaviors (scalping vs. swing trading)',
      'Identifies recurring candlestick/indicator patterns',
      'Clusters correlated instruments for diversification'
    ],
    keyFeatures: [
      'Fast convergence for moderate datasets',
      'Simple to implement and interpret',
      'Scalable with mini-batch variants',
      'Clear centroid-based clusters'
    ],
    hyperparameters: [
      { name: 'n_clusters', type: 'number', default: 3, min: 2, max: 20, description: 'Number of clusters' },
      { name: 'init', type: 'select', default: 'k-means++', options: ['k-means++', 'random'], description: 'Initialization method' },
      { name: 'max_iter', type: 'number', default: 300, min: 100, max: 1000, description: 'Maximum iterations' },
      { name: 'n_init', type: 'number', default: 10, min: 1, max: 50, description: 'Number of initializations' }
    ]
  },
  {
    id: 'dbscan',
    name: 'Density-Based Spatial Clustering',
    shortName: 'DBSCAN',
    category: 'unsupervised',
    subcategory: 'clustering',
    overview: 'Groups points based on density, identifying clusters of arbitrary shape and marking low-density points as noise. Does not require specifying cluster count and is robust to outliers.',
    principles: [
      'Density-Based: Groups points in high-density regions',
      'Core Points: Points with min_samples neighbors within eps radius',
      'Noise Detection: Low-density points classified as outliers',
      'Arbitrary Shapes: Captures non-spherical clusters'
    ],
    applications: [
      'Clusters similar price patterns (trending vs. ranging)',
      'Groups trading behaviors by density',
      'Identifies recurring patterns for strategy development',
      'Marks noise points as potential market anomalies'
    ],
    keyFeatures: [
      'Automatically determines cluster count',
      'Identifies outliers as noise',
      'Captures arbitrary cluster shapes',
      'Robust to varying densities with proper tuning'
    ],
    hyperparameters: [
      { name: 'eps', type: 'number', default: 0.5, min: 0.01, max: 10, step: 0.1, description: 'Neighborhood radius' },
      { name: 'min_samples', type: 'number', default: 5, min: 2, max: 50, description: 'Minimum points for core status' },
      { name: 'metric', type: 'select', default: 'euclidean', options: ['euclidean', 'manhattan', 'cosine'], description: 'Distance metric' }
    ]
  },
  {
    id: 'gmm',
    name: 'Gaussian Mixture Model',
    shortName: 'GMM',
    category: 'unsupervised',
    subcategory: 'clustering',
    overview: 'Represents data as a weighted sum of Gaussian distributions, each with its own mean and covariance. Provides probabilistic soft clustering with uncertainty estimates.',
    principles: [
      'Mixture Model: Weighted sum of K Gaussian components',
      'Probabilistic Clustering: Assigns points with probabilities (soft clustering)',
      'Expectation-Maximization: Optimizes parameters iteratively',
      'Flexible Shapes: Models elliptical clusters via covariance matrices'
    ],
    applications: [
      'Clusters market conditions achieving silhouette scores of 0.3-0.5',
      'Groups trading behaviors with uncertainty quantification',
      'Identifies recurring patterns for strategy development',
      'Flags low-probability points as potential anomalies'
    ],
    keyFeatures: [
      'Soft assignments reflecting uncertainty',
      'Flexible elliptical cluster shapes',
      'Density estimation for anomaly detection',
      'Gaussian parameters reveal cluster characteristics'
    ],
    hyperparameters: [
      { name: 'n_components', type: 'number', default: 3, min: 2, max: 20, description: 'Number of Gaussian components' },
      { name: 'covariance_type', type: 'select', default: 'full', options: ['full', 'tied', 'diag', 'spherical'], description: 'Covariance type' },
      { name: 'max_iter', type: 'number', default: 100, min: 50, max: 500, description: 'Maximum EM iterations' },
      { name: 'init_params', type: 'select', default: 'kmeans', options: ['kmeans', 'random'], description: 'Initialization method' }
    ]
  },
  {
    id: 'hierarchical',
    name: 'Hierarchical Clustering',
    shortName: 'Hierarchical',
    category: 'unsupervised',
    subcategory: 'clustering',
    overview: 'Builds a hierarchy of clusters by either merging smaller clusters (agglomerative) or splitting larger ones (divisive). Creates a dendrogram for multi-scale analysis.',
    principles: [
      'Hierarchical Structure: Organizes data into cluster trees',
      'Agglomerative: Bottom-up merging based on similarity',
      'Divisive: Top-down recursive splitting',
      'Linkage Criteria: Single, complete, average, or Ward\'s method'
    ],
    applications: [
      'Clusters similar patterns achieving silhouette scores of 0.3-0.6',
      'Groups trading behaviors hierarchically',
      'Clusters correlated instruments for diversification',
      'Reveals hierarchical structures in patterns'
    ],
    keyFeatures: [
      'Multi-scale clustering for flexible analysis',
      'No predefined cluster count needed',
      'Dendrogram reveals pattern relationships',
      'Robust to outliers with appropriate linkage'
    ],
    hyperparameters: [
      { name: 'n_clusters', type: 'number', default: 3, min: 2, max: 20, description: 'Number of clusters' },
      { name: 'linkage', type: 'select', default: 'ward', options: ['ward', 'complete', 'average', 'single'], description: 'Linkage criterion' },
      { name: 'metric', type: 'select', default: 'euclidean', options: ['euclidean', 'manhattan', 'cosine'], description: 'Distance metric' }
    ]
  },
  {
    id: 'affinity',
    name: 'Affinity Propagation',
    shortName: 'Affinity Prop',
    category: 'unsupervised',
    subcategory: 'clustering',
    overview: 'Identifies clusters by exchanging messages between data points to determine exemplars (cluster centers). Does not require specifying cluster count, adapting to data structure.',
    principles: [
      'Message Passing: Points exchange responsibility/availability messages',
      'Similarity Matrix: Quantifies relationships between points',
      'Exemplar-Based: Real data points serve as cluster centers',
      'Adaptive: Automatically determines cluster count'
    ],
    applications: [
      'Groups similar patterns with coherent clusters',
      'Identifies distinct trading behaviors',
      'Detects recurring patterns for strategy development',
      'Clusters correlated instruments for diversification'
    ],
    keyFeatures: [
      'Automatically determines cluster count',
      'Real data points as cluster centers',
      'Supports custom similarity metrics',
      'Handles noisy data with proper preprocessing'
    ],
    hyperparameters: [
      { name: 'damping', type: 'number', default: 0.5, min: 0.5, max: 0.99, step: 0.05, description: 'Damping factor to prevent oscillation' },
      { name: 'max_iter', type: 'number', default: 200, min: 100, max: 500, description: 'Maximum iterations' },
      { name: 'convergence_iter', type: 'number', default: 15, min: 5, max: 50, description: 'Iterations for convergence check' }
    ]
  },
  {
    id: 'meanshift',
    name: 'Mean Shift Clustering',
    shortName: 'Mean Shift',
    category: 'unsupervised',
    subcategory: 'clustering',
    overview: 'Identifies clusters by iteratively shifting points toward regions of higher density. Converges to density maxima (modes) without requiring cluster count specification.',
    principles: [
      'Density-Based: Identifies high-density regions as clusters',
      'Mean Shift Iteration: Points move toward neighborhood means',
      'Kernel Bandwidth: Controls neighborhood size',
      'Mode Detection: Converges to local density maxima'
    ],
    applications: [
      'Clusters similar patterns achieving silhouette scores of 0.3-0.5',
      'Groups trading behaviors by density modes',
      'Identifies recurring patterns for strategy development',
      'Flags low-density points as potential anomalies'
    ],
    keyFeatures: [
      'Automatically determines cluster count',
      'Captures arbitrary cluster shapes',
      'Robust to varying density',
      'Supports custom kernels and metrics'
    ],
    hyperparameters: [
      { name: 'bandwidth', type: 'number', default: 0.5, min: 0.1, max: 5.0, step: 0.1, description: 'Kernel bandwidth (auto if null)' },
      { name: 'bin_seeding', type: 'boolean', default: true, description: 'Use binning for speed' },
      { name: 'cluster_all', type: 'boolean', default: true, description: 'Assign all points to clusters' }
    ]
  },
  {
    id: 'spectral',
    name: 'Spectral Clustering',
    shortName: 'Spectral',
    category: 'unsupervised',
    subcategory: 'clustering',
    overview: 'Partitions data using spectral properties of a similarity graph. Transforms data using eigenvectors of graph Laplacian, enabling clustering of non-linearly separable data.',
    principles: [
      'Graph Representation: Nodes are data points, edges are similarities',
      'Spectral Embedding: Uses Laplacian eigenvectors for projection',
      'Clustering in Embedding: Applies K-means to embedded data',
      'Non-Linear: Captures complex cluster shapes via graph connectivity'
    ],
    applications: [
      'Clusters similar patterns achieving silhouette scores of 0.4-0.6',
      'Groups trading behaviors via graph structure',
      'Identifies non-linear patterns for strategy development',
      'Clusters correlated instruments for diversification'
    ],
    keyFeatures: [
      'Captures complex non-convex cluster shapes',
      'Leverages data relationships via graphs',
      'No shape assumptions',
      'Flexible similarity functions'
    ],
    hyperparameters: [
      { name: 'n_clusters', type: 'number', default: 3, min: 2, max: 20, description: 'Number of clusters' },
      { name: 'affinity', type: 'select', default: 'rbf', options: ['rbf', 'nearest_neighbors', 'precomputed'], description: 'Similarity measure' },
      { name: 'gamma', type: 'number', default: 1.0, min: 0.01, max: 10, step: 0.1, description: 'RBF kernel coefficient' },
      { name: 'n_neighbors', type: 'number', default: 10, min: 2, max: 50, description: 'Neighbors for nearest_neighbors affinity' }
    ]
  },
  {
    id: 'isolation_forest',
    name: 'Isolation Forest',
    shortName: 'Isolation Forest',
    category: 'unsupervised',
    subcategory: 'anomaly-detection',
    overview: 'Isolates anomalies by constructing random decision trees. Anomalies are few and different, requiring fewer splits to isolate. Achieves 90-95% precision in market anomaly detection.',
    principles: [
      'Random Partitioning: Recursively splits data with random features/thresholds',
      'Anomaly Isolation: Anomalies have shorter path lengths',
      'Ensemble Learning: Combines multiple trees for robust scoring',
      'No Distribution Assumption: Handles complex data distributions'
    ],
    applications: [
      'Detects unusual price movements (flash crashes) with 90-95% precision',
      'Identifies fraudulent/manipulative trading patterns',
      'Flags high-risk market conditions for stop-loss',
      'Removes outliers for improved model training'
    ],
    keyFeatures: [
      'Linear time complexity O(T m log m)',
      'No distributional assumptions',
      'Scalable with subsampling',
      'Detects rare events efficiently'
    ],
    hyperparameters: [
      { name: 'n_estimators', type: 'number', default: 100, min: 50, max: 500, description: 'Number of isolation trees' },
      { name: 'max_samples', type: 'number', default: 256, min: 64, max: 1024, description: 'Subsample size per tree' },
      { name: 'contamination', type: 'number', default: 0.01, min: 0.001, max: 0.5, step: 0.01, description: 'Expected anomaly ratio' }
    ]
  },
  {
    id: 'lof',
    name: 'Local Outlier Factor',
    shortName: 'LOF',
    category: 'unsupervised',
    subcategory: 'anomaly-detection',
    overview: 'Identifies outliers by measuring local density deviation relative to neighbors. Points with significantly lower density than neighbors are anomalies. Achieves 85-90% precision.',
    principles: [
      'Local Density: Computes density based on k-nearest neighbor distances',
      'Outlier Scoring: LOF > 1 indicates lower density (anomaly)',
      'No Distribution Assumption: Handles non-linear data',
      'Neighborhood-Based: Robust to global density variations'
    ],
    applications: [
      'Detects unusual price movements with 85-90% precision',
      'Identifies manipulative trading/fraud',
      'Flags high-risk market conditions',
      'Monitors abnormal trading volumes/volatility'
    ],
    keyFeatures: [
      'Local sensitivity to density variations',
      'No distributional assumptions',
      'Interpretable LOF scores',
      'Robust to heterogeneous data'
    ],
    hyperparameters: [
      { name: 'n_neighbors', type: 'number', default: 20, min: 5, max: 100, description: 'Number of neighbors' },
      { name: 'contamination', type: 'number', default: 0.01, min: 0.001, max: 0.5, step: 0.01, description: 'Expected anomaly ratio' },
      { name: 'metric', type: 'select', default: 'euclidean', options: ['euclidean', 'manhattan', 'cosine'], description: 'Distance metric' }
    ]
  },
  {
    id: 'ocsvm',
    name: 'One-Class SVM',
    shortName: 'One-Class SVM',
    category: 'unsupervised',
    subcategory: 'anomaly-detection',
    overview: 'Learns a decision boundary around normal data, identifying outliers outside this boundary. Uses kernel functions for non-linear boundaries. Achieves 85-90% precision.',
    principles: [
      'Maximum Margin: Finds hyperplane separating data from origin',
      'Kernel Trick: Models non-linear boundaries with RBF/polynomial',
      'Outlier Detection: Points far from hyperplane are anomalies',
      'Regularization: Parameter ν controls outlier fraction'
    ],
    applications: [
      'Detects unusual price movements with 85-90% precision',
      'Identifies fraudulent/manipulative trading',
      'Flags high-risk market conditions',
      'Monitors abnormal trading volumes'
    ],
    keyFeatures: [
      'Robust decision boundary around normal data',
      'Handles high-dimensional data with kernels',
      'No labels required',
      'Effective in noisy financial data'
    ],
    hyperparameters: [
      { name: 'nu', type: 'number', default: 0.01, min: 0.001, max: 0.5, step: 0.01, description: 'Upper bound on outlier fraction' },
      { name: 'kernel', type: 'select', default: 'rbf', options: ['linear', 'rbf', 'poly', 'sigmoid'], description: 'Kernel type' },
      { name: 'gamma', type: 'select', default: 'scale', options: ['scale', 'auto'], description: 'Kernel coefficient' }
    ]
  },
  {
    id: 'robust_covariance',
    name: 'Robust Covariance Estimation',
    shortName: 'Robust Cov',
    category: 'unsupervised',
    subcategory: 'anomaly-detection',
    overview: 'Models data distribution using robust covariance estimation (MCD), identifying outliers as points with low probability under multivariate Gaussian. Achieves 80-90% precision.',
    principles: [
      'Multivariate Gaussian Model: Assumes normal data follows Gaussian distribution',
      'Robust Estimation: MCD minimizes outlier impact on covariance',
      'Mahalanobis Distance: Measures distance from distribution center',
      'Robustness: Handles contaminated datasets'
    ],
    applications: [
      'Detects unusual price movements with 80-90% precision',
      'Identifies manipulative trading/fraud',
      'Flags high-risk market conditions',
      'Removes outliers for cleaner training data'
    ],
    keyFeatures: [
      'Minimizes outlier impact with MCD',
      'Captures feature correlations via covariance',
      'Interpretable Mahalanobis distances',
      'Handles high-dimensional data'
    ],
    hyperparameters: [
      { name: 'support_fraction', type: 'number', default: 0.75, min: 0.5, max: 1.0, step: 0.05, description: 'Fraction of clean data' },
      { name: 'contamination', type: 'number', default: 0.01, min: 0.001, max: 0.5, step: 0.01, description: 'Expected anomaly ratio' }
    ]
  },
  {
    id: 'som',
    name: 'Self-Organizing Map',
    shortName: 'SOM',
    category: 'unsupervised',
    subcategory: 'self-organizing',
    overview: 'Neural network that maps high-dimensional data onto a 2D grid while preserving topological relationships. Used for clustering, visualization, and dimensionality reduction.',
    principles: [
      'Topological Preservation: Similar inputs map to nearby nodes',
      'Competitive Learning: Nodes compete to represent input data',
      'Neighborhood Adaptation: Nearby nodes update together',
      'Non-Linear Mapping: Captures complex patterns unlike PCA'
    ],
    applications: [
      'Clusters and visualizes market patterns with quantization errors of 0.05-0.2',
      'Groups trading behaviors for strategy development',
      'Maps recurring price/indicator patterns',
      'Identifies outliers as points far from grid nodes'
    ],
    keyFeatures: [
      'Preserves data relationships in 2D grid',
      'Captures non-linear patterns',
      'Intuitive visualization for market analysis',
      'Flexible grid configurations'
    ],
    hyperparameters: [
      { name: 'x', type: 'number', default: 10, min: 5, max: 50, description: 'Grid width' },
      { name: 'y', type: 'number', default: 10, min: 5, max: 50, description: 'Grid height' },
      { name: 'sigma', type: 'number', default: 1.0, min: 0.1, max: 5.0, step: 0.1, description: 'Initial neighborhood radius' },
      { name: 'learning_rate', type: 'number', default: 0.5, min: 0.1, max: 1.0, step: 0.1, description: 'Initial learning rate' },
      { name: 'epochs', type: 'number', default: 100, min: 50, max: 1000, description: 'Training epochs' }
    ]
  }
];

export const supervisedModels: MLModelDefinition[] = [
  {
    id: 'linear-regression',
    name: 'Linear Regression',
    shortName: 'LinReg',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Predicts a continuous target as a linear combination of input features. Foundational model for price movement and volatility prediction, serving as a baseline for comparison with more complex models.',
    principles: [
      'Linear Relationship: Models target as y = Xw + b + ε where w are coefficients',
      'Least Squares: Minimizes sum of squared residuals to find best-fit line',
      'Interpretability: Coefficients directly indicate feature impacts on predictions',
      'Closed-Form Solution: Computes optimal parameters via normal equation'
    ],
    applications: [
      'Predicts price movements or volatility as baseline with 0.80-0.85 R²',
      'Models linear trends in technical indicators (moving averages)',
      'Estimates expected returns or drawdowns for portfolio sizing',
      'Quantifies impact of features (RSI, MACD) on price'
    ],
    keyFeatures: [
      'Simple to implement and computationally efficient',
      'Coefficients directly indicate feature impacts',
      'Fast training scaling well to moderate datasets',
      'Serves as baseline for evaluating complex models'
    ],
    hyperparameters: [
      { name: 'fit_intercept', type: 'boolean', default: true, description: 'Whether to calculate intercept' },
      { name: 'normalize', type: 'boolean', default: false, description: 'Normalize regressors before fitting' }
    ]
  },
  {
    id: 'ridge-regression',
    name: 'Ridge Regression',
    shortName: 'Ridge',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Extends linear regression with L2 regularization to penalize large coefficients, improving stability and handling multicollinearity in correlated market features.',
    principles: [
      'L2 Regularization: Adds λ||w||² penalty shrinking coefficients toward zero',
      'Multicollinearity Handling: Stabilizes estimates for correlated features',
      'Bias-Variance Trade-Off: Balances model fit and complexity via λ',
      'Closed-Form Solution: (X\'X + λI)⁻¹X\'y computes optimal weights'
    ],
    applications: [
      'Predicts price movements improving RMSE by 5-10% over linear regression',
      'Models expected returns for portfolio optimization',
      'Captures linear trends in technical indicators',
      'Handles highly correlated market features effectively'
    ],
    keyFeatures: [
      'Stabilizes coefficients for correlated financial features',
      'L2 regularization reduces overfitting in noisy data',
      'Fast training with closed-form or gradient descent',
      'Coefficients reveal feature impacts (reduced by shrinkage)'
    ],
    hyperparameters: [
      { name: 'alpha', type: 'number', default: 1.0, min: 0.01, max: 100, step: 0.1, description: 'Regularization strength' },
      { name: 'solver', type: 'select', default: 'auto', options: ['auto', 'svd', 'cholesky', 'lsqr', 'sag'], description: 'Solver algorithm' },
      { name: 'fit_intercept', type: 'boolean', default: true, description: 'Whether to calculate intercept' }
    ]
  },
  {
    id: 'lasso-regression',
    name: 'Lasso Regression',
    shortName: 'Lasso',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Linear model with L1 regularization that promotes sparsity by driving some coefficients to zero, performing automatic feature selection for high-dimensional market data.',
    principles: [
      'L1 Regularization: Adds λ||w||₁ penalty inducing sparsity',
      'Feature Selection: Zeros out irrelevant features automatically',
      'Shrinkage: Non-zero coefficients shrunk toward zero',
      'Coordinate Descent: Efficient optimization via soft-thresholding'
    ],
    applications: [
      'Predicts price movements improving RMSE by 5-10% over linear regression',
      'Identifies key technical indicators (MACD, Bollinger Bands) for strategies',
      'Models expected returns for portfolio optimization',
      'Handles high-dimensional derived features efficiently'
    ],
    keyFeatures: [
      'Automatic feature selection via L1 penalty',
      'Produces sparse, interpretable models',
      'Robust to noisy financial data',
      'Non-zero coefficients reveal key predictors'
    ],
    hyperparameters: [
      { name: 'alpha', type: 'number', default: 0.1, min: 0.001, max: 10, step: 0.01, description: 'Regularization strength' },
      { name: 'max_iter', type: 'number', default: 1000, min: 100, max: 10000, description: 'Maximum iterations' },
      { name: 'tol', type: 'number', default: 0.0001, min: 0.00001, max: 0.01, step: 0.0001, description: 'Convergence tolerance' }
    ]
  },
  {
    id: 'elasticnet-regression',
    name: 'ElasticNet Regression',
    shortName: 'ElasticNet',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Combines L1 and L2 regularization to balance feature selection (sparsity) and coefficient shrinkage (stability), ideal for correlated high-dimensional market data.',
    principles: [
      'Hybrid Regularization: λ[α||w||₁ + (1-α)/2||w||²] combines L1 and L2',
      'Feature Selection: L1 component zeros out irrelevant features',
      'Multicollinearity: L2 component stabilizes correlated feature coefficients',
      'Mixing Parameter: α ∈ [0,1] controls L1/L2 balance'
    ],
    applications: [
      'Predicts price movements improving RMSE by 5-10% over linear regression',
      'Selects key technical indicators while handling correlations',
      'Models expected returns for risk management',
      'Handles high-dimensional multi-timeframe indicators'
    ],
    keyFeatures: [
      'Balances sparsity and stability for financial features',
      'Groups correlated features more effectively than Lasso',
      'Robust to noisy, multicollinear datasets',
      'Coefficients reveal feature impacts on predictions'
    ],
    hyperparameters: [
      { name: 'alpha', type: 'number', default: 0.5, min: 0.01, max: 10, step: 0.1, description: 'Overall regularization strength' },
      { name: 'l1_ratio', type: 'number', default: 0.5, min: 0, max: 1, step: 0.1, description: 'L1/L2 mixing (0=Ridge, 1=Lasso)' },
      { name: 'max_iter', type: 'number', default: 1000, min: 100, max: 10000, description: 'Maximum iterations' }
    ]
  },
  {
    id: 'bayesian-ridge',
    name: 'Bayesian Ridge Regression',
    shortName: 'BayesRidge',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Extends ridge regression with Bayesian inference to estimate parameters and hyperparameters, providing uncertainty quantification critical for risk management in trading.',
    principles: [
      'Bayesian Inference: Treats coefficients as random variables with priors',
      'Automatic Hyperparameter Tuning: Learns regularization from data',
      'Uncertainty Quantification: Provides confidence intervals for predictions',
      'Gaussian Assumptions: Prior w ~ N(0, λ⁻¹I), noise ~ N(0, σ²)'
    ],
    applications: [
      'Predicts price movements with uncertainty bounds for risk assessment',
      'Quantifies prediction confidence for stop-loss and position sizing',
      'Models linear relationships with built-in regularization',
      'Identifies influential features via posterior variance'
    ],
    keyFeatures: [
      'Provides prediction confidence intervals for risk management',
      'Automatically tunes regularization parameters',
      'Handles noisy, multicollinear data robustly',
      'Posterior analysis reveals feature importance'
    ],
    hyperparameters: [
      { name: 'alpha_init', type: 'number', default: 1, min: 0.000001, max: 10, description: 'Initial noise precision' },
      { name: 'lambda_init', type: 'number', default: 1, min: 0.000001, max: 10, description: 'Initial coefficient precision' },
      { name: 'n_iter', type: 'number', default: 300, min: 50, max: 1000, description: 'Maximum iterations' },
      { name: 'compute_score', type: 'boolean', default: true, description: 'Compute log marginal likelihood' }
    ]
  },
  {
    id: 'lars',
    name: 'Least Angle Regression',
    shortName: 'LARS',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Efficiently computes the entire Lasso regularization path by iteratively adding features in a stepwise manner, ideal for high-dimensional feature selection in market data.',
    principles: [
      'Stepwise Selection: Adds features iteratively minimizing angle with residual',
      'Regularization Path: Computes solutions for all L1 penalty strengths',
      'Equiangular Direction: Moves equally toward all active features',
      'Efficient Computation: O(Np min(N,p)) for full path'
    ],
    applications: [
      'Predicts price movements improving RMSE by 5-10% over linear regression',
      'Identifies key technical indicators for trading strategies',
      'Efficiently selects features from high-dimensional indicator sets',
      'Models expected returns for portfolio optimization'
    ],
    keyFeatures: [
      'Produces sparse models via L1-style selection',
      'Computes full regularization path efficiently',
      'Handles correlated features effectively',
      'Non-zero coefficients reveal key predictors'
    ],
    hyperparameters: [
      { name: 'n_nonzero_coefs', type: 'number', default: 500, min: 1, max: 1000, description: 'Maximum non-zero coefficients' },
      { name: 'fit_intercept', type: 'boolean', default: true, description: 'Whether to fit intercept' },
      { name: 'eps', type: 'number', default: 0.0000000001, min: 0.0000000001, max: 0.001, description: 'Machine precision regularization' }
    ]
  },
  {
    id: 'logistic-regression',
    name: 'Logistic Regression',
    shortName: 'LogReg',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Classification model predicting class probabilities via the logistic (sigmoid) function applied to a linear combination of features. Core model for trading signal classification.',
    principles: [
      'Linear Decision Boundary: log(p/(1-p)) = Xw + b models log-odds',
      'Sigmoid Function: Maps linear predictions to [0,1] probabilities',
      'Maximum Likelihood: Optimizes parameters to maximize label likelihood',
      'Regularization: L1/L2 penalties prevent overfitting'
    ],
    applications: [
      'Classifies trading signals (buy/sell) achieving 70-80% accuracy',
      'Predicts market regimes (trending/ranging) with probabilities',
      'Estimates trade success probabilities for position sizing',
      'Classifies candlestick patterns with interpretable confidence'
    ],
    keyFeatures: [
      'Probabilistic outputs for risk assessment',
      'Coefficients reveal feature impacts on class probabilities',
      'Regularization handles noisy or correlated features',
      'Simple baseline for complex classification tasks'
    ],
    hyperparameters: [
      { name: 'C', type: 'number', default: 1.0, min: 0.01, max: 100, step: 0.1, description: 'Inverse regularization strength' },
      { name: 'penalty', type: 'select', default: 'l2', options: ['l1', 'l2', 'elasticnet', 'none'], description: 'Regularization type' },
      { name: 'solver', type: 'select', default: 'lbfgs', options: ['newton-cg', 'lbfgs', 'liblinear', 'sag', 'saga'], description: 'Optimization algorithm' },
      { name: 'max_iter', type: 'number', default: 100, min: 50, max: 1000, description: 'Maximum iterations' }
    ]
  },
  {
    id: 'probit-regression',
    name: 'Probit Regression',
    shortName: 'Probit',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Classification model using the cumulative normal distribution (probit) function instead of sigmoid, suitable for data with normally distributed latent variables.',
    principles: [
      'Latent Variable: z = w\'x + b + ε where ε ~ N(0,1) determines class',
      'Probit Link: P(y=1|x) = Φ(w\'x + b) using normal CDF',
      'Maximum Likelihood: Optimizes parameters for observed labels',
      'Gaussian Errors: Suits data with normal noise assumptions'
    ],
    applications: [
      'Classifies trading signals (buy/sell) achieving 70-80% accuracy',
      'Predicts market conditions (volatile/stable) with calibrated probabilities',
      'Estimates trade probabilities for position sizing',
      'Alternative to logistic when normal errors assumed'
    ],
    keyFeatures: [
      'Probabilistic outputs for risk assessment',
      'Gaussian error assumption suits normally distributed noise',
      'Coefficients reveal feature impacts on latent variable',
      'Supports ordinal extensions for volatility levels'
    ],
    hyperparameters: [
      { name: 'alpha', type: 'number', default: 1.0, min: 0.01, max: 100, step: 0.1, description: 'Regularization strength' },
      { name: 'fit_intercept', type: 'boolean', default: true, description: 'Include intercept term' },
      { name: 'max_iter', type: 'number', default: 100, min: 50, max: 1000, description: 'Maximum iterations' }
    ]
  },
  {
    id: 'ordinal-regression',
    name: 'Ordinal Regression',
    shortName: 'OrdReg',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Predicts ordered categorical outcomes (e.g., low/medium/high volatility) preserving their ordinal nature using threshold-based cumulative probability models.',
    principles: [
      'Ordinal Outcome: Preserves category order unlike nominal classification',
      'Threshold Model: Divides latent variable into ordered segments',
      'Cumulative Probabilities: P(Y ≤ k|x) = σ(w\'x + θₖ) for thresholds θₖ',
      'Proportional Odds: Common coefficients across thresholds'
    ],
    applications: [
      'Predicts ordinal volatility levels achieving 65-75% accuracy',
      'Classifies trend strength (weak/moderate/strong) for strategy selection',
      'Estimates ordinal risk levels for position sizing',
      'Classifies ordered pattern strengths'
    ],
    keyFeatures: [
      'Preserves order of categories for market states',
      'Provides calibrated probabilities for each level',
      'Coefficients reveal feature impacts on ordinal outcomes',
      'More appropriate than nominal classification for ordered data'
    ],
    hyperparameters: [
      { name: 'alpha', type: 'number', default: 1.0, min: 0.01, max: 100, step: 0.1, description: 'Regularization strength' },
      { name: 'max_iter', type: 'number', default: 1000, min: 100, max: 10000, description: 'Maximum iterations' }
    ]
  },
  {
    id: 'quantile-regression',
    name: 'Quantile Regression',
    shortName: 'QuantReg',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Predicts specific quantiles (e.g., median, 10th/90th percentile) of the target distribution, providing robust estimates and prediction intervals for risk assessment.',
    principles: [
      'Conditional Quantiles: Models Q_y(τ|x) = x\'w_τ for quantile τ',
      'Pinball Loss: ρ_τ(u) = u(τ - I{u<0}) asymmetrically penalizes errors',
      'Heteroscedasticity: Captures varying relationships across distribution',
      'Robustness: Outlier-resistant unlike mean-based regression'
    ],
    applications: [
      'Predicts price quantiles improving risk assessment by 5-10%',
      'Estimates Value-at-Risk (VaR) for position sizing',
      'Models upper/lower bounds of price trends',
      'Quantifies return distributions for portfolio allocation'
    ],
    keyFeatures: [
      'Models specific percentiles for tail risk assessment',
      'Robust to outliers and heteroscedasticity',
      'Provides prediction intervals for uncertainty quantification',
      'Coefficients vary by quantile revealing distributional effects'
    ],
    hyperparameters: [
      { name: 'quantile', type: 'number', default: 0.5, min: 0.01, max: 0.99, step: 0.05, description: 'Target quantile (0.5 = median)' },
      { name: 'alpha', type: 'number', default: 0.0, min: 0, max: 10, step: 0.1, description: 'Regularization strength' },
      { name: 'max_iter', type: 'number', default: 1000, min: 100, max: 10000, description: 'Maximum iterations' }
    ]
  },
  {
    id: 'sgd-classifier',
    name: 'Stochastic Gradient Descent',
    shortName: 'SGD',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Optimization technique training linear models by updating parameters using gradients from individual samples or mini-batches, enabling efficient training on large datasets and online learning.',
    principles: [
      'Stochastic Updates: Computes gradients from single/mini-batch samples',
      'Gradient Descent: Updates w ← w - η∇L in direction minimizing loss',
      'Regularization: Supports L1/L2 penalties for overfitting control',
      'Online Learning: Adapts incrementally to streaming data'
    ],
    applications: [
      'Trains models on large market datasets achieving 85-90% of batch performance',
      'Updates models in real-time with streaming price data',
      'Predicts price movements or classifies signals efficiently',
      'Handles high-dimensional derived features scalably'
    ],
    keyFeatures: [
      'Efficiently handles large datasets with incremental updates',
      'Supports both regression and classification tasks',
      'Stochasticity helps escape local minima',
      'Enables online learning for real-time trading'
    ],
    hyperparameters: [
      { name: 'loss', type: 'select', default: 'log_loss', options: ['hinge', 'log_loss', 'squared_error', 'huber'], description: 'Loss function' },
      { name: 'penalty', type: 'select', default: 'l2', options: ['l1', 'l2', 'elasticnet'], description: 'Regularization type' },
      { name: 'alpha', type: 'number', default: 0.0001, min: 0.000001, max: 0.1, step: 0.0001, description: 'Regularization strength' },
      { name: 'learning_rate', type: 'select', default: 'optimal', options: ['constant', 'optimal', 'invscaling', 'adaptive'], description: 'Learning rate schedule' },
      { name: 'eta0', type: 'number', default: 0.01, min: 0.0001, max: 1, step: 0.01, description: 'Initial learning rate' }
    ]
  },
  {
    id: 'random-forest',
    name: 'Random Forest',
    shortName: 'RF',
    category: 'supervised',
    subcategory: 'ensemble',
    overview: 'Ensemble of decision trees trained on random subsets of data and features, combining predictions via voting (classification) or averaging (regression) for robust predictions.',
    principles: [
      'Bootstrap Aggregation: Trains each tree on random data subset with replacement',
      'Random Feature Selection: Uses random feature subsets at each split',
      'Ensemble Voting: Aggregates trees via majority vote or averaging',
      'Decorrelation: Randomness ensures diverse, uncorrelated tree predictions'
    ],
    applications: [
      'Predicts trading signals achieving 5-10% higher accuracy than single trees',
      'Classifies market regimes (trending/ranging) robustly',
      'Regresses future price movements using technical features',
      'Identifies unusual price movements via OOB error analysis'
    ],
    keyFeatures: [
      'High accuracy through ensemble averaging',
      'Resistant to overfitting via bagging and feature randomness',
      'Provides feature importance for trading insights',
      'Handles mixed numerical/categorical features'
    ],
    hyperparameters: [
      { name: 'n_estimators', type: 'number', default: 100, min: 10, max: 1000, description: 'Number of trees' },
      { name: 'max_depth', type: 'number', default: 10, min: 1, max: 50, description: 'Maximum tree depth (null=unlimited)' },
      { name: 'max_features', type: 'select', default: 'sqrt', options: ['sqrt', 'log2', 'auto'], description: 'Features per split' },
      { name: 'min_samples_split', type: 'number', default: 2, min: 2, max: 20, description: 'Minimum samples to split' },
      { name: 'min_samples_leaf', type: 'number', default: 1, min: 1, max: 10, description: 'Minimum samples per leaf' }
    ]
  },
  {
    id: 'stacking',
    name: 'Stacked Generalization',
    shortName: 'Stacking',
    category: 'supervised',
    subcategory: 'ensemble',
    overview: 'Combines predictions from multiple diverse base models (level-0) using a meta-learner (level-1) that learns optimal combination weights, capturing complementary model strengths.',
    principles: [
      'Meta-Learning: Level-1 model learns to combine base model predictions',
      'Diverse Base Models: Uses varied algorithms (RF, XGB, SVM) for complementarity',
      'Out-of-Fold Predictions: Generates meta-features via cross-validation',
      'Hierarchical Structure: Stacks multiple model layers'
    ],
    applications: [
      'Predicts trading signals achieving 5-15% higher accuracy than single models',
      'Combines diverse predictors for robust market regime classification',
      'Regresses future prices using complementary feature representations',
      'Integrates price, volume, and sentiment model predictions'
    ],
    keyFeatures: [
      'Captures complementary strengths of diverse models',
      'Cross-validation prevents overfitting in meta-features',
      'Meta-learner weights reveal base model contributions',
      'Flexible: any base models and meta-learner'
    ],
    hyperparameters: [
      { name: 'cv_folds', type: 'number', default: 5, min: 2, max: 10, description: 'Cross-validation folds' },
      { name: 'passthrough', type: 'boolean', default: false, description: 'Include original features in meta-features' },
      { name: 'stack_method', type: 'select', default: 'auto', options: ['auto', 'predict_proba', 'decision_function', 'predict'], description: 'Stacking method' }
    ]
  },
  {
    id: 'gbm',
    name: 'Gradient Boosting Machine',
    shortName: 'GBM',
    category: 'supervised',
    subcategory: 'boosting',
    overview: 'Sequentially builds decision trees, each correcting errors of previous ones via gradient descent on a loss function. Highly effective for complex market patterns.',
    principles: [
      'Sequential Correction: Each tree fits residuals (negative gradients) of prior ensemble',
      'Additive Ensemble: f(x) = Σ ηhₜ(x) combines weak learners',
      'Gradient Descent: Minimizes differentiable loss function iteratively',
      'Regularization: Shrinkage, depth limits, subsampling control complexity'
    ],
    applications: [
      'Predicts trading signals achieving 5-10% higher accuracy than baselines',
      'Regresses future price movements using technical features',
      'Classifies candlestick patterns with feature importance',
      'Predicts volatility for portfolio risk management'
    ],
    keyFeatures: [
      'High accuracy on complex financial datasets',
      'Handles classification, regression, and ranking',
      'Feature importance and partial dependence plots',
      'Regularization prevents overfitting'
    ],
    hyperparameters: [
      { name: 'n_estimators', type: 'number', default: 100, min: 10, max: 1000, description: 'Number of boosting stages' },
      { name: 'learning_rate', type: 'number', default: 0.1, min: 0.001, max: 1, step: 0.01, description: 'Shrinkage rate' },
      { name: 'max_depth', type: 'number', default: 3, min: 1, max: 15, description: 'Maximum tree depth' },
      { name: 'subsample', type: 'number', default: 1.0, min: 0.5, max: 1, step: 0.1, description: 'Fraction of samples per tree' },
      { name: 'min_samples_split', type: 'number', default: 2, min: 2, max: 20, description: 'Minimum samples to split' }
    ]
  },
  {
    id: 'xgboost',
    name: 'XGBoost',
    shortName: 'XGB',
    category: 'supervised',
    subcategory: 'boosting',
    overview: 'Highly optimized gradient boosting with regularized objective, second-order gradients, and parallel tree construction. Industry standard for structured data.',
    principles: [
      'Regularized Objective: L1/L2 penalties on leaf weights prevent overfitting',
      'Second-Order Gradients: Uses Hessians for better optimization',
      'Level-Wise Growth: Builds trees level by level with optimal splits',
      'Parallel Split Finding: Accelerates training via parallelization'
    ],
    applications: [
      'Predicts trading signals achieving 5-15% higher accuracy than baselines',
      'Regresses future price movements with high precision',
      'Classifies market regimes with SHAP interpretability',
      'Predicts volatility for risk management'
    ],
    keyFeatures: [
      'Regularized objective prevents overfitting',
      'Second-order gradients improve convergence',
      'Handles missing values natively',
      'SHAP values provide feature interpretability'
    ],
    hyperparameters: [
      { name: 'n_estimators', type: 'number', default: 100, min: 10, max: 1000, description: 'Number of boosting rounds' },
      { name: 'learning_rate', type: 'number', default: 0.1, min: 0.001, max: 1, step: 0.01, description: 'Step size shrinkage' },
      { name: 'max_depth', type: 'number', default: 6, min: 1, max: 15, description: 'Maximum tree depth' },
      { name: 'reg_lambda', type: 'number', default: 1, min: 0, max: 10, step: 0.1, description: 'L2 regularization' },
      { name: 'reg_alpha', type: 'number', default: 0, min: 0, max: 10, step: 0.1, description: 'L1 regularization' },
      { name: 'subsample', type: 'number', default: 0.8, min: 0.5, max: 1, step: 0.1, description: 'Row subsampling ratio' },
      { name: 'colsample_bytree', type: 'number', default: 0.8, min: 0.5, max: 1, step: 0.1, description: 'Column subsampling ratio' }
    ]
  },
  {
    id: 'lightgbm',
    name: 'LightGBM',
    shortName: 'LGBM',
    category: 'supervised',
    subcategory: 'boosting',
    overview: 'High-performance gradient boosting optimized for speed and scalability using histogram-based splitting and leaf-wise tree growth.',
    principles: [
      'Histogram-Based Splitting: Bins features into histograms for fast split finding',
      'Leaf-Wise Growth: Grows trees by splitting leaf with highest loss reduction',
      'Gradient-Based One-Side Sampling: Focuses on data with larger gradients',
      'Exclusive Feature Bundling: Bundles sparse features for efficiency'
    ],
    applications: [
      'Predicts trading signals achieving 5-15% higher accuracy than baselines',
      'Handles large market datasets 20-50% faster than traditional GBM',
      'Classifies market regimes with native categorical support',
      'Predicts volatility with efficient memory usage'
    ],
    keyFeatures: [
      'Histogram-based splits reduce training time 20-50%',
      'Leaf-wise growth produces more accurate models',
      'Native categorical feature handling',
      'Low memory footprint for large datasets'
    ],
    hyperparameters: [
      { name: 'n_estimators', type: 'number', default: 100, min: 10, max: 1000, description: 'Number of boosting iterations' },
      { name: 'learning_rate', type: 'number', default: 0.1, min: 0.001, max: 1, step: 0.01, description: 'Boosting learning rate' },
      { name: 'num_leaves', type: 'number', default: 31, min: 10, max: 256, description: 'Maximum leaves per tree' },
      { name: 'max_depth', type: 'number', default: -1, min: -1, max: 50, description: 'Maximum tree depth (-1=unlimited)' },
      { name: 'reg_lambda', type: 'number', default: 0, min: 0, max: 10, step: 0.1, description: 'L2 regularization' },
      { name: 'feature_fraction', type: 'number', default: 0.8, min: 0.5, max: 1, step: 0.1, description: 'Column subsampling ratio' },
      { name: 'bagging_fraction', type: 'number', default: 0.8, min: 0.5, max: 1, step: 0.1, description: 'Row subsampling ratio' }
    ]
  },
  {
    id: 'catboost',
    name: 'CatBoost',
    shortName: 'CatBoost',
    category: 'supervised',
    subcategory: 'boosting',
    overview: 'Gradient boosting optimized for categorical features using target-based encoding and ordered boosting to prevent overfitting.',
    principles: [
      'Ordered Boosting: Uses ordered target statistics for unbiased gradients',
      'Automatic Categorical Encoding: Target-based encoding reduces preprocessing',
      'Symmetric Trees: Identical splits at each level for speed and stability',
      'Overfitting Prevention: Ordered target statistics prevent target leakage'
    ],
    applications: [
      'Predicts trading signals achieving 5-15% higher accuracy than baselines',
      'Handles categorical market regime features automatically',
      'Classifies candlestick patterns with minimal preprocessing',
      'Predicts volatility with robust regularization'
    ],
    keyFeatures: [
      'Automatic categorical feature handling',
      'Ordered boosting prevents overfitting',
      'Symmetric trees for fast training',
      'GPU acceleration for large datasets'
    ],
    hyperparameters: [
      { name: 'iterations', type: 'number', default: 100, min: 10, max: 1000, description: 'Number of boosting iterations' },
      { name: 'learning_rate', type: 'number', default: 0.1, min: 0.001, max: 1, step: 0.01, description: 'Boosting learning rate' },
      { name: 'depth', type: 'number', default: 6, min: 1, max: 16, description: 'Tree depth' },
      { name: 'l2_leaf_reg', type: 'number', default: 3, min: 0, max: 10, step: 0.1, description: 'L2 regularization' },
      { name: 'border_count', type: 'number', default: 254, min: 1, max: 255, description: 'Histogram bins for numerical features' },
      { name: 'bagging_temperature', type: 'number', default: 1, min: 0, max: 10, step: 0.1, description: 'Bayesian bootstrap temperature' }
    ]
  },
  {
    id: 'calibrated-classifier',
    name: 'Calibrated Classifier',
    shortName: 'CalibratedCV',
    category: 'supervised',
    subcategory: 'meta-learner',
    overview: 'Adjusts classifier probability outputs to better reflect true probabilities using Platt scaling or isotonic regression, critical for reliable risk assessment.',
    principles: [
      'Probability Calibration: Adjusts raw scores to match empirical frequencies',
      'Platt Scaling: Fits sigmoid to map scores to calibrated probabilities',
      'Isotonic Regression: Non-parametric monotonic mapping for flexibility',
      'Cross-Validation: Prevents overfitting on calibration data'
    ],
    applications: [
      'Enhances trading signals with reliable probability estimates',
      'Improves risk management by 10-20% in calibration error',
      'Classifies market regimes with trustworthy confidence',
      'Quantifies trade risk using calibrated probabilities'
    ],
    keyFeatures: [
      'Produces reliable probability estimates for decisions',
      'Works with any base classifier',
      'Platt scaling for parametric, isotonic for flexible calibration',
      'Cross-validation prevents calibration overfitting'
    ],
    hyperparameters: [
      { name: 'method', type: 'select', default: 'sigmoid', options: ['sigmoid', 'isotonic'], description: 'Calibration method (sigmoid=Platt, isotonic=non-parametric)' },
      { name: 'cv', type: 'number', default: 5, min: 2, max: 10, description: 'Cross-validation folds' },
      { name: 'ensemble', type: 'boolean', default: true, description: 'Ensemble calibrated classifiers' }
    ]
  },
  {
    id: 'autoencoder',
    name: 'Autoencoder',
    shortName: 'AE',
    category: 'unsupervised',
    subcategory: 'deep-learning',
    overview: 'Neural network that learns to compress and reconstruct data via an encoder-decoder architecture, extracting latent features for dimensionality reduction and anomaly detection.',
    principles: [
      'Encoder-Decoder: Compresses input to latent space z = f(x), reconstructs x̂ = g(z)',
      'Reconstruction Loss: Minimizes ||x - x̂||² to learn meaningful representations',
      'Bottleneck: Lower-dimensional latent space forces feature compression',
      'Non-Linear Modeling: Neural networks capture complex patterns unlike PCA'
    ],
    applications: [
      'Extracts latent market features improving prediction accuracy by 5-10%',
      'Detects anomalies via high reconstruction error',
      'Filters noise from high-frequency market data',
      'Discovers hidden volatility regimes for strategy development'
    ],
    keyFeatures: [
      'Non-linear dimensionality reduction',
      'Automatic latent feature extraction',
      'Anomaly detection via reconstruction error',
      'Flexible architecture (dense, convolutional, LSTM)'
    ],
    hyperparameters: [
      { name: 'latent_dim', type: 'number', default: 10, min: 2, max: 100, description: 'Latent space dimensions' },
      { name: 'hidden_layers', type: 'number', default: 2, min: 1, max: 5, description: 'Number of hidden layers' },
      { name: 'hidden_units', type: 'number', default: 64, min: 16, max: 512, description: 'Units per hidden layer' },
      { name: 'activation', type: 'select', default: 'relu', options: ['relu', 'tanh', 'sigmoid', 'leaky_relu'], description: 'Activation function' },
      { name: 'dropout', type: 'number', default: 0.2, min: 0, max: 0.5, step: 0.05, description: 'Dropout rate' },
      { name: 'learning_rate', type: 'number', default: 0.001, min: 0.0001, max: 0.1, step: 0.0001, description: 'Learning rate' }
    ]
  },
  {
    id: 'dcn',
    name: 'Deep Clustering Network',
    shortName: 'DCN',
    category: 'unsupervised',
    subcategory: 'deep-learning',
    overview: 'Integrates autoencoder-based feature learning with clustering objective, simultaneously learning latent representations and cluster assignments.',
    principles: [
      'Joint Optimization: Combines reconstruction loss with clustering loss',
      'Autoencoder Backbone: Learns latent representations via encoder-decoder',
      'Soft Assignments: Uses Student\'s t-distribution for cluster probabilities',
      'KL Divergence: Sharpens cluster assignments via auxiliary target distribution'
    ],
    applications: [
      'Clusters market patterns achieving silhouette scores of 0.4-0.6',
      'Groups trading behaviors (scalping vs. swing) automatically',
      'Segments instruments by volatility/correlation characteristics',
      'Discovers hidden market regimes for strategy development'
    ],
    keyFeatures: [
      'Jointly learns features and clusters end-to-end',
      'Non-linear feature extraction via neural networks',
      'Soft clustering with probabilistic assignments',
      'Outperforms separate clustering approaches'
    ],
    hyperparameters: [
      { name: 'n_clusters', type: 'number', default: 5, min: 2, max: 20, description: 'Number of clusters' },
      { name: 'latent_dim', type: 'number', default: 10, min: 2, max: 100, description: 'Latent space dimensions' },
      { name: 'hidden_layers', type: 'number', default: 2, min: 1, max: 5, description: 'Number of hidden layers' },
      { name: 'lambda', type: 'number', default: 0.1, min: 0.01, max: 1, step: 0.01, description: 'Clustering loss weight' },
      { name: 'pretrain_epochs', type: 'number', default: 50, min: 10, max: 200, description: 'Autoencoder pretraining epochs' },
      { name: 'learning_rate', type: 'number', default: 0.001, min: 0.0001, max: 0.1, step: 0.0001, description: 'Learning rate' }
    ]
  }
];

export type ValidationMethod = 'percentage' | 'time-based' | 'walk-forward' | 'k-fold';

export interface ValidationConfig {
  method: ValidationMethod;
  percentageSplit?: number;
  timeBasedConfig?: {
    trainWindow: number;
    trainUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
    testWindow: number;
    testUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
    gapWindow: number;
    gapUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
  };
  walkForwardConfig?: {
    trainWindow: number;
    trainUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
    testWindow: number;
    testUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
    stepSize: number;
    stepUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
    windowType: 'rolling' | 'expanding';
    embargoWindow: number;
    embargoUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
  };
  kFoldConfig?: {
    nFolds: number;
    foldType: 'standard' | 'purged' | 'combinatorial-purged';
    purgeGap: number;
    purgeUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
    embargoRatio: number;
  };
}

export const defaultValidationConfig: ValidationConfig = {
  method: 'percentage',
  percentageSplit: 0.2,
  timeBasedConfig: {
    trainWindow: 30,
    trainUnit: 'days',
    testWindow: 7,
    testUnit: 'days',
    gapWindow: 0,
    gapUnit: 'days',
  },
  walkForwardConfig: {
    trainWindow: 30,
    trainUnit: 'days',
    testWindow: 7,
    testUnit: 'days',
    stepSize: 7,
    stepUnit: 'days',
    windowType: 'rolling',
    embargoWindow: 1,
    embargoUnit: 'days',
  },
  kFoldConfig: {
    nFolds: 5,
    foldType: 'standard',
    purgeGap: 1,
    purgeUnit: 'days',
    embargoRatio: 0.01,
  },
};

export const allModels: MLModelDefinition[] = [...unsupervisedModels, ...supervisedModels];

export const getModelsByCategory = (category: ModelCategory) => {
  return allModels.filter(m => m.category === category);
};

export const getModelsBySubcategory = (subcategory: ModelSubcategory) => {
  return allModels.filter(m => m.subcategory === subcategory);
};

export const getModelById = (id: string) => {
  return allModels.find(m => m.id === id);
};

export const modelSubcategoryLabels: Record<ModelSubcategory, string> = {
  'dimensionality-reduction': 'Dimensionality Reduction',
  'clustering': 'Clustering',
  'anomaly-detection': 'Anomaly Detection',
  'self-organizing': 'Self-Organizing',
  'linear': 'Linear Models',
  'ensemble': 'Ensemble Methods',
  'boosting': 'Boosting Methods',
  'meta-learner': 'Meta-Learners & Calibration',
  'deep-learning': 'Deep Learning',
  'classification': 'Classification',
  'regression': 'Regression',
  'sequence': 'Sequence Modeling',
};

export const modelCategoryLabels: Record<ModelCategory, string> = {
  'unsupervised': 'Unsupervised',
  'supervised': 'Supervised',
  'self-supervised': 'Self-Supervised',
  'semi-supervised': 'Semi-Supervised',
};
