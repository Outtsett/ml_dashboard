/**
 * The indicator study (replaced datalake/notebooks/mnq_indicator_study.py):
 * the bodies of `GET /api/studies/indicator-study?part=<part>` and the pure
 * compute the handler and the page share.
 *
 * Every number comes from the lake: the study's 28 tables landed unchanged as
 * `derived_study_indicator_study_<table>` (plus `candle_thresholds` and the
 * 4-hour bar set, built by packages/ml-engine/src/studies/indicator_study/build.py), and the
 * TA-Lib bar sets `derived_mnq_talib_1m` / `_1h`.
 */

import { quantileSorted, sortedFinite } from "../lens/stats";

export const INDICATOR_STUDY_TIMEFRAMES = ["1h", "4h", "1m"] as const;
export type IndicatorStudyTimeframe = (typeof INDICATOR_STUDY_TIMEFRAMES)[number];
export const INDICATOR_STUDY_HORIZONS = [1, 4, 12] as const;

export const INDICATOR_STUDY_PARTS = [
  "overview", "chart", "inspector", "correlation", "pair", "predictability", "calls",
  "walkForward", "distributions", "conditions", "formation", "firing", "firings",
] as const;
export type IndicatorStudyPart = (typeof INDICATOR_STUDY_PARTS)[number];

/** Bars shown by default, per timeframe (the notebook's `_default_length`). */
export const DEFAULT_WINDOW_LENGTH: Record<IndicatorStudyTimeframe, number> = { "1h": 240, "4h": 180, "1m": 240 };
export const MAXIMUM_WINDOW_LENGTH = 1500;
/** The pair scatter is sampled to this many points when larger (the notebook's cap). */
export const PAIR_SAMPLE_SIZE = 20_000;
export const FIRINGS_PAGE_SIZE = 50;
/** Points on the running location/width line (the notebook's cap). */
export const RUNNING_STEPS = 300;

export const DEFAULT_OVERLAYS = ["bbands_upper_band_5_2_2_0", "bbands_middle_band_5_2_2_0", "bbands_lower_band_5_2_2_0", "ema_30", "sar_0p02_0p2"];
export const DEFAULT_PANELS = ["rsi_14", "macd_12_26_9", "macd_signal_12_26_9", "macd_histogram_12_26_9", "adx_14", "atr_14", "obv"];
export const DEFAULT_PATTERN_KINDS = ["bullish_only", "bearish_only", "signed_directional", "signed_with_confirmation"];

// ── Rows as the lake holds them ────────────────────────────────────────────

export interface CatalogueRow {
  timeframe: string;
  column_name: string;
  talib_function: string;
  talib_output: string | null;
  talib_group: string;
  parameters: string | null;
  lookback_bars: number | null;
  feature_kind: string;
  transformation_formula: string | null;
  pattern_semantics: string | null;
  semantics_description: string | null;
  null_count: number | null;
  infinite_count: number | null;
  excluded_reason: string | null;
  duplicate_of: string | null;
}

export interface RunInformationRow {
  timeframe: string;
  horizon_bars: number;
  bar_count: number;
  usable_bar_count: number;
  up_bar_count: number;
  down_bar_count: number;
  tie_excluded_count: number;
  roll_excluded_count: number;
  warmup_or_end_excluded_count: number;
  mean_block_length_bars: number;
  bootstrap_draws: number;
  bootstrap_interval_method: string;
  permutation_shift_count: number;
  permutation_shift_rule: string;
  indicator_column_count: number;
  usable_indicator_count: number;
  scored_indicator_count: number;
  duplicate_indicator_count: number;
  talib_version: string | null;
  generated_at: string | null;
}

export interface FamilywiseThresholdRow {
  timeframe: string;
  horizon_bars: number;
  variant: string;
  statistic: string;
  studentized_threshold_95: number | null;
  tested_indicator_count: number;
  familywise_significant_count: number;
  benjamini_hochberg_q_below_0p10_count: number;
  expected_false_discoveries_at_5_percent: number | null;
}

export interface IndependentCheckRow {
  timeframe: string;
  talib_function: string;
  column_name: string;
  compared_bar_count: number;
  agreeing_bar_count: number;
  agreement_percent: number;
  talib_signal_bar_count: number;
  reference_signal_bar_count: number;
}

export interface MarketFeatureRow {
  feature_name: string;
  description: string;
  units: string;
  measured_at: string | null;
}

export interface TrendDefinitionRow {
  trend_definition: string;
  feature_name: string | null;
  threshold: number | null;
  description: string;
}

export interface ContextStatisticsRow {
  feature_name: string;
  description: string;
  units: string;
  finite_count: number;
  mean: number | null;
  median: number | null;
  standard_deviation: number | null;
  skewness: number | null;
  excess_kurtosis: number | null;
  percentile_25: number | null;
  percentile_75: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface OverviewBody {
  timeframe: IndicatorStudyTimeframe;
  barCount: number;
  contracts: Array<{ contract_symbol: string; bar_count: number }>;
  catalogue: CatalogueRow[];
  runInformation: RunInformationRow[];
  familywiseThresholds: FamilywiseThresholdRow[];
  independentCheck: IndependentCheckRow[];
  /** Bars each non-excluded pattern column fires on (value not 0) at this timeframe. */
  patternFiringCounts: Array<{ column_name: string; firing_count: number }>;
  marketFeatures: MarketFeatureRow[];
  trendDefinitions: TrendDefinitionRow[];
  /** Pattern and sign pairs with firings at this timeframe, most firings first. */
  formationPatterns: Array<{ column_name: string; signal_side: string; firing_count: number }>;
  contextStatistics: ContextStatisticsRow[];
}

export interface ChartBar {
  bar_index: number;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  contract_symbol: string;
  bars_since_contract_roll: number | null;
  direction_binary: number | null;
  exclusion_reason: string | null;
  values: Record<string, number | null>;
}

export interface ChartMarker {
  bar_index: number;
  pattern: string;
  value: number;
}

export interface ChartBody {
  barCount: number;
  firstBarIndex: number;
  lastBarIndex: number;
  horizon: number;
  overlays: string[];
  panels: string[];
  bars: ChartBar[];
  markers: ChartMarker[];
}

export interface InspectorRow {
  bar_index: number;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  talib_value: number | null;
  independent_reimplementation: number | null;
  real_body: number | null;
  upper_shadow: number | null;
  lower_shadow: number | null;
  high_low_range: number | null;
  body_long_or_short_threshold: number | null;
  body_doji_threshold: number | null;
  shadow_very_short_threshold: number | null;
  shadow_short_threshold: number | null;
  near_threshold: number | null;
}

export interface InspectorBody {
  pattern: string;
  occurrenceCount: number;
  occurrence: number;
  barIndex: number | null;
  hasReference: boolean;
  rows: InspectorRow[];
}

export interface CorrelationColumn {
  column_name: string;
  talib_group: string;
  feature_kind: string;
  cluster_position: number;
  cluster_number: number;
}

export interface CorrelationBody {
  variant: string;
  method: string;
  columns: CorrelationColumn[];
  /** Row-major n × n, index by the order of `columns`; null where the pair was not computed. */
  correlations: Array<number | null>;
  pairCounts: Array<number | null>;
}

export interface PairBody {
  columnA: string;
  columnB: string;
  variant: string;
  correlation: number | null;
  pairCount: number | null;
  finiteCount: number;
  sampled: boolean;
  /** [value of A, value of B, bar open in milliseconds] */
  points: Array<[number, number, number]>;
}

export type PredictabilityVerdict =
  | "clears the family-wise threshold"
  | "q < 0.10 only (false-discovery screen)"
  | "indistinguishable from the null";

export const PREDICTABILITY_VERDICTS: PredictabilityVerdict[] = [
  "clears the family-wise threshold",
  "q < 0.10 only (false-discovery screen)",
  "indistinguishable from the null",
];

export interface PredictabilityRow {
  column_name: string;
  talib_group: string;
  feature_kind: string;
  usable_bar_count: number;
  up_bar_count: number;
  down_bar_count: number;
  score: number | null;
  lower_95: number | null;
  upper_95: number | null;
  permutation_p_value: number | null;
  benjamini_hochberg_q_value: number | null;
  familywise_threshold: number | null;
  verdict: PredictabilityVerdict;
}

export interface ScoreComparisonRow {
  column_name: string;
  talib_group: string;
  feature_kind: string;
  raw: number;
  transformed: number;
  treatment: "scored as-is (raw = transformed)" | "transformed before scoring";
}

export interface PredictabilityBody {
  rows: PredictabilityRow[];
  thresholds: FamilywiseThresholdRow[];
  comparison: ScoreComparisonRow[];
  run: RunInformationRow | null;
}

export interface HitRateRow {
  timeframe: string;
  horizon_bars: number;
  column_name: string;
  talib_function: string;
  pattern_semantics: string | null;
  signal_side: string;
  claimed_direction: string;
  signal_bar_count: number;
  reportable: boolean;
  probability_up_given_signal: number | null;
  probability_up_given_signal_lower_95: number | null;
  probability_up_given_signal_upper_95: number | null;
  hit_rate_in_claimed_direction: number | null;
  base_rate_up: number | null;
  base_rate_up_lower_95: number | null;
  base_rate_up_upper_95: number | null;
  permutation_p_value: number | null;
}

export interface CallsBody {
  rows: HitRateRow[];
}

export interface WalkForwardFoldRow {
  fold_number: number;
  model_name: string;
  train_bar_count: number;
  test_bar_count: number;
  independent_window_count: number | null;
  test_start_timestamp: number;
  test_end_timestamp: number;
  test_base_rate_up: number | null;
  area_under_roc_curve: number | null;
  area_under_roc_curve_null_95th_percentile: number | null;
  area_under_roc_curve_permutation_p_value: number | null;
  log_loss: number | null;
  accuracy: number | null;
  chosen_inverse_regularization: number | null;
  feature_count: number | null;
}

export interface WalkForwardMeanNullRow {
  model_name: string;
  null_mean_area_under_roc_curve_95th_percentile: number | null;
  mean_area_under_roc_curve_permutation_p_value: number | null;
  null_rule: string | null;
}

export interface WalkForwardSummaryRow {
  model_name: string;
  mean_area_under_roc_curve: number | null;
  worst_fold_area_under_roc_curve: number | null;
  best_fold_area_under_roc_curve: number | null;
  mean_log_loss: number | null;
  mean_accuracy: number | null;
  independent_window_count: number;
  fold_count: number;
  null_mean_area_under_roc_curve_95th_percentile: number | null;
  mean_area_under_roc_curve_permutation_p_value: number | null;
  null_rule: string | null;
}

export interface WalkForwardBody {
  folds: WalkForwardFoldRow[];
  summary: WalkForwardSummaryRow[];
}

export const WALK_FORWARD_MODELS = [
  "logistic on every indicator", "logistic on last log return", "last bar direction persists", "base rate",
] as const;

export interface HistogramBinRow {
  column_name: string;
  bin_index: number;
  bin_lower: number;
  bin_upper: number;
  bar_count: number;
}

export interface DistributionStatisticsRow {
  column_name: string;
  finite_count: number;
  mean: number | null;
  median: number | null;
  standard_deviation: number | null;
  skewness: number | null;
  excess_kurtosis: number | null;
  percentile_25: number | null;
  percentile_75: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface DistributionsBody {
  bins: HistogramBinRow[];
  statistics: DistributionStatisticsRow[];
}

export interface ConsistencyRow {
  column_name: string;
  talib_function: string;
  signal_side: string;
  feature_name: string;
  firing_count: number;
  firing_count_with_feature: number;
  firing_median: number | null;
  all_bar_median: number | null;
  mean_difference_in_all_bar_standard_deviations: number | null;
  firing_percentile_rank_25: number | null;
  firing_percentile_rank_75: number | null;
  location_shift_percentile_points: number | null;
  location_shift_null_95th_percentile_absolute: number | null;
  location_shift_permutation_p_value: number | null;
  location_shift_benjamini_hochberg_q_value: number | null;
  middle_half_width_percentile_points: number | null;
  middle_half_width_null_median: number | null;
  middle_half_width_null_5th_percentile: number | null;
  middle_half_width_permutation_p_value: number | null;
  middle_half_width_benjamini_hochberg_q_value: number | null;
  gradable: boolean;
  consistency_grade: string | null;
}

export interface TrendShareRow {
  column_name: string;
  signal_side: string;
  claimed_direction: string;
  required_prior_trend: string;
  firing_count_with_trend_label: number;
  share_in_required_trend: number | null;
  share_in_required_trend_wilson_lower_95: number | null;
  share_in_required_trend_wilson_upper_95: number | null;
  share_in_required_trend_day_block_lower_95: number | null;
  share_in_required_trend_day_block_upper_95: number | null;
  all_bar_share_in_required_trend: number | null;
  share_minus_all_bar_share: number | null;
  permutation_p_value: number | null;
  share_benjamini_hochberg_q_value: number | null;
  share_benjamini_yekutieli_q_value: number | null;
  firing_share_up: number | null;
  firing_share_none: number | null;
  firing_share_down: number | null;
}

export interface TrendOutcomeRow {
  column_name: string;
  signal_side: string;
  claimed_direction: string;
  base_rate_in_claimed_direction: number | null;
  firing_count_context_present: number;
  hit_rate_context_present: number | null;
  hit_rate_context_present_day_block_lower_95: number | null;
  hit_rate_context_present_day_block_upper_95: number | null;
  firing_count_context_absent: number;
  hit_rate_context_absent: number | null;
  hit_rate_context_absent_day_block_lower_95: number | null;
  hit_rate_context_absent_day_block_upper_95: number | null;
  hit_rate_difference_present_minus_absent: number | null;
  difference_day_block_lower_95: number | null;
  difference_day_block_upper_95: number | null;
  difference_day_block_p_value: number | null;
  difference_benjamini_hochberg_q_value: number | null;
  difference_benjamini_yekutieli_q_value: number | null;
}

export interface ConditionsTiles {
  firingCount: number;
  patternCount: number;
  firingsWithClauseHeadroom: number;
  grades: Record<string, number>;
  trendShareGraded: number;
  trendShareAbove: number;
  trendShareBelow: number;
  medianShare: number | null;
  medianBase: number | null;
  outcomesTested: number;
  outcomesChanged: number;
}

export interface ConditionsBody {
  tiles: ConditionsTiles | null;
  cells: ConsistencyRow[];
  shares: TrendShareRow[];
  outcomes: TrendOutcomeRow[];
}

export interface FormationRuleRow {
  talib_function: string;
  candle_count: number;
  pattern_type: string;
  required_prior_trend_for_bullish_signal: string | null;
  required_prior_trend_for_bearish_signal: string | null;
  talib_checks_prior_trend: boolean;
  trend_check_detail: string | null;
  shape_conditions: string;
  catalogue_correction: string | null;
  rule_margins_transcribed: boolean | null;
}

export interface ClausePanel {
  rule_branch: string;
  clause_name: string;
  clause_description: string | null;
  firing_count: number;
  share_with_zero_scale: number | null;
  headroom_median: number | null;
  headroom_percentile_25: number | null;
  headroom_percentile_75: number | null;
  headroom_minimum: number | null;
  share_within_10_percent_of_limit: number | null;
  share_within_1_percent_of_limit: number | null;
  /** Firings with a headroom for this clause. */
  valueCount: number;
  /** The 99th percentile the histogram stops at (1 when that is not above 0). */
  upper: number;
  /** Share of firings whose headroom is below the "barely passed" band. */
  barelyShare: number;
  /** 30 bins over [0, upper], each the share of firings in it. */
  bins: number[];
}

export interface FeaturePanel {
  feature_name: string;
  description: string;
  units: string;
  /** The axis the bins cover: [0, 1] for percentile ranks (drawn ×100), the 0.5–99.5% range for raw values. */
  low: number;
  high: number;
  allBarCount: number;
  firingCount: number;
  allBarShares: number[];
  firingShares: number[];
  width: number | null;
  shift: number | null;
  grade: string | null;
}

export interface RunningPoint {
  firings_so_far: number;
  location: number;
  width: number;
}

export interface FormationBody {
  column: string;
  side: string;
  firingCount: number;
  /** 1-based index of the first firing whose every context feature exists. */
  firstCompleteFiring: number;
  rule: FormationRuleRow | null;
  clauses: ClausePanel[];
  features: FeaturePanel[];
  consistency: ConsistencyRow[];
  session: Array<{
    session_eastern: string;
    session_hours: string;
    firing_count_in_session: number;
    firing_share: number;
    all_bar_share: number;
    total_variation_distance: number | null;
    total_variation_distance_null_95th_percentile: number | null;
    total_variation_distance_permutation_p_value: number | null;
    total_variation_distance_benjamini_hochberg_q_value: number | null;
  }>;
  legendFeature: string;
  /** N: bars where the legend feature exists. */
  legendAllBarCount: number;
  running: RunningPoint[];
}

export interface FiringBody {
  occurrence: number;
  firing: Record<string, unknown> | null;
  clauseHeadroom: Array<{ rule_branch: string; clause_name: string; headroom: number | null }>;
  /** Location and width of the legend feature over firings 1..f. */
  prefix: { location: number | null; width: number | null; count: number };
}

export interface FiringsPageBody {
  page: number;
  pageSize: number;
  total: number;
  rows: Array<Record<string, unknown>>;
}

// ── Pure compute shared by the handler and the page ────────────────────────

const PREDICTABILITY_COLUMNS = {
  information_coefficient: {
    score: "spearman_information_coefficient",
    lower: "information_coefficient_lower_95",
    upper: "information_coefficient_upper_95",
    prefix: "information_coefficient",
  },
  area_under_curve: {
    score: "area_under_curve_minus_half",
    lower: "area_under_curve_minus_half_lower_95",
    upper: "area_under_curve_minus_half_upper_95",
    prefix: "area_under_curve",
  },
} as const;

export type PredictabilityStatistic = keyof typeof PREDICTABILITY_COLUMNS;

/** The lake columns that hold a statistic's score, interval, p, q and threshold. */
export function predictabilityColumns(statistic: PredictabilityStatistic) {
  const names = PREDICTABILITY_COLUMNS[statistic];
  return {
    score: names.score,
    lower: names.lower,
    upper: names.upper,
    pValue: `${names.prefix}_permutation_p_value`,
    qValue: `${names.prefix}_benjamini_hochberg_q_value`,
    threshold: `${names.prefix}_familywise_threshold`,
  };
}

/** The notebook's verdict: |score| above the family-wise threshold, else q < 0.10, else neither. */
export function predictabilityVerdict(score: number | null, threshold: number | null, qValue: number | null): PredictabilityVerdict {
  if (score !== null && threshold !== null && Math.abs(score) > threshold) return "clears the family-wise threshold";
  if (qValue !== null && qValue < 0.1) return "q < 0.10 only (false-discovery screen)";
  return "indistinguishable from the null";
}

const AS_IS_KINDS = new Set(["stationary", "candlestick_pattern", "periodic_of_price"]);

export function scoreTreatment(featureKind: string): ScoreComparisonRow["treatment"] {
  return AS_IS_KINDS.has(featureKind) ? "scored as-is (raw = transformed)" : "transformed before scoring";
}

/**
 * The notebook's per-kind transform for the pair scatter (section 3), as a SQL
 * expression over a quoted column, the close and the bar number. `lagged` is
 * the value one bar earlier.
 */
export function transformedExpression(featureKind: string, column: string, lagged: string): string {
  switch (featureKind) {
    case "price_level":
      return `(${column} / close - 1)`;
    case "signed_price_level":
      return `(abs(${column}) / close - 1)`;
    case "price_level_sum_of_two":
      return `(${column} / (2 * close) - 1)`;
    case "price_level_sum_of_period":
      return `(${column} / (30 * close) - 1)`;
    case "price_level_product":
      return `(CASE WHEN ${column} >= 0 THEN sqrt(${column}) END / close - 1)`;
    case "price_scaled":
      return `(${column} / close)`;
    case "price_squared_scaled":
      return `(CASE WHEN ${column} >= 0 THEN sqrt(${column}) END / close)`;
    case "cumulative":
    case "monotone_of_price":
      return `(${column} - ${lagged})`;
    case "array_index":
      return `(bar_index - ${column})`;
    default:
      return `(${column})`;
  }
}

/** Mean, worst, best AUC, mean log loss and accuracy per model, joined to the mean-AUC null, sorted by mean log loss. */
export function walkForwardSummary(folds: readonly WalkForwardFoldRow[], nulls: readonly WalkForwardMeanNullRow[]): WalkForwardSummaryRow[] {
  const byModel = new Map<string, WalkForwardFoldRow[]>();
  for (const fold of folds) {
    const list = byModel.get(fold.model_name) ?? [];
    list.push(fold);
    byModel.set(fold.model_name, list);
  }
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const finite = (values: Array<number | null>) => values.filter((value): value is number => value !== null && Number.isFinite(value));
  const out: WalkForwardSummaryRow[] = [];
  for (const [model, rows] of byModel) {
    const auc = finite(rows.map((row) => row.area_under_roc_curve));
    const nullRow = nulls.find((row) => row.model_name === model);
    out.push({
      model_name: model,
      mean_area_under_roc_curve: mean(auc),
      worst_fold_area_under_roc_curve: auc.length ? Math.min(...auc) : null,
      best_fold_area_under_roc_curve: auc.length ? Math.max(...auc) : null,
      mean_log_loss: mean(finite(rows.map((row) => row.log_loss))),
      mean_accuracy: mean(finite(rows.map((row) => row.accuracy))),
      independent_window_count: finite(rows.map((row) => row.independent_window_count)).reduce((a, b) => a + b, 0),
      fold_count: rows.length,
      null_mean_area_under_roc_curve_95th_percentile: nullRow?.null_mean_area_under_roc_curve_95th_percentile ?? null,
      mean_area_under_roc_curve_permutation_p_value: nullRow?.mean_area_under_roc_curve_permutation_p_value ?? null,
      null_rule: nullRow?.null_rule ?? null,
    });
  }
  return out.sort((a, b) => (a.mean_log_loss ?? Infinity) - (b.mean_log_loss ?? Infinity));
}

/**
 * Location and width of the first `count` firings' percentile ranks (0..1):
 * location = 100 (mean u − ½), width = 100 (Q75 − Q25), numpy's linear
 * quantile. Nulls are skipped; width needs two values.
 */
export function prefixLocationWidth(ranks: ReadonlyArray<number | null>, count: number): { location: number | null; width: number | null; count: number } {
  const prefix: number[] = [];
  for (let index = 0; index < Math.min(count, ranks.length); index += 1) {
    const value = ranks[index];
    if (value !== null && value !== undefined && Number.isFinite(value)) prefix.push(value);
  }
  if (prefix.length === 0) return { location: null, width: null, count: 0 };
  const location = (prefix.reduce((a, b) => a + b, 0) / prefix.length - 0.5) * 100;
  if (prefix.length < 2) return { location, width: null, count: prefix.length };
  const sorted = sortedFinite(prefix);
  const width = ((quantileSorted(sorted, 0.75) as number) - (quantileSorted(sorted, 0.25) as number)) * 100;
  return { location, width, count: prefix.length };
}

/** The notebook's running line: firings 2..m at up to 300 evenly spaced counts (numpy linspace, truncated, unique). */
export function runningSteps(firingCount: number, maximumSteps = RUNNING_STEPS): number[] {
  const stop = Math.max(2, firingCount);
  const count = Math.min(Math.max(1, firingCount - 1), maximumSteps);
  const steps = new Set<number>();
  // numpy.linspace: index × step + start, with the last point set to the stop exactly.
  const step = count > 1 ? (stop - 2) / (count - 1) : 0;
  for (let index = 0; index < count; index += 1) {
    const value = index === count - 1 && count > 1 ? stop : index * step + 2;
    steps.add(Math.trunc(value));
  }
  return [...steps].sort((a, b) => a - b);
}

export function runningLocationWidth(ranks: ReadonlyArray<number | null>, maximumSteps = RUNNING_STEPS): RunningPoint[] {
  const out: RunningPoint[] = [];
  for (const step of runningSteps(ranks.length, maximumSteps)) {
    const prefix = prefixLocationWidth(ranks, step);
    if (prefix.count < 2 || prefix.location === null || prefix.width === null) continue;
    out.push({ firings_so_far: step, location: prefix.location, width: prefix.width });
  }
  return out;
}

/** "candlestick_hammer" → "hammer". */
export function patternLabel(column: string): string {
  return column.replace(/^candlestick_/, "");
}
