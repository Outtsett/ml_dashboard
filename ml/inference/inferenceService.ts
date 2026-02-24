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
import { questdbMarketQuery as marketQuery } from '@server/lib/questdbMarketQuery';
import {
  getFeatureNames,
  DEFAULT_FEATURE_CONFIG,
  DEFAULT_DATA_CONFIG,
  type UniversalFeatureConfig,
  type UniversalDataConfig,
} from '@ml/cnn/universalPipeline';
import { buildFeatureSQL } from '@ml/shared/featureSQL';
import { normalizeFeatures, type NormalizationStats } from '@ml/shared/normalization';

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

  const sql = buildFeatureSQL({
    symbol: config.symbol,
    timeframeSec,
    maxBars,
    config: featureConfig,
    orderDesc: true,
    epochMsOutput: true,
  });

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
  const probabilities = (await output.array() as number[][])[0]!;

  // Cleanup
  inputTensor.dispose();
  output.dispose();

  const maxIdx = probabilities.indexOf(Math.max(...probabilities));
  const directions: Array<'up' | 'neutral' | 'down'> = ['up', 'neutral', 'down'];

  const lastRow = rows[rows.length - 1]!;

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
      prediction.featureSnapshot![name] = normalized[normalized.length - 1]![idx]!;
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

  // Build feature SQL with ASC order and epoch_ms output for batch prediction
  const sql = buildFeatureSQL({
    symbol: config.symbol,
    timeframeSec,
    maxBars: maxBars + featureConfig.warmupBars,
    config: featureConfig,
    endTimestamp: config.endTimestamp,
    orderDesc: false,  // Batch wants ASC for chronological processing
    epochMsOutput: true,
  });

  const rows = await marketQuery<any>(sql);

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
        const probs = allProbs[b]!;
        const maxIdx = probs.indexOf(Math.max(...probs));
        const rowIdx = batchIndices[b]!;

        const pred: Prediction = {
          timestamp: Number(rows[rowIdx]!.ts),
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
            pred.featureSnapshot![name] = normalized[rowIdx!]![idx]!;
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
      start: predictions.length > 0 ? predictions[0]!.timestamp : 0,
      end: predictions.length > 0 ? predictions[predictions.length - 1]!.timestamp : 0,
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
