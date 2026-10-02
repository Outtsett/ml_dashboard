/**
 * Adaptive label source resolution.
 *
 * Label generators used to hardcode `FROM ohlcv WHERE symbol = '<X>'`. That is
 * wrong in two different ways depending on the instrument:
 *
 *   - Coverage. For a futures ROOT, `symbol = 'MNQ'` matches only the
 *     pre-stitched continuous series, which stops at 2025-12-30. The chart
 *     builds its continuous series from the individual contracts via
 *     `root = 'MNQ' AND asset_class = 'futures'`, which runs to 2026-03-27.
 *     Labels therefore ended three months before the bars they annotate.
 *
 *   - Cost. `ohlcv` is sub-minute (~3-second rows; 201M for the MNQ root), so
 *     every request re-aggregated tick data even when a pre-rolled table at the
 *     requested timeframe already existed.
 *
 * This module resolves both per (symbol, timeframe) by MEASURING what is
 * actually in the database rather than assuming a layout, so a symbol nobody
 * anticipated still resolves to its best available source.
 */

import { queryLake } from '../../database/lake';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LabelSource {
  /**
   * FROM target for the aggregation CTE: a bare table name, or a
   * parenthesised sub-select for front-month-stitched futures roots.
   */
  from: string;
  /** WHERE predicate selecting this instrument's rows out of `from`. */
  predicate: string;
  /** Table the resolver settled on (for logging and cache keys). */
  tableName: string;
  /** Native bar size of the source in minutes; 0 when sub-minute. */
  nativeMinutes: number;
  /** Measured coverage of this instrument in the chosen source, epoch ms. */
  coverageStart: number;
  coverageEnd: number;
  rowCount: number;
  /** How the instrument was identified — surfaced so callers can explain gaps. */
  resolution: 'symbol' | 'futures-root-stitched';
}

// ─── Instrument detection ───────────────────────────────────────────────────

/**
 * Mirrors `detectInstrumentType` in the market-data layer. Kept as a local
 * predicate rather than an import so the labels domain does not take a
 * dependency on the chart's query module for one regex.
 */
export function isFuturesRoot(symbol: string): boolean {
  const s = symbol.toUpperCase();
  if (s.length === 6 && !/\d/.test(s)) return false;          // forex pair
  if (/^[A-Z]+[FGHJKMNQUVXZ]\d{1,2}$/.test(s)) return false;  // single contract
  return /^[A-Z]{1,4}$/.test(s);
}

// ─── Candidate tables ───────────────────────────────────────────────────────

/**
 * Pre-rolled tables per timeframe, best first. A `<root>_ohlcv_<tf>` table is
 * probed ahead of these when one exists for the symbol.
 */
const TIMEFRAME_TABLES: Record<number, string[]> = {
  1: ['ohlcv_1m', 'ohlcv_full_1m'],
  5: ['ohlcv_5m', 'ohlcv_full_5m'],
  15: ['ohlcv_15m', 'ohlcv_full_15m'],
  30: ['ohlcv_30m', 'ohlcv_full_30m'],
  60: ['ohlcv_1h', 'ohlcv_full_1h'],
  240: ['ohlcv_4h', 'ohlcv_full_4h'],
  1440: ['ohlcv_1d'],
  10080: ['ohlcv_1w'],
};

const TIMEFRAME_SUFFIX: Record<number, string> = {
  1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', 1440: '1d', 10080: '1w',
};

const BASE_TABLE = 'ohlcv';

// ─── Caches ─────────────────────────────────────────────────────────────────

/** Table existence is a property of the database, not of any one request. */
let tableNameCache: Set<string> | null = null;

interface CachedSource { source: LabelSource; expiresAt: number }
const sourceCache = new Map<string, CachedSource>();
const SOURCE_TTL_MS = 5 * 60_000;

export function clearLabelSourceCache(): void {
  tableNameCache = null;
  sourceCache.clear();
}

async function listTables(): Promise<Set<string>> {
  if (tableNameCache) return tableNameCache;
  // Was `FROM tables()`, a lake function. Every serving object lives in
  // DuckDB's `main` schema.
  const rows = await queryLake<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'",
  );
  tableNameCache = new Set(rows.map(r => String(r.table_name)));
  return tableNameCache;
}

// ─── Coverage probe ─────────────────────────────────────────────────────────

function toMs(value: unknown): number {
  // A plain `.getTime()`: DuckDB answers in UTC. Subtracting the host offset
  // (a pg-wire-era correction) shifted every pre-rolled table's coverage end
  // seven hours early on this host, which is why `ohlcv_1d` always lost the
  // freshness comparison to re-aggregating the sub-minute base.
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return new Date(String(value)).getTime();
}

interface Coverage { rowCount: number; start: number; end: number }

/** Returns null when the instrument has no rows in that table. */
async function probeCoverage(table: string, predicate: string): Promise<Coverage | null> {
  try {
    const rows = await queryLake<Record<string, unknown>>(
      // `count()` was lake's spelling; DuckDB requires the argument.
      `SELECT count(*) AS c, min(timestamp) AS mn, max(timestamp) AS mx FROM ${table} WHERE ${predicate}`,
    );
    const row = rows[0];
    if (!row) return null;
    const count = Number(row.c) || 0;
    if (count === 0 || row.mn == null || row.mx == null) return null;
    return { rowCount: count, start: toMs(row.mn), end: toMs(row.mx) };
  } catch {
    // A missing column (`root`/`asset_class` absent from a rolled-up table) is
    // a normal negative result here, not an error worth propagating.
    return null;
  }
}

// ─── Front-month stitching ──────────────────────────────────────────────────

/**
 * Build a sub-select that emits ONE contract per date range for a futures
 * root, chosen by daily volume — the same front-month definition the chart
 * uses. Selecting `root = 'MNQ'` directly would overlay every expiration at
 * once and produce bars that blend two different prices.
 *
 * The result aliases the root back onto `symbol` so downstream generators,
 * which partition by and filter on `symbol`, need no changes.
 */
async function buildStitchedFrom(
  root: string,
  table: string,
  window?: LabelSourceWindow,
): Promise<string | null> {
  const escaped = root.replace(/'/g, "''");

  // Reuse the chart's cached front-month ranges rather than recomputing them.
  // The underlying daily aggregate is the heaviest query in the pipeline — on
  // the ES root (159M rows) computing it a second time here ran past a
  // four-minute client timeout. Sharing the cache also guarantees labels and
  // candles agree on where each roll happened.
  //
  // Bounded to the window when one is given. Unbounded, this UNIONed one
  // sub-select per contract since inception — 28 for MNQ — and every request
  // scanned all of them regardless of the dates it asked for, because the date
  // filter is injected inside each branch, after the branches are chosen.
  // Measured on MNQ daily: 4,793ms over 28 contracts, 739ms over the 4 that
  // overlap a nine-month window.
  const { getFrontMonthRanges } = await import('../../database/lake');
  const ranges = await getFrontMonthRanges(root, window?.startMs, window?.endMs);
  if (ranges.length === 0) return null;

  const parts = ranges.map(r => {
    const sym = r.symbol.replace(/'/g, "''");
    return `SELECT timestamp, '${escaped}' AS symbol, open, high, low, close, volume
      FROM ${table}
      WHERE symbol = '${sym}'
        AND timestamp >= '${r.start}T00:00:00.000000Z'
        AND timestamp <= '${r.end}T23:59:59.999999Z'`;
  });

  // The trailing `TIMESTAMP(timestamp)` is gone with lake. It existed only
  // because a UNION ALL lost lake's designated-timestamp property and its
  // SAMPLE BY refused a base query without one; DuckDB has no such concept and
  // the clause is a parser error there. The ORDER BY stays — callers downstream
  // read these rows in time order.
  return `(\n${parts.join('\nUNION ALL\n')}\nORDER BY timestamp\n)`;
}

// ─── Resolution ─────────────────────────────────────────────────────────────

/** Epoch-ms span the caller is going to label. Bounds the futures stitch. */
export interface LabelSourceWindow {
  startMs?: number;
  endMs?: number;
}

/** Day-granular key for the window, so a pan inside one day reuses the cache. */
function windowKey(window?: LabelSourceWindow): string {
  const day = (ms?: number) => (Number.isFinite(ms) ? new Date(ms!).toISOString().slice(0, 10) : '');
  return `${day(window?.startMs)}..${day(window?.endMs)}`;
}

export async function resolveLabelSource(
  symbol: string,
  timeframeMinutes: number,
  window?: LabelSourceWindow,
): Promise<LabelSource> {
  const tf = Math.max(1, Math.floor(timeframeMinutes || 1));
  const cacheKey = `${symbol}|${tf}|${windowKey(window)}`;
  const cached = sourceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.source;

  const escaped = symbol.replace(/'/g, "''");
  const symbolPredicate = `symbol = '${escaped}'`;
  const tables = await listTables();

  // Candidate pre-rolled tables, best first: symbol-specific, then generic.
  const suffix = TIMEFRAME_SUFFIX[tf];
  const candidates: { table: string; nativeMinutes: number }[] = [];
  if (suffix) {
    const specific = `${symbol.toLowerCase()}_ohlcv_${suffix}`;
    if (tables.has(specific)) candidates.push({ table: specific, nativeMinutes: tf });
    for (const t of TIMEFRAME_TABLES[tf] ?? []) {
      if (tables.has(t)) candidates.push({ table: t, nativeMinutes: tf });
    }
  }

  const futuresRoot = isFuturesRoot(symbol);

  // The base table is always a candidate — it is the only source carrying
  // `root`/`asset_class`, so it is the only one a futures root can stitch from.
  //
  // Coverage for a root is read off the cached front-month ranges rather than
  // probed. `count()/min/max ... WHERE root = 'NQ'` is an unindexed scan of
  // 145M rows and measured 23.7s; the ranges are already computed for the
  // stitch and cost nothing here.
  let baseCoverage: Coverage | null;
  let rootRanges: { symbol: string; start: string; end: string }[] | null = null;
  if (futuresRoot) {
    const { getFrontMonthRanges } = await import('../../database/lake');
    rootRanges = await getFrontMonthRanges(symbol);
    baseCoverage = rootRanges.length === 0 ? null : {
      rowCount: 0, // not needed for the freshness comparison, and not worth a scan
      start: Date.parse(`${rootRanges[0]!.start}T00:00:00.000Z`),
      end: Date.parse(`${rootRanges[rootRanges.length - 1]!.end}T23:59:59.999Z`),
    };
  } else {
    baseCoverage = await probeCoverage(BASE_TABLE, symbolPredicate);
  }

  let best: LabelSource | null = null;

  for (const candidate of candidates) {
    const coverage = await probeCoverage(candidate.table, symbolPredicate);
    if (!coverage) continue;
    const source: LabelSource = {
      from: candidate.table,
      predicate: symbolPredicate,
      tableName: candidate.table,
      nativeMinutes: candidate.nativeMinutes,
      coverageStart: coverage.start,
      coverageEnd: coverage.end,
      rowCount: coverage.rowCount,
      resolution: 'symbol',
    };
    // Freshness wins over row count: a pre-rolled table that stops early is
    // worse than a slower source that reaches the bars on screen.
    if (!best || source.coverageEnd > best.coverageEnd) best = source;
  }

  if (baseCoverage) {
    // The base wins only when it reaches MORE THAN ONE BAR past the best
    // pre-rolled table. Compared at millisecond precision it always won: a
    // daily table's last bar is stamped 00:00 while the base's coverage end is
    // 23:59:59.999 of the same day, so `ohlcv_1d` (96ms for a daily preview)
    // lost to re-aggregating 96.7M sub-minute rows (4,793ms) on every request,
    // for the same 2,074 days of coverage.
    const oneBarMs = tf * 60_000;
    // A futures root's base coverage comes from the front-month ranges, which
    // are DAYS: its "end" is 23:59:59.999 of the last day, not the last bar.
    // Compared against a pre-rolled table's real last bar (16:00 on the same
    // day, say) the base looked fresher by seven hours it never had, and the
    // hourly and 5-minute previews kept re-aggregating sub-minute rows.
    // Truncating to the day compares the two at the precision the base is
    // actually known to.
    const baseEndForCompare = futuresRoot
      ? Math.floor(baseCoverage.end / 86_400_000) * 86_400_000
      : baseCoverage.end;
    const beatsRolled = !best || baseEndForCompare > best.coverageEnd + oneBarMs;
    if (beatsRolled) {
      if (futuresRoot) {
        const stitched = await buildStitchedFrom(symbol, BASE_TABLE, window);
        if (stitched) {
          best = {
            from: stitched,
            predicate: symbolPredicate, // the sub-select aliases root onto symbol
            tableName: BASE_TABLE,
            nativeMinutes: 0,
            coverageStart: baseCoverage.start,
            coverageEnd: baseCoverage.end,
            rowCount: baseCoverage.rowCount,
            resolution: 'futures-root-stitched',
          };
        }
      } else {
        best = {
          from: BASE_TABLE,
          predicate: symbolPredicate,
          tableName: BASE_TABLE,
          nativeMinutes: 0,
          coverageStart: baseCoverage.start,
          coverageEnd: baseCoverage.end,
          rowCount: baseCoverage.rowCount,
          resolution: 'symbol',
        };
      }
    }
  }

  if (!best) {
    throw new Error(
      `No label source found for ${symbol}: it has no rows in ${BASE_TABLE}` +
      (candidates.length ? ` or in ${candidates.map(c => c.table).join(', ')}` : ''),
    );
  }

  sourceCache.set(cacheKey, { source: best, expiresAt: Date.now() + SOURCE_TTL_MS });
  return best;
}

