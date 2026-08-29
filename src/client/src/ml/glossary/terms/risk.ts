/**
 * Risk — sizing a position, and bounding what can go wrong.
 *
 * SRP: Data only. Merged by `../index.ts`.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  {
    id: "var",
    term: "VaR",
    expansion: "Value at Risk",
    domain: "risk",
    definition:
      "The loss you expect to exceed with some small probability over a horizon — *1-day 99% VaR of £1m* means one day in a hundred loses more than £1m.",
    why: "Says nothing about HOW much more. Its blindness to the shape beyond the threshold is the criticism that produced Expected Shortfall.",
    see: ["expected-shortfall", "tail-risk", "fat-tail"],
  },
  {
    id: "expected-shortfall",
    term: "Expected Shortfall",
    expansion: "ES / CVaR",
    domain: "risk",
    aliases: ["cvar", "conditional var", "tail var"],
    definition:
      "The average loss GIVEN that you are past the VaR threshold. **Coherent**, where VaR is not: diversification can never make ES look worse.",
    see: ["var", "coherent-risk-measure", "tail-risk"],
  },
  {
    id: "coherent-risk-measure",
    term: "coherent risk measure",
    domain: "risk",
    definition:
      "A measure satisfying monotonicity, translation invariance, positive homogeneity and **subadditivity** — combining two books can never increase measured risk.",
    why: "VaR fails subadditivity, so a VaR-limited desk can be incentivised to split a position to hide risk.",
    see: ["expected-shortfall", "var"],
  },
  {
    id: "tail-risk",
    term: "tail risk",
    domain: "risk",
    definition:
      "Exposure to rare, large losses. **Systematically underpriced** because it is rare enough to be absent from most samples and most memories.",
    see: ["fat-tail", "black-swan", "expected-shortfall"],
  },
  {
    id: "black-swan",
    term: "black swan",
    domain: "risk",
    definition:
      "An event outside the model's imagination — not merely in the tail of the distribution but outside the distribution that was assumed.",
    why: "Distinct from a fat tail. A fat tail is a rare event you priced; a black swan is one whose possibility never entered the model.",
    see: ["tail-risk", "fat-tail", "model-risk"],
  },
  {
    id: "model-risk",
    term: "model risk",
    domain: "risk",
    definition:
      "Loss caused by the model being wrong rather than the market moving — a broken assumption, a mis-estimated parameter, a regime the model never saw.",
    see: ["black-swan", "regime-change", "overfitting"],
  },
  {
    id: "position-sizing",
    term: "position sizing",
    domain: "risk",
    definition:
      "How much to put on. **Determines the return distribution's shape more than the entry signal does** — the same signal sized differently is a different strategy.",
    see: ["kelly-criterion", "volatility-targeting", "risk-parity"],
  },
  {
    id: "kelly-criterion",
    term: "Kelly criterion",
    symbol: "f* = edge / odds",
    domain: "risk",
    definition:
      "The bet fraction maximising long-run log wealth. **Maximally aggressive**: it produces the fastest growth and drawdowns most people cannot sit through.",
    why: "Assumes the edge is known exactly. Since it never is, practitioners use a half or quarter Kelly, and over-betting Kelly is worse than under-betting by a lot.",
    see: ["position-sizing", "risk-of-ruin", "fractional-kelly"],
  },
  {
    id: "fractional-kelly",
    term: "fractional Kelly",
    domain: "risk",
    definition:
      "Betting a fixed fraction — typically ¼ to ½ — of the Kelly stake. Gives up a little growth for a large reduction in volatility and in sensitivity to a mis-estimated edge.",
    see: ["kelly-criterion", "position-sizing"],
  },
  {
    id: "risk-of-ruin",
    term: "risk of ruin",
    domain: "risk",
    definition:
      "The probability of losing enough capital to be unable to continue. **Nonzero for any strategy with leverage**, however good.",
    see: ["kelly-criterion", "max-drawdown", "gamblers-ruin"],
  },
  {
    id: "gamblers-ruin",
    term: "gambler's ruin",
    domain: "risk",
    definition:
      "For a driftless random walk between two barriers, the chance of hitting one first is proportional to the OTHER's distance. A 2:1 target/stop is hit target-first **one third** of the time.",
    why: "The only number a measured barrier hit-rate may be compared against. Beating 50% at 2:1 is not an edge; beating 33.3% is.",
    see: ["triple-barrier", "risk-of-ruin", "random-walk"],
  },
  {
    id: "volatility-targeting",
    term: "volatility targeting",
    domain: "risk",
    definition:
      "Scaling exposure inversely to forecast volatility so realised portfolio volatility stays near a constant.",
    why: "Reliably improves Sharpe and reliably increases leverage exactly when volatility is low — which is often just before it is not.",
    see: ["position-sizing", "risk-parity", "volatility"],
  },
  {
    id: "risk-parity",
    term: "risk parity",
    domain: "risk",
    definition:
      "Allocating so each asset contributes equally to portfolio risk, rather than equal capital.",
    see: ["volatility-targeting", "covariance-matrix", "diversification"],
  },
  {
    id: "leverage",
    term: "leverage",
    domain: "risk",
    definition:
      "Exposure divided by capital. **Multiplies both the edge and the path**, and it is the path that triggers margin calls.",
    see: ["margin", "risk-of-ruin", "volatility-drag"],
  },
  {
    id: "volatility-drag",
    term: "volatility drag",
    domain: "risk",
    aliases: ["variance drain"],
    definition:
      "Compounded return sits below arithmetic mean return by roughly σ²/2. **+10% then −10% leaves you down 1%**, and the gap widens with volatility.",
    why: "Why leveraged products decay in choppy markets even when the underlying ends flat.",
    see: ["log-return", "leverage", "compounding"],
  },
  {
    id: "margin",
    term: "margin",
    domain: "risk",
    aliases: ["initial margin", "maintenance margin", "margin call"],
    definition:
      "Collateral a broker requires against a position. **Initial** to open, **maintenance** to keep it; falling below the latter forces a top-up or a liquidation.",
    see: ["leverage", "liquidation"],
  },
  {
    id: "liquidation",
    term: "forced liquidation",
    domain: "risk",
    definition:
      "The broker closing your position because margin was breached. **Happens at the worst possible price by construction** — it is triggered by the move that is already against you.",
    see: ["margin", "leverage", "risk-of-ruin"],
  },
  {
    id: "stop-loss",
    term: "stop-loss",
    domain: "risk",
    definition:
      "An order closing a position once it moves against you by a set amount. **Converts an unbounded loss into a bounded one plus slippage.**",
    why: "In a fast market a stop fills worse than its trigger. A backtest filling stops exactly at the level is optimistic.",
    see: ["slippage", "atr-stop", "triple-barrier"],
  },
  {
    id: "atr-stop",
    term: "volatility-scaled stop",
    domain: "risk",
    definition:
      "A stop placed at a multiple of recent volatility (often ATR) rather than a fixed distance. **A fixed stop is a different trade in a quiet hour than a violent one.**",
    see: ["stop-loss", "true-range", "triple-barrier"],
  },
  {
    id: "drawdown-control",
    term: "drawdown control",
    domain: "risk",
    definition:
      "Cutting exposure as equity falls from its peak, to bound the worst case at the cost of participating less in the recovery.",
    see: ["max-drawdown", "volatility-targeting"],
  },
  {
    id: "correlation-breakdown",
    term: "correlation breakdown",
    domain: "risk",
    definition:
      "Diversifying correlations rising toward 1 in a crisis, exactly when the diversification was needed.",
    why: "Why a portfolio's measured risk is systematically too low in calm periods — the covariance matrix was estimated on data that did not contain a crisis.",
    see: ["covariance-matrix", "diversification", "tail-risk"],
  },
  {
    id: "covariance-matrix",
    term: "covariance matrix",
    domain: "risk",
    definition:
      "Pairwise covariances of all assets — the object that turns individual volatilities into portfolio risk.",
    why: "With more assets than observations it is singular and its inverse is noise. Shrinkage or factor structure is mandatory.",
    see: ["shrinkage", "risk-parity", "correlation-breakdown"],
  },
  {
    id: "shrinkage",
    term: "shrinkage",
    domain: "risk",
    aliases: ["ledoit wolf"],
    definition:
      "Pulling a noisy sample estimate toward a simpler, more stable target. **Ledoit–Wolf** shrinks a covariance matrix toward constant correlation.",
    see: ["covariance-matrix", "regularization"],
  },
  {
    id: "stress-test",
    term: "stress test",
    domain: "risk",
    definition:
      "Revaluing a book under a specified adverse scenario rather than a statistical one. **Answers 'what if 2008 again', which no VaR number does.**",
    see: ["var", "scenario-analysis", "tail-risk"],
  },
  {
    id: "scenario-analysis",
    term: "scenario analysis",
    domain: "risk",
    definition:
      "Evaluating outcomes under a small set of hand-built futures, chosen for plausibility and severity rather than sampled from history.",
    see: ["stress-test", "monte-carlo"],
  },
  {
    id: "monte-carlo",
    term: "Monte Carlo simulation",
    domain: "risk",
    definition:
      "Estimating a distribution by simulating many random paths under an assumed process.",
    why: "Only as good as the assumed process. A Gaussian Monte Carlo will never produce the tail that actually breaks you.",
    see: ["scenario-analysis", "bootstrap", "gbm"],
  },
  {
    id: "diversification",
    term: "diversification",
    domain: "risk",
    definition:
      "Combining imperfectly correlated exposures so the whole is less volatile than its parts.",
    why: "Requires INDEPENDENT bets. Twenty positions all long the same factor is one bet.",
    see: ["correlation-breakdown", "breadth", "risk-parity"],
  },
  {
    id: "concentration-risk",
    term: "concentration risk",
    domain: "risk",
    definition:
      "Loss potential from having too much in one name, sector, factor or venue.",
    see: ["diversification", "correlation-breakdown"],
  },
  {
    id: "liquidity-risk",
    term: "liquidity risk",
    domain: "risk",
    definition:
      "The risk of not being able to exit at anything near the marked price. **Rises exactly when everything else goes wrong**, because everyone exits at once.",
    see: ["market-impact", "slippage", "adv"],
  },
  {
    id: "counterparty-risk",
    term: "counterparty risk",
    domain: "risk",
    definition:
      "The risk the other side of a trade fails to deliver. Largely mutualised by central clearing on exchange, and very much alive over the counter.",
    see: ["clearing", "otc"],
  },
];
