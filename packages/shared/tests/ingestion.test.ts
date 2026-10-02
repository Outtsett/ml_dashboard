import { describe, it, expect } from 'vitest';
import { detectMapping, buildInsertSQL } from '../../../apps/api/infrastructure/lib/ingestion/standardize';

describe('detectMapping', () => {
  it('detects standard OHLCV columns', () => {
    const mapping = detectMapping(['timestamp', 'symbol', 'open', 'high', 'low', 'close', 'volume']);
    expect(mapping).not.toBeNull();
    expect(mapping!.ts).toBe('timestamp');
    expect(mapping!.symbol).toBe('symbol');
    expect(mapping!.open).toBe('open');
  });

  it('detects Databento ts_event format', () => {
    const mapping = detectMapping(['ts_event', 'instrument_id', 'open', 'high', 'low', 'close', 'volume']);
    expect(mapping).not.toBeNull();
    expect(mapping!.ts).toBe('ts_event');
    expect(mapping!.tsTransform).toBe('to_timestamp(ts_event / 1000000000)');
    expect(mapping!.symbol).toBe('instrument_id');
  });

  it('detects tick_volume as volume', () => {
    const mapping = detectMapping(['time', 'open', 'high', 'low', 'close', 'tick_volume']);
    expect(mapping).not.toBeNull();
    expect(mapping!.volume).toBe('tick_volume');
    expect(mapping!.ts).toBe('time');
  });

  it('returns null for unrecognizable columns', () => {
    const mapping = detectMapping(['foo', 'bar', 'baz']);
    expect(mapping).toBeNull();
  });

  it('returns null when OHLC columns are missing', () => {
    const mapping = detectMapping(['timestamp', 'open', 'high']);
    expect(mapping).toBeNull();
  });
});

describe('buildInsertSQL', () => {
  it('generates INSERT with symbol override', () => {
    const mapping = detectMapping(['timestamp', 'open', 'high', 'low', 'close', 'volume'])!;
    const sql = buildInsertSQL('E:/data/test.parquet', mapping, 'EURUSD');
    expect(sql).toContain("'EURUSD'");
    expect(sql).toContain("read_parquet('E:/data/test.parquet')");
    expect(sql).toContain('INSERT INTO ohlcv');
  });

  it('applies price scale divisor', () => {
    const mapping = detectMapping(['ts_event', 'instrument_id', 'open', 'high', 'low', 'close', 'volume'])!;
    const sql = buildInsertSQL('E:/data/test.parquet', mapping, 'MNQ', 1000000000);
    expect(sql).toContain('/ 1000000000');
  });

  it('converts backslashes to forward slashes in paths', () => {
    const mapping = detectMapping(['timestamp', 'open', 'high', 'low', 'close', 'volume'])!;
    const sql = buildInsertSQL('E:\\data\\test.parquet', mapping, 'MNQ');
    expect(sql).toContain("read_parquet('E:/data/test.parquet')");
    expect(sql).not.toContain('\\');
  });

  it('uses UNKNOWN when no symbol source available', () => {
    const mapping = detectMapping(['timestamp', 'open', 'high', 'low', 'close', 'volume'])!;
    const sql = buildInsertSQL('E:/data/test.parquet', mapping);
    expect(sql).toContain("'UNKNOWN'");
  });
});
