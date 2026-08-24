# ML Trading Model Benchmark Targets & Success Criteria

**Date**: 2026-03-05
**Status**: Research reference document
**Instrument**: CME Micro E-mini Nasdaq-100 (MNQ) — $2/point, $0.50/tick, ~$0.50 commission per side

---

## 1. Direction Accuracy Thresholds

### The Breakeven Formula

Breakeven win rate depends on the average win/loss ratio (R):

```
Breakeven Win Rate = 1 / (1 + R)

Where R = Average Win / Average Loss
```

| Avg Win:Loss (R) | Breakeven Win Rate | Meaning |
|---|---|---|
| 0.5:1 | 66.7% | Small winners, need high accuracy |
| 1:1 | 50.0% | Equal W/L, coin flip breaks even |
| 1.5:1 | 40.0% | Decent R, can profit below 50% |
| 2:1 | 33.3% | Good R, only need 1 in 3 |
| 3:1 | 25.0% | Excellent R, 1 in 4 works |

### MNQ-Specific Cost Analysis

MNQ contract specs: $2.00 per point, $0.50 per tick (0.25 points), ~$0.50 commission per side.

**Round-trip cost per contract**: ~$1.00 commission + slippage.
At 1 tick slippage each way: $1.00 slippage + $1.00 commission = **$2.00 per round trip**.

| Trade Style | Avg Move Captured | Cost as % of Move | Min Accuracy (at 1:1 R) |
|---|---|---|---|
| Scalping (2-5 pts) | ~3.5 pts ($7) | 28.6% | ~57% |
| Short-term (5-15 pts) | ~10 pts ($20) | 10.0% | ~53% |
| Intraday swing (15-40 pts) | ~25 pts ($50) | 4.0% | ~51% |
| Multi-day swing (40-100 pts) | ~70 pts ($140) | 1.4% | ~50.5% |

### Accuracy Targets by Tier

| Tier | Accuracy (at 1:1 R) | Accuracy (at 1.5:1 R) | Assessment |
|---|---|---|---|
| **Losing money** | < 52% | < 42% | Below breakeven after costs |
| **Breakeven** | 52-54% | 42-44% | Covers costs, no real profit |
| **Modest edge** | 54-57% | 44-48% | Viable but fragile |
| **Good** | 57-62% | 48-52% | Consistent profitability |
| **Excellent** | 62-68% | 52-58% | Strong, deployable |
| **Suspicious** | > 70% | > 60% | Likely overfitting or data leakage |

### Win Rate vs R-Multiple Tradeoff Map

```
         Win Rate
    40%   45%   50%   55%   60%   65%   70%
R
0.5  -$30  -$18  -$5   +$8   +$20  +$33  +$45   (per 100 trades, $100 risk)
1.0  -$20  -$10   $0   +$10  +$20  +$30  +$40
1.5  -$10   -$3  +$5   +$13  +$20  +$28  +$35
2.0   $0   +$5   +$10  +$15  +$20  +$25  +$30
2.5  +$8   +$11  +$15  +$19  +$23  +$26  +$30
3.0  +$13  +$16  +$19  +$22  +$25  +$28  +$31
```

**Key insight**: A model with 45% accuracy but 2.5:1 R-multiple is more profitable than a model with 60% accuracy but 0.5:1 R-multiple. Accuracy alone is meaningless without the win/loss ratio context.

---

## 2. Information Coefficient (IC) Targets

Per Grinold & Kahn's Fundamental Law of Active Management:

```
IR = IC * sqrt(BR)

Where:
  IR = Information Ratio (excess return / tracking error)
  IC = Information Coefficient (correlation between forecast and actual return)
  BR = Breadth (number of independent bets per year)
```

### IC Signal Strength Classification

| IC Range | Classification | Interpretation |
|---|---|---|
| < 0.02 | **Noise** | Indistinguishable from random. No signal. |
| 0.02 - 0.05 | **Weak signal** | Detectable but fragile. Needs very high breadth (>1000 bets/yr) to be useful. |
| 0.05 - 0.10 | **Moderate signal** | This is where most successful quant strategies live. IC of 0.05-0.10 is genuinely strong in practice. |
| 0.10 - 0.15 | **Strong signal** | Rare. Very profitable if stable. Warrants skepticism — check for overfitting. |
| > 0.15 | **Suspicious** | Almost certainly overfitted, data leakage, or look-ahead bias. Re-examine methodology. |

### Why Small ICs Are Valuable: The Breadth Multiplier

| IC | Breadth (trades/yr) | Resulting IR | Assessment |
|---|---|---|---|
| 0.03 | 50 | 0.21 | Weak |
| 0.03 | 500 | 0.67 | Decent |
| 0.03 | 2000 | 1.34 | Good |
| 0.05 | 50 | 0.35 | Marginal |
| 0.05 | 250 | 0.79 | Good |
| 0.05 | 1000 | 1.58 | Excellent |
| 0.07 | 50 | 0.49 | Marginal |
| 0.07 | 250 | 1.11 | Very good |
| 0.10 | 250 | 1.58 | Excellent |

**For MNQ intraday trading** (~250 trading days, multiple trades per day):
- At 2 trades/day → BR = 500 → need IC >= 0.045 for IR > 1.0
- At 5 trades/day → BR = 1250 → need IC >= 0.028 for IR > 1.0
- At 10 trades/day → BR = 2500 → need IC >= 0.020 for IR > 1.0

### IC Stability Is More Important Than Magnitude

A model with IC = 0.04 that is stable across 36 rolling monthly windows is vastly superior to a model with IC = 0.12 that oscillates between -0.05 and +0.25. Measure:
- **IC Mean**: target > 0.03 for high-frequency, > 0.05 for lower frequency
- **IC Std Dev**: target < IC Mean (IC_IR = IC_mean / IC_std > 1.0)
- **IC Hit Rate**: % of periods with positive IC, target > 55%

---

## 3. Sharpe Ratio Targets

### Annualized Sharpe Benchmarks

| Sharpe Ratio | Assessment | Context |
|---|---|---|
| < 0.5 | **Not viable** | Below risk-free alternative |
| 0.5 - 1.0 | **Marginal** | Acceptable for long-only equity, weak for active futures |
| 1.0 - 1.5 | **Good** | Minimum threshold for most quant hedge funds |
| 1.5 - 2.0 | **Very good** | Strong risk-adjusted performance |
| 2.0 - 3.0 | **Excellent** | Top-tier. Most quant funds ignore strategies below Sharpe 2. |
| 3.0 - 5.0 | **Exceptional** | Rare and often unsustainable long-term |
| > 5.0 | **Suspicious** | Almost certainly overfitted or measured over too short a window |

### In-Sample to Out-of-Sample Translation

This is critical. Research (Bailey & Lopez de Prado, Harvey & Liu) shows:

| In-Sample Sharpe | Expected OOS Sharpe | Degradation |
|---|---|---|
| 1.0 | 0.3 - 0.5 | 50-70% haircut |
| 2.0 | 0.7 - 1.3 | 35-65% haircut |
| 3.0 | 1.0 - 1.8 | 40-67% haircut |
| 5.0 | 1.0 - 2.0 | 60-80% haircut (heavy overfitting likely) |

**Industry standard haircut**: 50% of in-sample Sharpe is the commonly applied rule of thumb. Harvey & Liu argue the haircut is non-linear — marginal Sharpe ratios are penalized more heavily than high ones.

**The Deflated Sharpe Ratio** (Bailey & Lopez de Prado): After only 1,000 independent backtests, the expected maximum Sharpe ratio is 3.26 even if the true Sharpe is zero. The DSR corrects for:
- Number of strategies tested (multiple testing bias)
- Non-normal returns (skewness, kurtosis)
- Sample length

### Minimum In-Sample Sharpe to Target

Given 50% expected degradation:
- Need IS Sharpe >= 2.0 to expect OOS Sharpe >= 1.0
- Need IS Sharpe >= 3.0 to expect OOS Sharpe >= 1.5
- Need IS Sharpe >= 4.0 to expect OOS Sharpe >= 2.0

### Intraday Sharpe Inflation Warning

Intraday strategies produce inflated annualized Sharpe ratios due to more frequent sampling. A daily Sharpe of 0.1 annualizes to 0.1 * sqrt(252) = 1.59. But this is legitimate if the strategy truly trades daily with consistent returns. The concern arises when Sharpe is computed on sub-daily bars and annualized — this overstates risk-adjusted performance because intraday returns have lower variance.

**Rule**: Always compute Sharpe on the frequency of independent decisions (trade-level or daily P&L), not on bar-level returns.

---

## 4. Calibration Targets

### Brier Score

```
Brier Score = (1/N) * SUM( (predicted_probability - actual_outcome)^2 )
```

| Brier Score | Assessment | Context |
|---|---|---|
| 0.25 | **Baseline** | Equivalent to predicting 50% for everything (the "no skill" score for balanced binary outcomes) |
| 0.20 - 0.25 | **Weak** | Barely better than random |
| 0.15 - 0.20 | **Modest** | Some discriminative ability |
| 0.10 - 0.15 | **Good** | Meaningful probability calibration |
| 0.05 - 0.10 | **Very good** | Strong calibration, rare in financial prediction |
| < 0.05 | **Suspicious** | Verify no data leakage; exceptional if real |

**Important caveat**: Brier score depends on base rate. For a 50/50 up/down prediction, 0.25 is the uninformed baseline. For rare events (5% occurrence), the uninformed baseline is much lower (~0.05). Always compare to the "predict the base rate" baseline, not to absolute thresholds.

### Expected Calibration Error (ECE)

| ECE | Assessment |
|---|---|
| > 0.15 | **Poorly calibrated** — probabilities are unreliable |
| 0.10 - 0.15 | **Moderate** — usable but noisy |
| 0.05 - 0.10 | **Good** — probabilities are informative for position sizing |
| 0.02 - 0.05 | **Well calibrated** — can trust probabilities for risk management |
| < 0.02 | **Excellent** — probabilities closely match empirical frequencies |

### Calibration Targets for Trading Signal Confidence

For the ML dashboard's confidence output (0-1 probability on regime/direction):

1. **Reliability diagram**: Plot should track the diagonal (predicted prob vs actual frequency)
2. **Resolution**: The model should assign varied probabilities, not cluster near 0.5
3. **Sharpness**: High-confidence predictions (>0.7) should occur and be correct proportionally
4. **Target**: ECE < 0.08, Brier score < 0.20 (for balanced direction prediction)

When the model says "70% probability of upward regime," it should be correct ~70% of the time. This is what enables Kelly-criterion position sizing.

---

## 5. Overfitting Indicators

### Train/Validation Gap Thresholds for Financial ML

Financial models are uniquely susceptible to overfitting because:
- Low signal-to-noise ratio (most price movement is noise)
- Non-stationary data (distributions shift over time)
- Many features relative to signal strength
- Multiple testing problem (trying many configurations)

| Train-Val Gap | Assessment | Action |
|---|---|---|
| < 5% | **Healthy** | Model generalizes well |
| 5-10% | **Acceptable** | Monitor but deployable |
| 10-15% | **Warning** | Increase regularization, reduce features |
| 15-25% | **Overfitting likely** | Significant model revision needed |
| > 25% | **Severe overfitting** | Do not deploy; fundamental redesign needed |

**Note**: These are tighter than standard ML (where 15% might be fine) because financial signals are weaker. A 15% gap in image classification still leaves 70%+ validation accuracy. A 15% gap in financial prediction might mean the model has zero real edge.

### The Generalization Ratio

```
Generalization Ratio = OOS Performance / IS Performance
```

| Ratio | Assessment |
|---|---|
| > 0.80 | **Excellent** generalization (verify it's not underfit) |
| 0.60 - 0.80 | **Good** — expected for robust financial models |
| 0.50 - 0.60 | **Acceptable** — walk-forward efficiency threshold |
| 0.30 - 0.50 | **Weak** — model is memorizing more than learning |
| < 0.30 | **Failed** — model does not generalize |

### Specific Red Flags

1. **Training loss drops smoothly but validation loss is volatile**: Model fitting noise
2. **Perfect or near-perfect training accuracy**: Guaranteed overfitting in financial data
3. **Sharpe > 5 in-sample**: Almost always overfitting
4. **Model complexity exceeds data**: Features * parameters should be << number of training samples
5. **Performance degrades in walk-forward windows**: Model has no durable edge
6. **Performance varies wildly across similar time periods**: Fitting to specific events, not patterns

### Bailey & Lopez de Prado Overfitting Probability

After testing N strategies, the probability of finding a spurious Sharpe > S* is:

```
P(overfit) increases with:
  - Number of strategies/configurations tested
  - Shorter backtest periods
  - Higher return skewness/kurtosis
  - Lower true Sharpe ratio
```

**Rule of thumb**: If you've tested 100+ configurations, expect the best in-sample Sharpe to be ~2.3 even under the null hypothesis (zero real Sharpe). Use the Deflated Sharpe Ratio to adjust.

---

## 6. Regime-Specific Targets

### Should the Model Be Equally Good Everywhere?

**No.** This is a critical design decision. The research is clear:

- Trend-following strategies excel in trending markets, fail in ranges
- Mean-reversion strategies excel in ranges, fail in trends
- No single model dominates all regimes

### The Correct Approach: Regime-Aware Specialization

| Strategy | Trending Markets | Ranging Markets | Volatile/Crisis |
|---|---|---|---|
| Fully deployed | Target: Sharpe > 1.5 | Target: Sharpe > 0.5 (or flat) | Target: Sharpe > 0.0 (capital preservation) |
| Acceptable | Strong directional accuracy | Reduced position size, avoid whipsaws | Flat or hedged |
| Unacceptable | < 50% accuracy in trends | Large drawdowns from false breakouts | Catastrophic losses |

### Regime-Conditioned Performance Targets

| Metric | Trending Regime | Ranging Regime | High-Vol Regime |
|---|---|---|---|
| Direction accuracy | > 58% | > 50% (or don't trade) | > 50% |
| Avg trade P&L | Positive, > 2x costs | Breakeven or slightly positive | Small positive or zero |
| Max drawdown | < 10% | < 5% | < 15% (wider tolerance) |
| Position size | Full | 50% or less | 25% or less |
| Trade frequency | Normal | Reduced | Minimal |

### The "Know When Not to Trade" Principle

A model that is 60% accurate in trends and sits out ranges will massively outperform a model that is 55% accurate everywhere. The HDP-HMM regime detection in the ML dashboard directly enables this — use regime confidence to scale position sizing:

```
Position Size = Base Size * Regime Confidence * Regime Suitability Factor
```

Where Regime Suitability Factor = 1.0 for favorable regimes, 0.3-0.5 for neutral, 0.0 for unfavorable.

---

## 7. Risk-Adjusted Targets

### Sortino Ratio (Downside-Risk Adjusted)

| Sortino | Assessment |
|---|---|
| < 0 | **Not viable** |
| 0 - 1.0 | **Weak** — positive but poor risk-adjusted return |
| 1.0 - 2.0 | **Good** — solid risk-adjusted performance |
| 2.0 - 3.0 | **Very good** — strong downside protection |
| > 3.0 | **Excellent** — exceptional (rare, verify sustainability) |

Note: Sortino ~2.0 roughly corresponds to Sharpe ~1.0-1.5 for strategies with symmetric returns. Sortino is higher than Sharpe when upside volatility exceeds downside (desirable asymmetry).

### Calmar Ratio (Return / Max Drawdown)

| Calmar | Assessment |
|---|---|
| < 0.5 | **Weak** — return doesn't justify the drawdown pain |
| 0.5 - 1.0 | **Acceptable** — modest but viable |
| 1.0 - 2.0 | **Good** — strong risk-adjusted returns |
| 2.0 - 3.0 | **Very good** — excellent drawdown management |
| > 3.0 | **Exceptional** — returns substantially exceed worst drawdown |

### Maximum Drawdown Targets

| Max DD | Assessment | Context |
|---|---|---|
| < 5% | **Conservative** — very tight risk control |
| 5-10% | **Good** — professional standard |
| 10-15% | **Acceptable** — typical for active strategies |
| 15-25% | **Elevated** — needs strong returns to justify |
| 25-40% | **High** — only for very high return strategies |
| > 40% | **Unacceptable** — poor risk management |

### Profit Factor

| Profit Factor | Assessment |
|---|---|
| < 1.0 | **Losing money** — gross losses exceed gross profits |
| 1.0 - 1.25 | **Marginal** — barely profitable, vulnerable to costs |
| 1.25 - 1.5 | **Weak** — profitable but fragile |
| 1.5 - 2.0 | **Good** — solid profitability |
| 2.0 - 3.0 | **Very good** — robust, consistent |
| > 3.0 | **Exceptional or suspicious** — verify with sufficient trade count |

### Composite Tier Summary

| Tier | Sharpe | Sortino | Calmar | Max DD | Profit Factor | Win Rate (1:1 R) |
|---|---|---|---|---|---|---|
| **Viable but modest** | 1.0-1.5 | 1.0-1.5 | 0.5-1.0 | 10-20% | 1.25-1.5 | 53-57% |
| **Good** | 1.5-2.5 | 1.5-2.5 | 1.0-2.0 | 5-15% | 1.5-2.0 | 57-62% |
| **Exceptional** | > 2.5 | > 3.0 | > 2.0 | < 10% | > 2.0 | > 62% |

---

## 8. Multi-Head Agreement Metrics

### The Value of Confluence

When a multi-head model (direction + trend + regime heads) produces predictions, the agreement level should be a primary filter for trade quality.

Based on ensemble research showing 5-40% accuracy improvement when models agree, and prop trading confluence patterns:

| Agreement Level | Expected Behavior | Target Accuracy |
|---|---|---|
| **All heads disagree** | No trade signal. Model is confused. | N/A — do not trade |
| **2 of 3 agree** | Weak signal. Reduced position size. | Should be 2-5% better than single-head accuracy |
| **All 3 agree** | Strong confluence. Full position. | Should be 8-15% better than single-head accuracy |
| **All 3 agree + high confidence** | Maximum conviction. | Should be 12-20% better than single-head accuracy |

### Concrete Targets for the ML Dashboard Multi-Head Architecture

If single-head direction accuracy is 56%:

| Confluence Level | Target Accuracy | Position Size Multiplier |
|---|---|---|
| Direction only (no agreement check) | 56% | 0.5x |
| Direction + Trend agree | 59-61% | 0.75x |
| Direction + Trend + Regime agree | 64-68% | 1.0x |
| All agree + confidence > 0.7 | 68-72% | 1.25x |
| All agree + confidence > 0.8 | 70-75% | 1.5x |

### Measuring Multi-Head Agreement Value

Track these metrics to validate confluence is working:

1. **Agreement Rate**: What % of bars have full 3-head agreement? Target: 20-40% (not too common, not too rare)
2. **Conditional Accuracy**: Accuracy when all heads agree vs disagree. Gap should be > 10 percentage points.
3. **Conditional Profit Factor**: PF when all agree vs single-head PF. Should be 1.5x or better.
4. **False Confluence Rate**: How often all heads agree but the trade loses. Target: < 35% (for 1:1 R trades).
5. **Agreement-Weighted Sharpe**: Sharpe of the strategy that sizes by agreement level should exceed uniform-size Sharpe by > 0.3.

### Important Caveat

Multi-head agreement is only valuable if the heads are making genuinely independent errors. If all three heads are trained on highly correlated features, their "agreement" is just triple-counting the same signal. Measure **inter-head error correlation** — target < 0.5. If correlation > 0.7, the heads are redundant, not complementary.

---

## 9. Walk-Forward Degradation

### Walk-Forward Efficiency (WFE)

```
WFE = OOS Annualized Return / IS Annualized Return
```

| WFE | Assessment |
|---|---|
| < 30% | **Failed** — model does not generalize |
| 30-50% | **Weak** — significant overfitting, marginal signal |
| 50-60% | **Acceptable** — threshold for deployable strategy |
| 60-80% | **Good** — model retains most of its edge OOS |
| > 80% | **Excellent** — but verify it's not underfit |
| ~100% | **Investigate** — unusual, may indicate leakage or trivially simple model |

### Expected Degradation Ranges by Metric

| Metric | Acceptable IS→OOS Degradation | Concerning Degradation |
|---|---|---|
| Sharpe ratio | 30-50% drop | > 60% drop |
| Win rate | 3-8% drop | > 12% drop |
| Profit factor | 20-40% drop | > 50% drop |
| Max drawdown | 30-80% increase | > 100% increase |
| IC | 20-40% drop | > 50% drop |

### Walk-Forward Stability Metrics

Beyond WFE, measure consistency across windows:

1. **Return stability**: Std dev of per-window returns / mean return. Target: < 1.5
2. **Sharpe stability**: Std dev of per-window Sharpe / mean Sharpe. Target: < 1.0
3. **Win rate stability**: Coefficient of variation across windows. Target: < 0.15
4. **Regime count stability**: Std dev of discovered regime count across windows. Target: < 1.5
5. **Profitable window %**: What fraction of OOS windows are profitable? Target: > 60%

### Minimum Walk-Forward Requirements

- **Minimum windows**: 6+ OOS periods (fewer is statistically meaningless)
- **Minimum OOS bars per window**: 250+ for daily, 1000+ for intraday
- **Training/test ratio**: Typically 4:1 to 6:1 (e.g., 12 months train, 3 months test)
- **Step size**: Usually equals test window (rolling, not expanding)

---

## 10. Comparison to Benchmarks

### Benchmark Hierarchy

Every model should be compared against these baselines, in order of difficulty:

#### Level 0: Random Baseline (50/50)

- Direction accuracy: 50%
- IC: 0.00
- Sharpe: ~0.0 (before costs), negative after costs
- Brier score: 0.25 (for balanced binary prediction)

**The model must statistically significantly beat random**. Use a binomial test:
- For 1000 predictions at 53% accuracy: p-value = 0.03 (significant)
- For 200 predictions at 53% accuracy: p-value = 0.26 (not significant)
- Need ~500+ predictions before small edges become statistically significant

#### Level 1: Simple Momentum

- 10-period momentum (buy if close > close[10], else sell)
- Typical performance: Sharpe 0.3-0.8 depending on regime
- Typical accuracy: 51-54%
- Free, no model risk, near-zero complexity

**The ML model should beat momentum by a meaningful margin**: at least 0.3 Sharpe improvement, or 3+ percentage points accuracy improvement.

#### Level 2: Moving Average Crossover

- 50/200 SMA crossover (golden cross / death cross)
- Typical performance: Sharpe 0.4-0.9 long-term
- Fewer trades, larger moves captured
- Very stable, well-known edge

**The ML model should match or beat SMA crossover on risk-adjusted basis** while adding value through better timing or regime detection.

#### Level 3: Buy-and-Hold Benchmark

- For NQ: Long-term average ~12-15% annual return
- Sharpe ~0.5-0.8 (highly regime-dependent)
- Max drawdown can exceed 30% in bear markets

**For a long-short strategy**: beat buy-and-hold on Sharpe (not necessarily on total return — Sharpe accounts for the risk taken). A strategy with 10% annual return and Sharpe 2.0 is superior to buy-and-hold with 15% return and Sharpe 0.6.

#### Level 4: Previous Model Version

- Compare to the last trained version of the same model type, same symbol, same timeframe
- This tracks improvement over time
- Use the Diebold-Mariano test for statistical significance of forecast differences

### Benchmark Comparison Table Template

| Metric | Random | Momentum | SMA Cross | Buy & Hold | Your Model | Significance |
|---|---|---|---|---|---|---|
| Accuracy | 50.0% | 52.1% | 53.4% | N/A | ? | p < 0.05? |
| Sharpe | -0.3 | 0.45 | 0.62 | 0.55 | ? | DM test |
| Profit Factor | 0.85 | 1.12 | 1.28 | N/A | ? | - |
| Max DD | random | 18% | 15% | 33% | ? | - |
| IC | 0.000 | 0.015 | 0.022 | N/A | ? | t-test |

---

## Summary: The "Ship It" Checklist

Before deploying a model for live trading on MNQ, verify ALL of the following:

### Minimum Viable (all must pass)

- [ ] OOS direction accuracy > 53% (at 1:1 R) or appropriate win rate for actual R
- [ ] OOS Sharpe > 1.0 (computed on trade-level or daily P&L)
- [ ] OOS profit factor > 1.25
- [ ] Max drawdown < 20%
- [ ] Walk-forward efficiency > 50% across 6+ windows
- [ ] IC > 0.03 (mean across rolling windows), IC hit rate > 55%
- [ ] Statistically significant vs random (p < 0.05, 500+ predictions)
- [ ] Beats simple momentum on Sharpe by > 0.3
- [ ] Train/val accuracy gap < 10%
- [ ] ECE < 0.10 (probability calibration)
- [ ] Generalization ratio > 0.50
- [ ] Multi-head agreement shows > 10% accuracy improvement over single-head

### Good (target for deployment confidence)

- [ ] OOS direction accuracy > 57% (at 1:1 R)
- [ ] OOS Sharpe > 1.5
- [ ] OOS profit factor > 1.5
- [ ] OOS Sortino > 2.0
- [ ] Max drawdown < 15%
- [ ] Calmar ratio > 1.0
- [ ] Walk-forward efficiency > 60%
- [ ] IC > 0.05 (mean), IC stability (IC_IR > 1.0)
- [ ] Brier score < 0.20
- [ ] ECE < 0.05
- [ ] Profitable in > 65% of walk-forward windows
- [ ] Multi-head full agreement accuracy > 64%

### Exceptional (the dream)

- [ ] OOS direction accuracy > 62% (at 1:1 R)
- [ ] OOS Sharpe > 2.5
- [ ] OOS profit factor > 2.0
- [ ] OOS Sortino > 3.0
- [ ] Max drawdown < 10%
- [ ] Calmar ratio > 2.0
- [ ] Walk-forward efficiency > 70%
- [ ] IC > 0.07
- [ ] Multi-head full agreement accuracy > 70%
- [ ] Beats SMA crossover AND buy-and-hold on Sharpe
- [ ] Regime-conditioned strategy: Sharpe > 1.5 in trends, > 0 in ranges
