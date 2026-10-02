/**
 * "Inside the model": how one fitted fold model turns one bar's inputs into its
 * output. The wire contract between the Python explainer
 * (`packages/ml-engine/src/cycle/explain_main.py --serve`, one warm CPU-only process per
 * server), the server pool and routes (`apps/api/training/cycleExplainer.ts`,
 * `cycleExplain.router.ts`) and the client (`apps/web/src/cycle/inside/`).
 *
 * Routes (all GET, under /api/training/cycle/:modelId):
 *   /explain                                   manifest — read by Node from disk
 *   /explain/structure?fold=&role=             what the fitted model is (per fold, role)
 *   /explain/tree?fold=&role=&tree=            one whole tree (tree models)
 *   /explain/bar?timestamp=&role=[&fold=]      one bar, input to output (fold defaults to the fold that tested it)
 *
 * Every explanation is computed by the model's own library (xgboost pred_leaf,
 * lightgbm pred_leaf, sklearn apply / decision_path, catboost
 * calc_leaf_indexes, torch forward hooks, …) on the model the engine saved;
 * nothing re-implements a library's split rule. Parity gates
 * (`scripts/verify_cycle_explain.py`, `tests/test_cycle_explain.py`):
 *   G1 `engineReload` (the reloaded adapter's own prediction) equals the value
 *      the engine streamed (`streamed`): 1e-12 for CPU libraries, 1e-6 torch on
 *      CPU, 1e-4 torch trained on the GPU.
 *   G2 the link applied to (base + Σ contributions) equals the output: 1e-6.
 *   G3 every recorded tree path, re-evaluated with the library's own rule,
 *      reaches the recorded leaf (exact).
 *   G4 the neural head applied to the recorded last activation reproduces the
 *      logit: 1e-5.
 *
 * Units: `inputs.values` are the model's inputs (causal rolling z-scores, then
 * the adapter's own scaler where it has one — `inputs.scaled` says which);
 * `inputs.raw` are the same features before the z-score. Direction outputs are
 * probabilities of "up"; price outputs are in target units (the h-bar move
 * divided by the trailing volatility `output.scale`, points per unit) and
 * `output.movePoints = targetUnits × scale`.
 *
 * Arrays are columnar and row-major; a missing number is null, never NaN.
 * Design: `docs/plans/2026-09-26-cycle-catalog-inside-view.md`.
 */
import { z } from "zod";

import { cycleDirectionModeSchema, cycleExplainKindSchema } from "./schema";

const epochSeconds = z.number().int().nonnegative();
const nullableNumber = z.number().nullable();

export const cycleExplainRoleSchema = z.enum(["direction", "price"]);
export type CycleExplainRole = z.infer<typeof cycleExplainRoleSchema>;

/** How the raw model output becomes the reported output. */
export const cycleExplainLinkSchema = z.enum([
  "logistic", // P(up) = 1 / (1 + e^-raw) — xgboost, lightgbm, catboost, logistic / SGD, neural direction heads
  "identity", // price models: the raw output is already in target units
  "mean_probability", // random forest / extra trees / single tree: P(up) = mean of per-tree P(up)
  "probit", // P(up) = Φ(raw)
  "logistic_curve", // P(up) = 1 / (1 + e^-(slope·raw + intercept)), fitted on the validation bars (SVM, from_price models)
  "posterior", // naive Bayes: raw = log posterior odds (up minus down); P(up) = 1 / (1 + e^-raw)
  "vote", // k-nearest neighbors: raw = the weighted share of the model's k neighbors that went up (= P(up)); price: the weighted mean target
  "calibration_map", // calibrated classifier: the base model's score through the fitted calibration map
]);
export type CycleExplainLink = z.infer<typeof cycleExplainLinkSchema>;

export const cycleExplainFoldStatusSchema = z.enum(["ready", "training", "missing", "none"]);

// ─── manifest ───────────────────────────────────────────────────────────────

/** `explain/manifest.json`, written by the engine at plan time, plus fold readiness read from disk by Node. */
export const cycleExplainManifestSchema = z.object({
  modelId: z.string(),
  /** False for runs made before "Inside the model" existed (no explain/ folder) or runs whose inputs were not written; `reason` says which. */
  available: z.boolean(),
  reason: z.string().nullable(),
  modelKey: z.string().nullable(),
  displayName: z.string().nullable(),
  explainKind: cycleExplainKindSchema.nullable(),
  directionMode: cycleDirectionModeSchema.nullable(),
  hasPriceModel: z.boolean(),
  featureNames: z.array(z.string()),
  /** Full-word names for display, one per feature (from `features.json` `displayName`). */
  featureDisplayNames: z.array(z.string()),
  /** Bars one prediction reads (1 for tabular models). */
  sequenceLength: z.number().int().positive(),
  labelHorizonBars: z.number().int().positive(),
  folds: z.array(
    z.object({
      foldIndex: z.number().int().nonnegative(),
      testStart: epochSeconds,
      testEnd: epochSeconds,
      /** "ready": the model file exists; "training": the fold is planned and its model not yet written; "missing": the run ended without it; "none": no price model. */
      direction: cycleExplainFoldStatusSchema,
      price: cycleExplainFoldStatusSchema,
    }),
  ),
});
export type CycleExplainManifest = z.infer<typeof cycleExplainManifestSchema>;

// ─── structure ──────────────────────────────────────────────────────────────

const featureUsageSchema = z.object({
  featureIndex: z.number().int().nonnegative(),
  splitCount: z.number().int().nonnegative(),
  /** Total gain (boosting) or total impurity decrease (forests); null when the library does not record it. */
  totalGain: nullableNumber,
});

export const cycleExplainStructureSchema = z.object({
  modelId: z.string(),
  foldIndex: z.number().int().nonnegative(),
  role: cycleExplainRoleSchema,
  explainKind: cycleExplainKindSchema,
  link: cycleExplainLinkSchema,
  /** The constant the contributions start from: base score (boosting, log-odds), intercept (linear), log prior ratio (naive Bayes); null when none. */
  baseValue: nullableNumber,
  /** Validation logistic curve for "logistic_curve" links. */
  logisticCurve: z.object({ slope: z.number(), intercept: z.number() }).nullable(),
  trees: z
    .object({
      treeCount: z.number().int().nonnegative(),
      /** Trees that count toward predictions (xgboost / lightgbm / GBM / catboost stop at the best round). */
      usedTreeCount: z.number().int().nonnegative(),
      aggregation: z.enum(["sum", "mean"]),
      learningRate: nullableNumber,
      maxDepth: z.number().int().nonnegative(),
      /** depthHistogram[d] = trees whose deepest leaf is at depth d. */
      depthHistogram: z.array(z.number().int().nonnegative()),
      leafCount: z.number().int().nonnegative(),
      featureUsage: z.array(featureUsageSchema),
      /** CatBoost symmetric trees: every level asks one question for the whole tree. */
      oblivious: z.boolean(),
      /** The comparison each split makes, for the path text ("<" xgboost, "<=" lightgbm / sklearn, ">" catboost borders). */
      splitRule: z.enum(["less_than", "less_or_equal", "greater_than"]),
    })
    .nullable(),
  linear: z
    .object({
      intercept: z.number(),
      /** One weight per model input, in the units `inputs.values` carries. */
      coefficients: z.array(z.number()),
    })
    .nullable(),
  neighbors: z.object({ neighborCount: z.number().int().positive(), weighting: z.enum(["uniform", "distance"]), trainingBarCount: z.number().int().nonnegative() }).nullable(),
  naiveBayes: z
    .object({
      /** Log prior of [down, up]. */
      logPriors: z.tuple([z.number(), z.number()]),
      /** Per feature: the fitted mean and variance of [down, up]. */
      means: z.array(z.tuple([z.number(), z.number()])),
      variances: z.array(z.tuple([z.number(), z.number()])),
    })
    .nullable(),
  supportVectors: z
    .object({ supportVectorCount: z.number().int().nonnegative(), kernel: z.string(), gamma: nullableNumber, trainingBarCount: z.number().int().nonnegative() })
    .nullable(),
  calibration: z
    .object({
      method: z.enum(["sigmoid", "isotonic"]),
      baseModel: z.string(),
      /** The calibration map sampled over the base score range, for drawing. */
      curve: z.object({ baseScore: z.array(z.number()), probabilityUp: z.array(z.number()) }),
    })
    .nullable(),
  stacking: z
    .object({
      baseModels: z.array(z.object({ name: z.string(), kind: z.string() })),
      metaIntercept: z.number(),
      /** One weight per base model output. */
      metaCoefficients: z.array(z.number()),
    })
    .nullable(),
  neural: z
    .object({
      network: z.string(),
      layers: z.array(z.object({ name: z.string(), kind: z.string(), outputShape: z.array(z.number().int().nonnegative()) })),
      sequenceLength: z.number().int().positive(),
      hasAttention: z.boolean(),
    })
    .nullable(),
});
export type CycleExplainStructure = z.infer<typeof cycleExplainStructureSchema>;

// ─── one tree ───────────────────────────────────────────────────────────────

/** Node columns, one row per node, index = node position; children point at positions (-1 = none). */
export const cycleExplainTreeSchema = z.object({
  modelId: z.string(),
  foldIndex: z.number().int().nonnegative(),
  role: cycleExplainRoleSchema,
  treeIndex: z.number().int().nonnegative(),
  splitRule: z.enum(["less_than", "less_or_equal", "greater_than"]),
  nodes: z.object({
    left: z.array(z.number().int()),
    right: z.array(z.number().int()),
    /** Feature index split on; -1 at a leaf. */
    feature: z.array(z.number().int()),
    threshold: z.array(nullableNumber),
    /** Where a missing value goes; null when the library has no missing-value rule. */
    missingGoesLeft: z.array(z.boolean().nullable()),
    /** Leaf value (boosting: log-odds or target units; forests: P(up) or the mean target) or, at an internal node, the value a leaf there would have. */
    value: z.array(z.number()),
    /** Training weight / bar count reaching the node; null when not recorded. */
    cover: z.array(nullableNumber),
    depth: z.array(z.number().int().nonnegative()),
  }),
  /**
   * CatBoost: the levels (one question each, in the model's own split order) and the 2^depth leaf values,
   * instead of `nodes` being meaningful as a binary tree. A bar's leaf = Σ_d bit_d · 2^d, where bit_d is 1 when
   * its value at obliviousLevels[d].feature is above that level's threshold (the border). In the bar's
   * `trees` block for such a tree, pathWentLeft[d] is that bit (true = above the border) and leafNode is the leaf.
   */
  obliviousLevels: z.array(z.object({ feature: z.number().int().nonnegative(), threshold: z.number() })).nullable(),
  obliviousLeafValues: z.array(z.number()).nullable(),
});
export type CycleExplainTree = z.infer<typeof cycleExplainTreeSchema>;

// ─── one bar ────────────────────────────────────────────────────────────────

export const cycleExplainBarSchema = z.object({
  modelId: z.string(),
  timestamp: epochSeconds,
  foldIndex: z.number().int().nonnegative(),
  role: cycleExplainRoleSchema,
  explainKind: cycleExplainKindSchema,
  link: cycleExplainLinkSchema,
  inputs: z.object({
    /** The model's inputs for this bar, one per feature. */
    values: z.array(nullableNumber),
    /** True when `values` went through the adapter's own scaler (fitted on training bars only). */
    scaled: z.boolean(),
    /** The same features before the rolling z-score, for reading. */
    raw: z.array(nullableNumber),
    /** Where each input sits among this fold's training bars, 0..1. */
    trainingPercentile: z.array(nullableNumber),
    /** Sequence models: the window the model read, oldest first — timestamps and values[time][feature]. */
    window: z.object({ timestamps: z.array(epochSeconds), values: z.array(z.array(nullableNumber)) }).nullable(),
  }),
  output: z.object({
    /** Before the link: log-odds, decision value, target units, … */
    raw: z.number(),
    probabilityUp: nullableNumber,
    /** Price role: predicted move in target units; scale = points per target unit at this bar. */
    targetUnits: nullableNumber,
    scale: nullableNumber,
    movePoints: nullableNumber,
    close: z.number(),
    predictedClose: nullableNumber,
  }),
  /** G1: the reloaded adapter's own prediction for this bar (probability or target units). */
  engineReload: z.number(),
  /** The value the engine streamed for this bar during the run (predictions.parquet or the snapshot); null when not available. */
  streamed: nullableNumber,
  trees: z
    .object({
      /** Forests ("mean" aggregation) have no base: 0. */
      baseValue: z.number(),
      /** Per used tree: the value of the leaf this bar reached (forests: that tree's P(up) or mean target). */
      leafValues: z.array(z.number()),
      /** Per used tree: the base plus every leaf so far (forests: the running mean). The last equals `output.raw`. */
      runningTotal: z.array(z.number()),
      leafNode: z.array(z.number().int().nonnegative()),
      /** Paths, flattened: tree t's steps are pathOffsets[t] .. pathOffsets[t+1]-1, root first; each step is one question asked. */
      pathOffsets: z.array(z.number().int().nonnegative()),
      pathNode: z.array(z.number().int().nonnegative()),
      pathFeature: z.array(z.number().int().nonnegative()),
      pathThreshold: z.array(z.number()),
      /** True when the bar went to the "yes" branch (left, or the matching side of a CatBoost border). */
      pathWentLeft: z.array(z.boolean()),
    })
    .nullable(),
  /**
   * Linear and naive Bayes: per-input contributions to `output.raw` (Σ contributions + base = raw).
   * Naive Bayes: base = logPriors[up] − logPriors[down]; each value = ln N(x | up) − ln N(x | down) on `inputs.values`.
   */
  contributions: z.object({ values: z.array(z.number()), base: z.number() }).nullable(),
  neighbors: z
    .object({
      timestamps: z.array(epochSeconds),
      distances: z.array(z.number()),
      /** 1 up, 0 down (direction); target units (price). */
      targets: z.array(z.number()),
      weights: z.array(z.number()),
    })
    .nullable(),
  supportVectors: z
    .object({
      /** The support vectors that contribute most to this bar's decision value, largest |contribution| first. */
      timestamps: z.array(epochSeconds),
      dualCoefficients: z.array(z.number()),
      kernelValues: z.array(z.number()),
      contributions: z.array(z.number()),
      /** Σ over the support vectors NOT listed above, so Σ contributions + otherContribution + intercept = decisionValue. */
      otherContribution: z.number(),
      intercept: z.number(),
      decisionValue: z.number(),
    })
    .nullable(),
  /** baseScore is in the units the calibration map takes: the base model's decision_function value when it has one (gradient boosting, logistic regression), otherwise its predict_proba P(up) (random forest, naive Bayes). */
  calibration: z.object({ baseScore: z.number(), probabilityUp: z.number() }).nullable(),
  stacking: z.object({ baseOutputs: z.array(z.object({ name: z.string(), value: z.number() })), metaContributions: z.array(z.number()) }).nullable(),
  neural: z
    .object({
      /** Layer activations for this bar, row-major in `shape` (sequence layers are [time, units]). */
      layers: z.array(z.object({ name: z.string(), kind: z.string(), shape: z.array(z.number().int().nonnegative()), values: z.array(z.number()) })),
      /** Attention over the window's positions (oldest first), per layer and head, for the bar being predicted. */
      attention: z.array(z.object({ layer: z.string(), head: z.number().int().nonnegative(), weights: z.array(z.number()) })),
      logit: z.number(),
    })
    .nullable(),
});
export type CycleExplainBar = z.infer<typeof cycleExplainBarSchema>;

// ─── explainer process protocol (JSON lines over stdin / stdout) ─────────────

/** First line the process writes once it is ready; everything else is a reply. Logging goes to stderr. */
export const cycleExplainerReadySchema = z.object({ ready: z.literal(true), pid: z.number().int().positive() });

export const cycleExplainerRequestSchema = z.discriminatedUnion("op", [
  z.object({ id: z.string(), op: z.literal("ping") }),
  z.object({ id: z.string(), op: z.literal("structure"), runDirectory: z.string(), fold: z.number().int().nonnegative(), role: cycleExplainRoleSchema }),
  z.object({ id: z.string(), op: z.literal("tree"), runDirectory: z.string(), fold: z.number().int().nonnegative(), role: cycleExplainRoleSchema, tree: z.number().int().nonnegative() }),
  z.object({ id: z.string(), op: z.literal("explain"), runDirectory: z.string(), fold: z.number().int().nonnegative(), role: cycleExplainRoleSchema, timestamp: epochSeconds }),
  /** Drop every cached model of a run (before the run's files are deleted — Windows locks mapped files). */
  z.object({ id: z.string(), op: z.literal("releaseRun"), runDirectory: z.string() }),
  z.object({ id: z.string(), op: z.literal("exit") }),
]);
export type CycleExplainerRequest = z.infer<typeof cycleExplainerRequestSchema>;

export const cycleExplainerReplySchema = z.union([
  z.object({ id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ id: z.string(), ok: z.literal(false), error: z.string(), details: z.string().optional() }),
]);
export type CycleExplainerReply = z.infer<typeof cycleExplainerReplySchema>;
