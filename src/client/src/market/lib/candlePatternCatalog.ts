import { TALIB_PATTERN_CATALOG } from '@/market/lib/talibPatternCatalog';
import { talibPatternColumn } from '@/market/lib/useTalibPatternOverlays';
import { CANDLE_PATTERN_CATALOG } from '@/market/lib/candle_patterns';

/**
 * One candlestick-pattern vocabulary for the indicator picker.
 *
 * The picker used to carry two sections, "Patterns" (60 TypeScript detectors
 * recomputed in the browser from the bars on screen) and "TA-Lib patterns" (61
 * names read back from the lake, the C library's own output). They overlap on 51
 * names, so the list read as two nearly-identical menus and it was not obvious
 * which one to use.
 *
 * They are merged here into a single list with ONE row per pattern, and the row
 * says which source backs it. Both sources still render through the same marker
 * pipeline, so nothing about drawing changes — only how the choice is presented.
 *
 * Which source wins, and why:
 *
 *   - 51 patterns exist in both. The lake copy wins. It is the C library's real
 *     output rather than a re-implementation, it is precomputed per bar rather
 *     than rescanned on every viewport change, and it covers the whole series
 *     instead of just the bars currently loaded.
 *   - 6 exist only in TA-Lib (harami cross, thrusting, tristar, unique three
 *     river, upside gap two crows, x-side gap three methods). Lake.
 *   - 2 exist only as browser detectors (tweezer top, tweezer bottom). Browser.
 *   - 7 browser detectors are DIRECTIONAL SPLITS of a TA-Lib pattern —
 *     CDL_ENGULFING_BULL/BEAR against TA-Lib's single `engulfing`, and so on.
 *     TA-Lib signs its value, so one merged row already carries both directions
 *     and the splits would be duplicate rows saying the same thing. They are
 *     listed in DIRECTIONAL_SPLIT_ALIASES and excluded.
 *
 * The two sources genuinely disagree on individual bars, which is why they were
 * kept apart originally. That disagreement has not gone away; it is now resolved
 * by always preferring the lake rather than by asking the reader to choose.
 */

export type CandlePatternSource = 'lake' | 'browser';

export interface CandlePatternEntry {
  /** The selection column: `talib:<name>` for lake, `CDL_*` for browser. */
  column: string;
  /** Human name, e.g. "Gravestone Doji". */
  displayName: string;
  /** Which implementation backs this row. */
  source: CandlePatternSource;
  /**
   * Bars the rule reads. 1 means a true single-candle pattern. Only known for
   * lake entries; browser detectors do not declare it, so they report 0.
   */
  candleCount: number;
}

/**
 * Browser detectors that are one direction of a TA-Lib pattern rather than a
 * pattern TA-Lib lacks. Keyed by detector name, valued by the TA-Lib name that
 * already covers both directions through the sign of its value.
 */
const DIRECTIONAL_SPLIT_ALIASES: Record<string, string> = {
  CDL_3INSIDE_UP: '3inside',
  CDL_3INSIDE_DOWN: '3inside',
  CDL_ENGULFING_BULL: 'engulfing',
  CDL_ENGULFING_BEAR: 'engulfing',
  CDL_HARAMI_BULL: 'harami',
  CDL_HARAMI_BEAR: 'harami',
  CDL_DARK_CLOUD: 'darkcloudcover',
};

/** `CDL_GRAVESTONE_DOJI` and `gravestonedoji` collapse to the same key. */
function normalizeName(name: string): string {
  const lower = name.toLowerCase();
  const stripped = lower.startsWith('cdl_')
    ? lower.slice(4)
    : lower.startsWith('cdl')
      ? lower.slice(3)
      : lower;
  return stripped.replace(/_/g, '');
}

function buildCatalog(): CandlePatternEntry[] {
  const entries: CandlePatternEntry[] = TALIB_PATTERN_CATALOG.map(pattern => ({
    column: talibPatternColumn(pattern.name),
    displayName: pattern.displayName,
    source: 'lake' as const,
    candleCount: pattern.candleCount,
  }));

  const covered = new Set(TALIB_PATTERN_CATALOG.map(pattern => normalizeName(pattern.name)));

  for (const detector of CANDLE_PATTERN_CATALOG) {
    const alias = DIRECTIONAL_SPLIT_ALIASES[detector.name];
    if (alias && covered.has(normalizeName(alias))) continue;
    if (covered.has(normalizeName(detector.name))) continue;
    entries.push({
      column: detector.name,
      displayName: detector.displayName,
      source: 'browser',
      candleCount: 0,
    });
  }

  return entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Every candlestick pattern the chart can draw, one row each. */
export const CANDLE_PATTERNS: CandlePatternEntry[] = buildCatalog();

/** Every selectable column, for a select-all. */
export const ALL_CANDLE_PATTERN_COLUMNS: string[] = CANDLE_PATTERNS.map(p => p.column);

/**
 * True when this selection column is a candlestick pattern from either source.
 *
 * Needed by the selector's clear/select-all so they only touch pattern columns
 * and leave any other selection alone.
 */
export function isCandlePatternColumn(column: string): boolean {
  return CANDLE_PATTERN_COLUMN_SET.has(column);
}

const CANDLE_PATTERN_COLUMN_SET = new Set(ALL_CANDLE_PATTERN_COLUMNS);

/** The true single-bar patterns, for the quick pick. */
export const SINGLE_CANDLE_PATTERN_COLUMNS: string[] = CANDLE_PATTERNS
  .filter(p => p.candleCount === 1)
  .map(p => p.column);
