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
            "Master the complete toolkit for summarizing forex return distributions — from basic measures of central tendency and dispersion through higher moments (skewness, kurtosis), robust alternatives, and rolling statistics. Learn why each matters for risk management and strategy design, with full derivations and real numerical examples.",
          estimatedMinutes: 90,
          difficulty: "beginner",
          sections: [
            // ── OBJECTIVE ──────────────────────────────────────────
            {
              type: "objective",
              content:
                "By the end of this lesson you will be able to: (1) derive and compute all four statistical moments from raw price data, (2) explain why log-returns are preferred over simple returns with a mathematical proof, (3) interpret skewness and kurtosis in the context of tail risk and strategy selection, (4) apply robust statistics (median, MAD, trimmed mean) when outliers distort standard measures, (5) compute rolling statistics to track regime changes in real time, (6) construct and interpret QQ-plots and histograms for normality assessment, and (7) annualize volatility correctly for different timeframes.",
              keyTakeaways: [
                "Simple returns Rₜ = (Pₜ − Pₜ₋₁)/Pₜ₋₁ are intuitive but NOT time-additive; log-returns rₜ = ln(Pₜ/Pₜ₋₁) ARE additive, making multi-period analysis tractable",
                "The mean (μ) of returns tells you the expected drift, but is unreliable alone — a single flash crash can shift μ dramatically",
                "Standard deviation (σ) quantifies volatility — the core risk measure in finance — but assumes symmetric risk, which markets violate",
                "Skewness S measures asymmetry: S < 0 means left-tail losses are larger than right-tail gains (common in FX carry trades)",
                "Excess kurtosis κ = K − 3 > 0 signals fat tails — extreme moves occur 10-100× more often than Gaussian models predict",
                "Robust alternatives (median, MAD, Winsorized mean) resist outlier contamination and are essential for live strategy monitoring",
                "Rolling statistics (e.g., 20-bar rolling σ) reveal volatility regimes — high σ periods require different position sizing than low σ periods",
                "The Jarque-Bera test formally tests normality using both skewness and kurtosis jointly",
              ],
            },

            // ── THEORY 1: Returns ──────────────────────────────────
            {
              type: "theory",
              title: "Simple Returns vs Log-Returns: Derivation & Properties",
              content:
                "**Definition.** Given a price series P₀, P₁, …, Pₙ, the **simple (arithmetic) return** at time t is Rₜ = (Pₜ − Pₜ₋₁) / Pₜ₋₁ = Pₜ/Pₜ₋₁ − 1. The **log (continuously compounded) return** is rₜ = ln(Pₜ / Pₜ₋₁) = ln(1 + Rₜ).\n\n**Why log-returns?** Three critical properties:\n\n1. **Time-additivity.** The k-period log-return is the sum of single-period log-returns: r(t, t+k) = ln(Pₜ₊ₖ/Pₜ) = ln(Pₜ₊ₖ/Pₜ₊ₖ₋₁) + … + ln(Pₜ₊₁/Pₜ) = rₜ₊ₖ + … + rₜ₊₁. Simple returns do NOT have this property — the 2-day simple return R₂ₐ = (1 + R₁)(1 + R₂) − 1 ≠ R₁ + R₂.\n\n2. **Symmetry.** A +10% simple return followed by −10% gives a net loss: 1.10 × 0.90 = 0.99 (−1%). But log-returns are symmetric: ln(1.10) = 0.0953, ln(0.90) = −0.1054 — the magnitudes are closer, and a +r followed by −r gives exactly zero only for log-returns in the limit.\n\n3. **Central Limit Theorem.** Because multi-period log-returns are *sums* of independent single-period log-returns, the CLT implies that long-horizon log-returns converge to normality even if short-horizon returns are non-Gaussian. This is the theoretical basis for geometric Brownian motion (GBM) in the Black-Scholes model.\n\n**Numerical example.** EUR/USD closes at 1.0850, 1.0873, 1.0861. Simple returns: R₁ = (1.0873 − 1.0850)/1.0850 = 0.2120%, R₂ = (1.0861 − 1.0873)/1.0873 = −0.1103%. Log-returns: r₁ = ln(1.0873/1.0850) = 0.2118%, r₂ = ln(1.0861/1.0873) = −0.1104%. The 2-period log-return r₁₊₂ = r₁ + r₂ = 0.1014%, which equals ln(1.0861/1.0850) = 0.1014%. ✓",
            },

            // ── THEORY 2: The Four Moments ─────────────────────────
            {
              type: "theory",
              title: "The Four Moments: Full Derivations",
              content:
                "Given n log-returns r₁, r₂, …, rₙ:\n\n**First Moment — Mean (μ).** The sample mean μ̂ = (1/n) ∑ᵢ rᵢ estimates the expected drift E[r]. For EUR/USD hourly data over 2024, typical μ̂ ≈ −0.000002 (essentially zero — FX returns have negligible drift at high frequency). The standard error of the mean is SE(μ̂) = σ/√n, so with σ = 0.0004 and n = 6,000 hours, SE ≈ 0.000005 — the mean is statistically indistinguishable from zero.\n\n**Second Central Moment — Variance (σ²).** The sample variance s² = (1/(n−1)) ∑ᵢ (rᵢ − μ̂)² uses n−1 (Bessel's correction) for an unbiased estimate. Standard deviation σ̂ = √s². For EUR/USD 1H: σ̂ ≈ 0.00038 per bar. To **annualize**: σ_annual = σ̂ × √(bars_per_year). With ~6,048 trading hours/year: σ_annual = 0.00038 × √6048 ≈ 0.0296 = 2.96%. This matches typical EUR/USD annual realized volatility of 6-10% (the lower value reflects recent low-vol regimes).\n\n**Third Standardized Moment — Skewness (S).** S = (1/n) ∑ᵢ [(rᵢ − μ̂)/σ̂]³. Derivation: we standardize each return to zᵢ = (rᵢ − μ̂)/σ̂, then compute the mean of z³. Because cubing preserves sign, negative returns contribute negative z³ values. If negative outliers are larger in magnitude than positive ones, S < 0 (left-skewed). Typical EUR/USD hourly skewness: S ≈ −0.15 to −0.05. Carry trade pairs (AUD/JPY) often show S ≈ −0.8 due to sudden risk-off unwinds.\n\n**Fourth Standardized Moment — Kurtosis (K) and Excess Kurtosis (κ).** K = (1/n) ∑ᵢ [(rᵢ − μ̂)/σ̂]⁴. The Normal distribution has K = 3, so we define excess kurtosis κ = K − 3. If κ > 0 (leptokurtic), tails are fatter than Gaussian. Derivation insight: because we raise to the 4th power, extreme outliers are amplified dramatically — a return of 5σ contributes 5⁴ = 625 to the sum, dominating the average. Typical EUR/USD: κ ≈ 5–15 on hourly data, meaning the 4σ event occurs roughly exp(−8) ÷ P(empirical 4σ) ≈ 50× more often than Gaussian predicts.\n\n**The Jarque-Bera Test.** JB = (n/6)(S² + κ²/4) tests H₀: data is normally distributed. Under H₀, JB ~ χ²(2). For EUR/USD with S = −0.1 and κ = 8: JB = (6000/6)(0.01 + 16) ≈ 16,010 — overwhelmingly rejecting normality (critical value at α = 0.05 is 5.99).",
            },

            // ── INTUITION 1 ────────────────────────────────────────
            {
              type: "intuition",
              title: "The Weather Forecast Analogy",
              analogy:
                "Descriptive statistics are like a weather summary for a city.",
              content:
                "The **mean** is the average temperature — useful but doesn't tell you about heat waves or cold snaps. A city averaging 20°C could be consistently mild (low σ) or swing between 0°C and 40°C (high σ). **Standard deviation** is the temperature range — a desert has high σ (hot days, cold nights) while the tropics have low σ.\n\n**Skewness** is like a city where rare storms are always *worse* than rare sunny spells — the bad surprises outweigh the good. Miami has negative skew on property returns: steady appreciation punctuated by hurricane-driven crashes.\n\n**Kurtosis** tells you how often *extreme* weather occurs — a 'once-in-a-century' storm happening every decade. High kurtosis means your '100-year flood' model is dangerously wrong. Forex returns behave exactly this way: μ and σ alone miss the fat tails that blow up accounts, which is why every risk model must check skewness and kurtosis before trusting a Gaussian assumption.",
              emoji: "🌦️",
            },

            // ── INTUITION 2 ────────────────────────────────────────
            {
              type: "intuition",
              title: "The Salary Distribution Analogy",
              analogy:
                "Mean vs median reveals the shape of a distribution just like salary data.",
              content:
                "In a company of 100 employees, 99 earn $50,000 and the CEO earns $50,000,000. The **mean** salary is $549,500 — wildly unrepresentative. The **median** is $50,000 — what a typical employee actually earns. When mean >> median, the distribution is right-skewed (pulled by outliers). In forex, a strategy that has mean return > median return likely has a few large winning trades inflating the average — strip those out and the typical trade is worse than the mean suggests. This is exactly why hedge funds report *median* monthly returns alongside mean, and why robust statistics (trimmed mean, MAD) matter.",
              emoji: "💰",
            },

            // ── THEORY 3: Robust Statistics ─────────────────────────
            {
              type: "theory",
              title: "Robust Statistics: When Outliers Break Standard Measures",
              content:
                "Standard mean and standard deviation are **not robust** — a single extreme observation can shift them dramatically. In live trading, a flash crash or news spike can make your rolling mean and σ meaningless for the next N bars.\n\n**Median Absolute Deviation (MAD).** MAD = median(|rᵢ − median(r)|). For normally distributed data, σ ≈ 1.4826 × MAD (the constant converts MAD to a σ-equivalent). MAD is resistant to up to 50% outlier contamination (breakdown point = 0.5) vs 0% for standard deviation.\n\n**Trimmed Mean.** The α-trimmed mean discards the smallest α% and largest α% of observations before averaging. A 5%-trimmed mean on 1,000 returns drops the 50 most extreme values on each side. This eliminates flash crash contamination while keeping 90% of the data.\n\n**Winsorized Standard Deviation.** Instead of dropping outliers, Winsorization replaces them with the nearest non-outlier value. The 5%-Winsorized σ replaces the top and bottom 5% of returns with the 5th and 95th percentile values, then computes σ normally.\n\n**Interquartile Range (IQR).** IQR = Q₃ − Q₁ (75th percentile minus 25th). For a normal distribution, IQR ≈ 1.35σ. Outliers are often defined as observations beyond Q₁ − 1.5×IQR or Q₃ + 1.5×IQR (Tukey's fences).\n\n**When to use which:** In live strategy monitoring, use MAD or Winsorized σ for position sizing during volatile periods. Use the trimmed mean when estimating expected returns across regimes. Reserve standard mean/σ for well-behaved, stationary periods only.",
            },

            // ── CODE 1: Basic Statistics ────────────────────────────
            {
              type: "code",
              title: "Computing All Four Moments from Scratch",
              language: "python",
              code: `import numpy as np
import pandas as pd
from scipy import stats

# ──────────────────────────────────────────────────────────
# Load 1-hour EUR/USD closes and compute log-returns
# ──────────────────────────────────────────────────────────
prices = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
prices["log_return"] = np.log(prices["close"] / prices["close"].shift(1))
returns = prices["log_return"].dropna().values
n = len(returns)
print(f"Loaded {n:,} hourly log-returns")

# ──────────────────────────────────────────────────────────
# First moment: Mean (μ)
# ──────────────────────────────────────────────────────────
mu = np.sum(returns) / n                   # manual computation
se_mu = np.std(returns, ddof=1) / np.sqrt(n)  # standard error
print(f"\\nMean (μ):           {mu:.8f}")
print(f"Std Error of Mean:  {se_mu:.8f}")
print(f"95% CI for μ:       [{mu - 1.96*se_mu:.8f}, {mu + 1.96*se_mu:.8f}]")

# ──────────────────────────────────────────────────────────
# Second moment: Variance (σ²) and Std Dev (σ)
# ──────────────────────────────────────────────────────────
variance = np.sum((returns - mu)**2) / (n - 1)  # Bessel's correction
sigma = np.sqrt(variance)
annualized_vol = sigma * np.sqrt(252 * 24)  # ~6048 trading hours/year
print(f"\\nVariance (σ²):      {variance:.10f}")
print(f"Std Dev (σ):        {sigma:.8f}")
print(f"Annualized Vol:     {annualized_vol:.4%}")

# ──────────────────────────────────────────────────────────
# Third moment: Skewness
# ──────────────────────────────────────────────────────────
z = (returns - mu) / sigma                  # standardize
skewness_manual = np.mean(z**3)
skewness_scipy = stats.skew(returns, bias=False)  # Fisher's correction
print(f"\\nSkewness (manual):  {skewness_manual:.6f}")
print(f"Skewness (scipy):   {skewness_scipy:.6f}")
print(f"Interpretation:     {'Left-skewed (larger downside tail)' if skewness_scipy < 0 else 'Right-skewed'}")

# ──────────────────────────────────────────────────────────
# Fourth moment: Kurtosis (excess)
# ──────────────────────────────────────────────────────────
kurtosis_raw = np.mean(z**4)               # raw kurtosis K
excess_kurtosis = kurtosis_raw - 3          # κ = K - 3
kurtosis_scipy = stats.kurtosis(returns, bias=False)
print(f"\\nRaw Kurtosis (K):   {kurtosis_raw:.4f}")
print(f"Excess Kurt (κ):    {excess_kurtosis:.4f}")
print(f"Kurt (scipy):       {kurtosis_scipy:.4f}")
print(f"Interpretation:     {'Fat-tailed (leptokurtic)' if excess_kurtosis > 0 else 'Thin-tailed (platykurtic)'}")

# ──────────────────────────────────────────────────────────
# Jarque-Bera normality test
# ──────────────────────────────────────────────────────────
jb_stat, jb_pvalue = stats.jarque_bera(returns)
print(f"\\nJarque-Bera stat:   {jb_stat:.2f}")
print(f"JB p-value:         {jb_pvalue:.2e}")
print(f"Normal at α=0.05?   {'YES' if jb_pvalue > 0.05 else 'NO — reject normality'}")`,
              explanation:
                "This program computes all four moments step-by-step, showing both manual formulas and scipy equivalents. Key observations: (1) The mean is nearly zero with a tight confidence interval — hourly FX drift is negligible. (2) Annualized vol scales by √(bars/year); for hourly data that's √6048. (3) Negative skewness confirms asymmetric downside risk. (4) Excess kurtosis >> 0 proves fat tails. (5) The Jarque-Bera test will almost certainly reject normality for any FX pair — the JB statistic scales with n, and with thousands of observations even mild non-normality is statistically significant.",
            },

            // ── CODE 2: Robust Statistics ───────────────────────────
            {
              type: "code",
              title: "Robust Alternatives: MAD, Trimmed Mean, IQR",
              language: "python",
              code: `import numpy as np
from scipy import stats

# Assume 'returns' array is loaded from previous code block
n = len(returns)

# ──────────────────────────────────────────────────────────
# Median Absolute Deviation (MAD)
# ──────────────────────────────────────────────────────────
median_r = np.median(returns)
mad = np.median(np.abs(returns - median_r))
sigma_mad = 1.4826 * mad   # scale to σ-equivalent for normal data
print(f"Median:             {median_r:.8f}")
print(f"MAD:                {mad:.8f}")
print(f"σ from MAD:         {sigma_mad:.8f}")
print(f"σ from std:         {np.std(returns, ddof=1):.8f}")
print(f"Ratio (MAD/std):    {sigma_mad / np.std(returns, ddof=1):.4f}")
# Ratio > 1 means outliers inflate std more than MAD

# ──────────────────────────────────────────────────────────
# Trimmed Mean (5% trim)
# ──────────────────────────────────────────────────────────
trim_pct = 0.05
trimmed_mean = stats.trim_mean(returns, trim_pct)
regular_mean = np.mean(returns)
print(f"\\nRegular mean:       {regular_mean:.8f}")
print(f"5%-Trimmed mean:    {trimmed_mean:.8f}")
print(f"10%-Trimmed mean:   {stats.trim_mean(returns, 0.10):.8f}")

# ──────────────────────────────────────────────────────────
# IQR and Tukey Fences for Outlier Detection
# ──────────────────────────────────────────────────────────
q1, q3 = np.percentile(returns, [25, 75])
iqr = q3 - q1
lower_fence = q1 - 1.5 * iqr
upper_fence = q3 + 1.5 * iqr
outliers = returns[(returns < lower_fence) | (returns > upper_fence)]
print(f"\\nQ1:                 {q1:.8f}")
print(f"Q3:                 {q3:.8f}")
print(f"IQR:                {iqr:.8f}")
print(f"Lower fence:        {lower_fence:.8f}")
print(f"Upper fence:        {upper_fence:.8f}")
print(f"Outliers detected:  {len(outliers)} / {n} ({100*len(outliers)/n:.2f}%)")
# In normal data, ~0.7% should be outliers; much higher = fat tails`,
              explanation:
                "This code demonstrates three robust alternatives to standard mean/σ. The MAD-to-σ ratio reveals how much outliers inflate standard deviation — if the ratio deviates significantly from 1.0, outliers are present. The trimmed mean shows how much extreme values distort the average. Tukey's fences flag individual outlier returns; in fat-tailed forex data, you'll typically see 3-5% flagged vs the 0.7% expected under normality.",
            },

            // ── CODE 3: Rolling Statistics ──────────────────────────
            {
              type: "code",
              title: "Rolling Statistics for Regime Detection",
              language: "python",
              code: `import numpy as np
import pandas as pd

# Load data
prices = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
prices["log_return"] = np.log(prices["close"] / prices["close"].shift(1))
prices = prices.dropna()

# ──────────────────────────────────────────────────────────
# Rolling windows: 24-bar (1 day) and 120-bar (5 days)
# ──────────────────────────────────────────────────────────
for window in [24, 120]:
    col = f"w{window}"
    prices[f"roll_mu_{col}"]   = prices["log_return"].rolling(window).mean()
    prices[f"roll_sigma_{col}"] = prices["log_return"].rolling(window).std()
    prices[f"roll_skew_{col}"]  = prices["log_return"].rolling(window).skew()
    prices[f"roll_kurt_{col}"]  = prices["log_return"].rolling(window).kurt()

# ──────────────────────────────────────────────────────────
# Annualize rolling volatility for intuitive comparison
# ──────────────────────────────────────────────────────────
prices["ann_vol_24h"] = prices["roll_sigma_w24"] * np.sqrt(252 * 24)
prices["ann_vol_5d"]  = prices["roll_sigma_w120"] * np.sqrt(252 * 24)

# ──────────────────────────────────────────────────────────
# Identify volatility regimes
# ──────────────────────────────────────────────────────────
vol_median = prices["ann_vol_5d"].median()
prices["vol_regime"] = np.where(
    prices["ann_vol_5d"] > vol_median * 1.5, "HIGH_VOL",
    np.where(prices["ann_vol_5d"] < vol_median * 0.5, "LOW_VOL", "NORMAL")
)

# Summary by regime
for regime in ["LOW_VOL", "NORMAL", "HIGH_VOL"]:
    mask = prices["vol_regime"] == regime
    subset = prices.loc[mask, "log_return"]
    print(f"\\n{regime} ({mask.sum():,} bars):")
    print(f"  Mean:     {subset.mean():.8f}")
    print(f"  Sigma:    {subset.std():.8f}")
    print(f"  Skewness: {subset.skew():.4f}")
    print(f"  Kurtosis: {subset.kurtosis():.4f}")`,
              explanation:
                "Rolling statistics reveal how market behaviour changes over time — essential for regime-adaptive strategies. Key insight: during HIGH_VOL regimes, kurtosis typically increases (more extreme moves) and skewness often becomes more negative (larger crash risk). A strategy that works in NORMAL vol may blow up in HIGH_VOL because the tail risk profile changes. This is why professional quant systems recompute statistics on a rolling basis and adjust position sizes accordingly.",
            },

            // ── QUIZ (6 questions) ─────────────────────────────────
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
                    "Excess kurtosis κ > 0 means the distribution is leptokurtic — it has fatter tails than a Gaussian. κ = 4.2 means the 4th standardized moment is 7.2 (vs 3 for Normal), so extreme gains and losses happen far more frequently than a bell curve predicts. This has direct implications for VaR calculations and stop-loss placement.",
                },
                {
                  id: "found-ds-q2",
                  question:
                    "Why do we typically use log-returns rₜ = ln(Pₜ / Pₜ₋₁) instead of simple returns?",
                  options: [
                    { id: "found-ds-q2-a", text: "Log-returns are always positive" },
                    { id: "found-ds-q2-b", text: "Log-returns are additive over time, enabling multi-period analysis via simple summation" },
                    { id: "found-ds-q2-c", text: "Log-returns eliminate the need for standard deviation" },
                    { id: "found-ds-q2-d", text: "Log-returns make kurtosis equal to zero" },
                  ],
                  correctOptionId: "found-ds-q2-b",
                  explanation:
                    "Log-returns satisfy r(t, t+k) = rₜ₊₁ + rₜ₊₂ + … + rₜ₊ₖ — the multi-period return is a simple sum. This time-additivity property makes statistical analysis tractable: the Central Limit Theorem applies to sums, so long-horizon log-returns converge to normality. Simple returns require multiplication: R(t,t+k) = ∏(1 + Rᵢ) − 1, which is far less convenient mathematically.",
                },
                {
                  id: "found-ds-q3",
                  question:
                    "You compute σ = 0.0004 and MAD-based σ = 0.00035 for the same return series. What does this tell you?",
                  options: [
                    { id: "found-ds-q3-a", text: "The data has no outliers" },
                    { id: "found-ds-q3-b", text: "Standard deviation is inflated by extreme returns — outliers are present" },
                    { id: "found-ds-q3-c", text: "MAD is always smaller than σ regardless of the data" },
                    { id: "found-ds-q3-d", text: "The data is perfectly normally distributed" },
                  ],
                  correctOptionId: "found-ds-q3-b",
                  explanation:
                    "When standard σ > MAD-based σ, it means extreme observations are pulling the standard deviation upward. MAD is robust to outliers (breakdown point = 0.5), so the gap indicates fat-tailed behaviour. In normal data, the ratio should be ~1.0. A ratio of 0.0004/0.00035 = 1.14 suggests moderate outlier contamination — typical for forex data.",
                },
                {
                  id: "found-ds-q4",
                  question:
                    "A strategy has mean return = +0.02% per trade and median return = −0.01% per trade. What does this reveal?",
                  options: [
                    { id: "found-ds-q4-a", text: "The strategy is consistently profitable on every trade" },
                    { id: "found-ds-q4-b", text: "A few large winning trades inflate the mean — the typical trade actually loses money" },
                    { id: "found-ds-q4-c", text: "The strategy has zero skewness" },
                    { id: "found-ds-q4-d", text: "The strategy should be run with maximum leverage" },
                  ],
                  correctOptionId: "found-ds-q4-b",
                  explanation:
                    "When mean > median, the distribution is right-skewed — pulled upward by outlier wins. More than half the trades lose money (median < 0), but occasional large wins make the average positive. This is a classic trend-following profile: many small losses, few big wins. It's profitable on average but psychologically difficult and requires strict risk management to survive the losing streaks.",
                },
                {
                  id: "found-ds-q5",
                  question:
                    "To annualize the hourly standard deviation σₕ = 0.0004 for EUR/USD, you compute σ_annual = σₕ × √N. What is N?",
                  options: [
                    { id: "found-ds-q5-a", text: "365 × 24 = 8,760 (all hours in a calendar year)" },
                    { id: "found-ds-q5-b", text: "252 × 24 ≈ 6,048 (trading hours: 252 business days × 24-hour forex market)" },
                    { id: "found-ds-q5-c", text: "12 (months per year)" },
                    { id: "found-ds-q5-d", text: "52 (weeks per year)" },
                  ],
                  correctOptionId: "found-ds-q5-b",
                  explanation:
                    "Volatility scales by √(bars per year). For hourly forex data, the market trades ~24 hours/day for ~252 business days = ~6,048 hours/year. Using 8,760 (all calendar hours) would overestimate because weekends have zero trading. The √N scaling assumes returns are independent and identically distributed — an approximation, but standard practice. σ_annual = 0.0004 × √6048 ≈ 3.1% annualized.",
                },
                {
                  id: "found-ds-q6",
                  question:
                    "The Jarque-Bera test statistic JB = (n/6)(S² + κ²/4) for your return series is 15,000 with p < 0.001. What does this mean?",
                  options: [
                    { id: "found-ds-q6-a", text: "The returns are normally distributed" },
                    { id: "found-ds-q6-b", text: "The returns are non-normal, but skewness and kurtosis are both zero" },
                    { id: "found-ds-q6-c", text: "The returns deviate significantly from normality — both skewness and/or kurtosis contribute to the rejection" },
                    { id: "found-ds-q6-d", text: "The sample size is too small to draw conclusions" },
                  ],
                  correctOptionId: "found-ds-q6-c",
                  explanation:
                    "The Jarque-Bera test is a joint test of S = 0 (no skewness) AND κ = 0 (no excess kurtosis). JB = 15,000 >> χ²(2) critical value of 5.99 at α = 0.05, so we overwhelmingly reject H₀: normality. The test is a sum of S² (skewness term) and κ²/4 (kurtosis term), so a large JB could come from extreme kurtosis alone, extreme skewness alone, or both. For forex data, the kurtosis term typically dominates.",
                },
              ],
            },

            // ── PRACTICE 1 ─────────────────────────────────────────
            {
              type: "practice",
              title: "Hands-On: Compute Statistics for Multiple Pairs",
              description:
                "Load hourly data for EUR/USD, GBP/USD, USD/JPY, AUD/USD, and USD/CHF. For each pair, compute all four moments plus the Jarque-Bera test. Create a summary table comparing the pairs. Which pair has the heaviest tails (highest κ)? Which is most negatively skewed? Does any pair fail to reject normality? Discuss why carry trade pairs (AUD) tend to have more negative skewness than major pairs.",
              catalogModelId: "statistical-analysis",
            },

            // ── PRACTICE 2 ─────────────────────────────────────────
            {
              type: "practice",
              title: "Dashboard Exercise: Rolling Volatility Regimes",
              description:
                "Open the dashboard's Data Analytics page and select EUR/USD hourly data. Compute 24-bar and 120-bar rolling standard deviations. Identify the top 5 highest-volatility periods in the dataset. For each, check: (1) What news event caused the spike? (2) How did skewness and kurtosis change during the spike? (3) How long did it take for volatility to return to the median? This exercise builds intuition for volatility clustering — the observation that high-vol periods tend to follow high-vol periods (GARCH effects).",
            },
          ],
        },
        {
          id: "found-probability",
          title: "Probability Distributions in Finance",
          description:
            "Master the Normal, Student-t, and log-normal distributions from first principles — derive their PDFs, understand moment existence conditions, and learn why financial returns require fat-tailed models. Build QQ-plots from scratch, run formal goodness-of-fit tests (KS, Chi-square), and fit Gaussian mixture models to capture multi-regime market behaviour.",
          estimatedMinutes: 90,
          difficulty: "beginner",
          sections: [
            // ── OBJECTIVE ──────────────────────────────────────────
            {
              type: "objective",
              content:
                "By the end of this lesson you will be able to: (1) derive the Normal PDF from maximum-entropy principles and compute tail probabilities at arbitrary σ-levels, (2) construct the Student-t distribution as Z/√(V/ν) and explain why the degrees-of-freedom parameter ν controls tail heaviness and moment existence, (3) explain why prices follow a log-normal distribution while returns do not, (4) build a QQ-plot from scratch and interpret departures from the reference line, (5) run and interpret the Kolmogorov-Smirnov and Chi-square goodness-of-fit tests, (6) model multi-regime return distributions using Gaussian mixture models, and (7) fit distributions via maximum likelihood estimation and compare models using BIC/AIC.",
              keyTakeaways: [
                "The Normal PDF f(x) = (1/σ√(2π))·exp[−(x−μ)²/(2σ²)] is the maximum-entropy distribution for a given mean and variance — any other distribution with the same μ and σ² has *less* entropy",
                "The Student-t distribution is constructed as T = Z/√(V/ν) where Z ~ N(0,1) and V ~ χ²(ν), producing polynomial tail decay (1+t²/ν)^(−(ν+1)/2) instead of exponential — dramatically more probability mass in the extremes",
                "Log-normal distributions model *prices* (Pₜ = P₀·exp(∑rₜ) > 0 always) while returns rₜ are modelled directly with symmetric or fat-tailed distributions",
                "QQ-plots compare sorted empirical quantiles against theoretical quantiles — S-shaped departures reveal fat tails, shifted curves reveal location/scale mismatch",
                "The KS test measures D_n = sup|F_n(x) − F(x)| — the maximum vertical gap between empirical and theoretical CDFs — providing a distribution-free goodness-of-fit test",
                "The Chi-square test bins data and computes χ² = Σ(Oᵢ−Eᵢ)²/Eᵢ to test whether observed frequencies match expected frequencies under a hypothesized distribution",
                "Gaussian mixture models p(x) = Σ wₖ·N(x|μₖ,σₖ²) capture multi-regime markets: low-volatility, normal, and crisis regimes each get their own Gaussian component",
                "MLE fitting maximizes L(θ) = Πᵢ f(xᵢ|θ) — equivalently minimizes −log L — and model selection uses BIC = −2·log L + k·log(n) to penalize complexity",
              ],
            },

            // ── THEORY 1: The Normal Distribution ────────────────────
            {
              type: "theory",
              title: "The Normal (Gaussian) Distribution: Derivation & Properties",
              content:
                "**Derivation from maximum entropy.** Among all continuous distributions on (−∞, ∞) with a specified mean μ and variance σ², the **Normal distribution** uniquely maximizes the differential entropy H = −∫f(x)·ln f(x) dx. The proof uses calculus of variations with Lagrange multipliers: we constrain ∫f = 1, ∫x·f = μ, and ∫(x−μ)²·f = σ², then maximize −∫f·ln f. The Euler-Lagrange equation yields ln f(x) = −λ₀ − λ₁x − λ₂(x−μ)², which is a quadratic in x inside an exponential — precisely the Gaussian form. Solving the multipliers gives the **PDF**: f(x) = (1 / σ√(2π)) · exp[−(x − μ)² / (2σ²)]. This is why the Normal distribution is the 'default' model when only mean and variance are known: it assumes *nothing* beyond those two moments, making it the least-biased choice.\n\n**Key properties.** E[X] = μ (by symmetry), Var(X) = σ² (by construction). The distribution is perfectly symmetric: skewness = 0, kurtosis = 3 (excess kurtosis κ = 0). The **moment generating function** is M(t) = exp(μt + σ²t²/2), from which all moments can be derived by differentiation: E[Xⁿ] = dⁿM/dtⁿ|_{t=0}. The **68-95-99.7 rule**: P(|X−μ| ≤ σ) = 0.6827, P(|X−μ| ≤ 2σ) = 0.9545, P(|X−μ| ≤ 3σ) = 0.9973. Beyond 3σ, probabilities drop exponentially: P(|X−μ| > 4σ) = 6.33 × 10⁻⁵ (about 1 in 15,787), P(|X−μ| > 5σ) = 5.73 × 10⁻⁷ (about 1 in 1.74 million). The **Central Limit Theorem** guarantees that sums of i.i.d. random variables converge to normality regardless of the original distribution — this is why log-returns (which are sums over shorter intervals) tend toward normality at longer horizons.\n\n**Numerical example with EUR/USD.** Suppose EUR/USD hourly log-returns have μ = 0.000002 and σ = 0.00038. Under a Normal model, the probability of a 4σ move (|r| > 0.00152) is 6.33 × 10⁻⁵, meaning we expect one such event every 15,787 hours ≈ 2.6 years. But empirically, 4σ moves in EUR/USD occur roughly every 100–200 hours — about **80–160× more often** than the Gaussian predicts. Similarly, 5σ moves (|r| > 0.0019) should happen once in 1.74 million hours ≈ 290 years under normality, yet they occur several times per year in practice. This catastrophic underestimation of tail risk is why the Normal distribution alone is insufficient for financial risk management — we need fat-tailed alternatives.",
            },

            // ── THEORY 2: The Student-t Distribution ─────────────────
            {
              type: "theory",
              title: "The Student-t Distribution: Construction, Moments & Tail Behaviour",
              content:
                "**Construction.** Let Z ~ N(0,1) and V ~ χ²(ν) be independent. Define T = Z / √(V/ν). Then T follows a **Student-t distribution** with ν degrees of freedom. The intuition: V/ν estimates the variance of Z, but with finite ν this estimate is noisy — sometimes too small (inflating T, creating heavy tails) and sometimes too large (compressing T). As ν → ∞, V/ν → 1 by the law of large numbers, so T → Z and the Student-t converges to the Normal.\n\n**Full PDF.** f(t) = [Γ((ν+1)/2) / (√(νπ) · Γ(ν/2))] · (1 + t²/ν)^(−(ν+1)/2), where Γ is the gamma function. The critical difference from the Normal is the **tail decay**: the Normal decays as exp(−t²/2) (super-exponential), while the Student-t decays as |t|^(−(ν+1)) (polynomial). This polynomial decay means extreme values are *orders of magnitude* more likely. For example, at t = 6: the Normal PDF is ≈ 6.1 × 10⁻⁹, but the t(5) PDF is ≈ 1.5 × 10⁻⁴ — roughly **25,000× larger**.\n\n**Moment existence — a crucial subtlety.** The Student-t with ν degrees of freedom only has finite moments up to order ν: the **mean** exists only for ν > 1 (for ν ≤ 1, the integral ∫t·f(t)dt diverges — this is the Cauchy distribution case). The **variance** is ν/(ν−2) for ν > 2, and is infinite for 1 < ν ≤ 2. The **excess kurtosis** κ = 6/(ν−4) exists only for ν > 4. Let us derive this: Kurt(T) = E[T⁴]/(E[T²])² = E[T⁴]/(ν/(ν−2))². Using the identity E[T²ᵏ] = νᵏ · Γ(k+1/2)·Γ(ν/2−k) / (√π·Γ(ν/2)) and evaluating at k=2, we get E[T⁴] = 3ν² / ((ν−2)(ν−4)) for ν > 4. Then Kurt(T) = [3ν²/((ν−2)(ν−4))] / [ν/(ν−2)]² = 3ν²(ν−2)² / ((ν−2)(ν−4)·ν²) = 3(ν−2)/((ν−4)), so excess kurtosis = 3(ν−2)/(ν−4) − 3 = (3ν−6−3ν+12)/(ν−4) = **6/(ν−4)**. For ν = 5: κ = 6/1 = 6 (very fat-tailed). For ν = 10: κ = 6/6 = 1 (moderately fat). For ν = 30: κ = 6/26 ≈ 0.23 (nearly Gaussian). Most forex pairs fit with ν ∈ [3, 8], giving κ ∈ [1.5, ∞) — far from the Gaussian κ = 0.\n\n**Numerical comparison.** Consider P(|T| > 4) for t(5) vs N(0,1). For N(0,1): P(|Z| > 4) = 2·Φ(−4) ≈ 2 × 3.17 × 10⁻⁵ = 6.33 × 10⁻⁵. For t(5): P(|T| > 4) ≈ 2 × 0.00509 = 0.01018 — that is **161× more likely** than under the Normal. A 4σ event that 'should never happen' under Gaussian assumptions actually has a ~1% chance with t(5). This is why risk models that assume normality systematically underestimate tail risk in forex markets.",
            },

            // ── THEORY 3: QQ-Plots, GoF Tests & Mixtures ─────────────
            {
              type: "theory",
              title: "QQ-Plots, Goodness-of-Fit Tests & Mixture Distributions",
              content:
                "**QQ-plot construction algorithm.** Given n observations x₁, …, xₙ and a reference distribution F: (1) Sort the data: x₍₁₎ ≤ x₍₂₎ ≤ … ≤ x₍ₙ₎. (2) For each rank i, compute the theoretical quantile qᵢ = F⁻¹((i − 0.5)/n) — the 0.5 adjustment (Hazen plotting position) avoids 0 and 1. (3) Plot (qᵢ, x₍ᵢ₎). If the data follows F exactly, points lie on the line y = x. **Interpretation**: an S-shaped departure (points below the line on the left, above on the right) indicates fat tails. A banana curve (points consistently above or below) indicates skewness. A shift indicates location mismatch. QQ-plots are the single most informative visual diagnostic for distribution fit — always plot one before trusting any parametric model.\n\n**Kolmogorov-Smirnov (KS) test.** The KS test computes the statistic D_n = sup_x |F_n(x) − F₀(x)|, where F_n is the empirical CDF (step function jumping 1/n at each data point) and F₀ is the hypothesized CDF. D_n measures the **maximum vertical gap** between the two CDFs. Under H₀ (data comes from F₀), √n · D_n converges to the Kolmogorov distribution. The p-value is P(D ≥ D_n | H₀): if p < α (typically 0.05), we reject the null. **Advantage**: distribution-free, works for any continuous F₀. **Limitation**: most sensitive near the center of the distribution (where the CDF has the steepest slope), less sensitive in the tails — precisely where we care most in finance. Also, parameters estimated from the same data inflate the test statistic, requiring the Lilliefors correction.\n\n**Chi-square goodness-of-fit test.** Partition the real line into k bins (e.g., k = 20 equal-probability bins under F₀). Count observed frequencies O₁, …, Oₖ and compute expected frequencies Eᵢ = n · P(bin i | F₀). The test statistic is χ² = Σᵢ (Oᵢ − Eᵢ)² / Eᵢ, which follows a χ²(k − 1 − p) distribution under H₀, where p is the number of estimated parameters. A large χ² (small p-value) rejects the hypothesized distribution. **Advantage**: directly tests the frequency structure. **Limitation**: results depend on binning choice; each bin should have Eᵢ ≥ 5 for the approximation to hold.\n\n**Mixture distributions for multi-regime markets.** Markets cycle through distinct regimes — quiet (low vol), normal, and crisis (high vol). A single Gaussian cannot capture this. A **Gaussian mixture model** (GMM) with K components has density p(x) = Σₖ wₖ · N(x | μₖ, σₖ²), where wₖ ≥ 0 and Σwₖ = 1. With K = 2 components, the GMM captures a 'calm' regime (small σ₁, large w₁) and a 'crisis' regime (large σ₂, small w₂). The EM algorithm iterates: E-step assigns soft cluster memberships, M-step updates μₖ, σₖ, wₖ. Model selection uses BIC = −2·log L + k·log(n) or AIC = −2·log L + 2k, where lower is better. A 2-component mixture often dramatically outperforms a single Gaussian for forex returns, reflecting the well-documented phenomenon of volatility clustering.",
            },

            // ── INTUITION 1 ────────────────────────────────────────
            {
              type: "intuition",
              title: "The Dartboard Analogy",
              analogy:
                "Throwing darts at a board is like sampling from a distribution — but the type of player determines the tail behaviour.",
              content:
                "Imagine you throw darts at a bullseye. A **Normal distribution** says most darts land near the center and virtually none hit the wall — the probability dies off exponentially fast, like exp(−d²). A professional darts player might throw 10,000 darts without ever hitting the wall. But the **Student-t distribution** is like a player who *occasionally* has a muscle spasm — the 'wall hits' (tail events) are rare but not impossibly so, because probability decays polynomially like 1/d⁴ instead of exponentially. After 10,000 throws, you'd see several wall hits. Using a Normal model is like pretending the wall never gets hit — until a flash crash proves otherwise.\n\nNow extend the analogy to **mixture distributions**: imagine two different players alternate — a steady professional (small σ, tight cluster) and a nervous amateur (large σ, wide scatter). The combined pattern on the board wouldn't look Gaussian — it would have a dense center cluster plus a diffuse halo. That's exactly what a 2-component Gaussian mixture captures: the 'professional' component models quiet markets, the 'amateur' component models volatile regimes. The mixture weight tells you how often each player is throwing — i.e., what fraction of time the market spends in each regime.",
              emoji: "🎯",
            },

            // ── INTUITION 2 ────────────────────────────────────────
            {
              type: "intuition",
              title: "The Earthquake Magnitude Analogy",
              analogy:
                "Earthquake frequency teaches us that extreme events are far more common than bell curves predict.",
              content:
                "Consider earthquake magnitudes on the Richter scale. Small tremors (magnitude 2-3) happen thousands of times daily worldwide. Moderate quakes (magnitude 5-6) happen several times a month. A **Normal distribution** fitted to small tremors would predict that a magnitude-8 earthquake should occur roughly once every 10 million years — essentially never in human history. Yet we observe magnitude-8+ events every few years. The Gutenberg-Richter law shows that earthquake magnitudes follow a **power-law** (heavy-tailed) distribution, not a Gaussian one.\n\nForex markets behave similarly. Daily returns of 0.1-0.3% are the 'small tremors' — constant background noise. A 1% daily move is the 'moderate quake' — notable but not unusual. The Normal model says a 3-4% daily move (the 'magnitude 8') should essentially never happen. Yet the Swiss National Bank's abandonment of the EUR/CHF floor in January 2015 produced a **30% move in minutes** — an event so extreme that under Gaussian assumptions, it shouldn't occur once in the entire age of the universe. The Student-t distribution and mixture models don't predict *when* such events will occur, but they correctly assign them non-negligible probability, which is the difference between a risk model that works and one that bankrupts you.",
              emoji: "🌍",
            },

            // ── CODE 1: Normal and Student-t PDFs from Scratch ───────
            {
              type: "code",
              title: "Computing Normal and Student-t PDFs from Scratch",
              language: "python",
              code: `import numpy as np
from scipy.special import gamma as gamma_fn
from scipy import stats

# ──────────────────────────────────────────────────────────
# Manual Normal PDF implementation
# ──────────────────────────────────────────────────────────
def normal_pdf(x, mu=0.0, sigma=1.0):
    """Gaussian PDF: f(x) = (1/σ√(2π)) · exp[-(x-μ)²/(2σ²)]"""
    coeff = 1.0 / (sigma * np.sqrt(2.0 * np.pi))
    exponent = -0.5 * ((x - mu) / sigma) ** 2
    return coeff * np.exp(exponent)

# ──────────────────────────────────────────────────────────
# Manual Student-t PDF implementation
# ──────────────────────────────────────────────────────────
def student_t_pdf(x, nu):
    """Student-t PDF using the Gamma function."""
    coeff = gamma_fn((nu + 1) / 2) / (np.sqrt(nu * np.pi) * gamma_fn(nu / 2))
    body = (1.0 + x**2 / nu) ** (-(nu + 1) / 2)
    return coeff * body

# ──────────────────────────────────────────────────────────
# Compare tail probabilities at 3σ, 4σ, 5σ, 6σ
# ──────────────────────────────────────────────────────────
print("=" * 68)
print("  Tail Probability Comparison: P(|X| > kσ)")
print("=" * 68)
print(f"{'k':>4s}  {'Normal P(|X|>k)':>18s}  {'t(ν=5) P(|T|>k)':>18s}  {'Ratio t/N':>12s}")
print("-" * 68)

for k in [3, 4, 5, 6]:
    p_normal = 2 * stats.norm.sf(k)          # two-tailed
    p_t5     = 2 * stats.t.sf(k, df=5)       # two-tailed, ν=5
    ratio    = p_t5 / p_normal if p_normal > 0 else float('inf')
    print(f"{k:>4d}  {p_normal:>18.6e}  {p_t5:>18.6e}  {ratio:>12.1f}x")

print()

# ──────────────────────────────────────────────────────────
# Verify manual PDFs match scipy at key points
# ──────────────────────────────────────────────────────────
print("Verification: manual vs scipy PDF at x = 3.0")
print(f"  Normal manual: {normal_pdf(3.0):.10f}")
print(f"  Normal scipy:  {stats.norm.pdf(3.0):.10f}")
print(f"  t(5) manual:   {student_t_pdf(3.0, 5):.10f}")
print(f"  t(5) scipy:    {stats.t.pdf(3.0, 5):.10f}")
print()

# ──────────────────────────────────────────────────────────
# PDF comparison at x = 4 (the "4-sigma event")
# ──────────────────────────────────────────────────────────
x_val = 4.0
pdf_normal = normal_pdf(x_val)
for nu in [3, 5, 10, 30]:
    pdf_t = student_t_pdf(x_val, nu)
    print(f"At x=4: t(ν={nu:>2d}) PDF = {pdf_t:.6e}, "
          f"ratio to Normal = {pdf_t / pdf_normal:>10.1f}x")
print(f"At x=4: Normal  PDF = {pdf_normal:.6e} (baseline)")`,
              explanation:
                "This program implements both PDFs from their mathematical definitions and produces a formatted comparison table. The key revelation is in the ratios: at 4σ, the Student-t(5) assigns **161× more probability** than the Normal. At 6σ, the ratio exceeds 100,000×. This isn't an academic curiosity — it means a Normal-based VaR model would tell you a 4σ loss 'essentially never happens', while the Student-t correctly warns it has a ~1% probability. The verification section confirms our manual implementations match scipy exactly, building confidence in the formulas.",
            },

            // ── CODE 2: QQ-Plot & Goodness-of-Fit Tests ─────────────
            {
              type: "code",
              title: "QQ-Plot Construction & Goodness-of-Fit Tests",
              language: "python",
              code: `import numpy as np
import pandas as pd
from scipy import stats
import matplotlib.pyplot as plt

# ──────────────────────────────────────────────────────────
# Load data and compute log-returns
# ──────────────────────────────────────────────────────────
prices = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
returns = np.log(prices["close"] / prices["close"].shift(1)).dropna().values
n = len(returns)
mu, sigma = np.mean(returns), np.std(returns, ddof=1)
print(f"Loaded {n:,} log-returns | μ = {mu:.6e} | σ = {sigma:.6e}")

# ──────────────────────────────────────────────────────────
# Build QQ-plot from scratch (no probplot shortcut)
# ──────────────────────────────────────────────────────────
sorted_returns = np.sort(returns)
# Hazen plotting positions: (i - 0.5) / n
plotting_positions = (np.arange(1, n + 1) - 0.5) / n
theoretical_quantiles = stats.norm.ppf(plotting_positions, loc=mu, scale=sigma)

fig, axes = plt.subplots(1, 3, figsize=(18, 5))

# Panel 1: Manual QQ-plot vs Normal
axes[0].scatter(theoretical_quantiles, sorted_returns, s=1, alpha=0.5, color="steelblue")
qq_min = min(theoretical_quantiles.min(), sorted_returns.min())
qq_max = max(theoretical_quantiles.max(), sorted_returns.max())
axes[0].plot([qq_min, qq_max], [qq_min, qq_max], "r--", lw=1.5, label="y = x")
axes[0].set_xlabel("Theoretical Normal Quantiles")
axes[0].set_ylabel("Empirical Quantiles")
axes[0].set_title("QQ-Plot vs Normal (built from scratch)")
axes[0].legend()

# Panel 2: QQ-plot vs Student-t (fitted ν)
df_t, mu_t, sigma_t = stats.t.fit(returns)
t_quantiles = stats.t.ppf(plotting_positions, df=df_t, loc=mu_t, scale=sigma_t)
axes[1].scatter(t_quantiles, sorted_returns, s=1, alpha=0.5, color="darkorange")
qq_min_t = min(t_quantiles.min(), sorted_returns.min())
qq_max_t = max(t_quantiles.max(), sorted_returns.max())
axes[1].plot([qq_min_t, qq_max_t], [qq_min_t, qq_max_t], "r--", lw=1.5, label="y = x")
axes[1].set_xlabel(f"Theoretical t(ν={df_t:.1f}) Quantiles")
axes[1].set_ylabel("Empirical Quantiles")
axes[1].set_title(f"QQ-Plot vs Student-t (ν={df_t:.1f})")
axes[1].legend()

# Panel 3: Histogram with overlaid PDFs
x_grid = np.linspace(sorted_returns.min(), sorted_returns.max(), 500)
axes[2].hist(returns, bins=100, density=True, alpha=0.5, color="gray", label="Empirical")
axes[2].plot(x_grid, stats.norm.pdf(x_grid, mu, sigma), "b-", lw=2, label="Normal")
axes[2].plot(x_grid, stats.t.pdf(x_grid, df_t, mu_t, sigma_t), "r-", lw=2,
             label=f"Student-t (ν={df_t:.1f})")
axes[2].set_title("Histogram with Fitted PDFs")
axes[2].legend()
plt.tight_layout()
plt.savefig("qq_and_gof.png", dpi=150)
print("Saved qq_and_gof.png")

# ──────────────────────────────────────────────────────────
# Kolmogorov-Smirnov test vs Normal
# ──────────────────────────────────────────────────────────
ks_stat, ks_pvalue = stats.kstest(returns, "norm", args=(mu, sigma))
print(f"\\nKS Test vs Normal: D_n = {ks_stat:.6f}, p-value = {ks_pvalue:.4e}")
print(f"  → {'REJECT' if ks_pvalue < 0.05 else 'FAIL TO REJECT'} normality at α = 0.05")

# KS test vs fitted Student-t
ks_stat_t, ks_pvalue_t = stats.kstest(returns, "t", args=(df_t, mu_t, sigma_t))
print(f"KS Test vs t(ν={df_t:.1f}): D_n = {ks_stat_t:.6f}, p-value = {ks_pvalue_t:.4e}")
print(f"  → {'REJECT' if ks_pvalue_t < 0.05 else 'FAIL TO REJECT'} Student-t at α = 0.05")

# ──────────────────────────────────────────────────────────
# Chi-square goodness-of-fit test vs Normal
# ──────────────────────────────────────────────────────────
k_bins = 20  # number of equal-probability bins
bin_edges = stats.norm.ppf(np.linspace(0, 1, k_bins + 1), loc=mu, scale=sigma)
bin_edges[0], bin_edges[-1] = -np.inf, np.inf  # catch all tails
observed, _ = np.histogram(returns, bins=bin_edges)
expected = np.full(k_bins, n / k_bins)  # equal-probability bins → equal expected

chi2_stat = np.sum((observed - expected)**2 / expected)
chi2_df = k_bins - 1 - 2  # subtract 1 for constraint, 2 for estimated params (μ, σ)
chi2_pvalue = 1 - stats.chi2.cdf(chi2_stat, chi2_df)

print(f"\\nChi-square GoF vs Normal:")
print(f"  χ² = {chi2_stat:.2f}, df = {chi2_df}, p-value = {chi2_pvalue:.4e}")
print(f"  → {'REJECT' if chi2_pvalue < 0.05 else 'FAIL TO REJECT'} normality at α = 0.05")
print(f"  Observed vs Expected per bin (first 5):")
for i in range(5):
    print(f"    Bin {i+1}: O={observed[i]:>5d}, E={expected[i]:>7.1f}, "
          f"(O-E)²/E = {(observed[i]-expected[i])**2/expected[i]:.2f}")`,
              explanation:
                "This program builds a QQ-plot entirely from scratch — sorting data, computing Hazen plotting positions, and inverting the CDF — rather than relying on scipy's probplot shortcut. The three-panel figure shows the Normal QQ-plot (expect S-shaped departure), the Student-t QQ-plot (expect much better fit), and the histogram with both fitted PDFs overlaid. The KS test computes the supremum distance between empirical and theoretical CDFs: a tiny p-value means the fit is poor. The chi-square test bins returns into 20 equal-probability bins and checks whether the observed counts match expectations. For forex data, the Normal will be overwhelmingly rejected by both tests, while the Student-t typically passes or comes much closer.",
            },

            // ── CODE 3: Gaussian Mixture Models ─────────────────────
            {
              type: "code",
              title: "Fitting Gaussian Mixture Models to Multi-Regime Returns",
              language: "python",
              code: `import numpy as np
import pandas as pd
from sklearn.mixture import GaussianMixture
from scipy import stats

# ──────────────────────────────────────────────────────────
# Load data
# ──────────────────────────────────────────────────────────
prices = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
returns = np.log(prices["close"] / prices["close"].shift(1)).dropna().values
n = len(returns)
X = returns.reshape(-1, 1)  # sklearn expects 2D array
print(f"Fitting GMMs to {n:,} EUR/USD hourly log-returns\\n")

# ──────────────────────────────────────────────────────────
# Fit 1, 2, and 3 component Gaussian Mixtures
# ──────────────────────────────────────────────────────────
results = {}
print(f"{'K':>3s}  {'Log-Likelihood':>16s}  {'AIC':>12s}  {'BIC':>12s}")
print("-" * 50)

for k in [1, 2, 3]:
    gmm = GaussianMixture(n_components=k, covariance_type="full",
                          n_init=10, random_state=42, max_iter=500)
    gmm.fit(X)
    ll = gmm.score(X) * n        # total log-likelihood
    aic = gmm.aic(X)
    bic = gmm.bic(X)
    results[k] = {"model": gmm, "ll": ll, "aic": aic, "bic": bic}
    print(f"{k:>3d}  {ll:>16.2f}  {aic:>12.2f}  {bic:>12.2f}")

# ──────────────────────────────────────────────────────────
# Select best model by BIC (lower is better)
# ──────────────────────────────────────────────────────────
best_k = min(results, key=lambda k: results[k]["bic"])
best_gmm = results[best_k]["model"]
print(f"\\nBest model by BIC: K = {best_k} components")
print(f"  ΔBIC(K=1 vs K={best_k}) = {results[1]['bic'] - results[best_k]['bic']:.2f}")

# ──────────────────────────────────────────────────────────
# Print component parameters and interpret as regimes
# ──────────────────────────────────────────────────────────
regime_labels = ["Low-Volatility", "Normal", "High-Volatility/Crisis"]
print(f"\\n{'Component':>12s}  {'Weight':>8s}  {'Mean':>12s}  {'Std Dev':>12s}  {'Ann. Vol':>10s}  Regime")
print("-" * 80)

# Sort components by variance (ascending) for consistent labelling
order = np.argsort(best_gmm.covariances_.flatten())
for idx, comp_idx in enumerate(order):
    w = best_gmm.weights_[comp_idx]
    mu = best_gmm.means_[comp_idx, 0]
    sigma = np.sqrt(best_gmm.covariances_[comp_idx, 0, 0])
    ann_vol = sigma * np.sqrt(252 * 24)
    label = regime_labels[idx] if idx < len(regime_labels) else f"Regime {idx+1}"
    print(f"{idx+1:>12d}  {w:>8.4f}  {mu:>12.6e}  {sigma:>12.6e}  {ann_vol:>9.2%}  {label}")

# ──────────────────────────────────────────────────────────
# Compare single Gaussian vs best mixture
# ──────────────────────────────────────────────────────────
print(f"\\nSingle Gaussian: σ = {np.std(returns):.6e}, Ann. Vol = "
      f"{np.std(returns) * np.sqrt(252*24):.2%}")
print(f"The mixture reveals that the single-Gaussian volatility is a "
      f"*weighted average* of distinct regime volatilities.")
print(f"During the crisis regime, true volatility is much higher than "
      f"the unconditional estimate suggests.")`,
              explanation:
                "This program fits 1, 2, and 3 component Gaussian mixtures and uses BIC to select the optimal number of components. For forex data, K=2 typically wins: a dominant low-volatility regime (w ≈ 0.7-0.85, small σ) and a minority high-volatility regime (w ≈ 0.15-0.30, large σ). The single-Gaussian volatility is a blend of both — it overestimates risk in calm periods and *underestimates* it during crises. This is the fundamental insight behind regime-switching models: a single volatility number hides the fact that markets alternate between qualitatively different states.",
            },

            // ── QUIZ (7 questions) ──────────────────────────────────
            {
              type: "quiz",
              questions: [
                {
                  id: "found-prob-q1",
                  question:
                    "Why are asset prices modelled as log-normal rather than normal?",
                  options: [
                    { id: "found-prob-q1-a", text: "Log-normal distributions always have zero skewness" },
                    { id: "found-prob-q1-b", text: "If log-returns rₜ ~ N(μ,σ²), then Pₜ = P₀·exp(Σrₜ) is log-normal and strictly positive — normal prices could go negative" },
                    { id: "found-prob-q1-c", text: "Log-normal distributions have thinner tails than normal distributions" },
                    { id: "found-prob-q1-d", text: "Prices are always integers, so log-normal is required" },
                  ],
                  correctOptionId: "found-prob-q1-b",
                  explanation:
                    "A normal distribution assigns nonzero probability to negative values, which is impossible for asset prices. If log-returns are normally distributed, then prices Pₜ = P₀ · exp(Σrₜ) follow a log-normal distribution by definition. The exponential function ensures prices are always strictly positive. This is also the foundation of geometric Brownian motion in the Black-Scholes framework.",
                },
                {
                  id: "found-prob-q2",
                  question:
                    "For a Student-t distribution with ν = 5 degrees of freedom, what is the excess kurtosis?",
                  options: [
                    { id: "found-prob-q2-a", text: "0 (same as Normal)" },
                    { id: "found-prob-q2-b", text: "6 / (5 − 4) = 6" },
                    { id: "found-prob-q2-c", text: "5 / 6 ≈ 0.83" },
                    { id: "found-prob-q2-d", text: "Undefined — kurtosis requires ν > 6" },
                  ],
                  correctOptionId: "found-prob-q2-b",
                  explanation:
                    "The excess kurtosis of a Student-t distribution is κ = 6/(ν−4) for ν > 4. With ν = 5: κ = 6/(5−4) = 6, meaning the fourth moment is 6 units above the Gaussian baseline of 0. This was derived in the theory section by computing E[T⁴]/(E[T²])² and subtracting 3. For ν ≤ 4, the fourth moment is infinite and excess kurtosis is undefined.",
                },
                {
                  id: "found-prob-q3",
                  question:
                    "A KS test of your return data vs a fitted Normal gives D_n = 0.047 with p = 0.0001. What is the correct interpretation?",
                  options: [
                    { id: "found-prob-q3-a", text: "The data is perfectly normal — p is the probability of normality" },
                    { id: "found-prob-q3-b", text: "The maximum vertical gap between the empirical and Normal CDFs is 4.7%, and p < 0.05 means we reject the Normal hypothesis" },
                    { id: "found-prob-q3-c", text: "47% of the data is non-normal" },
                    { id: "found-prob-q3-d", text: "The test is invalid because financial data cannot be tested" },
                  ],
                  correctOptionId: "found-prob-q3-b",
                  explanation:
                    "D_n = 0.047 means the largest vertical gap between the empirical CDF F_n(x) and the fitted Normal CDF F₀(x) is 4.7% of the probability scale. The p-value of 0.0001 means that if the data truly came from that Normal distribution, the probability of observing a gap this large or larger is only 0.01%. Since p < α = 0.05, we reject H₀. Note that the KS test is most sensitive near the CDF's steepest region (center), so tail deviations may be even worse than D_n suggests.",
                },
                {
                  id: "found-prob-q4",
                  question:
                    "Your QQ-plot of EUR/USD returns vs Normal shows points that follow the reference line in the center but curve sharply away at both extremes (S-shape). What does this indicate?",
                  options: [
                    { id: "found-prob-q4-a", text: "The data is perfectly normally distributed" },
                    { id: "found-prob-q4-b", text: "The data has lighter tails than the Normal (platykurtic)" },
                    { id: "found-prob-q4-c", text: "The data has fatter tails than the Normal — empirical extremes are more extreme than the Gaussian predicts" },
                    { id: "found-prob-q4-d", text: "The mean is incorrectly estimated" },
                  ],
                  correctOptionId: "found-prob-q4-c",
                  explanation:
                    "An S-shaped QQ-plot means the empirical quantiles in both tails exceed what the Normal distribution predicts. On the left tail, sorted returns are more negative than Normal quantiles (points curve below the line); on the right tail, sorted returns are more positive (points curve above the line). This is the hallmark of leptokurtic (fat-tailed) data. The center of the distribution still matches well, which is why the S-shape appears — the Normal captures the bulk but misses the extremes.",
                },
                {
                  id: "found-prob-q5",
                  question:
                    "A chi-square goodness-of-fit test with 20 bins gives χ² = 185.3 with df = 17 and p < 0.0001. The largest contributions come from the two outermost bins. What does this tell you?",
                  options: [
                    { id: "found-prob-q5-a", text: "The chi-square test is broken — 185.3 is too large to be meaningful" },
                    { id: "found-prob-q5-b", text: "The hypothesized distribution fails primarily in the tails — extreme returns occur much more often than expected" },
                    { id: "found-prob-q5-c", text: "You need more bins to get a valid result" },
                    { id: "found-prob-q5-d", text: "The data has too few observations for the test" },
                  ],
                  correctOptionId: "found-prob-q5-b",
                  explanation:
                    "When the largest (Oᵢ−Eᵢ)²/Eᵢ contributions come from the outermost bins, it means far more extreme returns were observed than the hypothesized distribution predicted. With equal-probability bins, each bin should have about n/20 observations. If the tail bins contain 3-5× the expected count, the (O−E)²/E term dominates the total χ². This is classic fat-tail evidence and exactly what we expect when testing a Normal fit against forex returns.",
                },
                {
                  id: "found-prob-q6",
                  question:
                    "What happens to the Student-t distribution as ν → ∞?",
                  options: [
                    { id: "found-prob-q6-a", text: "It becomes a uniform distribution" },
                    { id: "found-prob-q6-b", text: "Its variance becomes infinite" },
                    { id: "found-prob-q6-c", text: "It converges to the standard Normal N(0,1) — tails thin out, kurtosis → 0, variance → 1" },
                    { id: "found-prob-q6-d", text: "It converges to an exponential distribution" },
                  ],
                  correctOptionId: "found-prob-q6-c",
                  explanation:
                    "As ν → ∞, the ratio V/ν in T = Z/√(V/ν) converges to 1 by the law of large numbers (since E[V/ν] = 1 for V ~ χ²(ν)). Therefore T → Z ~ N(0,1). Algebraically, the variance ν/(ν−2) → 1, excess kurtosis 6/(ν−4) → 0, and the PDF (1+t²/ν)^(−(ν+1)/2) → exp(−t²/2) · (1/√(2π)). At ν = 30, the Student-t is already nearly indistinguishable from the Normal for practical purposes.",
                },
                {
                  id: "found-prob-q7",
                  question:
                    "You fit a 2-component Gaussian mixture to USD/JPY returns and get: Component 1 (w=0.82, σ₁=0.03%) and Component 2 (w=0.18, σ₂=0.11%). What is the best interpretation?",
                  options: [
                    { id: "found-prob-q7-a", text: "The data is bimodal with two distinct peaks" },
                    { id: "found-prob-q7-b", text: "82% of the time the market is in a calm regime (σ≈0.03%), and 18% of the time it enters a high-volatility regime (σ≈0.11%) — roughly 3.7× more volatile" },
                    { id: "found-prob-q7-c", text: "The mixture model is overfitting — one component is sufficient" },
                    { id: "found-prob-q7-d", text: "Component 2 represents measurement errors in the data" },
                  ],
                  correctOptionId: "found-prob-q7-b",
                  explanation:
                    "The two components correspond to distinct market regimes: a dominant calm period (82% of hours, low σ) and a minority crisis/news regime (18% of hours, high σ). The ratio σ₂/σ₁ ≈ 3.7 means volatility nearly quadruples during regime shifts. A single-Gaussian σ would average across both regimes, underestimating crisis risk and overestimating calm-period risk. This mixture interpretation directly informs position sizing: reduce size when regime 2 is detected, increase when regime 1 dominates.",
                },
              ],
            },

            // ── PRACTICE 1 ─────────────────────────────────────────
            {
              type: "practice",
              title: "Hands-On: Distribution Fitting & KS Testing Across Forex Pairs",
              description:
                "Load hourly data for EUR/USD, GBP/USD, USD/JPY, AUD/USD, and USD/CHF. For each pair: (1) Fit both a Normal and a Student-t distribution via MLE. Record the fitted ν for each pair. (2) Run the KS test against both the Normal and Student-t fits — record D_n and p-value for each. (3) Create a summary table with columns: Pair | ν | KS_Normal_D | KS_Normal_p | KS_t_D | KS_t_p. (4) Which pair has the lowest ν (fattest tails)? Which pair comes closest to passing the KS test for normality? (5) For the fattest-tailed pair, compute P(|X| > 3σ) under both the fitted Normal and Student-t — how much does the Normal underestimate this probability? Discuss implications for stop-loss placement and position sizing.",
            },

            // ── PRACTICE 2 ─────────────────────────────────────────
            {
              type: "practice",
              title: "Dashboard Exercise: Distribution Fits & QQ-Plot Exploration",
              description:
                "Open the dashboard's Data Analytics page and select EUR/USD hourly data. Navigate to the distribution fitting panel: (1) Generate the QQ-plot against a Normal distribution — identify the S-shaped departure in the tails and estimate by eye where the empirical quantiles first deviate from the reference line (typically around ±2σ). (2) Switch the reference distribution to Student-t and observe how the QQ-plot straightens. (3) Examine the histogram overlay with fitted PDFs — note how the Student-t captures the peak height better than the Normal (leptokurtic distributions are both more peaked and fatter-tailed). (4) If a mixture model option is available, fit a 2-component GMM and identify the regime components. (5) Repeat for USD/JPY and compare: does the yen pair show different tail behaviour than the euro pair? Relate any differences to the known carry-trade dynamics of JPY.",
            },
          ],
        },
        {
          id: "found-hypothesis-testing",
          title: "Hypothesis Testing for Trading Signals",
          description:
            "Learn to rigorously test whether a trading signal has real predictive power using hypothesis testing, p-values, and corrections for multiple comparisons.",
          estimatedMinutes: 90,
          difficulty: "beginner",
          prerequisites: ["found-descriptive-stats", "found-probability"],
          sections: [
            {
              type: "objective",
              content:
                "By the end of this lesson you will be able to formulate null and alternative hypotheses for trading strategies, derive the one-sample t-statistic from first principles and connect it to the Student-t distribution, interpret p-values geometrically as tail areas under the t-distribution curve, classify Type I and Type II errors and compute statistical power, apply Bonferroni correction and the Benjamini-Hochberg FDR procedure to multiple testing scenarios, construct bootstrap hypothesis tests for non-normal return distributions, and quantify practical significance using Cohen's d effect size.",
              keyTakeaways: [
                "The null hypothesis H₀ assumes a strategy has zero expected return — the burden of proof is on you to reject it",
                "The t-statistic is derived by replacing the unknown population σ with the sample s in the Z-score formula, producing a Student-t distribution with n−1 degrees of freedom",
                "A p-value is the geometric area under the t-distribution curve in the tail beyond the observed test statistic — it is NOT the probability that H₀ is true",
                "Type I error (false positive) rate = α; Type II error (false negative) rate = β; statistical power = 1 − β depends on effect size, sample size, and α",
                "Bonferroni correction controls family-wise error rate (FWER) by testing each hypothesis at α/k — conservative but simple",
                "Benjamini-Hochberg controls the false discovery rate (FDR) — less conservative, more powerful, preferred when testing many strategies",
                "Bootstrap hypothesis testing builds the null distribution empirically by resampling, requiring no distributional assumptions",
                "Cohen's d = (x̄ − μ₀) / s quantifies effect size independently of sample size — a large t-stat with tiny Cohen's d means statistical but not practical significance",
              ],
            },
            {
              type: "theory",
              title: "The One-Sample t-Test: Full Derivation",
              content:
                "We begin with the most fundamental question in quantitative trading: does a strategy have a non-zero expected return? Suppose we observe n trade returns x₁, x₂, …, xₙ and wish to test **H₀: μ = μ₀** (typically μ₀ = 0, meaning no edge) against **H₁: μ > μ₀** (the strategy is profitable). The sample mean is **X̄ = (1/n) Σᵢ xᵢ**. By the Central Limit Theorem, if the xᵢ are i.i.d. with mean μ and variance σ², then X̄ ~ N(μ, σ²/n) for large n. Under H₀, we can standardize: **Z = (X̄ − μ₀) / (σ / √n)**, which follows a standard Normal N(0,1). However, we never know the true population standard deviation σ. When we replace σ with the sample standard deviation **s = √[(1/(n−1)) Σᵢ (xᵢ − X̄)²]**, the resulting statistic **t = (X̄ − μ₀) / (s / √n)** no longer follows a Normal distribution. William Sealy Gosset, publishing under the pseudonym 'Student' in 1908, proved that this ratio follows a **Student-t distribution with ν = n − 1 degrees of freedom**. The t-distribution has heavier tails than the Normal — reflecting the additional uncertainty from estimating σ — but converges to N(0,1) as n → ∞. The quantity s / √n is called the **standard error of the mean (SEM)**, and it measures how precisely we have estimated the population mean.\n\nLet us work through a concrete numerical example. A moving-average crossover strategy on EUR/USD produces n = 200 trades with sample mean return X̄ = 0.0003 (0.03% per trade, or roughly 3 pips) and sample standard deviation s = 0.008 (0.8%). First, compute the standard error: SEM = s / √n = 0.008 / √200 = 0.008 / 14.142 = 0.000566. Then the t-statistic: t = (X̄ − 0) / SEM = 0.0003 / 0.000566 = 0.530. The degrees of freedom are ν = 200 − 1 = 199. Looking up the one-tailed p-value from the Student-t distribution with 199 df, we find P(T ≥ 0.530) ≈ 0.298. Since p = 0.298 is far greater than α = 0.05, we **fail to reject H₀** — we have no statistically significant evidence that this strategy has a real edge. The mean return of 0.03% per trade is entirely consistent with random noise given the high volatility of 0.8% per trade.\n\nThere is an elegant duality between **hypothesis tests and confidence intervals**. A 95% confidence interval for μ is X̄ ± t₀.₀₂₅,ν · SEM. For our example: 0.0003 ± 1.972 × 0.000566 = 0.0003 ± 0.00112 = (−0.00082, 0.00142). Since this interval contains μ₀ = 0, we cannot reject H₀ at the 5% level — consistent with our p-value conclusion. This duality always holds: rejecting H₀ at significance level α is mathematically equivalent to the (1−α) confidence interval not containing μ₀. In practice, the confidence interval is more informative because it shows the range of plausible values for the true mean return, not just a binary reject/fail-to-reject decision.",
            },
            {
              type: "theory",
              title: "P-Values, Statistical Power & Effect Size",
              content:
                "The **p-value** has a precise geometric interpretation: it is the **area under the t-distribution curve** in the tail(s) beyond the observed test statistic. For a one-tailed test with t = 0.530 and ν = 199, the p-value is the area under the t₁₉₉ density curve from 0.530 to +∞. Visually, if you plot the bell-shaped t-distribution and shade everything to the right of 0.530, that shaded area equals 0.298. A smaller t-statistic means more shaded area (larger p-value, weaker evidence); a larger t-statistic means less shaded area (smaller p-value, stronger evidence). For a two-tailed test, you shade both tails symmetrically and the p-value doubles. Common misinterpretations that you **must** avoid: the p-value is NOT the probability that H₀ is true (that would require Bayesian analysis with a prior), it is NOT the probability of a false positive (that is α, the threshold you choose), and a non-significant p-value does NOT prove H₀ is true (absence of evidence ≠ evidence of absence). The p-value answers one specific question: 'If the null hypothesis were true, how surprising is our observed data?'\n\nNow consider the errors we can make. A **Type I error** (false positive, rate α) occurs when we reject H₀ even though the strategy truly has no edge — we deploy capital on a random strategy and lose money plus transaction costs. A **Type II error** (false negative, rate β) occurs when we fail to reject H₀ even though the strategy has a genuine edge — we leave money on the table. **Statistical power** = 1 − β is the probability of correctly detecting a real effect. Power depends on three factors: (1) the **effect size** — how large the true mean return is relative to the noise; (2) the **sample size** n — more trades give us a more precise estimate of the mean; and (3) the **significance level** α — a stricter threshold (smaller α) reduces Type I errors but also reduces power. **Cohen's d** = (X̄ − μ₀) / s is the standard measure of effect size: d = 0.2 is 'small', d = 0.5 is 'medium', d = 0.8 is 'large'. For our example, d = 0.0003 / 0.008 = 0.0375 — an extremely small effect size, meaning the signal-to-noise ratio is terrible.\n\nHow many trades do we need to detect a given effect size? The required sample size for a one-tailed t-test with power 1 − β at significance level α is approximately **n ≈ ((z_α + z_β) / d)²**, where z_α and z_β are standard Normal quantiles. Suppose we want to detect a Sharpe-ratio-equivalent of 0.5 annualized. For hourly trading (≈6,000 bars/year), the per-trade effect size is d = 0.5 / √6000 ≈ 0.00645. With α = 0.05 (z₀.₀₅ = 1.645) and power = 0.80 (z₀.₂₀ = 0.842), we need n ≈ ((1.645 + 0.842) / 0.00645)² ≈ (385.4)² ≈ 148,500 hourly bars — roughly 25 years of hourly data. This sobering calculation reveals why detecting small edges in high-frequency trading requires enormous datasets, and why many 'significant' backtests on short histories are almost certainly noise.",
            },
            {
              type: "theory",
              title: "Multiple Testing Corrections: Bonferroni & FDR",
              content:
                "When you test k strategies simultaneously, each at significance level α, the probability of at least one false positive across all tests — called the **family-wise error rate (FWER)** — is FWER = 1 − (1 − α)ᵏ. For k = 20 strategies at α = 0.05: FWER = 1 − 0.95²⁰ = 1 − 0.3585 = 0.6415. That is a 64% chance of at least one false discovery — essentially a coin flip that one of your 'significant' strategies is actually garbage. The **Bonferroni correction** is the simplest fix: reject H₀ for test i only if pᵢ < α/k. With k = 20 and α = 0.05, each test must meet the threshold α/k = 0.05/20 = 0.0025. Worked example: suppose you test 20 moving-average crossover variants and obtain p-values ranging from 0.001 to 0.42. Under uncorrected α = 0.05, suppose 4 strategies appear significant (p < 0.05). After Bonferroni, only strategies with p < 0.0025 survive — perhaps only 1 or 0. Bonferroni guarantees FWER ≤ α, but it is **conservative**: by making each test very strict, it dramatically reduces power, meaning genuinely profitable strategies may be discarded (increased Type II errors).\n\nThe **Benjamini-Hochberg (BH) procedure** offers a better power-vs-error tradeoff by controlling the **false discovery rate (FDR)** — the expected proportion of rejected hypotheses that are false positives — rather than the probability of any single false positive. The algorithm: (1) Sort all k p-values in ascending order: p₍₁₎ ≤ p₍₂₎ ≤ … ≤ p₍ₖ₎. (2) For each rank i, compute the BH threshold: (i/k) · α. (3) Find the largest i such that p₍ᵢ₎ ≤ (i/k) · α. (4) Reject all hypotheses with rank ≤ that i. Worked example with k = 10 sorted p-values: [0.001, 0.005, 0.012, 0.018, 0.030, 0.041, 0.065, 0.110, 0.350, 0.710] at α = 0.05. The BH thresholds are: i=1: 0.005, i=2: 0.010, i=3: 0.015, i=4: 0.020, i=5: 0.025, i=6: 0.030, i=7: 0.035, i=8: 0.040, i=9: 0.045, i=10: 0.050. Checking p₍ᵢ₎ ≤ (i/10)·0.05: p₍₁₎=0.001 ≤ 0.005 ✓, p₍₂₎=0.005 ≤ 0.010 ✓, p₍₃₎=0.012 ≤ 0.015 ✓, p₍₄₎=0.018 ≤ 0.020 ✓, p₍₅₎=0.030 > 0.025 ✗. The largest passing i is 4, so we reject the first 4 hypotheses. Under Bonferroni (threshold 0.005), only 2 would survive. BH retains more discoveries while still controlling the fraction of false positives to ≤ 5%. In trading, BH is preferred when screening many strategy variants because you care about the proportion of deployed strategies that fail, not the absolute count.\n\nThe tradeoff between Bonferroni and BH is fundamentally about **what error you want to control**. Bonferroni controls FWER — the probability that even one false positive sneaks through — appropriate when each false positive is catastrophic (e.g., deploying one bad strategy could bankrupt the fund). BH controls FDR — the expected fraction of discoveries that are false — appropriate when you will deploy a portfolio of strategies and can tolerate some fraction being duds as long as the portfolio overall is profitable.",
            },
            {
              type: "theory",
              title: "Bootstrap Hypothesis Testing",
              content:
                "All derivations above assumed that trade returns are approximately Normally distributed (or that n is large enough for CLT to apply). In practice, forex returns exhibit **fat tails, skewness, and serial dependence** — violations that can make parametric t-tests unreliable, especially with small samples. **Bootstrap hypothesis testing** constructs the null distribution empirically, requiring no distributional assumptions. The algorithm for testing H₀: μ = 0 is: (1) Compute the observed test statistic t_obs = X̄ / (s / √n) from the original n trade returns. (2) Center the data under H₀ by subtracting the sample mean: xᵢ* = xᵢ − X̄ (so the centered data has mean zero, consistent with H₀). (3) For b = 1, 2, …, B (typically B = 10,000): draw a bootstrap sample of size n with replacement from the centered data {xᵢ*}, compute the bootstrap test statistic t_b = X̄_b / (s_b / √n). (4) The bootstrap p-value is the fraction of bootstrap samples where t_b ≥ t_obs: p_boot = (1/B) Σ 𝟙(t_b ≥ t_obs). This p-value is distribution-free because the null distribution is built entirely from the data itself.\n\nThe **advantages** of bootstrap testing are substantial: it works with any distribution shape (fat tails, skewness), handles small samples where CLT may not hold, and can test complex statistics (e.g., Sharpe ratio, maximum drawdown) for which no closed-form null distribution exists. The **disadvantages** are: computational cost (10,000 resamples × n trades each), the requirement that observations are **independent and identically distributed (i.i.d.)** — if returns are autocorrelated, a block bootstrap or circular bootstrap is needed instead — and the fact that bootstrap p-values have finite resolution limited by B (with B = 10,000, the smallest achievable p-value is 1/10,000 = 0.0001). In practice, combine bootstrap tests with parametric t-tests: if both agree, you have robust evidence; if they disagree, investigate whether distributional assumptions are the cause.",
            },
            {
              type: "intuition",
              title: "The Jury Trial Analogy",
              analogy:
                "Hypothesis testing is like a jury trial — the strategy is 'innocent' (no edge) until proven 'guilty' (profitable) beyond reasonable doubt.",
              content:
                "In a trial, the defendant (your strategy) is **presumed innocent** (H₀: no edge). The prosecution (your backtest data) presents evidence — trade returns, Sharpe ratios, t-statistics. The **p-value** is like asking: 'If the defendant were truly innocent, how likely is it that evidence this damning would appear by chance?' If that probability is very low (p < 0.05), the jury rejects innocence and convicts (rejects H₀). A **Type I error** is a wrongful conviction — deploying a strategy that has no real edge, costing you capital and transaction costs. A **Type II error** is acquitting a guilty person — discarding a genuinely profitable strategy and leaving money on the table. **Power** is the probability of convicting someone who is actually guilty — it depends on how strong the evidence is (effect size), how much evidence you collect (sample size), and how high you set the bar for conviction (α). Now imagine running **20 simultaneous trials** (testing 20 strategy variants). Even if all defendants are innocent, by pure chance one will look guilty (p < 0.05 for at least one, with 64% probability). **Bonferroni** raises the conviction bar for each trial to α/20, ensuring the overall chance of any wrongful conviction stays at 5%. **Benjamini-Hochberg** takes a different approach: it accepts that some small fraction of convictions may be wrongful, but controls that fraction to ≤ 5% of all convictions — a more lenient but more powerful standard.",
              emoji: "⚖️",
            },
            {
              type: "intuition",
              title: "The Medical Drug Trial Analogy",
              analogy:
                "Testing a trading strategy is like running a clinical drug trial — you need a placebo group, blinding, power analysis, and multiple-endpoint correction.",
              content:
                "In a drug trial, patients receive either the real drug or a **placebo** (sugar pill). The placebo group establishes the baseline: some patients improve by pure chance, just as a random trading strategy occasionally produces positive returns over a finite sample. The trial is **double-blind** — neither doctors nor patients know who gets the real drug — to prevent bias. In trading, the equivalent is **out-of-sample testing**: the strategy must not have 'seen' the test data during development, otherwise the backtest is like an unblinded trial where the doctor unconsciously gives better care to drug patients. Before the trial begins, regulators require a **power analysis**: how many patients (trades) are needed to detect a clinically meaningful improvement (effect size)? A drug that reduces blood pressure by 0.1 mmHg is statistically detectable with enough patients, but clinically meaningless — just as a strategy with Cohen's d = 0.01 may be 'significant' with 100,000 trades but generate returns too small to cover transaction costs. Finally, if the drug trial measures **multiple endpoints** (blood pressure, cholesterol, mortality, side effects), each endpoint is an independent hypothesis test. Without correction, at least one endpoint will appear 'significant' by chance — exactly the same problem as testing 20 MA crossover variants. The FDA requires **multiple-endpoint correction** (Bonferroni or Holm–Bonferroni), just as rigorous quant research requires multiple-testing correction before declaring a strategy 'works'.",
              emoji: "💊",
            },
            {
              type: "code",
              title: "Complete t-Test for Strategy Evaluation",
              language: "python",
              code: `import numpy as np
import pandas as pd
from scipy import stats

# ── Load EUR/USD hourly data ──────────────────────────────────────────
prices = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
prices["log_return"] = np.log(prices["close"] / prices["close"].shift(1))
prices.dropna(subset=["log_return"], inplace=True)

# ── Simple MA crossover strategy: buy when fast MA > slow MA ──────────
fast_period, slow_period = 10, 50
prices["ma_fast"] = prices["close"].rolling(fast_period).mean()
prices["ma_slow"] = prices["close"].rolling(slow_period).mean()
prices["signal"] = (prices["ma_fast"] > prices["ma_slow"]).astype(int)
prices["strategy_return"] = prices["signal"].shift(1) * prices["log_return"]
strategy_returns = prices["strategy_return"].dropna().values
n = len(strategy_returns)

# ── Step 1: Compute sample statistics ─────────────────────────────────
x_bar = np.mean(strategy_returns)           # sample mean
s = np.std(strategy_returns, ddof=1)        # sample std (Bessel's correction)
sem = s / np.sqrt(n)                         # standard error of the mean

print("=" * 60)
print("STEP 1: Sample Statistics")
print(f"  n (number of trades/bars):   {n}")
print(f"  X-bar (sample mean return):  {x_bar:.8f}")
print(f"  s (sample std deviation):    {s:.8f}")
print(f"  SEM = s / sqrt(n):           {sem:.8f}")

# ── Step 2: Compute t-statistic manually ──────────────────────────────
mu_0 = 0.0  # null hypothesis: no edge
t_stat_manual = (x_bar - mu_0) / sem
df = n - 1
print(f"\\nSTEP 2: t-Statistic (manual derivation)")
print(f"  t = (X-bar - mu_0) / SEM")
print(f"  t = ({x_bar:.8f} - {mu_0}) / {sem:.8f}")
print(f"  t = {t_stat_manual:.6f}")
print(f"  Degrees of freedom: n - 1 = {df}")

# ── Step 3: Compute p-value (one-tailed: H1: mu > 0) ─────────────────
p_value_one_manual = 1 - stats.t.cdf(t_stat_manual, df=df)
print(f"\\nSTEP 3: P-value (geometric area under t-distribution tail)")
print(f"  P(T >= {t_stat_manual:.4f} | df={df}) = {p_value_one_manual:.6f}")

# ── Step 4: Verify with scipy ────────────────────────────────────────
t_stat_scipy, p_two_scipy = stats.ttest_1samp(strategy_returns, popmean=0)
p_one_scipy = p_two_scipy / 2 if t_stat_scipy > 0 else 1 - p_two_scipy / 2
print(f"\\nSTEP 4: Verification via scipy.stats.ttest_1samp")
print(f"  scipy t-stat:          {t_stat_scipy:.6f}")
print(f"  scipy p-value (1-tail):{p_one_scipy:.6f}")
print(f"  Manual matches scipy:  {np.isclose(t_stat_manual, t_stat_scipy)}")

# ── Step 5: 95% confidence interval for mu ────────────────────────────
t_crit = stats.t.ppf(0.975, df=df)  # two-tailed critical value
ci_lower = x_bar - t_crit * sem
ci_upper = x_bar + t_crit * sem
print(f"\\nSTEP 5: 95% Confidence Interval")
print(f"  CI = X-bar +/- t_0.025 * SEM")
print(f"  CI = {x_bar:.8f} +/- {t_crit:.4f} * {sem:.8f}")
print(f"  CI = ({ci_lower:.8f}, {ci_upper:.8f})")
print(f"  Contains mu_0=0? {'YES => fail to reject H0' if ci_lower <= 0 <= ci_upper else 'NO => reject H0'}")

# ── Step 6: Cohen's d effect size ─────────────────────────────────────
cohens_d = (x_bar - mu_0) / s
print(f"\\nSTEP 6: Effect Size (Cohen's d)")
print(f"  d = (X-bar - mu_0) / s = {x_bar:.8f} / {s:.8f} = {cohens_d:.6f}")
size_label = "negligible" if abs(cohens_d) < 0.2 else "small" if abs(cohens_d) < 0.5 else "medium" if abs(cohens_d) < 0.8 else "large"
print(f"  Interpretation: {size_label} effect (|d|={abs(cohens_d):.4f})")

# ── Final verdict ─────────────────────────────────────────────────────
alpha = 0.05
reject = p_value_one_manual < alpha
print(f"\\n{'=' * 60}")
print(f"VERDICT at alpha={alpha}:")
print(f"  Reject H0? {'YES - strategy has significant edge' if reject else 'NO - insufficient evidence of edge'}")
print(f"  p-value:   {p_value_one_manual:.6f}")
print(f"  Cohen's d: {cohens_d:.6f} ({size_label})")
print("=" * 60)`,
              explanation:
                "This program derives the t-statistic from scratch — computing the sample mean, sample standard deviation (with Bessel's correction), and standard error — then manually evaluates the p-value as the tail area of the Student-t distribution. It verifies the manual calculation against scipy, constructs a 95% confidence interval, and computes Cohen's d effect size. The confidence interval check demonstrates the duality between hypothesis tests and interval estimation: if the CI contains zero, we fail to reject H₀, consistent with the p-value result.",
            },
            {
              type: "code",
              title: "Power Analysis: How Many Trades Do You Need?",
              language: "python",
              code: `import numpy as np
from scipy import stats
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ── Power calculation function (one-sample, one-tailed t-test) ────────
def compute_power(n: int, effect_size_d: float, alpha: float = 0.05) -> float:
    """Compute power = P(reject H0 | H1 true) for a one-tailed one-sample t-test."""
    df = n - 1
    # Critical t-value for significance level alpha
    t_crit = stats.t.ppf(1 - alpha, df=df)
    # Under H1, the t-stat follows a non-central t-distribution
    # with non-centrality parameter delta = d * sqrt(n)
    ncp = effect_size_d * np.sqrt(n)
    # Power = P(T > t_crit) under the non-central t
    power = 1 - stats.nct.cdf(t_crit, df=df, nc=ncp)
    return power

# ── Required sample size for target power ─────────────────────────────
def required_n(effect_size_d: float, target_power: float = 0.80, alpha: float = 0.05) -> int:
    """Find minimum n to achieve target power via binary search."""
    lo, hi = 2, 10_000_000
    while lo < hi:
        mid = (lo + hi) // 2
        if compute_power(mid, effect_size_d, alpha) >= target_power:
            hi = mid
        else:
            lo = mid + 1
    return lo

# ── Compute required N for different annualized Sharpe ratios ─────────
bars_per_year = 252 * 24  # hourly trading
sharpe_targets = [0.25, 0.50, 0.75, 1.0, 1.5, 2.0]
print("=" * 65)
print(f"{'Annualized Sharpe':>18} {'Per-trade d':>14} {'Required N':>12} {'Years of data':>15}")
print("-" * 65)
for sr in sharpe_targets:
    d_per_trade = sr / np.sqrt(bars_per_year)
    n_req = required_n(d_per_trade)
    years = n_req / bars_per_year
    print(f"{sr:>18.2f} {d_per_trade:>14.6f} {n_req:>12,} {years:>15.1f}")
print("=" * 65)

# ── Plot power curves for different effect sizes ──────────────────────
sample_sizes = np.arange(50, 20001, 50)
effect_sizes = [0.01, 0.02, 0.05, 0.10, 0.20, 0.50]
plt.figure(figsize=(10, 6))
for d in effect_sizes:
    powers = [compute_power(n, d) for n in sample_sizes]
    plt.plot(sample_sizes, powers, label=f"d = {d}")
plt.axhline(y=0.80, color="red", linestyle="--", alpha=0.7, label="Power = 0.80")
plt.xlabel("Sample Size (n trades)")
plt.ylabel("Statistical Power (1 - beta)")
plt.title("Power Curves: How Many Trades to Detect an Edge?")
plt.legend()
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig("power_curves.png", dpi=150)
print("\\nPower curve plot saved to power_curves.png")

# ── Key insight: detecting small edges requires massive data ──────────
d_small = 0.02  # typical forex intraday edge
n_needed = required_n(d_small)
print(f"\\nKey insight: To detect an effect size d={d_small} with 80% power,")
print(f"you need {n_needed:,} trades ({n_needed / bars_per_year:.1f} years of hourly data).")
print("Most retail backtests use 1-3 years — hopelessly underpowered.")`,
              explanation:
                "This program builds power analysis from first principles using the non-central t-distribution. The required sample size function uses binary search to find the minimum n achieving 80% power for a given effect size. The key takeaway is stark: detecting a Sharpe ratio of 0.5 from hourly returns requires tens of thousands of bars, and most retail backtests on 1-3 years of data are hopelessly underpowered to distinguish a small but real edge from random noise.",
            },
            {
              type: "code",
              title: "Bonferroni & Benjamini-Hochberg in Practice",
              language: "python",
              code: `import numpy as np
import pandas as pd
from scipy import stats

# ── Load EUR/USD hourly data ──────────────────────────────────────────
prices = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
prices["log_return"] = np.log(prices["close"] / prices["close"].shift(1))
prices.dropna(subset=["log_return"], inplace=True)

# ── Test 20 MA crossover parameter combinations ──────────────────────
fast_periods = [5, 8, 10, 13, 15, 18, 20, 25, 30, 35]
slow_periods = [40, 80]
results = []
for fast in fast_periods:
    for slow in slow_periods:
        if fast >= slow:
            continue
        prices[f"ma_{fast}"] = prices["close"].rolling(fast).mean()
        prices[f"ma_{slow}"] = prices["close"].rolling(slow).mean()
        signal = (prices[f"ma_{fast}"] > prices[f"ma_{slow}"]).astype(int)
        strat_ret = (signal.shift(1) * prices["log_return"]).dropna().values
        t_stat, p_two = stats.ttest_1samp(strat_ret, popmean=0)
        p_one = p_two / 2 if t_stat > 0 else 1 - p_two / 2
        results.append({
            "strategy": f"MA({fast}/{slow})",
            "n_trades": len(strat_ret),
            "mean_return": np.mean(strat_ret),
            "t_stat": t_stat,
            "p_value": p_one,
        })

df = pd.DataFrame(results).sort_values("p_value").reset_index(drop=True)
k = len(df)
alpha = 0.05

# ── Uncorrected results ──────────────────────────────────────────────
print("=" * 80)
print(f"UNCORRECTED RESULTS (alpha = {alpha}, k = {k} tests)")
print("-" * 80)
sig_uncorrected = df[df["p_value"] < alpha]
print(f"Significant strategies: {len(sig_uncorrected)} / {k}")
for _, row in sig_uncorrected.iterrows():
    print(f"  {row['strategy']:>12}  t={row['t_stat']:+.4f}  p={row['p_value']:.6f}")

# ── Bonferroni correction ────────────────────────────────────────────
bonf_alpha = alpha / k
df["bonferroni_reject"] = df["p_value"] < bonf_alpha
print(f"\\n{'=' * 80}")
print(f"BONFERRONI CORRECTION (threshold = alpha/k = {bonf_alpha:.6f})")
print("-" * 80)
sig_bonf = df[df["bonferroni_reject"]]
print(f"Surviving strategies: {len(sig_bonf)} / {k}")
for _, row in sig_bonf.iterrows():
    print(f"  {row['strategy']:>12}  p={row['p_value']:.6f} < {bonf_alpha:.6f}")

# ── Benjamini-Hochberg FDR procedure (step by step) ──────────────────
df_sorted = df.sort_values("p_value").reset_index(drop=True)
df_sorted["rank"] = range(1, k + 1)
df_sorted["bh_threshold"] = (df_sorted["rank"] / k) * alpha
df_sorted["bh_pass"] = df_sorted["p_value"] <= df_sorted["bh_threshold"]

# Find largest rank where p(i) <= (i/k)*alpha
passing = df_sorted[df_sorted["bh_pass"]]
bh_cutoff_rank = passing["rank"].max() if len(passing) > 0 else 0
df_sorted["bh_reject"] = df_sorted["rank"] <= bh_cutoff_rank

print(f"\\n{'=' * 80}")
print(f"BENJAMINI-HOCHBERG FDR PROCEDURE (alpha = {alpha})")
print("-" * 80)
print(f"{'Rank':>4}  {'Strategy':>12}  {'p-value':>10}  {'BH threshold':>14}  {'Pass?':>6}")
for _, row in df_sorted.iterrows():
    marker = " ***" if row["bh_reject"] else ""
    print(f"{row['rank']:>4}  {row['strategy']:>12}  {row['p_value']:>10.6f}  {row['bh_threshold']:>14.6f}  {'YES' if row['bh_pass'] else 'NO':>6}{marker}")
sig_bh = df_sorted[df_sorted["bh_reject"]]
print(f"\\nSurviving strategies (BH): {len(sig_bh)} / {k}")

# ── Summary comparison ────────────────────────────────────────────────
print(f"\\n{'=' * 80}")
print("SUMMARY: How many strategies survive each method?")
print(f"  Uncorrected (alpha={alpha}):     {len(sig_uncorrected)}")
print(f"  Bonferroni (alpha/k={bonf_alpha:.4f}): {len(sig_bonf)}")
print(f"  Benjamini-Hochberg (FDR={alpha}):  {len(sig_bh)}")
print("=" * 80)

# ── Bootstrap test for the best strategy ─────────────────────────────
best = df_sorted.iloc[0]
best_fast, best_slow = best["strategy"].replace("MA(", "").replace(")", "").split("/")
prices["ma_best_f"] = prices["close"].rolling(int(best_fast)).mean()
prices["ma_best_s"] = prices["close"].rolling(int(best_slow)).mean()
sig = (prices["ma_best_f"] > prices["ma_best_s"]).astype(int)
best_returns = (sig.shift(1) * prices["log_return"]).dropna().values

n = len(best_returns)
x_bar = np.mean(best_returns)
s = np.std(best_returns, ddof=1)
t_obs = x_bar / (s / np.sqrt(n))

# Center data under H0 and bootstrap
centered = best_returns - x_bar
B = 10000
rng = np.random.default_rng(42)
boot_t_stats = np.empty(B)
for b in range(B):
    boot_sample = rng.choice(centered, size=n, replace=True)
    boot_mean = np.mean(boot_sample)
    boot_std = np.std(boot_sample, ddof=1)
    boot_t_stats[b] = boot_mean / (boot_std / np.sqrt(n))

p_boot = np.mean(boot_t_stats >= t_obs)
print(f"\\nBOOTSTRAP TEST for best strategy {best['strategy']}:")
print(f"  Observed t-stat:     {t_obs:.4f}")
print(f"  Bootstrap p-value:   {p_boot:.6f} (B={B})")
print(f"  Parametric p-value:  {best['p_value']:.6f}")
print(f"  Agreement:           {'YES' if (p_boot < alpha) == (best['p_value'] < alpha) else 'NO'}")`,
              explanation:
                "This program tests 20 MA crossover parameter combinations, collects all p-values, then applies both Bonferroni and Benjamini-Hochberg corrections. The BH procedure is shown step-by-step with rank, threshold, and pass/fail for each hypothesis. A bootstrap hypothesis test is then performed on the best strategy to validate the parametric result without distributional assumptions. The summary shows the stark attrition: many strategies that appear significant uncorrected are eliminated by multiple testing corrections.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "found-ht-q1",
                  question:
                    "A strategy backtest shows p = 0.03. What is the correct interpretation?",
                  options: [
                    { id: "found-ht-q1-a", text: "There is a 3% probability that the strategy is unprofitable" },
                    { id: "found-ht-q1-b", text: "If H₀ (no edge) were true, there is a 3% probability of observing a test statistic this extreme or more" },
                    { id: "found-ht-q1-c", text: "There is a 97% probability the strategy will be profitable in live trading" },
                    { id: "found-ht-q1-d", text: "The strategy's expected return is 0.03 per trade" },
                  ],
                  correctOptionId: "found-ht-q1-b",
                  explanation:
                    "The p-value is the probability of observing a test statistic at least as extreme as the one computed, assuming H₀ is true. It is NOT the probability that H₀ is true or false — that would require Bayesian analysis with a prior distribution. It is also not the probability of future profitability, which depends on regime stability, transaction costs, and market microstructure changes.",
                },
                {
                  id: "found-ht-q2",
                  question:
                    "In the context of strategy testing, what distinguishes a Type I error from a Type II error, and which is typically more costly?",
                  options: [
                    { id: "found-ht-q2-a", text: "Type I = rejecting a truly profitable strategy; Type II = deploying a worthless strategy. Type II is more costly." },
                    { id: "found-ht-q2-b", text: "Type I = deploying a strategy with no real edge (false positive); Type II = rejecting a genuinely profitable strategy (false negative). Type I is typically more costly." },
                    { id: "found-ht-q2-c", text: "Type I = overfitting the model; Type II = underfitting the model. They are equally costly." },
                    { id: "found-ht-q2-d", text: "Type I = using too small a sample; Type II = using too large a sample. Type I is more costly." },
                  ],
                  correctOptionId: "found-ht-q2-b",
                  explanation:
                    "A Type I error means you reject H₀ when it is actually true — you deploy a strategy that has no genuine edge, losing real capital plus transaction costs. A Type II error means you fail to reject H₀ when the strategy actually works — you miss a profit opportunity. In trading, Type I errors are generally more costly because deploying capital on a non-existent edge produces guaranteed losses from spreads and commissions, whereas a Type II error only means an opportunity cost.",
                },
                {
                  id: "found-ht-q3",
                  question:
                    "A MA crossover strategy on EUR/USD yields n = 200 trades, mean return X̄ = 0.0003, and sample standard deviation s = 0.008. Compute the t-statistic and determine significance at α = 0.05.",
                  options: [
                    { id: "found-ht-q3-a", text: "t = 0.530, p ≈ 0.298 (one-tailed). Not significant — fail to reject H₀." },
                    { id: "found-ht-q3-b", text: "t = 3.75, p < 0.001 (one-tailed). Highly significant — reject H₀." },
                    { id: "found-ht-q3-c", text: "t = 0.0375, p ≈ 0.485 (one-tailed). Not significant — fail to reject H₀." },
                    { id: "found-ht-q3-d", text: "t = 5.30, p < 0.0001 (one-tailed). Extremely significant — reject H₀." },
                  ],
                  correctOptionId: "found-ht-q3-a",
                  explanation:
                    "SEM = s / √n = 0.008 / √200 = 0.008 / 14.142 = 0.000566. Then t = (X̄ − 0) / SEM = 0.0003 / 0.000566 = 0.530. With df = 199, the one-tailed p-value P(T ≥ 0.530) ≈ 0.298, which is far above α = 0.05. The 95% confidence interval (−0.00082, 0.00142) contains zero, confirming the failure to reject H₀.",
                },
                {
                  id: "found-ht-q4",
                  question:
                    "Given n = 200, X̄ = 0.0003, s = 0.008, what is Cohen's d and what does it tell you about the practical significance of the strategy?",
                  options: [
                    { id: "found-ht-q4-a", text: "d = 0.530 — a medium effect size, suggesting meaningful practical significance." },
                    { id: "found-ht-q4-b", text: "d = 0.0375 — a negligible effect size, meaning even if statistically significant with more data, the edge is too tiny to be practical after transaction costs." },
                    { id: "found-ht-q4-c", text: "d = 3.75 — a very large effect size, indicating a strong trading edge." },
                    { id: "found-ht-q4-d", text: "d cannot be computed without knowing the population standard deviation σ." },
                  ],
                  correctOptionId: "found-ht-q4-b",
                  explanation:
                    "Cohen's d = (X̄ − μ₀) / s = 0.0003 / 0.008 = 0.0375. This is far below the conventional 'small' threshold of 0.2. It means the signal-to-noise ratio per trade is terrible: the average return is only 3.75% of one standard deviation. Even with a massive sample (say, 100,000 trades) that yields statistical significance, the actual per-trade edge of 0.03% would likely be consumed by spreads and commissions.",
                },
                {
                  id: "found-ht-q5",
                  question:
                    "You test 20 strategy variants at α = 0.05. Sorted p-values include p₍₁₎ = 0.002, p₍₂₎ = 0.008, p₍₃₎ = 0.021, p₍₄₎ = 0.039, p₍₅₎ = 0.048. Under Benjamini-Hochberg, how many are rejected?",
                  options: [
                    { id: "found-ht-q5-a", text: "5 (all with p < 0.05)" },
                    { id: "found-ht-q5-b", text: "2 (only p₍₁₎ and p₍₂₎ survive Bonferroni at 0.0025)" },
                    { id: "found-ht-q5-c", text: "4 (BH thresholds: 0.0025, 0.005, 0.0075, 0.01, 0.0125 — only ranks 1-2 pass their thresholds, so reject 2)" },
                    { id: "found-ht-q5-d", text: "3 (BH thresholds: i/20 × 0.05 gives 0.0025, 0.005, 0.0075, 0.01, 0.0125 — p₍₁₎=0.002 ≤ 0.0025 ✓, p₍₂₎=0.008 > 0.005 ✗, so largest passing i=1, reject 1)" },
                  ],
                  correctOptionId: "found-ht-q5-d",
                  explanation:
                    "The BH thresholds for k=20 at α=0.05 are (i/20)·0.05: rank 1 → 0.0025, rank 2 → 0.005, rank 3 → 0.0075, rank 4 → 0.01, rank 5 → 0.0125. Check: p₍₁₎=0.002 ≤ 0.0025 ✓, p₍₂₎=0.008 > 0.005 ✗. The largest rank passing is i=1, so only the first hypothesis is rejected. This shows that with many tests, even BH can be quite strict — and Bonferroni would also reject only rank 1 (0.002 < 0.0025).",
                },
                {
                  id: "found-ht-q6",
                  question:
                    "A one-tailed t-test at α = 0.05 has 40% power (β = 0.60) with n = 500 trades. What happens to the power if you double the sample size to n = 1000?",
                  options: [
                    { id: "found-ht-q6-a", text: "Power doubles to 80% because power scales linearly with n." },
                    { id: "found-ht-q6-b", text: "Power increases but not to 80% — the non-centrality parameter grows as d·√n, so power increases sub-linearly. It would reach roughly 55-65%." },
                    { id: "found-ht-q6-c", text: "Power stays at 40% because it depends only on effect size, not sample size." },
                    { id: "found-ht-q6-d", text: "Power decreases because a larger sample makes the test more conservative." },
                  ],
                  correctOptionId: "found-ht-q6-b",
                  explanation:
                    "Power depends on the non-centrality parameter δ = d·√n. Doubling n multiplies √n by √2 ≈ 1.414, not 2. The non-centrality parameter increases by ~41%, which pushes the non-central t-distribution further from zero and increases the rejection probability — but the relationship between δ and power follows the CDF of the non-central t, which is nonlinear. The exact power depends on d and df, but it would typically increase from 40% to roughly 55-65%, not 80%.",
                },
              ],
            },
            {
              type: "practice",
              title: "Multiple Strategy Testing with Corrections",
              description:
                "Test 15 different moving-average crossover period combinations (fast ∈ {5, 10, 15, 20, 25} × slow ∈ {30, 50, 100}) on EUR/USD hourly data. For each combination: (1) Compute the MA crossover signals and per-bar strategy returns. (2) Run a one-sample t-test (H₀: μ = 0, one-tailed H₁: μ > 0). (3) Record the p-value, t-statistic, mean return, and Cohen's d. Collect all 15 p-values into a single array. Apply Bonferroni correction (α_corrected = 0.05/15 = 0.00333). Apply the Benjamini-Hochberg procedure step by step: sort p-values, compute BH thresholds (i/15)·0.05 for each rank i, find the largest rank where p₍ᵢ₎ ≤ threshold. Compare: how many strategies survive uncorrected, Bonferroni, and BH? For the strategy with the smallest p-value, run a bootstrap hypothesis test (B = 5,000 resamples) and compare the bootstrap p-value with the parametric p-value. Reflect on whether the parametric assumption of normality matters for your data.",
            },
            {
              type: "practice",
              title: "Dashboard Exercise: Strategy Hypothesis Testing",
              description:
                "Open the dashboard's Strategy Evaluation page and select a EUR/USD MA crossover strategy. (1) Locate the hypothesis test panel: verify that the reported t-statistic matches the manual formula t = X̄ / (s/√n) using the displayed mean return, standard deviation, and trade count. (2) Examine the p-value visualization — identify the shaded tail area under the t-distribution curve and confirm it corresponds to the reported p-value. (3) Check the effect size (Cohen's d) — is the edge practically meaningful or only statistically significant due to large n? (4) If the dashboard supports multiple strategy comparison, run 5-10 parameter variants and observe how Bonferroni and BH corrections affect which strategies are flagged as significant. (5) Toggle between parametric (t-test) and bootstrap test modes if available — do the conclusions change? Note any strategies where the parametric and bootstrap p-values disagree, and investigate whether the return distribution for those strategies is particularly non-Normal (check skewness and kurtosis in the distribution panel).",
            },
          ],
        },
        {
          id: "found-correlation-regression",
          title: "Correlation & Regression in Markets",
          description:
            "Derive Pearson and Spearman correlation from first principles, build OLS regression via calculus, decompose R², and master residual diagnostics (heteroskedasticity, autocorrelation) for modeling factor relationships in forex markets.",
          estimatedMinutes: 90,
          difficulty: "beginner",
          prerequisites: ["found-descriptive-stats"],
          sections: [
            {
              type: "objective",
              content:
                "After this lesson you will be able to derive and compute Pearson and Spearman correlation coefficients from scratch, identify and explain spurious correlations caused by non-stationarity, derive OLS estimators via calculus, decompose total variance into explained and residual components, and diagnose regression residuals for heteroskedasticity and autocorrelation using formal statistical tests.",
              keyTakeaways: [
                "Derive Pearson ρ = Cov(X,Y)/(σₓσᵧ) from the covariance definition and prove ρ ∈ [−1, 1] via the Cauchy-Schwarz inequality",
                "Execute the Spearman rank correlation procedure step-by-step: rank both variables, compute Pearson on ranks, apply the shortcut formula ρₛ = 1 − 6Σdᵢ²/(n(n²−1)) when no ties exist",
                "Demonstrate that two independent random walks produce spurious correlation (high |ρ|) due to non-stationarity, and resolve it by differencing to returns",
                "Derive OLS estimators β₁ = Σ(xᵢ−x̄)(yᵢ−ȳ)/Σ(xᵢ−x̄)² and β₀ = ȳ − β₁x̄ by minimizing SSE via partial derivatives and solving the normal equations",
                "Decompose total sum of squares: SST = SSR + SSE, and define R² = 1 − SSE/SST = SSR/SST, proving R² = ρ² for simple linear regression",
                "Detect heteroskedasticity using the Breusch-Pagan test: regress squared residuals on the regressors and test the joint significance with a χ² statistic",
                "Derive the Durbin-Watson statistic DW = Σ(εₜ−εₜ₋₁)²/Σεₜ² and show DW ≈ 2(1−ρ₁), interpreting DW ≈ 2 as no autocorrelation, DW → 0 as positive, DW → 4 as negative",
              ],
            },
            {
              type: "theory",
              title: "Pearson Correlation: Derivation from Covariance",
              content:
                "The **covariance** between two random variables X and Y is defined as Cov(X, Y) = E[(X − μₓ)(Y − μᵧ)], where μₓ = E[X] and μᵧ = E[Y]. Expanding, Cov(X, Y) = E[XY] − μₓμᵧ. Covariance captures the direction of linear association: positive when X and Y tend to deviate from their means in the same direction, negative when they deviate in opposite directions. However, covariance is unbounded and depends on the units of X and Y, making it unsuitable for comparison across different variable pairs. The **Pearson correlation coefficient** ρ standardizes covariance by dividing by the product of standard deviations: ρ = Cov(X, Y) / (σₓ · σᵧ), where σₓ = √Var(X) and σᵧ = √Var(Y). This yields a dimensionless measure. To prove ρ ∈ [−1, 1], we invoke the **Cauchy-Schwarz inequality**: |E[AB]|² ≤ E[A²] · E[B²] for any random variables A, B. Setting A = X − μₓ and B = Y − μᵧ gives |Cov(X, Y)|² ≤ Var(X) · Var(Y), so |ρ| = |Cov(X, Y)| / (σₓσᵧ) ≤ 1. Equality holds if and only if Y = aX + b for constants a, b — perfect linear dependence.\n\nA critical subtlety: **ρ = 0 does not imply independence**. Consider X ~ N(0, 1) and Y = X². Then Cov(X, Y) = E[X · X²] − E[X] · E[X²] = E[X³] − 0 · 1 = 0 (since the third moment of a symmetric distribution is zero), so ρ = 0 despite Y being entirely determined by X. This is because Pearson only detects **linear** association. In financial markets this matters: a volatility measure and its underlying return may have ρ ≈ 0 while being strongly dependent through a quadratic relationship. The **sampling distribution** of the sample correlation r from n observations follows a complex distribution under H₀: ρ = 0, but the **Fisher z-transform** z = 0.5 · ln((1 + r) / (1 − r)) is approximately Normal with mean 0.5 · ln((1 + ρ) / (1 − ρ)) and standard error 1/√(n − 3). This transform is essential for constructing confidence intervals and testing hypotheses about ρ.\n\n**Numerical example**: Consider 5 bars of EUR/USD and GBP/USD hourly returns (in basis points): X = [+12, −8, +5, −3, +10] and Y = [+9, −6, +7, −1, +8]. First compute means: x̄ = (12 − 8 + 5 − 3 + 10)/5 = 3.2, ȳ = (9 − 6 + 7 − 1 + 8)/5 = 3.4. Deviations from mean: (X − x̄) = [8.8, −11.2, 1.8, −6.2, 6.8], (Y − ȳ) = [5.6, −9.4, 3.6, −4.4, 4.6]. Products: [49.28, 105.28, 6.48, 27.28, 31.28]. Cov(X, Y) = (49.28 + 105.28 + 6.48 + 27.28 + 31.28)/5 = 219.60/5 = 43.92. Sum of squared deviations: Σ(X − x̄)² = 77.44 + 125.44 + 3.24 + 38.44 + 46.24 = 290.80, so σₓ = √(290.80/5) = √58.16 = 7.626. Σ(Y − ȳ)² = 31.36 + 88.36 + 12.96 + 19.36 + 21.16 = 173.20, so σᵧ = √(173.20/5) = √34.64 = 5.886. Therefore ρ = 43.92 / (7.626 × 5.886) = 43.92 / 44.887 = **0.9784** — a very strong positive linear correlation, consistent with both pairs being driven by USD.",
            },
            {
              type: "theory",
              title: "Spearman Rank Correlation & Spurious Correlation",
              content:
                "The **Spearman rank correlation** ρₛ is computed by a three-step procedure: (1) Replace each value of X and Y with its rank within its own sample (smallest value gets rank 1). (2) Compute the Pearson correlation on these ranks. When there are **no tied values**, an algebraic shortcut exists: ρₛ = 1 − 6Σdᵢ² / (n(n² − 1)), where dᵢ = rank(xᵢ) − rank(yᵢ) is the rank difference for observation i. When **ties exist**, assign the average of the tied ranks (e.g., two values sharing ranks 3 and 4 both receive rank 3.5) and compute Pearson on the averaged ranks directly — the shortcut formula is no longer exact. Spearman captures any **monotonic** relationship (not just linear) and is robust to outliers because it operates on ranks rather than raw values. An extreme return of −500 bps that would heavily distort Pearson simply receives rank 1 in Spearman. In forex, where fat-tailed distributions produce occasional extreme moves, Spearman often gives a more stable and interpretable measure of association than Pearson.\n\n**Spurious correlation** is one of the most dangerous pitfalls in financial analysis, and it arises primarily from **non-stationarity**. A time series is non-stationary if its statistical properties (mean, variance) change over time — price series are the canonical example because they trend. Consider generating two **independent random walks**: Pₜ = Pₜ₋₁ + εₜ and Qₜ = Qₜ₋₁ + ηₜ where εₜ and ηₜ are independent white noise. Despite zero causal relationship, computing Pearson ρ between Pₜ and Qₜ over a long window frequently yields |ρ| > 0.7. This happens because both series wander away from their starting points, creating apparent trends that look correlated. The correlation is entirely an artifact of the shared stochastic trending behavior. The solution is to **difference** the series: compute returns rₜ = Pₜ − Pₜ₋₁ (or log-returns for multiplicative series). Returns are typically stationary, and ρ computed on returns reflects genuine co-movement. As a rule: **never compute correlation on price levels** in financial analysis.\n\nBeyond non-stationarity, spurious correlation also arises from **confounding variables** (a third variable driving both X and Y) and from **multiple testing** (testing many pairs guarantees some will appear correlated by chance). **Granger causality** offers a more rigorous framework: X Granger-causes Y if past values of X help predict Y beyond Y's own past values. However, Granger causality is still about prediction, not true causation — it cannot distinguish between X causing Y and both being driven by an unobserved confounder Z that affects X before Y. In forex, if EUR/USD and GBP/USD returns are correlated, the true driver is usually USD strength — neither pair 'causes' the other; both respond to the same underlying dollar factor.",
            },
            {
              type: "theory",
              title: "OLS Linear Regression: Derivation via Calculus",
              content:
                "The **simple linear regression model** posits Y = β₀ + β₁X + ε, where β₀ is the intercept, β₁ is the slope, and ε is the error term. Given n observations {(x₁, y₁), …, (xₙ, yₙ)}, we seek β₀ and β₁ that minimize the **sum of squared errors** SSE = Σᵢ₌₁ⁿ (yᵢ − β₀ − β₁xᵢ)². To find the minimum, take partial derivatives and set them to zero. First: ∂SSE/∂β₀ = −2Σ(yᵢ − β₀ − β₁xᵢ) = 0, which simplifies to Σyᵢ = nβ₀ + β₁Σxᵢ, giving **β₀ = ȳ − β₁x̄** (the regression line passes through the point of means). Second: ∂SSE/∂β₁ = −2Σxᵢ(yᵢ − β₀ − β₁xᵢ) = 0. Substituting β₀ = ȳ − β₁x̄ and simplifying: Σ(xᵢ − x̄)(yᵢ − ȳ) = β₁Σ(xᵢ − x̄)², so **β₁ = Σ(xᵢ − x̄)(yᵢ − ȳ) / Σ(xᵢ − x̄)²**. Notice that β₁ = Cov(X, Y) / Var(X) — the slope is the covariance divided by the variance of the predictor. These are the **normal equations** of OLS, and they yield the Best Linear Unbiased Estimator (BLUE) under the Gauss-Markov assumptions.\n\nThe total variability in Y decomposes as **SST = SSR + SSE**, where SST = Σ(yᵢ − ȳ)² is the total sum of squares, SSR = Σ(ŷᵢ − ȳ)² is the regression (explained) sum of squares, and SSE = Σ(yᵢ − ŷᵢ)² is the residual (unexplained) sum of squares. The **coefficient of determination** R² = 1 − SSE/SST = SSR/SST measures the fraction of total variance explained by the model. For simple linear regression (one predictor), **R² = ρ²** — the square of the Pearson correlation between X and Y. This is elegant: the explanatory power of a simple regression is entirely determined by the linear correlation. **Adjusted R²** = 1 − (1 − R²)(n − 1)/(n − p − 1) penalizes for extra predictors (p = number of predictors), preventing artificial inflation of R² by adding irrelevant variables. The **standard error** of β₁ is SE(β₁) = √[σ̂² / Σ(xᵢ − x̄)²], where σ̂² = SSE/(n − 2) is the estimated residual variance. The t-statistic t = β₁ / SE(β₁) tests H₀: β₁ = 0.\n\n**Numerical example**: Using our 5-bar returns X = [+12, −8, +5, −3, +10] (EUR/USD) and Y = [+9, −6, +7, −1, +8] (GBP/USD) from the previous section: x̄ = 3.2, ȳ = 3.4. We already computed Σ(xᵢ − x̄)(yᵢ − ȳ) = 219.60 and Σ(xᵢ − x̄)² = 290.80. So β₁ = 219.60 / 290.80 = **0.7551** and β₀ = 3.4 − 0.7551 × 3.2 = 3.4 − 2.416 = **0.984**. The fitted model is ŷ = 0.984 + 0.7551x. Predictions: ŷ = [10.05, −5.06, 4.76, −1.28, 8.54]. Residuals: e = [−1.05, −0.94, 2.24, 0.28, −0.54]. SSE = 1.10 + 0.88 + 5.02 + 0.08 + 0.29 = 7.37. SST = Σ(yᵢ − ȳ)² = 173.20. R² = 1 − 7.37/173.20 = **0.9574**. Check: ρ² = 0.9784² = 0.9573 ✓. σ̂² = 7.37/(5 − 2) = 2.457. SE(β₁) = √(2.457/290.80) = √0.00845 = 0.0919. t = 0.7551/0.0919 = 8.21, highly significant even with n = 5.",
            },
            {
              type: "theory",
              title: "Residual Diagnostics: Heteroskedasticity & Autocorrelation",
              content:
                "The classical OLS assumptions on the error term ε are: (1) **E[ε] = 0** — errors have zero mean; (2) **Var(ε) = σ²** — constant variance (**homoskedasticity**); (3) **Cov(εₜ, εₛ) = 0** for t ≠ s — no **autocorrelation**; (4) ε is independent of X. When these assumptions hold, OLS is BLUE (Best Linear Unbiased Estimator) by the Gauss-Markov theorem. Violations don't necessarily bias the coefficient estimates β₀ and β₁, but they invalidate the standard errors, t-statistics, and confidence intervals — meaning your hypothesis tests become unreliable.\n\n**Heteroskedasticity** occurs when Var(ε | X) varies with X. In forex, the variance of GBP/USD returns conditional on EUR/USD returns might be larger for extreme EUR/USD moves (a 'fan' shape in the scatter plot). The **Breusch-Pagan test** detects this formally: (1) Run OLS and obtain residuals eᵢ. (2) Compute squared residuals eᵢ². (3) Regress eᵢ² on the original regressors X (auxiliary regression). (4) The test statistic is BP = n · R²_aux, which follows a χ²(p) distribution under H₀: homoskedasticity, where p is the number of regressors. If BP exceeds the critical value (e.g., χ²₀.₀₅(1) = 3.84 for one regressor), reject homoskedasticity. Consequences: OLS estimates remain unbiased and consistent, but they are **inefficient** (no longer minimum variance) and standard errors are biased — typically underestimated, leading to inflated t-statistics and false significance. The remedy is to use **heteroskedasticity-consistent standard errors** (White/HC standard errors) or **weighted least squares** (WLS).\n\n**Autocorrelation** in residuals means Cov(εₜ, εₛ) ≠ 0, commonly arising in time-series data where the model misses a time-dependent pattern. The **Durbin-Watson statistic** is DW = Σₜ₌₂ⁿ (eₜ − eₜ₋₁)² / Σₜ₌₁ⁿ eₜ². To understand its behavior, expand the numerator: Σ(eₜ − eₜ₋₁)² = Σeₜ² + Σeₜ₋₁² − 2Σeₜeₜ₋₁ ≈ 2Σeₜ² − 2Σeₜeₜ₋₁ (for large n). Dividing by Σeₜ²: DW ≈ 2 − 2(Σeₜeₜ₋₁/Σeₜ²) = **2(1 − ρ̂₁)**, where ρ̂₁ = Σeₜeₜ₋₁/Σeₜ² is the estimated lag-1 autocorrelation of residuals. Therefore: **DW ≈ 2** when ρ̂₁ ≈ 0 (no autocorrelation), **DW → 0** when ρ̂₁ → 1 (strong positive autocorrelation — residuals persist in the same direction), and **DW → 4** when ρ̂₁ → −1 (strong negative autocorrelation — residuals alternate signs). The Durbin-Watson test has an inconclusive region between lower bound dₗ and upper bound dᵤ (which depend on n and p). Typical decision rules for α = 0.05 with n = 100 and p = 1: dₗ ≈ 1.65, dᵤ ≈ 1.69. If DW < dₗ, reject H₀ (positive autocorrelation); if DW > dᵤ, do not reject; if dₗ ≤ DW ≤ dᵤ, the test is inconclusive. For the upper tail (negative autocorrelation), test 4 − DW against the same bounds. In forex regression, DW values around 1.8–2.2 are typical for well-specified models on return data; DW below 1.5 signals missing time-series structure.",
            },
            {
              type: "intuition",
              title: "The Ice Cream & Drowning Analogy",
              analogy:
                "Correlation ≠ causation — ice cream sales and drowning deaths are correlated because both are driven by a hidden confounder: summer heat. Understanding confounders, omitted variable bias, and the difference between correlation on prices vs returns is essential for avoiding false conclusions in trading.",
              content:
                "Ice cream sales and drowning deaths both spike in summer. If you computed their Pearson correlation, you'd find ρ ≈ 0.8. Should we ban ice cream to prevent drownings? Obviously not — **temperature** is the **confounder** driving both. This illustrates **omitted variable bias**: if you regress drownings on ice cream sales (omitting temperature), the coefficient on ice cream absorbs temperature's effect, producing a spuriously significant relationship. The bias formula is: β̂₁_biased = β₁_true + β₂ · δ, where β₂ is the effect of the omitted variable (temperature) on Y (drownings) and δ is the coefficient from regressing the omitted variable on X (ice cream). Since both β₂ and δ are positive, the bias is upward.\n\nIn forex, **EUR/USD and GBP/USD** often show ρ > 0.7 on returns because both are driven by **USD strength** — the confounder. If you include EUR/USD returns and GBP/USD returns as separate features in a model, you may think both contribute independent information, but they're largely measuring the same thing: the USD factor. Regressing one on the other and checking R² reveals the redundancy. A more insidious version arises when computing correlation on **price levels** rather than **returns**. Two independent random walks (e.g., simulated EUR/USD and AUD/NZD prices) will show |ρ| > 0.8 over a long window simply because both trend — this is the **spurious regression problem** identified by Granger and Newbold (1974). The solution is always to compute correlation on **stationary** series (returns, log-returns, or properly differenced data). And always check residuals: if DW is far from 2, your regression is missing a time-dependent pattern, and the 'significant' relationship may be an artifact of autocorrelated errors inflating the t-statistics.",
              emoji: "🍦",
            },
            {
              type: "intuition",
              title: "The GPS Navigation Analogy",
              analogy:
                "Linear regression is like GPS predicting your arrival time based on distance — the slope is your speed, the intercept is startup delay, R² measures how well distance alone explains travel time, and residual patterns reveal systematic errors in the model.",
              content:
                "Imagine your GPS predicting arrival time (Y) based on distance (X). The regression equation ŷ = β₀ + β₁x works just like the GPS formula: **β₁ is your average speed** (minutes per kilometer), **β₀ is the fixed startup delay** (time to leave the driveway, regardless of distance), and **R² measures how well distance alone predicts travel time**. If you only drive on empty highways, R² ≈ 0.99 — distance perfectly predicts time. But add city traffic, and R² drops because the **residuals** (actual minus predicted time) become large and variable. Those residuals represent everything the model doesn't capture: traffic lights, weather, road construction.\n\nNow consider the residual patterns. If your GPS consistently underestimates long trips and overestimates short ones, the residuals are **heteroskedastic** — prediction error grows with distance. This is exactly what the Breusch-Pagan test detects: the variance of your 'surprise' (residual) depends on X. Your GPS's confidence intervals should be wider for longer trips, but if it assumes constant error (homoskedasticity), it will be overconfident on long trips and wastefully cautious on short ones. If your GPS also underestimates every Monday morning and overestimates every Sunday — sequential residuals are correlated — that's **autocorrelation**, and DW would be far from 2. The fix is to add 'day of week' to the model, just as in forex we add lagged variables or regime indicators to capture time-dependent structure the simple model misses.",
              emoji: "🗺️",
            },
            {
              type: "code",
              title: "Pearson & Spearman Correlation from Scratch",
              language: "python",
              code: `import numpy as np
from scipy import stats

# --- Simulated EUR/USD and GBP/USD 5-bar hourly returns (basis points) ---
eu_ret = np.array([12.0, -8.0, 5.0, -3.0, 10.0, -6.0, 14.0, -1.0, 7.0, 3.0])
gb_ret = np.array([9.0, -6.0, 7.0, -1.0, 8.0, -4.0, 11.0, 1.0, 5.0, 2.0])
n = len(eu_ret)

# ========================
# PEARSON FROM SCRATCH
# ========================
x_bar = np.mean(eu_ret)
y_bar = np.mean(gb_ret)
cov_xy = np.sum((eu_ret - x_bar) * (gb_ret - y_bar)) / n  # population cov
std_x = np.sqrt(np.sum((eu_ret - x_bar) ** 2) / n)
std_y = np.sqrt(np.sum((gb_ret - y_bar) ** 2) / n)
pearson_manual = cov_xy / (std_x * std_y)

print("=== PEARSON CORRELATION (manual derivation) ===")
print(f"x_bar = {x_bar:.2f},  y_bar = {y_bar:.2f}")
print(f"Cov(X,Y) = {cov_xy:.4f}")
print(f"sigma_X  = {std_x:.4f},  sigma_Y = {std_y:.4f}")
print(f"rho = Cov / (sigma_X * sigma_Y) = {pearson_manual:.6f}")

# Fisher z-transform for confidence interval
z = 0.5 * np.log((1 + pearson_manual) / (1 - pearson_manual))
se_z = 1.0 / np.sqrt(n - 3)
z_lo, z_hi = z - 1.96 * se_z, z + 1.96 * se_z
r_lo = (np.exp(2 * z_lo) - 1) / (np.exp(2 * z_lo) + 1)
r_hi = (np.exp(2 * z_hi) - 1) / (np.exp(2 * z_hi) + 1)
print(f"Fisher z = {z:.4f},  SE(z) = {se_z:.4f}")
print(f"95% CI for rho: [{r_lo:.4f}, {r_hi:.4f}]")

# Verify with scipy
r_scipy, p_scipy = stats.pearsonr(eu_ret, gb_ret)
print(f"scipy check: r = {r_scipy:.6f}, p = {p_scipy:.4e}")

# ========================
# SPEARMAN FROM SCRATCH
# ========================
# Step 1: Rank both variables (1-based, ascending)
rank_x = stats.rankdata(eu_ret)
rank_y = stats.rankdata(gb_ret)
d = rank_x - rank_y
d_sq_sum = np.sum(d ** 2)

# Shortcut formula (valid when no ties)
spearman_shortcut = 1 - (6 * d_sq_sum) / (n * (n ** 2 - 1))

# Pearson on ranks (general formula, works with ties)
spearman_pearson = np.corrcoef(rank_x, rank_y)[0, 1]

print("\\n=== SPEARMAN RANK CORRELATION (manual) ===")
print(f"Ranks X: {rank_x}")
print(f"Ranks Y: {rank_y}")
print(f"d_i:     {d}")
print(f"Sum(d_i^2) = {d_sq_sum:.1f}")
print(f"Shortcut formula: rho_s = 1 - 6*{d_sq_sum:.0f}/({n}*{n**2 - 1}) = {spearman_shortcut:.6f}")
print(f"Pearson on ranks:  rho_s = {spearman_pearson:.6f}")

# Verify with scipy
rs_scipy, ps_scipy = stats.spearmanr(eu_ret, gb_ret)
print(f"scipy check: rho_s = {rs_scipy:.6f}, p = {ps_scipy:.4e}")

# ========================
# SPURIOUS vs REAL CORRELATION
# ========================
np.random.seed(42)
T = 1000
# Two INDEPENDENT random walks (prices)
walk_a = np.cumsum(np.random.randn(T))
walk_b = np.cumsum(np.random.randn(T))
# Correlation on PRICES (spurious!)
rho_prices = np.corrcoef(walk_a, walk_b)[0, 1]
# Correlation on RETURNS (genuine)
ret_a, ret_b = np.diff(walk_a), np.diff(walk_b)
rho_returns = np.corrcoef(ret_a, ret_b)[0, 1]

print("\\n=== SPURIOUS vs REAL CORRELATION ===")
print(f"Two INDEPENDENT random walks (n={T}):")
print(f"  Correlation on PRICES:  rho = {rho_prices:+.4f}  <-- SPURIOUS!")
print(f"  Correlation on RETURNS: rho = {rho_returns:+.4f}  <-- genuine (near zero)")
print("Lesson: NEVER compute correlation on non-stationary price levels.")`,
              explanation:
                "This code implements Pearson and Spearman correlation entirely from scratch, showing every intermediate computation: means, covariance, standard deviations, ranks, and rank differences. The Fisher z-transform constructs a 95% confidence interval for the true correlation. The Spearman section demonstrates both the shortcut formula (no ties) and the general Pearson-on-ranks approach. Finally, the spurious correlation demonstration generates two independent random walks and shows that price-level correlation is highly misleading (|ρ| often > 0.5) while return-level correlation correctly shows near-zero association.",
            },
            {
              type: "code",
              title: "OLS Regression with Full Diagnostics",
              language: "python",
              code: `import numpy as np
from scipy import stats as sp_stats

# --- Generate realistic forex regression data ---
np.random.seed(123)
n = 200
# EUR/USD returns (predictor) in basis points
x = np.random.randn(n) * 8 + 0.5
# GBP/USD returns: true relationship with noise
beta0_true, beta1_true = 0.3, 0.75
noise = np.random.randn(n) * 4
y = beta0_true + beta1_true * x + noise

# ========================
# OLS VIA NORMAL EQUATIONS
# ========================
x_bar = np.mean(x)
y_bar = np.mean(y)
SS_xy = np.sum((x - x_bar) * (y - y_bar))  # numerator of beta1
SS_xx = np.sum((x - x_bar) ** 2)            # denominator of beta1
beta1 = SS_xy / SS_xx
beta0 = y_bar - beta1 * x_bar

print("=== OLS REGRESSION (manual normal equations) ===")
print(f"x_bar = {x_bar:.4f},  y_bar = {y_bar:.4f}")
print(f"SS_xy = {SS_xy:.4f},  SS_xx = {SS_xx:.4f}")
print(f"beta_1 = SS_xy / SS_xx = {beta1:.6f}")
print(f"beta_0 = y_bar - beta_1 * x_bar = {beta0:.6f}")
print(f"Model: y_hat = {beta0:.4f} + {beta1:.4f} * x")

# ========================
# R-SQUARED DECOMPOSITION
# ========================
y_hat = beta0 + beta1 * x
residuals = y - y_hat
SST = np.sum((y - y_bar) ** 2)
SSE = np.sum(residuals ** 2)
SSR = np.sum((y_hat - y_bar) ** 2)
R2 = 1 - SSE / SST
R2_check = SSR / SST
p = 1  # number of predictors
R2_adj = 1 - (1 - R2) * (n - 1) / (n - p - 1)

print(f"\\n=== R-SQUARED DECOMPOSITION ===")
print(f"SST = {SST:.2f}  (total variance)")
print(f"SSR = {SSR:.2f}  (explained by regression)")
print(f"SSE = {SSE:.2f}  (unexplained / residual)")
print(f"SSR + SSE = {SSR + SSE:.2f}  (should equal SST: {SST:.2f})")
print(f"R^2 = 1 - SSE/SST = {R2:.6f}")
print(f"R^2 = SSR/SST     = {R2_check:.6f}  (cross-check)")
rho_xy = np.corrcoef(x, y)[0, 1]
print(f"rho^2 = {rho_xy**2:.6f}  (should equal R^2 for simple regression)")
print(f"Adjusted R^2 = {R2_adj:.6f}")

# ========================
# STANDARD ERRORS & T-STATS
# ========================
sigma2_hat = SSE / (n - 2)  # residual variance estimate
se_beta1 = np.sqrt(sigma2_hat / SS_xx)
se_beta0 = np.sqrt(sigma2_hat * (1/n + x_bar**2 / SS_xx))
t_beta1 = beta1 / se_beta1
t_beta0 = beta0 / se_beta0
p_beta1 = 2 * (1 - sp_stats.t.cdf(abs(t_beta1), df=n-2))
p_beta0 = 2 * (1 - sp_stats.t.cdf(abs(t_beta0), df=n-2))

print(f"\\n=== COEFFICIENT INFERENCE ===")
print(f"sigma_hat^2 = SSE/(n-2) = {sigma2_hat:.4f}")
print(f"beta_1: estimate={beta1:.4f}, SE={se_beta1:.4f}, t={t_beta1:.3f}, p={p_beta1:.2e}")
print(f"beta_0: estimate={beta0:.4f}, SE={se_beta0:.4f}, t={t_beta0:.3f}, p={p_beta0:.2e}")

# ========================
# DURBIN-WATSON TEST
# ========================
diff_resid = np.diff(residuals)
DW = np.sum(diff_resid ** 2) / np.sum(residuals ** 2)
rho1_hat = np.corrcoef(residuals[:-1], residuals[1:])[0, 1]
DW_approx = 2 * (1 - rho1_hat)

print(f"\\n=== DURBIN-WATSON TEST ===")
print(f"DW = Sum(e_t - e_{{t-1}})^2 / Sum(e_t^2) = {DW:.4f}")
print(f"Lag-1 autocorrelation of residuals: rho_1 = {rho1_hat:.4f}")
print(f"Approximation: 2*(1 - rho_1) = {DW_approx:.4f}")
print(f"Interpretation: DW~2 -> no autocorrelation, DW->0 -> positive, DW->4 -> negative")
if DW < 1.5:
    print("WARNING: DW < 1.5 suggests positive autocorrelation in residuals!")
elif DW > 2.5:
    print("WARNING: DW > 2.5 suggests negative autocorrelation in residuals!")
else:
    print("DW is near 2 — no strong evidence of residual autocorrelation.")

# ========================
# BREUSCH-PAGAN TEST
# ========================
e_sq = residuals ** 2
X_bp = np.column_stack([np.ones(n), x])
beta_bp = np.linalg.lstsq(X_bp, e_sq, rcond=None)[0]
e_sq_hat = X_bp @ beta_bp
SS_bp = np.sum((e_sq_hat - np.mean(e_sq)) ** 2)
SS_tot_bp = np.sum((e_sq - np.mean(e_sq)) ** 2)
R2_bp = SS_bp / SS_tot_bp
BP_stat = n * R2_bp
BP_pval = 1 - sp_stats.chi2.cdf(BP_stat, df=p)

print(f"\\n=== BREUSCH-PAGAN TEST FOR HETEROSKEDASTICITY ===")
print(f"Auxiliary regression R^2 = {R2_bp:.6f}")
print(f"BP statistic = n * R^2_aux = {n} * {R2_bp:.6f} = {BP_stat:.4f}")
print(f"Chi-squared critical value (df=1, alpha=0.05) = 3.841")
print(f"BP p-value = {BP_pval:.4f}")
if BP_pval < 0.05:
    print("REJECT H0: evidence of heteroskedasticity. Use robust standard errors (HC).")
else:
    print("FAIL TO REJECT H0: no significant heteroskedasticity detected.")

# ========================
# COMPARE WITH STATSMODELS
# ========================
try:
    import statsmodels.api as sm
    from statsmodels.stats.stattools import durbin_watson as sm_dw
    from statsmodels.stats.diagnostic import het_breuschpagan
    X_sm = sm.add_constant(x)
    model = sm.OLS(y, X_sm).fit()
    print(f"\\n=== STATSMODELS VERIFICATION ===")
    print(f"beta_0 = {model.params[0]:.6f} (manual: {beta0:.6f})")
    print(f"beta_1 = {model.params[1]:.6f} (manual: {beta1:.6f})")
    print(f"R^2    = {model.rsquared:.6f} (manual: {R2:.6f})")
    print(f"DW     = {sm_dw(model.resid):.4f} (manual: {DW:.4f})")
    bp_lm, bp_lm_p, _, _ = het_breuschpagan(model.resid, X_sm)
    print(f"BP     = {bp_lm:.4f} (manual: {BP_stat:.4f}), p = {bp_lm_p:.4f}")
except ImportError:
    print("\\n(statsmodels not installed — manual results verified above)")`,
              explanation:
                "This code derives OLS estimates entirely from the normal equations — no libraries needed for the core computation. It then performs the full R² decomposition (SST = SSR + SSE), verifies R² = ρ², computes coefficient standard errors and t-statistics, runs the Durbin-Watson test (both exact formula and the 2(1−ρ₁) approximation), and applies the Breusch-Pagan test for heteroskedasticity. Finally, all manual results are cross-checked against statsmodels to confirm correctness.",
            },
            {
              type: "code",
              title: "Rolling Correlation & Regime-Dependent Relationships",
              language: "python",
              code: `import numpy as np
import pandas as pd
from scipy import stats

# --- Simulate EUR/USD and GBP/USD hourly returns with regime structure ---
np.random.seed(42)
n_bars = 2000

# Regime 1 (bars 0-999): high correlation (rho ~ 0.8)
# Regime 2 (bars 1000-1999): low correlation (rho ~ 0.2)
eu_ret = np.random.randn(n_bars) * 8
gb_ret = np.empty(n_bars)
gb_ret[:1000] = 0.8 * eu_ret[:1000] + np.random.randn(1000) * 4   # high corr regime
gb_ret[1000:] = 0.2 * eu_ret[1000:] + np.random.randn(1000) * 7   # low corr regime

df = pd.DataFrame({"EURUSD": eu_ret, "GBPUSD": gb_ret})

# ========================
# ROLLING 100-BAR PEARSON & SPEARMAN
# ========================
window = 100
roll_pearson = df["EURUSD"].rolling(window).corr(df["GBPUSD"])

# Rolling Spearman (no built-in, use apply)
def rolling_spearman(window_data):
    x = window_data.values[:window]
    y = window_data.values[window:]
    return stats.spearmanr(x, y).statistic

paired = pd.concat([df["EURUSD"], df["GBPUSD"]], axis=0)
roll_spearman = df.rolling(window).apply(
    lambda w: stats.spearmanr(
        df["EURUSD"].iloc[w.index[0]:w.index[-1]+1],
        df["GBPUSD"].iloc[w.index[0]:w.index[-1]+1]
    ).statistic if len(w) == window else np.nan,
    raw=False
)
# Simpler approach: compute Spearman in a loop for clarity
spearman_vals = np.full(n_bars, np.nan)
for i in range(window - 1, n_bars):
    start = i - window + 1
    rho_s, _ = stats.spearmanr(eu_ret[start:i+1], gb_ret[start:i+1])
    spearman_vals[i] = rho_s
roll_spearman_s = pd.Series(spearman_vals, index=df.index)

print("=== ROLLING CORRELATION ANALYSIS ===")
print(f"Window: {window} bars | Total bars: {n_bars}")
print(f"\\nRolling Pearson  — mean: {roll_pearson.mean():.4f}, "
      f"min: {roll_pearson.min():.4f}, max: {roll_pearson.max():.4f}")
print(f"Rolling Spearman — mean: {roll_spearman_s.mean():.4f}, "
      f"min: {roll_spearman_s.min():.4f}, max: {roll_spearman_s.max():.4f}")

# ========================
# REGIME CLASSIFICATION & SUMMARY
# ========================
# Label regimes by rolling Pearson: high (> 0.5), medium (0.2-0.5), low (< 0.2)
regimes = pd.cut(roll_pearson, bins=[-1, 0.2, 0.5, 1.0],
                 labels=["low (<0.2)", "medium (0.2-0.5)", "high (>0.5)"])

print("\\n=== REGIME SUMMARY (by rolling Pearson level) ===")
for regime in ["low (<0.2)", "medium (0.2-0.5)", "high (>0.5)"]:
    mask = regimes == regime
    count = mask.sum()
    if count > 0:
        pct = 100 * count / regimes.notna().sum()
        mean_p = roll_pearson[mask].mean()
        mean_s = roll_spearman_s[mask].mean()
        print(f"  {regime:>20s}: {count:5d} bars ({pct:5.1f}%) | "
              f"mean Pearson={mean_p:+.3f}, mean Spearman={mean_s:+.3f}")

# ========================
# CORRELATION BREAKDOWN DETECTION
# ========================
# Identify bars where rolling correlation drops below 0.3 after being above 0.6
high_corr = roll_pearson > 0.6
low_corr = roll_pearson < 0.3
breakdown = low_corr & high_corr.shift(1).fillna(False)
n_breakdowns = breakdown.sum()

print(f"\\n=== CORRELATION BREAKDOWNS ===")
print(f"Episodes where rolling rho dropped from >0.6 to <0.3: {n_breakdowns}")
if n_breakdowns > 0:
    breakdown_idx = breakdown[breakdown].index.tolist()
    for idx in breakdown_idx[:5]:  # show first 5
        print(f"  Bar {idx}: rho went from {roll_pearson.iloc[idx-1]:.3f} to {roll_pearson.iloc[idx]:.3f}")

# Overall statistics
print(f"\\n=== FULL SAMPLE vs REGIME STATISTICS ===")
r_full, p_full = stats.pearsonr(eu_ret, gb_ret)
rs_full, ps_full = stats.spearmanr(eu_ret, gb_ret)
r_r1, _ = stats.pearsonr(eu_ret[:1000], gb_ret[:1000])
r_r2, _ = stats.pearsonr(eu_ret[1000:], gb_ret[1000:])
print(f"Full sample: Pearson={r_full:.4f}, Spearman={rs_full:.4f}")
print(f"Regime 1 (high corr): Pearson={r_r1:.4f}")
print(f"Regime 2 (low corr):  Pearson={r_r2:.4f}")
print("Takeaway: full-sample correlation masks regime-dependent structure!")`,
              explanation:
                "This code computes rolling 100-bar Pearson and Spearman correlations between simulated EUR/USD and GBP/USD returns that contain two distinct regimes: high correlation (ρ ≈ 0.8) and low correlation (ρ ≈ 0.2). It classifies each bar into a regime based on the rolling correlation level, detects 'breakdown' events where correlation drops sharply, and compares full-sample versus regime-specific statistics. The key insight is that a single full-sample correlation (e.g., ρ = 0.5) can mask dramatically different regime-dependent behavior — critical for risk management and pairs trading strategies.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "found-cr-q1",
                  question:
                    "If X ~ N(0,1) and Y = X², what is the Pearson correlation ρ(X, Y)?",
                  options: [
                    { id: "found-cr-q1-a", text: "ρ = 1.0 because Y is entirely determined by X" },
                    { id: "found-cr-q1-b", text: "ρ = 0.5 because the relationship is non-linear" },
                    { id: "found-cr-q1-c", text: "ρ = 0 because Cov(X, X²) = E[X³] = 0 for symmetric distributions, but X and Y are NOT independent" },
                    { id: "found-cr-q1-d", text: "ρ is undefined for non-linear relationships" },
                  ],
                  correctOptionId: "found-cr-q1-c",
                  explanation:
                    "Cov(X, X²) = E[X · X²] − E[X] · E[X²] = E[X³] − 0 · 1 = 0, because the third moment of any symmetric distribution (like the standard Normal) is zero. Therefore ρ = 0 despite Y = X² being a deterministic function of X. This proves that Pearson correlation only detects linear association — ρ = 0 does NOT imply independence.",
                },
                {
                  id: "found-cr-q2",
                  question:
                    "Two independent random walks of length 500 show Pearson ρ = 0.73 on their price levels. Why is this correlation misleading?",
                  options: [
                    { id: "found-cr-q2-a", text: "The sample size is too small for a reliable estimate" },
                    { id: "found-cr-q2-b", text: "Random walks are non-stationary — trending series produce spurious high correlations even when the underlying innovations are completely independent" },
                    { id: "found-cr-q2-c", text: "Pearson correlation cannot handle negative values in the data" },
                    { id: "found-cr-q2-d", text: "The correlation is genuine and reflects shared structure in the random number generator" },
                  ],
                  correctOptionId: "found-cr-q2-b",
                  explanation:
                    "Non-stationary series (like random walks) drift over time, creating apparent trends. Two independent random walks will frequently show |ρ| > 0.5 on price levels despite zero causal relationship. This is the 'spurious regression' problem identified by Granger and Newbold (1974). The solution is to compute correlation on returns (first differences), which are stationary.",
                },
                {
                  id: "found-cr-q3",
                  question:
                    "Given Cov(X, Y) = 24.5 and Var(X) = 49.0, what is the OLS slope coefficient β₁?",
                  options: [
                    { id: "found-cr-q3-a", text: "β₁ = 49.0 / 24.5 = 2.0" },
                    { id: "found-cr-q3-b", text: "β₁ = 24.5 / 49.0 = 0.5" },
                    { id: "found-cr-q3-c", text: "β₁ = 24.5 × 49.0 = 1200.5" },
                    { id: "found-cr-q3-d", text: "β₁ = √(24.5 / 49.0) = 0.707" },
                  ],
                  correctOptionId: "found-cr-q3-b",
                  explanation:
                    "The OLS slope is β₁ = Cov(X, Y) / Var(X) = 24.5 / 49.0 = 0.5. This follows directly from the normal equations derived by minimizing SSE via calculus. The slope equals the covariance of X and Y divided by the variance of X, which measures how much Y changes per unit change in X.",
                },
                {
                  id: "found-cr-q4",
                  question:
                    "A regression produces SST = 800 and SSE = 200. What is R²?",
                  options: [
                    { id: "found-cr-q4-a", text: "R² = 200/800 = 0.25" },
                    { id: "found-cr-q4-b", text: "R² = 1 − 200/800 = 0.75" },
                    { id: "found-cr-q4-c", text: "R² = 800/200 = 4.0" },
                    { id: "found-cr-q4-d", text: "R² = (800 − 200)/200 = 3.0" },
                  ],
                  correctOptionId: "found-cr-q4-b",
                  explanation:
                    "R² = 1 − SSE/SST = 1 − 200/800 = 0.75. Equivalently, R² = SSR/SST = (SST − SSE)/SST = 600/800 = 0.75. This means 75% of the total variance in Y is explained by the regression model, while 25% remains unexplained (residual variance).",
                },
                {
                  id: "found-cr-q5",
                  question:
                    "A Durbin-Watson statistic of DW = 0.8 is computed from a regression on hourly forex returns. What does this indicate?",
                  options: [
                    { id: "found-cr-q5-a", text: "Strong negative autocorrelation in the residuals" },
                    { id: "found-cr-q5-b", text: "No autocorrelation — the model is well-specified" },
                    { id: "found-cr-q5-c", text: "Strong positive autocorrelation in the residuals — the model is missing time-dependent structure, and standard errors are likely biased" },
                    { id: "found-cr-q5-d", text: "The regression has too few observations for a valid test" },
                  ],
                  correctOptionId: "found-cr-q5-c",
                  explanation:
                    "DW ≈ 2(1 − ρ₁), so DW = 0.8 implies ρ₁ ≈ 1 − 0.8/2 = 0.6 — substantial positive autocorrelation. Adjacent residuals tend to have the same sign, meaning the model systematically over- or under-predicts in streaks. This violates the OLS assumption of independent errors, making standard errors unreliable (typically underestimated) and inflating t-statistics. The model likely needs lagged variables or additional predictors.",
                },
                {
                  id: "found-cr-q6",
                  question:
                    "Rolling 100-bar correlation between EUR/USD and GBP/USD drops from 0.85 to 0.15 over 200 bars. What is the most likely trading implication?",
                  options: [
                    { id: "found-cr-q6-a", text: "The pairs have permanently decoupled and will never re-correlate" },
                    { id: "found-cr-q6-b", text: "A regime shift has occurred — pairs trading strategies assuming stable correlation would face unexpected losses, and position sizing should account for the reduced co-movement" },
                    { id: "found-cr-q6-c", text: "The rolling window is too short and the result is noise" },
                    { id: "found-cr-q6-d", text: "Both pairs have stopped moving entirely" },
                  ],
                  correctOptionId: "found-cr-q6-b",
                  explanation:
                    "A sharp drop in rolling correlation signals a regime change — perhaps driven by a UK-specific event (Brexit news, BoE surprise) causing GBP to decouple from the broad USD move. Pairs trading strategies that assume stable ρ ≈ 0.85 would see their hedge ratios become invalid, leading to unexpected P&L swings. Risk management should monitor rolling correlations and adjust position sizing when correlations break down.",
                },
                {
                  id: "found-cr-q7",
                  question:
                    "What happens to OLS coefficient estimates (β₀, β₁) if the residuals are heteroskedastic?",
                  options: [
                    { id: "found-cr-q7-a", text: "The estimates become biased and inconsistent" },
                    { id: "found-cr-q7-b", text: "The estimates remain unbiased but are no longer efficient (minimum variance), and the conventional standard errors are wrong — typically underestimated, causing inflated t-statistics and false significance" },
                    { id: "found-cr-q7-c", text: "The estimates become negative regardless of the true relationship" },
                    { id: "found-cr-q7-d", text: "Nothing changes — OLS is robust to heteroskedasticity" },
                  ],
                  correctOptionId: "found-cr-q7-b",
                  explanation:
                    "Under heteroskedasticity, OLS estimates of β₀ and β₁ remain unbiased and consistent — the Gauss-Markov theorem's unbiasedness result only requires E[ε|X] = 0, not constant variance. However, OLS is no longer the Best (minimum variance) estimator, and the conventional standard error formulas assume Var(ε) = σ² (constant). When variance varies with X, these formulas give incorrect standard errors — usually too small — leading to inflated t-statistics and spurious significance. The fix is heteroskedasticity-consistent (HC/White) standard errors.",
                },
              ],
            },
            {
              type: "practice",
              title: "Cross-Pair Correlation Matrix & Spurious Relationship Testing",
              description:
                "Build a comprehensive cross-pair correlation analysis for 5 major forex pairs: EUR/USD, GBP/USD, USD/JPY, AUD/USD, and USD/CHF. (1) Compute the 5×5 Pearson and Spearman correlation matrices on hourly log-returns. Identify the strongest (highest |ρ|) and weakest (lowest |ρ|) pair combinations. (2) For the top 3 most correlated pairs, also compute correlation on raw price levels and compare — demonstrate that price-level correlations are inflated by non-stationarity. (3) For each pair combination, run the Fisher z-transform to construct 95% confidence intervals for the true correlation. (4) Test for spurious relationships: generate 5 independent random walks of the same length as your data, compute their correlation matrix, and compare with the real-data matrix. (5) Compute rolling 200-bar correlations for the most and least correlated pairs, identify regime-change points where correlation shifts by more than 0.3 within a 50-bar window, and compute regime-specific summary statistics (mean, std, min, max correlation in each regime).",
            },
            {
              type: "practice",
              title: "Dashboard Exercise: Pair Regression & Residual Diagnostics",
              description:
                "Open the dashboard's Analytics page and select a pair regression analysis (e.g., GBP/USD returns regressed on EUR/USD returns). (1) Verify that the displayed OLS coefficients match the manual formulas: β₁ = Cov(X,Y)/Var(X) and β₀ = ȳ − β₁x̄ using the summary statistics shown on the page. (2) Examine the R² value — compute ρ² from the displayed correlation and confirm R² = ρ². (3) Check the residual diagnostics panel: locate the Durbin-Watson statistic and interpret it using the DW ≈ 2(1 − ρ₁) relationship. Is there evidence of autocorrelation? (4) If a Breusch-Pagan test is displayed, verify that the BP statistic equals n × R²_aux and compare with the χ²(1) critical value of 3.841. (5) Examine the scatter plot of residuals vs fitted values — does the spread of residuals change with the fitted value (heteroskedasticity)? If the dashboard offers robust (HC) standard errors, toggle between conventional and robust and note which coefficients lose significance.",
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
            "Master the mathematical foundations of machine learning: matrices as data, eigendecomposition, SVD, covariance matrices, condition numbers, and PCA — with complete derivations and numerical examples from forex trading.",
          estimatedMinutes: 90,
          difficulty: "beginner",
          sections: [
            {
              type: "objective",
              content:
                "After completing this lesson you will understand how matrices encode datasets, derive eigendecomposition step-by-step, construct covariance matrices and prove their properties, decompose matrices via SVD, analyze numerical stability with condition numbers, and apply PCA to reduce high-dimensional technical indicator sets while preserving variance.",
              keyTakeaways: [
                "A dataset of n samples with p features is an n × p matrix X ∈ ℝⁿˣᵖ; matrix multiplication (AB)ᵢⱼ = Σₖ Aᵢₖ Bₖⱼ represents linear transformations and weighted combinations",
                "The dot product a·b = Σᵢ aᵢbᵢ = ‖a‖‖b‖cos(θ) measures similarity; covariance matrix Σ = (1/(n-1))X̃ᵀX̃ is symmetric and positive semi-definite (PSD)",
                "Eigendecomposition: Av = λv solved via det(A - λI) = 0; symmetric matrices have real eigenvalues and orthogonal eigenvectors; eigenvectors of Σ are principal components",
                "SVD decomposes A = UΣVᵀ; singular values σᵢ = √λᵢ(AᵀA); right singular vectors V are PCA components; condition number κ(A) = σ_max/σ_min quantifies numerical stability",
                "Matrix inverse A⁻¹ exists iff det(A) ≠ 0; pseudo-inverse A⁺ = VΣ⁺Uᵀ via SVD handles non-square or rank-deficient matrices",
                "High condition number (κ >> 1) indicates ill-conditioning: small input changes → large output changes; multicollinear features cause unstable regression",
                "PCA projects X onto top-k eigenvectors of covariance matrix: Z = XVₖ; variance retained = Σᵢ₌₁ᵏ λᵢ / Σᵢ₌₁ᵖ λᵢ",
                "Standardization (zero mean, unit variance) is essential before PCA to prevent features with large scales from dominating variance",
              ],
            },
            {
              type: "theory",
              title: "Vectors, Matrices & the Dot Product",
              content:
                "A **vector** in ℝⁿ represents a point or direction in n-dimensional space. In ML, a feature vector x ∈ ℝᵖ encodes p measurements: for a forex trading bar, x might be [RSI, MACD, ATR, volume]. A **matrix** X ∈ ℝⁿˣᵖ stacks n such vectors as rows, representing n samples with p features.\n\nThe **dot product** (inner product) of two vectors a, b ∈ ℝⁿ is a·b = Σᵢ₌₁ⁿ aᵢbᵢ. Geometrically, a·b = ‖a‖‖b‖cos(θ), where θ is the angle between them. **Derivation**: If a = ‖a‖û and b = ‖b‖v̂ (decomposed into magnitude × unit vector), then a·b = ‖a‖‖b‖(û·v̂). For unit vectors, û·v̂ = cos(θ) by definition of angle in ℝⁿ. Thus, a·b measures **similarity**: parallel vectors (θ = 0) yield maximum dot product ‖a‖‖b‖; orthogonal vectors (θ = 90°) yield zero.\n\n**Matrix multiplication**: (AB)ᵢⱼ = Σₖ Aᵢₖ Bₖⱼ is the dot product of row i of A with column j of B. Interpretation 1: **linear transformation** — multiplying vector x by matrix W transforms it to Wx = new coordinates. Interpretation 2: **weighted combination** — if W is a weight matrix and x is a feature vector, Wx computes weighted sums of features. **Numerical example**: Consider 3 trading bars × 4 features: X = [[65, 0.003, 0.0045, 15000], [72, 0.008, 0.0038, 18500], [58, -0.002, 0.0052, 12000]] (RSI, MACD, ATR, volume). Weight vector w = [0.4, 0.3, 0.2, 0.1]. Row 1: Xw = 65(0.4) + 0.003(0.3) + 0.0045(0.2) + 15000(0.1) = 26 + 0.0009 + 0.0009 + 1500 = 1526.0018 ≈ 1526.00. Similarly compute rows 2 and 3 to get a 3×1 output vector.",
            },
            {
              type: "theory",
              title: "The Covariance Matrix & Its Properties",
              content:
                "The **covariance matrix** Σ ∈ ℝᵖˣᵖ summarizes pairwise linear relationships between p features. **Construction**: Given n samples X ∈ ℝⁿˣᵖ, center each feature by subtracting its mean: X̃ = X - μ where μ = (1/n)Σᵢ Xᵢ (row-wise mean). Then Σ = (1/(n-1)) X̃ᵀX̃. The (i,j)-th entry is the sample covariance between features i and j.\n\n**Proof that Σ is symmetric**: Σᵀ = [(1/(n-1)) X̃ᵀX̃]ᵀ = (1/(n-1)) (X̃ᵀX̃)ᵀ = (1/(n-1)) X̃ᵀ(X̃ᵀ)ᵀ = (1/(n-1)) X̃ᵀX̃ = Σ. (We used (AB)ᵀ = BᵀAᵀ and (Aᵀ)ᵀ = A.)\n\n**Proof that Σ is positive semi-definite (PSD)**: A matrix A is PSD if for any vector v, vᵀAv ≥ 0. Let v ∈ ℝᵖ be arbitrary. Then vᵀΣv = vᵀ[(1/(n-1)) X̃ᵀX̃]v = (1/(n-1)) vᵀX̃ᵀX̃v = (1/(n-1)) (X̃v)ᵀ(X̃v) = (1/(n-1)) ‖X̃v‖² ≥ 0. (The norm squared is always non-negative.) Thus Σ is PSD.\n\n**Diagonal and off-diagonal**: Σᵢᵢ = Var(feature i); Σᵢⱼ = Cov(feature i, feature j). **Numerical example**: Two features, RSI and MACD, with 4 samples (centered): X̃ = [[5, 0.002], [-3, -0.001], [2, 0.003], [-4, -0.004]]. Compute Σ₁₁ = (1/3)[5² + (-3)² + 2² + (-4)²] = (1/3)[25 + 9 + 4 + 16] = 54/3 = 18.00. Σ₁₂ = Σ₂₁ = (1/3)[5(0.002) + (-3)(-0.001) + 2(0.003) + (-4)(-0.004)] = (1/3)[0.01 + 0.003 + 0.006 + 0.016] = 0.035/3 ≈ 0.0117. Σ₂₂ = (1/3)[0.002² + 0.001² + 0.003² + 0.004²] = (1/3)[0.000004 + 0.000001 + 0.000009 + 0.000016] = 0.00003/3 = 0.00001. So Σ = [[18.00, 0.0117], [0.0117, 0.00001]].",
            },
            {
              type: "theory",
              title: "Eigendecomposition: Step-by-Step Derivation",
              content:
                "An **eigenvector** v of matrix A satisfies Av = λv for some scalar **eigenvalue** λ. Rearranging: Av - λv = 0 ⟹ (A - λI)v = 0. For a non-trivial solution (v ≠ 0), the matrix (A - λI) must be singular (non-invertible), so **det(A - λI) = 0**. This is the **characteristic polynomial**.\n\n**Complete 2×2 example**: Let A = [[5, 2], [2, 2]]. Compute A - λI = [[5-λ, 2], [2, 2-λ]]. Determinant: (5-λ)(2-λ) - 2·2 = 10 - 5λ - 2λ + λ² - 4 = λ² - 7λ + 6 = 0. Factor: (λ - 6)(λ - 1) = 0 ⟹ λ₁ = 6, λ₂ = 1. **Find eigenvectors**: For λ₁ = 6: (A - 6I)v = 0 ⟹ [[-1, 2], [2, -4]]v = 0. Row 2 is -2×Row 1, so one equation: -v₁ + 2v₂ = 0 ⟹ v₁ = 2v₂. Choose v₂ = 1 ⟹ v₁ = [2, 1]ᵀ (unnormalized). For λ₂ = 1: (A - I)v = 0 ⟹ [[4, 2], [2, 1]]v = 0. Row 2 is (1/2)×Row 1: 4v₁ + 2v₂ = 0 ⟹ v₂ = -2v₁. Choose v₁ = 1 ⟹ v₂ = [1, -2]ᵀ. Normalize: v̂₁ = [2/√5, 1/√5], v̂₂ = [1/√5, -2/√5]. Verify orthogonality: v̂₁·v̂₂ = 2/5 - 2/5 = 0 ✓.\n\n**Properties of symmetric matrices**: All real symmetric matrices have (1) real eigenvalues and (2) orthogonal eigenvectors. **Eigendecomposition**: A = VΛVᵀ where V = [v₁, …, vₚ] (eigenvectors as columns, orthonormal so VᵀV = I) and Λ = diag(λ₁, …, λₚ). For our example: V = [[2/√5, 1/√5], [1/√5, -2/√5]], Λ = [[6, 0], [0, 1]]. Verify: VΛVᵀ = A (left to reader).\n\n**Connection to PCA**: The covariance matrix Σ is symmetric and PSD, so its eigenvectors are orthogonal and eigenvalues non-negative. The eigenvector with largest eigenvalue points in the direction of maximum variance. **PCA** = project data onto the top-k eigenvectors (principal components) to maximize retained variance.",
            },
            {
              type: "theory",
              title: "SVD, Condition Number & Numerical Stability",
              content:
                "The **Singular Value Decomposition (SVD)** factorizes any matrix A ∈ ℝᵐˣⁿ as A = UΣVᵀ, where U ∈ ℝᵐˣᵐ is an orthogonal matrix of **left singular vectors**, Σ ∈ ℝᵐˣⁿ is a diagonal matrix of **singular values** σ₁ ≥ σ₂ ≥ … ≥ σ_min ≥ 0, and V ∈ ℝⁿˣⁿ is an orthogonal matrix of **right singular vectors**. Unlike eigendecomposition (requires square matrix), SVD works for any rectangular matrix.\n\n**Relationship to eigendecomposition**: The singular values of A are σᵢ = √λᵢ(AᵀA) = √λᵢ(AAᵀ). The right singular vectors V are eigenvectors of AᵀA, and left singular vectors U are eigenvectors of AAᵀ. **PCA connection**: For centered data matrix X ∈ ℝⁿˣᵖ, the covariance Σ = (1/(n-1))XᵀX. If X = UΣ_xVᵀ, then XᵀX = VΣ_x²Vᵀ (using orthogonality of U). Thus, the right singular vectors V of X are the eigenvectors of the covariance matrix — precisely the principal components.\n\n**Condition number**: κ(A) = σ_max / σ_min. A high condition number (κ >> 1) means A is **ill-conditioned**: small changes in input cause large changes in output. **Numerical stability**: When solving Ax = b, if κ is large, rounding errors in floating-point arithmetic are amplified, producing unreliable solutions. For instance, if κ = 10⁶ and input has 16-digit precision, output may have only 10 accurate digits.\n\n**Pseudo-inverse**: For singular or non-square A, the ordinary inverse A⁻¹ doesn't exist. The **Moore-Penrose pseudo-inverse** A⁺ generalizes inversion: A⁺ = VΣ⁺Uᵀ, where Σ⁺ is formed by inverting non-zero singular values (Σ⁺ᵢᵢ = 1/σᵢ if σᵢ > 0, else 0). The solution x = A⁺b minimizes ‖Ax - b‖².\n\n**Financial relevance**: In forex, many technical indicators are **multicollinear** (e.g., RSI and Stochastic %K both measure momentum). This produces a nearly singular covariance matrix with very small eigenvalues, yielding high condition number. Fitting a regression model β = (XᵀX)⁻¹Xᵀy becomes unstable: small data perturbations drastically change β. PCA mitigates this by discarding low-variance (small eigenvalue) directions, effectively regularizing the problem.",
            },
            {
              type: "intuition",
              title: "The Shadow Analogy",
              analogy:
                "PCA is like finding the best angle to cast a shadow of a 3D object onto a wall — the angle that preserves the most detail.",
              content:
                "Imagine a complex 3D sculpture (your high-dimensional data). You shine a flashlight at it and observe the 2D shadow on the wall. Most angles produce a blob, but there's **one specific angle** where the shadow preserves the sculpture's shape best — that's your first principal component. Rotating the flashlight 90° (orthogonal) gives the second-best shadow. PCA finds these optimal 'flashlight angles' automatically by solving an eigenvalue problem. The **eigenvalue** for each angle tells you how much detail (variance) that shadow captures. If the sculpture is really just a thin wire coiled in 3D space, one shadow might capture 95% of the information, and the other two shadows add little — PCA would recommend keeping just the first component. **SVD** is a more general decomposition: it works even if your 'sculpture' is a morphing object (non-square matrix) or has collapsing dimensions. **Condition number** measures how sensitive the shadow is to slight changes in flashlight position: if κ is high, nudging the light a tiny bit drastically alters the shadow, making measurements unreliable.",
              emoji: "🔦",
            },
            {
              type: "intuition",
              title: "The Orchestra Analogy",
              analogy:
                "Eigenvectors are independent instruments; eigenvalues are their volumes.",
              content:
                "Imagine a symphony recording (your data). **Eigenvectors** are the independent 'instruments' (violin, cello, trumpet, etc.) that combine to produce the full sound. **Eigenvalues** measure how loud each instrument plays. The first instrument (largest eigenvalue) dominates the recording; the last instrument (smallest eigenvalue) is barely audible. **PCA** = keeping only the loudest instruments and muting the quiet ones. You retain 95% of the sound with, say, 5 instruments instead of 20. **SVD** decomposes the recording into (1) the instruments (right singular vectors V), (2) their volumes (singular values Σ), and (3) the mixing pattern over time (left singular vectors U). **Condition number**: If one instrument is so quiet it's drowned out by background noise (σ_min ≈ 0), removing it changes the music almost imperceptibly, but trying to isolate it amplifies noise and becomes numerically unstable. In trading, 'quiet instruments' are redundant indicators that add noise but no signal — PCA discards them.",
              emoji: "🎻",
            },
            {
              type: "code",
              title: "Matrix Operations & Covariance Matrix from Scratch",
              language: "python",
              code: `import numpy as np
import pandas as pd

# Create feature matrix from 5 forex trading bars with 4 indicators
# Columns: RSI_14, MACD, ATR_14, Volume
X = np.array([
    [65.2, 0.0034, 0.0045, 15000],
    [72.8, 0.0081, 0.0038, 18500],
    [58.1, -0.0021, 0.0052, 12000],
    [61.5, 0.0012, 0.0048, 14200],
    [69.3, 0.0065, 0.0041, 17100],
])
n, p = X.shape
print(f"Feature matrix X: {n} samples × {p} features")
print(X)

# Compute dot product manually for first two rows
a, b = X[0], X[1]
dot_product = sum(a[i] * b[i] for i in range(p))
print(f"\\nDot product of rows 1 & 2 (manual): {dot_product:.4f}")
print(f"Dot product of rows 1 & 2 (numpy):  {np.dot(a, b):.4f}")

# Matrix multiplication: X times weight vector w
w = np.array([0.4, 0.3, 0.2, 0.1])  # weights for each indicator
print(f"\\nWeight vector w: {w}")

# Manual computation for row 0
manual_result_0 = sum(X[0, k] * w[k] for k in range(p))
print(f"Row 0: {X[0, 0]}*{w[0]} + {X[0, 1]}*{w[1]} + {X[0, 2]}*{w[2]} + {X[0, 3]}*{w[3]}")
print(f"     = {X[0, 0]*w[0]:.4f} + {X[0, 1]*w[1]:.6f} + {X[0, 2]*w[2]:.6f} + {X[0, 3]*w[3]:.4f}")
print(f"     = {manual_result_0:.4f}")

# Full matrix-vector product
Xw = X @ w
print(f"\\nX @ w (all rows):")
for i, val in enumerate(Xw):
    print(f"  Row {i}: {val:.4f}")

# Build covariance matrix step-by-step
print(f"\\n{'='*60}")
print("COVARIANCE MATRIX CONSTRUCTION")
print('='*60)

# Step 1: Center the data (subtract column means)
mu = X.mean(axis=0)
print(f"Feature means μ: {mu}")
X_centered = X - mu
print(f"\\nCentered data X̃ (first 3 rows):")
print(X_centered[:3])

# Step 2: Compute X̃ᵀX̃
XtX = X_centered.T @ X_centered
print(f"\\nX̃ᵀX̃ shape: {XtX.shape}")
print("X̃ᵀX̃:")
print(XtX)

# Step 3: Divide by n-1 to get sample covariance
Sigma_manual = XtX / (n - 1)
print(f"\\nManual covariance Σ = (1/{n-1}) X̃ᵀX̃:")
print(Sigma_manual)

# Compare with numpy
Sigma_numpy = np.cov(X, rowvar=False)
print(f"\\nnumpy covariance:")
print(Sigma_numpy)
print(f"\\nMax difference: {np.abs(Sigma_manual - Sigma_numpy).max():.2e}")

# Verify symmetry
print(f"\\nΣ is symmetric: {np.allclose(Sigma_manual, Sigma_manual.T)}")

# Verify PSD: all eigenvalues should be ≥ 0
eigenvalues = np.linalg.eigvalsh(Sigma_manual)
print(f"Eigenvalues of Σ: {eigenvalues}")
print(f"Σ is PSD (all λ ≥ 0): {np.all(eigenvalues >= -1e-10)}")`,
              explanation:
                "We construct a 5×4 feature matrix from forex indicators, manually compute dot products and matrix-vector products to show the mechanics, then build the covariance matrix step-by-step: center data, compute X̃ᵀX̃, divide by n-1. We verify that Σ is symmetric and positive semi-definite by checking eigenvalues are non-negative. This is the foundation PCA operates on.",
            },
            {
              type: "code",
              title: "Eigendecomposition Step-by-Step",
              language: "python",
              code: `import numpy as np
from scipy.linalg import eigh

# Use the 2×2 covariance submatrix from previous example (RSI and MACD only)
# We'll use a simple symmetric matrix for pedagogical clarity
A = np.array([
    [5.0, 2.0],
    [2.0, 2.0],
])
print("Matrix A:")
print(A)
print(f"A is symmetric: {np.allclose(A, A.T)}")

# Compute characteristic polynomial: det(A - λI) = 0
# A - λI = [[5-λ, 2], [2, 2-λ]]
# det = (5-λ)(2-λ) - 2*2 = 10 - 5λ - 2λ + λ² - 4 = λ² - 7λ + 6
# Solve λ² - 7λ + 6 = 0 using quadratic formula: λ = (7 ± √(49-24))/2 = (7 ± 5)/2

lambda1 = (7 + 5) / 2
lambda2 = (7 - 5) / 2
print(f"\\nEigenvalues from quadratic formula:")
print(f"  λ₁ = {lambda1:.4f}")
print(f"  λ₂ = {lambda2:.4f}")

# Find eigenvector for λ₁ = 6: (A - 6I)v = 0
# [[5-6, 2], [2, 2-6]] = [[-1, 2], [2, -4]]
# Row 1: -v₁ + 2v₂ = 0  ⟹  v₁ = 2v₂
# Choose v₂ = 1  ⟹  v = [2, 1]ᵀ
v1_unnorm = np.array([2.0, 1.0])
v1 = v1_unnorm / np.linalg.norm(v1_unnorm)
print(f"\\nEigenvector v₁ (λ=6, normalized): {v1}")

# Find eigenvector for λ₂ = 1: (A - I)v = 0
# [[5-1, 2], [2, 2-1]] = [[4, 2], [2, 1]]
# Row 1: 4v₁ + 2v₂ = 0  ⟹  v₂ = -2v₁
# Choose v₁ = 1  ⟹  v = [1, -2]ᵀ
v2_unnorm = np.array([1.0, -2.0])
v2 = v2_unnorm / np.linalg.norm(v2_unnorm)
print(f"Eigenvector v₂ (λ=1, normalized): {v2}")

# Verify orthogonality
print(f"\\nv₁ · v₂ = {np.dot(v1, v2):.6f}  (should be ≈ 0)")

# Construct V and Λ
V = np.column_stack([v1, v2])
Lambda = np.diag([lambda1, lambda2])
print(f"\\nEigenvector matrix V:")
print(V)
print(f"\\nEigenvalue matrix Λ:")
print(Lambda)

# Verify A = VΛVᵀ
A_reconstructed = V @ Lambda @ V.T
print(f"\\nReconstructed A = VΛVᵀ:")
print(A_reconstructed)
print(f"Reconstruction error: {np.linalg.norm(A - A_reconstructed):.2e}")

# Compare with numpy's eigendecomposition
eigenvalues_np, eigenvectors_np = np.linalg.eigh(A)
print(f"\\nnumpy eigenvalues: {eigenvalues_np}")
print(f"numpy eigenvectors:")
print(eigenvectors_np)

# Apply to full covariance matrix from previous example
print(f"\\n{'='*60}")
print("EIGENDECOMPOSITION OF FULL COVARIANCE MATRIX")
print('='*60)

# Recreate the covariance matrix (4×4)
X = np.array([
    [65.2, 0.0034, 0.0045, 15000],
    [72.8, 0.0081, 0.0038, 18500],
    [58.1, -0.0021, 0.0052, 12000],
    [61.5, 0.0012, 0.0048, 14200],
    [69.3, 0.0065, 0.0041, 17100],
])
Sigma = np.cov(X, rowvar=False)

# Eigendecomposition
eigenvalues_full, eigenvectors_full = eigh(Sigma)
# eigh returns in ascending order; reverse for descending
idx = eigenvalues_full.argsort()[::-1]
eigenvalues_full = eigenvalues_full[idx]
eigenvectors_full = eigenvectors_full[:, idx]

print(f"Eigenvalues (descending):")
for i, lam in enumerate(eigenvalues_full):
    print(f"  λ{i+1} = {lam:.6f}")

# Variance explained
total_var = eigenvalues_full.sum()
explained_ratio = eigenvalues_full / total_var
cumulative = np.cumsum(explained_ratio)
print(f"\\nVariance explained:")
for i in range(len(eigenvalues_full)):
    print(f"  PC{i+1}: {explained_ratio[i]*100:.2f}%  (cumulative: {cumulative[i]*100:.2f}%)")

# PCA projection: project onto first 2 principal components
k = 2
V_k = eigenvectors_full[:, :k]
X_centered = X - X.mean(axis=0)
Z = X_centered @ V_k
print(f"\\nPCA projection onto top {k} components (Z = X̃V_k):")
print(f"Z shape: {Z.shape}")
print(Z)`,
              explanation:
                "We manually solve the characteristic polynomial for a 2×2 matrix, find eigenvalues via the quadratic formula, compute eigenvectors by solving (A-λI)v=0, verify orthogonality, and reconstruct A = VΛVᵀ. We then apply eigendecomposition to the full 4×4 covariance matrix, showing how eigenvalues quantify variance per principal component. This is the mathematical core of PCA.",
            },
            {
              type: "code",
              title: "SVD, Condition Number & Feature Stability Analysis",
              language: "python",
              code: `import numpy as np
from numpy.linalg import svd, cond

# Use the centered feature matrix from previous examples
X = np.array([
    [65.2, 0.0034, 0.0045, 15000],
    [72.8, 0.0081, 0.0038, 18500],
    [58.1, -0.0021, 0.0052, 12000],
    [61.5, 0.0012, 0.0048, 14200],
    [69.3, 0.0065, 0.0041, 17100],
])
X_centered = X - X.mean(axis=0)
n, p = X_centered.shape

print("Centered feature matrix X̃:")
print(X_centered)
print(f"Shape: {n} samples × {p} features\\n")

# Compute SVD: X̃ = U Σ Vᵀ
U, singular_values, Vt = svd(X_centered, full_matrices=False)
V = Vt.T

print(f"Singular values σ:")
for i, s in enumerate(singular_values):
    print(f"  σ{i+1} = {s:.6f}")

# Condition number
kappa = cond(X_centered)
print(f"\\nCondition number κ(X̃) = σ_max/σ_min = {singular_values[0]}/{singular_values[-1]:.6f} = {kappa:.2f}")

if kappa > 100:
    print("⚠ High condition number indicates potential multicollinearity!")
else:
    print("✓ Condition number is acceptable.")

# Identify near-multicollinear features
# Features with very small contribution to smallest singular values are redundant
print(f"\\nRight singular vectors V (columns = principal directions):")
print(V)
print(f"\\nFeature loadings on smallest singular vector (PC{p}):")
feature_names = ["RSI_14", "MACD", "ATR_14", "Volume"]
loadings = V[:, -1]
for i, name in enumerate(feature_names):
    print(f"  {name}: {loadings[i]:.4f}")

# Compare SVD-based PCA with eigendecomposition-based PCA
# Eigenvalues from covariance = (singular values)² / (n-1)
eigenvalues_from_svd = (singular_values ** 2) / (n - 1)
print(f"\\nEigenvalues from SVD: σ² / (n-1)")
for i, lam in enumerate(eigenvalues_from_svd):
    print(f"  λ{i+1} = {lam:.6f}")

# Direct eigendecomposition of covariance
Sigma = np.cov(X, rowvar=False)
eigenvalues_direct = np.linalg.eigvalsh(Sigma)[::-1]  # descending order
print(f"\\nEigenvalues from direct eigendecomposition of Σ:")
for i, lam in enumerate(eigenvalues_direct):
    print(f"  λ{i+1} = {lam:.6f}")

print(f"\\nMax difference between methods: {np.abs(eigenvalues_from_svd - eigenvalues_direct).max():.2e}")
print("✓ SVD and eigendecomposition yield identical PCA results.")

# Variance explained via SVD
total_var_svd = eigenvalues_from_svd.sum()
explained_ratio = eigenvalues_from_svd / total_var_svd
cumulative = np.cumsum(explained_ratio)
print(f"\\nVariance explained by each PC:")
for i in range(p):
    print(f"  PC{i+1}: {explained_ratio[i]*100:.2f}%  (cumulative: {cumulative[i]*100:.2f}%)")

# Compute pseudo-inverse via SVD: X⁺ = V Σ⁺ Uᵀ
# Σ⁺: invert non-zero singular values
Sigma_plus = np.diag(1 / singular_values)  # all non-zero in this case
X_pseudo_inv = V @ Sigma_plus @ U.T
print(f"\\nPseudo-inverse X⁺ via SVD:")
print(f"Shape: {X_pseudo_inv.shape}")
print(f"Verification: ‖X̃ X⁺ X̃ - X̃‖ = {np.linalg.norm(X_centered @ X_pseudo_inv @ X_centered - X_centered):.2e}")`,
              explanation:
                "We compute the SVD of the centered feature matrix, extract singular values and condition number to assess multicollinearity, and verify that SVD-based PCA yields identical results to eigendecomposition-based PCA. We also compute the pseudo-inverse via SVD. High condition number signals ill-conditioning due to redundant features — critical for detecting unstable regression scenarios in trading models.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "found-la-q1",
                  question:
                    "Given the 2×2 matrix A = [[3, 1], [1, 3]], compute its eigenvalues by solving det(A - λI) = 0.",
                  options: [
                    { id: "found-la-q1-a", text: "λ₁ = 4, λ₂ = 2" },
                    { id: "found-la-q1-b", text: "λ₁ = 3, λ₂ = 1" },
                    { id: "found-la-q1-c", text: "λ₁ = 5, λ₂ = 1" },
                    { id: "found-la-q1-d", text: "λ₁ = 6, λ₂ = 0" },
                  ],
                  correctOptionId: "found-la-q1-a",
                  explanation:
                    "det(A - λI) = (3-λ)(3-λ) - 1·1 = λ² - 6λ + 9 - 1 = λ² - 6λ + 8 = 0. Factoring: (λ-4)(λ-2) = 0, so λ₁ = 4 and λ₂ = 2. This characteristic polynomial approach is the foundation of eigendecomposition.",
                },
                {
                  id: "found-la-q2",
                  question:
                    "Why is it essential to standardize features (zero mean, unit variance) before applying PCA?",
                  options: [
                    { id: "found-la-q2-a", text: "PCA algorithm only works with integers" },
                    { id: "found-la-q2-b", text: "Features on larger scales dominate variance and bias the principal components" },
                    { id: "found-la-q2-c", text: "Standardization converts the covariance matrix to the identity matrix" },
                    { id: "found-la-q2-d", text: "It guarantees all eigenvalues are equal" },
                  ],
                  correctOptionId: "found-la-q2-b",
                  explanation:
                    "PCA maximizes variance. If one feature ranges [0, 10000] (e.g., volume) and another ranges [0, 1] (e.g., MACD), the large-scale feature will dominate the first principal component regardless of its informational value. Standardizing to zero mean and unit variance puts all features on equal footing, ensuring PCA captures true data structure rather than artificial scale differences.",
                },
                {
                  id: "found-la-q3",
                  question:
                    "A covariance matrix has eigenvalues λ₁=8.0, λ₂=1.5, λ₃=0.4, λ₄=0.1. Which features are likely multicollinear?",
                  options: [
                    { id: "found-la-q3-a", text: "Features corresponding to λ₁" },
                    { id: "found-la-q3-b", text: "Features corresponding to λ₃ and λ₄ (small eigenvalues)" },
                    { id: "found-la-q3-c", text: "All features are multicollinear" },
                    { id: "found-la-q3-d", text: "Eigenvalues don't reveal multicollinearity" },
                  ],
                  correctOptionId: "found-la-q3-b",
                  explanation:
                    "Small eigenvalues indicate directions with low variance, meaning the data is nearly constant along those directions — a hallmark of multicollinearity (linear dependencies among features). The features with high loadings on eigenvectors corresponding to λ₃ and λ₄ are redundant. Large eigenvalues indicate independent variation.",
                },
                {
                  id: "found-la-q4",
                  question:
                    "What does a high condition number κ(A) = σ_max/σ_min >> 1 signify?",
                  options: [
                    { id: "found-la-q4-a", text: "The matrix is well-conditioned and numerically stable" },
                    { id: "found-la-q4-b", text: "The matrix is ill-conditioned; small input changes cause large output changes" },
                    { id: "found-la-q4-c", text: "All singular values are equal" },
                    { id: "found-la-q4-d", text: "The matrix has no inverse" },
                  ],
                  correctOptionId: "found-la-q4-b",
                  explanation:
                    "A high condition number (κ >> 1) means the matrix is ill-conditioned: small perturbations in input data are amplified in the output, leading to numerical instability. This occurs when features are multicollinear (smallest singular value σ_min ≈ 0), making inversion or regression unstable. For trading models, high κ signals that feature engineering or regularization is needed.",
                },
                {
                  id: "found-la-q5",
                  question:
                    "If PCA retains k=3 components with eigenvalues λ₁=5.0, λ₂=2.0, λ₃=1.0 from a total of Σλᵢ=10, what is the fraction of variance retained?",
                  options: [
                    { id: "found-la-q5-a", text: "50%" },
                    { id: "found-la-q5-b", text: "80%" },
                    { id: "found-la-q5-c", text: "70%" },
                    { id: "found-la-q5-d", text: "30%" },
                  ],
                  correctOptionId: "found-la-q5-b",
                  explanation:
                    "Variance retained = (λ₁ + λ₂ + λ₃) / Σλᵢ = (5.0 + 2.0 + 1.0) / 10 = 8.0 / 10 = 80%. Three components capture 80% of the total variance, a significant dimensionality reduction from the original feature set.",
                },
                {
                  id: "found-la-q6",
                  question:
                    "What happens if you apply PCA without first centering the data (subtracting the mean)?",
                  options: [
                    { id: "found-la-q6-a", text: "PCA still works correctly" },
                    { id: "found-la-q6-b", text: "The first principal component becomes dominated by the mean offset, obscuring variance structure" },
                    { id: "found-la-q6-c", text: "All eigenvalues become zero" },
                    { id: "found-la-q6-d", text: "The covariance matrix becomes singular" },
                  ],
                  correctOptionId: "found-la-q6-b",
                  explanation:
                    "Without centering, the covariance matrix XᵀX includes the outer product of the mean vector, causing the first principal component to point toward the mean rather than the direction of maximum variance. This obscures the true data structure. Centering ensures PCA captures variance around the mean, not absolute position. Always center (and usually standardize) before PCA.",
                },
              ],
            },
            {
              type: "practice",
              title: "Eigendecomposition by Hand",
              description:
                "Compute the eigendecomposition of a 3×3 symmetric covariance matrix by hand: write the characteristic polynomial det(A - λI) = 0, solve for the three eigenvalues (use a cubic equation solver or numerical approximation if needed), find the corresponding eigenvectors by solving (A - λI)v = 0, verify orthogonality, and check that A = VΛVᵀ. Then verify your results with np.linalg.eigh(A).",
            },
            {
              type: "practice",
              title: "PCA Dashboard Visualization",
              description:
                "Navigate to a model's feature importance panel in the dashboard and enable PCA visualization. Examine the scree plot (eigenvalues vs component number) to identify the 'elbow' — the point where adding more components yields diminishing returns. Experiment: add or remove technical indicators and observe how the explained variance curve changes. Identify which features load heavily on the first principal component and interpret their trading significance.",
              catalogModelId: "pca-feature-analysis",
            },
          ],
        },
        {
          id: "found-optimization",
          title: "Optimization Methods",
          description:
            "Master the mathematical foundations of gradient descent, Newton's method, and modern optimizers (SGD, Momentum, Adam) — the engine that powers all ML training from linear regression to transformers.",
          estimatedMinutes: 90,
          difficulty: "beginner",
          sections: [
            {
              type: "objective",
              content:
                "You will derive the gradient descent update rule from Taylor expansion, prove convergence conditions for convex functions, distinguish first-order (GD, SGD, Momentum, Adam) from second-order methods (Newton, BFGS), and implement all optimizers from scratch to train a forex trading model.",
              keyTakeaways: [
                "Gradient descent update θₜ₊₁ = θₜ − α∇L(θₜ) derived from first-order Taylor approximation; geometrically moves along steepest descent direction",
                "Convergence requires Lipschitz continuous gradients (‖∇L(x) − ∇L(y)‖ ≤ L‖x−y‖) and learning rate α ≤ 1/L; rate is O(1/T) for convex, O(1/T²) for strongly convex",
                "Convexity: first-order condition L(y) ≥ L(x) + ∇L(x)ᵀ(y−x); second-order ∇²L ⪰ 0; strongly convex ∇²L ⪰ μI implies unique global minimum",
                "SGD approximates gradient with mini-batch ∇L ≈ (1/|B|)∑ᵢ∈B ∇ℓᵢ; noise helps escape saddle points; batch size trades off convergence speed vs generalization",
                "Momentum vₜ = βvₜ₋₁ + ∇L is exponential moving average with effective window 1/(1−β); dampens oscillations in high-curvature directions",
                "Newton's method θₜ₊₁ = θₜ − H⁻¹∇L derived from second-order Taylor; quadratic convergence (doubles digits per step) but O(d³) cost",
                "Adam = momentum (first moment) + RMSProp (second moment) with bias correction m̂ₜ/(1−β₁ᵗ) and v̂ₜ/(1−β₂ᵗ) to counter initialization bias",
                "Learning rate schedules: warmup prevents early instability; cosine annealing αₜ = α₀·(1 + cos(πt/T))/2 improves final convergence",
              ],
            },
            {
              type: "theory",
              title: "Gradient Descent: Derivation & Convergence Analysis",
              content:
                "**Derivation from Taylor Expansion**: To minimize loss L(θ), consider a step θ − αg where g = ∇L(θ). By Taylor expansion: L(θ − αg) ≈ L(θ) − α‖g‖² + (α²/2)gᵀHg where H = ∇²L is the Hessian. For descent, we need L(θ−αg) < L(θ), which requires α‖g‖² > (α²/2)gᵀHg. Rearranging: α < 2‖g‖²/(gᵀHg). For convex functions with **L-Lipschitz continuous gradients** (‖∇L(x) − ∇L(y)‖ ≤ L‖x−y‖), the Hessian satisfies H ⪯ LI, so gᵀHg ≤ L‖g‖². This gives the convergence condition: **α ≤ 1/L**. Under this condition, gradient descent achieves **O(1/T) convergence**: L(θ_T) − L(θ*) ≤ ‖θ₀−θ*‖²/(2αT).\n\n**Optimal Learning Rate for Quadratic Loss**: Consider L(θ) = (1/2)θᵀAθ − bᵀθ where A is positive definite. The gradient is ∇L = Aθ − b. At iteration t, the update is θₜ₊₁ = θₜ − α(Aθₜ−b) = (I−αA)θₜ + αb. This is a linear recursion; convergence requires all eigenvalues of I−αA to have magnitude < 1. If A has eigenvalues λ₁,...,λ_d, we need |1−αλᵢ| < 1 for all i, giving 0 < α < 2/λ_max. The optimal α minimizing the spectral radius is α* = 2/(λ_min + λ_max). The convergence rate is governed by the **condition number** κ = λ_max/λ_min.\n\n**Numerical Example**: Let A = [[4, 0], [0, 2]], b = [12, −4]. Eigenvalues: λ₁=4, λ₂=2. Optimal θ* = A⁻¹b = [3, −2]. Try α=0.1, α=0.3, α=0.6. For α=0.1: spectral radius ρ = max(|1−0.4|, |1−0.2|) = 0.8 → convergence. For α=0.3: ρ = max(|1−1.2|, |1−0.6|) = max(0.2, 0.4) = 0.4 → faster convergence. For α=0.6: ρ = max(|1−2.4|, |1−1.2|) = 1.4 → divergence (overshooting). The convergence speed is determined by ρ; smaller ρ means faster convergence. After k steps, the error ‖θₖ−θ*‖ ≈ ρᵏ‖θ₀−θ*‖.",
            },
            {
              type: "theory",
              title: "Convexity: First & Second Order Conditions",
              content:
                "**First-Order Condition**: A differentiable function L is **convex** if and only if L(y) ≥ L(x) + ∇L(x)ᵀ(y−x) for all x, y. Geometrically, the tangent hyperplane at any point is a global underestimator — the function always lies above its linear approximation. This implies that any local minimum is a global minimum. For convex L, gradient descent with α ≤ 1/L is guaranteed to converge to the global minimum.\n\n**Second-Order Condition**: L is convex if and only if the Hessian is positive semidefinite everywhere: ∇²L(x) ⪰ 0 for all x. **Strongly convex** functions satisfy ∇²L(x) ⪰ μI for some μ > 0, meaning the smallest eigenvalue of the Hessian is bounded below. Strong convexity gives faster O(1/T²) convergence. The **condition number** κ = L/μ (ratio of largest to smallest curvature) determines how many iterations are needed; ill-conditioned problems (large κ) converge slowly.\n\n**Non-Convex Landscapes**: Neural networks and most real-world ML problems are non-convex. The loss surface contains **local minima** (points where ∇L=0 and ∇²L ⪰ 0 but not global optimum), **saddle points** (∇L=0 but ∇²L has both positive and negative eigenvalues), and **plateaus** (regions where ‖∇L‖ ≈ 0). Remarkably, **SGD's noise helps escape saddle points**: at a saddle, the Hessian has at least one negative eigenvalue, meaning there's a descent direction. The stochastic gradient has a component along this direction with high probability, allowing the optimizer to escape. In high dimensions, saddle points are far more common than local minima (exponentially so), making this escape mechanism critical for deep learning.",
            },
            {
              type: "theory",
              title: "Newton's Method & Second-Order Optimization",
              content:
                "**Derivation from Second-Order Taylor Expansion**: Approximate the loss around θ by a quadratic: L(θ+δ) ≈ L(θ) + ∇L(θ)ᵀδ + (1/2)δᵀ∇²L(θ)δ. To find the optimal step δ*, minimize this quadratic by setting its gradient to zero: ∇L(θ) + ∇²L(θ)δ = 0, giving **δ* = −[∇²L(θ)]⁻¹∇L(θ)**. The Newton update is: θₜ₊₁ = θₜ − [∇²L(θₜ)]⁻¹∇L(θₜ). For a quadratic loss, this converges in **one step** (the approximation is exact). For general smooth functions, Newton's method has **quadratic convergence**: ‖θₜ₊₁ − θ*‖ ≈ C‖θₜ − θ*‖², doubling the number of correct digits per iteration once near the optimum.\n\n**Advantages**: (1) No learning rate tuning required — the Hessian automatically scales the step. (2) Invariant to affine transformations — works well for ill-conditioned problems where gradient descent struggles. (3) Extremely fast convergence near the optimum. **Disadvantages**: (1) Computing and inverting the d×d Hessian costs O(d³), prohibitive for large d (e.g., millions of parameters). (2) The Hessian must be positive definite; for non-convex problems, it may have negative eigenvalues, causing divergence. (3) Requires second derivatives, which are expensive to compute.\n\n**Quasi-Newton Methods (BFGS)**: Instead of computing H⁻¹ exactly, maintain an approximation Bₜ ≈ H⁻¹ and update it iteratively using gradient information. The BFGS update ensures Bₜ remains positive definite and satisfies the secant condition. This reduces cost to O(d²) per iteration. **Financial Application**: Portfolio optimization minimizes variance (1/2)wᵀΣw subject to return constraints — a quadratic program where Newton's method converges in one step. For a portfolio with covariance matrix Σ and expected returns μ, the optimal weights w* = Σ⁻¹μ (ignoring constraints) are found directly via Hessian inversion.",
            },
            {
              type: "theory",
              title: "Momentum, RMSProp & the Adam Optimizer",
              content:
                "**SGD with Momentum**: Instead of updating directly with the gradient, maintain a velocity vector vₜ = βvₜ₋₁ + ∇L(θₜ), then update θₜ₊₁ = θₜ − αvₜ. This is an **exponential moving average** of past gradients with decay β (typically 0.9). Expanding the recursion: vₜ = ∑ᵢ₌₀^∞ βⁱ∇L(θₜ₋ᵢ), giving effective window size ≈ 1/(1−β) ≈ 10 for β=0.9. Momentum accumulates velocity in directions of consistent gradient, accelerating convergence in ravines (high curvature in one direction, low in others). It dampens oscillations perpendicular to the optimum while speeding progress toward it.\n\n**RMSProp (Root Mean Square Propagation)**: Adapts the learning rate per parameter. Maintain a running average of squared gradients: sₜ = β₂sₜ₋₁ + (1−β₂)(∇L)², then update θₜ₊₁ = θₜ − α·∇L/√(sₜ+ε). Parameters with large typical gradients get smaller effective learning rates (α/√sₜ is small), while parameters with small gradients get larger effective rates. This is crucial for neural networks where different layers have vastly different gradient magnitudes.\n\n**Adam (Adaptive Moment Estimation)**: Combines momentum and RMSProp. Compute first moment (mean): mₜ = β₁mₜ₋₁ + (1−β₁)gₜ, and second moment (uncentered variance): vₜ = β₂vₜ₋₁ + (1−β₂)gₜ². Since m₀=0 and v₀=0, these estimates are biased toward zero in early iterations. **Bias correction**: m̂ₜ = mₜ/(1−β₁ᵗ) and v̂ₜ = vₜ/(1−β₂ᵗ). Update: θₜ₊₁ = θₜ − α·m̂ₜ/√(v̂ₜ+ε). Default hyperparameters: β₁=0.9, β₂=0.999, ε=10⁻⁸, α=0.001. **Why bias correction is needed**: At t=1, m₁ = (1−β₁)g₁ = 0.1g₁, which is 10× smaller than g₁. Without correction, the first few steps would be tiny. With correction, m̂₁ = 0.1g₁/(1−0.9) = g₁. As t→∞, 1−β₁ᵗ→1, so the correction vanishes.",
            },
            {
              type: "intuition",
              title: "The Mountain Hiker Analogy",
              analogy:
                "Gradient descent is a blindfolded hiker descending a mountain, feeling the slope underfoot.",
              content:
                "Imagine you're blindfolded on a mountainside, trying to reach the valley. **Gradient descent**: Step downhill in the steepest direction you feel. **Learning rate**: Your step size — too large and you overshoot the valley, bouncing from ridge to ridge; too small and you're still hiking at dawn. **Convex landscape**: One valley — you're guaranteed to reach it. **Non-convex**: Multiple valleys and ridges — you might get stuck in a shallow dip. **Momentum**: You're a rolling ball, not a hiker — inertia carries you past small bumps and helps you barrel through shallow valleys toward deeper ones. **Adam**: A smart hiker who adjusts stride based on terrain steepness — taking tiny steps on steep cliffs (high curvature) and giant strides across gentle slopes (low curvature), automatically finding the right pace for each direction.",
              emoji: "🏔️",
            },
            {
              type: "intuition",
              title: "The Ball Rolling Down a Bowl Analogy",
              analogy:
                "A ball in a bowl naturally finds the lowest point via gravity — analogous to gradient descent.",
              content:
                "Picture a ball placed anywhere inside a bowl. Gravity pulls it toward the lowest point. **Gradient descent** is the ball's motion, always rolling downhill. In a narrow, elongated bowl (ill-conditioned problem), the ball oscillates wildly side-to-side while slowly moving toward the center — this is why steep gradients in one direction and gentle in another cause slow convergence. **Momentum** dampens these oscillations: the ball builds velocity in the consistent downward direction and averages out the sideways wobbles. **Newton's method** is like knowing the exact shape of the bowl and calculating the center analytically — you jump straight there in one leap. **SGD** is a vibrating bowl: the shaking (noise from mini-batches) randomly nudges the ball, helping it escape shallow dents and settle into the deepest part. **Adam** is a smart ball that rolls faster in flat directions (where it can safely speed up) and slower in steep ones (where overshooting is risky), automatically tuning its speed per direction.",
              emoji: "⚽",
            },
            {
              type: "code",
              title: "Gradient Descent with Convergence Analysis",
              language: "python",
              code: `import numpy as np

# Quadratic loss L(θ) = (1/2)θᵀAθ - bᵀθ
# A = [[4, 0], [0, 2]], b = [12, -4]
# Optimal: θ* = A⁻¹b = [3, -2], L(θ*) = -22
A = np.array([[4.0, 0.0], [0.0, 2.0]])
b = np.array([12.0, -4.0])
theta_star = np.linalg.solve(A, b)  # [3, -2]

def loss(theta):
    return 0.5 * theta @ A @ theta - b @ theta

def gradient(theta):
    return A @ theta - b

# Eigenvalues: λ₁=4, λ₂=2
# Optimal α: 2/(λ_min+λ_max) = 2/6 = 0.333
# Convergence bound: α < 2/λ_max = 0.5
learning_rates = [0.1, 0.3, 0.6]  # slow, fast, diverge
n_steps = 20

print(f"Optimal θ* = {theta_star}, L(θ*) = {loss(theta_star):.2f}")
print(f"Eigenvalues: {np.linalg.eigvalsh(A)}, κ = {4/2:.1f}\\n")

for alpha in learning_rates:
    theta = np.array([0.0, 0.0])
    spectral_radius = max(abs(1 - alpha * np.linalg.eigvalsh(A)))
    print(f"\\n{'='*60}")
    print(f"Learning rate α = {alpha:.1f}, ρ(I−αA) = {spectral_radius:.2f}")
    print(f"{'Step':>4}  {'θ₁':>8}  {'θ₂':>8}  {'L(θ)':>10}  {'‖θ−θ*‖':>10}")
    print("-" * 60)
    
    for step in range(n_steps):
        L = loss(theta)
        error = np.linalg.norm(theta - theta_star)
        if step % 5 == 0 or step == n_steps - 1:
            print(f"{step:4d}  {theta[0]:8.4f}  {theta[1]:8.4f}  {L:10.4f}  {error:10.6f}")
        
        grad = gradient(theta)
        theta = theta - alpha * grad
        
        # Detect divergence
        if np.linalg.norm(theta) > 1e6:
            print("DIVERGED")
            break
    
    if np.linalg.norm(theta) < 1e6:
        print(f"Final: θ = [{theta[0]:.4f}, {theta[1]:.4f}], converged = {error < 0.01}")`,
              explanation:
                "We test three learning rates on a 2D quadratic loss. α=0.1 converges slowly (ρ=0.8). α=0.3 converges quickly (ρ=0.4, near optimal). α=0.6 exceeds 2/λ_max=0.5, causing divergence as predicted by theory. The spectral radius ρ = max|1−αλᵢ| determines convergence speed — smaller ρ means faster convergence. The condition number κ=2 is well-conditioned, so convergence is fairly uniform in all directions.",
            },
            {
              type: "code",
              title: "Newton's Method vs Gradient Descent",
              language: "python",
              code: `import numpy as np

# Same quadratic loss as before
A = np.array([[4.0, 0.0], [0.0, 2.0]])
b = np.array([12.0, -4.0])
theta_star = np.array([3.0, -2.0])

def loss(theta):
    return 0.5 * theta @ A @ theta - b @ theta

def gradient(theta):
    return A @ theta - b

def hessian(theta):
    return A  # Hessian of quadratic is constant

# Gradient Descent
print("GRADIENT DESCENT (α=0.2)")
theta_gd = np.array([0.0, 0.0])
alpha = 0.2
for step in range(10):
    if step % 2 == 0:
        print(f"  Step {step}: θ = {theta_gd}, L = {loss(theta_gd):.4f}")
    theta_gd = theta_gd - alpha * gradient(theta_gd)

print(f"  Final: θ = {theta_gd}, ‖θ−θ*‖ = {np.linalg.norm(theta_gd - theta_star):.6f}\\n")

# Newton's Method
print("NEWTON'S METHOD")
theta_newton = np.array([0.0, 0.0])
for step in range(3):
    H = hessian(theta_newton)
    g = gradient(theta_newton)
    delta = np.linalg.solve(H, g)  # Solve Hδ = g for δ
    print(f"  Step {step}: θ = {theta_newton}, L = {loss(theta_newton):.4f}")
    theta_newton = theta_newton - delta
    
print(f"  Final: θ = {theta_newton}, ‖θ−θ*‖ = {np.linalg.norm(theta_newton - theta_star):.10f}")
print("  → Converged in 1 step (quadratic loss)\\n")

# Try on Rosenbrock (non-convex): L(x,y) = (1-x)² + 100(y-x²)²
print("\\nROSENBROCK FUNCTION (non-convex)")
def rosenbrock(theta):
    x, y = theta
    return (1 - x)**2 + 100*(y - x**2)**2

def rosenbrock_grad(theta):
    x, y = theta
    dx = -2*(1-x) - 400*x*(y - x**2)
    dy = 200*(y - x**2)
    return np.array([dx, dy])

def rosenbrock_hess(theta):
    x, y = theta
    h11 = 2 - 400*(y - 3*x**2)
    h12 = -400*x
    h22 = 200
    return np.array([[h11, h12], [h12, h22]])

theta_opt = np.array([1.0, 1.0])  # Global minimum
theta = np.array([0.5, 0.5])

for step in range(5):
    H = rosenbrock_hess(theta)
    g = rosenbrock_grad(theta)
    try:
        delta = np.linalg.solve(H, g)
        theta = theta - delta
        print(f"  Step {step}: θ = [{theta[0]:.4f}, {theta[1]:.4f}], L = {rosenbrock(theta):.6f}")
    except np.linalg.LinAlgError:
        print(f"  Step {step}: Hessian singular, Newton failed")
        break`,
              explanation:
                "For the quadratic loss, Newton's method converges in exactly 1 iteration — the second-order approximation is perfect. Gradient descent needs 10+ steps. On the Rosenbrock function (a classic non-convex test), Newton converges rapidly when started near the optimum, demonstrating quadratic convergence. However, Newton can fail if the Hessian is indefinite or singular (common far from the optimum in non-convex problems).",
            },
            {
              type: "code",
              title: "SGD, Momentum & Adam on a Trading Loss",
              language: "python",
              code: `import numpy as np

# Simulate forex returns: y = Xw + noise
# Goal: predict next-bar return using lagged returns
np.random.seed(42)
n, d = 500, 5  # 500 bars, 5 features (lags)
X = np.random.randn(n, d)
w_true = np.array([0.3, -0.2, 0.1, 0.05, -0.1])
y = X @ w_true + 0.1 * np.random.randn(n)

# MSE loss: L(w) = (1/2n)‖y - Xw‖²
def loss(w):
    return 0.5 * np.mean((y - X @ w)**2)

def gradient(w):
    return -X.T @ (y - X @ w) / n

def mini_batch_gradient(w, batch_size=32):
    idx = np.random.choice(n, batch_size, replace=False)
    X_batch, y_batch = X[idx], y[idx]
    return -X_batch.T @ (y_batch - X_batch @ w) / batch_size

# Hyperparameters
alpha = 0.01
beta1, beta2 = 0.9, 0.999
eps = 1e-8
n_epochs = 100
batch_size = 32

# Initialize
w_sgd = np.zeros(d)
w_momentum = np.zeros(d)
v_momentum = np.zeros(d)
w_adam = np.zeros(d)
m_adam = np.zeros(d)
v_adam = np.zeros(d)

losses_sgd, losses_momentum, losses_adam = [], [], []

print(f"Training on {n} forex bars, {d} features")
print(f"True weights: {w_true}\\n")
print(f"{'Epoch':>5}  {'SGD Loss':>10}  {'Momentum':>10}  {'Adam Loss':>10}")
print("-" * 50)

for epoch in range(n_epochs):
    # SGD
    g_sgd = mini_batch_gradient(w_sgd, batch_size)
    w_sgd = w_sgd - alpha * g_sgd
    
    # SGD + Momentum
    g_mom = mini_batch_gradient(w_momentum, batch_size)
    v_momentum = beta1 * v_momentum + g_mom
    w_momentum = w_momentum - alpha * v_momentum
    
    # Adam
    g_adam = mini_batch_gradient(w_adam, batch_size)
    m_adam = beta1 * m_adam + (1 - beta1) * g_adam
    v_adam = beta2 * v_adam + (1 - beta2) * (g_adam ** 2)
    m_hat = m_adam / (1 - beta1**(epoch + 1))
    v_hat = v_adam / (1 - beta2**(epoch + 1))
    w_adam = w_adam - alpha * m_hat / (np.sqrt(v_hat) + eps)
    
    # Record losses
    losses_sgd.append(loss(w_sgd))
    losses_momentum.append(loss(w_momentum))
    losses_adam.append(loss(w_adam))
    
    if epoch % 20 == 0 or epoch == n_epochs - 1:
        print(f"{epoch:5d}  {losses_sgd[-1]:10.6f}  {losses_momentum[-1]:10.6f}  {losses_adam[-1]:10.6f}")

print(f"\\nFinal Weights:")
print(f"  True:     {w_true}")
print(f"  SGD:      {w_sgd} (loss={losses_sgd[-1]:.6f})")
print(f"  Momentum: {w_momentum} (loss={losses_momentum[-1]:.6f})")
print(f"  Adam:     {w_adam} (loss={losses_adam[-1]:.6f})")
print(f"\\nConvergence epochs (loss < 0.006):")
print(f"  SGD: {next((i for i,L in enumerate(losses_sgd) if L<0.006), 'N/A')}")
print(f"  Momentum: {next((i for i,L in enumerate(losses_momentum) if L<0.006), 'N/A')}")
print(f"  Adam: {next((i for i,L in enumerate(losses_adam) if L<0.006), 'N/A')}")`,
              explanation:
                "We train a linear model to predict forex returns using SGD, SGD+Momentum, and Adam. All three converge, but at different rates. Momentum typically converges faster than vanilla SGD by accumulating velocity. Adam often converges fastest because it adapts per-parameter learning rates — features with small gradients get boosted, features with large gradients get dampened. The bias correction in Adam is critical in early epochs; without it, updates would be tiny initially.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "found-opt-q1",
                  question:
                    "What is the first-order condition for a function L(θ) to be convex?",
                  options: [
                    { id: "found-opt-q1-a", text: "L(y) ≤ L(x) + ∇L(x)ᵀ(y−x) for all x, y" },
                    { id: "found-opt-q1-b", text: "L(y) ≥ L(x) + ∇L(x)ᵀ(y−x) for all x, y" },
                    { id: "found-opt-q1-c", text: "∇L(x) = 0 for all x" },
                    { id: "found-opt-q1-d", text: "L(x+y) = L(x) + L(y)" },
                  ],
                  correctOptionId: "found-opt-q1-b",
                  explanation:
                    "The first-order characterization of convexity states that the function must lie above its tangent hyperplane at every point: L(y) ≥ L(x) + ∇L(x)ᵀ(y−x). This is both necessary and sufficient for differentiable functions. Geometrically, it means any linear approximation underestimates the true function value.",
                },
                {
                  id: "found-opt-q2",
                  question:
                    "Why does momentum help gradient descent converge faster in ill-conditioned problems?",
                  options: [
                    { id: "found-opt-q2-a", text: "It computes the exact Hessian" },
                    { id: "found-opt-q2-b", text: "It accumulates velocity in consistent directions and dampens oscillations in high-curvature directions" },
                    { id: "found-opt-q2-c", text: "It sets the learning rate to zero" },
                    { id: "found-opt-q2-d", text: "It guarantees convergence in one step" },
                  ],
                  correctOptionId: "found-opt-q2-b",
                  explanation:
                    "Momentum maintains an exponential moving average of past gradients. In directions where the gradient consistently points the same way (toward the optimum), velocity builds up, accelerating progress. In directions with oscillating gradients (perpendicular to the optimum), positive and negative components cancel, reducing oscillation. This is especially helpful for ill-conditioned problems (high κ) where gradient descent zigzags.",
                },
                {
                  id: "found-opt-q3",
                  question:
                    "Given A = [[4, 0], [0, 2]], what is the largest learning rate α for which gradient descent on L(θ) = (1/2)θᵀAθ − bᵀθ will converge?",
                  options: [
                    { id: "found-opt-q3-a", text: "α < 0.25" },
                    { id: "found-opt-q3-b", text: "α < 0.5" },
                    { id: "found-opt-q3-c", text: "α < 1.0" },
                    { id: "found-opt-q3-d", text: "α < 2.0" },
                  ],
                  correctOptionId: "found-opt-q3-b",
                  explanation:
                    "For a quadratic loss with Hessian A, convergence requires α < 2/λ_max where λ_max is the largest eigenvalue of A. Here, eigenvalues are 4 and 2, so λ_max=4. Thus α < 2/4 = 0.5. The optimal α is 2/(λ_min+λ_max) = 2/(2+4) = 1/3 ≈ 0.333, but any α < 0.5 will converge.",
                },
                {
                  id: "found-opt-q4",
                  question:
                    "Starting from θ = [0, 0], perform one Newton step to minimize L(θ) = θ₁² + 2θ₂² − 6θ₁ + 4θ₂. What is the new θ?",
                  options: [
                    { id: "found-opt-q4-a", text: "[3, -1]" },
                    { id: "found-opt-q4-b", text: "[0, 0]" },
                    { id: "found-opt-q4-c", text: "[1.5, -0.5]" },
                    { id: "found-opt-q4-d", text: "[6, -2]" },
                  ],
                  correctOptionId: "found-opt-q4-a",
                  explanation:
                    "∇L = [2θ₁−6, 4θ₂+4], at θ=[0,0]: g = [−6, 4]. ∇²L = [[2, 0], [0, 4]] (constant Hessian). Newton step: δ = −H⁻¹g = −[[1/2, 0], [0, 1/4]][−6, 4] = −[−3, 1] = [3, −1]. New θ = [0,0] + [3,−1] = [3,−1]. For a quadratic, Newton's method reaches the optimum in one step.",
                },
                {
                  id: "found-opt-q5",
                  question:
                    "When should you prefer Adam over vanilla SGD for training a neural network?",
                  options: [
                    { id: "found-opt-q5-a", text: "When the loss is convex" },
                    { id: "found-opt-q5-b", text: "When different parameters have vastly different gradient scales and you want adaptive per-parameter learning rates" },
                    { id: "found-opt-q5-c", text: "When you have a small dataset" },
                    { id: "found-opt-q5-d", text: "When you want guaranteed global convergence" },
                  ],
                  correctOptionId: "found-opt-q5-b",
                  explanation:
                    "Adam adaptively scales the learning rate for each parameter based on the second moment (RMSProp component). In neural networks, different layers often have gradients that differ by orders of magnitude — early layers might have tiny gradients while output layers have large ones. Adam automatically adjusts, giving smaller effective learning rates to parameters with large typical gradients and larger rates to those with small gradients. This often leads to faster convergence and better final performance without manual tuning.",
                },
                {
                  id: "found-opt-q6",
                  question:
                    "Your loss curve oscillates wildly but the average trend is decreasing. What is the most likely cause?",
                  options: [
                    { id: "found-opt-q6-a", text: "The learning rate is too small" },
                    { id: "found-opt-q6-b", text: "The learning rate is too large or the mini-batch size is too small (high gradient variance)" },
                    { id: "found-opt-q6-c", text: "The loss function is convex" },
                    { id: "found-opt-q6-d", text: "The optimizer has converged" },
                  ],
                  correctOptionId: "found-opt-q6-b",
                  explanation:
                    "Wild oscillations with decreasing trend indicate high variance in the gradient estimates. This happens when (1) the learning rate is too large, causing overshooting, or (2) the mini-batch size is very small, making the stochastic gradient a poor approximation of the true gradient. Increasing batch size or decreasing learning rate (or both) will smooth the curve. Some oscillation is normal and even beneficial (helps escape local minima), but excessive oscillation wastes iterations.",
                },
                {
                  id: "found-opt-q7",
                  question:
                    "What would happen to the Adam optimizer if you set β₂ = 0 (no second moment)?",
                  options: [
                    { id: "found-opt-q7-a", text: "Adam becomes identical to SGD with momentum" },
                    { id: "found-opt-q7-b", text: "Adam cannot run (division by zero)" },
                    { id: "found-opt-q7-c", text: "Adam becomes Newton's method" },
                    { id: "found-opt-q7-d", text: "Adam becomes full-batch gradient descent" },
                  ],
                  correctOptionId: "found-opt-q7-a",
                  explanation:
                    "If β₂=0, then vₜ = 0·vₜ₋₁ + 1·gₜ² = gₜ², so v̂ₜ ≈ gₜ² (ignoring bias correction). The Adam update becomes θ ← θ − α·m̂ₜ/√(gₜ²+ε) ≈ θ − α·m̂ₜ/|gₜ| (approximately). Since m̂ₜ is the bias-corrected momentum term, this becomes similar to SGD with momentum, though the division by |gₜ| adds some per-parameter scaling. The key point is that with β₂=0, Adam loses its RMSProp component (the running average of squared gradients), which is what enables adaptive learning rates across parameters.",
                },
              ],
            },
            {
              type: "practice",
              title: "Implement All Optimizers on Different Loss Landscapes",
              description:
                "Write a Python script that implements GD, SGD, Momentum, RMSProp, Adam, and Newton's method from scratch. Test them on: (1) a simple convex quadratic, (2) the Rosenbrock function (non-convex), and (3) a 10D ill-conditioned quadratic with condition number κ=100. For each, plot the loss curves and final convergence. Compare the number of iterations to reach L(θ) − L(θ*) < 0.001. Observe which optimizers excel on which landscapes.",
            },
            {
              type: "practice",
              title: "Observe Optimizer Convergence in the Dashboard",
              description:
                "Open the ML dashboard's model training panel. Train a neural network using SGD, then Adam. Observe the real-time loss curves. Notice how Adam typically converges faster and with less oscillation. Experiment with learning rate schedules (constant, step decay, cosine annealing) and observe their effect on final performance. Document which optimizer + schedule combination achieves the lowest validation loss for your forex prediction task.",
            },
          ],
        },
        {
          id: "found-dimensionality",
          title: "Dimensionality Reduction: The Curse, PCA, t-SNE & UMAP",
          description:
            "Master the mathematical foundations of dimensionality reduction: prove distance concentration, derive PCA via eigendecomposition, select components with scree plots and Kaiser criterion, understand t-SNE's perplexity parameter, and compare with UMAP for modern high-dimensional visualization.",
          estimatedMinutes: 90,
          difficulty: "beginner",
          prerequisites: ["found-linear-algebra"],
          sections: [
            {
              type: "objective",
              content:
                "After this lesson you will prove the curse of dimensionality via distance concentration, derive PCA via constrained optimization and eigendecomposition of the covariance matrix, compute variance explained ratios and apply the Kaiser criterion, interpret scree plots and loadings matrices, understand t-SNE's algorithm and perplexity parameter, evaluate UMAP as a modern alternative with better global structure preservation, and choose the appropriate technique (PCA vs t-SNE vs UMAP) based on task requirements.",
              keyTakeaways: [
                "Curse of dimensionality: volume of unit hypersphere → 0 as p → ∞; distances concentrate (E[d] ∝ √p, Var[d]/E[d]² → 0) making KNN and RBF kernels fail",
                "PCA optimization: maximize w₁ᵀΣw₁ subject to ‖w₁‖=1 via Lagrange multipliers → Σw₁ = λ₁w₁ (eigenvalue problem); variance explained = λ₁",
                "Variance explained ratio: λₖ/Σλᵢ; cumulative variance ≥ 95% threshold; total variance = tr(Σ) = Σλᵢ",
                "Scree plot: eigenvalues vs component number; elbow = point where marginal gain drops; Kaiser criterion: keep λ > 1 for standardized data",
                "t-SNE algorithm: compute Gaussian affinities pᵢⱼ with perplexity-driven bandwidth, use Student-t affinities qᵢⱼ in low-dim, minimize KL(P‖Q); perplexity ≈ effective neighbors (5-50)",
                "UMAP: uses simplicial complexes and fuzzy topology; faster (O(n log n)), preserves more global structure, supports transform for new data",
                "PCA for feature reduction in models (linear, parametric, global); t-SNE for visualization only (nonlinear, non-parametric, local); UMAP for best of both",
                "Loadings matrix: eigenvector entries scaled by √λ; interpret which original features contribute most to each PC; reconstruction error = Σᵢ₌ₖ₊₁ᵖ λᵢ",
              ],
            },
            {
              type: "theory",
              title: "The Curse of Dimensionality: Mathematical Analysis",
              content:
                "The **curse of dimensionality** is the counterintuitive phenomenon that as feature count p increases, the geometry of high-dimensional space becomes fundamentally different from our low-dimensional intuition, causing distance-based algorithms to fail. Consider the volume of a unit hypersphere in p dimensions: V_p = π^(p/2) / Γ(p/2 + 1). As p → ∞, V_p → 0 exponentially fast. For p=2, V₂ = π ≈ 3.14; for p=10, V₁₀ ≈ 2.55; for p=100, V₁₀₀ ≈ 10⁻⁴⁰. Simultaneously, the volume of the unit hypercube is always 1, so the sphere occupies an exponentially shrinking fraction of the cube — almost all the cube's volume concentrates in the corners.\n\n**Distance concentration** is the mathematical proof that dooms KNN and RBF kernels. For n points uniformly distributed in [0,1]ᵖ, the expected Euclidean distance between two random points is E[d] ≈ √(p/6). The variance is Var[d] ≈ p/18. The coefficient of variation is √(Var[d])/E[d] = √(p/18) / √(p/6) = √(1/3) / √1 ≈ 0.577 for fixed p, but critically, Var[d] / E[d]² = (p/18) / (p/6) = 1/3, which is constant. However, the relative range (max(d) − min(d)) / E[d] → 0 as p → ∞, meaning all pairwise distances become nearly identical. When all neighbors are equidistant, KNN degenerates to random guessing, and RBF kernels exp(−γ‖xᵢ − xⱼ‖²) become uniformly flat.\n\n**Exponential sample requirement**: To maintain a fixed density in p dimensions with k bins per feature, we need n ∝ kᵖ samples. Example: p=20 features, k=10 bins each → need 10²⁰ = 10,000,000,000,000,000,000,000 samples, which exceeds all data ever collected in financial markets. The **Hughes phenomenon** (peaking phenomenon) states that classification accuracy initially improves as features are added, then peaks, then **degrades** as p grows beyond a threshold because the curse dominates. For forex feature sets with 50 technical indicators, most are redundant (RSI, Stochastic, CCI all measure mean reversion), so dimensionality reduction is essential.",
            },
            {
              type: "theory",
              title: "PCA via Eigendecomposition: Complete Derivation",
              content:
                "**PCA** finds orthogonal directions of maximum variance via eigendecomposition of the covariance matrix. Given centered data X ∈ ℝⁿˣᵖ (each column has mean zero), the sample covariance matrix is Σ = (1/(n−1)) XᵀX ∈ ℝᵖˣᵖ. We seek a unit vector w₁ that maximizes the variance of the projected data Xw₁. Variance is Var(Xw₁) = (1/(n−1)) ‖Xw₁‖² = (1/(n−1)) w₁ᵀXᵀXw₁ = w₁ᵀΣw₁. The constrained optimization problem is: maximize w₁ᵀΣw₁ subject to ‖w₁‖² = w₁ᵀw₁ = 1. Using the Lagrange multiplier λ, the Lagrangian is L(w₁, λ) = w₁ᵀΣw₁ − λ(w₁ᵀw₁ − 1). Taking the derivative with respect to w₁ and setting to zero: ∂L/∂w₁ = 2Σw₁ − 2λw₁ = 0 → **Σw₁ = λw₁**. This is the eigenvalue equation: w₁ is an eigenvector of Σ, and λ is the corresponding eigenvalue. Substituting back: Var(Xw₁) = w₁ᵀΣw₁ = w₁ᵀ(λw₁) = λw₁ᵀw₁ = λ. Therefore, **the variance captured by w₁ equals the eigenvalue λ**, and to maximize variance, we choose w₁ to be the eigenvector with the largest eigenvalue λ₁.\n\nFor the second principal component w₂, we maximize w₂ᵀΣw₂ subject to ‖w₂‖=1 **and** w₂ᵀw₁=0 (orthogonality). The Lagrangian is L(w₂, λ, μ) = w₂ᵀΣw₂ − λ(w₂ᵀw₂ − 1) − μw₂ᵀw₁. Taking derivatives: ∂L/∂w₂ = 2Σw₂ − 2λw₂ − μw₁ = 0. Multiplying by w₁ᵀ: 2w₁ᵀΣw₂ − 2λw₁ᵀw₂ − μw₁ᵀw₁ = 0. Since w₁ᵀw₂=0 and w₁ᵀw₁=1, we have 2w₁ᵀΣw₂ − μ = 0. But w₁ᵀΣw₂ = (Σw₁)ᵀw₂ = (λ₁w₁)ᵀw₂ = λ₁w₁ᵀw₂ = 0, so μ=0. Thus Σw₂ = λw₂, and w₂ is the eigenvector with the second-largest eigenvalue λ₂. Continuing this process yields all p principal components.\n\n**Variance explained ratio**: The fraction of total variance captured by the k-th component is λₖ / Σᵢ₌₁ᵖ λᵢ. The cumulative variance for the first k components is (Σᵢ₌₁ᵏ λᵢ) / (Σᵢ₌₁ᵖ λᵢ). The total variance is tr(Σ) = Σᵢ₌₁ᵖ λᵢ (trace equals sum of eigenvalues). **Component selection criteria**: (1) Cumulative variance ≥ 95% (retain enough components to explain 95% of variability), (2) **Kaiser criterion**: keep components with λᵢ > 1 when data is standardized (because each standardized feature has variance 1, so λᵢ>1 means the component explains more than a single original feature), (3) **Scree plot elbow**: plot λᵢ vs i and look for the elbow where eigenvalues drop sharply — components after the elbow add little information. **Numerical example**: Given Σ = [[3.0, 0.8, 0.2], [0.8, 2.0, 0.4], [0.2, 0.4, 1.5]], eigenvalues are λ₁≈3.47, λ₂≈1.95, λ₃≈1.08. Total variance = 3+2+1.5 = 6.5. Variance explained: PC1 = 3.47/6.5 ≈ 53.4%, PC2 = 1.95/6.5 ≈ 30.0%, PC3 = 1.08/6.5 ≈ 16.6%. Cumulative: PC1+PC2 ≈ 83.4%. Kaiser criterion: all three eigenvalues > 1, so keep all three (if standardized).",
            },
            {
              type: "theory",
              title: "Scree Plots, Loadings & Interpretation",
              content:
                "A **scree plot** graphs eigenvalues λᵢ on the y-axis against component index i on the x-axis. The term scree refers to debris on a mountainside — the plot resembles a steep cliff followed by rubble. The **elbow** is the point where the curve transitions from steep descent to gradual decline, indicating where additional components yield diminishing returns. The elbow heuristic is subjective but often aligns with the 90-95% cumulative variance threshold. For example, if λ = [5.2, 2.8, 1.4, 0.9, 0.4, 0.2, 0.1], the elbow occurs around component 3-4 (λ drops from 2.8 to 1.4 to 0.9), suggesting k=3 or k=4.\n\nThe **loadings matrix** L ∈ ℝᵖˣᵏ contains the coefficients of each principal component as a linear combination of the original features. Each PC is PCⱼ = Σᵢ₌₁ᵖ Lᵢⱼ · (feature i). The loading Lᵢⱼ = vᵢⱼ · √λⱼ, where vᵢⱼ is the i-th entry of the j-th eigenvector. Large absolute loadings indicate which original features dominate that PC. For instance, if PC1 has large loadings on RSI, Stochastic, and CCI, it represents a mean-reversion factor; if PC2 has large loadings on ATR and Bollinger Band Width, it represents volatility. **Biplot visualization** overlays both data points (projected onto first 2 PCs) and loading vectors (arrows showing original features' directions) in a single plot, revealing relationships between observations and features.\n\n**Reconstruction error**: If we keep only the first k components and project back to the original p-dimensional space, the reconstruction is X̂ = XW_kW_k^T, where W_k ∈ ℝᵖˣᵏ contains the first k eigenvectors. The mean squared reconstruction error is ‖X − X̂‖² / n = Σᵢ₌ₖ₊₁ᵖ λᵢ (sum of discarded eigenvalues). Choosing k via **cross-validation**: use PCA as a preprocessing step in a pipeline, vary k, and select the k that minimizes validation loss on a downstream task (e.g., classification accuracy). This approach is more principled than arbitrary variance thresholds because it directly optimizes for predictive performance.",
            },
            {
              type: "theory",
              title: "t-SNE & UMAP: Non-Linear Dimensionality Reduction",
              content:
                "**t-SNE** (t-distributed Stochastic Neighbor Embedding) is a non-linear technique for visualizing high-dimensional data in 2D or 3D by preserving local neighborhoods. The algorithm has four steps: (1) **Compute high-dimensional affinities**: For each pair of points (xᵢ, xⱼ), define a conditional probability pⱼ|ᵢ = exp(−‖xᵢ − xⱼ‖² / (2σᵢ²)) / Σₖ≠ᵢ exp(−‖xᵢ − xₖ‖² / (2σᵢ²)), representing the probability that xᵢ would pick xⱼ as a neighbor under a Gaussian distribution. The bandwidth σᵢ is chosen such that the **perplexity** Perp(Pᵢ) = 2^(H(Pᵢ)) equals a user-specified value, where H(Pᵢ) = −Σⱼ pⱼ|ᵢ log₂ pⱼ|ᵢ is the Shannon entropy. Perplexity is interpreted as the **effective number of neighbors** — typical values are 5-50; larger perplexity → considers more global structure, smaller → focuses on local clusters. Symmetrize: pᵢⱼ = (pⱼ|ᵢ + pᵢ|ⱼ) / (2n). (2) **Initialize low-dimensional embedding**: Randomly place points yᵢ ∈ ℝ² or ℝ³. (3) **Compute low-dimensional affinities**: qᵢⱼ = (1 + ‖yᵢ − yⱼ‖²)⁻¹ / Σₖ≠ₗ (1 + ‖yₖ − yₗ‖²)⁻¹. The Student-t distribution (with 1 degree of freedom, i.e., Cauchy) is used instead of Gaussian to combat the **crowding problem**: in 2D, there isn't enough space to faithfully represent all high-dimensional distances, so heavy tails allow moderately distant points to be placed farther apart. (4) **Minimize KL divergence**: KL(P‖Q) = Σᵢ Σⱼ pᵢⱼ log(pᵢⱼ / qᵢⱼ) via gradient descent. The gradient is ∂KL/∂yᵢ = 4 Σⱼ (pᵢⱼ − qᵢⱼ)(yᵢ − yⱼ)(1 + ‖yᵢ − yⱼ‖²)⁻¹. **Properties**: t-SNE preserves local structure (nearby points stay nearby) but distorts global structure (distances between clusters are meaningless). It is **stochastic** (different random seeds → different embeddings) and **non-parametric** (no learned transform for new data — must re-run entire algorithm). Complexity is O(n²) naively, reduced to O(n log n) with Barnes-Hut approximation.\n\n**UMAP** (Uniform Manifold Approximation and Projection) is a modern alternative based on **Riemannian geometry** and **algebraic topology**. It models the data manifold as a simplicial complex (a generalization of graphs with higher-dimensional simplices) and uses **fuzzy set theory** to represent membership probabilities. UMAP constructs a high-dimensional fuzzy topological representation and a low-dimensional one, then optimizes the cross-entropy between them. **Advantages over t-SNE**: (1) **Faster**: O(n log n) complexity even without approximations. (2) **Preserves more global structure**: distances between well-separated clusters are more meaningful. (3) **Parametric variant**: can learn a neural network mapping from high-dim to low-dim, enabling transformation of new data. (4) **Scalable**: handles millions of points. **Disadvantages**: more hyperparameters (n_neighbors, min_dist), less interpretable math (t-SNE's KL divergence is intuitive).\n\n**Comparison table**: (1) **PCA**: Linear, parametric (learned eigenvectors), preserves global structure (distances and angles), fast O(min(n²p, np²)), suitable for feature reduction in models. (2) **t-SNE**: Nonlinear, non-parametric, preserves local neighborhoods only, slow O(n² or n log n), stochastic (different runs differ), **visualization only**. (3) **UMAP**: Nonlinear, parametric variant available, preserves local + some global structure, fast O(n log n), semi-stochastic (more stable than t-SNE), good for both visualization and feature reduction (with parametric version). **When to use**: PCA for linear relationships, interpretability, and model input; t-SNE for visualizing tight clusters when global layout doesn't matter; UMAP when you need both local detail and global structure, or when speed is critical.",
            },
            {
              type: "intuition",
              title: "The Map Projection Analogy",
              analogy:
                "Flattening the Earth (3D sphere) onto a 2D map always involves distortion — Mercator, globe peeling, or smart algorithms choose what to preserve.",
              content:
                "Imagine you have a globe (3D sphere representing the Earth) and need to create a flat map (2D). No 2D map can perfectly represent the 3D surface — every projection sacrifices something. **PCA** is like the Mercator projection: it preserves directions (angles, straight lines) and is deterministic, but it distorts areas, especially near the poles. If you measure distances on a Mercator map, polar regions appear huge. PCA preserves global relationships (e.g., North America is west of Europe) but assumes the world is flat (linearity). **t-SNE** is like physically peeling the globe: you tear the surface into strips to lay them flat, keeping neighborhoods intact (Florida stays next to Cuba) but destroying global distances (California and Florida might appear on opposite edges of the map). Different peeling strategies give different maps — that's the stochasticity of t-SNE. **UMAP** is like a smarter peeling algorithm that tries to minimize tearing by stretching the material intelligently, preserving both local neighborhoods (cities stay close) and some global shape (continents roughly in the right positions). The key insight: **no 2D map is perfect** — the curse of dimensionality means information is **lost** when you reduce dimensions. Choose your projection based on what you care about: global relationships (PCA), tight clusters (t-SNE), or a balanced compromise (UMAP). 🌍",
              emoji: "🌍",
            },
            {
              type: "intuition",
              title: "The Photography Analogy",
              analogy:
                "Compressing a 20-megapixel photo to a thumbnail: JPEG (PCA), artist's sketch (t-SNE), or smart thumbnail (UMAP).",
              content:
                "You have a 20-megapixel photograph (high-dimensional data) and need to compress it to a thumbnail for quick viewing (low-dimensional representation). **PCA** is like JPEG compression: it identifies the dominant patterns (low-frequency components — the overall shapes and colors) and discards fine details (high-frequency noise). JPEG is deterministic, fast, and preserves the overall layout, but if you zoom in, you see blocky artifacts. Similarly, PCA finds the 5 principal directions (e.g., the average background color, the main subject's silhouette) that capture 95% of the variance, losing subtle details like individual hairs. **t-SNE** is like asking an artist to sketch the photo: the artist focuses on the most interesting parts (clusters of people, distinctive objects) and exaggerates them for clarity, but changes proportions and relative positions. Two sketches by the same artist might look different (stochasticity), and you can't tell the artist now sketch this new photo without starting over (non-parametric). The sketch is great for seeing what's in the photo but useless for measuring distances. **UMAP** is like a smart thumbnail algorithm (like modern AI-based compression): it preserves both the overall composition (global structure) and the important details (local clusters), runs faster than manual sketching, and can be applied to new photos without retraining. **Choosing resolution**: Keeping k=5 PCA components is like saving a 5% thumbnail — you lose detail but keep the gist. Keeping k=15 is like a 50% thumbnail — most information is intact. The **scree plot elbow** tells you the point of diminishing returns, like asking: at what resolution does the thumbnail stop improving? 📸",
              emoji: "📸",
            },
            {
              type: "code",
              title: "PCA from Scratch: Eigendecomposition of Covariance Matrix",
              language: "python",
              code: `import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# Generate synthetic 20-feature forex indicator matrix
np.random.seed(42)
n = 1000
# Create correlated features (simulating redundant indicators)
base_features = np.random.randn(n, 5)
noise = np.random.randn(n, 20) * 0.3
X_raw = np.hstack([
    base_features,
    base_features[:, [0, 1, 2]] + noise[:, :3],  # correlated with first 3
    base_features[:, [3, 4]] + noise[:, 3:5],     # correlated with last 2
    noise[:, 5:],                                  # pure noise
])
feature_names = [f"Indicator_{i+1}" for i in range(20)]

# Step 1: Center the data (mean = 0)
X_centered = X_raw - X_raw.mean(axis=0)

# Step 2: Standardize (important for PCA when features have different scales)
X_std = (X_raw - X_raw.mean(axis=0)) / X_raw.std(axis=0, ddof=1)

# Step 3: Compute covariance matrix (using standardized data)
Sigma = np.cov(X_std, rowvar=False)  # shape: (20, 20)
print(f"Covariance matrix shape: {Sigma.shape}")
print(f"Covariance matrix (top-left 3×3):\\n{Sigma[:3, :3]}")

# Step 4: Eigendecomposition
eigenvalues, eigenvectors = np.linalg.eigh(Sigma)  # eigh for symmetric matrices

# Step 5: Sort by eigenvalue (descending)
idx = eigenvalues.argsort()[::-1]
eigenvalues = eigenvalues[idx]
eigenvectors = eigenvectors[:, idx]

print(f"\\nEigenvalues (sorted): {eigenvalues}")
print(f"Sum of eigenvalues (total variance): {eigenvalues.sum():.2f}")
print(f"Trace of Sigma: {np.trace(Sigma):.2f}")  # Should match

# Step 6: Compute variance explained
var_explained = eigenvalues / eigenvalues.sum()
cumvar = np.cumsum(var_explained)

print(f"\\nVariance explained by each PC: {var_explained}")
print(f"Cumulative variance: {cumvar}")

# Step 7: Project data onto top-k PCs
k = 5
W_k = eigenvectors[:, :k]  # shape: (20, 5)
X_pca_manual = X_std @ W_k  # shape: (1000, 5)

print(f"\\nProjected data shape: {X_pca_manual.shape}")

# Compare with sklearn
from sklearn.decomposition import PCA
pca_sklearn = PCA(n_components=k)
X_pca_sklearn = pca_sklearn.fit_transform(X_std)

print(f"\\nManual PCA PC1 mean: {X_pca_manual[:, 0].mean():.6f}")
print(f"Sklearn PCA PC1 mean: {X_pca_sklearn[:, 0].mean():.6f}")
print(f"Difference (should be near zero): {np.abs(X_pca_manual - X_pca_sklearn).max():.6f}")

# Step 8: Analyze loadings for first 3 PCs
print(f"\\n--- Loadings Analysis (Which features contribute to each PC?) ---")
for i in range(3):
    loadings = eigenvectors[:, i] * np.sqrt(eigenvalues[i])
    top_idx = np.argsort(np.abs(loadings))[::-1][:5]
    print(f"\\nPC{i+1} (explains {var_explained[i]*100:.1f}% variance):")
    for idx in top_idx:
        print(f"  {feature_names[idx]}: {loadings[idx]:+.3f}")`,
              explanation:
                "We implement PCA from scratch by computing the covariance matrix of standardized features and performing eigendecomposition. The eigenvalues represent variance along each principal direction, and their sum equals the total variance (trace of Σ). We sort eigenvalues in descending order and project the data onto the top-k eigenvectors. The loadings analysis reveals which original features contribute most to each PC — for correlated indicators, we expect the first few PCs to have large loadings on related features (e.g., all momentum indicators). We verify our manual implementation matches sklearn's PCA. This 50-line example demonstrates the complete mathematical pipeline from raw features to dimensionality-reduced representation.",
            },
            {
              type: "code",
              title: "Scree Plot, Kaiser Criterion & Component Selection",
              language: "python",
              code: `import numpy as np
import matplotlib.pyplot as plt
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

# Use the same 20-feature data from previous example
np.random.seed(42)
n = 1000
base_features = np.random.randn(n, 5)
noise = np.random.randn(n, 20) * 0.3
X_raw = np.hstack([
    base_features,
    base_features[:, [0, 1, 2]] + noise[:, :3],
    base_features[:, [3, 4]] + noise[:, 3:5],
    noise[:, 5:],
])

# Standardize
scaler = StandardScaler()
X_std = scaler.fit_transform(X_raw)

# Fit PCA with all components
pca = PCA()
pca.fit(X_std)

eigenvalues = pca.explained_variance_
var_explained = pca.explained_variance_ratio_
cumvar = np.cumsum(var_explained)

# Selection method 1: Cumulative variance threshold
k_95 = np.argmax(cumvar >= 0.95) + 1
k_90 = np.argmax(cumvar >= 0.90) + 1

# Selection method 2: Kaiser criterion (eigenvalue > 1 for standardized data)
k_kaiser = np.sum(eigenvalues > 1)

# Selection method 3: Broken-stick model (random baseline)
p = len(eigenvalues)
broken_stick = np.array([1/p * np.sum(1/np.arange(i, p+1)) for i in range(1, p+1)])
k_broken_stick = np.sum(var_explained > broken_stick)

print(f"--- Component Selection Methods ---")
print(f"90% variance threshold: k = {k_90} (explains {cumvar[k_90-1]*100:.1f}%)")
print(f"95% variance threshold: k = {k_95} (explains {cumvar[k_95-1]*100:.1f}%)")
print(f"Kaiser criterion (λ > 1): k = {k_kaiser}")
print(f"Broken-stick model: k = {k_broken_stick}")

# Plot scree plot
fig, axes = plt.subplots(1, 3, figsize=(18, 5))

# Subplot 1: Scree plot with eigenvalues
axes[0].bar(range(1, p+1), eigenvalues, color='steelblue', alpha=0.7)
axes[0].axhline(y=1, color='red', linestyle='--', linewidth=2, label='Kaiser threshold (λ=1)')
axes[0].set_xlabel('Component Number', fontsize=12)
axes[0].set_ylabel('Eigenvalue (λ)', fontsize=12)
axes[0].set_title('Scree Plot: Eigenvalues', fontsize=14, weight='bold')
axes[0].legend()
axes[0].grid(alpha=0.3)

# Subplot 2: Cumulative variance
axes[1].plot(range(1, p+1), cumvar, 'o-', color='darkorange', linewidth=2, markersize=6)
axes[1].axhline(y=0.90, color='green', linestyle='--', label='90% threshold')
axes[1].axhline(y=0.95, color='red', linestyle='--', label='95% threshold')
axes[1].axvline(x=k_95, color='red', linestyle=':', alpha=0.5)
axes[1].set_xlabel('Number of Components', fontsize=12)
axes[1].set_ylabel('Cumulative Variance Explained', fontsize=12)
axes[1].set_title('Cumulative Variance', fontsize=14, weight='bold')
axes[1].legend()
axes[1].grid(alpha=0.3)

# Subplot 3: Reconstruction error
reconstruction_errors = [np.sum(eigenvalues[k:]) for k in range(p)]
axes[2].plot(range(1, p+1), reconstruction_errors, 's-', color='purple', linewidth=2, markersize=6)
axes[2].set_xlabel('Number of Components Kept', fontsize=12)
axes[2].set_ylabel('Reconstruction Error (Σλᵢ for i>k)', fontsize=12)
axes[2].set_title('Reconstruction Error vs k', fontsize=14, weight='bold')
axes[2].grid(alpha=0.3)

plt.tight_layout()
plt.savefig('component_selection_analysis.png', dpi=150)
print(f"\\nPlot saved as component_selection_analysis.png")`,
              explanation:
                "This code compares three component selection methods: (1) Cumulative variance threshold (90% or 95% — a common heuristic for retaining most information), (2) Kaiser criterion (keep components with eigenvalue > 1 when data is standardized, meaning the component explains more variance than a single original feature), and (3) Broken-stick model (a statistical baseline where eigenvalues are compared to a random distribution). We plot the scree plot (eigenvalues vs component number) to visually identify the 'elbow' — the point where the curve flattens. The cumulative variance plot shows how much total variance is captured as we add components. The reconstruction error plot (sum of discarded eigenvalues) quantifies information loss. For this synthetic data with 5 underlying factors and 15 noise dimensions, we expect k ≈ 5 to be optimal. The comparison table helps you choose k based on your tolerance for information loss vs dimensionality reduction.",
            },
            {
              type: "code",
              title: "t-SNE and UMAP Visualization with Perplexity Sensitivity",
              language: "python",
              code: `import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.preprocessing import StandardScaler
from sklearn.manifold import TSNE
import umap
import time

# Generate synthetic forex data with 3 distinct regimes
np.random.seed(42)
n_samples = 1500
n_features = 20

# Regime 1: Low volatility (tight cluster)
regime1 = np.random.randn(n_samples // 3, n_features) * 0.5 + np.array([2, 1] + [0]*(n_features-2))

# Regime 2: High volatility (spread out cluster)
regime2 = np.random.randn(n_samples // 3, n_features) * 2.0 + np.array([-2, -1] + [0]*(n_features-2))

# Regime 3: Trending (elongated cluster)
regime3_base = np.random.randn(n_samples // 3, 2)
regime3_stretched = regime3_base @ np.array([[3, 0], [0, 0.5]])
regime3 = np.hstack([regime3_stretched, np.random.randn(n_samples // 3, n_features-2) * 0.3])

X = np.vstack([regime1, regime2, regime3])
labels = np.array([0]*(n_samples//3) + [1]*(n_samples//3) + [2]*(n_samples//3))
regime_names = ['Low Vol', 'High Vol', 'Trending']

# Standardize
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# t-SNE with different perplexity values
perplexities = [5, 30, 100]
tsne_results = {}

print("--- Running t-SNE with different perplexities ---")
for perp in perplexities:
    start_time = time.time()
    tsne = TSNE(n_components=2, perplexity=perp, random_state=42, n_iter=1000)
    tsne_results[perp] = tsne.fit_transform(X_scaled)
    elapsed = time.time() - start_time
    print(f"Perplexity={perp}: {elapsed:.2f} seconds")

# UMAP for comparison
print("\\n--- Running UMAP ---")
start_time = time.time()
umap_model = umap.UMAP(n_components=2, n_neighbors=30, min_dist=0.1, random_state=42)
X_umap = umap_model.fit_transform(X_scaled)
umap_time = time.time() - start_time
print(f"UMAP: {umap_time:.2f} seconds")

# Visualization
fig, axes = plt.subplots(2, 2, figsize=(14, 12))
colors = ['blue', 'red', 'green']

# t-SNE subplots
for i, perp in enumerate(perplexities):
    row, col = divmod(i, 2)
    ax = axes[row, col]
    for label_idx, regime_name in enumerate(regime_names):
        mask = labels == label_idx
        ax.scatter(tsne_results[perp][mask, 0], tsne_results[perp][mask, 1],
                   c=colors[label_idx], label=regime_name, s=20, alpha=0.6)
    ax.set_title(f't-SNE (perplexity={perp})', fontsize=13, weight='bold')
    ax.set_xlabel('t-SNE Dimension 1')
    ax.set_ylabel('t-SNE Dimension 2')
    ax.legend()
    ax.grid(alpha=0.3)

# UMAP subplot
ax = axes[1, 1]
for label_idx, regime_name in enumerate(regime_names):
    mask = labels == label_idx
    ax.scatter(X_umap[mask, 0], X_umap[mask, 1],
               c=colors[label_idx], label=regime_name, s=20, alpha=0.6)
ax.set_title(f'UMAP (n_neighbors=30)', fontsize=13, weight='bold')
ax.set_xlabel('UMAP Dimension 1')
ax.set_ylabel('UMAP Dimension 2')
ax.legend()
ax.grid(alpha=0.3)

plt.tight_layout()
plt.savefig('tsne_umap_comparison.png', dpi=150)
print(f"\\nPlot saved as tsne_umap_comparison.png")

print(f"\\n--- Interpretation ---")
print(f"Perplexity=5: Focuses on very local structure (5-10 neighbors). May fragment clusters.")
print(f"Perplexity=30: Balanced view (typical default). Good for most datasets.")
print(f"Perplexity=100: Emphasizes global structure. May merge distinct clusters.")
print(f"UMAP: Faster than t-SNE, preserves both local and global structure better.")
print(f"\\nFor regime detection: Look for well-separated clusters. Low Vol (tight), High Vol (spread), Trending (elongated).")`,
              explanation:
                "This code demonstrates t-SNE's sensitivity to the perplexity hyperparameter and compares it with UMAP. We create synthetic data with three distinct market regimes (low volatility, high volatility, trending) and visualize them in 2D. Perplexity controls the effective number of neighbors: low perplexity (5) focuses on very local structure and may split clusters unnecessarily; medium perplexity (30) provides a balanced view; high perplexity (100) considers more global structure but may merge distinct clusters. UMAP typically produces cleaner clusters faster and preserves distances between well-separated groups better than t-SNE. The timing comparison shows UMAP's speed advantage. For forex regime detection, well-separated clusters in the embedding space indicate distinct market states — you can train a classifier on the original 20D features using these regime labels, or use the clusters directly for regime-switching strategies. This visualization is diagnostic only; never use t-SNE/UMAP embeddings as input features for models (except with parametric UMAP).",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "found-dim-q1",
                  question:
                    "As dimensionality p → ∞ for uniformly distributed points in a unit hypercube, what happens to pairwise Euclidean distances?",
                  options: [
                    { id: "found-dim-q1-a", text: "They all approach zero" },
                    { id: "found-dim-q1-b", text: "They become uniformly distributed between 0 and √p" },
                    { id: "found-dim-q1-c", text: "They concentrate around √(p/6), making all points nearly equidistant" },
                    { id: "found-dim-q1-d", text: "They grow exponentially without bound" },
                  ],
                  correctOptionId: "found-dim-q1-c",
                  explanation:
                    "Distance concentration is the mathematical core of the curse of dimensionality. For uniform points in [0,1]ᵖ, E[d] ≈ √(p/6) grows with √p, but critically, the variance Var[d] grows slower, so the coefficient of variation (relative spread) shrinks. The ratio (max(d) − min(d)) / E[d] → 0, meaning all pairwise distances converge to the same value. This makes distance-based methods like KNN fail because there is no meaningful nearest neighbor when all neighbors are equidistant. This is why high-dimensional data requires dimensionality reduction before applying distance-based algorithms.",
                },
                {
                  id: "found-dim-q2",
                  question:
                    "Why is t-SNE unsuitable for feature reduction in predictive models (e.g., as input to a Random Forest)?",
                  options: [
                    { id: "found-dim-q2-a", text: "t-SNE is too computationally expensive" },
                    { id: "found-dim-q2-b", text: "t-SNE is non-parametric (no learned transform for new data), stochastic, and distorts global distances" },
                    { id: "found-dim-q2-c", text: "t-SNE requires labeled data to work" },
                    { id: "found-dim-q2-d", text: "t-SNE can only reduce to exactly 2 dimensions" },
                  ],
                  correctOptionId: "found-dim-q2-b",
                  explanation:
                    "t-SNE produces a fixed embedding for the training data with no learned projection matrix that can transform new test data — you would have to re-run the entire algorithm on train+test together, which leaks information. Additionally, t-SNE is stochastic (different random seeds produce different embeddings) and distorts global distances (only local neighborhoods are preserved). This makes it unsuitable for predictive modeling. Use PCA (or parametric UMAP) for feature reduction in models, and reserve t-SNE exclusively for visualization. The non-parametric nature is the primary dealbreaker — a model trained on one t-SNE embedding cannot predict on new data.",
                },
                {
                  id: "found-dim-q3",
                  question:
                    "Given eigenvalues [5.2, 2.1, 1.5, 0.8, 0.3, 0.1], how many principal components are needed to explain at least 90% of the total variance?",
                  options: [
                    { id: "found-dim-q3-a", text: "2 components" },
                    { id: "found-dim-q3-b", text: "3 components" },
                    { id: "found-dim-q3-c", text: "4 components" },
                    { id: "found-dim-q3-d", text: "5 components" },
                  ],
                  correctOptionId: "found-dim-q3-c",
                  explanation:
                    "Total variance = 5.2 + 2.1 + 1.5 + 0.8 + 0.3 + 0.1 = 10.0. Cumulative variance: PC1 = 5.2/10 = 52%, PC1+PC2 = 7.3/10 = 73%, PC1+PC2+PC3 = 8.8/10 = 88%, PC1+PC2+PC3+PC4 = 9.6/10 = 96%. We need the minimum k where cumulative variance ≥ 90%. After 3 components: 8.8/10 = 88% < 90% (not enough). After 4 components: 9.6/10 = 96% ≥ 90% (sufficient). Therefore, we need 4 components to explain at least 90% of the total variance. This demonstrates the cumulative variance threshold method for component selection.",
                },
                {
                  id: "found-dim-q4",
                  question:
                    "In t-SNE, if you set perplexity = 30, what does this approximately represent?",
                  options: [
                    { id: "found-dim-q4-a", text: "The number of iterations for gradient descent" },
                    { id: "found-dim-q4-b", text: "The effective number of nearest neighbors to preserve for each point" },
                    { id: "found-dim-q4-c", text: "The target dimensionality of the embedding" },
                    { id: "found-dim-q4-d", text: "The learning rate for the optimization" },
                  ],
                  correctOptionId: "found-dim-q4-b",
                  explanation:
                    "Perplexity in t-SNE is interpreted as the effective number of nearest neighbors considered for each point. It controls the bandwidth σᵢ of the Gaussian kernel used to compute pairwise affinities in the high-dimensional space. Perplexity is defined as 2^H, where H is the Shannon entropy of the conditional probability distribution. A perplexity of 30 means each point's neighborhood is modeled as if it has roughly 30 effective neighbors. Low perplexity (5-10) focuses on very local structure (tight clusters), while high perplexity (50-100) considers more global relationships. Typical values are 5-50; the default in most implementations is 30. Choosing perplexity is dataset-dependent — small datasets benefit from lower perplexity, large datasets from higher.",
                },
                {
                  id: "found-dim-q5",
                  question:
                    "You apply PCA to a dataset with 30 features and find that the first 8 eigenvalues are all greater than 1.0 (on standardized data), but cumulative variance reaches 95% at 5 components. According to the Kaiser criterion vs. the 95% variance rule, which is correct?",
                  options: [
                    { id: "found-dim-q5-a", text: "Kaiser says keep 8, 95% rule says keep 5 — this is a contradiction and PCA is invalid" },
                    { id: "found-dim-q5-b", text: "Both are heuristics; Kaiser is more conservative (keeps more components), 95% prioritizes parsimony. Choose based on your tolerance for information loss." },
                    { id: "found-dim-q5-c", text: "The 95% rule always overrides Kaiser criterion" },
                    { id: "found-dim-q5-d", text: "Kaiser criterion only applies when cumulative variance is below 90%" },
                  ],
                  correctOptionId: "found-dim-q5-b",
                  explanation:
                    "Component selection criteria are heuristics, not absolute rules, and they can disagree. The Kaiser criterion (keep λ > 1) is based on the logic that a component should explain more variance than a single original feature (which has variance 1 when standardized). The 95% cumulative variance rule prioritizes parsimony — keep the minimum number of components that retain most information. In this case, Kaiser is more conservative (keeps 8 components, retaining more information but higher dimensionality), while the 95% rule is more aggressive (keeps 5, accepting slightly more information loss for simpler representation). The correct choice depends on your downstream task: for interpretability or visualization, prefer fewer components (95% rule); for maximum fidelity or when feeding into a complex model, use Kaiser or even higher thresholds. Cross-validation on the downstream task is the most principled approach.",
                },
                {
                  id: "found-dim-q6",
                  question:
                    "A loadings matrix shows that PC1 has large coefficients (loadings) on features 'RSI', 'Stochastic_K', and 'CCI', while PC2 has large coefficients on 'ATR' and 'Bollinger_Width'. What does this tell you?",
                  options: [
                    { id: "found-dim-q6-a", text: "PC1 represents a 'mean-reversion/momentum' factor and PC2 represents a 'volatility' factor" },
                    { id: "found-dim-q6-b", text: "RSI, Stochastic_K, and CCI should be removed from the dataset because they are redundant" },
                    { id: "found-dim-q6-c", text: "PC1 and PC2 are correlated with each other" },
                    { id: "found-dim-q6-d", text: "The first two principal components explain less than 50% of total variance" },
                  ],
                  correctOptionId: "found-dim-q6-a",
                  explanation:
                    "Loadings reveal the interpretation of principal components as linear combinations of original features. Large loadings indicate which features contribute most to that component. In this case, PC1 is dominated by oscillators (RSI, Stochastic, CCI) — all of which measure mean-reversion or overbought/oversold conditions — so PC1 captures a 'momentum/mean-reversion' factor. PC2 is dominated by volatility indicators (ATR = Average True Range, Bollinger Band Width), so it captures a 'volatility' factor. This suggests the data has two primary modes of variation: how overbought/oversold the market is (PC1) and how volatile it is (PC2). This is valuable for interpretation and for constructing trading strategies — you can use PC1 and PC2 directly as regime indicators. The features with large loadings on PC1 are NOT redundant in the sense that they should be deleted — they are correlated, which is why PCA groups them, but correlation doesn't mean one is useless. They might differ in small but important ways (e.g., lookback period).",
                },
                {
                  id: "found-dim-q7",
                  question:
                    "What happens if you apply PCA to data that has strong non-linear relationships (e.g., quadratic or sinusoidal patterns)?",
                  options: [
                    { id: "found-dim-q7-a", text: "PCA will fail with an error because it requires linear relationships" },
                    { id: "found-dim-q7-b", text: "PCA will still run but may require many components to capture variance that could be explained by fewer non-linear dimensions; consider kernel PCA or t-SNE/UMAP instead" },
                    { id: "found-dim-q7-c", text: "PCA automatically detects non-linear patterns and adjusts accordingly" },
                    { id: "found-dim-q7-d", text: "Non-linear relationships have no effect on PCA because it only cares about variance" },
                  ],
                  correctOptionId: "found-dim-q7-b",
                  explanation:
                    "PCA is a linear dimensionality reduction technique — it finds linear combinations of features that maximize variance. If the data lies on a non-linear manifold (e.g., a parabola or sine wave in high-dimensional space), PCA will still work but will be inefficient: it may require many linear components to approximate what could be captured by a single non-linear dimension. For example, points on a circle in 2D need both x and y coordinates (2 linear PCs) to represent, but in polar coordinates, only the radius matters (1D). For strongly non-linear data, use kernel PCA (applies PCA in a high-dimensional feature space via the kernel trick), t-SNE, or UMAP (which explicitly model non-linear manifolds). In practice, many real-world datasets (including forex features) have a mix of linear and non-linear relationships, so PCA is often a good first step, followed by non-linear methods if needed. You can test this by checking reconstruction error: if PCA needs many components to reach 95% variance, the data may be non-linear.",
                },
              ],
            },
            {
              type: "practice",
              title: "PCA Feature Reduction: Original vs Reduced Feature Comparison",
              description:
                "Apply PCA to your full forex feature matrix (all available technical indicators). Analyze the loadings matrix to interpret the first 3 principal components (which indicators contribute most?). Use the scree plot and Kaiser criterion to select the optimal number of components k. Train a Random Forest classifier to predict regime labels (e.g., trending vs mean-reverting) using (1) all original features and (2) the top-k PCA components. Compare test accuracy, training time, and model interpretability. Does PCA improve performance by removing noise, or does it hurt by losing information? Report cumulative variance for the selected k and discuss the trade-off.",
              catalogModelId: "pca-feature-analysis",
            },
            {
              type: "practice",
              title: "Interactive Dimensionality Reduction Visualization",
              description:
                "Use the ML dashboard's dimensionality reduction panel to visualize your feature space using t-SNE and UMAP. Color the points by known regime labels (low volatility, high volatility, trending) obtained from clustering or manual labeling. Experiment with t-SNE's perplexity parameter (try 5, 30, 100) and observe how the embedding changes — does a lower perplexity fragment clusters? Does a higher perplexity merge distinct regimes? Compare with UMAP using n_neighbors=15 and n_neighbors=50. Which technique produces the clearest separation between regimes? Export the 2D embeddings and check if regime clusters are linearly separable — if so, you can use a simple linear classifier on the embeddings for regime detection. Document your findings: which method (PCA, t-SNE, UMAP) is best for your data, and why?",
              catalogModelId: "tsne-umap-exploration",
            },
          ],
        },
      ],
    },
  ],
};
