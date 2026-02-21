/**
 * Inference Service — the "prediction brain" of the trading agent.
 *
 * Think of it as: You trained a pilot (model). This service is the cockpit —
 * it loads the pilot from storage, feeds them live instrument readings (features),
 * and translates their decisions into actionable signals.
 *
 * Flow:
 * 1. Load a saved model from disk (weights + training-config.json)
 * 2. Fetch latest bars from DuckDB for the target symbol
 * 3. Compute 31 instrument-agnostic features (same pipeline as training)
 * 4. Run model.predict() → [P(up), P(neutral), P(down)]
 * 5. Return structured predictions with confidence + metadata
 *
 * Key design decisions:
 * - Models are cached in memory after first load (LRU eviction)
 * - Feature computation reuses the universal pipeline SQL
 * - Normalization stats from training are applied to inference data
 * - Supports batch prediction over a time range for backtesting
 */

import * as tf from '@tensorflow/tfjs-node';
import * as fs from 'fs';
import * as path from 'path';
import { marketQuery } from '../duckdb/market';
import {
  getFeatureNames,
  DEFAULT_FEATURE_CONFIG,
  DEFAULT_DATA_CONFIG,
  type UniversalFeatureConfig,
  type UniversalDataConfig,
  type NormalizationStats,
} from './universalPipeline';

const MODELS_DIR = path.join(process.cwd(), 'data', 'models');

// ============================================================
// TYPES
// ============================================================

export interface LoadedModel {
  model: tf.LayersModel;
  config: ModelConfig;
  loadedAt: number;
  lastUsedAt: number;
}

export interface ModelConfig {
  symbol: string;
  featureNames: string[];
  numFeatures: number;
  numClasses: number;
  universalConfig?: Partial<UniversalDataConfig>;
  cnnConfig?: any;
  metadata?: {
    totalBars: number;
    dateRange: { start: string; end: string };
    trainingTime: number;
    labelDistribution?: Record<string, number>;
  };
  normalization?: NormalizationStats;
}

export interface Prediction {
  timestamp: number;      // epoch ms
  symbol: string;
  prediction: number;     // 0=up, 1=neutral, 2=down (matches training labels)
  direction: 'up' | 'neutral' | 'down';
  confidence: number;     // max probability 0-1
  probabilities: number[];  // [P(up), P(neutral), P(down)]
  modelName: string;
  featureSnapshot?: Record<string, number>;  // optional: last bar's feature values
}

export interface BatchPredictionResult {
  predictions: Prediction[];
  modelName: string;
  symbol: string;
  barsProcessed: number;
  timeRange: { start: number; end: number };
  computeTimeMs: number;
}

export interface InferenceConfig {
  /** Model directory name (e.g., 'CNN-MNQ-train_1234567890') */
  modelName: string;
  /** Symbol to predict on (can differ from training symbol for cross-instrument inference) */
  symbol: string;
  /** Timeframe in seconds (default: from training config) */
  timeframeSec?: number;
  /** How many bars to load for single prediction (sequence_length + warmup) */
  contextBars?: number;
  /** Include feature snapshots in predictions (for XAI / debugging) */
  includeFeatures?: boolean;
}

export interface BatchInferenceConfig extends InferenceConfig {
  /** Start timestamp for batch prediction (epoch ms) */
  startTimestamp?: number;
  /** End timestamp for batch prediction (epoch ms) */
  endTimestamp?: number;
  /** Max bars to process */
  maxBars?: number;
  /** Step size (predict every N bars, default 1) */
  stepSize?: number;
}

// ============================================================
// MODEL CACHE
// ============================================================

const MAX_CACHED_MODELS = 5;
const modelCache = new Map<string, LoadedModel>();

function evictOldestModel(): void {
  if (modelCache.size < MAX_CACHED_MODELS) return;
  let oldestKey = '';
  let oldestTime = Infinity;
  modelCache.forEach((val, key) => {
    if (val.lastUsedAt < oldestTime) {
      oldestTime = val.lastUsedAt;
      oldestKey = key;
    }
  });
  if (oldestKey) {
    const entry = modelCache.get(oldestKey);
    if (entry) {
      entry.model.dispose();
      modelCache.delete(oldestKey);
      console.log(`[Inference] Evicted cached model: ${oldestKey}`);
    }
  }
}

// ============================================================
// MODEL LOADING
// ============================================================

async function loadModelFromDisk(modelName: string): Promise<LoadedModel> {
  // Check cache first
  const cached = modelCache.get(modelName);
  if (cached) {
    cached.lastUsedAt = Date.now();
    console.log(`[Inference] Using cached model: ${modelName}`);
    return cached;
  }

  const modelDir = path.join(MODELS_DIR, modelName);
  const modelJsonPath = path.join(modelDir, 'model.json');
  const configPath = path.join(modelDir, 'training-config.json');

  if (!fs.existsSync(modelJsonPath)) {
    throw new Error(`Model not found at ${modelDir}. Available models: ${listAvailableModels().map(m => m.name).join(', ')}`);
  }

  console.log(`[Inference] Loading model from disk: ${modelName}...`);
  const model = await tf.loadLayersModel(`file://${modelJsonPath}`);

  let config: ModelConfig = {
    symbol: 'unknown',
    featureNames: getFeatureNames(),
    numFeatures: getFeatureNames().length,
    numClasses: 3,
  };

  if (fs.existsSync(configPath)) {
    const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config = {
      symbol: rawConfig.symbol || 'unknown',
      featureNames: rawConfig.featureNames || getFeatureNames(),
      numFeatures: rawConfig.numFeatures || getFeatureNames().length,
      numClasses: rawConfig.numClasses || 3,
      universalConfig: rawConfig.universalConfig,
      cnnConfig: rawConfig.cnnConfig,
      metadata: rawConfig.metadata,
      normalization: rawConfig.normalization,
    };
  }

  // Evict oldest if at capacity
  evictOldestModel();

  const entry: LoadedModel = {
    model,
    config,
    loadedAt: Date.now(),
    lastUsedAt: Date.now(),
  };

  modelCache.set(modelName, entry);
  console.log(`[Inference] Model loaded and cached: ${modelName} (${config.numFeatures} features, ${config.numClasses} classes)`);

  return entry;
}

// ============================================================
// FEATURE COMPUTATION FOR INFERENCE
// ============================================================

/**
 * Build the same feature SQL as training, but for a specific time range.
 * Think of it as: same recipe, different ingredients (different time window).
 */
function buildInferenceFeatureSQL(
  symbol: string,
  timeframeSec: number,
  featureConfig: UniversalFeatureConfig,
  maxBars: number,
  endTimestamp?: number,
): string {
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

  const endFilter = endTimestamp
    ? `AND ts <= epoch_ms(${endTimestamp}::BIGINT)`
    : '';

  return `
    WITH
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
      epoch_ms(ts)::DOUBLE as ts,
      close, atr_val,
      ${getFeatureNames(featureConfig).join(',\n      ')}
    FROM final
    WHERE row_num > ${featureConfig.warmupBars}
    ORDER BY ts DESC
    LIMIT ${maxBars}
  `;
}

// ============================================================
// NORMALIZATION (matches training pipeline)
// ============================================================

function normalizeFeatures(
  data: number[][],
  featureNames: string[],
  stats?: NormalizationStats,
): number[][] {
  if (data.length === 0) return data;
  const numFeatures = data[0].length;

  // Features already bounded [0,1] — don't z-score these
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

  if (stats) {
    // Use training stats for normalization (ensures consistency)
    return data.map(row =>
      row.map((val, j) => {
        if (boundedFeatures.has(j)) return val;
        if (!stats.stds[j] || stats.stds[j] < 1e-10) return 0;
        const z = (val - stats.means[j]) / stats.stds[j];
        return Math.max(-5, Math.min(5, z));
      })
    );
  }

  // No training stats — compute local stats (less ideal but still works)
  const means = new Array(numFeatures).fill(0);
  const stds = new Array(numFeatures).fill(0);

  for (const row of data) {
    for (let j = 0; j < numFeatures; j++) means[j] += row[j];
  }
  for (let j = 0; j < numFeatures; j++) means[j] /= data.length;

  for (const row of data) {
    for (let j = 0; j < numFeatures; j++) stds[j] += (row[j] - means[j]) ** 2;
  }
  for (let j = 0; j < numFeatures; j++) stds[j] = Math.sqrt(stds[j] / data.length);

  return data.map(row =>
    row.map((val, j) => {
      if (boundedFeatures.has(j)) return val;
      if (stds[j] < 1e-10) return 0;
      const z = (val - means[j]) / stds[j];
      return Math.max(-5, Math.min(5, z));
    })
  );
}

// ============================================================
// SINGLE PREDICTION
// ============================================================

/**
 * Generate a single prediction on the latest available bars.
 * Think of it as: "What does the model think about right now?"
 */
export async function predictLatest(config: InferenceConfig): Promise<Prediction> {
  const loaded = await loadModelFromDisk(config.modelName);
  const { model, config: modelConfig } = loaded;

  const sequenceLength = modelConfig.universalConfig?.sequenceLength || DEFAULT_DATA_CONFIG.sequenceLength;
  const timeframeSec = config.timeframeSec || modelConfig.universalConfig?.timeframeSec || DEFAULT_DATA_CONFIG.timeframeSec;
  const featureConfig = modelConfig.universalConfig?.features
    ? { ...DEFAULT_FEATURE_CONFIG, ...modelConfig.universalConfig.features }
    : DEFAULT_FEATURE_CONFIG;

  // Load enough bars for one prediction (sequence + warmup)
  const maxBars = (config.contextBars || sequenceLength) + featureConfig.warmupBars + 10;

  const sql = buildInferenceFeatureSQL(
    config.symbol,
    timeframeSec,
    featureConfig,
    maxBars,
  );

  const rows = await marketQuery<any>(sql);

  if (rows.length < sequenceLength) {
    throw new Error(`Insufficient data: got ${rows.length} bars, need ${sequenceLength}. Check symbol/timeframe.`);
  }

  // Reverse because SQL returns DESC order for getting the latest bars
  rows.reverse();

  // Extract features
  const featureNames = modelConfig.featureNames || getFeatureNames(featureConfig);
  const rawFeatures = rows.map(row =>
    featureNames.map(name => {
      const val = Number(row[name]);
      return isFinite(val) ? val : 0;
    })
  );

  // Normalize
  const normalized = normalizeFeatures(rawFeatures, featureNames, modelConfig.normalization);

  // Take the last sequenceLength bars as input
  const inputWindow = normalized.slice(-sequenceLength);
  const inputTensor = tf.tensor3d([inputWindow]); // [1, seqLen, features]

  // Predict
  const output = model.predict(inputTensor) as tf.Tensor;
  const probabilities = (await output.array() as number[][])[0];

  // Cleanup
  inputTensor.dispose();
  output.dispose();

  const maxIdx = probabilities.indexOf(Math.max(...probabilities));
  const directions: Array<'up' | 'neutral' | 'down'> = ['up', 'neutral', 'down'];

  const lastRow = rows[rows.length - 1];

  const prediction: Prediction = {
    timestamp: Number(lastRow.ts),
    symbol: config.symbol,
    prediction: maxIdx,
    direction: directions[maxIdx] || 'neutral',
    confidence: Math.max(...probabilities),
    probabilities,
    modelName: config.modelName,
  };

  // Optionally include feature snapshot for debugging/XAI
  if (config.includeFeatures) {
    prediction.featureSnapshot = {};
    featureNames.forEach((name, idx) => {
      prediction.featureSnapshot![name] = normalized[normalized.length - 1][idx];
    });
  }

  return prediction;
}

// ============================================================
// BATCH PREDICTION
// ============================================================

/**
 * Generate predictions over a time range — used for backtesting signals.
 * Think of it as: "Replay the model's decisions bar-by-bar over history"
 */
export async function predictBatch(config: BatchInferenceConfig): Promise<BatchPredictionResult> {
  const startTime = Date.now();
  const loaded = await loadModelFromDisk(config.modelName);
  const { model, config: modelConfig } = loaded;

  const sequenceLength = modelConfig.universalConfig?.sequenceLength || DEFAULT_DATA_CONFIG.sequenceLength;
  const timeframeSec = config.timeframeSec || modelConfig.universalConfig?.timeframeSec || DEFAULT_DATA_CONFIG.timeframeSec;
  const featureConfig = modelConfig.universalConfig?.features
    ? { ...DEFAULT_FEATURE_CONFIG, ...modelConfig.universalConfig.features }
    : DEFAULT_FEATURE_CONFIG;

  const maxBars = config.maxBars || 50000;
  const stepSize = config.stepSize || 1;

  // Load all bars for the range
  const interval = `${timeframeSec} seconds`;
  let whereClause = `WHERE symbol = '${config.symbol}'`;
  if (config.startTimestamp) whereClause += ` AND ts >= epoch_ms(${config.startTimestamp}::BIGINT)`;
  if (config.endTimestamp) whereClause += ` AND ts <= epoch_ms(${config.endTimestamp}::BIGINT)`;

  const sql = buildInferenceFeatureSQL(
    config.symbol,
    timeframeSec,
    featureConfig,
    maxBars + featureConfig.warmupBars,
    config.endTimestamp,
  );

  // For batch, we want ascending order — rebuild the query as ASC
  const ascSql = sql.replace('ORDER BY ts DESC', 'ORDER BY ts ASC');

  const rows = await marketQuery<any>(ascSql);

  if (rows.length < sequenceLength + 1) {
    throw new Error(`Insufficient data for batch prediction: got ${rows.length} bars, need at least ${sequenceLength + 1}`);
  }

  // Extract features + normalize
  const featureNames = modelConfig.featureNames || getFeatureNames(featureConfig);
  const rawFeatures = rows.map(row =>
    featureNames.map(name => {
      const val = Number(row[name]);
      return isFinite(val) ? val : 0;
    })
  );

  const normalized = normalizeFeatures(rawFeatures, featureNames, modelConfig.normalization);

  // Apply start filter after normalization (we need full context for proper normalization)
  let startIdx = sequenceLength;
  if (config.startTimestamp) {
    for (let i = sequenceLength; i < rows.length; i++) {
      if (Number(rows[i].ts) >= config.startTimestamp) {
        startIdx = i;
        break;
      }
    }
  }

  // Predict in mini-batches for efficiency
  const predictions: Prediction[] = [];
  const directions: Array<'up' | 'neutral' | 'down'> = ['up', 'neutral', 'down'];
  const BATCH_SIZE = 64;

  let batchInputs: number[][][] = [];
  let batchIndices: number[] = [];

  for (let i = startIdx; i < normalized.length; i += stepSize) {
    const window = normalized.slice(i - sequenceLength, i);
    if (window.length < sequenceLength) continue;

    batchInputs.push(window);
    batchIndices.push(i);

    if (batchInputs.length >= BATCH_SIZE || i + stepSize >= normalized.length) {
      // Process batch
      const inputTensor = tf.tensor3d(batchInputs);
      const output = model.predict(inputTensor) as tf.Tensor;
      const allProbs = await output.array() as number[][];

      inputTensor.dispose();
      output.dispose();

      for (let b = 0; b < allProbs.length; b++) {
        const probs = allProbs[b];
        const maxIdx = probs.indexOf(Math.max(...probs));
        const rowIdx = batchIndices[b];

        const pred: Prediction = {
          timestamp: Number(rows[rowIdx].ts),
          symbol: config.symbol,
          prediction: maxIdx,
          direction: directions[maxIdx] || 'neutral',
          confidence: Math.max(...probs),
          probabilities: probs,
          modelName: config.modelName,
        };

        if (config.includeFeatures) {
          pred.featureSnapshot = {};
          featureNames.forEach((name, idx) => {
            pred.featureSnapshot![name] = normalized[rowIdx][idx];
          });
        }

        predictions.push(pred);
      }

      batchInputs = [];
      batchIndices = [];
    }
  }

  const computeTimeMs = Date.now() - startTime;
  console.log(`[Inference] Batch prediction: ${predictions.length} predictions in ${computeTimeMs}ms for ${config.symbol}`);

  return {
    predictions,
    modelName: config.modelName,
    symbol: config.symbol,
    barsProcessed: rows.length,
    timeRange: {
      start: predictions.length > 0 ? predictions[0].timestamp : 0,
      end: predictions.length > 0 ? predictions[predictions.length - 1].timestamp : 0,
    },
    computeTimeMs,
  };
}

// ============================================================
// MODEL MANAGEMENT
// ============================================================

export function listAvailableModels(): Array<{
  name: string;
  path: string;
  config: ModelConfig | null;
  cached: boolean;
}> {
  if (!fs.existsSync(MODELS_DIR)) return [];

  return fs.readdirSync(MODELS_DIR)
    .filter(d => fs.existsSync(path.join(MODELS_DIR, d, 'model.json')))
    .map(d => {
      const modelPath = path.join(MODELS_DIR, d);
      let config: ModelConfig | null = null;
      try {
        const configPath = path.join(modelPath, 'training-config.json');
        if (fs.existsSync(configPath)) {
          const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          config = {
            symbol: raw.symbol,
            featureNames: raw.featureNames,
            numFeatures: raw.numFeatures,
            numClasses: raw.numClasses,
            metadata: raw.metadata,
          };
        }
      } catch { /* ignore */ }

      return {
        name: d,
        path: modelPath,
        config,
        cached: modelCache.has(d),
      };
    });
}

export function getLoadedModels(): string[] {
  return Array.from(modelCache.keys());
}

export function unloadModel(modelName: string): boolean {
  const entry = modelCache.get(modelName);
  if (entry) {
    entry.model.dispose();
    modelCache.delete(modelName);
    console.log(`[Inference] Unloaded model: ${modelName}`);
    return true;
  }
  return false;
}

export function unloadAllModels(): void {
  modelCache.forEach((entry, name) => {
    entry.model.dispose();
    console.log(`[Inference] Unloaded model: ${name}`);
  });
  modelCache.clear();
}
