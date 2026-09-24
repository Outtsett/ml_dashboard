/**
 * Where a label set's rows land, and how TA-Lib generators are resolved.
 *
 * Both are pure: the object path is the contract every reader (chart, Python,
 * notebook) relies on, and the generator → pattern mapping decides what the
 * TA-Lib worker is asked to compute.
 */
import { describe, it, expect } from 'vitest';
import {
  labelSetObjectPath,
  labelSetManifestPath,
  LABEL_SET_RECIPE,
} from '../../src/server/infrastructure/lib/labels/labelSetStore';
import {
  isTalibGenerator,
  talibPatternForGenerator,
  TALIB_NET_DIRECTION_GENERATOR,
} from '../../src/server/infrastructure/lib/labels/talibLabelRows';

describe('label set object paths', () => {
  it('lands under the derived recipe in the hive layout the lake uses', () => {
    expect(labelSetObjectPath('next_close_direction', 7)).toBe(
      `s3://derived/recipe=${LABEL_SET_RECIPE}/table=next_close_direction/label_set_id=7/labels.parquet`,
    );
    expect(labelSetManifestPath(7)).toBe(`s3://meta/ingest_manifests/${LABEL_SET_RECIPE}/7.json`);
  });

  it('refuses a generator id that is not a safe path segment', () => {
    expect(() => labelSetObjectPath('../etc', 1)).toThrow(/not a safe object-path segment/);
    expect(() => labelSetObjectPath("x'y", 1)).toThrow();
  });
});

describe('TA-Lib generator resolution', () => {
  it('recognises the talib_* family and nothing else', () => {
    expect(isTalibGenerator('talib_engulfing')).toBe(true);
    expect(isTalibGenerator(TALIB_NET_DIRECTION_GENERATOR)).toBe(true);
    expect(isTalibGenerator('direction')).toBe(false);
    expect(isTalibGenerator('triple_barrier')).toBe(false);
  });

  it('maps a per-pattern generator to its bare pattern name', () => {
    expect(talibPatternForGenerator('talib_engulfing', {})).toBe('engulfing');
    expect(talibPatternForGenerator('talib_3outside', {})).toBe('3outside');
    expect(talibPatternForGenerator('talib_MorningStar', {})).toBe('morningstar');
  });

  it('lets the aggregate generator name a pattern, defaulting to the net direction', () => {
    expect(talibPatternForGenerator(TALIB_NET_DIRECTION_GENERATOR, {})).toBe('any');
    expect(talibPatternForGenerator(TALIB_NET_DIRECTION_GENERATOR, { pattern: ' Doji ' })).toBe('doji');
    expect(talibPatternForGenerator(TALIB_NET_DIRECTION_GENERATOR, { pattern: '' })).toBe('any');
  });
});
