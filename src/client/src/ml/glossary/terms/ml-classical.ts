/**
 * Classical ML — the non-neural half, and the practical knobs that decide results.
 *
 * SRP: Data only. Merged by `../index.ts`.
 *
 * `ml-architectures.ts` names the model families. This file covers the ones it
 * skipped, the preprocessing that happens before any of them, the tree
 * hyperparameters people actually tune, and the interpretation tools.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  // ── Models not yet named ───────────────────────────────────────────────
  {
    id: "naive-bayes",
    term: "naive Bayes",
    domain: "ml-architectures",
    definition:
      "Applies Bayes' theorem assuming every feature is independent given the class. **The assumption is nearly always false and it works anyway**, because it only needs the ranking of posteriors to be right.",
    why: "Fast, needs little data, badly calibrated — the probabilities it outputs are pushed to the extremes.",
    see: ["f-bayes", "calibration", "logistic-regression"],
  },
  {
    id: "knn",
    term: "k-nearest neighbours",
    expansion: "kNN",
    domain: "ml-architectures",
    definition:
      "Predict from the k most similar training examples. **No training step at all** — the cost is entirely at inference.",
    why: "Degrades badly in high dimensions, where distances stop discriminating, and needs features on a common scale.",
    see: ["curse-of-dimensionality", "feature-scaling", "embedding-similarity"],
  },
  {
    id: "extra-trees",
    term: "extremely randomised trees",
    aliases: ["extra trees"],
    domain: "ml-architectures",
    definition:
      "Like a random forest, but split thresholds are drawn at random rather than optimised. **More bias, much less variance**, and faster to fit.",
    see: ["random-forest", "bias-variance", "ensemble"],
  },
  {
    id: "isolation-forest",
    term: "isolation forest",
    domain: "ml-architectures",
    definition:
      "Anomaly detection by random splitting: outliers are isolated in fewer splits because there is less around them. **Scores rarity, not distance.**",
    see: ["anomaly-detection", "random-forest"],
  },
  {
    id: "anomaly-detection",
    term: "anomaly detection",
    aliases: ["novelty detection", "one-class"],
    domain: "ml-core",
    definition:
      "Finding observations unlike the rest, without labelled examples of what *unlike* means.",
    why: "In markets, most anomalies are data errors and the rest are the events that matter. The method cannot tell you which.",
    see: ["isolation-forest", "outlier", "data-quality"],
  },
  {
    id: "decision-boundary",
    term: "decision boundary",
    domain: "ml-core",
    definition:
      "The surface in feature space where a classifier switches its prediction. **Linear models draw a hyperplane; trees draw axis-aligned steps; kernels draw curves.**",
    see: ["logistic-regression", "decision-tree", "svm", "inductive-bias"],
  },
  {
    id: "linear-separability",
    term: "linear separability",
    domain: "ml-core",
    definition:
      "Whether a straight line (or hyperplane) can separate the classes. When it cannot, you need either a non-linear model or a feature that makes it linear.",
    see: ["decision-boundary", "kernel-method", "interaction-feature"],
  },

  // ── Preprocessing ──────────────────────────────────────────────────────
  {
    id: "feature-scaling",
    term: "feature scaling",
    aliases: ["standardisation", "min-max", "robust scaler"],
    domain: "features",
    definition:
      "Putting features on a comparable scale. **Standardise** to zero mean and unit variance, **min-max** to a fixed range, **robust** using median and IQR when outliers are present.",
    why: "Trees do not care; anything distance- or gradient-based cares a lot. **Fit the scaler on the training fold only** — fitting on everything is leakage.",
    see: ["z-score", "leakage", "knn"],
  },
  {
    id: "imputation",
    term: "imputation",
    domain: "features",
    definition:
      "Filling in missing values — with a mean, a median, a forward-fill, or a model.",
    why: "Forward-filling a price is usually right; forward-filling a *volume* invents trades that did not happen. And an added `was_missing` flag often carries more signal than the imputed value.",
    see: ["missing-data", "leakage"],
  },
  {
    id: "missing-data",
    term: "missingness",
    aliases: ["MCAR", "MAR", "MNAR", "nulls"],
    domain: "features",
    definition:
      "**MCAR** missing at random with no pattern; **MAR** explainable by other observed variables; **MNAR** the missingness itself depends on the unseen value.",
    why: "MNAR is the dangerous one and it is common: a quote is missing precisely because the market was disorderly.",
    see: ["imputation", "data-quality", "gap"],
  },
  {
    id: "target-encoding",
    term: "target encoding",
    domain: "features",
    definition:
      "Replacing a category with a statistic of the target computed within it — the mean outcome for that venue, say.",
    why: "**Leaks unless computed out-of-fold**, because the feature is built from the label. The single most common silent leak in tabular work.",
    see: ["categorical-feature", "leakage", "cross-validation"],
  },
  {
    id: "binning",
    term: "binning / discretisation",
    domain: "features",
    definition:
      "Converting a continuous feature into buckets — equal width, equal frequency, or by a fitted rule.",
    why: "Throws away magnitude and can find pockets a linear fit misses. Bin edges are fitted parameters and must come from training data only.",
    see: ["codebook", "feature-engineering", "quantisation-error"],
  },
  {
    id: "stratification",
    term: "stratified sampling",
    domain: "ml-training",
    definition:
      "Splitting so each fold preserves the class balance of the whole.",
    why: "Standard for i.i.d. data and **wrong for time series**, where the split has to respect time and stratifying would shuffle the future into the past.",
    see: ["walk-forward", "class-imbalance", "cross-validation"],
  },
  {
    id: "nested-cv",
    term: "nested cross-validation",
    domain: "ml-training",
    definition:
      "An inner loop tunes hyperparameters, an outer loop estimates performance. **The only way to get an unbiased score when you also tuned.**",
    why: "Tuning on the same folds you report is how a mediocre model produces an impressive number.",
    see: ["cross-validation", "hpo", "leakage"],
  },

  // ── Tree hyperparameters ───────────────────────────────────────────────
  {
    id: "tree-depth",
    term: "max depth / num leaves",
    domain: "ml-training",
    definition:
      "How complex each tree may become. **The primary overfitting control** in a boosted ensemble — depth 3–6 is typical for noisy financial data.",
    see: ["boosting", "overfitting", "min-child-weight"],
  },
  {
    id: "min-child-weight",
    term: "min child weight / min samples leaf",
    domain: "ml-training",
    definition:
      "The minimum weight of observations a leaf must hold. **Stops the tree carving out leaves that describe three lucky rows.**",
    see: ["tree-depth", "overfitting", "boosting"],
  },
  {
    id: "boosting-shrinkage",
    term: "shrinkage (boosting learning rate)",
    domain: "ml-training",
    definition:
      "Scaling each tree's contribution down so the ensemble learns slowly. **Lower shrinkage with more trees almost always generalises better** — and costs proportionally more time. Unrelated to covariance shrinkage, which pulls a noisy estimate toward a stable target.",
    see: ["boosting", "learning-rate", "early-stopping"],
  },
  {
    id: "subsample",
    term: "subsample / colsample",
    domain: "ml-training",
    definition:
      "Fitting each tree on a random fraction of rows (**subsample**) or columns (**colsample**). Decorrelates the ensemble and acts as regularisation.",
    see: ["random-forest", "regularization", "boosting"],
  },
  {
    id: "monotonic-constraint",
    term: "monotonic constraint",
    domain: "ml-training",
    definition:
      "Forcing a model's output to move only one way with a given feature.",
    why: "How you encode domain knowledge a tree would otherwise violate — more recent volatility should not *lower* forecast volatility, whatever a noisy split suggests.",
    see: ["boosting", "inductive-bias", "regularization"],
  },
  {
    id: "oob-error",
    term: "out-of-bag error",
    expansion: "OOB",
    domain: "ml-evaluation",
    definition:
      "In bagging, scoring each tree on the rows its bootstrap sample happened to exclude — cross-validation for free.",
    why: "Valid only when rows are independent, so it is not trustworthy on overlapping time-series labels.",
    see: ["random-forest", "ensemble", "overlapping-samples"],
  },

  // ── Interpretation ─────────────────────────────────────────────────────
  {
    id: "partial-dependence",
    term: "partial dependence & ICE",
    domain: "features",
    definition:
      "**PDP** shows the average predicted outcome as one feature varies; **ICE** draws one line per observation instead of averaging.",
    why: "The average hides heterogeneity, and it assumes the varied feature is independent of the rest — which correlated financial features are not.",
    see: ["shap", "feature-importance", "multicollinearity"],
  },
  {
    id: "surrogate-model",
    term: "surrogate model",
    domain: "features",
    definition:
      "Fitting a simple, readable model to a complex one's predictions, to approximate what it is doing.",
    why: "Explains the surrogate, not the original. Useful as a sketch, misleading if quoted as the truth.",
    see: ["explainability", "shap"],
  },
  {
    id: "counterfactual",
    term: "counterfactual explanation",
    domain: "features",
    definition:
      "The smallest change to the inputs that would have flipped the prediction. **Actionable where an importance score is not.**",
    see: ["explainability", "shap"],
  },
  {
    id: "lift-chart",
    term: "lift & gain chart",
    domain: "ml-evaluation",
    definition:
      "Sort predictions by confidence and plot how much of the positive outcome the top decile captures. **Lift** is that relative to random.",
    why: "The right chart when you will only act on the top slice — which is every conviction-gated strategy.",
    see: ["precision-recall", "auc", "conviction"],
  },
  {
    id: "conviction",
    term: "conviction / signal strength",
    domain: "ml-evaluation",
    definition:
      "How far a prediction sits from indifference, used to size or to gate. Often `|2·p − 1|` for a binary probability.",
    why: "Only meaningful if the model is calibrated. Gating on an uncalibrated score gates on the model's overconfidence.",
    see: ["calibration", "position-sizing", "lift-chart", "meta-labelling"],
  },
  {
    id: "threshold-selection",
    term: "decision threshold",
    domain: "ml-evaluation",
    definition:
      "The probability above which you act. **0.5 is a default, not a decision** — the right threshold comes from the cost of a false positive against a false negative.",
    why: "Choosing it on the test set is leakage. Choose it on validation, report it, and hold it fixed.",
    see: ["precision-recall", "calibration", "conviction"],
  },
];
