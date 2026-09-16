"""Model Lens builder — turns a trained model directory into the lens artifacts.

Contract: ``src/shared/lens/types.ts``. This package writes
``data/models/<id>/lens/{manifest.json, bars.parquet, attribution.parquet}``
and nothing else.

CLI::

    python -m ml.lens.main --model-id xgb_baseline_post
    python -m ml.lens.main --inspect --model-id xgb_baseline_post
    python -m ml.lens.main --inspect-all
"""

from __future__ import annotations

LENS_BUILDER_VERSION = 1

__all__ = ["LENS_BUILDER_VERSION"]
