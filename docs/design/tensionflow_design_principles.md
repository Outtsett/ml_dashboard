# TensionFlow Design Principles

## Core Philosophy

Events drive everything. Time is metadata on events — events are not metadata on time.

## Event-Driven Architecture

All logic in the system is event-triggered, not time-triggered.

- DOM depth adapts because something happened, not because a timer fired
- RTH open is an event, not a time — it changes the regime
- Session transitions (ETH→RTH, initial balance forming, first VPOC establishing) are events
- The scorer wakes on new data, not on a clock
- Computation happens when state changes, not on intervals

## Adaptive DOM Depth

The number of DOM levels is dynamic, driven by market context.

- **Floor: 10 levels always** — minimum depth, always computed
- **Expansion triggers (events):**
  - Price approaching a benchmark (VWAP, VAH, VAL, MPD bands)
  - Detection fired (iceberg, sweep, spoof)
  - Session regime change (ETH→RTH)
  - Volatility spike
- **Contraction triggers:**
  - ETH / low activity — narrow to inside levels
  - No benchmarks nearby — moderate depth
  - Stable regime, no detections active
- **Benchmark proximity drives depth** — when price nears a VWAP band or key level, expand depth around that zone to observe:
  - Iceberg activity ahead of the level
  - Spoofing / liquidity fading
  - Auction failures
  - Reversal vs. continuation signals
- **Periodic snapshots** of outer levels maintain ambient awareness even when not actively computing them

## Pattern Recognition: The Six Questions

Every pattern detection must be grounded in historical context. When a pattern is detected, the system asks:

1. **Has this** occurred before?
2. **What** caused it? — The market state and causal chain that made this pattern possible
3. **Where** did it happen? — Which benchmark, which zone, which side of the book
4. **When** in context? — Relative to session structure (opening drive, midday balance, closing imbalance) and relative to other events (after a sweep? after a failed auction?)
5. **Why** — what was the outcome? — Reversal, continuation, fade-out, and with what probability
6. **How** — what was the mechanism? — The tick-by-tick microstructure sequence: how the book rebuilt, how aggressor ratio shifted, how liquidity returned level by level

This is the training signal. Not "iceberg detected, score = 0.7." Instead: "iceberg detected at VAH, this has occurred 340 times in training data, 68% led to reversal within 12 ticks when combined with declining aggressor ratio."

## Training Approach

Train from historical pattern occurrences:
- Find every instance of a pattern in the training data
- Record the full context: what caused it, where, when, why, how
- The model learns the conditional probabilities: given this pattern + this context → this outcome
- The six questions ARE the feature engineering for training
