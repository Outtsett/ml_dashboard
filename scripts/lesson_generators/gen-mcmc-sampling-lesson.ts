export default {
  id: "gen-mcmc-sampling",
  title: "MCMC & Bayesian Estimation",
  description: "Master Markov Chain Monte Carlo methods for Bayesian inference: derive Metropolis-Hastings from detailed balance, implement Hamiltonian Monte Carlo with leapfrog integration, understand NUTS adaptive sampling, apply rigorous convergence diagnostics, and estimate trading strategy parameters with full posterior uncertainty quantification.",
  estimatedMinutes: 80,
  difficulty: "advanced",
  relatedModels: ["bayesian-regression"],
  prerequisites: ["gen-bayesian"],
  sections: [
    {
      type: "objective",
      content: "This lesson builds your mastery of MCMC sampling — the computational engine behind modern Bayesian inference. You will derive the Metropolis-Hastings algorithm from first principles via the detailed balance condition, implement Hamiltonian Monte Carlo with the leapfrog integrator, understand how NUTS eliminates manual tuning, and apply rigorous convergence diagnostics (R̂, ESS, trace plots) to ensure your chains have actually converged. Every concept is grounded in forex strategy parameter estimation with full uncertainty quantification.",
      keyTakeaways: [
        "Derive the MH acceptance ratio from the detailed balance equation π(θ)T(θ→θ') = π(θ')T(θ'→θ) and verify it guarantees convergence to the target posterior",
        "Compute acceptance probabilities by hand for specific proposals given a target distribution, understanding why high rejection rates signal poor proposal tuning",
        "Implement the leapfrog integrator for HMC: half-step momentum, full-step position, half-step momentum — and explain why symplecticity is essential for energy conservation",
        "Explain how NUTS builds a binary tree of leapfrog steps, detects U-turns via the criterion θ·p < 0, and uses multinomial sampling to select the next state",
        "Calculate R̂ from between-chain variance B and within-chain variance W, interpreting values above 1.01 as evidence of non-convergence",
        "Compute effective sample size ESS = n/(1 + 2Σρ(k)) and understand why 1000 nominal samples may yield only 50 effective samples under high autocorrelation",
        "Perform posterior predictive checks by simulating y_rep from the posterior and comparing test statistics against observed data to validate model adequacy",
        "Estimate forex strategy parameters (e.g., mean-reversion speed, signal decay) with full credible intervals rather than point estimates, enabling risk-aware position sizing"
      ]
    },
    {
      type: "theory",
      title: "Metropolis-Hastings: Detailed Balance Derivation",
      content: `We begin with the foundational question: how do we construct a Markov chain whose stationary distribution equals our target posterior π(θ|D)? The answer lies in the detailed balance condition, which provides a sufficient (though not necessary) condition for a Markov chain to have π as its stationary distribution.

**Definition — Detailed Balance.** A transition kernel T(θ → θ') satisfies detailed balance with respect to π if:

  π(θ) · T(θ → θ') = π(θ') · T(θ' → θ)  for all θ, θ'

This says the probability flow from θ to θ' exactly equals the reverse flow. Summing both sides over θ gives ∫π(θ)T(θ→θ')dθ = π(θ'), proving π is stationary under T.

**Decomposition of the Transition Kernel.** Metropolis-Hastings decomposes T into two steps: (1) propose θ' from a proposal distribution q(θ'|θ), and (2) accept with probability α(θ, θ'). The full transition kernel for a move from θ to θ' (where θ' ≠ θ) is:

  T(θ → θ') = q(θ'|θ) · α(θ, θ')

**Derivation of the Acceptance Ratio.** Substituting into detailed balance:

  π(θ) · q(θ'|θ) · α(θ, θ') = π(θ') · q(θ|θ') · α(θ', θ)

We want to maximize acceptance (for efficiency) while satisfying this equality. The optimal solution sets the larger side's α to 1. If π(θ')q(θ|θ') ≥ π(θ)q(θ'|θ), then α(θ', θ) = 1 and:

  α(θ, θ') = π(θ')q(θ|θ') / [π(θ)q(θ'|θ)]

Combining both cases:

  α(θ, θ') = min(1, π(θ')q(θ|θ') / [π(θ)q(θ'|θ)])

This is the Metropolis-Hastings acceptance ratio. Crucially, π need only be known up to a normalizing constant because the ratio π(θ')/π(θ) cancels it — this is why MCMC works with unnormalized posteriors.

**Special Case: Symmetric Proposals.** When q(θ'|θ) = q(θ|θ') (e.g., Gaussian random walk with q(θ'|θ) = N(θ, σ²)), the proposal terms cancel:

  α(θ, θ') = min(1, π(θ') / π(θ))

This is the original Metropolis algorithm (1953). We simply compare posterior densities.

**Numerical Example.** Suppose our posterior is π(θ) ∝ exp(-θ²/2) (standard normal). Current state θ = 2.0, proposed θ' = 2.3, symmetric proposal.

  π(θ)  ∝ exp(-2.0²/2) = exp(-2.0) = 0.1353
  π(θ') ∝ exp(-2.3²/2) = exp(-2.645) = 0.0710

  α = min(1, 0.0710 / 0.1353) = min(1, 0.5247) = 0.5247

We draw u ~ Uniform(0,1). If u < 0.5247, accept θ' = 2.3; otherwise stay at θ = 2.0. The move toward the tail is accepted roughly half the time — the chain explores low-density regions but spends most time near the mode.

**Asymmetric Proposal Example.** Now let q(θ'|θ) = LogNormal(log(θ), 0.1) so proposals are right-skewed. With θ=2.0, θ'=2.3:

  q(θ'|θ) = (1/θ') · φ((log θ' - log θ)/0.1) / 0.1
  q(θ|θ') = (1/θ) · φ((log θ - log θ')/0.1) / 0.1

  The ratio q(θ|θ')/q(θ'|θ) = θ'/θ = 2.3/2.0 = 1.15

  α = min(1, (0.0710 × 1.15) / 0.1353) = min(1, 0.6034) = 0.6034

The asymmetric correction increases acceptance because the proposal is biased toward larger values, and the correction factor compensates.

**Limitations.** MH with random-walk proposals suffers from the curse of dimensionality: optimal acceptance rates drop to ~23.4% in high dimensions (Roberts et al., 1997), and the chain takes O(d²) steps to traverse the typical set in d dimensions. Correlations between parameters cause the chain to take many small, correlated steps. This motivates gradient-based methods like HMC.`
    },
    {
      type: "theory",
      title: "Hamiltonian Monte Carlo and the Leapfrog Integrator",
      content: `Hamiltonian Monte Carlo (HMC) exploits the geometry of the posterior by introducing auxiliary momentum variables and simulating Hamiltonian dynamics, dramatically reducing the random-walk behavior that plagues vanilla MH in high dimensions.

**Augmenting the State Space.** We introduce momentum p ∈ ℝᵈ with p ~ N(0, M), where M is the "mass matrix" (typically diagonal or the identity). The joint density is:

  π(θ, p) ∝ π(θ) · exp(-½ pᵀ M⁻¹ p)

Define the Hamiltonian H(θ, p) = U(θ) + K(p) where:
  U(θ) = -log π(θ)     (potential energy = negative log posterior)
  K(p) = ½ pᵀ M⁻¹ p   (kinetic energy)

The key insight: sampling from π(θ, p) and marginalizing over p recovers samples from π(θ). But we can simulate the Hamiltonian dynamics to make large, low-rejection moves.

**Hamilton's Equations.** The continuous-time dynamics are:

  dθ/dt = ∂H/∂p = M⁻¹ p
  dp/dt = -∂H/∂θ = -∇U(θ) = ∇ log π(θ)

Position (parameters) evolve in the direction of momentum; momentum evolves according to the negative gradient of potential energy (i.e., the gradient of the log-posterior). These dynamics preserve H exactly, so if we could integrate perfectly, the acceptance rate would be 100%.

**The Leapfrog Integrator.** We cannot solve Hamilton's equations analytically for general posteriors, so we use the leapfrog (Störmer-Verlet) integrator with step size ε and L steps:

  For l = 1 to L:
    Step 1 (half-step momentum):   p(t + ε/2) = p(t) + (ε/2) · ∇ log π(θ(t))
    Step 2 (full-step position):   θ(t + ε) = θ(t) + ε · M⁻¹ · p(t + ε/2)
    Step 3 (half-step momentum):   p(t + ε) = p(t + ε/2) + (ε/2) · ∇ log π(θ(t + ε))

**Why Leapfrog?** The leapfrog integrator is symplectic: it exactly preserves the phase-space volume element dθ dp. This is critical because it means we don't need a Jacobian correction in the MH step. Non-symplectic integrators (e.g., Euler) accumulate volume distortion and yield high rejection rates.

The leapfrog also has error O(ε³) per step and O(ε²) globally, compared to O(ε) for Euler. The energy error ΔH = H(θ*, p*) - H(θ, p) remains bounded and does not grow with L (it oscillates), enabling long trajectories.

**MH Correction for Discretization Error.** After L leapfrog steps from (θ, p) to (θ*, p*), we accept with probability:

  α = min(1, exp(-H(θ*, p*) + H(θ, p))) = min(1, exp(-ΔH))

If ε is small enough, ΔH ≈ 0 and acceptance ≈ 100%. In practice, we target ~65-80% acceptance.

**Numerical Example.** Let π(θ) ∝ exp(-θ²/2) (standard normal), M = 1, ε = 0.1, L = 20. Start at θ = 0, draw p ~ N(0,1), say p = 1.5.

  U(θ) = θ²/2,  ∇log π(θ) = -θ

  Leapfrog step 1:
    p₀.₅ = 1.5 + (0.05)·(-0) = 1.5
    θ₁ = 0 + 0.1 · 1.5 = 0.15
    p₁ = 1.5 + (0.05)·(-0.15) = 1.4925

  Step 2:
    p₁.₅ = 1.4925 + 0.05·(-0.15) = 1.4850
    θ₂ = 0.15 + 0.1·1.4850 = 0.2985
    p₂ = 1.4850 + 0.05·(-0.2985) = 1.4701

After L=20 steps, θ* ≈ 1.48, p* ≈ -0.12. H_initial = 0 + 1.125 = 1.125. H_final = 1.095 + 0.007 = 1.102. ΔH = -0.023, so α = min(1, exp(0.023)) = 1.0. Accepted! The trajectory has moved θ from 0 to 1.48 in a single step — far more efficient than random walk.

**Tuning Parameters.** ε controls accuracy (too large → high ΔH → rejections; too small → slow exploration). L controls trajectory length (too short → random-walk behavior; too long → U-turns waste computation). The product εL determines how far the chain moves per iteration. A common heuristic: εL ≈ 1 (one "unit" of travel in parameter space). The mass matrix M should approximate the posterior covariance: M ≈ Cov(θ|D) — this decorrelates the parameters and equalizes scales.`
    },
    {
      type: "theory",
      title: "NUTS: The No-U-Turn Sampler",
      content: `The No-U-Turn Sampler (NUTS), introduced by Hoffman & Gelman (2014), eliminates the need to manually set the trajectory length L in HMC while maintaining — and often exceeding — HMC's sampling efficiency. NUTS is the default sampler in Stan and PyMC.

**The Problem with Fixed L.** In standard HMC, L (number of leapfrog steps) is a critical tuning parameter. Too few steps: the sampler behaves like a random walk and mixes slowly. Too many steps: the trajectory makes a U-turn, returning near the starting point — wasting gradient evaluations. The optimal L varies across the parameter space, making any fixed choice suboptimal.

**NUTS: Doubling the Trajectory.** NUTS builds a binary tree of states by repeatedly doubling the trajectory in a randomly chosen direction (forward or backward in time). Starting from (θ₀, p₀), the tree grows as:

  Depth 0: 1 state (the initial point)
  Depth 1: 2 states (one leapfrog step forward or backward)
  Depth 2: 4 states (double the trajectory in one direction)
  Depth j: 2ʲ states

At each depth, NUTS checks whether the subtree satisfies the U-turn condition. For the endpoints θ⁻ (leftmost) and θ⁺ (rightmost) of a subtree:

  U-turn detected if: (θ⁺ - θ⁻) · p⁺ < 0  OR  (θ⁺ - θ⁻) · p⁻ < 0

Intuitively, a U-turn occurs when the trajectory starts moving back toward where it came from — the dot product of the displacement with the momentum flips sign. Tree-building stops at the first U-turn, ensuring the trajectory length adapts to the local geometry.

**Multinomial Sampling from the Trajectory.** Rather than just taking the final state, NUTS samples from all states on the trajectory with probabilities proportional to exp(-H(θₖ, pₖ)). This weighted multinomial sampling maintains detailed balance and utilizes the entire trajectory. In practice, the energy variation across the trajectory is small (≈ O(ε²)), so the weights are nearly uniform.

**Dual Averaging for Step Size Adaptation.** During warmup (typically the first half of sampling), NUTS adapts ε using the dual averaging algorithm of Nesterov (2009). The target is a specified acceptance rate δ (default δ = 0.8):

  H̄ₘ = (1 - 1/(m + t₀)) · H̄ₘ₋₁ + (1/(m + t₀)) · (δ - αₘ)
  log εₘ = μ - (√m / γ) · H̄ₘ
  log ε̄ₘ = m⁻ᵏ · log εₘ + (1 - m⁻ᵏ) · log ε̄ₘ₋₁

where αₘ is the acceptance probability at iteration m, γ = 0.05, t₀ = 10, κ = 0.75 are default parameters. After warmup, ε is fixed at ε̄.

**Numerical comparison — NUTS vs Fixed-L HMC.** Consider a 10-dimensional correlated Gaussian posterior. Fixed-L HMC with L=10 achieves ESS/gradient ≈ 0.15; with L=100 it drops to 0.03 (U-turns waste computation). NUTS achieves ESS/gradient ≈ 0.25 by adapting trajectory length — shorter trajectories near the mode, longer ones in the tails. For a 100-dimensional problem, NUTS maintains ESS/gradient ≈ 0.20 while fixed-L drops below 0.05 for any single L choice.

**Divergent Transitions.** When the posterior has regions of high curvature (e.g., funnels in hierarchical models), the leapfrog integrator can produce large energy errors. NUTS flags these as "divergent transitions" when ΔH exceeds a threshold (default: 1000). Divergences indicate the sampler is failing to explore part of the posterior. Solutions: (1) reparameterize the model (e.g., non-centered parameterization for hierarchical models), (2) reduce ε (increases accuracy but slows sampling), (3) increase adapt_delta to target a higher acceptance rate.

**Limitations.** NUTS requires gradient ∇log π(θ), limiting it to continuous parameters (discrete parameters need marginalization or other methods). The binary tree construction has O(2ʲ) memory cost at depth j. Maximum tree depth (default 10 = 1024 leapfrog steps) can be insufficient for very long trajectories. Multimodal posteriors remain challenging — NUTS explores modes connected by probability ridges but cannot jump between isolated modes.`
    },
    {
      type: "theory",
      title: "Convergence Diagnostics: R̂, ESS, and Posterior Predictive Checks",
      content: `MCMC produces correlated samples that only asymptotically represent the target distribution. Convergence diagnostics help us assess whether the chain has run long enough and is mixing well. No diagnostic can prove convergence, but failing diagnostics reliably detect non-convergence.

**The Split-R̂ Statistic.** We run M ≥ 2 independent chains, each of length 2N, and split each into two halves (giving 2M chains of length N). This lets us detect within-chain non-stationarity. For chains i = 1, ..., 2M:

  Chain mean: θ̄ᵢ = (1/N) Σⱼ θᵢⱼ
  Grand mean: θ̄ = (1/2M) Σᵢ θ̄ᵢ

Between-chain variance:
  B = N/(2M - 1) · Σᵢ (θ̄ᵢ - θ̄)²

Within-chain variance:
  sᵢ² = (1/(N-1)) Σⱼ (θᵢⱼ - θ̄ᵢ)²
  W = (1/2M) Σᵢ sᵢ²

The marginal posterior variance estimate:
  V̂ = ((N-1)/N) · W + (1/N) · B

The potential scale reduction factor:
  R̂ = √(V̂ / W)

**Interpreting R̂.** If all chains have converged to the same distribution, B ≈ W·(2M-1)/(N·2M) and R̂ ≈ 1. If chains are in different regions, B >> W and R̂ >> 1. Modern guidance (Vehtari et al., 2021) recommends R̂ < 1.01 (stricter than the old 1.1 threshold).

**Numerical Example.** Two chains, each split into halves (4 segments, N=500 each):

  Chain means: θ̄₁ = 2.31, θ̄₂ = 2.35, θ̄₃ = 2.29, θ̄₄ = 2.33
  Grand mean: θ̄ = 2.32
  B = 500/(4-1) · [(2.31-2.32)² + (2.35-2.32)² + (2.29-2.32)² + (2.33-2.32)²]
    = 500/3 · [0.0001 + 0.0009 + 0.0009 + 0.0001] = 166.67 · 0.002 = 0.333
  W = (0.15 + 0.14 + 0.16 + 0.15) / 4 = 0.15
  V̂ = (499/500)·0.15 + (1/500)·0.333 = 0.1497 + 0.000667 = 0.1504
  R̂ = √(0.1504/0.15) = √1.0026 = 1.001  ✓ Converged!

**Effective Sample Size (ESS).** Autocorrelated MCMC samples contain less information than independent samples. ESS quantifies how many independent samples our chain is equivalent to:

  ESS = N / (1 + 2 Σₖ₌₁^K ρ(k))

where ρ(k) is the autocorrelation at lag k. The sum is truncated at the first K where ρ(K+1) + ρ(K+2) < 0 (initial positive sequence estimator, to avoid noise-induced negative bias).

**Example.** Chain of N=2000 samples with ρ(1)=0.8, ρ(2)=0.65, ρ(3)=0.5, ρ(4)=0.35, ρ(5)=0.2, ρ(6)=0.1, ρ(7)=0.02, ρ(8)=-0.03 (truncate at k=7):

  ESS = 2000 / (1 + 2·(0.8+0.65+0.5+0.35+0.2+0.1+0.02))
      = 2000 / (1 + 2·2.62) = 2000 / 6.24 = 320.5

From 2000 nominal samples, we have ~321 effective samples. Rule of thumb: ESS > 400 for reliable posterior summaries, ESS > 1000 for tail quantile estimation.

**Trace Plot Interpretation.** A well-mixing chain shows: (1) no trend — the trace looks stationary, like white noise around a constant mean; (2) good overlap — multiple chains cover the same range; (3) rapid mixing — the chain doesn't get "stuck" in one region for extended periods. Warning signs: slow drift, periodic oscillations, chains at different levels, sudden jumps between modes.

**Posterior Predictive Checks.** After sampling θ⁽¹⁾, ..., θ⁽S⁾ from p(θ|D), we simulate replicated data for each posterior draw:

  y_rep⁽ˢ⁾ ~ p(y | θ⁽ˢ⁾)   for s = 1, ..., S

We then compare test statistics T(y_rep) with T(y_obs). The posterior predictive p-value is:

  p_B = Pr(T(y_rep) ≥ T(y_obs) | D) = (1/S) Σₛ I(T(y_rep⁽ˢ⁾) ≥ T(y_obs))

Values near 0 or 1 indicate model misfit. For example, T could be the standard deviation (checking volatility capture), maximum absolute return (checking tail behavior), or number of zero-crossings (checking mean-reversion).

**Forex Application.** When estimating a mean-reversion strategy's half-life, posterior predictive checks with T = number of zero-crossings can reveal whether the OU process model captures the actual crossing frequency. If the observed crossing count falls in the 2nd percentile of posterior predictive distribution, the model likely underestimates mean-reversion speed, and the strategy's edge may be overstated.`
    },
    {
      type: "intuition",
      title: "MCMC as Exploring a Mountain Range in Fog",
      emoji: "⛰️",
      analogy: "A hiker exploring a mountain range in dense fog",
      content: `Imagine you are a hiker trying to map the elevation profile of an entire mountain range, but you are in dense fog and can only see your immediate surroundings. You cannot see the whole landscape — you can only measure the elevation right where you stand.

**Random Walk Metropolis** is like taking a random step in any direction, then checking: "Am I higher or lower?" If higher (toward the peak/mode), you always move there. If lower, you sometimes move there — the further downhill, the less likely you go. Over thousands of steps, you trace out the elevation profile (posterior). But in fog, your random steps are small and cautious, so it takes forever to cross wide valleys between peaks.

**HMC** is like strapping on roller skates and using the slope. Instead of random stumbling, you feel the gradient under your feet and roll in the direction the ground slopes. Momentum carries you across valleys and up the other side. You cover far more ground per step. The leapfrog integrator is your "physics engine" — it simulates the rolling motion in small discrete ticks, and the symplectic property ensures you don't accidentally gain or lose total energy (elevation + speed).

**NUTS** adds a smart stopping rule: you keep rolling until you start heading back toward where you came from (a U-turn). This means on a wide plateau you take many steps (exploring broadly), but on a narrow ridge you stop quickly (avoiding wasted effort). No manual tuning of "how far to roll."

**R̂** is like having multiple hikers start from different locations. If they all end up reporting similar elevation maps, the range is well-explored. If their maps disagree, someone is stuck in a local region and hasn't seen the full landscape.

**ESS** tells you how much useful information your path contains. If you walk in tight circles, 1000 steps might only give you 50 truly new viewpoints. If you stride boldly across the range, each step reveals something new.`
    },
    {
      type: "intuition",
      title: "Acceptance Ratio as a Quality Control Gate",
      emoji: "🚪",
      analogy: "A quality control inspector deciding whether to accept factory parts",
      content: `Think of the MH acceptance ratio as a quality control inspector at a factory gate. Each "part" is a proposed parameter value θ'. The inspector compares it against the current standard θ.

**The inspection score** is the acceptance ratio α = π(θ')/π(θ) (for symmetric proposals). If the new part (proposal) scores higher than the current standard (α > 1), it is always accepted — an obvious improvement. If it scores lower (α < 1), it is accepted with probability equal to the ratio. A part that is 80% as good as the current one passes 80% of the time; one that is only 10% as good passes only 10%.

**Why accept worse parts at all?** If we only accepted improvements, we would climb to the nearest peak and get stuck — like a factory that only makes parts identical to the best one it ever produced. By occasionally accepting inferior parts, we explore the full range of quality levels in proportion to their actual frequency. This is the difference between optimization (find the single best) and sampling (map the entire distribution).

**Proposal width is like the factory's innovation budget.** Too conservative (tiny proposals): every part is nearly identical to the last — high acceptance but no exploration. Too radical (huge proposals): most parts are rejected because they land far from the quality peak. The sweet spot is ~23% acceptance in high dimensions — bold enough to explore, careful enough to make progress.

**The asymmetric correction** q(θ|θ')/q(θ'|θ) handles "biased factories." If your factory naturally produces more large parts, the inspector adjusts the threshold so that small parts get a fair chance — otherwise you would oversample large values.

**In forex terms**, each "part" is a candidate parameter vector for your strategy. The posterior is the "quality score" combining fit to data (likelihood) and prior beliefs. The inspector ensures you sample parameter combinations proportional to their posterior plausibility, giving you a full picture of uncertainty rather than a single "best fit" that may be overconfident.`
    },
    {
      type: "code",
      title: "Metropolis-Hastings Sampler with Full Diagnostics",
      language: "python",
      code: `import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

np.random.seed(42)

# Target: posterior of mean mu given data ~ N(mu, sigma^2) with prior mu ~ N(0, tau^2)
# True mu=3.0, sigma=2.0, tau=5.0
true_mu = 3.0
sigma = 2.0
tau = 5.0
data = np.random.normal(true_mu, sigma, size=50)
n = len(data)
xbar = data.mean()

# Analytic posterior: N(posterior_mean, posterior_var)
posterior_var = 1.0 / (n / sigma**2 + 1.0 / tau**2)
posterior_mean = posterior_var * (n * xbar / sigma**2 + 0.0 / tau**2)
print(f"Data: n={n}, x_bar={xbar:.4f}")
print(f"Analytic posterior: N({posterior_mean:.4f}, {posterior_var:.6f})")
print(f"Analytic 95% CI: [{posterior_mean - 1.96*np.sqrt(posterior_var):.4f}, "
      f"{posterior_mean + 1.96*np.sqrt(posterior_var):.4f}]")

def log_posterior(mu):
    log_prior = -0.5 * mu**2 / tau**2
    log_lik = -0.5 * np.sum((data - mu)**2) / sigma**2
    return log_prior + log_lik

# MH with Gaussian random walk proposal
def metropolis_hastings(n_samples, proposal_sd, mu_init=0.0):
    samples = np.zeros(n_samples)
    samples[0] = mu_init
    accepted = 0
    for i in range(1, n_samples):
        mu_current = samples[i - 1]
        mu_proposed = np.random.normal(mu_current, proposal_sd)
        log_alpha = log_posterior(mu_proposed) - log_posterior(mu_current)
        if np.log(np.random.uniform()) < log_alpha:
            samples[i] = mu_proposed
            accepted += 1
        else:
            samples[i] = mu_current
    return samples, accepted / (n_samples - 1)

# Run 4 chains with different starting points
n_samples = 5000
burn_in = 1000
proposal_sd = 0.3
starts = [-5.0, 0.0, 5.0, 10.0]
chains = []
for s in starts:
    samps, acc_rate = metropolis_hastings(n_samples, proposal_sd, mu_init=s)
    chains.append(samps)
    print(f"Chain start={s:5.1f}: acceptance={acc_rate:.3f}, "
          f"post-burnin mean={samps[burn_in:].mean():.4f}")

# Convergence: split-R-hat
def compute_rhat(chains_list, burn_in):
    trimmed = [c[burn_in:] for c in chains_list]
    split = []
    for c in trimmed:
        mid = len(c) // 2
        split.extend([c[:mid], c[mid:]])
    M = len(split)
    N = len(split[0])
    chain_means = [np.mean(s) for s in split]
    grand_mean = np.mean(chain_means)
    B = N / (M - 1) * sum((m - grand_mean)**2 for m in chain_means)
    W = np.mean([np.var(s, ddof=1) for s in split])
    V_hat = (N - 1) / N * W + B / N
    return np.sqrt(V_hat / W)

# ESS via autocorrelation
def compute_ess(chain):
    n = len(chain)
    mean = chain.mean()
    var = chain.var()
    if var == 0:
        return 0
    autocorr_sum = 0.0
    for k in range(1, n):
        rho_k = np.mean((chain[:n-k] - mean) * (chain[k:] - mean)) / var
        if k > 1 and rho_k < 0.05:
            break
        autocorr_sum += rho_k
    return n / (1.0 + 2.0 * autocorr_sum)

rhat = compute_rhat(chains, burn_in)
post_samples = np.concatenate([c[burn_in:] for c in chains])
ess = compute_ess(post_samples)

print(f"\\nDiagnostics:")
print(f"  R-hat: {rhat:.4f} ({'CONVERGED' if rhat < 1.01 else 'NOT CONVERGED'})")
print(f"  ESS: {ess:.0f} / {len(post_samples)} nominal samples")
print(f"  MCMC posterior mean: {post_samples.mean():.4f}")
print(f"  MCMC posterior std:  {post_samples.std():.4f}")
print(f"  MCMC 95% CI: [{np.percentile(post_samples, 2.5):.4f}, "
      f"{np.percentile(post_samples, 97.5):.4f}]")`,
      explanation: `This code implements Metropolis-Hastings from scratch for a conjugate Gaussian model where we know the analytic posterior — allowing us to verify MCMC accuracy. Key features: (1) The log-posterior is computed as log-prior + log-likelihood, avoiding numerical underflow. (2) Four chains with dispersed starting points test convergence. (3) Split-R̂ is computed by splitting each chain in half, catching within-chain non-stationarity. (4) ESS is computed via the autocorrelation function, showing how correlated samples reduce effective information. The proposal_sd = 0.3 yields acceptance rates near 40-50%, which is appropriate for this 1D problem (optimal is ~44% in 1D). The MCMC posterior mean and CI should closely match the analytic values.`
    },
    {
      type: "code",
      title: "Hamiltonian Monte Carlo with Leapfrog Integrator",
      language: "python",
      code: `import numpy as np
import matplotlib
matplotlib.use("Agg")

np.random.seed(123)

# Target: 2D correlated Gaussian
# posterior ~ N(mu, Sigma) with Sigma = [[1, 0.9], [0.9, 1]]
true_mean = np.array([2.0, -1.0])
Sigma = np.array([[1.0, 0.9], [0.9, 1.0]])
Sigma_inv = np.linalg.inv(Sigma)

def neg_log_prob(theta):
    d = theta - true_mean
    return 0.5 * d @ Sigma_inv @ d

def grad_neg_log_prob(theta):
    return Sigma_inv @ (theta - true_mean)

def leapfrog(theta, p, step_size, n_steps):
    """Leapfrog integrator: half-step p, full-step theta, half-step p."""
    theta = theta.copy()
    p = p.copy()
    p -= 0.5 * step_size * grad_neg_log_prob(theta)  # half step momentum
    for i in range(n_steps - 1):
        theta += step_size * p                         # full step position
        p -= step_size * grad_neg_log_prob(theta)      # full step momentum
    theta += step_size * p                             # final position step
    p -= 0.5 * step_size * grad_neg_log_prob(theta)    # final half step momentum
    return theta, -p  # negate momentum for reversibility

def hmc(n_samples, step_size, n_leapfrog, theta_init):
    d = len(theta_init)
    samples = np.zeros((n_samples, d))
    samples[0] = theta_init
    accepted = 0
    energies = np.zeros(n_samples)

    for i in range(1, n_samples):
        theta_current = samples[i - 1]
        p_current = np.random.randn(d)  # M = I, sample momentum

        H_current = neg_log_prob(theta_current) + 0.5 * np.sum(p_current**2)

        theta_prop, p_prop = leapfrog(theta_current, p_current, step_size, n_leapfrog)
        H_proposed = neg_log_prob(theta_prop) + 0.5 * np.sum(p_prop**2)

        delta_H = H_proposed - H_current
        energies[i] = delta_H

        if np.log(np.random.uniform()) < -delta_H:
            samples[i] = theta_prop
            accepted += 1
        else:
            samples[i] = theta_current

    return samples, accepted / (n_samples - 1), energies

# Run HMC
n_samples = 3000
burn_in = 500
step_size = 0.15
n_leapfrog = 25

samples, acc_rate, energies = hmc(n_samples, step_size, n_leapfrog,
                                   theta_init=np.array([0.0, 0.0]))

post = samples[burn_in:]
print(f"=== HMC Results (2D Correlated Gaussian) ===")
print(f"Step size: {step_size}, Leapfrog steps: {n_leapfrog}")
print(f"Acceptance rate: {acc_rate:.3f}")
print(f"Mean energy error |ΔH|: {np.mean(np.abs(energies[burn_in:])):.6f}")
print(f"Max  energy error |ΔH|: {np.max(np.abs(energies[burn_in:])):.6f}")
print(f"\\nPosterior estimates vs truth:")
print(f"  θ₁: mean={post[:,0].mean():.4f}, std={post[:,0].std():.4f}  (true: {true_mean[0]})")
print(f"  θ₂: mean={post[:,1].mean():.4f}, std={post[:,1].std():.4f}  (true: {true_mean[1]})")
print(f"  Correlation: {np.corrcoef(post[:,0], post[:,1])[0,1]:.4f}  (true: 0.9)")

# Compare with random walk MH on same problem
def rwmh_2d(n_samples, prop_sd, theta_init):
    d = len(theta_init)
    samples = np.zeros((n_samples, d))
    samples[0] = theta_init
    accepted = 0
    for i in range(1, n_samples):
        theta_curr = samples[i - 1]
        theta_prop = theta_curr + np.random.randn(d) * prop_sd
        log_alpha = -neg_log_prob(theta_prop) + neg_log_prob(theta_curr)
        if np.log(np.random.uniform()) < log_alpha:
            samples[i] = theta_prop
            accepted += 1
        else:
            samples[i] = theta_curr
    return samples, accepted / (n_samples - 1)

mh_samples, mh_acc = rwmh_2d(n_samples, prop_sd=0.5, theta_init=np.array([0.0, 0.0]))
mh_post = mh_samples[burn_in:]

# ESS comparison
def ess_1d(x):
    n = len(x)
    mu, var = x.mean(), x.var()
    if var == 0: return 0
    s = 0.0
    for k in range(1, min(n, 500)):
        rho = np.mean((x[:n-k] - mu) * (x[k:] - mu)) / var
        if rho < 0.05: break
        s += rho
    return n / (1 + 2 * s)

hmc_ess = min(ess_1d(post[:, 0]), ess_1d(post[:, 1]))
mh_ess = min(ess_1d(mh_post[:, 0]), ess_1d(mh_post[:, 1]))

print(f"\\n=== HMC vs Random Walk MH ===")
print(f"HMC:  ESS={hmc_ess:.0f}, ESS/sample={hmc_ess/len(post):.3f}")
print(f"  MH:  ESS={mh_ess:.0f}, ESS/sample={mh_ess/len(mh_post):.3f}, acc={mh_acc:.3f}")
print(f"HMC efficiency gain: {hmc_ess/mh_ess:.1f}x")`,
      explanation: `This code implements HMC with the leapfrog integrator for a 2D correlated Gaussian — a problem where we know the exact posterior and can verify results. The leapfrog function implements the three-step scheme: half-step momentum, loop of full-step position + full-step momentum, then final position + half-step momentum. Momentum is negated at the end for time-reversibility (required for detailed balance). The code compares HMC against random-walk MH on the same problem, showing HMC's dramatic ESS advantage — typically 5-10x more effective samples per iteration for this correlated posterior. The energy error |ΔH| stays small (< 0.1) confirming the symplectic integrator preserves energy well.`
    },
    {
      type: "code",
      title: "Bayesian Forex Parameter Estimation with Convergence Diagnostics",
      language: "python",
      code: `import numpy as np
import matplotlib
matplotlib.use("Agg")

np.random.seed(777)

# Simulate forex spread (bid-ask or deviation from mean) as an OU process:
#   dX = kappa*(mu - X)*dt + sigma*dW
# Parameters to estimate: kappa (mean-reversion speed), mu (long-run mean), sigma (volatility)
true_kappa = 5.0    # mean-reversion speed (half-life = ln(2)/kappa = 0.139 days)
true_mu = 1.1050    # long-run EUR/USD mid-rate
true_sigma = 0.0080 # daily volatility
dt = 1.0 / 252.0    # daily observations
n_obs = 500

# Generate OU process data
X = np.zeros(n_obs)
X[0] = true_mu + np.random.normal(0, true_sigma)
for t in range(1, n_obs):
    X[t] = X[t-1] + true_kappa * (true_mu - X[t-1]) * dt + \
           true_sigma * np.sqrt(dt) * np.random.randn()

print(f"Simulated OU process: {n_obs} observations")
print(f"True params: kappa={true_kappa}, mu={true_mu}, sigma={true_sigma}")
print(f"Data range: [{X.min():.4f}, {X.max():.4f}], mean={X.mean():.4f}")

# Log-posterior for OU process (conditionally Gaussian transitions)
def log_posterior(params):
    kappa, mu, sig = params
    if kappa <= 0 or sig <= 0:
        return -np.inf
    # Priors: kappa ~ Exp(0.1), mu ~ N(1.10, 0.05^2), sigma ~ HalfNormal(0.02)
    log_prior = -0.1 * kappa  # Exp(rate=0.1)
    log_prior += -0.5 * ((mu - 1.10) / 0.05)**2
    log_prior += -0.5 * (sig / 0.02)**2  # HalfNormal(scale=0.02)
    # OU transition: X(t+1) | X(t) ~ N(X(t) + kappa*(mu-X(t))*dt, sigma^2*dt)
    residuals = X[1:] - X[:-1] - kappa * (mu - X[:-1]) * dt
    trans_var = sig**2 * dt
    log_lik = -0.5 * np.sum(residuals**2 / trans_var) - 0.5 * (n_obs-1) * np.log(trans_var)
    return log_prior + log_lik

def grad_log_posterior(params, eps=1e-5):
    """Numerical gradient for HMC."""
    grad = np.zeros(3)
    for i in range(3):
        p_plus = params.copy(); p_plus[i] += eps
        p_minus = params.copy(); p_minus[i] -= eps
        lp_plus = log_posterior(p_plus)
        lp_minus = log_posterior(p_minus)
        if np.isinf(lp_plus) or np.isinf(lp_minus):
            grad[i] = 0.0
        else:
            grad[i] = (lp_plus - lp_minus) / (2 * eps)
    return grad

# Simple HMC sampler for the OU model
def hmc_ou(n_iter, step_size, n_leap, init):
    d = len(init)
    chain = np.zeros((n_iter, d))
    chain[0] = init.copy()
    acc = 0
    for i in range(1, n_iter):
        q = chain[i-1].copy()
        p = np.random.randn(d)
        H0 = -log_posterior(q) + 0.5 * np.sum(p**2)
        q_new, p_new = q.copy(), p.copy()
        # Leapfrog
        g = grad_log_posterior(q_new)
        p_new += 0.5 * step_size * g
        for _ in range(n_leap - 1):
            q_new += step_size * p_new
            q_new[0] = max(q_new[0], 1e-6)  # kappa > 0
            q_new[2] = max(q_new[2], 1e-6)  # sigma > 0
            g = grad_log_posterior(q_new)
            p_new += step_size * g
        q_new += step_size * p_new
        q_new[0] = max(q_new[0], 1e-6)
        q_new[2] = max(q_new[2], 1e-6)
        g = grad_log_posterior(q_new)
        p_new += 0.5 * step_size * g
        H1 = -log_posterior(q_new) + 0.5 * np.sum(p_new**2)
        if np.log(np.random.uniform()) < H0 - H1:
            chain[i] = q_new
            acc += 1
        else:
            chain[i] = chain[i-1]
    return chain, acc / (n_iter - 1)

# Run 3 chains
n_iter = 4000
burn = 1500
inits = [
    np.array([2.0, 1.10, 0.005]),
    np.array([8.0, 1.11, 0.012]),
    np.array([5.0, 1.095, 0.008]),
]
all_chains = []
for ci, init in enumerate(inits):
    ch, ar = hmc_ou(n_iter, step_size=0.0005, n_leap=15, init=init)
    all_chains.append(ch)
    print(f"Chain {ci+1}: acc_rate={ar:.3f}, final=[kappa={ch[-1,0]:.2f}, "
          f"mu={ch[-1,1]:.5f}, sig={ch[-1,2]:.5f}]")

# Convergence diagnostics
def split_rhat(chains, burn):
    trimmed = [c[burn:] for c in chains]
    segments = []
    for c in trimmed:
        m = len(c) // 2
        segments.extend([c[:m], c[m:]])
    M, N = len(segments), len(segments[0])
    means = [s.mean() for s in segments]
    gm = np.mean(means)
    B = N / (M - 1) * sum((m - gm)**2 for m in means)
    W = np.mean([np.var(s, ddof=1) for s in segments])
    if W == 0: return 1.0
    return np.sqrt(((N-1)/N * W + B/N) / W)

param_names = ["kappa", "mu", "sigma"]
posterior = np.concatenate([c[burn:] for c in all_chains])
print(f"\\n{'Param':<8} {'Mean':>8} {'Std':>8} {'2.5%':>8} {'97.5%':>8} {'R-hat':>6}")
print("-" * 50)
for j, name in enumerate(param_names):
    param_chains = [c[:, j] for c in all_chains]
    rh = split_rhat(param_chains, burn)
    vals = posterior[:, j]
    print(f"{name:<8} {vals.mean():8.4f} {vals.std():8.4f} "
          f"{np.percentile(vals,2.5):8.4f} {np.percentile(vals,97.5):8.4f} {rh:6.3f}")

# Half-life with uncertainty
kappa_post = posterior[:, 0]
half_lives = np.log(2) / kappa_post * 252  # in trading days
print(f"\\nHalf-life (trading days): mean={half_lives.mean():.1f}, "
      f"95% CI=[{np.percentile(half_lives,2.5):.1f}, {np.percentile(half_lives,97.5):.1f}]")
print(f"True half-life: {np.log(2)/true_kappa*252:.1f} trading days")`,
      explanation: `This code estimates parameters of an Ornstein-Uhlenbeck process — the standard model for mean-reverting forex spreads — using HMC with numerical gradients. The OU transition density is conditionally Gaussian: X(t+dt)|X(t) ~ N(X(t) + κ(μ-X(t))dt, σ²dt), giving a tractable likelihood. Three chains with dispersed initializations ensure convergence verification via split-R̂. The key output is the posterior distribution over the half-life ln(2)/κ, converted to trading days. Instead of a single point estimate, we get a full credible interval — if the 95% CI for half-life spans 20-60 days, that uncertainty directly affects position sizing and holding period decisions. The positivity constraints on κ and σ are enforced via reflection at the boundary.`
    },
    {
      type: "quiz",
      questions: [
        {
          id: "mcmc-q1",
          question: "You are running Metropolis-Hastings with a symmetric proposal on a posterior π(θ) ∝ exp(-θ⁴/4). Current state θ = 1.0, proposed θ' = 1.5. What is the acceptance probability α?",
          options: [
            { id: "a", text: "α = min(1, exp(-1.5⁴/4 + 1.0⁴/4)) = min(1, exp(-1.0156)) ≈ 0.362" },
            { id: "b", text: "α = min(1, exp(-1.0⁴/4 + 1.5⁴/4)) = min(1, exp(1.0156)) ≈ 2.762, so α = 1.0" },
            { id: "c", text: "α = min(1, (1.5/1.0)⁴) = min(1, 5.0625) = 1.0" },
            { id: "d", text: "α = 1.0 because the proposal is symmetric" }
          ],
          correctOptionId: "a",
          explanation: "For symmetric proposals, α = min(1, π(θ')/π(θ)). Here π(θ) ∝ exp(-θ⁴/4), so log(π(θ')/π(θ)) = -1.5⁴/4 + 1.0⁴/4 = -5.0625/4 + 1/4 = -1.265625 + 0.25 = -1.015625. Thus α = exp(-1.0156) ≈ 0.362. The proposed move to a lower-density region is accepted about 36% of the time. Option (b) has the ratio inverted. Option (d) confuses symmetry of the proposal (which simplifies the ratio) with automatic acceptance."
        },
        {
          id: "mcmc-q2",
          question: "Why does HMC use a symplectic (leapfrog) integrator instead of a simpler Euler integrator?",
          options: [
            { id: "a", text: "Euler is slower to compute per step, making it less efficient overall" },
            { id: "b", text: "Symplectic integrators exactly preserve phase-space volume (no Jacobian correction needed) and bound energy error, preventing it from growing with trajectory length" },
            { id: "c", text: "The leapfrog integrator always produces zero energy error ΔH = 0, guaranteeing 100% acceptance" },
            { id: "d", text: "Euler integrators cannot compute gradients of the log-posterior" }
          ],
          correctOptionId: "b",
          explanation: "The symplectic property means the integrator preserves the volume element dθ dp, so the determinant of the Jacobian is exactly 1 — no correction factor needed in the MH acceptance step. Moreover, the energy error ΔH of a symplectic integrator remains bounded and oscillates rather than growing linearly or exponentially with trajectory length L (as Euler's does). This allows long trajectories with small ΔH and high acceptance rates. Option (c) is wrong because ΔH is O(ε²), not zero — the MH correction handles this residual error."
        },
        {
          id: "mcmc-q3",
          question: "You run 4 MCMC chains of length 2000 each (post-burnin). The split-R̂ for parameter β is 1.08. What should you conclude and do?",
          options: [
            { id: "a", text: "R̂ = 1.08 is fine — anything below 1.1 indicates convergence per the classical Gelman-Rubin threshold" },
            { id: "b", text: "R̂ = 1.08 indicates likely non-convergence: between-chain variance significantly exceeds within-chain variance. Run chains longer, improve initialization, or check for multimodality" },
            { id: "c", text: "R̂ = 1.08 means the posterior has 8% more variance than expected, which is acceptable for most applications" },
            { id: "d", text: "R̂ cannot be computed with 4 chains; you need exactly 2" }
          ],
          correctOptionId: "b",
          explanation: "Modern guidance (Vehtari et al., 2021) recommends R̂ < 1.01. An R̂ of 1.08 is well above this threshold, indicating the chains have not fully mixed — they are exploring different regions of the posterior. The between-chain variance B is inflated relative to within-chain variance W. Solutions: (1) run chains much longer, (2) improve proposal/step-size tuning, (3) check for multimodality causing chains to get trapped, (4) reparameterize the model. The old threshold of 1.1 was too permissive."
        },
        {
          id: "mcmc-q4",
          question: "A chain of 10,000 samples has autocorrelations ρ(1)=0.90, ρ(2)=0.81, ρ(3)=0.73, ρ(4)=0.66, ρ(5)=0.59, ..., with ρ(k) ≈ 0.9^k. Approximately what is the ESS?",
          options: [
            { id: "a", text: "ESS ≈ 10,000 (autocorrelation doesn't affect ESS)" },
            { id: "b", text: "ESS ≈ 10,000 / (1 + 2·(0.9/(1-0.9))) = 10,000/19 ≈ 526" },
            { id: "c", text: "ESS ≈ 10,000 × 0.9 = 9,000" },
            { id: "d", text: "ESS ≈ 10,000 / 0.9 ≈ 11,111" }
          ],
          correctOptionId: "b",
          explanation: "ESS = N / (1 + 2·Σₖρ(k)). For geometric autocorrelation ρ(k) = r^k, the sum Σₖ₌₁^∞ r^k = r/(1-r). With r=0.9: Σ = 0.9/0.1 = 9. So ESS = 10,000/(1 + 2·9) = 10,000/19 ≈ 526. Despite 10,000 nominal samples, the high autocorrelation (0.9 at lag 1) means we have only ~526 effectively independent samples. This is common with poorly-tuned random-walk MH. HMC typically achieves much lower autocorrelation and thus higher ESS for the same number of samples."
        },
        {
          id: "mcmc-q5",
          question: "In HMC, what happens if the leapfrog step size ε is set much too large (e.g., ε = 5.0 when the posterior has unit-scale curvature)?",
          options: [
            { id: "a", text: "The sampler explores faster because each step covers more of the parameter space" },
            { id: "b", text: "The leapfrog integrator produces large energy errors |ΔH|, causing nearly all proposals to be rejected. The chain effectively freezes at its current position" },
            { id: "c", text: "The mass matrix M automatically compensates for the large step size" },
            { id: "d", text: "The sampler converges to a different distribution than the target posterior" }
          ],
          correctOptionId: "b",
          explanation: "When ε is too large, the leapfrog integrator poorly approximates the true Hamiltonian dynamics — trajectories diverge wildly, producing proposed states with very different energy H(θ*, p*) compared to the initial H(θ, p). Since the acceptance probability is min(1, exp(-ΔH)), large |ΔH| values (e.g., ΔH = 50) yield acceptance ≈ exp(-50) ≈ 0. The chain stays at its current position, acceptance rate drops near zero, and ESS collapses. The fix: reduce ε or use NUTS with dual averaging, which automatically finds an appropriate ε during warmup."
        },
        {
          id: "mcmc-q6",
          question: "You perform a posterior predictive check on a forex mean-reversion model. The observed number of zero-crossings in your data is 47, but the posterior predictive distribution of zero-crossings has mean 32 and 95% interval [22, 43]. What does this suggest?",
          options: [
            { id: "a", text: "The model is perfect because 47 is close to the upper bound of 43" },
            { id: "b", text: "The model underestimates mean-reversion speed: it predicts fewer zero-crossings than observed. The OU process κ estimate may be biased low, or the model structure is too simple (e.g., missing regime-switching)" },
            { id: "c", text: "The data has too many zero-crossings, so you should remove outliers until the count falls within [22, 43]" },
            { id: "d", text: "Posterior predictive checks are invalid for financial data because returns are non-stationary" }
          ],
          correctOptionId: "b",
          explanation: "The observed test statistic (47 crossings) falls outside the 95% posterior predictive interval [22, 43], with a posterior predictive p-value near 0.98 — the model almost never generates as many crossings as observed. This indicates the model's mean-reversion speed κ is too low or the model structure doesn't capture the data's crossing behavior. Possible causes: regime-switching (alternating trending/reverting periods), time-varying κ, or a different noise structure (e.g., jump diffusion). The practical implication: if the model underestimates crossing frequency, it may also underestimate the strategy's actual edge, and credible intervals for profit are unreliable."
        }
      ]
    },
    {
      type: "practice",
      title: "MCMC Mean-Reversion Half-Life Estimation (OU Process)",
      description: `Implement a complete Metropolis-Hastings sampler to estimate the half-life of mean reversion in a simulated (or real) forex spread, with full uncertainty quantification.

**Task:**
1. Simulate 750 daily observations from an Ornstein-Uhlenbeck process: dX = κ(μ - X)dt + σdW with κ=3.0, μ=0.0, σ=0.05, dt=1/252.
2. Write a log-posterior function for (κ, μ, σ) using the exact OU transition density and weakly informative priors.
3. Implement a 3-parameter Metropolis-Hastings sampler with adaptive proposal covariance: during the first 500 iterations, use a diagonal proposal; after 500, use the empirical covariance of accepted samples scaled by 2.38²/d.
4. Run 4 chains of 8000 iterations each from dispersed starting points.
5. Compute split-R̂ and ESS for each parameter. Verify R̂ < 1.01.
6. Compute the posterior distribution of half-life = ln(2)/κ (in trading days) and report the mean, median, and 90% credible interval.
7. Perform a posterior predictive check using the lag-1 autocorrelation of the OU process as the test statistic.

**Stretch goal:** Compare results using (a) fixed vs. adaptive proposals, and (b) different prior strengths on κ. Quantify how the prior affects the half-life credible interval width.`,
      catalogModelId: "bayesian-regression"
    },
    {
      type: "practice",
      title: "Stochastic Volatility Model Estimation with HMC",
      description: `Build an HMC sampler for a stochastic volatility (SV) model applied to forex returns, estimating time-varying volatility with full Bayesian uncertainty.

**Task:**
1. Simulate 500 daily forex returns from the SV model:
     y_t = exp(h_t / 2) · ε_t,    ε_t ~ N(0,1)
     h_t = α + φ·(h_{t-1} - α) + σ_η · η_t,    η_t ~ N(0,1)
   with α = -1.0 (baseline log-vol), φ = 0.97 (persistence), σ_η = 0.15 (vol-of-vol).

2. Write the joint log-posterior over parameters (α, φ, σ_η) and latent log-volatilities h = (h_1, ..., h_T). Note: this is a high-dimensional problem (T+3 parameters), making HMC essential.

3. Implement HMC with leapfrog integration. Use block sampling: update (α, φ, σ_η) in one HMC step and h in another (or jointly if feasible). Use numerical gradients initially; for the stretch goal, derive analytic gradients.

4. Run the sampler for 3000 iterations (1000 warmup). Monitor acceptance rates and adjust step sizes to achieve 60-80% acceptance for each block.

5. Extract the posterior mean and 95% credible band for the volatility path exp(h_t/2). Plot against the true simulated volatility path.

6. Compute posterior summaries for (α, φ, σ_η) with R̂ diagnostics.

7. Perform a posterior predictive check: simulate return series from the posterior and compare the kurtosis and autocorrelation of squared returns against the observed data.

**Stretch goals:** (a) Implement the non-centered parameterization h_t = α + σ_η · h̃_t where h̃ follows a unit-scale AR(1), and compare mixing. (b) Add leverage (corr(ε_t, η_t) ≠ 0) and test whether the data support asymmetric volatility.`,
      catalogModelId: "bayesian-regression"
    }
  ],
}

