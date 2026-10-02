/**
 * One panel per column of the visible bars: the value bar by bar (line) over
 * its histogram. Drag across any line to brush a stretch of time: every
 * histogram then splits each bin into the brushed stretch (yellow) and the
 * rest of the visible range (sky), so a reader sees whether, say, the widest
 * bars all came from one burst. Bins and the log scale come from the page.
 */

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  COMPANION_COLUMNS, barTimeText, columnValues, countInBins, finiteExtent, niceBins, sixSignificant, thinIndices,
  type CompanionColumn, type CompanionFrame,
} from "@shared/studies/chart-companion";
import { AXIS, GRID, OKABE, TOOLTIP, fmtInt } from "@/studies/kit";

export interface Brush {
  from: number;
  to: number;
}

const LINE_POINTS = 900;
const BRUSH_COLOR = OKABE.yellow;

/** Axis labels that stay short: date and time for a span of days, month for a span of years. */
function axisTime(span: number): (stamp: number) => string {
  return (stamp) => {
    const text = new Date(stamp).toISOString();
    return span > 400 * 86_400_000 ? text.slice(0, 7) : span > 3 * 86_400_000 ? text.slice(5, 10) : text.slice(5, 16).replace("T", " ");
  };
}

function Panel({
  column, stamps, values, bins, logCounts, brush, onBrush, selectedStamp, clock,
}: {
  column: CompanionColumn;
  stamps: Float64Array;
  values: Float64Array;
  bins: number;
  logCounts: boolean;
  brush: Brush | null;
  onBrush: (next: Brush | null) => void;
  selectedStamp: number | null;
  clock: string;
}) {
  const [drag, setDrag] = useState<Brush | null>(null);
  const indices = thinIndices(values, LINE_POINTS);
  const line = indices.map((index) => ({ t: stamps[index] as number, value: values[index] as number }));
  const span = stamps.length > 1 ? (stamps[stamps.length - 1] as number) - (stamps[0] as number) : 0;

  const extent = finiteExtent(values);
  const edges = extent ? niceBins(extent.minimum, extent.maximum, bins) : [];
  const whole = countInBins(edges, values);
  const brushed = brush ? countInBins(edges, values, stamps, brush) : whole.map(() => 0);
  const shape = (count: number) => (logCounts ? Math.log10(1 + count) : count);
  const histogramRows = edges.map((edge, position) => {
    const all = whole[position] as number;
    const inside = brushed[position] as number;
    return {
      middle: (edge.lower + edge.upper) / 2, lower: edge.lower, upper: edge.upper, all, inside,
      brushedShown: shape(inside), restShown: shape(all) - shape(inside),
    };
  });
  const area = drag ?? brush;
  const brushedCount = brush ? brushed.reduce((a, b) => a + b, 0) : null;

  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={column.title}>{column.title}</div>
      <ResponsiveContainer width="100%" height={110}>
        <LineChart
          data={line}
          margin={{ top: 4, right: 6, left: 0, bottom: 0 }}
          onMouseDown={(event) => {
            if (event?.activeLabel !== undefined) setDrag({ from: Number(event.activeLabel), to: Number(event.activeLabel) });
          }}
          onMouseMove={(event) => {
            if (drag && event?.activeLabel !== undefined) setDrag({ from: drag.from, to: Number(event.activeLabel) });
          }}
          onMouseUp={() => {
            if (!drag) return;
            onBrush(drag.from === drag.to ? null : { from: Math.min(drag.from, drag.to), to: Math.max(drag.from, drag.to) });
            setDrag(null);
          }}
          onMouseLeave={() => setDrag(null)}
        >
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={axisTime(span)} tickCount={4} {...AXIS} />
          <YAxis domain={["auto", "auto"]} tickFormatter={(value: number) => sixSignificant(value)} width={52} {...AXIS} />
          <Tooltip
            {...TOOLTIP}
            labelFormatter={(label) => `${barTimeText(Number(label))} (${clock})`}
            formatter={(value: number) => [sixSignificant(value), column.heading]}
          />
          {area && <ReferenceArea x1={Math.min(area.from, area.to)} x2={Math.max(area.from, area.to)} fill={BRUSH_COLOR} fillOpacity={0.18} stroke={BRUSH_COLOR} strokeOpacity={0.6} />}
          {selectedStamp !== null && <ReferenceLine x={selectedStamp} stroke={OKABE.vermillion} strokeDasharray="3 2" />}
          <Line dataKey="value" stroke={OKABE.sky} strokeWidth={1} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={histogramRows} margin={{ top: 4, right: 6, left: 0, bottom: 0 }} barCategoryGap={0}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="middle" tickFormatter={(value: number) => sixSignificant(value)} interval={Math.max(0, Math.ceil(histogramRows.length / 4) - 1)} {...AXIS} />
          <YAxis tickFormatter={(value: number) => fmtInt(logCounts ? 10 ** value - 1 : value)} width={52} {...AXIS} />
          <Tooltip
            {...TOOLTIP}
            cursor={{ fill: "rgba(255,255,255,0.06)" }}
            labelFormatter={(_label, payload) => {
              const row = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
              return row ? `${sixSignificant(row.lower)} to ${sixSignificant(row.upper)}` : "";
            }}
            formatter={(_value, name, item) => {
              const row = item.payload as { all: number; inside: number };
              return name === "brushedShown" ? [fmtInt(row.inside), "bars in the brushed stretch"] : [fmtInt(row.all - row.inside), "bars in the rest of the range"];
            }}
          />
          <Bar dataKey="brushedShown" stackId="count" fill={BRUSH_COLOR} isAnimationActive={false} />
          <Bar dataKey="restShown" stackId="count" fill={OKABE.sky} fillOpacity={0.55} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-0.5 text-[10px] text-neutral-500">
        {edges.length === 0 ? "no values" : `${fmtInt(whole.reduce((a, b) => a + b, 0))} bars in ${fmtInt(edges.length)} bins`}
        {brushedCount !== null && `, ${fmtInt(brushedCount)} in the brushed stretch`}
      </p>
    </div>
  );
}

export function ColumnPanels({
  frame, bins, logCounts, brush, onBrush, selectedStamp, clock,
}: {
  frame: CompanionFrame;
  bins: number;
  logCounts: boolean;
  brush: Brush | null;
  onBrush: (next: Brush | null) => void;
  selectedStamp: number | null;
  clock: string;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2">
      {COMPANION_COLUMNS.map((column) => (
        <Panel
          key={column.key}
          column={column}
          stamps={frame.bars.timestamps}
          values={columnValues(frame, column.key)}
          bins={bins}
          logCounts={logCounts}
          brush={brush}
          onBrush={onBrush}
          selectedStamp={selectedStamp}
          clock={clock}
        />
      ))}
    </div>
  );
}
