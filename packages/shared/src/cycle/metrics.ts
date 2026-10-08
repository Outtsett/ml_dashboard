/**
 * A model's own statement of how it is judged: the `metrics` record every model
 * in `packages/config/cycle_models/*.json` carries, and the same record inside
 * every catalog specification's "Evaluation Metrics" section.
 *
 * Two layers, never blurred:
 *   native  what the algorithm produces, what it optimises, and the metrics that
 *           are correct for that output on its own terms;
 *   asRun   what the Model Cycle measures once the model is adapted to "is the
 *           close `label_horizon_bars` ahead above this bar's close" and its call
 *           is traded with costs: which of the engine's numbers test something
 *           this model's mechanism produced, and which are measured but say
 *           nothing about it.
 *
 * Every id resolves in `packages/config/metric_registry.json` (metric types,
 * metrics, objectives, evaluation profiles). For a quantity the engine computes,
 * the registry's definition is the engine's own text
 * (`packages/ml-engine/src/cycle/report.py`), so a record never restates a formula.
 * Python holds the registry to the same rules in
 * `packages/ml-engine/src/cycle/catalog.py`; reference `docs/model-metrics.md`.
 */
import { z } from "zod";

const ID = /^[a-z][a-z0-9_]*$/;
const id = z.string().regex(ID);
/** A sentence that becomes a table cell: no pipe, no line break. */
const sentence = z.string().min(1).refine((text) => !/[|\n\r]/.test(text), "a sentence holds no pipe and no line break");

export const metricRoleSchema = z.enum(["primary", "secondary", "diagnostic"]);
export type MetricRole = z.infer<typeof metricRoleSchema>;

export const metricAvailabilitySchema = z.enum(["computed", "computed_not_recorded", "derivable", "not_computed"]);
export type MetricAvailability = z.infer<typeof metricAvailabilitySchema>;

export const faithfulToSpecificationSchema = z.enum(["faithful", "partial", "stand_in", "no_specification"]);
export const probabilitySourceSchema = z.enum([
  "own_likelihood_probability", "frequency_or_vote_share", "validation_fitted_curve", "validation_temperature_only",
  "model_implied_tail_probability", "policy_action_share", "classifier_trained_on_generated_rows",
  "learned_head_on_code", "mean_of_base_learners",
]);
export const priceForecastSourceSchema = z.enum(["own_model", "own_model_shared_encoder", "second_model_same_family", "readout", "none"]);
export const checkpointSelectedBySchema = z.enum(["validation_logarithmic_loss", "validation_huber_loss", "validation_tape_utility", "none"]);

/** One metric a model is judged on, with the reason it applies to this model. */
export const modelMetricRowSchema = z
  .object({
    metricId: id,
    /** The registry's type for this metric, repeated so the row reads on its own. */
    type: id,
    role: metricRoleSchema,
    why: sentence,
    /** The same-model, same-series reference point in words; null when there is none. */
    baseline: sentence.nullable(),
    /** What the metric is computed per (state, score bin, rule) when it is a grouped quantity. */
    groupKind: z.string().min(1).nullable(),
    availability: metricAvailabilitySchema,
  })
  .strict();
export type ModelMetricRow = z.infer<typeof modelMetricRowSchema>;

export const notApplicableMetricSchema = z
  .object({
    /** The name people expect to see, including the rows of the specification's former table. */
    name: sentence,
    metricId: id.nullable(),
    why: sentence,
  })
  .strict();

export const nativeMetricsSchema = z
  .object({
    produces: sentence,
    targetVariable: sentence,
    objectiveId: id,
    objectiveNote: sentence.nullable(),
    metrics: z.array(modelMetricRowSchema).min(1),
    notApplicable: z.array(notApplicableMetricSchema),
  })
  .strict();
export type NativeMetrics = z.infer<typeof nativeMetricsSchema>;

export const asRunMetricRowSchema = z.object({ metricId: id, type: id, role: metricRoleSchema, why: sentence }).strict();
export const asRunStepQuantitySchema = z
  .object({
    /** The objective or metric id that `train_loss` holds at each step; null when the adapter logs none. */
    trainName: id.nullable(),
    validationName: id.nullable(),
    unit: sentence,
    direction: z.enum(["lower", "higher"]),
    /** False when the two curves are different quantities, so their gap is not an overfitting measure. */
    sameQuantityOnTrainAndValidation: z.boolean(),
  })
  .strict();

export const asRunMetricsSchema = z
  .object({
    faithfulToSpecification: faithfulToSpecificationSchema,
    /** What the runnable adapter does instead of the specification; null exactly when faithful. */
    standInNote: sentence.nullable(),
    directionMode: z.enum(["classifier", "from_price"]),
    probabilitySource: probabilitySourceSchema,
    classWeighted: z.boolean(),
    probabilityNote: sentence,
    priceForecastSource: priceForecastSourceSchema,
    /** What the runnable adapter minimises, by objectives-registry id. */
    objectiveId: id,
    checkpointSelectedBy: checkpointSelectedBySchema,
    /** True when at least one of the model's parameters has a search space. */
    tuned: z.boolean(),
    stepQuantity: asRunStepQuantitySchema.nullable(),
    meaningful: z.array(asRunMetricRowSchema).min(1),
    measuredNotMeaningful: z.array(z.object({ metricId: id, why: sentence }).strict()),
    caveats: z.array(sentence),
  })
  .strict()
  .superRefine((block, context) => {
    if ((block.faithfulToSpecification === "faithful") !== (block.standInNote === null)) {
      context.addIssue({ code: "custom", message: "standInNote is null exactly when the adapter is faithful to the specification" });
    }
  });
export type AsRunMetrics = z.infer<typeof asRunMetricsSchema>;

/** The record on a registry model: both layers. */
export const modelMetricsSchema = z
  .object({
    recordVersion: z.literal(1),
    profileIdNative: id,
    profileIdAsRun: id,
    additionalProfileIds: z.array(id),
    native: nativeMetricsSchema,
    asRun: asRunMetricsSchema,
  })
  .strict();
export type ModelMetrics = z.infer<typeof modelMetricsSchema>;

/**
 * The record inside a catalog specification. `asRun` is null for a specification
 * the Model Cycle does not run; `registryModelKey` names the runnable model whose
 * as-run block it carries.
 */
export const specificationMetricsSchema = z
  .object({
    recordVersion: z.literal(1),
    profileIdNative: id,
    profileIdAsRun: id.nullable(),
    additionalProfileIds: z.array(id),
    registryModelKey: z.string().nullable(),
    native: nativeMetricsSchema,
    asRun: asRunMetricsSchema.nullable(),
  })
  .strict()
  .superRefine((record, context) => {
    if ((record.asRun === null) !== (record.registryModelKey === null) || (record.asRun === null) !== (record.profileIdAsRun === null)) {
      context.addIssue({ code: "custom", message: "asRun, profileIdAsRun and registryModelKey are all set or all null" });
    }
  });
export type SpecificationMetrics = z.infer<typeof specificationMetricsSchema>;

// ─── the registry the ids resolve in ────────────────────────────────────────

export const metricRegistrySchema = z.object({
  version: z.number().int().positive(),
  description: z.string(),
  availabilityValues: z.record(z.string()),
  roleValues: z.record(z.string()),
  faithfulToSpecificationValues: z.record(z.string()),
  probabilitySourceValues: z.record(z.string()),
  priceForecastSourceValues: z.record(z.string()),
  checkpointSelectedByValues: z.record(z.string()),
  metricTypes: z.array(z.object({ typeId: id, name: z.string(), layer: z.string(), questionItAnswers: z.string() })),
  metrics: z.array(
    z.object({
      metricId: id,
      fullName: z.string().min(1),
      metricType: id,
      layer: z.enum(["native", "as_run", "both"]),
      /** Inputs, formula, units, annualisation and exclusions in complete sentences; the engine's own text when it computes the quantity. */
      definition: z.string().min(1),
      formula: z.string().min(1),
      units: z.string(),
      direction: z.string(),
      baseline: z.string().nullable(),
      availability: metricAvailabilitySchema,
      /** The engine's column name (`derived_model_cycle_runs_metrics`); null when the engine has no such number. */
      engineId: z.string().nullable(),
      engineTable: z.string().nullable(),
      engineSource: z.string().nullable(),
      /** How to read the number, where the taxonomy adds to the engine's definition. */
      reading: z.string().nullable(),
    }),
  ),
  objectives: z.array(z.object({ objectiveId: id, fullName: z.string(), formula: z.string(), plainWords: z.string() })),
  profiles: z.array(
    z.object({
      profileId: id,
      name: z.string(),
      appliesTo: z.string(),
      produces: z.string(),
      typicalObjectives: z.array(id),
      metrics: z.array(z.object({ metricId: id, role: metricRoleSchema, why: z.string() })),
      notApplicable: z.array(z.object({ metricId: id, why: z.string() })),
    }),
  ),
  asRunRules: z.array(z.string()),
  assignmentRules: z.array(z.string()),
  engineGaps: z.array(z.object({ metricId: z.string(), neededBy: z.array(z.string()), whatItTakes: z.string() })),
});
export type MetricRegistry = z.infer<typeof metricRegistrySchema>;
export type RegistryMetric = MetricRegistry["metrics"][number];

/** The id sets a record is checked against. */
export interface MetricRegistryIndex {
  metrics: Map<string, RegistryMetric>;
  objectives: Set<string>;
  profiles: Set<string>;
}

export function indexMetricRegistry(registry: MetricRegistry): MetricRegistryIndex {
  return {
    metrics: new Map(registry.metrics.map((metric) => [metric.metricId, metric])),
    objectives: new Set(registry.objectives.map((objective) => objective.objectiveId)),
    profiles: new Set(registry.profiles.map((profile) => profile.profileId)),
  };
}

/**
 * Checks a record against the registry: every id resolves, every row's type and
 * availability are the registry's, an as-run metric is one the engine computes,
 * and the price-forecast source is "none" exactly when the model has no price
 * model. Returns the problems; an empty list means the record is consistent.
 */
export function crossCheckModelMetrics(
  record: Pick<SpecificationMetrics, "profileIdNative" | "profileIdAsRun" | "additionalProfileIds" | "native" | "asRun">,
  index: MetricRegistryIndex,
  model?: { hasPriceModel: boolean; directionMode: string; tuned: boolean },
): string[] {
  const problems: string[] = [];
  for (const profile of [record.profileIdNative, record.profileIdAsRun, ...record.additionalProfileIds]) {
    if (profile !== null && !index.profiles.has(profile)) problems.push(`profile ${profile} is not in the metric registry`);
  }
  if (!index.objectives.has(record.native.objectiveId)) problems.push(`objective ${record.native.objectiveId} is not in the metric registry`);
  const primaries = record.native.metrics.filter((row) => row.role === "primary").length;
  if (primaries < 1 || primaries > 3) problems.push(`${primaries} primary native metrics; a model has one to three`);
  for (const row of record.native.metrics) {
    const metric = index.metrics.get(row.metricId);
    if (!metric) {
      problems.push(`native metric ${row.metricId} is not in the metric registry`);
      continue;
    }
    if (metric.layer === "as_run") problems.push(`native metric ${row.metricId} is an as-run-only metric`);
    if (metric.metricType !== row.type) problems.push(`native metric ${row.metricId}: type ${row.type} is not the registry's ${metric.metricType}`);
    if (metric.availability !== row.availability) problems.push(`native metric ${row.metricId}: availability ${row.availability} is not the registry's ${metric.availability}`);
  }
  for (const row of record.native.notApplicable) {
    if (row.metricId !== null && !index.metrics.has(row.metricId)) problems.push(`not-applicable metric ${row.metricId} is not in the metric registry`);
  }
  const block = record.asRun;
  if (block === null) return problems;
  if (!index.objectives.has(block.objectiveId)) problems.push(`as-run objective ${block.objectiveId} is not in the metric registry`);
  const classified = new Set<string>();
  for (const row of block.meaningful) {
    const metric = index.metrics.get(row.metricId);
    if (!metric) problems.push(`as-run metric ${row.metricId} is not in the metric registry`);
    else {
      if (metric.metricType !== row.type) problems.push(`as-run metric ${row.metricId}: type ${row.type} is not the registry's ${metric.metricType}`);
      if (metric.availability === "not_computed") problems.push(`as-run metric ${row.metricId} is one the engine does not compute`);
    }
    if (classified.has(row.metricId)) problems.push(`as-run metric ${row.metricId} is listed twice`);
    classified.add(row.metricId);
  }
  for (const row of block.measuredNotMeaningful) {
    if (!index.metrics.has(row.metricId)) problems.push(`measured-not-meaningful metric ${row.metricId} is not in the metric registry`);
    if (classified.has(row.metricId)) problems.push(`${row.metricId} is both meaningful and measured but not meaningful`);
    classified.add(row.metricId);
  }
  const asRunPrimaries = block.meaningful.filter((row) => row.role === "primary").length;
  if (asRunPrimaries < 1 || asRunPrimaries > 3) problems.push(`${asRunPrimaries} primary as-run metrics; a model has one to three`);
  for (const name of [block.stepQuantity?.trainName, block.stepQuantity?.validationName]) {
    if (name != null && !index.objectives.has(name) && !index.metrics.has(name)) problems.push(`step quantity ${name} is neither an objective nor a metric in the registry`);
  }
  if (model) {
    if ((block.priceForecastSource === "none") !== !model.hasPriceModel) problems.push(`priceForecastSource is "none" exactly when the model has no price model`);
    if (block.directionMode !== model.directionMode) problems.push(`asRun.directionMode ${block.directionMode} is not the model's ${model.directionMode}`);
    if (block.tuned !== model.tuned) problems.push(`asRun.tuned is ${block.tuned} but the model ${model.tuned ? "has" : "has no"} search space`);
  }
  return problems;
}
