import type { Module } from "@/training/curriculum_types";

export const statsProbModule: Module = {
      id: "stats-prob",
      title: "Statistics & Probability",
      description:
        "Master the statistical tools used to describe, model, and reason about market return distributions.",
      lessons: [
        {
          id: "found-descriptive-stats",
          title: "Descriptive Statistics for Markets",
          description:
            "Master the complete toolkit for summarizing forex return distributions â€” from basic measures of central tendency and dispersion through higher moments (skewness, kurtosis), robust alternatives, and rolling statistics. Learn why each matters for risk management and strategy design, with full derivations and real numerical examples.",
          estimatedMinutes: 90,
          difficulty: "beginner",
          sections: [
            // â”€â”€ OBJECTIVE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "objective",
              content:
                "By the end of this lesson you will be able to: (1) derive and compute all four statistical moments from raw price data, (2) explain why log-returns are preferred over simple returns with a mathematical proof, (3) interpret skewness and kurtosis in the context of tail risk and strategy selection, (4) apply robust statistics (median, MAD, trimmed mean) when outliers distort standard measures, (5) compute rolling statistics to track regime changes in real time, (6) construct and interpret QQ-plots and histograms for normality assessment, and (7) annualize volatility correctly for different timeframes.",
              keyTakeaways: [
                "Simple returns Râ‚œ = (Pâ‚œ âˆ’ Pâ‚œâ‚‹â‚)/Pâ‚œâ‚‹â‚ are intuitive but NOT time-additive; log-returns râ‚œ = ln(Pâ‚œ/Pâ‚œâ‚‹â‚) ARE additive, making multi-period analysis tractable",
                "The mean (Î¼) of returns tells you the expected drift, but is unreliable alone â€” a single flash crash can shift Î¼ dramatically",
                "Standard deviation (Ïƒ) quantifies volatility â€” the core risk measure in finance â€” but assumes symmetric risk, which markets violate",
                "Skewness S measures asymmetry: S < 0 means left-tail losses are larger than right-tail gains (common in FX carry trades)",
                "Excess kurtosis Îº = K âˆ’ 3 > 0 signals fat tails â€” extreme moves occur 10-100Ã— more often than Gaussian models predict",
                "Robust alternatives (median, MAD, Winsorized mean) resist outlier contamination and are essential for live strategy monitoring",
                "Rolling statistics (e.g., 20-bar rolling Ïƒ) reveal volatility regimes â€” high Ïƒ periods require different position sizing than low Ïƒ periods",
                "The Jarque-Bera test formally tests normality using both skewness and kurtosis jointly",
              ],
            },

            // â”€â”€ THEORY 1: Returns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "theory",
              title: "Simple Returns vs Log-Returns: Derivation & Properties",
              content:
                "**Definition.** Given a price series Pâ‚€, Pâ‚, â€¦, Pâ‚™, the **simple (arithmetic) return** at time t is Râ‚œ = (Pâ‚œ âˆ’ Pâ‚œâ‚‹â‚) / Pâ‚œâ‚‹â‚ = Pâ‚œ/Pâ‚œâ‚‹â‚ âˆ’ 1. The **log (continuously compounded) return** is râ‚œ = ln(Pâ‚œ / Pâ‚œâ‚‹â‚) = ln(1 + Râ‚œ).\n\n**Why log-returns?** Three critical properties:\n\n1. **Time-additivity.** The k-period log-return is the sum of single-period log-returns: r(t, t+k) = ln(Pâ‚œâ‚Šâ‚–/Pâ‚œ) = ln(Pâ‚œâ‚Šâ‚–/Pâ‚œâ‚Šâ‚–â‚‹â‚) + â€¦ + ln(Pâ‚œâ‚Šâ‚/Pâ‚œ) = râ‚œâ‚Šâ‚– + â€¦ + râ‚œâ‚Šâ‚. Simple returns do NOT have this property â€” the 2-day simple return Râ‚‚â‚ = (1 + Râ‚)(1 + Râ‚‚) âˆ’ 1 â‰  Râ‚ + Râ‚‚.\n\n2. **Symmetry.** A +10% simple return followed by âˆ’10% gives a net loss: 1.10 Ã— 0.90 = 0.99 (âˆ’1%). But log-returns are symmetric: ln(1.10) = 0.0953, ln(0.90) = âˆ’0.1054 â€” the magnitudes are closer, and a +r followed by âˆ’r gives exactly zero only for log-returns in the limit.\n\n3. **Central Limit Theorem.** Because multi-period log-returns are *sums* of independent single-period log-returns, the CLT implies that long-horizon log-returns converge to normality even if short-horizon returns are non-Gaussian. This is the theoretical basis for geometric Brownian motion (GBM) in the Black-Scholes model.\n\n**Numerical example.** EUR/USD closes at 1.0850, 1.0873, 1.0861. Simple returns: Râ‚ = (1.0873 âˆ’ 1.0850)/1.0850 = 0.2120%, Râ‚‚ = (1.0861 âˆ’ 1.0873)/1.0873 = âˆ’0.1103%. Log-returns: râ‚ = ln(1.0873/1.0850) = 0.2118%, râ‚‚ = ln(1.0861/1.0873) = âˆ’0.1104%. The 2-period log-return râ‚â‚Šâ‚‚ = râ‚ + râ‚‚ = 0.1014%, which equals ln(1.0861/1.0850) = 0.1014%. âœ“",
            },

            // â”€â”€ THEORY 2: The Four Moments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "theory",
              title: "The Four Moments: Full Derivations",
              content:
                "Given n log-returns râ‚, râ‚‚, â€¦, râ‚™:\n\n**First Moment â€” Mean (Î¼).** The sample mean Î¼Ì‚ = (1/n) âˆ‘áµ¢ ráµ¢ estimates the expected drift E[r]. For EUR/USD hourly data over 2024, typical Î¼Ì‚ â‰ˆ âˆ’0.000002 (essentially zero â€” FX returns have negligible drift at high frequency). The standard error of the mean is SE(Î¼Ì‚) = Ïƒ/âˆšn, so with Ïƒ = 0.0004 and n = 6,000 hours, SE â‰ˆ 0.000005 â€” the mean is statistically indistinguishable from zero.\n\n**Second Central Moment â€” Variance (ÏƒÂ²).** The sample variance sÂ² = (1/(nâˆ’1)) âˆ‘áµ¢ (ráµ¢ âˆ’ Î¼Ì‚)Â² uses nâˆ’1 (Bessel's correction) for an unbiased estimate. Standard deviation ÏƒÌ‚ = âˆšsÂ². For EUR/USD 1H: ÏƒÌ‚ â‰ˆ 0.00038 per bar. To **annualize**: Ïƒ_annual = ÏƒÌ‚ Ã— âˆš(bars_per_year). With ~6,048 trading hours/year: Ïƒ_annual = 0.00038 Ã— âˆš6048 â‰ˆ 0.0296 = 2.96%. This matches typical EUR/USD annual realized volatility of 6-10% (the lower value reflects recent low-vol regimes).\n\n**Third Standardized Moment â€” Skewness (S).** S = (1/n) âˆ‘áµ¢ [(ráµ¢ âˆ’ Î¼Ì‚)/ÏƒÌ‚]Â³. Derivation: we standardize each return to záµ¢ = (ráµ¢ âˆ’ Î¼Ì‚)/ÏƒÌ‚, then compute the mean of zÂ³. Because cubing preserves sign, negative returns contribute negative zÂ³ values. If negative outliers are larger in magnitude than positive ones, S < 0 (left-skewed). Typical EUR/USD hourly skewness: S â‰ˆ âˆ’0.15 to âˆ’0.05. Carry trade pairs (AUD/JPY) often show S â‰ˆ âˆ’0.8 due to sudden risk-off unwinds.\n\n**Fourth Standardized Moment â€” Kurtosis (K) and Excess Kurtosis (Îº).** K = (1/n) âˆ‘áµ¢ [(ráµ¢ âˆ’ Î¼Ì‚)/ÏƒÌ‚]â´. The Normal distribution has K = 3, so we define excess kurtosis Îº = K âˆ’ 3. If Îº > 0 (leptokurtic), tails are fatter than Gaussian. Derivation insight: because we raise to the 4th power, extreme outliers are amplified dramatically â€” a return of 5Ïƒ contributes 5â´ = 625 to the sum, dominating the average. Typical EUR/USD: Îº â‰ˆ 5â€“15 on hourly data, meaning the 4Ïƒ event occurs roughly exp(âˆ’8) Ã· P(empirical 4Ïƒ) â‰ˆ 50Ã— more often than Gaussian predicts.\n\n**The Jarque-Bera Test.** JB = (n/6)(SÂ² + ÎºÂ²/4) tests Hâ‚€: data is normally distributed. Under Hâ‚€, JB ~ Ï‡Â²(2). For EUR/USD with S = âˆ’0.1 and Îº = 8: JB = (6000/6)(0.01 + 16) â‰ˆ 16,010 â€” overwhelmingly rejecting normality (critical value at Î± = 0.05 is 5.99).",
            },

            // â”€â”€ INTUITION 1 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "intuition",
              title: "The Weather Forecast Analogy",
              analogy:
                "Descriptive statistics are like a weather summary for a city.",
              content:
                "The **mean** is the average temperature â€” useful but doesn't tell you about heat waves or cold snaps. A city averaging 20Â°C could be consistently mild (low Ïƒ) or microstructure between 0Â°C and 40Â°C (high Ïƒ). **Standard deviation** is the temperature range â€” a desert has high Ïƒ (hot days, cold nights) while the tropics have low Ïƒ.\n\n**Skewness** is like a city where rare storms are always *worse* than rare sunny spells â€” the bad surprises outweigh the good. Miami has negative skew on property returns: steady appreciation punctuated by hurricane-driven crashes.\n\n**Kurtosis** tells you how often *extreme* weather occurs â€” a 'once-in-a-century' storm happening every decade. High kurtosis means your '100-year flood' model is dangerously wrong. Forex returns behave exactly this way: Î¼ and Ïƒ alone miss the fat tails that blow up accounts, which is why every risk model must check skewness and kurtosis before trusting a Gaussian assumption.",
              emoji: "ðŸŒ¦ï¸",
            },

            // â”€â”€ INTUITION 2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "intuition",
              title: "The Salary Distribution Analogy",
              analogy:
                "Mean vs median reveals the shape of a distribution just like salary data.",
              content:
                "In a company of 100 employees, 99 earn $50,000 and the CEO earns $50,000,000. The **mean** salary is $549,500 â€” wildly unrepresentative. The **median** is $50,000 â€” what a typical employee actually earns. When mean >> median, the distribution is right-skewed (pulled by outliers). In forex, a strategy that has mean return > median return likely has a few large winning trades inflating the average â€” strip those out and the typical trade is worse than the mean suggests. This is exactly why hedge funds report *median* monthly returns alongside mean, and why robust statistics (trimmed mean, MAD) matter.",
              emoji: "ðŸ’°",
            },

            // â”€â”€ THEORY 3: Robust Statistics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "theory",
              title: "Robust Statistics: When Outliers Break Standard Measures",
              content:
                "Standard mean and standard deviation are **not robust** â€” a single extreme observation can shift them dramatically. In live trading, a flash crash or news spike can make your rolling mean and Ïƒ meaningless for the next N bars.\n\n**Median Absolute Deviation (MAD).** MAD = median(|ráµ¢ âˆ’ median(r)|). For normally distributed data, Ïƒ â‰ˆ 1.4826 Ã— MAD (the constant converts MAD to a Ïƒ-equivalent). MAD is resistant to up to 50% outlier contamination (breakdown point = 0.5) vs 0% for standard deviation.\n\n**Trimmed Mean.** The Î±-trimmed mean discards the smallest Î±% and largest Î±% of observations before averaging. A 5%-trimmed mean on 1,000 returns drops the 50 most extreme values on each side. This eliminates flash crash contamination while keeping 90% of the data.\n\n**Winsorized Standard Deviation.** Instead of dropping outliers, Winsorization replaces them with the nearest non-outlier value. The 5%-Winsorized Ïƒ replaces the top and bottom 5% of returns with the 5th and 95th percentile values, then computes Ïƒ normally.\n\n**Interquartile Range (IQR).** IQR = Qâ‚ƒ âˆ’ Qâ‚ (75th percentile minus 25th). For a normal distribution, IQR â‰ˆ 1.35Ïƒ. Outliers are often defined as observations beyond Qâ‚ âˆ’ 1.5Ã—IQR or Qâ‚ƒ + 1.5Ã—IQR (Tukey's fences).\n\n**When to use which:** In live strategy monitoring, use MAD or Winsorized Ïƒ for position sizing during volatile periods. Use the trimmed mean when estimating expected returns across regimes. Reserve standard mean/Ïƒ for well-behaved, stationary periods only.",
            },

            // â”€â”€ CODE 1: Basic Statistics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "code",
              title: "Computing All Four Moments from Scratch",
              language: "python",
              code: `import numpy as np
import pandas as pd
from scipy import stats

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Load 1-hour EUR/USD closes and compute log-returns
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
prices = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
prices["log_return"] = np.log(prices["close"] / prices["close"].shift(1))
returns = prices["log_return"].dropna().values
n = len(returns)
print(f"Loaded {n:,} hourly log-returns")

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# First moment: Mean (Î¼)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
mu = np.sum(returns) / n                   # manual computation
se_mu = np.std(returns, ddof=1) / np.sqrt(n)  # standard error
print(f"\\nMean (Î¼):           {mu:.8f}")
print(f"Std Error of Mean:  {se_mu:.8f}")
print(f"95% CI for Î¼:       [{mu - 1.96*se_mu:.8f}, {mu + 1.96*se_mu:.8f}]")

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Second moment: Variance (ÏƒÂ²) and Std Dev (Ïƒ)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
variance = np.sum((returns - mu)**2) / (n - 1)  # Bessel's correction
sigma = np.sqrt(variance)
annualized_vol = sigma * np.sqrt(252 * 24)  # ~6048 trading hours/year
print(f"\\nVariance (ÏƒÂ²):      {variance:.10f}")
print(f"Std Dev (Ïƒ):        {sigma:.8f}")
print(f"Annualized Vol:     {annualized_vol:.4%}")

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Third moment: Skewness
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
z = (returns - mu) / sigma                  # standardize
skewness_manual = np.mean(z**3)
skewness_scipy = stats.skew(returns, bias=False)  # Fisher's correction
print(f"\\nSkewness (manual):  {skewness_manual:.6f}")
print(f"Skewness (scipy):   {skewness_scipy:.6f}")
print(f"Interpretation:     {'Left-skewed (larger downside tail)' if skewness_scipy < 0 else 'Right-skewed'}")

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Fourth moment: Kurtosis (excess)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
kurtosis_raw = np.mean(z**4)               # raw kurtosis K
excess_kurtosis = kurtosis_raw - 3          # Îº = K - 3
kurtosis_scipy = stats.kurtosis(returns, bias=False)
print(f"\\nRaw Kurtosis (K):   {kurtosis_raw:.4f}")
print(f"Excess Kurt (Îº):    {excess_kurtosis:.4f}")
print(f"Kurt (scipy):       {kurtosis_scipy:.4f}")
print(f"Interpretation:     {'Fat-tailed (leptokurtic)' if excess_kurtosis > 0 else 'Thin-tailed (platykurtic)'}")

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Jarque-Bera normality test
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
jb_stat, jb_pvalue = stats.jarque_bera(returns)
print(f"\\nJarque-Bera stat:   {jb_stat:.2f}")
print(f"JB p-value:         {jb_pvalue:.2e}")
print(f"Normal at Î±=0.05?   {'YES' if jb_pvalue > 0.05 else 'NO â€” reject normality'}")`,
              explanation:
                "This program computes all four moments step-by-step, showing both manual formulas and scipy equivalents. Key observations: (1) The mean is nearly zero with a tight confidence interval â€” hourly FX drift is negligible. (2) Annualized vol scales by âˆš(bars/year); for hourly data that's âˆš6048. (3) Negative skewness confirms asymmetric downside risk. (4) Excess kurtosis >> 0 proves fat tails. (5) The Jarque-Bera test will almost certainly reject normality for any FX pair â€” the JB statistic scales with n, and with thousands of observations even mild non-normality is statistically significant.",
            },

            // â”€â”€ CODE 2: Robust Statistics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "code",
              title: "Robust Alternatives: MAD, Trimmed Mean, IQR",
              language: "python",
              code: `import numpy as np
from scipy import stats

# Assume 'returns' array is loaded from previous code block
n = len(returns)

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Median Absolute Deviation (MAD)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
median_r = np.median(returns)
mad = np.median(np.abs(returns - median_r))
sigma_mad = 1.4826 * mad   # scale to Ïƒ-equivalent for normal data
print(f"Median:             {median_r:.8f}")
print(f"MAD:                {mad:.8f}")
print(f"Ïƒ from MAD:         {sigma_mad:.8f}")
print(f"Ïƒ from std:         {np.std(returns, ddof=1):.8f}")
print(f"Ratio (MAD/std):    {sigma_mad / np.std(returns, ddof=1):.4f}")
# Ratio > 1 means outliers inflate std more than MAD

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Trimmed Mean (5% trim)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
trim_pct = 0.05
trimmed_mean = stats.trim_mean(returns, trim_pct)
regular_mean = np.mean(returns)
print(f"\\nRegular mean:       {regular_mean:.8f}")
print(f"5%-Trimmed mean:    {trimmed_mean:.8f}")
print(f"10%-Trimmed mean:   {stats.trim_mean(returns, 0.10):.8f}")

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# IQR and Tukey Fences for Outlier Detection
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                "This code demonstrates three robust alternatives to standard mean/Ïƒ. The MAD-to-Ïƒ ratio reveals how much outliers inflate standard deviation â€” if the ratio deviates significantly from 1.0, outliers are present. The trimmed mean shows how much extreme values distort the average. Tukey's fences flag individual outlier returns; in fat-tailed forex data, you'll typically see 3-5% flagged vs the 0.7% expected under normality.",
            },

            // â”€â”€ CODE 3: Rolling Statistics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Rolling windows: 24-bar (1 day) and 120-bar (5 days)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
for window in [24, 120]:
    col = f"w{window}"
    prices[f"roll_mu_{col}"]   = prices["log_return"].rolling(window).mean()
    prices[f"roll_sigma_{col}"] = prices["log_return"].rolling(window).std()
    prices[f"roll_skew_{col}"]  = prices["log_return"].rolling(window).skew()
    prices[f"roll_kurt_{col}"]  = prices["log_return"].rolling(window).kurt()

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Annualize rolling volatility for intuitive comparison
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
prices["ann_vol_24h"] = prices["roll_sigma_w24"] * np.sqrt(252 * 24)
prices["ann_vol_5d"]  = prices["roll_sigma_w120"] * np.sqrt(252 * 24)

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Identify volatility regimes
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                "Rolling statistics reveal how market behaviour changes over time â€” essential for regime-adaptive strategies. Key insight: during HIGH_VOL regimes, kurtosis typically increases (more extreme moves) and skewness often becomes more negative (larger crash risk). A strategy that works in NORMAL vol may blow up in HIGH_VOL because the tail risk profile changes. This is why professional quant systems recompute statistics on a rolling basis and adjust position sizes accordingly.",
            },

            // â”€â”€ QUIZ (6 questions) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "quiz",
              questions: [
                {
                  id: "found-ds-q1",
                  question:
                    "A forex return series has excess kurtosis Îº = 4.2. What does this imply?",
                  options: [
                    { id: "found-ds-q1-a", text: "Returns are perfectly normally distributed" },
                    { id: "found-ds-q1-b", text: "Returns have lighter tails than a normal distribution" },
                    { id: "found-ds-q1-c", text: "Extreme moves occur more often than a normal distribution predicts" },
                    { id: "found-ds-q1-d", text: "The mean return is significantly positive" },
                  ],
                  correctOptionId: "found-ds-q1-c",
                  explanation:
                    "Excess kurtosis Îº > 0 means the distribution is leptokurtic â€” it has fatter tails than a Gaussian. Îº = 4.2 means the 4th standardized moment is 7.2 (vs 3 for Normal), so extreme gains and losses happen far more frequently than a bell curve predicts. This has direct implications for VaR calculations and stop-loss placement.",
                },
                {
                  id: "found-ds-q2",
                  question:
                    "Why do we typically use log-returns râ‚œ = ln(Pâ‚œ / Pâ‚œâ‚‹â‚) instead of simple returns?",
                  options: [
                    { id: "found-ds-q2-a", text: "Log-returns are always positive" },
                    { id: "found-ds-q2-b", text: "Log-returns are additive over time, enabling multi-period analysis via simple summation" },
                    { id: "found-ds-q2-c", text: "Log-returns eliminate the need for standard deviation" },
                    { id: "found-ds-q2-d", text: "Log-returns make kurtosis equal to zero" },
                  ],
                  correctOptionId: "found-ds-q2-b",
                  explanation:
                    "Log-returns satisfy r(t, t+k) = râ‚œâ‚Šâ‚ + râ‚œâ‚Šâ‚‚ + â€¦ + râ‚œâ‚Šâ‚– â€” the multi-period return is a simple sum. This time-additivity property makes statistical analysis tractable: the Central Limit Theorem applies to sums, so long-horizon log-returns converge to normality. Simple returns require multiplication: R(t,t+k) = âˆ(1 + Ráµ¢) âˆ’ 1, which is far less convenient mathematically.",
                },
                {
                  id: "found-ds-q3",
                  question:
                    "You compute Ïƒ = 0.0004 and MAD-based Ïƒ = 0.00035 for the same return series. What does this tell you?",
                  options: [
                    { id: "found-ds-q3-a", text: "The data has no outliers" },
                    { id: "found-ds-q3-b", text: "Standard deviation is inflated by extreme returns â€” outliers are present" },
                    { id: "found-ds-q3-c", text: "MAD is always smaller than Ïƒ regardless of the data" },
                    { id: "found-ds-q3-d", text: "The data is perfectly normally distributed" },
                  ],
                  correctOptionId: "found-ds-q3-b",
                  explanation:
                    "When standard Ïƒ > MAD-based Ïƒ, it means extreme observations are pulling the standard deviation upward. MAD is robust to outliers (breakdown point = 0.5), so the gap indicates fat-tailed behaviour. In normal data, the ratio should be ~1.0. A ratio of 0.0004/0.00035 = 1.14 suggests moderate outlier contamination â€” typical for forex data.",
                },
                {
                  id: "found-ds-q4",
                  question:
                    "A strategy has mean return = +0.02% per trade and median return = âˆ’0.01% per trade. What does this reveal?",
                  options: [
                    { id: "found-ds-q4-a", text: "The strategy is consistently profitable on every trade" },
                    { id: "found-ds-q4-b", text: "A few large winning trades inflate the mean â€” the typical trade actually loses money" },
                    { id: "found-ds-q4-c", text: "The strategy has zero skewness" },
                    { id: "found-ds-q4-d", text: "The strategy should be run with maximum leverage" },
                  ],
                  correctOptionId: "found-ds-q4-b",
                  explanation:
                    "When mean > median, the distribution is right-skewed â€” pulled upward by outlier wins. More than half the trades lose money (median < 0), but occasional large wins make the average positive. This is a classic trend-following profile: many small losses, few big wins. It's profitable on average but psychologically difficult and requires strict risk management to survive the losing streaks.",
                },
                {
                  id: "found-ds-q5",
                  question:
                    "To annualize the hourly standard deviation Ïƒâ‚• = 0.0004 for EUR/USD, you compute Ïƒ_annual = Ïƒâ‚• Ã— âˆšN. What is N?",
                  options: [
                    { id: "found-ds-q5-a", text: "365 Ã— 24 = 8,760 (all hours in a calendar year)" },
                    { id: "found-ds-q5-b", text: "252 Ã— 24 â‰ˆ 6,048 (trading hours: 252 business days Ã— 24-hour forex market)" },
                    { id: "found-ds-q5-c", text: "12 (months per year)" },
                    { id: "found-ds-q5-d", text: "52 (weeks per year)" },
                  ],
                  correctOptionId: "found-ds-q5-b",
                  explanation:
                    "Volatility scales by âˆš(bars per year). For hourly forex data, the market trades ~24 hours/day for ~252 business days = ~6,048 hours/year. Using 8,760 (all calendar hours) would overestimate because weekends have zero trading. The âˆšN scaling assumes returns are independent and identically distributed â€” an approximation, but standard practice. Ïƒ_annual = 0.0004 Ã— âˆš6048 â‰ˆ 3.1% annualized.",
                },
                {
                  id: "found-ds-q6",
                  question:
                    "The Jarque-Bera test statistic JB = (n/6)(SÂ² + ÎºÂ²/4) for your return series is 15,000 with p < 0.001. What does this mean?",
                  options: [
                    { id: "found-ds-q6-a", text: "The returns are normally distributed" },
                    { id: "found-ds-q6-b", text: "The returns are non-normal, but skewness and kurtosis are both zero" },
                    { id: "found-ds-q6-c", text: "The returns deviate significantly from normality â€” both skewness and/or kurtosis contribute to the rejection" },
                    { id: "found-ds-q6-d", text: "The sample size is too small to draw conclusions" },
                  ],
                  correctOptionId: "found-ds-q6-c",
                  explanation:
                    "The Jarque-Bera test is a joint test of S = 0 (no skewness) AND Îº = 0 (no excess kurtosis). JB = 15,000 >> Ï‡Â²(2) critical value of 5.99 at Î± = 0.05, so we overwhelmingly reject Hâ‚€: normality. The test is a sum of SÂ² (skewness term) and ÎºÂ²/4 (kurtosis term), so a large JB could come from extreme kurtosis alone, extreme skewness alone, or both. For forex data, the kurtosis term typically dominates.",
                },
              ],
            },

            // â”€â”€ PRACTICE 1 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "practice",
              title: "Hands-On: Compute Statistics for Multiple Pairs",
              description:
                "Load hourly data for EUR/USD, GBP/USD, USD/JPY, AUD/USD, and USD/CHF. For each pair, compute all four moments plus the Jarque-Bera test. Create a summary table comparing the pairs. Which pair has the heaviest tails (highest Îº)? Which is most negatively skewed? Does any pair fail to reject normality? Discuss why carry trade pairs (AUD) tend to have more negative skewness than major pairs.",
              catalogModelId: "statistical-analysis",
            },

            // â”€â”€ PRACTICE 2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "practice",
              title: "Dashboard Exercise: Rolling Volatility Regimes",
              description:
                "Open the dashboard's Data Analytics page and select EUR/USD hourly data. Compute 24-bar and 120-bar rolling standard deviations. Identify the top 5 highest-volatility periods in the dataset. For each, check: (1) What news event caused the spike? (2) How did skewness and kurtosis change during the spike? (3) How long did it take for volatility to return to the median? This exercise builds intuition for volatility clustering â€” the observation that high-vol periods tend to follow high-vol periods (GARCH effects).",
            },
          ],
        },
        {
          id: "found-probability",
          title: "Probability Distributions in Finance",
          description:
            "Master the Normal, Student-t, and log-normal distributions from first principles â€” derive their PDFs, understand moment existence conditions, and learn why financial returns require fat-tailed models. Build QQ-plots from scratch, run formal goodness-of-fit tests (KS, Chi-square), and fit Gaussian mixture models to capture multi-regime market behaviour.",
          estimatedMinutes: 90,
          difficulty: "beginner",
          sections: [
            // â”€â”€ OBJECTIVE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "objective",
              content:
                "By the end of this lesson you will be able to: (1) derive the Normal PDF from maximum-entropy principles and compute tail probabilities at arbitrary Ïƒ-levels, (2) construct the Student-t distribution as Z/âˆš(V/Î½) and explain why the degrees-of-freedom parameter Î½ controls tail heaviness and moment existence, (3) explain why prices follow a log-normal distribution while returns do not, (4) build a QQ-plot from scratch and interpret departures from the reference line, (5) run and interpret the Kolmogorov-Smirnov and Chi-square goodness-of-fit tests, (6) model multi-regime return distributions using Gaussian mixture models, and (7) fit distributions via maximum likelihood estimation and compare models using BIC/AIC.",
              keyTakeaways: [
                "The Normal PDF f(x) = (1/Ïƒâˆš(2Ï€))Â·exp[âˆ’(xâˆ’Î¼)Â²/(2ÏƒÂ²)] is the maximum-entropy distribution for a given mean and variance â€” any other distribution with the same Î¼ and ÏƒÂ² has *less* entropy",
                "The Student-t distribution is constructed as T = Z/âˆš(V/Î½) where Z ~ N(0,1) and V ~ Ï‡Â²(Î½), producing polynomial tail decay (1+tÂ²/Î½)^(âˆ’(Î½+1)/2) instead of exponential â€” dramatically more probability mass in the extremes",
                "Log-normal distributions model *prices* (Pâ‚œ = Pâ‚€Â·exp(âˆ‘râ‚œ) > 0 always) while returns râ‚œ are modelled directly with symmetric or fat-tailed distributions",
                "QQ-plots compare sorted empirical quantiles against theoretical quantiles â€” S-shaped departures reveal fat tails, shifted curves reveal location/scale mismatch",
                "The KS test measures D_n = sup|F_n(x) âˆ’ F(x)| â€” the maximum vertical gap between empirical and theoretical CDFs â€” providing a distribution-free goodness-of-fit test",
                "The Chi-square test bins data and computes Ï‡Â² = Î£(Oáµ¢âˆ’Eáµ¢)Â²/Eáµ¢ to test whether observed frequencies match expected frequencies under a hypothesized distribution",
                "Gaussian mixture models p(x) = Î£ wâ‚–Â·N(x|Î¼â‚–,Ïƒâ‚–Â²) capture multi-regime markets: low-volatility, normal, and crisis regimes each get their own Gaussian component",
                "MLE fitting maximizes L(Î¸) = Î áµ¢ f(xáµ¢|Î¸) â€” equivalently minimizes âˆ’log L â€” and model selection uses BIC = âˆ’2Â·log L + kÂ·log(n) to penalize complexity",
              ],
            },

            // â”€â”€ THEORY 1: The Normal Distribution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "theory",
              title: "The Normal (Gaussian) Distribution: Derivation & Properties",
              content:
                "**Derivation from maximum entropy.** Among all continuous distributions on (âˆ’âˆž, âˆž) with a specified mean Î¼ and variance ÏƒÂ², the **Normal distribution** uniquely maximizes the differential entropy H = âˆ’âˆ«f(x)Â·ln f(x) dx. The proof uses calculus of variations with Lagrange multipliers: we constrain âˆ«f = 1, âˆ«xÂ·f = Î¼, and âˆ«(xâˆ’Î¼)Â²Â·f = ÏƒÂ², then maximize âˆ’âˆ«fÂ·ln f. The Euler-Lagrange equation yields ln f(x) = âˆ’Î»â‚€ âˆ’ Î»â‚x âˆ’ Î»â‚‚(xâˆ’Î¼)Â², which is a quadratic in x inside an exponential â€” precisely the Gaussian form. Solving the multipliers gives the **PDF**: f(x) = (1 / Ïƒâˆš(2Ï€)) Â· exp[âˆ’(x âˆ’ Î¼)Â² / (2ÏƒÂ²)]. This is why the Normal distribution is the 'default' model when only mean and variance are known: it assumes *nothing* beyond those two moments, making it the least-biased choice.\n\n**Key properties.** E[X] = Î¼ (by symmetry), Var(X) = ÏƒÂ² (by construction). The distribution is perfectly symmetric: skewness = 0, kurtosis = 3 (excess kurtosis Îº = 0). The **moment generating function** is M(t) = exp(Î¼t + ÏƒÂ²tÂ²/2), from which all moments can be derived by differentiation: E[Xâ¿] = dâ¿M/dtâ¿|_{t=0}. The **68-95-99.7 rule**: P(|Xâˆ’Î¼| â‰¤ Ïƒ) = 0.6827, P(|Xâˆ’Î¼| â‰¤ 2Ïƒ) = 0.9545, P(|Xâˆ’Î¼| â‰¤ 3Ïƒ) = 0.9973. Beyond 3Ïƒ, probabilities drop exponentially: P(|Xâˆ’Î¼| > 4Ïƒ) = 6.33 Ã— 10â»âµ (about 1 in 15,787), P(|Xâˆ’Î¼| > 5Ïƒ) = 5.73 Ã— 10â»â· (about 1 in 1.74 million). The **Central Limit Theorem** guarantees that sums of i.i.d. random variables converge to normality regardless of the original distribution â€” this is why log-returns (which are sums over shorter intervals) tend toward normality at longer horizons.\n\n**Numerical example with EUR/USD.** Suppose EUR/USD hourly log-returns have Î¼ = 0.000002 and Ïƒ = 0.00038. Under a Normal model, the probability of a 4Ïƒ move (|r| > 0.00152) is 6.33 Ã— 10â»âµ, meaning we expect one such event every 15,787 hours â‰ˆ 2.6 years. But empirically, 4Ïƒ moves in EUR/USD occur roughly every 100â€“200 hours â€” about **80â€“160Ã— more often** than the Gaussian predicts. Similarly, 5Ïƒ moves (|r| > 0.0019) should happen once in 1.74 million hours â‰ˆ 290 years under normality, yet they occur several times per year in practice. This catastrophic underestimation of tail risk is why the Normal distribution alone is insufficient for financial risk management â€” we need fat-tailed alternatives.",
            },

            // â”€â”€ THEORY 2: The Student-t Distribution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "theory",
              title: "The Student-t Distribution: Construction, Moments & Tail Behaviour",
              content:
                "**Construction.** Let Z ~ N(0,1) and V ~ Ï‡Â²(Î½) be independent. Define T = Z / âˆš(V/Î½). Then T follows a **Student-t distribution** with Î½ degrees of freedom. The intuition: V/Î½ estimates the variance of Z, but with finite Î½ this estimate is noisy â€” sometimes too small (inflating T, creating heavy tails) and sometimes too large (compressing T). As Î½ â†’ âˆž, V/Î½ â†’ 1 by the law of large numbers, so T â†’ Z and the Student-t converges to the Normal.\n\n**Full PDF.** f(t) = [Î“((Î½+1)/2) / (âˆš(Î½Ï€) Â· Î“(Î½/2))] Â· (1 + tÂ²/Î½)^(âˆ’(Î½+1)/2), where Î“ is the gamma function. The critical difference from the Normal is the **tail decay**: the Normal decays as exp(âˆ’tÂ²/2) (super-exponential), while the Student-t decays as |t|^(âˆ’(Î½+1)) (polynomial). This polynomial decay means extreme values are *orders of magnitude* more likely. For example, at t = 6: the Normal PDF is â‰ˆ 6.1 Ã— 10â»â¹, but the t(5) PDF is â‰ˆ 1.5 Ã— 10â»â´ â€” roughly **25,000Ã— larger**.\n\n**Moment existence â€” a crucial subtlety.** The Student-t with Î½ degrees of freedom only has finite moments up to order Î½: the **mean** exists only for Î½ > 1 (for Î½ â‰¤ 1, the integral âˆ«tÂ·f(t)dt diverges â€” this is the Cauchy distribution case). The **variance** is Î½/(Î½âˆ’2) for Î½ > 2, and is infinite for 1 < Î½ â‰¤ 2. The **excess kurtosis** Îº = 6/(Î½âˆ’4) exists only for Î½ > 4. Let us derive this: Kurt(T) = E[Tâ´]/(E[TÂ²])Â² = E[Tâ´]/(Î½/(Î½âˆ’2))Â². Using the identity E[TÂ²áµ] = Î½áµ Â· Î“(k+1/2)Â·Î“(Î½/2âˆ’k) / (âˆšÏ€Â·Î“(Î½/2)) and evaluating at k=2, we get E[Tâ´] = 3Î½Â² / ((Î½âˆ’2)(Î½âˆ’4)) for Î½ > 4. Then Kurt(T) = [3Î½Â²/((Î½âˆ’2)(Î½âˆ’4))] / [Î½/(Î½âˆ’2)]Â² = 3Î½Â²(Î½âˆ’2)Â² / ((Î½âˆ’2)(Î½âˆ’4)Â·Î½Â²) = 3(Î½âˆ’2)/((Î½âˆ’4)), so excess kurtosis = 3(Î½âˆ’2)/(Î½âˆ’4) âˆ’ 3 = (3Î½âˆ’6âˆ’3Î½+12)/(Î½âˆ’4) = **6/(Î½âˆ’4)**. For Î½ = 5: Îº = 6/1 = 6 (very fat-tailed). For Î½ = 10: Îº = 6/6 = 1 (moderately fat). For Î½ = 30: Îº = 6/26 â‰ˆ 0.23 (nearly Gaussian). Most forex pairs fit with Î½ âˆˆ [3, 8], giving Îº âˆˆ [1.5, âˆž) â€” far from the Gaussian Îº = 0.\n\n**Numerical comparison.** Consider P(|T| > 4) for t(5) vs N(0,1). For N(0,1): P(|Z| > 4) = 2Â·Î¦(âˆ’4) â‰ˆ 2 Ã— 3.17 Ã— 10â»âµ = 6.33 Ã— 10â»âµ. For t(5): P(|T| > 4) â‰ˆ 2 Ã— 0.00509 = 0.01018 â€” that is **161Ã— more likely** than under the Normal. A 4Ïƒ event that 'should never happen' under Gaussian assumptions actually has a ~1% chance with t(5). This is why risk models that assume normality systematically underestimate tail risk in forex markets.",
            },

            // â”€â”€ THEORY 3: QQ-Plots, GoF Tests & Mixtures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "theory",
              title: "QQ-Plots, Goodness-of-Fit Tests & Mixture Distributions",
              content:
                "**QQ-plot construction algorithm.** Given n observations xâ‚, â€¦, xâ‚™ and a reference distribution F: (1) Sort the data: xâ‚â‚â‚Ž â‰¤ xâ‚â‚‚â‚Ž â‰¤ â€¦ â‰¤ xâ‚â‚™â‚Ž. (2) For each rank i, compute the theoretical quantile qáµ¢ = Fâ»Â¹((i âˆ’ 0.5)/n) â€” the 0.5 adjustment (Hazen plotting position) avoids 0 and 1. (3) Plot (qáµ¢, xâ‚áµ¢â‚Ž). If the data follows F exactly, points lie on the line y = x. **Interpretation**: an S-shaped departure (points below the line on the left, above on the right) indicates fat tails. A banana curve (points consistently above or below) indicates skewness. A shift indicates location mismatch. QQ-plots are the single most informative visual diagnostic for distribution fit â€” always plot one before trusting any parametric model.\n\n**Kolmogorov-Smirnov (KS) test.** The KS test computes the statistic D_n = sup_x |F_n(x) âˆ’ Fâ‚€(x)|, where F_n is the empirical CDF (step function jumping 1/n at each data point) and Fâ‚€ is the hypothesized CDF. D_n measures the **maximum vertical gap** between the two CDFs. Under Hâ‚€ (data comes from Fâ‚€), âˆšn Â· D_n converges to the Kolmogorov distribution. The p-value is P(D â‰¥ D_n | Hâ‚€): if p < Î± (typically 0.05), we reject the null. **Advantage**: distribution-free, works for any continuous Fâ‚€. **Limitation**: most sensitive near the center of the distribution (where the CDF has the steepest slope), less sensitive in the tails â€” precisely where we care most in finance. Also, parameters estimated from the same data inflate the test statistic, requiring the Lilliefors correction.\n\n**Chi-square goodness-of-fit test.** Partition the real line into k bins (e.g., k = 20 equal-probability bins under Fâ‚€). Count observed frequencies Oâ‚, â€¦, Oâ‚– and compute expected frequencies Eáµ¢ = n Â· P(bin i | Fâ‚€). The test statistic is Ï‡Â² = Î£áµ¢ (Oáµ¢ âˆ’ Eáµ¢)Â² / Eáµ¢, which follows a Ï‡Â²(k âˆ’ 1 âˆ’ p) distribution under Hâ‚€, where p is the number of estimated parameters. A large Ï‡Â² (small p-value) rejects the hypothesized distribution. **Advantage**: directly tests the frequency structure. **Limitation**: results depend on binning choice; each bin should have Eáµ¢ â‰¥ 5 for the approximation to hold.\n\n**Mixture distributions for multi-regime markets.** Markets cycle through distinct regimes â€” quiet (low vol), normal, and crisis (high vol). A single Gaussian cannot capture this. A **Gaussian mixture model** (GMM) with K components has density p(x) = Î£â‚– wâ‚– Â· N(x | Î¼â‚–, Ïƒâ‚–Â²), where wâ‚– â‰¥ 0 and Î£wâ‚– = 1. With K = 2 components, the GMM captures a 'calm' regime (small Ïƒâ‚, large wâ‚) and a 'crisis' regime (large Ïƒâ‚‚, small wâ‚‚). The EM algorithm iterates: E-step assigns soft cluster memberships, M-step updates Î¼â‚–, Ïƒâ‚–, wâ‚–. Model selection uses BIC = âˆ’2Â·log L + kÂ·log(n) or AIC = âˆ’2Â·log L + 2k, where lower is better. A 2-component mixture often dramatically outperforms a single Gaussian for forex returns, reflecting the well-documented phenomenon of volatility clustering.",
            },

            // â”€â”€ INTUITION 1 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "intuition",
              title: "The Dartboard Analogy",
              analogy:
                "Throwing darts at a board is like sampling from a distribution â€” but the type of player determines the tail behaviour.",
              content:
                "Imagine you throw darts at a bullseye. A **Normal distribution** says most darts land near the center and virtually none hit the wall â€” the probability dies off exponentially fast, like exp(âˆ’dÂ²). A professional darts player might throw 10,000 darts without ever hitting the wall. But the **Student-t distribution** is like a player who *occasionally* has a muscle spasm â€” the 'wall hits' (tail events) are rare but not impossibly so, because probability decays polynomially like 1/dâ´ instead of exponentially. After 10,000 throws, you'd see several wall hits. Using a Normal model is like pretending the wall never gets hit â€” until a flash crash proves otherwise.\n\nNow extend the analogy to **mixture distributions**: imagine two different players alternate â€” a steady professional (small Ïƒ, tight cluster) and a nervous amateur (large Ïƒ, wide scatter). The combined pattern on the board wouldn't look Gaussian â€” it would have a dense center cluster plus a diffuse halo. That's exactly what a 2-component Gaussian mixture captures: the 'professional' component models quiet markets, the 'amateur' component models volatile regimes. The mixture weight tells you how often each player is throwing â€” i.e., what fraction of time the market spends in each regime.",
              emoji: "ðŸŽ¯",
            },

            // â”€â”€ INTUITION 2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "intuition",
              title: "The Earthquake Magnitude Analogy",
              analogy:
                "Earthquake frequency teaches us that extreme events are far more common than bell curves predict.",
              content:
                "Consider earthquake magnitudes on the Richter scale. Small tremors (magnitude 2-3) happen thousands of times daily worldwide. Moderate quakes (magnitude 5-6) happen several times a month. A **Normal distribution** fitted to small tremors would predict that a magnitude-8 earthquake should occur roughly once every 10 million years â€” essentially never in human history. Yet we observe magnitude-8+ events every few years. The Gutenberg-Richter law shows that earthquake magnitudes follow a **power-law** (heavy-tailed) distribution, not a Gaussian one.\n\nForex markets behave similarly. Daily returns of 0.1-0.3% are the 'small tremors' â€” constant background noise. A 1% daily move is the 'moderate quake' â€” notable but not unusual. The Normal model says a 3-4% daily move (the 'magnitude 8') should essentially never happen. Yet the Swiss National Bank's abandonment of the EUR/CHF floor in January 2015 produced a **30% move in minutes** â€” an event so extreme that under Gaussian assumptions, it shouldn't occur once in the entire age of the universe. The Student-t distribution and mixture models don't predict *when* such events will occur, but they correctly assign them non-negligible probability, which is the difference between a risk model that works and one that bankrupts you.",
              emoji: "ðŸŒ",
            },

            // â”€â”€ CODE 1: Normal and Student-t PDFs from Scratch â”€â”€â”€â”€â”€â”€â”€
            {
              type: "code",
              title: "Computing Normal and Student-t PDFs from Scratch",
              language: "python",
              code: `import numpy as np
from scipy.special import gamma as gamma_fn
from scipy import stats

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Manual Normal PDF implementation
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def normal_pdf(x, mu=0.0, sigma=1.0):
    """Gaussian PDF: f(x) = (1/Ïƒâˆš(2Ï€)) Â· exp[-(x-Î¼)Â²/(2ÏƒÂ²)]"""
    coeff = 1.0 / (sigma * np.sqrt(2.0 * np.pi))
    exponent = -0.5 * ((x - mu) / sigma) ** 2
    return coeff * np.exp(exponent)

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Manual Student-t PDF implementation
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def student_t_pdf(x, nu):
    """Student-t PDF using the Gamma function."""
    coeff = gamma_fn((nu + 1) / 2) / (np.sqrt(nu * np.pi) * gamma_fn(nu / 2))
    body = (1.0 + x**2 / nu) ** (-(nu + 1) / 2)
    return coeff * body

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Compare tail probabilities at 3Ïƒ, 4Ïƒ, 5Ïƒ, 6Ïƒ
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("=" * 68)
print("  Tail Probability Comparison: P(|X| > kÏƒ)")
print("=" * 68)
print(f"{'k':>4s}  {'Normal P(|X|>k)':>18s}  {'t(Î½=5) P(|T|>k)':>18s}  {'Ratio t/N':>12s}")
print("-" * 68)

for k in [3, 4, 5, 6]:
    p_normal = 2 * stats.norm.sf(k)          # two-tailed
    p_t5     = 2 * stats.t.sf(k, df=5)       # two-tailed, Î½=5
    ratio    = p_t5 / p_normal if p_normal > 0 else float('inf')
    print(f"{k:>4d}  {p_normal:>18.6e}  {p_t5:>18.6e}  {ratio:>12.1f}x")

print()

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Verify manual PDFs match scipy at key points
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("Verification: manual vs scipy PDF at x = 3.0")
print(f"  Normal manual: {normal_pdf(3.0):.10f}")
print(f"  Normal scipy:  {stats.norm.pdf(3.0):.10f}")
print(f"  t(5) manual:   {student_t_pdf(3.0, 5):.10f}")
print(f"  t(5) scipy:    {stats.t.pdf(3.0, 5):.10f}")
print()

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# PDF comparison at x = 4 (the "4-sigma event")
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
x_val = 4.0
pdf_normal = normal_pdf(x_val)
for nu in [3, 5, 10, 30]:
    pdf_t = student_t_pdf(x_val, nu)
    print(f"At x=4: t(Î½={nu:>2d}) PDF = {pdf_t:.6e}, "
          f"ratio to Normal = {pdf_t / pdf_normal:>10.1f}x")
print(f"At x=4: Normal  PDF = {pdf_normal:.6e} (baseline)")`,
              explanation:
                "This program implements both PDFs from their mathematical definitions and produces a formatted comparison table. The key revelation is in the ratios: at 4Ïƒ, the Student-t(5) assigns **161Ã— more probability** than the Normal. At 6Ïƒ, the ratio exceeds 100,000Ã—. This isn't an academic curiosity â€” it means a Normal-based VaR model would tell you a 4Ïƒ loss 'essentially never happens', while the Student-t correctly warns it has a ~1% probability. The verification section confirms our manual implementations match scipy exactly, building confidence in the formulas.",
            },

            // â”€â”€ CODE 2: QQ-Plot & Goodness-of-Fit Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "code",
              title: "QQ-Plot Construction & Goodness-of-Fit Tests",
              language: "python",
              code: `import numpy as np
import pandas as pd
from scipy import stats
import matplotlib.pyplot as plt

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Load data and compute log-returns
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
prices = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
returns = np.log(prices["close"] / prices["close"].shift(1)).dropna().values
n = len(returns)
mu, sigma = np.mean(returns), np.std(returns, ddof=1)
print(f"Loaded {n:,} log-returns | Î¼ = {mu:.6e} | Ïƒ = {sigma:.6e}")

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Build QQ-plot from scratch (no probplot shortcut)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

# Panel 2: QQ-plot vs Student-t (fitted Î½)
df_t, mu_t, sigma_t = stats.t.fit(returns)
t_quantiles = stats.t.ppf(plotting_positions, df=df_t, loc=mu_t, scale=sigma_t)
axes[1].scatter(t_quantiles, sorted_returns, s=1, alpha=0.5, color="darkorange")
qq_min_t = min(t_quantiles.min(), sorted_returns.min())
qq_max_t = max(t_quantiles.max(), sorted_returns.max())
axes[1].plot([qq_min_t, qq_max_t], [qq_min_t, qq_max_t], "r--", lw=1.5, label="y = x")
axes[1].set_xlabel(f"Theoretical t(Î½={df_t:.1f}) Quantiles")
axes[1].set_ylabel("Empirical Quantiles")
axes[1].set_title(f"QQ-Plot vs Student-t (Î½={df_t:.1f})")
axes[1].legend()

# Panel 3: Histogram with overlaid PDFs
x_grid = np.linspace(sorted_returns.min(), sorted_returns.max(), 500)
axes[2].hist(returns, bins=100, density=True, alpha=0.5, color="gray", label="Empirical")
axes[2].plot(x_grid, stats.norm.pdf(x_grid, mu, sigma), "b-", lw=2, label="Normal")
axes[2].plot(x_grid, stats.t.pdf(x_grid, df_t, mu_t, sigma_t), "r-", lw=2,
             label=f"Student-t (Î½={df_t:.1f})")
axes[2].set_title("Histogram with Fitted PDFs")
axes[2].legend()
plt.tight_layout()
plt.savefig("qq_and_gof.png", dpi=150)
print("Saved qq_and_gof.png")

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Kolmogorov-Smirnov test vs Normal
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ks_stat, ks_pvalue = stats.kstest(returns, "norm", args=(mu, sigma))
print(f"\\nKS Test vs Normal: D_n = {ks_stat:.6f}, p-value = {ks_pvalue:.4e}")
print(f"  â†’ {'REJECT' if ks_pvalue < 0.05 else 'FAIL TO REJECT'} normality at Î± = 0.05")

# KS test vs fitted Student-t
ks_stat_t, ks_pvalue_t = stats.kstest(returns, "t", args=(df_t, mu_t, sigma_t))
print(f"KS Test vs t(Î½={df_t:.1f}): D_n = {ks_stat_t:.6f}, p-value = {ks_pvalue_t:.4e}")
print(f"  â†’ {'REJECT' if ks_pvalue_t < 0.05 else 'FAIL TO REJECT'} Student-t at Î± = 0.05")

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Chi-square goodness-of-fit test vs Normal
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
k_bins = 20  # number of equal-probability bins
bin_edges = stats.norm.ppf(np.linspace(0, 1, k_bins + 1), loc=mu, scale=sigma)
bin_edges[0], bin_edges[-1] = -np.inf, np.inf  # catch all tails
observed, _ = np.histogram(returns, bins=bin_edges)
expected = np.full(k_bins, n / k_bins)  # equal-probability bins â†’ equal expected

chi2_stat = np.sum((observed - expected)**2 / expected)
chi2_df = k_bins - 1 - 2  # subtract 1 for constraint, 2 for estimated params (Î¼, Ïƒ)
chi2_pvalue = 1 - stats.chi2.cdf(chi2_stat, chi2_df)

print(f"\\nChi-square GoF vs Normal:")
print(f"  Ï‡Â² = {chi2_stat:.2f}, df = {chi2_df}, p-value = {chi2_pvalue:.4e}")
print(f"  â†’ {'REJECT' if chi2_pvalue < 0.05 else 'FAIL TO REJECT'} normality at Î± = 0.05")
print(f"  Observed vs Expected per bin (first 5):")
for i in range(5):
    print(f"    Bin {i+1}: O={observed[i]:>5d}, E={expected[i]:>7.1f}, "
          f"(O-E)Â²/E = {(observed[i]-expected[i])**2/expected[i]:.2f}")`,
              explanation:
                "This program builds a QQ-plot entirely from scratch â€” sorting data, computing Hazen plotting positions, and inverting the CDF â€” rather than relying on scipy's probplot shortcut. The three-panel figure shows the Normal QQ-plot (expect S-shaped departure), the Student-t QQ-plot (expect much better fit), and the histogram with both fitted PDFs overlaid. The KS test computes the supremum distance between empirical and theoretical CDFs: a tiny p-value means the fit is poor. The chi-square test bins returns into 20 equal-probability bins and checks whether the observed counts match expectations. For forex data, the Normal will be overwhelmingly rejected by both tests, while the Student-t typically passes or comes much closer.",
            },

            // â”€â”€ CODE 3: Gaussian Mixture Models â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "code",
              title: "Fitting Gaussian Mixture Models to Multi-Regime Returns",
              language: "python",
              code: `import numpy as np
import pandas as pd
from sklearn.mixture import GaussianMixture
from scipy import stats

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Load data
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
prices = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
returns = np.log(prices["close"] / prices["close"].shift(1)).dropna().values
n = len(returns)
X = returns.reshape(-1, 1)  # sklearn expects 2D array
print(f"Fitting GMMs to {n:,} EUR/USD hourly log-returns\\n")

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Fit 1, 2, and 3 component Gaussian Mixtures
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Select best model by BIC (lower is better)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
best_k = min(results, key=lambda k: results[k]["bic"])
best_gmm = results[best_k]["model"]
print(f"\\nBest model by BIC: K = {best_k} components")
print(f"  Î”BIC(K=1 vs K={best_k}) = {results[1]['bic'] - results[best_k]['bic']:.2f}")

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Print component parameters and interpret as regimes
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Compare single Gaussian vs best mixture
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print(f"\\nSingle Gaussian: Ïƒ = {np.std(returns):.6e}, Ann. Vol = "
      f"{np.std(returns) * np.sqrt(252*24):.2%}")
print(f"The mixture reveals that the single-Gaussian volatility is a "
      f"*weighted average* of distinct regime volatilities.")
print(f"During the crisis regime, true volatility is much higher than "
      f"the unconditional estimate suggests.")`,
              explanation:
                "This program fits 1, 2, and 3 component Gaussian mixtures and uses BIC to select the optimal number of components. For forex data, K=2 typically wins: a dominant low-volatility regime (w â‰ˆ 0.7-0.85, small Ïƒ) and a minority high-volatility regime (w â‰ˆ 0.15-0.30, large Ïƒ). The single-Gaussian volatility is a blend of both â€” it overestimates risk in calm periods and *underestimates* it during crises. This is the fundamental insight behind regime-switching models: a single volatility number hides the fact that markets alternate between qualitatively different states.",
            },

            // â”€â”€ QUIZ (7 questions) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "quiz",
              questions: [
                {
                  id: "found-prob-q1",
                  question:
                    "Why are asset prices modelled as log-normal rather than normal?",
                  options: [
                    { id: "found-prob-q1-a", text: "Log-normal distributions always have zero skewness" },
                    { id: "found-prob-q1-b", text: "If log-returns râ‚œ ~ N(Î¼,ÏƒÂ²), then Pâ‚œ = Pâ‚€Â·exp(Î£râ‚œ) is log-normal and strictly positive â€” normal prices could go negative" },
                    { id: "found-prob-q1-c", text: "Log-normal distributions have thinner tails than normal distributions" },
                    { id: "found-prob-q1-d", text: "Prices are always integers, so log-normal is required" },
                  ],
                  correctOptionId: "found-prob-q1-b",
                  explanation:
                    "A normal distribution assigns nonzero probability to negative values, which is impossible for asset prices. If log-returns are normally distributed, then prices Pâ‚œ = Pâ‚€ Â· exp(Î£râ‚œ) follow a log-normal distribution by definition. The exponential function ensures prices are always strictly positive. This is also the foundation of geometric Brownian motion in the Black-Scholes framework.",
                },
                {
                  id: "found-prob-q2",
                  question:
                    "For a Student-t distribution with Î½ = 5 degrees of freedom, what is the excess kurtosis?",
                  options: [
                    { id: "found-prob-q2-a", text: "0 (same as Normal)" },
                    { id: "found-prob-q2-b", text: "6 / (5 âˆ’ 4) = 6" },
                    { id: "found-prob-q2-c", text: "5 / 6 â‰ˆ 0.83" },
                    { id: "found-prob-q2-d", text: "Undefined â€” kurtosis requires Î½ > 6" },
                  ],
                  correctOptionId: "found-prob-q2-b",
                  explanation:
                    "The excess kurtosis of a Student-t distribution is Îº = 6/(Î½âˆ’4) for Î½ > 4. With Î½ = 5: Îº = 6/(5âˆ’4) = 6, meaning the fourth moment is 6 units above the Gaussian baseline of 0. This was derived in the theory section by computing E[Tâ´]/(E[TÂ²])Â² and subtracting 3. For Î½ â‰¤ 4, the fourth moment is infinite and excess kurtosis is undefined.",
                },
                {
                  id: "found-prob-q3",
                  question:
                    "A KS test of your return data vs a fitted Normal gives D_n = 0.047 with p = 0.0001. What is the correct interpretation?",
                  options: [
                    { id: "found-prob-q3-a", text: "The data is perfectly normal â€” p is the probability of normality" },
                    { id: "found-prob-q3-b", text: "The maximum vertical gap between the empirical and Normal CDFs is 4.7%, and p < 0.05 means we reject the Normal hypothesis" },
                    { id: "found-prob-q3-c", text: "47% of the data is non-normal" },
                    { id: "found-prob-q3-d", text: "The test is invalid because financial data cannot be tested" },
                  ],
                  correctOptionId: "found-prob-q3-b",
                  explanation:
                    "D_n = 0.047 means the largest vertical gap between the empirical CDF F_n(x) and the fitted Normal CDF Fâ‚€(x) is 4.7% of the probability scale. The p-value of 0.0001 means that if the data truly came from that Normal distribution, the probability of observing a gap this large or larger is only 0.01%. Since p < Î± = 0.05, we reject Hâ‚€. Note that the KS test is most sensitive near the CDF's steepest region (center), so tail deviations may be even worse than D_n suggests.",
                },
                {
                  id: "found-prob-q4",
                  question:
                    "Your QQ-plot of EUR/USD returns vs Normal shows points that follow the reference line in the center but curve sharply away at both extremes (S-shape). What does this indicate?",
                  options: [
                    { id: "found-prob-q4-a", text: "The data is perfectly normally distributed" },
                    { id: "found-prob-q4-b", text: "The data has lighter tails than the Normal (platykurtic)" },
                    { id: "found-prob-q4-c", text: "The data has fatter tails than the Normal â€” empirical extremes are more extreme than the Gaussian predicts" },
                    { id: "found-prob-q4-d", text: "The mean is incorrectly estimated" },
                  ],
                  correctOptionId: "found-prob-q4-c",
                  explanation:
                    "An S-shaped QQ-plot means the empirical quantiles in both tails exceed what the Normal distribution predicts. On the left tail, sorted returns are more negative than Normal quantiles (points curve below the line); on the right tail, sorted returns are more positive (points curve above the line). This is the hallmark of leptokurtic (fat-tailed) data. The center of the distribution still matches well, which is why the S-shape appears â€” the Normal captures the bulk but misses the extremes.",
                },
                {
                  id: "found-prob-q5",
                  question:
                    "A chi-square goodness-of-fit test with 20 bins gives Ï‡Â² = 185.3 with df = 17 and p < 0.0001. The largest contributions come from the two outermost bins. What does this tell you?",
                  options: [
                    { id: "found-prob-q5-a", text: "The chi-square test is broken â€” 185.3 is too large to be meaningful" },
                    { id: "found-prob-q5-b", text: "The hypothesized distribution fails primarily in the tails â€” extreme returns occur much more often than expected" },
                    { id: "found-prob-q5-c", text: "You need more bins to get a valid result" },
                    { id: "found-prob-q5-d", text: "The data has too few observations for the test" },
                  ],
                  correctOptionId: "found-prob-q5-b",
                  explanation:
                    "When the largest (Oáµ¢âˆ’Eáµ¢)Â²/Eáµ¢ contributions come from the outermost bins, it means far more extreme returns were observed than the hypothesized distribution predicted. With equal-probability bins, each bin should have about n/20 observations. If the tail bins contain 3-5Ã— the expected count, the (Oâˆ’E)Â²/E term dominates the total Ï‡Â². This is classic fat-tail evidence and exactly what we expect when testing a Normal fit against forex returns.",
                },
                {
                  id: "found-prob-q6",
                  question:
                    "What happens to the Student-t distribution as Î½ â†’ âˆž?",
                  options: [
                    { id: "found-prob-q6-a", text: "It becomes a uniform distribution" },
                    { id: "found-prob-q6-b", text: "Its variance becomes infinite" },
                    { id: "found-prob-q6-c", text: "It converges to the standard Normal N(0,1) â€” tails thin out, kurtosis â†’ 0, variance â†’ 1" },
                    { id: "found-prob-q6-d", text: "It converges to an exponential distribution" },
                  ],
                  correctOptionId: "found-prob-q6-c",
                  explanation:
                    "As Î½ â†’ âˆž, the ratio V/Î½ in T = Z/âˆš(V/Î½) converges to 1 by the law of large numbers (since E[V/Î½] = 1 for V ~ Ï‡Â²(Î½)). Therefore T â†’ Z ~ N(0,1). Algebraically, the variance Î½/(Î½âˆ’2) â†’ 1, excess kurtosis 6/(Î½âˆ’4) â†’ 0, and the PDF (1+tÂ²/Î½)^(âˆ’(Î½+1)/2) â†’ exp(âˆ’tÂ²/2) Â· (1/âˆš(2Ï€)). At Î½ = 30, the Student-t is already nearly indistinguishable from the Normal for practical purposes.",
                },
                {
                  id: "found-prob-q7",
                  question:
                    "You fit a 2-component Gaussian mixture to USD/JPY returns and get: Component 1 (w=0.82, Ïƒâ‚=0.03%) and Component 2 (w=0.18, Ïƒâ‚‚=0.11%). What is the best interpretation?",
                  options: [
                    { id: "found-prob-q7-a", text: "The data is bimodal with two distinct peaks" },
                    { id: "found-prob-q7-b", text: "82% of the time the market is in a calm regime (Ïƒâ‰ˆ0.03%), and 18% of the time it enters a high-volatility regime (Ïƒâ‰ˆ0.11%) â€” roughly 3.7Ã— more volatile" },
                    { id: "found-prob-q7-c", text: "The mixture model is overfitting â€” one component is sufficient" },
                    { id: "found-prob-q7-d", text: "Component 2 represents measurement errors in the data" },
                  ],
                  correctOptionId: "found-prob-q7-b",
                  explanation:
                    "The two components correspond to distinct market regimes: a dominant calm period (82% of hours, low Ïƒ) and a minority crisis/news regime (18% of hours, high Ïƒ). The ratio Ïƒâ‚‚/Ïƒâ‚ â‰ˆ 3.7 means volatility nearly quadruples during regime shifts. A single-Gaussian Ïƒ would average across both regimes, underestimating crisis risk and overestimating calm-period risk. This mixture interpretation directly informs position sizing: reduce size when regime 2 is detected, increase when regime 1 dominates.",
                },
              ],
            },

            // â”€â”€ PRACTICE 1 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "practice",
              title: "Hands-On: Distribution Fitting & KS Testing Across Forex Pairs",
              description:
                "Load hourly data for EUR/USD, GBP/USD, USD/JPY, AUD/USD, and USD/CHF. For each pair: (1) Fit both a Normal and a Student-t distribution via MLE. Record the fitted Î½ for each pair. (2) Run the KS test against both the Normal and Student-t fits â€” record D_n and p-value for each. (3) Create a summary table with columns: Pair | Î½ | KS_Normal_D | KS_Normal_p | KS_t_D | KS_t_p. (4) Which pair has the lowest Î½ (fattest tails)? Which pair comes closest to passing the KS test for normality? (5) For the fattest-tailed pair, compute P(|X| > 3Ïƒ) under both the fitted Normal and Student-t â€” how much does the Normal underestimate this probability? Discuss implications for stop-loss placement and position sizing.",
            },

            // â”€â”€ PRACTICE 2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            {
              type: "practice",
              title: "Dashboard Exercise: Distribution Fits & QQ-Plot Exploration",
              description:
                "Open the dashboard's Data Analytics page and select EUR/USD hourly data. Navigate to the distribution fitting panel: (1) Generate the QQ-plot against a Normal distribution â€” identify the S-shaped departure in the tails and estimate by eye where the empirical quantiles first deviate from the reference line (typically around Â±2Ïƒ). (2) Switch the reference distribution to Student-t and observe how the QQ-plot straightens. (3) Examine the histogram overlay with fitted PDFs â€” note how the Student-t captures the peak height better than the Normal (leptokurtic distributions are both more peaked and fatter-tailed). (4) If a mixture model option is available, fit a 2-component GMM and identify the regime components. (5) Repeat for USD/JPY and compare: does the yen pair show different tail behaviour than the euro pair? Relate any differences to the known carry-trade dynamics of JPY.",
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
                "The null hypothesis Hâ‚€ assumes a strategy has zero expected return â€” the burden of proof is on you to reject it",
                "The t-statistic is derived by replacing the unknown population Ïƒ with the sample s in the Z-score formula, producing a Student-t distribution with nâˆ’1 degrees of freedom",
                "A p-value is the geometric area under the t-distribution curve in the tail beyond the observed test statistic â€” it is NOT the probability that Hâ‚€ is true",
                "Type I error (false positive) rate = Î±; Type II error (false negative) rate = Î²; statistical power = 1 âˆ’ Î² depends on effect size, sample size, and Î±",
                "Bonferroni correction controls family-wise error rate (FWER) by testing each hypothesis at Î±/k â€” conservative but simple",
                "Benjamini-Hochberg controls the false discovery rate (FDR) â€” less conservative, more powerful, preferred when testing many strategies",
                "Bootstrap hypothesis testing builds the null distribution empirically by resampling, requiring no distributional assumptions",
                "Cohen's d = (xÌ„ âˆ’ Î¼â‚€) / s quantifies effect size independently of sample size â€” a large t-stat with tiny Cohen's d means statistical but not practical significance",
              ],
            },
            {
              type: "theory",
              title: "The One-Sample t-Test: Full Derivation",
              content:
                "We begin with the most fundamental question in quantitative trading: does a strategy have a non-zero expected return? Suppose we observe n trade returns xâ‚, xâ‚‚, â€¦, xâ‚™ and wish to test **Hâ‚€: Î¼ = Î¼â‚€** (typically Î¼â‚€ = 0, meaning no edge) against **Hâ‚: Î¼ > Î¼â‚€** (the strategy is profitable). The sample mean is **XÌ„ = (1/n) Î£áµ¢ xáµ¢**. By the Central Limit Theorem, if the xáµ¢ are i.i.d. with mean Î¼ and variance ÏƒÂ², then XÌ„ ~ N(Î¼, ÏƒÂ²/n) for large n. Under Hâ‚€, we can standardize: **Z = (XÌ„ âˆ’ Î¼â‚€) / (Ïƒ / âˆšn)**, which follows a standard Normal N(0,1). However, we never know the true population standard deviation Ïƒ. When we replace Ïƒ with the sample standard deviation **s = âˆš[(1/(nâˆ’1)) Î£áµ¢ (xáµ¢ âˆ’ XÌ„)Â²]**, the resulting statistic **t = (XÌ„ âˆ’ Î¼â‚€) / (s / âˆšn)** no longer follows a Normal distribution. William Sealy Gosset, publishing under the pseudonym 'Student' in 1908, proved that this ratio follows a **Student-t distribution with Î½ = n âˆ’ 1 degrees of freedom**. The t-distribution has heavier tails than the Normal â€” reflecting the additional uncertainty from estimating Ïƒ â€” but converges to N(0,1) as n â†’ âˆž. The quantity s / âˆšn is called the **standard error of the mean (SEM)**, and it measures how precisely we have estimated the population mean.\n\nLet us work through a concrete numerical example. A moving-average crossover strategy on EUR/USD produces n = 200 trades with sample mean return XÌ„ = 0.0003 (0.03% per trade, or roughly 3 pips) and sample standard deviation s = 0.008 (0.8%). First, compute the standard error: SEM = s / âˆšn = 0.008 / âˆš200 = 0.008 / 14.142 = 0.000566. Then the t-statistic: t = (XÌ„ âˆ’ 0) / SEM = 0.0003 / 0.000566 = 0.530. The degrees of freedom are Î½ = 200 âˆ’ 1 = 199. Looking up the one-tailed p-value from the Student-t distribution with 199 df, we find P(T â‰¥ 0.530) â‰ˆ 0.298. Since p = 0.298 is far greater than Î± = 0.05, we **fail to reject Hâ‚€** â€” we have no statistically significant evidence that this strategy has a real edge. The mean return of 0.03% per trade is entirely consistent with random noise given the high volatility of 0.8% per trade.\n\nThere is an elegant duality between **hypothesis tests and confidence intervals**. A 95% confidence interval for Î¼ is XÌ„ Â± tâ‚€.â‚€â‚‚â‚…,Î½ Â· SEM. For our example: 0.0003 Â± 1.972 Ã— 0.000566 = 0.0003 Â± 0.00112 = (âˆ’0.00082, 0.00142). Since this interval contains Î¼â‚€ = 0, we cannot reject Hâ‚€ at the 5% level â€” consistent with our p-value conclusion. This duality always holds: rejecting Hâ‚€ at significance level Î± is mathematically equivalent to the (1âˆ’Î±) confidence interval not containing Î¼â‚€. In practice, the confidence interval is more informative because it shows the range of plausible values for the true mean return, not just a binary reject/fail-to-reject decision.",
            },
            {
              type: "theory",
              title: "P-Values, Statistical Power & Effect Size",
              content:
                "The **p-value** has a precise geometric interpretation: it is the **area under the t-distribution curve** in the tail(s) beyond the observed test statistic. For a one-tailed test with t = 0.530 and Î½ = 199, the p-value is the area under the tâ‚â‚‰â‚‰ density curve from 0.530 to +âˆž. Visually, if you plot the bell-shaped t-distribution and shade everything to the right of 0.530, that shaded area equals 0.298. A smaller t-statistic means more shaded area (larger p-value, weaker evidence); a larger t-statistic means less shaded area (smaller p-value, stronger evidence). For a two-tailed test, you shade both tails symmetrically and the p-value doubles. Common misinterpretations that you **must** avoid: the p-value is NOT the probability that Hâ‚€ is true (that would require Bayesian analysis with a prior), it is NOT the probability of a false positive (that is Î±, the threshold you choose), and a non-significant p-value does NOT prove Hâ‚€ is true (absence of evidence â‰  evidence of absence). The p-value answers one specific question: 'If the null hypothesis were true, how surprising is our observed data?'\n\nNow consider the errors we can make. A **Type I error** (false positive, rate Î±) occurs when we reject Hâ‚€ even though the strategy truly has no edge â€” we deploy capital on a random strategy and lose money plus transaction costs. A **Type II error** (false negative, rate Î²) occurs when we fail to reject Hâ‚€ even though the strategy has a genuine edge â€” we leave money on the table. **Statistical power** = 1 âˆ’ Î² is the probability of correctly detecting a real effect. Power depends on three factors: (1) the **effect size** â€” how large the true mean return is relative to the noise; (2) the **sample size** n â€” more trades give us a more precise estimate of the mean; and (3) the **significance level** Î± â€” a stricter threshold (smaller Î±) reduces Type I errors but also reduces power. **Cohen's d** = (XÌ„ âˆ’ Î¼â‚€) / s is the standard measure of effect size: d = 0.2 is 'small', d = 0.5 is 'medium', d = 0.8 is 'large'. For our example, d = 0.0003 / 0.008 = 0.0375 â€” an extremely small effect size, meaning the signal-to-noise ratio is terrible.\n\nHow many trades do we need to detect a given effect size? The required sample size for a one-tailed t-test with power 1 âˆ’ Î² at significance level Î± is approximately **n â‰ˆ ((z_Î± + z_Î²) / d)Â²**, where z_Î± and z_Î² are standard Normal quantiles. Suppose we want to detect a Sharpe-ratio-equivalent of 0.5 annualized. For hourly trading (â‰ˆ6,000 bars/year), the per-trade effect size is d = 0.5 / âˆš6000 â‰ˆ 0.00645. With Î± = 0.05 (zâ‚€.â‚€â‚… = 1.645) and power = 0.80 (zâ‚€.â‚‚â‚€ = 0.842), we need n â‰ˆ ((1.645 + 0.842) / 0.00645)Â² â‰ˆ (385.4)Â² â‰ˆ 148,500 hourly bars â€” roughly 25 years of hourly data. This sobering calculation reveals why detecting small edges in high-frequency trading requires enormous datasets, and why many 'significant' backtests on short histories are almost certainly noise.",
            },
            {
              type: "theory",
              title: "Multiple Testing Corrections: Bonferroni & FDR",
              content:
                "When you test k strategies simultaneously, each at significance level Î±, the probability of at least one false positive across all tests â€” called the **family-wise error rate (FWER)** â€” is FWER = 1 âˆ’ (1 âˆ’ Î±)áµ. For k = 20 strategies at Î± = 0.05: FWER = 1 âˆ’ 0.95Â²â° = 1 âˆ’ 0.3585 = 0.6415. That is a 64% chance of at least one false discovery â€” essentially a coin flip that one of your 'significant' strategies is actually garbage. The **Bonferroni correction** is the simplest fix: reject Hâ‚€ for test i only if páµ¢ < Î±/k. With k = 20 and Î± = 0.05, each test must meet the threshold Î±/k = 0.05/20 = 0.0025. Worked example: suppose you test 20 moving-average crossover variants and obtain p-values ranging from 0.001 to 0.42. Under uncorrected Î± = 0.05, suppose 4 strategies appear significant (p < 0.05). After Bonferroni, only strategies with p < 0.0025 survive â€” perhaps only 1 or 0. Bonferroni guarantees FWER â‰¤ Î±, but it is **conservative**: by making each test very strict, it dramatically reduces power, meaning genuinely profitable strategies may be discarded (increased Type II errors).\n\nThe **Benjamini-Hochberg (BH) procedure** offers a better power-vs-error tradeoff by controlling the **false discovery rate (FDR)** â€” the expected proportion of rejected hypotheses that are false positives â€” rather than the probability of any single false positive. The algorithm: (1) Sort all k p-values in ascending order: pâ‚â‚â‚Ž â‰¤ pâ‚â‚‚â‚Ž â‰¤ â€¦ â‰¤ pâ‚â‚–â‚Ž. (2) For each rank i, compute the BH threshold: (i/k) Â· Î±. (3) Find the largest i such that pâ‚áµ¢â‚Ž â‰¤ (i/k) Â· Î±. (4) Reject all hypotheses with rank â‰¤ that i. Worked example with k = 10 sorted p-values: [0.001, 0.005, 0.012, 0.018, 0.030, 0.041, 0.065, 0.110, 0.350, 0.710] at Î± = 0.05. The BH thresholds are: i=1: 0.005, i=2: 0.010, i=3: 0.015, i=4: 0.020, i=5: 0.025, i=6: 0.030, i=7: 0.035, i=8: 0.040, i=9: 0.045, i=10: 0.050. Checking pâ‚áµ¢â‚Ž â‰¤ (i/10)Â·0.05: pâ‚â‚â‚Ž=0.001 â‰¤ 0.005 âœ“, pâ‚â‚‚â‚Ž=0.005 â‰¤ 0.010 âœ“, pâ‚â‚ƒâ‚Ž=0.012 â‰¤ 0.015 âœ“, pâ‚â‚„â‚Ž=0.018 â‰¤ 0.020 âœ“, pâ‚â‚…â‚Ž=0.030 > 0.025 âœ—. The largest passing i is 4, so we reject the first 4 hypotheses. Under Bonferroni (threshold 0.005), only 2 would survive. BH retains more discoveries while still controlling the fraction of false positives to â‰¤ 5%. In trading, BH is preferred when screening many strategy variants because you care about the proportion of deployed strategies that fail, not the absolute count.\n\nThe tradeoff between Bonferroni and BH is fundamentally about **what error you want to control**. Bonferroni controls FWER â€” the probability that even one false positive sneaks through â€” appropriate when each false positive is catastrophic (e.g., deploying one bad strategy could bankrupt the fund). BH controls FDR â€” the expected fraction of discoveries that are false â€” appropriate when you will deploy a portfolio of strategies and can tolerate some fraction being duds as long as the portfolio overall is profitable.",
            },
            {
              type: "theory",
              title: "Bootstrap Hypothesis Testing",
              content:
                "All derivations above assumed that trade returns are approximately Normally distributed (or that n is large enough for CLT to apply). In practice, forex returns exhibit **fat tails, skewness, and serial dependence** â€” violations that can make parametric t-tests unreliable, especially with small samples. **Bootstrap hypothesis testing** constructs the null distribution empirically, requiring no distributional assumptions. The algorithm for testing Hâ‚€: Î¼ = 0 is: (1) Compute the observed test statistic t_obs = XÌ„ / (s / âˆšn) from the original n trade returns. (2) Center the data under Hâ‚€ by subtracting the sample mean: xáµ¢* = xáµ¢ âˆ’ XÌ„ (so the centered data has mean zero, consistent with Hâ‚€). (3) For b = 1, 2, â€¦, B (typically B = 10,000): draw a bootstrap sample of size n with replacement from the centered data {xáµ¢*}, compute the bootstrap test statistic t_b = XÌ„_b / (s_b / âˆšn). (4) The bootstrap p-value is the fraction of bootstrap samples where t_b â‰¥ t_obs: p_boot = (1/B) Î£ ðŸ™(t_b â‰¥ t_obs). This p-value is distribution-free because the null distribution is built entirely from the data itself.\n\nThe **advantages** of bootstrap testing are substantial: it works with any distribution shape (fat tails, skewness), handles small samples where CLT may not hold, and can test complex statistics (e.g., Sharpe ratio, maximum drawdown) for which no closed-form null distribution exists. The **disadvantages** are: computational cost (10,000 resamples Ã— n trades each), the requirement that observations are **independent and identically distributed (i.i.d.)** â€” if returns are autocorrelated, a block bootstrap or circular bootstrap is needed instead â€” and the fact that bootstrap p-values have finite resolution limited by B (with B = 10,000, the smallest achievable p-value is 1/10,000 = 0.0001). In practice, combine bootstrap tests with parametric t-tests: if both agree, you have robust evidence; if they disagree, investigate whether distributional assumptions are the cause.",
            },
            {
              type: "intuition",
              title: "The Jury Trial Analogy",
              analogy:
                "Hypothesis testing is like a jury trial â€” the strategy is 'innocent' (no edge) until proven 'guilty' (profitable) beyond reasonable doubt.",
              content:
                "In a trial, the defendant (your strategy) is **presumed innocent** (Hâ‚€: no edge). The prosecution (your backtest data) presents evidence â€” trade returns, Sharpe ratios, t-statistics. The **p-value** is like asking: 'If the defendant were truly innocent, how likely is it that evidence this damning would appear by chance?' If that probability is very low (p < 0.05), the jury rejects innocence and convicts (rejects Hâ‚€). A **Type I error** is a wrongful conviction â€” deploying a strategy that has no real edge, costing you capital and transaction costs. A **Type II error** is acquitting a guilty person â€” discarding a genuinely profitable strategy and leaving money on the table. **Power** is the probability of convicting someone who is actually guilty â€” it depends on how strong the evidence is (effect size), how much evidence you collect (sample size), and how high you set the bar for conviction (Î±). Now imagine running **20 simultaneous trials** (testing 20 strategy variants). Even if all defendants are innocent, by pure chance one will look guilty (p < 0.05 for at least one, with 64% probability). **Bonferroni** raises the conviction bar for each trial to Î±/20, ensuring the overall chance of any wrongful conviction stays at 5%. **Benjamini-Hochberg** takes a different approach: it accepts that some small fraction of convictions may be wrongful, but controls that fraction to â‰¤ 5% of all convictions â€” a more lenient but more powerful standard.",
              emoji: "âš–ï¸",
            },
            {
              type: "intuition",
              title: "The Medical Drug Trial Analogy",
              analogy:
                "Testing a trading strategy is like running a clinical drug trial â€” you need a placebo group, blinding, power analysis, and multiple-endpoint correction.",
              content:
                "In a drug trial, patients receive either the real drug or a **placebo** (sugar pill). The placebo group establishes the baseline: some patients improve by pure chance, just as a random trading strategy occasionally produces positive returns over a finite sample. The trial is **double-blind** â€” neither doctors nor patients know who gets the real drug â€” to prevent bias. In trading, the equivalent is **out-of-sample testing**: the strategy must not have 'seen' the test data during development, otherwise the backtest is like an unblinded trial where the doctor unconsciously gives better care to drug patients. Before the trial begins, regulators require a **power analysis**: how many patients (trades) are needed to detect a clinically meaningful improvement (effect size)? A drug that reduces blood pressure by 0.1 mmHg is statistically detectable with enough patients, but clinically meaningless â€” just as a strategy with Cohen's d = 0.01 may be 'significant' with 100,000 trades but generate returns too small to cover transaction costs. Finally, if the drug trial measures **multiple endpoints** (blood pressure, cholesterol, mortality, side effects), each endpoint is an independent hypothesis test. Without correction, at least one endpoint will appear 'significant' by chance â€” exactly the same problem as testing 20 MA crossover variants. The FDA requires **multiple-endpoint correction** (Bonferroni or Holmâ€“Bonferroni), just as rigorous quant research requires multiple-testing correction before declaring a strategy 'works'.",
              emoji: "ðŸ’Š",
            },
            {
              type: "code",
              title: "Complete t-Test for Strategy Evaluation",
              language: "python",
              code: `import numpy as np
import pandas as pd
from scipy import stats

# â”€â”€ Load EUR/USD hourly data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
prices = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
prices["log_return"] = np.log(prices["close"] / prices["close"].shift(1))
prices.dropna(subset=["log_return"], inplace=True)

# â”€â”€ Simple MA crossover strategy: buy when fast MA > slow MA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
fast_period, slow_period = 10, 50
prices["ma_fast"] = prices["close"].rolling(fast_period).mean()
prices["ma_slow"] = prices["close"].rolling(slow_period).mean()
prices["signal"] = (prices["ma_fast"] > prices["ma_slow"]).astype(int)
prices["strategy_return"] = prices["signal"].shift(1) * prices["log_return"]
strategy_returns = prices["strategy_return"].dropna().values
n = len(strategy_returns)

# â”€â”€ Step 1: Compute sample statistics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
x_bar = np.mean(strategy_returns)           # sample mean
s = np.std(strategy_returns, ddof=1)        # sample std (Bessel's correction)
sem = s / np.sqrt(n)                         # standard error of the mean

print("=" * 60)
print("STEP 1: Sample Statistics")
print(f"  n (number of trades/bars):   {n}")
print(f"  X-bar (sample mean return):  {x_bar:.8f}")
print(f"  s (sample std deviation):    {s:.8f}")
print(f"  SEM = s / sqrt(n):           {sem:.8f}")

# â”€â”€ Step 2: Compute t-statistic manually â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
mu_0 = 0.0  # null hypothesis: no edge
t_stat_manual = (x_bar - mu_0) / sem
df = n - 1
print(f"\\nSTEP 2: t-Statistic (manual derivation)")
print(f"  t = (X-bar - mu_0) / SEM")
print(f"  t = ({x_bar:.8f} - {mu_0}) / {sem:.8f}")
print(f"  t = {t_stat_manual:.6f}")
print(f"  Degrees of freedom: n - 1 = {df}")

# â”€â”€ Step 3: Compute p-value (one-tailed: H1: mu > 0) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
p_value_one_manual = 1 - stats.t.cdf(t_stat_manual, df=df)
print(f"\\nSTEP 3: P-value (geometric area under t-distribution tail)")
print(f"  P(T >= {t_stat_manual:.4f} | df={df}) = {p_value_one_manual:.6f}")

# â”€â”€ Step 4: Verify with scipy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
t_stat_scipy, p_two_scipy = stats.ttest_1samp(strategy_returns, popmean=0)
p_one_scipy = p_two_scipy / 2 if t_stat_scipy > 0 else 1 - p_two_scipy / 2
print(f"\\nSTEP 4: Verification via scipy.stats.ttest_1samp")
print(f"  scipy t-stat:          {t_stat_scipy:.6f}")
print(f"  scipy p-value (1-tail):{p_one_scipy:.6f}")
print(f"  Manual matches scipy:  {np.isclose(t_stat_manual, t_stat_scipy)}")

# â”€â”€ Step 5: 95% confidence interval for mu â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
t_crit = stats.t.ppf(0.975, df=df)  # two-tailed critical value
ci_lower = x_bar - t_crit * sem
ci_upper = x_bar + t_crit * sem
print(f"\\nSTEP 5: 95% Confidence Interval")
print(f"  CI = X-bar +/- t_0.025 * SEM")
print(f"  CI = {x_bar:.8f} +/- {t_crit:.4f} * {sem:.8f}")
print(f"  CI = ({ci_lower:.8f}, {ci_upper:.8f})")
print(f"  Contains mu_0=0? {'YES => fail to reject H0' if ci_lower <= 0 <= ci_upper else 'NO => reject H0'}")

# â”€â”€ Step 6: Cohen's d effect size â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
cohens_d = (x_bar - mu_0) / s
print(f"\\nSTEP 6: Effect Size (Cohen's d)")
print(f"  d = (X-bar - mu_0) / s = {x_bar:.8f} / {s:.8f} = {cohens_d:.6f}")
size_label = "negligible" if abs(cohens_d) < 0.2 else "small" if abs(cohens_d) < 0.5 else "medium" if abs(cohens_d) < 0.8 else "large"
print(f"  Interpretation: {size_label} effect (|d|={abs(cohens_d):.4f})")

# â”€â”€ Final verdict â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
alpha = 0.05
reject = p_value_one_manual < alpha
print(f"\\n{'=' * 60}")
print(f"VERDICT at alpha={alpha}:")
print(f"  Reject H0? {'YES - strategy has significant edge' if reject else 'NO - insufficient evidence of edge'}")
print(f"  p-value:   {p_value_one_manual:.6f}")
print(f"  Cohen's d: {cohens_d:.6f} ({size_label})")
print("=" * 60)`,
              explanation:
                "This program derives the t-statistic from scratch â€” computing the sample mean, sample standard deviation (with Bessel's correction), and standard error â€” then manually evaluates the p-value as the tail area of the Student-t distribution. It verifies the manual calculation against scipy, constructs a 95% confidence interval, and computes Cohen's d effect size. The confidence interval check demonstrates the duality between hypothesis tests and interval estimation: if the CI contains zero, we fail to reject Hâ‚€, consistent with the p-value result.",
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

# â”€â”€ Power calculation function (one-sample, one-tailed t-test) â”€â”€â”€â”€â”€â”€â”€â”€
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

# â”€â”€ Required sample size for target power â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

# â”€â”€ Compute required N for different annualized Sharpe ratios â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

# â”€â”€ Plot power curves for different effect sizes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

# â”€â”€ Key insight: detecting small edges requires massive data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
d_small = 0.02  # typical forex intraday edge
n_needed = required_n(d_small)
print(f"\\nKey insight: To detect an effect size d={d_small} with 80% power,")
print(f"you need {n_needed:,} trades ({n_needed / bars_per_year:.1f} years of hourly data).")
print("Most retail backtests use 1-3 years â€” hopelessly underpowered.")`,
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

# â”€â”€ Load EUR/USD hourly data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
prices = pd.read_csv("eurusd_1h.csv", parse_dates=["timestamp"])
prices["log_return"] = np.log(prices["close"] / prices["close"].shift(1))
prices.dropna(subset=["log_return"], inplace=True)

# â”€â”€ Test 20 MA crossover parameter combinations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

# â”€â”€ Uncorrected results â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("=" * 80)
print(f"UNCORRECTED RESULTS (alpha = {alpha}, k = {k} tests)")
print("-" * 80)
sig_uncorrected = df[df["p_value"] < alpha]
print(f"Significant strategies: {len(sig_uncorrected)} / {k}")
for _, row in sig_uncorrected.iterrows():
    print(f"  {row['strategy']:>12}  t={row['t_stat']:+.4f}  p={row['p_value']:.6f}")

# â”€â”€ Bonferroni correction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
bonf_alpha = alpha / k
df["bonferroni_reject"] = df["p_value"] < bonf_alpha
print(f"\\n{'=' * 80}")
print(f"BONFERRONI CORRECTION (threshold = alpha/k = {bonf_alpha:.6f})")
print("-" * 80)
sig_bonf = df[df["bonferroni_reject"]]
print(f"Surviving strategies: {len(sig_bonf)} / {k}")
for _, row in sig_bonf.iterrows():
    print(f"  {row['strategy']:>12}  p={row['p_value']:.6f} < {bonf_alpha:.6f}")

# â”€â”€ Benjamini-Hochberg FDR procedure (step by step) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

# â”€â”€ Summary comparison â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print(f"\\n{'=' * 80}")
print("SUMMARY: How many strategies survive each method?")
print(f"  Uncorrected (alpha={alpha}):     {len(sig_uncorrected)}")
print(f"  Bonferroni (alpha/k={bonf_alpha:.4f}): {len(sig_bonf)}")
print(f"  Benjamini-Hochberg (FDR={alpha}):  {len(sig_bh)}")
print("=" * 80)

# â”€â”€ Bootstrap test for the best strategy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                    { id: "found-ht-q1-b", text: "If Hâ‚€ (no edge) were true, there is a 3% probability of observing a test statistic this extreme or more" },
                    { id: "found-ht-q1-c", text: "There is a 97% probability the strategy will be profitable in live trading" },
                    { id: "found-ht-q1-d", text: "The strategy's expected return is 0.03 per trade" },
                  ],
                  correctOptionId: "found-ht-q1-b",
                  explanation:
                    "The p-value is the probability of observing a test statistic at least as extreme as the one computed, assuming Hâ‚€ is true. It is NOT the probability that Hâ‚€ is true or false â€” that would require Bayesian analysis with a prior distribution. It is also not the probability of future profitability, which depends on regime stability, transaction costs, and market microstructure changes.",
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
                    "A Type I error means you reject Hâ‚€ when it is actually true â€” you deploy a strategy that has no genuine edge, losing real capital plus transaction costs. A Type II error means you fail to reject Hâ‚€ when the strategy actually works â€” you miss a profit opportunity. In trading, Type I errors are generally more costly because deploying capital on a non-existent edge produces guaranteed losses from spreads and commissions, whereas a Type II error only means an opportunity cost.",
                },
                {
                  id: "found-ht-q3",
                  question:
                    "A MA crossover strategy on EUR/USD yields n = 200 trades, mean return XÌ„ = 0.0003, and sample standard deviation s = 0.008. Compute the t-statistic and determine significance at Î± = 0.05.",
                  options: [
                    { id: "found-ht-q3-a", text: "t = 0.530, p â‰ˆ 0.298 (one-tailed). Not significant â€” fail to reject Hâ‚€." },
                    { id: "found-ht-q3-b", text: "t = 3.75, p < 0.001 (one-tailed). Highly significant â€” reject Hâ‚€." },
                    { id: "found-ht-q3-c", text: "t = 0.0375, p â‰ˆ 0.485 (one-tailed). Not significant â€” fail to reject Hâ‚€." },
                    { id: "found-ht-q3-d", text: "t = 5.30, p < 0.0001 (one-tailed). Extremely significant â€” reject Hâ‚€." },
                  ],
                  correctOptionId: "found-ht-q3-a",
                  explanation:
                    "SEM = s / âˆšn = 0.008 / âˆš200 = 0.008 / 14.142 = 0.000566. Then t = (XÌ„ âˆ’ 0) / SEM = 0.0003 / 0.000566 = 0.530. With df = 199, the one-tailed p-value P(T â‰¥ 0.530) â‰ˆ 0.298, which is far above Î± = 0.05. The 95% confidence interval (âˆ’0.00082, 0.00142) contains zero, confirming the failure to reject Hâ‚€.",
                },
                {
                  id: "found-ht-q4",
                  question:
                    "Given n = 200, XÌ„ = 0.0003, s = 0.008, what is Cohen's d and what does it tell you about the practical significance of the strategy?",
                  options: [
                    { id: "found-ht-q4-a", text: "d = 0.530 â€” a medium effect size, suggesting meaningful practical significance." },
                    { id: "found-ht-q4-b", text: "d = 0.0375 â€” a negligible effect size, meaning even if statistically significant with more data, the edge is too tiny to be practical after transaction costs." },
                    { id: "found-ht-q4-c", text: "d = 3.75 â€” a very large effect size, indicating a strong trading edge." },
                    { id: "found-ht-q4-d", text: "d cannot be computed without knowing the population standard deviation Ïƒ." },
                  ],
                  correctOptionId: "found-ht-q4-b",
                  explanation:
                    "Cohen's d = (XÌ„ âˆ’ Î¼â‚€) / s = 0.0003 / 0.008 = 0.0375. This is far below the conventional 'small' threshold of 0.2. It means the signal-to-noise ratio per trade is terrible: the average return is only 3.75% of one standard deviation. Even with a massive sample (say, 100,000 trades) that yields statistical significance, the actual per-trade edge of 0.03% would likely be consumed by spreads and commissions.",
                },
                {
                  id: "found-ht-q5",
                  question:
                    "You test 20 strategy variants at Î± = 0.05. Sorted p-values include pâ‚â‚â‚Ž = 0.002, pâ‚â‚‚â‚Ž = 0.008, pâ‚â‚ƒâ‚Ž = 0.021, pâ‚â‚„â‚Ž = 0.039, pâ‚â‚…â‚Ž = 0.048. Under Benjamini-Hochberg, how many are rejected?",
                  options: [
                    { id: "found-ht-q5-a", text: "5 (all with p < 0.05)" },
                    { id: "found-ht-q5-b", text: "2 (only pâ‚â‚â‚Ž and pâ‚â‚‚â‚Ž survive Bonferroni at 0.0025)" },
                    { id: "found-ht-q5-c", text: "4 (BH thresholds: 0.0025, 0.005, 0.0075, 0.01, 0.0125 â€” only ranks 1-2 pass their thresholds, so reject 2)" },
                    { id: "found-ht-q5-d", text: "3 (BH thresholds: i/20 Ã— 0.05 gives 0.0025, 0.005, 0.0075, 0.01, 0.0125 â€” pâ‚â‚â‚Ž=0.002 â‰¤ 0.0025 âœ“, pâ‚â‚‚â‚Ž=0.008 > 0.005 âœ—, so largest passing i=1, reject 1)" },
                  ],
                  correctOptionId: "found-ht-q5-d",
                  explanation:
                    "The BH thresholds for k=20 at Î±=0.05 are (i/20)Â·0.05: rank 1 â†’ 0.0025, rank 2 â†’ 0.005, rank 3 â†’ 0.0075, rank 4 â†’ 0.01, rank 5 â†’ 0.0125. Check: pâ‚â‚â‚Ž=0.002 â‰¤ 0.0025 âœ“, pâ‚â‚‚â‚Ž=0.008 > 0.005 âœ—. The largest rank passing is i=1, so only the first hypothesis is rejected. This shows that with many tests, even BH can be quite strict â€” and Bonferroni would also reject only rank 1 (0.002 < 0.0025).",
                },
                {
                  id: "found-ht-q6",
                  question:
                    "A one-tailed t-test at Î± = 0.05 has 40% power (Î² = 0.60) with n = 500 trades. What happens to the power if you double the sample size to n = 1000?",
                  options: [
                    { id: "found-ht-q6-a", text: "Power doubles to 80% because power scales linearly with n." },
                    { id: "found-ht-q6-b", text: "Power increases but not to 80% â€” the non-centrality parameter grows as dÂ·âˆšn, so power increases sub-linearly. It would reach roughly 55-65%." },
                    { id: "found-ht-q6-c", text: "Power stays at 40% because it depends only on effect size, not sample size." },
                    { id: "found-ht-q6-d", text: "Power decreases because a larger sample makes the test more conservative." },
                  ],
                  correctOptionId: "found-ht-q6-b",
                  explanation:
                    "Power depends on the non-centrality parameter Î´ = dÂ·âˆšn. Doubling n multiplies âˆšn by âˆš2 â‰ˆ 1.414, not 2. The non-centrality parameter increases by ~41%, which pushes the non-central t-distribution further from zero and increases the rejection probability â€” but the relationship between Î´ and power follows the CDF of the non-central t, which is nonlinear. The exact power depends on d and df, but it would typically increase from 40% to roughly 55-65%, not 80%.",
                },
              ],
            },
            {
              type: "practice",
              title: "Multiple Strategy Testing with Corrections",
              description:
                "Test 15 different moving-average crossover period combinations (fast âˆˆ {5, 10, 15, 20, 25} Ã— slow âˆˆ {30, 50, 100}) on EUR/USD hourly data. For each combination: (1) Compute the MA crossover signals and per-bar strategy returns. (2) Run a one-sample t-test (Hâ‚€: Î¼ = 0, one-tailed Hâ‚: Î¼ > 0). (3) Record the p-value, t-statistic, mean return, and Cohen's d. Collect all 15 p-values into a single array. Apply Bonferroni correction (Î±_corrected = 0.05/15 = 0.00333). Apply the Benjamini-Hochberg procedure step by step: sort p-values, compute BH thresholds (i/15)Â·0.05 for each rank i, find the largest rank where pâ‚áµ¢â‚Ž â‰¤ threshold. Compare: how many strategies survive uncorrected, Bonferroni, and BH? For the strategy with the smallest p-value, run a bootstrap hypothesis test (B = 5,000 resamples) and compare the bootstrap p-value with the parametric p-value. Reflect on whether the parametric assumption of normality matters for your data.",
            },
            {
              type: "practice",
              title: "Dashboard Exercise: Strategy Hypothesis Testing",
              description:
                "Open the dashboard's Strategy Evaluation page and select a EUR/USD MA crossover strategy. (1) Locate the hypothesis test panel: verify that the reported t-statistic matches the manual formula t = XÌ„ / (s/âˆšn) using the displayed mean return, standard deviation, and trade count. (2) Examine the p-value visualization â€” identify the shaded tail area under the t-distribution curve and confirm it corresponds to the reported p-value. (3) Check the effect size (Cohen's d) â€” is the edge practically meaningful or only statistically significant due to large n? (4) If the dashboard supports multiple strategy comparison, run 5-10 parameter variants and observe how Bonferroni and BH corrections affect which strategies are flagged as significant. (5) Toggle between parametric (t-test) and bootstrap test modes if available â€” do the conclusions change? Note any strategies where the parametric and bootstrap p-values disagree, and investigate whether the return distribution for those strategies is particularly non-Normal (check skewness and kurtosis in the distribution panel).",
            },
          ],
        },
        {
          id: "found-correlation-regression",
          title: "Correlation & Regression in Markets",
          description:
            "Derive Pearson and Spearman correlation from first principles, build OLS regression via calculus, decompose RÂ², and master residual diagnostics (heteroskedasticity, autocorrelation) for modeling factor relationships in forex markets.",
          estimatedMinutes: 90,
          difficulty: "beginner",
          prerequisites: ["found-descriptive-stats"],
          sections: [
            {
              type: "objective",
              content:
                "After this lesson you will be able to derive and compute Pearson and Spearman correlation coefficients from scratch, identify and explain spurious correlations caused by non-stationarity, derive OLS estimators via calculus, decompose total variance into explained and residual components, and diagnose regression residuals for heteroskedasticity and autocorrelation using formal statistical tests.",
              keyTakeaways: [
                "Derive Pearson Ï = Cov(X,Y)/(Ïƒâ‚“Ïƒáµ§) from the covariance definition and prove Ï âˆˆ [âˆ’1, 1] via the Cauchy-Schwarz inequality",
                "Execute the Spearman rank correlation procedure step-by-step: rank both variables, compute Pearson on ranks, apply the shortcut formula Ïâ‚› = 1 âˆ’ 6Î£dáµ¢Â²/(n(nÂ²âˆ’1)) when no ties exist",
                "Demonstrate that two independent random walks produce spurious correlation (high |Ï|) due to non-stationarity, and resolve it by differencing to returns",
                "Derive OLS estimators Î²â‚ = Î£(xáµ¢âˆ’xÌ„)(yáµ¢âˆ’È³)/Î£(xáµ¢âˆ’xÌ„)Â² and Î²â‚€ = È³ âˆ’ Î²â‚xÌ„ by minimizing SSE via partial derivatives and solving the normal equations",
                "Decompose total sum of squares: SST = SSR + SSE, and define RÂ² = 1 âˆ’ SSE/SST = SSR/SST, proving RÂ² = ÏÂ² for simple linear regression",
                "Detect heteroskedasticity using the Breusch-Pagan test: regress squared residuals on the regressors and test the joint significance with a Ï‡Â² statistic",
                "Derive the Durbin-Watson statistic DW = Î£(Îµâ‚œâˆ’Îµâ‚œâ‚‹â‚)Â²/Î£Îµâ‚œÂ² and show DW â‰ˆ 2(1âˆ’Ïâ‚), interpreting DW â‰ˆ 2 as no autocorrelation, DW â†’ 0 as positive, DW â†’ 4 as negative",
              ],
            },
            {
              type: "theory",
              title: "Pearson Correlation: Derivation from Covariance",
              content:
                "The **covariance** between two random variables X and Y is defined as Cov(X, Y) = E[(X âˆ’ Î¼â‚“)(Y âˆ’ Î¼áµ§)], where Î¼â‚“ = E[X] and Î¼áµ§ = E[Y]. Expanding, Cov(X, Y) = E[XY] âˆ’ Î¼â‚“Î¼áµ§. Covariance captures the direction of linear association: positive when X and Y tend to deviate from their means in the same direction, negative when they deviate in opposite directions. However, covariance is unbounded and depends on the units of X and Y, making it unsuitable for comparison across different variable pairs. The **Pearson correlation coefficient** Ï standardizes covariance by dividing by the product of standard deviations: Ï = Cov(X, Y) / (Ïƒâ‚“ Â· Ïƒáµ§), where Ïƒâ‚“ = âˆšVar(X) and Ïƒáµ§ = âˆšVar(Y). This yields a dimensionless measure. To prove Ï âˆˆ [âˆ’1, 1], we invoke the **Cauchy-Schwarz inequality**: |E[AB]|Â² â‰¤ E[AÂ²] Â· E[BÂ²] for any random variables A, B. Setting A = X âˆ’ Î¼â‚“ and B = Y âˆ’ Î¼áµ§ gives |Cov(X, Y)|Â² â‰¤ Var(X) Â· Var(Y), so |Ï| = |Cov(X, Y)| / (Ïƒâ‚“Ïƒáµ§) â‰¤ 1. Equality holds if and only if Y = aX + b for constants a, b â€” perfect linear dependence.\n\nA critical subtlety: **Ï = 0 does not imply independence**. Consider X ~ N(0, 1) and Y = XÂ². Then Cov(X, Y) = E[X Â· XÂ²] âˆ’ E[X] Â· E[XÂ²] = E[XÂ³] âˆ’ 0 Â· 1 = 0 (since the third moment of a symmetric distribution is zero), so Ï = 0 despite Y being entirely determined by X. This is because Pearson only detects **linear** association. In financial markets this matters: a volatility measure and its underlying return may have Ï â‰ˆ 0 while being strongly dependent through a quadratic relationship. The **sampling distribution** of the sample correlation r from n observations follows a complex distribution under Hâ‚€: Ï = 0, but the **Fisher z-transform** z = 0.5 Â· ln((1 + r) / (1 âˆ’ r)) is approximately Normal with mean 0.5 Â· ln((1 + Ï) / (1 âˆ’ Ï)) and standard error 1/âˆš(n âˆ’ 3). This transform is essential for constructing confidence intervals and testing hypotheses about Ï.\n\n**Numerical example**: Consider 5 bars of EUR/USD and GBP/USD hourly returns (in basis points): X = [+12, âˆ’8, +5, âˆ’3, +10] and Y = [+9, âˆ’6, +7, âˆ’1, +8]. First compute means: xÌ„ = (12 âˆ’ 8 + 5 âˆ’ 3 + 10)/5 = 3.2, È³ = (9 âˆ’ 6 + 7 âˆ’ 1 + 8)/5 = 3.4. Deviations from mean: (X âˆ’ xÌ„) = [8.8, âˆ’11.2, 1.8, âˆ’6.2, 6.8], (Y âˆ’ È³) = [5.6, âˆ’9.4, 3.6, âˆ’4.4, 4.6]. Products: [49.28, 105.28, 6.48, 27.28, 31.28]. Cov(X, Y) = (49.28 + 105.28 + 6.48 + 27.28 + 31.28)/5 = 219.60/5 = 43.92. Sum of squared deviations: Î£(X âˆ’ xÌ„)Â² = 77.44 + 125.44 + 3.24 + 38.44 + 46.24 = 290.80, so Ïƒâ‚“ = âˆš(290.80/5) = âˆš58.16 = 7.626. Î£(Y âˆ’ È³)Â² = 31.36 + 88.36 + 12.96 + 19.36 + 21.16 = 173.20, so Ïƒáµ§ = âˆš(173.20/5) = âˆš34.64 = 5.886. Therefore Ï = 43.92 / (7.626 Ã— 5.886) = 43.92 / 44.887 = **0.9784** â€” a very strong positive linear correlation, consistent with both pairs being driven by USD.",
            },
            {
              type: "theory",
              title: "Spearman Rank Correlation & Spurious Correlation",
              content:
                "The **Spearman rank correlation** Ïâ‚› is computed by a three-step procedure: (1) Replace each value of X and Y with its rank within its own sample (smallest value gets rank 1). (2) Compute the Pearson correlation on these ranks. When there are **no tied values**, an algebraic shortcut exists: Ïâ‚› = 1 âˆ’ 6Î£dáµ¢Â² / (n(nÂ² âˆ’ 1)), where dáµ¢ = rank(xáµ¢) âˆ’ rank(yáµ¢) is the rank difference for observation i. When **ties exist**, assign the average of the tied ranks (e.g., two values sharing ranks 3 and 4 both receive rank 3.5) and compute Pearson on the averaged ranks directly â€” the shortcut formula is no longer exact. Spearman captures any **monotonic** relationship (not just linear) and is robust to outliers because it operates on ranks rather than raw values. An extreme return of âˆ’500 bps that would heavily distort Pearson simply receives rank 1 in Spearman. In forex, where fat-tailed distributions produce occasional extreme moves, Spearman often gives a more stable and interpretable measure of association than Pearson.\n\n**Spurious correlation** is one of the most dangerous pitfalls in financial analysis, and it arises primarily from **non-stationarity**. A time series is non-stationary if its statistical properties (mean, variance) change over time â€” price series are the canonical example because they trend. Consider generating two **independent random walks**: Pâ‚œ = Pâ‚œâ‚‹â‚ + Îµâ‚œ and Qâ‚œ = Qâ‚œâ‚‹â‚ + Î·â‚œ where Îµâ‚œ and Î·â‚œ are independent white noise. Despite zero causal relationship, computing Pearson Ï between Pâ‚œ and Qâ‚œ over a long window frequently yields |Ï| > 0.7. This happens because both series wander away from their starting points, creating apparent trends that look correlated. The correlation is entirely an artifact of the shared stochastic trending behavior. The solution is to **difference** the series: compute returns râ‚œ = Pâ‚œ âˆ’ Pâ‚œâ‚‹â‚ (or log-returns for multiplicative series). Returns are typically stationary, and Ï computed on returns reflects genuine co-movement. As a rule: **never compute correlation on price levels** in financial analysis.\n\nBeyond non-stationarity, spurious correlation also arises from **confounding variables** (a third variable driving both X and Y) and from **multiple testing** (testing many pairs guarantees some will appear correlated by chance). **Granger causality** offers a more rigorous framework: X Granger-causes Y if past values of X help predict Y beyond Y's own past values. However, Granger causality is still about prediction, not true causation â€” it cannot distinguish between X causing Y and both being driven by an unobserved confounder Z that affects X before Y. In forex, if EUR/USD and GBP/USD returns are correlated, the true driver is usually USD strength â€” neither pair 'causes' the other; both respond to the same underlying dollar factor.",
            },
            {
              type: "theory",
              title: "OLS Linear Regression: Derivation via Calculus",
              content:
                "The **simple linear regression model** posits Y = Î²â‚€ + Î²â‚X + Îµ, where Î²â‚€ is the intercept, Î²â‚ is the slope, and Îµ is the error term. Given n observations {(xâ‚, yâ‚), â€¦, (xâ‚™, yâ‚™)}, we seek Î²â‚€ and Î²â‚ that minimize the **sum of squared errors** SSE = Î£áµ¢â‚Œâ‚â¿ (yáµ¢ âˆ’ Î²â‚€ âˆ’ Î²â‚xáµ¢)Â². To find the minimum, take partial derivatives and set them to zero. First: âˆ‚SSE/âˆ‚Î²â‚€ = âˆ’2Î£(yáµ¢ âˆ’ Î²â‚€ âˆ’ Î²â‚xáµ¢) = 0, which simplifies to Î£yáµ¢ = nÎ²â‚€ + Î²â‚Î£xáµ¢, giving **Î²â‚€ = È³ âˆ’ Î²â‚xÌ„** (the regression line passes through the point of means). Second: âˆ‚SSE/âˆ‚Î²â‚ = âˆ’2Î£xáµ¢(yáµ¢ âˆ’ Î²â‚€ âˆ’ Î²â‚xáµ¢) = 0. Substituting Î²â‚€ = È³ âˆ’ Î²â‚xÌ„ and simplifying: Î£(xáµ¢ âˆ’ xÌ„)(yáµ¢ âˆ’ È³) = Î²â‚Î£(xáµ¢ âˆ’ xÌ„)Â², so **Î²â‚ = Î£(xáµ¢ âˆ’ xÌ„)(yáµ¢ âˆ’ È³) / Î£(xáµ¢ âˆ’ xÌ„)Â²**. Notice that Î²â‚ = Cov(X, Y) / Var(X) â€” the slope is the covariance divided by the variance of the predictor. These are the **normal equations** of OLS, and they yield the Best Linear Unbiased Estimator (BLUE) under the Gauss-Markov assumptions.\n\nThe total variability in Y decomposes as **SST = SSR + SSE**, where SST = Î£(yáµ¢ âˆ’ È³)Â² is the total sum of squares, SSR = Î£(Å·áµ¢ âˆ’ È³)Â² is the regression (explained) sum of squares, and SSE = Î£(yáµ¢ âˆ’ Å·áµ¢)Â² is the residual (unexplained) sum of squares. The **coefficient of determination** RÂ² = 1 âˆ’ SSE/SST = SSR/SST measures the fraction of total variance explained by the model. For simple linear regression (one predictor), **RÂ² = ÏÂ²** â€” the square of the Pearson correlation between X and Y. This is elegant: the explanatory power of a simple regression is entirely determined by the linear correlation. **Adjusted RÂ²** = 1 âˆ’ (1 âˆ’ RÂ²)(n âˆ’ 1)/(n âˆ’ p âˆ’ 1) penalizes for extra predictors (p = number of predictors), preventing artificial inflation of RÂ² by adding irrelevant variables. The **standard error** of Î²â‚ is SE(Î²â‚) = âˆš[ÏƒÌ‚Â² / Î£(xáµ¢ âˆ’ xÌ„)Â²], where ÏƒÌ‚Â² = SSE/(n âˆ’ 2) is the estimated residual variance. The t-statistic t = Î²â‚ / SE(Î²â‚) tests Hâ‚€: Î²â‚ = 0.\n\n**Numerical example**: Using our 5-bar returns X = [+12, âˆ’8, +5, âˆ’3, +10] (EUR/USD) and Y = [+9, âˆ’6, +7, âˆ’1, +8] (GBP/USD) from the previous section: xÌ„ = 3.2, È³ = 3.4. We already computed Î£(xáµ¢ âˆ’ xÌ„)(yáµ¢ âˆ’ È³) = 219.60 and Î£(xáµ¢ âˆ’ xÌ„)Â² = 290.80. So Î²â‚ = 219.60 / 290.80 = **0.7551** and Î²â‚€ = 3.4 âˆ’ 0.7551 Ã— 3.2 = 3.4 âˆ’ 2.416 = **0.984**. The fitted model is Å· = 0.984 + 0.7551x. Predictions: Å· = [10.05, âˆ’5.06, 4.76, âˆ’1.28, 8.54]. Residuals: e = [âˆ’1.05, âˆ’0.94, 2.24, 0.28, âˆ’0.54]. SSE = 1.10 + 0.88 + 5.02 + 0.08 + 0.29 = 7.37. SST = Î£(yáµ¢ âˆ’ È³)Â² = 173.20. RÂ² = 1 âˆ’ 7.37/173.20 = **0.9574**. Check: ÏÂ² = 0.9784Â² = 0.9573 âœ“. ÏƒÌ‚Â² = 7.37/(5 âˆ’ 2) = 2.457. SE(Î²â‚) = âˆš(2.457/290.80) = âˆš0.00845 = 0.0919. t = 0.7551/0.0919 = 8.21, highly significant even with n = 5.",
            },
            {
              type: "theory",
              title: "Residual Diagnostics: Heteroskedasticity & Autocorrelation",
              content:
                "The classical OLS assumptions on the error term Îµ are: (1) **E[Îµ] = 0** â€” errors have zero mean; (2) **Var(Îµ) = ÏƒÂ²** â€” constant variance (**homoskedasticity**); (3) **Cov(Îµâ‚œ, Îµâ‚›) = 0** for t â‰  s â€” no **autocorrelation**; (4) Îµ is independent of X. When these assumptions hold, OLS is BLUE (Best Linear Unbiased Estimator) by the Gauss-Markov theorem. Violations don't necessarily bias the coefficient estimates Î²â‚€ and Î²â‚, but they invalidate the standard errors, t-statistics, and confidence intervals â€” meaning your hypothesis tests become unreliable.\n\n**Heteroskedasticity** occurs when Var(Îµ | X) varies with X. In forex, the variance of GBP/USD returns conditional on EUR/USD returns might be larger for extreme EUR/USD moves (a 'fan' shape in the scatter plot). The **Breusch-Pagan test** detects this formally: (1) Run OLS and obtain residuals eáµ¢. (2) Compute squared residuals eáµ¢Â². (3) Regress eáµ¢Â² on the original regressors X (auxiliary regression). (4) The test statistic is BP = n Â· RÂ²_aux, which follows a Ï‡Â²(p) distribution under Hâ‚€: homoskedasticity, where p is the number of regressors. If BP exceeds the critical value (e.g., Ï‡Â²â‚€.â‚€â‚…(1) = 3.84 for one regressor), reject homoskedasticity. Consequences: OLS estimates remain unbiased and consistent, but they are **inefficient** (no longer minimum variance) and standard errors are biased â€” typically underestimated, leading to inflated t-statistics and false significance. The remedy is to use **heteroskedasticity-consistent standard errors** (White/HC standard errors) or **weighted least squares** (WLS).\n\n**Autocorrelation** in residuals means Cov(Îµâ‚œ, Îµâ‚›) â‰  0, commonly arising in time-series data where the model misses a time-dependent pattern. The **Durbin-Watson statistic** is DW = Î£â‚œâ‚Œâ‚‚â¿ (eâ‚œ âˆ’ eâ‚œâ‚‹â‚)Â² / Î£â‚œâ‚Œâ‚â¿ eâ‚œÂ². To understand its behavior, expand the numerator: Î£(eâ‚œ âˆ’ eâ‚œâ‚‹â‚)Â² = Î£eâ‚œÂ² + Î£eâ‚œâ‚‹â‚Â² âˆ’ 2Î£eâ‚œeâ‚œâ‚‹â‚ â‰ˆ 2Î£eâ‚œÂ² âˆ’ 2Î£eâ‚œeâ‚œâ‚‹â‚ (for large n). Dividing by Î£eâ‚œÂ²: DW â‰ˆ 2 âˆ’ 2(Î£eâ‚œeâ‚œâ‚‹â‚/Î£eâ‚œÂ²) = **2(1 âˆ’ ÏÌ‚â‚)**, where ÏÌ‚â‚ = Î£eâ‚œeâ‚œâ‚‹â‚/Î£eâ‚œÂ² is the estimated lag-1 autocorrelation of residuals. Therefore: **DW â‰ˆ 2** when ÏÌ‚â‚ â‰ˆ 0 (no autocorrelation), **DW â†’ 0** when ÏÌ‚â‚ â†’ 1 (strong positive autocorrelation â€” residuals persist in the same direction), and **DW â†’ 4** when ÏÌ‚â‚ â†’ âˆ’1 (strong negative autocorrelation â€” residuals alternate signs). The Durbin-Watson test has an inconclusive region between lower bound dâ‚— and upper bound dáµ¤ (which depend on n and p). Typical decision rules for Î± = 0.05 with n = 100 and p = 1: dâ‚— â‰ˆ 1.65, dáµ¤ â‰ˆ 1.69. If DW < dâ‚—, reject Hâ‚€ (positive autocorrelation); if DW > dáµ¤, do not reject; if dâ‚— â‰¤ DW â‰¤ dáµ¤, the test is inconclusive. For the upper tail (negative autocorrelation), test 4 âˆ’ DW against the same bounds. In forex regression, DW values around 1.8â€“2.2 are typical for well-specified models on return data; DW below 1.5 signals missing time-series structure.",
            },
            {
              type: "intuition",
              title: "The Ice Cream & Drowning Analogy",
              analogy:
                "Correlation â‰  causation â€” ice cream sales and drowning deaths are correlated because both are driven by a hidden confounder: summer heat. Understanding confounders, omitted variable bias, and the difference between correlation on prices vs returns is essential for avoiding false conclusions in trading.",
              content:
                "Ice cream sales and drowning deaths both spike in summer. If you computed their Pearson correlation, you'd find Ï â‰ˆ 0.8. Should we ban ice cream to prevent drownings? Obviously not â€” **temperature** is the **confounder** driving both. This illustrates **omitted variable bias**: if you regress drownings on ice cream sales (omitting temperature), the coefficient on ice cream absorbs temperature's effect, producing a spuriously significant relationship. The bias formula is: Î²Ì‚â‚_biased = Î²â‚_true + Î²â‚‚ Â· Î´, where Î²â‚‚ is the effect of the omitted variable (temperature) on Y (drownings) and Î´ is the coefficient from regressing the omitted variable on X (ice cream). Since both Î²â‚‚ and Î´ are positive, the bias is upward.\n\nIn forex, **EUR/USD and GBP/USD** often show Ï > 0.7 on returns because both are driven by **USD strength** â€” the confounder. If you include EUR/USD returns and GBP/USD returns as separate features in a model, you may think both contribute independent information, but they're largely measuring the same thing: the USD factor. Regressing one on the other and checking RÂ² reveals the redundancy. A more insidious version arises when computing correlation on **price levels** rather than **returns**. Two independent random walks (e.g., simulated EUR/USD and AUD/NZD prices) will show |Ï| > 0.8 over a long window simply because both trend â€” this is the **spurious regression problem** identified by Granger and Newbold (1974). The solution is always to compute correlation on **stationary** series (returns, log-returns, or properly differenced data). And always check residuals: if DW is far from 2, your regression is missing a time-dependent pattern, and the 'significant' relationship may be an artifact of autocorrelated errors inflating the t-statistics.",
              emoji: "ðŸ¦",
            },
            {
              type: "intuition",
              title: "The GPS Navigation Analogy",
              analogy:
                "Linear regression is like GPS predicting your arrival time based on distance â€” the slope is your speed, the intercept is startup delay, RÂ² measures how well distance alone explains travel time, and residual patterns reveal systematic errors in the model.",
              content:
                "Imagine your GPS predicting arrival time (Y) based on distance (X). The regression equation Å· = Î²â‚€ + Î²â‚x works just like the GPS formula: **Î²â‚ is your average speed** (minutes per kilometer), **Î²â‚€ is the fixed startup delay** (time to leave the driveway, regardless of distance), and **RÂ² measures how well distance alone predicts travel time**. If you only drive on empty highways, RÂ² â‰ˆ 0.99 â€” distance perfectly predicts time. But add city traffic, and RÂ² drops because the **residuals** (actual minus predicted time) become large and variable. Those residuals represent everything the model doesn't capture: traffic lights, weather, road construction.\n\nNow consider the residual patterns. If your GPS consistently underestimates long trips and overestimates short ones, the residuals are **heteroskedastic** â€” prediction error grows with distance. This is exactly what the Breusch-Pagan test detects: the variance of your 'surprise' (residual) depends on X. Your GPS's confidence intervals should be wider for longer trips, but if it assumes constant error (homoskedasticity), it will be overconfident on long trips and wastefully cautious on short ones. If your GPS also underestimates every Monday morning and overestimates every Sunday â€” sequential residuals are correlated â€” that's **autocorrelation**, and DW would be far from 2. The fix is to add 'day of week' to the model, just as in forex we add lagged variables or regime indicators to capture time-dependent structure the simple model misses.",
              emoji: "ðŸ—ºï¸",
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
                "This code implements Pearson and Spearman correlation entirely from scratch, showing every intermediate computation: means, covariance, standard deviations, ranks, and rank differences. The Fisher z-transform constructs a 95% confidence interval for the true correlation. The Spearman section demonstrates both the shortcut formula (no ties) and the general Pearson-on-ranks approach. Finally, the spurious correlation demonstration generates two independent random walks and shows that price-level correlation is highly misleading (|Ï| often > 0.5) while return-level correlation correctly shows near-zero association.",
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
    print("DW is near 2 â€” no strong evidence of residual autocorrelation.")

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
    print("\\n(statsmodels not installed â€” manual results verified above)")`,
              explanation:
                "This code derives OLS estimates entirely from the normal equations â€” no libraries needed for the core computation. It then performs the full RÂ² decomposition (SST = SSR + SSE), verifies RÂ² = ÏÂ², computes coefficient standard errors and t-statistics, runs the Durbin-Watson test (both exact formula and the 2(1âˆ’Ïâ‚) approximation), and applies the Breusch-Pagan test for heteroskedasticity. Finally, all manual results are cross-checked against statsmodels to confirm correctness.",
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
print(f"\\nRolling Pearson  â€” mean: {roll_pearson.mean():.4f}, "
      f"min: {roll_pearson.min():.4f}, max: {roll_pearson.max():.4f}")
print(f"Rolling Spearman â€” mean: {roll_spearman_s.mean():.4f}, "
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
                "This code computes rolling 100-bar Pearson and Spearman correlations between simulated EUR/USD and GBP/USD returns that contain two distinct regimes: high correlation (Ï â‰ˆ 0.8) and low correlation (Ï â‰ˆ 0.2). It classifies each bar into a regime based on the rolling correlation level, detects 'breakdown' events where correlation drops sharply, and compares full-sample versus regime-specific statistics. The key insight is that a single full-sample correlation (e.g., Ï = 0.5) can mask dramatically different regime-dependent behavior â€” critical for risk management and pairs trading strategies.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "found-cr-q1",
                  question:
                    "If X ~ N(0,1) and Y = XÂ², what is the Pearson correlation Ï(X, Y)?",
                  options: [
                    { id: "found-cr-q1-a", text: "Ï = 1.0 because Y is entirely determined by X" },
                    { id: "found-cr-q1-b", text: "Ï = 0.5 because the relationship is non-linear" },
                    { id: "found-cr-q1-c", text: "Ï = 0 because Cov(X, XÂ²) = E[XÂ³] = 0 for symmetric distributions, but X and Y are NOT independent" },
                    { id: "found-cr-q1-d", text: "Ï is undefined for non-linear relationships" },
                  ],
                  correctOptionId: "found-cr-q1-c",
                  explanation:
                    "Cov(X, XÂ²) = E[X Â· XÂ²] âˆ’ E[X] Â· E[XÂ²] = E[XÂ³] âˆ’ 0 Â· 1 = 0, because the third moment of any symmetric distribution (like the standard Normal) is zero. Therefore Ï = 0 despite Y = XÂ² being a deterministic function of X. This proves that Pearson correlation only detects linear association â€” Ï = 0 does NOT imply independence.",
                },
                {
                  id: "found-cr-q2",
                  question:
                    "Two independent random walks of length 500 show Pearson Ï = 0.73 on their price levels. Why is this correlation misleading?",
                  options: [
                    { id: "found-cr-q2-a", text: "The sample size is too small for a reliable estimate" },
                    { id: "found-cr-q2-b", text: "Random walks are non-stationary â€” trending series produce spurious high correlations even when the underlying innovations are completely independent" },
                    { id: "found-cr-q2-c", text: "Pearson correlation cannot handle negative values in the data" },
                    { id: "found-cr-q2-d", text: "The correlation is genuine and reflects shared structure in the random number generator" },
                  ],
                  correctOptionId: "found-cr-q2-b",
                  explanation:
                    "Non-stationary series (like random walks) drift over time, creating apparent trends. Two independent random walks will frequently show |Ï| > 0.5 on price levels despite zero causal relationship. This is the 'spurious regression' problem identified by Granger and Newbold (1974). The solution is to compute correlation on returns (first differences), which are stationary.",
                },
                {
                  id: "found-cr-q3",
                  question:
                    "Given Cov(X, Y) = 24.5 and Var(X) = 49.0, what is the OLS slope coefficient Î²â‚?",
                  options: [
                    { id: "found-cr-q3-a", text: "Î²â‚ = 49.0 / 24.5 = 2.0" },
                    { id: "found-cr-q3-b", text: "Î²â‚ = 24.5 / 49.0 = 0.5" },
                    { id: "found-cr-q3-c", text: "Î²â‚ = 24.5 Ã— 49.0 = 1200.5" },
                    { id: "found-cr-q3-d", text: "Î²â‚ = âˆš(24.5 / 49.0) = 0.707" },
                  ],
                  correctOptionId: "found-cr-q3-b",
                  explanation:
                    "The OLS slope is Î²â‚ = Cov(X, Y) / Var(X) = 24.5 / 49.0 = 0.5. This follows directly from the normal equations derived by minimizing SSE via calculus. The slope equals the covariance of X and Y divided by the variance of X, which measures how much Y changes per unit change in X.",
                },
                {
                  id: "found-cr-q4",
                  question:
                    "A regression produces SST = 800 and SSE = 200. What is RÂ²?",
                  options: [
                    { id: "found-cr-q4-a", text: "RÂ² = 200/800 = 0.25" },
                    { id: "found-cr-q4-b", text: "RÂ² = 1 âˆ’ 200/800 = 0.75" },
                    { id: "found-cr-q4-c", text: "RÂ² = 800/200 = 4.0" },
                    { id: "found-cr-q4-d", text: "RÂ² = (800 âˆ’ 200)/200 = 3.0" },
                  ],
                  correctOptionId: "found-cr-q4-b",
                  explanation:
                    "RÂ² = 1 âˆ’ SSE/SST = 1 âˆ’ 200/800 = 0.75. Equivalently, RÂ² = SSR/SST = (SST âˆ’ SSE)/SST = 600/800 = 0.75. This means 75% of the total variance in Y is explained by the regression model, while 25% remains unexplained (residual variance).",
                },
                {
                  id: "found-cr-q5",
                  question:
                    "A Durbin-Watson statistic of DW = 0.8 is computed from a regression on hourly forex returns. What does this indicate?",
                  options: [
                    { id: "found-cr-q5-a", text: "Strong negative autocorrelation in the residuals" },
                    { id: "found-cr-q5-b", text: "No autocorrelation â€” the model is well-specified" },
                    { id: "found-cr-q5-c", text: "Strong positive autocorrelation in the residuals â€” the model is missing time-dependent structure, and standard errors are likely biased" },
                    { id: "found-cr-q5-d", text: "The regression has too few observations for a valid test" },
                  ],
                  correctOptionId: "found-cr-q5-c",
                  explanation:
                    "DW â‰ˆ 2(1 âˆ’ Ïâ‚), so DW = 0.8 implies Ïâ‚ â‰ˆ 1 âˆ’ 0.8/2 = 0.6 â€” substantial positive autocorrelation. Adjacent residuals tend to have the same sign, meaning the model systematically over- or under-predicts in streaks. This violates the OLS assumption of independent errors, making standard errors unreliable (typically underestimated) and inflating t-statistics. The model likely needs lagged variables or additional predictors.",
                },
                {
                  id: "found-cr-q6",
                  question:
                    "Rolling 100-bar correlation between EUR/USD and GBP/USD drops from 0.85 to 0.15 over 200 bars. What is the most likely trading implication?",
                  options: [
                    { id: "found-cr-q6-a", text: "The pairs have permanently decoupled and will never re-correlate" },
                    { id: "found-cr-q6-b", text: "A regime shift has occurred â€” pairs trading strategies assuming stable correlation would face unexpected losses, and position sizing should account for the reduced co-movement" },
                    { id: "found-cr-q6-c", text: "The rolling window is too short and the result is noise" },
                    { id: "found-cr-q6-d", text: "Both pairs have stopped moving entirely" },
                  ],
                  correctOptionId: "found-cr-q6-b",
                  explanation:
                    "A sharp drop in rolling correlation signals a regime change â€” perhaps driven by a UK-specific event (Brexit news, BoE surprise) causing GBP to decouple from the broad USD move. Pairs trading strategies that assume stable Ï â‰ˆ 0.85 would see their hedge ratios become invalid, leading to unexpected P&L swings. Risk management should monitor rolling correlations and adjust position sizing when correlations break down.",
                },
                {
                  id: "found-cr-q7",
                  question:
                    "What happens to OLS coefficient estimates (Î²â‚€, Î²â‚) if the residuals are heteroskedastic?",
                  options: [
                    { id: "found-cr-q7-a", text: "The estimates become biased and inconsistent" },
                    { id: "found-cr-q7-b", text: "The estimates remain unbiased but are no longer efficient (minimum variance), and the conventional standard errors are wrong â€” typically underestimated, causing inflated t-statistics and false significance" },
                    { id: "found-cr-q7-c", text: "The estimates become negative regardless of the true relationship" },
                    { id: "found-cr-q7-d", text: "Nothing changes â€” OLS is robust to heteroskedasticity" },
                  ],
                  correctOptionId: "found-cr-q7-b",
                  explanation:
                    "Under heteroskedasticity, OLS estimates of Î²â‚€ and Î²â‚ remain unbiased and consistent â€” the Gauss-Markov theorem's unbiasedness result only requires E[Îµ|X] = 0, not constant variance. However, OLS is no longer the Best (minimum variance) estimator, and the conventional standard error formulas assume Var(Îµ) = ÏƒÂ² (constant). When variance varies with X, these formulas give incorrect standard errors â€” usually too small â€” leading to inflated t-statistics and spurious significance. The fix is heteroskedasticity-consistent (HC/White) standard errors.",
                },
              ],
            },
            {
              type: "practice",
              title: "Cross-Pair Correlation Matrix & Spurious Relationship Testing",
              description:
                "Build a comprehensive cross-pair correlation analysis for 5 major forex pairs: EUR/USD, GBP/USD, USD/JPY, AUD/USD, and USD/CHF. (1) Compute the 5Ã—5 Pearson and Spearman correlation matrices on hourly log-returns. Identify the strongest (highest |Ï|) and weakest (lowest |Ï|) pair combinations. (2) For the top 3 most correlated pairs, also compute correlation on raw price levels and compare â€” demonstrate that price-level correlations are inflated by non-stationarity. (3) For each pair combination, run the Fisher z-transform to construct 95% confidence intervals for the true correlation. (4) Test for spurious relationships: generate 5 independent random walks of the same length as your data, compute their correlation matrix, and compare with the real-data matrix. (5) Compute rolling 200-bar correlations for the most and least correlated pairs, identify regime-change points where correlation shifts by more than 0.3 within a 50-bar window, and compute regime-specific summary statistics (mean, std, min, max correlation in each regime).",
            },
            {
              type: "practice",
              title: "Dashboard Exercise: Pair Regression & Residual Diagnostics",
              description:
                "Open the dashboard's Analytics page and select a pair regression analysis (e.g., GBP/USD returns regressed on EUR/USD returns). (1) Verify that the displayed OLS coefficients match the manual formulas: Î²â‚ = Cov(X,Y)/Var(X) and Î²â‚€ = È³ âˆ’ Î²â‚xÌ„ using the summary statistics shown on the page. (2) Examine the RÂ² value â€” compute ÏÂ² from the displayed correlation and confirm RÂ² = ÏÂ². (3) Check the residual diagnostics panel: locate the Durbin-Watson statistic and interpret it using the DW â‰ˆ 2(1 âˆ’ Ïâ‚) relationship. Is there evidence of autocorrelation? (4) If a Breusch-Pagan test is displayed, verify that the BP statistic equals n Ã— RÂ²_aux and compare with the Ï‡Â²(1) critical value of 3.841. (5) Examine the scatter plot of residuals vs fitted values â€” does the spread of residuals change with the fitted value (heteroskedasticity)? If the dashboard offers robust (HC) standard errors, toggle between conventional and robust and note which coefficients lose significance.",
            },
          ],
        },
      ],
    };

