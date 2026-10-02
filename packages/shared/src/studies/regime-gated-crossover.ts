/**
 * Regime-gated crossover study: the body of GET /api/studies/regime-gated-crossover,
 * and the dependent-data bootstrap the handler reruns when the page's
 * assumptions change.
 *
 * The bootstrap is a line-for-line port of the notebook's own module,
 * Trading/quant/analytics/latent/robust.py: Politis & White (2004) automatic
 * block length, the circular block bootstrap of the mean (Politis & Romano
 * 1992), the delete-one-block jackknife, and Efron's (1987) bias-corrected and
 * accelerated interval. `apps/api/tests/studies/regime-gated-crossover.test.ts`
 * checks each function against values the Python module printed for the same
 * inputs. Only the random generator differs (mulberry32 here, numpy's PCG64
 * there), so a live interval matches the landed record within Monte Carlo error,
 * never digit for digit; the landed record is the notebook's exact run.
 */

// ---------------------------------------------------------------- body types

export const STUDY_DATASET = "study_regime_gated_crossover";

/** One landed run per regime count (derived_study_regime_gated_crossover_runs). */
export interface RegimeRun {
  regime_count: number;
  symbol: string;
  window_start: string;
  window_end: string;
  fast_period: number;
  slow_period: number;
  fast_kind: string;
  slow_kind: string;
  fold_count: number;
  embargo_bars: number;
  feature_window_bars: number;
  bootstrap_replicates: number;
  minimum_bars_for_bootstrap: number;
  block_floor_bars: number;
  leak_shift_rows: number;
  seed: number;
  cost_points_per_side: number;
  annualisation_bars_per_year: number;
  one_minute_rows: number;
  five_minute_rows: number;
  feature_rows: number;
  labelled_one_minute_rows: number;
  net_return_bars: number;
  tagged_bar_count: number;
  untagged_bar_count: number;
  mean_transition_diagonal: number;
  chance_transition_diagonal: number;
  stickiness_check_passes: boolean;
  mean_walk_forward_sharpe: number;
  walk_forward_sharpe_check_passes: boolean;
  leak_control_maximum_difference: number;
  leak_control_check_passes: boolean;
  resolved_regime_count: number;
  resolved_regime_check_passes: boolean;
}

export interface FoldRow {
  regime_count: number;
  fold: number;
  train_end_index: number;
  train_bar_count: number;
  train_end_timestamp: number;
  test_start_index: number;
  test_end_index: number;
  test_bar_count: number;
  test_start_timestamp: number;
  test_end_timestamp: number;
  out_of_sample_sharpe: number;
  out_of_sample_bar_count: number;
  training_one_minute_rows: number;
  transition_diagonal_mean: number;
}

export interface TransitionRow {
  fold: number;
  from_regime: number;
  to_regime: number;
  transition_count: number;
  probability: number;
}

export interface CenterRow {
  fold: number;
  regime: number;
  size_center: number;
  flow_center: number;
  training_rows: number;
  training_share: number;
}

export type Verdict = "trade" | "sit_out" | "insufficient_sample";

/** The notebook's per-regime verdict, exactly as it computed it. */
export interface VerdictRecord {
  regime: number;
  bar_count: number;
  mean_net_return: number;
  standard_deviation: number;
  bca_low: number | null;
  bca_high: number | null;
  percentile_low: number | null;
  percentile_high: number | null;
  block_length: number | null;
  politis_white_block_length: number | null;
  bias_correction: number | null;
  acceleration: number | null;
  fraction_replicates_at_or_below_zero: number | null;
  verdict: Verdict;
}

export type GateStatus = "ship" | "do_not_ship" | "no_op";

export interface GateRecord {
  trade_regimes: string;
  sit_out_regimes: string;
  baseline_sharpe: number;
  gated_sharpe: number;
  mean_per_bar_effect: number;
  bar_count: number;
  bars_gated_out: number;
  bca_low: number | null;
  bca_high: number | null;
  percentile_low: number | null;
  percentile_high: number | null;
  block_length: number | null;
  politis_white_block_length: number | null;
  bias_correction: number | null;
  acceleration: number | null;
  bootstrap_mean: number | null;
  bootstrap_standard_deviation: number | null;
  fraction_replicates_at_or_below_zero: number | null;
  status: GateStatus;
}

export interface LeakRecord {
  regime: number;
  causal_mean_net_return: number;
  leaky_mean_net_return: number;
  absolute_difference: number;
  causal_bar_count: number;
  leaky_bar_count: number;
}

export interface HistogramBar {
  lower: number;
  upper: number;
  count: number;
}

export interface EightNumbers {
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

/** One regime recomputed with the page's assumptions. */
export interface LiveRegime {
  regime: number;
  barCount: number;
  meanNetReturn: number;
  summary: EightNumbers;
  histogram: HistogramBar[];
  interval: IntervalResult | null;
  verdict: Verdict;
}

export interface LiveLeak {
  regime: number;
  labelledMean: number | null;
  labelledCount: number;
  shiftedMean: number | null;
  shiftedCount: number;
  absoluteDifference: number | null;
}

export interface LiveFoldSharpe {
  fold: number;
  barCount: number;
  baselineSharpe: number;
  gatedSharpe: number;
  barsGatedOut: number;
}

export interface LiveGate {
  tradeRegimes: number[];
  source: "verdicts" | "chosen";
  scoredBarCount: number;
  barsGatedOut: number;
  baselineSharpe: number;
  gatedSharpe: number;
  baselineMeanNetReturn: number;
  gatedMeanNetReturn: number;
  baselineStandardDeviation: number;
  gatedStandardDeviation: number;
  meanPerBarEffect: number;
  interval: IntervalResult | null;
  status: GateStatus;
  folds: LiveFoldSharpe[];
}

export interface EquityPoint {
  timestamp: number;
  baseline: number;
  gated: number;
}

export interface FeaturePoint {
  timestamp: number;
  regime: number;
  size: number;
  flow: number;
  log_range: number;
  log_volume: number;
  next_log_range: number;
}

export interface BarSample {
  timestamp: number;
  close: number;
  position_held: number;
  net_return: number;
  regime: number;
  test_fold: number;
}

export interface LiveSettings {
  labelOffset: number;
  leakOffset: number;
  replicates: number;
  blockFloor: number;
  minimumBars: number;
  seed: number;
  bins: number;
  scope: "same" | "heldout";
  splitFold: number;
  splitTimestamp: number | null;
  verdictBarCount: number;
  untaggedBarCount: number;
}

export interface RegimeGatedCrossoverBody {
  regimeCounts: number[];
  regimeCount: number;
  run: RegimeRun | null;
  folds: FoldRow[];
  transitions: TransitionRow[];
  centers: CenterRow[];
  record: { verdicts: VerdictRecord[]; gate: GateRecord | null; leak: LeakRecord[] };
  live: {
    settings: LiveSettings;
    regimes: LiveRegime[];
    leak: LiveLeak[];
    gate: LiveGate | null;
    equity: EquityPoint[];
  } | null;
  features: FeaturePoint[];
  bars: BarSample[];
}

// --------------------------------------------------------- random generator

/** mulberry32: a small seeded generator returning uniforms in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = (Math.floor(seed) >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --------------------------------------------------------- normal distribution

/** The error function, to about 1e-13: its Taylor series inside |x| < 3, a continued fraction outside. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  if (a < 3) {
    let term = a;
    let sum = a;
    const squared = a * a;
    for (let n = 1; n < 200; n += 1) {
      term *= -squared / n;
      const piece = term / (2 * n + 1);
      sum += piece;
      if (Math.abs(piece) < 1e-17 * Math.abs(sum)) break;
    }
    return sign * (2 / Math.sqrt(Math.PI)) * sum;
  }
  // erfc(a) = exp(-a^2)/sqrt(pi) * 1/(a + 1/2/(a + 1/(a + 3/2/(a + ...)))) by modified Lentz.
  const tiny = 1e-300;
  let f = a;
  let c = a;
  let d = 0;
  for (let n = 1; n < 500; n += 1) {
    const coefficient = n / 2;
    d = a + coefficient * d;
    d = Math.abs(d) < tiny ? tiny : d;
    c = a + coefficient / c;
    c = Math.abs(c) < tiny ? tiny : c;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  const complement = Math.exp(-a * a) / Math.sqrt(Math.PI) / f;
  return sign * (1 - complement);
}

/** Standard normal cumulative distribution function (scipy's norm.cdf). */
export function normalCdf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Standard normal quantile (scipy's norm.ppf), Wichura's AS 241, about 1e-16 relative. */
export function normalQuantile(p: number): number {
  if (!(p >= 0 && p <= 1)) return Number.NaN;
  if (p === 0) return Number.NEGATIVE_INFINITY;
  if (p === 1) return Number.POSITIVE_INFINITY;
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (q * (((((((2509.0809287301226727 * r + 33430.575583588128105) * r + 67265.770927008700853) * r +
      45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r + 133.14166789178437745) * r +
      3.387132872796366608)) /
      (((((((5226.495278852545925 * r + 28729.085735721942674) * r + 39307.89580009271061) * r + 21213.794301586595867) * r +
        5394.1960214247511077) * r + 687.1870074920579083) * r + 42.313330701600911252) * r + 1);
  }
  let r = q < 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  let value: number;
  if (r <= 5) {
    r -= 1.6;
    value = (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r + 0.24178072517745061177) * r +
      1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r + 4.6303378461565452959) * r +
      1.42343711074968357734) /
      (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r +
        0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r + 2.05319162663775882187) * r + 1);
  } else {
    r -= 5;
    value = (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r +
      0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r + 5.4637849111641143699) * r +
      6.6579046435011037772) /
      (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r +
        7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r + 0.59983220655588793769) * r + 1);
  }
  return q < 0 ? -value : value;
}

// ------------------------------------------------------------ small statistics

export function mean(values: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i] as number;
  return values.length > 0 ? sum / values.length : Number.NaN;
}

/** Sample standard deviation (ddof = 1). */
export function standardDeviation(values: ArrayLike<number>): number {
  const n = values.length;
  if (n < 2) return Number.NaN;
  const average = mean(values);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += ((values[i] as number) - average) ** 2;
  return Math.sqrt(sum / (n - 1));
}

/** The crossover module's `_sharpe`: mean / sd(ddof 1) * sqrt(bars per year); 0 when undefined. */
export function sharpe(values: ArrayLike<number>, barsPerYear: number): number {
  if (values.length < 2) return 0;
  const deviation = standardDeviation(values);
  if (!(deviation > 0) || !Number.isFinite(deviation)) return 0;
  return (mean(values) / deviation) * Math.sqrt(barsPerYear);
}

/** numpy.quantile's default ("linear") on an ascending array. */
export function sortedQuantile(sorted: ArrayLike<number>, probability: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const position = (n - 1) * Math.min(Math.max(probability, 0), 1);
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, n - 1);
  const weight = position - lower;
  const a = sorted[lower] as number;
  const b = sorted[upper] as number;
  return a + (b - a) * weight;
}

// ------------------------------------------------------- dependent bootstrap

/** Biased (divide-by-n) sample autocovariance at lags 0..maxLag, mean-centred. */
export function autocovariance(values: ArrayLike<number>, maxLag: number): Float64Array {
  const n = values.length;
  if (maxLag < 0 || maxLag >= n) throw new Error(`autocovariance: maxLag ${maxLag} outside [0, ${n - 1}]`);
  const average = mean(values);
  const centred = new Float64Array(n);
  for (let i = 0; i < n; i += 1) centred[i] = (values[i] as number) - average;
  const out = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < n; i += 1) sum += (centred[i] as number) * (centred[i + lag] as number);
    out[lag] = sum / n;
  }
  return out;
}

function flatTop(s: number): number {
  const a = Math.abs(s);
  if (a <= 0.5) return 1;
  if (a <= 1) return 2 * (1 - a);
  return 0;
}

export interface PolitisWhite {
  n: number;
  lagWindowCount: number;
  maximumLagSearched: number;
  significanceBand: number;
  dependenceHorizon: number;
  horizonTruncated: boolean;
  windowLength: number;
  firstLagAutocorrelation: number;
  gHat: number;
  spectralDensityAtZero: number;
  dCircularBlock: number;
  rawBlockLength: number;
  maximumAdmissibleBlockLength: number;
  blockLength: number;
}

/** Politis & White (2004) automatic circular-block-bootstrap block length. */
export function politisWhiteBlockLength(values: ArrayLike<number>): PolitisWhite {
  const n = values.length;
  if (n < 100) throw new Error(`politis_white_block_length: ${n} observations is too few`);
  const kN = Math.max(5, Math.ceil(Math.sqrt(Math.log10(n))));
  const maxLag = Math.min(n - 1, Math.ceil(Math.sqrt(n)) + kN);
  let covariance = autocovariance(values, maxLag);
  const variance = covariance[0] as number;
  if (!(variance > 0)) throw new Error("politis_white_block_length: the series has zero variance");
  const band = 2 * Math.sqrt(Math.log10(n) / n);
  let horizon = -1;
  for (let m = 0; m <= maxLag - kN; m += 1) {
    let quiet = true;
    for (let k = m + 1; k <= m + kN; k += 1) {
      if (!(Math.abs((covariance[k] as number) / variance) < band)) {
        quiet = false;
        break;
      }
    }
    if (quiet) {
      horizon = m;
      break;
    }
  }
  const truncated = horizon < 0;
  if (truncated) horizon = maxLag - kN;
  let window = Math.max(2 * horizon, 1);
  if (window > covariance.length - 1) {
    covariance = autocovariance(values, Math.min(window, n - 1));
    window = Math.min(window, covariance.length - 1);
  }
  let g = 0;
  let spectral = 0;
  for (let lag = -window; lag <= window; lag += 1) {
    const weight = flatTop(lag / window);
    const r = covariance[Math.abs(lag)] as number;
    g += weight * Math.abs(lag) * r;
    spectral += weight * r;
  }
  const dCircular = (4 / 3) * spectral * spectral;
  if (!(dCircular > 0)) throw new Error("politis_white_block_length: non-positive spectral estimate at the origin");
  const raw = Math.cbrt((2 * g * g) / dCircular) * Math.cbrt(n);
  const maximum = Math.ceil(Math.min(3 * Math.sqrt(n), n / 3));
  const block = Math.trunc(Math.min(Math.max(Math.ceil(raw), 1), maximum));
  return {
    n, lagWindowCount: kN, maximumLagSearched: maxLag, significanceBand: band, dependenceHorizon: horizon,
    horizonTruncated: truncated, windowLength: window, firstLagAutocorrelation: (covariance[1] as number) / variance,
    gHat: g, spectralDensityAtZero: spectral, dCircularBlock: dCircular, rawBlockLength: raw,
    maximumAdmissibleBlockLength: maximum, blockLength: block,
  };
}

/** `replicates` circular-block-bootstrap means: blocks wrap past the end, n values per replicate. */
export function circularBlockMeans(values: ArrayLike<number>, block: number, replicates: number, random: () => number): Float64Array {
  const n = values.length;
  if (block < 1 || block > n) throw new Error(`circular_block_means: block ${block} outside [1, ${n}]`);
  const cumulative = new Float64Array(n + block + 1);
  for (let i = 0; i < n + block; i += 1) cumulative[i + 1] = (cumulative[i] as number) + (values[i % n] as number);
  const full = Math.floor(n / block);
  const remainder = n - full * block;
  const out = new Float64Array(replicates);
  for (let r = 0; r < replicates; r += 1) {
    let total = 0;
    for (let b = 0; b < full; b += 1) {
      const start = Math.floor(random() * n);
      total += (cumulative[start + block] as number) - (cumulative[start] as number);
    }
    if (remainder > 0) {
      const start = Math.floor(random() * n);
      total += (cumulative[start + remainder] as number) - (cumulative[start] as number);
    }
    out[r] = total / n;
  }
  return out;
}

/** Delete-one-block jackknife means; a trailing partial block joins the last one. */
export function blockJackknifeMeans(values: ArrayLike<number>, block: number): Float64Array {
  const n = values.length;
  const blocks = Math.floor(n / block);
  if (blocks < 3) throw new Error(`block_jackknife_means: block ${block} leaves only ${blocks} blocks`);
  const cumulative = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) cumulative[i + 1] = (cumulative[i] as number) + (values[i] as number);
  const total = cumulative[n] as number;
  const out = new Float64Array(blocks);
  for (let b = 0; b < blocks; b += 1) {
    const start = b * block;
    const end = b === blocks - 1 ? n : start + block;
    const sum = (cumulative[end] as number) - (cumulative[start] as number);
    out[b] = (total - sum) / (n - (end - start));
  }
  return out;
}

export interface IntervalResult {
  theta: number;
  bcaLow: number;
  bcaHigh: number;
  percentileLow: number;
  percentileHigh: number;
  bcaProbabilityLow: number;
  bcaProbabilityHigh: number;
  biasCorrection: number;
  acceleration: number;
  fractionAtOrBelowZero: number;
  bootstrapMean: number;
  bootstrapStandardDeviation: number;
  replicates: number;
  blockLength: number;
  politisWhiteBlockLength: number;
  jackknifeBlocks: number;
  /** Every intermediate of the block-length rule, for the formula card. */
  politisWhite: PolitisWhite;
}

/** Efron's BCa interval from the replicates and the block jackknife, at level 1 - alpha. */
export function bcaInterval(theta: number, replicates: ArrayLike<number>, jackknife: ArrayLike<number>, alpha = 0.05) {
  const count = replicates.length;
  let below = 0;
  let atOrBelowZero = 0;
  for (let i = 0; i < count; i += 1) {
    const value = replicates[i] as number;
    if (value < theta) below += 1;
    if (value <= 0) atOrBelowZero += 1;
  }
  const clamped = Math.min(Math.max(below / count, 1 / (2 * count)), 1 - 1 / (2 * count));
  const z0 = normalQuantile(clamped);
  const jackknifeMean = mean(jackknife);
  let squares = 0;
  let cubes = 0;
  for (let i = 0; i < jackknife.length; i += 1) {
    const difference = jackknifeMean - (jackknife[i] as number);
    squares += difference * difference;
    cubes += difference * difference * difference;
  }
  const denominator = 6 * squares ** 1.5;
  const a = denominator > 0 ? cubes / denominator : 0;
  const adjust = (z: number) => {
    const numerator = z0 + z;
    const scale = 1 - a * numerator;
    if (scale <= 0) throw new Error(`bca_interval: acceleration ${a} and bias ${z0} leave no BCa transformation`);
    return normalCdf(z0 + numerator / scale);
  };
  const lowProbability = adjust(normalQuantile(alpha / 2));
  const highProbability = adjust(normalQuantile(1 - alpha / 2));
  const sorted = Float64Array.from(replicates).sort();
  return {
    theta,
    bcaLow: sortedQuantile(sorted, lowProbability),
    bcaHigh: sortedQuantile(sorted, highProbability),
    percentileLow: sortedQuantile(sorted, alpha / 2),
    percentileHigh: sortedQuantile(sorted, 1 - alpha / 2),
    bcaProbabilityLow: lowProbability,
    bcaProbabilityHigh: highProbability,
    biasCorrection: z0,
    acceleration: a,
    fractionAtOrBelowZero: atOrBelowZero / count,
    bootstrapMean: mean(sorted),
    bootstrapStandardDeviation: standardDeviation(sorted),
  };
}

/**
 * The notebook's recipe for one series: Politis-White block length, floored at
 * `blockFloor`, capped at n / 3; circular block replicates; block jackknife; BCa.
 */
export function bootstrapMeanInterval(values: ArrayLike<number>, options: { blockFloor: number; replicates: number; random: () => number }): IntervalResult {
  const politisWhite = politisWhiteBlockLength(values);
  const block = Math.min(Math.max(options.blockFloor, politisWhite.blockLength), Math.floor(values.length / 3));
  const replicates = circularBlockMeans(values, block, options.replicates, options.random);
  const jackknife = blockJackknifeMeans(values, block);
  const interval = bcaInterval(mean(values), replicates, jackknife);
  return {
    ...interval, replicates: options.replicates, blockLength: block, politisWhiteBlockLength: politisWhite.blockLength,
    jackknifeBlocks: jackknife.length, politisWhite,
  };
}

/** The generator a regime's (or the gate's) bootstrap draws from: its own, so intervals do not depend on order. */
export function streamSeed(seed: number, stream: number): number {
  return (Math.imul(seed + 1, 2654435761) ^ Math.imul(stream + 17, 40503)) >>> 0;
}

// ----------------------------------------------------------- gate evaluation

export interface TaggedBars {
  timestamp: Float64Array;
  netReturn: Float64Array;
  testFold: Int32Array;
  regime: Int32Array;
}

export interface VerdictOptions {
  minimumBars: number;
  blockFloor: number;
  replicates: number;
  seed: number;
}

export function regimeVerdict(values: Float64Array, regime: number, options: VerdictOptions): { interval: IntervalResult | null; verdict: Verdict } {
  if (values.length < Math.max(options.minimumBars, 100)) return { interval: null, verdict: "insufficient_sample" };
  const interval = bootstrapMeanInterval(values, {
    blockFloor: options.blockFloor,
    replicates: options.replicates,
    random: seededRandom(streamSeed(options.seed, regime)),
  });
  return { interval, verdict: interval.bcaLow > 0 ? "trade" : "sit_out" };
}

export const GATE_STREAM = 1000;

/**
 * Score a gate on the bars in [from, end): baseline and gated Sharpe, the
 * per-bar effect (gated minus baseline) and its BCa interval, and the same two
 * Sharpe ratios inside each walk-forward test fold.
 */
export function evaluateGate(bars: TaggedBars, tradeRegimes: readonly number[], from: number, options: VerdictOptions & { barsPerYear: number; source: "verdicts" | "chosen" }): LiveGate {
  const trade = new Set(tradeRegimes);
  const indices: number[] = [];
  for (let i = 0; i < bars.timestamp.length; i += 1) if ((bars.timestamp[i] as number) >= from) indices.push(i);
  const baseline = new Float64Array(indices.length);
  const gated = new Float64Array(indices.length);
  const effect = new Float64Array(indices.length);
  let gatedOut = 0;
  const byFold = new Map<number, { baseline: number[]; gated: number[]; out: number }>();
  indices.forEach((index, position) => {
    const value = bars.netReturn[index] as number;
    const inside = trade.has(bars.regime[index] as number);
    baseline[position] = value;
    gated[position] = inside ? value : 0;
    effect[position] = (gated[position] as number) - value;
    if (!inside) gatedOut += 1;
    const fold = bars.testFold[index] as number;
    if (fold >= 0) {
      const entry = byFold.get(fold) ?? { baseline: [], gated: [], out: 0 };
      entry.baseline.push(value);
      entry.gated.push(inside ? value : 0);
      if (!inside) entry.out += 1;
      byFold.set(fold, entry);
    }
  });
  // numpy.allclose(effect, 0): every |value| within the default absolute tolerance 1e-8.
  const allZero = effect.every((value) => Math.abs(value) <= 1e-8);
  let interval: IntervalResult | null = null;
  let status: GateStatus = "no_op";
  if (!allZero && effect.length >= 100) {
    interval = bootstrapMeanInterval(effect, {
      blockFloor: options.blockFloor,
      replicates: options.replicates,
      random: seededRandom(streamSeed(options.seed, GATE_STREAM)),
    });
    status = interval.bcaLow > 0 ? "ship" : "do_not_ship";
  }
  return {
    tradeRegimes: [...trade].sort((a, b) => a - b),
    source: options.source,
    scoredBarCount: indices.length,
    barsGatedOut: gatedOut,
    baselineSharpe: sharpe(baseline, options.barsPerYear),
    gatedSharpe: sharpe(gated, options.barsPerYear),
    baselineMeanNetReturn: mean(baseline),
    gatedMeanNetReturn: mean(gated),
    baselineStandardDeviation: standardDeviation(baseline),
    gatedStandardDeviation: standardDeviation(gated),
    meanPerBarEffect: mean(effect),
    interval,
    status,
    folds: [...byFold.entries()].sort((a, b) => a[0] - b[0]).map(([fold, entry]) => ({
      fold,
      barCount: entry.baseline.length,
      baselineSharpe: sharpe(entry.baseline, options.barsPerYear),
      gatedSharpe: sharpe(entry.gated, options.barsPerYear),
      barsGatedOut: entry.out,
    })),
  };
}

/** Parse the page's gate choice: "verdicts" (use the verdicts) or a comma list of regimes. */
export function parseGateChoice(choice: string, regimeCount: number): number[] | null {
  if (choice === "verdicts") return null;
  if (choice === "none") return [];
  return [...new Set(choice.split(",").map((part) => Number(part)).filter((value) => Number.isInteger(value) && value >= 0 && value < regimeCount))].sort((a, b) => a - b);
}
