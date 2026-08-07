/**
 * BarSource — the seam between "where bars come from" and everything
 * downstream.
 *
 * Live market-data ingestion has been dead since the MotiveWave export path
 * was removed on 2026-07-27; QuestDB's newest 1m bar predates that. Rather
 * than block the whole live surface on choosing and wiring a paid feed, the
 * pipeline is built against this interface and driven by a replay of real
 * stored bars. That exercises the entire path — source, event bus, SSE,
 * chart — with real data at zero cost.
 *
 * Swapping in a genuine live feed is then one implementation of this
 * interface, with nothing downstream changing. That is the whole point of the
 * seam: the replay is scaffolding for the plumbing, not a simulation anyone
 * should mistake for a market.
 */

import type { Bar, PartialBar } from './barFormation.js';

export type { Bar, PartialBar };

export interface BarSourceOptions {
  symbol: string;
  /** Bar interval, e.g. '1m'. Must match a stored table for replay sources. */
  timeframe: string;
  /**
   * Wall-clock milliseconds between emitted frames. Governs animation
   * smoothness, not market time.
   */
  frameIntervalMs?: number;
  /**
   * Intermediate frames per bar. 0 emits closed bars only, which is the right
   * setting when replaying fast enough that intra-bar motion is noise.
   */
  framesPerBar?: number;
  /** Stop after this many bars. Unbounded when omitted. */
  maxBars?: number;
}

export interface BarSource {
  readonly kind: 'replay' | 'live';
  /** Human-readable description of what is actually feeding the stream. */
  readonly description: string;
  /**
   * Begin producing frames. Resolves when the source stops on its own
   * (a replay reaching its end); rejects if it cannot start.
   */
  start(onFrame: (frame: PartialBar) => void): Promise<void>;
  stop(): void;
  readonly running: boolean;
}

/**
 * Placeholder for a real feed.
 *
 * Deliberately fails loudly instead of silently producing nothing. A live
 * source that quietly emits no bars is indistinguishable from a market that
 * is closed, and that ambiguity is exactly how "the data looks stale" goes
 * unnoticed for four months.
 */
export class UnconfiguredLiveSource implements BarSource {
  readonly kind = 'live' as const;
  readonly description =
    'No live market-data feed is configured. Ingestion has been dead since the ' +
    'MotiveWave export path was removed on 2026-07-27. Wire a real producer ' +
    '(Databento, Interactive Brokers, or a Quantower export) behind BarSource.';

  get running(): boolean {
    return false;
  }

  start(): Promise<void> {
    return Promise.reject(new Error(this.description));
  }

  stop(): void {
    /* nothing to stop */
  }
}
