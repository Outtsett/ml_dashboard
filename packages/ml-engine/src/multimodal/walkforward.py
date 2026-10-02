"""Walk-forward folds: expanding training window, one calendar quarter tested at a time.

Every position is flat by the RTH close, so a label never reaches past its own
session; the purge still drops the whole session before the test quarter and
the embargo the session after the training window's end (one session each),
which also keeps the causal 20-session statistics of the features apart.
Inside each training window the last ``validation_sessions`` sessions are held
back (again purged by one session) for early stopping and calibration.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

MIN_TRAIN_SESSIONS = 250
VALIDATION_SESSIONS = 60
PURGE_SESSIONS = 1


@dataclass
class Fold:
    index: int
    name: str                 # e.g. 2021Q3
    train: np.ndarray         # row indices
    validation: np.ndarray
    test: np.ndarray


def quarter_of(sessions: np.ndarray) -> np.ndarray:
    dates = pd.to_datetime(np.asarray(sessions, dtype=np.int64), unit="D")
    return (dates.year.astype(str) + "Q" + dates.quarter.astype(str)).to_numpy()


def folds(sessions: np.ndarray, first_test_quarter: str | None = None) -> list[Fold]:
    sessions = np.asarray(sessions, dtype=np.int64)
    unique = np.unique(sessions)
    quarters = quarter_of(sessions)
    order = pd.unique(quarter_of(unique))
    out: list[Fold] = []
    for quarter in order:
        test_sessions = unique[quarter_of(unique) == quarter]
        before = unique[unique < test_sessions.min()]
        if before.size < MIN_TRAIN_SESSIONS + VALIDATION_SESSIONS + 2 * PURGE_SESSIONS:
            continue
        if first_test_quarter and quarter < first_test_quarter:
            continue
        usable = before[: before.size - PURGE_SESSIONS]
        validation_sessions = usable[-VALIDATION_SESSIONS:]
        train_sessions = usable[: usable.size - VALIDATION_SESSIONS - PURGE_SESSIONS]
        out.append(Fold(
            index=len(out), name=str(quarter),
            train=np.flatnonzero(np.isin(sessions, train_sessions)),
            validation=np.flatnonzero(np.isin(sessions, validation_sessions)),
            test=np.flatnonzero(quarters == quarter),
        ))
    return out
