/**
 * The metric registry (`packages/config/metric_registry.json`) as the server
 * reads it: metric types, every metric with its definition, the training
 * objectives and the evaluation profiles that a model's `metrics` record names
 * by id. Cached until the file changes. Never throws: an unreadable or invalid
 * file comes back as `problems` with `registry: null`.
 */
import fs from "fs";
import path from "path";

import { indexMetricRegistry, metricRegistrySchema, type MetricRegistry, type MetricRegistryIndex } from "@shared/cycle/metrics";

export const METRIC_REGISTRY_FILE = path.join(process.cwd(), "packages", "config", "metric_registry.json");

export interface MetricRegistryLoad {
  registry: MetricRegistry | null;
  index: MetricRegistryIndex | null;
  problems: string[];
  /** The file's modification time the load was read at. */
  signature: number;
}

let cached: MetricRegistryLoad | null = null;

export function loadMetricRegistry(file: string = METRIC_REGISTRY_FILE): MetricRegistryLoad {
  let signature = -1;
  try {
    signature = fs.statSync(file).mtimeMs;
  } catch {
    return { registry: null, index: null, problems: [`metric registry not found: ${file}`], signature };
  }
  if (cached && cached.signature === signature && file === METRIC_REGISTRY_FILE) return cached;
  let load: MetricRegistryLoad;
  try {
    const parsed = metricRegistrySchema.safeParse(JSON.parse(fs.readFileSync(file, "utf-8")));
    load = parsed.success
      ? { registry: parsed.data, index: indexMetricRegistry(parsed.data), problems: [], signature }
      : { registry: null, index: null, problems: parsed.error.issues.slice(0, 20).map((issue) => `${issue.path.join(".")}: ${issue.message}`), signature };
  } catch (error) {
    load = { registry: null, index: null, problems: [(error as Error).message], signature };
  }
  if (file === METRIC_REGISTRY_FILE) cached = load;
  return load;
}
