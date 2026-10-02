/**
 * Parameter defaults and clamping.
 *
 * Every entry point takes a fully-formed LensEvaluationParams; the server hands
 * whatever arrived on the query string to `clampLensParams` first, so a
 * malformed or hostile value can never reach the compute.
 */

import {
  LENS_PARAM_BOUNDS,
  defaultLensParams,
  type LensEvaluationParams,
  type LensIntervalCoverage,
  type LensManifest,
} from "./types";

const COVERAGES: readonly LensIntervalCoverage[] = [0.5, 0.8, 0.9];

function clampNumber(value: unknown, fallback: number, bounds: { min: number; max: number }): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < bounds.min) return bounds.min;
  if (numeric > bounds.max) return bounds.max;
  return numeric;
}

function clampInteger(value: unknown, fallback: number, bounds: { min: number; max: number }): number {
  return Math.round(clampNumber(value, fallback, bounds));
}

function clampCoverage(value: unknown, fallback: LensIntervalCoverage): LensIntervalCoverage {
  const numeric = typeof value === "number" ? value : Number(value);
  for (const coverage of COVERAGES) {
    if (coverage === numeric) return coverage;
  }
  return fallback;
}

function optionalTimestamp(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.round(numeric);
}

/**
 * Fill every missing field from `defaultLensParams(manifest)`, clamp each one
 * to LENS_PARAM_BOUNDS, and hold `rollingWindowBars` at or below the record's
 * own length so a rolling window can never demand rows that do not exist.
 */
export function clampLensParams(
  params: Partial<LensEvaluationParams>,
  manifest: LensManifest,
): LensEvaluationParams {
  const defaults = defaultLensParams(manifest);
  const bounds = LENS_PARAM_BOUNDS;

  const barCount = Number.isFinite(manifest.barCount) && manifest.barCount > 0 ? manifest.barCount : bounds.rollingWindowBars.min;
  const rollingWindowBars = Math.min(
    Math.max(bounds.rollingWindowBars.min, Math.min(barCount, bounds.rollingWindowBars.max)),
    clampInteger(params.rollingWindowBars, defaults.rollingWindowBars, bounds.rollingWindowBars),
  );

  const startTimestampSeconds = optionalTimestamp(params.startTimestampSeconds);
  const endTimestampSeconds = optionalTimestamp(params.endTimestampSeconds);
  const ordered =
    startTimestampSeconds !== undefined && endTimestampSeconds !== undefined && startTimestampSeconds > endTimestampSeconds
      ? { start: endTimestampSeconds, end: startTimestampSeconds }
      : { start: startTimestampSeconds, end: endTimestampSeconds };

  const clamped: LensEvaluationParams = {
    threshold: clampNumber(params.threshold, defaults.threshold, bounds.threshold),
    costMultiplier: clampNumber(params.costMultiplier, defaults.costMultiplier, bounds.costMultiplier),
    rollingWindowBars,
    rollingWindowTrades: clampInteger(params.rollingWindowTrades, defaults.rollingWindowTrades, bounds.rollingWindowTrades),
    regimeLookbackBars: clampInteger(params.regimeLookbackBars, defaults.regimeLookbackBars, bounds.regimeLookbackBars),
    regimeThreshold: clampNumber(params.regimeThreshold, defaults.regimeThreshold, bounds.regimeThreshold),
    intervalCoverage: clampCoverage(params.intervalCoverage, defaults.intervalCoverage),
  };
  if (ordered.start !== undefined) clamped.startTimestampSeconds = ordered.start;
  if (ordered.end !== undefined) clamped.endTimestampSeconds = ordered.end;
  return clamped;
}

/** True when `params` is exactly the a-priori default set for this manifest. */
export function isDefaultLensParams(params: LensEvaluationParams, manifest: LensManifest): boolean {
  const defaults = defaultLensParams(manifest);
  return (
    params.threshold === defaults.threshold &&
    params.costMultiplier === defaults.costMultiplier &&
    params.rollingWindowBars === defaults.rollingWindowBars &&
    params.rollingWindowTrades === defaults.rollingWindowTrades &&
    params.regimeLookbackBars === defaults.regimeLookbackBars &&
    params.regimeThreshold === defaults.regimeThreshold &&
    params.intervalCoverage === defaults.intervalCoverage &&
    params.startTimestampSeconds === undefined &&
    params.endTimestampSeconds === undefined
  );
}
