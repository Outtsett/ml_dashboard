/**
 * Unified Feature SQL Builder
 *
 * Shared SQL generation for instrument-agnostic feature engineering.
 * Used by both training (universalPipeline) and inference (inferenceService).
 *
 * Think of it as: The master recipe that both the training kitchen and
 * the live-trading kitchen follow — same ingredients, same steps,
 * just different portions and plating.
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface UniversalFeatureConfig {
  /** Return periods to compute log returns for */
  returnPeriods: number[];
  /** RSI periods */
  rsiPeriods: number[];
  /** Stochastic K period */
  stochKPeriod: number;
  /** Stochastic D smoothing period */
  stochDPeriod: number;
  /** Williams %R period */
  williamsRPeriod: number;
  /** ROC period */
  rocPeriod: number;
  /** Bollinger Band period */
  bbPeriod: number;
  /** ATR period */
  atrPeriod: number;
  /** Long-term ATR for volatility ratio */
  atrLongPeriod: number;
  /** Realized volatility window */
  realizedVolWindow: number;
  /** SMA windows for price position z-scores */
  smaWindows: number[];
  /** Volume SMA window for relative volume */
  volumeAvgWindow: number;
  /** Short volume SMA for trend */
  volumeShortWindow: number;
  /** Include time-of-day cyclical features */
  includeTimeFeatures: boolean;
  /** MACD fast/slow periods */
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  /** Warmup bars to skip (max of all lookback windows) */
  warmupBars: number;
}

export const DEFAULT_FEATURE_CONFIG: UniversalFeatureConfig = {
  returnPeriods: [1, 2, 3, 5, 10, 20],
  rsiPeriods: [14, 7],
  stochKPeriod: 14,
  stochDPeriod: 3,
  williamsRPeriod: 14,
  rocPeriod: 10,
  bbPeriod: 20,
  atrPeriod: 14,
  atrLongPeriod: 50,
  realizedVolWindow: 20,
  smaWindows: [5, 10, 20, 50],
  volumeAvgWindow: 20,
  volumeShortWindow: 5,
  includeTimeFeatures: true,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  warmupBars: 60,
};

// ============================================================================
// FEATURE NAME GENERATION
// ============================================================================

export function getFeatureNames(config: UniversalFeatureConfig = DEFAULT_FEATURE_CONFIG): string[] {
  const names: string[] = [];

  // Log returns
  for (const p of config.returnPeriods) {
    names.push(`log_ret_${p}`);
  }

  // Candle structure
  names.push('intrabar_ret', 'bar_range_pct', 'upper_shadow_pct', 'lower_shadow_pct', 'body_pct');

  // RSI (normalized to 0-1)
  for (const p of config.rsiPeriods) {
    names.push(`rsi_${p}`);
  }

  // Stochastic %K, %D (normalized to 0-1)
  names.push('stoch_k', 'stoch_d');

  // Williams %R (normalized to 0-1)
  names.push('williams_r');

  // ROC
  names.push(`roc_${config.rocPeriod}`);

  // Bollinger %B
  names.push('bb_pct_b');

  // Volatility
  names.push('vol_ratio', 'realized_vol');

  // SMA z-scores
  for (const w of config.smaWindows) {
    names.push(`close_vs_sma${w}_z`);
  }

  // MACD histogram (ATR-normalized)
  names.push('macd_hist_norm');

  // Volume
  names.push('rel_volume', 'vol_trend');

  // Time features
  if (config.includeTimeFeatures) {
    names.push('hour_sin', 'hour_cos', 'dow_sin', 'dow_cos');
  }

  return names;
}

// ============================================================================
// SQL OPTIONS
// ============================================================================

export interface FeatureSQLOptions {
  /** Trading symbol (e.g., 'MNQ', 'ES', 'EURUSD') */
  symbol: string;
  /** Timeframe in seconds for aggregation (60=1m, 300=5m, 3600=1H) */
  timeframeSec: number;
  /** Maximum bars to return */
  maxBars: number;
  /** Feature configuration (defaults to DEFAULT_FEATURE_CONFIG) */
  config?: UniversalFeatureConfig;
  /** Optional: filter ts <= this epoch ms value (inference uses this for point-in-time queries) */
  endTimestamp?: number;
  /** true = ORDER BY ts DESC (inference wants latest bars first), false = ASC (training) */
  orderDesc?: boolean;
  /** true = epoch_ms(ts)::DOUBLE as ts (inference needs epoch ms), false = raw ts */
  epochMsOutput?: boolean;
}

// ============================================================================
// SQL GENERATION
// ============================================================================

/**
 * Build the universal feature SQL CTE structure.
 *
 * This single function replaces the duplicated buildFeatureSQL() in universalPipeline
 * and buildInferenceFeatureSQL() in inferenceService. The only differences between
 * training and inference are controlled by optional parameters:
 * - endTimestamp: adds a WHERE ts <= filter for point-in-time inference
 * - orderDesc: DESC for inference (latest bars first), ASC for training
 * - epochMsOutput: inference needs epoch_ms(ts)::DOUBLE, training uses raw ts
 */
export function buildFeatureSQL(options: FeatureSQLOptions): string {
  const {
    symbol,
    timeframeSec,
    maxBars,
    config: featureConfig = DEFAULT_FEATURE_CONFIG,
    endTimestamp,
    orderDesc = false,
    epochMsOutput = false,
  } = options;

  const interval = `${timeframeSec} seconds`;

  // Log return columns
  const logReturnCols = featureConfig.returnPeriods.map(p =>
    `LN(close / NULLIF(LAG(close, ${p}) OVER w, 0)) as log_ret_${p}`
  ).join(',\n      ');

  // RSI columns
  const rsiCols = featureConfig.rsiPeriods.map(p =>
    `(100.0 - (100.0 / (1.0 + AVG(gain) OVER (ORDER BY ts ROWS BETWEEN ${p - 1} PRECEDING AND CURRENT ROW) /
        NULLIF(AVG(loss) OVER (ORDER BY ts ROWS BETWEEN ${p - 1} PRECEDING AND CURRENT ROW), 0)))) / 100.0 as rsi_${p}`
  ).join(',\n      ');

  // SMA z-score columns
  const smaZCols = featureConfig.smaWindows.map(w =>
    `(close - AVG(close) OVER (ORDER BY ts ROWS BETWEEN ${w - 1} PRECEDING AND CURRENT ROW)) /
        NULLIF(STDDEV_POP(close) OVER (ORDER BY ts ROWS BETWEEN ${w - 1} PRECEDING AND CURRENT ROW), 0) as close_vs_sma${w}_z`
  ).join(',\n      ');

  // Time features
  const timeCols = featureConfig.includeTimeFeatures ? `
      SIN(2 * PI() * EXTRACT(HOUR FROM ts) / 24.0) as hour_sin,
      COS(2 * PI() * EXTRACT(HOUR FROM ts) / 24.0) as hour_cos,
      SIN(2 * PI() * EXTRACT(DOW FROM ts) / 7.0) as dow_sin,
      COS(2 * PI() * EXTRACT(DOW FROM ts) / 7.0) as dow_cos,` : '';

  // Optional end-timestamp filter for inference
  const endFilter = endTimestamp
    ? `AND ts <= epoch_ms(${endTimestamp}::BIGINT)`
    : '';

  // Output ts format
  const tsSelect = epochMsOutput ? 'epoch_ms(ts)::DOUBLE as ts' : 'ts';

  // Sort order
  const orderDirection = orderDesc ? 'DESC' : 'ASC';

  return `
    WITH
    -- Layer 1: Aggregate to requested timeframe
    agg AS (
      SELECT
        time_bucket(INTERVAL '${interval}', ts) as ts,
        first(open ORDER BY ts) as open,
        max(high) as high,
        min(low) as low,
        last(close ORDER BY ts) as close,
        CAST(sum(volume) AS DOUBLE) as volume
      FROM ohlcv
      WHERE symbol = '${symbol}' ${endFilter}
      GROUP BY time_bucket(INTERVAL '${interval}', ts)
      ORDER BY ts
    ),

    -- Layer 2: Base derived columns
    base AS (
      SELECT
        ts, open, high, low, close, volume,
        GREATEST(
          high - low,
          ABS(high - LAG(close, 1) OVER w),
          ABS(low - LAG(close, 1) OVER w)
        ) as true_range,
        CASE WHEN close > LAG(close, 1) OVER w
          THEN close - LAG(close, 1) OVER w ELSE 0 END as gain,
        CASE WHEN close < LAG(close, 1) OVER w
          THEN LAG(close, 1) OVER w - close ELSE 0 END as loss
      FROM agg
      WINDOW w AS (ORDER BY ts)
    ),

    -- Layer 3: Returns + candle structure
    returns AS (
      SELECT *,
        ${logReturnCols},
        (close - open) / NULLIF(open, 0) as intrabar_ret,
        (high - low) / NULLIF(low, 0) as bar_range_pct,
        CASE WHEN high > low THEN (high - GREATEST(open, close)) / (high - low) ELSE 0 END as upper_shadow_pct,
        CASE WHEN high > low THEN (LEAST(open, close) - low) / (high - low) ELSE 0 END as lower_shadow_pct,
        CASE WHEN high > low THEN ABS(close - open) / (high - low) ELSE 0 END as body_pct
      FROM base
      WINDOW w AS (ORDER BY ts)
    ),

    -- Layer 4: Indicators
    indicators AS (
      SELECT *,
        ${rsiCols},
        (close - MIN(low) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.stochKPeriod - 1} PRECEDING AND CURRENT ROW)) /
          NULLIF(MAX(high) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.stochKPeriod - 1} PRECEDING AND CURRENT ROW) -
                 MIN(low) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.stochKPeriod - 1} PRECEDING AND CURRENT ROW), 0) as stoch_k,
        (MAX(high) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.williamsRPeriod - 1} PRECEDING AND CURRENT ROW) - close) /
          NULLIF(MAX(high) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.williamsRPeriod - 1} PRECEDING AND CURRENT ROW) -
                 MIN(low) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.williamsRPeriod - 1} PRECEDING AND CURRENT ROW), 0) * -1 + 1 as williams_r_raw,
        (close - LAG(close, ${featureConfig.rocPeriod}) OVER (ORDER BY ts)) /
          NULLIF(LAG(close, ${featureConfig.rocPeriod}) OVER (ORDER BY ts), 0) as roc_${featureConfig.rocPeriod},
        (close - (AVG(close) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.bbPeriod - 1} PRECEDING AND CURRENT ROW) -
          2 * STDDEV_POP(close) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.bbPeriod - 1} PRECEDING AND CURRENT ROW))) /
          NULLIF(4 * STDDEV_POP(close) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.bbPeriod - 1} PRECEDING AND CURRENT ROW), 0) as bb_pct_b,
        AVG(true_range) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.atrPeriod - 1} PRECEDING AND CURRENT ROW) as atr_val,
        AVG(true_range) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.atrPeriod - 1} PRECEDING AND CURRENT ROW) /
          NULLIF(AVG(true_range) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.atrLongPeriod - 1} PRECEDING AND CURRENT ROW), 0) as vol_ratio,
        ${smaZCols},
        AVG(close) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.macdFast - 1} PRECEDING AND CURRENT ROW) -
          AVG(close) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.macdSlow - 1} PRECEDING AND CURRENT ROW) as macd_line_raw,
        volume / NULLIF(AVG(volume) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.volumeAvgWindow - 1} PRECEDING AND CURRENT ROW), 0) as rel_volume,
        AVG(volume) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.volumeShortWindow - 1} PRECEDING AND CURRENT ROW) /
          NULLIF(AVG(volume) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.volumeAvgWindow - 1} PRECEDING AND CURRENT ROW), 0) as vol_trend,
        ${timeCols}
        ROW_NUMBER() OVER (ORDER BY ts) as row_num
      FROM returns
    ),

    -- Layer 5: Second-order derived features
    final AS (
      SELECT *,
        AVG(stoch_k) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.stochDPeriod - 1} PRECEDING AND CURRENT ROW) as stoch_d,
        williams_r_raw as williams_r,
        (macd_line_raw - AVG(macd_line_raw) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.macdSignal - 1} PRECEDING AND CURRENT ROW)) /
          NULLIF(atr_val, 0) as macd_hist_norm,
        STDDEV_POP(log_ret_1) OVER (ORDER BY ts ROWS BETWEEN ${featureConfig.realizedVolWindow - 1} PRECEDING AND CURRENT ROW) as realized_vol
      FROM indicators
    )

    SELECT
      ${tsSelect}, close, atr_val,
      ${getFeatureNames(featureConfig).join(',\n      ')}
    FROM final
    WHERE row_num > ${featureConfig.warmupBars}
    ORDER BY ts ${orderDirection}
    LIMIT ${maxBars}
  `;
}
