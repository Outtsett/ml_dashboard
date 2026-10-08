#!/usr/bin/env python3
"""Render every catalog specification's "## Evaluation Metrics" section from the model's own
metrics record.

Where a record lives (one source each):
  * a runnable model: `metrics` on its entry in packages/config/cycle_models/*.json (both layers);
  * a specification that is a model's primary link: generated from that entry, nothing of its own;
  * a specification linked through alsoCatalogSpecIds: its own native block (in the section's JSON
    block) plus the linked model's as-run block;
  * a specification the Model Cycle does not run: its own native block, as-run null.

The section holds the record twice: as tables for a reader and as one fenced JSON block, which is
what apps/api/infrastructure/lib/modelImport/parser.ts reads. This script is the only writer of
both, so they cannot disagree; `--check` fails when a section on disk is not what the records render to.

    python scripts/data/render_model_metrics.py            # rewrite the sections
    python scripts/data/render_model_metrics.py --check    # exit 1 if any section is stale

Every id resolves in packages/config/metric_registry.json. Reference: docs/model-metrics.md.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[2]
CONFIG = REPOSITORY / "packages" / "config"
SPECIFICATION_ROOT = REPOSITORY / "Trading" / "_architecture" / "educational" / "algo_models"
# A second copy of the same files, kept for reading outside the repository; folders differ, file names match.
STUDY_ROOT = Path(os.environ.get("ALGO_MODELS_STUDY_ROOT", "E:/source/documents/algo_models"))
SECTION_HEADING = "## Evaluation Metrics"
RECORD_HEADING = "### Machine-Readable Record"
NOT_RUN = "Not run by the Model Cycle."


def slugify(name: str) -> str:
    """The catalog's spec id rule (apps/api/infrastructure/lib/modelImport/parser.ts `slugify`)."""
    name = re.sub(r"[()]", "", name.lower())
    return re.sub(r"[^a-z0-9]+", "-", name).strip("-")


def load_registry() -> dict:
    registry = json.loads((CONFIG / "metric_registry.json").read_text(encoding="utf-8"))
    registry["_metrics"] = {metric["metricId"]: metric for metric in registry["metrics"]}
    registry["_objectives"] = {objective["objectiveId"]: objective for objective in registry["objectives"]}
    registry["_profiles"] = {profile["profileId"]: profile for profile in registry["profiles"]}
    return registry


def load_models() -> dict[str, dict]:
    models: dict[str, dict] = {}
    for path in sorted((CONFIG / "cycle_models").glob("*.json")):
        if path.name == "_cycle.json":
            continue
        for key, entry in json.loads(path.read_text(encoding="utf-8"))["models"].items():
            models[key] = entry
    return models


def specification_files(root: Path) -> dict[str, Path]:
    return {slugify(path.relative_to(root).with_suffix("").as_posix()): path for path in sorted(root.rglob("*.md"))}


def split_section(text: str) -> tuple[str, str, str]:
    """(before, section, after) around the Evaluation Metrics section; section is "" when absent."""
    lines = text.split("\n")
    start = next((index for index, line in enumerate(lines) if line.strip() == SECTION_HEADING), None)
    if start is None:
        return text, "", ""
    end = next((index for index in range(start + 1, len(lines)) if lines[index].startswith("## ")), len(lines))
    return "\n".join(lines[:start]), "\n".join(lines[start:end]), "\n".join(lines[end:])


def read_record(section: str) -> dict | None:
    """The record in a section's fenced JSON block, or None when it has none."""
    marker = section.find(RECORD_HEADING)
    if marker < 0:
        return None
    match = re.search(r"```json\s*\n(.*?)\n```", section[marker:], re.DOTALL)
    return json.loads(match.group(1))["metrics"] if match else None


def cell(text) -> str:
    return "none" if text is None or text == "" else str(text)


def code(identifier) -> str:
    return "`none`" if identifier is None else f"`{identifier}`"


def named(identifier, names: dict, field: str) -> str:
    if identifier is None:
        return "`none`"
    entry = names.get(identifier)
    return f"`{identifier}` ({entry[field]})" if entry else f"`{identifier}`"


def table(header: list[str], rows: list[list[str]]) -> list[str]:
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join(":---" for _ in header) + "|"]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return lines


def yes_no(flag: bool) -> str:
    return "yes" if flag else "no"


def render_section(record: dict, registry: dict) -> str:
    metrics, objectives, profiles = registry["_metrics"], registry["_objectives"], registry["_profiles"]
    native, as_run = record["native"], record["asRun"]
    additional = ", ".join(named(profile, profiles, "name") for profile in record["additionalProfileIds"]) or "`none`"
    if as_run is None:
        runs = "no"
    else:
        fidelity = registry["faithfulToSpecificationValues"][as_run["faithfulToSpecification"]]
        runs = f"yes, registry model `{record['registryModelKey']}`. {fidelity}"
    lines = [
        SECTION_HEADING, "",
        f"**Native Profile**: {named(record['profileIdNative'], profiles, 'name')}",
        f"**As-Run Profile**: {named(record['profileIdAsRun'], profiles, 'name')}",
        f"**Additional Profiles**: {additional}",
        f"**Produces**: {native['produces']}",
        f"**Target Variable**: {native['targetVariable']}",
        f"**Runs In Model Cycle**: {runs}",
        "",
        "### Native Objective", "",
        f"**Objective**: {named(native['objectiveId'], objectives, 'fullName')}", "",
        objectives[native["objectiveId"]]["plainWords"] + (f" {native['objectiveNote']}" if native["objectiveNote"] else ""),
        "",
        "### Native Metrics", "",
        "What this algorithm is judged on by its own output, whether or not the dashboard computes the number today.", "",
    ]
    lines += table(
        ["Metric", "Metric Id", "Type", "Role", "Why It Applies", "Reference Point", "Availability"],
        [[metrics[row["metricId"]]["fullName"], code(row["metricId"]), row["type"], row["role"], row["why"],
          cell(row["baseline"] or metrics[row["metricId"]]["baseline"]), row["availability"]] for row in native["metrics"]],
    )
    lines += ["", "### As-Run Metrics (Model Cycle)", ""]
    if as_run is None:
        lines += [NOT_RUN, "", "### Measured But Not Meaningful For This Model", "", NOT_RUN]
    else:
        step = as_run["stepQuantity"]
        if step is None:
            step_line = "none logged (the model is fitted in one step)"
        else:
            same = "the same quantity" if step["sameQuantityOnTrainAndValidation"] else "different quantities, so their gap is not an overfitting measure"
            step_line = (f"train_loss holds {code(step['trainName'])} and validation_loss holds {code(step['validationName'])}; {step['direction']} is better; "
                         f"the two curves are {same}. Unit: {step['unit']}")
        lines += [
            "What the Model Cycle measures when this model's call on the close `label_horizon_bars` ahead is traded with costs, "
            "and which of those numbers test something this model's mechanism produced.", "",
            f"**Fidelity**: `{as_run['faithfulToSpecification']}`" + (f". {as_run['standInNote']}" if as_run["standInNote"] else ""),
            f"**Probability Source**: `{as_run['probabilitySource']}`. {as_run['probabilityNote']}",
            f"**Class Weighted**: {yes_no(as_run['classWeighted'])}",
            f"**Price Forecast Source**: `{as_run['priceForecastSource']}`",
            f"**Objective As Run**: {named(as_run['objectiveId'], objectives, 'fullName')}",
            f"**Checkpoint Selected By**: `{as_run['checkpointSelectedBy']}`",
            f"**Hyperparameters Searched**: {yes_no(as_run['tuned'])}",
            f"**Step Quantity**: {step_line}",
            "",
        ]
        lines += table(
            ["Metric", "Metric Id", "Type", "Role", "Why It Applies", "Availability"],
            [[metrics[row["metricId"]]["fullName"], code(row["metricId"]), row["type"], row["role"], row["why"],
              metrics[row["metricId"]]["availability"]] for row in as_run["meaningful"]],
        )
        if as_run["caveats"]:
            lines += ["", "**Caveats**", ""] + [f"- {caveat}" for caveat in as_run["caveats"]]
        lines += ["", "### Measured But Not Meaningful For This Model", ""]
        if as_run["measuredNotMeaningful"]:
            lines += table(["Metric", "Metric Id", "Reason"],
                           [[metrics[row["metricId"]]["fullName"], code(row["metricId"]), row["why"]] for row in as_run["measuredNotMeaningful"]])
        else:
            lines += ["none"]
    lines += ["", "### Not Applicable", ""]
    if native["notApplicable"]:
        lines += table(["Name", "Metric Id", "Reason"], [[row["name"], code(row["metricId"]), row["why"]] for row in native["notApplicable"]])
    else:
        lines += ["none"]
    lines += ["", RECORD_HEADING, "", "```json", json.dumps({"metrics": record}, indent=2, ensure_ascii=False), "```", ""]
    return "\n".join(lines)


def record_for(spec_id: str, own: dict | None, models: dict[str, dict]) -> dict | None:
    """The specification's record, assembled from its sources; None when it has none yet."""
    for key, entry in models.items():
        block = entry.get("metrics")
        if block is None:
            continue
        if entry["catalogSpecId"] == spec_id:
            return {"recordVersion": 1, "profileIdNative": block["profileIdNative"], "profileIdAsRun": block["profileIdAsRun"],
                    "additionalProfileIds": block["additionalProfileIds"], "registryModelKey": key,
                    "native": block["native"], "asRun": block["asRun"]}
        if spec_id in entry["alsoCatalogSpecIds"] and own is not None:
            return {"recordVersion": 1, "profileIdNative": own["profileIdNative"], "profileIdAsRun": block["profileIdAsRun"],
                    "additionalProfileIds": own["additionalProfileIds"], "registryModelKey": key,
                    "native": own["native"], "asRun": block["asRun"]}
    if own is None:
        return None
    return {"recordVersion": 1, "profileIdNative": own["profileIdNative"], "profileIdAsRun": None,
            "additionalProfileIds": own["additionalProfileIds"], "registryModelKey": None, "native": own["native"], "asRun": None}


def study_copies(primary: dict[str, Path]) -> dict[str, Path]:
    """spec id -> the same file in the study copy, matched on file name and parent folder name."""
    if not STUDY_ROOT.exists():
        return {}
    by_name: dict[tuple[str, str], Path] = {}
    for path in STUDY_ROOT.rglob("*.md"):
        by_name[(path.parent.name, path.name)] = path
    return {spec_id: by_name[(path.parent.name, path.name)] for spec_id, path in primary.items() if (path.parent.name, path.name) in by_name}


def rewrite(path: Path, section: str, check: bool) -> bool:
    """Put `section` in the file; returns True when the file changed (or would change)."""
    text = path.read_text(encoding="utf-8")
    before, old, after = split_section(text)
    if old == "":
        return False
    updated = before.rstrip("\n") + "\n\n" + section.rstrip("\n") + "\n\n" + after.lstrip("\n") if after.strip() else before.rstrip("\n") + "\n\n" + section.rstrip("\n") + "\n"
    if updated == text:
        return False
    if not check:
        path.write_text(updated, encoding="utf-8", newline="\n")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true", help="change nothing; exit 1 if any section is stale")
    arguments = parser.parse_args()
    registry, models = load_registry(), load_models()
    primary = specification_files(SPECIFICATION_ROOT)
    copies = study_copies(primary)
    changed, missing = [], []
    for spec_id, path in primary.items():
        _, section, _ = split_section(path.read_text(encoding="utf-8"))
        record = record_for(spec_id, read_record(section) if section else None, models)
        if record is None:
            missing.append(spec_id)
            continue
        rendered = render_section(record, registry)
        for target in [path] + ([copies[spec_id]] if spec_id in copies else []):
            if rewrite(target, rendered, arguments.check):
                changed.append(str(target))
    verb = "stale" if arguments.check else "rewritten"
    print(f"{len(primary)} specifications, {len(copies)} study copies; {len(changed)} files {verb}; {len(missing)} with no record")
    for spec_id in missing:
        print("  no record:", spec_id)
    if arguments.check:
        for name in changed[:20]:
            print("  stale:", name)
    return 1 if missing or (arguments.check and changed) else 0


if __name__ == "__main__":
    sys.exit(main())
