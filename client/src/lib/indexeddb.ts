import Dexie, { Table } from 'dexie';

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
    
    const existingBars = await db.ohlcv
      .where('[symbol+timeframe+timestamp]')
      .between([symbol, timeframe, minTs], [symbol, timeframe, maxTs], true, true)
      .toArray();
    
    const existingTimestamps = new Set(existingBars.map(bar => bar.timestamp));
    const newBars = barsToCache.filter(bar => !existingTimestamps.has(bar.timestamp));
    
    if (newBars.length > 0) {
      await db.ohlcv.bulkAdd(newBars);
    }

    const existing = await db.cacheMetadata
      .where('[symbol+timeframe]')
      .equals([symbol, timeframe])
      .first();

    if (existing) {
      await db.cacheMetadata.update(existing.id!, {
        startTimestamp: Math.min(existing.startTimestamp, minTs),
        endTimestamp: Math.max(existing.endTimestamp, maxTs),
        lastUpdated: Date.now()
      });
    } else {
      await db.cacheMetadata.add({
        symbol,
        timeframe,
        startTimestamp: minTs,
        endTimestamp: maxTs,
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
}> {
  const totalBars = await db.ohlcv.count();
  const symbols = (await db.cacheMetadata.toArray()).length;
  const sizeBytes = totalBars * 64;

  let sizeEstimate: string;
  if (sizeBytes < 1024) sizeEstimate = `${sizeBytes} B`;
  else if (sizeBytes < 1024 * 1024) sizeEstimate = `${(sizeBytes / 1024).toFixed(1)} KB`;
  else sizeEstimate = `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;

  return { totalBars, symbols, sizeEstimate, sizeBytes };
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
