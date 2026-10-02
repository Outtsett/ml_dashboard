/**
 * The body of GET /api/studies/talib-indicator-catalogue, shared by the handler and the page,
 * plus the pure helpers both use (the column presets, the display thinning stride, the histogram
 * re-binning). The study replaced datalake/notebooks/mnq_talib_1m.py and is generic over the three
 * TA-Lib bar sets the lake holds (1-minute, 1-hour, 4-hour).
 *
 * One endpoint, three parts, so a slider on the wide table never refetches the catalogue:
 *   part=catalogue  every column's statistics, histogram and trend, plus the bar set's summary
 *   part=wide       one window of bars with the chosen indicator columns
 *   part=series     the chosen columns as thinned lines, with the contract rolls
 */

export const TIMEFRAMES = ["1m", "1h", "4h"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const PARTS = ["catalogue", "wide", "series"] as const;
export type Part = (typeof PARTS)[number];

/** The price and volume columns every bar carries; the series part may draw them too. */
export const BAR_COLUMNS = ["open", "high", "low", "close", "volume"] as const;

export const POINT_BUDGETS = [2000, 5000, 10000, 0] as const;

export const MAXIMUM_DRAWN_COLUMNS = 8;
export const MAXIMUM_WINDOW_BARS = 1000;
export const HISTOGRAM_BIN_COUNT = 60;
export const TREND_BUCKET_COUNT = 60;

/** The notebook's "readable starter set". */
export const STARTER_COLUMNS = [
  "rsi_14", "macd_12_26_9", "macd_signal_12_26_9", "macd_histogram_12_26_9", "atr_14", "adx_14",
  "bbands_upper_band_5_2_2_0", "bbands_middle_band_5_2_2_0", "bbands_lower_band_5_2_2_0", "obv",
] as const;

export const DEFAULT_DRAWN_COLUMNS = ["rsi_14", "atr_14", "macd_12_26_9", "adx_14", "obv", "close"] as const;

export interface PresetDefinition {
  key: string;
  label: string;
  /** The TA-Lib group the preset selects; null for the starter set and for everything. */
  group: string | null;
}

export const PRESETS: readonly PresetDefinition[] = [
  { key: "starter", label: "a readable starter set", group: null },
  { key: "momentum", label: "momentum", group: "Momentum Indicators" },
  { key: "overlap", label: "overlap studies", group: "Overlap Studies" },
  { key: "volatility", label: "volatility", group: "Volatility Indicators" },
  { key: "volume", label: "volume", group: "Volume Indicators" },
  { key: "candlestick", label: "candlestick patterns", group: "Pattern Recognition" },
  { key: "everything", label: "everything", group: null },
];

export const PRESET_KEYS = PRESETS.map((preset) => preset.key) as [string, ...string[]];

export interface ColumnIdentity {
  column_name: string;
  talib_group: string;
}

/**
 * The indicator columns a preset selects, in the catalogue's order. The starter set keeps only the
 * columns the bar set has; if none survive (parameter defaults drifted) it falls back to the first ten.
 */
export function presetColumns(catalogue: readonly ColumnIdentity[], presetKey: string): string[] {
  const names = catalogue.map((entry) => entry.column_name);
  if (presetKey === "everything") return names;
  const preset = PRESETS.find((candidate) => candidate.key === presetKey);
  if (preset?.group) return catalogue.filter((entry) => entry.talib_group === preset.group).map((entry) => entry.column_name);
  const available = new Set(names);
  const starter = STARTER_COLUMNS.filter((name) => available.has(name));
  return starter.length > 0 ? starter : names.slice(0, 10);
}

/** Every stride-th bar is drawn; 0 means every bar. The notebook's `max(1, len // target)`. */
export function thinningStride(barCount: number, pointBudget: number): number {
  if (pointBudget <= 0) return 1;
  return Math.max(1, Math.floor(barCount / pointBudget));
}

/** Merge neighbouring histogram bins by an exact divisor of the landed bin count. */
export function coarsenCounts(counts: readonly number[], groupSize: number): number[] {
  if (groupSize <= 1) return [...counts];
  const out: number[] = [];
  for (let index = 0; index < counts.length; index += groupSize) {
    let sum = 0;
    for (let offset = 0; offset < groupSize && index + offset < counts.length; offset += 1) sum += counts[index + offset] ?? 0;
    out.push(sum);
  }
  return out;
}

/** The bin counts the page offers, each dividing the 60 landed bins exactly. */
export const BIN_CHOICES = [60, 30, 20, 12, 10, 6] as const;

export interface CatalogueColumn {
  column_name: string;
  talib_function: string;
  talib_output: string;
  talib_group: string;
  lookback_bars: number;
  integer_output: boolean;
  parameters_json: string;
  bar_count: number;
  finite_count: number;
  finite_percent: number;
  nonzero_bar_count: number;
  mean: number | null;
  median: number | null;
  standard_deviation: number | null;
  skewness: number | null;
  kurtosis: number | null;
  percentile_25: number | null;
  percentile_75: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface ContractRun {
  contractSymbol: string;
  barCount: number;
  firstBarIndex: number;
  firstTimestamp: number;
  lastTimestamp: number;
}

export interface BarSetSummary {
  barCount: number;
  contracts: ContractRun[];
  talibVersion: string;
  windowStart: number;
  windowEnd: number;
}

/** One column's distribution: equal-width bins from minimum to maximum. */
export interface ColumnHistogram {
  minimum: number;
  maximum: number;
  counts: number[];
}

export interface CatalogueBody {
  part: "catalogue";
  timeframe: Timeframe;
  summary: BarSetSummary | null;
  columns: CatalogueColumn[];
  /** Keyed by column name; absent for a column with no finite value. */
  histograms: Record<string, ColumnHistogram>;
  /** Keyed by column name: the mean over each of 60 equal runs of bars (null where a run has no finite value). */
  trends: Record<string, Array<number | null>>;
}

export interface WideBody {
  part: "wide";
  timeframe: Timeframe;
  barCount: number;
  start: number;
  /** The indicator columns, after the fixed ones (bar, timestamp, contract_symbol, open, high, low, close, volume). */
  indicatorColumns: string[];
  rows: Array<Record<string, number | string | null>>;
}

export interface SeriesBody {
  part: "series";
  timeframe: Timeframe;
  barCount: number;
  stride: number;
  columns: string[];
  /** Columns the request named that the bar set does not have. */
  dropped: string[];
  /** Bar indices of each contract roll (bars_since_contract_roll = 0, index > 0). */
  rolls: number[];
  rollContracts: Array<{ barIndex: number; from: string | null; to: string }>;
  points: Array<Record<string, number | null>>;
}

export type TalibCatalogueBody = CatalogueBody | WideBody | SeriesBody;

export const EMPTY_CATALOGUE: CatalogueBody = { part: "catalogue", timeframe: "1m", summary: null, columns: [], histograms: {}, trends: {} };
