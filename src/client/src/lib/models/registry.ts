import { MLModelDefinition, ModelCategory, ModelSubcategory } from './types';
import { unsupervisedModels } from './unsupervised';
import { supervisedModels } from './supervised';
import { generativeModels } from './generative';
import { reinforcementModels } from './reinforcement';
import { neural_networksModels } from './neural_networks';
import { statisticalModels } from './statistical';
import { hybridModels } from './hybrid';
import { optimizationModels } from './optimization';
import { self_supervisedModels } from './self_supervised';
import { semi_supervisedModels } from './semi_supervised';
import { simulationModels } from './simulation';
import { probabilisticModels } from './probabilistic';

export const allModels: MLModelDefinition[] = [
  ...unsupervisedModels,
  ...supervisedModels,
  ...generativeModels,
  ...reinforcementModels,
  ...neural_networksModels,
  ...statisticalModels,
  ...hybridModels,
  ...optimizationModels,
  ...self_supervisedModels,
  ...semi_supervisedModels,
  ...simulationModels,
  ...probabilisticModels,
];

export const getModelsByCategory = (category: ModelCategory) => {
  return allModels.filter(m => m.category === category);
};

export const getModelsBySubcategory = (subcategory: ModelSubcategory) => {
  return allModels.filter(m => m.subcategory === subcategory);
};

export const getModelById = (id: string) => {
  return allModels.find(m => m.id === id);
};

export const modelSubcategoryLabels: Record<string, string> = {
  'dimensionality-reduction': 'Dimensionality Reduction',
  'clustering': 'Clustering',
  'anomaly-detection': 'Anomaly Detection',
  'self-organizing': 'Self-Organizing',
  'linear': 'Linear Models',
  'ensemble': 'Ensemble Methods',
  'boosting': 'Boosting Methods',
  'meta-learner': 'Meta-Learners & Calibration',
  'deep-learning': 'Deep Learning',
  'classification': 'Classification',
  'regression': 'Regression',
  'sequence': 'Sequence Modeling',
  'adversarial': 'Adversarial (GAN)',
  'autoregressive': 'Autoregressive',
  'diffusion-and-score-based': 'Diffusion & Score-Based',
  'latent-variable-models': 'Latent Variable Models',
  'classical-hybrids': 'Classical Hybrids',
  'generative-discriminative-hybrids': 'Generative-Discriminative Hybrids',
  'graph-and-attention-hybrids': 'Graph & Attention Hybrids',
  'multi-modal-and-temporal-fusion': 'Multi-Modal & Temporal Fusion',
  'neuro-symbolic-systems': 'Neuro-Symbolic Systems',
  'attention-based': 'Attention-Based',
  'convolutional-networks': 'Convolutional Networks',
  'feedforward-and-mlps': 'Feedforward & MLPs',
  'generative-and-latent-models': 'Generative & Latent Models',
  'graph-neural-networks': 'Graph Neural Networks',
  'memory-and-routing': 'Memory & Routing',
  'recurrent-and-sequential': 'Recurrent & Sequential',
  'specialized-and-modular': 'Specialized & Modular',
  'augmentation-based': 'Augmentation-Based',
  'contrastive-learning': 'Contrastive Learning',
  'latent-and-generative': 'Latent & Generative',
  'masked-modeling': 'Masked Modeling',
  'predictive-representation': 'Predictive Representation',
  'clustering-based': 'Clustering-Based',
  'consistency-based': 'Consistency-Based',
  'generative-and-hybrid': 'Generative & Hybrid',
  'graph-based': 'Graph-Based',
  'multi-view-and-co-training': 'Multi-View & Co-Training',
  'regularization-and-theoretical': 'Regularization & Theoretical',
  'self-training-and-bootstrapping': 'Self-Training & Bootstrapping',
  'meta-rl-and-hierarchical': 'Meta-RL & Hierarchical',
  'model-based-rl': 'Model-Based RL',
  'model-free-rl': 'Model-Free RL',
  'actor-critic': 'Actor-Critic',
  'policy-gradient': 'Policy Gradient',
  'value-based': 'Value-Based',
  'classical-optimization': 'Classical Optimization',
  'convex-and-non-convex': 'Convex & Non-Convex',
  'evolutionary': 'Evolutionary Strategies',
  'gradient-based': 'Gradient-Based',
  'metaheuristic': 'Metaheuristic',
  'generative-processes': 'Generative Processes',
  'graphical-and-structured': 'Graphical & Structured',
  'probabilistic-inference': 'Probabilistic Inference',
  'probabilistic-programming': 'Probabilistic Programming',
  'symbolic-reasoning': 'Symbolic Reasoning',
  'agent-based': 'Agent-Based',
  'game-theory': 'Game Theory',
  'tree-and-graph-decision': 'Tree & Graph Decision',
  'utility-and-value-based': 'Utility & Value-Based',
  'simulation-techniques': 'Simulation Techniques',
  'bayesian-models': 'Bayesian Models',
  'forecasting': 'Forecasting',
  'generalized-linear': 'Generalized Linear',
  'probabilistic-mixture': 'Probabilistic Mixture',
  'regression-techniques': 'Regression Techniques',
  'survival-analysis': 'Survival Analysis',
  'time-series': 'Time Series',
  'general': 'General',
};

export const modelCategoryLabels: Record<string, string> = {
  'unsupervised': 'Unsupervised',
  'supervised': 'Supervised',
  'self-supervised': 'Self-Supervised',
  'semi-supervised': 'Semi-Supervised',
  'generative': 'Generative Models',
  'hybrid-composite': 'Hybrid & Composite',
  'neural-network': 'Neural Networks',
  'optimization': 'Optimization',
  'probabilistic-symbolic': 'Probabilistic & Symbolic',
  'reinforcement-learning': 'Reinforcement Learning',
  'simulation-decision': 'Simulation & Decision',
  'statistical': 'Statistical Models',
};
