/**
 * TA-Lib candle-pattern label generator.
 *
 * The assertions that matter here are the two that stop a marker landing on the
 * wrong candle: the timeframe filter, and the join back to the OHLCV source.
 * Everything else is SQL shape.
 */

import { describe, expect, it } from 'vitest';
import {
  generateTalibCandlePatternLabelsSQL,
  timeframeLabel,
  TALIB_PATTERN_TABLE,
} from '../src/server/infrastructure/lib/labels/sqlLabelGenerators/talibCandlePattern';
import { LABEL_SQL_GENERATORS } from '../src/server/infrastructure/lib/labels/sqlLabelGenerators';
import { getCategoryForGenerator } from '../src/server/infrastructure/lib/labels/labelGenerator';
import { LABEL_GENERATORS } from '../src/shared/mlTaxonomy';

const cfg = {
  symbol: 'MNQ',
  tableName: 'mnq_ohlcv_1m',
  timestampColumn: 'timestamp',
  symbolColumn: 'symbol',
  timeframeMinutes: 1,
};

describe('timeframeLabel', () => {
  it('matches the labels the ingest writes', () => {
    expect(timeframeLabel(1)).toBe('1m');
    expect(timeframeLabel(5)).toBe('5m');
    expect(timeframeLabel(15)).toBe('15m');
    expect(timeframeLabel(60)).toBe('1h');
    expect(timeframeLabel(240)).toBe('4h');
    expect(timeframeLabel(1440)).toBe('1d');
  });
});

describe('generateTalibCandlePatternLabelsSQL', () => {
  it('filters to the chart timeframe so patterns land on the bars that made them', () => {
    // The whole point of keying the table by timeframe: 1m patterns must never
    // be drawn under 5m candles, whose shape never triggered them.
    const oneMin = generateTalibCandlePatternLabelsSQL({ pattern: 'engulfing' }, cfg);
    expect(oneMin).toContain("timeframe = '1m'");
    expect(oneMin).not.toContain("timeframe = '5m'");

    const fiveMin = generateTalibCandlePatternLabelsSQL(
      { pattern: 'engulfing' },
      { ...cfg, tableName: 'mnq_ohlcv_5m', timeframeMinutes: 5 },
    );
    expect(fiveMin).toContain("timeframe = '5m'");
    expect(fiveMin).not.toContain("timeframe = '1m'");
  });

  it('joins the pattern rows to the OHLCV source rather than inventing a price', () => {
    const sql = generateTalibCandlePatternLabelsSQL({ pattern: 'hammer' }, cfg);
    expect(sql).toContain(TALIB_PATTERN_TABLE);
    expect(sql).toContain('FROM mnq_ohlcv_1m');
    expect(sql).toMatch(/JOIN bars b ON f\.timestamp = b\.timestamp/);
  });

  it("collapses to a sign for 'any' and passes the raw value through for one pattern", () => {
    const any = generateTalibCandlePatternLabelsSQL({ pattern: 'any' }, cfg);
    expect(any).toContain('WHEN sum(value) > 0 THEN 1');
    expect(any).not.toContain("AND pattern =");

    const one = generateTalibCandlePatternLabelsSQL({ pattern: 'engulfing' }, cfg);
    expect(one).toContain("AND pattern = 'engulfing'");
    expect(one).toContain('sum(value) as label');
    expect(one).not.toContain('WHEN sum(value) > 0');
  });

  it('defaults to the net-direction reading', () => {
    const sql = generateTalibCandlePatternLabelsSQL({}, cfg);
    expect(sql).toContain('WHEN sum(value) > 0 THEN 1');
  });

  it('accepts a name in any case but rejects anything that is not a bare name', () => {
    expect(() => generateTalibCandlePatternLabelsSQL({ pattern: 'ENGULFING' }, cfg)).not.toThrow();
    expect(generateTalibCandlePatternLabelsSQL({ pattern: 'ENGULFING' }, cfg))
      .toContain("pattern = 'engulfing'");

    for (const bad of ["a'b", 'has space', 'semi;colon', 'dash-name', '']) {
      expect(
        () => generateTalibCandlePatternLabelsSQL({ pattern: bad }, cfg),
        `expected '${bad}' to be rejected`,
      ).toThrow(/Invalid TA-Lib pattern name/);
    }
  });

  it('escapes a quote in the symbol rather than letting it close the literal', () => {
    const sql = generateTalibCandlePatternLabelsSQL({ pattern: 'any' }, { ...cfg, symbol: "M'NQ" });
    expect(sql).toContain("symbol = 'M''NQ'");
  });
});

describe('registration', () => {
  const named = [
    'engulfing', 'harami', 'haramicross', 'hikkake', 'belthold', 'marubozu',
    '3outside', '3inside', 'hammer', 'invertedhammer', 'hangingman',
    'shootingstar', 'morningstar', 'eveningstar', 'advanceblock', 'darkcloudcover',
  ];

  it('exposes the aggregate and every named pattern as its own generator', () => {
    expect(LABEL_SQL_GENERATORS).toHaveProperty('talib_candle_pattern');
    for (const n of named) {
      expect(LABEL_SQL_GENERATORS, `talib_${n} missing from the SQL registry`)
        .toHaveProperty(`talib_${n}`);
    }
  });

  it('binds each id to its own pattern', () => {
    // Separate ids exist because the overlay resolves params from their
    // declared defaults and has no per-param editor -- a single generator with
    // a dropdown would always resolve to the default and no individual pattern
    // would ever be selectable.
    const registry = LABEL_SQL_GENERATORS as unknown as Record<
      string,
      (p: Record<string, unknown>, c: typeof cfg) => string
    >;
    for (const n of named) {
      expect(registry[`talib_${n}`]!({}, cfg)).toContain(`AND pattern = '${n}'`);
    }
  });

  it('appears in the UI catalog with a matching id and its own category', () => {
    const catalog = LABEL_GENERATORS as unknown as Record<
      string,
      { id: string; category: string; params?: { id: string; default?: unknown }[] }
    >;
    for (const key of ['talib_candle_pattern', ...named.map(n => `talib_${n}`)]) {
      const entry = catalog[key];
      expect(entry, `${key} missing from LABEL_GENERATORS`).toBeDefined();
      expect(entry!.id).toBe(key);
      expect(entry!.category).toBe('candle-pattern');
      expect(getCategoryForGenerator(key)).toBe('candle-pattern');
    }
  });

  it('declares a pattern default, because the overlay sends defaults and nothing else', () => {
    const catalog = LABEL_GENERATORS as unknown as Record<
      string,
      { params?: { id: string; default?: unknown }[] }
    >;
    for (const n of named) {
      const param = catalog[`talib_${n}`]!.params?.find(p => p.id === 'pattern');
      expect(param, `talib_${n} declares no pattern param`).toBeDefined();
      expect(param!.default).toBe(n);
    }
    expect(catalog.talib_candle_pattern!.params?.find(p => p.id === 'pattern')?.default).toBe('any');
  });
});
