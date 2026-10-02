/**
 * One scatter: the points and the density regions on a canvas, the lines,
 * bands, histograms and cursor overlays in SVG.
 *
 * The canvas carries the points because a panel can hold 20,000 of them and
 * forty panels sit on screen at once; the SVG carries everything that has to
 * stay crisp and legible. Shapes, not only hues, carry meaning:
 *   · small dot        an ordinary bar (its colour and size can encode time,
 *                      volatility, volume, residual or group — see encoding.ts)
 *   ◆ diamond          vertical outlier (|externally studentized residual| over the Bonferroni cut-off)
 *   ○ ring             influential point (Cook's distance over its cut-off)
 *   filled band        where the fitted mean is, at the chosen confidence
 *   dashed pair        where a new bar is expected to land
 *   white curve        the local trend (LOESS), with its own faint band
 *   nested outlines    where the densest 50%, 80% and 95% of bars sit (95% dashed)
 *   edge histograms    the distribution of X (top) and of Y (right), median ticked
 * Under the pointer: a hairline, the local slope drawn as a short tangent,
 * the histogram bins the cursor sits in, and a tooltip with the numbers.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { contours } from "d3-contour";
import { trendAt, type DensityGrid, type LocalTrend, type MarginalHistogram } from "@shared/regression/index";
import type { RegressionFit, RegressionPairs } from "@shared/regression/types";
import type { PanelContext } from "./panels";
import { CLUSTER_COLORS, pointStyle, type PointEncodingInput, type ScatterLayers } from "./encoding";
import { ScatterTooltip, type CursorState, type TooltipSource } from "./ScatterTooltip";
import {
  REGRESSION_COLORS,
  RESIZE_SETTLE_MILLISECONDS,
  RESIZING_POINT_BUDGET,
  formatValue,
  linearScale,
  niceTicks,
  paddedExtent,
  type LinearScale,
} from "./scales";

export function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export interface ScatterPlotProps {
  width: number;
  height: number;
  pairs: RegressionPairs;
  fit: RegressionFit;
  refit?: RegressionFit | null;
  showConfidence: boolean;
  showPrediction: boolean;
  compact?: boolean;
  /** Ordinary points drawn at most; flagged points are always all drawn. */
  maxBackgroundPoints?: number;
  /** Axes from the 0.5th to 99.5th percentile instead of the full range. */
  clipToPercentiles?: boolean;
  xLabel?: string;
  yLabel?: string;
  highlightIndex?: number | null;
  /** A vertical guide at this X, e.g. the formula's probe. */
  probeX?: number | null;
  onHover?: (index: number | null) => void;
  onSelect?: (index: number) => void;
  /** Density, local trend, marginals and groups computed with the fit. */
  context?: PanelContext | null;
  layers?: ScatterLayers;
  encoding?: PointEncodingInput | null;
  /** When given, a tooltip follows the cursor. */
  tooltip?: TooltipSource | null;
}

const NO_LAYERS: ScatterLayers = { density: false, marginals: false, trend: false };

function percentile(values: Float64Array, quantile: number): number {
  const sorted = Float64Array.from(values).sort();
  const position = quantile * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return (sorted[low] as number) + ((sorted[high] as number) - (sorted[low] as number)) * (position - low);
}

interface ContourShape {
  coverage: number;
  d: string;
  /** Topmost point of the contour, for its label. */
  top: { x: number; y: number } | null;
}

/** The highest-density contours as pixel paths, widest (95%) first. */
function contourShapes(grid: DensityGrid, xScale: LinearScale, yScale: LinearScale): ContourShape[] {
  const cellX = (grid.maximumX - grid.minimumX) / grid.columns;
  const cellY = (grid.maximumY - grid.minimumY) / grid.rows;
  // d3-contour returns one shape per threshold, sorted ascending, keeping
  // duplicates; pair them by position so two tied levels keep their own
  // coverages (the wider region has the lower threshold).
  const ordered = [...grid.levels].sort((left, right) => left.threshold - right.threshold || right.coverage - left.coverage);
  const generator = contours()
    .size([grid.columns, grid.rows])
    .thresholds(ordered.map((level) => level.threshold));
  return generator(Array.from(grid.values)).map((shape, order) => {
    const coverage = ordered[order]?.coverage ?? Number.NaN;
    let d = "";
    let topX = Number.NaN;
    let topY = Number.POSITIVE_INFINITY;
    for (const polygon of shape.coordinates) {
      for (const ring of polygon) {
        for (let index = 0; index < ring.length; index += 1) {
          const point = ring[index] as number[];
          const px = xScale(grid.minimumX + (point[0] as number) * cellX);
          const py = yScale(grid.minimumY + (point[1] as number) * cellY);
          d += `${index === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
          if (py < topY) {
            topX = px;
            topY = py;
          }
        }
        d += "Z";
      }
    }
    return { coverage, d, top: Number.isFinite(topY) ? { x: topX, y: topY } : null };
  });
}

/** A polyline through the finite points, broken where a value is missing. */
function curvePath(xs: number[], ys: number[], xScale: LinearScale, yScale: LinearScale): string {
  let d = "";
  let pen = false;
  xs.forEach((x, index) => {
    const y = ys[index] as number;
    if (!Number.isFinite(y)) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${xScale(x).toFixed(1)},${yScale(y).toFixed(1)}`;
    pen = true;
  });
  return d;
}

function bandPath(trend: LocalTrend, xScale: LinearScale, yScale: LinearScale): string {
  const finite = trend.x.map((_, index) => index).filter((index) => Number.isFinite(trend.lower[index] as number));
  if (finite.length < 2) return "";
  const upper = finite.map((index, order) => `${order === 0 ? "M" : "L"}${xScale(trend.x[index] as number).toFixed(1)},${yScale(trend.upper[index] as number).toFixed(1)}`);
  const lower = [...finite].reverse().map((index) => `L${xScale(trend.x[index] as number).toFixed(1)},${yScale(trend.lower[index] as number).toFixed(1)}`);
  return `${upper.join("")}${lower.join("")}Z`;
}

function binOf(histogram: MarginalHistogram, value: number): number {
  const bins = histogram.counts.length;
  const bin = Math.floor((value - histogram.minimum) / histogram.binWidth);
  // The top edge belongs to the last bin, as marginalHistogram counts it.
  if (bin === bins && value <= histogram.minimum + bins * histogram.binWidth) return bins - 1;
  return bin >= 0 && bin < bins ? bin : -1;
}

/** Histogram of X along the top edge, bars growing up from the plot. */
function TopMarginal({ histogram, xScale, depth, gap, activeX, compact }: {
  histogram: MarginalHistogram; xScale: LinearScale; depth: number; gap: number; activeX: number | null; compact: boolean;
}) {
  const tallest = Math.max(...histogram.counts);
  const active = activeX !== null ? binOf(histogram, activeX) : -1;
  const [q25, median, q75] = histogram.quartiles;
  return (
    <g>
      {Array.from(histogram.counts, (count, bin) => {
        const left = xScale(histogram.minimum + bin * histogram.binWidth);
        const right = xScale(histogram.minimum + (bin + 1) * histogram.binWidth);
        const height = tallest > 0 ? (count / tallest) * depth : 0;
        return (
          <rect key={bin} x={left} y={-gap - height} width={Math.max(0.5, right - left - 0.5)} height={height}
            fill={bin === active ? REGRESSION_COLORS.marginalActive : REGRESSION_COLORS.marginal} />
        );
      })}
      {!compact && <line x1={xScale(q25)} x2={xScale(q75)} y1={-gap + 1.5} y2={-gap + 1.5} stroke="rgba(255,255,255,0.75)" strokeWidth={2} />}
      <line x1={xScale(median)} x2={xScale(median)} y1={-gap - depth} y2={-gap + 2} stroke={REGRESSION_COLORS.fit} strokeWidth={1.2} />
    </g>
  );
}

/** Histogram of Y along the right edge, bars growing right from the plot. */
function RightMarginal({ histogram, yScale, left, depth, activeY, compact }: {
  histogram: MarginalHistogram; yScale: LinearScale; left: number; depth: number; activeY: number | null; compact: boolean;
}) {
  const tallest = Math.max(...histogram.counts);
  const active = activeY !== null ? binOf(histogram, activeY) : -1;
  const [q25, median, q75] = histogram.quartiles;
  return (
    <g>
      {Array.from(histogram.counts, (count, bin) => {
        const bottom = yScale(histogram.minimum + bin * histogram.binWidth);
        const top = yScale(histogram.minimum + (bin + 1) * histogram.binWidth);
        const width = tallest > 0 ? (count / tallest) * depth : 0;
        return (
          <rect key={bin} x={left} y={top} width={width} height={Math.max(0.5, bottom - top - 0.5)}
            fill={bin === active ? REGRESSION_COLORS.marginalActive : REGRESSION_COLORS.marginal} />
        );
      })}
      {!compact && <line x1={left - 1.5} x2={left - 1.5} y1={yScale(q25)} y2={yScale(q75)} stroke="rgba(255,255,255,0.75)" strokeWidth={2} />}
      <line x1={left - 2} x2={left + depth} y1={yScale(median)} y2={yScale(median)} stroke={REGRESSION_COLORS.fit} strokeWidth={1.2} />
    </g>
  );
}

export function ScatterPlot({
  width,
  height,
  pairs,
  fit,
  refit,
  showConfidence,
  showPrediction,
  compact = false,
  maxBackgroundPoints = Number.POSITIVE_INFINITY,
  clipToPercentiles = false,
  xLabel,
  yLabel,
  highlightIndex = null,
  probeX = null,
  onHover,
  onSelect,
  context = null,
  layers = NO_LAYERS,
  encoding = null,
  tooltip = null,
}: ScatterPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // A grid holds dozens of panels; only those near the viewport paint. An
  // off-screen panel draws when it scrolls in, and skips every redraw a
  // resize would otherwise cost it.
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    // Observe against the container that actually scrolls: rootMargin only
    // grows the ROOT's box, so against the window it would do nothing for a
    // grid scrolling inside a panel.
    let scroller: HTMLElement | null = element.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const observer = new IntersectionObserver((entries) => setOnScreen(entries.some((entry) => entry.isIntersecting)), {
      root: scroller,
      rootMargin: "300px 0px",
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // While the width is changing (a panel being dragged), draw a light cloud
  // so every frame stays cheap; the full budget follows once it settles.
  const [resizing, setResizing] = useState(false);
  const previousWidthRef = useRef(width);
  useEffect(() => {
    if (previousWidthRef.current === width) return;
    previousWidthRef.current = width;
    setResizing(true);
    const timer = window.setTimeout(() => setResizing(false), RESIZE_SETTLE_MILLISECONDS);
    return () => window.clearTimeout(timer);
  }, [width]);
  const [cursor, setCursor] = useState<CursorState | null>(null);
  const pointBudget = resizing ? Math.min(maxBackgroundPoints, RESIZING_POINT_BUDGET) : maxBackgroundPoints;
  const clipId = `regression-clip-${useId().replace(/:/g, "")}`;

  const marginals = layers.marginals && context?.marginalX && context.marginalY ? { x: context.marginalX, y: context.marginalY } : null;
  const stripDepth = compact ? 14 : 34;
  const stripGap = compact ? 2 : 4;
  const stripSpace = marginals ? stripDepth + stripGap : 0;
  const margin = compact
    ? { left: 40, right: 6 + stripSpace, top: 6 + stripSpace, bottom: 18 }
    : { left: 64, right: 14 + stripSpace, top: 12 + stripSpace, bottom: 40 };
  const innerWidth = Math.max(10, width - margin.left - margin.right);
  const innerHeight = Math.max(10, height - margin.top - margin.bottom);

  let [xMin, xMax] = [fit.minimumX, fit.maximumX];
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  if (clipToPercentiles && pairs.x.length > 20) {
    xMin = percentile(pairs.x, 0.005);
    xMax = percentile(pairs.x, 0.995);
    yMin = percentile(pairs.y, 0.005);
    yMax = percentile(pairs.y, 0.995);
  } else {
    for (const value of pairs.y) {
      if (value < yMin) yMin = value;
      if (value > yMax) yMax = value;
    }
  }
  if (showPrediction && !clipToPercentiles) {
    for (const value of fit.band.predictionLower) yMin = Math.min(yMin, value);
    for (const value of fit.band.predictionUpper) yMax = Math.max(yMax, value);
  }
  const xScale = linearScale(paddedExtent(xMin, xMax), [0, innerWidth]);
  const yScale = linearScale(paddedExtent(yMin, yMax), [innerHeight, 0]);

  const style = pointStyle(encoding, pairs, fit, context?.clusters ?? null);
  const density = layers.density && context?.density ? contourShapes(context.density, xScale, yScale) : null;
  const trend = layers.trend && context?.trend ? context.trend : null;

  // ── Density regions and points (canvas) ──────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onScreen) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * ratio);
    canvas.height = Math.round(innerHeight * ratio);
    const context2d = canvas.getContext("2d");
    if (!context2d) return;
    context2d.setTransform(ratio, 0, 0, ratio, 0, 0);
    context2d.clearRect(0, 0, innerWidth, innerHeight);

    // Under the points: each region's fill stacks on the wider ones, so the
    // densest half reads brightest; outlines keep them apart, the 95% dashed.
    if (density) {
      for (const shape of density) {
        const path = new Path2D(shape.d);
        context2d.fillStyle = REGRESSION_COLORS.densityFill;
        context2d.fill(path, "evenodd");
        context2d.strokeStyle = REGRESSION_COLORS.densityLine;
        context2d.lineWidth = shape.coverage >= 0.95 ? 0.8 : 1;
        context2d.setLineDash(shape.coverage >= 0.95 ? [3, 3] : []);
        context2d.stroke(path);
      }
      context2d.setLineDash([]);
    }

    const count = fit.n;
    const flagged = (index: number) => fit.verticalOutlier[index] === 1 || fit.influential[index] === 1;
    let ordinary = 0;
    for (let index = 0; index < count; index += 1) if (!flagged(index)) ordinary += 1;
    const stride = Math.max(1, Math.ceil(ordinary / pointBudget));

    // One path per colour: far fewer fills than one per point.
    const missing: number[] = [];
    const buckets: number[][] = Array.from({ length: style.bucketCount }, () => []);
    let seen = 0;
    for (let index = 0; index < count; index += 1) {
      if (flagged(index)) continue;
      seen += 1;
      if (seen % stride !== 0) continue;
      const bucket = style.bucketOf(index);
      if (bucket >= 0 && bucket < style.bucketCount) buckets[bucket]!.push(index);
      else missing.push(index);
    }
    const radius = compact ? 1.4 : 1.8;
    context2d.globalAlpha = compact ? 0.55 : 0.6;
    const drawDots = (indices: number[], color: string) => {
      if (indices.length === 0) return;
      context2d.fillStyle = color;
      context2d.beginPath();
      for (const index of indices) {
        const px = xScale(pairs.x[index] as number);
        const py = yScale(pairs.y[index] as number);
        if (px < -2 || px > innerWidth + 2 || py < -2 || py > innerHeight + 2) continue;
        const size = radius * style.sizeOf(index);
        context2d.moveTo(px + size, py);
        context2d.arc(px, py, size, 0, Math.PI * 2);
      }
      context2d.fill();
    };
    drawDots(missing, "rgba(150, 150, 150, 0.75)");
    for (const bucket of style.drawOrder) drawDots(buckets[bucket] ?? [], style.colorOf(bucket));

    context2d.globalAlpha = 0.95;
    context2d.lineWidth = 1.2;
    context2d.strokeStyle = REGRESSION_COLORS.influential;
    const ring = compact ? 3.2 : 4.2;
    for (let index = 0; index < count; index += 1) {
      if (fit.influential[index] !== 1) continue;
      const px = xScale(pairs.x[index] as number);
      const py = yScale(pairs.y[index] as number);
      context2d.beginPath();
      context2d.arc(px, py, ring, 0, Math.PI * 2);
      context2d.stroke();
    }
    context2d.fillStyle = REGRESSION_COLORS.verticalOutlier;
    const diamond = compact ? 3.2 : 4.4;
    for (let index = 0; index < count; index += 1) {
      if (fit.verticalOutlier[index] !== 1) continue;
      const px = xScale(pairs.x[index] as number);
      const py = yScale(pairs.y[index] as number);
      context2d.beginPath();
      context2d.moveTo(px, py - diamond);
      context2d.lineTo(px + diamond, py);
      context2d.lineTo(px, py + diamond);
      context2d.lineTo(px - diamond, py);
      context2d.closePath();
      context2d.fill();
    }
    context2d.globalAlpha = 1;
  }, [pairs, fit, xScale, yScale, innerWidth, innerHeight, compact, pointBudget, onScreen, density, style]);

  // ── Hover: nearest point in pixel space ─────────────────────────────────
  const nearestIndex = (mouseX: number, mouseY: number): number | null => {
    let best: number | null = null;
    let bestDistance = 14 * 14;
    for (let index = 0; index < fit.n; index += 1) {
      const dx = xScale(pairs.x[index] as number) - mouseX;
      const dy = yScale(pairs.y[index] as number) - mouseY;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return best;
  };
  const pointer = (event: MouseEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { mouseX: event.clientX - bounds.left, mouseY: event.clientY - bounds.top };
  };
  const onMove = (event: MouseEvent<SVGRectElement>) => {
    const { mouseX, mouseY } = pointer(event);
    const index = nearestIndex(mouseX, mouseY);
    if (tooltip) {
      setCursor({ clientX: event.clientX, clientY: event.clientY, x: xScale.invert(mouseX), y: yScale.invert(mouseY), index });
    }
    onHover?.(index);
  };
  const onLeave = () => {
    setCursor(null);
    onHover?.(null);
  };

  const band = fit.band;
  const confidencePath = showConfidence
    ? band.x.map((x, index) => `${index === 0 ? "M" : "L"}${xScale(x)},${yScale(band.meanUpper[index] as number)}`).join("") +
      band.x
        .map((_, index) => {
          const reverse = band.x.length - 1 - index;
          return `L${xScale(band.x[reverse] as number)},${yScale(band.meanLower[reverse] as number)}`;
        })
        .join("") + "Z"
    : null;
  const line = (values: number[]) =>
    band.x.map((x, index) => `${index === 0 ? "M" : "L"}${xScale(x)},${yScale(values[index] as number)}`).join("");
  const refitLine =
    refit && refit.n > 1
      ? `M${xScale(fit.minimumX)},${yScale(refit.intercept + refit.slope * fit.minimumX)}L${xScale(fit.maximumX)},${yScale(refit.intercept + refit.slope * fit.maximumX)}`
      : null;

  const xTicks = niceTicks(xScale.domain[0], xScale.domain[1], compact ? 3 : 6);
  const yTicks = niceTicks(yScale.domain[0], yScale.domain[1], compact ? 3 : 6);
  const markedIndex = highlightIndex ?? cursor?.index ?? null;
  const highlight =
    markedIndex !== null && markedIndex >= 0 && markedIndex < fit.n
      ? { x: xScale(pairs.x[markedIndex] as number), y: yScale(pairs.y[markedIndex] as number) }
      : null;

  // The local slope under the cursor, drawn as a short tangent on the trend.
  const local = cursor && trend ? trendAt(trend, cursor.x) : null;
  const tangentHalf = (xScale.domain[1] - xScale.domain[0]) * (compact ? 0.09 : 0.07);
  const tangent =
    local && Number.isFinite(local.slope)
      ? {
          x1: xScale(local.x - tangentHalf),
          y1: yScale(local.fitted - local.slope * tangentHalf),
          x2: xScale(local.x + tangentHalf),
          y2: yScale(local.fitted + local.slope * tangentHalf),
          cx: xScale(local.x),
          cy: yScale(local.fitted),
        }
      : null;
  const clusters = encoding?.colorBy === "cluster" ? context?.clusters ?? null : null;
  const interactive = Boolean(onHover || onSelect || tooltip);

  return (
    <div ref={containerRef} className="relative" style={{ width, height }}>
      <canvas
        ref={canvasRef}
        className="absolute"
        style={{ left: margin.left, top: margin.top, width: innerWidth, height: innerHeight }}
      />
      <svg width={width} height={height} className="absolute left-0 top-0" role="img" aria-label={`${yLabel ?? "Y"} against ${xLabel ?? "X"}`}>
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={innerWidth} height={innerHeight} />
          </clipPath>
          <clipPath id={`${clipId}-top`}>
            <rect x={0} y={-stripSpace} width={innerWidth} height={stripSpace} />
          </clipPath>
          <clipPath id={`${clipId}-right`}>
            <rect x={innerWidth} y={0} width={stripSpace} height={innerHeight} />
          </clipPath>
        </defs>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {yTicks.map((tick) => (
            <g key={`y${tick}`}>
              <line x1={0} x2={innerWidth} y1={yScale(tick)} y2={yScale(tick)} stroke={REGRESSION_COLORS.grid} />
              <text x={-4} y={yScale(tick)} dy="0.32em" textAnchor="end" fontSize={compact ? 8 : 10} fill={REGRESSION_COLORS.axis} className="tabular-nums">
                {formatValue(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <g key={`x${tick}`}>
              <line x1={xScale(tick)} x2={xScale(tick)} y1={0} y2={innerHeight} stroke={REGRESSION_COLORS.grid} />
              <text x={xScale(tick)} y={innerHeight + (compact ? 11 : 14)} textAnchor="middle" fontSize={compact ? 8 : 10} fill={REGRESSION_COLORS.axis} className="tabular-nums">
                {formatValue(tick)}
              </text>
            </g>
          ))}
          {marginals && (
            <>
              <g clipPath={`url(#${clipId}-top)`}>
                <TopMarginal histogram={marginals.x} xScale={xScale} depth={stripDepth} gap={stripGap} activeX={cursor?.x ?? null} compact={compact} />
              </g>
              <g clipPath={`url(#${clipId}-right)`}>
                <RightMarginal histogram={marginals.y} yScale={yScale} left={innerWidth + stripGap} depth={stripDepth} activeY={cursor?.y ?? null} compact={compact} />
              </g>
            </>
          )}
          <g clipPath={`url(#${clipId})`}>
            {confidencePath && <path d={confidencePath} fill={REGRESSION_COLORS.confidenceBand} stroke="none" />}
            {showPrediction && (
              <>
                <path d={line(band.predictionLower)} fill="none" stroke={REGRESSION_COLORS.predictionBand} strokeWidth={1} strokeDasharray="4 3" opacity={0.85} />
                <path d={line(band.predictionUpper)} fill="none" stroke={REGRESSION_COLORS.predictionBand} strokeWidth={1} strokeDasharray="4 3" opacity={0.85} />
              </>
            )}
            {trend && (
              <>
                <path d={bandPath(trend, xScale, yScale)} fill={REGRESSION_COLORS.trendBand} stroke="none" />
                <path d={curvePath(trend.x, trend.fitted, xScale, yScale)} fill="none" stroke={REGRESSION_COLORS.trend} strokeWidth={compact ? 1.2 : 1.6} opacity={0.9} />
              </>
            )}
            <path d={line(band.fitted)} fill="none" stroke={REGRESSION_COLORS.fit} strokeWidth={compact ? 1.6 : 2} />
            {refitLine && <path d={refitLine} fill="none" stroke={REGRESSION_COLORS.refit} strokeWidth={compact ? 1.4 : 1.8} strokeDasharray="6 3" />}
            {!compact && density?.map((shape) =>
              shape.top ? (
                <text key={shape.coverage} x={shape.top.x} y={shape.top.y - 3} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.6)" className="tabular-nums">
                  {Math.round(shape.coverage * 100)}%
                </text>
              ) : null,
            )}
            {!compact &&
              clusters?.centersDataX.map((centreX, group) => (
                <g key={group} transform={`translate(${xScale(centreX)},${yScale(clusters.centersDataY[group] as number)})`}>
                  <circle r={8} fill="rgba(0,0,0,0.7)" stroke={CLUSTER_COLORS[group % CLUSTER_COLORS.length]} strokeWidth={2} />
                  <text textAnchor="middle" dy="0.35em" fontSize={10} fontWeight={700} fill="#FFFFFF">{group + 1}</text>
                </g>
              ))}
            {probeX !== null && Number.isFinite(probeX) && (
              <line x1={xScale(probeX)} x2={xScale(probeX)} y1={0} y2={innerHeight} stroke={REGRESSION_COLORS.fit} strokeDasharray="2 3" opacity={0.7} />
            )}
            {cursor && (
              <line x1={xScale(cursor.x)} x2={xScale(cursor.x)} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.22)" />
            )}
            {tangent && (
              <>
                <line x1={tangent.x1} y1={tangent.y1} x2={tangent.x2} y2={tangent.y2} stroke={REGRESSION_COLORS.trend} strokeWidth={compact ? 2 : 2.4} strokeLinecap="round" />
                <circle cx={tangent.cx} cy={tangent.cy} r={compact ? 2.4 : 3} fill={REGRESSION_COLORS.trend} />
              </>
            )}
            {highlight && (
              <circle cx={highlight.x} cy={highlight.y} r={7} fill="none" stroke={REGRESSION_COLORS.highlight} strokeWidth={1.6} />
            )}
          </g>
          <rect x={0} y={0} width={innerWidth} height={innerHeight} fill="none" stroke={REGRESSION_COLORS.grid} />
          {!compact && xLabel && (
            <text x={innerWidth / 2} y={innerHeight + 32} textAnchor="middle" fontSize={11} fill="rgba(255,255,255,0.7)">
              {xLabel}
            </text>
          )}
          {!compact && yLabel && (
            <text transform={`translate(${-50},${innerHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="rgba(255,255,255,0.7)">
              {yLabel}
            </text>
          )}
          {interactive && (
            <rect
              x={0}
              y={0}
              width={innerWidth}
              height={innerHeight}
              fill="transparent"
              style={{ cursor: "crosshair" }}
              onMouseMove={onMove}
              onMouseLeave={onLeave}
              onClick={(event) => {
                if (!onSelect) return;
                const { mouseX, mouseY } = pointer(event);
                const index = nearestIndex(mouseX, mouseY);
                if (index !== null) onSelect(index);
              }}
            />
          )}
        </g>
      </svg>
      {tooltip && cursor && (
        <ScatterTooltip
          cursor={cursor}
          source={tooltip}
          pairs={pairs}
          fit={fit}
          context={context}
          xLabel={xLabel ?? "X"}
          yLabel={yLabel ?? "Y"}
        />
      )}
    </div>
  );
}
