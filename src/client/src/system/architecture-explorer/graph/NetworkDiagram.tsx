/**
 * NetworkDiagram — 2D SVG renderer for a derived ArchGraph.
 *
 * Nodes are laid out on a column (data-flow, left→right) × lane (parallel
 * branches) grid. Each node is a rounded card with a colored left accent + kind
 * chip, its label / sublabel / output shape, and an in-node param-weight bar
 * (width ∝ log₁₀ params, with the readable count). Flow edges are gentle
 * curves with the flowing tensor shape on the wire; residual edges are dashed
 * arcs bowing above the spine; context edges are dotted.
 *
 * Hover dims the rest of the graph and opens a hand-rolled SVG tooltip card
 * (drawn in screen space, so it stays crisp at any zoom). Wheel zooms around
 * the cursor (clamped 0.5–2.5), drag pans, double-click resets to fit.
 *
 * On top of the static schematic sits FlowLayer: a rAF-driven pulse travelling
 * input→output along these same edges, real tensor-shape badges on every wire,
 * the real in→out dimension change morphing at each transforming layer, and
 * attention fanning into its real n_heads lanes. Every animated quantity is
 * architecture math from derive.ts — no activations, weights or gradients are
 * simulated (see FlowLayer's header and ../flow.ts). Transport lives in
 * FlowControls; `prefers-reduced-motion` drops the motion and leaves a
 * steppable static diagram.
 *
 * Pixel geometry (node grid + the three edge bezier formulas) lives in
 * ./layout so the static renderer and the flow layer draw the same curves.
 *
 * Sizing: by default the canvas fills the height its parent hands down (the
 * component owns a `h-full min-h-0 flex-col` chain and the canvas takes the
 * slack between header and legend). Pass `height` to pin it instead. Both
 * dimensions come from `Measured`, not `@visx/responsive`'s `ParentSize` —
 * ParentSize can latch width=0 when it mounts inside a just-switched Radix
 * TabsContent under React 19 + react-compiler, which strands the canvas
 * blank forever. See ../Measured for the full story.
 *
 * House style: colors only via CSS custom-property tokens (never hardcoded
 * hex), all in-SVG text is font-mono, identity is never color-alone (every
 * node carries a text kind chip; the legend pairs each dot with a label).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Text } from '@visx/text';
import { cn } from '@/shared/utils/utils';
import { Measured } from '../Measured';
import type { ArchGraph, ArchNode, LayerKind } from './types';
import { LAYER_PALETTE } from './palette';
import {
  NH,
  NW,
  clampScale,
  contentH,
  contentW,
  cubicPath,
  edgeCubic,
  nodeX,
  nodeY,
} from './layout';
import { buildFlowPlan, type FlowPlan } from './flow';
import { FlowLayer } from './FlowLayer';
import { FlowControls, type FlowSpeed } from './FlowControls';
import { useFlowClock, usePrefersReducedMotion, type FlowClock } from './useFlowClock';

interface NetworkDiagramProps {
  graph: ArchGraph;
  /** Fixed canvas height in px. Omit to fill the available vertical space. */
  height?: number;
}

// ── token helpers ───────────────────────────────────────────────────────────
const tokenOf = (kind: LayerKind) => LAYER_PALETTE[kind].token;
const solid = (token: string) => `hsl(var(${token}))`;
const alpha = (token: string, a: number) => `hsl(var(${token}) / ${a})`;

function fmtParams(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(n);
}

function trunc(s: string | undefined, max: number): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

interface Transform {
  tx: number;
  ty: number;
  scale: number;
}

function fitTransform(g: ArchGraph, width: number, height: number): Transform {
  const cw = contentW(g);
  const ch = contentH(g);
  const scale = clampScale(Math.min(width / cw, height / ch, 1.25));
  return {
    scale,
    tx: (width - cw * scale) / 2,
    ty: (height - ch * scale) / 2,
  };
}

// ════════════════════════════════════════════════════════════════════════════

export function NetworkDiagram({ graph, height }: NetworkDiagramProps) {
  const fills = height == null;

  if (!graph || graph.nodes.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-md border border-dashed border-white/10 bg-white/[0.02] text-[11px] text-muted-foreground',
          fills && 'min-h-0 flex-1',
        )}
        style={fills ? undefined : { height }}
      >
        No architecture to render — pick a supported model.
      </div>
    );
  }

  return <Diagram graph={graph} height={height} fills={fills} />;
}

// ════════════════════════════════════════════════════════════════════════════

/**
 * The real body of NetworkDiagram. Split out so the empty-graph guard above can
 * return before any flow hook runs (hooks must not sit behind a conditional).
 */
function Diagram({
  graph,
  height,
  fills,
}: {
  graph: ArchGraph;
  height?: number;
  fills: boolean;
}) {
  const present = new Map<LayerKind, number>();
  for (const n of graph.nodes) present.set(n.kind, (present.get(n.kind) ?? 0) + 1);

  // ── flow plan + transport ─────────────────────────────────────────────────
  const graphKey = `${graph.title}|${graph.nodes.length}|${graph.columns}|${graph.totalParams}`;
  const plan = useMemo(
    () => buildFlowPlan(graph),
    // The plan is a pure function of the graph; graphKey captures identity so a
    // slider re-derive rebuilds it without rebuilding on every render.
     
    [graphKey],
  );

  const reducedMotion = usePrefersReducedMotion();
  const [playing, setPlaying] = useState(!reducedMotion);
  const [speed, setSpeed] = useState<FlowSpeed>(1);
  const [step, setStep] = useState(0);
  const [showShapes, setShowShapes] = useState(true);

  // Reduced motion never auto-plays: the diagram is static + steppable.
  useEffect(() => {
    if (reducedMotion) setPlaying(false);
  }, [reducedMotion]);

  const clock = useFlowClock({
    timelineEnd: plan.timelineEnd,
    playing: playing && !reducedMotion,
    speed,
    // Step k pins the clock to the instant column k has produced its output:
    // the edges into it have just landed and the edges out of it are departing.
    steppedP: step + 1,
    resetKey: graphKey,
  });

  return (
    <div className={cn('flex flex-col gap-2', fills && 'h-full min-h-0')}>
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-foreground">{graph.title}</div>
          {graph.subtitle && (
            <div className="truncate font-mono text-[10px] text-muted-foreground">{graph.subtitle}</div>
          )}
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
          <span>
            <span className="text-foreground">{graph.nodes.length}</span> nodes
          </span>
          <span>
            Σ params <span className="text-foreground">{fmtParams(graph.totalParams)}</span>
          </span>
        </div>
      </div>

      {/* Transport for the data-flow animation. */}
      <FlowControls
        graph={graph}
        plan={plan}
        clock={clock}
        playing={playing}
        onPlayingChange={setPlaying}
        speed={speed}
        onSpeedChange={setSpeed}
        step={step}
        onStepChange={setStep}
        showShapes={showShapes}
        onShowShapesChange={setShowShapes}
        reducedMotion={reducedMotion}
      />

      {/* Canvas — fills the slack between header and legend unless pinned. */}
      <Measured
        height={height}
        minWidth={80}
        minHeight={80}
        className={cn(
          'overflow-hidden rounded-md border border-white/10 bg-white/[0.02]',
          fills && 'min-h-0 flex-1',
        )}
      >
        {({ width, height: h }) => (
          <Canvas
            graph={graph}
            width={width}
            height={h}
            plan={plan}
            clock={clock}
            animate={!reducedMotion}
            showShapes={showShapes}
          />
        )}
      </Measured>

      {/* Legend + hint */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {[...present.entries()].map(([kind, count]) => (
            <span key={kind} className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
              <span
                className="inline-block h-2.5 w-2.5 rounded-[3px]"
                style={{ background: solid(tokenOf(kind)) }}
              />
              <span className="text-foreground/80">{LAYER_PALETTE[kind].label}</span>
              <span className="text-muted-foreground">×{count}</span>
            </span>
          ))}
        </div>
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          scroll = zoom · drag = pan · dbl-click = reset · hover = detail · ▶ = data flow
        </span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════

interface CanvasProps {
  graph: ArchGraph;
  width: number;
  height: number;
  plan: FlowPlan;
  clock: FlowClock;
  animate: boolean;
  showShapes: boolean;
}

function Canvas({ graph, width, height, plan, clock, animate, showShapes }: CanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tf, setTf] = useState<Transform>(() => fitTransform(graph, width, height));
  const [hovered, setHovered] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; y: number; dragging: boolean }>({ x: 0, y: 0, dragging: false });

  // Re-fit when the graph identity or either viewport dimension changes — the
  // canvas height is now measured, so it moves on window resize too.
  const fitKey = `${graph.title}|${graph.nodes.length}|${graph.columns}|${graph.lanes}|${Math.round(width)}|${Math.round(height)}`;
  const lastFitKey = useRef<string>('');
  useLayoutEffect(() => {
    if (lastFitKey.current !== fitKey) {
      lastFitKey.current = fitKey;
      setTf(fitTransform(graph, width, height));
    }
  }, [fitKey, graph, width, height]);

  // Wheel zoom around the cursor — native non-passive listener so we can
  // preventDefault (React's onWheel is passive and would let the page scroll).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setTf((prev) => {
        const next = clampScale(prev.scale * (1 - e.deltaY * 0.0015));
        if (next === prev.scale) return prev;
        const cx = (mx - prev.tx) / prev.scale;
        const cy = (my - prev.ty) / prev.scale;
        return { scale: next, tx: mx - cx * next, ty: my - cy * next };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY, dragging: true };
    (e.currentTarget as SVGSVGElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    dragRef.current = { x: e.clientX, y: e.clientY, dragging: true };
    setTf((prev) => ({ ...prev, tx: prev.tx + dx, ty: prev.ty + dy }));
  };
  const endDrag = () => {
    dragRef.current.dragging = false;
  };
  const onDoubleClick = () => setTf(fitTransform(graph, width, height));

  const maxParams = graph.nodes.reduce((m, n) => Math.max(m, n.params ?? 0), 0);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n] as const));

  // Paint the hovered node last so it stays on top.
  const paintOrder = [...graph.nodes].sort((a, b) =>
    a.id === hovered ? 1 : b.id === hovered ? -1 : 0,
  );

  const hoveredNode = hovered ? nodeById.get(hovered) ?? null : null;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      role="img"
      aria-label={`architecture diagram: ${graph.title}`}
      style={{ display: 'block', cursor: dragRef.current.dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={() => {
        endDrag();
        setHovered(null);
      }}
      onDoubleClick={onDoubleClick}
    >
      <defs>
        <marker id="arch-arrow-flow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 Z" fill="hsl(var(--border))" />
        </marker>
        <marker id="arch-arrow-soft" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 Z" fill="hsl(var(--muted-foreground))" />
        </marker>
      </defs>

      <g transform={`translate(${tf.tx}, ${tf.ty}) scale(${tf.scale})`}>
        {/* Edges under nodes */}
        {graph.edges.map((e, i) => {
          const s = nodeById.get(e.from);
          const d = nodeById.get(e.to);
          if (!s || !d) return null;
          const dim = hovered != null && e.from !== hovered && e.to !== hovered;
          return (
            <EdgePath
              key={`${e.from}->${e.to}-${e.kind}-${i}`}
              sx={nodeX(s.column) + NW}
              sy={nodeY(s.lane) + NH / 2}
              dx={nodeX(d.column)}
              dy={nodeY(d.lane) + NH / 2}
              kind={e.kind}
              // With shape badges on, FlowLayer owns every wire label (it draws
              // the real flowing shape). Leaving this on would double-draw.
              label={showShapes ? undefined : e.label}
              dim={dim}
            />
          );
        })}

        {/* Animated data flow — sits between the wires and the cards so the
            pulse reads as travelling along the edges, under the node cards. */}
        <FlowLayer
          graph={graph}
          plan={plan}
          clock={clock}
          hovered={hovered}
          animate={animate}
          showShapes={showShapes}
        />

        {/* Nodes */}
        {paintOrder.map((n) => (
          <NodeCard
            key={n.id}
            node={n}
            x={nodeX(n.column)}
            y={nodeY(n.lane)}
            maxParams={maxParams}
            dim={hovered != null && hovered !== n.id}
            onEnter={() => setHovered(n.id)}
            onLeave={() => setHovered(null)}
          />
        ))}
      </g>

      {/* Tooltip in screen space (not scaled) */}
      {hoveredNode && (
        <Tooltip
          node={hoveredNode}
          screenX={tf.tx + (nodeX(hoveredNode.column) + NW) * tf.scale}
          screenLeft={tf.tx + nodeX(hoveredNode.column) * tf.scale}
          screenY={tf.ty + nodeY(hoveredNode.lane) * tf.scale}
          viewW={width}
          viewH={height}
        />
      )}
    </svg>
  );
}

// ── edge ─────────────────────────────────────────────────────────────────────

interface EdgeProps {
  sx: number;
  sy: number;
  dx: number;
  dy: number;
  kind: 'flow' | 'residual' | 'context';
  label?: string;
  dim: boolean;
}

function EdgePath({ sx, sy, dx, dy, kind, label, dim }: EdgeProps) {
  const opacity = dim ? 0.12 : 1;
  // Geometry is shared with FlowLayer so particles ride exactly this stroke.
  const path = cubicPath(edgeCubic(sx, sy, dx, dy, kind));
  let stroke: string;
  let dash: string | undefined;
  let marker: string;

  if (kind === 'residual') {
    stroke = 'hsl(var(--muted-foreground))';
    dash = '4 3';
    marker = 'url(#arch-arrow-soft)';
  } else if (kind === 'context') {
    stroke = 'hsl(var(--muted-foreground))';
    dash = '1 4';
    marker = 'url(#arch-arrow-soft)';
  } else {
    stroke = 'hsl(var(--border))';
    marker = 'url(#arch-arrow-flow)';
  }

  const midX = (sx + dx) / 2;
  const midY = kind === 'residual' ? Math.min(sy, dy) - 30 : (sy + dy) / 2 - 4;

  return (
    <g style={{ opacity }}>
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={kind === 'flow' ? 1.4 : 1.2}
        strokeDasharray={dash}
        markerEnd={marker}
      />
      {label && (
        <g>
          <rect
            x={midX - label.length * 3.1 - 3}
            y={midY - 8}
            width={label.length * 6.2 + 6}
            height={12}
            rx={2}
            fill="hsl(var(--background))"
            opacity={0.85}
          />
          <text
            x={midX}
            y={midY + 1}
            fontSize={8.5}
            fill="hsl(var(--muted-foreground))"
            fontFamily="var(--font-mono)"
            textAnchor="middle"
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

// ── node ─────────────────────────────────────────────────────────────────────

interface NodeCardProps {
  node: ArchNode;
  x: number;
  y: number;
  maxParams: number;
  dim: boolean;
  onEnter: () => void;
  onLeave: () => void;
}

function NodeCard({ node, x, y, maxParams, dim, onEnter, onLeave }: NodeCardProps) {
  const token = tokenOf(node.kind);
  const kindLabel = LAYER_PALETTE[node.kind].label;
  const params = node.params ?? 0;
  const hasBar = params > 0 && maxParams > 0;
  const barFrac = hasBar ? Math.log10(params + 1) / Math.log10(maxParams + 1) : 0;
  const barW = Math.max(4, barFrac * (NW - 60));
  const shapeLine = node.outShape ? `→ ${node.outShape}` : node.inShape ?? '';

  return (
    <g
      style={{ opacity: dim ? 0.35 : 1, cursor: 'pointer' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {/* enlarged transparent hit target */}
      <rect x={x - 8} y={y - 8} width={NW + 16} height={NH + 16} fill="transparent" pointerEvents="all" />

      {/* card */}
      <g pointerEvents="none">
        <rect
          x={x}
          y={y}
          width={NW}
          height={NH}
          rx={6}
          fill={alpha(token, 0.08)}
          stroke={alpha(token, 0.45)}
          strokeWidth={1}
        />
        {/* left accent bar */}
        <rect x={x} y={y + 1} width={3} height={NH - 2} rx={1.5} fill={solid(token)} />

        {/* kind chip */}
        <circle cx={x + 15} cy={y + 13} r={3.2} fill={solid(token)} />
        <text
          x={x + 23}
          y={y + 16}
          fontSize={8.5}
          fill="hsl(var(--muted-foreground))"
          fontFamily="var(--font-mono)"
          letterSpacing="0.06em"
        >
          {kindLabel.toUpperCase()}
        </text>

        {/* title */}
        <text
          x={x + 13}
          y={y + 32}
          fontSize={11}
          fontWeight={600}
          fill="hsl(var(--foreground))"
          fontFamily="var(--font-mono)"
        >
          {trunc(node.label, 22)}
        </text>

        {/* sublabel */}
        {node.sublabel && (
          <text
            x={x + 13}
            y={y + 44}
            fontSize={9}
            fill="hsl(var(--muted-foreground))"
            fontFamily="var(--font-mono)"
          >
            {trunc(node.sublabel, 26)}
          </text>
        )}

        {/* output shape */}
        {shapeLine && (
          <text
            x={x + 13}
            y={y + 56}
            fontSize={8.5}
            fill="hsl(var(--muted-foreground))"
            fontFamily="var(--font-mono)"
          >
            {trunc(shapeLine, 27)}
          </text>
        )}

        {/* param-weight bar */}
        {hasBar && (
          <>
            <rect x={x + 13} y={y + 62} width={NW - 26} height={3} rx={1.5} fill={alpha(token, 0.12)} />
            <rect x={x + 13} y={y + 62} width={barW} height={3} rx={1.5} fill={solid(token)} />
            <text
              x={x + NW - 9}
              y={y + 67}
              fontSize={8}
              fill="hsl(var(--muted-foreground))"
              fontFamily="var(--font-mono)"
              textAnchor="end"
            >
              {fmtParams(params)}
            </text>
          </>
        )}
      </g>
    </g>
  );
}

// ── tooltip (screen space) ────────────────────────────────────────────────────

interface TooltipProps {
  node: ArchNode;
  screenX: number;
  screenLeft: number;
  screenY: number;
  viewW: number;
  viewH: number;
}

const TIP_W = 244;

function Tooltip({ node, screenX, screenLeft, screenY, viewW, viewH }: TooltipProps) {
  const detailRows = node.detail ? Object.entries(node.detail) : [];
  const params = node.params ?? 0;
  const shapeLine = node.inShape || node.outShape ? `${node.inShape ?? '—'}  →  ${node.outShape ?? '—'}` : '';

  // Height budget.
  const headerH = 20 + (params > 0 ? 13 : 0) + (shapeLine ? 13 : 0) + 8;
  const rowsH = detailRows.length * 13;
  const analogyLines = node.analogy ? Math.ceil(node.analogy.length / 40) : 0;
  const analogyH = node.analogy ? analogyLines * 12 + 10 : 0;
  const tipH = 12 + headerH + rowsH + analogyH + 10;

  // Prefer right of the node; fall back to left; clamp inside the viewport.
  let tx = screenX + 12;
  if (tx + TIP_W > viewW - 6) tx = screenLeft - TIP_W - 12;
  tx = Math.max(6, Math.min(tx, viewW - TIP_W - 6));
  const ty = Math.max(6, Math.min(screenY, viewH - tipH - 6));

  const token = tokenOf(node.kind);

  return (
    <g pointerEvents="none">
      <rect
        x={tx}
        y={ty}
        width={TIP_W}
        height={tipH}
        rx={5}
        fill="hsl(var(--popover))"
        stroke="hsl(var(--border))"
        strokeWidth={1}
      />
      {/* header: kind dot + label */}
      <circle cx={tx + 13} cy={ty + 14} r={3.4} fill={solid(token)} />
      <text
        x={tx + 22}
        y={ty + 17}
        fontSize={11}
        fontWeight={600}
        fill="hsl(var(--foreground))"
        fontFamily="var(--font-mono)"
      >
        {trunc(node.label, 26)}
      </text>
      <text
        x={tx + 13}
        y={ty + 30}
        fontSize={9}
        fill="hsl(var(--muted-foreground))"
        fontFamily="var(--font-mono)"
      >
        {LAYER_PALETTE[node.kind].label}
        {params > 0 ? ` · ${fmtParams(params)} params` : ''}
      </text>

      {shapeLine && (
        <text
          x={tx + 13}
          y={ty + 43}
          fontSize={8.5}
          fill="hsl(var(--foreground))"
          fontFamily="var(--font-mono)"
        >
          {trunc(shapeLine, 34)}
        </text>
      )}

      {/* detail rows */}
      {detailRows.map(([k, v], i) => {
        const rowY = ty + headerH + 6 + i * 13;
        return (
          <g key={k}>
            <text
              x={tx + 13}
              y={rowY}
              fontSize={8.5}
              fill="hsl(var(--muted-foreground))"
              fontFamily="var(--font-mono)"
            >
              {trunc(k, 18)}
            </text>
            <text
              x={tx + TIP_W - 13}
              y={rowY}
              fontSize={8.5}
              fill="hsl(var(--foreground))"
              fontFamily="var(--font-mono)"
              textAnchor="end"
            >
              {trunc(String(v), 20)}
            </text>
          </g>
        );
      })}

      {/* analogy (wrapped) */}
      {node.analogy && (
        <Text
          x={tx + 13}
          y={ty + headerH + 6 + rowsH + 6}
          width={TIP_W - 26}
          verticalAnchor="start"
          fontSize={9}
          fontStyle="italic"
          fill="hsl(var(--muted-foreground))"
          fontFamily="var(--font-mono)"
          lineHeight={12}
        >
          {node.analogy}
        </Text>
      )}
    </g>
  );
}
