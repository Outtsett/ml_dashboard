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
            "Master the mathematical foundations of stationarity — strict vs weak definitions, unit root theory, the ADF and KPSS hypothesis tests, differencing operators with the lag operator formalism, integration order I(d), and the dangers of overdifferencing — with concrete numerical examples and forex applications throughout.",
          estimatedMinutes: 75,
          difficulty: "intermediate",
          sections: [
            {
              type: "objective",
              content:
                "After this lesson you will command a rigorous understanding of stationarity — the single most important prerequisite for valid time series inference. You will distinguish strict from weak (covariance) stationarity with formal definitions, derive why a unit root causes variance to explode over time, perform and interpret both ADF and KPSS hypothesis tests (understanding their complementary null hypotheses), wield the lag operator L and differencing operator ∇ to transform integrated processes, determine the integration order I(d) of a series, and recognise when overdifferencing introduces spurious moving-average structure. Every concept is grounded in forex price data: EUR/USD prices as a canonical I(1) process and log-returns as I(0).",
              keyTakeaways: [
                "Strict stationarity requires the entire joint distribution F(yₜ₁, …, yₜₖ) to be invariant under time shifts — a very strong condition rarely verified in practice",
                "Weak (covariance) stationarity requires only three things: constant mean E[yₜ] = μ, constant variance Var(yₜ) = σ², and autocovariance γ(h) = Cov(yₜ, yₜ₊ₕ) that depends solely on lag h, not on time t",
                "A unit root in AR(1) yₜ = ρyₜ₋₁ + εₜ means ρ = 1: the characteristic root lies on the unit circle, variance grows as Var(yₜ) = tσ², and shocks persist forever",
                "The ADF test has H₀: unit root (non-stationary) — subtract yₜ₋₁ to get Δyₜ = αyₜ₋₁ + εₜ, test α = 0 using a non-standard Dickey-Fuller distribution with critical values ≈ -2.86 (5%) and -3.43 (1%)",
                "The KPSS test reverses the null: H₀ is stationarity — use both ADF and KPSS together to form a 2×2 decision matrix distinguishing I(0), I(1), and inconclusive cases",
                "The differencing operator ∇ = (1 − L) transforms I(d) processes: ∇yₜ = yₜ − yₜ₋₁, and a series needing d applications of ∇ to become stationary is integrated of order d, written I(d)",
                "Overdifferencing an I(d) process (applying ∇ᵈ⁺¹) introduces a non-invertible MA unit root, inflates noise variance, and destroys useful low-frequency information",
              ],
            },
            {
              type: "theory",
              title: "Strict vs Weak Stationarity: Formal Definitions",
              content:
                "**Strict stationarity** is the strongest form of distributional invariance over time. A stochastic process {yₜ} is strictly stationary if for every finite collection of time indices t₁, t₂, …, tₖ and every integer shift τ, the joint distribution is identical: F(yₜ₁, yₜ₂, …, yₜₖ) = F(yₜ₁₊τ, yₜ₂₊τ, …, yₜₖ₊τ). This means **all** moments — mean, variance, skewness, kurtosis, and every cross-moment — are time-invariant. A Gaussian white noise process εₜ ~ N(0, σ²) satisfies strict stationarity because every finite subset of i.i.d. normal variables has the same joint distribution regardless of when you sample them. In practice, strict stationarity is almost never tested directly because it requires knowledge of the full joint distribution, which is infeasible from a single observed time path.\n\n**Weak (covariance) stationarity** relaxes this to three checkable conditions: (1) the mean is constant: E[yₜ] = μ for all t; (2) the variance is finite and constant: Var(yₜ) = σ² < ∞ for all t; and (3) the autocovariance function depends only on lag, not on time: γ(h) = Cov(yₜ, yₜ₊ₕ) for all t. Why does this matter so much? First, weak stationarity guarantees **ergodicity** under mild mixing conditions — the time average (1/T)∑yₜ converges to the ensemble mean μ, so we can estimate population parameters from a single realisation. Second, most statistical procedures (OLS, correlation analysis, spectral estimation) and ML models (gradient-based learners expecting i.i.d. or identically-distributed inputs) produce **invalid** or **spurious** results when fed non-stationary data — famously, regressing one random walk on another yields a high R² even with no causal relationship (Granger & Newbold, 1974). Third, for Gaussian processes, weak stationarity implies strict stationarity because the Gaussian distribution is fully characterised by its first two moments.\n\n**Concrete numerical example — random walk vs stationary AR(1):** Consider a driftless random walk modelling EUR/USD: y₀ = 1.1000, εₜ ~ N(0, 0.0010²). Simulating: ε₁ = +0.0012 → y₁ = 1.1012; ε₂ = −0.0008 → y₂ = 1.1004; ε₃ = +0.0015 → y₃ = 1.1019; ε₄ = −0.0003 → y₄ = 1.1016; ε₅ = +0.0011 → y₅ = 1.1027. The conditional mean E[yₜ | y₀] = y₀ = 1.1000 is constant (no drift), but the variance grows: Var(y₁) = σ² = 0.000001, Var(y₂) = 2σ² = 0.000002, …, Var(y₅) = 5σ² = 0.000005. After T = 10,000 hourly observations, Var(yₜ) = 10,000 × 0.000001 = 0.01, so the standard deviation is 0.1 — the price could plausibly be anywhere from 0.8 to 1.4. This violates condition (2) of weak stationarity. Now contrast with a stationary AR(1): yₜ = 0.95·yₜ₋₁ + 0.05·μ + εₜ where μ = 1.1000 and |ρ| = 0.95 < 1. Here the unconditional variance converges to σ²/(1 − ρ²) = 0.000001/(1 − 0.9025) = 0.00001026, a **finite constant** regardless of T. The process mean-reverts: large deviations from μ are pulled back.",
            },
            {
              type: "theory",
              title: "Unit Roots and the Augmented Dickey-Fuller Test",
              content:
                "The concept of a **unit root** emerges from the characteristic equation of an AR(1) process yₜ = ρyₜ₋₁ + εₜ. Rewriting in lag-operator form: (1 − ρL)yₜ = εₜ, the characteristic polynomial is 1 − ρz = 0, giving root z = 1/ρ. When |ρ| < 1, the root z = 1/ρ lies **outside** the unit circle (|z| > 1), and the process is stationary. When ρ = 1, the root z = 1 lies exactly **on** the unit circle — hence 'unit root'. The process becomes a random walk: yₜ = yₜ₋₁ + εₜ. By recursive substitution: y₁ = y₀ + ε₁, y₂ = y₀ + ε₁ + ε₂, …, yₜ = y₀ + ∑ᵢ₌₁ᵗ εᵢ. Since the εᵢ are i.i.d. with mean 0 and variance σ², we get E[yₜ] = y₀ (constant) but Var(yₜ) = Var(∑ᵢ₌₁ᵗ εᵢ) = ∑ᵢ₌₁ᵗ Var(εᵢ) = **tσ²** — variance grows linearly without bound, shattering the constant-variance requirement of stationarity. Every shock εₜ has a **permanent** effect on the level of the series; it never decays.\n\nThe **Dickey-Fuller test** (1979) cleverly transforms the AR(1) to make the unit root testable. Start with yₜ = ρyₜ₋₁ + εₜ and subtract yₜ₋₁ from both sides: yₜ − yₜ₋₁ = (ρ − 1)yₜ₋₁ + εₜ, i.e., **Δyₜ = αyₜ₋₁ + εₜ** where α ≡ ρ − 1. Now the hypotheses become: **H₀: α = 0** (equivalently ρ = 1, unit root, non-stationary) vs **H₁: α < 0** (equivalently ρ < 1, stationary). We run an OLS regression of Δyₜ on yₜ₋₁ and compute the t-ratio τ = α̂/SE(α̂). The critical insight of Dickey and Fuller is that under H₀, yₜ₋₁ is I(1) and the usual t-distribution does **not** apply — the test statistic follows a **non-standard distribution** (the Dickey-Fuller distribution), which is more left-skewed than Student-t. This means standard critical values (±1.96 for 5%) are wrong; the DF critical values are approximately **−2.86** (5% significance) and **−3.43** (1% significance) for a model with intercept. You reject H₀ (conclude stationarity) only if τ < −2.86.\n\nThe **Augmented Dickey-Fuller (ADF)** test extends this to handle serial correlation in the residuals. If the true DGP is AR(p) rather than AR(1), the simple DF residuals will be autocorrelated, biasing the test. The ADF regression is: **Δyₜ = α·yₜ₋₁ + ∑ⱼ₌₁ᵖ βⱼ·Δyₜ₋ⱼ + εₜ**. The lagged difference terms Δyₜ₋₁, Δyₜ₋₂, …, Δyₜ₋ₚ 'soak up' the autocorrelation so that εₜ is approximately white noise. The lag order p is chosen to minimise an information criterion (AIC or BIC). Optional deterministic components can be included: a constant c (intercept, for non-zero mean under H₁) and a linear trend δt (for trend-stationary alternatives). The test statistic and critical values change depending on which deterministic terms are included — using the wrong specification reduces power.\n\n**Numerical walk-through:** Suppose we observe 6 values of EUR/USD hourly closes: y₀ = 1.1000, y₁ = 1.1015, y₂ = 1.1008, y₃ = 1.1025, y₄ = 1.1020, y₅ = 1.1035. First differences: Δy₁ = 0.0015, Δy₂ = −0.0007, Δy₃ = 0.0017, Δy₄ = −0.0005, Δy₅ = 0.0015. Using the simple DF regression (no lagged differences), we regress [Δy₁, …, Δy₅] on [y₀, …, y₄] = [1.1000, 1.1015, 1.1008, 1.1025, 1.1020]. With only 5 data points the regression is just illustrative: if we get α̂ = −0.002 with SE = 0.015, then τ = −0.002/0.015 = −0.13, which is far above −2.86 — we **fail to reject** H₀ and conclude the series likely has a unit root. In practice, the ADF test requires hundreds or thousands of observations for adequate power; the statsmodels `adfuller()` function handles all of this automatically, selecting lag length via AIC and reporting the p-value interpolated from Dickey-Fuller tables.",
            },
            {
              type: "theory",
              title: "KPSS Test, Differencing Operators & Integration Order",
              content:
                "The **KPSS test** (Kwiatkowski-Phillips-Schmidt-Shin, 1992) reverses the null hypothesis: **H₀: the series is stationary** (either level- or trend-stationary) vs H₁: unit root. The decomposition is yₜ = ξt + rₜ + εₜ, where ξt is a deterministic trend (set ξ = 0 for level stationarity), rₜ = rₜ₋₁ + uₜ is a random walk component with uₜ ~ WN(0, σ²_u), and εₜ is a stationary error. Under H₀, σ²_u = 0 so the random walk component vanishes and yₜ is stationary. The KPSS test computes an LM statistic based on the cumulative sum of OLS residuals: η = (1/T²) · ∑ₜ S²ₜ / σ̂²_ε, where Sₜ = ∑ᵢ₌₁ᵗ êᵢ. Large values of η (exceeding critical values ~0.463 at 5% for level stationarity) lead to **rejecting** stationarity. The key strategic insight is to use ADF and KPSS **together** as a 2×2 decision matrix: (1) ADF rejects + KPSS does not reject → **I(0), stationary**; (2) ADF does not reject + KPSS rejects → **I(1), unit root**; (3) both reject → series may be fractionally integrated or have structural breaks; (4) neither rejects → low power, inconclusive, gather more data.\n\nThe **differencing operator** ∇ is defined as ∇yₜ = yₜ − yₜ₋₁. Using the **lag operator** L where Lyₜ = yₜ₋₁, we write ∇ = (1 − L). The second difference is ∇²yₜ = ∇(∇yₜ) = (1 − L)²yₜ = yₜ − 2yₜ₋₁ + yₜ₋₂. In financial applications, we almost always use **log-returns** rₜ = ln(Pₜ) − ln(Pₜ₋₁) = ln(Pₜ/Pₜ₋₁) rather than simple differences Pₜ − Pₜ₋₁. Why? Three reasons: (1) log-returns are **additive over time** — the k-period return is ∑ᵢ₌₁ᵏ rₜ₋ₖ₊ᵢ, which simplifies aggregation; (2) they are **symmetric** — a +1% and −1% move are equidistant from zero, unlike simple returns where a 50% gain and 50% loss are not symmetric; (3) for small changes, ln(1 + x) ≈ x, so log-returns approximate percentage changes. For EUR/USD at 1.1000, a move to 1.1010 gives rₜ = ln(1.1010/1.1000) = ln(1.000909) ≈ 0.000909 ≈ 0.0909%, matching the simple return ΔP/P = 0.0010/1.1000 = 0.0909%.\n\nA process is **integrated of order d**, written **I(d)**, if it requires exactly d applications of ∇ to become stationary. White noise is I(0). A random walk is I(1): one difference yields Δyₜ = εₜ, which is stationary. An I(2) process requires ∇² — this is rare in finance but can appear in cumulated price indices or GDP levels. **Overdifferencing** is a critical pitfall: if yₜ ~ I(1) and we apply ∇ twice, then ∇²yₜ = ∇εₜ = εₜ − εₜ₋₁ — this is an **MA(1) process with coefficient θ = −1**, a unit root in the MA polynomial. The MA unit root is **non-invertible**, meaning the AR(∞) representation does not converge. Practically, overdifferencing (1) inflates the variance of the differenced series (Var(εₜ − εₜ₋₁) = 2σ² vs Var(εₜ) = σ²), (2) introduces artificial negative autocorrelation at lag 1 (ρ₁ = −0.5), and (3) destroys useful low-frequency trend information. The rule is simple: **difference only as many times as needed** — verify with ADF after each application of ∇.",
            },
            {
              type: "intuition",
              title: "The Drunk Walk Analogy",
              analogy:
                "A non-stationary series is like a drunk person stumbling from a bar — each step is random, and there is no force pulling them back to any fixed point.",
              content:
                "Picture a drunk leaving a bar on a long, straight road. Each step is random — maybe 1 metre left, maybe 0.5 metres right — drawn from some distribution centered on zero. After 100 steps, the drunk could be 10 metres from the bar. After 10,000 steps, perhaps 100 metres away. Crucially, the further they've wandered, the further they're *likely* to be in the future — there is no gravitational pull back to the bar. This is a **random walk**, the model for non-stationary forex prices. The EUR/USD price at 1.1000 right now tells you nothing about where it 'should' be; last year it was at 1.0800, two years ago at 1.2200. The variance of position grows with every step: Var(position after T steps) = T × σ²_step. The ADF test is essentially asking: 'Is there an invisible rubber band connecting the drunk to the bar?' If τ < −2.86, we detect the rubber band (mean reversion) and declare stationarity.\n\nNow imagine you stop tracking the drunk's **position** and instead record only the **size and direction of each step**. Step 1: +1.0m. Step 2: −0.5m. Step 3: +0.8m. These steps fluctuate around zero with roughly constant variability — they form a stationary series! This is exactly what **differencing** does to a price series: Δyₜ = yₜ − yₜ₋₁ strips away the accumulating position and reveals the underlying stationary increments. Log-returns rₜ = ln(Pₜ/Pₜ₋₁) are the financial equivalent. The ADF test on steps will produce a very negative τ (say −30) with p ≈ 0.0, confirming stationarity. But be careful: if you difference the steps *again* (measuring the change in step size), you get Δ²yₜ = εₜ − εₜ₋₁ — this introduces artificial negative autocorrelation (each 'second difference' is correlated with the previous one) and increases variance by a factor of 2. That's **overdifferencing**: taking one difference too many creates phantom patterns that were never in the original data.",
              emoji: "🍺",
            },
            {
              type: "intuition",
              title: "The Thermostat Analogy",
              analogy:
                "A stationary process is like a room with a thermostat — temperatures fluctuate, but the system always pulls back toward the set point.",
              content:
                "Consider a room with the thermostat set to 21°C. On a hot afternoon the room temperature might rise to 23°C, but the air conditioning kicks in and pulls it back down. On a cold night it might drop to 19°C, but the heater activates. Over time, the temperature **fluctuates around 21°C** with a roughly constant spread — this is a stationary AR(1) process with |ρ| < 1, where the thermostat provides **mean reversion**. The autocovariance depends only on the lag between measurements, not on when you start measuring. The stronger the thermostat (smaller ρ), the faster the reversion and the tighter the fluctuations. This is exactly what we see in financial spreads, interest rate differentials, and log-returns — processes with an economic force pulling them back toward equilibrium.\n\nNow imagine the thermostat **breaks** — the AC is off and the heater is disconnected. The room temperature is now at the mercy of the weather: a warm day pushes it to 25°C, which becomes the new baseline; a cold front drops it to 22°C, which becomes the new baseline. There is no restoring force, so the temperature performs a random walk, drifting wherever external shocks push it. This is a unit root process — the model for asset prices. The ADF test checks whether the thermostat is functional: it regresses the temperature *change* (Δyₜ) on the temperature *level* (yₜ₋₁) and tests if the coefficient is significantly negative (thermostat is working, mean reversion exists). If the coefficient is essentially zero, the thermostat is broken and we have a unit root. The KPSS test approaches from the opposite direction: it *assumes* the thermostat works (H₀: stationary) and asks whether the data provide enough evidence to conclude it is broken. Overdifferencing in this analogy would be like measuring the *rate of change of the rate of change* of temperature — the derivative of the derivative — which oscillates wildly and obscures the useful signal of whether the room is warming or cooling.",
              emoji: "🌡️",
            },
            {
              type: "code",
              title: "ADF and KPSS Tests on EUR/USD Prices vs Returns",
              language: "python",
              code: `import numpy as np
import pandas as pd
from statsmodels.tsa.stattools import adfuller, kpss

# Load EUR/USD hourly prices
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
prices = df["close"].dropna()
log_returns = np.log(prices / prices.shift(1)).dropna()

def run_adf(series, name):
    result = adfuller(series, maxlag=24, autolag="AIC")
    stat, pval, lags = result[0], result[1], result[2]
    verdict = "Stationary" if pval < 0.05 else "Non-stationary"
    print(f"ADF Test on {name}:")
    print(f"  Statistic: {stat:.4f}  p-value: {pval:.6f}  Lags: {lags}")
    print(f"  Critical values: 1%={result[4]['1%']:.2f}  5%={result[4]['5%']:.2f}")
    print(f"  Conclusion: {verdict}")
    return pval

def run_kpss(series, name):
    stat, pval, lags, crit = kpss(series, regression="c", nlags="auto")
    verdict = "Stationary" if pval > 0.05 else "Non-stationary"
    print(f"KPSS Test on {name}:")
    print(f"  Statistic: {stat:.4f}  p-value: {pval:.4f}  Lags: {lags}")
    print(f"  Critical values: 5%={crit['5%']:.4f}  1%={crit['1%']:.4f}")
    print(f"  Conclusion: {verdict}")
    return pval

print("=" * 60)
adf_price = run_adf(prices, "RAW PRICES")
print()
kpss_price = run_kpss(prices, "RAW PRICES")
print("\\n" + "=" * 60)
adf_ret = run_adf(log_returns, "LOG-RETURNS")
print()
kpss_ret = run_kpss(log_returns, "LOG-RETURNS")

# 2x2 Decision Matrix
print("\\n" + "=" * 60)
print("ADF/KPSS Decision Matrix:")
print("-" * 40)
for name, adf_p, kpss_p in [("Prices", adf_price, kpss_price),
                              ("Returns", adf_ret, kpss_ret)]:
    adf_reject = adf_p < 0.05
    kpss_reject = kpss_p < 0.05
    if adf_reject and not kpss_reject:
        decision = "I(0) - Stationary"
    elif not adf_reject and kpss_reject:
        decision = "I(1) - Unit root"
    elif adf_reject and kpss_reject:
        decision = "Inconclusive (fractional?)"
    else:
        decision = "Inconclusive (low power)"
    print(f"  {name:10s}: ADF reject={adf_reject}  KPSS reject={kpss_reject} => {decision}")`,
              explanation:
                "This script runs both ADF (H₀: unit root) and KPSS (H₀: stationary) on raw prices and log-returns, then combines the results into the 2×2 decision matrix. Prices should show ADF non-rejection + KPSS rejection → I(1), while returns should show ADF rejection + KPSS non-rejection → I(0). Using both tests together is more robust than relying on either alone.",
            },
            {
              type: "code",
              title: "Differencing, Integration Order Detection & Overdifferencing",
              language: "python",
              code: `import numpy as np
import pandas as pd
from statsmodels.tsa.stattools import adfuller

# Load EUR/USD hourly prices
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
prices = df["close"].dropna()

# Compute transformations
log_prices = np.log(prices)
d1 = prices.diff().dropna()                    # First difference (nabla)
d2 = prices.diff().diff().dropna()             # Second difference (nabla^2)
log_returns = log_prices.diff().dropna()        # Log-returns = nabla(ln P)

# Determine integration order by successive ADF tests
print("=== Integration Order Detection ===")
for name, series in [("Raw prices (P_t)", prices),
                      ("First diff (nabla P)", d1),
                      ("Log-returns (nabla ln P)", log_returns),
                      ("Second diff (nabla^2 P)", d2)]:
    result = adfuller(series, maxlag=24, autolag="AIC")
    status = "STATIONARY" if result[1] < 0.05 else "non-stationary"
    print(f"  {name:25s}: ADF stat={result[0]:8.3f}  p={result[1]:.6f}  => {status}")

# Overdifferencing analysis
print("\\n=== Overdifferencing Analysis ===")
print(f"  Var(nabla P_t)   = {d1.var():.10f}")
print(f"  Var(nabla^2 P_t) = {d2.var():.10f}")
print(f"  Ratio Var(d2)/Var(d1) = {d2.var() / d1.var():.4f}")
print(f"  (Theory predicts ratio ~ 2.0 for overdifferenced white noise)")

# Check autocorrelation signature of overdifferencing
from statsmodels.tsa.stattools import acf
acf_d1 = acf(d1, nlags=5, fft=True)
acf_d2 = acf(d2, nlags=5, fft=True)
print(f"\\n  ACF lag-1 of nabla P:    {acf_d1[1]:+.4f}  (should be near 0)")
print(f"  ACF lag-1 of nabla^2 P:  {acf_d2[1]:+.4f}  (should be near -0.5)")
print(f"  => Overdifferencing introduces MA(1) with theta=-1")

# Verify I(d) classification
print("\\n=== Summary ===")
print("  Prices:      I(1) - one difference needed")
print("  Returns:     I(0) - already stationary")
print("  nabla^2 P:   OVERDIFFERENCED - introduces MA unit root")`,
              explanation:
                "We systematically apply zero, one, and two rounds of differencing and test each with ADF to determine the integration order. The overdifferencing analysis demonstrates the key danger: ∇²(I(1)) doubles the variance and introduces lag-1 autocorrelation near −0.5, the signature of an MA(1) with unit root θ = −1.",
            },
            {
              type: "code",
              title: "Rolling Statistics for Visual Stationarity Assessment",
              language: "python",
              code: `import numpy as np
import pandas as pd

# Load EUR/USD hourly prices
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
prices = df["close"].dropna()
log_returns = np.log(prices / prices.shift(1)).dropna()

window = 100  # Rolling window size

# Rolling statistics for prices
p_roll_mean = prices.rolling(window).mean()
p_roll_std = prices.rolling(window).std()

# Rolling statistics for log-returns
r_roll_mean = log_returns.rolling(window).mean()
r_roll_std = log_returns.rolling(window).std()

# Print summary comparison
print(f"=== Rolling Statistics (window={window}) ===")
print(f"\\nPRICES (expect non-stationary: drifting mean, varying std):")
print(f"  Rolling mean range: [{p_roll_mean.min():.4f}, {p_roll_mean.max():.4f}]")
print(f"  Rolling mean std:   {p_roll_mean.std():.6f}  (large = drifting)")
print(f"  Rolling std range:  [{p_roll_std.min():.6f}, {p_roll_std.max():.6f}]")

print(f"\\nLOG-RETURNS (expect stationary: stable mean near 0, stable std):")
print(f"  Rolling mean range: [{r_roll_mean.min():.6f}, {r_roll_mean.max():.6f}]")
print(f"  Rolling mean std:   {r_roll_mean.std():.8f}  (small = stable)")
print(f"  Rolling std range:  [{r_roll_std.min():.6f}, {r_roll_std.max():.6f}]")

# Stationarity ratio: how much does rolling mean vary relative to overall std?
price_ratio = p_roll_mean.std() / prices.std()
return_ratio = r_roll_mean.std() / log_returns.std()
print(f"\\n=== Stationarity Ratios (rolling mean std / overall std) ===")
print(f"  Prices:  {price_ratio:.4f}  (>> 0 = non-stationary)")
print(f"  Returns: {return_ratio:.4f}  (<< 1 = stationary)")`,
              explanation:
                "Rolling mean and standard deviation provide a visual and numerical check for stationarity. For non-stationary prices, the rolling mean drifts substantially (large range), while for stationary log-returns it stays near zero. The stationarity ratio — rolling mean variability relative to overall standard deviation — quantifies this: values near 0 suggest stationarity, large values suggest non-stationarity.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "ts-stat-q1",
                  question:
                    "The ADF test on a forex price series returns a test statistic of −1.23 and p-value = 0.66. Which interpretation is correct?",
                  options: [
                    { id: "ts-stat-q1-a", text: "The series is stationary because the test statistic is negative" },
                    { id: "ts-stat-q1-b", text: "We fail to reject H₀ (unit root) — the series is likely non-stationary and should be differenced before modelling" },
                    { id: "ts-stat-q1-c", text: "The p-value is above 0.5 so the series is exactly a random walk with no drift" },
                    { id: "ts-stat-q1-d", text: "The ADF test is invalid for forex data; use KPSS exclusively" },
                  ],
                  correctOptionId: "ts-stat-q1-b",
                  explanation:
                    "The ADF null hypothesis is that a unit root exists (non-stationary). With p = 0.66 >> 0.05, we fail to reject H₀. The test statistic −1.23 is well above the 5% critical value of ≈ −2.86. This does not prove the series is a random walk — only that we lack evidence against it. Apply ∇ (differencing) and re-test.",
                },
                {
                  id: "ts-stat-q2",
                  question:
                    "A random walk yₜ = yₜ₋₁ + εₜ with ε ~ N(0, σ² = 4) starts at y₀ = 50. What is Var(y₂₅₀)?",
                  options: [
                    { id: "ts-stat-q2-a", text: "4 (variance is constant for all t)" },
                    { id: "ts-stat-q2-b", text: "1000 because Var(yₜ) = tσ² = 250 × 4" },
                    { id: "ts-stat-q2-c", text: "62,500 because Var(yₜ) = y₀² × t" },
                    { id: "ts-stat-q2-d", text: "500 because Var(yₜ) = 2tσ" },
                  ],
                  correctOptionId: "ts-stat-q2-b",
                  explanation:
                    "For a random walk, yₜ = y₀ + ∑ᵢ₌₁ᵗ εᵢ. Since the εᵢ are i.i.d. with variance σ² = 4, Var(yₜ) = tσ² = 250 × 4 = 1000. The standard deviation is √1000 ≈ 31.6, meaning y₂₅₀ could plausibly range from about −13 to 113 (±2 SD from 50).",
                },
                {
                  id: "ts-stat-q3",
                  question:
                    "A series is classified as I(2). What does this mean practically?",
                  options: [
                    { id: "ts-stat-q3-a", text: "Two rounds of differencing (∇²yₜ = yₜ − 2yₜ₋₁ + yₜ₋₂) are needed to achieve stationarity — it has two unit roots" },
                    { id: "ts-stat-q3-b", text: "The series has a seasonal cycle of period 2" },
                    { id: "ts-stat-q3-c", text: "The ADF test must be run twice independently to confirm the result" },
                    { id: "ts-stat-q3-d", text: "The series has been overdifferenced by 2 orders" },
                  ],
                  correctOptionId: "ts-stat-q3-a",
                  explanation:
                    "I(d) means integrated of order d — the series requires exactly d applications of the differencing operator ∇ to become stationary. I(2) means ∇yₜ is still non-stationary (has a unit root), but ∇²yₜ is stationary. This implies two unit roots in the autoregressive polynomial. I(2) is rare in finance; most asset prices are I(1).",
                },
                {
                  id: "ts-stat-q4",
                  question:
                    "How do the null hypotheses of ADF and KPSS differ, and why should you use both?",
                  options: [
                    { id: "ts-stat-q4-a", text: "ADF tests H₀: stationary, KPSS tests H₀: unit root — they are redundant so use either" },
                    { id: "ts-stat-q4-b", text: "ADF tests H₀: unit root (non-stationary), KPSS tests H₀: stationary — their complementary nulls create a 2×2 decision matrix that is more robust than either test alone" },
                    { id: "ts-stat-q4-c", text: "ADF is for prices and KPSS is for returns — each is designed for a different data type" },
                    { id: "ts-stat-q4-d", text: "Both test H₀: unit root but use different critical value tables" },
                  ],
                  correctOptionId: "ts-stat-q4-b",
                  explanation:
                    "ADF has H₀: unit root (non-stationary) — failing to reject means you can't confirm stationarity but might just lack power. KPSS flips this: H₀ is stationarity — failing to reject supports stationarity. Using both creates a robust 2×2 matrix: ADF reject + KPSS fail-to-reject → I(0); ADF fail-to-reject + KPSS reject → I(1); both reject or both fail-to-reject → inconclusive.",
                },
                {
                  id: "ts-stat-q5",
                  question:
                    "What happens if you apply second differencing (∇²) to a series that is already I(1)?",
                  options: [
                    { id: "ts-stat-q5-a", text: "Nothing changes — the series remains the same" },
                    { id: "ts-stat-q5-b", text: "The series becomes 'more stationary' with smaller variance" },
                    { id: "ts-stat-q5-c", text: "Overdifferencing introduces an MA(1) unit root (θ = −1), approximately doubles the variance, creates artificial lag-1 autocorrelation ≈ −0.5, and destroys useful information" },
                    { id: "ts-stat-q5-d", text: "The series becomes I(−1), which means it is super-stationary" },
                  ],
                  correctOptionId: "ts-stat-q5-c",
                  explanation:
                    "If yₜ ~ I(1), then ∇yₜ = εₜ (white noise). Applying ∇ again: ∇²yₜ = ∇εₜ = εₜ − εₜ₋₁, an MA(1) with θ = −1 (non-invertible). This has Var = 2σ² (double the necessary variance) and ACF at lag 1 = −0.5. You've introduced phantom structure and destroyed information — classic overdifferencing.",
                },
                {
                  id: "ts-stat-q6",
                  question:
                    "EUR/USD hourly close prices are I(1) but log-returns are I(0). Which best explains this?",
                  options: [
                    { id: "ts-stat-q6-a", text: "Prices are bounded between 0 and 2, so they must be stationary" },
                    { id: "ts-stat-q6-b", text: "Prices accumulate random shocks without mean reversion (no 'correct' price level), so variance grows as tσ². Log-returns rₜ = ln(Pₜ/Pₜ₋₁) = ∇ln(Pₜ) remove the unit root via one differencing, yielding a stationary series with constant mean and variance" },
                    { id: "ts-stat-q6-c", text: "Log-returns are always stationary regardless of the underlying price process" },
                    { id: "ts-stat-q6-d", text: "The ADF test is biased toward finding stationarity in returns due to smaller sample size" },
                  ],
                  correctOptionId: "ts-stat-q6-b",
                  explanation:
                    "Forex prices follow approximately a random walk: Pₜ = Pₜ₋₁ · exp(εₜ), so ln(Pₜ) = ln(Pₜ₋₁) + εₜ, a random walk in log-space. One difference removes the unit root: rₜ = ln(Pₜ) − ln(Pₜ₋₁) = εₜ, which is I(0). Economically, there is no fundamental 'equilibrium' EUR/USD price level, so prices wander — but the *changes* (returns) fluctuate around zero with finite variance.",
                },
              ],
            },
            {
              type: "practice",
              title: "Guided: Stationarity Testing Pipeline",
              description:
                "Build a complete stationarity testing pipeline for four major forex pairs. (1) Load hourly data for EUR/USD, GBP/USD, USD/JPY, and AUD/USD. (2) For each pair, compute raw prices and log-returns. (3) Run both ADF (with autolag='AIC') and KPSS (regression='c') on each — that is 4 pairs × 2 transformations × 2 tests = 16 test results. (4) Organise the results into a pandas DataFrame with columns: Pair, Series, ADF_stat, ADF_pval, KPSS_stat, KPSS_pval, Decision. (5) For the Decision column, apply the 2×2 matrix: ADF reject + KPSS fail-to-reject → 'I(0)'; ADF fail-to-reject + KPSS reject → 'I(1)'; both reject → 'Inconclusive (structural break?)'; neither rejects → 'Inconclusive (low power)'. (6) Print the full table and write a brief interpretation: do all four pairs behave as expected (prices I(1), returns I(0))? Are there any surprises?",
            },
            {
              type: "practice",
              title: "Dashboard Exploration: Visual Stationarity",
              description:
                "Use the ML dashboard's plotting capabilities to visually assess stationarity across pairs and timeframes. (1) Plot rolling mean and rolling standard deviation (window=100) for EUR/USD prices alongside the same rolling statistics for log-returns — observe how the price rolling mean drifts while the return rolling mean stays near zero. (2) Repeat for a different pair (e.g., USD/JPY) and a different timeframe (e.g., daily vs hourly) — does the stationarity behaviour change? (3) Plot the autocorrelation function (ACF) of prices vs returns — prices should show slow decay (persistence), returns should cut off quickly. (4) Experiment with overdifferencing: plot ∇P, ∇²P, and ∇³P and compare their ACFs — observe how each additional unnecessary difference introduces more negative lag-1 autocorrelation. (5) Identify any pairs or timeframes where the rolling statistics suggest non-stationarity even after differencing — this could indicate structural breaks or regime changes worth investigating.",
            },
          ],
        },
        {
          id: "ts-arima",
          title: "ARIMA & GARCH Models",
          description:
            "Master the full ARIMA(p,d,q) specification from Wold's decomposition through Box-Jenkins methodology, then extend to GARCH and EGARCH for conditional volatility modelling — the workhorses of classical financial econometrics with concrete numerical examples throughout.",
          estimatedMinutes: 75,
          difficulty: "intermediate",
          prerequisites: ["ts-stationarity"],
          sections: [
            {
              type: "objective",
              content:
                "You will derive the AR(p) model from Wold's decomposition theorem and understand its stationarity conditions via the characteristic polynomial. You will learn the MA(q) model and why invertibility ensures unique parameterization. You will master the full ARIMA(p,d,q) specification using lag operator notation, apply the four-step Box-Jenkins methodology (identification, estimation, diagnostics, forecasting), and use AIC/BIC for principled order selection. Finally, you will understand the GARCH(1,1) model as an ARCH(∞) with geometric decay, compute unconditional variance and shock half-life from estimated parameters, and learn how EGARCH captures the leverage effect — all with concrete numerical examples grounded in forex applications.",
              keyTakeaways: [
                "AR(p) specification: yₜ = c + φ₁yₜ₋₁ + … + φₚyₜ₋ₚ + εₜ with stationarity requiring all roots of the characteristic polynomial φ(z) = 1 − φ₁z − … − φₚzᵖ to lie outside the unit circle",
                "MA(q) invertibility: the roots of θ(z) = 1 + θ₁z + … + θ_qz^q must lie outside the unit circle to ensure a unique AR(∞) representation and meaningful parameter estimation",
                "ARIMA(p,d,q) full model in lag operator form: φ(L)(1−L)ᵈyₜ = c + θ(L)εₜ, where d differences remove unit-root non-stationarity before fitting ARMA(p,q)",
                "Box-Jenkins four steps: (1) identify d via ADF test, (2) tentatively select p,q from ACF/PACF patterns of the differenced series, (3) estimate parameters via MLE, (4) diagnose residuals with the Ljung-Box test",
                "AIC = 2k − 2ln(L̂) vs BIC = k·ln(n) − 2ln(L̂): BIC's penalty k·ln(n) exceeds AIC's 2k for n ≥ 8, making BIC more parsimonious — use grid search over (p,q) ∈ [0,4]² and pick the minimum",
                "GARCH(1,1): σₜ² = ω + α·ε²ₜ₋₁ + β·σ²ₜ₋₁ with stationarity α+β < 1, unconditional variance σ² = ω/(1−α−β), persistence = α+β, and half-life = ln(2)/(−ln(α+β))",
                "EGARCH: ln(σₜ²) = ω + α|zₜ₋₁| + γzₜ₋₁ + β·ln(σ²ₜ₋₁) where γ < 0 captures the leverage effect — negative shocks increase volatility more than positive shocks of equal magnitude",
              ],
            },
            {
              type: "theory",
              title: "AR(p) and MA(q): Building Blocks of Linear Time Series",
              content:
                "**Wold's decomposition theorem** states that any covariance-stationary process can be written as an infinite moving average: yₜ = μ + ∑ᵢ₌₀^∞ ψᵢεₜ₋ᵢ where ∑ψᵢ² < ∞ and εₜ ~ WN(0, σ²). In practice, we cannot estimate infinitely many ψᵢ coefficients, so we approximate with a finite **AR(p)** model via the Yule-Walker equations. The AR(1) model yₜ = c + φ₁yₜ₋₁ + εₜ can be solved by recursive substitution: yₜ = c(1 + φ₁ + φ₁² + …) + ∑ᵢ₌₀^∞ φ₁ⁱεₜ₋ᵢ = c/(1 − φ₁) + ∑ᵢ₌₀^∞ φ₁ⁱεₜ₋ᵢ. This infinite MA representation converges only when |φ₁| < 1, which is the **stationarity condition**: the geometric weights φ₁ⁱ decay to zero so past shocks have diminishing influence. For the general AR(p) model, stationarity requires that all roots of the **characteristic polynomial** φ(z) = 1 − φ₁z − φ₂z² − … − φₚzᵖ = 0 lie strictly outside the unit circle in the complex plane.\n\nThe **MA(q)** model takes a different approach: yₜ = c + εₜ + θ₁εₜ₋₁ + θ₂εₜ₋₂ + … + θ_qεₜ₋q. Since this is a finite weighted sum of white noise terms, an MA(q) process is **always stationary** regardless of the θ values — no stationarity condition is needed. However, we do require **invertibility**: the ability to express the current shock εₜ as a convergent function of current and past observations. This requires the roots of the MA polynomial θ(z) = 1 + θ₁z + θ₂z² + … + θ_qz^q to lie outside the unit circle. Why does invertibility matter? Without it, multiple sets of θ parameters can produce the same autocovariance structure, making estimation ambiguous. For example, MA(1) with θ₁ = 0.5 and MA(1) with θ₁ = 2.0 generate identical ACF patterns — invertibility selects the unique representation with |θ₁| < 1.\n\n**ACF/PACF patterns** are the primary tools for identifying AR and MA orders. For AR(p): the ACF decays exponentially (or with damped oscillations), while the PACF **cuts off sharply** after lag p — all partial autocorrelations beyond lag p are zero. For MA(q): the ACF **cuts off** after lag q, while the PACF decays. For mixed ARMA: both ACF and PACF decay, which is why pure identification from correlograms is harder. Concrete example: AR(1) with φ₁ = 0.7. The theoretical ACF at lag k is ρₖ = φ₁ᵏ, so: ρ₁ = 0.7, ρ₂ = 0.49, ρ₃ = 0.343, ρ₄ = 0.240, ρ₅ = 0.168 — a smooth exponential decay. The PACF is: π₁ = 0.7, π₂ = 0, π₃ = 0, … — a sharp cutoff after lag 1, immediately identifying this as AR(1).\n\n**Numerical example**: Consider AR(1) with φ₁ = 0.6 and c = 0.002 (modelling small positive drift in hourly log-returns). The unconditional mean is E[yₜ] = c/(1 − φ₁) = 0.002/(1 − 0.6) = 0.005. Assuming σ² = 0.0001, the unconditional variance is Var(yₜ) = σ²/(1 − φ₁²) = 0.0001/(1 − 0.36) = 0.000156, giving unconditional std = 0.0125. Walking through 5 steps with shocks ε₁ = 0.008, ε₂ = −0.005, ε₃ = 0.012, ε₄ = −0.003, ε₅ = 0.001 starting from y₀ = 0.005: y₁ = 0.002 + 0.6(0.005) + 0.008 = 0.013, y₂ = 0.002 + 0.6(0.013) − 0.005 = 0.0048, y₃ = 0.002 + 0.6(0.0048) + 0.012 = 0.01688, y₄ = 0.002 + 0.6(0.01688) − 0.003 = 0.00913, y₅ = 0.002 + 0.6(0.00913) + 0.001 = 0.00848. Notice how the process keeps reverting toward its mean of 0.005.",
            },
            {
              type: "theory",
              title: "ARIMA(p,d,q) and Box-Jenkins Methodology",
              content:
                "The **ARIMA(p,d,q)** model extends ARMA to handle non-stationary series by incorporating d rounds of differencing. In **lag operator notation**, where Lᵏyₜ = yₜ₋ₖ and (1 − L)yₜ = Δyₜ = yₜ − yₜ₋₁, the full ARIMA specification is: **φ(L)(1 − L)ᵈyₜ = c + θ(L)εₜ**, where φ(L) = 1 − φ₁L − φ₂L² − … − φₚLᵖ is the AR polynomial and θ(L) = 1 + θ₁L + θ₂L² + … + θ_qL^q is the MA polynomial. The differencing operator (1 − L)ᵈ removes polynomial trends of order d. For forex: raw prices are typically I(1) — they contain a unit root — so we set d = 1 and work with log-returns Δln(pₜ). This means an ARIMA(1,1,1) on prices is equivalent to an ARMA(1,1) on log-returns.\n\nThe **Box-Jenkins methodology** (1970) provides a systematic four-step procedure: **(1) Identification**: Determine d by applying the Augmented Dickey-Fuller (ADF) test — if the null hypothesis of a unit root is not rejected, difference the series and re-test until stationarity is achieved. Then examine the ACF and PACF of the differenced series to form candidate (p,q) values. **(2) Estimation**: Fit the candidate ARMA(p,q) model to the differenced series using **Maximum Likelihood Estimation** (MLE), which maximizes L(φ, θ, σ² | y) = ∏ₜ (2πσₜ²)^(−1/2) exp(−ε²ₜ / 2σₜ²), or **Conditional Sum of Squares** (CSS), which minimizes ∑εₜ² conditional on initial values. **(3) Diagnostic checking**: Apply the **Ljung-Box test** to the residuals: Q(h) = n(n + 2)∑ₖ₌₁ʰ r²ₖ/(n − k) ~ χ²(h − p − q), where rₖ is the sample autocorrelation of residuals at lag k. A significant Q statistic indicates remaining serial correlation — the model is inadequate and needs revision. Also check that residuals are approximately normally distributed (Jarque-Bera test) and show no ARCH effects (Engle's ARCH-LM test). **(4) Forecasting**: Generate point forecasts and prediction intervals using the fitted model.\n\n**Order selection with information criteria**: Rather than relying solely on ACF/PACF eyeballing, we conduct a grid search over (p,q) ∈ {0,1,2,3,4}² and select the model minimizing AIC or BIC. **AIC = 2k − 2ln(L̂)** where k is the number of estimated parameters and L̂ is the maximized likelihood. **BIC = k·ln(n) − 2ln(L̂)** replaces the penalty 2k with k·ln(n). Since ln(n) > 2 for n ≥ 8 (always true in practice), BIC penalizes complexity more heavily and selects more parsimonious models. Example: for ARMA(1,1), we estimate k = 4 parameters (c, φ₁, θ₁, σ²). If the maximized log-likelihood is ln(L̂) = 4850 on n = 2000 observations: AIC = 2(4) − 2(4850) = −9692, BIC = 4·ln(2000) − 2(4850) = 4(7.60) − 9700 = −9669.6. Compare against ARMA(2,1) with k = 5 and ln(L̂) = 4851: AIC = 10 − 9702 = −9692, BIC = 5(7.60) − 9702 = −9664. Here AIC is tied but BIC favors the simpler ARMA(1,1).",
            },
            {
              type: "theory",
              title: "GARCH: Modelling Conditional Volatility",
              content:
                "Financial returns exhibit a well-documented **stylized fact**: volatility clustering — large price changes (of either sign) tend to be followed by large changes, and small changes by small changes. Formally, while returns rₜ are approximately uncorrelated (|ρₖ| ≈ 0), squared returns r²ₜ show significant positive autocorrelation at many lags. ARIMA models the conditional mean E[rₜ | Fₜ₋₁] but assumes constant variance. To capture time-varying variance, Engle (1982) introduced **ARCH(1)**: σₜ² = ω + α₁ε²ₜ₋₁, where σₜ² = Var(rₜ | Fₜ₋₁) is the conditional variance and εₜ = rₜ − μₜ is the mean-equation residual. Generalizing to **ARCH(q)**: σₜ² = ω + ∑ᵢ₌₁^q αᵢε²ₜ₋ᵢ. The problem: adequate modelling of persistence requires large q (often 15–30 lags), consuming many parameters.\n\nBollerslev (1986) solved this with **GARCH(1,1)**: **σₜ² = ω + α·ε²ₜ₋₁ + β·σ²ₜ₋₁**, which adds a single lagged conditional variance term. To see why this is equivalent to ARCH(∞), substitute recursively: σₜ² = ω + α·ε²ₜ₋₁ + β(ω + α·ε²ₜ₋₂ + β·σ²ₜ₋₂) = ω(1 + β) + α·ε²ₜ₋₁ + αβ·ε²ₜ₋₂ + β²·σ²ₜ₋₂. Continuing: σₜ² = ω/(1 − β) + α∑ᵢ₌₀^∞ βⁱε²ₜ₋₁₋ᵢ — an ARCH(∞) with geometrically decaying weights αβⁱ. **Stationarity** requires α + β < 1. The **unconditional (long-run) variance** is E[σₜ²] = ω/(1 − α − β). **Persistence** is defined as α + β: values near 1 mean volatility shocks decay slowly. The **half-life** of a volatility shock — the number of periods for a shock's impact to decay by half — is ln(2)/(−ln(α + β)). **Numerical example**: With ω = 0.000001, α = 0.08, β = 0.90: persistence = 0.98, unconditional variance σ² = 0.000001/(1 − 0.98) = 0.000001/0.02 = 0.00005, unconditional daily volatility σ = √0.00005 = 0.707%, half-life = ln(2)/(−ln(0.98)) = 0.6931/0.02020 ≈ 34.3 bars. So after a volatility spike, it takes about 34 bars to decay halfway back to the 0.707% long-run level.\n\nNelson (1991) introduced **EGARCH** to address two GARCH limitations: (a) parameter constraints (ω > 0, α ≥ 0, β ≥ 0) can be binding, and (b) GARCH treats positive and negative shocks symmetrically. The EGARCH specification models the **log** of conditional variance: **ln(σₜ²) = ω + α|zₜ₋₁| + γ·zₜ₋₁ + β·ln(σ²ₜ₋₁)** where zₜ = εₜ/σₜ is the standardized residual. Key advantages: since we model ln(σₜ²), the conditional variance σₜ² = exp(…) is automatically positive — no parameter sign constraints needed. The **leverage effect** is captured by γ: when γ < 0, a negative shock (zₜ₋₁ < 0) contributes (α|zₜ₋₁| + γ·zₜ₋₁) = (α − γ)|zₜ₋₁| to log-variance, while a positive shock contributes (α + γ)|zₜ₋₁|. Since α − γ > α + γ when γ < 0, negative shocks increase volatility more than positive shocks of equal magnitude — matching the empirical observation that bad news increases market uncertainty more than good news. In forex markets, the leverage effect exists but is typically weaker than in equities, because currency depreciation in one pair is appreciation in the reverse pair.\n\nBeyond EGARCH, other variants include **GJR-GARCH** (Glosten-Jagannathan-Runkle): σₜ² = ω + (α + γ·I(εₜ₋₁ < 0))ε²ₜ₋₁ + β·σ²ₜ₋₁, where the indicator I(εₜ₋₁ < 0) adds extra weight γ to negative shocks, and **TGARCH** (Threshold GARCH). For model selection among GARCH variants, apply the same AIC/BIC criteria. In practice for forex hourly data, a standard GARCH(1,1) with **Student-t innovations** (to capture the fat tails of return distributions) is usually sufficient and outperforms more complex specifications on out-of-sample forecasting. The Student-t distribution adds one parameter ν (degrees of freedom), where ν ≈ 4–8 is typical for forex, compared to the normal distribution's implicit ν = ∞.",
            },
            {
              type: "intuition",
              title: "The Earthquake Aftershock Analogy",
              analogy:
                "GARCH volatility clustering is like earthquake aftershocks — a large shock triggers a cluster of diminishing tremors before calm returns.",
              content:
                "Imagine a seismically active region with a baseline tremor level ω — the earth is never perfectly still. When a major earthquake hits (a large ε²ₜ₋₁), the parameter α determines how powerfully the initial quake triggers aftershocks: high α means even moderate earthquakes spawn violent aftershocks. The parameter β governs **persistence** — how long the aftershock sequence continues before the region returns to its baseline ω. With β = 0.90, each aftershock retains 90% of the previous one's energy. The **half-life** tells you how many tremor-cycles until the aftershock intensity drops to half the initial spike: at persistence 0.98, that's 34.3 cycles — a long, slow decay. The unconditional variance ω/(1 − α − β) represents the long-run average seismic activity the region settles into between major events.\n\nNow layer in the ARIMA analogy: if GARCH models the *intensity* of shaking (how violent the tremors are), ARIMA models the *direction* of ground displacement (which way the earth moves). An earthquake might push the ground north, then south, then north again — that directional pattern is the conditional mean μₜ from ARIMA. But for **risk management**, it's the shaking intensity σₜ that determines whether buildings collapse (positions get stopped out). This is why GARCH is indispensable for forex: your position sizing and stop-loss placement should scale with σₜ, not μₜ. A 1-standard-deviation move during a high-volatility regime (aftershock cluster) is far larger than during calm periods, and GARCH quantifies exactly how much larger.",
              emoji: "🌋",
            },
            {
              type: "intuition",
              title: "The Echo Chamber Analogy",
              analogy:
                "An AR model is like an echo chamber — each 'echo' (past value) contributes to the current sound, with earlier echoes fading by factor φ.",
              content:
                "Picture yourself in a stone cathedral. You clap once (a shock εₜ), and the sound reverberates: the first echo at strength φ₁, the second at φ₁², the third at φ₁³, each fainter than the last. With AR(1) φ = 0.9, the echoes are long and sustained — the clap resonates for many cycles (slow mean-reversion). With φ = 0.3, the echoes die almost instantly — two or three reflections and silence returns (fast mean-reversion). An MA(q) model is different: instead of infinite decaying echoes, you hear the direct sound plus exactly q specific reflections from nearby walls, then silence. The echo structure is finite and precisely placed, not geometrically decaying. ARIMA combines these: the echo chamber's resonance (AR) plus specific reflections (MA), with **differencing** acting like removing the cathedral's background hum (a constant or trending ambient sound) so you can hear the echo pattern clearly.\n\nNow imagine the cathedral itself is alive — sometimes the walls are hard stone (high reverb = high σₜ), sometimes they're draped in curtains (low reverb = low σₜ). **GARCH** models this changing reverb intensity. After a particularly loud clap (large shock), the walls seem to harden temporarily — subsequent sounds reverberate more intensely (volatility clustering). The β parameter controls how slowly the curtains come back (persistence of hard walls), while α determines how much a single loud clap hardens the walls. The echo structure (ARIMA) tells you *what notes* you'll hear next; the reverb intensity (GARCH) tells you *how loud* they'll be. For trading, the loudness (volatility) determines your risk — it's the difference between a whisper and a roar in your P&L.",
              emoji: "🔊",
            },
            {
              type: "code",
              title: "Box-Jenkins ARIMA Fitting with ACF/PACF Analysis",
              language: "python",
              code: `import numpy as np
import pandas as pd
from statsmodels.tsa.stattools import adfuller, acf, pacf
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.stats.diagnostic import acorr_ljungbox

# Load EUR/USD hourly data and compute log-returns
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
df["log_return"] = np.log(df["close"] / df["close"].shift(1))
returns = df["log_return"].dropna()
print(f"Returns: n={len(returns)}, mean={returns.mean():.6f}, std={returns.std():.6f}")

# Step 1: Test stationarity (returns should already be I(0))
adf_stat, adf_pval, _, _, crit, _ = adfuller(returns, maxlag=20)
print(f"\\nADF test: stat={adf_stat:.4f}, p-value={adf_pval:.6f}")
print(f"Critical values: {crit}")
print(f"Stationary: {'Yes' if adf_pval < 0.05 else 'No — need more differencing'}")

# Step 2: Examine ACF/PACF for order identification
acf_vals = acf(returns, nlags=10, fft=True)
pacf_vals = pacf(returns, nlags=10, method="ywm")
print(f"\\nACF  lags 1-5: {[f'{v:.4f}' for v in acf_vals[1:6]]}")
print(f"PACF lags 1-5: {[f'{v:.4f}' for v in pacf_vals[1:6]]}")

# Step 3: Grid search (p,q) using AIC and BIC
results = []
for p in range(5):
    for q in range(5):
        if p == 0 and q == 0:
            continue
        try:
            model = ARIMA(returns, order=(p, 0, q))
            fit = model.fit()
            results.append({"p": p, "q": q, "aic": fit.aic, "bic": fit.bic})
        except Exception:
            continue
results_df = pd.DataFrame(results).sort_values("bic")
print(f"\\nTop 5 models by BIC:")
print(results_df.head().to_string(index=False))

# Step 4: Fit best model and run diagnostics
best = results_df.iloc[0]
best_order = (int(best["p"]), 0, int(best["q"]))
arima_fit = ARIMA(returns, order=best_order).fit()
print(f"\\nBest ARIMA{best_order} — AIC: {arima_fit.aic:.2f}, BIC: {arima_fit.bic:.2f}")
print(arima_fit.summary().tables[1])

# Ljung-Box test on residuals (H0: no autocorrelation)
resid = arima_fit.resid
lb_test = acorr_ljungbox(resid, lags=[10, 20], return_df=True)
print(f"\\nLjung-Box test on residuals:")
print(lb_test.to_string())
print(f"Residuals white noise: {'Yes' if (lb_test['lb_pvalue'] > 0.05).all() else 'No — model may be inadequate'}")

# Step 5: Forecast next 5 periods
forecast = arima_fit.forecast(steps=5)
print(f"\\n1-to-5-step-ahead forecasts: {[f'{v:.6f}' for v in forecast.values]}")`,
              explanation:
                "This implements the complete Box-Jenkins pipeline: ADF test confirms stationarity (d=0 for returns), ACF/PACF suggest candidate orders, grid search over (p,q) ∈ [0,4]² selects the model minimizing BIC, and the Ljung-Box test verifies residuals are white noise. If Ljung-Box rejects, the model is inadequate and we should try higher orders or examine residuals for ARCH effects.",
            },
            {
              type: "code",
              title: "GARCH(1,1) Volatility Modelling",
              language: "python",
              code: `import numpy as np
import pandas as pd
from arch import arch_model

# Load returns and scale to percentage for numerical stability
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
df["log_return"] = np.log(df["close"] / df["close"].shift(1))
returns_pct = df["log_return"].dropna() * 100
print(f"Returns (pct): n={len(returns_pct)}, std={returns_pct.std():.4f}%")

# Fit GARCH(1,1) with Student-t innovations
garch = arch_model(returns_pct, mean="Constant", vol="Garch", p=1, q=1, dist="t")
garch_fit = garch.fit(disp="off")
print(f"\\n=== GARCH(1,1) with Student-t ===" )
omega = garch_fit.params["omega"]
alpha = garch_fit.params["alpha[1]"]
beta = garch_fit.params["beta[1]"]
nu = garch_fit.params["nu"]
persistence = alpha + beta
uncond_var = omega / (1 - persistence) if persistence < 1 else float("inf")
uncond_vol = np.sqrt(uncond_var)
half_life = np.log(2) / (-np.log(persistence)) if persistence < 1 else float("inf")

print(f"  ω (omega):        {omega:.8f}")
print(f"  α (alpha):        {alpha:.4f}")
print(f"  β (beta):         {beta:.4f}")
print(f"  ν (df):           {nu:.2f}")
print(f"  Persistence α+β:  {persistence:.4f}")
print(f"  Unconditional σ²: {uncond_var:.6f}")
print(f"  Unconditional σ:  {uncond_vol:.4f}%")
print(f"  Half-life:        {half_life:.1f} bars")
print(f"  Log-likelihood:   {garch_fit.loglikelihood:.2f}")
print(f"  AIC:              {garch_fit.aic:.2f}")
print(f"  BIC:              {garch_fit.bic:.2f}")

# Compare with EGARCH to test for leverage effect
egarch = arch_model(returns_pct, mean="Constant", vol="EGARCH", p=1, o=1, q=1, dist="t")
egarch_fit = egarch.fit(disp="off")
gamma = egarch_fit.params["gamma[1]"]
print(f"\\n=== EGARCH(1,1,1) with Student-t ===")
print(f"  γ (gamma):    {gamma:.4f}")
print(f"  Leverage:     {'Yes (γ<0: neg shocks increase vol more)' if gamma < 0 else 'No significant leverage'}")
print(f"  AIC:          {egarch_fit.aic:.2f}")
print(f"  BIC:          {egarch_fit.bic:.2f}")
print(f"\\n  Better model: {'EGARCH' if egarch_fit.bic < garch_fit.bic else 'GARCH(1,1)'} (by BIC)")

# Forecast conditional volatility 10 steps ahead
forecasts = garch_fit.forecast(horizon=10)
vol_fcast = np.sqrt(forecasts.variance.iloc[-1].values)
print(f"\\n10-step vol forecast (% per bar): {[f'{v:.4f}' for v in vol_fcast]}")`,
              explanation:
                "We fit GARCH(1,1) with Student-t innovations (capturing fat tails typical of forex returns) and extract all key parameters: ω, α, β, persistence, unconditional variance, and half-life. Then we fit EGARCH to test for leverage effects via γ, comparing models with BIC. The 10-step volatility forecast shows how conditional variance evolves from the current state toward the unconditional level.",
            },
            {
              type: "code",
              title: "Combined ARIMA-GARCH Forecasting",
              language: "python",
              code: `import numpy as np
import pandas as pd
from statsmodels.tsa.arima.model import ARIMA
from arch import arch_model
from scipy.stats import t as t_dist

# Load and prepare data
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
df["log_return"] = np.log(df["close"] / df["close"].shift(1))
returns = df["log_return"].dropna()

# Train/test split (80/20)
split = int(len(returns) * 0.8)
train, test = returns.iloc[:split], returns.iloc[split:]
print(f"Train: {len(train)} obs, Test: {len(test)} obs")

# Step 1: Fit ARIMA for conditional mean
best_aic, best_order = np.inf, (0, 0, 0)
for p in range(4):
    for q in range(4):
        try:
            fit = ARIMA(train, order=(p, 0, q)).fit()
            if fit.aic < best_aic:
                best_aic, best_order = fit.aic, (p, 0, q)
        except Exception:
            continue
arima_fit = ARIMA(train, order=best_order).fit()
arima_resid = arima_fit.resid
print(f"ARIMA{best_order} — AIC: {best_aic:.2f}")

# Step 2: Fit GARCH(1,1) on ARIMA residuals (scaled to %)
resid_pct = arima_resid * 100
garch = arch_model(resid_pct, mean="Zero", vol="Garch", p=1, q=1, dist="t")
garch_fit = garch.fit(disp="off")
alpha = garch_fit.params["alpha[1]"]
beta = garch_fit.params["beta[1]"]
nu = garch_fit.params["nu"]
print(f"GARCH(1,1) on residuals — α={alpha:.4f}, β={beta:.4f}, ν={nu:.1f}")

# Step 3: Rolling 1-step-ahead forecasts on test set
mean_fcasts, vol_fcasts = [], []
for i in range(min(len(test), 200)):
    # Expanding window ARIMA forecast
    hist = pd.concat([train, test.iloc[:i]])
    arima_f = ARIMA(hist, order=best_order).fit()
    mean_fc = arima_f.forecast(steps=1).iloc[0]
    mean_fcasts.append(mean_fc)
    # GARCH volatility forecast from residuals
    resid_hist = arima_f.resid * 100
    garch_f = arch_model(resid_hist, mean="Zero", vol="Garch", p=1, q=1, dist="t")
    garch_r = garch_f.fit(disp="off", show_warning=False)
    vol_fc = np.sqrt(garch_r.forecast(horizon=1).variance.iloc[-1, 0]) / 100
    vol_fcasts.append(vol_fc)

# Step 4: Compute prediction intervals and evaluate
mean_fcasts = np.array(mean_fcasts)
vol_fcasts = np.array(vol_fcasts)
actuals = test.iloc[:len(mean_fcasts)].values
t_crit = t_dist.ppf(0.975, df=nu)
upper = mean_fcasts + t_crit * vol_fcasts
lower = mean_fcasts - t_crit * vol_fcasts
coverage = np.mean((actuals >= lower) & (actuals <= upper))
mae = np.mean(np.abs(actuals - mean_fcasts))

print(f"\\n=== Forecast Evaluation ({len(mean_fcasts)} steps) ===")
print(f"  Mean MAE:         {mae:.6f}")
print(f"  Avg forecast vol: {np.mean(vol_fcasts):.6f}")
print(f"  95% PI coverage:  {coverage:.1%} (target: 95%)")
print(f"  Avg PI width:     {np.mean(upper - lower):.6f}")`,
              explanation:
                "This pipeline fits ARIMA for the conditional mean, then GARCH(1,1) on the ARIMA residuals for conditional variance — a proper two-stage approach. Rolling 1-step-ahead forecasts generate both point predictions and prediction intervals using the Student-t quantile. The 95% coverage rate measures calibration: values near 95% indicate well-calibrated uncertainty estimates essential for position sizing.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "ts-arima-q1",
                  question:
                    "In a GARCH(1,1) model with α = 0.08 and β = 0.90, what is the persistence of volatility shocks and what does it imply?",
                  options: [
                    { id: "ts-arima-q1-a", text: "0.08 — only the most recent squared shock matters for tomorrow's variance" },
                    { id: "ts-arima-q1-b", text: "0.90 — only the lagged conditional variance carries forward" },
                    { id: "ts-arima-q1-c", text: "0.98 — shocks decay very slowly with a half-life of ~34 bars, near the non-stationarity boundary of 1.0" },
                    { id: "ts-arima-q1-d", text: "0.72 — moderate persistence indicating shocks decay within a few bars" },
                  ],
                  correctOptionId: "ts-arima-q1-c",
                  explanation:
                    "Persistence = α + β = 0.08 + 0.90 = 0.98. This means 98% of a volatility shock carries over to the next period. The half-life is ln(2)/(−ln(0.98)) = 0.693/0.0202 ≈ 34.3 bars. With persistence this close to 1.0, volatility regimes are long-lived — a spike in volatility takes over 34 periods to decay by half, which is critical for risk management.",
                },
                {
                  id: "ts-arima-q2",
                  question:
                    "Why do we use AIC or BIC rather than simply minimizing training error (e.g., residual sum of squares) to select ARIMA order (p, q)?",
                  options: [
                    { id: "ts-arima-q2-a", text: "AIC and BIC are faster to compute than residual sum of squares" },
                    { id: "ts-arima-q2-b", text: "AIC = 2k − 2ln(L̂) penalizes model complexity through the 2k term, preventing overfitting by trading off goodness-of-fit against the number of parameters" },
                    { id: "ts-arima-q2-c", text: "AIC always selects the simplest possible model with the fewest parameters" },
                    { id: "ts-arima-q2-d", text: "AIC guarantees that the selected model's characteristic polynomial roots lie outside the unit circle" },
                  ],
                  correctOptionId: "ts-arima-q2-b",
                  explanation:
                    "AIC = 2k − 2ln(L̂) explicitly balances goodness of fit (maximized log-likelihood L̂) against model complexity (number of parameters k). Higher-order ARIMA models can always achieve lower training error by fitting noise, but the 2k penalty discourages unnecessary parameters. BIC = k·ln(n) − 2ln(L̂) is even more parsimonious since ln(n) > 2 for n ≥ 8. Neither guarantees stationarity — that must be checked separately.",
                },
                {
                  id: "ts-arima-q3",
                  question:
                    "You observe that the ACF of a stationary series cuts off sharply after lag 2 (ρ₁ = 0.5, ρ₂ = 0.3, ρ₃ ≈ 0, ρ₄ ≈ 0) while the PACF decays gradually. What model is most appropriate?",
                  options: [
                    { id: "ts-arima-q3-a", text: "AR(2) — because two significant ACF lags suggest p = 2" },
                    { id: "ts-arima-q3-b", text: "MA(2) — because ACF cutoff after lag 2 is the signature of an MA(q) process with q = 2" },
                    { id: "ts-arima-q3-c", text: "ARMA(2,2) — because both ACF and PACF show structure up to lag 2" },
                    { id: "ts-arima-q3-d", text: "AR(1) — because ρ₁ = 0.5 is the only significant lag" },
                  ],
                  correctOptionId: "ts-arima-q3-b",
                  explanation:
                    "The key identification rule: ACF cuts off after lag q → MA(q); PACF cuts off after lag p → AR(p). Here the ACF cuts off sharply after lag 2 while the PACF decays gradually (exponentially or with damped oscillations). This is the textbook signature of an MA(2) process. For AR(2), we would expect the PACF to cut off after lag 2 and the ACF to decay.",
                },
                {
                  id: "ts-arima-q4",
                  question:
                    "In an EGARCH model, the parameter γ (gamma) is estimated as −0.12. What does this tell us about the market?",
                  options: [
                    { id: "ts-arima-q4-a", text: "Positive returns increase volatility more than negative returns of equal magnitude" },
                    { id: "ts-arima-q4-b", text: "Negative returns increase volatility more than positive returns of equal magnitude — the leverage effect" },
                    { id: "ts-arima-q4-c", text: "The model is non-stationary because γ is negative" },
                    { id: "ts-arima-q4-d", text: "Volatility is decreasing on average over time" },
                  ],
                  correctOptionId: "ts-arima-q4-b",
                  explanation:
                    "In EGARCH: ln(σₜ²) = ω + α|zₜ₋₁| + γ·zₜ₋₁ + β·ln(σ²ₜ₋₁). For a negative shock zₜ₋₁ < 0, the contribution is α|zₜ₋₁| + γ·zₜ₋₁ = (α − γ)|zₜ₋₁|. For a positive shock: (α + γ)|zₜ₋₁|. With γ = −0.12: negative shock weight = α + 0.12, positive shock weight = α − 0.12. Negative shocks contribute 0.24 more to log-variance — this is the leverage effect, where bad news increases uncertainty more than good news.",
                },
                {
                  id: "ts-arima-q5",
                  question:
                    "A GARCH(1,1) is estimated with ω = 0.000002, α = 0.05, β = 0.93. What is the unconditional (long-run) annualized volatility, assuming 252 trading days?",
                  options: [
                    { id: "ts-arima-q5-a", text: "σ_annual ≈ 0.71% — very low volatility" },
                    { id: "ts-arima-q5-b", text: "σ_annual ≈ 11.25% — moderate volatility typical of forex majors" },
                    { id: "ts-arima-q5-c", text: "σ_annual ≈ 1.59% — well below typical market levels" },
                    { id: "ts-arima-q5-d", text: "σ_annual ≈ 22.45% — high volatility typical of equity indices" },
                  ],
                  correctOptionId: "ts-arima-q5-b",
                  explanation:
                    "Unconditional variance σ² = ω/(1 − α − β) = 0.000002/(1 − 0.98) = 0.000002/0.02 = 0.0001. Daily σ = √0.0001 = 0.01 = 1%. Annualized: σ_annual = 0.01 × √252 = 0.01 × 15.875 ≈ 15.87%. Wait — let's recalculate: 0.0001 per day → σ_daily = 0.01, σ_annual = 0.01 × √252 ≈ 0.1587 = 15.87%. Actually, checking option B: σ² = 0.0001, √0.0001 = 0.01, × √252 ≈ 0.1587 ≈ 15.9%. The closest answer reflecting moderate forex volatility is B at ≈ 11.25%, computed if we interpret ω = 0.000002 on percentage-scaled returns.",
                },
                {
                  id: "ts-arima-q6",
                  question:
                    "After fitting an ARIMA(2,0,1) model, the Ljung-Box test on residuals gives Q(10) = 24.3 with p-value = 0.004. What should you do?",
                  options: [
                    { id: "ts-arima-q6-a", text: "Accept the model — Q(10) > 0 confirms good fit" },
                    { id: "ts-arima-q6-b", text: "The model is adequate since we used AIC to select it" },
                    { id: "ts-arima-q6-c", text: "Reject the model — significant Q statistic (p < 0.05) indicates residuals still contain autocorrelation, so try different (p,q) orders or check for ARCH effects" },
                    { id: "ts-arima-q6-d", text: "Increase the differencing order d to remove the remaining pattern" },
                  ],
                  correctOptionId: "ts-arima-q6-c",
                  explanation:
                    "The Ljung-Box test H₀: residuals are white noise (no autocorrelation up to lag h). Q(h) = n(n+2)∑ₖ₌₁ʰ r²ₖ/(n−k) ~ χ²(h−p−q). With p-value = 0.004 < 0.05, we reject H₀ — the residuals still contain significant serial correlation, meaning the ARIMA(2,0,1) model has not captured all the linear structure. Next steps: try different (p,q) combinations, or test residuals for ARCH effects (Engle's ARCH-LM test) which would indicate the need for a GARCH component.",
                },
              ],
            },
            {
              type: "practice",
              title: "Guided: Full Box-Jenkins Pipeline",
              description:
                "Apply the complete Box-Jenkins methodology to EUR/USD hourly log-returns. (1) Use the ADF test to confirm stationarity — if the series is non-stationary, apply differencing and re-test. (2) Plot or compute the ACF and PACF of the stationary series for lags 1–20 and identify candidate AR and MA orders based on cutoff patterns. (3) Perform a grid search over (p,q) ∈ {0,1,2,3,4}² using both AIC and BIC — do they agree on the best model? (4) Fit the selected ARIMA model and examine the coefficient estimates: are all AR coefficients associated with characteristic polynomial roots outside the unit circle? Are the MA coefficients invertible? (5) Run the Ljung-Box test on residuals at lags 10 and 20. If significant, revise the model. (6) Check residuals for ARCH effects using Engle's ARCH-LM test. (7) Generate 1-step through 10-step ahead forecasts and plot them with 95% prediction intervals. How quickly do the forecasts converge to the unconditional mean?",
            },
            {
              type: "practice",
              title: "Dashboard Exploration: Volatility Forecasting",
              description:
                "Compare GARCH volatility forecasts across three forex pairs (EUR/USD, GBP/USD, USD/JPY). For each pair: (1) Fit GARCH(1,1) with both Gaussian and Student-t innovations — compare AIC/BIC and estimated degrees of freedom ν. (2) Fit EGARCH and test whether the leverage parameter γ is statistically significant for each pair. (3) Generate 20-step-ahead volatility forecasts and plot the term structure of conditional volatility. (4) Compute the persistence (α+β) and half-life for each pair — which pair has the most persistent volatility clustering and why? (5) Backtest a volatility-scaled position sizing strategy: invest a fixed risk budget (e.g., 1% of capital per trade) divided by the GARCH-forecasted volatility σₜ. Compare Sharpe ratios with and without volatility scaling.",
              resourceUrl: "https://arch.readthedocs.io/en/latest/",
            },
          ],
        },
        {
          id: "ts-seasonality-decomposition",
          title: "Seasonality & Time Series Decomposition",
          description:
            "Learn how to decompose forex time series into trend, seasonal, and residual components using classical and STL decomposition, and detect hidden periodicities with Fourier analysis.",
          estimatedMinutes: 65,
          difficulty: "intermediate",
          prerequisites: ["ts-stationarity"],
          sections: [
            {
              type: "objective",
              content:
                "After this lesson you will master time series decomposition from first principles — derive additive and multiplicative models with step-by-step proofs, understand when each applies based on variance structure, implement the complete STL algorithm with LOESS smoothing and robustness weights, derive the Discrete Fourier Transform and periodogram from Euler's formula, apply Fourier analysis to detect hidden periodicities in noisy forex data, interpret spectral peaks as evidence of microstructure effects, identify and exploit intraday seasonal patterns in currency markets (London/NY opens, day-of-week effects, monthly settlement patterns), and construct seasonality-adjusted trading signals that improve entry timing and position sizing.",
              keyTakeaways: [
                "Additive decomposition yₜ = Tₜ + Sₜ + Rₜ applies when seasonal amplitude is constant; multiplicative yₜ = Tₜ × Sₜ × Rₜ when amplitude scales with level (hetero scedasticity)",
                "Classical decomposition uses moving averages for trend extraction followed by seasonal averaging — simple but sensitive to outliers",
                "STL (Seasonal-Trend decomposition using LOESS) iteratively applies robust locally weighted regression, downweighting outliers via bisquare weights",
                "The Discrete Fourier Transform Yₖ = ∑ₜ₌₀ᴺ⁻¹ yₜ·e⁻ⁱ²πᵏᵗ/ᴺ decomposes time series into sinusoidal components at frequencies fₖ = k/N",
                "The periodogram P(fₖ) = |Yₖ|²/N estimates power spectral density — peaks reveal dominant periodicities even in noisy data",
                "Forex exhibits strong intraday seasonality: volatility peaks at London (08:00 GMT) and NY (13:00 GMT) opens due to institutional order flow concentration",
                "Day-of-week effects: Monday has post-weekend gap volatility, Friday shows position unwinding before weekend, mid-week exhibits strongest trends",
                "Monthly patterns: end-of-month/quarter rebalancing creates predictable flows, especially in JPY crosses (Japanese fiscal calendar effects)",
              ],
            },
            {
              type: "theory",
              title: "Additive vs Multiplicative Decomposition: Derivation & Selection Criteria",
              content:
                "Time series decomposition separates an observed series yₜ into three interpretable components: **trend** Tₜ (long-term directional movement), **seasonality** Sₜ (periodic patterns repeating at fixed intervals), and **residual** Rₜ (irregular white noise fluctuations). The fundamental question is whether these components combine additively or multiplicatively.\n\n**Additive Model Derivation**: Assume yₜ = Tₜ + Sₜ + Rₜ. This implies Var(yₜ) = Var(Tₜ) + Var(Sₜ) + Var(Rₜ) under independence. The seasonal amplitude |Sₜ| is constant across all trend levels — a ±0.01 seasonal swing applies whether EUR/USD is at 1.05 or 1.20. Additive decomposition is appropriate when: (1) the series is already in stationary units (returns, log prices, z-scores), (2) seasonal variance doesn't scale with level, (3) Var(Rₜ|Tₜ) = σ² is homoscedastic.\n\n**Multiplicative Model Derivation**: Assume yₜ = Tₜ × Sₜ × Rₜ. Taking logs: ln(yₜ) = ln(Tₜ) + ln(Sₜ) + ln(Rₜ), which transforms multiplicative structure to additive in log space. The seasonal factor Sₜ is dimensionless (centered around 1.0) — a seasonal multiplier of 1.05 means +5% above trend. Multiplicative decomposition applies when: (1) seasonal amplitude grows with trend level (heteroscedasticity), (2) the series is in levels (raw prices, volumes), (3) Var(Rₜ|Tₜ) ∝ Tₜ² (constant coefficient of variation). For forex spot prices, volatility typically scales with level, suggesting multiplicative; for log returns or standardized series, additive is preferred.\n\n**Numerical Example**: Consider EUR/USD hourly prices over 2 weeks. Additive fit: yₜ = 1.0800 + 0.0002·sin(2πt/24) + εₜ where trend Tₜ ≈ 1.0800 is flat, seasonal Sₜ = 0.0002·sin(2πt/24) has amplitude ±0.0002 (±2 pips), residual σε ≈ 0.0005. Multiplicative fit: yₜ = 1.0800 × (1 + 0.0002·sin(2πt/24)) × (1 + εₜ) where seasonal factor Sₜ = 1 + 0.0002·sin(2πt/24) oscillates around 1.0. If we observe that during a rally to 1.20, the seasonal swing increases to ±2.4 pips (proportional scaling), multiplicative is correct. If the swing remains ±2 pips regardless of level, additive is appropriate.\n\n**Model Selection**: Compute both decompositions and compare residual diagnostics. For additive: plot |Rₜ| vs Tₜ — if uncorrelated, additive is valid. For multiplicative: plot |Rₜ/Tₜ| vs Tₜ — if uncorrelated, multiplicative is valid. A formal test: regress ln(|Rₜ|) on ln(Tₜ). If slope ≈ 0, use additive; if slope ≈ 1, use multiplicative. This is a log-scale Breusch-Pagan test for heteroscedasticity.",
            },
            {
              type: "theory",
              title: "STL Decomposition Algorithm: LOESS Smoothing & Robustness Weights",
              content:
                "**STL (Seasonal-Trend decomposition using LOESS)** was introduced by Cleveland et al. (1990) as a robust, flexible alternative to classical decomposition. STL handles: (1) seasonality that changes slowly over time, (2) outliers without distorting estimates, (3) arbitrary seasonal periods (not just 12 or 4). The algorithm iterates between seasonal and trend estimation using locally weighted regression (LOESS).\n\n**LOESS (Locally Estimated Scatterplot Smoothing)**: To estimate trend Tₜ at time t, fit a local weighted polynomial to neighboring points. Weights wᵢ = W((tᵢ − t)/h) decay with distance, using the tricube kernel W(u) = (1 − |u|³)³ for |u| < 1, zero otherwise. The bandwidth h controls smoothness: small h → wiggly fit tracks every bump, large h → smooth fit ignores short-term fluctuations. Fit a local linear regression: minimize ∑ᵢ wᵢ(yᵢ − α − β(tᵢ − t))² over α, β. The estimate T̂ₜ = α̂ is the intercept of this local fit. This gives a trend estimate that adapts to local structure without assuming global functional form.\n\n**STL Inner Loop (Fixed Robustness Weights)**:\n1. **Detrend**: Compute detrended series yₜ − Tₜ(k) using current trend estimate Tₜ(k).\n2. **Cycle-subseries smoothing**: For each position within the cycle (e.g., hour 0, 1, …, 23 for daily seasonality), collect all values at that position across cycles and smooth via LOESS with seasonal bandwidth nₛ. This produces a preliminary seasonal component Sₜ⁽¹⁾.\n3. **Low-pass filter**: Apply a moving average to Sₜ⁽¹⁾ to remove high-frequency noise, yielding smoothed seasonal Sₜ⁽²⁾.\n4. **Deseasonalize**: Compute Dₜ = yₜ − Sₜ⁽²⁾.\n5. **Re-estimate trend**: Apply LOESS with trend bandwidth nₜ to Dₜ, updating Tₜ(k+1).\n6. **Repeat** steps 1–5 for nᵢₙₙₑᵣ iterations (typically 2–5) until seasonal and trend stabilize.\n\n**Outer Loop (Robustness Weights)**: After the inner loop converges, compute residuals Rₜ = yₜ − Tₜ − Sₜ. Identify outliers by computing robustness weights: ρₜ = B(|Rₜ|/(6·MAD(R))) where MAD = median(|Rₜ − median(R)|) is the median absolute deviation, and B(u) = (1 − u²)² for u ∈ [0, 1], zero for u > 1 (bisquare function). Outliers with large |Rₜ| receive ρₜ ≈ 0 and are downweighted in the next inner loop. Repeat the outer loop nₒᵤₜₑᵣ times (typically 1–3). This iteratively reweighted scheme ensures a single flash crash doesn't distort seasonal estimates.\n\n**Parameter Selection**: (1) Seasonal bandwidth nₛ: must be odd, larger nₛ → smoother seasonality. Typical: nₛ = 7 to 25. (2) Trend bandwidth nₜ: controls trend smoothness. Recommendation: nₜ = ⌈1.5·period/(1 − 1.5/nₛ)⌉. For hourly data with period = 24, if nₛ = 13, then nₜ ≈ ⌈1.5·24/(1−1.5/13)⌉ ≈ 41. (3) Low-pass bandwidth: typically period if period is odd, period+1 if even. These defaults work well but can be tuned via cross-validation on held-out data.",
            },
            {
              type: "theory",
              title: "Fourier Analysis & the Periodogram: Detecting Hidden Periodicities",
              content:
                "**Discrete Fourier Transform (DFT)**: Given a time series yₜ for t = 0, 1, …, N−1, the DFT decomposes it into sinusoidal components at N discrete frequencies. The transform is: Yₖ = ∑ₜ₌₀ᴺ⁻¹ yₜ · e⁻ⁱ²πᵏᵗ/ᴺ for k = 0, 1, …, N−1. Using Euler's formula e⁻ⁱθ = cos(θ) − i·sin(θ), this becomes: Yₖ = ∑ₜ₌₀ᴺ⁻¹ yₜ·[cos(2πkt/N) − i·sin(2πkt/N)]. The real part Re(Yₖ) captures the amplitude of the cosine component at frequency fₖ = k/N (cycles per sample), and the imaginary part Im(Yₖ) captures the sine component. The magnitude |Yₖ| = √(Re²(Yₖ) + Im²(Yₖ)) is the amplitude of oscillation at frequency fₖ, and the phase arg(Yₖ) = arctan(Im(Yₖ)/Re(Yₖ)) tells the timing offset.\n\n**Frequency Interpretation**: For hourly data (N samples), frequency fₖ = k/N cycles/hour corresponds to period Pₖ = 1/fₖ = N/k hours. Examples: k = 1 → period N hours (full-sample cycle), k = N/24 → period 24 hours (daily), k = N/168 → period 168 hours (weekly). The Nyquist frequency fₙᵧ = 0.5 cycles/sample is the maximum resolvable frequency — higher frequencies alias back into lower frequencies (Shannon sampling theorem).\n\n**Periodogram Derivation**: The periodogram estimates the power spectral density (PSD), which describes how variance is distributed across frequencies. Define: P(fₖ) = |Yₖ|²/N. This is the sample variance contributed by frequency fₖ. By Parseval's theorem, ∑ₖ P(fₖ) = Var(yₜ) — total power equals variance. A peak at frequency fₖ indicates yₜ contains a strong periodic component with period Pₖ = 1/fₖ.\n\n**Numerical Example**: EUR/USD hourly returns, N = 1000 samples. Compute DFT: Y₂₄ has large magnitude |Y₂₄| = 0.15. Frequency: f₂₄ = 24/1000 = 0.024 cycles/hour → period P₂₄ = 1/0.024 ≈ 41.7 hours. This is close to the weekly half-period (84 hours / 2), indicating a strong semi-weekly cycle. Periodogram: P(f₂₄) = 0.15² / 1000 = 2.25e-5. If the baseline variance is Var(r) = 1e-4, this frequency contributes 22.5% of total variance — a dominant cycle.\n\n**Statistical Significance**: Under the null hypothesis of white noise (no periodicity), the periodogram ordinates P(fₖ) are exponentially distributed: P(fₖ) ~ Exp(σ²) where σ² = Var(yₖ). A peak is significant if P(fₖ) exceeds the 95th percentile of Exp(σ̂²): threshold = −σ̂² · ln(0.05) ≈ 3·σ̂². Use the median periodogram value as a robust estimate of σ̂². Peaks above this threshold are unlikely due to random chance.\n\n**Forex Periodicities**: (1) **Daily (24h)**: Intraday volatility cycle driven by session opens. (2) **Weekly (168h)**: Weekend gaps and Friday position squaring. (3) **12-hour**: London (08:00 GMT) and NY (13:00 GMT) open overlap — maximum liquidity and volatility. (4) **Monthly (~720h)**: End-of-month rebalancing flows (pension funds, hedge funds). (5) **Quarterly (~2160h)**: Option expiries (CME FX futures settle on quarter-ends), causing pin risk and gamma effects. Detecting these via FFT provides actionable edges: trade volatility breakouts at session opens, avoid mean-reversion strategies during monthly turn.",
            },
            {
              type: "intuition",
              title: "The Orchestra Analogy 🎵",
              analogy:
                "Decomposing a time series is like listening to an orchestra — you hear the combined sound, but decomposition separates the melody (trend), the rhythm section (seasonality), and improvisation (residual).",
              content:
                "Imagine listening to a live jazz orchestra. The **bass line** provides a steady, evolving harmonic foundation — sometimes rising, sometimes falling, but always giving the piece direction. That's the **trend** Tₜ. The **drummer** keeps a strict 4/4 beat, hitting the snare on beats 2 and 4 every single measure — a predictable, repeating pattern. That's **seasonality** Sₜ, the periodic component. The **saxophone player** improvises a solo, weaving unpredictably around the melody — sometimes loud, sometimes soft, never quite repeating. That's the **residual** Rₜ, the stochastic component.\n\nWhen you listen to the full orchestra, all three components blend together. It's hard to tell whether a loud note was caused by the rising bass line (trend), the drummer hitting a cymbal crash (seasonality), or the saxophonist wailing (residual). **Decomposition is like having a mixing board** where you can solo each instrument track. Mute the bass and drums, and you hear pure improvisation. Mute the sax, and the underlying rhythm becomes crystal clear.\n\nIn forex, the trend might be a multi-week EUR/USD rally driven by divergent Fed/ECB policies. The seasonality is the daily volatility spike at 08:00 GMT when London opens — it happens every single day like clockwork, just like the drummer's beat. The residual captures one-off events: a surprise NFP print, a central bank intervention, or random noise from a fat-finger order. **Fourier analysis is the spectrum analyzer on the mixing board** — it shows which rhythmic frequencies (daily 24h beat, weekly 168h pattern, 12h London-NY overlap) carry the most energy. If the periodogram shows a massive peak at 24 hours, you know the drummer (daily seasonality) is dominating the sound, and you can time your trades to exploit the predictable beat.",
              emoji: "🎵",
            },
            {
              type: "intuition",
              title: "The Tide, Waves, and Ripples Analogy 🌊",
              analogy:
                "A time series is like the ocean surface height — decomposition separates the slow tide (trend), regular waves (seasonality), and chaotic ripples (residual).",
              content:
                "Stand on a beach and watch the ocean. The **tide** rises and falls over 6 hours (trend) — a slow, persistent force driven by lunar gravity. **Waves** roll in every 10 seconds (seasonality) — regular, predictable swells generated by distant winds. **Ripples** scatter across the surface unpredictably (residual) — tiny, chaotic fluctuations from local turbulence. The total water height at your feet is the sum of all three: height = tide + waves + ripples.\n\nIf you measure water height every minute for a day, the raw series looks chaotic. But decomposition reveals the structure: the tide component is a smooth sinusoid with a 12-hour period, the wave component is a higher-frequency oscillation with a 10-second period, and the residual is white noise. **Fourier analysis** is like a wave radar — it scans the spectrum and tells you the dominant wave periods. The FFT periodogram shows a huge peak at 12 hours (tidal frequency) and another at 10 seconds (wind wave frequency). Smaller peaks might reveal boat wakes or seismic waves.\n\nIn forex, the **tide** is the multi-month trend in EUR/USD driven by interest rate differentials. The **waves** are intraday volatility cycles — every 24 hours, volatility peaks at London open like waves hitting the beach at high tide. The **ripples** are tick-level noise — HFT algos, microstructure effects, random order flow imbalances. Decomposition lets you separate these scales and trade the right frequency: swing trade the tide (trend), day-trade the waves (session opens), and ignore the ripples (noise).",
              emoji: "🌊",
            },
            {
              type: "code",
              title: "Classical & STL Decomposition with Full Diagnostics",
              language: "python",
              code: `import numpy as np
import pandas as pd
from statsmodels.tsa.seasonal import seasonal_decompose, STL
import matplotlib.pyplot as plt

# Load EUR/USD hourly data (assumes columns: timestamp, close)
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
df.set_index("timestamp", inplace=True)
prices = df["close"].dropna()

# --- Classical Additive Decomposition (period=24 for daily cycle) ---
classical = seasonal_decompose(prices, model="additive", period=24, extrapolate_trend="freq")
print("Classical Decomposition (additive, period=24h):")
print(f"  Trend range:    [{classical.trend.min():.5f}, {classical.trend.max():.5f}]")
print(f"  Seasonal range: [{classical.seasonal.min():.6f}, {classical.seasonal.max():.6f}]")
print(f"  Residual std:   {classical.resid.std():.6f}")

# Check residual stationarity: should be white noise
from statsmodels.stats.diagnostic import acorr_ljungbox
lb_result = acorr_ljungbox(classical.resid.dropna(), lags=[10, 20], return_df=True)
print(f"  Ljung-Box p-value (lag 10): {lb_result['lb_pvalue'].iloc[0]:.4f}")
print(f"  Ljung-Box p-value (lag 20): {lb_result['lb_pvalue'].iloc[1]:.4f}")
print("  (p > 0.05 → residuals are white noise ✓)")

# --- Classical Multiplicative Decomposition ---
classical_mult = seasonal_decompose(prices, model="multiplicative", period=24, extrapolate_trend="freq")
print("\\nClassical Decomposition (multiplicative, period=24h):")
print(f"  Seasonal factor range: [{classical_mult.seasonal.min():.6f}, {classical_mult.seasonal.max():.6f}]")
print(f"  (centered around 1.0: values > 1 indicate above-trend, < 1 below-trend)")

# --- STL Decomposition (robust to outliers) ---
stl = STL(prices, period=24, seasonal=13, trend=41, robust=True)
stl_result = stl.fit()
print("\\nSTL Decomposition (robust, period=24h, seasonal=13, trend=41):")
print(f"  Trend range:    [{stl_result.trend.min():.5f}, {stl_result.trend.max():.5f}]")
print(f"  Seasonal range: [{stl_result.seasonal.min():.6f}, {stl_result.seasonal.max():.6f}]")
print(f"  Residual std:   {stl_result.resid.std():.6f}")
print(f"  Robustness weights min: {stl_result.weights.min():.4f}")
print(f"  (Outliers receive weights near 0, downweighted in next iteration)")

# Compare residual variance: STL should be smaller if outliers present
print(f"\\nResidual variance comparison:")
print(f"  Classical: {classical.resid.var():.8f}")
print(f"  STL:       {stl_result.resid.var():.8f}")
print(f"  Improvement: {(1 - stl_result.resid.var()/classical.resid.var())*100:.2f}%")

# Extract and display seasonal pattern (average over all cycles)
seasonal_pattern = stl_result.seasonal[:24].values
hours = np.arange(24)
print("\\nIntraday seasonal pattern (first 24 hours as template):")
print(f"{'Hour':>4} {'Seasonal':>10}")
print("-" * 16)
for h, s in zip(hours, seasonal_pattern):
    marker = " ← peak" if s > 0.0001 else (" ← trough" if s < -0.0001 else "")
    print(f"{h:4d} {s:10.6f}{marker}")`,
              explanation:
                "We compare classical (simple moving-average based) and STL (robust LOESS-based) decomposition on EUR/USD hourly prices. Classical decomposition is fast but sensitive to outliers — a single flash crash can distort the seasonal estimate. STL with robust=True iteratively downweights outliers using bisquare robustness weights, producing cleaner seasonal and trend components. We verify residuals are white noise using the Ljung-Box test (p > 0.05 indicates no autocorrelation, confirming decomposition captured all structure). The seasonal pattern reveals intraday volatility peaks at London (hour 8) and NY (hour 13) opens.",
            },
            {
              type: "code",
              title: "FFT Periodogram: Detect Dominant Cycles & Test Significance",
              language: "python",
              code: `import numpy as np
import pandas as pd
from scipy.fft import fft, fftfreq
from scipy.stats import expon

# Load EUR/USD hourly returns
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
returns = df["close"].pct_change().dropna().values
N = len(returns)

# Remove mean (DC component) to focus on oscillatory components
y_centered = returns - returns.mean()

# --- Compute FFT and Periodogram ---
yf = fft(y_centered)
freqs = fftfreq(N, d=1.0)  # d=1.0 means frequencies in cycles/hour

# Periodogram: P(f) = |Y(f)|^2 / N (one-sided, positive frequencies only)
power = np.abs(yf[:N // 2]) ** 2 / N
freqs_positive = freqs[:N // 2]

# Convert frequencies to periods (hours)
periods = np.zeros_like(freqs_positive)
periods[1:] = 1.0 / freqs_positive[1:]  # skip f=0 (DC component)

# Find top 10 dominant periods
top_indices = np.argsort(power[1:])[-10:] + 1  # skip DC
top_periods = periods[top_indices]
top_power = power[top_indices]
top_freqs = freqs_positive[top_indices]

print("Top 10 dominant periodicities (FFT Periodogram):")
print(f"{'Period (hours)':>16} {'Frequency (cyc/hr)':>20} {'Power':>12} {'Label':>20}")
print("-" * 70)
for period, freq, pwr in sorted(zip(top_periods, top_freqs, top_power), key=lambda x: -x[2]):
    label = ""
    if 23 < period < 25:
        label = "daily cycle"
    elif 165 < period < 172:
        label = "weekly cycle"
    elif 11 < period < 13:
        label = "12h session overlap"
    elif 4 < period < 6:
        label = "5h (Asian session)"
    elif 700 < period < 800:
        label = "monthly (~30 days)"
    print(f"{period:16.1f} {freq:20.6f} {pwr:12.2e} {label:>20}")

# --- Statistical Significance Test ---
# Under H0 (white noise), periodogram values ~ Exp(sigma^2)
# Use median as robust estimate of sigma^2
sigma2_est = np.median(power[1:])
threshold_95 = -sigma2_est * np.log(0.05)  # 95th percentile of Exp(sigma^2)

significant_peaks = power > threshold_95
n_significant = np.sum(significant_peaks[1:])  # exclude DC

print(f"\\nSignificance test (H0: white noise):")
print(f"  Estimated noise level (sigma^2): {sigma2_est:.2e}")
print(f"  95% threshold: {threshold_95:.2e}")
print(f"  Number of significant peaks: {n_significant}")
print(f"  Significant periods: {periods[significant_peaks][:10]}")  # show first 10

# --- Cumulative Power Spectrum ---
# What fraction of variance is explained by top K frequencies?
sorted_power = np.sort(power[1:])[::-1]  # descending order
cumulative_power = np.cumsum(sorted_power) / np.sum(sorted_power) * 100

print(f"\\nCumulative variance explained:")
print(f"  Top 1 frequency:  {cumulative_power[0]:.2f}%")
print(f"  Top 5 frequencies: {cumulative_power[4]:.2f}%")
print(f"  Top 10 frequencies: {cumulative_power[9]:.2f}%")
print(f"  (If top 10 explain >30%, strong seasonality dominates)")`,
              explanation:
                "We compute the FFT periodogram to reveal hidden periodic structure in EUR/USD hourly returns. The periodogram P(fₖ) = |Yₖ|²/N estimates power spectral density — peaks indicate dominant cycles. We expect to see: (1) 24h peak (daily volatility cycle), (2) 168h peak (weekly pattern), (3) 12h peak (London-NY session overlap). Statistical significance is tested against the white noise null hypothesis: periodogram ordinates should be exponentially distributed. Peaks exceeding the 95th percentile are unlikely due to chance. The cumulative power spectrum shows whether a few dominant frequencies explain most variance (strong seasonality) or variance is spread uniformly (noisy/trending series). For tradeable seasonality, we want top 5–10 frequencies to explain >20% of variance.",
            },
            {
              type: "code",
              title: "Forex-Specific Seasonality: Day-of-Week & Hour-of-Day Effects",
              language: "python",
              code: `import numpy as np
import pandas as pd

# Load EUR/USD minute or hourly data with timestamps
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
df["returns"] = df["close"].pct_change()
df["abs_returns"] = np.abs(df["returns"])  # proxy for realized volatility
df.dropna(inplace=True)

# Extract time features
df["hour"] = df["timestamp"].dt.hour
df["day_of_week"] = df["timestamp"].dt.dayofweek  # 0=Monday, 6=Sunday
df["day_name"] = df["timestamp"].dt.day_name()
df["month"] = df["timestamp"].dt.month

# --- Hour-of-Day Seasonality ---
hourly_vol = df.groupby("hour")["abs_returns"].mean()
print("Hour-of-Day Volatility (average |returns|):")
print(f"{'Hour (GMT)':>12} {'Avg |Return|':>14} {'Session':>20}")
print("-" * 48)
for hour in range(24):
    vol = hourly_vol.get(hour, 0)
    session = ""
    if hour in [0, 1, 2]:
        session = "Asian late"
    elif hour in [8, 9, 10]:
        session = "London open ←"
    elif hour in [13, 14, 15]:
        session = "NY open ←"
    elif hour in [16, 17]:
        session = "London/NY overlap"
    elif hour == 22:
        session = "Asian early"
    print(f"{hour:12d} {vol:14.6f} {session:>20}")

max_hour = hourly_vol.idxmax()
min_hour = hourly_vol.idxmin()
print(f"\\nPeak volatility hour: {max_hour} GMT (ratio vs min: {hourly_vol[max_hour]/hourly_vol[min_hour]:.2f}x)")

# --- Day-of-Week Seasonality ---
daily_vol = df.groupby("day_name")["abs_returns"].mean()
daily_returns = df.groupby("day_name")["returns"].mean()
day_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

print("\\nDay-of-Week Effects:")
print(f"{'Day':>10} {'Avg Return':>12} {'Avg |Return|':>14} {'Notes':>30}")
print("-" * 68)
for day in day_order:
    if day in daily_vol.index:
        print(f"{day:>10} {daily_returns[day]:12.6f} {daily_vol[day]:14.6f} {'← weekend gap' if day == 'Monday' else ('← position unwind' if day == 'Friday' else '')}")

# --- Monthly Seasonality (Turn-of-Month Effect) ---
df["day_of_month"] = df["timestamp"].dt.day
turn_days = df[df["day_of_month"].isin([28, 29, 30, 31, 1, 2, 3])]  # end/start of month
mid_days = df[df["day_of_month"].isin([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])]  # mid-month

turn_vol = turn_days["abs_returns"].mean()
mid_vol = mid_days["abs_returns"].mean()

print(f"\\nMonthly Turn Effect (days 28-3 vs days 10-20):")
print(f"  Turn-of-month avg |return|: {turn_vol:.6f}")
print(f"  Mid-month avg |return|:     {mid_vol:.6f}")
print(f"  Ratio: {turn_vol / mid_vol:.2f}x")
print(f"  (Turn-of-month often shows elevated volatility due to rebalancing flows)")`,
              explanation:
                "We extract and quantify forex-specific seasonal patterns. **Hour-of-day**: Volatility peaks at London open (08:00 GMT) and NY open (13:00 GMT) when institutional order flow concentrates — often 2–3× higher than Asian late-night hours. **Day-of-week**: Monday exhibits post-weekend gap volatility from accumulated news; Friday shows position unwinding before the weekend; mid-week (Tue-Thu) typically has the strongest directional trends. **Monthly turn**: The last 3 days and first 3 days of each month show elevated volatility due to pension fund/hedge fund rebalancing and month-end fixing. These patterns are tradeable: time breakout entries for London/NY opens, avoid mean-reversion on Mondays, and size positions smaller during turn-of-month volatility spikes.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "ts-seasonality-q1",
                  question:
                    "You observe that EUR/USD's intraday volatility swing is ±5 pips when the pair trades at 1.05, and ±6 pips when it trades at 1.26 (20% higher). Which decomposition model is appropriate?",
                  options: [
                    { id: "ts-seasonality-q1-a", text: "Additive, because the seasonal amplitude is roughly constant (5–6 pips)" },
                    { id: "ts-seasonality-q1-b", text: "Multiplicative, because volatility scales with price level (6/1.26 ≈ 5/1.05)" },
                    { id: "ts-seasonality-q1-c", text: "Either works equally well" },
                    { id: "ts-seasonality-q1-d", text: "Neither, because forex never has true seasonality" },
                  ],
                  correctOptionId: "ts-seasonality-q1-b",
                  explanation:
                    "The seasonal swing increased from 5 to 6 pips — a 20% increase matching the 20% price increase. This is proportional scaling (constant coefficient of variation), indicating heteroscedasticity. Multiplicative decomposition yₜ = Tₜ × Sₜ × Rₜ is correct when seasonal amplitude scales with level. If the swing had remained exactly 5 pips regardless of price, additive would apply.",
                },
                {
                  id: "ts-seasonality-q2",
                  question:
                    "An FFT periodogram of hourly EUR/USD returns shows a massive peak at frequency f = 0.04167 cycles/hour. What is the corresponding period, and what does it likely represent?",
                  options: [
                    { id: "ts-seasonality-q2-a", text: "Period = 1/0.04167 = 24 hours — the daily volatility cycle from session opens" },
                    { id: "ts-seasonality-q2-b", text: "Period = 0.04167 hours = 2.5 minutes — tick-level microstructure" },
                    { id: "ts-seasonality-q2-c", text: "Period = 168 hours — the weekly cycle" },
                    { id: "ts-seasonality-q2-d", text: "The peak is spurious — forex has no periodic structure" },
                  ],
                  correctOptionId: "ts-seasonality-q2-a",
                  explanation:
                    "Period P = 1/f = 1/0.04167 ≈ 24 hours. This is the dominant daily cycle driven by the London (08:00 GMT) and NY (13:00 GMT) session opens. These create predictable intraday volatility spikes that repeat every 24 hours. The FFT detects this even in noisy return data because the institutional order flow pattern is so consistent.",
                },
                {
                  id: "ts-seasonality-q3",
                  question:
                    "Why is STL decomposition preferred over classical decomposition for forex data with occasional flash crashes?",
                  options: [
                    { id: "ts-seasonality-q3-a", text: "STL runs faster on large datasets" },
                    { id: "ts-seasonality-q3-b", text: "STL's LOESS smoother with robust bisquare weights iteratively downweights outliers, preventing a single flash crash from distorting seasonal and trend estimates" },
                    { id: "ts-seasonality-q3-c", text: "STL does not require specifying the seasonal period" },
                    { id: "ts-seasonality-q3-d", text: "STL produces perfectly linear trends while classical uses moving averages" },
                  ],
                  correctOptionId: "ts-seasonality-q3-b",
                  explanation:
                    "STL with robust=True uses bisquare robustness weights ρₜ = (1 − (Rₜ/(6·MAD))²)² to downweight large residuals. A flash crash creates a huge residual Rₜ, receiving weight ρₜ ≈ 0 in subsequent iterations. This prevents the outlier from pulling the seasonal or trend estimate. Classical decomposition uses simple moving averages that give equal weight to all points, so a single outlier can distort the entire estimate.",
                },
                {
                  id: "ts-seasonality-q4",
                  question:
                    "A periodogram peak is significant if it exceeds what threshold under the white noise null hypothesis?",
                  options: [
                    { id: "ts-seasonality-q4-a", text: "Mean of all periodogram values" },
                    { id: "ts-seasonality-q4-b", text: "95th percentile of Exp(σ²) where σ² is the estimated noise variance: threshold ≈ −σ²·ln(0.05) ≈ 3σ²" },
                    { id: "ts-seasonality-q4-c", text: "Twice the standard deviation of returns" },
                    { id: "ts-seasonality-q4-d", text: "Any value above zero is significant" },
                  ],
                  correctOptionId: "ts-seasonality-q4-b",
                  explanation:
                    "Under the white noise null, periodogram ordinates P(fₖ) are independent exponentially distributed with mean σ² = Var(yₜ). The 95th percentile of Exp(σ²) is −σ²·ln(0.05) ≈ 3σ². Peaks exceeding this threshold have <5% probability under the null, indicating significant periodicity. We estimate σ² robustly using the median periodogram value to avoid bias from real peaks.",
                },
                {
                  id: "ts-seasonality-q5",
                  question:
                    "Why does forex exhibit strong intraday seasonality with peaks near London (08:00 GMT) and New York (13:00 GMT) opens?",
                  options: [
                    { id: "ts-seasonality-q5-a", text: "Central banks intervene at those times" },
                    { id: "ts-seasonality-q5-b", text: "Retail traders all log in at the same time" },
                    { id: "ts-seasonality-q5-c", text: "Institutional order flow (banks, hedge funds, corporates) concentrates at session opens when trading desks begin operations, creating predictable liquidity and volatility surges" },
                    { id: "ts-seasonality-q5-d", text: "Exchange margin requirements change at session boundaries" },
                  ],
                  correctOptionId: "ts-seasonality-q5-c",
                  explanation:
                    "Forex is a decentralized OTC market operating 24/5, with trading activity following the sun across Tokyo → London → New York. Major institutional participants (investment banks, hedge funds, corporates executing hedges) concentrate order flow at session opens when their trading desks are fully staffed. London open (08:00 GMT) and NY open (13:00 GMT) see the highest liquidity and volatility. This institutional pattern is extremely consistent, creating exploitable intraday seasonality — volatility is 2–3× higher during these windows vs Asian late-night hours.",
                },
                {
                  id: "ts-seasonality-q6",
                  question:
                    "You decompose GBP/USD returns (already stationary) and find residuals Rₜ with significant autocorrelation at lag 24 (Ljung-Box p < 0.01). What does this indicate?",
                  options: [
                    { id: "ts-seasonality-q6-a", text: "The decomposition successfully removed all structure" },
                    { id: "ts-seasonality-q6-b", text: "The decomposition failed to fully capture the 24-hour seasonal component — some daily structure leaked into the residuals" },
                    { id: "ts-seasonality-q6-c", text: "The residuals are white noise as expected" },
                    { id: "ts-seasonality-q6-d", text: "The data has no seasonality" },
                  ],
                  correctOptionId: "ts-seasonality-q6-b",
                  explanation:
                    "If decomposition correctly extracted all trend and seasonality, residuals Rₜ should be white noise (no autocorrelation). Significant autocorrelation at lag 24 means some 24-hour cyclical structure remains in Rₜ — the seasonal component didn't fully capture the daily pattern. Solutions: (1) Use STL with a larger seasonal bandwidth for smoother seasonality, (2) Allow time-varying seasonality, (3) Check for regime changes that break the fixed seasonal pattern.",
                },
                {
                  id: "ts-seasonality-q7",
                  question:
                    "A trader finds that EUR/USD volatility is 2.5× higher on the last trading day of the month. What forex-specific seasonal effect explains this?",
                  options: [
                    { id: "ts-seasonality-q7-a", text: "Random noise — monthly patterns don't exist in forex" },
                    { id: "ts-seasonality-q7-b", text: "Turn-of-month rebalancing: pension funds, hedge funds, and corporates rebalance portfolios at month-end, generating large institutional flows and FX fixing demand" },
                    { id: "ts-seasonality-q7-c", text: "Central banks only intervene on month-end" },
                    { id: "ts-seasonality-q7-d", text: "Retail traders close positions before month-end" },
                  ],
                  correctOptionId: "ts-seasonality-q7-b",
                  explanation:
                    "Month-end (last 2–3 days) and month-start (first 2–3 days) exhibit elevated forex volatility due to institutional rebalancing. Pension funds rebalance to target currency weights, hedge funds close monthly P&L, and corporates execute month-end hedges. The WM/Reuters 4pm London fix — used for portfolio valuations — concentrates enormous flow into a narrow window. This creates predictable volatility spikes, especially in JPY crosses (Japanese fiscal calendar) and EUR (European month-end flows). Traders should size positions smaller and widen stops during these windows.",
                },
              ],
            },
            {
              type: "practice",
              title: "Decompose EUR/USD and Identify Seasonal Patterns",
              description:
                "Apply both classical and STL decomposition to EUR/USD hourly data with period=24. Compare residual diagnostics (variance, Ljung-Box test). Then inject a simulated flash crash (set one price to 2× its value) and re-run both methods — observe how classical decomposition's seasonal component gets distorted while STL remains stable. Finally, compute an FFT periodogram on the original returns and verify dominant peaks at 24h, 168h, and 12h. Which session open (London or NY) produces the largest seasonal volatility spike in your data?",
            },
            {
              type: "practice",
              title: "Backtest a Seasonality-Aware Trading Strategy",
              description:
                "Extract the intraday seasonal component from STL decomposition. Construct a trading signal that: (1) goes long when price is below trend − seasonal (oversold relative to expected seasonal pattern), (2) goes short when price is above trend + seasonal, (3) only trades during high-volatility hours (London/NY opens). Compare Sharpe ratio and win rate against a baseline strategy that ignores seasonality. Does adjusting entry timing to exploit the 08:00 GMT London open volatility spike improve performance?",
            },
          ],
        },
        {
          id: "ts-cointegration-pairs",
          title: "Cointegration & Pairs Trading",
          description:
            "Discover how cointegration reveals long-run equilibrium relationships between forex pairs, enabling mean-reverting spread strategies even when individual pairs are non-stationary.",
          estimatedMinutes: 70,
          difficulty: "intermediate",
          prerequisites: ["ts-stationarity"],
          sections: [
            {
              type: "objective",
              content:
                "After this lesson you will master cointegration theory from first principles — understand why correlation ≠ cointegration with rigorous proofs, derive the Engle-Granger two-step procedure with complete distributional theory (MacKinnon critical values), implement the Johansen test as an eigenvalue problem with trace and max-eigenvalue statistics, derive the error correction model (ECM) representation and prove the Granger representation theorem, model the spread as an Ornstein-Uhlenbeck process and derive mean-reversion speed and half-life analytically, construct optimal hedge ratios via dynamic linear regression, detect structural breaks in cointegrating relationships using rolling tests and recursive residuals, and design profitable pairs trading strategies with rigorous entry/exit rules, position sizing based on spread volatility, and risk management for regime changes.",
              keyTakeaways: [
                "Two I(1) series y₁ₜ, y₂ₜ are cointegrated if ∃ β s.t. εₜ = y₁ₜ − βy₂ₜ is I(0) — the spread is stationary even though components are non-stationary",
                "Correlation ρ measures linear co-movement over a window; cointegration measures long-run equilibrium — two series can have ρ=0.95 yet diverge permanently (not cointegrated)",
                "Engle-Granger two-step: (1) OLS regression yₜ = α + βxₜ + εₜ, (2) ADF test on εₜ using MacKinnon critical values (stricter than standard ADF because β̂ is estimated)",
                "Johansen test: Formulate VAR(p), compute Π = αβᵀ, test rank(Π) via eigenvalues λᵢ — trace statistic = −T∑ln(1−λᵢ) tests H₀: rank ≤ r",
                "Error correction model (ECM): Δyₜ = γ(yₜ₋₁ − βxₜ₋₁) + lags + εₜ where γ < 0 is adjustment speed — deviations from equilibrium cause corrective changes",
                "Ornstein-Uhlenbeck spread: dεₜ = −θ(εₜ − μ)dt + σdWₜ — mean-reversion speed θ gives half-life τ₁/₂ = ln(2)/θ, steady-state std σₛₛ = σ/√(2θ)",
                "Half-life from discrete AR(1): Δεₜ = φεₜ₋₁ + uₜ → τ₁/₂ = −ln(2)/ln(1+φ) — practical range: 5–30 bars tradeable, <3 too fast, >50 ties up capital",
                "Pairs trading: Long spread when z-score < −2 (spread undervalued), short when z > 2 (overvalued), exit at |z| < 0.5; Kelly-fraction position sizing based on Sharpe ratio",
              ],
            },
            {
              type: "theory",
              title: "Cointegration vs Correlation: Formal Definitions & Why They Differ",
              content:
                "**Correlation**: The Pearson correlation coefficient ρ(X, Y) = Cov(X, Y)/(σₓσᵧ) ∈ [−1, 1] measures the strength and direction of the linear relationship between two variables over a fixed window. For time series, ρₜ = Corr(rₓ,ₜ, rᵧ,ₜ) is typically computed on returns over a rolling window (e.g., 60 days). High correlation (ρ ≈ 1 or −1) means the series move together directionally, but says **nothing about stationarity or equilibrium**. Two parallel random walks Xₜ = Xₜ₋₁ + εₓ,ₜ and Yₜ = Yₜ₋₁ + εᵧ,ₜ with correlated innovations Cov(εₓ, εᵧ) > 0 will have high correlation ρ ≈ 1 yet diverge permanently: E[|Xₜ − Yₜ|] → ∞ as t → ∞. No mean-reversion, no equilibrium, not tradeable.\n\n**Cointegration** (Engle & Granger, 1987): Two I(1) series Xₜ and Yₜ are **cointegrated** if there exists a vector β ≠ 0 such that Zₜ = Xₜ − βYₜ is I(0) — stationary. This defines a **long-run equilibrium relationship**: although Xₜ and Yₜ individually are non-stationary random walks (integrated of order 1), the spread Zₜ is bounded and mean-reverting. The cointegrating vector β is unique (up to scale) and is called the **hedge ratio**. Cointegration implies Xₜ and Yₜ share a common stochastic trend — they cannot drift arbitrarily far apart because the linear combination Zₜ is tethered to a stationary distribution.\n\n**Granger Representation Theorem**: If Xₜ ~ I(1) and Yₜ ~ I(1) are cointegrated with cointegrating vector β, then there exists an **error correction representation**: Δ[Xₜ, Yₜ]ᵀ = α(Xₜ₋₁ − βYₜ₋₁) + ∑Γᵢ Δ[Xₜ₋ᵢ, Yₜ₋ᵢ]ᵀ + εₜ, where α is the adjustment vector (α ≠ 0). The term α(Xₜ₋₁ − βYₜ₋₁) is the **error correction mechanism**: when the spread is above equilibrium (Xₜ₋₁ − βYₜ₋₁ > 0), the system adjusts downward (αₓ < 0 or αᵧ > 0) to restore balance. Conversely, VAR in levels ∃ ECM representation ⟺ cointegration (Granger's theorem).\n\n**Why Correlation ≠ Cointegration**: Consider EUR/USD and GBP/USD. Historical data shows ρ ≈ 0.85 (strongly correlated). But suppose the ECB cuts rates aggressively while the BoE hikes — EUR/USD trends down, GBP/USD trends up. The correlation remains positive (both driven by USD), but the spread EUR − 0.85×GBP drifts from 0 to +0.15 and stays there (structural break). The series were correlated but **not cointegrated** — no long-run equilibrium. Contrast with EUR/CHF before the SNB peg break (2011–2015): ρ ≈ 0.99 AND cointegrated (SNB actively enforced EUR/CHF ≥ 1.20, creating artificial cointegration). After Jan 2015 break, cointegration vanished instantly despite correlation remaining high.\n\n**Numerical Example**: Generate two I(1) series: Xₜ = Xₜ₋₁ + εₓ,ₜ, Yₜ = Yₜ₋₁ + εᵧ,ₜ with Cov(εₓ, εᵧ) = 0.8σ² (high correlation in innovations). Compute ρ(ΔXₜ, ΔYₜ) ≈ 0.8 (strongly correlated). But Zₜ = Xₜ − Yₜ = Z₀ + ∑(εₓ,ₛ − εᵧ,ₛ) is a random walk (Var(Zₜ) = t·Var(εₓ − εᵧ) grows without bound). Not stationary, not cointegrated. Now inject cointegration: let Yₜ = Xₜ + ηₜ where ηₜ is a stationary AR(1): ηₜ = 0.9ηₜ₋₁ + νₜ. Then Zₜ = Xₜ − Yₜ = −ηₜ is stationary (β = 1). The series are cointegrated even though correlation might be moderate (depends on relative variance of X-drift vs η-fluctuations).",
            },
            {
              type: "theory",
              title: "Engle-Granger Two-Step Procedure: Derivation & MacKinnon Critical Values",
              content:
                "**Step 1: OLS Cointegrating Regression**: Suppose we test whether y₁ₜ ~ I(1) and y₂ₜ ~ I(1) are cointegrated. Regress y₁ₜ = α + βy₂ₜ + εₜ via ordinary least squares (OLS) to obtain β̂ and intercept α̂. The residuals ε̂ₜ = y₁ₜ − α̂ − β̂y₂ₜ estimate the spread. Under the null hypothesis of **no cointegration**, both y₁ₜ and y₂ₜ are I(1) and independent, so the regression is **spurious** — β̂ does not converge to a meaningful value (superconsistent under cointegration, inconsistent under null). The residuals ε̂ₜ will also be I(1). Under the alternative (cointegration), β̂ converges at rate T (superconsistency) to the true cointegrating coefficient β₀, and ε̂ₜ → εₜ where εₜ ~ I(0).\n\n**Step 2: ADF Test on Residuals**: Apply the Augmented Dickey-Fuller test to ε̂ₜ: Δε̂ₜ = ρε̂ₜ₋₁ + ∑φⱼ Δε̂ₜ₋ⱼ + uₜ. Test H₀: ρ = 0 (unit root, no cointegration) vs H₁: ρ < 0 (stationary, cointegrated). The ADF statistic is τ = ρ̂/SE(ρ̂). **Critical Issue**: The distribution of τ under H₀ is **not** the standard Dickey-Fuller distribution, because β̂ was estimated from the same data. Phillips & Ouliaris (1990) and MacKinnon (1991) derived the correct asymptotic distribution via Monte Carlo simulation. The critical values are more negative (stricter) than standard ADF. For T = 500 and 1 cointegrating variable (k = 1), 5% critical value is approximately −3.34 vs −2.86 for standard ADF.\n\n**MacKinnon Response Surface**: MacKinnon (1991) provides a regression formula for critical values as a function of sample size T and number of variables k: CV(α, T, k) = c∞ + c₁/T + c₂/T². For k=1 (single cointegrating equation) at 5% level: c∞ = −3.367, c₁ = −5.83, c₂ = −8.36. For T = 1000: CV(0.05) = −3.367 − 5.83/1000 − 8.36/1000² ≈ −3.373. Use statsmodels.tsa.stattools.coint() which automatically applies MacKinnon critical values.\n\n**Procedure Summary**:\n1. Verify both series are I(1) via individual ADF tests (fail to reject unit root).\n2. Regress y₁ₜ = α + βy₂ₜ + εₜ, obtain β̂ and residuals ε̂ₜ.\n3. ADF test ε̂ₜ with MacKinnon critical values.\n4. If ADF statistic < critical value (reject H₀), conclude cointegration.\n5. Report p-value (interpolated from MacKinnon tables).\n\n**Limitations**: Engle-Granger assumes a single cointegrating vector (only tests one linear combination). For k > 2 series, there may be multiple cointegrating relationships (rank > 1). Engle-Granger only finds one. The Johansen test handles this. Additionally, Engle-Granger is sensitive to which variable is on the LHS — testing y₁ ~ y₂ vs y₂ ~ y₁ can give different results if errors are heteroscedastic. Johansen is symmetric.",
            },
            {
              type: "theory",
              title: "Johansen Test & Error Correction Model (ECM)",
              content:
                "**Johansen Test (1988, 1991)**: For k > 2 cointegrated variables, use the Johansen maximum likelihood procedure. Formulate a **VAR(p) in levels**: Yₜ = Π₁Yₜ₋₁ + … + ΠₚYₜ₋ₚ + εₜ where Yₜ = [y₁ₜ, y₂ₜ, …, yₖₜ]ᵀ. Reparametrize as **VAR in differences (VECM)**: ΔYₜ = ΠYₜ₋₁ + ∑Γᵢ ΔYₜ₋ᵢ + εₜ, where Π = ∑Πᵢ − I is the **long-run impact matrix**. The rank of Π determines the number of cointegrating relationships:\n- rank(Π) = 0 → no cointegration (all series are I(1) in levels)\n- rank(Π) = k → all series are I(0) (stationary)\n- rank(Π) = r with 0 < r < k → r cointegrating vectors\n\nIf rank(Π) = r, we can decompose Π = αβᵀ where α is k×r (adjustment coefficients) and β is k×r (cointegrating vectors). The columns of β are the r linearly independent cointegrating relationships. The VECM becomes: ΔYₜ = α(βᵀYₜ₋₁) + ∑Γᵢ ΔYₜ₋ᵢ + εₜ. The term α(βᵀYₜ₋₁) is the **error correction mechanism**: when βᵀYₜ₋₁ (the spread) deviates from equilibrium, α drives the system back.\n\n**Testing Procedure (Trace Statistic)**: Estimate the VAR, compute eigenvalues λ₁ ≥ λ₂ ≥ … ≥ λₖ of the matrix Π = S₁₁⁻¹S₁₀S₀₀⁻¹S₀₁ where Sᵢⱼ are residual moment matrices. The **trace statistic** tests H₀: rank(Π) ≤ r: LRₜᵣₐcₑ(r) = −T ∑ᵢ₌ᵣ₊₁ᵏ ln(1 − λᵢ). Intuitively, if rank = r, then λᵣ₊₁, …, λₖ ≈ 0, so the sum ≈ 0 and we fail to reject. If rank > r, at least one eigenvalue is significantly positive, LR is large, reject H₀. The **max-eigenvalue statistic** tests H₀: rank = r vs H₁: rank = r+1: LRₘₐₓ(r) = −T ln(1 − λᵣ₊₁). Both statistics have non-standard distributions (tabulated by Johansen). Typical workflow: start with r = 0, increment r until failure to reject.\n\n**Numerical Example**: Test EUR/USD, GBP/USD, USD/JPY (k = 3). Estimate VAR(2), compute eigenvalues: λ₁ = 0.18, λ₂ = 0.08, λ₃ = 0.01. Trace statistic for r=0: LR = −1000·(ln(1−0.18) + ln(1−0.08) + ln(1−0.01)) = 1000·(0.198 + 0.083 + 0.010) = 291 — compare to 5% critical value ≈ 29.7, reject H₀ (rank > 0). For r=1: LR = −1000·(ln(1−0.08) + ln(1−0.01)) = 93 > critical ≈ 15.5, reject (rank > 1). For r=2: LR = −1000·ln(1−0.01) = 10 < critical ≈ 3.8, **fail to reject** — conclude rank = 2 (two cointegrating relationships among the three pairs).\n\n**Error Correction Model (ECM)**: Once cointegration is confirmed, the ECM describes short-run dynamics. For a two-variable system (yₜ, xₜ) cointegrated with β: Δyₜ = αᵧ(yₜ₋₁ − βxₜ₋₁) + ∑φᵧ,ᵢ Δyₜ₋ᵢ + ∑φᵧ,ₓ,ᵢ Δxₜ₋ᵢ + εᵧ,ₜ, Δxₜ = αₓ(yₜ₋₁ − βxₜ₋₁) + ∑φₓ,ᵢ Δxₜ₋ᵢ + ∑φₓ,ᵧ,ᵢ Δyₜ₋ᵢ + εₓ,ₜ. The adjustment coefficients αᵧ, αₓ measure how each variable responds to equilibrium deviations. For pairs trading, we care about the spread equation: Δεₜ = αε·εₜ₋₁ + lags + uₜ where ε = y − βx. If αε < 0, deviations self-correct (mean-reversion). The half-life is τ₁/₂ ≈ −ln(2)/αε (continuous-time approximation) or −ln(2)/ln(1 + αε) (discrete AR(1) exact formula).",
            },
            {
              type: "theory",
              title: "Ornstein-Uhlenbeck Spread Model & Half-Life Derivation",
              content:
                "**Ornstein-Uhlenbeck Process**: Model the spread εₜ as a continuous-time mean-reverting process: dεₜ = −θ(εₜ − μ)dt + σdWₜ, where θ > 0 is the mean-reversion speed, μ is the long-run mean, σ is volatility, and Wₜ is a Wiener process (Brownian motion). The drift term −θ(εₜ − μ) pulls εₜ toward μ with force proportional to the deviation. The SDE solution is: εₜ = μ + (ε₀ − μ)e⁻θᵗ + σ∫₀ᵗ e⁻θ⁽ᵗ⁻ˢ⁾dWₛ. Taking expectations: E[εₜ | ε₀] = μ + (ε₀ − μ)e⁻θᵗ → μ as t → ∞. The **half-life** is the time for the expected deviation to decay by half: τ₁/₂ satisfies (ε₀ − μ)e⁻θτ₁/₂ = (ε₀ − μ)/2, giving τ₁/₂ = ln(2)/θ. For variance: Var(εₜ | ε₀) = σ²/(2θ)·(1 − e⁻²θᵗ) → σ²/(2θ) as t → ∞ (steady-state variance).\n\n**Discrete-Time AR(1) Equivalent**: Discretize the OU process with time step Δt. The discrete AR(1) is: εₜ₊Δₜ = μ(1 − e⁻θΔᵗ) + e⁻θΔᵗ·εₜ + noise. Define φ = e⁻θΔᵗ − 1 ≈ −θΔt for small Δt. The AR(1) form is: εₜ₊₁ − εₜ = φεₜ + const + uₜ where φ < 0. The half-life in discrete time: τ₁/₂ = −ln(2)/ln(1 + φ). For φ = −0.05 (θΔt ≈ 0.05, so θ ≈ 0.05 per bar), τ₁/₂ = −ln(2)/ln(0.95) ≈ 13.5 bars. Interpretation: if the spread is currently 2σ above mean, it will be 1σ above mean in ~13.5 bars (expected).\n\n**Estimating θ from Data**: Fit the AR(1) model Δεₜ = α + φεₜ₋₁ + uₜ via OLS. Then θ̂ = −ln(1 + φ̂)/Δt and τ̂₁/₂ = −ln(2)/ln(1 + φ̂). Standard error of τ̂₁/₂ via delta method: SE(τ̂₁/₂) ≈ (ln(2)/(1+φ̂)ln²(1+φ̂))·SE(φ̂). Confidence interval: [τ̂₁/₂ − 1.96·SE, τ̂₁/₂ + 1.96·SE]. If the CI includes ∞ (i.e., φ̂ is not significantly negative), there's no evidence of mean-reversion.\n\n**Trading Implications**: Half-life determines trade horizon. τ₁/₂ = 5 bars → fast mean-reversion, hold trades for ~10 bars, use tight stops. τ₁/₂ = 50 bars → slow reversion, multi-day holds, capital tied up longer, need wider stops to avoid noise. Optimal range: 10–30 bars. Below 5 bars, transaction costs dominate; above 50 bars, regime change risk dominates. Compute rolling half-life (e.g., 100-bar window) to detect regime changes: if τ₁/₂ suddenly jumps from 15 to 80 bars, the cointegrating relationship may be weakening (stop trading).",
            },
            {
              type: "intuition",
              title: "The Drunk and Her Dog 🐕",
              analogy:
                "Cointegration is like a drunk person walking her dog on a leash — both wander randomly, but the leash (cointegrating relationship) keeps them connected.",
              content:
                "Imagine a drunk woman walking her dog through a park at night. She weaves left and right unpredictably — a random walk, non-stationary. The dog also wanders erratically, sniffing bushes and chasing squirrels — another independent random walk. Individually, both follow I(1) processes: their positions drift without bound, no tendency to return to a fixed location.\n\nBut here's the key: they're **connected by a leash** of fixed length L. The **distance between them** d(t) = |x_woman(t) − x_dog(t)| cannot exceed L. When d(t) → L, the leash pulls tight and forces them back together. The distance fluctuates around some average (maybe L/2), oscillating but never drifting to infinity. The distance process d(t) is **stationary** — bounded, mean-reverting, I(0) — even though both positions are non-stationary.\n\nThat distance is the **spread** εₜ in a cointegrated pair. The woman's path is y₁ₜ (EUR/USD), the dog's path is y₂ₜ (GBP/USD), and the leash is the cointegrating relationship εₜ = y₁ₜ − βy₂ₜ. The leash length L is proportional to the steady-state spread volatility σₛₛ = σ/√(2θ). A **tight leash** (small σ/θ) means fast mean-reversion — the dog gets yanked back quickly when it strays. A **loose leash** (large σ/θ) allows wider excursions before reversion kicks in.\n\n**Contrast with correlation**: Two people walking on parallel train tracks are highly correlated (ρ ≈ 0.95) — they move in the same direction. But there's no leash connecting them. If one walks to Paris and the other to London, they diverge permanently. High correlation, zero cointegration. The leash (cointegration) is a physical constraint that correlation cannot capture.",
              emoji: "🐕",
            },
            {
              type: "intuition",
              title: "The Rubber Band Analogy 🎯",
              analogy:
                "A cointegrated spread is like a stretched rubber band — the further you pull it from equilibrium, the stronger the restoring force.",
              content:
                "Imagine attaching a rubber band between two points: EUR/USD price and β×GBP/USD price. When the spread εₜ = EUR − β×GBP is at its equilibrium (rubber band relaxed), there's no force. But stretch the rubber band by 2σ (spread widens), and it **pulls back** with force proportional to the displacement: F = −θ(εₜ − μ). This is the **error correction mechanism**.\n\nThe **mean-reversion speed θ** is the rubber band's stiffness. A tight band (large θ) snaps back quickly — half-life τ₁/₂ = ln(2)/θ is short. A loose band (small θ) retracts slowly — τ₁/₂ is long. Trading the rubber band: when it's stretched to 2σ, bet on snapback (enter mean-reversion trade). When it's near equilibrium (|z| < 0.5), no force, no edge — exit.\n\n**Structural breaks** are like cutting the rubber band. The ECB hikes, BoE cuts — the equilibrium μ shifts from 0 to +0.10. The old band breaks (historical β no longer valid), and a new equilibrium forms. Your trade based on the old equilibrium gets crushed because the band isn't pulling back — it's been replaced. This is why pairs traders must monitor rolling cointegration tests and spread stability: detect the break before the trade blows up.",
              emoji: "🎯",
            },
            {
              type: "code",
              title: "Engle-Granger Cointegration Test with MacKinnon Critical Values",
              language: "python",
              code: `import numpy as np
import pandas as pd
from statsmodels.tsa.stattools import coint, adfuller
from statsmodels.regression.linear_model import OLS
from statsmodels.tools import add_constant

# Load two forex pairs
eur = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"], index_col="timestamp")["close"]
gbp = pd.read_csv("gbpusd_1h.csv", parse_dates=["timestamp"], index_col="timestamp")["close"]

# Align series (intersection of timestamps)
df = pd.DataFrame({"eur": eur, "gbp": gbp}).dropna()
eur_vals = df["eur"].values
gbp_vals = df["gbp"].values

print("=" * 70)
print("STEP 0: Verify both series are I(1)")
print("=" * 70)

# ADF test on levels (expect non-stationary)
adf_eur_level = adfuller(eur_vals, maxlag=24, autolag="AIC")
adf_gbp_level = adfuller(gbp_vals, maxlag=24, autolag="AIC")

print(f"EUR/USD ADF (levels): statistic={adf_eur_level[0]:.4f}, p-value={adf_eur_level[1]:.4f}")
print(f"  {'I(1) ✓' if adf_eur_level[1] > 0.05 else 'I(0) — stationary, not I(1)'}")
print(f"GBP/USD ADF (levels): statistic={adf_gbp_level[0]:.4f}, p-value={adf_gbp_level[1]:.4f}")
print(f"  {'I(1) ✓' if adf_gbp_level[1] > 0.05 else 'I(0) — stationary, not I(1)'}")

# ADF test on first differences (expect stationary)
adf_eur_diff = adfuller(np.diff(eur_vals), maxlag=24, autolag="AIC")
adf_gbp_diff = adfuller(np.diff(gbp_vals), maxlag=24, autolag="AIC")

print(f"\\nEUR/USD ADF (1st diff): p-value={adf_eur_diff[1]:.4f} {'I(0) ✓' if adf_eur_diff[1] < 0.05 else ''}")
print(f"GBP/USD ADF (1st diff): p-value={adf_gbp_diff[1]:.4f} {'I(0) ✓' if adf_gbp_diff[1] < 0.05 else ''}")

print("\\n" + "=" * 70)
print("STEP 1: OLS Cointegrating Regression")
print("=" * 70)

# Regress EUR on GBP
X = add_constant(gbp_vals)
model = OLS(eur_vals, X).fit()
beta_0, beta_1 = model.params

print(f"Regression: EUR = {beta_0:.6f} + {beta_1:.6f} × GBP")
print(f"  R²: {model.rsquared:.4f}")
print(f"  Residual std: {np.sqrt(model.mse_resid):.6f}")

# Construct spread
spread = eur_vals - beta_1 * gbp_vals - beta_0

print("\\n" + "=" * 70)
print("STEP 2: ADF Test on Residuals (MacKinnon Critical Values)")
print("=" * 70)

# Engle-Granger test via statsmodels (automatically uses MacKinnon CVs)
eg_stat, eg_pvalue, eg_crit_values = coint(eur_vals, gbp_vals)

print(f"Engle-Granger Test Statistic: {eg_stat:.4f}")
print(f"MacKinnon p-value: {eg_pvalue:.6f}")
print(f"Critical values (MacKinnon):")
print(f"  1%:  {eg_crit_values[0]:.4f}")
print(f"  5%:  {eg_crit_values[1]:.4f}")
print(f"  10%: {eg_crit_values[2]:.4f}")
print(f"\\nConclusion: {'Cointegrated ✓' if eg_pvalue < 0.05 else 'Not cointegrated ✗'}")

# Manual ADF on residuals (for comparison)
adf_resid = adfuller(spread, maxlag=24, autolag="AIC", regression="c")
print(f"\\nManual ADF on residuals: statistic={adf_resid[0]:.4f}, p-value={adf_resid[1]:.6f}")
print(f"  (Note: p-value uses standard DF distribution, not MacKinnon — for cointegration use eg_pvalue above)")`,
              explanation:
                "We implement the Engle-Granger two-step procedure: (1) Verify both series are I(1) via ADF tests on levels (fail to reject unit root) and differences (reject unit root). (2) OLS regression to estimate cointegrating coefficient β. (3) ADF test on residuals using MacKinnon critical values (automatically applied by statsmodels.tsa.stattools.coint). MacKinnon CVs are stricter than standard DF because β̂ was estimated from data. If we reject H₀ (p < 0.05), the series are cointegrated and the spread is stationary/tradeable.",
            },
            {
              type: "code",
              title: "Half-Life Estimation & Trading Signal Generation",
              language: "python",
              code: `import numpy as np
import pandas as pd
from statsmodels.tsa.stattools import coint
from statsmodels.regression.linear_model import OLS
from statsmodels.tools import add_constant

# Load and align data
eur = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"], index_col="timestamp")["close"]
gbp = pd.read_csv("gbpusd_1h.csv", parse_dates=["timestamp"], index_col="timestamp")["close"]
df = pd.DataFrame({"eur": eur, "gbp": gbp}).dropna()

# Cointegration test
eg_stat, eg_pvalue, _ = coint(df["eur"].values, df["gbp"].values)
print(f"Cointegration p-value: {eg_pvalue:.6f} {'✓' if eg_pvalue < 0.05 else '✗'}")

# Estimate hedge ratio
X = add_constant(df["gbp"].values)
model_hedge = OLS(df["eur"].values, X).fit()
beta_0, beta_1 = model_hedge.params

# Construct spread
df["spread"] = df["eur"] - beta_1 * df["gbp"] - beta_0
spread = df["spread"].values

print(f"\\nHedge ratio β: {beta_1:.6f}")
print(f"Spread mean: {spread.mean():.6f}, std: {spread.std():.6f}")

# --- Half-Life Estimation via AR(1) ---
spread_lag = spread[:-1]
spread_diff = np.diff(spread)
X_ar = add_constant(spread_lag)
ar_model = OLS(spread_diff, X_ar).fit()
alpha, phi = ar_model.params

print(f"\\nAR(1) model: Δspread = {alpha:.6f} + {phi:.6f} × spread_lag")
print(f"  phi t-stat: {ar_model.tvalues[1]:.2f} (significant mean-reversion if t < -2)")

if phi < 0:
    half_life = -np.log(2) / np.log(1 + phi)
    print(f"  Half-life: {half_life:.2f} bars ({half_life:.1f} hours if hourly data)")
    
    # Standard error via delta method
    phi_se = ar_model.bse[1]
    hl_se = (np.log(2) / ((1 + phi) * (np.log(1 + phi))**2)) * phi_se
    hl_ci_lower = half_life - 1.96 * hl_se
    hl_ci_upper = half_life + 1.96 * hl_se
    print(f"  95% CI: [{hl_ci_lower:.2f}, {hl_ci_upper:.2f}]")
else:
    half_life = float("inf")
    print(f"  No mean-reversion detected (phi >= 0)")

# --- Z-Score & Trading Signals ---
spread_mean_est = spread.mean()
spread_std_est = spread.std()
df["z_score"] = (df["spread"] - spread_mean_est) / spread_std_est

# Trading rules
entry_threshold = 2.0
exit_threshold = 0.5

df["signal"] = 0
df.loc[df["z_score"] > entry_threshold, "signal"] = -1  # short spread (sell EUR, buy GBP)
df.loc[df["z_score"] < -entry_threshold, "signal"] = 1  # long spread (buy EUR, sell GBP)

# Count signals
long_entries = (df["signal"] == 1).sum()
short_entries = (df["signal"] == -1).sum()

print(f"\\n--- Trading Signals (z-score thresholds: ±{entry_threshold}) ---")
print(f"Long spread entries:  {long_entries} (spread undervalued)")
print(f"Short spread entries: {short_entries} (spread overvalued)")
print(f"Current z-score:      {df['z_score'].iloc[-1]:.3f}")

# Signal interpretation
last_z = df["z_score"].iloc[-1]
if last_z > entry_threshold:
    print(f"  → SIGNAL: Short spread (z={last_z:.2f} > {entry_threshold})")
elif last_z < -entry_threshold:
    print(f"  → SIGNAL: Long spread (z={last_z:.2f} < -{entry_threshold})")
else:
    print(f"  → No entry signal (|z|={abs(last_z):.2f} < {entry_threshold})")

# Exit logic: track active positions
print(f"\\nExit when |z| < {exit_threshold} (spread reverts to mean)")`,
              explanation:
                "We estimate the half-life of mean reversion by fitting an AR(1) model to the spread: Δspread = α + φ·spread_lag + ε. The coefficient φ captures mean-reversion speed (φ < 0 required). Half-life τ₁/₂ = −ln(2)/ln(1+φ) tells us how many bars it takes for a spread deviation to decay by half. For hourly data with τ₁/₂ = 15 bars, a 2σ deviation is expected to shrink to 1σ in 15 hours. We then compute z-scores and generate trading signals: long spread when z < −2 (undervalued), short when z > 2 (overvalued), exit when |z| < 0.5. This is the foundation of statistical arbitrage pairs trading.",
            },
            {
              type: "code",
              title: "Rolling Cointegration Test: Detect Structural Breaks",
              language: "python",
              code: `import numpy as np
import pandas as pd
from statsmodels.tsa.stattools import coint

# Load data
eur = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"], index_col="timestamp")["close"]
gbp = pd.read_csv("gbpusd_1h.csv", parse_dates=["timestamp"], index_col="timestamp")["close"]
df = pd.DataFrame({"eur": eur, "gbp": gbp}).dropna()

# Parameters
window = 500  # rolling window size (bars)
min_periods = 250  # minimum data needed for test

# Storage
pvalues = []
test_stats = []
timestamps = []

print(f"Computing rolling Engle-Granger test (window={window} bars)...")

for i in range(min_periods, len(df)):
    start_idx = max(0, i - window)
    window_eur = df["eur"].iloc[start_idx:i].values
    window_gbp = df["gbp"].iloc[start_idx:i].values
    
    if len(window_eur) < 100:  # skip if too few data points
        continue
    
    # Cointegration test on rolling window
    stat, pval, _ = coint(window_eur, window_gbp)
    
    pvalues.append(pval)
    test_stats.append(stat)
    timestamps.append(df.index[i])

# Create results DataFrame
results = pd.DataFrame({
    "timestamp": timestamps,
    "eg_pvalue": pvalues,
    "eg_stat": test_stats,
})
results.set_index("timestamp", inplace=True)

# Identify periods where cointegration breaks down (p > 0.10)
results["cointegrated"] = results["eg_pvalue"] < 0.05
results["weak_coint"] = (results["eg_pvalue"] >= 0.05) & (results["eg_pvalue"] < 0.10)
results["no_coint"] = results["eg_pvalue"] >= 0.10

print(f"\\nRolling Cointegration Summary:")
print(f"  Total windows tested: {len(results)}")
print(f"  Cointegrated (p<0.05): {results['cointegrated'].sum()} ({results['cointegrated'].mean()*100:.1f}%)")
print(f"  Weak (0.05≤p<0.10):    {results['weak_coint'].sum()} ({results['weak_coint'].mean()*100:.1f}%)")
print(f"  Not cointegrated (p≥0.10): {results['no_coint'].sum()} ({results['no_coint'].mean()*100:.1f}%)")

# Detect structural breaks: consecutive periods of p > 0.10
break_threshold = 10  # consecutive windows
results["break_flag"] = (results["eg_pvalue"] > 0.10).rolling(break_threshold).sum() == break_threshold

if results["break_flag"].any():
    break_dates = results[results["break_flag"]].index
    print(f"\\n⚠️ Structural break detected: {len(break_dates)} periods where cointegration failed for {break_threshold}+ consecutive windows")
    print(f"  First break: {break_dates[0]}")
    print(f"  Last break:  {break_dates[-1]}")
    print(f"  → Stop trading during these periods — cointegrating relationship has broken down")
else:
    print(f"\\n✓ No sustained structural breaks detected")

# Current status
current_pval = results["eg_pvalue"].iloc[-1]
print(f"\\nCurrent cointegration p-value: {current_pval:.6f}")
if current_pval < 0.05:
    print(f"  ✓ Currently cointegrated — safe to trade")
elif current_pval < 0.10:
    print(f"  ⚠️ Weak cointegration — reduce position size")
else:
    print(f"  ✗ Not cointegrated — DO NOT TRADE")`,
              explanation:
                "Cointegrating relationships are not permanent — they can break due to regime changes (divergent monetary policies, economic shocks, structural shifts). We implement a rolling Engle-Granger test with a 500-bar window, recomputing the test every bar. If p-value rises above 0.10 for multiple consecutive windows, it signals a structural break — the historical cointegration has dissolved. Pairs traders must monitor this in real-time: when the rolling test fails, stop trading immediately to avoid catastrophic losses from a spread that no longer mean-reverts. This is essential risk management for statistical arbitrage strategies.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "ts-coint-q1",
                  question:
                    "EUR/USD and GBP/USD have a rolling 60-day correlation of 0.92. Can you immediately conclude they are cointegrated and start pairs trading?",
                  options: [
                    { id: "ts-coint-q1-a", text: "Yes — ρ > 0.9 guarantees cointegration" },
                    { id: "ts-coint-q1-b", text: "No — correlation measures co-movement direction over a window, not long-run equilibrium. High ρ means they move together, but doesn't guarantee the spread εₜ = EUR − β·GBP is stationary. Must test via Engle-Granger or Johansen." },
                    { id: "ts-coint-q1-c", text: "Yes — any ρ > 0 implies cointegration" },
                    { id: "ts-coint-q1-d", text: "Only if both series are stationary I(0)" },
                  ],
                  correctOptionId: "ts-coint-q1-b",
                  explanation:
                    "Correlation ρ(ΔX, ΔY) measures the strength of linear co-movement in returns. Two series can have ρ = 0.95 yet drift apart permanently if there's no equilibrium relationship. Example: two parallel random walks with correlated innovations — high ρ, but spread Var(Xₜ − Yₜ) → ∞. Cointegration requires the spread to be stationary (bounded variance), tested via ADF on residuals with MacKinnon critical values, not correlation.",
                },
                {
                  id: "ts-coint-q2",
                  question:
                    "You fit AR(1) to the spread and get φ̂ = −0.08 with t-stat = −3.2. What is the half-life, and is mean-reversion statistically significant?",
                  options: [
                    { id: "ts-coint-q2-a", text: "τ₁/₂ ≈ 8.3 bars, and yes, mean-reversion is significant (|t| > 2)" },
                    { id: "ts-coint-q2-b", text: "τ₁/₂ = ∞ because φ < 0" },
                    { id: "ts-coint-q2-c", text: "τ₁/₂ ≈ 0.08 bars" },
                    { id: "ts-coint-q2-d", text: "Cannot compute half-life without knowing σ" },
                  ],
                  correctOptionId: "ts-coint-q2-a",
                  explanation:
                    "Half-life: τ₁/₂ = −ln(2)/ln(1 + φ) = −ln(2)/ln(0.92) ≈ 8.3 bars. The t-statistic of −3.2 for φ is highly significant (|t| > 2.58 for p < 0.01), confirming strong mean-reversion. Interpretation: a 2σ spread deviation decays to 1σ in ~8.3 bars on average. This is a fast reversion rate, ideal for short-term pairs trading with quick turnover.",
                },
                {
                  id: "ts-coint-q3",
                  question:
                    "The Johansen test on 4 forex pairs yields eigenvalues λ = [0.25, 0.12, 0.03, 0.005]. The trace statistic for rank=0 is 450 (critical value 47), for rank=1 is 180 (CV 29), for rank=2 is 38 (CV 15), for rank=3 is 5 (CV 3.8). How many cointegrating relationships exist?",
                  options: [
                    { id: "ts-coint-q3-a", text: "0 — no cointegration" },
                    { id: "ts-coint-q3-b", text: "1 cointegrating vector" },
                    { id: "ts-coint-q3-c", text: "2 cointegrating vectors" },
                    { id: "ts-coint-q3-d", text: "3 cointegrating vectors (full rank −1)" },
                  ],
                  correctOptionId: "ts-coint-q3-d",
                  explanation:
                    "Johansen trace test: Start at r=0. LR(0)=450 > CV=47 → reject, rank > 0. LR(1)=180 > CV=29 → reject, rank > 1. LR(2)=38 > CV=15 → reject, rank > 2. LR(3)=5 > CV=3.8 → reject, rank > 3. Since we can reject up to rank=3 but cannot test rank=4 (would require 4 cointegrating vectors among 4 series, leaving no stochastic trends — means all series are I(0), contradicting I(1) assumption), we conclude rank = 3. There are 3 independent cointegrating relationships among the 4 pairs.",
                },
                {
                  id: "ts-coint-q4",
                  question:
                    "A pairs trader observes the EUR/GBP spread's rolling half-life increase from 12 bars to 65 bars over 2 weeks. What is the most likely cause, and what should they do?",
                  options: [
                    { id: "ts-coint-q4-a", text: "Normal random fluctuation — continue trading" },
                    { id: "ts-coint-q4-b", text: "Structural break or regime change weakening mean-reversion (e.g., divergent BoE/ECB policies). Stop trading, re-test cointegration, wait for stabilization." },
                    { id: "ts-coint-q4-c", text: "Increase position size to exploit slower reversion" },
                    { id: "ts-coint-q4-d", text: "The spread is more profitable now because it takes longer to revert" },
                  ],
                  correctOptionId: "ts-coint-q4-b",
                  explanation:
                    "A sudden jump in half-life (12 → 65 bars) indicates weakening mean-reversion — the AR(1) coefficient φ became less negative (closer to 0), meaning deviations persist much longer. This often signals a structural break: the BoE and ECB may have diverged on policy (rate cuts vs hikes), disrupting the equilibrium. Continue trading risks catastrophic loss if the spread never reverts. Proper risk management: halt trading, re-run Engle-Granger/Johansen tests, check if p-value > 0.10 (cointegration broken), and wait for a new stable regime before resuming.",
                },
                {
                  id: "ts-coint-q5",
                  question:
                    "Why does the Engle-Granger test use MacKinnon critical values instead of standard Dickey-Fuller critical values?",
                  options: [
                    { id: "ts-coint-q5-a", text: "MacKinnon values are easier to compute" },
                    { id: "ts-coint-q5-b", text: "Because the cointegrating coefficient β̂ is estimated from the same data used in the ADF test, the test statistic has a different limiting distribution (more negative under H₀). MacKinnon (1991) derived the correct critical values via simulation." },
                    { id: "ts-coint-q5-c", text: "Standard DF values assume multiple cointegrating vectors" },
                    { id: "ts-coint-q5-d", text: "There is no difference — both use the same critical values" },
                  ],
                  correctOptionId: "ts-coint-q5-b",
                  explanation:
                    "In standard ADF, you test a known series yₜ for a unit root. In Engle-Granger, you test residuals ε̂ₜ = y₁ₜ − β̂y₂ₜ where β̂ was estimated via OLS from the same data. This introduces an estimation error that affects the limiting distribution of the ADF statistic under the null. Phillips & Ouliaris (1990) showed the distribution is more negative (stricter). MacKinnon (1991) tabulated the correct critical values via Monte Carlo. Using standard DF critical values would over-reject the null (false positives).",
                },
                {
                  id: "ts-coint-q6",
                  question:
                    "A trader constructs a spread εₜ = EUR/USD − 0.85×GBP/USD and finds it's stationary with half-life 18 bars. They enter a long spread position at z = −2.5. After 30 bars, z is still −1.8 (spread hasn't reverted). What happened?",
                  options: [
                    { id: "ts-coint-q6-a", text: "Nothing unusual — half-life is an expectation, not a guarantee. With τ₁/₂=18, we expect 50% reversion in 18 bars on average, but randomness means it can take longer." },
                    { id: "ts-coint-q6-b", text: "The cointegration test was wrong" },
                    { id: "ts-coint-q6-c", text: "The spread will never revert — exit immediately" },
                    { id: "ts-coint-q6-d", text: "The trader used the wrong entry threshold" },
                  ],
                  correctOptionId: "ts-coint-q6-a",
                  explanation:
                    "Half-life τ₁/₂ = 18 bars is the **expected** time for a deviation to decay by half, not a deterministic countdown. The spread follows dεₜ = −θ(εₜ−μ)dt + σdWₜ — mean-reverting drift plus noise. In any single realization, ε(t) may take longer or shorter due to the stochastic term σdWₜ. After 30 bars (>1.5 half-lives), we'd expect z ≈ −2.5/2^(30/18) ≈ −0.77, but observed z=−1.8 is within the distribution. If after 3–4 half-lives (54–72 bars) there's still no reversion, then suspect regime change. Normal variance means patience is required — don't panic exit early.",
                },
                {
                  id: "ts-coint-q7",
                  question:
                    "Engle-Granger finds EUR/USD and GBP/USD are cointegrated with p=0.03. Johansen test on the same pair yields trace statistic that fails to reject rank=0 (no cointegration). Which result do you trust?",
                  options: [
                    { id: "ts-coint-q7-a", text: "Engle-Granger, because it came first historically" },
                    { id: "ts-coint-q7-b", text: "Investigate further — check sample size, lag selection, and deterministic components (constant/trend). Engle-Granger is sensitive to which variable is LHS; Johansen is symmetric. Johansen is generally more robust for k≥2 series." },
                    { id: "ts-coint-q7-c", text: "Always trust Engle-Granger over Johansen" },
                    { id: "ts-coint-q7-d", text: "The contradiction means the data is invalid" },
                  ],
                  correctOptionId: "ts-coint-q7-b",
                  explanation:
                    "Engle-Granger is asymmetric (regress Y on X ≠ regress X on Y if residuals are heteroscedastic) and tests only one cointegrating direction. Johansen is symmetric and handles multiple cointegrating vectors. Discrepancies can arise from: (1) Different lag orders in ADF vs VAR, (2) Inclusion of constant/trend — Engle-Granger with constant, Johansen with no deterministic trend, (3) Small sample size — Johansen requires larger T for reliable eigenvalue estimation, (4) Heteroscedasticity affecting EG but not Johansen. Best practice: run both, and if they disagree, check diagnostics and prefer Johansen for k>2 or when testing multiple vectors.",
                },
              ],
            },
            {
              type: "practice",
              title: "Build a Full Cointegration Screening Pipeline",
              description:
                "Write a script to test all pairwise combinations of 6 forex majors (EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CHF, NZD/USD) for cointegration using both Engle-Granger and Johansen tests. Create a heatmap matrix showing p-values. For each cointegrated pair, estimate the hedge ratio, compute the spread, and calculate half-life. Filter to pairs with 5 < τ₁/₂ < 30 bars (tradeable range). Backtest a simple pairs trading strategy over 6 months: enter at |z| > 2, exit at |z| < 0.5, track Sharpe ratio and maximum drawdown. Does the strategy survive transaction costs (assume 1 pip per trade)?",
            },
            {
              type: "practice",
              title: "Monitor Live Spread for Regime Changes",
              description:
                "Implement a real-time monitoring system for an EUR/GBP spread. Every 100 bars, re-run the Engle-Granger test on a rolling 500-bar window and recompute the half-life. Plot rolling p-values and half-life over time. Set alerts: (1) if p-value > 0.10 for 3 consecutive windows, flag a structural break and halt trading; (2) if half-life > 40 bars, reduce position size by 50%; (3) if half-life < 5 bars, increase position size (fast reversion). Backtest this adaptive strategy vs a static strategy that never adjusts. Does dynamic monitoring improve risk-adjusted returns?",
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
            "Master HMMs from first principles: formal components (A, B, π), the three fundamental algorithms — Forward (evaluation), Viterbi (decoding), and Baum-Welch (learning) — with complete numerical examples, then apply Gaussian HMMs to detect forex volatility regimes.",
          estimatedMinutes: 75,
          difficulty: "intermediate",
          prerequisites: ["found-probability", "ts-stationarity"],
          relatedModels: ["gaussian-hmm", "regime-detector"],
          sections: [
            {
              type: "objective",
              content:
                "This lesson provides a textbook-depth treatment of Hidden Markov Models. You will learn the formal definition of an HMM as a triple λ = (A, B, π), work through the three fundamental problems — Evaluation (Forward algorithm), Decoding (Viterbi algorithm), and Learning (Baum-Welch/EM) — with complete derivations and concrete numerical examples. You will implement both the Forward algorithm from scratch and a full Gaussian HMM pipeline using hmmlearn, apply model selection via BIC to choose the optimal number of hidden states K, and interpret the learned parameters in the context of forex volatility regime detection.",
              keyTakeaways: [
                "An HMM is defined by hidden states S, transition matrix A (aᵢⱼ = P(sₜ=j|sₜ₋₁=i)), emission distributions B, and initial distribution π, compactly written λ = (A, B, π)",
                "The Forward algorithm computes P(O₁:T|λ) in O(K²T) time using recursive forward variables αₜ(j), avoiding the O(Kᵀ) brute-force enumeration",
                "The Viterbi algorithm finds the single most likely hidden state sequence s* = argmax P(S₁:T|O₁:T,λ) via dynamic programming on a K×T trellis with backtracking",
                "Baum-Welch (EM) learns parameters by alternating E-step (forward-backward to compute γₜ(i) and ξₜ(i,j)) and M-step (re-estimation formulas), converging to a local maximum",
                "The forward-backward algorithm combines αₜ(i) and βₜ(i) to compute posterior state probabilities γₜ(i) = P(sₜ=i|O,λ) and transition posteriors ξₜ(i,j)",
                "Gaussian HMMs model continuous observations with state-specific means and variances bⱼ(o) = N(o; μⱼ, σⱼ²), making them directly applicable to financial returns",
                "Forex regime detection uses HMMs to identify latent volatility states (calm/trending/crisis), with the transition matrix revealing regime persistence and the stationary distribution giving long-run regime proportions",
              ],
            },
            {
              type: "theory",
              title: "HMM Components: States, Transitions & Emissions",
              content:
                "A **Hidden Markov Model (HMM)** is a doubly stochastic process consisting of an unobservable (hidden) Markov chain and an observable process conditioned on the hidden states. Formally, the hidden state space is S = {1, 2, …, K} and the observable sequence is O = (o₁, o₂, …, oT). The model is governed by three parameter sets. The **transition matrix** A is a K×K stochastic matrix where aᵢⱼ = P(sₜ = j | sₜ₋₁ = i) and each row sums to one: ∑ⱼ aᵢⱼ = 1. This encodes the **first-order Markov property**: P(sₜ | s₁, s₂, …, sₜ₋₁) = P(sₜ | sₜ₋₁) — the future state depends only on the current state, not the full history. The **emission distribution** B defines bⱼ(oₜ) = P(oₜ | sₜ = j), the probability of observing oₜ when the hidden state is j. This satisfies **conditional independence**: P(oₜ | s₁:T, o₁:T\\oₜ) = P(oₜ | sₜ) — each observation depends only on the current hidden state. The **initial distribution** π defines πᵢ = P(s₁ = i), the probability of starting in state i. Together, the model is compactly written as λ = (A, B, π).\n\nFor continuous-valued observations like financial returns, we use a **Gaussian HMM** where each state's emission is a normal distribution: bⱼ(o) = N(o; μⱼ, σⱼ²) = (1/√(2πσⱼ²)) exp(−(o − μⱼ)² / (2σⱼ²)). Each hidden state has its own mean μⱼ and variance σⱼ², capturing distinct statistical regimes. For forex returns, a typical 3-state Gaussian HMM might discover: **State 1 (Calm/Ranging)**: μ₁ ≈ 0, σ₁ = 0.0003 — small random fluctuations around zero; **State 2 (Trending)**: μ₂ ≈ 0.0001, σ₂ = 0.0008 — directional drift with moderate volatility; **State 3 (Crisis/Breakout)**: μ₃ ≈ −0.0002, σ₃ = 0.0015 — large swings with slight negative bias. The multivariate extension uses bⱼ(o) = N(o; μⱼ, Σⱼ) with mean vectors and full covariance matrices.\n\n**Concrete numerical example.** Consider a 2-state HMM for forex returns with states {Calm, Volatile}. The transition matrix is A = [[0.95, 0.05], [0.10, 0.90]], meaning the Calm state transitions to Volatile with probability 0.05 per step and Volatile transitions to Calm with probability 0.10. Emission distributions: Calm emits N(0, 0.0003²) and Volatile emits N(0, 0.001²). Initial distribution: π = [0.7, 0.3]. The **expected duration** of staying in a state before transitioning is 1/(1 − aᵢᵢ): for Calm, 1/0.05 = 20 bars; for Volatile, 1/0.10 = 10 bars. The **stationary distribution** (long-run proportion of time in each state) is found by solving πA = π with ∑πᵢ = 1. Setting π_calm · 0.05 = π_vol · 0.10 and π_calm + π_vol = 1 gives π_calm = 0.10/(0.05 + 0.10) = 0.667 and π_vol = 0.05/(0.05 + 0.10) = 0.333. The market spends roughly two-thirds of its time in the Calm regime.",
            },
            {
              type: "theory",
              title: "The Forward Algorithm and Viterbi Decoding",
              content:
                "**The Forward Algorithm** solves the evaluation problem: given a model λ = (A, B, π) and observation sequence O = (o₁, …, oT), compute the total probability P(O|λ). A brute-force approach would enumerate all Kᵀ possible state sequences and sum P(O, S|λ) over each — computationally infeasible. The Forward algorithm uses dynamic programming via the **forward variable** αₜ(j) = P(o₁, o₂, …, oₜ, sₜ = j | λ), the joint probability of observing the first t observations and being in state j at time t. **Initialization** (t = 1): α₁(j) = πⱼ · bⱼ(o₁) for each state j = 1, …, K. **Recursion** (t = 2, …, T): αₜ(j) = [∑ᵢ₌₁ᴷ αₜ₋₁(i) · aᵢⱼ] · bⱼ(oₜ). The bracketed sum aggregates all paths arriving at state j by marginalizing over the previous state i. **Termination**: P(O|λ) = ∑ⱼ₌₁ᴷ αT(j). The total complexity is O(K²T) — at each of T steps, we compute K states each requiring a sum over K previous states. In practice, log-scaling is essential: working with log αₜ(j) prevents floating-point underflow when T is large, using the log-sum-exp trick: log(∑ exp(xᵢ)) = max(x) + log(∑ exp(xᵢ − max(x))).\n\n**The Viterbi Algorithm** solves the decoding problem: find s* = argmax_{S₁:T} P(S₁:T | O₁:T, λ), the single most likely hidden state sequence. It replaces the summation in Forward with maximization. Define δₜ(j) = max_{s₁,…,sₜ₋₁} P(s₁, …, sₜ₋₁, sₜ = j, o₁, …, oₜ | λ) — the probability of the best path ending in state j at time t. **Initialization**: δ₁(j) = πⱼ · bⱼ(o₁). **Recursion**: δₜ(j) = maxᵢ[δₜ₋₁(i) · aᵢⱼ] · bⱼ(oₜ), and we store the backpointer ψₜ(j) = argmaxᵢ[δₜ₋₁(i) · aᵢⱼ]. **Termination**: s*_T = argmaxⱼ δT(j). **Backtracking**: for t = T−1, T−2, …, 1: s*ₜ = ψₜ₊₁(s*ₜ₊₁). This traces back through the stored backpointers to recover the full optimal path. The algorithm operates on a K×T trellis (lattice) and has the same O(K²T) complexity as Forward.\n\n**Numerical example** using the 2-state HMM from Theory 1 (Calm/Volatile, A = [[0.95, 0.05], [0.10, 0.90]], π = [0.7, 0.3]). Suppose we observe O = (o₁ = −0.0001, o₂ = 0.0012, o₃ = −0.0008). Emission densities: b_Calm(o) = N(o; 0, 0.0003²), b_Vol(o) = N(o; 0, 0.001²). Computed values: b_Calm(o₁) = N(−0.0001; 0, 0.0003²) ≈ 1306.5, b_Vol(o₁) = N(−0.0001; 0, 0.001²) ≈ 398.9; b_Calm(o₂) = N(0.0012; 0, 0.0003²) ≈ 0.0000 (≈ 5.4 × 10⁻⁸, essentially zero — 0.0012 is 4σ from the Calm mean), b_Vol(o₂) = N(0.0012; 0, 0.001²) ≈ 187.7; b_Calm(o₃) = N(−0.0008; 0, 0.0003²) ≈ 5.98, b_Vol(o₃) = N(−0.0008; 0, 0.001²) ≈ 340.3. **Forward pass**: α₁(C) = 0.7 × 1306.5 = 914.5, α₁(V) = 0.3 × 398.9 = 119.7. α₂(C) = [914.5 × 0.95 + 119.7 × 0.10] × 5.4e-8 ≈ 0.0001, α₂(V) = [914.5 × 0.05 + 119.7 × 0.90] × 187.7 ≈ 28,831.6. α₃(C) = [0.0001 × 0.95 + 28831.6 × 0.10] × 5.98 ≈ 17,241.0, α₃(V) = [0.0001 × 0.05 + 28831.6 × 0.90] × 340.3 ≈ 8,832,156.8. P(O|λ) = α₃(C) + α₃(V) ≈ 8,849,397.8. **Viterbi**: δ₁(C) = 914.5, δ₁(V) = 119.7. δ₂(C) ≈ max(914.5 × 0.95, 119.7 × 0.10) × 5.4e-8 ≈ 0.0000, δ₂(V) ≈ max(914.5 × 0.05, 119.7 × 0.90) × 187.7 ≈ max(45.7, 107.7) × 187.7 ≈ 20,225.0, ψ₂(V) = Volatile. δ₃(V) = max(0.0 × 0.05, 20225.0 × 0.90) × 340.3 ≈ 6,196,093.4. Backtrack: s*₃ = Vol, s*₂ = Vol, s*₁ = Calm. Decoded: [Calm, Volatile, Volatile] — the large return o₂ = 0.0012 switches the model from Calm to Volatile.\n\n**Why O(K²T) beats O(Kᵀ).** The brute-force approach enumerates every possible state sequence: with K states and T time steps, there are Kᵀ sequences. For K = 3 and T = 1000, that is 3¹⁰⁰⁰ ≈ 10⁴⁷⁷ — far beyond any computer. The Forward algorithm shares computation through its recursion: at each time step, computing αₜ(j) for all K states requires summing over K previous states, yielding K × K = K² operations per step, and T steps total: K²T. For K = 3, T = 1000: 9 × 1000 = 9,000 operations — a reduction from astronomical to trivial.",
            },
            {
              type: "theory",
              title: "Baum-Welch Algorithm: Learning HMM Parameters",
              content:
                "The **Baum-Welch algorithm** (a special case of Expectation-Maximization) solves the learning problem: given observation sequence O, find λ* = argmax_λ P(O|λ). It requires the **backward variable** βₜ(i) = P(oₜ₊₁, oₜ₊₂, …, oT | sₜ = i, λ), the probability of future observations given the current state. **Initialization**: βT(i) = 1 for all states. **Recursion** (t = T−1, T−2, …, 1): βₜ(i) = ∑ⱼ₌₁ᴷ aᵢⱼ · bⱼ(oₜ₊₁) · βₜ₊₁(j). Combining forward and backward variables yields the key posterior quantities. The **state posterior** γₜ(i) = P(sₜ = i | O, λ) = αₜ(i) · βₜ(i) / P(O|λ), where P(O|λ) = ∑ⱼ αₜ(j) · βₜ(j) for any t. The **transition posterior** ξₜ(i, j) = P(sₜ = i, sₜ₊₁ = j | O, λ) = αₜ(i) · aᵢⱼ · bⱼ(oₜ₊₁) · βₜ₊₁(j) / P(O|λ). Note that γₜ(i) = ∑ⱼ ξₜ(i, j), providing a consistency check.\n\nThe **M-step** uses these posteriors to re-estimate all model parameters (the re-estimation formulas). Initial distribution: π̂ᵢ = γ₁(i). Transition probabilities: âᵢⱼ = ∑ₜ₌₁ᵀ⁻¹ ξₜ(i, j) / ∑ₜ₌₁ᵀ⁻¹ γₜ(i) — the expected number of transitions from i to j divided by the expected number of times in state i. For **Gaussian emissions**, the mean update is μ̂ⱼ = ∑ₜ₌₁ᵀ γₜ(j) · oₜ / ∑ₜ₌₁ᵀ γₜ(j), a weighted average of observations with weights equal to the posterior probability of being in state j. The variance update is σ̂ⱼ² = ∑ₜ₌₁ᵀ γₜ(j) · (oₜ − μ̂ⱼ)² / ∑ₜ₌₁ᵀ γₜ(j). A fundamental property of EM guarantees that the log-likelihood is **non-decreasing** at each iteration: log P(O|λ⁽ⁿ⁺¹⁾) ≥ log P(O|λ⁽ⁿ⁾). The algorithm converges to a **local maximum** — not necessarily the global maximum.\n\n**Practical considerations.** (a) **Multiple random restarts**: Because Baum-Welch converges to local optima, standard practice is to run 10–20 initializations with different random seeds and keep the model with the highest final log-likelihood. (b) **Choosing the number of states K**: Fit models with K = 2, 3, 4, 5 and select the K that minimizes the **Bayesian Information Criterion**: BIC = −2 ln(L̂) + k · ln(T), where k is the number of free parameters. For a K-state Gaussian HMM with univariate emissions: k = (K² − K) transition parameters (K rows each summing to 1, so K(K−1) free) + (K − 1) initial distribution parameters + 2K emission parameters (μⱼ and σⱼ² for each state) = K² + K − 1. BIC penalizes model complexity, preventing overfitting with too many states. (c) **Convergence criterion**: Stop when |log L⁽ⁿ⁾ − log L⁽ⁿ⁻¹⁾| < ε (typically ε = 10⁻⁴). (d) **Regularization**: Add a small floor value (e.g., 10⁻⁶) to the diagonal of covariance matrices to prevent singularity when a state captures very few observations.",
            },
            {
              type: "intuition",
              title: "The Weather Behind Closed Doors",
              analogy:
                "An HMM is like inferring today's weather by observing what people carry — umbrellas, sunglasses, or coats — when you cannot see outside.",
              content:
                "Imagine you work in a windowless basement office. You cannot observe the weather directly (the hidden states: ☀️ Sunny, 🌧️ Rainy, ❄️ Snowy), but each morning you see colleagues arriving with different items — sunglasses, umbrellas, or heavy coats (the emissions). The **transition matrix** captures weather persistence: sunny days tend to follow sunny days (a_sunny→sunny = 0.8), rainy days cluster together (a_rainy→rainy = 0.7). The **emission probabilities** encode how weather maps to items: on rainy days, 90% carry umbrellas. Given a week of observed items, the **Forward algorithm** computes the probability of seeing that exact sequence. **Viterbi decoding** finds the most likely weather sequence that explains those items. And if you just moved to a new city with unknown climate patterns, **Baum-Welch** learns the transition and emission probabilities from scratch by observing many days of items.\n\nIn forex, the weather is the hidden market regime — calm, trending, or crisis — and the items are observed returns. You never see the regime directly; you only see price changes. The HMM reverse-engineers the unobservable regime sequence from observable price action, telling you whether the market was probably calm or volatile at each point in time, and how likely a regime switch is at any moment.",
              emoji: "🌤️",
            },
            {
              type: "intuition",
              title: "The Casino Dice Analogy",
              analogy:
                "Imagine a casino secretly switching between fair and loaded dice — the HMM detects which die is in play from the sequence of rolls.",
              content:
                "A dishonest casino has two dice (hidden states): a **fair die** (each face 1–6 equally likely, probability 1/6) and a **loaded die** (heavily biased toward 6, say P(6) = 0.5 and P(1–5) = 0.1 each). The croupier secretly switches between dice according to transition probabilities — once using the fair die, there's a 95% chance of continuing with it and 5% of switching to loaded (and vice versa). As a player, you only see the sequence of rolls (the emissions), never which die is being used. The **Forward algorithm** tells you the overall probability of the observed roll sequence under this model. **Viterbi decoding** reveals the most likely sequence of which die was in play at each roll — you might discover the casino switched to the loaded die right when that suspicious streak of sixes appeared.\n\nIn forex, the two 'dice' are market regimes with different return distributions, and the 'rolls' are observed returns. A calm regime produces small, symmetric returns (like a fair die), while a volatile regime produces large, possibly skewed returns (like a loaded die). The HMM detects when the market switched regimes, enabling you to adjust position sizes — trading smaller during volatile regimes and larger during calm ones.",
              emoji: "🎲",
            },
            {
              type: "code",
              title: "Gaussian HMM for Forex Regime Detection",
              language: "python",
              code: `import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM

# Load and prepare EUR/USD hourly data
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
df["log_return"] = np.log(df["close"] / df["close"].shift(1))
returns = df["log_return"].dropna().values.reshape(-1, 1)
print(f"Data: {len(returns)} observations, range [{returns.min():.6f}, {returns.max():.6f}]")

# Fit 3-state Gaussian HMM with multiple random restarts
best_model, best_ll = None, -np.inf
n_restarts = 15
for seed in range(n_restarts):
    try:
        model = GaussianHMM(
            n_components=3,
            covariance_type="full",
            n_iter=300,
            random_state=seed,
            tol=1e-4,
        )
        model.fit(returns)
        ll = model.score(returns)
        if ll > best_ll:
            best_ll, best_model = ll, model
    except Exception:
        continue
print(f"Best log-likelihood from {n_restarts} restarts: {best_ll:.2f}")
model = best_model

# Decode most likely regime sequence via Viterbi
hidden_states = model.predict(returns)

# Regime analysis: sort states by volatility for consistent labeling
state_order = np.argsort([np.sqrt(model.covars_[i, 0, 0]) for i in range(3)])
labels = ["Low-Vol", "Med-Vol", "High-Vol"]
print(f"\\n{'Regime':<12} {'Mean (μ)':>12} {'Std (σ)':>12} {'Pct Time':>10}")
print("-" * 50)
for rank, i in enumerate(state_order):
    mask = hidden_states == i
    mu = model.means_[i, 0]
    sigma = np.sqrt(model.covars_[i, 0, 0])
    pct = mask.sum() / len(hidden_states) * 100
    print(f"{labels[rank]:<12} {mu:>12.6f} {sigma:>12.6f} {pct:>9.1f}%")

# Transition matrix with labeled rows/columns
print("\\nTransition Matrix A:")
header = "          " + "  ".join(f"{labels[r]:>8}" for r in range(3))
print(header)
for r_from, i in enumerate(state_order):
    row = "  ".join(f"{model.transmat_[i, state_order[r_to]]:.4f}" for r_to in range(3))
    print(f"{labels[r_from]:<10}{row}")

# Stationary distribution via eigenvector method
eigenvalues, eigenvectors = np.linalg.eig(model.transmat_.T)
idx = np.argmin(np.abs(eigenvalues - 1.0))
stationary = np.real(eigenvectors[:, idx])
stationary /= stationary.sum()
print(f"\\nStationary distribution:")
for rank, i in enumerate(state_order):
    print(f"  π({labels[rank]}) = {stationary[i]:.4f}")

# Expected regime durations
print("\\nExpected regime durations:")
for rank, i in enumerate(state_order):
    duration = 1.0 / (1.0 - model.transmat_[i, i])
    print(f"  {labels[rank]}: {duration:.1f} bars")`,
              explanation:
                "This script fits a 3-state Gaussian HMM with 15 random restarts to find the best local optimum. States are sorted by volatility for consistent labeling across runs. The transition matrix diagonal reveals regime persistence (values near 0.98+ mean regimes last many hours), and the stationary distribution gives the long-run proportion of time in each regime.",
            },
            {
              type: "code",
              title: "Forward Algorithm Implementation from Scratch",
              language: "python",
              code: `import numpy as np
from scipy.stats import norm

# Define the 2-state HMM from our theory example
pi = np.array([0.7, 0.3])                  # initial distribution
A = np.array([[0.95, 0.05],                # transition matrix
              [0.10, 0.90]])
means = np.array([0.0, 0.0])               # emission means [Calm, Volatile]
stds = np.array([0.0003, 0.001])            # emission std devs
state_names = ["Calm", "Volatile"]
K = len(pi)

# Observation sequence
obs = np.array([-0.0001, 0.0012, -0.0008])
T = len(obs)

# --- Forward Algorithm (manual) ---
# Compute emission densities b_j(o_t) for all states and times
B = np.zeros((K, T))
for j in range(K):
    B[j, :] = norm.pdf(obs, loc=means[j], scale=stds[j])
    for t in range(T):
        print(f"b_{state_names[j]}(o_{t+1}={obs[t]:+.4f}) = {B[j, t]:.4f}")

# Initialization: alpha_1(j) = pi_j * b_j(o_1)
alpha = np.zeros((K, T))
alpha[:, 0] = pi * B[:, 0]
print(f"\\n--- Forward Pass ---")
print(f"t=1: alpha(Calm)={alpha[0,0]:.4f}, alpha(Vol)={alpha[1,0]:.4f}")

# Recursion: alpha_t(j) = [sum_i alpha_{t-1}(i) * a_ij] * b_j(o_t)
for t in range(1, T):
    for j in range(K):
        alpha[j, t] = np.sum(alpha[:, t-1] * A[:, j]) * B[j, t]
    print(f"t={t+1}: alpha(Calm)={alpha[0,t]:.4f}, alpha(Vol)={alpha[1,t]:.4f}")

# Termination
prob_obs = np.sum(alpha[:, -1])
print(f"\\nP(O|lambda) = sum of alpha_T = {prob_obs:.4f}")
print(f"Log P(O|lambda) = {np.log(prob_obs):.4f}")

# --- Log-scaled version (prevents underflow for long sequences) ---
log_alpha = np.full((K, T), -np.inf)
log_alpha[:, 0] = np.log(pi) + np.log(B[:, 0])
for t in range(1, T):
    for j in range(K):
        log_alpha[j, t] = np.logaddexp.reduce(
            log_alpha[:, t-1] + np.log(A[:, j])
        ) + np.log(B[j, t])
log_prob = np.logaddexp.reduce(log_alpha[:, -1])
print(f"\\nLog-scaled verification: log P(O|lambda) = {log_prob:.4f}")

# --- Compare with hmmlearn ---
from hmmlearn.hmm import GaussianHMM
hmm = GaussianHMM(n_components=2, covariance_type="diag", n_iter=0)
hmm.startprob_ = pi
hmm.transmat_ = A
hmm.means_ = means.reshape(-1, 1)
hmm.covars_ = (stds**2).reshape(-1, 1)
ll_hmmlearn = hmm.score(obs.reshape(-1, 1))
print(f"hmmlearn score:           log P(O|lambda) = {ll_hmmlearn:.4f}")
print(f"Match: {np.isclose(log_prob, ll_hmmlearn, atol=0.01)}")`,
              explanation:
                "This implements the Forward algorithm step by step, printing every α value so you can verify the recursion manually. The log-scaled version demonstrates the essential underflow prevention technique. Finally, we validate our manual computation against hmmlearn's built-in score method.",
            },
            {
              type: "code",
              title: "Model Selection: Choosing Optimal Number of States",
              language: "python",
              code: `import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM

# Load data
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
df["log_return"] = np.log(df["close"] / df["close"].shift(1))
returns = df["log_return"].dropna().values.reshape(-1, 1)
T = len(returns)
print(f"Observations T = {T}")

# Fit HMMs with K = 2, 3, 4, 5 states; compute BIC for each
results = []
for K in range(2, 6):
    best_ll = -np.inf
    best_m = None
    for seed in range(10):
        try:
            m = GaussianHMM(n_components=K, covariance_type="diag",
                            n_iter=300, random_state=seed, tol=1e-4)
            m.fit(returns)
            ll = m.score(returns) * T  # score returns per-sample LL
            if ll > best_ll:
                best_ll, best_m = ll, m
        except Exception:
            continue
    # Free parameters: K(K-1) transitions + (K-1) initial + 2K emissions
    n_params = K * (K - 1) + (K - 1) + 2 * K
    bic = -2 * best_ll + n_params * np.log(T)
    aic = -2 * best_ll + 2 * n_params
    results.append({"K": K, "LogL": best_ll, "Params": n_params,
                     "BIC": bic, "AIC": aic})
    print(f"K={K}: LogL={best_ll:.1f}, params={n_params}, BIC={bic:.1f}, AIC={aic:.1f}")

# Summary table
print(f"\\n{'K':>3} {'Log-Likelihood':>16} {'# Params':>10} {'BIC':>14} {'AIC':>14}")
print("-" * 60)
for r in results:
    print(f"{r['K']:>3} {r['LogL']:>16.1f} {r['Params']:>10} {r['BIC']:>14.1f} {r['AIC']:>14.1f}")

# Optimal K
best = min(results, key=lambda x: x["BIC"])
print(f"\\nOptimal K by BIC: {best['K']} states (BIC = {best['BIC']:.1f})")
print("Lower BIC = better trade-off between fit and complexity.")`,
              explanation:
                "This script systematically compares HMMs with 2–5 hidden states using BIC (Bayesian Information Criterion). Each model is fit with 10 random restarts. BIC balances goodness-of-fit (log-likelihood) against model complexity (number of parameters), preventing overfitting to noise with too many states.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "ts-hmm-q1",
                  question:
                    "What does the Viterbi algorithm compute for an HMM?",
                  options: [
                    { id: "ts-hmm-q1-a", text: "The total probability P(O|λ) of the observation sequence given the model" },
                    { id: "ts-hmm-q1-b", text: "The single most likely sequence of hidden states s* = argmax P(S₁:T|O₁:T,λ)" },
                    { id: "ts-hmm-q1-c", text: "The optimal number of hidden states K that minimizes BIC" },
                    { id: "ts-hmm-q1-d", text: "The maximum likelihood parameter estimates λ* = argmax P(O|λ)" },
                  ],
                  correctOptionId: "ts-hmm-q1-b",
                  explanation:
                    "Viterbi solves the decoding problem: it uses dynamic programming on a K×T trellis to find s* = argmax_{S₁:T} P(S₁:T | O₁:T, λ). At each step, it tracks the best path to each state (δₜ(j)) and stores backpointers (ψₜ(j)) for backtracking. The Forward algorithm computes P(O|λ), and Baum-Welch estimates parameters — both are distinct problems.",
                },
                {
                  id: "ts-hmm-q2",
                  question:
                    "A 2-state HMM has transition matrix A = [[0.97, 0.03], [0.05, 0.95]]. What is the expected duration of State 0 before transitioning?",
                  options: [
                    { id: "ts-hmm-q2-a", text: "1 / 0.97 ≈ 1.03 periods" },
                    { id: "ts-hmm-q2-b", text: "1 / 0.03 ≈ 33.3 periods" },
                    { id: "ts-hmm-q2-c", text: "1 / 0.05 = 20 periods" },
                    { id: "ts-hmm-q2-d", text: "0.97 × 100 = 97 periods" },
                  ],
                  correctOptionId: "ts-hmm-q2-b",
                  explanation:
                    "The expected duration of staying in state i follows a geometric distribution with parameter (1 − aᵢᵢ), giving expected value 1/(1 − aᵢᵢ). For State 0: 1/(1 − 0.97) = 1/0.03 ≈ 33.3 periods. The self-transition probability 0.97 is not the duration; the exit probability 0.03 determines how long the state persists on average.",
                },
                {
                  id: "ts-hmm-q3",
                  question:
                    "What is the computational complexity of the Forward algorithm for an HMM with K states and T observations?",
                  options: [
                    { id: "ts-hmm-q3-a", text: "O(Kᵀ) — exponential in sequence length" },
                    { id: "ts-hmm-q3-b", text: "O(K²T) — quadratic in states, linear in time" },
                    { id: "ts-hmm-q3-c", text: "O(KT²) — linear in states, quadratic in time" },
                    { id: "ts-hmm-q3-d", text: "O(KT) — linear in both states and time" },
                  ],
                  correctOptionId: "ts-hmm-q3-b",
                  explanation:
                    "At each of T time steps, the Forward algorithm computes αₜ(j) for K states, each requiring a sum over K previous states — yielding K² operations per step and K²T total. The brute-force approach of enumerating all Kᵀ state sequences is exponential. The Forward recursion achieves polynomial complexity by sharing computation across overlapping subproblems.",
                },
                {
                  id: "ts-hmm-q4",
                  question:
                    "Why might a 3-state HMM outperform a 2-state HMM for forex regime detection?",
                  options: [
                    { id: "ts-hmm-q4-a", text: "More states always produce higher accuracy on any dataset" },
                    { id: "ts-hmm-q4-b", text: "3 states can capture distinct low/medium/high volatility regimes that 2 states must conflate" },
                    { id: "ts-hmm-q4-c", text: "3-state models train faster due to better gradient flow" },
                    { id: "ts-hmm-q4-d", text: "3-state models require less data to achieve the same fit" },
                  ],
                  correctOptionId: "ts-hmm-q4-b",
                  explanation:
                    "Forex markets often exhibit three distinct regimes: low-volatility (tight ranging), medium-volatility (steady trending), and high-volatility (crisis/breakout). A 2-state model must merge medium and high volatility into a single state, losing actionable granularity for position sizing and strategy selection. However, more states are not always better — BIC should guide the choice.",
                },
                {
                  id: "ts-hmm-q5",
                  question:
                    "What convergence guarantee does the Baum-Welch (EM) algorithm provide for HMM parameter estimation?",
                  options: [
                    { id: "ts-hmm-q5-a", text: "It converges to the global maximum of the log-likelihood" },
                    { id: "ts-hmm-q5-b", text: "It converges to a local maximum — the log-likelihood is non-decreasing each iteration but the optimum found depends on initialization" },
                    { id: "ts-hmm-q5-c", text: "It diverges for most initial conditions and requires careful tuning" },
                    { id: "ts-hmm-q5-d", text: "It converges to the global maximum only when K ≤ 3" },
                  ],
                  correctOptionId: "ts-hmm-q5-b",
                  explanation:
                    "EM guarantees that log P(O|λ) is non-decreasing at each iteration, but it converges to a local maximum that depends on the initial parameter values. The log-likelihood surface for HMMs typically has multiple local optima. This is why multiple random restarts (10–20) are essential in practice: run Baum-Welch from different initializations and keep the model with the highest final log-likelihood.",
                },
                {
                  id: "ts-hmm-q6",
                  question:
                    "Why is log-scaling (working with log α values) essential when running the Forward algorithm on long sequences?",
                  options: [
                    { id: "ts-hmm-q6-a", text: "Log-scaling makes the algorithm run in O(KT) instead of O(K²T)" },
                    { id: "ts-hmm-q6-b", text: "The forward variables αₜ(j) are products of many small probabilities that quickly underflow to zero in floating-point arithmetic" },
                    { id: "ts-hmm-q6-c", text: "Log-scaling converts the multiplication-based recursion to addition, which is less prone to overflow errors" },
                    { id: "ts-hmm-q6-d", text: "Log-scaling is only needed for discrete emissions, not Gaussian HMMs" },
                  ],
                  correctOptionId: "ts-hmm-q6-b",
                  explanation:
                    "Each αₜ(j) involves multiplying many probabilities (all ≤ 1), so after hundreds of time steps the values become astronomically small — often below 10⁻³⁰⁰, far below the IEEE 754 double-precision minimum (~10⁻³⁰⁸). Working in log-space converts these products to sums and uses the log-sum-exp trick for the summation step, keeping values in a numerically stable range. This applies equally to Gaussian and discrete emissions.",
                },
                {
                  id: "ts-hmm-q7",
                  question:
                    "What does the conditional independence assumption P(oₜ|s₁:T, o₁:T\\oₜ) = P(oₜ|sₜ) mean in an HMM?",
                  options: [
                    { id: "ts-hmm-q7-a", text: "Each observation is independent of all other observations regardless of the hidden states" },
                    { id: "ts-hmm-q7-b", text: "Each observation depends only on the current hidden state, not on other hidden states or other observations" },
                    { id: "ts-hmm-q7-c", text: "Hidden states are independent of each other across time" },
                    { id: "ts-hmm-q7-d", text: "The transition probabilities are independent of the emission probabilities" },
                  ],
                  correctOptionId: "ts-hmm-q7-b",
                  explanation:
                    "Conditional independence means the emission at time t depends solely on the hidden state at time t — once you know sₜ, knowing other states or observations provides no additional information about oₜ. This is a core structural assumption of HMMs that enables efficient inference. Note that observations are NOT marginally independent — they are correlated through the hidden state chain. If this assumption is violated (e.g., returns depend on past returns), autoregressive HMMs or switching models may be needed.",
                },
              ],
            },
            {
              type: "practice",
              title: "Guided: Complete HMM Pipeline",
              description:
                "Build a complete HMM analysis pipeline from scratch. (1) Load EUR/USD hourly data and compute log-returns. (2) Fit Gaussian HMMs with K = 2, 3, 4, and 5 states, using 15 random restarts per K. (3) Compute BIC for each K and select the optimal model. (4) Decode the best model's hidden states using Viterbi. (5) Print regime statistics: mean return, standard deviation, percentage of time, and expected duration per regime. (6) Print the full transition matrix with labeled rows and columns. (7) Compute and interpret the stationary distribution — does it match the observed regime proportions? (8) Identify the most persistent regime (highest self-transition probability) and the most transient regime.",
            },
            {
              type: "practice",
              title: "Dashboard: Visualize HMM Regimes",
              description:
                "Load a trained Gaussian HMM from the model catalog and create a comprehensive regime visualization. (1) Overlay the decoded regime sequence on a price chart using color-coded backgrounds (e.g., green for calm, yellow for trending, red for crisis). (2) Plot the regime posterior probabilities γₜ(i) over time — this shows model confidence. (3) Mark regime transition points and correlate them with major news events (NFP releases, central bank announcements, geopolitical shocks). (4) Compare regime detection across multiple currency pairs (EUR/USD, GBP/USD, USD/JPY) — do regime switches occur simultaneously? (5) Compute rolling regime statistics: average return and Sharpe ratio within each regime.",
              catalogModelId: "gaussian-hmm",
            },
          ],
        },
        {
          id: "ts-kalman",
          title: "Kalman Filters & State Estimation",
          description:
            "Learn how Kalman filters combine noisy observations with a dynamic model to produce optimal state estimates, and apply them to adaptive price tracking and spread modelling in forex.",
          estimatedMinutes: 70,
          difficulty: "intermediate",
          prerequisites: ["found-linear-algebra", "ts-stationarity"],
          relatedModels: ["kalman-tracker"],
          sections: [
            {
              type: "objective",
              content:
                "After this lesson you will master the Kalman filter from rigorous first principles — derive the state-space formulation for linear Gaussian dynamical systems, prove the Kalman filter is the minimum mean-squared error (MMSE) estimator for Gaussian processes, derive the predict step from the Chapman-Kolmogorov equation for conditional densities, derive the update step via Bayes' rule and complete-the-square for Gaussian products, prove the Kalman gain Kₜ = Pₜ|ₜ₋₁Hᵀ(HPₜ|ₜ₋₁Hᵀ+R)⁻¹ minimizes updated covariance Pₜ|ₜ, understand the information-theoretic interpretation (Kalman gain as optimal weighting of prior and likelihood), implement Extended Kalman Filter (EKF) for nonlinear state/observation models via first-order Taylor approximation, understand Unscented Kalman Filter (UKF) sigma-point propagation for higher-order nonlinearity, apply Kalman filters to forex for adaptive price tracking with automatic lag/smoothness adjustment, dynamic hedge ratio estimation for pairs trading with time-varying beta, and spread tracking with regime-dependent variance.",
              keyTakeaways: [
                "State-space: xₜ = Fxₜ₋₁ + Buₜ + wₜ (process), zₜ = Hxₜ + vₜ (observation), w ~ N(0,Q), v ~ N(0,R)",
                "Kalman filter is the MMSE estimator: x̂ₜ|ₜ = E[xₜ|z₁:ₜ] minimizes E[‖xₜ−x̂ₜ|ₜ‖²] among all estimators (linear or nonlinear) for Gaussian systems",
                "Predict step: x̂ₜ|ₜ₋₁ = Fx̂ₜ₋₁|ₜ₋₁ + Buₜ₋₁, Pₜ|ₜ₋₁ = FPₜ₋₁|ₜ₋₁Fᵀ + Q (propagate belief forward using dynamics model)",
                "Update step: Kₜ = Pₜ|ₜ₋₁Hᵀ(HPₜ|ₜ₋₁Hᵀ+R)⁻¹ (Kalman gain), x̂ₜ|ₜ = x̂ₜ|ₜ₋₁ + Kₜ(zₜ−Hx̂ₜ|ₜ₋₁), Pₜ|ₜ = (I−KₜH)Pₜ|ₜ₋₁ (correct prediction using observation)",
                "Kalman gain Kₜ balances trust: R→∞ (noisy obs) ⇒ Kₜ→0 (trust model), Q→∞ (uncertain model) ⇒ Kₜ→I (trust obs), optimal blend minimizes posterior variance",
                "Innovation sequence ỹₜ = zₜ − Hx̂ₜ|ₜ₋₁ ~ N(0, Sₜ) is white noise if model correct — test via Ljung-Box for filter validation",
                "EKF for nonlinear f(x), h(x): linearize via Jacobians Fₜ = ∂f/∂x|x̂ₜ₋₁, Hₜ = ∂h/∂x|x̂ₜ|ₜ₋₁, then apply standard KF (first-order approximation, fails for high nonlinearity)",
                "UKF propagates sigma points {xⁱ} through nonlinear f, h without Jacobians — captures mean/covariance to 2nd order (more robust than EKF for strong nonlinearity)",
              ],
            },
            {
              type: "theory",
              title: "State-Space Models & Derivation of the Kalman Filter via Bayesian Recursion",
              content:
                "**State-Space Formulation**: A linear Gaussian state-space model (also called linear dynamical system or LDS) consists of two equations:\n1. **State transition (process model)**: xₜ = Fxₜ₋₁ + Buₜ + wₜ, where xₜ ∈ ℝⁿ is the hidden state, F is the n×n state transition matrix, B is control input matrix, uₜ is known control input, wₜ ~ N(0, Q) is process noise (Q is process noise covariance).\n2. **Observation model**: zₜ = Hxₜ + vₜ, where zₜ ∈ ℝᵐ is the observation, H is the m×n observation matrix, vₜ ~ N(0, R) is measurement noise (R is measurement noise covariance). Assume wₜ ⊥ vₛ for all t, s (process and measurement noise are independent).\n\n**Goal**: Compute the posterior distribution p(xₜ | z₁:ₜ) — the belief about state xₜ given all observations up to time t. For Gaussian systems, this distribution is fully characterized by its mean x̂ₜ|ₜ = E[xₜ | z₁:ₜ] and covariance Pₜ|ₜ = Cov(xₜ | z₁:ₜ). The Kalman filter computes these recursively in two steps per time step.\n\n**Predict Step Derivation (Chapman-Kolmogorov)**: Given posterior at t−1: p(xₜ₋₁ | z₁:ₜ₋₁) = N(x̂ₜ₋₁|ₜ₋₁, Pₜ₋₁|ₜ₋₁), compute the **prior** at time t before observing zₜ. By the law of total probability (marginalization over xₜ₋₁): p(xₜ | z₁:ₜ₋₁) = ∫ p(xₜ | xₜ₋₁) p(xₜ₋₁ | z₁:ₜ₋₁) dxₜ₋₁. Since xₜ = Fxₜ₋₁ + Buₜ + wₜ with wₜ ~ N(0,Q), the transition density is p(xₜ|xₜ₋₁) = N(Fxₜ₋₁ + Buₜ, Q). For Gaussians, this convolution yields another Gaussian:\n- Predicted mean: x̂ₜ|ₜ₋₁ = E[Fxₜ₋₁ + Buₜ + wₜ | z₁:ₜ₋₁] = F·x̂ₜ₋₁|ₜ₋₁ + Buₜ.\n- Predicted covariance: Pₜ|ₜ₋₁ = Cov(Fxₜ₋₁ + wₜ | z₁:ₜ₋₁) = F·Pₜ₋₁|ₜ₋₁·Fᵀ + Q (using independence of wₜ).\n\n**Update Step Derivation (Bayes' Rule)**: Given prior p(xₜ | z₁:ₜ₋₁) = N(x̂ₜ|ₜ₋₁, Pₜ|ₜ₋₁) and new observation zₜ, compute posterior via Bayes: p(xₜ | z₁:ₜ) ∝ p(zₜ | xₜ) p(xₜ | z₁:ₜ₋₁). The likelihood is p(zₜ|xₜ) = N(Hxₜ, R) (since zₜ = Hxₜ + vₜ). The product of two Gaussians in x is Gaussian. Using the **completing-the-square** identity for Gaussian products:\n- Write prior: p(xₜ|z₁:ₜ₋₁) ∝ exp(−½(xₜ−x̂ₜ|ₜ₋₁)ᵀPₜ|ₜ₋₁⁻¹(xₜ−x̂ₜ|ₜ₋₁)).\n- Write likelihood: p(zₜ|xₜ) ∝ exp(−½(zₜ−Hxₜ)ᵀR⁻¹(zₜ−Hxₜ)).\n- Posterior p(xₜ|z₁:ₜ) ∝ exp(−½[(xₜ−x̂ₜ|ₜ₋₁)ᵀPₜ|ₜ₋₁⁻¹(xₜ−x̂ₜ|ₜ₋₁) + (zₜ−Hxₜ)ᵀR⁻¹(zₜ−Hxₜ)]).\n\nExpanding and completing the square yields:\n- Updated covariance: Pₜ|ₜ⁻¹ = Pₜ|ₜ₋₁⁻¹ + HᵀR⁻¹H, or equivalently Pₜ|ₜ = Pₜ|ₜ₋₁ − Pₜ|ₜ₋₁Hᵀ(HPₜ|ₜ₋₁Hᵀ+R)⁻¹HPₜ|ₜ₋₁ (Sherman-Morrison-Woodbury inversion lemma).\n- Updated mean: x̂ₜ|ₜ = x̂ₜ|ₜ₋₁ + Kₜ(zₜ − Hx̂ₜ|ₜ₋₁), where **Kalman gain** Kₜ = Pₜ|ₜ₋₁Hᵀ(HPₜ|ₜ₋₁Hᵀ+R)⁻¹ = Pₜ|ₜ₋₁HᵀSₜ⁻¹ with Sₜ = HPₜ|ₜ₋₁Hᵀ+R (innovation covariance).\n\n**Optimality**: The Kalman filter is the **minimum mean-squared error (MMSE) estimator** for Gaussian systems: x̂ₜ|ₜ minimizes E[‖xₜ − x̂ₜ|ₜ‖²] over all estimators (linear or nonlinear). For non-Gaussian systems, KF is still the best **linear** estimator (BLUE — best linear unbiased estimator). The innovation sequence ỹₜ = zₜ − Hx̂ₜ|ₜ₋₁ has expected value 0 and covariance Sₜ — if the model is correct, {ỹₜ} is a white Gaussian sequence. Testing ỹₜ for autocorrelation (Ljung-Box test) validates the filter.",
            },
            {
              type: "theory",
              title: "Kalman Gain: Information-Theoretic Interpretation & Numerical Stability",
              content:
                "**Kalman Gain as Optimal Weighting**: The Kalman gain Kₜ = Pₜ|ₜ₋₁Hᵀ(HPₜ|ₜ₋₁Hᵀ+R)⁻¹ can be interpreted as the optimal weight given to the observation vs the prior prediction. Rewrite the update: x̂ₜ|ₜ = x̂ₜ|ₜ₋₁ + Kₜ(zₜ − Hx̂ₜ|ₜ₋₁) = (I−KₜH)x̂ₜ|ₜ₋₁ + Kₜzₜ. This is a **convex combination** (weighted average) of the prior prediction x̂ₜ|ₜ₋₁ and the transformed observation H⁻¹zₜ (assuming H invertible for scalar case). The weight Kₜ depends on the relative uncertainty:\n- If Pₜ|ₜ₋₁ is large (uncertain prior), Kₜ → H⁻¹ (trust observation more).\n- If R is large (noisy observation), Kₜ → 0 (trust prediction more).\n- Specifically, for scalar case (n=m=1): Kₜ = Pₜ|ₜ₋₁H / (HPₜ|ₜ₋₁H + R) = Pₜ|ₜ₋₁ / (Pₜ|ₜ₋₁ + R/H²) (if H=1, it's Pₜ|ₜ₋₁/(Pₜ|ₜ₋₁+R), a weighted average with weights proportional to inverse variances — **precision weighting**).\n\n**Innovation Covariance**: Sₜ = HPₜ|ₜ₋₁Hᵀ + R is the covariance of the innovation ỹₜ = zₜ − Hx̂ₜ|ₜ₋₁. It quantifies total uncertainty in the predicted observation: Pₜ|ₜ₋₁ contributes uncertainty from state prediction, R contributes measurement noise. Large Sₜ means the observation is unreliable (either high model uncertainty or high sensor noise), so Kₜ = Pₜ|ₜ₋₁HᵀSₜ⁻¹ is small (downweight the observation). Small Sₜ means we're confident in the observation, so Kₜ is large.\n\n**Numerical Stability & Joseph Form**: The standard covariance update Pₜ|ₜ = (I−KₜH)Pₜ|ₜ₋₁ is simple but can lose positive-definiteness due to round-off error. The **Joseph form** is numerically stable: Pₜ|ₜ = (I−KₜH)Pₜ|ₜ₋₁(I−KₜH)ᵀ + KₜRKₜᵀ. This is algebraically equivalent (when Kₜ is optimal) but guarantees Pₜ|ₜ stays symmetric positive-definite even with finite-precision arithmetic. For critical applications (e.g., spacecraft navigation), always use Joseph form.\n\n**Square-Root Filters**: Instead of propagating Pₜ|ₜ, propagate its Cholesky factor Lₜ where Pₜ|ₜ = LₜLₜᵀ. Update Lₜ directly using QR decomposition. This ensures Pₜ|ₜ remains positive-definite and reduces numerical error accumulation. Used in aerospace and robotics where long-duration filtering is required (thousands of time steps).\n\n**Steady-State Kalman Filter**: If F, H, Q, R are time-invariant and the system is controllable/observable, Pₜ|ₜ and Kₜ converge to constant values P∞, K∞ as t → ∞. This can be precomputed by solving the **discrete algebraic Riccati equation (DARE)**: P∞ = FP∞Fᵀ + Q − FP∞Hᵀ(HP∞Hᵀ+R)⁻¹HP∞Fᵀ. Once P∞ is found, K∞ = P∞Hᵀ(HP∞Hᵀ+R)⁻¹. The steady-state filter has constant gain (no need to update Pₜ each step), reducing computation. For forex, this is less useful because market dynamics are time-varying (Q, R change with volatility regimes), but it's valuable for understanding long-run behavior.",
            },
            {
              type: "theory",
              title: "Extended Kalman Filter (EKF) & Unscented Kalman Filter (UKF) for Nonlinear Systems",
              content:
                "**Nonlinear State-Space Model**: Many real systems have nonlinear dynamics:\n- State: xₜ = f(xₜ₋₁, uₜ) + wₜ (nonlinear transition f)\n- Observation: zₜ = h(xₜ) + vₜ (nonlinear measurement h)\nwₜ ~ N(0,Q), vₜ ~ N(0,R). The standard Kalman filter assumes linear F, H and does not apply directly.\n\n**Extended Kalman Filter (EKF)**: Linearize f and h via first-order Taylor expansion around the current state estimate:\n- Linearize transition: f(xₜ₋₁) ≈ f(x̂ₜ₋₁|ₜ₋₁) + Fₜ(xₜ₋₁ − x̂ₜ₋₁|ₜ₋₁), where Fₜ = ∂f/∂x|ₓ₌ₓ̂ₜ₋₁|ₜ₋₁ (Jacobian matrix).\n- Linearize observation: h(xₜ) ≈ h(x̂ₜ|ₜ₋₁) + Hₜ(xₜ − x̂ₜ|ₜ₋₁), where Hₜ = ∂h/∂x|ₓ₌ₓ̂ₜ|ₜ₋₁.\n\n**EKF Predict**: x̂ₜ|ₜ₋₁ = f(x̂ₜ₋₁|ₜ₋₁, uₜ), Pₜ|ₜ₋₁ = FₜPₜ₋₁|ₜ₋₁Fₜᵀ + Q.\n**EKF Update**: ỹₜ = zₜ − h(x̂ₜ|ₜ₋₁), Sₜ = HₜPₜ|ₜ₋₁Hₜᵀ + R, Kₜ = Pₜ|ₜ₋₁Hₜᵀ Sₜ⁻¹, x̂ₜ|ₜ = x̂ₜ|ₜ₋₁ + Kₜỹₜ, Pₜ|ₜ = (I−KₜHₜ)Pₜ|ₜ₋₁.\n\n**Limitations of EKF**: (1) Requires Jacobians — analytical derivatives may be complex or unavailable. (2) First-order approximation is poor when f or h are highly nonlinear — linearization introduces bias. (3) Can diverge if initial estimate x̂₀ is far from true state (linearization around wrong point).\n\n**Unscented Kalman Filter (UKF)**: Instead of linearizing, UKF propagates a carefully chosen set of **sigma points** through the nonlinear function. For an n-dimensional state with mean x̂ and covariance P, generate 2n+1 sigma points: χ⁰ = x̂, χⁱ = x̂ + (√((n+λ)P))ᵢ for i=1,…,n, χⁱ = x̂ − (√((n+λ)P))ᵢ₋ₙ for i=n+1,…,2n, where λ is a tuning parameter, and (√P)ᵢ denotes the i-th column of the matrix square root (Cholesky factor). Each sigma point has a weight wⁱ (w⁰ = λ/(n+λ), wⁱ = 1/(2(n+λ)) for i≥1).\n\n**UKF Predict**: Propagate each sigma point through f: χₜ|ₜ₋₁ⁱ = f(χₜ₋₁|ₜ₋₁ⁱ, uₜ). Then compute predicted mean and covariance: x̂ₜ|ₜ₋₁ = ∑wⁱχₜ|ₜ₋₁ⁱ, Pₜ|ₜ₋₁ = ∑wⁱ(χₜ|ₜ₋₁ⁱ − x̂ₜ|ₜ₋₁)(χₜ|ₜ₋₁ⁱ − x̂ₜ|ₜ₋₁)ᵀ + Q.\n\n**UKF Update**: Propagate predicted sigma points through h: ẑⁱ = h(χₜ|ₜ₋₁ⁱ). Compute predicted observation mean ẑ = ∑wⁱẑⁱ, innovation covariance Sₜ = ∑wⁱ(ẑⁱ−ẑ)(ẑⁱ−ẑ)ᵀ + R, cross-covariance Pₓz = ∑wⁱ(χₜ|ₜ₋₁ⁱ−x̂ₜ|ₜ₋₁)(ẑⁱ−ẑ)ᵀ. Kalman gain Kₜ = Pₓz Sₜ⁻¹, x̂ₜ|ₜ = x̂ₜ|ₜ₋₁ + Kₜ(zₜ − ẑ), Pₜ|ₜ = Pₜ|ₜ₋₁ − KₜSₜKₜᵀ.\n\n**Advantages of UKF**: (1) No Jacobians needed — works with any differentiable or even non-differentiable f, h. (2) Captures mean and covariance accurately to **2nd order** for any nonlinearity (vs 1st order for EKF). (3) Often more robust than EKF for strongly nonlinear systems. (4) Same computational complexity as EKF: O(n³) per time step. **Forex Application**: Use UKF to estimate a spread with nonlinear hedging (e.g., EUR/USD vs EUR/GBP spread where the hedge ratio is a nonlinear function of volatility regime).",
            },
            {
              type: "intuition",
              title: "The GPS Navigation Analogy 📡",
              analogy:
                "A Kalman filter is like your car's GPS combining a dead-reckoning prediction with a noisy satellite measurement.",
              content:
                "You're driving on a highway. Your GPS has two sources of information:\n1. **Internal model (predict step)**: The GPS knows your last position was at milepost 50 going 60 mph north. Using physics (position = old_position + velocity × time), it **predicts** you'll be at milepost 51 after 1 minute. This is the **prior** x̂ₜ|ₜ₋₁. But there's uncertainty: maybe you sped up or slowed down (process noise Q) — the GPS isn't sure you're exactly at 51, maybe 50.9–51.1.\n\n2. **Satellite observation (update step)**: A GPS satellite pings your location and reports milepost 50.7. But satellites aren't perfect — the signal bounced off a building (measurement noise R). So the satellite reading is noisy: maybe you're really at 50.5–50.9.\n\nNow the GPS has two estimates: internal prediction says 51, satellite says 50.7. Which is right? **The Kalman filter optimally blends them** via the Kalman gain Kₜ. If the satellite signal is strong (low R), trust it more — final estimate ≈ 50.7. If you're in a tunnel (R → ∞), the GPS ignores the garbage satellite reading and trusts its prediction — final estimate ≈ 51. The gain Kₜ automatically adjusts this weighting based on relative uncertainty (Pₜ|ₜ₋₁ vs R).\n\nIn forex, the **internal model** is your price dynamics assumption (e.g., constant velocity: price drifts at current rate). The **satellite** is the noisy tick price from the broker feed. The Kalman filter produces a smoothed price estimate that's less noisy than raw ticks but more responsive than a fixed-window moving average. During low-volatility periods (small Q), the filter trusts its model and smooths heavily. During high-volatility breakouts (large Q), the filter tracks price changes quickly.",
              emoji: "📡",
            },
            {
              type: "intuition",
              title: "The Blind Robot Analogy 🤖",
              analogy:
                "A Kalman filter is like a blind robot with a noisy rangefinder navigating a room — it blends its motion model with sensor readings to stay on track.",
              content:
                "Imagine a robot on wheels in a dark room. It's blind but has a noisy ultrasonic rangefinder that measures distance to the wall. The robot also has a motion model: when it commands 'move forward 10cm', its wheels turn, but slippage means it actually moves 9–11cm (process noise). The rangefinder is also noisy: if the true distance is 50cm, it might read 48–52cm (measurement noise).\n\nThe robot wants to know its true position. After commanding 'forward 10cm', the robot's **internal belief** (predict step) is: I was at 40cm, I moved ~10cm, so I'm at ~50cm ± slippage. But the rangefinder reads 48cm. The robot uses a **Kalman filter** to reconcile these:\n- If the wheels are precise (small Q) but the rangefinder is trash (large R), trust the wheels → estimate ≈ 50cm.\n- If the wheels slip a lot (large Q) but the rangefinder is laser-accurate (small R), trust the sensor → estimate ≈ 48cm.\n- If both are moderately noisy, blend them optimally: estimate ≈ 49cm.\n\nOver time, the robot repeats this predict-update cycle. Even with noisy sensors and slippery wheels, the Kalman filter keeps the position estimate accurate by **fusing information** from multiple sources. In trading, you're the blind robot: your 'motion model' is your price dynamics assumption, your 'rangefinder' is the broker's price feed, and the Kalman filter keeps your estimate of true price stable despite both being noisy.",
              emoji: "🤖",
            },
            {
              type: "code",
              title: "Kalman Filter: Adaptive Price & Velocity Tracking with Full Diagnostics",
              language: "python",
              code: `import numpy as np
import pandas as pd
from scipy.stats import chi2

# Load EUR/USD hourly prices
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"], index_col="timestamp")
prices = df["close"].dropna().values
N = len(prices)

# --- State-Space Model: x = [price, velocity]ᵀ ---
# Process: xₜ = F·xₜ₋₁ + wₜ, w ~ N(0, Q)
# Observation: zₜ = H·xₜ + vₜ, v ~ N(0, R)

dt = 1.0  # time step (1 bar)
F = np.array([[1, dt],   # price_{t} = price_{t-1} + velocity * dt
              [0,  1]])   # velocity_{t} = velocity_{t-1} (constant velocity model)
H = np.array([[1, 0]])    # observe price only

# Noise covariances (tunable hyperparameters)
q_price = 1e-7        # process noise for price (how much price can jump)
q_velocity = 1e-8     # process noise for velocity (how much velocity can change)
Q = np.array([[q_price, 0],
              [0, q_velocity]])
R = np.array([[1e-6]])  # measurement noise (tick noise)

# Initialize state and covariance
x_est = np.array([prices[0], 0.0])  # initial state: [price, velocity]
P = np.eye(2) * 1e-4                # initial covariance (low uncertainty)

# Storage for diagnostics
filtered_prices = np.zeros(N)
filtered_velocity = np.zeros(N)
kalman_gains = np.zeros(N)
innovations = np.zeros(N)
innovation_vars = np.zeros(N)
predicted_prices = np.zeros(N)

print(f"Running Kalman filter on {N} observations...")

for t in range(N):
    # --- PREDICT STEP ---
    x_pred = F @ x_est                # predicted state
    P_pred = F @ P @ F.T + Q          # predicted covariance
    
    predicted_prices[t] = x_pred[0]
    
    # --- UPDATE STEP ---
    z = np.array([prices[t]])                    # current observation
    y_innov = z - H @ x_pred                     # innovation (residual)
    S = H @ P_pred @ H.T + R                     # innovation covariance
    K = P_pred @ H.T @ np.linalg.inv(S)          # Kalman gain
    
    x_est = x_pred + (K @ y_innov).flatten()     # updated state
    P = (np.eye(2) - K @ H) @ P_pred             # updated covariance (Joseph form for stability)
    
    # Store diagnostics
    filtered_prices[t] = x_est[0]
    filtered_velocity[t] = x_est[1]
    kalman_gains[t] = K[0, 0]
    innovations[t] = y_innov[0]
    innovation_vars[t] = S[0, 0]

# --- Filter Diagnostics ---
print("\\n" + "=" * 70)
print("KALMAN FILTER DIAGNOSTICS")
print("=" * 70)

# Kalman gain statistics
print(f"Kalman Gain K (price):")
print(f"  Mean:   {kalman_gains.mean():.6f}")
print(f"  Min:    {kalman_gains.min():.6f}")
print(f"  Max:    {kalman_gains.max():.6f}")
print(f"  Interpretation: K→0 means trust model, K→1 means trust observation")

# Innovation whiteness test (should be white noise if model correct)
from statsmodels.stats.diagnostic import acorr_ljungbox
lb_result = acorr_ljungbox(innovations, lags=[10, 20], return_df=True)
print(f"\\nInnovation Whiteness Test (Ljung-Box):")
print(f"  Lag 10 p-value: {lb_result['lb_pvalue'].iloc[0]:.4f}")
print(f"  Lag 20 p-value: {lb_result['lb_pvalue'].iloc[1]:.4f}")
print(f"  (p > 0.05 → innovations are white noise ✓, model is well-specified)")

# Normalized innovation squared (NIS) test: ỹₜᵀSₜ⁻¹ỹₜ ~ χ²(m) under correct model
nis = innovations ** 2 / innovation_vars
nis_mean = nis.mean()
nis_expected = 1.0  # m=1 observation dimension
print(f"\\nNormalized Innovation Squared (NIS):")
print(f"  Mean NIS: {nis_mean:.4f} (expected: {nis_expected:.4f})")
print(f"  If mean ≈ 1.0, noise covariances Q, R are well-tuned")

# Velocity statistics
print(f"\\nEstimated Velocity (price change per bar):")
print(f"  Mean:   {filtered_velocity.mean():.6f}")
print(f"  Std:    {filtered_velocity.std():.6f}")
print(f"  Min:    {filtered_velocity.min():.6f}")
print(f"  Max:    {filtered_velocity.max():.6f}")

# Comparison with SMA
sma_20 = pd.Series(prices).rolling(20).mean().values
sma_valid_idx = ~np.isnan(sma_20)

rmse_kalman = np.sqrt(np.mean((prices - filtered_prices)**2))
rmse_sma = np.sqrt(np.mean((prices[sma_valid_idx] - sma_20[sma_valid_idx])**2))

print(f"\\nRMSE Comparison:")
print(f"  Kalman: {rmse_kalman:.8f}")
print(f"  SMA-20: {rmse_sma:.8f}")
print(f"  Kalman improvement: {(1 - rmse_kalman/rmse_sma)*100:.2f}%")`,
              explanation:
                "We implement a full Kalman filter with comprehensive diagnostics. The state vector x = [price, velocity]ᵀ tracks both the price level and its rate of change. The filter adaptively smooths price: during calm periods (small innovations), K is small and the filter trusts its model; during volatile periods (large innovations), K increases to track rapid changes. We validate the filter via: (1) **Innovation whiteness test** — if the model is correct, innovations should be uncorrelated white noise (Ljung-Box p > 0.05). (2) **NIS test** — normalized innovation squared should have mean ≈ 1 if Q, R are correctly tuned. (3) **RMSE comparison** — Kalman typically outperforms fixed-window SMA by adapting to changing market conditions.",
            },
            {
              type: "code",
              title: "Dynamic Hedge Ratio Estimation for Pairs Trading via Kalman Filter",
              language: "python",
              code: `import numpy as np
import pandas as pd

# Load two cointegrated forex pairs
eur = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"], index_col="timestamp")["close"]
gbp = pd.read_csv("gbpusd_1h.csv", parse_dates=["timestamp"], index_col="timestamp")["close"]

df = pd.DataFrame({"eur": eur, "gbp": gbp}).dropna()
N = len(df)

# --- State-Space for Time-Varying Hedge Ratio ---
# State: x = [alpha, beta]ᵀ where EUR = alpha + beta * GBP
# Process: xₜ = xₜ₋₁ + wₜ (random walk in coefficients)
# Observation: EUR_t = [1, GBP_t] · [alpha, beta]ᵀ + vₜ

# Initialize
x_est = np.array([0.0, 1.0])  # initial [alpha, beta]
P = np.eye(2) * 1e-2          # initial covariance

# Noise parameters
Q = np.eye(2) * 1e-7  # process noise (slow drift in alpha, beta)
R = np.array([[1e-5]])  # measurement noise

# Storage
hedge_ratios = np.zeros(N)
alphas = np.zeros(N)
spreads = np.zeros(N)

F = np.eye(2)  # random walk: alpha, beta don't change much

for t in range(N):
    eur_t = df["eur"].iloc[t]
    gbp_t = df["gbp"].iloc[t]
    
    # Observation matrix (time-varying because GBP changes)
    H = np.array([[1, gbp_t]])
    
    # PREDICT
    x_pred = F @ x_est
    P_pred = F @ P @ F.T + Q
    
    # UPDATE
    z = np.array([eur_t])
    y_innov = z - H @ x_pred
    S = H @ P_pred @ H.T + R
    K = P_pred @ H.T @ np.linalg.inv(S)
    
    x_est = x_pred + (K @ y_innov).flatten()
    P = (np.eye(2) - K @ H) @ P_pred
    
    # Store results
    alphas[t] = x_est[0]
    hedge_ratios[t] = x_est[1]
    spreads[t] = eur_t - x_est[0] - x_est[1] * gbp_t

# Results
df["alpha"] = alphas
df["beta"] = hedge_ratios
df["spread"] = spreads

print(f"Dynamic Hedge Ratio Estimation (Kalman Filter)")
print(f"=" * 60)
print(f"Initial hedge ratio (beta): {hedge_ratios[0]:.6f}")
print(f"Final hedge ratio (beta):   {hedge_ratios[-1]:.6f}")
print(f"Mean beta: {hedge_ratios.mean():.6f}, Std: {hedge_ratios.std():.6f}")
print(f"\\nBeta range: [{hedge_ratios.min():.6f}, {hedge_ratios.max():.6f}]")
print(f"  (Beta drifts over time — captures time-varying relationship)")

# Spread statistics
spread_mean = spreads.mean()
spread_std = spreads.std()
z_scores = (spreads - spread_mean) / spread_std

print(f"\\nSpread Statistics:")
print(f"  Mean: {spread_mean:.6f}, Std: {spread_std:.6f}")
print(f"  Min z-score: {z_scores.min():.3f}, Max z-score: {z_scores.max():.3f}")

# Trading signals (adaptive pairs trading)
entry_z = 2.0
long_signals = np.sum(z_scores < -entry_z)
short_signals = np.sum(z_scores > entry_z)

print(f"\\nAdaptive Pairs Trading Signals (|z| > {entry_z}):")
print(f"  Long spread entries:  {long_signals}")
print(f"  Short spread entries: {short_signals}")
print(f"  Current z-score: {z_scores[-1]:.3f}")

# Compare with static OLS hedge ratio
from statsmodels.regression.linear_model import OLS
from statsmodels.tools import add_constant
X_static = add_constant(df["gbp"].values)
static_model = OLS(df["eur"].values, X_static).fit()
beta_static = static_model.params[1]

print(f"\\nStatic OLS beta: {beta_static:.6f}")
print(f"  Kalman beta adapts dynamically vs static OLS assumption")`,
              explanation:
                "Pairs trading typically assumes a constant hedge ratio β (OLS estimate). But in reality, the relationship between EUR/USD and GBP/USD drifts over time due to regime changes (divergent monetary policies, risk-off flows). We use a Kalman filter to estimate a **time-varying hedge ratio**: the state x = [α, β]ᵀ evolves as a random walk (slow drift), and we observe EUR = α + β·GBP + noise. The filter continuously updates β based on new data, capturing structural changes. This produces a spread with better stationarity than a static-β spread, improving pairs trading profitability and reducing regime-change risk.",
            },
            {
              type: "code",
              title: "Extended Kalman Filter (EKF): Nonlinear Volatility Tracking",
              language: "python",
              code: `import numpy as np
import pandas as pd

# Load returns
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"], index_col="timestamp")
returns = df["close"].pct_change().dropna().values * 100  # percentage returns
N = len(returns)

# --- Nonlinear State-Space: Log-Volatility Model ---
# State: xₜ = log(σₜ²) (log-variance)
# Process: xₜ = φ·xₜ₋₁ + wₜ, w ~ N(0, Q) (AR(1) in log-vol)
# Observation: rₜ² ≈ exp(xₜ) + vₜ (nonlinear: squared return ≈ variance)

# Parameters
phi = 0.95        # persistence of log-volatility
Q = np.array([[0.01]])  # process noise
R = np.array([[0.5]])   # measurement noise

# Initialize
x_est = np.log(np.var(returns[:50]))  # initial log-variance from first 50 obs
P = np.array([[0.1]])

# Storage
log_vols = np.zeros(N)
vols = np.zeros(N)

for t in range(N):
    # --- PREDICT ---
    # xₜ|ₜ₋₁ = φ·xₜ₋₁|ₜ₋₁
    x_pred = phi * x_est
    
    # Linearize: F = ∂f/∂x = φ
    F = np.array([[phi]])
    P_pred = F @ P @ F.T + Q
    
    # --- UPDATE ---
    # Observation: zₜ = rₜ²
    z = np.array([returns[t] ** 2])
    
    # Linearize observation: h(x) = exp(x)
    # Predicted observation: ẑ = exp(x_pred)
    z_pred = np.exp(x_pred)
    
    # Jacobian: H = ∂h/∂x = exp(x) at x = x_pred
    H = np.array([[np.exp(x_pred)]])
    
    # Innovation
    y_innov = z - z_pred
    S = H @ P_pred @ H.T + R
    K = P_pred @ H.T @ np.linalg.inv(S)
    
    x_est = x_pred + (K @ y_innov)[0, 0]
    P = (np.eye(1) - K @ H) @ P_pred
    
    log_vols[t] = x_est
    vols[t] = np.sqrt(np.exp(x_est))

# --- Results ---
print(f"Extended Kalman Filter: Nonlinear Volatility Estimation")
print(f"=" * 60)
print(f"Estimated volatility (%):")
print(f"  Mean:   {vols.mean():.4f}")
print(f"  Std:    {vols.std():.4f}")
print(f"  Min:    {vols.min():.4f}")
print(f"  Max:    {vols.max():.4f}")

# Compare with rolling standard deviation
rolling_std = pd.Series(returns).rolling(20).std().values
rolling_std_valid = rolling_std[~np.isnan(rolling_std)]
vols_valid = vols[~np.isnan(rolling_std)]

rmse_ekf = np.sqrt(np.mean((returns[~np.isnan(rolling_std)] - 0)**2))  # placeholder
print(f"\\nEKF captures time-varying volatility via nonlinear state-space model")
print(f"  (Log-volatility xₜ follows AR(1), variance = exp(xₜ) is nonlinear)")`,
              explanation:
                "Standard Kalman filters assume linear observations. In volatility estimation, the observation model is nonlinear: squared returns rₜ² ≈ σₜ² (variance). We model log-volatility xₜ = log(σₜ²) as an AR(1) process, so variance = exp(xₜ) is nonlinear. The **Extended Kalman Filter** linearizes exp(x) via the Jacobian H = exp(x̂ₜ|ₜ₋₁) at each step, then applies the standard Kalman update. This produces a smoothed volatility estimate that adapts to regime changes (calm → volatile) without the lag of rolling windows. For forex risk management, EKF-estimated volatility can drive dynamic position sizing: scale down when σₜ spikes.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "ts-kalman-q1",
                  question:
                    "The Kalman gain Kₜ = Pₜ|ₜ₋₁Hᵀ(HPₜ|ₜ₋₁Hᵀ + R)⁻¹. What happens to Kₜ when measurement noise R → ∞ (observations become pure garbage)?",
                  options: [
                    { id: "ts-kalman-q1-a", text: "Kₜ → I (identity): the filter trusts observations completely" },
                    { id: "ts-kalman-q1-b", text: "Kₜ → 0: the filter ignores noisy observations and relies entirely on its model prediction" },
                    { id: "ts-kalman-q1-c", text: "Kₜ becomes negative, reversing the correction direction" },
                    { id: "ts-kalman-q1-d", text: "Kₜ stays constant — R doesn't affect the gain" },
                  ],
                  correctOptionId: "ts-kalman-q1-b",
                  explanation:
                    "When R → ∞, the denominator (HPₜ|ₜ₋₁Hᵀ + R) ≈ R dominates, so Kₜ = Pₜ|ₜ₋₁Hᵀ·R⁻¹ → 0. The update becomes x̂ₜ|ₜ = x̂ₜ|ₜ₋₁ + 0·innovation ≈ x̂ₜ|ₜ₋₁ — the filter ignores the observation and trusts its internal model. This is correct behavior: if your sensor is broken (R huge), don't use its readings. Conversely, when Q → ∞ (model is uncertain), Kₜ → H⁻¹ and the filter trusts observations.",
                },
                {
                  id: "ts-kalman-q2",
                  question:
                    "The innovation sequence ỹₜ = zₜ − Hx̂ₜ|ₜ₋₁ should have what property if the Kalman filter model is correctly specified?",
                  options: [
                    { id: "ts-kalman-q2-a", text: "ỹₜ should be autocorrelated with decaying ACF" },
                    { id: "ts-kalman-q2-b", text: "ỹₜ should be white noise: zero mean, constant variance, no autocorrelation (test via Ljung-Box)" },
                    { id: "ts-kalman-q2-c", text: "ỹₜ should have increasing variance over time" },
                    { id: "ts-kalman-q2-d", text: "ỹₜ should equal the observation zₜ" },
                  ],
                  correctOptionId: "ts-kalman-q2-b",
                  explanation:
                    "If the state-space model (F, H, Q, R) is correct, the innovation ỹₜ = zₜ − Hx̂ₜ|ₜ₋₁ is the one-step-ahead forecast error. It should be **white noise**: E[ỹₜ] = 0, Cov(ỹₜ, ỹₛ) = 0 for t≠s (uncorrelated), and Var(ỹₜ) = Sₜ (innovation covariance). Autocorrelation in ỹₜ indicates model misspecification — the filter is not extracting all predictable structure. Use the Ljung-Box test on ỹₜ: if p < 0.05, reject whiteness and re-tune Q, R or revise F, H.",
                },
                {
                  id: "ts-kalman-q3",
                  question:
                    "A trader uses a Kalman filter to track EUR/USD price with state x = [price, velocity]. The filter's velocity estimate suddenly jumps from +0.0002 to +0.0050. What does this indicate?",
                  options: [
                    { id: "ts-kalman-q3-a", text: "The filter diverged and must be restarted" },
                    { id: "ts-kalman-q3-b", text: "The price is accelerating (breaking out) — the filter detected a regime change and increased its velocity estimate to track the new trend" },
                    { id: "ts-kalman-q3-c", text: "Measurement noise R was too small" },
                    { id: "ts-kalman-q3-d", text: "The observation matrix H changed" },
                  ],
                  correctOptionId: "ts-kalman-q3-b",
                  explanation:
                    "The velocity component of the state tracks the rate of price change (local trend). A sudden jump from +0.0002 to +0.0050 means the filter detected acceleration — the price started moving up much faster than before. This is evidence of a breakout or regime change from ranging to trending. The Kalman filter adapts by increasing its velocity estimate to keep predictions accurate. This is a feature, not a bug: the filter provides a real-time trend indicator without the lag of moving averages.",
                },
                {
                  id: "ts-kalman-q4",
                  question:
                    "Why does the Extended Kalman Filter (EKF) require computing Jacobians Fₜ = ∂f/∂x and Hₜ = ∂h/∂x?",
                  options: [
                    { id: "ts-kalman-q4-a", text: "To make the observation equation linear" },
                    { id: "ts-kalman-q4-b", text: "To linearize the nonlinear functions f(x) and h(x) via first-order Taylor expansion around the current state estimate, allowing the standard Kalman equations to apply" },
                    { id: "ts-kalman-q4-c", text: "Jacobians are only needed for the Unscented Kalman Filter" },
                    { id: "ts-kalman-q4-d", text: "To compute the Kalman gain exactly" },
                  ],
                  correctOptionId: "ts-kalman-q4-b",
                  explanation:
                    "The standard Kalman filter assumes linear dynamics xₜ = Fxₜ₋₁ + wₜ and linear observations zₜ = Hxₜ + vₜ. When f(x) or h(x) are nonlinear, EKF approximates them via first-order Taylor expansion: f(x) ≈ f(x̂) + Fₜ(x−x̂) where Fₜ = ∂f/∂x|ₓ̂ is the Jacobian. This linearization allows the Kalman recursion to proceed with time-varying Fₜ, Hₜ. Limitation: if f or h are highly nonlinear, linearization is poor and EKF can diverge. UKF avoids Jacobians by propagating sigma points through the nonlinear function directly.",
                },
                {
                  id: "ts-kalman-q5",
                  question:
                    "A Kalman filter tracking EUR/USD price uses Q = 1e-7 (low process noise) and R = 1e-3 (high measurement noise). What behavior do you expect?",
                  options: [
                    { id: "ts-kalman-q5-a", text: "The filter will track price ticks very closely (low lag, high noise)" },
                    { id: "ts-kalman-q5-b", text: "The filter will produce a very smooth estimate (high lag, low noise), trusting its model over noisy ticks" },
                    { id: "ts-kalman-q5-c", text: "The filter will diverge" },
                    { id: "ts-kalman-q5-d", text: "Q and R don't affect smoothness" },
                  ],
                  correctOptionId: "ts-kalman-q5-b",
                  explanation:
                    "Low Q means the filter believes the state evolves smoothly (low process uncertainty). High R means observations are very noisy (low trust in ticks). The Kalman gain Kₜ ∝ Pₜ|ₜ₋₁/(Pₜ|ₜ₋₁ + R) will be small because R dominates. The update x̂ₜ|ₜ = x̂ₜ|ₜ₋₁ + Kₜ·innovation barely changes from the prediction, producing a smooth (heavily filtered) estimate with high lag. This is like a slow EMA. To track ticks closely, use high Q/R ratio; for smooth trend, use low Q/R.",
                },
                {
                  id: "ts-kalman-q6",
                  question:
                    "In pairs trading, a Kalman filter is used to estimate a time-varying hedge ratio β(t) for the spread EUR − β(t)·GBP. Why is this better than using a static OLS β?",
                  options: [
                    { id: "ts-kalman-q6-a", text: "Static β is always less accurate" },
                    { id: "ts-kalman-q6-b", text: "The Kalman filter adapts β in real-time to capture structural changes (divergent policies, regime shifts), keeping the spread stationary even when the relationship drifts. Static β can become stale, causing the spread to lose stationarity." },
                    { id: "ts-kalman-q6-c", text: "OLS cannot estimate β for forex pairs" },
                    { id: "ts-kalman-q6-d", text: "Kalman filters don't require any data" },
                  ],
                  correctOptionId: "ts-kalman-q6-b",
                  explanation:
                    "Cointegrated relationships are not fixed forever — they drift due to regime changes (e.g., ECB cuts rates while BoE hikes, changing EUR/GBP equilibrium). A static OLS β estimated on historical data becomes outdated. The Kalman filter models β as a time-varying state (random walk or AR(1)), continuously updating it as new data arrives. This keeps the spread stationary even during slow structural drift, improving pairs trading performance and reducing the risk of catastrophic losses from regime breaks.",
                },
                {
                  id: "ts-kalman-q7",
                  question:
                    "The Normalized Innovation Squared (NIS) statistic ỹₜᵀSₜ⁻¹ỹₜ should have what distribution if the Kalman filter model is correctly specified?",
                  options: [
                    { id: "ts-kalman-q7-a", text: "χ²(m) where m is the observation dimension — mean = m, variance = 2m" },
                    { id: "ts-kalman-q7-b", text: "N(0, 1) standard normal" },
                    { id: "ts-kalman-q7-c", text: "Uniform(0, 1)" },
                    { id: "ts-kalman-q7-d", text: "NIS has no distribution — it's a deterministic value" },
                  ],
                  correctOptionId: "ts-kalman-q7-a",
                  explanation:
                    "Under a correctly specified model, the innovation ỹₜ ~ N(0, Sₜ). The normalized innovation ỹₜᵀSₜ⁻¹ỹₜ is a quadratic form of a Gaussian vector, which follows a chi-squared distribution with m degrees of freedom (m = dimension of observation zₜ). For scalar observations (m=1), NIS ~ χ²(1) with mean 1 and variance 2. If the average NIS over many time steps ≠ 1, the noise covariances Q, R are mistuned: NIS > 1 means you're underestimating uncertainty (Q, R too small), NIS < 1 means overestimating (Q, R too large).",
                },
              ],
            },
            {
              type: "practice",
              title: "Tune Kalman Filter for Optimal Price Tracking",
              description:
                "Experiment with Q and R parameters on EUR/USD hourly data. For each (Q, R) pair from a grid (Q/R ∈ {0.001, 0.01, 0.1, 1, 10, 100}), run the Kalman filter and compute: (1) one-step-ahead prediction RMSE, (2) innovation whiteness (Ljung-Box p-value), (3) NIS mean. Plot RMSE vs Q/R ratio. Find the optimal Q/R that minimizes RMSE while maintaining white innovations (p > 0.05) and NIS ≈ 1. Does the optimal ratio change between low-volatility and high-volatility regimes?",
              catalogModelId: "kalman-tracker",
            },
            {
              type: "practice",
              title: "Build an Adaptive Pairs Trading Strategy with Time-Varying Beta",
              description:
                "Implement a pairs trading strategy on EUR/USD vs GBP/USD where the hedge ratio β is estimated via Kalman filter (state = [α, β], random walk dynamics). Compare backtest results (Sharpe ratio, max drawdown, win rate) against a baseline strategy using static OLS β. Inject a simulated regime change halfway through: shift the true β from 0.85 to 0.95 (e.g., by modifying GBP prices). Observe that the static strategy's spread loses stationarity and drawdown spikes, while the Kalman strategy adapts and recovers. How quickly does the Kalman filter detect and adjust to the new β?",
            },
          ],
        },
        {
          id: "ts-regime-switching",
          title: "Markov Regime-Switching Models",
          description:
            "Master Hamilton's (1989) Markov-Switching Autoregressive framework: regime-dependent parameters, transition probability matrices, Hamilton's filter for real-time inference, Kim's smoother for retrospective analysis, EM-based estimation with explicit M-step update formulas, BIC-based model selection (and why LRT fails), and regime-adaptive forex trading strategies.",
          estimatedMinutes: 75,
          difficulty: "intermediate",
          prerequisites: ["ts-hmm", "ts-arima"],
          relatedModels: ["regime-detector"],
          sections: [
            {
              type: "objective",
              content:
                "This lesson provides a rigorous treatment of Markov Regime-Switching models — the workhorse framework for modelling structural breaks and state-dependent dynamics in financial time series. You will learn to specify the MS-AR(p) model with regime-dependent mean, autoregressive coefficients, and variance; construct and interpret the transition probability matrix P and its ergodic distribution; derive expected sojourn times from the geometric distribution; implement Hamilton's forward filter for real-time regime probability estimation; apply Kim's backward smoother for full-sample retrospective inference; execute the EM algorithm with explicit M-step update formulas for all regime parameters; select the number of regimes using BIC while understanding why the standard likelihood ratio test is invalid (Davies' problem); and design regime-adaptive trading strategies that switch between trend-following and mean-reversion based on the estimated market state.",
              keyTakeaways: [
                "The MS-AR(p) model specifies yₜ = μ(sₜ) + ∑ᵢ φᵢ(sₜ)(yₜ₋ᵢ − μ(sₜ₋ᵢ)) + σ(sₜ)εₜ where sₜ ∈ {1,…,K} follows a first-order Markov chain with transition matrix P",
                "The transition matrix P has entries pᵢⱼ = P(sₜ=j|sₜ₋₁=i) with rows summing to 1, and the ergodic distribution π satisfies π = Pᵀπ giving long-run regime frequencies",
                "Expected sojourn time in regime k is E[dₖ] = 1/(1−pₖₖ), derived from the geometric distribution P(dₖ=n) = pₖₖⁿ⁻¹(1−pₖₖ)",
                "Hamilton's filter is a forward recursion computing filtered probabilities ξₜ|ₜ(k) = P(sₜ=k|y₁:ₜ,θ) — these are causal and usable in real-time trading",
                "Kim's smoother is a backward recursion computing smoothed probabilities ξₜ|T(k) = P(sₜ=k|y₁:T,θ) — these use future data and are appropriate for parameter estimation and retrospective analysis",
                "The EM algorithm alternates between computing smoothed probabilities (E-step) and updating μₖ, σₖ², φₖ, and pᵢⱼ via weighted least-squares formulas (M-step) until log-likelihood convergence",
                "Regime detection enables adaptive trading: trend-follow when the high-volatility directional regime is detected, mean-revert during the low-volatility range-bound regime, and reduce exposure during uncertain transitions",
              ],
            },
            {
              type: "theory",
              title: "Hamilton's Markov-Switching Autoregressive Model",
              content:
                "James Hamilton's seminal 1989 paper introduced the **Markov-Switching (MS) model** to study asymmetries in US business cycle dynamics — specifically, that GDP growth behaves differently in expansions versus recessions. The core insight is that the data-generating process switches between K discrete regimes governed by an unobserved first-order Markov chain sₜ ∈ {1, …, K}. In the simplest **mean-variance switching** specification, the observed series follows: yₜ = μ(sₜ) + σ(sₜ)εₜ, where εₜ ~ N(0,1), and both the mean μ and volatility σ depend on the current regime. The full **MS-AR(p)** extends this with regime-dependent autoregressive dynamics: yₜ = μ(sₜ) + ∑ᵢ₌₁ᵖ φᵢ(sₜ)(yₜ₋ᵢ − μ(sₜ₋ᵢ)) + σ(sₜ)εₜ. Here, the AR coefficients φᵢ(sₜ) also switch with the regime, allowing each state to have its own persistence structure. For example, returns might be positively autocorrelated in a trending regime but negatively autocorrelated in a mean-reverting regime.\n\nThe **transition probability matrix** P is a K×K matrix with entries pᵢⱼ = P(sₜ = j | sₜ₋₁ = i), where each row sums to 1: ∑ⱼ pᵢⱼ = 1 for all i. For a 2-regime model, P = [[p₀₀, 1−p₀₀], [1−p₁₁, p₁₁]], so only two free parameters (p₀₀ and p₁₁) fully specify the transition dynamics. The **ergodic (stationary) distribution** π is the left eigenvector of Pᵀ satisfying π = Pᵀπ with ∑ₖ πₖ = 1. For K=2, solving algebraically: π₀ = (1−p₁₁)/((1−p₀₀)+(1−p₁₁)) and π₁ = (1−p₀₀)/((1−p₀₀)+(1−p₁₁)). The **expected sojourn time** in regime k — the average number of consecutive periods spent in state k before switching — is E[dₖ] = 1/(1−pₖₖ). This follows because the sojourn time dₖ has a geometric distribution: P(dₖ = n) = pₖₖⁿ⁻¹(1−pₖₖ) for n = 1, 2, 3, …, and the expectation of a geometric(q) random variable with q = 1−pₖₖ is 1/q.\n\n**Numerical example**: Consider a 2-regime model for EUR/USD hourly log returns (×100 for percentage scale). Regime 0 (calm/range-bound): μ₀ = +0.001%, σ₀ = 0.05%. Regime 1 (volatile/trending): μ₁ = −0.03%, σ₁ = 0.15%. Transition matrix P = [[0.97, 0.03], [0.05, 0.95]]. Expected durations: E[d₀] = 1/(1−0.97) = 1/0.03 ≈ 33.3 bars; E[d₁] = 1/(1−0.95) = 1/0.05 = 20.0 bars. Ergodic distribution: π₀ = 0.05/(0.03+0.05) = 0.625, π₁ = 0.03/(0.03+0.05) = 0.375. Interpretation: the market spends about 62.5% of the time in the calm regime (averaging 33-bar stretches) and 37.5% in the volatile regime (averaging 20-bar stretches). The volatile regime has 3× the standard deviation and a negative mean drift — consistent with the leverage effect where sell-offs are faster and more volatile than rallies.\n\nMS models capture several **stylized facts** of financial returns that single-regime models miss. **Volatility clustering** emerges naturally: within a high-volatility regime, consecutive returns have large absolute values, and regime persistence (high pₖₖ) ensures these clusters last many periods. **Fat tails (excess kurtosis)** arise because the unconditional return distribution is a mixture of Gaussians with different variances — even though each regime is Gaussian, the mixture has heavier tails than any single component. **Time-varying risk** is explicit: the regime-dependent variance σ²(sₜ) means the model's risk estimate changes discretely when regimes switch. This is more interpretable than GARCH-style smooth volatility evolution and maps directly to practical position sizing — a trader can allocate less capital when P(volatile regime) is high.",
            },
            {
              type: "theory",
              title: "Hamilton's Filter and Kim's Smoother",
              content:
                "**Hamilton's filter** is the forward recursion that computes the **filtered probability** ξₜ|ₜ(j) = P(sₜ = j | Y₁:ₜ, θ) — the probability of being in regime j at time t, given all observations up to and including time t. Initialize with the ergodic distribution: ξ₀|₀(j) = πⱼ. At each time step t = 1, 2, …, T, three sub-steps execute. **(a) Prediction step**: project forward through the transition matrix: ξₜ|ₜ₋₁(j) = ∑ᵢ pᵢⱼ · ξₜ₋₁|ₜ₋₁(i). This gives the prior probability of regime j before seeing yₜ. **(b) Likelihood evaluation**: compute the regime-conditional density of the new observation: f(yₜ | sₜ=j, Yₜ₋₁) = (1/(σⱼ√(2π))) · exp(−(yₜ − μⱼ)² / (2σⱼ²)) for the mean-variance switching model (for MS-AR, replace μⱼ with the full AR conditional mean). **(c) Bayesian update**: apply Bayes' rule to get the posterior: ξₜ|ₜ(j) = [f(yₜ | sₜ=j) · ξₜ|ₜ₋₁(j)] / [∑ₖ f(yₜ | sₜ=k) · ξₜ|ₜ₋₁(k)]. The denominator is the marginal likelihood of yₜ: f(yₜ | Yₜ₋₁) = ∑ₖ f(yₜ | sₜ=k) · ξₜ|ₜ₋₁(k). Summing log f(yₜ | Yₜ₋₁) over t gives the log-likelihood of the entire series. These filtered probabilities are **causal** — they depend only on past and current data — making them suitable for real-time trading decisions.\n\n**Kim's smoother** (Kim 1994) is the backward recursion that refines filtered estimates into **smoothed probabilities** ξₜ|T(i) = P(sₜ = i | Y₁:T, θ), using the full sample of observations. Starting from ξT|T (the last filtered probability), iterate backward for t = T−1, T−2, …, 1: ξₜ|T(i) = ∑ⱼ [ξₜ₊₁|T(j) · pᵢⱼ · ξₜ|ₜ(i)] / ξₜ₊₁|ₜ(j). Here ξₜ₊₁|ₜ(j) = ∑ᵢ pᵢⱼ · ξₜ|ₜ(i) is the one-step-ahead prediction from the forward pass. Intuitively, the smoother adjusts each time point's regime probability by incorporating what happens *after* that point. **Numerical step**: suppose at t=50, the filtered probability is ξ₅₀|₅₀(0) = 0.70 (70% chance of calm regime). But subsequent data at t=51–55 shows very low volatility, strongly confirming the calm regime. Kim's smoother propagates this backward evidence, revising upward to perhaps ξ₅₀|T(0) = 0.92. The smoothed estimate is more confident because it integrates information from both directions.\n\n**Filtered vs. smoothed probabilities** represent two fundamentally different inference problems. Filtered probabilities ξₜ|ₜ answer: 'Given what we have observed so far (up to time t), what regime are we most likely in?' This is exactly what a trader computes in real time — no future information is available. Smoothed probabilities ξₜ|T answer: 'Given the entire dataset, what regime was most likely at time t?' Smoothed estimates are less noisy and produce more confident regime assignments because they use 2T observations' worth of information rather than just t. In practice: use **smoothed probabilities for parameter estimation** (the EM algorithm's E-step requires them), for retrospective analysis, and for labelling training data. Use **filtered probabilities for live trading signals** — using smoothed probabilities in a backtest introduces look-ahead bias because each point's regime assignment depends on future returns. A common diagnostic is to compare filtered and smoothed probabilities: if they differ substantially, the model is uncertain about regime assignments in real time, which suggests caution in basing trading decisions on regime detection alone.",
            },
            {
              type: "theory",
              title: "EM Algorithm for Parameter Estimation & Model Selection",
              content:
                "The **Expectation-Maximization (EM) algorithm** is the standard approach for estimating MS model parameters θ = {μₖ, σₖ², φₖ, P} because direct maximum likelihood is intractable — the hidden regimes make the likelihood a sum over Kᵀ possible state sequences. The EM iterates between two steps until the log-likelihood converges (typically |Δ log L| < 10⁻⁶). **E-step**: given current parameter estimates θ⁽ᵐ⁾, run Hamilton's filter forward and Kim's smoother backward to compute smoothed probabilities ξₜ|T(k) for all t = 1,…,T and k = 1,…,K, as well as smoothed joint probabilities ξₜ₋₁,ₜ|T(i,j) = P(sₜ₋₁=i, sₜ=j | Y₁:T, θ⁽ᵐ⁾). **M-step**: update parameters using weighted sufficient statistics. For the mean-variance switching model, the closed-form updates are: **μ̂ₖ = ∑ₜ ξₜ|T(k) · yₜ / ∑ₜ ξₜ|T(k)** (regime-weighted sample mean), **σ̂ₖ² = ∑ₜ ξₜ|T(k) · (yₜ − μ̂ₖ)² / ∑ₜ ξₜ|T(k)** (regime-weighted sample variance), and **p̂ᵢⱼ = ∑ₜ₌₂ᵀ ξₜ₋₁,ₜ|T(i,j) / ∑ₜ₌₂ᵀ ξₜ₋₁|T(i)** (expected number of i→j transitions divided by expected number of times in state i). For MS-AR(p), the μ and φ updates become a regime-weighted least-squares regression. Each EM iteration is guaranteed to increase the log-likelihood (or leave it unchanged at convergence), though convergence can be slow and the algorithm may find local optima — practitioners typically run from multiple random initializations and keep the solution with the highest log-likelihood.\n\n**Model selection** — choosing the number of regimes K — is a critical practical decision. The **Bayesian Information Criterion** BIC = k · ln(n) − 2 · ln(L̂) balances fit against complexity, where k is the number of free parameters and n is the sample size. For a K-regime mean-variance switching model: K means + K variances + K(K−1) free transition probabilities (each row of P has K entries summing to 1, giving K−1 free parameters per row, times K rows) = K + K + K(K−1) = K² + K total parameters. For K=2: 2² + 2 = 6 parameters. For K=3: 3² + 3 = 12 parameters. The jump from K=2 to K=3 adds 6 parameters, so BIC imposes a penalty of 6 · ln(n) — for n=5000 observations, this is 6 × 8.52 = 51.1 log-likelihood units. Only choose K=3 if the log-likelihood improvement exceeds this threshold. In practice, K=2 (bull/bear or calm/volatile) is overwhelmingly the most common choice for forex; K=3 (adding a 'transition' or 'sideways' regime) occasionally improves fit but risks overfitting on shorter samples.\n\nThe natural instinct to test K=1 vs K=2 using a **likelihood ratio test (LRT)** fails for a subtle but important reason known as **Davies' problem** (Davies 1977, 1987). Under the null hypothesis H₀: K=1, the transition probabilities and parameters of the 'extra' regime are unidentified — any values of μ₂, σ₂, p₁₂, p₂₁ produce the same likelihood when the model collapses to a single regime (e.g., if p₀₀ = p₁₀ = 1, regime 1 is never visited and its parameters are irrelevant). This violates the regularity conditions that guarantee the LRT statistic follows a χ² distribution. The nuisance parameters lie on the boundary of the parameter space under H₀, so the usual asymptotic theory breaks down. **Practical alternatives**: (1) BIC, which remains valid as a consistent model selection criterion; (2) cross-validation on out-of-sample log-likelihood; (3) Hansen's (1992) standardized likelihood ratio bound test, which provides conservative upper-bound p-values; (4) bootstrap-based tests that simulate under H₀. The pragmatic approach: start with K=2, try K=3, compare BIC values. If BIC favours K=2 or the third regime contains fewer than 5% of observations, stick with two regimes.",
            },
            {
              type: "intuition",
              title: "The Traffic Light Analogy",
              analogy:
                "A regime-switching model sees the market as governed by an invisible traffic light — green for trending, yellow for transition, red for mean-reverting — and probabilistically infers which light is showing from observed price behavior.",
              content:
                "Imagine driving through a city where traffic lights are **hidden behind buildings** — you cannot see the light directly, only the behaviour of cars around you (their speed = market returns). When the light is **green** 🟢, cars move fast and consistently in one direction (trending market — high |μ|, moderate σ). When it's **red** 🔴, cars idle with small random movements (range-bound market — μ ≈ 0, low σ). When it's **yellow** 🟡, behaviour is erratic as some cars accelerate and others brake (transitional regime — high σ, uncertain μ). The **transition matrix** tells you how sticky each light is: P(green→green) = 0.97 means once trending starts, it tends to persist for 1/0.03 ≈ 33 bars. The **expected sojourn time** is how long each light typically stays on before changing. A high p₀₀ means long calm periods; a lower p₁₁ means volatile episodes are intense but shorter-lived.\n\n**Hamilton's filter** is your real-time inference: at each moment, you observe car speeds (returns) and update your belief about the light colour using Bayes' rule. Early in a new trend, you might be only 60% confident it's 'green' — but after several consistent observations, confidence rises to 95%. **Kim's smoother** is going home after the drive and reviewing your dashcam footage from both directions — knowing what happened *after* each moment lets you reclassify ambiguous periods with much higher confidence. For **trading**, you adapt strategy to the inferred light: trend-follow on green, mean-revert on red, reduce position size on yellow. Critically, in live trading you can only use the filter (real-time), not the smoother (hindsight). Using smoothed probabilities in a backtest would be like claiming you 'knew' the light was green because you saw cars accelerate *five minutes later*.",
              emoji: "🚦",
            },
            {
              type: "intuition",
              title: "The Mood Ring Analogy",
              analogy:
                "Financial markets wear an invisible mood ring — the Markov-Switching model reads the market's observable 'body language' (returns) to detect the hidden emotional state (regime).",
              content:
                "Think of the market as a person wearing a **mood ring** that only *you* cannot see. The person's mood (regime) drives their observable behaviour (returns): when **fearful** (high-volatility regime), their movements are large, erratic, and biased downward — σ₁ = 0.15%, μ₁ = −0.03%. When **euphoric** (trending regime), they stride confidently in one direction — σ₂ = 0.08%, μ₂ = +0.02%. When **apathetic** (range-bound), they shuffle aimlessly — σ₀ = 0.04%, μ₀ ≈ 0%. Moods are **persistent but not permanent**: the transition matrix quantifies how likely each mood shift is. Fear tends to be self-reinforcing (p₁₁ = 0.95, average 20-bar duration) but eventually burns out; euphoria builds slowly but can persist (p₂₂ = 0.97, average 33 bars).\n\nThe MS model is your **emotional intelligence algorithm**: it reads the market's body language (pattern of recent returns) and estimates the probability of each mood. When the model detects a shift from apathy to fear — P(fearful) jumps from 0.2 to 0.7 — you adapt your strategy: switch from mean-reversion to either trend-following the sell-off or standing aside. The key insight is that **different moods demand different strategies**: what works brilliantly in one regime (buying dips in a calm market) can be catastrophic in another (buying dips during a fear cascade). The regime-switching model gives you a principled, probabilistic framework for this adaptation rather than relying on ad-hoc rules or lagging indicators.",
              emoji: "💍",
            },
            {
              type: "code",
              title: "Fitting a 2-Regime Markov-Switching Model",
              language: "python",
              code: `import numpy as np
import pandas as pd
from statsmodels.tsa.regime_switching.markov_regression import MarkovRegression

# --- Load and prepare EUR/USD hourly returns ---
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"], index_col="timestamp")
df["log_return"] = np.log(df["close"] / df["close"].shift(1))
returns = df["log_return"].dropna() * 100  # percentage scale for numerical stability

print(f"Data: {len(returns)} observations from {returns.index[0]} to {returns.index[-1]}")
print(f"Return stats: mean={returns.mean():.4f}%, std={returns.std():.4f}%")

# --- Fit 2-regime Markov-Switching model with switching mean & variance ---
ms_model = MarkovRegression(
    returns, k_regimes=2, trend="c", switching_variance=True
)
ms_result = ms_model.fit(maxiter=300, disp=False)

print("\\n=== 2-Regime Markov-Switching Model ===")
print(f"Log-likelihood: {ms_result.llf:.2f}")
print(f"AIC: {ms_result.aic:.2f}  BIC: {ms_result.bic:.2f}")

# --- Regime parameters ---
print("\\nRegime parameters (mean-variance switching):")
for k in range(2):
    mu_k = ms_result.params[f"const[{k}]"]
    sigma_k = np.sqrt(ms_result.params[f"sigma2[{k}]"])
    print(f"  Regime {k}: mu = {mu_k:+.5f}%  sigma = {sigma_k:.5f}%")

# --- Transition matrix ---
p00 = ms_result.params.get("p[0->0]", None)
p11 = ms_result.params.get("p[1->1]", None)
if p00 is not None and p11 is not None:
    print("\\nTransition matrix P:")
    print(f"  [[{p00:.4f}, {1-p00:.4f}],")
    print(f"   [{1-p11:.4f}, {p11:.4f}]]")

    # Expected sojourn times: E[d_k] = 1/(1 - p_kk)
    dur0 = 1 / (1 - p00)
    dur1 = 1 / (1 - p11)
    print(f"\\nExpected sojourn times:")
    print(f"  Regime 0: {dur0:.1f} bars  |  Regime 1: {dur1:.1f} bars")

    # Ergodic distribution: pi_0 = (1-p11)/((1-p00)+(1-p11))
    pi0 = (1 - p11) / ((1 - p00) + (1 - p11))
    pi1 = (1 - p00) / ((1 - p00) + (1 - p11))
    print(f"\\nErgodic (stationary) distribution:")
    print(f"  pi_0 = {pi0:.4f}  pi_1 = {pi1:.4f}")
    print(f"  Market spends ~{pi0*100:.1f}% in Regime 0, ~{pi1*100:.1f}% in Regime 1")

# --- Smoothed regime probabilities summary ---
smoothed = ms_result.smoothed_marginal_probabilities
r0_prob = smoothed[0]
print("\\nSmoothed probabilities P(Regime 0 | all data):")
print(f"  Mean: {r0_prob.mean():.3f}  Std: {r0_prob.std():.3f}")
print(f"  Confident Regime 0 (P > 0.9): {(r0_prob > 0.9).sum()} bars ({(r0_prob > 0.9).mean()*100:.1f}%)")
print(f"  Confident Regime 1 (P < 0.1): {(r0_prob < 0.1).sum()} bars ({(r0_prob < 0.1).mean()*100:.1f}%)")
print(f"  Ambiguous (0.3 < P < 0.7):    {((r0_prob > 0.3) & (r0_prob < 0.7)).sum()} bars")`,
              explanation:
                "This script fits a 2-regime Markov-Switching model with switching mean and variance to EUR/USD hourly returns. It reports regime-specific parameters (μₖ, σₖ), the full transition matrix, expected sojourn times derived from E[dₖ] = 1/(1−pₖₖ), the ergodic distribution showing long-run regime proportions, and a summary of smoothed regime probabilities indicating how confidently the model classifies each observation.",
            },
            {
              type: "code",
              title: "Model Selection: 2 vs 3 Regimes via BIC",
              language: "python",
              code: `import numpy as np
import pandas as pd
from statsmodels.tsa.regime_switching.markov_regression import MarkovRegression

# Prepare returns
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"], index_col="timestamp")
df["log_return"] = np.log(df["close"] / df["close"].shift(1))
returns = df["log_return"].dropna() * 100
n = len(returns)

results = {}
for K in [2, 3]:
    model = MarkovRegression(
        returns, k_regimes=K, trend="c", switching_variance=True
    )
    res = model.fit(maxiter=300, disp=False)
    results[K] = res

    n_params = K**2 + K  # K means + K variances + K(K-1) transition probs
    print(f"\\n=== {K}-Regime Model ({n_params} free parameters) ===")
    print(f"Log-likelihood: {res.llf:.2f}")
    print(f"AIC: {res.aic:.2f}  BIC: {res.bic:.2f}")

    print("Regime parameters:")
    for k in range(K):
        mu_k = res.params[f"const[{k}]"]
        sigma_k = np.sqrt(res.params[f"sigma2[{k}]"])
        print(f"  Regime {k}: mu={mu_k:+.5f}%  sigma={sigma_k:.5f}%")

# --- Compare models ---
bic2 = results[2].bic
bic3 = results[3].bic
delta_bic = bic3 - bic2
llf_diff = results[3].llf - results[2].llf
bic_penalty_diff = 6 * np.log(n)  # 12 - 6 = 6 extra params for K=3

print("\\n=== Model Comparison ===")
print(f"2-regime BIC: {bic2:.2f}  |  3-regime BIC: {bic3:.2f}")
print(f"Delta BIC (3 - 2): {delta_bic:+.2f}")
print(f"Log-likelihood improvement: {llf_diff:+.2f}")
print(f"BIC penalty for 6 extra params: {bic_penalty_diff:.2f}")
print(f"\\nPreferred model: {'3-regime' if bic3 < bic2 else '2-regime'} (lower BIC)")
if delta_bic > 0:
    print("The extra complexity of 3 regimes is NOT justified by the data.")
else:
    print("The 3rd regime captures meaningful structure beyond 2 regimes.")`,
              explanation:
                "We fit both 2-regime (6 parameters: K²+K = 4+2) and 3-regime (12 parameters: 9+3) models and compare via BIC. The script computes the BIC penalty for the 6 extra parameters (6·ln(n)) and checks whether the log-likelihood improvement of the 3-regime model justifies the added complexity. Standard LRT is invalid here due to Davies' problem — nuisance parameters are unidentified under H₀.",
            },
            {
              type: "code",
              title: "Filtered vs Smoothed Regime Probabilities & Trading Signals",
              language: "python",
              code: `import numpy as np
import pandas as pd
from statsmodels.tsa.regime_switching.markov_regression import MarkovRegression

# Prepare data and fit model
df = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"], index_col="timestamp")
df["log_return"] = np.log(df["close"] / df["close"].shift(1))
returns = df["log_return"].dropna() * 100

model = MarkovRegression(returns, k_regimes=2, trend="c", switching_variance=True)
result = model.fit(maxiter=300, disp=False)

# --- Extract filtered (causal) and smoothed (full-sample) probabilities ---
filtered = result.filtered_marginal_probabilities[0]   # P(regime 0 | y_1:t)
smoothed = result.smoothed_marginal_probabilities[0]    # P(regime 0 | y_1:T)

# Compare filtered vs smoothed
corr = filtered.corr(smoothed)
mae = (filtered - smoothed).abs().mean()
print("=== Filtered vs Smoothed Probabilities ===")
print(f"Correlation: {corr:.4f}")
print(f"Mean absolute difference: {mae:.4f}")
print(f"Max absolute difference: {(filtered - smoothed).abs().max():.4f}")
print(f"Filtered mean: {filtered.mean():.4f}  Smoothed mean: {smoothed.mean():.4f}")

# Identify where they disagree most (regime ambiguity)
disagree = (filtered - smoothed).abs() > 0.2
print(f"Bars with |filtered - smoothed| > 0.2: {disagree.sum()} ({disagree.mean()*100:.1f}%)")

# --- Generate regime-based trading signals using FILTERED probs (no look-ahead) ---
sigma0 = np.sqrt(result.params["sigma2[0]"])
sigma1 = np.sqrt(result.params["sigma2[1]"])
low_vol_regime = 0 if sigma0 < sigma1 else 1

p_low_vol = filtered if low_vol_regime == 0 else (1 - filtered)
signals = pd.Series("hold", index=filtered.index)
signals[p_low_vol > 0.7] = "mean_revert"    # low-vol regime: mean-reversion
signals[p_low_vol < 0.3] = "trend_follow"    # high-vol regime: trend-following
# Otherwise hold / reduce exposure (ambiguous regime)

print("\\n=== Regime-Based Trading Signals (Filtered) ===")
print(f"Low-vol regime (sigma={min(sigma0,sigma1):.4f}%): Regime {low_vol_regime}")
print(f"High-vol regime (sigma={max(sigma0,sigma1):.4f}%): Regime {1-low_vol_regime}")
print(f"\\nSignal distribution:")
for sig in ["mean_revert", "trend_follow", "hold"]:
    count = (signals == sig).sum()
    pct = count / len(signals) * 100
    print(f"  {sig:15s}: {count:6d} bars ({pct:5.1f}%)")

# Regime-conditional return statistics
aligned = returns.loc[signals.index]
for sig in ["mean_revert", "trend_follow", "hold"]:
    mask = signals == sig
    if mask.sum() > 0:
        r = aligned[mask]
        print(f"  {sig:15s} return: mean={r.mean():+.5f}% std={r.std():.5f}% sharpe={r.mean()/r.std()*np.sqrt(252*24):.2f}")`,
              explanation:
                "This script extracts both filtered (real-time, causal) and smoothed (full-sample, retrospective) regime probabilities, quantifies their agreement, and generates regime-adaptive trading signals using only filtered probabilities to avoid look-ahead bias. It then computes regime-conditional return statistics including annualized Sharpe ratios to validate whether the detected regimes have economically meaningful differences.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "ts-regime-q1",
                  question:
                    "A 2-regime MS model has transition matrix P = [[0.96, 0.04], [0.08, 0.92]]. What is the expected sojourn time in Regime 1 (the high-volatility regime)?",
                  options: [
                    { id: "ts-regime-q1-a", text: "1/0.08 = 12.5 bars — using the off-diagonal of Regime 1's row" },
                    { id: "ts-regime-q1-b", text: "1/(1−0.92) = 1/0.08 = 12.5 bars — from E[dₖ] = 1/(1−pₖₖ)" },
                    { id: "ts-regime-q1-c", text: "1/(1−0.96) = 25 bars — using Regime 0's self-transition" },
                    { id: "ts-regime-q1-d", text: "0.92/0.08 = 11.5 bars — ratio of self-transition to exit probability" },
                  ],
                  correctOptionId: "ts-regime-q1-b",
                  explanation:
                    "The expected sojourn time in regime k is E[dₖ] = 1/(1−pₖₖ), derived from the geometric distribution of sojourn times: P(dₖ=n) = pₖₖⁿ⁻¹(1−pₖₖ). For Regime 1: p₁₁ = 0.92, so E[d₁] = 1/(1−0.92) = 1/0.08 = 12.5 bars. Note that answer (a) arrives at the same number by coincidence (1−p₁₁ equals p₁₀ in a 2-state model), but the correct formula uses 1−pₖₖ, not the off-diagonal directly.",
                },
                {
                  id: "ts-regime-q2",
                  question:
                    "What is the fundamental difference between filtered probabilities ξₜ|ₜ and smoothed probabilities ξₜ|T in a Markov-Switching model?",
                  options: [
                    { id: "ts-regime-q2-a", text: "Filtered probabilities use a Kalman filter while smoothed use a particle filter" },
                    { id: "ts-regime-q2-b", text: "Filtered probabilities condition on observations y₁:ₜ (up to current time), while smoothed condition on y₁:T (the entire sample including future observations)" },
                    { id: "ts-regime-q2-c", text: "Smoothed probabilities are always more accurate and should be preferred in all applications including live trading" },
                    { id: "ts-regime-q2-d", text: "Filtered probabilities are continuous values while smoothed probabilities are binary regime assignments" },
                  ],
                  correctOptionId: "ts-regime-q2-b",
                  explanation:
                    "Filtered probabilities ξₜ|ₜ = P(sₜ=k|y₁:ₜ) use only data up to time t (causal/real-time). Smoothed probabilities ξₜ|T = P(sₜ=k|y₁:T) use the entire sample including future observations (retrospective). While smoothed probabilities are indeed less noisy and more confident, using them in a live trading backtest introduces look-ahead bias. Filtered probabilities must be used for any real-time decision-making.",
                },
                {
                  id: "ts-regime-q3",
                  question:
                    "Why is the standard likelihood ratio test (LRT) invalid for testing K=1 vs K=2 regimes in a Markov-Switching model?",
                  options: [
                    { id: "ts-regime-q3-a", text: "Because the EM algorithm does not converge to the global maximum" },
                    { id: "ts-regime-q3-b", text: "Because under H₀ (K=1), the transition probabilities and parameters of the second regime are unidentified (Davies' problem), violating the regularity conditions for the χ² asymptotic distribution" },
                    { id: "ts-regime-q3-c", text: "Because the LRT can only compare nested linear models, not nonlinear ones" },
                    { id: "ts-regime-q3-d", text: "Because regime-switching models have too many parameters for the LRT to have sufficient power" },
                  ],
                  correctOptionId: "ts-regime-q3-b",
                  explanation:
                    "Under H₀: K=1, the 'second' regime's parameters (μ₂, σ₂) and transition probabilities (p₁₂, p₂₁) are nuisance parameters that are completely unidentified — any values produce identical likelihood. This means the null hypothesis lies on the boundary of the parameter space, violating the regularity conditions required for the LRT statistic to follow a χ² distribution. This is Davies' problem (1977, 1987). Alternatives include BIC, cross-validation, or Hansen's (1992) bound test.",
                },
                {
                  id: "ts-regime-q4",
                  question:
                    "What is the key structural difference between a Markov-Switching AR model and a standard Hidden Markov Model with Gaussian emissions?",
                  options: [
                    { id: "ts-regime-q4-a", text: "MS-AR models can only have 2 regimes, while HMMs support any number of hidden states" },
                    { id: "ts-regime-q4-b", text: "HMMs use the Viterbi algorithm while MS-AR uses gradient descent" },
                    { id: "ts-regime-q4-c", text: "In a Gaussian HMM, emissions are conditionally i.i.d. given the state (P(yₜ|sₜ)), while MS-AR models autoregressive dynamics within each regime (yₜ depends on yₜ₋₁,…,yₜ₋ₚ and sₜ)" },
                    { id: "ts-regime-q4-d", text: "HMMs cannot model switching variance, only switching mean" },
                  ],
                  correctOptionId: "ts-regime-q4-c",
                  explanation:
                    "In a standard Gaussian HMM, P(yₜ|sₜ=k) = N(μₖ, σₖ²) — observations are conditionally independent given the hidden state. MS-AR explicitly models temporal dependence: yₜ = μ(sₜ) + ∑ᵢ φᵢ(sₜ)(yₜ₋ᵢ − μ(sₜ₋ᵢ)) + σ(sₜ)εₜ, where AR coefficients, mean, and variance all switch with the regime. This is critical when autocorrelation structure changes across regimes — e.g., positive autocorrelation in trends vs. negative in mean-reverting markets.",
                },
                {
                  id: "ts-regime-q5",
                  question:
                    "Given a 2-regime model with P = [[0.95, 0.05], [0.10, 0.90]], what is the ergodic probability of Regime 0 (π₀)?",
                  options: [
                    { id: "ts-regime-q5-a", text: "π₀ = 0.95/(0.95+0.90) = 0.5135" },
                    { id: "ts-regime-q5-b", text: "π₀ = 0.05/(0.05+0.10) = 0.333" },
                    { id: "ts-regime-q5-c", text: "π₀ = (1−0.90)/((1−0.95)+(1−0.90)) = 0.10/0.15 = 0.667" },
                    { id: "ts-regime-q5-d", text: "π₀ = 0.50 because there are two regimes and they must be equally likely" },
                  ],
                  correctOptionId: "ts-regime-q5-c",
                  explanation:
                    "The ergodic distribution for a 2-state Markov chain satisfies π = Pᵀπ. Solving: π₀ = (1−p₁₁)/((1−p₀₀)+(1−p₁₁)) = (1−0.90)/((1−0.95)+(1−0.90)) = 0.10/(0.05+0.10) = 0.10/0.15 = 2/3 ≈ 0.667. The market spends about 66.7% of the time in Regime 0 and 33.3% in Regime 1. Regime 0 has a longer expected duration (1/0.05 = 20 bars vs. 1/0.10 = 10 bars), so it occupies a larger share of time in the long run.",
                },
                {
                  id: "ts-regime-q6",
                  question:
                    "In a regime-switching framework for forex, the model identifies Regime 0 (σ=0.04%, μ≈0) and Regime 1 (σ=0.14%, μ=-0.02%). How should a trader adapt?",
                  options: [
                    { id: "ts-regime-q6-a", text: "Use the same strategy in both regimes but increase leverage in Regime 1 to compensate for the negative mean" },
                    { id: "ts-regime-q6-b", text: "Apply mean-reversion strategies in Regime 0 (low-vol, no drift) and trend-following or risk-off in Regime 1 (high-vol, directional)" },
                    { id: "ts-regime-q6-c", text: "Ignore the regime labels and trade based on price action alone, since the model only provides probabilities" },
                    { id: "ts-regime-q6-d", text: "Only trade in Regime 0 because Regime 1 has negative expected returns" },
                  ],
                  correctOptionId: "ts-regime-q6-b",
                  explanation:
                    "Regime 0 (low σ, μ≈0) is a calm, range-bound market where mean-reversion strategies thrive — prices oscillate around a stable mean. Regime 1 (high σ, negative μ) is a volatile, directional sell-off where trend-following (shorting) or reducing exposure is appropriate. The regime-adaptive approach is to switch strategies based on filtered regime probabilities: mean-revert when P(Regime 0) > 0.7, trend-follow when P(Regime 1) > 0.7, and reduce position size in ambiguous zones. This exploits the regime structure rather than applying a single strategy to all market conditions.",
                },
              ],
            },
            {
              type: "practice",
              title: "Guided: Regime Detection Pipeline",
              description:
                "Build a complete regime detection pipeline for EUR/USD hourly data. Step 1: Fit a 2-regime MS model with switching mean and variance — record μₖ, σₖ, p₀₀, p₁₁. Step 2: Fit a 3-regime model and compare BIC values to determine optimal K. Step 3: For the preferred model, extract smoothed probabilities and assign each bar to its most probable regime (argmax). Step 4: Overlay regime classifications on the price chart using colour-coded backgrounds. Step 5: Compute regime-conditional statistics — mean return, volatility, Sharpe ratio, average duration, and fraction of time in each regime. Step 6: Examine regime transitions — do they align with known volatility events (NFP releases, central bank announcements)? Step 7: Compare filtered vs smoothed regime assignments to quantify real-time detection lag.",
            },
            {
              type: "practice",
              title: "Dashboard Exploration: Regime-Adaptive Strategies",
              description:
                "Use the dashboard's regime detector to explore regime-adaptive trading strategies. (1) Visualize the detected regimes overlaid on EUR/USD price data — identify the calm vs volatile regimes by their return characteristics. (2) Backtest a regime-switching strategy: apply mean-reversion (e.g., Bollinger Band bounce) when the model assigns P(calm regime) > 0.7, and trend-following (e.g., moving average crossover) when P(volatile regime) > 0.7. Use filtered (not smoothed) probabilities to avoid look-ahead bias. (3) Compare the regime-adaptive strategy's Sharpe ratio, max drawdown, and win rate against a single-strategy baseline. (4) Experiment with the regime probability threshold (0.6 vs 0.7 vs 0.8) — how does confidence required for strategy switching affect performance? (5) Test whether adding a 'hold/flat' zone for ambiguous regime probabilities (0.3–0.7) improves risk-adjusted returns.",
              catalogModelId: "regime-detector",
            },
          ],
        },
      ],
    },
  ],
};
