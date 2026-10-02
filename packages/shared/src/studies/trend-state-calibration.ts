/**
 * TrendState calibration study: the body of GET /api/studies/trend-state-calibration
 * and the pure compute the page runs on it.
 *
 * The two computations are faithful ports of Trading/quant/analytics/trend/trend_state.py:
 *   `regimeScan`      = `_regime_scan` (the per-rung, per-session Schmitt trigger),
 *   `RingRegression`  = `RingRegression` (O(1) incremental least squares on a ring
 *                       buffer, sums on price minus the first price, Neumaier compensation).
 * apps/api/tests/studies/trend-state-calibration.test.ts holds both to numbers the
 * Python produced.
 */

/** Session types the thresholds are held per, in trend_state.SESSION_TYPES order (the codes are indices). */
export const SESSION_TYPES = ["first_thirty_minutes", "regular_trading_hours", "overnight"] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

/** The p_entry steps of the notebook's slider (and of the calibration grid). */
export const ENTRY_PROBABILITY_STEPS = [1e-2, 5e-3, 2e-3, 1e-3, 5e-4, 2e-4, 1e-4] as const;

/**
 * The 24 prices of the ring-buffer stepper: 100 + cumsum(numpy default_rng(7).normal(0.4, 1.0, 24)),
 * copied at full precision because numpy's generator is not reproducible in JavaScript.
 */
export const STEPPER_PRICES: readonly number[] = [
  100.40123015335749, 101.09997569086595, 101.22583783550374, 100.73524599674646, 100.68057521157473, 100.08892865657828,
  100.54907225917572, 102.28928750473025, 102.19708098617892, 101.97660608635898, 102.86644813654418, 103.62333514470424,
  104.12874939370214, 103.59828134899394, 103.96902952653066, 105.06433272098894, 104.12011817370386, 104.06250241266365,
  102.5612796728628, 101.67174193307783, 100.2300068952861, 100.39491576421142, 99.52746928276771, 100.19873364158941,
];

// ---------------------------------------------------------------------------
// Response body
// ---------------------------------------------------------------------------

export interface ThresholdRow {
  rung: string;
  timeframe: string;
  window_bars: number;
  session_type: string;
  entry_probability: number;
  exit_probability: number;
  entry_threshold_scaled_t: number;
  exit_threshold_scaled_t: number;
  null_scheme: string;
}

export interface NullQuantileRow {
  null_scheme: string;
  rung: string;
  session_type: string;
  quantile_level: number;
  scaled_t_quantile: number;
  null_observations: number | null;
}

export interface ThresholdGridRow {
  null_scheme: string;
  entry_probability: number;
  exit_probability: number;
  session_type: string;
  null_false_entries_per_session: number | null;
  null_false_entries_per_session_standard_deviation: number | null;
  null_on_share: number | null;
  null_mean_episode_bars: number | null;
  null_chatter_rate: number | null;
  replicates: number | null;
  effective_null_observations: number | null;
  expected_null_exceedances: number | null;
  tail_supported: boolean | null;
}

export interface MetricRow {
  metric: string;
  stratum: string;
  value: number | null;
  observation_count: number | null;
  target: number | null;
  null_mean: number | null;
  null_low: number | null;
  null_high: number | null;
  real_over_null: number | null;
  low: number | null;
  high: number | null;
  rung: string | null;
  expected_absolute_move_points: number | null;
  round_trip_cost_points: number | null;
  below_minimum_sample: boolean | null;
}

export interface EpisodeRow {
  /** Epoch milliseconds of the stamped wall-clock time (Eastern). */
  entry_time: number;
  exit_time: number;
  side: number;
  bars: number;
  session_type: string;
  month: string;
  winning_rung: string;
  entry_scaled_t: number;
  label_at_entry: number | null;
  label_horizon_bars: number | null;
  agrees_with_label: boolean | null;
  gross_points: number;
  net_points: number;
  forward_log_return_at_label_horizon: number | null;
}

export interface DistributionRow {
  name: string;
  group: string;
  observation_count: number;
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

export type OverfittingRow = Record<string, string | number | null>;

/** One minute bar of the landed sample: close, every rung's statistics and the calibrated flag. */
export type SampleBarRow = Record<string, string | number | null> & {
  close_time: number;
  close: number;
  trend_regime_state: number | null;
  trend_regime_entry_evidence: number | null;
  trend_regime_session_type: string | null;
};

export interface TrendStateCalibrationBody {
  /** Every landed recipe, newest name first. */
  recipes: string[];
  /** The recipe this body is for ("" when nothing is landed). */
  recipe: string;
  /** The single settings row of the run (all its columns, the verdict and every check_*). */
  settings: Record<string, string | number | boolean | null>;
  /** Rung names in ladder order (from the thresholds table). */
  rungs: string[];
  thresholds: ThresholdRow[];
  nullQuantiles: NullQuantileRow[];
  thresholdGrid: ThresholdGridRow[];
  metrics: MetricRow[];
  episodes: EpisodeRow[];
  distributions: DistributionRow[];
  overfitting: OverfittingRow[];
  /** Globex days in the landed sample (close time minus 18 hours, as a date), oldest first. */
  days: string[];
  day: string;
  /** Every bar of `day`, oldest first. */
  bars: SampleBarRow[];
}

// ---------------------------------------------------------------------------
// τ at a p_entry: linear interpolation on the log tail probability (np.interp)
// ---------------------------------------------------------------------------

/** numpy.interp: clamps outside the table; `xs` ascending. */
export function interpolate(x: number, xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n === 0) return Number.NaN;
  if (x <= (xs[0] as number)) return ys[0] as number;
  if (x >= (xs[n - 1] as number)) return ys[n - 1] as number;
  for (let i = 1; i < n; i += 1) {
    const right = xs[i] as number;
    if (x <= right) {
      const left = xs[i - 1] as number;
      const fraction = right === left ? 0 : (x - left) / (right - left);
      return (ys[i - 1] as number) + fraction * ((ys[i] as number) - (ys[i - 1] as number));
    }
  }
  return ys[n - 1] as number;
}

/**
 * The null's |scaled t| at tail probability `entryProbability` for one (scheme, rung, session):
 * sorted by tail probability 1 − quantile_level, interpolated on log tail probability.
 */
export function tauAt(rows: readonly NullQuantileRow[], entryProbability: number): number {
  const points = rows
    .map((row) => ({ tail: 1 - row.quantile_level, value: row.scaled_t_quantile }))
    .filter((point) => point.tail > 0 && Number.isFinite(point.value))
    .sort((a, b) => a.tail - b.tail);
  return interpolate(Math.log(entryProbability), points.map((point) => Math.log(point.tail)), points.map((point) => point.value));
}

// ---------------------------------------------------------------------------
// The flag: _regime_scan
// ---------------------------------------------------------------------------

export interface RegimeScan {
  /** +1 long, −1 short, 0 flat, per bar. */
  state: number[];
  /** max over rungs of |scaled t| ÷ entry level (NaN when no rung is full). */
  entryEvidence: number[];
  /** Strongest same-signed rung against its exit level while a flag is held (NaN otherwise). */
  exitEvidence: number[];
  /** Index of the winning rung, −1 when none. */
  winner: number[];
}

/**
 * Per bar, the Schmitt trigger of trend_state._regime_scan. `scaled` is (bars × rungs)
 * with NaN / null for a rung that is not full, `session` the session-type code per bar,
 * `entry` / `exit` (rungs × session types). Starts flat.
 */
export function regimeScan(
  scaled: ReadonlyArray<ReadonlyArray<number | null>>,
  session: readonly number[],
  entry: ReadonlyArray<readonly number[]>,
  exit: ReadonlyArray<readonly number[]>,
  allowShort: boolean,
): RegimeScan {
  const bars = scaled.length;
  const state = new Array<number>(bars).fill(0);
  const entryEvidence = new Array<number>(bars).fill(Number.NaN);
  const exitEvidence = new Array<number>(bars).fill(Number.NaN);
  const winner = new Array<number>(bars).fill(-1);
  let position = 0;
  for (let row = 0; row < bars; row += 1) {
    const values = scaled[row] as ReadonlyArray<number | null>;
    const code = session[row] as number;
    let bestUp = 0;
    let bestDown = 0;
    let bestUpRung = -1;
    let bestDownRung = -1;
    let anyValid = false;
    for (let rung = 0; rung < values.length; rung += 1) {
      const value = values[rung];
      if (value === null || value === undefined || !Number.isFinite(value)) continue;
      anyValid = true;
      const ratio = Math.abs(value) / ((entry[rung] as readonly number[])[code] as number);
      if (value > 0) {
        if (ratio > bestUp) {
          bestUp = ratio;
          bestUpRung = rung;
        }
      } else if (value < 0) {
        if (ratio > bestDown) {
          bestDown = ratio;
          bestDownRung = rung;
        }
      }
    }
    if (!anyValid) {
      position = 0;
      continue;
    }
    const upEntry = bestUp >= 1;
    const downEntry = bestDown >= 1 && allowShort;
    if (position === 0) {
      if (upEntry && !downEntry) position = 1;
      else if (downEntry && !upEntry) position = -1;
    } else {
      const side = position;
      let hold = 0;
      for (let rung = 0; rung < values.length; rung += 1) {
        const value = values[rung];
        if (value === null || value === undefined || !Number.isFinite(value) || value * side <= 0) continue;
        const ratio = Math.abs(value) / ((exit[rung] as readonly number[])[code] as number);
        if (ratio > hold) hold = ratio;
      }
      const oppositeEntry = side > 0 ? downEntry : upEntry;
      if (oppositeEntry || hold < 1) position = 0;
      exitEvidence[row] = hold;
    }
    state[row] = position;
    entryEvidence[row] = bestUp >= bestDown ? bestUp : bestDown;
    winner[row] = bestUp >= bestDown ? bestUpRung : bestDownRung;
  }
  return { state, entryEvidence, exitEvidence, winner };
}

/**
 * The live levels the notebook fed the scan: entry × τ multiplier, and exit × η
 * multiplier capped just under the entry level (a Schmitt trigger needs exit < entry).
 */
export function scaledLevels(
  entry: ReadonlyArray<readonly number[]>,
  exit: ReadonlyArray<readonly number[]>,
  entryMultiplier: number,
  exitMultiplier: number,
): { entry: number[][]; exit: number[][] } {
  const liveEntry = entry.map((row) => row.map((value) => value * entryMultiplier));
  const liveExit = exit.map((row, rung) => row.map((value, code) => Math.min(value * exitMultiplier, ((liveEntry[rung] as number[])[code] as number) * 0.999)));
  return { entry: liveEntry, exit: liveExit };
}

// ---------------------------------------------------------------------------
// One buffer: RingRegression
// ---------------------------------------------------------------------------

function neumaierAdd(total: number, compensation: number, value: number): [number, number] {
  const candidate = total + value;
  let next = compensation;
  if (Math.abs(total) >= Math.abs(value)) next += total - candidate + value;
  else next += value - candidate + total;
  return [candidate, next];
}

export interface RegressionStatistics {
  slope: number;
  /** Fitted price at the oldest bar of the window. */
  intercept: number;
  tStatistic: number;
  scaledTStatistic: number;
  rSquared: number;
}

function fitFromSums(length: number, sumIndex: number, sumIndexSquared: number, sumPrice: number, sumIndexPrice: number, sumPriceSquared: number): [number, number, number, number] {
  const denominator = length * sumIndexSquared - sumIndex * sumIndex;
  const slope = (length * sumIndexPrice - sumIndex * sumPrice) / denominator;
  const intercept = (sumPrice - slope * sumIndex) / length;
  let sumSquaredError = sumPriceSquared - intercept * sumPrice - slope * sumIndexPrice;
  const totalSumSquares = sumPriceSquared - (sumPrice * sumPrice) / length;
  if (totalSumSquares <= 1e-12) return [slope, intercept, Number.NaN, Number.NaN];
  const tolerance = 1e-9 * totalSumSquares;
  if (sumSquaredError < 0) sumSquaredError = sumSquaredError > -tolerance ? 0 : Number.NaN;
  if (Number.isNaN(sumSquaredError)) return [slope, intercept, Number.NaN, Number.NaN];
  if (sumSquaredError < tolerance) return [slope, intercept, Number.NaN, 1];
  const residualVariance = sumSquaredError / (length - 2);
  const standardError = Math.sqrt(residualVariance / (sumIndexSquared - (sumIndex * sumIndex) / length));
  return [slope, intercept, slope / standardError, 1 - sumSquaredError / totalSumSquares];
}

/** One ring buffer of `window` prices with the O(1) incremental least squares. */
export class RingRegression {
  readonly window: number;
  readonly sumIndex: number;
  readonly sumIndexSquared: number;
  private buffer: number[];
  private head = 0;
  private count = 0;
  private reference = 0;
  private sumPrice = 0;
  private sumPriceCompensation = 0;
  private sumIndexPrice = 0;
  private sumIndexPriceCompensation = 0;
  private sumPriceSquared = 0;
  private sumPriceSquaredCompensation = 0;

  constructor(window: number) {
    if (!Number.isInteger(window) || window < 3) throw new Error(`window must be an integer >= 3, got ${window}`);
    this.window = window;
    this.sumIndex = (window * (window - 1)) / 2;
    this.sumIndexSquared = ((window - 1) * window * (2 * window - 1)) / 6;
    this.buffer = new Array<number>(window).fill(Number.NaN);
  }

  get full(): boolean {
    return this.count >= this.window;
  }

  /** The price every sum is centred on (the first price admitted). */
  get centre(): number {
    return this.reference;
  }

  /** The window's prices, oldest first. */
  values(): number[] {
    if (!this.full) return this.buffer.slice(0, this.count).map((value) => value + this.reference);
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)].map((value) => value + this.reference);
  }

  /** Admit one bar close. O(1). */
  update(price: number): void {
    if (!Number.isFinite(price)) throw new Error("price must be finite");
    if (this.count < this.window) {
      if (this.count === 0) this.reference = price;
      const centred = price - this.reference;
      this.buffer[this.count] = centred;
      [this.sumPrice, this.sumPriceCompensation] = neumaierAdd(this.sumPrice, this.sumPriceCompensation, centred);
      [this.sumPriceSquared, this.sumPriceSquaredCompensation] = neumaierAdd(this.sumPriceSquared, this.sumPriceSquaredCompensation, centred * centred);
      [this.sumIndexPrice, this.sumIndexPriceCompensation] = neumaierAdd(this.sumIndexPrice, this.sumIndexPriceCompensation, this.count * centred);
      this.count += 1;
      return;
    }
    const oldest = this.buffer[this.head] as number;
    const entering = price - this.reference;
    this.buffer[this.head] = entering;
    this.head = (this.head + 1) % this.window;
    // ΣiP first: it needs the OLD ΣP.
    const oldSumPrice = this.sumPrice + this.sumPriceCompensation;
    [this.sumIndexPrice, this.sumIndexPriceCompensation] = neumaierAdd(this.sumIndexPrice, this.sumIndexPriceCompensation, -oldSumPrice + oldest + (this.window - 1) * entering);
    [this.sumPriceSquared, this.sumPriceSquaredCompensation] = neumaierAdd(this.sumPriceSquared, this.sumPriceSquaredCompensation, entering * entering - oldest * oldest);
    [this.sumPrice, this.sumPriceCompensation] = neumaierAdd(this.sumPrice, this.sumPriceCompensation, entering - oldest);
  }

  /** (ΣP, ΣiP, ΣP²) on the centred prices, compensation applied. */
  sums(): [number, number, number] {
    return [
      this.sumPrice + this.sumPriceCompensation,
      this.sumIndexPrice + this.sumIndexPriceCompensation,
      this.sumPriceSquared + this.sumPriceSquaredCompensation,
    ];
  }

  /** All NaN until the buffer is full. */
  statistics(): RegressionStatistics {
    if (!this.full) return { slope: Number.NaN, intercept: Number.NaN, tStatistic: Number.NaN, scaledTStatistic: Number.NaN, rSquared: Number.NaN };
    const [sumPrice, sumIndexPrice, sumPriceSquared] = this.sums();
    const [slope, intercept, tStatistic, rSquared] = fitFromSums(this.window, this.sumIndex, this.sumIndexSquared, sumPrice, sumIndexPrice, sumPriceSquared);
    return { slope, intercept: intercept + this.reference, tStatistic, scaledTStatistic: tStatistic / Math.sqrt(this.window), rSquared };
  }
}

export interface StepperRow {
  bar: number;
  price: number;
  sumPrice: number;
  sumIndexPrice: number;
  sumPriceSquared: number;
  slope: number;
  intercept: number;
  tStatistic: number;
  scaledTStatistic: number;
  rSquared: number;
}

/** The notebook's stepper: `admitted` prices fed to one ring buffer of `window`, a row per bar. */
export function stepRingBuffer(prices: readonly number[], window: number, admitted: number): { rows: StepperRow[]; buffer: number[]; centre: number } {
  const regression = new RingRegression(window);
  const rows: StepperRow[] = [];
  const count = Math.max(0, Math.min(admitted, prices.length));
  for (let k = 0; k < count; k += 1) {
    const price = prices[k] as number;
    regression.update(price);
    const [sumPrice, sumIndexPrice, sumPriceSquared] = regression.sums();
    rows.push({ bar: k + 1, price, sumPrice, sumIndexPrice, sumPriceSquared, ...regression.statistics() });
  }
  return { rows, buffer: regression.values(), centre: regression.centre };
}
