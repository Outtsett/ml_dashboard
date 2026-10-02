/**
 * Time series — the vocabulary of a sequence, and of returns.
 *
 * SRP: Data only. Merged by `../index.ts`.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  {
    id: "log-return",
    term: "log return",
    symbol: "ln(p_t / p_{t−1})",
    domain: "time-series",
    aliases: ["continuously compounded return"],
    definition:
      "The log of the price ratio. **Additive across time**, so a week's return is the sum of its days, and **symmetric**: +10% then −10% returns exactly to the start, which simple returns do not.",
    why: "A difference is not a return. Use log returns for anything that compounds, diffuses or must treat up and down alike.",
    see: ["simple-return", "volatility-drag", "scale-free"],
  },
  {
    id: "simple-return",
    term: "simple return",
    symbol: "(p_t − p_{t−1}) / p_{t−1}",
    domain: "time-series",
    definition:
      "Percentage change. **Additive across ASSETS** — a portfolio's simple return is the weighted sum of its holdings', which log returns are not.",
    why: "Use simple across a portfolio at one instant, log across time for one asset. Mixing them is a common and silent error.",
    see: ["log-return"],
  },
  {
    id: "scale-free",
    term: "scale-free",
    domain: "time-series",
    aliases: ["normalised", "unit-free"],
    definition:
      "A quantity meaning the same thing regardless of price level or instrument. Ratios and log returns are; raw prices and raw differences are not.",
    why: "A model fitted on 2019 levels does not transfer to 2026 levels. Absolute price answers *where*; log and relative answer *how much*.",
    see: ["log-return", "z-score", "stationarity"],
  },
  {
    id: "z-score",
    term: "z-score",
    symbol: "(x − μ) / σ",
    domain: "time-series",
    aliases: ["standardise", "normalise"],
    definition:
      "Subtract the mean, divide by the standard deviation. Answers *how unusual is this, in units of its own typical variation*.",
    why: "**Causal** means both statistics come from bars strictly before the one being scored. A whole-series mean has seen the future.",
    see: ["causal-window", "scale-free", "winsorize"],
  },
  {
    id: "causal-window",
    term: "causal / trailing window",
    domain: "time-series",
    definition:
      "A rolling statistic using only past and present bars, with `min_periods` equal to the window so warmup rows are null rather than computed from a partial window.",
    why: "A centred window sees the future. Warmup rows must be null, never zero — an unknown is not a value.",
    see: ["z-score", "look-ahead-bias", "rolling-window"],
  },
  {
    id: "rolling-window",
    term: "rolling window",
    domain: "time-series",
    definition:
      "A statistic recomputed over the last N observations at every step. **The window length is a hypothesis about memory**, and is worth measuring rather than inheriting.",
    why: "A bar count means different things at different timeframes. Carry a window in DAYS and convert.",
    see: ["causal-window", "integrated-autocorrelation-time", "ewma-vol"],
  },
  {
    id: "resampling",
    term: "resampling",
    aliases: ["aggregation", "downsampling", "OHLC aggregation"],
    domain: "time-series",
    definition:
      "Building coarser bars from finer ones — open first, high max, low min, close last, volume sum.",
    why: "The clock grid is a convention. Nothing makes the hour starting at midnight more meaningful than the hour ending now.",
    see: ["time-bars", "ohlc", "rolling-window"],
  },
  {
    id: "ohlc",
    term: "OHLC",
    expansion: "Open, High, Low, Close",
    domain: "time-series",
    definition:
      "The four prices summarising a bar. High and low are what a range estimator reads; open and close are what a close-to-close estimate reads.",
    see: ["resampling", "log-range", "path"],
  },
  {
    id: "path",
    term: "path",
    domain: "time-series",
    definition:
      "The route price actually took inside a bar, as opposed to the four numbers summarising it. **Two bars can share identical OHLC and have completely different paths.**",
    why: "Path information is why bars built from one-minute data can say things a clock-anchored bar cannot.",
    see: ["ohlc", "mfe-mae", "intrabar"],
  },
  {
    id: "intrabar",
    term: "intrabar",
    domain: "time-series",
    definition:
      "Anything happening inside a bar's span. **A barrier is reached intrabar, against high and low** — testing against the close alone lets a trade that was stopped out carry on.",
    see: ["path", "triple-barrier", "mfe-mae"],
  },
  {
    id: "time-bars",
    term: "time bars",
    domain: "time-series",
    definition:
      "Bars sampled on the clock. **Oversample dead hours and undersample busy ones**, so their returns are further from normal than any alternative sampling.",
    see: ["volume-bars", "dollar-bars", "tick-bars", "resampling"],
  },
  {
    id: "tick-bars",
    term: "tick bars",
    domain: "time-series",
    definition: "A new bar every N transactions, so sampling follows activity rather than the clock.",
    see: ["time-bars", "volume-bars", "dollar-bars"],
  },
  {
    id: "volume-bars",
    term: "volume bars",
    domain: "time-series",
    definition:
      "A new bar every N units traded. **Returns come closer to i.i.d. and to normal** than clock bars, because information arrives with volume.",
    see: ["dollar-bars", "time-bars", "vpin"],
  },
  {
    id: "dollar-bars",
    term: "dollar bars",
    domain: "time-series",
    definition:
      "A new bar every N of notional traded. Robust to price level changing over years, where volume bars are not.",
    see: ["volume-bars", "tick-bars"],
  },
  {
    id: "imbalance-bars",
    term: "imbalance / run bars",
    domain: "time-series",
    definition:
      "A new bar when signed flow exceeds expectations, so bars form exactly when the market becomes one-sided.",
    see: ["volume-bars", "order-flow-imbalance"],
  },
  {
    id: "autocorrelation",
    term: "autocorrelation",
    expansion: "ACF",
    domain: "time-series",
    aliases: ["serial correlation", "pacf"],
    definition:
      "How strongly a series correlates with an earlier copy of itself at a given lag. **PACF** removes the influence of intervening lags.",
    why: "Returns show almost none; ABSOLUTE returns show a lot. That gap is volatility clustering.",
    see: ["volatility-clustering", "long-memory", "ljung-box"],
  },
  {
    id: "ljung-box",
    term: "Ljung–Box test",
    domain: "time-series",
    definition:
      "Tests whether a group of autocorrelations is jointly zero, rather than testing one lag at a time.",
    see: ["autocorrelation", "white-noise"],
  },
  {
    id: "white-noise",
    term: "white noise",
    domain: "time-series",
    definition:
      "Zero mean, constant variance, no autocorrelation at any lag. **What a model's residuals should look like** if it has extracted everything available.",
    see: ["autocorrelation", "random-walk", "residual"],
  },
  {
    id: "random-walk",
    term: "random walk",
    domain: "time-series",
    definition:
      "Each step independent of the last, so the best forecast of tomorrow is today. **The null every price model must beat**, and it is a hard one.",
    see: ["martingale", "efficient-market", "variance-ratio"],
  },
  {
    id: "martingale",
    term: "martingale",
    domain: "time-series",
    definition:
      "A process whose expected next value, given everything known, equals its current value. **A fair game** — the formal statement of unpredictability.",
    see: ["random-walk", "efficient-market"],
  },
  {
    id: "efficient-market",
    term: "efficient market hypothesis",
    expansion: "EMH",
    domain: "time-series",
    definition:
      "Prices already reflect available information, so returns are unforecastable. **Weak** form uses past prices, **semi-strong** public information, **strong** everything.",
    why: "Not literally true, and close enough to true that the residual is small, fleeting, and expensive to reach.",
    see: ["random-walk", "martingale", "alpha"],
  },
  {
    id: "mean-reversion",
    term: "mean reversion",
    domain: "time-series",
    definition:
      "A tendency to pull back toward a level or a moving average. **Negative autocorrelation** in returns.",
    why: "Reliable at short horizons and in spreads; unreliable in trends, where it is called *catching a falling knife*.",
    see: ["momentum", "ornstein-uhlenbeck", "cointegration", "variance-ratio"],
  },
  {
    id: "momentum",
    term: "momentum",
    domain: "time-series",
    definition:
      "A tendency for moves to continue. **Positive autocorrelation** in returns, and one of the most persistent documented anomalies across assets.",
    see: ["mean-reversion", "variance-ratio", "trend-following"],
  },
  {
    id: "ornstein-uhlenbeck",
    term: "Ornstein–Uhlenbeck process",
    expansion: "OU",
    domain: "time-series",
    definition:
      "The canonical mean-reverting process — pulled toward a long-run level at a speed proportional to its distance from it.",
    why: "Gives a half-life directly, which converts into a holding period.",
    see: ["mean-reversion", "half-life", "cointegration"],
  },
  {
    id: "cointegration",
    term: "cointegration",
    domain: "time-series",
    definition:
      "Two non-stationary series whose particular combination IS stationary. **The formal basis of pairs trading.**",
    why: "Correlation says they move together; cointegration says they cannot drift apart. Only the second supports a spread trade.",
    see: ["stationarity", "mean-reversion", "spread-trade"],
  },
  {
    id: "arima",
    term: "ARIMA",
    expansion: "AutoRegressive Integrated Moving Average",
    domain: "time-series",
    aliases: ["arma", "ar", "ma", "sarima"],
    definition:
      "The classical linear forecasting family: **AR** regresses on past values, **MA** on past errors, **I** differences to reach stationarity.",
    why: "Almost always fits price returns with essentially zero coefficients, which is itself informative.",
    see: ["stationarity", "white-noise", "har-rv"],
  },
  {
    id: "seasonality",
    term: "seasonality",
    domain: "time-series",
    aliases: ["intraday pattern", "time of day", "day of week"],
    definition:
      "Repeating structure tied to the calendar or the clock — the intraday volatility smile, the Monday effect, month-end flows.",
    why: "One sinusoid expresses one peak and one trough per day. FX has three active sessions, so it needs three or four harmonics.",
    see: ["fourier", "session", "deseasonalisation"],
  },
  {
    id: "deseasonalisation",
    term: "deseasonalisation",
    domain: "time-series",
    definition:
      "Removing the repeating time-of-day or day-of-week profile before measuring anything else.",
    why: "Mandatory before estimating memory: on a seasonal series the autocorrelation is a cosine, and a memory estimator locks onto the seasonal half-period instead of the market's.",
    see: ["seasonality", "integrated-autocorrelation-time"],
  },
  {
    id: "fourier",
    term: "Fourier transform",
    aliases: ["fft", "spectral analysis", "periodogram", "harmonic"],
    domain: "time-series",
    definition:
      "Decomposing a series into sine waves. The **periodogram** shows how much power sits at each frequency.",
    why: "Reads the number of harmonics a seasonal profile actually needs, instead of assuming one.",
    see: ["seasonality", "wavelet"],
  },
  {
    id: "wavelet",
    term: "wavelet transform",
    domain: "time-series",
    definition:
      "A decomposition localised in BOTH time and frequency, so it can say *when* a frequency was present — which a Fourier transform cannot.",
    see: ["fourier", "regime-change"],
  },
  {
    id: "regime-change",
    term: "regime change",
    domain: "time-series",
    aliases: ["structural break", "regime shift", "chow test"],
    definition:
      "The data-generating process itself changing — a new volatility level, a new correlation structure, a new policy.",
    why: "The reason a model degrades without any bug. Detected late by construction: you need data from the new regime to see it.",
    see: ["hmm", "drift", "walk-forward"],
  },
  {
    id: "drift-detection",
    term: "drift",
    domain: "time-series",
    aliases: ["concept drift", "covariate shift", "data drift"],
    definition:
      "The live distribution moving away from the training one. **Covariate shift** is the inputs moving; **concept drift** is the input→output relationship moving.",
    why: "The second is fatal and the first is survivable, so it is worth measuring them separately.",
    see: ["regime-change", "wasserstein", "walk-forward"],
  },
  {
    id: "hmm",
    term: "HMM",
    expansion: "Hidden Markov Model",
    domain: "time-series",
    aliases: ["hdp-hmm", "markov switching", "viterbi", "baum welch"],
    definition:
      "A model with an unobserved state that switches over time, each state having its own emission distribution. **The standard tool for labelling market regimes.**",
    why: "State count is a choice that changes the story. An HDP-HMM lets the data pick it.",
    see: ["regime-change", "markov-chain"],
  },
  {
    id: "markov-chain",
    term: "Markov property",
    domain: "time-series",
    definition:
      "The future depends only on the present state, not on the path that reached it. **A strong assumption that is convenient far more often than it is true.**",
    see: ["hmm", "random-walk"],
  },
  {
    id: "gap",
    term: "gap (in a series)",
    domain: "time-series",
    definition:
      "A break in the timestamp sequence — a weekend, a holiday, a minute with no ticks. **Row order is not time order.**",
    why: "A rolling window taken over row index silently spans a weekend. Cut windows on contiguous runs, or count observed bars rather than wall-clock time.",
    see: ["causal-window", "overnight-gap", "resampling"],
  },
  {
    id: "residual",
    term: "residual",
    domain: "time-series",
    definition:
      "What a model failed to explain — actual minus predicted. **Structure left in the residual is signal the model missed.**",
    see: ["white-noise", "r-squared"],
  },
  {
    id: "drift",
    term: "drift (in a process)",
    symbol: "μ",
    domain: "time-series",
    definition:
      "The deterministic trend component of a stochastic process — the expected change per unit time, separate from the random part.",
    why: "Distinct from *data drift*, which is the distribution shifting. Same word, unrelated meanings, and both appear on this dashboard.",
    see: ["gbm", "drift-detection", "random-walk"],
  },
];
