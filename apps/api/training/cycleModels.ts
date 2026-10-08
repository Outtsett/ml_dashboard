/**
 * The Model Cycle's model registry (`packages/config/cycle_models/*.json`), loaded
 * and validated on the server.
 *
 * Every file is parsed with its zod schema from `@shared/cycle/models`
 * (`_cycle.json` with `cycleSharedRegistrySchema`, every other file with
 * `cycleModelFileSchema`), then the whole registry goes through
 * `crossCheckCycleRegistry`. Python reads the same folder through
 * `packages/ml-engine/src/cycle/catalog.py`; both must accept the real registry and reject
 * every mutation in `tests/fixtures/cycle_models_invalid/`.
 *
 * The folder is re-read when a file's mtime, or the set of files, changes —
 * the same rule `registry.ts` applies to `runners.json` — so editing a
 * registry file shows up on the next request without a restart. An invalid
 * registry is never half-loaded: `loadCycleRegistry` returns its problems and
 * no registry.
 */

import fs from "fs";
import path from "path";

import {
  crossCheckCycleRegistry,
  crossCheckCycleRegistryMetrics,
  cycleModelFileSchema,
  cycleSharedRegistrySchema,
  type CycleModelEntry,
  type CycleRegistry,
  type CycleSharedRegistry,
} from "@shared/cycle/models";

import { loadMetricRegistry } from "../ml/metricRegistry";

export const CYCLE_MODELS_DIR = path.join(process.cwd(), "packages", "config", "cycle_models");
export const CYCLE_SHARED_FILE = "_cycle.json";

/** A load's outcome: the registry when every check passed, else null and the reasons. */
export interface CycleRegistryLoad {
  registry: CycleRegistry | null;
  problems: string[];
  /** File names and mtimes the load was read from; changes when any file does. */
  signature: string;
}

/**
 * Validate already-parsed registry documents, keyed by file name. Pure: the
 * loader and the tests (which apply the invalid-fixture mutations in memory)
 * share it. Model files are read in name order, so a duplicate key is
 * reported against the later file.
 */
export function validateCycleRegistryFiles(files: Record<string, unknown>): Omit<CycleRegistryLoad, "signature"> {
  if (!(CYCLE_SHARED_FILE in files)) return { registry: null, problems: [`${CYCLE_SHARED_FILE} is missing`] };
  const shared = cycleSharedRegistrySchema.safeParse(files[CYCLE_SHARED_FILE]);
  if (!shared.success) return { registry: null, problems: [`${CYCLE_SHARED_FILE}: ${shared.error.message}`] };

  const problems: string[] = [];
  const registry: CycleRegistry = { shared: shared.data, models: {}, files: {} };
  for (const name of Object.keys(files).sort()) {
    if (name === CYCLE_SHARED_FILE) continue;
    const parsed = cycleModelFileSchema.safeParse(files[name]);
    if (!parsed.success) {
      problems.push(`${name}: ${parsed.error.message}`);
      continue;
    }
    for (const [key, entry] of Object.entries(parsed.data.models)) {
      if (key in registry.models) problems.push(`${name}: ${key} is also defined in ${registry.files[key]}`);
      registry.models[key] = entry as CycleModelEntry;
      registry.files[key] = name;
    }
  }
  problems.push(...crossCheckCycleRegistry(registry));
  // every model's metrics record names its metrics, objectives and profiles from the metric registry
  const metricRegistry = loadMetricRegistry();
  if (metricRegistry.index) problems.push(...crossCheckCycleRegistryMetrics(registry, metricRegistry.index));
  else problems.push(...metricRegistry.problems.map((problem) => `metric_registry.json: ${problem}`));
  return problems.length > 0 ? { registry: null, problems } : { registry, problems: [] };
}

function registryFileNames(directory: string): string[] {
  return fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
}

function signatureOf(directory: string): string {
  try {
    return registryFileNames(directory)
      .map((name) => `${name}:${fs.statSync(path.join(directory, name)).mtimeMs}`)
      .join("|");
  } catch {
    return "";
  }
}

function readAndValidate(directory: string, signature: string): CycleRegistryLoad {
  if (!fs.existsSync(directory)) return { registry: null, problems: [`registry folder not found: ${directory}`], signature };
  const files: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const name of registryFileNames(directory)) {
    try {
      files[name] = JSON.parse(fs.readFileSync(path.join(directory, name), "utf-8"));
    } catch (error) {
      problems.push(`${name}: ${(error as Error).message}`);
    }
  }
  if (problems.length > 0) return { registry: null, problems, signature };
  return { ...validateCycleRegistryFiles(files), signature };
}

const loads = new Map<string, CycleRegistryLoad>();

/**
 * The registry in `directory` (default `packages/config/cycle_models`), cached
 * until a file in it changes. Never throws: a missing folder, unreadable JSON
 * or a failed check comes back as `problems` with `registry: null`.
 */
export function loadCycleRegistry(directory: string = CYCLE_MODELS_DIR): CycleRegistryLoad {
  const signature = signatureOf(directory);
  const cached = loads.get(directory);
  if (cached && cached.signature === signature) return cached;
  const load = readAndValidate(directory, signature);
  loads.set(directory, load);
  return load;
}

/** The registry, or an error naming every problem. */
export function getCycleRegistry(directory: string = CYCLE_MODELS_DIR): CycleRegistry {
  const load = loadCycleRegistry(directory);
  if (!load.registry) throw new Error(`Model Cycle registry is invalid: ${load.problems.join("; ")}`);
  return load.registry;
}

/** Drop every cached load (tests; `reloadConfigs`). */
export function resetCycleRegistryCache(): void {
  loads.clear();
}

/**
 * Why a catalog spec with no registry entry cannot run in the Cycle — the
 * TypeScript twin of `catalog.unavailable_reason` in `packages/ml-engine/src/cycle/catalog.py`.
 * The most specific reason wins: the spec's own, then its
 * `<category>/<subcategory>`, then its category, then "Not built for the
 * Cycle yet."
 */
export function cycleUnavailableReason(shared: CycleSharedRegistry, specId: string, category: string, subcategory: string): string {
  if (specId in shared.unavailableBySpec) return shared.unavailableBySpec[specId]!;
  const bySubcategory = shared.unavailableBySubcategory[`${category}/${subcategory}`];
  if (bySubcategory) return bySubcategory;
  return shared.unavailableByCategory[category] ?? "Not built for the Cycle yet.";
}
