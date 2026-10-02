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

/**
 * Browser detectors that can stand in for a lake pattern, keyed by lake column.
 *
 * The lake copy is preferred, but its coverage is PARTIAL: `talib_candle_patterns`
 * spans 2025-09-30 to 2025-12-30 on 1m/5m/15m only, while the bars run 2024-03 to
 * 2026-03 across seven timeframes. Outside that window every lake pattern returns
 * zero rows, which left the chart drawing only the two browser-only detectors
 * even with all 63 patterns selected.
 *
 * So a selected pattern the lake cannot answer falls back to the equivalent
 * browser detector rather than silently drawing nothing. A directional pair maps
 * to BOTH of its splits, because TA-Lib's `engulfing` is one signed series while
 * the browser has a bullish and a bearish detector, and direction has to survive
 * the fallback.
 *
 * This is a stopgap for partial coverage, not a second source of truth. Widening
 * the serving layer so the lake answers every timeframe over the full span is the
 * real fix.
 */
export const BROWSER_DETECTORS_FOR_LAKE_PATTERN: Record<string, string[]> =
  buildFallbackMap();

function buildFallbackMap(): Record<string, string[]> {
  const detectorsByNormalizedName = new Map<string, string[]>();
  const add = (key: string, detectorName: string) => {
    const existing = detectorsByNormalizedName.get(key);
    if (existing) {
      if (!existing.includes(detectorName)) existing.push(detectorName);
    } else {
      detectorsByNormalizedName.set(key, [detectorName]);
    }
  };

  for (const detector of CANDLE_PATTERN_CATALOG) {
    add(normalizeName(detector.name), detector.name);
  }
  // A directional split also covers its TA-Lib parent.
  for (const [detectorName, parent] of Object.entries(DIRECTIONAL_SPLIT_ALIASES)) {
    add(normalizeName(parent), detectorName);
  }

  const map: Record<string, string[]> = {};
  for (const pattern of TALIB_PATTERN_CATALOG) {
    const detectors = detectorsByNormalizedName.get(normalizeName(pattern.name));
    if (detectors && detectors.length > 0) {
      map[talibPatternColumn(pattern.name)] = detectors;
    }
  }
  return map;
}

/**
 * How many bars a pattern's rule reads, keyed by selection column.
 *
 * The distinction the name hides: only 13 of the 61 read a single bar. A
 * one-bar rule is a statement about that candle's own shape; a three-bar rule
 * is a statement about a sequence, which is why the picker lets you narrow to
 * one group at a time instead of drowning the chart in all of them at once.
 */
export const BARS_READ_BY_COLUMN: Record<string, number> = Object.fromEntries(
  CANDLE_PATTERNS.map(pattern => [pattern.column, pattern.candleCount]),
);

/**
 * What KIND of claim the pattern makes, keyed by selection column.
 *
 * 'reversal' says the move should turn, 'continuation' says it should carry on,
 * 'indecision' says neither side won this bar, and 'colour_line' is a plain
 * statement about body size and direction. That distinction changes what the
 * label means far more than the pattern's name does, which is why it is drawn
 * on the chart beside it.
 */
export const PATTERN_TYPE_BY_COLUMN: Record<string, string> = buildPatternTypeMap();

function buildPatternTypeMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pattern of TALIB_PATTERN_CATALOG) {
    map[talibPatternColumn(pattern.name)] = pattern.patternType;
  }
  // A browser detector inherits the type of the TA-Lib pattern it stands in
  // for, so a fallback label reads the same as the lake one it replaced.
  for (const [lakeColumn, detectors] of Object.entries(BROWSER_DETECTORS_FOR_LAKE_PATTERN)) {
    const type = map[lakeColumn];
    if (!type) continue;
    for (const detector of detectors) {
      if (!map[detector]) map[detector] = type;
    }
  }
  // Tweezer top and bottom have no TA-Lib function to inherit from. Both are
  // reversal patterns by definition: a matched high or low that stops a move.
  for (const detector of CANDLE_PATTERN_CATALOG) {
    if (!map[detector.name]) map[detector.name] = 'reversal';
  }
  return map;
}

/** 'colour_line' reads badly on a chart; everything else is already a word. */
function readablePatternType(type: string): string {
  return type === 'colour_line' ? 'body' : type;
}

/**
 * The text drawn on the chart: the pattern's name and what kind of claim it is.
 *
 * The old label carried "(TA-Lib)" to mark the source, which told you where the
 * number came from but nothing about what it meant. The type is the more useful
 * parenthetical, and the source is still shown per row in the picker.
 */
export function chartLabelForColumn(column: string, displayName: string): string {
  const cleaned = displayName.replace(/\s*\(TA-Lib\)\s*$/, '');
  const type = PATTERN_TYPE_BY_COLUMN[column];
  return type ? `${cleaned} (${readablePatternType(type)})` : cleaned;
}

/** The true single-bar patterns, for the quick pick. */
export const SINGLE_CANDLE_PATTERN_COLUMNS: string[] = CANDLE_PATTERNS
  .filter(p => p.candleCount === 1)
  .map(p => p.column);
