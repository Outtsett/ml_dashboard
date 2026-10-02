/**
 * Data-visualization color semantics — the single source of truth.
 *
 * This codebase is maintained by a deuteranope (red-green colorblind). A
 * red-vs-green pair is a single indistinguishable hue here, so direction is
 * encoded orange-vs-blue throughout, matching the Okabe-Ito palette.
 *
 * The rule this module exists to enforce: **color never carries meaning
 * alone.** Every element that encodes direction, pass/fail, or state must also
 * carry a second channel — a glyph, a sign, an icon, or a text label. Use
 * `trendGlyph()` alongside `trendToneClass()`, never the color by itself.
 *
 * CSS-side counterparts live in `index.css` as `--data-pos` / `--data-neg` /
 * `--data-neutral` / `--data-warn` and `--data-cat-1..10`. Prefer the CSS
 * tokens in markup (`text-(--color-data-pos)`); use the constants here when a
 * hex value must be handed to a charting library that cannot read CSS
 * variables.
 */

// ── Wong 2011 categorical palette ───────────────────────────────

/**
 * 8 hues, mutually distinguishable under deuteranopia, protanopia, and
 * tritanopia. Index modulo for more than 8 series. Always paired with a text
 * label (legend / tooltip) so the series is identifiable without color.
 *
 * Source: Wong, B. "Points of view: Color blindness." Nature Methods 8, 441 (2011).
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

/**
 * Wong hues adapted for this app's dark background, ORDERED by measured
 * deuteranope separation rather than Wong's published sequence.
 *
 * Most charts here plot 2-5 series, so the leading slots carry all the weight.
 * Blue and green are the tightest pair in Wong under deuteranopia (separation
 * 37.4, against 79.2 for the worst pair among slots 1-5), so they sit at
 * opposite ends and only ever co-occur at 8 series, where a legend is
 * mandatory. Slots 1-2 stay blue/orange to match `DATA_COLORS.neg`/`.pos`.
 * Wong's 8th entry is black, invisible on this background, so it is replaced
 * by a light neutral.
 *
 * Mirrors the `--data-cat-1..10` CSS tokens — change both together.
 */
export const WONG_PALETTE_DARK = [
  "#0072B2", // blue
  "#E69F00", // orange
  "#F0E442", // yellow
  "#CC79A7", // pink
  "#56B4E9", // sky
  "#D55E00", // vermillion
  "#B6BAC5", // light neutral (replaces Wong's black)
  "#009E73", // green
] as const;

/** Cyclic accessor — safe for any index, including negatives. */
export function paletteColor(index: number): string {
  const idx = ((index % WONG_PALETTE.length) + WONG_PALETTE.length) % WONG_PALETTE.length;
  return WONG_PALETTE[idx]!;
}

/** Cyclic accessor over the dark-background variant. */
export function paletteColorDark(index: number): string {
  const n = WONG_PALETTE_DARK.length;
  const idx = ((index % n) + n) % n;
  return WONG_PALETTE_DARK[idx]!;
}

// ── Semantic direction ──────────────────────────────────────────

export type TrendTone = "up" | "down" | "flat";

/** Hex equivalents of the `--data-*` CSS tokens, for charting libraries. */
export const DATA_COLORS = {
  pos: "#E69F00", // orange
  neg: "#0072B2", // blue
  neutral: "#808A99", // grey
  warn: "#F0E442", // yellow
} as const;

/**
 * Classify a delta into a direction.
 *
 * `epsilon` guards against a stream of floating-point noise reading as constant
 * movement — anything inside ±epsilon is "flat". Callers working in a known
 * unit should pass an epsilon meaningful for that unit.
 */
export function trendTone(delta: number, epsilon = 0): TrendTone {
  if (!Number.isFinite(delta)) return "flat";
  if (delta > epsilon) return "up";
  if (delta < -epsilon) return "down";
  return "flat";
}

/**
 * The non-color channel. Pair this with any tone-derived color so the direction
 * survives for a viewer who cannot separate the hues — and for a grayscale
 * print, a screenshot, or a low-quality projector.
 */
export function trendGlyph(tone: TrendTone): string {
  switch (tone) {
    case "up":
      return "▲";
    case "down":
      return "▼";
    case "flat":
      return "—";
  }
}

/** Tailwind text-color class for a tone, reading the CSS token. */
export function trendToneClass(tone: TrendTone): string {
  switch (tone) {
    case "up":
      return "text-(--color-data-pos)";
    case "down":
      return "text-(--color-data-neg)";
    case "flat":
      return "text-(--color-data-neutral)";
  }
}

/** Hex color for a tone, for charting libraries that cannot read CSS variables. */
export function trendToneColor(tone: TrendTone): string {
  switch (tone) {
    case "up":
      return DATA_COLORS.pos;
    case "down":
      return DATA_COLORS.neg;
    case "flat":
      return DATA_COLORS.neutral;
  }
}

/**
 * Screen-reader text for a direction. Visual glyphs are `aria-hidden`; this is
 * what actually gets announced.
 */
export function trendLabel(tone: TrendTone): string {
  switch (tone) {
    case "up":
      return "increased";
    case "down":
      return "decreased";
    case "flat":
      return "unchanged";
  }
}
