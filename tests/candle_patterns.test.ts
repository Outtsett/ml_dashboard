import { describe, it, expect } from 'vitest';
import {
  timeframeLabel,
  parseTimeframe,
  parsePatterns,
} from '../src/server/market/candle_patterns.router';
import {
  TALIB_PATTERN_CATALOG,
  TALIB_SINGLE_CANDLE_PATTERNS,
  talibPatternDisplayName,
} from '../src/client/src/market/lib/talibPatternCatalog';

/**
 * The parsers guard a SQL string that interpolates pattern names, so their
 * rejection cases matter more than their happy path. Each negative test below
 * would be an injection point if the regex were relaxed.
 */
describe('candle pattern request parsing', () => {
  it('converts minutes to the label the ingest keyed rows by', () => {
    expect(timeframeLabel(1)).toBe('1m');
    expect(timeframeLabel(5)).toBe('5m');
    expect(timeframeLabel(60)).toBe('1h');
    expect(timeframeLabel(240)).toBe('4h');
    expect(timeframeLabel(1440)).toBe('1d');
  });

  it('accepts a timeframe as minutes or as a label', () => {
    expect(parseTimeframe('5')).toBe('5m');
    expect(parseTimeframe('5m')).toBe('5m');
    expect(parseTimeframe('4h')).toBe('4h');
    expect(parseTimeframe(undefined)).toBe('1m');
  });

  it('rejects a timeframe that is neither', () => {
    expect(() => parseTimeframe("1m'; DROP TABLE bars--")).toThrow(/Invalid timeframe/);
    expect(() => parseTimeframe('weekly')).toThrow(/Invalid timeframe/);
  });

  it('defaults to the 13 single-candle patterns when none are named', () => {
    expect(parsePatterns(undefined)).toEqual([...TALIB_SINGLE_CANDLE_PATTERNS]);
    expect(parsePatterns('')).toHaveLength(13);
    expect(parsePatterns('   ')).toHaveLength(13);
  });

  it('parses, lowercases and de-duplicates a named list', () => {
    expect(parsePatterns('doji,Engulfing, doji ')).toEqual(['doji', 'engulfing']);
    expect(parsePatterns('3whitesoldiers')).toEqual(['3whitesoldiers']);
  });

  it('rejects any name outside TA-Lib\'s own shape rather than escaping it', () => {
    expect(() => parsePatterns("doji'")).toThrow(/Invalid pattern name/);
    expect(() => parsePatterns("doji' OR 1=1--")).toThrow(/Invalid pattern name/);
    expect(() => parsePatterns('talib_doji')).toThrow(/Invalid pattern name/);
  });

  it('rejects a shape-valid name that is not one of the 61', () => {
    // `CDLDOJI` lowercases to `cdldoji`: harmless to interpolate, matches no row.
    // Without the vocabulary check the caller gets an empty chart and no reason.
    expect(() => parsePatterns('CDLDOJI')).toThrow(/Unknown TA-Lib pattern/);
    expect(() => parsePatterns('hammertime')).toThrow(/Unknown TA-Lib pattern/);
    expect(() => parsePatterns('doji,notapattern')).toThrow(/notapattern/);
  });

  it('accepts every name in the catalog', () => {
    const all = TALIB_PATTERN_CATALOG.map(p => p.name);
    expect(parsePatterns(all.join(','))).toHaveLength(61);
  });
});

describe('TA-Lib pattern catalog', () => {
  it('carries all 61 of TA-Lib 0.7.1\'s pattern functions, uniquely named', () => {
    expect(TALIB_PATTERN_CATALOG).toHaveLength(61);
    expect(new Set(TALIB_PATTERN_CATALOG.map(p => p.name)).size).toBe(61);
    expect(new Set(TALIB_PATTERN_CATALOG.map(p => p.talibFunction)).size).toBe(61);
  });

  it('splits by candle count the way the C source does: 13 / 19 / 21 / 4 / 4', () => {
    const byLength = new Map<number, number>();
    for (const entry of TALIB_PATTERN_CATALOG) {
      byLength.set(entry.candleCount, (byLength.get(entry.candleCount) ?? 0) + 1);
    }
    expect(byLength.get(1)).toBe(13);
    expect(byLength.get(2)).toBe(19);
    expect(byLength.get(3)).toBe(21);
    expect(byLength.get(4)).toBe(4);
    expect(byLength.get(5)).toBe(4);
  });

  it('keeps the single-candle list in step with the catalog', () => {
    const fromCatalog = TALIB_PATTERN_CATALOG
      .filter(p => p.candleCount === 1)
      .map(p => p.name)
      .sort();
    expect([...TALIB_SINGLE_CANDLE_PATTERNS].sort()).toEqual(fromCatalog);
  });

  it('classifies the hammer family as two-candle, because TA-Lib reads the prior bar', () => {
    // CDLHAMMER compares the body against inLow[i-1]; CDLSHOOTINGSTAR needs a gap
    // over inOpen/inClose[i-1]. Traders call all four one-candle patterns.
    for (const name of ['hammer', 'hangingman', 'invertedhammer', 'shootingstar']) {
      const entry = TALIB_PATTERN_CATALOG.find(p => p.name === name);
      expect(entry, `${name} missing from the catalog`).toBeDefined();
      expect(entry!.candleCount, `${name} should read 2 bars`).toBe(2);
      expect(TALIB_SINGLE_CANDLE_PATTERNS).not.toContain(name);
    }
  });

  it('names every pattern in words, and falls back to the bare name', () => {
    for (const entry of TALIB_PATTERN_CATALOG) {
      expect(talibPatternDisplayName(entry.name)).toBe(entry.displayName);
      expect(entry.displayName.length).toBeGreaterThan(0);
    }
    expect(talibPatternDisplayName('notapattern')).toBe('notapattern');
  });

  it('agrees with the lake: the server default and the client list are the same 13', () => {
    expect(parsePatterns(undefined).sort()).toEqual([...TALIB_SINGLE_CANDLE_PATTERNS].sort());
  });
});
