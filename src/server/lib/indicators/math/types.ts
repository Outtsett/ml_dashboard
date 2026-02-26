import type { OHLCVBar as SharedOHLCVBar } from '@shared/ohlcv';

/**
 * Math functions accept loose timestamp types. Callers should normalise
 * timestamps (via server/lib/normalize.ts) before they reach the API layer.
 */
export interface OHLCVBar extends Omit<SharedOHLCVBar, 'timestamp'> {
  timestamp: Date | string | number;
}
