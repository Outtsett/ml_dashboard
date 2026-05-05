/**
 * Symbols catalog cache — caches the QuestDB `symbols` table (904 rows).
 *
 * 1-hour TTL. Warmed on server startup.
 */

import { checkQuestDBHealth, queryQuestDB } from '../database/questdb';

let symbolsCatalogCache: { data: any[]; expiry: number } | null = null;
const SYMBOLS_CATALOG_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Stats ──────────────────────────────────────────────────
let symbolsStats = { hits: 0, misses: 0 };

/** Clear the symbol catalog cache. Used by /api/cache/clear. */
export function clearSymbolsCatalogCache(): void {
  symbolsCatalogCache = null;
  symbolsStats = { hits: 0, misses: 0 };
}

/** Get the cached symbols catalog, or null if expired/missing. */
export function getSymbolsCatalogCache(): { data: any[]; expiry: number } | null {
  if (symbolsCatalogCache && Date.now() < symbolsCatalogCache.expiry) {
    symbolsStats.hits++;
    return symbolsCatalogCache;
  }
  symbolsStats.misses++;
  return null;
}

/** Set the symbols catalog cache with the standard TTL. */
export function setSymbolsCatalogCache(data: any[]): void {
  symbolsCatalogCache = { data, expiry: Date.now() + SYMBOLS_CATALOG_TTL_MS };
}

/** Get symbols catalog cache stats. */
export function getSymbolsCacheStats(): {
  hits: number;
  misses: number;
  entries: number;
  hitRate: string;
  symbolCount: number;
} {
  const total = symbolsStats.hits + symbolsStats.misses;
  const hitRate = total > 0 ? ((symbolsStats.hits / total) * 100).toFixed(1) + '%' : '0.0%';
  return {
    hits: symbolsStats.hits,
    misses: symbolsStats.misses,
    entries: symbolsCatalogCache ? 1 : 0,
    hitRate,
    symbolCount: symbolsCatalogCache?.data.length ?? 0,
  };
}

/**
 * Warm the symbols catalog cache on server startup.
 * Fire-and-forget — failures are logged but don't block startup.
 */
export async function warmSymbolsCatalog(): Promise<void> {
  try {
    const healthy = await checkQuestDBHealth();
    if (!healthy) {
      console.log('[cache-warm] QuestDB not healthy, skipping symbol catalog warm');
      return;
    }

    const symbols = await queryQuestDB(`
      SELECT symbol, asset_class, root
      FROM symbols
      ORDER BY symbol
    `);
    const result = symbols.map((s: any) => ({
      symbol: s.symbol,
      asset_class: s.asset_class,
      root: s.root,
    }));

    symbolsCatalogCache = { data: result, expiry: Date.now() + SYMBOLS_CATALOG_TTL_MS };
    console.log(`[cache-warm] Symbol catalog warmed: ${result.length} symbols`);
  } catch (err: any) {
    console.warn(`[cache-warm] Failed to warm symbol catalog: ${err.message}`);
  }
}
