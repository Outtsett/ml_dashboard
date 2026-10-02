/**
 * The arithmetic every "sum, then link" Inside-the-model view shares (linear,
 * naive Bayes, support vectors, stacking): turning the model's raw output
 * into P(up) with the fold's own link (`@shared/cycle/explain`
 * `cycleExplainLinkSchema`), and the few number formats those views print.
 *
 * Pure functions only, so the views and their tests compute the same numbers.
 */
import type { CycleExplainLink, CycleExplainStructure } from "@shared/cycle/explain";

import { CYCLE_COLORS } from "@/cycle/chartModel";

/** The view palette: Okabe-Ito through the Cycle's own constants, never a new hex. */
export const INSIDE_COLORS = {
  /** Pushes up / went up / predicts up — always with "+" and ▲. */
  up: CYCLE_COLORS.up,
  /** Pushes down / went down / predicts down — always with "−" and ▼. */
  down: CYCLE_COLORS.down,
  /** Reference curves and the probability line. */
  sky: CYCLE_COLORS.sky,
  /** This bar: the point the model actually produced. */
  bar: CYCLE_COLORS.active,
  /** Neutral: not yet added, not counted, the constant term. */
  neutral: CYCLE_COLORS.neutral,
  /** A highlight for the step being added right now. */
  step: CYCLE_COLORS.yellow,
} as const;

export function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

/**
 * Φ, the standard normal cumulative distribution — Marsaglia's (2004) Taylor
 * series Φ(x) = ½ + φ(x)·(x + x³/3 + x⁵/(3·5) + …), every term positive, so
 * it is accurate to ~1e-15 absolute (scipy's `norm.cdf` is what statsmodels'
 * probit uses).
 */
export function standardNormalCumulative(value: number): number {
  if (!Number.isFinite(value)) return value > 0 ? 1 : 0;
  if (value > 37) return 1;
  if (value < -37) return 0;
  const square = value * value;
  let sum = value;
  let previous = 0;
  let term = value;
  let denominator = 1;
  while (sum !== previous) {
    previous = sum;
    denominator += 2;
    term *= square / denominator;
    sum = previous + term;
  }
  return 0.5 + sum * Math.exp(-0.5 * square - 0.91893853320467274178);
}

/** Links whose curve from raw output to P(up) this module can draw. */
export type DrawableLink = "logistic" | "probit" | "logistic_curve" | "posterior";

export function isDrawableLink(link: CycleExplainLink): link is DrawableLink {
  return link === "logistic" || link === "probit" || link === "logistic_curve" || link === "posterior";
}

/**
 * P(up) from the raw output through the fold's link; null for the identity
 * link (a price model's output is a move, not a probability) and for links
 * that are not a function of one raw number (vote, calibration map).
 */
export function applyLink(link: CycleExplainLink, raw: number, curve: CycleExplainStructure["logisticCurve"]): number | null {
  switch (link) {
    case "logistic":
    case "posterior": // two classes: softmax of the two log posteriors = logistic of their difference
      return logistic(raw);
    case "probit":
      return standardNormalCumulative(raw);
    case "logistic_curve":
      return curve ? logistic(curve.slope * raw + curve.intercept) : null;
    default:
      return null;
  }
}

/** What the raw number is called, per link, in words. */
export function rawOutputName(link: CycleExplainLink): string {
  switch (link) {
    case "logistic":
      return "log-odds of up";
    case "probit":
      return "probit score (standard deviations)";
    case "posterior":
      return "log posterior odds of up";
    case "logistic_curve":
      return "score before the validation curve";
    case "identity":
      return "predicted move in typical moves";
    default:
      return "raw output";
  }
}

/** The link as a sentence, for the curve's caption. */
export function linkSentence(link: CycleExplainLink, curve: CycleExplainStructure["logisticCurve"]): string {
  switch (link) {
    case "logistic":
      return "The S-curve (logistic) turns the log-odds into a probability: P(up) = 1 / (1 + e^−sum).";
    case "posterior":
      return "The prior plus every feature's evidence is the log posterior odds; the S-curve turns it into P(up).";
    case "probit":
      return "The normal curve (probit) turns the score into a probability: P(up) = Φ(sum), the share of a bell curve left of the score.";
    case "logistic_curve":
      return curve
        ? `A curve fitted on the validation bars turns the score into a probability: P(up) = 1 / (1 + e^−(${formatNumber(curve.slope, 3)} × score ${curve.intercept >= 0 ? "+" : "−"} ${formatNumber(Math.abs(curve.intercept), 3)})).`
        : "The validation curve is missing, so this score has no probability.";
    case "identity":
      return "A price model's sum is already the answer: the predicted move in typical moves.";
    default:
      return "";
  }
}

/** A plain number with a fixed number of decimals; "—" when not finite. */
export function formatNumber(value: number | null | undefined, decimals = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(decimals);
}

/** Always signed: "+0.123", "−0.123" (a true minus sign), "0.000". */
export function formatSigned(value: number | null | undefined, decimals = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const text = Math.abs(value).toFixed(decimals);
  if (Number(text) === 0) return text;
  return value > 0 ? `+${text}` : `−${text}`;
}

/** ▲ for a push up, ▼ for a push down, · for none. */
export function directionGlyph(value: number): string {
  return value > 0 ? "▲" : value < 0 ? "▼" : "·";
}

export function directionColor(value: number): string {
  return value > 0 ? INSIDE_COLORS.up : value < 0 ? INSIDE_COLORS.down : INSIDE_COLORS.neutral;
}

/** The glyph and word for a probability of up: above one half is "up". */
export function probabilityVerdict(probability: number): { glyph: string; word: string; color: string } {
  if (probability > 0.5) return { glyph: "▲", word: "up", color: INSIDE_COLORS.up };
  if (probability < 0.5) return { glyph: "▼", word: "down", color: INSIDE_COLORS.down };
  return { glyph: "·", word: "even", color: INSIDE_COLORS.neutral };
}
