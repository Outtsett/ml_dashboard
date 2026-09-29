"""Continuous-integration gate for the multimodal project: every step ends green here.

Runs, in order, and stops at the first failure:
    1. ruff over the project's Python (src/ml/multimodal, scripts/multimodal)
    2. pytest over tests/test_multimodal_*.py (unit, causality and leakage tests,
       the holdout guard)
    3. the holdout state: looks taken must not exceed the budget

Usage (the ml_dashboard interpreter; never `uv run`):
    .venv/Scripts/python.exe scripts/multimodal/ci.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PYTHON = sys.executable
STATE = ROOT / "docs" / "plans" / "2026-09-29-multimodal" / "state.json"


def step(name: str, command: list[str]) -> bool:
    print(f"[ci] {name}: {' '.join(command)}", flush=True)
    result = subprocess.run(command, cwd=ROOT)
    ok = result.returncode == 0
    print(f"[ci] {name}: {'PASS' if ok else 'FAIL'}", flush=True)
    return ok


def main() -> int:
    tests = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "tests").glob("test_multimodal_*.py"))
    checks = [
        ("lint", [PYTHON, "-m", "ruff", "check", "src/ml/multimodal", "scripts/multimodal"]),
        ("tests", [PYTHON, "-m", "pytest", "-q", *tests]),
    ]
    for name, command in checks:
        if not step(name, command):
            return 1
    state = json.loads(STATE.read_text(encoding="utf-8"))["holdout"]
    if int(state["looks"]) > int(state["look_budget"]):
        print(f"[ci] holdout: FAIL — {state['looks']} looks against a budget of {state['look_budget']}")
        return 1
    print(f"[ci] holdout: PASS — {state['looks']} of {state['look_budget']} looks taken")
    print("[ci] all green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
