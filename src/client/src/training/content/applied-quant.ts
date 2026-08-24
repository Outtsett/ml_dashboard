import type { LearningPath } from "@/training/lib/types";

export const appliedQuantPath: LearningPath = {
  id: "applied-quant",
  title: "Applied Quant Finance",
  description:
    "Bridge the gap between ML models and profitable trading systems. Master financial feature engineering, rigorous backtesting methodology, risk metrics, and portfolio optimization â€” the practical toolkit every quant trader needs.",
  icon: "TrendingUp",
  color: "cyan",
  difficulty: "advanced",
  estimatedHours: 22,
  modules: [
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Module 1 â€” Feature Engineering & Backtesting
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      id: "feat-backtest",
      title: "Feature Engineering & Backtesting",
      description:
        "Transform raw OHLCV data into predictive features and validate trading strategies with walk-forward methods that respect the temporal structure of financial markets.",
      lessons: [
        // â”€â”€ Lesson 1: Financial Feature Engineering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        {
          id: "aq-features",
          title: "Financial Feature Engineering",
          description:
            "Build a comprehensive feature set from raw price data: technical indicators, rolling statistics, return transformations, and feature selection techniques tailored for time-series prediction.",
          estimatedMinutes: 85,
          difficulty: "advanced",
          relatedModels: ["xgboost", "random-forest"],
          sections: [
            {
              type: "objective",
              title: "Learning Objectives",
              description:
                "Master the transformation of raw OHLCV data into stationary, predictive features for machine learning models. Learn to compute technical indicators with mathematical rigor, apply multi-scale rolling statistics, and use feature selection to build parsimonious feature sets that generalize out-of-sample.",
              keyTakeaways: [
                "Raw prices P_t are I(1) non-stationary â€” always transform to log-returns r_t = ln(P_t/P_{t-1}), percentage changes, or z-scores before modeling",
                "Technical indicators (RSI, MACD, Bollinger Bands) encode momentum, trend, and volatility into bounded, comparable features that capture market microstructure",
                "Rolling statistics (Î¼, Ïƒ, skew, kurtosis) over windows w âˆˆ {5, 20, 60, 120} capture multi-scale market dynamics from intraweek to semi-annual",
                "Feature selection via mutual information I(X; Y), permutation importance, or SHAP prevents overfitting to noise and reduces curse of dimensionality",
                "Look-ahead bias must be eliminated â€” all features must use only past data, respecting the causal arrow of time",
                "Forex-specific features: bid-ask spread proxies, time-of-day indicators, intermarket correlations, carry differentials",
                "Feature matrix should aim for 30-80 dimensions after selection â€” parsimony beats exhaustive feature generation",
                "Always validate stationarity with ADF test: Hâ‚€: unit root present (non-stationary); reject if p < 0.05",
              ],
            },
            {
              type: "theory",
              title: "Stationarity & Return Transformations",
              content:
                "Price series P_t in financial markets are integrated of order 1, denoted I(1). Formally, a process is I(1) if its first difference is stationary I(0), but the level series is non-stationary. The Augmented Dickey-Fuller test tests the null hypothesis Hâ‚€: Î´ = 0 in the regression:\n\nÎ”P_t = Î± + Î´P_{t-1} + Î£ Î²_i Î”P_{t-i} + Îµ_t\n\nIf we fail to reject Hâ‚€ (p > 0.05), the series has a unit root â€” it's non-stationary with time-varying mean and variance. ML models trained on non-stationary data learn spurious correlations that collapse out-of-sample.\n\n**Return Transformations:**\n\n1. **Simple return**: r_t = (P_t âˆ’ P_{tâˆ’1}) / P_{tâˆ’1} = P_t/P_{tâˆ’1} âˆ’ 1\n   - Bounded below by âˆ’1 (asset can't lose more than 100%)\n   - Non-additive: r_{0â†’2} â‰  r_{0â†’1} + r_{1â†’2}\n   - Asymmetric: +50% then âˆ’50% leaves you at 75%, not 100%\n\n2. **Log return**: r_t = ln(P_t / P_{tâˆ’1})\n   - Symmetric: ln(1.1) â‰ˆ 0.0953, ln(0.9) â‰ˆ âˆ’0.1054\n   - Additive over time: r_{0â†’2} = r_{0â†’1} + r_{1â†’2}\n   - Approximately Gaussian for short horizons (Î”t â‰ª 1)\n   - Used in practice because r_{0â†’T} = Î£ r_t, enabling easy aggregation\n\n3. **Z-score normalization**: z_t = (r_t âˆ’ Î¼Ì‚_w) / ÏƒÌ‚_w\n   - Î¼Ì‚_w = rolling mean over window w\n   - ÏƒÌ‚_w = rolling std over window w\n   - Makes returns comparable across volatility regimes\n   - A 1% move in a Ïƒ = 0.3% regime is z â‰ˆ 3.3 (extreme), but in Ïƒ = 2% regime it's z = 0.5 (normal)\n\n**Numerical Example (EUR/USD):**\nDay 1: P = 1.0850, Day 2: P = 1.0920\n- Simple return: r = (1.0920 âˆ’ 1.0850) / 1.0850 = 0.00645 = 0.645%\n- Log return: r = ln(1.0920 / 1.0850) = ln(1.00645) â‰ˆ 0.00643\n- If rolling_mean(20d) = 0.0002, rolling_std(20d) = 0.004, then z = (0.00643 âˆ’ 0.0002) / 0.004 = 1.56\n\nThe z-score tells us this move is 1.56 standard deviations above the recent local mean â€” a moderately strong bullish signal normalized for regime.",
            },
            {
              type: "theory",
              title: "Technical Indicators: Momentum, Trend, Mean-Reversion",
              content:
                "Technical indicators transform price/volume into bounded, interpretable signals. We categorize them by what market dynamic they capture:\n\n**Momentum Indicators:**\n\n1. **RSI (Relative Strength Index)**:\n   - RSI(n) = 100 âˆ’ 100/(1 + RS), where RS = avg_gain_n / avg_loss_n\n   - Bounded âˆˆ [0, 100]. RSI > 70 â†’ overbought, RSI < 30 â†’ oversold\n   - Derivation: Let U_t = max(P_t âˆ’ P_{tâˆ’1}, 0) be the up-move, D_t = max(P_{tâˆ’1} âˆ’ P_t, 0) be the down-move.\n   - avg_gain = EMA(U_t, n), avg_loss = EMA(D_t, n)\n   - RSI asymptotes to 100 as avg_loss â†’ 0 (pure rally), to 0 as avg_gain â†’ 0 (pure selloff)\n\n2. **Stochastic Oscillator**:\n   - %K = 100 Ã— (C âˆ’ L_n) / (H_n âˆ’ L_n)\n   - C = current close, L_n = lowest low over n periods, H_n = highest high\n   - Measures where price closed relative to recent range. %K â†’ 100 means close near top of range (bullish momentum)\n\n**Trend Indicators:**\n\n1. **MACD (Moving Average Convergence Divergence)**:\n   - MACD = EMA(12) âˆ’ EMA(26)\n   - Signal = EMA(MACD, 9)\n   - Histogram = MACD âˆ’ Signal\n   - EMA formula: EMA_t = Î±Â·P_t + (1âˆ’Î±)Â·EMA_{t-1}, where Î± = 2/(n+1)\n   - Positive MACD â†’ short-term momentum > long-term (bullish)\n   - MACD crossing above Signal â†’ bullish crossover (buy signal)\n\n2. **ADX (Average Directional Index)**:\n   - Quantifies trend strength âˆˆ [0, 100]. ADX > 25 indicates a trending market, ADX < 20 indicates ranging.\n   - Derived from +DI and âˆ’DI (directional indicators), which measure upward vs downward price movement.\n\n**Mean-Reversion Indicators:**\n\n1. **Bollinger Bands**:\n   - Middle = SMA(20)\n   - Upper = SMA(20) + 2Â·Ïƒ(20)\n   - Lower = SMA(20) âˆ’ 2Â·Ïƒ(20)\n   - %B = (P âˆ’ Lower) / (Upper âˆ’ Lower)\n   - %B > 1 â†’ price above upper band (potential reversal down)\n   - %B < 0 â†’ price below lower band (potential reversal up)\n   - %B âˆˆ [0, 1] â†’ price within bands (normal regime)\n\n**Volatility Indicators:**\n\n1. **ATR (Average True Range)**:\n   - TR_t = max(H_t âˆ’ L_t, |H_t âˆ’ C_{tâˆ’1}|, |L_t âˆ’ C_{tâˆ’1}|)\n   - ATR(n) = EMA(TR, n)\n   - Measures volatility in price units. Used for position sizing: risking 1 ATR per trade normalizes across instruments.\n\n**Numerical Example (EUR/USD, RSI calculation):**\nSuppose 14-day gains average 0.0005 (5 pips), 14-day losses average 0.0003 (3 pips).\n- RS = 0.0005 / 0.0003 = 1.667\n- RSI = 100 âˆ’ 100/(1 + 1.667) = 100 âˆ’ 37.5 = 62.5\nRSI = 62.5 indicates bullish momentum but not yet overbought (< 70).",
            },
            {
              type: "theory",
              title: "Multi-Scale Rolling Statistics",
              content:
                "Financial markets exhibit multi-scale dynamics â€” patterns at intraday, daily, weekly, monthly, quarterly frequencies. Capturing these requires rolling statistics over multiple windows w.\n\n**Core Statistics:**\n\n1. **Rolling Mean**: Î¼_w = (1/w) Î£_{i=0}^{w-1} r_{t-i}\n   - Estimates local drift. In FX, often close to zero (efficient market), but can deviate during interventions or regime shifts.\n\n2. **Rolling Volatility**: Ïƒ_w = sqrt((1/(wâˆ’1)) Î£ (r_{t-i} âˆ’ Î¼_w)Â²)\n   - Annualized: Ïƒ_annual = Ïƒ_daily Ã— sqrt(252)\n   - Volatility clustering: high Ïƒ_w tends to persist (GARCH effect).\n\n3. **Rolling Skewness**: skew_w = E[(r âˆ’ Î¼)Â³] / ÏƒÂ³\n   - Measures asymmetry. Negative skew (left tail) â†’ crash risk. Positive skew â†’ persistent rallies.\n   - FX often exhibits near-zero skew, but during crises skew can spike to âˆ’2 or lower.\n\n4. **Rolling Kurtosis**: kurt_w = E[(r âˆ’ Î¼)â´] / Ïƒâ´\n   - Excess kurtosis = kurt âˆ’ 3. Gaussian has kurt = 3.\n   - Financial returns have fat tails: kurt âˆˆ [5, 10] typical. Signals tail risk, important for risk management.\n\n5. **Max Drawdown over window w**: MDD_w = max_{t' âˆˆ [tâˆ’w, t]} (peak_{t'} âˆ’ P_t) / peak_{t'}\n   - Measures maximum peak-to-trough decline. Used to assess strategy pain threshold.\n\n**Window Selection:**\n- w = 5 â†’ intraweek dynamics (1 trading week)\n- w = 20 â†’ monthly dynamics (~1 month)\n- w = 60 â†’ quarterly dynamics (~3 months)\n- w = 120 â†’ semi-annual dynamics (~6 months)\n\nStacking features at multiple scales allows the model to learn which time horizon is predictive for the current regime.\n\n**Numerical Example (EUR/USD log returns, w = 20):**\nSuppose daily log returns over 20 days: rÌ„ = [0.0002, âˆ’0.0015, 0.0008, ..., 0.0012]\n- Î¼_20 = mean(rÌ„) = 0.00035\n- Ïƒ_20 = std(rÌ„) = 0.0042\n- Ïƒ_annual = 0.0042 Ã— sqrt(252) â‰ˆ 0.0667 = 6.67% annualized volatility\n- skew_20 = âˆ’0.3 (slight negative skew, modest left tail)\n- kurt_20 = 4.2 (excess kurtosis = 1.2, fatter tails than Gaussian)\n\nThese statistics feed as features: vol_20d = 0.0667, skew_20d = âˆ’0.3, kurt_20d = 4.2.",
            },
            {
              type: "theory",
              title: "Feature Selection: Filter, Wrapper, Embedded",
              content:
                "High-dimensional feature spaces suffer from the curse of dimensionality: overfitting, computational cost, interpretability loss. Feature selection reduces dimensionality while preserving predictive power.\n\n**Filter Methods (univariate ranking):**\n\n1. **Mutual Information**: I(X; Y) = Î£ Î£ p(x, y) log(p(x,y) / (p(x)p(y)))\n   - Measures information shared between feature X and target Y.\n   - I(X; Y) = 0 â†’ X and Y independent (X useless)\n   - I(X; Y) > 0 â†’ X provides information about Y\n   - Non-parametric, captures non-linear relationships\n   - Rank features by I(X_i; Y), keep top k\n\n2. **Correlation Thresholding**:\n   - Compute pairwise |Ï_{ij}| for all feature pairs\n   - If |Ï_{ij}| > 0.95, drop feature j (or whichever has lower I(X_j; Y))\n   - Removes redundancy, improves interpretability\n\n**Wrapper Methods (model-based search):**\n\n1. **Recursive Feature Elimination (RFE)**:\n   - Train model on all features, rank by importance (e.g., tree Gini importance)\n   - Remove bottom k% features\n   - Retrain, repeat until performance degrades\n   - Greedy search over feature subsets\n\n2. **Sequential Forward Selection**:\n   - Start with empty set\n   - Add feature that maximizes cross-validated metric\n   - Repeat until no improvement\n\n**Embedded Methods (regularization during training):**\n\n1. **L1 Regularization (Lasso)**:\n   - Loss = MSE + Î» Î£ |w_i|\n   - L1 penalty drives some w_i â†’ 0, performing feature selection\n   - Î» controls sparsity: higher Î» â†’ fewer features\n\n2. **Tree-based Feature Importance**:\n   - Random Forest / XGBoost compute importance via:\n     - Gini importance: Î£ over splits how much feature X_i reduces impurity\n     - Permutation importance: shuffle X_i, measure drop in accuracy\n   - SHAP values: Shapley values from game theory, unbiased attribution\n   - Drop features with importance < threshold\n\n**Practical Workflow:**\n1. Compute 100+ candidate features\n2. Drop features with |Ï| > 0.95 (correlation filter) â†’ ~70 remain\n3. Rank by mutual information, keep top 50\n4. Train XGBoost, compute SHAP importance\n5. Drop bottom 30% (SHAP < 0.01) â†’ final set of 35 features\n6. Validate on walk-forward: does reducing from 70 â†’ 35 improve out-of-sample Sharpe?\n\n**Numerical Example:**\nSuppose feature set: [rsi_14, macd, vol_20d, vol_60d, skew_20d]\n- Mutual information: I(rsi_14; Y) = 0.12, I(macd; Y) = 0.08, I(vol_20d; Y) = 0.15, I(vol_60d; Y) = 0.14, I(skew_20d; Y) = 0.03\n- Rank: vol_20d (0.15) > vol_60d (0.14) > rsi_14 (0.12) > macd (0.08) > skew_20d (0.03)\n- Correlation: Ï(vol_20d, vol_60d) = 0.88 (keep both), Ï(rsi_14, macd) = 0.35 (keep both)\n- If feature budget is 3, keep: vol_20d, vol_60d, rsi_14",
            },
            {
              type: "intuition",
              title: "Building a Weather Station for Markets",
              content:
                "Predicting tomorrow's weather from today's temperature alone is unreliable. But a weather station measures temperature, humidity, pressure, wind speed, and cloud cover â€” each capturing a different atmospheric dynamic. Financial feature engineering works the same way: RSI is your 'momentum barometer,' Bollinger %B is the 'mean-reversion humidity gauge,' ATR is the 'volatility wind speed,' and rolling kurtosis is the 'tail-risk cloud detector.' No single instrument is sufficient, but together they give your ML model a rich, multi-dimensional view of market conditions.\n\nJust as a meteorologist discards broken instruments (noisy features), feature selection removes redundant or uninformative signals. And just as you wouldn't use a barometer reading from last year to predict today's weather, you must respect temporal ordering â€” all features must be computed using only past data to avoid look-ahead bias.",
              emoji: "ðŸŒ¤ï¸",
            },
            {
              type: "intuition",
              title: "The Feature Selection Paradox",
              content:
                "More data is always better, right? Not with features. Imagine you're trying to predict whether it will rain by looking at 10,000 random variables â€” most of them coin flips. Sure, a few will correlate with rain by pure chance (spurious correlation), and your model will latch onto them. But these patterns are noise, not signal, and they'll vanish out-of-sample.\n\nThis is the curse of dimensionality: in high-dimensional spaces, most points are equidistant from each other (everything looks like noise), and random correlations dominate. Feature selection is like asking an expert meteorologist to throw out the coin flips and keep only the real instruments (barometer, humidity, wind). Fewer, high-quality features beat a bloated, noisy feature set every time.\n\nIn practice: 30-50 well-chosen features often outperform 200+ kitchen-sink features. Less is more.",
              emoji: "ðŸŽ¯",
            },
            {
              type: "code",
              title: "Computing Indicator Features from OHLCV",
              language: "python",
              code: `import pandas as pd
import numpy as np

def compute_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Build ML features from an OHLCV DataFrame.
    Columns required: open, high, low, close, volume
    Returns: DataFrame with ~50 features (before selection)
    """
    c = df["close"]
    h = df["high"]
    l = df["low"]
    o = df["open"]
    v = df["volume"]

    feat = pd.DataFrame(index=df.index)

    # â”€â”€ Return transformations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    feat["log_return"] = np.log(c / c.shift(1))
    feat["log_return_sq"] = feat["log_return"] ** 2  # realized variance proxy
    
    for w in [5, 20, 60]:
        feat[f"return_{w}d"] = c.pct_change(w)
        rolling_mean = feat["log_return"].rolling(w).mean()
        rolling_std = feat["log_return"].rolling(w).std()
        feat[f"zscore_{w}d"] = (feat["log_return"] - rolling_mean) / rolling_std

    # â”€â”€ RSI(14) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    delta = c.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gain / loss
    feat["rsi_14"] = 100 - 100 / (1 + rs)

    # â”€â”€ MACD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    ema12 = c.ewm(span=12, adjust=False).mean()
    ema26 = c.ewm(span=26, adjust=False).mean()
    feat["macd"] = ema12 - ema26
    feat["macd_signal"] = feat["macd"].ewm(span=9, adjust=False).mean()
    feat["macd_hist"] = feat["macd"] - feat["macd_signal"]

    # â”€â”€ Bollinger Bands %B â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    for w in [10, 20]:
        sma = c.rolling(w).mean()
        std = c.rolling(w).std()
        upper = sma + 2 * std
        lower = sma - 2 * std
        feat[f"boll_pctb_{w}"] = (c - lower) / (upper - lower)
        feat[f"boll_width_{w}"] = (upper - lower) / sma  # volatility measure

    # â”€â”€ ATR(14) â€” Average True Range â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    tr = pd.concat([
        h - l,
        (h - c.shift(1)).abs(),
        (l - c.shift(1)).abs(),
    ], axis=1).max(axis=1)
    feat["atr_14"] = tr.ewm(span=14, adjust=False).mean()
    feat["atr_pct"] = feat["atr_14"] / c  # ATR as % of price

    # â”€â”€ Stochastic Oscillator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    for w in [14, 28]:
        low_min = l.rolling(w).min()
        high_max = h.rolling(w).max()
        feat[f"stoch_{w}"] = 100 * (c - low_min) / (high_max - low_min)

    # â”€â”€ Rolling statistics at multiple scales â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    for w in [20, 60, 120]:
        roll = feat["log_return"].rolling(w)
        feat[f"vol_{w}d"] = roll.std() * np.sqrt(252)  # annualized
        feat[f"skew_{w}d"] = roll.skew()
        feat[f"kurt_{w}d"] = roll.kurt()
        # Max drawdown over window
        cummax = c.rolling(w).max()
        feat[f"mdd_{w}d"] = (c - cummax) / cummax

    # â”€â”€ Volume features â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    feat["vol_ratio"] = v / v.rolling(20).mean()
    feat["vol_std"] = v.rolling(20).std() / v.rolling(20).mean()  # volume volatility

    # â”€â”€ Intraday range features â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    feat["hl_range"] = (h - l) / c  # high-low range as % of close
    feat["oc_range"] = (c - o) / o  # open-close return

    return feat.dropna()


# â”€â”€ Example: ADF test for stationarity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
from statsmodels.tsa.stattools import adfuller

def check_stationarity(series: pd.Series, name: str):
    result = adfuller(series.dropna(), autolag='AIC')
    print(f"{name}: ADF statistic = {result[0]:.4f}, p-value = {result[1]:.4f}")
    if result[1] < 0.05:
        print(f"  âœ“ Reject H0: {name} is stationary (p < 0.05)")
    else:
        print(f"  âœ— Fail to reject H0: {name} is non-stationary (p >= 0.05)")


# â”€â”€ Usage example â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
np.random.seed(42)
n = 500
dates = pd.bdate_range("2023-01-01", periods=n)
price = 1.08 + np.cumsum(np.random.normal(0, 0.002, n))
ohlcv = pd.DataFrame({
    "open": price + np.random.normal(0, 0.0005, n),
    "high": price + np.abs(np.random.normal(0, 0.003, n)),
    "low": price - np.abs(np.random.normal(0, 0.003, n)),
    "close": price,
    "volume": np.random.lognormal(10, 0.5, n).astype(int),
}, index=dates)

features = compute_features(ohlcv)
print(f"Feature matrix: {features.shape}")
print(f"Sample features (last 3 rows):\\n{features.tail(3)[['rsi_14', 'macd_hist', 'vol_20d', 'skew_60d']].to_string()}\\n")

# Check stationarity
check_stationarity(ohlcv["close"], "Raw Price")
check_stationarity(features["log_return"], "Log Return")
check_stationarity(features["rsi_14"], "RSI(14)")`,
              explanation:
                "This function generates ~50 features from OHLCV: return transformations at multiple horizons, RSI/MACD/Bollinger/Stochastic indicators, ATR-based volatility, multi-scale rolling statistics (vol, skew, kurtosis, drawdown), and volume features. The ADF test confirms raw prices are non-stationary (p > 0.05) while log returns and indicators are stationary (p < 0.05). This feature set feeds into XGBoost or Random Forest for directional prediction or regime classification.",
            },
            {
              type: "code",
              title: "Feature Selection with Mutual Information & SHAP",
              language: "python",
              code: `import pandas as pd
import numpy as np
from sklearn.feature_selection import mutual_info_classif
from sklearn.ensemble import RandomForestClassifier
import shap

def select_features(X: pd.DataFrame, y: pd.Series, n_select: int = 30):
    """
    Select top n_select features using mutual information + SHAP.
    
    Args:
        X: Feature matrix (n_samples, n_features)
        y: Binary target (0/1 or -1/+1)
        n_select: Number of features to keep
    
    Returns:
        selected_features: List of feature names
    """
    print(f"Starting with {X.shape[1]} features")
    
    # Step 1: Remove high-correlation pairs (|Ï| > 0.95)
    corr_matrix = X.corr().abs()
    upper_tri = corr_matrix.where(
        np.triu(np.ones(corr_matrix.shape), k=1).astype(bool)
    )
    to_drop = [col for col in upper_tri.columns if any(upper_tri[col] > 0.95)]
    X_filtered = X.drop(columns=to_drop)
    print(f"After correlation filter (|Ï| > 0.95): {X_filtered.shape[1]} features")
    
    # Step 2: Mutual information ranking
    mi_scores = mutual_info_classif(X_filtered, y, random_state=42)
    mi_df = pd.DataFrame({
        'feature': X_filtered.columns,
        'mi_score': mi_scores
    }).sort_values('mi_score', ascending=False)
    
    # Keep top 2*n_select for SHAP analysis
    top_mi_features = mi_df.head(2 * n_select)['feature'].tolist()
    X_mi = X_filtered[top_mi_features]
    print(f"After MI ranking (top {2*n_select}): {X_mi.shape[1]} features")
    print(f"Top 5 by MI: {mi_df.head(5)['feature'].tolist()}")
    
    # Step 3: Train RF and compute SHAP importance
    rf = RandomForestClassifier(n_estimators=100, max_depth=5, random_state=42)
    rf.fit(X_mi, y)
    
    # SHAP values (using TreeExplainer for speed)
    explainer = shap.TreeExplainer(rf)
    shap_values = explainer.shap_values(X_mi)
    
    # Aggregate SHAP: mean absolute SHAP value per feature
    if isinstance(shap_values, list):  # binary classification returns list
        shap_values = shap_values[1]  # positive class
    shap_importance = np.abs(shap_values).mean(axis=0)
    
    shap_df = pd.DataFrame({
        'feature': X_mi.columns,
        'shap_importance': shap_importance
    }).sort_values('shap_importance', ascending=False)
    
    # Final selection: top n_select by SHAP
    selected_features = shap_df.head(n_select)['feature'].tolist()
    print(f"Final feature set (top {n_select} by SHAP): {selected_features[:5]}... ")
    
    return selected_features, mi_df, shap_df


# â”€â”€ Usage example â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Assume we have features (50 columns) and binary target
np.random.seed(42)
n_samples = 1000
n_features = 50

# Synthetic feature matrix (in practice, use compute_features() output)
X = pd.DataFrame(
    np.random.randn(n_samples, n_features),
    columns=[f"feat_{i}" for i in range(n_features)]
)

# Add some structure: feat_0 and feat_1 are predictive
X['feat_0'] = X['feat_0'] + np.random.choice([-1, 1], size=n_samples)
X['feat_1'] = X['feat_1'] * 2

# Binary target: roughly based on feat_0 + feat_1
y = ((X['feat_0'] + X['feat_1']) > 0).astype(int)

# Select top 15 features
selected, mi_df, shap_df = select_features(X, y, n_select=15)

print(f"\\nMutual Information (top 5):")
print(mi_df.head(5).to_string(index=False))

print(f"\\nSHAP Importance (top 5):")
print(shap_df.head(5).to_string(index=False))

# Train final model with selected features
X_selected = X[selected]
rf_final = RandomForestClassifier(n_estimators=200, max_depth=6, random_state=42)
rf_final.fit(X_selected, y)
print(f"\\nFinal model accuracy (in-sample): {rf_final.score(X_selected, y):.3f}")`,
              explanation:
                "This pipeline reduces a 50-feature set to 15 high-quality features. Step 1 removes redundant pairs (|Ï| > 0.95). Step 2 ranks by mutual information I(X; Y), keeping top 30. Step 3 trains a Random Forest and computes SHAP importance, selecting the final 15. Mutual information captures univariate relevance, while SHAP captures contribution in the presence of other features (multivariate importance). This two-stage filter ensures the final feature set is both individually predictive and collectively non-redundant.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "aq-feat-q1",
                  question:
                    "Why must features for time-series ML models be computed using only past data?",
                  options: [
                    { id: "aq-feat-q1-a", text: "To reduce computational complexity during training" },
                    { id: "aq-feat-q1-b", text: "To avoid look-ahead bias, which inflates backtest performance with information unavailable at prediction time" },
                    { id: "aq-feat-q1-c", text: "To ensure features are normally distributed" },
                    { id: "aq-feat-q1-d", text: "To minimize the number of NaN values in the feature matrix" },
                  ],
                  correctOptionId: "aq-feat-q1-b",
                  explanation:
                    "Look-ahead bias occurs when a feature or label uses future information (e.g., a rolling window centered on t instead of trailing). In backtesting this creates the illusion of predictability, but in live trading the future data isn't available and the model fails catastrophically. Always ensure features use data up to time tâˆ’1 when predicting at time t.",
                },
                {
                  id: "aq-feat-q2",
                  question:
                    "What is the primary purpose of z-score normalization z_t = (r_t âˆ’ Î¼Ì‚_w) / ÏƒÌ‚_w for return features?",
                  options: [
                    { id: "aq-feat-q2-a", text: "To make returns strictly positive for log transformations" },
                    { id: "aq-feat-q2-b", text: "To express returns relative to recent local behavior, making the signal comparable across different volatility regimes" },
                    { id: "aq-feat-q2-c", text: "To maximize the mutual information between features and the target" },
                    { id: "aq-feat-q2-d", text: "To remove the autocorrelation structure from the return series" },
                  ],
                  correctOptionId: "aq-feat-q2-b",
                  explanation:
                    "A 1% move means very different things in a low-vol (Ïƒ = 0.3%) vs high-vol (Ïƒ = 2%) regime. Z-scoring normalizes returns by the local rolling standard deviation, so a z = 2 always means '2 standard deviations above the local mean' â€” regardless of the current volatility level. This regime-invariance helps ML models generalize across different market conditions (crisis vs calm).",
                },
                {
                  id: "aq-feat-q3",
                  question:
                    "When two features have correlation |Ï| > 0.95, what should you do?",
                  options: [
                    { id: "aq-feat-q3-a", text: "Keep both â€” more features always improve model performance" },
                    { id: "aq-feat-q3-b", text: "Drop one to reduce multicollinearity, keeping the feature with higher univariate importance" },
                    { id: "aq-feat-q3-c", text: "Average them into a single composite feature" },
                    { id: "aq-feat-q3-d", text: "Apply PCA to decorrelate them before feeding to the model" },
                  ],
                  correctOptionId: "aq-feat-q3-b",
                  explanation:
                    "Highly correlated features provide nearly identical information. Keeping both inflates the effective dimensionality, makes feature importance unreliable (importance is split between them), and can destabilize linear models. Drop the less informative one. PCA is an alternative but reduces interpretability â€” you lose the ability to say 'RSI is the most important feature.'",
                },
                {
                  id: "aq-feat-q4",
                  question:
                    "Why is log return r_t = ln(P_t / P_{tâˆ’1}) preferred over simple return in quantitative finance?",
                  options: [
                    { id: "aq-feat-q4-a", text: "Log returns are always positive, simplifying analysis" },
                    { id: "aq-feat-q4-b", text: "Log returns are symmetric and additive over time: r_{0â†’T} = Î£ r_t, making aggregation and multi-period analysis straightforward" },
                    { id: "aq-feat-q4-c", text: "Log returns eliminate the need for stationarity transformations" },
                    { id: "aq-feat-q4-d", text: "Log returns have lower variance than simple returns" },
                  ],
                  correctOptionId: "aq-feat-q4-b",
                  explanation:
                    "Simple returns are non-additive: a +50% gain followed by a âˆ’50% loss leaves you at 75%, not 100%. Log returns are additive: ln(1.5) + ln(0.5) = ln(0.75), exactly matching the compound effect. This additivity makes log returns the natural choice for modeling multi-period behavior and computing long-horizon returns from daily data.",
                },
                {
                  id: "aq-feat-q5",
                  question:
                    "An ADF test on your price series gives p-value = 0.42. What does this mean, and what should you do?",
                  options: [
                    { id: "aq-feat-q5-a", text: "The series is stationary â€” proceed with modeling raw prices" },
                    { id: "aq-feat-q5-b", text: "Fail to reject Hâ‚€ (unit root present) â€” the series is non-stationary. Transform to returns before modeling" },
                    { id: "aq-feat-q5-c", text: "The test is inconclusive â€” collect more data" },
                    { id: "aq-feat-q5-d", text: "The series has too much noise â€” apply a smoothing filter" },
                  ],
                  correctOptionId: "aq-feat-q5-b",
                  explanation:
                    "ADF tests Hâ‚€: unit root (non-stationary). p = 0.42 > 0.05 means we fail to reject Hâ‚€ â€” the series is non-stationary. Modeling non-stationary data leads to spurious regressions. Transform to log returns, which are typically stationary (ADF p < 0.05), before feeding to ML models.",
                },
                {
                  id: "aq-feat-q6",
                  question:
                    "You compute 120 candidate features but your training set has only 500 samples. Why is this problematic?",
                  options: [
                    { id: "aq-feat-q6-a", text: "Feature computation will be too slow" },
                    { id: "aq-feat-q6-b", text: "Curse of dimensionality: the model has more parameters than data, leading to overfitting and poor generalization" },
                    { id: "aq-feat-q6-c", text: "500 samples is always sufficient regardless of feature count" },
                    { id: "aq-feat-q6-d", text: "You need to normalize features before comparing to sample size" },
                  ],
                  correctOptionId: "aq-feat-q6-b",
                  explanation:
                    "With 120 features and 500 samples, you have ~4 samples per feature. The model will find spurious patterns that fit the training noise but don't generalize. Rule of thumb: aim for at least 10-20 samples per feature. With 500 samples, target 25-50 features after selection. Use mutual information + SHAP to reduce dimensionality before training.",
                },
                {
                  id: "aq-feat-q7",
                  question:
                    "What is the interpretation of a SHAP value = +0.08 for feature RSI(14) on a specific prediction?",
                  options: [
                    { id: "aq-feat-q7-a", text: "RSI(14) has 8% correlation with the target" },
                    { id: "aq-feat-q7-b", text: "RSI(14) contributes +0.08 to the model's log-odds (or raw prediction) for this sample, pushing the prediction toward the positive class" },
                    { id: "aq-feat-q7-c", text: "RSI(14) is the 8th most important feature globally" },
                    { id: "aq-feat-q7-d", text: "The model's accuracy increases by 8% when RSI(14) is included" },
                  ],
                  correctOptionId: "aq-feat-q7-b",
                  explanation:
                    "SHAP values are additive attributions: prediction = baseline + Î£ SHAP_i. A SHAP value of +0.08 for RSI(14) means this feature adds +0.08 to the raw model output for this specific sample. Positive SHAP â†’ feature pushes toward positive class; negative SHAP â†’ pushes toward negative class. Averaging |SHAP| across samples gives feature importance.",
                },
              ],
            },
            {
              type: "practice",
              title: "End-to-End Feature Pipeline on EUR/USD",
              description:
                "Pull 2 years of EUR/USD daily OHLCV from QuestDB. Compute the full 50-feature set using compute_features(). Run ADF tests to confirm stationarity. Apply the feature selection pipeline (correlation filter â†’ MI ranking â†’ SHAP). Train an XGBoost classifier to predict next-day direction (up/down). Evaluate on a 20% holdout set. Report: (1) final feature count, (2) top 5 features by SHAP, (3) test accuracy. Does reducing from 50 â†’ 15 features improve or degrade performance?",
              tasks: [
                "Extract EUR/USD daily OHLCV from QuestDB (2022-01-01 to 2024-01-01)",
                "Compute 50+ features using the provided compute_features() function",
                "Run ADF test on raw close price and log_return â€” confirm price is I(1), returns are I(0)",
                "Create binary target: y = 1 if next-day return > 0, else 0",
                "Apply feature selection: correlation filter â†’ MI ranking â†’ SHAP importance",
                "Train XGBoost on selected features (80/20 train/test split)",
                "Evaluate test accuracy, precision, recall. Plot SHAP summary plot for top 10 features",
                "Experiment: try n_select âˆˆ {10, 20, 30, 40} â€” what value maximizes test accuracy?",
              ],
            },
            {
              type: "practice",
              title: "Forex-Specific Feature Engineering Challenge",
              description:
                "Extend the feature set with forex-specific indicators: (1) bid-ask spread proxy using Roll estimator, (2) carry differential (interest rate differential between currency pairs), (3) time-of-day dummy variables (London open, NY open, Tokyo close), (4) intermarket correlation (EUR/USD vs EUR/GBP rolling correlation). Train a multi-class classifier to predict regime: trending-up, trending-down, ranging. Use these regime predictions as input to a higher-level allocation model.",
              tasks: [
                "Implement Roll (1984) spread estimator: spread â‰ˆ 2âˆš(âˆ’Cov(Î”p_t, Î”p_{t-1}))",
                "Pull interest rate data (e.g., ECB deposit rate, Fed funds rate) and compute carry differential",
                "Add time-of-day features: hour-of-day sin/cos encoding, session dummies (Asia/London/NY)",
                "Compute rolling correlation (60-day) between EUR/USD and EUR/GBP as intermarket feature",
                "Define regime labels: trending-up (SMA(50) > SMA(200), ADX > 25), trending-down (SMA(50) < SMA(200), ADX > 25), ranging (ADX < 20)",
                "Train Random Forest multi-class classifier on extended feature set",
                "Generate regime predictions and use them to modulate position size: 2x leverage in trending, 0.5x in ranging",
              ],
            },
          ],
        },

        // â”€â”€ Lesson 2: Backtesting Frameworks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        {
          id: "aq-backtesting",
          title: "Backtesting Frameworks",
          description:
            "Build rigorous backtesting pipelines that respect time-series structure: walk-forward validation, proper train/test splitting, overfitting detection, transaction cost modeling, and Monte Carlo robustness testing.",
          estimatedMinutes: 55,
          difficulty: "advanced",
          relatedModels: ["xgboost", "lstm"],
          prerequisites: ["aq-features"],
          sections: [
            {
              type: "objective",
              content:
                "By the end of this lesson you will implement a walk-forward backtesting loop with expanding or sliding windows, model transaction costs and slippage, detect overfitting with combinatorial purged cross-validation, and stress-test results with Monte Carlo permutation.",
              keyTakeaways: [
                "Never use random train/test splits for time series â€” temporal ordering must be preserved to avoid information leakage",
                "Walk-forward validation retrains the model at each step: train on [0, t), predict [t, t+h), advance, repeat",
                "Transaction costs (spread + commission) and slippage must be modeled â€” they often erase marginal alpha",
                "Monte Carlo permutation tests establish whether strategy returns are statistically significant vs. random chance",
              ],
            },
            {
              type: "theory",
              title: "Walk-Forward Validation & Overfitting Detection",
              content:
                "Standard k-fold cross-validation randomly shuffles data, allowing the model to see future information during training. For financial time series this is catastrophic â€” autocorrelation and regime persistence mean shuffled folds leak forward-looking information.\n\n**Walk-forward validation** preserves temporal order:\n1. Fix a minimum training window W_min and a prediction horizon h\n2. At each step t: train on [0, t), predict [t, t+h), record predictions\n3. Advance: t â†’ t + h (or t + 1 for one-step-ahead)\n4. Expanding window: training set grows; sliding window: training set size stays fixed at W\n\n**Purged cross-validation** (de Prado, 2018) adds a gap of g bars between train and test folds to prevent label leakage from overlapping return horizons.\n\n**Overfitting detection:**\nâ€¢ Compare in-sample vs. out-of-sample Sharpe: a ratio > 2:1 signals overfitting\nâ€¢ Combinatorial Symmetric Cross-Validation (CSCV): generate all possible train/test path combinations and check if the probability of selecting an overfit model exceeds a threshold\nâ€¢ Deflated Sharpe Ratio (DSR): adjusts the observed Sharpe for the number of strategies tried, non-normal returns, and estimation error\n\n**Transaction cost modeling:**\nâ€¢ Spread cost: half-spread Ã— 2 (entry + exit) per round-trip\nâ€¢ Commission: fixed per-lot or percentage\nâ€¢ Slippage: market impact â‰ˆ Ïƒ âˆš(V_order / V_market) for large orders\nâ€¢ Implementation shortfall: âˆ‘(cost_component) per trade, subtracted from gross P&L",
            },
            {
              type: "intuition",
              title: "The Time-Travel Paradox of Random Splits",
              analogy:
                "Imagine you're testing a weather prediction model. Random cross-validation is like shuffling days from January, July, and October into both training and test sets â€” the model learns that 'if yesterday was 30Â°C, today is probably warm,' but it's using July data to predict January and vice versa. For markets, this is even worse: regimes (bull, bear, crisis) cluster in time. A model trained on 2020 COVID data can trivially 'predict' March 2020 if randomly shuffled data from February and April leak into training.",
              content:
                "Walk-forward validation is honest time travel: the model only knows the past, predicts the immediate future, then advances. It's slower (requires retraining at each step), but it's the only method that produces realistic performance estimates. If your strategy looks great in walk-forward and terrible in live trading, the problem is elsewhere (regime change, execution, etc.) â€” but at least you haven't fooled yourself with leaky validation.",
              emoji: "â³",
            },
            {
              type: "code",
              title: "Walk-Forward Backtest with Transaction Costs",
              language: "python",
              code: `import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier

np.random.seed(42)

# â”€â”€ Simulate features + binary target (1=up, 0=down) â”€â”€â”€â”€â”€â”€â”€â”€
n = 1000
features = np.random.randn(n, 5)
true_signal = 0.02 * features[:, 0] - 0.01 * features[:, 2]
returns = true_signal + np.random.normal(0, 0.01, n)
target = (returns > 0).astype(int)

# â”€â”€ Walk-forward parameters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
W_MIN = 250          # minimum training window
STEP = 20            # re-train every 20 bars
SPREAD_COST = 0.0002 # 2 pips round-trip for EUR/USD
SLIPPAGE = 0.00005   # 0.5 pip slippage per trade

results = []
for t in range(W_MIN, n - 1, STEP):
    t_end = min(t + STEP, n - 1)

    # Train on [0, t), predict [t, t_end)
    X_train, y_train = features[:t], target[:t]
    X_test = features[t:t_end]
    actual_returns = returns[t:t_end]

    model = GradientBoostingClassifier(
        n_estimators=100, max_depth=3, learning_rate=0.1,
    )
    model.fit(X_train, y_train)
    preds = model.predict(X_test)  # 1 = long, 0 = flat

    # â”€â”€ Apply transaction costs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    positions = preds.astype(float)
    trades = np.abs(np.diff(positions, prepend=0))  # 1 where position changes
    gross_pnl = positions * actual_returns
    costs = trades * (SPREAD_COST + SLIPPAGE)
    net_pnl = gross_pnl - costs

    for i in range(len(net_pnl)):
        results.append({
            "bar": t + i,
            "position": positions[i],
            "gross": gross_pnl[i],
            "cost": costs[i],
            "net": net_pnl[i],
        })

df = pd.DataFrame(results)
cumulative = df["net"].cumsum()
total_trades = df["cost"].gt(0).sum()

# â”€â”€ Performance metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
sharpe = df["net"].mean() / df["net"].std() * np.sqrt(252)
max_dd = (cumulative - cumulative.cummax()).min()

print(f"Walk-forward backtest results ({len(df)} bars)")
print(f"  Total trades:   {total_trades}")
print(f"  Gross P&L:      {df['gross'].sum():.4f}")
print(f"  Total costs:    {df['cost'].sum():.4f}")
print(f"  Net P&L:        {df['net'].sum():.4f}")
print(f"  Sharpe ratio:   {sharpe:.2f}")
print(f"  Max drawdown:   {max_dd:.4f}")

# â”€â”€ Monte Carlo permutation test â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
n_perms = 1000
perm_sharpes = []
for _ in range(n_perms):
    shuffled = np.random.permutation(df["net"].values)
    s = shuffled.mean() / shuffled.std() * np.sqrt(252)
    perm_sharpes.append(s)

p_value = np.mean([s >= sharpe for s in perm_sharpes])
print(f"\\nMonte Carlo p-value: {p_value:.3f} (from {n_perms} permutations)")
print(f"Strategy {'IS' if p_value < 0.05 else 'IS NOT'} significant at Î±=0.05")`,
              explanation:
                "The walk-forward loop trains on an expanding window [0, t) and predicts the next STEP bars. Positions are binary (long or flat). Transaction costs are deducted on every position change: spread (2 pips) + slippage (0.5 pips). After collecting all out-of-sample returns, we compute the net Sharpe ratio and maximum drawdown. The Monte Carlo permutation test shuffles net returns 1000 times to build a null distribution â€” if fewer than 5% of random permutations achieve a higher Sharpe, the strategy is statistically significant.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "aq-bt-q1",
                  question:
                    "Why is random k-fold cross-validation inappropriate for financial time-series models?",
                  options: [
                    { id: "aq-bt-q1-a", text: "It produces too many folds for large datasets" },
                    { id: "aq-bt-q1-b", text: "It violates temporal ordering, allowing future data to leak into training folds via autocorrelation and regime persistence" },
                    { id: "aq-bt-q1-c", text: "It cannot handle missing values in financial data" },
                    { id: "aq-bt-q1-d", text: "It always underestimates model performance" },
                  ],
                  correctOptionId: "aq-bt-q1-b",
                  explanation:
                    "Financial returns exhibit autocorrelation, volatility clustering, and regime persistence. Random shuffling places temporally adjacent (and correlated) observations into both train and test sets, giving the model access to near-future information and inflating performance metrics.",
                },
                {
                  id: "aq-bt-q2",
                  question:
                    "A strategy has in-sample Sharpe = 3.2 and out-of-sample Sharpe = 0.8. What does this likely indicate?",
                  options: [
                    { id: "aq-bt-q2-a", text: "The strategy is robust and will perform well live" },
                    { id: "aq-bt-q2-b", text: "The strategy is overfit to training data â€” the 4:1 ratio signals excessive complexity or data snooping" },
                    { id: "aq-bt-q2-c", text: "The out-of-sample period was too short to be meaningful" },
                    { id: "aq-bt-q2-d", text: "Transaction costs were not properly modeled in-sample" },
                  ],
                  correctOptionId: "aq-bt-q2-b",
                  explanation:
                    "A large gap between in-sample and out-of-sample Sharpe (IS/OOS ratio > 2:1) is a classic overfitting signature. The model has memorized noise in the training data rather than learning genuine predictive patterns. Remedies include reducing model complexity, using fewer features, or applying regularization.",
                },
              ],
            },
            {
              type: "practice",
              title: "Purged Walk-Forward Backtest on Your Pipeline",
              description:
                "Build a purged walk-forward backtest for your EUR/USD feature pipeline. Add a gap of g=5 bars between train and test to prevent label leakage. Compare expanding-window vs. sliding-window (W=252) results. Plot the OOS equity curve with drawdown bands. Run the Deflated Sharpe Ratio test to adjust for multiple strategy trials.",
              catalogModelId: "xgboost",
            },
          ],
        },

        // â”€â”€ Lesson 3: Label Engineering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        {
          id: "aq-label-engineering",
          title: "Label Engineering: Defining What to Predict",
          description:
            "Design rigorous prediction targets for ML models: fixed-horizon returns, triple barrier labeling, meta-labeling, and techniques for handling class imbalance â€” with careful attention to preventing information leakage from future data.",
          estimatedMinutes: 55,
          difficulty: "advanced",
          relatedModels: ["xgboost", "random-forest"],
          prerequisites: ["aq-features"],
          sections: [
            {
              type: "objective",
              content:
                "By the end of this lesson you will understand the limitations of fixed-horizon return labels, implement the triple barrier method for generating trade-outcome labels, apply meta-labeling to assess signal quality, and detect information leakage paths that inflate backtest accuracy.",
              keyTakeaways: [
                "Fixed-horizon labels (sign of r_{t+h}) ignore early exits and stop-losses, producing noisy, unrealistic targets",
                "Triple barrier labeling uses profit-take (Ï„_pt), stop-loss (Ï„_sl), and max-holding-period barriers to define trade outcomes",
                "Meta-labeling predicts P(profit | signal = 1), allowing a secondary model to filter a primary model's trades",
                "Look-ahead bias in labels â€” e.g., using future volatility to set barriers â€” silently inflates backtest metrics",
              ],
            },
            {
              type: "theory",
              title: "From Naive Labels to Triple Barrier & Meta-Labeling",
              content:
                "**Fixed-horizon labeling** assigns y_t = sign(r_{tâ†’t+h}) â€” the direction of the return over the next h bars. This is simple but deeply flawed for trading: it ignores the path of the price within the horizon. A trade that moves +3% then retraces to âˆ’1% by bar t+h is labeled as a loss, even though a trader with a take-profit at +2% would have exited profitably. Fixed-horizon labels also suffer from class imbalance in trending markets and produce noisy targets because the return magnitude at exactly h bars is arbitrary.\n\n**Triple barrier method** (LÃ³pez de Prado, 2018) defines three exit conditions for each trade entered at time t:\nâ€¢ Upper barrier (profit-take): price reaches P_t Ã— (1 + Ï„_pt), where Ï„_pt is typically set to kâ‚ Ã— ATR(n)\nâ€¢ Lower barrier (stop-loss): price reaches P_t Ã— (1 âˆ’ Ï„_sl), where Ï„_sl = kâ‚‚ Ã— ATR(n), often kâ‚‚ < kâ‚\nâ€¢ Vertical barrier (max holding period): h_max bars elapse without hitting either price barrier\n\nThe label is y âˆˆ {+1, âˆ’1, 0} depending on which barrier is touched first: profit-take â†’ +1, stop-loss â†’ âˆ’1, vertical â†’ sign of unrealized P&L or 0. This produces labels aligned with realistic trade management.\n\n**Meta-labeling** adds a second stage: a primary model generates directional signals (long/short), and a secondary model predicts whether each signal will be profitable: Å·_meta = P(profit | signal). The meta-model's output can be used to size positions (high confidence â†’ full size, low confidence â†’ skip). This separates the 'what direction' problem from 'should I trade' â€” the primary model handles alpha, the meta-model handles bet sizing.\n\n**Label imbalance and SMOTE:** Triple barrier labels are often imbalanced (e.g., 60% stop-loss hits in choppy markets). Synthetic Minority Over-sampling Technique (SMOTE) generates synthetic minority-class samples by interpolating between k-nearest neighbors in feature space. However, SMOTE must be applied only to training data â€” never to test or validation sets â€” and time-series SMOTE must respect temporal ordering.\n\n**Information leakage in labels:** Common leakage sources include: (1) computing ATR for barrier placement using future data, (2) centering rolling windows on the current bar instead of using trailing windows, (3) using the full dataset to compute z-scores that normalize barrier thresholds. All barrier parameters must be computed from data available at or before time t.",
            },
            {
              type: "intuition",
              title: "Grading Exams With Realistic Rules",
              analogy:
                "Fixed-horizon labeling is like grading every student's exam after exactly 60 minutes â€” regardless of whether they finished in 20 minutes or needed 90. A brilliant student who answered everything correctly in 30 minutes gets the same 'time slot' as one who struggled the whole hour. The triple barrier method is like letting students finish when they hit the pass mark (profit-take) OR the fail threshold (stop-loss) OR when time runs out (max holding period) â€” much more realistic and fair. Meta-labeling is then like having a teaching assistant who reviews each submitted exam and predicts 'is this likely to pass?' before the professor grades it â€” filtering out low-quality submissions saves everyone time.",
              content:
                "Just as a good exam system adapts to student performance rather than rigidly enforcing a fixed duration, triple barrier labeling adapts to market conditions via ATR-scaled barriers. In volatile markets, barriers widen (like giving more time for a harder exam). In calm markets, barriers tighten. The key insight is that the label should reflect what a real trader would experience â€” and real traders use stop-losses and take-profits, not arbitrary time horizons.",
              emoji: "ðŸ“",
            },
            {
              type: "code",
              title: "Triple Barrier Labeling on Forex OHLCV",
              language: "python",
              code: `import pandas as pd
import numpy as np

def compute_atr(high: pd.Series, low: pd.Series, close: pd.Series,
                period: int = 14) -> pd.Series:
    """Compute Average True Range (trailing, no look-ahead)."""
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(span=period, adjust=False).mean()

def triple_barrier_labels(
    df: pd.DataFrame,
    pt_multiplier: float = 2.0,
    sl_multiplier: float = 1.0,
    max_holding: int = 20,
    atr_period: int = 14,
) -> pd.Series:
    """
    Generate triple barrier labels for each bar.
    Barriers are ATR-scaled: profit-take = pt_multiplier * ATR,
    stop-loss = sl_multiplier * ATR.
    Returns: Series of labels {+1, -1, 0}.
    """
    close = df["close"]
    atr = compute_atr(df["high"], df["low"], close, atr_period)
    labels = pd.Series(np.nan, index=df.index)

    for i in range(atr_period, len(df) - max_holding):
        entry_price = close.iloc[i]
        current_atr = atr.iloc[i]  # trailing ATR, no future data
        upper = entry_price + pt_multiplier * current_atr
        lower = entry_price - sl_multiplier * current_atr

        # Scan forward up to max_holding bars
        label = 0  # default: vertical barrier (timeout)
        for j in range(1, max_holding + 1):
            future_idx = i + j
            if future_idx >= len(df):
                break
            future_high = df["high"].iloc[future_idx]
            future_low = df["low"].iloc[future_idx]

            if future_high >= upper:
                label = 1   # profit-take hit first
                break
            elif future_low <= lower:
                label = -1  # stop-loss hit first
                break

        # If vertical barrier hit, use sign of final P&L
        if label == 0:
            end_idx = min(i + max_holding, len(df) - 1)
            final_pnl = close.iloc[end_idx] - entry_price
            label = int(np.sign(final_pnl)) if final_pnl != 0 else 0

        labels.iloc[i] = label

    return labels.dropna().astype(int)


# â”€â”€ Example: Generate labels for EUR/USD 1H data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
np.random.seed(42)
n = 1000
price = 1.0800 + np.cumsum(np.random.normal(0, 0.0008, n))
ohlcv = pd.DataFrame({
    "open":  price + np.random.normal(0, 0.0003, n),
    "high":  price + np.abs(np.random.normal(0, 0.0015, n)),
    "low":   price - np.abs(np.random.normal(0, 0.0015, n)),
    "close": price,
}, index=pd.date_range("2024-01-01", periods=n, freq="1h"))

labels = triple_barrier_labels(
    ohlcv, pt_multiplier=2.0, sl_multiplier=1.0,
    max_holding=20, atr_period=14,
)

# â”€â”€ Label distribution analysis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
dist = labels.value_counts().sort_index()
print("Triple Barrier Label Distribution")
print("=" * 40)
for val, count in dist.items():
    pct = count / len(labels) * 100
    bar = "â–ˆ" * int(pct / 2)
    direction = {1: "Profit-take", -1: "Stop-loss", 0: "Timeout"}
    print(f"  {direction.get(val, val):>12} ({val:+d}): {count:>4} ({pct:5.1f}%) {bar}")
print(f"\\n  Total labeled bars: {len(labels)}")
print(f"  Imbalance ratio:   {dist.max() / dist.min():.2f}:1")`,
              explanation:
                "The triple_barrier_labels function scans forward from each bar to determine which barrier is hit first. The profit-take barrier is set at entry_price + 2Ã—ATR (generous target) and stop-loss at entry_price âˆ’ 1Ã—ATR (tighter stop, enforcing a 2:1 reward-risk ratio). ATR is computed using only trailing data to avoid look-ahead bias. When the vertical barrier (timeout) is hit, the label is set to the sign of the unrealized P&L. The distribution analysis reveals class imbalance â€” critical for model training decisions.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "aq-label-q1",
                  question:
                    "Why is the triple barrier method generally superior to fixed-horizon return labeling for ML trading models?",
                  options: [
                    { id: "aq-label-q1-a", text: "Triple barrier is computationally faster to generate" },
                    { id: "aq-label-q1-b", text: "Triple barrier produces labels aligned with realistic trade management (stop-losses and take-profits), while fixed-horizon ignores the price path and produces arbitrary labels" },
                    { id: "aq-label-q1-c", text: "Triple barrier always produces balanced label distributions" },
                    { id: "aq-label-q1-d", text: "Triple barrier labels can be computed without any look-ahead" },
                  ],
                  correctOptionId: "aq-label-q1-b",
                  explanation:
                    "Fixed-horizon labels only look at the price at exactly t+h bars, missing profitable trades that peaked and reversed within the horizon. Triple barrier labels reflect what a trader with stop-losses and take-profits would actually experience: exit when profit target or loss limit is hit, or when the holding period expires. This produces labels that are both more realistic and more learnable.",
                },
                {
                  id: "aq-label-q2",
                  question:
                    "What is the primary purpose of meta-labeling in an ML trading pipeline?",
                  options: [
                    { id: "aq-label-q2-a", text: "To replace the primary model's directional prediction with a more accurate one" },
                    { id: "aq-label-q2-b", text: "To predict whether a primary model's signal will be profitable, enabling position sizing and trade filtering" },
                    { id: "aq-label-q2-c", text: "To compute technical indicators for the primary model's features" },
                    { id: "aq-label-q2-d", text: "To correct for label imbalance using SMOTE on the primary model's outputs" },
                  ],
                  correctOptionId: "aq-label-q2-b",
                  explanation:
                    "Meta-labeling separates two distinct problems: (1) the primary model predicts direction (alpha generation), and (2) the meta-model predicts P(profit | signal) â€” whether the primary signal will succeed. The meta-model's probability can be used for position sizing (high confidence â†’ larger bet) or as a filter (skip low-confidence signals). This two-stage approach typically outperforms a single model trying to do both.",
                },
                {
                  id: "aq-label-q3",
                  question:
                    "How can look-ahead bias enter through the label engineering process?",
                  options: [
                    { id: "aq-label-q3-a", text: "By using too many features in the training set" },
                    { id: "aq-label-q3-b", text: "By computing barrier thresholds (e.g., ATR) using future data, or normalizing labels with statistics computed over the full dataset" },
                    { id: "aq-label-q3-c", text: "By training the model on too many epochs" },
                    { id: "aq-label-q3-d", text: "By using GPU acceleration instead of CPU for model training" },
                  ],
                  correctOptionId: "aq-label-q3-b",
                  explanation:
                    "Look-ahead bias in labels is insidious because it doesn't appear in the model code â€” it hides in data preprocessing. Using a centered rolling window to compute ATR (instead of trailing) means barrier widths incorporate future volatility. Similarly, z-scoring labels or barrier thresholds using the full dataset mean and std embeds future information. All barrier parameters must be computed using only data available at or before the entry time t.",
                },
              ],
            },
            {
              type: "practice",
              title: "Triple Barrier Labeling on EUR/USD 1H Data",
              description:
                "Pull EUR/USD 1H OHLCV from your QuestDB pipeline and implement triple barrier labeling with ATR-based barriers (profit-take = 2Ã—ATR(14), stop-loss = 1Ã—ATR(14), max holding = 20 bars). Analyze the resulting label distribution across different market regimes. Experiment with asymmetric barriers (e.g., 3Ã—ATR take-profit, 1Ã—ATR stop-loss) and observe how the distribution shifts. Then train an XGBoost classifier on the triple-barrier labels and compare accuracy against a fixed-horizon baseline.",
              catalogModelId: "xgboost",
            },
          ],
        },

        // â”€â”€ Lesson 4: Walk-Forward Optimization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        {
          id: "aq-walk-forward",
          title: "Walk-Forward Optimization & Combinatorial Purging",
          description:
            "Go beyond simple backtesting with walk-forward optimization, combinatorial purged cross-validation (CPCV), and embargo periods â€” the gold standard for validating trading strategies while preventing temporal leakage.",
          estimatedMinutes: 60,
          difficulty: "advanced",
          relatedModels: ["xgboost", "random-forest"],
          prerequisites: ["aq-backtesting"],
          sections: [
            {
              type: "objective",
              content:
                "By the end of this lesson you will implement anchored and rolling walk-forward optimization loops, apply combinatorial purged cross-validation (CPCV) to generate unbiased performance estimates, set appropriate embargo periods, and assess strategy half-life to detect parameter decay.",
              keyTakeaways: [
                "Walk-forward optimization re-optimizes parameters at each step â€” anchored windows grow, rolling windows slide with fixed width W",
                "CPCV generates all C(N,k) train/test combinations with purging, producing a distribution of backtest paths instead of a single equity curve",
                "Embargo gaps of g bars between train and test prevent autocorrelation-driven information leakage from overlapping label horizons",
                "Strategy half-life tÂ½ measures how quickly optimized parameters degrade â€” short half-lives indicate regime-dependent strategies requiring frequent re-optimization",
              ],
            },
            {
              type: "theory",
              title: "Walk-Forward, CPCV & Strategy Half-Life",
              content:
                "**Walk-forward optimization (WFO)** extends walk-forward validation by re-optimizing model hyperparameters at each step. Two variants exist:\nâ€¢ Anchored: train on [0, t), expanding the window as t advances. Captures all historical information but may include stale regimes.\nâ€¢ Rolling: train on [tâˆ’W, t), using a fixed window of W bars. Adapts faster to regime changes but discards potentially useful older data.\n\nAt each step, the model (or strategy) is trained/optimized on the in-sample window and evaluated on the out-of-sample segment [t, t+h). The OOS predictions are concatenated to build a single, unbiased equity curve.\n\n**Combinatorial Purged Cross-Validation (CPCV)** (LÃ³pez de Prado, 2018) addresses a deeper problem: a single walk-forward path gives one equity curve, but we need the distribution of possible outcomes to assess robustness. CPCV partitions the dataset into N groups, selects k groups for testing (C(N,k) combinations), and applies two safeguards:\nâ€¢ Purging: remove training samples whose labels overlap with any test sample's prediction horizon. If a label at time t uses returns from [t, t+h], any training sample in [tâˆ’h, t+h] is purged.\nâ€¢ Embargo: after purging, add an additional buffer of g bars to account for serial correlation. The embargo period g should be â‰¥ the autocorrelation decay length of the features.\n\nThe result is C(N,k) backtest paths, from which we compute the distribution of Sharpe ratios, drawdowns, and hit rates â€” far more informative than a single number.\n\n**Strategy half-life and regime dependence:** Once a model is optimized, its parameters Î¸* begin to degrade as market conditions shift. The half-life tÂ½ is defined as the time until the strategy's OOS Sharpe decays to half its initial value. Formally, if S(Î”t) is the Sharpe ratio Î”t bars after optimization, tÂ½ solves S(tÂ½) = S(0)/2. Strategies with short half-lives (tÂ½ < 60 trading days) are regime-dependent and require frequent re-optimization. Long half-lives (tÂ½ > 252 days) suggest robust, structural alpha. In practice, monitor the ratio S_recent / S_initial and trigger re-optimization when it drops below a threshold (e.g., 0.5).",
            },
            {
              type: "intuition",
              title: "Driving With Mirrors, Not Time Machines",
              analogy:
                "Regular backtesting is like driving while looking in the rearview mirror â€” you see the entire road behind you and plan your route assuming the future road looks the same. Walk-forward optimization is like using mirrors at each mile marker to check your current course, then adjusting your steering before proceeding to the next marker. You still only see the past, but you course-correct frequently. CPCV takes this further: it's like driving the same route hundreds of times with slightly different starting conditions to understand the distribution of possible outcomes â€” not just one lucky or unlucky trip.",
              content:
                "The embargo period is like leaving a gap between when you look in the mirror and when you start steering â€” if you react to what you saw 0.1 seconds ago (no embargo), your steering might be correlated with residual momentum from the previous mile. By waiting a moment (embargo = g bars), you ensure your steering decisions are truly independent of the segment you just evaluated. Strategy half-life tells you how often you need to recalibrate your mirrors â€” some roads (regimes) change slowly, others twist every few miles.",
              emoji: "ðŸš—",
            },
            {
              type: "code",
              title: "Walk-Forward Optimization with Purged K-Fold CV",
              language: "python",
              code: `import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import accuracy_score

np.random.seed(42)

# â”€â”€ Simulate forex feature matrix + labels â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
n = 2000
n_features = 8
X = np.random.randn(n, n_features)
true_weights = np.array([0.03, -0.02, 0.01, 0, 0, -0.015, 0.02, 0])
signal = X @ true_weights
returns = signal + np.random.normal(0, 0.01, n)
y = (returns > 0).astype(int)
dates = pd.bdate_range("2020-01-01", periods=n)

def purged_walk_forward(
    X: np.ndarray, y: np.ndarray,
    min_train: int = 500, step: int = 50,
    embargo: int = 5, mode: str = "anchored",
    window: int = 500,
) -> dict:
    """
    Walk-forward optimization with embargo (purging gap).
    mode: 'anchored' (expanding) or 'rolling' (fixed window).
    """
    all_preds, all_actuals, all_indices = [], [], []
    retrain_points = list(range(min_train, len(X) - step, step))

    for t in retrain_points:
        # Define train window
        if mode == "anchored":
            train_start = 0
        else:
            train_start = max(0, t - window)

        # Apply embargo: remove last 'embargo' bars from train
        train_end = t - embargo
        if train_end <= train_start:
            continue

        test_start = t
        test_end = min(t + step, len(X))

        X_train = X[train_start:train_end]
        y_train = y[train_start:train_end]
        X_test = X[test_start:test_end]
        y_test = y[test_start:test_end]

        # Train with re-optimized parameters at each step
        model = GradientBoostingClassifier(
            n_estimators=100, max_depth=3,
            learning_rate=0.1, subsample=0.8,
        )
        model.fit(X_train, y_train)
        preds = model.predict(X_test)

        all_preds.extend(preds)
        all_actuals.extend(y_test)
        all_indices.extend(range(test_start, test_end))

    return {
        "predictions": np.array(all_preds),
        "actuals": np.array(all_actuals),
        "indices": np.array(all_indices),
    }

# â”€â”€ Run anchored vs rolling walk-forward â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
results = {}
for mode in ["anchored", "rolling"]:
    res = purged_walk_forward(
        X, y, min_train=500, step=50,
        embargo=5, mode=mode, window=500,
    )
    acc = accuracy_score(res["actuals"], res["predictions"])
    n_correct = (res["predictions"] == res["actuals"]).sum()

    # Compute walk-forward equity curve
    positions = res["predictions"].astype(float)
    oos_returns = returns[res["indices"]] * positions
    cumulative = np.cumsum(oos_returns)
    sharpe = oos_returns.mean() / oos_returns.std() * np.sqrt(252)
    max_dd = (cumulative - np.maximum.accumulate(cumulative)).min()

    results[mode] = {
        "accuracy": acc, "sharpe": sharpe,
        "max_dd": max_dd, "n_bars": len(res["predictions"]),
    }

# â”€â”€ Strategy half-life estimation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
anchored = purged_walk_forward(X, y, min_train=500, step=50, embargo=5)
preds, actuals = anchored["predictions"], anchored["actuals"]
window_size = 100
rolling_acc = pd.Series([
    accuracy_score(actuals[max(0,i-window_size):i], preds[max(0,i-window_size):i])
    for i in range(window_size, len(preds))
])
initial_acc = rolling_acc.iloc[:50].mean()
half_acc = initial_acc / 2 + 0.25  # adjusted for 50% baseline
half_life_idx = (rolling_acc < half_acc).idxmax() if (rolling_acc < half_acc).any() else len(rolling_acc)

# â”€â”€ Report â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("Walk-Forward Optimization Results")
print("=" * 55)
for mode, metrics in results.items():
    print(f"\\n  {mode.upper()} window:")
    print(f"    OOS Accuracy:  {metrics['accuracy']:.1%}")
    print(f"    OOS Sharpe:    {metrics['sharpe']:.2f}")
    print(f"    Max Drawdown:  {metrics['max_dd']:.4f}")
    print(f"    Total OOS bars: {metrics['n_bars']}")

print(f"\\n  Strategy half-life: ~{half_life_idx * 50} bars")
print(f"  Initial rolling accuracy: {initial_acc:.1%}")`,
              explanation:
                "The purged_walk_forward function implements both anchored (expanding) and rolling (fixed window) walk-forward optimization. The embargo parameter removes the last g bars from the training set at each step, preventing autocorrelation-driven leakage between train and test. At each re-optimization point, the model is fully retrained on the available window. The strategy half-life is estimated by tracking rolling accuracy over time and finding when it decays to the midpoint between initial accuracy and random chance (50%).",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "aq-wf-q1",
                  question:
                    "Why does walk-forward optimization produce more realistic performance estimates than a single train/test split?",
                  options: [
                    { id: "aq-wf-q1-a", text: "Walk-forward uses more data for training" },
                    { id: "aq-wf-q1-b", text: "Walk-forward re-optimizes at each step and evaluates across multiple market regimes, while a single split may land entirely in one regime and overstate or understate performance" },
                    { id: "aq-wf-q1-c", text: "Walk-forward is computationally cheaper than a single split" },
                    { id: "aq-wf-q1-d", text: "Walk-forward allows random shuffling within each window" },
                  ],
                  correctOptionId: "aq-wf-q1-b",
                  explanation:
                    "A single train/test split is sensitive to where the split falls â€” if the test period happens to align with a favorable regime, performance looks great; if it lands in a regime change, performance looks terrible. Walk-forward evaluates across multiple successive segments, capturing diverse market conditions and providing a distribution of performance metrics rather than a single, potentially misleading number.",
                },
                {
                  id: "aq-wf-q2",
                  question:
                    "What specific type of information leakage does the embargo period in CPCV prevent?",
                  options: [
                    { id: "aq-wf-q2-a", text: "Feature scaling leakage from test data statistics" },
                    { id: "aq-wf-q2-b", text: "Serial correlation between the last training samples and the first test samples, where autocorrelated features or overlapping label horizons transfer forward-looking information" },
                    { id: "aq-wf-q2-c", text: "Label imbalance between training and test folds" },
                    { id: "aq-wf-q2-d", text: "Overfitting from excessive model complexity" },
                  ],
                  correctOptionId: "aq-wf-q2-b",
                  explanation:
                    "Even after purging, serial correlation in financial time series means that the last few training bars are statistically similar to the first few test bars. If features have autocorrelation length Î», information 'bleeds' across the train/test boundary for approximately Î» bars. The embargo gap of g â‰¥ Î» bars creates a buffer zone where no data is used for either training or testing, breaking the correlation chain.",
                },
                {
                  id: "aq-wf-q3",
                  question:
                    "How does CPCV differ from standard k-fold cross-validation for financial data?",
                  options: [
                    { id: "aq-wf-q3-a", text: "CPCV uses larger fold sizes than standard k-fold" },
                    { id: "aq-wf-q3-b", text: "CPCV generates all C(N,k) train/test combinations with purging and embargo, producing a distribution of backtest paths rather than a single average metric" },
                    { id: "aq-wf-q3-c", text: "CPCV randomly shuffles data within each fold" },
                    { id: "aq-wf-q3-d", text: "CPCV only works with tree-based models" },
                  ],
                  correctOptionId: "aq-wf-q3-b",
                  explanation:
                    "Standard k-fold produces k train/test splits and averages metrics â€” giving a single point estimate. CPCV generates all combinatorial partitions C(N,k), applies purging to remove label-overlapping training samples and embargo to block serial correlation leakage. The result is a full distribution of Sharpe ratios, drawdowns, and hit rates â€” revealing whether strong performance is consistent across paths or driven by a lucky partition.",
                },
              ],
            },
            {
              type: "practice",
              title: "Walk-Forward Optimization on Model Catalog Strategy",
              description:
                "Select a strategy from the model catalog (e.g., XGBoost or Random Forest classifier) and run walk-forward optimization on EUR/USD daily features. Compare anchored vs. rolling (W=252 trading days) modes. Add embargo = 5 bars. For each walk-forward step, log the OOS Sharpe ratio and plot the Sharpe decay curve over time. Estimate the strategy half-life and determine whether the strategy is regime-dependent (tÂ½ < 60 days) or structurally robust (tÂ½ > 252 days). Compare the walk-forward equity curve to a single-backtest result.",
              catalogModelId: "random-forest",
            },
          ],
        },
      ],
    },

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Module 2 â€” Risk & Portfolio
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      id: "risk-portfolio",
      title: "Risk & Portfolio",
      description:
        "Quantify, manage, and optimize risk. From single-position sizing with Kelly and VaR to multi-asset portfolio construction via mean-variance, risk parity, and hierarchical methods.",
      lessons: [
        // â”€â”€ Lesson 1: Risk Metrics & Position Sizing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        {
          id: "aq-risk",
          title: "Risk Metrics & Position Sizing",
          description:
            "Master the quantitative risk toolkit: Value-at-Risk, Conditional VaR (Expected Shortfall), performance ratios (Sharpe, Sortino, Calmar), the Kelly criterion for optimal bet sizing, and volatility targeting for adaptive position management.",
          estimatedMinutes: 55,
          difficulty: "advanced",
          relatedModels: ["risk-model"],
          sections: [
            {
              type: "objective",
              content:
                "By the end of this lesson you will compute VaR and CVaR from historical returns, calculate Sharpe/Sortino/Calmar ratios, derive the Kelly fraction for position sizing, and implement a volatility-targeting overlay that dynamically scales exposure.",
              keyTakeaways: [
                "VaR(Î±) = âˆ’quantile(returns, Î±) â€” the loss exceeded with probability Î± (e.g., 5%)",
                "CVaR(Î±) = ð”¼[âˆ’r | r â‰¤ âˆ’VaR(Î±)] â€” average loss in the worst Î± tail, more coherent than VaR",
                "Sharpe = (Î¼ âˆ’ r_f) / Ïƒ; Sortino uses downside Ïƒ; Calmar = annualized return / max drawdown",
                "Kelly fraction f* = Î¼ / ÏƒÂ² â€” optimal geometric growth rate, but practitioners use half-Kelly for safety",
              ],
            },
            {
              type: "theory",
              title: "Measuring and Sizing Risk",
              content:
                "**Value-at-Risk (VaR):** For a confidence level Î± (e.g., 5%), VaR is the loss threshold such that P(loss > VaR) = Î±. For daily returns r_t with mean Î¼ and std Ïƒ:\nâ€¢ Historical VaR: sort returns, take the Î±-th percentile\nâ€¢ Parametric VaR: VaR_Î± = âˆ’(Î¼ + z_Î± Â· Ïƒ) where z_Î± = Î¦â»Â¹(Î±) â‰ˆ âˆ’1.645 for Î±=5%\n\nVaR has a critical flaw: it ignores the severity of losses beyond the threshold. A portfolio with VaR(5%) = 2% could have a worst-case loss of 3% or 30% â€” VaR doesn't distinguish.\n\n**Conditional VaR (CVaR / Expected Shortfall):** CVaR_Î± = ð”¼[âˆ’r | r â‰¤ âˆ’VaR_Î±] â€” the average loss in the worst Î± fraction. CVaR is a coherent risk measure (subadditive), meaning diversification always reduces it.\n\n**Performance ratios:**\nâ€¢ Sharpe = (Î¼_annual âˆ’ r_f) / Ïƒ_annual â€” reward per unit of total risk\nâ€¢ Sortino = (Î¼_annual âˆ’ r_f) / Ïƒ_downside â€” penalizes only downside volatility\nâ€¢ Calmar = Î¼_annual / |max_drawdown| â€” return per unit of worst peak-to-trough loss\n\n**Kelly criterion:** For a strategy with expected return Î¼ and variance ÏƒÂ², the fraction maximizing long-run geometric growth is f* = Î¼ / ÏƒÂ². In practice, half-Kelly (f*/2) is used because:\n1. Parameter estimates Î¼Ì‚, ÏƒÌ‚Â² have error\n2. Full Kelly produces extreme drawdowns\n3. Log-utility may be too aggressive for most traders\n\n**Volatility targeting:** Set a target annualized volatility Ïƒ_target (e.g., 10%). Each day, scale position size by Ïƒ_target / ÏƒÌ‚_realized, where ÏƒÌ‚_realized is the trailing realized vol (e.g., 20-day). This stabilizes return variance across regimes.",
            },
            {
              type: "intuition",
              title: "Risk as the Price of Admission",
              analogy:
                "Think of VaR as the cover charge at a nightclub â€” it tells you the minimum you'll spend to get in on a bad night. But CVaR is more like your total bar tab on those bad nights: once you're past the cover charge, how much worse does it actually get? A nightclub with a $20 cover but $500 average tabs (high CVaR) is very different from one with a $20 cover and $30 average tabs, even though the cover (VaR) is identical.",
              content:
                "The Kelly criterion is like choosing your bet size at a poker table. Bet too small and you grow slowly. Bet too large and one bad hand wipes you out. Kelly finds the mathematical sweet spot â€” but it assumes you know the exact odds. Since we estimate odds with error, half-Kelly is the practical 'play it safe but still grow' strategy. Volatility targeting is the cruise control: it automatically reduces your speed (position size) when the road gets bumpy (high vol) and accelerates on smooth highways (low vol).",
              emoji: "ðŸŽ°",
            },
            {
              type: "code",
              title: "Computing Risk Metrics with NumPy",
              language: "python",
              code: `import numpy as np

np.random.seed(42)

# â”€â”€ Simulate 2 years of daily strategy returns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
n_days = 504
returns = np.random.normal(0.0003, 0.008, n_days)  # Î¼ â‰ˆ 7.5% ann, Ïƒ â‰ˆ 12.7% ann
# Inject a few tail events
returns[100] = -0.035  # flash crash
returns[250] = -0.028  # regime shock
returns[400] = 0.022   # squeeze

def compute_risk_metrics(r: np.ndarray, rf: float = 0.0, alpha: float = 0.05):
    """Compute comprehensive risk metrics from a return series."""
    # â”€â”€ VaR and CVaR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    var = -np.percentile(r, alpha * 100)
    cvar = -r[r <= -var].mean() if np.any(r <= -var) else var

    # â”€â”€ Annualized performance ratios â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    mu_ann = r.mean() * 252
    sigma_ann = r.std() * np.sqrt(252)
    sharpe = (mu_ann - rf) / sigma_ann

    downside = r[r < 0]
    sigma_down = downside.std() * np.sqrt(252) if len(downside) > 0 else 1e-8
    sortino = (mu_ann - rf) / sigma_down

    cumulative = np.cumprod(1 + r)
    running_max = np.maximum.accumulate(cumulative)
    drawdowns = cumulative / running_max - 1
    max_dd = drawdowns.min()
    calmar = mu_ann / abs(max_dd) if max_dd != 0 else np.inf

    # â”€â”€ Kelly criterion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    kelly_full = r.mean() / r.var() if r.var() > 0 else 0
    kelly_half = kelly_full / 2

    # â”€â”€ Volatility targeting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    sigma_target = 0.10 / np.sqrt(252)  # 10% annualized target
    trailing_vol = np.full(len(r), r.std())
    for i in range(20, len(r)):
        trailing_vol[i] = r[i-20:i].std()
    leverage = sigma_target / trailing_vol
    vol_targeted_r = r * leverage

    return {
        f"VaR({alpha:.0%})": var,
        f"CVaR({alpha:.0%})": cvar,
        "Sharpe": sharpe,
        "Sortino": sortino,
        "Calmar": calmar,
        "Max Drawdown": max_dd,
        "Kelly (full)": kelly_full,
        "Kelly (half)": kelly_half,
        "Vol-targeted Sharpe": (
            vol_targeted_r.mean() * 252
            / (vol_targeted_r.std() * np.sqrt(252))
        ),
    }


metrics = compute_risk_metrics(returns)
print("Risk Metrics Dashboard")
print("=" * 40)
for k, v in metrics.items():
    print(f"  {k:>22s}: {v:>10.4f}")`,
              explanation:
                "The function computes: (1) Historical VaR and CVaR at the 5% level â€” CVaR averages losses beyond VaR, capturing tail severity. (2) Annualized Sharpe (total risk), Sortino (downside risk only), and Calmar (drawdown-adjusted). (3) Full and half-Kelly fractions for position sizing. (4) A volatility-targeting overlay that scales returns by Ïƒ_target / ÏƒÌ‚_trailing, stabilizing realized volatility and often improving the Sharpe ratio.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "aq-risk-q1",
                  question:
                    "Why is CVaR (Expected Shortfall) considered superior to VaR as a risk measure?",
                  options: [
                    { id: "aq-risk-q1-a", text: "CVaR is easier to compute from historical data" },
                    { id: "aq-risk-q1-b", text: "CVaR captures the average magnitude of losses beyond VaR, and is subadditive (coherent), meaning diversification always reduces it" },
                    { id: "aq-risk-q1-c", text: "CVaR is always smaller than VaR, providing a more conservative estimate" },
                    { id: "aq-risk-q1-d", text: "CVaR does not require knowledge of the return distribution" },
                  ],
                  correctOptionId: "aq-risk-q1-b",
                  explanation:
                    "VaR only reports the threshold loss at a given confidence level â€” it says nothing about how bad losses can get beyond that point. CVaR averages losses in the tail, capturing severity. Crucially, CVaR is subadditive: CVaR(A+B) â‰¤ CVaR(A) + CVaR(B), so diversification is always rewarded. VaR can violate this property.",
                },
                {
                  id: "aq-risk-q2",
                  question:
                    "Why do practitioners typically use half-Kelly instead of full Kelly for position sizing?",
                  options: [
                    { id: "aq-risk-q2-a", text: "Full Kelly is illegal under most regulatory frameworks" },
                    { id: "aq-risk-q2-b", text: "Full Kelly assumes exact knowledge of Î¼ and ÏƒÂ², but estimation errors can lead to extreme leverage and catastrophic drawdowns" },
                    { id: "aq-risk-q2-c", text: "Half-Kelly maximizes the Sharpe ratio while full Kelly maximizes returns" },
                    { id: "aq-risk-q2-d", text: "Full Kelly only works for binary bet outcomes, not continuous returns" },
                  ],
                  correctOptionId: "aq-risk-q2-b",
                  explanation:
                    "The Kelly criterion f* = Î¼/ÏƒÂ² assumes Î¼ and ÏƒÂ² are known exactly. In practice, these are estimated with error. Overestimating Î¼ or underestimating ÏƒÂ² leads to over-leveraging and severe drawdowns. Half-Kelly sacrifices ~25% of the geometric growth rate but dramatically reduces drawdown risk and is robust to estimation error.",
                },
              ],
            },
            {
              type: "practice",
              title: "Dynamic Risk Dashboard for Live Strategy",
              description:
                "Build a real-time risk dashboard that computes rolling VaR(5%), CVaR(5%), Sharpe, and Calmar over a 60-day trailing window. Implement a volatility-targeting overlay with Ïƒ_target = 10% annualized. Connect to your QuestDB strategy returns table and update metrics every bar. Add an alert when CVaR exceeds 2Ã— its 90-day average.",
              catalogModelId: "risk-model",
            },
          ],
        },

        // â”€â”€ Lesson 2: Portfolio Optimization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        {
          id: "aq-portfolio",
          title: "Portfolio Optimization",
          description:
            "Construct optimal multi-asset portfolios: mean-variance (Markowitz) efficient frontier, Black-Litterman for incorporating views, risk parity, hierarchical risk parity (HRP), and minimum variance for robust allocation.",
          estimatedMinutes: 55,
          difficulty: "advanced",
          relatedModels: ["portfolio-optimizer"],
          prerequisites: ["aq-risk"],
          sections: [
            {
              type: "objective",
              content:
                "By the end of this lesson you will compute the efficient frontier via quadratic optimization, incorporate subjective views with Black-Litterman, implement risk parity and HRP allocations, and understand the practical trade-offs between these approaches in a multi-currency forex portfolio.",
              keyTakeaways: [
                "Mean-variance: min w'Î£w  s.t.  w'Î¼ = Î¼_target, w'1 = 1 â€” sensitive to estimation errors in Î¼ and Î£",
                "Black-Litterman blends equilibrium returns Ï€ = Î´Î£w_mkt with investor views P'Î¼_BL = Q + Îµ to produce stable allocations",
                "Risk parity: w_i âˆ 1/Ïƒ_i (or equalize risk contributions RC_i = w_i Â· (Î£w)_i / w'Î£w) â€” no expected return estimates needed",
                "HRP uses hierarchical clustering on the correlation matrix to build a diversified, tree-based allocation robust to estimation noise",
              ],
            },
            {
              type: "theory",
              title: "From Markowitz to Hierarchical Risk Parity",
              content:
                "**Mean-Variance Optimization (Markowitz, 1952):**\nGiven n assets with expected return vector Î¼ âˆˆ â„â¿ and covariance matrix Î£ âˆˆ â„â¿Ã—â¿, the efficient frontier solves:\n\n  min_w  Â½ w'Î£w\n  s.t.   w'Î¼ â‰¥ Î¼_target,  w'1 = 1,  w â‰¥ 0\n\nThe quadratic program yields an optimal weight vector w* for each target return. In practice, mean-variance is notoriously sensitive to estimation errors in Î¼ â€” small changes in expected returns produce wildly different allocations.\n\n**Minimum Variance Portfolio:** Sets Î¼_target to the minimum achievable and solves for the lowest-risk portfolio. Since it doesn't require return estimates (only Î£), it's more robust.\n\n**Black-Litterman (1992):** Starts from equilibrium expected returns implied by the market portfolio: Ï€ = Î´Î£w_mkt, where Î´ is the risk aversion coefficient. Investor views are expressed as linear constraints P'Î¼ = Q Â± Î© (view uncertainty). The posterior return Î¼_BL blends equilibrium and views:\n\n  Î¼_BL = [(Ï„Î£)â»Â¹ + P'Î©â»Â¹P]â»Â¹ [(Ï„Î£)â»Â¹Ï€ + P'Î©â»Â¹Q]\n\nThe result is a stable, intuitive set of expected returns that can be fed back into mean-variance.\n\n**Risk Parity:** Allocates so each asset contributes equally to portfolio risk. The risk contribution of asset i is RC_i = w_i Â· (Î£w)_i. We solve for w such that RCâ‚ = RCâ‚‚ = â€¦ = RCâ‚™. No expected return estimates are needed.\n\n**Hierarchical Risk Parity (HRP, LÃ³pez de Prado 2016):**\n1. Compute the correlation distance matrix d_ij = âˆš(Â½(1 âˆ’ Ï_ij))\n2. Apply single-linkage hierarchical clustering\n3. Quasi-diagonalize the covariance matrix along the dendrogram\n4. Recursively bisect the tree, allocating inversely to cluster variance\nHRP is robust to noise in Î£, doesn't require Î£â»Â¹, and naturally produces diversified portfolios.",
            },
            {
              type: "intuition",
              title: "Dividing a Pizza Among Friends",
              analogy:
                "Markowitz is like asking each friend how hungry they are (expected returns) and giving bigger slices to the hungriest â€” but if someone exaggerates their hunger (estimation error), the allocation is terrible. Risk parity ignores hunger entirely and gives each person a slice inversely proportional to how fast they eat (volatility) â€” fair, but it ignores preferences. Black-Litterman starts with equal hunger (market equilibrium) and only adjusts slices for friends who explicitly say 'I'm extra hungry today' (investor views), with adjustments proportional to how confident they sound.",
              content:
                "HRP is like seating friends in clusters of similar eating habits (hierarchical clustering), then dividing the pizza within each cluster before dividing between clusters. This prevents one oddball friend (an uncorrelated asset) from dominating the allocation just because they sit next to someone with a huge appetite. The tree structure makes the allocation robust even when you don't know everyone's exact hunger level.",
              emoji: "ðŸ•",
            },
            {
              type: "code",
              title: "Efficient Frontier & Risk Parity with SciPy",
              language: "python",
              code: `import numpy as np
from scipy.optimize import minimize

np.random.seed(42)

# â”€â”€ 5-currency portfolio: EUR, GBP, JPY, AUD, CHF vs USD â”€â”€â”€
assets = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CHF"]
n_assets = len(assets)

# Annualized expected returns and covariance (illustrative)
mu = np.array([0.02, 0.03, -0.01, 0.04, 0.005])
# Correlation matrix â†’ covariance
vols = np.array([0.08, 0.09, 0.07, 0.12, 0.06])
corr = np.array([
    [1.00, 0.75, -0.30, 0.55, -0.80],
    [0.75, 1.00, -0.20, 0.60, -0.65],
    [-0.30, -0.20, 1.00, -0.15, 0.40],
    [0.55, 0.60, -0.15, 1.00, -0.45],
    [-0.80, -0.65, 0.40, -0.45, 1.00],
])
Sigma = np.outer(vols, vols) * corr

# â”€â”€ Mean-Variance: Efficient Frontier â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def portfolio_vol(w):
    return np.sqrt(w @ Sigma @ w)

def portfolio_ret(w):
    return w @ mu

frontier_vols, frontier_rets, frontier_weights = [], [], []
for target_ret in np.linspace(mu.min(), mu.max(), 20):
    constraints = [
        {"type": "eq", "fun": lambda w: w.sum() - 1},
        {"type": "eq", "fun": lambda w, tr=target_ret: portfolio_ret(w) - tr},
    ]
    bounds = [(0, 1)] * n_assets
    w0 = np.ones(n_assets) / n_assets
    res = minimize(portfolio_vol, w0, bounds=bounds, constraints=constraints, method="SLSQP")
    if res.success:
        frontier_vols.append(portfolio_vol(res.x))
        frontier_rets.append(target_ret)
        frontier_weights.append(res.x)

# â”€â”€ Minimum Variance Portfolio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
res_mv = minimize(
    portfolio_vol,
    np.ones(n_assets) / n_assets,
    bounds=[(0, 1)] * n_assets,
    constraints=[{"type": "eq", "fun": lambda w: w.sum() - 1}],
    method="SLSQP",
)
w_mv = res_mv.x

# â”€â”€ Risk Parity: equalize risk contributions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def risk_parity_obj(w):
    w = np.abs(w)
    port_vol = np.sqrt(w @ Sigma @ w)
    marginal = Sigma @ w
    rc = w * marginal / port_vol  # risk contributions
    target_rc = port_vol / n_assets
    return np.sum((rc - target_rc) ** 2)

res_rp = minimize(
    risk_parity_obj,
    np.ones(n_assets) / n_assets,
    method="SLSQP",
    bounds=[(0.01, 1)] * n_assets,
    constraints=[{"type": "eq", "fun": lambda w: w.sum() - 1}],
)
w_rp = np.abs(res_rp.x)
w_rp /= w_rp.sum()

# â”€â”€ Results â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("Portfolio Optimization Results")
print("=" * 60)
print(f"{'Asset':<10} {'MinVar':>8} {'RiskParity':>12} {'MaxSharpe':>10}")
print("-" * 60)

# Find max Sharpe from frontier
sharpes = [(r / v, i) for i, (r, v) in enumerate(zip(frontier_rets, frontier_vols))]
best_idx = max(sharpes, key=lambda x: x[0])[1]
w_ms = frontier_weights[best_idx]

for i, name in enumerate(assets):
    print(f"{name:<10} {w_mv[i]:>8.1%} {w_rp[i]:>12.1%} {w_ms[i]:>10.1%}")

print("-" * 60)
for label, w in [("MinVar", w_mv), ("RiskParity", w_rp), ("MaxSharpe", w_ms)]:
    ret = portfolio_ret(w)
    vol = portfolio_vol(w)
    sr = ret / vol
    print(f"{label:<12}  Return={ret:.2%}  Vol={vol:.2%}  Sharpe={sr:.2f}")`,
              explanation:
                "We define a 5-currency portfolio with realistic correlations (EUR and CHF are strongly negatively correlated). Three optimization methods are compared: (1) Mean-variance efficient frontier traces the optimal risk-return curve via SLSQP; the max-Sharpe portfolio is extracted. (2) Minimum variance ignores returns entirely and finds the lowest-volatility allocation. (3) Risk parity equalizes each asset's risk contribution RC_i = w_i(Î£w)_i / Ïƒ_p by minimizing the squared deviation from equal contributions. Risk parity typically produces the most diversified allocation.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "aq-port-q1",
                  question:
                    "What is the primary practical weakness of Markowitz mean-variance optimization?",
                  options: [
                    { id: "aq-port-q1-a", text: "It cannot handle more than 10 assets" },
                    { id: "aq-port-q1-b", text: "It is extremely sensitive to estimation errors in expected returns Î¼, producing unstable and concentrated portfolios" },
                    { id: "aq-port-q1-c", text: "It assumes returns are uniformly distributed" },
                    { id: "aq-port-q1-d", text: "It requires daily rebalancing to maintain optimality" },
                  ],
                  correctOptionId: "aq-port-q1-b",
                  explanation:
                    "Mean-variance optimization is an 'error maximizer': small changes in estimated returns Î¼ can flip entire allocations. Assets with slightly overestimated returns get massive weights, while those with slightly underestimated returns are excluded. This is why practitioners prefer robust methods (minimum variance, risk parity, HRP) or Bayesian approaches (Black-Litterman) that stabilize the inputs.",
                },
                {
                  id: "aq-port-q2",
                  question:
                    "How does Black-Litterman improve upon standard mean-variance optimization?",
                  options: [
                    { id: "aq-port-q2-a", text: "It uses a different risk measure instead of variance" },
                    { id: "aq-port-q2-b", text: "It starts from equilibrium (market-implied) returns and only adjusts them based on explicit investor views with specified confidence levels" },
                    { id: "aq-port-q2-c", text: "It eliminates the need for a covariance matrix" },
                    { id: "aq-port-q2-d", text: "It automatically selects the optimal number of assets" },
                  ],
                  correctOptionId: "aq-port-q2-b",
                  explanation:
                    "Black-Litterman anchors expected returns to the CAPM equilibrium Ï€ = Î´Î£w_mkt rather than using raw historical estimates. The investor can express relative or absolute views ('I think EUR will outperform GBP by 2%') with a confidence level. The posterior Î¼_BL is a precision-weighted blend of equilibrium and views, producing stable, intuitive allocations.",
                },
                {
                  id: "aq-port-q3",
                  question:
                    "What advantage does Hierarchical Risk Parity (HRP) have over standard risk parity?",
                  options: [
                    { id: "aq-port-q3-a", text: "HRP requires expected return estimates while risk parity does not" },
                    { id: "aq-port-q3-b", text: "HRP uses hierarchical clustering to respect the correlation structure, avoiding matrix inversion and producing allocations robust to estimation noise in Î£" },
                    { id: "aq-port-q3-c", text: "HRP always produces higher Sharpe ratios than risk parity" },
                    { id: "aq-port-q3-d", text: "HRP can only be applied to equity portfolios, not currencies" },
                  ],
                  correctOptionId: "aq-port-q3-b",
                  explanation:
                    "Standard risk parity and mean-variance both require inverting the covariance matrix, which amplifies estimation errors (especially for nearly singular Î£). HRP uses hierarchical clustering and recursive bisection â€” no matrix inversion needed. The tree structure naturally groups correlated assets, producing diversified allocations that are empirically more stable out-of-sample.",
                },
              ],
            },
            {
              type: "practice",
              title: "Multi-Currency Portfolio Construction",
              description:
                "Build a portfolio optimizer for 8 major forex pairs using daily returns from QuestDB. Compare four methods: (1) Max Sharpe, (2) Minimum Variance, (3) Risk Parity, (4) HRP using scipy.cluster.hierarchy. Backtest each allocation with monthly rebalancing over 2 years. Plot cumulative returns, rolling Sharpe, and allocation weights over time. Which method produces the best out-of-sample risk-adjusted returns?",
              catalogModelId: "portfolio-optimizer",
            },
          ],
        },

        // â”€â”€ Lesson 3: Execution Quality & Slippage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        {
          id: "aq-execution-slippage",
          title: "Execution Quality & Slippage Modeling",
          description:
            "Model the hidden costs of trading: bid-ask spreads, market impact, slippage estimation, fill probability, and optimal execution â€” the difference between theoretical alpha and realized P&L.",
          estimatedMinutes: 50,
          difficulty: "advanced",
          relatedModels: ["risk-model"],
          prerequisites: ["aq-risk"],
          sections: [
            {
              type: "objective",
              content:
                "By the end of this lesson you will model bid-ask spreads from tick data, estimate slippage using linear and square-root market impact models, perform transaction cost analysis (TCA), compute fill probability as a function of limit order distance, and understand the Almgren-Chriss framework for optimal execution.",
              keyTakeaways: [
                "Effective spread = 2 Ã— |P_trade âˆ’ midpoint| captures the true cost of a market order beyond the quoted spread",
                "Square-root impact: Î”P/P â‰ˆ Ïƒ Ã— âˆš(V_order / V_daily) â€” impact grows sub-linearly with order size, dominating costs for large orders",
                "Fill probability for limit orders decays exponentially with distance from mid: P(fill) â‰ˆ exp(âˆ’Î» Ã— d/Ïƒ)",
                "Almgren-Chriss optimal execution minimizes ð”¼[cost] + Î» Ã— Var(cost), trading off urgency against market impact",
              ],
            },
            {
              type: "theory",
              title: "Market Microstructure & Impact Modeling",
              content:
                "**Market microstructure** studies the mechanics of price formation. For any trade, the realized price differs from the theoretical mid-price due to several cost components:\n\nâ€¢ Quoted spread: ask âˆ’ bid. For EUR/USD this is typically 0.1â€“0.5 pips in liquid sessions. Half-spread cost per side â‰ˆ (ask âˆ’ bid) / (2 Ã— mid).\nâ€¢ Effective spread: 2 Ã— |P_execution âˆ’ P_mid|. This captures the actual cost, including hidden liquidity, price improvement, or adverse selection.\nâ€¢ Slippage: the difference between the expected execution price (when the order was sent) and the actual fill price. Caused by latency, market movement during order transit, and the order consuming liquidity across price levels.\n\n**Market impact models** quantify how an order moves the price:\nâ€¢ Linear impact: Î”P = Î· Ã— V_order, where Î· is a constant. Simple but unrealistic â€” it predicts doubling order size doubles impact, which overstates cost for large orders.\nâ€¢ Square-root impact (Barra/Torre, 1997): Î”P/P = Ïƒ_daily Ã— Î³ Ã— âˆš(V_order / V_daily), where Î³ is a calibration constant (typically 0.1â€“0.5 for FX). Empirically validated across equities and FX: impact grows as the square root of participation rate.\nâ€¢ Almgren-Chriss (2001): optimal execution framework that minimizes ð”¼[implementation shortfall] + Î» Ã— Var[implementation shortfall]. The solution is a deterministic trading trajectory that balances urgency (temporary impact from trading fast) against timing risk (adverse price movement from trading slow). For a TWAP-like schedule, the optimal trajectory is: x(t) = X Ã— sinh[Îº(Tâˆ’t)] / sinh[ÎºT], where X is total shares, T is time horizon, and Îº = âˆš(Î»ÏƒÂ² / Î·) balances volatility risk against impact cost.\n\n**Transaction Cost Analysis (TCA):** Post-trade analysis comparing execution quality against benchmarks:\nâ€¢ Implementation shortfall = paper_return âˆ’ actual_return, decomposed into: delay cost + market impact + timing cost + opportunity cost.\nâ€¢ Arrival price benchmark: compare fill price to mid-price at order submission.\nâ€¢ VWAP benchmark: compare fill price to volume-weighted average price over the execution window.\n\n**Fill probability for limit orders:** A limit order at distance d from the mid-price has fill probability P(fill) that decays with d. Empirically: P(fill | d, Î”t) â‰ˆ 1 âˆ’ exp(âˆ’Î» Ã— Î”t Ã— f(d/Ïƒ)), where f is a decreasing function. Closer limits fill more often but suffer more adverse selection (filled when the market moves against you).",
            },
            {
              type: "intuition",
              title: "Ordering Drinks at a Crowded Bar",
              analogy:
                "Imagine you're at a crowded bar trying to order drinks. If you order one beer (small order), the bartender serves you quickly at the menu price â€” minimal slippage. But if you order 50 beers for your entire party (large order), the bartender takes longer, other patrons grab the cheap beers first, and you end up paying more per drink as you exhaust the 'close liquidity.' The square-root impact model says the price increase isn't linear â€” ordering 4Ã— more drinks doesn't cost 4Ã— more per drink, but roughly 2Ã— more (âˆš4 = 2). Limit orders are like calling ahead to reserve drinks at a fixed price â€” you might get a better deal, but if the bar runs out before your turn, you don't get served at all (fill probability < 100%).",
              content:
                "The Almgren-Chriss framework is like deciding how fast to drink all 50 beers. Drink too fast (aggressive execution) and you get sloppy and overpay (high market impact). Drink too slowly (passive execution) and the bar's happy hour ends and prices go up (timing risk from adverse market movement). The optimal drinking pace balances getting a good price per beer against the risk that prices change while you're still ordering.",
              emoji: "ðŸº",
            },
            {
              type: "code",
              title: "Slippage Simulation with Square-Root Impact",
              language: "python",
              code: `import numpy as np
import pandas as pd

np.random.seed(42)

def simulate_slippage(
    n_trades: int,
    daily_volume: float = 5e9,    # EUR/USD daily volume (notional)
    daily_vol: float = 0.006,      # daily volatility (0.6%)
    gamma: float = 0.3,            # impact coefficient
    base_spread_pips: float = 0.3, # typical EUR/USD spread
    pip_value: float = 0.0001,     # 1 pip in price units
) -> pd.DataFrame:
    """
    Simulate slippage for forex trades using square-root impact model.
    Impact: Î”P/P = Ïƒ_daily Ã— Î³ Ã— âˆš(V_order / V_daily)
    """
    # Generate random order sizes (notional, in base currency)
    order_sizes = np.random.lognormal(mean=np.log(1e6), sigma=0.8, size=n_trades)
    order_sizes = np.clip(order_sizes, 1e4, 1e8)

    # Entry mid-prices (simulate around EUR/USD 1.08)
    mid_prices = 1.08 + np.cumsum(np.random.normal(0, 0.0003, n_trades))

    records = []
    for i in range(n_trades):
        mid = mid_prices[i]
        size = order_sizes[i]
        participation = size / daily_volume

        # Half-spread cost (always paid)
        half_spread = (base_spread_pips * pip_value) / 2

        # Square-root impact: Î”P/P = Ïƒ Ã— Î³ Ã— âˆš(participation)
        impact_bps = daily_vol * gamma * np.sqrt(participation)
        impact_price = mid * impact_bps

        # Random fill noise (latency, timing)
        noise = np.random.normal(0, 0.5 * pip_value)

        # Total slippage
        total_slippage = half_spread + impact_price + max(noise, 0)
        effective_price = mid + total_slippage
        effective_spread = 2 * total_slippage

        records.append({
            "trade_id": i + 1,
            "mid_price": mid,
            "order_size": size,
            "participation_rate": participation,
            "half_spread_cost": half_spread,
            "impact_cost": impact_price,
            "fill_noise": noise,
            "total_slippage": total_slippage,
            "effective_price": effective_price,
            "effective_spread_pips": effective_spread / pip_value,
            "cost_bps": (total_slippage / mid) * 10_000,
        })

    return pd.DataFrame(records)


# â”€â”€ Simulate 500 trades â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
trades = simulate_slippage(n_trades=500)

# â”€â”€ Analysis: slippage vs order size â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
size_buckets = pd.qcut(trades["order_size"], q=5, labels=[
    "XS (<$200K)", "S ($200K-$500K)", "M ($500K-$2M)",
    "L ($2M-$5M)", "XL (>$5M)"
])
summary = trades.groupby(size_buckets, observed=True).agg(
    avg_slippage_pips=("effective_spread_pips", "mean"),
    avg_cost_bps=("cost_bps", "mean"),
    avg_impact=("impact_cost", "mean"),
    trade_count=("trade_id", "count"),
).round(3)

print("Slippage Analysis by Order Size Bucket")
print("=" * 65)
print(summary.to_string())

# â”€â”€ Impact on strategy returns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
avg_slippage_bps = trades["cost_bps"].mean()
gross_sharpe = 1.5  # hypothetical gross Sharpe
trades_per_year = 500
annual_cost_drag = avg_slippage_bps * trades_per_year / 10_000
estimated_net_sharpe = gross_sharpe * (1 - annual_cost_drag / 0.10)

print(f"\\n{'='*65}")
print(f"  Avg slippage per trade:  {avg_slippage_bps:.2f} bps")
print(f"  Annual cost drag:        {annual_cost_drag*100:.2f}%")
print(f"  Gross Sharpe:            {gross_sharpe:.2f}")
print(f"  Estimated net Sharpe:    {estimated_net_sharpe:.2f}")`,
              explanation:
                "The simulation models three components of slippage: (1) half-spread cost â€” always paid on market orders, (2) square-root market impact â€” proportional to Ïƒ Ã— Î³ Ã— âˆš(participation rate), which grows sub-linearly with order size, and (3) random fill noise from latency. Order sizes are drawn from a log-normal distribution mimicking real trading. The analysis groups trades by size bucket, showing how slippage increases for larger orders. The final section estimates the net Sharpe ratio after accounting for cumulative slippage drag.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "aq-slip-q1",
                  question:
                    "Why does the square-root impact model predict that doubling order size increases market impact by only ~41% (âˆš2 â‰ˆ 1.41), not 100%?",
                  options: [
                    { id: "aq-slip-q1-a", text: "Because brokers offer volume discounts on larger orders" },
                    { id: "aq-slip-q1-b", text: "Because larger orders are split across time, and price impact partially reverts between child orders as liquidity providers replenish the order book" },
                    { id: "aq-slip-q1-c", text: "Because larger orders always get better fills due to priority in the matching engine" },
                    { id: "aq-slip-q1-d", text: "Because the square-root model is only approximate and the true impact is linear" },
                  ],
                  correctOptionId: "aq-slip-q1-b",
                  explanation:
                    "Market impact has temporary and permanent components. As a large order is executed over time, temporary impact from each child order partially decays as market makers replenish liquidity. This 'resilience' of the order book means impact accumulates sub-linearly with total volume. The square-root relationship Î”P âˆ âˆšV has been empirically validated across equities, FX, and futures markets.",
                },
                {
                  id: "aq-slip-q2",
                  question:
                    "Why does slippage modeling matter more for higher-frequency trading strategies?",
                  options: [
                    { id: "aq-slip-q2-a", text: "Higher-frequency strategies use larger order sizes" },
                    { id: "aq-slip-q2-b", text: "Higher-frequency strategies have smaller expected returns per trade, so fixed transaction costs consume a larger fraction of gross alpha" },
                    { id: "aq-slip-q2-c", text: "Higher-frequency strategies can only trade during illiquid hours" },
                    { id: "aq-slip-q2-d", text: "Higher-frequency strategies don't need stop-losses, so slippage is their only risk" },
                  ],
                  correctOptionId: "aq-slip-q2-b",
                  explanation:
                    "A strategy capturing 2 bps per trade with 100 trades/day has gross alpha of 200 bps/day. If each trade incurs 0.5 bps of slippage, total daily cost is 50 bps â€” 25% of gross alpha eaten by execution. By contrast, a microstructure strategy capturing 50 bps per trade with 1 trade/day loses only 1% to the same slippage. For HFT, the difference between a profitable and unprofitable strategy is often just 1-2 bps of execution quality.",
                },
                {
                  id: "aq-slip-q3",
                  question:
                    "How can you estimate the effective bid-ask spread from tick-level trade data when quotes are unavailable?",
                  options: [
                    { id: "aq-slip-q3-a", text: "Use the daily high minus the daily low as a spread proxy" },
                    { id: "aq-slip-q3-b", text: "Apply the Roll (1984) estimator: spread â‰ˆ 2âˆš(âˆ’Cov(Î”p_t, Î”p_{t-1})), which infers the spread from the negative autocovariance of trade price changes" },
                    { id: "aq-slip-q3-c", text: "Divide the daily volume by the number of trades" },
                    { id: "aq-slip-q3-d", text: "Compute the standard deviation of returns as a spread proxy" },
                  ],
                  correctOptionId: "aq-slip-q3-b",
                  explanation:
                    "The Roll (1984) model exploits the bid-ask bounce: consecutive trades alternating between bid and ask create a negative serial covariance in price changes. The effective half-spread s satisfies: Cov(Î”p_t, Î”p_{tâˆ’1}) = âˆ’sÂ². So s = âˆš(âˆ’Cov), and the full spread = 2s. This elegant estimator works even without quote data, though it assumes trades are equally likely to hit the bid or ask.",
                },
              ],
            },
            {
              type: "practice",
              title: "Slippage-Adjusted Backtest Analysis",
              description:
                "Take an existing backtest from the model catalog and add realistic slippage modeling using the square-root impact model calibrated to EUR/USD market conditions (Ïƒ_daily â‰ˆ 0.6%, Î³ â‰ˆ 0.3, V_daily â‰ˆ $5B). Run the backtest with and without slippage. Compare gross vs. net Sharpe ratio, max drawdown, and cumulative P&L. Determine the maximum order size at which the strategy remains profitable after slippage.",
              catalogModelId: "risk-model",
            },
          ],
        },

        // â”€â”€ Lesson 4: Regime-Adaptive Portfolio Construction â”€â”€â”€â”€
        {
          id: "aq-regime-adaptive",
          title: "Regime-Adaptive Portfolio Construction",
          description:
            "Integrate regime detection models into portfolio construction: regime-conditional covariance estimation, dynamic allocation switching, tail-risk parity, and practical strategies for navigating regime transitions.",
          estimatedMinutes: 60,
          difficulty: "advanced",
          relatedModels: ["hmm", "portfolio-optimizer"],
          prerequisites: ["aq-portfolio"],
          sections: [
            {
              type: "objective",
              content:
                "By the end of this lesson you will integrate HMM regime detection into portfolio construction, compute regime-conditional covariance matrices, solve for regime-appropriate allocation weights, implement transition-period dampening, and understand tail-risk parity as a regime-robust alternative.",
              keyTakeaways: [
                "Static allocations fail during regime changes because the covariance structure Î£ shifts dramatically â€” correlations spike in crises",
                "Regime-conditional covariance: Î£_k = Cov(r | state = k) estimated separately for each HMM state k âˆˆ {1, â€¦, K}",
                "Dynamic allocation: w(t) = w_k when P(state_t = k) > threshold, with dampening during transitions to avoid whipsaw",
                "Tail-risk parity equalizes CVaR contributions instead of variance contributions, providing robustness to fat tails and regime shifts",
              ],
            },
            {
              type: "theory",
              title: "Regime Detection Meets Portfolio Construction",
              content:
                "**Why static allocation fails:** Traditional portfolio optimization assumes a single, stationary covariance matrix Î£. In reality, Î£ is regime-dependent: during trending (low-vol) regimes, cross-asset correlations are moderate and diversification works. During crisis (high-vol) regimes, correlations spike toward 1.0, diversification collapses, and the 'optimal' portfolio from calm times becomes dangerously concentrated. This is the diversification meltdown: the moment you need diversification most, it disappears.\n\n**Regime-conditional covariance estimation:** Given a Hidden Markov Model with K states, estimate K separate covariance matrices Î£_k = Cov(r_t | s_t = k). Using the Viterbi-decoded state sequence or posterior probabilities Î³_t(k) = P(s_t = k | r_{1:T}), weight each observation by its state membership:\n\n  Î£_k = âˆ‘_t Î³_t(k) Ã— (r_t âˆ’ Î¼_k)(r_t âˆ’ Î¼_k)' / âˆ‘_t Î³_t(k)\n\nwhere Î¼_k = âˆ‘_t Î³_t(k) Ã— r_t / âˆ‘_t Î³_t(k) is the regime-conditional mean. This gives K covariance matrices capturing the distinct correlation structures of each regime.\n\n**Dynamic allocation switching:** At each time t, determine the current regime k* = argmax_k P(s_t = k) and solve for the regime-appropriate portfolio:\n\n  w_k* = argmin_w Â½ w'Î£_{k*}w  s.t. constraints\n\nDuring regime transitions (when max_k P(s_t = k) < 0.7), use a probability-weighted blend: w(t) = âˆ‘_k P(s_t = k) Ã— w_k, smoothing the allocation to prevent whipsaw trading from rapid regime flipping.\n\n**Black-Litterman with regime-based views:** Instead of subjective investor views, use regime detection to generate quantitative views. If the HMM detects a high-volatility regime, set views that safe-haven currencies (CHF, JPY) will outperform risk currencies (AUD, NZD). The confidence in each view scales with P(state_t = k) â€” high probability means high confidence.\n\n**Tail-risk parity:** Replace variance with CVaR as the risk measure. The tail-risk contribution of asset i is TRC_i = w_i Ã— âˆ‚CVaR/âˆ‚w_i. Tail-risk parity solves for w such that TRCâ‚ = TRCâ‚‚ = â€¦ = TRCâ‚™. Unlike variance-based risk parity, this accounts for fat tails and asymmetric distributions â€” critical in regime-change environments where tail events cluster. The optimization is non-convex and typically solved via sequential quadratic programming or sampling-based CVaR estimation.",
            },
            {
              type: "intuition",
              title: "A Wardrobe for Every Market Season",
              analogy:
                "You don't wear the same clothes all year â€” a winter coat in July is as bad as shorts in January. Regime-adaptive portfolios work the same way: they change their allocation 'outfit' based on the current market 'season.' In a trending regime (summer), you wear light, growth-oriented allocations (momentum currencies). In a volatile regime (winter), you bundle up with defensive allocations (safe havens, reduced leverage). The HMM is your weather forecast â€” it tells you which season the market is in right now and how likely a season change is.",
              content:
                "The transition-period dampening is like the spring/fall wardrobe: when the weather is ambiguous (regime probability < 70%), you layer â€” wearing a blend of seasonal clothes rather than committing fully to one season. This prevents the embarrassment of showing up in a winter coat on an unseasonably warm day (whipsaw trading from false regime switches). Tail-risk parity is like buying insurance for extreme weather â€” it doesn't just equalize day-to-day comfort (variance), it ensures you're equally protected against hurricanes and blizzards (tail events).",
              emoji: "ðŸ‘”",
            },
            {
              type: "code",
              title: "Regime-Conditional Portfolio Allocation",
              language: "python",
              code: `import numpy as np
from scipy.optimize import minimize

np.random.seed(42)

# â”€â”€ Simulate 4-currency returns with 2 regimes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
n_bars = 1000
assets = ["EUR/USD", "GBP/USD", "AUD/USD", "USD/CHF"]
n_assets = len(assets)

# Regime 1: Low-vol trending (60% of time)
mu_1 = np.array([0.0003, 0.0004, 0.0005, -0.0002])
cov_1 = np.array([
    [0.0001, 0.00005, 0.00003, -0.00006],
    [0.00005, 0.00012, 0.00004, -0.00005],
    [0.00003, 0.00004, 0.00015, -0.00003],
    [-0.00006, -0.00005, -0.00003, 0.00008],
])

# Regime 2: High-vol crisis (40% of time) â€” correlations spike
mu_2 = np.array([-0.0005, -0.0008, -0.001, 0.0006])
cov_2 = np.array([
    [0.0005, 0.00035, 0.0003, -0.0003],
    [0.00035, 0.0006, 0.00038, -0.00035],
    [0.0003, 0.00038, 0.0008, -0.00028],
    [-0.0003, -0.00035, -0.00028, 0.0004],
])

# Generate regime sequence (Markov chain)
states = np.zeros(n_bars, dtype=int)
trans_prob = np.array([[0.97, 0.03], [0.05, 0.95]])
for t in range(1, n_bars):
    states[t] = np.random.choice(2, p=trans_prob[states[t - 1]])

# Generate returns conditional on regime
returns = np.zeros((n_bars, n_assets))
for t in range(n_bars):
    if states[t] == 0:
        returns[t] = np.random.multivariate_normal(mu_1, cov_1)
    else:
        returns[t] = np.random.multivariate_normal(mu_2, cov_2)

# â”€â”€ Regime-conditional covariance estimation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def estimate_regime_params(returns, states, n_regimes=2):
    """Estimate mean and covariance for each regime."""
    params = {}
    for k in range(n_regimes):
        mask = states == k
        r_k = returns[mask]
        params[k] = {
            "mu": r_k.mean(axis=0),
            "cov": np.cov(r_k, rowvar=False),
            "count": mask.sum(),
        }
    return params

regime_params = estimate_regime_params(returns, states)

# â”€â”€ Solve for regime-specific optimal portfolios â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def min_variance_portfolio(cov_matrix, n):
    """Minimum variance portfolio via scipy.optimize."""
    def objective(w):
        return w @ cov_matrix @ w

    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1}]
    bounds = [(0.05, 0.6)] * n  # position limits
    w0 = np.ones(n) / n
    result = minimize(objective, w0, method="SLSQP",
                      bounds=bounds, constraints=constraints)
    return result.x if result.success else w0

# Regime-specific weights
w_regime = {}
for k in range(2):
    w_regime[k] = min_variance_portfolio(regime_params[k]["cov"], n_assets)

# Static (unconditional) portfolio for comparison
cov_static = np.cov(returns, rowvar=False)
w_static = min_variance_portfolio(cov_static, n_assets)

# â”€â”€ Dynamic allocation with transition dampening â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
regime_probs = np.zeros((n_bars, 2))
regime_probs[0] = [0.5, 0.5]
for t in range(1, n_bars):
    # Simple posterior update (simulate HMM filtering)
    prior = regime_probs[t - 1] @ trans_prob
    likelihood = np.array([
        max(1e-10, np.exp(-0.5 * returns[t] @ np.linalg.inv(
            regime_params[k]["cov"]) @ returns[t]))
        for k in range(2)
    ])
    posterior = prior * likelihood
    regime_probs[t] = posterior / posterior.sum()

# Compute dynamic weights with blending
CONFIDENCE_THRESHOLD = 0.70
dynamic_returns = np.zeros(n_bars)
static_returns = np.zeros(n_bars)

for t in range(1, n_bars):
    max_prob = regime_probs[t].max()
    if max_prob >= CONFIDENCE_THRESHOLD:
        k_star = regime_probs[t].argmax()
        w_t = w_regime[k_star]
    else:
        # Blend during transitions
        w_t = sum(regime_probs[t][k] * w_regime[k] for k in range(2))

    dynamic_returns[t] = w_t @ returns[t]
    static_returns[t] = w_static @ returns[t]

# â”€â”€ Performance comparison â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def calc_sharpe(r):
    return r.mean() / r.std() * np.sqrt(252) if r.std() > 0 else 0

def calc_max_dd(r):
    cum = np.cumsum(r)
    return (cum - np.maximum.accumulate(cum)).min()

print("Regime-Adaptive vs Static Portfolio")
print("=" * 55)
print(f"{'Metric':<25} {'Static':>12} {'Adaptive':>12}")
print("-" * 55)
metrics = [
    ("Ann. Return", lambda r: f"{r.mean()*252:.2%}"),
    ("Ann. Volatility", lambda r: f"{r.std()*np.sqrt(252):.2%}"),
    ("Sharpe Ratio", lambda r: f"{calc_sharpe(r):.2f}"),
    ("Max Drawdown", lambda r: f"{calc_max_dd(r):.4f}"),
]
for name, fn in metrics:
    print(f"  {name:<23} {fn(static_returns):>12} {fn(dynamic_returns):>12}")

print(f"\\nRegime distribution: {(states==0).mean():.0%} calm, "
      f"{(states==1).mean():.0%} crisis")
print(f"\\nRegime-specific weights:")
for k in range(2):
    regime_name = "Calm" if k == 0 else "Crisis"
    weights_str = "  ".join(f"{a}: {w:.0%}" for a, w in zip(assets, w_regime[k]))
    print(f"  {regime_name}: {weights_str}")`,
              explanation:
                "The code simulates a 2-regime market environment: a calm trending regime with low correlations and a crisis regime with spiking correlations. Regime-conditional covariance matrices are estimated separately for each state. Minimum variance portfolios are computed per regime â€” the crisis portfolio shifts weight toward the safe-haven USD/CHF. Dynamic allocation uses filtered regime probabilities: when confidence exceeds 70%, commit to the regime-specific portfolio; during transitions, blend allocations proportionally. The comparison against a static (unconditional) portfolio demonstrates the Sharpe improvement from regime adaptation.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "aq-regime-q1",
                  question:
                    "Why do static portfolio allocations fail during market regime changes?",
                  options: [
                    { id: "aq-regime-q1-a", text: "Because static allocations use too many assets" },
                    { id: "aq-regime-q1-b", text: "Because the covariance structure Î£ shifts dramatically â€” correlations spike in crises, collapsing the diversification that the static portfolio was designed to exploit" },
                    { id: "aq-regime-q1-c", text: "Because static allocations cannot be implemented in practice" },
                    { id: "aq-regime-q1-d", text: "Because static allocations always use equal weights" },
                  ],
                  correctOptionId: "aq-regime-q1-b",
                  explanation:
                    "Static mean-variance or risk parity portfolios are optimized for the average covariance matrix across all regimes. During crises, correlations spike (the 'diversification meltdown'), making the portfolio far riskier than intended. A static 60/40 split between risk and safe-haven currencies might have a correlation of 0.3 in calm markets but 0.8 in crises â€” the portfolio's effective risk doubles even though the weights haven't changed.",
                },
                {
                  id: "aq-regime-q2",
                  question:
                    "What is the purpose of computing regime-conditional covariance matrices Î£_k instead of using a single unconditional Î£?",
                  options: [
                    { id: "aq-regime-q2-a", text: "To reduce the number of parameters in the covariance estimation" },
                    { id: "aq-regime-q2-b", text: "To capture the distinct correlation structures of each market regime, enabling allocation optimization that reflects current market conditions rather than a time-averaged blend" },
                    { id: "aq-regime-q2-c", text: "To make the covariance matrix invertible when it would otherwise be singular" },
                    { id: "aq-regime-q2-d", text: "To increase the number of data points available for estimation" },
                  ],
                  correctOptionId: "aq-regime-q2-b",
                  explanation:
                    "An unconditional Î£ is a weighted average of regime-specific Î£_k matrices, blurring the distinct correlation structures. In a calm regime, EUR/USD and AUD/USD might have Ï = 0.3; in a crisis, Ï = 0.8. The unconditional Ï â‰ˆ 0.5 accurately represents neither regime. By estimating Î£_k separately, we can optimize allocations that are appropriate for the current regime rather than optimizing for an 'average' market that never actually exists.",
                },
                {
                  id: "aq-regime-q3",
                  question:
                    "Why is allocation blending during regime transition periods important?",
                  options: [
                    { id: "aq-regime-q3-a", text: "Because blending always produces higher Sharpe ratios" },
                    { id: "aq-regime-q3-b", text: "Because hard switching when regime probabilities are ambiguous causes whipsaw trading â€” frequent back-and-forth rebalancing that incurs transaction costs and may react to false regime signals" },
                    { id: "aq-regime-q3-c", text: "Because regulatory requirements mandate gradual portfolio transitions" },
                    { id: "aq-regime-q3-d", text: "Because the HMM cannot produce probability estimates, only hard classifications" },
                  ],
                  correctOptionId: "aq-regime-q3-b",
                  explanation:
                    "During transitions, the HMM's posterior probabilities fluctuate between regimes. Hard switching (commit to regime k when P(k) > 50%) causes rapid portfolio turnover as probabilities oscillate around the threshold. Each rebalance incurs spread and impact costs. Blending w(t) = âˆ‘_k P(k) Ã— w_k produces smooth weight transitions proportional to regime confidence, reducing turnover while still adapting to genuine regime shifts.",
                },
              ],
            },
            {
              type: "practice",
              title: "Regime-Adaptive Allocation with HMM",
              description:
                "Build a regime-adaptive portfolio allocation system for 6 major forex pairs using HMM regime detection from the model catalog. Fit a 3-state HMM (trending, mean-reverting, volatile) on daily returns. Compute regime-conditional covariance matrices and solve for minimum-variance portfolios per regime. Implement dynamic allocation with transition dampening (blend when max P(state) < 0.7). Backtest over 3 years and compare against static risk parity. Plot allocation weights over time alongside the detected regime sequence.",
              catalogModelId: "hmm",
            },
          ],
        },
      ],
    },
  ],
};

