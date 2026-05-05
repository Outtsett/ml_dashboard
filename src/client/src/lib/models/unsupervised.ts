import type { MLModelDefinition } from './types';

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
      'Non-Negative Decomposition: Approximates V â‰ˆ WH where W, H are non-negative',
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
      'Groups trading behaviors (scalping vs. microstructure trading)',
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
      'Regularization: Parameter Î½ controls outlier fraction'
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
  },
  {
    id: 'autoencoder',
    name: 'Autoencoder',
    shortName: 'AE',
    category: 'unsupervised',
    subcategory: 'deep-learning',
    overview: 'Neural network that learns to compress and reconstruct data via an encoder-decoder architecture, extracting latent features for dimensionality reduction and anomaly detection.',
    principles: [
      'Encoder-Decoder: Compresses input to latent space z = f(x), reconstructs xÌ‚ = g(z)',
      'Reconstruction Loss: Minimizes ||x - xÌ‚||Â² to learn meaningful representations',
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
      'Groups trading behaviors (scalping vs. microstructure) automatically',
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

