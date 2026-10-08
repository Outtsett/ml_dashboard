/**
 * The catalog explainers (`packages/config/model_explainers/*.json`): every
 * file satisfies `modelExplainerSchema` (plain words, no formulas, no decimal
 * numbers) and is named after the specification it explains.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { modelExplainerSchema } from "@shared/modelExplainer";

const DIRECTORY = path.resolve(__dirname, "../../packages/config/model_explainers");
const files = readdirSync(DIRECTORY).filter((name) => name.endsWith(".json"));

describe("catalog explainers", () => {
  it("covers the written specifications", () => {
    expect(files.length).toBeGreaterThanOrEqual(300);
  });

  it("every file satisfies the schema and is named after its specification", () => {
    const problems: string[] = [];
    for (const name of files) {
      const parsed = modelExplainerSchema.safeParse(JSON.parse(readFileSync(path.join(DIRECTORY, name), "utf-8")));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        problems.push(`${name}: ${issue?.path.join(".")}: ${issue?.message}`);
      } else if (`${parsed.data.specificationId}.json` !== name) {
        problems.push(`${name}: specificationId is "${parsed.data.specificationId}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("rejects a decimal number and a formula", () => {
    const sample = JSON.parse(readFileSync(path.join(DIRECTORY, files[0]!), "utf-8"));
    const withDecimal = { ...sample, analogy: "Think of it as a desk that puts a 0.58 probability on every bar it reads." };
    const withFormula = { ...sample, analogy: "Think of it as a desk that computes $x^2$ for every bar it is handed." };
    expect(modelExplainerSchema.safeParse(sample).success).toBe(true);
    expect(modelExplainerSchema.safeParse(withDecimal).success).toBe(false);
    expect(modelExplainerSchema.safeParse(withFormula).success).toBe(false);
  });
});
