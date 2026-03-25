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
                "Model a forex trading environment as a Markov Decision Process, derive the Bellman optimality equations for both V(s) and Q(s,a), understand policy definitions, implement value iteration with a convergence proof sketch, and interpret the discount factor γ as the time value of money in trading.",
              keyTakeaways: [
                "An MDP is the 5-tuple (S, A, P, R, γ) — states, actions, transition probabilities, reward function, and discount factor",
                "The Markov property: P(sₜ₊₁|sₜ, aₜ, sₜ₋₁, …, s₀) = P(sₜ₊₁|sₜ, aₜ) — the future depends only on the current state",
                "Bellman expectation equation: V^π(s) = ∑ₐ π(a|s) [R(s,a) + γ ∑ₛ′ P(s′|s,a) V^π(s′)]",
                "Bellman optimality equation: V*(s) = maxₐ [R(s,a) + γ ∑ₛ′ P(s′|s,a) V*(s′)]",
                "Q*(s,a) = R(s,a) + γ ∑ₛ′ P(s′|s,a) maxₐ′ Q*(s′,a′) — action-value decomposes into immediate + discounted future",
                "Discount γ ∈ [0,1) ensures convergence of infinite sums and models the time value of money — γ = 0.99 ≈ daily discounting",
                "Value iteration converges to V* by contraction mapping: ‖T V₁ − T V₂‖∞ ≤ γ ‖V₁ − V₂‖∞",
                "Finite vs infinite horizon: finite horizon uses time-dependent V_t(s), infinite horizon uses stationary V(s) with γ < 1",
              ],
            },
            {
              type: "theory",
              title: "The MDP Tuple: Formalising Trading as Sequential Decision-Making",
              content:
                "A Markov Decision Process (MDP) is defined by the 5-tuple M = (S, A, P, R, γ). Each component must be carefully specified for trading:\n\n**States S**: The state must encode everything the agent needs to make optimal decisions. In forex trading, this typically includes: current position (short/flat/long), normalised price features (returns, volatility, RSI, MACD), account state (equity, unrealised P&L, margin usage), and time features (hour of day, day of week, time since last trade). For a concrete example, consider a 3-state MDP with states S = {trending, ranging, volatile} representing market regimes identified by rolling statistics: trending if |20-bar SMA slope| > 0.5σ, volatile if ATR > 1.5 × median ATR, and ranging otherwise.\n\n**Actions A**: For discrete trading, A = {buy, sell, hold}. For position sizing, A = {−1, −0.5, 0, +0.5, +1} representing lot fractions, or continuously A ∈ [−1, 1]. The action space must balance expressiveness with learnability — a continuous space allows precise sizing but requires policy gradient methods rather than tabular Q-learning.\n\n**Transition Probabilities P(s′|s,a)**: This captures the stochastic market dynamics. For our 3-state example, P is a 3×3 matrix for each action. In practice, transitions are unknown and must be learned from data (model-free RL) or estimated from historical regime frequencies (model-based RL). A critical assumption: the agent's actions do not affect market prices (no market impact), which holds for retail forex but breaks for institutional sizes.\n\n**Reward Function R(s,a,s′)** or R(s,a): Maps state-action pairs to scalar rewards. Raw P&L rₜ = positionₜ × Δpriceₜ is the simplest choice, but risk-adjusted alternatives (Sharpe contribution, Sortino ratio) often produce better-behaved agents. For our numerical example: R(trending, buy) = +1.0 (profit from trend-following), R(trending, sell) = −1.0 (loss from counter-trend), R(ranging, hold) = +0.1 (small reward for avoiding whipsaw losses).\n\n**Discount Factor γ ∈ [0,1)**: Controls the agent's time preference. The geometric sum ∑ₜ γᵗ rₜ converges because γ < 1, with effective horizon T_eff = 1/(1−γ). For γ = 0.99: T_eff = 100 steps (looking ~100 bars ahead). For γ = 0.95: T_eff = 20 steps (short-term focus). In trading, γ connects to the time value of money: a dollar earned today is worth more than a dollar earned tomorrow due to opportunity cost, risk, and reinvestment potential.",
            },
            {
              type: "theory",
              title: "Policy, Value Functions, and the Bellman Equations — Full Derivation",
              content:
                "A **policy** π(a|s) is a mapping from states to action probabilities. A deterministic policy π(s) = a maps each state to a single action. The goal of RL is to find the optimal policy π* that maximises the expected cumulative discounted reward.\n\n**Step 1 — Define the Return.** The return from time t is Gₜ = ∑ₖ₌₀^∞ γᵏ rₜ₊ₖ₊₁. This is a random variable because future rewards depend on stochastic transitions and the policy.\n\n**Step 2 — State-Value Function.** V^π(s) = 𝔼π[Gₜ | sₜ = s] = 𝔼π[rₜ₊₁ + γ Gₜ₊₁ | sₜ = s]. Expanding: V^π(s) = ∑ₐ π(a|s) ∑ₛ′ P(s′|s,a) [R(s,a,s′) + γ V^π(s′)]. This is the **Bellman expectation equation** for V^π — it relates the value of a state to the values of successor states.\n\n**Step 3 — Action-Value Function.** Q^π(s,a) = 𝔼π[Gₜ | sₜ = s, aₜ = a] = ∑ₛ′ P(s′|s,a) [R(s,a,s′) + γ ∑ₐ′ π(a′|s′) Q^π(s′,a′)]. The relationship between V and Q: V^π(s) = ∑ₐ π(a|s) Q^π(s,a), and Q^π(s,a) = R(s,a) + γ ∑ₛ′ P(s′|s,a) V^π(s′).\n\n**Step 4 — Bellman Optimality.** The optimal value functions satisfy: V*(s) = maxₐ Q*(s,a) = maxₐ [R(s,a) + γ ∑ₛ′ P(s′|s,a) V*(s′)]. And: Q*(s,a) = R(s,a) + γ ∑ₛ′ P(s′|s,a) maxₐ′ Q*(s′,a′). The optimal policy is deterministic: π*(s) = argmaxₐ Q*(s,a).\n\n**Numerical Example.** Consider S = {trending, ranging}, A = {buy, hold}, γ = 0.9. Rewards: R(trending,buy) = +2, R(trending,hold) = 0, R(ranging,buy) = −1, R(ranging,hold) = +0.5. Transitions: P(trending|trending,buy) = 0.7, P(ranging|trending,buy) = 0.3, P(trending|ranging,hold) = 0.4, P(ranging|ranging,hold) = 0.6. Bellman equations: V*(trending) = max(2 + 0.9[0.7·V*(trending) + 0.3·V*(ranging)], 0 + 0.9[0.5·V*(trending) + 0.5·V*(ranging)]). V*(ranging) = max(−1 + 0.9[0.3·V*(trending) + 0.7·V*(ranging)], 0.5 + 0.9[0.4·V*(trending) + 0.6·V*(ranging)]). Solving this system iteratively yields V*(trending) ≈ 11.2, V*(ranging) ≈ 7.8, with π*(trending) = buy, π*(ranging) = hold.",
            },
            {
              type: "theory",
              title: "Value Iteration Algorithm with Convergence Proof Sketch",
              content:
                "**Value Iteration** computes V* without explicitly representing policies. Define the Bellman optimality operator T: (TV)(s) = maxₐ [R(s,a) + γ ∑ₛ′ P(s′|s,a) V(s′)]. Value iteration repeatedly applies T: V₀ arbitrary, Vₖ₊₁ = T Vₖ.\n\n**Convergence Proof Sketch.** T is a γ-contraction in the sup-norm: ‖TV₁ − TV₂‖∞ ≤ γ ‖V₁ − V₂‖∞. Proof: |TV₁(s) − TV₂(s)| = |maxₐ[R + γ∑P·V₁] − maxₐ[R + γ∑P·V₂]| ≤ maxₐ |γ∑ₛ′ P(s′|s,a)(V₁(s′) − V₂(s′))| ≤ γ maxₐ ∑ₛ′ P(s′|s,a) ‖V₁ − V₂‖∞ = γ ‖V₁ − V₂‖∞. Since ∑P = 1, the last step holds. By the Banach Fixed-Point Theorem, T has a unique fixed point V* and Vₖ → V* at rate O(γᵏ). After k iterations: ‖Vₖ − V*‖∞ ≤ γᵏ/(1−γ) · ‖V₁ − V₀‖∞. For γ = 0.95, convergence to ε = 10⁻⁶ requires k ≥ log(ε(1−γ)/‖V₁−V₀‖∞) / log(γ) ≈ 280 iterations (for ‖V₁−V₀‖∞ ≈ 10).\n\n**Algorithm Pseudocode.** Initialize V(s) = 0 for all s. Repeat: for each s ∈ S, compute V_new(s) = maxₐ [R(s,a) + γ ∑ₛ′ P(s′|s,a) V(s′)]. If maxₛ |V_new(s) − V(s)| < ε, stop. Extract policy: π*(s) = argmaxₐ [R(s,a) + γ ∑ₛ′ P(s′|s,a) V*(s′)]. Complexity: O(|S|² · |A|) per iteration.\n\n**Finite vs Infinite Horizon.** In finite-horizon MDPs (trade for exactly T steps), the value function is time-dependent: Vₜ(s) = maxₐ [R(s,a) + γ ∑ₛ′ P(s′|s,a) Vₜ₊₁(s′)] with V_T(s) = 0. No discount is needed since the sum is finite. In infinite-horizon MDPs (continuous trading with no fixed end), γ < 1 is essential for convergence and the value function is stationary V(s). Most trading applications use infinite-horizon with episode truncation.\n\n**Trading Implications.** Value iteration requires knowing P(s′|s,a) — the full market model. This is rarely available in practice (market dynamics are complex and non-stationary), which motivates model-free methods like Q-learning. However, value iteration on simplified MDPs provides theoretical insight: it reveals that optimal trading policies adapt to regime (long in trends, flat in ranges) and that the discount factor determines the agent's trading horizon.",
            },
            {
              type: "intuition",
              title: "MDPs as a Board Game Against the Market",
              analogy:
                "Forex trading is a board game against the market. Your position on the board (state) includes your holdings, account balance, and the current chart pattern. Each turn you choose a move (buy/sell/hold), the market rolls dice (price moves stochastically), you land on a new square and collect or pay a reward (P&L). The discount factor γ is your patience level: γ = 0.99 means you are willing to wait 100 turns for a big payoff; γ = 0.5 means you want profits NOW and heavily discount anything beyond 2 turns. The Bellman equation is the 'backward induction' strategy: the value of any board position = the best move's immediate reward + the discounted value of where you will land. Value iteration is playing the entire game backwards from every possible endgame, propagating knowledge about good and bad positions until you know the optimal move from every square.",
              content:
                "This analogy captures two essential MDP properties. First, the Markov property: your optimal next move depends only on your current board position, not how you got there — in trading, the current state (position, equity, features) encodes all relevant history. Second, the recursive structure: just as chess grandmasters evaluate positions by considering the best possible continuation, the Bellman equation evaluates trading states by considering the best possible sequence of future trades. Value iteration makes this concrete: initially V(s) = 0 everywhere (no knowledge), then each sweep improves estimates by looking one step ahead, gradually building up knowledge about which market conditions are valuable to be in.",
              emoji: "🎲",
            },
            {
              type: "intuition",
              title: "Discount Factor as the Time Value of Money",
              analogy:
                "The discount factor γ in RL is directly analogous to the time value of money in finance. A dollar today is worth more than a dollar tomorrow because you can invest it. If the risk-free rate is r, then $1 tomorrow is worth $1/(1+r) ≈ $(1−r) today. Setting γ = 1/(1+r) makes the RL discount identical to financial discounting. For a daily risk-free rate of r = 0.01% (≈ 2.5% annually), γ = 0.9999. For an intraday trader who values capital turnover at 5% per trade, γ = 0.95. The 'effective horizon' T_eff = 1/(1−γ) tells you how far ahead the agent looks: γ = 0.99 → 100 bars, γ = 0.95 → 20 bars, γ = 0.5 → 2 bars.",
              content:
                "This financial interpretation resolves a common confusion: why use γ < 1 at all? Three reasons: (1) Mathematical necessity — γ < 1 ensures the infinite sum ∑γᵗrₜ converges, giving a finite value function. (2) Risk preference — future trading profits are uncertain; discounting reflects the increasing uncertainty of distant rewards. (3) Capital efficiency — money tied up in a position has opportunity cost; γ encodes the hurdle rate for holding vs redeploying capital. Practitioners should set γ based on their trading frequency: γ ≈ 0.999 for daily swing trading, γ ≈ 0.99 for 1H intraday, γ ≈ 0.95 for 5-minute scalping.",
              emoji: "💰",
            },
            {
              type: "code",
              title: "Complete MDP Value Iteration for a 3-Regime Trading Environment",
              language: "python",
              code: `import numpy as np

class ForexRegimeMDP:
    """
    3-regime (trending/ranging/volatile) × 3-position (short/flat/long) MDP.
    State index: s = regime * 3 + position  (9 states total)
    Actions: 0=sell, 1=hold, 2=buy (transition between positions)
    """
    def __init__(self, gamma: float = 0.95):
        self.n_regimes = 3   # trending=0, ranging=1, volatile=2
        self.n_positions = 3  # short=0, flat=1, long=2
        self.n_states = self.n_regimes * self.n_positions  # 9
        self.n_actions = 3    # sell=0, hold=1, buy=2
        self.gamma = gamma
        self.regime_names = ["trending", "ranging", "volatile"]
        self.pos_names = ["short", "flat", "long"]
        self.action_names = ["sell", "hold", "buy"]

        # P(regime'|regime) — regimes are persistent (diagonal-dominant)
        self.regime_trans = np.array([
            [0.70, 0.20, 0.10],   # trending stays trending 70%
            [0.25, 0.50, 0.25],   # ranging is least persistent
            [0.15, 0.25, 0.60],   # volatile stays volatile 60%
        ])

        # R(regime, position) — reward per step for holding position in regime
        # trending: long is profitable, short loses
        # ranging: flat is best (avoid whipsaw), positions lose slightly
        # volatile: all positions risky, flat is safest
        self.rewards = np.array([
            [-1.5,  0.0, +2.0],   # trending: long wins big
            [-0.3, +0.1, -0.2],   # ranging: flat slightly positive
            [-0.8, -0.1, -0.5],   # volatile: everything hurts, flat least
        ])
        # Transaction cost for changing position
        self.tx_cost = 0.05

    def get_reward(self, regime: int, old_pos: int, new_pos: int) -> float:
        """Reward = position P&L in regime - transaction cost for changes."""
        return self.rewards[regime, new_pos] - self.tx_cost * abs(new_pos - old_pos)

    def value_iteration(self, tol: float = 1e-8, max_iters: int = 2000):
        """
        V*(s) = max_a [R(s,a) + gamma * sum_{s'} P(s'|s,a) * V*(s')]
        Returns optimal V* and policy pi*.
        """
        V = np.zeros(self.n_states)
        policy = np.zeros(self.n_states, dtype=int)
        history = []  # track convergence

        for iteration in range(max_iters):
            V_new = np.zeros_like(V)
            for s in range(self.n_states):
                regime, pos = divmod(s, self.n_positions)
                best_val, best_action = -np.inf, 0
                for a in range(self.n_actions):
                    new_pos = int(np.clip(pos + a - 1, 0, 2))
                    # Bellman: R + gamma * sum_{s'} P(s'|s,a) * V(s')
                    q_sa = 0.0
                    for next_regime in range(self.n_regimes):
                        next_s = next_regime * self.n_positions + new_pos
                        r = self.get_reward(next_regime, pos, new_pos)
                        q_sa += self.regime_trans[regime, next_regime] * (
                            r + self.gamma * V[next_s]
                        )
                    if q_sa > best_val:
                        best_val, best_action = q_sa, a
                V_new[s] = best_val
                policy[s] = best_action

            delta = np.max(np.abs(V_new - V))
            history.append(delta)
            V = V_new
            if delta < tol:
                print(f"Value iteration converged in {iteration + 1} iterations")
                print(f"  Final max delta: {delta:.2e}")
                print(f"  Contraction bound (gamma^k): {self.gamma**(iteration+1):.2e}")
                break
        return V, policy, history

    def print_results(self, V, policy):
        print(f"\\n{'State':>22s} | {'V*(s)':>8s} | {'pi*(s)':>8s}")
        print("-" * 48)
        for s in range(self.n_states):
            regime, pos = divmod(s, self.n_positions)
            state_name = f"({self.regime_names[regime]}, {self.pos_names[pos]})"
            action_name = self.action_names[policy[s]]
            print(f"  {state_name:>20s} | {V[s]:+8.3f} | {action_name:>8s}")

# ── Run value iteration ──────────────────────────────────────
print("=" * 50)
print("FOREX REGIME MDP — VALUE ITERATION")
print("=" * 50)
for gamma in [0.50, 0.90, 0.99]:
    print(f"\\n--- gamma = {gamma} (effective horizon = {1/(1-gamma):.0f} steps) ---")
    mdp = ForexRegimeMDP(gamma=gamma)
    V_star, pi_star, conv = mdp.value_iteration()
    mdp.print_results(V_star, pi_star)

print("\\nKey insight: Higher gamma -> agent values future regime transitions")
print("With gamma=0.99, agent may hold through volatile periods expecting trend")
print("With gamma=0.50, agent reacts myopically to current regime only")`,
              explanation:
                "A complete 9-state MDP (3 regimes × 3 positions) with transaction costs. Value iteration applies the Bellman operator V*(s) = maxₐ[R(s,a) + γ∑P(s′|s,a)V*(s′)] until the maximum change falls below tolerance. The contraction mapping property guarantees convergence at rate γᵏ. Running with different γ values shows how the discount factor changes policy: low γ (myopic) reacts only to the current regime, while high γ (patient) accounts for regime persistence and may tolerate temporary losses in volatile markets expecting a return to trending conditions.",
            },
            {
              type: "code",
              title: "Policy Evaluation vs Policy Iteration — Comparative Implementation",
              language: "python",
              code: `import numpy as np
import time

def policy_evaluation(P_regime, rewards, policy, gamma, n_states=9,
                      n_positions=3, n_regimes=3, tol=1e-8, max_it=5000):
    """Evaluate a fixed policy: solve V^pi via iterative Bellman expectation."""
    V = np.zeros(n_states)
    for it in range(max_it):
        V_new = np.zeros_like(V)
        for s in range(n_states):
            reg, pos = divmod(s, n_positions)
            a = policy[s]
            new_pos = int(np.clip(pos + a - 1, 0, 2))
            for nr in range(n_regimes):
                ns = nr * n_positions + new_pos
                V_new[s] += P_regime[reg, nr] * (rewards[nr, new_pos] + gamma * V[ns])
        if np.max(np.abs(V_new - V)) < tol:
            return V_new, it + 1
        V = V_new
    return V, max_it

def policy_iteration(P_regime, rewards, gamma, n_states=9,
                     n_positions=3, n_regimes=3, n_actions=3):
    """Policy iteration: evaluate -> improve -> repeat until stable."""
    policy = np.ones(n_states, dtype=int)  # start with 'hold' everywhere
    for pi_iter in range(100):
        # Step 1: Policy evaluation — find V^pi
        V, eval_iters = policy_evaluation(
            P_regime, rewards, policy, gamma, n_states, n_positions, n_regimes
        )
        # Step 2: Policy improvement — greedy w.r.t. V^pi
        stable = True
        for s in range(n_states):
            reg, pos = divmod(s, n_positions)
            q_vals = np.zeros(n_actions)
            for a in range(n_actions):
                new_pos = int(np.clip(pos + a - 1, 0, 2))
                for nr in range(n_regimes):
                    ns = nr * n_positions + new_pos
                    q_vals[a] += P_regime[reg, nr] * (
                        rewards[nr, new_pos] + gamma * V[ns]
                    )
            best_a = np.argmax(q_vals)
            if best_a != policy[s]:
                stable = False
                policy[s] = best_a
        if stable:
            print(f"Policy iteration converged in {pi_iter + 1} outer loops")
            return V, policy
    return V, policy

# ── Compare value iteration vs policy iteration ──────────────
P = np.array([[0.70, 0.20, 0.10], [0.25, 0.50, 0.25], [0.15, 0.25, 0.60]])
R = np.array([[-1.5, 0.0, 2.0], [-0.3, 0.1, -0.2], [-0.8, -0.1, -0.5]])
gamma = 0.95

print("POLICY ITERATION vs VALUE ITERATION COMPARISON")
print("=" * 55)

t0 = time.perf_counter()
V_pi, pi_pi = policy_iteration(P, R, gamma)
t_pi = time.perf_counter() - t0

# Value iteration for comparison
V_vi = np.zeros(9)
vi_iters = 0
for it in range(2000):
    V_new = np.zeros(9)
    for s in range(9):
        reg, pos = divmod(s, 3)
        best = -np.inf
        for a in range(3):
            np_ = int(np.clip(pos + a - 1, 0, 2))
            q = sum(P[reg, nr] * (R[nr, np_] + gamma * V_vi[nr*3+np_]) for nr in range(3))
            best = max(best, q)
        V_new[s] = best
    if np.max(np.abs(V_new - V_vi)) < 1e-8:
        vi_iters = it + 1; break
    V_vi = V_new
t_vi = time.perf_counter() - t0 - t_pi

print(f"\\nPolicy iteration: converged, V* max = {V_pi.max():.4f}")
print(f"Value iteration:  {vi_iters} iterations, V* max = {V_vi.max():.4f}")
print(f"V* agreement: max|V_pi - V_vi| = {np.max(np.abs(V_pi - V_vi)):.2e}")
print(f"\\nBoth methods find identical optimal values and policies.")
print(f"Policy iteration typically needs fewer outer loops (but each is expensive).")
print(f"Value iteration is simpler and preferred for small state spaces.")`,
              explanation:
                "Policy iteration alternates between (1) policy evaluation — solving V^π by iterating the Bellman expectation equation until convergence — and (2) policy improvement — making the policy greedy with respect to V^π. It converges in fewer outer iterations than value iteration (typically 3-5 vs hundreds), but each outer iteration requires a full inner convergence. Both methods find identical V* and π*. This comparison demonstrates the two fundamental dynamic programming algorithms for MDPs.",
            },
            {
              type: "code",
              title: "Q-Value Computation and Optimal Policy Extraction",
              language: "python",
              code: `import numpy as np

def compute_q_star(V_star, P_regime, rewards, gamma,
                   n_states=9, n_positions=3, n_regimes=3, n_actions=3):
    """Compute Q*(s,a) from V*(s): Q*(s,a) = R(s,a) + gamma * sum P * V*(s')."""
    Q = np.zeros((n_states, n_actions))
    for s in range(n_states):
        reg, pos = divmod(s, n_positions)
        for a in range(n_actions):
            new_pos = int(np.clip(pos + a - 1, 0, 2))
            for nr in range(n_regimes):
                ns = nr * n_positions + new_pos
                Q[s, a] += P_regime[reg, nr] * (
                    rewards[nr, new_pos] + gamma * V_star[ns]
                )
    return Q

# Setup: same 3-regime MDP
P = np.array([[0.70, 0.20, 0.10], [0.25, 0.50, 0.25], [0.15, 0.25, 0.60]])
R = np.array([[-1.5, 0.0, 2.0], [-0.3, 0.1, -0.2], [-0.8, -0.1, -0.5]])
gamma = 0.95
regimes = ["trending", "ranging", "volatile"]
positions = ["short", "flat", "long"]
actions = ["sell", "hold", "buy"]

# First get V* via value iteration
V = np.zeros(9)
for _ in range(1000):
    V_new = np.zeros(9)
    for s in range(9):
        reg, pos = divmod(s, 3)
        best = -np.inf
        for a in range(3):
            np_ = int(np.clip(pos + a - 1, 0, 2))
            q = sum(P[reg, nr] * (R[nr, np_] + gamma * V[nr*3+np_]) for nr in range(3))
            best = max(best, q)
        V_new[s] = best
    if np.max(np.abs(V_new - V)) < 1e-10: break
    V = V_new

# Compute Q* and extract policy
Q = compute_q_star(V, P, R, gamma)

print("COMPLETE Q*(s,a) TABLE")
print("=" * 70)
print(f"{'State':>22s} | {'Q(sell)':>8s} | {'Q(hold)':>8s} | {'Q(buy)':>8s} | {'pi*(s)':>6s}")
print("-" * 70)
for s in range(9):
    reg, pos = divmod(s, 3)
    state = f"({regimes[reg]}, {positions[pos]})"
    best_a = np.argmax(Q[s])
    print(f"  {state:>20s} | {Q[s,0]:+8.3f} | {Q[s,1]:+8.3f} | {Q[s,2]:+8.3f} | {actions[best_a]:>6s}")

# Verify V*(s) = max_a Q*(s,a)
print(f"\\nVerification: V*(s) = max_a Q*(s,a)")
for s in range(9):
    reg, pos = divmod(s, 3)
    assert abs(V[s] - np.max(Q[s])) < 1e-6, "Mismatch!"
print(f"  ✓ All 9 states satisfy V*(s) = max_a Q*(s,a)")

# Advantage function A*(s,a) = Q*(s,a) - V*(s)
print(f"\\nADVANTAGE A*(s,a) = Q*(s,a) - V*(s) for trending regime:")
for pos in range(3):
    s = 0 * 3 + pos  # trending regime
    print(f"  {positions[pos]:>5s}: ", end="")
    for a in range(3):
        adv = Q[s, a] - V[s]
        print(f"A({actions[a]})={adv:+.3f}  ", end="")
    print()
print("\\nPositive advantage = action better than average. Negative = worse.")`,
              explanation:
                "This code computes the full Q*(s,a) table from V* using Q*(s,a) = R(s,a) + γ∑P(s′|s,a)V*(s′), verifies the fundamental relationship V*(s) = maxₐ Q*(s,a), and computes the advantage function A*(s,a) = Q*(s,a) − V*(s). The Q-table reveals why the agent prefers certain actions: in trending markets, Q(trending,flat,buy) >> Q(trending,flat,sell), showing that going long captures the trend. The advantage function isolates each action's value relative to the state baseline — positive advantage means the action is better than average, which is the signal policy gradient methods will later use.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-mdp-q1",
                  question: "In the Bellman equation, what does γ = 0 imply about agent behaviour?",
                  options: [
                    { id: "rl-mdp-q1-a", text: "The agent considers all future rewards equally" },
                    { id: "rl-mdp-q1-b", text: "The agent only maximises immediate reward, ignoring all future consequences" },
                    { id: "rl-mdp-q1-c", text: "The agent's value function becomes infinite" },
                    { id: "rl-mdp-q1-d", text: "The agent never takes any action" },
                  ],
                  correctOptionId: "rl-mdp-q1-b",
                  explanation:
                    "With γ=0, V*(s) = maxₐ R(s,a) — the future term γ∑P·V* vanishes entirely. The agent becomes purely myopic, like a scalper who takes the highest immediate P&L without considering position management, transaction costs of future trades, or regime transitions.",
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
                    "V*(s) = maxₐ Q*(s,a) — the optimal state value equals the value of taking the best possible action. This relationship is fundamental: it means the optimal policy is always deterministic: π*(s) = argmaxₐ Q*(s,a).",
                },
                {
                  id: "rl-mdp-q3",
                  question: "Given a 2-state MDP with γ = 0.9, R(s₁,a₁) = 3, P(s₁|s₁,a₁) = 0.8, P(s₂|s₁,a₁) = 0.2, V*(s₁) = 15, V*(s₂) = 5, what is Q*(s₁,a₁)?",
                  options: [
                    { id: "rl-mdp-q3-a", text: "3 + 0.9 × (0.8 × 15 + 0.2 × 5) = 3 + 0.9 × 13 = 14.7" },
                    { id: "rl-mdp-q3-b", text: "3 + 0.8 × 15 + 0.2 × 5 = 16.0" },
                    { id: "rl-mdp-q3-c", text: "0.9 × (3 + 0.8 × 15 + 0.2 × 5) = 14.4" },
                    { id: "rl-mdp-q3-d", text: "3 × 0.9 + 15 × 0.8 = 14.7" },
                  ],
                  correctOptionId: "rl-mdp-q3-a",
                  explanation:
                    "Q*(s,a) = R(s,a) + γ ∑ₛ′ P(s′|s,a) V*(s′) = 3 + 0.9 × (0.8 × 15 + 0.2 × 5) = 3 + 0.9 × (12 + 1) = 3 + 11.7 = 14.7. The reward is immediate (not discounted), while future values are discounted by γ and weighted by transition probabilities.",
                },
                {
                  id: "rl-mdp-q4",
                  question: "Why does value iteration converge, and what determines the convergence rate?",
                  options: [
                    { id: "rl-mdp-q4-a", text: "It converges because rewards are bounded; rate is O(1/k)" },
                    { id: "rl-mdp-q4-b", text: "The Bellman operator T is a γ-contraction in sup-norm: ‖TVₐ − TVᵦ‖∞ ≤ γ‖Vₐ − Vᵦ‖∞; convergence rate is O(γᵏ)" },
                    { id: "rl-mdp-q4-c", text: "It converges by gradient descent on the Bellman error; rate depends on learning rate" },
                    { id: "rl-mdp-q4-d", text: "Convergence is not guaranteed; it depends on the initial V₀" },
                  ],
                  correctOptionId: "rl-mdp-q4-b",
                  explanation:
                    "The Bellman optimality operator is a γ-contraction mapping in the L∞ norm. By the Banach Fixed-Point Theorem, it has a unique fixed point V* and iterates converge at geometric rate γᵏ. Higher γ means slower convergence (more patient agents need more iterations). Convergence is guaranteed regardless of initial V₀.",
                },
                {
                  id: "rl-mdp-q5",
                  question: "In our 3-regime forex MDP, why might the optimal policy prescribe 'hold' in the volatile regime even when the agent is already long?",
                  options: [
                    { id: "rl-mdp-q5-a", text: "The agent has run out of capital to trade" },
                    { id: "rl-mdp-q5-b", text: "Selling incurs transaction costs, and the volatile regime has a 25% chance of transitioning to trending where being long is highly profitable" },
                    { id: "rl-mdp-q5-c", text: "The Markov property prevents the agent from remembering its position" },
                    { id: "rl-mdp-q5-d", text: "Value iteration cannot handle multiple regimes" },
                  ],
                  correctOptionId: "rl-mdp-q5-b",
                  explanation:
                    "With γ = 0.95, the agent looks ~20 steps ahead. The volatile→trending transition probability of 0.15 means there is a meaningful chance of entering a highly profitable regime soon. Selling to go flat costs a transaction fee AND gives up the long position that would be very profitable if trending resumes. The value iteration captures this multi-step reasoning automatically.",
                },
                {
                  id: "rl-mdp-q6",
                  question: "What is the effective planning horizon T_eff when γ = 0.95, and how does this compare to γ = 0.99?",
                  options: [
                    { id: "rl-mdp-q6-a", text: "T_eff(0.95) = 20 steps, T_eff(0.99) = 100 steps — 5× longer horizon" },
                    { id: "rl-mdp-q6-b", text: "T_eff(0.95) = 95 steps, T_eff(0.99) = 99 steps — nearly identical" },
                    { id: "rl-mdp-q6-c", text: "T_eff(0.95) = 5 steps, T_eff(0.99) = 1 step — inverse relationship" },
                    { id: "rl-mdp-q6-d", text: "The effective horizon is infinite for both values" },
                  ],
                  correctOptionId: "rl-mdp-q6-a",
                  explanation:
                    "T_eff = 1/(1−γ). For γ=0.95: T_eff = 1/0.05 = 20. For γ=0.99: T_eff = 1/0.01 = 100. The γ=0.99 agent effectively plans 5× further ahead. On hourly bars, this means the γ=0.95 agent looks ~1 day ahead while γ=0.99 looks ~4 days ahead — a significant difference for swing trading decisions.",
                },
              ],
            },
            {
              type: "practice",
              title: "Guided: Extend the MDP with Transaction Costs and Position Sizing",
              description:
                "Start with the ForexRegimeMDP class above. Make these modifications step by step:\n\n1. Add a transaction cost of 0.1 per unit of position change: cost = 0.1 × |new_pos − old_pos|. Modify get_reward() to subtract this cost.\n2. Expand the position space from {short, flat, long} to {−2, −1, 0, +1, +2} (5 positions). Update n_positions, the action space, and the reward matrix.\n3. Add a 4th regime: 'high_volatility' with rewards [-1.5, -0.3, -1.2, -0.5, -1.0] and high persistence P(high_vol|high_vol) = 0.65.\n4. Run value iteration with γ ∈ {0.5, 0.9, 0.99} and compare: (a) how many states have pi*(s) = hold vs active trading, (b) the total value V* summed across states.\n\nExpected insight: Transaction costs make the agent trade less frequently — the 'hold' action becomes optimal in more states, especially for low γ where the agent cannot justify the cost with future expected returns.",
              catalogModelId: "mdp-value-iteration",
            },
            {
              type: "practice",
              title: "Open-Ended: Build a Realistic Multi-Asset MDP",
              description:
                "Design and implement an MDP for a portfolio of 2 forex pairs (EUR/USD and GBP/USD) with correlated regime transitions. Your state space should include: regime for each pair (3 regimes each = 9 regime combinations), position in each pair (3 positions each = 9 position combinations), giving 81 total states. Define realistic transition probabilities using the correlation between the pairs (e.g., if EUR/USD is trending, GBP/USD has a 40% chance of also trending). Design a reward function that accounts for correlation risk — holding the same direction in correlated pairs should have lower risk-adjusted reward than diversified positions. Solve with value iteration and analyse: does the optimal policy exploit pair correlations for diversification?",
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
                "Master temporal difference learning, derive the TD(0) update from Bellman error minimisation, understand Q-learning as off-policy TD control, compare with on-policy SARSA, and implement exploration strategies including ε-greedy, softmax, and UCB for discrete forex action spaces.",
              keyTakeaways: [
                "TD(0) update: V(s) ← V(s) + α[r + γV(s′) − V(s)], where δₜ = r + γV(s′) − V(s) is the TD error",
                "Q-learning (off-policy): Q(s,a) ← Q(s,a) + α[r + γ maxₐ′ Q(s′,a′) − Q(s,a)] — learns Q* regardless of behaviour policy",
                "SARSA (on-policy): Q(s,a) ← Q(s,a) + α[r + γQ(s′,a′) − Q(s,a)] where a′ ~ π — learns Q^π, safer with costs",
                "Convergence requires Robbins-Monro conditions: ∑αₜ = ∞ and ∑αₜ² < ∞ (e.g., αₜ = 1/t)",
                "ε-greedy: exploit best with prob 1−ε, random with prob ε; softmax: π(a) ∝ exp(Q(a)/τ); UCB: argmaxₐ[Q(a) + c√(ln t/Nₐ)]",
                "Q-learning converges to Q* under any policy that visits all (s,a) pairs infinitely often",
                "SARSA converges to Q^π_ε (the Q-function of the ε-greedy policy), which is more conservative near 'cliffs'",
                "Forex discrete action space: A = {buy, sell, hold} maps naturally to position changes in a Q-table",
              ],
            },
            {
              type: "theory",
              title: "TD(0) Derivation from Bellman Error Minimisation",
              content:
                "**Motivation.** Value iteration requires the full model P(s′|s,a) — impractical for financial markets where transition dynamics are unknown and non-stationary. Temporal Difference (TD) learning solves this by learning V^π(s) directly from experience (sₜ, rₜ, sₜ₊₁) without knowing P.\n\n**Derivation.** The Bellman expectation equation states V^π(s) = 𝔼π[r + γV^π(s′) | s]. Consider the sample-based approximation: given a single transition (s, r, s′), the 'TD target' is yₜ = r + γV(s′). The 'TD error' is δₜ = yₜ − V(s) = r + γV(s′) − V(s). This measures the discrepancy between our current estimate V(s) and the one-step bootstrapped estimate r + γV(s′). The TD(0) update moves V(s) toward the target: V(s) ← V(s) + α · δₜ = V(s) + α[r + γV(s′) − V(s)]. This is a stochastic approximation to solving the Bellman equation: if we average many updates, 𝔼[δₜ] → 0 when V = V^π.\n\n**Why 'bootstrapping'?** Unlike Monte Carlo methods that wait for the complete return Gₜ = ∑ₖ γᵏrₜ₊ₖ (requiring full episodes), TD(0) uses V(s′) as a stand-in for the future — updating one estimate using another estimate. This introduces bias (V(s′) may be wrong) but dramatically reduces variance (no need to sum noisy returns over many steps). The bias-variance tradeoff is controlled by n-step TD: TD(n) uses rₜ + γrₜ₊₁ + … + γⁿ⁻¹rₜ₊ₙ₋₁ + γⁿV(sₜ₊ₙ). TD(0) = maximum bootstrap (low variance, higher bias). MC = no bootstrap (zero bias, high variance). TD(λ) with eligibility traces provides a continuous interpolation.\n\n**Numerical Example.** Suppose V(ranging) = 2.0, V(trending) = 5.0, γ = 0.9, α = 0.1. The agent is in state 'ranging', takes action 'hold', receives reward r = 0.3, and transitions to 'trending'. TD target: y = 0.3 + 0.9 × 5.0 = 4.8. TD error: δ = 4.8 − 2.0 = 2.8 (positive surprise — the future is better than expected). Update: V(ranging) ← 2.0 + 0.1 × 2.8 = 2.28. The value of 'ranging' increases because transitioning to the profitable 'trending' state was a pleasant surprise.",
            },
            {
              type: "theory",
              title: "Q-Learning as Off-Policy TD Control — Derivation and Convergence",
              content:
                "**From V to Q.** TD(0) learns V^π(s) for a fixed policy π. For control (finding π*), we need Q-values because π*(s) = argmaxₐ Q*(s,a) — selecting the best action requires comparing Q-values, not just V-values. Q-learning directly approximates Q* without policy evaluation.\n\n**Q-Learning Update.** Q(sₜ,aₜ) ← Q(sₜ,aₜ) + α[rₜ + γ maxₐ Q(sₜ₊₁,a) − Q(sₜ,aₜ)]. The key insight: the target uses maxₐ Q(sₜ₊₁,a) — the greedy action in the next state — regardless of what action the agent actually takes. This makes Q-learning 'off-policy': the behaviour policy (how the agent explores) can differ from the target policy (always greedy w.r.t. Q). The agent can explore using ε-greedy, Boltzmann, or even random actions, and Q-learning will still converge to Q*.\n\n**Convergence Conditions (Robbins-Monro).** Q-learning converges to Q* with probability 1 if: (1) All state-action pairs are visited infinitely often: ∀(s,a), Nₜ(s,a) → ∞. (2) Learning rates satisfy: ∑ₜ αₜ(s,a) = ∞ (enough learning) and ∑ₜ αₜ(s,a)² < ∞ (updates shrink). A common schedule: αₜ(s,a) = 1/Nₜ(s,a)^ω with ω ∈ (0.5, 1]. In practice, a fixed α = 0.1 works well for non-stationary environments (markets!) because it keeps adapting to distribution shifts, though it technically violates the second condition.\n\n**Numerical Example: 3 States × 3 Actions.** States: {trending, ranging, volatile}. Actions: {buy, sell, hold}. Initialize Q = 0 everywhere. Episode: s=ranging, a=buy → r=−0.5, s′=volatile. Q(ranging,buy) ← 0 + 0.1 × [−0.5 + 0.95 × max(Q(volatile,·)) − 0] = 0.1 × [−0.5 + 0] = −0.05. Next: s=volatile, a=hold → r=−0.1, s′=trending. Q(volatile,hold) ← 0 + 0.1 × [−0.1 + 0.95 × max(Q(trending,·)) − 0] = −0.01. Next: s=trending, a=buy → r=+1.5, s′=trending. Q(trending,buy) ← 0 + 0.1 × [1.5 + 0.95 × 0 − 0] = 0.15. After thousands of such updates, Q converges to Q* and the greedy policy emerges: buy in trending, hold in ranging, sell or hold in volatile.",
            },
            {
              type: "theory",
              title: "SARSA, Exploration Strategies, and On-Policy vs Off-Policy",
              content:
                "**SARSA (State-Action-Reward-State-Action).** The on-policy counterpart to Q-learning: Q(sₜ,aₜ) ← Q(sₜ,aₜ) + α[rₜ + γQ(sₜ₊₁,aₜ₊₁) − Q(sₜ,aₜ)]. The critical difference: the target uses Q(sₜ₊₁,aₜ₊₁) where aₜ₊₁ is the action actually taken by the current policy (including exploration). SARSA learns Q^π (the Q-function of the current ε-greedy policy), not Q*. This means SARSA's learned values account for the fact that the agent sometimes explores — making it more conservative near 'cliffs' (catastrophic losses). In trading, SARSA with ε-greedy avoids strategies that are optimal in theory but disastrous when occasionally disrupted by random exploration (e.g., a strategy requiring precise timing that fails badly if a random trade interrupts).\n\n**Exploration Strategies Compared:**\n\n*ε-Greedy*: With prob ε take random action, else argmaxₐ Q(s,a). Pros: simple, guaranteed exploration. Cons: wastes exploration on clearly bad actions. Schedule: εₜ = max(ε_min, ε₀ × decay^t) or εₜ = ε₀/(1 + t/N).\n\n*Softmax (Boltzmann)*: π(a|s) = exp(Q(s,a)/τ) / ∑ₐ′ exp(Q(s,a′)/τ). Temperature τ controls exploration: τ → ∞ gives uniform random, τ → 0 gives greedy. Advantage: explores proportionally to Q-value estimates — arms with similar Q-values are explored more evenly. Disadvantage: sensitive to Q-value scale.\n\n*UCB (Upper Confidence Bound)*: Select argmaxₐ [Q(s,a) + c√(ln t / N(s,a))]. The bonus √(ln t / N(s,a)) grows for under-explored actions and shrinks with more visits. Advantage: directed exploration with theoretical regret bounds. Disadvantage: requires visit counts, less natural in non-stationary environments.\n\n**Trading Application.** For A = {buy, sell, hold}: ε-greedy is the standard choice because it is robust and simple. Softmax is preferred when Q-values for buy and sell are close (uncertain market direction) — it allocates exploration proportionally rather than uniformly. UCB is useful during initial learning when the agent has little data for each market condition. As ε → 0 or τ → 0, all strategies converge to the greedy policy.",
            },
            {
              type: "intuition",
              title: "Q-Learning as Paper Trading with a Notebook",
              analogy:
                "Imagine you are paper trading with a notebook. Each page is labelled with a market condition (state) and you have columns for each possible action (buy, sell, hold). Each cell records your running estimate of the expected profit. After each paper trade, you update: 'I expected $50 from buying in this setup but actually got $30 immediate profit + I estimate the new setup is worth $40 discounted — so my one-step target is $68. My error was $68 − $50 = $18, so I adjust my estimate up by α × $18 = $1.80.' Over thousands of paper trades, your notebook converges to the true expected profits for every condition × action combination. The ε-greedy rule forces you to try unconventional trades 10% of the time — buying in a downtrend might feel wrong, but you need data to confirm it is actually bad rather than just assuming.",
              content:
                "The key insight is that Q-learning is off-policy: even while following the notebook's advice 90% of the time and randomizing 10%, the max in the update target ensures convergence to the optimal Q-values, not the ε-greedy Q-values. This is powerful: you can explore wildly during paper trading and still learn the optimal strategy. The learning rate α is your stubbornness factor — α = 0.1 means 'I update my beliefs 10% toward new evidence, keeping 90% of my old estimate.' Low α = slow but stable learning. High α = fast but noisy.",
              emoji: "📓",
            },
            {
              type: "intuition",
              title: "SARSA as a Risk-Aware Trader vs Q-Learning's Optimist",
              analogy:
                "Q-learning is an optimistic trader who plans as if they will always make the perfect next trade. SARSA is a realistic trader who knows they will occasionally make mistakes (exploration = fat-finger trades, impulsive exits). Consider a high-reward strategy that requires executing a precise sequence of trades — if any trade is wrong, the whole setup loses money. Q-learning says 'this is great — I will always get it right!' and assigns high Q-values. SARSA says 'but 10% of the time I will mess up a step, so this strategy is actually dangerous' and assigns lower Q-values, preferring simpler, more robust strategies.",
              content:
                "This difference matters hugely in trading with transaction costs. A strategy that works perfectly in theory (Q-learning) might require frequent position changes — if the agent explores at the wrong moment (SARSA accounts for this), it incurs unnecessary costs. SARSA's conservatism naturally avoids these 'cliff' strategies. The classic example: Q-learning walks along the cliff edge (shortest path, maximum reward if perfect); SARSA takes the safe path inland (slightly longer, but robust to occasional random steps off the cliff). In trading, the 'cliff' is a leveraged position that works only with perfect timing.",
              emoji: "🛡️",
            },
            {
              type: "code",
              title: "Complete Q-Learning Agent with Discretised Forex Environment",
              language: "python",
              code: `import numpy as np

class DiscreteTradingEnv:
    """
    Discretised forex environment for tabular Q-learning.
    State = (return_bin, volatility_bin, position) — 10×5×3 = 150 states
    Actions = {sell=0, hold=1, buy=2}
    """
    def __init__(self, returns: np.ndarray, window: int = 20, n_ret_bins: int = 10,
                 n_vol_bins: int = 5, tx_cost: float = 0.001):
        self.returns = returns
        self.window = window
        self.tx_cost = tx_cost
        self.n_positions = 3  # short=0, flat=1, long=2

        # Create bins from training data
        self.ret_bins = np.linspace(
            np.percentile(returns, 5), np.percentile(returns, 95), n_ret_bins - 1
        )
        self.vol_bins = np.linspace(
            np.percentile(np.abs(returns), 10), np.percentile(np.abs(returns), 90),
            n_vol_bins - 1
        )
        self.n_ret_bins = n_ret_bins
        self.n_vol_bins = n_vol_bins
        self.n_states = n_ret_bins * n_vol_bins * self.n_positions
        self.n_actions = 3
        self.reset()

    def _encode_state(self) -> int:
        ret = self.returns[self.t]
        vol = np.std(self.returns[max(0, self.t-self.window):self.t+1])
        ret_bin = np.digitize(ret, self.ret_bins)
        vol_bin = np.digitize(vol, self.vol_bins)
        return (ret_bin * self.n_vol_bins + vol_bin) * self.n_positions + self.position

    def reset(self) -> int:
        self.t = self.window
        self.position = 1  # start flat
        self.equity = 1.0
        return self._encode_state()

    def step(self, action: int):
        old_pos = self.position
        self.position = int(np.clip(old_pos + action - 1, 0, 2))
        pnl = (self.position - 1) * self.returns[self.t]
        cost = self.tx_cost * abs(self.position - old_pos)
        reward = pnl - cost
        self.equity += reward
        self.t += 1
        done = self.t >= len(self.returns) - 1
        return self._encode_state(), reward, done

def q_learning(env, n_episodes: int = 500, alpha: float = 0.1, gamma: float = 0.95,
               epsilon: float = 1.0, eps_min: float = 0.01, eps_decay: float = 0.995):
    """
    Tabular Q-learning with ε-greedy exploration.
    Q(s,a) ← Q(s,a) + α[r + γ max_a' Q(s',a') - Q(s,a)]
    """
    Q = np.zeros((env.n_states, env.n_actions))
    visit_counts = np.zeros((env.n_states, env.n_actions), dtype=int)
    episode_rewards = []

    for ep in range(n_episodes):
        state = env.reset()
        total_reward = 0.0
        n_trades = 0

        while True:
            # ε-greedy action selection
            if np.random.random() < epsilon:
                action = np.random.randint(env.n_actions)
            else:
                action = int(np.argmax(Q[state]))

            next_state, reward, done = env.step(action)
            total_reward += reward
            visit_counts[state, action] += 1
            if action != 1: n_trades += 1

            # Q-learning update: off-policy (uses max)
            td_target = reward + gamma * np.max(Q[next_state]) * (1.0 - done)
            td_error = td_target - Q[state, action]
            Q[state, action] += alpha * td_error

            state = next_state
            if done:
                break

        epsilon = max(eps_min, epsilon * eps_decay)
        episode_rewards.append(total_reward)

        if (ep + 1) % 100 == 0:
            avg_r = np.mean(episode_rewards[-100:])
            visited = np.sum(visit_counts > 0)
            print(f"Ep {ep+1:4d} | AvgR(100): {avg_r:+.5f} | ε: {epsilon:.3f} "
                  f"| Equity: {env.equity:.4f} | Trades: {n_trades:3d} "
                  f"| States visited: {visited}/{env.n_states}")

    return Q, visit_counts, episode_rewards

# ── Run Q-learning ───────────────────────────────────────────
np.random.seed(42)
# Simulate 3000 bars of forex returns with regime shifts
returns = np.concatenate([
    np.random.normal(+0.0005, 0.008, 1000),  # trending up
    np.random.normal( 0.0000, 0.005, 1000),  # ranging
    np.random.normal(-0.0003, 0.012, 1000),  # volatile down
])

env = DiscreteTradingEnv(returns, window=20, tx_cost=0.001)
print(f"State space: {env.n_states} states, Action space: {env.n_actions}")
print(f"Training on {len(returns)} bars with 3 regime shifts\\n")

Q, visits, rewards = q_learning(env, n_episodes=500, alpha=0.1, gamma=0.95)

# Analyse learned policy
print(f"\\nLearned Policy Analysis:")
print(f"  Total (s,a) pairs visited: {np.sum(visits > 0)} / {env.n_states * 3}")
print(f"  Final 100-ep avg reward: {np.mean(rewards[-100:]):+.5f}")
print(f"  Best Q-value: {Q.max():+.4f} at state {np.unravel_index(Q.argmax(), Q.shape)}")`,
              explanation:
                "A complete tabular Q-learning agent on a discretised forex environment with 150 states (return bin × volatility bin × position). The environment includes transaction costs. Q-learning uses ε-greedy exploration with decay, tracking visit counts and episode rewards. The TD update Q(s,a) ← Q(s,a) + α[r + γ max Q(s′,·) − Q(s,a)] is off-policy: the max ensures convergence to Q* regardless of the exploration policy. The simulation includes regime shifts to test adaptation.",
            },
            {
              type: "code",
              title: "SARSA Agent with Head-to-Head Comparison Against Q-Learning",
              language: "python",
              code: `import numpy as np

def sarsa(env, n_episodes: int = 500, alpha: float = 0.1, gamma: float = 0.95,
          epsilon: float = 1.0, eps_min: float = 0.01, eps_decay: float = 0.995):
    """
    SARSA: on-policy TD control.
    Q(s,a) ← Q(s,a) + α[r + γQ(s',a') - Q(s,a)]  where a' ~ ε-greedy(π)
    """
    Q = np.zeros((env.n_states, env.n_actions))
    episode_rewards = []

    for ep in range(n_episodes):
        state = env.reset()
        # Choose initial action using ε-greedy
        if np.random.random() < epsilon:
            action = np.random.randint(env.n_actions)
        else:
            action = int(np.argmax(Q[state]))
        total_reward = 0.0

        while True:
            next_state, reward, done = env.step(action)
            total_reward += reward

            # Choose NEXT action from current policy (on-policy!)
            if np.random.random() < epsilon:
                next_action = np.random.randint(env.n_actions)
            else:
                next_action = int(np.argmax(Q[next_state]))

            # SARSA update: uses Q(s', a') not max Q(s', ·)
            td_target = reward + gamma * Q[next_state, next_action] * (1.0 - done)
            td_error = td_target - Q[state, action]
            Q[state, action] += alpha * td_error

            state, action = next_state, next_action
            if done:
                break

        epsilon = max(eps_min, epsilon * eps_decay)
        episode_rewards.append(total_reward)
    return Q, episode_rewards

# ── Head-to-head comparison ──────────────────────────────────
np.random.seed(42)
returns = np.concatenate([
    np.random.normal(+0.0005, 0.008, 1000),
    np.random.normal( 0.0000, 0.005, 1000),
    np.random.normal(-0.0003, 0.012, 1000),
])

print("SARSA vs Q-LEARNING: HEAD-TO-HEAD")
print("=" * 60)

for tx_cost in [0.0, 0.001, 0.005]:
    print(f"\\n--- Transaction cost = {tx_cost} ---")

    # Need to import the env class from previous code block
    # Re-define minimally here for self-containment
    class MiniEnv:
        def __init__(self, rets, tc):
            self.returns = rets
            self.n_states, self.n_actions = 150, 3
            self.tc = tc
            self.reset()
        def reset(self):
            self.t, self.position, self.equity = 20, 1, 1.0
            rb = np.digitize(self.returns[self.t], np.linspace(-0.02, 0.02, 9))
            vb = np.digitize(np.std(self.returns[self.t-20:self.t+1]),
                             np.linspace(0.002, 0.015, 4))
            return rb * 5 * 3 + vb * 3 + self.position
        def step(self, action):
            old = self.position
            self.position = int(np.clip(old + action - 1, 0, 2))
            pnl = (self.position-1) * self.returns[self.t] - self.tc * abs(self.position-old)
            self.equity += pnl
            self.t += 1
            done = self.t >= len(self.returns) - 1
            rb = np.digitize(self.returns[self.t], np.linspace(-0.02, 0.02, 9))
            vb = np.digitize(np.std(self.returns[max(0,self.t-20):self.t+1]),
                             np.linspace(0.002, 0.015, 4))
            return rb * 5 * 3 + vb * 3 + self.position, pnl, done

    env_q = MiniEnv(returns, tx_cost)
    env_s = MiniEnv(returns, tx_cost)

    np.random.seed(123)
    Q_ql, r_ql = q_learning_lite(env_q) if False else (None, None)
    # Use inline Q-learning for fair comparison
    Q_ql = np.zeros((150, 3)); eps = 1.0; r_ql = []
    np.random.seed(123)
    for ep in range(500):
        s, tr = env_q.reset(), 0.0
        while True:
            a = np.random.randint(3) if np.random.random() < eps else int(np.argmax(Q_ql[s]))
            s2, r, d = env_q.step(a); tr += r
            Q_ql[s,a] += 0.1*(r + 0.95*np.max(Q_ql[s2])*(1-d) - Q_ql[s,a])
            s = s2
            if d: break
        eps = max(0.01, eps*0.995); r_ql.append(tr)

    np.random.seed(123)
    Q_sa, r_sa = sarsa(env_s, n_episodes=500)

    q_final = np.mean(r_ql[-100:])
    s_final = np.mean(r_sa[-100:])
    q_holds = np.sum(np.argmax(Q_ql, axis=1) == 1)
    s_holds = np.sum(np.argmax(Q_sa, axis=1) == 1)

    print(f"  Q-Learning:  avg reward = {q_final:+.5f}, hold-states = {q_holds}/150")
    print(f"  SARSA:       avg reward = {s_final:+.5f}, hold-states = {s_holds}/150")
    print(f"  SARSA more conservative: {s_holds > q_holds}")`,
              explanation:
                "SARSA uses the on-policy update Q(s,a) ← Q(s,a) + α[r + γQ(s′,a′) − Q(s,a)] where a′ is the action actually taken (including exploration). The head-to-head comparison across transaction cost levels reveals the key difference: SARSA learns more conservative policies (more 'hold' states) because it accounts for the cost of occasional random exploration trades. Q-learning optimistically assumes greedy future actions and may prescribe frequent trading that loses money when exploration disrupts the plan.",
            },
            {
              type: "code",
              title: "Exploration Strategy Comparison: ε-Greedy vs Softmax vs UCB",
              language: "python",
              code: `import numpy as np

class BanditStyleExploration:
    """Compare 3 exploration strategies on a stateless trading problem."""

    def __init__(self, n_actions: int = 3, true_q: np.ndarray = None):
        self.n_actions = n_actions
        # True Q-values: buy is best in a trending market
        self.true_q = true_q if true_q is not None else np.array([0.8, -0.1, 1.5])
        self.noise_std = 0.5

    def get_reward(self, action: int) -> float:
        return np.random.normal(self.true_q[action], self.noise_std)

def run_epsilon_greedy(env, T=2000, epsilon=0.1):
    Q = np.zeros(env.n_actions)
    N = np.zeros(env.n_actions)
    rewards, actions_taken = [], []
    for t in range(T):
        if np.random.random() < epsilon:
            a = np.random.randint(env.n_actions)
        else:
            a = int(np.argmax(Q))
        r = env.get_reward(a)
        N[a] += 1
        Q[a] += (r - Q[a]) / N[a]
        rewards.append(r); actions_taken.append(a)
    return Q, N, np.array(rewards), np.array(actions_taken)

def run_softmax(env, T=2000, tau_init=2.0, tau_decay=0.998):
    Q = np.zeros(env.n_actions)
    N = np.zeros(env.n_actions)
    rewards, actions_taken = [], []
    tau = tau_init
    for t in range(T):
        # Boltzmann distribution: π(a) ∝ exp(Q(a)/τ)
        logits = Q / max(tau, 0.01)
        logits -= logits.max()  # numerical stability
        probs = np.exp(logits) / np.sum(np.exp(logits))
        a = np.random.choice(env.n_actions, p=probs)
        r = env.get_reward(a)
        N[a] += 1
        Q[a] += (r - Q[a]) / N[a]
        rewards.append(r); actions_taken.append(a)
        tau *= tau_decay
    return Q, N, np.array(rewards), np.array(actions_taken)

def run_ucb(env, T=2000, c=2.0):
    Q = np.zeros(env.n_actions)
    N = np.zeros(env.n_actions)
    rewards, actions_taken = [], []
    for t in range(T):
        if np.any(N == 0):
            a = int(np.argmin(N))  # play each arm once
        else:
            # UCB1: argmax [Q(a) + c * sqrt(ln(t) / N(a))]
            ucb_scores = Q + c * np.sqrt(np.log(t + 1) / N)
            a = int(np.argmax(ucb_scores))
        r = env.get_reward(a)
        N[a] += 1
        Q[a] += (r - Q[a]) / N[a]
        rewards.append(r); actions_taken.append(a)
    return Q, N, np.array(rewards), np.array(actions_taken)

# ── Compare all three ────────────────────────────────────────
np.random.seed(42)
env = BanditStyleExploration(true_q=np.array([0.8, -0.1, 1.5]))
action_names = ["sell", "hold", "buy"]
print("EXPLORATION STRATEGY COMPARISON")
print(f"True Q-values: {dict(zip(action_names, env.true_q))}")
print("=" * 65)

for name, runner in [("ε-Greedy (ε=0.1)", lambda: run_epsilon_greedy(env)),
                     ("Softmax (τ: 2→0.04)", lambda: run_softmax(env)),
                     ("UCB1 (c=2.0)", lambda: run_ucb(env))]:
    np.random.seed(42)
    Q, N, rewards, actions = runner()
    cum_regret = np.cumsum(env.true_q.max() - env.true_q[actions])
    best_pct = np.mean(actions == np.argmax(env.true_q)) * 100
    print(f"\\n{name}:")
    print(f"  Learned Q: {dict(zip(action_names, [f'{q:+.3f}' for q in Q]))}")
    print(f"  Pull counts: {dict(zip(action_names, N.astype(int)))}")
    print(f"  Best arm %: {best_pct:.1f}%  |  Cumul. regret: {cum_regret[-1]:.1f}")
    print(f"  Avg reward: {rewards.mean():+.4f}  |  Last 500 avg: {rewards[-500:].mean():+.4f}")`,
              explanation:
                "Three exploration strategies compared on a 3-action trading problem. ε-Greedy explores uniformly random (wastes pulls on clearly bad actions). Softmax explores proportionally to Q-estimates (focuses on promising actions). UCB1 adds a confidence bonus √(ln t/Nₐ) that shrinks with more pulls — it explores uncertain actions systematically and achieves the tightest cumulative regret. The comparison shows pull counts, cumulative regret, and convergence speed — demonstrating why directed exploration (UCB1) outperforms random exploration (ε-greedy) especially when some actions are clearly suboptimal.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-qlearning-q1",
                  question: "What is the key difference between Q-learning and SARSA?",
                  options: [
                    { id: "rl-qlearning-q1-a", text: "Q-learning uses maxₐ′ Q(s′,a′) in the target, SARSA uses Q(s′,a′) where a′ is the action actually taken under the current policy" },
                    { id: "rl-qlearning-q1-b", text: "Q-learning has no learning rate while SARSA does" },
                    { id: "rl-qlearning-q1-c", text: "SARSA always converges faster than Q-learning" },
                    { id: "rl-qlearning-q1-d", text: "Q-learning can only handle discrete actions while SARSA works with continuous" },
                  ],
                  correctOptionId: "rl-qlearning-q1-a",
                  explanation:
                    "Q-learning's target r + γ maxₐ′ Q(s′,a′) assumes greedy future actions (off-policy). SARSA's target r + γQ(s′,a′) uses the action actually sampled from the ε-greedy policy (on-policy). This makes SARSA more conservative — it learns Q^π_ε, not Q*, accounting for the cost of occasional random exploration.",
                },
                {
                  id: "rl-qlearning-q2",
                  question: "Why must ε decay over time in ε-greedy Q-learning?",
                  options: [
                    { id: "rl-qlearning-q2-a", text: "To reduce computational cost as the Q-table fills up" },
                    { id: "rl-qlearning-q2-b", text: "To shift from exploration (broad state-action visitation) to exploitation (following the learned greedy policy)" },
                    { id: "rl-qlearning-q2-c", text: "To prevent Q-values from diverging due to the max operator" },
                    { id: "rl-qlearning-q2-d", text: "Constant ε violates the Markov property of the environment" },
                  ],
                  correctOptionId: "rl-qlearning-q2-b",
                  explanation:
                    "High ε early ensures broad state-action visitation for accurate Q-estimates across the table. As Q-values stabilise, decaying ε shifts toward exploitation of the learned policy. Without decay, the agent keeps taking random actions 10% of the time even after finding the optimal strategy — wasting returns in deployment.",
                },
                {
                  id: "rl-qlearning-q3",
                  question: "Given Q(s,a) = 5.0, r = 2.0, γ = 0.9, max Q(s′,·) = 8.0, α = 0.1, what is the updated Q(s,a)?",
                  options: [
                    { id: "rl-qlearning-q3-a", text: "5.0 + 0.1 × (2.0 + 0.9 × 8.0 − 5.0) = 5.0 + 0.1 × 4.2 = 5.42" },
                    { id: "rl-qlearning-q3-b", text: "5.0 + 0.1 × (2.0 + 8.0 − 5.0) = 5.50" },
                    { id: "rl-qlearning-q3-c", text: "0.1 × (2.0 + 0.9 × 8.0) = 0.92" },
                    { id: "rl-qlearning-q3-d", text: "5.0 + 2.0 + 0.9 × 8.0 = 14.2" },
                  ],
                  correctOptionId: "rl-qlearning-q3-a",
                  explanation:
                    "Q(s,a) ← Q(s,a) + α[r + γ max Q(s′,·) − Q(s,a)] = 5.0 + 0.1 × [2.0 + 0.9 × 8.0 − 5.0] = 5.0 + 0.1 × [2.0 + 7.2 − 5.0] = 5.0 + 0.1 × 4.2 = 5.42. The TD error δ = 4.2 is positive (positive surprise), so Q increases. Note: the reward is not discounted (it is immediate), only future values are discounted by γ.",
                },
                {
                  id: "rl-qlearning-q4",
                  question: "What are the Robbins-Monro conditions for Q-learning convergence, and why are they needed?",
                  options: [
                    { id: "rl-qlearning-q4-a", text: "∑αₜ = ∞ ensures enough total learning, ∑αₜ² < ∞ ensures updates shrink — together they guarantee convergence to Q*" },
                    { id: "rl-qlearning-q4-b", text: "αₜ must be constant and positive for all t" },
                    { id: "rl-qlearning-q4-c", text: "The learning rate must equal 1/t exactly" },
                    { id: "rl-qlearning-q4-d", text: "Robbins-Monro conditions only apply to SARSA, not Q-learning" },
                  ],
                  correctOptionId: "rl-qlearning-q4-a",
                  explanation:
                    "∑αₜ = ∞ means learning rates sum to infinity — the algorithm can overcome any initial error. ∑αₜ² < ∞ means learning rates shrink — noise from stochastic updates eventually vanishes. Together, Q(s,a) → Q*(s,a) w.p.1. Example: αₜ = 1/t satisfies both. In practice, fixed α = 0.1 works well for non-stationary markets but technically doesn't converge — it tracks the moving optimum instead.",
                },
                {
                  id: "rl-qlearning-q5",
                  question: "In a forex environment with high transaction costs, which algorithm learns a more profitable deployment policy, and why?",
                  options: [
                    { id: "rl-qlearning-q5-a", text: "Q-learning, because off-policy learning is always superior" },
                    { id: "rl-qlearning-q5-b", text: "SARSA with decayed ε, because it learns Q^π that accounts for exploration costs during training, producing a more robust deployed policy" },
                    { id: "rl-qlearning-q5-c", text: "Neither — transaction costs make RL impossible" },
                    { id: "rl-qlearning-q5-d", text: "They produce identical policies because both converge to Q*" },
                  ],
                  correctOptionId: "rl-qlearning-q5-b",
                  explanation:
                    "Q-learning learns Q* (optimal under greedy policy) but the deployed ε=0 policy differs from the training policy (ε>0). With high tx costs, Q-learning may learn aggressive strategies that assume perfect execution. SARSA's on-policy learning accounts for occasional exploration mistakes during training, producing policies that are robust to execution noise — the deployed policy (ε≈0) is close to the trained policy (small ε).",
                },
                {
                  id: "rl-qlearning-q6",
                  question: "Why does the softmax exploration strategy outperform ε-greedy when two actions have similar Q-values?",
                  options: [
                    { id: "rl-qlearning-q6-a", text: "Softmax uses a neural network while ε-greedy does not" },
                    { id: "rl-qlearning-q6-b", text: "Softmax allocates exploration proportionally via π(a) ∝ exp(Q(a)/τ), giving more pulls to promising actions, while ε-greedy wastes exploration uniformly on clearly bad actions" },
                    { id: "rl-qlearning-q6-c", text: "Softmax has a lower computational cost per step" },
                    { id: "rl-qlearning-q6-d", text: "Softmax does not need a Q-table" },
                  ],
                  correctOptionId: "rl-qlearning-q6-b",
                  explanation:
                    "When Q(buy) ≈ Q(sell), ε-greedy still wastes ε/3 of exploration on 'hold' (clearly suboptimal). Softmax assigns π(a) ∝ exp(Q(a)/τ), concentrating exploration on the two competitive actions. With τ → 0, softmax → greedy; with τ → ∞, softmax → uniform. This proportional exploration resolves ties efficiently and reduces cumulative regret.",
                },
              ],
            },
            {
              type: "practice",
              title: "Guided: SARSA vs Q-Learning Trading Duel with Regime Analysis",
              description:
                "Implement both SARSA and Q-learning on the DiscreteTradingEnv with the provided 3-regime returns data. Follow these steps:\n\n1. Run both algorithms for 1000 episodes each with α=0.1, γ=0.95, ε: 1.0→0.01 (decay=0.995).\n2. For each of three transaction cost levels (0, 0.001, 0.005), compare: (a) final 100-episode average reward, (b) percentage of states where π*(s) = hold, (c) equity curve over the last episode.\n3. Create a 'policy difference map': for each state, compare Q-learning's policy vs SARSA's policy. Count disagreements.\n4. Hypothesis: with tx_cost=0.005, SARSA should have ≥20% more 'hold' states than Q-learning. Verify this.\n\nExpected insight: Q-learning learns the theoretically optimal but fragile policy. SARSA learns a robust policy that accounts for exploration noise — in trading, this translates to fewer but higher-conviction trades.",
              catalogModelId: "q-learning-sarsa",
            },
            {
              type: "practice",
              title: "Open-Ended: Adaptive Learning Rate Schedule for Non-Stationary Markets",
              description:
                "Financial markets are non-stationary — the true Q* changes over time as regimes shift. Design an experiment to compare three learning rate strategies for Q-learning on a non-stationary forex environment:\n\n(a) Fixed α = 0.1 (tracks recent data, never converges)\n(b) Decaying α = 1/N(s,a)^0.7 (Robbins-Monro compliant, converges but can't adapt)\n(c) Your own adaptive schedule (e.g., α increases when TD error spikes, indicating regime change)\n\nGenerate a 10,000-bar return series with 5 regime changes (trending → volatile → ranging → trending → bear). Train Q-learning with each schedule. Evaluate: (1) cumulative reward, (2) speed of policy adaptation after each regime change, (3) policy stability within regimes. Which schedule best balances convergence within regimes and adaptation between regimes?",
              catalogModelId: "q-learning-sarsa",
            },
          ],
        },
        // ── Lesson 3: Multi-Armed Bandits ───────────────────────
        {
          id: "rl-multi-armed-bandits",
          title: "Multi-Armed Bandits for Strategy Selection",
          description:
            "Master the exploration-exploitation tradeoff using epsilon-greedy, UCB1, and Thompson Sampling — then apply bandits to dynamically allocate capital among competing forex trading strategies.",
          estimatedMinutes: 45,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Understand the multi-armed bandit framework, derive regret bounds for ε-greedy and UCB1, implement Thompson Sampling with Beta and Gaussian posteriors, extend to contextual bandits, and apply bandit-based strategy selection to dynamically allocate capital among competing forex strategies.",
              keyTakeaways: [
                "Multi-armed bandits formalise the explore-exploit tradeoff: no state transitions, just arms and stochastic rewards",
                "Regret R_T = T·μ* − ∑μ(aₜ) measures total cost of suboptimal pulls; goal is sublinear regret R_T = o(T)",
                "ε-greedy with fixed ε has linear regret O(εT); decaying ε ~ 1/t yields sublinear but not optimal",
                "UCB1 selects argmaxₐ [Q̂(a) + c√(ln t / Nₐ)] — derived from Hoeffding's inequality, achieves O(K ln T) regret",
                "Thompson Sampling draws θₐ ~ Posterior(a) and plays argmaxₐ θₐ — often achieves the Lai-Robbins lower bound",
                "For Bernoulli arms, the posterior is Beta(αₐ, βₐ); for Gaussian arms, it is 𝒩(μ̂ₐ, σ̂²ₐ/Nₐ)",
                "Contextual bandits observe features xₜ before selecting arms, learning π(a|x) — bridges bandits and full RL",
                "Forex application: dynamically allocate capital among momentum, mean-reversion, breakout, carry, and volatility strategies",
              ],
            },
            {
              type: "theory",
              title: "The Bandit Framework: Regret Definition and Bounds",
              content:
                "**Formal Definition.** A K-armed bandit is a tuple (K, {ν₁, …, νₖ}) where K is the number of arms and νₖ is the reward distribution of arm k with mean μₖ = 𝔼[νₖ]. At each round t = 1, …, T, the agent selects arm aₜ ∈ {1, …, K} and observes reward rₜ ~ ν(aₜ). Let μ* = maxₖ μₖ and Δₖ = μ* − μₖ be the 'gap' of arm k.\n\n**Cumulative Regret.** R_T = ∑ᵀₜ₌₁ (μ* − μ(aₜ)) = ∑ₖ Δₖ · 𝔼[Nₖ(T)], where Nₖ(T) is the number of times arm k is pulled in T rounds. Minimising regret means pulling suboptimal arms as few times as possible while still identifying the best arm.\n\n**Information-Theoretic Lower Bound (Lai-Robbins, 1985).** For any consistent policy: lim inf R_T / ln T ≥ ∑ₖ:Δₖ>0 Δₖ / KL(νₖ ‖ ν*), where KL is the Kullback-Leibler divergence between arm k's distribution and the best arm's distribution. For Gaussian arms with unit variance, this simplifies to R_T ≥ ∑ₖ 2 ln T / Δₖ. This means no algorithm can achieve regret better than O(∑ ln T / Δₖ) — logarithmic in T.\n\n**ε-Greedy Regret Analysis.** With fixed ε, the algorithm pulls a suboptimal arm with probability at least ε/K per round. Expected regret: R_T ≥ (ε/K) · ∑ₖ Δₖ · T = Θ(εT) — linear in T. With decaying ε_t = min(1, cK/t) for appropriate c, regret becomes O(K² ln T / Δ_min), which is sublinear but suboptimal by a factor of K/Δ_min compared to the Lai-Robbins bound.\n\n**Numerical Example.** Consider K=3 arms (momentum, mean-reversion, breakout) with daily Sharpe ratios μ = (0.8, 1.2, 0.5) and identical volatilities σ = 0.15. Gaps: Δ₁ = 0.4, Δ₃ = 0.7. After T = 1000 rounds with ε = 0.1: expected pulls on arm 1 ≈ 33 (random) + some exploits, expected regret from ε-greedy ≈ 0.1 × 1000 × (0.4 + 0 + 0.7)/3 ≈ 37. The Lai-Robbins lower bound gives ln(1000) × (0.4/KL₁ + 0.7/KL₃) — much lower, indicating ε-greedy is far from optimal.",
            },
            {
              type: "theory",
              title: "UCB1 Derivation from Hoeffding's Inequality",
              content:
                "**Hoeffding's Inequality.** For i.i.d. random variables X₁, …, Xₙ ∈ [0,1] with mean μ: P(|X̄ₙ − μ| ≥ ε) ≤ 2 exp(−2nε²). Setting the right side to δ and solving for ε: with probability ≥ 1−δ, μ ∈ [X̄ₙ − √(ln(2/δ)/(2n)), X̄ₙ + √(ln(2/δ)/(2n))].\n\n**UCB1 Derivation.** We want an upper confidence bound Ûₖ(t) such that μₖ ≤ Ûₖ(t) with high probability. Set δ = 2/t² (ensures ∑ₜ δ < ∞ by Borel-Cantelli). Then: Ûₖ(t) = Q̂ₖ + √(ln t / Nₖ(t)). The 'optimism in the face of uncertainty' principle: play argmaxₖ Ûₖ(t). If an arm has been under-explored (small Nₖ), its confidence width √(ln t/Nₖ) is large, so it gets selected. As Nₖ grows, the width shrinks and the arm is selected only if Q̂ₖ is competitive.\n\n**UCB1 Regret Bound (Auer et al., 2002).** R_T ≤ ∑ₖ:Δₖ>0 (8 ln T / Δₖ + (1 + π²/3) Δₖ). The dominant term 8 ln T / Δₖ matches the Lai-Robbins bound up to a constant factor. Arms with larger gaps Δₖ are explored less (they are identified as suboptimal quickly) but contribute more per suboptimal pull — the bound balances these effects.\n\n**Numerical Walkthrough.** T=1, N=(0,0,0): all arms unpulled, play arm 1. r₁=0.7. T=2, N=(1,0,0): arm 2 unpulled, play arm 2. r₂=1.3. T=3, N=(1,1,0): arm 3 unpulled, play arm 3. r₃=0.4. T=4, N=(1,1,1): UCB scores = [0.7+√(ln4/1), 1.3+√(ln4/1), 0.4+√(ln4/1)] = [0.7+1.18, 1.3+1.18, 0.4+1.18] = [1.88, 2.48, 1.58]. Play arm 2 (highest UCB). T=5 after r₄=1.1: N=(1,2,1), UCB₂ = (1.3+1.1)/2 + √(ln5/2) = 1.2 + 0.90 = 2.10. UCB₁ = 0.7 + √(ln5/1) = 0.7 + 1.27 = 1.97. UCB₃ = 0.4 + √(ln5/1) = 0.4 + 1.27 = 1.67. Still arm 2. The exploration bonus for arm 2 shrinks because it has been pulled more, but its high Q̂ keeps it competitive.\n\n**Limitations.** UCB1 assumes stationary rewards — problematic for trading where strategy performance drifts with market regimes. Variants: Discounted UCB (down-weights old observations), Sliding-Window UCB (uses only last W observations), and UCB with change detection (resets when drift is detected).",
            },
            {
              type: "theory",
              title: "Thompson Sampling: Bayesian Posterior Updates and Contextual Extension",
              content:
                "**Thompson Sampling (TS)** maintains a Bayesian posterior P(θₖ | data) over each arm's reward parameter and uses probability matching: sample θₖ ~ Posterior(k) for each arm, play argmaxₖ θₖ. The intuition: arms with high uncertainty have wide posteriors, so their samples are sometimes very high — ensuring exploration. As data accumulates, posteriors narrow around the true μₖ, and the best arm's samples consistently dominate — ensuring exploitation.\n\n**Beta-Bernoulli Model.** For binary rewards (win/loss): Prior: θₖ ~ Beta(α₀, β₀), typically uniform Beta(1,1). Update: after observing reward r ∈ {0,1}: αₖ ← αₖ + r, βₖ ← βₖ + (1−r). Posterior mean: 𝔼[θₖ] = αₖ/(αₖ+βₖ). Example: arm 1 has record (5 wins, 3 losses): θ₁ ~ Beta(6,4), mean = 0.6. Arm 2 has (2 wins, 1 loss): θ₂ ~ Beta(3,2), mean = 0.6. Despite identical means, arm 2's posterior is wider (less data), so TS explores it more — exactly the right behavior.\n\n**Gaussian Model.** For continuous rewards r ~ 𝒩(μₖ, σ²): With known σ² and prior μₖ ~ 𝒩(μ₀, σ₀²): Posterior after Nₖ observations with mean r̄ₖ: μₖ | data ~ 𝒩(μ̂ₖ, σ̂²ₖ), where μ̂ₖ = (σ₀⁻²μ₀ + Nₖσ⁻²r̄ₖ)/(σ₀⁻² + Nₖσ⁻²), σ̂²ₖ = 1/(σ₀⁻² + Nₖσ⁻²). As Nₖ → ∞, μ̂ₖ → r̄ₖ and σ̂²ₖ → σ²/Nₖ. For forex strategies with daily returns, σ² can be estimated from historical data or set conservatively.\n\n**Contextual Bandits.** At round t, observe context xₜ ∈ ℝᵈ (e.g., market features: volatility, trend strength, correlation). The reward model becomes rₖ = f(xₜ, k) + noise. **LinUCB** (Li et al., 2010): assume rₖ = xₜᵀθₖ + ε, maintain ridge regression estimate θ̂ₖ and confidence ellipsoid. Select argmaxₖ [xₜᵀθ̂ₖ + α√(xₜᵀAₖ⁻¹xₜ)]. **Contextual Thompson Sampling**: sample θₖ ~ 𝒩(θ̂ₖ, Aₖ⁻¹σ²) and play argmaxₖ xₜᵀθₖ. Forex application: context = (ATR, RSI, trend slope, correlation matrix), arms = strategies. The agent learns which strategy works best under which market conditions — a regime-dependent allocation.",
            },
            {
              type: "intuition",
              title: "The Restaurant Exploration Problem",
              analogy:
                "You live in a city with 5 restaurants. Your favorite scores 8/10 on average. Do you go there every night (exploit) or try the new place that might be a 9 or a 3 (explore)? Epsilon-greedy flips a coin — 10% of nights you try somewhere random, even the place you rated 2/10 last time. UCB1 is smarter: it picks the restaurant with the highest 'optimistic estimate.' If you have only been to a place once and it was a 7, the uncertainty bonus boosts it to 'maybe a 9!' — worth revisiting. If you have been 50 times and it averages 7.2, the bonus is tiny and it competes on merit alone. Thompson Sampling is the most creative: for each restaurant, you imagine a plausible rating based on your experience (mentally sampling from a bell curve). You go wherever looks best in this mental simulation. Restaurants with few visits have wider bell curves — sometimes their imagined rating exceeds the favorite — so they get occasional visits naturally.",
              content:
                "In trading, the restaurants are strategies (momentum, mean-reversion, breakout, carry, volatility selling) and the ratings are rolling Sharpe ratios. Regret is the cumulative opportunity cost of not always using the best strategy. With T = 2000 trading days and K = 5 strategies, UCB1 guarantees regret ≤ O(5 × ln 2000 / Δ_min) ≈ 190/Δ_min, while ε-greedy with ε = 0.1 gives regret ≈ 0.1 × 2000 × avg_gap. For gaps Δ ≈ 0.3 Sharpe points, UCB1 wastes about 633 Sharpe-days vs ε-greedy's 200 — but UCB1's bound tightens as T grows while ε-greedy's grows linearly forever.",
              emoji: "🍽️",
            },
            {
              type: "intuition",
              title: "Thompson Sampling as Simulated Future Regret Minimisation",
              analogy:
                "Imagine you are a portfolio manager deciding how to allocate across 5 forex strategies each morning. Thompson Sampling works like this: for each strategy, you mentally simulate 'what if this strategy's true Sharpe ratio was [sample from your posterior belief]?' If a strategy you have barely tested happens to simulate as the best, you allocate to it today — gathering real data to update your beliefs. If a well-tested strategy consistently simulates as the best, you allocate there. The magic is that the frequency of exploration naturally matches your uncertainty: a strategy tested for 500 days has a narrow posterior (samples are close to the mean), while one tested for 5 days has a wide posterior (samples vary wildly). The rare high samples for uncertain strategies drive just enough exploration — no ε parameter to tune.",
              content:
                "Thompson Sampling's theoretical regret matches the Lai-Robbins lower bound for many problem classes — it is asymptotically optimal. In practice, it consistently outperforms UCB1 and ε-greedy across diverse reward distributions. For trading, the Gaussian variant 𝒩(μ̂ₖ, σ̂²/Nₖ) is most natural: Sharpe ratio estimates follow approximately normal distributions by the CLT. The shrinking variance σ̂²/Nₖ means the algorithm naturally transitions from 'wide exploration' (early, low Nₖ) to 'tight exploitation' (late, high Nₖ) without any schedule parameters. The only choice is the prior — a weakly informative 𝒩(0, 1) works well for Sharpe ratios.",
              emoji: "🎰",
            },
            {
              type: "code",
              title: "Complete Bandit Suite: ε-Greedy, UCB1, and Thompson Sampling",
              language: "python",
              code: `import numpy as np

class ForexStrategyBandit:
    """K-armed bandit simulating forex strategy selection.
    Each arm represents a trading strategy with true Sharpe ratio.
    Rewards are daily returns: r ~ N(sharpe * vol / sqrt(252), vol / sqrt(252))
    """
    def __init__(self):
        self.K = 5
        self.names = ["Momentum", "MeanRev", "Breakout", "Carry", "VolSell"]
        self.true_sharpes = np.array([0.80, 1.20, 0.50, 1.00, 0.30])
        self.volatilities = np.array([0.15, 0.20, 0.10, 0.18, 0.12])
        self.daily_means = self.true_sharpes * self.volatilities / np.sqrt(252)
        self.daily_stds = self.volatilities / np.sqrt(252)

    def pull(self, arm: int) -> float:
        return np.random.normal(self.daily_means[arm], self.daily_stds[arm])

def run_epsilon_greedy(bandit, T, epsilon=0.1):
    Q, N = np.zeros(bandit.K), np.zeros(bandit.K)
    selections = np.zeros(T, dtype=int)
    rewards = np.zeros(T)
    for t in range(T):
        if np.random.random() < epsilon or np.any(N == 0):
            a = np.argmin(N) if np.any(N == 0) else np.random.randint(bandit.K)
        else:
            a = int(np.argmax(Q))
        r = bandit.pull(a)
        N[a] += 1; Q[a] += (r - Q[a]) / N[a]
        selections[t], rewards[t] = a, r
    return Q, N, selections, rewards

def run_ucb1(bandit, T, c=2.0):
    Q, N = np.zeros(bandit.K), np.zeros(bandit.K)
    selections = np.zeros(T, dtype=int)
    rewards = np.zeros(T)
    for t in range(T):
        if np.any(N == 0):
            a = int(np.argmin(N))
        else:
            ucb = Q + c * np.sqrt(np.log(t + 1) / N)
            a = int(np.argmax(ucb))
        r = bandit.pull(a)
        N[a] += 1; Q[a] += (r - Q[a]) / N[a]
        selections[t], rewards[t] = a, r
    return Q, N, selections, rewards

def run_thompson_gaussian(bandit, T, prior_mu=0.0, prior_var=1.0):
    """Thompson Sampling with Gaussian posterior N(mu_hat, sigma^2/N)."""
    Q, N = np.zeros(bandit.K), np.zeros(bandit.K)
    sum_sq = np.zeros(bandit.K)  # for estimating variance
    selections = np.zeros(T, dtype=int)
    rewards = np.zeros(T)
    for t in range(T):
        # Sample from posterior for each arm
        samples = np.zeros(bandit.K)
        for k in range(bandit.K):
            if N[k] == 0:
                samples[k] = np.random.normal(prior_mu, np.sqrt(prior_var))
            else:
                post_var = 1.0 / (1.0/prior_var + N[k]/0.0002)  # known noise ~0.01^2
                post_mu = post_var * (prior_mu/prior_var + N[k]*Q[k]/0.0002)
                samples[k] = np.random.normal(post_mu, np.sqrt(post_var))
        a = int(np.argmax(samples))
        r = bandit.pull(a)
        N[a] += 1; Q[a] += (r - Q[a]) / N[a]
        selections[t], rewards[t] = a, r
    return Q, N, selections, rewards

# ── Run all three algorithms ─────────────────────────────────
np.random.seed(42)
bandit = ForexStrategyBandit()
T = 5000
best_arm = int(np.argmax(bandit.true_sharpes))

print("FOREX STRATEGY BANDIT — 3-ALGORITHM COMPARISON")
print(f"Best strategy: {bandit.names[best_arm]} (Sharpe={bandit.true_sharpes[best_arm]})")
print(f"Horizon: T={T} trading days")
print("=" * 70)

for name, runner in [
    ("ε-Greedy (ε=0.1)", lambda: run_epsilon_greedy(bandit, T, 0.1)),
    ("UCB1 (c=2.0)", lambda: run_ucb1(bandit, T, 2.0)),
    ("Thompson (Gaussian)", lambda: run_thompson_gaussian(bandit, T)),
]:
    np.random.seed(42)
    Q, N, sel, rew = runner()
    regret = np.cumsum(bandit.daily_means[best_arm] - bandit.daily_means[sel])
    best_pct = np.mean(sel == best_arm) * 100

    print(f"\\n{name}:")
    print(f"  Pull distribution: ", end="")
    for k in range(bandit.K):
        print(f"{bandit.names[k]}={int(N[k]):4d}  ", end="")
    print(f"\\n  Best arm %: {best_pct:.1f}%")
    print(f"  Cumulative regret: {regret[-1]:.4f}")
    print(f"  Avg daily reward: {rew.mean():+.6f}")
    print(f"  Last 1000 best arm %: {np.mean(sel[-1000:]==best_arm)*100:.1f}%")`,
              explanation:
                "Three bandit algorithms compared on a 5-strategy forex allocation problem over 5000 trading days. ε-Greedy explores uniformly at random (wasting pulls on clearly bad strategies). UCB1 directs exploration via the confidence bonus √(ln t/Nₐ) — under-explored strategies get priority. Thompson Sampling samples from Gaussian posteriors 𝒩(μ̂, σ²/N) and plays the arm with the highest sample — naturally balancing exploration (wide posteriors for untested strategies) and exploitation (narrow posteriors for well-tested ones). The comparison reveals Thompson Sampling typically achieves the lowest cumulative regret.",
            },
            {
              type: "code",
              title: "Thompson Sampling with Beta Posteriors and Posterior Visualisation",
              language: "python",
              code: `import numpy as np

class BernoulliStrategyBandit:
    """Binary outcome bandit: each strategy either wins or loses each day.
    P(win) corresponds to strategy's win rate.
    """
    def __init__(self):
        self.K = 4
        self.names = ["Momentum", "MeanRev", "Breakout", "Carry"]
        self.true_win_rates = np.array([0.52, 0.58, 0.48, 0.55])

    def pull(self, arm: int) -> int:
        return int(np.random.random() < self.true_win_rates[arm])

def thompson_beta(bandit, T=3000, snapshot_times=None):
    """Thompson Sampling with Beta(alpha, beta) posteriors for Bernoulli arms."""
    if snapshot_times is None:
        snapshot_times = [10, 50, 200, 1000, 3000]
    alphas = np.ones(bandit.K)  # Beta(1,1) = uniform prior
    betas = np.ones(bandit.K)
    selections = np.zeros(T, dtype=int)
    rewards = np.zeros(T, dtype=int)
    snapshots = {}

    for t in range(T):
        # Sample theta_k ~ Beta(alpha_k, beta_k) for each arm
        theta_samples = np.array([
            np.random.beta(alphas[k], betas[k]) for k in range(bandit.K)
        ])
        a = int(np.argmax(theta_samples))
        r = bandit.pull(a)

        # Bayesian update: Beta(a,b) + Bernoulli(r) -> Beta(a+r, b+1-r)
        alphas[a] += r
        betas[a] += 1 - r
        selections[t], rewards[t] = a, r

        # Save posterior snapshots
        if (t + 1) in snapshot_times:
            snapshots[t + 1] = {
                "alphas": alphas.copy(), "betas": betas.copy(),
                "means": alphas / (alphas + betas),
                "stds": np.sqrt(alphas*betas / ((alphas+betas)**2 * (alphas+betas+1)))
            }

    return alphas, betas, selections, rewards, snapshots

# ── Run and analyse posterior evolution ──────────────────────
np.random.seed(42)
bandit = BernoulliStrategyBandit()
print("THOMPSON SAMPLING WITH BETA POSTERIORS")
print(f"True win rates: {dict(zip(bandit.names, bandit.true_win_rates))}")
print("=" * 70)

alphas, betas, sel, rew, snaps = thompson_beta(bandit, T=3000)

for t in sorted(snaps.keys()):
    snap = snaps[t]
    print(f"\\nAfter t={t} rounds:")
    print(f"  {'Strategy':>10s} | {'α':>5s} | {'β':>5s} | {'Post.Mean':>9s} | {'Post.Std':>8s} | {'Pulls':>5s}")
    print(f"  {'-'*55}")
    for k in range(bandit.K):
        pulls = int(snap['alphas'][k] + snap['betas'][k] - 2)
        print(f"  {bandit.names[k]:>10s} | {snap['alphas'][k]:5.0f} | {snap['betas'][k]:5.0f} | "
              f"{snap['means'][k]:9.4f} | {snap['stds'][k]:8.4f} | {pulls:5d}")

# Final allocation analysis
total = len(sel)
print(f"\\nFinal Allocation Summary ({total} rounds):")
for k in range(bandit.K):
    count = int(np.sum(sel == k))
    pct = count / total * 100
    win_r = np.sum(rew[sel == k]) / max(count, 1)
    print(f"  {bandit.names[k]:>10s}: {count:4d} pulls ({pct:5.1f}%) | observed win rate: {win_r:.3f}")

best = int(np.argmax(bandit.true_win_rates))
cum_regret = np.cumsum(bandit.true_win_rates[best] - bandit.true_win_rates[sel])
print(f"\\nCumulative regret: {cum_regret[-1]:.2f}")
print(f"Best arm concentration (last 500): {np.mean(sel[-500:]==best)*100:.1f}%")`,
              explanation:
                "Thompson Sampling with Beta posteriors for Bernoulli (win/loss) strategy outcomes. The Beta(α,β) posterior starts uniform (α=β=1) and updates via Bayes' rule: α += reward, β += (1−reward). The posterior snapshots show how uncertainty narrows over time: at t=10, posteriors are wide (high std) and exploration dominates; at t=3000, posteriors are tight and the best arm is pulled almost exclusively. The output reveals the elegant self-tuning property: no ε or c parameter — exploration naturally decreases as posteriors narrow.",
            },
            {
              type: "code",
              title: "Contextual Bandit: Regime-Dependent Strategy Allocation",
              language: "python",
              code: `import numpy as np

class ContextualForexBandit:
    """Contextual bandit: strategy performance depends on market regime.
    Context x = [volatility, trend_strength] determines which strategy is best.
    """
    def __init__(self):
        self.K = 3
        self.names = ["Momentum", "MeanRev", "Breakout"]
        self.d = 2  # context dimension: [volatility, trend_strength]

        # True linear reward coefficients: r_k = x^T theta_k + noise
        # Momentum works in trending, low-vol markets
        self.true_theta = np.array([
            [-0.5, +1.5],   # Momentum: loves trend, hates vol
            [+0.3, -1.0],   # MeanRev: slightly likes vol, hates trend
            [+1.2, +0.2],   # Breakout: loves vol, slight trend bias
        ])
        self.noise_std = 0.3

    def get_context(self) -> np.ndarray:
        """Sample a random market context."""
        vol = np.random.uniform(0.0, 1.0)
        trend = np.random.uniform(-1.0, 1.0)
        return np.array([vol, trend])

    def pull(self, arm: int, context: np.ndarray) -> float:
        return context @ self.true_theta[arm] + np.random.normal(0, self.noise_std)

def linucb(bandit, T=3000, alpha=1.0):
    """LinUCB: contextual bandit with linear reward model.
    For each arm k: A_k = I + sum(x x^T), b_k = sum(r * x)
    theta_hat_k = A_k^{-1} b_k
    UCB_k = x^T theta_hat_k + alpha * sqrt(x^T A_k^{-1} x)
    """
    d = bandit.d
    # Initialise per-arm matrices
    A = [np.eye(d) for _ in range(bandit.K)]       # d×d
    b = [np.zeros(d) for _ in range(bandit.K)]       # d
    theta_hat = [np.zeros(d) for _ in range(bandit.K)]

    selections = np.zeros(T, dtype=int)
    rewards = np.zeros(T)
    contexts = np.zeros((T, d))

    for t in range(T):
        x = bandit.get_context()
        contexts[t] = x

        # Compute UCB for each arm
        ucb_scores = np.zeros(bandit.K)
        for k in range(bandit.K):
            theta_hat[k] = np.linalg.solve(A[k], b[k])
            pred = x @ theta_hat[k]
            width = alpha * np.sqrt(x @ np.linalg.solve(A[k], x))
            ucb_scores[k] = pred + width

        a = int(np.argmax(ucb_scores))
        r = bandit.pull(a, x)

        # Update arm a's statistics
        A[a] += np.outer(x, x)
        b[a] += r * x
        selections[t], rewards[t] = a, r

    return theta_hat, selections, rewards, contexts

# ── Run LinUCB ───────────────────────────────────────────────
np.random.seed(42)
bandit = ContextualForexBandit()
print("CONTEXTUAL BANDIT — REGIME-DEPENDENT STRATEGY ALLOCATION")
print("=" * 65)
print("True coefficients (r = x^T theta + noise):")
print(f"  Context features: [volatility, trend_strength]")
for k in range(bandit.K):
    print(f"  {bandit.names[k]:>10s}: theta = {bandit.true_theta[k]}")

theta_hat, sel, rew, ctx = linucb(bandit, T=3000, alpha=1.0)

print(f"\\nLearned coefficients after T=3000:")
for k in range(bandit.K):
    err = np.linalg.norm(theta_hat[k] - bandit.true_theta[k])
    print(f"  {bandit.names[k]:>10s}: theta_hat = [{theta_hat[k][0]:+.3f}, {theta_hat[k][1]:+.3f}]"
          f"  (error: {err:.3f})")

# Analyse regime-dependent selection
print(f"\\nSelection by regime:")
high_vol = ctx[:, 0] > 0.7  # high volatility
trending = ctx[:, 1] > 0.5  # strong trend
for regime, mask, name in [
    (high_vol, high_vol, "High Vol"),
    (trending, trending, "Trending"),
    (~high_vol & ~trending, ~high_vol & ~trending, "Low Vol, No Trend"),
]:
    if mask.sum() == 0: continue
    print(f"  {name} ({mask.sum()} rounds):")
    for k in range(bandit.K):
        pct = np.mean(sel[mask] == k) * 100
        if pct > 5: print(f"    {bandit.names[k]:>10s}: {pct:.1f}%")

oracle_rewards = np.array([ctx[t] @ bandit.true_theta[np.argmax([ctx[t] @ bandit.true_theta[k]
    for k in range(bandit.K)])] for t in range(len(ctx))])
print(f"\\nAvg reward — LinUCB: {rew.mean():.4f}, Oracle: {oracle_rewards.mean():.4f}")
print(f"Fraction of oracle: {rew.mean() / oracle_rewards.mean() * 100:.1f}%")`,
              explanation:
                "LinUCB extends bandits with context — here, market features (volatility, trend strength) determine which strategy is best. Each arm k has a linear model rₖ = xᵀθₖ + noise. LinUCB maintains ridge regression estimates θ̂ₖ and selects argmaxₖ[xᵀθ̂ₖ + α√(xᵀAₖ⁻¹x)]. The confidence width √(xᵀAₖ⁻¹x) is larger in unexplored context regions. The output shows learned coefficients converging to the true values and regime-dependent allocation: momentum in trending markets, breakout in high-volatility markets, mean-reversion elsewhere.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-mab-q1",
                  question: "What is cumulative regret and why is sublinear regret R_T = o(T) the goal?",
                  options: [
                    { id: "rl-mab-q1-a", text: "Regret is the loss function for training; sublinear means the model converges" },
                    { id: "rl-mab-q1-b", text: "R_T = T·μ* − ∑μ(aₜ) is the total opportunity cost of not always playing the best arm; sublinear means the per-round regret R_T/T → 0, so the algorithm asymptotically matches the best arm" },
                    { id: "rl-mab-q1-c", text: "Regret measures training time; sublinear means faster convergence" },
                    { id: "rl-mab-q1-d", text: "Regret counts the number of wrong predictions; sublinear means the error rate decreases" },
                  ],
                  correctOptionId: "rl-mab-q1-b",
                  explanation:
                    "Cumulative regret R_T sums the gap between the best arm's mean and each selected arm's mean over T rounds. R_T = o(T) (sublinear) means R_T/T → 0: the agent's per-round performance converges to the best arm's performance. Linear regret R_T = Θ(T) means a constant fraction of rounds are wasted on suboptimal arms forever.",
                },
                {
                  id: "rl-mab-q2",
                  question: "In the UCB1 formula argmaxₐ[Q̂(a) + c√(ln t / Nₐ)], what happens to the exploration bonus as Nₐ increases?",
                  options: [
                    { id: "rl-mab-q2-a", text: "It increases, encouraging more exploration of popular arms" },
                    { id: "rl-mab-q2-b", text: "It decreases as √(ln t/Nₐ) — more pulls reduce uncertainty, so the arm must compete on its empirical mean Q̂(a)" },
                    { id: "rl-mab-q2-c", text: "It stays constant regardless of pull count" },
                    { id: "rl-mab-q2-d", text: "It oscillates based on the reward variance" },
                  ],
                  correctOptionId: "rl-mab-q2-b",
                  explanation:
                    "The bonus √(ln t/Nₐ) shrinks as Nₐ grows (denominator increases). An arm pulled 1000 times has bonus √(ln t/1000) — tiny. An arm pulled 3 times has √(ln t/3) — large. This self-adjusting property ensures under-explored arms get priority while well-characterised arms compete on empirical merit.",
                },
                {
                  id: "rl-mab-q3",
                  question: "For a Bernoulli bandit arm with 7 wins and 3 losses, what is the Beta posterior and its mean?",
                  options: [
                    { id: "rl-mab-q3-a", text: "Beta(7, 3) with mean 0.70" },
                    { id: "rl-mab-q3-b", text: "Beta(8, 4) with mean 8/12 = 0.667 (using uniform Beta(1,1) prior)" },
                    { id: "rl-mab-q3-c", text: "Normal(0.7, 0.1) with mean 0.70" },
                    { id: "rl-mab-q3-d", text: "Beta(3.5, 1.5) with mean 0.70" },
                  ],
                  correctOptionId: "rl-mab-q3-b",
                  explanation:
                    "Starting from uniform prior Beta(1,1), after 7 wins and 3 losses: α = 1 + 7 = 8, β = 1 + 3 = 4. Posterior mean = α/(α+β) = 8/12 = 0.667. The posterior mean is 'pulled' from the observed rate 7/10 = 0.70 toward the prior mean 0.5 — a Bayesian regularisation effect that diminishes with more data.",
                },
                {
                  id: "rl-mab-q4",
                  question: "Why does Thompson Sampling not require tuning an exploration parameter like ε or c?",
                  options: [
                    { id: "rl-mab-q4-a", text: "It uses a fixed exploration rate of 50%" },
                    { id: "rl-mab-q4-b", text: "Exploration is driven by posterior width: arms with few observations have wide posteriors, generating high samples occasionally; as data accumulates, posteriors narrow and exploration naturally decreases" },
                    { id: "rl-mab-q4-c", text: "Thompson Sampling does not explore at all" },
                    { id: "rl-mab-q4-d", text: "The prior hyperparameters serve the same role as ε" },
                  ],
                  correctOptionId: "rl-mab-q4-b",
                  explanation:
                    "Thompson Sampling's exploration is implicit in the posterior sampling process. An arm with 3 observations has a wide posterior — its samples sometimes exceed the best-estimated arm, triggering exploration. An arm with 1000 observations has a narrow posterior — it is only selected if its mean is genuinely competitive. This 'probability matching' naturally balances explore-exploit without any tunable parameter.",
                },
                {
                  id: "rl-mab-q5",
                  question: "When should you use contextual bandits instead of standard bandits for forex strategy selection?",
                  options: [
                    { id: "rl-mab-q5-a", text: "When you have more than 10 strategies to choose from" },
                    { id: "rl-mab-q5-b", text: "When strategy performance depends on observable market features (regime, volatility, trend) — the optimal arm changes with context" },
                    { id: "rl-mab-q5-c", text: "When rewards are continuous rather than binary" },
                    { id: "rl-mab-q5-d", text: "When the number of trading days T is very large" },
                  ],
                  correctOptionId: "rl-mab-q5-b",
                  explanation:
                    "Standard bandits assume stationarity — the same arm is best regardless of conditions. If momentum works in trending markets but mean-reversion works in ranging markets, a standard bandit averages over all conditions and may never find the 'overall best.' Contextual bandits observe features xₜ (ATR, RSI, trend slope) and learn arm-specific models rₖ = f(xₜ, k), adapting the allocation to current market conditions.",
                },
                {
                  id: "rl-mab-q6",
                  question: "With K=5 arms and T=10000 rounds, what is UCB1's theoretical regret bound, and how does it compare to ε-greedy with ε=0.05?",
                  options: [
                    { id: "rl-mab-q6-a", text: "UCB1: O(5 × ln 10000 / Δ_min) = O(46/Δ_min); ε-greedy: O(0.05 × 10000) = O(500). UCB1 is better for Δ_min > 0.09" },
                    { id: "rl-mab-q6-b", text: "Both achieve O(ln T) regret" },
                    { id: "rl-mab-q6-c", text: "ε-greedy always outperforms UCB1" },
                    { id: "rl-mab-q6-d", text: "The regret bounds are identical" },
                  ],
                  correctOptionId: "rl-mab-q6-a",
                  explanation:
                    "UCB1 regret ≤ ∑ₖ 8 ln T / Δₖ + const. For K=5, T=10000: 8×ln(10000)×5/Δ_min ≈ 368/Δ_min. ε-greedy: ε×T×avg_gap ≈ 0.05×10000×Δ_avg = 500×Δ_avg. For reasonable gaps (Δ ~ 0.3-0.5), UCB1's logarithmic growth dominates ε-greedy's linear growth as T increases. The crossover depends on gap sizes — UCB1 excels when suboptimal arms are clearly distinguishable.",
                },
              ],
            },
            {
              type: "practice",
              title: "Guided: Thompson Sampling Capital Allocator with Rolling Performance",
              description:
                "Implement Thompson Sampling with Gaussian posteriors for allocating capital among 3 forex strategies. Follow these steps:\n\n1. Create a GaussianThompsonSampler class that maintains 𝒩(μ̂ₖ, σ̂²ₖ/Nₖ) posteriors for each arm.\n2. Simulate 5000 daily returns for 3 strategies: Momentum (Sharpe=1.0, vol=0.15), MeanRev (Sharpe=0.6, vol=0.10), Breakout (Sharpe=0.8, vol=0.20).\n3. Run Thompson Sampling and track: (a) cumulative regret vs ε-greedy and UCB1, (b) posterior mean and std evolution over time (snapshot at t=10, 100, 500, 2000, 5000), (c) allocation percentages per 500-round window.\n4. Add a regime change at t=2500: MeanRev becomes the best (Sharpe jumps to 1.5). Compare how quickly each algorithm adapts.\n5. Plot or print: posterior evolution showing narrowing uncertainty, allocation shift after regime change, cumulative regret before and after the switch.\n\nExpected insight: Thompson Sampling adapts faster than UCB1 after regime changes because its posterior naturally widens when observations conflict with the current mean.",
              catalogModelId: "q-learning-sarsa",
            },
            {
              type: "practice",
              title: "Open-Ended: Non-Stationary Bandits with Sliding Window UCB",
              description:
                "Financial markets are non-stationary — the best strategy changes over time as regimes shift. Standard UCB1 and Thompson Sampling assume stationarity and converge to a single arm, failing to adapt.\n\nDesign and implement two non-stationary bandit algorithms:\n(a) Sliding-Window UCB: only use the last W observations per arm for Q̂ and N. Explore the tradeoff: small W → fast adaptation but noisy estimates; large W → stable estimates but slow adaptation.\n(b) Discounted Thompson Sampling: weight recent observations more via exponential discounting of sufficient statistics.\n\nTest on a 10,000-round simulation with 4 regime changes (the best arm rotates every 2000 rounds among 4 strategies). Compare: (1) cumulative regret vs standard UCB1 and ε-greedy, (2) adaptation speed (rounds to >80% allocation to new best arm), (3) Sharpe ratio of the resulting allocation. Tune W and the discount factor to minimise regret.",
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
                "Understand how DQN extends Q-learning to continuous state spaces using neural network function approximation, derive the DQN loss function, justify experience replay and target networks for training stability, implement Double DQN to fix overestimation bias, and build a Dueling DQN architecture for forex entry/exit learning.",
              keyTakeaways: [
                "DQN approximates Q*(s,a) ≈ Q(s,a;θ) using a neural network, enabling continuous state spaces",
                "DQN loss: L(θ) = 𝔼[(yₜ − Q(sₜ,aₜ;θ))²] where yₜ = rₜ + γ maxₐ′ Q(sₜ₊₁,a′;θ⁻) is the target",
                "Experience replay stores (s,a,r,s′,done) transitions and samples i.i.d. mini-batches, breaking temporal correlation",
                "Target network θ⁻ is a slowly-updated copy: θ⁻ ← τθ + (1−τ)θ⁻ with τ ≈ 0.005, stabilising bootstrap targets",
                "Double DQN decouples action selection from evaluation: a* = argmax Q(s′;θ), yₜ = r + γQ(s′,a*;θ⁻)",
                "Dueling DQN decomposes Q(s,a) = V(s;θ) + A(s,a;θ) − mean(A), separating state value from action advantage",
                "Prioritised experience replay samples transitions with probability ∝ |δₜ|^α, focusing on surprising transitions",
                "Forex application: state = normalised features (20+), actions = {strong sell, sell, hold, buy, strong buy}",
              ],
            },
            {
              type: "theory",
              title: "From Q-Tables to Neural Q-Functions: The DQN Framework",
              content:
                "**The Scaling Problem.** Tabular Q-learning maintains a table with |S| × |A| entries. For trading with continuous features (price, volatility, RSI, MACD, etc.), the state space is effectively infinite — no Q-table can cover it. DQN (Mnih et al., 2015) replaces the table with a neural network Q(s,a;θ) that generalises across similar states.\n\n**DQN Loss Derivation.** We want Q(s,a;θ) ≈ Q*(s,a). The Bellman optimality equation gives Q*(s,a) = R(s,a) + γ ∑ₛ′ P(s′|s,a) maxₐ′ Q*(s′,a′). We don't know P, so we use sample transitions (sₜ, aₜ, rₜ, sₜ₊₁). Define the TD target: yₜ = rₜ + γ maxₐ′ Q(sₜ₊₁,a′;θ). Minimise: L(θ) = 𝔼[(yₜ − Q(sₜ,aₜ;θ))²]. Taking the gradient: ∇θL = −2𝔼[(yₜ − Q(sₜ,aₜ;θ)) · ∇θQ(sₜ,aₜ;θ)]. This is a semi-gradient method because we treat yₜ as a constant (no gradient through the target).\n\n**Two Critical Instabilities.** Without modifications, neural Q-learning diverges in practice. Problem 1: Consecutive transitions (sₜ, sₜ₊₁, sₜ₊₂, …) are highly correlated — SGD assumes i.i.d. data. Training on correlated sequences causes the network to overfit to recent experiences and forget old ones. Problem 2: The target yₜ = r + γ max Q(s′;θ) depends on the same network being trained. As θ updates, yₜ shifts — the algorithm is chasing a moving target, causing oscillation or divergence.\n\n**Numerical Example.** Consider a forex agent with state s = [0.3, −0.5, 1.2, 0.8] (normalised RSI, MACD, volatility, position). Actions A = {sell, hold, buy}. The network outputs Q(s, sell;θ) = 0.5, Q(s, hold;θ) = 0.8, Q(s, buy;θ) = 1.2. Agent selects buy (ε-greedy). Receives reward r = 0.3. Next state s′ has Q(s′, sell;θ) = 0.4, Q(s′, hold;θ) = 0.9, Q(s′, buy;θ) = 0.7. Target: y = 0.3 + 0.99 × max(0.4, 0.9, 0.7) = 0.3 + 0.99 × 0.9 = 1.191. Loss: (1.191 − 1.2)² = 0.000081. Gradient pushes Q(s, buy;θ) slightly toward 1.191. Over thousands of such updates, Q converges to Q*.",
            },
            {
              type: "theory",
              title: "Experience Replay and Target Networks: Solving DQN's Instabilities",
              content:
                "**Experience Replay Buffer.** Store each transition (sₜ, aₜ, rₜ, sₜ₊₁, doneₜ) in a circular buffer D of capacity N (typically N = 100,000 to 1,000,000). At each training step, sample a random mini-batch of B transitions (typically B = 32 or 64) from D. This breaks temporal correlation: a mini-batch contains transitions from many different episodes and time steps, approximating the i.i.d. assumption of SGD. Additional benefits: (1) Data efficiency — each transition is used for multiple gradient updates, not just once. (2) Off-policy learning — the buffer contains transitions from older policies, but Q-learning is off-policy so this is valid.\n\n**Target Network.** Maintain a separate network Q(s,a;θ⁻) with frozen parameters θ⁻ used only to compute targets: yₜ = rₜ + γ maxₐ′ Q(sₜ₊₁,a′;θ⁻). The target network is updated slowly: either (a) hard update: θ⁻ ← θ every C steps (Mnih 2015, C = 10,000), or (b) soft update (Polyak averaging): θ⁻ ← τθ + (1−τ)θ⁻ every step, with τ ≈ 0.005 (Lillicrap 2016). This stabilises the target: yₜ changes slowly even as θ trains rapidly, preventing the 'chasing a moving target' problem.\n\n**Mathematical Justification.** Consider the loss L(θ) = 𝔼D[(yₜ − Q(sₜ,aₜ;θ))²]. Without target network: ∂L/∂θ involves both the prediction term ∂Q(sₜ,aₜ;θ)/∂θ and (implicitly) the target term ∂maxQ(sₜ₊₁;θ)/∂θ. The target gradient creates a feedback loop. With target network: yₜ = r + γ max Q(s′;θ⁻) is treated as a constant, so ∂L/∂θ = −2(yₜ − Q(s,a;θ))·∂Q(s,a;θ)/∂θ — a stable regression target. Soft updates ensure θ⁻ tracks θ smoothly: θ⁻ₖ₊₁ = (1−τ)ᵏθ₀ + τ∑ⱼ(1−τ)ᵏ⁻ʲθⱼ — an exponential moving average of past θ values.\n\n**Practical Hyperparameters for Trading.** Buffer size: N = 100,000 (covers ~400 trading days at 250 steps/day). Mini-batch: B = 64. Soft update: τ = 0.005. Learning rate: 1e-4 with Adam. Training starts after buffer has 10,000 transitions (40 days of data). Train 1 gradient step per environment step. These settings balance data freshness (old transitions may reflect different market regimes) with stability.",
            },
            {
              type: "theory",
              title: "Double DQN: Proving and Fixing Overestimation Bias",
              content:
                "**The Overestimation Problem.** Standard DQN uses yₜ = r + γ maxₐ′ Q(s′,a′;θ⁻). The max operator over noisy Q-estimates produces positive bias: 𝔼[maxₐ Q̂(s,a)] ≥ maxₐ 𝔼[Q̂(s,a)]. Proof: Let Q̂(s,aᵢ) = Q*(s,aᵢ) + εᵢ where εᵢ are zero-mean noise terms. Then max_i Q̂(s,aᵢ) = max_i [Q*(s,aᵢ) + εᵢ] ≥ Q*(s,a*) + ε_a* = Q*(s,a*) + ε_a*. Taking expectations: 𝔼[max_i Q̂] ≥ Q*(s,a*) = max_i Q*(s,aᵢ). The bias increases with the number of actions and the noise level. In trading, Q-estimates are very noisy due to stochastic market dynamics, making overestimation severe — the agent becomes overconfident in certain actions.\n\n**Concrete Example.** True Q-values: Q*(s, sell) = 0.5, Q*(s, hold) = 0.8, Q*(s, buy) = 0.5. Network estimates with noise ε ~ 𝒩(0, 0.3²): Q̂(s, sell) = 0.5 + 0.2 = 0.7, Q̂(s, hold) = 0.8 − 0.4 = 0.4, Q̂(s, buy) = 0.5 + 0.5 = 1.0. Standard DQN: max Q̂ = 1.0 (buy, wrong!). True max Q* = 0.8 (hold). The noise pushed 'buy' above 'hold'. Over many such errors, Q-values inflate systematically.\n\n**Double DQN Fix (van Hasselt, 2016).** Decouple action selection from evaluation: a* = argmaxₐ′ Q(s′,a′;θ) (select using online network), yₜ = r + γ Q(s′,a*;θ⁻) (evaluate using target network). If the online network's noise selects a suboptimal action, the target network provides a (differently-noisy) evaluation, reducing the positive bias. In our example: a* = argmax Q̂_θ(s,·) = buy. But Q̂_θ⁻(s, buy) = 0.5 − 0.1 = 0.4 (target network has different noise). The target becomes 0.4, much closer to the true Q*(s, buy) = 0.5 than the inflated 1.0.\n\n**Dueling DQN (Wang et al., 2016).** Decompose Q(s,a;θ) = V(s;θ_V) + A(s,a;θ_A) − (1/|A|)∑ₐ A(s,a;θ_A). V(s) captures the state value (how good is this market condition regardless of action), A(s,a) captures the advantage of each action relative to the average. The mean subtraction ensures identifiability: without it, V and A are not uniquely determined (you can add a constant to V and subtract it from all A). This decomposition helps when the action choice rarely matters (e.g., in ranging markets where all actions produce similar returns) — V is still learned accurately from the shared representation.",
            },
            {
              type: "intuition",
              title: "Experience Replay as Trade Journal Review",
              analogy:
                "You are a trader who keeps a detailed journal of every trade: entry conditions, action taken, P&L result, and resulting market state. Without replay, you only learn chronologically — today's losses dominate your thinking, yesterday's lessons fade. You might panic-adjust your strategy based on a single bad week. Experience replay means randomly flipping through your entire journal each evening, reviewing a diverse mix of old and recent trades from different market conditions. This prevents recency bias and ensures you learn from rare but important events (flash crashes, breakouts) long after they occur. The replay buffer size (100K transitions) is like keeping 2 years of detailed trade history — enough to see multiple market cycles.",
              content:
                "The target network is 'last month's strategy.' When evaluating whether today's trade was good, you compare against a stable benchmark — not against the strategy you just updated 5 minutes ago. If you kept changing the benchmark with every new trade, you would be chasing your own tail. The soft update τ = 0.005 means the benchmark absorbs 0.5% of your latest thinking per step — slow enough to be stable, fast enough to track genuine improvements. In trading terms: evaluate new ideas against a proven track record, not against yesterday's untested hypothesis.",
              emoji: "📔",
            },
            {
              type: "intuition",
              title: "Double DQN as Getting a Second Opinion",
              analogy:
                "Standard DQN is like asking a single analyst: 'what is the best trade AND how much will it make?' The analyst picks their most optimistic scenario (max), and their own optimism inflates the profit estimate (overestimation bias). Double DQN is like consulting two analysts: the first analyst recommends the best trade (action selection with θ), and the second analyst independently estimates how much it will make (value evaluation with θ⁻). Because the second analyst's biases are different from the first's, the combined estimate is less inflated. In trading, overestimation bias makes the agent think every trade is more profitable than it actually is — leading to overtrading and excessive risk. Double DQN's 'second opinion' keeps expectations realistic.",
              content:
                "The Dueling architecture adds another level of sophistication. Instead of asking 'how good is each trade?', it asks two separate questions: 'how good is this market state overall?' (V-stream) and 'how much better is each specific action than average?' (A-stream). In ranging markets where buy/sell/hold all produce similar results, the V-stream accurately captures the low-value state even though the A-stream is noisy. The agent learns 'this is a bad time to trade' (low V) rather than trying to distinguish between equally mediocre actions (noisy A).",
              emoji: "🔍",
            },
            {
              type: "code",
              title: "Complete Double Dueling DQN with Experience Replay for Forex",
              language: "python",
              code: `import numpy as np
import random
from collections import deque
import torch
import torch.nn as nn
import torch.optim as optim

class DuelingDQN(nn.Module):
    """
    Dueling architecture: Q(s,a) = V(s) + A(s,a) - mean(A)
    Separates state value from action advantage for better learning
    when actions have similar Q-values (e.g., ranging markets).
    """
    def __init__(self, state_dim: int, n_actions: int, hidden: int = 128):
        super().__init__()
        self.features = nn.Sequential(
            nn.Linear(state_dim, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
        )
        self.value_stream = nn.Sequential(
            nn.Linear(hidden, hidden // 2), nn.ReLU(),
            nn.Linear(hidden // 2, 1),
        )
        self.advantage_stream = nn.Sequential(
            nn.Linear(hidden, hidden // 2), nn.ReLU(),
            nn.Linear(hidden // 2, n_actions),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        features = self.features(x)
        value = self.value_stream(features)         # V(s): [B, 1]
        advantage = self.advantage_stream(features)  # A(s,a): [B, n_actions]
        # Q(s,a) = V(s) + A(s,a) - mean(A) for identifiability
        return value + advantage - advantage.mean(dim=1, keepdim=True)

class PrioritisedReplayBuffer:
    """Experience replay with priority sampling ~ |TD error|^alpha."""
    def __init__(self, capacity: int = 100_000, alpha: float = 0.6):
        self.capacity = capacity
        self.alpha = alpha
        self.buffer = []
        self.priorities = np.zeros(capacity, dtype=np.float32)
        self.position = 0
        self.size = 0

    def push(self, state, action, reward, next_state, done):
        max_prio = self.priorities[:self.size].max() if self.size > 0 else 1.0
        if self.size < self.capacity:
            self.buffer.append((state, action, reward, next_state, done))
        else:
            self.buffer[self.position] = (state, action, reward, next_state, done)
        self.priorities[self.position] = max_prio
        self.position = (self.position + 1) % self.capacity
        self.size = min(self.size + 1, self.capacity)

    def sample(self, batch_size: int, beta: float = 0.4):
        probs = self.priorities[:self.size] ** self.alpha
        probs /= probs.sum()
        indices = np.random.choice(self.size, batch_size, p=probs)
        # Importance sampling weights for bias correction
        weights = (self.size * probs[indices]) ** (-beta)
        weights /= weights.max()
        batch = [self.buffer[i] for i in indices]
        s, a, r, s2, d = zip(*batch)
        return (
            torch.tensor(np.array(s), dtype=torch.float32),
            torch.tensor(a, dtype=torch.long),
            torch.tensor(r, dtype=torch.float32),
            torch.tensor(np.array(s2), dtype=torch.float32),
            torch.tensor(d, dtype=torch.float32),
            indices,
            torch.tensor(weights, dtype=torch.float32),
        )

    def update_priorities(self, indices, td_errors):
        for idx, td in zip(indices, td_errors):
            self.priorities[idx] = abs(td) + 1e-6

class DoubleDuelingDQNAgent:
    """Complete Double Dueling DQN agent for forex trading."""
    def __init__(self, state_dim: int, n_actions: int = 5,
                 gamma: float = 0.99, lr: float = 1e-4, tau: float = 0.005):
        self.n_actions = n_actions
        self.gamma = gamma
        self.tau = tau
        self.epsilon = 1.0
        self.eps_min = 0.01
        self.eps_decay = 0.9995

        self.q_net = DuelingDQN(state_dim, n_actions)
        self.target_net = DuelingDQN(state_dim, n_actions)
        self.target_net.load_state_dict(self.q_net.state_dict())
        self.optimizer = optim.Adam(self.q_net.parameters(), lr=lr)
        self.buffer = PrioritisedReplayBuffer(capacity=100_000)

    def select_action(self, state: np.ndarray) -> int:
        if random.random() < self.epsilon:
            return random.randint(0, self.n_actions - 1)
        with torch.no_grad():
            q = self.q_net(torch.tensor(state, dtype=torch.float32).unsqueeze(0))
            return int(q.argmax(dim=1).item())

    def train_step(self, batch_size: int = 64) -> float:
        if self.buffer.size < batch_size * 10:
            return 0.0
        s, a, r, s2, d, indices, weights = self.buffer.sample(batch_size)

        with torch.no_grad():
            # Double DQN: select action with online net, evaluate with target
            best_actions = self.q_net(s2).argmax(dim=1)
            target_q = self.target_net(s2).gather(1, best_actions.unsqueeze(1)).squeeze()
            targets = r + self.gamma * target_q * (1.0 - d)

        current_q = self.q_net(s).gather(1, a.unsqueeze(1)).squeeze()
        td_errors = (targets - current_q).detach().numpy()

        # Weighted MSE loss for prioritised replay
        loss = (weights * (targets - current_q).pow(2)).mean()
        self.optimizer.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(self.q_net.parameters(), 10.0)
        self.optimizer.step()

        # Update priorities and target network
        self.buffer.update_priorities(indices, td_errors)
        for tp, op in zip(self.target_net.parameters(), self.q_net.parameters()):
            tp.data.copy_(self.tau * op.data + (1 - self.tau) * tp.data)
        self.epsilon = max(self.eps_min, self.epsilon * self.eps_decay)
        return loss.item()

# ── Demo: training loop on synthetic forex data ──────────────
np.random.seed(42); torch.manual_seed(42)
state_dim, n_actions = 10, 5
agent = DoubleDuelingDQNAgent(state_dim, n_actions)
actions_map = ["strong_sell", "sell", "hold", "buy", "strong_buy"]

print("DOUBLE DUELING DQN — FOREX TRAINING DEMO")
print(f"State dim: {state_dim}, Actions: {n_actions}, Buffer: 100K")
print("=" * 55)

for episode in range(200):
    state = np.random.randn(state_dim).astype(np.float32) * 0.1
    ep_reward, ep_loss, steps = 0.0, 0.0, 0
    for step in range(250):
        action = agent.select_action(state)
        # Simulated env: reward based on "trend-following" logic
        position = (action - 2) / 2.0   # -1 to +1
        market_return = np.random.normal(0.0002, 0.01)
        reward = position * market_return - 0.0001 * abs(position)
        next_state = state + np.random.randn(state_dim).astype(np.float32) * 0.05
        done = step == 249
        agent.buffer.push(state, action, reward, next_state, float(done))
        loss = agent.train_step(batch_size=64)
        ep_reward += reward; ep_loss += loss; steps += 1
        state = next_state
    if (episode + 1) % 50 == 0:
        print(f"Ep {episode+1:3d} | R: {ep_reward:+.4f} | Loss: {ep_loss/steps:.6f} "
              f"| ε: {agent.epsilon:.3f} | Buffer: {agent.buffer.size}")`,
              explanation:
                "A complete Double Dueling DQN implementation with prioritised experience replay. DuelingDQN separates Q = V + A − mean(A) for better value estimation. PrioritisedReplayBuffer samples transitions proportional to |TD error|^α — surprising transitions are replayed more often. DoubleDuelingDQNAgent combines ε-greedy exploration, Double DQN targets (select with θ, evaluate with θ⁻), soft Polyak averaging (θ⁻ ← τθ + (1−τ)θ⁻), and gradient clipping. The training loop demonstrates the full pipeline on synthetic forex data.",
            },
            {
              type: "code",
              title: "Vanilla DQN vs Double DQN: Overestimation Bias Experiment",
              language: "python",
              code: `import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim

class SimpleQNet(nn.Module):
    def __init__(self, s_dim, n_act, hidden=64):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(s_dim, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
            nn.Linear(hidden, n_act),
        )
    def forward(self, x): return self.net(x)

def measure_overestimation(use_double: bool, n_steps: int = 5000,
                           s_dim: int = 4, n_act: int = 5):
    """Train DQN or Double DQN and measure Q-value overestimation."""
    torch.manual_seed(42); np.random.seed(42)
    q_net = SimpleQNet(s_dim, n_act)
    target_net = SimpleQNet(s_dim, n_act)
    target_net.load_state_dict(q_net.state_dict())
    opt = optim.Adam(q_net.parameters(), lr=1e-3)

    # True Q-values for a simple environment: Q*(s,a) ≈ 0 for all s,a
    # (random walk market, no exploitable signal)
    true_q = 0.0  # ground truth: all actions are equally worthless
    estimated_maxq = []  # track max Q estimates over training
    gamma = 0.99

    for step in range(n_steps):
        s = torch.randn(32, s_dim)  # random states
        a = torch.randint(0, n_act, (32,))
        r = torch.randn(32) * 0.01  # noise rewards (mean 0)
        s2 = s + torch.randn(32, s_dim) * 0.1
        done = torch.zeros(32)

        with torch.no_grad():
            if use_double:
                # Double DQN: select with q_net, evaluate with target
                best_a = q_net(s2).argmax(dim=1)
                target_q = target_net(s2).gather(1, best_a.unsqueeze(1)).squeeze()
            else:
                # Vanilla DQN: max from target network
                target_q = target_net(s2).max(dim=1).values
            targets = r + gamma * target_q * (1 - done)

        predicted = q_net(s).gather(1, a.unsqueeze(1)).squeeze()
        loss = nn.MSELoss()(predicted, targets)
        opt.zero_grad(); loss.backward(); opt.step()

        # Soft update target
        if step % 10 == 0:
            for tp, op in zip(target_net.parameters(), q_net.parameters()):
                tp.data.copy_(0.01 * op.data + 0.99 * tp.data)

        if step % 100 == 0:
            with torch.no_grad():
                test_states = torch.randn(100, s_dim)
                max_q = q_net(test_states).max(dim=1).values.mean().item()
                estimated_maxq.append(max_q)

    return estimated_maxq

# ── Compare vanilla vs double ────────────────────────────────
print("OVERESTIMATION BIAS EXPERIMENT")
print("True Q*(s,a) ≈ 0 for all (s,a) — random walk market")
print("=" * 60)

vanilla_q = measure_overestimation(use_double=False, n_steps=5000)
double_q = measure_overestimation(use_double=True, n_steps=5000)

print(f"\\n{'Step':>6s} | {'Vanilla max Q̂':>14s} | {'Double max Q̂':>13s} | {'True Q*':>8s}")
print("-" * 55)
for i in range(0, len(vanilla_q), 5):
    step = i * 100
    print(f"{step:6d} | {vanilla_q[i]:+14.4f} | {double_q[i]:+13.4f} | {0.0:+8.4f}")

print(f"\\nFinal overestimation:")
print(f"  Vanilla DQN: {vanilla_q[-1]:+.4f} (bias = {vanilla_q[-1] - 0:.4f})")
print(f"  Double DQN:  {double_q[-1]:+.4f} (bias = {double_q[-1] - 0:.4f})")
print(f"  Bias reduction: {abs(vanilla_q[-1]) / max(abs(double_q[-1]), 1e-6):.1f}x")
print(f"\\nKey: Vanilla DQN's max operator inflates Q-values above the true 0.")
print(f"Double DQN's decoupled selection/evaluation dramatically reduces this.")`,
              explanation:
                "This experiment directly measures overestimation bias. In a random-walk market, the true Q*(s,a) ≈ 0 for all states and actions (no exploitable signal). Vanilla DQN's max operator inflates Q-estimates above 0 because max of noisy estimates has positive bias. Double DQN decouples action selection (online net) from value evaluation (target net), breaking the correlation that causes upward bias. The output shows vanilla DQN's Q-estimates drifting positive while Double DQN stays near 0 — quantifying the bias reduction.",
            },
            {
              type: "code",
              title: "DQN Forex Trading Environment with Feature Engineering",
              language: "python",
              code: `import numpy as np

class ForexDQNEnvironment:
    """
    Realistic forex trading environment for DQN agents.
    State: 10 normalised features capturing price dynamics.
    Actions: 5 discrete positions (strong sell → strong buy).
    Reward: risk-adjusted P&L with transaction costs.
    """
    def __init__(self, returns: np.ndarray, window: int = 20,
                 tx_cost: float = 0.0002):
        self.returns = returns
        self.window = window
        self.tx_cost = tx_cost
        self.n_actions = 5
        self.state_dim = 10
        self.position_map = {0: -1.0, 1: -0.5, 2: 0.0, 3: 0.5, 4: 1.0}
        self.action_names = ["strong_sell", "sell", "hold", "buy", "strong_buy"]
        self.reset()

    def _compute_features(self) -> np.ndarray:
        """10 normalised features for the current time step."""
        w = self.returns[max(0, self.t-self.window):self.t]
        if len(w) < 2:
            return np.zeros(self.state_dim, dtype=np.float32)
        mu, sigma = w.mean(), w.std() + 1e-8
        short_w = self.returns[max(0, self.t-5):self.t]
        return np.array([
            mu / sigma,                                  # rolling Sharpe (20-bar)
            sigma * np.sqrt(252),                        # annualised vol
            w[-1] / sigma,                               # normalised last return
            np.mean(short_w) / (np.std(short_w)+1e-8),  # short-term momentum (5-bar)
            (w > 0).mean() - 0.5,                       # win rate deviation
            np.max(np.maximum.accumulate(np.cumsum(w)) - np.cumsum(w)),  # max DD
            self.position,                               # current position [-1,1]
            self.equity - 1.0,                           # cumulative PnL
            np.clip(self.t / len(self.returns), 0, 1),   # time progress
            self.returns[self.t-1] / sigma if self.t > 0 else 0,  # prev return
        ], dtype=np.float32)

    def reset(self) -> np.ndarray:
        self.t = self.window
        self.position = 0.0
        self.equity = 1.0
        self.peak_equity = 1.0
        self.trade_count = 0
        return self._compute_features()

    def step(self, action: int):
        new_position = self.position_map[action]
        # Transaction cost for position change
        cost = self.tx_cost * abs(new_position - self.position)
        if new_position != self.position:
            self.trade_count += 1

        # P&L from holding the new position
        pnl = new_position * self.returns[self.t] - cost
        self.equity += pnl
        self.peak_equity = max(self.peak_equity, self.equity)

        # Risk-adjusted reward: P&L with drawdown penalty
        drawdown = (self.peak_equity - self.equity) / max(self.peak_equity, 1e-8)
        reward = pnl - 2.0 * max(drawdown - 0.05, 0)  # penalise DD > 5%

        self.position = new_position
        self.t += 1
        done = self.t >= len(self.returns) - 1
        return self._compute_features(), reward, done

    def summary(self) -> dict:
        total_return = self.equity - 1.0
        return {
            "equity": self.equity,
            "return": total_return,
            "trades": self.trade_count,
            "max_drawdown": 1 - self.equity / self.peak_equity,
        }

# ── Demo environment ─────────────────────────────────────────
np.random.seed(42)
# Simulate 2 years of daily returns with regime structure
returns = np.concatenate([
    np.random.normal(+0.0004, 0.008, 250),   # Year 1 H1: uptrend
    np.random.normal( 0.0000, 0.005, 250),   # Year 1 H2: range
    np.random.normal(-0.0002, 0.012, 250),   # Year 2 H1: volatile down
    np.random.normal(+0.0003, 0.006, 250),   # Year 2 H2: mild uptrend
])

env = ForexDQNEnvironment(returns, window=20)
print("FOREX DQN ENVIRONMENT DEMO")
print(f"State dim: {env.state_dim}, Actions: {env.n_actions}")
print(f"Data: {len(returns)} bars across 4 regimes")
print("=" * 55)

# Random agent baseline
state = env.reset()
while True:
    action = np.random.randint(env.n_actions)
    state, reward, done = env.step(action)
    if done: break
random_stats = env.summary()

# Simple momentum agent baseline
state = env.reset()
while True:
    # Buy if recent returns positive, sell if negative
    momentum = state[0]  # rolling Sharpe is feature 0
    if momentum > 0.3: action = 4  # strong buy
    elif momentum > 0: action = 3   # buy
    elif momentum < -0.3: action = 0 # strong sell
    elif momentum < 0: action = 1    # sell
    else: action = 2                  # hold
    state, reward, done = env.step(action)
    if done: break
momentum_stats = env.summary()

print(f"\\n{'Agent':>15s} | {'Return':>8s} | {'Trades':>6s} | {'Max DD':>7s}")
print("-" * 45)
print(f"{'Random':>15s} | {random_stats['return']:+8.4f} | {random_stats['trades']:6d} | "
      f"{random_stats['max_drawdown']:7.4f}")
print(f"{'Momentum':>15s} | {momentum_stats['return']:+8.4f} | {momentum_stats['trades']:6d} | "
      f"{momentum_stats['max_drawdown']:7.4f}")
print(f"\\nDQN agent should outperform both after sufficient training.")`,
              explanation:
                "A realistic forex trading environment for DQN with 10 normalised features (rolling Sharpe, volatility, momentum, drawdown, position, equity). The 5-action space maps to positions from −1.0 (strong sell) to +1.0 (strong buy). The reward function combines P&L with a drawdown penalty beyond 5% — teaching the agent to manage risk. The baselines (random and momentum) provide benchmarks. This environment can be directly used with the DoubleDuelingDQNAgent from the previous code block.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-dqn-q1",
                  question: "Why does DQN overestimate Q-values, and how does Double DQN fix it?",
                  options: [
                    { id: "rl-dqn-q1-a", text: "DQN uses a biased loss function; Double DQN uses an unbiased one" },
                    { id: "rl-dqn-q1-b", text: "The max operator over noisy Q-estimates has positive bias (𝔼[max Q̂] ≥ max 𝔼[Q̂]); Double DQN decouples action selection (θ) from value evaluation (θ⁻)" },
                    { id: "rl-dqn-q1-c", text: "DQN has too many parameters causing overfitting" },
                    { id: "rl-dqn-q1-d", text: "DQN cannot handle more than 3 actions" },
                  ],
                  correctOptionId: "rl-dqn-q1-b",
                  explanation:
                    "Jensen's inequality applied to the max function: max of noisy estimates ≥ max of true values on average. Double DQN uses θ to select the best action and θ⁻ (with independent noise) to evaluate it. The noise in selection and evaluation are uncorrelated, so the positive bias cancels out on average. In trading, this prevents the agent from being overconfident about specific trade setups.",
                },
                {
                  id: "rl-dqn-q2",
                  question: "Why must we subtract mean(A) in the Dueling architecture Q = V + A − mean(A)?",
                  options: [
                    { id: "rl-dqn-q2-a", text: "To ensure Q-values are always positive" },
                    { id: "rl-dqn-q2-b", text: "To reduce computational cost of the forward pass" },
                    { id: "rl-dqn-q2-c", text: "Without centering, V and A are not uniquely identifiable — adding c to V and subtracting c from all A gives the same Q" },
                    { id: "rl-dqn-q2-d", text: "For compatibility with batch normalisation layers" },
                  ],
                  correctOptionId: "rl-dqn-q2-c",
                  explanation:
                    "If Q = V + A, then (V+c) + (A−c) gives the same Q for any constant c. The decomposition is not unique, so the gradient cannot distinguish V from A. Subtracting mean(A) forces the average advantage to be zero, making V uniquely equal to the mean Q-value across actions. This forces V to capture state value and A to capture relative action quality.",
                },
                {
                  id: "rl-dqn-q3",
                  question: "What are the two problems that experience replay and target networks solve, respectively?",
                  options: [
                    { id: "rl-dqn-q3-a", text: "Replay solves overfitting; target network solves underfitting" },
                    { id: "rl-dqn-q3-b", text: "Replay breaks temporal correlation in training data (i.i.d. assumption); target network stabilises the bootstrap target (prevents chasing a moving target)" },
                    { id: "rl-dqn-q3-c", text: "Replay speeds up training; target network reduces memory usage" },
                    { id: "rl-dqn-q3-d", text: "Both solve the same problem: slow convergence" },
                  ],
                  correctOptionId: "rl-dqn-q3-b",
                  explanation:
                    "Problem 1 (replay): consecutive transitions (s₁,s₂,s₃…) are correlated — training on them violates SGD's i.i.d. assumption, causing the network to overfit to recent data. Random sampling from a buffer provides approximately i.i.d. batches. Problem 2 (target network): the target y = r + γ max Q(s';θ) shifts as θ updates, creating instability. Using a slowly-updated θ⁻ makes the target approximately stationary.",
                },
                {
                  id: "rl-dqn-q4",
                  question: "If the replay buffer has capacity 100,000 and the agent trains on 1H bars, approximately how many trading days of data does the buffer hold?",
                  options: [
                    { id: "rl-dqn-q4-a", text: "100,000 / 24 = ~4,167 days (assuming 24 bars/day)" },
                    { id: "rl-dqn-q4-b", text: "100,000 / 250 = 400 days (assuming 250 bars/trading day)" },
                    { id: "rl-dqn-q4-c", text: "100,000 bars = 100,000 days" },
                    { id: "rl-dqn-q4-d", text: "The buffer size does not relate to trading days" },
                  ],
                  correctOptionId: "rl-dqn-q4-a",
                  explanation:
                    "Forex trades 24 hours/day, so 1H bars give 24 bars per day. 100,000 / 24 ≈ 4,167 days ≈ 16 years of continuous data. This is generous — the buffer holds diverse market conditions. However, with a non-stationary market, very old transitions (from years ago) may no longer be representative, suggesting a smaller buffer or prioritised sampling might be better.",
                },
                {
                  id: "rl-dqn-q5",
                  question: "In prioritised experience replay, why do we use importance sampling weights w = (N·p(i))^(−β)?",
                  options: [
                    { id: "rl-dqn-q5-a", text: "To speed up training by giving more weight to easy examples" },
                    { id: "rl-dqn-q5-b", text: "To correct for the bias introduced by non-uniform sampling — high-priority transitions are over-represented, so we down-weight them to maintain an unbiased gradient estimate" },
                    { id: "rl-dqn-q5-c", text: "To normalise the learning rate across different batch sizes" },
                    { id: "rl-dqn-q5-d", text: "Importance weights are only needed for on-policy methods" },
                  ],
                  correctOptionId: "rl-dqn-q5-b",
                  explanation:
                    "Prioritised sampling with p(i) ∝ |δᵢ|^α oversamples high-TD-error transitions. This changes the data distribution from uniform to skewed — the gradient estimate becomes biased. Importance sampling weights w ∝ 1/p(i) correct for this bias, ensuring the expected gradient matches what we would get from uniform sampling. β starts low (allowing some bias for faster learning) and anneals to 1 (fully corrected) during training.",
                },
                {
                  id: "rl-dqn-q6",
                  question: "When would the Dueling architecture significantly outperform standard DQN in a forex application?",
                  options: [
                    { id: "rl-dqn-q6-a", text: "When all actions produce very different Q-values in every state" },
                    { id: "rl-dqn-q6-b", text: "When many states have similar Q-values across actions (e.g., ranging markets where buy/sell/hold are all mediocre) — the V-stream accurately captures state value even with noisy advantage estimates" },
                    { id: "rl-dqn-q6-c", text: "When the action space is continuous" },
                    { id: "rl-dqn-q6-d", text: "When the state space is very small (< 10 states)" },
                  ],
                  correctOptionId: "rl-dqn-q6-b",
                  explanation:
                    "Dueling excels when the action choice matters little but knowing the state value matters a lot. In ranging markets, all actions produce similar returns (small advantages), but the state value V(s) — 'is this a good or bad market condition?' — varies significantly. Standard DQN must learn this state value separately for each action. Dueling learns V once via the shared stream, then only needs to resolve small A differences — more sample efficient.",
                },
                {
                  id: "rl-dqn-q7",
                  question: "What is the soft target network update rule, and why is τ = 0.005 typical?",
                  options: [
                    { id: "rl-dqn-q7-a", text: "θ⁻ ← τθ + (1−τ)θ⁻ with τ = 0.005 means the target absorbs 0.5% of the online weights per step — slow enough for stable targets, fast enough to track improvements over hundreds of steps" },
                    { id: "rl-dqn-q7-b", text: "θ⁻ ← θ every 200 steps — hard replacement" },
                    { id: "rl-dqn-q7-c", text: "τ = 0.005 is the learning rate for the target network" },
                    { id: "rl-dqn-q7-d", text: "The target network does not need updating" },
                  ],
                  correctOptionId: "rl-dqn-q7-a",
                  explanation:
                    "Soft update θ⁻ ← 0.005θ + 0.995θ⁻ means the target network is an exponential moving average of past online networks. The effective 'half-life' is ln(0.5)/ln(0.995) ≈ 139 steps. This is smoother than hard replacement (which causes sudden target jumps) and ensures the bootstrap target changes gradually. Too large τ → unstable (target changes too fast). Too small τ → target lags too far behind, slowing convergence.",
                },
              ],
            },
            {
              type: "practice",
              title: "Guided: DQN Ablation Study on Forex Data",
              description:
                "Using the ForexDQNEnvironment and DoubleDuelingDQNAgent from the code examples, run a systematic ablation study. Train 4 agent variants for 500 episodes each:\n\n(a) Vanilla DQN: standard Q-network, uniform replay, single target (no double, no dueling)\n(b) Double DQN: add double targets only\n(c) Dueling DQN: add dueling architecture only\n(d) Full Double Dueling DQN: both improvements\n\nFor each variant, record: (1) final 50-episode average reward, (2) average max Q-value across states (measures overestimation), (3) equity curve on a held-out test set of 250 bars. Present results in a table. Hypothesis: Double DQN should show the biggest Q-value reduction; Dueling should show the biggest performance improvement in the low-volatility (ranging) regime.",
              catalogModelId: "dqn-forex-agent",
            },
            {
              type: "practice",
              title: "Open-Ended: Prioritised Replay Tuning for Market Regime Adaptation",
              description:
                "Experience replay buffers in trading face a unique challenge: market regimes shift, making old transitions potentially misleading. Design an experiment to investigate how replay buffer design affects regime adaptation speed.\n\nCompare: (a) Uniform replay with buffer size 10K vs 100K vs 500K, (b) Prioritised replay (α=0.6, β annealing), (c) Your own design: a 'regime-aware' buffer that weights recent transitions higher or maintains separate buffers per detected regime.\n\nTrain a DQN agent on a 4-regime forex simulation (trending→volatile→ranging→trending). Measure: how many episodes after each regime change does the agent need to adapt (reach 80% of within-regime optimal performance)? Does prioritised replay speed up adaptation? Does a smaller buffer force faster forgetting of old regimes? Present a regime adaptation speed comparison table.",
              catalogModelId: "dqn-forex-agent",
            },
          ],
        },
        {
          id: "rl-policy-gradient",
          title: "Policy Gradient Methods",
          description:
            "Directly optimise the policy for continuous position sizes with REINFORCE, understand the log-derivative trick derivation, baseline subtraction for variance reduction, natural policy gradients, and entropy regularisation for forex position sizing.",
          estimatedMinutes: 55,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Derive the policy gradient theorem using the log-derivative trick, understand REINFORCE with Monte Carlo returns, implement baseline subtraction for variance reduction, learn natural policy gradients and entropy regularisation, and apply Gaussian policies for continuous forex position sizing.",
              keyTakeaways: [
                "Policy gradient theorem: ∇θ J(θ) = 𝔼π[∇θ log π(a|s;θ) · Q^π(s,a)] — the fundamental equation for policy-based RL",
                "Log-derivative trick: ∇θ π(a|s;θ) = π(a|s;θ) · ∇θ log π(a|s;θ), converting a hard integral into a tractable expectation",
                "REINFORCE uses Monte Carlo return Gₜ = ∑ₖ₌₀^∞ γᵏ rₜ₊ₖ — unbiased but high variance due to credit assignment over long trajectories",
                "Baseline subtraction: ∇θ J = 𝔼[∇θ log π · (Q^π − b(s))] — subtracting any state-dependent baseline b(s) preserves the gradient in expectation but reduces variance",
                "The optimal baseline is b*(s) ≈ V^π(s), yielding the advantage: Â(s,a) = Q^π(s,a) − V^π(s)",
                "Natural policy gradient: F⁻¹∇θJ uses the Fisher information matrix F to account for parameter space geometry, preventing large policy changes from small parameter changes",
                "Entropy regularisation H[π] = −∑ₐ π(a|s) log π(a|s) prevents premature convergence to deterministic policies",
                "Gaussian policy π(a|s) = 𝒩(μ(s;θ), σ²(s;θ)) enables continuous position sizing a ∈ [−1, 1] for forex",
              ],
            },
            {
              type: "theory",
              title: "The Policy Gradient Theorem: Full Derivation via the Log-Derivative Trick",
              content:
                "**Setup.** Instead of learning Q-values and deriving a policy, we directly parameterise the policy π(a|s;θ) and optimise the objective J(θ) = 𝔼τ~π[∑ₜ γᵗ rₜ] = ∑ₛ d^π(s) ∑ₐ π(a|s;θ) Q^π(s,a), where d^π(s) = ∑ₜ γᵗ P(sₜ=s|π) is the discounted state visitation distribution.\n\n**Step 1 — Gradient of J.** ∇θJ(θ) = ∑ₛ d^π(s) ∑ₐ ∇θ[π(a|s;θ) Q^π(s,a)]. The Q^π term also depends on θ (through future policy), but the Policy Gradient Theorem (Sutton et al., 1999) shows that we can ignore ∇θQ^π: ∇θJ(θ) = ∑ₛ d^π(s) ∑ₐ ∇θπ(a|s;θ) · Q^π(s,a). This is non-trivial — the proof involves telescoping the Bellman equation through the state visitation distribution.\n\n**Step 2 — Log-Derivative Trick.** The sum ∑ₐ ∇θπ · Q is hard to compute because we need ∇θπ for every action. Apply the identity: ∇θπ = π · ∇θ log π (since ∇θ log f = ∇θf / f). Then: ∇θJ = ∑ₛ d^π(s) ∑ₐ π(a|s;θ) · ∇θ log π(a|s;θ) · Q^π(s,a) = 𝔼_{s~d^π, a~π}[∇θ log π(aₜ|sₜ;θ) · Q^π(sₜ,aₜ)]. Now the gradient is an expectation — we can estimate it by sampling trajectories!\n\n**Step 3 — REINFORCE Estimator.** In practice, we don't know Q^π. REINFORCE replaces it with the sample return Gₜ = ∑ₖ₌₀ γᵏrₜ₊ₖ. The gradient estimate: ĝ = (1/N) ∑ᵢ ∑ₜ ∇θ log π(aₜ|sₜ;θ) · Gₜ. This is unbiased (𝔼[Gₜ] = Q^π by definition) but has very high variance because a single trajectory's Gₜ includes all future noise.\n\n**Numerical Example.** Gaussian policy π(a|s) = 𝒩(μ(s), σ²) with μ(s) = θ · s. State s = 0.5 (normalised momentum). θ = 2.0, so μ = 1.0, σ = 0.3. Agent samples a = 0.8. log π(0.8|s) = −(0.8−1.0)²/(2·0.09) − log(0.3√(2π)) = −0.222 − 1.32 = −1.54. ∇θ log π = ∂/∂θ [−(a−θs)²/(2σ²)] = (a−θs)·s/σ² = (0.8−1.0)·0.5/0.09 = −1.11. If Gₜ = +0.5 (profitable trade): gradient = −1.11 × 0.5 = −0.56. This pushes θ down (reducing μ), because the action was below μ and was profitable — so the mean should decrease toward where the action was. If Gₜ = −0.5 (loss): gradient = −1.11 × (−0.5) = +0.56 — pushes θ up, moving away from this unprofitable action.",
            },
            {
              type: "theory",
              title: "Baseline Subtraction and Variance Reduction — Why V(s) is Optimal",
              content:
                "**The Variance Problem.** REINFORCE's gradient estimate ĝ = ∇θ log π · Gₜ has variance proportional to Var(Gₜ), which can be enormous. Consider a 250-step episode: Gₜ = ∑₂₅₀ₖ₌₀ γᵏrₜ₊ₖ sums up to 250 noisy rewards. Even if the policy is optimal, different trajectories produce wildly different Gₜ due to stochastic market dynamics. Result: the gradient estimate is very noisy, requiring thousands of episodes for a reliable update direction.\n\n**Baseline Subtraction.** A key identity: 𝔼_{a~π}[∇θ log π(a|s;θ) · b(s)] = ∑ₐ π · (∇θπ/π) · b = b · ∑ₐ ∇θπ = b · ∇θ(∑ₐ π) = b · ∇θ(1) = 0. Therefore, subtracting any state-dependent baseline b(s) from the return preserves the expected gradient: ∇θJ = 𝔼[∇θ log π · (Gₜ − b(sₜ))]. The gradient is unbiased for any b(s), but variance depends on the choice of b.\n\n**Optimal Baseline.** Minimise Var[∇θ log π · (G − b)] over b. Taking the derivative and setting to zero yields b*(s) = 𝔼[||∇θ log π||² · G] / 𝔼[||∇θ log π||²] ≈ 𝔼[Gₜ | sₜ = s] = V^π(s). So the optimal baseline is approximately the value function! Using b(s) = V^π(s): ĝ = ∇θ log π · (Gₜ − V(sₜ)) = ∇θ log π · Âₜ, where Âₜ = Gₜ − V(sₜ) is the advantage. The advantage has zero mean (over actions) by construction, so the gradient signal is centred: positive Â means 'better than average,' negative means 'worse than average.'\n\n**Variance Comparison.** Without baseline: Var ∝ 𝔼[Gₜ²]. With baseline V: Var ∝ 𝔼[Âₜ²] = 𝔼[(Gₜ − V)²] << 𝔼[Gₜ²] (since V captures the bulk of the signal). In our forex example: Gₜ ≈ 0.05 ± 0.8 (positive mean, huge variance). V(sₜ) ≈ 0.05. Â = Gₜ − V ≈ 0 ± 0.8 still has high variance but is centred, so gradient updates point in the right direction more often.\n\n**Practical Implication for Trading.** A trading agent without a baseline receives the full equity curve noise in every gradient. With V(s) as baseline, the gradient only reflects whether each trade was better or worse than the expected cumulative P&L from that market state — a much more informative signal for policy improvement.",
            },
            {
              type: "theory",
              title: "Natural Policy Gradient and Entropy Regularisation",
              content:
                "**Natural Policy Gradient.** Standard gradient descent ∇θJ treats all parameter directions equally, but the policy space has non-Euclidean geometry. A small change δθ can cause a large policy change π(a|s;θ+δθ) ≠ π(a|s;θ) if the parameterisation is sensitive in certain directions. The Fisher Information Matrix F(θ) = 𝔼π[∇θ log π · (∇θ log π)ᵀ] measures the local curvature of the policy distribution. The natural gradient is: θ ← θ + α F(θ)⁻¹ ∇θJ. This ensures updates are measured in policy space (KL divergence) rather than parameter space (Euclidean distance). The resulting KL change is bounded: KL(π_old ‖ π_new) ≈ (1/2) δθᵀ F δθ, which natural gradient constrains to be constant. This is the theoretical foundation for trust region methods like TRPO and PPO.\n\n**Numerical Example.** Consider a 1D Gaussian π = 𝒩(θ, 1). F(θ) = 𝔼[(∇θ log π)²] = 𝔼[(a−θ)²/1²] = 1. Natural gradient = F⁻¹∇J = ∇J — identical to standard gradient for this simple case. But for π = 𝒩(θ, σ²(θ)) where σ depends on θ, F becomes non-trivial and natural gradient correctly accounts for the coupling between mean and variance.\n\n**Entropy Regularisation.** The entropy of a Gaussian policy is H[𝒩(μ, σ²)] = (1/2) log(2πeσ²). Adding −c₂ H[π] to the loss penalises low entropy (small σ), preventing the policy from collapsing to a deterministic δ(a − μ(s)). This keeps the agent exploring diverse position sizes. The augmented objective: J_aug(θ) = J(θ) + c₂ 𝔼[H[π(·|s;θ)]]. As training progresses, we may anneal c₂ toward 0 to allow the policy to become more deterministic once the optimal strategy is identified.\n\n**Trading Implications.** Without entropy regularisation, a forex agent often converges early to always holding a fixed position (e.g., μ → +1.0, σ → 0.01 = always fully long). This is catastrophic in ranging or volatile markets. With c₂ = 0.01: the entropy bonus keeps σ ≥ 0.1, ensuring the agent samples diverse position sizes and continues learning about different market conditions. The c₂ coefficient balances exploration (high c₂ = wide σ = explores aggressively) vs exploitation (low c₂ = narrow σ = commits to learned strategy).",
            },
            {
              type: "intuition",
              title: "REINFORCE as Learning from Trade Reviews",
              analogy:
                "You are a trader reviewing your performance at the end of each week. REINFORCE is like grading every trade by the total week's P&L: 'I bought on Monday, the week ended +$500, so buying on Monday was good.' But maybe Monday's buy was terrible and Thursday's sell rescued the week. REINFORCE cannot distinguish — it credits the entire $500 to every action equally (high variance). The baseline V(s) is like knowing 'on average, weeks starting like this produce +$300.' Now Monday's buy gets credit for $500−$300 = $200 excess return (advantage), which is a much sharper signal. Actor-Critic takes this further by providing a per-step baseline V(sₜ) at each decision point, so each trade is evaluated against its own expected outcome.",
              content:
                "The log-derivative trick converts the policy gradient from 'how does changing θ change the probability of every possible trajectory?' (intractable) to 'for the trajectory I actually observed, in which direction should I adjust θ to make profitable actions more likely?' This is like asking 'should I be more aggressive (increase μ) or more conservative (decrease μ) given what happened?' The answer is weighted by the advantage — bigger adjustments for bigger surprises.",
              emoji: "📈",
            },
            {
              type: "intuition",
              title: "PPO as a Cautious Strategy Updater with Guardrails",
              analogy:
                "Imagine you are managing a team of traders. After each day, the quant team proposes a new strategy update. REINFORCE implements the proposal immediately, no matter how radical — dangerous! The quant team might have had one lucky day and proposes 10× leverage. Actor-Critic adds a reasonableness check (the critic V(s) provides a baseline), so proposals are measured against expected outcomes. PPO adds the ultimate guardrail: 'regardless of how good or bad the proposal looks, we will not change our strategy by more than 20%.' This is the clipping mechanism: the probability ratio rₜ = π_new/π_old is clamped to [0.8, 1.2]. Even if the advantage is enormous (one-in-a-thousand profitable trade), the policy change is bounded. This prevents: (1) overreacting to lucky streaks (overfitting to noise), (2) panic-selling after drawdowns (overreacting to bad luck), (3) sudden leverage increases that blow up accounts.",
              content:
                "PPO's clipped surrogate creates a 'trust region' in policy space without the computational cost of TRPO's constrained optimisation (which requires computing and inverting the Fisher matrix). The four cases: (1) Â > 0, r < 1+ε: good action, policy can still increase — gradient flows normally. (2) Â > 0, r > 1+ε: good action, policy already increased enough — gradient clipped to zero (don't push further). (3) Â < 0, r > 1−ε: bad action, policy can still decrease — gradient flows. (4) Â < 0, r < 1−ε: bad action, policy already decreased — gradient clipped. This asymmetric clipping ensures monotonic improvement with high probability — stable, boring progress that compounds into profitable trading.",
              emoji: "🛡️",
            },
            {
              type: "code",
              title: "REINFORCE with Baseline for Forex Position Sizing",
              language: "python",
              code: `import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.distributions import Normal

class GaussianPolicy(nn.Module):
    """Policy network outputting N(mu(s), sigma^2) for position sizing."""
    def __init__(self, state_dim: int, hidden: int = 64):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(state_dim, hidden), nn.Tanh(),
            nn.Linear(hidden, hidden), nn.Tanh(),
        )
        self.mu_head = nn.Linear(hidden, 1)
        self.log_std = nn.Parameter(torch.zeros(1))  # learnable log(sigma)

    def forward(self, state):
        h = self.net(state)
        mu = torch.tanh(self.mu_head(h))
        std = self.log_std.exp().expand_as(mu)
        return Normal(mu, std)

class ValueBaseline(nn.Module):
    """V(s) baseline for variance reduction."""
    def __init__(self, state_dim: int, hidden: int = 64):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(state_dim, hidden), nn.Tanh(),
            nn.Linear(hidden, hidden), nn.Tanh(),
            nn.Linear(hidden, 1),
        )
    def forward(self, state):
        return self.net(state)

def reinforce_with_baseline(returns_data, n_episodes=300, gamma=0.99,
                             lr_pi=1e-3, lr_v=3e-3, window=20):
    """REINFORCE: grad = E[nabla log pi(a|s) * (G_t - V(s))]"""
    state_dim = 5
    policy = GaussianPolicy(state_dim)
    baseline = ValueBaseline(state_dim)
    opt_pi = optim.Adam(policy.parameters(), lr=lr_pi)
    opt_v = optim.Adam(baseline.parameters(), lr=lr_v)

    for ep in range(n_episodes):
        # Collect one full episode
        states, actions, rewards, log_probs = [], [], [], []
        t, position, equity = window, 0.0, 1.0

        while t < len(returns_data) - 1:
            w = returns_data[max(0, t-window):t]
            mu_w, sig_w = w.mean(), w.std() + 1e-8
            state = torch.tensor([
                mu_w/sig_w, sig_w*np.sqrt(252), w[-1]/sig_w,
                position, equity - 1.0
            ], dtype=torch.float32).unsqueeze(0)

            dist = policy(state)
            action = dist.sample().clamp(-1, 1)
            lp = dist.log_prob(action)

            pos_new = action.item()
            pnl = pos_new * returns_data[t] - 0.0002 * abs(pos_new - position)
            equity += pnl
            position = pos_new

            states.append(state.squeeze(0))
            actions.append(action.item())
            rewards.append(pnl)
            log_probs.append(lp.squeeze())
            t += 1

        # Compute returns G_t = sum_{k=0}^{T-t} gamma^k r_{t+k}
        T = len(rewards)
        G = torch.zeros(T)
        g = 0.0
        for t in reversed(range(T)):
            g = rewards[t] + gamma * g
            G[t] = g

        # Stack tensors
        states_t = torch.stack(states)
        log_probs_t = torch.stack(log_probs)

        # Update baseline V(s) to fit returns
        V = baseline(states_t).squeeze()
        v_loss = nn.MSELoss()(V, G)
        opt_v.zero_grad(); v_loss.backward(); opt_v.step()

        # REINFORCE update: grad = -log_prob * advantage
        with torch.no_grad():
            V_detached = baseline(states_t).squeeze()
        advantages = G - V_detached
        advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

        policy_loss = -(log_probs_t * advantages).mean()
        entropy_bonus = -0.01 * policy(states_t).entropy().mean()
        total_loss = policy_loss + entropy_bonus

        opt_pi.zero_grad(); total_loss.backward()
        nn.utils.clip_grad_norm_(policy.parameters(), 1.0)
        opt_pi.step()

        if (ep + 1) % 50 == 0:
            sigma = policy.log_std.exp().item()
            print(f"Ep {ep+1:3d} | Equity: {equity:.4f} | "
                  f"Avg|pos|: {np.mean(np.abs(actions)):.3f} | "
                  f"σ: {sigma:.3f} | V_loss: {v_loss.item():.4f}")

    return policy, baseline

# ── Train ────────────────────────────────────────────────────
np.random.seed(42); torch.manual_seed(42)
sim_returns = np.concatenate([
    np.random.normal(+0.0004, 0.008, 500),  # uptrend
    np.random.normal( 0.0000, 0.006, 500),  # range
])
print("REINFORCE WITH BASELINE — FOREX POSITION SIZING")
print("=" * 55)
policy, baseline = reinforce_with_baseline(sim_returns, n_episodes=300)
print(f"\\nFinal sigma (exploration): {policy.log_std.exp().item():.4f}")
print("Learned: policy outputs position size based on market features")`,
              explanation:
                "REINFORCE with a learned baseline V(s). The GaussianPolicy outputs 𝒩(μ(s), σ²) for continuous position sizing. The ValueBaseline V(s) reduces gradient variance by subtracting the expected return from the actual return: Â = Gₜ − V(sₜ). The policy gradient ∇θJ ≈ −log π(a|s;θ) × Â pushes the policy toward actions with positive advantage. Entropy regularisation keeps σ from collapsing. The training loop collects full episodes, computes Monte Carlo returns, updates the baseline, then updates the policy — the classic REINFORCE pattern.",
            },
            {
              type: "code",
              title: "Variance Reduction Experiment: REINFORCE vs REINFORCE+Baseline",
              language: "python",
              code: `import numpy as np
import torch
import torch.nn as nn
from torch.distributions import Normal

def estimate_gradient_variance(use_baseline: bool, n_trajectories: int = 50,
                                n_steps: int = 100, state_dim: int = 3):
    """Measure gradient variance with and without baseline."""
    torch.manual_seed(42)
    # Simple linear Gaussian policy: mu = theta^T s, fixed sigma
    theta = nn.Parameter(torch.randn(state_dim, 1) * 0.1)
    sigma = 0.5
    gradient_norms = []

    for traj in range(n_trajectories):
        log_probs, returns_list = [], []
        G_total = 0.0

        for t in range(n_steps):
            s = torch.randn(1, state_dim)
            mu = (s @ theta).squeeze()
            dist = Normal(mu, sigma)
            a = dist.sample()
            log_p = dist.log_prob(a)

            # Simple reward: r = -|a - sin(t/10)| (track a sine wave)
            target = np.sin(t / 10.0)
            reward = -abs(a.item() - target) + 0.1
            log_probs.append(log_p)
            returns_list.append(reward)

        # Compute returns-to-go G_t
        G = torch.zeros(n_steps)
        g = 0.0
        for t in reversed(range(n_steps)):
            g = returns_list[t] + 0.99 * g
            G[t] = g

        lp_stack = torch.stack(log_probs)

        if use_baseline:
            baseline = G.mean()  # simple constant baseline
            signal = G - baseline
        else:
            signal = G

        # Policy gradient estimate for this trajectory
        grad = torch.autograd.grad(
            -(lp_stack * signal.detach()).sum(),
            theta, retain_graph=False
        )[0]
        gradient_norms.append(grad.norm().item())

    return np.array(gradient_norms)

# ── Compare ──────────────────────────────────────────────────
print("GRADIENT VARIANCE: REINFORCE vs REINFORCE + BASELINE")
print("=" * 60)

g_no_base = estimate_gradient_variance(use_baseline=False, n_trajectories=100)
g_with_base = estimate_gradient_variance(use_baseline=True, n_trajectories=100)

print(f"\\n{'Metric':>25s} | {'No Baseline':>12s} | {'With Baseline':>14s}")
print("-" * 60)
print(f"{'Mean gradient norm':>25s} | {g_no_base.mean():12.4f} | {g_with_base.mean():14.4f}")
print(f"{'Std gradient norm':>25s} | {g_no_base.std():12.4f} | {g_with_base.std():14.4f}")
print(f"{'Coefficient of variation':>25s} | {g_no_base.std()/g_no_base.mean():12.4f} | "
      f"{g_with_base.std()/g_with_base.mean():14.4f}")
print(f"{'Max gradient norm':>25s} | {g_no_base.max():12.4f} | {g_with_base.max():14.4f}")
print(f"{'Min gradient norm':>25s} | {g_no_base.min():12.4f} | {g_with_base.min():14.4f}")

ratio = g_no_base.std() / max(g_with_base.std(), 1e-8)
print(f"\\nVariance reduction factor: {ratio:.1f}x")
print(f"Baseline reduces gradient noise by removing the average return from the signal.")
print(f"The gradient direction is preserved (unbiased) but magnitude is more consistent.")`,
              explanation:
                "This experiment directly measures the gradient variance reduction from baseline subtraction. We compute REINFORCE gradients for 100 trajectories with and without a constant baseline b = mean(G). The coefficient of variation (std/mean) quantifies signal-to-noise ratio. With baseline, the gradient norms are more consistent (lower std), meaning each update is more reliable — the policy converges in fewer episodes. This is the fundamental motivation for actor-critic methods, which learn a state-dependent baseline V(s) for even greater variance reduction.",
            },
            {
              type: "code",
              title: "PPO Clipping Mechanics: Visualising the Surrogate Objective",
              language: "python",
              code: `import numpy as np
import torch

def ppo_clipped_objective(ratio: np.ndarray, advantage: float,
                          clip_eps: float = 0.2):
    """Compute PPO clipped surrogate for a range of ratios."""
    surr1 = ratio * advantage
    surr2 = np.clip(ratio, 1 - clip_eps, 1 + clip_eps) * advantage
    return np.minimum(surr1, surr2)

# ── Analyse clipping behaviour ───────────────────────────────
print("PPO CLIPPED SURROGATE OBJECTIVE ANALYSIS")
print("=" * 60)
ratios = np.linspace(0.5, 1.8, 100)
eps = 0.2

for adv_val, adv_label in [(+1.0, "POSITIVE (good action)"),
                             (-1.0, "NEGATIVE (bad action)")]:
    print(f"\\nAdvantage = {adv_val:+.1f} — {adv_label}")
    print(f"{'Ratio r':>10s} | {'Unclipped':>10s} | {'Clipped':>10s} | {'PPO min':>10s} | {'Effect':>20s}")
    print("-" * 70)

    obj = ppo_clipped_objective(ratios, adv_val, eps)
    for r in [0.5, 0.8, 1.0, 1.2, 1.5, 1.8]:
        s1 = r * adv_val
        s2 = np.clip(r, 1-eps, 1+eps) * adv_val
        ppo = min(s1, s2)
        if adv_val > 0:
            effect = "gradient flows" if r <= 1+eps else "CLIPPED (no grad)"
        else:
            effect = "gradient flows" if r >= 1-eps else "CLIPPED (no grad)"
        print(f"{r:10.2f} | {s1:+10.4f} | {s2:+10.4f} | {ppo:+10.4f} | {effect:>20s}")

# ── Numerical PPO update example ─────────────────────────────
print(f"\\nNUMERICAL PPO UPDATE EXAMPLE")
print("=" * 60)
torch.manual_seed(42)

# Simulate: old policy pi_old(a=0.3 | s) and new policy pi_new(a=0.3 | s)
from torch.distributions import Normal

mu_old, sigma_old = 0.5, 0.3
mu_new, sigma_new = 0.6, 0.28  # updated policy

action = torch.tensor([0.3])
old_dist = Normal(mu_old, sigma_old)
new_dist = Normal(mu_new, sigma_new)

old_log_prob = old_dist.log_prob(action)
new_log_prob = new_dist.log_prob(action)
ratio = (new_log_prob - old_log_prob).exp().item()

for A_val in [+0.5, -0.5, +2.0, -2.0]:
    s1 = ratio * A_val
    s2 = np.clip(ratio, 1-eps, 1+eps) * A_val
    ppo = min(s1, s2)
    clipped = "YES" if abs(s1 - ppo) > 1e-6 else "no"
    print(f"  Â={A_val:+4.1f}: ratio={ratio:.4f}, unclipped={s1:+.4f}, "
          f"clipped_term={s2:+.4f}, PPO={ppo:+.4f}, clipped={clipped}")

print(f"\\nKey: PPO prevents large policy changes even with extreme advantages.")
print(f"  ratio > 1+ε with Â>0: policy already moved enough in good direction")
print(f"  ratio < 1-ε with Â<0: policy already moved enough away from bad action")`,
              explanation:
                "This code dissects PPO's clipping mechanism with actual numbers. For positive advantage (good action): the objective is min(rÂ, clip(r)Â). When r > 1.2 (policy already increased this action's probability by >20%), the clipped term (1.2)Â is smaller and wins the min — gradient vanishes, preventing further increase. For negative advantage (bad action): when r < 0.8 (policy already decreased by >20%), clipping stops further decrease. The numerical example with actual Gaussian log-probabilities shows exactly how the ratio r = π_new/π_old is computed and when clipping activates.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-policy-gradient-q1",
                  question: "What is the log-derivative trick and why is it essential for policy gradients?",
                  options: [
                    { id: "rl-policy-gradient-q1-a", text: "It approximates the logarithm with a Taylor expansion for faster computation" },
                    { id: "rl-policy-gradient-q1-b", text: "∇θπ = π · ∇θ log π converts the gradient of an intractable integral into a sample-based expectation 𝔼π[∇θ log π · Q]" },
                    { id: "rl-policy-gradient-q1-c", text: "It replaces the policy with its log for numerical stability" },
                    { id: "rl-policy-gradient-q1-d", text: "It eliminates the need for backpropagation through the environment" },
                  ],
                  correctOptionId: "rl-policy-gradient-q1-b",
                  explanation:
                    "∇θJ = ∑ₛ d(s) ∑ₐ ∇θπ(a|s)Q(s,a) requires computing ∇θπ for every action. The identity ∇θπ = π · ∇θ log π converts this to ∑ₐ π · ∇θ log π · Q = 𝔼_{a~π}[∇θ log π · Q], which we can estimate by simply sampling actions from the current policy. This is what makes REINFORCE possible — no model of the environment needed.",
                },
                {
                  id: "rl-policy-gradient-q2",
                  question: "In PPO, when Â > 0 and rₜ > 1+ε, what happens to the gradient?",
                  options: [
                    { id: "rl-policy-gradient-q2-a", text: "The objective is zeroed and the episode is discarded" },
                    { id: "rl-policy-gradient-q2-b", text: "min() selects the clipped term (1+ε)Â, which is constant w.r.t. θ — gradient is zero, preventing further probability increase for this action" },
                    { id: "rl-policy-gradient-q2-c", text: "The ratio is reset to 1.0 and training continues normally" },
                    { id: "rl-policy-gradient-q2-d", text: "The advantage is set to zero for this timestep" },
                  ],
                  correctOptionId: "rl-policy-gradient-q2-b",
                  explanation:
                    "When rₜ exceeds 1+ε for a good action (Â > 0), the unclipped objective rₜÂ is larger than the clipped (1+ε)Â. min() selects the clipped term, which does not depend on θ (it is clip(r)Â where clip(r) = 1+ε, a constant). Since ∂(constant)/∂θ = 0, no gradient flows — the policy stops increasing this action's probability. This is PPO's 'trust region' enforcement.",
                },
                {
                  id: "rl-policy-gradient-q3",
                  question: "Why does subtracting a baseline b(s) from Gₜ reduce variance without introducing bias?",
                  options: [
                    { id: "rl-policy-gradient-q3-a", text: "Because b(s) normalises the rewards to unit variance" },
                    { id: "rl-policy-gradient-q3-b", text: "Because 𝔼_{a~π}[∇θ log π(a|s) · b(s)] = b(s) · ∇θ ∑ₐ π(a|s) = b(s) · ∇θ(1) = 0 — the baseline term vanishes in expectation" },
                    { id: "rl-policy-gradient-q3-c", text: "Because the baseline is subtracted from both the numerator and denominator" },
                    { id: "rl-policy-gradient-q3-d", text: "It does introduce bias but the bias is acceptably small" },
                  ],
                  correctOptionId: "rl-policy-gradient-q3-b",
                  explanation:
                    "The key identity: ∑ₐ π · ∇θ log π · b = b · ∑ₐ ∇θπ = b · ∇θ(1) = 0. Since probabilities sum to 1 and the gradient of a constant is 0, the baseline contribution has zero expectation. So 𝔼[∇θ log π · (G − b)] = 𝔼[∇θ log π · G] − 0 = ∇θJ. Unbiased! But Var(G − b) < Var(G) when b ≈ 𝔼[G].",
                },
                {
                  id: "rl-policy-gradient-q4",
                  question: "Why use a Gaussian distribution π(a|s) = 𝒩(μ(s;θ), σ²) for forex position sizing?",
                  options: [
                    { id: "rl-policy-gradient-q4-a", text: "Gaussians are the only distribution with a tractable log-derivative" },
                    { id: "rl-policy-gradient-q4-b", text: "Continuous distributions enable nuanced sizing (0.3 vs 0.7 lots); the log-derivative ∇θ log π = (a−μ)/σ² · ∇θμ pushes μ toward profitable actions; σ controls exploration" },
                    { id: "rl-policy-gradient-q4-c", text: "Gaussian policies always converge to the global optimum" },
                    { id: "rl-policy-gradient-q4-d", text: "Discrete distributions cannot represent buy/sell/hold" },
                  ],
                  correctOptionId: "rl-policy-gradient-q4-b",
                  explanation:
                    "Trading needs precise position sizing — 0.3 lots vs 0.7 lots vs 1.2 lots. A Gaussian over [−1, 1] provides infinite precision. The gradient ∇θ log 𝒩(a|μ,σ²) = (a−μ)·∇θμ/σ² naturally adjusts μ: if a > μ and the action was profitable (positive advantage), μ increases toward a. σ controls exploration breadth — learnable σ lets the agent decide when to explore and when to commit.",
                },
                {
                  id: "rl-policy-gradient-q5",
                  question: "What does the entropy bonus −c₂·H[π] prevent, and what is H for a Gaussian?",
                  options: [
                    { id: "rl-policy-gradient-q5-a", text: "It prevents overfitting; H = number of parameters in the network" },
                    { id: "rl-policy-gradient-q5-b", text: "It prevents premature collapse to a deterministic policy (σ→0); H[𝒩(μ,σ²)] = ½log(2πeσ²), so the bonus rewards large σ" },
                    { id: "rl-policy-gradient-q5-c", text: "It speeds up convergence; H = cross-entropy with uniform distribution" },
                    { id: "rl-policy-gradient-q5-d", text: "It normalises the advantage estimates; H = mean squared advantage" },
                  ],
                  correctOptionId: "rl-policy-gradient-q5-b",
                  explanation:
                    "Without entropy regularisation, σ collapses to near-zero early in training — the policy becomes deterministic before adequately exploring the action space. H[𝒩(μ,σ²)] = ½log(2πeσ²) increases with σ. Maximising H (via the −c₂·H term in the loss) penalises small σ, keeping the policy stochastic enough to continue learning. In trading, this prevents the agent from committing to always-long or always-short too early.",
                },
                {
                  id: "rl-policy-gradient-q6",
                  question: "For a Gaussian policy with θ = 2.0, σ = 0.3, state s = 0.5 (so μ = θ·s = 1.0), and sampled action a = 0.7, what is ∇θ log π(a|s)?",
                  options: [
                    { id: "rl-policy-gradient-q6-a", text: "(a − μ) · s / σ² = (0.7 − 1.0) · 0.5 / 0.09 = −1.67" },
                    { id: "rl-policy-gradient-q6-b", text: "(a − μ)² / σ² = 0.09 / 0.09 = 1.0" },
                    { id: "rl-policy-gradient-q6-c", text: "log(a/μ) = log(0.7) = −0.36" },
                    { id: "rl-policy-gradient-q6-d", text: "(μ − a) · s / σ² = +1.67" },
                  ],
                  correctOptionId: "rl-policy-gradient-q6-a",
                  explanation:
                    "log π(a|s) = −(a−μ)²/(2σ²) + const. ∂μ/∂θ = s = 0.5. ∇θ log π = (a−μ)/σ² · ∂μ/∂θ = (0.7−1.0)/0.09 · 0.5 = −3.33 · 0.5 = −1.67. The negative sign means: the action was below μ, so increasing θ (which increases μ) would move μ away from the action. If this action was good (positive Â), the gradient −1.67 × Â < 0 pushes θ down, bringing μ toward 0.7.",
                },
              ],
            },
            {
              type: "practice",
              title: "Guided: REINFORCE Variance Analysis on Forex Data",
              description:
                "Using the REINFORCE+Baseline code above, run the following experiment to understand variance reduction:\n\n1. Train REINFORCE without baseline (set baseline output to always 0) for 200 episodes. Record the policy gradient norm at each episode.\n2. Train REINFORCE with the learned V(s) baseline for 200 episodes. Record gradient norms.\n3. Compare: (a) mean and std of gradient norms, (b) coefficient of variation, (c) convergence speed (episodes to reach equity > 1.01).\n4. Try a third variant: REINFORCE with a constant baseline b = mean(all returns seen so far) instead of learned V(s). How does it compare?\n\nExpected insight: Learned V(s) reduces gradient variance by 3-10× compared to no baseline. The constant baseline helps but is suboptimal because it doesn't capture state-dependent expected returns.",
              catalogModelId: "ppo-position-sizing",
            },
            {
              type: "practice",
              title: "Open-Ended: Natural Policy Gradient Implementation",
              description:
                "Implement the natural policy gradient for a linear Gaussian policy π(a|s) = 𝒩(θᵀs, σ²) on a simplified forex position sizing task.\n\n1. Compute the Fisher Information Matrix F(θ) = 𝔼[∇θ log π · (∇θ log π)ᵀ] empirically from trajectory samples.\n2. Compute the natural gradient: F⁻¹ ∇θJ using numpy.linalg.solve.\n3. Compare convergence of standard gradient descent vs natural gradient: track the per-episode reward and the KL divergence between consecutive policies KL(π_old ‖ π_new).\n4. Verify that natural gradient produces approximately constant KL steps (trust region property), while standard gradient produces variable KL steps.\n\nThis exercise builds intuition for why TRPO and PPO were developed — they approximate the natural gradient's trust region property with less computational overhead.",
              catalogModelId: "ppo-position-sizing",
            },
          ],
        },
        // ── Lesson 3: Actor-Critic & PPO for Trading ────────────
        {
          id: "rl-a2c-ppo",
          title: "Actor-Critic & PPO for Trading",
          description:
            "Deep-dive into actor-critic architectures, the advantage function, A2C synchronous training, and PPO's clipped surrogate objective — the default algorithm for continuous-action trading agents.",
          estimatedMinutes: 55,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Understand the actor-critic architecture, derive the advantage function A(s,a) = Q(s,a) − V(s), implement A2C and PPO with clipped surrogate objectives, and train a PPO agent for continuous forex position sizing.",
              keyTakeaways: [
                "Actor-critic separates policy π(a|s;θ) (actor) from value V(s;φ) (critic) for variance reduction",
                "Advantage A(s,a) = Q(s,a) − V(s) measures how much better action a is vs the average — lower variance than raw returns",
                "A2C: synchronous advantage actor-critic with parallel environment rollouts",
                "PPO clips the probability ratio rₜ(θ) = π_θ(a|s) / π_θ_old(a|s) to [1−ε, 1+ε], preventing destructive updates",
                "PPO is the default for continuous trading actions because of its stability, sample efficiency, and ease of tuning",
                "GAE (Generalized Advantage Estimation) interpolates between TD and Monte Carlo via λ ∈ [0,1]",
                "Trust region methods (TRPO → PPO) prevent catastrophic policy updates in noisy financial environments",
                "Shared backbone architecture learns efficient representations used by both actor and critic heads",
              ],
            },
            {
              type: "theory",
              title: "Advantage Functions: Deriving A(s,a) = Q(s,a) − V(s)",
              content:
                "**The Variance Problem in REINFORCE.** Vanilla policy gradient ∇θ J(θ) = 𝔼π[∇θ log π(aₜ|sₜ;θ) · Gₜ] uses Monte Carlo returns Gₜ = ∑ₖ γᵏ rₜ₊ₖ. These returns have extremely high variance because they depend on the entire future trajectory. In a 100-step forex episode, Gₜ accumulates noise from 100 random price movements. If two episodes differ only in step 50 onward (pure noise), their returns Gₜ at step 1 are completely different, yet the policy gradient treats them as different signals for the same state-action pair.\n\n**The Advantage Function Derivation.** We want to reduce variance without introducing bias. The key insight: decompose the Q-function as Q(s,a) = V(s) + A(s,a), where V(s) = 𝔼π[Q(s,a)] is the expected value of state s under the current policy, and A(s,a) = Q(s,a) − V(s) is the advantage — how much better action a is than the average action in state s. When we use A(s,a) instead of Gₜ in the policy gradient, we remove the state-dependent baseline V(s), which is large and noisy but constant across actions. This dramatically reduces variance because we only care about the relative quality of actions, not the absolute value of being in state s.\n\n**Formal Proof of Bias-Invariance.** The policy gradient theorem: ∇θ J(θ) = 𝔼π[∇θ log π(aₜ|sₜ;θ) · Q^π(sₜ,aₜ)]. Subtracting any state-dependent baseline b(s) does not change the expectation: 𝔼π[∇θ log π(aₜ|sₜ;θ) · b(sₜ)] = ∑ₐ π(a|s)·∇θ log π(a|s)·b(s) = b(s)·∇θ ∑ₐ π(a|s) = b(s)·∇θ 1 = 0. Therefore, using Âₜ = Qₜ − V(sₜ) produces the same gradient in expectation but with lower variance. The optimal baseline (minimizing variance) is V(s) — proven by Greensmith et al. 2004.\n\n**Numerical Example.** State s₁ = 'high volatility market', actions = {buy, hold, sell}. Q(s₁, buy) = 0.8, Q(s₁, hold) = 0.5, Q(s₁, sell) = 0.3. V(s₁) = (0.8 + 0.5 + 0.3)/3 = 0.533. Advantages: A(s₁, buy) = 0.8 − 0.533 = +0.267, A(s₁, hold) = 0.5 − 0.533 = −0.033, A(s₁, sell) = 0.3 − 0.533 = −0.233. If we observe (s₁, buy, r=0.02, s₂), the policy gradient signal is proportional to A(s₁, buy) = +0.267, not Q(s₁, buy) = 0.8. The advantage correctly signals 'buy is good' while removing the state-dependent component that all actions share.",
            },
            {
              type: "theory",
              title: "Generalized Advantage Estimation (GAE): λ-Return Derivation",
              content:
                "**The Bias-Variance Tradeoff in Advantage Estimation.** We can estimate A(sₜ, aₜ) in multiple ways: (1) 1-step TD: Â⁽¹⁾ₜ = δₜ = rₜ + γV(sₜ₊₁) − V(sₜ) (low variance, high bias because V is learned). (2) Monte Carlo: Â⁽∞⁾ₜ = Gₜ − V(sₜ) = ∑ₖ γᵏ rₜ₊ₖ − V(sₜ) (unbiased, high variance). (3) n-step TD: Â⁽ⁿ⁾ₜ = ∑ₖ₌₀ⁿ⁻¹ γᵏ rₜ₊ₖ + γⁿ V(sₜ₊ₙ) − V(sₜ) (intermediate). GAE (Schulman et al., 2016) interpolates between these estimators using an exponentially-weighted average controlled by λ ∈ [0,1].\n\n**GAE Derivation from First Principles.** Define the k-step advantage: Âₜ⁽ᵏ⁾ = ∑ⱼ₌₀ᵏ⁻¹ γʲ rₜ₊ⱼ + γᵏ V(sₜ₊ₖ) − V(sₜ). GAE is the λ-weighted average: Âₜ^GAE(λ) = (1−λ) ∑ₖ₌₁∞ λᵏ⁻¹ Âₜ⁽ᵏ⁾. Expanding: Âₜ^GAE = (1−λ)[λ⁰ Âₜ⁽¹⁾ + λ¹ Âₜ⁽²⁾ + λ² Âₜ⁽³⁾ + ...]. But Âₜ⁽ᵏ⁾ can be written recursively using the TD error δₜ = rₜ + γV(sₜ₊₁) − V(sₜ): Âₜ⁽¹⁾ = δₜ, Âₜ⁽²⁾ = δₜ + γδₜ₊₁, Âₜ⁽³⁾ = δₜ + γδₜ₊₁ + γ²δₜ₊₂, etc. Substituting and simplifying: Âₜ^GAE = ∑ₗ₌₀∞ (γλ)ˡ δₜ₊ₗ. This is the GAE formula — a geometric series of TD errors with decay rate γλ.\n\n**Interpretation of λ.** λ=0: Âₜ = δₜ (pure 1-step TD, maximum bias reduction from V, lowest variance). λ=1: Âₜ = ∑ₗ γˡ δₜ₊ₗ = Gₜ − V(sₜ) (Monte Carlo, no bias from V, highest variance). λ=0.95 (typical): exponentially decay TD errors with half-life ≈ 14 steps. This balances bias and variance — early rewards (low bias) get high weight, distant rewards (high variance) get exponentially decaying weight.\n\n**Concrete Numerical Example.** Episode with 5 steps, rewards r = [0.01, −0.02, 0.03, 0.04, 0.00], γ = 0.99, λ = 0.95. Value estimates V = [0.05, 0.04, 0.06, 0.03, 0.00]. TD errors: δ₀ = 0.01 + 0.99×0.04 − 0.05 = 0.0096, δ₁ = −0.02 + 0.99×0.06 − 0.04 = 0.0094, δ₂ = 0.03 + 0.99×0.03 − 0.06 = −0.0003, δ₃ = 0.04 + 0.99×0.00 − 0.03 = 0.01, δ₄ = 0.00. GAE at t=0: Â₀ = δ₀ + (0.99×0.95)δ₁ + (0.99×0.95)²δ₂ + (0.99×0.95)³δ₃ = 0.0096 + 0.9405×0.0094 + 0.8845×(−0.0003) + 0.8318×0.01 = 0.0096 + 0.0088 − 0.0003 + 0.0083 = 0.0264. This single number Â₀ = 0.0264 is used to update the policy for action a₀ — much more stable than the raw return G₀ = 0.01 + 0.99×(−0.02) + ... = 0.052.",
            },
            {
              type: "theory",
              title: "PPO Clipped Surrogate Objective: Full Derivation & Trust Regions",
              content:
                "**From TRPO to PPO: Trust Region Motivation.** Policy gradient methods can take arbitrarily large steps in parameter space θ, causing catastrophic performance collapses. Trust Region Policy Optimization (TRPO, Schulman 2015) constrains each update to a 'trust region' where the policy change is small: maximize 𝔼[π_θ(a|s)/π_θ_old(a|s) · Â(s,a)] subject to 𝔼[KL(π_θ_old || π_θ)] ≤ δ. The KL divergence constraint ensures the new policy π_θ is close to the old policy π_θ_old in distribution space. TRPO solves this constrained optimization using conjugate gradients and line search — computationally expensive and hard to implement correctly.\n\n**PPO-Clip: A First-Order Approximation to TRPO.** Proximal Policy Optimization (PPO, Schulman 2017) replaces the hard KL constraint with a soft clipping penalty directly in the objective. Define the probability ratio rₜ(θ) = π_θ(aₜ|sₜ) / π_θ_old(aₜ|sₜ). The unconstrained surrogate objective is L^CPI = 𝔼[rₜ(θ) Âₜ] (Conservative Policy Iteration). PPO clips rₜ to [1−ε, 1+ε]: L^CLIP(θ) = 𝔼[min(rₜ(θ)Âₜ, clip(rₜ(θ), 1−ε, 1+ε)Âₜ)].\n\n**Derivation of the Clipping Behavior.** Case 1: Âₜ > 0 (good action, we want to increase its probability). If rₜ > 1, the new policy already assigns higher probability than the old policy. If rₜ > 1+ε, the clipping activates: min(rₜÂₜ, (1+ε)Âₜ) = (1+ε)Âₜ (constant w.r.t. θ). Gradient: ∂L/∂θ ∝ Âₜ · ∂clip(rₜ, 1−ε, 1+ε)/∂θ = 0. The policy stops increasing this action's probability — the trust region boundary is reached. Case 2: Âₜ < 0 (bad action, we want to decrease its probability). If rₜ < 1, the new policy already assigns lower probability. If rₜ < 1−ε, clipping activates: min(rₜÂₜ, (1−ε)Âₜ) = (1−ε)Âₜ. Again, gradient vanishes. The policy won't decrease this action's probability further in a single update.\n\n**Numerical Example.** State s, action a, advantage Â = +0.5 (good action). Old policy: π_old(a|s) = 0.2. New policy (after gradient step): π_θ(a|s) = 0.30. Ratio: r = 0.30/0.20 = 1.5. With ε = 0.2: clip(1.5, 0.8, 1.2) = 1.2. Objective contributions: unconstrained = 1.5 × 0.5 = 0.75, clipped = 1.2 × 0.5 = 0.6. PPO uses min(0.75, 0.6) = 0.6. The clipping reduces the gradient signal, preventing the policy from jumping to π(a|s) = 0.40 or higher in a single update. Over multiple updates (PPO uses K=4-10 epochs per batch), the policy gradually increases π(a|s) while staying within the trust region each step.\n\n**Why Clipping Works for Trading.** Financial rewards are extremely noisy. A single lucky trade (e.g., buying right before an unexpected rate cut) might produce Â = +5.0 if the agent happened to be long. Without clipping, the policy would dramatically increase the probability of that state-action pair based on one sample — overfitting. PPO's clipping ensures the policy can't overreact: even with Â = +5.0, the ratio is clamped at 1.2, so the probability increase is modest (≈20% per update). After K=4 epochs: max increase ≈ (1.2)⁴ = 2.07x. This prevents the catastrophic 'all-in on every signal' behavior that destroys value-based methods in noisy forex markets.",
            },
            {
              type: "theory",
              title: "A2C Architecture & PPO Training Mechanics",
              content:
                "**A2C: Synchronous Advantage Actor-Critic.** A2C (Mnih et al., 2016) parallelizes REINFORCE with baselines. Run N environment copies simultaneously (N=8 to 32 for trading). Each environment executes the current policy π_θ for T steps (T=128 to 2048), collecting trajectories {(sₜ, aₜ, rₜ, sₜ₊₁)}. Compute advantages Âₜ using GAE. Update actor and critic simultaneously: ∇θ L_actor = −𝔼[Âₜ ∇θ log π(aₜ|sₜ;θ)], ∇φ L_critic = 𝔼[(V(sₜ;φ) − Gₜ)² ∇φ V(sₜ;φ)]. The entropy bonus −β𝔼[H[π(·|sₜ;θ)]] encourages exploration by penalizing deterministic policies (β ≈ 0.01). All N workers synchronize at each update — no asynchrony (unlike A3C).\n\n**PPO Training Loop: Reusing Rollouts.** PPO improves sample efficiency by reusing each rollout for K epochs (K=4 to 10). (1) Collect T×N transitions using current policy π_θ_old. (2) Compute GAE advantages Âₜ for all transitions. (3) For K epochs: shuffle transitions into mini-batches (batch size B=64), compute new policy π_θ and value V_φ, compute clipped objective L^CLIP + value loss + entropy. (4) Update θ and φ via SGD. (5) Set θ_old ← θ, repeat. This is on-policy learning with multiple passes — the clipping ensures the new policy doesn't diverge too far from the data-generating policy π_θ_old, keeping updates valid.\n\n**Shared Backbone Architecture for Trading.** The actor and critic share early layers to learn efficient state representations. State input s ∈ ℝᵈ (e.g., 20-50 technical features) → shared backbone: [Linear(d, 256), ReLU, Linear(256, 128), ReLU]. This 128-dim representation h is used by both heads: (a) Actor head: h → [Linear(128, 64), ReLU, Linear(64, |A|)] → policy logits π(a|s;θ). For continuous actions (forex position sizing), output μ(s) and log σ(s) for a Gaussian: π(a|s) = 𝒩(a; μ(s), σ²(s)). (b) Critic head: h → [Linear(128, 64), ReLU, Linear(64, 1)] → value V(s;φ). Shared layers capture common features (volatility regimes, trend strength), while separate heads specialize.\n\n**Value Function Loss.** The critic is trained to predict returns: L_value = 𝔼[(V(sₜ;φ) − Gₜ)²], where Gₜ = Âₜ + V(sₜ) (reconstructed from advantages). PPO adds value clipping (optional): clip the value update to [V_old(s) − ε_v, V_old(s) + ε_v] to prevent large value jumps. The total PPO loss: L = L^CLIP − c₁ L_value − c₂ H, where c₁ ≈ 0.5 (value weight), c₂ ≈ 0.01 (entropy weight).\n\n**Hyperparameters for Forex Position Sizing.** Batch size T=2048 steps (≈8 trading days at 256 steps/day), N=8 parallel environments, K=4 epochs, mini-batch B=64, γ=0.99, λ=0.95, ε=0.2, learning rate 3e-4 with linear decay to 0. Gradient clipping: max norm 0.5. These settings balance sample efficiency (reusing data for K epochs), stability (clipping prevents large updates), and exploration (entropy bonus prevents premature convergence to suboptimal deterministic policies).",
            },
            {
              type: "intuition",
              title: "The Coach and Player Dynamic",
              analogy:
                "Think of the actor as a football player making real-time decisions on the field, and the critic as the coach watching from the sideline with full game statistics. The player (actor) decides whether to pass, shoot, or dribble. After each play, the coach (critic) says 'that pass was +3 advantage over your average play in that situation' or 'that shot was −2 below average.' The player adjusts strategy based on these advantage signals. PPO adds a crucial rule: 'no matter what the coach says, you can't change your playbook by more than 20% between games.' This prevents the player from overreacting to one great play (overfitting to a lucky trade) or one terrible play (panic-selling after a drawdown).",
              content:
                "A2C is like having multiple players on different fields simultaneously (parallel envs), all reporting back to the same coach for a synchronized strategy update. PPO's clipping is essential for trading because financial environments are noisy — a single profitable trajectory might be luck, and without the trust region, the agent would lurch toward that strategy and blow up when conditions change.",
              emoji: "🏈",
            },
            {
              type: "intuition",
              title: "GAE as Exponential Evidence Decay",
              analogy:
                "Imagine you're a detective investigating whether a suspect committed a crime. You have evidence from the crime scene (time t), witness statements from 1 hour later (t+1), security footage from 2 hours later (t+2), and so on. Each piece of evidence δₜ₊ₗ has some signal about the suspect's guilt, but distant evidence is less reliable (more contaminated by other events). GAE with λ=0.95 is like weighting the crime scene evidence at 100%, the 1-hour witness at 95%, the 2-hour footage at 90%, etc. — exponentially decaying trust. You don't ignore distant evidence (λ≠0), but you don't trust it as much as immediate observations. This prevents one noisy future event from dominating your conclusion about the present action.",
              content:
                "In trading, if you observe a buy action at time t followed by a +0.01 reward (immediate market move), then +0.05 two steps later (trend continuation), then −0.20 ten steps later (sudden reversal), GAE downweights the distant reversal (γλ)¹⁰ ≈ 0.63 while giving full weight to the immediate +0.01. This prevents blaming the buy action for a reversal that occurred due to unrelated news 10 steps later. Pure Monte Carlo (λ=1) would fully attribute the distant reversal to the current action — high variance. Pure TD (λ=0) ignores everything beyond the immediate reward — high bias from errors in V.",
              emoji: "🔍",
            },
            {
              type: "code",
              title: "PyTorch PPO Agent for Forex Position Sizing",
              language: "python",
              code: `import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.distributions import Normal

class ForexTradingEnv:
    """Simplified forex environment with continuous position sizing."""
    def __init__(self, returns: np.ndarray, window: int = 20):
        self.returns = returns
        self.window = window
        self.reset()

    def reset(self):
        self.t = self.window
        self.position = 0.0
        self.equity = 1.0
        return self._get_state()

    def _get_state(self) -> np.ndarray:
        window_ret = self.returns[self.t - self.window : self.t]
        mu, sigma = window_ret.mean(), window_ret.std() + 1e-8
        features = np.array([
            mu / sigma,                     # rolling Sharpe
            sigma * np.sqrt(252),           # annualized vol
            window_ret[-1] / sigma,         # normalized last return
            self.position,                  # current position
            self.equity - 1.0,              # cumulative P&L
        ], dtype=np.float32)
        return features

    def step(self, action: float):
        action = np.clip(action, -1.0, 1.0)
        pnl = action * self.returns[self.t]
        cost = 0.0002 * abs(action - self.position)  # transaction cost
        reward = pnl - cost
        self.equity += reward
        self.position = action
        self.t += 1
        done = self.t >= len(self.returns) - 1
        return self._get_state(), reward, done

class PPOActorCritic(nn.Module):
    """Shared-backbone actor-critic for continuous actions."""
    def __init__(self, state_dim: int = 5, hidden: int = 64):
        super().__init__()
        self.shared = nn.Sequential(
            nn.Linear(state_dim, hidden), nn.Tanh(),
            nn.Linear(hidden, hidden), nn.Tanh(),
        )
        self.mu_head = nn.Linear(hidden, 1)      # policy mean
        self.log_std = nn.Parameter(torch.zeros(1))  # learnable log σ
        self.value_head = nn.Linear(hidden, 1)    # critic V(s)

    def forward(self, x):
        h = self.shared(x)
        mu = torch.tanh(self.mu_head(h))          # position ∈ [-1, 1]
        std = self.log_std.exp().expand_as(mu)
        value = self.value_head(h)
        return mu, std, value

    def act(self, state: np.ndarray):
        x = torch.tensor(state, dtype=torch.float32).unsqueeze(0)
        mu, std, val = self.forward(x)
        dist = Normal(mu, std)
        action = dist.sample().clamp(-1, 1)
        return action.item(), dist.log_prob(action).item(), val.item()

def ppo_update(model, optimizer, states, actions, old_log_probs,
               returns, advantages, clip_eps=0.2, epochs=4):
    """PPO clipped surrogate update with value loss and entropy bonus."""
    st = torch.tensor(np.array(states), dtype=torch.float32)
    at = torch.tensor(np.array(actions), dtype=torch.float32).unsqueeze(1)
    old_lp = torch.tensor(np.array(old_log_probs), dtype=torch.float32)
    ret = torch.tensor(np.array(returns), dtype=torch.float32)
    adv = torch.tensor(np.array(advantages), dtype=torch.float32)
    adv = (adv - adv.mean()) / (adv.std() + 1e-8)

    for _ in range(epochs):
        mu, std, values = model(st)
        dist = Normal(mu, std)
        new_lp = dist.log_prob(at).squeeze()
        ratio = (new_lp - old_lp).exp()          # rₜ(θ) = π_new / π_old

        # PPO clipped objective
        surr1 = ratio * adv
        surr2 = ratio.clamp(1 - clip_eps, 1 + clip_eps) * adv
        policy_loss = -torch.min(surr1, surr2).mean()
        value_loss = 0.5 * (values.squeeze() - ret).pow(2).mean()
        entropy = dist.entropy().mean()

        loss = policy_loss + 0.5 * value_loss - 0.01 * entropy
        optimizer.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 0.5)
        optimizer.step()

# ── Training loop ────────────────────────────────────────────
np.random.seed(42)
sim_returns = np.random.normal(0.0001, 0.008, size=5000)  # simulated daily
env = ForexTradingEnv(sim_returns, window=20)
model = PPOActorCritic(state_dim=5, hidden=64)
optimizer = optim.Adam(model.parameters(), lr=3e-4)

for episode in range(50):
    state = env.reset()
    states, actions, log_probs, rewards, values = [], [], [], [], []
    while True:
        action, lp, val = model.act(state)
        next_state, reward, done = env.step(action)
        states.append(state); actions.append(action)
        log_probs.append(lp); rewards.append(reward); values.append(val)
        state = next_state
        if done: break

    # Compute returns & GAE advantages (γ=0.99, λ=0.95)
    gamma, lam = 0.99, 0.95
    advs, gae = [], 0.0
    for t in reversed(range(len(rewards))):
        nv = values[t + 1] if t + 1 < len(values) else 0.0
        delta = rewards[t] + gamma * nv - values[t]
        gae = delta + gamma * lam * gae
        advs.insert(0, gae)
    rets = [a + v for a, v in zip(advs, values)]

    ppo_update(model, optimizer, states, actions, log_probs, rets, advs)
    if (episode + 1) % 10 == 0:
        print(f"Episode {episode+1:3d} | Equity: {env.equity:.4f} | "
              f"Avg pos: {np.mean(np.abs(actions)):.3f}")`,
              explanation:
                "A complete PPO pipeline for forex: (1) ForexTradingEnv provides a 5-feature state and continuous position sizing. (2) PPOActorCritic shares a backbone between the Gaussian policy head (μ, σ) and value head V(s). (3) ppo_update computes the clipped surrogate loss min(rₜÂₜ, clip(rₜ)Âₜ) with value loss and entropy bonus. (4) GAE computes advantages with bias-variance tradeoff controlled by λ. The agent learns to size positions based on rolling statistics.",
            },
            {
              type: "code",
              title: "Multi-Asset PPO with Parallel Environments",
              language: "python",
              code: `import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.distributions import Normal
from typing import List, Tuple

class MultiEnvWrapper:
    """Vectorized environment wrapper for A2C-style parallel rollouts."""
    def __init__(self, returns_data: List[np.ndarray], n_envs: int = 8):
        self.n_envs = n_envs
        self.envs = [ForexTradingEnv(returns_data[i % len(returns_data)])
                     for i in range(n_envs)]
        
    def reset(self) -> np.ndarray:
        return np.array([env.reset() for env in self.envs])
    
    def step(self, actions: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        states, rewards, dones = [], [], []
        for i, (env, action) in enumerate(zip(self.envs, actions)):
            s, r, d = env.step(action)
            if d:
                s = env.reset()
            states.append(s)
            rewards.append(r)
            dones.append(d)
        return np.array(states), np.array(rewards), np.array(dones)

def compute_gae(rewards: List[float], values: List[float], dones: List[bool],
                gamma: float = 0.99, lam: float = 0.95) -> Tuple[List[float], List[float]]:
    """Compute GAE advantages and returns."""
    advantages = []
    gae = 0.0
    for t in reversed(range(len(rewards))):
        next_value = values[t + 1] if t + 1 < len(values) else 0.0
        next_value = next_value * (1 - dones[t])  # zero out terminal states
        delta = rewards[t] + gamma * next_value - values[t]
        gae = delta + gamma * lam * gae * (1 - dones[t])
        advantages.insert(0, gae)
    returns = [adv + val for adv, val in zip(advantages, values)]
    return advantages, returns

# ── Train PPO with 8 parallel EUR/USD environments ──────────
np.random.seed(42)
# Simulate 8 different EUR/USD return series (e.g., different years)
returns_data = [np.random.normal(0.0001, 0.008, size=5000) for _ in range(8)]
multi_env = MultiEnvWrapper(returns_data, n_envs=8)
model = PPOActorCritic(state_dim=5, hidden=128)
optimizer = optim.Adam(model.parameters(), lr=3e-4)

n_steps = 256  # rollout length per env
n_updates = 100

for update in range(n_updates):
    # Collect rollouts from all 8 envs
    states_batch, actions_batch, log_probs_batch = [], [], []
    rewards_batch, values_batch, dones_batch = [], [], []
    
    state = multi_env.reset()
    for step in range(n_steps):
        with torch.no_grad():
            action_batch, lp_batch, val_batch = [], [], []
            for s in state:
                a, lp, v = model.act(s)
                action_batch.append(a)
                log_probs_batch.append(lp)
                values_batch.append(v)
        
        next_state, reward, done = multi_env.step(np.array(action_batch))
        states_batch.extend(state)
        actions_batch.extend(action_batch)
        rewards_batch.extend(reward)
        dones_batch.extend(done)
        state = next_state
    
    # Compute advantages across all envs
    advantages, returns = compute_gae(rewards_batch, values_batch, dones_batch)
    
    # PPO update
    ppo_update(model, optimizer, states_batch, actions_batch, 
               log_probs_batch, returns, advantages, clip_eps=0.2, epochs=4)
    
    if (update + 1) % 10 == 0:
        avg_return = np.mean(returns)
        print(f"Update {update+1:3d} | Avg Return: {avg_return:+.6f}")`,
              explanation:
                "Multi-environment training accelerates PPO by collecting 8×256 = 2048 transitions per update. MultiEnvWrapper runs 8 ForexTradingEnv instances in parallel, resetting finished episodes automatically. compute_gae handles terminal states correctly (zeroing next_value when done=True). This matches the A2C synchronous architecture — all envs step together, then a single policy update uses all collected data. For real forex, each env could represent a different currency pair (EUR/USD, GBP/USD, USD/JPY, etc.) to learn a universal position-sizing policy.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-a2c-ppo-q1",
                  question: "Why does the advantage function A(s,a) = Q(s,a) − V(s) reduce variance compared to using raw returns Gₜ?",
                  options: [
                    { id: "rl-a2c-ppo-q1-a", text: "It removes the common value V(s) that doesn't depend on the action, isolating action-specific signal from state-dependent noise" },
                    { id: "rl-a2c-ppo-q1-b", text: "It normalizes rewards to zero mean automatically" },
                    { id: "rl-a2c-ppo-q1-c", text: "It uses a larger batch size for estimation" },
                    { id: "rl-a2c-ppo-q1-d", text: "It replaces stochastic sampling with deterministic evaluation" },
                  ],
                  correctOptionId: "rl-a2c-ppo-q1-a",
                  explanation:
                    "Raw returns Gₜ include the baseline value of being in state s (which can be large and noisy) plus the action-specific effect. Subtracting V(s) removes this state-dependent component, leaving only how much better or worse the specific action was — a much lower-variance signal for policy updates.",
                },
                {
                  id: "rl-a2c-ppo-q2",
                  question: "In PPO, what happens when the policy ratio rₜ = π_new/π_old exceeds 1+ε for a positive advantage?",
                  options: [
                    { id: "rl-a2c-ppo-q2-a", text: "The loss becomes negative infinity, forcing a reset" },
                    { id: "rl-a2c-ppo-q2-b", text: "The gradient is clipped to zero for that sample — the policy can't increase this action's probability further" },
                    { id: "rl-a2c-ppo-q2-c", text: "The advantage is recalculated using a target network" },
                    { id: "rl-a2c-ppo-q2-d", text: "The learning rate is automatically reduced" },
                  ],
                  correctOptionId: "rl-a2c-ppo-q2-b",
                  explanation:
                    "When Â > 0 and rₜ > 1+ε, min() selects the clipped term (1+ε)Â, which is constant w.r.t. θ. The gradient vanishes for this sample, preventing the policy from moving further in that direction. This is PPO's core stability mechanism — a soft trust region.",
                },
                {
                  id: "rl-a2c-ppo-q3",
                  question: "Why is PPO preferred over A2C for trading environments?",
                  options: [
                    { id: "rl-a2c-ppo-q3-a", text: "PPO uses a simpler neural network architecture" },
                    { id: "rl-a2c-ppo-q3-b", text: "PPO can reuse rollout data for multiple update epochs and has clipping that prevents catastrophic updates from noisy financial rewards" },
                    { id: "rl-a2c-ppo-q3-c", text: "A2C cannot handle continuous action spaces" },
                    { id: "rl-a2c-ppo-q3-d", text: "PPO converges in fewer environment interactions" },
                  ],
                  correctOptionId: "rl-a2c-ppo-q3-b",
                  explanation:
                    "Financial rewards are noisy and non-stationary. A2C uses each rollout for a single gradient step, wasting data. PPO reuses the same rollout for K epochs of mini-batch updates (sample efficient) while the clipping constraint prevents the policy from overfitting to noisy reward signals — crucial when a single lucky trade could otherwise destabilize the entire strategy.",
                },
                {
                  id: "rl-a2c-ppo-q4",
                  question: "In GAE with λ=0.95 and γ=0.99, what is the effective half-life (in steps) of the advantage estimate?",
                  options: [
                    { id: "rl-a2c-ppo-q4-a", text: "Approximately 3 steps" },
                    { id: "rl-a2c-ppo-q4-b", text: "Approximately 14 steps" },
                    { id: "rl-a2c-ppo-q4-c", text: "Approximately 50 steps" },
                    { id: "rl-a2c-ppo-q4-d", text: "Infinite (no decay)" },
                  ],
                  correctOptionId: "rl-a2c-ppo-q4-b",
                  explanation:
                    "The GAE weights decay as (γλ)ᵗ = (0.99 × 0.95)ᵗ = 0.9405ᵗ. The half-life is when 0.9405ᵗ = 0.5, which gives t ≈ ln(0.5)/ln(0.9405) ≈ 14 steps. This means rewards 14 steps in the future contribute only half as much to the current advantage estimate as the immediate reward. This balances between TD (λ=0, immediate only) and MC (λ=1, infinite horizon).",
                },
                {
                  id: "rl-a2c-ppo-q5",
                  question: "Why does PPO use multiple epochs (K=4-10) of mini-batch updates per rollout?",
                  options: [
                    { id: "rl-a2c-ppo-q5-a", text: "To reduce overfitting to the training data" },
                    { id: "rl-a2c-ppo-q5-b", text: "To improve sample efficiency by reusing expensive environment interactions while the clipping prevents policy divergence" },
                    { id: "rl-a2c-ppo-q5-c", text: "To ensure the critic converges before the actor" },
                    { id: "rl-a2c-ppo-q5-d", text: "To satisfy the on-policy requirement" },
                  ],
                  correctOptionId: "rl-a2c-ppo-q5-b",
                  explanation:
                    "Environment interactions (real forex trades or market simulations) are expensive. A2C uses each rollout only once (wasteful). PPO reuses the same data for K epochs of SGD, extracting more learning from each interaction. The clipping constraint ensures that even after K epochs, the new policy π_θ hasn't diverged far from the data-generating policy π_θ_old, so the updates remain approximately on-policy and valid.",
                },
                {
                  id: "rl-a2c-ppo-q6",
                  question: "What is the purpose of the entropy bonus −β H[π(·|s)] in the PPO loss?",
                  options: [
                    { id: "rl-a2c-ppo-q6-a", text: "To encourage exploration by penalizing overly deterministic policies" },
                    { id: "rl-a2c-ppo-q6-b", text: "To reduce the computational cost of the policy network" },
                    { id: "rl-a2c-ppo-q6-c", text: "To stabilize the value function estimates" },
                    { id: "rl-a2c-ppo-q6-d", text: "To ensure the policy is Gaussian" },
                  ],
                  correctOptionId: "rl-a2c-ppo-q6-a",
                  explanation:
                    "Entropy H = −∑ₐ π(a|s) log π(a|s) measures the randomness of the policy. High entropy = uniform distribution (maximum exploration), low entropy = deterministic (no exploration). Subtracting β·H from the loss penalizes low-entropy policies, encouraging the agent to maintain stochasticity and continue exploring. For trading, this prevents premature convergence to a deterministic strategy that might be locally optimal but misses better alternatives. Typical β = 0.01.",
                },
                {
                  id: "rl-a2c-ppo-q7",
                  question: "How does the shared backbone architecture benefit actor-critic training?",
                  options: [
                    { id: "rl-a2c-ppo-q7-a", text: "It reduces the number of parameters, speeding up training" },
                    { id: "rl-a2c-ppo-q7-b", text: "It allows the actor and critic to learn complementary state representations, with the critic's value gradients improving the shared features" },
                    { id: "rl-a2c-ppo-q7-c", text: "It ensures the actor and critic always agree on action values" },
                    { id: "rl-a2c-ppo-q7-d", text: "It eliminates the need for experience replay" },
                  ],
                  correctOptionId: "rl-a2c-ppo-q7-b",
                  explanation:
                    "The shared backbone learns a representation h(s) that is useful for both policy selection (actor) and value prediction (critic). The critic's gradient signal (value loss) provides an auxiliary learning objective that helps the shared layers learn better features. For trading, the shared layers might learn to detect volatility regimes, trends, or mean-reversion patterns — features useful for both 'which action to take' (actor) and 'what is the expected return' (critic). This is more sample-efficient than training two separate networks.",
                },
              ],
            },
            {
              type: "practice",
              title: "PPO Agent on Historical EUR/USD",
              description:
                "Train the PPO agent on 2 years of historical EUR/USD daily returns with the full 5-feature state. Compare position sizing behavior across different clip_eps values (0.1, 0.2, 0.3) and entropy coefficients (0.001, 0.01, 0.05). Evaluate on 6 months of out-of-sample data and report Sharpe ratio, max drawdown, and average position size.",
              catalogModelId: "ppo-position-sizing",
            },
            {
              type: "practice",
              title: "GAE Hyperparameter Sensitivity Analysis",
              description:
                "Implement a grid search over λ ∈ {0, 0.5, 0.9, 0.95, 0.99, 1.0} and γ ∈ {0.9, 0.95, 0.99}. For each configuration, train a PPO agent on synthetic forex data for 100 episodes. Plot learning curves (cumulative return vs episode) and measure final policy Sharpe ratio. Analyze: which λ gives fastest convergence? Which gives highest final Sharpe? What is the bias-variance tradeoff empirically observed?",
              catalogModelId: "ppo-position-sizing",
            },
          ],
        },
        // ── Lesson 4: Reward Engineering for Financial RL ────────
        {
          id: "rl-reward-shaping",
          title: "Reward Engineering for Financial RL",
          description:
            "Design reward functions that align agent behavior with trading objectives — from raw P&L to differential Sharpe ratios, Sortino-based rewards, and drawdown penalties. Understand reward hacking and potential-based reward shaping.",
          estimatedMinutes: 50,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Master reward engineering for financial RL agents — implement multiple reward functions (raw PnL, differential Sharpe, Sortino, drawdown-penalized), understand reward shaping theory, and diagnose reward hacking pitfalls.",
              keyTakeaways: [
                "Reward design is the most impactful decision in financial RL — it defines what 'good trading' means to the agent",
                "Raw P&L rewards are sparse and noisy; differential Sharpe ratio provides a dense, risk-adjusted signal",
                "Potential-based reward shaping (PBRS) preserves the optimal policy: F(s,s′) = γΦ(s′) − Φ(s)",
                "Reward hacking: agents exploit loopholes (e.g., high-frequency churning for transaction-cost rebates)",
                "Multi-objective rewards combine profit, risk, and cost with careful weighting to avoid Goodhart's Law",
                "Sortino ratio penalizes only downside volatility, aligning with trader risk preferences",
                "Differential Sharpe (Moody & Saffell 1998) approximates marginal contribution to overall Sharpe ratio",
                "Reward clipping and normalization are essential for stable training in noisy financial environments",
              ],
            },
            {
              type: "theory",
              title: "Potential-Based Reward Shaping: Policy Invariance Theorem",
              content:
                "**The Reward Shaping Problem.** In sparse-reward environments (e.g., trading where most rewards are near-zero noise), RL agents struggle to discover good policies — credit assignment is ambiguous over long horizons. Reward shaping adds intermediate rewards to guide learning. But naive shaping can change the optimal policy π*. Example: adding a constant bonus c for 'being in profit' shifts the optimal policy from 'maximize total return' to 'maximize time spent in profit' (different objectives!).\n\n**Potential-Based Reward Shaping (Ng, Harada, Russell 1999).** Define a potential function Φ: S → ℝ. The shaped reward is: R′(s,a,s′) = R(s,a,s′) + F(s,s′), where F(s,s′) = γΦ(s′) − Φ(s) is the shaping function. Theorem (PBRS): The optimal policy π* under R′ is identical to the optimal policy under R — the shaping does not change which policy is best, only how quickly it is learned.\n\n**Proof Sketch (Policy Invariance).** The Q-function under shaped rewards is Q′(s,a) = 𝔼[∑ₜ γᵗ R′ₜ | s₀=s, a₀=a]. Expand: Q′(s,a) = 𝔼[∑ₜ γᵗ (Rₜ + γΦ(sₜ₊₁) − Φ(sₜ))]. This is a telescoping sum: the γΦ(sₜ₊₁) from step t cancels with −γΦ(sₜ₊₁) from step t+1. After cancellation: Q′(s,a) = 𝔼[∑ₜ γᵗ Rₜ] − Φ(s) = Q(s,a) − Φ(s). The value function: V′(s) = maxₐ Q′(s,a) = maxₐ [Q(s,a) − Φ(s)] = maxₐ Q(s,a) − Φ(s) = V(s) − Φ(s). The optimal action: π*(s) = argmaxₐ Q′(s,a) = argmaxₐ [Q(s,a) − Φ(s)] = argmaxₐ Q(s,a) (since Φ(s) is constant w.r.t. a). Therefore π* is unchanged — the optimal actions are the same under R′ and R.\n\n**Constructing Φ for Trading.** (1) Heuristic potential: Φ(s) = equity − equity₀ (current profit). F(s,s′) = γ(equity′ − equity₀) − (equity − equity₀) = γ·equity′ − equity. This provides a dense reward at every step (immediate P&L) while preserving the optimal long-term policy. (2) Learned potential: Pre-train a value network V_prior on historical data. Use Φ(s) = V_prior(s). This guides exploration toward states the prior thinks are valuable. (3) Risk-based potential: Φ(s) = −σ_portfolio(s) (negative volatility). F encourages transitions toward lower-volatility states.\n\n**Non-Potential Shaping (Dangerous).** Adding F(s,s′) = +1 whenever equity > equity₀ is NOT potential-based (cannot write as γΦ(s′) − Φ(s)). This changes π* to maximize time-in-profit rather than total profit — the agent might take tiny positions to avoid ever dropping below starting equity, achieving zero drawdown but also zero return. PBRS guarantees this cannot happen.",
            },
            {
              type: "theory",
              title: "Differential Sharpe Ratio: Full Derivation & Online Computation",
              content:
                "**Sharpe Ratio as Objective.** The Sharpe ratio S = μ/σ (mean return over standard deviation) is the canonical risk-adjusted performance metric. We want the RL agent to maximize S, not raw return μ. The challenge: computing S requires the full trajectory (we don't know σ until the episode ends) — incompatible with step-by-step RL rewards.\n\n**Differential Sharpe (Moody & Saffell 1998).** The differential Sharpe dSₜ approximates ∂S/∂rₜ — the marginal contribution of the current return rₜ to the overall Sharpe ratio. It can be computed online using exponential moving averages (EMAs). Let Aₜ = (1−η)Aₜ₋₁ + η·rₜ (EMA of returns, approximates μ), Bₜ = (1−η)Bₜ₋₁ + η·rₜ² (EMA of squared returns, approximates 𝔼[r²]). The variance: σₜ² ≈ Bₜ − Aₜ². The Sharpe ratio: Sₜ ≈ Aₜ / √(Bₜ − Aₜ²).\n\n**Derivation of dS.** We want dSₜ ≈ ∂Sₜ/∂rₜ. Using the quotient rule and chain rule: ∂Sₜ/∂rₜ = ∂/∂rₜ [Aₜ / √(Bₜ − Aₜ²)]. Compute partials: ∂Aₜ/∂rₜ = η, ∂Bₜ/∂rₜ = 2ηrₜ. Then: ∂Sₜ/∂rₜ = [√(Bₜ − Aₜ²)·η − Aₜ·(−2Aₜ·η + 2ηrₜ·1/2)/√(Bₜ − Aₜ²)] / (Bₜ − Aₜ²). Simplify: ∂Sₜ/∂rₜ = [η(Bₜ − Aₜ²) + Aₜη(Aₜ − rₜ)] / (Bₜ − Aₜ²)^(3/2). Factor out η and rearrange: dSₜ = η [Bₜ − Aₜ·rₜ] / (Bₜ − Aₜ²)^(3/2). For numerical stability, absorb η into the EMA definition and use: dSₜ = (Bₜ − Aₜ·rₜ) / (Bₜ − Aₜ²)^(3/2). Alternatively (equivalent form from Moody): dSₜ = (Bₜ₋₁·Δrₜ − ½Aₜ₋₁·Δrₜ²) / (Bₜ₋₁ − Aₜ₋₁²)^(3/2), where Δrₜ = rₜ − Aₜ₋₁, Δrₜ² = rₜ² − Bₜ₋₁.\n\n**Numerical Example.** Initialize A₀ = 0, B₀ = 0, η = 0.01. At t=1, observe return r₁ = 0.005. A₁ = 0 + 0.01×0.005 = 0.00005. B₁ = 0 + 0.01×0.005² = 0.00000025. Variance σ₁² = 0.00000025 − 0.00005² ≈ 0 (too early). Use fallback: dS₁ = r₁ = 0.005. At t=100 (after many steps), A₁₀₀ = 0.0002 (≈ 2bps mean daily return), B₁₀₀ = 0.000064 (variance σ² = 0.000064 − 0.0002² = 0.00006). If r₁₀₀ = 0.008 (strong positive day): dS₁₀₀ = (0.000064 − 0.0002×0.008) / (0.00006)^(3/2) = (0.000064 − 0.0000016) / 0.0000147 ≈ 4.24. This high dS signals that the 0.8% gain significantly improves the Sharpe ratio. If r₁₀₀ = −0.01 (large loss): dS₁₀₀ = (0.000064 + 0.0002×0.01) / (0.00006)^(3/2) ≈ −27.2 — the loss drastically hurts the Sharpe ratio, producing a large negative reward.\n\n**Advantages for RL.** (1) Dense: non-zero at every step (vs end-of-episode Sharpe). (2) Risk-adjusted: penalizes variance implicitly. (3) Directly aligned with trading objectives (Sharpe is what allocators care about). (4) Online: no need to store full trajectory. Disadvantages: (1) EMA hyperparameter η requires tuning (η=0.01 ≈ 100-day half-life). (2) Sensitive to initialization (early steps have undefined dS — use fallback to raw return).",
            },
            {
              type: "theory",
              title: "Multi-Objective Rewards, Clipping, and Reward Hacking",
              content:
                "**Multi-Objective Reward Construction.** Trading goals are multidimensional: maximize profit, minimize risk, control costs, limit drawdowns. A composite reward: R = w₁·PnL + w₂·dSharpe − w₃·DD_penalty − w₄·|Δposition|·cost − w₅·(volatility − target_vol)². The weights wᵢ encode preferences. Typical values: w₁=1.0 (profit), w₂=0.5 (Sharpe boost), w₃=10.0 (drawdown avoidance), w₄=0.1 (cost minimization), w₅=0.2 (vol targeting).\n\n**Drawdown Penalty Design.** Current drawdown: DDₜ = (peak_equity − equityₜ) / peak_equity. Penalty options: (1) Linear: −w₃·DDₜ (penalizes all drawdowns proportionally). (2) Quadratic: −w₃·DDₜ² (penalizes large drawdowns exponentially more). (3) Threshold: −w₃·max(DDₜ − δ, 0) (only penalize drawdowns beyond δ=5%, tolerating normal fluctuations). The quadratic form is most effective: a 10% DD gets penalty −10², a 20% DD gets −400 — strongly discouraging tail risk.\n\n**Sortino-Based Rewards.** The Sortino ratio S_sortino = μ / σ_down, where σ_down = √(𝔼[min(r−τ, 0)²]) is downside deviation below threshold τ (often τ=0). This penalizes only downside volatility. Differential Sortino (analogous to differential Sharpe): maintain EMA of negative returns: Dₜ = (1−η)Dₜ₋₁ + η·min(rₜ,0)². Then dSortinoₜ ≈ rₜ / √Dₜ. This encourages asymmetric strategies: the agent can take upside risk freely (high σ_up is fine) but must avoid downside risk (low σ_down required).\n\n**Reward Clipping.** Raw trading rewards have heavy tails: most days rₜ ≈ 0, but rare events produce |rₜ| > 10×mean. This causes gradient explosions. Clipping: r_clipped = clip(rₜ, −c, +c), where c is the 99th percentile of |rₜ| on historical data. Alternatively, adaptive clipping: r_clipped = tanh(rₜ / σ_r), where σ_r is the running std of rewards. This squashes extreme outliers while preserving ordinal information.\n\n**Reward Normalization.** Normalize rewards to zero mean, unit variance: r_norm = (rₜ − μ_r) / σ_r, where μ_r and σ_r are running statistics. This ensures the advantage function Â(s,a) has consistent scale across different market regimes (volatile vs calm periods). Without normalization, the policy gradient magnitude fluctuates wildly, destabilizing training.\n\n**Reward Hacking Examples in Trading.** (1) Churn hacking: If the reward includes a small bonus for 'active trading' (to avoid do-nothing policies), the agent learns to flip positions every step, generating massive transaction costs but technically maximizing the reward. (2) Volatility farming: If the reward is raw return without risk adjustment, the agent takes maximum leverage to maximize |rₜ| — works until a tail event wipes out the account. (3) Accounting tricks: If drawdown is measured from initial equity (not peak), the agent front-loads gains (lucky early trades boost equity), then trades conservatively to preserve the high watermark — gaming the metric without generating consistent alpha. (4) Exploit delays: If transaction costs are charged at t+1 but rewards at t, the agent churns at t and exits at t+1 before costs hit — exploiting the timing mismatch.\n\n**Preventing Reward Hacking.** (1) Adversarial validation: test the trained agent on out-of-distribution data (different market regimes, extreme volatility). If performance collapses, the agent likely hacked a regime-specific loophole. (2) Explicit constraints: add hard constraints (max |Δposition| < 0.5, max trades/day < 10) that cannot be gamed. (3) Ensemble metrics: require the agent to satisfy Sharpe > 1.0 AND max DD < 15% AND calmar > 0.5 simultaneously — harder to game three metrics than one. (4) Human review: inspect trajectories for 'suspicious' patterns (rapid flips, position size spikes, etc.).",
            },
            {
              type: "intuition",
              title: "Dog Training Treats for Trading Agents",
              analogy:
                "Training a trading agent is like training a dog to run an agility course. If you only give a treat at the finish line (sparse reward = end-of-episode P&L), the dog has no idea which jumps and turns contributed to success — learning is painfully slow. Dense rewards are like giving small treats along the course: 'good turn! good jump!' But you must be careful: if you give a treat for running fast regardless of direction, the dog learns to sprint in circles (reward hacking). The differential Sharpe ratio is a carefully calibrated treat that rewards good runs AND penalizes reckless speed — exactly what agility judges score.",
              content:
                "Reward hacking in trading is insidious. An agent rewarded purely on trade count might churn to maximize activity. One rewarded on raw P&L might take massive unhedged positions that look profitable until a tail event wipes out the account. Potential-based shaping is like pre-installing agility course knowledge without changing what a 'perfect run' looks like — the dog still aims for the same finish line, but with better intermediate guidance.",
              emoji: "🐕",
            },
            {
              type: "intuition",
              title: "Goodhart's Law in Reward Design",
              analogy:
                "Goodhart's Law: 'When a measure becomes a target, it ceases to be a good measure.' Imagine a company that rewards salespeople purely on number of sales. Rational response: sell to anyone, regardless of product fit. Customers churn, reputation tanks, long-term revenue collapses — but sales count is maximized. The same happens in RL: optimize Sharpe ratio naively, the agent learns to trade tiny positions (low σ, high S, but near-zero profit). Optimize raw return, the agent takes 100x leverage (high μ, catastrophic risk). The solution: multi-objective rewards with carefully balanced weights. Like a balanced scorecard for employees (sales AND customer satisfaction AND retention), we need profit AND risk-adjustment AND drawdown control. No single metric is un-gameable.",
              content:
                "PBRS is the exception: it's a 'free lunch' because the policy invariance theorem guarantees you can't game it — the optimal policy is unchanged. But PBRS only accelerates learning, it doesn't define the objective. You still need a well-designed base reward R(s,a,s′). Think of PBRS as scaffolding that helps you build the right building faster, but the blueprint (base reward) must be correct first.",
              emoji: "🎯",
            },
            {
              type: "code",
              title: "Four Reward Functions for Trading Agents",
              language: "python",
              code: `import numpy as np

class RewardFunctions:
    """Compare 4 reward functions for forex trading RL agents."""

    def __init__(self, eta: float = 0.01):
        self.eta = eta  # EMA decay for differential Sharpe
        self.A = 0.0    # EMA of returns
        self.B = 0.0    # EMA of squared returns
        self.downside_sq_sum = 0.0
        self.downside_count = 0
        self.peak_equity = 1.0
        self.equity = 1.0

    def raw_pnl(self, position: float, price_return: float) -> float:
        """R1: Raw P&L — simplest but sparse and risk-ignorant."""
        return position * price_return

    def differential_sharpe(self, position: float, price_return: float) -> float:
        """R2: Differential Sharpe ratio (Moody & Saffell, 1998).
        Approximates marginal Sharpe contribution of current trade."""
        r = position * price_return
        delta_A = r - self.A
        delta_B = r ** 2 - self.B
        denom = (self.B - self.A ** 2) ** 1.5
        if abs(denom) < 1e-12:
            dS = r  # fallback early in training
        else:
            dS = (self.B * delta_A - 0.5 * self.A * delta_B) / denom
        # Update EMAs
        self.A += self.eta * delta_A
        self.B += self.eta * delta_B
        return dS

    def sortino_reward(self, position: float, price_return: float) -> float:
        """R3: Sortino-based — penalizes downside deviation only."""
        r = position * price_return
        if r < 0:
            self.downside_sq_sum += r ** 2
            self.downside_count += 1
        downside_std = np.sqrt(self.downside_sq_sum / max(self.downside_count, 1))
        return r / max(downside_std, 1e-6)

    def drawdown_penalized(self, position: float, price_return: float,
                           dd_penalty: float = 2.0) -> float:
        """R4: PnL with drawdown penalty — penalizes equity curve dips."""
        r = position * price_return
        self.equity += r
        self.peak_equity = max(self.peak_equity, self.equity)
        drawdown = (self.peak_equity - self.equity) / self.peak_equity
        return r - dd_penalty * max(drawdown - 0.05, 0)  # penalty beyond 5% DD

# ── Simulate and compare agent behavior under each reward ────
np.random.seed(42)
n_steps = 2000
returns = np.random.normal(0.0001, 0.008, n_steps)  # daily forex returns

# Simple momentum agent: position = sign(rolling mean return)
window = 20
positions = np.zeros(n_steps)
for t in range(window, n_steps):
    positions[t] = np.sign(returns[t - window : t].mean())

# Compute all 4 rewards
reward_names = ["Raw PnL", "Diff Sharpe", "Sortino", "DD-Penalized"]
all_rewards = {name: [] for name in reward_names}

rf = RewardFunctions(eta=0.01)
for t in range(window, n_steps):
    pos, ret = positions[t], returns[t]
    all_rewards["Raw PnL"].append(rf.raw_pnl(pos, ret))
    all_rewards["Diff Sharpe"].append(rf.differential_sharpe(pos, ret))
    all_rewards["Sortino"].append(rf.sortino_reward(pos, ret))
    all_rewards["DD-Penalized"].append(rf.drawdown_penalized(pos, ret))

print("Reward Function Comparison (momentum agent, 2000 steps):")
print(f"{'Function':>15s} | {'Mean':>10s} | {'Std':>10s} | {'Sharpe':>8s} | {'Min':>10s}")
print("-" * 65)
for name in reward_names:
    r = np.array(all_rewards[name])
    sharpe = r.mean() / (r.std() + 1e-8) * np.sqrt(252)
    print(f"{name:>15s} | {r.mean():+10.6f} | {r.std():10.6f} | {sharpe:+8.3f} | {r.min():+10.6f}")

print(f"\\nKey insight: Differential Sharpe provides dense, risk-adjusted signal")
print(f"while DD-Penalized explicitly discourages equity drawdowns > 5%.")`,
              explanation:
                "Four reward functions applied to the same momentum strategy: (1) Raw PnL is sparse and noisy. (2) Differential Sharpe approximates the marginal Sharpe contribution using EMA statistics — dense and risk-adjusted. (3) Sortino penalizes only downside deviation, encouraging asymmetric risk-taking. (4) Drawdown-penalized adds an explicit penalty when equity falls >5% from peak. Comparing their statistics reveals why differential Sharpe is preferred — it provides the most informative gradient signal for policy optimization.",
            },
            {
              type: "code",
              title: "Potential-Based Reward Shaping for Trading",
              language: "python",
              code: `import numpy as np
import torch
import torch.nn as nn

class TradingEnvWithPBRS:
    """Forex environment with potential-based reward shaping."""
    def __init__(self, returns: np.ndarray, gamma: float = 0.99):
        self.returns = returns
        self.gamma = gamma
        self.reset()
    
    def reset(self):
        self.t = 0
        self.equity = 1.0
        self.position = 0.0
        return self._get_state()
    
    def _get_state(self) -> np.ndarray:
        # Simple 3-feature state
        recent_ret = self.returns[max(0, self.t-10):self.t].mean() if self.t > 0 else 0.0
        recent_vol = self.returns[max(0, self.t-10):self.t].std() if self.t > 0 else 0.01
        return np.array([recent_ret, recent_vol, self.position], dtype=np.float32)
    
    def potential(self, state: np.ndarray) -> float:
        """Heuristic potential: Φ(s) = normalized equity.
        Could also use a pre-trained value network V_prior(s)."""
        # Simple heuristic: states with low volatility have higher potential
        recent_ret, recent_vol, position = state
        return (self.equity - 1.0) - 0.5 * recent_vol  # profit minus vol penalty
    
    def step(self, action: float):
        # Clip action to [-1, 1]
        action = np.clip(action, -1.0, 1.0)
        
        # Compute base reward (raw PnL with cost)
        pnl = action * self.returns[self.t]
        cost = 0.0002 * abs(action - self.position)
        base_reward = pnl - cost
        
        # Update state
        self.equity += base_reward
        self.position = action
        old_state = self._get_state()
        self.t += 1
        done = self.t >= len(self.returns) - 1
        new_state = self._get_state()
        
        # Potential-based shaping: F(s, s′) = γ·Φ(s′) − Φ(s)
        shaping = self.gamma * self.potential(new_state) - self.potential(old_state)
        
        # Shaped reward preserves optimal policy but provides denser signal
        shaped_reward = base_reward + shaping
        
        return new_state, shaped_reward, done, {'base_reward': base_reward, 'shaping': shaping}

# ── Demonstrate PBRS policy invariance ──────────────────────
np.random.seed(42)
returns = np.random.normal(0.0001, 0.008, size=1000)

env = TradingEnvWithPBRS(returns, gamma=0.99)
state = env.reset()

base_rewards, shaped_rewards, shapings = [], [], []
for _ in range(100):
    action = np.random.uniform(-0.5, 0.5)  # random policy for demo
    state, r_shaped, done, info = env.step(action)
    base_rewards.append(info['base_reward'])
    shaped_rewards.append(r_shaped)
    shapings.append(info['shaping'])
    if done:
        break

print("Potential-Based Reward Shaping Demonstration:")
print(f"Base reward   mean: {np.mean(base_rewards):+.6f}, std: {np.std(base_rewards):.6f}")
print(f"Shaped reward mean: {np.mean(shaped_rewards):+.6f}, std: {np.std(shaped_rewards):.6f}")
print(f"Shaping term  mean: {np.mean(shapings):+.6f}, std: {np.std(shapings):.6f}")
print(f"\\nShaped rewards are denser (higher variance) but preserve optimal policy.")
print(f"The shaping term F(s,s′) = γΦ(s′) − Φ(s) encourages moving toward high-Φ states")
print(f"(low volatility, positive equity), accelerating learning without changing π*.")`,
              explanation:
                "This example implements PBRS with a heuristic potential Φ(s) = equity − 0.5·volatility. The shaping term F(s,s′) = γΦ(s′) − Φ(s) provides a dense reward signal (moving toward low-vol, high-equity states) at every step, while the policy invariance theorem guarantees the optimal policy is unchanged. In practice, you could replace the heuristic Φ with a pre-trained value network V_prior(s) from supervised learning on historical expert trajectories, bootstrapping RL with domain knowledge.",
            },
            {
              type: "code",
              title: "Multi-Objective Reward with Adaptive Normalization",
              language: "python",
              code: `import numpy as np
from collections import deque

class MultiObjectiveReward:
    """Composite reward: profit + Sharpe - drawdown - cost, with normalization."""
    def __init__(self, w_pnl=1.0, w_sharpe=0.5, w_dd=10.0, w_cost=0.1,
                 norm_window=500):
        self.w_pnl = w_pnl
        self.w_sharpe = w_sharpe
        self.w_dd = w_dd
        self.w_cost = w_cost
        
        # Differential Sharpe state
        self.A = 0.0
        self.B = 0.0
        self.eta = 0.01
        
        # Drawdown tracking
        self.equity = 1.0
        self.peak_equity = 1.0
        
        # Adaptive normalization
        self.norm_window = norm_window
        self.reward_history = deque(maxlen=norm_window)
    
    def compute(self, position: float, new_position: float, price_return: float) -> float:
        """Compute multi-objective reward."""
        # 1. Raw PnL
        pnl = position * price_return
        
        # 2. Differential Sharpe
        r = pnl
        delta_A = r - self.A
        delta_B = r**2 - self.B
        denom = (self.B - self.A**2)**1.5
        dS = r if abs(denom) < 1e-12 else (self.B * delta_A - 0.5 * self.A * delta_B) / denom
        self.A += self.eta * delta_A
        self.B += self.eta * delta_B
        
        # 3. Drawdown penalty
        self.equity += pnl
        self.peak_equity = max(self.peak_equity, self.equity)
        dd = (self.peak_equity - self.equity) / max(self.peak_equity, 1e-8)
        dd_penalty = max(dd - 0.05, 0)**2  # quadratic penalty beyond 5%
        
        # 4. Transaction cost
        cost = 0.0002 * abs(new_position - position)
        
        # Composite reward
        raw_reward = (self.w_pnl * pnl + 
                      self.w_sharpe * dS - 
                      self.w_dd * dd_penalty - 
                      self.w_cost * cost)
        
        # Adaptive normalization
        self.reward_history.append(raw_reward)
        if len(self.reward_history) >= 50:
            mu = np.mean(self.reward_history)
            sigma = np.std(self.reward_history) + 1e-8
            normalized_reward = (raw_reward - mu) / sigma
        else:
            normalized_reward = raw_reward  # don't normalize until enough data
        
        return normalized_reward
    
    def reset(self):
        """Reset for new episode."""
        self.A = 0.0
        self.B = 0.0
        self.equity = 1.0
        self.peak_equity = 1.0

# ── Test on simulated trading ───────────────────────────────
np.random.seed(42)
returns = np.random.normal(0.0001, 0.008, size=2000)

reward_fn = MultiObjectiveReward(w_pnl=1.0, w_sharpe=0.5, w_dd=10.0, w_cost=0.1)
position = 0.0
rewards = []

for t in range(len(returns)):
    # Simple strategy: mean reversion
    if t > 20:
        signal = -np.sign(np.mean(returns[t-20:t]))
        new_position = 0.5 * signal
    else:
        new_position = 0.0
    
    r = reward_fn.compute(position, new_position, returns[t])
    rewards.append(r)
    position = new_position

print("Multi-Objective Reward Statistics:")
print(f"Mean: {np.mean(rewards):+.6f}")
print(f"Std:  {np.std(rewards):.6f}")
print(f"Min:  {np.min(rewards):+.6f}, Max: {np.max(rewards):+.6f}")
print(f"Final equity: {reward_fn.equity:.4f}")
print(f"Max drawdown: {(reward_fn.peak_equity - reward_fn.equity)/reward_fn.peak_equity:.2%}")
print(f"\\nNormalization ensures |reward| stays in [-3, +3] range for stable gradients.")`,
              explanation:
                "This multi-objective reward combines four components: (1) raw PnL (profit), (2) differential Sharpe (risk-adjusted performance), (3) quadratic drawdown penalty (tail risk control), (4) transaction costs (discourage overtrading). Weights w_pnl=1.0, w_sharpe=0.5, w_dd=10.0, w_cost=0.1 encode preferences: we care most about avoiding drawdowns (w_dd=10), moderately about profit and Sharpe, least about costs. Adaptive normalization maintains zero mean, unit variance over a 500-step window, ensuring stable policy gradients across different market volatility regimes. Without normalization, a single volatile day could dominate the gradient update.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-reward-q1",
                  question: "Why is raw P&L a poor reward function for RL trading agents?",
                  options: [
                    { id: "rl-reward-q1-a", text: "It is computationally expensive to calculate" },
                    { id: "rl-reward-q1-b", text: "It is sparse, high-variance, and risk-ignorant — two very different strategies can produce similar cumulative P&L" },
                    { id: "rl-reward-q1-c", text: "It violates the Markov property" },
                    { id: "rl-reward-q1-d", text: "It cannot be computed for continuous action spaces" },
                  ],
                  correctOptionId: "rl-reward-q1-b",
                  explanation:
                    "Raw P&L rₜ = position · Δprice is dominated by price noise (most steps yield near-zero signal). It treats a +$100 from a reckless 100x leveraged bet identically to +$100 from a disciplined position — no risk adjustment. An agent optimizing raw P&L tends to take extreme positions.",
                },
                {
                  id: "rl-reward-q2",
                  question: "What is a concrete example of reward hacking in trading RL?",
                  options: [
                    { id: "rl-reward-q2-a", text: "The agent discovers a profitable momentum signal" },
                    { id: "rl-reward-q2-b", text: "The agent learns to churn positions to exploit a per-trade bonus, generating high transaction volume but negative net P&L" },
                    { id: "rl-reward-q2-c", text: "The agent holds positions overnight to capture swap points" },
                    { id: "rl-reward-q2-d", text: "The agent reduces position size during volatile periods" },
                  ],
                  correctOptionId: "rl-reward-q2-b",
                  explanation:
                    "Reward hacking occurs when the agent optimizes the reward metric in unintended ways. If the reward includes any component correlated with trading frequency (even implicitly), the agent may learn to rapidly open and close positions — technically maximizing the metric while generating real losses from spreads and slippage.",
                },
                {
                  id: "rl-reward-q3",
                  question: "Why is the differential Sharpe ratio preferred over raw P&L as a reward signal?",
                  options: [
                    { id: "rl-reward-q3-a", text: "It requires less data to compute" },
                    { id: "rl-reward-q3-b", text: "It is always positive, making optimization easier" },
                    { id: "rl-reward-q3-c", text: "It provides a dense, risk-adjusted signal that approximates each trade's marginal contribution to the overall Sharpe ratio" },
                    { id: "rl-reward-q3-d", text: "It eliminates the need for a discount factor γ" },
                  ],
                  correctOptionId: "rl-reward-q3-c",
                  explanation:
                    "The differential Sharpe ratio dSₜ measures how much the current trade improves or hurts the running Sharpe ratio. It is dense (non-zero at every step), risk-adjusted (penalizes variance), and directly aligned with the metric traders actually care about. This gives the policy gradient a much more informative signal than sparse raw P&L.",
                },
                {
                  id: "rl-reward-q4",
                  question: "What guarantees that potential-based reward shaping F(s,s′) = γΦ(s′) − Φ(s) does not change the optimal policy?",
                  options: [
                    { id: "rl-reward-q4-a", text: "The shaping term is always small relative to the base reward" },
                    { id: "rl-reward-q4-b", text: "The shaping term telescopes in the cumulative return, leaving Q(s,a) = Q_shaped(s,a) + constant, so argmax Q is unchanged" },
                    { id: "rl-reward-q4-c", text: "The discount factor γ makes future rewards irrelevant" },
                    { id: "rl-reward-q4-d", text: "The potential function Φ must be non-negative" },
                  ],
                  correctOptionId: "rl-reward-q4-b",
                  explanation:
                    "The PBRS theorem proof shows that Q_shaped(s,a) = Q(s,a) − Φ(s) because the shaping terms γΦ(s′) from step t and −Φ(s′) from step t+1 cancel (telescoping). Since Φ(s) is constant w.r.t. action a, π*(s) = argmax_a Q_shaped(s,a) = argmax_a [Q(s,a) − Φ(s)] = argmax_a Q(s,a). The optimal policy is preserved.",
                },
                {
                  id: "rl-reward-q5",
                  question: "Why does the Sortino ratio penalize only downside deviation, and how does this differ from Sharpe?",
                  options: [
                    { id: "rl-reward-q5-a", text: "Sortino is easier to compute than Sharpe" },
                    { id: "rl-reward-q5-b", text: "Sortino distinguishes between 'good' upside volatility and 'bad' downside volatility, aligning with traders' asymmetric risk preferences" },
                    { id: "rl-reward-q5-c", text: "Sortino requires fewer data points to estimate" },
                    { id: "rl-reward-q5-d", text: "Sortino is always higher than Sharpe for the same strategy" },
                  ],
                  correctOptionId: "rl-reward-q5-b",
                  explanation:
                    "Sharpe ratio S = μ/σ penalizes all volatility (upside and downside equally). Sortino ratio S_sortino = μ/σ_down only penalizes downside volatility σ_down = √𝔼[min(r,0)²]. This reflects the reality that traders love upside volatility (big gains) but hate downside volatility (losses). An RL agent optimizing Sortino can take aggressive upside bets while avoiding downside risk.",
                },
                {
                  id: "rl-reward-q6",
                  question: "What is the purpose of reward normalization (r − μ)/σ in financial RL?",
                  options: [
                    { id: "rl-reward-q6-a", text: "To ensure all rewards are positive" },
                    { id: "rl-reward-q6-b", text: "To make training faster by reducing the number of episodes needed" },
                    { id: "rl-reward-q6-c", text: "To stabilize policy gradients by ensuring consistent reward scale across different market volatility regimes" },
                    { id: "rl-reward-q6-d", text: "To satisfy the Markov property" },
                  ],
                  correctOptionId: "rl-reward-q6-c",
                  explanation:
                    "Financial markets have time-varying volatility. In calm periods, |rₜ| ≈ 0.001 daily. In volatile periods, |rₜ| ≈ 0.05. Without normalization, the policy gradient magnitude ∇θ J ∝ rₜ·∇θ log π(a|s) varies by 50x between regimes, causing training instability (exploding gradients in volatile periods, vanishing gradients in calm periods). Normalizing to zero mean, unit variance ensures stable gradient magnitudes regardless of market conditions.",
                },
                {
                  id: "rl-reward-q7",
                  question: "In a multi-objective reward R = w₁·PnL + w₂·dSharpe − w₃·DD², how should you set weights to strongly discourage drawdowns?",
                  options: [
                    { id: "rl-reward-q7-a", text: "Set w₁ > w₂ > w₃ (profit most important)" },
                    { id: "rl-reward-q7-b", text: "Set w₃ >> w₁, w₂ (drawdown penalty dominates)" },
                    { id: "rl-reward-q7-c", text: "Set all weights equal (w₁ = w₂ = w₃)" },
                    { id: "rl-reward-q7-d", text: "Drawdown weight doesn't matter if the penalty is quadratic" },
                  ],
                  correctOptionId: "rl-reward-q7-b",
                  explanation:
                    "If you want the agent to prioritize low drawdowns, set w₃ = 10-50 while w₁ = 1.0 and w₂ = 0.5. The large w₃ makes even small drawdowns (DD=10% → DD²=0.01 → penalty=0.1 to 0.5) outweigh typical per-step profits (PnL ≈ 0.001). This creates a strong gradient signal to avoid equity dips. If w₃ is too small, the agent ignores drawdowns. If w₃ is too large (e.g., 1000), the agent never trades (safest strategy is position=0).",
                },
              ],
            },
            {
              type: "practice",
              title: "Custom Reward Function Design",
              description:
                "Design a custom multi-objective reward function R = w₁·PnL + w₂·dSharpe − w₃·drawdown_penalty − w₄·|Δposition|·cost that balances profit and maximum drawdown. Train a PPO agent with this reward on EUR/USD 1H data for 1000 episodes. Compare the resulting equity curves, Sharpe ratios, and max drawdowns against an agent trained with raw P&L reward. Tune the weights wᵢ to achieve Sharpe > 1.0 with max drawdown < 15%.",
              catalogModelId: "ppo-position-sizing",
            },
            {
              type: "practice",
              title: "Reward Hacking Detection & Mitigation",
              description:
                "Train a PPO agent with a deliberately hackable reward: R = raw_PnL + 0.01·num_trades (small bonus for trading activity). Observe the agent learning to churn positions. Then add an explicit constraint: |Δposition| < 0.3 and max_trades_per_day < 5. Retrain and compare: (1) equity curves, (2) transaction costs, (3) turnover ratio, (4) out-of-sample Sharpe. Document the hacking behavior (plot position flip frequency) and the mitigation's effectiveness.",
              catalogModelId: "ppo-position-sizing",
            },
          ],
        },
      ],
    },
  ],
};
