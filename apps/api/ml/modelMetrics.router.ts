/**
 * How each model is judged: the metric registry and every model's own metrics
 * record, natively and as run by the Model Cycle. HTTP layer only.
 *
 * GET /api/model-metrics/registry               metric types, metrics, objectives, profiles
 * GET /api/model-metrics/models/:key            a runnable model's record (both layers)
 * GET /api/model-metrics/specifications/:id     a catalog specification's record
 * GET /api/model-metrics/coverage               how many models and specifications carry a record,
 *                                               by profile, fidelity and availability of the primary metric
 *
 * Reference: docs/model-metrics.md.
 */
import { Router, type Request, type Response } from "express";

import type { SpecificationMetrics } from "@shared/cycle/metrics";
import { crossCheckCycleRegistryMetrics } from "@shared/cycle/models";

import { getCatalogModels, getModelById } from "../infrastructure/lib/modelImport";
import { loadCycleRegistry } from "../training/cycleModels";
import { loadMetricRegistry } from "./metricRegistry";

const router = Router();

router.get("/model-metrics/registry", (_req: Request, res: Response) => {
  const load = loadMetricRegistry();
  if (!load.registry) return res.status(500).json({ error: `metric registry is invalid: ${load.problems.join("; ")}` });
  res.json(load.registry);
});

router.get("/model-metrics/models/:key", (req: Request, res: Response) => {
  const load = loadCycleRegistry();
  if (!load.registry) return res.status(500).json({ error: `Model Cycle registry is invalid: ${load.problems.join("; ")}` });
  const key = String(req.params.key).replace(/\+walk_forward_cycle$/, "");
  const entry = load.registry.models[key];
  if (!entry) return res.status(404).json({ error: `no runnable model ${key}` });
  const record: SpecificationMetrics = { ...entry.metrics, registryModelKey: key };
  res.json({ key, displayName: entry.displayName, kind: entry.kind, catalogSpecId: entry.catalogSpecId, record });
});

router.get("/model-metrics/specifications/:id", (req: Request, res: Response) => {
  const spec = getModelById(String(req.params.id));
  if (!spec) return res.status(404).json({ error: `no specification ${req.params.id}` });
  if (!spec.metricsRecord) return res.status(404).json({ error: `specification ${spec.id} carries no metrics record` });
  res.json({ id: spec.id, name: spec.name, record: spec.metricsRecord });
});

router.get("/model-metrics/coverage", (_req: Request, res: Response) => {
  const metricLoad = loadMetricRegistry();
  const cycleLoad = loadCycleRegistry();
  if (!metricLoad.registry || !metricLoad.index) return res.status(500).json({ error: `metric registry is invalid: ${metricLoad.problems.join("; ")}` });
  if (!cycleLoad.registry) return res.status(500).json({ error: `Model Cycle registry is invalid: ${cycleLoad.problems.join("; ")}` });

  const count = (counts: Record<string, number>, key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  const specifications = getCatalogModels({ includeEmpty: true }).models.filter((spec) => spec.relativePath.endsWith(".md") && !spec.relativePath.startsWith("Analytical/"));
  const nativeProfiles: Record<string, number> = {};
  const primaryAvailability: Record<string, number> = {};
  let specificationsWithRecord = 0;
  for (const spec of specifications) {
    const record = spec.metricsRecord;
    if (!record) continue;
    specificationsWithRecord += 1;
    count(nativeProfiles, record.profileIdNative);
    for (const row of record.native.metrics) if (row.role === "primary") count(primaryAvailability, row.availability);
  }
  const models = Object.values(cycleLoad.registry.models);
  const asRunProfiles: Record<string, number> = {};
  const fidelity: Record<string, number> = {};
  const probabilitySource: Record<string, number> = {};
  let modelsWithRecord = 0;
  for (const entry of models) {
    modelsWithRecord += 1;
    count(asRunProfiles, entry.metrics.profileIdAsRun);
    count(fidelity, entry.metrics.asRun.faithfulToSpecification);
    count(probabilitySource, entry.metrics.asRun.probabilitySource);
  }
  res.json({
    specificationCount: specifications.length,
    specificationsWithRecord,
    modelCount: models.length,
    modelsWithRecord,
    nativeProfiles,
    asRunProfiles,
    fidelity,
    probabilitySource,
    /** Primary native metrics across every specification, by whether the dashboard computes them today. */
    primaryAvailability,
    problems: crossCheckCycleRegistryMetrics(cycleLoad.registry, metricLoad.index),
  });
});

export default router;
