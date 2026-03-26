/**
 * Symbols catalog cache — caches the QuestDB `symbols` table (904 rows).
 *
 * 1-hour TTL. Warmed on server startup.
 */

import { checkQuestDBHealth, queryQuestDB } from '../database/questdb';

let symbolsCatalogCache: { data: any[]; expiry: number } | null = null;
const SYMBOLS_CATALOG_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Clear the symbol catalog cache. Used by /api/cache/clear. */
export function clearSymbolsCatalogCache(): void {
  symbolsCatalogCache = null;
}

/** Get the cached symbols catalog, or null if expired/missing. */
export function getSymbolsCatalogCache(): { data: any[]; expiry: number } | null {
  if (symbolsCatalogCache && Date.now() < symbolsCatalogCache.expiry) {
    return symbolsCatalogCache;
  }
  return null;
}

/** Set the symbols catalog cache with the standard TTL. */
export function setSymbolsCatalogCache(data: any[]): void {
  symbolsCatalogCache = { data, expiry: Date.now() + SYMBOLS_CATALOG_TTL_MS };
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
