/**
 * The body of GET /api/studies/frozen-candle-encoder, shared by the handler
 * and the page, plus the pure computation both use (splitting the overloaded
 * probe table, summarising the ridge R-squared coordinates, the encoder-versus-
 * control verdict). Replaces datalake/notebooks/frozen_candle_encoder.py.
 *
 * The probe table `derived_mnq_frozen_encoder_probe` holds two different
 * things in one set of columns: for the five direction blocks, `feature_count`
 * is how many features the block has and `area_under_curve_test` is an area
 * under the ROC curve; for `embedding_coordinate_explained_by_labels`,
 * `feature_count` is the coordinate index and `area_under_curve_test` is that
 * coordinate's ridge R-squared. `splitProbeRows` is the one place that knows.
 */

/** The eight patterns the notebook offers for its real-window viewer. */
export const WINDOW_PATTERNS = [
  "hammer", "engulfing", "shootingstar", "doji", "morningstar", "eveningstar", "3whitesoldiers", "harami",
] as const;
export type WindowPattern = (typeof WINDOW_PATTERNS)[number];

/** Feature blocks in the order the notebook draws them. */
export const DIRECTION_BLOCK_ORDER = [
  "candle_geometry_5", "labels_61", "probabilities_61", "embedding_256", "embedding_shuffled",
] as const;
export type DirectionBlock = (typeof DIRECTION_BLOCK_ORDER)[number];

export const COORDINATE_BLOCK = "embedding_coordinate_explained_by_labels";

export type BlockRole = "encoder" | "control" | "comparison";

export function blockRole(block: string): BlockRole {
  if (block === "embedding_256") return "encoder";
  if (block === "embedding_shuffled") return "control";
  return "comparison";
}

export const BLOCK_LABEL: Record<DirectionBlock, string> = {
  candle_geometry_5: "5 candle geometry numbers",
  labels_61: "61 TA-Lib labels",
  probabilities_61: "61 recogniser probabilities",
  embedding_256: "256-number embedding (the encoder)",
  embedding_shuffled: "256 shuffled rows (control)",
};

/** One direction-probe row: one feature block scored at one forward horizon. */
export interface DirectionRow {
  feature_block: string;
  forward_candle_count: number;
  feature_count: number;
  train_row_count: number;
  test_row_count: number;
  test_up_rate: number | null;
  area_under_curve_test: number | null;
  permutation_null_95th_percentile: number | null;
  permutation_null_median: number | null;
  beats_permutation_null: boolean | null;
  area_above_null_95th: number | null;
}

/** The ridge R-squared of one embedding coordinate from the 61 TA-Lib labels (fitted 2024, scored 2025). */
export interface CoordinateRow {
  embedding_coordinate: number;
  share_explained_by_the_61_labels: number;
  train_row_count: number | null;
  test_row_count: number | null;
}

/** A raw row of the probe table, as the lake returns it. */
export interface ProbeRow extends Omit<DirectionRow, "feature_block"> {
  feature_block: string;
  recipe?: string | null;
}

export function splitProbeRows(rows: readonly ProbeRow[]): { direction: DirectionRow[]; coordinates: CoordinateRow[] } {
  const direction: DirectionRow[] = [];
  const coordinates: CoordinateRow[] = [];
  for (const row of rows) {
    if (row.feature_block === COORDINATE_BLOCK) {
      if (row.area_under_curve_test === null || !Number.isFinite(row.area_under_curve_test)) continue;
      coordinates.push({
        embedding_coordinate: row.feature_count,
        share_explained_by_the_61_labels: row.area_under_curve_test,
        train_row_count: row.train_row_count ?? null,
        test_row_count: row.test_row_count ?? null,
      });
    } else {
      const { recipe: _recipe, ...rest } = row;
      direction.push(rest);
    }
  }
  coordinates.sort((a, b) => a.embedding_coordinate - b.embedding_coordinate);
  return { direction, coordinates };
}

/** One 5-minute candle of the real-window viewer. Times are epoch ms in the lake's stamps (Pacific wall clock stored as UTC). */
export interface WindowBar {
  timestamp_milliseconds: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WindowView {
  pattern: WindowPattern;
  /** Zero-based index of the firing among the first 30 holdout firings, after clamping to what exists. */
  firing_index: number;
  /** Holdout firings available (at most 30 are listed). */
  firing_count: number;
  anchor_timestamp_milliseconds: number;
  /** TA-Lib's value at the anchor bar: +100 bullish, -100 bearish, other magnitudes for some patterns. */
  signal: number;
  bars: WindowBar[];
}

export interface FrozenEncoderBody {
  /** The probe's recipe name, or null when the probe is not landed. */
  recipe: string | null;
  direction: DirectionRow[];
  coordinates: CoordinateRow[];
  /** Null when the bars dataset is not landed or the pattern never fires in the holdout. */
  window: WindowView | null;
}

/** The number of candles the recogniser was shown, and the model's own window. */
export const MODEL_WINDOW_CANDLES = 5;

/**
 * Figures the notebook typed into its prose. They are not recomputed here:
 * each cites where it came from, and the page prints them as recorded figures.
 */
export const RECORDED_FIGURES = {
  /** Scored windows by how many candles the pattern's rule needs (notebook :106). Source: chart_cnn synth scoring. */
  windowWidthCounts: [
    { candles: 1, windows: 37264 },
    { candles: 2, windows: 20717 },
    { candles: 3, windows: 21050 },
    { candles: 4, windows: 6266 },
    { candles: 5, windows: 5769 },
  ],
  heldOutWindowCount: 126624,
  directionCnn: { imageAreaUnderCurve: 0.504, numericControlAreaUnderCurve: 0.506 },
  candleShapeCorrelationBound: { absoluteCorrelationBelow: 0.005, barCount: 646932 },
  ruleMargins: { firingCount: 521568, withinTenPercentShare: 0.129, withinOnePercentShare: 0.027 },
  labelFreeEncoders: [
    { encoder: "autoencoder (16 numbers), hammer", learned: 0.0433, control: 0.4981, controlName: "the 64 raw window numbers" },
    { encoder: "vector-quantised (16), doji", learned: 0.2072, control: 0.307, controlName: "the 64 raw window numbers" },
    { encoder: "last-three-candle vector-quantised (8), bearish harami", learned: 0.2686, control: 0.2874, controlName: "the 15 raw part numbers" },
  ],
  untrainedAutoencoderAveragePrecision: 0.0471,
  neighbourPurityLift: { autoencoderShootingStar: 3.12, rawSixtyFourShootingStar: 8.33 },
  maskedCandleVolatilityCorrelation: { maskedCoordinate: 0.5658, worstControl: 0.0885 },
  adjustedMutualInformation: { learned: 0.1156, control: 0.1126 },
  rawVectorDirectionTest: { medianAreaUnderCurve: 0.5018, testCount: 132, significantAfterBenjaminiHochberg: 0 },
  sources: [
    "Trading/quant/chart_cnn/synth/train_synth_cnn.py (windows, embeddings, direction CNN)",
    "candlestick_rule_margins.py (rule margins)",
    "build_mnq_shape_embedding.py (label-free encoders versus raw controls)",
    "analytics/docs/FINDINGS.md section 3 (candle-shape correlations)",
  ],
} as const;

export interface CoordinateSummary {
  count: number;
  mean: number | null;
  median: number | null;
  minimum: number | null;
  maximum: number | null;
}

export function coordinateSummary(values: readonly number[]): CoordinateSummary {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return { count: 0, mean: null, median: null, minimum: null, maximum: null };
  const sorted = [...finite].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  const mean = finite.reduce((total, value) => total + value, 0) / finite.length;
  return { count: finite.length, mean, median, minimum: sorted[0] as number, maximum: sorted[sorted.length - 1] as number };
}

export interface HorizonVerdict {
  forward_candle_count: number;
  encoder: number | null;
  control: number | null;
  /** encoder minus control (the notebook's "advantage"). */
  advantage: number | null;
  encoderNull95: number | null;
  encoderBeatsNull: boolean | null;
  controlBeatsNull: boolean | null;
}

/** Encoder against the information-free shuffled control at every horizon present. */
export function horizonVerdicts(direction: readonly DirectionRow[]): HorizonVerdict[] {
  const horizons = [...new Set(direction.map((row) => row.forward_candle_count))].sort((a, b) => a - b);
  return horizons.map((horizon) => {
    const encoder = direction.find((row) => row.feature_block === "embedding_256" && row.forward_candle_count === horizon);
    const control = direction.find((row) => row.feature_block === "embedding_shuffled" && row.forward_candle_count === horizon);
    const encoderScore = encoder?.area_under_curve_test ?? null;
    const controlScore = control?.area_under_curve_test ?? null;
    return {
      forward_candle_count: horizon,
      encoder: encoderScore,
      control: controlScore,
      advantage: encoderScore !== null && controlScore !== null ? encoderScore - controlScore : null,
      encoderNull95: encoder?.permutation_null_95th_percentile ?? null,
      encoderBeatsNull: encoder?.beats_permutation_null ?? null,
      controlBeatsNull: control?.beats_permutation_null ?? null,
    };
  });
}

/** Blocks at one horizon that clear their own permutation null, in drawing order. */
export function winnersAtHorizon(direction: readonly DirectionRow[], horizon: number): string[] {
  return DIRECTION_BLOCK_ORDER.filter((block) => direction.some((row) => row.feature_block === block && row.forward_candle_count === horizon && row.beats_permutation_null === true));
}

export function windowWidthShares(counts: ReadonlyArray<{ candles: number; windows: number }>): Array<{ candles: number; windows: number; share: number }> {
  const total = counts.reduce((sum, entry) => sum + entry.windows, 0);
  return counts.map((entry) => ({ ...entry, share: total > 0 ? entry.windows / total : 0 }));
}
