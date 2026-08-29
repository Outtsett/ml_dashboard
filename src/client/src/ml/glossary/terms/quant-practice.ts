/**
 * Practice — portfolio, execution, backtesting, labelling and running infrastructure.
 *
 * SRP: Data only. Merged by `../index.ts`.
 *
 * These five domains were the thinnest after the first passes. This file fills
 * them rather than creating new ones, so the taxonomy stays the same and only
 * the depth changes.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  // ── Portfolio ──────────────────────────────────────────────────────────
  {
    id: "sizing-vs-signal",
    term: "signal vs sizing",
    domain: "portfolio",
    definition:
      "**The signal says which way; the sizing says how much.** Two strategies with the same entries and different sizing have different return distributions, different drawdowns and different survival odds.",
    why: "Most of the improvement available to a mediocre signal is in the sizing, not in a better signal.",
    see: ["position-sizing", "meta-labelling", "kelly-criterion"],
  },
  {
    id: "gross-net-exposure",
    term: "gross vs net exposure",
    domain: "portfolio",
    definition:
      "**Gross** is the sum of absolute position sizes — how much is at work. **Net** is the signed sum — how directional you are. A market-neutral book runs high gross and near-zero net.",
    see: ["leverage", "long-short", "notional"],
  },
  {
    id: "factor-exposure",
    term: "factor exposure",
    domain: "portfolio",
    definition:
      "How much of a portfolio's return is explained by a known common driver rather than by anything specific to it.",
    why: "An unintended exposure is the usual explanation for a strategy that works until the factor turns.",
    see: ["factor-model", "beta", "alpha"],
  },
  {
    id: "capacity-decay",
    term: "capacity decay",
    domain: "portfolio",
    definition:
      "Returns falling as assets grow, because impact scales with size while the edge does not.",
    why: "A strategy's Sharpe at £1m and at £100m are different numbers, and the backtest reports the first.",
    see: ["capacity", "market-impact", "adv"],
  },
  {
    id: "crowding",
    term: "crowding",
    domain: "portfolio",
    definition:
      "Many participants holding the same position, so the exit is narrow. **Raises correlation and impact exactly when everyone needs to leave.**",
    see: ["correlation-breakdown", "liquidity-risk", "capacity-decay"],
  },
  {
    id: "portfolio-turnover-cost",
    term: "cost-aware optimisation",
    domain: "portfolio",
    definition:
      "Including transaction cost in the objective, so the optimiser only trades when the expected improvement exceeds the cost of getting there.",
    why: "Without it a mean-variance optimiser rebalances constantly and hands the edge to the broker.",
    see: ["mean-variance", "turnover", "rebalancing"],
  },
  {
    id: "no-trade-band",
    term: "no-trade band",
    domain: "portfolio",
    definition:
      "A tolerance around the target weight inside which nothing is traded. **The simplest and most effective turnover control there is.**",
    see: ["rebalancing", "turnover", "portfolio-turnover-cost"],
  },
  {
    id: "risk-budget",
    term: "risk budget",
    domain: "portfolio",
    definition:
      "Allocating a fixed quantity of RISK — variance, VaR or drawdown tolerance — across strategies, rather than allocating capital.",
    see: ["risk-parity", "var", "diversification"],
  },

  // ── Execution ──────────────────────────────────────────────────────────
  {
    id: "order-lifecycle",
    term: "order lifecycle",
    domain: "execution",
    aliases: ["new", "acknowledged", "partial fill", "cancelled", "rejected"],
    definition:
      "New → acknowledged → partially filled → filled, cancelled or rejected. **Every state needs handling**; a rejected order that the system believes is live is a position you do not have.",
    see: ["order-type", "fill", "reconciliation"],
  },
  {
    id: "child-parent-order",
    term: "parent & child orders",
    domain: "execution",
    definition:
      "A large **parent** order sliced into small **child** orders sent over time, so the market sees a trickle rather than a block.",
    see: ["twap-vwap", "participation-rate", "market-impact"],
  },
  {
    id: "queue-position",
    term: "queue position",
    domain: "execution",
    definition:
      "Where a resting limit order sits in the price-time priority at its level. **Earlier means filled sooner and against less adverse flow.**",
    why: "Cancelling and replacing loses the queue position, which is why a marginally better price is often not worth the re-post.",
    see: ["order-book", "maker-taker", "adverse-selection"],
  },
  {
    id: "fill-ratio",
    term: "fill ratio",
    domain: "execution",
    definition:
      "The share of a passive order actually executed. **Low fill ratio plus good average price usually means adverse selection** — you were filled precisely when the price was about to move against you.",
    see: ["adverse-selection", "queue-position", "maker-taker"],
  },
  {
    id: "iceberg",
    term: "iceberg / hidden order",
    domain: "execution",
    definition:
      "An order showing only part of its size to the book, replenishing as it fills. **Hides intent at the cost of queue priority on the hidden part.**",
    see: ["order-book", "queue-position", "market-impact"],
  },
  {
    id: "slippage-decomposition",
    term: "slippage decomposition",
    domain: "execution",
    definition:
      "Splitting realised cost into its parts: **spread** paid, **delay** between decision and send, **impact** from your own size, and **timing** from the market moving meanwhile.",
    why: "Each part has a different fix. Reporting one number tells you nothing about which to work on.",
    see: ["slippage", "implementation-shortfall", "transaction-cost"],
  },
  {
    id: "order-throttle",
    term: "rate limits & throttling",
    domain: "execution",
    definition:
      "Caps on messages per second imposed by the venue, and the client-side pacing that keeps you under them.",
    why: "Breaching them gets you disconnected, usually while you have positions on.",
    see: ["kill-switch", "backpressure", "latency"],
  },
  {
    id: "position-reconciliation",
    term: "position reconciliation",
    domain: "execution",
    definition:
      "Comparing what your system thinks it holds against what the broker says. **Run continuously, not at end of day.**",
    why: "A divergence means either a missed fill or a phantom one, and both compound while unnoticed.",
    see: ["reconciliation", "order-lifecycle", "audit-trail"],
  },

  // ── Backtesting ────────────────────────────────────────────────────────
  {
    id: "point-in-time-universe",
    term: "point-in-time universe",
    domain: "backtesting",
    definition:
      "The set of instruments tradeable **as of** each historical date — not today's list applied backwards.",
    why: "Using today's universe is survivorship bias in its purest form: everything that failed has already been removed.",
    see: ["selection-bias", "point-in-time", "look-ahead-bias"],
  },
  {
    id: "warmup-period",
    term: "warmup period",
    domain: "backtesting",
    definition:
      "The bars at the start where trailing features are not yet defined. **Must be null and dropped, not zero-filled** — a zero is a claim that the value is average.",
    see: ["causal-window", "rolling-window", "leakage"],
  },
  {
    id: "signal-lag",
    term: "signal lag",
    domain: "backtesting",
    definition:
      "The deliberate delay between a signal being computed and being acted on, reflecting the fact that you cannot trade a bar's close using that bar's close.",
    why: "Removing one bar of lag is the single most common way a backtest gains a Sharpe point that does not exist.",
    see: ["look-ahead-bias", "fill", "latency-budget"],
  },
  {
    id: "sensitivity-analysis",
    term: "parameter sensitivity",
    domain: "backtesting",
    definition:
      "How the result changes as a parameter moves. **A sharp peak is a fitted artifact; a broad plateau is a real effect.**",
    why: "More informative than the best number, because it says whether the number would survive a different sample.",
    see: ["backtest-overfitting", "hpo", "pbo"],
  },
  {
    id: "negative-control",
    term: "negative control",
    domain: "backtesting",
    definition:
      "Running the identical pipeline on data where you know the answer is nothing — shuffled labels, a synthetic random walk, a permuted feature.",
    why: "If it still produces an edge, the pipeline has a leak. **The cheapest bug-finder in research**, and the most skipped.",
    see: ["surrogate", "leakage", "permutation-test"],
  },
  {
    id: "seed-stability",
    term: "seed stability",
    domain: "backtesting",
    definition:
      "How much the result moves across random seeds. **A strategy whose Sharpe swings with the seed has not been measured**, only sampled once.",
    see: ["seed", "confidence-interval", "monte-carlo-backtest"],
  },
  {
    id: "trade-log",
    term: "trade log",
    domain: "backtesting",
    definition:
      "The per-trade record — entry, exit, size, reason, cost, MFE and MAE. **Where every aggregate number becomes checkable.**",
    why: "An equity curve can hide one trade carrying the whole result. A trade log cannot.",
    see: ["mfe-mae", "equity-curve", "expectancy"],
  },
  {
    id: "regime-holdout",
    term: "regime holdout",
    domain: "backtesting",
    definition:
      "Sealing an entire market regime — a crisis, a rate cycle — rather than a contiguous slice of time, and testing on it.",
    why: "A chronological split can hand you a test period that looks exactly like training. This one deliberately does not.",
    see: ["regime-change", "in-sample", "regime-conditioned-backtest"],
  },

  // ── Labels ─────────────────────────────────────────────────────────────
  {
    id: "label-balance",
    term: "label balance",
    domain: "labels",
    definition:
      "The share of each class a labelling scheme produces. **Often decided by the scheme's own parameters rather than by the market** — a 2:1 barrier gives about one third positives on a driftless walk.",
    why: "So a measured positive share is only informative against the value the scheme itself implies.",
    see: ["gamblers-ruin", "base-rate", "triple-barrier"],
  },
  {
    id: "label-noise",
    term: "label noise",
    domain: "labels",
    definition:
      "Labels that are wrong or arbitrary — a barrier missed by one tick, a horizon that ends mid-move. **Caps achievable accuracy** regardless of the model.",
    see: ["triple-barrier", "sample-weight-label", "bias-variance"],
  },
  {
    id: "path-dependent-label",
    term: "path-dependent label",
    domain: "labels",
    definition:
      "A label whose value depends on the route, not just the endpoints — anything involving a barrier, a maximum, or a stop.",
    why: "Requires intrabar data to compute honestly. Approximating it from closes is the single most common labelling error.",
    see: ["intrabar", "triple-barrier", "path"],
  },
  {
    id: "horizon-selection",
    term: "horizon selection",
    domain: "labels",
    definition:
      "Choosing how far ahead to predict. **Sets the label, the purge width, the overlap and the holding period simultaneously** — it is not a tuning knob, it is a specification of the strategy.",
    see: ["label-horizon", "purging", "trend-scanning"],
  },
  {
    id: "vertical-barrier",
    term: "vertical barrier",
    domain: "labels",
    definition:
      "The time limit in a triple-barrier scheme — what happens when neither price barrier is touched.",
    why: "Worth separating a clock expiry from a data gap: `max_bars` controls the first and cannot control the second, and merging them misreads how often the limit actually binds.",
    see: ["triple-barrier", "gap", "label-horizon"],
  },
  {
    id: "label-leakage",
    term: "label leakage",
    domain: "labels",
    definition:
      "A feature carrying information from the label's own future window. **Subtler than look-ahead**: the feature is causal at time t, but its horizon overlaps the label's.",
    see: ["purging", "leakage", "overlapping-samples"],
  },

  // ── Infrastructure ─────────────────────────────────────────────────────
  {
    id: "idempotent-consumer",
    term: "idempotent consumer",
    domain: "infrastructure",
    definition:
      "A handler that produces the same result whether a message arrives once or five times, usually by recording the message id it already processed.",
    why: "What turns at-least-once delivery into exactly-once in practice.",
    see: ["delivery-guarantees", "idempotency-key", "retry"],
  },
  {
    id: "graceful-shutdown",
    term: "graceful shutdown",
    domain: "infrastructure",
    definition:
      "Finishing in-flight work, flushing buffers and releasing resources before exiting, rather than dying mid-write.",
    why: "A process holding a socket, a pool and a spawned child takes time to release them — long enough for an immediate restart to hit a port that is still bound.",
    see: ["backpressure", "observability"],
  },
  {
    id: "health-check",
    term: "health check & readiness",
    domain: "infrastructure",
    definition:
      "**Liveness** says the process is running; **readiness** says it can actually serve. They are different, and conflating them restarts a service that was merely warming up.",
    see: ["observability", "circuit-breaker-sw"],
  },
  {
    id: "structured-logging",
    term: "structured logging",
    domain: "infrastructure",
    definition:
      "Emitting logs as machine-readable records with consistent fields rather than free text, so they can be filtered and aggregated.",
    why: "A stack trace buried in a megabyte of unstructured output is the same as no stack trace.",
    see: ["observability", "audit-trail"],
  },
  {
    id: "metric-cardinality",
    term: "metric cardinality",
    domain: "infrastructure",
    definition:
      "The number of distinct label combinations on a metric. **Tagging by order id creates a new time series per order** and takes the metrics backend down.",
    see: ["observability", "structured-logging"],
  },
  {
    id: "connection-pool",
    term: "connection pool",
    domain: "infrastructure",
    definition:
      "A reusable set of open database connections, since opening one per query costs more than the query.",
    why: "Pool exhaustion presents as latency, not as an error, which is what makes it hard to spot.",
    see: ["backpressure", "latency"],
  },
  {
    id: "file-watcher",
    term: "file watching & hot reload",
    domain: "infrastructure",
    definition:
      "Restarting or re-importing when a source file changes, so development does not need a manual restart.",
    why: "Races anything that rewrites many files at once — a git stash, a branch switch, a bulk format. The watcher restarts into a half-written tree, fails, and may park rather than retry.",
    see: ["graceful-shutdown", "observability"],
  },
  {
    id: "port-binding",
    term: "port binding & EADDRINUSE",
    domain: "infrastructure",
    definition:
      "Only one process may listen on a port. **A restart that races the old process's shutdown hits this**, and the usual fix is either a wait or SO_REUSEADDR.",
    see: ["graceful-shutdown", "health-check"],
  },
  {
    id: "duration",
    term: "holding period / duration",
    domain: "portfolio",
    definition:
      "How long a position is held. **Determines almost everything downstream**: the label horizon, the turnover, the cost per unit of edge, and how much capacity the strategy has.",
    why: "In fixed income the same word means something else — the price sensitivity of a bond to rates, and the weighted average time to its cash flows.",
    see: ["turnover", "label-horizon", "capacity", "hazard-rate"],
  },
];
