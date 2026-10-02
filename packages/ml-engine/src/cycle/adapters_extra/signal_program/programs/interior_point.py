"""Interior-point method: L1-regularised logistic regression solved by a primal-dual barrier method.

The formulation Koh, Kim and Boyd made the interior-point showcase of
machine learning:

    direction model   minimise (1/m) sum_i [log(1 + exp(z_i)) - y_i z_i] + l1_penalty * ||w||_1
    price model       minimise (1/m) sum_i huber(z_i - y_i, 1.345)        + l1_penalty * ||w||_1
                      with z = X w + b over the training rows (the most recent ``maximum_training_bars``)

written as a conic program by cvxpy (exponential cones for the log loss,
second-order cones for the Huber loss) and solved by CLARABEL, a primal-dual
interior-point solver: Newton steps on the barrier-smoothed KKT system, each
step cut back to ``step_fraction_to_boundary`` of the way to the cone boundary,
until the duality gap is below ``duality_gap_tolerance``.

After the solve a duality-gap certificate is computed independently: the
gradient of the loss at the solution, centred (the intercept's dual constraint)
and scaled into the dual feasible set (||X' nu / m||_inf <= l1_penalty), is a
feasible dual point nu; primal objective minus the dual objective
-(1/m) sum_i loss_i*(nu_i) bounds how far the weights are from the exact
optimum. P(up) is the model's own sigmoid(w . x + b): the probability is native.
"""

from __future__ import annotations

import numpy as np

from . import ProgramResult, number, one_shot, selected_names

HUBER_THRESHOLD = 1.345


def _entropy(values: np.ndarray) -> np.ndarray:
    values = np.clip(values, 0.0, 1.0)
    with np.errstate(divide="ignore", invalid="ignore"):
        out = values * np.log(values) + (1.0 - values) * np.log1p(-values)
    return np.nan_to_num(out, nan=0.0)


def _logistic_primal(design, labels, weights, intercept, penalty) -> float:
    margin = design @ weights + intercept
    return float(np.mean(np.logaddexp(0.0, margin) - labels * margin) + penalty * np.abs(weights).sum())


def _huber(residual: np.ndarray) -> np.ndarray:
    absolute = np.abs(residual)
    return np.where(absolute <= HUBER_THRESHOLD, residual ** 2, 2.0 * HUBER_THRESHOLD * absolute - HUBER_THRESHOLD ** 2)


def _feasible_scale(dual: np.ndarray, design: np.ndarray, penalty: float) -> float:
    count = design.shape[0]
    largest = float(np.max(np.abs(design.T @ dual))) / count if design.shape[1] else 0.0
    return 1.0 if largest <= penalty or largest == 0.0 else penalty / largest


def logistic_duality_gap(design, labels, weights, intercept, penalty) -> float:
    """Primal minus a feasible dual objective (>= 0 up to rounding) for the L1 logistic problem."""
    margin = design @ weights + intercept
    gradient = 1.0 / (1.0 + np.exp(-margin)) - labels
    centred = gradient - gradient.mean()
    scale = _feasible_scale(centred, design, penalty)
    # keep u = labels + nu inside [0, 1], the conjugate's domain
    with np.errstate(divide="ignore", invalid="ignore"):
        room = np.where(centred > 0, (1.0 - labels) / centred, np.where(centred < 0, -labels / centred, np.inf))
    scale = float(min(scale, np.min(room))) if room.size else scale
    dual_point = scale * centred
    dual = -float(np.mean(_entropy(labels + dual_point)))
    return _logistic_primal(design, labels, weights, intercept, penalty) - dual


def huber_duality_gap(design, target, weights, intercept, penalty) -> float:
    residual = design @ weights + intercept - target
    primal = float(np.mean(_huber(residual)) + penalty * np.abs(weights).sum())
    gradient = np.clip(2.0 * residual, -2.0 * HUBER_THRESHOLD, 2.0 * HUBER_THRESHOLD)
    centred = gradient - gradient.mean()
    scale = min(_feasible_scale(centred, design, penalty),
                float(np.min(2.0 * HUBER_THRESHOLD / np.maximum(np.abs(centred), 1e-300))))
    dual_point = scale * centred
    dual = -float(np.mean(dual_point * target + dual_point ** 2 / 4.0))
    return primal - dual


def _solve(statistics, parameters: dict, log, task: str = "classification") -> ProgramResult:
    import cvxpy

    columns = statistics.usable_columns()
    penalty = float(parameters["l1_penalty"])
    limit = int(parameters["maximum_training_bars"])
    design_all = statistics.design
    if columns.size == 0 or design_all is None or design_all.shape[0] < 2:
        log("interior-point program: no usable signal on the training span; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), "no_signal", 0.0, link="native")
    rows = np.arange(design_all.shape[0])
    if task == "classification":
        # an unlabelled bar (a flat move, NaN) is left out, never read as "down"
        rows = rows[np.isfinite(np.asarray(statistics.labels, dtype=np.float64))]
    if limit > 0:
        rows = rows[-limit:]
    if rows.size < 2:
        log("interior-point program: fewer than 2 labelled training bars; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), "no_signal", 0.0, link="native")
    design = design_all[rows][:, columns]
    count = design.shape[0]
    weights = cvxpy.Variable(columns.size)
    intercept = cvxpy.Variable()
    margin = design @ weights + intercept
    if task == "classification":
        labels = (np.asarray(statistics.labels, dtype=np.float64)[rows] >= 0.5).astype(np.float64)
        loss = cvxpy.sum(cvxpy.logistic(margin) - cvxpy.multiply(labels, margin)) / count
    else:
        target = np.asarray(statistics.target, dtype=np.float64)[rows]
        loss = cvxpy.sum(cvxpy.huber(margin - target, HUBER_THRESHOLD)) / count
    problem = cvxpy.Problem(cvxpy.Minimize(loss + penalty * cvxpy.norm1(weights)))
    gap_tolerance = float(parameters["duality_gap_tolerance"])
    problem.solve(solver=cvxpy.CLARABEL, max_iter=int(parameters["iteration_count"]), tol_gap_abs=gap_tolerance,
                  tol_gap_rel=gap_tolerance, max_step_fraction=float(parameters["step_fraction_to_boundary"]),
                  verbose=False)
    if weights.value is None:
        log(f"interior-point program: CLARABEL ended {problem.status}; every weight is 0")
        return ProgramResult(np.zeros(statistics.signal_count), str(problem.status), 0.0, link="native")
    solution = np.asarray(weights.value, dtype=np.float64)
    bias = float(intercept.value)
    if task == "classification":
        gap = logistic_duality_gap(design, labels, solution, bias, penalty)
        objective = -_logistic_primal(design, labels, solution, bias, penalty)
        full = statistics.scatter(solution)
    else:
        gap = huber_duality_gap(design, target, solution, bias, penalty)
        objective = -float(np.mean(_huber(design @ solution + bias - target)) + penalty * np.abs(solution).sum())
        # the price model forecasts the target in its own units: undo the standardisation
        full = statistics.scatter(solution * statistics.target_scale)
        bias *= statistics.target_scale
    iterations = int(problem.solver_stats.num_iters or 0)
    loss_name = "log loss" if task == "classification" else "Huber loss"
    log(f"interior-point program (CLARABEL barrier method, {loss_name} + L1): status {problem.status}, "
        f"{iterations} Newton iterations on {count} training bars, penalised loss {number(-objective)}, "
        f"duality gap certificate {number(gap)}")
    log(f"interior-point program: {int(np.count_nonzero(np.abs(solution) > 1e-8))} of {columns.size} signals "
        f"non-zero: {selected_names(statistics, full)}")
    return ProgramResult(full, str(problem.status), objective, intercept=bias, link="native",
                         diagnostics={"newton_iterations": iterations, "duality_gap": float(gap),
                                      "training_bars": int(count)})


solve = one_shot(_solve)
