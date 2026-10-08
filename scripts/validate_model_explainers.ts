/**
 * Validates the catalog explainers in `packages/config/model_explainers/`
 * against `modelExplainerSchema`.
 *
 *   npx tsx scripts/validate_model_explainers.ts            every file
 *   npx tsx scripts/validate_model_explainers.ts <id> ...   the named specifications
 *
 * Exits 1 when a file is missing, is not JSON, fails the schema, or carries
 * a `specificationId` other than its file name.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as explainerModule from "../packages/shared/src/modelExplainer";

// The shared package is loaded as CommonJS under tsx, where a named import does not resolve.
const { modelExplainerSchema } = ((explainerModule as { default?: typeof explainerModule }).default ?? explainerModule);

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../packages/config/model_explainers");

const requested = process.argv.slice(2);
const identifiers =
  requested.length > 0
    ? requested
    : readdirSync(directory)
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length));

const report = (line: string) => process.stdout.write(`${line}
`);

let failures = 0;
for (const identifier of identifiers) {
  const file = path.join(directory, `${identifier}.json`);
  if (!existsSync(file)) {
    report(`MISSING ${identifier}`);
    failures += 1;
    continue;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8"));
  } catch (error) {
    report(`NOT JSON ${identifier}: ${(error as Error).message}`);
    failures += 1;
    continue;
  }
  const result = modelExplainerSchema.safeParse(parsed);
  if (!result.success) {
    failures += 1;
    for (const issue of result.error.issues) report(`INVALID ${identifier}: ${issue.path.join(".")}: ${issue.message}`);
    continue;
  }
  if (result.data.specificationId !== identifier) {
    failures += 1;
    report(`INVALID ${identifier}: specificationId "${result.data.specificationId}" is not the file name`);
  }
}

report(`${identifiers.length - failures} of ${identifiers.length} explainers valid`);
process.exit(failures > 0 ? 1 : 0);
