// Unit tests for PaperPnLAccrual (W9.c).
//
// Trading rule under test:
//   - first prediction = baseline, no trade
//   - long→long       = no cost, accrue PnL on price move
//   - long→short      = full round-trip cost on the flip
//   - long→flat       = half-round-trip close cost
//   - low confidence  = treated as flat (no trade gate)
//   - running total persists across calls

import { describe, it, expect } from 'vitest';
import { PaperPnLAccrual, loadCostModel, CONF_FLOOR } from '../../deployment/paperPnL';

// MNQ defaults — half-round-trip = $1.40, point_value = $2.00
const ROUND_TRIP = 2.80;
const HALF = ROUND_TRIP / 2; // 1.40
const POINT_VALUE = 2.00;

describe('PaperPnLAccrual', () => {
  it('first prediction establishes baseline with no trade', () => {
    const a = new PaperPnLAccrual(1, ROUND_TRIP, POINT_VALUE);
    const r = a.onPrediction('long', 0.9, 100.0, null);
    expect(r.traded).toBe(false);
    expect(r.delta).toBe(0);
    expect(r.total).toBe(0);
    // Side stays 0 — first bar establishes baseline only.
    expect(a.getSide()).toBe(0);
  });

  it('long-then-long: no second trade, accrues PnL on price move only', () => {
    const a = new PaperPnLAccrual(1, ROUND_TRIP, POINT_VALUE);
    // Bar 1: baseline.
    a.onPrediction('long', 0.9, 100.0, null);
    // Bar 2: open long at 100, pay half cost.
    const r2 = a.onPrediction('long', 0.9, 100.0, 'long');
    expect(r2.traded).toBe(true);
    expect(r2.delta).toBeCloseTo(-HALF, 2); // -1.40
    expect(a.getSide()).toBe(1);
    // Bar 3: still long, price moves +2 points → +2 * $2 = +$4, no cost.
    const r3 = a.onPrediction('long', 0.9, 102.0, 'long');
    expect(r3.traded).toBe(false);
    expect(r3.delta).toBeCloseTo(4.00, 2);
    expect(r3.total).toBeCloseTo(-HALF + 4.00, 2); // 2.60
  });

  it('long-then-short: pays full round-trip cost on flip', () => {
    const a = new PaperPnLAccrual(1, ROUND_TRIP, POINT_VALUE);
    a.onPrediction('long', 0.9, 100.0, null);                 // baseline
    a.onPrediction('long', 0.9, 100.0, 'long');               // open long, pay HALF
    // Flip to short at same price — no book PnL, full round-trip cost.
    const r = a.onPrediction('short', 0.9, 100.0, 'long');
    expect(r.traded).toBe(true);
    expect(r.delta).toBeCloseTo(-ROUND_TRIP, 2);              // -2.80
    expect(a.getSide()).toBe(-1);
  });

  it('long-then-hold: pays half-round-trip close cost', () => {
    const a = new PaperPnLAccrual(1, ROUND_TRIP, POINT_VALUE);
    a.onPrediction('long', 0.9, 100.0, null);
    a.onPrediction('long', 0.9, 100.0, 'long');               // open long, pay HALF
    // 'hold' → flat. Close cost = half. No book PnL (price flat).
    const r = a.onPrediction('hold', 0.9, 100.0, 'long');
    expect(r.traded).toBe(true);
    expect(r.delta).toBeCloseTo(-HALF, 2);                    // -1.40
    expect(a.getSide()).toBe(0);
  });

  it('low confidence collapses to flat — no trade fires from baseline', () => {
    const a = new PaperPnLAccrual(1, ROUND_TRIP, POINT_VALUE);
    a.onPrediction('long', 0.9, 100.0, null);                 // baseline
    // Below confidence floor → desired side is 0 = currentSide. No trade.
    const r = a.onPrediction('long', CONF_FLOOR - 0.01, 100.0, 'long');
    expect(r.traded).toBe(false);
    expect(r.delta).toBe(0);
    expect(a.getSide()).toBe(0);
  });

  it('running total persists across many predictions', () => {
    const a = new PaperPnLAccrual(1, ROUND_TRIP, POINT_VALUE);
    a.onPrediction('long', 0.9, 100.0, null);                 // baseline
    const r1 = a.onPrediction('long', 0.9, 100.0, 'long');    // open long, -1.40
    const r2 = a.onPrediction('long', 0.9, 102.0, 'long');    // +$4
    const r3 = a.onPrediction('long', 0.9, 103.0, 'long');    // +$2
    const r4 = a.onPrediction('short', 0.9, 103.0, 'long');   // flip, -2.80 (no book pnl)
    const r5 = a.onPrediction('short', 0.9, 102.0, 'short');  // short, +1pt → +$2
    expect(r1.total).toBeCloseTo(-1.40, 2);
    expect(r2.total).toBeCloseTo(2.60, 2);
    expect(r3.total).toBeCloseTo(4.60, 2);
    expect(r4.total).toBeCloseTo(1.80, 2);
    expect(r5.total).toBeCloseTo(3.80, 2);
    expect(a.getTotal()).toBeCloseTo(3.80, 2);
  });

  it('numeric prediction > 0.5 = long, < -0.5 = short, else flat', () => {
    const a = new PaperPnLAccrual(1, ROUND_TRIP, POINT_VALUE);
    a.onPrediction(0.8, 0.9, 100.0, null);                    // baseline
    const r1 = a.onPrediction(0.8, 0.9, 100.0, 0.8);          // open long
    expect(r1.traded).toBe(true);
    expect(a.getSide()).toBe(1);
    const r2 = a.onPrediction(0.0, 0.9, 100.0, 0.8);          // flat (|0| ≤ 0.5)
    expect(r2.traded).toBe(true);
    expect(a.getSide()).toBe(0);
    const r3 = a.onPrediction(-0.9, 0.9, 100.0, 0.0);         // short
    expect(r3.traded).toBe(true);
    expect(a.getSide()).toBe(-1);
  });

  it('short position accrues correctly on price drop', () => {
    const a = new PaperPnLAccrual(1, ROUND_TRIP, POINT_VALUE);
    a.onPrediction('short', 0.9, 100.0, null);                // baseline
    a.onPrediction('short', 0.9, 100.0, 'short');             // open short, -1.40
    // Price drops 3 points → short profits 3 * $2 = +$6.
    const r = a.onPrediction('short', 0.9, 97.0, 'short');
    expect(r.delta).toBeCloseTo(6.00, 2);
    expect(r.total).toBeCloseTo(4.60, 2);
  });
});

describe('loadCostModel', () => {
  it('falls back to MNQ defaults when file missing', async () => {
    const result = await loadCostModel('C:/does-not-exist-xyz/cost_model.json');
    expect(result.round_trip).toBe(2.80);
    expect(result.point_value).toBe(2.00);
  });
});
