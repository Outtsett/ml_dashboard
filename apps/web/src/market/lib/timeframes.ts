/**
 * Shared timeframe constants and helpers.
 * Single source of truth — every component that needs minutes→label
 * conversions, fetch limits, or timeframe option lists imports from here.
 */

export const TIMEFRAME_OPTIONS = [
  { minutes: 1,     label: '1m',  apiKey: '1m'  },
  { minutes: 5,     label: '5m',  apiKey: '5m'  },
  { minutes: 15,    label: '15m', apiKey: '15m' },
  { minutes: 30,    label: '30m', apiKey: '30m' },
  { minutes: 60,    label: '1H',  apiKey: '1h'  },
  { minutes: 240,   label: '4H',  apiKey: '4h'  },
  { minutes: 1440,  label: '1D',  apiKey: '1d'  },
  { minutes: 10080, label: '1W',  apiKey: '1w'  },
] as const;

export type TimeframeMinutes = (typeof TIMEFRAME_OPTIONS)[number]['minutes'];

/** Minutes → human-readable label (e.g. 60 → "1H"). */
export function minutesToLabel(m: number): string {
  return TIMEFRAME_OPTIONS.find(t => t.minutes === m)?.label ?? `${m}m`;
}

/** Minutes → lowercase API key used by lake SAMPLE BY (e.g. 60 → "1h"). */
export function minutesToApiKey(m: number): string {
  return TIMEFRAME_OPTIONS.find(t => t.minutes === m)?.apiKey ?? `${m}`;
}

/**
 * API key → minutes (e.g. "5m" → 5). The inverse of `minutesToApiKey`, for the
 * case where the timeframe arrives as a key from outside the toolbar — a Model
 * Cycle plan, which names its own. A key with no match is assumed to be minutes
 * already, so an unusual value passes through rather than becoming NaN.
 */
export function apiKeyToMinutes(key: string): number {
  const match = TIMEFRAME_OPTIONS.find(t => t.apiKey === key);
  if (match) return match.minutes;
  const parsed = Number.parseInt(key, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Build a Record<minutes, label> map — useful for Select/dropdown UIs. */
export const TF_LABELS: Record<number, string> = Object.fromEntries(
  TIMEFRAME_OPTIONS.map(t => [t.minutes, t.label]),
);

export const MAX_BARS_IN_MEMORY = 100_000;

/** Adaptive fetch limit: scale down for higher timeframes. */
export function getFetchLimit(timeframe: number): number {
  if (timeframe <= 1) return 50000;
  if (timeframe <= 5) return 25000;
  if (timeframe <= 15) return 15000;
  if (timeframe <= 30) return 2000;
  if (timeframe <= 60) return 1500;
  if (timeframe <= 240) return 1000;
  if (timeframe <= 1440) return 500;
  return 250;
}

