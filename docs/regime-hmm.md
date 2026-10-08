# The structural regime hidden Markov model

A hidden Markov model that puts every bar in exactly one of three market regimes — **flat**, **uptrend**,
**downtrend** — from a flat-market detector, confirmed swing highs and lows, and higher-high / higher-low
structure. It is the regime model inside the Cycle model `regime_montecarlo_decision` (`docs/runs.md`).

- Code: `packages/ml-engine/src/cycle/regime_hmm.py` (`StructuralRegimeHMM`, `structural_features`).
- Used by: `packages/ml-engine/src/cycle/adapters_extra/regime_montecarlo_decision.py` (`fit_regime_model`, `RegimeModel`).
- Tests: `packages/ml-engine/tests/test_cycle_regime_hmm.py`.
- On screen: the run page's regime panel (`apps/web/src/runs/analytics/RegimePanel.tsx`) and the walked candles of
  the Market chart (`apps/web/src/cycle/chartBands.ts`).

Think of it as a trader who keeps three notes on the chart — "is the market going anywhere?", "where were the
last swing high and swing low?", "are the swings stepping up or down?" — and, bar by bar, updates how much they
believe the market is ranging, trending up or trending down, using only what has printed so far.

## 1. States

| Position | Name | Colour (Okabe-Ito) | Glyph | What it means |
|---|---|---|---|---|
| 1 | `flat` | sky `#56B4E9` | — | Ranging: low ADX, small bodies, swings that neither rise nor fall together. |
| 2 | `uptrend` | orange `#E69F00` | ▲ | Confirmed swing highs and swing lows are each higher than the one before. |
| 3 | `downtrend` | blue `#0072B2` | ▼ | Confirmed swing highs and swing lows are each lower than the one before. |

There are always exactly three (`REGIME_NAMES`); `regime_count` is not a parameter. Colour, glyph and word live
in one table, `packages/shared/src/runs/regimeDefinitions.ts` (`REGIME_STYLES`), and are shown together everywhere.

**Naming after the fit.** A hidden Markov model's states come out in no particular order. After Baum-Welch the
three states are ordered by the mean of the signed trend feature (`higher_high_higher_low_score`): the most
negative mean is `downtrend`, the most positive `uptrend`, the one between is `flat`.

## 2. Observation features

Eight numbers per bar (`FEATURE_NAMES`, in this order). Every one reads bars at or before the bar it describes,
and is NaN (never 0) while its window is still filling. `o, h, l, c` are the bar's open, high, low, close;
`scale` is the run's causal move scale (a trailing statistic of the closes, `cycle.labels.move_scale`).

### Flat-market detector

| Feature | Formula | Why it is causal |
|---|---|---|
| `average_directional_index` | Wilder's ADX over 14 bars. `up = h_t − h_(t−1)`, `down = l_(t−1) − l_t`; `+DM = up` if `up > down` and `up > 0` else 0; `−DM = down` if `down > up` and `down > 0` else 0; `TR = max(h − l, |h − c_(t−1)|, |l − c_(t−1)|)`. Each is summed over the first 14 bars, then `S_t = S_(t−1) − S_(t−1)/14 + x_t`. `DI± = 100 · S(±DM) / S(TR)`, `DX = 100 · |DI+ − DI−| / (DI+ + DI−)`, `ADX_27 = mean(DX_14..27)`, then `ADX_t = (13 · ADX_(t−1) + DX_t) / 14`. First value at bar 27. | A recursion from the first bar forward. The same numbers as the Market chart's ADX indicator (`calcDirectionalMovement`), parity-tested. |
| `body_to_range_ratio` | Mean over the last 14 bars of `|c − o| / (h − l)` (0 for a bar with no range). | A trailing window with `min_periods == window`. |
| `volatility_compression_ratio` | Mean true range of the last 14 bars ÷ mean true range of the last 100 bars. Below 1 = the range is compressing. | Two trailing windows; NaN for the first 100 bars. |

### Swing structure

A **swing high** is a bar whose high is strictly above the highs of the `N` bars on each side; a **swing low** is
the mirror (`N` = `swing_confirmation_bars`, default 5). This is the dashboard's own pivot rule
(`shared.zones.structural_pivots`, the Market chart's support / resistance pivots) — one definition. A pivot at
bar `j` needs bars `j+1 … j+N` to exist, so it is **known only at bar `j + N`**, and enters the features at that
bar, never sooner.

| Feature | Formula | Why it is causal |
|---|---|---|
| `distance_from_swing_high_scaled` | `(c_t − last confirmed swing high) / scale_t` | Uses pivots with `j + N ≤ t` only. |
| `distance_from_swing_low_scaled` | `(c_t − last confirmed swing low) / scale_t` | Same. |
| `bars_since_last_pivot` | `t − j` of the newest confirmed pivot (high or low); at least `N`. | Same. |

### Trend confirmation

| Feature | Formula | Why it is causal |
|---|---|---|
| `higher_high_higher_low_score` | `score_t = score_(t−1) · 0.5^(1/48) + events_t`. At the bar a swing high is confirmed: `+1` if it is above the previous swing high (higher high), `−1` if below (lower high). At the bar a swing low is confirmed: `+1` if above the previous swing low (higher low), `−1` if below (lower low). Half-life 48 bars. | Events arrive at confirmation bars; the decay is a recursion. |
| `last_two_pivots_sign` | `(sign(last swing high − the one before) + sign(last swing low − the one before)) / 2`: `+1` = higher high and higher low, `−1` = lower high and lower low, `0` = mixed. | Confirmed pivots only. |

The features are standardised with the mean and deviation of the **training rows only**.

## 3. Parameterisation

- **Initial distribution** `π` (3): the heuristic seed labels' shares on the training rows (each at least 0.05).
- **Transition matrix** `A` (3 × 3, `A[from][to]`, rows sum to 1). Initialised at 0.95 on the diagonal and 0.025
  elsewhere, with a **sticky prior**: a Dirichlet prior that adds 10 pseudo-transitions to every diagonal entry.
- **Emissions** `b_k(x) = Π_j Normal(x_j; μ_kj, σ²_kj)`: one diagonal Gaussian per state over the eight
  standardised features (hmmlearn `covariance_type="diag"`), 16 numbers per state.

Parameters of the model (registry `packages/config/cycle_models/regime_montecarlo_decision.json`):

| Parameter | Default | Search | Meaning |
|---|---|---|---|
| `adx_threshold` | 20 | 15–30 | Training bars with ADX below it seed the flat regime. |
| `swing_confirmation_bars` | 5 | 3–10 | `N`: bars on each side of a pivot, and the delay before it is known. |
| `regime_fit_iteration_count` | 100 | — | Most Baum-Welch iterations. |

Constants (`regime_hmm.py`): ADX period 14, body window 14, true-range windows 14 and 100, structure half-life 48
bars, sticky diagonal 0.95, sticky pseudo-count 10, variance floor 0.1, seed anchor share 1.0, tolerance 0.01.

## 4. Training: seeded Baum-Welch

On the training rows whose eight features are all known, as their contiguous runs (a run breaks where a feature
is unknown):

1. **Seed labels** (supervised heuristic, `heuristic_labels`): `flat` where `ADX < adx_threshold`; otherwise
   `uptrend` where the higher-high / higher-low score is above 0, `downtrend` where it is below 0 (`flat` at
   exactly 0).
2. **Seed parameters**: each state's mean and variance are the mean and variance of the standardised features
   of its seed rows (a state with fewer than 20 seed rows starts at the training mean pushed one deviation along
   the score). Nothing is random (`init_params=""`).
3. **Baum-Welch** (expectation maximisation, `hmmlearn.hmm.GaussianHMM`, `params="stmc"`), one iteration per
   call so two guards hold after every M-step:
   - a **variance floor** of 0.1 standardised units — without it a state collapses onto a single value of the
     discrete pivot-sign feature (measured on a planted market with a drift of 1 point a bar: 73% of bars named
     right without the floor, 82% with it);
   - a **seed anchor**: each state's mean carries a Gaussian prior at its seed mean worth as many
     pseudo-observations as there are training rows, `μ_k ← (N · seed_k + Σ_t γ_tk x_t) / (N + Σ_t γ_tk)` —
     without it Baum-Welch on real MNQ bars re-purposes the states as volatility regimes (measured 2026-10-07: a
     state named downtrend had a mean score of −0.06; with the anchor −1.89).
   It stops when the log-likelihood gains less than 0.01 or after `regime_fit_iteration_count` iterations.
4. **Order the states** by the mean of the score: downtrend, flat, uptrend → stored as flat, uptrend, downtrend.

Inside the stack the model is fitted on the fold's training span only, and once more per out-of-fold block
(without that block and the label horizon either side of it).

## 5. Inference: the forward filter, bar by bar

Real-time labelling uses the **forward filter only**, never the smoother (the smoother reads later bars):

```
alpha_t = normalise( (alpha_(t−1) · A) ⊙ b(x_t) )        alpha at the first known bar = normalise(π ⊙ b(x))
regime_t = argmax_k alpha_t[k]  →  "flat" | "uptrend" | "downtrend"
```

A bar whose features are not all known (the warmup, a session gap in the move scale) only advances
`alpha_(t−1) · A`. `alpha_t` equals hmmlearn's `predict_proba` of the sequence that ends at bar `t`, at its last
row (tested), and does not change when later bars are removed (tested). Per bar the live walk costs about 39
microseconds for the filter (measured on 3,000 MNQ 5m bars, 2026-10-07); the eight features cost about 0.3
microseconds a bar.

## 6. Python outline (matches `regime_hmm.py`)

```python
import numpy as np
from hmmlearn.hmm import GaussianHMM
from shared.zones import structural_pivots          # the dashboard's pivot rule

REGIME_NAMES = ("flat", "uptrend", "downtrend")
FEATURE_NAMES = ("average_directional_index", "body_to_range_ratio", "volatility_compression_ratio",
                 "distance_from_swing_high_scaled", "distance_from_swing_low_scaled", "bars_since_last_pivot",
                 "higher_high_higher_low_score", "last_two_pivots_sign")


def structural_features(open_, high, low, close, move_scale, swing_confirmation_bars):
    """(n, 8); row t reads bars <= t; NaN while a window fills."""
    out = np.full((close.size, 8), np.nan)
    out[:, 0] = _average_directional_index(high, low, close, 14)                 # Wilder, first value at bar 27
    span = high - low
    out[:, 1] = _trailing_mean(np.where(span > 0, np.abs(close - open_) / np.where(span > 0, span, 1), 0), 14)
    ranges = true_ranges(high, low, close)                                       # NaN at bar 0
    out[:, 2] = _trailing_mean(ranges, 14) / _trailing_mean(ranges, 100)         # NaN for the first 100 bars
    highs, lows = structural_pivots(high, low, swing_confirmation_bars)          # pivot bars
    # walk the bars in time order; a pivot at bar j enters at bar j + swing_confirmation_bars
    _structure_walk(close, move_scale, highs, high[highs], lows, low[lows], swing_confirmation_bars,
                    0.5 ** (1 / 48), out)                                        # fills columns 3..7
    return out


def heuristic_labels(features, adx_threshold):
    adx, score = features[:, 0], features[:, 6]
    labels = np.zeros(len(features), dtype=int)                                  # 0 flat
    labels[(adx >= adx_threshold) & (score > 0)] = 1                             # uptrend
    labels[(adx >= adx_threshold) & (score < 0)] = 2                             # downtrend
    return labels


class StructuralRegimeHMM:
    def __init__(self, adx_threshold=20.0, iteration_count=100, seed=0): ...

    def fit(self, features, rows):
        rows = rows[np.all(np.isfinite(features[rows]), axis=1)]                 # training rows, all features known
        raw = features[rows]
        self.scaler_mean, self.scaler_deviation = raw.mean(0), raw.std(0)        # training rows only
        scaled = (raw - self.scaler_mean) / self.scaler_deviation
        labels = heuristic_labels(raw, self.adx_threshold)
        means = np.stack([scaled[labels == k].mean(0) for k in range(3)])        # the supervised seed
        variances = np.stack([np.maximum(scaled[labels == k].var(0), 0.1) for k in range(3)])
        transition = np.full((3, 3), 0.025); np.fill_diagonal(transition, 0.95)  # sticky start
        prior = np.ones((3, 3)); np.fill_diagonal(prior, 11.0)                   # sticky Dirichlet prior
        model = GaussianHMM(n_components=3, covariance_type="diag", n_iter=1, init_params="", params="stmc",
                            transmat_prior=prior, means_prior=means.copy(), means_weight=1.0 * rows.size)
        model.startprob_, model.transmat_, model.means_, model.covars_ = start, transition, means, variances
        previous = -np.inf
        for _ in range(self.iteration_count):                                    # Baum-Welch, one iteration a call
            model.fit(scaled, contiguous_lengths(rows))
            model.covars_ = np.maximum(np.diagonal(model.covars_, axis1=1, axis2=2), 0.1)   # variance floor
            current = model.score(scaled, contiguous_lengths(rows))
            if current - previous < 0.01:
                break
            previous = current
        ascending = np.argsort(model.means_[:, 6])                               # by the higher-high / higher-low score
        order = [ascending[1], ascending[2], ascending[0]]                       # flat, uptrend, downtrend
        self.start, self._transition = model.startprob_[order], model.transmat_[np.ix_(order, order)]
        self.means = model.means_[order]
        self.variances = np.diagonal(model.covars_, axis1=1, axis2=2)[order]
        return self

    def forward_filter(self, features, start_row, end_row, state=None):
        """Filtered probabilities of rows start_row..end_row; `state` continues an earlier pass."""
        alpha = None if state is None else state[1]
        emission = self.log_emission(self.scale(features[first:end_row + 1]))    # diagonal Gaussian log density
        for position, log_density in enumerate(emission):
            known = np.all(np.isfinite(log_density))
            if alpha is None and not known:
                continue                                                         # nothing to say yet: NaN
            prior = self.start if alpha is None else alpha @ self._transition
            if known:
                weights = prior * np.exp(log_density - log_density.max())
                alpha = weights / weights.sum()
            else:
                alpha = prior                                                    # a bar without features
            out[position] = alpha
        return out, (end_row, alpha)

    def filtered_probabilities(self, observations): ...   # forward_filter over rows 0..n-1 → (n, 3)
    def most_likely(self, observations): ...              # the regime NAME per row (None before the first known row)
    def summaries(self): ...                              # per regime: name, every feature's mean in words,
                                                          # stay probability, expected bars per visit = 1 / (1 − A_kk)
    transition                                            # property: the 3 × 3 matrix in REGIME_NAMES order
```

Real-time use, one bar at a time:

```python
features = structural_features(open_, high, low, close, move_scale, swing_confirmation_bars=5)
model = StructuralRegimeHMM(adx_threshold=20.0, iteration_count=100).fit(features, training_rows)
state = None
for row in live_rows:                                    # as each bar closes
    probabilities, state = model.forward_filter(features, row, row, state)
    regime = REGIME_NAMES[int(np.argmax(probabilities[0]))]
```

## 7. Inside the regime Monte Carlo decision stack

- The **Monte Carlo** fits one Student-t of the one-bar log return per regime on the training bars the forward
  filter puts in that regime, and re-draws the regime every simulated bar from this transition matrix.
- The **decision model** reads the three filtered probabilities as `flat_regime_probability`,
  `uptrend_regime_probability`, `downtrend_regime_probability`.
- The **trade gate** is a quantile gate: `gate_open_fraction` (default 0.3) is the share of bars it should open on;
  the fold's threshold is the (1 − `gate_open_fraction`) quantile of |P − 0.5| over the kept decision model's
  validation probabilities (`docs/runs.md` has the full rule and its out-of-fold fallback).
- The **wire** (`cycle_regime_forecast`): `regimeNames` = `["flat", "uptrend", "downtrend"]`,
  `regimeProbabilities[bar]` in that order, `mostLikelyRegime[bar]` = the name; `regimes[k]` carries `name`,
  `featureMeans` (each feature's mean in words), `stayProbability`, `expectedBarsPerVisit`.
- The **Market chart** paints each walked candle in its most likely regime's colour ("candles by regime" switch
  in the run's chrome; the crosshair readout names the regime with its glyph).

## 8. What was measured (2026-10-07)

- Planted regimes (twelve segments of 500–900 bars, drift 1.5 points a bar against noise of 3): 91.0%, 91.9% and
  92.1% of bars named right over three seeds; 87.6%, 90.0% and 90.8% on the bars after the training span.
- Real MNQ 5m, 3,000 bars (2025-12-14 → 2025-12-30), one fold, 238 walked test bars: flat 36.1% (mean ADX 18.7),
  uptrend 24.4% (24.5), downtrend 39.5% (28.0). Training span: flat mean ADX 15.4, uptrend 30.3, downtrend 30.6;
  a visit lasts about 36, 31 and 21 bars.
- The names describe structure, not future returns: on that training span the uptrend regime's mean one-bar log
  return was −4.3e-06 and the downtrend's +2.2e-05. Expect the regimes to say what the chart looks like now.
