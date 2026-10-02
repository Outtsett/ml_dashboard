/**
 * Features & labels — what the model reads, and what it is asked to predict.
 *
 * SRP: Data only. Merged by `../index.ts`.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  // ── Features ───────────────────────────────────────────────────────────
  {
    id: "feature",
    term: "feature",
    domain: "features",
    aliases: ["predictor", "covariate", "input", "factor"],
    definition:
      "One column the model reads. **Every one is a hypothesis** about what matters, and every one costs degrees of freedom.",
    see: ["feature-engineering", "feature-selection", "label"],
  },
  {
    id: "feature-engineering",
    term: "feature engineering",
    domain: "features",
    definition:
      "Turning raw data into columns a model can use. **Where most of the value is created on tabular financial data**, and where most of the leakage is created too.",
    see: ["feature", "leakage", "scale-free"],
  },
  {
    id: "feature-selection",
    term: "feature selection",
    domain: "features",
    aliases: ["boruta", "shadow features", "rfe"],
    definition:
      "Choosing which columns to keep. **Boruta**-style methods compare each column against permuted *shadow* copies of the candidates themselves.",
    why: "The shadow must be block-permuted, not i.i.d.-shuffled: an i.i.d. shuffle turns a smooth series into white noise, so the test measures smoothness rather than relevance.",
    see: ["feature-importance", "block-permutation", "curse-of-dimensionality"],
  },
  {
    id: "feature-importance",
    term: "feature importance",
    aliases: ["gain", "split importance", "permutation importance"],
    domain: "features",
    definition:
      "How much a column contributed. **Split/gain importance is biased** toward high-cardinality features; **permutation importance** measures the actual loss from destroying the column.",
    why: "Both are unreliable under correlated features — the credit gets split arbitrarily between them.",
    see: ["shap", "feature-selection", "multicollinearity"],
  },
  {
    id: "shap",
    term: "SHAP",
    expansion: "SHapley Additive exPlanations",
    domain: "features",
    definition:
      "Attributes a prediction across features using the game-theoretic Shapley value — the only attribution satisfying a set of fairness axioms.",
    why: "Expensive, and its independence assumption is violated by correlated features, which is most financial features.",
    see: ["feature-importance", "explainability"],
  },
  {
    id: "explainability",
    term: "explainability",
    expansion: "XAI",
    domain: "features",
    aliases: ["interpretability", "lime"],
    definition:
      "Making a model's reasoning legible. **Interpretable** means the model is simple enough to read; **explainable** means a second method explains a model that is not.",
    see: ["shap", "feature-importance"],
  },
  {
    id: "multicollinearity",
    term: "multicollinearity",
    domain: "features",
    aliases: ["vif", "collinear"],
    definition:
      "Features carrying overlapping information. **Harmless for prediction, fatal for interpretation** — coefficients and importances become unstable and arbitrary.",
    see: ["feature-importance", "ridge-lasso", "whitening"],
  },
  {
    id: "categorical-feature",
    term: "categorical feature",
    aliases: ["target encoding", "ordinal encoding", "cardinality"],
    domain: "features",
    definition:
      "A column of discrete labels. **Target encoding leaks** unless computed out-of-fold — it uses the label to build the feature.",
    see: ["one-hot", "leakage", "embedding"],
  },
  {
    id: "lag-feature",
    term: "lag feature",
    domain: "features",
    definition:
      "A past value of a series used as an input. **The simplest way to give a model memory**, and the easiest place to be off by one and leak.",
    see: ["causal-window", "look-ahead-bias", "autocorrelation"],
  },
  {
    id: "interaction-feature",
    term: "interaction / cross feature",
    domain: "features",
    definition:
      "A product or combination of two features. **Trees find interactions on their own; linear models cannot** and must be handed them.",
    see: ["feature-engineering", "term-structure-vol"],
  },
  {
    id: "candle-geometry",
    term: "candle geometry",
    domain: "features",
    definition:
      "A bar's shape as fractions of its own range — body, upper wick, lower wick. **Scale-free by construction**, since the three sum to one.",
    why: "Exactly two degrees of freedom plus a direction bit, so every other shape statistic is a function of those.",
    see: ["ohlc", "scale-free", "simplex"],
  },
  {
    id: "simplex",
    term: "simplex",
    domain: "features",
    definition:
      "The space of non-negative numbers summing to one. Three such fractions live on a triangle, so any partition of that triangle is a complete description with nothing discarded.",
    see: ["candle-geometry", "codebook"],
  },
  {
    id: "feature-store",
    term: "feature store",
    domain: "features",
    definition:
      "A shared, versioned home for computed features so training and serving read the identical definition.",
    why: "Exists specifically to prevent training/serving skew.",
    see: ["training-serving-skew", "data-versioning"],
  },
  {
    id: "point-in-time",
    term: "point-in-time data",
    aliases: ["as-of", "vintage", "restatement"],
    domain: "features",
    definition:
      "Data as it was KNOWN at a moment, not as it was later corrected. **Fundamentals get restated; using the restated value is look-ahead.**",
    see: ["look-ahead-bias", "leakage"],
  },

  // ── Labels ─────────────────────────────────────────────────────────────
  {
    id: "label",
    term: "label",
    domain: "labels",
    aliases: ["target", "ground truth", "y"],
    definition:
      "What the model is asked to predict. **Designing it is the hard part** in finance — the features are usually easier than deciding what counts as a good outcome.",
    see: ["feature", "triple-barrier", "label-horizon"],
  },
  {
    id: "label-horizon",
    term: "label horizon",
    domain: "labels",
    definition:
      "How far ahead the label looks. **Sets the purge width, the overlap, and the holding period** all at once.",
    see: ["purging", "overlapping-samples", "triple-barrier"],
  },
  {
    id: "fixed-horizon-label",
    term: "fixed-horizon label",
    domain: "labels",
    definition:
      "The sign or size of the return N bars ahead. **Simple, and it ignores the path** — a trade stopped out on the way is scored as a winner.",
    see: ["triple-barrier", "label-horizon", "path"],
  },
  {
    id: "triple-barrier",
    term: "triple-barrier labelling",
    domain: "labels",
    definition:
      "Label by which of three barriers is hit first: a profit target, a stop, or a time limit. **Barriers set in multiples of the bar's own trailing volatility**, never fixed pips.",
    why: "A fixed barrier is a different trade in a quiet hour than a violent one, so the label would encode the regime rather than the signal.",
    see: ["meta-labelling", "gamblers-ruin", "intrabar", "mfe-mae"],
  },
  {
    id: "barrier-touch",
    term: "barrier touch",
    domain: "labels",
    definition:
      "Whether a barrier counts as reached on the CLOSE or intrabar against high and low. **Close-only lets a trade that was stopped out carry on** and inflates every downstream statistic.",
    see: ["triple-barrier", "intrabar"],
  },
  {
    id: "meta-labelling",
    term: "meta-labelling",
    domain: "labels",
    definition:
      "A second model predicting whether the FIRST model's signal will work, used to size rather than to decide direction.",
    why: "Separates *which way* from *how much*, and lets a low-precision primary signal become usable.",
    see: ["triple-barrier", "position-sizing", "label"],
  },
  {
    id: "trend-scanning",
    term: "trend scanning",
    domain: "labels",
    definition:
      "Labelling a bar by the statistical significance of the trend that follows it, scanning horizons and keeping the strongest t-statistic.",
    why: "Picks the horizon per observation instead of fixing one, and inherits a multiple-testing problem in doing so.",
    see: ["label-horizon", "t-statistic", "multiple-testing"],
  },
  {
    id: "mfe-mae",
    term: "MFE / MAE",
    expansion: "Maximum Favourable / Adverse Excursion",
    domain: "labels",
    definition:
      "The best and worst the trade ever looked before it closed. **The excursions a single outcome label throws away.**",
    why: "Where stop and target placement is actually diagnosed.",
    see: ["triple-barrier", "path", "stop-loss"],
  },
  {
    id: "regression-task",
    term: "regression vs classification",
    domain: "labels",
    definition:
      "Predicting a number versus predicting a class. **Bucketing a continuous target into classes discards magnitude**, and magnitude is what decides whether an edge pays.",
    see: ["label", "quantile-loss"],
  },
  {
    id: "sample-weight-label",
    term: "label weighting",
    domain: "labels",
    definition:
      "Weighting observations by how much they matter — by uniqueness, by realised return size, or by confidence in the label.",
    see: ["sample-uniqueness", "sample-weight"],
  },
];
