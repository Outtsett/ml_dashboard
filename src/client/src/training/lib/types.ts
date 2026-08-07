/**
 * Training Center — Shared Types, Constants & Verdict System
 *
 * All interfaces, color palettes, verdict lookup tables, and chart styling
 * constants used across the Training Center sub-components.
 */

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface TrainingProgress {
  step: number;
  totalSteps: number;
  phase: string;
  message: string;
  pct: number;
}

export interface LiveMetrics {
  gibbsIter: number;
  gibbsTotal: number;
  logLikelihood: number;
  activeStates: number;
  delta: number;
  fitPerBar: number;
  entropy: number;
  switchRate: number;
  selfTransition: number;
  maxRegimePct: number;
  avgDwell: number;
  nBarsTotal: number;
  regimesDiscovered: number;
  stability: number;
  oosSimilarity: number;
  oosCorrelation: number;
  qualityScore: number;
  elapsed: number;
}

export const INITIAL_LIVE_METRICS: LiveMetrics = {
  gibbsIter: 0, gibbsTotal: 0,
  logLikelihood: 0, activeStates: 0, delta: 0,
  fitPerBar: 0, entropy: 0, switchRate: 0, selfTransition: 0, maxRegimePct: 0, avgDwell: 0,
  nBarsTotal: 0,
  regimesDiscovered: 0, stability: 0,
  oosSimilarity: 0, oosCorrelation: 0, qualityScore: 0,
  elapsed: 0,
};

export interface RegimeModel {
  id: string;
  modelType: string;
  symbol: string;
  timeframe: string;
  n_regimes: number;
  n_bars: number;
  n_bars_total?: number;
  n_bars_train_val?: number;
  n_bars_test?: number;
  quality_score?: number;
  date_range: { start: string; end: string; train_end?: string; test_start?: string };
  training_config?: {
    gibbs_iter: number; burn_in: number; test_split: number;
    walk_forward_windows: number; alpha: number; gamma: number; kappa: number;
  };
  training_time_sec: number;
  trained_at: string;
}

export interface RegimeStat {
  regime_id: number;
  count: number;
  pct: number;
  avg_return: number;
  avg_return_pct?: number;
  avg_volatility: number;
  avg_range: number;
  avg_atr_ratio: number;
  avg_duration: number;
  max_duration: number;
  label: string;
  nickname?: string;
  volatility_state?: string;
  bar_character?: string;
  characteristics: Record<string, number>;
}

export interface ShapFeature {
  feature: string;
  mean_abs_shap: number;
  mean_shap: number;
}

export interface ShapRegimeSummary {
  regime_id: number;
  top_features: ShapFeature[];
}

export interface Transition {
  from: number;
  to: number;
  probability: number;
}

export interface WalkForwardWindow {
  window: number;
  train_size: number;
  test_size: number;
  regime_distribution?: number[];
  switch_rate?: number;
  avg_confidence?: number;
  failed: boolean;
}

export interface OOSResult {
  distribution_similarity: number;
  train_distribution: number[];
  test_distribution: number[];
  profile_consistency: Array<{
    regime: number;
    correlation: number | null;
    insufficient_data: boolean;
  }>;
  avg_profile_correlation: number;
  avg_test_confidence: number;
  train_switch_rate: number;
  test_switch_rate: number;
  switch_rate_ratio: number;
}

export interface EvaluationTestResult {
  value: number | null;
  passed: boolean;
  p_value: number | null;
  details?: Record<string, unknown>;
}

export interface EvaluationResults {
  stage1: Record<string, EvaluationTestResult>;
  stage2: Record<string, EvaluationTestResult>;
  stage3: Record<string, EvaluationTestResult>;
  stage4: Record<string, EvaluationTestResult>;
  stage5: Record<string, EvaluationTestResult>;
  grade: string;
}

export interface BenchmarkResult {
  buyAndHold: { cumulative: number[]; totalReturn: number };
  smaCrossover: { cumulative: number[]; totalReturn: number; signals: number[] };
  dates: string[];
}

export interface Diagnostics {
  symbol: string;
  timeframe: string;
  n_regimes: number;
  n_bars_total?: number;
  n_bars_train_val?: number;
  n_bars_test?: number;
  n_features: number;
  feature_names: string[];
  date_range: { start: string; end: string; train_end?: string; test_start?: string };
  quality_score?: number;
  evaluation?: EvaluationResults;
  convergence_summary?: {
    n_iterations: number;
    final_log_likelihood: number;
    final_active_states?: number;
  };
  walk_forward?: {
    n_windows: number;
    window_results: WalkForwardWindow[];
    stability_score: number;
    avg_oos_confidence: number;
    avg_switch_rate: number;
  };
  out_of_sample?: OOSResult;
  regime_stats: RegimeStat[];
  transitions: Transition[];
  transition_matrix: number[][];
  training_config?: {
    gibbs_iter: number; burn_in: number; test_split: number;
    walk_forward_windows: number; alpha: number; gamma: number; kappa: number;
  };
  training_time_sec: number;
  trained_at: string;
  shap_summary?: ShapRegimeSummary[];
}

export interface ConvergencePoint {
  iter: number;
  log_likelihood: number;
  n_active_states?: number;
  delta?: number;
  entropy?: number;
  switch_rate?: number;
  self_transition?: number;
  max_regime_pct?: number;
  avg_dwell?: number;
}

// ─── Regime Color Palette ────────────────────────────────────────────────────

export const REGIME_COLORS = [
  { bg: 'bg-[hsl(var(--data-pos)/0.2)]', text: 'text-[hsl(var(--data-pos))]', border: 'border-[hsl(var(--data-pos)/0.3)]', fill: '#4CAF50' },
  { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30', fill: '#2196F3' },
  { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30', fill: '#FF9800' },
  { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30', fill: '#E91E63' },
  { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30', fill: '#9C27B0' },
  { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30', fill: '#00BCD4' },
  { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30', fill: '#FFEB3B' },
  { bg: 'bg-amber-700/20', text: 'text-amber-600', border: 'border-amber-700/30', fill: '#795548' },
  { bg: 'bg-slate-500/20', text: 'text-slate-400', border: 'border-slate-500/30', fill: '#607D8B' },
  { bg: 'bg-[hsl(var(--data-neg)/0.2)]', text: 'text-[hsl(var(--data-neg))]', border: 'border-[hsl(var(--data-neg)/0.3)]', fill: '#F44336' },
  { bg: 'bg-lime-500/20', text: 'text-lime-400', border: 'border-lime-500/30', fill: '#8BC34A' },
  { bg: 'bg-indigo-500/20', text: 'text-indigo-400', border: 'border-indigo-500/30', fill: '#3F51B5' },
  { bg: 'bg-orange-600/20', text: 'text-orange-500', border: 'border-orange-600/30', fill: '#FF5722' },
  { bg: 'bg-teal-500/20', text: 'text-teal-400', border: 'border-teal-500/30', fill: '#009688' },
  { bg: 'bg-lime-400/20', text: 'text-lime-300', border: 'border-lime-400/30', fill: '#CDDC39' },
  { bg: 'bg-violet-600/20', text: 'text-violet-500', border: 'border-violet-600/30', fill: '#673AB7' },
  { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30', fill: '#FFC107' },
  { bg: 'bg-sky-500/20', text: 'text-sky-400', border: 'border-sky-500/30', fill: '#03A9F4' },
  { bg: 'bg-[hsl(var(--data-neg)/0.2)]', text: 'text-[hsl(var(--data-neg))]', border: 'border-[hsl(var(--data-neg)/0.3)]', fill: '#FF4081' },
  { bg: 'bg-[hsl(var(--data-pos)/0.2)]', text: 'text-[hsl(var(--data-pos))]', border: 'border-[hsl(var(--data-pos)/0.3)]', fill: '#00E676' },
];

export function getRegimeColor(idx: number) {
  return REGIME_COLORS[idx % REGIME_COLORS.length]!;
}

// ─── Verdict System ──────────────────────────────────────────────────────────

export interface Verdict { text: string; color: string }

export const AWAITING: Verdict = { text: 'Awaiting training', color: 'text-muted-foreground' };

/** Threshold-based verdict: returns first match where value >= threshold */
function findVerdict(value: number, thresholds: { min: number; verdict: Verdict }[], fallback: Verdict): Verdict {
  for (const t of thresholds) {
    if (value >= t.min) return t.verdict;
  }
  return fallback;
}

export function getQualityColor(score: number): string {
  if (score >= 80) return 'text-[hsl(var(--data-pos))]';
  if (score >= 60) return 'text-amber-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-[hsl(var(--data-neg))]';
}

export function getQualityLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Weak';
}

const REGIME_VERDICTS: { min: number; verdict: Verdict }[] = [
  { min: 16, verdict: { text: 'Too many — likely splitting noise into fake regimes', color: 'text-[hsl(var(--data-neg))]' } },
  { min: 11, verdict: { text: 'Very granular — make sure each regime is meaningfully different', color: 'text-amber-400' } },
  { min: 7,  verdict: { text: 'Rich detail — each market condition gets its own personality', color: 'text-[hsl(var(--data-pos))]' } },
  { min: 4,  verdict: { text: 'Clean separation — the market has a handful of distinct moods', color: 'text-[hsl(var(--data-pos))]' } },
  { min: 1,  verdict: { text: 'Very few moods — might be oversimplifying the market', color: 'text-amber-400' } },
];
export function getRegimeVerdict(n: number): Verdict {
  if (n <= 0) return AWAITING;
  return findVerdict(n, REGIME_VERDICTS, AWAITING);
}

const STABILITY_VERDICTS: { min: number; verdict: Verdict }[] = [
  { min: 0.85, verdict: { text: 'Rock solid — same regimes found in every time period tested', color: 'text-[hsl(var(--data-pos))]' } },
  { min: 0.70, verdict: { text: 'Mostly stable — regime labels shift slightly in some periods', color: 'text-[hsl(var(--data-pos)/0.8)]' } },
  { min: 0.50, verdict: { text: 'Shaky — the model finds different regimes depending on what data it sees', color: 'text-amber-400' } },
];
export function getStabilityVerdict(score: number): Verdict {
  if (score <= 0) return AWAITING;
  return findVerdict(score, STABILITY_VERDICTS,
    { text: 'Unstable — regime assignments change a lot between time periods, not trustworthy', color: 'text-[hsl(var(--data-neg))]' });
}

const OOS_VERDICTS: { min: number; verdict: Verdict }[] = [
  { min: 0.90, verdict: { text: 'Excellent — the model behaves the same on data it\'s never seen', color: 'text-[hsl(var(--data-pos))]' } },
  { min: 0.75, verdict: { text: 'Good — mostly generalizes, minor drift on unseen data', color: 'text-[hsl(var(--data-pos)/0.8)]' } },
  { min: 0.55, verdict: { text: 'Mediocre — the model learned some patterns that don\'t hold on new data', color: 'text-amber-400' } },
];
export function getOosVerdict(score: number): Verdict {
  if (score <= 0) return AWAITING;
  return findVerdict(score, OOS_VERDICTS,
    { text: 'Poor — likely memorized training patterns, won\'t work in live trading', color: 'text-[hsl(var(--data-neg))]' });
}

const QUALITY_VERDICTS: { min: number; verdict: Verdict }[] = [
  { min: 80, verdict: { text: 'Production-ready — regimes are stable and generalize to unseen data', color: 'text-[hsl(var(--data-pos))]' } },
  { min: 60, verdict: { text: 'Usable for research — solid foundation, more iterations could polish it', color: 'text-amber-400' } },
  { min: 40, verdict: { text: 'Experimental only — some regimes are unstable, don\'t trade on this', color: 'text-orange-400' } },
];
export function getQualityVerdict(score: number): Verdict {
  if (score <= 0) return AWAITING;
  return findVerdict(score, QUALITY_VERDICTS,
    { text: 'Not ready — needs more iterations or different hyperparameters', color: 'text-[hsl(var(--data-neg))]' });
}

export function getLLConvergenceVerdict(points: { log_likelihood: number }[]): Verdict {
  if (points.length < 2) return AWAITING;
  const vals = points.map(p => p.log_likelihood);
  const totalImprove = vals[vals.length - 1]! - vals[0]!;
  const secondHalfImprove = vals[vals.length - 1]! - vals[Math.floor(vals.length / 2)]!;
  const relativeGain = Math.abs(totalImprove) > 0 ? Math.abs(secondHalfImprove / totalImprove) : 0;

  if (relativeGain < 0.05) return { text: 'Fully converged — the model learned everything this data can teach it', color: 'text-[hsl(var(--data-pos))]' };
  if (relativeGain < 0.20) return { text: 'Nearly converged — still improving slightly, a few more iterations might help', color: 'text-[hsl(var(--data-pos)/0.8)]' };
  if (relativeGain < 0.40) return { text: 'Still climbing — the model needs more iterations to finish learning', color: 'text-amber-400' };
  return { text: 'Far from done — increase iterations significantly, the model is still in early learning', color: 'text-[hsl(var(--data-neg))]' };
}

export function getFitVerdict(llPerBar: number): Verdict {
  if (llPerBar === 0) return AWAITING;
  if (llPerBar > -4) return { text: 'Excellent fit — model explains each bar very well', color: 'text-[hsl(var(--data-pos))]' };
  if (llPerBar > -6) return { text: 'Good fit — solid pattern recognition per bar', color: 'text-[hsl(var(--data-pos)/0.8)]' };
  if (llPerBar > -8) return { text: 'Moderate fit — may benefit from more iterations', color: 'text-amber-400' };
  return { text: 'Loose fit — consider tuning hyperparameters', color: 'text-[hsl(var(--data-neg))]' };
}

/** Map llPerBar to 1-5 bars for the signal-strength gauge */
export function getFitLevel(llPerBar: number): number {
  if (llPerBar > -3) return 5;
  if (llPerBar > -4) return 4;
  if (llPerBar > -5) return 3;
  if (llPerBar > -6) return 2;
  return 1;
}

// ─── Chart Constants ─────────────────────────────────────────────────────────

export const CHART_GRID = { strokeDasharray: '3 3', stroke: 'hsla(220, 20%, 30%, 0.15)' } as const;
export const CHART_AXIS = { stroke: 'hsla(220, 10%, 60%, 0.8)', fontSize: 10, tickLine: false } as const;
export const CHART_TOOLTIP = {
  contentStyle: {
    backgroundColor: 'hsla(220, 20%, 10%, 0.95)',
    backdropFilter: 'blur(12px)',
    borderRadius: '6px',
    fontSize: '11px',
    border: '1px solid hsla(220, 15%, 25%, 0.4)',
    boxShadow: '0 8px 32px -8px hsla(220, 30%, 5%, 0.6)',
    color: 'hsla(220, 10%, 90%, 0.9)',
  },
} as const;

// ─── Table Constants ─────────────────────────────────────────────────────────

export const VOL_COLORS: Record<string, string> = {
  extreme: 'bg-[hsl(var(--data-neg)/0.2)] text-[hsl(var(--data-neg))]',
  high: 'bg-orange-500/20 text-orange-400',
  normal: 'bg-slate-500/20 text-slate-400',
  low: 'bg-blue-500/20 text-blue-400',
  quiet: 'bg-indigo-500/20 text-indigo-400',
};

export const CANDLE_LABELS: Record<string, string> = {
  wide_impulse: '\u26A1 Impulse',
  hammer: '\uD83D\uDD28 Hammer',
  shooting_star: '\u2B50 Shooting Star',
  doji: '\u271A Doji',
  wide_range: '\u2194 Wide',
  narrow_range: '\u2502 Narrow',
  normal: 'Normal',
  unknown: '\u2014',
};

// ─── Training Phases ─────────────────────────────────────────────────────────

export type Phase = "A" | "B" | "C" | "D" | "E";

export interface PhaseInfo {
  id: Phase;
  name: string;
  description: string;
  models: string[];
}

export const PHASES: PhaseInfo[] = [
  {
    id: "A",
    name: "Self-Supervised",
    description: "MAE, CPC, TS-TCC pre-training",
    models: ["mae", "cpc", "tstcc"],
  },
  {
    id: "B",
    name: "Unsupervised Structure",
    description: "Slot Attention, SOM+GAT, ICA+DCC, MoE, Statistical",
    models: ["slot_attention", "som", "gat", "ica", "dcc", "moe", "garch", "kde", "gmm"],
  },
  {
    id: "C",
    name: "Semi-Supervised",
    description: "Label generation, Mean Teacher, FixMatch",
    models: ["labels", "mean_teacher", "fixmatch"],
  },
  {
    id: "D",
    name: "Supervised Fine-tuning",
    description: "Direction, MAML, Neural Processes, Calibration, Reasoning",
    models: ["direction", "bayesian_maml", "neural_process", "calibration", "reasoning"],
  },
  {
    id: "E",
    name: "End-to-End Joint",
    description: "Combined pipeline, walk-forward validation",
    models: ["combined", "walkforward"],
  },
];

export type PhaseStatus = "idle" | "running" | "completed" | "failed";

// Curriculum types live in training/curriculum_types.ts. Re-exported here so the
// many `@/training/lib/types` importers resolve the same LearningPath the content
// files are authored against — a local stub previously shadowed it and dropped
// icon/color/difficulty/estimatedHours and the Module[] shape.
export type { Difficulty, Module, LearningPath } from "@/training/curriculum_types";

// ── Analytics snapshot shapes ───────────────────────────────────────────────
// The analytics panels read a trainer-emitted metric blob that is NOT the same
// shape as `Diagnostics` above — it arrives either as a `model_state` SSE
// snapshot or as the diagnostics JSON on disk. These types replace the
// `Record<string, any>` those panels previously used.

/**
 * One value as a trainer emits it over the stdout/SSE metric protocol.
 * Numeric for every metric the panels chart, but the protocol also carries
 * string labels and boolean flags, so the bag cannot be `Record<string, number>`.
 */
export type MetricValue = number | string | boolean | null;

/** A metric bag (`best_metrics` / `metrics`) emitted by a training run. */
export interface MetricsBag {
  train_loss?: number;
  val_loss?: number;
  forward_auc?: number;
  swing_auc?: number;
  profit_factor?: number;
  epoch_time_sec?: number;
  /** Trainers are free to emit additional metrics; they are declaration-driven. */
  [metric: string]: MetricValue | undefined;
}

/**
 * Read one metric out of a bag as a number.
 *
 * The index signature above is deliberately wide (a declaration-driven bag can
 * carry strings and flags), so every arithmetic/`toFixed` call site goes through
 * this accessor instead of asserting. A metric that is absent, `null`, boolean,
 * or a non-numeric string reads back as `undefined` — callers decide whether to
 * substitute a default or skip rendering the cell.
 *
 * A numeric string is parsed rather than rejected: that is what the previous
 * untyped arithmetic (`value * 100`) did by implicit coercion.
 */
export function metricNumber(bag: MetricsBag | undefined, key: string): number | undefined {
  const raw = bag?.[key];
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

// ─── HPO optimizer form-config shapes ───────────────────────────────────────
// `OptimizerConfigFields.tsx` forms edit the optimizer config as the raw
// wire/storage shape (`Record<string, unknown>` — seeded from
// `DEFAULT_OPTIMIZER_CONFIGS` in `@shared/hpoTypes` and then user-edited
// field-by-field), not the strict discriminated union `OptimizerConfig` from
// that file. These mirror `OptunaConfig`/`BayesianConfig`/`PSOConfig`/
// `MonteCarloConfig`/`EvolutionaryConfig`/`BOHBConfig` field-for-field, with
// every field the UI treats as "may not be set yet" made optional, plus
// runtime-checked `read*FormConfig` accessors so every property read narrows
// via a type guard instead of asserting.

/** True for a non-null, non-array object — the shape a nested config bag takes. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow an unknown value to a plain object, defaulting to `{}` otherwise. */
export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** Narrow an unknown value to one of a fixed set of string literals. */
export function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** Narrow an unknown value to a finite number, or `undefined` if it isn't one. */
export function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export const OPTUNA_SAMPLER_TYPES = ["tpe", "cma_es", "random", "grid"] as const;
export const OPTUNA_PRUNER_TYPES = ["median", "successive_halving", "hyperband", "none"] as const;
export const OPTIMIZER_DIRECTIONS = ["minimize", "maximize"] as const;
export const BAYESIAN_METHODS = ["gp", "forest", "gbrt"] as const;
export const BAYESIAN_ACQUISITION_FUNCTIONS = ["ei", "ucb", "poi"] as const;
export const PSO_TOPOLOGIES = ["global", "local"] as const;
export const MONTE_CARLO_METHODS = ["random", "lhs", "sobol"] as const;
export const EVOLUTIONARY_ALGORITHMS = ["cma", "de", "two_points_de", "one_plus_one", "pso_nevergrad"] as const;

export type OptunaSamplerType = (typeof OPTUNA_SAMPLER_TYPES)[number];
export type OptunaPrunerType = (typeof OPTUNA_PRUNER_TYPES)[number];
export type OptimizerDirection = (typeof OPTIMIZER_DIRECTIONS)[number];
export type BayesianMethod = (typeof BAYESIAN_METHODS)[number];
export type BayesianAcquisitionFunction = (typeof BAYESIAN_ACQUISITION_FUNCTIONS)[number];
export type PSOTopology = (typeof PSO_TOPOLOGIES)[number];
export type MonteCarloMethod = (typeof MONTE_CARLO_METHODS)[number];
export type EvolutionaryAlgorithm = (typeof EVOLUTIONARY_ALGORITHMS)[number];

export interface OptunaSamplerFormConfig {
  type: OptunaSamplerType;
  nStartupTrials?: number;
}

export interface OptunaPrunerFormConfig {
  type: OptunaPrunerType;
}

/** Mirrors `OptunaConfig` (`@shared/hpoTypes`) as read off a partially-edited form. */
export interface OptunaFormConfig {
  sampler: OptunaSamplerFormConfig;
  pruner: OptunaPrunerFormConfig;
  direction: OptimizerDirection;
  nTrials?: number;
  timeout?: number;
}

/** Mirrors `BayesianConfig` (`@shared/hpoTypes`) as read off a partially-edited form. */
export interface BayesianFormConfig {
  method: BayesianMethod;
  acquisitionFunction: BayesianAcquisitionFunction;
  nCalls?: number;
  nInitialPoints?: number;
  xi?: number;
}

/** Mirrors `PSOConfig` (`@shared/hpoTypes`) as read off a partially-edited form. */
export interface PSOFormConfig {
  nParticles?: number;
  nIterations?: number;
  c1?: number;
  c2?: number;
  w?: number;
  topology: PSOTopology;
}

/** Mirrors `MonteCarloConfig` (`@shared/hpoTypes`) as read off a partially-edited form. */
export interface MonteCarloFormConfig {
  method: MonteCarloMethod;
  nSamples?: number;
}

/** Mirrors `EvolutionaryConfig` (`@shared/hpoTypes`) as read off a partially-edited form. */
export interface EvolutionaryFormConfig {
  algorithm: EvolutionaryAlgorithm;
  budget?: number;
  populationSize?: number;
}

/** Mirrors `BOHBConfig` (`@shared/hpoTypes`) as read off a partially-edited form. */
export interface BOHBFormConfig {
  nTrials?: number;
  minResource?: number;
  maxResource?: number;
  reductionFactor?: number;
}

/** Read an Optuna form config out of the raw wire-shaped `config` bag, with the same defaults the form previously inlined (`?? "tpe"` / `?? "median"` / `?? "minimize"`). */
export function readOptunaFormConfig(config: Record<string, unknown>): OptunaFormConfig {
  const samplerRaw = asRecord(config.sampler);
  const prunerRaw = asRecord(config.pruner);
  return {
    sampler: {
      type: isOneOf(samplerRaw.type, OPTUNA_SAMPLER_TYPES) ? samplerRaw.type : "tpe",
      nStartupTrials: asOptionalNumber(samplerRaw.nStartupTrials),
    },
    pruner: {
      type: isOneOf(prunerRaw.type, OPTUNA_PRUNER_TYPES) ? prunerRaw.type : "median",
    },
    direction: isOneOf(config.direction, OPTIMIZER_DIRECTIONS) ? config.direction : "minimize",
    nTrials: asOptionalNumber(config.nTrials),
    timeout: asOptionalNumber(config.timeout),
  };
}

/** Read a Bayesian form config out of the raw wire-shaped `config` bag (defaults: `?? "gp"` / `?? "ei"`). */
export function readBayesianFormConfig(config: Record<string, unknown>): BayesianFormConfig {
  return {
    method: isOneOf(config.method, BAYESIAN_METHODS) ? config.method : "gp",
    acquisitionFunction: isOneOf(config.acquisitionFunction, BAYESIAN_ACQUISITION_FUNCTIONS)
      ? config.acquisitionFunction
      : "ei",
    nCalls: asOptionalNumber(config.nCalls),
    nInitialPoints: asOptionalNumber(config.nInitialPoints),
    xi: asOptionalNumber(config.xi),
  };
}

/** Read a PSO form config out of the raw wire-shaped `config` bag (default: `?? "global"`). */
export function readPSOFormConfig(config: Record<string, unknown>): PSOFormConfig {
  return {
    nParticles: asOptionalNumber(config.nParticles),
    nIterations: asOptionalNumber(config.nIterations),
    c1: asOptionalNumber(config.c1),
    c2: asOptionalNumber(config.c2),
    w: asOptionalNumber(config.w),
    topology: isOneOf(config.topology, PSO_TOPOLOGIES) ? config.topology : "global",
  };
}

/** Read a Monte Carlo form config out of the raw wire-shaped `config` bag (default: `?? "lhs"`). */
export function readMonteCarloFormConfig(config: Record<string, unknown>): MonteCarloFormConfig {
  return {
    method: isOneOf(config.method, MONTE_CARLO_METHODS) ? config.method : "lhs",
    nSamples: asOptionalNumber(config.nSamples),
  };
}

/** Read an Evolutionary form config out of the raw wire-shaped `config` bag (default: `?? "cma"`). */
export function readEvolutionaryFormConfig(config: Record<string, unknown>): EvolutionaryFormConfig {
  return {
    algorithm: isOneOf(config.algorithm, EVOLUTIONARY_ALGORITHMS) ? config.algorithm : "cma",
    budget: asOptionalNumber(config.budget),
    populationSize: asOptionalNumber(config.populationSize),
  };
}

/** Read a BOHB form config out of the raw wire-shaped `config` bag. */
export function readBOHBFormConfig(config: Record<string, unknown>): BOHBFormConfig {
  return {
    nTrials: asOptionalNumber(config.nTrials),
    minResource: asOptionalNumber(config.minResource),
    maxResource: asOptionalNumber(config.maxResource),
    reductionFactor: asOptionalNumber(config.reductionFactor),
  };
}

/** One promotion/quality gate evaluated against a metric. */
export interface QualityGate {
  metric: string;
  value: number;
  status: "pass" | "warn" | "fail";
  recommendation: string | null;
}

/** The snapshot blob the analytics panels consume. */
export interface MetricsSnapshot {
  best_metrics?: MetricsBag;
  metrics?: MetricsBag;
  quality_gates?: QualityGate[];
  training?: { total_time_sec?: number; [key: string]: unknown };
  [key: string]: unknown;
}
