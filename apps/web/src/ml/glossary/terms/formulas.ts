/**
 * Formulas — the expressions themselves, with every symbol named.
 *
 * SRP: Data only. Merged by `../index.ts`.
 *
 * A formula entry carries the expression in `symbol` and spends its definition
 * saying what each letter is and what the whole thing means. Half the value of
 * a formula reference is knowing which of the six meanings of λ is in play, so
 * every symbol gets named on the spot rather than assumed.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  // ── Returns and compounding ────────────────────────────────────────────
  {
    id: "f-log-return",
    term: "Log return",
    symbol: "r_t = ln(p_t / p_{t−1})",
    domain: "formulas",
    definition:
      "**p_t** price now, **p_{t−1}** price one bar ago. Additive across time, so an n-bar return is the sum of its n one-bar returns, and symmetric in up and down moves.",
    see: ["log-return", "sym-log"],
  },
  {
    id: "f-compound",
    term: "Compounding & annualisation",
    symbol: "R_ann = (1 + R_p)^(N) − 1 ,  σ_ann = σ_p · √N",
    domain: "formulas",
    definition:
      "**R_p** the per-period return, **σ_p** its standard deviation, **N** periods per year (252 trading days, 12 months). Returns compound; **volatility scales with the square root** because variance is what adds.",
    why: "The √N step assumes independent increments. Where returns are autocorrelated it is wrong, and it is wrong in the direction that flatters.",
    see: ["annualisation", "square-root-of-time", "variance-additivity"],
  },
  {
    id: "f-volatility-drag",
    term: "Volatility drag",
    symbol: "g ≈ μ − σ² / 2",
    domain: "formulas",
    definition:
      "**g** the compounded (geometric) growth rate, **μ** the arithmetic mean return, **σ** its volatility. The gap is the drag — and it is why +10% then −10% leaves you down 1%.",
    why: "The σ²/2 falls straight out of Itô's lemma applied to the log of a price.",
    see: ["volatility-drag", "ito-lemma", "log-return"],
  },
  {
    id: "f-zscore",
    term: "Z-score",
    symbol: "z_t = (x_t − μ_{t−w:t}) / σ_{t−w:t}",
    domain: "formulas",
    definition:
      "**x_t** the value now, **μ** and **σ** its trailing mean and standard deviation over the last **w** bars. Answers *how unusual is this, in units of its own recent variation*.",
    why: "The subscript is the whole point: both statistics end at t, so no future bar contributes. A whole-series μ and σ is look-ahead.",
    see: ["z-score", "causal-window"],
  },

  // ── Performance ────────────────────────────────────────────────────────
  {
    id: "f-sharpe",
    term: "Sharpe ratio",
    symbol: "S = (E[R_p] − R_f) / σ_p · √N",
    domain: "formulas",
    definition:
      "**R_p** portfolio return, **R_f** the risk-free rate, **σ_p** the standard deviation of the excess return, **N** periods per year. Excess return per unit of total volatility.",
    why: "Penalises upside volatility identically to downside, and rewards a short-tail-risk profile that looks smooth until it does not.",
    see: ["sharpe-ratio", "f-sortino", "deflated-sharpe"],
  },
  {
    id: "f-sortino",
    term: "Sortino ratio",
    symbol: "Sortino = (E[R_p] − R_f) / σ_d ,  σ_d = √(E[min(R − T, 0)²])",
    domain: "formulas",
    definition:
      "Same numerator as Sharpe; the denominator **σ_d** is the **downside deviation** — the root-mean-square of returns below a target **T** (usually 0 or R_f), with upside counted as zero.",
    see: ["sortino-ratio", "downside-deviation", "f-sharpe"],
  },
  {
    id: "f-calmar",
    term: "Calmar ratio",
    symbol: "Calmar = R_ann / |MDD|",
    domain: "formulas",
    definition:
      "**R_ann** annualised return over **|MDD|**, the maximum peak-to-trough drawdown as a positive number. Return per unit of worst-case pain.",
    see: ["calmar-ratio", "f-max-drawdown"],
  },
  {
    id: "f-max-drawdown",
    term: "Maximum drawdown",
    symbol: "MDD = min_t [ (V_t − max_{s≤t} V_s) / max_{s≤t} V_s ]",
    domain: "formulas",
    definition:
      "**V_t** equity at time t; the inner max is the running peak up to t. The largest fractional fall from any prior high.",
    why: "Grows with sample length almost mechanically — a longer backtest nearly always finds a worse one.",
    see: ["max-drawdown", "underwater-curve"],
  },
  {
    id: "f-information-ratio",
    term: "Information ratio & the fundamental law",
    symbol: "IR = α / ω ,  IR ≈ IC · √BR",
    domain: "formulas",
    definition:
      "**α** active return over a benchmark, **ω** the tracking error. The second form: **IC** the information coefficient (forecast-to-outcome correlation), **BR** the breadth, the number of INDEPENDENT bets per year.",
    why: "A 0.05 IC across 500 independent bets beats a 0.20 IC across 10. Breadth is where most of the ratio comes from, and correlated positions do not count.",
    see: ["information-ratio", "breadth", "information-coefficient"],
  },
  {
    id: "f-expectancy",
    term: "Expectancy",
    symbol: "E = p · W − (1 − p) · L",
    domain: "formulas",
    definition:
      "**p** the hit rate, **W** the average win, **L** the average loss (positive). Expected profit per trade — **the one quantity that has to be positive.**",
    see: ["expectancy", "hit-rate", "payoff-ratio"],
  },
  {
    id: "f-kelly",
    term: "Kelly criterion",
    symbol: "f* = p − (1 − p)/b   ·  or ·   f* = μ / σ²",
    domain: "formulas",
    definition:
      "**p** win probability, **b** the payoff odds; the continuous form uses **μ** the expected excess return and **σ²** its variance. The fraction of capital maximising long-run log wealth.",
    why: "Assumes the edge is known exactly. It never is, so over-betting Kelly is far more damaging than under-betting, and practitioners use a quarter to a half.",
    see: ["kelly-criterion", "fractional-kelly", "risk-of-ruin"],
  },
  {
    id: "f-gamblers-ruin",
    term: "Gambler's ruin (barrier hit probability)",
    symbol: "P(target first) = L / (T + L)",
    domain: "formulas",
    definition:
      "For a driftless random walk between a target **T** above and a stop **L** below (both as distances), the chance of hitting the target first. A 2:1 target-to-stop is reached **one third** of the time.",
    why: "The only number a measured barrier hit rate may be read against. Beating 50% at 2:1 is not an edge; beating 33.3% is.",
    see: ["gamblers-ruin", "triple-barrier"],
  },

  // ── Risk ───────────────────────────────────────────────────────────────
  {
    id: "f-var",
    term: "Value at Risk",
    symbol: "VaR_α = −inf{ x : P(R ≤ x) > 1 − α }",
    domain: "formulas",
    definition:
      "The **α**-quantile of the loss distribution — for α = 99%, the loss exceeded on one day in a hundred. Under a normal assumption it collapses to **VaR = −(μ + z_α σ)** with z₉₉ = 2.326.",
    why: "The normal shortcut is the problem: it puts a 4σ day at once per 63 years, and EURUSD delivers them far more often.",
    see: ["var", "f-expected-shortfall", "fat-tail"],
  },
  {
    id: "f-expected-shortfall",
    term: "Expected Shortfall",
    symbol: "ES_α = E[ R | R ≤ −VaR_α ]",
    domain: "formulas",
    definition:
      "The **average** loss given that you are already past the VaR threshold — the expectation conditioned on being in the tail.",
    why: "Coherent where VaR is not: combining two books can never make ES look worse than the sum of its parts.",
    see: ["expected-shortfall", "f-var", "coherent-risk-measure"],
  },
  {
    id: "f-portfolio-variance",
    term: "Portfolio variance",
    symbol: "σ²_p = wᵀ Σ w",
    domain: "formulas",
    definition:
      "**w** the vector of portfolio weights, **Σ** the covariance matrix, **wᵀ** the transpose. Diversification lives entirely in the off-diagonal terms.",
    why: "Σ is estimated, and with more assets than observations it is singular. Its inverse — which mean-variance optimisation needs — then amplifies noise enormously.",
    see: ["covariance-matrix", "mean-variance", "shrinkage", "sym-matrix-ops"],
  },
  {
    id: "f-capm",
    term: "CAPM",
    symbol: "E[R_i] = R_f + β_i (E[R_m] − R_f)",
    domain: "formulas",
    definition:
      "**R_i** the asset's return, **R_f** risk-free, **R_m** the market, **β_i = Cov(R_i, R_m)/Var(R_m)** its market sensitivity. Everything above this line is α.",
    see: ["beta", "alpha", "factor-model"],
  },

  // ── Volatility ─────────────────────────────────────────────────────────
  {
    id: "f-parkinson",
    term: "Parkinson estimator",
    symbol: "E[(ln(H/L))²] = 4 ln2 · σ² T",
    domain: "formulas",
    definition:
      "**H** and **L** the bar's high and low, **σ** volatility, **T** the bar's duration. Rearranged, **σ̂² = ln(H/L)² / (4 ln2 · T)** — a range turned into a variance.",
    why: "About 5× more efficient than close-to-close because it reads the path's extremes. On one bar it adds nothing over the log range: the constant divides out of any z-score.",
    see: ["parkinson-estimator", "log-range", "f-garman-klass"],
  },
  {
    id: "f-garman-klass",
    term: "Garman–Klass estimator",
    symbol: "σ̂² = ½(ln H/L)² − (2 ln2 − 1)(ln C/O)²",
    domain: "formulas",
    definition:
      "**H L C O** the bar's high, low, close and open. Uses all four prices rather than two, so it is more efficient than Parkinson — under the assumption of no drift and no overnight gap.",
    see: ["garman-klass", "f-parkinson", "f-rogers-satchell"],
  },
  {
    id: "f-rogers-satchell",
    term: "Rogers–Satchell estimator",
    symbol: "σ̂² = ln(H/C)·ln(H/O) + ln(L/C)·ln(L/O)",
    domain: "formulas",
    definition:
      "Same four prices, arranged so the estimator stays **unbiased when the price has drift** — which Parkinson and Garman–Klass do not.",
    see: ["rogers-satchell", "f-garman-klass"],
  },
  {
    id: "f-realised-variance",
    term: "Realised variance & bipower variation",
    symbol: "RV = Σ r_i² ,  BV = (π/2) Σ |r_i||r_{i−1}|",
    domain: "formulas",
    definition:
      "**r_i** the i-th intraday return. **RV** sums squares and so absorbs jumps; **BV** multiplies ADJACENT absolute returns, so a single jump enters only one factor and is largely cancelled. The **π/2** makes the two estimate the same quantity under continuity.",
    why: "The difference between them IS the jump component: ln(RV/BV) sits at zero when there is none.",
    see: ["realised-volatility", "bipower-variation", "jump-ratio"],
  },
  {
    id: "f-ewma-vol",
    term: "EWMA volatility (RiskMetrics)",
    symbol: "σ²_t = λ σ²_{t−1} + (1 − λ) r²_{t−1}",
    domain: "formulas",
    definition:
      "**λ** the decay factor — 0.94 for daily data, 0.97 for monthly. Today's variance is yesterday's, decayed, plus yesterday's squared return. Half-life is **ln(0.5)/ln(λ)**, about 11 days at 0.94.",
    see: ["ewma-vol", "sym-lambda", "half-life", "f-garch"],
  },
  {
    id: "f-garch",
    term: "GARCH(1,1)",
    symbol: "σ²_t = ω + α r²_{t−1} + β σ²_{t−1}",
    domain: "formulas",
    definition:
      "**ω** the long-run variance floor, **α** the weight on the latest surprise, **β** the persistence of past variance. **α + β** is the persistence — close to 1 in practice, meaning shocks decay slowly.",
    why: "EWMA is the special case with ω = 0 and α + β = 1. The long-run variance is ω/(1 − α − β), which does not exist if α + β ≥ 1.",
    see: ["garch", "f-ewma-vol", "volatility-clustering"],
  },
  {
    id: "f-har-rv",
    term: "HAR-RV",
    symbol: "RV_{t+1} = c + β_d RV_t^{(d)} + β_w RV_t^{(w)} + β_m RV_t^{(m)}",
    domain: "formulas",
    definition:
      "Tomorrow's realised variance from averages over a **day**, a **week** and a **month** — a cascade standing in for traders operating at three horizons.",
    why: "Three OLS coefficients, and it is very hard to beat. It reproduces long memory without modelling it.",
    see: ["har-rv", "long-memory", "realised-volatility"],
  },
  {
    id: "f-variance-ratio",
    term: "Variance ratio",
    symbol: "VR(q) = Var(r_t^{(q)}) / (q · Var(r_t^{(1)}))",
    domain: "formulas",
    definition:
      "**r^{(q)}** a q-period return, **r^{(1)}** a one-period return. **Exactly 1 if increments are independent**, because variance adds. Above 1 trending, below mean-reverting.",
    why: "The heteroskedasticity-robust z* is √(nq)·(VR−1)/√θ*. The √ scaling matters: a fixed departure must get MORE significant with more data.",
    see: ["variance-ratio", "lo-mackinlay", "z-star"],
  },

  // ── Options ────────────────────────────────────────────────────────────
  {
    id: "f-black-scholes",
    term: "Black–Scholes",
    symbol: "C = S·Φ(d₁) − K·e^(−rT)·Φ(d₂)",
    domain: "formulas",
    definition:
      "**S** spot, **K** strike, **r** risk-free rate, **T** time to expiry, **Φ** the standard normal CDF. **d₁ = [ln(S/K) + (r + σ²/2)T] / (σ√T)** and **d₂ = d₁ − σ√T**. The put follows from put–call parity.",
    why: "**Φ(d₂) is the risk-neutral probability of finishing in the money**, and Φ(d₁) is the delta. σ is the only input you cannot observe — which is why the formula is used backwards, to extract it.",
    see: ["black-scholes", "sym-phi-upper", "implied-volatility", "f-put-call-parity"],
  },
  {
    id: "f-put-call-parity",
    term: "Put–call parity",
    symbol: "C − P = S − K·e^(−rT)",
    domain: "formulas",
    definition:
      "**C** call price, **P** put price, same strike **K** and expiry **T**. Holds **by arbitrage, not by assumption** — one of the few relationships in options that is not a model.",
    see: ["put-call-parity", "arbitrage", "f-black-scholes"],
  },
  {
    id: "f-greeks",
    term: "The greeks",
    symbol: "Δ = ∂V/∂S ,  Γ = ∂²V/∂S² ,  ν = ∂V/∂σ ,  Θ = ∂V/∂t ,  ρ = ∂V/∂r",
    domain: "formulas",
    definition:
      "**V** the option's value. Each greek is a partial derivative with respect to one input, holding the others fixed. Under Black–Scholes, **Δ_call = Φ(d₁)** and **Γ = φ(d₁)/(S σ√T)** with φ the normal density.",
    see: ["greeks", "delta", "gamma", "sym-derivative"],
  },
  {
    id: "f-straddle-breakeven",
    term: "Straddle break-even",
    symbol: "move ≈ 0.8 · σ · √T",
    domain: "formulas",
    definition:
      "How far the underlying must travel for a bought at-the-money straddle to pay for itself. **σ** the implied volatility, **T** time to expiry in years.",
    why: "Converts an implied vol straight into a required move — the quickest sanity check on whether an option is worth buying for a view.",
    see: ["straddle", "implied-volatility", "vega"],
  },
  {
    id: "f-gbm",
    term: "Geometric Brownian motion",
    symbol: "dS/S = μ dt + σ dW",
    domain: "formulas",
    definition:
      "**S** price, **μ** the drift, **σ** volatility, **dW** a Wiener increment — Gaussian, independent, variance proportional to dt. Solved: **S_T = S₀ exp[(μ − σ²/2)T + σ√T·Z]** with Z standard normal.",
    why: "The −σ²/2 is Itô's correction, and it is the same term as volatility drag.",
    see: ["gbm", "wiener-process", "ito-lemma", "f-volatility-drag"],
  },
  {
    id: "f-ou",
    term: "Ornstein–Uhlenbeck",
    symbol: "dX = θ(μ − X) dt + σ dW",
    domain: "formulas",
    definition:
      "**θ** the reversion speed, **μ** the long-run level, **σ** the noise scale. Pulled back toward μ at a rate proportional to distance. **Half-life = ln(2)/θ.**",
    why: "The half-life converts directly into a holding period, which is what makes OU useful for a spread trade rather than merely descriptive.",
    see: ["ornstein-uhlenbeck", "mean-reversion", "half-life", "spread-trade"],
  },

  // ── Microstructure ─────────────────────────────────────────────────────
  {
    id: "kyles-lambda",
    term: "Kyle's lambda",
    symbol: "Δp = λ · Q",
    domain: "formulas",
    definition:
      "**λ** the price impact coefficient, **Q** signed order flow, **Δp** the resulting price change. **λ is the inverse of market depth** — a large λ means a thin book where small orders move the price a lot.",
    why: "The cleanest single number for liquidity, and it rises exactly when you most want to exit.",
    see: ["market-impact", "sym-lambda", "market-depth", "liquidity-risk"],
  },
  {
    id: "f-market-impact",
    term: "Square-root impact law",
    symbol: "ΔP / P ≈ Y · σ · √(Q / V)",
    domain: "formulas",
    definition:
      "**Q** order size, **V** daily volume, **σ** daily volatility, **Y** a constant near 1. Impact grows with the **square root** of participation, not linearly.",
    why: "Why capacity falls so fast: doubling size costs only √2 in impact per share, but the total cost still grows faster than the edge.",
    see: ["market-impact", "adv", "capacity", "participation-rate"],
  },
  {
    id: "f-amihud",
    term: "Amihud illiquidity",
    symbol: "ILLIQ = mean( |r_t| / Volume_t )",
    domain: "formulas",
    definition:
      "Average absolute return per unit of volume — how much price moves for a given amount of trading. **A cheap proxy for Kyle's λ** computable from daily bars alone.",
    see: ["kyles-lambda", "liquidity-risk", "market-impact"],
  },

  // ── ML ─────────────────────────────────────────────────────────────────
  {
    id: "f-bayes",
    term: "Bayes' theorem",
    symbol: "P(A|B) = P(B|A)·P(A) / P(B)",
    domain: "formulas",
    definition:
      "**P(A)** the prior, **P(B|A)** the likelihood, **P(A|B)** the posterior. Updating a belief with evidence.",
    why: "The base rate P(A) is the term people drop. A test that is 99% accurate for a 1-in-10,000 event is still wrong most times it fires.",
    see: ["base-rate", "uncertainty"],
  },
  {
    id: "f-sigmoid-softmax",
    term: "Sigmoid & softmax",
    symbol: "σ(x) = 1/(1+e^(−x)) ,  softmax(z)_i = e^(z_i/τ) / Σ_j e^(z_j/τ)",
    domain: "formulas",
    definition:
      "**Sigmoid** maps one real number to (0,1). **Softmax** maps a vector of logits **z** to probabilities summing to 1, with temperature **τ** sharpening (τ<1) or flattening (τ>1) the result.",
    see: ["sigmoid", "temperature", "logistic-regression"],
  },
  {
    id: "f-cross-entropy",
    term: "Cross-entropy loss",
    symbol: "L = − Σ_i y_i · ln(ŷ_i)",
    domain: "formulas",
    definition:
      "**y** the true label (1 for the correct class, 0 elsewhere), **ŷ** the predicted probability. Penalises confident wrong answers without limit — ln(0) is −∞.",
    see: ["log-loss", "loss-function", "calibration"],
  },
  {
    id: "f-mse-mae-huber",
    term: "MSE, MAE and Huber",
    symbol: "MSE = mean((y−ŷ)²) ,  MAE = mean|y−ŷ| ,  Huber = ½e² if |e|≤δ else δ(|e|−½δ)",
    domain: "formulas",
    definition:
      "**e = y − ŷ** the error. MSE squares it so large misses dominate; MAE does not; **Huber** is squared near zero and linear beyond a threshold **δ**, taking the middle path.",
    see: ["rmse", "huber-loss", "loss-function"],
  },
  {
    id: "f-ridge-lasso",
    term: "Ridge & lasso objectives",
    symbol: "min ‖y − Xβ‖² + λ‖β‖²  (ridge) ,  + λ‖β‖₁  (lasso)",
    domain: "formulas",
    definition:
      "**λ** the regularisation strength — larger means a simpler model. The **L2** penalty shrinks coefficients smoothly; the **L1** penalty drives some to exactly zero and so selects features.",
    why: "Here λ is a regularisation strength. Two formulas above it was a price-impact coefficient. Same letter, unrelated jobs.",
    see: ["ridge-lasso", "regularization", "sym-lambda", "sym-norm"],
  },
  {
    id: "f-gradient-descent",
    term: "Gradient descent & Adam",
    symbol: "θ ← θ − η·∇_θ L ;  Adam: m̂/(√v̂ + ε)",
    domain: "formulas",
    definition:
      "**θ** the parameters, **η** the learning rate, **∇_θ L** the loss gradient. **Adam** divides by a running estimate of gradient magnitude — **m̂** the bias-corrected first moment, **v̂** the second, **ε** a stability floor around 1e−8.",
    see: ["gradient-descent", "optimizer", "learning-rate", "sym-eta"],
  },
  {
    id: "f-attention",
    term: "Scaled dot-product attention",
    symbol: "Attention(Q,K,V) = softmax(QKᵀ / √d_k) · V",
    domain: "formulas",
    definition:
      "**Q** queries, **K** keys, **V** values, **d_k** the key dimension. A weighted average of V, where the weights come from how well each query matches each key.",
    why: "The **√d_k** stops the dot products growing with dimension and saturating the softmax — without it, gradients vanish in wide models.",
    see: ["attention", "transformer", "sym-matrix-ops"],
  },
  {
    id: "f-bellman",
    term: "Bellman equation",
    symbol: "Q(s,a) = r + γ · max_{a'} Q(s',a')",
    domain: "formulas",
    definition:
      "**s** state, **a** action, **r** immediate reward, **γ** the discount factor, **s'** the next state. Value now equals reward now plus discounted best value next.",
    see: ["bellman-equation", "q-learning", "sym-gamma"],
  },
  {
    id: "f-shannon-entropy",
    term: "Entropy & KL divergence",
    symbol: "H(X) = −Σ p·log₂ p ,  KL(P‖Q) = Σ p·log(p/q)",
    domain: "formulas",
    definition:
      "**H** average surprise in bits, maximal when outcomes are equally likely. **KL** the extra cost of encoding P with a code built for Q — **not symmetric**, and infinite where q = 0 but p is not.",
    see: ["entropy", "kl-divergence", "wasserstein"],
  },
  {
    id: "f-silhouette",
    term: "Silhouette score",
    symbol: "s = (b − a) / max(a, b)",
    domain: "formulas",
    definition:
      "**a** the mean distance to points in the same cluster, **b** to the nearest OTHER cluster. Ranges −1 to 1; near zero means the point sits on a boundary.",
    see: ["silhouette", "clustering"],
  },

  // ── Statistics ─────────────────────────────────────────────────────────
  {
    id: "f-t-statistic",
    term: "t-statistic",
    symbol: "t = (x̄ − μ₀) / (s / √n)",
    domain: "formulas",
    definition:
      "**x̄** the sample mean, **μ₀** the null value, **s** the sample standard deviation, **n** the count. How many standard errors the estimate sits from the null.",
    why: "The √n is where overlapping samples do their damage: with overlap the effective n is far below the row count, and t is inflated by roughly √(overlap).",
    see: ["t-statistic", "standard-error", "overlapping-samples"],
  },
  {
    id: "f-jarque-bera",
    term: "Jarque–Bera",
    symbol: "JB = (n/6)·(S² + (K−3)²/4)",
    domain: "formulas",
    definition:
      "**n** sample size, **S** skewness, **K** raw kurtosis (so K−3 is excess). Chi-square with two degrees of freedom under normality.",
    why: "The n out front means it rejects with certainty on a million bars. Read S and K themselves, not JB.",
    see: ["jarque-bera", "kurtosis", "effect-size"],
  },
  {
    id: "f-hurst",
    term: "Hurst exponent",
    symbol: "Var(r^{(q)}) ∝ q^{2H}  ⇒  slope of ln Var on ln q = 2H",
    domain: "formulas",
    definition:
      "**q** the aggregation horizon, **H** the Hurst exponent. **H = 0.5** is a random walk (variance grows linearly); above is persistence, below anti-persistence.",
    see: ["hurst-exponent", "f-variance-ratio", "long-memory"],
  },
  {
    id: "f-cramers-v",
    term: "Cramér's V",
    symbol: "V = √( χ² / (n · min(r−1, c−1)) )",
    domain: "formulas",
    definition:
      "**χ²** the chi-square statistic, **n** the sample size, **r** and **c** the table's rows and columns. Association strength scaled to [0,1], **independent of sample size** — which χ² is not.",
    see: ["cramers-v", "chi-square", "effect-size"],
  },
];
