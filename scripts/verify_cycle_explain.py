"""Check "Inside the model" against a finished Model Cycle run.

    .venv/Scripts/python.exe scripts/verify_cycle_explain.py --model-id <id> [--bars 50] [--seed 0]
    .venv/Scripts/python.exe scripts/verify_cycle_explain.py --run-directory <path> ...

For every fold and role whose model is on disk, it explains the fold's
structure and a random sample of its test bars in-process (the same code the
explainer process runs, ``cycle.explain.server.Explainer``) and checks the
parity gates of ``packages/shared/src/cycle/explain.ts``:

    G1  the reloaded adapter's prediction equals what the engine streamed to
        predictions.parquet: 1e-12 for CPU libraries, 1e-6 torch on CPU, 1e-4
        torch when the run's device was cuda
    G2 / G3 / G4  whatever the model's kind module checks (its ``check`` hook);
        none while the kind has no module

Every reply is also checked against the zod schemas themselves (node + tsx
load ``packages/shared/src/cycle/explain.ts``); ``--no-schema`` skips that. With
``--write-fixtures DIR`` the first reply of each shape is written there as JSON
(the samples ``tests/shared/cycleExplainFixtures.test.ts`` parses).

Exit code 0 when every gate that ran passed and every reply is schema-valid,
1 otherwise. ``--json`` prints the summary as one JSON object.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[1]
_ML_ROOT = REPOSITORY / "src" / "ml"
if str(_ML_ROOT) not in sys.path:
    sys.path.insert(0, str(_ML_ROOT))
if str(REPOSITORY) not in sys.path:
    sys.path.append(str(REPOSITORY))

import numpy as np  # noqa: E402

from cycle.explain import ExplainError, artifacts  # noqa: E402
from cycle.explain.common import gate_g1, kind_checks  # noqa: E402
from cycle.explain.server import Explainer, encode  # noqa: E402

EXPLAIN_SCHEMA = REPOSITORY / "src" / "shared" / "cycle" / "explain.ts"

# Validates {kind, value} lines with the explain.ts schemas; prints {counts, failures}.
ZOD_SCRIPT = r"""
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const schemas = await import(pathToFileURL(process.argv[2]).href);
const byKind = {
  manifest: schemas.cycleExplainManifestSchema,
  structure: schemas.cycleExplainStructureSchema,
  tree: schemas.cycleExplainTreeSchema,
  bar: schemas.cycleExplainBarSchema,
  ready: schemas.cycleExplainerReadySchema,
  request: schemas.cycleExplainerRequestSchema,
  reply: schemas.cycleExplainerReplySchema,
};
const counts = {};
const failures = [];
for (const line of readFileSync(process.argv[3], "utf8").split("\n")) {
  if (!line) continue;
  const { kind, label, value } = JSON.parse(line);
  const schema = byKind[kind];
  if (!schema) { failures.push({ kind, label, issues: ["no schema for this kind"] }); continue; }
  counts[kind] = (counts[kind] ?? 0) + 1;
  const result = schema.safeParse(value);
  if (!result.success && failures.length < 20) failures.push({ kind, label, issues: result.error.issues.slice(0, 5) });
}
console.log(JSON.stringify({ counts, failures }));
"""


def zod_validate(samples: list[tuple[str, str, object]], work_directory: Path | None = None) -> dict | None:
    """Parse (kind, label, value) samples with the zod schemas. None when node or tsx is unavailable."""
    node = shutil.which("node")
    if node is None or not (REPOSITORY / "node_modules" / "tsx").exists():
        return None
    owned = work_directory is None
    folder = Path(tempfile.mkdtemp(prefix="cycle_explain_zod_")) if owned else work_directory
    folder.mkdir(parents=True, exist_ok=True)
    script = folder / "validate_cycle_explain.mjs"
    script.write_text(ZOD_SCRIPT, encoding="utf-8")
    lines = folder / "samples.jsonl"
    lines.write_text("".join(json.dumps({"kind": kind, "label": label, "value": value}, allow_nan=False) + "\n"
                             for kind, label, value in samples), encoding="utf-8")
    completed = subprocess.run([node, "--import", "tsx", str(script), str(EXPLAIN_SCHEMA), str(lines)], cwd=REPOSITORY,
                               capture_output=True, text=True, timeout=180)
    if completed.returncode != 0:
        return {"counts": {}, "failures": [{"kind": "node", "label": "node exited", "issues": [completed.stderr[-2000:]]}]}
    return json.loads(completed.stdout.strip().splitlines()[-1])


def verify_run(run_directory: str | Path, *, bars: int = 50, seed: int = 0, explainer: Explainer | None = None,
               fixtures: Path | None = None, schema: bool = True) -> dict:
    """Explain a run and check the gates; returns the summary (see ``main``)."""
    run = Path(run_directory)
    explainer = explainer or Explainer()
    generator = np.random.default_rng(seed)
    manifest = explainer.manifest(str(run))
    samples: list[tuple[str, str, object]] = [("manifest", "manifest", manifest)]
    summary: dict = {"runDirectory": str(run), "modelId": manifest["modelId"], "modelKey": manifest["modelKey"],
                     "available": manifest["available"], "folds": [], "gates": {}, "failures": [], "errors": []}
    if not manifest["available"]:
        summary["errors"].append(manifest["reason"])
        summary["passed"] = False
        return summary
    plan_device = artifacts.read_run_settings(run).get("device")
    summary["planDevice"] = plan_device
    arrays = explainer.run_arrays(str(run))
    # the engine asks the price model for no forecast at a bar whose horizon crosses a session gap:
    # such a bar has nothing streamed to hold the reload against, so it is not sampled for the price role
    streamed = artifacts.load_streamed(run, arrays.timestamps)
    for fold in manifest["folds"]:
        k = fold["foldIndex"]
        for role in ("direction", "price"):
            status = fold[role]
            record = {"foldIndex": k, "role": role, "status": status, "barsExplained": 0, "barsRefused": 0}
            summary["folds"].append(record)
            if status != "ready":
                continue
            try:
                structure = explainer.structure(str(run), k, role)
            except ExplainError as error:
                summary["errors"].append(f"fold {k} {role} structure: {error}")
                continue
            samples.append(("structure", f"fold {k} {role}", structure))
            context = explainer.context(str(run), k, role)
            test_rows = artifacts.load_fold_index(run, k)["test"]
            candidates = [int(row) for row in test_rows if context.valid(int(row))
                          and (role != "price" or streamed is None or streamed.predicted_move_points.get(int(row)) is not None)]
            record["barsWithoutForecast"] = sum(
                1 for row in test_rows if context.valid(int(row)) and int(row) not in set(candidates)) if role == "price" else 0
            chosen = sorted(generator.choice(candidates, size=min(bars, len(candidates)), replace=False).tolist()) \
                if candidates else []
            for row in chosen:
                timestamp = int(arrays.timestamps[row])
                try:
                    bar = explainer.explain(str(run), k, role, timestamp)
                except ExplainError as error:
                    record["barsRefused"] += 1
                    summary["errors"].append(f"fold {k} {role} bar {timestamp}: {error}")
                    continue
                encode({"id": "check", "ok": True, "result": bar})     # raises on NaN
                record["barsExplained"] += 1
                samples.append(("bar", f"fold {k} {role} {timestamp}", bar))
                for gate in [gate_g1(context, bar, plan_device), *kind_checks(context, row, bar)]:
                    name = gate.get("gate", "kind")
                    tally = summary["gates"].setdefault(name, {"passed": 0, "failed": 0, "skipped": 0, "maximumError": None})
                    if gate.get("passed") is None:
                        tally["skipped"] += 1
                        continue
                    tally["passed" if gate["passed"] else "failed"] += 1
                    error = gate.get("error")
                    if error is not None:
                        tally["maximumError"] = error if tally["maximumError"] is None else max(tally["maximumError"], error)
                    if not gate["passed"] and len(summary["failures"]) < 20:
                        summary["failures"].append({"foldIndex": k, "role": role, "timestamp": timestamp, **gate})
    if fixtures is not None:
        write_fixtures(fixtures, samples)
    schema_result = zod_validate(samples) if schema else None
    summary["schema"] = None if schema_result is None else {
        "counts": schema_result["counts"], "failures": schema_result["failures"]}
    gates_ok = all(tally["failed"] == 0 for tally in summary["gates"].values())
    schema_ok = schema_result is None or not schema_result["failures"]
    summary["passed"] = gates_ok and schema_ok and not summary["errors"]
    return summary


def write_fixtures(directory: Path, samples: list[tuple[str, str, object]]) -> list[Path]:
    """The first manifest, and the first structure and bar of each role, as ``<kind>_<role>.json``."""
    directory.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    seen: set[str] = set()
    for kind, _, value in samples:
        role = value.get("role") if isinstance(value, dict) else None
        name = f"{kind}_{role}" if role else kind
        if name in seen:
            continue
        seen.add(name)
        path = directory / f"{name}.json"
        path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        written.append(path)
    return written


def _print_summary(summary: dict) -> None:
    print(f"run {summary['modelId']} ({summary['modelKey']}), plan device {summary.get('planDevice')}")
    for record in summary["folds"]:
        print(f"  fold {record['foldIndex'] + 1} {record['role']:<9} {record['status']:<8} "
              f"{record['barsExplained']} bars explained, {record['barsRefused']} refused")
    for name, tally in sorted(summary["gates"].items()):
        print(f"  {name}: {tally['passed']} passed, {tally['failed']} failed, {tally['skipped']} skipped, "
              f"largest error {tally['maximumError']}")
    if summary.get("schema") is None:
        print("  schema: not checked (node and tsx are needed)")
    else:
        counts = ", ".join(f"{count} {kind}" for kind, count in sorted(summary["schema"]["counts"].items()))
        print(f"  schema: {counts}; {len(summary['schema']['failures'])} failures")
    for failure in summary["failures"] + [{"error": error} for error in summary["errors"]]:
        print(f"  ! {failure}")
    print("PASSED" if summary["passed"] else "FAILED")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    where = parser.add_mutually_exclusive_group(required=True)
    where.add_argument("--model-id", help="a run under data/models/")
    where.add_argument("--run-directory", help="a run folder anywhere")
    parser.add_argument("--models-root", default=str(REPOSITORY / "data" / "models"))
    parser.add_argument("--bars", type=int, default=50, help="test bars sampled per fold and role")
    parser.add_argument("--seed", type=int, default=0, help="seed of the bar sample")
    parser.add_argument("--no-schema", action="store_true", help="skip the zod check")
    parser.add_argument("--write-fixtures", help="write the first reply of each shape into this folder")
    parser.add_argument("--json", action="store_true", help="print the summary as JSON")
    arguments = parser.parse_args(argv)
    run = Path(arguments.run_directory) if arguments.run_directory else Path(arguments.models_root) / arguments.model_id
    if not run.is_dir():
        print(f"no run folder at {run}", file=sys.stderr)
        return 1
    summary = verify_run(run, bars=arguments.bars, seed=arguments.seed, schema=not arguments.no_schema,
                         fixtures=Path(arguments.write_fixtures) if arguments.write_fixtures else None)
    if arguments.json:
        print(json.dumps(summary, allow_nan=False, default=str))
    else:
        _print_summary(summary)
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
