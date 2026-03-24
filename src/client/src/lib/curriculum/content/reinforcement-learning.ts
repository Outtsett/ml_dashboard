import type { LearningPath } from "../types";

export const reinforcementLearningPath: LearningPath = {
  id: "reinforcement-learning",
  title: "Reinforcement Learning",
  description:
    "Learn to build trading agents that learn optimal strategies through market interaction — from tabular Q-learning to deep policy gradient methods like PPO for position sizing and order execution.",
  icon: "Gamepad2",
  color: "rose",
  difficulty: "advanced",
  estimatedHours: 20,
  modules: [
    {
      id: "rl-foundations",
      title: "RL Foundations",
      description:
        "Build the mathematical foundations — Markov Decision Processes, value functions, Bellman equations, and temporal difference methods applied to trading environments.",
      lessons: [
        {
          id: "rl-mdp",
          title: "Markov Decision Processes",
          description:
            "Formalise trading as an MDP with states, actions, rewards, transition probabilities, and discount factor γ. Derive the Bellman equations underpinning all RL algorithms.",
          estimatedMinutes: 45,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Model a forex trading environment as a Markov Decision Process, derive the Bellman optimality equations, and implement value iteration to find the optimal policy.",
              keyTakeaways: [
                "An MDP is (S, A, P, R, γ) — states, actions, transitions, rewards, discount",
                "Bellman equation: V*(s) = maxₐ [R(s,a) + γ ∑ₛ′ P(s′|s,a) V*(s′)]",
                "Discount γ ∈ [0,1) balances immediate vs future rewards — lower γ favours short-term P&L",
                "The Markov property: future depends only on current state, not full history",
                "Policy π(a|s) maps states → action probabilities; goal is π* maximising cumulative reward",
              ],
            },
            {
              type: "theory",
              title: "The MDP Framework for Trading",
              content:
                "**States S**: Price, indicators, position, P&L, time. **Actions A**: {buy, sell, hold} or continuous ∈ [−1,1]. **Transitions P(s′|s,a)**: Stochastic market dynamics. **Reward R**: P&L or risk-adjusted return. **Discount γ ∈ [0,1)**: Future vs immediate reward preference.\n\n**Value Function** V^π(s) = 𝔼π[∑ₜ γᵗ rₜ | s₀=s]. **Action-Value** Q^π(s,a) = 𝔼π[∑ₜ γᵗ rₜ | s₀=s, a₀=a].\n\n**Bellman Optimality:**\n  V*(s) = maxₐ [R(s,a) + γ ∑ₛ′ P(s′|s,a) V*(s′)]\n  Q*(s,a) = R(s,a) + γ ∑ₛ′ P(s′|s,a) maxₐ′ Q*(s′,a′)\n\n**Value Iteration**: Vₖ₊₁(s) = maxₐ [R + γ∑P·Vₖ] until convergence. Use γ ≈ 0.99 for daily, γ ≈ 0.95 for intraday. The Markov property is approximated by encoding sufficient history in state.",
            },
            {
              type: "intuition",
              title: "MDPs as a Board Game Against the Market",
              analogy:
                "Forex trading is a board game against the market. Your position (state) includes holdings, balance, and chart. Each turn you act (buy/sell/hold), the market rolls dice (price moves), you land on a new state and collect reward (P&L). γ = 0.99 means patience for big payoffs; γ = 0.5 means profits NOW.",
              content:
                "The Bellman equation is recursive: the value of any position = best move's reward + discounted value of the resulting position. Value iteration propagates knowledge backward — understanding good exits gradually informs entry timing and sizing decisions.",
              emoji: "🎲",
            },
            {
              type: "code",
              title: "Gridworld MDP Value Iteration",
              language: "python",
              code: `import numpy as np

class TradingGridworld:
    """1D trading MDP: 3 regimes (bull/neutral/bear) × 3 positions (short/flat/long)."""
    def __init__(self, gamma: float = 0.95):
        self.n_regimes = self.n_positions = self.n_actions = 3
        self.n_states = 9
        self.gamma = gamma
        self.regime_trans = np.array([  # P(regime′|regime) — persistent regimes
            [0.7, 0.2, 0.1], [0.2, 0.6, 0.2], [0.1, 0.2, 0.7]])
        self.rewards = np.array([       # R(regime, position)
            [-1.0, 0.0, 1.0], [-0.1, 0.0, 0.1], [1.0, 0.0, -1.0]])

    def value_iteration(self, tol: float = 1e-6):
        """V*(s) = maxₐ [R + γ ∑ P(s′|s,a) V*(s′)]"""
        V = np.zeros(self.n_states)
        for it in range(1000):
            V_new = np.zeros_like(V)
            for s in range(self.n_states):
                reg, pos = divmod(s, self.n_positions)
                best = -np.inf
                for a in range(self.n_actions):
                    new_pos = np.clip(pos + a - 1, 0, 2)
                    q = sum(self.regime_trans[reg, nr]
                            * (self.rewards[nr, new_pos] + self.gamma * V[nr*3 + new_pos])
                            for nr in range(self.n_regimes))
                    best = max(best, q)
                V_new[s] = best
            if np.max(np.abs(V_new - V)) < tol:
                print(f"Converged in {it+1} iterations"); break
            V = V_new
        return V

env = TradingGridworld(gamma=0.95)
V = env.value_iteration()
for s in range(9):
    r, p = divmod(s, 3)
    print(f"  V*({['bull','neutral','bear'][r]:>7s}, {['short','flat','long'][p]:>5s}) = {V[s]:+.3f}")`,
              explanation:
                "A simplified MDP where state = (market regime, position). Regime transitions are stochastic with persistence. Value iteration applies V*(s) = maxₐ[R + γ∑P·V*] until convergence, revealing that being long in bull markets and short in bear markets has highest value.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-mdp-q1",
                  question: "In the Bellman equation, what does γ = 0 imply about agent behaviour?",
                  options: [
                    { id: "rl-mdp-q1-a", text: "The agent considers all future rewards equally" },
                    { id: "rl-mdp-q1-b", text: "The agent only maximises immediate reward, ignoring future consequences" },
                    { id: "rl-mdp-q1-c", text: "The agent's value function becomes infinite" },
                    { id: "rl-mdp-q1-d", text: "The agent never takes any action" },
                  ],
                  correctOptionId: "rl-mdp-q1-b",
                  explanation:
                    "With γ=0, the future term γ∑P·V* vanishes. The agent becomes purely myopic — like a scalper ignoring position management beyond the current trade.",
                },
                {
                  id: "rl-mdp-q2",
                  question: "What is the relationship between V*(s) and Q*(s,a)?",
                  options: [
                    { id: "rl-mdp-q2-a", text: "V*(s) = ∑ₐ Q*(s,a)" },
                    { id: "rl-mdp-q2-b", text: "V*(s) = minₐ Q*(s,a)" },
                    { id: "rl-mdp-q2-c", text: "V*(s) = maxₐ Q*(s,a)" },
                    { id: "rl-mdp-q2-d", text: "V*(s) = Q*(s,a) / |A|" },
                  ],
                  correctOptionId: "rl-mdp-q2-c",
                  explanation:
                    "V*(s) = maxₐ Q*(s,a) — the optimal state value equals the value of taking the best action.",
                },
              ],
            },
            {
              type: "practice",
              title: "Extend the Trading MDP",
              description:
                "Add: (1) transaction cost of 0.1 for changing position, (2) a 'high volatility' regime, (3) position sizing {−2,−1,0,+1,+2}. Run value iteration — does the agent trade less frequently with transaction costs?",
              catalogModelId: "mdp-value-iteration",
            },
          ],
        },
        {
          id: "rl-qlearning",
          title: "Q-Learning & Temporal Difference",
          description:
            "Learn model-free RL through temporal difference methods — Q-learning and SARSA — that learn from experience without needing a market transition model.",
          estimatedMinutes: 45,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Master temporal difference learning and Q-learning — model-free methods that learn optimal trading policies from market interaction using ε-greedy exploration.",
              keyTakeaways: [
                "TD update: V(s) ← V(s) + α[r + γV(s′) − V(s)], bracketed term is TD error δ",
                "Q-learning (off-policy): Q(s,a) ← Q(s,a) + α[r + γ maxₐ′ Q(s′,a′) − Q(s,a)]",
                "SARSA (on-policy): Q(s,a) ← Q(s,a) + α[r + γQ(s′,a′) − Q(s,a)] where a′ follows π",
                "ε-greedy: with probability ε random action, else greedy — balances explore/exploit",
                "Q-learning converges to Q* regardless of exploration policy (off-policy guarantee)",
              ],
            },
            {
              type: "theory",
              title: "Temporal Difference Learning & Q-Tables",
              content:
                "**TD Learning** updates using bootstrapped targets: V(sₜ) ← V(sₜ) + α[rₜ + γV(sₜ₊₁) − V(sₜ)]. TD error δₜ measures surprise.\n\n**Q-Learning** (off-policy): Q(sₜ,aₜ) ← Q(sₜ,aₜ) + α[rₜ + γ maxₐ Q(sₜ₊₁,a) − Q(sₜ,aₜ)]. Always uses max_a regardless of action taken.\n\n**SARSA** (on-policy): Q(sₜ,aₜ) ← Q(sₜ,aₜ) + α[rₜ + γQ(sₜ₊₁,aₜ₊₁) − Q(sₜ,aₜ)]. Uses the action actually taken — safer, accounts for exploration.\n\n**ε-Greedy**: argmaxₐ Q(s,a) with prob 1−ε, random with prob ε. Decay: ε ← max(ε_min, ε·decay). SARSA may learn safer policies with transaction costs.",
            },
            {
              type: "intuition",
              title: "Q-Learning as Paper Trading",
              analogy:
                "You have a notebook (Q-table) recording expected profit for every market-condition × action pair. After each paper trade, you update: 'I expected $50 from this setup but got $30 + discounted future value $40 — adjust toward reality.' ε-greedy forces you to try unconventional trades 10% of the time to avoid local optima.",
              content:
                "Q-learning learns Q* even while following a suboptimal policy (off-policy). You can explore wild strategies during paper trading and still converge to optimal entries/exits — given enough visits to each state-action pair. The learning rate α controls how quickly beliefs update from new evidence.",
              emoji: "📊",
            },
            {
              type: "code",
              title: "Q-Learning on a Simple Trading Environment",
              language: "python",
              code: `import numpy as np

class SimpleTradingEnv:
    def __init__(self, prices: np.ndarray, n_bins: int = 10):
        self.returns = np.diff(prices) / prices[:-1]
        self.bins = np.linspace(np.percentile(self.returns, 5),
                                np.percentile(self.returns, 95), n_bins - 1)
        self.n_states = n_bins * 3  # return_bin × position
        self.n_actions = 3
        self.reset()

    def reset(self):
        self.t, self.position = 0, 1
        return np.digitize(self.returns[0], self.bins) * 3 + 1

    def step(self, action: int):
        old_pos = self.position
        self.position = np.clip(old_pos + action - 1, 0, 2)
        reward = (self.position - 1) * self.returns[self.t] - 0.001 * abs(self.position - old_pos)
        self.t += 1
        done = self.t >= len(self.returns) - 1
        return np.digitize(self.returns[self.t], self.bins) * 3 + self.position, reward, done

def q_learning(env, n_episodes=500, alpha=0.1, gamma=0.95,
               epsilon=1.0, eps_min=0.01, eps_decay=0.995):
    Q = np.zeros((env.n_states, env.n_actions))
    for ep in range(n_episodes):
        state, total_r = env.reset(), 0.0
        while True:
            action = (np.random.randint(env.n_actions) if np.random.random() < epsilon
                      else np.argmax(Q[state]))
            s2, reward, done = env.step(action)
            total_r += reward
            Q[state, action] += alpha * (reward + gamma * np.max(Q[s2]) * (1-done) - Q[state, action])
            state = s2
            if done: break
        epsilon = max(eps_min, epsilon * eps_decay)
        if (ep+1) % 100 == 0: print(f"Ep {ep+1:4d} | R: {total_r:+.4f} | ε: {epsilon:.3f}")
    return Q

# Q_star = q_learning(SimpleTradingEnv(df["close"].values))`,
              explanation:
                "Tabular Q-learning on a discretised forex environment. State = binned return × position. The TD update Q(s,a) ← Q(s,a) + α[r + γ max Q(s′,·) − Q(s,a)] converges to Q* as ε decays from exploration to exploitation.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-qlearning-q1",
                  question: "What is the key difference between Q-learning and SARSA?",
                  options: [
                    { id: "rl-qlearning-q1-a", text: "Q-learning uses maxₐ′ Q(s′,a′), SARSA uses Q(s′,a′) where a′ is the action actually taken" },
                    { id: "rl-qlearning-q1-b", text: "Q-learning has no learning rate while SARSA does" },
                    { id: "rl-qlearning-q1-c", text: "SARSA always converges faster" },
                    { id: "rl-qlearning-q1-d", text: "Q-learning only handles discrete actions" },
                  ],
                  correctOptionId: "rl-qlearning-q1-a",
                  explanation:
                    "Q-learning uses maxₐ′ (greedy target) regardless of actual action — off-policy. SARSA uses the action sampled from current policy — on-policy, more conservative.",
                },
                {
                  id: "rl-qlearning-q2",
                  question: "Why must ε decay over time in ε-greedy Q-learning?",
                  options: [
                    { id: "rl-qlearning-q2-a", text: "To reduce computational cost" },
                    { id: "rl-qlearning-q2-b", text: "To shift from exploration (discovering values) to exploitation (maximising learned policy)" },
                    { id: "rl-qlearning-q2-c", text: "To prevent Q-values from diverging" },
                    { id: "rl-qlearning-q2-d", text: "Constant ε violates the Markov property" },
                  ],
                  correctOptionId: "rl-qlearning-q2-b",
                  explanation:
                    "High ε early ensures broad visitation for accurate Q-estimates. Decaying shifts to exploitation. Without decay, the agent keeps taking random actions after finding the optimal strategy.",
                },
              ],
            },
            {
              type: "practice",
              title: "SARSA vs Q-Learning Trading Duel",
              description:
                "Implement both SARSA and Q-learning on the same SimpleTradingEnv with EUR/USD 1H data. Compare convergence speed, final policy conservativeness, and sensitivity to ε decay. Test with transaction costs 0, 0.001, 0.005.",
              catalogModelId: "q-learning-sarsa",
            },
          ],
        },
      ],
    },
    {
      id: "deep-rl",
      title: "Deep RL for Trading",
      description:
        "Scale RL to continuous state spaces with deep neural networks — from DQN with experience replay to policy gradient methods like PPO for position sizing.",
      lessons: [
        {
          id: "rl-dqn",
          title: "Deep Q-Networks (DQN)",
          description:
            "Bridge tabular Q-learning to deep RL with neural function approximation, experience replay, and target networks for stable training.",
          estimatedMinutes: 50,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Learn how DQN extends Q-learning to continuous states using neural networks, experience replay buffers, and target network stabilisation.",
              keyTakeaways: [
                "DQN: Q*(s,a) ≈ Q(s,a; θ) with a neural network parameterised by θ",
                "Experience replay stores (s,a,r,s′,done) and samples mini-batches to break correlation",
                "Target network: θ⁻ ← τθ + (1−τ)θ⁻ stabilises bootstrap targets",
                "Double DQN: a* = argmax Q(s′;θ), target = Q(s′,a*;θ⁻) — reduces overestimation",
                "Dueling DQN: Q(s,a) = V(s;θ) + A(s,a;θ) − mean(A) separates state value from action advantage",
              ],
            },
            {
              type: "theory",
              title: "From Q-Tables to Neural Q-Functions",
              content:
                "Tabular Q-learning fails with continuous states. **DQN** (Mnih et al., 2015) minimises L(θ) = 𝔼[(r + γ maxₐ′ Q(s′,a′;θ⁻) − Q(s,a;θ))²].\n\n**Experience Replay**: Stores N transitions, samples random mini-batches — breaks temporal correlation.\n\n**Target Network**: Frozen copy for stable targets. Soft update: θ⁻ ← τθ + (1−τ)θ⁻, τ ≈ 0.005.\n\n**Double DQN**: max of noisy estimates causes overestimation. Fix: select with θ, evaluate with θ⁻.\n\n**Dueling DQN**: Q = V(s) + A(s,a) − mean(A). Helps when action choice matters little.\n\nForex: State = normalised features, Actions = {strong sell, sell, hold, buy, strong buy}.",
            },
            {
              type: "intuition",
              title: "Experience Replay as Trade Journal Review",
              analogy:
                "Keep a journal of every trade: entry, action, P&L, resulting state. Without replay, you only learn chronologically — recent losses dominate. Replay means randomly flipping through your journal each evening, reviewing diverse old and new trades. The target network is 'last month's strategy' — compare today's ideas against a stable baseline.",
              content:
                "Two problems of neural Q-learning: (1) consecutive samples are correlated (today's bar ≈ yesterday's), violating SGD's i.i.d. assumption, (2) the target depends on the network being trained. Replay solves (1), target network solves (2).",
              emoji: "🎯",
            },
            {
              type: "code",
              title: "DQN Agent Skeleton for Forex",
              language: "python",
              code: `import numpy as np, random
import torch, torch.nn as nn, torch.optim as optim
from collections import deque

class DuelingDQN(nn.Module):
    """Q(s,a) = V(s) + A(s,a) − mean(A)"""
    def __init__(self, state_dim: int, n_actions: int, hidden: int = 128):
        super().__init__()
        self.features = nn.Sequential(nn.Linear(state_dim, hidden), nn.ReLU(),
                                       nn.Linear(hidden, hidden), nn.ReLU())
        self.value = nn.Linear(hidden, 1)
        self.advantage = nn.Linear(hidden, n_actions)
    def forward(self, x):
        f = self.features(x)
        v, a = self.value(f), self.advantage(f)
        return v + a - a.mean(dim=1, keepdim=True)

class ReplayBuffer:
    def __init__(self, cap=100_000): self.buf = deque(maxlen=cap)
    def push(self, *t): self.buf.append(t)
    def sample(self, n):
        s, a, r, s2, d = zip(*random.sample(self.buf, n))
        return (torch.tensor(np.array(s), dtype=torch.float32), torch.tensor(a, dtype=torch.long),
                torch.tensor(r, dtype=torch.float32), torch.tensor(np.array(s2), dtype=torch.float32),
                torch.tensor(d, dtype=torch.float32))
class DQNAgent:
    def __init__(self, state_dim, n_actions=5, gamma=0.99, lr=1e-4, tau=0.005):
        self.n_actions, self.gamma, self.tau = n_actions, gamma, tau
        self.q_net, self.target_net = DuelingDQN(state_dim, n_actions), DuelingDQN(state_dim, n_actions)
        self.target_net.load_state_dict(self.q_net.state_dict())
        self.opt = optim.Adam(self.q_net.parameters(), lr=lr)
        self.buffer, self.epsilon = ReplayBuffer(), 1.0
    def act(self, state):
        if random.random() < self.epsilon:
            return random.randint(0, self.n_actions - 1)
        with torch.no_grad():
            return self.q_net(torch.tensor(state).float().unsqueeze(0)).argmax(1).item()
    def train_step(self, batch_size=64):
        if len(self.buffer.buf) < batch_size: return
        s, a, r, s2, d = self.buffer.sample(batch_size)
        with torch.no_grad():
            best_a = self.q_net(s2).argmax(1)  # Double DQN: select with θ
            target = r + self.gamma * self.target_net(s2).gather(1, best_a.unsqueeze(1)).squeeze() * (1-d)
        loss = nn.MSELoss()(self.q_net(s).gather(1, a.unsqueeze(1)).squeeze(), target)
        self.opt.zero_grad(); loss.backward()
        torch.nn.utils.clip_grad_norm_(self.q_net.parameters(), 1.0); self.opt.step()
        for tp, op in zip(self.target_net.parameters(), self.q_net.parameters()):
            tp.data.copy_(self.tau * op.data + (1-self.tau) * tp.data)  # soft update θ⁻`,
              explanation:
                "Complete Double Dueling DQN: DuelingDQN separates V(s) + A(s,a) − mean(A). ReplayBuffer stores transitions for decorrelated training. DQNAgent combines ε-greedy exploration, Double DQN targets (select with θ, evaluate with θ⁻), and soft target updates θ⁻ ← τθ + (1−τ)θ⁻.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-dqn-q1",
                  question: "Why does DQN overestimate Q-values, and how does Double DQN fix it?",
                  options: [
                    { id: "rl-dqn-q1-a", text: "DQN uses a biased loss; Double DQN uses unbiased" },
                    { id: "rl-dqn-q1-b", text: "max of noisy estimates has positive bias; Double DQN decouples selection (θ) from evaluation (θ⁻)" },
                    { id: "rl-dqn-q1-c", text: "DQN has too many parameters" },
                    { id: "rl-dqn-q1-d", text: "DQN can't handle continuous actions" },
                  ],
                  correctOptionId: "rl-dqn-q1-b",
                  explanation:
                    "maxₐ of noisy Q-estimates produces upward bias. Double DQN uses θ to select the best action and θ⁻ to evaluate it, breaking the correlation causing overestimation.",
                },
                {
                  id: "rl-dqn-q2",
                  question: "Why subtract mean(A) in Dueling DQN?",
                  options: [
                    { id: "rl-dqn-q2-a", text: "To ensure Q-values are positive" },
                    { id: "rl-dqn-q2-b", text: "To reduce computational cost" },
                    { id: "rl-dqn-q2-c", text: "To ensure identifiability — without it, V and A aren't uniquely determined" },
                    { id: "rl-dqn-q2-d", text: "For batch normalisation compatibility" },
                  ],
                  correctOptionId: "rl-dqn-q2-c",
                  explanation:
                    "Q = V + A has infinitely many solutions without centering. Subtracting mean(A) forces zero-mean advantage, making V uniquely identifiable as the mean Q-value.",
                },
              ],
            },
            {
              type: "practice",
              title: "DQN Forex Trading Agent",
              description:
                "Train the DQN agent on EUR/USD 1H with 20 features (returns, volatility, RSI, MACD, Bollinger). 5 actions: strong sell → strong buy. Reward: Sharpe-adjusted P&L with drawdown penalty. Compare vanilla, Double, and Dueling DQN out-of-sample.",
              catalogModelId: "dqn-forex-agent",
            },
          ],
        },
        {
          id: "rl-policy-gradient",
          title: "Policy Gradient Methods",
          description:
            "Directly optimise the policy for continuous position sizes with REINFORCE, Actor-Critic (A2C), and Proximal Policy Optimisation (PPO).",
          estimatedMinutes: 55,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Understand policy gradient methods — from REINFORCE to PPO — enabling continuous action spaces for nuanced forex position sizing.",
              keyTakeaways: [
                "Policy gradient: ∇θ J(θ) = 𝔼π[∇θ log π(a|s;θ) · Q^π(s,a)]",
                "REINFORCE uses Monte Carlo returns Gₜ = ∑ₖ γᵏ rₜ₊ₖ — high variance",
                "Actor-Critic: advantage Â = r + γV(s′) − V(s) reduces variance with learned baseline",
                "PPO clips surrogate: min(rₜÂₜ, clip(rₜ, 1−ε, 1+ε)Âₜ) to prevent large updates",
                "Gaussian policy π(a|s) = N(μ(s), σ²) enables continuous position sizing ∈ ℝ",
              ],
            },
            {
              type: "theory",
              title: "Policy Gradients, Actor-Critic & PPO",
              content:
                "**Why Policy Gradients?** DQN handles discrete actions; trading needs continuous sizing.\n\n**Policy Gradient**: ∇θ J(θ) = 𝔼π[∇θ log π(aₜ|sₜ;θ) · Ψₜ] where Ψₜ is return, Q-value, or advantage.\n\n**REINFORCE**: Ψₜ = Gₜ = ∑ₖ γᵏrₜ₊ₖ — single MC sample, high variance.\n\n**Actor-Critic**: Actor π(a|s;θ), Critic V(s;φ). Advantage Â = r + γV(s′) − V(s). Update: θ += α∇θ log π · Â.\n\n**PPO** (Schulman, 2017): rₜ = π_new/π_old, L = 𝔼[min(rₜÂₜ, clip(rₜ, 1−ε, 1+ε)Âₜ)], ε ≈ 0.2. Clipping prevents catastrophic updates.\n\n**Reward Shaping**: Raw P&L ± Sharpe penalty ± drawdown penalty ± position size penalty.",
            },
            {
              type: "intuition",
              title: "PPO as a Cautious Strategy Updater",
              analogy:
                "REINFORCE would overhaul your strategy based on one lucky week — dangerous! Actor-Critic gives a stable baseline to compare against. PPO adds a guardrail: 'no matter what, I won't change strategy by more than 20%.' This cautious updating avoids the wild swings that blow up accounts.",
              content:
                "PPO's clipping creates a trust region: when advantage is positive (good action), ratio capped at 1+ε prevents over-exploitation; when negative, capped at 1−ε prevents over-correction. This asymmetric clipping ensures monotonic improvement — stable, boring progress that makes money.",
              emoji: "🤖",
            },
            {
              type: "code",
              title: "PPO-Style Agent for Position Sizing",
              language: "python",
              code: `import numpy as np
import torch, torch.nn as nn, torch.optim as optim
from torch.distributions import Normal

class ActorCritic(nn.Module):
    def __init__(self, state_dim: int, hidden: int = 128):
        super().__init__()
        self.backbone = nn.Sequential(nn.Linear(state_dim, hidden), nn.ReLU(),
                                       nn.Linear(hidden, hidden), nn.ReLU())
        self.mu_head = nn.Linear(hidden, 1)
        self.log_std = nn.Parameter(torch.zeros(1))
        self.value_head = nn.Linear(hidden, 1)
    def forward(self, state):
        f = self.backbone(state)
        return torch.tanh(self.mu_head(f)), self.log_std.exp().expand(f.size(0), 1), self.value_head(f)
    def get_action(self, state):
        mu, std, val = self.forward(state)
        dist = Normal(mu, std)
        action = dist.sample()
        return action.clamp(-1, 1), dist.log_prob(action), val
class PPOTrainer:
    def __init__(self, state_dim, lr=3e-4, gamma=0.99, clip_eps=0.2, epochs=10, lam=0.95):
        self.model = ActorCritic(state_dim)
        self.opt = optim.Adam(self.model.parameters(), lr=lr)
        self.gamma, self.clip_eps, self.epochs, self.lam = gamma, clip_eps, epochs, lam
    def compute_gae(self, rewards, values, dones):
        advs, gae = [], 0.0
        for t in reversed(range(len(rewards))):
            nv = values[t+1] if t+1 < len(values) else 0.0
            delta = rewards[t] + self.gamma * nv * (1-dones[t]) - values[t]
            gae = delta + self.gamma * self.lam * (1-dones[t]) * gae
            advs.insert(0, gae)
        return torch.tensor(advs, dtype=torch.float32)
    def update(self, states, actions, old_lps, rewards, dones, values):
        advs = self.compute_gae(rewards, values, dones)
        returns = advs + torch.tensor(values[:len(advs)], dtype=torch.float32)
        advs = (advs - advs.mean()) / (advs.std() + 1e-8)
        st = torch.tensor(np.array(states), dtype=torch.float32)
        at = torch.tensor(np.array(actions), dtype=torch.float32)
        olp = torch.tensor(np.array(old_lps), dtype=torch.float32)
        for _ in range(self.epochs):
            mu, std, nv = self.model(st)
            dist = Normal(mu, std)
            ratio = (dist.log_prob(at).squeeze() - olp.squeeze()).exp()
            s1, s2 = ratio * advs, ratio.clamp(1-self.clip_eps, 1+self.clip_eps) * advs
            loss = -torch.min(s1, s2).mean() + 0.5*nn.MSELoss()(nv.squeeze(), returns) - 0.01*dist.entropy().mean()
            self.opt.zero_grad(); loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), 0.5); self.opt.step()

# trainer = PPOTrainer(state_dim=20)
# action, lp, val = trainer.model.get_action(torch.randn(1, 20))`,
              explanation:
                "PPO with shared ActorCritic backbone. Actor outputs μ, σ for Gaussian policy N(μ,σ²) over position sizes ∈ [−1,1]. Critic estimates V(s) for GAE advantage computation. PPO clips ratio rₜ = π_new/π_old to [1−ε, 1+ε], with entropy bonus for exploration.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-policy-gradient-q1",
                  question: "In PPO, when Â > 0 and rₜ > 1+ε, what happens?",
                  options: [
                    { id: "rl-policy-gradient-q1-a", text: "The objective is zeroed" },
                    { id: "rl-policy-gradient-q1-b", text: "The clipped value (1+ε)Â is used, preventing further probability increase" },
                    { id: "rl-policy-gradient-q1-c", text: "The ratio is reset to 1.0" },
                    { id: "rl-policy-gradient-q1-d", text: "The advantage is negated" },
                  ],
                  correctOptionId: "rl-policy-gradient-q1-b",
                  explanation:
                    "When a good action's probability already increased a lot (rₜ > 1+ε), min selects the clipped term (1+ε)Â. The gradient becomes zero for this case, preventing further movement. PPO's core stability mechanism.",
                },
                {
                  id: "rl-policy-gradient-q2",
                  question: "Why use a Gaussian distribution for actions instead of discrete choices?",
                  options: [
                    { id: "rl-policy-gradient-q2-a", text: "Gaussians are faster to sample" },
                    { id: "rl-policy-gradient-q2-b", text: "Continuous distributions allow nuanced sizing (0.3 vs 0.7 lots) rather than coarse buy/sell/hold" },
                    { id: "rl-policy-gradient-q2-c", text: "Policy gradients only work with continuous distributions" },
                    { id: "rl-policy-gradient-q2-d", text: "Gaussians guarantee global optimum convergence" },
                  ],
                  correctOptionId: "rl-policy-gradient-q2-b",
                  explanation:
                    "Trading needs fine-grained sizing — 0.5% vs 2% risk matters. A Gaussian N(μ(s), σ²) over [−1,1] lets the agent learn precise positions rather than coarse discrete buckets.",
                },
                {
                  id: "rl-policy-gradient-q3",
                  question: "What does the entropy bonus (−0.01·H[π]) prevent?",
                  options: [
                    { id: "rl-policy-gradient-q3-a", text: "Reduces backprop cost" },
                    { id: "rl-policy-gradient-q3-b", text: "Prevents premature collapse to a deterministic policy, maintaining exploration" },
                    { id: "rl-policy-gradient-q3-c", text: "Makes the value function converge faster" },
                    { id: "rl-policy-gradient-q3-d", text: "Normalises advantage estimates" },
                  ],
                  correctOptionId: "rl-policy-gradient-q3-b",
                  explanation:
                    "Without entropy regularisation, σ can shrink to near-zero early, causing premature convergence to a suboptimal deterministic policy. The entropy bonus H[N(μ,σ²)] = ½log(2πeσ²) rewards high σ, keeping exploration alive.",
                },
              ],
            },
            {
              type: "practice",
              title: "PPO Position Sizing Agent",
              description:
                "Build a PPO agent for EUR/USD sizing. State: 20 rolling-normalised TA features. Action: continuous ∈ [−1,1]. Reward: P&L − 0.5×drawdown − 0.001×|Δposition|. Train 1000 episodes on 2Y of 1H data, evaluate on 6M OOS. Compare against fixed-size buy-and-hold.",
              catalogModelId: "ppo-position-sizing",
            },
          ],
        },
      ],
    },
  ],
};
