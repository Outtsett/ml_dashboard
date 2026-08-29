/**
 * Training — fitting a model, and the knobs that decide whether it generalises.
 *
 * SRP: Data only. Merged by `../index.ts`.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  // ── The loop ───────────────────────────────────────────────────────────
  {
    id: "epoch",
    term: "epoch",
    domain: "ml-training",
    definition: "One complete pass over the training set.",
    see: ["batch-size", "iteration", "early-stopping"],
  },
  {
    id: "batch-size",
    term: "batch size",
    domain: "ml-training",
    definition:
      "How many examples contribute to one gradient update. **Large batches give a cleaner gradient and generalise slightly worse**; small ones add noise that acts as regularisation.",
    see: ["epoch", "gradient-descent", "learning-rate"],
  },
  {
    id: "iteration",
    term: "iteration / step",
    domain: "ml-training",
    definition:
      "A single gradient update — one batch processed. The atomic unit of a training log.",
    see: ["epoch", "batch-size"],
  },
  {
    id: "learning-rate",
    term: "learning rate",
    symbol: "η, lr",
    domain: "ml-training",
    definition:
      "How far to move along the gradient each step. **The single most important hyperparameter** — too high diverges, too low never arrives.",
    see: ["lr-schedule", "warmup", "gradient-descent"],
  },
  {
    id: "lr-schedule",
    term: "learning-rate schedule",
    domain: "ml-training",
    aliases: ["cosine annealing", "step decay", "one cycle"],
    definition:
      "A rule lowering the learning rate over training — cosine, step, exponential — so the model takes large steps early and settles precisely late.",
    see: ["learning-rate", "warmup"],
  },
  {
    id: "warmup",
    term: "warmup",
    domain: "ml-training",
    definition:
      "Starting at a tiny learning rate and ramping up over the first steps, so early noisy gradients cannot wreck the initialisation.",
    see: ["lr-schedule", "learning-rate"],
  },
  {
    id: "gradient-descent",
    term: "gradient descent",
    aliases: ["sgd", "stochastic gradient descent"],
    domain: "ml-training",
    definition:
      "Repeatedly step downhill on the loss surface. **Stochastic** because each step uses a random batch rather than the whole dataset.",
    see: ["learning-rate", "optimizer", "backpropagation"],
  },
  {
    id: "backpropagation",
    term: "backpropagation",
    domain: "ml-training",
    definition:
      "The chain rule applied efficiently across a network to get every parameter's gradient in one backward pass.",
    see: ["gradient-descent", "vanishing-gradient"],
  },
  {
    id: "optimizer",
    term: "optimizer",
    aliases: ["adam", "adamw", "rmsprop", "momentum"],
    domain: "ml-training",
    definition:
      "The rule turning gradients into parameter updates. **Adam** adapts a per-parameter step size and is the default; **AdamW** fixes how it interacts with weight decay.",
    see: ["gradient-descent", "learning-rate", "weight-decay"],
  },
  {
    id: "loss-function",
    term: "loss function",
    aliases: ["objective", "criterion"],
    domain: "ml-training",
    definition:
      "The number being minimised. **Defines what the model considers a mistake** — change it and you have changed the task, not just the tuning.",
    see: ["log-loss", "rmse", "huber-loss", "quantile-loss"],
  },
  {
    id: "huber-loss",
    term: "Huber loss",
    domain: "ml-training",
    definition:
      "Squared error near zero, absolute error in the tails. **Cares about outliers without being dominated by them.**",
    see: ["loss-function", "rmse", "outlier"],
  },
  {
    id: "quantile-loss",
    term: "quantile / pinball loss",
    domain: "ml-training",
    definition:
      "Asymmetric loss that penalises over- and under-prediction differently, so a model fits a chosen quantile rather than the mean.",
    why: "How you get a predictive INTERVAL out of a point-forecast model.",
    see: ["loss-function", "conformal-prediction"],
  },
  {
    id: "early-stopping",
    term: "early stopping",
    domain: "ml-training",
    definition:
      "Halting when validation loss stops improving, keeping the best checkpoint. **Regularisation by not training long enough to memorise.**",
    why: "The validation set used for stopping is no longer clean for reporting — it has been optimised against.",
    see: ["patience", "overfitting", "validation-set"],
  },
  {
    id: "patience",
    term: "patience",
    domain: "ml-training",
    definition:
      "How many epochs without improvement to tolerate before early stopping fires. Too small stops on noise; too large wastes the point.",
    see: ["early-stopping"],
  },
  {
    id: "convergence",
    term: "convergence",
    domain: "ml-training",
    definition:
      "Training reaching a point where further steps stop changing the loss meaningfully. **A run stopped by an iteration cap has not converged**, whatever its final number says.",
    see: ["early-stopping", "learning-rate"],
  },

  // ── Generalisation ─────────────────────────────────────────────────────
  {
    id: "overfitting",
    term: "overfitting",
    domain: "ml-training",
    definition:
      "Learning the training set's noise as though it were signal. Training loss keeps falling while validation loss turns up.",
    see: ["underfitting", "regularization", "bias-variance"],
  },
  {
    id: "underfitting",
    term: "underfitting",
    domain: "ml-training",
    definition:
      "The model is too simple, or too constrained, to represent the pattern that is there. Both losses stay high.",
    see: ["overfitting", "bias-variance"],
  },
  {
    id: "bias-variance",
    term: "bias–variance tradeoff",
    domain: "ml-training",
    definition:
      "**Bias** is error from wrong assumptions; **variance** is error from sensitivity to the particular training sample. Reducing one usually raises the other.",
    why: "In finance the signal-to-noise ratio is so low that the variance term dominates, which is why simple models routinely win.",
    see: ["overfitting", "underfitting", "regularization"],
  },
  {
    id: "regularization",
    term: "regularization",
    aliases: ["l1", "l2", "ridge", "lasso", "elastic net"],
    domain: "ml-training",
    definition:
      "Any penalty discouraging complexity. **L2/ridge** shrinks weights toward zero; **L1/lasso** drives some exactly to zero and so selects features.",
    see: ["weight-decay", "dropout", "overfitting"],
  },
  {
    id: "weight-decay",
    term: "weight decay",
    domain: "ml-training",
    definition:
      "Shrinking every weight slightly each step. Equivalent to L2 for plain SGD, and **not** equivalent for Adam — which is what AdamW exists to fix.",
    see: ["regularization", "optimizer"],
  },
  {
    id: "dropout",
    term: "dropout",
    domain: "ml-training",
    definition:
      "Randomly zeroing a fraction of activations during training, so the network cannot rely on any single path.",
    why: "Acts like averaging over many thinned networks. Disabled at inference, with activations rescaled.",
    see: ["regularization", "ensemble"],
  },
  {
    id: "batch-norm",
    term: "batch / layer normalisation",
    domain: "ml-training",
    definition:
      "Renormalising activations inside the network to keep their scale stable. **Batch norm** uses batch statistics, **layer norm** per-example statistics — which is why sequence models use layer norm.",
    see: ["vanishing-gradient", "residual-connection"],
  },
  {
    id: "vanishing-gradient",
    term: "vanishing / exploding gradient",
    domain: "ml-training",
    definition:
      "Gradients shrinking toward zero or blowing up as they propagate back through many layers, so early layers stop learning or the run diverges.",
    see: ["gradient-clipping", "residual-connection", "batch-norm"],
  },
  {
    id: "gradient-clipping",
    term: "gradient clipping",
    domain: "ml-training",
    definition:
      "Capping the gradient norm before the update, so one pathological batch cannot destroy the weights.",
    see: ["vanishing-gradient", "optimizer"],
  },
  {
    id: "class-imbalance",
    term: "class imbalance",
    domain: "ml-training",
    aliases: ["smote", "class weight", "oversampling"],
    definition:
      "One class far rarer than another, so a model minimising average loss learns to ignore it.",
    why: "Fix with class weights or focal loss rather than resampling where possible — resampling distorts the base rate the calibration depends on.",
    see: ["base-rate", "balanced-accuracy", "calibration"],
  },
  {
    id: "sample-weight",
    term: "sample weight",
    domain: "ml-training",
    definition:
      "A per-observation multiplier on the loss, so some examples count more. Used for class balance, for label confidence, and for **overlap uniqueness**.",
    see: ["sample-uniqueness", "class-imbalance"],
  },

  // ── Validation ─────────────────────────────────────────────────────────
  {
    id: "train-val-test",
    term: "train / validation / test",
    domain: "ml-training",
    definition:
      "**Train** fits parameters, **validation** chooses hyperparameters and stopping, **test** is touched once for the reported number. Three sets, three jobs.",
    why: "Using validation as test is the most common way a reported result is optimistic — it has been selected against.",
    see: ["validation-set", "walk-forward", "leakage"],
  },
  {
    id: "validation-set",
    term: "validation set",
    domain: "ml-training",
    definition:
      "Held-out data used to make choices during development. **Burned once it has been optimised against**, however lightly.",
    see: ["train-val-test", "early-stopping"],
  },
  {
    id: "cross-validation",
    term: "cross-validation",
    expansion: "CV",
    domain: "ml-training",
    aliases: ["k-fold"],
    definition:
      "Rotating which slice is held out, so every observation is scored once. **Standard k-fold is invalid on time series** — it trains on the future to predict the past.",
    see: ["walk-forward", "purging", "cpcv"],
  },
  {
    id: "walk-forward",
    term: "walk-forward validation",
    domain: "ml-training",
    aliases: ["rolling origin", "anchored", "expanding window"],
    definition:
      "Train on the past, test on the immediate future, roll forward, repeat — never training on data later than the test window.",
    why: "**Anchored/expanding** keeps all history; **rolling** drops the oldest so the model tracks regime change. Different assumptions, different answers.",
    see: ["purging", "embargo", "cross-validation"],
  },
  {
    id: "purging",
    term: "purging",
    domain: "ml-training",
    definition:
      "Dropping training observations whose LABEL horizon overlaps the validation window, so no training label was resolved by data the model is about to be tested on.",
    see: ["embargo", "walk-forward", "leakage"],
  },
  {
    id: "embargo",
    term: "embargo",
    domain: "ml-training",
    definition:
      "An additional gap after the validation window before training resumes, absorbing serial correlation that purging alone misses.",
    why: "Must be at least the longest trailing window any feature uses, or a validation row reads training bars through its own features.",
    see: ["purging", "walk-forward"],
  },
  {
    id: "cpcv",
    term: "CPCV",
    expansion: "Combinatorial Purged Cross-Validation",
    domain: "ml-training",
    definition:
      "Test on many different COMBINATIONS of held-out blocks rather than one path, producing a distribution of backtest outcomes instead of a single number.",
    see: ["purging", "pbo", "walk-forward"],
  },

  // ── Search ─────────────────────────────────────────────────────────────
  {
    id: "hyperparameter",
    term: "hyperparameter",
    domain: "ml-training",
    definition:
      "A setting chosen before training rather than learned from data — depth, learning rate, regularisation strength.",
    see: ["hpo", "grid-search", "learning-rate"],
  },
  {
    id: "hpo",
    term: "HPO",
    expansion: "Hyperparameter Optimisation",
    domain: "ml-training",
    aliases: ["optuna", "hyperparameter tuning"],
    definition:
      "Searching hyperparameter space for the best configuration. **Every trial is another test**, so the multiple-testing burden grows with the search.",
    see: ["hyperparameter", "tpe", "multiple-testing", "deflated-sharpe"],
  },
  {
    id: "grid-search",
    term: "grid / random search",
    domain: "ml-training",
    definition:
      "Exhaustive over a lattice, or sampled at random. **Random beats grid** in high dimensions because most hyperparameters do not matter and grid wastes trials on them.",
    see: ["hpo", "tpe"],
  },
  {
    id: "tpe",
    term: "TPE",
    expansion: "Tree-structured Parzen Estimator",
    domain: "ml-training",
    aliases: ["bayesian optimization", "gaussian process"],
    definition:
      "Bayesian search that models where good trials came from and samples where improvement is likely, instead of sampling blindly.",
    see: ["hpo", "grid-search", "pruning"],
  },
  {
    id: "pruning",
    term: "trial pruning",
    aliases: ["median pruner", "successive halving", "hyperband"],
    domain: "ml-training",
    definition:
      "Killing unpromising trials early to spend the budget on the survivors.",
    why: "Assumes early performance predicts final performance. Sometimes false, and then pruning removes the eventual winner.",
    see: ["hpo", "tpe"],
  },
  {
    id: "seed",
    term: "random seed",
    domain: "ml-training",
    definition:
      "The initial state of the random number generator. **Fixing it makes a run reproducible; reporting only the best seed makes a result fiction.**",
    see: ["reproducibility", "ensemble"],
  },
  {
    id: "reproducibility",
    term: "reproducibility",
    domain: "ml-training",
    definition:
      "The same code, data and seed producing the same number. Requires pinning the data version and the library versions, not just the seed.",
    see: ["seed", "experiment-tracking"],
  },
  {
    id: "experiment-tracking",
    term: "experiment tracking",
    aliases: ["wandb", "mlflow", "tensorboard"],
    definition:
      "Recording every run's config, metrics and artifacts so results can be compared and reproduced later.",
    domain: "ml-training",
    why: "An untracked run cannot be defended. Its number may be right and there is no way to show it.",
    see: ["reproducibility", "checkpoint"],
  },
  {
    id: "checkpoint",
    term: "checkpoint",
    domain: "ml-training",
    definition:
      "A saved snapshot of model weights plus enough state to resume or to evaluate later.",
    why: "Save the optimizer state too, or a resumed run is not the run you stopped.",
    see: ["experiment-tracking", "early-stopping"],
  },
  {
    id: "transfer-learning",
    term: "transfer learning",
    aliases: ["fine-tuning", "pretraining"],
    domain: "ml-training",
    definition:
      "Starting from weights learned on a related task, then adapting. **Buys most of its value when the target dataset is small.**",
    see: ["meta-learning", "checkpoint"],
  },
  {
    id: "meta-learning",
    term: "meta-learning",
    aliases: ["maml", "learning to learn", "reptile"],
    domain: "ml-training",
    definition:
      "Training so the model adapts quickly to a NEW task from few examples, rather than solving one task well.",
    why: "Needs many related tasks. One instrument with a marginal edge will overfit it.",
    see: ["transfer-learning", "few-shot"],
  },
  {
    id: "few-shot",
    term: "few-shot / zero-shot",
    domain: "ml-training",
    definition:
      "Performing a task from a handful of examples, or none, relying on what was learned during pretraining.",
    see: ["meta-learning", "transfer-learning"],
  },
  {
    id: "curriculum-learning",
    term: "curriculum learning",
    domain: "ml-training",
    definition:
      "Presenting easy examples first and hard ones later, so the model builds a usable representation before facing the difficult cases.",
    see: ["transfer-learning"],
  },
  {
    id: "data-augmentation",
    term: "data augmentation",
    domain: "ml-training",
    definition:
      "Expanding the training set with label-preserving transformations of what you have.",
    why: "Hard in finance: almost any transformation of a price series changes its statistical properties, so the augmented data is a different market.",
    see: ["synthetic-data", "regularization"],
  },
  {
    id: "synthetic-data",
    term: "synthetic data",
    domain: "ml-training",
    definition:
      "Generated rather than observed data — from a fitted process, a bootstrap, or a generative model.",
    why: "A model trained on synthetic paths learns the generator's assumptions. Useful for stress testing, dangerous for alpha.",
    see: ["data-augmentation", "monte-carlo", "gan"],
  },
];
