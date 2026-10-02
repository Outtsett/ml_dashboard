/**
 * The 20,000-window embedding sample on its first two principal components,
 * drawn on a canvas (SVG would be 20,000 nodes). Every class has its own
 * colour AND its own marker shape, so the classes stay apart without colour.
 * Hover shows the nearest point's exact values; the legend toggles a class.
 */

import { useEffect, useRef, useState } from "react";
import { useMeasuredWidth } from "@/market/regression/ScatterPlot";
import { fmt } from "@/studies/kit";

export type MarkerShape = "circle" | "square" | "triangleUp" | "diamond" | "triangleDown" | "plus";

export const MARKER_SHAPES: MarkerShape[] = ["circle", "square", "triangleUp", "diamond", "triangleDown", "plus"];

export const MARKER_GLYPH: Record<MarkerShape, string> = {
  circle: "●", square: "■", triangleUp: "▲", diamond: "◆", triangleDown: "▼", plus: "✚",
};

export interface ScatterClass {
  key: string;
  label: string;
  color: string;
  shape: MarkerShape;
  count: number;
}

export interface ScatterPoint {
  x: number;
  y: number;
  classKey: string;
  detail: string;
}

const HEIGHT = 420;
const MARGIN = { top: 10, right: 12, bottom: 30, left: 44 };

function drawMarker(context: CanvasRenderingContext2D, shape: MarkerShape, x: number, y: number, size: number) {
  context.beginPath();
  switch (shape) {
    case "circle":
      context.arc(x, y, size, 0, Math.PI * 2);
      context.fill();
      return;
    case "square":
      context.fillRect(x - size, y - size, size * 2, size * 2);
      return;
    case "triangleUp":
      context.moveTo(x, y - size * 1.2);
      context.lineTo(x + size * 1.1, y + size * 0.9);
      context.lineTo(x - size * 1.1, y + size * 0.9);
      break;
    case "triangleDown":
      context.moveTo(x, y + size * 1.2);
      context.lineTo(x + size * 1.1, y - size * 0.9);
      context.lineTo(x - size * 1.1, y - size * 0.9);
      break;
    case "diamond":
      context.moveTo(x, y - size * 1.3);
      context.lineTo(x + size * 1.1, y);
      context.lineTo(x, y + size * 1.3);
      context.lineTo(x - size * 1.1, y);
      break;
    case "plus":
      context.fillRect(x - size * 1.2, y - size * 0.35, size * 2.4, size * 0.7);
      context.fillRect(x - size * 0.35, y - size * 1.2, size * 0.7, size * 2.4);
      return;
  }
  context.closePath();
  context.fill();
}

function ticks(low: number, high: number, count: number): number[] {
  const span = high - low;
  if (!(span > 0)) return [low];
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? raw;
  const out: number[] = [];
  for (let value = Math.ceil(low / step) * step; value <= high + 1e-12; value += step) out.push(Number(value.toFixed(10)));
  return out;
}

export function ProjectionScatter({
  points, classes, hidden, onToggle, pointSize, xLabel, yLabel,
}: {
  points: readonly ScatterPoint[];
  classes: readonly ScatterClass[];
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
  pointSize: number;
  xLabel: string;
  yLabel: string;
}) {
  const [wrapper, width] = useMeasuredWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ point: ScatterPoint; left: number; top: number } | null>(null);

  const byKey = new Map(classes.map((entry) => [entry.key, entry]));
  const shown = points.filter((point) => byKey.has(point.classKey) && !hidden.has(point.classKey));
  const xs = shown.map((point) => point.x);
  const ys = shown.map((point) => point.y);
  const xLow = xs.length ? Math.min(...xs) : 0;
  const xHigh = xs.length ? Math.max(...xs) : 1;
  const yLow = ys.length ? Math.min(...ys) : 0;
  const yHigh = ys.length ? Math.max(...ys) : 1;
  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const scaleX = (value: number) => MARGIN.left + ((value - xLow) / (xHigh - xLow || 1)) * plotWidth;
  const scaleY = (value: number) => MARGIN.top + (1 - (value - yLow) / (yHigh - yLow || 1)) * plotHeight;

  useEffect(() => {
    const element = canvas.current;
    if (!element || width <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(width * ratio);
    element.height = Math.round(HEIGHT * ratio);
    const context = element.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, HEIGHT);
    context.strokeStyle = "#333";
    context.fillStyle = "#8a8a8a";
    context.font = "10px ui-monospace, monospace";
    context.lineWidth = 1;
    for (const tick of ticks(xLow, xHigh, 6)) {
      const x = scaleX(tick);
      context.beginPath(); context.moveTo(x, MARGIN.top); context.lineTo(x, MARGIN.top + plotHeight); context.stroke();
      context.fillText(fmt(tick, 1), x - 8, HEIGHT - MARGIN.bottom + 12);
    }
    for (const tick of ticks(yLow, yHigh, 5)) {
      const y = scaleY(tick);
      context.beginPath(); context.moveTo(MARGIN.left, y); context.lineTo(MARGIN.left + plotWidth, y); context.stroke();
      context.fillText(fmt(tick, 1), 4, y + 3);
    }
    context.fillStyle = "#a3a3a3";
    context.fillText(xLabel, MARGIN.left + plotWidth / 2 - 40, HEIGHT - 4);
    context.save();
    context.translate(10, MARGIN.top + plotHeight / 2 + 40);
    context.rotate(-Math.PI / 2);
    context.fillText(yLabel, 0, 0);
    context.restore();
    context.globalAlpha = 0.75;
    for (const point of shown) {
      const entry = byKey.get(point.classKey);
      if (!entry) continue;
      context.fillStyle = entry.color;
      drawMarker(context, entry.shape, scaleX(point.x), scaleY(point.y), pointSize);
    }
    context.globalAlpha = 1;
  });

  const onMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const mx = event.clientX - box.left;
    const my = event.clientY - box.top;
    let best: ScatterPoint | null = null;
    let bestDistance = 64;
    for (const point of shown) {
      const dx = scaleX(point.x) - mx;
      const dy = scaleY(point.y) - my;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) { bestDistance = distance; best = point; }
    }
    setHover(best ? { point: best, left: mx, top: my } : null);
  };

  return (
    <div className="space-y-2">
      <div ref={wrapper} className="relative min-w-0">
        <canvas ref={canvas} style={{ width: "100%", height: HEIGHT }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        {hover && (
          <div
            className="pointer-events-none absolute z-10 whitespace-pre rounded border border-neutral-700 bg-neutral-900/95 px-2 py-1 font-mono text-[10px] text-neutral-200"
            style={{ left: Math.min(hover.left + 10, Math.max(0, width - 220)), top: Math.max(0, hover.top - 60) }}
          >
            {hover.point.detail}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {classes.map((entry) => {
          const off = hidden.has(entry.key);
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => onToggle(entry.key)}
              aria-pressed={!off}
              className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${off ? "border-neutral-800 text-neutral-600 line-through" : "border-neutral-700 text-neutral-200"}`}
              title={`${entry.label}: ${entry.count.toLocaleString("en-US")} points; click to ${off ? "show" : "hide"}`}
            >
              <span style={{ color: entry.color }}>{MARKER_GLYPH[entry.shape]}</span>
              {entry.label}
              <span className="font-mono text-neutral-500">{entry.count.toLocaleString("en-US")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
