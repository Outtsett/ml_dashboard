/**
 * Every model's metrics record, TypeScript side (`packages/shared/src/cycle/metrics.ts`).
 * Held to the same files as `packages/ml-engine/tests/test_metric_registry.py`:
 * the metric registry parses, every runnable model and every catalog
 * specification carries a record whose ids all resolve in it, and a
 * specification that is a model's primary link carries that model's record.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkpointSelectedBySchema,
  crossCheckModelMetrics,
  faithfulToSpecificationSchema,
  indexMetricRegistry,
  metricAvailabilitySchema,
  metricRegistrySchema,
  metricRoleSchema,
  priceForecastSourceSchema,
  probabilitySourceSchema,
  type SpecificationMetrics,
} from "@shared/cycle/metrics";
import { crossCheckCycleRegistryMetrics, cycleModelFileSchema, cycleSharedRegistrySchema, type CycleModelEntry, type CycleRegistry } from "@shared/cycle/models";
import { notMeaningfulOf, rowsOf, standingByEngineMetric, summaryOf } from "@/ml/metrics/rows";

import { extractMetricsRecord } from "../../apps/api/infrastructure/lib/modelImport/parser";

const ROOT = path.resolve(__dirname, "..", "..");
const CONFIG = path.join(ROOT, "packages", "config");
const SPECIFICATIONS = path.join(ROOT, "Trading", "_architecture", "educational", "algo_models");

const registry = metricRegistrySchema.parse(JSON.parse(readFileSync(path.join(CONFIG, "metric_registry.json"), "utf-8")));
const index = indexMetricRegistry(registry);

function readCycleRegistry(): CycleRegistry {
  const directory = path.join(CONFIG, "cycle_models");
  const shared = cycleSharedRegistrySchema.parse(JSON.parse(readFileSync(path.join(directory, "_cycle.json"), "utf-8")));
  const cycle: CycleRegistry = { shared, models: {}, files: {} };
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".json") && file !== "_cycle.json").sort()) {
    const parsed = cycleModelFileSchema.parse(JSON.parse(readFileSync(path.join(directory, name), "utf-8")));
    for (const [key, entry] of Object.entries(parsed.models)) {
      cycle.models[key] = entry as CycleModelEntry;
      cycle.files[key] = name;
    }
  }
  return cycle;
}

/** The catalog's spec id rule (`apps/api/infrastructure/lib/modelImport/parser.ts` `slugify`). */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[()]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function specificationFiles(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) specificationFiles(full, found);
    else if (name.endsWith(".md")) found.push(full);
  }
  return found;
}

function recordOf(file: string): SpecificationMetrics | undefined {
  const text = readFileSync(file, "utf-8");
  const start = text.indexOf("\n## Evaluation Metrics");
  if (start < 0) return undefined;
  const next = text.indexOf("\n## ", start + 4);
  const warnings: string[] = [];
  const record = extractMetricsRecord(text.slice(start, next < 0 ? undefined : next), warnings);
  expect(warnings, file).toEqual([]);
  return record;
}

describe("metric registry", () => {
  it("lists the same allowed values as the schema", () => {
    expect(Object.keys(registry.roleValues).sort()).toEqual([...metricRoleSchema.options].sort());
    expect(Object.keys(registry.availabilityValues).sort()).toEqual([...metricAvailabilitySchema.options].sort());
    expect(Object.keys(registry.faithfulToSpecificationValues).sort()).toEqual([...faithfulToSpecificationSchema.options].sort());
    expect(Object.keys(registry.probabilitySourceValues).sort()).toEqual([...probabilitySourceSchema.options].sort());
    expect(Object.keys(registry.priceForecastSourceValues).sort()).toEqual([...priceForecastSourceSchema.options].sort());
    expect(Object.keys(registry.checkpointSelectedByValues).sort()).toEqual([...checkpointSelectedBySchema.options].sort());
  });

  it("types every metric with a registered type", () => {
    const types = new Set(registry.metricTypes.map((type) => type.typeId));
    for (const metric of registry.metrics) expect(types.has(metric.metricType), metric.metricId).toBe(true);
  });
});

describe("runnable models", () => {
  const cycle = readCycleRegistry();

  it("every model carries a metrics record", () => {
    const without = Object.entries(cycle.models).filter(([, entry]) => !entry.metrics).map(([key]) => key);
    expect(without).toEqual([]);
  });

  it("every record resolves in the metric registry and agrees with its entry", () => {
    expect(crossCheckCycleRegistryMetrics(cycle, index)).toEqual([]);
  });

  it("a stand-in says what actually runs", () => {
    for (const [key, entry] of Object.entries(cycle.models)) {
      const asRun = entry.metrics!.asRun;
      if (asRun.faithfulToSpecification !== "faithful") expect(asRun.standInNote, key).toBeTruthy();
    }
  });

  it("joins a record to the registry for the panel and for the run page's tiles", () => {
    const entry = cycle.models["xgboost"]!;
    const record: SpecificationMetrics = { ...entry.metrics!, registryModelKey: "xgboost" };
    const native = rowsOf(record, registry, "native");
    const asRun = rowsOf(record, registry, "asRun");
    expect(native.length).toBe(record.native.metrics.length);
    expect(native[0]!.role).toBe("primary");
    expect(asRun.every((row) => row.availability !== "not_computed")).toBe(true);
    const summary = summaryOf(native);
    expect(summary.primary + summary.secondary + summary.diagnostic).toBe(summary.total);
    // tiles are keyed by the engine's metric names, so the full-word ids are mapped back
    const standing = standingByEngineMetric(record, registry);
    expect(standing.has("sharpe_ratio")).toBe(true);
    expect(standing.has("log_loss")).toBe(true);
    expect(standing.has("logarithmic_loss")).toBe(false);
    for (const row of notMeaningfulOf(record, registry)) expect(standing.get(row.engineId ?? "")?.standing ?? "not_meaningful").toBe("not_meaningful");
  });
});

describe.skipIf(!existsSync(SPECIFICATIONS))("catalog specifications", () => {
  const cycle = readCycleRegistry();
  const files = specificationFiles(SPECIFICATIONS);
  const records = new Map<string, SpecificationMetrics>();
  for (const file of files) {
    const record = recordOf(file);
    if (record) records.set(slugify(path.relative(SPECIFICATIONS, file).replace(/\\/g, "/").replace(/\.md$/i, "")), record);
  }

  it("every specification carries a record", () => {
    expect(files.length).toBeGreaterThanOrEqual(300);
    expect(records.size).toBe(files.length);
  });

  it("every record resolves in the metric registry", () => {
    const problems: string[] = [];
    for (const [id, record] of records) for (const problem of crossCheckModelMetrics(record, index)) problems.push(`${id}: ${problem}`);
    expect(problems).toEqual([]);
  });

  it("a model's primary specification carries that model's record, and a shared one its as-run block", () => {
    for (const [key, entry] of Object.entries(cycle.models)) {
      if (entry.catalogSpecId !== null) {
        const record = records.get(entry.catalogSpecId);
        expect(record, entry.catalogSpecId).toBeDefined();
        expect(record!.registryModelKey).toBe(key);
        expect(record!.native).toEqual(entry.metrics!.native);
        expect(record!.asRun).toEqual(entry.metrics!.asRun);
      }
      for (const also of entry.alsoCatalogSpecIds) {
        const record = records.get(also);
        expect(record, also).toBeDefined();
        expect(record!.registryModelKey).toBe(key);
        expect(record!.asRun).toEqual(entry.metrics!.asRun);
      }
    }
  });

  it("a specification the Model Cycle does not run has a native record only", () => {
    const linked = new Set(Object.values(cycle.models).flatMap((entry) => [entry.catalogSpecId, ...entry.alsoCatalogSpecIds]));
    for (const [id, record] of records) {
      if (!linked.has(id)) expect(record.asRun, id).toBeNull();
    }
  });

  it("no section keeps the stamped boilerplate", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf-8");
      expect(text.includes("Target Threshold"), file).toBe(false);
      expect(text.includes("Semantic Hierarchical Path"), file).toBe(false);
      expect(text.includes("Target Semantic Variable"), file).toBe(false);
    }
  });
});
