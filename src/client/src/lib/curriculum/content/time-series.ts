import type { LearningPath } from "../types";

export const timeSeriesPath: LearningPath = {
  id: "time-series",
  title: "Time Series & Signals",
  description:
    "Dive into the specialized techniques for modelling temporal dependencies in financial data — from classical stationarity tests and ARIMA/GARCH models to Hidden Markov Models for regime detection and Kalman filters for adaptive state estimation.",
  icon: "Activity",
  color: "amber",
  difficulty: "intermediate",
  estimatedHours: 20,
  modules: [
    {
      id: "classical-ts",
      title: "Classical Time Series",
      description:
        "Learn the foundational time series concepts — stationarity, differencing, autoregressive and moving-average models — that underpin both classical econometrics and modern ML approaches to forex.",
      lessons: [
        {
          id: "ts-stationarity",
          title: "Stationarity & Differencing",
          description:
            "Understand why stationarity matters for time series modelling, test for unit roots with the Augmented Dickey-Fuller test, and transform non-stationary forex prices into stationary return series.",
          estimatedMinutes: 50,
          difficulty: "intermediate",
          sections: [
            {
              type: "objective",
              content:
                "After this lesson you will be able to define strict and weak stationarity, explain why non-stationary data breaks most statistical and ML models, apply the Augmented Dickey-Fuller (ADF) test to detect unit roots, and use differencing and log-returns to achieve stationarity in forex price series.",
              keyTakeaways: [
                "A weakly stationary process has constant mean μ, constant variance σ², and autocovariance that depends only on lag, not time",
                "Raw forex prices are non-stationary (unit root): they wander without reverting to a mean",
                "The ADF test has H₀: unit root exists (non-stationary). Reject if p-value < 0.05 → series is stationary",
                "First-differencing Δyₜ = yₜ − yₜ₋₁ or log-returns rₜ = ln(Pₜ/Pₜ₋₁) typically achieve stationarity",
              ],
            },
            {
              type: "theory",
              title: "Unit Roots, ADF Test & Differencing",
              content:
                "A time series {yₜ} is **weakly stationary** if: (1) E[yₜ] = μ for all t, (2) Var(yₜ) = σ² for all t, and (3) Cov(yₜ, yₜ₊ₕ) depends only on lag h, not on t. Raw prices violate all three: their mean drifts, variance grows over time, and correlations shift.\n\nThe simplest non-stationary model is a **random walk**: yₜ = yₜ₋₁ + εₜ, where εₜ ~ N(0, σ²). This has a **unit root** — the autoregressive coefficient is exactly 1. The variance Var(yₜ) = tσ² grows linearly without bound.\n\nThe **Augmented Dickey-Fuller (ADF) test** regresses Δyₜ = αyₜ₋₁ + ∑ βⱼΔyₜ₋ⱼ + εₜ and tests H₀: α = 0 (unit root). The test statistic follows a non-standard distribution (Dickey-Fuller tables). If the p-value < 0.05, we reject H₀ and conclude the series is stationary.\n\n**Differencing** of order d transforms yₜ into Δᵈyₜ. For prices, d = 1 (first difference or log-returns) almost always suffices. A series that requires d differences to become stationary is called **integrated of order d**, written I(d). Forex prices are typically I(1).",
            },
            {
              type: "intuition",
              title: "The Drunk Walk Analogy",
              analogy:
                "A non-stationary series is like a drunk person walking — they wander endlessly without returning home.",
              content:
                "Imagine a drunk person leaving a bar. Each step is random — left or right with equal probability. After 100 steps, they could be anywhere. After 1000 steps, even further away. There's no force pulling them home (no mean reversion). That's a **random walk** — the model for non-stationary prices. Now imagine you measure the *size of each step* instead of the position. Each step is roughly the same length, centered around zero. That's **differencing** — converting the wandering position (price) into a well-behaved step size (return). The ADF test is like checking whether there's a rubber band pulling the drunk back toward the bar. If there is (p < 0.05), the series is stationary.",
              emoji: "🍺",
            },
            {
              type: "code",
              title: "ADF Test & Differencing on Forex Pairs",
              language: "python",
              code: `import numpy as np
import pandas as pd
from statsmodels.tsa.stattools import adfuller

# Load EUR/USD hourly prices
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
prices = df["close"].dropna()

# ADF test on raw prices
result_price = adfuller(prices, maxlag=24, autolag="AIC")
print("ADF Test on RAW PRICES:")
print(f"  Test Statistic: {result_price[0]:.4f}")
print(f"  p-value:        {result_price[1]:.6f}")
print(f"  Lags used:      {result_price[2]}")
print(f"  Conclusion:     {'Stationary ✓' if result_price[1] < 0.05 else 'Non-stationary ✗'}")

# Compute log-returns and test again
log_returns = np.log(prices / prices.shift(1)).dropna()
result_returns = adfuller(log_returns, maxlag=24, autolag="AIC")
print("\\nADF Test on LOG-RETURNS:")
print(f"  Test Statistic: {result_returns[0]:.4f}")
print(f"  p-value:        {result_returns[1]:.6f}")
print(f"  Lags used:      {result_returns[2]}")
print(f"  Conclusion:     {'Stationary ✓' if result_returns[1] < 0.05 else 'Non-stationary ✗'}")

# Summary statistics of stationary series
print(f"\\nLog-return statistics:")
print(f"  Mean (μ):     {log_returns.mean():.8f}")
print(f"  Std Dev (σ):  {log_returns.std():.6f}")
print(f"  Range:        [{log_returns.min():.6f}, {log_returns.max():.6f}]")
print(f"  Samples:      {len(log_returns)}")`,
              explanation:
                "We run the ADF test on raw EUR/USD prices (expect p > 0.05, non-stationary) and then on log-returns (expect p ≈ 0.0, stationary). The maxlag=24 parameter accounts for up to 24 lags of autocorrelation in hourly data. This is the essential first step before applying ARIMA, training ML models, or computing meaningful statistics — most methods assume or require stationarity.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "ts-stat-q1",
                  question:
                    "The ADF test on a forex price series returns p-value = 0.73. What should you do?",
                  options: [
                    { id: "ts-stat-q1-a", text: "Conclude the series is stationary and proceed with modelling" },
                    { id: "ts-stat-q1-b", text: "Fail to reject H₀ — the series likely has a unit root. Apply differencing and re-test" },
                    { id: "ts-stat-q1-c", text: "Increase the sample size until p < 0.05" },
                    { id: "ts-stat-q1-d", text: "The test is inconclusive; switch to a different currency pair" },
                  ],
                  correctOptionId: "ts-stat-q1-b",
                  explanation:
                    "A p-value of 0.73 >> 0.05 means we fail to reject H₀ (unit root exists). The series is likely non-stationary. Apply first-differencing or log-returns to transform it, then re-run the ADF test to confirm stationarity.",
                },
                {
                  id: "ts-stat-q2",
                  question:
                    "Why does a random walk's variance grow without bound over time?",
                  options: [
                    { id: "ts-stat-q2-a", text: "Because the mean increases linearly" },
                    { id: "ts-stat-q2-b", text: "Because each step's noise εₜ accumulates: Var(yₜ) = tσ² for a random walk yₜ = yₜ₋₁ + εₜ" },
                    { id: "ts-stat-q2-c", text: "Because the autocorrelation is zero at all lags" },
                    { id: "ts-stat-q2-d", text: "Because the ADF test forces the variance to increase" },
                  ],
                  correctOptionId: "ts-stat-q2-b",
                  explanation:
                    "A random walk is the sum of i.i.d. shocks: yₜ = y₀ + ε₁ + ε₂ + … + εₜ. The variance of a sum of independent variables is the sum of their variances: Var(yₜ) = tσ². This grows linearly with t, meaning prices become increasingly uncertain over time.",
                },
                {
                  id: "ts-stat-q3",
                  question:
                    "A series is called I(2). What does this mean?",
                  options: [
                    { id: "ts-stat-q3-a", text: "It has 2 unit roots and requires differencing twice to become stationary" },
                    { id: "ts-stat-q3-b", text: "It is stationary after removing 2 outliers" },
                    { id: "ts-stat-q3-c", text: "It has 2 seasonal components" },
                    { id: "ts-stat-q3-d", text: "It requires 2 ADF tests to confirm stationarity" },
                  ],
                  correctOptionId: "ts-stat-q3-a",
                  explanation:
                    "I(d) means the series is integrated of order d — it requires d rounds of differencing to achieve stationarity. I(2) means Δ²yₜ = Δ(Δyₜ) is stationary. This is rare in finance; most prices are I(1).",
                },
              ],
            },
            {
              type: "practice",
              title: "Test Stationarity Across Pairs and Timeframes",
              description:
                "Run ADF tests on raw prices and log-returns for EUR/USD, GBP/USD, USD/JPY, and AUD/USD at both 1-hour and daily timeframes. Create a summary table of p-values. Are there any cases where raw prices appear stationary? What about inverse pairs (e.g., USD/EUR)?",
            },
          ],
        },
        {
          id: "ts-arima",
          title: "ARIMA & GARCH Models",
          description:
            "Learn autoregressive, moving-average, and integrated models for forecasting returns, and GARCH models for forecasting volatility — the workhorses of classical financial econometrics.",
          estimatedMinutes: 55,
          difficulty: "intermediate",
          prerequisites: ["ts-stationarity"],
          sections: [
            {
              type: "objective",
              content:
                "You will understand the AR(p), MA(q), and ARIMA(p,d,q) model specifications, select orders using AIC/BIC, fit an ARIMA model to forex returns with statsmodels, and understand how GARCH(1,1) models volatility clustering.",
              keyTakeaways: [
                "AR(p): yₜ = c + φ₁yₜ₋₁ + … + φₚyₜ₋ₚ + εₜ — current value depends on p past values",
                "MA(q): yₜ = c + εₜ + θ₁εₜ₋₁ + … + θ_qεₜ₋q — current value depends on q past shocks",
                "ARIMA(p,d,q) combines AR, differencing (I), and MA — use AIC/BIC to select (p,d,q)",
                "GARCH(1,1): σₜ² = ω + α·εₜ₋₁² + β·σₜ₋₁² models volatility clustering (large moves follow large moves)",
              ],
            },
            {
              type: "theory",
              title: "ARIMA for Returns, GARCH for Volatility",
              content:
                "**ARIMA(p,d,q)** models a time series after d differences as a combination of autoregressive and moving-average terms: Δᵈyₜ = c + ∑ᵢ₌₁ᵖ φᵢΔᵈyₜ₋ᵢ + ∑ⱼ₌₁ᵍ θⱼεₜ₋ⱼ + εₜ. For forex returns (already d=1 differenced from prices), we fit ARMA(p,q) where p and q are chosen to minimize the **Akaike Information Criterion** AIC = 2k − 2ln(L̂) or **Bayesian IC** BIC = k·ln(n) − 2ln(L̂), balancing fit quality against model complexity.\n\nARIMA captures patterns in the *conditional mean*, but forex returns exhibit **volatility clustering**: large price changes tend to be followed by large changes (of either sign). This is captured by **GARCH(1,1)**: σₜ² = ω + α·ε²ₜ₋₁ + β·σ²ₜ₋₁, where σₜ² is the conditional variance, ε²ₜ₋₁ is the previous squared shock, and α + β < 1 ensures stationarity. Typical forex parameters: α ≈ 0.05–0.10, β ≈ 0.85–0.95 (high persistence). The **half-life** of a volatility shock is ln(2) / ln(α + β).\n\nCombining ARIMA (mean dynamics) with GARCH (variance dynamics) gives a complete model: yₜ = μₜ + σₜ·zₜ, where μₜ comes from ARIMA and σₜ from GARCH.",
            },
            {
              type: "intuition",
              title: "The Earthquake Aftershock Analogy",
              analogy:
                "GARCH volatility clustering is like earthquake aftershocks.",
              content:
                "After a major earthquake, you don't get calm immediately — aftershocks follow, gradually diminishing. Financial volatility works the same way: after a big price move (the 'quake'), you see a cluster of large moves (aftershocks) before things calm down. **GARCH** models this decay mathematically. The parameter **β** controls how long aftershocks persist (β ≈ 0.90 means shock half-life ≈ 7 periods). Parameter **α** controls how strongly a new quake triggers aftershocks. ARIMA, by contrast, models the *direction* of ground movement — but it's the *intensity* (GARCH) that matters most for risk management and position sizing.",
              emoji: "🌋",
            },
            {
              type: "code",
              title: "Fitting ARIMA + GARCH to Forex Returns",
              language: "python",
              code: `import numpy as np
import pandas as pd
from statsmodels.tsa.arima.model import ARIMA
from arch import arch_model

# Load and prepare returns
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
df["log_return"] = np.log(df["close"] / df["close"].shift(1))
returns = df["log_return"].dropna()

# Split: train on first 80%, test on last 20%
split = int(len(returns) * 0.8)
train = returns.iloc[:split]
test = returns.iloc[split:]

# --- ARIMA for conditional mean ---
# Grid search over (p, q) using AIC
best_aic, best_order = np.inf, (0, 0, 0)
for p in range(4):
    for q in range(4):
        try:
            model = ARIMA(train, order=(p, 0, q))
            result = model.fit()
            if result.aic < best_aic:
                best_aic, best_order = result.aic, (p, 0, q)
        except Exception:
            continue
print(f"Best ARIMA order: {best_order}  AIC: {best_aic:.2f}")

arima_fit = ARIMA(train, order=best_order).fit()
print(arima_fit.summary().tables[1])

# --- GARCH(1,1) for conditional volatility ---
# Scale returns to percentage for numerical stability
returns_pct = train * 100
garch = arch_model(returns_pct, vol="Garch", p=1, q=1, dist="t")
garch_fit = garch.fit(disp="off")
print(f"\\nGARCH(1,1) parameters:")
print(f"  ω (omega): {garch_fit.params['omega']:.6f}")
print(f"  α (alpha): {garch_fit.params['alpha[1]']:.4f}")
print(f"  β (beta):  {garch_fit.params['beta[1]']:.4f}")
persistence = garch_fit.params["alpha[1]"] + garch_fit.params["beta[1]"]
half_life = np.log(2) / (-np.log(persistence)) if persistence < 1 else float("inf")
print(f"  Persistence (α+β): {persistence:.4f}")
print(f"  Volatility shock half-life: {half_life:.1f} bars")`,
              explanation:
                "We grid-search ARIMA orders (p,q) using AIC on training data, then fit a GARCH(1,1) with Student-t innovations to model volatility clustering. The persistence α + β is typically 0.95–0.99 for hourly forex, meaning volatility shocks die out slowly. This combined model can forecast both expected returns (ARIMA) and expected risk (GARCH) — essential for position sizing and risk management.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "ts-arima-q1",
                  question:
                    "In a GARCH(1,1) model with α = 0.08 and β = 0.90, what is the persistence of volatility shocks?",
                  options: [
                    { id: "ts-arima-q1-a", text: "0.08 — only the recent shock matters" },
                    { id: "ts-arima-q1-b", text: "0.90 — only the lagged variance matters" },
                    { id: "ts-arima-q1-c", text: "0.98 — shocks decay very slowly, near the non-stationarity boundary" },
                    { id: "ts-arima-q1-d", text: "0.72 — moderate persistence" },
                  ],
                  correctOptionId: "ts-arima-q1-c",
                  explanation:
                    "Persistence = α + β = 0.08 + 0.90 = 0.98. This means 98% of a volatility shock carries over to the next period. The half-life is ln(2)/ln(1/0.98) ≈ 34 bars — shocks take roughly 34 periods to decay by half.",
                },
                {
                  id: "ts-arima-q2",
                  question:
                    "Why do we use AIC rather than just minimizing training error to select ARIMA order (p, q)?",
                  options: [
                    { id: "ts-arima-q2-a", text: "AIC is faster to compute than training error" },
                    { id: "ts-arima-q2-b", text: "AIC penalizes model complexity (number of parameters k), preventing overfitting" },
                    { id: "ts-arima-q2-c", text: "AIC always selects the simplest possible model" },
                    { id: "ts-arima-q2-d", text: "AIC guarantees the model will be stationary" },
                  ],
                  correctOptionId: "ts-arima-q2-b",
                  explanation:
                    "AIC = 2k − 2ln(L̂) balances goodness of fit (log-likelihood L̂) against model complexity (number of parameters k). Higher-order ARIMA models can always fit training data better, but AIC penalizes unnecessary parameters, preferring parsimonious models that generalize better.",
                },
              ],
            },
            {
              type: "practice",
              title: "Forecast Volatility with GARCH",
              description:
                "Fit GARCH(1,1) models to EUR/USD, GBP/USD, and USD/JPY hourly returns. Compare the estimated α, β, and persistence across pairs. Generate 1-week-ahead volatility forecasts and overlay them on actual realized volatility. Which pair has the most persistent volatility clustering?",
              resourceUrl: "https://arch.readthedocs.io/en/latest/",
            },
          ],
        },
      ],
    },
    {
      id: "state-space",
      title: "State-Space & Hidden Models",
      description:
        "Explore latent-variable models that detect unobservable market regimes and track hidden states — Hidden Markov Models for regime switching and Kalman filters for adaptive estimation.",
      lessons: [
        {
          id: "ts-hmm",
          title: "Hidden Markov Models",
          description:
            "Learn how HMMs model market regimes as hidden states with distinct statistical properties, use Baum-Welch for parameter estimation and Viterbi for regime decoding.",
          estimatedMinutes: 55,
          difficulty: "intermediate",
          prerequisites: ["found-probability", "ts-stationarity"],
          relatedModels: ["gaussian-hmm", "regime-detector"],
          sections: [
            {
              type: "objective",
              content:
                "You will understand Hidden Markov Models (HMMs) as generative models with latent states, explain the three core algorithms — Forward (likelihood), Viterbi (decoding), and Baum-Welch (parameter estimation) — and train a Gaussian HMM to detect volatility regimes in forex returns.",
              keyTakeaways: [
                "An HMM has hidden states S = {s₁, …, sₖ}, transition matrix A (aᵢⱼ = P(sₜ = j | sₜ₋₁ = i)), and emission distributions B",
                "The Forward algorithm computes P(observations | model) in O(K²T) time",
                "The Viterbi algorithm finds the most likely state sequence (regime path) via dynamic programming",
                "Baum-Welch (EM algorithm) iteratively estimates A, B, and initial state distribution π from data",
              ],
            },
            {
              type: "theory",
              title: "HMMs: Hidden States, Transitions & Emissions",
              content:
                "A **Hidden Markov Model** defines a generative process: at each time step t, the system is in a hidden state sₜ ∈ {1, …, K} that emits an observable oₜ. The state evolves according to a **transition matrix** A where aᵢⱼ = P(sₜ = j | sₜ₋₁ = i), ∑ⱼ aᵢⱼ = 1. Each state k has an **emission distribution** bₖ(o) — for Gaussian HMMs, bₖ(o) = N(μₖ, σₖ²).\n\nThe **three fundamental problems** are:\n1. **Evaluation** (Forward algorithm): Compute P(O₁:T | λ) where λ = (A, B, π). Uses forward variables αₜ(j) = P(O₁:ₜ, sₜ = j | λ), computed recursively in O(K²T).\n2. **Decoding** (Viterbi): Find s* = argmax P(S₁:T | O₁:T, λ). Dynamic programming tracks the best path to each state at each time step.\n3. **Learning** (Baum-Welch): Estimate λ* = argmax P(O₁:T | λ). This EM algorithm alternates between computing expected state occupancies (E-step) and updating parameters (M-step).\n\nFor forex, a 2–3 state HMM typically discovers: (1) a **low-volatility** regime (small σ, ranging market), (2) a **high-volatility** regime (large σ, trending/crisis), and sometimes (3) a **medium-volatility trending** regime.",
            },
            {
              type: "intuition",
              title: "The Weather Behind Closed Doors",
              analogy:
                "An HMM is like inferring today's weather by observing what umbrella people carry.",
              content:
                "You're locked in a windowless room and can't see the weather (hidden states: ☀️ sunny, 🌧️ rainy, ❄️ snowy). But you observe people entering with different items: sunglasses, umbrellas, or heavy coats (emissions). On sunny days, 80% wear sunglasses; on rainy days, 90% carry umbrellas. By tracking the sequence of items people carry over many days, you can infer the *hidden* weather sequence AND learn the transition probabilities (e.g., 'rainy days tend to follow rainy days'). In forex, the hidden states are market regimes (calm, volatile, trending), and the emissions are observed returns. The HMM reverse-engineers the unobservable regime from observable price action.",
              emoji: "🌤️",
            },
            {
              type: "code",
              title: "Gaussian HMM for Regime Detection",
              language: "python",
              code: `import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM

# Prepare return data
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
df["log_return"] = np.log(df["close"] / df["close"].shift(1))
returns = df["log_return"].dropna().values.reshape(-1, 1)

# Fit 3-state Gaussian HMM
model = GaussianHMM(
    n_components=3,
    covariance_type="full",
    n_iter=200,
    random_state=42,
    tol=1e-4,
)
model.fit(returns)

# Decode most likely regime sequence (Viterbi)
hidden_states = model.predict(returns)

# Analyze regimes
print("Regime Analysis:")
print(f"{'Regime':<10} {'Mean (μ)':>12} {'Std (σ)':>12} {'Pct Time':>10}")
print("-" * 46)
for i in range(model.n_components):
    mask = hidden_states == i
    mu = model.means_[i, 0]
    sigma = np.sqrt(model.covars_[i, 0, 0])
    pct = mask.sum() / len(hidden_states) * 100
    print(f"State {i:<4} {mu:>12.6f} {sigma:>12.6f} {pct:>9.1f}%")

# Transition matrix
print("\\nTransition Matrix A:")
print("      " + "  ".join(f"→ S{j}" for j in range(model.n_components)))
for i in range(model.n_components):
    row = "  ".join(f"{model.transmat_[i, j]:.3f}" for j in range(model.n_components))
    print(f"S{i}:   {row}")

# Stationary distribution (left eigenvector of A with eigenvalue 1)
eigenvalues, eigenvectors = np.linalg.eig(model.transmat_.T)
stationary = eigenvectors[:, np.isclose(eigenvalues, 1)].real.flatten()
stationary /= stationary.sum()
print(f"\\nStationary distribution π: {np.round(stationary, 4)}")`,
              explanation:
                "We fit a 3-state Gaussian HMM to EUR/USD hourly log-returns. Each state discovers a distinct regime: typically low-volatility (σ ≈ 0.0002), medium-volatility (σ ≈ 0.0005), and high-volatility (σ ≈ 0.001+). The transition matrix reveals regime persistence — diagonal values near 0.98 mean regimes last many hours before switching. The stationary distribution π gives the long-run fraction of time spent in each regime.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "ts-hmm-q1",
                  question:
                    "What does the Viterbi algorithm compute for an HMM?",
                  options: [
                    { id: "ts-hmm-q1-a", text: "The probability of the observation sequence given the model" },
                    { id: "ts-hmm-q1-b", text: "The most likely sequence of hidden states given the observations" },
                    { id: "ts-hmm-q1-c", text: "The optimal number of hidden states K" },
                    { id: "ts-hmm-q1-d", text: "The maximum likelihood parameter estimates" },
                  ],
                  correctOptionId: "ts-hmm-q1-b",
                  explanation:
                    "Viterbi solves the decoding problem: s* = argmax_{S₁:T} P(S₁:T | O₁:T, λ). It uses dynamic programming to find the single most probable path through hidden state space, which in our case reveals the most likely regime at each time step.",
                },
                {
                  id: "ts-hmm-q2",
                  question:
                    "A 2-state HMM has transition matrix A = [[0.97, 0.03], [0.05, 0.95]]. What is the expected duration of State 0?",
                  options: [
                    { id: "ts-hmm-q2-a", text: "1 / 0.97 ≈ 1.03 periods" },
                    { id: "ts-hmm-q2-b", text: "1 / 0.03 ≈ 33.3 periods" },
                    { id: "ts-hmm-q2-c", text: "1 / 0.05 = 20 periods" },
                    { id: "ts-hmm-q2-d", text: "0.97 × 100 = 97 periods" },
                  ],
                  correctOptionId: "ts-hmm-q2-b",
                  explanation:
                    "The expected duration of staying in state i is 1 / (1 − aᵢᵢ). For State 0: 1 / (1 − 0.97) = 1 / 0.03 ≈ 33.3 periods. This means the system stays in State 0 for an average of 33 time steps before transitioning.",
                },
                {
                  id: "ts-hmm-q3",
                  question:
                    "Why might a 3-state HMM outperform a 2-state HMM for forex regime detection?",
                  options: [
                    { id: "ts-hmm-q3-a", text: "More states always produce higher accuracy" },
                    { id: "ts-hmm-q3-b", text: "3 states can capture distinct low/medium/high volatility regimes that 2 states conflate" },
                    { id: "ts-hmm-q3-c", text: "3-state models train faster than 2-state models" },
                    { id: "ts-hmm-q3-d", text: "3-state models require less data to train" },
                  ],
                  correctOptionId: "ts-hmm-q3-b",
                  explanation:
                    "Forex markets often exhibit three distinct regimes: low-volatility (ranging), medium-volatility (trending), and high-volatility (crisis/breakout). A 2-state model must lump medium and high volatility together, losing actionable information for position sizing and strategy selection.",
                },
              ],
            },
            {
              type: "practice",
              title: "Visualize HMM Regimes on the Dashboard",
              description:
                "Load an HMM model from the dashboard catalog and overlay the decoded regimes on a price chart. Observe how regime transitions align with major market events (central bank announcements, NFP releases). Try varying the number of states (2, 3, 4) and compare BIC scores to find the optimal K.",
              catalogModelId: "gaussian-hmm",
            },
          ],
        },
        {
          id: "ts-kalman",
          title: "Kalman Filters & State Estimation",
          description:
            "Learn how Kalman filters combine noisy observations with a dynamic model to produce optimal state estimates, and apply them to adaptive price tracking and spread modelling in forex.",
          estimatedMinutes: 55,
          difficulty: "intermediate",
          prerequisites: ["found-linear-algebra", "ts-stationarity"],
          relatedModels: ["kalman-tracker"],
          sections: [
            {
              type: "objective",
              content:
                "You will understand the state-space formulation of the Kalman filter, derive the predict and update equations, and implement a simple Kalman filter for adaptive price tracking that automatically adjusts to changing market conditions.",
              keyTakeaways: [
                "The Kalman filter is the optimal linear estimator for Gaussian state-space models with known dynamics",
                "Predict step: x̂ₜ|ₜ₋₁ = F·x̂ₜ₋₁ + B·uₜ₋₁, propagates the state estimate forward using the transition model",
                "Update step: x̂ₜ|ₜ = x̂ₜ|ₜ₋₁ + Kₜ·(zₜ − H·x̂ₜ|ₜ₋₁), corrects the prediction using the new observation",
                "The Kalman gain Kₜ balances trust between the model prediction and the noisy observation",
              ],
            },
            {
              type: "theory",
              title: "State-Space Models & the Kalman Recursion",
              content:
                "A **linear Gaussian state-space model** consists of:\n- **State equation**: xₜ = F·xₜ₋₁ + B·uₜ₋₁ + wₜ, where wₜ ~ N(0, Q) is process noise\n- **Observation equation**: zₜ = H·xₜ + vₜ, where vₜ ~ N(0, R) is measurement noise\n\nThe **Kalman filter** recursively estimates the hidden state xₜ given observations z₁:ₜ:\n\n**Predict:**\nx̂ₜ|ₜ₋₁ = F · x̂ₜ₋₁|ₜ₋₁  (predicted state)\nPₜ|ₜ₋₁ = F · Pₜ₋₁|ₜ₋₁ · Fᵀ + Q  (predicted covariance)\n\n**Update:**\nỹₜ = zₜ − H · x̂ₜ|ₜ₋₁  (innovation / residual)\nSₜ = H · Pₜ|ₜ₋₁ · Hᵀ + R  (innovation covariance)\nKₜ = Pₜ|ₜ₋₁ · Hᵀ · Sₜ⁻¹  (Kalman gain)\nx̂ₜ|ₜ = x̂ₜ|ₜ₋₁ + Kₜ · ỹₜ  (updated state)\nPₜ|ₜ = (I − Kₜ · H) · Pₜ|ₜ₋₁  (updated covariance)\n\nThe **Kalman gain** Kₜ ∈ [0, 1] is the key: when R is large (noisy observations), Kₜ → 0 and the filter trusts its model prediction; when Q is large (uncertain dynamics), Kₜ → 1 and the filter closely tracks observations. For forex, this creates an **adaptive moving average** that automatically adjusts its responsiveness to market volatility.",
            },
            {
              type: "intuition",
              title: "The GPS Navigation Analogy",
              analogy:
                "A Kalman filter is like your car's GPS combining a map prediction with a noisy satellite signal.",
              content:
                "Your GPS knows your car was at position x going 60 mph north. It **predicts** you'll be 1 mile further north in 1 minute (the state equation). Then a satellite measurement arrives saying you're actually 0.8 miles further (the observation). The Kalman filter **blends** these: maybe the truth is 0.95 miles — mostly trusting the prediction because satellite signals bounce off buildings (high R). In a tunnel with no GPS signal, the filter relies entirely on its prediction. On a clear highway with strong signal, it trusts the satellite more. For forex, the 'prediction' is your model of price dynamics and the 'satellite' is the noisy tick data. The Kalman filter optimally combines both.",
              emoji: "📡",
            },
            {
              type: "code",
              title: "Kalman Filter for Adaptive Price Tracking",
              language: "python",
              code: `import numpy as np
import pandas as pd

# Load price data
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
prices = df["close"].dropna().values

# --- Kalman Filter: track price level and velocity ---
# State: x = [price, velocity]ᵀ (velocity = price change per bar)
# Transition: xₜ = F · xₜ₋₁ + wₜ
# Observation: zₜ = H · xₜ + vₜ

dt = 1.0  # time step (1 bar)
F = np.array([[1, dt],   # price = price + velocity * dt
              [0,  1]])   # velocity persists
H = np.array([[1, 0]])    # we observe price only

# Noise parameters (tunable)
q_price = 1e-7             # process noise for price
q_velocity = 1e-8          # process noise for velocity
Q = np.array([[q_price, 0],
              [0, q_velocity]])
R = np.array([[1e-6]])     # measurement noise

# Initialize
x_est = np.array([prices[0], 0.0])  # initial state
P = np.eye(2) * 1e-4                 # initial covariance

# Storage
filtered_prices = np.zeros(len(prices))
filtered_velocity = np.zeros(len(prices))
kalman_gains = np.zeros(len(prices))

for t in range(len(prices)):
    # --- Predict ---
    x_pred = F @ x_est
    P_pred = F @ P @ F.T + Q

    # --- Update ---
    z = np.array([prices[t]])
    y_innov = z - H @ x_pred                  # innovation
    S = H @ P_pred @ H.T + R                  # innovation covariance
    K = P_pred @ H.T @ np.linalg.inv(S)       # Kalman gain
    x_est = x_pred + (K @ y_innov).flatten()
    P = (np.eye(2) - K @ H) @ P_pred

    filtered_prices[t] = x_est[0]
    filtered_velocity[t] = x_est[1]
    kalman_gains[t] = K[0, 0]

# Compare with simple moving averages
df_out = pd.DataFrame({
    "price": prices,
    "kalman": filtered_prices,
    "sma_20": pd.Series(prices).rolling(20).mean(),
    "velocity": filtered_velocity,
})

print(f"Kalman RMSE:  {np.sqrt(np.mean((prices - filtered_prices)**2)):.8f}")
sma_valid = df_out["sma_20"].dropna()
print(f"SMA-20 RMSE:  {np.sqrt(np.mean((prices[19:] - sma_valid.values)**2)):.8f}")
print(f"Mean Kalman Gain (K): {kalman_gains.mean():.4f}")
print(f"Estimated velocity range: [{filtered_velocity.min():.6f}, {filtered_velocity.max():.6f}]")`,
              explanation:
                "We model price as a 2D state vector [price, velocity] where velocity captures the local trend. The Kalman filter adaptively smooths the price series: during calm periods the gain K is low (trusting the model), during volatile periods K increases to track rapid price changes. Unlike a fixed-window SMA, the Kalman filter adjusts its smoothing automatically. The velocity estimate provides a real-time trend indicator without the lag inherent in moving averages.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "ts-kalman-q1",
                  question:
                    "What happens to the Kalman gain K when measurement noise R is very large relative to process noise Q?",
                  options: [
                    { id: "ts-kalman-q1-a", text: "K → 1: the filter trusts the observation completely" },
                    { id: "ts-kalman-q1-b", text: "K → 0: the filter mostly ignores the noisy observation and relies on its prediction" },
                    { id: "ts-kalman-q1-c", text: "K becomes negative, reversing the update direction" },
                    { id: "ts-kalman-q1-d", text: "K oscillates between 0 and 1 unpredictably" },
                  ],
                  correctOptionId: "ts-kalman-q1-b",
                  explanation:
                    "When R >> Q, the observation is very noisy relative to the model's confidence. The Kalman gain K = P·Hᵀ·(H·P·Hᵀ + R)⁻¹ → 0 because R dominates the denominator. The filter 'ignores' the noisy measurement and relies on its internal model prediction.",
                },
                {
                  id: "ts-kalman-q2",
                  question:
                    "How does a Kalman filter differ from a simple moving average (SMA) for price tracking?",
                  options: [
                    { id: "ts-kalman-q2-a", text: "SMA is always more accurate than a Kalman filter" },
                    { id: "ts-kalman-q2-b", text: "The Kalman filter uses a fixed window size like SMA" },
                    { id: "ts-kalman-q2-c", text: "The Kalman filter adapts its smoothing based on prediction accuracy, while SMA uses fixed equal weights" },
                    { id: "ts-kalman-q2-d", text: "SMA can estimate hidden states while Kalman filter cannot" },
                  ],
                  correctOptionId: "ts-kalman-q2-c",
                  explanation:
                    "An SMA averages the last N prices with equal weights 1/N regardless of market conditions. The Kalman filter dynamically adjusts how much it weights new observations vs. its model prediction via the Kalman gain, which evolves over time based on the filter's confidence in its state estimate.",
                },
              ],
            },
            {
              type: "practice",
              title: "Tune Kalman Filter Parameters",
              description:
                "Experiment with different process noise Q and measurement noise R values on EUR/USD data. Plot the filtered output for Q/R ratios of 0.01, 0.1, 1.0, and 10.0. Observe how a high Q/R ratio makes the filter track price closely (responsive but noisy) while a low ratio produces a smooth but laggy estimate. Find the ratio that minimizes one-step-ahead prediction error on held-out data.",
              catalogModelId: "kalman-tracker",
            },
          ],
        },
      ],
    },
  ],
};
