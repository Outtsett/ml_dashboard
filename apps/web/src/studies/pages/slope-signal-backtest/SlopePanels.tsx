/**
 * The last bars of the window in two panels that share one hover: the close
 * with its background shaded by the signal (or by the slope's sign), and the
 * slope itself with the threshold band the signal is read against.
 * Orange with ▲ is long / rising, blue with ▼ is short / falling, unshaded is flat.
 */

import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS, Empty, GRID, OKABE, TOOLTIP, fmt, fmtTime } from "@/studies/kit";
import type { ZoomPoint } from "@shared/studies/slope-signal-backtest";
import { SIGNAL, fmtSigned, fmtTick, signalOf } from "./format";

interface PanelPoint {
  index: number;
  t: number;
  close: number;
  slopeFast: number | null;
  slopeAbove: number | null;
  slopeBelow: number | null;
  slopeSlow: number | null;
  thresholdUpper: number | null;
  thresholdLower: number | null;
  signal: number;
}

interface Run {
  from: number;
  to: number;
  side: number;
}

/** Consecutive points of the same side, as index ranges; side 0 is left out. */
function runsOf(sides: readonly number[]): Run[] {
  const runs: Run[] = [];
  let start = 0;
  for (let i = 1; i <= sides.length; i += 1) {
    if (i === sides.length || sides[i] !== sides[start]) {
      const side = sides[start] ?? 0;
      if (side !== 0) runs.push({ from: start, to: i - 1, side });
      start = i;
    }
  }
  return runs;
}

export function SlopePanels({
  zoom, shade, showSlow, fastWindow, slowWindow, slopeUnit,
}: {
  zoom: readonly ZoomPoint[];
  shade: string;
  showSlow: boolean;
  fastWindow: number;
  slowWindow: number;
  slopeUnit: string;
}) {
  if (zoom.length === 0) return <Empty>No bar has a slope yet: the window is longer than the bars read.</Empty>;

  const data: PanelPoint[] = zoom.map((point, index) => ({
    index,
    t: point.t,
    close: point.close,
    slopeFast: point.slopeFast,
    slopeAbove: point.slopeFast === null ? null : Math.max(point.slopeFast, 0),
    slopeBelow: point.slopeFast === null ? null : Math.min(point.slopeFast, 0),
    slopeSlow: point.slopeSlow,
    thresholdUpper: point.threshold,
    thresholdLower: point.threshold === null ? null : -point.threshold,
    signal: point.signal,
  }));
  const last = data.length - 1;
  const sides = data.map((point) => (shade === "slope" ? Math.sign(point.slopeFast ?? 0) : point.signal));
  const runs = shade === "none" ? [] : runsOf(sides);
  const tickOf = (index: number) => fmtTick(data[Math.min(Math.max(0, Math.round(index)), last)]?.t);
  const labelOf = (index: unknown) => {
    const point = data[Math.min(Math.max(0, Math.round(Number(index))), last)];
    return point ? `${fmtTime(point.t)} (Pacific wall clock as stamped)` : "";
  };
  const shadeName = shade === "slope" ? "the slope's sign" : "the signal";

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-300">
        <span className="font-medium text-neutral-100">Close, shaded by {shade === "none" ? "nothing" : shadeName}</span>
        <span className="flex items-center gap-1"><svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke="#d4d4d4" strokeWidth="1.6" /></svg>close</span>
        {shade !== "none" && (
          <>
            <span style={{ color: SIGNAL.long.color }}>{SIGNAL.long.glyph} {shade === "slope" ? "slope above zero" : "long"}</span>
            <span style={{ color: SIGNAL.short.color }}>{SIGNAL.short.glyph} {shade === "slope" ? "slope below zero" : "short"}</span>
            <span style={{ color: SIGNAL.flat.color }}>{SIGNAL.flat.glyph} {shade === "slope" ? "slope exactly zero" : "flat"} (unshaded)</span>
          </>
        )}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} syncId="slope-zoom" margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="index" type="number" domain={[-0.5, last + 0.5]} tickFormatter={tickOf} tickCount={7} {...AXIS} />
          <YAxis domain={["auto", "auto"]} width={62} tickFormatter={(value: number) => fmt(value, 0)} {...AXIS} label={{ value: "close, points", angle: -90, position: "insideLeft", fontSize: 10, fill: "#a3a3a3" }} />
          <Tooltip
            {...TOOLTIP}
            labelFormatter={labelOf}
            formatter={(value, _name, item) => {
              const side = signalOf((item.payload as PanelPoint).signal);
              return [`${fmt(typeof value === "number" ? value : null, 2)} points, signal ${side.glyph} ${side.label}`, "close"];
            }}
          />
          {runs.map((run) => (
            <ReferenceArea
              key={`${run.from}-${run.side}`}
              x1={run.from - 0.5}
              x2={run.to + 0.5}
              fill={run.side > 0 ? SIGNAL.long.color : SIGNAL.short.color}
              fillOpacity={run.side > 0 ? 0.16 : 0.24}
              stroke="none"
              ifOverflow="hidden"
            />
          ))}
          <Line dataKey="close" name="close" stroke="#d4d4d4" strokeWidth={1.4} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-neutral-300">
        <span className="font-medium text-neutral-100">Slope over {fastWindow} bars against its threshold</span>
        <span style={{ color: OKABE.orange }}>■ {SIGNAL.long.glyph} slope above zero</span>
        <span style={{ color: OKABE.blue }}>■ {SIGNAL.short.glyph} slope below zero</span>
        <span className="flex items-center gap-1"><svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke={OKABE.yellow} strokeWidth="1.5" strokeDasharray="4 3" /></svg>plus and minus the threshold</span>
        {showSlow && (
          <span className="flex items-center gap-1"><svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke={OKABE.purple} strokeWidth="2" /></svg>slope over {slowWindow} bars</span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} syncId="slope-zoom" margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="index" type="number" domain={[-0.5, last + 0.5]} tickFormatter={tickOf} tickCount={7} {...AXIS} label={{ value: "bar time, Pacific wall clock as stamped", position: "insideBottomRight", offset: -2, fontSize: 10, fill: "#a3a3a3" }} />
          <YAxis domain={["auto", "auto"]} width={62} tickFormatter={(value: number) => fmt(value, 2)} {...AXIS} label={{ value: `slope, ${slopeUnit}`, angle: -90, position: "insideLeft", fontSize: 10, fill: "#a3a3a3" }} />
          <Tooltip
            {...TOOLTIP}
            labelFormatter={labelOf}
            formatter={(value, name) => {
              const shown = fmtSigned(typeof value === "number" ? value : null, 4);
              if (name === "slopeAbove" || name === "slopeBelow") return [shown, `slope over ${fastWindow} bars (${slopeUnit})`];
              if (name === "slopeSlow") return [shown, `slope over ${slowWindow} bars (${slopeUnit})`];
              return [shown, name === "thresholdUpper" ? "long above this threshold" : "short below this threshold"];
            }}
          />
          <ReferenceLine y={0} stroke="#737373" />
          <Area dataKey="slopeAbove" name="slopeAbove" type="linear" stroke={OKABE.orange} strokeWidth={1} fill={OKABE.orange} fillOpacity={0.55} isAnimationActive={false} connectNulls={false} />
          <Area dataKey="slopeBelow" name="slopeBelow" type="linear" stroke={OKABE.blue} strokeWidth={1} fill={OKABE.blue} fillOpacity={0.65} isAnimationActive={false} connectNulls={false} />
          <Line dataKey="thresholdUpper" name="thresholdUpper" stroke={OKABE.yellow} strokeWidth={1.2} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls={false} />
          <Line dataKey="thresholdLower" name="thresholdLower" stroke={OKABE.yellow} strokeWidth={1.2} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls={false} />
          {showSlow && <Line dataKey="slopeSlow" name="slopeSlow" stroke={OKABE.purple} strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
