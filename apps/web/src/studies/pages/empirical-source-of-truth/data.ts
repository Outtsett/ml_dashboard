export const TRUTHS = [
  {
    "category": "Momentum",
    "feature": "Extreme Up Expansion (>3x Vol, Up Bar)",
    "data": "Next 1 Bar UP: 53.93%",
    "knowledge": "Extreme volume creates directional expansion.",
    "actionType": "LONG",
    "actionTitle": "LONG TRIGGER",
    "wisdom": "Valid standalone momentum feature."
  },
  {
    "category": "Capitulation",
    "feature": "Extreme Down Expansion (>3x Vol, Down Bar)",
    "data": "Next 1 Bar UP: 51.64%",
    "knowledge": "Massive red bars on extreme volume frequently mark capitulation.",
    "actionType": "SHORT",
    "actionTitle": "DO NOT SHORT",
    "wisdom": "Veto short trades immediately following a >3x volume down-bar."
  },
  {
    "category": "Reversal",
    "feature": "Extreme Upper Rejection (>3x Vol)",
    "data": "Next 1 Bar UP: 50.41%",
    "knowledge": "Weak bearish reversal signal.",
    "actionType": "WARNING",
    "actionTitle": "WEAK FEATURE",
    "wisdom": "Needs confluence. Do not build an isolated mean-reversion rule on upper wicks."
  },
  {
    "category": "Reversal",
    "feature": "Extreme Lower Rejection (>3x Vol)",
    "data": "Next 1 Bar UP: 51.33%",
    "knowledge": "Muted predictive value.",
    "actionType": "SHORT",
    "actionTitle": "IGNORE",
    "wisdom": "High volume absorption at a single candle level is statistically unreliable."
  },
  {
    "category": "Volatility Proxy",
    "feature": "Volume vs Anatomy Correlation",
    "data": "Wick-to-Body ratio drops to 0.90.",
    "knowledge": "Bodies triple in size, confirming range expansion.",
    "actionType": "WARNING",
    "actionTitle": "DYNAMIC TARGETS",
    "wisdom": "When Rel Vol > 2x, dynamically widen Take Profit and Stop Loss targets."
  },
  {
    "category": "Representations",
    "feature": "Frozen Candle Encoder (CNN 256-emb)",
    "data": "Encoder does not beat an information-free shuffled control at any horizon.",
    "knowledge": "A CNN embedding trained solely to recognize TA-Lib patterns contains zero predictive edge for forward direction.",
    "actionType": "SHORT",
    "actionTitle": "DO NOT USE",
    "wisdom": "Do not use frozen pattern-recognition embeddings as features for directional prediction models."
  },
  {
    "category": "Computer Vision",
    "feature": "Chart CNN Direction Null Result",
    "data": "AUC sits exactly at 0.50 on MNQ 1m, 5m, and 1h.",
    "knowledge": "2D convolutions on rendered chart images carry no directional information that raw numerical vectors do not already possess.",
    "actionType": "SHORT",
    "actionTitle": "REJECT VISION",
    "wisdom": "Abandon pixel-based CNNs for predicting price direction. Use sequence models on numerical data."
  },
  {
    "category": "Computer Vision",
    "feature": "Chart CNN Pattern Recognition",
    "data": "Near-perfect recognition of TA-Lib patterns, but direction AUC is ~0.50.",
    "knowledge": "The network perfectly learned the shapes, proving the lack of edge is due to the market's nature, not a failure of the model to see the pattern.",
    "actionType": "WARNING",
    "actionTitle": "PATTERN FAILURE",
    "wisdom": "Visual TA-Lib patterns are structurally devoid of forward directional edge."
  },
  {
    "category": "Model Architecture",
    "feature": "Multimodal Model",
    "data": "Nine trials passed zero gates on 2021Q2-2025Q2 holdouts.",
    "knowledge": "Adding macroeconomic calendar events and FinBERT headline embeddings did not rescue a losing bracket model.",
    "actionType": "SHORT",
    "actionTitle": "REJECT MULTIMODAL",
    "wisdom": "Do not assume adding orthogonal data modalities (news, calendar) will automatically grant edge to a model lacking price-action alpha."
  },
  {
    "category": "Feature Engineering",
    "feature": "Quant Bars to Tensor",
    "data": "Trailing z-score stays unknown until window is full.",
    "knowledge": "Using overlapping lookback windows for normalization bleeds volatility information if not strictly purged.",
    "actionType": "WARNING",
    "actionTitle": "STRICT PURGING",
    "wisdom": "Always enforce a strict 100-bar warmup period and purge exactly window_size + horizon bars at fold boundaries."
  },
  {
    "category": "Technical Analysis",
    "feature": "TA-Lib Candlestick Pattern Census",
    "data": "TA-Lib emits flat signals on textbook shapes if prior trend isn't verified.",
    "knowledge": "Hard-coded C-library patterns are overly rigid and miss visually obvious setups while triggering on noisy bars.",
    "actionType": "SHORT",
    "actionTitle": "REJECT TA-LIB",
    "wisdom": "Never rely on TA-Lib. Build continuous, probabilistic shape recognizers instead of binary rules."
  },
  {
    "category": "Technical Analysis",
    "feature": "Pattern Casebook",
    "data": "Results restated as dated trades: 'no edge' on MNQ 2021-2025.",
    "knowledge": "Trading mechanical entries and exits exactly as prescribed by candlestick lore yields negative expected value.",
    "actionType": "SHORT",
    "actionTitle": "AVOID STRATEGY",
    "wisdom": "Do not build trading systems based on traditional candlestick patterns (e.g., Hammers, Engulfing)."
  },
  {
    "category": "Technical Analysis",
    "feature": "Indicator Study (~150 TA-Lib indicators)",
    "data": "Walk-forward logistic on all 150 indicators fails to beat simple baselines.",
    "knowledge": "Aggregating 150 lagging indicators does not synthesize leading alpha. The feature space is entirely redundant.",
    "actionType": "SHORT",
    "actionTitle": "FEATURE BLOAT",
    "wisdom": "Limit feature vectors to primary price/volume derivatives. Do not feed arrays of TA-Lib outputs to models."
  },
  {
    "category": "Technical Analysis",
    "feature": "Regime-Gated Crossover (EMA5/SMA100)",
    "data": "95% BCa interval straddles zero.",
    "knowledge": "Moving average crossovers lack foundational edge; sitting out low-volatility regimes using k-means does not mathematically rescue them.",
    "actionType": "SHORT",
    "actionTitle": "REJECT MA CROSS",
    "wisdom": "Abandon moving average crossover strategies. Regime filtering cannot extract alpha from a negative-sum base signal."
  },
  {
    "category": "Technical Analysis",
    "feature": "TA-Strategy 600 Ticks",
    "data": "Best result was a few ticks a day of alpha. Failed 0 of 3 NQ confirmations.",
    "knowledge": "600 ticks on one contract is out of reach for pure Technical Analysis direction.",
    "actionType": "SHORT",
    "actionTitle": "LOWER EXPECTATIONS",
    "wisdom": "Stop hunting for a 600-tick holy grail using TA rules. Structural edge is measured in single-digit ticks per trade."
  },
  {
    "category": "Technical Analysis",
    "feature": "Path Geometry Study (Efficiency Ratio)",
    "data": "Four forecast targets are all null.",
    "knowledge": "The Efficiency Ratio (net displacement over path length) successfully separates ramps from scribbles but carries zero forward predictive power.",
    "actionType": "SHORT",
    "actionTitle": "IGNORE GEOMETRY",
    "wisdom": "Do not use intraday path efficiency as a directional trigger."
  },
  {
    "category": "Technical Analysis",
    "feature": "Trend State Calibration",
    "data": "Agreement 0.566 vs null 0.507. Net -4.7 points.",
    "knowledge": "Five ring-buffer least-squares rungs on bar-close log price fails to significantly beat a randomized null shuffle out-of-sample.",
    "actionType": "WARNING",
    "actionTitle": "FRAGILE FEATURE",
    "wisdom": "Do not rely on multi-rung O(1) least squares as a solitary trend-state indicator."
  },
  {
    "category": "Technical Analysis",
    "feature": "HWMA Stability",
    "data": "Moving the three correction weights defines a strict boundary between decaying average and compounding explosion.",
    "knowledge": "Holt-Winters Moving Averages are highly unstable in financial time series due to unbounded acceleration.",
    "actionType": "WARNING",
    "actionTitle": "USE WITH EXTREME CAUTION",
    "wisdom": "Ensure strict bounds on the acceleration parameter if using HWMA to prevent model explosions."
  },
  {
    "category": "Data Representation",
    "feature": "Volatility to Price Range (e^v)",
    "data": "v = ln(high - low). e^v is the median bar not the average.",
    "knowledge": "Log-range transformation accurately normalizes the heavy tails of MNQ price action.",
    "actionType": "LONG",
    "actionTitle": "USE LOG-RANGE",
    "wisdom": "Use log-transformed price range instead of raw point differences for all neural network inputs."
  },
  {
    "category": "Data Validation",
    "feature": "Market Bars Validation",
    "data": "OHLCV invariants counted on both sides: float sums to relative 1e-9.",
    "knowledge": "The pipeline accurately guarantees 100% data fidelity between Iceberg lake and DuckDB in-process consumption.",
    "actionType": "LONG",
    "actionTitle": "SYSTEM INVARIANT",
    "wisdom": "Trust the local data architecture. Do not rebuild ingestion integrity checks in modeling scripts."
  },
  {
    "category": "Data Architecture",
    "feature": "Lake Audit",
    "data": "21 row-level checks. Duplicate uniqueness keys verified.",
    "knowledge": "The Iceberg lake is structurally sound and free of hidden duplicates or missing slices.",
    "actionType": "LONG",
    "actionTitle": "SYSTEM INVARIANT",
    "wisdom": "Query the lake confidently using DuckDB; no further row-level sanitization is needed prior to training."
  },
  {
    "category": "Target Engineering",
    "feature": "Direction Labels on Candles",
    "data": "Each direction bit is the sign of close[t+H] minus close[t].",
    "knowledge": "Standard close-to-close labeling creates severe execution mismatch if the strategy intends to enter on the Open.",
    "actionType": "WARNING",
    "actionTitle": "EXECUTION SKEW",
    "wisdom": "Always align label definitions (Open-to-Close vs Close-to-Close) with the exact simulated execution mechanic."
  },
  {
    "category": "Target Engineering",
    "feature": "Label Audit 1m",
    "data": "Baseline is not 0.50 and flips side with the horizon.",
    "knowledge": "Markets have inherent structural drift. A model must beat the horizon-specific drift, not a 50/50 coin flip.",
    "actionType": "WARNING",
    "actionTitle": "BASELINE CORRECTION",
    "wisdom": "Always evaluate model accuracy against the majority-class baseline of the specific timeframe, not 50%."
  },
  {
    "category": "Infrastructure",
    "feature": "Process Census",
    "data": "N = C x (L + R) + 2M + P",
    "knowledge": "Process orchestration costs scale aggressively. Launcher plumbing steals CPU from runtime.",
    "actionType": "WARNING",
    "actionTitle": "OPTIMIZE COMPUTE",
    "wisdom": "Minimize nested shell wrappers during hyperparameter sweeps to prevent thread-starvation on the 24-core CPU."
  },
  {
    "category": "Infrastructure",
    "feature": "TimescaleDB Load Monitor",
    "data": "179 monthly INSERT commits moving the lake's futures.",
    "knowledge": "TimescaleDB hypertable throughput handles the ingestion efficiently, but bulk parquet reads via DuckDB are faster for training.",
    "actionType": "LONG",
    "actionTitle": "READ VIA DUCKDB",
    "wisdom": "Use PostgreSQL/TimescaleDB for relational metadata and serving, but read massive historical sweeps directly via DuckDB."
  },
  {
    "category": "Alpha Generation",
    "feature": "Feature Ladder What-To-Encode",
    "data": "Four targets yielded four different answers. Must beat a best-of-five shuffled copy.",
    "knowledge": "Features that predict volatility (absolute return) do not necessarily predict direction (signed return).",
    "actionType": "LONG",
    "actionTitle": "TARGET ISOLATION",
    "wisdom": "Fit feature ladders independently for direction models vs. volatility models. Do not assume universal feature importance."
  },
  {
    "category": "Market Microstructure",
    "feature": "Tail Clocks",
    "data": "Calendar clock carries most of the fat tail; activity clocks carry far less.",
    "knowledge": "Sampling bars by volume (Activity) rather than time (Calendar) suppresses extreme outlier tails and normalizes distributions.",
    "actionType": "LONG",
    "actionTitle": "USE VOLUME BARS",
    "wisdom": "Whenever possible, train models on Volume/Tick bars instead of Time bars to achieve structural stationarity."
  },
  {
    "category": "Execution Context",
    "feature": "Contract Specifications",
    "data": "Verified tick/point values for 42 futures.",
    "knowledge": "Round-trip execution costs completely destroy marginal statistical edges.",
    "actionType": "SHORT",
    "actionTitle": "ENFORCE COSTS",
    "wisdom": "Subtract exactly 5.56 ticks from all theoretical MNQ yields. Discard any model that relies on edges smaller than 6 ticks."
  },
  {
    "category": "Technical Analysis",
    "feature": "Rolling Linear Regression Slope",
    "data": "A 20-bar rolling slope threshold crossover backtest.",
    "knowledge": "Linear regression slope functions as a lagging trend indicator; auto-adaptive thresholds using standard deviations do not reliably beat buy-and-hold out-of-sample.",
    "actionType": "SHORT",
    "actionTitle": "AVOID STRATEGY",
    "wisdom": "Do not trade raw linear regression slope crossovers. The lag incurred by the N-bar window mathematically guarantees entering late."
  }
];
