/** The casebook's control values (mirrored into the URL by useStudyControls) and their defaults. */

export const DEFAULTS = {
  // section 0
  verdicts: "all",
  // sections 1-3 and 5 (the notebook's section 1 drives them all)
  timeframe: "1m",
  year: 2024,
  candle: 1,
  patternSide: "engulfing|bullish",
  population: "pattern",
  order: "time",
  draw: 1,
  step: 1,
  /** whose round-trip cost prices the trades: the casebook build's or the dashboard's cost_model.json */
  costSource: "casebook",
  // section 2
  view: "net",
  span: 98,
  lines: 20,
  // section 4 (its own candles and cost, as in the notebook); negative = "follow the default"
  ruleTimeframe: "1m",
  rule: "fade the last move",
  period: "2025-09-30 to 2025-12-30 (indicator study window)",
  ruleCost: -1,
  hitRate: -1,
  terms: 3,
  // section 5
  bins: 30,
  logCounts: false,
};

/** Not `as const`, so every value already has its base type (as useStudyControls widens them). */
export type Controls = typeof DEFAULTS;
export type SetControl = <K extends keyof typeof DEFAULTS>(key: K, value: Controls[K]) => void;

export const TIMEFRAME_LABELS: Record<string, string> = { "1m": "1 minute", "5m": "5 minutes", "15m": "15 minutes", "1h": "1 hour", "4h": "4 hours" };
export const YEARS = [2021, 2022, 2023, 2024, 2025] as const;

export function splitPatternSide(value: string): { pattern: string; side: string } {
  const [pattern = "engulfing", side = "bullish"] = value.split("|");
  return { pattern, side };
}
