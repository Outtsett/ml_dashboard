/**
 * One scatter: points on a canvas, the fitted line and both bands in SVG.
 *
 * The canvas carries the points because a panel can hold 20,000 of them and
 * forty panels sit on screen at once; the SVG carries everything that has to
 * stay crisp and legible. Shapes, not only hues, carry meaning:
 *   · small dot        an ordinary bar
 *   ◆ diamond          vertical outlier (|externally studentized residual| over the Bonferroni cut-off)
 *   ○ ring             influential point (Cook's distance over its cut-off)
 *   filled band        where the fitted mean is, at the chosen confidence
 *   dashed pair        where a new bar is expected to land
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { RegressionFit, RegressionPairs } from "@shared/regression/types";
import {
  REGRESSION_COLORS,
  RESIZE_SETTLE_MILLISECONDS,
  RESIZING_POINT_BUDGET,
  formatValue,
  linearScale,
  niceTicks,
  paddedExtent,
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
}

function percentile(values: Float64Array, quantile: number): number {
  const sorted = Float64Array.from(values).sort();
  const position = quantile * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return (sorted[low] as number) + ((sorted[high] as number) - (sorted[low] as number)) * (position - low);
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
  const pointBudget = resizing ? Math.min(maxBackgroundPoints, RESIZING_POINT_BUDGET) : maxBackgroundPoints;
  const clipId = `regression-clip-${useId().replace(/:/g, "")}`;
  const margin = compact
    ? { left: 40, right: 6, top: 6, bottom: 18 }
    : { left: 64, right: 14, top: 12, bottom: 40 };
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


  // ── Points (canvas) ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onScreen) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * ratio);
    canvas.height = Math.round(innerHeight * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, innerWidth, innerHeight);

    const count = fit.n;
    const flagged = (index: number) => fit.verticalOutlier[index] === 1 || fit.influential[index] === 1;
    let ordinary = 0;
    for (let index = 0; index < count; index += 1) if (!flagged(index)) ordinary += 1;
    const stride = Math.max(1, Math.ceil(ordinary / pointBudget));

    const radius = compact ? 1.4 : 1.8;
    context.fillStyle = REGRESSION_COLORS.point;
    context.globalAlpha = compact ? 0.5 : 0.55;
    let seen = 0;
    for (let index = 0; index < count; index += 1) {
      if (flagged(index)) continue;
      seen += 1;
      if (seen % stride !== 0) continue;
      const px = xScale(pairs.x[index] as number);
      const py = yScale(pairs.y[index] as number);
      if (px < -2 || px > innerWidth + 2 || py < -2 || py > innerHeight + 2) continue;
      context.beginPath();
      context.arc(px, py, radius, 0, Math.PI * 2);
      context.fill();
    }

    context.globalAlpha = 0.95;
    context.lineWidth = 1.2;
    context.strokeStyle = REGRESSION_COLORS.influential;
    const ring = compact ? 3.2 : 4.2;
    for (let index = 0; index < count; index += 1) {
      if (fit.influential[index] !== 1) continue;
      const px = xScale(pairs.x[index] as number);
      const py = yScale(pairs.y[index] as number);
      context.beginPath();
      context.arc(px, py, ring, 0, Math.PI * 2);
      context.stroke();
    }
    context.fillStyle = REGRESSION_COLORS.verticalOutlier;
    const diamond = compact ? 3.2 : 4.4;
    for (let index = 0; index < count; index += 1) {
      if (fit.verticalOutlier[index] !== 1) continue;
      const px = xScale(pairs.x[index] as number);
      const py = yScale(pairs.y[index] as number);
      context.beginPath();
      context.moveTo(px, py - diamond);
      context.lineTo(px + diamond, py);
      context.lineTo(px, py + diamond);
      context.lineTo(px - diamond, py);
      context.closePath();
      context.fill();
    }
    context.globalAlpha = 1;
  }, [pairs, fit, xScale, yScale, innerWidth, innerHeight, compact, pointBudget, onScreen]);

  // ── Hover: nearest point in pixel space ─────────────────────────────────
  const nearestIndex = (event: MouseEvent<SVGRectElement>): number | null => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - bounds.left;
    const mouseY = event.clientY - bounds.top;
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
  const highlight =
    highlightIndex !== null && highlightIndex >= 0 && highlightIndex < fit.n
      ? { x: xScale(pairs.x[highlightIndex] as number), y: yScale(pairs.y[highlightIndex] as number) }
      : null;

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
          <g clipPath={`url(#${clipId})`}>
            {confidencePath && <path d={confidencePath} fill={REGRESSION_COLORS.confidenceBand} stroke="none" />}
            {showPrediction && (
              <>
                <path d={line(band.predictionLower)} fill="none" stroke={REGRESSION_COLORS.predictionBand} strokeWidth={1} strokeDasharray="4 3" opacity={0.85} />
                <path d={line(band.predictionUpper)} fill="none" stroke={REGRESSION_COLORS.predictionBand} strokeWidth={1} strokeDasharray="4 3" opacity={0.85} />
              </>
            )}
            <path d={line(band.fitted)} fill="none" stroke={REGRESSION_COLORS.fit} strokeWidth={compact ? 1.6 : 2} />
            {refitLine && <path d={refitLine} fill="none" stroke={REGRESSION_COLORS.refit} strokeWidth={compact ? 1.4 : 1.8} strokeDasharray="6 3" />}
            {probeX !== null && Number.isFinite(probeX) && (
              <line x1={xScale(probeX)} x2={xScale(probeX)} y1={0} y2={innerHeight} stroke={REGRESSION_COLORS.fit} strokeDasharray="2 3" opacity={0.7} />
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
          {(onHover || onSelect) && (
            <rect
              x={0}
              y={0}
              width={innerWidth}
              height={innerHeight}
              fill="transparent"
              style={{ cursor: "crosshair" }}
              onMouseMove={(event) => onHover?.(nearestIndex(event))}
              onMouseLeave={() => onHover?.(null)}
              onClick={(event) => {
                const index = nearestIndex(event);
                if (index !== null) onSelect?.(index);
              }}
            />
          )}
        </g>
      </svg>
    </div>
  );
}
