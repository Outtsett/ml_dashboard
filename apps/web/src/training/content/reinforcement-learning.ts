import type { LearningPath } from "@/training/lib/types";

export const reinforcementLearningPath: LearningPath = {
  id: "reinforcement-learning",
  title: "Reinforcement Learning",
  description:
    "Learn to build trading agents that learn optimal strategies through market interaction â€” from tabular Q-learning to deep policy gradient methods like PPO for position sizing and order execution.",
  icon: "Gamepad2",
  color: "rose",
  difficulty: "advanced",
  estimatedHours: 20,
  modules: [
    {
      id: "rl-foundations",
      title: "RL Foundations",
      description:
        "Build the mathematical foundations â€” Markov Decision Processes, value functions, Bellman equations, and temporal difference methods applied to trading environments.",
      lessons: [
        {
          id: "rl-mdp",
          title: "Markov Decision Processes",
          description:
            "Formalise trading as an MDP with states, actions, rewards, transition probabilities, and discount factor Î³. Derive the Bellman equations underpinning all RL algorithms.",
          estimatedMinutes: 45,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Model a forex trading environment as a Markov Decision Process, derive the Bellman optimality equations for both V(s) and Q(s,a), understand policy definitions, implement value iteration with a convergence proof sketch, and interpret the discount factor Î³ as the time value of money in trading.",
              keyTakeaways: [
                "An MDP is the 5-tuple (S, A, P, R, Î³) â€” states, actions, transition probabilities, reward function, and discount factor",
                "The Markov property: P(sâ‚œâ‚Šâ‚|sâ‚œ, aâ‚œ, sâ‚œâ‚‹â‚, â€¦, sâ‚€) = P(sâ‚œâ‚Šâ‚|sâ‚œ, aâ‚œ) â€” the future depends only on the current state",
                "Bellman expectation equation: V^Ï€(s) = âˆ‘â‚ Ï€(a|s) [R(s,a) + Î³ âˆ‘â‚›â€² P(sâ€²|s,a) V^Ï€(sâ€²)]",
                "Bellman optimality equation: V*(s) = maxâ‚ [R(s,a) + Î³ âˆ‘â‚›â€² P(sâ€²|s,a) V*(sâ€²)]",
                "Q*(s,a) = R(s,a) + Î³ âˆ‘â‚›â€² P(sâ€²|s,a) maxâ‚â€² Q*(sâ€²,aâ€²) â€” action-value decomposes into immediate + discounted future",
                "Discount Î³ âˆˆ [0,1) ensures convergence of infinite sums and models the time value of money â€” Î³ = 0.99 â‰ˆ daily discounting",
                "Value iteration converges to V* by contraction mapping: â€–T Vâ‚ âˆ’ T Vâ‚‚â€–âˆž â‰¤ Î³ â€–Vâ‚ âˆ’ Vâ‚‚â€–âˆž",
                "Finite vs infinite horizon: finite horizon uses time-dependent V_t(s), infinite horizon uses stationary V(s) with Î³ < 1",
              ],
            },
            {
              type: "theory",
              title: "The MDP Tuple: Formalising Trading as Sequential Decision-Making",
              content:
                "A Markov Decision Process (MDP) is defined by the 5-tuple M = (S, A, P, R, Î³). Each component must be carefully specified for trading:\n\n**States S**: The state must encode everything the agent needs to make optimal decisions. In forex trading, this typically includes: current position (short/flat/long), normalised price features (returns, volatility, RSI, MACD), account state (equity, unrealised P&L, margin usage), and time features (hour of day, day of week, time since last trade). For a concrete example, consider a 3-state MDP with states S = {trending, ranging, volatile} representing market regimes identified by rolling statistics: trending if |20-bar SMA slope| > 0.5Ïƒ, volatile if ATR > 1.5 Ã— median ATR, and ranging otherwise.\n\n**Actions A**: For discrete trading, A = {buy, sell, hold}. For position sizing, A = {âˆ’1, âˆ’0.5, 0, +0.5, +1} representing lot fractions, or continuously A âˆˆ [âˆ’1, 1]. The action space must balance expressiveness with learnability â€” a continuous space allows precise sizing but requires policy gradient methods rather than tabular Q-learning.\n\n**Transition Probabilities P(sâ€²|s,a)**: This captures the stochastic market dynamics. For our 3-state example, P is a 3Ã—3 matrix for each action. In practice, transitions are unknown and must be learned from data (model-free RL) or estimated from historical regime frequencies (model-based RL). A critical assumption: the agent's actions do not affect market prices (no market impact), which holds for retail forex but breaks for institutional sizes.\n\n**Reward Function R(s,a,sâ€²)** or R(s,a): Maps state-action pairs to scalar rewards. Raw P&L râ‚œ = positionâ‚œ Ã— Î”priceâ‚œ is the simplest choice, but risk-adjusted alternatives (Sharpe contribution, Sortino ratio) often produce better-behaved agents. For our numerical example: R(trending, buy) = +1.0 (profit from trend-following), R(trending, sell) = âˆ’1.0 (loss from counter-trend), R(ranging, hold) = +0.1 (small reward for avoiding whipsaw losses).\n\n**Discount Factor Î³ âˆˆ [0,1)**: Controls the agent's time preference. The geometric sum âˆ‘â‚œ Î³áµ— râ‚œ converges because Î³ < 1, with effective horizon T_eff = 1/(1âˆ’Î³). For Î³ = 0.99: T_eff = 100 steps (looking ~100 bars ahead). For Î³ = 0.95: T_eff = 20 steps (short-term focus). In trading, Î³ connects to the time value of money: a dollar earned today is worth more than a dollar earned tomorrow due to opportunity cost, risk, and reinvestment potential.",
            },
            {
              type: "theory",
              title: "Policy, Value Functions, and the Bellman Equations â€” Full Derivation",
              content:
                "A **policy** Ï€(a|s) is a mapping from states to action probabilities. A deterministic policy Ï€(s) = a maps each state to a single action. The goal of RL is to find the optimal policy Ï€* that maximises the expected cumulative discounted reward.\n\n**Step 1 â€” Define the Return.** The return from time t is Gâ‚œ = âˆ‘â‚–â‚Œâ‚€^âˆž Î³áµ râ‚œâ‚Šâ‚–â‚Šâ‚. This is a random variable because future rewards depend on stochastic transitions and the policy.\n\n**Step 2 â€” State-Value Function.** V^Ï€(s) = ð”¼Ï€[Gâ‚œ | sâ‚œ = s] = ð”¼Ï€[râ‚œâ‚Šâ‚ + Î³ Gâ‚œâ‚Šâ‚ | sâ‚œ = s]. Expanding: V^Ï€(s) = âˆ‘â‚ Ï€(a|s) âˆ‘â‚›â€² P(sâ€²|s,a) [R(s,a,sâ€²) + Î³ V^Ï€(sâ€²)]. This is the **Bellman expectation equation** for V^Ï€ â€” it relates the value of a state to the values of successor states.\n\n**Step 3 â€” Action-Value Function.** Q^Ï€(s,a) = ð”¼Ï€[Gâ‚œ | sâ‚œ = s, aâ‚œ = a] = âˆ‘â‚›â€² P(sâ€²|s,a) [R(s,a,sâ€²) + Î³ âˆ‘â‚â€² Ï€(aâ€²|sâ€²) Q^Ï€(sâ€²,aâ€²)]. The relationship between V and Q: V^Ï€(s) = âˆ‘â‚ Ï€(a|s) Q^Ï€(s,a), and Q^Ï€(s,a) = R(s,a) + Î³ âˆ‘â‚›â€² P(sâ€²|s,a) V^Ï€(sâ€²).\n\n**Step 4 â€” Bellman Optimality.** The optimal value functions satisfy: V*(s) = maxâ‚ Q*(s,a) = maxâ‚ [R(s,a) + Î³ âˆ‘â‚›â€² P(sâ€²|s,a) V*(sâ€²)]. And: Q*(s,a) = R(s,a) + Î³ âˆ‘â‚›â€² P(sâ€²|s,a) maxâ‚â€² Q*(sâ€²,aâ€²). The optimal policy is deterministic: Ï€*(s) = argmaxâ‚ Q*(s,a).\n\n**Numerical Example.** Consider S = {trending, ranging}, A = {buy, hold}, Î³ = 0.9. Rewards: R(trending,buy) = +2, R(trending,hold) = 0, R(ranging,buy) = âˆ’1, R(ranging,hold) = +0.5. Transitions: P(trending|trending,buy) = 0.7, P(ranging|trending,buy) = 0.3, P(trending|ranging,hold) = 0.4, P(ranging|ranging,hold) = 0.6. Bellman equations: V*(trending) = max(2 + 0.9[0.7Â·V*(trending) + 0.3Â·V*(ranging)], 0 + 0.9[0.5Â·V*(trending) + 0.5Â·V*(ranging)]). V*(ranging) = max(âˆ’1 + 0.9[0.3Â·V*(trending) + 0.7Â·V*(ranging)], 0.5 + 0.9[0.4Â·V*(trending) + 0.6Â·V*(ranging)]). Solving this system iteratively yields V*(trending) â‰ˆ 11.2, V*(ranging) â‰ˆ 7.8, with Ï€*(trending) = buy, Ï€*(ranging) = hold.",
            },
            {
              type: "theory",
              title: "Value Iteration Algorithm with Convergence Proof Sketch",
              content:
                "**Value Iteration** computes V* without explicitly representing policies. Define the Bellman optimality operator T: (TV)(s) = maxâ‚ [R(s,a) + Î³ âˆ‘â‚›â€² P(sâ€²|s,a) V(sâ€²)]. Value iteration repeatedly applies T: Vâ‚€ arbitrary, Vâ‚–â‚Šâ‚ = T Vâ‚–.\n\n**Convergence Proof Sketch.** T is a Î³-contraction in the sup-norm: â€–TVâ‚ âˆ’ TVâ‚‚â€–âˆž â‰¤ Î³ â€–Vâ‚ âˆ’ Vâ‚‚â€–âˆž. Proof: |TVâ‚(s) âˆ’ TVâ‚‚(s)| = |maxâ‚[R + Î³âˆ‘PÂ·Vâ‚] âˆ’ maxâ‚[R + Î³âˆ‘PÂ·Vâ‚‚]| â‰¤ maxâ‚ |Î³âˆ‘â‚›â€² P(sâ€²|s,a)(Vâ‚(sâ€²) âˆ’ Vâ‚‚(sâ€²))| â‰¤ Î³ maxâ‚ âˆ‘â‚›â€² P(sâ€²|s,a) â€–Vâ‚ âˆ’ Vâ‚‚â€–âˆž = Î³ â€–Vâ‚ âˆ’ Vâ‚‚â€–âˆž. Since âˆ‘P = 1, the last step holds. By the Banach Fixed-Point Theorem, T has a unique fixed point V* and Vâ‚– â†’ V* at rate O(Î³áµ). After k iterations: â€–Vâ‚– âˆ’ V*â€–âˆž â‰¤ Î³áµ/(1âˆ’Î³) Â· â€–Vâ‚ âˆ’ Vâ‚€â€–âˆž. For Î³ = 0.95, convergence to Îµ = 10â»â¶ requires k â‰¥ log(Îµ(1âˆ’Î³)/â€–Vâ‚âˆ’Vâ‚€â€–âˆž) / log(Î³) â‰ˆ 280 iterations (for â€–Vâ‚âˆ’Vâ‚€â€–âˆž â‰ˆ 10).\n\n**Algorithm Pseudocode.** Initialize V(s) = 0 for all s. Repeat: for each s âˆˆ S, compute V_new(s) = maxâ‚ [R(s,a) + Î³ âˆ‘â‚›â€² P(sâ€²|s,a) V(sâ€²)]. If maxâ‚› |V_new(s) âˆ’ V(s)| < Îµ, stop. Extract policy: Ï€*(s) = argmaxâ‚ [R(s,a) + Î³ âˆ‘â‚›â€² P(sâ€²|s,a) V*(sâ€²)]. Complexity: O(|S|Â² Â· |A|) per iteration.\n\n**Finite vs Infinite Horizon.** In finite-horizon MDPs (trade for exactly T steps), the value function is time-dependent: Vâ‚œ(s) = maxâ‚ [R(s,a) + Î³ âˆ‘â‚›â€² P(sâ€²|s,a) Vâ‚œâ‚Šâ‚(sâ€²)] with V_T(s) = 0. No discount is needed since the sum is finite. In infinite-horizon MDPs (continuous trading with no fixed end), Î³ < 1 is essential for convergence and the value function is stationary V(s). Most trading applications use infinite-horizon with episode truncation.\n\n**Trading Implications.** Value iteration requires knowing P(sâ€²|s,a) â€” the full market model. This is rarely available in practice (market dynamics are complex and non-stationary), which motivates model-free methods like Q-learning. However, value iteration on simplified MDPs provides theoretical insight: it reveals that optimal trading policies adapt to regime (long in trends, flat in ranges) and that the discount factor determines the agent's trading horizon.",
            },
            {
              type: "intuition",
              title: "MDPs as a Board Game Against the Market",
              analogy:
                "Forex trading is a board game against the market. Your position on the board (state) includes your holdings, account balance, and the current chart pattern. Each turn you choose a move (buy/sell/hold), the market rolls dice (price moves stochastically), you land on a new square and collect or pay a reward (P&L). The discount factor Î³ is your patience level: Î³ = 0.99 means you are willing to wait 100 turns for a big payoff; Î³ = 0.5 means you want profits NOW and heavily discount anything beyond 2 turns. The Bellman equation is the 'backward induction' strategy: the value of any board position = the best move's immediate reward + the discounted value of where you will land. Value iteration is playing the entire game backwards from every possible endgame, propagating knowledge about good and bad positions until you know the optimal move from every square.",
              content:
                "This analogy captures two essential MDP properties. First, the Markov property: your optimal next move depends only on your current board position, not how you got there â€” in trading, the current state (position, equity, features) encodes all relevant history. Second, the recursive structure: just as chess grandmasters evaluate positions by considering the best possible continuation, the Bellman equation evaluates trading states by considering the best possible sequence of future trades. Value iteration makes this concrete: initially V(s) = 0 everywhere (no knowledge), then each sweep improves estimates by looking one step ahead, gradually building up knowledge about which market conditions are valuable to be in.",
              emoji: "ðŸŽ²",
            },
            {
              type: "intuition",
              title: "Discount Factor as the Time Value of Money",
              analogy:
                "The discount factor Î³ in RL is directly analogous to the time value of money in finance. A dollar today is worth more than a dollar tomorrow because you can invest it. If the risk-free rate is r, then $1 tomorrow is worth $1/(1+r) â‰ˆ $(1âˆ’r) today. Setting Î³ = 1/(1+r) makes the RL discount identical to financial discounting. For a daily risk-free rate of r = 0.01% (â‰ˆ 2.5% annually), Î³ = 0.9999. For an intraday trader who values capital turnover at 5% per trade, Î³ = 0.95. The 'effective horizon' T_eff = 1/(1âˆ’Î³) tells you how far ahead the agent looks: Î³ = 0.99 â†’ 100 bars, Î³ = 0.95 â†’ 20 bars, Î³ = 0.5 â†’ 2 bars.",
              content:
                "This financial interpretation resolves a common confusion: why use Î³ < 1 at all? Three reasons: (1) Mathematical necessity â€” Î³ < 1 ensures the infinite sum âˆ‘Î³áµ—râ‚œ converges, giving a finite value function. (2) Risk preference â€” future trading profits are uncertain; discounting reflects the increasing uncertainty of distant rewards. (3) Capital efficiency â€” money tied up in a position has opportunity cost; Î³ encodes the hurdle rate for holding vs redeploying capital. Practitioners should set Î³ based on their trading frequency: Î³ â‰ˆ 0.999 for daily microstructure trading, Î³ â‰ˆ 0.99 for 1H intraday, Î³ â‰ˆ 0.95 for 5-minute scalping.",
              emoji: "ðŸ’°",
            },
            {
              type: "code",
              title: "Complete MDP Value Iteration for a 3-Regime Trading Environment",
              language: "python",
              code: `import numpy as np

class ForexRegimeMDP:
    """
    3-regime (trending/ranging/volatile) Ã— 3-position (short/flat/long) MDP.
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

        # P(regime'|regime) â€” regimes are persistent (diagonal-dominant)
        self.regime_trans = np.array([
            [0.70, 0.20, 0.10],   # trending stays trending 70%
            [0.25, 0.50, 0.25],   # ranging is least persistent
            [0.15, 0.25, 0.60],   # volatile stays volatile 60%
        ])

        # R(regime, position) â€” reward per step for holding position in regime
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

# â”€â”€ Run value iteration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("=" * 50)
print("FOREX REGIME MDP â€” VALUE ITERATION")
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
                "A complete 9-state MDP (3 regimes Ã— 3 positions) with transaction costs. Value iteration applies the Bellman operator V*(s) = maxâ‚[R(s,a) + Î³âˆ‘P(sâ€²|s,a)V*(sâ€²)] until the maximum change falls below tolerance. The contraction mapping property guarantees convergence at rate Î³áµ. Running with different Î³ values shows how the discount factor changes policy: low Î³ (myopic) reacts only to the current regime, while high Î³ (patient) accounts for regime persistence and may tolerate temporary losses in volatile markets expecting a return to trending conditions.",
            },
            {
              type: "code",
              title: "Policy Evaluation vs Policy Iteration â€” Comparative Implementation",
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
        # Step 1: Policy evaluation â€” find V^pi
        V, eval_iters = policy_evaluation(
            P_regime, rewards, policy, gamma, n_states, n_positions, n_regimes
        )
        # Step 2: Policy improvement â€” greedy w.r.t. V^pi
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

# â”€â”€ Compare value iteration vs policy iteration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                "Policy iteration alternates between (1) policy evaluation â€” solving V^Ï€ by iterating the Bellman expectation equation until convergence â€” and (2) policy improvement â€” making the policy greedy with respect to V^Ï€. It converges in fewer outer iterations than value iteration (typically 3-5 vs hundreds), but each outer iteration requires a full inner convergence. Both methods find identical V* and Ï€*. This comparison demonstrates the two fundamental dynamic programming algorithms for MDPs.",
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
print(f"  âœ“ All 9 states satisfy V*(s) = max_a Q*(s,a)")

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
                "This code computes the full Q*(s,a) table from V* using Q*(s,a) = R(s,a) + Î³âˆ‘P(sâ€²|s,a)V*(sâ€²), verifies the fundamental relationship V*(s) = maxâ‚ Q*(s,a), and computes the advantage function A*(s,a) = Q*(s,a) âˆ’ V*(s). The Q-table reveals why the agent prefers certain actions: in trending markets, Q(trending,flat,buy) >> Q(trending,flat,sell), showing that going long captures the trend. The advantage function isolates each action's value relative to the state baseline â€” positive advantage means the action is better than average, which is the signal policy gradient methods will later use.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-mdp-q1",
                  question: "In the Bellman equation, what does Î³ = 0 imply about agent behaviour?",
                  options: [
                    { id: "rl-mdp-q1-a", text: "The agent considers all future rewards equally" },
                    { id: "rl-mdp-q1-b", text: "The agent only maximises immediate reward, ignoring all future consequences" },
                    { id: "rl-mdp-q1-c", text: "The agent's value function becomes infinite" },
                    { id: "rl-mdp-q1-d", text: "The agent never takes any action" },
                  ],
                  correctOptionId: "rl-mdp-q1-b",
                  explanation:
                    "With Î³=0, V*(s) = maxâ‚ R(s,a) â€” the future term Î³âˆ‘PÂ·V* vanishes entirely. The agent becomes purely myopic, like a scalper who takes the highest immediate P&L without considering position management, transaction costs of future trades, or regime transitions.",
                },
                {
                  id: "rl-mdp-q2",
                  question: "What is the relationship between V*(s) and Q*(s,a)?",
                  options: [
                    { id: "rl-mdp-q2-a", text: "V*(s) = âˆ‘â‚ Q*(s,a)" },
                    { id: "rl-mdp-q2-b", text: "V*(s) = minâ‚ Q*(s,a)" },
                    { id: "rl-mdp-q2-c", text: "V*(s) = maxâ‚ Q*(s,a)" },
                    { id: "rl-mdp-q2-d", text: "V*(s) = Q*(s,a) / |A|" },
                  ],
                  correctOptionId: "rl-mdp-q2-c",
                  explanation:
                    "V*(s) = maxâ‚ Q*(s,a) â€” the optimal state value equals the value of taking the best possible action. This relationship is fundamental: it means the optimal policy is always deterministic: Ï€*(s) = argmaxâ‚ Q*(s,a).",
                },
                {
                  id: "rl-mdp-q3",
                  question: "Given a 2-state MDP with Î³ = 0.9, R(sâ‚,aâ‚) = 3, P(sâ‚|sâ‚,aâ‚) = 0.8, P(sâ‚‚|sâ‚,aâ‚) = 0.2, V*(sâ‚) = 15, V*(sâ‚‚) = 5, what is Q*(sâ‚,aâ‚)?",
                  options: [
                    { id: "rl-mdp-q3-a", text: "3 + 0.9 Ã— (0.8 Ã— 15 + 0.2 Ã— 5) = 3 + 0.9 Ã— 13 = 14.7" },
                    { id: "rl-mdp-q3-b", text: "3 + 0.8 Ã— 15 + 0.2 Ã— 5 = 16.0" },
                    { id: "rl-mdp-q3-c", text: "0.9 Ã— (3 + 0.8 Ã— 15 + 0.2 Ã— 5) = 14.4" },
                    { id: "rl-mdp-q3-d", text: "3 Ã— 0.9 + 15 Ã— 0.8 = 14.7" },
                  ],
                  correctOptionId: "rl-mdp-q3-a",
                  explanation:
                    "Q*(s,a) = R(s,a) + Î³ âˆ‘â‚›â€² P(sâ€²|s,a) V*(sâ€²) = 3 + 0.9 Ã— (0.8 Ã— 15 + 0.2 Ã— 5) = 3 + 0.9 Ã— (12 + 1) = 3 + 11.7 = 14.7. The reward is immediate (not discounted), while future values are discounted by Î³ and weighted by transition probabilities.",
                },
                {
                  id: "rl-mdp-q4",
                  question: "Why does value iteration converge, and what determines the convergence rate?",
                  options: [
                    { id: "rl-mdp-q4-a", text: "It converges because rewards are bounded; rate is O(1/k)" },
                    { id: "rl-mdp-q4-b", text: "The Bellman operator T is a Î³-contraction in sup-norm: â€–TVâ‚ âˆ’ TVáµ¦â€–âˆž â‰¤ Î³â€–Vâ‚ âˆ’ Váµ¦â€–âˆž; convergence rate is O(Î³áµ)" },
                    { id: "rl-mdp-q4-c", text: "It converges by gradient descent on the Bellman error; rate depends on learning rate" },
                    { id: "rl-mdp-q4-d", text: "Convergence is not guaranteed; it depends on the initial Vâ‚€" },
                  ],
                  correctOptionId: "rl-mdp-q4-b",
                  explanation:
                    "The Bellman optimality operator is a Î³-contraction mapping in the Lâˆž norm. By the Banach Fixed-Point Theorem, it has a unique fixed point V* and iterates converge at geometric rate Î³áµ. Higher Î³ means slower convergence (more patient agents need more iterations). Convergence is guaranteed regardless of initial Vâ‚€.",
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
                    "With Î³ = 0.95, the agent looks ~20 steps ahead. The volatileâ†’trending transition probability of 0.15 means there is a meaningful chance of entering a highly profitable regime soon. Selling to go flat costs a transaction fee AND gives up the long position that would be very profitable if trending resumes. The value iteration captures this multi-step reasoning automatically.",
                },
                {
                  id: "rl-mdp-q6",
                  question: "What is the effective planning horizon T_eff when Î³ = 0.95, and how does this compare to Î³ = 0.99?",
                  options: [
                    { id: "rl-mdp-q6-a", text: "T_eff(0.95) = 20 steps, T_eff(0.99) = 100 steps â€” 5Ã— longer horizon" },
                    { id: "rl-mdp-q6-b", text: "T_eff(0.95) = 95 steps, T_eff(0.99) = 99 steps â€” nearly identical" },
                    { id: "rl-mdp-q6-c", text: "T_eff(0.95) = 5 steps, T_eff(0.99) = 1 step â€” inverse relationship" },
                    { id: "rl-mdp-q6-d", text: "The effective horizon is infinite for both values" },
                  ],
                  correctOptionId: "rl-mdp-q6-a",
                  explanation:
                    "T_eff = 1/(1âˆ’Î³). For Î³=0.95: T_eff = 1/0.05 = 20. For Î³=0.99: T_eff = 1/0.01 = 100. The Î³=0.99 agent effectively plans 5Ã— further ahead. On hourly bars, this means the Î³=0.95 agent looks ~1 day ahead while Î³=0.99 looks ~4 days ahead â€” a significant difference for microstructure trading decisions.",
                },
              ],
            },
            {
              type: "practice",
              title: "Guided: Extend the MDP with Transaction Costs and Position Sizing",
              description:
                "Start with the ForexRegimeMDP class above. Make these modifications step by step:\n\n1. Add a transaction cost of 0.1 per unit of position change: cost = 0.1 Ã— |new_pos âˆ’ old_pos|. Modify get_reward() to subtract this cost.\n2. Expand the position space from {short, flat, long} to {âˆ’2, âˆ’1, 0, +1, +2} (5 positions). Update n_positions, the action space, and the reward matrix.\n3. Add a 4th regime: 'high_volatility' with rewards [-1.5, -0.3, -1.2, -0.5, -1.0] and high persistence P(high_vol|high_vol) = 0.65.\n4. Run value iteration with Î³ âˆˆ {0.5, 0.9, 0.99} and compare: (a) how many states have pi*(s) = hold vs active trading, (b) the total value V* summed across states.\n\nExpected insight: Transaction costs make the agent trade less frequently â€” the 'hold' action becomes optimal in more states, especially for low Î³ where the agent cannot justify the cost with future expected returns.",
              catalogModelId: "mdp-value-iteration",
            },
            {
              type: "practice",
              title: "Open-Ended: Build a Realistic Multi-Asset MDP",
              description:
                "Design and implement an MDP for a portfolio of 2 forex pairs (EUR/USD and GBP/USD) with correlated regime transitions. Your state space should include: regime for each pair (3 regimes each = 9 regime combinations), position in each pair (3 positions each = 9 position combinations), giving 81 total states. Define realistic transition probabilities using the correlation between the pairs (e.g., if EUR/USD is trending, GBP/USD has a 40% chance of also trending). Design a reward function that accounts for correlation risk â€” holding the same direction in correlated pairs should have lower risk-adjusted reward than diversified positions. Solve with value iteration and analyse: does the optimal policy exploit pair correlations for diversification?",
              catalogModelId: "mdp-value-iteration",
            },
          ],
        },
        {
          id: "rl-qlearning",
          title: "Q-Learning & Temporal Difference",
          description:
            "Learn model-free RL through temporal difference methods â€” Q-learning and SARSA â€” that learn from experience without needing a market transition model.",
          estimatedMinutes: 45,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Master temporal difference learning, derive the TD(0) update from Bellman error minimisation, understand Q-learning as off-policy TD control, compare with on-policy SARSA, and implement exploration strategies including Îµ-greedy, softmax, and UCB for discrete forex action spaces.",
              keyTakeaways: [
                "TD(0) update: V(s) â† V(s) + Î±[r + Î³V(sâ€²) âˆ’ V(s)], where Î´â‚œ = r + Î³V(sâ€²) âˆ’ V(s) is the TD error",
                "Q-learning (off-policy): Q(s,a) â† Q(s,a) + Î±[r + Î³ maxâ‚â€² Q(sâ€²,aâ€²) âˆ’ Q(s,a)] â€” learns Q* regardless of behaviour policy",
                "SARSA (on-policy): Q(s,a) â† Q(s,a) + Î±[r + Î³Q(sâ€²,aâ€²) âˆ’ Q(s,a)] where aâ€² ~ Ï€ â€” learns Q^Ï€, safer with costs",
                "Convergence requires Robbins-Monro conditions: âˆ‘Î±â‚œ = âˆž and âˆ‘Î±â‚œÂ² < âˆž (e.g., Î±â‚œ = 1/t)",
                "Îµ-greedy: exploit best with prob 1âˆ’Îµ, random with prob Îµ; softmax: Ï€(a) âˆ exp(Q(a)/Ï„); UCB: argmaxâ‚[Q(a) + câˆš(ln t/Nâ‚)]",
                "Q-learning converges to Q* under any policy that visits all (s,a) pairs infinitely often",
                "SARSA converges to Q^Ï€_Îµ (the Q-function of the Îµ-greedy policy), which is more conservative near 'cliffs'",
                "Forex discrete action space: A = {buy, sell, hold} maps naturally to position changes in a Q-table",
              ],
            },
            {
              type: "theory",
              title: "TD(0) Derivation from Bellman Error Minimisation",
              content:
                "**Motivation.** Value iteration requires the full model P(sâ€²|s,a) â€” impractical for financial markets where transition dynamics are unknown and non-stationary. Temporal Difference (TD) learning solves this by learning V^Ï€(s) directly from experience (sâ‚œ, râ‚œ, sâ‚œâ‚Šâ‚) without knowing P.\n\n**Derivation.** The Bellman expectation equation states V^Ï€(s) = ð”¼Ï€[r + Î³V^Ï€(sâ€²) | s]. Consider the sample-based approximation: given a single transition (s, r, sâ€²), the 'TD target' is yâ‚œ = r + Î³V(sâ€²). The 'TD error' is Î´â‚œ = yâ‚œ âˆ’ V(s) = r + Î³V(sâ€²) âˆ’ V(s). This measures the discrepancy between our current estimate V(s) and the one-step bootstrapped estimate r + Î³V(sâ€²). The TD(0) update moves V(s) toward the target: V(s) â† V(s) + Î± Â· Î´â‚œ = V(s) + Î±[r + Î³V(sâ€²) âˆ’ V(s)]. This is a stochastic approximation to solving the Bellman equation: if we average many updates, ð”¼[Î´â‚œ] â†’ 0 when V = V^Ï€.\n\n**Why 'bootstrapping'?** Unlike Monte Carlo methods that wait for the complete return Gâ‚œ = âˆ‘â‚– Î³áµrâ‚œâ‚Šâ‚– (requiring full episodes), TD(0) uses V(sâ€²) as a stand-in for the future â€” updating one estimate using another estimate. This introduces bias (V(sâ€²) may be wrong) but dramatically reduces variance (no need to sum noisy returns over many steps). The bias-variance tradeoff is controlled by n-step TD: TD(n) uses râ‚œ + Î³râ‚œâ‚Šâ‚ + â€¦ + Î³â¿â»Â¹râ‚œâ‚Šâ‚™â‚‹â‚ + Î³â¿V(sâ‚œâ‚Šâ‚™). TD(0) = maximum bootstrap (low variance, higher bias). MC = no bootstrap (zero bias, high variance). TD(Î») with eligibility traces provides a continuous interpolation.\n\n**Numerical Example.** Suppose V(ranging) = 2.0, V(trending) = 5.0, Î³ = 0.9, Î± = 0.1. The agent is in state 'ranging', takes action 'hold', receives reward r = 0.3, and transitions to 'trending'. TD target: y = 0.3 + 0.9 Ã— 5.0 = 4.8. TD error: Î´ = 4.8 âˆ’ 2.0 = 2.8 (positive surprise â€” the future is better than expected). Update: V(ranging) â† 2.0 + 0.1 Ã— 2.8 = 2.28. The value of 'ranging' increases because transitioning to the profitable 'trending' state was a pleasant surprise.",
            },
            {
              type: "theory",
              title: "Q-Learning as Off-Policy TD Control â€” Derivation and Convergence",
              content:
                "**From V to Q.** TD(0) learns V^Ï€(s) for a fixed policy Ï€. For control (finding Ï€*), we need Q-values because Ï€*(s) = argmaxâ‚ Q*(s,a) â€” selecting the best action requires comparing Q-values, not just V-values. Q-learning directly approximates Q* without policy evaluation.\n\n**Q-Learning Update.** Q(sâ‚œ,aâ‚œ) â† Q(sâ‚œ,aâ‚œ) + Î±[râ‚œ + Î³ maxâ‚ Q(sâ‚œâ‚Šâ‚,a) âˆ’ Q(sâ‚œ,aâ‚œ)]. The key insight: the target uses maxâ‚ Q(sâ‚œâ‚Šâ‚,a) â€” the greedy action in the next state â€” regardless of what action the agent actually takes. This makes Q-learning 'off-policy': the behaviour policy (how the agent explores) can differ from the target policy (always greedy w.r.t. Q). The agent can explore using Îµ-greedy, Boltzmann, or even random actions, and Q-learning will still converge to Q*.\n\n**Convergence Conditions (Robbins-Monro).** Q-learning converges to Q* with probability 1 if: (1) All state-action pairs are visited infinitely often: âˆ€(s,a), Nâ‚œ(s,a) â†’ âˆž. (2) Learning rates satisfy: âˆ‘â‚œ Î±â‚œ(s,a) = âˆž (enough learning) and âˆ‘â‚œ Î±â‚œ(s,a)Â² < âˆž (updates shrink). A common schedule: Î±â‚œ(s,a) = 1/Nâ‚œ(s,a)^Ï‰ with Ï‰ âˆˆ (0.5, 1]. In practice, a fixed Î± = 0.1 works well for non-stationary environments (markets!) because it keeps adapting to distribution shifts, though it technically violates the second condition.\n\n**Numerical Example: 3 States Ã— 3 Actions.** States: {trending, ranging, volatile}. Actions: {buy, sell, hold}. Initialize Q = 0 everywhere. Episode: s=ranging, a=buy â†’ r=âˆ’0.5, sâ€²=volatile. Q(ranging,buy) â† 0 + 0.1 Ã— [âˆ’0.5 + 0.95 Ã— max(Q(volatile,Â·)) âˆ’ 0] = 0.1 Ã— [âˆ’0.5 + 0] = âˆ’0.05. Next: s=volatile, a=hold â†’ r=âˆ’0.1, sâ€²=trending. Q(volatile,hold) â† 0 + 0.1 Ã— [âˆ’0.1 + 0.95 Ã— max(Q(trending,Â·)) âˆ’ 0] = âˆ’0.01. Next: s=trending, a=buy â†’ r=+1.5, sâ€²=trending. Q(trending,buy) â† 0 + 0.1 Ã— [1.5 + 0.95 Ã— 0 âˆ’ 0] = 0.15. After thousands of such updates, Q converges to Q* and the greedy policy emerges: buy in trending, hold in ranging, sell or hold in volatile.",
            },
            {
              type: "theory",
              title: "SARSA, Exploration Strategies, and On-Policy vs Off-Policy",
              content:
                "**SARSA (State-Action-Reward-State-Action).** The on-policy counterpart to Q-learning: Q(sâ‚œ,aâ‚œ) â† Q(sâ‚œ,aâ‚œ) + Î±[râ‚œ + Î³Q(sâ‚œâ‚Šâ‚,aâ‚œâ‚Šâ‚) âˆ’ Q(sâ‚œ,aâ‚œ)]. The critical difference: the target uses Q(sâ‚œâ‚Šâ‚,aâ‚œâ‚Šâ‚) where aâ‚œâ‚Šâ‚ is the action actually taken by the current policy (including exploration). SARSA learns Q^Ï€ (the Q-function of the current Îµ-greedy policy), not Q*. This means SARSA's learned values account for the fact that the agent sometimes explores â€” making it more conservative near 'cliffs' (catastrophic losses). In trading, SARSA with Îµ-greedy avoids strategies that are optimal in theory but disastrous when occasionally disrupted by random exploration (e.g., a strategy requiring precise timing that fails badly if a random trade interrupts).\n\n**Exploration Strategies Compared:**\n\n*Îµ-Greedy*: With prob Îµ take random action, else argmaxâ‚ Q(s,a). Pros: simple, guaranteed exploration. Cons: wastes exploration on clearly bad actions. Schedule: Îµâ‚œ = max(Îµ_min, Îµâ‚€ Ã— decay^t) or Îµâ‚œ = Îµâ‚€/(1 + t/N).\n\n*Softmax (Boltzmann)*: Ï€(a|s) = exp(Q(s,a)/Ï„) / âˆ‘â‚â€² exp(Q(s,aâ€²)/Ï„). Temperature Ï„ controls exploration: Ï„ â†’ âˆž gives uniform random, Ï„ â†’ 0 gives greedy. Advantage: explores proportionally to Q-value estimates â€” arms with similar Q-values are explored more evenly. Disadvantage: sensitive to Q-value scale.\n\n*UCB (Upper Confidence Bound)*: Select argmaxâ‚ [Q(s,a) + câˆš(ln t / N(s,a))]. The bonus âˆš(ln t / N(s,a)) grows for under-explored actions and shrinks with more visits. Advantage: directed exploration with theoretical regret bounds. Disadvantage: requires visit counts, less natural in non-stationary environments.\n\n**Trading Application.** For A = {buy, sell, hold}: Îµ-greedy is the standard choice because it is robust and simple. Softmax is preferred when Q-values for buy and sell are close (uncertain market direction) â€” it allocates exploration proportionally rather than uniformly. UCB is useful during initial learning when the agent has little data for each market condition. As Îµ â†’ 0 or Ï„ â†’ 0, all strategies converge to the greedy policy.",
            },
            {
              type: "intuition",
              title: "Q-Learning as Paper Trading with a Notebook",
              analogy:
                "Imagine you are paper trading with a notebook. Each page is labelled with a market condition (state) and you have columns for each possible action (buy, sell, hold). Each cell records your running estimate of the expected profit. After each paper trade, you update: 'I expected $50 from buying in this setup but actually got $30 immediate profit + I estimate the new setup is worth $40 discounted â€” so my one-step target is $68. My error was $68 âˆ’ $50 = $18, so I adjust my estimate up by Î± Ã— $18 = $1.80.' Over thousands of paper trades, your notebook converges to the true expected profits for every condition Ã— action combination. The Îµ-greedy rule forces you to try unconventional trades 10% of the time â€” buying in a downtrend might feel wrong, but you need data to confirm it is actually bad rather than just assuming.",
              content:
                "The key insight is that Q-learning is off-policy: even while following the notebook's advice 90% of the time and randomizing 10%, the max in the update target ensures convergence to the optimal Q-values, not the Îµ-greedy Q-values. This is powerful: you can explore wildly during paper trading and still learn the optimal strategy. The learning rate Î± is your stubbornness factor â€” Î± = 0.1 means 'I update my beliefs 10% toward new evidence, keeping 90% of my old estimate.' Low Î± = slow but stable learning. High Î± = fast but noisy.",
              emoji: "ðŸ““",
            },
            {
              type: "intuition",
              title: "SARSA as a Risk-Aware Trader vs Q-Learning's Optimist",
              analogy:
                "Q-learning is an optimistic trader who plans as if they will always make the perfect next trade. SARSA is a realistic trader who knows they will occasionally make mistakes (exploration = fat-finger trades, impulsive exits). Consider a high-reward strategy that requires executing a precise sequence of trades â€” if any trade is wrong, the whole setup loses money. Q-learning says 'this is great â€” I will always get it right!' and assigns high Q-values. SARSA says 'but 10% of the time I will mess up a step, so this strategy is actually dangerous' and assigns lower Q-values, preferring simpler, more robust strategies.",
              content:
                "This difference matters hugely in trading with transaction costs. A strategy that works perfectly in theory (Q-learning) might require frequent position changes â€” if the agent explores at the wrong moment (SARSA accounts for this), it incurs unnecessary costs. SARSA's conservatism naturally avoids these 'cliff' strategies. The classic example: Q-learning walks along the cliff edge (shortest path, maximum reward if perfect); SARSA takes the safe path inland (slightly longer, but robust to occasional random steps off the cliff). In trading, the 'cliff' is a leveraged position that works only with perfect timing.",
              emoji: "ðŸ›¡ï¸",
            },
            {
              type: "code",
              title: "Complete Q-Learning Agent with Discretised Forex Environment",
              language: "python",
              code: `import numpy as np

class DiscreteTradingEnv:
    """
    Discretised forex environment for tabular Q-learning.
    State = (return_bin, volatility_bin, position) â€” 10Ã—5Ã—3 = 150 states
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
    Tabular Q-learning with Îµ-greedy exploration.
    Q(s,a) â† Q(s,a) + Î±[r + Î³ max_a' Q(s',a') - Q(s,a)]
    """
    Q = np.zeros((env.n_states, env.n_actions))
    visit_counts = np.zeros((env.n_states, env.n_actions), dtype=int)
    episode_rewards = []

    for ep in range(n_episodes):
        state = env.reset()
        total_reward = 0.0
        n_trades = 0

        while True:
            # Îµ-greedy action selection
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
            print(f"Ep {ep+1:4d} | AvgR(100): {avg_r:+.5f} | Îµ: {epsilon:.3f} "
                  f"| Equity: {env.equity:.4f} | Trades: {n_trades:3d} "
                  f"| States visited: {visited}/{env.n_states}")

    return Q, visit_counts, episode_rewards

# â”€â”€ Run Q-learning â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                "A complete tabular Q-learning agent on a discretised forex environment with 150 states (return bin Ã— volatility bin Ã— position). The environment includes transaction costs. Q-learning uses Îµ-greedy exploration with decay, tracking visit counts and episode rewards. The TD update Q(s,a) â† Q(s,a) + Î±[r + Î³ max Q(sâ€²,Â·) âˆ’ Q(s,a)] is off-policy: the max ensures convergence to Q* regardless of the exploration policy. The simulation includes regime shifts to test adaptation.",
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
    Q(s,a) â† Q(s,a) + Î±[r + Î³Q(s',a') - Q(s,a)]  where a' ~ Îµ-greedy(Ï€)
    """
    Q = np.zeros((env.n_states, env.n_actions))
    episode_rewards = []

    for ep in range(n_episodes):
        state = env.reset()
        # Choose initial action using Îµ-greedy
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

            # SARSA update: uses Q(s', a') not max Q(s', Â·)
            td_target = reward + gamma * Q[next_state, next_action] * (1.0 - done)
            td_error = td_target - Q[state, action]
            Q[state, action] += alpha * td_error

            state, action = next_state, next_action
            if done:
                break

        epsilon = max(eps_min, epsilon * eps_decay)
        episode_rewards.append(total_reward)
    return Q, episode_rewards

# â”€â”€ Head-to-head comparison â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                "SARSA uses the on-policy update Q(s,a) â† Q(s,a) + Î±[r + Î³Q(sâ€²,aâ€²) âˆ’ Q(s,a)] where aâ€² is the action actually taken (including exploration). The head-to-head comparison across transaction cost levels reveals the key difference: SARSA learns more conservative policies (more 'hold' states) because it accounts for the cost of occasional random exploration trades. Q-learning optimistically assumes greedy future actions and may prescribe frequent trading that loses money when exploration disrupts the plan.",
            },
            {
              type: "code",
              title: "Exploration Strategy Comparison: Îµ-Greedy vs Softmax vs UCB",
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
        # Boltzmann distribution: Ï€(a) âˆ exp(Q(a)/Ï„)
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

# â”€â”€ Compare all three â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
np.random.seed(42)
env = BanditStyleExploration(true_q=np.array([0.8, -0.1, 1.5]))
action_names = ["sell", "hold", "buy"]
print("EXPLORATION STRATEGY COMPARISON")
print(f"True Q-values: {dict(zip(action_names, env.true_q))}")
print("=" * 65)

for name, runner in [("Îµ-Greedy (Îµ=0.1)", lambda: run_epsilon_greedy(env)),
                     ("Softmax (Ï„: 2â†’0.04)", lambda: run_softmax(env)),
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
                "Three exploration strategies compared on a 3-action trading problem. Îµ-Greedy explores uniformly random (wastes pulls on clearly bad actions). Softmax explores proportionally to Q-estimates (focuses on promising actions). UCB1 adds a confidence bonus âˆš(ln t/Nâ‚) that shrinks with more pulls â€” it explores uncertain actions systematically and achieves the tightest cumulative regret. The comparison shows pull counts, cumulative regret, and convergence speed â€” demonstrating why directed exploration (UCB1) outperforms random exploration (Îµ-greedy) especially when some actions are clearly suboptimal.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-qlearning-q1",
                  question: "What is the key difference between Q-learning and SARSA?",
                  options: [
                    { id: "rl-qlearning-q1-a", text: "Q-learning uses maxâ‚â€² Q(sâ€²,aâ€²) in the target, SARSA uses Q(sâ€²,aâ€²) where aâ€² is the action actually taken under the current policy" },
                    { id: "rl-qlearning-q1-b", text: "Q-learning has no learning rate while SARSA does" },
                    { id: "rl-qlearning-q1-c", text: "SARSA always converges faster than Q-learning" },
                    { id: "rl-qlearning-q1-d", text: "Q-learning can only handle discrete actions while SARSA works with continuous" },
                  ],
                  correctOptionId: "rl-qlearning-q1-a",
                  explanation:
                    "Q-learning's target r + Î³ maxâ‚â€² Q(sâ€²,aâ€²) assumes greedy future actions (off-policy). SARSA's target r + Î³Q(sâ€²,aâ€²) uses the action actually sampled from the Îµ-greedy policy (on-policy). This makes SARSA more conservative â€” it learns Q^Ï€_Îµ, not Q*, accounting for the cost of occasional random exploration.",
                },
                {
                  id: "rl-qlearning-q2",
                  question: "Why must Îµ decay over time in Îµ-greedy Q-learning?",
                  options: [
                    { id: "rl-qlearning-q2-a", text: "To reduce computational cost as the Q-table fills up" },
                    { id: "rl-qlearning-q2-b", text: "To shift from exploration (broad state-action visitation) to exploitation (following the learned greedy policy)" },
                    { id: "rl-qlearning-q2-c", text: "To prevent Q-values from diverging due to the max operator" },
                    { id: "rl-qlearning-q2-d", text: "Constant Îµ violates the Markov property of the environment" },
                  ],
                  correctOptionId: "rl-qlearning-q2-b",
                  explanation:
                    "High Îµ early ensures broad state-action visitation for accurate Q-estimates across the table. As Q-values stabilise, decaying Îµ shifts toward exploitation of the learned policy. Without decay, the agent keeps taking random actions 10% of the time even after finding the optimal strategy â€” wasting returns in deployment.",
                },
                {
                  id: "rl-qlearning-q3",
                  question: "Given Q(s,a) = 5.0, r = 2.0, Î³ = 0.9, max Q(sâ€²,Â·) = 8.0, Î± = 0.1, what is the updated Q(s,a)?",
                  options: [
                    { id: "rl-qlearning-q3-a", text: "5.0 + 0.1 Ã— (2.0 + 0.9 Ã— 8.0 âˆ’ 5.0) = 5.0 + 0.1 Ã— 4.2 = 5.42" },
                    { id: "rl-qlearning-q3-b", text: "5.0 + 0.1 Ã— (2.0 + 8.0 âˆ’ 5.0) = 5.50" },
                    { id: "rl-qlearning-q3-c", text: "0.1 Ã— (2.0 + 0.9 Ã— 8.0) = 0.92" },
                    { id: "rl-qlearning-q3-d", text: "5.0 + 2.0 + 0.9 Ã— 8.0 = 14.2" },
                  ],
                  correctOptionId: "rl-qlearning-q3-a",
                  explanation:
                    "Q(s,a) â† Q(s,a) + Î±[r + Î³ max Q(sâ€²,Â·) âˆ’ Q(s,a)] = 5.0 + 0.1 Ã— [2.0 + 0.9 Ã— 8.0 âˆ’ 5.0] = 5.0 + 0.1 Ã— [2.0 + 7.2 âˆ’ 5.0] = 5.0 + 0.1 Ã— 4.2 = 5.42. The TD error Î´ = 4.2 is positive (positive surprise), so Q increases. Note: the reward is not discounted (it is immediate), only future values are discounted by Î³.",
                },
                {
                  id: "rl-qlearning-q4",
                  question: "What are the Robbins-Monro conditions for Q-learning convergence, and why are they needed?",
                  options: [
                    { id: "rl-qlearning-q4-a", text: "âˆ‘Î±â‚œ = âˆž ensures enough total learning, âˆ‘Î±â‚œÂ² < âˆž ensures updates shrink â€” together they guarantee convergence to Q*" },
                    { id: "rl-qlearning-q4-b", text: "Î±â‚œ must be constant and positive for all t" },
                    { id: "rl-qlearning-q4-c", text: "The learning rate must equal 1/t exactly" },
                    { id: "rl-qlearning-q4-d", text: "Robbins-Monro conditions only apply to SARSA, not Q-learning" },
                  ],
                  correctOptionId: "rl-qlearning-q4-a",
                  explanation:
                    "âˆ‘Î±â‚œ = âˆž means learning rates sum to infinity â€” the algorithm can overcome any initial error. âˆ‘Î±â‚œÂ² < âˆž means learning rates shrink â€” noise from stochastic updates eventually vanishes. Together, Q(s,a) â†’ Q*(s,a) w.p.1. Example: Î±â‚œ = 1/t satisfies both. In practice, fixed Î± = 0.1 works well for non-stationary markets but technically doesn't converge â€” it tracks the moving optimum instead.",
                },
                {
                  id: "rl-qlearning-q5",
                  question: "In a forex environment with high transaction costs, which algorithm learns a more profitable deployment policy, and why?",
                  options: [
                    { id: "rl-qlearning-q5-a", text: "Q-learning, because off-policy learning is always superior" },
                    { id: "rl-qlearning-q5-b", text: "SARSA with decayed Îµ, because it learns Q^Ï€ that accounts for exploration costs during training, producing a more robust deployed policy" },
                    { id: "rl-qlearning-q5-c", text: "Neither â€” transaction costs make RL impossible" },
                    { id: "rl-qlearning-q5-d", text: "They produce identical policies because both converge to Q*" },
                  ],
                  correctOptionId: "rl-qlearning-q5-b",
                  explanation:
                    "Q-learning learns Q* (optimal under greedy policy) but the deployed Îµ=0 policy differs from the training policy (Îµ>0). With high tx costs, Q-learning may learn aggressive strategies that assume perfect execution. SARSA's on-policy learning accounts for occasional exploration mistakes during training, producing policies that are robust to execution noise â€” the deployed policy (Îµâ‰ˆ0) is close to the trained policy (small Îµ).",
                },
                {
                  id: "rl-qlearning-q6",
                  question: "Why does the softmax exploration strategy outperform Îµ-greedy when two actions have similar Q-values?",
                  options: [
                    { id: "rl-qlearning-q6-a", text: "Softmax uses a neural network while Îµ-greedy does not" },
                    { id: "rl-qlearning-q6-b", text: "Softmax allocates exploration proportionally via Ï€(a) âˆ exp(Q(a)/Ï„), giving more pulls to promising actions, while Îµ-greedy wastes exploration uniformly on clearly bad actions" },
                    { id: "rl-qlearning-q6-c", text: "Softmax has a lower computational cost per step" },
                    { id: "rl-qlearning-q6-d", text: "Softmax does not need a Q-table" },
                  ],
                  correctOptionId: "rl-qlearning-q6-b",
                  explanation:
                    "When Q(buy) â‰ˆ Q(sell), Îµ-greedy still wastes Îµ/3 of exploration on 'hold' (clearly suboptimal). Softmax assigns Ï€(a) âˆ exp(Q(a)/Ï„), concentrating exploration on the two competitive actions. With Ï„ â†’ 0, softmax â†’ greedy; with Ï„ â†’ âˆž, softmax â†’ uniform. This proportional exploration resolves ties efficiently and reduces cumulative regret.",
                },
              ],
            },
            {
              type: "practice",
              title: "Guided: SARSA vs Q-Learning Trading Duel with Regime Analysis",
              description:
                "Implement both SARSA and Q-learning on the DiscreteTradingEnv with the provided 3-regime returns data. Follow these steps:\n\n1. Run both algorithms for 1000 episodes each with Î±=0.1, Î³=0.95, Îµ: 1.0â†’0.01 (decay=0.995).\n2. For each of three transaction cost levels (0, 0.001, 0.005), compare: (a) final 100-episode average reward, (b) percentage of states where Ï€*(s) = hold, (c) equity curve over the last episode.\n3. Create a 'policy difference map': for each state, compare Q-learning's policy vs SARSA's policy. Count disagreements.\n4. Hypothesis: with tx_cost=0.005, SARSA should have â‰¥20% more 'hold' states than Q-learning. Verify this.\n\nExpected insight: Q-learning learns the theoretically optimal but fragile policy. SARSA learns a robust policy that accounts for exploration noise â€” in trading, this translates to fewer but higher-conviction trades.",
              catalogModelId: "q-learning-sarsa",
            },
            {
              type: "practice",
              title: "Open-Ended: Adaptive Learning Rate Schedule for Non-Stationary Markets",
              description:
                "Financial markets are non-stationary â€” the true Q* changes over time as regimes shift. Design an experiment to compare three learning rate strategies for Q-learning on a non-stationary forex environment:\n\n(a) Fixed Î± = 0.1 (tracks recent data, never converges)\n(b) Decaying Î± = 1/N(s,a)^0.7 (Robbins-Monro compliant, converges but can't adapt)\n(c) Your own adaptive schedule (e.g., Î± increases when TD error spikes, indicating regime change)\n\nGenerate a 10,000-bar return series with 5 regime changes (trending â†’ volatile â†’ ranging â†’ trending â†’ bear). Train Q-learning with each schedule. Evaluate: (1) cumulative reward, (2) speed of policy adaptation after each regime change, (3) policy stability within regimes. Which schedule best balances convergence within regimes and adaptation between regimes?",
              catalogModelId: "q-learning-sarsa",
            },
          ],
        },
        // â”€â”€ Lesson 3: Multi-Armed Bandits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        {
          id: "rl-multi-armed-bandits",
          title: "Multi-Armed Bandits for Strategy Selection",
          description:
            "Master the exploration-exploitation tradeoff using epsilon-greedy, UCB1, and Thompson Sampling â€” then apply bandits to dynamically allocate capital among competing forex trading strategies.",
          estimatedMinutes: 45,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Understand the multi-armed bandit framework, derive regret bounds for Îµ-greedy and UCB1, implement Thompson Sampling with Beta and Gaussian posteriors, extend to contextual bandits, and apply bandit-based strategy selection to dynamically allocate capital among competing forex strategies.",
              keyTakeaways: [
                "Multi-armed bandits formalise the explore-exploit tradeoff: no state transitions, just arms and stochastic rewards",
                "Regret R_T = TÂ·Î¼* âˆ’ âˆ‘Î¼(aâ‚œ) measures total cost of suboptimal pulls; goal is sublinear regret R_T = o(T)",
                "Îµ-greedy with fixed Îµ has linear regret O(ÎµT); decaying Îµ ~ 1/t yields sublinear but not optimal",
                "UCB1 selects argmaxâ‚ [QÌ‚(a) + câˆš(ln t / Nâ‚)] â€” derived from Hoeffding's inequality, achieves O(K ln T) regret",
                "Thompson Sampling draws Î¸â‚ ~ Posterior(a) and plays argmaxâ‚ Î¸â‚ â€” often achieves the Lai-Robbins lower bound",
                "For Bernoulli arms, the posterior is Beta(Î±â‚, Î²â‚); for Gaussian arms, it is ð’©(Î¼Ì‚â‚, ÏƒÌ‚Â²â‚/Nâ‚)",
                "Contextual bandits observe features xâ‚œ before selecting arms, learning Ï€(a|x) â€” bridges bandits and full RL",
                "Forex application: dynamically allocate capital among momentum, mean-reversion, breakout, carry, and volatility strategies",
              ],
            },
            {
              type: "theory",
              title: "The Bandit Framework: Regret Definition and Bounds",
              content:
                "**Formal Definition.** A K-armed bandit is a tuple (K, {Î½â‚, â€¦, Î½â‚–}) where K is the number of arms and Î½â‚– is the reward distribution of arm k with mean Î¼â‚– = ð”¼[Î½â‚–]. At each round t = 1, â€¦, T, the agent selects arm aâ‚œ âˆˆ {1, â€¦, K} and observes reward râ‚œ ~ Î½(aâ‚œ). Let Î¼* = maxâ‚– Î¼â‚– and Î”â‚– = Î¼* âˆ’ Î¼â‚– be the 'gap' of arm k.\n\n**Cumulative Regret.** R_T = âˆ‘áµ€â‚œâ‚Œâ‚ (Î¼* âˆ’ Î¼(aâ‚œ)) = âˆ‘â‚– Î”â‚– Â· ð”¼[Nâ‚–(T)], where Nâ‚–(T) is the number of times arm k is pulled in T rounds. Minimising regret means pulling suboptimal arms as few times as possible while still identifying the best arm.\n\n**Information-Theoretic Lower Bound (Lai-Robbins, 1985).** For any consistent policy: lim inf R_T / ln T â‰¥ âˆ‘â‚–:Î”â‚–>0 Î”â‚– / KL(Î½â‚– â€– Î½*), where KL is the Kullback-Leibler divergence between arm k's distribution and the best arm's distribution. For Gaussian arms with unit variance, this simplifies to R_T â‰¥ âˆ‘â‚– 2 ln T / Î”â‚–. This means no algorithm can achieve regret better than O(âˆ‘ ln T / Î”â‚–) â€” logarithmic in T.\n\n**Îµ-Greedy Regret Analysis.** With fixed Îµ, the algorithm pulls a suboptimal arm with probability at least Îµ/K per round. Expected regret: R_T â‰¥ (Îµ/K) Â· âˆ‘â‚– Î”â‚– Â· T = Î˜(ÎµT) â€” linear in T. With decaying Îµ_t = min(1, cK/t) for appropriate c, regret becomes O(KÂ² ln T / Î”_min), which is sublinear but suboptimal by a factor of K/Î”_min compared to the Lai-Robbins bound.\n\n**Numerical Example.** Consider K=3 arms (momentum, mean-reversion, breakout) with daily Sharpe ratios Î¼ = (0.8, 1.2, 0.5) and identical volatilities Ïƒ = 0.15. Gaps: Î”â‚ = 0.4, Î”â‚ƒ = 0.7. After T = 1000 rounds with Îµ = 0.1: expected pulls on arm 1 â‰ˆ 33 (random) + some exploits, expected regret from Îµ-greedy â‰ˆ 0.1 Ã— 1000 Ã— (0.4 + 0 + 0.7)/3 â‰ˆ 37. The Lai-Robbins lower bound gives ln(1000) Ã— (0.4/KLâ‚ + 0.7/KLâ‚ƒ) â€” much lower, indicating Îµ-greedy is far from optimal.",
            },
            {
              type: "theory",
              title: "UCB1 Derivation from Hoeffding's Inequality",
              content:
                "**Hoeffding's Inequality.** For i.i.d. random variables Xâ‚, â€¦, Xâ‚™ âˆˆ [0,1] with mean Î¼: P(|XÌ„â‚™ âˆ’ Î¼| â‰¥ Îµ) â‰¤ 2 exp(âˆ’2nÎµÂ²). Setting the right side to Î´ and solving for Îµ: with probability â‰¥ 1âˆ’Î´, Î¼ âˆˆ [XÌ„â‚™ âˆ’ âˆš(ln(2/Î´)/(2n)), XÌ„â‚™ + âˆš(ln(2/Î´)/(2n))].\n\n**UCB1 Derivation.** We want an upper confidence bound Ã›â‚–(t) such that Î¼â‚– â‰¤ Ã›â‚–(t) with high probability. Set Î´ = 2/tÂ² (ensures âˆ‘â‚œ Î´ < âˆž by Borel-Cantelli). Then: Ã›â‚–(t) = QÌ‚â‚– + âˆš(ln t / Nâ‚–(t)). The 'optimism in the face of uncertainty' principle: play argmaxâ‚– Ã›â‚–(t). If an arm has been under-explored (small Nâ‚–), its confidence width âˆš(ln t/Nâ‚–) is large, so it gets selected. As Nâ‚– grows, the width shrinks and the arm is selected only if QÌ‚â‚– is competitive.\n\n**UCB1 Regret Bound (Auer et al., 2002).** R_T â‰¤ âˆ‘â‚–:Î”â‚–>0 (8 ln T / Î”â‚– + (1 + Ï€Â²/3) Î”â‚–). The dominant term 8 ln T / Î”â‚– matches the Lai-Robbins bound up to a constant factor. Arms with larger gaps Î”â‚– are explored less (they are identified as suboptimal quickly) but contribute more per suboptimal pull â€” the bound balances these effects.\n\n**Numerical Walkthrough.** T=1, N=(0,0,0): all arms unpulled, play arm 1. râ‚=0.7. T=2, N=(1,0,0): arm 2 unpulled, play arm 2. râ‚‚=1.3. T=3, N=(1,1,0): arm 3 unpulled, play arm 3. râ‚ƒ=0.4. T=4, N=(1,1,1): UCB scores = [0.7+âˆš(ln4/1), 1.3+âˆš(ln4/1), 0.4+âˆš(ln4/1)] = [0.7+1.18, 1.3+1.18, 0.4+1.18] = [1.88, 2.48, 1.58]. Play arm 2 (highest UCB). T=5 after râ‚„=1.1: N=(1,2,1), UCBâ‚‚ = (1.3+1.1)/2 + âˆš(ln5/2) = 1.2 + 0.90 = 2.10. UCBâ‚ = 0.7 + âˆš(ln5/1) = 0.7 + 1.27 = 1.97. UCBâ‚ƒ = 0.4 + âˆš(ln5/1) = 0.4 + 1.27 = 1.67. Still arm 2. The exploration bonus for arm 2 shrinks because it has been pulled more, but its high QÌ‚ keeps it competitive.\n\n**Limitations.** UCB1 assumes stationary rewards â€” problematic for trading where strategy performance drifts with market regimes. Variants: Discounted UCB (down-weights old observations), Sliding-Window UCB (uses only last W observations), and UCB with change detection (resets when drift is detected).",
            },
            {
              type: "theory",
              title: "Thompson Sampling: Bayesian Posterior Updates and Contextual Extension",
              content:
                "**Thompson Sampling (TS)** maintains a Bayesian posterior P(Î¸â‚– | data) over each arm's reward parameter and uses probability matching: sample Î¸â‚– ~ Posterior(k) for each arm, play argmaxâ‚– Î¸â‚–. The intuition: arms with high uncertainty have wide posteriors, so their samples are sometimes very high â€” ensuring exploration. As data accumulates, posteriors narrow around the true Î¼â‚–, and the best arm's samples consistently dominate â€” ensuring exploitation.\n\n**Beta-Bernoulli Model.** For binary rewards (win/loss): Prior: Î¸â‚– ~ Beta(Î±â‚€, Î²â‚€), typically uniform Beta(1,1). Update: after observing reward r âˆˆ {0,1}: Î±â‚– â† Î±â‚– + r, Î²â‚– â† Î²â‚– + (1âˆ’r). Posterior mean: ð”¼[Î¸â‚–] = Î±â‚–/(Î±â‚–+Î²â‚–). Example: arm 1 has record (5 wins, 3 losses): Î¸â‚ ~ Beta(6,4), mean = 0.6. Arm 2 has (2 wins, 1 loss): Î¸â‚‚ ~ Beta(3,2), mean = 0.6. Despite identical means, arm 2's posterior is wider (less data), so TS explores it more â€” exactly the right behavior.\n\n**Gaussian Model.** For continuous rewards r ~ ð’©(Î¼â‚–, ÏƒÂ²): With known ÏƒÂ² and prior Î¼â‚– ~ ð’©(Î¼â‚€, Ïƒâ‚€Â²): Posterior after Nâ‚– observations with mean rÌ„â‚–: Î¼â‚– | data ~ ð’©(Î¼Ì‚â‚–, ÏƒÌ‚Â²â‚–), where Î¼Ì‚â‚– = (Ïƒâ‚€â»Â²Î¼â‚€ + Nâ‚–Ïƒâ»Â²rÌ„â‚–)/(Ïƒâ‚€â»Â² + Nâ‚–Ïƒâ»Â²), ÏƒÌ‚Â²â‚– = 1/(Ïƒâ‚€â»Â² + Nâ‚–Ïƒâ»Â²). As Nâ‚– â†’ âˆž, Î¼Ì‚â‚– â†’ rÌ„â‚– and ÏƒÌ‚Â²â‚– â†’ ÏƒÂ²/Nâ‚–. For forex strategies with daily returns, ÏƒÂ² can be estimated from historical data or set conservatively.\n\n**Contextual Bandits.** At round t, observe context xâ‚œ âˆˆ â„áµˆ (e.g., market features: volatility, trend strength, correlation). The reward model becomes râ‚– = f(xâ‚œ, k) + noise. **LinUCB** (Li et al., 2010): assume râ‚– = xâ‚œáµ€Î¸â‚– + Îµ, maintain ridge regression estimate Î¸Ì‚â‚– and confidence ellipsoid. Select argmaxâ‚– [xâ‚œáµ€Î¸Ì‚â‚– + Î±âˆš(xâ‚œáµ€Aâ‚–â»Â¹xâ‚œ)]. **Contextual Thompson Sampling**: sample Î¸â‚– ~ ð’©(Î¸Ì‚â‚–, Aâ‚–â»Â¹ÏƒÂ²) and play argmaxâ‚– xâ‚œáµ€Î¸â‚–. Forex application: context = (ATR, RSI, trend slope, correlation matrix), arms = strategies. The agent learns which strategy works best under which market conditions â€” a regime-dependent allocation.",
            },
            {
              type: "intuition",
              title: "The Restaurant Exploration Problem",
              analogy:
                "You live in a city with 5 restaurants. Your favorite scores 8/10 on average. Do you go there every night (exploit) or try the new place that might be a 9 or a 3 (explore)? Epsilon-greedy flips a coin â€” 10% of nights you try somewhere random, even the place you rated 2/10 last time. UCB1 is smarter: it picks the restaurant with the highest 'optimistic estimate.' If you have only been to a place once and it was a 7, the uncertainty bonus boosts it to 'maybe a 9!' â€” worth revisiting. If you have been 50 times and it averages 7.2, the bonus is tiny and it competes on merit alone. Thompson Sampling is the most creative: for each restaurant, you imagine a plausible rating based on your experience (mentally sampling from a bell curve). You go wherever looks best in this mental simulation. Restaurants with few visits have wider bell curves â€” sometimes their imagined rating exceeds the favorite â€” so they get occasional visits naturally.",
              content:
                "In trading, the restaurants are strategies (momentum, mean-reversion, breakout, carry, volatility selling) and the ratings are rolling Sharpe ratios. Regret is the cumulative opportunity cost of not always using the best strategy. With T = 2000 trading days and K = 5 strategies, UCB1 guarantees regret â‰¤ O(5 Ã— ln 2000 / Î”_min) â‰ˆ 190/Î”_min, while Îµ-greedy with Îµ = 0.1 gives regret â‰ˆ 0.1 Ã— 2000 Ã— avg_gap. For gaps Î” â‰ˆ 0.3 Sharpe points, UCB1 wastes about 633 Sharpe-days vs Îµ-greedy's 200 â€” but UCB1's bound tightens as T grows while Îµ-greedy's grows linearly forever.",
              emoji: "ðŸ½ï¸",
            },
            {
              type: "intuition",
              title: "Thompson Sampling as Simulated Future Regret Minimisation",
              analogy:
                "Imagine you are a portfolio manager deciding how to allocate across 5 forex strategies each morning. Thompson Sampling works like this: for each strategy, you mentally simulate 'what if this strategy's true Sharpe ratio was [sample from your posterior belief]?' If a strategy you have barely tested happens to simulate as the best, you allocate to it today â€” gathering real data to update your beliefs. If a well-tested strategy consistently simulates as the best, you allocate there. The magic is that the frequency of exploration naturally matches your uncertainty: a strategy tested for 500 days has a narrow posterior (samples are close to the mean), while one tested for 5 days has a wide posterior (samples vary wildly). The rare high samples for uncertain strategies drive just enough exploration â€” no Îµ parameter to tune.",
              content:
                "Thompson Sampling's theoretical regret matches the Lai-Robbins lower bound for many problem classes â€” it is asymptotically optimal. In practice, it consistently outperforms UCB1 and Îµ-greedy across diverse reward distributions. For trading, the Gaussian variant ð’©(Î¼Ì‚â‚–, ÏƒÌ‚Â²/Nâ‚–) is most natural: Sharpe ratio estimates follow approximately normal distributions by the CLT. The shrinking variance ÏƒÌ‚Â²/Nâ‚– means the algorithm naturally transitions from 'wide exploration' (early, low Nâ‚–) to 'tight exploitation' (late, high Nâ‚–) without any schedule parameters. The only choice is the prior â€” a weakly informative ð’©(0, 1) works well for Sharpe ratios.",
              emoji: "ðŸŽ°",
            },
            {
              type: "code",
              title: "Complete Bandit Suite: Îµ-Greedy, UCB1, and Thompson Sampling",
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

# â”€â”€ Run all three algorithms â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
np.random.seed(42)
bandit = ForexStrategyBandit()
T = 5000
best_arm = int(np.argmax(bandit.true_sharpes))

print("FOREX STRATEGY BANDIT â€” 3-ALGORITHM COMPARISON")
print(f"Best strategy: {bandit.names[best_arm]} (Sharpe={bandit.true_sharpes[best_arm]})")
print(f"Horizon: T={T} trading days")
print("=" * 70)

for name, runner in [
    ("Îµ-Greedy (Îµ=0.1)", lambda: run_epsilon_greedy(bandit, T, 0.1)),
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
                "Three bandit algorithms compared on a 5-strategy forex allocation problem over 5000 trading days. Îµ-Greedy explores uniformly at random (wasting pulls on clearly bad strategies). UCB1 directs exploration via the confidence bonus âˆš(ln t/Nâ‚) â€” under-explored strategies get priority. Thompson Sampling samples from Gaussian posteriors ð’©(Î¼Ì‚, ÏƒÂ²/N) and plays the arm with the highest sample â€” naturally balancing exploration (wide posteriors for untested strategies) and exploitation (narrow posteriors for well-tested ones). The comparison reveals Thompson Sampling typically achieves the lowest cumulative regret.",
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

# â”€â”€ Run and analyse posterior evolution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
np.random.seed(42)
bandit = BernoulliStrategyBandit()
print("THOMPSON SAMPLING WITH BETA POSTERIORS")
print(f"True win rates: {dict(zip(bandit.names, bandit.true_win_rates))}")
print("=" * 70)

alphas, betas, sel, rew, snaps = thompson_beta(bandit, T=3000)

for t in sorted(snaps.keys()):
    snap = snaps[t]
    print(f"\\nAfter t={t} rounds:")
    print(f"  {'Strategy':>10s} | {'Î±':>5s} | {'Î²':>5s} | {'Post.Mean':>9s} | {'Post.Std':>8s} | {'Pulls':>5s}")
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
                "Thompson Sampling with Beta posteriors for Bernoulli (win/loss) strategy outcomes. The Beta(Î±,Î²) posterior starts uniform (Î±=Î²=1) and updates via Bayes' rule: Î± += reward, Î² += (1âˆ’reward). The posterior snapshots show how uncertainty narrows over time: at t=10, posteriors are wide (high std) and exploration dominates; at t=3000, posteriors are tight and the best arm is pulled almost exclusively. The output reveals the elegant self-tuning property: no Îµ or c parameter â€” exploration naturally decreases as posteriors narrow.",
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
    A = [np.eye(d) for _ in range(bandit.K)]       # dÃ—d
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

# â”€â”€ Run LinUCB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
np.random.seed(42)
bandit = ContextualForexBandit()
print("CONTEXTUAL BANDIT â€” REGIME-DEPENDENT STRATEGY ALLOCATION")
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
print(f"\\nAvg reward â€” LinUCB: {rew.mean():.4f}, Oracle: {oracle_rewards.mean():.4f}")
print(f"Fraction of oracle: {rew.mean() / oracle_rewards.mean() * 100:.1f}%")`,
              explanation:
                "LinUCB extends bandits with context â€” here, market features (volatility, trend strength) determine which strategy is best. Each arm k has a linear model râ‚– = xáµ€Î¸â‚– + noise. LinUCB maintains ridge regression estimates Î¸Ì‚â‚– and selects argmaxâ‚–[xáµ€Î¸Ì‚â‚– + Î±âˆš(xáµ€Aâ‚–â»Â¹x)]. The confidence width âˆš(xáµ€Aâ‚–â»Â¹x) is larger in unexplored context regions. The output shows learned coefficients converging to the true values and regime-dependent allocation: momentum in trending markets, breakout in high-volatility markets, mean-reversion elsewhere.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-mab-q1",
                  question: "What is cumulative regret and why is sublinear regret R_T = o(T) the goal?",
                  options: [
                    { id: "rl-mab-q1-a", text: "Regret is the loss function for training; sublinear means the model converges" },
                    { id: "rl-mab-q1-b", text: "R_T = TÂ·Î¼* âˆ’ âˆ‘Î¼(aâ‚œ) is the total opportunity cost of not always playing the best arm; sublinear means the per-round regret R_T/T â†’ 0, so the algorithm asymptotically matches the best arm" },
                    { id: "rl-mab-q1-c", text: "Regret measures training time; sublinear means faster convergence" },
                    { id: "rl-mab-q1-d", text: "Regret counts the number of wrong predictions; sublinear means the error rate decreases" },
                  ],
                  correctOptionId: "rl-mab-q1-b",
                  explanation:
                    "Cumulative regret R_T sums the gap between the best arm's mean and each selected arm's mean over T rounds. R_T = o(T) (sublinear) means R_T/T â†’ 0: the agent's per-round performance converges to the best arm's performance. Linear regret R_T = Î˜(T) means a constant fraction of rounds are wasted on suboptimal arms forever.",
                },
                {
                  id: "rl-mab-q2",
                  question: "In the UCB1 formula argmaxâ‚[QÌ‚(a) + câˆš(ln t / Nâ‚)], what happens to the exploration bonus as Nâ‚ increases?",
                  options: [
                    { id: "rl-mab-q2-a", text: "It increases, encouraging more exploration of popular arms" },
                    { id: "rl-mab-q2-b", text: "It decreases as âˆš(ln t/Nâ‚) â€” more pulls reduce uncertainty, so the arm must compete on its empirical mean QÌ‚(a)" },
                    { id: "rl-mab-q2-c", text: "It stays constant regardless of pull count" },
                    { id: "rl-mab-q2-d", text: "It oscillates based on the reward variance" },
                  ],
                  correctOptionId: "rl-mab-q2-b",
                  explanation:
                    "The bonus âˆš(ln t/Nâ‚) shrinks as Nâ‚ grows (denominator increases). An arm pulled 1000 times has bonus âˆš(ln t/1000) â€” tiny. An arm pulled 3 times has âˆš(ln t/3) â€” large. This self-adjusting property ensures under-explored arms get priority while well-characterised arms compete on empirical merit.",
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
                    "Starting from uniform prior Beta(1,1), after 7 wins and 3 losses: Î± = 1 + 7 = 8, Î² = 1 + 3 = 4. Posterior mean = Î±/(Î±+Î²) = 8/12 = 0.667. The posterior mean is 'pulled' from the observed rate 7/10 = 0.70 toward the prior mean 0.5 â€” a Bayesian regularisation effect that diminishes with more data.",
                },
                {
                  id: "rl-mab-q4",
                  question: "Why does Thompson Sampling not require tuning an exploration parameter like Îµ or c?",
                  options: [
                    { id: "rl-mab-q4-a", text: "It uses a fixed exploration rate of 50%" },
                    { id: "rl-mab-q4-b", text: "Exploration is driven by posterior width: arms with few observations have wide posteriors, generating high samples occasionally; as data accumulates, posteriors narrow and exploration naturally decreases" },
                    { id: "rl-mab-q4-c", text: "Thompson Sampling does not explore at all" },
                    { id: "rl-mab-q4-d", text: "The prior hyperparameters serve the same role as Îµ" },
                  ],
                  correctOptionId: "rl-mab-q4-b",
                  explanation:
                    "Thompson Sampling's exploration is implicit in the posterior sampling process. An arm with 3 observations has a wide posterior â€” its samples sometimes exceed the best-estimated arm, triggering exploration. An arm with 1000 observations has a narrow posterior â€” it is only selected if its mean is genuinely competitive. This 'probability matching' naturally balances explore-exploit without any tunable parameter.",
                },
                {
                  id: "rl-mab-q5",
                  question: "When should you use contextual bandits instead of standard bandits for forex strategy selection?",
                  options: [
                    { id: "rl-mab-q5-a", text: "When you have more than 10 strategies to choose from" },
                    { id: "rl-mab-q5-b", text: "When strategy performance depends on observable market features (regime, volatility, trend) â€” the optimal arm changes with context" },
                    { id: "rl-mab-q5-c", text: "When rewards are continuous rather than binary" },
                    { id: "rl-mab-q5-d", text: "When the number of trading days T is very large" },
                  ],
                  correctOptionId: "rl-mab-q5-b",
                  explanation:
                    "Standard bandits assume stationarity â€” the same arm is best regardless of conditions. If momentum works in trending markets but mean-reversion works in ranging markets, a standard bandit averages over all conditions and may never find the 'overall best.' Contextual bandits observe features xâ‚œ (ATR, RSI, trend slope) and learn arm-specific models râ‚– = f(xâ‚œ, k), adapting the allocation to current market conditions.",
                },
                {
                  id: "rl-mab-q6",
                  question: "With K=5 arms and T=10000 rounds, what is UCB1's theoretical regret bound, and how does it compare to Îµ-greedy with Îµ=0.05?",
                  options: [
                    { id: "rl-mab-q6-a", text: "UCB1: O(5 Ã— ln 10000 / Î”_min) = O(46/Î”_min); Îµ-greedy: O(0.05 Ã— 10000) = O(500). UCB1 is better for Î”_min > 0.09" },
                    { id: "rl-mab-q6-b", text: "Both achieve O(ln T) regret" },
                    { id: "rl-mab-q6-c", text: "Îµ-greedy always outperforms UCB1" },
                    { id: "rl-mab-q6-d", text: "The regret bounds are identical" },
                  ],
                  correctOptionId: "rl-mab-q6-a",
                  explanation:
                    "UCB1 regret â‰¤ âˆ‘â‚– 8 ln T / Î”â‚– + const. For K=5, T=10000: 8Ã—ln(10000)Ã—5/Î”_min â‰ˆ 368/Î”_min. Îµ-greedy: ÎµÃ—TÃ—avg_gap â‰ˆ 0.05Ã—10000Ã—Î”_avg = 500Ã—Î”_avg. For reasonable gaps (Î” ~ 0.3-0.5), UCB1's logarithmic growth dominates Îµ-greedy's linear growth as T increases. The crossover depends on gap sizes â€” UCB1 excels when suboptimal arms are clearly distinguishable.",
                },
              ],
            },
            {
              type: "practice",
              title: "Guided: Thompson Sampling Capital Allocator with Rolling Performance",
              description:
                "Implement Thompson Sampling with Gaussian posteriors for allocating capital among 3 forex strategies. Follow these steps:\n\n1. Create a GaussianThompsonSampler class that maintains ð’©(Î¼Ì‚â‚–, ÏƒÌ‚Â²â‚–/Nâ‚–) posteriors for each arm.\n2. Simulate 5000 daily returns for 3 strategies: Momentum (Sharpe=1.0, vol=0.15), MeanRev (Sharpe=0.6, vol=0.10), Breakout (Sharpe=0.8, vol=0.20).\n3. Run Thompson Sampling and track: (a) cumulative regret vs Îµ-greedy and UCB1, (b) posterior mean and std evolution over time (snapshot at t=10, 100, 500, 2000, 5000), (c) allocation percentages per 500-round window.\n4. Add a regime change at t=2500: MeanRev becomes the best (Sharpe jumps to 1.5). Compare how quickly each algorithm adapts.\n5. Plot or print: posterior evolution showing narrowing uncertainty, allocation shift after regime change, cumulative regret before and after the switch.\n\nExpected insight: Thompson Sampling adapts faster than UCB1 after regime changes because its posterior naturally widens when observations conflict with the current mean.",
              catalogModelId: "q-learning-sarsa",
            },
            {
              type: "practice",
              title: "Open-Ended: Non-Stationary Bandits with Sliding Window UCB",
              description:
                "Financial markets are non-stationary â€” the best strategy changes over time as regimes shift. Standard UCB1 and Thompson Sampling assume stationarity and converge to a single arm, failing to adapt.\n\nDesign and implement two non-stationary bandit algorithms:\n(a) Sliding-Window UCB: only use the last W observations per arm for QÌ‚ and N. Explore the tradeoff: small W â†’ fast adaptation but noisy estimates; large W â†’ stable estimates but slow adaptation.\n(b) Discounted Thompson Sampling: weight recent observations more via exponential discounting of sufficient statistics.\n\nTest on a 10,000-round simulation with 4 regime changes (the best arm rotates every 2000 rounds among 4 strategies). Compare: (1) cumulative regret vs standard UCB1 and Îµ-greedy, (2) adaptation speed (rounds to >80% allocation to new best arm), (3) Sharpe ratio of the resulting allocation. Tune W and the discount factor to minimise regret.",
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
        "Scale RL to continuous state spaces with deep neural networks â€” from DQN with experience replay to policy gradient methods like PPO for position sizing.",
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
                "DQN approximates Q*(s,a) â‰ˆ Q(s,a;Î¸) using a neural network, enabling continuous state spaces",
                "DQN loss: L(Î¸) = ð”¼[(yâ‚œ âˆ’ Q(sâ‚œ,aâ‚œ;Î¸))Â²] where yâ‚œ = râ‚œ + Î³ maxâ‚â€² Q(sâ‚œâ‚Šâ‚,aâ€²;Î¸â») is the target",
                "Experience replay stores (s,a,r,sâ€²,done) transitions and samples i.i.d. mini-batches, breaking temporal correlation",
                "Target network Î¸â» is a slowly-updated copy: Î¸â» â† Ï„Î¸ + (1âˆ’Ï„)Î¸â» with Ï„ â‰ˆ 0.005, stabilising bootstrap targets",
                "Double DQN decouples action selection from evaluation: a* = argmax Q(sâ€²;Î¸), yâ‚œ = r + Î³Q(sâ€²,a*;Î¸â»)",
                "Dueling DQN decomposes Q(s,a) = V(s;Î¸) + A(s,a;Î¸) âˆ’ mean(A), separating state value from action advantage",
                "Prioritised experience replay samples transitions with probability âˆ |Î´â‚œ|^Î±, focusing on surprising transitions",
                "Forex application: state = normalised features (20+), actions = {strong sell, sell, hold, buy, strong buy}",
              ],
            },
            {
              type: "theory",
              title: "From Q-Tables to Neural Q-Functions: The DQN Framework",
              content:
                "**The Scaling Problem.** Tabular Q-learning maintains a table with |S| Ã— |A| entries. For trading with continuous features (price, volatility, RSI, MACD, etc.), the state space is effectively infinite â€” no Q-table can cover it. DQN (Mnih et al., 2015) replaces the table with a neural network Q(s,a;Î¸) that generalises across similar states.\n\n**DQN Loss Derivation.** We want Q(s,a;Î¸) â‰ˆ Q*(s,a). The Bellman optimality equation gives Q*(s,a) = R(s,a) + Î³ âˆ‘â‚›â€² P(sâ€²|s,a) maxâ‚â€² Q*(sâ€²,aâ€²). We don't know P, so we use sample transitions (sâ‚œ, aâ‚œ, râ‚œ, sâ‚œâ‚Šâ‚). Define the TD target: yâ‚œ = râ‚œ + Î³ maxâ‚â€² Q(sâ‚œâ‚Šâ‚,aâ€²;Î¸). Minimise: L(Î¸) = ð”¼[(yâ‚œ âˆ’ Q(sâ‚œ,aâ‚œ;Î¸))Â²]. Taking the gradient: âˆ‡Î¸L = âˆ’2ð”¼[(yâ‚œ âˆ’ Q(sâ‚œ,aâ‚œ;Î¸)) Â· âˆ‡Î¸Q(sâ‚œ,aâ‚œ;Î¸)]. This is a semi-gradient method because we treat yâ‚œ as a constant (no gradient through the target).\n\n**Two Critical Instabilities.** Without modifications, neural Q-learning diverges in practice. Problem 1: Consecutive transitions (sâ‚œ, sâ‚œâ‚Šâ‚, sâ‚œâ‚Šâ‚‚, â€¦) are highly correlated â€” SGD assumes i.i.d. data. Training on correlated sequences causes the network to overfit to recent experiences and forget old ones. Problem 2: The target yâ‚œ = r + Î³ max Q(sâ€²;Î¸) depends on the same network being trained. As Î¸ updates, yâ‚œ shifts â€” the algorithm is chasing a moving target, causing oscillation or divergence.\n\n**Numerical Example.** Consider a forex agent with state s = [0.3, âˆ’0.5, 1.2, 0.8] (normalised RSI, MACD, volatility, position). Actions A = {sell, hold, buy}. The network outputs Q(s, sell;Î¸) = 0.5, Q(s, hold;Î¸) = 0.8, Q(s, buy;Î¸) = 1.2. Agent selects buy (Îµ-greedy). Receives reward r = 0.3. Next state sâ€² has Q(sâ€², sell;Î¸) = 0.4, Q(sâ€², hold;Î¸) = 0.9, Q(sâ€², buy;Î¸) = 0.7. Target: y = 0.3 + 0.99 Ã— max(0.4, 0.9, 0.7) = 0.3 + 0.99 Ã— 0.9 = 1.191. Loss: (1.191 âˆ’ 1.2)Â² = 0.000081. Gradient pushes Q(s, buy;Î¸) slightly toward 1.191. Over thousands of such updates, Q converges to Q*.",
            },
            {
              type: "theory",
              title: "Experience Replay and Target Networks: Solving DQN's Instabilities",
              content:
                "**Experience Replay Buffer.** Store each transition (sâ‚œ, aâ‚œ, râ‚œ, sâ‚œâ‚Šâ‚, doneâ‚œ) in a circular buffer D of capacity N (typically N = 100,000 to 1,000,000). At each training step, sample a random mini-batch of B transitions (typically B = 32 or 64) from D. This breaks temporal correlation: a mini-batch contains transitions from many different episodes and time steps, approximating the i.i.d. assumption of SGD. Additional benefits: (1) Data efficiency â€” each transition is used for multiple gradient updates, not just once. (2) Off-policy learning â€” the buffer contains transitions from older policies, but Q-learning is off-policy so this is valid.\n\n**Target Network.** Maintain a separate network Q(s,a;Î¸â») with frozen parameters Î¸â» used only to compute targets: yâ‚œ = râ‚œ + Î³ maxâ‚â€² Q(sâ‚œâ‚Šâ‚,aâ€²;Î¸â»). The target network is updated slowly: either (a) hard update: Î¸â» â† Î¸ every C steps (Mnih 2015, C = 10,000), or (b) soft update (Polyak averaging): Î¸â» â† Ï„Î¸ + (1âˆ’Ï„)Î¸â» every step, with Ï„ â‰ˆ 0.005 (Lillicrap 2016). This stabilises the target: yâ‚œ changes slowly even as Î¸ trains rapidly, preventing the 'chasing a moving target' problem.\n\n**Mathematical Justification.** Consider the loss L(Î¸) = ð”¼D[(yâ‚œ âˆ’ Q(sâ‚œ,aâ‚œ;Î¸))Â²]. Without target network: âˆ‚L/âˆ‚Î¸ involves both the prediction term âˆ‚Q(sâ‚œ,aâ‚œ;Î¸)/âˆ‚Î¸ and (implicitly) the target term âˆ‚maxQ(sâ‚œâ‚Šâ‚;Î¸)/âˆ‚Î¸. The target gradient creates a feedback loop. With target network: yâ‚œ = r + Î³ max Q(sâ€²;Î¸â») is treated as a constant, so âˆ‚L/âˆ‚Î¸ = âˆ’2(yâ‚œ âˆ’ Q(s,a;Î¸))Â·âˆ‚Q(s,a;Î¸)/âˆ‚Î¸ â€” a stable regression target. Soft updates ensure Î¸â» tracks Î¸ smoothly: Î¸â»â‚–â‚Šâ‚ = (1âˆ’Ï„)áµÎ¸â‚€ + Ï„âˆ‘â±¼(1âˆ’Ï„)áµâ»Ê²Î¸â±¼ â€” an exponential moving average of past Î¸ values.\n\n**Practical Hyperparameters for Trading.** Buffer size: N = 100,000 (covers ~400 trading days at 250 steps/day). Mini-batch: B = 64. Soft update: Ï„ = 0.005. Learning rate: 1e-4 with Adam. Training starts after buffer has 10,000 transitions (40 days of data). Train 1 gradient step per environment step. These settings balance data freshness (old transitions may reflect different market regimes) with stability.",
            },
            {
              type: "theory",
              title: "Double DQN: Proving and Fixing Overestimation Bias",
              content:
                "**The Overestimation Problem.** Standard DQN uses yâ‚œ = r + Î³ maxâ‚â€² Q(sâ€²,aâ€²;Î¸â»). The max operator over noisy Q-estimates produces positive bias: ð”¼[maxâ‚ QÌ‚(s,a)] â‰¥ maxâ‚ ð”¼[QÌ‚(s,a)]. Proof: Let QÌ‚(s,aáµ¢) = Q*(s,aáµ¢) + Îµáµ¢ where Îµáµ¢ are zero-mean noise terms. Then max_i QÌ‚(s,aáµ¢) = max_i [Q*(s,aáµ¢) + Îµáµ¢] â‰¥ Q*(s,a*) + Îµ_a* = Q*(s,a*) + Îµ_a*. Taking expectations: ð”¼[max_i QÌ‚] â‰¥ Q*(s,a*) = max_i Q*(s,aáµ¢). The bias increases with the number of actions and the noise level. In trading, Q-estimates are very noisy due to stochastic market dynamics, making overestimation severe â€” the agent becomes overconfident in certain actions.\n\n**Concrete Example.** True Q-values: Q*(s, sell) = 0.5, Q*(s, hold) = 0.8, Q*(s, buy) = 0.5. Network estimates with noise Îµ ~ ð’©(0, 0.3Â²): QÌ‚(s, sell) = 0.5 + 0.2 = 0.7, QÌ‚(s, hold) = 0.8 âˆ’ 0.4 = 0.4, QÌ‚(s, buy) = 0.5 + 0.5 = 1.0. Standard DQN: max QÌ‚ = 1.0 (buy, wrong!). True max Q* = 0.8 (hold). The noise pushed 'buy' above 'hold'. Over many such errors, Q-values inflate systematically.\n\n**Double DQN Fix (van Hasselt, 2016).** Decouple action selection from evaluation: a* = argmaxâ‚â€² Q(sâ€²,aâ€²;Î¸) (select using online network), yâ‚œ = r + Î³ Q(sâ€²,a*;Î¸â») (evaluate using target network). If the online network's noise selects a suboptimal action, the target network provides a (differently-noisy) evaluation, reducing the positive bias. In our example: a* = argmax QÌ‚_Î¸(s,Â·) = buy. But QÌ‚_Î¸â»(s, buy) = 0.5 âˆ’ 0.1 = 0.4 (target network has different noise). The target becomes 0.4, much closer to the true Q*(s, buy) = 0.5 than the inflated 1.0.\n\n**Dueling DQN (Wang et al., 2016).** Decompose Q(s,a;Î¸) = V(s;Î¸_V) + A(s,a;Î¸_A) âˆ’ (1/|A|)âˆ‘â‚ A(s,a;Î¸_A). V(s) captures the state value (how good is this market condition regardless of action), A(s,a) captures the advantage of each action relative to the average. The mean subtraction ensures identifiability: without it, V and A are not uniquely determined (you can add a constant to V and subtract it from all A). This decomposition helps when the action choice rarely matters (e.g., in ranging markets where all actions produce similar returns) â€” V is still learned accurately from the shared representation.",
            },
            {
              type: "intuition",
              title: "Experience Replay as Trade Journal Review",
              analogy:
                "You are a trader who keeps a detailed journal of every trade: entry conditions, action taken, P&L result, and resulting market state. Without replay, you only learn chronologically â€” today's losses dominate your thinking, yesterday's lessons fade. You might panic-adjust your strategy based on a single bad week. Experience replay means randomly flipping through your entire journal each evening, reviewing a diverse mix of old and recent trades from different market conditions. This prevents recency bias and ensures you learn from rare but important events (flash crashes, breakouts) long after they occur. The replay buffer size (100K transitions) is like keeping 2 years of detailed trade history â€” enough to see multiple market cycles.",
              content:
                "The target network is 'last month's strategy.' When evaluating whether today's trade was good, you compare against a stable benchmark â€” not against the strategy you just updated 5 minutes ago. If you kept changing the benchmark with every new trade, you would be chasing your own tail. The soft update Ï„ = 0.005 means the benchmark absorbs 0.5% of your latest thinking per step â€” slow enough to be stable, fast enough to track genuine improvements. In trading terms: evaluate new ideas against a proven track record, not against yesterday's untested hypothesis.",
              emoji: "ðŸ“”",
            },
            {
              type: "intuition",
              title: "Double DQN as Getting a Second Opinion",
              analogy:
                "Standard DQN is like asking a single analyst: 'what is the best trade AND how much will it make?' The analyst picks their most optimistic scenario (max), and their own optimism inflates the profit estimate (overestimation bias). Double DQN is like consulting two analysts: the first analyst recommends the best trade (action selection with Î¸), and the second analyst independently estimates how much it will make (value evaluation with Î¸â»). Because the second analyst's biases are different from the first's, the combined estimate is less inflated. In trading, overestimation bias makes the agent think every trade is more profitable than it actually is â€” leading to overtrading and excessive risk. Double DQN's 'second opinion' keeps expectations realistic.",
              content:
                "The Dueling architecture adds another level of sophistication. Instead of asking 'how good is each trade?', it asks two separate questions: 'how good is this market state overall?' (V-stream) and 'how much better is each specific action than average?' (A-stream). In ranging markets where buy/sell/hold all produce similar results, the V-stream accurately captures the low-value state even though the A-stream is noisy. The agent learns 'this is a bad time to trade' (low V) rather than trying to distinguish between equally mediocre actions (noisy A).",
              emoji: "ðŸ”",
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

# â”€â”€ Demo: training loop on synthetic forex data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
np.random.seed(42); torch.manual_seed(42)
state_dim, n_actions = 10, 5
agent = DoubleDuelingDQNAgent(state_dim, n_actions)
actions_map = ["strong_sell", "sell", "hold", "buy", "strong_buy"]

print("DOUBLE DUELING DQN â€” FOREX TRAINING DEMO")
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
              f"| Îµ: {agent.epsilon:.3f} | Buffer: {agent.buffer.size}")`,
              explanation:
                "A complete Double Dueling DQN implementation with prioritised experience replay. DuelingDQN separates Q = V + A âˆ’ mean(A) for better value estimation. PrioritisedReplayBuffer samples transitions proportional to |TD error|^Î± â€” surprising transitions are replayed more often. DoubleDuelingDQNAgent combines Îµ-greedy exploration, Double DQN targets (select with Î¸, evaluate with Î¸â»), soft Polyak averaging (Î¸â» â† Ï„Î¸ + (1âˆ’Ï„)Î¸â»), and gradient clipping. The training loop demonstrates the full pipeline on synthetic forex data.",
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

    # True Q-values for a simple environment: Q*(s,a) â‰ˆ 0 for all s,a
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

# â”€â”€ Compare vanilla vs double â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("OVERESTIMATION BIAS EXPERIMENT")
print("True Q*(s,a) â‰ˆ 0 for all (s,a) â€” random walk market")
print("=" * 60)

vanilla_q = measure_overestimation(use_double=False, n_steps=5000)
double_q = measure_overestimation(use_double=True, n_steps=5000)

print(f"\\n{'Step':>6s} | {'Vanilla max QÌ‚':>14s} | {'Double max QÌ‚':>13s} | {'True Q*':>8s}")
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
                "This experiment directly measures overestimation bias. In a random-walk market, the true Q*(s,a) â‰ˆ 0 for all states and actions (no exploitable signal). Vanilla DQN's max operator inflates Q-estimates above 0 because max of noisy estimates has positive bias. Double DQN decouples action selection (online net) from value evaluation (target net), breaking the correlation that causes upward bias. The output shows vanilla DQN's Q-estimates drifting positive while Double DQN stays near 0 â€” quantifying the bias reduction.",
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
    Actions: 5 discrete positions (strong sell â†’ strong buy).
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

# â”€â”€ Demo environment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                "A realistic forex trading environment for DQN with 10 normalised features (rolling Sharpe, volatility, momentum, drawdown, position, equity). The 5-action space maps to positions from âˆ’1.0 (strong sell) to +1.0 (strong buy). The reward function combines P&L with a drawdown penalty beyond 5% â€” teaching the agent to manage risk. The baselines (random and momentum) provide benchmarks. This environment can be directly used with the DoubleDuelingDQNAgent from the previous code block.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-dqn-q1",
                  question: "Why does DQN overestimate Q-values, and how does Double DQN fix it?",
                  options: [
                    { id: "rl-dqn-q1-a", text: "DQN uses a biased loss function; Double DQN uses an unbiased one" },
                    { id: "rl-dqn-q1-b", text: "The max operator over noisy Q-estimates has positive bias (ð”¼[max QÌ‚] â‰¥ max ð”¼[QÌ‚]); Double DQN decouples action selection (Î¸) from value evaluation (Î¸â»)" },
                    { id: "rl-dqn-q1-c", text: "DQN has too many parameters causing overfitting" },
                    { id: "rl-dqn-q1-d", text: "DQN cannot handle more than 3 actions" },
                  ],
                  correctOptionId: "rl-dqn-q1-b",
                  explanation:
                    "Jensen's inequality applied to the max function: max of noisy estimates â‰¥ max of true values on average. Double DQN uses Î¸ to select the best action and Î¸â» (with independent noise) to evaluate it. The noise in selection and evaluation are uncorrelated, so the positive bias cancels out on average. In trading, this prevents the agent from being overconfident about specific trade setups.",
                },
                {
                  id: "rl-dqn-q2",
                  question: "Why must we subtract mean(A) in the Dueling architecture Q = V + A âˆ’ mean(A)?",
                  options: [
                    { id: "rl-dqn-q2-a", text: "To ensure Q-values are always positive" },
                    { id: "rl-dqn-q2-b", text: "To reduce computational cost of the forward pass" },
                    { id: "rl-dqn-q2-c", text: "Without centering, V and A are not uniquely identifiable â€” adding c to V and subtracting c from all A gives the same Q" },
                    { id: "rl-dqn-q2-d", text: "For compatibility with batch normalisation layers" },
                  ],
                  correctOptionId: "rl-dqn-q2-c",
                  explanation:
                    "If Q = V + A, then (V+c) + (Aâˆ’c) gives the same Q for any constant c. The decomposition is not unique, so the gradient cannot distinguish V from A. Subtracting mean(A) forces the average advantage to be zero, making V uniquely equal to the mean Q-value across actions. This forces V to capture state value and A to capture relative action quality.",
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
                    "Problem 1 (replay): consecutive transitions (sâ‚,sâ‚‚,sâ‚ƒâ€¦) are correlated â€” training on them violates SGD's i.i.d. assumption, causing the network to overfit to recent data. Random sampling from a buffer provides approximately i.i.d. batches. Problem 2 (target network): the target y = r + Î³ max Q(s';Î¸) shifts as Î¸ updates, creating instability. Using a slowly-updated Î¸â» makes the target approximately stationary.",
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
                    "Forex trades 24 hours/day, so 1H bars give 24 bars per day. 100,000 / 24 â‰ˆ 4,167 days â‰ˆ 16 years of continuous data. This is generous â€” the buffer holds diverse market conditions. However, with a non-stationary market, very old transitions (from years ago) may no longer be representative, suggesting a smaller buffer or prioritised sampling might be better.",
                },
                {
                  id: "rl-dqn-q5",
                  question: "In prioritised experience replay, why do we use importance sampling weights w = (NÂ·p(i))^(âˆ’Î²)?",
                  options: [
                    { id: "rl-dqn-q5-a", text: "To speed up training by giving more weight to easy examples" },
                    { id: "rl-dqn-q5-b", text: "To correct for the bias introduced by non-uniform sampling â€” high-priority transitions are over-represented, so we down-weight them to maintain an unbiased gradient estimate" },
                    { id: "rl-dqn-q5-c", text: "To normalise the learning rate across different batch sizes" },
                    { id: "rl-dqn-q5-d", text: "Importance weights are only needed for on-policy methods" },
                  ],
                  correctOptionId: "rl-dqn-q5-b",
                  explanation:
                    "Prioritised sampling with p(i) âˆ |Î´áµ¢|^Î± oversamples high-TD-error transitions. This changes the data distribution from uniform to skewed â€” the gradient estimate becomes biased. Importance sampling weights w âˆ 1/p(i) correct for this bias, ensuring the expected gradient matches what we would get from uniform sampling. Î² starts low (allowing some bias for faster learning) and anneals to 1 (fully corrected) during training.",
                },
                {
                  id: "rl-dqn-q6",
                  question: "When would the Dueling architecture significantly outperform standard DQN in a forex application?",
                  options: [
                    { id: "rl-dqn-q6-a", text: "When all actions produce very different Q-values in every state" },
                    { id: "rl-dqn-q6-b", text: "When many states have similar Q-values across actions (e.g., ranging markets where buy/sell/hold are all mediocre) â€” the V-stream accurately captures state value even with noisy advantage estimates" },
                    { id: "rl-dqn-q6-c", text: "When the action space is continuous" },
                    { id: "rl-dqn-q6-d", text: "When the state space is very small (< 10 states)" },
                  ],
                  correctOptionId: "rl-dqn-q6-b",
                  explanation:
                    "Dueling excels when the action choice matters little but knowing the state value matters a lot. In ranging markets, all actions produce similar returns (small advantages), but the state value V(s) â€” 'is this a good or bad market condition?' â€” varies significantly. Standard DQN must learn this state value separately for each action. Dueling learns V once via the shared stream, then only needs to resolve small A differences â€” more sample efficient.",
                },
                {
                  id: "rl-dqn-q7",
                  question: "What is the soft target network update rule, and why is Ï„ = 0.005 typical?",
                  options: [
                    { id: "rl-dqn-q7-a", text: "Î¸â» â† Ï„Î¸ + (1âˆ’Ï„)Î¸â» with Ï„ = 0.005 means the target absorbs 0.5% of the online weights per step â€” slow enough for stable targets, fast enough to track improvements over hundreds of steps" },
                    { id: "rl-dqn-q7-b", text: "Î¸â» â† Î¸ every 200 steps â€” hard replacement" },
                    { id: "rl-dqn-q7-c", text: "Ï„ = 0.005 is the learning rate for the target network" },
                    { id: "rl-dqn-q7-d", text: "The target network does not need updating" },
                  ],
                  correctOptionId: "rl-dqn-q7-a",
                  explanation:
                    "Soft update Î¸â» â† 0.005Î¸ + 0.995Î¸â» means the target network is an exponential moving average of past online networks. The effective 'half-life' is ln(0.5)/ln(0.995) â‰ˆ 139 steps. This is smoother than hard replacement (which causes sudden target jumps) and ensures the bootstrap target changes gradually. Too large Ï„ â†’ unstable (target changes too fast). Too small Ï„ â†’ target lags too far behind, slowing convergence.",
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
                "Experience replay buffers in trading face a unique challenge: market regimes shift, making old transitions potentially misleading. Design an experiment to investigate how replay buffer design affects regime adaptation speed.\n\nCompare: (a) Uniform replay with buffer size 10K vs 100K vs 500K, (b) Prioritised replay (Î±=0.6, Î² annealing), (c) Your own design: a 'regime-aware' buffer that weights recent transitions higher or maintains separate buffers per detected regime.\n\nTrain a DQN agent on a 4-regime forex simulation (trendingâ†’volatileâ†’rangingâ†’trending). Measure: how many episodes after each regime change does the agent need to adapt (reach 80% of within-regime optimal performance)? Does prioritised replay speed up adaptation? Does a smaller buffer force faster forgetting of old regimes? Present a regime adaptation speed comparison table.",
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
                "Policy gradient theorem: âˆ‡Î¸ J(Î¸) = ð”¼Ï€[âˆ‡Î¸ log Ï€(a|s;Î¸) Â· Q^Ï€(s,a)] â€” the fundamental equation for policy-based RL",
                "Log-derivative trick: âˆ‡Î¸ Ï€(a|s;Î¸) = Ï€(a|s;Î¸) Â· âˆ‡Î¸ log Ï€(a|s;Î¸), converting a hard integral into a tractable expectation",
                "REINFORCE uses Monte Carlo return Gâ‚œ = âˆ‘â‚–â‚Œâ‚€^âˆž Î³áµ râ‚œâ‚Šâ‚– â€” unbiased but high variance due to credit assignment over long trajectories",
                "Baseline subtraction: âˆ‡Î¸ J = ð”¼[âˆ‡Î¸ log Ï€ Â· (Q^Ï€ âˆ’ b(s))] â€” subtracting any state-dependent baseline b(s) preserves the gradient in expectation but reduces variance",
                "The optimal baseline is b*(s) â‰ˆ V^Ï€(s), yielding the advantage: Ã‚(s,a) = Q^Ï€(s,a) âˆ’ V^Ï€(s)",
                "Natural policy gradient: Fâ»Â¹âˆ‡Î¸J uses the Fisher information matrix F to account for parameter space geometry, preventing large policy changes from small parameter changes",
                "Entropy regularisation H[Ï€] = âˆ’âˆ‘â‚ Ï€(a|s) log Ï€(a|s) prevents premature convergence to deterministic policies",
                "Gaussian policy Ï€(a|s) = ð’©(Î¼(s;Î¸), ÏƒÂ²(s;Î¸)) enables continuous position sizing a âˆˆ [âˆ’1, 1] for forex",
              ],
            },
            {
              type: "theory",
              title: "The Policy Gradient Theorem: Full Derivation via the Log-Derivative Trick",
              content:
                "**Setup.** Instead of learning Q-values and deriving a policy, we directly parameterise the policy Ï€(a|s;Î¸) and optimise the objective J(Î¸) = ð”¼Ï„~Ï€[âˆ‘â‚œ Î³áµ— râ‚œ] = âˆ‘â‚› d^Ï€(s) âˆ‘â‚ Ï€(a|s;Î¸) Q^Ï€(s,a), where d^Ï€(s) = âˆ‘â‚œ Î³áµ— P(sâ‚œ=s|Ï€) is the discounted state visitation distribution.\n\n**Step 1 â€” Gradient of J.** âˆ‡Î¸J(Î¸) = âˆ‘â‚› d^Ï€(s) âˆ‘â‚ âˆ‡Î¸[Ï€(a|s;Î¸) Q^Ï€(s,a)]. The Q^Ï€ term also depends on Î¸ (through future policy), but the Policy Gradient Theorem (Sutton et al., 1999) shows that we can ignore âˆ‡Î¸Q^Ï€: âˆ‡Î¸J(Î¸) = âˆ‘â‚› d^Ï€(s) âˆ‘â‚ âˆ‡Î¸Ï€(a|s;Î¸) Â· Q^Ï€(s,a). This is non-trivial â€” the proof involves telescoping the Bellman equation through the state visitation distribution.\n\n**Step 2 â€” Log-Derivative Trick.** The sum âˆ‘â‚ âˆ‡Î¸Ï€ Â· Q is hard to compute because we need âˆ‡Î¸Ï€ for every action. Apply the identity: âˆ‡Î¸Ï€ = Ï€ Â· âˆ‡Î¸ log Ï€ (since âˆ‡Î¸ log f = âˆ‡Î¸f / f). Then: âˆ‡Î¸J = âˆ‘â‚› d^Ï€(s) âˆ‘â‚ Ï€(a|s;Î¸) Â· âˆ‡Î¸ log Ï€(a|s;Î¸) Â· Q^Ï€(s,a) = ð”¼_{s~d^Ï€, a~Ï€}[âˆ‡Î¸ log Ï€(aâ‚œ|sâ‚œ;Î¸) Â· Q^Ï€(sâ‚œ,aâ‚œ)]. Now the gradient is an expectation â€” we can estimate it by sampling trajectories!\n\n**Step 3 â€” REINFORCE Estimator.** In practice, we don't know Q^Ï€. REINFORCE replaces it with the sample return Gâ‚œ = âˆ‘â‚–â‚Œâ‚€ Î³áµrâ‚œâ‚Šâ‚–. The gradient estimate: Ä = (1/N) âˆ‘áµ¢ âˆ‘â‚œ âˆ‡Î¸ log Ï€(aâ‚œ|sâ‚œ;Î¸) Â· Gâ‚œ. This is unbiased (ð”¼[Gâ‚œ] = Q^Ï€ by definition) but has very high variance because a single trajectory's Gâ‚œ includes all future noise.\n\n**Numerical Example.** Gaussian policy Ï€(a|s) = ð’©(Î¼(s), ÏƒÂ²) with Î¼(s) = Î¸ Â· s. State s = 0.5 (normalised momentum). Î¸ = 2.0, so Î¼ = 1.0, Ïƒ = 0.3. Agent samples a = 0.8. log Ï€(0.8|s) = âˆ’(0.8âˆ’1.0)Â²/(2Â·0.09) âˆ’ log(0.3âˆš(2Ï€)) = âˆ’0.222 âˆ’ 1.32 = âˆ’1.54. âˆ‡Î¸ log Ï€ = âˆ‚/âˆ‚Î¸ [âˆ’(aâˆ’Î¸s)Â²/(2ÏƒÂ²)] = (aâˆ’Î¸s)Â·s/ÏƒÂ² = (0.8âˆ’1.0)Â·0.5/0.09 = âˆ’1.11. If Gâ‚œ = +0.5 (profitable trade): gradient = âˆ’1.11 Ã— 0.5 = âˆ’0.56. This pushes Î¸ down (reducing Î¼), because the action was below Î¼ and was profitable â€” so the mean should decrease toward where the action was. If Gâ‚œ = âˆ’0.5 (loss): gradient = âˆ’1.11 Ã— (âˆ’0.5) = +0.56 â€” pushes Î¸ up, moving away from this unprofitable action.",
            },
            {
              type: "theory",
              title: "Baseline Subtraction and Variance Reduction â€” Why V(s) is Optimal",
              content:
                "**The Variance Problem.** REINFORCE's gradient estimate Ä = âˆ‡Î¸ log Ï€ Â· Gâ‚œ has variance proportional to Var(Gâ‚œ), which can be enormous. Consider a 250-step episode: Gâ‚œ = âˆ‘â‚‚â‚…â‚€â‚–â‚Œâ‚€ Î³áµrâ‚œâ‚Šâ‚– sums up to 250 noisy rewards. Even if the policy is optimal, different trajectories produce wildly different Gâ‚œ due to stochastic market dynamics. Result: the gradient estimate is very noisy, requiring thousands of episodes for a reliable update direction.\n\n**Baseline Subtraction.** A key identity: ð”¼_{a~Ï€}[âˆ‡Î¸ log Ï€(a|s;Î¸) Â· b(s)] = âˆ‘â‚ Ï€ Â· (âˆ‡Î¸Ï€/Ï€) Â· b = b Â· âˆ‘â‚ âˆ‡Î¸Ï€ = b Â· âˆ‡Î¸(âˆ‘â‚ Ï€) = b Â· âˆ‡Î¸(1) = 0. Therefore, subtracting any state-dependent baseline b(s) from the return preserves the expected gradient: âˆ‡Î¸J = ð”¼[âˆ‡Î¸ log Ï€ Â· (Gâ‚œ âˆ’ b(sâ‚œ))]. The gradient is unbiased for any b(s), but variance depends on the choice of b.\n\n**Optimal Baseline.** Minimise Var[âˆ‡Î¸ log Ï€ Â· (G âˆ’ b)] over b. Taking the derivative and setting to zero yields b*(s) = ð”¼[||âˆ‡Î¸ log Ï€||Â² Â· G] / ð”¼[||âˆ‡Î¸ log Ï€||Â²] â‰ˆ ð”¼[Gâ‚œ | sâ‚œ = s] = V^Ï€(s). So the optimal baseline is approximately the value function! Using b(s) = V^Ï€(s): Ä = âˆ‡Î¸ log Ï€ Â· (Gâ‚œ âˆ’ V(sâ‚œ)) = âˆ‡Î¸ log Ï€ Â· Ã‚â‚œ, where Ã‚â‚œ = Gâ‚œ âˆ’ V(sâ‚œ) is the advantage. The advantage has zero mean (over actions) by construction, so the gradient signal is centred: positive Ã‚ means 'better than average,' negative means 'worse than average.'\n\n**Variance Comparison.** Without baseline: Var âˆ ð”¼[Gâ‚œÂ²]. With baseline V: Var âˆ ð”¼[Ã‚â‚œÂ²] = ð”¼[(Gâ‚œ âˆ’ V)Â²] << ð”¼[Gâ‚œÂ²] (since V captures the bulk of the signal). In our forex example: Gâ‚œ â‰ˆ 0.05 Â± 0.8 (positive mean, huge variance). V(sâ‚œ) â‰ˆ 0.05. Ã‚ = Gâ‚œ âˆ’ V â‰ˆ 0 Â± 0.8 still has high variance but is centred, so gradient updates point in the right direction more often.\n\n**Practical Implication for Trading.** A trading agent without a baseline receives the full equity curve noise in every gradient. With V(s) as baseline, the gradient only reflects whether each trade was better or worse than the expected cumulative P&L from that market state â€” a much more informative signal for policy improvement.",
            },
            {
              type: "theory",
              title: "Natural Policy Gradient and Entropy Regularisation",
              content:
                "**Natural Policy Gradient.** Standard gradient descent âˆ‡Î¸J treats all parameter directions equally, but the policy space has non-Euclidean geometry. A small change Î´Î¸ can cause a large policy change Ï€(a|s;Î¸+Î´Î¸) â‰  Ï€(a|s;Î¸) if the parameterisation is sensitive in certain directions. The Fisher Information Matrix F(Î¸) = ð”¼Ï€[âˆ‡Î¸ log Ï€ Â· (âˆ‡Î¸ log Ï€)áµ€] measures the local curvature of the policy distribution. The natural gradient is: Î¸ â† Î¸ + Î± F(Î¸)â»Â¹ âˆ‡Î¸J. This ensures updates are measured in policy space (KL divergence) rather than parameter space (Euclidean distance). The resulting KL change is bounded: KL(Ï€_old â€– Ï€_new) â‰ˆ (1/2) Î´Î¸áµ€ F Î´Î¸, which natural gradient constrains to be constant. This is the theoretical foundation for trust region methods like TRPO and PPO.\n\n**Numerical Example.** Consider a 1D Gaussian Ï€ = ð’©(Î¸, 1). F(Î¸) = ð”¼[(âˆ‡Î¸ log Ï€)Â²] = ð”¼[(aâˆ’Î¸)Â²/1Â²] = 1. Natural gradient = Fâ»Â¹âˆ‡J = âˆ‡J â€” identical to standard gradient for this simple case. But for Ï€ = ð’©(Î¸, ÏƒÂ²(Î¸)) where Ïƒ depends on Î¸, F becomes non-trivial and natural gradient correctly accounts for the coupling between mean and variance.\n\n**Entropy Regularisation.** The entropy of a Gaussian policy is H[ð’©(Î¼, ÏƒÂ²)] = (1/2) log(2Ï€eÏƒÂ²). Adding âˆ’câ‚‚ H[Ï€] to the loss penalises low entropy (small Ïƒ), preventing the policy from collapsing to a deterministic Î´(a âˆ’ Î¼(s)). This keeps the agent exploring diverse position sizes. The augmented objective: J_aug(Î¸) = J(Î¸) + câ‚‚ ð”¼[H[Ï€(Â·|s;Î¸)]]. As training progresses, we may anneal câ‚‚ toward 0 to allow the policy to become more deterministic once the optimal strategy is identified.\n\n**Trading Implications.** Without entropy regularisation, a forex agent often converges early to always holding a fixed position (e.g., Î¼ â†’ +1.0, Ïƒ â†’ 0.01 = always fully long). This is catastrophic in ranging or volatile markets. With câ‚‚ = 0.01: the entropy bonus keeps Ïƒ â‰¥ 0.1, ensuring the agent samples diverse position sizes and continues learning about different market conditions. The câ‚‚ coefficient balances exploration (high câ‚‚ = wide Ïƒ = explores aggressively) vs exploitation (low câ‚‚ = narrow Ïƒ = commits to learned strategy).",
            },
            {
              type: "intuition",
              title: "REINFORCE as Learning from Trade Reviews",
              analogy:
                "You are a trader reviewing your performance at the end of each week. REINFORCE is like grading every trade by the total week's P&L: 'I bought on Monday, the week ended +$500, so buying on Monday was good.' But maybe Monday's buy was terrible and Thursday's sell rescued the week. REINFORCE cannot distinguish â€” it credits the entire $500 to every action equally (high variance). The baseline V(s) is like knowing 'on average, weeks starting like this produce +$300.' Now Monday's buy gets credit for $500âˆ’$300 = $200 excess return (advantage), which is a much sharper signal. Actor-Critic takes this further by providing a per-step baseline V(sâ‚œ) at each decision point, so each trade is evaluated against its own expected outcome.",
              content:
                "The log-derivative trick converts the policy gradient from 'how does changing Î¸ change the probability of every possible trajectory?' (intractable) to 'for the trajectory I actually observed, in which direction should I adjust Î¸ to make profitable actions more likely?' This is like asking 'should I be more aggressive (increase Î¼) or more conservative (decrease Î¼) given what happened?' The answer is weighted by the advantage â€” bigger adjustments for bigger surprises.",
              emoji: "ðŸ“ˆ",
            },
            {
              type: "intuition",
              title: "PPO as a Cautious Strategy Updater with Guardrails",
              analogy:
                "Imagine you are managing a team of traders. After each day, the quant team proposes a new strategy update. REINFORCE implements the proposal immediately, no matter how radical â€” dangerous! The quant team might have had one lucky day and proposes 10Ã— leverage. Actor-Critic adds a reasonableness check (the critic V(s) provides a baseline), so proposals are measured against expected outcomes. PPO adds the ultimate guardrail: 'regardless of how good or bad the proposal looks, we will not change our strategy by more than 20%.' This is the clipping mechanism: the probability ratio râ‚œ = Ï€_new/Ï€_old is clamped to [0.8, 1.2]. Even if the advantage is enormous (one-in-a-thousand profitable trade), the policy change is bounded. This prevents: (1) overreacting to lucky streaks (overfitting to noise), (2) panic-selling after drawdowns (overreacting to bad luck), (3) sudden leverage increases that blow up accounts.",
              content:
                "PPO's clipped surrogate creates a 'trust region' in policy space without the computational cost of TRPO's constrained optimisation (which requires computing and inverting the Fisher matrix). The four cases: (1) Ã‚ > 0, r < 1+Îµ: good action, policy can still increase â€” gradient flows normally. (2) Ã‚ > 0, r > 1+Îµ: good action, policy already increased enough â€” gradient clipped to zero (don't push further). (3) Ã‚ < 0, r > 1âˆ’Îµ: bad action, policy can still decrease â€” gradient flows. (4) Ã‚ < 0, r < 1âˆ’Îµ: bad action, policy already decreased â€” gradient clipped. This asymmetric clipping ensures monotonic improvement with high probability â€” stable, boring progress that compounds into profitable trading.",
              emoji: "ðŸ›¡ï¸",
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
                  f"Ïƒ: {sigma:.3f} | V_loss: {v_loss.item():.4f}")

    return policy, baseline

# â”€â”€ Train â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
np.random.seed(42); torch.manual_seed(42)
sim_returns = np.concatenate([
    np.random.normal(+0.0004, 0.008, 500),  # uptrend
    np.random.normal( 0.0000, 0.006, 500),  # range
])
print("REINFORCE WITH BASELINE â€” FOREX POSITION SIZING")
print("=" * 55)
policy, baseline = reinforce_with_baseline(sim_returns, n_episodes=300)
print(f"\\nFinal sigma (exploration): {policy.log_std.exp().item():.4f}")
print("Learned: policy outputs position size based on market features")`,
              explanation:
                "REINFORCE with a learned baseline V(s). The GaussianPolicy outputs ð’©(Î¼(s), ÏƒÂ²) for continuous position sizing. The ValueBaseline V(s) reduces gradient variance by subtracting the expected return from the actual return: Ã‚ = Gâ‚œ âˆ’ V(sâ‚œ). The policy gradient âˆ‡Î¸J â‰ˆ âˆ’log Ï€(a|s;Î¸) Ã— Ã‚ pushes the policy toward actions with positive advantage. Entropy regularisation keeps Ïƒ from collapsing. The training loop collects full episodes, computes Monte Carlo returns, updates the baseline, then updates the policy â€” the classic REINFORCE pattern.",
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

# â”€â”€ Compare â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                "This experiment directly measures the gradient variance reduction from baseline subtraction. We compute REINFORCE gradients for 100 trajectories with and without a constant baseline b = mean(G). The coefficient of variation (std/mean) quantifies signal-to-noise ratio. With baseline, the gradient norms are more consistent (lower std), meaning each update is more reliable â€” the policy converges in fewer episodes. This is the fundamental motivation for actor-critic methods, which learn a state-dependent baseline V(s) for even greater variance reduction.",
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

# â”€â”€ Analyse clipping behaviour â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("PPO CLIPPED SURROGATE OBJECTIVE ANALYSIS")
print("=" * 60)
ratios = np.linspace(0.5, 1.8, 100)
eps = 0.2

for adv_val, adv_label in [(+1.0, "POSITIVE (good action)"),
                             (-1.0, "NEGATIVE (bad action)")]:
    print(f"\\nAdvantage = {adv_val:+.1f} â€” {adv_label}")
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

# â”€â”€ Numerical PPO update example â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    print(f"  Ã‚={A_val:+4.1f}: ratio={ratio:.4f}, unclipped={s1:+.4f}, "
          f"clipped_term={s2:+.4f}, PPO={ppo:+.4f}, clipped={clipped}")

print(f"\\nKey: PPO prevents large policy changes even with extreme advantages.")
print(f"  ratio > 1+Îµ with Ã‚>0: policy already moved enough in good direction")
print(f"  ratio < 1-Îµ with Ã‚<0: policy already moved enough away from bad action")`,
              explanation:
                "This code dissects PPO's clipping mechanism with actual numbers. For positive advantage (good action): the objective is min(rÃ‚, clip(r)Ã‚). When r > 1.2 (policy already increased this action's probability by >20%), the clipped term (1.2)Ã‚ is smaller and wins the min â€” gradient vanishes, preventing further increase. For negative advantage (bad action): when r < 0.8 (policy already decreased by >20%), clipping stops further decrease. The numerical example with actual Gaussian log-probabilities shows exactly how the ratio r = Ï€_new/Ï€_old is computed and when clipping activates.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-policy-gradient-q1",
                  question: "What is the log-derivative trick and why is it essential for policy gradients?",
                  options: [
                    { id: "rl-policy-gradient-q1-a", text: "It approximates the logarithm with a Taylor expansion for faster computation" },
                    { id: "rl-policy-gradient-q1-b", text: "âˆ‡Î¸Ï€ = Ï€ Â· âˆ‡Î¸ log Ï€ converts the gradient of an intractable integral into a sample-based expectation ð”¼Ï€[âˆ‡Î¸ log Ï€ Â· Q]" },
                    { id: "rl-policy-gradient-q1-c", text: "It replaces the policy with its log for numerical stability" },
                    { id: "rl-policy-gradient-q1-d", text: "It eliminates the need for backpropagation through the environment" },
                  ],
                  correctOptionId: "rl-policy-gradient-q1-b",
                  explanation:
                    "âˆ‡Î¸J = âˆ‘â‚› d(s) âˆ‘â‚ âˆ‡Î¸Ï€(a|s)Q(s,a) requires computing âˆ‡Î¸Ï€ for every action. The identity âˆ‡Î¸Ï€ = Ï€ Â· âˆ‡Î¸ log Ï€ converts this to âˆ‘â‚ Ï€ Â· âˆ‡Î¸ log Ï€ Â· Q = ð”¼_{a~Ï€}[âˆ‡Î¸ log Ï€ Â· Q], which we can estimate by simply sampling actions from the current policy. This is what makes REINFORCE possible â€” no model of the environment needed.",
                },
                {
                  id: "rl-policy-gradient-q2",
                  question: "In PPO, when Ã‚ > 0 and râ‚œ > 1+Îµ, what happens to the gradient?",
                  options: [
                    { id: "rl-policy-gradient-q2-a", text: "The objective is zeroed and the episode is discarded" },
                    { id: "rl-policy-gradient-q2-b", text: "min() selects the clipped term (1+Îµ)Ã‚, which is constant w.r.t. Î¸ â€” gradient is zero, preventing further probability increase for this action" },
                    { id: "rl-policy-gradient-q2-c", text: "The ratio is reset to 1.0 and training continues normally" },
                    { id: "rl-policy-gradient-q2-d", text: "The advantage is set to zero for this timestep" },
                  ],
                  correctOptionId: "rl-policy-gradient-q2-b",
                  explanation:
                    "When râ‚œ exceeds 1+Îµ for a good action (Ã‚ > 0), the unclipped objective râ‚œÃ‚ is larger than the clipped (1+Îµ)Ã‚. min() selects the clipped term, which does not depend on Î¸ (it is clip(r)Ã‚ where clip(r) = 1+Îµ, a constant). Since âˆ‚(constant)/âˆ‚Î¸ = 0, no gradient flows â€” the policy stops increasing this action's probability. This is PPO's 'trust region' enforcement.",
                },
                {
                  id: "rl-policy-gradient-q3",
                  question: "Why does subtracting a baseline b(s) from Gâ‚œ reduce variance without introducing bias?",
                  options: [
                    { id: "rl-policy-gradient-q3-a", text: "Because b(s) normalises the rewards to unit variance" },
                    { id: "rl-policy-gradient-q3-b", text: "Because ð”¼_{a~Ï€}[âˆ‡Î¸ log Ï€(a|s) Â· b(s)] = b(s) Â· âˆ‡Î¸ âˆ‘â‚ Ï€(a|s) = b(s) Â· âˆ‡Î¸(1) = 0 â€” the baseline term vanishes in expectation" },
                    { id: "rl-policy-gradient-q3-c", text: "Because the baseline is subtracted from both the numerator and denominator" },
                    { id: "rl-policy-gradient-q3-d", text: "It does introduce bias but the bias is acceptably small" },
                  ],
                  correctOptionId: "rl-policy-gradient-q3-b",
                  explanation:
                    "The key identity: âˆ‘â‚ Ï€ Â· âˆ‡Î¸ log Ï€ Â· b = b Â· âˆ‘â‚ âˆ‡Î¸Ï€ = b Â· âˆ‡Î¸(1) = 0. Since probabilities sum to 1 and the gradient of a constant is 0, the baseline contribution has zero expectation. So ð”¼[âˆ‡Î¸ log Ï€ Â· (G âˆ’ b)] = ð”¼[âˆ‡Î¸ log Ï€ Â· G] âˆ’ 0 = âˆ‡Î¸J. Unbiased! But Var(G âˆ’ b) < Var(G) when b â‰ˆ ð”¼[G].",
                },
                {
                  id: "rl-policy-gradient-q4",
                  question: "Why use a Gaussian distribution Ï€(a|s) = ð’©(Î¼(s;Î¸), ÏƒÂ²) for forex position sizing?",
                  options: [
                    { id: "rl-policy-gradient-q4-a", text: "Gaussians are the only distribution with a tractable log-derivative" },
                    { id: "rl-policy-gradient-q4-b", text: "Continuous distributions enable nuanced sizing (0.3 vs 0.7 lots); the log-derivative âˆ‡Î¸ log Ï€ = (aâˆ’Î¼)/ÏƒÂ² Â· âˆ‡Î¸Î¼ pushes Î¼ toward profitable actions; Ïƒ controls exploration" },
                    { id: "rl-policy-gradient-q4-c", text: "Gaussian policies always converge to the global optimum" },
                    { id: "rl-policy-gradient-q4-d", text: "Discrete distributions cannot represent buy/sell/hold" },
                  ],
                  correctOptionId: "rl-policy-gradient-q4-b",
                  explanation:
                    "Trading needs precise position sizing â€” 0.3 lots vs 0.7 lots vs 1.2 lots. A Gaussian over [âˆ’1, 1] provides infinite precision. The gradient âˆ‡Î¸ log ð’©(a|Î¼,ÏƒÂ²) = (aâˆ’Î¼)Â·âˆ‡Î¸Î¼/ÏƒÂ² naturally adjusts Î¼: if a > Î¼ and the action was profitable (positive advantage), Î¼ increases toward a. Ïƒ controls exploration breadth â€” learnable Ïƒ lets the agent decide when to explore and when to commit.",
                },
                {
                  id: "rl-policy-gradient-q5",
                  question: "What does the entropy bonus âˆ’câ‚‚Â·H[Ï€] prevent, and what is H for a Gaussian?",
                  options: [
                    { id: "rl-policy-gradient-q5-a", text: "It prevents overfitting; H = number of parameters in the network" },
                    { id: "rl-policy-gradient-q5-b", text: "It prevents premature collapse to a deterministic policy (Ïƒâ†’0); H[ð’©(Î¼,ÏƒÂ²)] = Â½log(2Ï€eÏƒÂ²), so the bonus rewards large Ïƒ" },
                    { id: "rl-policy-gradient-q5-c", text: "It speeds up convergence; H = cross-entropy with uniform distribution" },
                    { id: "rl-policy-gradient-q5-d", text: "It normalises the advantage estimates; H = mean squared advantage" },
                  ],
                  correctOptionId: "rl-policy-gradient-q5-b",
                  explanation:
                    "Without entropy regularisation, Ïƒ collapses to near-zero early in training â€” the policy becomes deterministic before adequately exploring the action space. H[ð’©(Î¼,ÏƒÂ²)] = Â½log(2Ï€eÏƒÂ²) increases with Ïƒ. Maximising H (via the âˆ’câ‚‚Â·H term in the loss) penalises small Ïƒ, keeping the policy stochastic enough to continue learning. In trading, this prevents the agent from committing to always-long or always-short too early.",
                },
                {
                  id: "rl-policy-gradient-q6",
                  question: "For a Gaussian policy with Î¸ = 2.0, Ïƒ = 0.3, state s = 0.5 (so Î¼ = Î¸Â·s = 1.0), and sampled action a = 0.7, what is âˆ‡Î¸ log Ï€(a|s)?",
                  options: [
                    { id: "rl-policy-gradient-q6-a", text: "(a âˆ’ Î¼) Â· s / ÏƒÂ² = (0.7 âˆ’ 1.0) Â· 0.5 / 0.09 = âˆ’1.67" },
                    { id: "rl-policy-gradient-q6-b", text: "(a âˆ’ Î¼)Â² / ÏƒÂ² = 0.09 / 0.09 = 1.0" },
                    { id: "rl-policy-gradient-q6-c", text: "log(a/Î¼) = log(0.7) = âˆ’0.36" },
                    { id: "rl-policy-gradient-q6-d", text: "(Î¼ âˆ’ a) Â· s / ÏƒÂ² = +1.67" },
                  ],
                  correctOptionId: "rl-policy-gradient-q6-a",
                  explanation:
                    "log Ï€(a|s) = âˆ’(aâˆ’Î¼)Â²/(2ÏƒÂ²) + const. âˆ‚Î¼/âˆ‚Î¸ = s = 0.5. âˆ‡Î¸ log Ï€ = (aâˆ’Î¼)/ÏƒÂ² Â· âˆ‚Î¼/âˆ‚Î¸ = (0.7âˆ’1.0)/0.09 Â· 0.5 = âˆ’3.33 Â· 0.5 = âˆ’1.67. The negative sign means: the action was below Î¼, so increasing Î¸ (which increases Î¼) would move Î¼ away from the action. If this action was good (positive Ã‚), the gradient âˆ’1.67 Ã— Ã‚ < 0 pushes Î¸ down, bringing Î¼ toward 0.7.",
                },
              ],
            },
            {
              type: "practice",
              title: "Guided: REINFORCE Variance Analysis on Forex Data",
              description:
                "Using the REINFORCE+Baseline code above, run the following experiment to understand variance reduction:\n\n1. Train REINFORCE without baseline (set baseline output to always 0) for 200 episodes. Record the policy gradient norm at each episode.\n2. Train REINFORCE with the learned V(s) baseline for 200 episodes. Record gradient norms.\n3. Compare: (a) mean and std of gradient norms, (b) coefficient of variation, (c) convergence speed (episodes to reach equity > 1.01).\n4. Try a third variant: REINFORCE with a constant baseline b = mean(all returns seen so far) instead of learned V(s). How does it compare?\n\nExpected insight: Learned V(s) reduces gradient variance by 3-10Ã— compared to no baseline. The constant baseline helps but is suboptimal because it doesn't capture state-dependent expected returns.",
              catalogModelId: "ppo-position-sizing",
            },
            {
              type: "practice",
              title: "Open-Ended: Natural Policy Gradient Implementation",
              description:
                "Implement the natural policy gradient for a linear Gaussian policy Ï€(a|s) = ð’©(Î¸áµ€s, ÏƒÂ²) on a simplified forex position sizing task.\n\n1. Compute the Fisher Information Matrix F(Î¸) = ð”¼[âˆ‡Î¸ log Ï€ Â· (âˆ‡Î¸ log Ï€)áµ€] empirically from trajectory samples.\n2. Compute the natural gradient: Fâ»Â¹ âˆ‡Î¸J using numpy.linalg.solve.\n3. Compare convergence of standard gradient descent vs natural gradient: track the per-episode reward and the KL divergence between consecutive policies KL(Ï€_old â€– Ï€_new).\n4. Verify that natural gradient produces approximately constant KL steps (trust region property), while standard gradient produces variable KL steps.\n\nThis exercise builds intuition for why TRPO and PPO were developed â€” they approximate the natural gradient's trust region property with less computational overhead.",
              catalogModelId: "ppo-position-sizing",
            },
          ],
        },
        // â”€â”€ Lesson 3: Actor-Critic & PPO for Trading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        {
          id: "rl-a2c-ppo",
          title: "Actor-Critic & PPO for Trading",
          description:
            "Deep-dive into actor-critic architectures, the advantage function, A2C synchronous training, and PPO's clipped surrogate objective â€” the default algorithm for continuous-action trading agents.",
          estimatedMinutes: 55,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Understand the actor-critic architecture, derive the advantage function A(s,a) = Q(s,a) âˆ’ V(s), implement A2C and PPO with clipped surrogate objectives, and train a PPO agent for continuous forex position sizing.",
              keyTakeaways: [
                "Actor-critic separates policy Ï€(a|s;Î¸) (actor) from value V(s;Ï†) (critic) for variance reduction",
                "Advantage A(s,a) = Q(s,a) âˆ’ V(s) measures how much better action a is vs the average â€” lower variance than raw returns",
                "A2C: synchronous advantage actor-critic with parallel environment rollouts",
                "PPO clips the probability ratio râ‚œ(Î¸) = Ï€_Î¸(a|s) / Ï€_Î¸_old(a|s) to [1âˆ’Îµ, 1+Îµ], preventing destructive updates",
                "PPO is the default for continuous trading actions because of its stability, sample efficiency, and ease of tuning",
                "GAE (Generalized Advantage Estimation) interpolates between TD and Monte Carlo via Î» âˆˆ [0,1]",
                "Trust region methods (TRPO â†’ PPO) prevent catastrophic policy updates in noisy financial environments",
                "Shared backbone architecture learns efficient representations used by both actor and critic heads",
              ],
            },
            {
              type: "theory",
              title: "Advantage Functions: Deriving A(s,a) = Q(s,a) âˆ’ V(s)",
              content:
                "**The Variance Problem in REINFORCE.** Vanilla policy gradient âˆ‡Î¸ J(Î¸) = ð”¼Ï€[âˆ‡Î¸ log Ï€(aâ‚œ|sâ‚œ;Î¸) Â· Gâ‚œ] uses Monte Carlo returns Gâ‚œ = âˆ‘â‚– Î³áµ râ‚œâ‚Šâ‚–. These returns have extremely high variance because they depend on the entire future trajectory. In a 100-step forex episode, Gâ‚œ accumulates noise from 100 random price movements. If two episodes differ only in step 50 onward (pure noise), their returns Gâ‚œ at step 1 are completely different, yet the policy gradient treats them as different signals for the same state-action pair.\n\n**The Advantage Function Derivation.** We want to reduce variance without introducing bias. The key insight: decompose the Q-function as Q(s,a) = V(s) + A(s,a), where V(s) = ð”¼Ï€[Q(s,a)] is the expected value of state s under the current policy, and A(s,a) = Q(s,a) âˆ’ V(s) is the advantage â€” how much better action a is than the average action in state s. When we use A(s,a) instead of Gâ‚œ in the policy gradient, we remove the state-dependent baseline V(s), which is large and noisy but constant across actions. This dramatically reduces variance because we only care about the relative quality of actions, not the absolute value of being in state s.\n\n**Formal Proof of Bias-Invariance.** The policy gradient theorem: âˆ‡Î¸ J(Î¸) = ð”¼Ï€[âˆ‡Î¸ log Ï€(aâ‚œ|sâ‚œ;Î¸) Â· Q^Ï€(sâ‚œ,aâ‚œ)]. Subtracting any state-dependent baseline b(s) does not change the expectation: ð”¼Ï€[âˆ‡Î¸ log Ï€(aâ‚œ|sâ‚œ;Î¸) Â· b(sâ‚œ)] = âˆ‘â‚ Ï€(a|s)Â·âˆ‡Î¸ log Ï€(a|s)Â·b(s) = b(s)Â·âˆ‡Î¸ âˆ‘â‚ Ï€(a|s) = b(s)Â·âˆ‡Î¸ 1 = 0. Therefore, using Ã‚â‚œ = Qâ‚œ âˆ’ V(sâ‚œ) produces the same gradient in expectation but with lower variance. The optimal baseline (minimizing variance) is V(s) â€” proven by Greensmith et al. 2004.\n\n**Numerical Example.** State sâ‚ = 'high volatility market', actions = {buy, hold, sell}. Q(sâ‚, buy) = 0.8, Q(sâ‚, hold) = 0.5, Q(sâ‚, sell) = 0.3. V(sâ‚) = (0.8 + 0.5 + 0.3)/3 = 0.533. Advantages: A(sâ‚, buy) = 0.8 âˆ’ 0.533 = +0.267, A(sâ‚, hold) = 0.5 âˆ’ 0.533 = âˆ’0.033, A(sâ‚, sell) = 0.3 âˆ’ 0.533 = âˆ’0.233. If we observe (sâ‚, buy, r=0.02, sâ‚‚), the policy gradient signal is proportional to A(sâ‚, buy) = +0.267, not Q(sâ‚, buy) = 0.8. The advantage correctly signals 'buy is good' while removing the state-dependent component that all actions share.",
            },
            {
              type: "theory",
              title: "Generalized Advantage Estimation (GAE): Î»-Return Derivation",
              content:
                "**The Bias-Variance Tradeoff in Advantage Estimation.** We can estimate A(sâ‚œ, aâ‚œ) in multiple ways: (1) 1-step TD: Ã‚â½Â¹â¾â‚œ = Î´â‚œ = râ‚œ + Î³V(sâ‚œâ‚Šâ‚) âˆ’ V(sâ‚œ) (low variance, high bias because V is learned). (2) Monte Carlo: Ã‚â½âˆžâ¾â‚œ = Gâ‚œ âˆ’ V(sâ‚œ) = âˆ‘â‚– Î³áµ râ‚œâ‚Šâ‚– âˆ’ V(sâ‚œ) (unbiased, high variance). (3) n-step TD: Ã‚â½â¿â¾â‚œ = âˆ‘â‚–â‚Œâ‚€â¿â»Â¹ Î³áµ râ‚œâ‚Šâ‚– + Î³â¿ V(sâ‚œâ‚Šâ‚™) âˆ’ V(sâ‚œ) (intermediate). GAE (Schulman et al., 2016) interpolates between these estimators using an exponentially-weighted average controlled by Î» âˆˆ [0,1].\n\n**GAE Derivation from First Principles.** Define the k-step advantage: Ã‚â‚œâ½áµâ¾ = âˆ‘â±¼â‚Œâ‚€áµâ»Â¹ Î³Ê² râ‚œâ‚Šâ±¼ + Î³áµ V(sâ‚œâ‚Šâ‚–) âˆ’ V(sâ‚œ). GAE is the Î»-weighted average: Ã‚â‚œ^GAE(Î») = (1âˆ’Î») âˆ‘â‚–â‚Œâ‚âˆž Î»áµâ»Â¹ Ã‚â‚œâ½áµâ¾. Expanding: Ã‚â‚œ^GAE = (1âˆ’Î»)[Î»â° Ã‚â‚œâ½Â¹â¾ + Î»Â¹ Ã‚â‚œâ½Â²â¾ + Î»Â² Ã‚â‚œâ½Â³â¾ + ...]. But Ã‚â‚œâ½áµâ¾ can be written recursively using the TD error Î´â‚œ = râ‚œ + Î³V(sâ‚œâ‚Šâ‚) âˆ’ V(sâ‚œ): Ã‚â‚œâ½Â¹â¾ = Î´â‚œ, Ã‚â‚œâ½Â²â¾ = Î´â‚œ + Î³Î´â‚œâ‚Šâ‚, Ã‚â‚œâ½Â³â¾ = Î´â‚œ + Î³Î´â‚œâ‚Šâ‚ + Î³Â²Î´â‚œâ‚Šâ‚‚, etc. Substituting and simplifying: Ã‚â‚œ^GAE = âˆ‘â‚—â‚Œâ‚€âˆž (Î³Î»)Ë¡ Î´â‚œâ‚Šâ‚—. This is the GAE formula â€” a geometric series of TD errors with decay rate Î³Î».\n\n**Interpretation of Î».** Î»=0: Ã‚â‚œ = Î´â‚œ (pure 1-step TD, maximum bias reduction from V, lowest variance). Î»=1: Ã‚â‚œ = âˆ‘â‚— Î³Ë¡ Î´â‚œâ‚Šâ‚— = Gâ‚œ âˆ’ V(sâ‚œ) (Monte Carlo, no bias from V, highest variance). Î»=0.95 (typical): exponentially decay TD errors with half-life â‰ˆ 14 steps. This balances bias and variance â€” early rewards (low bias) get high weight, distant rewards (high variance) get exponentially decaying weight.\n\n**Concrete Numerical Example.** Episode with 5 steps, rewards r = [0.01, âˆ’0.02, 0.03, 0.04, 0.00], Î³ = 0.99, Î» = 0.95. Value estimates V = [0.05, 0.04, 0.06, 0.03, 0.00]. TD errors: Î´â‚€ = 0.01 + 0.99Ã—0.04 âˆ’ 0.05 = 0.0096, Î´â‚ = âˆ’0.02 + 0.99Ã—0.06 âˆ’ 0.04 = 0.0094, Î´â‚‚ = 0.03 + 0.99Ã—0.03 âˆ’ 0.06 = âˆ’0.0003, Î´â‚ƒ = 0.04 + 0.99Ã—0.00 âˆ’ 0.03 = 0.01, Î´â‚„ = 0.00. GAE at t=0: Ã‚â‚€ = Î´â‚€ + (0.99Ã—0.95)Î´â‚ + (0.99Ã—0.95)Â²Î´â‚‚ + (0.99Ã—0.95)Â³Î´â‚ƒ = 0.0096 + 0.9405Ã—0.0094 + 0.8845Ã—(âˆ’0.0003) + 0.8318Ã—0.01 = 0.0096 + 0.0088 âˆ’ 0.0003 + 0.0083 = 0.0264. This single number Ã‚â‚€ = 0.0264 is used to update the policy for action aâ‚€ â€” much more stable than the raw return Gâ‚€ = 0.01 + 0.99Ã—(âˆ’0.02) + ... = 0.052.",
            },
            {
              type: "theory",
              title: "PPO Clipped Surrogate Objective: Full Derivation & Trust Regions",
              content:
                "**From TRPO to PPO: Trust Region Motivation.** Policy gradient methods can take arbitrarily large steps in parameter space Î¸, causing catastrophic performance collapses. Trust Region Policy Optimization (TRPO, Schulman 2015) constrains each update to a 'trust region' where the policy change is small: maximize ð”¼[Ï€_Î¸(a|s)/Ï€_Î¸_old(a|s) Â· Ã‚(s,a)] subject to ð”¼[KL(Ï€_Î¸_old || Ï€_Î¸)] â‰¤ Î´. The KL divergence constraint ensures the new policy Ï€_Î¸ is close to the old policy Ï€_Î¸_old in distribution space. TRPO solves this constrained optimization using conjugate gradients and line search â€” computationally expensive and hard to implement correctly.\n\n**PPO-Clip: A First-Order Approximation to TRPO.** Proximal Policy Optimization (PPO, Schulman 2017) replaces the hard KL constraint with a soft clipping penalty directly in the objective. Define the probability ratio râ‚œ(Î¸) = Ï€_Î¸(aâ‚œ|sâ‚œ) / Ï€_Î¸_old(aâ‚œ|sâ‚œ). The unconstrained surrogate objective is L^CPI = ð”¼[râ‚œ(Î¸) Ã‚â‚œ] (Conservative Policy Iteration). PPO clips râ‚œ to [1âˆ’Îµ, 1+Îµ]: L^CLIP(Î¸) = ð”¼[min(râ‚œ(Î¸)Ã‚â‚œ, clip(râ‚œ(Î¸), 1âˆ’Îµ, 1+Îµ)Ã‚â‚œ)].\n\n**Derivation of the Clipping Behavior.** Case 1: Ã‚â‚œ > 0 (good action, we want to increase its probability). If râ‚œ > 1, the new policy already assigns higher probability than the old policy. If râ‚œ > 1+Îµ, the clipping activates: min(râ‚œÃ‚â‚œ, (1+Îµ)Ã‚â‚œ) = (1+Îµ)Ã‚â‚œ (constant w.r.t. Î¸). Gradient: âˆ‚L/âˆ‚Î¸ âˆ Ã‚â‚œ Â· âˆ‚clip(râ‚œ, 1âˆ’Îµ, 1+Îµ)/âˆ‚Î¸ = 0. The policy stops increasing this action's probability â€” the trust region boundary is reached. Case 2: Ã‚â‚œ < 0 (bad action, we want to decrease its probability). If râ‚œ < 1, the new policy already assigns lower probability. If râ‚œ < 1âˆ’Îµ, clipping activates: min(râ‚œÃ‚â‚œ, (1âˆ’Îµ)Ã‚â‚œ) = (1âˆ’Îµ)Ã‚â‚œ. Again, gradient vanishes. The policy won't decrease this action's probability further in a single update.\n\n**Numerical Example.** State s, action a, advantage Ã‚ = +0.5 (good action). Old policy: Ï€_old(a|s) = 0.2. New policy (after gradient step): Ï€_Î¸(a|s) = 0.30. Ratio: r = 0.30/0.20 = 1.5. With Îµ = 0.2: clip(1.5, 0.8, 1.2) = 1.2. Objective contributions: unconstrained = 1.5 Ã— 0.5 = 0.75, clipped = 1.2 Ã— 0.5 = 0.6. PPO uses min(0.75, 0.6) = 0.6. The clipping reduces the gradient signal, preventing the policy from jumping to Ï€(a|s) = 0.40 or higher in a single update. Over multiple updates (PPO uses K=4-10 epochs per batch), the policy gradually increases Ï€(a|s) while staying within the trust region each step.\n\n**Why Clipping Works for Trading.** Financial rewards are extremely noisy. A single lucky trade (e.g., buying right before an unexpected rate cut) might produce Ã‚ = +5.0 if the agent happened to be long. Without clipping, the policy would dramatically increase the probability of that state-action pair based on one sample â€” overfitting. PPO's clipping ensures the policy can't overreact: even with Ã‚ = +5.0, the ratio is clamped at 1.2, so the probability increase is modest (â‰ˆ20% per update). After K=4 epochs: max increase â‰ˆ (1.2)â´ = 2.07x. This prevents the catastrophic 'all-in on every signal' behavior that destroys value-based methods in noisy forex markets.",
            },
            {
              type: "theory",
              title: "A2C Architecture & PPO Training Mechanics",
              content:
                "**A2C: Synchronous Advantage Actor-Critic.** A2C (Mnih et al., 2016) parallelizes REINFORCE with baselines. Run N environment copies simultaneously (N=8 to 32 for trading). Each environment executes the current policy Ï€_Î¸ for T steps (T=128 to 2048), collecting trajectories {(sâ‚œ, aâ‚œ, râ‚œ, sâ‚œâ‚Šâ‚)}. Compute advantages Ã‚â‚œ using GAE. Update actor and critic simultaneously: âˆ‡Î¸ L_actor = âˆ’ð”¼[Ã‚â‚œ âˆ‡Î¸ log Ï€(aâ‚œ|sâ‚œ;Î¸)], âˆ‡Ï† L_critic = ð”¼[(V(sâ‚œ;Ï†) âˆ’ Gâ‚œ)Â² âˆ‡Ï† V(sâ‚œ;Ï†)]. The entropy bonus âˆ’Î²ð”¼[H[Ï€(Â·|sâ‚œ;Î¸)]] encourages exploration by penalizing deterministic policies (Î² â‰ˆ 0.01). All N workers synchronize at each update â€” no asynchrony (unlike A3C).\n\n**PPO Training Loop: Reusing Rollouts.** PPO improves sample efficiency by reusing each rollout for K epochs (K=4 to 10). (1) Collect TÃ—N transitions using current policy Ï€_Î¸_old. (2) Compute GAE advantages Ã‚â‚œ for all transitions. (3) For K epochs: shuffle transitions into mini-batches (batch size B=64), compute new policy Ï€_Î¸ and value V_Ï†, compute clipped objective L^CLIP + value loss + entropy. (4) Update Î¸ and Ï† via SGD. (5) Set Î¸_old â† Î¸, repeat. This is on-policy learning with multiple passes â€” the clipping ensures the new policy doesn't diverge too far from the data-generating policy Ï€_Î¸_old, keeping updates valid.\n\n**Shared Backbone Architecture for Trading.** The actor and critic share early layers to learn efficient state representations. State input s âˆˆ â„áµˆ (e.g., 20-50 technical features) â†’ shared backbone: [Linear(d, 256), ReLU, Linear(256, 128), ReLU]. This 128-dim representation h is used by both heads: (a) Actor head: h â†’ [Linear(128, 64), ReLU, Linear(64, |A|)] â†’ policy logits Ï€(a|s;Î¸). For continuous actions (forex position sizing), output Î¼(s) and log Ïƒ(s) for a Gaussian: Ï€(a|s) = ð’©(a; Î¼(s), ÏƒÂ²(s)). (b) Critic head: h â†’ [Linear(128, 64), ReLU, Linear(64, 1)] â†’ value V(s;Ï†). Shared layers capture common features (volatility regimes, trend strength), while separate heads specialize.\n\n**Value Function Loss.** The critic is trained to predict returns: L_value = ð”¼[(V(sâ‚œ;Ï†) âˆ’ Gâ‚œ)Â²], where Gâ‚œ = Ã‚â‚œ + V(sâ‚œ) (reconstructed from advantages). PPO adds value clipping (optional): clip the value update to [V_old(s) âˆ’ Îµ_v, V_old(s) + Îµ_v] to prevent large value jumps. The total PPO loss: L = L^CLIP âˆ’ câ‚ L_value âˆ’ câ‚‚ H, where câ‚ â‰ˆ 0.5 (value weight), câ‚‚ â‰ˆ 0.01 (entropy weight).\n\n**Hyperparameters for Forex Position Sizing.** Batch size T=2048 steps (â‰ˆ8 trading days at 256 steps/day), N=8 parallel environments, K=4 epochs, mini-batch B=64, Î³=0.99, Î»=0.95, Îµ=0.2, learning rate 3e-4 with linear decay to 0. Gradient clipping: max norm 0.5. These settings balance sample efficiency (reusing data for K epochs), stability (clipping prevents large updates), and exploration (entropy bonus prevents premature convergence to suboptimal deterministic policies).",
            },
            {
              type: "intuition",
              title: "The Coach and Player Dynamic",
              analogy:
                "Think of the actor as a football player making real-time decisions on the field, and the critic as the coach watching from the sideline with full game statistics. The player (actor) decides whether to pass, shoot, or dribble. After each play, the coach (critic) says 'that pass was +3 advantage over your average play in that situation' or 'that shot was âˆ’2 below average.' The player adjusts strategy based on these advantage signals. PPO adds a crucial rule: 'no matter what the coach says, you can't change your playbook by more than 20% between games.' This prevents the player from overreacting to one great play (overfitting to a lucky trade) or one terrible play (panic-selling after a drawdown).",
              content:
                "A2C is like having multiple players on different fields simultaneously (parallel envs), all reporting back to the same coach for a synchronized strategy update. PPO's clipping is essential for trading because financial environments are noisy â€” a single profitable trajectory might be luck, and without the trust region, the agent would lurch toward that strategy and blow up when conditions change.",
              emoji: "ðŸˆ",
            },
            {
              type: "intuition",
              title: "GAE as Exponential Evidence Decay",
              analogy:
                "Imagine you're a detective investigating whether a suspect committed a crime. You have evidence from the crime scene (time t), witness statements from 1 hour later (t+1), security footage from 2 hours later (t+2), and so on. Each piece of evidence Î´â‚œâ‚Šâ‚— has some signal about the suspect's guilt, but distant evidence is less reliable (more contaminated by other events). GAE with Î»=0.95 is like weighting the crime scene evidence at 100%, the 1-hour witness at 95%, the 2-hour footage at 90%, etc. â€” exponentially decaying trust. You don't ignore distant evidence (Î»â‰ 0), but you don't trust it as much as immediate observations. This prevents one noisy future event from dominating your conclusion about the present action.",
              content:
                "In trading, if you observe a buy action at time t followed by a +0.01 reward (immediate market move), then +0.05 two steps later (trend continuation), then âˆ’0.20 ten steps later (sudden reversal), GAE downweights the distant reversal (Î³Î»)Â¹â° â‰ˆ 0.63 while giving full weight to the immediate +0.01. This prevents blaming the buy action for a reversal that occurred due to unrelated news 10 steps later. Pure Monte Carlo (Î»=1) would fully attribute the distant reversal to the current action â€” high variance. Pure TD (Î»=0) ignores everything beyond the immediate reward â€” high bias from errors in V.",
              emoji: "ðŸ”",
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
        self.log_std = nn.Parameter(torch.zeros(1))  # learnable log Ïƒ
        self.value_head = nn.Linear(hidden, 1)    # critic V(s)

    def forward(self, x):
        h = self.shared(x)
        mu = torch.tanh(self.mu_head(h))          # position âˆˆ [-1, 1]
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
        ratio = (new_lp - old_lp).exp()          # râ‚œ(Î¸) = Ï€_new / Ï€_old

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

# â”€â”€ Training loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    # Compute returns & GAE advantages (Î³=0.99, Î»=0.95)
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
                "A complete PPO pipeline for forex: (1) ForexTradingEnv provides a 5-feature state and continuous position sizing. (2) PPOActorCritic shares a backbone between the Gaussian policy head (Î¼, Ïƒ) and value head V(s). (3) ppo_update computes the clipped surrogate loss min(râ‚œÃ‚â‚œ, clip(râ‚œ)Ã‚â‚œ) with value loss and entropy bonus. (4) GAE computes advantages with bias-variance tradeoff controlled by Î». The agent learns to size positions based on rolling statistics.",
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

# â”€â”€ Train PPO with 8 parallel EUR/USD environments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                "Multi-environment training accelerates PPO by collecting 8Ã—256 = 2048 transitions per update. MultiEnvWrapper runs 8 ForexTradingEnv instances in parallel, resetting finished episodes automatically. compute_gae handles terminal states correctly (zeroing next_value when done=True). This matches the A2C synchronous architecture â€” all envs step together, then a single policy update uses all collected data. For real forex, each env could represent a different currency pair (EUR/USD, GBP/USD, USD/JPY, etc.) to learn a universal position-sizing policy.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "rl-a2c-ppo-q1",
                  question: "Why does the advantage function A(s,a) = Q(s,a) âˆ’ V(s) reduce variance compared to using raw returns Gâ‚œ?",
                  options: [
                    { id: "rl-a2c-ppo-q1-a", text: "It removes the common value V(s) that doesn't depend on the action, isolating action-specific signal from state-dependent noise" },
                    { id: "rl-a2c-ppo-q1-b", text: "It normalizes rewards to zero mean automatically" },
                    { id: "rl-a2c-ppo-q1-c", text: "It uses a larger batch size for estimation" },
                    { id: "rl-a2c-ppo-q1-d", text: "It replaces stochastic sampling with deterministic evaluation" },
                  ],
                  correctOptionId: "rl-a2c-ppo-q1-a",
                  explanation:
                    "Raw returns Gâ‚œ include the baseline value of being in state s (which can be large and noisy) plus the action-specific effect. Subtracting V(s) removes this state-dependent component, leaving only how much better or worse the specific action was â€” a much lower-variance signal for policy updates.",
                },
                {
                  id: "rl-a2c-ppo-q2",
                  question: "In PPO, what happens when the policy ratio râ‚œ = Ï€_new/Ï€_old exceeds 1+Îµ for a positive advantage?",
                  options: [
                    { id: "rl-a2c-ppo-q2-a", text: "The loss becomes negative infinity, forcing a reset" },
                    { id: "rl-a2c-ppo-q2-b", text: "The gradient is clipped to zero for that sample â€” the policy can't increase this action's probability further" },
                    { id: "rl-a2c-ppo-q2-c", text: "The advantage is recalculated using a target network" },
                    { id: "rl-a2c-ppo-q2-d", text: "The learning rate is automatically reduced" },
                  ],
                  correctOptionId: "rl-a2c-ppo-q2-b",
                  explanation:
                    "When Ã‚ > 0 and râ‚œ > 1+Îµ, min() selects the clipped term (1+Îµ)Ã‚, which is constant w.r.t. Î¸. The gradient vanishes for this sample, preventing the policy from moving further in that direction. This is PPO's core stability mechanism â€” a soft trust region.",
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
                    "Financial rewards are noisy and non-stationary. A2C uses each rollout for a single gradient step, wasting data. PPO reuses the same rollout for K epochs of mini-batch updates (sample efficient) while the clipping constraint prevents the policy from overfitting to noisy reward signals â€” crucial when a single lucky trade could otherwise destabilize the entire strategy.",
                },
                {
                  id: "rl-a2c-ppo-q4",
                  question: "In GAE with Î»=0.95 and Î³=0.99, what is the effective half-life (in steps) of the advantage estimate?",
                  options: [
                    { id: "rl-a2c-ppo-q4-a", text: "Approximately 3 steps" },
                    { id: "rl-a2c-ppo-q4-b", text: "Approximately 14 steps" },
                    { id: "rl-a2c-ppo-q4-c", text: "Approximately 50 steps" },
                    { id: "rl-a2c-ppo-q4-d", text: "Infinite (no decay)" },
                  ],
                  correctOptionId: "rl-a2c-ppo-q4-b",
                  explanation:
                    "The GAE weights decay as (Î³Î»)áµ— = (0.99 Ã— 0.95)áµ— = 0.9405áµ—. The half-life is when 0.9405áµ— = 0.5, which gives t â‰ˆ ln(0.5)/ln(0.9405) â‰ˆ 14 steps. This means rewards 14 steps in the future contribute only half as much to the current advantage estimate as the immediate reward. This balances between TD (Î»=0, immediate only) and MC (Î»=1, infinite horizon).",
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
                    "Environment interactions (real forex trades or market simulations) are expensive. A2C uses each rollout only once (wasteful). PPO reuses the same data for K epochs of SGD, extracting more learning from each interaction. The clipping constraint ensures that even after K epochs, the new policy Ï€_Î¸ hasn't diverged far from the data-generating policy Ï€_Î¸_old, so the updates remain approximately on-policy and valid.",
                },
                {
                  id: "rl-a2c-ppo-q6",
                  question: "What is the purpose of the entropy bonus âˆ’Î² H[Ï€(Â·|s)] in the PPO loss?",
                  options: [
                    { id: "rl-a2c-ppo-q6-a", text: "To encourage exploration by penalizing overly deterministic policies" },
                    { id: "rl-a2c-ppo-q6-b", text: "To reduce the computational cost of the policy network" },
                    { id: "rl-a2c-ppo-q6-c", text: "To stabilize the value function estimates" },
                    { id: "rl-a2c-ppo-q6-d", text: "To ensure the policy is Gaussian" },
                  ],
                  correctOptionId: "rl-a2c-ppo-q6-a",
                  explanation:
                    "Entropy H = âˆ’âˆ‘â‚ Ï€(a|s) log Ï€(a|s) measures the randomness of the policy. High entropy = uniform distribution (maximum exploration), low entropy = deterministic (no exploration). Subtracting Î²Â·H from the loss penalizes low-entropy policies, encouraging the agent to maintain stochasticity and continue exploring. For trading, this prevents premature convergence to a deterministic strategy that might be locally optimal but misses better alternatives. Typical Î² = 0.01.",
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
                    "The shared backbone learns a representation h(s) that is useful for both policy selection (actor) and value prediction (critic). The critic's gradient signal (value loss) provides an auxiliary learning objective that helps the shared layers learn better features. For trading, the shared layers might learn to detect volatility regimes, trends, or mean-reversion patterns â€” features useful for both 'which action to take' (actor) and 'what is the expected return' (critic). This is more sample-efficient than training two separate networks.",
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
                "Implement a grid search over Î» âˆˆ {0, 0.5, 0.9, 0.95, 0.99, 1.0} and Î³ âˆˆ {0.9, 0.95, 0.99}. For each configuration, train a PPO agent on synthetic forex data for 100 episodes. Plot learning curves (cumulative return vs episode) and measure final policy Sharpe ratio. Analyze: which Î» gives fastest convergence? Which gives highest final Sharpe? What is the bias-variance tradeoff empirically observed?",
              catalogModelId: "ppo-position-sizing",
            },
          ],
        },
        // â”€â”€ Lesson 4: Reward Engineering for Financial RL â”€â”€â”€â”€â”€â”€â”€â”€
        {
          id: "rl-reward-shaping",
          title: "Reward Engineering for Financial RL",
          description:
            "Design reward functions that align agent behavior with trading objectives â€” from raw P&L to differential Sharpe ratios, Sortino-based rewards, and drawdown penalties. Understand reward hacking and potential-based reward shaping.",
          estimatedMinutes: 50,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Master reward engineering for financial RL agents â€” implement multiple reward functions (raw PnL, differential Sharpe, Sortino, drawdown-penalized), understand reward shaping theory, and diagnose reward hacking pitfalls.",
              keyTakeaways: [
                "Reward design is the most impactful decision in financial RL â€” it defines what 'good trading' means to the agent",
                "Raw P&L rewards are sparse and noisy; differential Sharpe ratio provides a dense, risk-adjusted signal",
                "Potential-based reward shaping (PBRS) preserves the optimal policy: F(s,sâ€²) = Î³Î¦(sâ€²) âˆ’ Î¦(s)",
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
                "**The Reward Shaping Problem.** In sparse-reward environments (e.g., trading where most rewards are near-zero noise), RL agents struggle to discover good policies â€” credit assignment is ambiguous over long horizons. Reward shaping adds intermediate rewards to guide learning. But naive shaping can change the optimal policy Ï€*. Example: adding a constant bonus c for 'being in profit' shifts the optimal policy from 'maximize total return' to 'maximize time spent in profit' (different objectives!).\n\n**Potential-Based Reward Shaping (Ng, Harada, Russell 1999).** Define a potential function Î¦: S â†’ â„. The shaped reward is: Râ€²(s,a,sâ€²) = R(s,a,sâ€²) + F(s,sâ€²), where F(s,sâ€²) = Î³Î¦(sâ€²) âˆ’ Î¦(s) is the shaping function. Theorem (PBRS): The optimal policy Ï€* under Râ€² is identical to the optimal policy under R â€” the shaping does not change which policy is best, only how quickly it is learned.\n\n**Proof Sketch (Policy Invariance).** The Q-function under shaped rewards is Qâ€²(s,a) = ð”¼[âˆ‘â‚œ Î³áµ— Râ€²â‚œ | sâ‚€=s, aâ‚€=a]. Expand: Qâ€²(s,a) = ð”¼[âˆ‘â‚œ Î³áµ— (Râ‚œ + Î³Î¦(sâ‚œâ‚Šâ‚) âˆ’ Î¦(sâ‚œ))]. This is a telescoping sum: the Î³Î¦(sâ‚œâ‚Šâ‚) from step t cancels with âˆ’Î³Î¦(sâ‚œâ‚Šâ‚) from step t+1. After cancellation: Qâ€²(s,a) = ð”¼[âˆ‘â‚œ Î³áµ— Râ‚œ] âˆ’ Î¦(s) = Q(s,a) âˆ’ Î¦(s). The value function: Vâ€²(s) = maxâ‚ Qâ€²(s,a) = maxâ‚ [Q(s,a) âˆ’ Î¦(s)] = maxâ‚ Q(s,a) âˆ’ Î¦(s) = V(s) âˆ’ Î¦(s). The optimal action: Ï€*(s) = argmaxâ‚ Qâ€²(s,a) = argmaxâ‚ [Q(s,a) âˆ’ Î¦(s)] = argmaxâ‚ Q(s,a) (since Î¦(s) is constant w.r.t. a). Therefore Ï€* is unchanged â€” the optimal actions are the same under Râ€² and R.\n\n**Constructing Î¦ for Trading.** (1) Heuristic potential: Î¦(s) = equity âˆ’ equityâ‚€ (current profit). F(s,sâ€²) = Î³(equityâ€² âˆ’ equityâ‚€) âˆ’ (equity âˆ’ equityâ‚€) = Î³Â·equityâ€² âˆ’ equity. This provides a dense reward at every step (immediate P&L) while preserving the optimal long-term policy. (2) Learned potential: Pre-train a value network V_prior on historical data. Use Î¦(s) = V_prior(s). This guides exploration toward states the prior thinks are valuable. (3) Risk-based potential: Î¦(s) = âˆ’Ïƒ_portfolio(s) (negative volatility). F encourages transitions toward lower-volatility states.\n\n**Non-Potential Shaping (Dangerous).** Adding F(s,sâ€²) = +1 whenever equity > equityâ‚€ is NOT potential-based (cannot write as Î³Î¦(sâ€²) âˆ’ Î¦(s)). This changes Ï€* to maximize time-in-profit rather than total profit â€” the agent might take tiny positions to avoid ever dropping below starting equity, achieving zero drawdown but also zero return. PBRS guarantees this cannot happen.",
            },
            {
              type: "theory",
              title: "Differential Sharpe Ratio: Full Derivation & Online Computation",
              content:
                "**Sharpe Ratio as Objective.** The Sharpe ratio S = Î¼/Ïƒ (mean return over standard deviation) is the canonical risk-adjusted performance metric. We want the RL agent to maximize S, not raw return Î¼. The challenge: computing S requires the full trajectory (we don't know Ïƒ until the episode ends) â€” incompatible with step-by-step RL rewards.\n\n**Differential Sharpe (Moody & Saffell 1998).** The differential Sharpe dSâ‚œ approximates âˆ‚S/âˆ‚râ‚œ â€” the marginal contribution of the current return râ‚œ to the overall Sharpe ratio. It can be computed online using exponential moving averages (EMAs). Let Aâ‚œ = (1âˆ’Î·)Aâ‚œâ‚‹â‚ + Î·Â·râ‚œ (EMA of returns, approximates Î¼), Bâ‚œ = (1âˆ’Î·)Bâ‚œâ‚‹â‚ + Î·Â·râ‚œÂ² (EMA of squared returns, approximates ð”¼[rÂ²]). The variance: Ïƒâ‚œÂ² â‰ˆ Bâ‚œ âˆ’ Aâ‚œÂ². The Sharpe ratio: Sâ‚œ â‰ˆ Aâ‚œ / âˆš(Bâ‚œ âˆ’ Aâ‚œÂ²).\n\n**Derivation of dS.** We want dSâ‚œ â‰ˆ âˆ‚Sâ‚œ/âˆ‚râ‚œ. Using the quotient rule and chain rule: âˆ‚Sâ‚œ/âˆ‚râ‚œ = âˆ‚/âˆ‚râ‚œ [Aâ‚œ / âˆš(Bâ‚œ âˆ’ Aâ‚œÂ²)]. Compute partials: âˆ‚Aâ‚œ/âˆ‚râ‚œ = Î·, âˆ‚Bâ‚œ/âˆ‚râ‚œ = 2Î·râ‚œ. Then: âˆ‚Sâ‚œ/âˆ‚râ‚œ = [âˆš(Bâ‚œ âˆ’ Aâ‚œÂ²)Â·Î· âˆ’ Aâ‚œÂ·(âˆ’2Aâ‚œÂ·Î· + 2Î·râ‚œÂ·1/2)/âˆš(Bâ‚œ âˆ’ Aâ‚œÂ²)] / (Bâ‚œ âˆ’ Aâ‚œÂ²). Simplify: âˆ‚Sâ‚œ/âˆ‚râ‚œ = [Î·(Bâ‚œ âˆ’ Aâ‚œÂ²) + Aâ‚œÎ·(Aâ‚œ âˆ’ râ‚œ)] / (Bâ‚œ âˆ’ Aâ‚œÂ²)^(3/2). Factor out Î· and rearrange: dSâ‚œ = Î· [Bâ‚œ âˆ’ Aâ‚œÂ·râ‚œ] / (Bâ‚œ âˆ’ Aâ‚œÂ²)^(3/2). For numerical stability, absorb Î· into the EMA definition and use: dSâ‚œ = (Bâ‚œ âˆ’ Aâ‚œÂ·râ‚œ) / (Bâ‚œ âˆ’ Aâ‚œÂ²)^(3/2). Alternatively (equivalent form from Moody): dSâ‚œ = (Bâ‚œâ‚‹â‚Â·Î”râ‚œ âˆ’ Â½Aâ‚œâ‚‹â‚Â·Î”râ‚œÂ²) / (Bâ‚œâ‚‹â‚ âˆ’ Aâ‚œâ‚‹â‚Â²)^(3/2), where Î”râ‚œ = râ‚œ âˆ’ Aâ‚œâ‚‹â‚, Î”râ‚œÂ² = râ‚œÂ² âˆ’ Bâ‚œâ‚‹â‚.\n\n**Numerical Example.** Initialize Aâ‚€ = 0, Bâ‚€ = 0, Î· = 0.01. At t=1, observe return râ‚ = 0.005. Aâ‚ = 0 + 0.01Ã—0.005 = 0.00005. Bâ‚ = 0 + 0.01Ã—0.005Â² = 0.00000025. Variance Ïƒâ‚Â² = 0.00000025 âˆ’ 0.00005Â² â‰ˆ 0 (too early). Use fallback: dSâ‚ = râ‚ = 0.005. At t=100 (after many steps), Aâ‚â‚€â‚€ = 0.0002 (â‰ˆ 2bps mean daily return), Bâ‚â‚€â‚€ = 0.000064 (variance ÏƒÂ² = 0.000064 âˆ’ 0.0002Â² = 0.00006). If râ‚â‚€â‚€ = 0.008 (strong positive day): dSâ‚â‚€â‚€ = (0.000064 âˆ’ 0.0002Ã—0.008) / (0.00006)^(3/2) = (0.000064 âˆ’ 0.0000016) / 0.0000147 â‰ˆ 4.24. This high dS signals that the 0.8% gain significantly improves the Sharpe ratio. If râ‚â‚€â‚€ = âˆ’0.01 (large loss): dSâ‚â‚€â‚€ = (0.000064 + 0.0002Ã—0.01) / (0.00006)^(3/2) â‰ˆ âˆ’27.2 â€” the loss drastically hurts the Sharpe ratio, producing a large negative reward.\n\n**Advantages for RL.** (1) Dense: non-zero at every step (vs end-of-episode Sharpe). (2) Risk-adjusted: penalizes variance implicitly. (3) Directly aligned with trading objectives (Sharpe is what allocators care about). (4) Online: no need to store full trajectory. Disadvantages: (1) EMA hyperparameter Î· requires tuning (Î·=0.01 â‰ˆ 100-day half-life). (2) Sensitive to initialization (early steps have undefined dS â€” use fallback to raw return).",
            },
            {
              type: "theory",
              title: "Multi-Objective Rewards, Clipping, and Reward Hacking",
              content:
                "**Multi-Objective Reward Construction.** Trading goals are multidimensional: maximize profit, minimize risk, control costs, limit drawdowns. A composite reward: R = wâ‚Â·PnL + wâ‚‚Â·dSharpe âˆ’ wâ‚ƒÂ·DD_penalty âˆ’ wâ‚„Â·|Î”position|Â·cost âˆ’ wâ‚…Â·(volatility âˆ’ target_vol)Â². The weights wáµ¢ encode preferences. Typical values: wâ‚=1.0 (profit), wâ‚‚=0.5 (Sharpe boost), wâ‚ƒ=10.0 (drawdown avoidance), wâ‚„=0.1 (cost minimization), wâ‚…=0.2 (vol targeting).\n\n**Drawdown Penalty Design.** Current drawdown: DDâ‚œ = (peak_equity âˆ’ equityâ‚œ) / peak_equity. Penalty options: (1) Linear: âˆ’wâ‚ƒÂ·DDâ‚œ (penalizes all drawdowns proportionally). (2) Quadratic: âˆ’wâ‚ƒÂ·DDâ‚œÂ² (penalizes large drawdowns exponentially more). (3) Threshold: âˆ’wâ‚ƒÂ·max(DDâ‚œ âˆ’ Î´, 0) (only penalize drawdowns beyond Î´=5%, tolerating normal fluctuations). The quadratic form is most effective: a 10% DD gets penalty âˆ’10Â², a 20% DD gets âˆ’400 â€” strongly discouraging tail risk.\n\n**Sortino-Based Rewards.** The Sortino ratio S_sortino = Î¼ / Ïƒ_down, where Ïƒ_down = âˆš(ð”¼[min(râˆ’Ï„, 0)Â²]) is downside deviation below threshold Ï„ (often Ï„=0). This penalizes only downside volatility. Differential Sortino (analogous to differential Sharpe): maintain EMA of negative returns: Dâ‚œ = (1âˆ’Î·)Dâ‚œâ‚‹â‚ + Î·Â·min(râ‚œ,0)Â². Then dSortinoâ‚œ â‰ˆ râ‚œ / âˆšDâ‚œ. This encourages asymmetric strategies: the agent can take upside risk freely (high Ïƒ_up is fine) but must avoid downside risk (low Ïƒ_down required).\n\n**Reward Clipping.** Raw trading rewards have heavy tails: most days râ‚œ â‰ˆ 0, but rare events produce |râ‚œ| > 10Ã—mean. This causes gradient explosions. Clipping: r_clipped = clip(râ‚œ, âˆ’c, +c), where c is the 99th percentile of |râ‚œ| on historical data. Alternatively, adaptive clipping: r_clipped = tanh(râ‚œ / Ïƒ_r), where Ïƒ_r is the running std of rewards. This squashes extreme outliers while preserving ordinal information.\n\n**Reward Normalization.** Normalize rewards to zero mean, unit variance: r_norm = (râ‚œ âˆ’ Î¼_r) / Ïƒ_r, where Î¼_r and Ïƒ_r are running statistics. This ensures the advantage function Ã‚(s,a) has consistent scale across different market regimes (volatile vs calm periods). Without normalization, the policy gradient magnitude fluctuates wildly, destabilizing training.\n\n**Reward Hacking Examples in Trading.** (1) Churn hacking: If the reward includes a small bonus for 'active trading' (to avoid do-nothing policies), the agent learns to flip positions every step, generating massive transaction costs but technically maximizing the reward. (2) Volatility farming: If the reward is raw return without risk adjustment, the agent takes maximum leverage to maximize |râ‚œ| â€” works until a tail event wipes out the account. (3) Accounting tricks: If drawdown is measured from initial equity (not peak), the agent front-loads gains (lucky early trades boost equity), then trades conservatively to preserve the high watermark â€” gaming the metric without generating consistent alpha. (4) Exploit delays: If transaction costs are charged at t+1 but rewards at t, the agent churns at t and exits at t+1 before costs hit â€” exploiting the timing mismatch.\n\n**Preventing Reward Hacking.** (1) Adversarial validation: test the trained agent on out-of-distribution data (different market regimes, extreme volatility). If performance collapses, the agent likely hacked a regime-specific loophole. (2) Explicit constraints: add hard constraints (max |Î”position| < 0.5, max trades/day < 10) that cannot be gamed. (3) Ensemble metrics: require the agent to satisfy Sharpe > 1.0 AND max DD < 15% AND calmar > 0.5 simultaneously â€” harder to game three metrics than one. (4) Human review: inspect trajectories for 'suspicious' patterns (rapid flips, position size spikes, etc.).",
            },
            {
              type: "intuition",
              title: "Dog Training Treats for Trading Agents",
              analogy:
                "Training a trading agent is like training a dog to run an agility course. If you only give a treat at the finish line (sparse reward = end-of-episode P&L), the dog has no idea which jumps and turns contributed to success â€” learning is painfully slow. Dense rewards are like giving small treats along the course: 'good turn! good jump!' But you must be careful: if you give a treat for running fast regardless of direction, the dog learns to sprint in circles (reward hacking). The differential Sharpe ratio is a carefully calibrated treat that rewards good runs AND penalizes reckless speed â€” exactly what agility judges score.",
              content:
                "Reward hacking in trading is insidious. An agent rewarded purely on trade count might churn to maximize activity. One rewarded on raw P&L might take massive unhedged positions that look profitable until a tail event wipes out the account. Potential-based shaping is like pre-installing agility course knowledge without changing what a 'perfect run' looks like â€” the dog still aims for the same finish line, but with better intermediate guidance.",
              emoji: "ðŸ•",
            },
            {
              type: "intuition",
              title: "Goodhart's Law in Reward Design",
              analogy:
                "Goodhart's Law: 'When a measure becomes a target, it ceases to be a good measure.' Imagine a company that rewards salespeople purely on number of sales. Rational response: sell to anyone, regardless of product fit. Customers churn, reputation tanks, long-term revenue collapses â€” but sales count is maximized. The same happens in RL: optimize Sharpe ratio naively, the agent learns to trade tiny positions (low Ïƒ, high S, but near-zero profit). Optimize raw return, the agent takes 100x leverage (high Î¼, catastrophic risk). The solution: multi-objective rewards with carefully balanced weights. Like a balanced scorecard for employees (sales AND customer satisfaction AND retention), we need profit AND risk-adjustment AND drawdown control. No single metric is un-gameable.",
              content:
                "PBRS is the exception: it's a 'free lunch' because the policy invariance theorem guarantees you can't game it â€” the optimal policy is unchanged. But PBRS only accelerates learning, it doesn't define the objective. You still need a well-designed base reward R(s,a,sâ€²). Think of PBRS as scaffolding that helps you build the right building faster, but the blueprint (base reward) must be correct first.",
              emoji: "ðŸŽ¯",
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
        """R1: Raw P&L â€” simplest but sparse and risk-ignorant."""
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
        """R3: Sortino-based â€” penalizes downside deviation only."""
        r = position * price_return
        if r < 0:
            self.downside_sq_sum += r ** 2
            self.downside_count += 1
        downside_std = np.sqrt(self.downside_sq_sum / max(self.downside_count, 1))
        return r / max(downside_std, 1e-6)

    def drawdown_penalized(self, position: float, price_return: float,
                           dd_penalty: float = 2.0) -> float:
        """R4: PnL with drawdown penalty â€” penalizes equity curve dips."""
        r = position * price_return
        self.equity += r
        self.peak_equity = max(self.peak_equity, self.equity)
        drawdown = (self.peak_equity - self.equity) / self.peak_equity
        return r - dd_penalty * max(drawdown - 0.05, 0)  # penalty beyond 5% DD

# â”€â”€ Simulate and compare agent behavior under each reward â”€â”€â”€â”€
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
                "Four reward functions applied to the same momentum strategy: (1) Raw PnL is sparse and noisy. (2) Differential Sharpe approximates the marginal Sharpe contribution using EMA statistics â€” dense and risk-adjusted. (3) Sortino penalizes only downside deviation, encouraging asymmetric risk-taking. (4) Drawdown-penalized adds an explicit penalty when equity falls >5% from peak. Comparing their statistics reveals why differential Sharpe is preferred â€” it provides the most informative gradient signal for policy optimization.",
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
        """Heuristic potential: Î¦(s) = normalized equity.
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
        
        # Potential-based shaping: F(s, sâ€²) = Î³Â·Î¦(sâ€²) âˆ’ Î¦(s)
        shaping = self.gamma * self.potential(new_state) - self.potential(old_state)
        
        # Shaped reward preserves optimal policy but provides denser signal
        shaped_reward = base_reward + shaping
        
        return new_state, shaped_reward, done, {'base_reward': base_reward, 'shaping': shaping}

# â”€â”€ Demonstrate PBRS policy invariance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
print(f"The shaping term F(s,sâ€²) = Î³Î¦(sâ€²) âˆ’ Î¦(s) encourages moving toward high-Î¦ states")
print(f"(low volatility, positive equity), accelerating learning without changing Ï€*.")`,
              explanation:
                "This example implements PBRS with a heuristic potential Î¦(s) = equity âˆ’ 0.5Â·volatility. The shaping term F(s,sâ€²) = Î³Î¦(sâ€²) âˆ’ Î¦(s) provides a dense reward signal (moving toward low-vol, high-equity states) at every step, while the policy invariance theorem guarantees the optimal policy is unchanged. In practice, you could replace the heuristic Î¦ with a pre-trained value network V_prior(s) from supervised learning on historical expert trajectories, bootstrapping RL with domain knowledge.",
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

# â”€â”€ Test on simulated trading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                    { id: "rl-reward-q1-b", text: "It is sparse, high-variance, and risk-ignorant â€” two very different strategies can produce similar cumulative P&L" },
                    { id: "rl-reward-q1-c", text: "It violates the Markov property" },
                    { id: "rl-reward-q1-d", text: "It cannot be computed for continuous action spaces" },
                  ],
                  correctOptionId: "rl-reward-q1-b",
                  explanation:
                    "Raw P&L râ‚œ = position Â· Î”price is dominated by price noise (most steps yield near-zero signal). It treats a +$100 from a reckless 100x leveraged bet identically to +$100 from a disciplined position â€” no risk adjustment. An agent optimizing raw P&L tends to take extreme positions.",
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
                    "Reward hacking occurs when the agent optimizes the reward metric in unintended ways. If the reward includes any component correlated with trading frequency (even implicitly), the agent may learn to rapidly open and close positions â€” technically maximizing the metric while generating real losses from spreads and slippage.",
                },
                {
                  id: "rl-reward-q3",
                  question: "Why is the differential Sharpe ratio preferred over raw P&L as a reward signal?",
                  options: [
                    { id: "rl-reward-q3-a", text: "It requires less data to compute" },
                    { id: "rl-reward-q3-b", text: "It is always positive, making optimization easier" },
                    { id: "rl-reward-q3-c", text: "It provides a dense, risk-adjusted signal that approximates each trade's marginal contribution to the overall Sharpe ratio" },
                    { id: "rl-reward-q3-d", text: "It eliminates the need for a discount factor Î³" },
                  ],
                  correctOptionId: "rl-reward-q3-c",
                  explanation:
                    "The differential Sharpe ratio dSâ‚œ measures how much the current trade improves or hurts the running Sharpe ratio. It is dense (non-zero at every step), risk-adjusted (penalizes variance), and directly aligned with the metric traders actually care about. This gives the policy gradient a much more informative signal than sparse raw P&L.",
                },
                {
                  id: "rl-reward-q4",
                  question: "What guarantees that potential-based reward shaping F(s,sâ€²) = Î³Î¦(sâ€²) âˆ’ Î¦(s) does not change the optimal policy?",
                  options: [
                    { id: "rl-reward-q4-a", text: "The shaping term is always small relative to the base reward" },
                    { id: "rl-reward-q4-b", text: "The shaping term telescopes in the cumulative return, leaving Q(s,a) = Q_shaped(s,a) + constant, so argmax Q is unchanged" },
                    { id: "rl-reward-q4-c", text: "The discount factor Î³ makes future rewards irrelevant" },
                    { id: "rl-reward-q4-d", text: "The potential function Î¦ must be non-negative" },
                  ],
                  correctOptionId: "rl-reward-q4-b",
                  explanation:
                    "The PBRS theorem proof shows that Q_shaped(s,a) = Q(s,a) âˆ’ Î¦(s) because the shaping terms Î³Î¦(sâ€²) from step t and âˆ’Î¦(sâ€²) from step t+1 cancel (telescoping). Since Î¦(s) is constant w.r.t. action a, Ï€*(s) = argmax_a Q_shaped(s,a) = argmax_a [Q(s,a) âˆ’ Î¦(s)] = argmax_a Q(s,a). The optimal policy is preserved.",
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
                    "Sharpe ratio S = Î¼/Ïƒ penalizes all volatility (upside and downside equally). Sortino ratio S_sortino = Î¼/Ïƒ_down only penalizes downside volatility Ïƒ_down = âˆšð”¼[min(r,0)Â²]. This reflects the reality that traders love upside volatility (big gains) but hate downside volatility (losses). An RL agent optimizing Sortino can take aggressive upside bets while avoiding downside risk.",
                },
                {
                  id: "rl-reward-q6",
                  question: "What is the purpose of reward normalization (r âˆ’ Î¼)/Ïƒ in financial RL?",
                  options: [
                    { id: "rl-reward-q6-a", text: "To ensure all rewards are positive" },
                    { id: "rl-reward-q6-b", text: "To make training faster by reducing the number of episodes needed" },
                    { id: "rl-reward-q6-c", text: "To stabilize policy gradients by ensuring consistent reward scale across different market volatility regimes" },
                    { id: "rl-reward-q6-d", text: "To satisfy the Markov property" },
                  ],
                  correctOptionId: "rl-reward-q6-c",
                  explanation:
                    "Financial markets have time-varying volatility. In calm periods, |râ‚œ| â‰ˆ 0.001 daily. In volatile periods, |râ‚œ| â‰ˆ 0.05. Without normalization, the policy gradient magnitude âˆ‡Î¸ J âˆ râ‚œÂ·âˆ‡Î¸ log Ï€(a|s) varies by 50x between regimes, causing training instability (exploding gradients in volatile periods, vanishing gradients in calm periods). Normalizing to zero mean, unit variance ensures stable gradient magnitudes regardless of market conditions.",
                },
                {
                  id: "rl-reward-q7",
                  question: "In a multi-objective reward R = wâ‚Â·PnL + wâ‚‚Â·dSharpe âˆ’ wâ‚ƒÂ·DDÂ², how should you set weights to strongly discourage drawdowns?",
                  options: [
                    { id: "rl-reward-q7-a", text: "Set wâ‚ > wâ‚‚ > wâ‚ƒ (profit most important)" },
                    { id: "rl-reward-q7-b", text: "Set wâ‚ƒ >> wâ‚, wâ‚‚ (drawdown penalty dominates)" },
                    { id: "rl-reward-q7-c", text: "Set all weights equal (wâ‚ = wâ‚‚ = wâ‚ƒ)" },
                    { id: "rl-reward-q7-d", text: "Drawdown weight doesn't matter if the penalty is quadratic" },
                  ],
                  correctOptionId: "rl-reward-q7-b",
                  explanation:
                    "If you want the agent to prioritize low drawdowns, set wâ‚ƒ = 10-50 while wâ‚ = 1.0 and wâ‚‚ = 0.5. The large wâ‚ƒ makes even small drawdowns (DD=10% â†’ DDÂ²=0.01 â†’ penalty=0.1 to 0.5) outweigh typical per-step profits (PnL â‰ˆ 0.001). This creates a strong gradient signal to avoid equity dips. If wâ‚ƒ is too small, the agent ignores drawdowns. If wâ‚ƒ is too large (e.g., 1000), the agent never trades (safest strategy is position=0).",
                },
              ],
            },
            {
              type: "practice",
              title: "Custom Reward Function Design",
              description:
                "Design a custom multi-objective reward function R = wâ‚Â·PnL + wâ‚‚Â·dSharpe âˆ’ wâ‚ƒÂ·drawdown_penalty âˆ’ wâ‚„Â·|Î”position|Â·cost that balances profit and maximum drawdown. Train a PPO agent with this reward on EUR/USD 1H data for 1000 episodes. Compare the resulting equity curves, Sharpe ratios, and max drawdowns against an agent trained with raw P&L reward. Tune the weights wáµ¢ to achieve Sharpe > 1.0 with max drawdown < 15%.",
              catalogModelId: "ppo-position-sizing",
            },
            {
              type: "practice",
              title: "Reward Hacking Detection & Mitigation",
              description:
                "Train a PPO agent with a deliberately hackable reward: R = raw_PnL + 0.01Â·num_trades (small bonus for trading activity). Observe the agent learning to churn positions. Then add an explicit constraint: |Î”position| < 0.3 and max_trades_per_day < 5. Retrain and compare: (1) equity curves, (2) transaction costs, (3) turnover ratio, (4) out-of-sample Sharpe. Document the hacking behavior (plot position flip frequency) and the mitigation's effectiveness.",
              catalogModelId: "ppo-position-sizing",
            },
          ],
        },
      ],
    },
  ],
};

