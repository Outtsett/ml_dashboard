"""The epoch loop every bridge family reports through.

The engine turns reporter calls into the live chart and terminal
(``cycle.adapter.TrainingReporter``): ``epoch_started``, one or more ``batch``
reports naming the rows they used, ``validating`` just before the validation
rows are scored, ``epoch_finished`` with the losses, and ``checkpoint`` between
steps (it blocks while paused and raises ``StopRequested`` on Stop, which the
loop never catches). ``run_epochs`` owns that choreography so a family writes
only its own training step and its own validation scoring:

    summary = run_epochs(reporter, epoch_count=..., train_index=...,
                         train_epoch=lambda epoch, report_batch: <train, return the train loss>,
                         validate=lambda epoch: score(task, prediction, targets),
                         snapshot=lambda: <copy of the state>, restore=lambda state: <put it back>,
                         patience=...)

Selection is on ``ValidationScore.selection`` (lower is better: the plain log
loss of P(up) for a direction model, the Huber loss for a price model, as in
``cycle.networks``); the best epoch's snapshot is restored at the end, and
``patience`` epochs without improvement stop early. ``checkpoint`` is called
at the start of every epoch and again before validation, so a Stop pressed
during an epoch is honoured before the next one starts.

``single_fit`` is the same for a model fitted in one go (``step_unit``
``single_fit``): one epoch, one whole-span batch, one validation.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np

from cycle.adapter import BatchReport, EpochReport


@dataclass(frozen=True)
class ValidationScore:
    loss: float | None            # reported: log loss (direction) or mean absolute error (price)
    accuracy: float | None        # direction accuracy at 0.5, or sign accuracy for a price model
    f1_score: float | None
    selection: float | None       # lower is better: log loss (direction) or Huber loss (price)


def score(task: str, prediction, target) -> ValidationScore:
    """The validation score a Model Cycle adapter reports, from predictions on
    validation rows (P(up) for ``classification``, the target for ``regression``).
    Rows where the prediction is missing are left out."""
    from cycle.models import binary_scores, huber_loss, regression_scores

    prediction = np.asarray(prediction, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)
    keep = np.isfinite(prediction) & np.isfinite(target)
    prediction, target = prediction[keep], target[keep]
    if prediction.size == 0:
        return ValidationScore(None, None, None, None)
    if task == "regression":
        scores = regression_scores(prediction, target)
        return ValidationScore(scores["mean_absolute_error"], scores["accuracy"], None, huber_loss(prediction, target))
    scores = binary_scores(np.clip(prediction, 0.0, 1.0), target)
    return ValidationScore(scores["log_loss"], scores["accuracy"], scores["f1_score"], scores["log_loss"])


def _finite(value) -> float | None:
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def run_epochs(reporter, *, epoch_count: int, train_index, train_epoch: Callable[[int, Callable], float | None],
               validate: Callable[[int], ValidationScore] | None = None, snapshot: Callable[[], Any] | None = None,
               restore: Callable[[Any], None] | None = None, patience: int | None = None,
               step_unit: str = "epoch", name: str = "") -> dict:
    """Run up to ``epoch_count`` epochs (see the module docstring). Returns
    ``{"trained_epochs", "best_epoch", "best_validation_loss", "best_selection",
    "fit_seconds"}``."""
    reporter.step_unit = step_unit
    rows = np.asarray(train_index, dtype=np.int64)
    if rows.size == 0:
        raise ValueError(f"{name or 'the model'}: the training index is empty")
    epoch_count = max(1, int(epoch_count))
    started = time.perf_counter()
    best_selection = math.inf
    best_epoch = 0
    best_loss: float | None = None
    best_state = None
    stale = 0
    last_epoch = 0
    for epoch in range(1, epoch_count + 1):
        last_epoch = epoch
        reporter.checkpoint()
        reporter.epoch_started(epoch, epoch_count)
        batches: list[int] = []

        def report_batch(batch: int, batch_count: int, span_start_row: int, span_end_row: int, loss=None,
                         learning_rate=None, gradient_norm=None, samples_per_second=None, epoch=epoch) -> None:
            batches.append(batch)
            reporter.batch(BatchReport(epoch=epoch, epoch_count=epoch_count, batch=int(batch), batch_count=int(batch_count),
                                       span_start_index=int(span_start_row), span_end_index=int(span_end_row),
                                       train_loss=_finite(loss), learning_rate=_finite(learning_rate),
                                       gradient_norm=_finite(gradient_norm),
                                       samples_per_second=_finite(samples_per_second)))

        epoch_started = time.perf_counter()
        train_loss = _finite(train_epoch(epoch, report_batch))
        if not batches:
            elapsed = max(time.perf_counter() - epoch_started, 1e-9)
            report_batch(1, 1, int(rows[0]), int(rows[-1]), train_loss, samples_per_second=rows.size / elapsed)
        reporter.checkpoint()
        result = ValidationScore(None, None, None, None)
        if validate is not None:
            reporter.validating(epoch, epoch_count)
            result = validate(epoch)
        selection = _finite(result.selection)
        is_best = False
        if selection is not None and selection < best_selection:
            is_best = True
            best_selection, best_epoch, best_loss, stale = selection, epoch, _finite(result.loss), 0
            if snapshot is not None:
                best_state = snapshot()
        elif selection is not None:
            stale += 1
        stop = patience is not None and selection is not None and stale >= int(patience)
        reporter.epoch_finished(EpochReport(epoch=epoch, epoch_count=epoch_count, train_loss=train_loss,
                                            validation_loss=_finite(result.loss),
                                            validation_accuracy=_finite(result.accuracy),
                                            validation_f1_score=_finite(result.f1_score), is_best=is_best,
                                            stopped_early=stop and epoch < epoch_count))
        if stop:
            if epoch < epoch_count:
                reporter.log(f"{name + ': ' if name else ''}early stopping after epoch {epoch}: validation has not "
                             f"improved for {patience} epochs (best at epoch {best_epoch})")
            break
    if best_state is not None and restore is not None and best_epoch != last_epoch:
        restore(best_state)
        reporter.log(f"{name + ': ' if name else ''}restored epoch {best_epoch} (best validation)")
    if best_epoch == 0:
        best_epoch = last_epoch
    return {"trained_epochs": last_epoch, "best_epoch": best_epoch, "best_validation_loss": best_loss,
            "best_selection": None if math.isinf(best_selection) else best_selection,
            "fit_seconds": time.perf_counter() - started}


def single_fit(reporter, *, train_index, fit: Callable[[], float | None],
               validate: Callable[[], ValidationScore] | None = None, name: str = "") -> dict:
    """One fit reported as epoch 1 of 1 with ``step_unit`` ``single_fit``."""
    return run_epochs(reporter, epoch_count=1, train_index=train_index,
                      train_epoch=lambda epoch, report_batch: fit(),
                      validate=(lambda epoch: validate()) if validate is not None else None,
                      step_unit="single_fit", name=name)


__all__ = ["ValidationScore", "run_epochs", "score", "single_fit"]
