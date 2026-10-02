"""World-model and imagination agents for the Model Cycle (bridge family ``world_model_agent``).

``adapter.WorldModelAgentAdapter`` is the registry adapter; ``representation`` and
``dynamics`` hold the reusable blocks (``planning_agent`` imports
``RecurrentStateSpaceModel`` and ``DynamicsTransformer`` read-only); ``controllers``
the actor-critic, imagination, CMA-ES, I2A and value-iteration controllers;
``agents`` one class per variant. Importing this package imports nothing heavy:
torch is imported by the submodules.
"""
