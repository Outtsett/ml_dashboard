/**
 * Wong 2011 colorblind-safe palette for multi-experiment chart series.
 *
 * 8 hues × N experiments — index modulo for >8. Always paired with a text
 * label (legend / tooltip) so deuteranopia users (Tyler) never depend on
 * color alone.
 */

export const WONG_PALETTE = [
  "#0072B2", // blue
  "#E69F00", // orange
  "#009E73", // green
  "#F0E442", // yellow
  "#56B4E9", // sky
  "#D55E00", // vermillion
  "#CC79A7", // pink
  "#000000", // black
] as const;

export function paletteColor(index: number): string {
  const idx = ((index % WONG_PALETTE.length) + WONG_PALETTE.length) % WONG_PALETTE.length;
  return WONG_PALETTE[idx]!;
}
