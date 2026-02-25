/**
 * Indicator Computation Service
 * 
 * Provides both batch (DuckDB SQL) and real-time (technicalindicators) calculations.
 * - Batch mode: Uses DuckDB for efficient OLAP-style computation on large datasets
 * - Real-time mode: Uses technicalindicators library for streaming calculations
 */

import { 
  RSI, MACD, BollingerBands, ATR, Stochastic, CCI, WilliamsR, 
  SMA, EMA, ROC
} from 'technicalindicators';
import { generateBulkIndicatorsSQL, rsiSQL, macdSQL, atrSQL, stochasticSQL, cciSQL, williamsRSQL, BulkIndicatorRequest } from './sqlGenerator';
import type { OHLCVBar } from '@shared/ohlcv';

export type { OHLCVBar };

export interface IndicatorResult {
  timestamp: number;
  [key: string]: number | null;
}

export interface ComputeIndicatorsRequest {
  indicators: {
    rsi?: number[];
    macd?: { fast: number; slow: number; signal: number }[];
    bollinger?: { period: number; stdDev: number }[];
    atr?: number[];
    stochastic?: { k: number; d: number }[];
    cci?: number[];
    williamsR?: number[];
    sma?: number[];
    ema?: number[];
    roc?: number[];
    momentum?: number[];
  };
}

export function computeIndicatorsRealtime(
  data: OHLCVBar[],
  request: ComputeIndicatorsRequest
): IndicatorResult[] {
  if (data.length === 0) return [];

  const results: IndicatorResult[] = data.map(bar => ({
    timestamp: bar.timestamp,
  }));

  const closes = data.map(d => d.close);
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);
  const volumes = data.map(d => d.volume);

  // RSI
  if (request.indicators.rsi) {
    for (const period of request.indicators.rsi) {
      const rsiValues = RSI.calculate({ values: closes, period });
      const offset = data.length - rsiValues.length;
      rsiValues.forEach((val, i) => {
        results[i + offset]![`rsi_${period}`] = val;
      });
    }
  }

  // MACD
  if (request.indicators.macd) {
    for (const params of request.indicators.macd) {
      const macdResult = MACD.calculate({
        values: closes,
        fastPeriod: params.fast,
        slowPeriod: params.slow,
        signalPeriod: params.signal,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      });
      const offset = data.length - macdResult.length;
      macdResult.forEach((val, i) => {
        results[i + offset]![`macd_${params.fast}_${params.slow}_${params.signal}`] = val.MACD ?? null;
        results[i + offset]![`macd_signal_${params.fast}_${params.slow}_${params.signal}`] = val.signal ?? null;
        results[i + offset]![`macd_hist_${params.fast}_${params.slow}_${params.signal}`] = val.histogram ?? null;
      });
    }
  }

  // Bollinger Bands
  if (request.indicators.bollinger) {
    for (const params of request.indicators.bollinger) {
      const bbResult = BollingerBands.calculate({
        values: closes,
        period: params.period,
        stdDev: params.stdDev,
      });
      const offset = data.length - bbResult.length;
      bbResult.forEach((val, i) => {
        results[i + offset]![`bb_upper_${params.period}`] = val.upper;
        results[i + offset]![`bb_middle_${params.period}`] = val.middle;
        results[i + offset]![`bb_lower_${params.period}`] = val.lower;
        // %B = (close - lower) / (upper - lower)
        const close = closes[i + offset]!;
        results[i + offset]![`bb_pct_b_${params.period}`] = 
          val.upper !== val.lower ? (close - val.lower) / (val.upper - val.lower) : 0.5;
      });
    }
  }

  // ATR
  if (request.indicators.atr) {
    for (const period of request.indicators.atr) {
      const atrResult = ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period,
      });
      const offset = data.length - atrResult.length;
      atrResult.forEach((val, i) => {
        results[i + offset]![`atr_${period}`] = val;
      });
    }
  }

  // Stochastic
  if (request.indicators.stochastic) {
    for (const params of request.indicators.stochastic) {
      const stochResult = Stochastic.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: params.k,
        signalPeriod: params.d,
      });
      const offset = data.length - stochResult.length;
      stochResult.forEach((val, i) => {
        results[i + offset]![`stoch_k_${params.k}`] = val.k;
        results[i + offset]![`stoch_d_${params.k}_${params.d}`] = val.d;
      });
    }
  }

  // CCI
  if (request.indicators.cci) {
    for (const period of request.indicators.cci) {
      const cciResult = CCI.calculate({
        high: highs,
        low: lows,
        close: closes,
        period,
      });
      const offset = data.length - cciResult.length;
      cciResult.forEach((val, i) => {
        results[i + offset]![`cci_${period}`] = val;
      });
    }
  }

  // Williams %R
  if (request.indicators.williamsR) {
    for (const period of request.indicators.williamsR) {
      const wrResult = WilliamsR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period,
      });
      const offset = data.length - wrResult.length;
      wrResult.forEach((val, i) => {
        results[i + offset]![`williams_r_${period}`] = val;
      });
    }
  }

  // SMA
  if (request.indicators.sma) {
    for (const period of request.indicators.sma) {
      const smaResult = SMA.calculate({ values: closes, period });
      const offset = data.length - smaResult.length;
      smaResult.forEach((val, i) => {
        results[i + offset]![`sma_${period}`] = val;
      });
    }
  }

  // EMA
  if (request.indicators.ema) {
    for (const period of request.indicators.ema) {
      const emaResult = EMA.calculate({ values: closes, period });
      const offset = data.length - emaResult.length;
      emaResult.forEach((val, i) => {
        results[i + offset]![`ema_${period}`] = val;
      });
    }
  }

  // ROC
  if (request.indicators.roc) {
    for (const period of request.indicators.roc) {
      const rocResult = ROC.calculate({ values: closes, period });
      const offset = data.length - rocResult.length;
      rocResult.forEach((val, i) => {
        results[i + offset]![`roc_${period}`] = val;
      });
    }
  }

  // Momentum (price - price[n periods ago])
  if (request.indicators.momentum) {
    for (const period of request.indicators.momentum) {
      for (let i = period; i < closes.length; i++) {
        results[i]![`momentum_${period}`] = closes[i]! - closes[i - period]!;
      }
    }
  }

  return results;
}

export function generateIndicatorSQL(
  request: ComputeIndicatorsRequest,
  tableName: string = 'ohlcv',
  symbol?: string
): string {
  const bulkRequest: BulkIndicatorRequest = {
    sma: request.indicators.sma,
    stddev: request.indicators.bollinger?.map(b => b.period),
    roc: request.indicators.roc,
    momentum: request.indicators.momentum,
    bollingerBands: request.indicators.bollinger,
    williamsR: request.indicators.williamsR,
  };

  const options = {
    tableName,
    symbolColumn: 'symbol',
    timestampColumn: 'timestamp',
    partition: true,
  };

  let sql = generateBulkIndicatorsSQL(bulkRequest, options);

  // Add WHERE clause for symbol if provided
  if (symbol) {
    sql = sql.replace(/FROM \S+/, `FROM ${tableName} WHERE symbol = '${symbol}'`);
  }

  // Add ORDER BY
  sql += `\nORDER BY symbol, timestamp`;

  return sql;
}

// Default indicator presets for common use cases
export const INDICATOR_PRESETS = {
  momentum: {
    rsi: [14],
    macd: [{ fast: 12, slow: 26, signal: 9 }],
    momentum: [10, 20],
    roc: [10],
  },
  volatility: {
    bollinger: [{ period: 20, stdDev: 2 }],
    atr: [14],
  },
  trend: {
    sma: [20, 50, 200],
    ema: [12, 26],
  },
  oscillators: {
    rsi: [14],
    stochastic: [{ k: 14, d: 3 }],
    cci: [20],
    williamsR: [14],
  },
  full: {
    rsi: [14],
    macd: [{ fast: 12, slow: 26, signal: 9 }],
    bollinger: [{ period: 20, stdDev: 2 }],
    atr: [14],
    stochastic: [{ k: 14, d: 3 }],
    sma: [20, 50],
    ema: [12, 26],
    roc: [10],
    momentum: [10],
  },
};

export type IndicatorPreset = keyof typeof INDICATOR_PRESETS;
