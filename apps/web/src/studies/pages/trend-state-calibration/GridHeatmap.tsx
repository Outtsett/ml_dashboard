/**
 * The (p_entry, p_exit) grid as a labelled heatmap: p_entry across (largest left,
 * as the notebook sorted it), p_exit down (largest on top). Cell text switches
 * between black and white by the cell's luminance, so a label on cividis yellow
 * stays readable. The run's chosen cell is outlined; hovering a cell prints every
 * null statistic the grid carries for it.
 */

import { useState } from "react";
import { interpolateCividis, interpolateViridis } from "d3-scale-chromatic";
import type { ThresholdGridRow } from "@shared/studies/trend-state-calibration";
import { cell, fmtProbability, useWidth } from "./common";

type ValueKey = "null_false_entries_per_session" | "null_mean_episode_bars";

function luminance(color: string): number {
  const match = color.match(/\d+(\.\d+)?/g);
  if (!match || match.length < 3) return 0;
  const [r, g, b] = match.slice(0, 3).map((value) => Number(value) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function GridHeatmap({
  rows, valueKey, palette, decimals, title, chosen,
}: {
  rows: readonly ThresholdGridRow[];
  valueKey: ValueKey;
  palette: "cividis" | "viridis";
  decimals: number;
  title: string;
  chosen: { entry: number | null; exit: number | null };
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<ThresholdGridRow | null>(null);
  const entries = [...new Set(rows.map((row) => row.entry_probability))].sort((a, b) => b - a);
  const exits = [...new Set(rows.map((row) => row.exit_probability))].sort((a, b) => b - a);
  const values = rows.map((row) => row[valueKey]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 1;
  const colorOf = (value: number) => (palette === "cividis" ? interpolateCividis : interpolateViridis)((value - minimum) / (maximum - minimum || 1));

  const left = 44;
  const top = 6;
  const bottom = 30;
  const plotWidth = Math.max(120, width - left - 4);
  const cellWidth = entries.length ? plotWidth / entries.length : 0;
  const cellHeight = 30;
  const height = top + exits.length * cellHeight + bottom;
  const byKey = new Map(rows.map((row) => [`${row.entry_probability}|${row.exit_probability}`, row]));

  return (
    <div ref={ref} className="min-w-0">
      <div className="mb-1 text-[11px] font-medium text-neutral-200">{title}</div>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={title}>
          {exits.map((exit, rowIndex) => (
            <text key={exit} x={left - 4} y={top + rowIndex * cellHeight + cellHeight / 2 + 3} textAnchor="end" fontSize={10} fill="#a3a3a3">
              {fmtProbability(exit)}
            </text>
          ))}
          {entries.map((entry, columnIndex) => (
            <text key={entry} x={left + columnIndex * cellWidth + cellWidth / 2} y={top + exits.length * cellHeight + 12} textAnchor="middle" fontSize={10} fill="#a3a3a3">
              {fmtProbability(entry)}
            </text>
          ))}
          <text x={left + plotWidth / 2} y={height - 3} textAnchor="middle" fontSize={10} fill="#737373">p entry</text>
          <text x={10} y={top + (exits.length * cellHeight) / 2} textAnchor="middle" fontSize={10} fill="#737373" transform={`rotate(-90 10 ${top + (exits.length * cellHeight) / 2})`}>p exit</text>
          {exits.map((exit, rowIndex) =>
            entries.map((entry, columnIndex) => {
              const row = byKey.get(`${entry}|${exit}`);
              const value = row?.[valueKey];
              const finite = typeof value === "number" && Number.isFinite(value);
              const fill = finite ? colorOf(value) : "#262626";
              const isChosen = chosen.entry !== null && chosen.exit !== null && Math.abs(entry - chosen.entry) < 1e-12 && Math.abs(exit - chosen.exit) < 1e-12;
              const x = left + columnIndex * cellWidth;
              const y = top + rowIndex * cellHeight;
              return (
                <g key={`${entry}|${exit}`} onMouseEnter={() => setHover(row ?? null)} onMouseLeave={() => setHover(null)}>
                  <rect x={x + 0.5} y={y + 0.5} width={Math.max(0, cellWidth - 1)} height={cellHeight - 1} fill={fill} />
                  {isChosen && <rect x={x + 1.5} y={y + 1.5} width={Math.max(0, cellWidth - 3)} height={cellHeight - 3} fill="none" stroke="#fafafa" strokeWidth={2} strokeDasharray="4 2" />}
                  {finite && cellWidth > 26 && (
                    <text x={x + cellWidth / 2} y={y + cellHeight / 2 + 4} textAnchor="middle" fontSize={11} fontFamily="monospace" fill={luminance(fill) > 0.45 ? "#000000" : "#ffffff"}>
                      {value.toFixed(decimals)}
                    </text>
                  )}
                </g>
              );
            }),
          )}
        </svg>
      )}
      <div className="flex items-center gap-2 text-[10px] text-neutral-500">
        <span className="font-mono">{cell(minimum, decimals)}</span>
        <span
          className="h-2 flex-1 rounded"
          style={{ background: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((t) => (palette === "cividis" ? interpolateCividis : interpolateViridis)(t)).join(", ")})` }}
        />
        <span className="font-mono">{cell(maximum, decimals)}</span>
        <span>▭ dashed outline = the run's chosen cell</span>
      </div>
      <p className="mt-1 min-h-[2.2em] text-[10px] font-mono text-neutral-400">
        {hover
          ? `p entry ${fmtProbability(hover.entry_probability)} · p exit ${fmtProbability(hover.exit_probability)} · false entries / session ${cell(hover.null_false_entries_per_session)} (± ${cell(hover.null_false_entries_per_session_standard_deviation)}) · on share ${cell(hover.null_on_share)} · mean episode ${cell(hover.null_mean_episode_bars, 1)} bars · chatter ${cell(hover.null_chatter_rate, 4)} · expected exceedances ${cell(hover.expected_null_exceedances, 2)} · tail supported ${cell(hover.tail_supported)}`
          : "Hover a cell for every null statistic of that (p entry, p exit)."}
      </p>
    </div>
  );
}
