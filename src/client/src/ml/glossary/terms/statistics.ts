/**
 * Statistics — describing a sample, and deciding whether a difference is real.
 *
 * SRP: Data only. Merged by `../index.ts`.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  // ── Describing a distribution ──────────────────────────────────────────
  {
    id: "mean",
    term: "mean",
    symbol: "μ",
    domain: "statistics",
    aliases: ["average", "expected value"],
    definition:
      "The arithmetic centre: sum divided by count. **The one a sum-based calculation actually uses** — total P&L is the mean trade times the trade count.",
    why: "Dragged around by a single extreme value. Always read it beside the median.",
    see: ["median", "skewness", "outlier"],
  },
  {
    id: "median",
    term: "median",
    domain: "statistics",
    aliases: ["p50", "50th percentile"],
    definition:
      "The middle value — half the sample sits above, half below. **Differs from the mean exactly when it matters**: in a skewed sample the two separate, and the size of the gap is the skew.",
    see: ["mean", "skewness", "percentile"],
  },
  {
    id: "standard-deviation",
    term: "standard deviation",
    symbol: "σ",
    domain: "statistics",
    aliases: ["stdev", "sd", "sigma"],
    definition:
      "The typical distance of an observation from the mean, in the data's own units. The square root of variance.",
    why: "Describes a bell curve well and almost nothing in trading is a bell curve. Meaningless without kurtosis beside it.",
    see: ["variance", "kurtosis", "z-score"],
  },
  {
    id: "variance",
    term: "variance",
    symbol: "σ²",
    domain: "statistics",
    definition:
      "The mean squared distance from the mean. **Additive over independent periods**, which is why volatility scales with the square root of time rather than with time.",
    see: ["standard-deviation", "variance-additivity"],
  },
  {
    id: "skewness",
    term: "skewness",
    domain: "statistics",
    aliases: ["third moment", "asymmetry"],
    definition:
      "Which side the tail is on. Zero for a symmetric sample; **negative means the left tail is longer**, so the worst days are worse than the best days are good.",
    why: "A flattering mean and standard deviation can hide a hard one-sided tail. This is the statistic that exposes it.",
    see: ["kurtosis", "mean", "median"],
  },
  {
    id: "kurtosis",
    term: "kurtosis",
    domain: "statistics",
    aliases: ["fourth moment", "fat tails", "excess kurtosis", "leptokurtic"],
    definition:
      "How much of the variance comes from rare extreme values rather than ordinary ones. **Excess kurtosis** subtracts 3, so a bell curve reads 0. High excess kurtosis means fat tails.",
    why: "The statistic that decides whether a standard deviation means anything at all. EURUSD one-minute returns read 107.",
    see: ["skewness", "standard-deviation", "fat-tail"],
  },
  {
    id: "percentile",
    term: "percentile",
    domain: "statistics",
    aliases: ["quantile", "p25", "p75", "quartile", "iqr"],
    definition:
      "The value below which a given share of the sample falls. p25/p50/p75 describe the body of a distribution **free of any assumption about its shape**.",
    see: ["median", "robust-statistic"],
  },
  {
    id: "moment",
    term: "moment",
    domain: "statistics",
    definition:
      "A summary built from powers of the deviation from the mean. First is the mean, second variance, third skewness, fourth kurtosis. **Higher moments describe the tail**; lower ones describe the body.",
    see: ["skewness", "kurtosis"],
  },
  {
    id: "outlier",
    term: "outlier",
    domain: "statistics",
    definition:
      "An observation far from the rest. In market data an outlier is usually **either a bad print or the single most important event in the sample**, and telling those apart is the job.",
    why: "Deleting outliers before checking which kind they are is how a risk model comes to believe crashes do not happen.",
    see: ["winsorize", "robust-statistic", "fat-tail"],
  },
  {
    id: "robust-statistic",
    term: "robust statistic",
    domain: "statistics",
    aliases: ["median absolute deviation", "MAD"],
    definition:
      "A summary that a few extreme values cannot move much — median instead of mean, interquartile range or MAD instead of standard deviation.",
    why: "Useful when you want the body of the distribution. Dangerous when the tail IS the subject.",
    see: ["percentile", "winsorize"],
  },
  {
    id: "winsorize",
    term: "winsorize / clip",
    domain: "statistics",
    definition:
      "Cap extreme values at a chosen percentile instead of deleting them, so they still count but cannot dominate.",
    why: "Fine on a model INPUT. Never on the target — clipping the objective distorts exactly the tail events the model exists to predict.",
    see: ["outlier", "z-score"],
  },
  {
    id: "fat-tail",
    term: "fat tail",
    domain: "statistics",
    aliases: ["heavy tail", "power law"],
    definition:
      "A distribution where extreme values are far more common than a bell curve allows. **The defining feature of financial returns.**",
    why: "A 4σ move should arrive once every 16,000 observations; in EURUSD it arrives about 100× more often than that.",
    see: ["kurtosis", "black-swan", "extreme-value-theory"],
  },
  {
    id: "correlation",
    term: "correlation",
    symbol: "ρ",
    domain: "statistics",
    aliases: ["pearson", "corr"],
    definition:
      "How tightly two series move together, scaled to [−1, +1]. **Linear only** — two series can be perfectly dependent and uncorrelated.",
    why: "The default score for a forecast, and it says nothing about whether the forecast is the right size, only that it points the right way.",
    see: ["spearman", "r-squared", "covariance"],
  },
  {
    id: "spearman",
    term: "Spearman correlation",
    domain: "statistics",
    aliases: ["rank correlation", "kendall tau"],
    definition:
      "Correlation computed on RANKS rather than values. Catches any monotone relationship, not just a straight-line one, and **is not moved by outliers**.",
    see: ["correlation"],
  },
  {
    id: "covariance",
    term: "covariance",
    domain: "statistics",
    definition:
      "The unscaled version of correlation — how two series co-move, in the product of their units. The building block of a portfolio's variance.",
    see: ["correlation", "covariance-matrix"],
  },
  {
    id: "r-squared",
    term: "R²",
    symbol: "R²",
    domain: "statistics",
    aliases: ["coefficient of determination", "r2", "explained variance"],
    definition:
      "The share of the target's variance a model accounts for. **Can go negative** out of sample — that means the model is worse than predicting the mean.",
    why: "A negative R² beside a positive correlation means the model has the direction right and the scale wrong.",
    see: ["correlation", "rmse"],
  },
  {
    id: "rmse",
    term: "RMSE",
    expansion: "Root Mean Squared Error",
    domain: "statistics",
    aliases: ["mse", "mae", "root mean squared error"],
    definition:
      "Average prediction error, in the target's own units, with big misses weighted heavily because errors are squared first. **MAE** averages absolute errors instead and is far less sensitive to a single bad prediction.",
    see: ["r-squared", "loss-function"],
  },

  // ── Inference ──────────────────────────────────────────────────────────
  {
    id: "null-hypothesis",
    term: "null hypothesis",
    symbol: "H₀",
    domain: "statistics",
    definition:
      "The boring explanation you have to rule out — *there is no effect, this is chance*. **Everything in inference is defined against it**, so a badly chosen null makes every downstream number meaningless.",
    why: "In trading the right null is rarely 'zero'. It is usually a surrogate that keeps every property of the data except the one being tested.",
    see: ["p-value", "surrogate", "significance"],
  },
  {
    id: "p-value",
    term: "p-value",
    domain: "statistics",
    definition:
      "The probability of a result at least this extreme if the null were true. Small means **hard to explain as luck** — not 'probably true', and not 'large'.",
    why: "On millions of bars almost anything reaches significance. Always read effect size beside it.",
    see: ["null-hypothesis", "significance", "effect-size"],
  },
  {
    id: "effect-size",
    term: "effect size",
    domain: "statistics",
    definition:
      "How BIG the difference is, as opposed to how confident you are that it exists. Cramér's V, Cohen's d, a lift ratio, a correlation.",
    why: "A chi-square on a million rows is certain to reject. Report V or KL beside it or the number says nothing.",
    see: ["p-value", "significance"],
  },
  {
    id: "significance",
    term: "statistical significance",
    domain: "statistics",
    definition:
      "A result unlikely to have arisen by chance under the null. **Not the same as important, tradeable, or large.**",
    see: ["p-value", "effect-size", "economic-significance"],
  },
  {
    id: "economic-significance",
    term: "economic significance",
    domain: "statistics",
    definition:
      "Whether an edge is big enough to survive costs and be worth taking. **The question statistical significance does not answer.**",
    why: "A 56% hit rate on a 1-minute bar can be overwhelmingly significant and still lose money against the spread.",
    see: ["significance", "break-even-spread"],
  },
  {
    id: "confidence-interval",
    term: "confidence interval",
    domain: "statistics",
    aliases: ["CI", "error bar"],
    definition:
      "A range that plausibly contains the true value. **An interval on a difference that crosses zero is a tie**, whatever the point estimate looks like.",
    see: ["bootstrap", "standard-error"],
  },
  {
    id: "standard-error",
    term: "standard error",
    symbol: "SE",
    domain: "statistics",
    definition:
      "The standard deviation of an ESTIMATE rather than of the data. Shrinks like 1/√n, which is why more data narrows a confidence interval.",
    why: "Assumes independent observations. With overlapping windows the true n is far smaller than the row count and the SE is far too small.",
    see: ["confidence-interval", "overlapping-samples"],
  },
  {
    id: "t-statistic",
    term: "t-statistic",
    domain: "statistics",
    aliases: ["t-stat", "t-test"],
    definition:
      "An estimate divided by its standard error — how many standard errors it sits from zero. Past roughly ±2 is conventionally *unlikely to be chance*.",
    why: "Inflated by roughly √(overlap) when observations overlap, which is the single most common way a backtest lies.",
    see: ["standard-error", "overlapping-samples"],
  },
  {
    id: "bootstrap",
    term: "bootstrap",
    domain: "statistics",
    definition:
      "Estimating uncertainty by resampling the observed data many times and watching how much the answer moves. **No distributional assumption required.**",
    see: ["block-bootstrap", "confidence-interval", "permutation-test"],
  },
  {
    id: "block-bootstrap",
    term: "block bootstrap",
    domain: "statistics",
    aliases: ["moving block bootstrap", "politis-white"],
    definition:
      "Bootstrap that resamples **contiguous blocks** rather than single points, so autocorrelation survives the resampling.",
    why: "Resampling single points from an autocorrelated series produces intervals far too narrow — it treats dependent observations as independent.",
    see: ["bootstrap", "autocorrelation"],
  },
  {
    id: "permutation-test",
    term: "permutation test",
    domain: "statistics",
    aliases: ["randomisation test", "shuffle test"],
    definition:
      "Build the null by shuffling the data so the relationship under test is destroyed and everything else survives, then see where the real statistic falls.",
    why: "The shuffle must break ONLY the thing being tested. An i.i.d. shuffle of a smooth series also destroys smoothness, so the test measures smoothness.",
    see: ["surrogate", "null-hypothesis", "block-permutation"],
  },
  {
    id: "block-permutation",
    term: "block permutation",
    domain: "statistics",
    definition:
      "Permuting in contiguous blocks so each block's internal structure survives and only the alignment between blocks is destroyed.",
    why: "The right null for an autocorrelated feature: keeps the marginal AND the smoothness, kills the relationship to the target.",
    see: ["permutation-test", "surrogate"],
  },
  {
    id: "surrogate",
    term: "surrogate data",
    domain: "statistics",
    definition:
      "A synthetic dataset built to match the real one in every respect except the property under test. **Whatever the real data does that the surrogate does not is the finding.**",
    see: ["permutation-test", "null-hypothesis"],
  },
  {
    id: "multiple-testing",
    term: "multiple testing",
    domain: "statistics",
    aliases: ["multiple comparisons", "look-elsewhere", "data dredging"],
    definition:
      "Test enough hypotheses and some pass by chance. At p<0.05, **one test in twenty passes on pure noise** — so a thousand tests yield fifty false discoveries.",
    why: "The default failure mode of any pattern search. Correction is not optional.",
    see: ["fdr", "bonferroni", "deflated-sharpe"],
  },
  {
    id: "fdr",
    term: "FDR",
    expansion: "False Discovery Rate",
    domain: "statistics",
    aliases: ["benjamini-hochberg", "false discovery rate"],
    definition:
      "The expected share of your *discoveries* that are false. Benjamini–Hochberg controls it, and is **far less brutal than controlling the chance of any false positive at all**.",
    see: ["multiple-testing", "bonferroni"],
  },
  {
    id: "bonferroni",
    term: "Bonferroni correction",
    domain: "statistics",
    definition:
      "Divide the significance threshold by the number of tests. Simple, correct, and so conservative on large searches that it finds nothing.",
    see: ["fdr", "multiple-testing"],
  },
  {
    id: "type-i-error",
    term: "Type I / Type II error",
    domain: "statistics",
    aliases: ["false positive", "false negative"],
    definition:
      "**Type I** is finding an effect that is not there; **Type II** is missing one that is. Tightening a threshold trades one for the other.",
    why: "In strategy research a Type I error costs money and a Type II costs an opportunity. They are not symmetric.",
    see: ["p-value", "power"],
  },
  {
    id: "power",
    term: "statistical power",
    domain: "statistics",
    definition:
      "The chance of detecting an effect that is genuinely there. Grows with sample size and effect size.",
    why: "An underpowered study that finds nothing has said nothing. Absence of evidence needs power to become evidence of absence.",
    see: ["type-i-error", "effect-size"],
  },
  {
    id: "regression-to-mean",
    term: "regression to the mean",
    domain: "statistics",
    definition:
      "Extreme measurements tend to be followed by less extreme ones, purely because the extreme was partly luck.",
    why: "Why last year's best fund underperforms this year without anything changing, and why the top strategy in a sweep disappoints live.",
    see: ["selection-bias", "overfitting"],
  },
  {
    id: "selection-bias",
    term: "selection bias",
    domain: "statistics",
    aliases: ["survivorship bias", "cherry picking"],
    definition:
      "Conclusions drawn from a sample chosen in a way related to the outcome. **Survivorship bias** is the common form: the delisted names are missing from the dataset.",
    see: ["regression-to-mean", "backtest-overfitting"],
  },
  {
    id: "simpson-paradox",
    term: "Simpson's paradox",
    domain: "statistics",
    definition:
      "A relationship that holds in every subgroup and reverses when the groups are pooled — or the other way round.",
    why: "Why a strategy can look profitable overall and lose money in every regime, or the reverse.",
    see: ["confounding"],
  },
  {
    id: "confounding",
    term: "confounder",
    domain: "statistics",
    definition:
      "A third variable driving both sides of an apparent relationship. **The reason correlation is not causation**, stated concretely.",
    why: "Time of day confounds most intraday 'patterns': the pattern and the outcome both track liquidity.",
    see: ["simpson-paradox", "correlation"],
  },
  {
    id: "stationarity",
    term: "stationarity",
    domain: "statistics",
    aliases: ["non-stationary", "unit root"],
    definition:
      "A series whose statistical properties do not change over time. **Price is not stationary; returns roughly are**, which is the whole reason models are fitted on returns.",
    see: ["adf-test", "cointegration", "log-return"],
  },
  {
    id: "adf-test",
    term: "ADF test",
    expansion: "Augmented Dickey–Fuller",
    domain: "statistics",
    aliases: ["dickey fuller", "kpss", "unit root test"],
    definition:
      "A test for whether a series has a unit root — i.e. is non-stationary. **KPSS** tests the reverse null and the two are usually reported together.",
    see: ["stationarity", "cointegration"],
  },
  {
    id: "jarque-bera",
    term: "Jarque–Bera test",
    domain: "statistics",
    aliases: ["normality test", "shapiro wilk", "anderson darling"],
    definition:
      "A normality test built from skewness and excess kurtosis. Chi-square with two degrees of freedom under the null.",
    why: "On a million bars it rejects with certainty and its magnitude says nothing. Report skew and kurtosis beside it.",
    see: ["kurtosis", "skewness", "effect-size"],
  },
  {
    id: "chi-square",
    term: "chi-square test",
    symbol: "χ²",
    domain: "statistics",
    definition:
      "Tests whether observed counts in a contingency table differ from what independence would give.",
    why: "With a million pairs certainty is cheap. Always report Cramér's V or a KL divergence beside it as the effect size.",
    see: ["effect-size", "cramers-v"],
  },
  {
    id: "cramers-v",
    term: "Cramér's V",
    domain: "statistics",
    definition:
      "The effect size for a chi-square — association strength scaled to [0, 1], independent of sample size.",
    see: ["chi-square", "effect-size"],
  },
  {
    id: "kl-divergence",
    term: "KL divergence",
    expansion: "Kullback–Leibler",
    domain: "statistics",
    aliases: ["relative entropy"],
    definition:
      "How many extra bits it costs to encode data from one distribution using a code built for another. **Not symmetric** — KL(P‖Q) ≠ KL(Q‖P).",
    see: ["entropy", "wasserstein", "cramers-v"],
  },
  {
    id: "wasserstein",
    term: "Wasserstein distance",
    domain: "statistics",
    aliases: ["earth mover distance", "W2"],
    definition:
      "The cost of transporting one distribution into another. **Symmetric, and meaningful even when the two barely overlap**, where KL blows up.",
    why: "The right metric for drift detection between a training window and a live one.",
    see: ["kl-divergence", "drift"],
  },
  {
    id: "entropy",
    term: "entropy",
    symbol: "H",
    domain: "statistics",
    definition:
      "Average surprise, in bits — how unpredictable a source is. Maximal when every outcome is equally likely.",
    why: "Conditional entropy is severely biased downward once the context count approaches the sample size; compare against a shuffled surrogate.",
    see: ["kl-divergence", "mutual-information", "surrogate"],
  },
  {
    id: "mutual-information",
    term: "mutual information",
    symbol: "MI",
    domain: "statistics",
    definition:
      "How much knowing one variable reduces uncertainty about another. **Catches non-linear dependence** that correlation misses entirely.",
    why: "Needs binning or a density estimate, and both introduce their own bias on small samples.",
    see: ["entropy", "correlation"],
  },
  {
    id: "law-of-large-numbers",
    term: "law of large numbers",
    domain: "statistics",
    definition:
      "Sample averages converge to the true mean as the sample grows. **Requires the mean to exist** — for some fat-tailed distributions it does not, and the average never settles.",
    see: ["central-limit-theorem", "fat-tail"],
  },
  {
    id: "central-limit-theorem",
    term: "central limit theorem",
    expansion: "CLT",
    domain: "statistics",
    definition:
      "Sums of many independent contributions tend to a bell curve. **Both conditions fail in markets**: contributions are dependent and their variance is not finite in practice.",
    why: "The reason people expect Gaussian returns, and the reason they do not get them.",
    see: ["fat-tail", "aggregational-gaussianity"],
  },
  {
    id: "aggregational-gaussianity",
    term: "aggregational Gaussianity",
    domain: "statistics",
    definition:
      "Returns look more bell-shaped the longer the bar. One-minute returns are wildly fat-tailed; daily returns much less so.",
    why: "Why risk measured on daily data can look reassuring while the intraday reality is not.",
    see: ["kurtosis", "central-limit-theorem", "fat-tail"],
  },
  {
    id: "extreme-value-theory",
    term: "extreme value theory",
    expansion: "EVT",
    domain: "statistics",
    aliases: ["gpd", "peaks over threshold", "generalised pareto"],
    definition:
      "Modelling the tail on its own terms rather than as an afterthought of a distribution fitted to the body. **Peaks-over-threshold** fits a generalised Pareto above a cutoff.",
    why: "Lets you say something about a loss larger than any yet observed, which no empirical quantile can.",
    see: ["fat-tail", "tail-risk", "expected-shortfall"],
  },
  {
    id: "uncertainty",
    term: "uncertainty quantification",
    domain: "statistics",
    aliases: ["aleatoric", "epistemic", "predictive interval"],
    definition:
      "Attaching a range to a prediction. **Aleatoric** is irreducible noise in the world; **epistemic** is ignorance the model could reduce with more data.",
    why: "Worth separating: epistemic uncertainty says gather more data, aleatoric says stop trying.",
    see: ["confidence-interval", "conformal-prediction", "calibration"],
  },
  {
    id: "conformal-prediction",
    term: "conformal prediction",
    domain: "statistics",
    definition:
      "Turning any model into one that emits intervals with a guaranteed coverage rate, using held-out residuals and **no distributional assumption**.",
    why: "The guarantee needs exchangeability, which a time series violates — so use the time-series variants, not vanilla conformal.",
    see: ["uncertainty", "quantile-loss", "confidence-interval"],
  },
  {
    id: "compounding",
    term: "compounding",
    domain: "statistics",
    definition:
      "Returns applying to a base that already includes prior returns, so growth is multiplicative rather than additive.",
    why: "Why log returns are the natural unit across time: they add where simple returns multiply.",
    see: ["log-return", "volatility-drag"],
  },
];
