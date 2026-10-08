/**
 * A model's metrics record joined to the metric registry, as the rows a panel
 * draws. Pure: no fetching, no React. The registry supplies each metric's name,
 * type and definition; the record supplies the role and the reason it applies
 * to this model.
 */
import type { MetricAvailability, MetricRegistry, MetricRole, SpecificationMetrics } from "@shared/cycle/metrics";

export type MetricLayer = "native" | "asRun";

export interface MetricViewRow {
  metricId: string;
  fullName: string;
  type: string;
  typeName: string;
  /** The question a metric of this type answers. */
  typeQuestion: string;
  role: MetricRole;
  why: string;
  /** The same-model, same-series reference in words; null when there is none. */
  referencePoint: string | null;
  availability: MetricAvailability;
  definition: string;
  formula: string;
  units: string;
  direction: string;
  /** The engine's column name for this quantity; null when the engine has no such number. */
  engineId: string | null;
  engineSource: string | null;
  reading: string | null;
}

export interface NotMeaningfulRow {
  metricId: string;
  fullName: string;
  engineId: string | null;
  why: string;
}

const ROLE_ORDER: Record<MetricRole, number> = { primary: 0, secondary: 1, diagnostic: 2 };

/** The metrics of one layer, primary first, each with its registry definition. A metric the registry lacks is skipped. */
export function rowsOf(record: SpecificationMetrics, registry: MetricRegistry, layer: MetricLayer): MetricViewRow[] {
  const metrics = new Map(registry.metrics.map((metric) => [metric.metricId, metric]));
  const types = new Map(registry.metricTypes.map((type) => [type.typeId, type]));
  const source =
    layer === "native"
      ? record.native.metrics.map((row) => ({ metricId: row.metricId, role: row.role, why: row.why, baseline: row.baseline }))
      : (record.asRun?.meaningful ?? []).map((row) => ({ metricId: row.metricId, role: row.role, why: row.why, baseline: null as string | null }));
  const rows: MetricViewRow[] = [];
  for (const row of source) {
    const metric = metrics.get(row.metricId);
    if (!metric) continue;
    const type = types.get(metric.metricType);
    rows.push({
      metricId: row.metricId,
      fullName: metric.fullName,
      type: metric.metricType,
      typeName: type?.name ?? metric.metricType,
      typeQuestion: type?.questionItAnswers ?? "",
      role: row.role,
      why: row.why,
      referencePoint: row.baseline ?? metric.baseline,
      availability: metric.availability,
      definition: metric.definition,
      formula: metric.formula,
      units: metric.units,
      direction: metric.direction,
      engineId: metric.engineId,
      engineSource: metric.engineSource,
      reading: metric.reading,
    });
  }
  return rows.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
}

/** The engine's numbers that say nothing about this model, each with the reason. */
export function notMeaningfulOf(record: SpecificationMetrics, registry: MetricRegistry): NotMeaningfulRow[] {
  const metrics = new Map(registry.metrics.map((metric) => [metric.metricId, metric]));
  return (record.asRun?.measuredNotMeaningful ?? []).map((row) => ({
    metricId: row.metricId,
    fullName: metrics.get(row.metricId)?.fullName ?? row.metricId,
    engineId: metrics.get(row.metricId)?.engineId ?? null,
    why: row.why,
  }));
}

export interface MetricRowSummary {
  total: number;
  primary: number;
  secondary: number;
  diagnostic: number;
  /** Rows the dashboard computes and records today. */
  computed: number;
}

export function summaryOf(rows: MetricViewRow[]): MetricRowSummary {
  return {
    total: rows.length,
    primary: rows.filter((row) => row.role === "primary").length,
    secondary: rows.filter((row) => row.role === "secondary").length,
    diagnostic: rows.filter((row) => row.role === "diagnostic").length,
    computed: rows.filter((row) => row.availability === "computed").length,
  };
}

export type RunMetricStanding =
  | { standing: MetricRole; why: string; fullName: string }
  | { standing: "not_meaningful"; why: string; fullName: string };

/**
 * How each engine metric stands for this model as run, keyed by the ENGINE's
 * metric name (the run page's tiles and readouts are keyed that way): its role
 * when it tests something the model's mechanism produced, or "not_meaningful"
 * with the reason. A metric the record does not classify is absent.
 */
export function standingByEngineMetric(record: SpecificationMetrics | null | undefined, registry: MetricRegistry | undefined): Map<string, RunMetricStanding> {
  const standing = new Map<string, RunMetricStanding>();
  if (!record?.asRun || !registry) return standing;
  const metrics = new Map(registry.metrics.map((metric) => [metric.metricId, metric]));
  for (const row of record.asRun.meaningful) {
    const metric = metrics.get(row.metricId);
    if (metric?.engineId) standing.set(metric.engineId, { standing: row.role, why: row.why, fullName: metric.fullName });
  }
  for (const row of record.asRun.measuredNotMeaningful) {
    const metric = metrics.get(row.metricId);
    if (metric?.engineId) standing.set(metric.engineId, { standing: "not_meaningful", why: row.why, fullName: metric.fullName });
  }
  return standing;
}
