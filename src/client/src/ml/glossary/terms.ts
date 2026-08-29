/**
 * The term and symbol bank — every acronym and piece of notation this desk uses.
 *
 * Think of it as: the index at the back of the textbook. When a chart axis says
 * "excess kurtosis" or a result table says "z*", this is where you find out what
 * it means and, more usefully, why anyone bothered to measure it.
 *
 * SRP: Data only. `GlossaryPage` renders it; nothing here imports React.
 *
 * Definitions are written for someone reading a result, not for someone deriving
 * it — plain language first, the formula as a label, and a `why` line saying what
 * the term buys you. Provenance for the measured values is in
 * `Trading/forexmodel/CLAUDE.md`.
 */

export type TermCategory =
  | "model"
  | "process"
  | "estimator"
  | "quantity"
  | "concept"
  | "transform"
  | "method"
  | "phenomenon"
  | "statistic"
  | "test"
  | "chart"
  | "options"
  | "data"
  | "principle";

export interface Term {
  /** Stable slug — used as the anchor and the deep-link key. */
  id: string;
  /** Display name, as it appears on a chart or in a table header. */
  term: string;
  /** Notation, when the term has any. Rendered in the accent serif. */
  symbol?: string;
  category: TermCategory;
  /** Plain-language definition. `**bold**` marks the load-bearing phrase. */
  definition: string;
  /** What it buys you, or where it bit us. Optional. */
  why?: string;
  /** Free-text search aliases beyond the term itself. */
  aliases?: string[];
}

export const CATEGORY_LABEL: Record<TermCategory, string> = {
  model: "Model",
  process: "Process",
  estimator: "Estimator",
  quantity: "Quantity",
  concept: "Concept",
  transform: "Transform",
  method: "Method",
  phenomenon: "Phenomenon",
  statistic: "Statistic",
  test: "Test",
  chart: "Chart",
  options: "Options",
  data: "Data",
  principle: "Principle",
};

export const TERMS: Term[] = [
  {
    id: "black-scholes",
    term: "Black–Scholes",
    category: "model",
    aliases: ["BS", "option pricing"],
    definition:
      "The 1973 option-pricing formula. Its real content is the **assumption underneath it** — that price follows geometric Brownian motion with a constant volatility. Everything the formula outputs follows from that.",
    why: "Which is why it can be tested on spot prices with no options involved at all.",
  },
  {
    id: "gbm",
    term: "GBM",
    symbol: "dS/S = μ dt + σ dW",
    category: "process",
    aliases: ["geometric brownian motion", "random walk"],
    definition:
      "**Geometric Brownian Motion.** The random walk Black–Scholes assumes: proportional moves, constant volatility, no jumps, each step independent of the last.",
    why: "Called geometric because moves are proportional to price — a 1% move means the same at 1.05 and at 1.20.",
  },
  {
    id: "parkinson",
    term: "Parkinson estimator",
    symbol: "E[(ln H/L)²] = 4 ln2 · σ²T",
    category: "estimator",
    aliases: ["range estimator", "high low volatility"],
    definition:
      "A 1980 result relating a bar's high-to-low range to the volatility that produced it. About **five times more efficient** than using closing prices, because a range uses the whole path's extremes rather than two endpoints.",
    why: "On a single bar it adds nothing — the constant divides straight back out of any z-score. The content is in the T and in additivity.",
  },
  {
    id: "log-range",
    term: "log range",
    symbol: "ln(H / L)",
    category: "quantity",
    definition:
      "The natural log of a bar's high divided by its low. Used instead of H − L because a ratio is **scale-free**: 0.004 on EURUSD at 1.05 means the same as at 1.20.",
  },
  {
    id: "volatility",
    term: "volatility",
    symbol: "σ (sigma)",
    category: "quantity",
    aliases: ["sigma", "stdev"],
    definition:
      "How much price moves per unit of time, ignoring direction — formally the standard deviation of returns. **Not risk, and not direction**: a market can be violently volatile and go nowhere.",
  },
  {
    id: "path",
    term: "path",
    category: "concept",
    aliases: ["intrabar"],
    definition:
      "The route price actually took inside a bar, minute by minute — as opposed to the four numbers that summarise it. **Two bars can have identical OHLC and completely different paths.**",
    why: "Recovering the path is the whole reason for building candles from one-minute data.",
  },
  {
    id: "rho",
    term: "ρ (rho)",
    symbol: "ln(iv_agg / iv_sum)",
    category: "concept",
    aliases: ["trend efficiency"],
    definition:
      "The log ratio of two estimates of the same variance — one from a window's own high-low box, one from the minutes inside it. **Positive when price trended** through the window, negative when it chopped. Bounded in [−ln w, +ln w].",
    why: "A clock-anchored bar cannot produce it; it kept the box and threw the path away.",
  },
  {
    id: "term-structure",
    term: "term structure",
    category: "concept",
    definition:
      "How a quantity changes as the horizon lengthens. A volatility term structure says whether the next hour is expected to be more or less violent than the next day.",
    why: "A tree can split on two levels but cannot form their difference, so the slope has to be handed to it as its own column.",
  },
  {
    id: "z-score",
    term: "z-score",
    symbol: "(x − μ) / σ",
    category: "transform",
    aliases: ["standardise", "normalize"],
    definition:
      "Subtract the mean, divide by the standard deviation. Answers *how unusual is this, in units of its own typical variation*. **Causal** means both are computed from bars strictly before the one being scored.",
  },
  {
    id: "surrogate",
    term: "surrogate / block shuffle",
    category: "method",
    aliases: ["permutation", "null model"],
    definition:
      "A fake dataset built by scrambling the real one so everything *except* the property under test survives. Bars are permuted in blocks, keeping each bar's own range, shape and volume — **only the order is destroyed.**",
    why: "Whatever the real data does that the surrogate does not is sequence, not marginal distribution.",
  },
  {
    id: "volatility-clustering",
    term: "volatility clustering",
    category: "phenomenon",
    definition:
      "Big moves follow big moves; quiet follows quiet. The **most reliably observed feature of financial prices**, and a direct contradiction of the constant-σ assumption.",
    why: "Shows up as autocorrelation of absolute returns staying positive for hundreds of bars.",
  },
  {
    id: "kurtosis",
    term: "kurtosis",
    category: "statistic",
    aliases: ["fat tails", "excess kurtosis"],
    definition:
      "How much of a distribution's variance comes from rare extreme values rather than ordinary ones. **Excess kurtosis** subtracts 3, so a bell curve reads 0. High excess kurtosis means **fat tails**.",
  },
  {
    id: "skewness",
    term: "skewness",
    category: "statistic",
    definition:
      "Which side the tail is on. Zero for a symmetric distribution; negative means the left tail is longer, so the worst days are worse than the best days are good.",
    why: "A flattering mean and standard deviation can hide a hard one-sided tail. This is the statistic that reveals it.",
  },
  {
    id: "aggregational-gaussianity",
    term: "aggregational Gaussianity",
    category: "phenomenon",
    definition:
      "Returns look more bell-shaped the longer the bar. One-minute returns are wildly fat-tailed; daily returns much less so.",
    why: "It is why risk measured on daily data can look reassuring while the intraday reality is not.",
  },
  {
    id: "acf",
    term: "autocorrelation (ACF)",
    category: "statistic",
    aliases: ["serial correlation", "autocorrelation function"],
    definition:
      "How strongly a series correlates with an earlier copy of itself, at a given lag. **Zero at every lag** means each observation tells you nothing about later ones.",
  },
  {
    id: "variance-ratio",
    term: "variance ratio",
    symbol: "Var(r_q) / (q · Var(r_1))",
    category: "test",
    aliases: ["VR"],
    definition:
      "The variance of a q-bar move divided by q times the variance of a one-bar move. **Exactly 1 if moves are independent**, because variance adds. Above 1 is trending, below is mean-reverting.",
  },
  {
    id: "lo-mackinlay",
    term: "Lo–MacKinlay",
    category: "test",
    definition:
      "The 1988 formulation of the variance-ratio test, with a standard error that stays valid when volatility changes over time.",
    why: "That robustness is essential: the ordinary version rejects on volatility clustering alone and would be re-measuring a different assumption.",
  },
  {
    id: "z-star",
    term: "z*",
    category: "statistic",
    aliases: ["significance"],
    definition:
      "The significance score on a variance ratio — how many standard errors it sits from 1. Scaled by **√n**, so the same departure gets more significant on more data. Past roughly ±2 is conventionally *unlikely to be chance*.",
  },
  {
    id: "har-rv",
    term: "HAR-RV",
    category: "model",
    aliases: ["heterogeneous autoregressive"],
    definition:
      "**Heterogeneous AutoRegressive model of Realised Volatility.** Predicts tomorrow's volatility from averages over roughly a day, a week and a month.",
    why: "Simple, hard to beat, and the external reference every volatility model here is scored against.",
  },
  {
    id: "garch",
    term: "GARCH",
    category: "model",
    definition:
      "**Generalised AutoRegressive Conditional Heteroskedasticity.** A family of models that let σ change over time, driven by recent surprises.",
    why: "Bounds how much of a fat tail a time-varying σ could ever remove. On EURUSD, 4–18%.",
  },
  {
    id: "walk-forward",
    term: "walk-forward validation",
    category: "method",
    aliases: ["WFV", "purge", "embargo"],
    definition:
      "Train on the past, test on the immediate future, roll forward, repeat — never training on data later than the test window. A **purge** gap sits between them so no trailing-window feature can reach across the boundary.",
  },
  {
    id: "block-bootstrap",
    term: "block bootstrap",
    category: "method",
    definition:
      "Estimating uncertainty by resampling the data in **contiguous blocks** rather than one point at a time.",
    why: "Financial series are autocorrelated; resampling single points destroys that and produces intervals far too narrow.",
  },
  {
    id: "confidence-interval",
    term: "confidence interval",
    category: "statistic",
    aliases: ["CI"],
    definition:
      "A range that plausibly contains the true value. If an interval on a difference **crosses zero, the result is a tie** — however good the point estimate looks.",
  },
  {
    id: "p-value",
    term: "p-value",
    category: "statistic",
    definition:
      "The probability of a result at least this extreme if there were genuinely no effect. Small means *hard to explain as luck*.",
    why: "On millions of bars almost anything reaches significance, so always read effect size beside it.",
  },
  {
    id: "symlog",
    term: "symlog scale",
    category: "chart",
    definition:
      "An axis that is linear near zero and logarithmic beyond it. For values spanning several orders of magnitude where small ones still matter — a pure log axis cannot display zero at all.",
  },
  {
    id: "greeks",
    term: "the greeks",
    category: "options",
    aliases: ["delta", "gamma", "vega", "theta"],
    definition:
      "An option's sensitivities — delta to the underlying, gamma to delta, vega to volatility, theta to time. All are derivatives of the Black–Scholes formula, so **all inherit its assumptions**.",
  },
  {
    id: "ohlc",
    term: "OHLC",
    category: "data",
    definition:
      "**Open, High, Low, Close** — the four prices summarising a bar. High and low are what a range estimator reads; open and close are what a close-to-close estimate reads.",
  },
  {
    id: "sigma-move",
    term: "n-sigma move",
    category: "concept",
    definition:
      "A move of n standard deviations. A bell curve makes a 4σ move about a 1-in-16,000 event and a 6σ move about 1-in-500-million.",
    why: "EURUSD delivers them roughly 100× and a million times more often than that.",
  },
  {
    id: "efficiency",
    term: "estimator efficiency",
    category: "statistic",
    definition:
      "How much information an estimator extracts from the same data. A range estimator is ~5× as efficient as close-to-close because it reads the path's extremes.",
    why: "Efficiency collapses as the window grows — a whole day's high and low are still just two prices.",
  },
  {
    id: "scale-free",
    term: "scale-free",
    category: "principle",
    aliases: ["stationary", "normalized"],
    definition:
      "A quantity meaning the same thing regardless of price level or instrument. Ratios and log returns are scale-free; raw prices and raw differences are not.",
    why: "Standing rule: nothing a model sees may be an absolute price level.",
  },
  {
    id: "hurst",
    term: "Hurst exponent",
    symbol: "H",
    category: "statistic",
    definition:
      "How variance grows with horizon. **H = 0.5 is a random walk**; above is persistence (trends extend), below is anti-persistence (moves reverse).",
    why: "Measured 0.479 on EURUSD — very close to a random walk, slightly reverting.",
  },
  {
    id: "sharpe",
    term: "Sharpe ratio",
    symbol: "E[R − Rf] / σ",
    category: "statistic",
    definition:
      "Annualised excess return per unit of volatility. The default single-number score for a strategy.",
    why: "Says nothing about the shape of the losses — read Sortino and Calmar beside it, never alone.",
  },
  {
    id: "sortino",
    term: "Sortino ratio",
    category: "statistic",
    definition:
      "Sharpe with the denominator replaced by **downside deviation only**, so upside volatility stops counting as risk. Better for asymmetric return profiles.",
  },
  {
    id: "calmar",
    term: "Calmar ratio",
    category: "statistic",
    definition:
      "Annualised return divided by maximum drawdown. The tail-risk view: what you earned against the worst peak-to-trough loss along the way.",
  },
  {
    id: "profit-factor",
    term: "profit factor",
    category: "statistic",
    definition:
      "Gross profit divided by gross loss. Above 1 means the winners outweigh the losers in aggregate; it says nothing about how many of each there were.",
  },
  {
    id: "triple-barrier",
    term: "triple-barrier labelling",
    category: "method",
    definition:
      "Label a trade by which of three barriers it hits first: a profit target, a stop, or a time limit. Barriers are set in multiples of the bar's **own trailing volatility**, never fixed pips.",
    why: "A fixed barrier is a different trade in a quiet hour than a violent one, so the label would encode the regime rather than the signal.",
  },
  {
    id: "break-even-spread",
    term: "break-even spread",
    category: "concept",
    definition:
      "The transaction cost at which a strategy's edge is exactly consumed. Net PnL is linear in cost, so it is simply **gross PnL ÷ turnover** — computed exactly, never swept.",
    why: "The number that decides whether a statistically real edge is a tradeable one.",
  },
];
