/**
 * The feature dependency graph, drawn.
 *
 * The thing this component exists to make visible: the data is TWO disconnected
 * graphs, not one. `features.json` computes its own indicators inline from raw
 * bars, while the derived layer transforms indicator columns produced separately
 * under a different naming convention. The layers share no node. So this draws
 * two panels and labels the gap, rather than letting a force simulation quietly
 * float one cluster near the other and imply a link.
 *
 * Colour is Okabe-Ito and never the only cue — each node also carries a shape and
 * a text label, so the four node kinds stay distinguishable without colour.
 */

import { useMemo, useRef, useState } from "react";
import {
  useFeatureGraph,
  type GraphEdge,
  type GraphNode,
} from "@/shared/hooks/useEntityBrowser";

// Okabe-Ito. Orange = the base layer's features, sky = their raw inputs,
// bluish-green = derived columns, yellow = the transform that produced them.
const NODE_STYLE: Record<string, { fill: string; stroke: string; label: string }> = {
  column: { fill: "#56B4E9", stroke: "#0072B2", label: "raw / indicator column" },
  base: { fill: "#E69F00", stroke: "#B36B00", label: "base feature" },
  derived: { fill: "#009E73", stroke: "#00624A", label: "derived column" },
  transform: { fill: "#F0E442", stroke: "#8A7A00", label: "transform" },
};

/** Ink, not a hue, so the two clusters are separable when printed. */
const CLUSTER_STYLE = {
  base: { stroke: "#E69F00", label: "Base layer" },
  derived: { stroke: "#009E73", label: "Derived layer" },
} as const;

const NODE_W = 132;
const NODE_H = 22;
const COL_GAP = 74;
const ROW_GAP = 9;

interface Placed extends GraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Longest-path layering: a node sits one column right of its deepest parent, so
 * every edge points rightward and the acyclic structure is the shape.
 */
function layout(nodes: GraphNode[], edges: GraphEdge[]): { placed: Placed[]; width: number; height: number; maxDepth: number } {
  const ids = new Set(nodes.map((n) => n.id));
  const parents = new Map<string, string[]>();
  for (const node of nodes) parents.set(node.id, []);
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    // `derives_with` is a real dependency but points sideways, so it is drawn
    // and layered by the primary `derives` edge instead of widening the columns.
    if (edge.kind === "derives_with" || edge.kind === "derives_unpaired") continue;
    parents.get(edge.target)!.push(edge.source);
  }

  const depth = new Map<string, number>();
  const resolve = (id: string, seen: Set<string>): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 0;
    seen.add(id);
    const ps = parents.get(id) ?? [];
    const value = ps.length === 0 ? 0 : Math.max(...ps.map((p) => resolve(p, seen) + 1));
    seen.delete(id);
    depth.set(id, value);
    return value;
  };
  for (const node of nodes) resolve(node.id, new Set());

  const columns = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const d = depth.get(node.id) ?? 0;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(node);
  }

  let maxDepth = 0;
  for (const [d, group] of columns) {
    maxDepth = Math.max(maxDepth, d);
    // Longest name first so the tall rows read as blocks of related columns.
    group.sort((a, b) => a.id.localeCompare(b.id));
  }

  const placed: Placed[] = [];
  let maxRows = 0;
  for (const [d, group] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    maxRows = Math.max(maxRows, group.length);
    group.forEach((node, i) => {
      placed.push({
        ...node,
        x: d * (NODE_W + COL_GAP),
        y: i * (NODE_H + ROW_GAP),
        width: NODE_W,
        height: NODE_H,
      });
    });
  }

  return {
    placed,
    width: (maxDepth + 1) * (NODE_W + COL_GAP) - COL_GAP,
    height: maxRows * (NODE_H + ROW_GAP) - ROW_GAP,
    maxDepth,
  };
}

function GraphPanel({
  title,
  component,
  subtitle,
  edgeKinds,
  idPrefix,
}: {
  title: string;
  component: "base" | "derived";
  subtitle: string;
  edgeKinds: string[];
  idPrefix: string;
}) {
  const { data, isLoading } = useFeatureGraph(component);
  const [hover, setHover] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const graph = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const edges = (data?.edges ?? []).filter((e) => edgeKinds.includes(e.kind));
    return { nodes, edges, ...layout(nodes, edges) };
  }, [data, edgeKinds]);

  // 400 derived columns in one panel is 5,000 px of scroll. Cap the drawn rows
  // and say so, rather than silently truncating or freezing the tab.
  const MAX_ROWS = 46;
  const visible = graph.placed.filter((n) => n.y / (NODE_H + ROW_GAP) < MAX_ROWS);
  const hidden = graph.nodes.length - visible.length;

  const at = new Map(visible.map((n) => [n.id, n]));
  const visibleEdges = graph.edges.filter((e) => at.has(e.source) && at.has(e.target));
  const near = hover
    ? { nodes: new Set(visible.filter((n) => n.id === hover || visibleEdges.some((e) => e.source === n.id || e.target === n.id)).map((n) => n.id)) }
    : null;

  if (isLoading) {
    return (
      <section className="rounded border border-neutral-800 bg-neutral-950/60 p-3">
        <h2 className="text-sm font-semibold text-neutral-200">{title}</h2>
        <p className="mt-2 text-xs text-neutral-500">Loading graph…</p>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-col rounded border border-neutral-800 bg-neutral-950/60 p-3">
      <h2 className="text-sm font-semibold text-neutral-200">
        <span
          className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle"
          style={{ background: CLUSTER_STYLE[component].stroke }}
        />
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-neutral-400">{subtitle}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400">
        {Object.entries(NODE_STYLE)
          .filter(([k]) => k !== "transform" || component === "derived")
          .map(([kind, style]) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{
                  background: style.fill,
                  border: `1px solid ${style.stroke}`,
                  borderRadius: kind === "column" ? "50%" : undefined,
                }}
              />
              {style.label}
            </span>
          ))}
      </div>

      <div
        className="mt-2 min-h-0 flex-1 overflow-auto rounded border border-neutral-900 bg-neutral-950"
        style={{ maxHeight: "46vh" }}
      >
        <svg
          ref={svgRef}
          width={Math.max(graph.width, 320)}
          height={Math.max(graph.height, 120)}
          role="img"
          aria-label={`${title}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <marker id={`${idPrefix}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="#6B7280" />
            </marker>
          </defs>

          {visibleEdges.map((edge, i) => {
            const s = at.get(edge.source)!;
            const t = at.get(edge.target)!;
            const x1 = s.x + s.width;
            const y1 = s.y + s.height / 2;
            const x2 = t.x;
            const y2 = t.y + t.height / 2;
            const mid = (x1 + x2) / 2;
            const active = hover !== null && (edge.source === hover || edge.target === hover);
            // A sibling edge has no column of its own, so it is drawn as a curve
            // that dips below the row rather than a straight rightward line.
            const d =
              edge.kind === "derives_with"
                ? `M ${x1} ${y1} C ${mid} ${y1 + 34}, ${mid} ${y2 + 34}, ${x2} ${y2}`
                : `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
            return (
              <path
                key={`${edge.source}->${edge.target}:${edge.kind}:${i}`}
                d={d}
                fill="none"
                stroke={active ? "#D55E00" : "#4B5563"}
                strokeWidth={active ? 1.8 : 0.8}
                strokeDasharray={edge.kind === "derives_unpaired" ? "3 3" : undefined}
                markerEnd={`url(#${idPrefix}-arrow)`}
                opacity={hover === null || active ? 1 : 0.25}
              >
                <title>{`${edge.source} → ${edge.target} (${edge.kind}${edge.via ? ` via ${edge.via}` : ""})`}</title>
              </path>
            );
          })}

          {visible.map((node) => {
            const style = NODE_STYLE[node.kind] ?? NODE_STYLE.column;
            const dim = near !== null && !near.nodes.has(node.id);
            const label = node.id.replace(/^[a-z]+:/, "");
            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                opacity={dim ? 0.3 : 1}
                onMouseEnter={() => setHover(node.id)}
              >
                <rect
                  width={node.width}
                  height={node.height}
                  rx={node.kind === "column" ? node.height / 2 : 3}
                  fill={style.fill}
                  stroke={style.stroke}
                  strokeWidth={hover === node.id ? 2 : 1}
                />
                <text
                  x={node.kind === "column" ? 14 : 6}
                  y={node.height / 2 + 3.5}
                  fontSize="10"
                  fill="#111827"
                  fontFamily="ui-monospace, monospace"
                >
                  {label.length > 19 ? `${label.slice(0, 18)}…` : label}
                </text>
                <title>{`${node.id}\n${style.label}`}</title>
              </g>
            );
          })}
        </svg>
      </div>

      <p className="mt-1.5 text-[11px] text-neutral-500">
        {graph.nodes.length} nodes · {graph.edges.length} edges
        {hidden > 0 && (
          <span className="text-[#E69F00]"> · {hidden} not drawn (row cap {MAX_ROWS})</span>
        )}
      </p>
    </section>
  );
}

export default function FeatureDependencyGraph() {
  const { data: all } = useFeatureGraph();
  const [showLegendNote, setShowLegendNote] = useState(true);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-neutral-800 px-4 py-3">
        <h1 className="text-base font-semibold text-neutral-50">Feature dependency graph</h1>
        <p className="mt-0.5 text-xs text-neutral-400">
          What each feature is computed from, read from <code>features.json</code> and{' '}
          <code>feature_extraction.json</code>. Hover a node to isolate its edges.
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {showLegendNote && (
          <div className="flex items-start gap-2 rounded border border-[#8A7A00]/50 bg-[#F0E442]/10 px-3 py-2 text-xs text-neutral-300">
            <span className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-sm bg-[#F0E442]" />
            <p className="flex-1">
              These are <strong className="text-neutral-100">two separate graphs</strong>, not one. The base
              layer reads raw bars; the derived layer transforms indicator columns from a different producer, under
              a different naming convention. They share no node, so nothing is drawn between them — the gap is the
              finding, not a missing edge.
            </p>
            <button
              type="button"
              onClick={() => setShowLegendNote(false)}
              className="shrink-0 text-neutral-500 hover:text-neutral-200"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-neutral-400">
          <span>
            base features: <strong className="text-neutral-200">{all?.counts.baseFeatures ?? 0}</strong>
          </span>
          <span>
            derived columns: <strong className="text-neutral-200">{all?.counts.derivedColumns ?? 0}</strong>
          </span>
          <span>
            transforms: <strong className="text-neutral-200">{all?.transforms.length ?? 0}</strong>
          </span>
        </div>

        <GraphPanel
          idPrefix="fg-base"
          title="Base layer"
          component="base"
          edgeKinds={["input_column", "depends_on"]}
          subtitle="Raw data columns each feature reads. features.json declares no feature-to-feature edges, so every feature is a root here."
        />
        <GraphPanel
          idPrefix="fg-derived"
          title="Derived layer"
          component="derived"
          edgeKinds={["derives", "derives_with", "derives_unpaired"]}
          subtitle="Indicator columns each derived column is a transform of. The dashed edge is a column the implementation resolves to all zeros — it has no signal-line pair."
        />
      </div>
    </div>
  );
}
