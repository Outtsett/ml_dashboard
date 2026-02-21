import Dexie, { Table } from 'dexie';

/**
 * Max bars to keep in IndexedDB per symbol+timeframe combo.
 * Beyond this, oldest bars are evicted inline during cacheBars().
 * This prevents unbounded growth from infinite scroll + prefetch.
 */
const MAX_BARS_PER_COMBO = 8000;

export interface OHLCVBar {
  id?: number;
  symbol: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timeframe: string;
}

export interface CacheMetadata {
  id?: number;
  symbol: string;
  timeframe: string;
  startTimestamp: number;
  endTimestamp: number;
  lastUpdated: number;
  expiresAt?: number;
}

export interface CacheConfig {
  defaultTTLMs: number;
  maxEntriesPerSymbol: number;
  maxTotalSizeMB: number;
  cleanupIntervalMs: number;
}

export interface UserPreference {
  key: string;
  value: any;
}

class QuantAIDatabase extends Dexie {
  ohlcv!: Table<OHLCVBar>;
  cacheMetadata!: Table<CacheMetadata>;
  preferences!: Table<UserPreference>;

  constructor() {
    super('QuantAI');
    
    this.version(1).stores({
      ohlcv: '++id, [symbol+timeframe+timestamp], [symbol+timeframe], symbol, timestamp',
      cacheMetadata: '++id, [symbol+timeframe], symbol',
      preferences: 'key'
    });
  }
}

export const db = new QuantAIDatabase();

export async function getCachedBars(
  symbol: string,
  timeframe: string,
  startTs: number,
  endTs: number
): Promise<OHLCVBar[]> {
  return db.ohlcv
    .where('[symbol+timeframe+timestamp]')
    .between([symbol, timeframe, startTs], [symbol, timeframe, endTs], true, true)
    .toArray();
}

export async function cacheBars(
  symbol: string,
  timeframe: string,
  bars: Omit<OHLCVBar, 'id' | 'symbol' | 'timeframe'>[]
): Promise<void> {
  if (bars.length === 0) return;
  
  const barsToCache: OHLCVBar[] = bars.map(bar => ({
    ...bar,
    symbol,
    timeframe
  }));

  await db.transaction('rw', [db.ohlcv, db.cacheMetadata], async () => {
    let minTs = Infinity;
    let maxTs = -Infinity;
    for (const bar of bars) {
      if (bar.timestamp < minTs) minTs = bar.timestamp;
      if (bar.timestamp > maxTs) maxTs = bar.timestamp;
    }
    
    // Fetch only keys (not full records) for much faster dedup lookup
    const existingKeys = await db.ohlcv
      .where('[symbol+timeframe+timestamp]')
      .between([symbol, timeframe, minTs], [symbol, timeframe, maxTs], true, true)
      .keys();
    
    // Extract timestamps from compound keys [symbol, timeframe, timestamp]
    const existingTimestamps = new Set(
      existingKeys.map(k => (k as unknown as [string, string, number])[2])
    );
    const newBars = barsToCache.filter(bar => !existingTimestamps.has(bar.timestamp));
    
    if (newBars.length > 0) {
      await db.ohlcv.bulkAdd(newBars);
    }

    // --- Inline eviction: cap this symbol+timeframe combo ---
    const totalCount = await db.ohlcv
      .where('[symbol+timeframe]')
      .equals([symbol, timeframe])
      .count();

    if (totalCount > MAX_BARS_PER_COMBO) {
      const excess = totalCount - MAX_BARS_PER_COMBO;
      // Get the oldest bars by timestamp, delete them
      const oldestBars = await db.ohlcv
        .where('[symbol+timeframe+timestamp]')
        .between([symbol, timeframe, Dexie.minKey], [symbol, timeframe, Dexie.maxKey])
        .limit(excess)
        .primaryKeys();
      if (oldestBars.length > 0) {
        await db.ohlcv.bulkDelete(oldestBars);
      }
    }

    // Update metadata — recompute actual range after eviction
    const firstBar = await db.ohlcv
      .where('[symbol+timeframe+timestamp]')
      .between([symbol, timeframe, Dexie.minKey], [symbol, timeframe, Dexie.maxKey])
      .first();
    const lastBar = await db.ohlcv
      .where('[symbol+timeframe+timestamp]')
      .between([symbol, timeframe, Dexie.minKey], [symbol, timeframe, Dexie.maxKey])
      .last();

    const actualMin = firstBar?.timestamp ?? minTs;
    const actualMax = lastBar?.timestamp ?? maxTs;

    const existing = await db.cacheMetadata
      .where('[symbol+timeframe]')
      .equals([symbol, timeframe])
      .first();

    if (existing) {
      await db.cacheMetadata.update(existing.id!, {
        startTimestamp: actualMin,
        endTimestamp: actualMax,
        lastUpdated: Date.now()
      });
    } else {
      await db.cacheMetadata.add({
        symbol,
        timeframe,
        startTimestamp: actualMin,
        endTimestamp: actualMax,
        lastUpdated: Date.now()
      });
    }
  });
}

export async function getCacheRange(
  symbol: string,
  timeframe: string
): Promise<{ start: number; end: number } | null> {
  const meta = await db.cacheMetadata
    .where('[symbol+timeframe]')
    .equals([symbol, timeframe])
    .first();

  if (!meta) return null;
  return { start: meta.startTimestamp, end: meta.endTimestamp };
}

export async function isCacheStale(
  symbol: string,
  timeframe: string,
  maxAgeMs: number = 5 * 60 * 1000
): Promise<boolean> {
  const meta = await db.cacheMetadata
    .where('[symbol+timeframe]')
    .equals([symbol, timeframe])
    .first();

  if (!meta) return true;
  return Date.now() - meta.lastUpdated > maxAgeMs;
}

export async function clearSymbolCache(symbol: string): Promise<void> {
  await db.transaction('rw', [db.ohlcv, db.cacheMetadata], async () => {
    await db.ohlcv.where('symbol').equals(symbol).delete();
    await db.cacheMetadata.where('symbol').equals(symbol).delete();
  });
}

export async function clearAllCache(): Promise<void> {
  await db.transaction('rw', [db.ohlcv, db.cacheMetadata], async () => {
    await db.ohlcv.clear();
    await db.cacheMetadata.clear();
  });
}

export async function getCacheStats(): Promise<{
  totalBars: number;
  symbols: number;
  sizeEstimate: string;
  sizeBytes: number;
  combos: { key: string; count: number }[];
}> {
  const totalBars = await db.ohlcv.count();
  const allMeta = await db.cacheMetadata.toArray();
  const symbols = allMeta.length;
  const sizeBytes = totalBars * 64;

  let sizeEstimate: string;
  if (sizeBytes < 1024) sizeEstimate = `${sizeBytes} B`;
  else if (sizeBytes < 1024 * 1024) sizeEstimate = `${(sizeBytes / 1024).toFixed(1)} KB`;
  else sizeEstimate = `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;

  // Breakdown by symbol+timeframe combo (fast: count per combo)
  const combos: { key: string; count: number }[] = [];
  for (const meta of allMeta) {
    const count = await db.ohlcv
      .where('[symbol+timeframe]')
      .equals([meta.symbol, meta.timeframe])
      .count();
    combos.push({ key: `${meta.symbol}@${meta.timeframe}m`, count });
  }

  return { totalBars, symbols, sizeEstimate, sizeBytes, combos };
}

export async function getPreference<T>(key: string, defaultValue: T): Promise<T> {
  const pref = await db.preferences.get(key);
  return pref ? pref.value : defaultValue;
}

export async function setPreference<T>(key: string, value: T): Promise<void> {
  await db.preferences.put({ key, value });
}

export async function prefetchAdjacentData(
  symbol: string,
  timeframe: string,
  currentStart: number,
  currentEnd: number,
  fetchFn: (start: number, end: number) => Promise<Omit<OHLCVBar, 'id' | 'symbol' | 'timeframe'>[]>
): Promise<void> {
  const range = currentEnd - currentStart;
  const prefetchBefore = currentStart - range;
  const prefetchAfter = currentEnd + range;

  const cacheRange = await getCacheRange(symbol, timeframe);
  
  const promises: Promise<void>[] = [];

  if (!cacheRange || prefetchBefore < cacheRange.start) {
    promises.push(
      fetchFn(prefetchBefore, currentStart - 1)
        .then(bars => cacheBars(symbol, timeframe, bars))
        .catch(() => {})
    );
  }

  if (!cacheRange || prefetchAfter > cacheRange.end) {
    promises.push(
      fetchFn(currentEnd + 1, prefetchAfter)
        .then(bars => cacheBars(symbol, timeframe, bars))
        .catch(() => {})
    );
  }

  await Promise.all(promises);
}
