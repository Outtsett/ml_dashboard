/**
 * Walk-Forward Validation — Rolling train/test window computation.
 *
 * SRP: Pure functions only — computes windows from dates. No I/O.
 * OCP: New walk-forward strategies add functions here, orchestrator dispatches.
 */

import crypto from "crypto";

export interface WalkForwardConfig {
  trainMonths: number;
  testMonths: number;
  stepMonths?: number; // Default: testMonths (non-overlapping test windows)
}

export interface WalkForwardWindow {
  index: number;
  trainStart: string;  // ISO date YYYY-MM-DD
  trainEnd: string;
  testStart: string;
  testEnd: string;
}

/** Compute walk-forward windows from a date range. */
export function computeWindows(
  dateStart: string,
  dateEnd: string,
  config: WalkForwardConfig,
): WalkForwardWindow[] {
  const start = new Date(dateStart);
  const end = new Date(dateEnd);
  const step = config.stepMonths ?? config.testMonths;

  const windows: WalkForwardWindow[] = [];
  let windowStart = new Date(start);
  let index = 0;

  while (index < 50) { // Safety cap
    const trainEnd = addMonths(windowStart, config.trainMonths);
    const testStart = new Date(trainEnd);
    const testEnd = addMonths(testStart, config.testMonths);

    // Stop if test window extends beyond data range
    if (testEnd > end) break;

    windows.push({
      index,
      trainStart: toDateStr(windowStart),
      trainEnd: toDateStr(trainEnd),
      testStart: toDateStr(testStart),
      testEnd: toDateStr(testEnd),
    });

    windowStart = addMonths(windowStart, step);
    index++;
  }

  return windows;
}

/** Generate a unique walk-forward group ID. */
export function generateGroupId(): string {
  return `wf_${crypto.randomUUID().split("-")[0]}`;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function toDateStr(date: Date): string {
  return date.toISOString().split("T")[0]!;
}
