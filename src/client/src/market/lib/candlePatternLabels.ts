/**
 * The 61 TA-Lib candlestick patterns, presented as label generators.
 *
 * A candlestick pattern IS a label on a candle — it says "this bar is a hammer"
 * the same way a direction generator says "this bar went up". So the patterns
 * belong in the label picker beside the other generators, not in the indicator
 * dropdown next to moving averages, which are lines drawn through prices rather
 * than statements about individual bars.
 *
 * Selection is one at a time, which the label picker already enforces by being
 * single-select. Turning all 61 on at once buried the candles under a wall of
 * overlapping pills; one pattern at a time is readable and is how the patterns
 * are actually used.
 *
 * Markers come from `/api/charts/candle-patterns`, which runs the real TA-Lib C
 * library over the bars on screen. They are not read from a table and not
 * approximated in the browser: measured against TA-Lib on 500 MNQ daily bars,
 * the browser detectors agreed on only 33% of firings.
 */
import { TALIB_PATTERN_CATALOG } from '@/market/lib/talibPatternCatalog';
import type { LabelGenerator } from '@/market/lib/useLabelOverlay';
import type { LabelMarker } from '@/market/components/types';

/**
 * Prefix marking a label generator that is a candlestick pattern.
 *
 * Keeps the pattern ids in their own namespace so a pattern can never collide
 * with a server-side generator id, and so the overlay hook can tell at a glance
 * which of the two preview paths a selection belongs to.
 */
export const CANDLE_PATTERN_LABEL_PREFIX = 'cdl:';

export function isCandlePatternGenerator(generatorType: string | null): boolean {
  return typeof generatorType === 'string' && generatorType.startsWith(CANDLE_PATTERN_LABEL_PREFIX);
}

export function candlePatternName(generatorType: string): string {
  return generatorType.slice(CANDLE_PATTERN_LABEL_PREFIX.length);
}

/** How the pattern type reads in the picker. */
const TYPE_LABEL: Record<string, string> = {
  reversal: 'reversal',
  continuation: 'continuation',
  indecision: 'indecision',
  colour_line: 'body',
};

/**
 * Grouped by how many candles the pattern reads, because that is the question
 * asked when hunting one: a three-bar morning star and a one-bar doji are
 * different kinds of thing to look for.
 */
function barGroup(candleCount: number): string {
  if (candleCount <= 1) return 'candles · single bar';
  if (candleCount === 2) return 'candles · two bar';
  if (candleCount === 3) return 'candles · three bar';
  return 'candles · four to five bar';
}

/**
 * The 61 patterns as label generators, sorted within each group by name.
 *
 * Built from the static catalog rather than the server's `/catalog` endpoint so
 * the picker is populated before any request resolves — the endpoint carries
 * TA-Lib's lookback, which matters when drawing, not when choosing.
 */
export const CANDLE_PATTERN_GENERATORS: LabelGenerator[] = TALIB_PATTERN_CATALOG
  .map(pattern => ({
    id: `${CANDLE_PATTERN_LABEL_PREFIX}${pattern.name}`,
    name: pattern.displayName,
    description:
      `${pattern.candleCount}-bar ${TYPE_LABEL[pattern.patternType] ?? pattern.patternType}` +
      ` · ${pattern.talibFunction}`,
    category: barGroup(pattern.candleCount),
    params: [],
  }))
  .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

interface CandlePatternResponse {
  patterns: { pattern: string; points: { time: number; value: number }[] }[];
  firingCount: number;
  barCount: number;
}

export interface CandlePatternMarkers {
  markers: LabelMarker[];
  /** Class counts keyed by the signed value, matching the label distribution shape. */
  distribution: Record<string, number>;
  barCount: number;
}

/**
 * Compute one pattern over a symbol/timeframe/range and return chart markers.
 *
 * `outcomeOffset` is 0 for every pattern: a candlestick pattern describes the
 * bar it completes on, unlike a forward-looking label that describes a bar some
 * horizon ahead. The marker therefore lands on the candle that fired it.
 */
export async function fetchCandlePatternMarkers(
  symbol: string,
  timeframeMinutes: number,
  generatorType: string,
  range: { start: number; end: number } | null,
  signal?: AbortSignal,
): Promise<CandlePatternMarkers> {
  const name = candlePatternName(generatorType);
  const bounds = range
    ? `&from=${Math.floor(range.start)}&to=${Math.ceil(range.end)}`
    : '';
  const url =
    `/api/charts/candle-patterns?symbol=${encodeURIComponent(symbol)}` +
    `&timeframe=${timeframeMinutes}&patterns=${encodeURIComponent(name)}${bounds}`;

  const response = await fetch(url, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? `Pattern compute failed (${response.status})`);

  const payload = body as CandlePatternResponse;
  const series = payload.patterns.find(p => p.pattern === name);
  const markers: LabelMarker[] = (series?.points ?? []).map(point => ({
    timestamp: point.time * 1000,
    label: point.value,
    outcomeOffset: 0,
    pattern: name,
  }));

  const distribution: Record<string, number> = {};
  for (const marker of markers) {
    const key = String(marker.label);
    distribution[key] = (distribution[key] ?? 0) + 1;
  }

  return { markers, distribution, barCount: payload.barCount ?? 0 };
}
