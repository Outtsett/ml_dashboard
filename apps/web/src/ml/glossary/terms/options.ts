/**
 * Options & derivatives — pricing, the greeks, and the assumptions underneath.
 *
 * SRP: Data only. Merged by `../index.ts`.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  {
    id: "option",
    term: "option",
    domain: "options",
    aliases: ["call", "put"],
    definition:
      "The right, not the obligation, to buy (**call**) or sell (**put**) at a set strike by a set date. **Asymmetric by construction** — bounded loss for the buyer, bounded gain for the seller.",
    see: ["strike", "expiry", "premium", "moneyness"],
  },
  {
    id: "strike",
    term: "strike",
    symbol: "K",
    domain: "options",
    definition: "The price at which the option can be exercised.",
    see: ["option", "moneyness"],
  },
  {
    id: "expiry",
    term: "expiry",
    symbol: "T",
    domain: "options",
    aliases: ["maturity", "tenor", "dte"],
    definition:
      "When the right lapses. **Time value decays toward it**, slowly at first and then very quickly.",
    see: ["theta", "time-value"],
  },
  {
    id: "premium",
    term: "premium",
    domain: "options",
    definition:
      "The option's price — intrinsic value plus time value. What the buyer pays and the seller receives up front.",
    see: ["intrinsic-value", "time-value"],
  },
  {
    id: "intrinsic-value",
    term: "intrinsic value",
    domain: "options",
    definition:
      "What the option would be worth if exercised now — never below zero, because the right can simply go unused.",
    see: ["time-value", "moneyness"],
  },
  {
    id: "time-value",
    term: "time value / extrinsic value",
    domain: "options",
    definition:
      "Premium above intrinsic — what you pay for the chance the option ends further in the money. **Decays to zero at expiry.**",
    see: ["theta", "intrinsic-value", "implied-volatility"],
  },
  {
    id: "moneyness",
    term: "moneyness",
    domain: "options",
    aliases: ["ITM", "ATM", "OTM", "in the money", "at the money", "out of the money"],
    definition:
      "Where spot sits relative to strike. **ATM** options carry the most time value and the most gamma.",
    see: ["strike", "intrinsic-value", "gamma"],
  },
  {
    id: "black-scholes",
    term: "Black–Scholes",
    domain: "options",
    aliases: ["black scholes merton", "BSM"],
    definition:
      "The 1973 option-pricing formula. Its real content is the **assumption underneath**: price follows geometric Brownian motion with a constant volatility.",
    why: "Everything it outputs follows from that, which is why the assumption can be tested on spot data with no options involved.",
    see: ["gbm", "greeks", "implied-volatility", "garman-kohlhagen"],
  },
  {
    id: "garman-kohlhagen",
    term: "Garman–Kohlhagen",
    domain: "options",
    definition:
      "The FX version of Black–Scholes, carrying **two** interest rates because both currencies earn.",
    see: ["black-scholes", "carry"],
  },
  {
    id: "gbm",
    term: "GBM",
    expansion: "Geometric Brownian Motion",
    symbol: "dS/S = μ dt + σ dW",
    domain: "options",
    definition:
      "The random walk Black–Scholes assumes: proportional moves, constant volatility, no jumps, independent increments.",
    why: "*Geometric* because moves are proportional to price, so 1% means the same at 1.05 and at 1.20.",
    see: ["black-scholes", "random-walk", "wiener-process"],
  },
  {
    id: "wiener-process",
    term: "Wiener process",
    domain: "options",
    aliases: ["brownian motion", "dW"],
    definition:
      "Continuous, nowhere-differentiable, independent Gaussian increments whose variance grows linearly with time. The randomness inside every diffusion model.",
    see: ["gbm", "ito-lemma"],
  },
  {
    id: "ito-lemma",
    term: "Itô's lemma",
    domain: "options",
    definition:
      "The chain rule for stochastic processes. **Carries an extra second-order term** because a Wiener path's squared increments do not vanish — which is where the σ²/2 in log-return drift comes from.",
    see: ["wiener-process", "volatility-drag", "gbm"],
  },
  {
    id: "greeks",
    term: "the greeks",
    domain: "options",
    definition:
      "An option's sensitivities. All are derivatives of the pricing formula, so **all inherit its assumptions**.",
    see: ["delta", "gamma", "vega", "theta", "rho-rates"],
  },
  {
    id: "delta",
    term: "delta",
    symbol: "Δ = ∂V/∂S",
    domain: "options",
    definition:
      "Price sensitivity to the underlying. Also read as a hedge ratio, and roughly as the risk-neutral probability of finishing in the money.",
    see: ["greeks", "gamma", "delta-hedging"],
  },
  {
    id: "gamma",
    term: "gamma",
    symbol: "Γ = ∂²V/∂S²",
    domain: "options",
    definition:
      "How fast delta changes. **Highest at the money near expiry** — the region where a hedge needs constant adjustment.",
    why: "Long gamma profits from movement in either direction; short gamma is why sellers blow up in fast markets.",
    see: ["delta", "delta-hedging", "gamma-squeeze"],
  },
  {
    id: "vega",
    term: "vega",
    symbol: "ν = ∂V/∂σ",
    domain: "options",
    definition:
      "Sensitivity to implied volatility. **Not a Greek letter**, which is a standing joke and also true.",
    see: ["implied-volatility", "greeks"],
  },
  {
    id: "theta",
    term: "theta",
    symbol: "Θ = ∂V/∂t",
    domain: "options",
    definition:
      "Time decay — what the option loses per day, all else equal. **Accelerates into expiry**, and is what a seller is paid for.",
    see: ["time-value", "expiry", "greeks"],
  },
  {
    id: "rho-rates",
    term: "rho (rates)",
    symbol: "ρ = ∂V/∂r",
    domain: "options",
    definition:
      "Sensitivity to the risk-free rate. Usually the smallest greek, and not small when rates move fast.",
    see: ["greeks"],
  },
  {
    id: "delta-hedging",
    term: "delta hedging",
    domain: "options",
    definition:
      "Holding an offsetting position in the underlying so the book is insensitive to small moves, rebalanced as delta drifts.",
    why: "The rebalancing IS the cost. Realised volatility above implied means you rehedge more than you were paid for.",
    see: ["delta", "gamma", "variance-risk-premium"],
  },
  {
    id: "gamma-squeeze",
    term: "gamma squeeze",
    domain: "options",
    definition:
      "Dealers short gamma being forced to buy into a rally to stay hedged, amplifying the move that is hurting them.",
    see: ["gamma", "delta-hedging"],
  },
  {
    id: "put-call-parity",
    term: "put–call parity",
    symbol: "C − P = S − K·e^(−rT)",
    domain: "options",
    definition:
      "A model-free relationship tying a call, a put, the spot and a bond. **Holds by arbitrage, not by assumption** — one of the few things in options that is not a model.",
    see: ["option", "arbitrage"],
  },
  {
    id: "risk-neutral",
    term: "risk-neutral measure",
    symbol: "ℚ",
    domain: "options",
    definition:
      "A change of probability under which every asset drifts at the risk-free rate, so a derivative's price is just its discounted expected payoff.",
    why: "**Not a belief about the real world.** Risk-neutral probabilities are prices, and the gap between them and real-world probabilities is the risk premium.",
    see: ["black-scholes", "variance-risk-premium"],
  },
  {
    id: "arbitrage",
    term: "arbitrage",
    domain: "options",
    definition:
      "A riskless profit from inconsistent prices. **Assumed absent** in every pricing model, which is what makes the prices unique.",
    see: ["put-call-parity", "risk-neutral"],
  },
  {
    id: "exotic-option",
    term: "exotic option",
    domain: "options",
    aliases: ["barrier", "asian", "digital", "lookback", "knock-in", "knock-out"],
    definition:
      "Anything beyond vanilla calls and puts — **barrier** options that activate or die at a level, **Asian** ones on an average, **digital** ones paying fixed amounts.",
    why: "Barrier options depend on the PATH, so they are far more sensitive to the continuity assumption than a vanilla.",
    see: ["option", "path", "jump"],
  },
  {
    id: "american-european",
    term: "American / European exercise",
    domain: "options",
    definition:
      "**European** can only be exercised at expiry; **American** any time before. The early-exercise right makes American options worth at least as much, and harder to price.",
    see: ["option", "expiry"],
  },
  {
    id: "local-volatility",
    term: "local volatility",
    domain: "options",
    definition:
      "A model where σ is a deterministic function of price and time, fitted to reproduce the entire observed smile exactly.",
    why: "Fits today's surface perfectly and predicts its future evolution badly.",
    see: ["volatility-smile", "stochastic-volatility"],
  },
  {
    id: "stochastic-volatility",
    term: "stochastic volatility",
    domain: "options",
    aliases: ["heston", "SABR"],
    definition:
      "Models where volatility has its own random process, correlated with price. **Heston** and **SABR** are the standard ones.",
    why: "Produces a smile endogenously rather than by fitting one, and the correlation term produces the leverage effect for free.",
    see: ["volatility-smile", "local-volatility", "leverage-effect"],
  },
  {
    id: "jump-diffusion",
    term: "jump diffusion",
    domain: "options",
    aliases: ["merton jump", "bates"],
    definition:
      "Diffusion plus a jump process, so the model can produce the discontinuities and fat tails a pure diffusion cannot.",
    see: ["jump", "gbm", "fat-tail"],
  },
  {
    id: "straddle",
    term: "straddle / strangle",
    domain: "options",
    definition:
      "Buying a call and a put — same strike (**straddle**) or different strikes (**strangle**). A bet on **size of move, not direction**.",
    why: "Break-even move for an ATM straddle is roughly 0.8·σ·√T, which converts an implied vol straight into a required move.",
    see: ["option", "implied-volatility", "vega"],
  },
];
