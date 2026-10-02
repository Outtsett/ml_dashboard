import { useEffect } from 'react';

// --- Types ---

export type IndicatorDisplayType = 'overlay' | 'subchart' | 'marker';

export interface IndicatorOverlay {
  column: string;
  data: { time: number; value: number }[];
  color: string;
  displayType: IndicatorDisplayType;
  lineWidth: number;
}

export interface IndicatorCatalog {
  categories: Record<string, string[]>;
  total: number;
  columns: string[];
}

/** OHLCV bar shape expected by the hook (matches StitchedOHLCVBar). */
export interface OHLCVBarInput {
  timestamp: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// --- Constants ---

/**
 * Key the old indicator-dropdown pattern selection was persisted under.
 *
 * Candlestick patterns are label generators now, picked one at a time from the
 * label dropdown, so nothing writes this any more. It is still READ once, to
 * delete it: a browser that had all 63 selected would otherwise keep drawing the
 * wall of overlapping pills this move exists to get rid of, with no control left
 * anywhere in the UI to turn them off.
 */
const LEGACY_PATTERN_STORAGE_KEY = 'pattern-selection';

// --- Hook ---

/**
 * Chart indicator types, and the one-time cleanup of the retired pattern overlay.
 *
 * Candlestick patterns used to live here: selected in the indicator dropdown,
 * computed in the browser by hand-written detectors, and drawn as named pills
 * over the candles. Two things were wrong with that. The detectors disagreed
 * with TA-Lib on two thirds of their firings — measured over 500 MNQ daily bars,
 * 782 TA-Lib firings against 464 browser ones with only 311 in common. And a
 * pattern is a statement about one bar, which is a label, not a line drawn
 * through prices like a moving average.
 *
 * Both are fixed by the move: patterns are label generators now
 * (`candlePatternLabels.ts`), computed server-side by the real TA-Lib C library
 * through `/api/charts/candle-patterns`, and chosen one at a time.
 *
 * Indicators themselves are managed by `useActiveIndicators`.
 */
export function useIndicatorData() {
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_PATTERN_STORAGE_KEY);
    } catch {
      // A browser that will not let us clear it is one that will not let us read
      // it either, so there is nothing left to draw from it.
    }
  }, []);
}
