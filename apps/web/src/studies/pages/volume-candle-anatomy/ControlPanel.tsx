/**
 * Panel F: the bid-ask bounce control. Every relationship exists twice, over
 * all bars and over bars closing strictly inside their range; points off the
 * identity line are relationships the bounce was inflating or hiding.
 * Timeframes are an ordered scale, so they take a cividis ramp AND a
 * distinct marker shape each.
 */

import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { interpolateCividis } from "d3-scale-chromatic";
import { AXIS, Finding, GRID, Section, TOOLTIP, fmt } from "@/studies/kit";
import { TIMEFRAMES, controlShifts, type BoardOverallRow, type ControlShift } from "@shared/studies/volume-candle-anatomy";
import { SHORT_ENCODING, SHORT_MEASURE } from "./controls";

const SHAPES = ["circle", "square", "diamond", "triangle", "star"] as const;

function ShiftTip({ payload }: { payload?: ReadonlyArray<{ payload?: ControlShift }> }) {
  const point = payload?.[0]?.payload;
  if (!point || !point.timeframe) return null;
  return (
    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
      <div className="font-semibold">{point.timeframe} · {point.volume_encoding} × {point.anatomy_measure}</div>
      <div>all bars {fmt(point.allBars, 4)} · control {fmt(point.controlBars, 4)}</div>
      <div>shift {point.shift >= 0 ? "+" : ""}{fmt(point.shift, 4)}</div>
    </div>
  );
}

export function ControlPanel({ rows }: { rows: readonly BoardOverallRow[] }) {
  const shifts = controlShifts(rows);
  const worst = [...shifts].sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift))[0];
  const extent = Math.max(0.1, ...shifts.flatMap((shift) => [Math.abs(shift.allBars), Math.abs(shift.controlBars)])) * 1.05;
  const identity = [{ x: -extent, y: -extent }, { x: extent, y: extent }];
  const byTimeframe = TIMEFRAMES.map((timeframe, index) => ({
    timeframe,
    color: interpolateCividis(0.45 + 0.55 * (index / (TIMEFRAMES.length - 1))),
    shape: SHAPES[index] as (typeof SHAPES)[number],
    data: shifts.filter((shift) => shift.timeframe === timeframe).map((shift) => ({ ...shift, x: shift.allBars, y: shift.controlBars })),
  }));
  const meanShift = (timeframe: string) => {
    const own = shifts.filter((shift) => shift.timeframe === timeframe);
    return own.length ? own.reduce((sum, shift) => sum + Math.abs(shift.shift), 0) / own.length : null;
  };

  return (
    <Section
      title="F. The bid-ask bounce control"
      question="On short bars the spread manufactures wicks: a bar closing exactly on its high or low has a zero-length wick for a mechanical reason. The gap between the two populations is the size of that contamination."
    >
      <div className="space-y-2">
        <Finding>
          Points on the dashed identity line are unaffected by the control; points off it are relationships the bounce was inflating or hiding.
          {worst && (
            <> Largest shift: <strong>{SHORT_ENCODING[worst.volume_encoding] ?? worst.volume_encoding} × {SHORT_MEASURE[worst.anatomy_measure] ?? worst.anatomy_measure}</strong> at {worst.timeframe}, moving <strong>{worst.shift >= 0 ? "+" : ""}{fmt(worst.shift, 4)}</strong>.</>
          )}
          {" "}Mean absolute shift by timeframe: {TIMEFRAMES.map((timeframe) => `${timeframe} ${fmt(meanShift(timeframe), 4)}`).join(", ")}; a spread-driven artefact should shrink as bars lengthen.
        </Finding>
        <ResponsiveContainer width="100%" height={420}>
          <ComposedChart margin={{ top: 8, right: 16, left: 4, bottom: 18 }}>
            <CartesianGrid {...GRID} />
            <XAxis type="number" dataKey="x" domain={[-extent, extent]} {...AXIS} tickFormatter={(v: number) => v.toFixed(2)} label={{ value: "Spearman, all bars", position: "insideBottom", offset: -10, fill: "#a3a3a3", fontSize: 10 }} />
            <YAxis type="number" dataKey="y" domain={[-extent, extent]} {...AXIS} tickFormatter={(v: number) => v.toFixed(2)} label={{ value: "Spearman, bars closing inside range", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
            <ZAxis range={[60, 60]} />
            <Tooltip {...TOOLTIP} content={(props) => <ShiftTip payload={props.payload as ReadonlyArray<{ payload?: ControlShift }> | undefined} />} />
            <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
            <Line data={identity} dataKey="y" name="no shift" stroke="#f5f5f5" strokeOpacity={0.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} legendType="plainline" />
            {byTimeframe.map((entry) => (
              <Scatter key={entry.timeframe} name={entry.timeframe} data={entry.data} fill={entry.color} shape={entry.shape} legendType={entry.shape} fillOpacity={0.85} isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}
