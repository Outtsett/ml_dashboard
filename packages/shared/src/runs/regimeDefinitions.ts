/**
 * How every number on the regime panel is computed, in plain words with the
 * formula, read from the engine source
 * (packages/ml-engine/src/cycle/adapters_extra/regime_montecarlo_decision.py and
 * engine.py) on 2026-10-07. Shown wherever the number is shown (hover, legend).
 * The engine is the one definition; this is its description.
 */
import type { MetricDefinition } from "./metricDefinitions";

export const REGIME_DEFINITIONS: Record<string, MetricDefinition> = {
  regime_probability: {
    how: `The forward-filtered probability that the bar is in each hidden regime, from a Gaussian hidden Markov model (hmmlearn GaussianHMM, full covariance) fitted on the fold's training span only. Its inputs per bar are the one-bar log return of the close, the realised volatility (root mean square of the last N finite one-bar log returns, N = volatility_window_bars) and a volume z-score (log volume against the mean and deviation of the last N log volumes), standardised by the training span's mean and deviation. The filter reads only bars up to and including this one (never the smoother, which would read later bars). Regimes are numbered by their mean realised volatility, so regime 1 is the calmest. A bar with no inputs (a session gap, the warmup) only advances the previous probabilities one step through the transition matrix. (regime_montecarlo_decision.py RegimeModel.forward_filter, fit_regime_model)`,
    formula: `alpha_t = normalise( (alpha_(t-1) · A) ⊙ b(x_t) ), A = fitted transition matrix, b_k(x) = Gaussian density of regime k`,
  },
  monte_carlo_fan: {
    how: `At the bar, S paths (S = simulation_count) of h bars (h = label horizon) start from the filtered regime probabilities: the first bar's regime is drawn from alpha_t · A, every later bar's from the transition matrix row of the bar before, and each bar's log return from that regime's Student-t (degrees of freedom, location and scale fitted by maximum likelihood on the training bars the model assigned to it). The same random numbers are reused at every bar, so two bars' fans differ only because the regime probabilities and the close moved. The band is the 10th to 90th percentile of the simulated move after each step, the line the 50th, in points from this bar's close. (MonteCarloSimulator.simulate)`,
    formula: `move_(s,j) = close_t · (exp(Σ_(i≤j) r_(s,i)) − 1), r_(s,i) ~ Student-t(ν_k, μ_k, σ_k) with k the regime of path s at step i; band = percentiles 10, 50, 90 over s`,
  },
  monte_carlo_probability_up: {
    how: `The share of the S simulated paths whose close h bars ahead is above this bar's close. (MonteCarloSimulator.simulate)`,
    formula: `P_MC(up) = (1/S) Σ_s [ Σ_(i≤h) r_(s,i) > 0 ]`,
  },
  monte_carlo_expected_move_points: {
    how: `The mean simulated move h bars ahead, in points: this bar's close times the mean over paths of exp(total log return) − 1. It is also the price model's forecast (divided by the run's causal move scale, which the engine multiplies back). (MonteCarloSimulator.simulate, predict_value)`,
    formula: `E[move] = close_t · (1/S) Σ_s (exp(Σ_(i≤h) r_(s,i)) − 1)`,
  },
  kronos_candles: {
    how: `Kronos, the pretrained K-line foundation model (NeoQuasar/Kronos-<size> at a pinned revision), reads the last C candles ending at this bar (C = kronos_context_bars: open, high, low, close, volume and amount = volume × mean price, each normalised by the window's own mean and deviation, clipped at ±5) and decodes the next h candles one by one, greedily (top-k 1, one sample), so the forecast is deterministic. Kronos is not fitted on this run. (KronosForecaster.forecast)`,
    formula: `candles_(t+1..t+h) = KronosDecode(window_(t−C+1..t)), de-normalised by the window's mean and deviation`,
  },
  kronos_predicted_move_points: {
    how: `Kronos' predicted close of the h-th next candle minus this bar's close, in points. Its sign is the Kronos direction the decision model reads. (RegimeMonteCarloDecisionAdapter._signals)`,
    formula: `move_Kronos = close_hat_(t+h) − close_t`,
  },
  decision_probability_up: {
    how: `The decision model's P(up): gradient-boosted trees (xgboost, binary logistic) over the regime probabilities, the simulation's P(up), its expected move and 10–90 percentile spread (both divided by the run's causal move scale), Kronos' move (divided by the same scale) and direction, and the nine FinBERT news columns. On the training rows the regime and simulation signals are out of fold: the last M training rows (M = maximum_training_bars) are cut into K blocks (K = stacking_fold_count) and each block is scored by a regime model fitted without it and without h bars either side. Boosting stops early on the validation rows. This is the probability the engine scores and trades. (_fit_decision_model)`,
    formula: `P(up) = sigmoid( Σ_trees leaf(signals_t) ), signals_t = [alpha_t, P_MC(up), E[move]/scale, spread/scale, move_Kronos/scale, sign(move_Kronos), finbert_*]`,
  },
  trade_gate: {
    how: `The trade gate is open when the decision model's P(up) is at least the threshold away from 0.5. The engine scores every bar's direction, but enters a trade only on a bar whose gate is open; on a closed bar it stands aside (no new entry; a held position runs to its holding period). (trade_gate; engine.py _walk_span; tuning.py simulate_block)`,
    formula: `open_t = |P(up)_t − 0.5| ≥ decision_threshold`,
  },
  feature_weight: {
    how: `The decision model's total gain from every split on the signal, summed over all trees up to the kept round, as a share of the total gain of all signals. A large share means the trees leaned on that signal to separate up from down on the training rows; it says nothing about the sign of the effect. (booster.get_score(importance_type="total_gain"))`,
    formula: `weight_f = Σ_(splits on f) gain / Σ_(all splits) gain`,
  },
  regime_summary: {
    how: `Each regime's Student-t of the one-bar log return, fitted by scipy.stats.t.fit on the training bars the smoothed posterior assigns to the regime (a regime with fewer than 50 bars uses the pooled training returns, marked pooled). Deviation = scale × √(ν / (ν − 2)). Stay probability is the transition matrix's diagonal: the chance the next bar is in the same regime. (fit_regime_model, RegimeModel.summaries)`,
    formula: `r | regime k ~ μ_k + σ_k · t(ν_k); stay_k = A_kk`,
  },
  transition_matrix: {
    how: `The hidden Markov model's fitted transition matrix, renumbered so regime 1 is the calmest: row = this bar's regime, column = the next bar's, each row summing to 1. The Monte Carlo simulation draws every bar's regime from it. (fit_regime_model)`,
    formula: `A_jk = P(regime_(t+1) = k | regime_t = j)`,
  },
};

export function regimeDefinition(name: string): MetricDefinition | null {
  return REGIME_DEFINITIONS[name] ?? null;
}
