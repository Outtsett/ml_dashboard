/**
 * Shared pixel geometry for the architecture graph.
 *
 * Extracted from NetworkDiagram so the static renderer and the animated flow
 * layer draw against the SAME coordinates and the SAME bezier control points —
 * a particle riding an edge must sit exactly on the stroke the renderer paints,
 * so both sides have to agree on the curve, not just approximate it.
 *
 * `edgeCubic` reproduces the three historical path formulas byte-for-byte
 * (flow / residual / context); `cubicPath` re-emits the same `d` string the
 * renderer used to build inline, and `cubicAt` evaluates the identical curve
 * analytically (no getPointAtLength round-trip per frame).
 */

import type { ArchEdge, ArchGraph } from './types';

// ── layout geometry (content coordinates) ───────────────────────────────────
export const NW = 156;
export const NH = 74;
export const COL_GAP = 76;
export const LANE_GAP = 46;
export const PAD = 26;

export const nodeX = (col: number) => PAD + col * (NW + COL_GAP);
export const nodeY = (lane: number) => PAD + lane * (NH + LANE_GAP);
export const contentW = (g: ArchGraph) => PAD * 2 + g.columns * NW + (g.columns - 1) * COL_GAP;
export const contentH = (g: ArchGraph) => PAD * 2 + g.lanes * NH + (g.lanes - 1) * LANE_GAP;

// 0.3, not 0.5: a 12-column catalog blueprint is 2,760 units wide, so a 0.5
// floor left the fit wider than the page and clipped the first and last cards.
export const MIN_SCALE = 0.3;
export const MAX_SCALE = 2.5;
export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

// ── bezier geometry ─────────────────────────────────────────────────────────

export type Pt = readonly [number, number];

/** Cubic bezier control polygon for one edge. */
export interface Cubic {
  p0: Pt;
  p1: Pt;
  p2: Pt;
  p3: Pt;
}

/**
 * Control points for an edge of the given kind between two anchor points.
 * These formulas are the originals from NetworkDiagram's EdgePath — changing
 * them changes the drawn graph, not just the animation.
 */
export function edgeCubic(
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  kind: ArchEdge['kind'],
): Cubic {
  if (kind === 'residual') {
    // Dashed arc bowing above the spine.
    const top = Math.min(sy, dy) - 34;
    const c1x = sx + (dx - sx) * 0.25;
    const c2x = sx + (dx - sx) * 0.75;
    return { p0: [sx, sy], p1: [c1x, top], p2: [c2x, top], p3: [dx, dy] };
  }
  if (kind === 'context') {
    const k = Math.max(24, (dx - sx) * 0.4);
    return { p0: [sx, sy], p1: [sx + k, sy], p2: [dx - k, dy], p3: [dx, dy] };
  }
  const k = Math.max(20, (dx - sx) * 0.42);
  return { p0: [sx, sy], p1: [sx + k, sy], p2: [dx - k, dy], p3: [dx, dy] };
}

/** SVG path `d` for a cubic — identical output to the previous inline strings. */
export function cubicPath(c: Cubic): string {
  return `M ${c.p0[0]},${c.p0[1]} C ${c.p1[0]},${c.p1[1]} ${c.p2[0]},${c.p2[1]} ${c.p3[0]},${c.p3[1]}`;
}

/** Evaluate the cubic at parameter t ∈ [0,1] (de Casteljau, expanded). */
export function cubicAt(c: Cubic, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const cc = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * c.p0[0] + b * c.p1[0] + cc * c.p2[0] + d * c.p3[0],
    a * c.p0[1] + b * c.p1[1] + cc * c.p2[1] + d * c.p3[1],
  ];
}

/**
 * Bezier through the node's horizontal mid-line, bowing to `bow` px of vertical
 * offset at the middle — one attention head lane.
 */
export function headLaneCubic(x: number, y: number, bow: number): Cubic {
  const midY = y + NH / 2;
  const ctrlY = midY + bow * 1.32; // overshoot so the visual apex lands on `bow`
  return {
    p0: [x, midY],
    p1: [x + NW * 0.3, ctrlY],
    p2: [x + NW * 0.7, ctrlY],
    p3: [x + NW, midY],
  };
}
