"""What a run was built from: the code and the lake tables, so the gate can refuse a candidate whose
inputs have changed since it was developed.

    commit        git HEAD at run start (for reference)
    code_sha256   hash of every file under src/ml/multimodal and scripts/multimodal (exact code, dirty or not)
    tables        the latest manifest `written_at` of every feature and label table the run reads
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CODE_ROOTS = (REPO / "src" / "ml" / "multimodal", REPO / "scripts" / "multimodal")


def code_sha256() -> str:
    digest = hashlib.sha256()
    for root in CODE_ROOTS:
        for path in sorted(root.rglob("*.py")):
            digest.update(str(path.relative_to(REPO)).replace("\\", "/").encode())
            digest.update(path.read_bytes().replace(b"\r\n", b"\n"))
    return digest.hexdigest()


def commit() -> str | None:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:  # noqa: BLE001 - provenance still carries the code hash
        return None


def table_versions(blocks: list[str], history: str) -> dict[str, str | None]:
    from lake.layout import INGEST_MANIFESTS

    from multimodal.dataset import HISTORY_SOURCES

    latest: dict[tuple[str, str, str], str] = {}
    for dataset in ("multimodal_features", "multimodal_labels"):
        path = INGEST_MANIFESTS / f"{dataset}.jsonl"
        if not path.exists():
            continue
        for line in path.open(encoding="utf-8"):
            entry = json.loads(line)
            key = (dataset, entry["recipe"], entry["table"])
            if entry["written_at"] > latest.get(key, ""):
                latest[key] = entry["written_at"]
    out: dict[str, str | None] = {}
    for features_recipe, labels_recipe in HISTORY_SOURCES[history]:
        for block in blocks:
            out[f"features/{features_recipe}/{block}"] = latest.get(("multimodal_features", features_recipe, block))
        out[f"labels/{labels_recipe}/labels"] = latest.get(("multimodal_labels", labels_recipe, "labels"))
    return out


def current(blocks: list[str], history: str) -> dict:
    return {"commit": commit(), "code_sha256": code_sha256(), "tables": table_versions(blocks, history)}
