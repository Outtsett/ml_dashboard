/**
 * Regenerate `tests/fixtures/cycle_runners_legacy.json`: the runner and model
 * blocks the Model Cycle composes for the eight legacy families, as JSON.
 *
 * The fixture pins the composed shape so a registry migration cannot change
 * a legacy runner unnoticed. When the shape changes ON PURPOSE (2026-09-26:
 * `search` blocks travel with each parameter, the Tuning group became mode +
 * budget), re-record it with this script and say so in the commit.
 *
 *   npx tsx scripts/regenerate_cycle_runner_fixture.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AlgorithmRegistry, TaskRegistry } from "@shared/trainingTypes";
import { getCycleRegistry } from "../src/server/training/cycleModels";
import { composeCycleRunners, cycleRunnerKey } from "../src/server/training/cycleRunners";
import { composeEntry, reloadConfigs } from "../src/server/training/registry";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(ROOT, "src", "config");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "cycle_runners_legacy.json");

reloadConfigs();
const registry = getCycleRegistry();
const algorithms = (JSON.parse(fs.readFileSync(path.join(CONFIG, "algorithms.json"), "utf-8")) as AlgorithmRegistry).algorithms;
const tasks = (JSON.parse(fs.readFileSync(path.join(CONFIG, "tasks.json"), "utf-8")) as TaskRegistry).tasks;
const composed = composeCycleRunners(registry, algorithms, tasks[registry.shared.task]!, composeEntry);

const previous = JSON.parse(fs.readFileSync(FIXTURE, "utf-8")) as { note?: string; runners: Record<string, unknown>; models: Record<string, unknown> };
const legacyKeys = Object.entries(registry.models).filter(([, entry]) => entry.adapter === "legacy").map(([key]) => key);
const runners: Record<string, unknown> = {};
const models: Record<string, unknown> = {};
for (const key of legacyKeys) {
  const runnerKey = cycleRunnerKey(key);
  runners[runnerKey] = JSON.parse(JSON.stringify(composed.runners[runnerKey]));
  models[runnerKey] = JSON.parse(JSON.stringify(composed.models[runnerKey]));
}
const missing = Object.keys(previous.runners).filter((key) => !(key in runners));
if (missing.length) throw new Error(`legacy runner(s) vanished from the registry: ${missing.join(", ")}`);
fs.writeFileSync(FIXTURE, `${JSON.stringify({ runners, models }, null, 2)}\n`, "utf-8");
console.log(`wrote ${FIXTURE}: ${Object.keys(runners).length} legacy runners`);
