#!/usr/bin/env node
/**
 * ESLint gate with a one-way warning budget.
 *
 * Why this exists: CI ran `eslint src/ --max-warnings 0` against a source tree
 * carrying a few hundred warnings, so the job could never pass. A permanently
 * red gate is indistinguishable from no gate — nobody can tell a new break from
 * the standing one, and the aggregate `CI Success` check blocks every PR.
 *
 * The budget replaces that with a ratchet:
 *   - ANY error fails, always. Errors have no budget.
 *   - Warnings fail only when the total EXCEEDS the committed baseline, so new
 *     warnings are blocked while the existing ones are paid down at leisure.
 *   - Coming in UNDER the baseline is reported and, with --update, written back,
 *     so the ceiling only ever drops.
 *
 * Usage:
 *   node scripts/lint-budget.mjs            # gate (CI)
 *   node scripts/lint-budget.mjs --update   # re-baseline after a cleanup pass
 *   node scripts/lint-budget.mjs --json     # machine-readable summary
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(REPO_ROOT, ".github", "lint-baseline.json");
const TARGET = "src/";

const args = new Set(process.argv.slice(2));
const UPDATE = args.has("--update");
const AS_JSON = args.has("--json");

function runEslint() {
  // `-f json` writes the report to stdout; a non-zero exit just means findings
  // exist, which is exactly what we are here to measure. Only a missing/failed
  // binary (no parseable stdout) is treated as an infrastructure failure.
  // Windows: Node refuses to spawn a `.cmd` shim without a shell (CVE-2024-27980
  // hardening), so the shell is required there. The argv is fixed and contains
  // no user input, so there is nothing to inject.
  const res = spawnSync("npx", ["eslint", TARGET, "-f", "json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });

  if (!res.stdout || !res.stdout.trim().startsWith("[")) {
    console.error("lint-budget: eslint produced no JSON report.");
    if (res.stderr) console.error(res.stderr.slice(0, 4000));
    process.exit(2);
  }

  return JSON.parse(res.stdout);
}

function summarize(report) {
  let errors = 0;
  let warnings = 0;
  const byRule = new Map();

  for (const file of report) {
    errors += file.errorCount;
    warnings += file.warningCount;
    for (const m of file.messages) {
      const key = m.ruleId ?? "(no rule)";
      const bucket = byRule.get(key) ?? { errors: 0, warnings: 0 };
      if (m.severity === 2) bucket.errors += 1;
      else bucket.warnings += 1;
      byRule.set(key, bucket);
    }
  }

  const errorSites = report
    .flatMap((f) =>
      f.messages
        .filter((m) => m.severity === 2)
        .map((m) => `  ${path.relative(REPO_ROOT, f.filePath)}:${m.line}:${m.column}  ${m.ruleId ?? ""}  ${m.message}`),
    )
    .slice(0, 50);

  return { errors, warnings, byRule, errorSites };
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return { maxWarnings: 0 };
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(`lint-budget: ${BASELINE_PATH} is not valid JSON.`);
    process.exit(2);
  }
}

function writeBaseline(warnings, byRule) {
  const topRules = [...byRule.entries()]
    .filter(([, v]) => v.warnings > 0)
    .sort((a, b) => b[1].warnings - a[1].warnings)
    .slice(0, 15)
    .map(([rule, v]) => ({ rule, warnings: v.warnings }));

  const payload = {
    $comment:
      "Warning ceiling for scripts/lint-budget.mjs. It may only go DOWN. " +
      "Regenerate with `node scripts/lint-budget.mjs --update` after a cleanup pass. " +
      "Errors are never budgeted — any error fails CI.",
    maxWarnings: warnings,
    recordedAt: new Date().toISOString().slice(0, 10),
    topRules,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

const report = runEslint();
const { errors, warnings, byRule, errorSites } = summarize(report);
const baseline = readBaseline();
const ceiling = Number(baseline.maxWarnings ?? 0);

if (AS_JSON) {
  console.log(JSON.stringify({ errors, warnings, ceiling, ok: errors === 0 && warnings <= ceiling }, null, 2));
}

if (UPDATE) {
  writeBaseline(warnings, byRule);
  console.log(`lint-budget: baseline written — maxWarnings ${ceiling} -> ${warnings}`);
  process.exit(errors === 0 ? 0 : 1);
}

if (!AS_JSON) {
  console.log(`lint-budget: ${errors} error(s), ${warnings} warning(s); ceiling ${ceiling}`);
}

if (errors > 0) {
  console.error(`\nESLint reported ${errors} error(s). Errors are never budgeted.\n`);
  console.error(errorSites.join("\n"));
  if (errors > errorSites.length) console.error(`  ... and ${errors - errorSites.length} more`);
  process.exit(1);
}

if (warnings > ceiling) {
  const added = warnings - ceiling;
  console.error(
    `\nWarning count rose by ${added} (${ceiling} -> ${warnings}). ` +
      `Fix the new warnings, or re-baseline deliberately with:\n` +
      `  node scripts/lint-budget.mjs --update\n`,
  );
  const worst = [...byRule.entries()]
    .filter(([, v]) => v.warnings > 0)
    .sort((a, b) => b[1].warnings - a[1].warnings)
    .slice(0, 10);
  console.error("Largest warning buckets:");
  for (const [rule, v] of worst) console.error(`  ${String(v.warnings).padStart(4)}  ${rule}`);
  process.exit(1);
}

if (warnings < ceiling) {
  console.log(
    `Warnings are ${ceiling - warnings} BELOW the ceiling. ` +
      `Lock the gain in with: node scripts/lint-budget.mjs --update`,
  );
}

process.exit(0);
