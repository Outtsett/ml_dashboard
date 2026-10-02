"""A PyMC program sampled by NUTS through nutpie (the ``pymc_student_t`` engine).

The declared generative model, on standardised features x of the most recent
``training_window_bars`` training rows:

    intercept ~ Normal(0, 1)
    w_j       ~ Normal(0, prior_scale)
    sigma     ~ HalfNormal(1)
    nu        ~ Gamma(2, 0.1)                       degrees of freedom (fat tails)
    y_i       ~ StudentT(nu, intercept + x_i'w, sigma)

``inference_method``:

- ``nuts``: nutpie's NUTS on the numba-compiled log density
  (``nutpie.compile_pymc_model(backend="numba")``). This machine has no C++
  compiler for PyTensor, so without nutpie PyMC would sample through its
  uncompiled Python backend; the engine refuses to run then instead of
  silently taking hours. The compiled model is cached per process by feature
  count; the features, target and prior scale are ``pm.Data`` and each fit
  swaps them in (``with_data``), so only the first fit pays the ~15 s compile.
  The sampler runs in the background and the fit calls
  ``reporter.checkpoint()`` every 0.2 s (Pause / Stop act; a Stop aborts it).
- ``advi``: PyMC's mean-field ADVI (``pm.fit``) with PyTensor in NUMBA mode,
  then draws from the fitted approximation (checkpointed every 250 steps).

Split R-hat and the effective sample size (``diagnostics``) are logged; an
R-hat above 1.05 is a logged warning (the run continues with those draws).
At most ``STORED_DRAWS`` draws are kept, evenly thinned. Predictive:
P(up) = mean over draws of P(y > 0 | draw) = mean of T_nu((intercept + x'w) / sigma);
the price model is the mean over draws of intercept + x'w.
"""

from __future__ import annotations

import logging
import math
import threading

import numpy as np
from scipy import special

from . import diagnostics

STORED_DRAWS = 1000
R_HAT_LIMIT = 1.05
WAIT_SECONDS = 0.2
ADVI_CHECK_EVERY = 250
_COMPILED: dict[int, object] = {}
_COMPILE_LOCK = threading.Lock()


def require_nutpie():
    try:
        import nutpie
    except ImportError as error:        # the refusal the build plan asks for
        raise RuntimeError(
            "probabilistic_programming samples with nutpie (numba backend); nutpie is not installed, and PyMC's "
            "uncompiled Python sampler is too slow to run. Install it: uv pip install --python "
            ".venv/Scripts/python.exe nutpie"
        ) from error
    return nutpie


def _model(x: np.ndarray, y: np.ndarray, prior_scale: float):
    import pymc as pm

    with pm.Model() as model:
        features = pm.Data("features", x)
        target = pm.Data("target", y)
        scale = pm.Data("prior_scale", np.asarray(prior_scale, dtype=np.float64))
        intercept = pm.Normal("intercept", 0.0, 1.0)
        weights = pm.Normal("weights", 0.0, scale, shape=x.shape[1])
        sigma = pm.HalfNormal("sigma", 1.0)
        degrees = pm.Gamma("degrees_of_freedom", 2.0, 0.1)
        pm.StudentT("move", nu=degrees, mu=intercept + pm.math.dot(features, weights), sigma=sigma, observed=target,
                    shape=features.shape[0])
    return model


def compiled_model(x: np.ndarray, y: np.ndarray, prior_scale: float, log):
    """The nutpie model for this feature count, compiled once per process, with this fit's data."""
    nutpie = require_nutpie()
    width = int(x.shape[1])
    with _COMPILE_LOCK:
        if width not in _COMPILED:
            log(f"probabilistic_programming: compiling the model for {width} features with numba (once per run)", "info")
            _COMPILED[width] = nutpie.compile_pymc_model(_model(x, y, prior_scale), backend="numba")
        base = _COMPILED[width]
    return base.with_data(features=x, target=y, prior_scale=np.asarray(prior_scale, dtype=np.float64))


def _flatten(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=np.float64)
    return values.reshape(values.shape[0] * values.shape[1], *values.shape[2:])


class ProbabilisticProgram:
    name = "pymc_student_t"

    def __init__(self, parameters: dict, seed: int) -> None:
        self.parameters = dict(parameters)
        self.seed = int(seed)
        self.summary: dict = {}

    def fit(self, x: np.ndarray, y: np.ndarray, context) -> None:
        p = self.parameters
        window = int(p["training_window_bars"])
        x, y = np.ascontiguousarray(x[-window:]), np.ascontiguousarray(y[-window:])
        if str(p["inference_method"]) == "advi":
            draws = self._advi(x, y, context)
        else:
            draws = self._nuts(x, y, context)
        total = draws["intercept"].shape[0]
        keep = np.unique(np.linspace(0, total - 1, min(STORED_DRAWS, total)).round().astype(np.int64))
        self.intercept = draws["intercept"][keep]
        self.weights = draws["weights"][keep]
        self.sigma = draws["sigma"][keep]
        self.degrees = draws["degrees_of_freedom"][keep]
        self.summary.update({"windowRows": int(x.shape[0]), "storedDraws": int(keep.size),
                             "posteriorMedianDegreesOfFreedom": float(np.median(self.degrees))})

    def _nuts(self, x, y, context) -> dict:
        nutpie = require_nutpie()
        p = self.parameters
        model = compiled_model(x, y, float(p["prior_scale"]), context.log)
        chains = int(p["chain_count"])
        sampler = nutpie.sample(model, draws=int(p["draw_count"]), tune=int(p["warmup_iterations"]), chains=chains,
                                cores=min(chains, 4), seed=self.seed, progress_bar=False, save_warmup=False,
                                target_accept=float(p["target_acceptance_rate"]), blocking=False)
        try:
            while True:
                try:
                    trace = sampler.wait(timeout=WAIT_SECONDS)
                    break
                except TimeoutError:
                    context.checkpoint()
        except BaseException:
            sampler.abort()
            raise
        posterior = trace.posterior
        raw = {name: np.asarray(posterior[name].values, dtype=np.float64)
               for name in ("intercept", "weights", "sigma", "degrees_of_freedom")}
        r_hat, effective = diagnostics.worst(raw)
        self.summary.update({"inference": "nuts", "maximumSplitRHat": r_hat, "minimumEffectiveSampleSize": effective})
        level = "warning" if not math.isfinite(r_hat) or r_hat > R_HAT_LIMIT else "info"
        context.log(f"probabilistic_programming: NUTS {chains} chains x {int(p['draw_count'])} draws, largest split "
                    f"R-hat {r_hat:.3f}, smallest effective sample size {effective:.0f}", level)
        return {name: _flatten(values) for name, values in raw.items()}

    def _advi(self, x, y, context) -> dict:
        import pymc as pm
        import pytensor

        require_nutpie()                # numba must be there for the NUMBA mode it compiles with
        p = self.parameters

        def checkpoint(approximation, losses, iteration):
            if iteration % ADVI_CHECK_EVERY == 0:
                context.checkpoint()

        pymc_logger = logging.getLogger("pymc")
        level = pymc_logger.level
        pymc_logger.setLevel(logging.WARNING)          # pm.fit reports "Finished [100%]" at INFO
        try:
            with pytensor.config.change_flags(mode="NUMBA"), _model(x, y, float(p["prior_scale"])):
                approximation = pm.fit(n=int(p["variational_iterations"]), method="advi", random_seed=self.seed,
                                       progressbar=False, callbacks=[checkpoint])
                trace = approximation.sample(STORED_DRAWS, random_seed=self.seed)
        finally:
            pymc_logger.setLevel(level)
        losses = np.asarray(approximation.hist, dtype=np.float64)
        self.summary.update({"inference": "advi", "finalNegativeEvidenceLowerBound": float(losses[-1])})
        context.log(f"probabilistic_programming: ADVI {losses.size} steps, final loss {losses[-1]:.1f}", "info")
        posterior = trace.posterior
        return {name: _flatten(np.asarray(posterior[name].values, dtype=np.float64))
                for name in ("intercept", "weights", "sigma", "degrees_of_freedom")}

    def _locations(self, x: np.ndarray) -> np.ndarray:
        return self.intercept[None, :] + x @ self.weights.T           # (rows, draws)

    def predictive(self, x: np.ndarray, groups=None) -> tuple[np.ndarray, np.ndarray]:
        location = self._locations(x)
        probability = special.stdtr(self.degrees[None, :], location / self.sigma[None, :]).mean(axis=1)
        return location.mean(axis=1), probability

    def arrays(self) -> dict:
        return {"intercept": self.intercept, "weights": self.weights, "sigma": self.sigma, "degrees": self.degrees}

    def document(self) -> dict:
        return {}

    def restore(self, arrays: dict, document: dict) -> None:
        self.intercept, self.weights = arrays["intercept"], arrays["weights"]
        self.sigma, self.degrees = arrays["sigma"], arrays["degrees"]


__all__ = ["ProbabilisticProgram", "compiled_model", "require_nutpie"]
