/**
 * Catalog → Python Class Map.
 *
 * Hand-curated fallback when `extractClassImport()` (parser.ts) cannot harvest
 * a `from X import Y` pair from the spec's fenced ``` python ``` blocks.
 *
 * Keys are catalog spec slugs (matches `ParsedModelSpec.id`).  Values point at
 * the canonical scikit-learn / xgboost / lightgbm / catboost / hmmlearn /
 * statsmodels class for that spec.
 *
 * Used by:
 *   - `parseModelSpec()` to populate `module_path` + `class_name` on every
 *     spec where the fenced-block heuristic missed
 *   - Jinja2 templates (`sklearn.py.j2`, `tree.py.j2`, `gmm.py.j2`, `hmm.py.j2`)
 *     consume `{{ catalog_spec.module_path }}` and `{{ catalog_spec.class_name }}`
 *
 * To add a new entry: open the spec's MD, identify the canonical Python class
 * the user would actually import, add a row.  Prefer the *Classifier* variant
 * over the *Regressor* variant — generated code uses the (algorithm, task)
 * runner key to pick a target-aware label downstream; the class name only
 * needs to compile.
 */

export interface ClassMapEntry {
  module_path: string;
  class_name: string;
}

export const CATALOG_CLASS_MAP: Record<string, ClassMapEntry> = {
  // ── Linear models ──────────────────────────────────────────────────────────
  'linear-regression':              { module_path: 'sklearn.linear_model',  class_name: 'LinearRegression' },
  'logistic-regression':            { module_path: 'sklearn.linear_model',  class_name: 'LogisticRegression' },
  'lasso-regression':               { module_path: 'sklearn.linear_model',  class_name: 'Lasso' },
  'ridge-regression':               { module_path: 'sklearn.linear_model',  class_name: 'Ridge' },
  'elasticnet-regression':          { module_path: 'sklearn.linear_model',  class_name: 'ElasticNet' },
  'elastic-net-regression':         { module_path: 'sklearn.linear_model',  class_name: 'ElasticNet' },
  'bayesian-ridge-regression':      { module_path: 'sklearn.linear_model',  class_name: 'BayesianRidge' },
  'lars-least-angle-regression':    { module_path: 'sklearn.linear_model',  class_name: 'Lars' },
  'ordinal-regression':             { module_path: 'sklearn.linear_model',  class_name: 'LogisticRegression' },
  'probit-regression':              { module_path: 'statsmodels.discrete.discrete_model', class_name: 'Probit' },
  'quantile-regression':            { module_path: 'sklearn.linear_model',  class_name: 'QuantileRegressor' },
  'stochastic-gradient-descent-sgd':{ module_path: 'sklearn.linear_model',  class_name: 'SGDClassifier' },

  // ── Margin / SVM / Probabilistic / NN ──────────────────────────────────────
  'support-vector-machine-svm':     { module_path: 'sklearn.svm',           class_name: 'SVC' },
  'k-nearest-neighbors-k-nn':       { module_path: 'sklearn.neighbors',     class_name: 'KNeighborsClassifier' },
  'naive-bayes':                    { module_path: 'sklearn.naive_bayes',   class_name: 'GaussianNB' },

  // ── Tree-based ─────────────────────────────────────────────────────────────
  'decision-tree-classifier':       { module_path: 'sklearn.tree',          class_name: 'DecisionTreeClassifier' },
  'classification-and-regression-trees-cart': { module_path: 'sklearn.tree', class_name: 'DecisionTreeClassifier' },
  'extra-trees-regressor':          { module_path: 'sklearn.ensemble',      class_name: 'ExtraTreesRegressor' },
  'extra-trees':                    { module_path: 'sklearn.ensemble',      class_name: 'ExtraTreesClassifier' },

  // ── Ensembles ──────────────────────────────────────────────────────────────
  'random-forest':                  { module_path: 'sklearn.ensemble',      class_name: 'RandomForestClassifier' },
  'stacked-generalization-model':   { module_path: 'sklearn.ensemble',      class_name: 'StackingClassifier' },
  'voting-classifier':              { module_path: 'sklearn.ensemble',      class_name: 'VotingClassifier' },
  'bagging':                        { module_path: 'sklearn.ensemble',      class_name: 'BaggingClassifier' },

  // ── Boosting (sklearn-compatible APIs) ─────────────────────────────────────
  'gradient-boosting-machine-gbm':  { module_path: 'sklearn.ensemble',      class_name: 'GradientBoostingClassifier' },
  'adaboost':                       { module_path: 'sklearn.ensemble',      class_name: 'AdaBoostClassifier' },
  'xgboost':                        { module_path: 'xgboost',               class_name: 'XGBClassifier' },
  'lightgbm':                       { module_path: 'lightgbm',              class_name: 'LGBMClassifier' },
  'catboost':                       { module_path: 'catboost',              class_name: 'CatBoostClassifier' },

  // ── Calibration & Meta ─────────────────────────────────────────────────────
  'calibrated-classifier':          { module_path: 'sklearn.calibration',   class_name: 'CalibratedClassifierCV' },

  // ── Clustering ─────────────────────────────────────────────────────────────
  'k-means-clustering':             { module_path: 'sklearn.cluster',       class_name: 'KMeans' },
  'dbscan-density-based-spatial-clustering': { module_path: 'sklearn.cluster', class_name: 'DBSCAN' },
  'spectral-clustering':            { module_path: 'sklearn.cluster',       class_name: 'SpectralClustering' },
  'mean-shift-clustering':          { module_path: 'sklearn.cluster',       class_name: 'MeanShift' },
  'affinity-propagation':           { module_path: 'sklearn.cluster',       class_name: 'AffinityPropagation' },
  'hierarchical-clustering-agglomerative-divisive': { module_path: 'sklearn.cluster', class_name: 'AgglomerativeClustering' },
  'gaussian-mixture-model-gmm':     { module_path: 'sklearn.mixture',       class_name: 'GaussianMixture' },

  // ── Dimensionality Reduction ───────────────────────────────────────────────
  'principal-component-analysis-pca':       { module_path: 'sklearn.decomposition', class_name: 'PCA' },
  'independent-component-analysis-ica':     { module_path: 'sklearn.decomposition', class_name: 'FastICA' },
  'non-negative-matrix-factorization-nmf':  { module_path: 'sklearn.decomposition', class_name: 'NMF' },
  't-sne-t-distributed-stochastic-neighbor-embedding': { module_path: 'sklearn.manifold', class_name: 'TSNE' },
  'umap-uniform-manifold-approximation-and-projection': { module_path: 'umap',  class_name: 'UMAP' },
  'manifold-learning-isomap-lle':           { module_path: 'sklearn.manifold',      class_name: 'Isomap' },

  // ── Anomaly Detection ──────────────────────────────────────────────────────
  'isolation-forest-anomaly-detection':     { module_path: 'sklearn.ensemble',      class_name: 'IsolationForest' },
  'one-class-svm':                          { module_path: 'sklearn.svm',           class_name: 'OneClassSVM' },
  'lof-local-outlier-factor':               { module_path: 'sklearn.neighbors',     class_name: 'LocalOutlierFactor' },
  'robust-covariance-estimation':           { module_path: 'sklearn.covariance',    class_name: 'EllipticEnvelope' },

  // ── Hidden Markov Models ───────────────────────────────────────────────────
  'gaussian-hmm':                           { module_path: 'hmmlearn.hmm',          class_name: 'GaussianHMM' },
  'gmm-hmm':                                { module_path: 'hmmlearn.hmm',          class_name: 'GMMHMM' },
  'hidden-markov-model-hmm':                { module_path: 'hmmlearn.hmm',          class_name: 'GaussianHMM' },
  'hidden-markov-model':                    { module_path: 'hmmlearn.hmm',          class_name: 'GaussianHMM' },
  'multinomial-hmm':                        { module_path: 'hmmlearn.hmm',          class_name: 'MultinomialHMM' },
  'categorical-hmm':                        { module_path: 'hmmlearn.hmm',          class_name: 'CategoricalHMM' },

  // ── Generalized Linear Models ──────────────────────────────────────────────
  'multinomial-logistic-regression':        { module_path: 'sklearn.linear_model',  class_name: 'LogisticRegression' },
  'generalized-linear-model-glm':           { module_path: 'sklearn.linear_model',  class_name: 'TweedieRegressor' },
  'poisson-regression':                     { module_path: 'sklearn.linear_model',  class_name: 'PoissonRegressor' },
  'gamma-regression':                       { module_path: 'sklearn.linear_model',  class_name: 'GammaRegressor' },
  'tweedie-regression':                     { module_path: 'sklearn.linear_model',  class_name: 'TweedieRegressor' },

  // ── Decision-Theory / Tree-Based Decision Models ───────────────────────────
  // These are decision frameworks whose nearest scikit-learn analogue is a
  // DecisionTreeClassifier (lets the generated runner compile + train).
  'decision-trees':                         { module_path: 'sklearn.tree',          class_name: 'DecisionTreeClassifier' },
  'monte-carlo-tree-search-mcts':           { module_path: 'sklearn.tree',          class_name: 'DecisionTreeClassifier' },
  'bayesian-decision-networks':             { module_path: 'sklearn.tree',          class_name: 'DecisionTreeClassifier' },
  'dynamic-decision-networks':              { module_path: 'sklearn.tree',          class_name: 'DecisionTreeClassifier' },
  'influence-diagrams':                     { module_path: 'sklearn.tree',          class_name: 'DecisionTreeClassifier' },

  // ── Hybrid / Composite / Semi-Supervised stand-ins ─────────────────────────
  'stacked-ensemble-model':                 { module_path: 'sklearn.ensemble',      class_name: 'StackingClassifier' },
  'skill-chaining':                         { module_path: 'sklearn.linear_model',  class_name: 'LogisticRegression' },
  'semi-supervised-svm-s3vm':               { module_path: 'sklearn.svm',           class_name: 'SVC' },
};

/**
 * Look up a `(module_path, class_name)` pair for a catalog spec by ID.
 * Returns `null` when the spec is not in the curated map.
 */
export function lookupCatalogClass(specId: string): ClassMapEntry | null {
  return CATALOG_CLASS_MAP[specId] ?? null;
}

/** Count of curated entries — useful for diagnostics + CI assertions. */
export function classMapSize(): number {
  return Object.keys(CATALOG_CLASS_MAP).length;
}
