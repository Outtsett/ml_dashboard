/**
 * The Model Cycle registry contract, TypeScript side (`packages/shared/src/cycle/models.ts`).
 * Held to the same fixtures as `tests/test_cycle_catalog_contract.py`: accept the
 * real registry, reject every case in `tests/fixtures/cycle_models_invalid/`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  crossCheckCycleRegistry,
  cycleModelFileSchema,
  cycleSharedRegistrySchema,
  type CycleModelEntry,
  type CycleRegistry,
} from "@shared/cycle/models";

const ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY = path.join(ROOT, "packages", "config", "cycle_models");
const INVALID = path.join(ROOT, "tests", "fixtures", "cycle_models_invalid");

type Files = Record<string, Record<string, unknown>>;

function readFiles(): Files {
  const files: Files = {};
  for (const name of readdirSync(REGISTRY).filter((file) => file.endsWith(".json")).sort()) {
    files[name] = JSON.parse(readFileSync(path.join(REGISTRY, name), "utf-8"));
  }
  return files;
}

/** Parse every file and run the cross-file checks; returns the problems (empty = valid). */
function validate(files: Files): string[] {
  const problems: string[] = [];
  const shared = cycleSharedRegistrySchema.safeParse(files["_cycle.json"]);
  if (!shared.success) return [`_cycle.json: ${shared.error.message}`];
  const registry: CycleRegistry = { shared: shared.data, models: {}, files: {} };
  for (const [name, document] of Object.entries(files)) {
    if (name === "_cycle.json") continue;
    const parsed = cycleModelFileSchema.safeParse(document);
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
  return [...problems, ...crossCheckCycleRegistry(registry)];
}

type Operation =
  | { op: "set"; file: string; path: string[]; value: unknown }
  | { op: "delete"; file: string; path: string[] }
  | { op: "copy"; fromFile: string; fromPath: string[]; toFile: string; toPath: string[] };

function parentOf(document: unknown, keys: string[]): Record<string, unknown> {
  let node = document as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
  return node;
}

function apply(files: Files, operations: Operation[]): Files {
  const next = structuredClone(files);
  for (const operation of operations) {
    if (operation.op === "set") parentOf(next[operation.file], operation.path)[operation.path.at(-1)!] = operation.value;
    else if (operation.op === "delete") delete parentOf(next[operation.file], operation.path)[operation.path.at(-1)!];
    else {
      const value = structuredClone(parentOf(next[operation.fromFile], operation.fromPath)[operation.fromPath.at(-1)!]);
      parentOf(next[operation.toFile], operation.toPath)[operation.toPath.at(-1)!] = value;
    }
  }
  return next;
}

describe("Model Cycle registry contract", () => {
  it("accepts the real registry", () => {
    expect(validate(readFiles())).toEqual([]);
  });

  const cases = readdirSync(INVALID).filter((file) => file.endsWith(".json")).sort();

  it("has invalid fixtures to reject", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of cases) {
    it(`rejects ${file.replace(/\.json$/, "")}`, () => {
      const fixture = JSON.parse(readFileSync(path.join(INVALID, file), "utf-8")) as { operations: Operation[] };
      expect(validate(apply(readFiles(), fixture.operations)).length).toBeGreaterThan(0);
    });
  }
});
