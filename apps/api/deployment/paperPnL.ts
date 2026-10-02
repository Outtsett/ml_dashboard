// Paper-trading PnL accrual for live model deployments (W9.c).
//
// Used by `apps/api/deployments/lifecycle.ts` (W9.b — written in parallel) to
// translate a stream of MLBridge predictions into a running paper-PnL counter.
// One instance per deployment_id; constructed when the deployment starts and
// fed `onPrediction()` on every bar.
//
// ──────────────────────────────────────────────────────────────────────────
// CONTRACT FOR W9.b (lifecycle.ts) — exact call sequence
// ──────────────────────────────────────────────────────────────────────────
//
//   import { PaperPnLAccrual, loadCostModel } from './paperPnL';
//   import { publishPrediction, publishPnlUpdate } from './publisher';
//
//   // On deployment start:
//   const costs = await loadCostModel();
//   const accrual = new PaperPnLAccrual(
//     deploymentId,
//     costs.round_trip,          // $2.80 default — MNQ round-trip in USD
//     costs.point_value,         // $2.00 default — MNQ $/point
//   );
//   let lastPrediction: number | string | null = null;
//   let predictionsEmitted = 0;
//   let lastPublishedAt = Date.now();
//   const PNL_PUBLISH_EVERY_N = 10;
//   const PNL_PUBLISH_EVERY_MS = 30_000;
//
//   // On every MLBridge prediction:
//   const { delta, total, traded } = accrual.onPrediction(
//     prediction,        // number | string from MLBridge
//     confidence,        // 0..1
//     currentPrice,      // last bar close
//     lastPrediction,    // last prediction value or null
//   );
//   lastPrediction = prediction;
//   predictionsEmitted += 1;
//
//   await publishPrediction({
//     deployment_id: deploymentId,
//     ts: barTimestampIso,
//     prediction,
//     confidence,
//     paper_pnl_delta: delta,
//     paper_pnl_total: total,
//   });
//
//   const now = Date.now();
//   if (
//     predictionsEmitted % PNL_PUBLISH_EVERY_N === 0 ||
//     now - lastPublishedAt >= PNL_PUBLISH_EVERY_MS
//   ) {
//     await publishPnlUpdate({
//       deployment_id: deploymentId,
//       paper_pnl_total: total,
//       predictions_emitted: predictionsEmitted,
//       last_prediction_at: barTimestampIso,
//     });
//     lastPublishedAt = now;
//   }
//
// ──────────────────────────────────────────────────────────────────────────
// Trading rule
// ──────────────────────────────────────────────────────────────────────────
//
//   prediction → side:
//     'long'  or numeric > +0.5    → +1 (long)
//     'short' or numeric < -0.5    → -1 (short)
//     'hold' / 'flat' / else / NaN →  0 (flat)
//
//   confidence < CONF_FLOOR (0.5) → treated as flat ("no trade" gate)
//
//   The position changes whenever the *desired* side differs from the
//   current side. On every change we pay half a round-trip on the exiting
//   leg (close cost) and half on the entering leg (open cost) — equivalent
//   to one full round-trip on a flip. Flat→long pays half. long→flat pays
//   half. long→long pays nothing.
//
//   PnL accrual between bars is computed from the price delta multiplied by
//   the previous bar's side and the point value. Costs are subtracted only
//   on bars where a trade actually occurred.
//
//   The first call establishes a price baseline and DOES NOT trade — `traded`
//   is false, `delta` is the open-cost (if non-zero) and `total` is updated
//   accordingly. This avoids paying entry cost on the very first bar before
//   we know if the model will hold.

import fs from 'node:fs/promises';
import path from 'node:path';

export interface CostModel {
  /** Round-trip cost in USD (e.g. MNQ commission + slippage). */
  round_trip: number;
  /** Dollar value of one point (e.g. MNQ = $2.00). */
  point_value: number;
}

export interface OnPredictionResult {
  /** PnL delta for THIS bar (price move on prev side, minus any trade cost). Rounded 2dp. */
  delta: number;
  /** Running total PnL since accrual started. Rounded 2dp. */
  total: number;
  /** True iff this prediction caused a side change (i.e. paid cost). */
  traded: boolean;
}

/** Confidence below this is treated as "hold" (no trade). */
export const CONF_FLOOR = 0.5;

const DEFAULT_COST_MODEL: CostModel = {
  round_trip: 2.80,
  point_value: 2.00,
};

/**
 * Load the project's cost model from `data/cost_model.json` if present.
 * Falls back to the MNQ defaults (round_trip $2.80, point_value $2.00).
 *
 * The full cost_model.json schema (per the cost-adjusted-metrics skill) may
 * contain many keys (slippage_bps, exchange_fee, etc.); this loader only
 * extracts the two fields used by paper-PnL accrual.
 */
export async function loadCostModel(
  filePath: string = path.resolve(process.cwd(), 'data', 'cost_model.json'),
): Promise<CostModel> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CostModel>;
    const round_trip =
      typeof parsed.round_trip === 'number' && Number.isFinite(parsed.round_trip)
        ? parsed.round_trip
        : DEFAULT_COST_MODEL.round_trip;
    const point_value =
      typeof parsed.point_value === 'number' && Number.isFinite(parsed.point_value)
        ? parsed.point_value
        : DEFAULT_COST_MODEL.point_value;
    return { round_trip, point_value };
  } catch {
    // ENOENT / parse error → use defaults.
    return { ...DEFAULT_COST_MODEL };
  }
}

/**
 * Normalize a raw prediction value into a discrete side: +1 / 0 / -1.
 * Low-confidence predictions collapse to 0 (flat).
 */
function predictionToSide(
  prediction: number | string,
  confidence: number,
): -1 | 0 | 1 {
  if (!Number.isFinite(confidence) || confidence < CONF_FLOOR) return 0;

  if (typeof prediction === 'string') {
    const norm = prediction.trim().toLowerCase();
    if (norm === 'long' || norm === 'buy' || norm === 'up') return 1;
    if (norm === 'short' || norm === 'sell' || norm === 'down') return -1;
    // Attempt numeric parse before giving up.
    const num = Number.parseFloat(norm);
    if (Number.isFinite(num)) return predictionToSide(num, confidence);
    return 0;
  }

  if (!Number.isFinite(prediction)) return 0;
  if (prediction > 0.5) return 1;
  if (prediction < -0.5) return -1;
  return 0;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Stateful accrual of paper-trading PnL for a single deployment.
 *
 * Construct once per deployment, call `onPrediction()` on every MLBridge
 * prediction. The class tracks the current side, the price baseline, and
 * the running total. It does NOT emit events itself — the caller is
 * expected to forward the returned `{delta, total, traded}` into the
 * deployment publisher (see contract block at top of this file).
 */
export class PaperPnLAccrual {
  readonly deploymentId: number;
  readonly costPerTrade: number;       // half of round_trip (per side)
  readonly pointValue: number;

  private currentSide: -1 | 0 | 1 = 0;
  private lastPrice: number | null = null;
  private total = 0;
  private initialized = false;

  constructor(
    deploymentId: number,
    /** Round-trip cost in USD (full round-trip). Half is paid per side. */
    roundTripCost: number,
    /** Dollar value of one point. */
    pointValue: number,
  ) {
    this.deploymentId = deploymentId;
    this.costPerTrade = roundTripCost / 2;
    this.pointValue = pointValue;
  }

  /**
   * Process one prediction. Returns the PnL delta for this bar, the new
   * running total, and a `traded` flag indicating whether a side change
   * (and thus a trade cost) occurred.
   *
   * `lastPrediction` is informational only — the class maintains its own
   * notion of current side, so callers can pass `null` and the result is
   * identical. The parameter exists to keep the call shape symmetric with
   * the lifecycle.ts caller, which already tracks lastPrediction for its
   * own reasons.
   */
  onPrediction(
    prediction: number | string,
    confidence: number,
    currentPrice: number,
    _lastPrediction: number | string | null,
  ): OnPredictionResult {
    void _lastPrediction;
    const desiredSide = predictionToSide(prediction, confidence);

    if (!this.initialized) {
      // First bar: establish price baseline, do NOT trade — even if the
      // desired side is non-zero. We wait one bar before paying entry cost
      // so that a model emitting a single prediction then stopping doesn't
      // generate a phantom cost-only PnL.
      this.initialized = true;
      this.lastPrice = Number.isFinite(currentPrice) ? currentPrice : null;
      // We deliberately keep currentSide = 0 here so the SECOND prediction
      // can open the first position with one half-round-trip cost.
      const delta = 0;
      this.total = round2(this.total + delta);
      return { delta: round2(delta), total: this.total, traded: false };
    }

    // PnL from the price move on the position we were holding.
    let bookPnL = 0;
    if (
      this.lastPrice !== null &&
      Number.isFinite(currentPrice) &&
      this.currentSide !== 0
    ) {
      const priceDelta = currentPrice - this.lastPrice;
      bookPnL = this.currentSide * priceDelta * this.pointValue;
    }

    // Did the side change? If yes, pay the trade cost.
    const traded = desiredSide !== this.currentSide;
    let tradeCost = 0;
    if (traded) {
      // Half-round-trip on exit (if we had a position) PLUS half on entry
      // (if we're opening one). Flat→long pays half. Long→flat pays half.
      // Long→short pays full round-trip.
      const exitCost = this.currentSide !== 0 ? this.costPerTrade : 0;
      const entryCost = desiredSide !== 0 ? this.costPerTrade : 0;
      tradeCost = exitCost + entryCost;
    }

    const delta = bookPnL - tradeCost;
    this.total = round2(this.total + delta);
    this.currentSide = desiredSide;
    if (Number.isFinite(currentPrice)) this.lastPrice = currentPrice;

    return { delta: round2(delta), total: this.total, traded };
  }

  /** Current open side. Test/inspection only. */
  getSide(): -1 | 0 | 1 {
    return this.currentSide;
  }

  /** Running total PnL. Test/inspection only. */
  getTotal(): number {
    return this.total;
  }
}
