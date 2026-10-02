/**
 * The live BarSource: tails bars that LiveBridge is writing right now.
 *
 * The producer already exists and already runs. `LiveBridge`, loaded as
 * a live strategy, streams bars and ticks straight into QuestDB over
 * Influx Line Protocol whenever the platform is up. It writes `qt_bars_1m`
 * (tagged `source=live` for bars taken from HistoricalData, or
 * `source=ticks` for bars folded from the trade stream) and `qt_ticks`.
 *
 * So "live" here is not a vendor client — it is a tail of a table another
 * process is appending to. Polling rather than pushing is the right shape for
 * that: QuestDB has no change feed, and the bridge's own write cadence, not
 * this poll, sets how fresh the data can be.
 *
 * Note this reads `qt_bars_1m`, NOT `ohlcv_1m`. The latter is the historical
 * table and stopped receiving data on 2026-03-30; they are separate lineages
 * and conflating them is how a stale chart looks healthy.
 */

import { partialBar, type Bar, type PartialBar } from './barFormation.js';
import type { BarSource, BarSourceOptions } from './barSource.js';

export const LIVE_BARS_TABLE = 'qt_bars_1m';

interface QtBarRow {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LiveSourceOptions extends BarSourceOptions {
  /** How often to look for new rows. */
  pollIntervalMs?: number;
}

export class QuestDBLiveSource implements BarSource {
  readonly kind = 'live' as const;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private active = false;

  /** Newest bar timestamp already emitted, so a poll never re-sends one. */
  private watermark: number | null = null;

  constructor(private readonly options: LiveSourceOptions) {}

  get running(): boolean {
    return this.active;
  }

  get description(): string {
    return (
      `Live ${this.options.symbol} 1m bars from ${LIVE_BARS_TABLE}, written by ` +
      `LiveBridge while the platform is running.`
    );
  }

  async start(onFrame: (frame: PartialBar) => void): Promise<void> {
    const { symbol, pollIntervalMs = 2000 } = this.options;

    // Start at the present. Every bar already in the table was written while
    // nothing was listening, and replaying them now would flood the chart with
    // history dressed up as live prints — the same reasoning the bridge itself
    // applies to its signal high-water mark.
    this.watermark = await this.newestTimestamp(symbol);
    this.stopped = false;
    this.active = true;

    return new Promise<void>((resolve) => {
      const poll = async () => {
        if (this.stopped) {
          resolve();
          return;
        }

        try {
          const bars = await this.barsSince(symbol, this.watermark);
          for (const bar of bars) {
            // A bar arriving from the tail is already complete — the bridge
            // only writes a minute once it has closed. Emitting it as a closed
            // frame is therefore the truth; synthesising formation frames here
            // would animate a bar that has in fact already finished.
            onFrame(partialBar(bar, 1));
            this.watermark = Math.max(this.watermark ?? 0, bar.timestamp);
          }
        } catch {
          // A transient QuestDB failure must not end the stream. The next poll
          // retries, and the watermark means nothing is missed or duplicated.
        }

        this.timer = setTimeout(poll, pollIntervalMs);
      };

      void poll();
    }).finally(() => {
      this.active = false;
    });
  }

  stop(): void {
    this.stopped = true;
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async query<T>(sql: string): Promise<T[]> {
    const { queryQuestDB } = await import(
      '../../infrastructure/database/questdb/connection.js'
    );
    return queryQuestDB<T>(sql);
  }

  private escape(value: string): string {
    return value.replace(/'/g, "''");
  }

  private async newestTimestamp(symbol: string): Promise<number | null> {
    const rows = await this.query<{ latest: string | null }>(
      `SELECT max(timestamp) latest FROM ${LIVE_BARS_TABLE} WHERE symbol = '${this.escape(symbol)}'`,
    );
    const raw = rows[0]?.latest;
    if (!raw) return null;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async barsSince(symbol: string, since: number | null): Promise<Bar[]> {
    const where = since === null
      ? `symbol = '${this.escape(symbol)}'`
      : `symbol = '${this.escape(symbol)}' AND timestamp > '${new Date(since).toISOString()}'`;

    const rows = await this.query<QtBarRow>(
      `SELECT timestamp, open, high, low, close, volume FROM ${LIVE_BARS_TABLE} ` +
        `WHERE ${where} ORDER BY timestamp ASC LIMIT 200`,
    );

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
      );
  }
}
