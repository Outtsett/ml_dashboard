/**
 * The selector: the daily causal z-score of log range, with a brush. The
 * selection is committed when a drag ends (the notebook reran on release, not
 * on every pixel), and the trailing window behind the probed day is shaded so
 * the z-score formula can be read against the picture.
 */

import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, Brush, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, OKABE, TOOLTIP, fmt } from "@/studies/kit";

export interface OverviewPoint {
  date: number;
  range_zscore: number;
}

function day(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function OverviewBrush({
  points, startIndex, endIndex, onCommit, probeIndex, windowLength, height = 240,
}: {
  points: readonly OverviewPoint[];
  startIndex: number;
  endIndex: number;
  onCommit: (startIndex: number, endIndex: number) => void;
  probeIndex: number;
  windowLength: number;
  height?: number;
}) {
  const windowStart = points[Math.max(0, probeIndex - windowLength + 1)]?.date;
  const probeDate = points[probeIndex]?.date;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points as OverviewPoint[]} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => day(value).slice(0, 7)} {...AXIS} />
        <YAxis {...AXIS} width={40} tickFormatter={(value: number) => fmt(value, 1)} label={{ value: "daily log range, causal z", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
        <ReferenceLine y={0} stroke={OKABE.grey} strokeDasharray="4 3" />
        {windowStart !== undefined && probeDate !== undefined && (
          <ReferenceArea x1={windowStart} x2={probeDate} fill={OKABE.orange} fillOpacity={0.18} stroke={OKABE.orange} strokeOpacity={0.6} />
        )}
        <Tooltip
          {...TOOLTIP}
          labelFormatter={(value) => `${day(Number(value))} UTC`}
          formatter={(value) => [fmt(Number(value), 3), "range z-score"]}
        />
        <Line type="linear" dataKey="range_zscore" stroke={OKABE.blue} strokeWidth={1} dot={false} isAnimationActive={false} />
        <Brush
          key={`${startIndex}-${endIndex}-${points.length}`}
          dataKey="date"
          height={30}
          stroke={OKABE.orange}
          fill="#171717"
          startIndex={startIndex}
          endIndex={endIndex}
          tickFormatter={(value: number) => day(value)}
          onDragEnd={(range) => {
            if ("startIndex" in range && typeof range.startIndex === "number" && typeof range.endIndex === "number") onCommit(range.startIndex, range.endIndex);
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
