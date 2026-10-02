"""The ``policy_agent`` bridge family: policy-gradient, actor-critic,
deterministic-policy-gradient and evolutionary agents that trade the fold's
training-span reward tape (``cycle.bridges.tape``) and read P(up) off their own
policy.

    adapter.py      ``PolicyAgentAdapter``: the registry constructor, the fit
                    (tapes, rows, validation scoring), P(up), save / load
    readout.py      observation rows, the validation net reward and score
    encoders.py     the torch networks the own-loop variants train
    trainers.py     the own torch loops: REINFORCE, vanilla policy gradient,
                    one-step actor-critic, A3C (round-robin stale-weight workers),
                    Q-Prop, NAF and the multi-modal reasoning agent
    cem.py          the cross-entropy method over a linear policy (numpy)
    sb3_backend.py  Stable-Baselines3 / sb3_contrib: PPO, A2C, TRPO, SAC, DDPG, TD3

Variants (``direction.fixed.variant``): ``ppo``, ``a2c``, ``trpo``, ``sac``,
``ddpg``, ``td3`` (library), ``reinforce``, ``vanilla_policy_gradient``,
``actor_critic``, ``a3c``, ``q_prop``, ``naf``, ``modality_policy`` (own loops),
``cem``.
"""
