/**
 * One plain sentence per hyperparameter key, for the info tooltip beside each
 * control in `ConfigForm`. The runner's own `description` (written in the
 * model registry, `packages/config/cycle_models/`) wins; this table is the fallback
 * for a parameter the registry leaves undescribed. Covers every key in the
 * plan's CLI-flag tables (`docs/plans/2026-09-25-model-cycle.md`); a key shared
 * by several models (`layer_count`, `dropout`, `max_depth`, …) means the same
 * thing in each, so it gets one entry here rather than one per model.
 */

export const CYCLE_PARAMETER_HELP: Record<string, string> = {
  // Walk-forward
  train_days: "How many calendar days of bars each fold trains on before it is tested.",
  validation_fraction: "The share of each fold's training window held back to pick the best epoch or early-stopping round, never traded on.",
  test_days: "How many calendar days of bars each fold walks one at a time to trade and score.",
  step_days: "How far the window slides between folds; 0 means it slides by exactly one test window (no gap, no overlap).",
  fold_limit: "How many of the most recent folds to run; 0 runs every fold the data allows.",
  expanding_window: "On, each fold's training window keeps everything since the start; off, it stays a fixed number of days and slides forward.",

  // Labels
  label_horizon_bars: "How many bars ahead the model is trained to predict the direction of — its label is 'did price rise by the time this many bars pass'.",
  label_threshold_ticks: "A move smaller than this many ticks over the label horizon counts as flat and is dropped from training and scoring, rather than forced into up or down.",
  embargo_bars: "Bars removed right after the training window, in addition to the purge, so a label whose horizon reaches into the test window can never leak into training.",
  label_gap_multiple: "The session-gap rule: a bar whose label horizon crosses a gap longer than this many typical bar intervals (a session break, a weekend, an outage) gets no label, no price target and no forecast, because a 6-bar move across a weekend is not a 30-minute move. 0 turns the rule off.",

  // Trading
  long_only: "The model trades every prediction. Off, it is long whenever P(up) is 0.5 or more and short whenever it is below, flipping at the next open when the prediction flips; on, it is flat instead of short.",
  holding_bars: "Long only: how many bars a long stays open after the model turns down before it closes on time (a stop or target can close it sooner); with shorts allowed the position follows every prediction, so this does not apply. 0 uses the label horizon.",
  stop_loss_ticks: "Closes a trade automatically once it has moved this many ticks against it; 0 turns the stop off.",
  take_profit_ticks: "Closes a trade automatically once it has moved this many ticks in its favor; 0 turns the target off.",
  contracts: "How many contracts each trade opens with.",

  // Tuning
  tuning_mode: "How the model's hyperparameters are chosen. 'tuned': Optuna searches every parameter with a search space inside each fold, on that fold's own training window, and the fold is fitted with the best trial. 'reviewed_defaults': the registry's defaults (or the values typed here), no search.",
  tuning_budget_trials: "How many Optuna trials each fold may run. With a time budget as well, whichever runs out first stops the search; 0 leaves it to the time budget alone.",
  tuning_budget_seconds: "A wall-clock budget per fold: the search stops after this many seconds even if trials remain (the trial in progress finishes). 0 means trials only.",
  tuning_objective: "What Optuna scores each trial by: risk-adjusted return after costs (Sharpe ratio, the default), prediction error (log loss), or classification balance (F1 score).",
  tuning_folds: "How many inner walk-forward blocks, carved out of the fold's own training window, each Optuna trial is scored across (the trial's value is their median).",
  tuning_pinned_parameters: "Parameter names, comma separated, held out of the search at the value set here — the way to fix one knob by hand while the rest are searched.",
  tuning_trials: "Legacy: an explicit trial count per fold that overrides the budget; leave 0.",

  // Replay
  bars_per_second: "How fast the test walk plays back once it starts; 0 runs it as fast as the machine can go.",
  start_paused: "On, the run loads and trains normally but pauses right before the first test bar, waiting for Resume.",
  quiet_bars: "On, suppresses the per-bar terminal line during testing and prints only trades, folds and scoreboards — useful for a fast, noisy run.",
  log_every_batches: "How many training batches or boosting rounds pass between terminal progress lines; lower is chattier.",

  // Runtime
  device: "Which processor runs training: 'auto' picks the GPU when one is available, 'cuda' forces the GPU, 'cpu' forces the CPU.",
  seed: "The random seed for data splits, weight initialization and any stochastic training step, so a run can be reproduced exactly.",

  // Model — linear
  regularization_strength: "How hard the model is penalized for large coefficients; higher shrinks them toward zero and resists overfitting at the cost of flexibility.",
  max_iterations: "The most optimizer steps the solver is allowed before it stops, converged or not.",

  // Model — tree ensembles
  tree_count: "How many decision trees the forest builds and averages together.",
  max_depth: "The deepest any single tree is allowed to grow; deeper trees fit more detail and overfit more easily.",
  min_samples_leaf: "The fewest training bars a leaf may end with; larger values force simpler, more generalized splits.",
  max_features_fraction: "The fraction of features each tree is allowed to consider at every split, chosen at random.",
  boosting_rounds: "How many trees are added one after another, each correcting the ones before it.",
  leaf_count: "The most leaves a single tree may grow to (LightGBM grows leaf-by-leaf rather than level-by-level).",
  learning_rate: "How much each training step or boosting round is allowed to move the model; smaller is slower but steadier.",
  subsample: "The fraction of training bars each boosting round is fit on, resampled at random — under 1.0 adds regularizing noise.",
  column_subsample: "The fraction of features each boosting round is allowed to consider, chosen at random.",
  min_child_weight: "The smallest total sample weight a split is allowed to create in a child node; higher resists splits on thin evidence.",
  min_child_samples: "The fewest training bars a leaf may end with (LightGBM's name for the same idea as min_samples_leaf).",
  l2_regularization: "How hard large leaf weights are penalized; higher shrinks predictions toward zero and resists overfitting.",
  early_stopping_rounds: "Boosting stops once this many rounds pass with no improvement on the validation window.",

  // Model — neural networks (shared across MLP / LSTM / TCN / transformer)
  hidden_size: "The width of the network's hidden layers — how many numbers each layer passes to the next.",
  layer_count: "How many hidden layers (or recurrent/transformer blocks) the network stacks.",
  dropout: "The fraction of connections randomly zeroed out during training, forcing the network not to rely on any single path.",
  weight_decay: "How hard large network weights are penalized during training, shrinking them toward zero to resist overfitting.",
  batch_size: "How many training examples are averaged into a single gradient update.",
  epochs: "The most full passes over the training window the network is allowed before it stops.",
  patience: "How many epochs without validation improvement are tolerated before early stopping ends training.",
  sequence_length: "How many trailing bars of history the network reads at once to make one prediction.",
  channel_count: "How many parallel feature detectors each convolutional layer of the temporal convolution network learns.",
  kernel_size: "How many consecutive bars each convolution filter looks at in one step.",
  model_dimension: "The width of the transformer's internal representation — every attention and feed-forward layer works in this many dimensions.",
  head_count: "How many parallel attention heads the transformer uses, each free to focus on a different pattern in the bar sequence.",
};

/** The tooltip sentence for a key: the runner's `description` when it has one, else this file's entry. */
export function parameterHelpFor(key: string, description?: string): string | undefined {
  const own = description?.trim();
  return own ? own : CYCLE_PARAMETER_HELP[key];
}
