/**
 * How many bars forward a label's outcome lands.
 *
 * A forward-looking label is computed at bar `t` but describes what happens by
 * bar `t + offset`. Drawing the marker at `t` puts an "up" arrow on whatever
 * candle happens to sit at `t` — which moved the other way about half the
 * time, so the overlay read as wrong even when every label was right. The
 * chart shifts each marker by this offset so it lands on the bar it is
 * actually about.
 *
 * The offset is in BARS, never milliseconds. Sessions have gaps — weekends,
 * holidays, and in this dataset a 62-day hole — so `t + offset * timeframe`
 * frequently names an instant with no bar, which would snap the marker back
 * onto the wrong candle. The client walks the loaded bar array by index.
 *
 * Two generators choose their horizon per row rather than from a parameter,
 * and both emit an `outcome_offset` column instead: `triple_barrier` (the bar
 * whose barrier resolved the trade) and `trend_scanning` (the horizon that won
 * the t-statistic search). A per-row column always wins over this table.
 *
 * Backward-looking generators are 0 on purpose: `structural` classifies bar t
 * against a trailing window, and `regime` describes the state at t. Both
 * already sit on the bar they describe.
 */

/** Param name holding the forward horizon, per generator. */
const HORIZON_PARAM: Record<string, string> = {
  direction: 'horizon',
  next_close_direction: 'horizon',
  future_return: 'horizon',
  future_volatility: 'horizon',
  range_bucket: 'horizon',
  meta_label: 'horizon',
  volatility_adaptive: 'horizon',
  signal: 'holdPeriod',
  npmm: 'lookforwardPeriod',
};

/**
 * Generators whose label describes the bar it already sits on. Listed
 * explicitly rather than left to a default so adding a generator is a
 * deliberate choice about which side of this line it falls on.
 */
const DESCRIBES_CURRENT_BAR = new Set([
  'structural',
  'regime',
  'contrastive_temporal',
  'contrastive_augmentation',
  'contrastive_statistical',
  'pseudo_confidence',
  'consistency_perturbation',
]);

/** Column a generator emits when the offset varies row by row. */
export const OUTCOME_OFFSET_COLUMN = 'outcome_offset';

/**
 * Fixed bar offset for `generatorType`, or null when it varies per row (the
 * rows then carry `outcome_offset`) or the generator is unknown.
 */
export function labelOutcomeOffset(
  generatorType: string,
  params: Record<string, unknown>,
): number | null {
  if (DESCRIBES_CURRENT_BAR.has(generatorType)) return 0;

  // multi_step labels the furthest horizon it was asked for; the SQL builds
  // its lead columns off exactly that value.
  if (generatorType === 'multi_step') {
    const steps = params.steps ?? params.horizons;
    if (Array.isArray(steps) && steps.length > 0) {
      const max = Math.max(...steps.map(Number).filter(Number.isFinite));
      return Number.isFinite(max) ? max : null;
    }
    const n = Number(steps);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  const key = HORIZON_PARAM[generatorType];
  if (!key) return null;
  const raw = Number(params[key]);
  return Number.isFinite(raw) && raw >= 0 ? raw : null;
}
