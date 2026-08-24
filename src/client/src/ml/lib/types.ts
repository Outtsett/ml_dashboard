export type ModelCategory =
  | 'unsupervised' | 'supervised' | 'self-supervised' | 'semi-supervised'
  | 'generative' | 'hybrid-composite' | 'neural-network' | 'optimization'
  | 'probabilistic-symbolic' | 'reinforcement-learning' | 'simulation-decision' | 'statistical';

export type ModelSubcategory =
  | 'dimensionality-reduction' | 'clustering' | 'anomaly-detection' | 'self-organizing'
  | 'linear' | 'ensemble' | 'boosting' | 'meta-learner' | 'deep-learning'
  | 'classification' | 'regression' | 'sequence'
  // Generative
  | 'adversarial' | 'autoregressive' | 'diffusion-and-score-based' | 'latent-variable-models'
  // Hybrid & Composite
  | 'classical-hybrids' | 'generative-discriminative-hybrids' | 'graph-and-attention-hybrids'
  | 'multi-modal-and-temporal-fusion' | 'neuro-symbolic-systems'
  // Neural Network
  | 'attention-based' | 'convolutional-networks' | 'feedforward-and-mlps'
  | 'generative-and-latent-models' | 'graph-neural-networks'
  | 'memory-and-routing' | 'recurrent-and-sequential' | 'specialized-and-modular'
  // Self-Supervised
  | 'augmentation-based' | 'contrastive-learning' | 'latent-and-generative'
  | 'masked-modeling' | 'predictive-representation'
  // Semi-Supervised
  | 'clustering-based' | 'consistency-based' | 'generative-and-hybrid'
  | 'graph-based' | 'multi-view-and-co-training' | 'regularization-and-theoretical'
  | 'self-training-and-bootstrapping'
  // Reinforcement Learning
  | 'meta-rl-and-hierarchical' | 'model-based-rl' | 'model-free-rl'
  | 'actor-critic' | 'policy-gradient' | 'value-based'
  // Optimization
  | 'classical-optimization' | 'convex-and-non-convex' | 'evolutionary'
  | 'gradient-based' | 'metaheuristic'
  // Probabilistic & Symbolic
  | 'generative-processes' | 'graphical-and-structured' | 'probabilistic-inference'
  | 'probabilistic-programming' | 'symbolic-reasoning'
  // Simulation & Decision
  | 'agent-based' | 'game-theory' | 'tree-and-graph-decision'
  | 'utility-and-value-based' | 'simulation-techniques'
  // Statistical
  | 'bayesian-models' | 'forecasting' | 'generalized-linear' | 'probabilistic-mixture'
  | 'regression-techniques' | 'survival-analysis' | 'time-series'
  // Catch-all
  | 'general'
  | string; // Allow dynamic subcategories from imported specs

export interface MLModelDefinition {
  id: string;
  name: string;
  shortName: string;
  category: ModelCategory;
  subcategory: ModelSubcategory;
  overview: string;
  principles: string[];
  applications: string[];
  keyFeatures: string[];
  hyperparameters: {
    name: string;
    type: 'number' | 'select' | 'boolean';
    default: number | string | boolean;
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
    description: string;
  }[];
}
