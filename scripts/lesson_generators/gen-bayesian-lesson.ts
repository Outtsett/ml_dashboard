export default {
  id: "gen-bayesian",
  title: "Bayesian Inference",
  description: "Master Bayesian inference from first principles: derive Bayes' theorem, construct conjugate priors, compute posteriors analytically and via MCMC, interpret credible intervals, and apply Bayesian model comparison to quantify parameter uncertainty in forex trading strategies.",
  estimatedMinutes: 80,
  difficulty: "advanced",
  relatedModels: ["bayesian-regression"],
  sections: [
    {
      type: "objective",
      content: "This lesson builds a rigorous understanding of Bayesian inference — the framework that treats parameters as random variables with probability distributions rather than fixed unknowns. You will derive Bayes' theorem from joint probability axioms, master conjugate prior families for tractable posterior computation, implement MCMC sampling for intractable posteriors, and apply Bayesian model comparison to real forex strategy evaluation. By the end, you will be able to quantify parameter uncertainty in any statistical model and make probabilistically-calibrated trading decisions.",
      keyTakeaways: [
        "Derive Bayes' theorem from the definition of conditional probability and interpret each component: prior, likelihood, evidence, and posterior.",
        "Select appropriate priors — conjugate priors for analytical tractability, weakly informative priors when domain knowledge is limited — and understand how prior choice affects posterior inference.",
        "Compute the full Normal-Normal conjugate posterior analytically, including posterior mean as a precision-weighted average of prior and data.",
        "Distinguish Bayesian credible intervals (probability statements about parameters) from frequentist confidence intervals (probability statements about the procedure).",
        "Implement Metropolis-Hastings MCMC to sample from arbitrary posterior distributions when conjugate solutions are unavailable.",
        "Calculate and interpret Bayes factors for model comparison, understanding the automatic Occam's razor penalty for model complexity.",
        "Apply Bayesian parameter estimation to forex strategy returns, producing full posterior distributions over expected return and risk rather than single point estimates.",
        "Recognize when Bayesian methods provide material advantages over frequentist alternatives: small samples, sequential updating, hierarchical models, and decision-theoretic frameworks."
      ]
    },
    {
      type: "theory",
      title: "Bayes' Theorem: Derivation and Interpretation",
      content: `We derive Bayes' theorem from the axioms of probability theory — specifically from the definition of conditional probability and the symmetry of joint distributions.

**Step 1: Joint Probability Decomposition.** For any two events (or random variables) θ and D, the joint probability can be factored in two equivalent ways:

  p(θ, D) = p(D | θ) · p(θ)     ... (factoring: data given parameter × parameter prior)
  p(θ, D) = p(θ | D) · p(D)     ... (factoring: parameter given data × data marginal)

**Step 2: Equating and Solving.** Since both expressions equal p(θ, D), we set them equal:

  p(θ | D) · p(D) = p(D | θ) · p(θ)

Dividing both sides by p(D) (assuming p(D) > 0):

  p(θ | D) = p(D | θ) · p(θ) / p(D)

This is Bayes' theorem. Each term has a precise name and interpretation:

• **Posterior p(θ | D):** Our updated belief about θ after observing data D. This is what we want to compute.
• **Likelihood p(D | θ):** The probability of observing data D if the parameter value were θ. This is the same function used in maximum likelihood estimation, but here it is treated as a function of θ for fixed D.
• **Prior p(θ):** Our belief about θ before seeing data. Encodes domain knowledge, previous experiments, or deliberate agnosticism.
• **Evidence p(D):** The marginal likelihood of the data, computed by integrating (or summing) the likelihood over all possible parameter values weighted by the prior:

  p(D) = ∫ p(D | θ) · p(θ) dθ

The evidence acts as a normalizing constant ensuring the posterior integrates to 1. It does not depend on θ, so for parameter estimation we often write: p(θ | D) ∝ p(D | θ) · p(θ).

**Step 3: Concrete Numerical Example — Coin Flipping.**

Suppose we want to estimate the probability of heads θ for a possibly-biased coin.

Prior: We choose a Beta(2, 2) prior, which is symmetric and mildly informative — it says we believe the coin is roughly fair but allows considerable uncertainty. The Beta(2,2) PDF is p(θ) = 6·θ·(1−θ) for θ ∈ [0,1], with prior mean = α/(α+β) = 2/4 = 0.5.

Data: We flip the coin 10 times and observe 7 heads (k=7) and 3 tails.

Likelihood: For a binomial experiment, p(D | θ) = C(10,7) · θ⁷ · (1−θ)³.

Posterior: Because the Beta distribution is conjugate to the Binomial likelihood, the posterior is also Beta:

  posterior = Beta(α + k, β + n − k) = Beta(2 + 7, 2 + 3) = Beta(9, 5)

The posterior mean is 9/(9+5) = 9/14 ≈ 0.643. The MAP (mode) estimate is (α−1)/(α+β−2) = 8/12 ≈ 0.667.

Compare with the maximum likelihood estimate (MLE), which ignores the prior: MLE = k/n = 7/10 = 0.700.

The Bayesian posterior mean (0.643) is pulled toward 0.5 relative to the MLE (0.700) because the Beta(2,2) prior contributes an effective 2 "prior heads" and 2 "prior tails." With only 10 observations, the prior still exerts noticeable regularization. As n → ∞, the posterior concentrates around the MLE and the prior becomes irrelevant — this is Bayesian consistency.

**Assumptions and Limitations:** Bayes' theorem is a mathematical identity — it is always true given the axioms of probability. The modeling assumptions enter through the choice of likelihood function (e.g., assuming i.i.d. Bernoulli trials) and prior (e.g., Beta(2,2)). Misspecified likelihoods or priors will produce misleading posteriors. In financial applications, the i.i.d. assumption is often violated (returns exhibit autocorrelation, volatility clustering), requiring more sophisticated likelihood models.`
    },
    {
      type: "theory",
      title: "Conjugate Priors and the Normal-Normal Model",
      content: `A prior distribution p(θ) is said to be **conjugate** to a likelihood p(D|θ) if the resulting posterior p(θ|D) belongs to the same distributional family as the prior. Conjugacy is powerful because it gives us closed-form posterior updates — no numerical integration or MCMC required.

**Major Conjugate Families:**

| Likelihood       | Conjugate Prior        | Posterior              |
|-------------------|------------------------|------------------------|
| Binomial          | Beta(α, β)             | Beta(α+k, β+n−k)      |
| Poisson           | Gamma(α, β)            | Gamma(α+Σxᵢ, β+n)     |
| Normal (known σ²) | Normal(μ₀, τ₀²)       | Normal(μₙ, τₙ²)       |
| Normal (known μ)  | Inverse-Gamma(α, β)    | Inverse-Gamma(α', β')  |
| Multinomial        | Dirichlet(α₁,…,αₖ)    | Dirichlet(α₁+n₁,…)    |

**Full Normal-Normal Derivation (known variance σ²):**

Setup: We observe n data points x₁, x₂, …, xₙ drawn i.i.d. from N(μ, σ²) where σ² is known. We want to infer the unknown mean μ.

Prior: μ ~ N(μ₀, τ₀²)

  p(μ) ∝ exp(−(μ − μ₀)² / (2τ₀²))

Likelihood: p(x₁,…,xₙ | μ) = ∏ᵢ (1/√(2πσ²)) exp(−(xᵢ−μ)²/(2σ²))

Taking the log and collecting terms in μ:

  log p(D|μ) = −n/(2σ²) · (μ² − 2μx̄ + …) + const   where x̄ = (1/n)Σxᵢ

  This is proportional to: exp(−n(μ − x̄)²/(2σ²))

Posterior ∝ likelihood × prior:

  log p(μ|D) ∝ −(μ − μ₀)²/(2τ₀²) − n(μ − x̄)²/(2σ²)

Expanding both quadratics in μ:

  = −μ²/(2τ₀²) + μ·μ₀/τ₀² − μ₀²/(2τ₀²) − nμ²/(2σ²) + nμx̄/σ² − nx̄²/(2σ²)

Collecting terms in μ² and μ:

  = −μ²/2 · (1/τ₀² + n/σ²) + μ · (μ₀/τ₀² + nx̄/σ²) + const

This is a quadratic in μ, so the posterior is Normal. Define the posterior precision and mean:

  **Posterior precision:** 1/τₙ² = 1/τ₀² + n/σ²

  **Posterior variance:** τₙ² = 1 / (1/τ₀² + n/σ²)

  **Posterior mean:** μₙ = τₙ² · (μ₀/τ₀² + nx̄/σ²)

Therefore: μ | D ~ N(μₙ, τₙ²)

**Key insight:** The posterior mean μₙ is a **precision-weighted average** of the prior mean and the data mean. If the prior precision 1/τ₀² is large (strong prior), μₙ ≈ μ₀. If the data precision n/σ² is large (lots of data or low noise), μₙ ≈ x̄.

**Numerical Example — Forex Daily Returns:**

Suppose we model daily EUR/USD log-returns as N(μ, σ²) with known σ = 0.008 (80 pips daily vol).

Prior: We set μ₀ = 0 (no expected drift) with τ₀ = 0.01 (prior std = 100 pips annualized ≈ 0.01 daily).

Data: We observe n = 100 trading days with sample mean x̄ = 0.0003 (i.e., 3 pips average daily return).

Step-by-step computation:

  Prior precision: 1/τ₀² = 1/(0.01)² = 10,000

  Data precision: n/σ² = 100/(0.008)² = 100/0.000064 = 1,562,500

  Posterior precision: 1/τₙ² = 10,000 + 1,562,500 = 1,572,500

  Posterior variance: τₙ² = 1/1,572,500 ≈ 6.359 × 10⁻⁷

  Posterior std: τₙ ≈ 0.000798

  Posterior mean: μₙ = τₙ² × (0/0.0001 + 100×0.0003/0.000064)
                      = 6.359×10⁻⁷ × (0 + 468,750)
                      = 0.000298

So the posterior is μ | D ~ N(0.000298, 0.000798²). The posterior mean (0.000298) is very close to the sample mean (0.0003) because the data precision (1,562,500) vastly dominates the prior precision (10,000). The prior barely matters here — 100 days of data overwhelm the prior belief. However, with only n = 5 days of data, the data precision would be 5/0.000064 = 78,125, and the posterior mean would shift noticeably toward zero.`
    },
    {
      type: "theory",
      title: "Credible Intervals vs Confidence Intervals",
      content: `These two interval types answer fundamentally different questions, and confusing them is one of the most common errors in applied statistics.

**Bayesian Credible Interval (CrI):** A 95% credible interval [a, b] satisfies:

  P(θ ∈ [a, b] | D) = 0.95

Interpretation: "Given the observed data, there is a 95% probability that the parameter θ lies in [a, b]." This is a direct probability statement about the parameter. The interval is computed from the posterior distribution p(θ|D).

**Frequentist Confidence Interval (CI):** A 95% CI is constructed by a procedure such that, if the experiment were repeated many times, 95% of the resulting intervals would contain the true θ.

Interpretation: "If I repeated this experiment infinitely many times and computed a CI each time, 95% of those intervals would contain the true value." It does NOT mean there is a 95% probability that θ is in this particular interval. For any specific CI, θ is either in it or not — the probability is 0 or 1 in the frequentist framework.

**Concrete Example:** Suppose from our forex data we compute:

  Bayesian 95% CrI for μ: [0.000298 − 1.96×0.000798, 0.000298 + 1.96×0.000798] = [−0.001266, 0.001862]

  (Since the posterior is Normal, the equal-tailed CrI uses the same z = 1.96 formula.)

  Frequentist 95% CI for μ: x̄ ± 1.96·σ/√n = 0.0003 ± 1.96×0.008/√100 = 0.0003 ± 0.001568 = [−0.001268, 0.001868]

These intervals are nearly identical numerically because the prior is weak relative to the data. But the interpretations differ:

  • Bayesian CrI: "There is a 95% posterior probability that the true mean daily return lies in [−0.00127, 0.00186]."
  • Frequentist CI: "This interval was produced by a procedure that covers the true mean 95% of the time in repeated sampling."

The Bayesian interpretation is what most practitioners actually want — a probability statement about the parameter given their data.

**Highest Posterior Density (HPD) Interval:** The HPD interval is the shortest interval containing 95% posterior probability. For a symmetric, unimodal posterior (like a Normal), the HPD equals the equal-tailed interval. For skewed posteriors (e.g., Beta(9, 5) from our coin example), the HPD is shorter than the equal-tailed interval.

For Beta(9, 5): The posterior mean is 0.643, mode is 0.667. The equal-tailed 95% interval is approximately [0.387, 0.862]. The 95% HPD interval is approximately [0.399, 0.868] — shifted slightly right toward the mode.

**Financial Implication:** In trading, the Bayesian CrI lets you make direct statements like "There is a 90% probability that the strategy's Sharpe ratio exceeds 0.5." A frequentist CI cannot make this claim without additional philosophical gymnastics. This makes Bayesian intervals more natural for risk management and position sizing, where you need to quantify the probability of adverse parameter values.

**Limitations:** The CrI interpretation depends on the model being correctly specified — if the likelihood or prior is wrong, the stated probability may not be calibrated. In practice, posterior calibration should be checked via simulation or posterior predictive checks.`
    },
    {
      type: "theory",
      title: "Bayesian Model Comparison and Bayes Factors",
      content: `Bayesian model comparison provides a principled framework for choosing between competing models that automatically penalizes unnecessary complexity — an effect called the automatic Occam's razor.

**Marginal Likelihood (Model Evidence):** For a model M with parameters θ, the marginal likelihood is:

  p(D | M) = ∫ p(D | θ, M) · p(θ | M) dθ

This integral averages the likelihood over the entire prior distribution of parameters. Models that spread their prior over a wide parameter space (complex models) are penalized because much of that space will have low likelihood. Simple models concentrate their prior on a smaller region, and if the data falls in that region, they achieve a higher marginal likelihood per unit of prior probability.

**Bayes Factor:** To compare two models M₁ and M₂, we compute the Bayes factor:

  BF₁₂ = p(D | M₁) / p(D | M₂)

The Bayes factor updates the prior odds to posterior odds:

  p(M₁ | D) / p(M₂ | D) = BF₁₂ × p(M₁) / p(M₂)

If we assign equal prior probabilities to both models, then BF₁₂ equals the posterior odds ratio.

**Jeffreys' Scale for Interpreting Bayes Factors:**

| BF₁₂           | Evidence for M₁          |
|-----------------|--------------------------|
| 1 – 3           | Barely worth mentioning   |
| 3 – 10          | Substantial               |
| 10 – 30         | Strong                    |
| 30 – 100        | Very strong               |
| > 100           | Decisive                  |

**Automatic Occam's Razor — Worked Example:**

Consider fitting daily forex returns to two models:
  M₁: Returns ~ N(μ, σ²) — constant mean (2 parameters: μ, σ)
  M₂: Returns ~ N(α + βt, σ²) — linear time trend (3 parameters: α, β, σ)

M₂ is strictly more flexible (it reduces to M₁ when β = 0). However, the prior for M₂ must spread probability over all possible (α, β) pairs. If the true data-generating process has no trend, then most of that (α, β) prior mass is wasted on β ≠ 0 values that fit the data poorly.

Suppose we compute (using numerical integration or BIC approximation):
  log p(D | M₁) = −245.3
  log p(D | M₂) = −248.1

  log BF₁₂ = −245.3 − (−248.1) = 2.8
  BF₁₂ = exp(2.8) ≈ 16.4

By Jeffreys' scale, this is "strong" evidence favoring M₁ (constant mean) over M₂ (linear trend). The extra parameter in M₂ is not justified by the data.

**BIC Approximation:** When exact marginal likelihoods are intractable, the Bayesian Information Criterion provides an approximation:

  log p(D | M) ≈ log p(D | θ_MLE, M) − (k/2) · log(n)

where k is the number of parameters and n is the sample size. The BIC penalty k/2·log(n) approximates the Occam factor.

  2 · log BF₁₂ ≈ BIC₂ − BIC₁

**Application to Forex Strategy Selection:** When backtesting multiple strategy variants (e.g., different numbers of technical indicators, lookback periods), Bayesian model comparison via Bayes factors or BIC penalizes overfitted strategies that use too many parameters. This is more principled than simply choosing the strategy with the highest backtest Sharpe ratio, which favors overfitting. A strategy with a slightly lower backtest Sharpe but substantially higher marginal likelihood is more likely to perform well out-of-sample.`
    },
    {
      type: "intuition",
      title: "Bayesian Updating as a Detective Investigation",
      analogy: "Bayesian inference is like a detective updating their suspect list as new evidence arrives.",
      content: `Imagine a detective investigating a crime. Before any evidence is collected, the detective has a list of possible suspects with initial suspicion levels — this is the **prior**. Maybe the detective initially suspects the butler (40%), the gardener (35%), and the chef (25%) based on general experience and opportunity.

Then forensic evidence arrives: muddy footprints matching size-12 boots. The detective asks: "How likely would I see these footprints IF the butler did it? IF the gardener did it? IF the chef did it?" These conditional probabilities are the **likelihood**. The butler wears size 9 (low likelihood), the gardener wears size 12 (high likelihood), the chef wears size 11 (medium likelihood).

The detective now multiplies each suspect's prior probability by their likelihood and re-normalizes. The gardener's posterior probability jumps to, say, 70%, while the butler's drops to 10%. This multiplication-and-normalization step IS Bayes' theorem.

Crucially, the detective doesn't throw away the prior when new evidence arrives — they update it. If ten more pieces of evidence all point to the gardener, the posterior converges regardless of the initial prior. This is exactly what happens with financial data: a strong prior (e.g., "markets are efficient, expected return ≈ 0") gets overwhelmed by enough contradictory data, but protects us from overreacting to small samples.

The **evidence** p(D) in this analogy is the overall probability of seeing size-12 footprints regardless of who the criminal is — it's what makes the posterior probabilities sum to 1. The detective doesn't usually compute this explicitly; they just compare relative suspicions and normalize. Similarly, in Bayesian computation, we often work with the unnormalized posterior p(θ|D) ∝ p(D|θ)·p(θ) and let MCMC handle the normalization.`,
      emoji: "🔍"
    },
    {
      type: "intuition",
      title: "Priors as Rubber Bands",
      analogy: "A prior distribution is like a rubber band anchoring your estimate — weak priors stretch easily, strong priors resist the data.",
      content: `Picture your parameter estimate as a ball on a track. The prior is a rubber band attached to the ball and anchored at your prior belief (say, μ₀ = 0 for "no expected return"). The data pulls the ball toward the sample mean (x̄ = 0.0003 in our forex example).

A **strong prior** (small τ₀², high precision) is a thick, stiff rubber band. Even with 100 data points pulling toward x̄ = 0.0003, the ball barely moves from zero. You'd need overwhelming evidence to shift your belief.

A **weak prior** (large τ₀², low precision) is a thin, stretchy rubber band. Even a few data points can pull the ball almost all the way to the sample mean. The rubber band offers almost no resistance.

The **posterior mean** is where the ball settles — the equilibrium point where the pull from the data exactly balances the pull from the prior. Mathematically, this is the precision-weighted average: μₙ = (prior precision × μ₀ + data precision × x̄) / total precision.

Here's the key financial insight: in forex, we know daily expected returns are tiny relative to volatility (signal-to-noise ratio ≈ 0.05). A strong prior toward zero return is actually well-calibrated — it protects us from data-mining biases where a short backtest shows a "significant" positive return that's really just noise. The rubber band toward zero IS our regularization against overfitting.

As you collect more data, the data's pull grows (precision scales linearly with n), while the rubber band's pull stays fixed. Eventually, with enough data, even the stiffest rubber band can't resist — the posterior converges to the truth. This is the Bayesian consistency guarantee: the prior washes out asymptotically, but it protects you when data is scarce.`,
      emoji: "🎯"
    },
    {
      type: "code",
      title: "Normal-Normal Conjugate Posterior with Visualization",
      language: "python",
      code: `import numpy as np
import matplotlib.pyplot as plt
from scipy import stats

# ============================================================
# Normal-Normal Conjugate Update for Forex Daily Returns
# ============================================================
np.random.seed(42)

# --- Prior parameters ---
mu_0 = 0.0          # prior mean: no expected drift
tau_0 = 0.01         # prior std: 100 pips annualized
prior_precision = 1.0 / tau_0**2  # = 10,000

# --- Known data parameters ---
sigma = 0.008        # known daily volatility (80 pips)

# --- Simulate observed data ---
true_mu = 0.0003     # true daily mean return (3 pips)
n = 100              # 100 trading days
data = np.random.normal(true_mu, sigma, size=n)
x_bar = data.mean()
print(f"Sample mean: {x_bar:.6f}  (true mu = {true_mu})")
print(f"Sample size: {n}, Known sigma: {sigma}")

# --- Conjugate posterior computation ---
data_precision = n / sigma**2
posterior_precision = prior_precision + data_precision
tau_n_sq = 1.0 / posterior_precision
tau_n = np.sqrt(tau_n_sq)
mu_n = tau_n_sq * (mu_0 / tau_0**2 + n * x_bar / sigma**2)

print(f"\\nPrior:     N({mu_0}, {tau_0}^2)  | precision = {prior_precision:,.0f}")
print(f"Data:      precision = n/sigma^2 = {data_precision:,.0f}")
print(f"Posterior: N({mu_n:.6f}, {tau_n:.6f}^2)")
print(f"Posterior precision: {posterior_precision:,.0f}")
print(f"Prior weight: {prior_precision/posterior_precision:.4f}")
print(f"Data weight:  {data_precision/posterior_precision:.4f}")

# --- 95% credible interval ---
ci_low = mu_n - 1.96 * tau_n
ci_high = mu_n + 1.96 * tau_n
print(f"\\n95% Credible Interval: [{ci_low:.6f}, {ci_high:.6f}]")
print(f"True mu in CrI? {ci_low <= true_mu <= ci_high}")

# --- Sequential updating: show posterior after 5, 20, 50, 100 obs ---
fig, ax = plt.subplots(figsize=(10, 6))
theta_grid = np.linspace(-0.003, 0.003, 500)

ax.plot(theta_grid, stats.norm.pdf(theta_grid, mu_0, tau_0),
        'k--', lw=2, label=f'Prior N({mu_0}, {tau_0}²)')

colors = ['#2196F3', '#FF9800', '#4CAF50', '#F44336']
for i, n_obs in enumerate([5, 20, 50, 100]):
    x_bar_i = data[:n_obs].mean()
    dp = n_obs / sigma**2
    post_prec = prior_precision + dp
    post_var = 1.0 / post_prec
    post_mean = post_var * (mu_0 / tau_0**2 + n_obs * x_bar_i / sigma**2)
    post_std = np.sqrt(post_var)
    pdf_vals = stats.norm.pdf(theta_grid, post_mean, post_std)
    ax.plot(theta_grid, pdf_vals, color=colors[i], lw=2,
            label=f'Posterior n={n_obs}: N({post_mean:.5f}, {post_std:.5f}²)')

ax.axvline(true_mu, color='red', ls=':', lw=1.5, label=f'True μ = {true_mu}')
ax.set_xlabel('μ (daily mean return)')
ax.set_ylabel('Density')
ax.set_title('Bayesian Normal-Normal Conjugate Update\\n(Sequential Posterior Concentration)')
ax.legend(fontsize=8)
plt.tight_layout()
plt.savefig('normal_normal_posterior.png', dpi=150)
plt.show()
print("\\nPlot saved to normal_normal_posterior.png")`,
      explanation: "This code implements the full Normal-Normal conjugate update derived in Theory 2. It simulates forex daily returns, computes the posterior analytically, prints all intermediate precision calculations, and visualizes how the posterior concentrates around the true mean as more data arrives. The sequential updating plot shows the prior (dashed) evolving through n=5, 20, 50, 100 observations — demonstrating how data precision overwhelms prior precision."
    },
    {
      type: "code",
      title: "Metropolis-Hastings MCMC for Forex Strategy Parameters",
      language: "python",
      code: `import numpy as np
import matplotlib.pyplot as plt

# ============================================================
# Metropolis-Hastings MCMC: Infer mean and std of forex returns
# When conjugacy is unavailable (e.g., unknown variance),
# we sample from the joint posterior p(mu, sigma | data).
# ============================================================
np.random.seed(123)

# --- Simulate forex strategy daily returns ---
true_mu = 0.0004      # true daily return (4 pips)
true_sigma = 0.012     # true daily volatility
n_obs = 200
returns = np.random.normal(true_mu, true_sigma, size=n_obs)
print(f"Simulated {n_obs} returns: mean={returns.mean():.6f}, std={returns.std():.6f}")
print(f"True params: mu={true_mu}, sigma={true_sigma}")

# --- Log-posterior (unnormalized) ---
def log_posterior(mu, log_sigma, data):
    """Joint log-posterior for Normal(mu, sigma^2) with weakly informative priors."""
    sigma = np.exp(log_sigma)  # ensure sigma > 0 via log transform
    if sigma < 1e-10:
        return -np.inf
    # Prior: mu ~ N(0, 0.01^2), log(sigma) ~ N(log(0.01), 0.5^2)
    lp_mu = -0.5 * (mu / 0.01)**2
    lp_sigma = -0.5 * ((log_sigma - np.log(0.01)) / 0.5)**2
    # Likelihood: data ~ N(mu, sigma^2)
    n = len(data)
    lp_data = -n * np.log(sigma) - 0.5 * np.sum((data - mu)**2) / sigma**2
    return lp_mu + lp_sigma + lp_data

# --- Metropolis-Hastings sampler ---
n_samples = 50_000
burn_in = 10_000
samples = np.zeros((n_samples, 2))  # columns: mu, log_sigma
proposal_scale = np.array([0.0003, 0.02])  # tuned proposal std

# Initialize at MLE
samples[0] = [returns.mean(), np.log(returns.std())]
current_lp = log_posterior(samples[0, 0], samples[0, 1], returns)
accepted = 0

for i in range(1, n_samples):
    # Propose: symmetric random walk
    proposal = samples[i-1] + proposal_scale * np.random.randn(2)
    prop_lp = log_posterior(proposal[0], proposal[1], returns)
    # Accept/reject
    log_alpha = prop_lp - current_lp
    if np.log(np.random.rand()) < log_alpha:
        samples[i] = proposal
        current_lp = prop_lp
        accepted += 1
    else:
        samples[i] = samples[i-1]

accept_rate = accepted / n_samples
print(f"\\nAcceptance rate: {accept_rate:.3f} (target: 0.20-0.45)")

# --- Extract post-burn-in samples ---
mu_samples = samples[burn_in:, 0]
sigma_samples = np.exp(samples[burn_in:, 1])

print(f"\\nPosterior mu:    mean={mu_samples.mean():.6f}, std={mu_samples.std():.6f}")
print(f"  95% CrI: [{np.percentile(mu_samples, 2.5):.6f}, {np.percentile(mu_samples, 97.5):.6f}]")
print(f"Posterior sigma: mean={sigma_samples.mean():.6f}, std={sigma_samples.std():.6f}")
print(f"  95% CrI: [{np.percentile(sigma_samples, 2.5):.6f}, {np.percentile(sigma_samples, 97.5):.6f}]")

# --- Probability that strategy is profitable ---
prob_positive = (mu_samples > 0).mean()
print(f"\\nP(mu > 0 | data) = {prob_positive:.4f}")
ann_sharpe = mu_samples / sigma_samples * np.sqrt(252)
print(f"Posterior annualized Sharpe: mean={ann_sharpe.mean():.3f}, "
      f"95% CrI=[{np.percentile(ann_sharpe, 2.5):.3f}, {np.percentile(ann_sharpe, 97.5):.3f}]")

# --- Plot posterior distributions ---
fig, axes = plt.subplots(1, 3, figsize=(15, 4))
axes[0].plot(mu_samples[:2000], alpha=0.5, lw=0.5)
axes[0].axhline(true_mu, color='r', ls='--', label=f'True μ={true_mu}')
axes[0].set_title('Trace: μ'); axes[0].legend()
axes[1].hist(mu_samples, bins=80, density=True, alpha=0.7, color='steelblue')
axes[1].axvline(true_mu, color='r', ls='--', lw=2)
axes[1].set_title('Posterior: μ')
axes[2].hist(sigma_samples, bins=80, density=True, alpha=0.7, color='coral')
axes[2].axvline(true_sigma, color='r', ls='--', lw=2)
axes[2].set_title('Posterior: σ')
plt.tight_layout()
plt.savefig('mcmc_posterior.png', dpi=150)
plt.show()
print("Plot saved to mcmc_posterior.png")`,
      explanation: "This code implements a full Metropolis-Hastings MCMC sampler for the joint posterior of mean and volatility of forex strategy returns. It uses log-transformed sigma to enforce positivity, weakly informative priors, and a symmetric random-walk proposal. After burn-in, it extracts posterior summaries including the probability that the strategy is profitable P(μ>0|data) and the full posterior distribution of the annualized Sharpe ratio — quantities that are impossible to obtain from frequentist point estimates alone."
    },
    {
      type: "code",
      title: "Bayesian Model Comparison with Bayes Factors",
      language: "python",
      code: `import numpy as np
from scipy import stats
from scipy.integrate import quad

# ============================================================
# Bayesian Model Comparison: Constant Mean vs Trending Mean
# for forex returns, using exact marginal likelihoods and BIC
# ============================================================
np.random.seed(77)

# --- Simulate data under M1 (constant mean, no trend) ---
n = 250        # 1 year of trading days
true_mu = 0.0002
true_sigma = 0.01
t = np.arange(n, dtype=float)
returns = np.random.normal(true_mu, true_sigma, size=n)
print(f"Data: {n} observations, sample mean={returns.mean():.6f}, std={returns.std():.5f}")

# === Model 1: Returns ~ N(mu, sigma^2), constant mean ===
# Marginal likelihood with Normal prior on mu: mu ~ N(0, tau^2)
tau_prior = 0.005  # prior std for mu

def log_marginal_M1(data, sigma, tau):
    """Analytical marginal likelihood for Normal-Normal model."""
    n = len(data)
    x_bar = data.mean()
    # p(D|M1) = prod_i N(x_i; 0, sigma^2 + tau^2) ... but sequential is better
    # Use the known formula: log p(D|M1) for conjugate Normal
    post_var = 1.0 / (1.0/tau**2 + n/sigma**2)
    post_mean = post_var * (n * x_bar / sigma**2)
    # log marginal = log N(x_bar; 0, sigma^2/n + tau^2)
    marginal_var = sigma**2 / n + tau**2
    log_ml = stats.norm.logpdf(x_bar, 0, np.sqrt(marginal_var))
    # Correction: exact marginal = product of predictive densities
    # For simplicity, use the sufficient-statistic formula:
    log_ml = (-n/2) * np.log(2*np.pi*sigma**2)
    log_ml += -0.5 * np.sum(data**2) / sigma**2
    log_ml += 0.5 * np.log(post_var / tau**2)
    log_ml += 0.5 * post_mean**2 / post_var
    return log_ml

lml_M1 = log_marginal_M1(returns, true_sigma, tau_prior)
print(f"\\nLog marginal likelihood M1 (constant): {lml_M1:.2f}")

# === Model 2: Returns_t ~ N(alpha + beta*t, sigma^2), linear trend ===
# Use BIC approximation since exact integral is harder
# MLE for M2:
X = np.column_stack([np.ones(n), t])
beta_hat = np.linalg.lstsq(X, returns, rcond=None)[0]
resid = returns - X @ beta_hat
sse = np.sum(resid**2)
log_lik_M2 = -n/2 * np.log(2*np.pi*true_sigma**2) - sse / (2*true_sigma**2)

# MLE for M1:
log_lik_M1 = -n/2 * np.log(2*np.pi*true_sigma**2) - np.sum((returns - returns.mean())**2) / (2*true_sigma**2)

# BIC = -2*loglik + k*log(n)
k_M1, k_M2 = 1, 2  # number of mean parameters
bic_M1 = -2 * log_lik_M1 + k_M1 * np.log(n)
bic_M2 = -2 * log_lik_M2 + k_M2 * np.log(n)

print(f"\\n--- BIC Approximation ---")
print(f"M1 (constant): log-lik={log_lik_M1:.2f}, k={k_M1}, BIC={bic_M1:.2f}")
print(f"M2 (trend):    log-lik={log_lik_M2:.2f}, k={k_M2}, BIC={bic_M2:.2f}")
print(f"Delta BIC (M2-M1) = {bic_M2 - bic_M1:.2f}")

# Approx log Bayes factor: log BF_12 ≈ (BIC_2 - BIC_1) / 2
log_bf_12 = (bic_M2 - bic_M1) / 2
bf_12 = np.exp(log_bf_12)
print(f"\\nApprox log BF_12 = {log_bf_12:.2f}")
print(f"Approx BF_12 = {bf_12:.2f}")

# --- Interpret using Jeffreys' scale ---
def interpret_bf(bf):
    if bf > 100: return "Decisive evidence for M1"
    if bf > 30:  return "Very strong evidence for M1"
    if bf > 10:  return "Strong evidence for M1"
    if bf > 3:   return "Substantial evidence for M1"
    if bf > 1:   return "Weak evidence for M1"
    if bf > 1/3: return "Weak evidence for M2"
    if bf > 1/10: return "Substantial evidence for M2"
    return "Strong+ evidence for M2"

print(f"Interpretation: {interpret_bf(bf_12)}")
print(f"\\nMLE trend coefficient: beta = {beta_hat[1]:.8f}")
print(f"Annualized trend: {beta_hat[1]*252:.6f} ({beta_hat[1]*252*100:.4f}% per year)")

# --- Posterior model probabilities (equal priors) ---
if np.isfinite(log_bf_12):
    p_M1 = bf_12 / (1 + bf_12)
    p_M2 = 1 / (1 + bf_12)
    print(f"\\nPosterior model probabilities (equal priors):")
    print(f"  P(M1 | data) = {p_M1:.4f}")
    print(f"  P(M2 | data) = {p_M2:.4f}")

print(f"\\nConclusion: The constant-mean model is preferred.")
print(f"The trend parameter adds complexity without sufficient improvement in fit.")
print(f"This demonstrates the automatic Occam's razor of Bayesian model comparison.")`,
      explanation: "This code compares a constant-mean model (M₁) against a linear-trend model (M₂) for forex returns using both exact marginal likelihoods (for the conjugate case) and BIC approximations. It computes the Bayes factor, interprets it on Jeffreys' scale, and calculates posterior model probabilities. Since the data was generated without a trend, the Bayes factor correctly favors the simpler model — demonstrating the automatic Occam's razor that penalizes unnecessary complexity."
    },
    {
      type: "quiz",
      questions: [
        {
          id: "q1-bayes-computation",
          question: "A disease affects 1% of the population. A test has 95% sensitivity (true positive rate) and 90% specificity (true negative rate). If a person tests positive, what is the posterior probability they have the disease? Apply Bayes' theorem with P(D)=0.01, P(+|D)=0.95, P(+|¬D)=0.10.",
          options: [
            { id: "a", text: "About 8.8% — P(D|+) = (0.95×0.01)/(0.95×0.01 + 0.10×0.99) = 0.0095/0.1085 ≈ 0.088" },
            { id: "b", text: "About 95% — the test is 95% accurate so the probability matches" },
            { id: "c", text: "About 50% — positive test is uninformative with such a rare disease" },
            { id: "d", text: "About 1% — the prior prevalence dominates regardless of the test result" }
          ],
          correctOptionId: "a",
          explanation: "Applying Bayes' theorem: P(D|+) = P(+|D)·P(D) / [P(+|D)·P(D) + P(+|¬D)·P(¬D)] = (0.95 × 0.01) / (0.95 × 0.01 + 0.10 × 0.99) = 0.0095 / 0.1085 ≈ 0.088 or 8.8%. Despite the test being 95% sensitive, the low base rate (1%) means most positives are false positives. This is the base-rate fallacy — ignoring the prior leads to dramatically overestimating the posterior."
        },
        {
          id: "q2-conjugate-prior",
          question: "You are modeling the number of forex trades executed per hour as a Poisson process and want a conjugate prior for the rate parameter λ. Which prior distribution should you use?",
          options: [
            { id: "a", text: "Normal distribution — it's the most common prior choice" },
            { id: "b", text: "Beta distribution — it's conjugate for all rate parameters" },
            { id: "c", text: "Gamma distribution — it is the conjugate prior for the Poisson likelihood" },
            { id: "d", text: "Inverse-Gamma distribution — it's used for scale parameters" }
          ],
          correctOptionId: "c",
          explanation: "The Gamma distribution is conjugate to the Poisson likelihood. If λ ~ Gamma(α, β) and we observe n data points with sum S = Σxᵢ, the posterior is Gamma(α + S, β + n). The Gamma is a natural choice because it's defined on (0, ∞), matching the support of the Poisson rate parameter. The Beta is conjugate to the Binomial (not Poisson), and the Inverse-Gamma is conjugate to the Normal variance (not the Poisson rate)."
        },
        {
          id: "q3-credible-vs-confidence",
          question: "A Bayesian analyst reports: 'The 95% credible interval for the strategy's Sharpe ratio is [0.3, 1.2].' A frequentist analyst reports: 'The 95% confidence interval for the Sharpe ratio is [0.3, 1.2].' Which statement correctly distinguishes these two intervals?",
          options: [
            { id: "a", text: "They are mathematically identical — the distinction is purely philosophical" },
            { id: "b", text: "The CrI means P(Sharpe ∈ [0.3, 1.2] | data) = 0.95; the CI means 95% of such intervals from repeated experiments would contain the true Sharpe" },
            { id: "c", text: "The CI provides a probability statement about the parameter; the CrI provides a probability statement about the procedure" },
            { id: "d", text: "The CrI is always wider because it accounts for prior uncertainty" }
          ],
          correctOptionId: "b",
          explanation: "The Bayesian credible interval makes a direct probability statement about the parameter given the data: there is a 95% posterior probability the Sharpe ratio lies in [0.3, 1.2]. The frequentist confidence interval makes a statement about the procedure: if you repeated the experiment many times and computed a 95% CI each time, 95% of those intervals would contain the true Sharpe ratio. For this specific interval, the true Sharpe is either in it or not — the frequentist framework assigns no probability to that event. The CrI interpretation is typically more useful for decision-making."
        },
        {
          id: "q4-bayes-factor",
          question: "You compute a Bayes factor BF₁₂ = 45 comparing Model 1 (mean-reverting returns) to Model 2 (random walk). Using Jeffreys' scale, how should you interpret this?",
          options: [
            { id: "a", text: "Barely worth mentioning — the evidence is inconclusive" },
            { id: "b", text: "Substantial evidence for M1 — worth noting but not definitive" },
            { id: "c", text: "Very strong evidence for M1 — the mean-reverting model is strongly supported" },
            { id: "d", text: "Decisive evidence for M1 — the random walk model should be rejected entirely" }
          ],
          correctOptionId: "c",
          explanation: "On Jeffreys' scale, BF₁₂ = 45 falls in the 'very strong' range (30–100). This means the data are 45 times more probable under the mean-reverting model than under the random walk. With equal prior model probabilities, the posterior probability of M1 is 45/46 ≈ 97.8%. This is strong but not decisive evidence — new data could potentially change the conclusion, especially if the regime shifts."
        },
        {
          id: "q5-prior-variance-limit",
          question: "In the Normal-Normal conjugate model, what happens to the posterior mean μₙ as the prior variance τ₀² → ∞ (i.e., a completely flat, uninformative prior)?",
          options: [
            { id: "a", text: "μₙ → μ₀ — the posterior collapses to the prior mean regardless of data" },
            { id: "b", text: "μₙ → x̄ — the posterior mean equals the MLE (sample mean)" },
            { id: "c", text: "μₙ → 0 — the posterior mean always converges to zero" },
            { id: "d", text: "μₙ is undefined — the posterior does not exist with an improper prior" }
          ],
          correctOptionId: "b",
          explanation: "As τ₀² → ∞, the prior precision 1/τ₀² → 0. The posterior mean μₙ = τₙ²(μ₀/τ₀² + nx̄/σ²). Since μ₀/τ₀² → 0, we get μₙ → τₙ² × nx̄/σ². Also τₙ² = 1/(1/τ₀² + n/σ²) → 1/(n/σ²) = σ²/n. So μₙ → (σ²/n)(nx̄/σ²) = x̄. With a flat prior, the Bayesian posterior mean equals the frequentist MLE. The prior provides no information, so the data speaks entirely for itself."
        },
        {
          id: "q6-occam-razor",
          question: "A complex trading model with 15 parameters achieves a slightly higher log-likelihood than a simple model with 3 parameters. The Bayes factor favors the simple model. Why?",
          options: [
            { id: "a", text: "The Bayes factor is computed incorrectly — higher likelihood always means better model" },
            { id: "b", text: "The complex model's prior must spread probability over a much larger parameter space, wasting prior mass on regions with poor fit, reducing its marginal likelihood" },
            { id: "c", text: "Bayes factors are biased toward simple models and should not be trusted" },
            { id: "d", text: "The 15-parameter model must have converged to a local optimum" }
          ],
          correctOptionId: "b",
          explanation: "This is the automatic Occam's razor. The marginal likelihood p(D|M) = ∫p(D|θ,M)p(θ|M)dθ averages the likelihood over the ENTIRE prior. A 15-parameter model has a 15-dimensional prior space. Most of that volume corresponds to parameter combinations with poor fit. Even though the best-fitting point has high likelihood, the average over the prior is low. The 3-parameter model concentrates its prior in a smaller space — if the data is reasonably well-fit, its average likelihood (marginal likelihood) can exceed that of the complex model. This is why Bayesian model comparison naturally penalizes overfitting without needing explicit regularization terms."
        }
      ]
    },
    {
      type: "practice",
      title: "Bayesian Regime Detection with PyMC",
      description: `Implement a Bayesian Hidden Markov Model to detect market regimes (trending vs mean-reverting vs high-volatility) in forex returns using PyMC.

**Tasks:**
1. Load or simulate 500 days of EUR/USD returns with two hidden regimes: low-volatility (σ=0.005, μ=0.0001) and high-volatility (σ=0.015, μ=-0.0002).
2. Define a 2-state HMM in PyMC with:
   - Dirichlet priors on transition probabilities
   - Normal priors on regime means: μₖ ~ N(0, 0.001)
   - HalfNormal priors on regime volatilities: σₖ ~ HalfNormal(0.02)
3. Run NUTS sampling (2000 draws, 1000 tune, 2 chains).
4. Extract posterior distributions of regime parameters and transition matrix.
5. Compute the most probable regime sequence using posterior mode.
6. Plot: (a) returns colored by detected regime, (b) posterior distributions of μ and σ for each regime, (c) transition matrix heatmap.
7. Compare detected regimes against the true hidden states — compute accuracy.

**Success Criteria:** Posterior means for μ and σ within 20% of true values; regime detection accuracy > 85%.`,
      catalogModelId: "bayesian-regression"
    },
    {
      type: "practice",
      title: "Bayesian A/B Testing for Trading Strategies",
      description: `Use Bayesian inference to compare two forex trading strategies and determine which is superior, accounting for full parameter uncertainty.

**Tasks:**
1. Simulate daily returns for two strategies over 120 trading days:
   - Strategy A: N(μ_A=0.0003, σ_A=0.008) — moderate return, low volatility
   - Strategy B: N(μ_B=0.0005, σ_B=0.014) — higher return, higher volatility
2. Place Normal-InverseGamma conjugate priors on (μ, σ²) for each strategy.
3. Compute the full joint posterior for (μ_A, σ_A, μ_B, σ_B) analytically using the Normal-InverseGamma conjugate update.
4. Draw 50,000 posterior samples of the Sharpe ratio for each strategy: SR = μ/σ × √252.
5. Compute P(SR_A > SR_B | data) — the posterior probability that Strategy A has a higher Sharpe ratio.
6. Compute the posterior distribution of the Sharpe ratio difference: ΔSR = SR_A - SR_B.
7. Plot: (a) overlapping posterior histograms of SR_A and SR_B, (b) posterior of ΔSR with 95% HPD interval, (c) "probability of superiority" as a function of sample size (compute for n = 20, 40, 60, 80, 100, 120).
8. Decision rule: recommend the strategy with P(superior) > 0.90; if neither exceeds 0.90, recommend collecting more data.

**Success Criteria:** Correctly identify which strategy has the higher Sharpe ratio with calibrated posterior probabilities; demonstrate how the probability of a correct decision increases with sample size.`,
      catalogModelId: "bayesian-regression"
    }
  ],
}

