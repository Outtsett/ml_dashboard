"""``PathSimulatorAdapter``: the Model Cycle adapter of the path-simulator family.

Eight catalog specs share it, one generator each (the registry entry's
``direction.fixed.variant``):

    block_bootstrap   Monte Carlo simulation: a conditional block bootstrap of
                      the steps that followed the nearest training bars
    sde               stochastic differential equations: GBM, OU drift,
                      Heston, Merton, by Euler-Maruyama
    metropolis        Markov chain Monte Carlo: a Bayesian Student-t move
                      model sampled by adaptive random-walk Metropolis-Hastings,
                      refused when the chains do not converge (R-hat, arviz)
    stock_flow        system dynamics: a stock-and-flow model with a delayed
                      feedback loop fitted by differential evolution
    hawkes            discrete event simulation: a bivariate self-exciting
                      (Hawkes) process of up and down tick events simulated
                      by Ogata thinning
    event_replay      event-driven simulation: a typed event queue replays
                      rule strategies over the training span
    agent_based       agent-based modeling: heterogeneous trend, reversion,
                      informed and noise traders calibrated by the method of
                      simulated moments (CMA-ES)
    multi_agent       multi-agent simulation: independent tabular Q-learners
                      whose net flow drives simulated paths

Every generator is fitted on the fold's training span only; P(up) is a
logistic curve over its raw score fitted on the validation rows
(``bridges.calibration.ValidationCurve``, registry probability
``logistic_curve_on_validation``). As a price model (task "regression") it
returns the mean simulated move in the price target's units.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cycle.bridges import calibration, persistence, training
from cycle.bridges.base import BridgeAdapter

from . import agents, bootstrap, event_replay, hawkes, metropolis, sde, stock_flow
from .common import FitContext, Simulated, Simulator

SIMULATORS: dict[str, type[Simulator]] = {
    bootstrap.BlockBootstrap.variant: bootstrap.BlockBootstrap,
    sde.StochasticDifferentialEquation.variant: sde.StochasticDifferentialEquation,
    metropolis.MetropolisMoveModel.variant: metropolis.MetropolisMoveModel,
    stock_flow.StockFlowModel.variant: stock_flow.StockFlowModel,
    hawkes.HawkesEventSimulation.variant: hawkes.HawkesEventSimulation,
    event_replay.EventReplay.variant: event_replay.EventReplay,
    agents.AgentBasedModel.variant: agents.AgentBasedModel,
    agents.MultiAgentSimulation.variant: agents.MultiAgentSimulation,
}


def simulator_class(variant: str | None) -> type[Simulator]:
    if variant not in SIMULATORS:
        raise ValueError(f"path_simulator: unknown variant {variant!r}; valid variants: {', '.join(SIMULATORS)}")
    return SIMULATORS[variant]


class PathSimulatorAdapter(BridgeAdapter):
    model_file = "model.npz"
    state_file = "simulator.json"

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        self.simulator_class = simulator_class(self.variant)
        self.step_unit = self.simulator_class.step_unit
        self.simulator: Simulator | None = None
        self.curve: calibration.ValidationCurve | None = None

    def minimum_history(self) -> int:
        return int(self.simulator_class.minimum_history(self.parameters))

    # ── fit ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        view = self.require_market()
        simulator = self.simulator_class(self.parameters, self.seed, int(view.horizon))
        context = FitContext(features=features, view=view, train_index=train_index, validation_index=validation_index,
                             task=self.task, reporter=reporter)
        simulator.prepare(context)
        epoch_count = int(simulator.epoch_count())
        self.simulator = simulator
        self.curve = None

        def validate(epoch: int) -> training.ValidationScore:
            if epoch < epoch_count:
                return training.ValidationScore(None, None, None, None)
            simulator.finish(context)
            if validation_index.size == 0:
                if self.task == "classification":
                    self.curve = calibration.ValidationCurve(0.0, 0.0, 0)
                return training.ValidationScore(None, None, None, None)
            simulated = simulator.simulate(features, view, validation_index)
            target = np.asarray(labels, dtype=np.float64)[validation_index]
            if self.task == "classification":
                self.curve = calibration.ValidationCurve.fit(simulated.score, target)
                return training.score("classification", self.curve.apply(simulated.score), target)
            return training.score("regression", simulated.mean_move, target)

        summary = training.run_epochs(reporter, epoch_count=epoch_count, train_index=train_index,
                                      train_epoch=lambda epoch, report_batch: simulator.train_epoch(epoch, report_batch, context),
                                      validate=validate, step_unit=simulator.step_unit, name=self.key)
        self.best_iteration = summary["best_epoch"]
        details = simulator.summary()
        if self.curve is not None:
            details["validation_curve_slope"] = float(self.curve.slope)
            details["validation_curve_intercept"] = float(self.curve.intercept)
        self.fit_summary = {"trained_epochs": summary["trained_epochs"], "fit_seconds": summary["fit_seconds"],
                            "simulator": details}
        reporter.log(f"{self.key}: {self.variant} fitted on {int(train_index.size)} training rows"
                     + (f"; validation curve slope {self.curve.slope:.3f}" if self.curve is not None else ""))

    # ── predict ──
    def _simulate(self, features, index) -> Simulated:
        if self.market is None:
            raise RuntimeError(f"{self.key}: a path simulator reads the run's closes at prediction; bind the market "
                               "view (bind_market) first")
        return self.simulator.simulate(features, self.market, index)

    def _predict_probability(self, features, index) -> np.ndarray:
        return self.curve.apply(self._simulate(features, index).score)

    def _predict_value(self, features, index) -> np.ndarray:
        return self._simulate(features, index).mean_move

    def simulated_share(self, features, index) -> np.ndarray:
        """The raw share of up paths before the validation curve (NaN for the
        deterministic generators: system dynamics, event replay)."""
        self._require_fitted("simulated_share")
        return self._simulate(features, np.asarray(index, dtype=np.int64).reshape(-1)).share

    # ── save / load ──
    def _save_state(self, folder: Path) -> str:
        arrays, document = self.simulator.state()
        persistence.save_arrays(folder / self.model_file, **arrays)
        persistence.save_json(folder / self.state_file, {
            "variant": self.variant, "horizon": int(self.simulator.horizon), "simulator": document,
            "curve": None if self.curve is None else self.curve.to_dict(),
        })
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        self.simulator_class = simulator_class(self.variant)
        self.step_unit = self.simulator_class.step_unit
        document = persistence.load_json(folder / self.state_file)
        arrays = persistence.load_arrays(folder / self.model_file)
        self.simulator = self.simulator_class(self.parameters, self.seed, int(document["horizon"]))
        self.simulator.restore(arrays, document["simulator"])
        self.curve = None if document["curve"] is None else calibration.ValidationCurve.from_dict(document["curve"])

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "scipy", *self.simulator_class_libraries())

    def simulator_class_libraries(self) -> tuple[str, ...]:
        return tuple(getattr(self.simulator_class, "libraries", ()))


__all__ = ["SIMULATORS", "PathSimulatorAdapter", "simulator_class"]
