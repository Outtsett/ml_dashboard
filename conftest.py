"""Root conftest for the ml_dashboard project.

Inserts packages/ml-engine/src at sys.path position 0 BEFORE any test collection or package
discovery begins.  This ensures that `import tensionflow` resolves to the
production source at packages/ml-engine/src/tensionflow/ rather than the test package at
packages/ml-engine/tests/tensionflow/ (which pytest would otherwise insert into sys.path as a
package root due to __init__.py files in the test tree).
"""

from __future__ import annotations

import pathlib
import sys

_REPO_ROOT = pathlib.Path(__file__).resolve().parent
_SRC_ML = str(_REPO_ROOT / "src" / "ml")

# Must be at position 0 so it wins over packages/ml-engine/tests/ that pytest inserts later.
if _SRC_ML not in sys.path:
    sys.path.insert(0, _SRC_ML)

# Pre-import tensionflow into sys.modules so that pytest's package discovery
# cannot shadow it with packages/ml-engine/tests/tensionflow/ (which has __init__.py).
# When pytest adds packages/ml-engine/tests to sys.path at position 0, sys.modules already
# has 'tensionflow' bound to the production source package.
import importlib
if "tensionflow" not in sys.modules:
    importlib.import_module("tensionflow")
