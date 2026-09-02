/**
 * BarSource — the seam between "where bars come from" and everything
 * downstream.
 *
 * Two implementations, both real:
 *
 *   - `QuestDBLiveSource` tails `qt_bars_1m`, which `QuantowerBridge.cs` writes
 *     over Influx Line Protocol while Quantower is running. This is the live
 *     path and it works today.
 *   - `QuestDBReplaySource` replays stored bars out of the historical
 *     `ohlcv_1m` table, for working on the chart when the platform is closed.
 *
 * A correction worth recording, because it was wrong in this file for a day:
 * the removal of the legacy export path on 2026-07-27 did NOT leave the
 * system without ingestion. QuantowerBridge replaced it. What the removal left
 * behind was a *stale table* — `ohlcv_1m` stopped receiving data on 2026-03-30
 * — while live bars accumulated in `qt_bars_1m` under a different name. The
 * dashboard reading the old table is what made the feed look dead.
 *
 * The lesson for anything added here: a source that reports nothing is
 * indistinguishable from a market that is closed. Say which table you read and
 * why, and make every event carry its origin.
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

/** Where a stream's bars came from, carried on every emitted event. */
export type BarOrigin = 'replay' | 'live';
