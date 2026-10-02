/**
 * The vector space — every bar of a run as a point, drawn on a canvas.
 *
 * Canvas, not SVG: 4,000 points is already 4,000 DOM nodes and a run can carry
 * far more, so an SVG scatter spends its whole frame budget on layout and
 * hover stops feeling attached to the cursor. On a canvas the same scatter
 * redraws inside one frame and hit-testing is arithmetic against a grid.
 *
 * What the picture is
 * -------------------
 * Position is the bar's two leading principal components; distance on screen is
 * an approximation of distance in the full space. Selecting a bar asks the
 * server for its true k nearest neighbours — computed over every dimension by
 * DuckDB's HNSW index, not over the two on screen — and draws a line to each.
 * When a neighbour lands far away, that gap IS the information: it is the part
 * of the space the projection had to discard.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VectorPoint } from "./api";

/** Okabe-Ito. Never red/green for meaning. */
const ORANGE = "#E69F00";
const BLUE = "#0072B2";
const SKY = "#56B4E9";
const YELLOW = "#F0E442";
const GREY = "#6b7280";

export type ColourBy = "time" | "pattern" | "volume" | "direction";

export const COLOUR_LEGENDS: Record<ColourBy, string> = {
  time: "blue = earliest bar, orange = latest",
  pattern: "grey = no pattern fired, yellow = one, orange = several",
  volume: "blue = light volume, orange = heavy",
  direction: "blue = closed down, orange = closed up",
};

/** cividis, sampled — the sequential ramp that survives deuteranopia. */
function cividis(t: number): string {
  const stops: [number, number, number][] = [
    [0, 32, 76], [0, 67, 117], [61, 102, 129], [110, 139, 146],
    [166, 178, 137], [225, 220, 105], [255, 233, 69],
  ];
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (stops.length - 1);
  const index = Math.min(Math.floor(scaled), stops.length - 2);
  const fraction = scaled - index;
  const a = stops[index]!;
  const b = stops[index + 1]!;
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * fraction)},`
    + `${Math.round(a[1] + (b[1] - a[1]) * fraction)},`
    + `${Math.round(a[2] + (b[2] - a[2]) * fraction)})`;
}

function colourFor(point: VectorPoint, mode: ColourBy, index: number, total: number,
                   volumeCeiling: number): string {
  switch (mode) {
    case "pattern":
      if (point.patternCount === 0) return GREY;
      return point.patternCount === 1 ? YELLOW : ORANGE;
    case "volume":
      return cividis(Math.min(point.volume / volumeCeiling, 1));
    case "direction":
      return point.close >= point.open ? ORANGE : BLUE;
    default:
      return cividis(index / Math.max(total - 1, 1));
  }
}

interface Transform { scale: number; offsetX: number; offsetY: number }

export interface VectorSpaceCanvasProps {
  points: VectorPoint[];
  colourBy: ColourBy;
  selected: number | null;
  neighbours: (VectorPoint & { distance: number })[];
  onSelect: (barIndex: number | null) => void;
}

export function VectorSpaceCanvas({
  points, colourBy, selected, neighbours, onSelect,
}: VectorSpaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<Transform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const [hovered, setHovered] = useState<number | null>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]!.contentRect;
      setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const extent = useMemo(() => {
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    let volumeCeiling = 1;
    for (const point of points) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
    // A 99th-percentile ceiling, not the max: futures volume is heavy-tailed and
    // one session would otherwise flatten the whole ramp to its bottom stop.
    const volumes = points.map(p => p.volume).sort((a, b) => a - b);
    if (volumes.length > 0) volumeCeiling = volumes[Math.floor(volumes.length * 0.99)] ?? 1;
    return { minX, maxX, minY, maxY, volumeCeiling };
  }, [points]);

  /** Data coordinates to canvas pixels, including the pan/zoom transform. */
  const toScreen = useCallback((x: number, y: number) => {
    const padding = 26;
    const spanX = extent.maxX - extent.minX || 1;
    const spanY = extent.maxY - extent.minY || 1;
    const baseX = padding + ((x - extent.minX) / spanX) * (size.width - padding * 2);
    // Canvas y grows downward; the axis should grow upward.
    const baseY = size.height - padding - ((y - extent.minY) / spanY) * (size.height - padding * 2);
    return {
      x: baseX * transform.scale + transform.offsetX,
      y: baseY * transform.scale + transform.offsetY,
    };
  }, [extent, size, transform]);

  const neighbourIndex = useMemo(
    () => new Map(neighbours.map(n => [n.barIndex, n])), [neighbours]);
  const pointByBar = useMemo(
    () => new Map(points.map(p => [p.barIndex, p])), [points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = size.width * ratio;
    canvas.height = size.height * ratio;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    const radius = Math.max(1.1, Math.min(3, 1.4 * transform.scale));

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]!;
      const { x, y } = toScreen(point.x, point.y);
      if (x < -8 || y < -8 || x > size.width + 8 || y > size.height + 8) continue;
      const isSelected = point.barIndex === selected;
      const isNeighbour = neighbourIndex.has(point.barIndex);
      context.globalAlpha = selected === null ? 0.75 : (isSelected || isNeighbour ? 1 : 0.16);
      context.fillStyle = colourFor(point, colourBy, index, points.length, extent.volumeCeiling);
      context.beginPath();
      context.arc(x, y, isSelected ? radius + 3 : isNeighbour ? radius + 1.5 : radius, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;

    // Edges last so they sit above the dimmed cloud.
    const anchor = selected !== null ? pointByBar.get(selected) : undefined;
    if (anchor) {
      const from = toScreen(anchor.x, anchor.y);
      const furthest = neighbours.reduce((peak, n) => Math.max(peak, n.distance), 1e-9);
      for (const neighbour of neighbours) {
        const target = pointByBar.get(neighbour.barIndex);
        if (!target) continue;
        const to = toScreen(target.x, target.y);
        // Nearer in the FULL space draws brighter, so an edge that is short on
        // screen but faint is visibly a projection artefact.
        context.strokeStyle = SKY;
        context.globalAlpha = 0.85 * (1 - neighbour.distance / (furthest * 1.15));
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
      }
      context.globalAlpha = 1;
      context.strokeStyle = ORANGE;
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(from.x, from.y, radius + 6, 0, Math.PI * 2);
      context.stroke();
    }

    if (hovered !== null) {
      const point = pointByBar.get(hovered);
      if (point) {
        const { x, y } = toScreen(point.x, point.y);
        context.strokeStyle = "#e4e4e7";
        context.lineWidth = 1;
        context.beginPath();
        context.arc(x, y, radius + 4, 0, Math.PI * 2);
        context.stroke();
      }
    }
  }, [points, size, transform, colourBy, selected, neighbours, hovered,
      toScreen, neighbourIndex, pointByBar, extent]);

  /** Nearest point to the cursor, within a pixel budget. */
  const pick = useCallback((clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best: number | null = null;
    let bestDistance = 12 * 12;
    for (const point of points) {
      const { x, y } = toScreen(point.x, point.y);
      const dx = x - px;
      const dy = y - py;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) { bestDistance = distance; best = point.barIndex; }
    }
    return best;
  }, [points, toScreen]);

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden rounded bg-black/20">
      <canvas
        ref={canvasRef}
        style={{ width: size.width, height: size.height }}
        className={dragRef.current ? "cursor-grabbing" : "cursor-crosshair"}
        onMouseDown={event => {
          dragRef.current = {
            x: event.clientX, y: event.clientY,
            offsetX: transform.offsetX, offsetY: transform.offsetY,
          };
        }}
        onMouseMove={event => {
          const drag = dragRef.current;
          if (drag) {
            setTransform(current => ({
              ...current,
              offsetX: drag.offsetX + (event.clientX - drag.x),
              offsetY: drag.offsetY + (event.clientY - drag.y),
            }));
            return;
          }
          setHovered(pick(event.clientX, event.clientY));
        }}
        onMouseUp={event => {
          const drag = dragRef.current;
          dragRef.current = null;
          // A drag of a few pixels is a click, not a pan.
          if (drag && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) return;
          const hit = pick(event.clientX, event.clientY);
          onSelect(hit === selected ? null : hit);
        }}
        onMouseLeave={() => { dragRef.current = null; setHovered(null); }}
        onWheel={event => {
          event.preventDefault();
          const canvas = canvasRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const px = event.clientX - rect.left;
          const py = event.clientY - rect.top;
          setTransform(current => {
            const next = Math.max(0.5, Math.min(60, current.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
            const factor = next / current.scale;
            // Zoom about the cursor, so the point under it stays under it.
            return {
              scale: next,
              offsetX: px - (px - current.offsetX) * factor,
              offsetY: py - (py - current.offsetY) * factor,
            };
          });
        }}
      />

      <button
        onClick={() => setTransform({ scale: 1, offsetX: 0, offsetY: 0 })}
        className="absolute right-2 top-2 rounded bg-black/50 px-2 py-1 font-mono text-[10px]
                   text-zinc-400 transition-colors hover:text-zinc-100">
        reset view
      </button>

      {hovered !== null && (() => {
        const point = pointByBar.get(hovered);
        if (!point) return null;
        const neighbour = neighbourIndex.get(hovered);
        return (
          <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/80 px-2 py-1
                          font-mono text-[10px] leading-relaxed text-zinc-200">
            <div>bar {point.barIndex} · {point.timestamp}</div>
            <div className="text-zinc-400">
              O {point.open} H {point.high} L {point.low} C {point.close}
            </div>
            <div className="text-zinc-400">
              volume {point.volume.toLocaleString()} · {point.patternCount} pattern(s)
            </div>
            {neighbour && (
              <div className="text-[#56B4E9]">distance {neighbour.distance.toFixed(4)}</div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
