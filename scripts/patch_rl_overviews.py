"""
Patch the 60 Reinforcement Learning model spec files that currently have
generic category-level Definition sections.  Replaces each ## Definition
block with a model-specific overview that describes what makes that
particular algorithm unique.

Usage:
    python scripts/patch_rl_overviews.py            # dry-run (prints diffs)
    python scripts/patch_rl_overviews.py --apply     # writes changes to disk
"""

import os, sys, re

ROOT = r"E:\source\documents\algo_models"
DRY_RUN = "--apply" not in sys.argv

# ---------------------------------------------------------------------------
# Model-specific definitions keyed by filename (without .md)
# ---------------------------------------------------------------------------
MODEL_DEFINITIONS: dict[str, str] = {
    # ── Model-Free RL > Value-Based Methods ──────────────────────────────
    "Q-Learning": (
        "**Q-Learning** is a model-free, off-policy reinforcement learning algorithm that learns "
        "the value of state-action pairs (the Q-function) without requiring a model of the environment. "
        "It updates Q-values using the Bellman optimality equation: after taking an action and observing "
        "a reward, it bootstraps from the *maximum* Q-value of the next state, regardless of the policy "
        "actually followed. This off-policy property lets the agent explore freely while still converging "
        "to the optimal action-value function.\n\n"
        "Think of it as a trader keeping a private scorecard for every (market-state, trade-action) "
        "combination. After each trade, the scorecard is updated not based on what the trader plans to "
        "do next, but on the *best possible* future outcome — so the scorecard gradually converges to "
        "the objectively best strategy."
    ),
    "SARSA (State-Action-Reward-State-Action)": (
        "**SARSA** is a model-free, on-policy reinforcement learning algorithm that updates Q-values "
        "based on the action *actually taken* in the next state, rather than the greedy maximum. "
        "The name comes from its update tuple: (S, A, R, S', A') — it observes the current state, "
        "the action taken, the reward received, the next state, and the next action chosen by the "
        "current policy. Because it tracks its own behavior, SARSA is more conservative than Q-Learning "
        "and naturally accounts for exploration costs.\n\n"
        "Think of it as a trader who updates their scorecard based on the trade they *actually* placed "
        "next — including any exploratory or suboptimal moves — rather than pretending they would always "
        "pick the theoretical best. This makes SARSA safer in risky environments where exploration can "
        "be costly."
    ),
    "Deep Q-Network (DQN)": (
        "**Deep Q-Network (DQN)** extends tabular Q-Learning to high-dimensional state spaces by "
        "approximating the Q-function with a deep neural network. Two key innovations make it stable: "
        "(1) an **experience replay buffer** that stores past transitions and samples mini-batches "
        "uniformly, breaking temporal correlations; and (2) a **target network** — a delayed copy of "
        "the Q-network updated periodically — that provides stable bootstrap targets during training. "
        "DQN was the first algorithm to achieve human-level performance across dozens of Atari games "
        "from raw pixel input (Mnih et al., 2015).\n\n"
        "Think of it as upgrading the trader's hand-written scorecard to a deep neural network that "
        "can read complex charts directly, plus keeping a journal of past trades to study randomly "
        "(replay buffer) and checking scores against a slightly outdated but stable copy of itself "
        "(target network) to avoid chasing noise."
    ),
    "Double DQN": (
        "**Double DQN** addresses DQN's tendency to overestimate Q-values by decoupling action "
        "selection from action evaluation. Standard DQN uses the same network to both pick the best "
        "next action and evaluate its value, which amplifies noise into systematic overestimation. "
        "Double DQN fixes this by using the online network to *select* the greedy action in the next "
        "state, but the target network to *evaluate* that action's Q-value. This simple change "
        "significantly reduces overestimation bias and improves learning stability (van Hasselt et al., "
        "2016).\n\n"
        "Think of it as having two analysts: one picks which trades look best, the other independently "
        "scores them. Neither can inflate their own picks, so the final decision is more grounded."
    ),
    "Dueling DQN": (
        "**Dueling DQN** modifies the DQN architecture by splitting the final layers into two streams: "
        "one that estimates the **state value** V(s) (how good is this state in general?) and one that "
        "estimates the **advantage** A(s, a) for each action (how much better is this action than "
        "average?). The streams are combined via Q(s,a) = V(s) + A(s,a) - mean(A). This decomposition "
        "allows the network to learn which states are valuable without having to evaluate every action, "
        "which is especially useful when many actions have similar effects (Wang et al., 2016).\n\n"
        "Think of it as a trader who separately assesses 'how good is this market regime?' (state value) "
        "and 'given this regime, how much edge does going long vs short give me?' (advantage). The two "
        "judgments combined produce better trade decisions, especially when only quiet regime assessment "
        "matters and the action choice barely moves the needle."
    ),
    # ── Model-Free RL > Actor-Critic Methods ─────────────────────────────
    "Actor-Critic": (
        "**Actor-Critic** is a hybrid RL architecture that maintains two separate components: an "
        "**actor** (a policy network that selects actions) and a **critic** (a value network that "
        "evaluates how good those actions are). The critic's value estimate is used to compute a "
        "lower-variance advantage signal that updates the actor. This combines the stability of "
        "value-based methods with the flexibility of policy gradient methods. Unlike pure REINFORCE, "
        "the critic provides a learned baseline that dramatically reduces gradient variance.\n\n"
        "Think of it as a trading duo: the actor is the trader placing orders, and the critic is a "
        "risk analyst providing instant P&L feedback. The trader adjusts strategy based on the analyst's "
        "evaluation rather than waiting until end-of-day to see cumulative results."
    ),
    "Advantage Actor-Critic (A2C)": (
        "**Advantage Actor-Critic (A2C)** is a synchronous variant of the actor-critic framework that "
        "uses the **advantage function** A(s,a) = Q(s,a) - V(s) to update the policy. Multiple "
        "parallel workers collect experience simultaneously, but updates are batched synchronously — "
        "all workers finish their rollouts before a single gradient update is applied. This avoids the "
        "stale-gradient problem of asynchronous methods while still benefiting from parallel data "
        "collection. The advantage formulation centers the reward signal, reducing variance.\n\n"
        "Think of it as running multiple paper-trading accounts in parallel, then gathering all their "
        "results simultaneously to make one well-informed strategy update — no stragglers using "
        "outdated information."
    ),
    "Asynchronous Advantage Actor-Critic (A3C)": (
        "**A3C** runs multiple actor-learner threads in parallel, each interacting with its own copy "
        "of the environment. Each thread computes gradients locally and asynchronously pushes them to a "
        "shared global network, then pulls updated weights. The diversity of experience across threads "
        "naturally decorrelates training data (replacing the need for a replay buffer) and parallelism "
        "speeds convergence. A3C was one of the first algorithms to train effectively on a single "
        "multi-core CPU, making deep RL accessible without GPUs (Mnih et al., 2016).\n\n"
        "Think of it as a group of traders at different desks, each trading independently, periodically "
        "sharing their best insights with a shared playbook. The diversity of their experiences means "
        "the playbook improves quickly without anyone getting stuck in a single market pattern."
    ),
    "Q-Prop": (
        "**Q-Prop** is an actor-critic method that combines the sample efficiency of off-policy "
        "critics with the stability of on-policy policy gradients. It uses a learned Q-function as "
        "an **analytic control variate** — the first-order Taylor expansion of the critic around the "
        "current action provides a bias-correction term that reduces the variance of the policy "
        "gradient without introducing bias. The result is a method that interpolates between REINFORCE "
        "and deterministic policy gradient, getting the best of both worlds (Gu et al., 2017).\n\n"
        "Think of it as a trader who follows their gut instinct (policy gradient) but uses a "
        "statistical model's local prediction (the Q-function's Taylor expansion) to smooth out the "
        "noise. The model doesn't override the gut — it just steadies the hand."
    ),
    "Soft Actor-Critic (SAC)": (
        "**Soft Actor-Critic (SAC)** is an off-policy actor-critic algorithm based on the **maximum "
        "entropy** framework: it simultaneously maximizes expected return *and* policy entropy "
        "(randomness). The entropy bonus encourages exploration and makes the policy robust to "
        "perturbations. SAC uses twin Q-networks (taking the minimum to combat overestimation), "
        "automatic temperature tuning for the entropy coefficient, and a squashed Gaussian policy "
        "for continuous actions. It is widely regarded as one of the most sample-efficient and stable "
        "continuous-control RL algorithms (Haarnoja et al., 2018).\n\n"
        "Think of it as a trader who intentionally injects randomness into their strategy, "
        "proportional to how uncertain the market is. In volatile regimes, the trader explores more "
        "options; in clear trends, they zero in. The twin analysts prevent overconfidence."
    ),
    # ── Model-Free RL > Deterministic Policy Gradient Methods ────────────
    "Deep Deterministic Policy Gradient (DDPG)": (
        "**DDPG** extends DQN to continuous action spaces by combining a deterministic policy network "
        "(the actor) with a Q-value critic. The actor directly outputs a continuous action vector, and "
        "the critic evaluates it. Training uses target networks for both actor and critic (soft-updated), "
        "an experience replay buffer, and the deterministic policy gradient theorem to update the actor "
        "in the direction that maximizes the critic's Q-value. Exploration is achieved by adding noise "
        "(typically Ornstein-Uhlenbeck process) to the actor's output (Lillicrap et al., 2016).\n\n"
        "Think of it as a trader who outputs an exact position size (not just buy/sell) by combining "
        "two systems: one that proposes the trade size (actor) and one that estimates the expected P&L "
        "of that exact size (critic). Random jitter is added during practice to discover better sizes."
    ),
    "Twin Delayed Deep Deterministic Policy Gradient (TD3)": (
        "**TD3** improves DDPG with three targeted fixes for overestimation and variance: "
        "(1) **Twin critics** — two independent Q-networks, taking the minimum to reduce overestimation; "
        "(2) **Delayed policy updates** — the actor is updated less frequently than the critics, giving "
        "the value estimates time to stabilize; (3) **Target policy smoothing** — noise is added to "
        "target actions when computing critic targets, regularizing the value function across similar "
        "actions. These simple changes significantly improve stability and performance over DDPG "
        "(Fujimoto et al., 2018).\n\n"
        "Think of it as upgrading the DDPG trading duo: now two independent analysts score trades "
        "(taking the conservative one), the trader only adjusts strategy every few cycles, and the "
        "analysts deliberately blur nearby trade scenarios to avoid overfitting to exact price levels."
    ),
    "Normalized Advantage Function (NAF)": (
        "**Normalized Advantage Function (NAF)** enables Q-Learning in continuous action spaces "
        "without a separate actor network. It parameterizes the Q-function so that the advantage "
        "is a **quadratic** function of the action: A(s,a) = -½(a - μ(s))ᵀ P(s) (a - μ(s)), where "
        "μ(s) is the optimal action and P(s) is a state-dependent positive-definite matrix. Because "
        "the optimum is analytically available at μ(s), no separate policy optimization is needed — "
        "the greedy action is simply the network's output (Gu et al., 2016).\n\n"
        "Think of it as a model that shapes the profit curve as a smooth hill for each market state, "
        "with the peak always at the best position size. There's no need for a separate trader — the "
        "optimal trade is always right at the hilltop."
    ),
    # ── Model-Free RL > Distributional & Exploration Enhancements ────────
    "Rainbow DQN": (
        "**Rainbow DQN** combines six independent improvements to DQN into a single integrated agent: "
        "(1) Double Q-learning, (2) Prioritized experience replay, (3) Dueling architecture, "
        "(4) Multi-step bootstrap targets (n-step returns), (5) Distributional RL (C51 value "
        "distribution), and (6) Noisy Networks for exploration. Each component addresses a different "
        "weakness of vanilla DQN, and their combination achieves state-of-the-art performance that "
        "exceeds any individual improvement alone (Hessel et al., 2018).\n\n"
        "Think of it as the ultimate 'greatest hits' trading system: double-checking prevents "
        "overconfidence, important trades get studied more, the regime-vs-action split sharpens "
        "decisions, multi-day returns give perspective, full P&L distributions replace point estimates, "
        "and built-in exploration noise replaces ad-hoc randomness."
    ),
    "Noisy DQN": (
        "**Noisy DQN** (NoisyNet-DQN) replaces ε-greedy exploration with **learned parametric noise** "
        "injected directly into the network weights. Each weight has a learnable noise parameter, so "
        "the network decides *where* and *how much* to explore. During training, the noise drives "
        "state-dependent exploration; as the agent becomes more certain, the noise parameters shrink "
        "automatically. This replaces crude random exploration with exploration that adapts to what "
        "the agent already knows (Fortunato et al., 2018).\n\n"
        "Think of it as a trader whose randomness is built into their neural wiring rather than a "
        "coin flip. In well-understood market conditions, the built-in randomness fades; in novel "
        "situations, it amplifies — all learned automatically."
    ),
    # ── Model-Free RL > Policy Gradient Methods ──────────────────────────
    "Vanilla Policy Gradient": (
        "**Vanilla Policy Gradient** (VPG) is the foundational policy gradient algorithm that directly "
        "optimizes a parameterized policy by estimating gradients of expected return. After collecting a "
        "batch of trajectories, the policy parameters are updated in the direction that increases the "
        "probability of actions that led to higher-than-average returns. The gradient is estimated using "
        "the REINFORCE estimator with a learned value function baseline to reduce variance. VPG is "
        "on-policy: each batch of data is used for exactly one update, then discarded.\n\n"
        "Think of it as a trader who runs the same strategy for a week, reviews all trades, and then "
        "adjusts the strategy to do more of what worked and less of what didn't — then starts fresh "
        "the next week with the updated strategy."
    ),
    "REINFORCE": (
        "**REINFORCE** (Williams, 1992) is the original Monte Carlo policy gradient algorithm. It "
        "collects complete episode trajectories, computes the total discounted return for each time "
        "step, and updates the policy to increase the probability of actions that led to high returns. "
        "No value function or critic is needed — it relies solely on sampled returns. While unbiased, "
        "REINFORCE suffers from high variance because the full return is used without bootstrapping. "
        "A baseline (often the mean return or a learned value function) can reduce variance.\n\n"
        "Think of it as a trader who waits until market close, tallies total P&L, and retroactively "
        "boosts the probability of every decision made during the winning trades and reduces it for "
        "losing ones. Simple but noisy — a single outlier trade can distort the whole day's lesson."
    ),
    "Proximal Policy Optimization (PPO)": (
        "**Proximal Policy Optimization (PPO)** constrains policy updates to a trust region using a "
        "clipped surrogate objective rather than expensive second-order optimization. The key idea: "
        "compute the probability ratio r(θ) = π_new(a|s) / π_old(a|s) and clip it to [1-ε, 1+ε], "
        "preventing the policy from changing too drastically in a single update. PPO alternates "
        "between sampling data through interaction and optimizing the clipped objective with "
        "multiple epochs of mini-batch SGD. It achieves competitive performance with much simpler "
        "implementation than TRPO (Schulman et al., 2017).\n\n"
        "Think of it as a trader who limits each strategy adjustment to small steps — never changing "
        "position sizing or entry rules by more than ε% at a time. This prevents overcorrection after "
        "a lucky or unlucky streak and keeps the learning process stable."
    ),
    "Trust Region Policy Optimization (TRPO)": (
        "**Trust Region Policy Optimization (TRPO)** guarantees monotonic policy improvement by "
        "constraining each update to a trust region defined by the KL divergence between old and new "
        "policies. It solves a constrained optimization problem: maximize the expected advantage subject "
        "to KL(π_old || π_new) ≤ δ. This is approximated using conjugate gradient and line search to "
        "find the largest step that satisfies the constraint. TRPO provides theoretical guarantees that "
        "each update improves the policy, at the cost of computational complexity (Schulman et al., "
        "2015).\n\n"
        "Think of it as a trader who can make any strategy change they want, but must prove — via a "
        "mathematical constraint — that the new strategy isn't too different from the current one. "
        "It's like having a compliance department that approves changes only if they're within bounds."
    ),
    # ── Model-Free RL > Evolutionary Methods ─────────────────────────────
    "Cross-Entropy Method (CEM)": (
        "**Cross-Entropy Method (CEM)** is a derivative-free optimization algorithm that maintains a "
        "distribution over policy parameters (typically Gaussian), samples a population of candidate "
        "policies, evaluates them by total episode return, selects the top-performing elite fraction, "
        "and refits the distribution to the elites. This iterative process narrows the search "
        "distribution toward high-performing regions of parameter space. CEM requires no gradient "
        "computation, making it viable for non-differentiable objectives and parallel evaluation "
        "(Rubinstein & Kroese, 2004).\n\n"
        "Think of it as running 100 random trading strategies, keeping the top 10 performers, "
        "generating the next 100 strategies centered around those winners, and repeating. Each "
        "generation, the strategies converge toward something profitable without ever computing "
        "a gradient."
    ),
    # ── Model-Based RL > Planning-Based Agents ───────────────────────────
    "Dyna-Q": (
        "**Dyna-Q** integrates model-free learning with model-based planning in a single loop. After "
        "each real environment step, the agent: (1) updates its Q-values from the real transition "
        "(model-free), (2) updates a learned environment model, and (3) performs *n* simulated planning "
        "steps — sampling previously visited states, generating imagined transitions from the model, "
        "and performing Q-learning updates on these simulated experiences. This dramatically improves "
        "sample efficiency by extracting more learning from each real interaction (Sutton, 1991).\n\n"
        "Think of it as a trader who, after each real trade, mentally replays similar past scenarios "
        "from their model of the market and refines their strategy on those imagined trades too — "
        "getting many lessons from each single real experience."
    ),
    "Model Predictive Control (MPC)": (
        "**Model Predictive Control (MPC)** uses a learned dynamics model to plan actions by "
        "optimizing a trajectory over a finite prediction horizon at each time step. At every step: "
        "(1) the model predicts future states for many candidate action sequences, (2) the sequence "
        "with the best predicted cumulative reward is selected, (3) only the first action is executed, "
        "and (4) the process repeats from the new state (receding horizon). MPC can leverage any "
        "trajectory optimizer (random shooting, CEM, gradient-based) and naturally handles constraints "
        "and changing objectives.\n\n"
        "Think of it as a trader who, before each order, simulates hundreds of possible trade "
        "sequences over the next N bars using their market model, picks the best-looking sequence, "
        "but only executes the first trade — then re-plans from the new market state."
    ),
    "MuZero": (
        "**MuZero** learns a dynamics model entirely in latent space — it does not reconstruct "
        "observations. Three learned components work together: a **representation function** encodes "
        "observations into latent states, a **dynamics function** predicts next latent states and "
        "rewards given an action, and a **prediction function** outputs policy and value predictions "
        "from latent states. Planning is performed via Monte Carlo Tree Search (MCTS) in this latent "
        "space. MuZero matches AlphaZero's performance in Go, chess, and shogi while also mastering "
        "visually complex Atari games — all without knowing the rules (Schrittwieser et al., 2020).\n\n"
        "Think of it as a trader who builds an internal mental model of market dynamics — not "
        "predicting exact candles, but predicting abstract state transitions and rewards. They then "
        "plan by searching through this mental model many steps ahead, like a chess player thinking "
        "through move sequences in their head."
    ),
    "PlaNet (Planning Network)": (
        "**PlaNet** (Deep Planning Network) learns a world model in latent space and plans entirely "
        "through learned dynamics without a policy network. It uses a Recurrent State-Space Model "
        "(RSSM) combining deterministic and stochastic components to capture both predictable dynamics "
        "and environmental uncertainty. Planning uses CEM in the latent space over a finite horizon. "
        "PlaNet demonstrated that pure planning with a learned model can match model-free methods "
        "while using 50× less environment interaction (Hafner et al., 2019).\n\n"
        "Think of it as a trader who builds a mental simulation of the market (the world model) and "
        "plans every decision by running hundreds of 'what if' scenarios in that simulation — never "
        "learning a fixed strategy, always planning fresh from the current state."
    ),
    "SimPLe (Simulated Policy Learning)": (
        "**SimPLe** (Simulated Policy Learning) trains a video-prediction world model on real "
        "environment frames, then learns a policy entirely within the simulated environment generated "
        "by the model. The agent alternates between collecting real data, training the world model, "
        "and training the policy on simulated rollouts. SimPLe achieves strong Atari performance "
        "with only 100K real environment frames (roughly 2 hours of play), demonstrating extreme "
        "sample efficiency through model-based simulation (Kaiser et al., 2020).\n\n"
        "Think of it as building a market simulator from 2 hours of real data, then training a "
        "trading bot for thousands of hours inside that simulator. The bot gets most of its "
        "experience from the simulation, making real market time extremely efficient."
    ),
    # ── Model-Based RL > Hybrid & Imagination-Based Agents ───────────────
    "Hybrid Model-Free & Model-Based Agent": (
        "**Hybrid Model-Free/Model-Based** agents combine the sample efficiency of model-based learning "
        "with the asymptotic performance of model-free algorithms. A typical architecture maintains both "
        "a learned environment model and a model-free policy: the model generates synthetic experience "
        "to accelerate early learning, while the model-free component corrects for model inaccuracies "
        "as training progresses. Approaches include using model rollouts to augment replay buffers "
        "(MBPO), learning when to trust the model vs. direct experience, or blending model-based value "
        "estimates with model-free TD targets.\n\n"
        "Think of it as a trader who uses a market simulator for initial strategy development "
        "(model-based) but gradually transitions to learning from live trades (model-free) as they "
        "discover where the simulator is inaccurate."
    ),
    "Imagination-Augmented Agents (I2A)": (
        "**Imagination-Augmented Agents** learn a world model and use multi-step imagination rollouts "
        "as *additional input features* to a model-free policy. Rather than planning in model space "
        "directly, the agent 'imagines' several possible futures using the model, encodes each "
        "imagined trajectory with an LSTM, and concatenates these imagination encodings with the "
        "current observation before passing everything to a policy network. This lets the agent benefit "
        "from imagination even when the model is imperfect — the policy network learns which aspects "
        "of imagination to trust (Racanière et al., 2017).\n\n"
        "Think of it as a trader who mentally simulates several 'what if' scenarios for the next "
        "few bars, distills each scenario into a summary, and feeds those summaries alongside the "
        "real chart data to their decision-making brain."
    ),
    "World Models (Ha and Schmidhuber)": (
        "**World Models** decompose the RL problem into three components: a **vision model** (VAE) that "
        "compresses observations into compact latent codes, a **memory model** (MDN-RNN) that predicts "
        "future latent states, and a **controller** (small linear policy) that acts based on the "
        "combined latent state and memory. The key insight is that the controller can be trained "
        "entirely *inside the dream* — in the hallucinated environment generated by the vision and "
        "memory models — and still transfer to the real environment. This was one of the first "
        "demonstrations of 'dreaming to learn' (Ha & Schmidhuber, 2018).\n\n"
        "Think of it as a trader whose brain has three parts: eyes that compress charts into patterns, "
        "memory that predicts what comes next, and a tiny decision module that trains by 'dreaming' "
        "thousands of market scenarios each night."
    ),
    # ── Model-Based RL > Classical & MPC Approaches ──────────────────────
    "Adaptive Local Models (ALM)": (
        "**Adaptive Local Models** learn the environment dynamics using a collection of locally linear "
        "models rather than a single global neural network. For each query state, the most relevant "
        "local models are combined (often weighted by proximity) to predict the next state. This "
        "approach provides better extrapolation guarantees and uncertainty quantification than global "
        "models, since each local model is accurate only in its region and knows its boundaries. "
        "ALMs are particularly effective for control tasks where dynamics are approximately linear "
        "within small regions of state space.\n\n"
        "Think of it as having specialist analysts for different market regimes — one for trending "
        "markets, one for range-bound, one for high-volatility breakouts. Each analyst is accurate "
        "in their specialty, and consulting the right one for the current regime gives better "
        "predictions than a single generalist."
    ),
    # ── Model-Based RL > Latent Dynamics & Representation Models ─────────
    "Dreamer (V1-V3)": (
        "**Dreamer** (V1 → V2 → V3) is a family of model-based RL agents that learn behaviors "
        "purely from imagined trajectories in latent space. Dreamer learns a world model using RSSM "
        "(Recurrent State-Space Model) that jointly models deterministic and stochastic dynamics, "
        "then trains an actor-critic *inside the world model's imagination*. V2 added discrete "
        "latent states and KL balancing for more robust models; V3 introduced symlog predictions "
        "and reward normalization to master diverse domains from a single hyperparameter set. "
        "Dreamer V3 is considered the first general algorithm to match specialized model-free methods "
        "across continuous control, Atari, and Minecraft (Hafner et al., 2020-2023).\n\n"
        "Think of it as a trader who builds increasingly sophisticated mental market simulators — "
        "V1 dreams in fuzzy pictures, V2 dreams with discrete market states, V3 dreams so well "
        "it can trade profitably across stocks, futures, and crypto from a single model."
    ),
    "DeepMDP": (
        "**DeepMDP** learns a compressed latent representation of the environment that provably "
        "preserves the information needed for optimal decision-making. It trains an encoder to map "
        "observations to latent states such that (1) reward predictions from latent states are "
        "accurate, and (2) latent transitions match the true dynamics in a distributional sense. "
        "The key theoretical contribution is bounding the suboptimality of policies learned in the "
        "latent space relative to the true MDP (Gelada et al., 2019). This ensures the compressed "
        "representation doesn't throw away decision-relevant information.\n\n"
        "Think of it as a data compression system for market states that comes with a mathematical "
        "guarantee: any trading strategy learned from the compressed view will be nearly as good as "
        "one learned from the raw, full-resolution data."
    ),
    "Latent Dynamics Model (RSSM)": (
        "**Recurrent State-Space Model (RSSM)** is a latent dynamics architecture that maintains "
        "both a deterministic recurrent path (GRU) and a stochastic latent variable at each time "
        "step. The deterministic path carries forward persistent information, while the stochastic "
        "component captures environmental randomness and multi-modal transitions. An observation "
        "model reconstructs observations from latent states, and a posterior network refines "
        "predictions when observations are available. RSSM is the backbone of PlaNet, Dreamer, "
        "and many other model-based RL methods (Hafner et al., 2019).\n\n"
        "Think of it as a market model with two channels: a steady trend tracker (deterministic) "
        "and a random surprise injector (stochastic). Together they capture both the predictable "
        "drift and the unexpected jumps that make market prediction hard."
    ),
    "State-Space Abstraction Model": (
        "**State-Space Abstraction Models** learn to group similar low-level states into abstract "
        "macro-states, enabling faster planning and better generalization. The abstraction is learned "
        "so that the abstract MDP preserves key properties: transitions, rewards, and optimal policies "
        "in the abstract space should correspond to valid behavior in the original space. Common "
        "approaches include bisimulation metrics (grouping states with identical long-term behavior), "
        "information-theoretic bottlenecks, and learned discretization. Abstraction reduces the "
        "effective state space, making planning and value iteration computationally tractable in "
        "large environments.\n\n"
        "Think of it as collapsing thousands of possible market configurations into a manageable set "
        "of regimes — 'uptrend with low vol', 'breakout', 'choppy range' — so the agent can plan "
        "at the regime level instead of the bar-by-bar level."
    ),
    "Temporal Predictive Coding Agent": (
        "**Temporal Predictive Coding** agents learn representations by predicting future latent "
        "states from current ones — the prediction error itself becomes the learning signal. Inspired "
        "by neuroscience's predictive coding theory, the agent learns a hierarchy of predictions at "
        "different time scales. Representations that accurately predict the future carry the most "
        "decision-relevant information. This self-supervised objective produces state representations "
        "well-suited for downstream RL, often outperforming representations learned from reward "
        "signals alone.\n\n"
        "Think of it as training a market analyst whose only job is predicting what the next few "
        "bars will look like. The analyst's internal mental model — shaped by constantly trying to "
        "predict the future — becomes an excellent basis for trading decisions, even though the "
        "analyst was never told about P&L."
    ),
    "Variational World Model": (
        "**Variational World Models** combine variational autoencoders (VAEs) with recurrent dynamics "
        "models to learn a compressed, generative model of environment dynamics. Observations are "
        "encoded into a latent space using a VAE's recognition network, and a recurrent model learns "
        "to predict transitions between latent states. The variational objective (ELBO) balances "
        "reconstruction accuracy with latent space regularity, enabling diverse trajectory sampling "
        "and uncertainty-aware planning. This approach generates smoother, more coherent imagined "
        "futures than deterministic alternatives.\n\n"
        "Think of it as building a generative market simulator that can produce realistic, diverse "
        "'alternate history' scenarios — not just one predicted future, but a range of plausible "
        "outcomes weighted by likelihood, useful for stress-testing trading strategies."
    ),
    "Latent Imagination Policy Network": (
        "**Latent Imagination Policy Network** learns a policy by performing gradient-based "
        "optimization through imagined latent trajectories. Unlike Dyna-style planning (which "
        "applies model-free updates to simulated data), this approach backpropagates policy gradients "
        "directly through the differentiable world model's predicted trajectory. The policy is "
        "optimized to maximize the total predicted return over the imagined rollout, making it "
        "effectively a learned model-predictive controller. This requires a differentiable dynamics "
        "model but enables very efficient credit assignment.\n\n"
        "Think of it as a trader who doesn't just simulate scenarios and pick the best — they "
        "use calculus to trace exactly how each small decision compounds through the imagined "
        "future, optimizing the entire trade sequence end-to-end."
    ),
    # ── Model-Based RL > Probabilistic & Uncertainty-Based Models ────────
    "Probabilistic Ensembles with Trajectory Sampling (PETS)": (
        "**PETS** learns an ensemble of probabilistic neural networks to model environment dynamics, "
        "then plans using trajectory sampling (TS) within CEM-based optimization. Each ensemble member "
        "outputs a Gaussian distribution over next states, and trajectory samples propagate through "
        "*different* ensemble members at each step, capturing both aleatoric (per-model) and epistemic "
        "(across-model) uncertainty. This uncertainty awareness prevents the planner from exploiting "
        "regions where the model is inaccurate — a common failure mode of model-based RL. PETS matches "
        "model-free methods with 100× fewer samples (Chua et al., 2018).\n\n"
        "Think of it as consulting a panel of market analysts who each give a probabilistic forecast. "
        "When they agree, the trader acts confidently; when they disagree, the trader stays cautious. "
        "This self-awareness of uncertainty prevents overtrading in novel conditions."
    ),
    # ── Model-Based RL > Transformers & Sequence Models ──────────────────
    "Action-Conditioned Dynamics Transformer": (
        "**Action-Conditioned Dynamics Transformers** use a Transformer architecture to model "
        "environment dynamics as a sequence prediction problem. Given a history of (state, action) "
        "pairs, the Transformer's self-attention mechanism captures long-range dependencies in "
        "the dynamics trajectory. The model predicts the next state conditioned on the chosen action, "
        "leveraging the Transformer's ability to attend to any relevant past event — not just the "
        "most recent state. This is particularly powerful in environments with long-term dependencies "
        "or partial observability.\n\n"
        "Think of it as a market dynamics model that can look back at any relevant historical event "
        "— earnings announcements, FOMC meetings, or distant support levels — when predicting how "
        "the market will respond to a new trade, rather than only considering the last few bars."
    ),
    "Latent Planning with Transformers": (
        "**Latent Planning with Transformers** frames RL as a sequence modeling problem, using "
        "Transformers to model trajectories in a latent space. The architecture encodes "
        "(state, action, reward) tuples as tokens, uses self-attention to capture long-horizon "
        "dependencies, and generates optimal action sequences by conditioning on desired returns "
        "(similar to Decision Transformer). Planning happens by leveraging the Transformer's "
        "sequence completion capability — given a desired return, it 'autocompletes' the trajectory "
        "of actions that achieves it.\n\n"
        "Think of it as an AI that reads the trading journal up to today, is told 'achieve 20% "
        "return over the next quarter', and autocompletes the sequence of trades that would "
        "accomplish that goal — like a language model completing a sentence, but for trading actions."
    ),
    "Neural ODE-based Dynamics Learner": (
        "**Neural ODE-based Dynamics Learners** model environment transitions as continuous-time "
        "differential equations parameterized by neural networks. Instead of predicting discrete "
        "next-state transitions, the model defines dz/dt = f_θ(z, a) and integrates forward using "
        "an ODE solver (with adjoint-method backpropagation for memory efficiency). This captures "
        "smooth, physically plausible dynamics, handles irregular time steps naturally, and provides "
        "exact gradients through the dynamics model for policy optimization (Chen et al., 2018).\n\n"
        "Think of it as modeling the market not as discrete bar-to-bar jumps but as a smooth "
        "continuous flow — like tracking a river's current rather than a series of snapshots. This "
        "natural handling of continuous time makes it ideal for modeling dynamics at any time resolution."
    ),
    # ── Meta-RL & Hierarchical RL > Hierarchical Control Architectures ───
    "Feudal Reinforcement Learning": (
        "**Feudal Reinforcement Learning** (FeUdal Networks / FuN) introduces a manager-worker "
        "hierarchy where a high-level **manager** sets abstract goals in a learned latent direction "
        "space, and a low-level **worker** executes primitive actions to achieve those directional "
        "goals. The manager operates at a coarser time scale (every c steps) and is rewarded by the "
        "environment, while the worker is rewarded by the manager based on how well it follows the "
        "goal direction. This temporal and spatial abstraction enables solving long-horizon tasks "
        "where flat policies struggle (Vezhnevets et al., 2017, extending Dayan & Hinton, 1993).\n\n"
        "Think of it as a portfolio manager (high-level) who sets weekly sector allocation goals, "
        "and a day-trader (low-level) who executes the minute-by-minute trades to achieve those "
        "goals. Each works at their natural time scale."
    ),
    "HI-MAP (Hierarchical Imitation of Mixed Agent Policies)": (
        "**HI-MAP** learns hierarchical policies from demonstrations of mixed agent behaviors. "
        "It combines imitation learning with hierarchical RL to decompose complex observed behaviors "
        "into a hierarchy of reusable sub-policies. A high-level policy selects which sub-policy to "
        "activate, and each sub-policy is a specialist trained on a specific behavior mode extracted "
        "from the demonstrations. This enables learning from diverse, multi-modal expert data where "
        "different demonstrations may use fundamentally different strategies for the same task.\n\n"
        "Think of it as studying the trade logs of multiple successful traders with different styles "
        "(trend followers, mean-reverters, scalpers), automatically identifying each style as a "
        "sub-strategy, and learning a meta-controller that switches between styles based on "
        "market conditions."
    ),
    "Hierarchical DQN (h-DQN)": (
        "**Hierarchical DQN (h-DQN)** implements a two-level hierarchy: a **meta-controller** that "
        "selects subgoals from a set of intrinsic goals, and a **controller** that executes primitive "
        "actions to achieve the selected subgoal. The meta-controller operates over extended time "
        "periods and receives extrinsic environment rewards, while the controller receives intrinsic "
        "rewards for subgoal completion. Both levels use DQN. This decomposition enables h-DQN to "
        "solve tasks requiring long sequences of coordinated decisions that flat DQN cannot master "
        "(Kulkarni et al., 2016).\n\n"
        "Think of it as a two-tier trading system: a strategic layer that picks trade setups (e.g., "
        "'execute a breakout entry on ES'), and a tactical layer that handles the precise timing and "
        "sizing to complete each setup. Each layer learns its own Q-values."
    ),
    "Multi-Level Policy Learning": (
        "**Multi-Level Policy Learning** extends hierarchical RL to three or more levels of temporal "
        "and spatial abstraction. Each level operates at a different time scale: the highest level "
        "sets long-horizon strategic objectives, intermediate levels decompose these into tactical "
        "sub-goals, and the lowest level executes primitive actions. Information flows both top-down "
        "(goal setting) and bottom-up (state reporting). Multi-level structures are essential for "
        "problems where the gap between high-level goals and low-level actions spans many time steps.\n\n"
        "Think of it as a multi-desk trading operation: the CIO sets quarterly objectives, portfolio "
        "managers translate those into weekly trade plans, and execution traders handle the intra-day "
        "order flow — each level focusing on its natural scope."
    ),
    "Option-Critic Architecture": (
        "**Option-Critic** learns options (temporally extended actions with initiation sets, "
        "internal policies, and termination conditions) end-to-end *without* requiring predefined "
        "subgoals. The architecture derives policy gradient theorems for both the intra-option policy "
        "(what to do while executing an option) and the termination function (when to stop). A "
        "policy-over-options selects which option to execute. All three components are learned "
        "simultaneously from a single reward signal, enabling the agent to discover its own temporal "
        "abstractions during training (Bacon et al., 2017).\n\n"
        "Think of it as a trader who automatically discovers reusable 'trade playbooks' — each "
        "with a clear entry condition, execution style, and exit trigger — learned entirely from "
        "P&L feedback without anyone pre-defining what the playbooks should be."
    ),
    # ── Meta-RL & Hierarchical RL > Latent Skill Embedding & Transfer ────
    "Composable Skill Transfer Framework": (
        "**Composable Skill Transfer** learns a library of modular, reusable skills that can be "
        "composed to solve new tasks without retraining. Each skill is a compact policy specializing "
        "in a particular behavior, and a composition mechanism (sequential chaining, parallel blending, "
        "or hierarchical nesting) combines skills as building blocks. Transfer happens by reusing "
        "previously learned skills in novel combinations for unseen tasks, dramatically reducing "
        "training time on new objectives.\n\n"
        "Think of it as a trader who has mastered individual skills — reading order flow, managing "
        "risk, timing entries — and can rapidly compose them into new strategies for new markets "
        "without learning each from scratch."
    ),
    "Hierarchical Latent Variable Model": (
        "**Hierarchical Latent Variable Models** for RL learn a multi-level latent representation "
        "where higher-level variables capture long-term behavior patterns and lower-level variables "
        "represent fine-grained action details. A latent variable at each level is inferred using "
        "variational inference, conditioning on the level above. This produces a structured skill "
        "embedding space where similar behaviors cluster together, enabling skill interpolation, "
        "transfer, and systematic exploration of the behavior space.\n\n"
        "Think of it as organizing trading strategies into a hierarchy: at the top, broad categories "
        "(trend following vs. mean reversion); below, specific entry patterns; at the bottom, exact "
        "execution parameters. The hierarchy lets you smoothly interpolate between strategies and "
        "discover new blends."
    ),
    "Skill Chaining": (
        "**Skill Chaining** automatically creates sequences of skills (options) that connect "
        "distant states, learning new skills to bridge gaps between existing ones. Starting from a "
        "goal state, the algorithm works backward: it learns a skill that reaches the goal, then "
        "learns another skill to reach the first skill's initiation set, and so on, chaining skills "
        "until the chain covers the full task. Each skill's initiation set is learned as a classifier "
        "that determines where the skill can successfully start (Konidaris & Barto, 2009).\n\n"
        "Think of it as building a trade execution plan backward from the target: first learn how "
        "to exit at the right price, then learn how to manage the position to reach that exit, "
        "then learn how to enter to set up that management — creating a chain from entry to target."
    ),
    "Successor Features for Transfer": (
        "**Successor Features** generalize successor representations to the deep RL setting, "
        "decoupling environment dynamics from reward. The agent learns **successor features** "
        "ψ(s,a) — the expected discounted sum of feature vectors along a trajectory — which "
        "encode 'where the agent will go' independently of 'what rewards it will get'. The Q-value "
        "is recovered as Q(s,a) = ψ(s,a)ᵀw, where w is a task-specific reward weight vector. "
        "Changing tasks only requires learning a new w, not relearning dynamics — enabling instant "
        "transfer to tasks with different reward structures (Barreto et al., 2017).\n\n"
        "Think of it as separating 'how the market moves' from 'what you care about'. A single "
        "model of market dynamics can be reused for any objective — maximizing Sharpe, minimizing "
        "drawdown, targeting alpha — just by changing the reward weights."
    ),
    # ── Meta-RL & Hierarchical RL > Meta-Learning Algorithms ─────────────
    "Learning to Learn with Gradient Descent": (
        "**Learning to Learn with Gradient Descent by Gradient Descent** uses an LSTM to learn the "
        "update rule itself, replacing hand-designed optimizers like SGD or Adam. The LSTM takes as "
        "input the current gradient and parameter values, and outputs the parameter update. This "
        "meta-learner is trained across many tasks so it discovers update rules that generalize — "
        "effectively learning an optimizer that adapts faster than any fixed learning rate schedule. "
        "The key insight is treating optimization itself as a learnable sequence-to-sequence problem "
        "(Andrychowicz et al., 2016).\n\n"
        "Think of it as training an AI to be a better trainer — instead of using fixed rules for "
        "adjusting your trading strategy, you learn a smart update rule that adapts differently "
        "for different market conditions, speeding up strategy refinement."
    ),
    "Meta Policy Gradient": (
        "**Meta Policy Gradient** methods optimize the meta-learning process itself using policy "
        "gradient techniques. The outer loop computes gradients of the meta-objective (performance "
        "after adaptation) with respect to the meta-parameters (initialization, learning rate, or "
        "architecture). This enables learning not just initial parameters (like MAML) but entire "
        "learning algorithms — including what loss function to optimize, how to weight different "
        "experiences, and how many gradient steps to take during adaptation.\n\n"
        "Think of it as optimizing the strategy-optimization-process itself: not just learning a "
        "good initial trading strategy, but learning the best procedure for adapting strategies "
        "to new markets — including how fast to adapt, what data to prioritize, and when to stop."
    ),
    "Model-Agnostic Meta-Learning (MAML)": (
        "**Model-Agnostic Meta-Learning (MAML)** finds an initialization of neural network parameters "
        "that can be fine-tuned to any new task with just a few gradient steps. During meta-training, "
        "MAML simulates the adaptation process: for each task, it takes a few gradient steps on that "
        "task's data, then evaluates performance post-adaptation, and backpropagates through the "
        "adaptation process to improve the initialization. The result is an initialization that is "
        "maximally sensitive to task-relevant features — sitting at a point in parameter space where "
        "small updates produce large improvements (Finn et al., 2017).\n\n"
        "Think of it as finding the one starting strategy configuration that, with just 10 trades of "
        "experience in ANY new market, can be tweaked into a good strategy for that specific market. "
        "The starting point is optimized to be maximally adaptable."
    ),
    "PEARL (Probabilistic Embeddings for Actor-Critic RL)": (
        "**PEARL** is a meta-RL algorithm that infers a latent task embedding from a small number "
        "of transition samples, then conditions its policy on that embedding. A probabilistic encoder "
        "maps a context set of (s,a,r,s') tuples to a Gaussian posterior over a task latent variable "
        "z, and the actor-critic policy is conditioned on z. This is trained end-to-end using "
        "variational inference. PEARL enables off-policy meta-learning (reusing all past data for "
        "context inference), making it 20-100× more sample-efficient than on-policy meta-RL methods "
        "(Rakelly et al., 2019).\n\n"
        "Think of it as a trader who, after observing just a handful of trades in a new market, "
        "quickly infers 'what kind of market is this?' as a probability distribution over market "
        "types, then deploys the appropriate strategy for that type."
    ),
    "RL^2 (Reinforcement Learning Squared)": (
        "**RL²** treats the entire RL adaptation process as an input sequence to a recurrent network. "
        "The agent's recurrent neural network (LSTM or GRU) processes the stream of (state, action, "
        "reward, done) tuples across multiple episodes of the same task. The hidden state of the RNN "
        "effectively encodes task-specific information, allowing the network to adapt its behavior "
        "across episodes without any explicit gradient-based adaptation. The RNN *is* the learning "
        "algorithm — meta-trained across many tasks to perform fast within-task adaptation "
        "(Duan et al., 2016).\n\n"
        "Think of it as a trader with a perfect memory who processes every trade sequentially, "
        "automatically adjusting behavior based on the pattern of outcomes so far — not through "
        "explicit rule changes, but through their recurrent 'mental state' adapting in real time."
    ),
    "Reptile Meta-RL": (
        "**Reptile** is a first-order meta-learning algorithm that provides a simpler alternative to "
        "MAML by eliminating the need for second-order gradients. For each task, Reptile runs several "
        "gradient descent steps from the current initialization, then moves the initialization toward "
        "the adapted parameters by a small step. Geometrically, Reptile moves toward a point that is "
        "close to the optimal parameters for *all* training tasks simultaneously — finding an "
        "initialization that is broadly useful. Despite its simplicity, Reptile achieves competitive "
        "performance with MAML (Nichol et al., 2018).\n\n"
        "Think of it as repeatedly test-driving strategies on different markets, each time nudging "
        "your starting configuration toward what works. After enough markets, your starting point "
        "is a jack-of-all-trades that adapts quickly anywhere."
    ),
    "Task-Aware Meta-RL": (
        "**Task-Aware Meta-RL** augments standard meta-learning with explicit task identification "
        "mechanisms. The agent learns to recognize which task it is operating in (through a task "
        "inference module) and conditions its policy accordingly. Unlike RL² which implicitly infers "
        "the task through its hidden state, task-aware methods produce an explicit task representation "
        "that can be interpreted, manipulated, and transferred. This enables faster adaptation, "
        "better zero-shot transfer between related tasks, and clearer understanding of what the "
        "agent has learned about task structure.\n\n"
        "Think of it as a trader who explicitly identifies 'this is a range-bound market with "
        "declining volatility' and then looks up the matching strategy, rather than implicitly "
        "adjusting through experience alone. The explicit identification enables faster switching "
        "and transparent reasoning."
    ),
    # ── Meta-RL & Hierarchical RL > Modularity & Subgoal Discovery ───────
    "HyperNetworks for RL": (
        "**HyperNetworks for RL** use a meta-network (the hypernetwork) that generates the weights "
        "of the primary policy network, conditioned on a task embedding, context, or latent variable. "
        "Instead of learning a single set of policy weights, the hypernetwork can produce a *different* "
        "policy for each task or context by varying its input. This enables rapid task adaptation "
        "without gradient-based fine-tuning — the hypernetwork simply generates the right weights "
        "on the fly. It also provides a compact parameterization when many related policies share "
        "common structure (Ha et al., 2017).\n\n"
        "Think of it as a strategy factory that can instantly manufacture a custom trading strategy "
        "for any market condition — rather than maintaining one strategy and tweaking it, the factory "
        "builds a fresh, tailored strategy on demand based on the market context."
    ),
    "Meta-Controller with Subgoal Discovery": (
        "**Meta-Controller with Subgoal Discovery** automatically identifies useful subgoals (key "
        "intermediate states) in the environment and learns a meta-controller that selects which "
        "subgoal to pursue next. Subgoal discovery often uses state visitation frequency, bottleneck "
        "detection, or graph-based partitioning to find states that serve as useful waypoints. The "
        "meta-controller treats subgoals as abstract actions, planning over them rather than over "
        "primitive actions. This reduces effective problem horizon and enables transfer to tasks "
        "that share the same subgoal structure but differ in final objectives.\n\n"
        "Think of it as an AI that automatically discovers key price levels, chart patterns, or "
        "market events that serve as natural waypoints, then plans at the level of 'reach this setup, "
        "then proceed to that breakout' rather than deciding each bar individually."
    ),
    "Modular Meta-RL Agent": (
        "**Modular Meta-RL Agents** decompose the policy into specialized modules that can be "
        "activated, composed, or reconfigured for different tasks. Each module is a neural network "
        "component trained to handle a specific aspect of behavior (e.g., navigation, manipulation, "
        "communication). A routing or attention mechanism determines which modules to activate based "
        "on the current task context. Meta-training optimizes both the modules and the routing "
        "mechanism across tasks, discovering natural functional decompositions that transfer across "
        "task families.\n\n"
        "Think of it as a trading system built from plug-and-play components — a trend detector, "
        "a volatility estimator, a position sizer, an exit timer — that can be mixed and matched "
        "by a meta-controller to assemble the right strategy for each market condition."
    ),
    "Multitask RL with Shared Latent Variables": (
        "**Multitask RL with Shared Latent Variables** learns a single policy network across multiple "
        "tasks by routing information through a shared latent space. Task-specific encoders compress "
        "each task's observations, a shared latent layer captures common structure, and task-specific "
        "decoders produce actions. The shared representation learns invariances that hold across tasks "
        "while the task-specific heads handle what differs. This architecture enables positive transfer "
        "(learning one task faster because of knowledge from another) and discovers the common "
        "structure underlying a family of related problems.\n\n"
        "Think of it as training a single brain to trade multiple correlated instruments — the shared "
        "layer learns common market microstructure patterns, while per-instrument heads learn contract "
        "specifics like tick size and session times. Learning ES helps learn NQ helps learn YM."
    ),
}

# ─────────────────────────────────────────────────────────────────────────────
# Generic markers that identify category-level (non-specific) definitions
# ─────────────────────────────────────────────────────────────────────────────
GENERIC_MARKERS = [
    "learns to make sequential decisions by interacting with an environment",
    "provides a structured methodology for learning from data",
]


def patch_file(filepath: str, model_name: str, new_defn: str, dry_run: bool = True) -> bool:
    """Replace the ## Definition section in a model spec file."""
    text = open(filepath, encoding="utf-8").read()

    # Find the Definition section boundaries
    def_start = text.find("## Definition")
    if def_start < 0:
        print(f"  SKIP (no ## Definition): {model_name}")
        return False

    # Find the next ## heading after Definition
    next_heading = re.search(r"\n## [A-Z]", text[def_start + 14 :])
    if next_heading:
        def_end = def_start + 14 + next_heading.start()
    else:
        # No next heading — unlikely, but handle gracefully
        def_end = len(text)

    old_section = text[def_start:def_end]

    # Check if it actually has a generic definition
    if not any(m in old_section for m in GENERIC_MARKERS):
        print(f"  SKIP (already specific): {model_name}")
        return False

    # Build replacement
    new_section = f"## Definition\n\n{new_defn}\n\n"
    new_text = text[:def_start] + new_section + text[def_end:]

    if dry_run:
        print(f"  WOULD PATCH: {model_name}")
        print(f"    Old: {old_section[:120].strip()}...")
        print(f"    New: {new_defn[:120].strip()}...")
    else:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(new_text)
        print(f"  PATCHED: {model_name}")

    return True


def main():
    mode = "DRY RUN" if DRY_RUN else "APPLY"
    print(f"=== RL Model Overview Patcher ({mode}) ===\n")

    patched = 0
    skipped = 0
    missing_def = []

    for dirpath, dirs, files in os.walk(ROOT):
        for f in files:
            if not f.endswith(".md"):
                continue
            name = os.path.splitext(f)[0]
            if name not in MODEL_DEFINITIONS:
                continue

            filepath = os.path.join(dirpath, f)
            new_defn = MODEL_DEFINITIONS[name]

            if patch_file(filepath, name, new_defn, dry_run=DRY_RUN):
                patched += 1
            else:
                skipped += 1

    # Check for definitions we wrote but no matching file found
    found_files = set()
    for dirpath, dirs, files in os.walk(ROOT):
        for f in files:
            if f.endswith(".md"):
                found_files.add(os.path.splitext(f)[0])

    for name in MODEL_DEFINITIONS:
        if name not in found_files:
            missing_def.append(name)

    print(f"\n=== Summary ===")
    print(f"Patched: {patched}")
    print(f"Skipped: {skipped}")
    print(f"Definitions provided: {len(MODEL_DEFINITIONS)}")
    if missing_def:
        print(f"WARNING — definitions without matching files: {missing_def}")

    if DRY_RUN:
        print(f"\nRe-run with --apply to write changes.")


if __name__ == "__main__":
    main()
