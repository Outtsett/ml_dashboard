/**
 * The label contract — what every landed label row carries, how a label set is
 * identified, and the lifecycle a set moves through.
 *
 * Think of it as: the shipping label on a crate of labels. The generator decides
 * what is inside (the `label` value and its own columns); this contract decides
 * what is printed on the outside so any consumer — the chart, a notebook, a
 * training run — can read the crate without knowing which generator packed it.
 *
 * Three layers share it: `src/server/infrastructure/lib/labels/` (generation,
 * enrichment, validation, landing), `src/ml/shared/label_sets.py` (training reads
 * the same column names), `src/client/src/labels/` (the catalog page).
 */

/** Bumped when a landed row's columns or their meaning change. Part of the recipe hash. */
export const LABEL_CONTRACT_VERSION = 1;

/**
 * Bars of trailing 1-bar close changes behind `trailing_volatility_points`.
 * Causal: the window ends at the event bar and is NULL until it is full.
 */
export const LABEL_VOLATILITY_WINDOW_BARS = 100;

/** Dataset name under `s3://derived/` and the manifest file under `s3://meta/ingest_manifests/`. */
export const LABEL_DATASET = 'labels';
/** Table segment inside a recipe: `derived/labels/recipe=<recipe>/table=labels/`. */
export const LABEL_TABLE = 'labels';
/** The serving view over every landed recipe (`derived_<dataset>`). */
export const LABEL_SERVING_VIEW = 'derived_labels';

// ─── Row columns ────────────────────────────────────────────────────────────

/**
 * Columns every landed row carries beyond the generator's own. `timestamp` is the
 * EVENT bar (the bar the label is computed from); `label` is the value. Both keep
 * their short names because every reader in the repo keys on them and both are
 * unambiguous on their own.
 */
export const LABEL_ROW_COLUMNS = {
  /** Event bar timestamp (UTC as stored in the lake). */
  timestamp: 'timestamp',
  symbol: 'symbol',
  /** Close of the event bar. */
  close: 'close',
  /** The label value in the generator's encoding (see `LabelEncoding`). */
  label: 'label',
  /** Bars from the event bar to the bar the label resolves on (0 = the event bar itself). */
  resolutionBars: 'resolution_bars',
  /** Timestamp of the bar the label resolves on. */
  resolutionTimestamp: 'resolution_timestamp',
  /** Close of the resolution bar. */
  resolutionClose: 'resolution_close',
  /** Price at which the outcome was realised: the barrier fill when one was hit, else the resolution close. */
  realizedPrice: 'realized_price',
  /** `realized_price - close`, in price points. */
  realizedReturnPoints: 'realized_return_points',
  /** `realized_return_points / close`. */
  realizedReturnFraction: 'realized_return_fraction',
  /** Causal standard deviation of 1-bar close changes over `LABEL_VOLATILITY_WINDOW_BARS`, NULL in warmup. */
  trailingVolatilityPoints: 'trailing_volatility_points',
  /** `realized_return_points / (trailing_volatility_points * sqrt(resolution_bars))`. */
  realizedReturnVolatilityUnits: 'realized_return_volatility_units',
  /** Canonical round-trip cost for the symbol from `src/config/cost_model.json`; NULL when the symbol is unpriced. */
  roundTripCostPoints: 'round_trip_cost_points',
  /** `realized_return_points - round_trip_cost_points`, signed by the label's side where it has one. */
  realizedReturnNetOfCostPoints: 'realized_return_net_of_cost_points',
  /** `|realized_return_points| > round_trip_cost_points`; NULL when unpriced. */
  clearsRoundTripCost: 'clears_round_trip_cost',
  /** Number of labels whose span covers the event bar, including this one (AFML 4.2 concurrency). */
  concurrentLabelCount: 'concurrent_label_count',
  /** Mean of 1 / concurrency over the label's span, in (0, 1] (AFML 4.5 average uniqueness). */
  sampleUniquenessWeight: 'sample_uniqueness_weight',
  /** |sum of 1-bar log returns / concurrency over the span|, normalised to mean 1 across the set (AFML 4.10). */
  returnAttributionWeight: 'return_attribution_weight',
  /** False when the row must not train: unresolved, warmup, ambiguous, below the minimum return. */
  usable: 'usable',
  /** Why `usable` is false; `ok` when it is true. */
  usableReason: 'usable_reason',
} as const;

export type LabelRowColumn = (typeof LABEL_ROW_COLUMNS)[keyof typeof LABEL_ROW_COLUMNS];

/** The post-pass columns, in the order they are appended. */
export const LABEL_ENRICHMENT_COLUMNS: readonly LabelRowColumn[] = [
  'resolution_bars',
  'resolution_timestamp',
  'resolution_close',
  'realized_price',
  'realized_return_points',
  'realized_return_fraction',
  'trailing_volatility_points',
  'realized_return_volatility_units',
  'round_trip_cost_points',
  'realized_return_net_of_cost_points',
  'clears_round_trip_cost',
  'concurrent_label_count',
  'sample_uniqueness_weight',
  'return_attribution_weight',
  'usable',
  'usable_reason',
];

export const USABLE_REASONS = [
  'ok',
  'unresolved',
  'volatility_warmup',
  'ambiguous_same_bar_touch',
  'below_minimum_return',
  'zero_volatility',
] as const;
export type UsableReason = (typeof USABLE_REASONS)[number];

/** How a generator encodes `label`. Per set, recorded in the manifest. */
export type LabelEncoding =
  /** -1 down / 0 flat or unresolved-by-barrier / +1 up. */
  | 'signed_direction'
  /** 0 … classCount-1. */
  | 'class_id'
  /** A real number (a return, a volatility). */
  | 'continuous'
  /** 0 / 1: did the primary signal pay. */
  | 'binary_meta';

/** Generators whose label describes the event bar itself (no forward horizon). */
export const BACKWARD_LOOKING_GENERATORS: readonly string[] = ['structural', 'regime'];

// ─── Identity ───────────────────────────────────────────────────────────────

export interface LabelRecipeInput {
  generatorType: string;
  symbol: string;
  timeframeMinutes: number;
  /** Normalised parameter names with defaults filled (see `labelParams.ts`). */
  params: Record<string, unknown>;
  /** Epoch milliseconds; null = the instrument's whole history. */
  windowStartTimestamp: number | null;
  windowEndTimestamp: number | null;
}

/** Short timeframe label the recipe and the lake use: 1 → `1m`, 60 → `1h`, 1440 → `1d`. */
export function timeframeLabelOf(minutes: number): string {
  const n = Math.max(1, Math.floor(minutes));
  if (n % 10080 === 0) return `${n / 10080}w`;
  if (n % 1440 === 0) return `${n / 1440}d`;
  if (n % 60 === 0) return `${n / 60}h`;
  return `${n}m`;
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

/**
 * The furthest rung a label set has reached. Ordered; each implies the ones before,
 * except the two terminal states, which sit beside the ladder.
 *
 *   specified   a request is recorded: generator, symbol, timeframe, parameters, window
 *   generated   the rows were computed
 *   validated   every validation gate passed and the report is stored
 *   landed      the rows are in the lake with a manifest line, count verified from the object
 *   cataloged   the dashboard's own DuckDB serves them (`derived_labels`)
 *   consumed    at least one training session trained on them
 *   stale       the source bars moved past the fingerprint the set was generated from
 *   retired     retired on request; the parquet is kept
 */
export type LabelLifecycleStage =
  | 'specified'
  | 'generated'
  | 'validated'
  | 'landed'
  | 'cataloged'
  | 'consumed'
  | 'stale'
  | 'retired';

export const LABEL_LIFECYCLE_STAGES: readonly LabelLifecycleStage[] = [
  'specified',
  'generated',
  'validated',
  'landed',
  'cataloged',
  'consumed',
  'stale',
  'retired',
];

/** The ladder rungs a set climbs; `stale` and `retired` are states, not rungs. */
export const LABEL_LIFECYCLE_RUNGS: readonly LabelLifecycleStage[] = [
  'specified',
  'generated',
  'validated',
  'landed',
  'cataloged',
  'consumed',
];

export interface EightNumberSummary {
  count: number;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  skewness: number | null;
  kurtosis: number | null;
  percentile25: number | null;
  percentile75: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface LabelValidationGate {
  passed: boolean;
  /** The measured number the gate judged, when it has one. */
  value: number | null;
  detail: string;
}

export interface LabelValidationReport {
  contractVersion: number;
  checkedAtMilliseconds: number;
  passed: boolean;
  gates: {
    resolutionMonotone: LabelValidationGate;
    noDuplicateEvents: LabelValidationGate;
    coverage: LabelValidationGate;
    classBalance: LabelValidationGate;
    purgeCoversHorizon: LabelValidationGate;
    /** Labels recomputed on a truncated window agree for every row that resolved inside it. */
    noLookahead: LabelValidationGate;
    usableShare: LabelValidationGate;
  };
  /** Counts per label value over usable rows. */
  labelDistribution: Record<string, number>;
  classBalanceRatio: number | null;
  realizedReturnPoints: EightNumberSummary;
  realizedReturnVolatilityUnits: EightNumberSummary;
  sampleUniquenessWeight: EightNumberSummary;
  /** Labelled rows over bars in the window. */
  coverageFraction: number | null;
  usableReasonCounts: Record<string, number>;
}

export interface LabelSourceFingerprint {
  tableName: string;
  resolution: string;
  rowCount: number;
  coverageStartTimestamp: number;
  coverageEndTimestamp: number;
}

/** One line of `s3://meta/ingest_manifests/labels.jsonl`. */
export interface LabelManifestLine {
  written_at: string;
  dataset: typeof LABEL_DATASET;
  table: typeof LABEL_TABLE;
  zone: 'derived';
  recipe: string;
  source: string;
  rows: number;
  duplicates_removed: 0;
  file_count: 1;
  bytes: number;
  ts_min: string | null;
  ts_max: string | null;
  contract_version: number;
  label_set_id: number;
  generator_type: string;
  label_encoding: LabelEncoding;
  symbol: string;
  timeframe_minutes: number;
  parameters: Record<string, unknown>;
  parameters_hash: string;
  window_start_timestamp: number | null;
  window_end_timestamp: number | null;
  source_fingerprint: LabelSourceFingerprint;
  label_distribution: Record<string, number>;
  max_horizon_bars: number;
  purge_bars: number;
  embargo_bars: number;
  object_path: string;
  validation: LabelValidationReport | null;
}

export interface LabelSetLifecycle {
  labelSetId: number;
  recipe: string | null;
  stage: LabelLifecycleStage;
  /** Every rung reached, so a stale or retired set still shows how far it got. */
  reached: LabelLifecycleStage[];
  generatorType: string;
  symbol: string;
  timeframeMinutes: number;
  rowCount: number;
  labelDistribution: Record<string, number>;
  validationPassed: boolean | null;
  parquetPath: string | null;
  servingView: string | null;
  consumedBySessionCount: number;
  maxHorizonBars: number | null;
  purgeBars: number | null;
  embargoBars: number | null;
  staleReason: string | null;
  lastEventAtMilliseconds: number | null;
}

export interface LabelLifecycleResponse {
  lifecycle: Record<number, LabelSetLifecycle>;
  /** Recipes the serving DuckDB currently exposes through `derived_labels`. */
  servedRecipes: string[];
  setCount: number;
}
