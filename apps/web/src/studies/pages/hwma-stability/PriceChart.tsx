/**
 * The closes and the average over them, with the bar where the recursion left
 * the data's range marked. "Guard on" blanks the average from that bar, which
 * is what the chart does (calcHWMA stops emitting); "guard off" draws what the
 * recursion would have done. A scrubbed bar is marked on the line.
 */

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, OKABE, TOOLTIP, fmtTime } from "@/studies/kit";
import type { HwmaPricePoint } from "@shared/studies/hwma-stability";
import { fmtTick, fmtWide } from "./format";

interface Point {
  bar: number;
  close: number;
  average: number | null;
  timestamp: number;
}

export function PriceChart({
  prices, average, leftAt, scrubbedBar, title,
}: {
  prices: readonly HwmaPricePoint[];
  average: ReadonlyArray<number | null>;
  leftAt: number | null;
  scrubbedBar: number;
  title: string;
}) {
  const data: Point[] = prices.map((price, index) => ({
    bar: price.bar_index,
    close: price.close,
    average: average[index] ?? null,
    timestamp: price.timestamp_ms,
  }));
  return (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-300">
        <span className="font-medium text-neutral-100">{title}</span>
        <span className="flex items-center gap-1"><svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke="#d4d4d4" strokeWidth="2" /></svg>close</span>
        <span className="flex items-center gap-1"><svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke={OKABE.orange} strokeWidth="2" strokeDasharray="6 2" /></svg>Holt-Winters average</span>
        {leftAt !== null && (
          <span className="flex items-center gap-1"><svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke={OKABE.vermillion} strokeWidth="2" strokeDasharray="5 3" /></svg>left the data's range</span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="bar" type="number" domain={[0, Math.max(0, prices.length - 1)]} tickCount={8} {...AXIS} label={{ value: "bar", position: "insideBottomRight", offset: -2, fontSize: 10, fill: "#a3a3a3" }} />
          <YAxis domain={["auto", "auto"]} tickFormatter={fmtTick} width={62} {...AXIS} label={{ value: "price, points", angle: -90, position: "insideLeft", fontSize: 10, fill: "#a3a3a3" }} />
          <Tooltip
            {...TOOLTIP}
            labelFormatter={(_label, payload) => {
              const point = payload?.[0]?.payload as Point | undefined;
              return point ? `bar ${point.bar}  ${fmtTime(point.timestamp)} (stamped clock)` : "";
            }}
            formatter={(value, name) => [fmtWide(typeof value === "number" ? value : null), name === "close" ? "close" : "average"]}
          />
          <Line dataKey="close" name="close" stroke="#d4d4d4" strokeWidth={1.4} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line dataKey="average" name="average" stroke={OKABE.orange} strokeWidth={1.8} strokeDasharray="6 2" dot={false} isAnimationActive={false} connectNulls={false} />
          {leftAt !== null && <ReferenceLine x={leftAt} stroke={OKABE.vermillion} strokeWidth={2} strokeDasharray="5 3" label={{ value: `left at bar ${leftAt.toLocaleString("en-US")}`, position: "insideTopRight", fontSize: 10, fill: OKABE.vermillion }} />}
          <ReferenceLine x={scrubbedBar} stroke={OKABE.sky} strokeWidth={1} strokeDasharray="2 2" label={{ value: `t = ${scrubbedBar}`, position: "insideTopLeft", fontSize: 10, fill: OKABE.sky }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
