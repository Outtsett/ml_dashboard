import { validateSymbol } from "@shared/schema";
import { queryQuestDB, getQuestDBSender } from "../questdb";

// ── Types ───────────────────────────────────────────────────────────────

export interface RolloverRecord {
  ts: Date;
  root: string;
  from_contract: string;
  to_contract: string;
  from_close: number;
  to_close: number;
  price_gap: number;
  rollover_type: string;
}

export interface BackAdjustment {
  ts: Date;
  cumulativeAdj: number;
}

interface DailyVolume {
  trade_date: string;
  symbol: string;
  total_volume: number;
}

// ── Pure Functions ──────────────────────────────────────────────────────

/**
 * Determines if a symbol is a futures root (ES, NQ, MNQ) vs a specific
 * contract (ESH5, NQM25) or forex pair (EURUSD, GBPJPY).
 *
 * - Forex: exactly 6 uppercase letters -> false
 * - Specific contract: letters + month code [FGHJKMNQUVXZ] + 1-2 digits -> false
 * - Futures root: 1-4 uppercase letters, no digits -> true
 * - Default: false
 */
export function isFuturesRoot(symbol: string): boolean {
  const s = symbol.toUpperCase().trim();

  // Forex: exactly 6 uppercase letters (e.g. EURUSD, GBPJPY)
  if (/^[A-Z]{6}$/.test(s)) return false;

  // Specific contract: letters followed by a futures month code + 1-2 digits
  // e.g. ESH5, NQM25, MNQZ26
  if (/^[A-Z]+[FGHJKMNQUVXZ]\d{1,2}$/.test(s)) return false;

  // Futures root: 1-4 uppercase letters, no digits
  if (/^[A-Z]{1,4}$/.test(s)) return true;

  return false;
}

/**
 * Detects volume leadership changes between futures contract months.
 *
 * Groups daily volume data by date, finds the volume leader per day,
 * then identifies days where the leader changed compared to the previous day.
 *
 * @param dailyVolumes - Array of { trade_date, symbol, total_volume } rows
 * @param closePrices  - Map keyed by "SYMBOL|DATE" -> close price
 * @returns Array of rollover records (without ts/root, which the caller adds)
 */
export function detectRollovers(
  dailyVolumes: DailyVolume[],
  closePrices: Record<string, number>
): {
  from_contract: string;
  to_contract: string;
  trade_date: string;
  from_close: number;
  to_close: number;
  price_gap: number;
  rollover_type: "volume";
}[] {
  // Group by date, find volume leader per day
  const byDate = new Map<string, { symbol: string; total_volume: number }[]>();
  for (const row of dailyVolumes) {
    const dateKey = row.trade_date;
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey)!.push({ symbol: row.symbol, total_volume: row.total_volume });
  }

  // Find leader per day (highest volume)
  const leaders = new Map<string, string>();
  Array.from(byDate.entries()).forEach(([date, entries]) => {
    let best = entries[0];
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].total_volume > best.total_volume) {
        best = entries[i];
      }
    }
    leaders.set(date, best.symbol);
  });

  // Sort dates chronologically
  const sortedDates = Array.from(leaders.keys()).sort();

  // Detect leadership changes
  const rollovers: {
    from_contract: string;
    to_contract: string;
    trade_date: string;
    from_close: number;
    to_close: number;
    price_gap: number;
    rollover_type: "volume";
  }[] = [];

  for (let i = 1; i < sortedDates.length; i++) {
    const prevDate = sortedDates[i - 1];
    const currDate = sortedDates[i];
    const prevLeader = leaders.get(prevDate)!;
    const currLeader = leaders.get(currDate)!;

    if (prevLeader !== currLeader) {
      // Leadership changed: get both contract prices on the rollover date
      const fromKey = `${prevLeader}|${currDate}`;
      const toKey = `${currLeader}|${currDate}`;
      const fromClose = closePrices[fromKey] ?? 0;
      const toClose = closePrices[toKey] ?? 0;
      const priceGap = fromClose - toClose;

      rollovers.push({
        from_contract: prevLeader,
        to_contract: currLeader,
        trade_date: currDate,
        from_close: fromClose,
        to_close: toClose,
        price_gap: priceGap,
        rollover_type: "volume",
      });
    }
  }

  return rollovers;
}

/**
 * Panama Canal method back-adjustment.
 *
 * Walk rollovers newest-to-oldest, accumulating price_gap values.
 * Returns BackAdjustment[] sorted oldest-first.
 *
 * Semantics:
 * - Before the oldest rollover timestamp: bars get the FULL cumulative adjustment
 * - Between rollovers: progressively less adjustment
 * - After the newest rollover: no adjustment (0)
 */
export function computeBackAdjustment(rollovers: RolloverRecord[]): BackAdjustment[] {
  if (rollovers.length === 0) return [];

  // Sort newest-to-oldest by ts
  const sorted = [...rollovers].sort((a, b) => b.ts.getTime() - a.ts.getTime());

  let cumulative = 0;
  const result: BackAdjustment[] = [];

  for (const r of sorted) {
    cumulative += r.price_gap;
    result.push({ ts: r.ts, cumulativeAdj: cumulative });
  }

  // Reverse to oldest-first
  result.reverse();
  return result;
}

// ── DB-dependent Function ───────────────────────────────────────────────

/**
 * Full pipeline: query QuestDB for a futures root, detect rollovers,
 * compute Panama back-adjustment, write adjusted series to
 * ohlcv_continuous and rollover records to the rollovers table via ILP.
 */
export async function buildContinuousSeries(root: string): Promise<{
  rollovers: RolloverRecord[];
  adjustments: BackAdjustment[];
  barsWritten: number;
}> {
  const safeRoot = validateSymbol(root);

  if (!isFuturesRoot(safeRoot)) {
    throw new Error(`${safeRoot} is not a futures root symbol`);
  }

  // Escape for SQL
  const escaped = safeRoot.replace(/'/g, "''");

  // 1. Query daily volumes for all contracts matching this root
  //    e.g. root = "ES" matches ESH5, ESM5, ESU5, ESZ5 etc.
  const dailyVolumeRows = await queryQuestDB<{
    symbol: string;
    trade_date: string;
    total_volume: number;
    close_price: number;
  }>(`
    SELECT
      symbol,
      cast(timestamp as date) as trade_date,
      sum(volume) as total_volume,
      last(close) as close_price
    FROM ohlcv
    WHERE symbol ~ '^${escaped}[FGHJKMNQUVXZ]\\d{1,2}$'
    GROUP BY symbol, cast(timestamp as date)
    ORDER BY trade_date, symbol
  `);

  if (dailyVolumeRows.length === 0) {
    console.log(`[continuous] No contract data found for root ${safeRoot}`);
    return { rollovers: [], adjustments: [], barsWritten: 0 };
  }

  // Build close price lookup: "SYMBOL|DATE" -> close
  const closePrices: Record<string, number> = {};
  const dailyVolumes: DailyVolume[] = [];

  for (const row of dailyVolumeRows) {
    const dateStr = String(row.trade_date);
    closePrices[`${row.symbol}|${dateStr}`] = Number(row.close_price);
    dailyVolumes.push({
      trade_date: dateStr,
      symbol: row.symbol,
      total_volume: Number(row.total_volume),
    });
  }

  // 2. Detect rollovers (pure function)
  const rawRollovers = detectRollovers(dailyVolumes, closePrices);

  const rollovers: RolloverRecord[] = rawRollovers.map((r) => ({
    ts: new Date(r.trade_date),
    root: safeRoot,
    from_contract: r.from_contract,
    to_contract: r.to_contract,
    from_close: r.from_close,
    to_close: r.to_close,
    price_gap: r.price_gap,
    rollover_type: r.rollover_type,
  }));

  console.log(`[continuous] Found ${rollovers.length} rollovers for ${safeRoot}`);

  // 3. Compute back-adjustment (pure function)
  const adjustments = computeBackAdjustment(rollovers);

  if (adjustments.length > 0) {
    const totalAdj = adjustments[0].cumulativeAdj;
    console.log(`[continuous] Total cumulative adjustment: ${totalAdj.toFixed(2)}`);
  }

  // 4. Build daily leader map for contract selection
  const byDate = new Map<string, { symbol: string; total_volume: number }[]>();
  for (const row of dailyVolumes) {
    if (!byDate.has(row.trade_date)) byDate.set(row.trade_date, []);
    byDate.get(row.trade_date)!.push({ symbol: row.symbol, total_volume: row.total_volume });
  }
  const dailyLeader = new Map<string, string>();
  Array.from(byDate.entries()).forEach(([date, entries]) => {
    let best = entries[0];
    for (const e of entries) {
      if (e.total_volume > best.total_volume) best = e;
    }
    dailyLeader.set(date, best.symbol);
  });

  // 5. Query raw OHLCV bars for the leader contracts
  const leaderSymbols = Array.from(new Set(Array.from(dailyLeader.values())));
  const symbolList = leaderSymbols.map((s) => `'${s.replace(/'/g, "''")}'`).join(",");

  const rawBars = await queryQuestDB<{
    symbol: string;
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>(`
    SELECT symbol, timestamp, open, high, low, close, volume
    FROM ohlcv
    WHERE symbol IN (${symbolList})
    ORDER BY timestamp
  `);

  // 6. Filter bars to only use the daily leader and apply adjustment
  //    Build a function to look up adjustment for a given timestamp
  function getAdjustment(ts: Date): number {
    if (adjustments.length === 0) return 0;
    // Before the oldest rollover: full cumulative adjustment
    if (ts < adjustments[0].ts) return adjustments[0].cumulativeAdj;
    // Walk through adjustments to find the right bracket
    for (let i = 0; i < adjustments.length; i++) {
      if (ts < adjustments[i].ts) {
        return adjustments[i].cumulativeAdj;
      }
    }
    // After the newest rollover: no adjustment
    return 0;
  }

  // 7. Write adjusted bars to ohlcv_continuous and rollovers via ILP
  const sender = await getQuestDBSender();
  let barsWritten = 0;

  for (const bar of rawBars) {
    const barTs = new Date(bar.timestamp);
    const barDateStr = barTs.toISOString().split("T")[0];
    const leader = dailyLeader.get(barDateStr);

    if (bar.symbol !== leader) continue;

    const adj = getAdjustment(barTs);
    const adjOpen = Number(bar.open) + adj;
    const adjHigh = Number(bar.high) + adj;
    const adjLow = Number(bar.low) + adj;
    const adjClose = Number(bar.close) + adj;

    await sender
      .table("ohlcv_continuous")
      .symbol("root", safeRoot)
      .floatColumn("open", adjOpen)
      .floatColumn("high", adjHigh)
      .floatColumn("low", adjLow)
      .floatColumn("close", adjClose)
      .floatColumn("volume", Number(bar.volume))
      .floatColumn("raw_close", Number(bar.close))
      .floatColumn("adjustment", adj)
      .at(barTs.getTime(), "ms");

    barsWritten++;

    // Flush every 10k rows
    if (barsWritten % 10000 === 0) {
      await sender.flush();
    }
  }

  // Write rollover records
  for (const r of rollovers) {
    await sender
      .table("rollovers")
      .symbol("root", r.root)
      .symbol("from_contract", r.from_contract)
      .symbol("to_contract", r.to_contract)
      .floatColumn("from_close", r.from_close)
      .floatColumn("to_close", r.to_close)
      .floatColumn("price_gap", r.price_gap)
      .symbol("rollover_type", r.rollover_type)
      .at(r.ts.getTime(), "ms");
  }

  await sender.flush();

  console.log(
    `[continuous] Wrote ${barsWritten} adjusted bars + ${rollovers.length} rollovers for ${safeRoot}`
  );

  return { rollovers, adjustments, barsWritten };
}
