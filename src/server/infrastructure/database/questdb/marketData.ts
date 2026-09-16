/**
 * Market Data Queries — OHLCV, front-month stitching, symbol stats.
 *
 * Unified schema: a single `ohlcv` view for all asset classes (futures, forex,
 * equities, crypto) with `asset_class` and `root` columns, plus one view per
 * timeframe. These are the rows QuestDB served, read now from parquet in the
 * lake through DuckDB.
 *
 * Futures continuous contracts are built by volume-based front-month detection
 * directly from OHLCV data — no separate rollovers table needed.
 *
 * **The timeframe views replace SAMPLE BY.** QuestDB maintained a materialized
 * view per timeframe and refreshed it incrementally; all of them were captured
 * in the snapshot. So the faithful answer to "give me 5-minute bars" is to read
 * `ohlcv_5m` — the same rows QuestDB's own query would have read — rather than
 * to re-aggregate `ohlcv` and hope the bucket boundaries line up. That also
 * sidesteps the `first()`/`last()` trap: DuckDB's first and last are
 * order-unspecified within a group, so re-aggregating with them would produce a
 * bar whose open drifts between runs without ever raising.
 */

import { validateSymbol } from "@shared/schema";
import type { StitchedOHLCVBar } from "@shared/ohlcv";
import { cachedQuery, OHLCVCache } from "../../cache/ohlcv";
import { queryQuestDB, queryQuestDBFast } from "./connection";
import { contractPattern, isFuturesRoot } from "../../lib/futures";
import { normalizeTimestamp } from "../../lib/normalize";

// ─── Instrument Detection (kept for downstream consumers) ────────────────────

export type InstrumentType = "forex" | "futures_contract" | "futures_root" | "generic";

export function detectInstrumentType(symbol: string): InstrumentType {
  const s = symbol.toUpperCase();
  if (s.length === 6 && !/\d/.test(s)) return "forex";
  if (s.includes("/")) return "forex";
  const futuresContractMatch = s.match(/^([A-Z]+)[FGHJKMNQUVXZ]\d{1,2}$/);
  if (futuresContractMatch) return "futures_contract";
  const futuresRootMatch = s.match(/^[A-Z]{1,4}$/);
  if (futuresRootMatch) return "futures_root";
  return "generic";
}

/** All instrument types share the unified ohlcv view. */
export function getBaseTableForType(_type: InstrumentType): string {
  return "ohlcv";
}

// ─── Timeframe View Lookup ──────────────────────────────────────────────────

/**
 * Timeframe → the pre-aggregated view holding those bars.
 *
 * These are the eight views QuestDB kept as materialized views and refreshed
 * incrementally. `1h` maps to `ohlcv_1h_v`, not `ohlcv_1h`: both survived the
 * export and `_v` is the one QuestDB's own hourly queries read.
 */
const TIMEFRAME_VIEW: Record<string, string> = {
  "1m": "ohlcv_1m", "5m": "ohlcv_5m",
  "15m": "ohlcv_15m", "30m": "ohlcv_30m",
  "1h": "ohlcv_1h_v", "4h": "ohlcv_4h",
  "1d": "ohlcv_1d", "1w": "ohlcv_1w",
};

/** The daily view front-month detection reads. */
const DAILY_VIEW = "ohlcv_1d";

function timeframeView(timeframe: string): string {
  return TIMEFRAME_VIEW[timeframe] || TIMEFRAME_VIEW["1m"]!;
}

/**
 * Candle anatomy over an already-aggregated bar.
 *
 * QuestDB computed these inside the SAMPLE BY, from `first(open)`/`last(close)`
 * and the bucket's min/max. Reading a pre-aggregated view, `open` and `close`
 * are already the bar's own, so the same arithmetic is a plain row expression.
 */
const ANATOMY_COLUMNS = `
      CASE WHEN (high - low) > 0 THEN abs(close - open) / (high - low) ELSE 0 END AS body_magnitude,
      CASE WHEN (high - low) > 0
        THEN (high - CASE WHEN close > open THEN close ELSE open END) / (high - low)
        ELSE 0 END AS upper_wick_pct,
      CASE WHEN (high - low) > 0
        THEN (CASE WHEN close > open THEN open ELSE close END - low) / (high - low)
        ELSE 0 END AS lower_wick_pct,
      (close > open) AS is_bullish`;

/** One row of a timeframe view as the lake returns it, anatomy included. */
export interface LakeBarRow {
  symbol: string;
  timestamp: Date | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  body_magnitude: number;
  upper_wick_pct: number;
  lower_wick_pct: number;
  is_bullish: boolean;
}

// ─── Validation Helpers ─────────────────────────────────────────────────────

function validatePositiveInt(value: number | undefined, maxValue: number = 1000000): number {
  if (value === undefined) return 0;
  const intVal = Math.floor(value);
  if (isNaN(intVal) || intVal < 0 || intVal > maxValue) {
    throw new Error("Invalid numeric value");
  }
  return intVal;
}

// ─── OHLCV Queries ──────────────────────────────────────────────────────────

export async function getOHLCVSampleBy(
  symbol: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number
): Promise<Array<LakeBarRow | StitchedOHLCVBar>> {
  // Futures root symbols: always use volume-based stitching at ALL timeframes.
  // This ensures the chart always shows the highest-volume (front-month) contract
  // with seamless rollover — no mixed contracts from different expirations.
  if (isFuturesRoot(symbol)) {
    return getStitchedOHLCV(symbol, timeframe, startTime, endTime, limit);
  }

  const safeSymbol = validateSymbol(symbol);
  const safeStartTime = startTime ? validatePositiveInt(startTime, Number.MAX_SAFE_INTEGER) : undefined;
  const safeEndTime = endTime ? validatePositiveInt(endTime, Number.MAX_SAFE_INTEGER) : undefined;
  const safeLimit = limit ? validatePositiveInt(limit, 100000) : undefined;

  const escapedSymbol = safeSymbol.replace(/'/g, "''");
  let whereClause = `WHERE symbol = '${escapedSymbol}'`;
  if (safeStartTime) {
    whereClause += ` AND timestamp >= '${new Date(safeStartTime).toISOString()}'`;
  }
  if (safeEndTime) {
    whereClause += ` AND timestamp <= '${new Date(safeEndTime).toISOString()}'`;
  }

  const limitClause = safeLimit ? `LIMIT ${safeLimit}` : "";
  const view = timeframeView(timeframe);

  // ORDER BY is not decoration: QuestDB's SAMPLE BY emitted buckets in
  // timestamp order, so the old LIMIT took the oldest N of the window. DuckDB
  // makes no such promise, and a bare LIMIT over a parquet scan would return
  // an arbitrary slice that changes between runs.
  const sql = `
    SELECT
      symbol,
      timestamp,
      open,
      high,
      low,
      close,
      volume,${ANATOMY_COLUMNS}
    FROM ${view}
    ${whereClause}
    ORDER BY timestamp
    ${limitClause}
  `;

  return await queryQuestDBFast<LakeBarRow>(sql);
}

// ─── Front-Month Stitching ──────────────────────────────────────────────────

/**
 * A contract has to actually trade to lead.
 *
 * Measured 2026-09-15 on root MNQ: the chart was serving MNQM26, which holds 584
 * one-minute bars scattered over 5 days (2026-03-02..2026-03-27) — about 8% of
 * the bars a real front month has — while the liquid series (MNQ, MNQZ5) ends
 * 2025-12-30. It won every one of those days because it was the only dated
 * contract with a row, and its timestamps are the newest under the root, so the
 * default window anchored there too. What the user saw was that fragment: runs
 * of zero-volume padding bars drawn as a dashed line, and a 372-point cliff
 * between two bars 23 hours apart (2026-03-26 07:00 close 24,287.50 ->
 * 2026-03-27 06:00 open 23,915.50) — a hole in a thin series, not a rollover.
 *
 * So a symbol is a leadership candidate only if it has real history and real
 * volume on the day in question. MNQM26 (5 days), MNQZ6 (10 days, 19 contracts
 * total) and MNQU6 (142 contracts total) all fail; MNQZ5 (286 days) and MNQH6
 * (196 days) pass.
 */
const MIN_CONTRACT_DAYS = 20;
const MIN_DAILY_VOLUME = 1_000;

/** Month codes in calendar order, as CME writes them. */
const MONTH_CODES = 'FGHJKMNQUVXZ';

/**
 * The expiry a dated contract symbol encodes, as YYYYMM, or null if the symbol
 * is not a dated contract (the bare root, or a calendar spread).
 *
 * The year is one or two digits (MNQZ5, MNQM26), so a single digit is resolved
 * against the day the contract is leading — the year ending in that digit
 * nearest that day — rather than assumed to be in the 2020s.
 */
function contractExpiry(symbol: string, referenceDay: string): number | null {
  const match = symbol.match(/^[A-Z]+([FGHJKMNQUVXZ])(\d{1,2})$/);
  if (!match) return null;
  const month = MONTH_CODES.indexOf(match[1]!) + 1;
  const digits = match[2]!;
  const referenceYear = Number(referenceDay.slice(0, 4));
  let year: number;
  if (digits.length === 2) {
    year = 2000 + Number(digits);
  } else {
    const decade = Math.floor(referenceYear / 10) * 10;
    year = decade + Number(digits);
    // Pick the nearest year ending in that digit: a December contract leading in
    // January belongs to the year just gone, not the one nine years out.
    for (const candidate of [year - 10, year + 10]) {
      if (Math.abs(candidate - referenceYear) < Math.abs(year - referenceYear)) year = candidate;
    }
  }
  return year * 100 + month;
}

/**
 * Get the full front-month date ranges for a futures root (no time filters).
 * Cached aggressively with a long-lived key so paginated requests don't re-scan.
 */
async function getFullFrontMonthRanges(
  root: string,
): Promise<{ symbol: string; start: string; end: string }[]> {
  const safeRoot = validateSymbol(root);

  // Namespace left as 'questdb': OHLCVCache.key types it as a fixed union, and
  // widening it is the rename pass's job, not this one's.
  const cacheKey = OHLCVCache.key('questdb', `fm_${safeRoot}`, 'ranges_full', {});

  return cachedQuery(cacheKey, async () => {
    const escaped = safeRoot.replace(/'/g, "''");

    // Was `SELECT symbol, timestamp, sum(volume) FROM ohlcv ... SAMPLE BY 1d
    // ALIGN TO CALENDAR`, which scanned the whole base table. `ohlcv_1d` is
    // that same daily rollup, already materialised and carrying `root` and
    // `asset_class`, so this reads a few thousand rows instead of 145M. The
    // sum/GROUP BY stays as a guard: the daily view should hold one row per
    // (symbol, day), and if a re-seed ever left two, silently charting one of
    // them would be worse than adding them.
    const dailyBars = await queryQuestDB<{ symbol: string; timestamp: Date | string; volume: number }>(
      `SELECT symbol, timestamp, sum(volume) AS volume FROM ${DAILY_VIEW}
       WHERE root = '${escaped}' AND asset_class = 'futures'
       GROUP BY symbol, timestamp
       ORDER BY timestamp`,
      30_000, // 30s timeout — this is the heaviest single query in the pipeline
    );

    if (dailyBars.length === 0) return [];

    // The daily view carries three kinds of symbol under one root: dated
    // contracts (MNQZ5), calendar spreads (MNQZ5-MNQH6, whose prices can be
    // negative), and the bare root 'MNQ' — an already-stitched front-month
    // series whose daily volume EQUALS the front contract's. With a strict `>`
    // that tie went to whichever row DuckDB emitted first, and GROUP BY output
    // has no order, so the chart flipped between 'MNQ' and 'MNQZ5' almost every
    // day (963 flips over 2000 daily bars, measured). Rank instead: spreads
    // never lead; a dated contract beats the bare root; volume decides among
    // the rest, and the symbol name breaks any remaining tie deterministically.
    const datedContract = new RegExp(contractPattern(safeRoot));
    const rank = (symbol: string): number =>
      symbol.includes("-") ? -1 : datedContract.test(symbol) ? 1 : 0;

    // How much history each symbol has under this root, so a fragment cannot
    // lead a day just by being the only row on it (see MIN_CONTRACT_DAYS).
    const daysPresent = new Map<string, number>();
    for (const bar of dailyBars) {
      if (rank(bar.symbol) < 0) continue;
      daysPresent.set(bar.symbol, (daysPresent.get(bar.symbol) ?? 0) + 1);
    }

    const leaders = new Map<string, { symbol: string; volume: number; rank: number; expiry: number | null }>();
    for (const bar of dailyBars) {
      const symbolRank = rank(bar.symbol);
      if (symbolRank < 0) continue;
      const day = new Date(normalizeTimestamp(bar.timestamp)).toISOString().slice(0, 10);
      const vol = Number(bar.volume);
      // Both floors, or a thin fragment charts as if it were the front month.
      if (!(vol >= MIN_DAILY_VOLUME)) continue;
      if ((daysPresent.get(bar.symbol) ?? 0) < MIN_CONTRACT_DAYS) continue;
      const existing = leaders.get(day);
      const wins = !existing
        || symbolRank > existing.rank
        || (symbolRank === existing.rank && (vol > existing.volume
          || (vol === existing.volume && bar.symbol < existing.symbol)));
      if (wins) {
        leaders.set(day, {
          symbol: bar.symbol, volume: vol, rank: symbolRank,
          expiry: contractExpiry(bar.symbol, day),
        });
      }
    }

    // Latch the roll forward. Volume migrates over 3-5 sessions and crosses back
    // and forth while it does, so a pure per-day winner walks from the new
    // contract to the old one and back — every flip a price jump on the chart.
    // Once a later expiry has led, an earlier one never leads again.
    let highestExpiry = 0;
    const latched = new Map<string, string>();
    for (const [day, leader] of [...leaders.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (leader.expiry !== null) {
        if (leader.expiry < highestExpiry) {
          // An earlier contract out-traded the one we have already rolled to:
          // keep the roll, and let this day belong to the contract we are on.
          const previous = [...latched.values()].pop();
          if (previous) { latched.set(day, previous); continue; }
        }
        highestExpiry = Math.max(highestExpiry, leader.expiry);
      }
      latched.set(day, leader.symbol);
    }

    const ranges: { symbol: string; start: string; end: string }[] = [];
    let current: { symbol: string; start: string; end: string } | null = null;
    for (const [day, symbol] of [...latched.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!current || current.symbol !== symbol) {
        if (current) ranges.push(current);
        current = { symbol, start: day, end: day };
      } else {
        current.end = day;
      }
    }
    if (current) ranges.push(current);

    return ranges;
  });
}

export async function getFrontMonthRanges(
  root: string,
  startTime?: number,
  endTime?: number,
): Promise<{ symbol: string; start: string; end: string }[]> {
  // Fetch the full (unbounded) ranges — cached aggressively
  const allRanges = await getFullFrontMonthRanges(root);
  if (allRanges.length === 0) return allRanges;

  // If no time filters, return everything
  if (!startTime && !endTime) return allRanges;

  // Filter ranges that overlap [startTime, endTime]
  const startDay = startTime
    ? new Date(startTime).toISOString().slice(0, 10)
    : '0000-01-01';
  const endDay = endTime
    ? new Date(endTime).toISOString().slice(0, 10)
    : '9999-12-31';

  return allRanges.filter(r => r.end >= startDay && r.start <= endDay);
}

/**
 * The newest timestamp the stitched series actually reaches.
 *
 * `max(timestamp) WHERE root = ...` is not that: it answers with whatever thin
 * fragment happens to carry the latest row — MNQM26's 2026-03-27 while the
 * liquid series ends 2025-12-30 — and a default window anchored there lands on
 * data no one trades, or (once that fragment stops leading) on nothing at all.
 * Anchoring on the last qualifying front-month contract keeps the default view
 * on the series the chart is actually going to draw.
 */
export async function getFrontMonthAnchor(root: string): Promise<number | null> {
  const ranges = await getFrontMonthRanges(root);
  const last = ranges[ranges.length - 1];
  if (!last) return null;
  const sym = last.symbol.replace(/'/g, "''");
  const [row] = await queryQuestDBFast<{ latest: Date | string | null }>(
    `SELECT max(timestamp) AS latest FROM ohlcv WHERE symbol = '${sym}'`,
  );
  if (!row?.latest) return null;
  const latest = normalizeTimestamp(row.latest);
  return Number.isFinite(latest) ? latest : null;
}

export async function getFrontMonthOHLCV(
  root: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number
): Promise<LakeBarRow[]> {
  const safeLimit = limit ? Math.min(Math.floor(limit), 100000) : undefined;

  const ranges = await getFrontMonthRanges(root, startTime, endTime);
  if (ranges.length === 0) return [];

  const view = timeframeView(timeframe);

  // Build a single UNION ALL query to eliminate N+1 round-trips.
  // Each range gets its own sub-select against the timeframe view, then the
  // union is sorted.
  const MAX_RANGES_PER_QUERY = 50; // keep any one generated query bounded
  let allBars: LakeBarRow[] = [];

  for (let i = 0; i < ranges.length; i += MAX_RANGES_PER_QUERY) {
    const batch = ranges.slice(i, i + MAX_RANGES_PER_QUERY);

    const unionParts = batch.map(range => {
      const sym = range.symbol.replace(/'/g, "''");
      // Intersect the range's own span with the caller's requested window.
      // getFrontMonthRanges uses startTime/endTime only to PICK ranges, never to
      // bound them, so without this each sub-select scans the range end to end.
      // A single front-month range can span years (the pre-stitched 'MNQ' symbol
      // covers 2019-05 -> 2024-02 as one range), and all but `limit` of those
      // rows are discarded by the slice below.
      const rangeStartMs = Date.parse(range.start + 'T00:00:00.000Z');
      const rangeEndMs = Date.parse(range.end + 'T23:59:59.999Z');
      const fromMs = startTime ? Math.max(rangeStartMs, startTime) : rangeStartMs;
      const toMs = endTime ? Math.min(rangeEndMs, endTime) : rangeEndMs;
      // Range selection is day-granular, so an intersection can be empty once
      // the caller's intra-day bounds are applied. Drop those sub-selects.
      if (fromMs > toMs) return null;
      const s = new Date(fromMs).toISOString();
      const e = new Date(toMs).toISOString();
      // volume > 0 drops padding. A futures bar with no traded volume is
      // open == high == low == close carried from the previous close; 45 of
      // MNQM26's 584 minutes are these, and a run of them is the dashed
      // horizontal line the user reported. A minute with even one real print
      // keeps its bar, flat or not — that is a thin market, not a fabrication.
      return `(SELECT symbol, timestamp, open, high, low, close, volume,${ANATOMY_COLUMNS}
         FROM ${view}
         WHERE symbol = '${sym}' AND timestamp >= '${s}' AND timestamp <= '${e}'
           AND volume > 0)`;
    });

    const parts = unionParts.filter((p): p is string => p !== null);
    if (parts.length === 0) continue;

    // Take the newest `safeLimit` bars IN SQL, not in JavaScript.
    //
    // This used to select the whole union and slice the tail off the array
    // below. Measured on the real MNQ 1m front-month union: 1,068,765 rows
    // came back, DuckDB spent 56-66 ms finding them, and Node then spent
    // 2,869 ms building one JS object per row plus 546 ms normalizing
    // bigints - 90.5% of a 3,772 ms request - to keep 5,000 and discard 99.5%.
    //
    // Each batch returning its own newest N is still correct: the newest N of
    // the whole set is a subset of the union of each batch's newest N. The
    // ascending sort and tail-slice below remain the backstop that picks the
    // true newest N across batches.
    const ordered = safeLimit
      ? `\nORDER BY timestamp DESC\nLIMIT ${safeLimit}`
      : '\nORDER BY timestamp';
    const sql = parts.join('\nUNION ALL\n') + ordered;
    const rows = await queryQuestDBFast<LakeBarRow>(sql);
    allBars = allBars.concat(rows);
  }

  allBars.sort((a, b) => normalizeTimestamp(a.timestamp) - normalizeTimestamp(b.timestamp));

  if (safeLimit && allBars.length > safeLimit) {
    // allBars is sorted ASCENDING, so the newest bars are at the END. Slicing
    // from the front returned the OLDEST N — a 1d chart asking for 500 bars got
    // 2019-2022 and reported 2022-08-17 as its most recent candle. Charts want
    // the most recent N; take the tail.
    allBars = allBars.slice(-safeLimit);
  }

  return allBars;
}

// ─── Rollover-Driven Stitching ───────────────────────────────────────────────

/**
 * Build a continuous futures contract by volume-based front-month detection.
 * Each bar comes from whichever contract had the highest daily volume.
 * No separate rollovers table — derived entirely from OHLCV data.
 *
 * Returns bars with `activeContract` populated so the client can display
 * rollover boundaries on the HUD.
 */
/**
 * The multiplier each front-month range needs so the splice has no step in it.
 *
 * Two contracts on the same day trade at different prices — the calendar spread,
 * which is cost of carry, not a move anyone captured. Measured on MNQ's
 * 2025-12 roll: MNQZ5 closed 24,992.25 while MNQH6 closed 25,248.50, so an
 * unadjusted splice prints a 256.25-point cliff at the boundary. Ratio (Panama)
 * adjustment scales every earlier bar by close(new)/close(old) at each roll, so
 * the roll-bar return is exactly zero and every other percentage move is
 * preserved. This is the same arithmetic as quant's `load_ohlcv_root` and the
 * lake's `fmadj` macro; the newest range is always factor 1, so today's price is
 * today's price and only history is restated.
 *
 * Returns one factor per range, oldest first.
 */
async function rollAdjustmentFactors(
  root: string,
  ranges: { symbol: string; start: string; end: string }[],
): Promise<number[]> {
  const factors = new Array<number>(ranges.length).fill(1);
  if (ranges.length < 2) return factors;

  const escapedRoot = validateSymbol(root).replace(/'/g, "''");
  const symbols = [...new Set(ranges.map(r => r.symbol))]
    .map(s => `'${s.replace(/'/g, "''")}'`).join(', ');
  const firstDay = ranges[0]!.start;

  // One daily row per (symbol, day) for every contract in the stitch: enough to
  // read both sides of each boundary.
  const closes = await queryQuestDB<{ symbol: string; timestamp: Date | string; close: number }>(
    `SELECT symbol, timestamp, close FROM ${DAILY_VIEW}
     WHERE root = '${escapedRoot}' AND asset_class = 'futures'
       AND symbol IN (${symbols}) AND timestamp >= '${firstDay}T00:00:00.000Z'`,
    30_000,
  );

  const closeByKey = new Map<string, number>();
  for (const row of closes) {
    const day = new Date(normalizeTimestamp(row.timestamp)).toISOString().slice(0, 10);
    closeByKey.set(`${row.symbol}|${day}`, Number(row.close));
  }

  // Ratio at each boundary, newest boundary first, accumulated backwards.
  const ratios = new Array<number>(Math.max(ranges.length - 1, 0)).fill(1);
  for (let i = 0; i < ranges.length - 1; i++) {
    const older = ranges[i]!;
    const newer = ranges[i + 1]!;
    // Prefer the last day the old contract led, where both normally trade; fall
    // back to the first day of the new range.
    for (const day of [older.end, newer.start]) {
      const oldClose = closeByKey.get(`${older.symbol}|${day}`);
      const newClose = closeByKey.get(`${newer.symbol}|${day}`);
      if (oldClose && newClose && oldClose > 0) {
        ratios[i] = newClose / oldClose;
        break;
      }
    }
  }

  // factor(i) = product of every ratio at or after i, so the newest range is 1.
  for (let i = ranges.length - 2; i >= 0; i--) {
    factors[i] = factors[i + 1]! * ratios[i]!;
  }
  return factors;
}

export async function getStitchedOHLCV(
  root: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number,
  adjustment: string = 'none',
): Promise<StitchedOHLCVBar[]> {
  const bars = await getFrontMonthOHLCV(root, timeframe, startTime, endTime, limit);
  if (bars.length === 0) return [];

  // 'panama' is the trader's name for the same ratio adjustment.
  const adjusted = adjustment === 'ratio' || adjustment === 'panama';
  const factorFor = new Map<string, number>();
  if (adjusted) {
    const ranges = await getFrontMonthRanges(root, startTime, endTime);
    const factors = await rollAdjustmentFactors(root, ranges);
    ranges.forEach((range, index) => {
      // Keyed by contract: a symbol leads one contiguous stretch of this window,
      // and the latch above guarantees it cannot come back after rolling away.
      factorFor.set(range.symbol, factors[index] ?? 1);
    });
  }

  // Anatomy is computed per range in the SQL; dropping it here is what made
  // every futures candle report body 0, wicks 0, bearish. It is also all ratios,
  // so scaling the prices leaves it correct untouched.
  return bars.map((r) => {
    const factor = adjusted ? (factorFor.get(r.symbol) ?? 1) : 1;
    return {
      timestamp: normalizeTimestamp(r.timestamp),
      open: Number(r.open) * factor,
      high: Number(r.high) * factor,
      low: Number(r.low) * factor,
      close: Number(r.close) * factor,
      volume: Number(r.volume),
      body_magnitude: Number(r.body_magnitude),
      upper_wick_pct: Number(r.upper_wick_pct),
      lower_wick_pct: Number(r.lower_wick_pct),
      is_bullish: Boolean(r.is_bullish),
      activeContract: r.symbol,
    };
  });
}

// ─── Symbol Stats ───────────────────────────────────────────────────────────

export async function getSymbolsInQuestDB(): Promise<string[]> {
  const rows = await queryQuestDB<{ symbol: string }>(
    `SELECT DISTINCT symbol FROM symbols ORDER BY symbol`
  );
  return rows.map(r => r.symbol);
}

export async function getSymbolStats(symbol: string): Promise<{
  symbol: string;
  rowCount: number;
  earliest: Date;
  latest: Date;
  timeSpanDays: number;
}> {
  const safeSymbol = validateSymbol(symbol);
  const escapedSymbol = safeSymbol.replace(/'/g, "''");

  // `count()` was QuestDB's spelling; DuckDB requires an argument. `symbol` is
  // now grouped rather than free-floating beside the aggregates — QuestDB
  // tolerated the bare column, DuckDB rejects it.
  const sql = `
    SELECT
      symbol,
      count(*) as row_count,
      min(timestamp) as earliest,
      max(timestamp) as latest
    FROM ohlcv
    WHERE symbol = '${escapedSymbol}'
    GROUP BY symbol
  `;

  const result = await queryQuestDB<{
    symbol: string;
    row_count: number | bigint;
    earliest: Date | string;
    latest: Date | string;
  }>(sql);

  const row = result[0];
  if (!row || !row.row_count) {
    throw new Error(`No data found for symbol ${safeSymbol}`);
  }

  const earliest = new Date(row.earliest);
  const latest = new Date(row.latest);
  const timeSpanDays = (latest.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24);

  return {
    symbol: row.symbol,
    rowCount: Number(row.row_count),
    earliest,
    latest,
    timeSpanDays: Math.round(timeSpanDays * 100) / 100
  };
}
