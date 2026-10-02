/**
 * FlowLayer — the animated data-flow overlay drawn on top of the static graph.
 *
 * ═══ WHAT IS ANIMATED ════════════════════════════════════════════════════════
 * Only architecture facts, all of them computed by derive.ts from real model
 * source and scheduled by flow.ts:
 *
 *   - a pulse riding each edge from the input node to the output node, on the
 *     exact bezier the renderer paints (shared `edgeCubic`), with residual
 *     arcs departing/arriving alongside the hops they skip past
 *   - the real tensor shape on each wire ([B, T, D] straight off `outShape`)
 *   - the real in→out dimension change at each transforming layer, morphed
 *     between two real derived endpoints as the pulse passes through
 *   - attention fanning into `n_heads` real lanes and re-merging, each lane
 *     labelled with the real head index and `d_head = d_model / n_heads`
 *
 * NOTHING here is an activation, an attention weight, a gradient or a logit.
 * There is no trained model and no recorded forward pass in play, so no such
 * value is invented, sampled, or randomised anywhere in this file. The one
 * interpolated quantity is a shape morph's intermediate frame, which is a
 * visual transition between two real dimensions (see flow.ts `tweenShape`).
 *
 * ═══ WHY IT DOESN'T THRASH ═══════════════════════════════════════════════════
 * This component renders only when its props change (hover / toggles), never
 * per frame. The clock hands every frame to one subscriber that writes SVG
 * attributes through refs, so 16 head lanes plus every edge and badge on screen
 * cost zero React renders per frame.
 *
 * House style: colors only via CSS custom-property tokens, never hardcoded hex.
 * Nothing is encoded in color alone — the pulse is one single token for all
 * edges (edge kind is carried by dash pattern + badge text), head lanes are
 * text-labelled h0…hN, and the active layer gets a written ACTIVE chip.
 */

import { useEffect, useRef } from 'react';
import type { ArchGraph, ArchNode } from './types';
import { LAYER_PALETTE } from './palette';
import {
  NH,
  NW,
  cubicAt,
  cubicPath,
  edgeCubic,
  headLaneCubic,
  nodeX,
  nodeY,
  type Cubic,
} from './layout';
import {
  renderShape,
  tweenShape,
  type FlowPlan,
  type HeadSplit,
  type ShapeTransform,
} from './flow';
import type { FlowClock } from './useFlowClock';

const solid = (token: string) => `hsl(var(${token}))`;
const alpha = (token: string, a: number) => `hsl(var(${token}) / ${a})`;

/** One consistent identity for "data in flight" — never per-kind, never meaning-bearing. */
const PULSE_TOKEN = '--primary';
/** Comet tail sample offsets, in edge-fraction behind the head. */
const TAIL = [0, -0.06, -0.12] as const;
/** Vertical half-spread of the head fan, in px. */
const FAN_SPREAD = 30;
/** Below this per-lane spacing (px) individual lane labels stop being legible. */
const LANE_LABEL_MIN_GAP = 9;
/** Fraction of a node's compute window spent staggering its head lanes in. */
const LANE_STAGGER_WINDOW = 0.3;

interface FlowLayerProps {
  graph: ArchGraph;
  plan: FlowPlan;
  clock: FlowClock;
  /** Node id currently hovered — dims everything unrelated, as the base graph does. */
  hovered: string | null;
  /** False when reduced motion is on: no comet, no morph — static shapes only. */
  animate: boolean;
  /** Whether tensor-shape badges are shown on the wires. */
  showShapes: boolean;
}

/** Per-edge mutable handles, keyed by FlowEdgePlan.key. */
interface EdgeHandles {
  cubic: Cubic;
  reveal: SVGPathElement | null;
  dots: (SVGCircleElement | null)[];
  departAt: number;
  arriveAt: number;
}

export function FlowLayer({ graph, plan, clock, hovered, animate, showShapes }: FlowLayerProps) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));

  const edgeRefs = useRef<Map<string, EdgeHandles>>(new Map());
  const ringRefs = useRef<Map<string, SVGGElement | null>>(new Map());
  const chipRefs = useRef<Map<string, SVGTextElement | null>>(new Map());
  const laneRefs = useRef<Map<string, (SVGPathElement | null)[]>>(new Map());

  // ── the single per-frame writer ───────────────────────────────────────────
  // Deps deliberately exclude `hovered`: hover is a pure render concern (group
  // opacity), so it must not tear down and re-subscribe the clock.
  useEffect(() => {
    const edges = edgeRefs.current;
    const rings = ringRefs.current;
    const chips = chipRefs.current;
    const lanes = laneRefs.current;
    const nodes = new Map(graph.nodes.map((n) => [n.id, n] as const));

    return clock.subscribe((p) => {
      // Edges: reveal the wire up to the wavefront, park the comet on it.
      for (const h of edges.values()) {
        const span = h.arriveAt - h.departAt;
        const u = span > 0 ? (p - h.departAt) / span : p >= h.arriveAt ? 1 : 0;
        const clamped = Math.min(1, Math.max(0, u));
        if (h.reveal) {
          h.reveal.setAttribute('stroke-dasharray', `${clamped} 1`);
          h.reveal.setAttribute('opacity', u < 0 ? '0' : '1');
        }
        for (let i = 0; i < h.dots.length; i += 1) {
          const dot = h.dots[i];
          if (!dot) continue;
          const t = clamped + (TAIL[i] ?? 0);
          // Only the in-transit window carries a comet; a delivered edge keeps
          // its lit wire but drops the head so the graph doesn't fill with dots.
          const live = u >= 0 && u <= 1 && t >= 0 && t <= 1;
          if (!live) {
            dot.setAttribute('opacity', '0');
            continue;
          }
          const [px, py] = cubicAt(h.cubic, t);
          dot.setAttribute('cx', String(px));
          dot.setAttribute('cy', String(py));
          dot.setAttribute('opacity', String(i === 0 ? 0.95 : i === 1 ? 0.5 : 0.25));
        }
      }

      // Active-layer rings.
      for (const [id, el] of rings) {
        if (!el) continue;
        const node = nodes.get(id);
        if (!node) continue;
        el.setAttribute('opacity', p >= node.column && p < node.column + 1 ? '1' : '0');
      }

      // Shape-transform chips — morph between two real derived dimensions.
      for (const t of plan.transforms) {
        const el = chips.get(t.nodeId);
        if (!el) continue;
        const live = p >= t.column && p < t.column + 1;
        const u = Math.min(1, Math.max(0, p - t.column));
        const from = animate && live ? tweenShape(t, u) : t.from;
        el.textContent = `${renderShape(from)} → ${renderShape(t.to)}`;
        el.setAttribute('opacity', live ? '1' : '0.55');
      }

      // Attention head lanes — reveal each lane as the pulse crosses the node.
      for (const h of plan.heads) {
        const arr = lanes.get(h.nodeId);
        if (!arr) continue;
        const u = Math.min(1, Math.max(0, p - h.column));
        const stagger = h.nHeads > 1 ? LANE_STAGGER_WINDOW / (h.nHeads - 1) : 0;
        for (let i = 0; i < arr.length; i += 1) {
          const el = arr[i];
          if (!el) continue;
          const laneU = animate
            ? Math.min(1, Math.max(0, (u - i * stagger) / (1 - LANE_STAGGER_WINDOW)))
            : 1;
          el.setAttribute('stroke-dasharray', `${laneU} 1`);
        }
      }
    });
  }, [clock, plan, animate, graph]);

  return (
    <g pointerEvents="none" data-testid="arch-flow-layer">
      {/* ── head fans sit under the wires ─────────────────────────────────── */}
      {plan.heads.map((h) => {
        const node = byId.get(h.nodeId);
        if (!node) return null;
        return (
          <HeadFan
            key={`fan-${h.nodeId}`}
            split={h}
            node={node}
            dim={hovered != null && hovered !== h.nodeId}
            registerLane={(i, el) => {
              const arr = laneRefs.current.get(h.nodeId) ?? [];
              arr[i] = el;
              laneRefs.current.set(h.nodeId, arr);
            }}
          />
        );
      })}

      {/* ── per-edge reveal + comet ───────────────────────────────────────── */}
      {plan.edges.map((e) => {
        const s = byId.get(e.from);
        const d = byId.get(e.to);
        if (!s || !d) return null;
        const cubic = edgeCubic(
          nodeX(s.column) + NW,
          nodeY(s.lane) + NH / 2,
          nodeX(d.column),
          nodeY(d.lane) + NH / 2,
          e.kind,
        );
        const dim = hovered != null && e.from !== hovered && e.to !== hovered;
        const handle: EdgeHandles = edgeRefs.current.get(e.key) ?? {
          cubic,
          reveal: null,
          dots: [],
          departAt: e.departAt,
          arriveAt: e.arriveAt,
        };
        handle.cubic = cubic;
        handle.departAt = e.departAt;
        handle.arriveAt = e.arriveAt;
        edgeRefs.current.set(e.key, handle);

        return (
          <g key={`flow-${e.key}`} opacity={dim ? 0.1 : 1}>
            <path
              ref={(el) => {
                handle.reveal = el;
              }}
              d={cubicPath(cubic)}
              fill="none"
              stroke={solid(PULSE_TOKEN)}
              strokeWidth={e.kind === 'flow' ? 1.8 : 1.4}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="0 1"
              opacity={0}
            />
            {animate &&
              TAIL.map((_t, i) => (
                <circle
                  key={i}
                  ref={(el) => {
                    handle.dots[i] = el;
                  }}
                  r={i === 0 ? 3 : 3 - i * 0.7}
                  fill={solid(PULSE_TOKEN)}
                  opacity={0}
                />
              ))}
          </g>
        );
      })}

      {/* ── wire shape badges ─────────────────────────────────────────────── */}
      {showShapes &&
        plan.edges.map((e) => {
          const s = byId.get(e.from);
          const d = byId.get(e.to);
          if (!s || !d || !e.badge) return null;
          const dim = hovered != null && e.from !== hovered && e.to !== hovered;
          const sx = nodeX(s.column) + NW;
          const sy = nodeY(s.lane) + NH / 2;
          const dx = nodeX(d.column);
          const dy = nodeY(d.lane) + NH / 2;
          const midY = e.kind === 'residual' ? Math.min(sy, dy) - 30 : (sy + dy) / 2 - 4;
          return (
            <ShapeBadge
              key={`badge-${e.key}`}
              x={(sx + dx) / 2}
              y={midY}
              text={e.badge}
              dim={dim}
            />
          );
        })}

      {/* ── active-layer rings ────────────────────────────────────────────── */}
      {graph.nodes.map((n) => (
        <g
          key={`ring-${n.id}`}
          ref={(el) => {
            ringRefs.current.set(n.id, el);
          }}
          opacity={0}
        >
          <rect
            x={nodeX(n.column) - 4}
            y={nodeY(n.lane) - 4}
            width={NW + 8}
            height={NH + 8}
            rx={8}
            fill="none"
            stroke={solid(PULSE_TOKEN)}
            strokeWidth={1.6}
          />
          <rect
            x={nodeX(n.column) + NW - 46}
            y={nodeY(n.lane) - 12}
            width={46}
            height={11}
            rx={2}
            fill={alpha(PULSE_TOKEN, 0.9)}
          />
          <text
            x={nodeX(n.column) + NW - 23}
            y={nodeY(n.lane) - 3.5}
            fontSize={7}
            letterSpacing="0.08em"
            fill="hsl(var(--primary-foreground))"
            fontFamily="var(--font-mono)"
            textAnchor="middle"
          >
            ▶ ACTIVE
          </text>
        </g>
      ))}

      {/* ── shape-transform chips ─────────────────────────────────────────── */}
      {plan.transforms.map((t) => (
        <TransformChip
          key={`xf-${t.nodeId}`}
          transform={t}
          dim={hovered != null && hovered !== t.nodeId}
          register={(el) => {
            chipRefs.current.set(t.nodeId, el);
          }}
        />
      ))}
    </g>
  );
}

// ── head fan ────────────────────────────────────────────────────────────────

interface HeadFanProps {
  split: HeadSplit;
  node: ArchNode;
  dim: boolean;
  registerLane: (i: number, el: SVGPathElement | null) => void;
}

/**
 * `n_heads` real parallel lanes bowing out of the attention node's mid-line and
 * re-merging at its right edge. Lane count IS the derived n_heads — moving the
 * slider from 1 to 16 adds lanes one for one.
 */
function HeadFan({ split, node, dim, registerLane }: HeadFanProps) {
  const x = nodeX(node.column);
  const y = nodeY(node.lane);
  const token = LAYER_PALETTE.attention.token;
  const n = split.nHeads;
  const gap = n > 1 ? (FAN_SPREAD * 2) / (n - 1) : 0;
  const labelPerLane = n > 1 && gap >= LANE_LABEL_MIN_GAP;

  return (
    <g opacity={dim ? 0.12 : 1}>
      {Array.from({ length: n }, (_v, i) => {
        const bow = n === 1 ? 0 : -FAN_SPREAD + i * gap;
        const cubic = headLaneCubic(x, y, bow);
        const [lx, ly] = cubicAt(cubic, 0.5);
        return (
          <g key={i}>
            <path
              ref={(el) => registerLane(i, el)}
              d={cubicPath(cubic)}
              fill="none"
              stroke={solid(token)}
              strokeWidth={1}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="1 1"
              opacity={0.65}
            />
            {labelPerLane && (
              <text
                x={lx}
                y={ly - 2}
                fontSize={6.5}
                fill="hsl(var(--muted-foreground))"
                fontFamily="var(--font-mono)"
                textAnchor="middle"
              >
                {`h${i}·${split.dHead}`}
              </text>
            )}
          </g>
        );
      })}

      {/* Always-on textual identity for the split — never color-alone, and the
          only legible carrier of d_head once the lanes get dense. */}
      <text
        x={x + NW / 2}
        y={y - FAN_SPREAD - 8}
        fontSize={7.5}
        fill="hsl(var(--foreground))"
        fontFamily="var(--font-mono)"
        textAnchor="middle"
      >
        {`${n} heads · d_head = ${split.dModel}/${n} = ${split.dHead}${
          split.remainder > 0 ? ` (+${split.remainder} rem)` : ''
        }`}
      </text>
    </g>
  );
}

// ── shape badge ─────────────────────────────────────────────────────────────

function ShapeBadge({ x, y, text, dim }: { x: number; y: number; text: string; dim: boolean }) {
  const w = text.length * 5.4 + 6;
  return (
    <g opacity={dim ? 0.12 : 1}>
      <rect
        x={x - w / 2}
        y={y - 8}
        width={w}
        height={12}
        rx={2}
        fill="hsl(var(--background))"
        opacity={0.88}
      />
      <text
        x={x}
        y={y + 1}
        fontSize={7.5}
        fill="hsl(var(--muted-foreground))"
        fontFamily="var(--font-mono)"
        textAnchor="middle"
      >
        {text}
      </text>
    </g>
  );
}

// ── transform chip ──────────────────────────────────────────────────────────

interface TransformChipProps {
  transform: ShapeTransform;
  dim: boolean;
  register: (el: SVGTextElement | null) => void;
}

/**
 * The in→out dimension change for one layer, parked under its card.
 * Idle it reads the two real derived shapes. While the pulse is inside the
 * node, the left-hand shape morphs toward the right-hand one — a transition
 * between two real endpoints, not a sampled tensor.
 */
function TransformChip({ transform, dim, register }: TransformChipProps) {
  const x = nodeX(transform.column) + NW / 2;
  const y = nodeY(transform.lane) + NH + 11;
  const idle = `${renderShape(transform.from)} → ${renderShape(transform.to)}`;
  const w = Math.max(idle.length, 14) * 4.6 + 8;

  return (
    <g opacity={dim ? 0.12 : 1}>
      <rect
        x={x - w / 2}
        y={y - 8}
        width={w}
        height={11}
        rx={2}
        fill="hsl(var(--background))"
        stroke={alpha('--data-cat-4', 0.5)}
        strokeWidth={0.75}
        opacity={0.95}
      />
      <text
        ref={register}
        x={x}
        y={y}
        fontSize={7}
        fill="hsl(var(--foreground))"
        fontFamily="var(--font-mono)"
        textAnchor="middle"
        opacity={0.55}
      >
        {idle}
      </text>
    </g>
  );
}
