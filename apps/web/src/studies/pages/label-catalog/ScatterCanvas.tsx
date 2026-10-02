/**
 * Realised return against the trailing volatility scale, up to 20,000 rows,
 * each drawn in its label's shape and colour (▲ up, ▼ down, ● flat, ■ a
 * cividis ramp for wider vocabularies). Points go on a canvas; axes, the zero
 * line, the zoom rectangle and the hover card are SVG/HTML on top.
 *
 * Drag a rectangle to zoom, double-click (or Reset) to see everything, click
 * a class in the legend to hide or show it, hover a point for its numbers.
 */

import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { ScatterPoint } from "@shared/studies/label-catalog";
import type { LabelDomain } from "@/market/components/labelMarkerStyle";
import { useMeasuredWidth } from "@/market/regression/ScatterPlot";
import { linearScale, niceTicks, paddedExtent } from "@/market/regression/scales";
import { fmt } from "@/studies/kit";
import { drawPoint, labelStyle } from "./classes";

const HEIGHT = 340;
const MARGIN = { top: 10, right: 12, bottom: 34, left: 52 };
const HOVER_RADIUS = 10;

type Extent = [number, number];

function extentOf(values: number[]): Extent {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return paddedExtent(min, max);
}

export function ScatterCanvas({ points, domain, xLabel, yLabel }: { points: readonly ScatterPoint[]; domain: LabelDomain; xLabel: string; yLabel: string }) {
  const [containerRef, width] = useMeasuredWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [zoom, setZoom] = useState<{ x: Extent; y: Extent } | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [hover, setHover] = useState<{ point: ScatterPoint; x: number; y: number } | null>(null);

  const classKeys = [...new Set(points.map((point) => (point.label === null ? "null" : String(point.label))))].sort((a, b) => Number(a) - Number(b));
  const showClassLegend = domain.kind === "signed" || classKeys.length <= 6;
  const visible = points.filter((point) => !hidden.includes(point.label === null ? "null" : String(point.label)));

  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const xDomain = zoom?.x ?? extentOf(points.map((point) => point.volatility));
  const yDomain = zoom?.y ?? extentOf(points.map((point) => point.returnPoints));
  const x = linearScale(xDomain, [0, plotWidth]);
  const y = linearScale(yDomain, [plotHeight, 0]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(plotWidth * ratio);
    canvas.height = Math.round(plotHeight * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, plotWidth, plotHeight);
    context.globalAlpha = 0.45;
    for (const point of visible) {
      const px = x(point.volatility);
      const py = y(point.returnPoints);
      if (px < -4 || px > plotWidth + 4 || py < -4 || py > plotHeight + 4) continue;
      const style = labelStyle(point.label, domain);
      context.fillStyle = style.color;
      drawPoint(context, px, py, style.shape, 1.8 * style.size);
    }
    context.globalAlpha = 1;
  });

  const local = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { px: event.clientX - box.left - MARGIN.left, py: event.clientY - box.top - MARGIN.top };
  };

  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    const { px, py } = local(event);
    if (drag) {
      setDrag({ ...drag, x1: px, y1: py });
      return;
    }
    let best: ScatterPoint | null = null;
    let bestDistance = HOVER_RADIUS * HOVER_RADIUS;
    for (const point of visible) {
      const dx = x(point.volatility) - px;
      const dy = y(point.returnPoints) - py;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }
    setHover(best ? { point: best, x: x(best.volatility), y: y(best.returnPoints) } : null);
  };

  const onUp = () => {
    if (drag && Math.abs(drag.x1 - drag.x0) > 6 && Math.abs(drag.y1 - drag.y0) > 6) {
      const xs: Extent = [x.invert(Math.min(drag.x0, drag.x1)), x.invert(Math.max(drag.x0, drag.x1))];
      const ys: Extent = [y.invert(Math.max(drag.y0, drag.y1)), y.invert(Math.min(drag.y0, drag.y1))];
      setZoom({ x: xs, y: ys });
    }
    setDrag(null);
  };

  const xTicks = niceTicks(xDomain[0], xDomain[1], Math.max(3, Math.floor(plotWidth / 90)));
  const yTicks = niceTicks(yDomain[0], yDomain[1], 5);
  const zeroVisible = yDomain[0] < 0 && yDomain[1] > 0;

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
        {showClassLegend ? (
          classKeys.map((key) => {
            const style = labelStyle(key === "null" ? null : Number(key), domain);
            const off = hidden.includes(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={!off}
                onClick={() => setHidden(off ? hidden.filter((item) => item !== key) : [...hidden, key])}
                className={`rounded border px-1.5 py-0.5 ${off ? "border-neutral-800 text-neutral-600 line-through" : "border-neutral-700"}`}
                style={off ? undefined : { color: style.color }}
                title={off ? "Show this label" : "Hide this label"}
              >
                {style.name}
              </button>
            );
          })
        ) : (
          <span className="flex items-center gap-1">
            ■ label {fmt(domain.min, 2)}
            <span className="inline-block h-2 w-24 rounded" style={{ background: `linear-gradient(to right, ${labelStyle(domain.min, domain).color}, ${labelStyle((domain.min + domain.max) / 2, domain).color}, ${labelStyle(domain.max, domain).color})` }} />
            {fmt(domain.max, 2)} (cividis: darker is lower)
          </span>
        )}
        <span className="ml-auto">drag to zoom · double-click to reset</span>
        {zoom && (
          <button type="button" onClick={() => setZoom(null)} className="rounded border border-neutral-700 px-2 py-0.5 hover:border-neutral-500">
            Reset zoom
          </button>
        )}
      </div>
      <div
        ref={containerRef}
        className="relative w-full select-none"
        style={{ height: HEIGHT }}
        onMouseMove={onMove}
        onMouseDown={(event) => {
          const { px, py } = local(event);
          setDrag({ x0: px, y0: py, x1: px, y1: py });
          setHover(null);
        }}
        onMouseUp={onUp}
        onMouseLeave={() => {
          setDrag(null);
          setHover(null);
        }}
        onDoubleClick={() => setZoom(null)}
      >
        <canvas
          ref={canvasRef}
          className="absolute"
          style={{ left: MARGIN.left, top: MARGIN.top, width: plotWidth, height: plotHeight }}
        />
        <svg className="pointer-events-none absolute inset-0" width={width} height={HEIGHT}>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            <rect width={plotWidth} height={plotHeight} fill="none" stroke="#3f3f46" />
            {xTicks.map((tick) => (
              <g key={`x${tick}`} transform={`translate(${x(tick)},${plotHeight})`}>
                <line y2={4} stroke="#71717a" />
                <text y={15} textAnchor="middle" fontSize={10} fill="#a1a1aa">{fmt(tick, Math.abs(tick) >= 10 ? 0 : 1)}</text>
              </g>
            ))}
            {yTicks.map((tick) => (
              <g key={`y${tick}`} transform={`translate(0,${y(tick)})`}>
                <line x2={-4} stroke="#71717a" />
                <text x={-6} dy="0.32em" textAnchor="end" fontSize={10} fill="#a1a1aa">{fmt(tick, Math.abs(tick) >= 10 ? 0 : 1)}</text>
              </g>
            ))}
            {zeroVisible && <line x1={0} x2={plotWidth} y1={y(0)} y2={y(0)} stroke="#a1a1aa" strokeDasharray="4 3" />}
            {drag && (
              <rect
                x={Math.min(drag.x0, drag.x1)}
                y={Math.min(drag.y0, drag.y1)}
                width={Math.abs(drag.x1 - drag.x0)}
                height={Math.abs(drag.y1 - drag.y0)}
                fill="#56B4E9"
                fillOpacity={0.12}
                stroke="#56B4E9"
              />
            )}
            {hover && <circle cx={hover.x} cy={hover.y} r={5} fill="none" stroke="#fafafa" />}
            <text x={plotWidth / 2} y={plotHeight + 30} textAnchor="middle" fontSize={10} fill="#d4d4d8">{xLabel}</text>
            <text transform={`translate(${-40},${plotHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize={10} fill="#d4d4d8">{yLabel}</text>
          </g>
        </svg>
        {hover && (
          <div
            className="pointer-events-none absolute z-10 rounded border border-neutral-700 bg-neutral-950/95 px-2 py-1 text-[11px] text-neutral-200"
            style={{ left: Math.min(MARGIN.left + hover.x + 10, Math.max(0, width - 190)), top: Math.max(0, MARGIN.top + hover.y - 48) }}
          >
            <div>{labelStyle(hover.point.label, domain).name}</div>
            <div className="font-mono tnum">trailing volatility {fmt(hover.point.volatility, 3)} points</div>
            <div className="font-mono tnum">realised return {fmt(hover.point.returnPoints, 3)} points</div>
            <div className="font-mono tnum">return / volatility {fmt(hover.point.volatility > 0 ? hover.point.returnPoints / hover.point.volatility : null, 3)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
