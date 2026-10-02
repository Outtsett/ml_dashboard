/**
 * Triple barrier (López de Prado, AFML ch. 3.4) — take-profit, stop-loss and
 * time barriers, in volatility units.
 *
 * Think of it as: at every bar you place a bracket order. The label is which
 * side of the bracket fills first, and the row records where it filled.
 *
 * What changed from the percent-of-close version (audit, 2026-09-26):
 *   - barriers are `close ± multiple × causal volatility scale` by default
 *     (average true range or the standard deviation of 1-bar returns over a
 *     trailing window, NULL until the window is full, so a warmup row has no
 *     barrier rather than one sitting on the entry price);
 *   - the realised return is measured at the FILL — the barrier level, or the
 *     bar's open when it gapped through — not the horizon-end close;
 *   - both barriers inside one bar is recorded, not guessed by proximity:
 *     `flag_ambiguous` keeps the row with `usable = false`, `stop_first` books the stop;
 *   - the vertical exit is labelled by the sign of the move (0 when flat);
 *   - `minimumReturnPercent` marks a row unusable instead of dropping it.
 */
import type { LabelGeneratorConfig } from './helpers';
import { DEFAULT_CONFIG, windowOver, rollingStd, rollingMean, trueRangeExpression } from './helpers';

export interface TripleBarrierParams {
  barrierUnits?: 'volatility' | 'percent';
  upperBarrierMultiple?: number;
  lowerBarrierMultiple?: number;
  volatilityMeasure?: 'average_true_range' | 'return_standard_deviation';
  volatilityWindowBars?: number;
  takeProfitPercent?: number;
  stopLossPercent?: number;
  holdingPeriodBars?: number;
  minimumReturnPercent?: number;
  sameBarTouchConvention?: 'flag_ambiguous' | 'stop_first';
}

export function generateTripleBarrierLabelsSQL(
  params: TripleBarrierParams,
  config: LabelGeneratorConfig
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const barrierUnits = params.barrierUnits ?? 'volatility';
  const upperMultiple = Number(params.upperBarrierMultiple ?? 2.0);
  const lowerMultiple = Number(params.lowerBarrierMultiple ?? 1.5);
  const volatilityMeasure = params.volatilityMeasure ?? 'average_true_range';
  const volatilityWindow = Math.max(2, Math.floor(Number(params.volatilityWindowBars ?? 20)));
  const takeProfit = Number(params.takeProfitPercent ?? 1.0) / 100;
  const stopLoss = Number(params.stopLossPercent ?? 0.5) / 100;
  const holding = Math.max(1, Math.floor(Number(params.holdingPeriodBars ?? 20)));
  const minimumReturn = Math.max(0, Number(params.minimumReturnPercent ?? 0)) / 100;
  const convention = params.sameBarTouchConvention ?? 'flag_ambiguous';

  // The causal scale, in price points. ATR: mean true range over the trailing
  // window (bar 0 has no previous close, so the count guard also skips it).
  // Return std: population std of 1-bar log returns over the window, times the
  // close, so both measures are in points.
  const scaleExpression = volatilityMeasure === 'return_standard_deviation'
    ? `${rollingStd('log_return', volatilityWindow - 1, cfg)} * close`
    : rollingMean('true_range', volatilityWindow - 1, cfg);

  const barriers = barrierUnits === 'percent'
    ? `close * (1 + ${takeProfit}) AS upper_barrier_price,
       close * (1 - ${stopLoss}) AS lower_barrier_price,`
    : `close + ${upperMultiple} * volatility_scale_points AS upper_barrier_price,
       close - ${lowerMultiple} * volatility_scale_points AS lower_barrier_price,`;

  const steps = Array.from({ length: holding }, (_, i) => i + 1);
  const leadColumns = steps.map(i =>
    `LEAD(open, ${i}) ${windowOver(cfg)} AS future_open_${i},
     LEAD(high, ${i}) ${windowOver(cfg)} AS future_high_${i},
     LEAD(low, ${i}) ${windowOver(cfg)} AS future_low_${i},
     LEAD(close, ${i}) ${windowOver(cfg)} AS future_close_${i}`
  ).join(',\n    ');

  // Per forward bar i: did it resolve, and how. Evaluated in order, so the
  // first resolving bar wins — the same short-circuit for every derived column.
  const hitUp = (i: number) => `future_high_${i} >= upper_barrier_price`;
  const hitDown = (i: number) => `future_low_${i} <= lower_barrier_price`;
  const openUp = (i: number) => `future_open_${i} >= upper_barrier_price`;
  const openDown = (i: number) => `future_open_${i} <= lower_barrier_price`;
  const resolved = (i: number) => `(${hitUp(i)} OR ${hitDown(i)})`;
  const bothTouched = (i: number) => `(${hitUp(i)} AND ${hitDown(i)})`;

  const chain = (perStep: (i: number) => string, vertical: string) =>
    `CASE
      ${steps.map(i => `WHEN ${resolved(i)} THEN ${perStep(i)}`).join('\n      ')}
      WHEN future_close_${holding} IS NOT NULL THEN ${vertical}
      ELSE NULL
    END`;

  // Which barrier resolved bar i. A bar that OPENS beyond a barrier filled at
  // its open; both barriers touched inside the bar is `ambiguous`.
  const touchedAt = (i: number) => `CASE
        WHEN ${openUp(i)} AND NOT ${openDown(i)} THEN 'upper'
        WHEN ${openDown(i)} AND NOT ${openUp(i)} THEN 'lower'
        WHEN ${bothTouched(i)} THEN 'ambiguous'
        WHEN ${hitUp(i)} THEN 'upper'
        ELSE 'lower'
      END`;
  const priceAt = (i: number) => `CASE
        WHEN ${openUp(i)} AND NOT ${openDown(i)} THEN future_open_${i}
        WHEN ${openDown(i)} AND NOT ${openUp(i)} THEN future_open_${i}
        WHEN ${bothTouched(i)} THEN lower_barrier_price
        WHEN ${hitUp(i)} THEN upper_barrier_price
        ELSE lower_barrier_price
      END`;
  const gapAt = (i: number) => `CASE
        WHEN ${openUp(i)} AND NOT ${openDown(i)} THEN future_open_${i} - upper_barrier_price
        WHEN ${openDown(i)} AND NOT ${openUp(i)} THEN lower_barrier_price - future_open_${i}
        ELSE 0
      END`;

  return `
WITH bars AS (
  SELECT
    ${cfg.timestampColumn} as timestamp,
    ${cfg.symbolColumn} as symbol,
    open, high, low, close, volume,
    LAG(close, 1) ${windowOver(cfg)} as previous_close,
    LN(close / NULLIF(LAG(close, 1) ${windowOver(cfg)}, 0)) as log_return
  FROM ${cfg.tableName}
  WHERE ${cfg.symbolColumn} = '${config.symbol}'
),
ranged AS (
  SELECT *, ${trueRangeExpression()} as true_range
  FROM bars
),
scaled AS (
  SELECT
    timestamp, symbol, open, high, low, close,
    ${scaleExpression} as volatility_scale_points
  FROM ranged
),
with_barriers AS (
  SELECT
    timestamp, symbol, close, volatility_scale_points,
    ${barriers}
    ${leadColumns}
  FROM scaled
),
labeled AS (
  SELECT
    timestamp,
    symbol,
    close,
    volatility_scale_points,
    upper_barrier_price,
    lower_barrier_price,
    ${chain(touchedAt, `'vertical'`)} as barrier_touched,
    ${chain(priceAt, `future_close_${holding}`)} as realized_price,
    ${chain(i => `${i}`, `${holding}`)} as resolution_bars,
    ${chain(gapAt, '0')} as gap_through_barrier_points,
    ${chain(bothTouched, 'false')} as same_bar_both_touched
  FROM with_barriers
  WHERE upper_barrier_price IS NOT NULL AND lower_barrier_price IS NOT NULL
)
SELECT
  timestamp,
  symbol,
  close,
  CASE
    WHEN barrier_touched = 'upper' THEN 1
    WHEN barrier_touched = 'lower' THEN -1
    WHEN barrier_touched = 'ambiguous' THEN -1
    WHEN realized_price > close THEN 1
    WHEN realized_price < close THEN -1
    ELSE 0
  END as label,
  resolution_bars,
  barrier_touched,
  realized_price,
  (realized_price - close) as realized_return_points,
  (realized_price - close) / NULLIF(close, 0) as realized_return_fraction,
  upper_barrier_price,
  lower_barrier_price,
  volatility_scale_points,
  gap_through_barrier_points,
  same_bar_both_touched,
  CASE
    WHEN same_bar_both_touched AND '${convention}' = 'flag_ambiguous' THEN 'ambiguous_same_bar_touch'
    WHEN ABS(realized_price - close) / NULLIF(close, 0) < ${minimumReturn} THEN 'below_minimum_return'
    ELSE NULL
  END as usable_reason_hint
FROM labeled
WHERE barrier_touched IS NOT NULL
ORDER BY timestamp`;
}
