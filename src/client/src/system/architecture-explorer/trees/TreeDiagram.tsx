/**
 * TreeDiagram — single-xgboost-tree renderer (raw dump nodes → tidy tree).
 *
 * d3-hierarchy does the MATH (tidy top-down layout); React renders every SVG
 * element. Wide trees scale-to-fit with a floor, then wheel-zoom + drag-pan
 * take over (double-click resets, zoom clamped 0.5–3×).
 *
 * Deuteranopia rules honored throughout: leaf polarity is carried by the
 * signed value text (always visible) with diverging tokens as reinforcement;
 * yes/no branches are differentiated by "<" / "≥" glyphs at the fork, never
 * by color; gain shading is a discrete 5-stop opacity scale with the exact
 * gain surfaced as text in the hover tooltip.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Measured } from "../Measured";
import { Group } from "@visx/group";
import {
  hierarchy,
  tree as d3tree,
  type HierarchyPointNode,
} from "d3-hierarchy";
import { cn } from "@/shared/utils/utils";
import {
  type XgbTreeNode,
  countDescendants,
  coverFraction,
  decisionPath,
  flattenTree,
  formatLeafValue,
  formatThreshold,
  gainFillOpacity,
  leafValueToken,
  resolveFeature,
} from "./types";

export interface TreeDiagramProps {
  /** Raw xgboost dump node (root of one tree). */
  tree: XgbTreeNode;
  /** booster.feature_names — resolves "fN" split names when present. */
  features: string[];
  /** Plot-area height in px. Default 480. */
  height?: number;
  /** Optional tree index for the header chip ("TREE #0"). */
  treeIndex?: number;
}

// ---- geometry constants (data-space; the fit transform rescales) ----------
const SPLIT_W = 96;
const SPLIT_H = 30;
const LEAF_W = 62;
const LEAF_H = 18;
const PILL_W = 98;
const PILL_H = 18;
const NODE_DX = 108; // horizontal slot per node
const NODE_DY = 76; // vertical distance per level
const PAD = 16;
const MIN_FIT = 0.3; // min node scale before pan/zoom takes over
const K_MIN = 0.5;
const K_MAX = 3;
const HIT_PAD = 8; // hover hit-target inflation beyond the visible mark

const DEPTH_CHOICES: readonly (number | null)[] = [3, 4, 6, null];

// ---- display tree (raw tree + collapse pills) ------------------------------

interface DisplayDatum {
  kind: "node" | "pill";
  /** For "pill": the parent node whose subtree is collapsed. */
  node: XgbTreeNode;
  hiddenCount?: number;
  children?: DisplayDatum[];
}

function buildDisplay(
  node: XgbTreeNode,
  depth: number,
  limit: number | null,
  expanded: ReadonlySet<number>,
): DisplayDatum {
  const kids = node.children ?? [];
  if (kids.length === 0) return { kind: "node", node };
  if (limit != null && depth >= limit && !expanded.has(node.nodeid)) {
    return {
      kind: "node",
      node,
      children: [
        { kind: "pill", node, hiddenCount: countDescendants(node) },
      ],
    };
  }
  return {
    kind: "node",
    node,
    children: kids.map((c) => buildDisplay(c, depth + 1, limit, expanded)),
  };
}

function nodeHalfH(d: DisplayDatum): number {
  if (d.kind === "pill") return PILL_H / 2;
  return d.node.leaf != null ? LEAF_H / 2 : SPLIT_H / 2;
}

function truncateLabel(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function fmtCover(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  return v >= 100 ? v.toFixed(0) : v.toFixed(1);
}

/** Re-resolves "fN" at the head of a decision-path line to a feature name. */
function resolvePathLine(line: string, features: string[]): string {
  return line.replace(/^f(\d+)(?= )/, (whole, idx: string) => {
    const name = features[Number(idx)];
    return name ?? whole;
  });
}

// ---- outer component -------------------------------------------------------

export function TreeDiagram({
  tree,
  features,
  height = 480,
  treeIndex,
}: TreeDiagramProps) {
  const [depthLimit, setDepthLimit] = useState<number | null>(4);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(
    () => new Set<number>(),
  );

  // A new tree resets any per-tree expansion state.
  useEffect(() => {
    setExpanded(new Set<number>());
  }, [tree]);

  if (!tree || typeof tree.nodeid !== "number") {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-white/10 bg-white/[0.02] text-[11px] text-muted-foreground"
        style={{ height }}
      >
        No tree data.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Controls + legend row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {treeIndex != null && (
          <span className="font-mono text-foreground">tree #{treeIndex}</span>
        )}
        <span className="inline-flex items-center gap-1.5">
          depth
          <span className="inline-flex overflow-hidden rounded-md border border-white/10">
            {DEPTH_CHOICES.map((d) => (
              <button
                key={d ?? "all"}
                type="button"
                onClick={() => setDepthLimit(d)}
                className={cn(
                  "px-2 py-0.5 font-mono transition-colors",
                  depthLimit === d
                    ? "bg-white/[0.08] text-foreground"
                    : "bg-white/[0.02] text-muted-foreground hover:text-foreground",
                )}
              >
                {d ?? "All"}
              </button>
            ))}
          </span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2 w-3 rounded-[2px]"
            style={{
              background: "hsl(var(--data-seq-mid) / 0.35)",
              boxShadow: "inset 0 0 0 1px hsl(var(--border))",
            }}
          />
          split · fill = gain
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2 w-3 rounded-full"
            style={{
              background: "hsl(var(--data-div-pos) / 0.45)",
              boxShadow: "inset 0 0 0 1px hsl(var(--data-div-pos))",
            }}
          />
          leaf +
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2 w-3 rounded-full"
            style={{
              background: "hsl(var(--data-div-neg) / 0.45)",
              boxShadow: "inset 0 0 0 1px hsl(var(--data-div-neg))",
            }}
          />
          leaf −
        </span>
        <span className="font-mono normal-case">&lt; yes · ≥ no · * missing</span>
        <span className="ml-auto normal-case">
          scroll zoom · drag pan · dblclick reset
        </span>
      </div>

      {/* Plot area */}
      <Measured
        height={height}
        minWidth={80}
        className="overflow-hidden rounded-md border border-white/10 bg-white/[0.02]"
      >
        {({ width }) => (
          <TreePlot
            width={width}
            height={height}
            tree={tree}
            features={features}
            treeIndex={treeIndex ?? 0}
            depthLimit={depthLimit}
            expanded={expanded}
            onExpand={(id) =>
              setExpanded((prev) => {
                const next = new Set(prev);
                next.add(id);
                return next;
              })
            }
          />
        )}
      </Measured>
    </div>
  );
}

// ---- inner plot -------------------------------------------------------------

interface TreePlotProps {
  width: number;
  height: number;
  tree: XgbTreeNode;
  features: string[];
  treeIndex: number;
  depthLimit: number | null;
  expanded: ReadonlySet<number>;
  onExpand: (nodeid: number) => void;
}

interface ViewTransform {
  k: number;
  tx: number;
  ty: number;
}

const RESET_VIEW: ViewTransform = { k: 1, tx: 0, ty: 0 };

function TreePlot({
  width,
  height,
  tree,
  features,
  treeIndex,
  depthLimit,
  expanded,
  onExpand,
}: TreePlotProps) {
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [view, setView] = useState<ViewTransform>(RESET_VIEW);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const panRef = useRef<{ px: number; py: number; tx: number; ty: number } | null>(null);
  const movedRef = useRef(false);

  // Tree-wide stats for the discrete color scales.
  const stats = useMemo(() => {
    const all = flattenTree(tree);
    let maxGain = 0;
    let maxAbsLeaf = 0;
    for (const n of all) {
      if (n.gain != null && Number.isFinite(n.gain) && n.gain > maxGain) {
        maxGain = n.gain;
      }
      if (n.leaf != null && Number.isFinite(n.leaf)) {
        maxAbsLeaf = Math.max(maxAbsLeaf, Math.abs(n.leaf));
      }
    }
    return { maxGain, maxAbsLeaf, rootCover: tree.cover };
  }, [tree]);

  // Tidy layout over the (possibly collapsed) display tree.
  const layout = useMemo(() => {
    const display = buildDisplay(tree, 0, depthLimit, expanded);
    const root = hierarchy<DisplayDatum>(display, (d) => d.children);
    const laid = d3tree<DisplayDatum>()
      .nodeSize([NODE_DX, NODE_DY])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.2))(root);
    const nodes = laid.descendants();
    const links = laid.links();
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = 0;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      maxX = 0;
    }
    const byId = new Map<number, HierarchyPointNode<DisplayDatum>>();
    for (const n of nodes) {
      if (n.data.kind === "node") byId.set(n.data.node.nodeid, n);
    }
    return {
      nodes,
      links,
      byId,
      minX: minX - SPLIT_W / 2,
      maxX: maxX + SPLIT_W / 2,
      minY: -SPLIT_H / 2,
      maxY: maxY + SPLIT_H / 2,
    };
  }, [tree, depthLimit, expanded]);

  const treeW = Math.max(1, layout.maxX - layout.minX);
  const treeH = Math.max(1, layout.maxY - layout.minY);
  const innerW = Math.max(1, width - PAD * 2);
  const innerH = Math.max(1, height - PAD * 2);
  const fit = Math.max(MIN_FIT, Math.min(innerW / treeW, innerH / treeH, 1));
  const baseTx = PAD + (innerW - treeW * fit) / 2 - layout.minX * fit;
  const baseTy = PAD - layout.minY * fit;

  // Ancestor id-set of the hovered node — drives path highlight + dimming.
  const pathIds = useMemo(() => {
    if (hoverId == null) return null;
    const n = layout.byId.get(hoverId);
    if (!n) return null;
    const ids = new Set<number>();
    for (const a of n.ancestors()) {
      if (a.data.kind === "node") ids.add(a.data.node.nodeid);
    }
    return ids;
  }, [hoverId, layout]);

  // Native non-passive wheel listener — React's synthetic onWheel cannot
  // reliably preventDefault (root listeners are passive), and page scroll
  // must not fight zoom.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const { k, tx, ty } = viewRef.current;
      const nextK = Math.max(
        K_MIN,
        Math.min(K_MAX, k * Math.exp(-e.deltaY * 0.0018)),
      );
      if (nextK === k) return;
      const r = nextK / k;
      setView({
        k: nextK,
        tx: px - (px - tx) * r,
        ty: py - (py - ty) * r,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    panRef.current = {
      px: e.clientX,
      py: e.clientY,
      tx: viewRef.current.tx,
      ty: viewRef.current.ty,
    };
    movedRef.current = false;
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = panRef.current;
    if (!p) return;
    const dx = e.clientX - p.px;
    const dy = e.clientY - p.py;
    if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true;
    if (movedRef.current) {
      setView((v) => ({ ...v, tx: p.tx + dx, ty: p.ty + dy }));
    }
  };

  const endPan = () => {
    panRef.current = null;
  };

  const hovered = hoverId != null ? layout.byId.get(hoverId) : undefined;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      role="img"
      aria-label={`xgboost-tree-${treeIndex}`}
      className="block cursor-grab select-none active:cursor-grabbing"
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerLeave={() => {
        endPan();
        setHoverId(null);
      }}
      onDoubleClick={() => setView(RESET_VIEW)}
    >
      <g transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
        <g transform={`translate(${baseTx},${baseTy}) scale(${fit})`}>
          {/* Links */}
          {layout.links.map((l) => {
            const s = l.source;
            const t = l.target;
            const y0 = s.y + nodeHalfH(s.data);
            const y1 = t.y - nodeHalfH(t.data);
            const midY = (y0 + y1) / 2;
            const d = `M ${s.x},${y0} C ${s.x},${midY} ${t.x},${midY} ${t.x},${y1}`;
            const child =
              t.data.kind === "pill" ? s.data.node : t.data.node;
            const w = 1 + 5 * coverFraction(child, stats.rootCover);
            const onPath =
              t.data.kind === "node" &&
              pathIds != null &&
              pathIds.has(t.data.node.nodeid);
            const dimmed = pathIds != null && !onPath;

            // Yes/no fork glyph — identity by TEXT, never by color.
            let glyph = "";
            if (t.data.kind === "node" && s.data.node.split != null) {
              const parent = s.data.node;
              if (t.data.node.nodeid === parent.yes) glyph = "<";
              else if (t.data.node.nodeid === parent.no) glyph = "≥";
              if (glyph && parent.missing === t.data.node.nodeid) glyph += "*";
            }
            const gx = s.x + (t.x - s.x) * 0.35;
            const gy = y0 + (y1 - y0) * 0.35;
            const key = `${s.data.node.nodeid}-${t.data.kind}-${t.data.node.nodeid}`;

            return (
              <g key={key} opacity={dimmed ? 0.3 : 1}>
                <path
                  d={d}
                  fill="none"
                  stroke={
                    onPath ? "hsl(var(--data-cat-1))" : "hsl(var(--border))"
                  }
                  strokeWidth={w}
                  strokeLinecap="round"
                />
                {glyph && (
                  <text
                    x={gx}
                    y={gy - 3}
                    fontSize={9}
                    fill="hsl(var(--muted-foreground))"
                    fontFamily="var(--font-mono)"
                    textAnchor="middle"
                  >
                    {glyph}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {layout.nodes.map((n) => {
            if (n.data.kind === "pill") {
              const hidden = n.data.hiddenCount ?? 0;
              const parentId = n.data.node.nodeid;
              return (
                <Group
                  key={`pill-${parentId}`}
                  left={n.x}
                  top={n.y}
                  className="cursor-pointer"
                  onClick={() => {
                    if (!movedRef.current) onExpand(parentId);
                  }}
                  opacity={pathIds != null ? 0.3 : 1}
                >
                  <rect
                    x={-PILL_W / 2}
                    y={-PILL_H / 2}
                    width={PILL_W}
                    height={PILL_H}
                    rx={PILL_H / 2}
                    fill="hsl(var(--popover))"
                    stroke="hsl(var(--border))"
                    strokeDasharray="3 2"
                  />
                  <text
                    y={3}
                    fontSize={9}
                    fill="hsl(var(--muted-foreground))"
                    fontFamily="var(--font-mono)"
                    textAnchor="middle"
                  >
                    {`▸ ${hidden} more nodes`}
                  </text>
                </Group>
              );
            }

            const node = n.data.node;
            const isLeaf = node.leaf != null;
            const inPath = pathIds == null || pathIds.has(node.nodeid);
            const isHovered = hoverId === node.nodeid;
            const halfW = isLeaf ? LEAF_W / 2 : SPLIT_W / 2;
            const halfH = isLeaf ? LEAF_H / 2 : SPLIT_H / 2;

            return (
              <Group
                key={`node-${node.nodeid}`}
                left={n.x}
                top={n.y}
                opacity={inPath ? 1 : 0.3}
              >
                {isLeaf && node.leaf != null ? (
                  (() => {
                    const token = leafValueToken(node.leaf, stats.maxAbsLeaf);
                    return (
                      <>
                        <rect
                          x={-halfW}
                          y={-halfH}
                          width={LEAF_W}
                          height={LEAF_H}
                          rx={LEAF_H / 2}
                          fill={`hsl(var(${token}) / 0.45)`}
                          stroke={
                            isHovered
                              ? "hsl(var(--data-cat-1))"
                              : `hsl(var(${token}))`
                          }
                          strokeWidth={isHovered ? 1.5 : 1}
                        />
                        {/* Deuteranopia rule: the signed value is ALWAYS
                            visible text — color is reinforcement only. */}
                        <text
                          y={3}
                          fontSize={9}
                          fill="hsl(var(--foreground))"
                          fontFamily="var(--font-mono)"
                          textAnchor="middle"
                        >
                          {formatLeafValue(node.leaf)}
                        </text>
                      </>
                    );
                  })()
                ) : (
                  <>
                    <rect
                      x={-halfW}
                      y={-halfH}
                      width={SPLIT_W}
                      height={SPLIT_H}
                      rx={4}
                      fill={`hsl(var(--data-seq-mid) / ${gainFillOpacity(node.gain ?? 0, stats.maxGain)})`}
                      stroke={
                        isHovered
                          ? "hsl(var(--data-cat-1))"
                          : "hsl(var(--border))"
                      }
                      strokeWidth={isHovered ? 1.5 : 1}
                    />
                    <text
                      y={-3}
                      fontSize={10}
                      fontWeight={600}
                      fill="hsl(var(--foreground))"
                      fontFamily="var(--font-mono)"
                      textAnchor="middle"
                    >
                      {truncateLabel(
                        resolveFeature(node.split ?? `#${node.nodeid}`, features),
                        14,
                      )}
                    </text>
                    <text
                      y={9}
                      fontSize={9}
                      fill="hsl(var(--muted-foreground))"
                      fontFamily="var(--font-mono)"
                      textAnchor="middle"
                    >
                      {node.split_condition != null
                        ? `< ${formatThreshold(node.split_condition)}`
                        : `cover ${fmtCover(node.cover)}`}
                    </text>
                  </>
                )}
                {/* Invisible hit target — LARGER than the visible mark. */}
                <rect
                  x={-halfW - HIT_PAD}
                  y={-halfH - HIT_PAD}
                  width={(isLeaf ? LEAF_W : SPLIT_W) + HIT_PAD * 2}
                  height={(isLeaf ? LEAF_H : SPLIT_H) + HIT_PAD * 2}
                  fill="transparent"
                  onPointerEnter={() => setHoverId(node.nodeid)}
                  onPointerLeave={() =>
                    setHoverId((cur) => (cur === node.nodeid ? null : cur))
                  }
                />
              </Group>
            );
          })}
        </g>
      </g>

      {/* Hand-rolled tooltip — screen space, unaffected by zoom/pan. */}
      {hovered && hovered.data.kind === "node" && (
        <TreeTooltip
          width={width}
          node={hovered.data.node}
          depth={hovered.depth}
          rootCover={stats.rootCover}
          path={decisionPath(tree, hovered.data.node.nodeid).map((line) =>
            resolvePathLine(line, features),
          )}
          features={features}
        />
      )}
    </svg>
  );
}

// ---- tooltip ----------------------------------------------------------------

const TOOLTIP_W = 208;
const TOOLTIP_LINE_H = 12;
const TOOLTIP_MAX_PATH = 8;

function TreeTooltip({
  width,
  node,
  depth,
  rootCover,
  path,
  features,
}: {
  width: number;
  node: XgbTreeNode;
  depth: number;
  rootCover: number;
  path: string[];
  features: string[];
}) {
  const lines: { text: string; muted: boolean }[] = [];
  lines.push({ text: `#${node.nodeid} · depth ${depth}`, muted: false });
  if (node.leaf != null) {
    lines.push({ text: `leaf ${formatLeafValue(node.leaf)}`, muted: false });
  } else if (node.split != null) {
    lines.push({
      text: `${truncateLabel(resolveFeature(node.split, features), 18)} < ${formatThreshold(node.split_condition ?? Number.NaN)}`,
      muted: false,
    });
  }
  if (node.gain != null) {
    lines.push({ text: `gain ${formatThreshold(node.gain)}`, muted: true });
  }
  const pct = (coverFraction(node, rootCover) * 100).toFixed(1);
  lines.push({
    text: `cover ${fmtCover(node.cover)} (${pct}% of root)`,
    muted: true,
  });
  if (path.length > 0) {
    lines.push({ text: "path", muted: true });
    const overflow = path.length > TOOLTIP_MAX_PATH;
    const shown = overflow ? path.slice(0, TOOLTIP_MAX_PATH - 1) : path;
    for (const p of shown) {
      lines.push({ text: truncateLabel(p, 28), muted: true });
    }
    if (overflow) {
      lines.push({
        text: `… ${path.length - (TOOLTIP_MAX_PATH - 1)} more`,
        muted: true,
      });
    }
  }

  const boxH = lines.length * TOOLTIP_LINE_H + 10;
  const x = Math.max(4, width - TOOLTIP_W - 8);

  return (
    <Group left={x} top={8} pointerEvents="none">
      <rect
        width={TOOLTIP_W}
        height={boxH}
        rx={4}
        fill="hsl(var(--popover))"
        stroke="hsl(var(--border))"
      />
      {lines.map((l, i) => (
        <text
          key={`${i}-${l.text}`}
          x={7}
          y={14 + i * TOOLTIP_LINE_H}
          fontSize={10}
          fill={
            l.muted ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))"
          }
          fontFamily="var(--font-mono)"
        >
          {l.text}
        </text>
      ))}
    </Group>
  );
}
