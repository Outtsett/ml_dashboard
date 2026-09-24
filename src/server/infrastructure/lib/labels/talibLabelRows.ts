/**
 * TA-Lib candlestick patterns as label rows, COMPUTED rather than looked up.
 *
 * The `talib_*` generators used to SELECT from `talib_candle_patterns`, a
 * materialized view that only ever carried 1m/5m/15m over a three-month window.
 * Any other timeframe came back empty and the label set said "nothing fired",
 * which is a different statement from "nothing was computed".
 *
 * This runs the real TA-Lib C library over the bars the request asks for, via
 * the resident worker `market/candlePatternService.ts` already owns, and shapes
 * the result exactly like a SQL generator's rows — `{timestamp, symbol, close,
 * label}` — so `previewLabels` and `generateLabels` treat it as one more source
 * of rows and everything downstream (distribution, persistence, markers) is
 * unchanged.
 */
import { getOHLCVSampleBy } from '../../database/questdb';
import {
  computeCandlePatterns,
  candlePatternCatalog,
  type PatternBar,
} from '../../../market/candlePatternService';
import { timeframeLabel } from './sqlLabelGenerators/talibCandlePattern';

export const TALIB_GENERATOR_PREFIX = 'talib_';
/** The aggregate generator: net direction of every pattern that fired on the bar. */
export const TALIB_NET_DIRECTION_GENERATOR = 'talib_candle_pattern';

export function isTalibGenerator(generatorType: string): boolean {
  return generatorType.startsWith(TALIB_GENERATOR_PREFIX);
}

/** Bare pattern name for a generator id, or `'any'` for the net-direction aggregate. */
export function talibPatternForGenerator(generatorType: string, params: Record<string, unknown>): string {
  if (generatorType === TALIB_NET_DIRECTION_GENERATOR) {
    const requested = String(params.pattern ?? 'any').trim().toLowerCase();
    return requested || 'any';
  }
  return generatorType.slice(TALIB_GENERATOR_PREFIX.length).toLowerCase();
}

export interface TalibLabelRowsRequest {
  symbol: string;
  timeframeMinutes: number;
  pattern: string;
  startTimestamp?: number;
  endTimestamp?: number;
  /** Bars to score when no window is given. */
  limit?: number;
}

export interface TalibLabelRow extends Record<string, unknown> {
  timestamp: number;
  symbol: string;
  close: number;
  /** Pattern value scaled by 1/100: ±1 for most, ±0.8 engulfing/harami, ±2 hikkake. `any` → sign of the sum. */
  label: number;
  pattern: string;
}

function toMillis(timestamp: Date | string | number): number {
  if (timestamp instanceof Date) return timestamp.getTime();
  if (typeof timestamp === 'number') return timestamp;
  return new Date(timestamp).getTime();
}

/**
 * Score bars with one pattern (or all 61 for `any`) and return label rows.
 *
 * Only bars where something fired become rows — TA-Lib emits 0 for "did not
 * fire", and a label set of mostly zeros says nothing a chart or a model wants.
 */
export async function computeTalibLabelRows(request: TalibLabelRowsRequest): Promise<TalibLabelRow[]> {
  const { symbol, timeframeMinutes, pattern } = request;
  const catalog = await candlePatternCatalog();
  const known = new Set(catalog.map(p => p.name));
  if (pattern !== 'any' && !known.has(pattern)) {
    throw new Error(
      `Unknown TA-Lib pattern '${pattern}'. TA-Lib defines ${catalog.length} candlestick patterns.`,
    );
  }

  const rows = await getOHLCVSampleBy(
    symbol,
    timeframeLabel(Math.max(1, Math.floor(timeframeMinutes))),
    request.startTimestamp,
    request.endTimestamp,
    request.limit ?? 5000,
  );

  const bars: PatternBar[] = rows
    .map(row => ({
      timestamp: toMillis((row as { timestamp: Date | string }).timestamp),
      open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close),
    }))
    .filter(b => [b.timestamp, b.open, b.high, b.low, b.close].every(Number.isFinite))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (bars.length === 0) return [];

  const computed = await computeCandlePatterns(bars, pattern === 'any' ? undefined : [pattern]);
  const closeByTime = new Map(bars.map(b => [Math.floor(b.timestamp / 1000), b.close]));

  if (pattern !== 'any') {
    return (computed.get(pattern) ?? []).map(point => ({
      timestamp: point.time * 1000,
      symbol,
      close: closeByTime.get(point.time) ?? NaN,
      label: point.value,
      pattern,
    }));
  }

  // Net direction: the sign of the summed signed values across every pattern
  // that fired on the bar. 0 means the firing patterns contradicted each other
  // exactly, which is a real state and is kept as a row.
  const net = new Map<number, number>();
  for (const points of computed.values()) {
    for (const point of points) net.set(point.time, (net.get(point.time) ?? 0) + point.value);
  }
  return [...net.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, sum]) => ({
      timestamp: time * 1000,
      symbol,
      close: closeByTime.get(time) ?? NaN,
      label: sum > 0 ? 1 : sum < 0 ? -1 : 0,
      pattern: 'any',
    }));
}
