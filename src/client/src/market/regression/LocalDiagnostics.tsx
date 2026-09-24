/**
 * The local trend read across X, for the detail view: where the slope holds,
 * where it bends or reverses, and where bars miss the straight line by more.
 * Hover either chart to read the numbers at that X; the same X is marked on
 * both, so a bend and a change in spread line up.
 *
 * Plus the groups k-means found, when points are coloured by group.
 */

import { useState, type MouseEvent } from "react";
import type { ClusterSummary, LocalTrend } from "@shared/regression/index";
import type { RegressionFit } from "@shared/regression/types";
import { CLUSTER_COLORS } from "./encoding";
import { useMeasuredWidth } from "./ScatterPlot";
import { REGRESSION_COLORS, formatValue, linearScale, niceTicks, paddedExtent } from "./scales";

const HEIGHT = 150;
const MARGIN = { left: 56, right: 10, top: 10, bottom: 26 };

interface SeriesChartProps {
  width: number;
  x: number[];
  y: number[];
  lower?: number[];
  upper?: number[];
  reference: { value: number; label: string };
  showZero?: boolean;
  xLabel: string;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
}

function SeriesChart({ width, x, y, lower, upper, reference, showZero = false, xLabel, hoverIndex, onHover }: SeriesChartProps) {
  const innerWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const values = [...y, ...(lower ?? []), ...(upper ?? []), reference.value, ...(showZero ? [0] : [])].filter(Number.isFinite);
  const xScale = linearScale(paddedExtent(Math.min(...x), Math.max(...x), 0.01), [0, innerWidth]);
  const yScale = linearScale(paddedExtent(Math.min(...values), Math.max(...values)), [innerHeight, 0]);
  const path = (series: number[]) => {
    let d = "";
    let pen = false;
    series.forEach((value, index) => {
      if (!Number.isFinite(value)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${xScale(x[index] as number)},${yScale(value)}`;
      pen = true;
    });
    return d;
  };
  const band =
    lower && upper
      ? path(upper) + [...x.keys()].reverse().filter((index) => Number.isFinite(lower[index] as number)).map((index) => `L${xScale(x[index] as number)},${yScale(lower[index] as number)}`).join("") + "Z"
      : null;
  const nearest = (event: MouseEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const value = xScale.invert(event.clientX - bounds.left);
    let best = 0;
    x.forEach((candidate, index) => {
      if (Math.abs(candidate - value) < Math.abs((x[best] as number) - value)) best = index;
    });
    return best;
  };
  const yTicks = niceTicks(yScale.domain[0], yScale.domain[1], 4);
  const xTicks = niceTicks(xScale.domain[0], xScale.domain[1], 5);
  return (
    <svg width={width} height={HEIGHT}>
      <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        {yTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line x1={0} x2={innerWidth} y1={yScale(tick)} y2={yScale(tick)} stroke={REGRESSION_COLORS.grid} />
            <text x={-4} y={yScale(tick)} dy="0.32em" textAnchor="end" fontSize={9} fill={REGRESSION_COLORS.axis} className="tabular-nums">{formatValue(tick)}</text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text key={`x${tick}`} x={xScale(tick)} y={innerHeight + 12} textAnchor="middle" fontSize={9} fill={REGRESSION_COLORS.axis} className="tabular-nums">{formatValue(tick)}</text>
        ))}
        <text x={innerWidth / 2} y={innerHeight + 24} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.6)">{xLabel}</text>
        {band && <path d={band} fill={REGRESSION_COLORS.trendBand} />}
        {showZero && <line x1={0} x2={innerWidth} y1={yScale(0)} y2={yScale(0)} stroke="rgba(255,255,255,0.35)" strokeDasharray="2 3" />}
        <line x1={0} x2={innerWidth} y1={yScale(reference.value)} y2={yScale(reference.value)} stroke={REGRESSION_COLORS.fit} strokeWidth={1.4} />
        <text x={innerWidth - 2} y={yScale(reference.value) - 3} textAnchor="end" fontSize={9} fill={REGRESSION_COLORS.fit}>{reference.label}</text>
        <path d={path(y)} fill="none" stroke={REGRESSION_COLORS.trend} strokeWidth={1.6} />
        {hoverIndex !== null && Number.isFinite(y[hoverIndex] as number) && (
          <>
            <line x1={xScale(x[hoverIndex] as number)} x2={xScale(x[hoverIndex] as number)} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.3)" />
            <circle cx={xScale(x[hoverIndex] as number)} cy={yScale(y[hoverIndex] as number)} r={3} fill={REGRESSION_COLORS.trend} />
          </>
        )}
        <rect x={0} y={0} width={innerWidth} height={innerHeight} fill="transparent" onMouseMove={(event) => onHover(nearest(event))} onMouseLeave={() => onHover(null)} />
      </g>
    </svg>
  );
}

export function LocalTrendCharts({ trend, fit, inflation, xLabel }: { trend: LocalTrend; fit: RegressionFit; inflation: number; xLabel: string }) {
  const [measureRef, width] = useMeasuredWidth<HTMLDivElement>();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const half = Math.max(0, (width - 12) / 2);
  const lower = trend.slope.map((slope, index) => slope - 2 * (trend.slopeStandardError[index] as number));
  const upper = trend.slope.map((slope, index) => slope + 2 * (trend.slopeStandardError[index] as number));
  const hovered = hoverIndex !== null
    ? {
        x: trend.x[hoverIndex] as number,
        slope: trend.slope[hoverIndex] as number,
        error: trend.slopeStandardError[hoverIndex] as number,
        spread: trend.residualSpread[hoverIndex] as number,
        effective: trend.effectiveCount[hoverIndex] as number,
      }
    : null;
  return (
    <div ref={measureRef} className="w-full">
      <div className="flex flex-wrap gap-3">
        <div style={{ width: half }}>
          <div className="text-[10px] text-foreground/80">Local slope across X, ± 2 standard errors</div>
          {half > 0 && (
            <SeriesChart width={half} x={trend.x} y={trend.slope} lower={lower} upper={upper} reference={{ value: fit.slope, label: "panel slope" }} showZero xLabel={xLabel} hoverIndex={hoverIndex} onHover={setHoverIndex} />
          )}
        </div>
        <div style={{ width: half }}>
          <div className="text-[10px] text-foreground/80">Typical miss of the straight line across X</div>
          {half > 0 && trend.residualSpread.length > 0 && (
            <SeriesChart width={half} x={trend.x} y={trend.residualSpread} reference={{ value: trend.overallResidualSpread, label: "whole panel" }} xLabel={xLabel} hoverIndex={hoverIndex} onHover={setHoverIndex} />
          )}
        </div>
      </div>
      <div className="mt-1 min-h-[18px] font-mono text-[10px] tabular-nums text-foreground/80">
        {hovered ? (
          <span>
            X {formatValue(hovered.x)} · local slope {formatValue(hovered.slope)} ± {formatValue(hovered.error)} (panel {formatValue(fit.slope)}) · typical miss {formatValue(hovered.spread)} (panel {formatValue(trend.overallResidualSpread)}) · ≈ {Math.round(hovered.effective).toLocaleString()} effective bars
          </span>
        ) : (
          <span className="text-muted-foreground">
            Hover either chart. LOESS over the nearest {Math.round(trend.span * 100)}% of bars ({trend.neighbours.toLocaleString()}); ≈ {formatValue(trend.effectiveParameters, 3)} effective parameters; errors widened ×{formatValue(inflation, 2)} for autocorrelation.
          </span>
        )}
      </div>
    </div>
  );
}

export function GroupTable({ clusters, xLabel, yLabel }: { clusters: ClusterSummary; xLabel: string; yLabel: string }) {
  return (
    <div className="space-y-1.5">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-wide text-muted-foreground/70">
            <th className="pb-1 font-medium">group</th>
            <th className="pb-1 text-right font-medium">bars</th>
            <th className="pb-1 text-right font-medium">share</th>
            <th className="pb-1 text-right font-medium" title={xLabel}>centre X</th>
            <th className="pb-1 text-right font-medium" title={yLabel}>centre Y</th>
          </tr>
        </thead>
        <tbody>
          {clusters.sizes.map((size, group) => (
            <tr key={group} className="border-t border-white/[0.04]">
              <td className="py-0.5">
                <span style={{ color: CLUSTER_COLORS[group % CLUSTER_COLORS.length] }}>●</span> {group + 1}
              </td>
              <td className="py-0.5 text-right font-mono tabular-nums">{size.toLocaleString()}</td>
              <td className="py-0.5 text-right font-mono tabular-nums">{((100 * size) / clusters.labels.length).toFixed(1)}%</td>
              <td className="py-0.5 text-right font-mono tabular-nums">{formatValue(clusters.centersDataX[group])}</td>
              <td className="py-0.5 text-right font-mono tabular-nums">{formatValue(clusters.centersDataY[group])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
        <span>silhouette by k:</span>
        {clusters.silhouetteByK.map((entry) => (
          <span key={entry.k} className={`font-mono tabular-nums ${entry.k === clusters.k ? "text-foreground" : ""}`}>
            {entry.k}: {formatValue(entry.silhouette, 2)}
          </span>
        ))}
        <span>→ {clusters.structure === "none" ? "no real grouping (below 0.25)" : `${clusters.structure} grouping`}</span>
      </div>
    </div>
  );
}
