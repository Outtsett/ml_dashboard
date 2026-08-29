/**
 * ML core — the shared vocabulary of learning from data.
 *
 * SRP: Data only. Merged by `../index.ts`.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  {
    id: "supervised-learning",
    term: "supervised learning",
    domain: "ml-core",
    definition:
      "Learning a mapping from inputs to a known target. **Needs labels**, and in finance constructing the label is usually harder than fitting the model.",
    see: ["unsupervised-learning", "label", "regression-task"],
  },
  {
    id: "unsupervised-learning",
    term: "unsupervised learning",
    domain: "ml-core",
    definition:
      "Finding structure with no target — clustering, dimensionality reduction, density estimation.",
    see: ["supervised-learning", "clustering", "pca"],
  },
  {
    id: "self-supervised",
    term: "self-supervised learning",
    domain: "ml-core",
    definition:
      "Manufacturing a target from the data itself — predict a masked span, predict the next step, match two augmented views. **Labels for free.**",
    see: ["contrastive-learning", "supervised-learning", "pretext-task"],
  },
  {
    id: "pretext-task",
    term: "pretext task",
    domain: "ml-core",
    definition:
      "A throwaway objective solved only to force a useful representation, then discarded.",
    see: ["self-supervised", "representation-learning"],
  },
  {
    id: "contrastive-learning",
    term: "contrastive learning",
    aliases: ["simclr", "infonce", "triplet loss"],
    domain: "ml-core",
    definition:
      "Learning by pulling related pairs together in embedding space and pushing unrelated ones apart.",
    why: "Needs a notion of *related* that is not trivially true. On price series, two augmented views of the same window is the usual choice and a debatable one.",
    see: ["self-supervised", "embedding"],
  },
  {
    id: "semi-supervised",
    term: "semi-supervised learning",
    domain: "ml-core",
    definition:
      "Using a small labelled set alongside a large unlabelled one, so the unlabelled data shapes the representation.",
    see: ["supervised-learning", "self-supervised"],
  },
  {
    id: "reinforcement-learning",
    term: "reinforcement learning",
    expansion: "RL",
    domain: "ml-core",
    definition:
      "Learning a policy by acting and receiving reward, rather than from labelled examples. **The actions change the data you see next.**",
    why: "Attractive for execution and sizing, and brutal on financial data: the environment is non-stationary and you cannot re-run history with different actions.",
    see: ["policy", "reward-function", "q-learning", "markov-decision-process"],
  },
  {
    id: "markov-decision-process",
    term: "MDP",
    expansion: "Markov Decision Process",
    domain: "ml-core",
    definition:
      "States, actions, transitions and rewards, with the future depending only on the current state. **The formal frame every RL algorithm assumes.**",
    why: "Markets are only partially observed, which strictly makes them POMDPs — and the difference is exactly the hidden state you wish you knew.",
    see: ["reinforcement-learning", "markov-chain", "policy"],
  },
  {
    id: "policy",
    term: "policy",
    symbol: "π(a|s)",
    domain: "ml-core",
    definition:
      "The rule mapping a state to an action. **On-policy** methods learn about the policy they follow; **off-policy** methods learn about a different one.",
    see: ["reinforcement-learning", "q-learning", "actor-critic"],
  },
  {
    id: "reward-function",
    term: "reward function",
    domain: "ml-core",
    definition:
      "What the agent is told to maximise. **The single most consequential design choice in RL** — the agent optimises exactly what you wrote, not what you meant.",
    why: "Reward raw PnL and you get a maximally leveraged agent. Reward risk-adjusted PnL and you have to define risk.",
    see: ["reinforcement-learning", "policy", "reward-hacking"],
  },
  {
    id: "reward-hacking",
    term: "reward hacking",
    domain: "ml-core",
    definition:
      "The agent finding a way to score highly that satisfies the letter of the reward and defeats its purpose.",
    see: ["reward-function"],
  },
  {
    id: "q-learning",
    term: "Q-learning",
    aliases: ["dqn", "double dqn", "dueling dqn"],
    domain: "ml-core",
    definition:
      "Learning the value of taking an action in a state, then acting greedily on it. **DQN** does this with a neural network.",
    see: ["reinforcement-learning", "policy", "bellman-equation"],
  },
  {
    id: "bellman-equation",
    term: "Bellman equation",
    domain: "ml-core",
    definition:
      "Value now equals immediate reward plus discounted value next. **The recursion underneath every value-based RL method.**",
    see: ["q-learning", "reinforcement-learning"],
  },
  {
    id: "actor-critic",
    term: "actor–critic",
    aliases: ["ppo", "a2c", "sac", "ddpg", "td3"],
    domain: "ml-core",
    definition:
      "Two components: an **actor** choosing actions and a **critic** scoring them. **PPO** and **SAC** are the workhorses.",
    see: ["policy", "reinforcement-learning"],
  },
  {
    id: "exploration-exploitation",
    term: "exploration vs exploitation",
    domain: "ml-core",
    definition:
      "Trying something new to learn, versus taking the best known option to earn. **Every sequential decision problem is this trade-off.**",
    see: ["reinforcement-learning", "multi-armed-bandit"],
  },
  {
    id: "multi-armed-bandit",
    term: "multi-armed bandit",
    aliases: ["thompson sampling", "ucb", "epsilon greedy"],
    domain: "ml-core",
    definition:
      "The simplest exploration problem: repeated choices among options with unknown payoffs and no state.",
    see: ["exploration-exploitation", "reinforcement-learning"],
  },

  // ── Representation ─────────────────────────────────────────────────────
  {
    id: "representation-learning",
    term: "representation learning",
    domain: "ml-core",
    definition:
      "Learning a transformation of raw inputs that makes the downstream task easy. **Often the whole value of deep learning.**",
    see: ["embedding", "latent-space", "pretext-task"],
  },
  {
    id: "embedding",
    term: "embedding",
    domain: "ml-core",
    definition:
      "A dense vector standing in for a discrete thing, positioned so that geometric closeness means semantic closeness.",
    why: "For a symbol that is already a point in a space — a candle shape, say — initialise from its coordinates rather than at random. Do not make the model rediscover geometry you can hand it.",
    see: ["latent-space", "representation-learning", "one-hot"],
  },
  {
    id: "one-hot",
    term: "one-hot encoding",
    domain: "ml-core",
    definition:
      "A category as a vector of zeros with a single one. **Discards every relationship between categories** — which is right for arbitrary labels and wrong for ordered or geometric ones.",
    see: ["embedding", "categorical-feature"],
  },
  {
    id: "latent-space",
    term: "latent space",
    domain: "ml-core",
    definition:
      "The compressed internal space a model maps inputs into, where the axes are learned rather than given.",
    see: ["embedding", "autoencoder", "dimensionality-reduction"],
  },
  {
    id: "dimensionality-reduction",
    term: "dimensionality reduction",
    domain: "ml-core",
    aliases: ["umap", "t-sne", "manifold learning"],
    definition:
      "Projecting many dimensions into few while preserving something worth keeping.",
    why: "**t-SNE and UMAP preserve neighbourhoods, not distances or density.** Cluster sizes and inter-cluster gaps in those plots mean nothing.",
    see: ["pca", "latent-space", "curse-of-dimensionality"],
  },
  {
    id: "pca",
    term: "PCA",
    expansion: "Principal Component Analysis",
    domain: "ml-core",
    aliases: ["svd", "eigenvector"],
    definition:
      "Rotating to axes of maximum variance, so the first few components carry most of the spread. **Linear, and orthogonal by construction.**",
    why: "Maximum variance is not maximum usefulness — the component you need can be the fifth.",
    see: ["dimensionality-reduction", "whitening", "factor-model"],
  },
  {
    id: "whitening",
    term: "whitening",
    domain: "ml-core",
    definition:
      "Transforming features to zero mean, unit variance and zero correlation. Removes scale and redundancy in one step.",
    see: ["pca", "z-score", "multicollinearity"],
  },
  {
    id: "clustering",
    term: "clustering",
    aliases: ["k-means", "dbscan", "hierarchical", "gmm"],
    domain: "ml-core",
    definition:
      "Grouping similar observations with no labels. **K-means** assumes round equal-sized clusters; **DBSCAN** finds arbitrary shapes and marks outliers; **GMM** gives soft memberships.",
    why: "Distortion falls monotonically with k, so it cannot choose k. Some external criterion has to.",
    see: ["silhouette", "unsupervised-learning", "codebook"],
  },
  {
    id: "silhouette",
    term: "silhouette score",
    domain: "ml-core",
    definition:
      "How much closer a point sits to its own cluster than to the nearest other one, in [−1, 1].",
    see: ["clustering"],
  },
  {
    id: "codebook",
    term: "codebook / vector quantisation",
    aliases: ["vq", "kmeans codebook", "discretisation"],
    domain: "ml-core",
    definition:
      "A fixed set of representative vectors; each input is replaced by its nearest one. **Turns a continuous space into an alphabet.**",
    why: "A codebook is a fitted object. Fit it on the development slice only, or the vocabulary has seen the test set.",
    see: ["clustering", "embedding", "quantisation-error"],
  },
  {
    id: "quantisation-error",
    term: "quantisation error",
    domain: "ml-core",
    definition:
      "The distance from an input to the codebook entry standing in for it — the information discretising threw away.",
    see: ["codebook"],
  },
  {
    id: "curse-of-dimensionality",
    term: "curse of dimensionality",
    domain: "ml-core",
    definition:
      "In high dimensions everything is far from everything else and distances stop discriminating. **Volume grows faster than any sample can fill it.**",
    see: ["dimensionality-reduction", "feature-selection", "overfitting"],
  },
  {
    id: "no-free-lunch",
    term: "no free lunch theorem",
    domain: "ml-core",
    definition:
      "Averaged over all possible problems, no algorithm beats any other. **Performance comes from assumptions matching the problem**, never from the algorithm alone.",
    see: ["inductive-bias", "bias-variance"],
  },
  {
    id: "inductive-bias",
    term: "inductive bias",
    domain: "ml-core",
    definition:
      "The assumptions a model makes to generalise beyond its training data — convolution assumes locality, a tree assumes axis-aligned splits.",
    why: "Choosing an architecture IS choosing an inductive bias. The right question is whether it matches the data.",
    see: ["no-free-lunch", "bias-variance"],
  },
  {
    id: "ensemble",
    term: "ensemble",
    aliases: ["bagging", "stacking", "blending", "voting"],
    domain: "ml-core",
    definition:
      "Combining several models. **Bagging** averages independently-trained ones to cut variance; **boosting** trains them in sequence on each other's errors; **stacking** learns how to combine.",
    see: ["random-forest", "boosting", "bias-variance"],
  },
  {
    id: "inference",
    term: "inference / serving",
    domain: "ml-core",
    definition:
      "Running a trained model on new data. **The path that has to be fast, and the path where training/serving skew hides.**",
    see: ["training-serving-skew", "checkpoint"],
  },
  {
    id: "training-serving-skew",
    term: "training/serving skew",
    domain: "ml-core",
    definition:
      "Features computed one way in training and another way live, so the model sees a distribution it never learned on.",
    why: "The most common cause of a model that backtests well and fails in production. Share the feature code between both paths.",
    see: ["inference", "leakage", "drift-detection"],
  },
];
