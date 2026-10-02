"""The interface every state model of the family follows.

A state model turns a standardised feature row into responsibilities over S
states: a one-hot row for a hard assignment (a cluster, a map cell, a score
bin), a posterior for a soft one (a mixture component, a neighbour vote). It
is fitted on the training span's rows (``fit(space, context)``, ``space`` the
standardised training rows) and saved as plain arrays.

``FitContext`` carries what some models need beyond the rows: the training
targets (only the class-conditional mixture reads them, to fit one density per
class) and the reporter's log.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np


@dataclass
class FitContext:
    task: str                                  # "classification" (targets are labels) or "regression" (scaled moves)
    targets: np.ndarray                        # the training rows' targets, row-aligned with ``space``
    log: Callable[[str], None] = field(default=lambda message: None)
    #: the training rows' scaled h-bar moves (the view's price target), row-aligned; None without a view
    moves: np.ndarray | None = None
    feature_names: tuple[str, ...] = ()


class StateModel:
    """Base class: a family module subclasses it (see the module docstring)."""

    variant = ""
    #: responsibilities are posteriors (True) or one-hot rows (False)
    soft = False

    def __init__(self, parameters: dict, seed: int) -> None:
        self.parameters = dict(parameters)
        self.seed = int(seed)

    def fit(self, space: np.ndarray, context: FitContext) -> None:
        raise NotImplementedError

    @property
    def state_count(self) -> int:
        raise NotImplementedError

    def responsibilities(self, space: np.ndarray) -> np.ndarray:
        """(n, S) for standardised rows ``space`` (each row on its own)."""
        raise NotImplementedError

    def smoothing(self) -> np.ndarray | None:
        """An (S, S) matrix spreading readout evidence between related states, or None."""
        return None

    def fixed_rates(self) -> np.ndarray | None:
        """Per-state up-rates fixed by the model itself (a class-conditional
        density's components belong to one class), or None to learn them."""
        return None

    def arrays(self) -> dict[str, np.ndarray]:
        raise NotImplementedError

    def restore(self, arrays: dict[str, np.ndarray]) -> None:
        raise NotImplementedError

    def describe(self) -> str:
        """One ASCII line for the run log (state counts and what they mean)."""
        return f"{self.state_count} states"


def occupancy(codes: np.ndarray, state_count: int) -> str:
    """'n0/n1/...' training rows per state (ASCII, for the log)."""
    codes = np.asarray(codes, dtype=np.int64)
    counts = np.bincount(codes[codes >= 0], minlength=state_count)[:state_count]
    shown = "/".join(str(int(count)) for count in counts[:24])
    return shown + ("/..." if state_count > 24 else "")


__all__ = ["FitContext", "StateModel", "occupancy"]
