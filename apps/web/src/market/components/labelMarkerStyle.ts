/**
 * Turns a label value into a chart marker style.
 *
 * The overlay serves generators with genuinely different label vocabularies —
 * `direction` emits {-1, 1}, `triple_barrier` {-1, 0, 1}, `structural`
 * {-2..2}, `range_bucket` 0..20 — and the renderer previously understood only
 * ±1, drawing every other value as one identical neutral circle. On MNQ 1H
 * that erased 99% of `range_bucket`, 71% of `signal`, and made `structural`'s
 * +2 (break of structure up) indistinguishable from -2 (break down).
 *
 * The vocabulary is derived from the values actually present in the overlay
 * rather than from a list of generator names. A hardcoded allowlist is what
 * produced the bug: `labelPreview.ts` normalises five named generators and
 * lets the other fourteen through untouched, so any generator added later
 * inherits the breakage by default. Deriving it means a new generator renders
 * correctly without being registered anywhere.
 *
 * Two encodings:
 *
 *   signed   values within [-2, 2]. Sign picks the arrow and the hue,
 *            magnitude picks the size, 0 gets a recessive dot.
 *   ordinal  anything wider. A cividis ramp across the observed range,
 *            drawn as squares on the bar so it reads as a band.
 *
 * Colour never carries meaning alone here: the signed encoding pairs hue with
 * arrow direction and vertical position, and the ordinal encoding is a
 * monotone lightness ramp. Both survive deuteranopia.
 */

import { CANDLE_UP_COLOR, CANDLE_DOWN_COLOR } from './chartConfig';

// ── Types ──────────────────────────────────────────────────────────────────

export type LabelMarkerPosition = 'aboveBar' | 'belowBar' | 'inBar';
export type LabelMarkerShape = 'arrowUp' | 'arrowDown' | 'circle' | 'square';

export interface LabelMarkerStyle {
  position: LabelMarkerPosition;
  shape: LabelMarkerShape;
  color: string;
  /** lightweight-charts marker size multiplier; 1 is the library default. */
  size: number;
}

export interface LabelDomain {
  kind: 'signed' | 'ordinal';
  min: number;
  max: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Widest magnitude the signed encoding can express. Beyond ±2 the size channel
 * stops being readable at chart density and the ramp is the honest choice.
 */
const SIGNED_LIMIT = 2;

/** Okabe-Ito grey. Deliberately not a palette hue: 0 means "no signal". */
const ZERO_COLOR = '#808A99';

const SIZE_ZERO = 0.6;
const SIZE_UNIT = 1;
const SIZE_STRONG = 1.7;

const ORDINAL_SIZE = 0.9;

/**
 * Cividis control points, sampled from the reference colormap.
 *
 * Cividis is the colormap designed for deuteranopia: it varies along the
 * blue-yellow axis that red-green colour blindness leaves intact, and its
 * lightness rises monotonically, so the order survives even in greyscale.
 */
const CIVIDIS_STOPS = [
  { t: 0.0, r: 0.0, g: 0.135, b: 0.304 },
  { t: 0.25, r: 0.251, g: 0.369, b: 0.494 },
  { t: 0.5, r: 0.478, g: 0.478, b: 0.475 },
  { t: 0.75, r: 0.729, g: 0.608, b: 0.396 },
  { t: 1.0, r: 0.996, g: 0.765, b: 0.216 },
];

// ── Colormap ───────────────────────────────────────────────────────────────

function toHex(channel: number): string {
  const v = Math.max(0, Math.min(255, Math.round(channel * 255)));
  return v.toString(16).padStart(2, '0');
}

/** Cividis sample at `t`, clamped to [0, 1], as `#rrggbb`. */
export function cividis(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < CIVIDIS_STOPS.length - 1; i++) {
    const s0 = CIVIDIS_STOPS[i]!;
    const s1 = CIVIDIS_STOPS[i + 1]!;
    if (clamped <= s1.t) {
      const f = (clamped - s0.t) / (s1.t - s0.t);
      return `#${toHex(s0.r + f * (s1.r - s0.r))}${toHex(s0.g + f * (s1.g - s0.g))}${toHex(s0.b + f * (s1.b - s0.b))}`;
    }
  }
  const last = CIVIDIS_STOPS[CIVIDIS_STOPS.length - 1]!;
  return `#${toHex(last.r)}${toHex(last.g)}${toHex(last.b)}`;
}

// ── Domain ─────────────────────────────────────────────────────────────────

/**
 * Decide which encoding the observed label values call for.
 *
 * An empty overlay is reported as `signed` so a chart with no labels yet does
 * not briefly render the ordinal ramp while the first response is in flight.
 */
export function labelDomain(values: readonly number[]): LabelDomain {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { kind: 'signed', min: -1, max: 1 };
  }
  const kind = min >= -SIGNED_LIMIT && max <= SIGNED_LIMIT ? 'signed' : 'ordinal';
  return { kind, min, max };
}

// ── Style ──────────────────────────────────────────────────────────────────

/** Marker style for `value` under the overlay's `domain`. */
export function labelMarkerStyle(value: number, domain: LabelDomain): LabelMarkerStyle {
  if (domain.kind === 'ordinal') {
    const span = domain.max - domain.min || 1;
    return {
      position: 'inBar',
      shape: 'square',
      color: cividis((value - domain.min) / span),
      size: ORDINAL_SIZE,
    };
  }

  if (value === 0) {
    return { position: 'inBar', shape: 'circle', color: ZERO_COLOR, size: SIZE_ZERO };
  }

  const strong = Math.abs(value) >= SIGNED_LIMIT;
  return value > 0
    ? {
        position: 'belowBar',
        shape: 'arrowUp',
        color: CANDLE_UP_COLOR,
        size: strong ? SIZE_STRONG : SIZE_UNIT,
      }
    : {
        position: 'aboveBar',
        shape: 'arrowDown',
        color: CANDLE_DOWN_COLOR,
        size: strong ? SIZE_STRONG : SIZE_UNIT,
      };
}
