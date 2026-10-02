/**
 * The views behind a scatter: what the residuals do through time, how they
 * are distributed, and whether the mean of Y actually moves across X.
 */

import { useEffect, useRef } from "react";
import type { LensEightNumberSummary } from "@shared/lens/types";
import type { QuantileBuckets, RegressionFit } from "@shared/regression/types";
import { REGRESSION_COLORS, formatProbability, formatValue, linearScale, niceTicks, paddedExtent } from "./scales";
import { useMeasuredWidth } from "./ScatterPlot";

// ─── Residuals through time ──────────────────────────────────────────────────

export function ResidualTimeline({
  fit,
  height = 120,
  highlightIndex,
  onSelect,
}: {
  fit: RegressionFit;
  height?: number;
  highlightIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const [measureRef, width] = useMeasuredWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const margin = { left: 40, right: 8, top: 6, bottom: 16 };
  const innerWidth = Math.max(10, width - margin.left - margin.right);
  const innerHeight = height - margin.top - margin.bottom;

  let limit = fit.verticalOutlierCutoff * 1.15;
  for (const value of fit.studentizedExternal) if (Number.isFinite(value)) limit = Math.max(limit, Math.abs(value));
  const xScale = linearScale([0, Math.max(1, fit.n - 1)], [0, innerWidth]);
  const yScale = linearScale([-limit * 1.05, limit * 1.05], [innerHeight, 0]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * ratio);
    canvas.height = Math.round(innerHeight * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, innerWidth, innerHeight);
    context.fillStyle = REGRESSION_COLORS.point;
    context.globalAlpha = 0.5;
    for (let index = 0; index < fit.n; index += 1) {
      if (fit.verticalOutlier[index] === 1) continue;
      context.fillRect(xScale(index) - 0.6, yScale(fit.studentizedExternal[index] as number) - 0.6, 1.2, 1.2);
    }
    context.globalAlpha = 1;
    context.fillStyle = REGRESSION_COLORS.verticalOutlier;
    for (let index = 0; index < fit.n; index += 1) {
      if (fit.verticalOutlier[index] !== 1) continue;
      const px = xScale(index);
      const py = yScale(fit.studentizedExternal[index] as number);
      context.beginPath();
      context.moveTo(px, py - 3.5);
      context.lineTo(px + 3.5, py);
      context.lineTo(px, py + 3.5);
      context.lineTo(px - 3.5, py);
      context.closePath();
      context.fill();
    }
  }, [fit, width, innerWidth, innerHeight, xScale, yScale]);

  const cutoff = fit.verticalOutlierCutoff;
  return (
    <div ref={measureRef} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <>
          <canvas ref={canvasRef} className="absolute" style={{ left: margin.left, top: margin.top, width: innerWidth, height: innerHeight }} />
          <svg width={width} height={height} className="absolute left-0 top-0">
            <g transform={`translate(${margin.left},${margin.top})`}>
              {[-cutoff, 0, cutoff].map((value) => (
                <g key={value}>
                  <line x1={0} x2={innerWidth} y1={yScale(value)} y2={yScale(value)} stroke={value === 0 ? REGRESSION_COLORS.axis : REGRESSION_COLORS.verticalOutlier} strokeDasharray={value === 0 ? undefined : "4 3"} opacity={value === 0 ? 0.5 : 0.8} />
                  <text x={-4} y={yScale(value)} dy="0.32em" textAnchor="end" fontSize={9} fill={REGRESSION_COLORS.axis}>
                    {value === 0 ? "0" : `${value > 0 ? "+" : "−"}${formatValue(Math.abs(value))}`}
                  </text>
                </g>
              ))}
              {highlightIndex !== null && (
                <line x1={xScale(highlightIndex)} x2={xScale(highlightIndex)} y1={0} y2={innerHeight} stroke={REGRESSION_COLORS.highlight} opacity={0.7} />
              )}
              <text x={innerWidth} y={innerHeight + 12} textAnchor="end" fontSize={9} fill={REGRESSION_COLORS.axis}>
                oldest → newest bar in the fit
              </text>
              <rect
                x={0}
                y={0}
                width={innerWidth}
                height={innerHeight}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  onSelect(Math.round(xScale.invert(event.clientX - bounds.left)));
                }}
              />
            </g>
          </svg>
        </>
      )}
    </div>
  );
}

// ─── Residual distribution ───────────────────────────────────────────────────

export function ResidualHistogram({ fit, height = 110 }: { fit: RegressionFit; height?: number }) {
  const [measureRef, width] = useMeasuredWidth<HTMLDivElement>();
  const binCount = 40;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of fit.residuals) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  const [low, high] = paddedExtent(minimum, maximum, 0.01);
  const counts = new Array<number>(binCount).fill(0);
  for (const value of fit.residuals) {
    const bin = Math.min(binCount - 1, Math.max(0, Math.floor(((value - low) / (high - low)) * binCount)));
    counts[bin] = (counts[bin] as number) + 1;
  }
  const peak = Math.max(1, ...counts);
  const margin = { left: 8, right: 8, top: 4, bottom: 16 };
  const innerWidth = Math.max(10, width - margin.left - margin.right);
  const innerHeight = height - margin.top - margin.bottom;
  const binWidth = innerWidth / binCount;
  // Normal curve with the residuals' own mean and deviation, for shape comparison.
  const deviation = fit.residualStandardError;
  const normalPath = Array.from({ length: 81 }, (_, step) => {
    const value = low + ((high - low) * step) / 80;
    const density = Math.exp(-0.5 * (value / deviation) ** 2) / (deviation * Math.sqrt(2 * Math.PI));
    const expected = density * fit.n * ((high - low) / binCount);
    return `${step === 0 ? "M" : "L"}${(innerWidth * step) / 80},${innerHeight - (expected / peak) * innerHeight}`;
  }).join("");
  const ticks = niceTicks(low, high, 4);
  const xScale = linearScale([low, high], [0, innerWidth]);

  return (
    <div ref={measureRef} className="w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {counts.map((count, index) => (
              <rect key={index} x={index * binWidth + 0.5} y={innerHeight - (count / peak) * innerHeight} width={Math.max(0.5, binWidth - 1)} height={(count / peak) * innerHeight} fill={REGRESSION_COLORS.point} opacity={0.7} />
            ))}
            <path d={normalPath} fill="none" stroke={REGRESSION_COLORS.fit} strokeWidth={1.4} strokeDasharray="3 2" />
            {ticks.map((tick) => (
              <text key={tick} x={xScale(tick)} y={innerHeight + 12} textAnchor="middle" fontSize={9} fill={REGRESSION_COLORS.axis}>
                {formatValue(tick)}
              </text>
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}

// ─── Mean Y across quintiles of X ────────────────────────────────────────────

export function BucketMeans({ buckets, height = 140, yUnit }: { buckets: QuantileBuckets; height?: number; yUnit: string }) {
  const [measureRef, width] = useMeasuredWidth<HTMLDivElement>();
  const margin = { left: 52, right: 8, top: 8, bottom: 30 };
  const innerWidth = Math.max(10, width - margin.left - margin.right);
  const innerHeight = height - margin.top - margin.bottom;
  const low = Math.min(...buckets.buckets.map((bucket) => bucket.lower));
  const high = Math.max(...buckets.buckets.map((bucket) => bucket.upper));
  const yScale = linearScale(paddedExtent(low, high, 0.08), [innerHeight, 0]);
  const slot = innerWidth / buckets.buckets.length;

  return (
    <div>
      <div ref={measureRef} className="w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height}>
            <g transform={`translate(${margin.left},${margin.top})`}>
              {niceTicks(yScale.domain[0], yScale.domain[1], 4).map((tick) => (
                <g key={tick}>
                  <line x1={0} x2={innerWidth} y1={yScale(tick)} y2={yScale(tick)} stroke={REGRESSION_COLORS.grid} />
                  <text x={-4} y={yScale(tick)} dy="0.32em" textAnchor="end" fontSize={9} fill={REGRESSION_COLORS.axis}>{formatValue(tick)}</text>
                </g>
              ))}
              {buckets.buckets.map((bucket, index) => {
                const center = slot * index + slot / 2;
                return (
                  <g key={index}>
                    <line x1={center} x2={center} y1={yScale(bucket.lower)} y2={yScale(bucket.upper)} stroke={REGRESSION_COLORS.fit} strokeWidth={1.4} />
                    <line x1={center - 6} x2={center + 6} y1={yScale(bucket.lower)} y2={yScale(bucket.lower)} stroke={REGRESSION_COLORS.fit} />
                    <line x1={center - 6} x2={center + 6} y1={yScale(bucket.upper)} y2={yScale(bucket.upper)} stroke={REGRESSION_COLORS.fit} />
                    <rect x={center - 4} y={yScale(bucket.meanY) - 4} width={8} height={8} fill={REGRESSION_COLORS.fit} />
                    <text x={center} y={innerHeight + 12} textAnchor="middle" fontSize={9} fill={REGRESSION_COLORS.axis}>Q{index + 1}</text>
                    <text x={center} y={innerHeight + 23} textAnchor="middle" fontSize={8} fill={REGRESSION_COLORS.axis}>
                      {formatValue(bucket.minimumX, 2)}–{formatValue(bucket.maximumX, 2)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Top group of X minus bottom group: <span className="font-mono text-foreground/90">{formatValue(buckets.spread)} {yUnit}</span>
        {" "}· Welch t {formatValue(buckets.spreadTStatistic)} · p {formatProbability(buckets.spreadPValue)}.
        Square = mean, whiskers = interval. The interval assumes independent bars inside a fifth, which overlapping
        forward returns are not — read it as optimistic when the horizon is over one bar.
      </p>
    </div>
  );
}

// ─── Eight numbers ───────────────────────────────────────────────────────────

const EIGHT_ROWS: Array<[keyof LensEightNumberSummary, string]> = [
  ["mean", "mean"],
  ["median", "median"],
  ["standardDeviation", "standard deviation"],
  ["skewness", "skewness"],
  ["kurtosis", "excess kurtosis"],
  ["percentile25", "25th percentile"],
  ["percentile75", "75th percentile"],
  ["minimum", "minimum"],
  ["maximum", "maximum"],
];

export function EightNumberTable({ columns }: { columns: Array<{ label: string; summary: LensEightNumberSummary }> }) {
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-[9px] uppercase tracking-wide text-muted-foreground/70">
          <th className="pb-1 text-left font-medium" />
          {columns.map((column) => (
            <th key={column.label} className="pb-1 text-right font-medium">{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {EIGHT_ROWS.map(([key, label]) => (
          <tr key={key} className="border-t border-white/[0.04]">
            <td className="py-0.5 text-muted-foreground">{label}</td>
            {columns.map((column) => (
              <td key={column.label} className="py-0.5 text-right font-mono tabular-nums text-foreground/85">
                {formatValue(column.summary[key] as number | null)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
