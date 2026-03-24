import type { LearningPath } from "../types";

export const appliedQuantPath: LearningPath = {
  id: "applied-quant",
  title: "Applied Quant Finance",
  description:
    "Bridge the gap between ML models and profitable trading systems. Master financial feature engineering, rigorous backtesting methodology, risk metrics, and portfolio optimization — the practical toolkit every quant trader needs.",
  icon: "TrendingUp",
  color: "cyan",
  difficulty: "advanced",
  estimatedHours: 22,
  modules: [
    // ────────────────────────────────────────────────────────────
    // Module 1 — Feature Engineering & Backtesting
    // ────────────────────────────────────────────────────────────
    {
      id: "feat-backtest",
      title: "Feature Engineering & Backtesting",
      description:
        "Transform raw OHLCV data into predictive features and validate trading strategies with walk-forward methods that respect the temporal structure of financial markets.",
      lessons: [
        // ── Lesson 1: Financial Feature Engineering ─────────────
        {
          id: "aq-features",
          title: "Financial Feature Engineering",
          description:
            "Build a comprehensive feature set from raw price data: technical indicators, rolling statistics, return transformations, and feature selection techniques tailored for time-series prediction.",
          estimatedMinutes: 55,
          difficulty: "advanced",
          relatedModels: ["xgboost", "random-forest"],
          sections: [
            {
              type: "objective",
              content:
                "By the end of this lesson you will be able to compute standard technical indicators (RSI, MACD, Bollinger Bands), engineer rolling statistical features, apply proper return transformations, and use feature importance / selection methods to build parsimonious, predictive feature sets for ML models.",
              keyTakeaways: [
                "Raw prices are non-stationary — always transform to log-returns, percentage changes, or z-scores before modeling",
                "Technical indicators (RSI, MACD, Bollinger) encode momentum, trend, and volatility into bounded, comparable features",
                "Rolling statistics (μ, σ, skew, kurtosis over windows w ∈ {20, 60, 120}) capture multi-scale market dynamics",
                "Feature selection via mutual information, permutation importance, or SHAP prevents overfitting to noise",
              ],
            },
            {
              type: "theory",
              title: "From OHLCV to Predictive Features",
              content:
                "Raw price series P_t are integrated of order 1 — non-stationary, with time-varying mean and variance. ML models trained on raw prices learn spurious correlations that collapse out-of-sample.\n\nThe fix: transform to stationary features.\n\n**Return transformations:**\n• Simple return: r_t = (P_t − P_{t−1}) / P_{t−1}\n• Log return: r_t = ln(P_t / P_{t−1}) — additive over time, approximately Gaussian for short horizons\n• Z-score: z_t = (r_t − μ̂_w) / σ̂_w where μ̂_w and σ̂_w are rolling mean and std over window w\n\n**Technical indicators as features:**\n• RSI(14) = 100 − 100/(1 + avg_gain/avg_loss) — momentum oscillator ∈ [0, 100]\n• MACD = EMA(12) − EMA(26); Signal = EMA(MACD, 9) — trend-following\n• Bollinger %B = (P − lower) / (upper − lower) — mean-reversion signal ∈ (−∞, +∞) but typically [0, 1]\n• ATR(14) = EMA of true range — volatility proxy\n\n**Rolling statistics at multiple scales:**\nFor each window w, compute: μ_w, σ_w, skew_w, kurtosis_w, max_drawdown_w. Stack windows w ∈ {5, 20, 60, 120} to capture intraweek, monthly, quarterly, and semi-annual dynamics.\n\n**Feature selection:**\n• Filter: drop features with |correlation| > 0.95 (redundancy), then rank by mutual information I(feature; target)\n• Wrapper: recursive feature elimination (RFE) with a tree-based model\n• Embedded: L1 regularization or tree-based feature importance (Gini / permutation)",
            },
            {
              type: "intuition",
              title: "Building a Weather Station for Markets",
              analogy:
                "Predicting tomorrow's weather from today's temperature alone is unreliable. But a weather station measures temperature, humidity, pressure, wind speed, and cloud cover — each capturing a different atmospheric dynamic. Financial feature engineering works the same way: RSI is your 'momentum barometer,' Bollinger %B is the 'mean-reversion humidity gauge,' ATR is the 'volatility wind speed,' and rolling kurtosis is the 'tail-risk cloud detector.' No single instrument is sufficient, but together they give your ML model a rich, multi-dimensional view of market conditions.",
              content:
                "Just as a meteorologist discards broken instruments (noisy features), feature selection removes redundant or uninformative signals. And just as you wouldn't use a barometer reading from last year to predict today's weather, you must respect temporal ordering — all features must be computed using only past data to avoid look-ahead bias.",
              emoji: "🌤️",
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
    """
    c = df["close"]
    h = df["high"]
    l = df["low"]

    feat = pd.DataFrame(index=df.index)

    # ── Return transformations ───────────────────────────────
    feat["log_return"] = np.log(c / c.shift(1))
    for w in [5, 20, 60]:
        feat[f"return_{w}d"] = c.pct_change(w)
        feat[f"zscore_{w}d"] = (
            (feat["log_return"] - feat["log_return"].rolling(w).mean())
            / feat["log_return"].rolling(w).std()
        )

    # ── RSI(14) ──────────────────────────────────────────────
    delta = c.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    feat["rsi_14"] = 100 - 100 / (1 + gain / loss)

    # ── MACD ─────────────────────────────────────────────────
    ema12 = c.ewm(span=12, adjust=False).mean()
    ema26 = c.ewm(span=26, adjust=False).mean()
    feat["macd"] = ema12 - ema26
    feat["macd_signal"] = feat["macd"].ewm(span=9, adjust=False).mean()
    feat["macd_hist"] = feat["macd"] - feat["macd_signal"]

    # ── Bollinger Bands %B ───────────────────────────────────
    sma20 = c.rolling(20).mean()
    std20 = c.rolling(20).std()
    feat["boll_pctb"] = (c - (sma20 - 2 * std20)) / (4 * std20)

    # ── ATR(14) — Average True Range ────────────────────────
    tr = pd.concat([
        h - l,
        (h - c.shift(1)).abs(),
        (l - c.shift(1)).abs(),
    ], axis=1).max(axis=1)
    feat["atr_14"] = tr.ewm(span=14, adjust=False).mean()

    # ── Rolling statistics at multiple scales ────────────────
    for w in [20, 60, 120]:
        roll = feat["log_return"].rolling(w)
        feat[f"vol_{w}d"] = roll.std() * np.sqrt(252)
        feat[f"skew_{w}d"] = roll.skew()
        feat[f"kurt_{w}d"] = roll.kurt()

    # ── Volume features ──────────────────────────────────────
    feat["vol_ratio"] = df["volume"] / df["volume"].rolling(20).mean()

    return feat.dropna()


# ── Example usage ────────────────────────────────────────────
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
print(f"Columns: {list(features.columns)}")
print(f"\\nSample (last 3 rows):\\n{features.tail(3).to_string()}")`,
              explanation:
                "The compute_features function transforms raw OHLCV into a rich feature set: log returns and z-scores at multiple horizons, RSI(14) for momentum, MACD histogram for trend, Bollinger %B for mean-reversion, ATR(14) for volatility, and multi-scale rolling statistics (annualized vol, skewness, kurtosis). The final dropna() removes the warm-up period. This feature matrix feeds directly into tree-based or neural network models.",
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
                    "Look-ahead bias occurs when a feature or label uses future information (e.g., a rolling window centered on t instead of trailing). In backtesting this creates the illusion of predictability, but in live trading the future data isn't available and the model fails catastrophically.",
                },
                {
                  id: "aq-feat-q2",
                  question:
                    "What is the primary purpose of z-score normalization (z_t = (r_t − μ̂_w) / σ̂_w) for return features?",
                  options: [
                    { id: "aq-feat-q2-a", text: "To make returns strictly positive for log transformations" },
                    { id: "aq-feat-q2-b", text: "To express returns relative to recent local behavior, making the signal comparable across different volatility regimes" },
                    { id: "aq-feat-q2-c", text: "To maximize the mutual information between features and the target" },
                    { id: "aq-feat-q2-d", text: "To remove the autocorrelation structure from the return series" },
                  ],
                  correctOptionId: "aq-feat-q2-b",
                  explanation:
                    "A 1% move means very different things in a low-vol (σ = 0.3%) vs high-vol (σ = 2%) regime. Z-scoring normalizes returns by the local rolling standard deviation, so a z = 2 always means '2 standard deviations above the local mean' — regardless of the current volatility level. This regime-invariance helps ML models generalize.",
                },
                {
                  id: "aq-feat-q3",
                  question:
                    "When two features have correlation |ρ| > 0.95, what should you do?",
                  options: [
                    { id: "aq-feat-q3-a", text: "Keep both — more features always improve model performance" },
                    { id: "aq-feat-q3-b", text: "Drop one to reduce multicollinearity, keeping the feature with higher univariate importance" },
                    { id: "aq-feat-q3-c", text: "Average them into a single composite feature" },
                    { id: "aq-feat-q3-d", text: "Apply PCA to decorrelate them before feeding to the model" },
                  ],
                  correctOptionId: "aq-feat-q3-b",
                  explanation:
                    "Highly correlated features provide nearly identical information. Keeping both inflates the effective dimensionality, makes feature importance unreliable (importance is split between them), and can destabilize linear models. Drop the less informative one. PCA is an alternative but reduces interpretability.",
                },
              ],
            },
            {
              type: "practice",
              title: "Feature Importance Analysis on Real Forex Data",
              description:
                "Pull EUR/USD daily OHLCV from your QuestDB pipeline, compute the full feature set, then train an XGBoost classifier to predict next-day direction. Use SHAP values to rank feature importance. Identify which indicator group (momentum, trend, volatility, volume) contributes most. Try removing the bottom 50% of features — does out-of-sample accuracy improve?",
              catalogModelId: "xgboost",
            },
          ],
        },

        // ── Lesson 2: Backtesting Frameworks ────────────────────
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
                "Never use random train/test splits for time series — temporal ordering must be preserved to avoid information leakage",
                "Walk-forward validation retrains the model at each step: train on [0, t), predict [t, t+h), advance, repeat",
                "Transaction costs (spread + commission) and slippage must be modeled — they often erase marginal alpha",
                "Monte Carlo permutation tests establish whether strategy returns are statistically significant vs. random chance",
              ],
            },
            {
              type: "theory",
              title: "Walk-Forward Validation & Overfitting Detection",
              content:
                "Standard k-fold cross-validation randomly shuffles data, allowing the model to see future information during training. For financial time series this is catastrophic — autocorrelation and regime persistence mean shuffled folds leak forward-looking information.\n\n**Walk-forward validation** preserves temporal order:\n1. Fix a minimum training window W_min and a prediction horizon h\n2. At each step t: train on [0, t), predict [t, t+h), record predictions\n3. Advance: t → t + h (or t + 1 for one-step-ahead)\n4. Expanding window: training set grows; sliding window: training set size stays fixed at W\n\n**Purged cross-validation** (de Prado, 2018) adds a gap of g bars between train and test folds to prevent label leakage from overlapping return horizons.\n\n**Overfitting detection:**\n• Compare in-sample vs. out-of-sample Sharpe: a ratio > 2:1 signals overfitting\n• Combinatorial Symmetric Cross-Validation (CSCV): generate all possible train/test path combinations and check if the probability of selecting an overfit model exceeds a threshold\n• Deflated Sharpe Ratio (DSR): adjusts the observed Sharpe for the number of strategies tried, non-normal returns, and estimation error\n\n**Transaction cost modeling:**\n• Spread cost: half-spread × 2 (entry + exit) per round-trip\n• Commission: fixed per-lot or percentage\n• Slippage: market impact ≈ σ √(V_order / V_market) for large orders\n• Implementation shortfall: ∑(cost_component) per trade, subtracted from gross P&L",
            },
            {
              type: "intuition",
              title: "The Time-Travel Paradox of Random Splits",
              analogy:
                "Imagine you're testing a weather prediction model. Random cross-validation is like shuffling days from January, July, and October into both training and test sets — the model learns that 'if yesterday was 30°C, today is probably warm,' but it's using July data to predict January and vice versa. For markets, this is even worse: regimes (bull, bear, crisis) cluster in time. A model trained on 2020 COVID data can trivially 'predict' March 2020 if randomly shuffled data from February and April leak into training.",
              content:
                "Walk-forward validation is honest time travel: the model only knows the past, predicts the immediate future, then advances. It's slower (requires retraining at each step), but it's the only method that produces realistic performance estimates. If your strategy looks great in walk-forward and terrible in live trading, the problem is elsewhere (regime change, execution, etc.) — but at least you haven't fooled yourself with leaky validation.",
              emoji: "⏳",
            },
            {
              type: "code",
              title: "Walk-Forward Backtest with Transaction Costs",
              language: "python",
              code: `import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier

np.random.seed(42)

# ── Simulate features + binary target (1=up, 0=down) ────────
n = 1000
features = np.random.randn(n, 5)
true_signal = 0.02 * features[:, 0] - 0.01 * features[:, 2]
returns = true_signal + np.random.normal(0, 0.01, n)
target = (returns > 0).astype(int)

# ── Walk-forward parameters ──────────────────────────────────
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

    # ── Apply transaction costs ──────────────────────────────
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

# ── Performance metrics ──────────────────────────────────────
sharpe = df["net"].mean() / df["net"].std() * np.sqrt(252)
max_dd = (cumulative - cumulative.cummax()).min()

print(f"Walk-forward backtest results ({len(df)} bars)")
print(f"  Total trades:   {total_trades}")
print(f"  Gross P&L:      {df['gross'].sum():.4f}")
print(f"  Total costs:    {df['cost'].sum():.4f}")
print(f"  Net P&L:        {df['net'].sum():.4f}")
print(f"  Sharpe ratio:   {sharpe:.2f}")
print(f"  Max drawdown:   {max_dd:.4f}")

# ── Monte Carlo permutation test ─────────────────────────────
n_perms = 1000
perm_sharpes = []
for _ in range(n_perms):
    shuffled = np.random.permutation(df["net"].values)
    s = shuffled.mean() / shuffled.std() * np.sqrt(252)
    perm_sharpes.append(s)

p_value = np.mean([s >= sharpe for s in perm_sharpes])
print(f"\\nMonte Carlo p-value: {p_value:.3f} (from {n_perms} permutations)")
print(f"Strategy {'IS' if p_value < 0.05 else 'IS NOT'} significant at α=0.05")`,
              explanation:
                "The walk-forward loop trains on an expanding window [0, t) and predicts the next STEP bars. Positions are binary (long or flat). Transaction costs are deducted on every position change: spread (2 pips) + slippage (0.5 pips). After collecting all out-of-sample returns, we compute the net Sharpe ratio and maximum drawdown. The Monte Carlo permutation test shuffles net returns 1000 times to build a null distribution — if fewer than 5% of random permutations achieve a higher Sharpe, the strategy is statistically significant.",
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
                    { id: "aq-bt-q2-b", text: "The strategy is overfit to training data — the 4:1 ratio signals excessive complexity or data snooping" },
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
      ],
    },

    // ────────────────────────────────────────────────────────────
    // Module 2 — Risk & Portfolio
    // ────────────────────────────────────────────────────────────
    {
      id: "risk-portfolio",
      title: "Risk & Portfolio",
      description:
        "Quantify, manage, and optimize risk. From single-position sizing with Kelly and VaR to multi-asset portfolio construction via mean-variance, risk parity, and hierarchical methods.",
      lessons: [
        // ── Lesson 1: Risk Metrics & Position Sizing ────────────
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
                "VaR(α) = −quantile(returns, α) — the loss exceeded with probability α (e.g., 5%)",
                "CVaR(α) = 𝔼[−r | r ≤ −VaR(α)] — average loss in the worst α tail, more coherent than VaR",
                "Sharpe = (μ − r_f) / σ; Sortino uses downside σ; Calmar = annualized return / max drawdown",
                "Kelly fraction f* = μ / σ² — optimal geometric growth rate, but practitioners use half-Kelly for safety",
              ],
            },
            {
              type: "theory",
              title: "Measuring and Sizing Risk",
              content:
                "**Value-at-Risk (VaR):** For a confidence level α (e.g., 5%), VaR is the loss threshold such that P(loss > VaR) = α. For daily returns r_t with mean μ and std σ:\n• Historical VaR: sort returns, take the α-th percentile\n• Parametric VaR: VaR_α = −(μ + z_α · σ) where z_α = Φ⁻¹(α) ≈ −1.645 for α=5%\n\nVaR has a critical flaw: it ignores the severity of losses beyond the threshold. A portfolio with VaR(5%) = 2% could have a worst-case loss of 3% or 30% — VaR doesn't distinguish.\n\n**Conditional VaR (CVaR / Expected Shortfall):** CVaR_α = 𝔼[−r | r ≤ −VaR_α] — the average loss in the worst α fraction. CVaR is a coherent risk measure (subadditive), meaning diversification always reduces it.\n\n**Performance ratios:**\n• Sharpe = (μ_annual − r_f) / σ_annual — reward per unit of total risk\n• Sortino = (μ_annual − r_f) / σ_downside — penalizes only downside volatility\n• Calmar = μ_annual / |max_drawdown| — return per unit of worst peak-to-trough loss\n\n**Kelly criterion:** For a strategy with expected return μ and variance σ², the fraction maximizing long-run geometric growth is f* = μ / σ². In practice, half-Kelly (f*/2) is used because:\n1. Parameter estimates μ̂, σ̂² have error\n2. Full Kelly produces extreme drawdowns\n3. Log-utility may be too aggressive for most traders\n\n**Volatility targeting:** Set a target annualized volatility σ_target (e.g., 10%). Each day, scale position size by σ_target / σ̂_realized, where σ̂_realized is the trailing realized vol (e.g., 20-day). This stabilizes return variance across regimes.",
            },
            {
              type: "intuition",
              title: "Risk as the Price of Admission",
              analogy:
                "Think of VaR as the cover charge at a nightclub — it tells you the minimum you'll spend to get in on a bad night. But CVaR is more like your total bar tab on those bad nights: once you're past the cover charge, how much worse does it actually get? A nightclub with a $20 cover but $500 average tabs (high CVaR) is very different from one with a $20 cover and $30 average tabs, even though the cover (VaR) is identical.",
              content:
                "The Kelly criterion is like choosing your bet size at a poker table. Bet too small and you grow slowly. Bet too large and one bad hand wipes you out. Kelly finds the mathematical sweet spot — but it assumes you know the exact odds. Since we estimate odds with error, half-Kelly is the practical 'play it safe but still grow' strategy. Volatility targeting is the cruise control: it automatically reduces your speed (position size) when the road gets bumpy (high vol) and accelerates on smooth highways (low vol).",
              emoji: "🎰",
            },
            {
              type: "code",
              title: "Computing Risk Metrics with NumPy",
              language: "python",
              code: `import numpy as np

np.random.seed(42)

# ── Simulate 2 years of daily strategy returns ──────────────
n_days = 504
returns = np.random.normal(0.0003, 0.008, n_days)  # μ ≈ 7.5% ann, σ ≈ 12.7% ann
# Inject a few tail events
returns[100] = -0.035  # flash crash
returns[250] = -0.028  # regime shock
returns[400] = 0.022   # squeeze

def compute_risk_metrics(r: np.ndarray, rf: float = 0.0, alpha: float = 0.05):
    """Compute comprehensive risk metrics from a return series."""
    # ── VaR and CVaR ─────────────────────────────────────────
    var = -np.percentile(r, alpha * 100)
    cvar = -r[r <= -var].mean() if np.any(r <= -var) else var

    # ── Annualized performance ratios ────────────────────────
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

    # ── Kelly criterion ──────────────────────────────────────
    kelly_full = r.mean() / r.var() if r.var() > 0 else 0
    kelly_half = kelly_full / 2

    # ── Volatility targeting ─────────────────────────────────
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
                "The function computes: (1) Historical VaR and CVaR at the 5% level — CVaR averages losses beyond VaR, capturing tail severity. (2) Annualized Sharpe (total risk), Sortino (downside risk only), and Calmar (drawdown-adjusted). (3) Full and half-Kelly fractions for position sizing. (4) A volatility-targeting overlay that scales returns by σ_target / σ̂_trailing, stabilizing realized volatility and often improving the Sharpe ratio.",
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
                    "VaR only reports the threshold loss at a given confidence level — it says nothing about how bad losses can get beyond that point. CVaR averages losses in the tail, capturing severity. Crucially, CVaR is subadditive: CVaR(A+B) ≤ CVaR(A) + CVaR(B), so diversification is always rewarded. VaR can violate this property.",
                },
                {
                  id: "aq-risk-q2",
                  question:
                    "Why do practitioners typically use half-Kelly instead of full Kelly for position sizing?",
                  options: [
                    { id: "aq-risk-q2-a", text: "Full Kelly is illegal under most regulatory frameworks" },
                    { id: "aq-risk-q2-b", text: "Full Kelly assumes exact knowledge of μ and σ², but estimation errors can lead to extreme leverage and catastrophic drawdowns" },
                    { id: "aq-risk-q2-c", text: "Half-Kelly maximizes the Sharpe ratio while full Kelly maximizes returns" },
                    { id: "aq-risk-q2-d", text: "Full Kelly only works for binary bet outcomes, not continuous returns" },
                  ],
                  correctOptionId: "aq-risk-q2-b",
                  explanation:
                    "The Kelly criterion f* = μ/σ² assumes μ and σ² are known exactly. In practice, these are estimated with error. Overestimating μ or underestimating σ² leads to over-leveraging and severe drawdowns. Half-Kelly sacrifices ~25% of the geometric growth rate but dramatically reduces drawdown risk and is robust to estimation error.",
                },
              ],
            },
            {
              type: "practice",
              title: "Dynamic Risk Dashboard for Live Strategy",
              description:
                "Build a real-time risk dashboard that computes rolling VaR(5%), CVaR(5%), Sharpe, and Calmar over a 60-day trailing window. Implement a volatility-targeting overlay with σ_target = 10% annualized. Connect to your QuestDB strategy returns table and update metrics every bar. Add an alert when CVaR exceeds 2× its 90-day average.",
              catalogModelId: "risk-model",
            },
          ],
        },

        // ── Lesson 2: Portfolio Optimization ────────────────────
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
                "Mean-variance: min w'Σw  s.t.  w'μ = μ_target, w'1 = 1 — sensitive to estimation errors in μ and Σ",
                "Black-Litterman blends equilibrium returns π = δΣw_mkt with investor views P'μ_BL = Q + ε to produce stable allocations",
                "Risk parity: w_i ∝ 1/σ_i (or equalize risk contributions RC_i = w_i · (Σw)_i / w'Σw) — no expected return estimates needed",
                "HRP uses hierarchical clustering on the correlation matrix to build a diversified, tree-based allocation robust to estimation noise",
              ],
            },
            {
              type: "theory",
              title: "From Markowitz to Hierarchical Risk Parity",
              content:
                "**Mean-Variance Optimization (Markowitz, 1952):**\nGiven n assets with expected return vector μ ∈ ℝⁿ and covariance matrix Σ ∈ ℝⁿ×ⁿ, the efficient frontier solves:\n\n  min_w  ½ w'Σw\n  s.t.   w'μ ≥ μ_target,  w'1 = 1,  w ≥ 0\n\nThe quadratic program yields an optimal weight vector w* for each target return. In practice, mean-variance is notoriously sensitive to estimation errors in μ — small changes in expected returns produce wildly different allocations.\n\n**Minimum Variance Portfolio:** Sets μ_target to the minimum achievable and solves for the lowest-risk portfolio. Since it doesn't require return estimates (only Σ), it's more robust.\n\n**Black-Litterman (1992):** Starts from equilibrium expected returns implied by the market portfolio: π = δΣw_mkt, where δ is the risk aversion coefficient. Investor views are expressed as linear constraints P'μ = Q ± Ω (view uncertainty). The posterior return μ_BL blends equilibrium and views:\n\n  μ_BL = [(τΣ)⁻¹ + P'Ω⁻¹P]⁻¹ [(τΣ)⁻¹π + P'Ω⁻¹Q]\n\nThe result is a stable, intuitive set of expected returns that can be fed back into mean-variance.\n\n**Risk Parity:** Allocates so each asset contributes equally to portfolio risk. The risk contribution of asset i is RC_i = w_i · (Σw)_i. We solve for w such that RC₁ = RC₂ = … = RCₙ. No expected return estimates are needed.\n\n**Hierarchical Risk Parity (HRP, López de Prado 2016):**\n1. Compute the correlation distance matrix d_ij = √(½(1 − ρ_ij))\n2. Apply single-linkage hierarchical clustering\n3. Quasi-diagonalize the covariance matrix along the dendrogram\n4. Recursively bisect the tree, allocating inversely to cluster variance\nHRP is robust to noise in Σ, doesn't require Σ⁻¹, and naturally produces diversified portfolios.",
            },
            {
              type: "intuition",
              title: "Dividing a Pizza Among Friends",
              analogy:
                "Markowitz is like asking each friend how hungry they are (expected returns) and giving bigger slices to the hungriest — but if someone exaggerates their hunger (estimation error), the allocation is terrible. Risk parity ignores hunger entirely and gives each person a slice inversely proportional to how fast they eat (volatility) — fair, but it ignores preferences. Black-Litterman starts with equal hunger (market equilibrium) and only adjusts slices for friends who explicitly say 'I'm extra hungry today' (investor views), with adjustments proportional to how confident they sound.",
              content:
                "HRP is like seating friends in clusters of similar eating habits (hierarchical clustering), then dividing the pizza within each cluster before dividing between clusters. This prevents one oddball friend (an uncorrelated asset) from dominating the allocation just because they sit next to someone with a huge appetite. The tree structure makes the allocation robust even when you don't know everyone's exact hunger level.",
              emoji: "🍕",
            },
            {
              type: "code",
              title: "Efficient Frontier & Risk Parity with SciPy",
              language: "python",
              code: `import numpy as np
from scipy.optimize import minimize

np.random.seed(42)

# ── 5-currency portfolio: EUR, GBP, JPY, AUD, CHF vs USD ───
assets = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CHF"]
n_assets = len(assets)

# Annualized expected returns and covariance (illustrative)
mu = np.array([0.02, 0.03, -0.01, 0.04, 0.005])
# Correlation matrix → covariance
vols = np.array([0.08, 0.09, 0.07, 0.12, 0.06])
corr = np.array([
    [1.00, 0.75, -0.30, 0.55, -0.80],
    [0.75, 1.00, -0.20, 0.60, -0.65],
    [-0.30, -0.20, 1.00, -0.15, 0.40],
    [0.55, 0.60, -0.15, 1.00, -0.45],
    [-0.80, -0.65, 0.40, -0.45, 1.00],
])
Sigma = np.outer(vols, vols) * corr

# ── Mean-Variance: Efficient Frontier ────────────────────────
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

# ── Minimum Variance Portfolio ───────────────────────────────
res_mv = minimize(
    portfolio_vol,
    np.ones(n_assets) / n_assets,
    bounds=[(0, 1)] * n_assets,
    constraints=[{"type": "eq", "fun": lambda w: w.sum() - 1}],
    method="SLSQP",
)
w_mv = res_mv.x

# ── Risk Parity: equalize risk contributions ────────────────
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

# ── Results ──────────────────────────────────────────────────
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
                "We define a 5-currency portfolio with realistic correlations (EUR and CHF are strongly negatively correlated). Three optimization methods are compared: (1) Mean-variance efficient frontier traces the optimal risk-return curve via SLSQP; the max-Sharpe portfolio is extracted. (2) Minimum variance ignores returns entirely and finds the lowest-volatility allocation. (3) Risk parity equalizes each asset's risk contribution RC_i = w_i(Σw)_i / σ_p by minimizing the squared deviation from equal contributions. Risk parity typically produces the most diversified allocation.",
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
                    { id: "aq-port-q1-b", text: "It is extremely sensitive to estimation errors in expected returns μ, producing unstable and concentrated portfolios" },
                    { id: "aq-port-q1-c", text: "It assumes returns are uniformly distributed" },
                    { id: "aq-port-q1-d", text: "It requires daily rebalancing to maintain optimality" },
                  ],
                  correctOptionId: "aq-port-q1-b",
                  explanation:
                    "Mean-variance optimization is an 'error maximizer': small changes in estimated returns μ can flip entire allocations. Assets with slightly overestimated returns get massive weights, while those with slightly underestimated returns are excluded. This is why practitioners prefer robust methods (minimum variance, risk parity, HRP) or Bayesian approaches (Black-Litterman) that stabilize the inputs.",
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
                    "Black-Litterman anchors expected returns to the CAPM equilibrium π = δΣw_mkt rather than using raw historical estimates. The investor can express relative or absolute views ('I think EUR will outperform GBP by 2%') with a confidence level. The posterior μ_BL is a precision-weighted blend of equilibrium and views, producing stable, intuitive allocations.",
                },
                {
                  id: "aq-port-q3",
                  question:
                    "What advantage does Hierarchical Risk Parity (HRP) have over standard risk parity?",
                  options: [
                    { id: "aq-port-q3-a", text: "HRP requires expected return estimates while risk parity does not" },
                    { id: "aq-port-q3-b", text: "HRP uses hierarchical clustering to respect the correlation structure, avoiding matrix inversion and producing allocations robust to estimation noise in Σ" },
                    { id: "aq-port-q3-c", text: "HRP always produces higher Sharpe ratios than risk parity" },
                    { id: "aq-port-q3-d", text: "HRP can only be applied to equity portfolios, not currencies" },
                  ],
                  correctOptionId: "aq-port-q3-b",
                  explanation:
                    "Standard risk parity and mean-variance both require inverting the covariance matrix, which amplifies estimation errors (especially for nearly singular Σ). HRP uses hierarchical clustering and recursive bisection — no matrix inversion needed. The tree structure naturally groups correlated assets, producing diversified allocations that are empirically more stable out-of-sample.",
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
      ],
    },
  ],
};
