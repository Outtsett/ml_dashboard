/**
 * A heatmap on a canvas, coloured with cividis (a colour-vision-safe
 * sequential map), one cell per (row, column) of a matrix, with the exact
 * value, the row's label and the column's description on hover. The study
 * draws two: a modality block (feature x bar) and a layer's activations
 * (row of the batch x unit). The colour scale is shared across the matrix or
 * fitted to each row, because a block mixes features of very different range.
 */

import { useEffect, useRef, useState } from "react";
import { fmt } from "@/studies/kit";

/** matplotlib's cividis, sampled at ten evenly spaced points. */
const CIVIDIS: ReadonlyArray<[number, number, number]> = [
  [0x00, 0x22, 0x4e], [0x12, 0x35, 0x70], [0x3b, 0x49, 0x6c], [0x57, 0x5d, 0x6d], [0x70, 0x71, 0x73],
  [0x8a, 0x86, 0x78], [0xa5, 0x9c, 0x74], [0xc3, 0xb3, 0x69], [0xe1, 0xcc, 0x55], [0xff, 0xea, 0x46],
];

export function cividis(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const position = clamped * (CIVIDIS.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(CIVIDIS.length - 1, lower + 1);
  const fraction = position - lower;
  const a = CIVIDIS[lower] as [number, number, number];
  const b = CIVIDIS[upper] as [number, number, number];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * fraction)},${Math.round(a[1] + (b[1] - a[1]) * fraction)},${Math.round(a[2] + (b[2] - a[2]) * fraction)})`;
}

const LABEL_WIDTH = 150;
const COLOUR_BAR_WIDTH = 12;

function extent(values: ReadonlyArray<number | null>): [number, number] | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  return lo <= hi ? [lo, hi] : null;
}

export interface CanvasHeatmapProps {
  /** matrix[row][column]; null where there is no number. */
  matrix: ReadonlyArray<ReadonlyArray<number | null>>;
  rowLabels: readonly string[];
  /** Describes column `c` for the tooltip, e.g. the bars it covers. */
  columnLabel: (column: number) => string;
  /** One colour scale for every row, or each row fitted to its own range. */
  scale: "shared" | "per row";
  rowHeight: number;
  /** What the cell's number is called in the tooltip. */
  valueName: string;
  showRowLabels?: boolean;
}

export function CanvasHeatmap({ matrix, rowLabels, columnLabel, scale, rowHeight, valueName, showRowLabels = true }: CanvasHeatmapProps) {
  const wrapper = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<{ row: number; column: number; x: number; y: number } | null>(null);
  const rows = matrix.length;
  const columns = matrix[0]?.length ?? 0;
  const labelWidth = showRowLabels ? LABEL_WIDTH : 0;
  const height = Math.max(1, rows * rowHeight);

  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    setWidth(Math.max(1, Math.floor(element.getBoundingClientRect().width)));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.floor(width * ratio);
    element.height = Math.floor(height * ratio);
    const context = element.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const sharedExtent = extent(matrix.flat());
    const plotWidth = Math.max(1, width - labelWidth - COLOUR_BAR_WIDTH - 8);
    const cellWidth = columns > 0 ? plotWidth / columns : plotWidth;
    context.font = "10px ui-monospace, monospace";
    context.textBaseline = "middle";
    matrix.forEach((row, rowIndex) => {
      const range = scale === "shared" ? sharedExtent : extent(row);
      const low = range?.[0] ?? 0;
      const span = (range?.[1] ?? 1) - low || 1;
      const y = rowIndex * rowHeight;
      row.forEach((value, columnIndex) => {
        context.fillStyle = typeof value === "number" && Number.isFinite(value) ? cividis((value - low) / span) : "#262626";
        context.fillRect(labelWidth + columnIndex * cellWidth, y, Math.ceil(cellWidth), rowHeight - (rowHeight > 14 ? 1 : 0));
      });
      if (showRowLabels) {
        context.fillStyle = "#d4d4d4";
        context.textAlign = "right";
        const label = rowLabels[rowIndex] ?? "";
        context.fillText(label.length > 24 ? `${label.slice(0, 23)}…` : label, labelWidth - 6, y + rowHeight / 2);
      }
    });
    // A single colour bar for the shared scale, marked with its ends; per-row scales have no single bar.
    if (scale === "shared" && sharedExtent) {
      const barX = width - COLOUR_BAR_WIDTH;
      for (let step = 0; step < height; step += 1) {
        context.fillStyle = cividis(1 - step / Math.max(1, height - 1));
        context.fillRect(barX, step, COLOUR_BAR_WIDTH - 2, 1);
      }
    }
  }, [matrix, rowLabels, scale, rowHeight, width, height, columns, labelWidth, showRowLabels]);

  const sharedExtent = scale === "shared" ? extent(matrix.flat()) : null;
  const plotWidth = Math.max(1, width - labelWidth - COLOUR_BAR_WIDTH - 8);

  const onMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left - labelWidth;
    const y = event.clientY - box.top;
    const column = Math.floor((x / plotWidth) * columns);
    const row = Math.floor(y / rowHeight);
    if (x < 0 || x > plotWidth || column < 0 || column >= columns || row < 0 || row >= rows) setHover(null);
    else setHover({ row, column, x: event.clientX - box.left, y: event.clientY - box.top });
  };

  const hovered = hover ? matrix[hover.row]?.[hover.column] : undefined;
  return (
    <div ref={wrapper} className="relative w-full min-w-0">
      <canvas ref={canvas} style={{ width: "100%", height }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} aria-label="heatmap" />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-neutral-700 bg-neutral-950/95 px-2 py-1 font-mono text-[10px] leading-4 text-neutral-200"
          style={{ left: Math.min(hover.x + 12, Math.max(0, width - 210)), top: hover.y + 12 }}
        >
          <div>{rowLabels[hover.row]}</div>
          <div>{columnLabel(hover.column)}</div>
          <div>
            {valueName} {typeof hovered === "number" ? fmt(hovered, 4) : "not measured"}
          </div>
        </div>
      )}
      {sharedExtent && (
        <div className="mt-1 flex justify-between font-mono text-[10px] text-neutral-500">
          <span>low {fmt(sharedExtent[0], 3)} (dark)</span>
          <span>high {fmt(sharedExtent[1], 3)} (bright)</span>
        </div>
      )}
      {scale === "per row" && <div className="mt-1 text-[10px] text-neutral-500">Each row is coloured on its own range, dark = its minimum, bright = its maximum.</div>}
    </div>
  );
}
