/**
 * HPO Types — Hyperparameter Optimization contract between server and client.
 *
 * These types define the full lifecycle of an HPO session:
 * what the client sends to launch an optimization run, what SSE events
 * stream back during search, and what final results look like.
 *
 * Optimizer-specific configs are modelled as a discriminated union
 * on the `type` field so the server can narrow to the correct backend.
 *
 * Zod schemas at the bottom mirror the interfaces for runtime
 * request validation on the NestJS side.
 */

import { z } from "zod";

// ─── Optimizer Type ──────────────────────────────────────────────────────────

/** Supported HPO backend engines. */
export type OptimizerType =
  | 'optuna'
  | 'bayesian'
  | 'pso'
  | 'montecarlo'
  | 'evolutionary'
  | 'bohb';

// ─── Search Space Definitions ────────────────────────────────────────────────

/** Primitive dimension kinds for a single hyperparameter. */
export type SearchDimensionType = 'int' | 'float' | 'categorical' | 'bool';

/** Sampling distribution for numeric dimensions. */
export type DistributionType = 'uniform' | 'loguniform' | 'normal' | 'choice';

/** One axis of the search space — describes how a single hyperparameter is sampled. */
export interface SearchDimension {
  type: SearchDimensionType;
  low?: number;                               // lower bound (int / float)
  high?: number;                              // upper bound (int / float)
  step?: number;                              // quantisation step
  logScale?: boolean;                         // sample in log-space
  choices?: (string | number | boolean)[];    // valid values (categorical)
  distribution?: DistributionType;
  default?: number | string | boolean;        // starting / fallback value
}

/** Map of parameter name → search dimension. */
export type SearchSpaceDef = Record<string, SearchDimension>;

// ─── Per-Optimizer Configuration Types ───────────────────────────────────────

// ── Optuna

/** Optuna sampler selection and tuning knobs. */
export interface OptunaSamplerConfig {
  type: 'tpe' | 'cma_es' | 'random' | 'grid';
  seed?: number;
  nStartupTrials?: number;
  nEiCandidates?: number;
}

/** Optuna early-stopping pruner configuration. */
export interface OptunaPrunerConfig {
  type: 'median' | 'successive_halving' | 'hyperband' | 'none';
  nStartupTrials?: number;
  nWarmupSteps?: number;
  intervalSteps?: number;
  minResource?: number;
  maxResource?: number;
  reductionFactor?: number;
}

/** Full Optuna optimizer configuration. */
export interface OptunaConfig {
  sampler?: OptunaSamplerConfig;
  pruner?: OptunaPrunerConfig;
  direction?: 'minimize' | 'maximize';
  nTrials: number;
  timeout?: number;               // seconds
  nJobs?: number;                  // parallel trial workers
}

// ── Bayesian (scikit-optimize style)

/** Bayesian optimisation via Gaussian Processes, Random Forest, or GBRT. */
export interface BayesianConfig {
  method: 'gp' | 'forest' | 'gbrt';
  acquisitionFunction: 'ei' | 'ucb' | 'poi';
  nCalls: number;
  nInitialPoints?: number;
  kappa?: number;                  // UCB exploration weight
  xi?: number;                     // EI / POI exploration trade-off
  seed?: number;
}

// ── PSO (Particle Swarm Optimisation)

/** Particle Swarm Optimisation parameters. */
export interface PSOConfig {
  nParticles: number;
  nIterations: number;
  c1: number;                      // cognitive parameter
  c2: number;                      // social parameter
  w: number;                       // inertia weight
  wDecay?: boolean;                // linearly decrease inertia
  wMin?: number;                   // minimum inertia (if decay)
  velocityClamp?: [number, number];
  topology: 'global' | 'local';
  seed?: number;
}

// ── Monte Carlo

/** Monte Carlo random / quasi-random sampling configuration. */
export interface MonteCarloConfig {
  nSamples: number;
  method: 'random' | 'lhs' | 'sobol';  // Latin Hypercube, Sobol sequence
  seed?: number;
}

// ── Evolutionary (Nevergrad-style)

/** Evolutionary / derivative-free optimisation configuration. */
export interface EvolutionaryConfig {
  algorithm: 'cma' | 'de' | 'two_points_de' | 'one_plus_one' | 'pso_nevergrad';
  populationSize?: number;
  budget: number;                  // total number of evaluations
  seed?: number;
}

// ── BOHB (Bayesian Optimisation + Hyperband)

/** BOHB early-stopping aware Bayesian optimisation. */
export interface BOHBConfig {
  nTrials: number;
  minResource: number;
  maxResource: number;
  reductionFactor: number;
  seed?: number;
}

// ── Discriminated union over all optimizer backends

/** Tagged union — the `type` field selects the optimizer and narrows `config`. */
export type OptimizerConfig =
  | { type: 'optuna'; config: OptunaConfig }
  | { type: 'bayesian'; config: BayesianConfig }
  | { type: 'pso'; config: PSOConfig }
  | { type: 'montecarlo'; config: MonteCarloConfig }
  | { type: 'evolutionary'; config: EvolutionaryConfig }
  | { type: 'bohb'; config: BOHBConfig };

// ─── HPO Request (client → server) ──────────────────────────────────────────

/** Payload the client sends to kick off a hyperparameter optimisation run. */
export interface HPORequest {
  modelType: string;               // key in models.json
  symbol: string;                  // e.g. "ES", "NQ"
  timeframe?: string;
  dateRange?: {
    start: string;                 // ISO date string
    end: string;
  };
  maxBars?: number;                // 0 = all available data
  featureCategories?: string[];

  // HPO-specific
  objectiveMetric: string;         // e.g. 'log_likelihood', 'accuracy', 'silhouette_score'
  searchSpace: SearchSpaceDef;     // which params to optimise and their ranges
  optimizer: OptimizerConfig;      // which optimizer and its config

  // Optional overrides
  fixedHyperparameters?: Record<string, number | string | boolean>;  // params NOT being optimised
}

// ─── Trial & Session Result Types ────────────────────────────────────────────

/** Outcome of a single optimisation trial. */
export interface TrialResult {
  trialId: number;
  params: Record<string, number | string | boolean>;
  score: number;
  metrics: Record<string, number>;
  durationSec: number;
  pruned: boolean;
  error?: string;
  startedAt: number;               // epoch ms
  completedAt: number;             // epoch ms
}

/** Lifecycle state of an HPO session. */
export type HPOSessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped';

/** Full server-side state for a running or finished HPO session. */
export interface HPOSession {
  sessionId: string;
  modelType: string;
  symbol: string;
  timeframe: string;
  status: HPOSessionStatus;
  optimizerType: OptimizerType;
  objectiveMetric: string;
  searchSpace: SearchSpaceDef;
  optimizerConfig: Record<string, unknown>;

  // Progress
  totalTrials: number;
  completedTrials: number;
  prunedTrials: number;

  // Best so far
  bestTrialId: number | null;
  bestScore: number | null;
  bestParams: Record<string, number | string | boolean> | null;

  // Timing
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  elapsedSec: number;

  // Results
  trials: TrialResult[];
}

/** Lightweight summary for listing sessions without full trial data. */
export interface HPOSessionSummary {
  sessionId: string;
  modelType: string;
  symbol: string;
  timeframe: string;
  status: HPOSessionStatus;
  optimizerType: OptimizerType;
  completedTrials: number;
  totalTrials: number;
  bestScore: number | null;
  startedAt: number;
  elapsedSec: number;
}

// ─── SSE Event Types for HPO ─────────────────────────────────────────────────

/** Fired when a new trial begins evaluation. */
export interface HPOTrialStartEvent {
  type: 'hpo-trial-start';
  data: {
    trialId: number;
    params: Record<string, number | string | boolean>;
    totalTrials: number;
  };
  ts: number;
}

/** Fired when a trial finishes successfully. */
export interface HPOTrialDoneEvent {
  type: 'hpo-trial-done';
  data: TrialResult;
  ts: number;
}

/** Fired when a trial is pruned early by the optimizer. */
export interface HPOTrialPrunedEvent {
  type: 'hpo-trial-pruned';
  data: {
    trialId: number;
    params: Record<string, number | string | boolean>;
    score: number;
    prunedAtStep: number;
  };
  ts: number;
}

/** Fired when a new best score is found. */
export interface HPOBestUpdateEvent {
  type: 'hpo-best-update';
  data: {
    trialId: number;
    bestScore: number;
    bestParams: Record<string, number | string | boolean>;
    improvementPct: number;
  };
  ts: number;
}

/** Fired when the full HPO session finishes. */
export interface HPOCompleteEvent {
  type: 'hpo-complete';
  data: {
    sessionId: string;
    totalTrials: number;
    completedTrials: number;
    prunedTrials: number;
    bestTrialId: number;
    bestScore: number;
    bestParams: Record<string, number | string | boolean>;
    elapsedSec: number;
  };
  ts: number;
}

/** Union of all HPO SSE event types. */
export type HPOEvent =
  | HPOTrialStartEvent
  | HPOTrialDoneEvent
  | HPOTrialPrunedEvent
  | HPOBestUpdateEvent
  | HPOCompleteEvent;

// ─── Zod Validation Schemas ─────────────────────────────────────────────────

const hyperparamValue = z.union([z.number(), z.string(), z.boolean()]);

// ── Search space

export const searchDimensionSchema = z.object({
  type: z.enum(['int', 'float', 'categorical', 'bool']),
  low: z.number().optional(),
  high: z.number().optional(),
  step: z.number().optional(),
  logScale: z.boolean().optional(),
  choices: z.array(hyperparamValue).optional(),
  distribution: z.enum(['uniform', 'loguniform', 'normal', 'choice']).optional(),
  default: hyperparamValue.optional(),
});

export const searchSpaceSchema = z.record(z.string(), searchDimensionSchema);

// ── Optuna

export const optunaSamplerSchema = z.object({
  type: z.enum(['tpe', 'cma_es', 'random', 'grid']),
  seed: z.number().int().optional(),
  nStartupTrials: z.number().int().nonnegative().optional(),
  nEiCandidates: z.number().int().positive().optional(),
});

export const optunaPrunerSchema = z.object({
  type: z.enum(['median', 'successive_halving', 'hyperband', 'none']),
  nStartupTrials: z.number().int().nonnegative().optional(),
  nWarmupSteps: z.number().int().nonnegative().optional(),
  intervalSteps: z.number().int().positive().optional(),
  minResource: z.number().positive().optional(),
  maxResource: z.number().positive().optional(),
  reductionFactor: z.number().positive().optional(),
});

export const optunaConfigSchema = z.object({
  sampler: optunaSamplerSchema.optional(),
  pruner: optunaPrunerSchema.optional(),
  direction: z.enum(['minimize', 'maximize']).optional(),
  nTrials: z.number().int().positive(),
  timeout: z.number().positive().optional(),
  nJobs: z.number().int().positive().optional(),
});

// ── Bayesian

export const bayesianConfigSchema = z.object({
  method: z.enum(['gp', 'forest', 'gbrt']),
  acquisitionFunction: z.enum(['ei', 'ucb', 'poi']),
  nCalls: z.number().int().positive(),
  nInitialPoints: z.number().int().positive().optional(),
  kappa: z.number().optional(),
  xi: z.number().optional(),
  seed: z.number().int().optional(),
});

// ── PSO

export const psoConfigSchema = z.object({
  nParticles: z.number().int().positive(),
  nIterations: z.number().int().positive(),
  c1: z.number(),
  c2: z.number(),
  w: z.number(),
  wDecay: z.boolean().optional(),
  wMin: z.number().optional(),
  velocityClamp: z.tuple([z.number(), z.number()]).optional(),
  topology: z.enum(['global', 'local']),
  seed: z.number().int().optional(),
});

// ── Monte Carlo

export const monteCarloConfigSchema = z.object({
  nSamples: z.number().int().positive(),
  method: z.enum(['random', 'lhs', 'sobol']),
  seed: z.number().int().optional(),
});

// ── Evolutionary

export const evolutionaryConfigSchema = z.object({
  algorithm: z.enum(['cma', 'de', 'two_points_de', 'one_plus_one', 'pso_nevergrad']),
  populationSize: z.number().int().positive().optional(),
  budget: z.number().int().positive(),
  seed: z.number().int().optional(),
});

// ── BOHB

export const bohbConfigSchema = z.object({
  nTrials: z.number().int().positive(),
  minResource: z.number().positive(),
  maxResource: z.number().positive(),
  reductionFactor: z.number().positive(),
  seed: z.number().int().optional(),
});

// ── Discriminated union across all optimizers

export const optimizerConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('optuna'), config: optunaConfigSchema }),
  z.object({ type: z.literal('bayesian'), config: bayesianConfigSchema }),
  z.object({ type: z.literal('pso'), config: psoConfigSchema }),
  z.object({ type: z.literal('montecarlo'), config: monteCarloConfigSchema }),
  z.object({ type: z.literal('evolutionary'), config: evolutionaryConfigSchema }),
  z.object({ type: z.literal('bohb'), config: bohbConfigSchema }),
]);

// ── Full HPO request schema

export const hpoRequestSchema = z.object({
  modelType: z.string().min(1),
  symbol: z.string().min(1),
  timeframe: z.string().optional(),
  dateRange: z.object({ start: z.string(), end: z.string() }).optional(),
  maxBars: z.number().int().nonnegative().optional(),
  featureCategories: z.array(z.string()).optional(),
  objectiveMetric: z.string().min(1),
  searchSpace: searchSpaceSchema,
  optimizer: optimizerConfigSchema,
  fixedHyperparameters: z.record(z.string(), hyperparamValue).optional(),
});

/** Validated HPO request type inferred from the Zod schema. */
export type ValidatedHPORequest = z.infer<typeof hpoRequestSchema>;

// ─── Default Optimizer Configs ───────────────────────────────────────────────

/** Sensible starting configs for each optimizer backend. */
export const DEFAULT_OPTIMIZER_CONFIGS: Record<OptimizerType, Record<string, unknown>> = {
  optuna: {
    sampler: { type: 'tpe' },
    pruner: { type: 'median' },
    direction: 'minimize',
    nTrials: 50,
  },
  bayesian: {
    method: 'gp',
    acquisitionFunction: 'ei',
    nCalls: 50,
    nInitialPoints: 10,
  },
  pso: {
    nParticles: 30,
    nIterations: 100,
    c1: 0.5,
    c2: 1.5,
    w: 0.9,
    topology: 'global',
  },
  montecarlo: {
    nSamples: 100,
    method: 'lhs',
  },
  evolutionary: {
    algorithm: 'cma',
    budget: 100,
  },
  bohb: {
    nTrials: 50,
    minResource: 1,
    maxResource: 100,
    reductionFactor: 3,
  },
};
