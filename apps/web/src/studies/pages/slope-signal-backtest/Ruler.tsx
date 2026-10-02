/**
 * One window of closes with the least-squares line through it: the "ruler".
 * The slope is a sum of one term per bar over a fixed denominator; the stepper
 * walks the bar index j and each term lights up in the bar chart and in the
 * running total, until the last bar gives the slope the server computed.
 */

import {
  Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS, FormulaCard, GRID, OKABE, TOOLTIP, fmt, fmtTime, toneOf } from "@/studies/kit";
import { linearFit, type DemoWindow } from "@shared/studies/slope-signal-backtest";
import { fmtSigned } from "./format";

const SLOPE_FORMULA = String.raw`b=\frac{\sum_{j=0}^{N-1}\left(j-\bar{x}\right)\left(C_j-\bar{C}\right)}{\sum_{j=0}^{N-1}\left(j-\bar{x}\right)^2}`;

interface RulerPoint {
  bar: number;
  close: number;
  fitted: number;
  term: number;
  runningTotal: number | null;
  included: boolean;
}

function CloseDot({ cx, cy, payload, step }: { cx?: number; cy?: number; payload?: RulerPoint; step: number }) {
  if (cx === undefined || cy === undefined || !payload) return null;
  const current = payload.bar === step;
  if (current) return <circle cx={cx} cy={cy} r={6} fill={OKABE.yellow} stroke="#0a0a0a" strokeWidth={1.5} />;
  if (payload.included) return <circle cx={cx} cy={cy} r={3.5} fill={OKABE.sky} />;
  return <circle cx={cx} cy={cy} r={3.5} fill="none" stroke={OKABE.grey} strokeWidth={1.2} />;
}

export function Ruler({ demo, step, onStep }: { demo: DemoWindow; step: number; onStep: (step: number) => void }) {
  const closes = demo.closes;
  const count = closes.length;
  const last = Math.max(0, count - 1);
  const at = Math.min(Math.max(0, Math.round(step)), last);
  const centre = (count - 1) / 2;
  const meanClose = demo.meanClose;
  const fit = linearFit(closes);

  let denominator = 0;
  for (let j = 0; j < count; j += 1) denominator += (j - centre) * (j - centre);
  let running = 0;
  const points: RulerPoint[] = closes.map((close, j) => {
    const term = (j - centre) * (close - meanClose);
    running += term;
    return { bar: j, close, fitted: demo.intercept + demo.slope * j, term, runningTotal: j <= at ? running : null, included: j <= at };
  });
  const current = points[at];
  const numeratorSoFar = current?.runningTotal ?? 0;
  const slopeSoFar = denominator > 0 ? numeratorSoFar / denominator : NaN;
  const agrees = Math.abs(fit.slope - demo.slope) < 1e-9;

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <FormulaCard
          tex={SLOPE_FORMULA}
          caption={`Read it as: the slope is the sum, over every bar in the window, of (how far the bar sits from the middle of the window) times (how far its close sits from the average close), divided by a fixed number that depends only on the window length. Bar j = ${at} is lit; the legend holds its values.`}
          symbols={[
            { tex: "b", name: "slope: the tilt of the ruler (points per bar)", value: `${fmtSigned(demo.slope, 4)}` },
            { tex: "\\sum", name: "sum over every bar of the window, j = 0 to N - 1", value: `${at + 1} of ${count} terms added` },
            { tex: "N", name: "window length (bars)", value: String(count) },
            { tex: "j", name: "bar index inside the window, 0 is the oldest (bars)", value: String(at) },
            { tex: "\\bar{x}", name: "middle of the window, (N - 1) / 2 (bars)", value: fmt(centre, 1) },
            { tex: "C_j", name: "close of bar j (points)", value: fmt(current?.close ?? null, 2) },
            { tex: "\\bar{C}", name: "average close of the window (points)", value: fmt(meanClose, 2) },
            { tex: "(j-\\bar{x})(C_j-\\bar{C})", name: "this bar's term in the top sum (bars x points)", value: fmtSigned(current?.term ?? null, 2) },
            { tex: "\\sum_{0}^{j}", name: "running total of the top sum up to bar j (bars x points)", value: fmtSigned(numeratorSoFar, 2) },
            { tex: "\\sum (j-\\bar{x})^2", name: "bottom sum, fixed by the window length (bars squared)", value: fmt(denominator, 1) },
            { tex: "b_{0..j}", name: "running total divided by the bottom sum: the slope so far (points per bar)", value: fmtSigned(slopeSoFar, 4) },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-300">
          <button type="button" onClick={() => onStep(at >= last ? 0 : at + 1)} className="rounded border border-neutral-700 px-2 py-1 hover:border-neutral-500">
            Step to the next bar
          </button>
          <button type="button" onClick={() => onStep(last)} className="rounded border border-neutral-700 px-2 py-1 hover:border-neutral-500">
            Add every bar
          </button>
          <button type="button" onClick={() => onStep(0)} className="rounded border border-neutral-700 px-2 py-1 hover:border-neutral-500">
            Back to the first bar
          </button>
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={at}
            onChange={(event) => onStep(Number(event.target.value))}
            aria-label="bar index inside the window"
            className="h-1 w-40 accent-[#56B4E9]"
          />
          <span className="font-mono tnum text-neutral-400">j = {at}</span>
        </div>
        <p className="text-[11px] text-neutral-400">
          Window starts at bar {demo.startIndex.toLocaleString("en-US")} ({fmtTime(demo.startTimestamp)}, Pacific wall clock as stamped). Slope {fmtSigned(demo.slope, 4)} points
          per bar, so the line rises {fmtSigned(demo.riseAcrossWindow, 1)} points from the first bar to the last; R squared {fmt(demo.rSquared, 3)} (the share of the closes' spread
          the line accounts for). <span className={agrees ? "text-neutral-200" : "text-[#E69F00]"}>{agrees ? "The browser's fit of these closes equals the server's slope." : "The browser's fit differs from the server's slope."}</span>
        </p>
      </div>

      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-300">
          <span className="font-medium text-neutral-100">Closes and the fitted line</span>
          <span className="flex items-center gap-1"><svg width="12" height="10" aria-hidden="true"><circle cx="6" cy="5" r="3.5" fill={OKABE.sky} /></svg>close already added</span>
          <span className="flex items-center gap-1"><svg width="12" height="10" aria-hidden="true"><circle cx="6" cy="5" r="3.5" fill="none" stroke={OKABE.grey} strokeWidth="1.2" /></svg>close not added yet</span>
          <span className="flex items-center gap-1"><svg width="14" height="12" aria-hidden="true"><circle cx="7" cy="6" r="5" fill={OKABE.yellow} /></svg>bar j</span>
          <span className="flex items-center gap-1"><svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke={OKABE.orange} strokeWidth="2" strokeDasharray="6 3" /></svg>fitted line (the ruler)</span>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={points} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="bar" type="number" domain={[0, last]} tickCount={Math.min(count, 11)} allowDecimals={false} {...AXIS} label={{ value: "bar index inside the window", position: "insideBottomRight", offset: -2, fontSize: 10, fill: "#a3a3a3" }} />
            <YAxis domain={["auto", "auto"]} width={62} tickFormatter={(value: number) => fmt(value, 0)} {...AXIS} label={{ value: "close, points", angle: -90, position: "insideLeft", fontSize: 10, fill: "#a3a3a3" }} />
            <Tooltip
              {...TOOLTIP}
              labelFormatter={(label) => `bar ${String(label)} of the window`}
              formatter={(value, name) => [fmt(typeof value === "number" ? value : null, 2), name === "close" ? "close (points)" : "fitted line (points)"]}
            />
            <ReferenceLine y={meanClose} stroke={OKABE.grey} strokeDasharray="2 3" label={{ value: "average close", position: "insideTopLeft", fontSize: 9, fill: OKABE.grey }} />
            <ReferenceLine x={centre} stroke={OKABE.grey} strokeDasharray="2 3" label={{ value: "middle of the window", position: "insideBottomLeft", fontSize: 9, fill: OKABE.grey }} />
            <Line dataKey="fitted" name="fitted" stroke={OKABE.orange} strokeWidth={2} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
            <Line
              dataKey="close"
              name="close"
              stroke="#737373"
              strokeWidth={1}
              isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; payload?: RulerPoint; index?: number }) => <CloseDot key={props.index} cx={props.cx} cy={props.cy} payload={props.payload} step={at} />}
              activeDot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-300">
          <span className="font-medium text-neutral-100">Each bar's term, and the running total</span>
          <span style={{ color: OKABE.orange }}>■ term above zero (pushes the slope up)</span>
          <span style={{ color: OKABE.blue }}>■ term below zero (pushes the slope down)</span>
          <span className="flex items-center gap-1"><svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke={OKABE.sky} strokeWidth="2" /></svg>running total (right axis)</span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={points} margin={{ top: 8, right: 4, left: 4, bottom: 4 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="bar" type="number" domain={[-0.5, last + 0.5]} tickCount={Math.min(count, 11)} allowDecimals={false} {...AXIS} label={{ value: "bar index inside the window", position: "insideBottomRight", offset: -2, fontSize: 10, fill: "#a3a3a3" }} />
            <YAxis yAxisId="term" width={62} tickFormatter={(value: number) => fmt(value, 0)} {...AXIS} label={{ value: "term, bars x points", angle: -90, position: "insideLeft", fontSize: 10, fill: "#a3a3a3" }} />
            <YAxis yAxisId="total" orientation="right" width={62} tickFormatter={(value: number) => fmt(value, 0)} {...AXIS} label={{ value: "running total", angle: 90, position: "insideRight", fontSize: 10, fill: "#a3a3a3" }} />
            <Tooltip
              {...TOOLTIP}
              labelFormatter={(label) => `bar ${String(label)} of the window`}
              formatter={(value, name) => [fmtSigned(typeof value === "number" ? value : null, 2), name === "term" ? "term (bars x points)" : "running total (bars x points)"]}
            />
            <ReferenceLine yAxisId="term" y={0} stroke="#737373" />
            <Bar yAxisId="term" dataKey="term" name="term" isAnimationActive={false}>
              {points.map((point) => (
                <Cell key={point.bar} fill={toneOf(point.term)} fillOpacity={point.included ? 1 : 0.18} stroke={point.bar === at ? OKABE.yellow : "none"} strokeWidth={point.bar === at ? 2 : 0} />
              ))}
            </Bar>
            <Line yAxisId="total" dataKey="runningTotal" name="runningTotal" stroke={OKABE.sky} strokeWidth={2} dot={{ r: 2, fill: OKABE.sky }} isAnimationActive={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
