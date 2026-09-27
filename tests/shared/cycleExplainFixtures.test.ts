/**
 * The Python explainer's replies against the zod contract (`src/shared/cycle/explain.ts`).
 *
 * `tests/fixtures/cycle_explain/*.json` are real replies of the explainer core
 * (`src/ml/cycle/explain/`) on the synthetic runs of `tests/test_cycle_explain_core.py`
 * (regenerate with `CYCLE_EXPLAIN_WRITE_FIXTURES=1` on that test). Python cannot
 * load zod, so this is where its output meets the schemas the server validates
 * replies with: each file must parse, and the identities the core promises must hold.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";

import {
  cycleExplainBarSchema,
  cycleExplainerReadySchema,
  cycleExplainerReplySchema,
  cycleExplainerRequestSchema,
  cycleExplainManifestSchema,
  cycleExplainStructureSchema,
  type CycleExplainBar,
} from "@shared/cycle/explain";

const FIXTURES = path.resolve(__dirname, "..", "fixtures", "cycle_explain");

/** Fixture file name prefix -> the schema it must pass. */
const SCHEMA_BY_PREFIX: [string, ZodTypeAny][] = [
  ["manifest", cycleExplainManifestSchema],
  ["structure_", cycleExplainStructureSchema],
  ["bar_", cycleExplainBarSchema],
  ["ready", cycleExplainerReadySchema],
  ["request_", cycleExplainerRequestSchema],
  ["reply_", cycleExplainerReplySchema],
];

const files = readdirSync(FIXTURES)
  .filter((name) => name.endsWith(".json"))
  .sort();

function read(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf-8"));
}

function schemaFor(name: string): ZodTypeAny | undefined {
  return SCHEMA_BY_PREFIX.find(([prefix]) => name.startsWith(prefix))?.[1];
}

function bar(name: string): CycleExplainBar {
  return cycleExplainBarSchema.parse(read(name));
}

describe("cycle explainer fixtures", () => {
  it("has one of every reply shape the core makes", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "structure_direction.json",
        "structure_price.json",
        "bar_direction.json",
        "bar_price.json",
        "bar_window.json",
        "ready.json",
        "reply_ok.json",
        "reply_error.json",
        "request_ping.json",
        "request_structure.json",
        "request_explain.json",
        "request_releaseRun.json",
        "request_exit.json",
      ]),
    );
  });

  it.each(files)("%s passes its schema", (name) => {
    const schema = schemaFor(name);
    expect(schema, `no schema for ${name}`).toBeDefined();
    const result = schema!.safeParse(read(name));
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it.each(files)("%s carries no NaN or Infinity", (name) => {
    const text = readFileSync(path.join(FIXTURES, name), "utf-8");
    expect(text).not.toMatch(/NaN|Infinity/);
  });

  it("the manifest has a readiness per fold and role", () => {
    const manifest = cycleExplainManifestSchema.parse(read("manifest.json"));
    expect(manifest.available).toBe(true);
    expect(manifest.featureDisplayNames).toHaveLength(manifest.featureNames.length);
    for (const fold of manifest.folds) {
      expect(fold.testEnd).toBeGreaterThanOrEqual(fold.testStart);
      expect(fold.direction).toBe("ready");
      expect(fold.price).toBe("ready");
    }
  });

  it("the direction bar's output is the probability the engine streamed", () => {
    const direction = bar("bar_direction.json");
    const probability = direction.output.probabilityUp!;
    expect(direction.link).toBe("logistic");
    expect(direction.engineReload).toBe(probability);
    expect(direction.streamed).toBe(probability);
    // raw is the log-odds: the logistic link gives the probability back
    expect(1 / (1 + Math.exp(-direction.output.raw))).toBeCloseTo(probability, 12);
    expect(direction.inputs.values).toHaveLength(direction.inputs.raw.length);
    for (const percentile of direction.inputs.trainingPercentile) {
      if (percentile === null) continue;
      expect(percentile).toBeGreaterThanOrEqual(0);
      expect(percentile).toBeLessThanOrEqual(1);
    }
  });

  it("the price bar turns target units into points and a predicted close", () => {
    const price = bar("bar_price.json");
    const output = price.output;
    expect(price.link).toBe("identity");
    expect(output.probabilityUp).toBeNull();
    expect(output.targetUnits).toBe(price.engineReload);
    expect(output.movePoints!).toBeCloseTo(output.targetUnits! * output.scale!, 9);
    expect(output.predictedClose!).toBeCloseTo(output.close + output.movePoints!, 9);
  });

  it("a sequence model's window ends at the bar and holds one row per bar read", () => {
    const windowed = bar("bar_window.json");
    const window = windowed.inputs.window!;
    expect(window.timestamps.at(-1)).toBe(windowed.timestamp);
    expect(window.values).toHaveLength(window.timestamps.length);
    for (const row of window.values) expect(row).toHaveLength(windowed.inputs.values.length);
    expect(window.values.at(-1)).toEqual(windowed.inputs.values);
  });

  it("the core leaves every kind-specific block empty", () => {
    for (const name of ["bar_direction.json", "bar_price.json", "bar_window.json"]) {
      const reply = bar(name);
      for (const block of ["trees", "contributions", "neighbors", "supportVectors", "calibration", "stacking", "neural"] as const) {
        expect(reply[block], `${name} ${block}`).toBeNull();
      }
    }
    for (const name of ["structure_direction.json", "structure_price.json"]) {
      const structure = cycleExplainStructureSchema.parse(read(name));
      for (const block of ["trees", "linear", "neighbors", "naiveBayes", "supportVectors", "calibration", "stacking", "neural"] as const) {
        expect(structure[block], `${name} ${block}`).toBeNull();
      }
    }
  });
});
