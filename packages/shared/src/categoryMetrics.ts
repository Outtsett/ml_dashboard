/**
 * Category Metrics Registry — Defines universal and per-category evaluation metrics.
 *
 * OCP: New category = add entry to CATEGORY_METRICS. No other files change.
 * SRP: Pure data definitions. No rendering, no fetching.
 *
 * Each metric definition includes:
 *   - id: unique key used in metric storage
 *   - label: human-readable name
 *   - unit: display format (percent, number, ratio, score, grade)
 *   - direction: "higher" or "lower" is better
 *   - threshold: pass/fail boundary (optional)
 *   - description: plain-language explanation (visual learner style)
 */

// ── Metric Definition ────────────────────────────────────────────────────────

export interface MetricDefinition {
  id: string;
  label: string;
  unit: 'percent' | 'number' | 'ratio' | 'score' | 'grade' | 'seconds' | 'currency';
  direction: 'higher' | 'lower' | 'info';
  threshold?: number;
  description: string;
  /** Icon hint for UI (lucide icon name) */
  icon?: string;
}

export interface CategoryMetricGroup {
  id: string;
  label: string;
  description: string;
  metrics: MetricDefinition[];
}

export interface CategoryMetricsConfig {
  id: string;
  label: string;
  /** Short description for tab tooltip */
  description: string;
  /** Metric groups within this category (e.g., "Quality", "Significance") */
  groups: CategoryMetricGroup[];
}

// ── Universal Metrics (shown for ALL model categories) ───────────────────────

export const UNIVERSAL_METRICS: CategoryMetricGroup = {
  id: 'universal',
  label: 'Universal',
  description: 'Applies to every model regardless of type',
  metrics: [
    {
      id: 'quality_score',
      label: 'Quality Score',
      unit: 'score',
      direction: 'higher',
      threshold: 60,
      description: 'Overall model health — combines convergence, stability, OOS, and balance into one number (0-100)',
      icon: 'Gauge',
    },
    {
      id: 'evaluation_grade',
      label: 'Grade',
      unit: 'grade',
      direction: 'higher',
      description: 'Letter grade (A-F) from the 5-stage evaluation pipeline',
      icon: 'Award',
    },
    {
      id: 'convergence_ratio',
      label: 'Convergence',
      unit: 'percent',
      direction: 'higher',
      threshold: 0.8,
      description: 'Did the model stop improving? 100% = fully learned, low = still climbing',
      icon: 'TrendingUp',
    },
    {
      id: 'generalization_gap',
      label: 'Generalization Gap',
      unit: 'ratio',
      direction: 'lower',
      threshold: 0.15,
      description: 'Difference between train and test performance — large gap = memorized training data',
      icon: 'GitBranch',
    },
    {
      id: 'stability_score',
      label: 'Stability',
      unit: 'percent',
      direction: 'higher',
      threshold: 0.7,
      description: 'Same results across different time slices? High = trustworthy, low = random noise',
      icon: 'Shield',
    },
    {
      id: 'training_time_sec',
      label: 'Training Time',
      unit: 'seconds',
      direction: 'info',
      description: 'How long the model took to train',
      icon: 'Clock',
    },
  ],
};

// ── Category-Specific Metrics ────────────────────────────────────────────────

export const CATEGORY_METRICS: Record<string, CategoryMetricsConfig> = {
  // ── CLUSTERING / UNSUPERVISED (Regime Detection) ──
  clustering: {
    id: 'clustering',
    label: 'Clustering',
    description: 'Regime detection, market state discovery',
    groups: [
      {
        id: 'cluster_quality',
        label: 'Cluster Quality',
        description: 'Are the groups real and well-separated?',
        metrics: [
          { id: 'silhouette_score', label: 'Silhouette', unit: 'ratio', direction: 'higher', threshold: 0.2, description: 'Are bars inside each regime more similar to each other than to bars in other regimes?', icon: 'Layers' },
          { id: 'calinski_harabasz', label: 'Calinski-Harabasz', unit: 'number', direction: 'higher', threshold: 10, description: 'How tight are the clusters vs how spread apart? Higher = crisper boundaries', icon: 'Target' },
          { id: 'davies_bouldin', label: 'Davies-Bouldin', unit: 'ratio', direction: 'lower', threshold: 1.5, description: 'Do any two regimes overlap or blur into each other? Lower = cleaner separation', icon: 'CircleDot' },
          { id: 'n_regimes', label: 'Regimes Found', unit: 'number', direction: 'info', description: 'How many distinct market moods were discovered', icon: 'Layers' },
          { id: 'min_duration', label: 'Min Duration', unit: 'number', direction: 'higher', threshold: 5, description: 'Median regime run length — do regimes last long enough to trade, or just flicker?', icon: 'Timer' },
        ],
      },
      {
        id: 'cluster_separation',
        label: 'Return & Volatility Separation',
        description: 'Do different regimes actually behave differently?',
        metrics: [
          { id: 'return_separation', label: 'Return Separation', unit: 'number', direction: 'higher', threshold: 2, description: 'How many regime pairs have statistically different average returns (Welch t-test)', icon: 'ArrowUpDown' },
          { id: 'volatility_separation', label: 'Volatility Separation', unit: 'ratio', direction: 'lower', threshold: 0.05, description: 'p-value from Levene test — below 0.05 means regimes have genuinely different volatility', icon: 'Activity' },
        ],
      },
      {
        id: 'cluster_significance',
        label: 'Statistical Significance',
        description: 'Could random luck produce these clusters?',
        metrics: [
          { id: 'permutation_p', label: 'Permutation p-value', unit: 'ratio', direction: 'lower', threshold: 0.05, description: 'Shuffled labels 1000 times — your real score still beats all randoms?', icon: 'Shuffle' },
          { id: 'bootstrap_ci_low', label: 'Bootstrap CI (low)', unit: 'ratio', direction: 'higher', threshold: 0, description: '95% confidence interval lower bound — above 0 means stable clusters', icon: 'Shield' },
        ],
      },
      {
        id: 'cluster_oos',
        label: 'Out-of-Sample',
        description: 'Do the clusters hold up on unseen data?',
        metrics: [
          { id: 'oos_distribution_similarity', label: 'Distribution Similarity', unit: 'percent', direction: 'higher', threshold: 0.75, description: 'Train vs test regime proportions look similar?', icon: 'GitCompare' },
          { id: 'oos_confidence_calibration', label: 'Confidence Calibration', unit: 'ratio', direction: 'higher', threshold: 0.7, description: 'Is the model equally confident on new data?', icon: 'Gauge' },
          { id: 'oos_return_separation', label: 'OOS Return Sep.', unit: 'number', direction: 'higher', threshold: 1, description: 'Regime returns still differ on data the model never saw', icon: 'ArrowUpDown' },
          { id: 'regime_distribution_drift', label: 'Distribution Drift', unit: 'ratio', direction: 'higher', threshold: 0.05, description: 'Chi-squared p-value — above 0.05 means regime proportions are stable', icon: 'Repeat' },
        ],
      },
      {
        id: 'cluster_trading',
        label: 'Trading Performance',
        description: 'Can you actually trade on these regimes?',
        metrics: [
          { id: 'best_regime_sharpe', label: 'Best Sharpe', unit: 'ratio', direction: 'higher', threshold: 0.5, description: 'Annualized Sharpe of the best regime — at least one should deliver edge', icon: 'TrendingUp' },
          { id: 'long_bull_short_bear', label: 'Long/Short Return', unit: 'percent', direction: 'higher', threshold: 0, description: 'Go long best regime, short worst — cumulative test return', icon: 'ArrowUpDown' },
          { id: 'vs_buy_and_hold', label: 'vs Buy & Hold', unit: 'percent', direction: 'higher', threshold: 0, description: 'Excess return over just holding the position', icon: 'TrendingUp' },
          { id: 'vs_sma_crossover', label: 'vs SMA (50/200)', unit: 'percent', direction: 'higher', threshold: 0, description: 'Excess return over basic moving average crossover', icon: 'LineChart' },
          { id: 'information_ratio', label: 'Information Ratio', unit: 'ratio', direction: 'higher', threshold: 0, description: 'Risk-adjusted excess return vs buy-and-hold', icon: 'BarChart3' },
        ],
      },
    ],
  },

  // ── CLASSIFICATION (Supervised) ──
  classification: {
    id: 'classification',
    label: 'Classification',
    description: 'Signal prediction, direction calls, regime labeling',
    groups: [
      {
        id: 'class_accuracy',
        label: 'Accuracy & Precision',
        description: 'How often is the model right?',
        metrics: [
          { id: 'accuracy', label: 'Accuracy', unit: 'percent', direction: 'higher', threshold: 0.6, description: 'Overall % of correct predictions', icon: 'CheckCircle' },
          { id: 'precision', label: 'Precision', unit: 'percent', direction: 'higher', threshold: 0.6, description: 'When it says "buy", is it really a buy? Fewer false alarms', icon: 'Target' },
          { id: 'recall', label: 'Recall', unit: 'percent', direction: 'higher', threshold: 0.6, description: 'Of all real buy signals, how many did it catch?', icon: 'Search' },
          { id: 'f1_score', label: 'F1 Score', unit: 'ratio', direction: 'higher', threshold: 0.6, description: 'Balance of precision + recall — overall signal quality', icon: 'Crosshair' },
        ],
      },
      {
        id: 'class_ranking',
        label: 'Ranking Quality',
        description: 'Can the model rank confidence levels correctly?',
        metrics: [
          { id: 'auc_roc', label: 'AUC-ROC', unit: 'ratio', direction: 'higher', threshold: 0.7, description: 'Performance across ALL confidence thresholds — above 0.5 = better than coin flip', icon: 'LineChart' },
          { id: 'log_loss', label: 'Log Loss', unit: 'number', direction: 'lower', description: 'Penalizes confidently wrong predictions — being loudly wrong costs more', icon: 'AlertTriangle' },
          { id: 'cohens_kappa', label: 'Cohen\'s Kappa', unit: 'ratio', direction: 'higher', threshold: 0.4, description: 'Agreement above random chance, accounting for class imbalance', icon: 'Users' },
        ],
      },
      {
        id: 'class_confusion',
        label: 'Error Analysis',
        description: 'Where exactly is the model wrong?',
        metrics: [
          { id: 'true_positives', label: 'True Positives', unit: 'number', direction: 'higher', description: 'Correct "buy" calls', icon: 'CheckCircle' },
          { id: 'false_positives', label: 'False Positives', unit: 'number', direction: 'lower', description: 'Wrong "buy" calls — said buy but should have held', icon: 'XCircle' },
          { id: 'true_negatives', label: 'True Negatives', unit: 'number', direction: 'higher', description: 'Correct "no signal" calls', icon: 'CheckCircle' },
          { id: 'false_negatives', label: 'False Negatives', unit: 'number', direction: 'lower', description: 'Missed signals — there was a buy but model said nothing', icon: 'XCircle' },
        ],
      },
    ],
  },

  // ── REGRESSION ──
  regression: {
    id: 'regression',
    label: 'Regression',
    description: 'Price prediction, return forecasting, volatility estimation',
    groups: [
      {
        id: 'reg_error',
        label: 'Prediction Error',
        description: 'How far off are predictions on average?',
        metrics: [
          { id: 'rmse', label: 'RMSE', unit: 'number', direction: 'lower', description: 'Root mean squared error — big misses hurt more (in price units)', icon: 'AlertTriangle' },
          { id: 'mae', label: 'MAE', unit: 'number', direction: 'lower', description: 'Average absolute error — straightforward miss distance', icon: 'Ruler' },
          { id: 'mape', label: 'MAPE', unit: 'percent', direction: 'lower', threshold: 5, description: 'Average % error — were you off by 1% or 50%?', icon: 'Percent' },
          { id: 'r_squared', label: 'R²', unit: 'ratio', direction: 'higher', threshold: 0.5, description: 'How much of the price movement did the model actually capture?', icon: 'BarChart3' },
        ],
      },
      {
        id: 'reg_residuals',
        label: 'Residual Analysis',
        description: 'Are the errors random (good) or patterned (bad)?',
        metrics: [
          { id: 'residual_autocorrelation', label: 'Residual Autocorr.', unit: 'ratio', direction: 'lower', description: 'Are errors correlated? Low = random misses, high = systematic bias', icon: 'Repeat' },
          { id: 'durbin_watson', label: 'Durbin-Watson', unit: 'ratio', direction: 'info', description: 'Near 2.0 = no autocorrelation in errors — the model captured all learnable patterns', icon: 'Activity' },
          { id: 'residual_normality', label: 'Residual Normality', unit: 'ratio', direction: 'higher', description: 'Are errors bell-curve shaped? If yes, predictions are unbiased', icon: 'Bell' },
        ],
      },
      {
        id: 'reg_comparison',
        label: 'Benchmarking',
        description: 'Better than simple forecasts?',
        metrics: [
          { id: 'mase', label: 'MASE', unit: 'ratio', direction: 'lower', threshold: 1, description: 'Error relative to naive forecast — below 1.0 means it beats "same as yesterday"', icon: 'Scale' },
          { id: 'directional_accuracy', label: 'Direction Accuracy', unit: 'percent', direction: 'higher', threshold: 0.55, description: 'Even if magnitude is off, did it get the direction right?', icon: 'ArrowUpDown' },
        ],
      },
    ],
  },

  // ── ENSEMBLE / BOOSTING ──
  'ensemble-boosting': {
    id: 'ensemble-boosting',
    label: 'Ensemble & Boosting',
    description: 'Random Forest, XGBoost, LightGBM, CatBoost, Stacking',
    groups: [
      {
        id: 'ens_performance',
        label: 'Ensemble Performance',
        description: 'How well does the panel of experts perform?',
        metrics: [
          { id: 'ensemble_accuracy', label: 'Accuracy', unit: 'percent', direction: 'higher', description: 'Overall correctness of the combined ensemble', icon: 'CheckCircle' },
          { id: 'oob_error', label: 'OOB Error', unit: 'percent', direction: 'lower', description: 'Out-of-bag error — free validation from unused bootstrap samples (RF only)', icon: 'Box' },
          { id: 'n_estimators', label: 'Trees / Estimators', unit: 'number', direction: 'info', description: 'How many learners voted on each prediction', icon: 'Trees' },
        ],
      },
      {
        id: 'ens_features',
        label: 'Feature Importance',
        description: 'Which trading indicators drive decisions?',
        metrics: [
          { id: 'top_feature_importance', label: 'Top Feature %', unit: 'percent', direction: 'info', description: 'How much the single most important feature contributes', icon: 'Star' },
          { id: 'feature_concentration', label: 'Feature Concentration', unit: 'ratio', direction: 'lower', threshold: 0.5, description: 'Are decisions spread across features (good) or dominated by one (risky)?', icon: 'PieChart' },
          { id: 'n_important_features', label: 'Important Features', unit: 'number', direction: 'info', description: 'How many features contribute meaningfully to predictions', icon: 'List' },
        ],
      },
      {
        id: 'ens_complexity',
        label: 'Complexity Control',
        description: 'Is the ensemble too complex for the data?',
        metrics: [
          { id: 'avg_tree_depth', label: 'Avg Tree Depth', unit: 'number', direction: 'lower', description: 'Deeper trees = more memorization risk', icon: 'GitBranch' },
          { id: 'train_test_gap', label: 'Train-Test Gap', unit: 'percent', direction: 'lower', threshold: 10, description: 'Train accuracy minus test accuracy — big gap = overfitting', icon: 'GitBranch' },
          { id: 'ensemble_diversity', label: 'Diversity', unit: 'ratio', direction: 'higher', description: 'How different are the individual trees? Low diversity = redundant learners', icon: 'Shuffle' },
        ],
      },
    ],
  },

  // ── DIMENSIONALITY REDUCTION ──
  'dimensionality-reduction': {
    id: 'dimensionality-reduction',
    label: 'Dimensionality Reduction',
    description: 'PCA, t-SNE, UMAP, ICA — compressing features',
    groups: [
      {
        id: 'dr_quality',
        label: 'Compression Quality',
        description: 'How much detail survives the compression?',
        metrics: [
          { id: 'explained_variance', label: 'Explained Variance', unit: 'percent', direction: 'higher', threshold: 0.8, description: 'What % of the original information is preserved?', icon: 'PieChart' },
          { id: 'reconstruction_error', label: 'Reconstruction Error', unit: 'number', direction: 'lower', description: 'Difference between original and compressed-then-restored data', icon: 'RefreshCw' },
          { id: 'n_components', label: 'Components', unit: 'number', direction: 'info', description: 'How many compressed dimensions', icon: 'Layers' },
        ],
      },
      {
        id: 'dr_structure',
        label: 'Structure Preservation',
        description: 'Did neighborhood relationships survive?',
        metrics: [
          { id: 'trustworthiness', label: 'Trustworthiness', unit: 'ratio', direction: 'higher', threshold: 0.9, description: 'Do nearby points in the compressed view actually sit together in reality?', icon: 'Eye' },
          { id: 'continuity', label: 'Continuity', unit: 'ratio', direction: 'higher', threshold: 0.9, description: 'Do actual neighbors in high-D stay neighbors in low-D?', icon: 'Link' },
          { id: 'downstream_accuracy', label: 'Downstream Accuracy', unit: 'percent', direction: 'higher', description: 'Can a classifier still work well on the compressed features?', icon: 'Target' },
        ],
      },
    ],
  },

  // ── ANOMALY DETECTION ──
  'anomaly-detection': {
    id: 'anomaly-detection',
    label: 'Anomaly Detection',
    description: 'Isolation Forest, LOF, One-Class SVM',
    groups: [
      {
        id: 'anom_detection',
        label: 'Detection Quality',
        description: 'Does it catch real anomalies without false alarms?',
        metrics: [
          { id: 'precision_at_k', label: 'Precision@k', unit: 'percent', direction: 'higher', threshold: 0.5, description: 'Of the top-k flagged bars, how many were real anomalies?', icon: 'Target' },
          { id: 'recall_at_k', label: 'Recall@k', unit: 'percent', direction: 'higher', threshold: 0.5, description: 'Of all real anomalies, how many were in the top-k?', icon: 'Search' },
          { id: 'auc_roc', label: 'AUC-ROC', unit: 'ratio', direction: 'higher', threshold: 0.7, description: 'Does it at least rank suspicious bars higher than normal ones?', icon: 'LineChart' },
          { id: 'f1_optimal', label: 'F1 (Optimal)', unit: 'ratio', direction: 'higher', threshold: 0.5, description: 'Best balance point for the alert sensitivity', icon: 'Crosshair' },
        ],
      },
      {
        id: 'anom_calibration',
        label: 'Score Calibration',
        description: 'Are anomaly scores meaningful numbers?',
        metrics: [
          { id: 'contamination_rate', label: 'Contamination %', unit: 'percent', direction: 'info', description: 'Expected anomaly rate in the data — sets the baseline', icon: 'Droplet' },
          { id: 'score_separation', label: 'Score Separation', unit: 'ratio', direction: 'higher', description: 'Gap between normal and anomaly score distributions — bigger = cleaner threshold', icon: 'ArrowUpDown' },
          { id: 'false_positive_rate', label: 'False Positive Rate', unit: 'percent', direction: 'lower', threshold: 5, description: 'How often does it cry wolf on normal bars?', icon: 'AlertTriangle' },
        ],
      },
    ],
  },

  // ── SEQUENCE & TIME-SERIES ──
  sequence: {
    id: 'sequence',
    label: 'Sequence',
    description: 'LSTM, Transformer, ARIMA — time-aware models',
    groups: [
      {
        id: 'seq_forecast',
        label: 'Forecast Quality',
        description: 'How accurate are the time-series predictions?',
        metrics: [
          { id: 'rmse', label: 'RMSE', unit: 'number', direction: 'lower', description: 'Forecast error in price units', icon: 'AlertTriangle' },
          { id: 'mase', label: 'MASE', unit: 'ratio', direction: 'lower', threshold: 1, description: 'Below 1.0 = beats naive "same as last bar" forecast', icon: 'Scale' },
          { id: 'directional_accuracy', label: 'Direction Accuracy', unit: 'percent', direction: 'higher', threshold: 0.55, description: 'Did it get up/down right, even if magnitude was off?', icon: 'ArrowUpDown' },
          { id: 'multi_horizon_decay', label: 'Horizon Decay', unit: 'percent', direction: 'lower', description: 'How fast does accuracy drop as you predict further ahead?', icon: 'TrendingDown' },
        ],
      },
      {
        id: 'seq_temporal',
        label: 'Temporal Structure',
        description: 'Does it understand the time dimension properly?',
        metrics: [
          { id: 'ljung_box_p', label: 'Ljung-Box p', unit: 'ratio', direction: 'higher', threshold: 0.05, description: 'Are residuals truly random after modeling? Above 0.05 = yes, no patterns left', icon: 'Activity' },
          { id: 'attention_entropy', label: 'Attention Entropy', unit: 'ratio', direction: 'info', description: 'How spread is the model\'s attention? Low = focused on key bars, high = looking everywhere', icon: 'Focus' },
        ],
      },
    ],
  },

  // ── REINFORCEMENT LEARNING ──
  'reinforcement-learning': {
    id: 'reinforcement-learning',
    label: 'Reinforcement Learning',
    description: 'PPO, DQN, A2C — learning to trade by doing',
    groups: [
      {
        id: 'rl_returns',
        label: 'Trading Returns',
        description: 'Did the agent make money?',
        metrics: [
          { id: 'cumulative_reward', label: 'Cumulative Reward', unit: 'currency', direction: 'higher', description: 'Total reward over the evaluation period', icon: 'DollarSign' },
          { id: 'avg_episode_return', label: 'Avg Episode Return', unit: 'currency', direction: 'higher', description: 'Average profit per trading session', icon: 'BarChart3' },
          { id: 'sharpe_ratio', label: 'Sharpe Ratio', unit: 'ratio', direction: 'higher', threshold: 1.0, description: 'Risk-adjusted returns — did it win by taking huge risks, or win steadily?', icon: 'TrendingUp' },
          { id: 'max_drawdown', label: 'Max Drawdown', unit: 'percent', direction: 'lower', threshold: 20, description: 'Worst peak-to-trough drop — how painful was the worst losing streak?', icon: 'TrendingDown' },
        ],
      },
      {
        id: 'rl_learning',
        label: 'Learning Efficiency',
        description: 'How fast and stable is the learning?',
        metrics: [
          { id: 'sample_efficiency', label: 'Sample Efficiency', unit: 'number', direction: 'lower', description: 'How many episodes needed to converge — fewer is better', icon: 'Zap' },
          { id: 'policy_stability', label: 'Policy Stability', unit: 'ratio', direction: 'higher', description: 'Does the strategy stay consistent between updates?', icon: 'Shield' },
          { id: 'exploration_ratio', label: 'Exploration Ratio', unit: 'percent', direction: 'info', description: 'How much is the agent still experimenting vs exploiting known good?', icon: 'Compass' },
        ],
      },
    ],
  },

  // ── PROBABILISTIC / BAYESIAN ──
  probabilistic: {
    id: 'probabilistic',
    label: 'Probabilistic',
    description: 'Bayesian Networks, probabilistic graphical models — hidden state inference',
    groups: [
      {
        id: 'prob_fit',
        label: 'Model Fit',
        description: 'Does the model explain the observed data?',
        metrics: [
          { id: 'log_likelihood', label: 'Log-Likelihood', unit: 'number', direction: 'higher', description: 'How well the model explains ALL the evidence', icon: 'Flame' },
          { id: 'll_per_bar', label: 'LL per Bar', unit: 'number', direction: 'higher', threshold: -6, description: 'Average fit per individual bar — above -4 is excellent', icon: 'BarChart3' },
          { id: 'bic', label: 'BIC', unit: 'number', direction: 'lower', description: 'Bayesian Information Criterion — simpler model that still explains well', icon: 'Scale' },
          { id: 'aic', label: 'AIC', unit: 'number', direction: 'lower', description: 'Akaike criterion — balances fit vs complexity', icon: 'Scale' },
        ],
      },
      {
        id: 'prob_states',
        label: 'Hidden State Quality',
        description: 'Are the inferred states meaningful and stable?',
        metrics: [
          { id: 'transition_stability', label: 'Transition Stability', unit: 'ratio', direction: 'higher', description: 'Do state transitions stay consistent across different time periods?', icon: 'Repeat' },
          { id: 'state_entropy', label: 'State Entropy', unit: 'ratio', direction: 'info', description: 'How evenly distributed are the states? Low = dominated by one, high = balanced', icon: 'Activity' },
          { id: 'avg_dwell', label: 'Avg Dwell Time', unit: 'number', direction: 'higher', threshold: 5, description: 'How long states persist on average — flickers = noise, long runs = real patterns', icon: 'Timer' },
          { id: 'self_transition', label: 'Self-Transition %', unit: 'percent', direction: 'higher', threshold: 0.7, description: 'How sticky are states? High = regimes persist, low = chaotic switching', icon: 'Lock' },
        ],
      },
    ],
  },

  // ── GENERATIVE ──
  generative: {
    id: 'generative',
    label: 'Generative',
    description: 'GANs, VAEs, Diffusion — generating synthetic data',
    groups: [
      {
        id: 'gen_quality',
        label: 'Generation Quality',
        description: 'How realistic are the generated samples?',
        metrics: [
          { id: 'fid', label: 'FID', unit: 'number', direction: 'lower', description: 'Fréchet Inception Distance — statistical distance between real and fake distributions', icon: 'Eye' },
          { id: 'inception_score', label: 'Inception Score', unit: 'number', direction: 'higher', description: 'Quality + diversity of generated samples — both realistic AND varied', icon: 'Star' },
          { id: 'reconstruction_error', label: 'Reconstruction Error', unit: 'number', direction: 'lower', description: 'How well it reproduces inputs through encode-decode cycle (VAE)', icon: 'RefreshCw' },
          { id: 'kl_divergence', label: 'KL Divergence', unit: 'number', direction: 'lower', description: 'How organized is the latent space? Lower = smoother, more structured', icon: 'Layers' },
        ],
      },
      {
        id: 'gen_coverage',
        label: 'Mode Coverage',
        description: 'Does it generate ALL types, not just common ones?',
        metrics: [
          { id: 'mode_coverage', label: 'Mode Coverage', unit: 'percent', direction: 'higher', threshold: 0.8, description: 'Does it generate all market conditions, or only the most common?', icon: 'Grid' },
          { id: 'diversity_score', label: 'Diversity', unit: 'ratio', direction: 'higher', description: 'How varied are generated samples — not just copies of the same pattern', icon: 'Shuffle' },
        ],
      },
    ],
  },

  // ── STATISTICAL / FORECASTING ──
  statistical: {
    id: 'statistical',
    label: 'Statistical',
    description: 'ARIMA, GLMs, Bayesian Regression, Survival Analysis',
    groups: [
      {
        id: 'stat_fit',
        label: 'Model Fit',
        description: 'Simplest model that still explains the data?',
        metrics: [
          { id: 'aic', label: 'AIC', unit: 'number', direction: 'lower', description: 'Akaike Information Criterion — complexity-penalized fit', icon: 'Scale' },
          { id: 'bic', label: 'BIC', unit: 'number', direction: 'lower', description: 'Bayesian Information Criterion — heavier complexity penalty', icon: 'Scale' },
          { id: 'r_squared', label: 'R²', unit: 'ratio', direction: 'higher', threshold: 0.3, description: 'Proportion of variance explained', icon: 'BarChart3' },
          { id: 'ljung_box_p', label: 'Ljung-Box p', unit: 'ratio', direction: 'higher', threshold: 0.05, description: 'Are residuals truly random? Above 0.05 = yes', icon: 'Activity' },
        ],
      },
      {
        id: 'stat_forecast',
        label: 'Forecast Accuracy',
        description: 'Better than just predicting same as yesterday?',
        metrics: [
          { id: 'mase', label: 'MASE', unit: 'ratio', direction: 'lower', threshold: 1, description: 'Below 1.0 = beats naive forecast', icon: 'Scale' },
          { id: 'durbin_watson', label: 'Durbin-Watson', unit: 'ratio', direction: 'info', description: 'Near 2.0 = no serial correlation in errors', icon: 'Activity' },
          { id: 'calibration', label: 'Calibration', unit: 'ratio', direction: 'higher', description: 'When it says 30% chance of up, does it go up 30% of the time?', icon: 'Gauge' },
        ],
      },
    ],
  },
};

// ── Helper to get metrics for a model category ───────────────────────────────

/** Map ModelCategory → categoryMetrics key */
export const CATEGORY_TO_METRICS_KEY: Record<string, string> = {
  'unsupervised': 'clustering',
  'supervised': 'classification',  // Default; overridden by subcategory
  'self-supervised': 'clustering',
  'semi-supervised': 'classification',
  'generative': 'generative',
  'hybrid-composite': 'ensemble-boosting',
  'neural-network': 'sequence',
  'optimization': 'reinforcement-learning',
  'probabilistic-symbolic': 'probabilistic',
  'reinforcement-learning': 'reinforcement-learning',
  'simulation-decision': 'reinforcement-learning',
  'statistical': 'statistical',
};

/** Map subcategory → more specific metrics key (overrides category) */
export const SUBCATEGORY_TO_METRICS_KEY: Record<string, string> = {
  'clustering': 'clustering',
  'self-organizing': 'clustering',
  'probabilistic-mixture': 'clustering',
  'dimensionality-reduction': 'dimensionality-reduction',
  'anomaly-detection': 'anomaly-detection',
  'classification': 'classification',
  'meta-learner': 'classification',
  'regression': 'regression',
  'linear': 'regression',
  'regression-techniques': 'regression',
  'sequence': 'sequence',
  'time-series': 'sequence',
  'recurrent-and-sequential': 'sequence',
  'attention-based': 'sequence',
  'ensemble': 'ensemble-boosting',
  'boosting': 'ensemble-boosting',
  'deep-learning': 'sequence',
  'convolutional-networks': 'sequence',
  'generative-processes': 'probabilistic',
  'graphical-and-structured': 'probabilistic',
  'probabilistic-inference': 'probabilistic',
  'actor-critic': 'reinforcement-learning',
  'policy-gradient': 'reinforcement-learning',
  'value-based': 'reinforcement-learning',
  'model-based-rl': 'reinforcement-learning',
  'model-free-rl': 'reinforcement-learning',
  'bayesian-models': 'statistical',
  'forecasting': 'statistical',
  'survival-analysis': 'statistical',
};

/** Resolve the correct metrics config for a model category + subcategory */
export function resolveMetricsConfig(
  category: string,
  subcategory?: string,
): CategoryMetricsConfig | undefined {
  // Subcategory takes priority for specificity
  if (subcategory && SUBCATEGORY_TO_METRICS_KEY[subcategory]) {
    return CATEGORY_METRICS[SUBCATEGORY_TO_METRICS_KEY[subcategory]!];
  }
  if (CATEGORY_TO_METRICS_KEY[category]) {
    return CATEGORY_METRICS[CATEGORY_TO_METRICS_KEY[category]!];
  }
  return undefined;
}

/** Get all unique category tab entries for the Training Center */
export function getCategoryTabs(): Array<{ id: string; label: string; description: string }> {
  return Object.values(CATEGORY_METRICS).map(({ id, label, description }) => ({
    id,
    label,
    description,
  }));
}
