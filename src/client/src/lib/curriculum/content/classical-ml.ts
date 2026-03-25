import type { LearningPath } from "../types";

export const classicalMlPath: LearningPath = {
  id: "classical-ml",
  title: "Classical Machine Learning",
  description:
    "Master the supervised learning algorithms that power production trading systems — from linear models and decision trees to gradient-boosted ensembles — with a focus on proper time-series validation and forex-specific pitfalls.",
  icon: "Brain",
  color: "emerald",
  difficulty: "intermediate",
  estimatedHours: 24,
  modules: [
    {
      id: "supervised",
      title: "Supervised Learning",
      description:
        "Learn the foundational supervised algorithms — linear regression, logistic regression, decision trees, and random forests — applied to forex direction prediction and regime detection.",
      lessons: [
        {
            id: "cml-linear-models",
            title: "Linear & Logistic Regression",
            description: "Master the mathematical foundations of linear and logistic regression, from deriving the OLS normal equation and cross-entropy loss to implementing regularization techniques (L1, L2, Elastic Net) and gradient descent from scratch, with applied examples on forex directional prediction.",
            estimatedMinutes: 75,
            difficulty: "intermediate",
            prerequisites: ["found-descriptive-stats", "found-optimization"],
            sections: [
                // ── OBJECTIVE ──────────────────────────────────────────────
                {
                    type: "objective",
                    content: "By the end of this lesson you will be able to derive the OLS normal equation and apply it to compute regression coefficients by hand, derive the sigmoid function from log-odds and construct the cross-entropy loss from maximum likelihood principles, implement L1 (Lasso) and L2 (Ridge) regularization and explain their geometric interpretations, code both the normal equation and logistic regression gradient descent from scratch in NumPy, and apply logistic regression with regularization to a forex directional-prediction pipeline with proper time-series validation.",
                    keyTakeaways: [
                        "Derive the closed-form OLS solution θ* = (XᵀX)⁻¹Xᵀy from the squared-error loss gradient",
                        "Understand when XᵀX is singular (multicollinearity) and diagnose it with VIF",
                        "Derive the sigmoid function from odds and construct cross-entropy loss via maximum likelihood",
                        "Implement Ridge and Lasso regularization and explain why L1 induces sparsity geometrically",
                        "Code gradient descent for logistic regression and observe convergence behavior",
                        "Build a complete forex direction-prediction pipeline with time-ordered splits and L1 feature selection",
                        "Compute and interpret precision, recall, and the confusion matrix for binary classifiers",
                        "Select regularization strength (λ or C) by balancing bias, variance, and feature sparsity"
                    ],
                },

                // ── THEORY 1: OLS Normal Equation ──────────────────────────
                {
                    type: "theory",
                    title: "OLS Normal Equation — Full Derivation",
                    content: "The Ordinary Least Squares (OLS) objective is to find the parameter vector θ that minimises the sum of squared residuals. We write the loss as a matrix expression:\n\nL(θ) = ‖y − Xθ‖² = (y − Xθ)ᵀ(y − Xθ)\n\nExpanding: L(θ) = yᵀy − yᵀXθ − θᵀXᵀy + θᵀXᵀXθ. Because yᵀXθ is a scalar and equals its own transpose θᵀXᵀy, this simplifies to L(θ) = yᵀy − 2θᵀXᵀy + θᵀXᵀXθ.\n\nTaking the gradient with respect to θ and using the identities ∇_θ(θᵀa) = a and ∇_θ(θᵀAθ) = 2Aθ (for symmetric A):\n\n∇_θ L = −2Xᵀy + 2XᵀXθ\n\nSetting the gradient to zero: 2XᵀXθ = 2Xᵀy → XᵀXθ = Xᵀy. If XᵀX is invertible, multiply both sides by (XᵀX)⁻¹ to obtain the normal equation solution:\n\nθ* = (XᵀX)⁻¹ Xᵀy\n\nConcrete numerical example — let X (with intercept column) and y be:\n\nX = [[1, 2],      y = [5,\n     [1, 3],            7,\n     [1, 5]]            11]\n\nStep 1 — XᵀX = [[1,1,1],[2,3,5]] · [[1,2],[1,3],[1,5]] = [[3, 10],[10, 38]]\nStep 2 — (XᵀX)⁻¹: det = 3·38 − 10·10 = 114 − 100 = 14, so (XᵀX)⁻¹ = (1/14)·[[38, −10],[−10, 3]] = [[2.714, −0.714],[−0.714, 0.214]]\nStep 3 — Xᵀy = [[1,1,1],[2,3,5]] · [5,7,11] = [23, 86]\nStep 4 — θ* = (XᵀX)⁻¹ · Xᵀy = [[2.714,−0.714],[−0.714,0.214]] · [23,86] = [2.714·23 + (−0.714)·86, (−0.714)·23 + 0.214·86] ≈ [0.999, 2.000]. So the fitted line is y ≈ 1.0 + 2.0·x, which perfectly fits 1+2(2)=5, 1+2(3)=7, 1+2(5)=11.\n\nWhen does this break? XᵀX is singular (non-invertible) when columns of X are linearly dependent — this is multicollinearity. For example, if x₃ = 2·x₁ + x₂, the determinant of XᵀX is zero and no unique solution exists. We diagnose this with the Variance Inflation Factor for each feature j:\n\nVIF_j = 1 / (1 − R²_j)\n\nwhere R²_j is the R² from regressing feature j on all other features. A VIF of 1 means no collinearity; VIF > 5 is concerning; VIF > 10 signals severe multicollinearity. When VIF is high, standard errors inflate, making coefficient estimates unstable. Solutions include dropping redundant features, PCA, or adding regularization (covered in Theory 3).",
                },

                // ── THEORY 2: Logistic Regression & Sigmoid ────────────────
                {
                    type: "theory",
                    title: "Logistic Regression & the Sigmoid Function",
                    content: "Logistic regression models the probability of a binary outcome y ∈ {0, 1}. We start from the concept of odds and log-odds. The odds of an event with probability p are p/(1−p). Taking the natural log gives the log-odds (logit): log(p/(1−p)). Logistic regression assumes the log-odds are a linear function of x:\n\nlog(p/(1−p)) = θᵀx = z\n\nSolving for p: p/(1−p) = eᶻ → p = eᶻ(1−p) → p = eᶻ − peᶻ → p(1 + eᶻ) = eᶻ → p = eᶻ/(1 + eᶻ). Dividing numerator and denominator by eᶻ:\n\nσ(z) = 1 / (1 + e⁻ᶻ)\n\nThis is the sigmoid function. Its derivative has an elegant form: σ'(z) = σ(z)·(1 − σ(z)). Proof: σ'(z) = e⁻ᶻ/(1+e⁻ᶻ)² = [1/(1+e⁻ᶻ)] · [e⁻ᶻ/(1+e⁻ᶻ)] = σ(z) · [(1+e⁻ᶻ−1)/(1+e⁻ᶻ)] = σ(z) · (1−σ(z)). This derivative is maximal at z = 0 where σ(0) = 0.5 and σ'(0) = 0.25, and approaches zero for large |z|.\n\nTo derive the loss function, we use maximum likelihood. For a single sample, P(y|x;θ) = σ(θᵀx)ʸ · (1−σ(θᵀx))¹⁻ʸ. For N independent samples the likelihood is L(θ) = Πᵢ σ(θᵀxᵢ)ʸⁱ · (1−σ(θᵀxᵢ))¹⁻ʸⁱ. Taking the log: ℓ(θ) = Σᵢ [yᵢ log σ(θᵀxᵢ) + (1−yᵢ) log(1−σ(θᵀxᵢ))]. Negating gives the binary cross-entropy loss:\n\nJ(θ) = −(1/N) Σᵢ [yᵢ log σ(θᵀxᵢ) + (1−yᵢ) log(1−σ(θᵀxᵢ))]\n\nThe gradient of J with respect to θⱼ is: ∂J/∂θⱼ = (1/N) Σᵢ (σ(θᵀxᵢ) − yᵢ) · xᵢⱼ. This looks identical in form to the linear regression gradient — the difference is that σ(θᵀx) replaces the raw prediction θᵀx.\n\nNumerical example: Let θ = [0.5, −0.3] and x = [2, 1]. Then z = θᵀx = 0.5·2 + (−0.3)·1 = 1.0 − 0.3 = 0.7. So P(y=1|x) = σ(0.7) = 1/(1 + e⁻⁰·⁷) = 1/(1 + 0.4966) = 1/1.4966 ≈ 0.6682. The model predicts a 66.8% probability of class 1. If the true label is y = 1, the per-sample cross-entropy loss is −[1·log(0.6682) + 0·log(0.3318)] = −log(0.6682) ≈ 0.4035.",
                },

                // ── THEORY 3: Regularization (L1 / L2) ────────────────────
                {
                    type: "theory",
                    title: "Regularization — Ridge (L2), Lasso (L1) & Elastic Net",
                    content: "Regularization adds a penalty term to the loss to prevent overfitting by constraining the magnitude of θ. Ridge regression (L2) adds λ‖θ‖²₂ to the OLS loss:\n\nL_ridge(θ) = ‖y − Xθ‖² + λ‖θ‖²₂ = (y−Xθ)ᵀ(y−Xθ) + λθᵀθ\n\nTaking the gradient: ∇_θ L = −2Xᵀy + 2XᵀXθ + 2λθ = −2Xᵀy + 2(XᵀX + λI)θ. Setting to zero and solving:\n\nθ_ridge = (XᵀX + λI)⁻¹ Xᵀy\n\nThe key insight is that adding λI to XᵀX guarantees invertibility — even if XᵀX is singular, XᵀX + λI has all eigenvalues shifted up by λ, so all eigenvalues are ≥ λ > 0. If XᵀX has eigenvalues {σ₁², σ₂², …, σₚ²}, then XᵀX + λI has eigenvalues {σ₁² + λ, σ₂² + λ, …, σₚ² + λ}. Small eigenvalues (near-collinear directions) get regularized most — the coefficient is shrunk by factor σⱼ²/(σⱼ² + λ).\n\nGeometric interpretation: Ridge regression constrains θ to lie within the L2 ball ‖θ‖₂ ≤ t (a circle/sphere). The OLS solution is the unconstrained minimum; the Ridge solution is where the elliptical contours of the loss first touch the L2 ball. Because the ball is round, all coefficients shrink proportionally — none are exactly zero. Lasso (L1) replaces the penalty with λ‖θ‖₁ and constrains θ to the L1 ball ‖θ‖₁ ≤ t (a diamond/rhombus). Because the diamond has corners on the axes, the loss contours are likely to first touch a corner, setting one or more coefficients to exactly zero — hence L1 produces sparse solutions. Lasso has no closed-form solution and requires iterative methods (coordinate descent).\n\nElastic Net combines both penalties: L_en(θ) = ‖y − Xθ‖² + λ₁‖θ‖₁ + λ₂‖θ‖₂². It inherits L1's sparsity and L2's stability when features are correlated. In sklearn, the mixing parameter α controls the L1/L2 ratio: penalty = α·L1 + (1−α)·L2.\n\nNumerical example continuing from Theory 1 with λ = 1: XᵀX + λI = [[3,10],[10,38]] + [[1,0],[0,1]] = [[4,10],[10,39]]. det = 4·39 − 10·10 = 156 − 100 = 56. (XᵀX + λI)⁻¹ = (1/56)·[[39,−10],[−10,4]] = [[0.696,−0.179],[−0.179,0.071]]. θ_ridge = [[0.696,−0.179],[−0.179,0.071]] · [23,86] = [0.696·23 + (−0.179)·86, (−0.179)·23 + 0.071·86] = [16.008 − 15.394, −4.117 + 6.106] = [0.614, 1.989]. Compared to OLS θ* ≈ [1.0, 2.0], the intercept shrunk from 1.0 to 0.614 while the slope barely changed (2.0 → 1.989). The intercept shrunk more because Ridge penalises all coefficients toward zero — here the intercept is small and gets pulled harder relative to its magnitude.",
                },

                // ── THEORY 4: Gradient Descent for Logistic Regression ────
                {
                    type: "theory",
                    title: "Gradient Descent for Logistic Regression",
                    content: "Unlike linear regression, logistic regression has no closed-form solution — we must use iterative optimisation. The gradient descent update rule for parameter θⱼ at iteration t is:\n\nθⱼ(t+1) = θⱼ(t) − α · ∂J/∂θⱼ\n\nwhere α is the learning rate and the gradient is:\n\n∂J/∂θⱼ = (1/N) Σᵢ (σ(θᵀxᵢ) − yᵢ) · xᵢⱼ\n\nIn vectorised form: θ(t+1) = θ(t) − (α/N) · Xᵀ(σ(Xθ) − y). Note that σ(Xθ) is applied element-wise. The cross-entropy loss is convex, so gradient descent converges to the global minimum for any starting point given a suitable learning rate.\n\nLearning rate selection: Too large → oscillation or divergence; too small → very slow convergence. A practical approach is to start with α = 0.1 and halve it if the loss increases. Convergence criteria: stop when ‖∇J‖ < ε (e.g., 10⁻⁶), or when the loss change between iterations |J(t) − J(t−1)| < ε, or after a maximum number of iterations.\n\nBatch vs Stochastic vs Mini-batch: Batch gradient descent uses all N samples per update — stable but slow for large N. Stochastic gradient descent (SGD) uses 1 sample per update — noisy but fast and can escape shallow local minima in non-convex problems. Mini-batch (e.g., 32 or 64 samples) balances both — reduced variance compared to SGD while being faster than full batch. For convex logistic regression, batch is often fine for small-to-medium datasets.\n\nStep-by-step numerical example — 2 iterations with N = 3 samples, α = 0.5:\n\nData: x₁ = [1, 2], y₁ = 1; x₂ = [1, −1], y₂ = 0; x₃ = [1, 0.5], y₃ = 1. (First column is bias.)\n\nInitialise θ = [0, 0].\n\nIteration 1: z = Xθ = [0, 0, 0]. σ(z) = [0.5, 0.5, 0.5]. Errors = σ(z) − y = [−0.5, 0.5, −0.5]. Gradient = (1/3)·Xᵀ·errors = (1/3)·[[1,1,1],[2,−1,0.5]]·[−0.5,0.5,−0.5] = (1/3)·[−0.5, −1.75] = [−0.167, −0.583]. Update: θ = [0,0] − 0.5·[−0.167,−0.583] = [0.083, 0.292]. Loss = −(1/3)[log(0.5)+log(0.5)+log(0.5)] = −log(0.5) = 0.6931.\n\nIteration 2: z = Xθ = [1·0.083+2·0.292, 1·0.083+(−1)·0.292, 1·0.083+0.5·0.292] = [0.667, −0.209, 0.229]. σ(z) = [0.661, 0.448, 0.557]. Errors = [0.661−1, 0.448−0, 0.557−1] = [−0.339, 0.448, −0.443]. Gradient = (1/3)·Xᵀ·errors = (1/3)·[[1,1,1],[2,−1,0.5]]·[−0.339,0.448,−0.443] = (1/3)·[−0.334, −1.348] = [−0.111, −0.449]. Update: θ = [0.083,0.292] − 0.5·[−0.111,−0.449] = [0.139, 0.517]. Loss = −(1/3)[1·log(0.661)+1·log(0.552)+1·log(0.557)] = −(1/3)[−0.414+(−0.803)+(−0.586)] = 0.601. The loss decreased from 0.693 to 0.601 — the model is learning.",
                },

                // ── INTUITION 1: The Elastic Band Analogy ─────────────────
                {
                    type: "intuition",
                    title: "The Elastic Band Analogy for Regularization",
                    analogy: "Imagine each regression coefficient is a marble on a number line, and OLS lets each marble roll freely to wherever it minimises the loss. Now attach elastic bands from each marble to the origin. L2 (Ridge) regularization is like rubber bands — every marble feels a pull proportional to its distance from zero. A marble at 5.0 is pulled harder than a marble at 0.3, but neither is forced all the way to zero. The result: all marbles cluster closer to zero, but none actually reach it. L1 (Lasso) regularization is like sticky pads at the origin — once a marble gets close enough to zero, it snaps and sticks there. Marbles that carry little predictive value get pulled to exactly zero and are effectively removed from the model. This is why Lasso performs feature selection. Elastic Net combines both: rubber bands everywhere for stability, plus sticky pads at the origin for sparsity. In forex models with dozens of correlated technical indicators, this is invaluable — Elastic Net keeps the most informative features while zeroing redundant ones, giving you a simpler, more robust model.",
                    content: "When you increase the regularization strength λ (or decrease C = 1/λ in sklearn), you tighten all the elastic bands. With very high λ, even important marbles get pulled close to zero — underfitting. With λ = 0, there are no bands at all — you are back to OLS which may overfit. The sweet spot balances the data-fitting loss and the regularization penalty. Cross-validation (or walk-forward validation for time series) is how you find that sweet spot. A useful mental model: λ controls the radius of the constraint region. Small λ → large region → coefficients are free → complex model. Large λ → tiny region → coefficients compressed → simple model.",
                    emoji: "🪢",
                },

                // ── INTUITION 2: The Sliding Thermometer Analogy ──────────
                {
                    type: "intuition",
                    title: "The Sliding Thermometer — Why Sigmoid for Classification",
                    analogy: "Think of the sigmoid function as a thermometer that converts any temperature into a reading between 0 and 1. The linear combination θᵀx can produce any value from −∞ to +∞ — it is the raw temperature. The sigmoid squashes this into (0, 1), which we interpret as a probability. At z = 0, the thermometer reads exactly 0.5 — maximum uncertainty. As z grows large and positive, the reading approaches 1.0 (confident class 1). As z grows large and negative, the reading approaches 0.0 (confident class 0). The transition zone around z = 0 is where the model is most sensitive — small changes in features cause the biggest swings in predicted probability. This is the decision boundary region.",
                    content: "Why not just use linear regression for classification? If you fit y = θᵀx with y ∈ {0, 1}, predictions can be negative or greater than 1 — nonsensical as probabilities. Worse, a single outlier far from the decision boundary can tilt the entire regression line, dragging the decision boundary away from where it should be. The sigmoid function is immune to this: once z is sufficiently large (say > 5), σ(z) ≈ 1.0 and adding even more extreme points barely changes the prediction. The sigmoid saturates gracefully, making logistic regression robust to outliers in the feature space. In forex, where extreme price moves (fat tails) are common, this saturation property is especially valuable — a 5-sigma move does not distort your directional classifier the way it would distort a linear model.",
                    emoji: "🌡️",
                },

                // ── CODE 1: OLS from Scratch ──────────────────────────────
                {
                    type: "code",
                    title: "OLS Normal Equation from Scratch",
                    language: "python",
                    code: `import numpy as np
from sklearn.linear_model import LinearRegression
from statsmodels.stats.outliers_influence import variance_inflation_factor

# ── Synthetic data ──────────────────────────────────────
np.random.seed(42)
n_samples = 100
x1 = np.random.randn(n_samples)
x2 = 0.5 * x1 + np.random.randn(n_samples) * 0.3  # correlated with x1
x3 = np.random.randn(n_samples)                     # independent feature
noise = np.random.randn(n_samples) * 0.5
y = 3.0 + 2.0 * x1 - 1.5 * x2 + 0.8 * x3 + noise  # true coefficients

# Design matrix with intercept column
X = np.column_stack([np.ones(n_samples), x1, x2, x3])
feature_names = ["intercept", "x1", "x2", "x3"]
print(f"Design matrix X shape: {X.shape}")
print(f"First 3 rows of X:\\n{X[:3]}\\n")

# ── Step-by-step normal equation ────────────────────────
XtX = X.T @ X
print(f"XᵀX (4×4):\\n{np.round(XtX, 4)}\\n")

XtX_inv = np.linalg.inv(XtX)
print(f"(XᵀX)⁻¹:\\n{np.round(XtX_inv, 4)}\\n")

Xty = X.T @ y
print(f"Xᵀy: {np.round(Xty, 4)}\\n")

theta_ols = XtX_inv @ Xty
print("── OLS Solution (Normal Equation) ──")
for name, val in zip(feature_names, theta_ols):
    print(f"  {name:>10s} = {val:+.4f}")

# ── Compare with sklearn ────────────────────────────────
lr = LinearRegression().fit(X[:, 1:], y)  # sklearn adds intercept
theta_sklearn = np.array([lr.intercept_, *lr.coef_])
print("\\n── sklearn LinearRegression ──")
for name, val in zip(feature_names, theta_sklearn):
    print(f"  {name:>10s} = {val:+.4f}")

max_diff = np.max(np.abs(theta_ols - theta_sklearn))
print(f"\\nMax difference between manual and sklearn: {max_diff:.2e}")

# ── VIF computation ─────────────────────────────────────
print("\\n── Variance Inflation Factors ──")
X_no_intercept = X[:, 1:]
for j in range(X_no_intercept.shape[1]):
    vif = variance_inflation_factor(X_no_intercept, j)
    print(f"  {feature_names[j+1]:>4s}: VIF = {vif:.2f}", end="")
    if vif > 5:
        print("  ⚠️  HIGH — consider dropping or combining")
    else:
        print("  ✓")`,
                    explanation: "This code implements the OLS normal equation step-by-step using NumPy. We create synthetic data with a known relationship (including a correlated pair x1/x2 to demonstrate multicollinearity). Each intermediate matrix — XᵀX, its inverse, Xᵀy — is printed so you can verify the derivation from Theory 1. We then compare our manual solution against sklearn's LinearRegression to confirm they match. Finally, we compute VIF for each feature using statsmodels — x1 and x2 will show elevated VIF values because they are correlated by construction, while x3 remains near 1.0.",
                },

                // ── CODE 2: Logistic Regression for Forex Direction ───────
                {
                    type: "code",
                    title: "Logistic Regression for Forex Directional Prediction",
                    language: "python",
                    code: `import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report, confusion_matrix

# ── Simulate forex feature data ─────────────────────────
np.random.seed(42)
n = 2000
dates = pd.date_range("2020-01-01", periods=n, freq="h")
df = pd.DataFrame({
    "date": dates,
    "rsi_14":       50 + 10 * np.random.randn(n),
    "macd_hist":    np.random.randn(n) * 0.002,
    "atr_14":       0.001 + np.abs(np.random.randn(n)) * 0.0005,
    "bb_width":     0.002 + np.abs(np.random.randn(n)) * 0.001,
    "ema_slope":    np.random.randn(n) * 0.0001,
    "volume_ratio": 1.0 + np.random.randn(n) * 0.3,
    "hour_sin":     np.sin(2 * np.pi * np.arange(n) / 24),
    "hour_cos":     np.cos(2 * np.pi * np.arange(n) / 24),
    "close":        1.1000 + np.cumsum(np.random.randn(n) * 0.0005),
})

# ── Create binary target: next-bar direction ────────────
df["next_return"] = df["close"].shift(-1) / df["close"] - 1
df["direction"]   = (df["next_return"] > 0).astype(int)
df.dropna(inplace=True)

feature_cols = ["rsi_14", "macd_hist", "atr_14", "bb_width",
                "ema_slope", "volume_ratio", "hour_sin", "hour_cos"]
X = df[feature_cols].values
y = df["direction"].values
print(f"Dataset: {len(df)} samples, {len(feature_cols)} features")
print(f"Class balance: {y.mean():.3f} (fraction class=1)\\n")

# ── Time-ordered train/test split (NO shuffle!) ─────────
split_idx = int(len(X) * 0.8)
X_train, X_test = X[:split_idx], X[split_idx:]
y_train, y_test = y[:split_idx], y[split_idx:]
print(f"Train: {len(X_train)} | Test: {len(X_test)}\\n")

# ── StandardScaler (fit on train only) ──────────────────
scaler = StandardScaler()
X_train_s = scaler.fit_transform(X_train)
X_test_s  = scaler.transform(X_test)

# ── Logistic Regression with L1 penalty ─────────────────
model = LogisticRegression(
    penalty="l1", C=0.5, solver="saga",
    max_iter=5000, random_state=42
)
model.fit(X_train_s, y_train)

# ── Evaluation ──────────────────────────────────────────
y_pred = model.predict(X_test_s)
print("── Classification Report ──")
print(classification_report(y_test, y_pred, digits=4))

cm = confusion_matrix(y_test, y_pred)
print(f"Confusion Matrix:\\n{cm}\\n")

# ── Coefficient analysis (L1 sparsity) ──────────────────
print("── Coefficient Analysis (L1 Feature Selection) ──")
coefs = model.coef_[0]
for name, c in sorted(zip(feature_cols, coefs), key=lambda x: abs(x[1]), reverse=True):
    status = "KEPT" if abs(c) > 1e-6 else "ZEROED"
    print(f"  {name:>14s}: {c:+.6f}  [{status}]")

n_zero = np.sum(np.abs(coefs) < 1e-6)
print(f"\\nFeatures zeroed by L1: {n_zero}/{len(feature_cols)}")
print(f"Intercept: {model.intercept_[0]:+.6f}")`,
                    explanation: "This pipeline demonstrates logistic regression applied to forex directional prediction. Key practices: (1) The target is binary (next bar up/down). (2) The train/test split is time-ordered — never shuffle time series, or future data leaks into training. (3) StandardScaler is fit on training data only, then applied to test data. (4) L1 penalty (Lasso) with C = 0.5 (recall C = 1/λ) encourages sparsity — uninformative features get coefficients zeroed out. (5) We inspect which features survived L1 selection, giving insight into which indicators the model finds useful. With random synthetic data, most features will have near-zero coefficients — with real forex features, you would see meaningful selection.",
                },

                // ── CODE 3: Gradient Descent from Scratch ─────────────────
                {
                    type: "code",
                    title: "Logistic Regression Gradient Descent from Scratch",
                    language: "python",
                    code: `import numpy as np

def sigmoid(z: np.ndarray) -> np.ndarray:
    """Numerically stable sigmoid function."""
    return np.where(z >= 0,
                    1 / (1 + np.exp(-z)),
                    np.exp(z) / (1 + np.exp(z)))

def cross_entropy_loss(X, y, theta):
    """Compute binary cross-entropy loss."""
    z = X @ theta
    p = sigmoid(z)
    eps = 1e-15  # avoid log(0)
    return -np.mean(y * np.log(p + eps) + (1 - y) * np.log(1 - p + eps))

def accuracy(X, y, theta):
    """Compute classification accuracy."""
    preds = (sigmoid(X @ theta) >= 0.5).astype(int)
    return np.mean(preds == y)

# ── Generate linearly separable data ────────────────────
np.random.seed(42)
n = 200
X_raw = np.random.randn(n, 2)
true_theta = np.array([1.5, -2.0])
prob = sigmoid(X_raw @ true_theta)
y = (np.random.rand(n) < prob).astype(float)

# Add intercept column
X = np.column_stack([np.ones(n), X_raw])
n_features = X.shape[1]
print(f"Data: {n} samples, {n_features} features (incl. intercept)")
print(f"Class balance: {y.mean():.2f}\\n")

# ── Gradient descent parameters ─────────────────────────
theta = np.zeros(n_features)
alpha = 0.5     # learning rate
n_iters = 30
print(f"{'Iter':>4s} | {'Loss':>8s} | {'Accuracy':>8s} | {'‖∇‖':>8s} | θ")
print("-" * 70)

# ── Training loop ───────────────────────────────────────
for i in range(n_iters):
    z = X @ theta
    p = sigmoid(z)

    # Gradient: (1/N) Xᵀ (σ(Xθ) - y)
    errors = p - y
    gradient = (1 / n) * (X.T @ errors)
    grad_norm = np.linalg.norm(gradient)

    # Update
    theta = theta - alpha * gradient

    # Log every 3 iterations + first and last
    if i % 3 == 0 or i == n_iters - 1:
        loss = cross_entropy_loss(X, y, theta)
        acc = accuracy(X, y, theta)
        theta_str = ", ".join(f"{t:+.3f}" for t in theta)
        print(f"{i:4d} | {loss:8.4f} | {acc:8.2%} | {grad_norm:8.5f} | [{theta_str}]")

# ── Final results ───────────────────────────────────────
print(f"\\n── Final Parameters ──")
print(f"  θ₀ (intercept) = {theta[0]:+.4f}")
print(f"  θ₁             = {theta[1]:+.4f}  (true: +1.5)")
print(f"  θ₂             = {theta[2]:+.4f}  (true: -2.0)")
print(f"  Final loss      = {cross_entropy_loss(X, y, theta):.6f}")
print(f"  Final accuracy  = {accuracy(X, y, theta):.2%}")`,
                    explanation: "This code implements logistic regression gradient descent entirely from scratch with NumPy. The sigmoid function uses a numerically stable form to avoid overflow. At each iteration, we compute the gradient ∂J/∂θ = (1/N)·Xᵀ(σ(Xθ) − y), update θ, and print the loss, accuracy, gradient norm, and current parameter values. You can observe the loss monotonically decreasing and accuracy improving as training progresses. The learned θ₁ and θ₂ should converge close to the true values (1.5 and −2.0) used to generate the data, confirming that our manual implementation is correct.",
                },

                // ── QUIZ ──────────────────────────────────────────────────
                {
                    type: "quiz",
                    questions: [
                        {
                            id: "cml-lm-q1",
                            text: "What happens when you try to compute the OLS solution θ* = (XᵀX)⁻¹Xᵀy and XᵀX is singular?",
                            options: [
                                { id: "cml-lm-q1-a", text: "The model automatically switches to gradient descent" },
                                { id: "cml-lm-q1-b", text: "The inverse does not exist, so no unique solution can be computed — coefficients are undefined or infinite" },
                                { id: "cml-lm-q1-c", text: "The solution still works but produces slightly biased estimates" },
                                { id: "cml-lm-q1-d", text: "All coefficients are automatically set to zero" },
                            ],
                            correctOptionId: "cml-lm-q1-b",
                            explanation: "A singular XᵀX matrix means its determinant is zero and the inverse does not exist. This happens when columns of X are linearly dependent (perfect multicollinearity). There are infinitely many solutions and no unique θ* can be determined. Adding regularization (Ridge) fixes this by ensuring XᵀX + λI is always invertible.",
                        },
                        {
                            id: "cml-lm-q2",
                            text: "Given θ = [0.8, −0.5, 1.2] and x = [1, 3, −1] (where x₀ = 1 is the bias term), what is σ(θᵀx)?",
                            options: [
                                { id: "cml-lm-q2-a", text: "σ(−1.9) ≈ 0.130" },
                                { id: "cml-lm-q2-b", text: "σ(0.9) ≈ 0.711" },
                                { id: "cml-lm-q2-c", text: "σ(−0.9) ≈ 0.289" },
                                { id: "cml-lm-q2-d", text: "σ(1.9) ≈ 0.870" },
                            ],
                            correctOptionId: "cml-lm-q2-a",
                            explanation: "θᵀx = 0.8·1 + (−0.5)·3 + 1.2·(−1) = 0.8 − 1.5 − 1.2 = −1.9. Then σ(−1.9) = 1/(1 + e^1.9) = 1/(1 + 6.686) ≈ 1/7.686 ≈ 0.130. The key steps: compute the dot product first, then apply the sigmoid. Negative z values yield probabilities below 0.5.",
                        },
                        {
                            id: "cml-lm-q3",
                            text: "What is the key geometric difference between Ridge (L2) and Lasso (L1) regularization?",
                            options: [
                                { id: "cml-lm-q3-a", text: "L2 uses a diamond-shaped constraint and L1 uses a circular constraint" },
                                { id: "cml-lm-q3-b", text: "L2 has a circular constraint that shrinks all coefficients proportionally; L1 has a diamond constraint whose corners cause some coefficients to be exactly zero" },
                                { id: "cml-lm-q3-c", text: "Both produce identical solutions; the geometric shapes are the same in high dimensions" },
                                { id: "cml-lm-q3-d", text: "L1 shrinks coefficients proportionally while L2 sets some to zero" },
                            ],
                            correctOptionId: "cml-lm-q3-b",
                            explanation: "The L2 penalty constrains θ within a circle (sphere in higher dimensions), which has no corners — so the loss contours touch it at points where all coefficients are non-zero but shrunk. The L1 penalty constrains θ within a diamond (cross-polytope), which has sharp corners on the coordinate axes — the loss contours are likely to first contact a corner, setting one or more coefficients to exactly zero. This is why Lasso performs automatic feature selection.",
                        },
                        {
                            id: "cml-lm-q4",
                            text: "Why should you never randomly shuffle a forex (or any time-series) dataset before splitting into train and test sets?",
                            options: [
                                { id: "cml-lm-q4-a", text: "Shuffling changes the class balance between train and test" },
                                { id: "cml-lm-q4-b", text: "Shuffling causes future data to leak into the training set, giving an overly optimistic estimate of real-world performance" },
                                { id: "cml-lm-q4-c", text: "Shuffling makes the model converge slower during gradient descent" },
                                { id: "cml-lm-q4-d", text: "Shuffling is fine for time series — the concern is overstated" },
                            ],
                            correctOptionId: "cml-lm-q4-b",
                            explanation: "In time series, observations are temporally ordered and autocorrelated. If you shuffle, training samples from the future get mixed in with past data — the model effectively 'sees the future' during training (lookahead bias / data leakage). This produces unrealistically high test accuracy that will not replicate in live trading. Always use a time-ordered split: train on the earlier portion, test on the later portion.",
                        },
                        {
                            id: "cml-lm-q5",
                            text: "What happens to model complexity when you increase the regularization parameter λ (equivalently, decrease C = 1/λ in sklearn)?",
                            options: [
                                { id: "cml-lm-q5-a", text: "Model complexity increases — larger λ allows bigger coefficients" },
                                { id: "cml-lm-q5-b", text: "Model complexity stays the same — λ only affects training speed" },
                                { id: "cml-lm-q5-c", text: "Model complexity decreases — larger λ penalises large coefficients more, shrinking them toward zero" },
                                { id: "cml-lm-q5-d", text: "Model complexity first increases then decreases (U-shaped)" },
                            ],
                            correctOptionId: "cml-lm-q5-c",
                            explanation: "Increasing λ increases the penalty on coefficient magnitudes. Coefficients are forced to be smaller (closer to zero), reducing the model's capacity to fit complex patterns in the training data. This is the bias-variance tradeoff: more regularization → higher bias, lower variance → simpler model. At the extreme (λ → ∞), all coefficients go to zero and the model predicts only the intercept.",
                        },
                        {
                            id: "cml-lm-q6",
                            text: "Given this confusion matrix for a forex direction classifier:\n\n              Predicted Up  Predicted Down\nActual Up         85            15\nActual Down       25            75\n\nWhat are the precision and recall for the 'Up' class?",
                            options: [
                                { id: "cml-lm-q6-a", text: "Precision = 85/110 ≈ 0.773, Recall = 85/100 = 0.850" },
                                { id: "cml-lm-q6-b", text: "Precision = 85/100 = 0.850, Recall = 85/110 ≈ 0.773" },
                                { id: "cml-lm-q6-c", text: "Precision = 75/100 = 0.750, Recall = 75/90 ≈ 0.833" },
                                { id: "cml-lm-q6-d", text: "Precision = 85/200 = 0.425, Recall = 85/200 = 0.425" },
                            ],
                            correctOptionId: "cml-lm-q6-a",
                            explanation: "For the 'Up' class: Precision = TP/(TP+FP) = 85/(85+25) = 85/110 ≈ 0.773. Of all the times the model predicted 'Up', 77.3% were actually Up. Recall = TP/(TP+FN) = 85/(85+15) = 85/100 = 0.850. Of all actual Up cases, the model caught 85%. Precision asks 'how reliable are positive predictions?', recall asks 'how many positives did we find?'.",
                        },
                        {
                            id: "cml-lm-q7",
                            text: "When would you prefer Elastic Net over pure Lasso (L1) or pure Ridge (L2) regularization?",
                            options: [
                                { id: "cml-lm-q7-a", text: "When you have very few features (< 5) and no multicollinearity" },
                                { id: "cml-lm-q7-b", text: "When you have many correlated features and want both feature selection (sparsity) and coefficient stability among correlated groups" },
                                { id: "cml-lm-q7-c", text: "When the dataset is very small (< 50 samples) regardless of feature count" },
                                { id: "cml-lm-q7-d", text: "Elastic Net is never preferred — it is always dominated by either pure L1 or pure L2" },
                            ],
                            correctOptionId: "cml-lm-q7-b",
                            explanation: "Elastic Net shines when features are numerous and correlated — common in forex with overlapping technical indicators (e.g., RSI-14 and RSI-21, multiple EMA periods). Pure Lasso with correlated features tends to arbitrarily pick one from a correlated group and zero the rest, which is unstable. Pure Ridge keeps all features but does not zero any. Elastic Net combines both: the L1 component provides sparsity (feature selection), while the L2 component ensures that among correlated features, coefficients are shared more evenly rather than arbitrarily selecting one.",
                        },
                    ],
                },

                // ── PRACTICE 1: Guided Exercise ───────────────────────────
                {
                    type: "practice",
                    title: "Regularization Strength Sweep for Forex Direction",
                    description: "Train a logistic regression model on the forex direction task with the L1 penalty using four different values of C: {0.01, 0.1, 1.0, 10.0}. For each C value, record: (a) the number of non-zero coefficients, (b) the test accuracy, and (c) which features were zeroed out. Use a time-ordered 80/20 split and StandardScaler fit on training data only. Create a table summarising your results and identify the C value that gives the best trade-off between model simplicity (fewest features) and test performance. Consider: does the sparsest model sacrifice much accuracy compared to the least-regularised one? What does this tell you about the informativeness of the features?",
                    catalogModelId: "logistic-regression",
                },

                // ── PRACTICE 2: Dashboard Exploration ─────────────────────
                {
                    type: "practice",
                    title: "Multicollinearity & Feature Importance Dashboard Exploration",
                    description: "Open the dashboard's feature importance view and load a forex dataset with at least 8 technical indicators, including some that are known to be correlated (e.g., RSI-14 and RSI-21, MACD line and MACD signal, multiple EMA periods). Perform the following exploration:\n\n1. Compute VIF for all features. Which pairs have VIF > 5?\n2. Fit a Ridge model and note the coefficient magnitudes.\n3. Remove one feature from the highest-VIF pair. Recompute VIF and retrain. How do the remaining coefficients change?\n4. Now fit a Lasso model on the original feature set. Which features does it zero out? Do they match the high-VIF features?\n5. Try Elastic Net with α = 0.5. Compare its selected features and test performance to pure Lasso.\n\nDocument your observations about how multicollinearity affects coefficient stability and how different regularization methods handle it. Consider which approach you would recommend for a production forex model and why.",
                },
            ],
        }
,
        {
            id: "cml-tree-models",
            title: "Decision Trees & Random Forests",
            description: "Learn how decision trees recursively partition feature space using information-theoretic splitting criteria (Gini impurity, entropy), how Random Forests combine hundreds of decorrelated trees via bootstrap aggregation to dramatically reduce variance, and how to extract and compare feature importance metrics (MDI vs permutation) to identify the most predictive technical indicators for forex regime detection.",
            estimatedMinutes: 75,
            difficulty: "intermediate" as const,
            prerequisites: ["cml-linear-models"],
            sections: [
                {
                    type: "objective" as const,
                    content: "By the end of this lesson, you will understand the mathematical foundations of decision tree splitting criteria, implement trees from scratch, build Random Forest ensembles for forex regime classification, and critically evaluate feature importance using both Mean Decrease in Impurity and permutation-based methods.",
                    keyTakeaways: [
                        "Derive and compute Gini impurity G = 1 − Σ pₖ² and entropy H = −Σ pₖ log₂(pₖ) for any class distribution",
                        "Trace the CART algorithm's greedy search over all features and thresholds to find optimal splits",
                        "Apply pre-pruning constraints (max_depth, min_samples_leaf) and post-pruning via cost-complexity criterion Rα(T) = R(T) + α|T̃|",
                        "Explain why bagging reduces variance from σ² to ρσ² + (1−ρ)σ²/B and how random feature subsets lower ρ",
                        "Calculate OOB error using the ~36.8% of samples excluded from each bootstrap replicate",
                        "Train a Random Forest with 500 trees on forex regime data with time-ordered validation",
                        "Compare MDI and permutation importance rankings and identify when they disagree due to cardinality bias or feature correlation",
                        "Tune Random Forest hyperparameters (n_estimators, max_depth, min_samples_leaf) for optimal regime detection"
                    ]
                },
                {
                    type: "theory" as const,
                    title: "Information Gain & Gini Impurity",
                    content: "Decision trees split nodes by choosing the feature and threshold that maximally separate classes. Two standard criteria quantify node \"impurity\" — how mixed the classes are. Gini impurity for a node with K classes is G = 1 − Σₖ pₖ², where pₖ is the proportion of class k. A pure node (all one class) has G = 0; maximum impurity for two classes occurs at p = 0.5, giving G = 0.5. Entropy uses logarithms: H = −Σₖ pₖ log₂(pₖ), reaching a maximum of 1.0 bit for two equally likely classes. Both measure disorder, but Gini is slightly faster to compute and tends to isolate the most frequent class, while entropy produces more balanced trees.\n\nLet's work a concrete numerical example. Suppose a parent node contains 100 forex candles: 60 labeled \"trending\" and 40 labeled \"ranging.\" The class proportions are p_trend = 0.6, p_range = 0.4. Gini impurity: G = 1 − (0.6² + 0.4²) = 1 − (0.36 + 0.16) = 1 − 0.52 = 0.48. Entropy: H = −(0.6 · log₂(0.6) + 0.4 · log₂(0.4)) = −(0.6 · (−0.737) + 0.4 · (−1.322)) = 0.442 + 0.529 = 0.971 bits.\n\nNow consider a candidate split on ADX at threshold 25. The left child gets 55 samples: 45 trending, 10 ranging. The right child gets 45 samples: 15 trending, 30 ranging. Left Gini: G_L = 1 − ((45/55)² + (10/55)²) = 1 − (0.6694 + 0.0331) = 0.2975. Right Gini: G_R = 1 − ((15/45)² + (30/45)²) = 1 − (0.1111 + 0.4444) = 0.4444. Weighted Gini after split: G_split = (55/100) · 0.2975 + (45/100) · 0.4444 = 0.1636 + 0.2000 = 0.3636. Gini gain = 0.48 − 0.3636 = 0.1164.\n\nFor the entropy-based information gain on the same split: H_L = −((45/55)·log₂(45/55) + (10/55)·log₂(10/55)) = −(0.818·(−0.290) + 0.182·(−2.459)) = 0.237 + 0.447 = 0.684 bits. H_R = −((15/45)·log₂(15/45) + (30/45)·log₂(30/45)) = −(0.333·(−1.585) + 0.667·(−0.585)) = 0.528 + 0.390 = 0.918 bits. Weighted child entropy = (55/100)·0.684 + (45/100)·0.918 = 0.376 + 0.413 = 0.789 bits. Information gain = 0.971 − 0.789 = 0.182 bits. Both criteria agree this split reduces impurity, but the magnitudes differ because the scales differ (Gini ∈ [0, 0.5] for binary, entropy ∈ [0, 1]).\n\nThe tree algorithm evaluates every possible split and picks the one with the highest gain. At each node it considers every feature and (for continuous features) every midpoint between sorted unique values as a candidate threshold. The winning split becomes the node's decision rule, and the process recurses on each child until a stopping criterion is met."
                },
                {
                    type: "theory" as const,
                    title: "Recursive Splitting & Pruning",
                    content: "The CART (Classification and Regression Trees) algorithm builds a binary tree top-down via greedy recursive splitting. At each node, it searches over all p features. For each feature j, it sorts the n samples by feature j (O(n log n)) and evaluates splits at each of the up to n−1 midpoints. The total work per node is O(n · p · log(n)). For a balanced tree of depth d, there are 2^d leaf nodes and the total complexity is roughly O(n · p · log(n) · d). The algorithm selects the (feature, threshold) pair that yields the highest impurity reduction, creates two child nodes, and recurses.\n\nWithout constraints, CART will keep splitting until every leaf is pure — perfectly memorizing the training data. This overfits catastrophically on noisy forex data where regime labels may be imprecise. Pre-pruning stops tree growth early using hyperparameters: max_depth limits tree depth (e.g., 5–10 for forex features), min_samples_leaf requires each leaf to contain at least k samples (e.g., 20–50 candles), and min_samples_split requires at least m samples to attempt a split. These constraints act as regularizers — they prevent the tree from fitting noise in small subsets of data.\n\nPost-pruning takes the opposite approach: grow the full tree first, then prune back. Cost-complexity pruning defines the criterion Rα(T) = R(T) + α|T̃|, where R(T) is the total misclassification rate (or impurity) of tree T, |T̃| is the number of terminal leaves, and α ≥ 0 is the complexity parameter. When α = 0, the full unpruned tree minimizes the criterion. As α increases, the penalty for each additional leaf grows, and subtrees that provide only marginal impurity reduction get collapsed into leaves. For each internal node, if the impurity reduction from its subtree is less than α times the number of leaves removed, the subtree is pruned.\n\nIn practice, you find the optimal α via cross-validation. Scikit-learn's cost_complexity_pruning_path computes the effective α values at which successive subtrees are pruned. You then evaluate each pruned tree on a validation fold and pick the α that minimizes validation error. For time-series forex data, use time-ordered folds (never look ahead). A common heuristic is to pick α within one standard error of the minimum — the \"1-SE rule\" — which favors simpler trees when performance is comparable."
                },
                {
                    type: "theory" as const,
                    title: "Bagging & Variance Reduction",
                    content: "A single decision tree has high variance: small changes in training data can produce completely different tree structures. Random Forests tame this variance through bagging (bootstrap aggregating). The algorithm draws B bootstrap samples (sampling n points with replacement from the training set), trains one tree on each, and averages their predictions (regression) or takes a majority vote (classification). The key insight is a variance decomposition: if each tree has variance σ² and any two trees have pairwise correlation ρ, then Var(average of B trees) = ρσ² + (1 − ρ)σ²/B.\n\nAs B → ∞, the second term vanishes, but the first term ρσ² remains — this is the irreducible floor from correlated trees. If all trees see the same features, they tend to split on the same dominant features (like ADX or volatility), producing high correlation ρ. Random Forests reduce ρ by restricting each split to a random subset of m features. For classification, the default is m = √p (e.g., if you have 15 indicators, each split considers only ⌊√15⌋ = 3 random features). This forces trees to explore different regions of feature space, decorrelating their predictions and lowering the variance floor.\n\nBootstrap sampling has an elegant side effect: each bootstrap sample includes about 63.2% of the original data points, leaving ~36.8% out. This is because the probability that a given sample is NOT selected in any of n draws is (1 − 1/n)ⁿ, which converges to e⁻¹ ≈ 0.368 as n grows. These out-of-bag (OOB) samples provide a free validation set for each tree. The OOB error — computed by predicting each sample using only trees that didn't train on it — closely approximates leave-one-out cross-validation error without any additional computation.\n\nFor forex regime detection, typical configurations use B = 500 trees with max_depth = 10–15 and min_samples_leaf = 20. The OOB score serves as your primary model selection metric, avoiding the need for a separate validation split (though you should still hold out a final test set for unbiased evaluation). With 15 technical features, each split considers √15 ≈ 3–4 features, ensuring sufficient decorrelation. The ensemble's majority vote smooths out the noise that plagues individual trees, producing more stable regime classifications."
                },
                {
                    type: "theory" as const,
                    title: "Feature Importance: MDI vs Permutation",
                    content: "Random Forests provide built-in feature importance via Mean Decrease in Impurity (MDI). For each feature j, MDI sums the impurity decrease (weighted by the number of samples reaching the node) across every split on feature j across all B trees, then normalizes so importances sum to 1. This is fast — it requires no additional computation beyond training. In scikit-learn, it is accessed via rf.feature_importances_. For forex features, you might find that ATR and ADX dominate MDI, suggesting volatility and trend strength are the primary regime discriminators.\n\nHowever, MDI has a well-documented bias: it systematically overestimates the importance of high-cardinality continuous features and features with many unique values. A continuous feature like raw price has thousands of possible split points, giving the tree many opportunities to split on it — even if the splits are not genuinely informative. Categorical features with few levels or low-variance continuous features are penalized. This bias is especially problematic with correlated features: if RSI and stochastic oscillator are highly correlated, MDI may arbitrarily assign most importance to whichever the tree happens to split on first, understating the other.\n\nPermutation importance provides an unbiased alternative. After training, for each feature j: (1) record the baseline accuracy on the OOB set (or a held-out validation set), (2) randomly shuffle feature j's values, breaking its relationship with the target, (3) re-evaluate accuracy — the drop in accuracy is feature j's permutation importance. This directly measures how much the model relies on feature j for correct predictions. It is unbiased with respect to cardinality and scale. The downside is computational cost: it requires n_features × n_repeats full prediction passes.\n\nWhen MDI and permutation importance disagree, investigate further. If a feature ranks high on MDI but low on permutation importance, it may be a high-cardinality feature that the tree splits on frequently without genuine predictive value — or it may be redundant with another correlated feature. If a feature ranks low on MDI but high on permutation importance, it likely has few unique values but carries genuine signal. For forex regime detection, you should compute both, compare rankings, and focus on features that rank consistently high on both metrics. Features where they disagree warrant deeper investigation — partial dependence plots or SHAP values can provide further clarity."
                },
                {
                    type: "intuition" as const,
                    title: "The 20 Questions Game",
                    analogy: "A decision tree works exactly like the game of 20 Questions. You are trying to guess what market regime is active (trending up, trending down, or ranging). Each question you ask is a split: \"Is ADX above 25?\" If yes, it's likely trending. Then you refine: \"Is the 20-period SMA slope positive?\" If yes, trending up; if no, trending down. The tree picks the MOST INFORMATIVE question at each step — the one that eliminates the most uncertainty — just like a skilled 20-Questions player doesn't waste a question on something that barely narrows down the answer. Gini impurity and entropy are how the tree measures which question \"eliminates the most uncertainty.\" The difference from the game: the tree considers thousands of possible questions (every feature × every threshold) and picks the mathematically optimal one at each node.",
                    content: "Imagine you're a new trader trying to classify the current market regime. You could ask random questions: \"Is RSI above 73.2?\" or \"Is volume above 1,247,000?\" But a smart approach asks the question that most cleanly divides the possibilities. If 80% of trending regimes have ADX > 25 and 80% of ranging regimes have ADX ≤ 25, then asking about ADX is far more informative than asking about a noisy indicator. That's information gain — the reduction in uncertainty. The tree automates this: at each node, it tries every possible question and picks the one with the highest information gain. The result is a hierarchy of questions, from most to least informative, that efficiently carves up the feature space into regime categories.",
                    emoji: "🎯"
                },
                {
                    type: "intuition" as const,
                    title: "The Committee of Experts",
                    analogy: "Imagine 500 forex traders sitting in a room. Each trader has studied the market but has only been shown a RANDOM subset of historical trades (bootstrap sample — about 63% of all data). Furthermore, at each decision point, each trader can only look at 4 out of 15 available indicators (random feature subset). Despite these handicaps, when you poll all 500 and take the majority vote on whether the market is trending or ranging, the group dramatically outperforms any individual trader. Why? Because each trader's errors are DIFFERENT — they've seen different data and different indicators — so individual mistakes cancel out. The key is DECORRELATION: if all traders used the same indicators, they'd all make the same mistakes.",
                    content: "This is the core insight of Random Forests. A single decision tree is like one opinionated trader — confident but brittle, easily swayed by which data it happened to see. Bagging gives each tree a different random sample of the data, so they learn slightly different patterns. The random feature subset goes further: by forcing each split to consider only √p features, trees are prevented from all latching onto the single strongest predictor (like ADX) and ignoring everything else. This decorrelation is what drives the variance formula: Var = ρσ² + (1−ρ)σ²/B. With B = 500 and low ρ (thanks to random features), variance plummets. The forest doesn't just average out noise — it discovers that different indicators are informative in different regions of the feature space.",
                    emoji: "🌲"
                },
                {
                    type: "code" as const,
                    title: "Decision Tree Splitting Metrics from Scratch",
                    language: "python",
                    code: `import numpy as np

def gini_impurity(labels: np.ndarray) -> float:
    """Compute Gini impurity: G = 1 - Σ pₖ²"""
    if len(labels) == 0:
        return 0.0
    classes, counts = np.unique(labels, return_counts=True)
    proportions = counts / len(labels)
    return 1.0 - np.sum(proportions ** 2)

def entropy(labels: np.ndarray) -> float:
    """Compute entropy: H = -Σ pₖ log₂(pₖ)"""
    if len(labels) == 0:
        return 0.0
    classes, counts = np.unique(labels, return_counts=True)
    proportions = counts / len(labels)
    # Avoid log(0) by filtering out zero proportions
    proportions = proportions[proportions > 0]
    return -np.sum(proportions * np.log2(proportions))

def information_gain(parent: np.ndarray, left: np.ndarray,
                     right: np.ndarray, criterion="gini") -> float:
    """Compute information gain for a binary split."""
    func = gini_impurity if criterion == "gini" else entropy
    n = len(parent)
    return func(parent) - (len(left)/n * func(left) + len(right)/n * func(right))

def find_best_split(X: np.ndarray, y: np.ndarray, criterion="gini"):
    """Find the best (feature, threshold) by exhaustive search."""
    best_gain, best_feat, best_thresh = -1.0, None, None
    n_samples, n_features = X.shape

    for feat_idx in range(n_features):
        values = np.sort(np.unique(X[:, feat_idx]))
        thresholds = (values[:-1] + values[1:]) / 2.0  # midpoints

        for thresh in thresholds:
            left_mask = X[:, feat_idx] <= thresh
            right_mask = ~left_mask
            if left_mask.sum() == 0 or right_mask.sum() == 0:
                continue
            gain = information_gain(y, y[left_mask], y[right_mask], criterion)
            if gain > best_gain:
                best_gain, best_feat, best_thresh = gain, feat_idx, thresh

    return best_feat, best_thresh, best_gain

# --- Demo with forex regime data ---
np.random.seed(42)
n = 100
adx = np.concatenate([np.random.normal(35, 8, 60), np.random.normal(18, 6, 40)])
labels = np.array(["trending"] * 60 + ["ranging"] * 40)

print(f"Parent Gini:    {gini_impurity(labels):.4f}")
print(f"Parent Entropy: {entropy(labels):.4f}")

X = adx.reshape(-1, 1)
feat, thresh, gain = find_best_split(X, labels, criterion="gini")
print(f"\\nBest split: ADX <= {thresh:.2f}")
print(f"Gini gain:    {gain:.4f}")

_, _, gain_ent = find_best_split(X, labels, criterion="entropy")
print(f"Entropy gain: {gain_ent:.4f}")`,
                    explanation: "This code implements the core splitting mechanics of a decision tree from scratch using only NumPy. The gini_impurity function computes G = 1 − Σ pₖ², while entropy computes H = −Σ pₖ log₂(pₖ). The find_best_split function performs the exhaustive search that CART uses: for every feature and every midpoint between sorted unique values, it evaluates the information gain and tracks the best split. The demo creates synthetic forex data where trending regimes have higher ADX values, then finds the optimal ADX threshold to separate them. Notice how both Gini and entropy agree on the best split point but differ in magnitude."
                },
                {
                    type: "code" as const,
                    title: "Random Forest for Forex Regime Detection",
                    language: "python",
                    code: `import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report
from sklearn.model_selection import TimeSeriesSplit

# --- Simulate 15-feature forex dataset ---
np.random.seed(42)
n_samples = 2000
feature_names = [
    "adx", "atr_pct", "rsi", "macd_hist", "bb_width",
    "sma_slope_20", "ema_slope_50", "volume_ratio", "stoch_k",
    "cci", "obv_slope", "vwap_dist", "hurst_exp", "spread_avg", "hour_sin"
]
X = np.random.randn(n_samples, 15)
# Regime depends mainly on adx, atr_pct, bb_width, and hurst_exp
regime_score = 0.5*X[:,0] + 0.3*X[:,1] + 0.2*X[:,4] - 0.4*X[:,12] + 0.3*np.random.randn(n_samples)
y = np.where(regime_score > 0.3, "trending", np.where(regime_score < -0.3, "ranging", "transitional"))

# --- Time-ordered split (NO shuffle — respects temporal order) ---
split_idx = int(0.8 * n_samples)
X_train, X_test = X[:split_idx], X[split_idx:]
y_train, y_test = y[:split_idx], y[split_idx:]
print(f"Train: {len(X_train)}, Test: {len(X_test)}")
print(f"Class distribution (train): {dict(zip(*np.unique(y_train, return_counts=True)))}")

# --- Train Random Forest with OOB scoring ---
rf = RandomForestClassifier(
    n_estimators=500,
    max_depth=12,
    min_samples_leaf=20,
    max_features="sqrt",       # √p ≈ 3-4 features per split
    oob_score=True,
    random_state=42,
    n_jobs=-1                  # use all CPU cores
)
rf.fit(X_train, y_train)

print(f"\\nOOB Accuracy: {rf.oob_score_:.4f}")
print(f"Test Accuracy: {rf.score(X_test, y_test):.4f}")
print(f"\\n{classification_report(y_test, rf.predict(X_test))}")

# --- Feature importance bar chart (text-based) ---
importances = rf.feature_importances_
sorted_idx = np.argsort(importances)[::-1]
print("\\nFeature Importance (MDI):")
print("-" * 50)
max_bar = 40
for i in sorted_idx:
    bar_len = int(importances[i] / importances.max() * max_bar)
    bar = "█" * bar_len
    print(f"  {feature_names[i]:>14s} | {bar} {importances[i]:.4f}")`,
                    explanation: "This pipeline demonstrates a production-style Random Forest workflow for forex regime detection. Key details: (1) Time-ordered split — we never shuffle time series data, ensuring no look-ahead bias. (2) 500 trees with max_features='sqrt' for decorrelation; max_depth=12 and min_samples_leaf=20 for regularization. (3) OOB score provides a free validation metric — it should closely track the test accuracy. (4) The text-based bar chart reveals which indicators drive regime classification. Features like adx, atr_pct, and bb_width should rank highly since they were given non-zero coefficients in the synthetic data generation. (5) n_jobs=-1 parallelizes across all CPU cores, critical for 500 trees."
                },
                {
                    type: "code" as const,
                    title: "Permutation Importance vs MDI Comparison",
                    language: "python",
                    code: `import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance

# --- Assume X_train, y_train, X_test, y_test, feature_names from previous code ---
# Re-create for standalone execution
np.random.seed(42)
n = 2000
feature_names = [
    "adx", "atr_pct", "rsi", "macd_hist", "bb_width",
    "sma_slope_20", "ema_slope_50", "volume_ratio", "stoch_k",
    "cci", "obv_slope", "vwap_dist", "hurst_exp", "spread_avg", "hour_sin"
]
X = np.random.randn(n, 15)
score = 0.5*X[:,0] + 0.3*X[:,1] + 0.2*X[:,4] - 0.4*X[:,12] + 0.3*np.random.randn(n)
y = np.where(score > 0.3, "trending", np.where(score < -0.3, "ranging", "transitional"))
split = int(0.8 * n)
X_train, X_test, y_train, y_test = X[:split], X[split:], y[:split], y[split:]

rf = RandomForestClassifier(n_estimators=500, max_depth=12,
                            min_samples_leaf=20, max_features="sqrt",
                            random_state=42, n_jobs=-1)
rf.fit(X_train, y_train)

# --- MDI (built-in) ---
mdi = rf.feature_importances_
mdi_rank = np.argsort(mdi)[::-1]

# --- Permutation importance (on test set, 10 repeats) ---
perm_result = permutation_importance(rf, X_test, y_test,
                                     n_repeats=10, random_state=42, n_jobs=-1)
perm = perm_result.importances_mean
perm_rank = np.argsort(perm)[::-1]

# --- Side-by-side comparison ---
print(f"{'Feature':>14s} | {'MDI':>8s} {'Rank':>4s} | {'Perm':>8s} {'Rank':>4s} | {'Δ Rank':>6s}")
print("-" * 60)
for i in range(len(feature_names)):
    mdi_r = list(mdi_rank).index(i) + 1
    perm_r = list(perm_rank).index(i) + 1
    delta = abs(mdi_r - perm_r)
    flag = " ⚠️" if delta >= 4 else ""
    print(f"  {feature_names[i]:>12s} | {mdi[i]:>8.4f} #{mdi_r:<3d} | {perm[i]:>8.4f} #{perm_r:<3d} | {delta:>4d}{flag}")

# --- Highlight disagreements ---
print("\\nFeatures with rank disagreement ≥ 4:")
for i in range(len(feature_names)):
    mdi_r = list(mdi_rank).index(i) + 1
    perm_r = list(perm_rank).index(i) + 1
    if abs(mdi_r - perm_r) >= 4:
        print(f"  {feature_names[i]}: MDI rank #{mdi_r}, Perm rank #{perm_r}")`,
                    explanation: "This code directly compares the two main feature importance methods. MDI (Mean Decrease in Impurity) is extracted from the trained model for free, while permutation importance is computed by shuffling each feature independently on the test set and measuring accuracy drop across 10 repeats. The side-by-side table shows both importance values and ranks, flagging features with rank disagreements of 4 or more positions. In practice, noise features with many unique values (like hour_sin or spread_avg) may rank higher on MDI than permutation importance due to cardinality bias, while genuinely predictive features (adx, hurst_exp) should rank consistently high on both."
                },
                {
                    type: "quiz" as const,
                    questions: [
                        {
                            id: "cml-tree-q1",
                            text: "A node contains samples with class proportions [0.7, 0.3]. What is the Gini impurity?\n\nG = 1 − Σ pₖ²",
                            options: [
                                { id: "cml-tree-q1-a", text: "0.21", isCorrect: false },
                                { id: "cml-tree-q1-b", text: "0.42", isCorrect: true },
                                { id: "cml-tree-q1-c", text: "0.49", isCorrect: false },
                                { id: "cml-tree-q1-d", text: "0.58", isCorrect: false }
                            ],
                            explanation: "G = 1 − (0.7² + 0.3²) = 1 − (0.49 + 0.09) = 1 − 0.58 = 0.42. A common mistake is computing 0.7 × 0.3 = 0.21, which is half the correct answer. Another mistake is reporting 1 − 0.42 = 0.58, which is Σ pₖ² rather than the Gini impurity itself."
                        },
                        {
                            id: "cml-tree-q2",
                            text: "Why does selecting a random subset of √p features at each split improve Random Forest performance compared to using all p features?",
                            options: [
                                { id: "cml-tree-q2-a", text: "It reduces the computational cost of training each tree", isCorrect: false },
                                { id: "cml-tree-q2-b", text: "It forces each tree to use fewer features overall, acting as feature selection", isCorrect: false },
                                { id: "cml-tree-q2-c", text: "It decorrelates the trees by preventing them from all splitting on the same dominant features, reducing the pairwise correlation ρ in Var = ρσ² + (1−ρ)σ²/B", isCorrect: true },
                                { id: "cml-tree-q2-d", text: "It increases the bias of each individual tree, improving the bias-variance tradeoff", isCorrect: false }
                            ],
                            explanation: "The primary benefit is decorrelation. Without random feature subsets, every tree would split on the strongest feature (e.g., ADX) at the root, making all trees highly correlated. The variance formula Var = ρσ² + (1−ρ)σ²/B shows that even with infinite trees (B → ∞), variance is bounded below by ρσ². Reducing ρ via random feature subsets lowers this floor. While computational speedup is a side benefit, it is not the primary reason for the technique."
                        },
                        {
                            id: "cml-tree-q3",
                            text: "What does the Out-of-Bag (OOB) error estimate?",
                            options: [
                                { id: "cml-tree-q3-a", text: "The training error of the Random Forest", isCorrect: false },
                                { id: "cml-tree-q3-b", text: "An approximation of the leave-one-out cross-validation error, using the ~36.8% of samples not included in each tree's bootstrap sample", isCorrect: true },
                                { id: "cml-tree-q3-c", text: "The error on a held-out test set that the user must provide", isCorrect: false },
                                { id: "cml-tree-q3-d", text: "The average error of individual trees on their own training data", isCorrect: false }
                            ],
                            explanation: "Each bootstrap sample excludes approximately (1 − 1/n)ⁿ ≈ e⁻¹ ≈ 36.8% of the original samples. For each sample, the OOB prediction is the aggregate prediction from only the trees that did NOT include that sample in training. This closely approximates leave-one-out cross-validation and provides a nearly unbiased estimate of the generalization error without needing a separate validation set."
                        },
                        {
                            id: "cml-tree-q4",
                            text: "What is the main tradeoff between pre-pruning and post-pruning a decision tree?",
                            options: [
                                { id: "cml-tree-q4-a", text: "Pre-pruning is faster but may stop too early (missing useful splits deeper in the tree), while post-pruning grows the full tree first and evaluates all subtrees but is more computationally expensive", isCorrect: true },
                                { id: "cml-tree-q4-b", text: "Pre-pruning always produces better trees because it prevents overfitting from the start", isCorrect: false },
                                { id: "cml-tree-q4-c", text: "Post-pruning cannot be used with cross-validation, while pre-pruning can", isCorrect: false },
                                { id: "cml-tree-q4-d", text: "Pre-pruning reduces bias while post-pruning reduces variance", isCorrect: false }
                            ],
                            explanation: "Pre-pruning (max_depth, min_samples_leaf, min_samples_split) is computationally cheap and fast but suffers from the \"horizon effect\" — it may stop splitting at a node where the immediate gain is small but deeper splits would have been highly informative. Post-pruning via cost-complexity (Rα(T) = R(T) + α|T̃|) avoids this by growing the full tree and then removing subtrees that don't justify their complexity, but it requires growing and evaluating the full tree first."
                        },
                        {
                            id: "cml-tree-q5",
                            text: "A parent node has entropy H = 1.0 bit and 200 samples. It splits into a left child (120 samples, H = 0.65 bits) and a right child (80 samples, H = 0.80 bits). What is the information gain?",
                            options: [
                                { id: "cml-tree-q5-a", text: "0.29 bits", isCorrect: true },
                                { id: "cml-tree-q5-b", text: "0.35 bits", isCorrect: false },
                                { id: "cml-tree-q5-c", text: "0.55 bits", isCorrect: false },
                                { id: "cml-tree-q5-d", text: "0.275 bits", isCorrect: false }
                            ],
                            explanation: "Information gain = H(parent) − [n_L/n · H(left) + n_R/n · H(right)] = 1.0 − [(120/200) · 0.65 + (80/200) · 0.80] = 1.0 − [0.6 · 0.65 + 0.4 · 0.80] = 1.0 − [0.39 + 0.32] = 1.0 − 0.71 = 0.29 bits. The weighted average of child entropies accounts for the different sizes of the child nodes."
                        },
                        {
                            id: "cml-tree-q6",
                            text: "In which scenario would permutation importance give DIFFERENT results than MDI (Mean Decrease in Impurity)?",
                            options: [
                                { id: "cml-tree-q6-a", text: "When all features are independent and equally important", isCorrect: false },
                                { id: "cml-tree-q6-b", text: "When a high-cardinality continuous feature (many unique values) is split on frequently by the tree but has no genuine predictive power, or when two correlated features share importance", isCorrect: true },
                                { id: "cml-tree-q6-c", text: "When the Random Forest uses more than 1000 trees", isCorrect: false },
                                { id: "cml-tree-q6-d", text: "When the dataset has more features than samples (p > n)", isCorrect: false }
                            ],
                            explanation: "MDI is biased toward high-cardinality features because they offer more candidate split points, giving the tree more opportunities to split on them — even if those splits don't genuinely improve predictions. Permutation importance is immune to this because it directly measures the accuracy drop when a feature's relationship to the target is destroyed. Additionally, when features are correlated (e.g., RSI and stochastic oscillator), MDI may arbitrarily assign importance to one while permutation importance more fairly distributes it. The number of trees or the p/n ratio do not cause systematic disagreements."
                        }
                    ]
                },
                {
                    type: "practice" as const,
                    title: "Tune Random Forest Hyperparameters for Regime Detection",
                    description: "Using the Random Forest regime classifier, systematically tune three key hyperparameters: n_estimators (try 100, 300, 500, 800), max_depth (try 5, 8, 12, 15, None), and min_samples_leaf (try 5, 10, 20, 50). Use OOB score as your evaluation metric to avoid data leakage. Record OOB accuracy for each combination and identify the configuration that achieves the best regime detection performance. Observe diminishing returns as n_estimators increases beyond 500. Does deeper max_depth always help, or does it overfit on noisy forex features? What min_samples_leaf strikes the best balance between bias and variance?",
                    catalogModelId: "random-forest-regime"
                },
                {
                    type: "practice" as const,
                    title: "Compare MDI vs Permutation Importance on Your Dashboard",
                    description: "Train a Random Forest on the full forex feature set and compute both MDI and permutation importance. Create a side-by-side ranking comparison and identify features where the two methods disagree by 4+ rank positions. For each disagreement, hypothesize WHY: Is it a cardinality bias issue (high-cardinality feature inflated by MDI)? A correlation issue (two correlated features splitting importance differently)? Or a noise feature that happens to offer many split points? Document your findings and determine which importance method you would trust more for feature selection in a production regime detection system."
                }
            ]
        }
,
        {
            id: "cml-svm",
            title: "Support Vector Machines for Classification",
            description: "Master Support Vector Machines (SVMs) from first principles — the maximum margin classifier that finds the optimal separating hyperplane between classes. This lesson derives the primal and dual optimization problems, reveals how the kernel trick enables non-linear classification by implicitly mapping data to higher-dimensional spaces, and connects soft-margin SVMs to the bias-variance tradeoff through the C parameter. You will apply SVMs with RBF, polynomial, and linear kernels to forex regime classification, learning when SVMs outperform tree-based methods and how to tune γ and C for robust out-of-sample performance on financial time series.",
            estimatedMinutes: 75,
            difficulty: "intermediate" as const,
            prerequisites: ["cml-linear-models"],
            sections: [
                {
                    type: "objective" as const,
                    content: "By the end of this lesson, you will understand the mathematical foundations of Support Vector Machines — from the maximum margin principle and its primal/dual optimization formulation, through the kernel trick that enables non-linear decision boundaries, to the soft-margin extension controlled by the C parameter. You will implement SVMs with multiple kernels for forex regime classification and develop intuition for hyperparameter tuning in financial time series contexts.",
                    keyTakeaways: [
                        "Derive the maximum margin classifier as a constrained optimization problem: min ½||w||² subject to yᵢ(wᵀxᵢ + b) ≥ 1",
                        "Convert the primal to the dual formulation via the Lagrangian and understand why only support vectors determine the decision boundary",
                        "Apply the kernel trick to replace dot products xᵢᵀxⱼ with kernel functions K(xᵢ, xⱼ) for non-linear classification without explicit feature mapping",
                        "Compare RBF, polynomial, and linear kernels — understand their mathematical forms and when each is appropriate for financial data",
                        "Tune the soft-margin parameter C to control the bias-variance tradeoff: large C penalizes misclassification (narrow margin), small C allows slack (wide margin)",
                        "Understand how γ in the RBF kernel controls decision boundary complexity — from smooth global boundaries to tight local clusters",
                        "Implement SVM pipelines with StandardScaler, GridSearchCV, and TimeSeriesSplit for proper forex regime classification",
                        "Recognize when SVMs are preferred over tree-based methods — high-dimensional spaces, clear margin of separation, and smaller datasets"
                    ]
                },
                {
                    type: "theory" as const,
                    title: "Maximum Margin Derivation (Primal Formulation)",
                    content: "The fundamental idea behind SVMs is elegantly geometric: given two linearly separable classes, there exist infinitely many hyperplanes that separate them, but only one that maximizes the margin — the distance between the hyperplane and the nearest data points from each class. This optimal hyperplane is the maximum margin classifier, and it provides the best generalization guarantee among all linear separators.\n\nConsider a hyperplane defined by w·x + b = 0, where w is the normal vector and b is the bias. For any point xᵢ, its distance to this hyperplane is |w·xᵢ + b| / ||w||. For correctly classified points with labels yᵢ ∈ {-1, +1}, we have yᵢ(w·xᵢ + b) > 0. We can rescale w and b so that the closest points satisfy |w·xᵢ + b| = 1, giving a geometric margin of 2/||w||. Maximizing 2/||w|| is equivalent to minimizing ||w||, or more conveniently, minimizing ½||w||².\n\nThis gives us the primal optimization problem:\n\n  minimize  ½||w||²\n  subject to  yᵢ(wᵀxᵢ + b) ≥ 1  for all i = 1, ..., n\n\nThis is a convex quadratic program with linear constraints — it has a unique global solution. The constraints ensure every training point is on the correct side of the margin. Points exactly on the margin boundary (where yᵢ(wᵀxᵢ + b) = 1) are the support vectors — they alone determine the position and orientation of the optimal hyperplane.\n\nNumerical Example: Consider 4 points in 2D:\n  Class +1: x₁ = (2, 3), x₂ = (3, 3)\n  Class -1: x₃ = (0, 0), x₄ = (1, 0)\n\nThe optimal separating hyperplane turns out to be approximately w = (0.4, 0.6), b = -1.0 (after rescaling so the margin constraints are tight). The support vectors are x₁ = (2,3) and x₄ = (1,0) — these are the closest points to the decision boundary from each class. The margin width is 2/||w|| = 2/√(0.16 + 0.36) = 2/√0.52 ≈ 2.77. Notice that x₂ and x₃ do not affect the solution — only the support vectors matter. If we removed x₂ and x₃ entirely, the same hyperplane would be found.\n\nThis property — that the solution depends only on a small subset of training points — is what makes SVMs computationally efficient at prediction time and robust to outliers far from the decision boundary. In forex regime classification, this means the model focuses on the ambiguous transitions between regimes rather than the obvious interior points."
                },
                {
                    type: "theory" as const,
                    title: "Dual Formulation via the Lagrangian",
                    content: "The dual formulation of the SVM is not merely a mathematical curiosity — it is the key that unlocks the kernel trick and makes non-linear SVMs possible. We derive it by introducing Lagrange multipliers αᵢ ≥ 0 for each constraint.\n\nThe Lagrangian is:\n\n  L(w, b, α) = ½||w||² - Σᵢ αᵢ[yᵢ(wᵀxᵢ + b) - 1]\n\nTo find the saddle point, we take partial derivatives and set them to zero:\n\n  ∂L/∂w = 0  →  w = Σᵢ αᵢyᵢxᵢ\n  ∂L/∂b = 0  →  Σᵢ αᵢyᵢ = 0\n\nThe first condition tells us that the optimal weight vector is a linear combination of the training points, weighted by αᵢyᵢ. The second condition constrains the multipliers to maintain balance between classes. We substitute these back into the Lagrangian to eliminate w and b.\n\nSubstituting w = Σᵢ αᵢyᵢxᵢ into L:\n\n  L = ½(Σᵢ αᵢyᵢxᵢ)ᵀ(Σⱼ αⱼyⱼxⱼ) - Σᵢ αᵢyᵢ(Σⱼ αⱼyⱼxⱼ)ᵀxᵢ - b·Σᵢ αᵢyᵢ + Σᵢ αᵢ\n\nSince Σᵢ αᵢyᵢ = 0, the b term vanishes. Simplifying the remaining terms yields the dual:\n\n  maximize  W(α) = Σᵢ αᵢ - ½ΣᵢΣⱼ αᵢαⱼyᵢyⱼxᵢᵀxⱼ\n  subject to  αᵢ ≥ 0 for all i,  Σᵢ αᵢyᵢ = 0\n\nThe KKT (Karush-Kuhn-Tucker) complementarity conditions require that αᵢ[yᵢ(wᵀxᵢ + b) - 1] = 0 for every i. This means either αᵢ = 0 (the point is not a support vector and does not influence the solution) or yᵢ(wᵀxᵢ + b) = 1 (the point lies exactly on the margin and is a support vector). Points with αᵢ > 0 are support vectors — typically a small fraction of the training set.\n\nThe critical observation is that the dual objective depends on the data only through dot products xᵢᵀxⱼ. At prediction time, the decision function is f(x) = sign(Σᵢ αᵢyᵢxᵢᵀx + b), which also uses only dot products. This dot-product dependence is the gateway to the kernel trick — we can replace these dot products with any valid kernel function without ever computing coordinates in the high-dimensional feature space."
                },
                {
                    type: "theory" as const,
                    title: "The Kernel Trick: Non-Linear Classification",
                    content: "The kernel trick is one of the most elegant ideas in machine learning. Since the dual formulation and the decision function depend on the data only through dot products xᵢᵀxⱼ, we can implicitly map the data to a higher-dimensional feature space using a mapping φ(x), and compute dot products in that space without ever constructing φ(x) explicitly. We simply replace xᵢᵀxⱼ with K(xᵢ, xⱼ) = φ(xᵢ)ᵀφ(xⱼ).\n\nThe Radial Basis Function (RBF) kernel is the most widely used:\n\n  K(x, x') = exp(-γ||x - x'||²)\n\nRemarkably, the RBF kernel corresponds to mapping data into an infinite-dimensional feature space. The parameter γ > 0 controls how quickly similarity decays with distance — large γ means only very close points are considered similar (complex, localized boundaries), while small γ means distant points still have influence (smooth, global boundaries).\n\nThe polynomial kernel is:\n\n  K(x, x') = (xᵀx' + c)ᵈ\n\nwhere d is the polynomial degree and c ≥ 0 is a free parameter. For d = 2 and c = 1 in 2D, this implicitly maps (x₁, x₂) to the 6-dimensional space (x₁², x₂², √2·x₁x₂, √(2c)·x₁, √(2c)·x₂, c). Higher-degree kernels capture more complex interactions but risk overfitting.\n\nFor a kernel function to be valid, it must satisfy Mercer's condition: the kernel matrix K where Kᵢⱼ = K(xᵢ, xⱼ) must be positive semi-definite for any set of points. Both the RBF and polynomial kernels satisfy this condition, guaranteeing that the dual optimization problem remains convex.\n\nNumerical Example — RBF Kernel: Let x = (1, 2) and x' = (3, 1) with γ = 0.5.\n\n  ||x - x'||² = (1-3)² + (2-1)² = 4 + 1 = 5\n  K(x, x') = exp(-0.5 × 5) = exp(-2.5) ≈ 0.0821\n\nThis value of 0.0821 means x and x' are moderately dissimilar in the RBF feature space. If γ were 0.1 instead, K = exp(-0.5) ≈ 0.6065 — much more similar. This demonstrates how γ controls the notion of neighborhood. In forex applications, small γ creates smooth regime boundaries that respond to broad market structure, while large γ creates tight boundaries that react to local microstructure patterns."
                },
                {
                    type: "theory" as const,
                    title: "Soft Margins, the C Parameter, and SMO",
                    content: "Real-world data is rarely linearly separable, even in a kernel-induced feature space. The soft-margin SVM introduces slack variables ξᵢ ≥ 0 that allow some points to violate the margin or even be misclassified. The modified primal becomes:\n\n  minimize  ½||w||² + C · Σᵢ ξᵢ\n  subject to  yᵢ(wᵀxᵢ + b) ≥ 1 - ξᵢ,  ξᵢ ≥ 0  for all i\n\nThe parameter C > 0 controls the penalty for margin violations. When ξᵢ = 0, the point is correctly classified outside the margin. When 0 < ξᵢ < 1, the point is correctly classified but inside the margin. When ξᵢ ≥ 1, the point is misclassified. The total cost of violations is C · Σᵢ ξᵢ, so C acts as a regularization parameter.\n\nIn the dual formulation, the only change is that αᵢ is now bounded: αᵢ ∈ [0, C] instead of αᵢ ≥ 0. Support vectors fall into two categories: those with 0 < αᵢ < C lie exactly on the margin, and those with αᵢ = C are margin violators (inside the margin or misclassified). The bias-variance tradeoff is controlled directly by C:\n\n  • Large C → heavy penalty for violations → narrow margin → fewer margin violations → low bias, high variance (risk of overfitting)\n  • Small C → light penalty for violations → wide margin → more margin violations → high bias, low variance (risk of underfitting)\n\nThe Sequential Minimal Optimization (SMO) algorithm, introduced by John Platt in 1998, is the standard method for solving the SVM dual. SMO breaks the large QP problem into the smallest possible sub-problems — optimizing just two αᵢ at a time (the minimum because of the equality constraint Σαᵢyᵢ = 0). At each step, SMO selects two multipliers using heuristics (typically maximum violating pair), analytically solves the two-variable sub-problem (which has a closed-form solution), and clips the result to satisfy the box constraints 0 ≤ αᵢ ≤ C. This makes SVM training feasible for datasets with tens of thousands of points.\n\nFor forex regime classification, C should be tuned via cross-validation with TimeSeriesSplit. Financial data is noisy, so moderate C values (1-100) often work best — aggressive C values overfit to noise in price action, while very small C values produce overly smooth regime boundaries that miss genuine transitions."
                },
                {
                    type: "intuition" as const,
                    title: "The Canyon Between Two Towns",
                    analogy: "Imagine two towns on opposite sides of a mountain range, and you need to draw the border between them. You could draw the border anywhere in the gap between the outermost buildings — but the wisest choice is to carve it through the widest possible canyon. This way, even if a few new buildings are constructed, the border still separates the towns correctly.",
                    content: "The SVM is this canyon-carving algorithm. The two towns are the two classes of data points. The buildings at the canyon's edge — the closest ones to the border — are the support vectors. Only these edge buildings matter for defining the border; buildings deep inside each town have no effect.\n\nThe C parameter is the town planner's tolerance for encroachment. A strict planner (large C) insists no building can extend past the canyon rim — the canyon is narrow but perfectly clean. A lenient planner (small C) allows a few buildings to jut into the canyon or even across the border — the canyon is wider but messier.\n\nNow imagine the two towns are interleaved on a flat plain — no canyon can separate them in 2D. The kernel trick is like lifting the terrain into 3D, raising one town's buildings on a hill while the other stays in the valley. Suddenly a horizontal plane cleanly separates them. The RBF kernel creates smooth rolling hills, while the polynomial kernel creates terraced plateaus. You never actually build the 3D model — you just measure distances between buildings as if you had.",
                    emoji: "🏔️"
                },
                {
                    type: "intuition" as const,
                    title: "The Force Field Analogy",
                    analogy: "Think of each support vector as a transmitter emitting a force field. Positive support vectors emit an attractive field (pulling predictions toward +1), and negative support vectors emit a repulsive field (pushing predictions toward -1). The decision boundary is where these opposing fields exactly cancel out.",
                    content: "The RBF kernel defines how each support vector's force field fades with distance. The parameter γ controls the radius of influence — it is the inverse of the broadcast range.\n\nWith small γ, each transmitter has a wide broadcast range. Its field extends far across the feature space, influencing distant points. The resulting decision boundary is smooth and global, shaped by the collective influence of all support vectors. This is like a few powerful radio towers covering an entire region — the coverage is broad but cannot capture fine local detail.\n\nWith large γ, each transmitter has a tight, localized field. It only affects points in its immediate neighborhood. The decision boundary becomes complex and wiggly, wrapping tightly around each cluster of support vectors. This is like many small Wi-Fi routers — each covers a tiny area with high fidelity, but the overall coverage map is fragmented and complex.\n\nIn forex markets, small γ creates regime boundaries that respond to broad structural shifts (trending → ranging), while large γ creates boundaries sensitive to short-term microstructure changes. The sweet spot — found via cross-validation — balances these extremes for robust regime detection.",
                    emoji: "⚡"
                },
                {
                    type: "code" as const,
                    title: "SVM Maximum Margin Visualization",
                    language: "python" as const,
                    code: `import numpy as np
from sklearn.svm import SVC

# Generate synthetic 2D data: two linearly separable clusters
np.random.seed(42)
X_pos = np.random.randn(20, 2) + np.array([2, 2])
X_neg = np.random.randn(20, 2) + np.array([-2, -2])
X = np.vstack([X_pos, X_neg])
y = np.array([1]*20 + [-1]*20)

# Fit a linear SVM with hard-ish margin
svm = SVC(kernel='linear', C=1e6)
svm.fit(X, y)

# Extract model parameters
w = svm.coef_[0]
b = svm.intercept_[0]
support_vectors = svm.support_vectors_
n_sv = svm.n_support_

print("=== SVM Maximum Margin Results ===")
print(f"Weight vector w: [{w[0]:.4f}, {w[1]:.4f}]")
print(f"Bias b: {b:.4f}")
print(f"||w||: {np.linalg.norm(w):.4f}")

# Margin width = 2 / ||w||
margin_width = 2.0 / np.linalg.norm(w)
print(f"Margin width: {margin_width:.4f}")
print(f"Support vectors per class: {n_sv}")
print(f"Total support vectors: {len(support_vectors)} out of {len(X)} points")

# Print support vector coordinates
print("\\nSupport vector coordinates:")
for i, sv in enumerate(support_vectors):
    distance = abs(np.dot(w, sv) + b) / np.linalg.norm(w)
    print(f"  SV {i+1}: ({sv[0]:.3f}, {sv[1]:.3f}), "
          f"distance to hyperplane: {distance:.4f}")

# Decision boundary: w[0]*x1 + w[1]*x2 + b = 0
# Solve for x2: x2 = -(w[0]*x1 + b) / w[1]
x1_range = np.linspace(-5, 5, 100)
x2_boundary = -(w[0] * x1_range + b) / w[1]
x2_margin_pos = -(w[0] * x1_range + b - 1) / w[1]
x2_margin_neg = -(w[0] * x1_range + b + 1) / w[1]

print(f"\\nDecision boundary at x1=0: x2 = {-b/w[1]:.4f}")
print(f"Positive margin at x1=0:   x2 = {(-b+1)/w[1]:.4f}")
print(f"Negative margin at x1=0:   x2 = {(-b-1)/w[1]:.4f}")

# Verify: all points satisfy margin constraint
margins = y * (X @ w + b)
print(f"\\nMin functional margin: {margins.min():.4f} (should be ≥ 1.0)")
print(f"All constraints satisfied: {np.all(margins >= 0.999)}")`,
                    explanation: "This code demonstrates the core SVM concept: finding the maximum margin hyperplane. We generate two well-separated 2D clusters and fit a linear SVM with very large C (approximating hard margin). The weight vector w is the normal to the decision boundary, and the margin width is 2/||w||. We extract the support vectors — the critical subset of points that define the decision boundary — and verify they lie exactly on the margin. Notice that out of 40 total points, only a handful are support vectors, illustrating the SVM's efficiency. The functional margin yᵢ(wᵀxᵢ + b) should be ≥ 1 for all points."
                },
                {
                    type: "code" as const,
                    title: "SVM with RBF Kernel for Regime Classification",
                    language: "python" as const,
                    code: `import numpy as np
import pandas as pd
from sklearn.svm import SVC
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import GridSearchCV, TimeSeriesSplit
from sklearn.metrics import classification_report, accuracy_score

# Simulate forex regime features (replace with real features)
np.random.seed(42)
n_samples = 500
features = {
    'volatility_ratio': np.random.randn(n_samples),
    'trend_strength': np.random.randn(n_samples),
    'mean_reversion_score': np.random.randn(n_samples),
    'volume_zscore': np.random.randn(n_samples),
    'rsi_normalized': np.random.randn(n_samples),
}
X = pd.DataFrame(features)
# Regime labels: 0=ranging, 1=trending, 2=volatile
y = np.random.choice([0, 1, 2], size=n_samples, p=[0.4, 0.35, 0.25])

# Time-series aware train/test split (last 20% for test)
split_idx = int(0.8 * n_samples)
X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
y_train, y_test = y[:split_idx], y[split_idx:]

# SVM pipeline with standardization (critical for SVMs)
pipeline = Pipeline([
    ('scaler', StandardScaler()),
    ('svm', SVC(kernel='rbf', decision_function_shape='ovr'))
])

# GridSearchCV with TimeSeriesSplit for proper temporal CV
param_grid = {
    'svm__C': [0.1, 1.0, 10.0, 100.0],
    'svm__gamma': ['scale', 0.01, 0.1, 1.0],
}
tscv = TimeSeriesSplit(n_splits=5)
grid_search = GridSearchCV(
    pipeline, param_grid, cv=tscv,
    scoring='accuracy', n_jobs=-1, verbose=0
)
grid_search.fit(X_train, y_train)

print("=== SVM RBF Regime Classification ===")
print(f"Best parameters: {grid_search.best_params_}")
print(f"Best CV accuracy: {grid_search.best_score_:.4f}")

# Evaluate on test set
y_pred = grid_search.predict(X_test)
print(f"Test accuracy: {accuracy_score(y_test, y_pred):.4f}")
print(f"\\nClassification Report:")
print(classification_report(
    y_test, y_pred,
    target_names=['Ranging', 'Trending', 'Volatile']
))

# Support vector analysis
best_svm = grid_search.best_estimator_.named_steps['svm']
print(f"Total support vectors: {best_svm.n_support_.sum()}")
print(f"Support vectors per class: {dict(zip(['Ranging','Trending','Volatile'], best_svm.n_support_))}")
sv_ratio = best_svm.n_support_.sum() / len(X_train)
print(f"SV ratio: {sv_ratio:.2%} of training data")
print(f"  (High ratio suggests complex boundary or noisy data)")`,
                    explanation: "This pipeline demonstrates production-ready SVM regime classification. Key details: (1) StandardScaler is essential — SVMs are sensitive to feature scales because the kernel measures distances; unscaled features with large ranges dominate the kernel computation. (2) GridSearchCV with TimeSeriesSplit ensures we never leak future data into training folds. (3) We search over C (regularization strength) and γ (RBF bandwidth). (4) The support vector ratio is a diagnostic: if nearly all training points are support vectors, the model may be underfitting (C too small) or the data may be inherently noisy. For forex data, SV ratios of 30-60% are common due to market noise."
                },
                {
                    type: "code" as const,
                    title: "Kernel Comparison: Linear vs RBF vs Polynomial",
                    language: "python" as const,
                    code: `import numpy as np
from sklearn.svm import SVC
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import cross_val_score, TimeSeriesSplit

# Synthetic regime data with non-linear structure
np.random.seed(42)
n = 400
X = np.random.randn(n, 5)
# Non-linear regime boundary
y = ((X[:, 0]**2 + X[:, 1]**2 > 2) |
     (X[:, 2] * X[:, 3] > 0.5)).astype(int)

tscv = TimeSeriesSplit(n_splits=5)
kernels = {
    'Linear': SVC(kernel='linear', C=1.0),
    'RBF': SVC(kernel='rbf', C=10.0, gamma='scale'),
    'Polynomial (d=2)': SVC(kernel='poly', degree=2, C=10.0, coef0=1),
    'Polynomial (d=3)': SVC(kernel='poly', degree=3, C=10.0, coef0=1),
}

print("=== Kernel Comparison ===")
print(f"{'Kernel':<20} {'CV Accuracy':>12} {'Std':>8} {'# SVs':>8} {'SV %':>8}")
print("-" * 60)

for name, svm in kernels.items():
    pipe = Pipeline([('scaler', StandardScaler()), ('svm', svm)])
    scores = cross_val_score(pipe, X, y, cv=tscv, scoring='accuracy')
    # Fit on full data to get support vector count
    pipe.fit(X, y)
    n_sv = pipe.named_steps['svm'].n_support_.sum()
    sv_pct = n_sv / len(X) * 100

    print(f"{name:<20} {scores.mean():>12.4f} {scores.std():>8.4f} "
          f"{n_sv:>8d} {sv_pct:>7.1f}%")

print("\\n--- Interpretation ---")
print("• Linear kernel struggles with non-linear boundaries")
print("• RBF adapts to arbitrary non-linear structure")
print("• Polynomial kernels capture interaction terms explicitly")
print("• Fewer support vectors → simpler model, faster prediction")
print("• Higher SV% may indicate underfitting or noisy features")`,
                    explanation: "This comparison reveals how kernel choice affects SVM performance on non-linear data. The synthetic data has a boundary defined by quadratic and interaction terms — precisely the kind of structure that linear kernels miss but RBF and polynomial kernels capture. The number of support vectors is a model complexity indicator: fewer SVs means a simpler, faster model. For forex regime classification, start with RBF (most flexible), then try polynomial if you believe regime boundaries follow specific interaction patterns between features. Linear SVMs are appropriate only when you suspect regimes are linearly separable in feature space."
                },
                {
                    type: "quiz" as const,
                    questions: [
                        {
                            id: "cml-svm-q1",
                            text: "What does the kernel trick accomplish in Support Vector Machines?",
                            options: [
                                { id: "cml-svm-q1-a", text: "It reduces the number of training samples needed to fit the model" },
                                { id: "cml-svm-q1-b", text: "It computes dot products in a high-dimensional feature space without explicitly mapping data to that space" },
                                { id: "cml-svm-q1-c", text: "It converts the SVM from a classification algorithm to a regression algorithm" },
                                { id: "cml-svm-q1-d", text: "It automatically selects the optimal value of the regularization parameter C" }
                            ],
                            correctOptionId: "cml-svm-q1-b",
                            explanation: "The kernel trick replaces dot products xᵢᵀxⱼ in the dual formulation with K(xᵢ, xⱼ) = φ(xᵢ)ᵀφ(xⱼ), computing inner products in a high-dimensional (possibly infinite-dimensional) feature space without ever constructing the explicit mapping φ(x). This allows non-linear decision boundaries in the original space while keeping the optimization problem tractable. For the RBF kernel, the implicit feature space is infinite-dimensional, yet kernel evaluations cost O(d) where d is the input dimension."
                        },
                        {
                            id: "cml-svm-q2",
                            text: "Given a 2D dataset with Class +1 points at (3, 1) and (4, 2), and Class -1 points at (0, 0) and (1, -1), which points are most likely the support vectors for a hard-margin linear SVM?",
                            options: [
                                { id: "cml-svm-q2-a", text: "(4, 2) and (0, 0) — the points farthest from the center" },
                                { id: "cml-svm-q2-b", text: "(3, 1) and (1, -1) — the points closest to the decision boundary" },
                                { id: "cml-svm-q2-c", text: "All four points — every point is a support vector" },
                                { id: "cml-svm-q2-d", text: "(3, 1) and (0, 0) — one random point from each class" }
                            ],
                            correctOptionId: "cml-svm-q2-b",
                            explanation: "Support vectors are the points closest to the decision boundary — they lie exactly on the margin. The point (3, 1) from Class +1 and (1, -1) from Class -1 are the nearest opposing points. The decision boundary passes midway between them, and the margin is defined by these two points alone. The other points (4, 2) and (0, 0) lie farther from the boundary and could be removed without changing the solution. By the KKT conditions, only support vectors have non-zero Lagrange multipliers αᵢ > 0."
                        },
                        {
                            id: "cml-svm-q3",
                            text: "What is the effect of increasing the C parameter in a soft-margin SVM?",
                            options: [
                                { id: "cml-svm-q3-a", text: "The margin becomes wider, allowing more misclassifications and reducing model complexity" },
                                { id: "cml-svm-q3-b", text: "The margin becomes narrower, penalizing misclassifications more heavily and increasing model complexity" },
                                { id: "cml-svm-q3-c", text: "The kernel function changes from linear to non-linear" },
                                { id: "cml-svm-q3-d", text: "The number of features used by the model decreases automatically" }
                            ],
                            correctOptionId: "cml-svm-q3-b",
                            explanation: "Increasing C increases the penalty for margin violations (slack variables ξᵢ). The optimizer responds by finding a hyperplane with fewer violations, which requires a narrower margin. This reduces bias (the model fits training data more closely) but increases variance (risk of overfitting to noise). In the dual, larger C raises the upper bound on αᵢ ∈ [0, C], allowing individual support vectors to have more influence. For forex data, excessively large C values cause the model to overfit to market noise rather than genuine regime structure."
                        },
                        {
                            id: "cml-svm-q4",
                            text: "Compute the RBF kernel value K(x, x') for points x = (2, 0) and x' = (0, 2) with γ = 0.25.",
                            options: [
                                { id: "cml-svm-q4-a", text: "exp(-2.0) ≈ 0.1353" },
                                { id: "cml-svm-q4-b", text: "exp(-1.0) ≈ 0.3679" },
                                { id: "cml-svm-q4-c", text: "exp(-4.0) ≈ 0.0183" },
                                { id: "cml-svm-q4-d", text: "exp(-0.5) ≈ 0.6065" }
                            ],
                            correctOptionId: "cml-svm-q4-a",
                            explanation: "K(x, x') = exp(-γ||x - x'||²). First compute ||x - x'||² = (2-0)² + (0-2)² = 4 + 4 = 8. Then K = exp(-0.25 × 8) = exp(-2.0) ≈ 0.1353. This moderate similarity value indicates the points are somewhat different in the RBF feature space. Note that changing γ dramatically affects this: with γ = 0.5, K = exp(-4) ≈ 0.018 (very dissimilar); with γ = 0.1, K = exp(-0.8) ≈ 0.449 (fairly similar)."
                        },
                        {
                            id: "cml-svm-q5",
                            text: "In which scenario would SVMs likely be preferred over tree-based methods (Random Forest, XGBoost) for forex regime classification?",
                            options: [
                                { id: "cml-svm-q5-a", text: "When you have millions of training samples and need fast training" },
                                { id: "cml-svm-q5-b", text: "When you need built-in feature importance rankings for interpretability" },
                                { id: "cml-svm-q5-c", text: "When the dataset is moderate-sized, features are well-engineered, and regimes have clear geometric separation in feature space" },
                                { id: "cml-svm-q5-d", text: "When the feature set contains many categorical variables with high cardinality" }
                            ],
                            correctOptionId: "cml-svm-q5-c",
                            explanation: "SVMs excel when the dataset is moderate-sized (hundreds to low thousands of samples), features are numeric and well-scaled, and there is genuine geometric separation between classes in feature space. The maximum margin principle provides strong generalization when clear margins exist. Tree-based methods are preferred for very large datasets (SVM training is O(n²) to O(n³)), categorical features, and when feature importance is needed. For forex, SVMs work well when regime features like volatility ratios and trend strength create distinct clusters in feature space."
                        },
                        {
                            id: "cml-svm-q6",
                            text: "What happens to the SVM decision boundary if γ in the RBF kernel is set to a very large value?",
                            options: [
                                { id: "cml-svm-q6-a", text: "The boundary becomes a smooth, nearly linear surface with low variance" },
                                { id: "cml-svm-q6-b", text: "The boundary becomes highly complex, tightly wrapping around individual training points, leading to overfitting" },
                                { id: "cml-svm-q6-c", text: "The model becomes equivalent to a k-nearest neighbor classifier with k=1" },
                                { id: "cml-svm-q6-d", text: "The kernel matrix becomes the identity matrix, making all points equidistant" }
                            ],
                            correctOptionId: "cml-svm-q6-b",
                            explanation: "Very large γ makes the RBF kernel value K(x, x') = exp(-γ||x-x'||²) drop to near-zero for all but the closest neighbors. Each support vector's influence is confined to a tiny neighborhood. The decision boundary wraps tightly around individual points or small clusters, creating an extremely complex surface that memorizes training data rather than capturing the true regime structure. In the limit as γ → ∞, each point becomes its own island — the model overfits catastrophically. This is the equivalent of the force field analogy: each transmitter's range shrinks to nearly zero."
                        }
                    ]
                },
                {
                    type: "practice" as const,
                    title: "Guided: SVM Regime Classifier with Kernel Comparison",
                    description: "Train an SVM-based forex regime classifier using the pre-computed feature set. Start with a linear kernel as a baseline, then compare RBF and polynomial (degree 2 and 3) kernels. Use sklearn's Pipeline with StandardScaler to ensure proper feature scaling. Perform hyperparameter tuning with GridSearchCV over C ∈ {0.1, 1, 10, 100} and γ ∈ {0.001, 0.01, 0.1, 'scale'}, using TimeSeriesSplit with 5 folds to respect temporal ordering. For each kernel, record: (1) best cross-validation accuracy, (2) test set accuracy, (3) number of support vectors per class, and (4) the support vector ratio. Analyze which kernel captures the regime structure best and whether the SV ratio suggests overfitting or underfitting. Submit your best model for evaluation against the benchmark regime labels.",
                    catalogModelId: "svm-regime"
                },
                {
                    type: "practice" as const,
                    title: "Open-Ended: Decision Boundary Exploration",
                    description: "Using the interactive dashboard, explore how SVM decision boundaries change as you vary C and γ on a 2D projection of regime features. Start with C = 1.0 and γ = 'scale', then systematically increase C to 1000 and observe how the margin narrows. Reset C to 1.0 and increase γ from 0.01 to 10, watching the boundary transition from a smooth global curve to a complex, localized surface that wraps around individual clusters. Identify the γ value where the boundary begins to overfit (wrapping around noise points). Experiment with the polynomial kernel at degrees 2, 3, and 4 — observe how higher degrees create more flexible boundaries but also more erratic behavior in low-density regions. Document your observations: What C and γ combination produces the most visually interpretable regime separation? How does the margin width relate to the number of support vectors? At what point does increasing model complexity stop improving and start degrading the boundary quality?"
                }
            ]
        }
,
    {
        id: "cml-knn-naive-bayes",
        title: "KNN & Naive Bayes for Market Classification",
        description: "Master two fundamentally different classification approaches: K-Nearest Neighbors (KNN), an instance-based method that classifies by proximity using distance metrics like Euclidean, Manhattan, and Mahalanobis, and Naive Bayes (NB), a probabilistic generative classifier built on Bayes' theorem with the naive conditional independence assumption. Explore why KNN suffers from the curse of dimensionality — where high-dimensional feature spaces cause distance metrics to lose discriminative power — and how Naive Bayes sidesteps this by factorizing the joint likelihood into per-feature terms. Apply both methods to forex direction prediction, comparing their strengths: KNN captures complex local decision boundaries but scales poorly, while Gaussian NB trains instantly and generalizes well when features are roughly independent. Understand when each classifier excels and how to combine their complementary failure modes for robust market classification.",
        estimatedMinutes: 75,
        difficulty: "intermediate",
        prerequisites: ["cml-linear-models"],
        sections: [
            {
                type: "objective",
                content: "By the end of this lesson, you will understand the mathematical foundations of K-Nearest Neighbors and Naive Bayes classifiers, including distance metrics, the curse of dimensionality, Bayes' theorem derivation, and the naive independence assumption. You will implement both algorithms from scratch in Python, apply them to forex direction prediction with walk-forward cross-validation, and develop intuition for when each method excels or fails in financial market classification tasks.",
                keyTakeaways: [
                    "Compute and compare Euclidean, Manhattan, and Mahalanobis distances and understand how feature scaling affects each metric",
                    "Explain the curse of dimensionality mathematically: why the volume of a hypersphere concentrates in its outer shell and how this degrades KNN performance",
                    "Derive Bayes' theorem from joint probability and apply the naive independence assumption to reduce parameter complexity from exponential to linear",
                    "Implement Gaussian Naive Bayes from scratch — computing class priors, per-class means and variances, and posterior probabilities via the Bayes rule",
                    "Build a complete KNN vs GaussianNB comparison pipeline for forex direction prediction using TimeSeriesSplit walk-forward cross-validation",
                    "Identify when Naive Bayes outperforms KNN despite violating the independence assumption, and when correlated features like RSI and Stochastic %K cause double-counting",
                    "Distinguish between discriminative classifiers (logistic regression) and generative classifiers (Naive Bayes) and articulate the bias-variance tradeoffs of each"
                ]
            },
            {
                type: "theory",
                title: "KNN Distance Metrics",
                content: "K-Nearest Neighbors classifies a query point x by finding the k closest training examples and taking a majority vote (classification) or average (regression) of their labels. The entire model is the training data itself — there are no learned parameters. This makes KNN an instance-based or lazy learning algorithm. The critical design choice is the distance metric, which determines what \"closest\" means.\n\nThe most common metric is Euclidean distance: d(x, x') = √Σⱼ(xⱼ - x'ⱼ)². This measures straight-line distance in p-dimensional space. Manhattan distance uses absolute differences instead: d(x, x') = Σⱼ|xⱼ - x'ⱼ|. Manhattan is more robust to outliers because it doesn't square the differences — a single large deviation in one feature dominates Euclidean distance but contributes linearly to Manhattan.\n\nMahalanobis distance accounts for feature correlations: d(x, x') = √((x - x')ᵀ S⁻¹ (x - x')), where S is the covariance matrix. This effectively transforms the space so that correlated features don't get double-counted. In forex, if RSI and Stochastic %K have correlation ρ = 0.85, Euclidean distance treats them as independent axes, effectively double-weighting the momentum signal. Mahalanobis corrects for this by rotating and scaling the feature space.\n\nNumerical example: consider two points in 3D feature space — x = [0.5, 100, 1.2] (normalized return, volume, ATR) and x' = [0.8, 250, 1.5]. Euclidean distance: √((0.3)² + (150)² + (0.3)²) = √(0.09 + 22500 + 0.09) ≈ 150.0. The volume feature completely dominates! Manhattan distance: 0.3 + 150 + 0.3 = 150.6 — same problem. After z-score scaling (subtract mean, divide by std), if the scaled values become x = [−0.2, −0.5, 0.1] and x' = [0.4, 0.8, 0.6], then Euclidean distance = √(0.36 + 1.69 + 0.25) ≈ 1.52. Now all features contribute proportionally. This is why feature scaling is mandatory for KNN.\n\nWeighted KNN improves on uniform voting by assigning each neighbor a weight inversely proportional to its distance: wᵢ = 1/d(x, xᵢ). Closer neighbors get more influence. This reduces sensitivity to the choice of k because distant neighbors (which are more likely to have different labels) contribute less. In practice, distance-weighted KNN with k = 10–20 often outperforms uniform KNN with a carefully tuned k, because the weighting effectively adapts the neighborhood size to local density."
            },
            {
                type: "theory",
                title: "The Curse of Dimensionality",
                content: "KNN's performance degrades dramatically as the number of features grows. This phenomenon — the curse of dimensionality — is not just an empirical observation but a mathematical certainty. Understanding the geometry of high-dimensional spaces explains why.\n\nThe volume of a unit hypersphere (radius 1) in d dimensions is V_d = π^(d/2) / Γ(d/2 + 1). For d = 2, V₂ = π ≈ 3.14. For d = 3, V₃ = 4π/3 ≈ 4.19. But the volume peaks around d = 5 and then collapses: V₁₀ ≈ 2.55, V₂₀ ≈ 0.0258. The unit hypersphere occupies a vanishing fraction of the unit hypercube (which always has volume 1). In d = 10, the sphere fills only about 0.25% of the cube — almost all points in the cube lie in the \"corners\" far from the center.\n\nThe concentration of volume in the outer shell is even more striking. The fraction of volume in the outer shell of thickness ε is 1 − (1 − ε)^d. For d = 10 and ε = 0.5 (outer 50% of the radius), this fraction is 1 − 0.5¹⁰ = 1 − 0.000977 ≈ 0.999. So 99.9% of the volume lies in the outer half-shell. For d = 20, it is 1 − 0.5²⁰ ≈ 0.999999. Every data point is near the surface; there is no meaningful interior.\n\nThis has devastating consequences for KNN. The ratio of the distance to the nearest neighbor (d_near) to the farthest neighbor (d_far) converges to 1 as d → ∞. Formally, for n points uniformly distributed in a d-dimensional unit cube: E[d_near/d_far] → 1 as d → ∞. When all distances are approximately equal, the concept of \"nearest\" neighbor becomes meaningless — every point is equally close to (or far from) every other point.\n\nConcrete comparison: with n = 1000 training points, in d = 2, the average distance to the nearest neighbor is approximately n^(−1/d) = 1000^(−0.5) ≈ 0.032 (about 3% of the feature range). In d = 20, it is 1000^(−1/20) ≈ 1000^(−0.05) ≈ 0.708 — the nearest neighbor is 71% of the feature range away! To maintain the same neighborhood density (nearest neighbor at 3% of range) in d = 20, you would need n = (0.032)^(−20) ≈ 10³⁰ training points. This is astronomically more data than exists in all of financial history. The practical implication: with typical forex datasets of ~5000 daily bars, KNN becomes unreliable beyond about 5–8 features."
            },
            {
                type: "theory",
                title: "Bayes' Theorem — Full Derivation",
                content: "Bayes' theorem follows directly from the definition of conditional probability. The joint probability of x and y can be factored two ways: P(x, y) = P(x|y)P(y) = P(y|x)P(x). Setting these equal and solving for the posterior: P(y|x) = P(x|y)P(y) / P(x). Here P(y) is the prior (class probability before seeing features), P(x|y) is the likelihood (probability of observing features x given class y), P(x) is the evidence (normalizing constant), and P(y|x) is the posterior (what we want — class probability after seeing features).\n\nFor classification with p features, the likelihood P(x₁, x₂, ..., xₚ | y) is a joint distribution over all features given the class. Estimating this joint distribution requires exponential parameters: for binary features, P(x|y) has 2ᵖ − 1 free parameters per class. With p = 20 features, that is over a million parameters per class — far too many to estimate from finite data.\n\nThe naive independence assumption resolves this: P(x₁, x₂, ..., xₚ | y) = ∏ⱼ P(xⱼ | y). Each feature is conditionally independent of every other feature given the class label. This reduces parameters from O(2ᵖ) to O(p) per class — for binary features, just p parameters per class instead of 2ᵖ − 1. For Gaussian features, each P(xⱼ | y = c) = N(μⱼc, σ²ⱼc) requires only 2 parameters (mean and variance), giving 2 × p × C total parameters.\n\nNumerical example: two features (RSI, ATR_ratio), two classes (up = 1, down = 0). Training data gives: Class 1 (up): μ₁₁ = 55, σ₁₁ = 10, μ₂₁ = 1.1, σ₂₁ = 0.3, prior P(y=1) = 0.52. Class 0 (down): μ₁₀ = 45, σ₁₀ = 12, μ₂₀ = 1.4, σ₂₀ = 0.4, prior P(y=0) = 0.48. For a test point x = [52, 1.2]: P(RSI=52|up) = N(52; 55, 10²) = (1/√(2π·100)) · exp(−(52−55)²/200) ≈ 0.0381. P(ATR=1.2|up) = N(1.2; 1.1, 0.3²) = (1/√(2π·0.09)) · exp(−(1.2−1.1)²/0.18) ≈ 1.2098. Likelihood for up: 0.0381 × 1.2098 ≈ 0.04609. Joint: 0.04609 × 0.52 ≈ 0.02397. Similarly for down: P(RSI=52|down) ≈ 0.0319, P(ATR=1.2|down) ≈ 0.8802, likelihood ≈ 0.02808, joint ≈ 0.01348. Posterior: P(up|x) = 0.02397 / (0.02397 + 0.01348) ≈ 0.640. The model predicts 64% probability of an up move.\n\nFor categorical features, Laplace smoothing prevents zero probabilities: P(xⱼ = v | y = c) = (count(xⱼ = v, y = c) + α) / (count(y = c) + α · |Vⱼ|), where α = 1 is standard and |Vⱼ| is the number of unique values for feature j. Without smoothing, a single unseen category-class combination zeros out the entire posterior — a catastrophic failure mode."
            },
            {
                type: "theory",
                title: "When Naive Independence Fails — and Why NB Still Works",
                content: "The naive independence assumption is almost always violated in practice — especially in financial data where indicators are derived from overlapping price windows. RSI and Stochastic %K typically have correlation ρ ≈ 0.85 because both measure momentum over similar lookback periods. When NB treats these as independent, it effectively counts the momentum evidence twice: the posterior becomes P(y|x) ∝ P(RSI|y) · P(Stoch|y) · P(y), but since RSI and Stoch carry nearly the same information, the true likelihood is closer to P(RSI|y) · P(y). The result: NB produces overconfident probabilities that are pushed toward 0 or 1.\n\nDespite producing poorly calibrated probabilities, Naive Bayes often achieves competitive classification accuracy. The key insight is that NB only needs correct ranking, not correct probabilities. If P(y=1|x_A) > P(y=1|x_B) in the NB model whenever the true posterior also has this ordering, then the argmax classification will be correct regardless of the actual probability values. Empirically, the ranking is preserved even under moderate feature correlation because the bias from double-counting affects all classes roughly equally.\n\nThis connects to a fundamental distinction: Naive Bayes is a generative classifier — it models P(x|y) and P(y), then applies Bayes' rule. Logistic regression is a discriminative classifier — it directly models P(y|x) without modeling the feature distribution. Generative models make stronger assumptions (feature distributions, independence) and can perform poorly when those assumptions are violated. But they also need less data to learn, handle missing features gracefully (just drop them from the product), and can detect out-of-distribution inputs by checking P(x). Discriminative models make weaker assumptions and typically achieve higher accuracy given enough data, but they cannot generate synthetic data or handle missing features natively.\n\nIn practice for forex classification: use NB as a fast baseline and for regime detection where speed matters. Use KNN when you have few features (< 8) and sufficient data. If you have many correlated indicators, either decorrelate first (PCA) before applying NB, or use a discriminative model like logistic regression or random forests that can handle correlations directly."
            },
            {
                type: "intuition",
                title: "The Ask Your Neighbors Approach",
                analogy: "KNN is like moving to a new city and asking your nearest neighbors for restaurant recommendations. If your 5 closest neighbors all love the Thai place on 5th Street, you will probably like it too. But scale matters enormously: if you measure \"closeness\" using a map that shows miles on one axis and Yelp ratings on the other, the miles axis will dominate — your \"neighbors\" will be people who live nearby but have wildly different tastes. You need to normalize both scales first. Now imagine the city has 20 dimensions (distance, cuisine preference, budget, spice tolerance, ambiance preference, ...). In this hyperdimensional city, everyone is roughly the same distance from everyone else. Your nearest neighbor is barely closer than a stranger across town. Asking 5 people who are all equally far away gives you essentially a random poll of the entire city — not a local recommendation. This is the curse of dimensionality: in high dimensions, the concept of \"neighbor\" dissolves.",
                content: "This analogy maps directly to KNN mechanics: each resident is a training point, their restaurant preference is the label, and the distance metric defines who counts as a \"neighbor.\" Feature scaling corresponds to making sure all dimensions contribute equally. Distance-weighted voting is like trusting your next-door neighbor's opinion more than someone three blocks away. And the curse of dimensionality is the mathematical reality that in high-dimensional spaces, the ratio of nearest-to-farthest neighbor distance approaches 1, making all points equally (un)informative.",
                emoji: "🏘️"
            },
            {
                type: "intuition",
                title: "The Detective Combining Clues",
                analogy: "Naive Bayes works like a detective who evaluates each piece of evidence independently and then combines them. Suppose there is a crime, and the detective has three clues: a fingerprint match (strong evidence), a motive (moderate evidence), and a shaky alibi (weak evidence). The detective assesses each clue separately — \"Given that the suspect is guilty, how likely is this fingerprint? Given innocence, how likely?\" — then multiplies all the likelihood ratios together. Even if the fingerprint and the DNA evidence are correlated (both come from physical presence), the detective treats them as independent clues. The final probability may be overconfident, but the ranking of suspects — who is most likely guilty — usually stays correct. The detective with \"naive\" evidence combination catches the right suspect almost as often as a sophisticated Bayesian who models all correlations.",
                content: "In this analogy, each clue is a feature, the guilt/innocence determination is the class label, and the independent evaluation of each clue is the naive independence assumption. The key insight is that for classification (picking the most likely class), you only need the ranking of posteriors to be correct, not the exact probability values. Even when clues are correlated — like RSI and Stochastic %K both measuring momentum — the multiplication of likelihoods preserves the correct ordering of classes most of the time. NB produces poorly calibrated probabilities but surprisingly good classifications.",
                emoji: "🔍"
            },
            {
                type: "code",
                title: "Distance Metrics from Scratch",
                language: "python",
                code: `import numpy as np

# Two sample points: [return_pct, volume, atr]
x = np.array([0.5, 100, 1.2])
x_prime = np.array([0.8, 250, 1.5])

# --- Euclidean Distance ---
euclidean = np.sqrt(np.sum((x - x_prime) ** 2))
print(f"Euclidean (raw):      {euclidean:.4f}")  # ~150.0, volume dominates!

# --- Manhattan Distance ---
manhattan = np.sum(np.abs(x - x_prime))
print(f"Manhattan (raw):      {manhattan:.4f}")  # ~150.6, same problem

# --- Z-score scaling ---
# Simulated training stats: mean and std per feature
means = np.array([0.6, 180, 1.3])
stds = np.array([0.3, 80, 0.4])

x_scaled = (x - means) / stds
x_prime_scaled = (x_prime - means) / stds
print(f"\\nScaled x:   {x_scaled}")
print(f"Scaled x':  {x_prime_scaled}")

euclidean_scaled = np.sqrt(np.sum((x_scaled - x_prime_scaled) ** 2))
manhattan_scaled = np.sum(np.abs(x_scaled - x_prime_scaled))
print(f"Euclidean (scaled):   {euclidean_scaled:.4f}")
print(f"Manhattan (scaled):   {manhattan_scaled:.4f}")

# --- Mahalanobis Distance ---
# Covariance matrix from training data (3x3 for 3 features)
# Off-diag: correlation between features
cov_matrix = np.array([
    [0.09,   2.0,  0.05],
    [2.0,  6400.0, 12.0],
    [0.05,  12.0,  0.16]
])

diff = x - x_prime
S_inv = np.linalg.inv(cov_matrix)
mahalanobis = np.sqrt(diff @ S_inv @ diff)
print(f"\\nMahalanobis:          {mahalanobis:.4f}")

# --- Why Mahalanobis corrects for correlation ---
# Compare: if features were independent (diagonal cov),
# Mahalanobis reduces to scaled Euclidean
cov_diag = np.diag(np.diag(cov_matrix))
S_inv_diag = np.linalg.inv(cov_diag)
mahal_diag = np.sqrt(diff @ S_inv_diag @ diff)
print(f"Mahalanobis (diag):   {mahal_diag:.4f}")
print(f"Difference shows correlation correction: {abs(mahalanobis - mahal_diag):.4f}")`,
                explanation: "We compute three distance metrics between two raw feature vectors. Raw Euclidean and Manhattan distances are dominated by the volume feature (~150 vs ~0.3 for returns), demonstrating why unscaled features distort KNN. After z-score scaling, all features contribute proportionally. Mahalanobis distance goes further by incorporating the full covariance matrix, correcting for correlations between features — when we compare it against the diagonal-only version, the difference reveals the correlation adjustment. In practice, always scale features for KNN; use Mahalanobis when features are correlated."
            },
            {
                type: "code",
                title: "KNN vs GaussianNB for Direction Prediction",
                language: "python",
                code: `import numpy as np
import pandas as pd
from sklearn.neighbors import KNeighborsClassifier
from sklearn.naive_bayes import GaussianNB
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import classification_report, accuracy_score

# --- Simulate forex features (replace with real data) ---
np.random.seed(42)
n = 1000
df = pd.DataFrame({
    'rsi': np.random.normal(50, 15, n),
    'atr_ratio': np.random.normal(1.0, 0.3, n),
    'ma_spread': np.random.normal(0, 0.005, n),
    'volume_ratio': np.random.normal(1.0, 0.4, n),
})
df['direction'] = (np.random.rand(n) > 0.48).astype(int)  # slight up bias

features = ['rsi', 'atr_ratio', 'ma_spread', 'volume_ratio']
X = df[features].values
y = df['direction'].values

# --- Walk-forward cross-validation ---
tscv = TimeSeriesSplit(n_splits=5)
k_values = [3, 5, 7, 11]

results = {}
for k in k_values:
    scores = []
    for train_idx, test_idx in tscv.split(X):
        scaler = StandardScaler()
        X_train = scaler.fit_transform(X[train_idx])
        X_test = scaler.transform(X[test_idx])
        knn = KNeighborsClassifier(n_neighbors=k, weights='distance')
        knn.fit(X_train, y[train_idx])
        scores.append(accuracy_score(y[test_idx], knn.predict(X_test)))
    results[f'KNN(k={k})'] = np.mean(scores)

# --- GaussianNB (no scaling needed, but doesn't hurt) ---
nb_scores = []
for train_idx, test_idx in tscv.split(X):
    scaler = StandardScaler()
    X_train = scaler.fit_transform(X[train_idx])
    X_test = scaler.transform(X[test_idx])
    gnb = GaussianNB()
    gnb.fit(X_train, y[train_idx])
    nb_scores.append(accuracy_score(y[test_idx], gnb.predict(X_test)))
results['GaussianNB'] = np.mean(nb_scores)

# --- Report ---
print("Walk-Forward CV Accuracy (5 splits):")
print("-" * 40)
for name, acc in sorted(results.items(), key=lambda x: -x[1]):
    print(f"  {name:<16s} {acc:.4f}")

# --- Detailed report for best KNN vs NB on last fold ---
train_idx, test_idx = list(tscv.split(X))[-1]
scaler = StandardScaler()
X_tr = scaler.fit_transform(X[train_idx])
X_te = scaler.transform(X[test_idx])

best_k = max(k_values, key=lambda k: results[f'KNN(k={k})'])
knn_best = KNeighborsClassifier(n_neighbors=best_k, weights='distance')
knn_best.fit(X_tr, y[train_idx])
gnb_final = GaussianNB().fit(X_tr, y[train_idx])

print(f"\\n--- KNN (k={best_k}) Last Fold ---")
print(classification_report(y[test_idx], knn_best.predict(X_te), digits=4))
print("--- GaussianNB Last Fold ---")
print(classification_report(y[test_idx], gnb_final.predict(X_te), digits=4))`,
                explanation: "This pipeline compares KNN (with multiple k values and distance weighting) against Gaussian Naive Bayes using time-series-aware cross-validation. Key details: (1) TimeSeriesSplit ensures we never train on future data — each fold uses only past observations. (2) StandardScaler is fit on training data only, preventing look-ahead bias. (3) KNN uses distance weighting so closer neighbors have more influence. (4) We test k ∈ {3, 5, 7, 11} to find the optimal neighborhood size. (5) The final classification reports show precision, recall, and F1 for each class on the last fold, revealing whether the models have directional bias."
            },
            {
                type: "code",
                title: "Naive Bayes from Scratch",
                language: "python",
                code: `import numpy as np
from sklearn.datasets import make_classification
from sklearn.naive_bayes import GaussianNB as SklearnGNB
from sklearn.model_selection import train_test_split

class GaussianNBFromScratch:
    """Gaussian Naive Bayes implemented from first principles."""

    def fit(self, X, y):
        self.classes_ = np.unique(y)
        n_samples = len(y)
        # Per-class priors, means, variances
        self.priors_ = {}
        self.means_ = {}
        self.vars_ = {}
        for c in self.classes_:
            X_c = X[y == c]
            self.priors_[c] = len(X_c) / n_samples  # P(y = c)
            self.means_[c] = X_c.mean(axis=0)        # μ_jc
            self.vars_[c] = X_c.var(axis=0) + 1e-9   # σ²_jc + epsilon
        return self

    def _log_likelihood(self, X, c):
        """Log P(x|y=c) = Σⱼ log N(xⱼ; μⱼc, σ²ⱼc)"""
        mu = self.means_[c]
        var = self.vars_[c]
        # Log of Gaussian PDF for each feature, summed
        log_prob = -0.5 * np.sum(np.log(2 * np.pi * var))
        log_prob = log_prob - 0.5 * np.sum((X - mu) ** 2 / var, axis=1)
        return log_prob

    def predict_log_proba(self, X):
        """Log posterior: log P(y=c|x) ∝ log P(x|y=c) + log P(y=c)"""
        log_posteriors = np.column_stack([
            self._log_likelihood(X, c) + np.log(self.priors_[c])
            for c in self.classes_
        ])
        return log_posteriors

    def predict(self, X):
        log_post = self.predict_log_proba(X)
        return self.classes_[np.argmax(log_post, axis=1)]

# --- Compare with sklearn ---
X, y = make_classification(n_samples=500, n_features=5,
                           n_informative=3, random_state=42)
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.3, random_state=42)

# Our implementation
gnb_scratch = GaussianNBFromScratch().fit(X_train, y_train)
preds_scratch = gnb_scratch.predict(X_test)

# Sklearn
gnb_sklearn = SklearnGNB().fit(X_train, y_train)
preds_sklearn = gnb_sklearn.predict(X_test)

# Verify match
match_rate = np.mean(preds_scratch == preds_sklearn)
acc_scratch = np.mean(preds_scratch == y_test)
acc_sklearn = np.mean(preds_sklearn == y_test)
print(f"From-scratch accuracy: {acc_scratch:.4f}")
print(f"Sklearn accuracy:      {acc_sklearn:.4f}")
print(f"Prediction match rate: {match_rate:.4f}")`,
                explanation: "This implementation builds Gaussian Naive Bayes from first principles. The fit() method computes three things per class: the prior P(y=c) as the class frequency, the mean μⱼc and variance σ²ⱼc for each feature j. The _log_likelihood() method computes log P(x|y=c) = Σⱼ log N(xⱼ; μⱼc, σ²ⱼc) — we work in log space to avoid numerical underflow when multiplying many small probabilities. The predict() method selects the class with the highest log posterior (log likelihood + log prior). We add ε = 1e-9 to variances to prevent division by zero. The prediction match rate against sklearn validates our implementation."
            },
            {
                type: "quiz",
                questions: [
                    {
                        id: "cml-knn-q1",
                        text: "Why is feature scaling critical for KNN but not for decision trees?",
                        options: [
                            { id: "cml-knn-q1-a", text: "KNN uses distance metrics that are sensitive to feature magnitudes — a feature ranging 0–1000 will dominate one ranging 0–1 in Euclidean distance. Decision trees split on individual feature thresholds and never compare magnitudes across features.", correct: true },
                            { id: "cml-knn-q1-b", text: "KNN requires normalized inputs for numerical stability, while decision trees use information gain which is inherently normalized.", correct: false },
                            { id: "cml-knn-q1-c", text: "Feature scaling only matters for gradient-based methods; KNN and trees are both unaffected but KNN benefits from faster computation.", correct: false },
                            { id: "cml-knn-q1-d", text: "Decision trees use ranked comparisons internally, which makes them scale-invariant, while KNN uses raw values for neighbor lookups.", correct: false }
                        ],
                        explanation: "KNN computes distances between points — if one feature has range [0, 1000] and another has range [0, 1], the first feature contributes ~10⁶ times more to Euclidean distance. Decision trees only ask 'is xⱼ > threshold?' for each feature independently, so the absolute scale never enters the computation. This is why scaling is mandatory for KNN but irrelevant for trees."
                    },
                    {
                        id: "cml-knn-q2",
                        text: "Compute the Euclidean distance between x = [3, 4, 0] and x' = [0, 0, 5]. Which value is closest?",
                        options: [
                            { id: "cml-knn-q2-a", text: "5.00", correct: false },
                            { id: "cml-knn-q2-b", text: "7.07 (√50)", correct: true },
                            { id: "cml-knn-q2-c", text: "12.00", correct: false },
                            { id: "cml-knn-q2-d", text: "6.16 (√38)", correct: false }
                        ],
                        explanation: "d = √((3−0)² + (4−0)² + (0−5)²) = √(9 + 16 + 25) = √50 ≈ 7.07. Note that the Manhattan distance would be |3| + |4| + |5| = 12, which is always ≥ Euclidean. This is a general property: Manhattan ≥ Euclidean ≥ Chebyshev (max absolute difference)."
                    },
                    {
                        id: "cml-knn-q3",
                        text: "Naive Bayes assumes features are conditionally independent given the class, which is almost always violated in practice. Why does NB still achieve competitive classification accuracy?",
                        options: [
                            { id: "cml-knn-q3-a", text: "The independence assumption only affects probability magnitudes, not the ranking of classes. As long as the highest-posterior class remains the same, the argmax prediction is correct regardless of calibration.", correct: true },
                            { id: "cml-knn-q3-b", text: "Feature correlations cancel out across classes, so the net effect on the decision boundary is zero.", correct: false },
                            { id: "cml-knn-q3-c", text: "NB uses regularization internally that corrects for violated independence assumptions.", correct: false },
                            { id: "cml-knn-q3-d", text: "The Gaussian distribution assumption compensates for the independence violation by adjusting variances.", correct: false }
                        ],
                        explanation: "NB only needs correct class ranking for accurate classification. The violated independence assumption distorts probability magnitudes (making them overconfident), but it typically preserves the ordering: if the true P(y=1|x) > P(y=0|x), the NB estimate usually maintains this inequality. The bias from double-counting correlated features affects both classes similarly, preserving the decision boundary."
                    },
                    {
                        id: "cml-knn-q4",
                        text: "In d = 20 dimensions, what fraction of a hypersphere's volume lies in the outer 10% of its radius (i.e., between r = 0.9R and r = R)?",
                        options: [
                            { id: "cml-knn-q4-a", text: "About 10%, since volume scales linearly with radius", correct: false },
                            { id: "cml-knn-q4-b", text: "About 27%, proportional to the surface area", correct: false },
                            { id: "cml-knn-q4-c", text: "About 87.8% — the fraction is 1 − 0.9²⁰ ≈ 0.878", correct: true },
                            { id: "cml-knn-q4-d", text: "About 65%, following the cube-sphere volume ratio", correct: false }
                        ],
                        explanation: "The fraction of volume in the outer shell of thickness ε (as a fraction of radius) is 1 − (1 − ε)^d. For ε = 0.1 and d = 20: 1 − 0.9²⁰ = 1 − 0.1216 ≈ 0.878 or 87.8%. Nearly 88% of the volume is in just the outer 10% shell! This is why KNN in high dimensions finds that all neighbors are at roughly the same distance — they are all in the thin outer shell."
                    },
                    {
                        id: "cml-knn-q5",
                        text: "In which scenario would Gaussian Naive Bayes likely outperform KNN for forex direction prediction?",
                        options: [
                            { id: "cml-knn-q5-a", text: "When the dataset has millions of samples and only 3 features, allowing KNN to find truly local neighborhoods.", correct: false },
                            { id: "cml-knn-q5-b", text: "When you have a small training set (< 500 samples) and 15+ features, many of which are roughly independent after PCA decorrelation.", correct: true },
                            { id: "cml-knn-q5-c", text: "When the decision boundary is highly nonlinear with complex local structure that requires flexible models.", correct: false },
                            { id: "cml-knn-q5-d", text: "When all features are categorical with many levels, like day-of-week and currency-pair identifiers.", correct: false }
                        ],
                        explanation: "GNB excels with small samples and many features because it estimates only O(p) parameters per class (mean + variance per feature), while KNN needs dense neighborhoods that require exponentially more data in high dimensions. After PCA decorrelation, the independence assumption is better satisfied. KNN would struggle with 15+ features and only 500 points due to the curse of dimensionality — the nearest neighbors would be nearly as far as the farthest points."
                    },
                    {
                        id: "cml-knn-q6",
                        text: "What happens to KNN predictions as k approaches n (the total number of training samples)?",
                        options: [
                            { id: "cml-knn-q6-a", text: "The model becomes increasingly accurate because it uses more information from the training set.", correct: false },
                            { id: "cml-knn-q6-b", text: "The model overfits severely because it memorizes the entire training set.", correct: false },
                            { id: "cml-knn-q6-c", text: "Every prediction converges to the majority class in the training set, producing maximum bias and zero variance — equivalent to a constant classifier.", correct: true },
                            { id: "cml-knn-q6-d", text: "The model becomes equivalent to logistic regression with no regularization.", correct: false }
                        ],
                        explanation: "When k = n, every query point has the same set of neighbors — the entire training set. The majority vote always returns the most frequent class. This is a constant classifier with maximum bias (it ignores all features) but zero variance (predictions never change). Conversely, k = 1 has minimum bias but maximum variance (predictions are noisy). The bias-variance tradeoff in KNN is controlled entirely by k."
                    }
                ]
            },
            {
                type: "practice",
                title: "Guided: KNN vs GaussianNB Walk-Forward Comparison",
                description: "Build a complete comparison pipeline: (1) Load your forex feature dataset. (2) Train KNN classifiers with k ∈ {3, 5, 7, 11} using both uniform and distance weighting — that is 8 KNN variants total. (3) Train a GaussianNB classifier. (4) Evaluate all 9 models using TimeSeriesSplit with 5 folds, recording accuracy, precision, recall, and F1 for each fold. (5) Plot accuracy vs k for both weighting schemes on the same chart. (6) Analyze: does distance weighting consistently outperform uniform? At what k does KNN match or exceed GaussianNB? Report the mean and standard deviation of accuracy across folds for each model.",
                catalogModelId: "knn-direction"
            },
            {
                type: "practice",
                title: "Open-Ended: Visualizing the Curse of Dimensionality",
                description: "Use the interactive dashboard to empirically demonstrate the curse of dimensionality: (1) Start with 2 features (e.g., RSI, ATR_ratio) and record KNN accuracy with k = 5. (2) Incrementally add features one at a time — ma_spread, volume_ratio, bollinger_width, macd_hist, adx, cci, willr, roc — up to 10 features total. (3) After each addition, retrain KNN and record accuracy. (4) Plot accuracy vs number of features. You should observe accuracy initially improving (more information), peaking around 4–6 features, then degrading as dimensionality increases and neighborhoods become sparse. (5) Repeat with GaussianNB and overlay on the same plot — NB should degrade less because it does not rely on local distance computations. (6) Bonus: compute and plot the average nearest-neighbor distance at each dimensionality to directly observe the concentration phenomenon."
            }
        ]
    }

      ],
    },
    {
      id: "ensemble",
      title: "Ensemble & Boosting",
      description:
        "Go beyond bagging into sequential boosting methods — XGBoost, LightGBM — and learn proper model validation for time series to avoid the most common pitfalls in trading ML.",
      lessons: [
    {
        id: "cml-boosting",
        title: "Gradient Boosting (XGBoost/LightGBM)",
        description: "Master the most powerful ensemble methods in modern machine learning. This lesson traces the evolution from AdaBoost's elegant sample reweighting scheme through gradient boosting's interpretation as functional gradient descent, culminating in the industrial-strength frameworks XGBoost and LightGBM. You will derive AdaBoost weight updates with numerical examples, understand how gradient boosting fits successive trees to pseudo-residuals of the loss function, and explore XGBoost's second-order Taylor expansion with L1/L2 regularization on leaf weights. We cover LightGBM's histogram-based splitting, leaf-wise growth strategy, Gradient-based One-Side Sampling (GOSS), and Exclusive Feature Bundling (EFB). The lesson concludes with SHAP values — rooted in cooperative game theory — for model interpretability, showing how TreeSHAP decomposes individual predictions into per-feature contributions. All concepts are grounded in forex signal prediction, where boosted models excel at combining heterogeneous technical indicators into actionable directional forecasts.",
        estimatedMinutes: 80,
        difficulty: "intermediate",
        prerequisites: ["cml-tree-models"],
        sections: [
            {
                type: "objective",
                content: "By the end of this lesson you will understand the theoretical foundations of boosting — from AdaBoost's multiplicative weight updates through gradient boosting's functional gradient descent framework — and be able to build, tune, and interpret XGBoost and LightGBM models for forex signal prediction. You will derive key equations by hand, implement AdaBoost from scratch, apply early stopping and hyperparameter tuning in XGBoost, and use SHAP values to explain individual predictions. These skills form the backbone of competitive ML pipelines in finance and beyond.",
                keyTakeaways: [
                    "Derive AdaBoost weight updates and compute learner weights αₘ = ½ ln((1−εₘ)/εₘ) from weighted classification error",
                    "Explain gradient boosting as gradient descent in function space where each tree fits pseudo-residuals rᵢₘ = −∂L/∂Fₘ₋₁(xᵢ)",
                    "Derive XGBoost's optimal leaf weight w*ⱼ = −Σgᵢ/(Σhᵢ + λ) and split gain formula using second-order Taylor expansion",
                    "Compare LightGBM innovations: histogram splitting O(n), leaf-wise growth, GOSS, and Exclusive Feature Bundling",
                    "Apply early stopping, column/row subsampling, and learning rate schedules to prevent overfitting in boosted models",
                    "Compute and interpret SHAP values to explain individual predictions and identify feature contributions",
                    "Build end-to-end XGBoost/LightGBM pipelines for forex directional prediction with proper train/validation/test splits",
                    "Understand the bias-variance tradeoff controlled by learning rate η, number of rounds, and tree depth in boosting"
                ]
            },
            {
                type: "theory",
                title: "AdaBoost Weight Update Derivation",
                content: "AdaBoost (Adaptive Boosting) is the foundational boosting algorithm that builds an ensemble by sequentially training weak learners on reweighted versions of the training data. The key insight is that misclassified samples receive higher weights in subsequent rounds, forcing the next learner to focus on the hard examples.\n\nWe begin with equal sample weights w₁ᵢ = 1/n for i = 1, …, n. At each round m = 1, 2, …, M we: (1) train a weak learner hₘ(x) ∈ {−1, +1} on the weighted dataset, (2) compute the weighted classification error εₘ = Σᵢ wₘ,ᵢ · I(hₘ(xᵢ) ≠ yᵢ) / Σᵢ wₘ,ᵢ, (3) compute the learner weight αₘ = ½ ln((1 − εₘ) / εₘ), and (4) update sample weights wₘ₊₁,ᵢ = wₘ,ᵢ · exp(−αₘ · yᵢ · hₘ(xᵢ)). The final ensemble prediction is H(x) = sign(Σₘ αₘ · hₘ(x)).\n\nNumerical Example — Consider 6 data points with labels y = [+1, +1, +1, −1, −1, −1]. Initial weights: w₁ᵢ = 1/6 for all i. Round 1: suppose stump h₁ misclassifies points 3 and 4. Weighted error ε₁ = (1/6 + 1/6) / 1.0 = 2/6 = 0.333. Learner weight α₁ = ½ ln((1 − 0.333) / 0.333) = ½ ln(2.0) = 0.347. Weight update: correctly classified points get multiplied by exp(−0.347) = 0.707, misclassified by exp(+0.347) = 1.414. So w₂ = [0.707/6, 0.707/6, 1.414/6, 1.414/6, 0.707/6, 0.707/6]. After normalization (sum = 4.243/6 → divide each by 4.243/6): w₂ ≈ [0.167, 0.167, 0.333, 0.333, 0.167, 0.167] — misclassified points 3 and 4 now have double the weight.\n\nRound 2: trained on reweighted data, h₂ now focuses on points 3 and 4. Suppose h₂ correctly classifies 3, 4 but misclassifies point 6. Weighted error ε₂ = 0.167 / 1.0 = 0.167. Learner weight α₂ = ½ ln(5.0) = 0.805. Misclassified point 6 gets upweighted further. Round 3: h₃ focuses on point 6. Suppose ε₃ = 0.1, then α₃ = ½ ln(9.0) = 1.099. Notice how α increases as weak learners become more accurate — better learners get more voting power in the final ensemble.\n\nThe exponential loss function that AdaBoost implicitly minimizes is L(y, F(x)) = exp(−y · F(x)). This can be shown by noting that the weight update rule is equivalent to performing coordinate descent on the exponential loss. The choice of exponential loss makes AdaBoost sensitive to outliers — a single noisy label with large negative margin accumulates exponentially large weight, potentially dominating the ensemble."
            },
            {
                type: "theory",
                title: "Gradient Boosting as Gradient Descent in Function Space",
                content: "Gradient boosting generalizes AdaBoost by framing the ensemble construction as gradient descent in the space of functions. Instead of reweighting samples, we directly fit each new tree to the negative gradient of the loss function — the pseudo-residuals. The ensemble at step m is Fₘ(x) = Fₘ₋₁(x) + η · hₘ(x), where η is the learning rate and hₘ is a regression tree fit to the pseudo-residuals.\n\nAt each boosting iteration m, we compute pseudo-residuals rᵢₘ = −∂L(yᵢ, Fₘ₋₁(xᵢ)) / ∂Fₘ₋₁(xᵢ) for each training sample i. For squared loss L = ½(y − F)², the pseudo-residuals are simply rᵢₘ = yᵢ − Fₘ₋₁(xᵢ) — the actual residuals. For binary cross-entropy (log-loss) L = −[y·log(σ(F)) + (1−y)·log(1−σ(F))], the pseudo-residuals are rᵢₘ = yᵢ − σ(Fₘ₋₁(xᵢ)) where σ is the sigmoid function. We then fit a regression tree hₘ to these pseudo-residuals and update the ensemble.\n\nNumerical Example — Consider 4 data points: x = [1, 2, 3, 4], y = [2.1, 3.8, 6.2, 8.0]. Initialize F₀(x) = ȳ = 5.025. Iteration 1: residuals r₁ = [2.1−5.025, 3.8−5.025, 6.2−5.025, 8.0−5.025] = [−2.925, −1.225, 1.175, 2.975]. Fit tree h₁ to these residuals. Suppose h₁ splits at x=2.5: left leaf = mean(−2.925, −1.225) = −2.075, right leaf = mean(1.175, 2.975) = 2.075. With η=0.3: F₁(x) = 5.025 + 0.3·h₁(x). For x=1: F₁ = 5.025 + 0.3·(−2.075) = 4.403. Iteration 2: new residuals r₂ = [2.1−4.403, 3.8−4.659, 6.2−5.648, 8.0−5.648] = [−2.303, −0.859, 0.553, 2.353]. Each round the residuals shrink as the ensemble improves.\n\nThe learning rate η controls the contribution of each tree. Small η (e.g., 0.01–0.1) with many trees generalizes better than large η (e.g., 0.5–1.0) with few trees. The reasoning is analogous to gradient descent in parameter space: a small step size explores the loss surface more carefully and is less likely to overshoot minima. Empirically, η ∈ [0.01, 0.1] with 500–5000 trees and early stopping gives the best results. The shrinkage also provides a natural regularization effect — each tree makes only a small correction, so the ensemble builds up predictions gradually and the early trees capture the dominant signal while later trees refine the details.\n\nGradient boosting can optimize any differentiable loss function, making it far more flexible than AdaBoost. Common choices include squared error for regression, log-loss for classification, quantile loss for prediction intervals, and custom losses for domain-specific objectives like asymmetric costs in trading signals."
            },
            {
                type: "theory",
                title: "XGBoost Objective & Regularization",
                content: "XGBoost (eXtreme Gradient Boosting) extends gradient boosting with a regularized objective and several algorithmic innovations. The key theoretical contribution is using a second-order Taylor expansion of the loss function, which provides curvature information for better optimization.\n\nThe objective at step m is: Obj⁽ᵐ⁾ ≈ Σᵢ [gᵢ · fₘ(xᵢ) + ½ · hᵢ · fₘ(xᵢ)²] + Ω(fₘ), where gᵢ = ∂L(yᵢ, Fₘ₋₁(xᵢ))/∂Fₘ₋₁(xᵢ) is the first-order gradient, hᵢ = ∂²L(yᵢ, Fₘ₋₁(xᵢ))/∂Fₘ₋₁(xᵢ)² is the second-order gradient (Hessian), and Ω(fₘ) = γ·T + ½·λ·Σⱼ wⱼ² is the regularization term. Here T is the number of leaves and wⱼ is the weight of leaf j. The γ term penalizes tree complexity (number of leaves), while λ provides L2 regularization on leaf weights.\n\nFor a tree structure that partitions instances into leaves Iⱼ, the optimal leaf weight is derived by setting the derivative to zero: w*ⱼ = −Σᵢ∈Iⱼ gᵢ / (Σᵢ∈Iⱼ hᵢ + λ). The optimal objective value becomes: Obj* = −½ Σⱼ (Σᵢ∈Iⱼ gᵢ)² / (Σᵢ∈Iⱼ hᵢ + λ) + γ·T. The split gain for dividing node into left (L) and right (R) children is: Gain = ½ [(ΣᵢϵL gᵢ)² / (ΣᵢϵL hᵢ + λ) + (ΣᵢϵR gᵢ)² / (ΣᵢϵR hᵢ + λ) − (Σᵢ gᵢ)² / (Σᵢ hᵢ + λ)] − γ. A split is made only if Gain > 0, meaning γ acts as a minimum improvement threshold.\n\nBeyond the regularized objective, XGBoost employs column subsampling (sampling a fraction of features at each tree or split level) and row subsampling (sampling a fraction of training instances for each tree). These stochastic elements reduce overfitting and improve generalization, similar to random forests. XGBoost also handles missing values natively by learning a default split direction during training — for each split, it tries routing missing values both left and right, choosing whichever yields higher gain.\n\nThe second-order information (Hessian hᵢ) is what distinguishes XGBoost from standard gradient boosting. For squared loss, hᵢ = 1 for all samples, so the Hessian is uninformative. But for log-loss, hᵢ = pᵢ(1 − pᵢ) where pᵢ = σ(Fₘ₋₁(xᵢ)), meaning samples near the decision boundary (pᵢ ≈ 0.5) have larger Hessians and contribute more to determining leaf weights. This Newton-Raphson-style optimization converges faster than first-order methods, especially for non-quadratic loss functions common in classification and ranking tasks."
            },
            {
                type: "theory",
                title: "LightGBM Innovations & SHAP Values",
                content: "LightGBM (Light Gradient Boosting Machine) introduces several algorithmic innovations that dramatically improve training speed and memory efficiency while maintaining or exceeding XGBoost's accuracy.\n\nHistogram-based splitting replaces the exact greedy algorithm with an approximate approach: continuous features are binned into at most 256 discrete bins (configurable via max_bin). Finding the best split then requires only O(n) time for binning plus O(#bins) for evaluating split points, compared to XGBoost's exact method which is O(n log n) for sorting. LightGBM further accelerates this with the histogram subtraction trick — the histogram of a sibling node equals the parent's histogram minus the other child's, halving the computation.\n\nLightGBM uses leaf-wise (best-first) tree growth rather than the traditional level-wise approach. At each step, it expands the leaf with the highest loss reduction across the entire tree, producing deeper, more asymmetric trees that reduce loss faster with fewer leaves. While level-wise growth adds an entire level (2ᵈ leaves at depth d), leaf-wise targets the single most informative split. This is more efficient but risks overfitting on small datasets — controlled by max_depth and num_leaves parameters.\n\nGOSS (Gradient-based One-Side Sampling) reduces the number of samples used for histogram construction. Instances with large absolute gradients are kept (they contribute most to the information gain), while instances with small gradients are randomly subsampled at rate b. The small-gradient subsample is upweighted by (1−a)/b to maintain the original gradient distribution. EFB (Exclusive Feature Bundling) identifies features that rarely take nonzero values simultaneously (common in sparse/one-hot data) and bundles them into a single feature, reducing the effective feature dimension. DART (Dropouts meet Multiple Additive Regression Trees) randomly drops existing trees during training, similar to neural network dropout, preventing over-specialization of later trees.\n\nSHAP (SHapley Additive exPlanations) values provide a principled approach to explaining individual predictions. Rooted in cooperative game theory, the Shapley value of feature j for a prediction f(x) is: ϕⱼ(x) = Σ_{S⊆N\\{j}} [|S|!(|N|−|S|−1)!/|N|!] · [f(S ∪ {j}) − f(S)], where the sum is over all subsets of features excluding j. This measures the average marginal contribution of feature j across all possible feature orderings. SHAP values satisfy three desirable properties: local accuracy (ϕ₀ + Σⱼ ϕⱼ(x) = f(x)), missingness (absent features get zero attribution), and consistency (if a feature's contribution increases in a new model, its SHAP value does not decrease). TreeSHAP is an efficient O(TLD²) algorithm for tree ensembles (T trees, L leaves, D depth), making SHAP practical for XGBoost/LightGBM models with thousands of trees. Unlike global feature importance (which ranks features by average gain), SHAP provides per-instance, per-feature explanations, revealing when and why a model is confident or uncertain."
            },
            {
                type: "intuition",
                title: "Boosting as Exam Correction",
                analogy: "Imagine retaking an exam after getting your graded paper back. On the first attempt, you study everything equally and answer all questions. When results come back, you see which questions you missed. For your retake, you spend extra time on those missed topics — the questions you got wrong receive more study weight. This is exactly AdaBoost: each round is a retake where misclassified samples (missed questions) get upweighted. The learning rate η is your confidence in each correction attempt — setting it low (0.05) means you cautiously adjust your answers, while setting it high (1.0) means you boldly rewrite them. Early stopping is like saying 'stop studying when your practice test scores plateau' — continuing to cram after diminishing returns leads to memorizing specific practice questions (overfitting) rather than understanding the underlying material. The final grade is a weighted vote of all your attempts, with more accurate attempts counting more (higher αₘ).",
                content: "This maps directly to gradient boosting in forex: each boosting round focuses the model on the trades it got wrong — the ambiguous market regimes where signals were unclear. Early rounds capture obvious trends (strong RSI divergences, clear breakouts), while later rounds learn subtle patterns in the hard-to-classify consolidation periods. The learning rate ensures no single correction dominates, and early stopping prevents the model from memorizing noise in historical price data.",
                emoji: "📝"
            },
            {
                type: "intuition",
                title: "The Orchestra Conductor",
                analogy: "Picture an orchestra conductor building a symphony one instrument at a time. The conductor starts with a single violin playing the main melody — it captures the broad theme but sounds thin and incomplete. The conductor listens to what is missing (the residual dissonance) and adds a cello to fill the low frequencies the violin missed. Then a flute to cover the high notes neither string instrument reached. Each new instrument is chosen specifically to correct the remaining imperfections in the harmony. The learning rate η controls each instrument's volume — set too loud, a single instrument overwhelms the ensemble; set appropriately, each blends in smoothly. Regularization (γ, λ) prevents the conductor from adding too many instruments — an orchestra of 10,000 players would overfit to the concert hall's acoustics rather than producing universally beautiful music.",
                content: "In XGBoost terms, each tree is a new instrument correcting the ensemble's remaining errors (pseudo-residuals). The second-order gradients (Hessians) tell the conductor not just which notes are wrong but how sensitive the harmony is to corrections at each point — notes near the boundary between harmony and dissonance (high Hessian) receive more careful attention. Column subsampling is like randomly muting some instruments during rehearsal to ensure the ensemble does not rely on any single instrument. The final prediction is all instruments playing together — a rich, regularized ensemble where each tree contributes a small, targeted correction.",
                emoji: "🎵"
            },
            {
                type: "code",
                title: "AdaBoost from Scratch",
                language: "python",
                code: `import numpy as np

# --- AdaBoost from Scratch (3 rounds, decision stumps) ---
X = np.array([1, 2, 3, 4, 5, 6]).reshape(-1, 1)
y = np.array([1, 1, -1, -1, 1, -1])  # Binary labels
n = len(y)
weights = np.ones(n) / n  # Equal initial weights

def best_stump(X, y, w):
    """Find the best decision stump (threshold + polarity)."""
    best_err, best_thresh, best_pol = float('inf'), None, None
    for thresh in [1.5, 2.5, 3.5, 4.5, 5.5]:
        for polarity in [1, -1]:
            preds = np.where(X.ravel() <= thresh, polarity, -polarity)
            err = np.sum(w * (preds != y)) / np.sum(w)
            if err < best_err:
                best_err, best_thresh, best_pol = err, thresh, polarity
    preds = np.where(X.ravel() <= best_thresh, best_pol, -best_pol)
    return preds, best_err, best_thresh, best_pol

alphas, stumps = [], []
print("=== AdaBoost: 3 Rounds ===\\n")

for m in range(1, 4):
    preds, eps, thresh, pol = best_stump(X, y, weights)
    alpha = 0.5 * np.log((1 - eps) / (eps + 1e-10))

    print(f"Round {m}:")
    print(f"  Threshold={thresh}, Polarity={pol}")
    print(f"  Predictions:  {preds}")
    print(f"  Weighted err: {eps:.4f}")
    print(f"  Alpha (α):    {alpha:.4f}")
    print(f"  Weights before: {np.round(weights, 4)}")

    # Update weights: upweight misclassified, downweight correct
    weights *= np.exp(-alpha * y * preds)
    weights /= np.sum(weights)  # Normalize
    print(f"  Weights after:  {np.round(weights, 4)}\\n")

    alphas.append(alpha)
    stumps.append((thresh, pol))

# Final ensemble prediction
ensemble_score = np.zeros(n)
for alpha, (thresh, pol) in zip(alphas, stumps):
    ensemble_score += alpha * np.where(X.ravel() <= thresh, pol, -pol)
final_preds = np.sign(ensemble_score)
accuracy = np.mean(final_preds == y)

print(f"Ensemble scores: {np.round(ensemble_score, 3)}")
print(f"Final predictions: {final_preds.astype(int)}")
print(f"True labels:       {y}")
print(f"Accuracy:          {accuracy:.1%}")`,
                explanation: "This implementation builds AdaBoost from first principles. We define 6 data points with binary labels and iterate through 3 boosting rounds. At each round: (1) we find the best decision stump by exhaustively searching thresholds and polarities, (2) compute the weighted classification error εₘ, (3) calculate the learner weight αₘ = ½ ln((1−ε)/ε), and (4) update sample weights using the multiplicative rule wᵢ ← wᵢ · exp(−αₘ · yᵢ · hₘ(xᵢ)). The output shows how misclassified samples accumulate weight across rounds, forcing subsequent stumps to focus on the hard examples. The final prediction is a weighted vote of all three stumps."
            },
            {
                type: "code",
                title: "XGBoost with Early Stopping",
                language: "python",
                code: `import numpy as np
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.datasets import make_classification
from sklearn.metrics import classification_report, accuracy_score

# --- Generate synthetic forex-like feature data ---
X, y = make_classification(
    n_samples=2000, n_features=12, n_informative=6,
    n_redundant=2, n_clusters_per_class=3, random_state=42
)
feature_names = [
    "rsi_14", "macd_hist", "bb_width", "atr_14",
    "ema_cross", "volume_ratio", "adx_14", "stoch_k",
    "obv_slope", "vwap_dev", "spread_z", "hour_sin"
]

# 60/20/20 train/validation/test split
X_temp, X_test, y_temp, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)
X_train, X_val, y_train, y_val = train_test_split(
    X_temp, y_temp, test_size=0.25, random_state=42, stratify=y_temp
)
print(f"Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")

# --- XGBoost with tuned hyperparameters ---
model = xgb.XGBClassifier(
    n_estimators=1000, learning_rate=0.05, max_depth=5,
    subsample=0.8, colsample_bytree=0.8,
    reg_alpha=0.1, reg_lambda=1.0, gamma=0.1,
    eval_metric="logloss", random_state=42,
    early_stopping_rounds=30
)

model.fit(
    X_train, y_train,
    eval_set=[(X_val, y_val)],
    verbose=False
)
print(f"Best iteration: {model.best_iteration}")
print(f"Best validation log-loss: {model.best_score:.4f}\\n")

# --- Evaluation on held-out test set ---
y_pred = model.predict(X_test)
print(f"Test accuracy: {accuracy_score(y_test, y_pred):.4f}\\n")
print(classification_report(y_test, y_pred, target_names=["Short", "Long"]))

# --- Feature importance (gain-based) ---
importance = model.get_booster().get_score(importance_type="gain")
sorted_imp = sorted(importance.items(), key=lambda x: x[1], reverse=True)
print("Top features by gain:")
for fname, gain in sorted_imp[:6]:
    idx = int(fname.replace("f", ""))
    print(f"  {feature_names[idx]:>14s}: {gain:.1f}")`,
                explanation: "This pipeline demonstrates production-grade XGBoost usage. We generate synthetic data mimicking forex technical indicators, split 60/20/20 for train/validation/test, and train an XGBClassifier with carefully tuned hyperparameters: learning_rate=0.05 for gradual learning, max_depth=5 to limit tree complexity, subsample and colsample_bytree=0.8 for stochastic regularization, and reg_alpha/reg_lambda for L1/L2 penalties on leaf weights. Early stopping monitors validation log-loss and halts training when no improvement occurs for 30 rounds, automatically selecting the best iteration. The classification report and gain-based feature importance provide actionable model diagnostics."
            },
            {
                type: "code",
                title: "SHAP Values Analysis",
                language: "python",
                code: `import numpy as np
import xgboost as xgb
import shap
from sklearn.model_selection import train_test_split
from sklearn.datasets import make_classification

# --- Train XGBoost model ---
X, y = make_classification(
    n_samples=1500, n_features=10, n_informative=5,
    n_redundant=2, random_state=42
)
feature_names = [
    "rsi_14", "macd_hist", "bb_width", "atr_14", "ema_cross",
    "volume_ratio", "adx_14", "stoch_k", "obv_slope", "vwap_dev"
]
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

model = xgb.XGBClassifier(
    n_estimators=200, learning_rate=0.1, max_depth=4,
    random_state=42, eval_metric="logloss"
)
model.fit(X_train, y_train, verbose=False)
print(f"Test accuracy: {model.score(X_test, y_test):.4f}\\n")

# --- Compute SHAP values with TreeSHAP ---
explainer = shap.TreeExplainer(model)
shap_values = explainer.shap_values(X_test)
print(f"SHAP values shape: {shap_values.shape}")
print(f"Expected value (base): {explainer.expected_value:.4f}\\n")

# --- Explain individual predictions ---
for idx in [0, 1, 2]:
    pred_proba = model.predict_proba(X_test[idx:idx+1])[0]
    print(f"--- Instance {idx} ---")
    print(f"  Prediction: {'Long' if pred_proba[1]>0.5 else 'Short'}"
          f" (P={max(pred_proba):.3f})")
    contributions = list(zip(feature_names, shap_values[idx]))
    contributions.sort(key=lambda x: abs(x[1]), reverse=True)
    print(f"  Top SHAP contributions:")
    for fname, sv in contributions[:5]:
        direction = "↑ Long" if sv > 0 else "↓ Short"
        print(f"    {fname:>14s}: {sv:+.4f} ({direction})")
    total = explainer.expected_value + np.sum(shap_values[idx])
    print(f"  SHAP sum check: base({explainer.expected_value:.3f})"
          f" + Σϕ({np.sum(shap_values[idx]):.3f}) = {total:.3f}\\n")

# --- Global feature importance via mean |SHAP| ---
mean_abs_shap = np.mean(np.abs(shap_values), axis=0)
global_ranking = sorted(
    zip(feature_names, mean_abs_shap), key=lambda x: x[1], reverse=True
)
print("Global SHAP importance (mean |SHAP|):")
for fname, importance in global_ranking:
    bar = "█" * int(importance * 40 / global_ranking[0][1])
    print(f"  {fname:>14s}: {importance:.4f} {bar}")`,
                explanation: "This code demonstrates SHAP-based model interpretability. After training an XGBoost classifier, we use TreeSHAP (an efficient O(TLD²) algorithm for tree ensembles) to compute per-feature contribution values for every test instance. For three individual predictions, we show the top 5 SHAP contributors — each value ϕⱼ indicates how much feature j pushed the prediction toward Long (positive) or Short (negative) relative to the base rate. The SHAP sum check verifies the local accuracy property: base_value + Σϕⱼ = model output. Finally, we compute global importance as mean(|SHAP|) across all test instances, providing a more faithful feature ranking than gain-based importance because it accounts for feature interactions and direction of effect."
            },
            {
                type: "quiz",
                questions: [
                    {
                        id: "cml-boost-q1",
                        text: "What is the fundamental difference between bagging and boosting?",
                        options: [
                            { id: "cml-boost-q1-a", text: "Bagging uses decision trees while boosting uses linear models", isCorrect: false },
                            { id: "cml-boost-q1-b", text: "Bagging trains models independently in parallel; boosting trains sequentially where each model corrects errors of the previous ensemble", isCorrect: true },
                            { id: "cml-boost-q1-c", text: "Bagging reduces bias while boosting reduces variance", isCorrect: false },
                            { id: "cml-boost-q1-d", text: "Boosting always achieves higher accuracy than bagging", isCorrect: false }
                        ],
                        explanation: "Bagging (e.g., Random Forest) trains independent models on bootstrap samples and averages them to reduce variance. Boosting trains models sequentially — each new model focuses on the errors made by the current ensemble, progressively reducing bias. Bagging is parallel and reduces variance; boosting is sequential and primarily reduces bias."
                    },
                    {
                        id: "cml-boost-q2",
                        text: "In AdaBoost, if a weak learner achieves a weighted classification error ε = 0.3, what is its learner weight α?",
                        options: [
                            { id: "cml-boost-q2-a", text: "α = 0.3" , isCorrect: false },
                            { id: "cml-boost-q2-b", text: "α = ½ ln(0.7/0.3) ≈ 0.4236", isCorrect: true },
                            { id: "cml-boost-q2-c", text: "α = ln(0.3) ≈ −1.204", isCorrect: false },
                            { id: "cml-boost-q2-d", text: "α = 1 − 0.3 = 0.7", isCorrect: false }
                        ],
                        explanation: "The AdaBoost learner weight formula is αₘ = ½ ln((1 − εₘ) / εₘ). With ε = 0.3: α = ½ ln((1 − 0.3) / 0.3) = ½ ln(0.7 / 0.3) = ½ ln(2.333) = ½ × 0.8473 ≈ 0.4236. A learner with error below 0.5 gets positive weight (better than random guessing)."
                    },
                    {
                        id: "cml-boost-q3",
                        text: "What problem does early stopping prevent in gradient boosting?",
                        options: [
                            { id: "cml-boost-q3-a", text: "Underfitting — the model has too few trees to capture the signal", isCorrect: false },
                            { id: "cml-boost-q3-b", text: "Overfitting — additional trees begin memorizing noise in the training data instead of learning generalizable patterns", isCorrect: true },
                            { id: "cml-boost-q3-c", text: "Gradient vanishing — gradients become too small for the model to learn", isCorrect: false },
                            { id: "cml-boost-q3-d", text: "Feature leakage — validation data information leaks into training", isCorrect: false }
                        ],
                        explanation: "Early stopping monitors performance on a validation set and halts training when the validation metric stops improving. Without it, gradient boosting will keep adding trees that reduce training loss but increase validation loss — classic overfitting. The model memorizes training noise rather than learning generalizable patterns."
                    },
                    {
                        id: "cml-boost-q4",
                        text: "Why does XGBoost use second-order gradient information (Hessians) in addition to first-order gradients?",
                        options: [
                            { id: "cml-boost-q4-a", text: "Second-order gradients reduce memory usage during training", isCorrect: false },
                            { id: "cml-boost-q4-b", text: "The Hessian provides curvature information enabling Newton-Raphson optimization, which converges faster and yields better-calibrated leaf weights especially for non-quadratic losses", isCorrect: true },
                            { id: "cml-boost-q4-c", text: "Hessians are only used for computational efficiency and do not affect model quality", isCorrect: false },
                            { id: "cml-boost-q4-d", text: "Second-order information is required for handling missing values", isCorrect: false }
                        ],
                        explanation: "The Hessian (second derivative) captures the curvature of the loss function. This enables Newton-Raphson-style optimization in function space, which converges faster than first-order gradient descent. For log-loss, hᵢ = pᵢ(1−pᵢ), meaning samples near the decision boundary (high uncertainty) contribute more to leaf weight computation, yielding better-calibrated predictions."
                    },
                    {
                        id: "cml-boost-q5",
                        text: "What is the primary advantage of LightGBM's leaf-wise tree growth over level-wise growth?",
                        options: [
                            { id: "cml-boost-q5-a", text: "Leaf-wise growth always produces shallower trees", isCorrect: false },
                            { id: "cml-boost-q5-b", text: "Leaf-wise growth reduces loss faster by always splitting the leaf with the highest gain, producing more efficient trees with fewer leaves", isCorrect: true },
                            { id: "cml-boost-q5-c", text: "Leaf-wise growth eliminates the need for regularization", isCorrect: false },
                            { id: "cml-boost-q5-d", text: "Leaf-wise growth guarantees no overfitting on small datasets", isCorrect: false }
                        ],
                        explanation: "Level-wise growth expands all leaves at the current depth, including uninformative splits. Leaf-wise (best-first) growth always picks the single leaf with the highest loss reduction, producing asymmetric trees that achieve lower loss with fewer total leaves. However, it can overfit on small datasets, so max_depth and num_leaves must be tuned carefully."
                    },
                    {
                        id: "cml-boost-q6",
                        text: "What happens if the learning rate η in gradient boosting is set too large (e.g., η = 1.0)?",
                        options: [
                            { id: "cml-boost-q6-a", text: "Training becomes more stable and converges to a better solution", isCorrect: false },
                            { id: "cml-boost-q6-b", text: "Each tree makes a full correction, causing the ensemble to overfit quickly, oscillate around the optimum, and generalize poorly", isCorrect: true },
                            { id: "cml-boost-q6-c", text: "The model underfits because each tree has too little influence", isCorrect: false },
                            { id: "cml-boost-q6-d", text: "Learning rate has no effect on gradient boosting performance", isCorrect: false }
                        ],
                        explanation: "A large learning rate means each tree's contribution is not shrunk, so each tree makes a full correction. This causes the ensemble to overfit rapidly — early trees dominate and later trees make large, noisy corrections. The optimization overshoots the optimum, similar to large step sizes in gradient descent. Small η (0.01–0.1) with many trees and early stopping generalizes much better."
                    },
                    {
                        id: "cml-boost-q7",
                        text: "How do SHAP values differ from traditional gain-based feature importance in tree models?",
                        options: [
                            { id: "cml-boost-q7-a", text: "SHAP values are faster to compute than gain-based importance", isCorrect: false },
                            { id: "cml-boost-q7-b", text: "Gain-based importance only ranks features globally, while SHAP provides per-instance, per-feature contributions with direction (positive/negative) and satisfies theoretical consistency properties", isCorrect: true },
                            { id: "cml-boost-q7-c", text: "SHAP values and gain-based importance always produce the same feature ranking", isCorrect: false },
                            { id: "cml-boost-q7-d", text: "SHAP values can only be computed for linear models, not tree ensembles", isCorrect: false }
                        ],
                        explanation: "Gain-based importance sums the gain across all splits using a feature — it gives a single global number per feature with no direction or instance-level granularity. SHAP values decompose each individual prediction into additive per-feature contributions (ϕⱼ), showing both magnitude and direction. SHAP satisfies local accuracy (contributions sum to prediction), consistency, and missingness axioms from game theory, making it a theoretically grounded and more informative explanation method."
                    }
                ]
            },
            {
                type: "practice",
                title: "Compare XGBoost vs LightGBM on Forex Data",
                description: "Train both XGBoost and LightGBM classifiers on the same forex feature dataset using identical train/validation/test splits. Compare: (1) test accuracy and F1 score, (2) training time, (3) optimal number of boosting rounds with early stopping, (4) top 5 features by importance. Experiment with matching hyperparameters: learning_rate=0.05, max_depth=5, subsample=0.8. Then tune each model independently using its native strengths — XGBoost with exact splits and L1/L2 regularization, LightGBM with leaf-wise growth and num_leaves=31. Document which model performs better and why.",
                catalogModelId: "xgboost-direction"
            },
            {
                type: "practice",
                title: "SHAP-Based Prediction Explanation Dashboard",
                description: "Using a trained XGBoost or LightGBM model on forex data, build an interactive SHAP analysis workflow: (1) Compute SHAP values for the entire test set using TreeExplainer. (2) For 5 individual predictions, print the full SHAP decomposition showing how each feature pushed the prediction toward Long or Short. (3) Identify predictions where the model is uncertain (probability near 0.5) and examine whether SHAP reveals conflicting feature signals. (4) Compare global SHAP importance (mean |SHAP|) against gain-based importance — do they agree on the top features? (5) Find instances where a typically important feature has near-zero SHAP contribution and explain why. Use this analysis to build intuition about when the model's predictions are trustworthy vs. when they should be treated with caution."
            }
        ]
    }
,
    {
        id: "cml-model-selection",
        title: "Model Selection & Validation",
        description: "Master the science of choosing and validating machine learning models for financial time series. This lesson dissects the bias-variance tradeoff with full mathematical decomposition, exposes the dangerous pitfalls of applying standard k-fold cross-validation to autocorrelated time series data, and introduces walk-forward validation and purged cross-validation (de Prado) as rigorous alternatives. You will learn to interpret learning curves for bias-variance diagnosis, compare information criteria (AIC/BIC) for model comparison, and apply hyperparameter search strategies (grid, random, Bayesian) efficiently. Special emphasis is placed on forex walk-forward validation workflows where lookahead bias can silently inflate accuracy by 5–30%, leading to catastrophic live trading performance.",
        estimatedMinutes: 75,
        difficulty: "intermediate",
        prerequisites: ["cml-linear-models"],
        sections: [
            {
                type: "objective",
                content: "By the end of this lesson, you will understand the bias-variance tradeoff decomposition and its implications for model complexity, recognize why standard cross-validation fails on time series data and how to fix it with walk-forward and purged approaches, use information criteria and learning curves for principled model selection, and apply efficient hyperparameter search strategies to financial models.",
                keyTakeaways: [
                    "Decompose expected prediction error into bias², variance, and irreducible noise σ²",
                    "Identify underfitting (high bias) vs overfitting (high variance) from train/test error gaps",
                    "Explain why standard k-fold CV leaks future information in autocorrelated time series",
                    "Implement walk-forward validation with expanding and sliding windows",
                    "Apply purged cross-validation with embargo gaps to prevent label leakage",
                    "Use AIC for prediction-oriented selection and BIC for parsimonious model identification",
                    "Diagnose bias vs variance from learning curve shapes",
                    "Compare grid search, random search, and Bayesian optimization for hyperparameter tuning"
                ]
            },
            {
                type: "theory",
                title: "Bias-Variance Tradeoff Decomposition",
                content: "The bias-variance tradeoff is the foundational result explaining why model complexity must be carefully controlled. We seek to minimize the expected prediction error E[(y − ŷ)²] where y is the true response and ŷ is our model's prediction. The key insight is that this error decomposes into three irreducible components.\n\nStart from the definition: E[(y − ŷ)²]. We add and subtract E[ŷ] inside the square: E[(y − E[ŷ] + E[ŷ] − ŷ)²]. Expanding the square gives three terms: E[(y − E[ŷ])²] + E[(E[ŷ] − ŷ)²] + 2·E[(y − E[ŷ])(E[ŷ] − ŷ)]. The cross term vanishes because y − E[ŷ] = (y − f(x)) + (f(x) − E[ŷ]), and the noise term y − f(x) = ε is independent of the model's deviation ŷ − E[ŷ], while E[E[ŷ] − ŷ] = 0 by definition of expectation. This yields the decomposition:\n\nE[(y − ŷ)²] = (E[ŷ] − f(x))² + E[(ŷ − E[ŷ])²] + σ²\n\nwhere Bias(ŷ) = E[ŷ] − f(x) measures systematic error (how far the average prediction is from truth), Var(ŷ) = E[(ŷ − E[ŷ])²] measures prediction instability across different training sets, and σ² is the irreducible noise in the data-generating process.\n\nNumerical Example — Polynomial Fitting: Suppose the true function is f(x) = sin(πx) with σ² = 0.05. We fit polynomials of varying degree to 50 training samples and evaluate expected error over 1000 bootstrap datasets:\n• Degree 1 (underfitting): Bias² ≈ 0.28, Variance ≈ 0.01, Total Error ≈ 0.34. The linear model cannot capture the curvature, so bias dominates.\n• Degree 3 (good fit): Bias² ≈ 0.02, Variance ≈ 0.04, Total Error ≈ 0.11. Near-optimal tradeoff — flexible enough to capture the shape without excessive variance.\n• Degree 10 (overfitting): Bias² ≈ 0.01, Variance ≈ 0.42, Total Error ≈ 0.48. The model fits noise in each training set, producing wildly different predictions across samples.\n\nThis demonstrates the U-shaped total error curve: as complexity increases, bias decreases monotonically while variance increases monotonically. The optimal model sits at the minimum of their sum."
            },
            {
                type: "theory",
                title: "Cross-Validation Theory & Time Series Pitfalls",
                content: "Standard k-fold cross-validation randomly partitions n observations into k roughly equal folds. For each fold j ∈ {1,…,k}, the model trains on the remaining k−1 folds and evaluates on fold j. The CV estimate of generalization error is the average test error across all k folds: CV(k) = (1/k) Σⱼ Errⱼ. Under the i.i.d. assumption, each fold provides an unbiased estimate because training and test data are exchangeable — any permutation of the data yields the same joint distribution.\n\nThis breaks catastrophically for time series. Financial returns exhibit autocorrelation (return at t correlates with returns at t−1, t−2, …), volatility clustering (GARCH effects), and regime persistence. When k-fold randomly assigns observation t to the test set and observations t−1, t+1 to the training set, the model effectively trains on the immediate neighbors of each test point. This is akin to predicting today's price having already seen tomorrow's — a severe form of lookahead bias.\n\nThe magnitude of this inflation is substantial. Empirical studies on forex data show that shuffled k-fold CV can inflate classification accuracy by 5–30% compared to temporally-correct validation. For a model that achieves 55% accuracy on walk-forward validation (a realistic edge in FX), shuffled CV might report 65–75% accuracy — a completely misleading result that would lead to deploying a model with no real predictive power. The inflation is worst when features or targets have high serial correlation or when the prediction horizon overlaps across samples.\n\nStratified k-fold addresses class imbalance by ensuring each fold preserves the class distribution (e.g., 52% up / 48% down in each fold). This is useful for directional prediction tasks but does NOT solve the temporal leakage problem. Leave-one-out CV (LOO, k=n) minimizes bias since each training set has n−1 samples, but maximizes variance because the n training sets overlap almost entirely, producing highly correlated error estimates. LOO is computationally expensive and generally not recommended for time series."
            },
            {
                type: "theory",
                title: "Walk-Forward & Purged Cross-Validation",
                content: "Walk-forward validation respects temporal ordering by always training on past data and testing on future data. The expanding window variant works as follows: Fold 1 trains on [1, T₁] and tests on (T₁, T₂]. Fold 2 trains on [1, T₂] and tests on (T₂, T₃]. Fold k trains on [1, Tₖ₋₁] and tests on (Tₖ₋₁, Tₖ]. Each subsequent fold has a strictly larger training set, mimicking the real-world scenario where your model is periodically retrained on all available history. The sliding window variant fixes the training window size W: Fold j trains on [Tⱼ₋₁ − W, Tⱼ₋₁] and tests on (Tⱼ₋₁, Tⱼ]. This captures regime changes better by discarding stale data.\n\nPurged cross-validation, introduced by Marcos López de Prado, addresses a subtler leakage: when the target variable yₜ depends on information from a window [t, t+h] (e.g., a forward return over h bars), a training observation at time t and a test observation at time t+1 share overlapping information. Purging removes from the training set any observation whose label window overlaps with a test observation. The embargo gap extends the purge by an additional buffer of h bars after the last training observation before the test fold begins, accounting for serial correlation in features.\n\nCombinatorial purged CV (CPCV) generalizes this by considering all possible (ⁿCₖ) ways to choose k test folds from n groups, applying purging and embargo to each combination. This produces more paths for evaluating strategy robustness.\n\nNumerical Example — 1000 bars, 5 folds, 24-bar embargo:\n• Without embargo: Fold 1 train [0, 199], test [200, 399]. Fold 2 train [0, 399], test [400, 599]. Fold 3 train [0, 599], test [600, 799]. Fold 4 train [0, 799], test [800, 999].\n• With 24-bar embargo: Fold 1 train [0, 175], test [200, 399] — last 24 training bars purged. Fold 2 train [0, 375], test [400, 599]. Fold 3 train [0, 575], test [600, 799]. Fold 4 train [0, 775], test [800, 999].\nThe purged version sacrifices 24 training observations per fold but eliminates the risk of information leakage through overlapping label windows."
            },
            {
                type: "theory",
                title: "Information Criteria & Hyperparameter Search",
                content: "Information criteria provide closed-form alternatives to cross-validation for model comparison. The Akaike Information Criterion is derived from minimizing the Kullback-Leibler divergence between the true distribution and the fitted model: AIC = 2k − 2ln(L̂), where k is the number of estimated parameters and L̂ is the maximized likelihood. AIC is asymptotically equivalent to leave-one-out CV and tends to select models with good predictive accuracy. The Bayesian Information Criterion applies a stronger complexity penalty: BIC = k·ln(n) − 2ln(L̂). For n ≥ 8, BIC penalizes additional parameters more heavily than AIC, leading to sparser models.\n\nWhen to use which: AIC is preferred when the goal is prediction — you want the model that best approximates the true data-generating process, even if it includes some redundant parameters. BIC is preferred for model identification — when you believe a true finite-dimensional model exists and want to recover it consistently (BIC is model-selection consistent as n → ∞). In forex modeling, AIC is typically more appropriate because the true process is unknown and likely infinite-dimensional.\n\nLearning curves plot training error and validation error as a function of training set size. High bias manifests as both curves converging at a high error level — adding more data does not help because the model is too simple. High variance manifests as a large gap between low training error and high validation error — more data would help because the model needs more examples to stabilize. The optimal regime shows both curves converging at a low error level with a small gap.\n\nHyperparameter search strategies vary in efficiency. Grid search exhaustively evaluates every point on a predefined grid — exponentially expensive as dimensionality grows (curse of dimensionality). Random search (Bergstra & Bengio, 2012) samples hyperparameters from specified distributions. Their key insight: for most problems, only a few hyperparameters matter, and random search covers the important dimensions more efficiently than grid search, which wastes evaluations on unimportant dimensions. Empirically, random search with 60 iterations matches or beats grid search with hundreds of evaluations. Bayesian optimization (e.g., Optuna, scikit-optimize) builds a surrogate model (typically Gaussian Process or Tree-structured Parzen Estimator) of the objective function and uses an acquisition function (Expected Improvement) to choose the next point to evaluate, concentrating evaluations in promising regions."
            },
            {
                type: "intuition",
                title: "The Newspaper Archive",
                analogy: "Imagine you are a journalist trying to predict tomorrow's front-page headline. Walk-forward validation is like sitting in a library with only past newspapers stacked chronologically — you read papers from January through June, then try to predict July's headline, then read through July and predict August. Standard k-fold cross-validation is like someone shuffling the entire newspaper archive and randomly handing you papers from January, April, September, and next February — you are unknowingly peeking at future events while trying to 'predict' the past. Purged CV goes further: it removes the last few days of newspapers before each test period, because yesterday's news might spoil today's prediction through lingering story arcs.",
                content: "This analogy captures why temporal ordering is sacred in financial prediction. Markets, like news cycles, have continuity — today's price action is influenced by yesterday's, and stories (trends, regimes) persist across days. Any validation scheme that ignores this continuity produces unrealistically optimistic accuracy estimates. The embargo gap in purged CV is like removing newspapers from the transition period where a developing story might appear in both your training and test sets, ensuring your predictions are genuinely out-of-sample.",
                emoji: "📰"
            },
            {
                type: "intuition",
                title: "The Goldilocks Zone",
                analogy: "The bias-variance tradeoff is Goldilocks tasting porridge. A linear model fitting a curved relationship is the porridge that is too cold — it systematically misses the pattern (high bias), but at least it is consistent across different bowls (low variance). A degree-20 polynomial is the porridge that is too hot — it perfectly captures every bump and wiggle in one bowl (low bias) but produces wildly different results with each new bowl (high variance). The ideal model is just right: flexible enough to capture the true pattern but constrained enough to generalize.",
                content: "Learning curves act as thermometers for diagnosing where you are in this spectrum. When both training and test error are high and converging (cold porridge), you need a more expressive model or better features. When training error is low but test error is high with a large gap (hot porridge), you need regularization, more data, or a simpler model. The sweet spot shows both errors low and converging — your model has found the Goldilocks zone. In forex, this zone is often surprisingly simple: slight regularization of a modest model outperforms elaborate architectures.",
                emoji: "🎯"
            },
            {
                type: "code",
                title: "Walk-Forward Validation with Purging",
                language: "python",
                code: `import numpy as np
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_squared_error

def walk_forward_cv(X, y, n_splits=5, embargo=0, expanding=True, window_size=None):
    """Walk-forward CV with optional embargo/purge gap."""
    n = len(X)
    fold_size = n // (n_splits + 1)
    results = []

    for i in range(n_splits):
        test_start = fold_size * (i + 1)
        test_end = min(fold_size * (i + 2), n)

        if expanding:
            train_start = 0
        else:
            train_start = max(0, test_start - (window_size or fold_size * 2))

        train_end = test_start - embargo  # purge: remove 'embargo' bars before test

        if train_end <= train_start:
            continue

        X_train, y_train = X[train_start:train_end], y[train_start:train_end]
        X_test, y_test = X[test_start:test_end], y[test_start:test_end]

        model = Ridge(alpha=1.0)
        model.fit(X_train, y_train)

        train_pred = model.predict(X_train)
        test_pred = model.predict(X_test)

        train_err = mean_squared_error(y_train, train_pred)
        test_err = mean_squared_error(y_test, test_pred)
        results.append({
            "fold": i + 1,
            "train_size": len(X_train),
            "test_size": len(X_test),
            "train_mse": round(train_err, 6),
            "test_mse": round(test_err, 6),
            "gap": round(test_err - train_err, 6)
        })

    return results

# --- Demonstration: purged vs non-purged ---
np.random.seed(42)
n_samples = 1000
X = np.random.randn(n_samples, 5)
# Autocorrelated target (simulates financial returns)
y = np.cumsum(np.random.randn(n_samples) * 0.01)

print("=== Walk-Forward CV WITHOUT embargo ===")
results_no_embargo = walk_forward_cv(X, y, n_splits=5, embargo=0)
for r in results_no_embargo:
    print(f"  Fold {r['fold']}: train_MSE={r['train_mse']:.6f}, "
          f"test_MSE={r['test_mse']:.6f}, gap={r['gap']:.6f}")

print("\\n=== Walk-Forward CV WITH 24-bar embargo ===")
results_embargo = walk_forward_cv(X, y, n_splits=5, embargo=24)
for r in results_embargo:
    print(f"  Fold {r['fold']}: train_MSE={r['train_mse']:.6f}, "
          f"test_MSE={r['test_mse']:.6f}, gap={r['gap']:.6f}")

avg_no = np.mean([r["test_mse"] for r in results_no_embargo])
avg_em = np.mean([r["test_mse"] for r in results_embargo])
print(f"\\nAvg test MSE without embargo: {avg_no:.6f}")
print(f"Avg test MSE with embargo:    {avg_em:.6f}")
print(f"Diagnostic: {'Embargo reveals higher true error' if avg_em > avg_no else 'Similar performance'}")`,
                explanation: "This implementation builds walk-forward cross-validation from scratch with configurable embargo/purge gaps. The embargo parameter removes a buffer of observations between the training and test sets, preventing information leakage through overlapping label windows or serial correlation. The expanding window grows the training set with each fold (mimicking real retraining), while the sliding window option keeps training size fixed. The train/test gap diagnostic helps identify overfitting — a large gap suggests the model memorizes training data patterns that do not persist into the test period."
            },
            {
                type: "code",
                title: "Learning Curves Diagnostic",
                language: "python",
                code: `import numpy as np
from sklearn.linear_model import Ridge
from sklearn.preprocessing import PolynomialFeatures
from sklearn.metrics import mean_squared_error
from sklearn.model_selection import TimeSeriesSplit

def compute_learning_curve(X, y, model, train_sizes, n_splits=3):
    """Compute learning curves using walk-forward validation."""
    results = {"train_sizes": [], "train_errors": [], "test_errors": []}

    for size in train_sizes:
        if size >= len(X) - 50:
            continue
        X_sub, y_sub = X[:size + 50], y[:size + 50]  # size for train + test
        tscv = TimeSeriesSplit(n_splits=n_splits, test_size=50)

        train_errs, test_errs = [], []
        for train_idx, test_idx in tscv.split(X_sub):
            if len(train_idx) < 20:
                continue
            model.fit(X_sub[train_idx], y_sub[train_idx])
            train_errs.append(mean_squared_error(y_sub[train_idx], model.predict(X_sub[train_idx])))
            test_errs.append(mean_squared_error(y_sub[test_idx], model.predict(X_sub[test_idx])))

        if train_errs:
            results["train_sizes"].append(size)
            results["train_errors"].append(np.mean(train_errs))
            results["test_errors"].append(np.mean(test_errs))

    return results

# --- Generate data with nonlinear pattern ---
np.random.seed(42)
X = np.linspace(0, 5, 800).reshape(-1, 1)
y = np.sin(X.ravel()) + 0.1 * np.random.randn(800)

train_sizes = [50, 100, 200, 300, 400, 500, 600, 700]

# Simple model (high bias) vs complex model (high variance)
for name, model in [("Ridge (high bias)", Ridge(alpha=10.0)),
                     ("Poly-8 Ridge (high variance)", None)]:
    if model is None:
        from sklearn.pipeline import make_pipeline
        model = make_pipeline(PolynomialFeatures(8), Ridge(alpha=0.01))

    lc = compute_learning_curve(X, y, model, train_sizes)

    print(f"\\n=== Learning Curve: {name} ===")
    print(f"{'Size':>6} | {'Train Err':>10} | {'Test Err':>10} | {'Gap':>10}")
    print("-" * 45)
    for s, tr, te in zip(lc["train_sizes"], lc["train_errors"], lc["test_errors"]):
        gap = te - tr
        bar = "█" * int(min(gap * 200, 30))
        print(f"{s:>6} | {tr:>10.5f} | {te:>10.5f} | {gap:>10.5f} {bar}")

    final_gap = lc["test_errors"][-1] - lc["train_errors"][-1]
    final_test = lc["test_errors"][-1]
    if final_gap < 0.01 and final_test > 0.05:
        print("  → Diagnosis: HIGH BIAS — model too simple, more data won't help")
    elif final_gap > 0.05:
        print("  → Diagnosis: HIGH VARIANCE — model too complex, more data may help")
    else:
        print("  → Diagnosis: GOOD FIT — balanced bias-variance tradeoff")`,
                explanation: "Learning curves reveal the bias-variance regime of your model by plotting train and test error against training set size. A high-bias model (Ridge with strong regularization) shows both errors converging at a high level — the model is too constrained to learn the pattern regardless of data quantity. A high-variance model (degree-8 polynomial with weak regularization) shows low training error but high test error, with the gap shrinking slowly as more data is added. The text-based bar chart visualizes the gap magnitude. The automatic diagnosis reads the curve shape to recommend next steps: simplify, add complexity, or add data."
            },
            {
                type: "code",
                title: "Random Search vs Grid Search Comparison",
                language: "python",
                code: `import numpy as np
import time
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import TimeSeriesSplit, GridSearchCV, RandomizedSearchCV
from sklearn.metrics import mean_squared_error
from scipy.stats import uniform, randint

# --- Generate autocorrelated financial-like data ---
np.random.seed(42)
n = 500
X = np.column_stack([
    np.random.randn(n, 3),
    np.sin(np.linspace(0, 10, n)),
    np.cumsum(np.random.randn(n) * 0.01)
])
y = 0.5 * X[:, 0] + 0.3 * np.sin(X[:, 3]) + 0.1 * np.random.randn(n)

tscv = TimeSeriesSplit(n_splits=4)

# Define hyperparameter space
param_grid = {
    "n_estimators": [50, 100, 150, 200],
    "max_depth": [2, 3, 4, 5],
    "learning_rate": [0.01, 0.05, 0.1, 0.2],
    "subsample": [0.6, 0.7, 0.8, 0.9, 1.0]
}
total_grid_combos = 4 * 4 * 4 * 5  # = 320 combinations

param_random = {
    "n_estimators": randint(50, 200),
    "max_depth": randint(2, 6),
    "learning_rate": uniform(0.01, 0.2),
    "subsample": uniform(0.6, 0.4)
}
n_random_iter = 40  # Only 12.5% of grid search evaluations

base_model = GradientBoostingRegressor(random_state=42)

# --- Grid Search ---
t0 = time.time()
grid_cv = GridSearchCV(base_model, param_grid, cv=tscv, scoring="neg_mean_squared_error", n_jobs=-1)
grid_cv.fit(X, y)
grid_time = time.time() - t0

# --- Random Search ---
t0 = time.time()
rand_cv = RandomizedSearchCV(base_model, param_random, n_iter=n_random_iter,
                              cv=tscv, scoring="neg_mean_squared_error",
                              n_jobs=-1, random_state=42)
rand_cv.fit(X, y)
rand_time = time.time() - t0

print("=== Grid Search vs Random Search (TimeSeriesSplit) ===\\n")
print(f"Grid Search:   {total_grid_combos} combos, best MSE = {-grid_cv.best_score_:.6f}, "
      f"time = {grid_time:.1f}s")
print(f"Random Search: {n_random_iter} combos, best MSE = {-rand_cv.best_score_:.6f}, "
      f"time = {rand_time:.1f}s")
print(f"\\nSpeedup: {grid_time / rand_time:.1f}x faster")
print(f"Quality: random found {(-rand_cv.best_score_ / -grid_cv.best_score_ * 100):.1f}% "
      f"of grid's best score")

print(f"\\nBest Grid params:   {grid_cv.best_params_}")
print(f"Best Random params: {rand_cv.best_params_}")

print("\\n--- Why Random Search Wins (Bergstra & Bengio 2012) ---")
print("Grid search wastes evaluations varying unimportant hyperparameters.")
print("Random search covers the important dimensions more efficiently,")
print(f"finding comparable results in {n_random_iter}/{total_grid_combos} "
      f"= {n_random_iter/total_grid_combos*100:.1f}% of the evaluations.")`,
                explanation: "This comparison demonstrates the Bergstra & Bengio (2012) result that random search outperforms grid search in efficiency. Both searches use TimeSeriesSplit to maintain temporal integrity. Grid search evaluates all 320 combinations in the Cartesian product of hyperparameter values, while random search samples only 40 random points from continuous distributions. The key insight is that most hyperparameters have low effective dimensionality — only 1-2 parameters typically matter, and random search explores those important dimensions more densely per evaluation. The output shows that random search achieves comparable performance in a fraction of the time."
            },
            {
                type: "quiz",
                questions: [
                    {
                        id: "cml-val-q1",
                        text: "Your model achieves 92% accuracy on the training set but only 51% on the test set. What is the most likely diagnosis?",
                        options: [
                            { id: "cml-val-q1-a", text: "High bias — the model is too simple to capture the pattern", isCorrect: false },
                            { id: "cml-val-q1-b", text: "High variance — the model has overfit the training data and fails to generalize", isCorrect: true },
                            { id: "cml-val-q1-c", text: "High irreducible error — the noise floor is too high for any model", isCorrect: false },
                            { id: "cml-val-q1-d", text: "The training and test sets are from different distributions (dataset shift)", isCorrect: false }
                        ],
                        explanation: "A 41-percentage-point gap between training (92%) and test (51%) accuracy is the classic signature of high variance / overfitting. The model has memorized training set patterns (including noise) that do not persist in the test data. High bias would show both errors being high. While dataset shift could contribute, the primary diagnosis from this error profile is overfitting."
                    },
                    {
                        id: "cml-val-q2",
                        text: "Why is an embargo gap needed in purged cross-validation for financial time series?",
                        options: [
                            { id: "cml-val-q2-a", text: "To ensure equal fold sizes across all splits", isCorrect: false },
                            { id: "cml-val-q2-b", text: "To prevent information leakage when target labels depend on overlapping future windows and serial correlation persists across the train/test boundary", isCorrect: true },
                            { id: "cml-val-q2-c", text: "To reduce computational cost by using fewer training samples", isCorrect: false },
                            { id: "cml-val-q2-d", text: "To stratify the folds by class distribution", isCorrect: false }
                        ],
                        explanation: "When the target yₜ is computed from a forward window [t, t+h] (e.g., forward returns), training observations near the test fold boundary have labels that overlap with test observations' labels. The embargo gap removes h additional bars after the last training observation, ensuring no information from the label computation window can leak from training to test. Serial correlation in features compounds this leakage without proper embargo."
                    },
                    {
                        id: "cml-val-q3",
                        text: "When should you prefer BIC over AIC for model selection?",
                        options: [
                            { id: "cml-val-q3-a", text: "When your primary goal is predictive accuracy on unseen data", isCorrect: false },
                            { id: "cml-val-q3-b", text: "When you have very few data points and need to avoid overfitting", isCorrect: false },
                            { id: "cml-val-q3-c", text: "When you believe a true finite-dimensional model exists and want to identify the correct model structure consistently", isCorrect: true },
                            { id: "cml-val-q3-d", text: "When you want to minimize computational cost of model comparison", isCorrect: false }
                        ],
                        explanation: "BIC is model-selection consistent: as n → ∞, it recovers the true model with probability 1, assuming the true model is in the candidate set. Its stronger penalty k·ln(n) vs AIC's 2k favors parsimonious models. AIC is preferred for prediction because it approximates leave-one-out CV error and does not assume a true finite-dimensional model. In forex modeling, AIC is typically more appropriate because the true data-generating process is unknown."
                    },
                    {
                        id: "cml-val-q4",
                        text: "If a model has Bias²(ŷ) = 0.10, Var(ŷ) = 0.30, and irreducible noise σ² = 0.05, what is the expected prediction error E[(y − ŷ)²]?",
                        options: [
                            { id: "cml-val-q4-a", text: "0.35" },
                            { id: "cml-val-q4-b", text: "0.40" },
                            { id: "cml-val-q4-c", text: "0.45", isCorrect: true },
                            { id: "cml-val-q4-d", text: "0.15" }
                        ],
                        explanation: "By the bias-variance decomposition: E[(y − ŷ)²] = Bias² + Variance + σ² = 0.10 + 0.30 + 0.05 = 0.45. The three components are additive. Notice that variance dominates here (0.30), suggesting the model is overfitting and would benefit from regularization or simplification, even though bias is moderate."
                    },
                    {
                        id: "cml-val-q5",
                        text: "Why does random search often find hyperparameters as good as grid search with far fewer evaluations?",
                        options: [
                            { id: "cml-val-q5-a", text: "Random search uses a smarter optimization algorithm internally", isCorrect: false },
                            { id: "cml-val-q5-b", text: "Most problems have low effective dimensionality — only a few hyperparameters matter — and random search covers the important dimensions more densely per evaluation", isCorrect: true },
                            { id: "cml-val-q5-c", text: "Random search always samples from better distributions than grid search", isCorrect: false },
                            { id: "cml-val-q5-d", text: "Grid search is biased toward suboptimal regions of the search space", isCorrect: false }
                        ],
                        explanation: "Bergstra & Bengio (2012) showed that for most ML problems, performance depends strongly on only 1-2 hyperparameters. Grid search allocates evaluations uniformly across all dimensions, wasting trials on varying unimportant parameters. Random search projects differently onto each dimension for every trial, effectively sampling more unique values of the important parameters. With 60 random trials, you get 60 distinct values of each important parameter, versus only a handful with grid search."
                    },
                    {
                        id: "cml-val-q6",
                        text: "By approximately how much can standard shuffled k-fold cross-validation inflate reported accuracy compared to walk-forward validation on autocorrelated financial time series?",
                        options: [
                            { id: "cml-val-q6-a", text: "Less than 1% — the difference is negligible", isCorrect: false },
                            { id: "cml-val-q6-b", text: "1–3% — a minor but noticeable inflation", isCorrect: false },
                            { id: "cml-val-q6-c", text: "5–30% — a substantial and dangerously misleading inflation", isCorrect: true },
                            { id: "cml-val-q6-d", text: "Over 50% — shuffled CV essentially reports random performance as perfect", isCorrect: false }
                        ],
                        explanation: "Empirical studies consistently show that shuffled k-fold CV on time series data inflates accuracy by 5–30% depending on the autocorrelation structure, feature construction, and prediction horizon. A model with 55% true walk-forward accuracy (a realistic forex edge) might report 65–75% on shuffled CV — a result that would mislead a trader into deploying a model with no real predictive power. This is one of the most common and dangerous mistakes in financial ML."
                    },
                    {
                        id: "cml-val-q7",
                        text: "Your learning curve shows that both training error and test error are high and have converged to similar values as training size increases. What does this indicate, and what should you do?",
                        options: [
                            { id: "cml-val-q7-a", text: "High variance — reduce model complexity or add regularization", isCorrect: false },
                            { id: "cml-val-q7-b", text: "High bias — the model is too simple; use a more expressive model or engineer better features", isCorrect: true },
                            { id: "cml-val-q7-c", text: "Good fit — the model is performing optimally", isCorrect: false },
                            { id: "cml-val-q7-d", text: "Data quality issue — collect cleaner data", isCorrect: false }
                        ],
                        explanation: "When both training and test errors are high and converged, the model has high bias (underfitting). It cannot capture the underlying pattern regardless of how much data it sees — the learning curves have plateaued at an unacceptable error level. The fix is to increase model capacity: use a more flexible model class, add polynomial/interaction features, reduce regularization strength, or engineer features that better capture the signal. Adding more data will NOT help in this regime."
                    }
                ]
            },
            {
                type: "practice",
                title: "Walk-Forward Complexity Analysis",
                description: "Choose any regression or classification model from scikit-learn. Implement walk-forward cross-validation with 5 folds and then 10 folds. For each fold count, systematically vary model complexity (e.g., polynomial degree, tree depth, regularization strength) and record both training and test errors. Plot the train/test gap as a function of complexity. Identify the complexity level where the gap begins to widen significantly — this is your overfitting threshold. Compare results between 5-fold and 10-fold splits: does finer temporal resolution change the optimal complexity? Document how the expanding training window affects the stability of your complexity selection across folds."
            },
            {
                type: "practice",
                title: "Bias-Variance Learning Curve Diagnosis",
                description: "Use the dashboard's learning curves view to generate diagnostic plots for at least three models of varying complexity (e.g., linear regression, random forest with max_depth=3, and gradient boosting with max_depth=8). For each model, examine how training and test error evolve as the training set grows. Classify each model as high-bias, high-variance, or well-balanced based on the curve shapes. For any high-bias model, propose and test a more expressive alternative. For any high-variance model, apply regularization or reduce features and re-examine the curves. Write a brief summary comparing all models and recommend which would be most suitable for a walk-forward forex prediction task.",
                catalogModelId: "learning-curves-diagnostic"
            }
        ]
    }
,
    {
        id: "cml-stacking-blending",
        title: "Stacking & Model Blending",
        description: "Master Wolpert's stacked generalization framework (1992), where diverse base learners produce cross-validated out-of-fold predictions that feed a meta-learner for superior predictive performance. Explore the critical role of CV-based OOF prediction generation in preventing target leakage, the mathematics of base learner diversity and its impact on ensemble error through the ambiguity decomposition. Compare blending (holdout-based) versus stacking (CV-based) approaches, study van der Laan's Super Learner with its asymptotic optimality guarantees, and build production-ready forex multi-model ensembles that combine fundamentally different learning algorithms to capture complementary market signals across varying regimes.",
        estimatedMinutes: 75,
        difficulty: "intermediate",
        prerequisites: ["cml-tree-models", "cml-boosting"],
        sections: [
            {
                type: "objective",
                content: "By the end of this lesson, you will understand Wolpert's stacked generalization framework and why cross-validated out-of-fold predictions are essential for honest meta-learner training. You will be able to implement both stacking and blending from scratch, measure and maximize base learner diversity using formal metrics, and build multi-model forex ensembles that outperform any single constituent model by combining complementary prediction strategies.",
                keyTakeaways: [
                    "Stacked generalization uses CV-based out-of-fold predictions to train a meta-learner on top of diverse base models, avoiding the overfitting that direct training-set predictions would cause",
                    "The ambiguity decomposition E_ensemble = E̅ − Ā proves mathematically that ensemble error decreases as base learner diversity (ambiguity) increases",
                    "Blending uses a simple holdout split for meta-learner training — simpler but data-inefficient compared to stacking's full CV approach",
                    "The Super Learner (van der Laan 2007) uses non-negative least squares as the meta-learner and is proven asymptotically optimal among all weighted combinations of base learners",
                    "Base learner diversity is more important than individual model accuracy — three different 60% accuracy models can outperform three identical 65% models when combined",
                    "Time-series stacking requires TimeSeriesSplit with embargo periods to prevent future information from leaking into meta-learner training",
                    "Logistic regression is the preferred meta-learner because its simplicity prevents second-level overfitting while its coefficients reveal each base model's relative contribution",
                    "Multi-layer stacking (stacks of stacks) can capture higher-order interactions but increases overfitting risk and computational cost exponentially"
                ]
            },
            {
                type: "theory",
                title: "Wolpert's Stacked Generalization",
                content: "Stacked generalization, introduced by David Wolpert in 1992, is a principled framework for combining multiple learning algorithms into a single predictive system. The architecture consists of two levels: Level-0 contains B diverse base learners {h₁, h₂, ..., h_B}, each trained on the original features X to predict target y. Level-1 contains a single meta-learner g that learns to optimally combine the base learner predictions. The key innovation is HOW the training data for the meta-learner is generated.\n\nEach base learner hⱼ is trained via k-fold cross-validation, producing out-of-fold (OOF) predictions for every training example. For each fold f, model hⱼ is trained on all data EXCEPT fold f, then predicts on fold f. This produces an n×B matrix Z where Zᵢⱼ = hⱼ(xᵢ) — critically, this prediction comes from a version of hⱼ that never saw xᵢ during training. The meta-learner g then trains on (Z, y) to learn the optimal combination function. The final prediction for new data is: ŷ = g(h₁(x), h₂(x), ..., h_B(x)).\n\nWhy is cross-validation REQUIRED for generating Z? Without it, base model predictions on their own training data are overfit — a model that memorizes the training set would produce perfect predictions on training data. The meta-learner, seeing these perfect predictions, would learn to trust the most overfit model completely. CV-based OOF predictions simulate genuine out-of-sample performance, giving the meta-learner honest signals about each base model's true predictive ability.\n\nNumerical example with 3 base models and 3-fold CV on 9 samples. Fold 1 (samples 1-3): train h₁, h₂, h₃ on samples 4-9, predict on samples 1-3. Suppose h₁ predicts [0.7, 0.3, 0.8], h₂ predicts [0.6, 0.4, 0.7], h₃ predicts [0.8, 0.2, 0.9]. Fold 2 (samples 4-6): train on samples {1-3, 7-9}, predict on 4-6. Fold 3 (samples 7-9): train on samples 1-6, predict on 7-9. Stack all fold predictions vertically: the complete Z matrix has shape 9×3, where each row i contains predictions from models that never trained on sample i. The meta-learner then fits g on this 9×3 matrix against the true labels y.\n\nThe mathematical elegance is that stacking reduces the bias-variance tradeoff at the ensemble level. If base learners have low correlation in their errors (high diversity), the meta-learner can exploit complementary strengths — trusting model A when B and C tend to fail, and vice versa. This is impossible with simple averaging, which gives equal weight regardless of context."
            },
            {
                type: "theory",
                title: "Blending vs Stacking and the Super Learner",
                content: "Blending is a simplified alternative to stacking that avoids the complexity of cross-validation. The procedure is straightforward: split the training data into two parts, typically 70% for training and 30% for blending. Train all base models on the 70% portion. Generate predictions from each base model on the held-out 30%. Train the meta-learner on these 30% predictions paired with their true labels. The advantage is simplicity — no need for CV loops, no risk of CV implementation bugs. The disadvantage is significant: 30% of training data is never used to train base models, and the meta-learner sees only 30% of examples.\n\nStacking recovers this data efficiency through cross-validation. Every training example contributes to both base model training (in k-1 folds) and meta-learner training (via its OOF prediction). With 5-fold CV, each base model is trained on 80% of data for each fold, and the meta-learner trains on OOF predictions for all 100% of examples. The cost is computational: each base model must be trained k times instead of once. For B base models and k folds, stacking requires B × k model fits versus B fits for blending.\n\nThe Super Learner, formalized by van der Laan, Polley, and Hubbard (2007), is a specific implementation of stacking with a remarkable theoretical property. It uses V-fold cross-validation for OOF generation and constrains the meta-learner to non-negative least squares (NNLS) — the meta-learner finds weights w₁, ..., w_B that minimize ‖y − Σwⱼhⱼ(x)‖² subject to wⱼ ≥ 0 and Σwⱼ = 1. The key theorem: the Super Learner is asymptotically equivalent to the oracle selector — the meta-learner that picks the best-performing model in hindsight. This means stacking with NNLS converges to the optimal combination as sample size grows.\n\nMulti-layer stacking extends the concept by adding additional meta-learner levels. Level-0 base models feed Level-1 meta-learners, whose predictions feed a Level-2 meta-meta-learner. Each additional layer increases the risk of overfitting and computational cost, with diminishing returns. In practice, two levels (base + one meta) suffice for most applications. Three levels are occasionally beneficial in competition settings but rarely in production.\n\nWhen does stacking hurt? With too few samples (under ~500), the CV-based OOF predictions are noisy and the meta-learner overfits to noise in the Z matrix. With homogeneous base learners (e.g., three random forests with slightly different hyperparameters), stacking provides minimal benefit over simple averaging because the models make correlated errors — there is no complementary signal for the meta-learner to exploit."
            },
            {
                type: "theory",
                title: "Base Learner Diversity and the Ambiguity Decomposition",
                content: "The success of any ensemble method hinges on diversity among its base learners. This is formalized through several measures. The Q-statistic between two classifiers hᵢ and hⱼ measures their agreement: Q = (N¹¹N⁰⁰ − N¹⁰N⁰¹) / (N¹¹N⁰⁰ + N¹⁰N⁰¹), where N^ab counts samples where hᵢ is correct (a=1) or wrong (a=0) and hⱼ is correct (b=1) or wrong (b=0). Q ranges from -1 (maximally diverse) to +1 (identical). The disagreement measure is simply the proportion of samples where the two classifiers disagree. The double-fault measure counts only cases where BOTH classifiers are wrong — low double-fault is desirable.\n\nThe ambiguity decomposition provides the theoretical foundation: E_ensemble = E̅ − Ā. Here E̅ is the weighted average individual error of all base learners, and Ā is the weighted average ambiguity (diversity), defined as the average squared deviation of individual predictions from the ensemble prediction. This equation is an identity — it always holds. The implication is profound: ensemble error is ALWAYS less than or equal to average individual error, and the gap equals the ambiguity. More diversity → larger Ā → lower ensemble error.\n\nHow to create diversity in practice: (1) Different algorithms — combine a tree-based model (captures non-linear interactions), a linear model (captures global trends), and a distance-based model (captures local patterns). (2) Different feature subsets — one model sees technical indicators, another sees price action, a third sees volume profiles. (3) Different training subsets — bagging creates diversity through bootstrap sampling. (4) Different hyperparameters — a shallow tree (high bias) and a deep tree (high variance) make different types of errors.\n\nNumerical example: Three models with individual error rates ε₁=0.35, ε₂=0.38, ε₃=0.33 and pairwise prediction correlations ρ₁₂=0.3, ρ₁₃=0.25, ρ₂₃=0.28. Average individual error E̅ = (0.35+0.38+0.33)/3 = 0.353. The average pairwise correlation is ρ̄ = (0.3+0.25+0.28)/3 = 0.277. For equal-weight averaging, ensemble error is approximately bounded by E̅ × [ρ̄ + (1−ρ̄)/B] = 0.353 × [0.277 + 0.723/3] = 0.353 × 0.518 = 0.183. The ensemble error bound (0.183) is roughly half the average individual error (0.353) — this dramatic improvement comes entirely from diversity (low correlation). If ρ̄ were 0.9 instead, ensemble error would be 0.353 × [0.9 + 0.1/3] = 0.353 × 0.933 = 0.329, barely better than individual models."
            },
            {
                type: "theory",
                title: "Preventing Leakage in Stacked Ensembles",
                content: "Target leakage in stacking is subtle and devastating. The most obvious source: using training-set predictions (not OOF predictions) to train the meta-learner. A gradient boosting model with 1000 trees can achieve near-zero training error, so the meta-learner would assign it all the weight — even if it generalizes poorly. This is exactly Wolpert's original motivation for requiring cross-validation in the stacking procedure.\n\nA second leakage source arises in feature engineering. If you compute features on the entire dataset (e.g., z-score normalization using full-dataset mean and std, or target encoding using all labels), then split into CV folds, information from the test fold has leaked into the training fold through the feature statistics. The fix: all feature engineering must occur INSIDE each CV fold, computed only on the training portion. This means maintaining separate scalers, encoders, and transformations for each fold.\n\nTime-series stacking introduces additional leakage risks. Standard k-fold CV randomly assigns samples to folds, so a Tuesday sample might be in the training fold while the preceding Monday sample is in the test fold — the model effectively sees the future. The solution is TimeSeriesSplit, where each fold uses only past data for training and future data for testing. Additionally, an embargo period should separate the training and test portions to prevent overlapping look-ahead windows in feature computation.\n\nNested CV handles another subtle issue: hyperparameter tuning within stacking. If you tune base model hyperparameters using the same CV folds that generate OOF predictions, the hyperparameters are optimized for those specific folds, biasing the OOF predictions. The proper approach is nested CV: an inner CV loop tunes hyperparameters, and an outer CV loop generates honest OOF predictions using the tuned models. For time-series, this means an inner TimeSeriesSplit within each outer TimeSeriesSplit fold.\n\nPractical checklist for leak-free stacking in forex: (1) Use TimeSeriesSplit with purging and embargo for OOF generation. (2) Fit all transformers (scalers, encoders) inside each fold. (3) Never include future-looking features (forward returns, future volatility). (4) Use nested CV if tuning base model hyperparameters. (5) Validate final ensemble on a truly held-out test period that no base model or meta-learner has ever seen — not even through CV."
            },
            {
                type: "intuition",
                title: "Panel of Expert Analysts",
                analogy: "Imagine a hedge fund with three expert analysts providing forex forecasts. The technician studies charts and patterns, predicting based on support/resistance levels and momentum. The economist analyzes interest rate differentials, GDP growth, and central bank policies. The quant builds statistical models from historical price distributions. Each expert has genuine blind spots — the technician misses fundamental shifts, the economist ignores short-term price dynamics, and the quant's models break during regime changes. A senior portfolio manager (the meta-learner) has observed each expert's track record across hundreds of genuine out-of-sample predictions. She knows the technician excels in trending markets, the economist shines around policy announcements, and the quant is best in range-bound conditions. She weighs their opinions dynamically based on this track record. Crucially, she evaluates experts on genuine predictions — not on their ability to 'predict' events they already knew about. This is why OOF predictions are essential in stacking.",
                content: "The panel analogy captures the three essential ingredients of successful stacking. First, expert diversity — three technicians would be redundant regardless of individual skill. Second, honest evaluation — the portfolio manager must judge experts on genuinely out-of-sample calls, not retroactive analysis. Third, learned combination — the manager does not simply average opinions but learns context-dependent weighting. In forex stacking, your base models ARE the diverse experts, your OOF predictions ARE their honest track records, and your meta-learner IS the portfolio manager learning optimal combination weights.",
                emoji: "👥"
            },
            {
                type: "intuition",
                title: "The Relay Race Team",
                analogy: "Consider assembling a relay race team. You might think selecting the four fastest sprinters gives you the best team. But a relay race has four legs with different demands — the start requires explosive acceleration, middle legs need sustained speed, and the anchor leg demands composure under pressure. A team of four specialists — a start specialist, two speed sustainers, and a clutch closer — will beat four generic sprinters even if each specialist is individually slower. The coach (meta-learner) does not run any leg himself but decides the running order and how much each leg matters to the overall time. Critically, the coach evaluates runners in practice races (OOF predictions), not in the gym (training predictions), because gym performance does not predict race-day results.",
                content: "This analogy illuminates why a team of four identical sprinters (homogeneous base learners) performs worse than a diverse team despite higher individual averages. In stacking, a random forest might be your sprinter (fast, reliable), a support vector machine your distance runner (excels with clear margins), a gradient boosted tree your hurdler (handles obstacles/non-linearities), and a naive Bayes your decathlete (versatile baseline). The meta-learner coaches by learning which model to trust in which market condition — trending markets favor momentum-sensitive models, while mean-reverting markets favor models trained on oscillators.",
                emoji: "🏃"
            },
            {
                type: "code",
                title: "Stacking from Scratch: OOF Prediction Matrix",
                language: "python",
                code: `import numpy as np
from sklearn.model_selection import KFold
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.svm import SVC
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score
from sklearn.datasets import make_classification

# Generate synthetic forex-like binary classification data
X, y = make_classification(n_samples=1000, n_features=20,
                           n_informative=10, random_state=42)

# Define base learners (Level-0) — diversity is key
base_models = [
    ("RF", RandomForestClassifier(n_estimators=100, random_state=42)),
    ("GBT", GradientBoostingClassifier(n_estimators=100, random_state=42)),
    ("SVM", SVC(kernel="rbf", probability=True, random_state=42))
]

# Step 1: Build OOF prediction matrix Z using k-fold CV
n_folds = 5
kf = KFold(n_splits=n_folds, shuffle=True, random_state=42)
Z_train = np.zeros((len(X), len(base_models)))  # n x B OOF matrix

for model_idx, (name, model) in enumerate(base_models):
    print(f"\\nBuilding OOF predictions for {name}:")
    for fold_idx, (train_idx, val_idx) in enumerate(kf.split(X)):
        # Train on k-1 folds
        model_clone = model.__class__(**model.get_params())
        model_clone.fit(X[train_idx], y[train_idx])
        # Predict on held-out fold (OOF predictions)
        Z_train[val_idx, model_idx] = model_clone.predict_proba(X[val_idx])[:, 1]
        fold_acc = accuracy_score(y[val_idx], (Z_train[val_idx, model_idx] > 0.5).astype(int))
        print(f"  Fold {fold_idx+1}: {len(val_idx)} samples, accuracy={fold_acc:.4f}")

# Individual model OOF accuracies
for i, (name, _) in enumerate(base_models):
    acc = accuracy_score(y, (Z_train[:, i] > 0.5).astype(int))
    print(f"\\n{name} OOF accuracy: {acc:.4f}")

# Step 2: Train meta-learner (Level-1) on OOF matrix
meta_learner = LogisticRegression(random_state=42)
meta_learner.fit(Z_train, y)

# Meta-learner coefficients reveal model importance
print(f"\\nMeta-learner weights: {dict(zip([n for n,_ in base_models], meta_learner.coef_[0].round(4)))}")

# Step 3: For new data, train base models on ALL training data
Z_display = Z_train[:5].round(3)
print(f"\\nOOF matrix Z (first 5 rows):\\n{Z_display}")
print(f"True labels:  {y[:5]}")
print(f"Meta predictions: {meta_learner.predict(Z_display)}")

# Stacked ensemble OOF accuracy
stacked_preds = meta_learner.predict(Z_train)
print(f"\\nStacked ensemble OOF accuracy: {accuracy_score(y, stacked_preds):.4f}")`,
                explanation: "This implementation builds the OOF prediction matrix Z from scratch. For each base model, we iterate through k folds: train on k-1 folds and predict on the held-out fold. The key insight is that Z_train[val_idx, model_idx] stores predictions from a model that NEVER saw those samples during training — this prevents the meta-learner from learning to exploit overfit predictions. The meta-learner (logistic regression) then learns optimal combination weights from Z. Notice how each fold's accuracy gives an honest per-fold estimate, and the final stacked accuracy typically exceeds any individual model's OOF accuracy."
            },
            {
                type: "code",
                title: "StackingClassifier for Forex Direction Prediction",
                language: "python",
                code: `import numpy as np
from sklearn.ensemble import StackingClassifier, RandomForestClassifier
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.svm import SVC
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import TimeSeriesSplit, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.datasets import make_classification

# Simulate forex features: RSI, MACD, ATR, Bollinger %B, etc.
np.random.seed(42)
n_samples = 2000
X = np.random.randn(n_samples, 15)  # 15 technical indicators
y = (X[:, 0] * 0.3 + X[:, 2] * 0.2 + X[:, 5] * 0.15
     + np.random.randn(n_samples) * 0.5 > 0).astype(int)

# Define diverse base learners with preprocessing pipelines
estimators = [
    ("rf", Pipeline([
        ("scaler", StandardScaler()),
        ("clf", RandomForestClassifier(n_estimators=200, max_depth=8, random_state=42))
    ])),
    ("gbt", Pipeline([
        ("scaler", StandardScaler()),
        ("clf", GradientBoostingClassifier(n_estimators=150, max_depth=4, random_state=42))
    ])),
    ("svm", Pipeline([
        ("scaler", StandardScaler()),
        ("clf", SVC(kernel="rbf", C=1.0, probability=True, random_state=42))
    ]))
]

# Build stacking classifier with time-series-aware CV
stacking_clf = StackingClassifier(
    estimators=estimators,
    final_estimator=LogisticRegression(C=1.0, random_state=42),
    cv=TimeSeriesSplit(n_splits=5),  # Respects temporal ordering
    stack_method="predict_proba",     # Use probabilities, not hard labels
    passthrough=False                 # Only base model predictions to meta-learner
)

# Evaluate with proper time-series CV
tscv = TimeSeriesSplit(n_splits=5)

# Compare individual models vs stacked ensemble
print("=== Individual Model Performance (TimeSeriesSplit) ===")
for name, pipeline in estimators:
    scores = cross_val_score(pipeline, X, y, cv=tscv, scoring="accuracy")
    print(f"{name.upper():>4}: mean={scores.mean():.4f}, std={scores.std():.4f}, "
          f"per-fold={np.round(scores, 4)}")

print("\\n=== Stacked Ensemble Performance ===")
stack_scores = cross_val_score(stacking_clf, X, y, cv=tscv, scoring="accuracy")
print(f"Stack: mean={stack_scores.mean():.4f}, std={stack_scores.std():.4f}, "
      f"per-fold={np.round(stack_scores, 4)}")

# Fit on full data to inspect meta-learner weights
stacking_clf.fit(X, y)
meta_coefs = stacking_clf.final_estimator_.coef_[0]
print(f"\\n=== Meta-Learner Weights ===")
# StackingClassifier with predict_proba creates 2 columns per base model
for i, (name, _) in enumerate(estimators):
    # Weights for class 0 and class 1 probabilities
    w0, w1 = meta_coefs[i*2], meta_coefs[i*2 + 1]
    print(f"{name.upper():>4}: class_0_weight={w0:.4f}, class_1_weight={w1:.4f}")

print(f"\\nIntercept: {stacking_clf.final_estimator_.intercept_[0]:.4f}")
improvement = stack_scores.mean() - max(
    cross_val_score(p, X, y, cv=tscv, scoring="accuracy").mean()
    for _, p in estimators)
print(f"Stacking improvement over best individual: {improvement:+.4f}")`,
                explanation: "This uses sklearn's StackingClassifier with TimeSeriesSplit to respect temporal ordering — critical for forex data where future information must not leak into past predictions. The stack_method='predict_proba' passes probability estimates (not hard 0/1 predictions) to the meta-learner, giving it richer signals about each base model's confidence. The meta-learner coefficients reveal which base models contribute most. Note that with predict_proba and binary classification, each base model produces two columns (P(class=0) and P(class=1)), so the meta-learner has 6 input features for 3 base models."
            },
            {
                type: "code",
                title: "Blending Implementation and Comparison",
                language: "python",
                code: `import numpy as np
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.svm import SVC
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score
from sklearn.preprocessing import StandardScaler
from sklearn.datasets import make_classification

# Generate data
X, y = make_classification(n_samples=1500, n_features=20,
                           n_informative=10, random_state=42)

# === BLENDING: Simple holdout approach ===
split_idx = int(len(X) * 0.70)  # 70/30 split
X_train_blend, X_blend = X[:split_idx], X[split_idx:]
y_train_blend, y_blend = y[:split_idx], y[split_idx:]

scaler = StandardScaler().fit(X_train_blend)
X_train_scaled = scaler.transform(X_train_blend)
X_blend_scaled = scaler.transform(X_blend)

base_models = [
    ("RF", RandomForestClassifier(n_estimators=100, random_state=42)),
    ("GBT", GradientBoostingClassifier(n_estimators=100, random_state=42)),
    ("SVM", SVC(kernel="rbf", probability=True, random_state=42))
]

# Train base models on 70%, predict on 30%
Z_blend = np.zeros((len(X_blend), len(base_models)))
print("=== Blending (70/30 Split) ===")
print(f"Training samples: {len(X_train_blend)}, Blending samples: {len(X_blend)}")

for i, (name, model) in enumerate(base_models):
    model.fit(X_train_scaled, y_train_blend)
    Z_blend[:, i] = model.predict_proba(X_blend_scaled)[:, 1]
    acc = accuracy_score(y_blend, (Z_blend[:, i] > 0.5).astype(int))
    print(f"  {name} on blend set: {acc:.4f}")

# Train meta-learner on blending predictions
meta_blend = LogisticRegression(random_state=42)
meta_blend.fit(Z_blend, y_blend)
blend_preds = meta_blend.predict(Z_blend)
blend_acc = accuracy_score(y_blend, blend_preds)
print(f"  Blended ensemble: {blend_acc:.4f}")

# === COMPARISON: Blending vs Stacking vs Averaging ===
# Simple averaging baseline
avg_preds = (Z_blend.mean(axis=1) > 0.5).astype(int)
avg_acc = accuracy_score(y_blend, avg_preds)

print(f"\\n=== Method Comparison (on blend set) ===")
print(f"  Simple averaging:  {avg_acc:.4f}")
print(f"  Blending:          {blend_acc:.4f}")
print(f"\\n=== Trade-offs ===")
print(f"  Blending: base models trained on {split_idx} samples (70%)")
print(f"  Stacking: base models trained on {int(split_idx*4/5)}-{split_idx} samples per fold")
print(f"  Blending: meta-learner sees {len(X_blend)} samples")
print(f"  Stacking: meta-learner sees ALL {len(X)} samples")
print(f"  Blending: {len(base_models)} model fits")
print(f"  Stacking: {len(base_models)} x 5 = {len(base_models)*5} model fits")`,
                explanation: "Blending's simplicity is apparent: train on 70%, predict on the held-out 30%, and train the meta-learner on those predictions. No cross-validation loops, no clone management. The trade-off comparison at the end is revealing — blending wastes 30% of data for base model training AND limits the meta-learner to only 30% of samples. Stacking uses all data for both levels at the cost of B×k model fits. For small forex datasets (a few thousand samples), stacking's data efficiency often outweighs blending's simplicity."
            },
            {
                type: "quiz",
                questions: [
                    {
                        id: "cml-stack-q1",
                        text: "Why must stacking use out-of-fold (OOF) predictions rather than training-set predictions to build the meta-learner's input matrix?",
                        options: [
                            { id: "cml-stack-q1-a", text: "OOF predictions are faster to compute since they use smaller training sets", isCorrect: false },
                            { id: "cml-stack-q1-b", text: "Training-set predictions are overfit, causing the meta-learner to favor the most overfit base model rather than the most generalizable one", isCorrect: true },
                            { id: "cml-stack-q1-c", text: "OOF predictions produce more training examples for the meta-learner", isCorrect: false },
                            { id: "cml-stack-q1-d", text: "Training-set predictions have higher variance, making the meta-learner unstable", isCorrect: false }
                        ],
                        explanation: "Training-set predictions from overfit models (e.g., a deep tree with zero training error) look artificially perfect. The meta-learner, seeing these perfect predictions, would assign all weight to the most overfit model. OOF predictions simulate genuine out-of-sample performance, giving the meta-learner honest signals about each base model's true generalization ability."
                    },
                    {
                        id: "cml-stack-q2",
                        text: "According to the ambiguity decomposition E_ensemble = E̅ − Ā, why is base learner diversity critical for ensemble performance?",
                        options: [
                            { id: "cml-stack-q2-a", text: "Diversity increases the average individual accuracy E̅ of base models", isCorrect: false },
                            { id: "cml-stack-q2-b", text: "Diversity reduces the computational cost of training the meta-learner", isCorrect: false },
                            { id: "cml-stack-q2-c", text: "Higher diversity increases the ambiguity term Ā, which is subtracted from average error, directly reducing ensemble error", isCorrect: true },
                            { id: "cml-stack-q2-d", text: "Diversity ensures all base models converge to the same optimal solution", isCorrect: false }
                        ],
                        explanation: "The ambiguity decomposition is an identity: E_ensemble = E̅ − Ā. Since Ā (ambiguity/diversity) is subtracted from the average individual error E̅, higher diversity directly reduces ensemble error. This is why three different 60%-accuracy models (high Ā) can outperform three identical 65%-accuracy models (Ā ≈ 0) when combined."
                    },
                    {
                        id: "cml-stack-q3",
                        text: "How does stacking fundamentally differ from simple averaging of model predictions?",
                        options: [
                            { id: "cml-stack-q3-a", text: "Stacking uses more base models than simple averaging", isCorrect: false },
                            { id: "cml-stack-q3-b", text: "Simple averaging gives equal weight to all models, while stacking learns optimal context-dependent combination weights from data", isCorrect: true },
                            { id: "cml-stack-q3-c", text: "Stacking only works with classification, while averaging works with both classification and regression", isCorrect: false },
                            { id: "cml-stack-q3-d", text: "Simple averaging requires cross-validation while stacking does not", isCorrect: false }
                        ],
                        explanation: "Simple averaging assigns weight 1/B to each of B models regardless of their performance or the input context. Stacking trains a meta-learner that learns optimal combination weights from OOF predictions. The meta-learner can assign higher weights to models that perform better overall, and with non-linear meta-learners, can even learn context-dependent weighting (trusting different models in different regions of the feature space)."
                    },
                    {
                        id: "cml-stack-q4",
                        text: "Three forex models have individual accuracies of 0.60, 0.58, and 0.62 with average pairwise prediction correlation ρ̄ = 0.3. Using the ensemble error bound formula E_ensemble ≈ E̅ × [ρ̄ + (1−ρ̄)/B], what is the approximate ensemble error rate?",
                        options: [
                            { id: "cml-stack-q4-a", text: "Approximately 0.40 — no improvement over individual models", isCorrect: false },
                            { id: "cml-stack-q4-b", text: "Approximately 0.21 — about half the individual error", isCorrect: true },
                            { id: "cml-stack-q4-c", text: "Approximately 0.13 — one third of the individual error", isCorrect: false },
                            { id: "cml-stack-q4-d", text: "Approximately 0.33 — moderate improvement", isCorrect: false }
                        ],
                        explanation: "Average individual error E̅ = (0.40 + 0.42 + 0.38)/3 = 0.40. With ρ̄ = 0.3 and B = 3: E_ensemble ≈ 0.40 × [0.3 + 0.7/3] = 0.40 × [0.3 + 0.233] = 0.40 × 0.533 ≈ 0.213. This translates to roughly 79% ensemble accuracy from models individually achieving only 58-62% — demonstrating the power of combining diverse, lowly-correlated predictions."
                    },
                    {
                        id: "cml-stack-q5",
                        text: "In which scenario would blending be preferred over full cross-validated stacking?",
                        options: [
                            { id: "cml-stack-q5-a", text: "When you have a very small dataset and need maximum data efficiency", isCorrect: false },
                            { id: "cml-stack-q5-b", text: "When base models are extremely expensive to train and you want to minimize total model fits while accepting some data waste", isCorrect: true },
                            { id: "cml-stack-q5-c", text: "When base learners are highly diverse and need the full dataset to learn their specializations", isCorrect: false },
                            { id: "cml-stack-q5-d", text: "When you need the meta-learner to train on the most possible examples", isCorrect: false }
                        ],
                        explanation: "Blending requires only B model fits (one per base model) versus B × k fits for stacking with k-fold CV. When each model fit takes hours (e.g., deep neural networks, large XGBoost models), blending's computational savings can be decisive. The trade-off is wasting 30% of data, but with sufficiently large datasets this waste is acceptable. Blending is also simpler to implement correctly, reducing the risk of CV-related leakage bugs."
                    },
                    {
                        id: "cml-stack-q6",
                        text: "What happens if all base learners in a stacking ensemble use the same algorithm with identical hyperparameters?",
                        options: [
                            { id: "cml-stack-q6-a", text: "The ensemble achieves zero error because multiple models vote on the correct answer", isCorrect: false },
                            { id: "cml-stack-q6-b", text: "The meta-learner assigns random weights since all inputs are identical", isCorrect: false },
                            { id: "cml-stack-q6-c", text: "The stacked ensemble reduces to a single model's performance because identical models produce perfectly correlated predictions with zero ambiguity", isCorrect: true },
                            { id: "cml-stack-q6-d", text: "The ensemble performs worse than any individual model due to overfitting at the meta-learner level", isCorrect: false }
                        ],
                        explanation: "With identical algorithms and hyperparameters, all base models produce nearly identical OOF predictions (minor differences come only from CV fold randomness). The ambiguity term Ā ≈ 0, so by the decomposition E_ensemble = E̅ − Ā ≈ E̅, the ensemble error equals the average individual error. The meta-learner has no complementary signals to exploit — it receives essentially the same prediction B times. This is why diversity is the cornerstone of effective ensembles."
                    },
                    {
                        id: "cml-stack-q7",
                        text: "Why is logistic regression commonly recommended as the meta-learner in stacking rather than a more complex model like gradient boosting?",
                        options: [
                            { id: "cml-stack-q7-a", text: "Logistic regression is always more accurate than gradient boosting", isCorrect: false },
                            { id: "cml-stack-q7-b", text: "Logistic regression cannot overfit, while gradient boosting always overfits", isCorrect: false },
                            { id: "cml-stack-q7-c", text: "The meta-learner's input space is small (B features) and its training signal comes from OOF predictions which already contain noise — a simple model avoids second-level overfitting while its coefficients provide interpretable model importance", isCorrect: true },
                            { id: "cml-stack-q7-d", text: "Gradient boosting cannot accept probability inputs from base models", isCorrect: false }
                        ],
                        explanation: "The meta-learner operates on a very low-dimensional input (B base model predictions, typically 3-10 features). A complex model in this small space risks memorizing noise patterns in the OOF matrix. Logistic regression's simplicity acts as strong regularization against second-level overfitting. Additionally, its learned coefficients directly reveal each base model's relative importance, providing valuable interpretability. The Super Learner formalizes this principle by using constrained non-negative least squares."
                    }
                ]
            },
            {
                type: "practice",
                title: "Build and Evaluate a Multi-Model Stacking Ensemble",
                description: "Construct a 3-model stacking ensemble using Random Forest, XGBoost, and SVM as base learners with logistic regression as the meta-learner. Use TimeSeriesSplit with 5 folds for OOF prediction generation. Measure each base model's individual accuracy, then the stacked ensemble accuracy. Next, add a 4th base model (either Gaussian Naive Bayes or K-Nearest Neighbors) and observe how the additional diversity affects ensemble performance. Compare the Q-statistic between base model pairs before and after adding the 4th model. Does more diversity always help, or is there a point of diminishing returns?",
                catalogModelId: "stacking-direction"
            },
            {
                type: "practice",
                title: "Stacking vs Blending vs Averaging Comparison Dashboard",
                description: "Using the dashboard, run a comprehensive comparison of three ensemble combination strategies: (1) full cross-validated stacking with logistic regression meta-learner, (2) blending with a 70/30 holdout split, and (3) simple equal-weight averaging of base model predictions. Evaluate each strategy across three distinct market periods — a trending period, a range-bound period, and a high-volatility period. Record accuracy, log-loss, and computational cost (number of model fits) for each combination. Identify which strategy performs best in each market condition and explain why. Pay particular attention to how data efficiency affects performance in smaller sample regimes."
            }
        ]
    }

      ],
    },
  ],
};
