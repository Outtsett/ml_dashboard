# TensionFlow: Level 1 Python Scoring Engine

Reads benchmarks (15), distances (210), features (57x60), and Markov state from shared memory. Computes 5 domain signals, regime-adaptive D_score, TensionDelta, and trade decisions. Writes 64-byte ScoreBlock back.

**Pipeline**: Shared Memory → Normalize → 5 Domain Signals → Regime-Adaptive Composite → TensionDelta → Confluence/Alignment Gates → Trade Decision → Risk Gates → ScoreBlock

**Loop**: Sequential per-tick. Every new `feature_seq` triggers the full pipeline. Polls at 100us.

**Level 1 only** — no DOM/Level 2 features, detections, or orderbook normalization.

---

## Module Layout

```
tensionflow/
├── scorer.py              Main loop: poll → signals → trade → ScoreBlock
├── config.py              All constants, field indices, regime weights, thresholds
├── __main__.py            CLI entry: python -m tensionflow
│
├── features/
│   ├── spatial.py         Normalize 210 distances to [-1,+1] via ATR proxy
│   ├── volume.py          Z-score normalize volume fields across 60 levels
│   └── derived.py         Extract pre-normalized C engine fields
│
├── signals/
│   ├── spatial.py         S_spatial: weighted benchmark distances + convergence
│   ├── momentum.py        S_momentum: benchmark velocity + Bollinger band state
│   ├── band_direction.py  S_band_direction: VWAP/VPOC/TWAP condition tables
│   ├── volume_profile.py  S_volume_profile: VPOC drift, skew, VA width
│   ├── structure.py       S_structure: benchmark clustering + pair compression
│   └── _util.py           Shared signal utilities
│
├── tension/
│   ├── composite.py       Regime-weighted 5-signal fusion → D_score [-1,+1]
│   └── delta.py           TensionDelta: 210-distance graph → (upzone, downzone, delta)
│
├── trade/
│   ├── confluence.py      Entry gates: confluence (>1.5) and alignment (>0.60)
│   ├── context.py         Price proximity: AT_MPD, AT_EXTREME, AT_VALUE_EDGE, AT_VWAP, AT_NEUTRAL
│   ├── strength.py        Discrete strength {-2,-1,0,+1,+2} with context upgrades
│   ├── flip.py            Initial entry + hysteresis-gated flips/exits
│   └── threshold.py       Adaptive thresholds: MA ± 1.2σ (cold-start: ±0.3)
│
├── state/
│   ├── history.py         Rolling TensionDelta window (Welford online mean/std)
│   ├── hysteresis.py      3-bar neutral zone dwell, flip gating
│   └── regime.py          Markov state → regime weight profile selector
│
├── risk/
│   ├── confidence.py      0.50*|D_score| + 0.25*|TD| + 0.25*alignment → [0,1]
│   ├── sizing.py          Fractional Kelly with 0.25 safety factor, max 4 contracts
│   ├── drawdown.py        Linear equity drawdown scaling, floor at 10%
│   └── stops.py           Structural stop/target from benchmark levels
│
└── patterns/
    └── __init__.py        Reserved for future pattern recognition
```

## 5 Domain Signals

| Signal | Source | Weight Range |
|--------|--------|-------------|
| S_spatial | 15 price-to-benchmark distances + 195 pair convergence | 0.20–0.35 |
| S_momentum | VWAP/TWAP/VPOC velocity + Bollinger band state | 0.15–0.25 |
| S_band_direction | 5×3 condition tables for VWAP, VPOC, TWAP families | 0.20–0.25 |
| S_volume_profile | VPOC drift, distribution skew, VA width | 0.15–0.20 |
| S_structure | Benchmark clustering, directional bias, pair compression | 0.15–0.20 |

Weights are regime-adaptive — see `config.REGIME_WEIGHTS`.

## Key Constants

- **Tick size**: 0.25 (MNQ)
- **Hysteresis**: 3 bars neutral zone, 0.3 threshold
- **Adaptive threshold**: MA ± 1.2 × StdDev over 100-bar window
- **Confluence gate**: >1.5 signal magnitude, >0.60 alignment fraction
- **Risk**: MIN_CONFIDENCE=0.4, Kelly safety=0.25, max drawdown=5%, max contracts=4

## Testing

Tests at `tests/ml/tensionflow/` mirror the source structure. 23 test files using synthetic numpy arrays — no shared memory dependency.
