"""Root conftest for the ml_dashboard project.

Inserts the engine source roots on sys.path BEFORE any test collection or package
discovery begins. Two roots are needed after the packages/ml-engine restructure:

  packages/ml-engine/src          so `core.shared...` resolves
  packages/ml-engine/src/core     so `tensionflow` resolves on its own, which is
                                  what stops pytest's package discovery from
                                  binding it to packages/ml-engine/tests/tensionflow/
                                  (that directory has an __init__.py, so pytest
                                  would otherwise insert the test tree first)

src/ml is still honoured when present for any path that has not moved yet.
"""

from __future__ import annotations

import pathlib
import sys

_REPO_ROOT = pathlib.Path(__file__).resolve().parent
_LEGACY_SRC_ML = _REPO_ROOT / "src" / "ml"
_ENGINE_SRC = _REPO_ROOT / "packages" / "ml-engine" / "src"
_ENGINE_CORE = _ENGINE_SRC / "core"

# Inserted in reverse so the first entry ends up at position 0.
for _root in (_ENGINE_CORE, _ENGINE_SRC, _LEGACY_SRC_ML):
    _path = str(_root)
    if _root.is_dir() and _path not in sys.path:
        sys.path.insert(0, _path)

# Pre-import tensionflow so the binding is settled before pytest inserts the
# test tree. Without this, `import tensionflow` in a test picks up the test
# package rather than the production source.
import importlib

if "tensionflow" not in sys.modules:
    importlib.import_module("tensionflow")

