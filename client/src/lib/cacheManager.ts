import { db, getCacheStats, clearSymbolCache, OHLCVBar, CacheMetadata, CacheConfig } from './indexeddb';

const DEFAULT_CONFIG: CacheConfig = {
  defaultTTLMs: 24 * 60 * 60 * 1000,
  maxEntriesPerSymbol: 100000,
  maxTotalSizeMB: 100,
  cleanupIntervalMs: 60 * 1000
};

let config: CacheConfig = { ...DEFAULT_CONFIG };
let cleanupInterval: number | null = null;

export function setCacheConfig(newConfig: Partial<CacheConfig>): void {
  config = { ...config, ...newConfig };
  localStorage.setItem('cacheConfig', JSON.stringify(config));
}

export function getCacheConfig(): CacheConfig {
  const stored = localStorage.getItem('cacheConfig');
  if (stored) {
    try {
      config = { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    } catch (e) {
      config = { ...DEFAULT_CONFIG };
    }
  }
  return config;
}

export async function isEntryExpired(symbol: string, timeframe: string): Promise<boolean> {
  const meta = await db.cacheMetadata
    .where('[symbol+timeframe]')
    .equals([symbol, timeframe])
    .first();

  if (!meta) return true;
  
  const ttl = config.defaultTTLMs;
  const expiresAt = meta.expiresAt || (meta.lastUpdated + ttl);
  
  return Date.now() > expiresAt;
}

export async function cleanupExpiredEntries(): Promise<{ removed: number; symbols: string[] }> {
  const now = Date.now();
  const ttl = config.defaultTTLMs;
  const removedSymbols: string[] = [];
  let removedCount = 0;

  const allMeta = await db.cacheMetadata.toArray();
  
  for (const meta of allMeta) {
    const expiresAt = meta.expiresAt || (meta.lastUpdated + ttl);
    
    if (now > expiresAt) {
      await db.transaction('rw', [db.ohlcv, db.cacheMetadata], async () => {
        const deleted = await db.ohlcv
          .where('[symbol+timeframe]')
          .equals([meta.symbol, meta.timeframe])
          .delete();
        
        await db.cacheMetadata.delete(meta.id!);
        removedCount += deleted;
      });
      
      if (!removedSymbols.includes(meta.symbol)) {
        removedSymbols.push(meta.symbol);
      }
    }
  }

  return { removed: removedCount, symbols: removedSymbols };
}

export async function enforceMaxEntries(): Promise<{ trimmed: number; symbols: string[] }> {
  const trimmedSymbols: string[] = [];
  let totalTrimmed = 0;

  const allMeta = await db.cacheMetadata.toArray();
  
  for (const meta of allMeta) {
    const count = await db.ohlcv
      .where('[symbol+timeframe]')
      .equals([meta.symbol, meta.timeframe])
      .count();

    if (count > config.maxEntriesPerSymbol) {
      const excess = count - config.maxEntriesPerSymbol;
      
      const oldestEntries = await db.ohlcv
        .where('[symbol+timeframe]')
        .equals([meta.symbol, meta.timeframe])
        .sortBy('timestamp');

      const idsToDelete = oldestEntries.slice(0, excess).map(e => e.id!);

      await db.ohlcv.bulkDelete(idsToDelete);

      // Update metadata startTimestamp to reflect the new oldest remaining bar
      const remaining = oldestEntries.slice(excess);
      if (remaining.length > 0) {
        await db.cacheMetadata.update(meta.id!, { startTimestamp: remaining[0].timestamp });
      } else {
        await db.cacheMetadata.delete(meta.id!);
      }

      totalTrimmed += idsToDelete.length;
      if (!trimmedSymbols.includes(meta.symbol)) {
        trimmedSymbols.push(meta.symbol);
      }
    }
  }

  return { trimmed: totalTrimmed, symbols: trimmedSymbols };
}

export async function enforceTotalSizeLimit(): Promise<{ freedMB: number; clearedSymbols: string[] }> {
  const stats = await getCacheStats();
  const currentSizeMB = stats.sizeBytes / (1024 * 1024);

  if (currentSizeMB <= config.maxTotalSizeMB) {
    return { freedMB: 0, clearedSymbols: [] };
  }

  const allMeta = await db.cacheMetadata.orderBy('lastUpdated').toArray();
  const clearedSymbols: string[] = [];
  let freedMB = 0;
  
  for (const meta of allMeta) {
    if (currentSizeMB - freedMB <= config.maxTotalSizeMB * 0.8) {
      break;
    }

    const deleted = await db.ohlcv
      .where('[symbol+timeframe]')
      .equals([meta.symbol, meta.timeframe])
      .delete();

    await db.cacheMetadata.delete(meta.id!);
    
    const deletedMB = (deleted * 64) / (1024 * 1024);
    freedMB += deletedMB;
    clearedSymbols.push(`${meta.symbol}:${meta.timeframe}`);
  }

  return { freedMB, clearedSymbols };
}

export async function runCleanup(): Promise<{
  expired: { removed: number; symbols: string[] };
  trimmed: { trimmed: number; symbols: string[] };
  sizeEnforced: { freedMB: number; clearedSymbols: string[] };
}> {
  const expired = await cleanupExpiredEntries();
  const trimmed = await enforceMaxEntries();
  const sizeEnforced = await enforceTotalSizeLimit();

  console.log(`[CacheManager] Cleanup complete - expired: ${expired.removed}, trimmed: ${trimmed.trimmed}, freed: ${sizeEnforced.freedMB.toFixed(2)}MB`);

  return { expired, trimmed, sizeEnforced };
}

export function startAutoCleanup(): void {
  if (cleanupInterval !== null) return;
  
  getCacheConfig();
  
  cleanupInterval = window.setInterval(() => {
    runCleanup().catch(console.error);
  }, config.cleanupIntervalMs);
  
  console.log(`[CacheManager] Auto cleanup started (interval: ${config.cleanupIntervalMs}ms)`);
}

export function stopAutoCleanup(): void {
  if (cleanupInterval !== null) {
    window.clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('[CacheManager] Auto cleanup stopped');
  }
}

export async function getCacheHealth(): Promise<{
  totalBars: number;
  symbols: number;
  sizeEstimate: string;
  oldestEntry: Date | null;
  expiredCount: number;
  config: CacheConfig;
}> {
  const stats = await getCacheStats();
  const allMeta = await db.cacheMetadata.toArray();
  
  let oldestTimestamp = Infinity;
  let expiredCount = 0;
  const now = Date.now();
  const ttl = config.defaultTTLMs;

  for (const meta of allMeta) {
    if (meta.lastUpdated < oldestTimestamp) {
      oldestTimestamp = meta.lastUpdated;
    }
    
    const expiresAt = meta.expiresAt || (meta.lastUpdated + ttl);
    if (now > expiresAt) {
      expiredCount++;
    }
  }

  return {
    ...stats,
    oldestEntry: oldestTimestamp !== Infinity ? new Date(oldestTimestamp) : null,
    expiredCount,
    config
  };
}

export async function refreshCache(
  symbol: string,
  timeframe: string,
  fetchFn: () => Promise<OHLCVBar[]>
): Promise<{ updated: boolean; newBars: number }> {
  const isExpired = await isEntryExpired(symbol, timeframe);
  
  if (!isExpired) {
    return { updated: false, newBars: 0 };
  }

  await clearSymbolCache(symbol);
  
  const bars = await fetchFn();
  
  if (bars.length > 0) {
    let minTs = Infinity;
    let maxTs = -Infinity;
    for (const bar of bars) {
      if (bar.timestamp < minTs) minTs = bar.timestamp;
      if (bar.timestamp > maxTs) maxTs = bar.timestamp;
    }
    
    await db.transaction('rw', [db.ohlcv, db.cacheMetadata], async () => {
      await db.ohlcv.bulkAdd(bars);
      
      await db.cacheMetadata.add({
        symbol,
        timeframe,
        startTimestamp: minTs,
        endTimestamp: maxTs,
        lastUpdated: Date.now(),
        expiresAt: Date.now() + config.defaultTTLMs
      });
    });
  }

  return { updated: true, newBars: bars.length };
}
