/**
 * Signal Generator — transforms raw model predictions into tradeable signals.
 *
 * Think of it as: The model gives you a weather forecast ("70% chance of sun").
 * The signal generator decides if that's actionable ("Yes, go outside" or
 * "Not confident enough, stay home"). It also checks the bigger picture —
 * is there a storm warning (regime filter)? Did we just come back inside
 * (cooldown)? Are we already holding an umbrella (position check)?
 *
 * Pipeline:
 * Raw predictions → Confidence filter → Regime filter → Cooldown → Consensus → Signal
 *
 * Signal types:
 * - LONG:    model confident about upward move
 * - SHORT:   model confident about downward move
 * - FLAT:    close any open position (neutral / reversal)
 * - NO_SIGNAL: not confident enough, do nothing
 */

import type { Prediction } from './inferenceService';

// ============================================================
// TYPES
// ============================================================

export type SignalDirection = 'long' | 'short' | 'flat' | 'no_signal';

export interface TradeSignal {
  timestamp: number;
  symbol: string;
  direction: SignalDirection;
  confidence: number;         // 0-1
  strength: number;           // 0-1, composite score based on all filters
  modelPrediction: number;    // raw class (0=up, 1=neutral, 2=down)
  probabilities: number[];
  reason: string;             // why this signal was generated
  filters: {
    confidencePass: boolean;
    regimePass: boolean;
    cooldownPass: boolean;
    consensusPass: boolean;
    volatilityPass: boolean;
  };
  metadata?: Record<string, any>;
}

export interface SignalGeneratorConfig {
  /** Minimum confidence to generate a signal (default 0.55) */
  minConfidence: number;
  /** Minimum probability gap between 1st and 2nd classes (default 0.10) */
  minProbabilityGap: number;
  /** Cooldown: min bars between consecutive signals in the same direction (default 3) */
  cooldownBars: number;
  /** Enable regime filter */
  useRegimeFilter: boolean;
  /** Volatility-based confidence scaling */
  useVolatilityScaling: boolean;
  /** Consensus: require N sequential bars agreeing (default 1 = no consensus needed) */
  consensusBars: number;
  /** Max allowed volatility ratio (relative to avg) — skip signals during extreme vol (default: Infinity) */
  maxVolatilityRatio: number;
  /** Min allowed volatility ratio — skip signals during dead markets (default: 0) */
  minVolatilityRatio: number;
  /** Whether to generate short signals (default true) */
  allowShorts: boolean;
  /** Neutral prediction threshold — below this confidence, treat as flat (default 0.4) */
  neutralThreshold: number;
}

export const DEFAULT_SIGNAL_CONFIG: SignalGeneratorConfig = {
  minConfidence: 0.55,
  minProbabilityGap: 0.10,
  cooldownBars: 3,
  useRegimeFilter: false,
  useVolatilityScaling: false,
  consensusBars: 1,
  maxVolatilityRatio: Infinity,
  minVolatilityRatio: 0,
  allowShorts: true,
  neutralThreshold: 0.4,
};

// ============================================================
// REGIME DETECTION (simple, feature-based)
// ============================================================

export type MarketRegime = 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'unknown';

interface RegimeState {
  regime: MarketRegime;
  confidence: number;
  volatilityRatio: number;
}

/**
 * Simple regime detection from feature snapshots.
 * Think of it as: Reading the market's mood from the indicators —
 * if SMA z-scores all agree, it's trending. If vol_ratio is high, it's volatile.
 */
function detectRegime(features?: Record<string, number>): RegimeState {
  if (!features) {
    return { regime: 'unknown', confidence: 0, volatilityRatio: 1 };
  }

  const volRatio = features['vol_ratio'] || 1;
  const smaZ5 = features['close_vs_sma5_z'] || 0;
  const smaZ20 = features['close_vs_sma20_z'] || 0;
  const smaZ50 = features['close_vs_sma50_z'] || 0;
  const rsi14 = features['rsi_14'] || 0.5;

  // Volatile if vol_ratio > 1.5 (current ATR is 1.5x the long-term ATR)
  if (volRatio > 1.5) {
    return { regime: 'volatile', confidence: Math.min(1, (volRatio - 1) / 2), volatilityRatio: volRatio };
  }

  // Trending up: all SMA z-scores positive and aligned
  if (smaZ5 > 0.5 && smaZ20 > 0.3 && smaZ50 > 0) {
    const trendStrength = Math.min(1, (smaZ5 + smaZ20 + smaZ50) / 3);
    return { regime: 'trending_up', confidence: trendStrength, volatilityRatio: volRatio };
  }

  // Trending down: all SMA z-scores negative and aligned
  if (smaZ5 < -0.5 && smaZ20 < -0.3 && smaZ50 < 0) {
    const trendStrength = Math.min(1, Math.abs(smaZ5 + smaZ20 + smaZ50) / 3);
    return { regime: 'trending_down', confidence: trendStrength, volatilityRatio: volRatio };
  }

  // Ranging: RSI between 40-60 and low volatility
  if (rsi14 > 0.4 && rsi14 < 0.6 && volRatio < 0.8) {
    return { regime: 'ranging', confidence: 0.5, volatilityRatio: volRatio };
  }

  return { regime: 'unknown', confidence: 0.3, volatilityRatio: volRatio };
}

// ============================================================
// SIGNAL GENERATOR
// ============================================================

export class SignalGenerator {
  private config: SignalGeneratorConfig;
  private recentDirections: Array<{ direction: SignalDirection; timestamp: number }> = [];
  private predictionHistory: Prediction[] = [];

  constructor(config: Partial<SignalGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_SIGNAL_CONFIG, ...config };
  }

  /** Update config on the fly (e.g., from UI controls) */
  updateConfig(updates: Partial<SignalGeneratorConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /** Reset internal state (e.g., when switching symbols) */
  reset(): void {
    this.recentDirections = [];
    this.predictionHistory = [];
  }

  /**
   * Process a single prediction and return a trade signal.
   * This is the main entry point for live signal generation.
   */
  processOne(prediction: Prediction): TradeSignal {
    this.predictionHistory.push(prediction);

    // Keep history bounded
    if (this.predictionHistory.length > 200) {
      this.predictionHistory = this.predictionHistory.slice(-100);
    }

    const { probabilities, confidence, prediction: predClass, symbol, timestamp, featureSnapshot } = prediction;

    // === Filter 1: Confidence threshold ===
    const confidencePass = confidence >= this.config.minConfidence;

    // === Filter 2: Probability gap (ensures the model isn't just guessing) ===
    const sortedProbs = [...probabilities].sort((a, b) => b - a);
    const gapPass = (sortedProbs[0]! - sortedProbs[1]!) >= this.config.minProbabilityGap;
    const combinedConfidencePass = confidencePass && gapPass;

    // === Filter 3: Regime filter ===
    let regimePass = true;
    let regimeInfo: RegimeState | undefined;
    if (this.config.useRegimeFilter && featureSnapshot) {
      regimeInfo = detectRegime(featureSnapshot);

      // In ranging markets, prefer no signal (model struggles with chop)
      if (regimeInfo.regime === 'ranging' && regimeInfo.confidence > 0.5) {
        regimePass = false;
      }
    }

    // === Filter 4: Volatility bounds ===
    let volatilityPass = true;
    if (featureSnapshot) {
      const volRatio = featureSnapshot['vol_ratio'] || 1;
      if (volRatio > this.config.maxVolatilityRatio || volRatio < this.config.minVolatilityRatio) {
        volatilityPass = false;
      }
    }

    // === Filter 5: Cooldown ===
    let cooldownPass = true;
    if (this.config.cooldownBars > 0 && this.recentDirections.length > 0) {
      const lastSignal = this.recentDirections[this.recentDirections.length - 1];
      const barsSinceLast = this.predictionHistory.length - 1; // approximate
      if (barsSinceLast < this.config.cooldownBars) {
        cooldownPass = false;
      }
    }

    // === Filter 6: Consensus (N consecutive bars must agree) ===
    let consensusPass = true;
    if (this.config.consensusBars > 1) {
      const recent = this.predictionHistory.slice(-this.config.consensusBars);
      if (recent.length < this.config.consensusBars) {
        consensusPass = false;
      } else {
        const allAgree = recent.every(p => p.prediction === predClass);
        consensusPass = allAgree;
      }
    }

    // === Compute direction ===
    let direction: SignalDirection = 'no_signal';
    let reason = '';

    if (!combinedConfidencePass) {
      direction = 'no_signal';
      reason = `Low confidence (${(confidence * 100).toFixed(1)}%) or small gap (${((sortedProbs[0]! - sortedProbs[1]!) * 100).toFixed(1)}%)`;
    } else if (!cooldownPass) {
      direction = 'no_signal';
      reason = `Cooldown (${this.config.cooldownBars} bars)`;
    } else if (!regimePass) {
      direction = 'no_signal';
      reason = `Regime filter: ${regimeInfo?.regime} (${(regimeInfo?.confidence || 0 * 100).toFixed(0)}% confidence)`;
    } else if (!volatilityPass) {
      direction = 'no_signal';
      reason = `Volatility out of bounds`;
    } else if (!consensusPass) {
      direction = 'no_signal';
      reason = `Consensus not met (need ${this.config.consensusBars} bars)`;
    } else {
      // Model prediction → signal
      if (predClass === 0) {
        // Up → Long
        direction = 'long';
        reason = `Model predicts UP (${(confidence * 100).toFixed(1)}% confidence)`;
      } else if (predClass === 2 && this.config.allowShorts) {
        // Down → Short
        direction = 'short';
        reason = `Model predicts DOWN (${(confidence * 100).toFixed(1)}% confidence)`;
      } else if (predClass === 2 && !this.config.allowShorts) {
        // Down but shorts disabled → flat
        direction = 'flat';
        reason = `Model predicts DOWN but shorts disabled`;
      } else {
        // Neutral → flat (close positions)
        direction = 'flat';
        reason = `Model predicts NEUTRAL`;
      }
    }

    // === Compute composite strength score ===
    const filtersScore = [combinedConfidencePass, regimePass, cooldownPass, consensusPass, volatilityPass]
      .filter(Boolean).length / 5;
    const strength = direction !== 'no_signal'
      ? confidence * filtersScore * (this.config.useVolatilityScaling && regimeInfo ? Math.min(1, 1 / regimeInfo.volatilityRatio) : 1)
      : 0;

    // Track direction for cooldown
    if (direction !== 'no_signal') {
      this.recentDirections.push({ direction, timestamp });
      if (this.recentDirections.length > 50) {
        this.recentDirections = this.recentDirections.slice(-25);
      }
    }

    return {
      timestamp,
      symbol,
      direction,
      confidence,
      strength,
      modelPrediction: predClass,
      probabilities,
      reason,
      filters: {
        confidencePass: combinedConfidencePass,
        regimePass,
        cooldownPass,
        consensusPass,
        volatilityPass,
      },
      metadata: regimeInfo ? {
        regime: regimeInfo.regime,
        regimeConfidence: regimeInfo.confidence,
        volatilityRatio: regimeInfo.volatilityRatio,
      } : undefined,
    };
  }

  /**
   * Process a batch of predictions into signals.
   * Used for backtesting — processes sequentially to maintain state.
   */
  processBatch(predictions: Prediction[]): TradeSignal[] {
    this.reset(); // Clean state for batch
    return predictions.map(p => this.processOne(p));
  }

  /**
   * Convert signals to the backtest engine's Signal format.
   */
  toBacktestSignals(signals: TradeSignal[]): Array<{
    timestamp: number;
    prediction: number;
    confidence: number;
    probabilities?: number[];
  }> {
    return signals
      .filter(s => s.direction !== 'no_signal')
      .map(s => ({
        timestamp: s.timestamp,
        prediction: s.direction === 'long' ? 2 : s.direction === 'short' ? 0 : 1,
        confidence: s.strength, // Use composite strength, not raw confidence
        probabilities: s.probabilities,
      }));
  }

  /** Get signal statistics from a batch */
  getStats(signals: TradeSignal[]): {
    total: number;
    longs: number;
    shorts: number;
    flats: number;
    noSignals: number;
    avgConfidence: number;
    avgStrength: number;
    filterRejections: Record<string, number>;
  } {
    const longs = signals.filter(s => s.direction === 'long');
    const shorts = signals.filter(s => s.direction === 'short');
    const flats = signals.filter(s => s.direction === 'flat');
    const noSignals = signals.filter(s => s.direction === 'no_signal');

    const actionable = signals.filter(s => s.direction !== 'no_signal');
    const avgConfidence = actionable.length > 0
      ? actionable.reduce((s, a) => s + a.confidence, 0) / actionable.length
      : 0;
    const avgStrength = actionable.length > 0
      ? actionable.reduce((s, a) => s + a.strength, 0) / actionable.length
      : 0;

    const filterRejections: Record<string, number> = {
      confidence: signals.filter(s => !s.filters.confidencePass).length,
      regime: signals.filter(s => !s.filters.regimePass).length,
      cooldown: signals.filter(s => !s.filters.cooldownPass).length,
      consensus: signals.filter(s => !s.filters.consensusPass).length,
      volatility: signals.filter(s => !s.filters.volatilityPass).length,
    };

    return {
      total: signals.length,
      longs: longs.length,
      shorts: shorts.length,
      flats: flats.length,
      noSignals: noSignals.length,
      avgConfidence,
      avgStrength,
      filterRejections,
    };
  }
}

// Default instance
export const signalGenerator = new SignalGenerator();
