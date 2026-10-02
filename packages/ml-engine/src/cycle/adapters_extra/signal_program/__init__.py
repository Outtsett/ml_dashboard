"""The ``signal_program`` bridge family: mathematical programs as trainers.

Twelve optimisation specs (linear, integer, mixed-integer and quadratic
programming, interior-point, convex tail-risk, augmented Lagrangian, dual
decomposition, Lagrangian relaxation, branch and bound, greedy and submodular
selection) run in the Model Cycle by solving one program per fold: the program
allocates weights across the fold's own causal feature signals from statistics
of the TRAINING span (each signal's information coefficient with the scaled
forward move, the Ledoit-Wolf covariance of the per-signal profit streams, the
signal correlations), and the fitted model scores a bar as ``s = w . x``.

- ``signal_statistics.py``  the train-span statistics every program reads
- ``programs/``             one module per program (the solver is the mechanism)
- ``adapter.py``            ``SignalProgramAdapter``: fit, solver passes, P(up), price, save / load

A single instrument alone would make any of these programs bang-bang on the
sign of one number, so the programs allocate across signals; the solver is
exact given its inputs, which are in-sample estimates.
"""
