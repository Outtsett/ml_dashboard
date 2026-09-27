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
  LABEL_MANIFEST_PATH,
} from '../../src/server/infrastructure/lib/labels/labelSetStore';
import {
  isTalibGenerator,
  talibPatternForGenerator,
  TALIB_NET_DIRECTION_GENERATOR,
} from '../../src/server/infrastructure/lib/labels/talibLabelRows';

describe('label set object paths', () => {
  it('lands under derived/<dataset>/recipe=<recipe>/table=labels/, the lake.layout convention', () => {
    expect(labelSetObjectPath('next_close_direction_MNQ_5m_0123456789ab')).toBe(
      's3://derived/labels/recipe=next_close_direction_MNQ_5m_0123456789ab/table=labels/part-0.parquet',
    );
    expect(LABEL_MANIFEST_PATH).toBe('s3://meta/ingest_manifests/labels.jsonl');
  });

  it('keeps a rejected set beside the glob, never inside it', () => {
    expect(labelSetObjectPath('direction_MNQ_1m_deadbeef0123', true)).toBe(
      's3://derived/labels/_rejected/recipe=direction_MNQ_1m_deadbeef0123/table=labels/part-0.parquet',
    );
  });

  it('refuses a recipe that is not a safe path segment', () => {
    expect(() => labelSetObjectPath('../etc')).toThrow(/not a safe object-path segment/);
    expect(() => labelSetObjectPath("x'y")).toThrow();
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
