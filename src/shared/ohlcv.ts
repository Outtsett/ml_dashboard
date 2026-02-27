/**
 * Shared OHLCV type definitions — the single source of truth.
 *
 * Every layer (QuestDB, API routes, client components) should import
 * from here instead of declaring its own OHLCV interface.
 *
 * Field contract:
 *  - `timestamp` : epoch-ms number (never Date, never seconds-epoch)
 *  - `open/high/low/close` : number (floating point)
 *  - `volume` : number (floating point, summed across aggregations)
 *  - `symbol` : string (only in contexts where multi-symbol data is mixed)
 */

// ─── Core bar shape (what the API returns) ──────────────────

/** A single OHLCV candle as returned by every chart / data endpoint. */
export interface OHLCVBar {
  timestamp: number;   // epoch-ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** An OHLCV bar that also carries its symbol — used in multi-symbol contexts. */
export interface SymbolOHLCVBar extends OHLCVBar {
  symbol: string;
}

// ─── Database-layer row shapes ──────────────────────────────

/**
 * Shape of a raw QuestDB row from the `pg` driver.
 * `timestamp` is a Date object; numerics may be strings depending on driver version.
 */
export interface QuestDBOHLCVRow {
  symbol: string;
  timestamp: Date;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
}

// ─── Ingestion shape ────────────────────────────────────────

/** Shape expected by the ingestion pipeline (uploads, CSV import, sync). */
export interface OHLCVRecord {
  symbol: string;
  timestamp: number;  // epoch-ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Chart API response extras ──────────────────────────────

/** Extended bar returned by front-month / continuous-contract endpoints. */
export interface ContinuousOHLCVBar extends OHLCVBar {
  activeContract?: string;
}

// ─── Symbol stats (from /api/charts/symbols) ────────────────

export interface SymbolStats {
  symbol: string;
  row_count: number;
  first_bar: string;  // ISO date string
  last_bar: string;   // ISO date string
}
