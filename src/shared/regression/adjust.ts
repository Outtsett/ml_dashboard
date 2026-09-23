/**
 * Multiple-testing adjustment across panels.
 *
 * Forty panels each tested at 5% hand out two "significant" slopes by chance
 * alone. The Benjamini-Hochberg q-value is the false-discovery rate at which
 * a panel would first be called significant, so ranking by it — rather than
 * by the raw p-value — is what keeps the tab from advertising noise as edge.
 * Matches statsmodels multipletests(method="fdr_bh").
 */

export function benjaminiHochberg(pValues: ReadonlyArray<number>): number[] {
  const count = pValues.length;
  const order = pValues
    .map((value, index) => ({ value: Number.isFinite(value) ? value : 1, index }))
    .sort((left, right) => left.value - right.value);
  const adjusted = new Array<number>(count);
  let running = 1;
  for (let rank = count; rank >= 1; rank -= 1) {
    const entry = order[rank - 1] as { value: number; index: number };
    running = Math.min(running, (entry.value * count) / rank);
    adjusted[entry.index] = Math.min(1, running);
  }
  return adjusted;
}
