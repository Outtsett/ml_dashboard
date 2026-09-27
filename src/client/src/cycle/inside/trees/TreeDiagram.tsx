/**
 * One whole tree, with this bar's path in bold — restored from the removed
 * architecture explorer (`git show bf2be98^:src/client/src/system/architecture-explorer/trees/TreeDiagram.tsx`)
 * and adapted to the explainer's node columns (`CycleExplainTree`).
 *
 * d3-hierarchy lays the tree out top-down; React draws every SVG element.
 * Wide trees scale to fit with a floor, then wheel-zoom and drag-pan take over
 * (double-click resets). Deep trees are collapsed below a chosen depth into
 * "N more nodes" pills — except along this bar's path, which is always open.
 *
 * The path: bold reddish-purple links, each question it asked written in words
 * above the diagram ("Relative strength index 14 = 0.8 < 0.5? no →"); the rest
 * of the tree fades. Leaves carry their signed value and ▲/▼ — orange pushes
 * up, blue pushes down, colour never the only signal.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Group } from "@visx/group";
import { hierarchy, tree as d3tree, type HierarchyPointNode } from "d3-hierarchy";

import type { CycleExplainTree } from "@shared/cycle/explain";

import { Measured } from "@/ml/architecture/Measured";
import { cn } from "@/shared/utils/utils";

import { CYCLE_COLORS } from "../../chartModel";
import { buildTreeNodes, countNodes, formatSigned, formatValue, pushColor, pushGlyph, SPLIT_OPERATOR, type TreeNodeDatum } from "./treeTypes";

export interface TreeDiagramProps {
  tree: CycleExplainTree;
  /** Full-word feature names, one per model input. */
  featureNames: string[];
  /** This bar's model inputs (for the value beside each question on the path). */
  inputValues: readonly (number | null)[];
  /** Node positions on this bar's path, the leaf included. */
  pathNodes: ReadonlySet<number>;
  /** The path in words, root first, ending at the leaf. */
  pathText: string[];
  /** A leaf pushes up when its value is above this (0.5 for a forest's votes, else 0). */
  center: number;
  height?: number;
}

const SPLIT_W = 112;
const SPLIT_H = 32;
const LEAF_W = 70;
const LEAF_H = 20;
const PILL_W = 98;
const PILL_H = 18;
const NODE_DX = 124;
const NODE_DY = 78;
const PAD = 16;
const MIN_FIT = 0.3;
const K_MIN = 0.5;
const K_MAX = 3;
const HIT_PAD = 8;
const PATH_COLOR = CYCLE_COLORS.active;
const FADED = 0.25;

const DEPTH_CHOICES: readonly (number | null)[] = [3, 4, 6, null];

interface DisplayDatum {
  kind: "node" | "pill";
  node: TreeNodeDatum;
  hiddenCount?: number;
  children?: DisplayDatum[];
}

function buildDisplay(node: TreeNodeDatum, depth: number, limit: number | null, expanded: ReadonlySet<number>, path: ReadonlySet<number>): DisplayDatum {
  if (node.children.length === 0) return { kind: "node", node };
  const onPath = path.has(node.index);
  if (limit != null && depth >= limit && !expanded.has(node.index) && !onPath) {
    return { kind: "node", node, children: [{ kind: "pill", node, hiddenCount: countNodes(node) - 1 }] };
  }
  return { kind: "node", node, children: node.children.map((child) => buildDisplay(child, depth + 1, limit, expanded, path)) };
}

function nodeHalfHeight(datum: DisplayDatum): number {
  if (datum.kind === "pill") return PILL_H / 2;
  return datum.node.isLeaf ? LEAF_H / 2 : SPLIT_H / 2;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function TreeDiagram({ tree, featureNames, inputValues, pathNodes, pathText, center, height = 420 }: TreeDiagramProps) {
  const [depthLimit, setDepthLimit] = useState<number | null>(4);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set<number>());
  const root = useMemo(() => buildTreeNodes(tree), [tree]);

  useEffect(() => {
    setExpanded(new Set<number>());
  }, [tree]);

  return (
    <div className="flex flex-col gap-1.5" data-testid="tree-diagram">
      <ol className="flex flex-col gap-0.5 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5 font-mono text-[11px]" aria-label="This bar's path in words">
        {pathText.map((line, index) => (
          <li key={`${index}-${line}`} className={index === pathText.length - 1 ? "font-semibold text-neutral-100" : "text-neutral-300"}>
            {line}
          </li>
        ))}
      </ol>
      {root === null ? (
        <p className="text-xs text-neutral-400">This tree has no nodes to draw.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-neutral-400">
            <span className="font-mono text-neutral-200">Tree {tree.treeIndex + 1}</span>
            <span className="inline-flex items-center gap-1.5">
              Show depth
              <span className="inline-flex overflow-hidden rounded-md border border-white/10">
                {DEPTH_CHOICES.map((depth) => (
                  <button
                    key={depth ?? "all"}
                    type="button"
                    onClick={() => setDepthLimit(depth)}
                    className={cn("px-2 py-0.5 font-mono", depthLimit === depth ? "bg-white/[0.1] text-neutral-100" : "bg-white/[0.02] hover:text-neutral-100")}
                  >
                    {depth ?? "All"}
                  </button>
                ))}
              </span>
            </span>
            <span>
              <span className="font-semibold" style={{ color: PATH_COLOR }}>
                bold
              </span>{" "}
              = this bar's path · left branch = yes · right = no
            </span>
            <span style={{ color: CYCLE_COLORS.up }}>▲ leaf pushes up</span>
            <span style={{ color: CYCLE_COLORS.down }}>▼ leaf pushes down</span>
            <span className="ml-auto">scroll to zoom · drag to pan · double-click to reset</span>
          </div>
          <Measured height={height} minWidth={80} className="overflow-hidden rounded-md border border-white/10 bg-white/[0.02]">
            {({ width }) => (
              <TreePlot
                width={width}
                height={height}
                root={root}
                tree={tree}
                featureNames={featureNames}
                inputValues={inputValues}
                pathNodes={pathNodes}
                center={center}
                depthLimit={depthLimit}
                expanded={expanded}
                onExpand={(index) =>
                  setExpanded((previous) => {
                    const next = new Set(previous);
                    next.add(index);
                    return next;
                  })
                }
              />
            )}
          </Measured>
        </>
      )}
    </div>
  );
}

interface TreePlotProps {
  width: number;
  height: number;
  root: TreeNodeDatum;
  tree: CycleExplainTree;
  featureNames: string[];
  inputValues: readonly (number | null)[];
  pathNodes: ReadonlySet<number>;
  center: number;
  depthLimit: number | null;
  expanded: ReadonlySet<number>;
  onExpand: (index: number) => void;
}

interface ViewTransform {
  k: number;
  tx: number;
  ty: number;
}

const RESET_VIEW: ViewTransform = { k: 1, tx: 0, ty: 0 };

function TreePlot({ width, height, root, tree, featureNames, inputValues, pathNodes, center, depthLimit, expanded, onExpand }: TreePlotProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [view, setView] = useState<ViewTransform>(RESET_VIEW);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const panRef = useRef<{ px: number; py: number; tx: number; ty: number } | null>(null);
  const movedRef = useRef(false);
  const operator = SPLIT_OPERATOR[tree.splitRule];

  const stats = useMemo(() => {
    let maxAbsLeaf = 0;
    const rootCover = root.cover ?? 0;
    const visit = (node: TreeNodeDatum) => {
      if (node.isLeaf) maxAbsLeaf = Math.max(maxAbsLeaf, Math.abs(node.value - center));
      node.children.forEach(visit);
    };
    visit(root);
    return { maxAbsLeaf, rootCover };
  }, [root, center]);

  const layout = useMemo(() => {
    const display = buildDisplay(root, 0, depthLimit, expanded, pathNodes);
    const hierarchyRoot = hierarchy<DisplayDatum>(display, (datum) => datum.children);
    const laid = d3tree<DisplayDatum>()
      .nodeSize([NODE_DX, NODE_DY])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.2))(hierarchyRoot);
    const nodes = laid.descendants();
    const links = laid.links();
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = 0;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      maxY = Math.max(maxY, node.y);
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      maxX = 0;
    }
    const byIndex = new Map<number, HierarchyPointNode<DisplayDatum>>();
    for (const node of nodes) if (node.data.kind === "node") byIndex.set(node.data.node.index, node);
    return { nodes, links, byIndex, minX: minX - SPLIT_W / 2, maxX: maxX + SPLIT_W / 2, minY: -SPLIT_H / 2, maxY: maxY + SPLIT_H / 2 };
  }, [root, depthLimit, expanded, pathNodes]);

  const treeWidth = Math.max(1, layout.maxX - layout.minX);
  const treeHeight = Math.max(1, layout.maxY - layout.minY);
  const innerWidth = Math.max(1, width - PAD * 2);
  const innerHeight = Math.max(1, height - PAD * 2);
  const fit = Math.max(MIN_FIT, Math.min(innerWidth / treeWidth, innerHeight / treeHeight, 1));
  const baseTx = PAD + (innerWidth - treeWidth * fit) / 2 - layout.minX * fit;
  const baseTy = PAD - layout.minY * fit;

  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const { k, tx, ty } = viewRef.current;
      const nextK = Math.max(K_MIN, Math.min(K_MAX, k * Math.exp(-event.deltaY * 0.0018)));
      if (nextK === k) return;
      const ratio = nextK / k;
      setView({ k: nextK, tx: px - (px - tx) * ratio, ty: py - (py - ty) * ratio });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    panRef.current = { px: event.clientX, py: event.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
    movedRef.current = false;
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (!pan) return;
    const dx = event.clientX - pan.px;
    const dy = event.clientY - pan.py;
    if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true;
    if (movedRef.current) setView((current) => ({ ...current, tx: pan.tx + dx, ty: pan.ty + dy }));
  };
  const endPan = () => {
    panRef.current = null;
  };

  const nameOf = (feature: number) => featureNames[feature] ?? `Input ${feature + 1}`;
  const hovered = hoverIndex != null ? layout.byIndex.get(hoverIndex) : undefined;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      role="img"
      aria-label={`Tree ${tree.treeIndex + 1}, this bar's path in bold`}
      className="block cursor-grab select-none active:cursor-grabbing"
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerLeave={() => {
        endPan();
        setHoverIndex(null);
      }}
      onDoubleClick={() => setView(RESET_VIEW)}
    >
      <g transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
        <g transform={`translate(${baseTx},${baseTy}) scale(${fit})`}>
          {layout.links.map((link) => {
            const source = link.source;
            const target = link.target;
            const y0 = source.y + nodeHalfHeight(source.data);
            const y1 = target.y - nodeHalfHeight(target.data);
            const middleY = (y0 + y1) / 2;
            const d = `M ${source.x},${y0} C ${source.x},${middleY} ${target.x},${middleY} ${target.x},${y1}`;
            const onPath = target.data.kind === "node" && pathNodes.has(target.data.node.index) && pathNodes.has(source.data.node.index);
            const childCover = target.data.kind === "node" ? target.data.node.cover : source.data.node.cover;
            const coverFraction = childCover !== null && stats.rootCover > 0 ? Math.max(0, Math.min(1, childCover / stats.rootCover)) : 0.3;
            let answer = "";
            if (target.data.kind === "node") {
              const parent = source.data.node;
              if (target.data.node.index === parent.yesChild) answer = "yes";
              else if (target.data.node.index === parent.noChild) answer = "no";
              if (answer && parent.missingGoesLeft !== null && (parent.missingGoesLeft ? answer === "yes" : answer === "no")) answer += " · missing";
            }
            return (
              <g key={`${source.data.node.index}-${target.data.kind}-${target.data.node.index}`} opacity={onPath ? 1 : FADED}>
                <path d={d} fill="none" stroke={onPath ? PATH_COLOR : CYCLE_COLORS.neutral} strokeWidth={onPath ? 4 : 1 + 4 * coverFraction} strokeLinecap="round" />
                {answer && (
                  <text
                    x={source.x + (target.x - source.x) * 0.35}
                    y={y0 + (y1 - y0) * 0.35 - 3}
                    fontSize={9}
                    fontWeight={onPath ? 700 : 400}
                    fill={onPath ? PATH_COLOR : CYCLE_COLORS.neutral}
                    textAnchor="middle"
                  >
                    {answer}
                  </text>
                )}
              </g>
            );
          })}

          {layout.nodes.map((point) => {
            if (point.data.kind === "pill") {
              const parentIndex = point.data.node.index;
              return (
                <Group
                  key={`pill-${parentIndex}`}
                  left={point.x}
                  top={point.y}
                  className="cursor-pointer"
                  opacity={FADED}
                  onClick={() => {
                    if (!movedRef.current) onExpand(parentIndex);
                  }}
                >
                  <rect x={-PILL_W / 2} y={-PILL_H / 2} width={PILL_W} height={PILL_H} rx={PILL_H / 2} fill="rgba(0,0,0,0.6)" stroke={CYCLE_COLORS.neutral} strokeDasharray="3 2" />
                  <text y={3} fontSize={9} fill={CYCLE_COLORS.neutral} textAnchor="middle">
                    {`▸ ${point.data.hiddenCount ?? 0} more nodes`}
                  </text>
                </Group>
              );
            }
            const node = point.data.node;
            const onPath = pathNodes.has(node.index);
            const isHovered = hoverIndex === node.index;
            const halfWidth = node.isLeaf ? LEAF_W / 2 : SPLIT_W / 2;
            const halfHeight = node.isLeaf ? LEAF_H / 2 : SPLIT_H / 2;
            const push = node.value - center;
            const value = node.feature >= 0 ? inputValues[node.feature] : null;
            return (
              <Group key={`node-${node.index}`} left={point.x} top={point.y} opacity={onPath ? 1 : FADED}>
                {node.isLeaf ? (
                  <>
                    <rect
                      x={-halfWidth}
                      y={-halfHeight}
                      width={LEAF_W}
                      height={LEAF_H}
                      rx={LEAF_H / 2}
                      fill={pushColor(push)}
                      fillOpacity={stats.maxAbsLeaf > 0 ? 0.25 + 0.5 * Math.min(1, Math.abs(push) / stats.maxAbsLeaf) : 0.3}
                      stroke={onPath || isHovered ? PATH_COLOR : pushColor(push)}
                      strokeWidth={onPath ? 3 : 1}
                    />
                    <text y={3.5} fontSize={10} fontWeight={onPath ? 700 : 400} fill="white" textAnchor="middle" fontFamily="var(--font-mono)">
                      {`${pushGlyph(push)} ${formatSigned(node.value, 3)}`}
                    </text>
                  </>
                ) : (
                  <>
                    <rect
                      x={-halfWidth}
                      y={-halfHeight}
                      width={SPLIT_W}
                      height={SPLIT_H}
                      rx={4}
                      fill="rgba(255,255,255,0.06)"
                      stroke={onPath || isHovered ? PATH_COLOR : CYCLE_COLORS.neutral}
                      strokeWidth={onPath ? 3 : 1}
                    />
                    <text y={-3} fontSize={10} fontWeight={onPath ? 700 : 500} fill="white" textAnchor="middle">
                      {truncate(nameOf(node.feature), 18)}
                    </text>
                    <text y={10} fontSize={9} fill={CYCLE_COLORS.neutral} textAnchor="middle" fontFamily="var(--font-mono)">
                      {onPath && value !== null && value !== undefined
                        ? `${formatValue(value, 3)} ${operator} ${formatValue(node.threshold, 3)}?`
                        : `${operator} ${formatValue(node.threshold, 3)}?`}
                    </text>
                  </>
                )}
                <rect
                  x={-halfWidth - HIT_PAD}
                  y={-halfHeight - HIT_PAD}
                  width={halfWidth * 2 + HIT_PAD * 2}
                  height={halfHeight * 2 + HIT_PAD * 2}
                  fill="transparent"
                  onPointerEnter={() => setHoverIndex(node.index)}
                  onPointerLeave={() => setHoverIndex((current) => (current === node.index ? null : current))}
                />
              </Group>
            );
          })}
        </g>
      </g>

      {hovered && hovered.data.kind === "node" && (
        <NodeTooltip width={width} node={hovered.data.node} name={nameOf(hovered.data.node.feature)} operator={operator} value={hovered.data.node.feature >= 0 ? inputValues[hovered.data.node.feature] ?? null : null} rootCover={stats.rootCover} onPath={pathNodes.has(hovered.data.node.index)} center={center} />
      )}
    </svg>
  );
}

const TOOLTIP_WIDTH = 240;
const TOOLTIP_LINE = 13;

function NodeTooltip({
  width,
  node,
  name,
  operator,
  value,
  rootCover,
  onPath,
  center,
}: {
  width: number;
  node: TreeNodeDatum;
  name: string;
  operator: string;
  value: number | null;
  rootCover: number;
  onPath: boolean;
  center: number;
}) {
  const lines: string[] = [`Node ${node.index} · depth ${node.depth}`];
  if (node.isLeaf) {
    const push = node.value - center;
    lines.push(`Leaf value ${formatSigned(node.value)} ${pushGlyph(push)} ${push > 0 ? "pushes up" : push < 0 ? "pushes down" : "pushes neither way"}`);
  } else {
    lines.push(truncate(`${name} ${operator} ${formatValue(node.threshold)}?`, 40));
    if (onPath) lines.push(`This bar: ${value === null ? "missing" : formatValue(value)}`);
    if (node.missingGoesLeft !== null) lines.push(`A missing value goes ${node.missingGoesLeft ? "yes (left)" : "no (right)"}`);
  }
  if (node.cover !== null) {
    const share = rootCover > 0 ? ` (${((node.cover / rootCover) * 100).toFixed(1)}% of the root)` : "";
    lines.push(`Training weight ${formatValue(node.cover)}${share}`);
  }
  lines.push(onPath ? "On this bar's path" : "Not on this bar's path");
  const boxHeight = lines.length * TOOLTIP_LINE + 10;
  const x = Math.max(4, width - TOOLTIP_WIDTH - 8);
  return (
    <Group left={x} top={8} pointerEvents="none">
      <rect width={TOOLTIP_WIDTH} height={boxHeight} rx={4} fill="rgba(10,10,12,0.95)" stroke={CYCLE_COLORS.neutral} strokeOpacity={0.4} />
      {lines.map((line, index) => (
        <text key={`${index}-${line}`} x={7} y={15 + index * TOOLTIP_LINE} fontSize={10} fill={index === 1 ? "white" : CYCLE_COLORS.neutral} fontFamily="var(--font-mono)">
          {line}
        </text>
      ))}
    </Group>
  );
}
