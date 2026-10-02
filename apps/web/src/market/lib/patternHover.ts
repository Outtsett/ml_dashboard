/**
 * What the pattern hover card needs to know, computed without React.
 *
 * A TA-Lib pattern fires on the bar that COMPLETES it, but it is a statement
 * about the last N bars (N is the number of bars the C shape test reads). The
 * arrow therefore points at one candle while the pattern is several. Hovering
 * the arrow has to answer "which candles is this about, and what should they
 * look like?", which is three things:
 *
 *   - the window: the N pattern bars ending at the marker, plus a few bars
 *     before them so the prior trend the pattern depends on is visible;
 *   - the textbook drawing to compare against, for the direction that fired;
 *   - which marker on the chart is being hovered at all.
 */

import templatesFile from '@shared/candlePatternTemplates.json';
import { talibPattern, type TalibPatternEntry } from '@/market/lib/talibPatternCatalog';

// ── Types ──────────────────────────────────────────────────────────────────

/** One candle as the card draws it. Units are whatever the source uses. */
export interface MiniBar {
  time?: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type PatternDirection = 'bullish' | 'bearish' | 'neutral';

/** A textbook drawing of one pattern in one direction, proven to fire TA-Lib. */
export interface PatternTemplate {
  pattern: string;
  talibFunction: string;
  /** TA-Lib's raw output on the template's last bar, e.g. 100, -100, 80. */
  expectedValue: number;
  direction: PatternDirection;
  /** Bars before the pattern, oldest first. The last few show the prior trend. */
  context: MiniBar[];
  /** The pattern's own bars, oldest first; TA-Lib fires on the last one. */
  patternBars: MiniBar[];
  /** One plain-English line per pattern bar. */
  candleCaptions: string[];
  /** What the pattern says about buyers and sellers. */
  reading: string;
}

interface TemplatesFile {
  templates: {
    pattern: string;
    talib_function: string;
    expected_value: number;
    direction: PatternDirection;
    context: number[][];
    pattern_bars: number[][];
    candle_captions: string[];
    reading: string;
  }[];
}

export interface PatternWindow {
  /** Bars before the pattern, oldest first. Fewer than asked for near the left edge. */
  context: MiniBar[];
  /** The pattern's bars, oldest first, ending at the marker bar. */
  pattern: MiniBar[];
}

// ── Marker ids ─────────────────────────────────────────────────────────────

/**
 * Prefix on the id of every pattern marker.
 *
 * lightweight-charts hit-tests its markers and reports the hovered one's id as
 * `hoveredObjectId` on crosshair moves, so the id is how the chart says "the
 * pointer is on this arrow". The bar time is carried in the id so the hover
 * handler needs no lookup table.
 */
export const PATTERN_MARKER_PREFIX = 'cdl-marker:';

export function patternMarkerId(barTime: number): string {
  return `${PATTERN_MARKER_PREFIX}${barTime}`;
}

/** The bar time a pattern marker id names, or null for any other object. */
export function parsePatternMarkerId(id: unknown): number | null {
  if (typeof id !== 'string' || !id.startsWith(PATTERN_MARKER_PREFIX)) return null;
  const time = Number(id.slice(PATTERN_MARKER_PREFIX.length));
  return Number.isFinite(time) ? time : null;
}

// ── Direction ──────────────────────────────────────────────────────────────

/**
 * Patterns TA-Lib emits as a flag rather than a direction: always +100, and the
 * + means "fired", not "bullish". Takuri is a hammer variant that TA-Lib does
 * not sign either.
 */
const UNDIRECTED = new Set([
  'doji', 'dragonflydoji', 'gravestonedoji', 'longleggeddoji', 'rickshawman', 'takuri',
]);

/** How a firing reads, from the pattern and the sign TA-Lib gave it. */
export function patternDirection(pattern: string, value: number): PatternDirection {
  if (UNDIRECTED.has(pattern)) return 'neutral';
  return value >= 0 ? 'bullish' : 'bearish';
}

// ── Window ─────────────────────────────────────────────────────────────────

/** Bars drawn before the pattern, so the prior trend it depends on is visible. */
export const CONTEXT_BARS = 4;

/**
 * The pattern bars ending at `barTime`, plus up to `contextBars` before them.
 *
 * Found by INDEX in the chart's own bar list, not by stepping back
 * `candleCount * timeframe` in time: sessions have gaps, and TA-Lib read the
 * bars that exist, not the instants between them. Returns null when the marker
 * bar is not on the chart or the chart does not hold all N pattern bars.
 */
export function patternWindow(
  bars: MiniBar[],
  barTime: number,
  candleCount: number,
  contextBars: number = CONTEXT_BARS,
): PatternWindow | null {
  const index = lowerBoundByTime(bars, barTime);
  if (index >= bars.length || bars[index]!.time !== barTime) return null;
  const first = index - candleCount + 1;
  if (first < 0) return null;
  const contextStart = Math.max(0, first - contextBars);
  return {
    context: bars.slice(contextStart, first),
    pattern: bars.slice(first, index + 1),
  };
}

function lowerBoundByTime(bars: MiniBar[], time: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((bars[mid]!.time ?? -Infinity) < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ── Templates ──────────────────────────────────────────────────────────────

function toBar(row: number[]): MiniBar {
  return { open: row[0]!, high: row[1]!, low: row[2]!, close: row[3]! };
}

const TEMPLATES: PatternTemplate[] = (templatesFile as TemplatesFile).templates.map(t => ({
  pattern: t.pattern,
  talibFunction: t.talib_function,
  expectedValue: t.expected_value,
  direction: t.direction,
  context: t.context.map(toBar),
  patternBars: t.pattern_bars.map(toBar),
  candleCaptions: t.candle_captions,
  reading: t.reading,
}));

export function allPatternTemplates(): readonly PatternTemplate[] {
  return TEMPLATES;
}

/**
 * Where the pattern a hikkake confirmation confirms ends.
 *
 * TA-Lib emits +/-200 on the bar that confirms a hikkake, up to three bars
 * after the +/-100 pattern bar, in the same direction. The pattern's candles
 * end at that earlier bar, not at the confirmation. Null when no such firing
 * is on the chart.
 */
export function confirmedPatternTime(
  firings: { time: number; value: number }[],
  confirmationTime: number,
  confirmationValue: number,
  bars: MiniBar[],
): number | null {
  const index = lowerBoundByTime(bars, confirmationTime);
  if (index >= bars.length || bars[index]!.time !== confirmationTime) return null;
  const sign = Math.sign(confirmationValue);
  for (let back = 1; back <= 3 && index - back >= 0; back++) {
    const time = bars[index - back]!.time;
    if (firings.some(f => f.time === time && Math.abs(f.value) < 2 && Math.sign(f.value) === sign)) {
      return time ?? null;
    }
  }
  return null;
}

/**
 * The textbook drawing for a firing: same pattern, same direction.
 *
 * Falls back to the pattern's only template when the direction has none, which
 * is the undirected patterns' case (they have exactly one).
 */
export function templateFor(pattern: string, value: number): PatternTemplate | null {
  const direction = patternDirection(pattern, value);
  const own = TEMPLATES.filter(t => t.pattern === pattern);
  return own.find(t => t.direction === direction) ?? (own.length === 1 ? own[0]! : null);
}

// ── Card content ───────────────────────────────────────────────────────────

export interface PatternHoverInfo {
  entry: TalibPatternEntry;
  /** The bar the hovered arrow sits on. */
  barTime: number;
  /**
   * The bar the pattern completes on. Equal to `barTime` except for a hikkake
   * confirmation, which lands up to three bars after the pattern it confirms.
   */
  patternEndTime: number;
  /** The value the chart received: TA-Lib's output divided by 100. */
  value: number;
  direction: PatternDirection;
  /** True for hikkake's +/-2: a later bar confirming an earlier pattern bar. */
  isConfirmation: boolean;
  window: PatternWindow;
  template: PatternTemplate | null;
}

export function patternHoverInfo(
  pattern: string,
  value: number,
  barTime: number,
  bars: MiniBar[],
  patternEndTime: number = barTime,
): PatternHoverInfo | null {
  const entry = talibPattern(pattern);
  if (!entry) return null;
  const window = patternWindow(bars, patternEndTime, entry.candleCount);
  if (!window) return null;
  return {
    entry,
    barTime,
    patternEndTime,
    value,
    direction: patternDirection(pattern, value),
    isConfirmation: Math.abs(value) >= 2,
    window,
    template: templateFor(pattern, value),
  };
}
