/**
 * Label overlay marker encoding.
 *
 * The chart used to map `1` to an up arrow, `-1` to a down arrow, and
 * EVERYTHING ELSE to one identical neutral circle. Measured against the live
 * generators on MNQ 1H that silently destroyed most of the overlay:
 *
 *   range_bucket         1474/1483 rows (99%) -> one indistinct dot
 *   signal               1064/1493 rows (71%)
 *   volatility_adaptive   832/1492 rows (56%)
 *   structural            766/1498 rows (51%)  <- +2 and -2 drew the SAME glyph
 *   triple_barrier        233/1332 rows (17%)
 *
 * A break-of-structure up and a break-of-structure down are opposite events;
 * rendering both as the same pink dot is the defect these tests pin down.
 */

import { describe, it, expect } from 'vitest';
import {
  labelDomain,
  labelMarkerStyle,
  cividis,
} from '@/market/components/labelMarkerStyle';

describe('labelDomain', () => {
  it('classifies a signed vocabulary when every value fits in [-2, 2]', () => {
    expect(labelDomain([-1, 0, 1]).kind).toBe('signed');
    expect(labelDomain([-2, -1, 0, 1, 2]).kind).toBe('signed');
    expect(labelDomain([-1, 1]).kind).toBe('signed');
  });

  it('classifies an ordinal vocabulary once values run past ±2', () => {
    const d = labelDomain([0, 1, 2, 3]);
    expect(d.kind).toBe('ordinal');
    expect(labelDomain(Array.from({ length: 21 }, (_, i) => i)).kind).toBe('ordinal');
  });

  it('reports the ordinal bounds so the ramp can be normalised', () => {
    const d = labelDomain([0, 5, 20]);
    expect(d.min).toBe(0);
    expect(d.max).toBe(20);
  });

  it('treats an empty or all-null overlay as signed rather than throwing', () => {
    expect(labelDomain([]).kind).toBe('signed');
  });
});

describe('labelMarkerStyle — signed vocabulary', () => {
  const signed = labelDomain([-2, -1, 0, 1, 2]);

  it('draws +1 below the bar as an up arrow', () => {
    const s = labelMarkerStyle(1, signed);
    expect(s.shape).toBe('arrowUp');
    expect(s.position).toBe('belowBar');
  });

  it('draws -1 above the bar as a down arrow', () => {
    const s = labelMarkerStyle(-1, signed);
    expect(s.shape).toBe('arrowDown');
    expect(s.position).toBe('aboveBar');
  });

  it('keeps the arrow direction at magnitude 2 instead of falling back to a dot', () => {
    expect(labelMarkerStyle(2, signed).shape).toBe('arrowUp');
    expect(labelMarkerStyle(-2, signed).shape).toBe('arrowDown');
  });

  it('encodes magnitude as size, so ±2 is visibly stronger than ±1', () => {
    expect(labelMarkerStyle(2, signed).size).toBeGreaterThan(labelMarkerStyle(1, signed).size);
    expect(labelMarkerStyle(-2, signed).size).toBeGreaterThan(labelMarkerStyle(-1, signed).size);
  });

  // The exact regression: structural's +2 and -2 were both a neutral circle.
  it('never renders +2 and -2 identically', () => {
    expect(labelMarkerStyle(2, signed)).not.toEqual(labelMarkerStyle(-2, signed));
  });

  it('gives 0 its own recessive glyph, distinct from every signed value', () => {
    const zero = labelMarkerStyle(0, signed);
    expect(zero.shape).toBe('circle');
    expect(zero.position).toBe('inBar');
    expect(zero.size).toBeLessThan(labelMarkerStyle(1, signed).size);
    for (const v of [-2, -1, 1, 2]) {
      expect(zero).not.toEqual(labelMarkerStyle(v, signed));
    }
  });

  it('assigns every value in the vocabulary a unique style', () => {
    const seen = new Set([-2, -1, 0, 1, 2].map(v => JSON.stringify(labelMarkerStyle(v, signed))));
    expect(seen.size).toBe(5);
  });

  it('uses the up hue for positive and the down hue for negative', () => {
    expect(labelMarkerStyle(1, signed).color).toBe(labelMarkerStyle(2, signed).color);
    expect(labelMarkerStyle(-1, signed).color).toBe(labelMarkerStyle(-2, signed).color);
    expect(labelMarkerStyle(1, signed).color).not.toBe(labelMarkerStyle(-1, signed).color);
  });
});

describe('labelMarkerStyle — ordinal vocabulary', () => {
  const buckets = Array.from({ length: 21 }, (_, i) => i);
  const ordinal = labelDomain(buckets);

  it('does not collapse 21 buckets onto one colour', () => {
    const colors = new Set(buckets.map(v => labelMarkerStyle(v, ordinal).color));
    expect(colors.size).toBe(21);
  });

  it('separates the extremes of the ramp', () => {
    expect(labelMarkerStyle(0, ordinal).color).not.toBe(labelMarkerStyle(20, ordinal).color);
  });

  it('keeps ordinal markers on the bar so the ramp reads as a band', () => {
    expect(labelMarkerStyle(10, ordinal).position).toBe('inBar');
    expect(labelMarkerStyle(10, ordinal).shape).toBe('square');
  });
});

describe('cividis', () => {
  it('is clamped outside [0, 1]', () => {
    expect(cividis(-5)).toBe(cividis(0));
    expect(cividis(9)).toBe(cividis(1));
  });

  it('returns hex colours', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(cividis(t)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  /**
   * Cividis is blue -> yellow by construction, which is exactly the axis
   * deuteranopia preserves. Blue channel falls and red rises across the ramp;
   * that monotonicity is what keeps the buckets ordered for Tyler.
   */
  it('runs monotonically from dark blue to bright yellow', () => {
    const red = (h: string) => parseInt(h.slice(1, 3), 16);
    const blue = (h: string) => parseInt(h.slice(5, 7), 16);
    expect(red(cividis(1))).toBeGreaterThan(red(cividis(0)));
    expect(blue(cividis(0))).toBeGreaterThan(blue(cividis(1)));
  });
});
