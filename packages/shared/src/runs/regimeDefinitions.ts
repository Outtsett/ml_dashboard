/**
 * The three market regimes of the structural regime hidden Markov model — their
 * names, order, fixed colours and glyphs — and how every number on the regime
 * panel is computed, in plain words with the formula, read from the engine
 * source (packages/ml-engine/src/cycle/regime_hmm.py,
 * packages/ml-engine/src/cycle/adapters_extra/regime_montecarlo_decision.py and
 * engine.py) on 2026-10-07. Shown wherever the number is shown (hover, legend).
 * The engine is the one definition; this is its description. Full
 * specification: docs/regime-hmm.md.
 */
import type { MetricDefinition } from "./metricDefinitions";

/** The regimes in the engine's order (`cycle.regime_hmm.REGIME_NAMES`): probabilities, transition rows and columns. */
export const REGIME_NAMES = ["flat", "uptrend", "downtrend"] as const;
export type RegimeName = (typeof REGIME_NAMES)[number];

export interface RegimeStyle {
  /** The word shown beside the colour, always. */
  word: string;
  /** Okabe-Ito; the same colour on every surface. */
  color: string;
  /** Shown with the word, so the regime never reads by colour alone. */
  glyph: string;
  /** One sentence a reader can check against the chart. */
  meaning: string;
}

/** flat = sky, uptrend = orange, downtrend = blue (Okabe-Ito), each with its glyph and word. */
export const REGIME_STYLES: Record<RegimeName, RegimeStyle> = {
  flat: {
    word: "flat",
    color: "#56B4E9",
    glyph: "—",
    meaning: "Ranging: low ADX, small candle bodies, swing highs and lows that neither rise nor fall together.",
  },
  uptrend: {
    word: "uptrend",
    color: "#E69F00",
    glyph: "▲",
    meaning: "Trending up: confirmed swing highs and swing lows are each higher than the one before.",
  },
  downtrend: {
    word: "downtrend",
    color: "#0072B2",
    glyph: "▼",
    meaning: "Trending down: confirmed swing highs and swing lows are each lower than the one before.",
  },
};

/** Runs recorded before 2026-10-07 numbered their regimes by volatility (regime 1 = calmest); they keep these colours. */
const NUMBERED_REGIME_COLORS = ["#0072B2", "#56B4E9", "#E69F00", "#CC79A7", "#D55E00", "#F0E442", "#009E73", "#000000"];

export function isRegimeName(value: unknown): value is RegimeName {
  return typeof value === "string" && (REGIME_NAMES as readonly string[]).includes(value);
}

/**
 * The style of the regime at `position` of a forecast whose regimes are called
 * `names`: the fixed style of a named regime, or a numbered one ("regime 2",
 * glyph "2") for a run recorded before the regimes had names.
 */
export function regimeStyleAt(names: readonly string[] | undefined, position: number): RegimeStyle {
  const name = names?.[position];
  if (isRegimeName(name)) return REGIME_STYLES[name];
  return {
    word: name ?? `regime ${position + 1}`,
    color: NUMBERED_REGIME_COLORS[position % NUMBERED_REGIME_COLORS.length]!,
    glyph: String(position + 1),
    meaning: "A regime of a run recorded before the regimes were named; numbered by mean realised volatility.",
  };
}

/** "▲ uptrend": the glyph and the word, never the colour alone. */
export function regimeLabel(style: RegimeStyle): string {
  return `${style.glyph} ${style.word}`;
}

/**
 * The position (0-based, in `names` order) of a per-bar `mostLikelyRegime`
 * value: a name since 2026-10-07, a 1-based number before; null when unknown.
 */
export function regimePosition(names: readonly string[] | undefined, value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isInteger(value) && value >= 1 ? value - 1 : null;
  const position = (names ?? REGIME_NAMES).indexOf(value);
  return position >= 0 ? position : null;
}

/** The plain words of each observation feature of the regime model (`cycle.regime_hmm.FEATURE_WORDS`), with its unit. */
export const REGIME_FEATURE_WORDS: Record<string, { words: string; unit: string }> = {
  average_directional_index: { words: "Average directional index (ADX 14)", unit: "0 to 100" },
  body_to_range_ratio: { words: "Candle body as a share of its range, mean of 14 bars", unit: "ratio" },
  volatility_compression_ratio: { words: "True range of the last 14 bars over the last 100", unit: "ratio" },
  distance_from_swing_high_scaled: { words: "Close minus the last confirmed swing high", unit: "move scales" },
  distance_from_swing_low_scaled: { words: "Close minus the last confirmed swing low", unit: "move scales" },
  bars_since_last_pivot: { words: "Bars since the last confirmed swing pivot", unit: "bars" },
  higher_high_higher_low_score: { words: "Higher-high / higher-low score (decayed count)", unit: "count" },
  last_two_pivots_sign: { words: "Sign of the last two swing highs and lows", unit: "-1 to +1" },
};

export const REGIME_DEFINITIONS: Record<string, MetricDefinition> = {
  regime_probability: {
    how: `The forward-filtered probability that the bar is in each of the three regimes (flat, uptrend, downtrend), from the structural regime hidden Markov model fitted on the fold's training span only. Each regime's emission is a diagonal Gaussian over eight features standardised by the training span's mean and deviation: ADX 14, the 14-bar mean candle body-to-range ratio, the 14-bar over 100-bar mean true range, the close's distance from the last confirmed swing high and from the last confirmed swing low (over the run's causal move scale), bars since the last confirmed pivot, the decayed higher-high / higher-low score and the sign of the last two pivots. The filter reads only bars up to and including this one (never the smoother, which would read later bars). A bar whose features are not all known (the warmup, a session gap in the move scale) only advances the previous probabilities one step through the transition matrix. (regime_hmm.py StructuralRegimeHMM.forward_filter)`,
    formula: `alpha_t = normalise( (alpha_(t-1) · A) ⊙ b(x_t) ), A = fitted 3 × 3 transition matrix, b_k(x) = Π_j Normal(x_j; μ_kj, σ²_kj)`,
  },
  regime_most_likely: {
    how: `The name of the regime with the highest forward-filtered probability at the bar: flat (— sky), uptrend (▲ orange) or downtrend (▼ blue). The Market chart paints each walked candle in that regime's colour. The names are fixed after the fit by ordering the three states on the mean of the higher-high / higher-low score: the most negative is downtrend, the most positive uptrend, the one between flat. (protocol.py cycle_regime_forecast_payload; regime_hmm.py StructuralRegimeHMM.fit)`,
    formula: `regime_t = argmax_k alpha_t[k], k ∈ {flat, uptrend, downtrend}`,
  },
  regime_features: {
    how: `The eight observation features of the regime model, every one from bars at or before the bar. Flat detector: ADX 14 (Wilder: +DM, −DM and true range in Wilder's running sum, DX = 100 × |DI+ − DI−| / (DI+ + DI−), ADX = Wilder's average of DX; the same numbers as the Market chart's ADX indicator); the mean of |close − open| / (high − low) over the last 14 bars; the mean true range of the last 14 bars over that of the last 100. Swing structure: a swing high is a bar whose high is strictly above the highs of N bars on each side (N = swing_confirmation_bars; the mirror for a swing low; the Market chart's own pivot rule), known only N bars after it forms; the features are (close − last confirmed swing high) / move scale, (close − last confirmed swing low) / move scale and the bars since the newest confirmed pivot. Trend confirmation: a counter that gains 1 at the bar a higher high or a higher low is confirmed, loses 1 for a lower high or a lower low, and is multiplied by 0.5^(1/48) every bar; and (sign of the last swing high's change + sign of the last swing low's change) / 2. (regime_hmm.py structural_features)`,
    formula: `score_t = score_(t-1) · 0.5^(1/48) + Σ_(pivots confirmed at t) (+1 higher, −1 lower); x_t = [ADX_14, mean_14(|c − o| / (h − l)), mean_14(TR) / mean_100(TR), (c − swing_high) / scale, (c − swing_low) / scale, bars since pivot, score_t, pivot sign]`,
  },
  regime_training: {
    how: `Baum-Welch (expectation maximisation, hmmlearn GaussianHMM with diagonal covariances) on the training rows whose eight features are all known. Nothing starts at random: each regime's mean and variance are seeded from a heuristic labelling of those rows (flat where ADX < adx_threshold, else uptrend where the higher-high / higher-low score is above 0, downtrend where it is below 0), the transition matrix starts at 0.95 on the diagonal with a sticky Dirichlet prior of 10 pseudo-transitions on it, and every variance is held at or above 0.1 standardised units after each iteration. It runs up to regime_fit_iteration_count iterations and stops when the log-likelihood gains less than 0.01. (regime_hmm.py StructuralRegimeHMM.fit, heuristic_labels)`,
    formula: `seed_t = flat if ADX_t < threshold, else uptrend if score_t > 0, downtrend if score_t < 0; θ ← argmax_θ E[log p(x, z | θ)] repeated`,
  },
  monte_carlo_fan: {
    how: `At the bar, S paths (S = simulation_count) of h bars (h = label horizon) start from the filtered regime probabilities: the first bar's regime is drawn from alpha_t · A, every later bar's from the transition matrix row of the bar before, and each bar's log return from that regime's Student-t (degrees of freedom, location and scale fitted by maximum likelihood on the training bars the forward filter put in it). The same random numbers are reused at every bar, so two bars' fans differ only because the regime probabilities and the close moved. The band is the 10th to 90th percentile of the simulated move after each step, the line the 50th, in points from this bar's close. (MonteCarloSimulator.simulate)`,
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
    how: `The decision model's P(up): gradient-boosted trees (xgboost, binary logistic) over the three regime probabilities (flat, uptrend, downtrend), the simulation's P(up), its expected move and 10–90 percentile spread (both divided by the run's causal move scale), Kronos' move (divided by the same scale) and direction, and the nine FinBERT news columns. On the training rows the regime and simulation signals are out of fold: the last M training rows (M = maximum_training_bars) are cut into K blocks (K = stacking_fold_count) and each block is scored by a regime model fitted without it and without h bars either side. Boosting stops early on the validation rows. This is the probability the engine scores and trades. (_fit_decision_model)`,
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
    how: `Per regime, on the fold's training span: the mean of each of the eight observation features (the fitted Gaussian's mean, back in the feature's own units), the probability that the next bar stays in the regime (the transition matrix's diagonal), the expected bars per visit (1 / (1 − stay probability), the mean of a geometric run), the training bars the forward filter put in it, and the Student-t of its one-bar log return fitted by scipy.stats.t.fit on those bars (a regime with fewer than 50 bars uses the pooled training returns, marked pooled); deviation = scale × √(ν / (ν − 2)). (regime_hmm.py StructuralRegimeHMM.summaries; fit_regime_model, RegimeModel.summaries)`,
    formula: `mean_kj = μ_kj · deviation_j + mean_j; stay_k = A_kk; bars per visit = 1 / (1 − A_kk); r | regime k ~ μ_k + σ_k · t(ν_k)`,
  },
  transition_matrix: {
    how: `The hidden Markov model's fitted transition matrix in the order flat, uptrend, downtrend: row = this bar's regime, column = the next bar's, each row summing to 1. It starts at 0.95 on the diagonal with a sticky prior and is refined by Baum-Welch. The Monte Carlo simulation draws every bar's regime from it. (regime_hmm.py StructuralRegimeHMM.fit)`,
    formula: `A_jk = P(regime_(t+1) = k | regime_t = j)`,
  },
};

export function regimeDefinition(name: string): MetricDefinition | null {
  return REGIME_DEFINITIONS[name] ?? null;
}
