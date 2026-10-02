/**
 * Ranks and rank correlation.
 *
 * Ties take the average of the positions they span (midranks), which is what
 * scipy.stats.spearmanr does. The textbook shortcut 1 − 6Σd² / (n(n² − 1)) is
 * exact only without ties, and price data is full of them (a volume of 1, a
 * body of zero points), so Spearman here is always Pearson on the midranks.
 */

/** 1-based midranks, input order preserved. */
export function midranks(values: ArrayLike<number>): Float64Array {
  const count = values.length;
  const order = new Array<number>(count);
  for (let index = 0; index < count; index += 1) order[index] = index;
  order.sort((left, right) => (values[left] as number) - (values[right] as number) || left - right);

  const ranks = new Float64Array(count);
  let start = 0;
  while (start < count) {
    let end = start;
    const value = values[order[start] as number] as number;
    while (end + 1 < count && values[order[end + 1] as number] === value) end += 1;
    // Positions start..end (0-based) share the average 1-based rank.
    const shared = (start + end) / 2 + 1;
    for (let position = start; position <= end; position += 1) ranks[order[position] as number] = shared;
    start = end + 1;
  }
  return ranks;
}

/** Pearson correlation, or null when either variable is constant. */
export function pearsonCorrelation(x: ArrayLike<number>, y: ArrayLike<number>): number | null {
  const count = Math.min(x.length, y.length);
  if (count < 2) return null;
  let sumX = 0;
  let sumY = 0;
  for (let index = 0; index < count; index += 1) {
    sumX += x[index] as number;
    sumY += y[index] as number;
  }
  const meanX = sumX / count;
  const meanY = sumY / count;
  let crossProduct = 0;
  let squaresX = 0;
  let squaresY = 0;
  for (let index = 0; index < count; index += 1) {
    const deltaX = (x[index] as number) - meanX;
    const deltaY = (y[index] as number) - meanY;
    crossProduct += deltaX * deltaY;
    squaresX += deltaX * deltaX;
    squaresY += deltaY * deltaY;
  }
  if (squaresX === 0 || squaresY === 0) return null;
  return crossProduct / Math.sqrt(squaresX * squaresY);
}

/** Spearman's rank correlation with midranks for ties. */
export function spearmanCorrelation(x: ArrayLike<number>, y: ArrayLike<number>): number | null {
  return pearsonCorrelation(midranks(x), midranks(y));
}
