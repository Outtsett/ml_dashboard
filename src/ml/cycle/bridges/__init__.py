"""Shared building blocks of the Model Cycle's bridge families.

A bridge family (``cycle/adapters_extra/<family>/``) runs a catalog spec that is
not a supervised classifier — an agent, a solver, a simulator, a density, a
clustering — as a Model Cycle adapter: it fits on a fold's training span and
returns P(up) per bar. What every family shares lives here, read-only for the
family units (one owner, U0; a change goes through that owner):

    base.py             ``BridgeAdapter``: the registry constructor, the bound
                        market view, task checks, save / load plumbing
    tape.py             the reward tape (next-open fills and round-trip cost,
                        exactly as ``cycle.simulate``), the gymnasium
                        ``TapeEnvironment`` and the Stable-Baselines3 reporter callback
    calibration.py      Boltzmann temperature, Platt scaling, validation curves
    binning.py          train-quantile feature bins, target bins with bin means,
                        train-fitted cluster states
    pool.py             the unlabelled pool of a training span, block masking
                        with an embargo
    regimes.py          chronological blocks, k-means regimes, the forward filter
    groups.py           feature name -> features.json category and modality,
                        calendar channels
    rules.py            the predicate (atom) library over named raw features and
                        causal indicators, read from ``src/config/cycle_rules.json``
    persistence.py      model.json through ``models._base_metadata``; npz, json,
                        torch and joblib helpers
    training.py         the epoch loop that emits epoch_started, batch,
                        validating and epoch_finished
    parameter_names.py  the reserved parameter names and their one type

Causality is the contract of every module (each module's docstring states its
own rule): whatever a model reads at bar t comes from bars <= t, targets and
labels only from rows <= t - horizon (``MarketView.realised_until``), and a fit
reads targets only for rows of its training span (``MarketView.fit_rows``).
"""
