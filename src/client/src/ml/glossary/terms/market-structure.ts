/**
 * Market structure & microstructure — how a price is actually made.
 *
 * SRP: Data only. Merged by `../index.ts`.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  // ── The book ───────────────────────────────────────────────────────────
  {
    id: "bid-ask",
    term: "bid / ask",
    domain: "microstructure",
    aliases: ["offer", "two-way price"],
    definition:
      "The best price someone will buy at (**bid**) and sell at (**ask**). You buy at the ask and sell at the bid, so a round trip starts underwater by the spread.",
    see: ["spread", "mid-price", "order-book"],
  },
  {
    id: "spread",
    term: "spread",
    domain: "microstructure",
    definition:
      "Ask minus bid. **The most fundamental transaction cost**, and the number every intraday edge has to clear before it is worth anything.",
    why: "EURUSD retail is roughly 0.6–1.0 pips, institutional 0.1–0.2. An edge worth 0.02 pips is not a strategy.",
    see: ["bid-ask", "transaction-cost", "break-even-spread"],
  },
  {
    id: "mid-price",
    term: "mid price",
    domain: "microstructure",
    definition:
      "The average of bid and ask. **A price nobody can trade at** — convenient for marking and misleading for backtesting.",
    see: ["bid-ask", "microprice"],
  },
  {
    id: "microprice",
    term: "microprice",
    domain: "microstructure",
    definition:
      "The mid weighted by size on each side, so a book with heavy bids sits nearer the ask. **A better short-horizon predictor of the next trade than the mid.**",
    see: ["mid-price", "order-book-imbalance"],
  },
  {
    id: "order-book",
    term: "order book",
    aliases: ["limit order book", "LOB", "depth of market", "DOM", "level 2"],
    domain: "microstructure",
    definition:
      "Every resting limit order, by price level. **Level 1** is the best bid and ask; **Level 2** shows depth behind them.",
    see: ["bid-ask", "market-depth", "order-book-imbalance"],
  },
  {
    id: "market-depth",
    term: "market depth",
    domain: "microstructure",
    definition:
      "How much size sits at and behind the touch. Determines how far a given order pushes the price.",
    see: ["order-book", "market-impact", "liquidity-risk"],
  },
  {
    id: "order-book-imbalance",
    term: "order book imbalance",
    expansion: "OBI",
    domain: "microstructure",
    definition:
      "Bid size relative to ask size at the touch. **One of the few genuinely predictive microstructure signals** — and it decays in seconds.",
    see: ["microprice", "order-book", "order-flow-imbalance"],
  },
  {
    id: "order-flow-imbalance",
    term: "order flow imbalance",
    expansion: "OFI",
    domain: "microstructure",
    definition:
      "Net signed volume — buys lifting the offer minus sells hitting the bid. **Measures pressure that has already been exerted**, where OBI measures pressure resting.",
    see: ["order-book-imbalance", "tick-rule", "vpin"],
  },
  {
    id: "tick-rule",
    term: "tick rule / Lee–Ready",
    domain: "microstructure",
    definition:
      "Inferring whether a trade was buyer- or seller-initiated from whether it printed above or below the prevailing mid, when the tape does not say.",
    see: ["order-flow-imbalance", "trade-classification"],
  },
  {
    id: "trade-classification",
    term: "trade classification",
    domain: "microstructure",
    definition:
      "Labelling prints as buys or sells. Wrong maybe 10–20% of the time by any rule, which propagates into every flow-based feature built on top.",
    see: ["tick-rule", "order-flow-imbalance"],
  },
  {
    id: "vpin",
    term: "VPIN",
    expansion: "Volume-Synchronised Probability of Informed Trading",
    domain: "microstructure",
    definition:
      "Order-flow toxicity measured in volume time rather than clock time — how one-sided flow has been per unit of volume.",
    see: ["order-flow-imbalance", "adverse-selection", "volume-bars"],
  },
  {
    id: "adverse-selection",
    term: "adverse selection",
    domain: "microstructure",
    definition:
      "Getting filled precisely because the other side knew something. **The market maker's central risk**, and the reason spreads exist at all.",
    see: ["spread", "vpin", "market-maker"],
  },
  {
    id: "market-maker",
    term: "market maker",
    domain: "microstructure",
    definition:
      "A participant quoting both sides continuously, earning the spread and managing inventory. **Profits from flow, not from direction.**",
    see: ["spread", "adverse-selection", "inventory-risk"],
  },
  {
    id: "inventory-risk",
    term: "inventory risk",
    domain: "microstructure",
    definition:
      "A market maker's exposure from holding an unwanted position accumulated by quoting. Managed by skewing quotes to attract the offsetting side.",
    see: ["market-maker", "adverse-selection"],
  },
  {
    id: "microstructure-noise",
    term: "microstructure noise",
    domain: "microstructure",
    aliases: ["bid ask bounce"],
    definition:
      "High-frequency price variation that is mechanics rather than information — the price bouncing between bid and ask as trades alternate side.",
    why: "Makes realised volatility explode as sampling frequency rises. It is measuring the bounce, not the market.",
    see: ["signature-plot", "realised-kernel", "spread"],
  },
  {
    id: "market-impact",
    term: "market impact",
    domain: "microstructure",
    definition:
      "How much your own order moves the price against you. **Roughly proportional to the square root of size** relative to daily volume.",
    why: "The cost that makes a strategy uninvestable at scale even when it works small.",
    see: ["slippage", "adv", "participation-rate"],
  },
  {
    id: "slippage",
    term: "slippage",
    domain: "execution",
    definition:
      "The gap between the price you expected and the price you got. Impact plus latency plus the spread you crossed.",
    why: "A backtest filling at the bar's close, or a stop filling exactly at its trigger, has assumed slippage away.",
    see: ["market-impact", "transaction-cost", "fill"],
  },
  {
    id: "transaction-cost",
    term: "transaction cost",
    aliases: ["TCA", "transaction cost analysis"],
    domain: "execution",
    definition:
      "Everything between the decision price and the realised price: spread, commission, impact, delay, financing. **TCA** is the discipline of measuring it.",
    see: ["slippage", "spread", "implementation-shortfall"],
  },
  {
    id: "implementation-shortfall",
    term: "implementation shortfall",
    domain: "execution",
    definition:
      "Total cost measured against the price when the decision was made, including the opportunity cost of what you failed to fill.",
    see: ["transaction-cost", "arrival-price"],
  },
  {
    id: "adv",
    term: "ADV",
    expansion: "Average Daily Volume",
    domain: "microstructure",
    definition:
      "Typical daily traded volume. **The denominator of every capacity estimate** — position size as a share of ADV predicts impact.",
    see: ["market-impact", "participation-rate", "capacity"],
  },
  {
    id: "capacity",
    term: "capacity",
    domain: "microstructure",
    definition:
      "How much capital a strategy can run before its own impact eats the edge. **Falls as holding period shortens.**",
    see: ["market-impact", "adv"],
  },

  // ── Market structure ───────────────────────────────────────────────────
  {
    id: "tick-size",
    term: "tick size",
    domain: "market-structure",
    definition:
      "The minimum price increment. **Sets the floor on the spread** and, for a liquid instrument, largely determines it.",
    see: ["spread", "pip"],
  },
  {
    id: "pip",
    term: "pip / point",
    domain: "market-structure",
    definition:
      "The conventional smallest quote increment in FX — 0.0001 for most pairs, 0.01 for JPY crosses. A **pipette** is a tenth of one.",
    see: ["tick-size", "spread"],
  },
  {
    id: "contract-multiplier",
    term: "contract multiplier",
    domain: "market-structure",
    definition:
      "How many units of the underlying one futures contract represents. Converts a price move into a currency P&L.",
    see: ["notional", "futures"],
  },
  {
    id: "notional",
    term: "notional",
    domain: "market-structure",
    definition:
      "The face value of a position — price times size times multiplier. **What you are exposed to, as opposed to what you posted.**",
    see: ["leverage", "margin", "contract-multiplier"],
  },
  {
    id: "futures",
    term: "futures contract",
    domain: "market-structure",
    definition:
      "A standardised, exchange-traded, centrally cleared agreement to transact at a set price on a set date.",
    see: ["contract-multiplier", "roll", "basis", "contango"],
  },
  {
    id: "roll",
    term: "roll",
    domain: "market-structure",
    aliases: ["contract roll", "continuous contract", "back-adjustment"],
    definition:
      "Moving a position from an expiring contract to the next. **Creates an artificial price jump** that must be adjusted out before any return series is computed.",
    why: "Back-adjustment shifts historical prices, so a back-adjusted series can go negative and its percentage returns are wrong. Use ratio adjustment for returns.",
    see: ["futures", "basis", "contango"],
  },
  {
    id: "basis",
    term: "basis",
    domain: "market-structure",
    definition: "Spot price minus futures price. Carries financing, storage and convenience yield.",
    see: ["contango", "futures", "roll"],
  },
  {
    id: "contango",
    term: "contango / backwardation",
    domain: "market-structure",
    definition:
      "**Contango**: futures above spot, so a long roll bleeds. **Backwardation**: futures below spot, so it earns. The dominant P&L driver for a held futures position.",
    see: ["basis", "roll", "carry"],
  },
  {
    id: "carry",
    term: "carry",
    domain: "market-structure",
    definition:
      "The return from simply holding — interest differential in FX, roll yield in futures, dividend minus financing in equity.",
    why: "Carry strategies earn steadily and lose violently. The return profile is short volatility whether or not an option is involved.",
    see: ["contango", "swap-rate"],
  },
  {
    id: "swap-rate",
    term: "swap / rollover rate",
    domain: "market-structure",
    definition:
      "The overnight financing debited or credited on a leveraged FX position, from the two currencies' interest differential.",
    see: ["carry", "leverage"],
  },
  {
    id: "session",
    term: "trading session",
    domain: "market-structure",
    aliases: ["london", "new york", "tokyo", "overlap"],
    definition:
      "FX trades 24/5 across Sydney, Tokyo, London and New York. **The London/New York overlap is the deepest and most volatile window**; the hours after the New York close are the thinnest.",
    why: "Almost every intraday 'pattern' is a session effect in disguise. Condition on the hour before believing anything.",
    see: ["seasonality", "liquidity-risk"],
  },
  {
    id: "overnight-gap",
    term: "overnight gap",
    domain: "market-structure",
    definition:
      "The jump between one session's close and the next's open, when news arrived while the market was shut.",
    why: "Enters close-to-close volatility at full size and barely touches the intraday range — which is how the two estimators disagree at the daily frequency.",
    see: ["jump", "true-range", "parkinson-estimator"],
  },
  {
    id: "circuit-breaker",
    term: "circuit breaker / limit",
    domain: "market-structure",
    definition:
      "An exchange rule halting trading or capping a move after a large price change.",
    why: "Truncates the observed tail. History understates what the price would have done without the halt.",
    see: ["jump", "liquidity-risk"],
  },
  {
    id: "otc",
    term: "OTC",
    expansion: "Over The Counter",
    domain: "market-structure",
    definition:
      "Traded bilaterally rather than on an exchange. **Spot FX is OTC**, so there is no single consolidated tape and no true volume figure.",
    why: "Why FX 'volume' from a retail feed is tick count, not traded size.",
    see: ["clearing", "counterparty-risk"],
  },
  {
    id: "clearing",
    term: "central clearing",
    domain: "market-structure",
    definition:
      "A clearing house stepping between both sides so neither faces the other's default.",
    see: ["otc", "counterparty-risk", "margin"],
  },
];
