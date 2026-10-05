/**
 * Model Inference Service — bridges trained ML models to backtest signal generation.
 *
 * Loads TF.js models, computes features from OHLCV bars, runs batch inference.
 * Falls back to momentum signals when no model is available.
 */

import * as tf from '@tensorflow/tfjs-node';
import { storage } from '../../storage';
import type { Signal, OHLCVBar } from './tradeSimulator';
import {
  INDICATOR_DEFAULTS,
  type IndicatorStrategyPreset,
} from '@shared/strategyTypes';
import { logInfo } from "../log";

// ─── Model Cache ────────────────────────────────────────────────────────────

const modelCache = new Map<number, tf.LayersModel>();

/** Dispose all cached models and clear the cache. */
export function clearModelCache(): void {
  for (const [id, model] of modelCache) {
    model.dispose();
    logInfo(`[ModelInference] Disposed cached model ${id}`);
  }
  modelCache.clear();
}

/**
 * Load a TF.js model by ID, using the module-level cache.
 * Follows the same file:// convention as xaiServiceCore.
 */
async function loadModel(modelId: number): Promise<tf.LayersModel> {
  const cached = modelCache.get(modelId);
  if (cached) return cached;

  const savedModel = await storage.getMlModel(modelId);
  if (!savedModel) {
    throw new Error(`[ModelInference] Model ${modelId} not found in storage`);
  }
  // There is nothing to load, and no cast can change that.
  //
  // `ml_models` has no artifact-path column (packages/shared/src/schema.ts) — nothing
  // writes one, so the old code read `savedModel.modelPath`, got `undefined`
  // every time, and threw "was it trained and saved?", blaming the caller for a
  // shape the schema does not have. Typing it honestly removed the `any` that
  // hid this, and there is no honest type to give it: asserting
  // `{ modelPath?: string }` would just relocate the same fiction.
  //
  // Nor is there a file to point at. This repo trains PYTHON models into
  // data/models/<id>/ (diagnostics.json, .ubj, .pkl) and scores them over the
  // MLBridge ZMQ RPC; there is no TensorFlow.js artifact anywhere in the tree
  // for tf.loadLayersModel to read, and model_checkpoints is empty.
  //
  // So this refuses with the truth rather than keeping an unreachable load
  // behind a fabricated cast. Wiring ml_prediction to MLBridge is a product
  // decision, not something this function can paper over.
  throw new Error(
    `[ModelInference] Model ${modelId} ("${savedModel.name}") cannot be loaded: ` +
      `ml_models stores no artifact path and this build ships no TensorFlow.js models. ` +
      `Trained models live in data/models/ and are scored through MLBridge. ` +
      `Use a momentum or indicator strategy until ml_prediction is wired to MLBridge.`,
  );
}


// ─── Technical Indicator Helpers ────────────────────────────────────────────

function sma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (isNaN(prev)) {
      // seed with SMA of first `period` values
      if (i === period - 1) {
        let s = 0;
        for (let j = 0; j <= i; j++) s += values[j]!;
        prev = s / period;
        out[i] = prev;
      }
    } else {
      prev = values[i]! * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function computeRSI(closes: number[], period: number): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i < closes.length; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;

    if (i <= period) {
      gainSum += gain;
      lossSum += loss;
      if (i === period) {
        const avgGain = gainSum / period;
        const avgLoss = lossSum / period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    } else {
      gainSum = (gainSum * (period - 1) + gain) / period;
      lossSum = (lossSum * (period - 1) + loss) / period;
      out[i] = lossSum === 0 ? 100 : 100 - 100 / (1 + gainSum / lossSum);
    }
  }
  return out;
}

function computeATR(bars: OHLCVBar[], period: number): number[] {
  const out: number[] = new Array(bars.length).fill(NaN);
  let atrSum = 0;

  for (let i = 1; i < bars.length; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    const pc = bars[i - 1]!.close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));

    if (i <= period) {
      atrSum += tr;
      if (i === period) out[i] = atrSum / period;
    } else {
      out[i] = (out[i - 1]! * (period - 1) + tr) / period;
    }
  }
  return out;
}

// ─── Feature Computation ────────────────────────────────────────────────────

/** Minimum bars required before features can be computed. */
const MIN_LOOKBACK = 50;

/**
 * Compute a matrix of technical features from OHLCV bars.
 *
 * Features per bar (17 total):
 *  0  close-to-close return
 *  1  log return
 *  2  SMA(5)    — normalised as (close-SMA)/close
 *  3  SMA(10)
 *  4  SMA(20)
 *  5  SMA(50)
 *  6  EMA(12)   — normalised as (close-EMA)/close
 *  7  EMA(26)
 *  8  RSI(14)   — scaled 0-1
 *  9  MACD line
 * 10  MACD signal
 * 11  MACD histogram
 * 12  Bollinger %B
 * 13  Bollinger bandwidth
 * 14  ATR(14)   — normalised by close
 * 15  Volatility (20-bar std dev of returns)
 * 16  Volume ratio (volume / SMA-20 volume)
 *
 * Rows with insufficient lookback are omitted — returned length is
 * `bars.length - MIN_LOOKBACK`. Features are z-score normalised per column.
 */
export function computeFeatures(bars: OHLCVBar[]): number[][] {
  if (bars.length < MIN_LOOKBACK + 1) {
    return [];
  }

  const closes = bars.map(b => b.close);
  const volumes = bars.map(b => b.volume);

  // Pre-compute indicators
  const sma5 = sma(closes, 5);
  const sma10 = sma(closes, 10);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const rsi14 = computeRSI(closes, 14);
  const atr14 = computeATR(bars, 14);
  const volSma20 = sma(volumes, 20);

  // MACD
  const macdLine: number[] = new Array(bars.length).fill(NaN);
  for (let i = 0; i < bars.length; i++) {
    if (!isNaN(ema12[i]!) && !isNaN(ema26[i]!)) {
      macdLine[i] = ema12[i]! - ema26[i]!;
    }
  }
  const macdSignalRaw = ema(macdLine, 9); // EMA-9 of MACD line

  // Bollinger Bands (20, 2)
  const bbMid = sma20;
  const bbStd: number[] = new Array(bars.length).fill(NaN);
  for (let i = 19; i < bars.length; i++) {
    let sum2 = 0;
    for (let j = i - 19; j <= i; j++) {
      const d = closes[j]! - bbMid[i]!;
      sum2 += d * d;
    }
    bbStd[i] = Math.sqrt(sum2 / 20);
  }

  // Returns (shifted by 1)
  const returns: number[] = new Array(bars.length).fill(0);
  const logReturns: number[] = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const prev = closes[i - 1]!;
    if (prev !== 0) {
      returns[i] = (closes[i]! - prev) / prev;
      logReturns[i] = Math.log(closes[i]! / prev);
    }
  }

  // Volatility (rolling 20-bar std dev of returns)
  const vol20: number[] = new Array(bars.length).fill(NaN);
  for (let i = 20; i < bars.length; i++) {
    let sum = 0;
    for (let j = i - 19; j <= i; j++) sum += returns[j]!;
    const mean = sum / 20;
    let variance = 0;
    for (let j = i - 19; j <= i; j++) {
      const d = returns[j]! - mean;
      variance += d * d;
    }
    vol20[i] = Math.sqrt(variance / 20);
  }

  // Build raw feature matrix (only rows from MIN_LOOKBACK onward)
  const numFeatures = 17;
  const raw: number[][] = [];

  for (let i = MIN_LOOKBACK; i < bars.length; i++) {
    const c = closes[i]!;
    const row: number[] = [
      returns[i]!,
      logReturns[i]!,
      c !== 0 && !isNaN(sma5[i]!)  ? (c - sma5[i]!)  / c : 0,
      c !== 0 && !isNaN(sma10[i]!) ? (c - sma10[i]!) / c : 0,
      c !== 0 && !isNaN(sma20[i]!) ? (c - sma20[i]!) / c : 0,
      c !== 0 && !isNaN(sma50[i]!) ? (c - sma50[i]!) / c : 0,
      c !== 0 && !isNaN(ema12[i]!) ? (c - ema12[i]!) / c : 0,
      c !== 0 && !isNaN(ema26[i]!) ? (c - ema26[i]!) / c : 0,
      !isNaN(rsi14[i]!) ? rsi14[i]! / 100 : 0.5,
      !isNaN(macdLine[i]!) ? macdLine[i]! : 0,
      !isNaN(macdSignalRaw[i]!) ? macdSignalRaw[i]! : 0,
      !isNaN(macdLine[i]!) && !isNaN(macdSignalRaw[i]!) ? macdLine[i]! - macdSignalRaw[i]! : 0,
      // Bollinger %B = (close - lower) / (upper - lower)
      !isNaN(bbMid[i]!) && bbStd[i]! > 0
        ? (c - (bbMid[i]! - 2 * bbStd[i]!)) / (4 * bbStd[i]!)
        : 0.5,
      // Bollinger bandwidth = (upper - lower) / mid
      !isNaN(bbMid[i]!) && bbMid[i]! > 0 && bbStd[i]! > 0
        ? (4 * bbStd[i]!) / bbMid[i]!
        : 0,
      c !== 0 && !isNaN(atr14[i]!) ? atr14[i]! / c : 0,
      !isNaN(vol20[i]!) ? vol20[i]! : 0,
      volSma20[i]! > 0 ? volumes[i]! / volSma20[i]! : 1,
    ];
    raw.push(row);
  }

  if (raw.length === 0) return [];

  // Z-score normalisation per feature column
  const means: number[] = new Array(numFeatures).fill(0);
  const stds: number[] = new Array(numFeatures).fill(0);

  for (let f = 0; f < numFeatures; f++) {
    let sum = 0;
    for (let r = 0; r < raw.length; r++) sum += raw[r]![f]!;
    means[f] = sum / raw.length;
  }
  for (let f = 0; f < numFeatures; f++) {
    let variance = 0;
    for (let r = 0; r < raw.length; r++) {
      const d = raw[r]![f]! - means[f]!;
      variance += d * d;
    }
    stds[f] = Math.sqrt(variance / raw.length);
    if (stds[f]! < 1e-10) stds[f] = 1; // avoid div-by-zero for constant features
  }

  // Apply normalisation, clamp, and sanitise
  for (let r = 0; r < raw.length; r++) {
    for (let f = 0; f < numFeatures; f++) {
      let v = (raw[r]![f]! - means[f]!) / stds[f]!;
      // Clamp to [-5, 5] to tame outliers
      v = Math.max(-5, Math.min(5, v));
      // Replace NaN / Infinity with 0
      if (!isFinite(v)) v = 0;
      raw[r]![f] = v;
    }
  }

  return raw;
}

// ─── Model-Based Signal Generation ──────────────────────────────────────────

/**
 * Run batch inference through a trained model to produce signals.
 *
 * @param bars      OHLCV bars (test set)
 * @param modelId   ID of the model in storage
 * @param minConfidence  Minimum confidence threshold (default 0)
 */
export async function generateModelSignals(
  bars: OHLCVBar[],
  modelId: number,
  minConfidence = 0,
): Promise<Signal[]> {
  const model = await loadModel(modelId);
  const features = computeFeatures(bars);

  if (features.length === 0) {
    console.warn('[ModelInference] No features computed — insufficient data');
    return [];
  }

  const numRows = features.length;
  const numFeatures = features[0]!.length;

  // Determine input shape — the model may expect [batch, timesteps, features] or [batch, features]
  const inputShape = model.inputs[0]?.shape; // e.g. [null, 17] or [null, 1, 17]
  const is3D = inputShape && inputShape.length === 3;

  let inputTensor: tf.Tensor;
  if (is3D) {
    // Reshape to [numRows, 1, numFeatures]
    inputTensor = tf.tensor3d(
      features.map(row => [row]),
      [numRows, 1, numFeatures],
    );
  } else {
    inputTensor = tf.tensor2d(features, [numRows, numFeatures]);
  }

  const signals: Signal[] = [];

  try {
    const outputTensor = model.predict(inputTensor) as tf.Tensor;
    const outputData = await outputTensor.array() as number[][];
    outputTensor.dispose();

    // Map bars: features start at index MIN_LOOKBACK
    for (let i = 0; i < numRows; i++) {
      const barIdx = MIN_LOOKBACK + i;
      const probs = outputData[i]!;

      // Handle different output shapes: [3] probabilities or [1] regression
      let prediction: number;
      let confidence: number;
      let probabilities: number[] | undefined;

      if (probs.length >= 3) {
        // Classification output: [down, neutral, up]
        probabilities = probs.slice(0, 3);
        prediction = probabilities.indexOf(Math.max(...probabilities));
        confidence = probabilities[prediction]!;
      } else if (probs.length === 1) {
        // Regression output: map to direction
        const val = probs[0]!;
        if (val > 0.6) { prediction = 2; confidence = val; }
        else if (val < 0.4) { prediction = 0; confidence = 1 - val; }
        else { prediction = 1; confidence = 1 - Math.abs(val - 0.5) * 2; }
      } else {
        prediction = 1;
        confidence = 0.5;
      }

      if (confidence >= minConfidence) {
        signals.push({
          timestamp: bars[barIdx]!.ts,
          prediction,
          confidence,
          probabilities,
        });
      }
    }
  } finally {
    inputTensor.dispose();
  }

  logInfo(`[ModelInference] Generated ${signals.length} signals from model ${modelId}`);
  return signals;
}

// ─── Momentum Fallback ──────────────────────────────────────────────────────

/**
 * Simple momentum-based signal generation.
 * Extracted from backtestOrchestrator for reuse.
 */
export function generateMomentumSignals(bars: OHLCVBar[], lookback = 20): Signal[] {
  const signals: Signal[] = [];

  for (let i = lookback; i < bars.length; i++) {
    const ret = (bars[i]!.close - bars[i - lookback]!.close) / bars[i - lookback]!.close;
    const absReturn = Math.abs(ret);

    let prediction: number;
    if (ret > 0.001) prediction = 2;       // up / long
    else if (ret < -0.001) prediction = 0; // down / short
    else prediction = 1;                   // neutral

    signals.push({
      timestamp: bars[i]!.ts,
      prediction,
      confidence: Math.min(0.5 + absReturn * 10, 0.99),
    });
  }

  return signals;
}

// ─── Indicator-Based Signal Generation ──────────────────────────────────────

/** Strategy configuration for indicator-based signals. */
export interface IndicatorStrategy {
  preset: IndicatorStrategyPreset;
  params?: Record<string, number>;
}

/**
 * Generate signals from technical indicator strategies.
 *
 * Supported presets:
 *  - sma_crossover / ema_crossover — fast/slow MA crossover
 *  - rsi_reversal — mean-reversion on RSI oversold/overbought
 *  - macd_signal — MACD line / signal line crossover
 *  - bollinger_breakout — breakout on Bollinger Band touch
 *  - triple_ma — three-MA trend alignment
 */
export function generateIndicatorSignals(
  bars: OHLCVBar[],
  strategy: IndicatorStrategy,
): Signal[] {
  const defaults = INDICATOR_DEFAULTS[strategy.preset];
  const p = { ...defaults, ...strategy.params };
  const closes = bars.map(b => b.close);
  const signals: Signal[] = [];

  switch (strategy.preset) {
    case 'sma_crossover': {
      const fast = sma(closes, p.fastPeriod!);
      const slow = sma(closes, p.slowPeriod!);
      for (let i = 1; i < bars.length; i++) {
        if (isNaN(fast[i]!) || isNaN(slow[i]!) || isNaN(fast[i - 1]!) || isNaN(slow[i - 1]!)) continue;
        const crossUp = fast[i - 1]! <= slow[i - 1]! && fast[i]! > slow[i]!;
        const crossDn = fast[i - 1]! >= slow[i - 1]! && fast[i]! < slow[i]!;
        if (crossUp || crossDn) {
          const spread = Math.abs(fast[i]! - slow[i]!) / closes[i]!;
          signals.push({
            timestamp: bars[i]!.ts,
            prediction: crossUp ? 2 : 0,
            confidence: Math.min(0.5 + spread * 50, 0.95),
          });
        }
      }
      break;
    }

    case 'ema_crossover': {
      const fast = ema(closes, p.fastPeriod!);
      const slow = ema(closes, p.slowPeriod!);
      for (let i = 1; i < bars.length; i++) {
        if (isNaN(fast[i]!) || isNaN(slow[i]!) || isNaN(fast[i - 1]!) || isNaN(slow[i - 1]!)) continue;
        const crossUp = fast[i - 1]! <= slow[i - 1]! && fast[i]! > slow[i]!;
        const crossDn = fast[i - 1]! >= slow[i - 1]! && fast[i]! < slow[i]!;
        if (crossUp || crossDn) {
          const spread = Math.abs(fast[i]! - slow[i]!) / closes[i]!;
          signals.push({
            timestamp: bars[i]!.ts,
            prediction: crossUp ? 2 : 0,
            confidence: Math.min(0.5 + spread * 50, 0.95),
          });
        }
      }
      break;
    }

    case 'rsi_reversal': {
      const rsi = computeRSI(closes, p.period!);
      const oversold = p.oversold!;
      const overbought = p.overbought!;
      for (let i = 1; i < bars.length; i++) {
        if (isNaN(rsi[i]!) || isNaN(rsi[i - 1]!)) continue;
        // Reversal: was oversold, now crossing back up
        if (rsi[i - 1]! < oversold && rsi[i]! >= oversold) {
          signals.push({
            timestamp: bars[i]!.ts,
            prediction: 2, // long
            confidence: Math.min(0.5 + (oversold - rsi[i - 1]!) / 100, 0.95),
          });
        }
        // Was overbought, now crossing back down
        if (rsi[i - 1]! > overbought && rsi[i]! <= overbought) {
          signals.push({
            timestamp: bars[i]!.ts,
            prediction: 0, // short
            confidence: Math.min(0.5 + (rsi[i - 1]! - overbought) / 100, 0.95),
          });
        }
      }
      break;
    }

    case 'macd_signal': {
      const ema12v = ema(closes, p.fastPeriod!);
      const ema26v = ema(closes, p.slowPeriod!);
      const macdL: number[] = new Array(bars.length).fill(NaN);
      for (let i = 0; i < bars.length; i++) {
        if (!isNaN(ema12v[i]!) && !isNaN(ema26v[i]!)) {
          macdL[i] = ema12v[i]! - ema26v[i]!;
        }
      }
      const sig = ema(macdL, p.signalPeriod!);
      for (let i = 1; i < bars.length; i++) {
        if (isNaN(macdL[i]!) || isNaN(sig[i]!) || isNaN(macdL[i - 1]!) || isNaN(sig[i - 1]!)) continue;
        const crossUp = macdL[i - 1]! <= sig[i - 1]! && macdL[i]! > sig[i]!;
        const crossDn = macdL[i - 1]! >= sig[i - 1]! && macdL[i]! < sig[i]!;
        if (crossUp || crossDn) {
          const hist = Math.abs(macdL[i]! - sig[i]!);
          signals.push({
            timestamp: bars[i]!.ts,
            prediction: crossUp ? 2 : 0,
            confidence: Math.min(0.5 + hist * 20, 0.95),
          });
        }
      }
      break;
    }

    case 'bollinger_breakout': {
      const mid = sma(closes, p.period!);
      const stdMultiple = p.stdDev!;
      for (let i = p.period! - 1; i < bars.length; i++) {
        if (isNaN(mid[i]!)) continue;
        let variance = 0;
        for (let j = i - p.period! + 1; j <= i; j++) {
          const d = closes[j]! - mid[i]!;
          variance += d * d;
        }
        const std = Math.sqrt(variance / p.period!);
        const upper = mid[i]! + stdMultiple * std;
        const lower = mid[i]! - stdMultiple * std;

        if (closes[i]! > upper) {
          signals.push({
            timestamp: bars[i]!.ts,
            prediction: 2, // breakout up
            confidence: Math.min(0.5 + (closes[i]! - upper) / (upper - lower + 1e-10), 0.95),
          });
        } else if (closes[i]! < lower) {
          signals.push({
            timestamp: bars[i]!.ts,
            prediction: 0, // breakout down
            confidence: Math.min(0.5 + (lower - closes[i]!) / (upper - lower + 1e-10), 0.95),
          });
        }
      }
      break;
    }

    case 'triple_ma': {
      const fast = sma(closes, p.fastPeriod!);
      const med = sma(closes, p.mediumPeriod!);
      const slow = sma(closes, p.slowPeriod!);
      for (let i = 1; i < bars.length; i++) {
        if (isNaN(fast[i]!) || isNaN(med[i]!) || isNaN(slow[i]!)) continue;
        if (isNaN(fast[i - 1]!) || isNaN(med[i - 1]!) || isNaN(slow[i - 1]!)) continue;

        const aligned_up = fast[i]! > med[i]! && med[i]! > slow[i]!;
        const aligned_dn = fast[i]! < med[i]! && med[i]! < slow[i]!;
        const was_aligned_up = fast[i - 1]! > med[i - 1]! && med[i - 1]! > slow[i - 1]!;
        const was_aligned_dn = fast[i - 1]! < med[i - 1]! && med[i - 1]! < slow[i - 1]!;

        // Signal on alignment change
        if (aligned_up && !was_aligned_up) {
          const spread = (fast[i]! - slow[i]!) / closes[i]!;
          signals.push({
            timestamp: bars[i]!.ts,
            prediction: 2,
            confidence: Math.min(0.6 + Math.abs(spread) * 30, 0.95),
          });
        } else if (aligned_dn && !was_aligned_dn) {
          const spread = (slow[i]! - fast[i]!) / closes[i]!;
          signals.push({
            timestamp: bars[i]!.ts,
            prediction: 0,
            confidence: Math.min(0.6 + Math.abs(spread) * 30, 0.95),
          });
        }
      }
      break;
    }
  }

  return signals;
}
