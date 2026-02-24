/**
 * Universal Feature & Label Pipeline
 * 
 * Instrument-agnostic feature engineering for the universal trading agent.
 * All features are relative (returns, z-scores, ratios, oscillators) — no absolute prices.
 * Train on MNQ (hardest/noisiest), deploy on anything.
 * 
 * Data source: QuestDB ohlcv via marketQuery() (759M+ OHLCV rows)
 * Features: ~30 instrument-agnostic features computed via SQL window functions
 * Labels: Configurable (direction, triple_barrier) with ATR-scaled thresholds
 * 
 * Feature SQL and normalization logic live in ml/shared/ — this file imports
 * and re-exports them so existing consumers keep working.
 */

import * as tf from '@tensorflow/tfjs-node';
import * as fs from 'fs';
import * as path from 'path';
import { questdbMarketQuery as marketQuery } from '@server/lib/questdbMarketQuery';
import { runQuery } from '@server/duckdb';

// Import shared modules
import {
  buildFeatureSQL as buildFeatureSQLShared,
  type FeatureSQLOptions,
} from '../shared/featureSQL';
import { zScoreNormalize } from '../shared/normalization';

// Re-export shared types/functions so existing consumers don't break
export {
  type UniversalFeatureConfig,
  DEFAULT_FEATURE_CONFIG,
  getFeatureNames,
} from '../shared/featureSQL';
export { type NormalizationStats, zScoreNormalize } from '../shared/normalization';

// Import for local use (after re-exports to avoid conflicts)
import { DEFAULT_FEATURE_CONFIG, getFeatureNames } from '../shared/featureSQL';
import type { UniversalFeatureConfig } from '../shared/featureSQL';

// ============================================================================
// LABEL CONFIGURATION
// ============================================================================

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
// LOCAL HELPERS (thin wrapper around shared buildFeatureSQL)
// ============================================================================

/** Training-mode feature SQL: ASC order, raw ts output */
function buildTrainingFeatureSQL(
  symbol: string,
  timeframeSec: number,
  maxBars: number,
  config: UniversalFeatureConfig,
): string {
  return buildFeatureSQLShared({
    symbol,
    timeframeSec,
    maxBars,
    config,
    orderDesc: false,
    epochMsOutput: false,
  });
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
    const current = bars[i]!.close;
    const future = bars[i + config.horizon]!.close;
    const atr = bars[i]!.atr_val;

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
    const entryPrice = bars[i]!.close;
    const atr = bars[i]!.atr_val;

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
        distribution['tp_hit']!++;
        break;
      } else if (low <= slPrice) {
        result = -1;
        distribution['sl_hit']!++;
        break;
      }
    }

    if (result === 0) distribution['time_exit']!++;

    // 3-class: [up, neutral, down]
    if (result === 1) labels.push([1, 0, 0]);
    else if (result === -1) labels.push([0, 0, 1]);
    else labels.push([0, 1, 0]);
  }

  return { labels, validCount: bars.length - config.maxHoldingPeriod, distribution };
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

  // Try loading pre-computed normalized features from parquet
  const timeframeLabelMap: Record<number, string> = {
    60: '1m', 300: '5m', 900: '15m', 1800: '30m',
    3600: '1h', 14400: '4h', 86400: '1d', 604800: '1w',
  };
  const tfLabel = timeframeLabelMap[cfg.timeframeSec] ?? '';
  const featuresParquet = path.join(process.cwd(), 'data', 'features', tfLabel, symbol, 'normalized.parquet');

  let rows: RawBar[] = [];
  let normalizedFeatures: number[][] = [];
  let usedPrecomputed = false;

  if (tfLabel && fs.existsSync(featuresParquet)) {
    console.log(`[UniversalPipeline] Loading pre-computed normalized features from ${featuresParquet}`);
    try {
      const safePath = featuresParquet.replace(/\\/g, '/');
      // Load normalized parquet + OHLCV for label computation
      const featureRows = await runQuery<Record<string, any>>(
        `SELECT * FROM read_parquet('${safePath}') ORDER BY timestamp LIMIT ${cfg.maxBars}`
      );

      if (featureRows.length >= cfg.sequenceLength + 200) {
        // Also need OHLCV data for label computation — load from QuestDB
        const ohlcvSql = buildTrainingFeatureSQL(symbol, cfg.timeframeSec, cfg.maxBars, cfg.features);
        rows = await marketQuery<RawBar>(ohlcvSql);

        // Extract the feature columns that match our feature names from the parquet
        // For precomputed features, we use ALL available columns as features
        const parquetCols = Object.keys(featureRows[0]!).filter(c => c !== 'timestamp');

        // Map pre-computed columns to feature matrix
        normalizedFeatures = featureRows.map(row => {
          return parquetCols.map(name => {
            const val = Number(row[name]);
            return isFinite(val) ? val : 0;
          });
        });

        // Override feature names with actual parquet columns
        featureNames.length = 0;
        featureNames.push(...parquetCols);
        usedPrecomputed = true;

        console.log(`[UniversalPipeline] Loaded ${featureRows.length} bars with ${parquetCols.length} pre-normalized features`);
      } else {
        console.log(`[UniversalPipeline] Pre-computed features insufficient (${featureRows.length} bars), falling back to SQL`);
      }
    } catch (err: any) {
      console.log(`[UniversalPipeline] Failed to load pre-computed features: ${err.message}, falling back to SQL`);
    }
  }

  if (!usedPrecomputed) {
    // Fallback: Build and execute feature SQL (queries QuestDB ohlcv directly)
    const sql = buildTrainingFeatureSQL(symbol, cfg.timeframeSec, cfg.maxBars, cfg.features);

    console.log(`[UniversalPipeline] Querying ${symbol} from QuestDB ohlcv...`);

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

    // Extract feature matrix (replace NaN/null with 0)
    const rawFeatures: number[][] = rows.map(row => {
      return featureNames.map(name => {
        const val = Number(row[name]);
        return isFinite(val) ? val : 0;
      });
    });

    // Z-score normalize
    ({ normalized: normalizedFeatures } = zScoreNormalize(rawFeatures, featureNames));
  }

  // Extract date range
  const dateRange = {
    start: String(rows![0]?.ts ?? ''),
    end: String(rows![rows!.length - 1]?.ts ?? ''),
  };

  const actualNumFeatures = featureNames.length;

  // Compute labels
  const numClasses = cfg.labels.type === 'direction'
    ? (cfg.labels as DirectionLabelConfig).numClasses
    : 3;

  let labelsResult;
  if (cfg.labels.type === 'direction') {
    labelsResult = computeDirectionLabels(rows!, cfg.labels as DirectionLabelConfig, cfg.features.atrPeriod);
  } else {
    labelsResult = computeTripleBarrierLabels(rows!, cfg.labels as TripleBarrierLabelConfig);
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
  console.log(`[UniversalPipeline] Shape: [${sequences.length}, ${cfg.sequenceLength}, ${actualNumFeatures}]`);

  // Create tensors
  const featuresTensor = tf.tensor3d([...trainX, ...valX]);
  const labelsTensor = tf.tensor2d([...trainY, ...valY]);

  return {
    features: featuresTensor,
    labels: labelsTensor,
    trainSize: trainX.length,
    valSize: valX.length,
    featureNames,
    numFeatures: actualNumFeatures,
    numClasses,
    metadata: {
      symbol,
      timeframeSec: cfg.timeframeSec,
      totalBars: rows!.length,
      dateRange,
      labelDistribution: labelsResult.distribution,
    },
  };
}

export function disposeUniversalData(data: UniversalTrainingData): void {
  data.features.dispose();
  data.labels.dispose();
}
