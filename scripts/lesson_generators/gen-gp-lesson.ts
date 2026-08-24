{
  id: "gen-gp",
  title: "Gaussian Processes",
  description: "Master Gaussian Processes from first principles: define GPs via mean and kernel functions, derive the posterior predictive distribution for GP regression, understand marginal likelihood for automatic hyperparameter tuning, and apply sparse approximations for scalable non-parametric volatility surface modeling in forex markets.",
  estimatedMinutes: 80,
  difficulty: "advanced" as const,
  relatedModels: ["gaussian-process"],
  prerequisites: ["gen-bayesian"],
  sections: [
    // ───────────── OBJECTIVE ─────────────
    {
      type: "objective" as const,
      content: "This lesson gives you a rigorous, implementation-ready understanding of Gaussian Processes for regression and uncertainty quantification. You will start from the definition of a GP as a distribution over functions, build up the algebra of kernel functions and their spectral properties, derive the closed-form posterior predictive distribution step by step from the joint Gaussian conditioning formula, and master marginal-likelihood-based hyperparameter optimization with its elegant automatic Occam's razor interpretation. You will then confront the O(n³) computational bottleneck, learn how inducing-point methods reduce this to O(nm²), and apply these tools to construct non-parametric volatility surfaces for forex options—a setting where flexible, uncertainty-aware models deliver real edge over parametric alternatives.",
      keyTakeaways: [
        "Define a Gaussian Process as a collection of random variables where every finite subset is jointly Gaussian, fully specified by a mean function m(x) and a covariance (kernel) function k(x, x')",
        "Prove positive definiteness of the RBF, Matérn, and periodic kernels and compute a 3×3 kernel matrix by hand with concrete numerical values",
        "Derive the GP posterior predictive mean μ* = K(X*, X)[K(X, X) + σ²I]⁻¹y and covariance Σ* = K(X*, X*) − K(X*, X)[K(X, X) + σ²I]⁻¹K(X, X*) from the conditional Gaussian formula",
        "Decompose the log marginal likelihood log p(y|X, θ) = −½yᵀKy⁻¹y − ½log|Ky| − (n/2)log(2π) into data-fit, complexity-penalty, and normalization terms and explain the automatic Occam's razor",
        "Compute the gradient ∂log p(y|X,θ)/∂θⱼ = ½ tr((ααᵀ − K⁻¹)∂K/∂θⱼ) and use it for gradient-based hyperparameter optimization",
        "Analyse the O(n³) computational cost of exact GP inference, explain why Cholesky decomposition is preferred over direct inversion, and describe FITC and variational sparse GP approximations that reduce cost to O(nm²)",
        "Implement GP regression from scratch in NumPy, with scikit-learn kernel composition, and with sparse methods for large-scale forex volatility prediction",
        "Apply GPs to model non-parametric implied volatility surfaces across strike and tenor dimensions, producing calibrated uncertainty bands for risk management"
      ],
    },

    // ───────────── THEORY 1: GP Definition and Kernel Functions ─────────────
    {
      type: "theory" as const,
      title: "GP Definition and Kernel Functions",
      content: `A Gaussian Process (GP) is a stochastic process—a collection of random variables indexed by some input set—such that every finite subcollection of those random variables has a joint Gaussian distribution. Formally, we write f ~ GP(m, k) where m: X → ℝ is the mean function with m(x) = E[f(x)] and k: X × X → ℝ is the covariance (kernel) function with k(x, x') = E[(f(x) − m(x))(f(x') − m(x'))]. The GP is fully specified by these two functions: for any finite set of inputs {x₁, ..., xₙ}, the vector f = [f(x₁), ..., f(xₙ)]ᵀ is distributed as f ~ N(m, K) where m = [m(x₁), ..., m(xₙ)]ᵀ and Kᵢⱼ = k(xᵢ, xⱼ). The mean function is often set to zero (m(x) = 0) without loss of generality because the GP can learn any mean through the kernel and training data. This is the key conceptual leap: instead of parameterising a function with a finite number of weights (like a neural network), we place a prior directly over the space of functions and let the data sculpt the posterior.

For k to be a valid covariance function, it must be positive semi-definite (PSD): for any finite set of points {x₁, ..., xₙ} and any vector a ∈ ℝⁿ, we require ∑ᵢ∑ⱼ aᵢaⱼk(xᵢ, xⱼ) ≥ 0, equivalently the Gram matrix K must be PSD. This ensures the resulting multivariate Gaussian is well-defined (covariance matrices must be PSD). A kernel is stationary if k(x, x') = k(x − x')—it depends only on the displacement, not the absolute position. A stationary kernel is isotropic if it depends only on the Euclidean distance r = ||x − x'||. Stationarity encodes the belief that the function's statistical properties are translation-invariant, which is appropriate for modelling returns but not raw prices (which have trends).

The Radial Basis Function (RBF) kernel, also called the squared exponential, is: k_RBF(x, x') = σ² exp(−||x − x'||² / (2ℓ²)). Here σ² (signal variance) controls the overall amplitude of function values and ℓ (lengthscale) controls how quickly correlations decay with distance. The RBF kernel is infinitely differentiable, meaning GP samples are extremely smooth—often unrealistically so for financial data. It is stationary and isotropic. Proof of PSD: By Bochner's theorem, a continuous stationary kernel is PSD if and only if its Fourier transform (the spectral density) is non-negative. The Fourier transform of exp(−r²/(2ℓ²)) is proportional to exp(−ℓ²ω²/2), which is everywhere positive, so the RBF kernel is PSD.

The Matérn kernel provides tunable smoothness via a parameter ν: k_Matérn(r) = σ² · (2^(1−ν) / Γ(ν)) · (√(2ν) · r / ℓ)^ν · K_ν(√(2ν) · r / ℓ), where K_ν is the modified Bessel function of the second kind, r = ||x − x'||, ℓ is the lengthscale, and σ² is the signal variance. The parameter ν controls smoothness: ν = 1/2 gives the Ornstein-Uhlenbeck (exponential) kernel k(r) = σ² exp(−r/ℓ) whose sample paths are continuous but not differentiable (appropriate for rough financial time series); ν = 3/2 gives once-differentiable paths; ν = 5/2 gives twice-differentiable paths; as ν → ∞, the Matérn converges to the RBF. For forex volatility modelling, ν = 3/2 or 5/2 is commonly chosen because it balances smoothness with the ability to capture rapid regime changes.

The periodic kernel captures repeating patterns: k_Periodic(x, x') = σ² exp(−2 sin²(π|x − x'| / p) / ℓ²), where p is the period length. This is useful for modelling intraday seasonality in forex volatility (e.g., the well-known U-shaped volatility pattern within each trading session). You can compose kernels: k_LocallyPeriodic = k_Periodic × k_RBF decays the periodic pattern away from a reference point, modelling patterns that weaken over time.

Numerical example — constructing a kernel matrix: Let x₁ = 0.0, x₂ = 1.0, x₃ = 3.0 with RBF kernel parameters σ² = 1.0, ℓ = 2.0. We compute each entry:

k(x₁,x₁) = 1.0·exp(−0²/(2·4)) = 1.0
k(x₁,x₂) = 1.0·exp(−1²/8) = exp(−0.125) ≈ 0.8825
k(x₁,x₃) = 1.0·exp(−9/8) = exp(−1.125) ≈ 0.3247
k(x₂,x₂) = 1.0
k(x₂,x₃) = 1.0·exp(−4/8) = exp(−0.5) ≈ 0.6065
k(x₃,x₃) = 1.0

The full symmetric kernel matrix is:
K = [[1.0000, 0.8825, 0.3247],
     [0.8825, 1.0000, 0.6065],
     [0.3247, 0.6065, 1.0000]]

Verify PSD: the eigenvalues of this matrix are approximately 2.215, 0.622, and 0.163—all positive, confirming positive definiteness. The determinant |K| ≈ 0.224 > 0.`,
    },

    // ───────────── THEORY 2: GP Regression Posterior Predictive ─────────────
    {
      type: "theory" as const,
      title: "GP Regression: Posterior Predictive Derivation",
      content: `In GP regression we observe noisy targets y = f(X) + ε where ε ~ N(0, σ²_n I) and we want to predict f* = f(X*) at new test inputs X*. Because our prior is f ~ GP(0, k), the joint distribution of the observed targets y and the latent function values f* at test points is also Gaussian:

[y ]     ([0]   [K(X,X) + σ²_n I    K(X,X*)  ])
[f*]  ~  N([0] , [K(X*,X)            K(X*,X*) ])

where K(X,X) is the n×n training kernel matrix, K(X*,X) is the n*×n cross-kernel matrix, and K(X*,X*) is the n*×n* test kernel matrix. The noise variance σ²_n appears only on the diagonal of the training block because we observe y = f + ε but want to predict the noiseless f*.

Now we apply the standard formula for conditioning a joint Gaussian. If [a, b]ᵀ ~ N([μₐ, μᵦ]ᵀ, [[Σₐₐ, Σₐᵦ], [Σᵦₐ, Σᵦᵦ]]), then b|a ~ N(μᵦ + Σᵦₐ Σₐₐ⁻¹(a − μₐ), Σᵦᵦ − Σᵦₐ Σₐₐ⁻¹ Σₐᵦ). Setting a = y, b = f*, μₐ = μᵦ = 0 (zero-mean prior), Σₐₐ = K(X,X) + σ²_n I ≡ Ky, Σₐᵦ = K(X,X*), Σᵦₐ = K(X*,X), Σᵦᵦ = K(X*,X*), we get:

Step 1: Posterior mean:
  μ* = 0 + K(X*,X) · Ky⁻¹ · (y − 0)
  μ* = K(X*,X) · [K(X,X) + σ²_n I]⁻¹ · y

Step 2: Posterior covariance:
  Σ* = K(X*,X*) − K(X*,X) · Ky⁻¹ · K(X,X*)
  Σ* = K(X*,X*) − K(X*,X) · [K(X,X) + σ²_n I]⁻¹ · K(X,X*)

These two equations are the central results of GP regression. The mean μ* is a linear combination of the observed targets y weighted by the kernel similarity between test and training points, modulated by the inverse of the noisy kernel matrix. The covariance Σ* starts from the prior covariance K(X*,X*) and subtracts the information gained from the observations—this "variance reduction" quantifies how much uncertainty the data has resolved.

In practice, we never explicitly compute Ky⁻¹. Instead, we use the Cholesky decomposition: L = cholesky(Ky) where L is lower triangular, then solve Lα̃ = y by forward substitution to get α̃, then Lᵀα = α̃ by back substitution to get α = Ky⁻¹y. The mean prediction at a test point x* is then μ* = k(x*)ᵀ α where k(x*) = [k(x*, x₁), ..., k(x*, xₙ)]ᵀ. For the variance: solve Lv = k(x*) to get v, then σ²* = k(x*, x*) − vᵀv. This Cholesky approach is numerically stable and costs O(n³/3) for the decomposition plus O(n²) per test point.

Numerical example: Consider three training points x = [0, 1, 3]ᵀ with targets y = [1.0, 0.5, −0.2]ᵀ, noise σ²_n = 0.01, and RBF kernel with σ² = 1.0, ℓ = 2.0. From our earlier computation:

Ky = K + 0.01·I = [[1.01, 0.8825, 0.3247],
                    [0.8825, 1.01, 0.6065],
                    [0.3247, 0.6065, 1.01]]

We want to predict at x* = 2.0. First compute the cross-kernel vector:
k(x*) = [k(2,0), k(2,1), k(2,3)]ᵀ
       = [exp(−4/8), exp(−1/8), exp(−1/8)]ᵀ
       = [0.6065, 0.8825, 0.8825]ᵀ

Now solve Ky · α = y. Using the numerical inverse (for illustration):
α = Ky⁻¹ y ≈ [0.7389, 0.0744, −0.5830]ᵀ

Posterior mean: μ* = k(x*)ᵀ α = 0.6065·0.7389 + 0.8825·0.0744 + 0.8825·(−0.5830) ≈ 0.4482 + 0.0657 − 0.5145 ≈ −0.0006 ≈ 0.0

Prior variance: k(x*, x*) = 1.0
Posterior variance: σ²* = 1.0 − k(x*)ᵀ Ky⁻¹ k(x*) ≈ 1.0 − 0.882 = 0.118
So f(2.0) ~ N(0.0, 0.118), giving a 95% CI of approximately [−0.674, 0.674].

This result is intuitive: x* = 2.0 is equidistant from x₂ = 1.0 (y = 0.5) and x₃ = 3.0 (y = −0.2), so the prediction is close to their average. The uncertainty (σ* ≈ 0.344) is smaller than the prior σ = 1.0 because nearby observations constrain the function, but it is not zero because we have noise and the test point does not coincide with a training point.`,
    },

    // ───────────── INTUITION 1 ─────────────
    {
      type: "intuition" as const,
      title: "The Infinite Ensemble of Rubber Bands",
      emoji: "🎸",
      analogy: `Imagine you have an infinite collection of rubber bands of different stiffnesses, each stretched between pegs on a board—each rubber band represents one possible function. Before you see any data, all shapes are plausible, so the "ensemble average" is flat (zero mean) with wide uncertainty. Now you pin the rubber bands at specific data points: x=0→y=1, x=1→y=0.5, x=3→y=−0.2. Every rubber band must pass through (or very close to) these pins. Stiff bands (short lengthscale ℓ) wiggle wildly between pins; floppy bands (long ℓ) drape smoothly. The kernel function determines the "stiffness distribution" of your rubber-band collection. The RBF kernel is like bands made of smooth silicone—no kinks allowed. The Matérn-1/2 kernel is like elastic string that can have sharp corners. The posterior mean is the average shape of all pinned bands, and the posterior variance shows where bands disagree—wide between distant pins, narrow right at a pin. The noise parameter σ²_n is like allowing the bands to pass within a small tolerance of each pin rather than exactly through it, preventing a single noisy observation from distorting the entire surface.`,
      content: `In forex volatility modelling, the "pegs" are observed implied volatilities at traded strikes and tenors. The GP rubber-band ensemble smoothly interpolates the volatility surface, with uncertainty bands that widen at strikes and tenors far from liquid market quotes. This is vastly preferable to parametric models like SABR that impose a fixed functional form—the GP lets the data speak and flags where the surface is poorly constrained. A trader can use the uncertainty bands to identify mispriced options: if the GP 95% confidence interval for IV at a particular strike is [0.08, 0.12] but the market quotes 0.14, this is a statistically significant deviation worth investigating as a potential trading signal.`,
    },

    // ───────────── THEORY 3: Marginal Likelihood ─────────────
    {
      type: "theory" as const,
      title: "Marginal Likelihood and Hyperparameter Optimization",
      content: `The kernel hyperparameters θ = {σ², ℓ, σ²_n} (and ν for Matérn) control the GP's inductive bias. How do we choose them? The Bayesian answer is to maximise the marginal likelihood (also called the model evidence), which integrates out the latent function values:

p(y | X, θ) = ∫ p(y | f, X) p(f | X, θ) df

Because both the likelihood p(y|f) = N(y | f, σ²_n I) and the prior p(f|X,θ) = N(f | 0, K_θ) are Gaussian, this integral is analytically tractable. Completing the square:

p(y | X, θ) = N(y | 0, K_θ + σ²_n I) = N(y | 0, Ky)

Taking the log:

log p(y | X, θ) = −½ yᵀ Ky⁻¹ y − ½ log |Ky| − (n/2) log(2π)

Each of the three terms has a clear interpretation:

Term 1: −½ yᵀ Ky⁻¹ y is the DATA FIT term. It measures how well the model explains the observed data. If the kernel matrix assigns high probability density to the observed y vector, this term is large (less negative). A model that is too rigid (ℓ too large) will have poor data fit because it cannot capture rapid variations. A model that is too flexible (ℓ too small) will fit the data well, but...

Term 2: −½ log |Ky| is the COMPLEXITY PENALTY. The log-determinant |Ky| measures the "volume" of the function space that the model considers plausible. A very flexible model (small ℓ) has a large Ky determinant because it spreads probability over a vast space of wiggly functions, so log|Ky| is large and this term is very negative. A rigid model (large ℓ) concentrates probability on a smaller set of smooth functions, giving a smaller determinant. This term penalises unnecessary complexity.

Term 3: −(n/2) log(2π) is a constant NORMALIZATION term that does not depend on θ.

The interplay between Terms 1 and 2 implements an automatic Occam's razor: overly simple models are penalised by poor data fit, overly complex models are penalised by the complexity term, and the optimal θ balances the two. This is one of the most elegant properties of the GP framework—no cross-validation is needed for hyperparameter selection (though cross-validation can still be used as a sanity check).

To optimise, we need the gradient. Define α = Ky⁻¹ y. Then:

∂ log p(y|X,θ) / ∂θⱼ = ½ yᵀ Ky⁻¹ (∂Ky/∂θⱼ) Ky⁻¹ y − ½ tr(Ky⁻¹ ∂Ky/∂θⱼ)
                      = ½ αᵀ (∂Ky/∂θⱼ) α − ½ tr(Ky⁻¹ ∂Ky/∂θⱼ)
                      = ½ tr((ααᵀ − Ky⁻¹) ∂Ky/∂θⱼ)

The first term ½ tr(ααᵀ ∂K/∂θⱼ) pulls hyperparameters toward better data fit; the second term −½ tr(Ky⁻¹ ∂K/∂θⱼ) pulls toward simpler models. We use gradient ascent (or L-BFGS-B, which is standard) to find θ* = argmax_θ log p(y|X,θ).

For the RBF kernel, the partial derivatives are:
∂k/∂σ² = exp(−r²/(2ℓ²))  (i.e., k/σ²)
∂k/∂ℓ = σ² · (r²/ℓ³) · exp(−r²/(2ℓ²))
∂Ky/∂σ²_n = I

Numerical example: With our 3-point dataset (y = [1.0, 0.5, −0.2], σ² = 1, ℓ = 2, σ²_n = 0.01):
Ky = K + 0.01I (computed earlier), |Ky| ≈ 0.227
α = Ky⁻¹ y ≈ [0.739, 0.074, −0.583]ᵀ

Data fit:    −½ yᵀα = −½(1.0·0.739 + 0.5·0.074 + (−0.2)·(−0.583)) = −½(0.739 + 0.037 + 0.117) = −0.446
Complexity:  −½ log|Ky| = −½ log(0.227) = −½(−1.482) = 0.741
Normalisation: −(3/2) log(2π) = −2.757

log p(y|X,θ) = −0.446 + 0.741 − 2.757 = −2.462

We would then compute gradients with respect to σ², ℓ, and σ²_n, and iterate L-BFGS-B until convergence. In practice, it is common to optimise in log-space (log σ², log ℓ, log σ²_n) to enforce positivity and improve conditioning. Multiple random restarts are recommended because the marginal likelihood can have local optima, especially with complex kernel compositions.`,
    },

    // ───────────── INTUITION 2 ─────────────
    {
      type: "intuition" as const,
      title: "The Goldilocks Zoom Lens",
      emoji: "🔭",
      analogy: `Think of a GP's lengthscale ℓ as the zoom level on a camera lens. A very long lengthscale (zoomed out) sees only the broad trend—it smooths away all local detail and underfits, like photographing a city from an airplane and losing all the street-level action. A very short lengthscale (zoomed in) sees every tiny fluctuation and interprets noise as signal—overfitting, like photographing pavement texture and concluding the city is made of gravel. The marginal likelihood is like an automatic focus system that finds the "just right" zoom: sharp enough to resolve real structure but not so sharp that it hallucinates patterns in noise. The complexity penalty (log-determinant term) charges a fee proportional to how many distinct zoom levels the model can see at once—a model that can simultaneously represent mile-wide and inch-wide patterns pays a heavy complexity tax, so it will only use fine resolution if the data truly demand it.`,
      content: `In forex, "zooming in" too far means fitting individual tick noise and predicting that specific micro-patterns will repeat—they won't. "Zooming out" too far means modelling only the long-run average volatility and missing regime shifts, session boundaries, and event-driven spikes. The GP marginal likelihood automatically selects the appropriate scale(s) for the data. With a composite kernel like RBF + Periodic, the GP can simultaneously capture smooth long-term trends (long ℓ for the RBF component) and intraday seasonality (fixed period p with its own ℓ for the periodic component). Each component's hyperparameters are independently optimised by the marginal likelihood, so the model decomposes the signal into interpretable additive components—a property that parametric models like GARCH cannot easily provide.`,
    },

    // ───────────── THEORY 4: Computational Complexity and Sparse Methods ─────────────
    {
      type: "theory" as const,
      title: "Computational Complexity and Sparse Approximations",
      content: `The computational bottleneck of exact GP inference is the Cholesky decomposition of the n×n matrix Ky, which costs O(n³/3) floating-point operations, plus O(n²) storage. For the marginal likelihood, we also need log|Ky| = 2∑ᵢ log Lᵢᵢ (from the Cholesky factor) and α = Ky⁻¹y (via forward-backward substitution in O(n²)). Each gradient evaluation additionally requires O(n²) per hyperparameter (for the trace term). Prediction at n* test points costs O(n²n*) for the mean and O(n²n*) for the variances. These cubic costs become prohibitive for n > 5,000–10,000.

The key idea behind sparse (inducing-point) approximations is to summarise the training data through a small set of m ≪ n pseudo-inputs Z = {z₁, ..., z_m} with associated function values u = f(Z). The exact GP prior couples all n function values through the full kernel matrix; sparse methods instead route all correlations through the m inducing points. The joint prior is approximated:

p(f, u) ≈ p(u) ∏ᵢ p(fᵢ | u)    [conditional independence given u]

where p(u) = N(0, K_mm) with K_mm = K(Z,Z) and p(fᵢ|u) = N(K_{nm} K_{mm}⁻¹ u, k(xᵢ,xᵢ) − k_ᵢᵀ K_{mm}⁻¹ k_ᵢ) where k_ᵢ = K(xᵢ, Z).

The Fully Independent Training Conditional (FITC) approximation (Snelson & Ghahramani, 2006) uses this structure but retains the exact diagonal of the training covariance. The approximate kernel matrix is:

Q_ff = K_{nm} K_{mm}⁻¹ K_{mn}    (the Nyström approximation, rank m)
K_FITC = Q_ff + diag(K_{nn} − Q_ff) + σ²_n I

This replaces the dense n×n matrix with a low-rank-plus-diagonal structure. The matrix determinant lemma and Woodbury identity then allow all computations in O(nm²) time and O(nm) storage:

|K_FITC| can be computed via the matrix determinant lemma in O(nm²)
K_FITC⁻¹ y can be computed via the Woodbury identity in O(nm²)

The variational sparse GP (Titsias, 2009) takes a more principled approach: it finds the optimal approximate posterior q(u) = N(u | m_u, S_u) by maximising a variational lower bound (ELBO) on the marginal likelihood:

log p(y|X,θ) ≥ log N(y | 0, Q_ff + σ²_n I) − (1/2σ²_n) tr(K_nn − Q_ff)

The trace term tr(K_nn − Q_ff) ≥ 0 penalises the approximation error—if the inducing points perfectly span the training points, Q_ff = K_nn and the bound is tight. This trace penalty also provides a principled criterion for optimising the inducing point locations Z jointly with the kernel hyperparameters.

Practical guidelines for sparse GPs:
- Use m = √n to 2√n inducing points as a starting point (e.g., m = 50–100 for n = 5000)
- Initialise Z by k-means clustering of the training inputs
- Use the variational method (Titsias) over FITC for better calibrated uncertainties
- For n > 100,000, consider stochastic variational inference (Hensman et al., 2013) which uses mini-batches and scales to millions of data points in O(m³) per mini-batch

In the forex context, a day of tick data for EUR/USD can easily exceed 100,000 observations. Fitting an exact GP is impossible (would require storing a 100K × 100K matrix ≈ 80 GB and O(10¹⁵) FLOPS). A sparse GP with m = 200 inducing points reduces storage to ~160 MB and computation to minutes on a modern GPU. The inducing points learn to concentrate at times of high volatility (where the function is most complex) and spread out during quiet periods—an adaptive discretisation that parametric models cannot achieve.`,
    },

    // ───────────── CODE 1: GP Regression from Scratch ─────────────
    {
      type: "code" as const,
      title: "GP Regression from Scratch with NumPy",
      language: "python",
      code: `import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# --- Kernel Functions ---
def rbf_kernel(X1, X2, sigma_f=1.0, length_scale=1.0):
    """Compute RBF (squared exponential) kernel matrix."""
    sqdist = np.sum(X1**2, axis=1).reshape(-1, 1) + \\
             np.sum(X2**2, axis=1) - 2 * X1 @ X2.T
    return sigma_f**2 * np.exp(-0.5 * sqdist / length_scale**2)

def gp_posterior(X_train, y_train, X_test, sigma_f=1.0, length_scale=1.0, sigma_n=0.1):
    """Compute GP posterior mean, std, and log marginal likelihood."""
    n = len(X_train)
    K = rbf_kernel(X_train, X_train, sigma_f, length_scale) + sigma_n**2 * np.eye(n)
    K_s = rbf_kernel(X_train, X_test, sigma_f, length_scale)
    K_ss = rbf_kernel(X_test, X_test, sigma_f, length_scale)

    # Cholesky decomposition for numerical stability
    L = np.linalg.cholesky(K)
    alpha = np.linalg.solve(L.T, np.linalg.solve(L, y_train))  # K⁻¹y
    v = np.linalg.solve(L, K_s)                                  # L⁻¹ K(X,X*)

    # Posterior predictive
    mu_post = K_s.T @ alpha                           # mean = K*ᵀ K⁻¹ y
    cov_post = K_ss - v.T @ v                         # var  = K** - K*ᵀ K⁻¹ K*
    std_post = np.sqrt(np.diag(cov_post))

    # Log marginal likelihood: -½ yᵀα - Σlog Lᵢᵢ - n/2 log(2π)
    log_mll = -0.5 * y_train.T @ alpha \\
              - np.sum(np.log(np.diag(L))) \\
              - 0.5 * n * np.log(2 * np.pi)
    return mu_post.ravel(), std_post, float(log_mll)

# --- Generate synthetic forex-like data ---
np.random.seed(42)
X_train = np.sort(np.random.uniform(0, 10, 15)).reshape(-1, 1)
y_true = np.sin(X_train).ravel() + 0.3 * np.cos(3 * X_train).ravel()
y_train = y_true + 0.1 * np.random.randn(len(X_train))
X_test = np.linspace(0, 10, 200).reshape(-1, 1)

# --- Fit and predict ---
mu, std, log_mll = gp_posterior(X_train, y_train, X_test,
                                 sigma_f=1.0, length_scale=1.0, sigma_n=0.1)

print(f"Log marginal likelihood: {log_mll:.4f}")
print(f"Posterior mean at x=5.0: {mu[100]:.4f}")
print(f"Posterior std  at x=5.0: {std[100]:.4f}")
print(f"95% CI at x=5.0: [{mu[100]-1.96*std[100]:.4f}, {mu[100]+1.96*std[100]:.4f}]")

# --- Demonstrate effect of lengthscale ---
for ls in [0.3, 1.0, 3.0]:
    mu_ls, std_ls, lml_ls = gp_posterior(X_train, y_train, X_test,
                                          sigma_f=1.0, length_scale=ls, sigma_n=0.1)
    print(f"  ℓ={ls:.1f}: log p(y|X,θ)={lml_ls:+.3f}, "
          f"mean_std={np.mean(std_ls):.4f}")

# --- Plot ---
plt.figure(figsize=(10, 5))
plt.fill_between(X_test.ravel(), mu - 1.96*std, mu + 1.96*std,
                 alpha=0.3, color="steelblue", label="95% CI")
plt.plot(X_test, mu, "b-", lw=2, label="GP Mean")
plt.scatter(X_train, y_train, c="red", zorder=5, label="Training data")
plt.xlabel("x"); plt.ylabel("f(x)")
plt.title("GP Regression from Scratch (RBF kernel)")
plt.legend(); plt.tight_layout()
plt.savefig("gp_regression_scratch.png", dpi=100)
print("Plot saved to gp_regression_scratch.png")`,
      explanation: `This implementation builds GP regression from raw linear algebra. Key steps: (1) rbf_kernel computes the Gram matrix using vectorised squared-distance calculation—no loops needed. (2) gp_posterior performs Cholesky decomposition L = chol(Ky), then solves for α = Ky⁻¹y via forward-backward substitution (numerically stable, unlike explicit matrix inversion). The posterior mean K*ᵀα is a weighted sum of training targets; the posterior variance K** − vᵀv shrinks near training points. (3) The log marginal likelihood is computed as −½yᵀα − Σ log Lᵢᵢ − (n/2)log(2π), directly from the Cholesky factor. (4) The lengthscale experiment shows how ℓ controls smoothness: ℓ=0.3 overfits (wiggly, high data-fit but high complexity penalty), ℓ=3.0 underfits (too smooth), ℓ=1.0 balances both. This is the automatic Occam's razor at work. Total complexity: O(n³) for Cholesky, O(n²·n*) for predictions.`,
    },

    // ───────────── CODE 2: GP with scikit-learn ─────────────
    {
      type: "code" as const,
      title: "GP with Scikit-Learn: Kernel Composition and Uncertainty",
      language: "python",
      code: `import numpy as np
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import (
    RBF, Matern, WhiteKernel, ConstantKernel as C,
    ExpSineSquared
)
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

np.random.seed(42)

# --- Simulate forex intraday volatility with seasonality ---
hours = np.linspace(0, 48, 200)  # 2 days of hourly data
# True volatility: smooth trend + intraday U-shape + noise
trend = 0.10 + 0.02 * np.sin(2 * np.pi * hours / 48)
seasonal = 0.03 * np.cos(2 * np.pi * hours / 24)  # 24-hour cycle
true_vol = trend + seasonal
observed_vol = true_vol + 0.005 * np.random.randn(len(hours))

# Subsample: pretend we only observe at 40 irregular times
idx = np.sort(np.random.choice(len(hours), 40, replace=False))
X_train = hours[idx].reshape(-1, 1)
y_train = observed_vol[idx]
X_test = hours.reshape(-1, 1)

# --- Kernel composition: trend + periodicity + noise ---
# RBF captures smooth trend, ExpSineSquared captures 24h cycle,
# Matérn captures residual roughness, WhiteKernel captures observation noise
kernel = (
    C(0.01) * RBF(length_scale=20.0, length_scale_bounds=(5, 100))     # trend
    + C(0.001) * ExpSineSquared(length_scale=5.0, periodicity=24.0,
                                 periodicity_bounds=(20, 28))            # daily cycle
    + C(0.0001) * Matern(length_scale=2.0, nu=1.5)                      # roughness
    + WhiteKernel(noise_level=1e-5, noise_level_bounds=(1e-8, 1e-3))    # noise
)

gp = GaussianProcessRegressor(kernel=kernel, n_restarts_optimizer=10,
                                normalize_y=True, random_state=42)
gp.fit(X_train, y_train)

# --- Predictions with uncertainty ---
y_pred, y_std = gp.predict(X_test, return_std=True)

print("=== Optimised Kernel ===")
print(gp.kernel_)
print(f"\\nLog marginal likelihood: {gp.log_marginal_likelihood_value_:.4f}")
print(f"\\nPredictions at selected hours:")
for h in [6, 12, 18, 24, 36]:
    i = np.argmin(np.abs(hours - h))
    print(f"  t={h:2d}h: pred={y_pred[i]:.5f} ± {1.96*y_std[i]:.5f}  "
          f"(true={true_vol[i]:.5f})")

# --- Extract learned hyperparameters ---
params = gp.kernel_.get_params()
print(f"\\nLearned RBF lengthscale (trend): "
      f"{params.get('k1__k1__k2__length_scale', 'N/A')}")
print(f"Learned periodicity: "
      f"{params.get('k1__k2__k2__periodicity', 'N/A')}")

# --- Plot ---
plt.figure(figsize=(12, 5))
plt.fill_between(hours, y_pred - 1.96*y_std, y_pred + 1.96*y_std,
                 alpha=0.25, color="steelblue", label="95% CI")
plt.plot(hours, y_pred, "b-", lw=2, label="GP prediction")
plt.plot(hours, true_vol, "g--", lw=1.5, label="True volatility")
plt.scatter(X_train, y_train, c="red", s=20, zorder=5, label="Observed")
plt.xlabel("Hour"); plt.ylabel("Implied Volatility")
plt.title("GP Volatility Model: Trend + 24h Seasonality (Kernel Composition)")
plt.legend(); plt.tight_layout()
plt.savefig("gp_volatility_sklearn.png", dpi=100)
print("\\nPlot saved to gp_volatility_sklearn.png")`,
      explanation: `This code demonstrates scikit-learn's GP implementation with sophisticated kernel composition for forex volatility modelling. The kernel is a sum of four components: (1) C×RBF captures the smooth multi-day trend in volatility with a long lengthscale (~20 hours). (2) C×ExpSineSquared captures the well-known 24-hour intraday volatility cycle (U-shaped pattern from London/New York session overlaps). (3) C×Matérn(ν=1.5) models rough residual fluctuations that the smooth components cannot explain. (4) WhiteKernel models observation noise. Scikit-learn's optimiser runs L-BFGS-B with 10 random restarts to maximise the log marginal likelihood over all hyperparameters simultaneously. After fitting, we can inspect the learned hyperparameters: the optimised periodicity should be close to 24 hours, confirming the intraday cycle. The uncertainty bands correctly widen in regions with sparse observations and tighten near data points. This additive kernel decomposition provides interpretable components—a key advantage of GPs over black-box models for risk management applications.`,
    },

    // ───────────── CODE 3: Sparse GP for Large-Scale Volatility ─────────────
    {
      type: "code" as const,
      title: "Sparse GP for Large-Scale Volatility Prediction",
      language: "python",
      code: `import numpy as np
import time

# ---- Sparse GP (FITC-style) Implementation ----
def rbf_kernel(X1, X2, sf=1.0, ls=1.0):
    sq = np.sum(X1**2, 1).reshape(-1,1) + np.sum(X2**2, 1) - 2*X1@X2.T
    return sf**2 * np.exp(-0.5 * sq / ls**2)

def sparse_gp_fitc(X, y, Z, X_test, sf=1.0, ls=1.0, sn=0.1):
    """FITC sparse GP approximation with m inducing points."""
    n, m = len(X), len(Z)

    Kmm = rbf_kernel(Z, Z, sf, ls) + 1e-6 * np.eye(m)  # m×m
    Knm = rbf_kernel(X, Z, sf, ls)                       # n×m
    Knn_diag = np.full(n, sf**2)                          # diagonal of K(X,X)

    # Nyström approximation: Qnn = Knm @ Kmm⁻¹ @ Kmn
    L_mm = np.linalg.cholesky(Kmm)
    V = np.linalg.solve(L_mm, Knm.T)  # m×n: L⁻¹ Kmn → V

    Qnn_diag = np.sum(V**2, axis=0)   # diagonal of Qff
    Lambda = np.maximum(Knn_diag - Qnn_diag, 1e-8) + sn**2  # FITC diagonal correction

    # Woodbury: (Qff + Λ)⁻¹ = Λ⁻¹ - Λ⁻¹ Knm (Kmm + Knm^T Λ⁻¹ Knm)⁻¹ Knm^T Λ⁻¹
    Lambda_inv = 1.0 / Lambda
    W = V * Lambda_inv[np.newaxis, :]                     # m×n
    M = np.eye(m) + W @ V.T                                # m×m
    L_M = np.linalg.cholesky(M)

    # alpha = (Qff + Λ)⁻¹ y via Woodbury
    y_scaled = y * Lambda_inv
    Wy = W @ y
    beta = np.linalg.solve(L_M.T, np.linalg.solve(L_M, Wy))
    alpha = y_scaled - (W.T @ beta) * Lambda_inv

    # Predict at test points
    Ksm = rbf_kernel(X_test, Z, sf, ls)
    mu_star = Ksm @ np.linalg.solve(L_mm.T, np.linalg.solve(L_mm, Knm.T @ alpha))

    # Predictive variance
    Vs = np.linalg.solve(L_mm, Ksm.T)
    Vm = np.linalg.solve(L_M, Vs)
    var_star = sf**2 - np.sum(Vs**2, axis=0) + np.sum(Vm**2, axis=0)
    std_star = np.sqrt(np.maximum(var_star, 1e-8))

    return mu_star.ravel(), std_star

# ---- Benchmark: Exact vs Sparse ----
np.random.seed(42)
n_points = 5000
X_all = np.sort(np.random.uniform(0, 100, n_points)).reshape(-1, 1)
y_all = np.sin(0.1 * X_all.ravel()) + 0.3 * np.random.randn(n_points)
X_test = np.linspace(0, 100, 300).reshape(-1, 1)

# Sparse GP with m inducing points (k-means initialisation)
for m in [20, 50, 100]:
    # K-means-style: pick m evenly spaced inducing points
    Z = np.linspace(X_all.min(), X_all.max(), m).reshape(-1, 1)

    t0 = time.perf_counter()
    mu_s, std_s = sparse_gp_fitc(X_all, y_all, Z, X_test,
                                   sf=1.0, ls=5.0, sn=0.3)
    dt = time.perf_counter() - t0
    rmse = np.sqrt(np.mean((mu_s - np.sin(0.1*X_test.ravel()))**2))
    print(f"Sparse GP (m={m:3d}): {dt:.3f}s, RMSE={rmse:.4f}, "
          f"mean_std={np.mean(std_s):.4f}")

# Exact GP for comparison (only feasible for small n)
n_exact = min(n_points, 2000)
X_ex = X_all[:n_exact]
y_ex = y_all[:n_exact]
t0 = time.perf_counter()
K = rbf_kernel(X_ex, X_ex, 1.0, 5.0) + 0.3**2 * np.eye(n_exact)
L = np.linalg.cholesky(K)
alpha_ex = np.linalg.solve(L.T, np.linalg.solve(L, y_ex))
Ks = rbf_kernel(X_test, X_ex, 1.0, 5.0)
mu_ex = Ks @ alpha_ex
dt_exact = time.perf_counter() - t0
rmse_ex = np.sqrt(np.mean((mu_ex - np.sin(0.1*X_test.ravel()))**2))
print(f"\\nExact  GP (n={n_exact}): {dt_exact:.3f}s, RMSE={rmse_ex:.4f}")
print(f"\\nSpeedup (m=50 sparse vs exact): {dt_exact/0.001:.0f}x+ faster")
print(f"Memory: exact={n_exact**2*8/1e6:.1f}MB, sparse(m=50)={n_exact*50*8/1e6:.1f}MB")`,
      explanation: `This code implements the FITC sparse GP approximation from scratch. Key algorithmic details: (1) We compute only the m×m inducing kernel Kmm, the n×m cross-kernel Knm, and the diagonal of the training kernel—never the full n×n matrix. (2) The Woodbury identity converts the n×n system into an m×m system: (Qff+Λ)⁻¹ = Λ⁻¹ − Λ⁻¹Knm(Kmm+KnmᵀΛ⁻¹Knm)⁻¹KnmᵀΛ⁻¹. This is O(nm²) instead of O(n³). (3) The FITC diagonal correction Λ = diag(Knn−Qnn)+σ²nI preserves the exact marginal variances at training points, avoiding the over-confidence of the plain Nyström approximation. The benchmark shows that m=50 inducing points achieve near-exact RMSE on n=5000 points at a fraction of the cost. Memory drops from ~30MB (exact) to ~0.8MB (sparse). For forex tick data (n=100K+), sparse GPs are the only viable option.`,
    },

    // ───────────── QUIZ ─────────────
    {
      type: "quiz" as const,
      questions: [
        {
          id: "q1",
          question: "Which property must a function k(x, x') satisfy to be a valid GP kernel?",
          options: {
            a: "k(x, x') must be symmetric and the Gram matrix K must be positive semi-definite for any finite set of inputs",
            b: "k(x, x') must be bounded between 0 and 1",
            c: "k(x, x') must be a polynomial function of x and x'",
            d: "k(x, x') must integrate to 1 over the input domain"
          },
          correctOptionId: "a",
          explanation: "A valid covariance function must produce positive semi-definite Gram matrices for any finite collection of inputs—this is Mercer's condition. This ensures the resulting multivariate Gaussian is well-defined (covariance matrices must be PSD). Symmetry k(x,x')=k(x',x) is also required. There is no requirement for boundedness to [0,1], polynomial form, or unit integration. The RBF kernel outputs values in (0, σ²], the polynomial kernel is unbounded, and the linear kernel k(x,x')=xᵀx' can be negative—all are valid as long as PSD holds.",
        },
        {
          id: "q2",
          question: "Given an RBF kernel with σ²=2.0 and ℓ=1.0, what is k(x₁=0, x₂=1)?",
          options: {
            a: "2.0 · exp(−0.5) ≈ 1.2131",
            b: "exp(−0.5) ≈ 0.6065",
            c: "2.0 · exp(−1.0) ≈ 0.7358",
            d: "exp(−1.0) ≈ 0.3679"
          },
          correctOptionId: "a",
          explanation: "k(0, 1) = σ² · exp(−||0−1||² / (2ℓ²)) = 2.0 · exp(−1/(2·1)) = 2.0 · exp(−0.5) ≈ 2.0 × 0.6065 = 1.2131. Note that σ² scales the overall output. Option (b) forgets the σ² factor. Option (c) uses exp(−r²/ℓ²) instead of exp(−r²/(2ℓ²))—a common mistake. Option (d) also forgets σ² and uses the wrong denominator.",
        },
        {
          id: "q3",
          question: "In the GP posterior predictive, the term K(X*,X)[K(X,X)+σ²I]⁻¹K(X,X*) subtracted from the prior covariance represents:",
          options: {
            a: "The noise variance added to the predictions",
            b: "The reduction in uncertainty due to observing the training data",
            c: "The marginal likelihood of the observations",
            d: "The prior mean adjusted for the test points"
          },
          correctOptionId: "b",
          explanation: "The posterior covariance is Σ* = K(X*,X*) − K(X*,X)Ky⁻¹K(X,X*). The subtracted term represents how much information the observations provide about the test function values—this is the variance reduction. Near training points, this term is large (nearly cancelling the prior variance), so uncertainty is small. Far from training data, this term approaches zero, and the posterior variance reverts to the prior variance K(X*,X*). This is the GP's elegant uncertainty quantification: predictions are confident near data and uncertain in unexplored regions.",
        },
        {
          id: "q4",
          question: "The three terms of the log marginal likelihood are: −½yᵀK⁻¹y, −½log|K|, and −(n/2)log(2π). The −½log|K| term:",
          options: {
            a: "Measures how well the model fits the observed data",
            b: "Is a constant that does not affect optimisation",
            c: "Penalises model complexity by measuring the volume of function space the model considers plausible",
            d: "Ensures the posterior predictive variance is positive"
          },
          correctOptionId: "c",
          explanation: "The log-determinant term −½log|K| is the complexity penalty (automatic Occam's razor). |K| measures the volume of the prior function space: a flexible model (short ℓ) considers a large volume of wiggly functions, making |K| large and this term more negative. A rigid model (long ℓ) concentrates probability on smooth functions, giving smaller |K|. The data fit is −½yᵀK⁻¹y (term 1), the constant is −(n/2)log(2π) (term 3). The interplay between terms 1 and 2 automatically balances fit and complexity without cross-validation.",
        },
        {
          id: "q5",
          question: "Why is the Matérn-3/2 kernel often preferred over the RBF kernel for financial time-series modelling?",
          options: {
            a: "It is computationally cheaper than RBF",
            b: "It produces sample paths that are once-differentiable but not infinitely smooth, better matching the roughness of financial data",
            c: "It guarantees positive predictions, which is needed for volatility",
            d: "It has fewer hyperparameters to tune"
          },
          correctOptionId: "b",
          explanation: "The RBF kernel is infinitely differentiable, producing unrealistically smooth sample paths. Financial time series (returns, volatility) exhibit rough, jagged behaviour that is better modelled by the Matérn kernel with ν=3/2 (once differentiable) or ν=1/2 (continuous but not differentiable, i.e., Ornstein-Uhlenbeck). The Matérn-3/2 has the closed form k(r) = σ²(1+√3r/ℓ)exp(−√3r/ℓ), which is actually comparably cheap to evaluate. Both RBF and Matérn-3/2 have two hyperparameters (σ², ℓ), so the advantage is not in parameter count but in the smoothness prior.",
        },
        {
          id: "q6",
          question: "What happens to GP predictions as the lengthscale ℓ → 0 in an RBF kernel?",
          options: {
            a: "The posterior mean converges to a constant function equal to the mean of y",
            b: "The predictions become identical to the training targets at observed points and revert to the prior mean (zero) everywhere else, with near-zero uncertainty only at training inputs",
            c: "The GP becomes equivalent to linear regression",
            d: "The kernel matrix becomes the identity and the model reduces to independent Gaussian noise"
          },
          correctOptionId: "b",
          explanation: "As ℓ → 0, the RBF kernel k(x,x') = σ²exp(−||x−x'||²/(2ℓ²)) approaches σ²·δ(x−x'): it equals σ² when x=x' and 0 otherwise. The kernel matrix K → σ²I. The GP posterior mean at a training point xᵢ approaches yᵢ/(1+σ²_n/σ²) ≈ yᵢ (interpolation), while at any x ≠ xᵢ the cross-kernel k(x,xᵢ) → 0, so the mean reverts to zero and uncertainty reverts to the prior σ². This is extreme overfitting: the model memorises training points with zero extrapolation power. The marginal likelihood's complexity penalty correctly penalises this by assigning a very large log|K| ≈ n·log(σ²).",
        },
      ],
    },

    // ───────────── PRACTICE 1 ─────────────
    {
      type: "practice" as const,
      title: "GP Volatility Surface Modeling",
      description: `Build a 2D Gaussian Process model for an implied volatility surface across strike (moneyness) and time-to-expiry dimensions. Tasks: (1) Generate or load a grid of implied volatilities for EUR/USD options at 5 strikes (0.90, 0.95, 1.00, 1.05, 1.10 moneyness) and 4 tenors (1W, 1M, 3M, 6M). (2) Fit a GP with an anisotropic RBF kernel (separate lengthscales for strike and tenor dimensions) plus a WhiteKernel for observation noise. (3) Predict the IV surface on a dense 50×50 grid spanning the strike-tenor space. (4) Plot the surface as a 3D mesh with 95% uncertainty bands. (5) Identify regions where the GP uncertainty exceeds 2 vol points—these are poorly constrained areas where additional market quotes would be most valuable. (6) Compare the GP surface to a simple bilinear interpolation and report the RMSE of each at held-out test points. Success criteria: the GP should produce a smooth, arbitrage-free-looking surface with well-calibrated uncertainty bands (95% intervals covering ~95% of test points).`,
      catalogModelId: "gaussian-process",
    },

    // ───────────── PRACTICE 2 ─────────────
    {
      type: "practice" as const,
      title: "Multi-Output GP for Correlated Currency Pairs",
      description: `Implement a multi-output Gaussian Process (also called a co-kriging model) to jointly model volatility for three correlated currency pairs: EUR/USD, GBP/USD, and EUR/GBP. Tasks: (1) Simulate or load 200 observations of realised volatility for each pair, with realistic cross-correlations (EUR/GBP ≈ function of EUR/USD and GBP/USD). (2) Implement a multi-output GP using the Intrinsic Coregionalisation Model (ICM): K_multi = K_time ⊗ B, where K_time is a shared temporal kernel (Matérn-5/2) and B is a 3×3 positive semi-definite coregionalisation matrix capturing cross-asset correlations. (3) Train by maximising the joint marginal likelihood over temporal kernel hyperparameters and the entries of B. (4) Demonstrate that observing EUR/USD and GBP/USD data improves predictions of EUR/GBP even at times where EUR/GBP data is missing (transfer learning). (5) Plot all three volatility predictions with uncertainty bands and report the learned correlation matrix B. Success criteria: the multi-output GP should achieve lower RMSE on EUR/GBP predictions than an independent single-output GP, demonstrating the value of cross-asset information sharing.`,
      catalogModelId: "gaussian-process",
    },
  ],
}
