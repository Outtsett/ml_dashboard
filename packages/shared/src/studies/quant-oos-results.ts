/**
 * The body of GET /api/studies/quant-oos-results, and the pure arithmetic the
 * page and its tests share: the fold-level eight-number distribution exactly as
 * the notebook's `quant.data.distribution` computes it, and the break-even
 * calculator.
 */

export interface OosFoldRow {
  fold_index: number;
  train_window_count: number;
  test_window_count: number;
  train_first_timestamp: string;
  train_last_timestamp: string;
  test_first_timestamp: string;
  test_last_timestamp: string;
  target_scale: number;
  train_mean_squared_error: number;
  test_mean_squared_error: number;
  zero_prediction_mean_squared_error: number;
  persistence_mean_squared_error: number;
  out_of_sample_r_squared: number;
  persistence_r_squared: number;
  directional_accuracy: number;
  directional_accuracy_standard_error: number;
  information_coefficient: number;
  prediction_standard_deviation: number;
  target_standard_deviation: number;
  in_sample_out_of_sample_gap: number;
  gross_mean_return_per_trade: number;
  net_mean_return_per_trade: number;
  trade_count: number;
  seconds: number;
}

/** The notebook's conviction table: one row per traded fraction, pooled across folds. */
export interface OosConvictionRow {
  traded_fraction: number;
  trade_count: number;
  directional_accuracy: number;
  gross_mean_return_per_trade: number;
  net_mean_return_per_trade: number;
}

export interface OosConvictionFoldRow extends OosConvictionRow {
  fold_index: number;
  net_total_return: number;
}

export interface OosFoldTargetRow {
  fold_index: number;
  test_window_count: number;
  nonzero_target_window_count: number;
  mean_absolute_target: number;
  mean_window_end_close_price: number;
}

export interface OosSummaryRow {
  fold_count: number;
  total_test_windows: number;
  pooled_test_mean_squared_error: number;
  pooled_zero_mean_squared_error: number;
  pooled_persistence_mean_squared_error: number;
  pooled_directional_accuracy: number;
  pooled_directional_accuracy_nonzero_weighted: number;
  pooled_information_coefficient: number;
  pooled_net_mean_return_per_trade: number;
  pooled_out_of_sample_r_squared: number;
  folds_with_positive_r_squared: number;
  folds_with_directional_accuracy_above_half: number;
  fold_r_squared_mean: number;
  fold_r_squared_ci_lower: number;
  fold_r_squared_ci_upper: number;
  fold_directional_mean: number;
  fold_directional_ci_lower: number;
  fold_directional_ci_upper: number;
  bar_count: number;
  window_count: number;
  first_timestamp: string;
  last_timestamp: string;
  symbol_root: string;
  timeframe: string;
  sequence_length: number;
  purge_windows: number;
  maximum_training_steps: number;
  round_turn_cost_points: number;
  round_turn_cost_log_return: number;
  pooled_mean_absolute_target: number;
  pooled_target_standard_deviation: number;
  pooled_nonzero_target_window_count: number;
  pooled_mean_window_end_close_price: number;
  pooled_minimum_window_end_close_price: number;
  pooled_maximum_window_end_close_price: number;
  target_skewness: number;
  target_kurtosis: number;
  target_minimum: number;
  target_maximum: number;
}

export interface OosResultsBody {
  recipe: string | null;
  folds: OosFoldRow[];
  conviction: OosConvictionRow[];
  convictionByFold: OosConvictionFoldRow[];
  foldTargets: OosFoldTargetRow[];
  summary: OosSummaryRow | null;
  /** Dollars per index point of one MNQ contract, from packages/config/cost_model.json. */
  pointValueUsd: number;
}

/** The eight numbers plus the count, named as the notebook's `distribution` names them. */
export interface Distribution {
  count: number;
  mean: number;
  median: number;
  standard_deviation: number;
  skewness: number;
  kurtosis: number;
  percentile_25: number;
  percentile_75: number;
  minimum: number;
  maximum: number;
}

/** numpy's default percentile: linear interpolation between order statistics. */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 1) return sorted[0] as number;
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] as number;
  const high = sorted[upper] as number;
  return low + (high - low) * (position - lower);
}

/**
 * `quant.data.distribution`, reproduced: sample standard deviation (n - 1),
 * skewness and excess kurtosis as population moments divided by that standard
 * deviation's third and fourth powers, NaN below n = 3 (skewness) and n = 4
 * (kurtosis). Non-finite inputs are dropped.
 */
export function distribution(values: ArrayLike<number>): Distribution {
  const clean: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    if (Number.isFinite(value)) clean.push(value);
  }
  const count = clean.length;
  if (count === 0) {
    return { count: NaN, mean: NaN, median: NaN, standard_deviation: NaN, skewness: NaN, kurtosis: NaN, percentile_25: NaN, percentile_75: NaN, minimum: NaN, maximum: NaN };
  }
  const mean = clean.reduce((a, b) => a + b, 0) / count;
  const squares = clean.reduce((a, b) => a + (b - mean) ** 2, 0);
  const deviation = count > 1 ? Math.sqrt(squares / (count - 1)) : NaN;
  const usable = Number.isFinite(deviation) && deviation > 0;
  const skewness = count > 2 && usable ? clean.reduce((a, b) => a + (b - mean) ** 3, 0) / count / deviation ** 3 : NaN;
  const kurtosis = count > 3 && usable ? clean.reduce((a, b) => a + (b - mean) ** 4, 0) / count / deviation ** 4 - 3 : NaN;
  const sorted = [...clean].sort((a, b) => a - b);
  return {
    count,
    mean,
    median: percentile(sorted, 0.5),
    standard_deviation: deviation,
    skewness,
    kurtosis,
    percentile_25: percentile(sorted, 0.25),
    percentile_75: percentile(sorted, 0.75),
    minimum: sorted[0] as number,
    maximum: sorted[count - 1] as number,
  };
}

export interface BreakEvenInput {
  /** Round-turn cost in index points. */
  costPoints: number;
  /** The index level the cost is converted at. */
  indexLevel: number;
  /** E|y|: mean absolute next-bar log return, the gain when a call is right. */
  meanAbsoluteTarget: number;
  /** Directional accuracy actually measured, to compare against. */
  measuredAccuracy: number;
}

export interface BreakEven {
  /** The cost as a log return: cost points over index level. */
  costLogReturn: number;
  /** q* = 1/2 + c / (2 E|y|). */
  breakEvenAccuracy: number;
  /** (q* - q) in percentage points. */
  shortfallPercentagePoints: number;
  /** (q* - 1/2) / (q - 1/2): the edge needed against the edge held. */
  edgeRatio: number;
  /** (2q - 1) E|y| - c at the measured accuracy, per trade, in log return. */
  expectedNetPerTrade: number;
  /** The round-turn cost, in index points, at which the measured accuracy would just break even. */
  breakEvenCostPoints: number;
}

export function breakEven(input: BreakEvenInput): BreakEven {
  const { costPoints, indexLevel, meanAbsoluteTarget, measuredAccuracy } = input;
  const costLogReturn = costPoints / indexLevel;
  const breakEvenAccuracy = 0.5 + costLogReturn / (2 * meanAbsoluteTarget);
  return {
    costLogReturn,
    breakEvenAccuracy,
    shortfallPercentagePoints: (breakEvenAccuracy - measuredAccuracy) * 100,
    edgeRatio: (breakEvenAccuracy - 0.5) / (measuredAccuracy - 0.5),
    expectedNetPerTrade: (2 * measuredAccuracy - 1) * meanAbsoluteTarget - costLogReturn,
    breakEvenCostPoints: 2 * meanAbsoluteTarget * (measuredAccuracy - 0.5) * indexLevel,
  };
}

/** How many folds pass each of the notebook's two headline tests. */
export function headlineCounts(folds: readonly OosFoldRow[]) {
  return {
    foldCount: folds.length,
    positiveRSquared: folds.filter((fold) => fold.out_of_sample_r_squared > 0).length,
    accuracyAboveHalf: folds.filter((fold) => fold.directional_accuracy > 0.5).length,
    totalWindows: folds.reduce((sum, fold) => sum + fold.test_window_count, 0),
  };
}
