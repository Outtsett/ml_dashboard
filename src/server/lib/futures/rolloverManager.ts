/**
 * Rollover Manager — Core logic for volume-based rollover detection and
 * price adjustment calculation for futures contracts.
 */

import { queryQuestDB } from "../../database/questdb/connection";
import { validateSymbol } from "@shared/schema";

export interface RolloverEvent {
  root: string;
  rollover_date: string;
  from_contract: string;
  to_contract: string;
  from_close: number;
  to_close: number;
  price_gap: number;
}

/**
 * Automatically detects rollovers for a given futures root symbol
 * based on volume leaders.
 */
export async function detectRollovers(root: string): Promise<RolloverEvent[]> {
  if (!root || typeof root !== 'string') {
    throw new Error('Invalid symbol for rollover lookup');
  }
  const safeRoot = validateSymbol(root);
  const escaped = safeRoot.replace(/'/g, "''");
  
  // 1. Get daily volume and last close for all contracts under this root
  // Uses root SYMBOL INDEX instead of regex scan
  const rows = await queryQuestDB<{
    timestamp: Date;
    symbol: string;
    volume: number;
    close: number;
  }>(`
    SELECT timestamp, symbol, sum(volume) as volume, last(close) as close
    FROM ohlcv
    WHERE root = '${escaped}' AND asset_class = 'futures'
    AND symbol != '${escaped}'
    SAMPLE BY 1d ALIGN TO CALENDAR
    ORDER BY timestamp ASC, volume DESC
  `);

  if (rows.length === 0) return [];

  const dailyData = new Map<string, Map<string, { volume: number; close: number }>>();
  for (const row of rows) {
    const day = row.timestamp.toISOString().slice(0, 10);
    if (!dailyData.has(day)) dailyData.set(day, new Map());
    dailyData.get(day)!.set(row.symbol, { volume: Number(row.volume), close: Number(row.close) });
  }

  const sortedDays = [...dailyData.keys()].sort();
  const events: RolloverEvent[] = [];
  
  // Initialize current leader as the volume leader of the first day
  const firstDayKey = sortedDays[0];
  if (!firstDayKey) return [];
  const firstDay = dailyData.get(firstDayKey)!;
  let currentLeader = [...firstDay.entries()].sort((a, b) => b[1].volume - a[1].volume)[0]![0];

  for (const day of sortedDays) {
    const contracts = dailyData.get(day)!;
    
    // Find volume leader for the day
    const dayLeader = [...contracts.entries()].sort((a, b) => b[1].volume - a[1].volume)[0]!;
    
    if (dayLeader[0] !== currentLeader) {
      // Transition! 
      // We only transition if the NEW leader actually has data on this day.
      const fromClose = contracts.get(currentLeader)?.close;
      const toClose = dayLeader[1].close;

      if (fromClose !== undefined && toClose !== undefined) {
        events.push({
          root: safeRoot,
          rollover_date: day,
          from_contract: currentLeader,
          to_contract: dayLeader[0],
          from_close: fromClose,
          to_close: toClose,
          price_gap: toClose - fromClose,
        });
        currentLeader = dayLeader[0];
      }
    }
  }

  return events;
}

/**
 * Syncs the rollovers table and calculates cumulative adjustments.
 */
export async function syncRollovers(root: string): Promise<void> {
  const events = await detectRollovers(root);
  if (events.length === 0) return;

  // Since we can't easily UPDATE in QuestDB, we'll calculate everything 
  // in-memory and then INSERT with DEDUP.
  
  // Sort events by date descending to calculate cumulative adjustments (back-adjustment)
  const sortedEvents = events.sort((a, b) => b.rollover_date.localeCompare(a.rollover_date));
  
  let runningAdj = 0;
  for (const e of sortedEvents) {
    await queryQuestDB(`
      INSERT INTO rollovers (
        root, rollover_date, from_contract, to_contract, 
        from_close, to_close, price_gap, cumulative_adjustment
      ) VALUES (
        '${e.root}', '${e.rollover_date}T00:00:00.000Z', 
        '${e.from_contract}', '${e.to_contract}',
        ${e.from_close}, ${e.to_close}, ${e.price_gap}, ${runningAdj}
      )
    `);
    
    runningAdj -= e.price_gap;
  }
}
