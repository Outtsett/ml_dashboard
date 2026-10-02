/**
 * One label per candle: the pattern the bar actually matches best.
 *
 * TA-Lib's rules overlap heavily. A single small-bodied bar with two shadows
 * satisfies Doji, Spinning Top, High Wave, Short Line and Long Legged Doji all
 * at once, and every one of them fires. Drawing all of them stacks four or five
 * names on one candle and buries the price, which is what the chart looked like
 * before this existed.
 *
 * TA-Lib gives no way to choose between them: it emits the same flat magnitude
 * for each. So the choice is made here, on the same basis as the exemplar
 * analysis in scripts/candlestick_pattern_exemplars.py.
 *
 *   1. Reduce every firing to its SHAPE, in fractions of the bar's own range,
 *      so the comparison is about geometry rather than price level.
 *   2. For each pattern, the ARCHETYPE is the median shape across that
 *      pattern's firings in view. Median, not mean, so a handful of extreme
 *      bars cannot drag the archetype somewhere no real candle lives.
 *   3. Score a firing by its distance to that archetype, divided by how tightly
 *      that pattern's own firings cluster. Dividing by the spread is what stops
 *      the loosest pattern always winning: being 0.1 away from a pattern whose
 *      firings scatter by 0.3 is an ordinary example, while being 0.1 away from
 *      one that clusters within 0.02 is a remarkable one.
 *   4. The bar's label is the lowest score. Ties go to the RARER pattern, since
 *      "Three Outside Up/Down" says more about this bar than "Short Line" does.
 *
 * Everything else still exists — the lane records every firing and hovering a
 * bar names them all. Only the drawn label is narrowed to one.
 */

/** One pattern firing on one bar, reduced to what the choice needs. */
export interface PatternFiring {
  /** Bar time in chart seconds. */
  time: number;
  /** Selection column, e.g. `talib:doji` or `CDL_DOJI`. */
  patternColumn: string;
  bodyFraction: number;
  upperShadowFraction: number;
  lowerShadowFraction: number;
}

/** Key identifying one firing, used to mark the winners. */
export function firingKey(time: number, patternColumn: string): string {
  return `${time}|${patternColumn}`;
}

/** Spread floor, so a pattern with one firing cannot score infinitely well. */
const MINIMUM_SPREAD = 0.02;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/**
 * The firings that should carry a drawn label: one per bar, the best match.
 *
 * Returns a set of `firingKey` values. A bar with a single firing keeps it; a
 * bar with five keeps the one whose shape is the most convincing example of its
 * own pattern.
 */
export function selectBestMatchPerBar(firings: readonly PatternFiring[]): Set<string> {
  if (firings.length === 0) return new Set();

  // Group by pattern so each one gets its own archetype and spread.
  const byPattern = new Map<string, PatternFiring[]>();
  for (const firing of firings) {
    const existing = byPattern.get(firing.patternColumn);
    if (existing) existing.push(firing);
    else byPattern.set(firing.patternColumn, [firing]);
  }

  const archetypeByPattern = new Map<
    string,
    { body: number; upper: number; lower: number; spread: number; count: number }
  >();

  for (const [patternColumn, group] of byPattern) {
    const body = median(group.map(f => f.bodyFraction));
    const upper = median(group.map(f => f.upperShadowFraction));
    const lower = median(group.map(f => f.lowerShadowFraction));
    const distances = group.map(f =>
      Math.hypot(
        f.bodyFraction - body,
        f.upperShadowFraction - upper,
        f.lowerShadowFraction - lower,
      ),
    );
    archetypeByPattern.set(patternColumn, {
      body,
      upper,
      lower,
      spread: Math.max(median(distances), MINIMUM_SPREAD),
      count: group.length,
    });
  }

  // Per bar, keep the lowest score.
  const bestByTime = new Map<number, { key: string; score: number; count: number }>();

  for (const firing of firings) {
    const archetype = archetypeByPattern.get(firing.patternColumn);
    if (!archetype) continue;

    const distance = Math.hypot(
      firing.bodyFraction - archetype.body,
      firing.upperShadowFraction - archetype.upper,
      firing.lowerShadowFraction - archetype.lower,
    );
    const score = distance / archetype.spread;
    const current = bestByTime.get(firing.time);

    const wins =
      current === undefined ||
      score < current.score ||
      // A tie goes to the rarer pattern: it carries more information about this
      // bar than a name that fits a third of the chart.
      (score === current.score && archetype.count < current.count);

    if (wins) {
      bestByTime.set(firing.time, {
        key: firingKey(firing.time, firing.patternColumn),
        score,
        count: archetype.count,
      });
    }
  }

  const winners = new Set<string>();
  for (const best of bestByTime.values()) winners.add(best.key);
  return winners;
}
