"""The ``policy_search`` bridge family: an optimiser is the model's trainer.

Eleven catalog specs (non-convex optimisation, differential evolution,
evolution strategies, the genetic algorithm, gradient descent, ant colony
optimisation, Bayesian optimisation, particle swarm optimisation, simulated
annealing, evolutionary decision models and symbolic regression) each run as
a Model Cycle model whose parameters are found by that optimiser on the
fold's training span. Modules:

    adapter.py      ``PolicySearchAdapter``: the fit / predict / save contract
    objective.py    ``Problem`` (a population objective: tape utility, Huber
                    or log loss) and ``LinearPolicy``
    searchers/      one module per optimiser over a linear policy
    rules.py        genetic programming of decision-rule trees (deap.gp)
    formula.py      symbolic regression (gplearn) and a numpy evaluator of its formula
    randomness.py   a private state of the process-wide random generators

The heavy libraries (scipy.optimize, cma, deap, pyswarms, scikit-optimize,
gplearn) are imported only when a fit or a load needs them; none of the
family imports torch.
"""
