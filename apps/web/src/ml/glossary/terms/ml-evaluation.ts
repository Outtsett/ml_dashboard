/**
 * Evaluation — scoring a model, and the ways a score lies.
 *
 * SRP: Data only. Merged by `../index.ts`.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  // ── Classification scores ──────────────────────────────────────────────
  {
    id: "accuracy",
    term: "accuracy",
    domain: "ml-evaluation",
    definition:
      "Share of predictions that were right. **Useless on imbalanced data**: predict 'no crash' every day and you are 99.9% accurate.",
    see: ["balanced-accuracy", "precision-recall", "base-rate"],
  },
  {
    id: "balanced-accuracy",
    term: "balanced accuracy",
    domain: "ml-evaluation",
    definition:
      "The mean of per-class recall, so each class counts equally regardless of how many examples it has. 0.5 is chance for two classes.",
    see: ["accuracy", "base-rate"],
  },
  {
    id: "base-rate",
    term: "base rate",
    domain: "ml-evaluation",
    aliases: ["prevalence", "class balance"],
    definition:
      "How often the positive class occurs unconditionally. **Every hit rate must be read against it**, never against 0.5 — otherwise you are reporting the market's own drift as skill.",
    see: ["accuracy", "hit-rate"],
  },
  {
    id: "precision-recall",
    term: "precision / recall",
    domain: "ml-evaluation",
    aliases: ["sensitivity", "specificity", "f1", "ppv"],
    definition:
      "**Precision**: of the ones you flagged, how many were right. **Recall**: of the ones that mattered, how many you caught. F1 is their harmonic mean.",
    why: "In trading precision is usually what pays — a missed trade costs nothing, a bad trade costs money.",
    see: ["accuracy", "confusion-matrix", "pr-auc"],
  },
  {
    id: "confusion-matrix",
    term: "confusion matrix",
    domain: "ml-evaluation",
    definition:
      "The 2×2 table of predicted versus actual. Every classification metric is a ratio computed from its four cells.",
    see: ["precision-recall", "accuracy"],
  },
  {
    id: "auc",
    term: "AUC / ROC-AUC",
    expansion: "Area Under the Receiver Operating Characteristic Curve",
    domain: "ml-evaluation",
    aliases: ["roc", "auroc"],
    definition:
      "The probability that a randomly chosen positive scores above a randomly chosen negative. **0.5 is chance**, 1.0 is perfect.",
    why: "Threshold-free and imbalance-insensitive, which is also its weakness: 0.52 can be genuinely tradeable or worthless depending entirely on cost.",
    see: ["pr-auc", "accuracy", "calibration"],
  },
  {
    id: "pr-auc",
    term: "PR-AUC",
    expansion: "Precision–Recall AUC",
    domain: "ml-evaluation",
    aliases: ["average precision"],
    definition:
      "Area under the precision–recall curve. **More informative than ROC-AUC when positives are rare**, because it ignores the many easy true negatives.",
    see: ["auc", "precision-recall"],
  },
  {
    id: "log-loss",
    term: "log loss",
    domain: "ml-evaluation",
    aliases: ["cross entropy", "binary cross entropy"],
    definition:
      "Penalises confident wrong answers harshly and rewards well-calibrated probabilities. **Scores the probability, not just the decision.**",
    see: ["brier-score", "calibration", "loss-function"],
  },
  {
    id: "brier-score",
    term: "Brier score",
    domain: "ml-evaluation",
    definition:
      "Mean squared error on predicted probabilities. Like log loss but bounded, so a single confident mistake cannot dominate.",
    see: ["log-loss", "calibration"],
  },
  {
    id: "calibration",
    term: "calibration",
    domain: "ml-evaluation",
    aliases: ["reliability diagram", "platt scaling", "isotonic"],
    definition:
      "Whether a predicted 70% actually happens 70% of the time. **A model can rank perfectly and be badly calibrated**, which breaks any sizing rule that uses the probability as a number.",
    why: "Boosted trees are usually overconfident at the extremes. Platt scaling or isotonic regression fixes it, fitted on held-out data.",
    see: ["log-loss", "brier-score", "position-sizing"],
  },
  {
    id: "mcc",
    term: "Matthews correlation coefficient",
    expansion: "MCC",
    domain: "ml-evaluation",
    definition:
      "A single balanced score from all four confusion-matrix cells, in [−1, +1]. **Only high when the model does well on both classes**, so imbalance cannot flatter it.",
    see: ["confusion-matrix", "balanced-accuracy"],
  },

  // ── Trading scores ─────────────────────────────────────────────────────
  {
    id: "sharpe-ratio",
    term: "Sharpe ratio",
    symbol: "E[R − R_f] / σ_p",
    domain: "ml-evaluation",
    definition:
      "Annualised excess return per unit of volatility. The default single-number score for a strategy.",
    why: "Says nothing about the SHAPE of the losses, and rewards a strategy that sells tail risk. Never read alone.",
    see: ["sortino-ratio", "calmar-ratio", "deflated-sharpe"],
  },
  {
    id: "sortino-ratio",
    term: "Sortino ratio",
    domain: "ml-evaluation",
    definition:
      "Sharpe with the denominator replaced by **downside deviation only**, so upside volatility stops counting as risk.",
    see: ["sharpe-ratio", "calmar-ratio"],
  },
  {
    id: "calmar-ratio",
    term: "Calmar ratio",
    domain: "ml-evaluation",
    definition:
      "Annualised return divided by maximum drawdown. The tail-risk view: what you earned against the worst peak-to-trough loss along the way.",
    see: ["max-drawdown", "sharpe-ratio", "mar-ratio"],
  },
  {
    id: "mar-ratio",
    term: "MAR ratio",
    domain: "ml-evaluation",
    definition:
      "Calmar computed over the whole track record rather than a trailing window. Same idea, longer memory.",
    see: ["calmar-ratio"],
  },
  {
    id: "profit-factor",
    term: "profit factor",
    domain: "ml-evaluation",
    definition:
      "Gross profit over gross loss. Above 1 means winners outweigh losers in aggregate; **says nothing about how many of each there were**.",
    see: ["hit-rate", "payoff-ratio", "expectancy"],
  },
  {
    id: "hit-rate",
    term: "hit rate",
    domain: "ml-evaluation",
    aliases: ["win rate"],
    definition:
      "Share of trades that made money. **Meaningless without the payoff ratio** — 40% winners can be highly profitable and 70% can be ruinous.",
    see: ["payoff-ratio", "profit-factor", "base-rate"],
  },
  {
    id: "payoff-ratio",
    term: "payoff ratio",
    domain: "ml-evaluation",
    aliases: ["win loss ratio", "rr"],
    definition:
      "Average win divided by average loss. Together with hit rate it determines expectancy completely.",
    see: ["hit-rate", "expectancy"],
  },
  {
    id: "expectancy",
    term: "expectancy",
    symbol: "p·W − (1−p)·L",
    domain: "ml-evaluation",
    definition:
      "Expected profit per trade. **The only quantity that has to be positive** — everything else is commentary on its variance.",
    see: ["hit-rate", "payoff-ratio", "profit-factor"],
  },
  {
    id: "max-drawdown",
    term: "maximum drawdown",
    expansion: "MDD",
    domain: "ml-evaluation",
    definition:
      "The largest peak-to-trough fall in equity. **The number that actually gets a strategy switched off**, regardless of what its Sharpe was.",
    why: "Depends on the sample length — a longer backtest almost always finds a worse one.",
    see: ["calmar-ratio", "underwater-curve", "drawdown-duration"],
  },
  {
    id: "drawdown-duration",
    term: "drawdown duration",
    domain: "ml-evaluation",
    aliases: ["time to recovery", "underwater period"],
    definition:
      "How long equity stays below its previous high. **Often more punishing than the depth** — a 10% drawdown lasting two years ends careers that a 30% one lasting a month does not.",
    see: ["max-drawdown", "underwater-curve"],
  },
  {
    id: "underwater-curve",
    term: "underwater curve",
    domain: "ml-evaluation",
    definition:
      "Drawdown plotted through time — how far below the running peak equity sat at every moment.",
    see: ["max-drawdown", "drawdown-duration"],
  },
  {
    id: "deflated-sharpe",
    term: "deflated Sharpe ratio",
    expansion: "DSR",
    domain: "ml-evaluation",
    definition:
      "A Sharpe adjusted for **how many strategies you tried** before picking this one, plus the skew and kurtosis of its returns.",
    why: "The honest answer to 'I tested 500 variants and this one has Sharpe 2'. Usually it deflates to nothing.",
    see: ["multiple-testing", "backtest-overfitting", "pbo"],
  },
  {
    id: "pbo",
    term: "PBO",
    expansion: "Probability of Backtest Overfitting",
    domain: "ml-evaluation",
    definition:
      "The chance that the configuration ranked best in-sample will underperform the median out-of-sample. Estimated by **combinatorially splitting** the data many ways.",
    see: ["deflated-sharpe", "cpcv", "backtest-overfitting"],
  },
  {
    id: "diebold-mariano",
    term: "Diebold–Mariano test",
    domain: "ml-evaluation",
    definition:
      "Tests whether two forecasts differ in accuracy by more than chance, accounting for the autocorrelation in their error difference.",
    why: "The right way to say 'model A beats model B'. Comparing two Sharpe ratios by eye is not a test.",
    see: ["block-bootstrap", "significance"],
  },
  {
    id: "information-coefficient",
    term: "information coefficient",
    expansion: "IC",
    domain: "ml-evaluation",
    definition:
      "The correlation between a forecast and the realised outcome. **A 0.05 IC is a genuinely good signal** in cross-sectional equity work.",
    see: ["correlation", "information-ratio", "breadth"],
  },
  {
    id: "information-ratio",
    term: "information ratio",
    expansion: "IR",
    domain: "ml-evaluation",
    definition:
      "Active return divided by tracking error — Sharpe measured against a benchmark instead of cash.",
    see: ["sharpe-ratio", "information-coefficient", "breadth"],
  },
  {
    id: "breadth",
    term: "fundamental law of active management",
    symbol: "IR ≈ IC · √breadth",
    domain: "ml-evaluation",
    definition:
      "Skill times the square root of how many independent bets you make. **A weak signal applied widely beats a strong one applied once.**",
    why: "Breadth means INDEPENDENT bets. A thousand correlated positions is one bet.",
    see: ["information-coefficient", "information-ratio"],
  },
  {
    id: "turnover",
    term: "turnover",
    domain: "ml-evaluation",
    definition:
      "How much of the portfolio is traded per period. **The multiplier on every cost**, and the denominator in break-even calculations.",
    see: ["break-even-spread", "transaction-cost"],
  },
  {
    id: "break-even-spread",
    term: "break-even spread",
    domain: "ml-evaluation",
    definition:
      "The transaction cost at which an edge is exactly consumed. Net PnL is linear in cost, so it is simply **gross PnL ÷ turnover** — computed exactly, never swept.",
    why: "The number that decides whether a statistically real edge is a tradeable one.",
    see: ["turnover", "transaction-cost", "economic-significance"],
  },

  // ── How a score lies ───────────────────────────────────────────────────
  {
    id: "backtest-overfitting",
    term: "backtest overfitting",
    domain: "ml-evaluation",
    definition:
      "Tuning until the historical curve looks good, producing a strategy that describes the past and predicts nothing.",
    why: "Not a matter of degree — with enough parameters any past can be fitted perfectly. The defence is out-of-sample discipline, not a better fit.",
    see: ["pbo", "deflated-sharpe", "overfitting", "multiple-testing"],
  },
  {
    id: "look-ahead-bias",
    term: "look-ahead bias",
    domain: "ml-evaluation",
    aliases: ["lookahead", "future leak"],
    definition:
      "Using information at time t that was not actually available until later. **The most common and most fatal backtest bug.**",
    why: "Sources: a centred rolling window, a whole-sample mean, a restated fundamental, a survivorship-filtered universe.",
    see: ["leakage", "purging", "causal-window"],
  },
  {
    id: "leakage",
    term: "data leakage",
    domain: "ml-evaluation",
    definition:
      "Information from the evaluation set reaching the model during training, by any route. **Produces a good number that means nothing.**",
    why: "Subtle forms: scaling fitted on the full series, feature selection before the split, hyperparameters tuned on the test set.",
    see: ["look-ahead-bias", "purging", "embargo"],
  },
  {
    id: "overlapping-samples",
    term: "overlapping samples",
    domain: "ml-evaluation",
    definition:
      "Labels whose horizons overlap in time, so consecutive observations are not independent. **Inflates a t-statistic by roughly √overlap.**",
    why: "Features may overlap freely; targets may not. Sample at the label horizon, or weight by uniqueness.",
    see: ["sample-uniqueness", "t-statistic", "block-bootstrap"],
  },
  {
    id: "sample-uniqueness",
    term: "sample uniqueness",
    domain: "ml-evaluation",
    definition:
      "How much of a label's horizon is not shared with other labels. Used as a **training weight** so heavily overlapping observations do not count many times over.",
    see: ["overlapping-samples", "sequential-bootstrap"],
  },
  {
    id: "sequential-bootstrap",
    term: "sequential bootstrap",
    domain: "ml-evaluation",
    definition:
      "Bootstrap that draws observations with probability inversely related to their overlap with what is already drawn, producing a more nearly independent sample.",
    see: ["sample-uniqueness", "bootstrap"],
  },
];
