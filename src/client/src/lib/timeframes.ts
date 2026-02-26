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

/** Minutes → lowercase API key used by QuestDB SAMPLE BY (e.g. 60 → "1h"). */
export function minutesToApiKey(m: number): string {
  return TIMEFRAME_OPTIONS.find(t => t.minutes === m)?.apiKey ?? `${m}`;
}

/** Build a Record<minutes, label> map — useful for Select/dropdown UIs. */
export const TF_LABELS: Record<number, string> = Object.fromEntries(
  TIMEFRAME_OPTIONS.map(t => [t.minutes, t.label]),
);

export const MAX_BARS_IN_MEMORY = 50_000;

/** Adaptive fetch limit: scale down for higher timeframes. */
export function getFetchLimit(timeframe: number): number {
  if (timeframe <= 1) return 10000;
  if (timeframe <= 5) return 5000;
  if (timeframe <= 15) return 3000;
  if (timeframe <= 30) return 2000;
  if (timeframe <= 60) return 1500;
  if (timeframe <= 240) return 1000;
  if (timeframe <= 1440) return 500;
  return 250;
}
