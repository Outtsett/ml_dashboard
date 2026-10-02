/**
 * The Model Cycle's model registry (`packages/config/cycle_models/*.json`), as the
 * server and client read it, and the model-browser response built from it.
 *
 * One registry is the single source of truth for which models the Cycle can
 * run. Python reads the same files through `packages/ml-engine/src/cycle/catalog.py`; both
 * sides must accept the real registry and reject every file in
 * `tests/fixtures/cycle_models_invalid/`. Keep the rules here and there in step.
 *
 * `_cycle.json` holds what every model shares; every other file holds
 * `{ "models": { <key>: <entry> } }`. Design:
 * `docs/plans/2026-09-26-cycle-catalog-inside-view.md`.
 */
import { z } from "zod";

import { cycleDirectionModeSchema, cycleExplainKindSchema, cycleModelFamilySchema, cycleStepUnitSchema } from "./schema";

export const CYCLE_MODEL_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
export const CYCLE_RUNNER_SUFFIX = "+walk_forward_cycle";

const finite = z.number().finite();

export const cycleSearchSpaceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("float"), low: finite, high: finite, log: z.boolean().optional() }),
  z.object({ kind: z.literal("int"), low: finite, high: finite, log: z.boolean().optional() }),
  z.object({ kind: z.literal("categorical"), choices: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1) }),
]);

/**
 * One parameter. `type` is authoritative (a float parameter may have a whole
 * default). `argument` is the estimator keyword it becomes; `roles` limits it
 * to the direction or price estimator; `search` is its Optuna space.
 */
export const cycleParameterSchema = z
  .object({
    type: z.enum(["int", "float", "bool", "categorical", "string"]),
    default: z.union([z.number(), z.string(), z.boolean()]),
    min: finite.optional(),
    max: finite.optional(),
    step: finite.optional(),
    logScale: z.boolean().optional(),
    choices: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1).optional(),
    label: z.string().min(1),
    group: z.string().min(1),
    description: z.string().optional(),
    argument: z.string().min(1).optional(),
    roles: z.array(z.enum(["direction", "price"])).min(1).optional(),
    search: cycleSearchSpaceSchema.optional(),
  })
  .strict()
  .superRefine((spec, context) => {
    if (spec.type === "bool" && typeof spec.default !== "boolean") context.addIssue({ code: "custom", message: "a bool parameter's default must be true or false" });
    if (spec.type === "string" && typeof spec.default !== "string") context.addIssue({ code: "custom", message: "a string parameter's default must be text" });
    if (spec.type === "categorical" && !(spec.choices ?? []).includes(spec.default)) context.addIssue({ code: "custom", message: "default is not one of its choices" });
    if (spec.type === "int" || spec.type === "float") {
      if (typeof spec.default !== "number" || !Number.isFinite(spec.default)) {
        context.addIssue({ code: "custom", message: "default must be a finite number" });
        return;
      }
      if (spec.type === "int" && !Number.isInteger(spec.default)) context.addIssue({ code: "custom", message: "an int parameter's default must be whole" });
      if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) context.addIssue({ code: "custom", message: "min is above max" });
      if ((spec.min !== undefined && spec.default < spec.min) || (spec.max !== undefined && spec.default > spec.max)) {
        context.addIssue({ code: "custom", message: "default is outside its bounds" });
      }
    }
    if (spec.search && spec.search.kind !== "categorical") {
      if (spec.search.low >= spec.search.high) context.addIssue({ code: "custom", message: "search needs low < high" });
      if (spec.search.log && spec.search.low <= 0) context.addIssue({ code: "custom", message: "a log search needs low > 0" });
      if (spec.search.kind === "int" && spec.type !== "int") context.addIssue({ code: "custom", message: "an int search needs an int parameter" });
    }
  });
export type CycleParameter = z.infer<typeof cycleParameterSchema>;

const estimatorBlockSchema = z.object({
  estimator: z.string().min(1).nullable(),
  fixed: z.record(z.unknown()).default({}),
});

export const cycleModelEntrySchema = z
  .object({
    catalogSpecId: z.string().nullable(),
    alsoCatalogSpecIds: z.array(z.string()),
    displayName: z.string().min(1),
    /** Fallback labels, used when the catalog folder is not on disk. */
    category: z.string().min(1),
    subcategory: z.string().min(1),
    /** The card's badge: "Tree ensemble", "Single tree", "Linear", "Margin", … */
    kind: z.string().min(1),
    summary: z.string().min(1),
    /** How the Cycle implements the catalog spec, when it differs from the spec (encoder only, calibrated on validation, …). */
    implementationNote: z.string().nullable(),
    runnable: z.boolean(),
    unavailableReason: z.string().nullable(),
    /** "custom": the model's own numpy / scipy / library code (neither a scikit-learn estimator, statsmodels nor torch). */
    implementation: z.enum(["sklearn", "xgboost", "lightgbm", "catboost", "statsmodels", "torch", "custom"]),
    adapter: z.enum([
      "legacy", "scikit_learn", "catboost", "statsmodels", "neural",
      "tree_boosted_neural_embedding", "attention_weighted_forecast_stack", "bayesian_neural_hybrid",
      // the bridge families (packages/ml-engine/src/cycle/adapters_extra/<family>/, sharing packages/ml-engine/src/cycle/bridges/)
      "discrete_state_agent", "deep_value_agent", "policy_agent", "hierarchical_agent", "meta_agent",
      "world_model_agent", "planning_agent", "signal_program", "policy_search", "path_simulator",
      "series_forecast", "barrier_survival", "glm_bridge", "bayesian_predictive", "decision_graph",
      "symbolic_reasoner", "self_supervised_probe", "density_classifier", "implicit_generator_classifier",
      "latent_state_readout", "latent_projection_head", "graph_label_inference", "pseudo_label_ensemble",
      "semi_supervised_network", "meta_symbolic_router",
    ]),
    legacyFamily: cycleModelFamilySchema.nullable(),
    direction: estimatorBlockSchema.extend({
      mode: cycleDirectionModeSchema,
      probability: z.enum(["legacy", "predict_proba", "logistic_curve_on_validation", "network", "probit"]),
    }),
    /** Null: the model has no regression form, so it has no price model and draws no forecast line. */
    price: estimatorBlockSchema.nullable(),
    preprocess: z.array(z.literal("standard_scaler")),
    progress: z.enum(["legacy", "warm_start_trees", "warm_start_rounds", "per_round", "per_epoch", "single_fit"]),
    stepUnit: cycleStepUnitSchema,
    explainKind: cycleExplainKindSchema,
    sequence: z.boolean(),
    network: z
      .enum([
        "multilayer_perceptron", "lstm", "temporal_convolution_network", "transformer_encoder", "recurrent", "gated_recurrent_unit", "attention_recurrent",
        "mixture_of_experts", "recurrent_convolution_hybrid", "hypernetwork", "neural_turing_machine", "dual_pathway",
        "window_backbone", "feature_graph", "neuro_symbolic",
      ])
      .nullable(),
    speed: z.enum(["fast", "medium", "slow"]),
    estimatedTrainingTime: z.string().min(1),
    gpu: z.boolean(),
    parameters: z.record(cycleParameterSchema),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.runnable === (entry.unavailableReason !== null)) {
      context.addIssue({ code: "custom", message: "a runnable model has no unavailableReason; a model that is not runnable needs one" });
    }
    if ((entry.adapter === "legacy") !== (entry.legacyFamily !== null)) context.addIssue({ code: "custom", message: "legacyFamily is set exactly when adapter is 'legacy'" });
    if ((entry.adapter === "legacy") !== (entry.progress === "legacy")) context.addIssue({ code: "custom", message: "progress is 'legacy' exactly when adapter is 'legacy'" });
    if (entry.sequence && entry.network === null) context.addIssue({ code: "custom", message: "a sequence model needs a network" });
    if (entry.adapter === "neural" && entry.network === null) context.addIssue({ code: "custom", message: "a neural adapter needs a network" });
    if (entry.direction.mode === "from_price") {
      if (!entry.price?.estimator) context.addIssue({ code: "custom", message: "a from_price model needs a price estimator" });
      if (entry.direction.probability !== "logistic_curve_on_validation") context.addIssue({ code: "custom", message: "a from_price model reads P(up) through logistic_curve_on_validation" });
    }
    for (const name of Object.keys(entry.parameters)) {
      if (!CYCLE_MODEL_KEY_PATTERN.test(name)) context.addIssue({ code: "custom", message: `parameter name ${name} is not a key` });
      if (entry.parameters[name]!.group !== "Model") context.addIssue({ code: "custom", message: `parameter ${name}: a model parameter's group must be "Model"` });
    }
  });
export type CycleModelEntry = z.infer<typeof cycleModelEntrySchema>;

export const cycleSharedRegistrySchema = z.object({
  version: z.number().int().positive(),
  task: z.string().min(1),
  displayNameSuffix: z.string(),
  /** The runner fields every Cycle model shares (script, outputs, …). */
  runnerTemplate: z.record(z.unknown()),
  groupOrder: z.array(z.string()).min(1),
  estimatorPrefixes: z.array(z.string().regex(/\.$/)).min(1),
  /** The walk-forward, labels, trading, tuning, replay and runtime parameters every model shares. */
  cycleParameters: z.record(cycleParameterSchema),
  unavailableByCategory: z.record(z.string()),
  /** Keyed `<category>/<subcategory>`. */
  unavailableBySubcategory: z.record(z.string()),
  unavailableBySpec: z.record(z.string()),
});
export type CycleSharedRegistry = z.infer<typeof cycleSharedRegistrySchema>;

export const cycleModelFileSchema = z.object({ models: z.record(cycleModelEntrySchema) }).strict();

export interface CycleRegistry {
  shared: CycleSharedRegistry;
  models: Record<string, CycleModelEntry>;
  /** Which file each model key came from. */
  files: Record<string, string>;
}

/**
 * Checks across the whole registry that one file cannot see: unique keys, one
 * type per parameter name, estimator prefixes, no model parameter colliding
 * with a cycle-wide one, each catalog spec claimed by one model at most.
 * Returns the problems; an empty list means the registry is valid.
 */
export function crossCheckCycleRegistry(registry: CycleRegistry): string[] {
  const problems: string[] = [];
  const types = new Map<string, { type: string; key: string }>();
  const specs = new Map<string, string>();
  for (const [key, entry] of Object.entries(registry.models)) {
    if (!CYCLE_MODEL_KEY_PATTERN.test(key)) problems.push(`model key ${key} does not match ${CYCLE_MODEL_KEY_PATTERN}`);
    for (const [name, spec] of Object.entries(entry.parameters)) {
      if (name in registry.shared.cycleParameters) problems.push(`${key}: parameter ${name} collides with a cycle-wide parameter`);
      const seen = types.get(name);
      if (seen && seen.type !== spec.type) problems.push(`parameter ${name} is ${spec.type} in ${key} but ${seen.type} in ${seen.key}`);
      if (!seen) types.set(name, { type: spec.type, key });
    }
    for (const role of ["direction", "price"] as const) {
      const estimator = role === "direction" ? entry.direction.estimator : entry.price?.estimator ?? null;
      if (estimator !== null && !registry.shared.estimatorPrefixes.some((prefix) => estimator.startsWith(prefix))) {
        problems.push(`${key}: ${role}.estimator ${estimator} is outside the allowed prefixes`);
      }
    }
    for (const specId of [entry.catalogSpecId, ...entry.alsoCatalogSpecIds]) {
      if (specId === null) continue;
      const owner = specs.get(specId);
      if (owner) problems.push(`catalog spec ${specId} is claimed by both ${owner} and ${key}`);
      else specs.set(specId, key);
    }
  }
  return problems;
}

// ─── GET /api/training/cycle-models ─────────────────────────────────────────

/** One card in the Cycle's model browser: a registry model, or a catalog spec the Cycle cannot run (greyed, with the reason). */
export const cycleModelCardSchema = z.object({
  /** Registry key (runner key = key + "+walk_forward_cycle"); null for a catalog spec with no registry entry. */
  key: cycleModelFamilySchema.nullable(),
  runnerKey: z.string().nullable(),
  displayName: z.string(),
  catalogSpecId: z.string().nullable(),
  /** True when the catalog has this spec on disk, so the "spec" link opens it. */
  specAvailable: z.boolean(),
  kind: z.string().nullable(),
  summary: z.string().nullable(),
  implementationNote: z.string().nullable(),
  runnable: z.boolean(),
  unavailableReason: z.string().nullable(),
  implementation: z.string().nullable(),
  explainKind: cycleExplainKindSchema.nullable(),
  directionMode: cycleDirectionModeSchema.nullable(),
  hasPriceModel: z.boolean().nullable(),
  sequence: z.boolean(),
  speed: z.enum(["fast", "medium", "slow"]).nullable(),
  estimatedTrainingTime: z.string().nullable(),
});
export type CycleModelCard = z.infer<typeof cycleModelCardSchema>;

export const cycleModelsResponseSchema = z.object({
  categories: z.array(
    z.object({
      /** Catalog category id ("supervised", "neural-network", …) or the registry's fallback label. */
      id: z.string(),
      label: z.string(),
      runnableCount: z.number().int().nonnegative(),
      subcategories: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          models: z.array(cycleModelCardSchema),
        }),
      ),
    }),
  ),
  runnableCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  /** False when the catalog folder is not on disk: the browser shows the registry's own fallback grouping. */
  catalogAvailable: z.boolean(),
});
export type CycleModelsResponse = z.infer<typeof cycleModelsResponseSchema>;
