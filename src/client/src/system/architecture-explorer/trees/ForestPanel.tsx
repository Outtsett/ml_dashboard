/**
 * ForestPanel — whole-ensemble view over a ForestSummary payload.
 *
 * Header KPI row (KpiStrip) → feature-usage horizontal bars (top-15 by total
 * gain, one categorical token — identity is carried by the font-mono feature
 * labels, never by hue) → depth histogram + leaf-value histogram side by
 * side. Leaf bins wear discrete diverging stops with a labeled zero line;
 * counts surface as text on hover (hand-rolled SVG tooltip, house style).
 */

import { useMemo, useState } from "react";
import { Measured } from "../Measured";
import { Group } from "@visx/group";
import { KpiStrip } from "@/backtest/components";
import type { Kpi } from "@/backtest/components";
import {
  type ForestDepthBin,
  type ForestFeatureUsage,
  type ForestLeafBin,
  type ForestSummary,
  formatThreshold,
  leafValueToken,
} from "./types";

export interface ForestPanelProps {
  summary: ForestSummary;
  /** Vertical budget for the chart stack (KPI strip excluded). Default 480. */
  height?: number;
}

const TOP_N_FEATURES = 15;

function fmtGain(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  if (Math.abs(v) >= 100) return v.toFixed(0);
  return v.toFixed(1);
}

function Placeholder({ height, children }: { height: number; children: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-md border border-dashed border-white/10 bg-white/[0.02] text-[11px] text-muted-foreground"
      style={{ height }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

export function ForestPanel({ summary, height = 480 }: ForestPanelProps) {
  const barsH = Math.max(160, Math.round(height * 0.5));
  const histH = Math.max(120, Math.round(height * 0.36));

  if (!summary || !Number.isFinite(summary.nTrees)) {
    return <Placeholder height={height}>No forest summary.</Placeholder>;
  }

  const kpis: Kpi[] = [
    { label: "TREES", value: String(summary.nTrees) },
    { label: "MAX DEPTH", value: String(summary.maxDepth) },
    { label: "AVG LEAVES", value: summary.avgLeaves.toFixed(1) },
    {
      label: "FEATURES USED",
      value: `${summary.featureUsage.length} / ${summary.features.length}`,
      hint: "features with at least one split / total model features",
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <KpiStrip
        kpis={kpis}
        dense
        className="overflow-hidden rounded-md border border-white/10"
      />

      <section>
        <SectionLabel>
          {`feature usage — top ${Math.min(TOP_N_FEATURES, summary.featureUsage.length)} by total gain`}
        </SectionLabel>
        <FeatureUsageBars usage={summary.featureUsage} height={barsH} />
      </section>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <section>
          <SectionLabel>depth distribution</SectionLabel>
          <DepthHistogram bins={summary.depthHistogram} height={histH} />
        </section>
        <section>
          <SectionLabel>leaf values</SectionLabel>
          <LeafHistogram leafValues={summary.leafValues} height={histH} />
        </section>
      </div>
    </div>
  );
}

// ---- shared tooltip ---------------------------------------------------------

function SvgTooltip({
  width,
  lines,
}: {
  width: number;
  lines: string[];
}) {
  const boxW = 176;
  const boxH = lines.length * 12 + 10;
  return (
    <Group left={Math.max(4, width - boxW - 6)} top={4} pointerEvents="none">
      <rect
        width={boxW}
        height={boxH}
        rx={4}
        fill="hsl(var(--popover))"
        stroke="hsl(var(--border))"
      />
      {lines.map((l, i) => (
        <text
          key={`${i}-${l}`}
          x={7}
          y={14 + i * 12}
          fontSize={10}
          fill={i === 0 ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"}
          fontFamily="var(--font-mono)"
        >
          {l}
        </text>
      ))}
    </Group>
  );
}

// ---- feature usage bars -----------------------------------------------------

const BARS_MARGIN = { top: 4, right: 8, bottom: 4, left: 118 };
/** Horizontal room reserved right of the longest bar for the ×nSplits text. */
const BAR_END_TEXT_W = 44;

function FeatureUsageBars({
  usage,
  height,
}: {
  usage: ForestFeatureUsage[];
  height: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const rows = useMemo(
    () =>
      usage
        .slice()
        .sort((a, b) => b.totalGain - a.totalGain)
        .slice(0, TOP_N_FEATURES),
    [usage],
  );

  if (rows.length === 0) {
    return <Placeholder height={height}>No split features recorded.</Placeholder>;
  }

  const maxGain = rows.reduce((m, r) => Math.max(m, r.totalGain), 0);

  return (
    <Measured
      height={height}
      minWidth={100}
      className="rounded-md border border-white/10 bg-white/[0.02]"
    >
      {({ width }) => {
          const innerW = Math.max(
            1,
            width - BARS_MARGIN.left - BARS_MARGIN.right - BAR_END_TEXT_W,
          );
          const innerH = height - BARS_MARGIN.top - BARS_MARGIN.bottom;
          const rowH = innerH / rows.length;
          const barH = Math.max(4, Math.min(12, rowH - 4));

          return (
            <svg width={width} height={height} role="img" aria-label="feature-usage">
              <Group left={BARS_MARGIN.left} top={BARS_MARGIN.top}>
                {rows.map((r, i) => {
                  const y = i * rowH + rowH / 2;
                  const barW =
                    maxGain > 0 ? Math.max(1, (r.totalGain / maxGain) * innerW) : 1;
                  const isHovered = hoverIdx === i;
                  return (
                    <g key={r.feature} opacity={hoverIdx == null || isHovered ? 1 : 0.45}>
                      {/* Feature label — identity via text, font-mono. */}
                      <text
                        x={-6}
                        y={y + 3}
                        fontSize={9}
                        fill="hsl(var(--muted-foreground))"
                        fontFamily="var(--font-mono)"
                        textAnchor="end"
                      >
                        {r.feature.length > 16 ? `${r.feature.slice(0, 15)}…` : r.feature}
                      </text>
                      {/* One categorical token for every bar — magnitude is
                          the bar length, identity is the y label. */}
                      <rect
                        x={0}
                        y={y - barH / 2}
                        width={barW}
                        height={barH}
                        rx={2}
                        fill={`hsl(var(--data-cat-2) / ${isHovered ? 1 : 0.8})`}
                      />
                      {/* nSplits count as text at the bar end. */}
                      <text
                        x={barW + 5}
                        y={y + 3}
                        fontSize={9}
                        fill="hsl(var(--muted-foreground))"
                        fontFamily="var(--font-mono)"
                        textAnchor="start"
                      >
                        {`×${r.nSplits}`}
                      </text>
                      {/* Full-row invisible hit target. */}
                      <rect
                        x={-BARS_MARGIN.left}
                        y={i * rowH}
                        width={width}
                        height={rowH}
                        fill="transparent"
                        onPointerEnter={() => setHoverIdx(i)}
                        onPointerLeave={() =>
                          setHoverIdx((cur) => (cur === i ? null : cur))
                        }
                      />
                    </g>
                  );
                })}
              </Group>
              {hoverIdx != null && rows[hoverIdx] && (
                <SvgTooltip
                  width={width}
                  lines={[
                    rows[hoverIdx].feature,
                    `gain ${fmtGain(rows[hoverIdx].totalGain)}`,
                    `splits ${rows[hoverIdx].nSplits}`,
                    `cover ${fmtGain(rows[hoverIdx].totalCover)}`,
                  ]}
                />
              )}
            </svg>
          );
        }}
      </Measured>
  );
}

// ---- depth histogram --------------------------------------------------------

const DEPTH_MARGIN = { top: 16, right: 8, bottom: 18, left: 8 };

function DepthHistogram({
  bins,
  height,
}: {
  bins: ForestDepthBin[];
  height: number;
}) {
  const sorted = useMemo(
    () => bins.slice().sort((a, b) => a.depth - b.depth),
    [bins],
  );

  if (sorted.length === 0) {
    return <Placeholder height={height}>No depth data.</Placeholder>;
  }

  const maxCount = sorted.reduce((m, b) => Math.max(m, b.count), 0);

  return (
    <Measured
      height={height}
      minWidth={80}
      className="rounded-md border border-white/10 bg-white/[0.02]"
    >
      {({ width }) => {
          const innerW = width - DEPTH_MARGIN.left - DEPTH_MARGIN.right;
          const innerH = height - DEPTH_MARGIN.top - DEPTH_MARGIN.bottom;
          const slotW = innerW / sorted.length;
          const barW = Math.max(3, Math.min(28, slotW - 2));

          return (
            <svg width={width} height={height} role="img" aria-label="depth-histogram">
              <Group left={DEPTH_MARGIN.left} top={DEPTH_MARGIN.top}>
                {/* Baseline. */}
                <line
                  x1={0}
                  x2={innerW}
                  y1={innerH}
                  y2={innerH}
                  stroke="hsl(var(--border))"
                  strokeWidth={1}
                />
                {sorted.map((b, i) => {
                  const cx = i * slotW + slotW / 2;
                  const h =
                    maxCount > 0 ? Math.max(1, (b.count / maxCount) * innerH) : 1;
                  return (
                    <g key={b.depth}>
                      <rect
                        x={cx - barW / 2}
                        y={innerH - h}
                        width={barW}
                        height={h}
                        rx={2}
                        fill="hsl(var(--data-cat-1) / 0.8)"
                      />
                      {/* Count always visible — few bins, text fits. */}
                      <text
                        x={cx}
                        y={innerH - h - 4}
                        fontSize={9}
                        fill="hsl(var(--muted-foreground))"
                        fontFamily="var(--font-mono)"
                        textAnchor="middle"
                      >
                        {b.count}
                      </text>
                      <text
                        x={cx}
                        y={innerH + 12}
                        fontSize={9}
                        fill="hsl(var(--muted-foreground))"
                        fontFamily="var(--font-mono)"
                        textAnchor="middle"
                      >
                        {b.depth}
                      </text>
                    </g>
                  );
                })}
              </Group>
            </svg>
          );
        }}
      </Measured>
  );
}

// ---- leaf-value histogram ---------------------------------------------------

const LEAF_MARGIN = { top: 8, right: 8, bottom: 18, left: 8 };

function LeafHistogram({
  leafValues,
  height,
}: {
  leafValues: ForestSummary["leafValues"];
  height: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const bins: ForestLeafBin[] = leafValues?.histogram ?? [];

  if (bins.length === 0) {
    return <Placeholder height={height}>No leaf values.</Placeholder>;
  }

  const lo = bins.reduce((m, b) => Math.min(m, b.x0), Infinity);
  const hi = bins.reduce((m, b) => Math.max(m, b.x1), -Infinity);
  const span = hi - lo;
  const maxCount = bins.reduce((m, b) => Math.max(m, b.count), 0);
  const maxAbs = Math.max(Math.abs(leafValues.min), Math.abs(leafValues.max));

  if (!Number.isFinite(span) || span <= 0 || maxCount <= 0) {
    return <Placeholder height={height}>Degenerate leaf distribution.</Placeholder>;
  }

  return (
    <Measured
      height={height}
      minWidth={80}
      className="rounded-md border border-white/10 bg-white/[0.02]"
    >
      {({ width }) => {
          const innerW = width - LEAF_MARGIN.left - LEAF_MARGIN.right;
          const innerH = height - LEAF_MARGIN.top - LEAF_MARGIN.bottom;
          const xPos = (v: number) => ((v - lo) / span) * innerW;

          return (
            <svg width={width} height={height} role="img" aria-label="leaf-value-histogram">
              <Group left={LEAF_MARGIN.left} top={LEAF_MARGIN.top}>
                <line
                  x1={0}
                  x2={innerW}
                  y1={innerH}
                  y2={innerH}
                  stroke="hsl(var(--border))"
                  strokeWidth={1}
                />
                {bins.map((b, i) => {
                  const x0 = xPos(b.x0);
                  const x1 = xPos(b.x1);
                  const w = Math.max(1, x1 - x0 - 1);
                  const h = Math.max(b.count > 0 ? 1 : 0, (b.count / maxCount) * innerH);
                  const mid = (b.x0 + b.x1) / 2;
                  const token = leafValueToken(mid, maxAbs);
                  const isHovered = hoverIdx === i;
                  return (
                    <g key={`${b.x0}-${b.x1}`} opacity={hoverIdx == null || isHovered ? 1 : 0.45}>
                      {h > 0 && (
                        <rect
                          x={x0 + 0.5}
                          y={innerH - h}
                          width={w}
                          height={h}
                          rx={1.5}
                          fill={`hsl(var(${token}) / ${isHovered ? 0.95 : 0.7})`}
                        />
                      )}
                      {/* Hit target spans the full column height. */}
                      <rect
                        x={x0}
                        y={0}
                        width={Math.max(8, x1 - x0)}
                        height={innerH}
                        fill="transparent"
                        onPointerEnter={() => setHoverIdx(i)}
                        onPointerLeave={() =>
                          setHoverIdx((cur) => (cur === i ? null : cur))
                        }
                      />
                    </g>
                  );
                })}

                {/* Zero line — labeled, not color-only. */}
                {lo < 0 && hi > 0 && (
                  <g>
                    <line
                      x1={xPos(0)}
                      x2={xPos(0)}
                      y1={0}
                      y2={innerH}
                      stroke="hsl(var(--foreground) / 0.35)"
                      strokeDasharray="2 2"
                    />
                    <text
                      x={xPos(0)}
                      y={innerH + 12}
                      fontSize={9}
                      fill="hsl(var(--foreground))"
                      fontFamily="var(--font-mono)"
                      textAnchor="middle"
                    >
                      0
                    </text>
                  </g>
                )}

                {/* Domain end labels. */}
                <text
                  x={0}
                  y={innerH + 12}
                  fontSize={9}
                  fill="hsl(var(--muted-foreground))"
                  fontFamily="var(--font-mono)"
                  textAnchor="start"
                >
                  {formatThreshold(lo)}
                </text>
                <text
                  x={innerW}
                  y={innerH + 12}
                  fontSize={9}
                  fill="hsl(var(--muted-foreground))"
                  fontFamily="var(--font-mono)"
                  textAnchor="end"
                >
                  {formatThreshold(hi)}
                </text>
              </Group>
              {hoverIdx != null && bins[hoverIdx] && (
                <SvgTooltip
                  width={width}
                  lines={[
                    `[${formatThreshold(bins[hoverIdx].x0)}, ${formatThreshold(bins[hoverIdx].x1)})`,
                    `${bins[hoverIdx].count} leaves`,
                  ]}
                />
              )}
            </svg>
          );
        }}
      </Measured>
  );
}
