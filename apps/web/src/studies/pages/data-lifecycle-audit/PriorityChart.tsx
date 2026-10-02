/**
 * Effort to fix (across) against severity (up). The cheap, important work is
 * the top-left corner. Each mark is one finding; marks in the same box are laid
 * out side by side and in rows so none hides another. Click a mark to narrow
 * the findings table to it; hover or focus for its title and expected gain.
 */

import { useState } from "react";
import { EFFORT_ORDER, SEVERITY_ORDER, effortRank, packInBox, severityRank, stageLabel, type FindingRow } from "@shared/studies/data-lifecycle-audit";
import { useMeasuredWidth } from "@/market/regression/ScatterPlot";
import { MarkShapeElement } from "./Glyph";
import { severityStyle } from "./style";

const LABEL_WIDTH = 66;
const ROW_HEIGHT = 58;
const AXIS_HEIGHT = 34;
const PADDING = 4;

export function PriorityChart({ rows, picked, onToggle, onClear }: {
  rows: readonly FindingRow[];
  picked: readonly string[];
  onToggle: (identifier: string) => void;
  onClear: () => void;
}) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<FindingRow | null>(null);
  const width = Math.max(300, measured);
  const boxWidth = (width - LABEL_WIDTH - 2) / EFFORT_ORDER.length;
  const height = SEVERITY_ORDER.length * ROW_HEIGHT + AXIS_HEIGHT;

  const boxes = new Map<string, FindingRow[]>();
  for (const row of rows) {
    const key = `${effortRank(row.effort)}|${severityRank(row.severity)}`;
    boxes.set(key, [...(boxes.get(key) ?? []), row]);
  }

  return (
    <div ref={ref} className="min-w-0 space-y-2">
      <svg width={width} height={height} role="group" aria-label="Findings by effort and severity">
        {SEVERITY_ORDER.map((severity, rowIndex) => (
          <g key={severity}>
            <text x={LABEL_WIDTH - 8} y={rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2} textAnchor="end" dominantBaseline="central" fontSize={11} fill="#d4d4d4">
              {severityStyle(severity).glyph} {severity}
            </text>
            {EFFORT_ORDER.map((effort, columnIndex) => (
              <rect
                key={effort}
                x={LABEL_WIDTH + columnIndex * boxWidth}
                y={rowIndex * ROW_HEIGHT}
                width={boxWidth}
                height={ROW_HEIGHT}
                fill={columnIndex === 0 && rowIndex < 2 ? "rgba(86,180,233,0.07)" : "rgba(255,255,255,0.015)"}
                stroke="#262626"
              />
            ))}
          </g>
        ))}
        {EFFORT_ORDER.map((effort, columnIndex) => (
          <text key={effort} x={LABEL_WIDTH + (columnIndex + 0.5) * boxWidth} y={SEVERITY_ORDER.length * ROW_HEIGHT + 14} textAnchor="middle" fontSize={11} fill="#d4d4d4">
            {effort}
          </text>
        ))}
        <text x={LABEL_WIDTH + (EFFORT_ORDER.length * boxWidth) / 2} y={SEVERITY_ORDER.length * ROW_HEIGHT + 29} textAnchor="middle" fontSize={10} fill="#8a8a8a">
          effort to fix (cheap, important work is top left)
        </text>
        {[...boxes.entries()].map(([key, group]) => {
          const [effortIndex, severityIndex] = key.split("|").map(Number) as [number, number];
          const cx = LABEL_WIDTH + (effortIndex + 0.5) * boxWidth;
          const cy = severityIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
          const { points, size } = packInBox(group.length, boxWidth - 2 * PADDING, ROW_HEIGHT - 2 * PADDING, 15);
          return group.map((row, index) => {
            const at = points[index] as { dx: number; dy: number };
            const style = severityStyle(row.severity);
            const isPicked = picked.includes(row.identifier);
            return (
              <g
                key={row.identifier}
                tabIndex={0}
                role="button"
                aria-pressed={isPicked}
                aria-label={`${row.identifier}: ${row.title}`}
                onClick={() => onToggle(row.identifier)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onToggle(row.identifier); } }}
                onMouseEnter={() => setHovered(row)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(row)}
                onBlur={() => setHovered(null)}
                className="cursor-pointer outline-none"
              >
                <title>{`${row.identifier} · ${row.title}\n${row.severity} severity, ${row.effort} effort\n${row.expected_gain}`}</title>
                <MarkShapeElement shape={style.shape} cx={cx + at.dx} cy={cy + at.dy} radius={size * 0.42} fill={style.colour} stroke={isPicked ? "#fafafa" : "#0a0a0a"} strokeWidth={isPicked ? 2 : 0.75} />
              </g>
            );
          });
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
        <span>{rows.length} findings plotted; a white ring marks a picked one.</span>
        {picked.length > 0 && (
          <button type="button" onClick={onClear} className="ml-auto rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:border-neutral-500">
            Clear {picked.length} picked
          </button>
        )}
      </div>
      <div className="min-h-[3.5rem] rounded border border-neutral-800 bg-neutral-900/40 px-2 py-1 text-[11px] text-neutral-300" aria-live="polite">
        {hovered ? (
          <>
            <div className="font-medium text-neutral-100">{hovered.identifier} · {hovered.title}</div>
            <div className="text-neutral-400">{hovered.component} · {stageLabel(hovered.lifecycle_stage)}</div>
            <div>Expected gain: {hovered.expected_gain}</div>
          </>
        ) : (
          <span className="text-neutral-500">Hover or focus a mark for its title and expected gain.</span>
        )}
      </div>
    </div>
  );
}
