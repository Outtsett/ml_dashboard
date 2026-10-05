"""Where the monorepo's shared config lives, resolved once from this file.

`config/` is a SIBLING of the engine package, not a child of it:

    <repo>/packages/config/cycle_models/*.json
    <repo>/packages/config/{features,cost_model,cycle_rules}.json
    <repo>/packages/ml-engine/src/cycle/paths.py

Every module that reads a registry or a cost model resolves it through here, so a
module's own depth in the tree can never again decide where its config is found.
That is not hypothetical: each of these readers used to count `parents` by hand,
and after `src/ml` moved to `packages/ml-engine/src` they resolved to
`packages/ml-engine/config/...`, which does not exist — so every Model Cycle run
died at startup with "no _cycle.json" before reading a single bar.

Standard library only: `main.py` imports `cycle.catalog` BEFORE numpy and torch,
to decide whether torch has to be imported first.
"""

from __future__ import annotations

from pathlib import Path

# __file__ -> cycle -> src -> ml-engine -> packages
PACKAGES_ROOT = Path(__file__).resolve().parents[3]

#: `<repo>/packages/config` — the Cycle's registry, feature list and cost model.
CONFIG_ROOT = PACKAGES_ROOT / "config"