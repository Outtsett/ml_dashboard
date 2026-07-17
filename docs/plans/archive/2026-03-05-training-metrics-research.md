# Training Metrics Research: ML-Based MNQ Futures Prediction

**Date**: 2026-03-05
**Scope**: Metrics for evaluating a 7-head prediction model during training
**Instrument**: CME Micro E-mini Nasdaq-100 (MNQ) — $0.50/tick, $2.00/point, 0.25 tick size

---

## Prediction Heads Reference

| Head | Type | Output |
|------|------|--------|
| Direction | Binary classification | Long / Short |
| Magnitude | Regression | Expected price move (points) |
| Volatility | Regression | Expected volatility |
| Regime | Multi-class classification | Trending / Ranging / Volatile |
| Trend | Regression + direction | 15m directional bias |
| Reversal | Binary classification (probabilistic) | P(direction change) |
| Confluence | Regression (0-1) | Agreement score across heads |

---

## 1. Direction Prediction Quality

### 1.1 Matthews Correlation Coefficient (MCC)

**What it measures**: The single most reliable metric for binary direction classification. MCC uses all four quadrants of the confusion matrix (TP, TN, FP, FN) and produces a high score only when the model performs well on ALL four. Unlike accuracy or F1, it cannot be inflated by class imbalance.

**Why it matters for trading**: Markets are roughly 50/50 directional at most timeframes. Accuracy of 55% sounds mediocre but can be enormously profitable. MCC correctly captures this — a model with 55% accuracy and balanced performance across long/short will show MCC ~0.10, which is meaningful. F1 can mask a model that only gets one direction right.

**Formula**: MCC = (TP*TN - FP*FN) / sqrt((TP+FP)(TP+FN)(TN+FP)(TN+FN))

**Target values**:
- MCC > 0.05: Statistically better than random, potentially tradeable with high volume
- MCC > 0.10: Good — roughly equivalent to 55% balanced accuracy
- MCC > 0.15: Very good — this is rare in directional forecasting
- MCC > 0.20: Exceptional — investigate for overfitting before trusting

**When to compute**: Every epoch on validation set. Cheap — O(n) from confusion matrix.

**Computational cost**: Negligible. Single pass through predictions.

---

### 1.2 Class-Conditional Accuracy (Long vs Short)

**What it measures**: Accuracy broken out by predicted class. "When the model says Long, how often is it right?" vs "When the model says Short, how often is it right?"

**Why it matters for trading**: Asymmetric accuracy creates asymmetric risk. If the model is 65% accurate on Long calls but only 40% on Short calls, you should only trade the Long signals. This directly maps to position sizing and strategy filtering. A model with 55% overall accuracy might actually be 70% on Long and 40% on Short — the aggregate number hides actionable signal.

**Target values**:
- Both classes > 52%: Minimum viable for both-direction trading
- One class > 58%, other > 48%: Trade only the strong direction
- Both classes > 55%: Strong model
- Asymmetry > 10%: Red flag for class imbalance or regime dependency

**When to compute**: Every epoch on validation set.

**Computational cost**: Negligible.

---

### 1.3 Precision / Recall by Class with Asymmetric Cost

**What it measures**: Precision = "of all Long predictions, how many were correct?" Recall = "of all actual Long moves, how many did we catch?"

**Why it matters for trading**: For trade entries, PRECISION is king. Every false positive is a losing trade with real slippage costs. You want the model to be picky — it's better to miss 40% of moves (low recall) and be right 65% of the time (high precision) than to catch everything with 52% precision.

For MNQ specifically: At $0.50/tick with ~1 tick slippage per side, each trade costs ~$1.00 round-trip. A false positive Long signal during a 4-point drop = $8.00 + $1.00 costs = $9.00 loss.

**Target values** (for trade entry signals):
- Precision > 0.55: Minimum viable (breakeven after costs depends on avg winner size)
- Precision > 0.60: Good — profitable with reasonable magnitude
- Precision > 0.65: Very good
- Recall > 0.40: Sufficient — you don't need to catch every move
- PR-AUC > 0.55: Better than random baseline (0.50 for balanced classes)

**When to compute**: Every epoch. Also compute the full PR curve periodically (every 5-10 epochs).

**Computational cost**: Negligible for point metrics. PR curve is O(n log n) for sorting.

---

### 1.4 Sequential Accuracy / Error Autocorrelation

**What it measures**: Whether prediction errors are clustered in time or randomly distributed. Uses the Durbin-Watson statistic on the binary error sequence (1=correct, 0=wrong).

**Why it matters for trading**: Clustered errors destroy accounts. If the model goes through "bad patches" where it gets 10 predictions wrong in a row, that's a 10-trade losing streak. Even at $4/loss per trade, that's a $40 drawdown from a model that might be 55% accurate overall. Random errors of the same accuracy would never produce that streak.

**Durbin-Watson interpretation**:
- DW ~2.0: Errors are random (ideal)
- DW < 1.5: Positive autocorrelation — errors cluster. BAD. The model has regimes where it consistently fails
- DW > 2.5: Negative autocorrelation — errors alternate. Unusual but not as dangerous
- DW < 1.0: Severe clustering — the model is useless in certain market conditions

**Additional streak metrics**:
- Max consecutive wrong predictions (target: < 8 for a 55% accurate model)
- Mean streak length for wrong predictions (target: < 3)
- Streak length ratio: mean_wrong_streak / mean_right_streak (target: < 1.2)

**When to compute**: Every 10-20 epochs (requires full sequence analysis, not just aggregate stats).

**Computational cost**: Low — O(n) scan through prediction sequence.

---

### 1.5 Cohen's Kappa (Chance-Corrected Agreement)

**What it measures**: How much better the model is than random guessing, correcting for the base rate. A model that predicts "Long" 80% of the time in a market that goes up 80% of the time gets 0 kappa despite high accuracy.

**Why it matters for trading**: Financial data has non-stationary class distributions. During bull markets, "always predict Long" gets high accuracy. Kappa strips this away and shows genuine skill.

**Target values**:
- kappa > 0.02: Slight agreement beyond chance (still potentially tradeable)
- kappa > 0.05: Fair — real signal present
- kappa > 0.10: Moderate — strong for financial data
- kappa > 0.20: Substantial — verify not overfitting

**When to compute**: Every epoch on validation set.

**Computational cost**: Negligible.

---

## 2. Volatility / Magnitude Metrics

### 2.1 MAPE (Mean Absolute Percentage Error) for Magnitude

**What it measures**: Average percentage error of magnitude predictions. "When the model says price will move 8 points, how far off is it on average?"

**Why it matters for trading**: Magnitude prediction directly determines position sizing and stop-loss placement. If the model says "expect a 10-point move" and the actual move is 2 points, your risk/reward calculation is completely wrong.

**MAPE formula**: MAPE = (1/n) * sum(|actual - predicted| / |actual|) * 100

**Caution**: MAPE explodes when actual values are near zero (small moves). Use Symmetric MAPE (sMAPE) or consider only moves above a threshold (e.g., > 2 points for MNQ).

**Target values**:
- MAPE < 30%: Excellent for financial magnitude prediction
- MAPE < 50%: Good — useful for approximate sizing
- MAPE < 70%: Marginal — provides directional magnitude only
- MAPE > 100%: Model's magnitude predictions are noise

**When to compute**: Every epoch on validation set.

**Computational cost**: Negligible.

---

### 2.2 Directional Accuracy of Magnitude

**What it measures**: "When the model predicts a LARGER move, does a larger move actually occur?" This is the rank correlation (Spearman) between predicted magnitude and actual magnitude, ignoring the absolute scale.

**Why it matters for trading**: Even if absolute magnitude predictions are off, if the model correctly ranks which predictions will be bigger moves, you can size positions proportionally. This is often more achievable than accurate point estimates.

**Target values** (Spearman correlation):
- rho > 0.05: Weak but detectable ordering
- rho > 0.10: Useful for position sizing
- rho > 0.15: Strong — reliable sizing signal
- rho > 0.20: Exceptional — verify not overfitting

**When to compute**: Every epoch.

**Computational cost**: O(n log n) for ranking.

---

### 2.3 Volatility Prediction Quality

**What it measures for the Volatility head**: How well the model predicts upcoming realized volatility. Use multiple metrics:

**2.3a — RMSE of log-volatility**: Predict ln(vol), compute RMSE. Log transformation stabilizes the scale and penalizes proportional errors equally across low-vol and high-vol regimes.

**Target values**: RMSE(ln vol) < 0.3 is good, < 0.2 is excellent.

**2.3b — Volatility Regime Detection Accuracy**: Bin actual volatility into regimes (Low/Normal/High using quantiles) and check if the model's predicted volatility falls in the correct bin.

**Target values**:
- 3-regime accuracy > 45%: Better than random (33%)
- 3-regime accuracy > 55%: Good
- 3-regime accuracy > 65%: Very good

**2.3c — Vol-of-Vol Prediction**: From options literature. Can the model predict when volatility itself will be volatile? Compute rolling std of realized vol, then correlate with model's volatility uncertainty.

**Target values**: Correlation > 0.10 between predicted vol uncertainty and realized vol-of-vol.

**2.3d — QLIKE (Quasi-Likelihood) Loss**: From the volatility forecasting literature. QLIKE = ln(sigma_actual^2) + sigma_actual^2 / sigma_predicted^2. Unlike RMSE, QLIKE is robust to the scale of volatility and is a proper scoring rule for volatility.

**Target values**: QLIKE comparisons are relative — compare against GARCH baseline.

**When to compute**: Every 5 epochs (some require rolling windows).

**Computational cost**: Low to moderate. Vol-of-vol requires rolling computations.

---

### 2.4 Magnitude-Direction Joint Accuracy

**What it measures**: "When the model predicts Long with magnitude > X points, how often does price actually move up by at least X/2 points?" Combines direction and magnitude into a single actionable metric.

**Why it matters for trading**: This is the metric closest to actual trade P&L. A correct direction with insufficient magnitude still loses money after costs.

For MNQ: If the model predicts Long + 4 points, and price moves up 1 point, that's technically correct on direction but the 1-point gain minus ~0.5 points of slippage = $1.00 net, which barely covers commission.

**Target values**:
- Joint accuracy (direction correct AND magnitude within 50%) > 30%: Useful
- Joint accuracy > 40%: Good
- Expected profit per signal = avg_correct_profit - avg_wrong_loss - costs > 0: The ultimate threshold

**When to compute**: Every 10 epochs.

**Computational cost**: Low.

---

## 3. Regime Detection Quality

### 3.1 Regime Classification Accuracy (vs Ground Truth)

**What it measures**: If you have labeled ground truth for regimes (e.g., from manual labeling or a known regime proxy like ADX > 25 = trending), how well does the model match?

**Problem**: Ground truth regimes don't really exist — they're a human construct. Instead use:

**3.1a — Internal Consistency (Silhouette Score)**: Already in your eval pipeline. Measures how similar each bar is to its own regime vs the nearest other regime.

**Target values**:
- Silhouette > 0.10: Weak but real structure
- Silhouette > 0.20: Meaningful regime separation (your current threshold)
- Silhouette > 0.35: Strong separation
- Silhouette > 0.50: Very strong — unusual for financial data

**3.1b — Calinski-Harabasz Index**: Ratio of between-cluster to within-cluster variance. Higher is better. No universal threshold; compare across model configurations.

**3.1c — Davies-Bouldin Index**: Average similarity between each regime and its most similar neighbor. Lower is better.

**Target values**: DB < 1.5 (your current threshold). DB < 1.0 is excellent.

**When to compute**: Every epoch (cheap for cluster metrics).

**Computational cost**: O(n*k) where k = number of regimes.

---

### 3.2 Regime Persistence Accuracy

**What it measures**: "When the model says we're in Regime X, how long does it actually stay?" If regimes flip every 2-3 bars, they're noise. Real market regimes persist for hours to days.

**Metrics**:
- Median regime duration (in bars): Should match expected market behavior
- Ratio of median duration to minimum meaningful duration: For 1-minute MNQ bars, a regime should last at least 15 bars (15 min). For 5-minute bars, at least 6 bars (30 min)
- Duration distribution entropy: Lower entropy = more consistent regime lengths (good)
- Regime duration vs actual volatility regime duration: Correlation between model regime durations and periods between actual volatility regime changes

**Target values**:
- Median duration > 15 bars (for 1-min data): Regimes last at least 15 minutes
- Median duration > 6 bars (for 5-min data): Regimes last at least 30 minutes
- Std(duration) / Mean(duration) < 1.5: Durations aren't wildly inconsistent
- Duration entropy < 2.0 bits: Reasonably predictable persistence

**When to compute**: Every 10 epochs.

**Computational cost**: Low — O(n) scan for run lengths.

---

### 3.3 Regime Transition Detection Metrics

**What it measures**: How well the model detects when regimes are about to change (via the transition_prob signal).

**Metrics**:
- **Transition Precision**: When transition_prob > 0.5, did a regime change actually occur within N bars? Target: > 0.30 (already in your Phase 3 plan)
- **Transition Recall**: Of all actual regime changes, how many had transition_prob > 0.5 within N bars beforehand? Target: > 0.40
- **Transition Lead Time**: Average number of bars between the transition_prob signal and the actual regime change. Positive = predictive (good), Negative = lagging (bad)
- **False Alarm Rate**: P(transition_prob > 0.5 | no actual transition). Target: < 0.60

**When to compute**: Every 10-20 epochs.

**Computational cost**: Low.

---

### 3.4 Regime Confusion Matrix

**What it measures**: Which regimes get confused with each other. A 3x3 matrix (Trending/Ranging/Volatile) showing misclassification patterns.

**Why it matters**: Trending-vs-Volatile confusion is acceptable (both have large moves). Trending-vs-Ranging confusion is dangerous (opposite trading strategies).

**Key metrics from the confusion matrix**:
- Off-diagonal concentration: Where do errors cluster?
- Trending recall > 0.60: Must catch trends
- Ranging precision > 0.55: Must not falsely call ranging when trending
- Weighted F1 across regimes > 0.50

**When to compute**: Every epoch (trivial from predictions).

**Computational cost**: Negligible.

---

## 4. Momentum / Trend Metrics

### 4.1 Trend Direction Accuracy at Multiple Horizons

**What it measures**: Does the Trend head's 15-minute directional bias actually predict the direction over different horizons? Evaluate at 5-bar, 15-bar, 30-bar, and 60-bar lookahead.

**Why it matters**: A trend signal might be accurate at 15 bars but completely wrong at 60 bars (capturing a pullback within a larger counter-trend). Understanding the signal's valid horizon prevents holding trades too long.

**Target values** (direction accuracy per horizon):
- 5-bar: > 54% (noise makes short horizon hard)
- 15-bar: > 56% (this is the target horizon — should be strongest)
- 30-bar: > 53% (some decay expected)
- 60-bar: > 51% (barely above chance is fine — signal has decayed)

**Key diagnostic**: If 5-bar accuracy > 15-bar accuracy, the model is capturing momentum, not trend. If 30-bar > 15-bar, it's capturing slow trend but missing the optimal horizon.

**When to compute**: Every 10 epochs (requires forward-looking windows).

**Computational cost**: Moderate — O(n * H) where H = number of horizons.

---

### 4.2 Trend Magnitude Correlation

**What it measures**: Spearman correlation between the trend bias magnitude and the actual price change over the same horizon. "When the model says the trend is strongly bullish, do we see a bigger up move?"

**Target values**:
- Spearman rho > 0.05 at target horizon: Detectable signal
- Spearman rho > 0.10: Useful for sizing
- Decay profile: rho should peak at or near the target horizon (15 bars)

**When to compute**: Every 10 epochs.

**Computational cost**: O(n log n) per horizon.

---

### 4.3 Trend Continuation vs Reversal Precision

**What it measures**: When the Trend head says "bullish" AND the Reversal head says "low probability of reversal", how often does the trend continue vs reverse?

**Why it matters**: This tests the INTERACTION between two heads. If the heads agree (bullish + no reversal), the combined signal should be stronger than either alone. If the combined signal isn't stronger, the heads contain redundant information.

**Target values**:
- P(continuation | trend=bullish AND reversal_prob < 0.3) > 0.60: Confluence adds value
- Compare to P(continuation | trend=bullish alone) — should be higher
- Lift: P(combined) / P(single) > 1.05: Confluence provides at least 5% lift

**When to compute**: Every 20 epochs (requires sufficient samples where both conditions trigger).

**Computational cost**: Low but requires sample filtering.

---

## 5. Financial Metrics During Training

### 5.1 Information Coefficient (IC)

**What it measures**: Cross-sectional (or temporal) Spearman rank correlation between the model's prediction scores and realized returns. THE canonical metric for alpha signal quality in quantitative finance.

For your single-instrument model (MNQ), compute temporal IC: correlate the time series of prediction confidence with subsequent returns over rolling windows.

**Formula**: IC_t = SpearmanCorr(signal_t, return_{t+1,...,t+h})

Aggregate: Mean IC across all periods, and IC Information Ratio (mean IC / std IC).

**Why it matters**: IC directly measures alpha. From the Fundamental Law of Active Management: Expected Return ≈ IC * sqrt(Breadth) * sigma. Even IC of 0.05 with high-frequency trading (high breadth) generates returns.

**Target values**:
- IC > 0.02: Detectable signal (typical for good stock selection models)
- IC > 0.05: Good — rare in practice
- IC > 0.08: Very good
- IC > 0.10: Exceptional — common in academic papers, rare in production
- ICIR (IC / std(IC)) > 0.5: Signal is consistent
- ICIR > 1.0: Very consistent (publishable)
- Hit rate (% of periods with IC > 0) > 55%: More periods right than wrong

**When to compute**: Every 5-10 epochs.

**Computational cost**: Moderate — O(W * n/W) where W = window size, computed over rolling windows.

---

### 5.2 Expected PnL Per Prediction

**What it measures**: The average dollar profit/loss per model prediction, incorporating MNQ tick economics.

**Formula**:
```
E[PnL] = P(correct_direction) * E[winner_magnitude] * $2.00/point
        - P(wrong_direction) * E[loser_magnitude] * $2.00/point
        - cost_per_trade
```

Where cost_per_trade = slippage ($0.50-$1.00 per side) + commission (~$0.50-$1.00 round trip) ≈ $1.50-$3.00 total.

**Target values** (per contract, per signal):
- E[PnL] > $0: Breakeven after costs (minimum)
- E[PnL] > $1.00: Decent — $1 per trade on MNQ
- E[PnL] > $2.00: Good
- E[PnL] > $5.00: Very good (roughly a 2.5-point average winner on MNQ)
- E[PnL] per signal * signals_per_day = daily expected PnL (the number that matters)

**When to compute**: Every 5 epochs. Quick sanity check.

**Computational cost**: Negligible — derived from direction accuracy and magnitude stats.

---

### 5.3 Cost-Adjusted Accuracy

**What it measures**: What accuracy threshold makes the model profitable after accounting for trading costs? This flips the question: instead of "is the model accurate enough?", it asks "given the model's average winner/loser size, what accuracy is needed?"

**Formula**:
```
breakeven_accuracy = avg_loss / (avg_win + avg_loss)
cost_adjusted_accuracy = actual_accuracy - breakeven_accuracy
```

If avg_win = 4 points ($8) and avg_loss = 3 points ($6), breakeven_accuracy = 6/(8+6) = 42.8%. If the model is 55% accurate, cost_adjusted_accuracy = 55% - 42.8% = 12.2% edge.

Now factor in costs: adjusted_breakeven = (avg_loss + costs) / (avg_win - costs + avg_loss + costs). With $2 round-trip cost: (6+2)/(8-2+6+2) = 8/14 = 57.1%. Now the 55% model is UNDERWATER.

**Target values**:
- Cost-adjusted accuracy > 0%: Profitable
- Cost-adjusted accuracy > 3%: Meaningful edge
- Cost-adjusted accuracy > 5%: Strong edge
- Cost-adjusted accuracy < 0%: Model loses money despite positive accuracy

**When to compute**: Every 5 epochs. Critical early warning metric.

**Computational cost**: Negligible.

---

### 5.4 Sharpe Ratio Approximation

**What it measures**: Annualized risk-adjusted return of a simulated strategy based on model predictions. Computed from the sequence of per-prediction returns.

**Formula**:
```
returns_i = direction_signal_i * actual_return_i - cost_per_trade
sharpe = mean(returns) / std(returns) * sqrt(signals_per_year)
```

For MNQ at 5-min bars: ~78 trading bars/day * 252 trading days = ~19,656 potential signals/year. But if you filter for high-confidence signals only, maybe 20-50/day = 5,000-12,500/year.

**Target values**:
- Sharpe > 0.5: Marginal but potentially tradeable
- Sharpe > 1.0: Good
- Sharpe > 1.5: Very good
- Sharpe > 2.0: Excellent — verify not overfit
- Sharpe > 3.0: Almost certainly overfit or look-ahead bias

**Critical: Use the Deflated Sharpe Ratio (DSR)** from Lopez de Prado to correct for:
1. Multiple trials (how many hyperparameter configs have you tried?)
2. Non-normal returns (fat tails in futures)
3. Short sample length

DSR formula computes P(observed SR > 0 | number_of_trials, skewness, kurtosis, sample_length). If DSR p-value > 0.05, the Sharpe is likely a false positive.

**When to compute**: Every 10-20 epochs (or on validation checkpoints only).

**Computational cost**: Low for basic Sharpe. DSR requires moments computation.

---

### 5.5 Information Ratio (IR)

**What it measures**: Risk-adjusted excess return vs a benchmark (buy-and-hold MNQ).

**Formula**: IR = mean(model_returns - benchmark_returns) / std(model_returns - benchmark_returns) * sqrt(ann_factor)

**Why it differs from Sharpe**: Sharpe measures absolute risk-adjusted return. IR measures your VALUE-ADD over a simple benchmark. A model with Sharpe 1.5 but IR 0.2 isn't adding much over buy-and-hold — the market was trending up.

**Target values**:
- IR > 0.0: Beating the benchmark on risk-adjusted basis
- IR > 0.3: Meaningfully better than benchmark
- IR > 0.5: Good active management (top quartile in traditional asset management)
- IR > 1.0: Exceptional

**When to compute**: Every 10-20 epochs.

**Computational cost**: Negligible.

---

### 5.6 Profit Factor

**What it measures**: Gross profit / Gross loss. Simple ratio of money made on winners to money lost on losers.

**Why it matters**: Intuitive and directly maps to account growth. A profit factor of 1.0 = breakeven. Unlike Sharpe, it's not influenced by trade frequency.

**Target values**:
- PF > 1.0: Breakeven
- PF > 1.2: Marginal
- PF > 1.5: Good
- PF > 2.0: Very good
- PF > 3.0: Investigate for overfitting

**When to compute**: Every 10 epochs.

**Computational cost**: Negligible.

---

## 6. Calibration for Trading

### 6.1 Brier Score

**What it measures**: Mean squared error of probabilistic predictions. For the Direction head: if the model outputs P(Long) = 0.70 and the actual outcome is Long (1.0), the Brier contribution is (0.70 - 1.0)^2 = 0.09.

**Formula**: BS = (1/N) * sum((p_i - o_i)^2)

**Why it matters for trading**: The Confluence head outputs a confidence score. If that score isn't calibrated, you can't use it for position sizing. A "90% confident" signal that's actually right 60% of the time leads to catastrophic oversizing.

**Target values**:
- BS < 0.25: Baseline (random guessing on balanced binary = 0.25)
- BS < 0.22: Better than random — signal present
- BS < 0.20: Good
- BS < 0.15: Very good
- BS < 0.10: Excellent

**Decomposition** (important!):
- Brier = Reliability + Resolution - Uncertainty
- **Reliability** (calibration): Low is good — predicted probabilities match actual frequencies
- **Resolution** (discrimination): High is good — predictions vary meaningfully
- **Uncertainty**: Fixed for a given dataset

Track reliability and resolution separately. A model can have good Brier but bad calibration (by having great resolution that overcomes poor reliability).

**When to compute**: Every epoch.

**Computational cost**: Negligible.

---

### 6.2 Expected Calibration Error (ECE)

**What it measures**: Weighted average of calibration gaps across probability bins. Bin predictions by confidence (e.g., 0-10%, 10-20%, ..., 90-100%), then for each bin: |avg_confidence - actual_accuracy|.

**Formula**: ECE = sum(n_bin / N * |accuracy_bin - confidence_bin|)

**Why it matters for trading**: ECE directly answers "can I trust the confidence numbers for position sizing?"

**Target values**:
- ECE < 0.05: Well calibrated — safe to use probabilities for sizing
- ECE < 0.10: Acceptable — use probabilities but with a buffer
- ECE < 0.15: Marginal — consider recalibrating (Platt scaling / isotonic regression)
- ECE > 0.15: Poorly calibrated — do NOT use raw probabilities for sizing

**When to compute**: Every 5-10 epochs (requires binning).

**Post-training recalibration**: If ECE > 0.10, apply Platt scaling (fit sigmoid on validation set) or isotonic regression. Both are cheap post-processing steps.

**Computational cost**: Low — O(n) with binning.

---

### 6.3 Log Loss (Binary Cross-Entropy)

**What it measures**: Logarithmic penalty for confident wrong predictions. A model that outputs P(Long) = 0.99 when the actual outcome is Short gets hammered by log loss.

**Formula**: LogLoss = -(1/N) * sum(y*log(p) + (1-y)*log(1-p))

**Why it matters for trading**: Log loss is a strictly proper scoring rule — the model minimizes log loss only by outputting its true belief. It's the natural loss function for Direction and Reversal heads.

**Target values**:
- LogLoss < 0.693: Better than random (random on balanced binary = ln(2) = 0.693)
- LogLoss < 0.68: Marginal
- LogLoss < 0.65: Good — meaningful direction prediction
- LogLoss < 0.60: Very good
- LogLoss < 0.50: Exceptional — verify not overfitting

**Lopez de Prado recommendation**: Use negative log loss rather than accuracy for hyperparameter tuning. Log loss penalizes overconfident wrong predictions, which are the most dangerous for trading.

**When to compute**: Every epoch (this is likely your training loss anyway).

**Computational cost**: Negligible.

---

### 6.4 Reliability Diagram Analysis

**What it measures**: Visual check of calibration. Plot predicted probability (x-axis) vs actual frequency (y-axis). Perfect calibration = diagonal line.

**Specific patterns to watch**:
- **Overconfident**: Curve below diagonal at high probabilities. Model says "80% Long" but it's actually 60%. Dangerous for sizing.
- **Underconfident**: Curve above diagonal. Model says "55% Long" but it's actually 70%. Leaving money on the table.
- **S-shaped**: Overconfident on strong signals, underconfident on weak. Common. Platt scaling fixes this.

**When to compute**: Every 20 epochs (visual diagnostic, not a single number).

**Computational cost**: Low.

---

## 7. Regime-Conditional Metrics

### 7.1 Per-Regime Direction Accuracy

**What it measures**: Break down Direction head accuracy by the Regime head's output. "How accurate is direction prediction during Trending vs Ranging vs Volatile markets?"

**Why it matters**: This is THE metric that reveals model fragility. A model with 56% overall accuracy might be 65% in trending markets and 45% in ranging markets. The solution: don't trade during ranging regimes.

**Expected patterns**:
- Trending regime accuracy > overall accuracy: Normal — trends are easier to predict
- Ranging regime accuracy < overall accuracy: Expected — ranging markets are noisy
- Volatile regime accuracy varies: Could go either way — depends on whether the model captures vol breakouts

**Target values**:
- Trending accuracy > 58%: Good
- Ranging accuracy > 50%: Acceptable (at least not losing)
- Volatile accuracy > 52%: Acceptable
- Max accuracy spread (best - worst regime) < 20%: Model is reasonably robust
- Max accuracy spread > 25%: Strong signal to filter trades by regime

**When to compute**: Every 10 epochs.

**Computational cost**: Low — stratified version of accuracy computation.

---

### 7.2 Per-Regime Sharpe Ratio

**What it measures**: Simulated Sharpe ratio of the model's signals, computed separately for each detected regime. Already planned in your Phase 3 Stage 4.

**Target values**:
- At least one regime Sharpe > 1.0: Model has a "sweet spot"
- Best regime Sharpe > 1.5: Strong regime-specific alpha
- Worst regime Sharpe > -0.5: Model isn't catastrophically wrong anywhere
- Spread between best and worst < 2.0: Reasonably balanced

**When to compute**: Every 20 epochs.

**Computational cost**: Low-moderate.

---

### 7.3 Per-Regime Calibration (ECE by Regime)

**What it measures**: Is the model's probability calibration consistent across regimes? A model might be well-calibrated in trends but terribly calibrated in ranges.

**Why it matters**: If you're using confidence for position sizing, and confidence is miscalibrated in volatile regimes (exactly when sizing matters most), you'll blow up.

**Target values**:
- ECE per regime < 0.10: Well calibrated across conditions
- Max ECE across regimes < 0.15: No regime has terrible calibration
- ECE(volatile) - ECE(trending) < 0.05: Calibration is stable

**When to compute**: Every 20 epochs.

**Computational cost**: Low.

---

### 7.4 Regime Transition Alpha

**What it measures**: Average P&L in the N bars following a regime transition. Do transitions contain tradeable information?

**Why it matters**: If the model detects a shift from Ranging to Trending, that moment is when directional strategies should activate. The transition itself may be the most valuable signal.

**Target values**:
- Mean 5-bar return after transition > 0.001 (in return terms): Transitions have content
- Mean return after Ranging→Trending transition > 2x mean return after Random transition: Specific transitions are informative
- P(positive return | transition to Trending) > 55%: Trending transition is directionally useful

**When to compute**: Every 20 epochs.

**Computational cost**: Low.

---

## 8. Correlation with Live Trading Performance

### 8.1 What Research Says (Lopez de Prado & Others)

**Key finding from "Advances in Financial Machine Learning"**: Most training metrics DO NOT predict live performance. The primary reason is overfitting — not model overfitting, but researcher overfitting (trying too many configurations and selecting the one that looks best on the test set).

**Lopez de Prado's Hierarchy** (metrics most to least predictive of live performance):

1. **Deflated Sharpe Ratio** (most predictive): Corrects for number of trials, non-normality, and sample length. A DSR p-value < 0.05 is the minimum bar.

2. **Combinatorial Purged Cross-Validation (CPCV)**: Generates multiple synthetic backtest paths from held-out data. The distribution of Sharpe ratios across paths predicts live performance far better than a single train/test split.

3. **Feature Importance Stability**: If the model's top features change dramatically across CV folds, the model is fragile. Measure via weighted Kendall tau between feature rankings across folds.

4. **Information Ratio on OOS data**: Specifically on data the model has never seen, with proper purging and embargo.

5. **Calibration (ECE)**: Well-calibrated models degrade more gracefully in live trading because their position sizing remains rational.

**What does NOT predict live performance**:
- In-sample accuracy (nearly zero correlation with live returns)
- Single test-set Sharpe (massively overfit through hyperparameter search)
- Raw accuracy without cost adjustment
- Any metric without proper time-series cross-validation

### 8.2 The Probability of Backtest Overfitting (PBO)

**From Bailey & Lopez de Prado**: Given N hyperparameter trials, compute the probability that the "best" configuration is actually overfit.

**Formula**: Uses CPCV to generate S synthetic backtest paths, then computes: PBO = fraction of paths where the "best" in-sample configuration underperforms the median out-of-sample.

**Target values**:
- PBO < 0.10: Low overfitting risk — configuration likely generalizes
- PBO < 0.25: Acceptable risk
- PBO > 0.50: Coin flip — the "best" model is probably overfit
- PBO > 0.75: Almost certainly overfit

**When to compute**: After hyperparameter search is complete (not every epoch). Expensive.

**Computational cost**: HIGH — requires S * K model re-trainings where S = number of CPCV splits and K = number of hyperparameter configurations.

---

### 8.3 Feature Importance Stability

**What it measures**: Consistency of feature rankings across cross-validation folds.

**Formula**: Weighted Kendall tau between feature importance vectors from different CV folds.

**Target values**:
- Mean pairwise Kendall tau > 0.6: Stable features — model will likely generalize
- Mean tau > 0.4: Acceptable stability
- Mean tau < 0.3: Unstable — model is fitting noise, will fail live

**When to compute**: After cross-validation runs.

**Computational cost**: Moderate (requires multiple training runs).

---

### 8.4 Walk-Forward Consistency

**What it measures**: Stability of key metrics across walk-forward windows. If the model's Sharpe is 2.0 in window 1, 0.1 in window 2, and 1.5 in window 3, it's unreliable.

**Metrics**:
- Coefficient of variation of Sharpe across windows: std(Sharpe) / mean(Sharpe)
- Percentage of windows with positive Sharpe
- Correlation between window performance and market regime

**Target values**:
- CV of Sharpe < 1.0: Reasonably consistent
- % windows with Sharpe > 0: > 60%
- % windows with Sharpe > 0.5: > 40%
- Performance correlated with specific regime (r > 0.5): Not necessarily bad — it means the model works in one regime and you should filter

**When to compute**: After walk-forward analysis.

**Computational cost**: Moderate (requires W training runs).

---

## 9. Multi-Head Interaction Metrics

### 9.1 Confluence Score Validation

**What it measures**: Does the Confluence head's agreement score actually predict trade quality?

**Method**: Bucket trades by confluence score (e.g., Low: 0-0.33, Medium: 0.34-0.66, High: 0.67-1.0), then compute accuracy and average P&L per bucket.

**Target values**:
- Accuracy(High confluence) > Accuracy(Low confluence) + 3%: Confluence is informative
- E[PnL](High confluence) > 2x E[PnL](Low confluence): Confluence doubles profit
- Monotonicity: accuracy should increase with each confluence bucket. If it doesn't, the confluence head is broken.

**When to compute**: Every 20 epochs.

**Computational cost**: Low.

---

### 9.2 Head Correlation Matrix

**What it measures**: Pairwise correlation between all head outputs. If Direction and Trend are 0.95 correlated, one head is redundant.

**Target values**:
- No pair correlation > 0.80: Each head provides unique information
- Direction-Trend correlation: 0.3-0.7 (should be related but not identical)
- Magnitude-Volatility correlation: 0.4-0.8 (naturally related — high vol = high magnitude)
- Reversal-Direction: should be LOW or even slightly negative

**When to compute**: Every 10 epochs.

**Computational cost**: Negligible.

---

### 9.3 Multi-Task Loss Weighting (Kendall Uncertainty Weights)

**What it measures**: Are the 7 prediction heads balanced in their contribution to total loss? Using homoscedastic uncertainty weighting (Kendall, Gal & Cipolla 2018), each head's loss is weighted by a learned inverse-variance parameter.

**Method**: Track the learned sigma parameters per head during training. If one head's sigma grows very large, the model is "giving up" on that head.

**What to monitor**:
- Sigma values per head over training: should stabilize, not diverge
- Relative loss contribution: no single head should dominate > 50% of total loss
- Head gradient magnitudes: no head should have consistently near-zero gradients (dead head)

**When to compute**: Every epoch (just log the sigma parameters).

**Computational cost**: Negligible.

---

## 10. Reversal Head Metrics

### 10.1 Reversal Precision at Threshold

**What it measures**: When the Reversal head says P(reversal) > threshold, how often does a direction change actually occur within N bars?

**Why it matters**: False reversal signals cause premature exits from profitable trends. True reversal signals enable early entry into the new direction.

**Target values** (at threshold = 0.6):
- Precision > 0.35: Better than base rate for most instruments
- Precision > 0.45: Good — actionable signal
- Precision > 0.55: Very good
- Recall > 0.30: Catching at least 30% of actual reversals

**Additional metric**: Average bars between signal and actual reversal (lead time). Positive lead time = predictive, useful for trade management. Target: 3-10 bars lead time.

**When to compute**: Every 10 epochs.

**Computational cost**: Low.

---

### 10.2 Reversal Calibration

**What it measures**: When the model says 70% reversal probability, does a reversal happen ~70% of the time? Same calibration framework as Section 6 but specifically for the Reversal head.

**This is critical**: The Reversal head outputs a probability. If it's miscalibrated, you can't combine it reliably with other heads in the Confluence calculation.

**Target values**:
- ECE(reversal) < 0.10: Well calibrated
- Brier(reversal) < 0.25: Better than random

**When to compute**: Every 10 epochs.

**Computational cost**: Negligible.

---

## 11. Computational Budget Summary

| Metric Category | Compute Every | Cost per Eval | Priority |
|---|---|---|---|
| Direction (MCC, class accuracy, kappa) | Every epoch | ~1ms | P0 — always |
| LogLoss, Brier Score | Every epoch | ~1ms | P0 — always |
| Precision/Recall per class | Every epoch | ~2ms | P0 — always |
| Head loss weights / sigma | Every epoch | ~0ms (log only) | P0 — always |
| MAPE, magnitude correlation | Every epoch | ~5ms | P0 — always |
| IC (rolling window) | Every 5 epochs | ~50ms | P1 — frequent |
| Expected PnL, cost-adjusted accuracy | Every 5 epochs | ~10ms | P1 — frequent |
| ECE, reliability diagram | Every 5-10 epochs | ~20ms | P1 — frequent |
| Regime clustering quality | Every epoch | ~100ms | P1 — frequent |
| Sequential accuracy (DW stat) | Every 10-20 epochs | ~10ms | P2 — periodic |
| Regime persistence, transition metrics | Every 10-20 epochs | ~30ms | P2 — periodic |
| Per-regime conditional accuracy | Every 10 epochs | ~20ms | P2 — periodic |
| Multi-horizon trend accuracy | Every 10 epochs | ~50ms | P2 — periodic |
| Confluence validation | Every 20 epochs | ~20ms | P2 — periodic |
| Head correlation matrix | Every 10 epochs | ~5ms | P2 — periodic |
| Sharpe approximation | Every 10-20 epochs | ~30ms | P2 — periodic |
| Profit factor | Every 10 epochs | ~10ms | P2 — periodic |
| Walk-forward consistency | Post-training | ~minutes | P3 — post-training |
| CPCV / PBO | Post hyperparameter search | ~hours | P3 — post-training |
| Feature importance stability | Post-CV | ~minutes | P3 — post-training |
| Deflated Sharpe Ratio | Post-training | ~100ms | P3 — post-training |

---

## 12. Implementation Mapping to Existing Architecture

Your current `evaluation.py` has Stages 1-2 (regime quality + significance). Here's where each new metric fits:

**Extend `emit_metric()` calls during training** (Python training loop):
- MCC, class-conditional accuracy, kappa, precision/recall → every epoch
- Log loss, Brier score → every epoch
- MAPE, magnitude Spearman rho → every epoch
- Head sigma values → every epoch
- IC → every 5 epochs

**Extend `evaluation.py` stages**:
- Stage 3 (OOS): Add sequential accuracy (DW stat), OOS calibration (ECE)
- Stage 4 (conditioned performance): Add per-regime direction accuracy, per-regime calibration
- New Stage 6: Multi-head interaction metrics (confluence validation, head correlation, reversal calibration)

**New `financial_metrics.py`**:
- Expected PnL per prediction
- Cost-adjusted accuracy (with MNQ tick economics)
- Sharpe approximation
- Deflated Sharpe Ratio
- Profit factor
- Information Ratio

**Extend `training_metrics` SQLite table**: Already supports arbitrary metric names via `metricName` column. Just emit new names.

**Extend `visualizations.json`**: Add components for:
- `direction-quality-dashboard` (MCC, class accuracy, kappa, streak analysis)
- `financial-pnl-dashboard` (E[PnL], cost-adjusted accuracy, Sharpe, PF)
- `calibration-dashboard` (Brier, ECE, reliability diagram per head)
- `regime-conditional-dashboard` (per-regime accuracy, Sharpe, calibration)
- `multi-head-interaction` (confluence validation, head correlation matrix)

---

## 13. Key References

1. **Lopez de Prado, M. (2018). Advances in Financial Machine Learning.** Wiley.
   - Deflated Sharpe Ratio, CPCV, meta-labeling, feature importance
   - Central message: most ML failures come from bad validation, not bad models

2. **Bailey, D. & Lopez de Prado, M. (2014). The Deflated Sharpe Ratio.**
   - Corrects for selection bias and multiple testing in Sharpe ratio evaluation

3. **Bailey, D. et al. (2014). The Probability of Backtest Overfitting.**
   - Quantifies overfitting risk across hyperparameter trials

4. **Kendall, A., Gal, Y. & Cipolla, R. (2018). Multi-Task Learning Using Uncertainty to Weigh Losses.**
   - Homoscedastic uncertainty for balancing multi-head loss functions

5. **Chicco, D. & Jurman, G. (2020). The advantages of MCC over F1 score and accuracy.**
   - MCC is the most reliable metric for binary classification on imbalanced data

6. **Two Sigma (2021). A Machine Learning Approach to Regime Modeling.**
   - GMM for regime detection, log-likelihood cross-validation for cluster count

7. **Chuan, Y. & Wu, L. (2020). Information Coefficient as a Performance Measure.**
   - ICs of 0.02-0.08 are typical for good models; ICs > 0.1 are rare; volatility of realized ICs exceeds means by 3-11x

---

## Sources

- [Advances in Financial Machine Learning — Notes](https://reasonabledeviations.com/notes/adv_fin_ml/)
- [Information Coefficient (IC) in Finance](https://www.emergentmind.com/topics/information-coefficient-ic)
- [Brier Score and Model Calibration](https://neptune.ai/blog/brier-score-and-model-calibration)
- [The Deflated Sharpe Ratio — SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551)
- [The Probability of Backtest Overfitting — SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253)
- [Multi-Task Learning Using Uncertainty — arXiv](https://arxiv.org/abs/1705.07115)
- [MCC vs F1 Score — BMC Genomics](https://link.springer.com/article/10.1186/s12864-019-6413-7)
- [Two Sigma: ML Approach to Regime Modeling](https://www.twosigma.com/articles/a-machine-learning-approach-to-regime-modeling/)
- [Utility-Weighted Forecasting and Calibration — arXiv](https://arxiv.org/pdf/2601.07852)
- [Deep Learning for Short-Term Equity Trend Forecasting](https://arxiv.org/html/2508.14656v1)
- [Directional Forecasting for Forex — Springer](https://link.springer.com/article/10.1007/s44163-025-00424-4)
- [Volatility Prediction Review — ScienceDirect](https://www.sciencedirect.com/science/article/pii/S1057521924001534)
- [Market Regime Detection — LSEG](https://developers.lseg.com/en/article-catalog/article/market-regime-detection)
- [State Street: Decoding Market Regimes with ML (2025)](https://www.ssga.com/library-content/assets/pdf/global/pc/2025/decoding-market-regimes-with-machine-learning.pdf)
- [Sharpe Ratio-Optimized Deep Learning](https://ojs.apspublisher.com/index.php/apemr/article/view/210)
- [Reversal Prediction in FX — ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0957417421000865)
- [Enhancing Trend Reversal Prediction — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10828646/)
- [IC as Performance Measure — arXiv](https://arxiv.org/pdf/2010.08601)
- [Durbin-Watson Statistic — Wikipedia](https://en.wikipedia.org/wiki/Durbin%E2%80%93Watson_statistic)
- [Expected Calibration Error Overview](https://www.emergentmind.com/topics/expected-calibration-error-ece)
- [MNQ Tick Value and Contract Specs](https://www.quantvps.com/blog/mnq-tick-value)
