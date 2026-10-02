"""Inside the model for explainKind ``opaque``: a runnable model with no view yet.

The core explainer still reloads the model and reproduces the streamed
prediction (gate G1) and reports the bar's inputs and output; this module adds
no kind-specific block, so the structure and the bar carry nulls where a tree,
a linear decomposition or a network trace would be. The client's Inside panel
says so in words instead of drawing a picture that would be a guess.
"""

from __future__ import annotations


def structure_block(context) -> dict:  # noqa: ANN001 - ExplainContext, see cycle.explain.common
    return {}


def bar_block(context, row: int) -> dict:  # noqa: ANN001
    return {}
