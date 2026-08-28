/**
 * `cachedQuery` must collapse concurrent misses onto one query.
 *
 * Without this, every concurrent caller sees the same cache miss and launches
 * its own fetch. The query behind the front-month stitch scans `ohlcv` — 863M
 * rows, DAY-partitioned from 2010 to 2026, with no timestamp predicate, so it
 * touches every partition and takes 13-49s. A handful of overlapping chart
 * requests therefore ran a handful of simultaneous full-table scans, each
 * holding a QuestDB reader, until the reader pool was exhausted and QuestDB
 * answered `table busy [reason=pool size exceeded]`.
 *
 * Observed in one session: 93 executions of a query whose result is cached for
 * 60 minutes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cachedQuery, OHLCVCache, ohlcvCache } from '../src/server/infrastructure/cache/ohlcv';

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('cachedQuery single-flight', () => {
  beforeEach(() => {
    ohlcvCache.clear();
  });

  it('runs the fetcher once when many callers miss concurrently', async () => {
    const key = OHLCVCache.key('questdb', 'fm_MNQ', 'ranges_full', {});
    const gate = deferred<string[]>();
    let calls = 0;

    const fetcher = () => { calls++; return gate.promise; };
    const waiters = Array.from({ length: 10 }, () => cachedQuery(key, fetcher));

    gate.resolve(['MNQZ25', 'MNQH26']);
    const results = await Promise.all(waiters);

    expect(calls).toBe(1);
    for (const r of results) expect(r).toEqual(['MNQZ25', 'MNQH26']);
  });

  it('serves later callers from the cache, not a second fetch', async () => {
    const key = OHLCVCache.key('questdb', 'fm_ES', 'ranges_full', {});
    let calls = 0;
    const fetcher = async () => { calls++; return ['ESZ25']; };

    await cachedQuery(key, fetcher);
    await cachedQuery(key, fetcher);
    await cachedQuery(key, fetcher);

    expect(calls).toBe(1);
  });

  it('keeps distinct keys independent', async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return ['x']; };

    await Promise.all([
      cachedQuery(OHLCVCache.key('questdb', 'fm_MNQ', 'ranges_full', {}), fetcher),
      cachedQuery(OHLCVCache.key('questdb', 'fm_ES', 'ranges_full', {}), fetcher),
    ]);

    expect(calls).toBe(2);
  });

  /**
   * A failed query must not be remembered as in-flight, or the table stays
   * permanently unqueryable for that key after one transient timeout.
   */
  it('rejects every concurrent caller and then allows a retry', async () => {
    const key = OHLCVCache.key('questdb', 'fm_NQ', 'ranges_full', {});
    const gate = deferred<string[]>();
    let calls = 0;
    const failing = () => { calls++; return gate.promise; };

    const waiters = [cachedQuery(key, failing), cachedQuery(key, failing)];
    gate.reject(new Error('table busy [reason=pool size exceeded]'));

    await expect(Promise.all(waiters)).rejects.toThrow('table busy');
    expect(calls).toBe(1);

    // The failure must not be sticky.
    const after = await cachedQuery(key, async () => ['NQZ25']);
    expect(after).toEqual(['NQZ25']);
    expect(calls).toBe(1);
  });

  it('does not cache the rejection', async () => {
    const key = OHLCVCache.key('questdb', 'fm_YM', 'ranges_full', {});
    await expect(
      cachedQuery(key, async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(ohlcvCache.get(key)).toBeUndefined();
  });
});
