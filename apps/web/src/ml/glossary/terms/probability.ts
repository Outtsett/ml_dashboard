/**
 * Probability — random variables, distributions, and the processes built on them.
 *
 * SRP: Data only. Merged by `../index.ts`.
 *
 * `statistics.ts` is about describing a sample you have. This file is about the
 * process that generated it: what a distribution is, which ones matter here,
 * and the inequalities and convergence results everything else leans on.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  // ── Foundations ────────────────────────────────────────────────────────
  {
    id: "random-variable",
    term: "random variable",
    domain: "probability",
    definition:
      "A quantity whose value is decided by an outcome you have not seen yet. **Discrete** takes countable values, **continuous** takes any value in a range.",
    see: ["pdf-cdf", "sym-expectation", "sample-space"],
  },
  {
    id: "sample-space",
    term: "sample space & event",
    symbol: "Ω",
    domain: "probability",
    definition:
      "**Ω** is the set of everything that could happen; an **event** is a subset of it. Every probability is a number assigned to an event.",
    see: ["random-variable", "sym-omega-upper"],
  },
  {
    id: "pdf-cdf",
    term: "PDF, CDF, quantile function",
    symbol: "f(x), F(x), F⁻¹(p)",
    domain: "probability",
    definition:
      "**PDF** density at a point — not a probability, only its rate. **CDF** the probability of being at or below x. **Quantile function** the inverse: the value at a given probability.",
    why: "VaR is a quantile function evaluated at 1%. The CDF is what an option's Φ(d₂) is.",
    see: ["percentile", "var", "sym-phi-upper"],
  },
  {
    id: "conditional-probability",
    term: "conditional probability",
    symbol: "P(A|B) = P(A ∩ B) / P(B)",
    domain: "probability",
    definition:
      "The probability of A given that B happened. **Almost every quantity in forecasting is conditional** — the unconditional version is the base rate.",
    see: ["f-bayes", "base-rate", "independence"],
  },
  {
    id: "independence",
    term: "independence",
    symbol: "P(A ∩ B) = P(A)·P(B)",
    domain: "probability",
    definition:
      "Knowing one tells you nothing about the other. **Stronger than uncorrelated**: two variables can have zero correlation and be completely dependent.",
    why: "Assumed by nearly every standard error you will ever compute, and violated by nearly every financial series.",
    see: ["correlation", "sym-distributed", "overlapping-samples"],
  },
  {
    id: "tower-property",
    term: "law of total expectation",
    symbol: "E[X] = E[ E[X|Y] ]",
    domain: "probability",
    aliases: ["tower property", "law of iterated expectations"],
    definition:
      "The average of conditional averages is the overall average. **The formal statement that a martingale's forecast cannot be improved by conditioning further.**",
    see: ["martingale", "sym-expectation", "conditional-probability"],
  },
  {
    id: "jensens-inequality",
    term: "Jensen's inequality",
    symbol: "E[g(X)] ≥ g(E[X])  for convex g",
    domain: "probability",
    definition:
      "The average of a convex function exceeds the function of the average.",
    why: "Why the null value of a log ratio is not zero, why E[1/X] ≠ 1/E[X], and why an option's expected payoff exceeds the payoff at the expected price. **Convexity is worth money.**",
    see: ["sym-rho", "volatility-drag", "gamma"],
  },
  {
    id: "chebyshev",
    term: "Markov & Chebyshev inequalities",
    symbol: "P(|X − μ| ≥ kσ) ≤ 1/k²",
    domain: "probability",
    definition:
      "Distribution-free bounds on how much mass can sit in the tail. Chebyshev caps a 4σ move at 1/16 — **true for anything with finite variance**, and vastly looser than the Gaussian's 1-in-16,000.",
    why: "The gap between the two is the room fat tails live in.",
    see: ["fat-tail", "var", "sigma-move"],
  },

  // ── Distributions ──────────────────────────────────────────────────────
  {
    id: "normal-distribution",
    term: "normal / Gaussian",
    symbol: "N(μ, σ²)",
    domain: "probability",
    definition:
      "The bell curve — fully described by its mean and variance, with skew 0 and excess kurtosis 0. **Sums of independent things tend toward it**, which is why it is everywhere.",
    why: "And why it is wrong here: financial returns are neither independent nor finite-variance enough for the limit to bite.",
    see: ["central-limit-theorem", "lognormal", "student-t"],
  },
  {
    id: "lognormal",
    term: "lognormal",
    domain: "probability",
    definition:
      "A variable whose LOGARITHM is normal. **Cannot go negative and is right-skewed** — which is why it is the standard model for a price, while returns are modelled as normal.",
    see: ["normal-distribution", "gbm", "log-return"],
  },
  {
    id: "student-t",
    term: "Student's t",
    symbol: "t(ν)",
    domain: "probability",
    definition:
      "Bell-shaped with fatter tails, controlled by degrees of freedom **ν**. **Below ν = 4 the kurtosis is infinite; below 2 the variance is.**",
    why: "The usual fitted alternative to a normal for returns, and it fits far better — typically ν between 3 and 6 on daily data.",
    see: ["fat-tail", "sym-nu", "normal-distribution"],
  },
  {
    id: "bernoulli-binomial",
    term: "Bernoulli & binomial",
    symbol: "B(n, p)",
    domain: "probability",
    definition:
      "**Bernoulli** one trial with probability p; **binomial** the count of successes in n independent trials.",
    why: "A hit rate is a binomial proportion, so its standard error is √(p(1−p)/n) — which is how you tell a real 55% from a lucky one.",
    see: ["hit-rate", "standard-error", "base-rate"],
  },
  {
    id: "exponential-distribution",
    term: "exponential & gamma",
    domain: "probability",
    definition:
      "**Exponential** models waiting time between Poisson events and is memoryless — how long you have waited tells you nothing. **Gamma** is the sum of several exponentials.",
    see: ["poisson", "hazard-rate", "duration"],
  },
  {
    id: "hazard-rate",
    term: "hazard rate & survival",
    symbol: "λ(t)",
    domain: "probability",
    definition:
      "The instantaneous rate of an event given it has not happened yet. **Survival analysis** models time-to-event with censored observations — trades still open when the sample ends.",
    why: "The natural frame for holding periods and for time-to-barrier, and it handles the trades that never resolved rather than dropping them.",
    see: ["exponential-distribution", "sym-lambda", "triple-barrier"],
  },
  {
    id: "pareto-power-law",
    term: "Pareto & power law",
    symbol: "P(X > x) ∝ x^(−α)",
    domain: "probability",
    definition:
      "A tail decaying polynomially rather than exponentially. **Moments above α do not exist** — with α below 2 the variance is infinite, and a sample variance will simply grow with sample size.",
    see: ["fat-tail", "extreme-value-theory", "law-of-large-numbers"],
  },
  {
    id: "mixture-distribution",
    term: "mixture distribution",
    domain: "probability",
    definition:
      "A weighted combination of several distributions. **A mixture of two normals with different variances is fat-tailed** without either component being — which is one way volatility regimes produce kurtosis.",
    see: ["clustering", "hmm", "fat-tail", "regime-change"],
  },
  {
    id: "multivariate-normal",
    term: "multivariate normal",
    symbol: "N(μ, Σ)",
    domain: "probability",
    definition:
      "The joint generalisation, described entirely by a mean vector and a covariance matrix. **Every marginal and every conditional is also normal**, which is what makes it tractable.",
    why: "Its dependence is entirely linear, so it cannot represent the tail dependence real assets show in a crash.",
    see: ["covariance-matrix", "copula", "correlation-breakdown"],
  },
  {
    id: "copula",
    term: "copula",
    domain: "probability",
    definition:
      "Separates the marginal distributions from the dependence structure, so each can be modelled independently. **A Gaussian copula has no tail dependence**; a t-copula does.",
    why: "Assuming a Gaussian copula for mortgage defaults is a famous and expensive case of getting exactly this wrong.",
    see: ["multivariate-normal", "correlation-breakdown", "tail-risk"],
  },
  {
    id: "dirichlet",
    term: "Dirichlet & beta",
    domain: "probability",
    definition:
      "**Beta** is a distribution over a probability; **Dirichlet** over a set of proportions summing to one. Both are the natural priors for the things they describe.",
    see: ["bayesian-inference", "simplex", "mixture-distribution"],
  },

  // ── Processes ──────────────────────────────────────────────────────────
  {
    id: "stochastic-process",
    term: "stochastic process",
    domain: "probability",
    definition:
      "A collection of random variables indexed by time — a random function rather than a random number.",
    see: ["wiener-process", "markov-chain", "martingale"],
  },
  {
    id: "levy-process",
    term: "Lévy process",
    domain: "probability",
    definition:
      "A process with stationary, independent increments. **Brownian motion and the Poisson process are the two building blocks**; combining them gives jump-diffusion.",
    see: ["wiener-process", "poisson", "jump-diffusion"],
  },
  {
    id: "hawkes-process",
    term: "Hawkes process",
    domain: "probability",
    definition:
      "A self-exciting point process: each event raises the arrival rate of the next. **Clustering by construction**, where Poisson has none.",
    why: "A far better model of order arrivals and of volatility events than Poisson, precisely because real activity begets activity.",
    see: ["poisson", "volatility-clustering", "order-flow-imbalance"],
  },
  {
    id: "ergodicity",
    term: "ergodicity",
    domain: "probability",
    definition:
      "Whether a single long path's time average equals the average across many paths. **When it does not, your expected return is not what you will experience.**",
    why: "The core of the volatility-drag argument: the ensemble average grows at μ while any individual path grows at μ − σ²/2.",
    see: ["volatility-drag", "kelly-criterion", "law-of-large-numbers"],
  },
  {
    id: "stopping-time",
    term: "stopping time",
    domain: "probability",
    definition:
      "A rule for when to stop that uses only information available at the time — no peeking ahead.",
    why: "A triple-barrier exit is a stopping time. A rule that exits *at the high of the day* is not, and a backtest using one is fiction.",
    see: ["triple-barrier", "look-ahead-bias", "martingale"],
  },
  {
    id: "first-passage",
    term: "first passage time",
    domain: "probability",
    definition:
      "When a process first reaches a level. **The mathematics behind barrier options, stop-losses and triple-barrier labels alike.**",
    see: ["gamblers-ruin", "triple-barrier", "exotic-option"],
  },
  {
    id: "bayesian-inference",
    term: "Bayesian inference",
    aliases: ["prior", "posterior", "conjugate", "mcmc"],
    domain: "probability",
    definition:
      "Treating parameters as random and updating a **prior** into a **posterior** with data. Returns a distribution over the answer rather than a point estimate.",
    why: "Its cost is that the prior is a choice you have to defend; its benefit is honest uncertainty on small samples, which finance always has.",
    see: ["f-bayes", "uncertainty", "dirichlet", "shrinkage"],
  },
  {
    id: "monte-carlo-error",
    term: "Monte Carlo standard error",
    symbol: "SE ≈ σ / √M",
    domain: "probability",
    definition:
      "The precision of a simulated estimate from **M** paths. **Halving the error costs four times the paths** — which is why variance reduction exists.",
    see: ["monte-carlo", "standard-error", "law-of-large-numbers"],
  },
  {
    id: "importance-sampling",
    term: "importance sampling",
    domain: "probability",
    definition:
      "Sampling from a different distribution that visits the region you care about more often, then reweighting to correct the bias.",
    why: "How you estimate a 1-in-10,000 tail without simulating 10 million paths.",
    see: ["monte-carlo-error", "tail-risk", "experience-replay"],
  },
];
