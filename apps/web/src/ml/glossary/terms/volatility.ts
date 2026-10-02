/**
 * Volatility — measuring how much a price moves, and forecasting it.
 *
 * SRP: Data only. Merged by `../index.ts`.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  {
    id: "volatility",
    term: "volatility",
    symbol: "σ",
    domain: "volatility",
    aliases: ["sigma", "vol"],
    definition:
      "How much price moves per unit of time, ignoring direction — formally the standard deviation of returns. **Not risk, and not direction**: a market can be violently volatile and go nowhere.",
    see: ["realised-volatility", "implied-volatility", "variance"],
  },
  {
    id: "realised-volatility",
    term: "realised volatility",
    expansion: "RV",
    domain: "volatility",
    aliases: ["historical volatility", "RV"],
    definition:
      "Volatility measured from what price actually did — the square root of summed squared returns over a window. **Backward-looking by construction.**",
    see: ["implied-volatility", "bipower-variation", "har-rv"],
  },
  {
    id: "implied-volatility",
    term: "implied volatility",
    expansion: "IV",
    domain: "volatility",
    aliases: ["IV"],
    definition:
      "The volatility that makes an option-pricing model reproduce the option's market price. **The market's forecast, read backwards out of a price.**",
    why: "Systematically exceeds subsequent realised volatility — the variance risk premium — because sellers demand payment for tail risk.",
    see: ["realised-volatility", "variance-risk-premium", "volatility-smile"],
  },
  {
    id: "annualisation",
    term: "annualisation",
    symbol: "σ_ann = σ · √(periods per year)",
    domain: "volatility",
    definition:
      "Scaling a per-period volatility to a yearly figure by multiplying by the square root of the number of periods. **Assumes independent increments** — the assumption that makes variance additive.",
    why: "Wrong whenever returns are autocorrelated, which is exactly when it matters most.",
    see: ["variance-additivity", "square-root-of-time"],
  },
  {
    id: "square-root-of-time",
    term: "square-root-of-time rule",
    domain: "volatility",
    definition:
      "Volatility over T periods is σ√T, because variance grows linearly with time and volatility is its square root.",
    why: "Holds exactly for a random walk and approximately otherwise. The measured scaling exponent is a direct test of it.",
    see: ["annualisation", "hurst-exponent", "variance-additivity"],
  },
  {
    id: "variance-additivity",
    term: "variance additivity",
    domain: "volatility",
    definition:
      "For independent increments, the variance of a sum is the sum of the variances. **The single property most volatility arithmetic rests on.**",
    see: ["square-root-of-time", "variance-ratio"],
  },
  {
    id: "parkinson-estimator",
    term: "Parkinson estimator",
    symbol: "E[(ln H/L)²] = 4 ln2 · σ²T",
    domain: "volatility",
    aliases: ["range estimator", "high-low estimator"],
    definition:
      "A 1980 result relating a bar's high-to-low range to the volatility that produced it. **About five times more efficient than close-to-close**, because a range reads the path's extremes rather than two endpoints.",
    why: "On a single bar it adds nothing over the log range — the constant divides out of any z-score. The content is in the T and in additivity.",
    see: ["garman-klass", "rogers-satchell", "log-range", "yang-zhang"],
  },
  {
    id: "garman-klass",
    term: "Garman–Klass estimator",
    domain: "volatility",
    definition:
      "A range estimator using **all four** OHLC prices rather than two. More efficient than Parkinson under the same assumptions.",
    why: "Assumes no drift and no overnight gap; both assumptions are violated at the daily frequency.",
    see: ["parkinson-estimator", "rogers-satchell", "yang-zhang"],
  },
  {
    id: "rogers-satchell",
    term: "Rogers–Satchell estimator",
    domain: "volatility",
    definition:
      "A range estimator that stays unbiased **when the price has drift**, which Parkinson and Garman–Klass do not.",
    see: ["parkinson-estimator", "garman-klass"],
  },
  {
    id: "yang-zhang",
    term: "Yang–Zhang estimator",
    domain: "volatility",
    definition:
      "A range estimator handling **both drift and overnight gaps**, built as a weighted combination of overnight, open-to-close and Rogers–Satchell components.",
    see: ["rogers-satchell", "garman-klass"],
  },
  {
    id: "bipower-variation",
    term: "bipower variation",
    expansion: "BV",
    domain: "volatility",
    definition:
      "A volatility estimate built from products of ADJACENT absolute returns, which makes it **robust to a single jump** — a jump enters only one of the two factors.",
    why: "The difference between realised variance and bipower variation IS the jump component.",
    see: ["realised-volatility", "jump", "jump-ratio"],
  },
  {
    id: "jump-ratio",
    term: "jump ratio",
    symbol: "ln(RV / BV)",
    domain: "volatility",
    definition:
      "The log ratio of a jump-sensitive to a jump-robust variance estimator. **Both carry the same units, so the ratio cancels the instrument's scale** and what is left is the excess from discontinuities.",
    why: "Free of scale but not of time — z-score it like anything else before a model sees it.",
    see: ["bipower-variation", "jump"],
  },
  {
    id: "jump",
    term: "jump",
    domain: "volatility",
    aliases: ["gap", "discontinuity"],
    definition:
      "A price move too large and too fast to be diffusion — a macro release, an overnight gap, a halt reopening. **Breaks the continuous-path assumption every option model makes.**",
    see: ["jump-ratio", "bipower-variation", "overnight-gap"],
  },
  {
    id: "volatility-clustering",
    term: "volatility clustering",
    domain: "volatility",
    definition:
      "Big moves follow big moves; quiet follows quiet. **The most reliably observed feature of financial prices**, and a direct contradiction of constant-σ models.",
    why: "Shows up as autocorrelation of ABSOLUTE returns staying positive for hundreds of bars, while the returns themselves are uncorrelated.",
    see: ["garch", "long-memory", "autocorrelation"],
  },
  {
    id: "leverage-effect",
    term: "leverage effect",
    domain: "volatility",
    definition:
      "Volatility rises more after a fall than after an equal-sized rise. **An asymmetry a symmetric volatility model cannot represent.**",
    see: ["volatility-clustering", "egarch", "skewness"],
  },
  {
    id: "garch",
    term: "GARCH",
    expansion: "Generalised AutoRegressive Conditional Heteroskedasticity",
    domain: "volatility",
    aliases: ["arch", "conditional heteroskedasticity"],
    definition:
      "A family letting σ change over time, driven by recent squared surprises and by its own past. **The standard answer to volatility clustering.**",
    why: "Bounds how much of a fat tail a time-varying σ can remove. On EURUSD, only 4–18% of the 4σ excess.",
    see: ["volatility-clustering", "egarch", "har-rv"],
  },
  {
    id: "egarch",
    term: "EGARCH / GJR-GARCH",
    domain: "volatility",
    definition:
      "GARCH variants with an **asymmetric** response, so a down move raises forecast volatility more than an up move. EGARCH models log-variance, which removes the need for positivity constraints.",
    see: ["garch", "leverage-effect"],
  },
  {
    id: "har-rv",
    term: "HAR-RV",
    expansion: "Heterogeneous AutoRegressive model of Realised Volatility",
    domain: "volatility",
    definition:
      "Predicts tomorrow's volatility from averages over roughly a day, a week and a month — a cascade standing in for traders operating at different horizons.",
    why: "Simple, hard to beat, and the external reference every volatility model here is scored against.",
    see: ["realised-volatility", "long-memory", "garch"],
  },
  {
    id: "long-memory",
    term: "long memory",
    domain: "volatility",
    aliases: ["long range dependence", "fractional integration"],
    definition:
      "Autocorrelation decaying slowly — as a power law rather than exponentially — so influence persists far longer than a short-memory model allows.",
    why: "Volatility has it; returns do not. It is why HAR's three-scale cascade works.",
    see: ["har-rv", "hurst-exponent", "volatility-clustering"],
  },
  {
    id: "hurst-exponent",
    term: "Hurst exponent",
    symbol: "H",
    domain: "volatility",
    definition:
      "How variance grows with horizon. **H = 0.5 is a random walk**; above is persistence (trends extend), below is anti-persistence (moves reverse).",
    why: "Notoriously biased on short samples and sensitive to the estimator used. Report the method beside the number.",
    see: ["long-memory", "square-root-of-time", "variance-ratio"],
  },
  {
    id: "variance-ratio",
    term: "variance ratio",
    symbol: "Var(r_q) / (q · Var(r_1))",
    domain: "volatility",
    aliases: ["VR", "lo mackinlay"],
    definition:
      "The variance of a q-bar move divided by q times the variance of a one-bar move. **Exactly 1 if increments are independent.** Above 1 is trending, below is mean-reverting.",
    why: "The heteroskedasticity-robust version is 1 under ANY pattern of changing volatility, which is what makes it a clean test of independence rather than a re-test of clustering.",
    see: ["variance-additivity", "hurst-exponent", "random-walk"],
  },
  {
    id: "volatility-of-volatility",
    term: "volatility of volatility",
    aliases: ["vol of vol", "vvol"],
    domain: "volatility",
    definition:
      "How much the volatility itself moves. Governs the curvature of the volatility smile and the price of options on volatility.",
    see: ["volatility-smile", "implied-volatility"],
  },
  {
    id: "variance-risk-premium",
    term: "variance risk premium",
    domain: "volatility",
    definition:
      "The gap between implied and subsequently realised variance. **Persistently positive** — option sellers are paid for carrying tail risk.",
    why: "A real and well-documented premium that is also a short-volatility position: it pays steadily and loses catastrophically.",
    see: ["implied-volatility", "realised-volatility"],
  },
  {
    id: "volatility-smile",
    term: "volatility smile / skew",
    domain: "volatility",
    definition:
      "Implied volatility varying by strike instead of being flat. **Direct market evidence that Black–Scholes' constant-σ assumption is false** — if it were true the line would be flat.",
    see: ["implied-volatility", "black-scholes", "fat-tail"],
  },
  {
    id: "term-structure-vol",
    term: "volatility term structure",
    domain: "volatility",
    definition:
      "How expected volatility varies with horizon. Usually upward-sloping in calm markets and inverted in a crisis, when near-term fear exceeds long-term.",
    why: "A tree can split on two levels but cannot form their difference, so the slope must be handed to it as its own feature.",
    see: ["implied-volatility", "har-rv"],
  },
  {
    id: "log-range",
    term: "log range",
    symbol: "ln(H / L)",
    domain: "volatility",
    definition:
      "The natural log of a bar's high over its low. Used instead of H − L because a ratio is **scale-free**: 0.004 means the same at 1.05 and at 1.20.",
    see: ["parkinson-estimator", "true-range", "scale-free"],
  },
  {
    id: "true-range",
    term: "True Range / ATR",
    expansion: "Average True Range",
    domain: "volatility",
    definition:
      "The greatest of: high−low, |high−previous close|, |low−previous close|. **Includes the overnight gap**, which a plain range does not. ATR is its moving average.",
    see: ["log-range", "overnight-gap", "atr-stop"],
  },
  {
    id: "ewma-vol",
    term: "EWMA volatility",
    expansion: "Exponentially Weighted Moving Average",
    domain: "volatility",
    definition:
      "Volatility as an exponentially decaying average of squared returns, so recent observations weigh more. **RiskMetrics' λ = 0.94** is the classic daily setting.",
    why: "A GARCH(1,1) with the persistence constrained to 1 — simpler, and usually almost as good.",
    see: ["garch", "realised-volatility", "half-life"],
  },
  {
    id: "half-life",
    term: "half-life",
    domain: "volatility",
    definition:
      "How long a shock takes to decay to half its size. Converts a decay coefficient into a number of bars you can reason about.",
    see: ["ewma-vol", "mean-reversion", "integrated-autocorrelation-time"],
  },
  {
    id: "integrated-autocorrelation-time",
    term: "integrated autocorrelation time",
    symbol: "τ_int",
    domain: "volatility",
    definition:
      "The effective memory of a series — the summed autocorrelation, truncated where it stops being informative (**Sokal's windowing**).",
    why: "Measured on a seasonal series it locks onto the seasonal half-period and reads whatever the truncation happens to hit. Deseasonalise first.",
    see: ["long-memory", "autocorrelation", "seasonality"],
  },
  {
    id: "vix",
    term: "VIX",
    domain: "volatility",
    aliases: ["fear index", "volatility index"],
    definition:
      "The 30-day implied volatility of S&P 500 options, from a model-free strip of strikes. **Not a forecast of direction** — it rises in both crashes and melt-ups, but far more in crashes.",
    see: ["implied-volatility", "variance-risk-premium"],
  },
  {
    id: "realised-kernel",
    term: "realised kernel",
    domain: "volatility",
    definition:
      "A realised-variance estimator that corrects for microstructure noise by weighting autocovariances, so it stays usable at high sampling frequencies.",
    why: "Naively summing squared 1-second returns measures the bid–ask bounce, not volatility.",
    see: ["realised-volatility", "microstructure-noise", "signature-plot"],
  },
  {
    id: "signature-plot",
    term: "volatility signature plot",
    domain: "volatility",
    definition:
      "Realised volatility plotted against sampling frequency. **Explodes at high frequency when microstructure noise dominates**, and the point where it flattens tells you the finest usable sampling interval.",
    see: ["microstructure-noise", "realised-kernel"],
  },
  {
    id: "lo-mackinlay",
    term: "Lo–MacKinlay test",
    domain: "volatility",
    aliases: ["variance ratio test", "lo mackinlay 1988"],
    definition:
      "The 1988 formulation of the variance-ratio test, with a standard error that stays valid **when volatility changes over time**.",
    why: "That robustness is the whole point: the homoskedastic version rejects on volatility clustering alone, so it would be re-measuring a different assumption rather than testing independence.",
    see: ["variance-ratio", "z-star", "volatility-clustering"],
  },
  {
    id: "z-star",
    term: "z*",
    symbol: "z* = √(nq)·(VR − 1) / √θ*",
    domain: "volatility",
    aliases: ["z star", "heteroskedasticity-robust z"],
    definition:
      "The significance score on a variance ratio — how many robust standard errors it sits from 1. **Scaled by √n**, so a fixed departure becomes more significant on more data. Beyond roughly ±2 is conventionally *unlikely to be chance*.",
    why: "A missing or extra factor of n cancels that scaling and pins z* near zero regardless of how far VR sits from 1 — which reads as *random walk confirmed* on data that is nothing of the sort.",
    see: ["variance-ratio", "lo-mackinlay", "t-statistic", "standard-error"],
  },
];
