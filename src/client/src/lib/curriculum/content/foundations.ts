import type { LearningPath } from "../types";

export const foundationsPath: LearningPath = {
  id: "foundations",
  title: "Foundations",
  description:
    "Build the mathematical and statistical foundations essential for understanding machine learning in financial markets. Covers descriptive statistics, probability distributions, linear algebra, and optimization — all through the lens of forex trading data.",
  icon: "Sigma",
  color: "blue",
  difficulty: "beginner",
  estimatedHours: 15,
  modules: [
    {
      id: "stats-prob",
      title: "Statistics & Probability",
      description:
        "Master the statistical tools used to describe, model, and reason about market return distributions.",
      lessons: [
        {
          id: "found-descriptive-stats",
          title: "Descriptive Statistics for Markets",
          description:
            "Learn how to summarize forex return distributions using mean, median, standard deviation, skewness, and kurtosis — the building blocks of quantitative analysis.",
          estimatedMinutes: 45,
          difficulty: "beginner",
          sections: [
            {
              type: "objective",
              content:
                "By the end of this lesson you will be able to compute and interpret the five key descriptive statistics — mean (μ), median, standard deviation (σ), skewness, and kurtosis — on real forex return data, and explain why each matters for trading strategy design.",
              keyTakeaways: [
                "The mean (μ) of returns tells you the expected drift, but is unreliable alone due to outliers",
                "Standard deviation (σ) quantifies volatility — the core risk measure in finance",
                "Skewness reveals asymmetry: negative skew means larger left-tail losses",
                "Excess kurtosis > 0 signals fat tails — more extreme moves than a normal distribution predicts",
              ],
            },
            {
              type: "theory",
              title: "Moments of a Return Distribution",
              content:
                "Financial returns r₁, r₂, …, rₙ are typically computed as log-returns: rₜ = ln(Pₜ / Pₜ₋₁). The **first moment** (mean μ) captures average drift: μ = (1/n) ∑ rₜ. The **second central moment** gives variance σ² = (1/n) ∑ (rₜ − μ)², and its square root σ is the standard deviation — the most common volatility proxy.\n\nHigher moments matter because real market returns are *not* Gaussian. The **third standardized moment** (skewness) measures asymmetry: S = (1/n) ∑ [(rₜ − μ)/σ]³. Negative skewness (S < 0) is common in equities and some FX pairs, indicating larger downside moves. The **fourth standardized moment** (kurtosis) captures tail heaviness: K = (1/n) ∑ [(rₜ − μ)/σ]⁴. A normal distribution has K = 3; excess kurtosis κ = K − 3 > 0 signals leptokurtic (fat-tailed) behaviour, which is the norm in forex markets.",
            },
            {
              type: "intuition",
              title: "The Weather Forecast Analogy",
              analogy:
                "Descriptive statistics are like a weather summary for a city.",
              content:
                "The **mean** is the average temperature — useful but doesn't tell you about heat waves or cold snaps. **Standard deviation** is the temperature range — a desert has high σ (hot days, cold nights) while the tropics have low σ. **Skewness** is like a city where rare storms are always *worse* than rare sunny spells — the bad surprises outweigh the good. **Kurtosis** tells you how often *extreme* weather occurs. High kurtosis → more 'once-in-a-century' events than you'd expect. Forex returns behave the same way: μ and σ alone miss the fat tails that blow up accounts.",
              emoji: "🌦️",
            },
            {
              type: "code",
              title: "Computing Return Statistics with NumPy",
              language: "python",
              code: `import numpy as np
import pandas as pd
from scipy import stats

# Load 1-hour EUR/USD closes and compute log-returns
prices = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
prices["log_return"] = np.log(prices["close"] / prices["close"].shift(1))
returns = prices["log_return"].dropna().values

# Core descriptive statistics
mu = np.mean(returns)                      # μ  — mean drift
sigma = np.std(returns, ddof=1)            # σ  — sample std dev
skew = stats.skew(returns)                 # S  — skewness
kurt = stats.kurtosis(returns)             # κ  — excess kurtosis
median = np.median(returns)

print(f"Mean (μ):           {mu:.6f}")
print(f"Median:             {median:.6f}")
print(f"Std Dev (σ):        {sigma:.6f}")
print(f"Skewness:           {skew:.4f}")
print(f"Excess Kurtosis:    {kurt:.4f}")
print(f"Annualized Vol:     {sigma * np.sqrt(252 * 24):.2%}")`,
              explanation:
                "We compute log-returns from close prices, then derive all five descriptive statistics. The annualized volatility scales σ by √(trading hours per year) ≈ √6048. Negative skewness and positive excess kurtosis are typical for EUR/USD — meaning the distribution has heavier tails and more downside risk than a Gaussian model assumes.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "found-ds-q1",
                  question:
                    "A forex return series has excess kurtosis κ = 4.2. What does this imply?",
                  options: [
                    { id: "found-ds-q1-a", text: "Returns are perfectly normally distributed" },
                    { id: "found-ds-q1-b", text: "Returns have lighter tails than a normal distribution" },
                    { id: "found-ds-q1-c", text: "Extreme moves occur more often than a normal distribution predicts" },
                    { id: "found-ds-q1-d", text: "The mean return is significantly positive" },
                  ],
                  correctOptionId: "found-ds-q1-c",
                  explanation:
                    "Excess kurtosis κ > 0 means the distribution is leptokurtic — it has fatter tails than a Gaussian, so extreme gains and losses happen more frequently than the bell curve suggests.",
                },
                {
                  id: "found-ds-q2",
                  question:
                    "Why do we typically use log-returns rₜ = ln(Pₜ / Pₜ₋₁) instead of simple returns?",
                  options: [
                    { id: "found-ds-q2-a", text: "Log-returns are always positive" },
                    { id: "found-ds-q2-b", text: "Log-returns are additive over time and approximately normally distributed" },
                    { id: "found-ds-q2-c", text: "Log-returns eliminate the need for standard deviation" },
                    { id: "found-ds-q2-d", text: "Log-returns make kurtosis equal to zero" },
                  ],
                  correctOptionId: "found-ds-q2-b",
                  explanation:
                    "Log-returns have the desirable property of time-additivity: the multi-period log-return is simply the sum of single-period log-returns. They also tend to be closer to symmetric and normally distributed than simple percentage returns.",
                },
              ],
            },
            {
              type: "practice",
              title: "Explore Return Distributions on the Dashboard",
              description:
                "Open the Model Catalog and select a trained model. Examine the return distribution chart and verify that the displayed μ, σ, skewness, and kurtosis match what you'd compute manually from the underlying data. Try comparing statistics across different currency pairs and timeframes.",
            },
          ],
        },
        {
          id: "found-probability",
          title: "Probability Distributions in Finance",
          description:
            "Understand the normal, log-normal, and Student-t distributions, learn why financial returns exhibit fat tails, and fit parametric distributions to real forex data.",
          estimatedMinutes: 50,
          difficulty: "beginner",
          sections: [
            {
              type: "objective",
              content:
                "After this lesson you will be able to compare the Normal, Log-Normal, and Student-t distributions, explain why forex returns deviate from Gaussian assumptions, and fit a Student-t distribution to empirical return data using maximum likelihood estimation.",
              keyTakeaways: [
                "The Normal distribution N(μ, σ²) is the baseline model but underestimates tail risk in markets",
                "Log-normal distributions model *prices* (always positive) while returns are modelled directly",
                "The Student-t distribution with low degrees of freedom ν captures fat tails observed in forex",
                "QQ-plots visually diagnose departures from normality — look for S-shaped deviations in the tails",
              ],
            },
            {
              type: "theory",
              title: "From Gaussian to Fat-Tailed Models",
              content:
                "The **Normal distribution** N(μ, σ²) has PDF f(x) = (1 / σ√(2π)) · exp[−(x − μ)² / (2σ²)]. It decays exponentially in the tails, assigning negligible probability to events beyond ±4σ. However, empirical forex returns exhibit **fat tails** — events at ±4σ occur 10–100× more often than the Gaussian predicts.\n\nThe **Student-t distribution** with ν degrees of freedom has heavier tails: f(x) ∝ (1 + x²/ν)^(−(ν+1)/2). As ν → ∞ it converges to the Normal; for ν ∈ [3, 8], it captures the leptokurtic behaviour of most forex pairs. Its excess kurtosis is 6/(ν − 4) for ν > 4.\n\nThe **Log-normal distribution** models price levels Pₜ rather than returns — if log-returns are Normal then prices are Log-normal: Pₜ = P₀ · exp(∑ rₜ). This ensures prices remain strictly positive.",
            },
            {
              type: "intuition",
              title: "The Dartboard Analogy",
              analogy:
                "Throwing darts at a board is like sampling from a distribution.",
              content:
                "Imagine you throw darts at a bullseye. A **Normal distribution** says most darts land near the center and virtually none hit the wall — the probability dies off fast. But real markets are like a dartboard where occasionally the dart flies wildly off-target. The **Student-t distribution** accounts for these wild throws: the 'wall hits' (tail events) are rare but not impossibly so. Using a Normal model is like pretending the wall never gets hit — until a flash crash proves otherwise.",
              emoji: "🎯",
            },
            {
              type: "code",
              title: "Fitting a Student-t Distribution to Forex Returns",
              language: "python",
              code: `import numpy as np
import pandas as pd
from scipy import stats
import matplotlib.pyplot as plt

# Load returns
prices = pd.read_csv("gbpusd_1h.csv", parse_dates=["timestamp"])
returns = np.log(prices["close"] / prices["close"].shift(1)).dropna().values

# Fit Normal and Student-t via MLE
mu_n, sigma_n = stats.norm.fit(returns)
df_t, mu_t, sigma_t = stats.t.fit(returns)

print(f"Normal fit:    μ = {mu_n:.6f}, σ = {sigma_n:.6f}")
print(f"Student-t fit: ν = {df_t:.2f}, μ = {mu_t:.6f}, σ = {sigma_t:.6f}")

# QQ-plot against Normal
fig, axes = plt.subplots(1, 2, figsize=(12, 5))
stats.probplot(returns, dist="norm", plot=axes[0])
axes[0].set_title("QQ-Plot vs Normal")
stats.probplot(returns, dist="t", sparams=(df_t,), plot=axes[1])
axes[1].set_title(f"QQ-Plot vs Student-t (ν={df_t:.1f})")
plt.tight_layout()
plt.savefig("qq_comparison.png", dpi=150)
print("Saved qq_comparison.png")`,
              explanation:
                "We fit both Normal and Student-t distributions to GBP/USD hourly log-returns using scipy's MLE fitter. The estimated degrees of freedom ν is typically 3–7 for forex, far from the ν → ∞ Gaussian limit. The QQ-plots make the fat tails visible: the Normal QQ-plot shows S-shaped deviations in the tails, while the Student-t QQ-plot tracks the empirical quantiles much more closely.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "found-prob-q1",
                  question:
                    "For a Student-t distribution with ν = 5 degrees of freedom, what is the excess kurtosis?",
                  options: [
                    { id: "found-prob-q1-a", text: "0 (same as Normal)" },
                    { id: "found-prob-q1-b", text: "6 / (5 − 4) = 6" },
                    { id: "found-prob-q1-c", text: "5 / 6 ≈ 0.83" },
                    { id: "found-prob-q1-d", text: "Undefined for ν = 5" },
                  ],
                  correctOptionId: "found-prob-q1-b",
                  explanation:
                    "The excess kurtosis of a Student-t distribution is 6 / (ν − 4) for ν > 4. With ν = 5: κ = 6 / (5 − 4) = 6, meaning much heavier tails than a Normal (κ = 0).",
                },
                {
                  id: "found-prob-q2",
                  question:
                    "On a QQ-plot comparing empirical returns to a Normal distribution, what pattern indicates fat tails?",
                  options: [
                    { id: "found-prob-q2-a", text: "Points lie exactly on the diagonal line" },
                    { id: "found-prob-q2-b", text: "Points curve away from the line at both extremes (S-shape)" },
                    { id: "found-prob-q2-c", text: "Points form a horizontal line" },
                    { id: "found-prob-q2-d", text: "Points cluster only in the center" },
                  ],
                  correctOptionId: "found-prob-q2-b",
                  explanation:
                    "Fat tails cause the empirical quantiles to be more extreme than Normal quantiles, creating an S-shaped departure from the 45° reference line — curving above on the right and below on the left.",
                },
                {
                  id: "found-prob-q3",
                  question:
                    "Why are prices modelled as log-normal rather than normal?",
                  options: [
                    { id: "found-prob-q3-a", text: "Normal prices can go negative, but real prices cannot" },
                    { id: "found-prob-q3-b", text: "Log-normal distributions have zero kurtosis" },
                    { id: "found-prob-q3-c", text: "Log-normal distributions are easier to compute" },
                    { id: "found-prob-q3-d", text: "Prices are always integers" },
                  ],
                  correctOptionId: "found-prob-q3-a",
                  explanation:
                    "A normal distribution assigns nonzero probability to negative values, which is impossible for asset prices. If log-returns are normal, then prices P = P₀ · exp(∑ r) are log-normally distributed and strictly positive.",
                },
              ],
            },
            {
              type: "practice",
              title: "Compare Distribution Fits Across Pairs",
              description:
                "Using the dashboard, load return data for EUR/USD, GBP/USD, and USD/JPY. Fit both Normal and Student-t distributions to each and compare the estimated ν. Which pair has the fattest tails? Consider how this affects risk management for each pair.",
            },
          ],
        },
      ],
    },
    {
      id: "linalg-opt",
      title: "Linear Algebra & Optimization",
      description:
        "Learn the linear algebra and optimization concepts that power every ML algorithm — from PCA for feature reduction to gradient descent for model training.",
      lessons: [
        {
          id: "found-linear-algebra",
          title: "Linear Algebra for ML",
          description:
            "Understand vectors, matrices, eigenvalues, and PCA — the geometric language of machine learning — applied to reducing high-dimensional indicator feature sets.",
          estimatedMinutes: 55,
          difficulty: "beginner",
          sections: [
            {
              type: "objective",
              content:
                "After completing this lesson you will understand how matrices represent feature datasets, what eigenvalues and eigenvectors reveal about data structure, and how to apply Principal Component Analysis (PCA) to reduce a high-dimensional set of technical indicators to its most informative components.",
              keyTakeaways: [
                "A dataset of n samples with p features is an n × p matrix X ∈ ℝⁿˣᵖ",
                "The covariance matrix Σ = (1/n) Xᵀ X captures linear relationships between features",
                "Eigenvectors of Σ point in the directions of maximum variance; eigenvalues λᵢ quantify how much variance each direction explains",
                "PCA projects data onto the top-k eigenvectors, reducing dimensionality while preserving most information",
              ],
            },
            {
              type: "theory",
              title: "Matrices, Eigenvalues & PCA",
              content:
                "In ML, every dataset is a matrix X ∈ ℝⁿˣᵖ where rows are samples (trading bars) and columns are features (indicators). The **covariance matrix** Σ = (1/n) XᵀX (after centering) is a p × p symmetric positive semi-definite matrix.\n\nThe **eigen-decomposition** Σ = VΛVᵀ yields eigenvectors V (orthogonal directions) and eigenvalues Λ = diag(λ₁, …, λₚ) with λ₁ ≥ λ₂ ≥ … ≥ λₚ ≥ 0. Each λᵢ tells us the variance captured by direction vᵢ.\n\n**PCA** selects the top k eigenvectors (principal components) and projects: Z = XV_k ∈ ℝⁿˣᵏ. The fraction of variance retained is ∑ᵢ₌₁ᵏ λᵢ / ∑ᵢ₌₁ᵖ λᵢ. In forex, many technical indicators (RSI, MACD, Bollinger bands, ATR) are correlated, so PCA can often reduce 20+ features to 5–8 components retaining > 95% variance.",
            },
            {
              type: "intuition",
              title: "The Shadow Analogy",
              analogy:
                "PCA is like finding the best angle to cast a shadow of a 3D object onto a wall.",
              content:
                "Imagine a complex 3D sculpture (your high-dimensional data). You shine a flashlight at it and observe the 2D shadow on the wall. Most angles produce a blob, but there's one angle where the shadow preserves the sculpture's shape best — that's your first principal component. Rotating the light 90° gives the second-best shadow. PCA finds these optimal 'flashlight angles' automatically. In trading, 20 correlated indicators cast a confusing high-dimensional shadow; PCA finds the 5 angles that capture 95% of the shape.",
              emoji: "🔦",
            },
            {
              type: "code",
              title: "PCA on Technical Indicator Features",
              language: "python",
              code: `import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

# Build feature matrix from technical indicators
df = pd.read_csv("eurusd_features.csv")
feature_cols = ["rsi_14", "macd", "macd_signal", "bb_upper", "bb_lower",
                "atr_14", "adx_14", "cci_20", "stoch_k", "stoch_d",
                "willr_14", "mfi_14", "obv", "roc_10", "mom_10"]
X = df[feature_cols].dropna().values

# Standardize (zero mean, unit variance) — essential before PCA
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# Fit PCA and inspect explained variance
pca = PCA()
X_pca = pca.fit_transform(X_scaled)

cumulative_var = np.cumsum(pca.explained_variance_ratio_)
n_components_95 = np.argmax(cumulative_var >= 0.95) + 1

print("Explained variance per component:")
for i, (var, cum) in enumerate(zip(pca.explained_variance_ratio_, cumulative_var)):
    marker = " ←" if i + 1 == n_components_95 else ""
    print(f"  PC{i+1}: {var:.4f}  (cumulative: {cum:.4f}){marker}")
print(f"\\nComponents for ≥ 95% variance: {n_components_95} of {len(feature_cols)}")`,
              explanation:
                "We standardize 15 technical indicators to zero mean and unit variance (critical because PCA is scale-sensitive), then fit PCA. The explained variance ratio shows how much information each principal component captures. Typically 5–8 components retain ≥ 95% of the total variance, dramatically reducing input dimensionality for downstream ML models.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "found-la-q1",
                  question:
                    "Why must you standardize features before applying PCA?",
                  options: [
                    { id: "found-la-q1-a", text: "PCA only works on integers" },
                    { id: "found-la-q1-b", text: "Features on larger scales dominate the variance and bias the principal components" },
                    { id: "found-la-q1-c", text: "Standardization makes all eigenvalues equal" },
                    { id: "found-la-q1-d", text: "It converts the matrix to a square matrix" },
                  ],
                  correctOptionId: "found-la-q1-b",
                  explanation:
                    "PCA maximizes variance. If one feature has a range of [0, 1000] while another is [0, 1], the large-scale feature will dominate the first principal component regardless of its actual informational value. Standardizing puts all features on equal footing.",
                },
                {
                  id: "found-la-q2",
                  question:
                    "If the first 3 eigenvalues of a 10-feature covariance matrix are λ₁=5.2, λ₂=2.1, λ₃=1.5 and the total is ∑λᵢ=10, what fraction of variance do these 3 components explain?",
                  options: [
                    { id: "found-la-q2-a", text: "52%" },
                    { id: "found-la-q2-b", text: "88%" },
                    { id: "found-la-q2-c", text: "73%" },
                    { id: "found-la-q2-d", text: "30%" },
                  ],
                  correctOptionId: "found-la-q2-b",
                  explanation:
                    "The fraction is (5.2 + 2.1 + 1.5) / 10 = 8.8 / 10 = 88%. Three components out of ten capture 88% of the total variance, a strong reduction.",
                },
              ],
            },
            {
              type: "practice",
              title: "Visualize PCA in the Dashboard",
              description:
                "Navigate to a model's feature importance panel and enable PCA visualization. Observe how many principal components your model's indicator set requires to retain 95% variance. Try adding or removing indicators and see how the explained variance curve changes.",
              catalogModelId: "pca-feature-analysis",
            },
          ],
        },
        {
          id: "found-optimization",
          title: "Optimization Methods",
          description:
            "Understand gradient descent, convex optimization, and loss landscapes — the engine that trains every ML model from linear regression to deep neural networks.",
          estimatedMinutes: 50,
          difficulty: "beginner",
          sections: [
            {
              type: "objective",
              content:
                "You will understand how gradient descent minimizes a loss function L(θ) by iteratively updating parameters θ ← θ − α∇L(θ), distinguish convex from non-convex landscapes, and implement gradient descent from scratch to optimize a simple quadratic loss.",
              keyTakeaways: [
                "Gradient descent updates parameters in the direction of steepest descent: θ ← θ − α · ∇L(θ)",
                "The learning rate α controls step size — too large causes divergence, too small causes slow convergence",
                "Convex loss functions have a single global minimum; non-convex functions have local minima and saddle points",
                "Stochastic Gradient Descent (SGD) uses mini-batches to approximate the full gradient, enabling scalability",
              ],
            },
            {
              type: "theory",
              title: "Gradient Descent & Convexity",
              content:
                "Given a differentiable loss function L(θ) where θ ∈ ℝᵈ, **gradient descent** iterates: θₜ₊₁ = θₜ − α · ∇L(θₜ). The gradient ∇L = (∂L/∂θ₁, …, ∂L/∂θ_d) points in the direction of steepest *ascent*, so we negate it to descend.\n\nA function is **convex** if for all θ₁, θ₂ and λ ∈ [0,1]: L(λθ₁ + (1−λ)θ₂) ≤ λL(θ₁) + (1−λ)L(θ₂). Convex losses (e.g., MSE for linear regression) guarantee that gradient descent converges to the global minimum. Non-convex losses (e.g., neural network objectives) may have local minima and saddle points — here, SGD's noise helps escape saddle points.\n\n**Stochastic GD** approximates ∇L using a random mini-batch B ⊂ {1,…,n}: ∇L ≈ (1/|B|) ∑ᵢ∈B ∇ℓᵢ(θ). This reduces per-step cost from O(n) to O(|B|) and introduces beneficial noise.",
            },
            {
              type: "intuition",
              title: "The Mountain Hiker Analogy",
              analogy:
                "Gradient descent is like a blindfolded hiker descending a mountain.",
              content:
                "Imagine you're blindfolded on a mountainside and want to reach the valley floor. You can feel the slope beneath your feet. **Gradient descent** says: always step downhill in the steepest direction. The **learning rate** is your step size — too big and you overshoot the valley and end up on the opposite ridge; too small and you'll still be hiking at midnight. A **convex** mountain has one valley — you're guaranteed to reach it. A **non-convex** mountain has multiple valleys and ridges — you might get stuck in a shallow dip (local minimum). SGD is like having the wind randomly nudge you, helping you stumble out of shallow dips toward deeper valleys.",
              emoji: "🏔️",
            },
            {
              type: "code",
              title: "Gradient Descent from Scratch",
              language: "python",
              code: `import numpy as np

# Define a quadratic loss: L(θ) = (θ₁ - 3)² + 2(θ₂ + 1)²
# Global minimum at θ* = [3, -1], L(θ*) = 0
def loss(theta: np.ndarray) -> float:
    return (theta[0] - 3) ** 2 + 2 * (theta[1] + 1) ** 2

def gradient(theta: np.ndarray) -> np.ndarray:
    dL_dtheta1 = 2 * (theta[0] - 3)     # ∂L/∂θ₁
    dL_dtheta2 = 4 * (theta[1] + 1)     # ∂L/∂θ₂
    return np.array([dL_dtheta1, dL_dtheta2])

# Gradient descent
theta = np.array([0.0, 0.0])   # initial guess
alpha = 0.1                     # learning rate
n_steps = 50

print(f"{'Step':>4}  {'θ₁':>8}  {'θ₂':>8}  {'L(θ)':>10}")
print("-" * 36)
for step in range(n_steps):
    L = loss(theta)
    if step % 10 == 0 or step == n_steps - 1:
        print(f"{step:4d}  {theta[0]:8.4f}  {theta[1]:8.4f}  {L:10.6f}")
    grad = gradient(theta)
    theta = theta - alpha * grad        # θ ← θ − α∇L(θ)

print(f"\\nFinal θ = [{theta[0]:.4f}, {theta[1]:.4f}]")
print(f"Optimal θ* = [3.0000, -1.0000]")`,
              explanation:
                "We minimize a 2D convex quadratic loss by hand-coding the gradient and update rule. With learning rate α = 0.1, the parameters converge smoothly to the analytical minimum θ* = [3, −1]. This is exactly what sklearn, PyTorch, and XGBoost do internally — just with more complex loss functions and automatic gradient computation.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "found-opt-q1",
                  question:
                    "What happens if the learning rate α is set too high in gradient descent?",
                  options: [
                    { id: "found-opt-q1-a", text: "The algorithm converges faster to the global minimum" },
                    { id: "found-opt-q1-b", text: "The loss oscillates or diverges instead of converging" },
                    { id: "found-opt-q1-c", text: "The gradient becomes zero" },
                    { id: "found-opt-q1-d", text: "The algorithm automatically switches to SGD" },
                  ],
                  correctOptionId: "found-opt-q1-b",
                  explanation:
                    "A learning rate that is too large causes the parameter updates to overshoot the minimum, leading to oscillation around the optimum or even divergence where the loss increases without bound.",
                },
                {
                  id: "found-opt-q2",
                  question:
                    "What advantage does Stochastic Gradient Descent (SGD) have over full-batch gradient descent?",
                  options: [
                    { id: "found-opt-q2-a", text: "SGD always finds the global minimum" },
                    { id: "found-opt-q2-b", text: "SGD computes the exact gradient" },
                    { id: "found-opt-q2-c", text: "SGD has lower per-step cost and its noise can help escape local minima" },
                    { id: "found-opt-q2-d", text: "SGD does not require a learning rate" },
                  ],
                  correctOptionId: "found-opt-q2-c",
                  explanation:
                    "SGD approximates the gradient using a small random subset (mini-batch), making each update O(|B|) instead of O(n). The stochastic noise also acts as implicit regularization and can help escape shallow local minima in non-convex landscapes.",
                },
              ],
            },
            {
              type: "practice",
              title: "Experiment with Learning Rates",
              description:
                "Modify the gradient descent code above to try learning rates α ∈ {0.01, 0.1, 0.5, 1.0}. For each, record how many steps it takes to reach L(θ) < 0.001 (or if it diverges). Plot the loss curves on the same chart to visualize the convergence-divergence tradeoff.",
            },
          ],
        },
      ],
    },
  ],
};
