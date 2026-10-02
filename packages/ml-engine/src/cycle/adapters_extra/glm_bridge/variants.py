"""The eight GLM mechanisms of the ``glm_bridge`` family.

Each mechanism fits with statsmodels (or closed-form numpy for the
multivariate ridge) on the training design ``FitContext.design`` — the
standardised training rows with an intercept column in front — and keeps only
plain coefficient arrays, which ``links`` turns back into predictions. So a
saved model is arrays plus a small JSON document, and one row costs a dot
product. Interface:

    fit(context)            fit on the training rows
    direction(design)       P(up) when ``native_probability``; otherwise a score that
                            the adapter maps through a validation-fitted curve
    value(design)           the predicted scaled h-bar move (the price model)
    arrays() / document()   the state to save;  restore(arrays, document)

``design`` is always (n, 1 + k): the intercept column, then the standardised features.
"""

from __future__ import annotations

import math
import warnings
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
from scipy import special, stats

from . import design as designs
from . import links


@dataclass
class FitContext:
    design: np.ndarray            # (n, 1 + k) intercept + standardised training rows
    rows: np.ndarray              # the training rows (int64)
    target: np.ndarray            # the scaled h-bar move at the rows (float64)
    labels: np.ndarray            # the up / down label at the rows (float64, NaN where none)
    view: object                  # the bound MarketView
    parameters: dict
    task: str
    log: Callable[[str, str], None]
    notes: dict = field(default_factory=dict)


def _warnings_text(caught) -> str:
    names = sorted({type(item.message).__name__ for item in caught})
    return ", ".join(names)


def fit_glm(endog: np.ndarray, exog: np.ndarray, family, *, penalty: float, max_iterations: int,
            log: Callable[[str, str], None], what: str) -> tuple[np.ndarray, bool]:
    """(coefficients, converged) of one statsmodels GLM: IRLS when ``penalty`` is 0,
    else an L2 (ridge) penalised fit that leaves the intercept unpenalised."""
    import statsmodels.api as sm

    model = sm.GLM(endog, exog, family=family)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        if penalty > 0:
            alpha = np.full(exog.shape[1], float(penalty))
            alpha[0] = 0.0
            result = model.fit_regularized(method="elastic_net", alpha=alpha, L1_wt=0.0, maxiter=int(max_iterations))
            converged = True
        else:
            try:
                result = model.fit(maxiter=int(max_iterations))
                converged = bool(getattr(result, "converged", True))
            except (np.linalg.LinAlgError, ValueError, FloatingPointError):
                result = model.fit(method="bfgs", maxiter=int(max_iterations), disp=0)
                converged = bool(result.mle_retvals.get("converged", False)) if hasattr(result, "mle_retvals") else False
    params = np.asarray(result.params, dtype=np.float64).reshape(-1)
    if caught:
        log(f"{what}: the fit raised {_warnings_text(caught)}", "warning")
    if not np.all(np.isfinite(params)):
        raise FloatingPointError(f"{what}: the fitted coefficients are not finite")
    return params, converged


class Mechanism:
    name = ""
    native_probability = True
    #: the price model's value needs the direction curve (gamma)
    value_needs_curve = False

    def __init__(self, parameters: dict, task: str) -> None:
        self.parameters = dict(parameters)
        self.task = task
        self.curve = None
        self.summary: dict = {}

    def fit(self, context: FitContext) -> None:
        raise NotImplementedError

    def direction(self, design: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    def value(self, design: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    def arrays(self) -> dict[str, np.ndarray]:
        return {}

    def document(self) -> dict:
        return {}

    def restore(self, arrays: dict, document: dict) -> None:
        raise NotImplementedError


# ─── ordinal: the cumulative link ──────────────────────────────────────────


def fit_cumulative_link(grades: np.ndarray, x: np.ndarray, link: str, max_iterations: int) -> tuple[np.ndarray, np.ndarray, bool, int]:
    """Maximum likelihood of the cumulative-link model P(Y <= j | x) = F(t_j - x'b)
    for grades 0..G-1, with the analytic gradient (L-BFGS-B). The thresholds are
    parameterised as statsmodels' ``OrderedModel`` does (t_1, then the log of each
    increment), so the optimum is the same model; OrderedModel's numerical
    gradient took 72 s on 20,000 bars x 50 features, this takes about one.
    Returns (b, thresholds t_1..t_{G-1}, converged, iterations)."""
    from scipy import optimize

    grades = np.asarray(grades, dtype=np.int64)
    count, width = x.shape
    levels = int(grades.max()) + 1
    shares = np.cumsum(np.bincount(grades, minlength=levels))[:-1] / count
    shares = np.clip(shares, 1e-6, 1 - 1e-6)
    start_thresholds = special.logit(shares) if link == "logit" else special.ndtri(shares)
    start_thresholds = np.maximum.accumulate(start_thresholds + np.arange(levels - 1) * 1e-6)
    start = np.concatenate([np.zeros(width), start_thresholds[:1], np.log(np.maximum(np.diff(start_thresholds), 1e-6))])
    one_hot_upper = np.zeros((count, levels + 1))
    one_hot_upper[np.arange(count), grades + 1] = 1.0            # the threshold above each grade (index into padded)
    one_hot_lower = np.zeros((count, levels + 1))
    one_hot_lower[np.arange(count), grades] = 1.0

    def density(values):
        if link == "logit":
            probability = special.expit(values)
            return probability * (1.0 - probability)
        return np.exp(-0.5 * values * values) / np.sqrt(2.0 * np.pi)

    def unpack(parameters):
        increments = np.exp(parameters[width + 1:])
        thresholds = parameters[width] + np.concatenate([[0.0], np.cumsum(increments)])
        return parameters[:width], thresholds, increments

    def objective(parameters):
        weights, thresholds, increments = unpack(parameters)
        eta = x @ weights
        padded = np.concatenate([[-np.inf], thresholds, [np.inf]])
        upper, lower = padded[grades + 1] - eta, padded[grades] - eta
        probability = np.maximum(links.cumulative_distribution(link, upper) - links.cumulative_distribution(link, lower),
                                 1e-300)
        upper_density = np.where(np.isfinite(upper), density(np.where(np.isfinite(upper), upper, 0.0)), 0.0)
        lower_density = np.where(np.isfinite(lower), density(np.where(np.isfinite(lower), lower, 0.0)), 0.0)
        loss = -float(np.sum(np.log(probability)))
        eta_gradient = (upper_density - lower_density) / probability          # d(-log p)/d eta
        # d(-log p)/d t_j over the padded thresholds, then chained to (t_1, log increments)
        padded_gradient = (-(upper_density / probability))[:, None] * one_hot_upper             + (lower_density / probability)[:, None] * one_hot_lower
        threshold_gradient = padded_gradient.sum(axis=0)[1:levels]              # t_1..t_{G-1}
        tail = np.cumsum(threshold_gradient[::-1])[::-1]                        # sum over j >= m
        gradient = np.concatenate([x.T @ eta_gradient, [tail[0]], tail[1:] * increments])
        return loss, gradient

    result = optimize.minimize(objective, start, jac=True, method="L-BFGS-B",
                               options={"maxiter": int(max_iterations), "gtol": 1e-8, "ftol": 1e-13})
    weights, thresholds, _ = unpack(result.x)
    return weights, thresholds, bool(result.success), int(result.nit)


class Ordinal(Mechanism):
    """Proportional odds: P(Y <= k | x) = F(t_k - x'b), Y the grade of the scaled
    move (K/2 grades <= 0, K/2 grades > 0). P(up) = 1 - P(Y <= K/2 - 1) = P(move > 0).
    Fitted by ``fit_cumulative_link`` (statsmodels ``OrderedModel``'s model and
    parameterisation, with an analytic gradient; the tests check the two agree)."""

    name = "ordinal"

    def fit(self, context: FitContext) -> None:
        p = self.parameters
        link = str(p["cumulative_link"])
        grade_count = 2 * int(p["grades_per_side"])
        grades, edges = designs.ordinal_grades(context.target, grade_count)
        present = np.unique(grades)
        half = grade_count // 2
        if not (present < half).any() or not (present >= half).any():
            raise ValueError("ordinal: the training rows need moves on both sides of 0")
        endog = np.searchsorted(present, grades)          # consecutive 0..G-1
        weights, thresholds, converged, iterations = fit_cumulative_link(endog, context.design[:, 1:], link,
                                                                         int(p["max_iterations"]))
        if not converged:
            context.log(f"ordinal: the maximum-likelihood fit stopped after {iterations} iterations before converging",
                        "warning")
        self.link = link
        self.coefficients = weights
        self.thresholds = thresholds
        self.up_grades = (present >= half).astype(np.float64)
        self.grade_means = np.array([float(np.mean(context.target[grades == grade])) for grade in present])
        self.summary = {"grades": int(present.size), "gradeEdges": [float(edge) for edge in edges],
                        "converged": converged, "iterations": iterations}
        context.log(f"ordinal: {present.size} grades cut at {', '.join(f'{edge:+.3f}' for edge in edges)} "
                    f"({link} link)", "info")

    def grade_probabilities(self, design: np.ndarray) -> np.ndarray:
        return links.grade_probabilities(self.link, self.thresholds, design[:, 1:] @ self.coefficients)

    def direction(self, design):
        return self.grade_probabilities(design) @ self.up_grades

    def value(self, design):
        return self.grade_probabilities(design) @ self.grade_means

    def arrays(self):
        return {"coefficients": self.coefficients, "thresholds": self.thresholds, "up_grades": self.up_grades,
                "grade_means": self.grade_means}

    def document(self):
        return {"link": self.link}

    def restore(self, arrays, document):
        self.link = document["link"]
        self.coefficients, self.thresholds = arrays["coefficients"], arrays["thresholds"]
        self.up_grades, self.grade_means = arrays["up_grades"], arrays["grade_means"]


# ─── multinomial: softmax over down / flat / up ────────────────────────────


class Multinomial(Mechanism):
    """MNLogit over three classes of the scaled move (down < -band <= flat <= band < up),
    the band a training quantile of |move|. P(up) = p_up / (p_up + p_down)."""

    name = "multinomial"

    def fit(self, context: FitContext) -> None:
        import statsmodels.api as sm

        p = self.parameters
        band = float(np.quantile(np.abs(context.target), float(p["neutral_band_quantile"])))
        classes = designs.band_classes(context.target, band)
        present = np.unique(classes)
        if 0 not in present or 2 not in present:
            raise ValueError("multinomial: the training rows need both up and down moves outside the band")
        endog = np.searchsorted(present, classes)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            model = sm.MNLogit(endog, context.design)
            try:        # L-BFGS on the analytic score: 0.15 s at 20,000 bars x 50 features (Newton took 22 s)
                result = model.fit(method="lbfgs", maxiter=int(p["max_iterations"]), disp=0)
                params = np.asarray(result.params, dtype=np.float64)
                if not np.all(np.isfinite(params)):
                    raise np.linalg.LinAlgError("non-finite coefficients")
            except (np.linalg.LinAlgError, ValueError):
                result = model.fit(method="bfgs", maxiter=int(p["max_iterations"]), disp=0)
                params = np.asarray(result.params, dtype=np.float64)
        if caught:
            context.log(f"multinomial: the fit raised {_warnings_text(caught)}", "warning")
        self.band = band
        self.classes = present.astype(np.int64)
        # class 0 of the present ones is the reference (zero column)
        self.coefficients = np.column_stack([np.zeros(context.design.shape[1]), params.reshape(context.design.shape[1], -1)])
        self.class_means = np.array([float(np.mean(context.target[classes == value])) for value in present])
        shares = [float(np.mean(classes == value)) for value in present]
        self.summary = {"band": band, "classShares": shares}
        context.log(f"multinomial: flat band +-{band:.3f}; class shares "
                    + ", ".join(f"{['down', 'flat', 'up'][int(value)]} {share:.2f}" for value, share in zip(present, shares)),
                    "info")

    def class_probabilities(self, design):
        return special.softmax(design @ self.coefficients, axis=1)

    def direction(self, design):
        probability = self.class_probabilities(design)
        up = probability[:, list(self.classes).index(2)]
        down = probability[:, list(self.classes).index(0)]
        return up / (up + down)

    def value(self, design):
        return self.class_probabilities(design) @ self.class_means

    def arrays(self):
        return {"coefficients": self.coefficients, "classes": self.classes, "class_means": self.class_means,
                "band": np.array([self.band])}

    def restore(self, arrays, document):
        self.coefficients, self.classes = arrays["coefficients"], arrays["classes"].astype(np.int64)
        self.class_means, self.band = arrays["class_means"], float(arrays["band"][0])


# ─── glm_link: a Binomial GLM with a link menu ─────────────────────────────


def _binary_link(name: str):
    import statsmodels.api as sm

    families = sm.families
    return {"logit": families.links.Logit(), "probit": families.links.Probit(),
            "cloglog": families.links.CLogLog(), "cauchit": families.links.Cauchy()}[name]


class GlmLink(Mechanism):
    """Direction: Binomial GLM on the up / down label, P(up) = g^-1(x'b) for the
    chosen link. Price: the Gaussian member with the identity link (least
    squares) on the scaled move clipped at its training 1st / 99th percentiles."""

    name = "glm_link"

    def fit(self, context: FitContext) -> None:
        import statsmodels.api as sm

        p = self.parameters
        penalty, iterations = float(p["penalty_strength"]), int(p["max_iterations"])
        if self.task == "classification":
            self.link = str(p["link_function"])
            known = np.isfinite(context.labels)
            endog = (context.labels[known] >= 0.5).astype(np.float64)
            self.coefficients, converged = fit_glm(endog, context.design[known], sm.families.Binomial(link=_binary_link(self.link)),
                                                   penalty=penalty, max_iterations=iterations, log=context.log,
                                                   what=f"glm_link ({self.link})")
        else:
            self.link = "identity"
            low, high = designs.percentile_bounds(context.target)
            self.coefficients, converged = fit_glm(np.clip(context.target, low, high), context.design,
                                                   sm.families.Gaussian(), penalty=penalty, max_iterations=iterations,
                                                   log=context.log, what="glm_link (gaussian price model)")
        self.summary = {"link": self.link, "converged": converged}

    def direction(self, design):
        return links.inverse_link(self.link, design @ self.coefficients)

    def value(self, design):
        return design @ self.coefficients

    def arrays(self):
        return {"coefficients": self.coefficients}

    def document(self):
        return {"link": self.link}

    def restore(self, arrays, document):
        self.coefficients, self.link = arrays["coefficients"], document["link"]


# ─── the two-sided GLMs: gamma, poisson, tweedie, zero-inflated poisson ────


class TwoSided(Mechanism):
    """Two non-negative models, one for the up side and one for the down side."""

    def _sides(self, context: FitContext) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """(up target, up rows mask, down target, down rows mask)."""
        raise NotImplementedError

    def _side_means(self, design) -> tuple[np.ndarray, np.ndarray]:
        return (links.inverse_link("log", design @ self.up_coefficients),
                links.inverse_link("log", design @ self.down_coefficients))

    def arrays(self):
        return {"up_coefficients": self.up_coefficients, "down_coefficients": self.down_coefficients,
                **{name: np.array([value]) for name, value in self._scalars().items()}}

    def _scalars(self) -> dict[str, float]:
        return {}

    def restore(self, arrays, document):
        self.up_coefficients, self.down_coefficients = arrays["up_coefficients"], arrays["down_coefficients"]
        for name in self._scalars():
            setattr(self, name, float(arrays[name][0]))


class Gamma(TwoSided):
    """Gamma GLMs (log link) on the up magnitudes (moves > 0) and the down
    magnitudes (|moves| < 0), each clipped to its training [1st, 99th]
    percentiles. Score log mu_up - log mu_down; P(up) through a validation curve;
    price P(up) mu_up - (1 - P(up)) mu_down."""

    name = "gamma"
    native_probability = False
    value_needs_curve = True

    def fit(self, context: FitContext) -> None:
        import statsmodels.api as sm

        p = self.parameters
        family = sm.families.Gamma(link=sm.families.links.Log())
        for side, mask in (("up", context.target > 0), ("down", context.target < 0)):
            magnitude = np.abs(context.target[mask])
            if magnitude.size < context.design.shape[1] + 2:
                raise ValueError(f"gamma: {magnitude.size} {side} moves on the training rows, too few to fit")
            low, high = designs.percentile_bounds(magnitude)
            magnitude = np.clip(magnitude, max(low, 1e-6), high)
            coefficients, converged = fit_glm(magnitude, context.design[mask], family, penalty=float(p["penalty_strength"]),
                                              max_iterations=int(p["max_iterations"]), log=context.log,
                                              what=f"gamma ({side} magnitudes)")
            setattr(self, f"{side}_coefficients", coefficients)
            self.summary[f"{side}Converged"] = converged

    def direction(self, design):
        return design @ (self.up_coefficients - self.down_coefficients)

    def value(self, design):
        up, down = self._side_means(design)
        probability = self.curve.apply(self.direction(design))
        return probability * up - (1.0 - probability) * down


class Poisson(TwoSided):
    """Poisson GLMs (log link) on the count of up bars and of down bars in the
    next h bars. N_up - N_down is Skellam(lambda_up, lambda_down); the score is
    P(N_up > N_down) + P(N_up = N_down) / 2, mapped by a validation curve.
    Price: c (lambda_up - lambda_down), c fitted on the training rows."""

    name = "poisson"
    native_probability = False

    def fit(self, context: FitContext) -> None:
        import statsmodels.api as sm

        p = self.parameters
        up, down = designs.bar_counts(context.view, context.rows)
        for side, counts in (("up", up), ("down", down)):
            coefficients, converged = fit_glm(counts, context.design, sm.families.Poisson(),
                                              penalty=float(p["penalty_strength"]), max_iterations=int(p["max_iterations"]),
                                              log=context.log, what=f"poisson ({side} bars)")
            setattr(self, f"{side}_coefficients", coefficients)
            self.summary[f"{side}Converged"] = converged
        self.move_per_count = _through_origin(self._difference(context.design), context.target)
        self.summary.update({"meanUpBars": float(up.mean()), "meanDownBars": float(down.mean()),
                             "movePerCount": self.move_per_count})
        context.log(f"poisson: mean {up.mean():.2f} up bars and {down.mean():.2f} down bars in the next "
                    f"{context.view.horizon}", "info")

    def _difference(self, design):
        up, down = self._side_means(design)
        return up - down

    def direction(self, design):
        up, down = self._side_means(design)
        return stats.skellam.sf(0, up, down) + 0.5 * stats.skellam.pmf(0, up, down)

    def value(self, design):
        return self.move_per_count * self._difference(design)

    def _scalars(self):
        return {"move_per_count": getattr(self, "move_per_count", 0.0)}


def _through_origin(predictor: np.ndarray, target: np.ndarray) -> float:
    predictor, target = np.asarray(predictor, dtype=np.float64), np.asarray(target, dtype=np.float64)
    keep = np.isfinite(predictor) & np.isfinite(target)
    denominator = float(np.sum(predictor[keep] ** 2))
    return float(np.sum(predictor[keep] * target[keep]) / denominator) if denominator > 1e-12 else 0.0


def tweedie_zero_mass(mean, variance_power: float, dispersion: float) -> np.ndarray:
    """P(Y = 0) of a Tweedie variable with 1 < p < 2: its compound Poisson-Gamma form
    has Poisson rate lambda = mu^(2-p) / (phi (2-p)), so P(Y = 0) = exp(-lambda)."""
    mean = np.asarray(mean, dtype=np.float64)
    power = float(variance_power)
    return np.exp(-np.power(mean, 2.0 - power) / (float(dispersion) * (2.0 - power)))


class Tweedie(TwoSided):
    """Tweedie GLMs (log link, variance power p in (1, 2)) on the positive part
    max(move, 0) and the negative part max(-move, 0), each with its Pearson
    dispersion. P(up) = P(u > 0) / (P(u > 0) + P(d > 0)) from each side's
    zero mass; price mu_u - mu_d."""

    name = "tweedie"

    def fit(self, context: FitContext) -> None:
        import statsmodels.api as sm

        p = self.parameters
        power = float(p["variance_power"])
        _, high = designs.percentile_bounds(np.abs(context.target))
        family = sm.families.Tweedie(var_power=power, link=sm.families.links.Log())
        for side, part in (("up", np.maximum(context.target, 0.0)), ("down", np.maximum(-context.target, 0.0))):
            part = np.minimum(part, high)
            coefficients, converged = fit_glm(part, context.design, family, penalty=float(p["penalty_strength"]),
                                              max_iterations=int(p["max_iterations"]), log=context.log,
                                              what=f"tweedie ({side} part)")
            mean = links.inverse_link("log", context.design @ coefficients)
            degrees = max(1, part.size - context.design.shape[1])
            dispersion = float(np.sum((part - mean) ** 2 / np.power(mean, power)) / degrees)
            setattr(self, f"{side}_coefficients", coefficients)
            setattr(self, f"{side}_dispersion", dispersion)
            self.summary[f"{side}Converged"] = converged
            self.summary[f"{side}Dispersion"] = dispersion
        self.variance_power = power

    def direction(self, design):
        up, down = self._side_means(design)
        moves_up = 1.0 - tweedie_zero_mass(up, self.variance_power, self.up_dispersion)
        moves_down = 1.0 - tweedie_zero_mass(down, self.variance_power, self.down_dispersion)
        with np.errstate(invalid="ignore", divide="ignore"):
            out = moves_up / (moves_up + moves_down)
        out[~np.isfinite(out)] = 0.5
        return out

    def value(self, design):
        up, down = self._side_means(design)
        return up - down

    def _scalars(self):
        return {"variance_power": getattr(self, "variance_power", 1.5), "up_dispersion": getattr(self, "up_dispersion", 1.0),
                "down_dispersion": getattr(self, "down_dispersion", 1.0)}


class ZeroInflatedPoisson(TwoSided):
    """Zero-inflated Poisson models (logit inflation, log count mean) on the
    count of up impulses and of down impulses in the next h bars. E[N] =
    (1 - pi(x)) lambda(x); score log E[N_up] - log E[N_down] through a
    validation curve; price c (E[N_up] - E[N_down]), c fitted on the training
    rows. A side whose zero-inflated fit fails or does not converge falls back
    to a plain Poisson GLM, logged as a warning."""

    name = "zero_inflated_poisson"
    native_probability = False

    def fit(self, context: FitContext) -> None:
        p = self.parameters
        up, down = designs.impulse_counts(context.view, context.rows, float(p["impulse_multiple"]))
        for side, counts in (("up", up), ("down", down)):
            inflation, count, fell_back = self._fit_side(counts, context, side)
            setattr(self, f"{side}_coefficients", count)
            setattr(self, f"{side}_inflation", inflation)
            self.summary[f"{side}FellBackToPoisson"] = fell_back
            self.summary[f"{side}ZeroShare"] = float(np.mean(counts == 0))
        self.move_per_count = _through_origin(self._difference(context.design), context.target)
        self.summary["movePerCount"] = self.move_per_count
        context.log(f"zero_inflated_poisson: zero share up {np.mean(up == 0):.2f}, down {np.mean(down == 0):.2f} "
                    f"(impulse beyond {float(p['impulse_multiple']):.2f} x the trailing bar scale)", "info")

    def _fit_side(self, counts, context: FitContext, side: str) -> tuple[np.ndarray, np.ndarray, bool]:
        import statsmodels.api as sm
        from statsmodels.discrete.count_model import ZeroInflatedPoisson as ZeroInflatedPoissonModel

        iterations = int(self.parameters["max_iterations"])
        width = context.design.shape[1]
        reason = ""
        try:
            with warnings.catch_warnings(record=True):
                warnings.simplefilter("always")
                result = ZeroInflatedPoissonModel(counts, context.design, exog_infl=context.design,
                                                  inflation="logit").fit(method="bfgs", maxiter=iterations, disp=0)
            params = np.asarray(result.params, dtype=np.float64)
            converged = bool(result.mle_retvals.get("converged", False))
            if converged and np.all(np.isfinite(params)):
                return params[:width], params[width:], False
            reason = "did not converge" if not converged else "gave non-finite coefficients"
        except (np.linalg.LinAlgError, ValueError, FloatingPointError, OverflowError) as error:
            reason = f"raised {type(error).__name__}"
        context.log(f"zero_inflated_poisson: the {side} zero-inflated fit {reason}; fell back to a plain Poisson fit",
                    "warning")
        count, _ = fit_glm(counts, context.design, sm.families.Poisson(), penalty=0.0, max_iterations=iterations,
                           log=context.log, what=f"zero_inflated_poisson ({side} fallback)")
        return np.full(width, -np.inf), count, True

    def _expected(self, design):
        out = []
        for side in ("up", "down"):
            inflation = getattr(self, f"{side}_inflation")
            structural_zero = special.expit(design @ inflation) if np.all(np.isfinite(inflation)) else np.zeros(design.shape[0])
            out.append((1.0 - structural_zero) * links.inverse_link("log", design @ getattr(self, f"{side}_coefficients")))
        return out[0], out[1]

    def _difference(self, design):
        up, down = self._expected(design)
        return up - down

    def direction(self, design):
        up, down = self._expected(design)
        return np.log(np.maximum(up, 1e-300)) - np.log(np.maximum(down, 1e-300))

    def value(self, design):
        return self.move_per_count * self._difference(design)

    def arrays(self):
        return {**super().arrays(), "up_inflation": self.up_inflation, "down_inflation": self.down_inflation}

    def restore(self, arrays, document):
        super().restore(arrays, document)
        self.up_inflation, self.down_inflation = arrays["up_inflation"], arrays["down_inflation"]

    def _scalars(self):
        return {"move_per_count": getattr(self, "move_per_count", 0.0)}


# ─── multivariate: multi-horizon ridge ─────────────────────────────────────


class Multivariate(Mechanism):
    """Ridge regression of J scaled moves (horizons h/J .. h) on the same
    features: B = (X'X + penalty I)^-1 X'Y, optionally reduced to rank r
    (B V_r V_r', V_r the leading right singular vectors of the fitted Y), with
    the residual covariance Sigma from the training residuals. Only the h
    column is scored: P(up) = Phi(y_h / sqrt(Sigma_hh (1 + x'(X'X + penalty I)^-1 x)))."""

    name = "multivariate"

    def fit(self, context: FitContext) -> None:
        p = self.parameters
        steps = designs.horizon_steps(context.view.horizon, int(p["horizon_count"]))
        targets = designs.horizon_moves(context.view, context.rows, steps)
        keep = np.all(np.isfinite(targets), axis=1)
        targets, x = targets[keep], context.design[keep, 1:]
        for column in range(targets.shape[1]):
            low, high = designs.percentile_bounds(targets[:, column])
            targets[:, column] = np.clip(targets[:, column], low, high)
        intercept = targets.mean(axis=0)
        centred = targets - intercept
        feature_mean = x.mean(axis=0)
        xc = x - feature_mean
        gram = xc.T @ xc + float(p["penalty_strength"]) * np.eye(xc.shape[1])
        inverse = np.linalg.inv(gram)
        coefficients = inverse @ xc.T @ centred
        rank = int(p["reduced_rank"])
        if 0 < rank < coefficients.shape[1]:
            _, _, right = np.linalg.svd(xc @ coefficients, full_matrices=False)
            projection = right[:rank].T @ right[:rank]
            coefficients = coefficients @ projection
        residual = centred - xc @ coefficients
        degrees = max(1, residual.shape[0] - xc.shape[1] - 1)
        covariance = residual.T @ residual / degrees
        self.steps, self.coefficients, self.intercept = steps, coefficients, intercept
        self.feature_mean, self.inverse_gram, self.covariance = feature_mean, inverse, covariance
        correlation = covariance / np.sqrt(np.outer(np.diag(covariance), np.diag(covariance)))
        self.summary = {"horizons": [int(step) for step in steps], "rank": rank or int(coefficients.shape[1]),
                        "residualStandardDeviationAtHorizon": float(math.sqrt(covariance[-1, -1]))}
        context.log(f"multivariate: {len(steps)} horizons {', '.join(str(int(s)) for s in steps)} bars; residual "
                    f"correlation of the first and the h column {correlation[0, -1]:+.2f}", "info")

    def _forecast(self, design):
        xc = design[:, 1:] - self.feature_mean
        mean = xc @ self.coefficients[:, -1] + self.intercept[-1]
        leverage = np.einsum("ij,jk,ik->i", xc, self.inverse_gram, xc)
        return mean, np.sqrt(self.covariance[-1, -1] * (1.0 + leverage))

    def direction(self, design):
        mean, deviation = self._forecast(design)
        return special.ndtr(mean / deviation)

    def value(self, design):
        return self._forecast(design)[0]

    def arrays(self):
        return {"steps": self.steps, "coefficients": self.coefficients, "intercept": self.intercept,
                "feature_mean": self.feature_mean, "inverse_gram": self.inverse_gram, "covariance": self.covariance}

    def restore(self, arrays, document):
        for name in ("steps", "coefficients", "intercept", "feature_mean", "inverse_gram", "covariance"):
            setattr(self, name, arrays[name])


MECHANISMS: dict[str, type[Mechanism]] = {cls.name: cls for cls in
                                          (Ordinal, Multinomial, GlmLink, Gamma, Poisson, Tweedie, ZeroInflatedPoisson,
                                           Multivariate)}

__all__ = ["FitContext", "MECHANISMS", "Mechanism", "fit_glm", "tweedie_zero_mass"]
