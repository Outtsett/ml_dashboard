/**
 * Progressive bar formation.
 *
 * A replayed historical bar arrives complete. Dropping it onto the chart whole
 * makes the chart lurch once per interval, which is exactly the "hard refresh"
 * feel the live surface is meant to replace. Instead each bar is revealed the
 * way a real one forms: open first, high and low expanding outward, close
 * walking toward its final value.
 *
 * Pure functions, no clock of their own — the caller supplies progress, so
 * this is deterministic under test.
 *
 * The two invariants that make it honest:
 *
 *   1. **High and low never contract.** A real bar's range only ever grows
 *      within its interval. If the interpolation let them shrink, the chart
 *      would show a wick retracting, which cannot happen in a market and
 *      immediately reads as a rendering bug.
 *   2. **The final frame equals the true bar exactly.** No accumulated
 *      floating-point drift, no "close enough" — at progress 1 the emitted bar
 *      is the historical bar, so the committed candle matches the data.
 */

export interface Bar {
  symbol: string;
  /** Epoch milliseconds of the bar's opening edge. */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A bar still forming, plus how far through its interval it is. */
export interface PartialBar extends Bar {
  /** 0..1. Reaches exactly 1 on the closing frame. */
  progress: number;
  /** True on the final frame, when the bar should be committed. */
  isClosed: boolean;
}

/**
 * Ease the close's walk from open to final.
 *
 * A linear walk looks mechanical — price does not drift at constant speed. A
 * smoothstep gives the motion some weight without implying any real
 * intra-bar path, which we do not have and must not fabricate: this is a
 * presentation of a known open and close, not a claim about what happened
 * between them.
 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The bar as it looked `progress` of the way through its interval.
 *
 * `progress` is clamped, so a caller that overshoots gets the closed bar
 * rather than an extrapolation past the real close.
 */
export function partialBar(bar: Bar, progress: number): PartialBar {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;

  // The closing frame is the true bar, byte for byte. Returning it directly
  // rather than letting the interpolation land on it avoids any chance of the
  // committed candle differing from the stored one.
  if (p >= 1) {
    return { ...bar, progress: 1, isClosed: true };
  }

  const eased = smoothstep(p);
  const close = bar.open + (bar.close - bar.open) * eased;

  // Expand the extremes toward their final values proportionally, but never
  // inside the range already established by open and the current close.
  const seenHigh = Math.max(bar.open, close);
  const seenLow = Math.min(bar.open, close);
  const high = Math.max(seenHigh, bar.open + (bar.high - bar.open) * eased);
  const low = Math.min(seenLow, bar.open - (bar.open - bar.low) * eased);

  return {
    ...bar,
    high,
    low,
    close,
    volume: bar.volume * p,
    progress: p,
    isClosed: false,
  };
}

/**
 * The frames for one bar, `steps` intermediate plus a final closing frame.
 *
 * `steps` of 0 yields just the closed bar — the correct degenerate case for a
 * replay running fast enough that intra-bar animation is pointless.
 */
export function formationFrames(bar: Bar, steps: number): PartialBar[] {
  const n = Math.max(0, Math.floor(steps));
  const frames: PartialBar[] = [];
  for (let i = 0; i < n; i++) {
    frames.push(partialBar(bar, (i + 1) / (n + 1)));
  }
  frames.push(partialBar(bar, 1));
  return frames;
}

/**
 * Merge a newly-arrived bar into the currently-open one.
 *
 * Used on the client, where updates for the same timestamp must coalesce
 * rather than append. Returns the incoming bar unchanged when the timestamps
 * differ — that is a new bar, not an update to the current one.
 */
export function mergeBar(current: Bar | null, incoming: Bar): Bar {
  if (!current || current.timestamp !== incoming.timestamp) return incoming;
  return {
    ...incoming,
    // Open belongs to whoever opened the bar; a later frame must not move it.
    open: current.open,
    high: Math.max(current.high, incoming.high),
    low: Math.min(current.low, incoming.low),
    volume: Math.max(current.volume, incoming.volume),
  };
}
