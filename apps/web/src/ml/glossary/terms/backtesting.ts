/**
 * Backtesting, execution and portfolio — from a signal to a filled order.
 *
 * SRP: Data only. Merged by `../index.ts`.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  // ── Backtesting ────────────────────────────────────────────────────────
  {
    id: "backtest",
    term: "backtest",
    domain: "backtesting",
    definition:
      "Simulating a strategy on historical data. **A necessary condition and nowhere near a sufficient one** — it is very easy to produce a good one by accident.",
    see: ["backtest-overfitting", "walk-forward", "paper-trading"],
  },
  {
    id: "in-sample",
    term: "in-sample / out-of-sample",
    aliases: ["IS", "OOS", "holdout"],
    domain: "backtesting",
    definition:
      "**In-sample** is what you fitted and tuned on; **out-of-sample** is data the process has never seen in any form.",
    why: "Touched once, at the end, for the reported number. Look at it twice and it is in-sample.",
    see: ["train-val-test", "backtest-overfitting", "walk-forward"],
  },
  {
    id: "paper-trading",
    term: "paper trading",
    aliases: ["forward test", "shadow mode"],
    domain: "backtesting",
    definition:
      "Running live on real prices without real money. **The only test that includes latency, feed quirks and your own operational mistakes.**",
    see: ["backtest", "training-serving-skew"],
  },
  {
    id: "event-driven-backtest",
    term: "event-driven backtest",
    domain: "backtesting",
    definition:
      "Replaying the data as a stream of events, so the engine can only ever see what was available at that instant.",
    why: "Structurally resistant to look-ahead in a way a vectorised backtest is not — but far slower.",
    see: ["vectorised-backtest", "look-ahead-bias"],
  },
  {
    id: "vectorised-backtest",
    term: "vectorised backtest",
    domain: "backtesting",
    definition:
      "Computing signals and returns as whole-array operations. **Fast, and it makes look-ahead a one-character mistake** — a shift in the wrong direction.",
    see: ["event-driven-backtest", "look-ahead-bias"],
  },
  {
    id: "fill",
    term: "fill assumption",
    domain: "backtesting",
    definition:
      "What price the simulator assumes you got. **Filling at the signal bar's close is optimistic**; the realistic assumption is the next bar's open plus slippage.",
    why: "A stop filled exactly at its trigger assumes a liquid market at the worst moment, which is when liquidity is thinnest.",
    see: ["slippage", "stop-loss", "backtest"],
  },
  {
    id: "commission",
    term: "commission / fees",
    domain: "backtesting",
    definition:
      "Explicit per-trade cost. **The easiest cost to model and usually the smallest** — spread and impact dominate.",
    see: ["transaction-cost", "spread"],
  },
  {
    id: "cost-model",
    term: "cost model",
    domain: "backtesting",
    definition:
      "The assumed schedule of spread, commission, slippage and financing applied in a backtest.",
    why: "Net PnL is linear in cost, so the break-even cost can be computed exactly rather than swept.",
    see: ["break-even-spread", "transaction-cost"],
  },
  {
    id: "equity-curve",
    term: "equity curve",
    domain: "backtesting",
    definition:
      "Cumulative P&L through time. **Read its shape, not its endpoint** — a smooth curve and a jagged one with the same total are different strategies.",
    see: ["underwater-curve", "max-drawdown"],
  },
  {
    id: "monte-carlo-backtest",
    term: "Monte Carlo on trades",
    domain: "backtesting",
    definition:
      "Reshuffling or resampling the realised trade sequence to see how much of the equity curve's shape was ordering luck.",
    see: ["block-bootstrap", "max-drawdown"],
  },
  {
    id: "regime-conditioned-backtest",
    term: "regime-conditioned evaluation",
    domain: "backtesting",
    definition:
      "Scoring separately by volatility bucket, session or market state, instead of pooling everything into one number.",
    why: "A pooled Sharpe can hide a strategy that only ever worked in one regime that has ended.",
    see: ["regime-change", "session", "simpson-paradox"],
  },

  // ── Execution ──────────────────────────────────────────────────────────
  {
    id: "order-type",
    term: "order type",
    aliases: ["market order", "limit order", "stop order", "ioc", "fok"],
    domain: "execution",
    definition:
      "**Market** takes liquidity now at whatever price; **limit** rests and may never fill; **stop** becomes a market order once triggered.",
    see: ["maker-taker", "fill", "slippage"],
  },
  {
    id: "maker-taker",
    term: "maker / taker",
    domain: "execution",
    definition:
      "**Makers** post resting liquidity and are often rebated; **takers** cross the spread and pay. The difference is a real component of net cost.",
    see: ["order-type", "spread", "transaction-cost"],
  },
  {
    id: "twap-vwap",
    term: "TWAP / VWAP",
    expansion: "Time- / Volume-Weighted Average Price",
    domain: "execution",
    definition:
      "Execution algorithms slicing a large order over time or in proportion to volume, to reduce impact and to be benchmarked against the day's average.",
    see: ["market-impact", "participation-rate", "arrival-price"],
  },
  {
    id: "participation-rate",
    term: "participation rate",
    domain: "execution",
    definition:
      "Your share of traded volume while working an order. **Higher participation means more impact**, roughly with its square root.",
    see: ["market-impact", "twap-vwap", "adv"],
  },
  {
    id: "arrival-price",
    term: "arrival price",
    domain: "execution",
    definition:
      "The market price at the moment the order was released — the benchmark implementation shortfall measures against.",
    see: ["implementation-shortfall", "twap-vwap"],
  },
  {
    id: "latency",
    term: "latency",
    domain: "execution",
    aliases: ["tick to trade", "round trip"],
    definition:
      "Time from an event occurring to your order reaching the venue. **The whole game in market making, and irrelevant at daily horizons.**",
    see: ["slippage", "co-location"],
  },
  {
    id: "co-location",
    term: "co-location",
    domain: "execution",
    definition:
      "Placing your machine in the exchange's data centre to cut latency to microseconds.",
    see: ["latency"],
  },
  {
    id: "smart-order-routing",
    term: "smart order routing",
    expansion: "SOR",
    domain: "execution",
    definition:
      "Splitting an order across venues to find the best combination of price, size and fee.",
    see: ["order-type", "maker-taker"],
  },
  {
    id: "kill-switch",
    term: "kill switch",
    domain: "execution",
    definition:
      "An automated halt on breach of a loss, position or rate limit. **The last line of defence against a broken model.**",
    see: ["risk-of-ruin", "drawdown-control"],
  },

  // ── Portfolio ──────────────────────────────────────────────────────────
  {
    id: "alpha",
    term: "alpha",
    symbol: "α",
    domain: "portfolio",
    definition:
      "Return not explained by exposure to known risk factors. **What is left after beta is stripped out** — and it shrinks as more factors are identified.",
    see: ["beta", "factor-model", "information-ratio"],
  },
  {
    id: "beta",
    term: "beta",
    symbol: "β",
    domain: "portfolio",
    definition:
      "Sensitivity to a benchmark or factor. **Cheap and available to anyone**, which is why it is not alpha.",
    see: ["alpha", "factor-model", "hedge-ratio"],
  },
  {
    id: "factor-model",
    term: "factor model",
    aliases: ["fama french", "apt", "capm", "barra"],
    domain: "portfolio",
    definition:
      "Explaining returns as exposures to a few common drivers — market, size, value, momentum, quality — plus a residual.",
    why: "Most apparent alpha turns out to be a factor exposure once the factor is named.",
    see: ["alpha", "beta", "pca"],
  },
  {
    id: "long-short",
    term: "long/short & market neutral",
    domain: "portfolio",
    definition:
      "Holding longs and shorts so directional exposure cancels, leaving the relative view. **Market neutral** targets zero net beta.",
    see: ["beta", "hedge-ratio", "spread-trade"],
  },
  {
    id: "hedge-ratio",
    term: "hedge ratio",
    domain: "portfolio",
    definition:
      "How much of the hedging instrument offsets the exposure. Estimated by regression, and unstable exactly when it matters.",
    see: ["beta", "long-short", "cointegration"],
  },
  {
    id: "spread-trade",
    term: "spread / pairs trade",
    domain: "portfolio",
    definition:
      "Trading the difference between two related instruments rather than either outright, on the view that the difference mean-reverts.",
    why: "Needs cointegration, not correlation. Correlated assets can drift apart forever.",
    see: ["cointegration", "mean-reversion", "long-short"],
  },
  {
    id: "rebalancing",
    term: "rebalancing",
    domain: "portfolio",
    definition:
      "Trading back to target weights as prices drift. **A cost, and a source of return** — periodic rebalancing harvests mean reversion mechanically.",
    see: ["turnover", "transaction-cost"],
  },
  {
    id: "mean-variance",
    term: "mean–variance optimisation",
    aliases: ["markowitz", "efficient frontier"],
    domain: "portfolio",
    definition:
      "Choosing weights to maximise return per unit of variance, given expected returns and a covariance matrix.",
    why: "Notoriously unstable: tiny changes in expected returns produce wildly different weights, so practitioners constrain it heavily.",
    see: ["covariance-matrix", "shrinkage", "risk-parity"],
  },
  {
    id: "trend-following",
    term: "trend following",
    aliases: ["managed futures", "cta"],
    domain: "portfolio",
    definition:
      "Buying what has risen and selling what has fallen, across many markets. **A long-volatility profile**: many small losses and rare large gains.",
    see: ["momentum", "diversification", "breadth"],
  },
];
