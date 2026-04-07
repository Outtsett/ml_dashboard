"""Regime-adaptive weight profile selector.

Maps the Markov regime state and volatility regime to the appropriate
weight profile dict from REGIME_WEIGHTS.  Used by the aggregation layer
to blend spatial, momentum, band_direction, volume_profile, and structure signals according
to current market conditions.
"""

from __future__ import annotations

from ..config import (
    REGIME_WEIGHTS,
    REGIME_VOLATILE,
    REGIME_RANGE,
    REGIME_TREND_UP,
    REGIME_TREND_DOWN,
    REGIME_UNKNOWN,
)


def select_weight_profile(markov_state: int, vol_regime: int) -> dict[str, float]:
    """Return the regime-adaptive signal weight profile.

    The Markov state from the hidden Markov model is the primary selector.
    The volatility regime is used as a tie-breaker when the Markov state
    itself doesn't encode volatility information (i.e. when it equals
    REGIME_UNKNOWN or an unrecognised code):

    - REGIME_VOLATILE  -> high-vol weights  (spatial heavy: 0.40)
    - REGIME_RANGE     -> low-vol weights   (flow heavy: 0.30)
    - REGIME_TREND_UP  -> trend weights     (balanced spatial + flow: 0.25 each)
    - REGIME_TREND_DOWN-> trend weights     (same as TREND_UP by config)
    - Anything else    -> normal/unknown    (REGIME_UNKNOWN weights)

    When markov_state is REGIME_UNKNOWN, vol_regime is used as the key so
    that the volatility signal still contributes to weight selection even
    before the Markov model has converged on a state.

    Args:
        markov_state: Integer regime ID produced by the HMM layer.  Must be
                      one of the REGIME_* constants defined in config.
        vol_regime:   Integer volatility-regime label.  Consulted when
                      markov_state is REGIME_UNKNOWN or unrecognised.

    Returns:
        A dict with keys ``"spatial"``, ``"momentum"``, ``"band_direction"``,
        ``"volume_profile"``, ``"structure"`` whose values sum to 1.0.  The
        dict is a direct reference to the config constant — callers must not
        mutate it.
    """
    # Direct hit — known regime from Markov model takes precedence.
    if markov_state in REGIME_WEIGHTS:
        # When Markov says UNKNOWN, fall through to vol_regime disambiguation.
        if markov_state != REGIME_UNKNOWN:
            return REGIME_WEIGHTS[markov_state]

    # Disambiguate via volatility regime.
    if vol_regime == REGIME_VOLATILE:
        return REGIME_WEIGHTS[REGIME_VOLATILE]
    if vol_regime == REGIME_RANGE:
        return REGIME_WEIGHTS[REGIME_RANGE]
    if vol_regime in (REGIME_TREND_UP, REGIME_TREND_DOWN):
        return REGIME_WEIGHTS[vol_regime]

    # Fallback: return the neutral/unknown profile.
    return REGIME_WEIGHTS[REGIME_UNKNOWN]
