/**
 * Indicator Computation Service
 * 
 * Provides both batch (SQL) and real-time (technicalindicators) calculations.
 * - Batch mode: Uses SQL window functions for efficient OLAP-style computation
 * - Real-time mode: Uses technicalindicators library for streaming calculations
 */

import { 
  RSI, MACD, BollingerBands, ATR, Stochastic, CCI, WilliamsR, 
  SMA, EMA, ROC
} from 'technicalindicators';
import { generateBulkIndicatorsSQL, BulkIndicatorRequest } from './sqlGenerator';
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

// ─── Realtime Indicator Registry (OCP: add new indicator = add entry here) ───

interface BarData {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
}

type RealtimeIndicatorFn = (
  bars: BarData,
  results: IndicatorResult[],
  config: unknown,
) => void;

const REALTIME_INDICATORS: Record<string, RealtimeIndicatorFn> = {
  rsi: (bars, results, periods) => {
    for (const period of periods as number[]) {
      const values = RSI.calculate({ values: bars.closes, period });
      const offset = bars.closes.length - values.length;
      values.forEach((val, i) => { results[i + offset]![`rsi_${period}`] = val; });
    }
  },

  macd: (bars, results, configs) => {
    for (const params of configs as { fast: number; slow: number; signal: number }[]) {
      const macdResult = MACD.calculate({
        values: bars.closes,
        fastPeriod: params.fast,
        slowPeriod: params.slow,
        signalPeriod: params.signal,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      });
      const offset = bars.closes.length - macdResult.length;
      macdResult.forEach((val, i) => {
        results[i + offset]![`macd_${params.fast}_${params.slow}_${params.signal}`] = val.MACD ?? null;
        results[i + offset]![`macd_signal_${params.fast}_${params.slow}_${params.signal}`] = val.signal ?? null;
        results[i + offset]![`macd_hist_${params.fast}_${params.slow}_${params.signal}`] = val.histogram ?? null;
      });
    }
  },

  bollinger: (bars, results, configs) => {
    for (const params of configs as { period: number; stdDev: number }[]) {
      const bbResult = BollingerBands.calculate({
        values: bars.closes,
        period: params.period,
        stdDev: params.stdDev,
      });
      const offset = bars.closes.length - bbResult.length;
      bbResult.forEach((val, i) => {
        results[i + offset]![`bb_upper_${params.period}`] = val.upper;
        results[i + offset]![`bb_middle_${params.period}`] = val.middle;
        results[i + offset]![`bb_lower_${params.period}`] = val.lower;
        const close = bars.closes[i + offset]!;
        results[i + offset]![`bb_pct_b_${params.period}`] = 
          val.upper !== val.lower ? (close - val.lower) / (val.upper - val.lower) : 0.5;
      });
    }
  },

  atr: (bars, results, periods) => {
    for (const period of periods as number[]) {
      const atrResult = ATR.calculate({ high: bars.highs, low: bars.lows, close: bars.closes, period });
      const offset = bars.closes.length - atrResult.length;
      atrResult.forEach((val, i) => { results[i + offset]![`atr_${period}`] = val; });
    }
  },

  stochastic: (bars, results, configs) => {
    for (const params of configs as { k: number; d: number }[]) {
      const stochResult = Stochastic.calculate({
        high: bars.highs, low: bars.lows, close: bars.closes,
        period: params.k, signalPeriod: params.d,
      });
      const offset = bars.closes.length - stochResult.length;
      stochResult.forEach((val, i) => {
        results[i + offset]![`stoch_k_${params.k}`] = val.k;
        results[i + offset]![`stoch_d_${params.k}_${params.d}`] = val.d;
      });
    }
  },

  cci: (bars, results, periods) => {
    for (const period of periods as number[]) {
      const cciResult = CCI.calculate({ high: bars.highs, low: bars.lows, close: bars.closes, period });
      const offset = bars.closes.length - cciResult.length;
      cciResult.forEach((val, i) => { results[i + offset]![`cci_${period}`] = val; });
    }
  },

  williamsR: (bars, results, periods) => {
    for (const period of periods as number[]) {
      const wrResult = WilliamsR.calculate({ high: bars.highs, low: bars.lows, close: bars.closes, period });
      const offset = bars.closes.length - wrResult.length;
      wrResult.forEach((val, i) => { results[i + offset]![`williams_r_${period}`] = val; });
    }
  },

  sma: (bars, results, periods) => {
    for (const period of periods as number[]) {
      const smaResult = SMA.calculate({ values: bars.closes, period });
      const offset = bars.closes.length - smaResult.length;
      smaResult.forEach((val, i) => { results[i + offset]![`sma_${period}`] = val; });
    }
  },

  ema: (bars, results, periods) => {
    for (const period of periods as number[]) {
      const emaResult = EMA.calculate({ values: bars.closes, period });
      const offset = bars.closes.length - emaResult.length;
      emaResult.forEach((val, i) => { results[i + offset]![`ema_${period}`] = val; });
    }
  },

  roc: (bars, results, periods) => {
    for (const period of periods as number[]) {
      const rocResult = ROC.calculate({ values: bars.closes, period });
      const offset = bars.closes.length - rocResult.length;
      rocResult.forEach((val, i) => { results[i + offset]![`roc_${period}`] = val; });
    }
  },

  momentum: (bars, results, periods) => {
    for (const period of periods as number[]) {
      for (let i = period; i < bars.closes.length; i++) {
        results[i]![`momentum_${period}`] = bars.closes[i]! - bars.closes[i - period]!;
      }
    }
  },
};

export function computeIndicatorsRealtime(
  data: OHLCVBar[],
  request: ComputeIndicatorsRequest
): IndicatorResult[] {
  if (data.length === 0) return [];

  const results: IndicatorResult[] = data.map(bar => ({ timestamp: bar.timestamp }));
  const bars: BarData = {
    closes: data.map(d => d.close),
    highs: data.map(d => d.high),
    lows: data.map(d => d.low),
    volumes: data.map(d => d.volume),
  };

  // Iterate the registry — each key maps to the request config
  for (const [key, compute] of Object.entries(REALTIME_INDICATORS)) {
    const config = request.indicators[key as keyof typeof request.indicators];
    if (config) {
      compute(bars, results, config);
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
