/**
 * The dashboard selection is minutes; ML Studio's pipeline is a closed set of
 * codes. These two functions are the whole bridge, so they are pinned: every
 * Studio timeframe must round-trip, and a chart interval Studio cannot train on
 * must come back null rather than being coerced to a neighbour.
 */

import { describe, it, expect } from 'vitest';
import {
  studioTimeframeOf,
  minutesOfStudioTimeframe,
} from '../src/ml/StudioSelectionSync';
import type { Timeframe } from '../src/ml/MLStudioContext';

const STUDIO_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

describe('studio selection bridge', () => {
  it('round-trips every Studio timeframe through minutes', () => {
    for (const timeframe of STUDIO_TIMEFRAMES) {
      expect(studioTimeframeOf(minutesOfStudioTimeframe(timeframe))).toBe(timeframe);
    }
  });

  it('maps the day and week intervals to their minute counts', () => {
    expect(minutesOfStudioTimeframe('1d')).toBe(1440);
    expect(minutesOfStudioTimeframe('1w')).toBe(10080);
  });

  it('returns null for an interval Studio has no pipeline for', () => {
    expect(studioTimeframeOf(3)).toBeNull();
    expect(studioTimeframeOf(120)).toBeNull();
    expect(studioTimeframeOf(0)).toBeNull();
  });
});
