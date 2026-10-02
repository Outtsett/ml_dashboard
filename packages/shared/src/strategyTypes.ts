/**
 * Strategy type definitions for backtesting.
 * Shared between client and server.
 */

// ─── Strategy Enums ─────────────────────────────────────────────────────────

/** How the strategy generates signals. */
export type StrategyType = 'ml_prediction' | 'momentum' | 'indicator' | 'hybrid';

/** Describes the signal generation method used in a backtest run. */
export type SignalSource = 'model' | 'momentum' | 'indicator' | 'hybrid';

/** Built-in indicator strategy presets. */
export type IndicatorStrategyPreset =
  | 'sma_crossover'
  | 'ema_crossover'
  | 'rsi_reversal'
  | 'macd_signal'
  | 'bollinger_breakout'
  | 'triple_ma';

// ─── Forex Session Definitions ──────────────────────────────────────────────

/** A forex trading session window in UTC hours. */
export interface TradingSession {
  name: string;
  startHourUTC: number;
  endHourUTC: number;
  enabled: boolean;
}

/** Standard forex sessions with default enabled state. */
export const FOREX_SESSIONS: Record<string, TradingSession> = {
  sydney:  { name: 'Sydney',   startHourUTC: 21, endHourUTC: 6,  enabled: false },
  tokyo:   { name: 'Tokyo',    startHourUTC: 0,  endHourUTC: 8,  enabled: false },
  london:  { name: 'London',   startHourUTC: 8,  endHourUTC: 16, enabled: true },
  newYork: { name: 'New York', startHourUTC: 13, endHourUTC: 21, enabled: true },
};

// ─── Strategy Definition ────────────────────────────────────────────────────

/** Full strategy definition — drives signal generation in the strategy engine. */
export interface StrategyDefinition {
  id?: number;
  name: string;
  type: StrategyType;
  description?: string;

  /** ML model config (when type = 'ml_prediction' or 'hybrid'). */
  modelId?: number;
  useLastTrained?: boolean;

  /** Indicator config (when type = 'indicator' or 'hybrid'). */
  indicatorPreset?: IndicatorStrategyPreset;
  indicatorParams?: Record<string, number>;

  /** Session filter — restrict signals to forex session windows. */
  sessionFilter?: {
    sessions: string[];       // keys from FOREX_SESSIONS
    requireOverlap?: boolean; // only trade during session overlaps
  };

  /** Minimum model/signal confidence to accept (0-1). */
  minConfidence?: number;
  /** Require N consecutive same-direction signals before entry. */
  confirmationBars?: number;

  /** Position sizing mode. */
  positionSizingMode?: 'fixed' | 'risk_pct' | 'kelly';
  /** Risk per trade as % of equity (for risk_pct mode). */
  riskPerTradePct?: number;
}

// ─── Default Indicator Parameters ───────────────────────────────────────────

/** Default parameters for each indicator preset. */
export const INDICATOR_DEFAULTS: Record<IndicatorStrategyPreset, Record<string, number>> = {
  sma_crossover:      { fastPeriod: 10, slowPeriod: 20 },
  ema_crossover:      { fastPeriod: 12, slowPeriod: 26 },
  rsi_reversal:       { period: 14, oversold: 30, overbought: 70 },
  macd_signal:        { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
  bollinger_breakout: { period: 20, stdDev: 2 },
  triple_ma:          { fastPeriod: 5, mediumPeriod: 20, slowPeriod: 50 },
};
