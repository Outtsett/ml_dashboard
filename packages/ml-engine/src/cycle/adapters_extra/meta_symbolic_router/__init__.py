"""The Meta-Learned Symbolic Router's trainer (adapter key ``meta_symbolic_router``).

``adapter.MetaSymbolicRouterAdapter`` is a ``cycle.networks.NeuralAdapter``
whose ``fit`` is an episodic first-order meta-learning loop over consecutive
blocks of the training span, around the ``meta_router`` integration of the
``neuro_symbolic`` network kind (``cycle.networks_extra.neuro_symbolic``).
Prediction, save, load and trace are NeuralAdapter's own.
"""
