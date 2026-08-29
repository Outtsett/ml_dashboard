/**
 * Symbols — every Greek letter and operator, with all the jobs it does here.
 *
 * SRP: Data only. Merged by `../index.ts`.
 *
 * Greek letters are massively overloaded in this field: λ is a regularisation
 * strength, an eigenvalue, an arrival rate, a decay factor, a Lagrange
 * multiplier and a price-impact coefficient, and which one is meant is decided
 * entirely by context. So each entry lists EVERY meaning rather than picking
 * one, and says where each is used. That is the question a reader actually has
 * when a symbol appears on an axis with no legend.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  // ── Lower-case Greek ───────────────────────────────────────────────────
  {
    id: "sym-alpha",
    term: "α (alpha)",
    symbol: "α",
    domain: "notation",
    aliases: ["alpha"],
    definition:
      "**Portfolio**: return not explained by factor exposure. **Statistics**: the significance level, the Type I error rate you accept — 0.05 conventionally. **ML**: a learning rate in some notations, the leaky-ReLU slope, and the Dirichlet concentration parameter. **EWMA**: the smoothing weight on the newest observation.",
    see: ["alpha", "type-i-error", "learning-rate", "ewma-vol"],
  },
  {
    id: "sym-beta",
    term: "β (beta)",
    symbol: "β",
    domain: "notation",
    aliases: ["beta"],
    definition:
      "**Portfolio**: sensitivity to a benchmark or factor. **Regression**: a fitted coefficient. **Statistics**: the Type II error rate, so power is 1−β. **Adam**: β₁ and β₂ are the decay rates on the first and second moment estimates.",
    see: ["beta", "type-i-error", "optimizer", "power"],
  },
  {
    id: "sym-gamma",
    term: "γ (gamma)",
    symbol: "γ",
    domain: "notation",
    aliases: ["gamma"],
    definition:
      "**Options**: the second derivative of price with respect to spot — how fast delta moves. **RL**: the discount factor on future reward, near 1 for far-sighted agents. **SVM**: the RBF kernel width. **Focal loss**: the focusing exponent.",
    see: ["gamma", "reinforcement-learning", "kernel-method"],
  },
  {
    id: "sym-delta-lower",
    term: "δ (delta, lower case)",
    symbol: "δ",
    domain: "notation",
    aliases: ["delta"],
    definition:
      "**Options**: sensitivity to the underlying, and the hedge ratio. **Maths**: an arbitrarily small quantity, or the Kronecker delta δᵢⱼ which is 1 when i = j and 0 otherwise. **Huber loss**: the threshold where squared error becomes absolute. **RL**: the temporal-difference error.",
    see: ["delta", "huber-loss", "bellman-equation"],
  },
  {
    id: "sym-delta-upper",
    term: "Δ (Delta, upper case)",
    symbol: "Δ",
    domain: "notation",
    definition:
      "**A change or difference** in whatever follows it — Δp is a price change, ΔSharpe a difference between two models. Also written for option delta in some desks' notation, which is why the case matters.",
    see: ["sym-delta-lower", "log-return"],
  },
  {
    id: "sym-epsilon",
    term: "ε (epsilon)",
    symbol: "ε",
    domain: "notation",
    aliases: ["epsilon"],
    definition:
      "**Regression**: the error term, the part the model does not explain. **Numerics**: a tiny constant added to a denominator so a division cannot blow up. **RL**: the exploration rate in ε-greedy. **SVR**: the width of the tube inside which errors are not penalised.",
    see: ["residual", "exploration-exploitation", "svm"],
  },
  {
    id: "sym-zeta",
    term: "ζ (zeta)",
    symbol: "ζ",
    domain: "notation",
    definition:
      "Rare in this field. Appears as a damping ratio in control theory and as the Riemann zeta function in pure maths; if you see it here it is almost certainly a locally-defined constant.",
  },
  {
    id: "sym-eta",
    term: "η (eta)",
    symbol: "η",
    domain: "notation",
    aliases: ["eta"],
    definition:
      "**The learning rate** — the standard machine-learning symbol for how far each gradient step moves. Occasionally an efficiency or a viscosity elsewhere.",
    see: ["learning-rate", "gradient-descent"],
  },
  {
    id: "sym-theta-lower",
    term: "θ (theta, lower case)",
    symbol: "θ",
    domain: "notation",
    aliases: ["theta"],
    definition:
      "**ML**: the model's parameters, collectively — `θ` is what training adjusts. **Options**: time decay, what the option loses per day. **Maths**: an angle. Three completely unrelated jobs, and the field uses all three.",
    see: ["theta", "hyperparameter", "gradient-descent"],
  },
  {
    id: "sym-theta-upper",
    term: "Θ (Theta, upper case)",
    symbol: "Θ",
    domain: "notation",
    definition:
      "**Complexity**: a tight asymptotic bound — Θ(n log n) means the cost grows exactly at that rate, not merely no faster.",
    see: ["big-o"],
  },
  {
    id: "sym-kappa",
    term: "κ (kappa)",
    symbol: "κ",
    domain: "notation",
    aliases: ["kappa"],
    definition:
      "**Numerics**: the condition number of a matrix — how much it amplifies error, and therefore how untrustworthy its inverse is. **Statistics**: Cohen's κ, agreement corrected for chance. **Heston**: the speed at which variance reverts to its long-run level.",
    see: ["covariance-matrix", "stochastic-volatility", "ornstein-uhlenbeck"],
  },
  {
    id: "sym-lambda",
    term: "λ (lambda)",
    symbol: "λ",
    domain: "notation",
    aliases: ["lambda"],
    definition:
      "**The single most overloaded symbol in this field.** **Regularisation**: the penalty strength in ridge and lasso — larger λ, simpler model. **Linear algebra**: an eigenvalue. **Poisson**: the arrival rate, events per unit time. **EWMA / RiskMetrics**: the decay factor, 0.94 for daily. **Optimisation**: a Lagrange multiplier, the shadow price of a constraint. **Survival analysis**: the hazard rate. **Microstructure**: Kyle's λ, the price impact per unit of signed order flow.",
    why: "Which λ is meant is decided entirely by context. On an axis with no legend, check what the model is doing before assuming.",
    see: ["regularization", "kyles-lambda", "ewma-vol", "pca", "poisson"],
  },
  {
    id: "sym-mu",
    term: "μ (mu)",
    symbol: "μ",
    domain: "notation",
    aliases: ["mu"],
    definition:
      "**The mean**, or in a stochastic process the **drift** — the deterministic part of the change per unit time. In `dS/S = μ dt + σ dW`, μ is everything that is not randomness.",
    see: ["mean", "drift", "gbm"],
  },
  {
    id: "sym-nu",
    term: "ν (nu)",
    symbol: "ν",
    domain: "notation",
    aliases: ["nu"],
    definition:
      "**Degrees of freedom**, especially of a Student-t — small ν means fat tails, and below 4 the kurtosis is infinite. Also the symbol some desks use for vega, which is not a Greek letter at all.",
    see: ["fat-tail", "vega", "kurtosis"],
  },
  {
    id: "sym-xi",
    term: "ξ (xi)",
    symbol: "ξ",
    domain: "notation",
    definition:
      "**SVM**: a slack variable, how far one point is allowed to violate the margin. **Probability**: a generic random variable. **EVT**: the shape parameter of a generalised Pareto — positive means a heavy tail.",
    see: ["svm", "extreme-value-theory"],
  },
  {
    id: "sym-pi",
    term: "π (pi)",
    symbol: "π",
    domain: "notation",
    aliases: ["pi"],
    definition:
      "**RL**: the policy, the map from state to action — π(a|s). **Probability**: a probability or a mixture weight, as in a Gaussian mixture's component proportions. **Maths**: 3.14159…, and it does appear in real formulas here — bipower variation carries a π/2.",
    see: ["policy", "bipower-variation", "clustering"],
  },
  {
    id: "sym-rho",
    term: "ρ (rho)",
    symbol: "ρ",
    domain: "notation",
    aliases: ["rho"],
    definition:
      "**Statistics**: correlation, or autocorrelation at a lag. **Options**: sensitivity to the risk-free rate. **Time series**: the AR coefficient. **Spectral**: the spectral radius, the largest eigenvalue in magnitude.",
    see: ["correlation", "rho-rates", "autocorrelation", "arima"],
  },
  {
    id: "sym-sigma-lower",
    term: "σ (sigma, lower case)",
    symbol: "σ",
    domain: "notation",
    aliases: ["sigma"],
    definition:
      "**Standard deviation**, and in finance therefore **volatility**. Also written for the sigmoid function σ(x) = 1/(1+e⁻ˣ) in neural-network papers, which is a different thing entirely.",
    see: ["standard-deviation", "volatility", "sigmoid"],
  },
  {
    id: "sym-sigma-upper",
    term: "Σ (Sigma, upper case)",
    symbol: "Σ",
    domain: "notation",
    definition:
      "**Summation** over an index. Also **the covariance matrix**, universally, in portfolio and multivariate-Gaussian notation. Context separates them: Σᵢ with a subscript is a sum; a bare Σ in a matrix expression is covariance.",
    see: ["covariance-matrix", "mean-variance"],
  },
  {
    id: "sym-tau",
    term: "τ (tau)",
    symbol: "τ",
    domain: "notation",
    aliases: ["tau"],
    definition:
      "**A time constant or lag** — τ_int is the integrated autocorrelation time, the effective memory of a series. Also Kendall's τ, a rank correlation, and a softmax temperature in some notations.",
    see: ["integrated-autocorrelation-time", "spearman", "temperature", "half-life"],
  },
  {
    id: "sym-phi-lower",
    term: "φ (phi, lower case)",
    symbol: "φ",
    domain: "notation",
    aliases: ["phi"],
    definition:
      "**Time series**: the AR coefficient. **Probability**: the standard normal density φ(x). **ML**: a feature map, φ(x), the transform a kernel computes implicitly.",
    see: ["arima", "sym-phi-upper", "kernel-method"],
  },
  {
    id: "sym-phi-upper",
    term: "Φ (Phi, upper case)",
    symbol: "Φ",
    domain: "notation",
    definition:
      "**The standard normal CDF** — the probability a standard normal falls below x. Appears directly in the Black–Scholes formula, where Φ(d₂) is the risk-neutral probability of finishing in the money.",
    see: ["black-scholes", "sym-phi-lower", "risk-neutral"],
  },
  {
    id: "sym-chi",
    term: "χ (chi)",
    symbol: "χ²",
    domain: "notation",
    aliases: ["chi", "chi-squared"],
    definition:
      "**The chi-square distribution**, and the family of tests built on it — goodness of fit, independence in a contingency table, and the Jarque–Bera normality statistic.",
    see: ["chi-square", "jarque-bera"],
  },
  {
    id: "sym-psi",
    term: "ψ (psi)",
    symbol: "ψ",
    domain: "notation",
    definition:
      "**Wavelets**: the mother wavelet, the shape that gets scaled and shifted. **Statistics**: the digamma function, and the influence function in robust estimation.",
    see: ["wavelet", "robust-statistic"],
  },
  {
    id: "sym-omega-lower",
    term: "ω (omega, lower case)",
    symbol: "ω",
    domain: "notation",
    definition:
      "**Weights**, especially portfolio weights. **GARCH**: the constant term, the long-run variance floor. **Signal processing**: angular frequency.",
    see: ["garch", "mean-variance", "fourier"],
  },
  {
    id: "sym-omega-upper",
    term: "Ω (Omega, upper case)",
    symbol: "Ω",
    domain: "notation",
    definition:
      "**Probability**: the sample space, the set of everything that could happen. **Complexity**: an asymptotic lower bound. **Performance**: the Omega ratio, gains above a threshold over losses below it.",
    see: ["big-o", "sharpe-ratio"],
  },

  // ── Operators and conventions ──────────────────────────────────────────
  {
    id: "sym-expectation",
    term: "E[·]",
    symbol: "E[X]",
    domain: "notation",
    aliases: ["expectation", "expected value"],
    definition:
      "**The expected value** — the probability-weighted average of X. `E[·|·]` is conditional expectation, the average given that something is known, and is what almost every forecast formally is.",
    see: ["mean", "martingale", "risk-neutral"],
  },
  {
    id: "sym-variance-op",
    term: "Var(·), Cov(·), Corr(·)",
    symbol: "Var(X)",
    domain: "notation",
    definition:
      "**Var(X)** = E[(X−μ)²], the spread. **Cov(X,Y)** = E[(X−μₓ)(Y−μᵧ)], the co-movement in raw units. **Corr(X,Y)** = Cov/(σₓσᵧ), the same scaled to [−1,1].",
    see: ["variance", "covariance", "correlation"],
  },
  {
    id: "sym-sum-product",
    term: "Σ and Π (sum and product)",
    symbol: "Σᵢ xᵢ ,  Πᵢ xᵢ",
    domain: "notation",
    definition:
      "**Σ** adds a sequence, **Π** multiplies it. Log turns one into the other, which is why log-likelihoods are summed rather than likelihoods multiplied — a product of a million probabilities underflows to zero.",
    see: ["log-return", "sym-sigma-upper", "log-loss"],
  },
  {
    id: "sym-derivative",
    term: "∂ , d , ∇",
    symbol: "∂f/∂x , ∇f",
    domain: "notation",
    definition:
      "**∂** is a partial derivative, holding the other variables fixed; **d** is a total derivative. **∇f** (nabla, or *grad*) is the vector of all partials — the direction of steepest ascent, and what gradient descent walks down.",
    see: ["gradient-descent", "greeks", "backpropagation"],
  },
  {
    id: "sym-integral",
    term: "∫",
    symbol: "∫ f(x) dx",
    domain: "notation",
    definition:
      "**Integration** — the continuous analogue of a sum. An option price is an integral of payoff against a probability density, which is why closed forms exist only for simple payoffs.",
    see: ["risk-neutral", "black-scholes"],
  },
  {
    id: "sym-norm",
    term: "‖·‖ and |·|",
    symbol: "‖x‖₂ , |x|",
    domain: "notation",
    aliases: ["norm", "l1", "l2", "euclidean"],
    definition:
      "**|x|** is absolute value. **‖x‖₁** is the sum of absolute values (the L1 or Manhattan norm, which drives lasso's sparsity); **‖x‖₂** the square root of summed squares (L2 or Euclidean, which drives ridge's shrinkage); **‖x‖∞** the largest single element.",
    see: ["regularization", "ridge-lasso"],
  },
  {
    id: "sym-argmax",
    term: "argmax / argmin",
    symbol: "argmaxₓ f(x)",
    domain: "notation",
    definition:
      "**The input that maximises (or minimises) the function**, as opposed to `max`, which is the resulting value. A classifier's prediction is the argmax over class scores; the value is the score itself.",
    see: ["sigmoid", "loss-function"],
  },
  {
    id: "sym-hat-bar",
    term: "x̂ , x̄ , x̃ , x* , ẋ",
    symbol: "x̂ , x̄",
    domain: "notation",
    definition:
      "Decorations that carry meaning. **x̂** *hat* is an estimate or a prediction. **x̄** *bar* is a sample mean. **x̃** *tilde* is a transformed or surrogate version. **x\\*** *star* is the optimal value. **ẋ** *dot* is a derivative with respect to time.",
    why: "The hat is the one that matters most: σ is the true volatility and σ̂ is your estimate of it, and confusing them is how uncertainty disappears from a result.",
    see: ["standard-error", "uncertainty"],
  },
  {
    id: "sym-distributed",
    term: "~ and i.i.d.",
    symbol: "X ~ N(μ, σ²)",
    domain: "notation",
    definition:
      "**~** reads *is distributed as*. **i.i.d.** is *independent and identically distributed* — every observation drawn from the same distribution, none influencing another.",
    why: "i.i.d. is assumed almost everywhere and true almost nowhere in market data. Overlapping labels break independence; regime change breaks identical distribution.",
    see: ["overlapping-samples", "stationarity", "random-walk"],
  },
  {
    id: "sym-indicator",
    term: "𝟙 (indicator function)",
    symbol: "𝟙{condition}",
    domain: "notation",
    definition:
      "**1 when the condition holds, 0 otherwise.** Turns a logical test into arithmetic, which is how a hit rate becomes a mean: E[𝟙{profit > 0}].",
    see: ["hit-rate", "sym-expectation"],
  },
  {
    id: "sym-proportional",
    term: "∝ , ≈ , ≡ , ≫",
    symbol: "y ∝ x",
    domain: "notation",
    definition:
      "**∝** proportional to — equal up to a constant nobody cares about. **≈** approximately equal. **≡** identically equal, true by definition. **≫ / ≪** much greater or less than.",
  },
  {
    id: "sym-set",
    term: "∈ , ⊂ , ∪ , ∩ , ∀ , ∃",
    symbol: "x ∈ S",
    domain: "notation",
    definition:
      "**∈** is a member of; **⊂** is a subset of; **∪** union; **∩** intersection; **∀** for all; **∃** there exists. Set notation, used to state which observations a rule applies to.",
  },
  {
    id: "sym-matrix-ops",
    term: "ᵀ , ⁻¹ , ⊙ , ⊗",
    symbol: "Aᵀ , A⁻¹",
    domain: "notation",
    definition:
      "**Aᵀ** transpose, rows become columns. **A⁻¹** matrix inverse. **⊙** the Hadamard (element-wise) product — what a gating mechanism does. **⊗** the outer or Kronecker product.",
    why: "`A⁻¹` in a formula is usually a warning: inverting an ill-conditioned covariance matrix amplifies estimation noise enormously.",
    see: ["covariance-matrix", "sym-kappa", "shrinkage"],
  },
  {
    id: "big-o",
    term: "O(·) — big-O",
    symbol: "O(n log n)",
    domain: "notation",
    definition:
      "**How cost grows with size**, ignoring constants. O(n) linear, O(n²) quadratic — attention over a sequence is O(n²), which is precisely why long context is expensive.",
    see: ["transformer", "state-space-model", "sym-theta-upper"],
  },
  {
    id: "sym-log",
    term: "log vs ln vs log₂",
    symbol: "ln x , log₂ x",
    domain: "notation",
    definition:
      "**ln** is base e and is what *log* means in almost every finance and ML formula. **log₂** appears in information theory, where the unit is bits. **log₁₀** appears on chart axes.",
    why: "The Parkinson constant 4 ln 2 mixes both: a natural log of the number two.",
    see: ["log-return", "entropy", "parkinson-estimator"],
  },
  {
    id: "sym-probability-measure",
    term: "ℙ and ℚ",
    symbol: "ℙ , ℚ",
    domain: "notation",
    definition:
      "**ℙ** is the real-world (physical) probability measure — what actually happens. **ℚ** is the risk-neutral measure — what prices imply. **They are not the same**, and their difference is the risk premium.",
    see: ["risk-neutral", "variance-risk-premium"],
  },
  {
    id: "sym-limits",
    term: "lim , sup , inf",
    symbol: "limₙ→∞",
    domain: "notation",
    definition:
      "**lim** the value approached in a limit. **sup** the least upper bound — like a maximum, but defined even when no element attains it; **inf** its mirror.",
    see: ["law-of-large-numbers"],
  },
  {
    id: "poisson",
    term: "Poisson process",
    symbol: "P(N = k) = λᵏe⁻λ / k!",
    domain: "notation",
    definition:
      "Counts of independent events arriving at a constant rate λ. **The default model for order arrivals and for jumps**, and its inter-arrival times are exponential.",
    why: "Real order flow is clustered, not Poisson — arrivals excite further arrivals, which is what Hawkes processes exist to model.",
    see: ["sym-lambda", "jump-diffusion", "order-flow-imbalance"],
  },
];
