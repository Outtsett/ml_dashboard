/**
 * A BarSource that replays real stored bars out of QuestDB.
 *
 * This exists because live ingestion is dead, not because replaying history is
 * a good substitute for a market. It drives the full pipeline — event bus,
 * SSE, chart animation — with real data so that when a live producer is wired
 * in, the only untested thing is the producer itself.
 *
 * Every frame it emits is marked as replay at the event level, so nothing
 * downstream can mistake it for live market data.
 */

import { formationFrames, type Bar, type PartialBar } from './barFormation.js';
import type { BarSource, BarSourceOptions } from './barSource.js';

/** Timeframe → QuestDB table. Only tables known to hold OHLCV bars. */
const TIMEFRAME_TABLES: Record<string, string> = {
  '1m': 'ohlcv_1m',
  '5m': 'ohlcv_5m',
  '15m': 'ohlcv_15m',
  '30m': 'ohlcv_30m',
  '1h': 'ohlcv_1h',
  '4h': 'ohlcv_4h',
  '1d': 'ohlcv_1d',
};

interface OhlcvRow {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class QuestDBReplaySource implements BarSource {
  readonly kind = 'replay' as const;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private active = false;

  constructor(private readonly options: BarSourceOptions) {}

  get running(): boolean {
    return this.active;
  }

  get description(): string {
    const { symbol, timeframe } = this.options;
    return `Replay of stored ${symbol} ${timeframe} bars from QuestDB — not live market data.`;
  }

  async start(onFrame: (frame: PartialBar) => void): Promise<void> {
    const {
      symbol,
      timeframe,
      frameIntervalMs = 250,
      framesPerBar = 4,
      maxBars = 500,
    } = this.options;

    const table = TIMEFRAME_TABLES[timeframe];
    if (!table) {
      throw new Error(
        `No stored table for timeframe '${timeframe}'. Known: ${Object.keys(TIMEFRAME_TABLES).join(', ')}`,
      );
    }

    const bars = await this.loadBars(table, symbol, maxBars);
    if (bars.length === 0) {
      // An empty replay would look identical to a quiet market. Say so.
      throw new Error(
        `No stored bars for ${symbol} in ${table}. Market-data ingestion has been ` +
          `dead since 2026-07-27; this symbol may never have been ingested.`,
      );
    }

    this.stopped = false;
    this.active = true;

    try {
      await this.emitFrames(bars, framesPerBar, frameIntervalMs, onFrame);
    } finally {
      this.active = false;
    }
  }

  stop(): void {
    this.stopped = true;
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async loadBars(table: string, symbol: string, limit: number): Promise<Bar[]> {
    const { queryQuestDB } = await import(
      '../../infrastructure/database/questdb/connection.js'
    );

    // Newest N, then reversed: taking the OLDEST N would replay whatever
    // happened to be ingested first, which for this data is 2019.
    const sql =
      `SELECT timestamp, open, high, low, close, volume FROM ${table} ` +
      `WHERE symbol = '${symbol.replace(/'/g, "''")}' ` +
      `ORDER BY timestamp DESC LIMIT ${Math.max(1, Math.floor(limit))}`;

    const rows = await queryQuestDB<OhlcvRow>(sql);

    return rows
      .map((r) => ({
        symbol,
        timestamp: Date.parse(r.timestamp),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume ?? 0),
      }))
      .filter(
        (b) =>
          Number.isFinite(b.timestamp) &&
          Number.isFinite(b.open) &&
          Number.isFinite(b.close),
      )
      .reverse();
  }

  private emitFrames(
    bars: Bar[],
    framesPerBar: number,
    frameIntervalMs: number,
    onFrame: (frame: PartialBar) => void,
  ): Promise<void> {
    return new Promise((resolve) => {
      const queue: PartialBar[] = [];
      for (const bar of bars) queue.push(...formationFrames(bar, framesPerBar));

      let i = 0;
      const tick = () => {
        if (this.stopped || i >= queue.length) {
          resolve();
          return;
        }
        onFrame(queue[i]!);
        i++;
        this.timer = setTimeout(tick, frameIntervalMs);
      };
      tick();
    });
  }
}
