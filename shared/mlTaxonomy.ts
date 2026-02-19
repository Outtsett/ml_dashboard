/**
 * ML Model Taxonomy - Single source of truth for model categories and metrics
 */

// ============== CATEGORIES ==============

export const MODEL_CATEGORIES = {
  supervised: {
    id: 'supervised',
    name: 'Supervised Learning',
    description: 'Models trained on labeled data to predict outcomes',
    icon: 'Target',
    subcategories: ['classification', 'regression', 'sequence']
  },
  unsupervised: {
    id: 'unsupervised',
    name: 'Unsupervised Learning',
    description: 'Models that discover patterns in unlabeled data',
    icon: 'Sparkles',
    subcategories: ['clustering', 'dimensionality-reduction', 'anomaly-detection']
  },
  'self-supervised': {
    id: 'self-supervised',
    name: 'Self-Supervised Learning',
    description: 'Models that learn representations from data structure',
    icon: 'Repeat',
    subcategories: ['representation', 'contrastive']
  },
  'semi-supervised': {
    id: 'semi-supervised',
    name: 'Semi-Supervised Learning',
    description: 'Models using both labeled and unlabeled data',
    icon: 'Blend',
    subcategories: ['pseudo-labeling', 'consistency']
  }
} as const;

export type ModelCategory = keyof typeof MODEL_CATEGORIES;

// ============== SUBCATEGORIES ==============

export const MODEL_SUBCATEGORIES = {
  // Supervised
  classification: {
    id: 'classification',
    name: 'Classification',
    category: 'supervised',
    description: 'Predict discrete class labels',
    metrics: ['accuracy', 'precision', 'recall', 'f1', 'rocAuc', 'confusionMatrix'],
    visualizations: ['confusionMatrix', 'rocCurve', 'precisionRecallCurve', 'calibrationCurve']
  },
  regression: {
    id: 'regression',
    name: 'Regression',
    category: 'supervised',
    description: 'Predict continuous values',
    metrics: ['mae', 'rmse', 'mape', 'r2', 'mse'],
    visualizations: ['residualsPlot', 'predictedVsActual', 'errorDistribution']
  },
  sequence: {
    id: 'sequence',
    name: 'Sequence/Time-Series',
    category: 'supervised',
    description: 'Predict sequences or time-series values',
    metrics: ['mae', 'rmse', 'mape', 'directionalAccuracy', 'forecastBias'],
    visualizations: ['forecastPlot', 'residualsOverTime', 'autocorrelation']
  },
  // Unsupervised
  clustering: {
    id: 'clustering',
    name: 'Clustering',
    category: 'unsupervised',
    description: 'Group similar data points',
    metrics: ['silhouetteScore', 'daviesBouldin', 'calinskiHarabasz', 'inertia', 'numClusters'],
    visualizations: ['clusterScatter', 'clusterSizes', 'silhouettePerCluster', 'dendrogram']
  },
  'dimensionality-reduction': {
    id: 'dimensionality-reduction',
    name: 'Dimensionality Reduction',
    category: 'unsupervised',
    description: 'Reduce data dimensions while preserving structure',
    metrics: ['explainedVariance', 'reconstructionError', 'trustworthiness', 'numComponents'],
    visualizations: ['embeddingScatter', 'varianceExplained', 'componentLoadings']
  },
  'anomaly-detection': {
    id: 'anomaly-detection',
    name: 'Anomaly Detection',
    category: 'unsupervised',
    description: 'Identify outliers and unusual patterns',
    metrics: ['anomalyRate', 'precision', 'recall', 'f1', 'avgAnomalyScore'],
    visualizations: ['scoreDistribution', 'timeSeriesOverlay', 'thresholdAnalysis']
  },
  // Self-supervised
  representation: {
    id: 'representation',
    name: 'Representation Learning',
    category: 'self-supervised',
    description: 'Learn useful data representations',
    metrics: ['reconstructionLoss', 'embeddingQuality', 'linearProbeAccuracy'],
    visualizations: ['embeddingScatter', 'reconstructionSamples', 'lossCurve']
  },
  contrastive: {
    id: 'contrastive',
    name: 'Contrastive Learning',
    category: 'self-supervised',
    description: 'Learn by contrasting positive/negative pairs',
    metrics: ['contrastiveLoss', 'alignmentScore', 'uniformityScore'],
    visualizations: ['embeddingScatter', 'similarityMatrix', 'lossCurve']
  },
  // Semi-supervised
  'pseudo-labeling': {
    id: 'pseudo-labeling',
    name: 'Pseudo-Labeling',
    category: 'semi-supervised',
    description: 'Use model predictions as labels for unlabeled data',
    metrics: ['accuracy', 'labelConfidence', 'pseudoLabelAccuracy'],
    visualizations: ['confusionMatrix', 'confidenceDistribution']
  },
  consistency: {
    id: 'consistency',
    name: 'Consistency Regularization',
    category: 'semi-supervised',
    description: 'Enforce consistent predictions under perturbations',
    metrics: ['accuracy', 'consistencyLoss', 'unlabeledLoss'],
    visualizations: ['confusionMatrix', 'lossCurves']
  }
} as const;

export type ModelSubcategory = keyof typeof MODEL_SUBCATEGORIES;

// ============== METRICS DEFINITIONS ==============

export const METRIC_DEFINITIONS = {
  // Classification metrics
  accuracy: { name: 'Accuracy', format: 'percent', range: [0, 1], higherBetter: true },
  precision: { name: 'Precision', format: 'percent', range: [0, 1], higherBetter: true },
  recall: { name: 'Recall', format: 'percent', range: [0, 1], higherBetter: true },
  f1: { name: 'F1 Score', format: 'percent', range: [0, 1], higherBetter: true },
  rocAuc: { name: 'ROC-AUC', format: 'decimal', range: [0, 1], higherBetter: true },
  
  // Regression metrics
  mae: { name: 'MAE', format: 'decimal', range: [0, Infinity], higherBetter: false },
  rmse: { name: 'RMSE', format: 'decimal', range: [0, Infinity], higherBetter: false },
  mape: { name: 'MAPE', format: 'percent', range: [0, Infinity], higherBetter: false },
  r2: { name: 'R²', format: 'decimal', range: [-Infinity, 1], higherBetter: true },
  mse: { name: 'MSE', format: 'decimal', range: [0, Infinity], higherBetter: false },
  
  // Time-series metrics
  directionalAccuracy: { name: 'Directional Accuracy', format: 'percent', range: [0, 1], higherBetter: true },
  forecastBias: { name: 'Forecast Bias', format: 'decimal', range: [-Infinity, Infinity], higherBetter: false },
  
  // Clustering metrics
  silhouetteScore: { name: 'Silhouette Score', format: 'decimal', range: [-1, 1], higherBetter: true },
  daviesBouldin: { name: 'Davies-Bouldin', format: 'decimal', range: [0, Infinity], higherBetter: false },
  calinskiHarabasz: { name: 'Calinski-Harabasz', format: 'decimal', range: [0, Infinity], higherBetter: true },
  inertia: { name: 'Inertia', format: 'decimal', range: [0, Infinity], higherBetter: false },
  numClusters: { name: 'Clusters', format: 'integer', range: [1, Infinity], higherBetter: null },
  
  // Dimensionality reduction metrics
  explainedVariance: { name: 'Explained Variance', format: 'percent', range: [0, 1], higherBetter: true },
  reconstructionError: { name: 'Reconstruction Error', format: 'decimal', range: [0, Infinity], higherBetter: false },
  trustworthiness: { name: 'Trustworthiness', format: 'decimal', range: [0, 1], higherBetter: true },
  numComponents: { name: 'Components', format: 'integer', range: [1, Infinity], higherBetter: null },
  
  // Anomaly detection metrics
  anomalyRate: { name: 'Anomaly Rate', format: 'percent', range: [0, 1], higherBetter: null },
  avgAnomalyScore: { name: 'Avg Anomaly Score', format: 'decimal', range: [0, 1], higherBetter: null },
  
  // Self-supervised metrics
  reconstructionLoss: { name: 'Reconstruction Loss', format: 'decimal', range: [0, Infinity], higherBetter: false },
  embeddingQuality: { name: 'Embedding Quality', format: 'decimal', range: [0, 1], higherBetter: true },
  linearProbeAccuracy: { name: 'Linear Probe Acc', format: 'percent', range: [0, 1], higherBetter: true },
  contrastiveLoss: { name: 'Contrastive Loss', format: 'decimal', range: [0, Infinity], higherBetter: false },
  alignmentScore: { name: 'Alignment', format: 'decimal', range: [0, 1], higherBetter: true },
  uniformityScore: { name: 'Uniformity', format: 'decimal', range: [-Infinity, 0], higherBetter: false },
  
  // Training metrics
  finalLoss: { name: 'Final Loss', format: 'decimal', range: [0, Infinity], higherBetter: false },
  finalValLoss: { name: 'Val Loss', format: 'decimal', range: [0, Infinity], higherBetter: false },
  trainingTime: { name: 'Training Time', format: 'duration', range: [0, Infinity], higherBetter: false },
  
  // Semi-supervised metrics
  labelConfidence: { name: 'Label Confidence', format: 'percent', range: [0, 1], higherBetter: true },
  pseudoLabelAccuracy: { name: 'Pseudo-Label Acc', format: 'percent', range: [0, 1], higherBetter: true },
  consistencyLoss: { name: 'Consistency Loss', format: 'decimal', range: [0, Infinity], higherBetter: false },
  unlabeledLoss: { name: 'Unlabeled Loss', format: 'decimal', range: [0, Infinity], higherBetter: false },
} as const;

export type MetricKey = keyof typeof METRIC_DEFINITIONS;

// ============== FEATURE PIPELINES ==============
// Category-specific feature configuration for model creation

export const FEATURE_PIPELINES = {
  classification: {
    name: 'Classification Features',
    description: 'Features for predicting discrete class labels',
    sections: [
      {
        id: 'target',
        name: 'Target Configuration',
        fields: [
          { id: 'targetColumn', name: 'Target Column', type: 'select', options: ['direction', 'signal', 'regime'], default: 'direction', description: 'Column to predict' },
          { id: 'numClasses', name: 'Number of Classes', type: 'number', min: 2, max: 10, default: 2, description: 'Binary (2) or multi-class' },
          { id: 'classBalance', name: 'Class Balancing', type: 'select', options: ['none', 'oversample', 'undersample', 'smote'], default: 'none', description: 'Handle imbalanced data' },
        ]
      },
      {
        id: 'calibration',
        name: 'Probability Calibration',
        fields: [
          { id: 'calibrationMethod', name: 'Method', type: 'select', options: ['none', 'platt', 'isotonic', 'temperature'], default: 'none', description: 'Calibrate output probabilities' },
          { id: 'confidenceThreshold', name: 'Confidence Threshold', type: 'slider', min: 0.5, max: 0.95, step: 0.05, default: 0.6, description: 'Min confidence for predictions' },
        ]
      },
      {
        id: 'input_features',
        name: 'Input Features',
        fields: [
          { id: 'priceFeatures', name: 'Price Features', type: 'multiselect', options: ['returns', 'log_returns', 'normalized_price', 'hlc_avg'], default: ['returns'], description: 'Price-derived features' },
          { id: 'lagPeriods', name: 'Lag Periods', type: 'array', min: 1, max: 20, default: [1, 5, 10], description: 'Lookback periods for lagged features' },
        ]
      }
    ]
  },
  regression: {
    name: 'Regression Features',
    description: 'Features for predicting continuous values',
    sections: [
      {
        id: 'target',
        name: 'Target Configuration',
        fields: [
          { id: 'targetColumn', name: 'Target Column', type: 'select', options: ['close', 'returns', 'volatility', 'range'], default: 'returns', description: 'Value to predict' },
          { id: 'forecastHorizon', name: 'Forecast Horizon', type: 'number', min: 1, max: 100, default: 1, description: 'Steps ahead to predict' },
          { id: 'targetTransform', name: 'Target Transform', type: 'select', options: ['none', 'log', 'diff', 'pct_change'], default: 'none', description: 'Transform target variable' },
        ]
      },
      {
        id: 'scaling',
        name: 'Feature Scaling',
        fields: [
          { id: 'scalingMethod', name: 'Scaling', type: 'select', options: ['standard', 'minmax', 'robust', 'none'], default: 'standard', description: 'Normalize feature values' },
          { id: 'rollingWindow', name: 'Rolling Window', type: 'number', min: 10, max: 500, default: 60, description: 'Window for rolling statistics' },
        ]
      },
      {
        id: 'importance',
        name: 'Feature Importance',
        fields: [
          { id: 'featureSelection', name: 'Feature Selection', type: 'select', options: ['none', 'correlation', 'mutual_info', 'recursive'], default: 'none', description: 'Auto-select features' },
          { id: 'maxFeatures', name: 'Max Features', type: 'number', min: 5, max: 100, default: 20, description: 'Maximum features to use' },
        ]
      }
    ]
  },
  sequence: {
    name: 'Sequence/Time-Series Features',
    description: 'Features for temporal sequence modeling',
    sections: [
      {
        id: 'temporal',
        name: 'Temporal Configuration',
        fields: [
          { id: 'lookbackWindow', name: 'Lookback Window', type: 'number', min: 10, max: 500, default: 60, description: 'Past bars to consider' },
          { id: 'forecastHorizon', name: 'Forecast Horizon', type: 'number', min: 1, max: 50, default: 1, description: 'Steps to predict ahead' },
          { id: 'stride', name: 'Stride', type: 'number', min: 1, max: 10, default: 1, description: 'Step between sequences' },
        ]
      },
      {
        id: 'encoding',
        name: 'Temporal Encoding',
        fields: [
          { id: 'timeFeatures', name: 'Time Features', type: 'multiselect', options: ['hour', 'day_of_week', 'month', 'quarter', 'session'], default: ['hour', 'day_of_week'], description: 'Calendar features' },
          { id: 'positionalEncoding', name: 'Positional Encoding', type: 'select', options: ['none', 'sinusoidal', 'learned'], default: 'none', description: 'Position information' },
        ]
      },
      {
        id: 'stationarity',
        name: 'Stationarity',
        fields: [
          { id: 'differencing', name: 'Differencing', type: 'number', min: 0, max: 2, default: 0, description: 'Order of differencing' },
          { id: 'seasonalDifferencing', name: 'Seasonal Diff', type: 'boolean', default: false, description: 'Apply seasonal differencing' },
        ]
      }
    ]
  },
  clustering: {
    name: 'Clustering Features',
    description: 'Features for grouping similar data points',
    sections: [
      {
        id: 'distance',
        name: 'Distance Configuration',
        fields: [
          { id: 'distanceMetric', name: 'Distance Metric', type: 'select', options: ['euclidean', 'manhattan', 'cosine', 'dtw'], default: 'euclidean', description: 'Distance calculation method' },
          { id: 'normalize', name: 'Normalize Features', type: 'boolean', default: true, description: 'Scale features before clustering' },
        ]
      },
      {
        id: 'cluster_config',
        name: 'Cluster Estimation',
        fields: [
          { id: 'clusterMethod', name: 'Estimation Method', type: 'select', options: ['fixed', 'elbow', 'silhouette', 'gap_statistic'], default: 'silhouette', description: 'How to determine k' },
          { id: 'minClusters', name: 'Min Clusters', type: 'number', min: 2, max: 20, default: 2, description: 'Minimum cluster count' },
          { id: 'maxClusters', name: 'Max Clusters', type: 'number', min: 3, max: 50, default: 10, description: 'Maximum cluster count' },
        ]
      },
      {
        id: 'analytics',
        name: 'Cluster Analytics',
        fields: [
          { id: 'computeSilhouette', name: 'Silhouette Analysis', type: 'boolean', default: true, description: 'Per-cluster silhouette scores' },
          { id: 'computeCentroids', name: 'Centroid Analysis', type: 'boolean', default: true, description: 'Cluster center statistics' },
          { id: 'clusterLabeling', name: 'Auto-Labeling', type: 'select', options: ['none', 'regime', 'volatility', 'trend'], default: 'regime', description: 'Semantic cluster labels' },
        ]
      }
    ]
  },
  'dimensionality-reduction': {
    name: 'Dimensionality Reduction Features',
    description: 'Features for reducing data dimensions',
    sections: [
      {
        id: 'components',
        name: 'Component Configuration',
        fields: [
          { id: 'numComponents', name: 'Target Components', type: 'number', min: 2, max: 50, default: 10, description: 'Reduced dimensionality' },
          { id: 'varianceRetention', name: 'Variance Retention', type: 'slider', min: 0.8, max: 0.99, step: 0.01, default: 0.95, description: 'Min variance to preserve' },
          { id: 'autoComponents', name: 'Auto-Select', type: 'boolean', default: true, description: 'Auto-select by variance' },
        ]
      },
      {
        id: 'analysis',
        name: 'Component Analysis',
        fields: [
          { id: 'computeLoadings', name: 'Compute Loadings', type: 'boolean', default: true, description: 'Feature contribution weights' },
          { id: 'reconstructionTest', name: 'Reconstruction Test', type: 'boolean', default: false, description: 'Measure reconstruction error' },
        ]
      },
      {
        id: 'visualization',
        name: 'Visualization',
        fields: [
          { id: 'screeplot', name: 'Scree Plot', type: 'boolean', default: true, description: 'Variance explained plot' },
          { id: 'biplot', name: 'Biplot', type: 'boolean', default: false, description: 'PC1 vs PC2 with loadings' },
        ]
      }
    ]
  },
  'anomaly-detection': {
    name: 'Anomaly Detection Features',
    description: 'Features for identifying outliers',
    sections: [
      {
        id: 'threshold',
        name: 'Threshold Configuration',
        fields: [
          { id: 'contamination', name: 'Contamination Rate', type: 'slider', min: 0.01, max: 0.2, step: 0.01, default: 0.05, description: 'Expected anomaly proportion' },
          { id: 'thresholdMethod', name: 'Threshold Method', type: 'select', options: ['percentile', 'std_dev', 'iqr', 'learned'], default: 'percentile', description: 'How to set threshold' },
          { id: 'thresholdValue', name: 'Threshold Multiplier', type: 'number', min: 1, max: 5, default: 3, description: 'Sensitivity multiplier' },
        ]
      },
      {
        id: 'scoring',
        name: 'Anomaly Scoring',
        fields: [
          { id: 'scoreNormalization', name: 'Score Normalization', type: 'select', options: ['none', 'minmax', 'sigmoid'], default: 'minmax', description: 'Normalize anomaly scores' },
          { id: 'contextWindow', name: 'Context Window', type: 'number', min: 5, max: 100, default: 20, description: 'Local context for scoring' },
        ]
      },
      {
        id: 'output',
        name: 'Detection Output',
        fields: [
          { id: 'binaryLabels', name: 'Binary Labels', type: 'boolean', default: true, description: 'Output 0/1 labels' },
          { id: 'anomalyScores', name: 'Continuous Scores', type: 'boolean', default: true, description: 'Output raw scores' },
          { id: 'explanations', name: 'Feature Attribution', type: 'boolean', default: false, description: 'Why flagged as anomaly' },
        ]
      }
    ]
  },
  representation: {
    name: 'Representation Learning Features',
    description: 'Features for learning embeddings',
    sections: [
      {
        id: 'embedding',
        name: 'Embedding Configuration',
        fields: [
          { id: 'embeddingDim', name: 'Embedding Dimension', type: 'number', min: 8, max: 256, default: 64, description: 'Latent space dimension' },
          { id: 'encoderType', name: 'Encoder Type', type: 'select', options: ['linear', 'mlp', 'cnn', 'transformer'], default: 'mlp', description: 'Encoder architecture' },
        ]
      },
      {
        id: 'reconstruction',
        name: 'Reconstruction',
        fields: [
          { id: 'decoderSymmetric', name: 'Symmetric Decoder', type: 'boolean', default: true, description: 'Mirror encoder architecture' },
          { id: 'reconstructionLoss', name: 'Reconstruction Loss', type: 'select', options: ['mse', 'mae', 'huber'], default: 'mse', description: 'Loss function' },
        ]
      }
    ]
  },
  contrastive: {
    name: 'Contrastive Learning Features',
    description: 'Features for contrastive representation learning',
    sections: [
      {
        id: 'pairs',
        name: 'Pair Configuration',
        fields: [
          { id: 'augmentations', name: 'Augmentations', type: 'multiselect', options: ['noise', 'mask', 'shift', 'scale'], default: ['noise', 'mask'], description: 'Data augmentations' },
          { id: 'temperature', name: 'Temperature', type: 'slider', min: 0.05, max: 1.0, step: 0.05, default: 0.1, description: 'Softmax temperature' },
        ]
      },
      {
        id: 'negatives',
        name: 'Negative Sampling',
        fields: [
          { id: 'numNegatives', name: 'Negative Samples', type: 'number', min: 16, max: 1024, default: 128, description: 'Negatives per positive' },
          { id: 'hardNegatives', name: 'Hard Negatives', type: 'boolean', default: false, description: 'Use hard negative mining' },
        ]
      }
    ]
  },
  'pseudo-labeling': {
    name: 'Pseudo-Labeling Features',
    description: 'Features for semi-supervised learning',
    sections: [
      {
        id: 'labeling',
        name: 'Label Configuration',
        fields: [
          { id: 'labeledRatio', name: 'Labeled Ratio', type: 'slider', min: 0.01, max: 0.5, step: 0.01, default: 0.1, description: 'Fraction of labeled data' },
          { id: 'confidenceThreshold', name: 'Confidence Threshold', type: 'slider', min: 0.5, max: 0.99, step: 0.01, default: 0.9, description: 'Min confidence for pseudo-labels' },
        ]
      },
      {
        id: 'iteration',
        name: 'Iterative Refinement',
        fields: [
          { id: 'iterativeTraining', name: 'Iterative Mode', type: 'boolean', default: true, description: 'Refine labels iteratively' },
          { id: 'maxIterations', name: 'Max Iterations', type: 'number', min: 1, max: 10, default: 3, description: 'Label refinement rounds' },
        ]
      }
    ]
  },
  consistency: {
    name: 'Consistency Regularization Features',
    description: 'Features for consistency-based learning',
    sections: [
      {
        id: 'perturbations',
        name: 'Perturbation Configuration',
        fields: [
          { id: 'perturbationType', name: 'Perturbation Type', type: 'select', options: ['dropout', 'noise', 'augmentation'], default: 'dropout', description: 'How to perturb inputs' },
          { id: 'perturbationStrength', name: 'Strength', type: 'slider', min: 0.1, max: 0.5, step: 0.05, default: 0.2, description: 'Perturbation magnitude' },
        ]
      },
      {
        id: 'loss',
        name: 'Consistency Loss',
        fields: [
          { id: 'consistencyWeight', name: 'Consistency Weight', type: 'slider', min: 0.1, max: 2.0, step: 0.1, default: 1.0, description: 'Weight of consistency loss' },
          { id: 'consistencyLossType', name: 'Loss Type', type: 'select', options: ['mse', 'kl_div', 'js_div'], default: 'mse', description: 'Consistency loss function' },
        ]
      }
    ]
  }
} as const;

export type FeaturePipelineKey = keyof typeof FEATURE_PIPELINES;

// ============== VALIDATION CONFIGS BY CATEGORY ==============

export const VALIDATION_CONFIGS = {
  classification: {
    name: 'Classification Validation',
    methods: ['kfold', 'stratified_kfold', 'time_series_split'],
    defaultMethod: 'stratified_kfold',
    metrics: ['accuracy', 'precision', 'recall', 'f1', 'rocAuc']
  },
  regression: {
    name: 'Regression Validation',
    methods: ['kfold', 'time_series_split', 'expanding_window'],
    defaultMethod: 'time_series_split',
    metrics: ['mae', 'rmse', 'mape', 'r2']
  },
  sequence: {
    name: 'Sequence Validation',
    methods: ['time_series_split', 'walk_forward', 'expanding_window', 'sliding_window'],
    defaultMethod: 'walk_forward',
    metrics: ['mae', 'rmse', 'directionalAccuracy', 'forecastBias']
  },
  clustering: {
    name: 'Clustering Validation',
    methods: ['holdout', 'bootstrap', 'stability_analysis'],
    defaultMethod: 'stability_analysis',
    metrics: ['silhouetteScore', 'daviesBouldin', 'calinskiHarabasz']
  },
  'dimensionality-reduction': {
    name: 'Dimensionality Reduction Validation',
    methods: ['reconstruction_error', 'cross_validation', 'downstream_task'],
    defaultMethod: 'reconstruction_error',
    metrics: ['explainedVariance', 'reconstructionError', 'trustworthiness']
  },
  'anomaly-detection': {
    name: 'Anomaly Detection Validation',
    methods: ['holdout', 'time_series_split', 'cross_validation'],
    defaultMethod: 'holdout',
    metrics: ['precision', 'recall', 'f1', 'anomalyRate']
  },
  representation: {
    name: 'Representation Validation',
    methods: ['reconstruction_error', 'linear_probe', 'downstream_task'],
    defaultMethod: 'reconstruction_error',
    metrics: ['reconstructionLoss', 'embeddingQuality', 'linearProbeAccuracy']
  },
  contrastive: {
    name: 'Contrastive Validation',
    methods: ['linear_probe', 'knn_evaluation', 'downstream_task'],
    defaultMethod: 'linear_probe',
    metrics: ['alignmentScore', 'uniformityScore', 'linearProbeAccuracy']
  },
  'pseudo-labeling': {
    name: 'Pseudo-Labeling Validation',
    methods: ['holdout', 'cross_validation'],
    defaultMethod: 'holdout',
    metrics: ['accuracy', 'labelConfidence', 'pseudoLabelAccuracy']
  },
  consistency: {
    name: 'Consistency Validation',
    methods: ['holdout', 'cross_validation'],
    defaultMethod: 'holdout',
    metrics: ['accuracy', 'consistencyLoss', 'unlabeledLoss']
  }
} as const;

// ============== DATA CONTRACTS ==============
// Defines input/output data requirements for each model category

export const DATA_CONTRACTS = {
  classification: {
    id: 'classification',
    requiresLabels: true,
    inputs: {
      features: ['ohlcv', 'technical_indicators', 'returns', 'volatility'],
      minSamples: 1000,
      featureTypes: ['numeric', 'categorical'],
    },
    labels: {
      type: 'categorical',
      generation: ['direction', 'signal', 'regime', 'pattern'],
      encoding: 'onehot',
      balancing: ['none', 'oversample', 'undersample', 'smote'],
    },
    outputs: {
      predictions: 'class_probabilities',
      embeddings: 'penultimate_layer',
    },
    trainingStream: {
      metrics: ['loss', 'accuracy', 'val_loss', 'val_accuracy'],
      visualizations: ['loss_curves', 'confusion_matrix_live', 'class_distribution'],
      updateFrequency: 'per_epoch',
    },
    priceOverlay: {
      showLabels: true,
      labelMarkers: ['buy_signal', 'sell_signal', 'hold'],
      predictionMarkers: true,
      confidenceBands: true,
    },
  },
  regression: {
    id: 'regression',
    requiresLabels: true,
    inputs: {
      features: ['ohlcv', 'technical_indicators', 'returns', 'lagged_values'],
      minSamples: 500,
      featureTypes: ['numeric'],
    },
    labels: {
      type: 'continuous',
      generation: ['future_return', 'future_price', 'volatility', 'range'],
      encoding: 'none',
      transforms: ['none', 'log', 'diff', 'zscore'],
    },
    outputs: {
      predictions: 'point_estimate',
      uncertainty: 'prediction_interval',
      embeddings: 'penultimate_layer',
    },
    trainingStream: {
      metrics: ['loss', 'mae', 'rmse', 'val_loss', 'r2'],
      visualizations: ['loss_curves', 'residual_scatter', 'predicted_vs_actual'],
      updateFrequency: 'per_epoch',
    },
    priceOverlay: {
      showLabels: true,
      labelMarkers: ['target_value'],
      predictionLine: true,
      predictionBands: true,
      residualOverlay: true,
    },
  },
  sequence: {
    id: 'sequence',
    requiresLabels: true,
    inputs: {
      features: ['ohlcv_sequence', 'temporal_encoding', 'lagged_features'],
      minSamples: 2000,
      featureTypes: ['numeric_sequence'],
      sequenceLength: { min: 10, max: 500, default: 60 },
    },
    labels: {
      type: 'sequence',
      generation: ['future_values', 'multi_step_ahead'],
      encoding: 'none',
      horizons: [1, 5, 10, 20],
    },
    outputs: {
      predictions: 'sequence_forecast',
      attention: 'attention_weights',
      embeddings: 'hidden_states',
    },
    trainingStream: {
      metrics: ['loss', 'mae', 'directional_accuracy', 'val_loss'],
      visualizations: ['3d_loss_surface', 'forecast_ribbon', 'attention_heatmap'],
      updateFrequency: 'per_batch',
    },
    priceOverlay: {
      showLabels: true,
      forecastRibbon: true,
      actualVsPredicted: true,
      horizonMarkers: true,
      attentionOverlay: true,
    },
  },
  clustering: {
    id: 'clustering',
    requiresLabels: false,
    inputs: {
      features: ['ohlcv_windows', 'technical_indicators', 'volatility_features'],
      minSamples: 500,
      featureTypes: ['numeric'],
      preprocessing: ['normalize', 'pca_reduction'],
    },
    labels: {
      type: 'none',
      generation: null,
      discoveredLabels: 'cluster_assignments',
      semanticMapping: ['regime', 'volatility_state', 'trend_phase'],
    },
    outputs: {
      assignments: 'cluster_ids',
      centroids: 'cluster_centers',
      embeddings: '2d_projection',
    },
    trainingStream: {
      metrics: ['inertia', 'silhouette', 'davies_bouldin', 'n_clusters'],
      visualizations: ['force_directed_graph', 'cluster_formation_2d', 'centroid_movement'],
      updateFrequency: 'per_iteration',
    },
    priceOverlay: {
      showClusters: true,
      clusterBackground: true,
      regimeTransitions: true,
      clusterLabels: true,
    },
  },
  'dimensionality-reduction': {
    id: 'dimensionality-reduction',
    requiresLabels: false,
    inputs: {
      features: ['high_dimensional_features', 'all_technical_indicators'],
      minSamples: 500,
      featureTypes: ['numeric'],
      inputDimension: { min: 10, max: 1000 },
    },
    labels: {
      type: 'none',
      generation: null,
    },
    outputs: {
      embeddings: 'low_dimensional_projection',
      loadings: 'component_loadings',
      reconstruction: 'reconstructed_features',
    },
    trainingStream: {
      metrics: ['explained_variance', 'reconstruction_error', 'n_components'],
      visualizations: ['scree_plot', 'embedding_scatter', 'loading_heatmap'],
      updateFrequency: 'per_component',
    },
    priceOverlay: {
      embeddingTrajectory: true,
      componentActivation: true,
      reconstructionQuality: true,
    },
  },
  'anomaly-detection': {
    id: 'anomaly-detection',
    requiresLabels: false,
    inputs: {
      features: ['ohlcv', 'returns', 'volatility', 'volume_profile'],
      minSamples: 1000,
      featureTypes: ['numeric'],
      contextWindow: { min: 5, max: 100 },
    },
    labels: {
      type: 'none',
      generation: null,
      groundTruth: 'optional_known_anomalies',
    },
    outputs: {
      scores: 'anomaly_scores',
      binary: 'anomaly_flags',
      explanations: 'feature_contributions',
    },
    trainingStream: {
      metrics: ['reconstruction_error', 'threshold', 'anomaly_rate'],
      visualizations: ['score_distribution', 'threshold_line', 'anomaly_timeline'],
      updateFrequency: 'per_epoch',
    },
    priceOverlay: {
      anomalyMarkers: true,
      scoreHeatmap: true,
      thresholdLine: true,
      explanationTooltips: true,
    },
  },
  representation: {
    id: 'representation',
    requiresLabels: false,
    inputs: {
      features: ['ohlcv_windows', 'raw_price_data'],
      minSamples: 2000,
      featureTypes: ['numeric_sequence'],
    },
    labels: {
      type: 'self',
      generation: ['autoencoder_reconstruction', 'masked_prediction'],
    },
    outputs: {
      embeddings: 'latent_representation',
      reconstruction: 'decoded_output',
    },
    trainingStream: {
      metrics: ['reconstruction_loss', 'embedding_variance', 'latent_sparsity'],
      visualizations: ['latent_space_2d', 'reconstruction_samples', 'loss_curve'],
      updateFrequency: 'per_epoch',
    },
    priceOverlay: {
      embeddingTrajectory: true,
      reconstructionComparison: true,
      latentActivation: true,
    },
  },
  contrastive: {
    id: 'contrastive',
    requiresLabels: false,
    inputs: {
      features: ['ohlcv_windows', 'augmented_views'],
      minSamples: 5000,
      featureTypes: ['numeric_sequence'],
      augmentations: ['noise', 'mask', 'shift', 'scale'],
    },
    labels: {
      type: 'self',
      generation: ['positive_pairs', 'negative_sampling'],
    },
    outputs: {
      embeddings: 'contrastive_representation',
      similarities: 'pair_similarities',
    },
    trainingStream: {
      metrics: ['contrastive_loss', 'alignment', 'uniformity', 'temperature'],
      visualizations: ['similarity_matrix', 'embedding_scatter', 'loss_curve'],
      updateFrequency: 'per_batch',
    },
    priceOverlay: {
      similarWindowHighlight: true,
      embeddingTrajectory: true,
    },
  },
  'pseudo-labeling': {
    id: 'pseudo-labeling',
    requiresLabels: 'partial',
    inputs: {
      features: ['ohlcv', 'technical_indicators'],
      minSamples: 2000,
      labeledRatio: { min: 0.01, max: 0.5 },
    },
    labels: {
      type: 'categorical',
      generation: ['manual_subset', 'high_confidence_auto'],
      pseudoLabeling: true,
    },
    outputs: {
      predictions: 'class_probabilities',
      confidence: 'prediction_confidence',
      pseudoLabels: 'generated_labels',
    },
    trainingStream: {
      metrics: ['labeled_loss', 'unlabeled_loss', 'pseudo_accuracy', 'confidence_mean'],
      visualizations: ['confidence_distribution', 'pseudo_label_growth', 'loss_curves'],
      updateFrequency: 'per_epoch',
    },
    priceOverlay: {
      labeledMarkers: true,
      pseudoLabelMarkers: true,
      confidenceHeatmap: true,
    },
  },
  consistency: {
    id: 'consistency',
    requiresLabels: 'partial',
    inputs: {
      features: ['ohlcv', 'technical_indicators'],
      minSamples: 2000,
      perturbations: ['dropout', 'noise', 'augmentation'],
    },
    labels: {
      type: 'categorical',
      generation: ['manual_subset'],
      consistencyTarget: 'prediction_agreement',
    },
    outputs: {
      predictions: 'class_probabilities',
      consistency: 'perturbation_agreement',
    },
    trainingStream: {
      metrics: ['supervised_loss', 'consistency_loss', 'total_loss', 'accuracy'],
      visualizations: ['loss_decomposition', 'consistency_scatter', 'prediction_stability'],
      updateFrequency: 'per_epoch',
    },
    priceOverlay: {
      labeledMarkers: true,
      consistencyHeatmap: true,
    },
  },
} as const;

export type DataContractKey = keyof typeof DATA_CONTRACTS;

// ============== LAYOUT SCHEMAS ==============
// Per-category visualization layouts - not constrained to uniform panels

export const LAYOUT_SCHEMAS = {
  classification: {
    id: 'classification',
    training: {
      layout: 'grid-2x3',
      panels: [
        { id: 'loss_curves', size: 'large', position: [0, 0], span: [1, 2] },
        { id: 'confusion_matrix', size: 'medium', position: [0, 2], span: [1, 1] },
        { id: 'class_distribution', size: 'medium', position: [1, 0], span: [1, 1] },
        { id: 'roc_curve', size: 'medium', position: [1, 1], span: [1, 1] },
        { id: 'metrics_panel', size: 'medium', position: [1, 2], span: [1, 1] },
      ],
    },
    analysis: {
      layout: 'grid-3x2',
      panels: [
        { id: 'decision_boundary', size: 'large', position: [0, 0], span: [2, 1] },
        { id: 'feature_importance', size: 'medium', position: [0, 1], span: [1, 1] },
        { id: 'calibration_curve', size: 'medium', position: [1, 1], span: [1, 1] },
        { id: 'precision_recall', size: 'medium', position: [2, 0], span: [1, 1] },
        { id: 'class_metrics', size: 'medium', position: [2, 1], span: [1, 1] },
      ],
    },
    priceOverlay: ['label_markers', 'prediction_markers', 'confidence_bands'],
  },
  regression: {
    id: 'regression',
    training: {
      layout: 'grid-2x3',
      panels: [
        { id: 'loss_curves', size: 'large', position: [0, 0], span: [1, 2] },
        { id: 'residual_scatter', size: 'medium', position: [0, 2], span: [1, 1] },
        { id: 'predicted_vs_actual', size: 'medium', position: [1, 0], span: [1, 1] },
        { id: 'error_distribution', size: 'medium', position: [1, 1], span: [1, 1] },
        { id: 'metrics_panel', size: 'medium', position: [1, 2], span: [1, 1] },
      ],
    },
    analysis: {
      layout: 'grid-2x2',
      panels: [
        { id: 'residuals_over_time', size: 'large', position: [0, 0], span: [1, 2] },
        { id: 'feature_importance', size: 'medium', position: [1, 0], span: [1, 1] },
        { id: 'prediction_intervals', size: 'medium', position: [1, 1], span: [1, 1] },
      ],
    },
    priceOverlay: ['target_values', 'predictions', 'prediction_bands', 'residuals'],
  },
  sequence: {
    id: 'sequence',
    training: {
      layout: 'grid-2x3',
      panels: [
        { id: 'loss_surface_3d', size: 'xlarge', position: [0, 0], span: [2, 2] },
        { id: 'forecast_ribbon', size: 'medium', position: [0, 2], span: [1, 1] },
        { id: 'attention_heatmap', size: 'medium', position: [1, 2], span: [1, 1] },
      ],
    },
    analysis: {
      layout: 'grid-3x2',
      panels: [
        { id: 'multi_horizon_forecast', size: 'large', position: [0, 0], span: [1, 2] },
        { id: 'autocorrelation', size: 'medium', position: [1, 0], span: [1, 1] },
        { id: 'forecast_error_by_horizon', size: 'medium', position: [1, 1], span: [1, 1] },
        { id: 'directional_accuracy', size: 'medium', position: [2, 0], span: [1, 1] },
        { id: 'rolling_metrics', size: 'medium', position: [2, 1], span: [1, 1] },
      ],
    },
    priceOverlay: ['forecast_ribbon', 'horizon_markers', 'attention_weights'],
  },
  clustering: {
    id: 'clustering',
    training: {
      layout: 'grid-2x3',
      panels: [
        { id: 'force_directed_graph', size: 'xlarge', position: [0, 0], span: [2, 2] },
        { id: 'cluster_formation', size: 'medium', position: [0, 2], span: [1, 1] },
        { id: 'silhouette_progress', size: 'medium', position: [1, 2], span: [1, 1] },
      ],
    },
    analysis: {
      layout: 'grid-3x3',
      panels: [
        { id: 'cluster_scatter_2d', size: 'large', position: [0, 0], span: [2, 2] },
        { id: 'cluster_profiles', size: 'medium', position: [0, 2], span: [1, 1] },
        { id: 'silhouette_per_cluster', size: 'medium', position: [1, 2], span: [1, 1] },
        { id: 'cluster_sizes', size: 'small', position: [2, 0], span: [1, 1] },
        { id: 'inter_cluster_distance', size: 'small', position: [2, 1], span: [1, 1] },
        { id: 'cluster_stability', size: 'small', position: [2, 2], span: [1, 1] },
      ],
    },
    priceOverlay: ['cluster_background', 'regime_transitions', 'cluster_labels'],
  },
  'dimensionality-reduction': {
    id: 'dimensionality-reduction',
    training: {
      layout: 'grid-2x2',
      panels: [
        { id: 'embedding_scatter', size: 'large', position: [0, 0], span: [1, 2] },
        { id: 'variance_explained', size: 'medium', position: [1, 0], span: [1, 1] },
        { id: 'reconstruction_error', size: 'medium', position: [1, 1], span: [1, 1] },
      ],
    },
    analysis: {
      layout: 'grid-2x3',
      panels: [
        { id: 'component_loadings', size: 'large', position: [0, 0], span: [1, 2] },
        { id: 'biplot', size: 'medium', position: [0, 2], span: [1, 1] },
        { id: 'scree_plot', size: 'medium', position: [1, 0], span: [1, 1] },
        { id: 'reconstruction_samples', size: 'medium', position: [1, 1], span: [1, 2] },
      ],
    },
    priceOverlay: ['embedding_trajectory', 'component_activation'],
  },
  'anomaly-detection': {
    id: 'anomaly-detection',
    training: {
      layout: 'grid-2x3',
      panels: [
        { id: 'anomaly_timeline', size: 'xlarge', position: [0, 0], span: [1, 3] },
        { id: 'score_distribution', size: 'medium', position: [1, 0], span: [1, 1] },
        { id: 'threshold_analysis', size: 'medium', position: [1, 1], span: [1, 1] },
        { id: 'metrics_panel', size: 'medium', position: [1, 2], span: [1, 1] },
      ],
    },
    analysis: {
      layout: 'grid-3x2',
      panels: [
        { id: 'price_with_anomalies', size: 'xlarge', position: [0, 0], span: [1, 2] },
        { id: 'feature_contributions', size: 'medium', position: [1, 0], span: [1, 1] },
        { id: 'anomaly_clusters', size: 'medium', position: [1, 1], span: [1, 1] },
        { id: 'temporal_patterns', size: 'medium', position: [2, 0], span: [1, 1] },
        { id: 'severity_histogram', size: 'medium', position: [2, 1], span: [1, 1] },
      ],
    },
    priceOverlay: ['anomaly_markers', 'score_heatmap', 'threshold_line'],
  },
  representation: {
    id: 'representation',
    training: {
      layout: 'grid-2x2',
      panels: [
        { id: 'latent_space_2d', size: 'large', position: [0, 0], span: [1, 1] },
        { id: 'reconstruction_samples', size: 'large', position: [0, 1], span: [1, 1] },
        { id: 'loss_curve', size: 'medium', position: [1, 0], span: [1, 1] },
        { id: 'latent_distribution', size: 'medium', position: [1, 1], span: [1, 1] },
      ],
    },
    analysis: {
      layout: 'grid-2x2',
      panels: [
        { id: 'embedding_trajectory', size: 'large', position: [0, 0], span: [1, 2] },
        { id: 'reconstruction_quality', size: 'medium', position: [1, 0], span: [1, 1] },
        { id: 'latent_interpolation', size: 'medium', position: [1, 1], span: [1, 1] },
      ],
    },
    priceOverlay: ['embedding_color', 'reconstruction_comparison'],
  },
  contrastive: {
    id: 'contrastive',
    training: {
      layout: 'grid-2x2',
      panels: [
        { id: 'similarity_matrix', size: 'large', position: [0, 0], span: [1, 1] },
        { id: 'embedding_scatter', size: 'large', position: [0, 1], span: [1, 1] },
        { id: 'loss_curve', size: 'medium', position: [1, 0], span: [1, 1] },
        { id: 'alignment_uniformity', size: 'medium', position: [1, 1], span: [1, 1] },
      ],
    },
    analysis: {
      layout: 'grid-2x2',
      panels: [
        { id: 'nearest_neighbors', size: 'large', position: [0, 0], span: [1, 1] },
        { id: 'pair_distances', size: 'large', position: [0, 1], span: [1, 1] },
        { id: 'augmentation_effect', size: 'medium', position: [1, 0], span: [1, 2] },
      ],
    },
    priceOverlay: ['similar_window_highlight'],
  },
  'pseudo-labeling': {
    id: 'pseudo-labeling',
    training: {
      layout: 'grid-2x3',
      panels: [
        { id: 'loss_curves', size: 'large', position: [0, 0], span: [1, 2] },
        { id: 'confidence_distribution', size: 'medium', position: [0, 2], span: [1, 1] },
        { id: 'pseudo_label_growth', size: 'medium', position: [1, 0], span: [1, 1] },
        { id: 'label_accuracy', size: 'medium', position: [1, 1], span: [1, 1] },
        { id: 'metrics_panel', size: 'medium', position: [1, 2], span: [1, 1] },
      ],
    },
    analysis: {
      layout: 'grid-2x2',
      panels: [
        { id: 'labeled_vs_pseudo', size: 'large', position: [0, 0], span: [1, 2] },
        { id: 'confidence_threshold_effect', size: 'medium', position: [1, 0], span: [1, 1] },
        { id: 'iteration_improvement', size: 'medium', position: [1, 1], span: [1, 1] },
      ],
    },
    priceOverlay: ['labeled_markers', 'pseudo_label_markers', 'confidence_heatmap'],
  },
  consistency: {
    id: 'consistency',
    training: {
      layout: 'grid-2x3',
      panels: [
        { id: 'loss_decomposition', size: 'large', position: [0, 0], span: [1, 2] },
        { id: 'consistency_scatter', size: 'medium', position: [0, 2], span: [1, 1] },
        { id: 'prediction_stability', size: 'medium', position: [1, 0], span: [1, 1] },
        { id: 'perturbation_effect', size: 'medium', position: [1, 1], span: [1, 1] },
        { id: 'metrics_panel', size: 'medium', position: [1, 2], span: [1, 1] },
      ],
    },
    analysis: {
      layout: 'grid-2x2',
      panels: [
        { id: 'labeled_performance', size: 'large', position: [0, 0], span: [1, 1] },
        { id: 'unlabeled_consistency', size: 'large', position: [0, 1], span: [1, 1] },
        { id: 'perturbation_robustness', size: 'medium', position: [1, 0], span: [1, 2] },
      ],
    },
    priceOverlay: ['labeled_markers', 'consistency_heatmap'],
  },
} as const;

export type LayoutSchemaKey = keyof typeof LAYOUT_SCHEMAS;

// ============== LABEL GENERATION SPECS ==============
// How to generate labels for supervised models from raw price data

export const LABEL_GENERATORS = {
  direction: {
    id: 'direction',
    name: 'Price Direction',
    description: 'Binary/ternary labels based on price movement',
    category: 'classification',
    params: [
      { id: 'horizon', name: 'Horizon (bars)', type: 'number', default: 1, min: 1, max: 100 },
      { id: 'threshold', name: 'Threshold (%)', type: 'number', default: 0, min: 0, max: 5, step: 0.1 },
      { id: 'numClasses', name: 'Classes', type: 'select', options: [2, 3], default: 2 },
    ],
    generate: 'if future_return > threshold: 1 (up), elif future_return < -threshold: -1 (down), else: 0 (neutral)',
  },
  signal: {
    id: 'signal',
    name: 'Trading Signal',
    description: 'Buy/Sell/Hold signals based on custom rules',
    category: 'classification',
    params: [
      { id: 'entryThreshold', name: 'Entry Threshold', type: 'number', default: 0.5, min: 0, max: 2 },
      { id: 'exitThreshold', name: 'Exit Threshold', type: 'number', default: 0.3, min: 0, max: 2 },
      { id: 'holdPeriod', name: 'Min Hold Period', type: 'number', default: 5, min: 1, max: 50 },
    ],
    generate: 'rule-based signal generation with entry/exit thresholds',
  },
  regime: {
    id: 'regime',
    name: 'Market Regime',
    description: 'Labels based on volatility and trend state',
    category: 'classification',
    params: [
      { id: 'volatilityWindow', name: 'Volatility Window', type: 'number', default: 20, min: 5, max: 100 },
      { id: 'trendWindow', name: 'Trend Window', type: 'number', default: 50, min: 10, max: 200 },
      { id: 'numRegimes', name: 'Number of Regimes', type: 'number', default: 4, min: 2, max: 8 },
    ],
    generate: 'HMM or rule-based regime detection combining volatility and trend',
  },
  future_return: {
    id: 'future_return',
    name: 'Future Return',
    description: 'Continuous label for return prediction',
    category: 'regression',
    params: [
      { id: 'horizon', name: 'Horizon (bars)', type: 'number', default: 1, min: 1, max: 100 },
      { id: 'returnType', name: 'Return Type', type: 'select', options: ['simple', 'log'], default: 'simple' },
      { id: 'normalize', name: 'Normalize', type: 'boolean', default: false },
    ],
    generate: '(price[t+h] - price[t]) / price[t] for simple, log(price[t+h]/price[t]) for log',
  },
  future_volatility: {
    id: 'future_volatility',
    name: 'Future Volatility',
    description: 'Realized volatility over future window',
    category: 'regression',
    params: [
      { id: 'horizon', name: 'Horizon (bars)', type: 'number', default: 20, min: 5, max: 100 },
      { id: 'method', name: 'Method', type: 'select', options: ['std', 'parkinson', 'garman_klass'], default: 'std' },
    ],
    generate: 'std(returns[t:t+h]) or Parkinson/Garman-Klass estimator',
  },
  multi_step: {
    id: 'multi_step',
    name: 'Multi-Step Forecast',
    description: 'Sequence of future values for time-series models',
    category: 'sequence',
    params: [
      { id: 'horizons', name: 'Forecast Horizons', type: 'array', default: [1, 5, 10, 20] },
      { id: 'target', name: 'Target', type: 'select', options: ['close', 'returns', 'volatility'], default: 'close' },
    ],
    generate: '[target[t+h1], target[t+h2], ...] for each horizon',
  },

  // ============== ADVANCED SUPERVISED LABELS ==============
  
  triple_barrier: {
    id: 'triple_barrier',
    name: 'Triple Barrier',
    description: 'Industry-standard labeling: take-profit, stop-loss, and time barriers (Marcos López de Prado)',
    category: 'classification',
    params: [
      { id: 'takeProfitPct', name: 'Take Profit (%)', type: 'number', default: 1.0, min: 0.1, max: 10, step: 0.1 },
      { id: 'stopLossPct', name: 'Stop Loss (%)', type: 'number', default: 0.5, min: 0.1, max: 10, step: 0.1 },
      { id: 'maxHoldingPeriod', name: 'Max Holding (bars)', type: 'number', default: 20, min: 1, max: 100 },
      { id: 'minReturn', name: 'Min Return Filter (%)', type: 'number', default: 0.1, min: 0, max: 5, step: 0.05 },
      { id: 'volatilityAdjust', name: 'Volatility Adjust', type: 'boolean', default: true },
      { id: 'volatilityWindow', name: 'Vol Window (bars)', type: 'number', default: 20, min: 5, max: 100 },
    ],
    generate: `
      For each bar t:
      1. Compute barriers: upper = close[t] * (1 + takeProfitPct/100), lower = close[t] * (1 - stopLossPct/100)
      2. If volatilityAdjust: scale barriers by rolling volatility ratio
      3. Look forward up to maxHoldingPeriod bars
      4. Label = 1 (hit upper first), -1 (hit lower first), 0 (timeout/neutral)
      5. Filter: discard labels where |return| < minReturn
    `,
  },
  
  npmm: {
    id: 'npmm',
    name: 'N-Period Min-Max (NPMM)',
    description: 'Labels at local extrema only, filtering noise between inflection points',
    category: 'classification',
    params: [
      { id: 'lookbackPeriod', name: 'Lookback (bars)', type: 'number', default: 10, min: 3, max: 50 },
      { id: 'lookforwardPeriod', name: 'Lookforward (bars)', type: 'number', default: 10, min: 3, max: 50 },
      { id: 'confirmationBars', name: 'Confirmation Bars', type: 'number', default: 2, min: 1, max: 10 },
      { id: 'minMovePct', name: 'Min Move (%)', type: 'number', default: 0.3, min: 0, max: 5, step: 0.1 },
    ],
    generate: `
      For each bar t:
      1. Check if close[t] is local minimum in [t-lookback, t+lookforward]
      2. Check if close[t] is local maximum in same window
      3. Require confirmationBars consecutive lower/higher closes after extrema
      4. Label = 1 (local min = buy), -1 (local max = sell), NULL (skip this sample)
      5. Filter: require minMovePct move from extrema within lookforward
    `,
  },
  
  volatility_adaptive: {
    id: 'volatility_adaptive',
    name: 'Volatility-Adaptive Direction',
    description: 'Labels only significant moves relative to current volatility regime',
    category: 'classification',
    params: [
      { id: 'horizon', name: 'Horizon (bars)', type: 'number', default: 5, min: 1, max: 50 },
      { id: 'volatilityWindow', name: 'Vol Window (bars)', type: 'number', default: 20, min: 5, max: 100 },
      { id: 'threshold', name: 'Vol Multiple (σ)', type: 'number', default: 1.5, min: 0.5, max: 3, step: 0.1 },
      { id: 'numClasses', name: 'Classes', type: 'select', options: [2, 3], default: 3 },
    ],
    generate: `
      For each bar t:
      1. Compute rolling volatility σ over volatilityWindow
      2. Compute future return r = (close[t+h] - close[t]) / close[t]
      3. If |r| >= threshold * σ: label = sign(r)
      4. If numClasses=3 and |r| < threshold * σ: label = 0 (neutral)
      5. If numClasses=2: force binary (-1 or 1) based on sign
    `,
  },
  
  trend_scanning: {
    id: 'trend_scanning',
    name: 'Trend-Scanning',
    description: 'Dynamically finds optimal prediction horizon per sample using t-statistics',
    category: 'classification',
    params: [
      { id: 'minHorizon', name: 'Min Horizon (bars)', type: 'number', default: 3, min: 1, max: 20 },
      { id: 'maxHorizon', name: 'Max Horizon (bars)', type: 'number', default: 20, min: 5, max: 100 },
      { id: 'tThreshold', name: 'T-Stat Threshold', type: 'number', default: 2.0, min: 1, max: 4, step: 0.1 },
      { id: 'minSamples', name: 'Min Samples per Window', type: 'number', default: 5, min: 3, max: 20 },
    ],
    generate: `
      For each bar t:
      1. Test horizons h in [minHorizon, maxHorizon]
      2. For each h: regress returns on time, compute t-statistic of slope
      3. Select h* with highest |t-stat|
      4. If |t-stat| >= tThreshold: label = sign(slope)
      5. Else: label = 0 (no significant trend)
      Also outputs: optimal_horizon, t_statistic as auxiliary columns
    `,
  },
  
  meta_label: {
    id: 'meta_label',
    name: 'Meta-Label',
    description: 'Secondary labels for bet sizing: did the primary signal profit?',
    category: 'classification',
    params: [
      { id: 'primarySignalColumn', name: 'Primary Signal Column', type: 'string', default: 'primary_signal' },
      { id: 'horizon', name: 'Evaluation Horizon (bars)', type: 'number', default: 10, min: 1, max: 50 },
      { id: 'transactionCostBps', name: 'Transaction Cost (bps)', type: 'number', default: 5, min: 0, max: 50 },
      { id: 'minProfitBps', name: 'Min Profit Threshold (bps)', type: 'number', default: 10, min: 0, max: 100 },
    ],
    generate: `
      For each bar t where primary_signal != 0:
      1. Compute pnl = primary_signal * (close[t+h] - close[t]) / close[t]
      2. Subtract transaction costs: net_pnl = pnl - transactionCostBps/10000
      3. Label = 1 if net_pnl >= minProfitBps/10000, else 0 (skip this signal)
      Used for: position sizing, signal filtering, confidence estimation
    `,
  },
  
  // ============== SELF-SUPERVISED LABELS ==============
  
  contrastive_temporal: {
    id: 'contrastive_temporal',
    name: 'Temporal Contrastive Pairs',
    description: 'Generate positive/negative pairs based on temporal proximity',
    category: 'contrastive',
    params: [
      { id: 'windowSize', name: 'Window Size (bars)', type: 'number', default: 60, min: 10, max: 500 },
      { id: 'positiveRadius', name: 'Positive Radius (bars)', type: 'number', default: 5, min: 1, max: 30 },
      { id: 'negativeMinGap', name: 'Negative Min Gap (bars)', type: 'number', default: 20, min: 5, max: 100 },
      { id: 'samplesPerAnchor', name: 'Samples per Anchor', type: 'number', default: 4, min: 1, max: 16 },
    ],
    generate: `
      For each anchor window W[t:t+windowSize]:
      1. Positive pairs: windows overlapping within positiveRadius
      2. Negative pairs: windows separated by >= negativeMinGap
      3. Sample samplesPerAnchor positives and negatives per anchor
      Output: (anchor_idx, positive_idx, negative_idx) triplets
    `,
  },
  
  contrastive_augmentation: {
    id: 'contrastive_augmentation',
    name: 'Augmentation Contrastive',
    description: 'Positive pairs from augmented views of same window',
    category: 'contrastive',
    params: [
      { id: 'windowSize', name: 'Window Size (bars)', type: 'number', default: 60, min: 10, max: 500 },
      { id: 'jitterScale', name: 'Jitter Scale (σ)', type: 'number', default: 0.01, min: 0, max: 0.1, step: 0.001 },
      { id: 'scalingRange', name: 'Scaling Range', type: 'array', default: [0.9, 1.1] },
      { id: 'cropRatio', name: 'Random Crop Ratio', type: 'number', default: 0.8, min: 0.5, max: 1.0, step: 0.05 },
    ],
    generate: `
      For each window W:
      1. View1: apply random jitter (Gaussian noise with jitterScale)
      2. View2: apply random scaling within scalingRange
      3. Both views may be randomly cropped to cropRatio of original length
      Positive pair: (View1, View2) of same window
      Negative pair: different windows from batch
    `,
  },
  
  contrastive_statistical: {
    id: 'contrastive_statistical',
    name: 'Statistical Hypothesis Pairs',
    description: 'Mine pairs using hypothesis testing on returns correlation across windows',
    category: 'contrastive',
    params: [
      { id: 'windowSize', name: 'Window Size (bars)', type: 'number', default: 60, min: 10, max: 500 },
      { id: 'numRollingWindows', name: 'Rolling Windows', type: 'number', default: 20, min: 5, max: 50 },
      { id: 'alphaLevel', name: 'Alpha Level', type: 'number', default: 0.05, min: 0.01, max: 0.2, step: 0.01 },
      { id: 'correlationThreshold', name: 'Correlation Threshold', type: 'number', default: 0.7, min: 0.3, max: 0.95, step: 0.05 },
    ],
    generate: `
      For asset pairs (i, j):
      1. Compute correlation across numRollingWindows periods
      2. Test H0: proportion of high-corr windows = random chance
      3. Positive pair: reject H0 and proportion > expected
      4. Negative pair: reject H0 and proportion < expected
      Works for multi-asset portfolios; single-asset uses temporal windows
    `,
  },
  
  // ============== SEMI-SUPERVISED LABELS ==============
  
  pseudo_confidence: {
    id: 'pseudo_confidence',
    name: 'Confidence-Filtered Pseudo-Labels',
    description: 'Generate pseudo-labels from teacher model, filtered by confidence',
    category: 'pseudo-labeling',
    params: [
      { id: 'teacherPredColumn', name: 'Teacher Prediction Column', type: 'string', default: 'teacher_pred' },
      { id: 'teacherConfColumn', name: 'Teacher Confidence Column', type: 'string', default: 'teacher_conf' },
      { id: 'confidenceThreshold', name: 'Confidence Threshold', type: 'number', default: 0.9, min: 0.5, max: 0.99, step: 0.01 },
      { id: 'classBalancing', name: 'Class Balancing', type: 'boolean', default: true },
    ],
    generate: `
      For each unlabeled sample:
      1. Use teacher_pred as pseudo-label
      2. Keep only if teacher_conf >= confidenceThreshold
      3. If classBalancing: subsample majority class to match minority
      Output: filtered pseudo-labels with confidence weights
    `,
  },
  
  consistency_perturbation: {
    id: 'consistency_perturbation',
    name: 'Consistency Labels',
    description: 'Labels for consistency regularization under perturbations',
    category: 'consistency',
    params: [
      { id: 'perturbationType', name: 'Perturbation Type', type: 'select', options: ['noise', 'dropout', 'mixup'], default: 'noise' },
      { id: 'perturbationScale', name: 'Perturbation Scale', type: 'number', default: 0.1, min: 0, max: 0.5, step: 0.01 },
      { id: 'numPerturbations', name: 'Perturbations per Sample', type: 'number', default: 2, min: 1, max: 5 },
    ],
    generate: `
      For each sample x:
      1. Generate numPerturbations perturbed versions x'
      2. Consistency target: model prediction on original x (or ground truth if available)
      3. Training objective: minimize divergence between pred(x') and target
      Output: (original_idx, perturbed_data, consistency_target)
    `,
  },
} as const;

export type LabelGeneratorKey = keyof typeof LABEL_GENERATORS;

// ============== HELPER FUNCTIONS ==============

export function getCategoryForSubcategory(subcategory: string): ModelCategory | null {
  const subcat = MODEL_SUBCATEGORIES[subcategory as ModelSubcategory];
  return subcat ? subcat.category as ModelCategory : null;
}

export function getMetricsForSubcategory(subcategory: string): MetricKey[] {
  const subcat = MODEL_SUBCATEGORIES[subcategory as ModelSubcategory];
  return subcat ? [...subcat.metrics] as MetricKey[] : [];
}

export function getVisualizationsForSubcategory(subcategory: string): string[] {
  const subcat = MODEL_SUBCATEGORIES[subcategory as ModelSubcategory];
  return subcat ? [...subcat.visualizations] : [];
}

export function formatMetricValue(metricKey: string, value: number): string {
  const def = METRIC_DEFINITIONS[metricKey as MetricKey];
  if (!def) return value.toFixed(4);
  
  switch (def.format) {
    case 'percent':
      return `${(value * 100).toFixed(1)}%`;
    case 'integer':
      return Math.round(value).toString();
    case 'duration':
      return value > 60000 ? `${(value / 60000).toFixed(1)}m` : `${(value / 1000).toFixed(1)}s`;
    default:
      return value.toFixed(4);
  }
}

export function getMetricColor(metricKey: string, value: number): 'green' | 'yellow' | 'red' | 'neutral' {
  const def = METRIC_DEFINITIONS[metricKey as MetricKey];
  if (!def || def.higherBetter === null) return 'neutral';
  
  // Normalize to 0-1 scale where possible
  const [min, max] = def.range;
  if (!isFinite(min) || !isFinite(max)) return 'neutral';
  
  const normalized = (value - min) / (max - min);
  const score = def.higherBetter ? normalized : 1 - normalized;
  
  if (score >= 0.7) return 'green';
  if (score >= 0.4) return 'yellow';
  return 'red';
}

// ============== EXPLAINABLE AI (XAI) METHODS ==============

export const XAI_METHODS = {
  shap: {
    id: 'shap',
    name: 'SHAP Values',
    description: 'SHapley Additive exPlanations - game-theoretic feature attribution',
    category: 'attribution',
    output: 'feature_contributions',
    complexity: 'high',
    params: [
      { id: 'nSamples', name: 'Background Samples', type: 'number', default: 100, min: 10, max: 1000 },
      { id: 'linkFunction', name: 'Link Function', type: 'select', options: ['identity', 'logit'], default: 'identity' },
    ],
  },
  permutation: {
    id: 'permutation',
    name: 'Permutation Importance',
    description: 'Feature importance by shuffling feature values',
    category: 'attribution',
    output: 'feature_importance',
    complexity: 'medium',
    params: [
      { id: 'nRepeats', name: 'Repeats', type: 'number', default: 10, min: 1, max: 50 },
      { id: 'scoringMetric', name: 'Scoring Metric', type: 'select', options: ['accuracy', 'mse', 'mae'], default: 'accuracy' },
    ],
  },
  gradcam: {
    id: 'gradcam',
    name: 'Gradient-CAM',
    description: 'Gradient-weighted Class Activation Mapping for CNN attention',
    category: 'attention',
    output: 'attention_heatmap',
    complexity: 'medium',
    params: [
      { id: 'targetLayer', name: 'Target Layer', type: 'select', options: ['last_conv', 'all_conv'], default: 'last_conv' },
      { id: 'normalize', name: 'Normalize', type: 'boolean', default: true },
    ],
  },
  integratedGradients: {
    id: 'integratedGradients',
    name: 'Integrated Gradients',
    description: 'Attribution by integrating gradients along path from baseline',
    category: 'gradient',
    output: 'feature_attributions',
    complexity: 'high',
    params: [
      { id: 'nSteps', name: 'Integration Steps', type: 'number', default: 50, min: 10, max: 300 },
      { id: 'baseline', name: 'Baseline', type: 'select', options: ['zero', 'mean', 'random'], default: 'zero' },
    ],
  },
  saliency: {
    id: 'saliency',
    name: 'Saliency Maps',
    description: 'Input gradients showing sensitivity to each feature',
    category: 'gradient',
    output: 'saliency_map',
    complexity: 'low',
    params: [
      { id: 'absoluteValue', name: 'Absolute Value', type: 'boolean', default: true },
      { id: 'smoothing', name: 'Apply Smoothing', type: 'boolean', default: false },
    ],
  },
  lime: {
    id: 'lime',
    name: 'LIME',
    description: 'Local Interpretable Model-agnostic Explanations',
    category: 'local',
    output: 'local_explanation',
    complexity: 'high',
    params: [
      { id: 'nSamples', name: 'Perturbation Samples', type: 'number', default: 1000, min: 100, max: 5000 },
      { id: 'kernelWidth', name: 'Kernel Width', type: 'number', default: 0.75, min: 0.1, max: 2, step: 0.05 },
    ],
  },
  featureInteraction: {
    id: 'featureInteraction',
    name: 'Feature Interactions',
    description: 'Analyze pairwise feature interaction effects',
    category: 'interaction',
    output: 'interaction_matrix',
    complexity: 'high',
    params: [
      { id: 'topK', name: 'Top K Features', type: 'number', default: 10, min: 2, max: 50 },
      { id: 'interactionType', name: 'Interaction Type', type: 'select', options: ['shap', 'friedman_h'], default: 'shap' },
    ],
  },
  confidenceCalibration: {
    id: 'confidenceCalibration',
    name: 'Confidence Calibration',
    description: 'Analyze prediction confidence reliability',
    category: 'calibration',
    output: 'calibration_curve',
    complexity: 'low',
    params: [
      { id: 'nBins', name: 'Calibration Bins', type: 'number', default: 10, min: 5, max: 20 },
      { id: 'strategy', name: 'Binning Strategy', type: 'select', options: ['uniform', 'quantile'], default: 'uniform' },
    ],
  },
  counterfactual: {
    id: 'counterfactual',
    name: 'Counterfactual Explanations',
    description: 'Find minimal changes to flip prediction',
    category: 'contrastive',
    output: 'counterfactual_examples',
    complexity: 'high',
    params: [
      { id: 'nExamples', name: 'Examples to Generate', type: 'number', default: 3, min: 1, max: 10 },
      { id: 'maxChanges', name: 'Max Feature Changes', type: 'number', default: 5, min: 1, max: 20 },
    ],
  },
} as const;

export type XAIMethodKey = keyof typeof XAI_METHODS;

export const XAI_CATEGORIES = {
  attribution: {
    id: 'attribution',
    name: 'Feature Attribution',
    description: 'Methods that assign importance scores to input features',
    methods: ['shap', 'permutation'],
  },
  attention: {
    id: 'attention',
    name: 'Attention Analysis',
    description: 'Visualize model attention patterns',
    methods: ['gradcam'],
  },
  gradient: {
    id: 'gradient',
    name: 'Gradient-Based',
    description: 'Use gradients to explain predictions',
    methods: ['integratedGradients', 'saliency'],
  },
  local: {
    id: 'local',
    name: 'Local Explanations',
    description: 'Explain individual predictions',
    methods: ['lime'],
  },
  interaction: {
    id: 'interaction',
    name: 'Feature Interactions',
    description: 'Analyze how features interact',
    methods: ['featureInteraction'],
  },
  calibration: {
    id: 'calibration',
    name: 'Confidence Analysis',
    description: 'Analyze prediction confidence',
    methods: ['confidenceCalibration'],
  },
  contrastive: {
    id: 'contrastive',
    name: 'Contrastive Explanations',
    description: 'Explain via contrasting examples',
    methods: ['counterfactual'],
  },
} as const;

export type XAICategoryKey = keyof typeof XAI_CATEGORIES;

export interface XAIExplanation {
  method: XAIMethodKey;
  timestamp: number;
  prediction: {
    class: number | string;
    confidence: number;
    probabilities?: number[];
  };
  featureContributions?: Array<{
    feature: string;
    value: number;
    contribution: number;
    direction: 'positive' | 'negative';
  }>;
  attentionWeights?: number[];
  calibration?: {
    expectedConfidence: number;
    actualAccuracy: number;
    reliabilityDiagram: Array<{ binMid: number; accuracy: number; count: number }>;
  };
  counterfactuals?: Array<{
    changes: Array<{ feature: string; from: number; to: number }>;
    newPrediction: number | string;
    distance: number;
  }>;
  summary: string;
}
