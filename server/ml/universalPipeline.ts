/**
 * Universal Feature & Label Pipeline
 * 
 * Instrument-agnostic feature engineering for the universal trading agent.
 * All features are relative (returns, z-scores, ratios, oscillators) — no absolute prices.
 * Train on MNQ (hardest/noisiest), deploy on anything.
 * 
 * Data source: DuckDB market.duckdb via marketQuery() (782M+ OHLCV rows)
 * Features: ~30 instrument-agnostic features computed via SQL window functions
 * Labels: Configurable (direction, triple_barrier) with ATR-scaled thresholds
 */

import * as tf from '@tensorflow/tfjs-node';
import { marketQuery } from '../duckdb/market';

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

export type LabelType = 'direction' | 'triple_barrier';

export interface DirectionLabelConfig {
  type: 'direction';
  /** Bars to look ahead for price change */
  horizon: number;
  /** ATR multiplier for up/down threshold (e.g., 1.0 = 1 ATR) */
  atrMultiplier: number;
  /** Number of classes: 2 (up/down) or 3 (up/neutral/down) */
  numClasses: 2 | 3;
}

export interface TripleBarrierLabelConfig {
  type: 'triple_barrier';
  /** Take profit in ATR multiples */
  takeProfitATR: number;
  /** Stop loss in ATR multiples */
  stopLossATR: number;
  /** Maximum bars to hold before time barrier */
  maxHoldingPeriod: number;
}

export type LabelConfig = DirectionLabelConfig | TripleBarrierLabelConfig;

export const DEFAULT_LABEL_CONFIG: DirectionLabelConfig = {
  type: 'direction',
  horizon: 10,
  atrMultiplier: 0.5,
  numClasses: 3,
};

export interface UniversalDataConfig {
  /** Symbol to train on (e.g., 'MNQ', 'ES', 'EURUSD') */
  symbol: string;
  /** Timeframe in seconds for aggregation (60=1m, 300=5m, 3600=1H) */
  timeframeSec: number;
  /** Maximum bars to load from DuckDB */
  maxBars: number;
  /** Sequence length for CNN input */
  sequenceLength: number;
  /** Train/validation split ratio */
  trainSplit: number;
  /** Feature configuration */
  features: UniversalFeatureConfig;
  /** Label configuration */
  labels: LabelConfig;
}

export const DEFAULT_DATA_CONFIG: UniversalDataConfig = {
  symbol: 'MNQ',
  timeframeSec: 300, // 5-minute bars
  maxBars: 100000,
  sequenceLength: 60,
  trainSplit: 0.8,
  features: DEFAULT_FEATURE_CONFIG,
  labels: DEFAULT_LABEL_CONFIG,
};

export interface UniversalTrainingData {
  features: tf.Tensor3D;
  labels: tf.Tensor2D;
  trainSize: number;
  valSize: number;
  featureNames: string[];
  numFeatures: number;
  numClasses: number;
  metadata: {
    symbol: string;
    timeframeSec: number;
    totalBars: number;
    dateRange: { start: string; end: string };
    labelDistribution: Record<string, number>;
  };
}

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
// SQL GENERATION
// ============================================================================

function buildFeatureSQL(
  symbol: string,
  timeframeSec: number,
  maxBars: number,
  config: UniversalFeatureConfig
): string {
  const interval = `${timeframeSec} seconds`;

  // Log return columns
  const logReturnCols = config.returnPeriods.map(p =>
    `LN(close / NULLIF(LAG(close, ${p}) OVER w, 0)) as log_ret_${p}`
  ).join(',\n      ');

  // RSI columns
  const rsiCols = config.rsiPeriods.map(p =>
    `(100.0 - (100.0 / (1.0 + AVG(gain) OVER (ORDER BY ts ROWS BETWEEN ${p - 1} PRECEDING AND CURRENT ROW) /
        NULLIF(AVG(loss) OVER (ORDER BY ts ROWS BETWEEN ${p - 1} PRECEDING AND CURRENT ROW), 0)))) / 100.0 as rsi_${p}`
  ).join(',\n      ');

  // SMA z-score columns
  const smaZCols = config.smaWindows.map(w =>
    `(close - AVG(close) OVER (ORDER BY ts ROWS BETWEEN ${w - 1} PRECEDING AND CURRENT ROW)) /
        NULLIF(STDDEV_POP(close) OVER (ORDER BY ts ROWS BETWEEN ${w - 1} PRECEDING AND CURRENT ROW), 0) as close_vs_sma${w}_z`
  ).join(',\n      ');

  // Time features
  const timeCols = config.includeTimeFeatures ? `
      SIN(2 * PI() * EXTRACT(HOUR FROM ts) / 24.0) as hour_sin,
      COS(2 * PI() * EXTRACT(HOUR FROM ts) / 24.0) as hour_cos,
      SIN(2 * PI() * EXTRACT(DOW FROM ts) / 7.0) as dow_sin,
      COS(2 * PI() * EXTRACT(DOW FROM ts) / 7.0) as dow_cos,` : '';

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
      WHERE symbol = '${symbol}'
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
        (close - MIN(low) OVER (ORDER BY ts ROWS BETWEEN ${config.stochKPeriod - 1} PRECEDING AND CURRENT ROW)) /
          NULLIF(MAX(high) OVER (ORDER BY ts ROWS BETWEEN ${config.stochKPeriod - 1} PRECEDING AND CURRENT ROW) -
                 MIN(low) OVER (ORDER BY ts ROWS BETWEEN ${config.stochKPeriod - 1} PRECEDING AND CURRENT ROW), 0) as stoch_k,
        (MAX(high) OVER (ORDER BY ts ROWS BETWEEN ${config.williamsRPeriod - 1} PRECEDING AND CURRENT ROW) - close) /
          NULLIF(MAX(high) OVER (ORDER BY ts ROWS BETWEEN ${config.williamsRPeriod - 1} PRECEDING AND CURRENT ROW) -
                 MIN(low) OVER (ORDER BY ts ROWS BETWEEN ${config.williamsRPeriod - 1} PRECEDING AND CURRENT ROW), 0) * -1 + 1 as williams_r_raw,
        (close - LAG(close, ${config.rocPeriod}) OVER (ORDER BY ts)) /
          NULLIF(LAG(close, ${config.rocPeriod}) OVER (ORDER BY ts), 0) as roc_${config.rocPeriod},
        (close - (AVG(close) OVER (ORDER BY ts ROWS BETWEEN ${config.bbPeriod - 1} PRECEDING AND CURRENT ROW) -
          2 * STDDEV_POP(close) OVER (ORDER BY ts ROWS BETWEEN ${config.bbPeriod - 1} PRECEDING AND CURRENT ROW))) /
          NULLIF(4 * STDDEV_POP(close) OVER (ORDER BY ts ROWS BETWEEN ${config.bbPeriod - 1} PRECEDING AND CURRENT ROW), 0) as bb_pct_b,
        AVG(true_range) OVER (ORDER BY ts ROWS BETWEEN ${config.atrPeriod - 1} PRECEDING AND CURRENT ROW) as atr_val,
        AVG(true_range) OVER (ORDER BY ts ROWS BETWEEN ${config.atrPeriod - 1} PRECEDING AND CURRENT ROW) /
          NULLIF(AVG(true_range) OVER (ORDER BY ts ROWS BETWEEN ${config.atrLongPeriod - 1} PRECEDING AND CURRENT ROW), 0) as vol_ratio,
        ${smaZCols},
        AVG(close) OVER (ORDER BY ts ROWS BETWEEN ${config.macdFast - 1} PRECEDING AND CURRENT ROW) -
          AVG(close) OVER (ORDER BY ts ROWS BETWEEN ${config.macdSlow - 1} PRECEDING AND CURRENT ROW) as macd_line_raw,
        volume / NULLIF(AVG(volume) OVER (ORDER BY ts ROWS BETWEEN ${config.volumeAvgWindow - 1} PRECEDING AND CURRENT ROW), 0) as rel_volume,
        AVG(volume) OVER (ORDER BY ts ROWS BETWEEN ${config.volumeShortWindow - 1} PRECEDING AND CURRENT ROW) /
          NULLIF(AVG(volume) OVER (ORDER BY ts ROWS BETWEEN ${config.volumeAvgWindow - 1} PRECEDING AND CURRENT ROW), 0) as vol_trend,
        ${timeCols}
        ROW_NUMBER() OVER (ORDER BY ts) as row_num
      FROM returns
    ),

    -- Layer 5: Second-order derived features
    final AS (
      SELECT *,
        AVG(stoch_k) OVER (ORDER BY ts ROWS BETWEEN ${config.stochDPeriod - 1} PRECEDING AND CURRENT ROW) as stoch_d,
        williams_r_raw as williams_r,
        (macd_line_raw - AVG(macd_line_raw) OVER (ORDER BY ts ROWS BETWEEN ${config.macdSignal - 1} PRECEDING AND CURRENT ROW)) /
          NULLIF(atr_val, 0) as macd_hist_norm,
        STDDEV_POP(log_ret_1) OVER (ORDER BY ts ROWS BETWEEN ${config.realizedVolWindow - 1} PRECEDING AND CURRENT ROW) as realized_vol
      FROM indicators
    )

    SELECT
      ts, close, atr_val,
      ${getFeatureNames(config).join(',\n      ')}
    FROM final
    WHERE row_num > ${config.warmupBars}
    ORDER BY ts
    LIMIT ${maxBars}
  `;
}

function buildContinuousContractFeatureSQL(
  rootSymbol: string,
  timeframeSec: number,
  maxBars: number,
  config: UniversalFeatureConfig
): string {
  const interval = `${timeframeSec} seconds`;

  // Same feature SQL but with continuous contract stitching
  // Replace the 'agg' CTE with Panama back-adjusted continuous contract
  const featureSQL = buildFeatureSQL(rootSymbol, timeframeSec, maxBars, config);

  // Replace the agg CTE with continuous contract logic
  const continuousAgg = `
    -- Layer 0: Continuous contract with Panama back-adjustment
    schedule AS (
      SELECT
        to_contract as contract,
        rollover_date as start_date,
        LEAD(rollover_date) OVER (PARTITION BY root ORDER BY rollover_date) as end_date,
        cumulative_adjustment as adj
      FROM rollovers
      WHERE root = '${rootSymbol}'
      UNION ALL
      SELECT
        from_contract as contract,
        DATE '1900-01-01' as start_date,
        rollover_date as end_date,
        cumulative_adjustment + price_gap as adj
      FROM rollovers
      WHERE root = '${rootSymbol}'
        AND rollover_date = (SELECT MIN(rollover_date) FROM rollovers WHERE root = '${rootSymbol}')
    ),
    stitched AS (
      SELECT
        o.ts,
        o.open + s.adj as open,
        o.high + s.adj as high,
        o.low + s.adj as low,
        o.close + s.adj as close,
        o.volume
      FROM ohlcv o
      JOIN schedule s ON o.symbol = s.contract
        AND CAST(o.ts AS DATE) >= s.start_date
        AND (s.end_date IS NULL OR CAST(o.ts AS DATE) < s.end_date)
    ),
    agg AS (
      SELECT
        time_bucket(INTERVAL '${interval}', ts) as ts,
        first(open ORDER BY ts) as open,
        max(high) as high,
        min(low) as low,
        last(close ORDER BY ts) as close,
        CAST(sum(volume) AS DOUBLE) as volume
      FROM stitched
      GROUP BY time_bucket(INTERVAL '${interval}', ts)
      ORDER BY ts
    ),`;

  // Replace everything from WITH to the end of the agg CTE
  return featureSQL.replace(
    /WITH\s*\n\s*-- Layer 1: Aggregate to requested timeframe\s*\n\s*agg AS \([\s\S]*?\),\n\n\s*-- Layer 2/,
    `WITH\n${continuousAgg}\n\n    -- Layer 2`
  );
}

// ============================================================================
// LABEL COMPUTATION (in JavaScript for flexibility)
// ============================================================================

interface RawBar {
  ts: Date | string;
  close: number;
  atr_val: number;
  [key: string]: any;
}

function computeDirectionLabels(
  bars: RawBar[],
  config: DirectionLabelConfig,
  atrPeriod: number
): { labels: number[][]; validCount: number; distribution: Record<string, number> } {
  const labels: number[][] = [];
  const numClasses = config.numClasses;
  const distribution: Record<string, number> = {};

  for (let i = 0; i < bars.length - config.horizon; i++) {
    const current = bars[i].close;
    const future = bars[i + config.horizon].close;
    const atr = bars[i].atr_val;

    if (!atr || atr <= 0 || !current || !future) {
      // Skip bars where ATR isn't available
      labels.push(new Array(numClasses).fill(0));
      continue;
    }

    const change = (future - current) / current;
    const threshold = config.atrMultiplier * (atr / current);

    let label: number[];
    if (numClasses === 3) {
      if (change > threshold) {
        label = [1, 0, 0]; // Up
        distribution['up'] = (distribution['up'] || 0) + 1;
      } else if (change < -threshold) {
        label = [0, 0, 1]; // Down
        distribution['down'] = (distribution['down'] || 0) + 1;
      } else {
        label = [0, 1, 0]; // Neutral
        distribution['neutral'] = (distribution['neutral'] || 0) + 1;
      }
    } else {
      if (change >= 0) {
        label = [1, 0]; // Up
        distribution['up'] = (distribution['up'] || 0) + 1;
      } else {
        label = [0, 1]; // Down
        distribution['down'] = (distribution['down'] || 0) + 1;
      }
    }
    labels.push(label);
  }

  return { labels, validCount: bars.length - config.horizon, distribution };
}

function computeTripleBarrierLabels(
  bars: RawBar[],
  config: TripleBarrierLabelConfig
): { labels: number[][]; validCount: number; distribution: Record<string, number> } {
  const labels: number[][] = [];
  const distribution: Record<string, number> = { tp_hit: 0, sl_hit: 0, time_exit: 0 };

  for (let i = 0; i < bars.length - config.maxHoldingPeriod; i++) {
    const entryPrice = bars[i].close;
    const atr = bars[i].atr_val;

    if (!atr || atr <= 0 || !entryPrice) {
      labels.push([0, 1, 0]); // Default to neutral
      continue;
    }

    const tpPrice = entryPrice + config.takeProfitATR * atr;
    const slPrice = entryPrice - config.stopLossATR * atr;

    let result = 0; // 0 = time exit (neutral)
    for (let j = 1; j <= config.maxHoldingPeriod; j++) {
      const bar = bars[i + j];
      if (!bar) break;

      const high = bar.close + (bar.atr_val || atr) * 0.3; // Estimate high from close+ATR fraction
      const low = bar.close - (bar.atr_val || atr) * 0.3;

      if (high >= tpPrice && low <= slPrice) {
        // Both hit — use close proximity
        result = (bar.close - entryPrice) > 0 ? 1 : -1;
        break;
      } else if (high >= tpPrice) {
        result = 1;
        distribution['tp_hit']++;
        break;
      } else if (low <= slPrice) {
        result = -1;
        distribution['sl_hit']++;
        break;
      }
    }

    if (result === 0) distribution['time_exit']++;

    // 3-class: [up, neutral, down]
    if (result === 1) labels.push([1, 0, 0]);
    else if (result === -1) labels.push([0, 0, 1]);
    else labels.push([0, 1, 0]);
  }

  return { labels, validCount: bars.length - config.maxHoldingPeriod, distribution };
}

// ============================================================================
// NORMALIZATION
// ============================================================================

export interface NormalizationStats {
  means: number[];
  stds: number[];
}

function zScoreNormalize(data: number[][], featureNames: string[]): {
  normalized: number[][];
  stats: NormalizationStats;
} {
  if (data.length === 0) return { normalized: data, stats: { means: [], stds: [] } };

  const numFeatures = data[0].length;
  const means: number[] = new Array(numFeatures).fill(0);
  const stds: number[] = new Array(numFeatures).fill(0);

  // Features that are already bounded [0,1] — skip normalization
  const boundedFeatures = new Set<number>();
  featureNames.forEach((name, idx) => {
    if (
      name.startsWith('rsi_') ||
      name === 'stoch_k' || name === 'stoch_d' ||
      name === 'williams_r' ||
      name === 'bb_pct_b' ||
      name === 'upper_shadow_pct' || name === 'lower_shadow_pct' || name === 'body_pct' ||
      name.endsWith('_sin') || name.endsWith('_cos')
    ) {
      boundedFeatures.add(idx);
    }
  });

  // Compute means
  for (const row of data) {
    for (let j = 0; j < numFeatures; j++) {
      means[j] += row[j];
    }
  }
  for (let j = 0; j < numFeatures; j++) {
    means[j] /= data.length;
  }

  // Compute stds
  for (const row of data) {
    for (let j = 0; j < numFeatures; j++) {
      stds[j] += (row[j] - means[j]) ** 2;
    }
  }
  for (let j = 0; j < numFeatures; j++) {
    stds[j] = Math.sqrt(stds[j] / data.length);
  }

  // Normalize
  const normalized = data.map(row =>
    row.map((val, j) => {
      if (boundedFeatures.has(j)) {
        // Already bounded — just center around 0.5
        return val; // Keep as-is, they're already 0-1
      }
      if (stds[j] < 1e-10) return 0;
      // Clip z-scores to [-5, 5] to prevent extreme values
      const z = (val - means[j]) / stds[j];
      return Math.max(-5, Math.min(5, z));
    })
  );

  return { normalized, stats: { means, stds } };
}

// ============================================================================
// MAIN PIPELINE
// ============================================================================

export async function loadUniversalTrainingData(
  config: Partial<UniversalDataConfig> = {}
): Promise<UniversalTrainingData> {
  const cfg: UniversalDataConfig = {
    ...DEFAULT_DATA_CONFIG,
    ...config,
    features: { ...DEFAULT_FEATURE_CONFIG, ...config.features },
    labels: { ...DEFAULT_LABEL_CONFIG, ...config.labels } as LabelConfig,
  };

  const symbol = cfg.symbol.toUpperCase();
  const featureNames = getFeatureNames(cfg.features);
  const numFeatures = featureNames.length;

  console.log(`[UniversalPipeline] Loading ${symbol} data (${cfg.timeframeSec}s bars, max ${cfg.maxBars})...`);
  console.log(`[UniversalPipeline] Features: ${numFeatures} (${featureNames.slice(0, 5).join(', ')}...)`);
  console.log(`[UniversalPipeline] Labels: ${cfg.labels.type}`);

  // Check if this is a root symbol with rollovers (continuous contract)
  let isContinuous = false;
  try {
    const rolloverCheck = await marketQuery<{ cnt: number }>(`
      SELECT CAST(COUNT(*) AS DOUBLE) as cnt FROM rollovers WHERE root = '${symbol}'
    `);
    isContinuous = rolloverCheck.length > 0 && rolloverCheck[0].cnt > 0;
  } catch {
    // If rollovers table doesn't exist, just use direct symbol
  }

  // Build and execute feature SQL
  const sql = isContinuous
    ? buildContinuousContractFeatureSQL(symbol, cfg.timeframeSec, cfg.maxBars, cfg.features)
    : buildFeatureSQL(symbol, cfg.timeframeSec, cfg.maxBars, cfg.features);

  console.log(`[UniversalPipeline] Querying ${isContinuous ? 'continuous contract' : 'direct symbol'} from market.duckdb...`);

  let rows: RawBar[];
  try {
    rows = await marketQuery<RawBar>(sql);
  } catch (err: any) {
    console.error('[UniversalPipeline] SQL error:', err.message);
    throw new Error(`Failed to load training data for ${symbol}: ${err.message}`);
  }

  if (rows.length < cfg.sequenceLength + 200) {
    throw new Error(
      `Insufficient data for ${symbol}: got ${rows.length} bars, need at least ${cfg.sequenceLength + 200}. ` +
      `Try a smaller timeframe or different symbol.`
    );
  }

  console.log(`[UniversalPipeline] Loaded ${rows.length} bars for ${symbol}`);

  // Extract date range
  const dateRange = {
    start: String(rows[0].ts),
    end: String(rows[rows.length - 1].ts),
  };

  // Extract feature matrix (replace NaN/null with 0)
  const rawFeatures: number[][] = rows.map(row => {
    return featureNames.map(name => {
      const val = Number(row[name]);
      return isFinite(val) ? val : 0;
    });
  });

  // Z-score normalize
  const { normalized: normalizedFeatures } = zScoreNormalize(rawFeatures, featureNames);

  // Compute labels
  const numClasses = cfg.labels.type === 'direction'
    ? (cfg.labels as DirectionLabelConfig).numClasses
    : 3;

  let labelsResult;
  if (cfg.labels.type === 'direction') {
    labelsResult = computeDirectionLabels(rows, cfg.labels as DirectionLabelConfig, cfg.features.atrPeriod);
  } else {
    labelsResult = computeTripleBarrierLabels(rows, cfg.labels as TripleBarrierLabelConfig);
  }

  console.log(`[UniversalPipeline] Label distribution:`, labelsResult.distribution);

  // Compute how many trailing bars the labels consume
  const labelHorizon = cfg.labels.type === 'direction'
    ? (cfg.labels as DirectionLabelConfig).horizon
    : (cfg.labels as TripleBarrierLabelConfig).maxHoldingPeriod;

  // Create sequences
  const sequences: number[][][] = [];
  const sequenceLabels: number[][] = [];
  const maxIdx = normalizedFeatures.length - labelHorizon;

  for (let i = cfg.sequenceLength; i < maxIdx; i++) {
    const seq = normalizedFeatures.slice(i - cfg.sequenceLength, i);
    const label = labelsResult.labels[i];

    // Skip sequences with all-zero labels (invalid)
    if (label && label.some(v => v !== 0)) {
      sequences.push(seq);
      sequenceLabels.push(label);
    }
  }

  if (sequences.length < 100) {
    throw new Error(
      `Only ${sequences.length} valid training sequences created. Need at least 100. ` +
      `Try loading more data or adjusting label parameters.`
    );
  }

  // Train/val split (time-based, no shuffling — we don't want future leakage)
  const splitIdx = Math.floor(sequences.length * cfg.trainSplit);
  const trainX = sequences.slice(0, splitIdx);
  const trainY = sequenceLabels.slice(0, splitIdx);
  const valX = sequences.slice(splitIdx);
  const valY = sequenceLabels.slice(splitIdx);

  console.log(`[UniversalPipeline] Created ${sequences.length} sequences (${trainX.length} train, ${valX.length} val)`);
  console.log(`[UniversalPipeline] Shape: [${sequences.length}, ${cfg.sequenceLength}, ${numFeatures}]`);

  // Create tensors
  const featuresTensor = tf.tensor3d([...trainX, ...valX]);
  const labelsTensor = tf.tensor2d([...trainY, ...valY]);

  return {
    features: featuresTensor,
    labels: labelsTensor,
    trainSize: trainX.length,
    valSize: valX.length,
    featureNames,
    numFeatures,
    numClasses,
    metadata: {
      symbol,
      timeframeSec: cfg.timeframeSec,
      totalBars: rows.length,
      dateRange,
      labelDistribution: labelsResult.distribution,
    },
  };
}

export function disposeUniversalData(data: UniversalTrainingData): void {
  data.features.dispose();
  data.labels.dispose();
}
