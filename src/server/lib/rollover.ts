/**
 * Rollover Stitching — Pure functions for futures rollover schedule lookup,
 * contract segment building, and price back-adjustment.
 *
 * Uses the QuestDB `rollovers` table (353 rows, 8 roots) as the source of
 * truth for roll boundaries and adjustment values. Schedule is cached for
 * 24 hours since rollovers happen at most quarterly.
 *
 * The `cumulative_adjustment` column follows a "forward Panama" convention:
 *  - Most recent `to_contract` has cumulative_adjustment = 0
 *  - Older contracts accumulate the price gaps backward in time
 *  - To back-adjust: add cumulative_adjustment to OHLC prices
 */

import type { AdjustmentMode, StitchedOHLCVBar } from "@shared/ohlcv";
import { queryQuestDB } from "../database/questdb/connection";
import { validateSymbol } from "@shared/schema";

// ─── Types ──────────────────────────────────────────────────

/** A single rollover event from the QuestDB rollovers table. */
export interface RolloverRecord {
  root: string;
  rollover_date: string;
  from_contract: string;
  to_contract: string;
  from_close: number;
  to_close: number;
  price_gap: number;
  cumulative_adjustment: number;
}

/** A time segment assigned to a single contract with its adjustment factors. */
export interface ContractSegment {
  contract: string;
  start: string;       // ISO timestamp
  end: string;         // ISO timestamp
  panamaOffset: number;
  ratioFactor: number;
}

// ─── Schedule Cache (24h TTL) ───────────────────────────────

interface CachedSchedule {
  data: RolloverRecord[];
  fetchedAt: number;
}

const scheduleCache = new Map<string, CachedSchedule>();
const SCHEDULE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Fetch the rollover schedule for a root symbol from QuestDB.
 * Cached for 24 hours since rollovers change at most quarterly.
 */
export async function getRolloverSchedule(root: string): Promise<RolloverRecord[]> {
  const safeRoot = validateSymbol(root);
  const cached = scheduleCache.get(safeRoot);
  if (cached && Date.now() - cached.fetchedAt < SCHEDULE_TTL_MS) {
    return cached.data;
  }

  const escaped = safeRoot.replace(/'/g, "''");
  const rows = await queryQuestDB<{
    root: string;
    rollover_date: Date | string;
    from_contract: string;
    to_contract: string;
    from_close: number | string;
    to_close: number | string;
    price_gap: number | string;
    cumulative_adjustment: number | string;
  }>(
    `SELECT root, rollover_date, from_contract, to_contract,
            from_close, to_close, price_gap, cumulative_adjustment
     FROM rollovers
     WHERE root = '${escaped}'
     ORDER BY rollover_date`
  );

  const records: RolloverRecord[] = rows.map(r => ({
    root: r.root,
    rollover_date: r.rollover_date instanceof Date
      ? r.rollover_date.toISOString()
      : new Date(String(r.rollover_date)).toISOString(),
    from_contract: r.from_contract,
    to_contract: r.to_contract,
    from_close: Number(r.from_close),
    to_close: Number(r.to_close),
    price_gap: Number(r.price_gap),
    cumulative_adjustment: Number(r.cumulative_adjustment),
  }));

  scheduleCache.set(safeRoot, { data: records, fetchedAt: Date.now() });
  return records;
}

/** Clear cached rollover schedule. Call after ingesting new rollover data. */
export function clearRolloverCache(root?: string): void {
  if (root) {
    scheduleCache.delete(root.toUpperCase());
  } else {
    scheduleCache.clear();
  }
}

// ─── Segment Builder (Pure) ─────────────────────────────────

const EPOCH_MIN = "1970-01-01T00:00:00.000Z";
const EPOCH_MAX = "2099-12-31T23:59:59.999Z";

/**
 * Build contract segments from a rollover schedule for a given time range.
 *
 * Think of it as a timeline ruler where each colored section is a different
 * contract. The rollover dates are the tick marks where the color changes.
 *
 * @param schedule  Rollover records for one root, ordered by rollover_date ASC
 * @param startMs   Query start time (epoch-ms), undefined = earliest available
 * @param endMs     Query end time (epoch-ms), undefined = latest available
 */
export function buildContractSegments(
  schedule: RolloverRecord[],
  startMs?: number,
  endMs?: number,
): ContractSegment[] {
  if (schedule.length === 0) return [];

  const segments: ContractSegment[] = [];
  const startIso = startMs ? new Date(startMs).toISOString() : EPOCH_MIN;
  const endIso = endMs ? new Date(endMs).toISOString() : EPOCH_MAX;

  // Compute ratio factors by chaining backward from latest (1.0)
  // ratioFactor[i] = product of (from_close / to_close) for all rollovers after i
  const ratioFactors = computeRatioFactors(schedule);

  // Segment 0: from_contract of first rollover, covering all time BEFORE first roll
  const firstRoll = schedule[0]!;
  const preRollEnd = offsetMs(firstRoll.rollover_date, -1);
  // Panama offset for the pre-first-rollover segment:
  // The from_contract is one step older than the first to_contract,
  // so its offset = first.cumulative_adjustment + first.price_gap
  const preRollPanama = firstRoll.cumulative_adjustment + firstRoll.price_gap;
  const preRollRatio = ratioFactors[0]! * (firstRoll.from_close / firstRoll.to_close);

  segments.push({
    contract: firstRoll.from_contract,
    start: EPOCH_MIN,
    end: preRollEnd,
    panamaOffset: preRollPanama,
    ratioFactor: preRollRatio,
  });

  // Segments 1..N-1: each to_contract is active from its rollover_date
  // until the NEXT rollover_date - 1ms
  for (let i = 0; i < schedule.length; i++) {
    const roll = schedule[i]!;
    const nextRoll = schedule[i + 1];
    const segEnd = nextRoll ? offsetMs(nextRoll.rollover_date, -1) : EPOCH_MAX;

    segments.push({
      contract: roll.to_contract,
      start: roll.rollover_date,
      end: segEnd,
      panamaOffset: roll.cumulative_adjustment,
      ratioFactor: ratioFactors[i]!,
    });
  }

  // Clip segments to the requested [start, end] range
  return clipSegments(segments, startIso, endIso);
}

/** Compute chained ratio factors from latest (1.0) backward. */
function computeRatioFactors(schedule: RolloverRecord[]): number[] {
  const factors = new Array<number>(schedule.length);
  let cumRatio = 1.0;

  // Walk backward from most recent rollover
  for (let i = schedule.length - 1; i >= 0; i--) {
    factors[i] = cumRatio;
    const roll = schedule[i]!;
    if (roll.to_close !== 0) {
      cumRatio *= roll.from_close / roll.to_close;
    }
  }

  return factors;
}

/** Offset an ISO timestamp by the given milliseconds. */
function offsetMs(isoDate: string, ms: number): string {
  return new Date(new Date(isoDate).getTime() + ms).toISOString();
}

/** Clip segments to a [start, end] range, discarding those entirely outside. */
function clipSegments(
  segments: ContractSegment[],
  startIso: string,
  endIso: string,
): ContractSegment[] {
  const result: ContractSegment[] = [];

  for (const seg of segments) {
    // Entirely before the requested range
    if (seg.end < startIso) continue;
    // Entirely after the requested range
    if (seg.start > endIso) continue;

    result.push({
      ...seg,
      start: seg.start < startIso ? startIso : seg.start,
      end: seg.end > endIso ? endIso : seg.end,
    });
  }

  return result;
}

// ─── Price Adjustment (Pure) ────────────────────────────────

/**
 * Apply price adjustment to a set of OHLCV bars.
 * Returns a new array — does not mutate input.
 */
export function applyAdjustment(
  bars: Array<{
    timestamp: any;
    open: number | string;
    high: number | string;
    low: number | string;
    close: number | string;
    volume: number | string;
    symbol?: string;
  }>,
  contract: string,
  segment: { panamaOffset: number; ratioFactor: number },
  mode: AdjustmentMode,
): StitchedOHLCVBar[] {
  return bars.map(bar => {
    const o = Number(bar.open);
    const h = Number(bar.high);
    const l = Number(bar.low);
    const c = Number(bar.close);

    let open: number, high: number, low: number, close: number;

    switch (mode) {
      case "panama":
        open = o + segment.panamaOffset;
        high = h + segment.panamaOffset;
        low = l + segment.panamaOffset;
        close = c + segment.panamaOffset;
        break;
      case "ratio":
        open = o * segment.ratioFactor;
        high = h * segment.ratioFactor;
        low = l * segment.ratioFactor;
        close = c * segment.ratioFactor;
        break;
      default:
        open = o;
        high = h;
        low = l;
        close = c;
    }

    return {
      timestamp: bar.timestamp,
      open,
      high,
      low,
      close,
      volume: Number(bar.volume),
      activeContract: contract,
    };
  });
}
