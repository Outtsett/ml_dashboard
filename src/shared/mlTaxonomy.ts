/**
 * ML Model Taxonomy — Label generators, XAI methods, and explanation types.
 */

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
