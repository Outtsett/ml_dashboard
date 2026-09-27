/**
 * One stage's activations as a heatmap: units (or input features) down, time
 * across with the bar being predicted at the right edge (outlined). A dense
 * layer is a single column. Large layers are merged into at most
 * MAX_DRAWN_ROWS × MAX_DRAWN_COLUMNS drawn cells (each the mean of its bin),
 * but hover reads the pointer position against the FULL grid, so the value it
 * reports is always one exact unit at one exact bar.
 */
import type { MouseEvent } from "react";

import { CIVIDIS_RAMP, type ColorDomain, MISSING_COLOR, rampColor } from "./colorScale";
import { cellAtPointer, drawnGrid, type NeuralGrid } from "./stages";

export const HOVER_OUTLINE = "#CC79A7";

export interface HeatmapHover {
  time: number;
  unit: number;
}

interface HeatmapProps {
  grid: NeuralGrid;
  domain: ColorDomain;
  hovered: HeatmapHover | null;
  onHover: (cell: HeatmapHover | null) => void;
  /** Accessible name, e.g. "LSTM activations". */
  label: string;
  testId?: string;
  /** Names printed beside a single-column heatmap (the dense input vector's features); ignored when rows were merged. */
  rowLabels?: string[] | null;
}

function cellSize(count: number, budget: number): number {
  return Math.max(3, Math.min(14, Math.floor(budget / Math.max(1, count))));
}

export function Heatmap({ grid, domain, hovered, onHover, label, testId, rowLabels }: HeatmapProps) {
  const drawn = drawnGrid(grid);
  const cellWidth = drawn.columns === 1 ? 18 : cellSize(drawn.columns, 224);
  const cellHeight = cellSize(drawn.rows, 176);
  const width = drawn.columns * cellWidth;
  const height = drawn.rows * cellHeight;
  const sequence = grid.timeCount > 1;
  const labels = drawn.columns === 1 && rowLabels && rowLabels.length === drawn.rows && cellHeight >= 9 ? rowLabels : null;
  const labelWidth = labels ? 190 : 0;

  function handleMove(event: MouseEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    onHover(cellAtPointer((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height, grid));
  }

  // Where the hovered exact cell sits among the drawn bins.
  let outline: { x: number; y: number } | null = null;
  if (hovered) {
    const row = drawn.rowEdges.findIndex((edge, index) => index < drawn.rows && hovered.unit >= edge && hovered.unit < (drawn.rowEdges[index + 1] ?? 0));
    const column = drawn.columnEdges.findIndex(
      (edge, index) => index < drawn.columns && hovered.time >= edge && hovered.time < (drawn.columnEdges[index + 1] ?? 0),
    );
    if (row >= 0 && column >= 0) outline = { x: column * cellWidth, y: row * cellHeight };
  }

  const cells = [];
  for (let row = 0; row < drawn.rows; row += 1) {
    for (let column = 0; column < drawn.columns; column += 1) {
      cells.push(
        <rect
          key={`${row}-${column}`}
          x={column * cellWidth}
          y={row * cellHeight}
          width={cellWidth}
          height={cellHeight}
          fill={rampColor(CIVIDIS_RAMP, drawn.cells[row * drawn.columns + column] ?? null, domain)}
        />,
      );
    }
  }

  return (
    <svg
      role="img"
      aria-label={label}
      data-testid={testId}
      data-drawn-rows={drawn.rows}
      data-drawn-columns={drawn.columns}
      data-downsampled={drawn.downsampled ? "true" : "false"}
      width={width + 2 + labelWidth}
      height={height + 2}
      viewBox={`-1 -1 ${width + 2 + labelWidth} ${height + 2}`}
      className="block shrink-0"
    >
      <g shapeRendering="crispEdges">{cells}</g>
      {labels?.map((name, row) => (
        <text key={name} x={width + 6} y={row * cellHeight + cellHeight / 2} dominantBaseline="middle" fontSize={9} fill={MISSING_COLOR}>
          {name}
        </text>
      ))}
      {sequence && (
        <rect
          x={(drawn.columns - 1) * cellWidth}
          y={0}
          width={cellWidth}
          height={height}
          fill="none"
          stroke={HOVER_OUTLINE}
          strokeDasharray="2 2"
          strokeWidth={1}
          pointerEvents="none"
        />
      )}
      {outline && (
        <rect
          data-testid="heatmap-hover-outline"
          x={outline.x}
          y={outline.y}
          width={cellWidth}
          height={cellHeight}
          fill="none"
          stroke={HOVER_OUTLINE}
          strokeWidth={2}
          pointerEvents="none"
        />
      )}
      <rect
        data-testid={testId ? `${testId}-hit` : undefined}
        x={0}
        y={0}
        width={width}
        height={height}
        fill="transparent"
        onMouseMove={handleMove}
        onMouseLeave={() => onHover(null)}
      />
    </svg>
  );
}
