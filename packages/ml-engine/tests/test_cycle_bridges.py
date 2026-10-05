"""Registry-driven checks over every bridge entry (build plan §2, the merge gate).

Run after every family unit lands. For every registry key built by a bridge
adapter (``catalog.BRIDGE_ADAPTERS``) or a bridge network kind:

- it appears in the literal ``KEYS`` of some ``tests/test_cycle_bridge_<family>.py``
  (so the shared gates of ``tests/cycle_bridge_harness.py`` run on it);
- it follows the bridge conventions (``harness.check_registry_entry``): a
  non-null ``implementationNote``, the variant in ``direction.fixed``,
  ``explainKind`` opaque, every parameter name per
  ``cycle/bridges/parameter_names.py`` (one type per name, full words), every
  search space inside the parameter's own bounds;
- its ``implementation`` claim agrees with its family module: a family whose
  keys do not claim ``torch`` must not import torch when its adapter module is
  imported (a subprocess ``sys.modules`` check, one per family — ``main.py``
  imports torch first only for torch models, the Windows CUDA-stall guard), and
  a family claiming ``torch`` must import it somewhere in its package.

Today no family has landed, so the live checks are vacuous; each checker is
also run against fabricated inputs below to show it bites.
"""

from __future__ import annotations

import ast
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import cycle_bridge_harness as harness
import pytest

from cycle import catalog
from cycle.bridges import parameter_names

TESTS = Path(__file__).resolve().parent
# packages/ml-engine, with `packages/` beside it and the repository root above that.
ENGINE = TESTS.parent
ADAPTERS_EXTRA = ENGINE / "src" / "cycle" / "adapters_extra"


def declared_keys(path: Path) -> set[str]:
    """The string literals of a module-level ``KEYS = (...)`` (tuple, list or set)."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    keys: set[str] = set()
    for node in tree.body:
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
        if any(isinstance(target, ast.Name) and target.id == "KEYS" for target in targets) and node.value is not None:
            value = ast.literal_eval(node.value)
            keys.update(str(key) for key in value)
    return keys


def covered_keys(folder: Path = TESTS) -> set[str]:
    keys: set[str] = set()
    for path in sorted(folder.glob("test_cycle_bridge_*.py")):
        keys |= declared_keys(path)
    return keys


def uncovered(reg: dict | None = None, folder: Path = TESTS) -> list[str]:
    return sorted(set(harness.bridge_keys(reg)) - covered_keys(folder))


def parameter_problems(reg: dict | None = None) -> list[str]:
    models = (reg or catalog.registry())["models"]
    try:
        reserved = parameter_names.reserved_types(catalog.parameter_types(reg))
    except ValueError as conflict:        # a registry name typed against its reservation
        return [str(conflict)]
    problems = []
    for key in harness.bridge_keys(reg):
        for name, spec in models[key]["parameters"].items():
            problems += [f"{key}: {problem}" for problem in parameter_names.check_parameter(name, spec["type"], reserved)]
    return problems


def imports_torch(module: str, *paths: str) -> bool:
    """Whether importing ``module`` in a fresh interpreter loads torch."""
    code = f"import importlib, sys; importlib.import_module({module!r}); print('torch' in sys.modules)"
    environment = dict(os.environ)
    search = [*paths, str(ENGINE / "src"), str(ENGINE.parent)]
    environment["PYTHONPATH"] = os.pathsep.join(search + [environment.get("PYTHONPATH", "")])
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=environment, timeout=300)
    assert result.returncode == 0, f"importing {module} failed: {result.stderr[-2000:]}"
    return result.stdout.strip().splitlines()[-1] == "True"


def mentions_torch(package: Path) -> bool:
    for path in package.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if "import torch" in text or "from torch" in text:
            return True
    return False


def torch_claim_problems(reg: dict | None = None, root: Path = ADAPTERS_EXTRA, package_prefix: str = "cycle.adapters_extra",
                         paths: tuple[str, ...] = ()) -> list[str]:
    """One subprocess per family whose package exists (see the module docstring)."""
    models = (reg or catalog.registry())["models"]
    problems = []
    for family in catalog.BRIDGE_ADAPTERS:
        package = root / family
        if not (package / "adapter.py").is_file():
            continue
        claims = {models[key]["implementation"] for key in models if models[key]["adapter"] == family}
        if not claims:
            continue
        if claims == {"torch"}:
            if not mentions_torch(package):
                problems.append(f"{family}: its keys claim torch but no module of {package} imports torch")
        elif "torch" not in claims:
            if imports_torch(f"{package_prefix}.{family}.adapter", *paths):
                problems.append(f"{family}: its keys claim {sorted(claims)} but importing its adapter module imports torch "
                                "(main.py imports torch first only for torch models)")
        else:
            problems.append(f"{family}: its keys mix torch and non-torch implementation claims {sorted(claims)}")
    return problems


# ═══ the live registry ═════════════════════════════════════════════════════


def test_every_bridge_key_appears_in_a_family_test():
    assert uncovered() == []


def test_every_bridge_entry_follows_the_bridge_conventions():
    for key in harness.bridge_keys():
        harness.check_registry_entry(key)


def test_every_bridge_parameter_follows_the_reserved_names():
    assert parameter_problems() == []


def test_every_bridge_entry_carries_an_implementation_note():
    models = catalog.registry()["models"]
    assert [key for key in harness.bridge_keys() if not (models[key]["implementationNote"] or "").strip()] == []


def test_every_implementation_claim_matches_its_family_module():
    assert torch_claim_problems() == []


def _typescript_enum(text: str, field: str) -> set[str]:
    import re

    start = text.index(f"{field}: z")
    opening = text.index("[", start)
    closing = text.index("]", opening)
    return set(re.findall(r'"([a-z_]+)"', text[opening:closing]))


def test_the_typescript_schema_widens_the_same_three_enums():
    text = (ENGINE.parent / "shared" / "src" / "cycle" / "models.ts").read_text(encoding="utf-8")
    assert _typescript_enum(text, "implementation") == set(catalog.IMPLEMENTATIONS)
    assert _typescript_enum(text, "adapter") == set(catalog.ADAPTERS)
    assert _typescript_enum(text, "network") == set(catalog.NETWORKS)


def test_the_shared_modules_import_no_torch():
    for module in ("cycle.market", "cycle.bridges.base", "cycle.bridges.tape", "cycle.bridges.calibration",
                   "cycle.bridges.binning", "cycle.bridges.pool", "cycle.bridges.regimes", "cycle.bridges.groups",
                   "cycle.bridges.rules", "cycle.bridges.persistence", "cycle.bridges.training",
                   "cycle.bridges.parameter_names"):
        assert imports_torch(module) is False, module


# ═══ the checkers bite ═════════════════════════════════════════════════════


def _fabricated_registry(folder: Path, entries: dict) -> dict:
    shutil.copy(catalog.REGISTRY_DIRECTORY / catalog.SHARED_FILE, folder / catalog.SHARED_FILE)
    (folder / "bridges.json").write_text(json.dumps({"models": entries}), encoding="utf-8")
    return catalog.load_registry(folder)


def _entry(**changes) -> dict:
    from test_cycle_bridges_shared import REFERENCE_ENTRY

    entry = json.loads(json.dumps(REFERENCE_ENTRY))
    entry.update(changes)
    return entry


def test_the_keys_parser_and_the_coverage_check(tmp_path):
    tests = tmp_path / "tests"
    tests.mkdir()
    (tests / "test_cycle_bridge_toy.py").write_text('KEYS = ("toy_agent",)\nFAST = {}\n', encoding="utf-8")
    (tests / "test_cycle_bridge_other.py").write_text('KEYS: list[str] = ["other_agent"]\n', encoding="utf-8")
    assert covered_keys(tests) == {"toy_agent", "other_agent"}
    registry_folder = tmp_path / "registry"
    registry_folder.mkdir()
    registry = _fabricated_registry(registry_folder, {"toy_agent": _entry(), "missing_agent": _entry()})
    assert uncovered(registry, tests) == ["missing_agent"]


def test_the_parameter_and_convention_checks_bite(tmp_path):
    bad = _entry(implementationNote=None)
    bad["parameters"] = {**bad["parameters"], "gamma": {"type": "float", "default": 0.9, "label": "Gamma", "group": "Model"}}
    registry_folder = tmp_path / "registry"
    registry_folder.mkdir()
    registry = _fabricated_registry(registry_folder, {"bad_agent": bad})
    assert any("gamma" in problem and "discount_factor" in problem for problem in parameter_problems(registry))
    with pytest.raises(AssertionError, match="implementationNote"):
        harness.check_registry_entry("bad_agent", registry)
    retyped = _entry()
    retyped["parameters"] = {**retyped["parameters"],
                             "sequence_length": {"type": "float", "default": 3.0, "label": "Length", "group": "Model"}}
    retyped_folder = tmp_path / "retyped"
    retyped_folder.mkdir()
    problems = parameter_problems(_fabricated_registry(retyped_folder, {"retyped_agent": retyped}))
    assert any("sequence_length" in problem for problem in problems)
    wide = _entry()
    wide["parameters"]["learning_rate"]["search"] = {"kind": "float", "low": 0.1, "high": 5.0}
    wide_folder = tmp_path / "wide"
    wide_folder.mkdir()
    with pytest.raises(AssertionError, match="leaves its bounds"):
        harness.check_registry_entry("wide_agent", _fabricated_registry(wide_folder, {"wide_agent": wide}))


def test_the_torch_claim_check_bites(tmp_path):
    root = tmp_path / "fakeextra"
    (root / "discrete_state_agent").mkdir(parents=True)
    (root / "__init__.py").write_text("", encoding="utf-8")
    (root / "discrete_state_agent" / "__init__.py").write_text("", encoding="utf-8")
    (root / "discrete_state_agent" / "adapter.py").write_text("import torch\n", encoding="utf-8")
    registry_folder = tmp_path / "registry"
    registry_folder.mkdir()
    custom = _fabricated_registry(registry_folder, {"toy_agent": _entry(implementation="custom")})
    problems = torch_claim_problems(custom, root, "fakeextra", (str(tmp_path),))
    assert len(problems) == 1 and "imports torch" in problems[0]
    (root / "discrete_state_agent" / "adapter.py").write_text("import numpy\n", encoding="utf-8")
    assert torch_claim_problems(custom, root, "fakeextra", (str(tmp_path),)) == []
    torch_folder = tmp_path / "torch_registry"
    torch_folder.mkdir()
    claims_torch = _fabricated_registry(torch_folder, {"toy_agent": _entry(implementation="torch")})
    assert "no module" in torch_claim_problems(claims_torch, root, "fakeextra", (str(tmp_path),))[0]
