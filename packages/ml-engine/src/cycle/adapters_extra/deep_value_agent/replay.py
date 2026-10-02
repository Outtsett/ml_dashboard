"""Experience replay for the deep value agents: uniform or prioritized, with
n-step folding.

``ReplayBuffer.add`` takes one environment step (observation, action, reward,
next observation, done). With ``step_count`` n > 1 it holds the last n steps
and stores the folded transition of the oldest one:

    (s_t, a_t, R = r_t + g r_{t+1} + ... + g^(k-1) r_{t+k-1}, s_{t+k}, done, g^k)

with k = n, or fewer when the episode ends first (then every pending step is
flushed with the terminal flag, Sutton and Barto 7.1). The stored ``discount``
is g^k, so the learner's target is R + (1 - done) * discount * Q(s_{t+k}).

Prioritized replay (Schaul et al. 2016, proportional variant): a transition is
drawn with probability p_i^alpha / sum p^alpha from a sum tree (O(log N) per
draw), sampled by stratified segments; the importance weight
(N * P(i))^(-beta) / max weight corrects the bias; new transitions enter at the
current maximum priority so each is replayed at least once. Uniform replay is
the same buffer with every priority 1.

All randomness comes from the ``numpy.random.Generator`` passed in, so a fit
with a fixed seed replays the same minibatches. Exported read-only for
``hierarchical_agent``.
"""

from __future__ import annotations

from collections import deque

import numpy as np

PRIORITY_FLOOR = 1e-6


class SumTree:
    """A binary tree whose leaves hold priorities and whose inner nodes hold
    the sum of their children; ``find(mass)`` walks down to the leaf whose
    cumulative range holds ``mass``."""

    def __init__(self, capacity: int) -> None:
        self.capacity = int(capacity)
        size = 1
        while size < self.capacity:
            size *= 2
        self.leaf_start = size
        self.tree = np.zeros(2 * size, dtype=np.float64)

    @property
    def total(self) -> float:
        return float(self.tree[1])

    def update(self, indices, priorities) -> None:
        """Set the leaves ``indices`` to ``priorities`` (the last write of a
        repeated index wins) and recompute every sum above them, level by level."""
        indices = np.atleast_1d(np.asarray(indices, dtype=np.int64))
        priorities = np.broadcast_to(np.asarray(priorities, dtype=np.float64), indices.shape)
        nodes = self.leaf_start + indices
        for node, priority in zip(nodes, priorities):
            self.tree[node] = priority
        nodes = np.unique(nodes // 2)
        while nodes.size and nodes[0] >= 1:
            self.tree[nodes] = self.tree[2 * nodes] + self.tree[2 * nodes + 1]
            if nodes[0] == 1:
                break
            nodes = np.unique(nodes // 2)

    def value(self, indices) -> np.ndarray:
        return self.tree[self.leaf_start + np.asarray(indices, dtype=np.int64)]

    def find(self, masses) -> np.ndarray:
        """The leaf index whose cumulative range holds each of ``masses``."""
        masses = np.array(masses, dtype=np.float64, copy=True).reshape(-1)
        nodes = np.ones(masses.shape, dtype=np.int64)
        while nodes[0] < self.leaf_start:
            left = 2 * nodes
            go_left = (masses <= self.tree[left]) | (self.tree[left + 1] <= 0.0)
            masses = np.where(go_left, masses, masses - self.tree[left])
            nodes = np.where(go_left, left, left + 1)
        return np.minimum(nodes - self.leaf_start, self.capacity - 1)


class ReplayBuffer:
    def __init__(self, capacity: int, observation_size: int, generator: np.random.Generator, *,
                 prioritized: bool = False, priority_exponent: float = 0.5, step_count: int = 1,
                 discount_factor: float = 0.99) -> None:
        if int(capacity) < 1:
            raise ValueError(f"capacity must be >= 1, got {capacity}")
        if int(step_count) < 1:
            raise ValueError(f"step_count must be >= 1, got {step_count}")
        self.capacity = int(capacity)
        self.generator = generator
        self.prioritized = bool(prioritized)
        self.priority_exponent = float(priority_exponent)
        self.step_count = int(step_count)
        self.discount_factor = float(discount_factor)
        self.observations = np.zeros((self.capacity, int(observation_size)), dtype=np.float32)
        self.next_observations = np.zeros((self.capacity, int(observation_size)), dtype=np.float32)
        self.actions = np.zeros(self.capacity, dtype=np.int64)
        self.rewards = np.zeros(self.capacity, dtype=np.float32)
        self.done = np.zeros(self.capacity, dtype=np.float32)
        self.discounts = np.zeros(self.capacity, dtype=np.float32)
        self.tree = SumTree(self.capacity)
        self.maximum_priority = 1.0
        self.position = 0
        self.size = 0
        self.pending: deque = deque()

    def __len__(self) -> int:
        return self.size

    # ── writing ──
    def _store(self, observation, action, reward, next_observation, done, discount) -> None:
        slot = self.position
        self.observations[slot] = observation
        self.next_observations[slot] = next_observation
        self.actions[slot] = int(action)
        self.rewards[slot] = float(reward)
        self.done[slot] = float(done)
        self.discounts[slot] = float(discount)
        if self.prioritized:                     # uniform replay never reads the tree
            self.tree.update(slot, self.maximum_priority ** self.priority_exponent)
        self.position = (self.position + 1) % self.capacity
        self.size = min(self.size + 1, self.capacity)

    def _fold_oldest(self, next_observation, done: bool) -> None:
        """Store the pending step at the front, folded over every pending step."""
        observation, action, _, _ = self.pending[0]
        folded, power = 0.0, 1.0
        for _, _, reward, _ in self.pending:
            folded += power * reward
            power *= self.discount_factor
        self._store(observation, action, folded, next_observation, done, power)
        self.pending.popleft()

    def add(self, observation, action: int, reward: float, next_observation, done: bool) -> None:
        self.pending.append((np.asarray(observation, dtype=np.float32), int(action), float(reward),
                             np.asarray(next_observation, dtype=np.float32)))
        if done:
            while self.pending:
                self._fold_oldest(next_observation, True)
        elif len(self.pending) >= self.step_count:
            self._fold_oldest(next_observation, False)

    def flush(self, next_observation) -> None:
        """End of the data without a terminal state: the pending steps are stored
        as terminal (nothing after them is known)."""
        while self.pending:
            self._fold_oldest(next_observation, True)

    # ── reading ──
    def sample(self, batch_size: int, importance_exponent: float = 1.0) -> dict:
        if self.size == 0:
            raise ValueError("the replay buffer is empty")
        batch_size = int(batch_size)
        if self.prioritized:
            total = self.tree.total
            edges = np.linspace(0.0, total, batch_size + 1)
            masses = self.generator.uniform(edges[:-1], edges[1:])
            indices = np.minimum(self.tree.find(masses), self.size - 1)
            probabilities = self.tree.value(indices) / total
            weights = (self.size * np.maximum(probabilities, 1e-12)) ** (-float(importance_exponent))
            weights = weights / weights.max()
        else:
            indices = self.generator.integers(0, self.size, size=batch_size)
            weights = np.ones(batch_size)
        return {"observations": self.observations[indices], "actions": self.actions[indices],
                "rewards": self.rewards[indices], "next_observations": self.next_observations[indices],
                "done": self.done[indices], "discounts": self.discounts[indices], "indices": indices,
                "weights": weights.astype(np.float32)}

    def update_priorities(self, indices, priorities) -> None:
        if not self.prioritized:
            return
        priorities = np.maximum(np.abs(np.asarray(priorities, dtype=np.float64)), PRIORITY_FLOOR)
        self.tree.update(np.asarray(indices, dtype=np.int64), priorities ** self.priority_exponent)
        self.maximum_priority = max(self.maximum_priority, float(priorities.max()))


__all__ = ["ReplayBuffer", "SumTree"]
