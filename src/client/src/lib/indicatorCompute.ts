/**
 * Indicator Compute Dispatcher — bridges ActiveIndicator instances to the
 * existing overlayCalculators and subchartCalculators math functions.
 *
 * Given an ActiveIndicator (id + params), this module computes the output
 * data points from raw OHLCV bars.
 */

import type { ActiveIndicator } from '@/hooks/useActiveIndicators';
import { getIndicatorDefinition } from '@/lib/indicatorRegistry';
import { computeOverlay, type OverlayPoint } from '@/lib/overlayCalculators';
import { computeSubchart, type IndicatorPoint } from '@/lib/subchartCalculators';

export interface ComputedOutput {
  outputKey: string;
  label: string;
  data: { time: number; value: number }[];
  style: 'line' | 'histogram';
}

export interface ComputedIndicator {
  instanceId: string;
  indicatorId: string;
  displayType: 'overlay' | 'subchart';
  outputs: ComputedOutput[];
}

interface OHLCVBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Build the column name that the existing calculators expect.
 * This maps from (indicatorId, params) to the legacy column format.
 */
function buildColumnName(indicatorId: string, params: Record<string, number>): string | string[] {
  switch (indicatorId) {
    case 'sma': return `SMA_${params.period}`;
    case 'ema': return `EMA_${params.period}`;
    case 'wma': return `WMA_${params.period}`;
    case 'dema': return `DEMA_${params.period}`;
    case 'tema': return `TEMA_${params.period}`;
    case 'kama': return `KAMA_${params.period}`;
    case 'psar': return 'PSAR';
    case 'vwap': return 'VWAP';
    case 'bbands': {
      const p = params.period;
      const sd = params.stdDev ?? 2.0;
      // Convert 2.0 → "2_0" format
      const sdWhole = Math.floor(sd);
      const sdFrac = Math.round((sd - sdWhole) * 10);
      return [
        `BBU_${p}_${sdWhole}_${sdFrac}`,
        `BBM_${p}_${sdWhole}_${sdFrac}`,
        `BBL_${p}_${sdWhole}_${sdFrac}`,
      ];
    }
    case 'rsi': return `RSI_${params.period}`;
    case 'macd': {
      const f = params.fastPeriod;
      const s = params.slowPeriod;
      const sig = params.signalPeriod;
      return [
        `MACD_${f}_${s}_${sig}`,
        `MACDs_${f}_${s}_${sig}`,
        `MACDh_${f}_${s}_${sig}`,
      ];
    }
    case 'stochastic': {
      const k = params.kPeriod;
      const ks = params.kSmooth;
      const ds = params.dSmooth;
      return [
        `STOCHk_${k}_${ks}_${ds}`,
        `STOCHd_${k}_${ks}_${ds}`,
      ];
    }
    case 'cci': return `CCI_${params.period}`;
    case 'willr': return `WILLR_${params.period}`;
    case 'momentum': return `MOM_${params.period}`;
    case 'roc': return `ROC_${params.period}`;
    case 'stochrsi': {
      const rp = params.rsiPeriod;
      const sp = params.stochPeriod;
      const ks = params.kSmooth;
      const ds = params.dSmooth;
      return [
        `STOCHRSIk_${rp}_${sp}_${ks}_${ds}`,
        `STOCHRSId_${rp}_${sp}_${ks}_${ds}`,
      ];
    }
    case 'atr': return `ATR_${params.period}`;
    case 'trange': return 'TRANGE';
    case 'obv': return 'OBV';
    case 'ad': return 'AD';
    case 'mfi': return `MFI_${params.period}`;
    case 'adx': {
      const p = params.period;
      return [
        `ADX_${p}`,
        `PLUS_DI_${p}`,
        `MINUS_DI_${p}`,
      ];
    }
    case 'aroon': {
      const p = params.period;
      return [
        `AROON_UP_${p}`,
        `AROON_DOWN_${p}`,
      ];
    }
    default:
      return indicatorId.toUpperCase();
  }
}

/** Map indicator output keys to column name patterns */
function getOutputColumnMap(indicatorId: string, params: Record<string, number>): Record<string, string> {
  switch (indicatorId) {
    case 'bbands': {
      const p = params.period;
      const sd = params.stdDev ?? 2.0;
      const sdWhole = Math.floor(sd);
      const sdFrac = Math.round((sd - sdWhole) * 10);
      return {
        upper: `BBU_${p}_${sdWhole}_${sdFrac}`,
        middle: `BBM_${p}_${sdWhole}_${sdFrac}`,
        lower: `BBL_${p}_${sdWhole}_${sdFrac}`,
      };
    }
    case 'macd': {
      const f = params.fastPeriod;
      const s = params.slowPeriod;
      const sig = params.signalPeriod;
      return {
        macd: `MACD_${f}_${s}_${sig}`,
        signal: `MACDs_${f}_${s}_${sig}`,
        histogram: `MACDh_${f}_${s}_${sig}`,
      };
    }
    case 'stochastic': {
      const k = params.kPeriod;
      const ks = params.kSmooth;
      const ds = params.dSmooth;
      return {
        k: `STOCHk_${k}_${ks}_${ds}`,
        d: `STOCHd_${k}_${ks}_${ds}`,
      };
    }
    case 'stochrsi': {
      const rp = params.rsiPeriod;
      const sp = params.stochPeriod;
      const ks = params.kSmooth;
      const ds = params.dSmooth;
      return {
        k: `STOCHRSIk_${rp}_${sp}_${ks}_${ds}`,
        d: `STOCHRSId_${rp}_${sp}_${ks}_${ds}`,
      };
    }
    case 'adx': {
      const p = params.period;
      return {
        adx: `ADX_${p}`,
        plusDI: `PLUS_DI_${p}`,
        minusDI: `MINUS_DI_${p}`,
      };
    }
    case 'aroon': {
      const p = params.period;
      return {
        up: `AROON_UP_${p}`,
        down: `AROON_DOWN_${p}`,
      };
    }
    default:
      return {};
  }
}

// ─── Direct calculators for indicators not in the legacy dispatch ────────────

/** Convert epoch-ms timestamp to epoch-seconds for lightweight-charts */
function toTimeSec(ts: number): number {
  return ts > 1e12 ? Math.floor(ts / 1000) : ts;
}

/** VWAP computed from OHLCV bars (resets daily by default) */
function computeVWAP(bars: OHLCVBar[]): { time: number; value: number }[] {
  const points: { time: number; value: number }[] = [];
  let cumulVolume = 0;
  let cumulTPV = 0;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    const tp = (b.high + b.low + b.close) / 3;
    cumulVolume += b.volume;
    cumulTPV += tp * b.volume;

    if (cumulVolume > 0) {
      points.push({
        time: toTimeSec(b.timestamp),
        value: cumulTPV / cumulVolume,
      });
    }
  }
  return points;
}

/** Parabolic SAR with configurable step/max params */
function computePSAR(
  bars: OHLCVBar[],
  afStep: number,
  afMax: number,
): { time: number; value: number }[] {
  const n = bars.length;
  if (n < 2) return [];

  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const closes = bars.map(b => b.close);
  const result: (number | null)[] = new Array(n).fill(null);

  let isLong = closes[1]! > closes[0]!;
  let af = afStep;
  let ep = isLong ? highs[0]! : lows[0]!;
  let sar = isLong ? lows[0]! : highs[0]!;
  result[0] = sar;

  for (let i = 1; i < n; i++) {
    const prevSar = sar;
    sar = prevSar + af * (ep - prevSar);

    if (isLong) {
      if (i >= 2) sar = Math.min(sar, lows[i - 1]!, lows[i - 2]!);
      else sar = Math.min(sar, lows[i - 1]!);

      if (lows[i]! < sar) {
        isLong = false;
        sar = ep;
        ep = lows[i]!;
        af = afStep;
      } else {
        if (highs[i]! > ep) {
          ep = highs[i]!;
          af = Math.min(af + afStep, afMax);
        }
      }
    } else {
      if (i >= 2) sar = Math.max(sar, highs[i - 1]!, highs[i - 2]!);
      else sar = Math.max(sar, highs[i - 1]!);

      if (highs[i]! > sar) {
        isLong = true;
        sar = ep;
        ep = highs[i]!;
        af = afStep;
      } else {
        if (lows[i]! < ep) {
          ep = lows[i]!;
          af = Math.min(af + afStep, afMax);
        }
      }
    }
    result[i] = sar;
  }

  const points: { time: number; value: number }[] = [];
  for (let i = 0; i < n; i++) {
    const v = result[i];
    if (v !== null && v !== undefined && !isNaN(v) && isFinite(v)) {
      points.push({ time: toTimeSec(bars[i]!.timestamp), value: v });
    }
  }
  return points;
}

/**
 * Compute all outputs for an active indicator instance.
 */
export function computeIndicator(
  indicator: ActiveIndicator,
  bars: OHLCVBar[],
): ComputedIndicator | null {
  if (bars.length === 0) return null;

  const def = getIndicatorDefinition(indicator.indicatorId);
  if (!def) return null;

  // ── Special-case: indicators that need direct computation ──
  if (indicator.indicatorId === 'vwap') {
    const data = computeVWAP(bars);
    if (data.length === 0) return null;
    return {
      instanceId: indicator.instanceId,
      indicatorId: indicator.indicatorId,
      displayType: 'overlay',
      outputs: [{
        outputKey: 'value',
        label: 'VWAP',
        data,
        style: 'line',
      }],
    };
  }

  if (indicator.indicatorId === 'psar') {
    const step = indicator.params.step ?? 0.02;
    const max = indicator.params.max ?? 0.2;
    const data = computePSAR(bars, step, max);
    if (data.length === 0) return null;
    return {
      instanceId: indicator.instanceId,
      indicatorId: indicator.indicatorId,
      displayType: 'overlay',
      outputs: [{
        outputKey: 'value',
        label: 'SAR',
        data,
        style: 'line',
      }],
    };
  }

  const columns = buildColumnName(indicator.indicatorId, indicator.params);
  const isMultiOutput = Array.isArray(columns);
  const outputMap = getOutputColumnMap(indicator.indicatorId, indicator.params);

  const outputs: ComputedOutput[] = [];

  if (isMultiOutput) {
    // Multi-output indicator (MACD, BBands, Stochastic, ADX, Aroon)
    for (const output of def.outputs) {
      const colName = outputMap[output.key];
      if (!colName) continue;

      let data: { time: number; value: number }[] | null = null;

      if (def.renderType === 'overlay') {
        data = computeOverlay(colName, bars);
      } else {
        data = computeSubchart(colName, bars);
      }

      if (data && data.length > 0) {
        outputs.push({
          outputKey: output.key,
          label: output.label,
          data,
          style: output.style,
        });
      }
    }
  } else {
    // Single-output indicator
    let data: OverlayPoint[] | IndicatorPoint[] | null = null;

    if (def.renderType === 'overlay') {
      data = computeOverlay(columns, bars);
    } else {
      data = computeSubchart(columns, bars);
    }

    if (data && data.length > 0) {
      outputs.push({
        outputKey: def.outputs[0]?.key ?? 'value',
        label: def.outputs[0]?.label ?? def.name,
        data,
        style: def.outputs[0]?.style ?? 'line',
      });
    }
  }

  if (outputs.length === 0) return null;

  return {
    instanceId: indicator.instanceId,
    indicatorId: indicator.indicatorId,
    displayType: def.renderType,
    outputs,
  };
}

/**
 * Compute all active indicators against OHLCV bars.
 */
export function computeAllIndicators(
  indicators: ActiveIndicator[],
  bars: OHLCVBar[],
): ComputedIndicator[] {
  const results: ComputedIndicator[] = [];
  for (const ind of indicators) {
    if (!ind.visible) continue;
    const computed = computeIndicator(ind, bars);
    if (computed) results.push(computed);
  }
  return results;
}
