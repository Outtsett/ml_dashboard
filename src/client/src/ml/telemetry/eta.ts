/**
 * Estimated-time-of-arrival from a progress stream.
 *
 * Pure functions, no React, no clock of their own — the caller supplies
 * timestamps so this is deterministic under test.
 *
 * Why not linear extrapolation from the start: walk-forward training does not
 * progress at a constant rate. Early folds are cheap, later folds train on more
 * data, and a fold boundary stalls progress entirely while data is loaded.
 * Dividing elapsed time by percent-complete produces an ETA that lurches every
 * time the workload changes, which is worse than no ETA at all.
 *
 * Instead: take the median rate over a trailing window. The median ignores the
 * stall outliers that a mean would absorb, and the trailing window means a run
 * that genuinely speeds up or slows down is tracked rather than averaged away.
 */

export interface ProgressSample {
  /** Milliseconds, monotonic within a run. */
  t: number;
  /** Percent complete, 0-100. */
  progress: number;
}

/** Rate samples needed before an estimate is offered at all. */
const MIN_RATE_SAMPLES = 3;

/** How many trailing rate samples the median is taken over. */
export const DEFAULT_RATE_WINDOW = 12;

/** Largest sample buffer worth retaining. */
export const MAX_SAMPLES = 60;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Append a sample, dropping the buffer when progress moves backwards.
 *
 * Backwards progress means a new run started, or the previous run reset. The
 * old samples describe a different workload, so carrying them forward would
 * poison the estimate for the entire first minute of the new run.
 */
export function pushSample(
  samples: ProgressSample[],
  sample: ProgressSample,
  maxSamples = MAX_SAMPLES,
): ProgressSample[] {
  const last = samples[samples.length - 1];
  if (last && sample.progress < last.progress) return [sample];
  // Identical progress carries no rate information, but the timestamp matters:
  // replacing the last sample keeps the stall visible as elapsed time without
  // contributing a zero-rate sample that would drag the median to zero.
  if (last && sample.progress === last.progress) {
    return [...samples.slice(0, -1), sample];
  }
  const next = [...samples, sample];
  return next.length > maxSamples ? next.slice(-maxSamples) : next;
}

/**
 * Median progress rate in percent per millisecond, or null when unknown.
 *
 * Returns null rather than zero for "cannot tell" — zero is a real rate
 * meaning "stalled forever", and callers must be able to distinguish the two.
 */
export function trailingMedianRate(
  samples: ProgressSample[],
  window = DEFAULT_RATE_WINDOW,
): number | null {
  if (samples.length < MIN_RATE_SAMPLES + 1) return null;

  const rates: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i]!.t - samples[i - 1]!.t;
    const dp = samples[i]!.progress - samples[i - 1]!.progress;
    // A non-positive interval is a clock artifact, not data.
    if (dt <= 0) continue;
    rates.push(dp / dt);
  }

  const trailing = rates.slice(-window);
  if (trailing.length < MIN_RATE_SAMPLES) return null;

  const rate = median(trailing);
  return rate > 0 ? rate : null;
}

/**
 * Seconds remaining, or null when no honest estimate exists.
 *
 * Null is returned generously — for too few samples, for a stalled run, and for
 * a run already complete. Showing nothing is strictly better than showing a
 * number the user will watch drift and stop trusting.
 */
export function estimateEtaSeconds(
  samples: ProgressSample[],
  window = DEFAULT_RATE_WINDOW,
): number | null {
  const last = samples[samples.length - 1];
  if (!last) return null;
  if (last.progress >= 100) return null;

  const rate = trailingMedianRate(samples, window);
  if (rate === null) return null;

  const remaining = 100 - last.progress;
  return (remaining / rate) / 1000;
}

/** `95` → `1m 35s`. Compact enough for a status strip. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;

  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes < 60) return secs === 0 ? `${minutes}m` : `${minutes}m ${secs}s`;

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}
