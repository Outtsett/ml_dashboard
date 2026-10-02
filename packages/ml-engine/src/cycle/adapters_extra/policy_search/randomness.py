"""A private copy of the two process-wide random generators.

DEAP draws from Python's ``random`` module, pyswarms and CMA-ES from
``numpy.random``'s global generator, and none of them takes a generator
object. So a fit would be reproducible only while nothing else in the process
draws in between, and it would disturb anything else that does.

``GlobalRandomState(seed)`` holds its own state of both global generators;
``with state.active():`` swaps it in, runs the library call, stores where it
got to and puts the process's own state back. A searcher that enters it for
every generation is reproducible from its seed alone, whatever runs between
two generations (the engine's reporter, another model's fit).
"""

from __future__ import annotations

import contextlib
import random

import numpy as np


class GlobalRandomState:
    def __init__(self, seed: int) -> None:
        seed = int(seed) % (2 ** 32)
        self.python_state = random.Random(seed).getstate()
        self.numpy_state = np.random.RandomState(seed).get_state()

    @contextlib.contextmanager
    def active(self):
        saved_python = random.getstate()
        saved_numpy = np.random.get_state()
        random.setstate(self.python_state)
        np.random.set_state(self.numpy_state)
        try:
            yield
        finally:
            self.python_state = random.getstate()
            self.numpy_state = np.random.get_state()
            random.setstate(saved_python)
            np.random.set_state(saved_numpy)


__all__ = ["GlobalRandomState"]
