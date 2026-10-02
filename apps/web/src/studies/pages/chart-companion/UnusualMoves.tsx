/**
 * Which bars moved unusually: the return z-score bar by bar with the
 * threshold rules and a marker on every bar past them, whether the tails are
 * fat (observed share past each threshold against a bell curve), and the z
 * formula with its sums stepped one bar at a time.
 */

import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import {
  barTimeText, earlierReturns, findUnusualMoves, normalTwoSidedShare, observedTailShares, sixSignificant, thinIndices,
  type CompanionFrame,
} from "@shared/studies/chart-companion";
import { AXIS, FormulaCard, GRID, OKABE, Section, SliderControl, Stat, TOOLTIP, Finding, fmt, fmtInt, fmtPercent } from "@/studies/kit";

const LINE_POINTS = 1_200;
const MARKER_LIMIT = 3_000;
const TAIL_THRESHOLDS = Array.from({ length: 31 }, (_, step) => Math.round((1 + step * 0.1) * 10) / 10);

interface ZRow {
  t: number;
  z: number;
  r: number;
}

function Mark({ cx, cy, fill, up }: { cx?: number; cy?: number; fill: string; up: boolean }) {
  if (cx === undefined || cy === undefined) return null;
  const size = 5;
  const path = up ? `M${cx},${cy - size} L${cx + size},${cy + size} L${cx - size},${cy + size} Z` : `M${cx},${cy + size} L${cx + size},${cy - size} L${cx - size},${cy - size} Z`;
  return <path d={path} fill={fill} />;
}

function ZTooltip({ active, payload, clock }: { active?: boolean; payload?: Array<{ payload: ZRow }>; clock: string }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div style={TOOLTIP.contentStyle} className="px-2 py-1">
      <div className="text-neutral-400">{barTimeText(row.t)} ({clock})</div>
      <div className="font-mono">return z-score {row.z >= 0 ? "+" : ""}{row.z.toFixed(2)}</div>
      <div className="font-mono">log return {row.r >= 0 ? "+" : ""}{row.r.toFixed(5)}</div>
    </div>
  );
}

function rowsAt(frame: CompanionFrame, indices: readonly number[]): ZRow[] {
  return indices.map((index) => ({ t: frame.bars.timestamps[index] as number, z: frame.scored.returnZscore[index] as number, r: frame.scored.logReturn[index] as number }));
}

/** The bars of `indices` with the largest |z|, at most MARKER_LIMIT of them. */
function largest(frame: CompanionFrame, indices: readonly number[]): number[] {
  return [...indices].sort((a, b) => Math.abs(frame.scored.returnZscore[b] as number) - Math.abs(frame.scored.returnZscore[a] as number)).slice(0, MARKER_LIMIT);
}

export function UnusualMoves({
  frame, threshold, window, clock, focusIndex, selected, onPick, k, onK,
}: {
  frame: CompanionFrame;
  threshold: number;
  window: number;
  clock: string;
  /** The bar whose numbers fill the formula: the selected bar, else the newest scored one. */
  focusIndex: number | null;
  selected: boolean;
  onPick: (stamp: number) => void;
  k: number;
  onK: (next: number) => void;
}) {
  const moves = findUnusualMoves(frame.scored.returnZscore, threshold);
  const line = rowsAt(frame, thinIndices(frame.scored.returnZscore, LINE_POINTS));
  const up = rowsAt(frame, largest(frame, moves.upIndices));
  const down = rowsAt(frame, largest(frame, moves.downIndices));
  const selectedStamp = selected && focusIndex !== null ? (frame.bars.timestamps[focusIndex] as number) : null;
  const flagged = moves.upIndices.length + moves.downIndices.length;
  const bell = normalTwoSidedShare(threshold);
  const observed = moves.scoredCount > 0 ? flagged / moves.scoredCount : null;

  const shares = observedTailShares(frame.scored.returnZscore, TAIL_THRESHOLDS);
  const tail = TAIL_THRESHOLDS.map((value, position) => {
    const seen = shares[position];
    return { threshold: value, observed: seen === null || seen === undefined || seen === 0 ? null : 100 * seen, bell: 100 * normalTwoSidedShare(value) };
  });

  // The formula's numbers for the focus bar.
  const earlier = focusIndex === null ? [] : earlierReturns(frame, focusIndex);
  const complete = earlier.length === window;
  const step = Math.min(Math.max(1, k), window);
  const stepValue = complete ? (earlier[window - step] as number) : null;
  let running = 0;
  for (let back = 1; back <= step && complete; back += 1) running += earlier[window - back] as number;
  const mean = focusIndex === null ? Number.NaN : (frame.scored.returnTrailingMean[focusIndex] as number);
  const deviation = focusIndex === null ? Number.NaN : (frame.scored.returnTrailingStandardDeviation[focusIndex] as number);
  const z = focusIndex === null ? Number.NaN : (frame.scored.returnZscore[focusIndex] as number);
  const r = focusIndex === null ? Number.NaN : (frame.scored.logReturn[focusIndex] as number);
  const squaredTerm = stepValue !== null && Number.isFinite(mean) ? (stepValue - mean) ** 2 : null;
  const stepBars = complete ? earlier.map((_, position) => ({ k: position + 1, value: earlier[window - 1 - position] as number })) : [];

  return (
    <Section title="Which bars moved unusually" question="How many standard deviations each bar's return sits from the returns of the bars just before it.">
      <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={line} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={(event) => { if (event?.activeLabel !== undefined) onPick(Number(event.activeLabel)); }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(stamp: number) => new Date(stamp).toISOString().slice(5, 16).replace("T", " ")} tickCount={5} {...AXIS} />
                <YAxis {...AXIS} width={40} tickFormatter={(value: number) => fmt(value, 1)} label={{ value: "return z-score", angle: -90, position: "insideLeft", fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <Tooltip content={<ZTooltip clock={clock} />} />
                <ReferenceLine y={threshold} stroke="#d4d4d4" strokeDasharray="4 4" label={{ value: `+${threshold.toFixed(1)}`, fill: "#d4d4d4", fontSize: 9, position: "right" }} />
                <ReferenceLine y={-threshold} stroke="#d4d4d4" strokeDasharray="4 4" label={{ value: `-${threshold.toFixed(1)}`, fill: "#d4d4d4", fontSize: 9, position: "right" }} />
                {selectedStamp !== null && <ReferenceLine x={selectedStamp} stroke={OKABE.vermillion} strokeDasharray="3 2" />}
                <Line dataKey="z" stroke="#9ca3af" strokeWidth={1} dot={false} isAnimationActive={false} />
                <Scatter data={up} dataKey="z" fill={OKABE.orange} isAnimationActive={false} shape={(props: { cx?: number; cy?: number }) => <Mark cx={props.cx} cy={props.cy} fill={OKABE.orange} up />} />
                <Scatter data={down} dataKey="z" fill={OKABE.blue} isAnimationActive={false} shape={(props: { cx?: number; cy?: number }) => <Mark cx={props.cx} cy={props.cy} fill={OKABE.blue} up={false} />} />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-neutral-500">
              <span style={{ color: OKABE.orange }}>▲</span> up move (orange, triangle up) · <span style={{ color: OKABE.blue }}>▼</span> down move (blue, triangle down) · dashed lines are ±{threshold.toFixed(1)}. Click a point to select that bar below.
              {moves.upIndices.length + moves.downIndices.length > 2 * MARKER_LIMIT && " Only the largest moves are marked."}
            </p>
          </div>
          <div className="min-w-0 space-y-2">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={tail} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="threshold" type="number" domain={[1, 4]} tickCount={7} {...AXIS} tickFormatter={(value: number) => value.toFixed(1)} label={{ value: "threshold |z|", position: "insideBottom", offset: -2, fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <YAxis scale="log" domain={[0.01, 100]} ticks={[0.01, 0.1, 1, 10, 100]} allowDataOverflow {...AXIS} width={40} tickFormatter={(value: number) => `${value}%`} />
                <Tooltip
                  {...TOOLTIP}
                  labelFormatter={(label) => `|z| ≥ ${Number(label).toFixed(1)}`}
                  formatter={(value: number, name: string) => [`${fmt(value, 3)}%`, name === "observed" ? "bars past it (observed)" : "bell curve would give"]}
                />
                <ReferenceLine x={threshold} stroke={OKABE.yellow} strokeDasharray="4 3" label={{ value: "threshold", fill: OKABE.yellow, fontSize: 9, position: "top" }} />
                <Line dataKey="bell" name="bell" stroke={OKABE.sky} strokeDasharray="6 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line dataKey="observed" name="observed" stroke={OKABE.orange} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-neutral-500">Share of scored bars at or beyond each threshold: observed (orange, solid, dots) against a bell curve (sky, dashed), log scale. Observed above the dashed line is a fat tail.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="past the threshold" value={`${fmtInt(flagged)} of ${fmtInt(moves.scoredCount)}`} hint={`|z| ≥ ${threshold.toFixed(1)} among the scored bars`} />
          <Stat label="up moves (▲)" value={fmtInt(moves.upIndices.length)} tone={OKABE.orange} />
          <Stat label="down moves (▼)" value={fmtInt(moves.downIndices.length)} tone={OKABE.blue} />
          <Stat label="not scored" value={fmtInt(moves.unscoredCount)} hint={`fewer than ${window} earlier returns exist for these visible bars`} />
        </div>
        <Finding>
          {fmtInt(flagged)} of {fmtInt(moves.scoredCount)} scored bars pass |z| ≥ {threshold.toFixed(1)}: {fmtInt(moves.upIndices.length)} up moves (orange, triangle up) and {fmtInt(moves.downIndices.length)} down moves (blue, triangle down).
          {" "}{fmtInt(moves.unscoredCount)} visible bars have no score because fewer than {window} earlier returns exist for them. Under a bell curve about {fmt(100 * bell, 1)}% of bars would pass this threshold by chance
          {observed !== null && <>; here {fmtPercent(observed, 1)} do{observed > bell ? ", so the returns have fat tails" : ""}</>}.
        </Finding>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <FormulaCard
              tex={String.raw`z_i=\frac{r_i-m_i}{s_i},\quad m_i=\frac{1}{w}\sum_{k=1}^{w} r_{i-k},\quad s_i=\sqrt{\frac{1}{w-1}\sum_{k=1}^{w}\left(r_{i-k}-m_i\right)^{2}}`}
              caption={focusIndex === null ? "No bar to read the values from yet." : `Values for ${selected ? "the selected bar" : "the newest scored bar"}, ${barTimeText(frame.bars.timestamps[focusIndex] as number)} (${clock}).`}
              symbols={[
                { tex: "z_i", name: "return z-score of bar i: standard deviations from the trailing mean", value: Number.isFinite(z) ? fmt(z, 3) : "—" },
                { tex: "r_i", name: "log return of bar i (natural log of its close over the previous close)", value: Number.isFinite(r) ? sixSignificant(r) : "—" },
                { tex: "m_i", name: "trailing mean: average log return of the w bars before bar i", value: Number.isFinite(mean) ? sixSignificant(mean) : "—" },
                { tex: "s_i", name: "trailing standard deviation of those same w earlier returns (divisor w - 1)", value: Number.isFinite(deviation) ? sixSignificant(deviation) : "—" },
                { tex: "w", name: "trailing window: how many earlier bars each bar is compared with", value: `${window} bars` },
                { tex: String.raw`\sum_{k=1}^{w}`, name: "sum over the w earlier bars; k = 1 is the bar just before bar i", value: stepValue === null ? "—" : `first ${step} terms add to ${sixSignificant(running)}` },
                { tex: "r_{i-k}", name: "log return k bars before bar i (the term being added at step k)", value: stepValue === null ? "—" : `k = ${step}: ${sixSignificant(stepValue)}` },
                { tex: String.raw`\theta`, name: "unusual-move threshold: a bar is unusual when |z| is at least this", value: threshold.toFixed(1) },
              ]}
            />
            <SliderControl label="Step the sum, k" value={step} min={1} max={window} onChange={onK} hint="Move k to light up the terms of the sums one bar before bar i at a time" />
            {squaredTerm !== null && (
              <p className="text-[11px] text-neutral-400">
                At k = {step}: the term r<sub>i-k</sub> = <span className="font-mono text-neutral-200">{sixSignificant(stepValue)}</span>, its squared distance from m<sub>i</sub> is{" "}
                <span className="font-mono text-neutral-200">{sixSignificant(squaredTerm)}</span>, and the running total of r is <span className="font-mono text-neutral-200">{sixSignificant(running)}</span> of the final{" "}
                <span className="font-mono text-neutral-200">{sixSignificant(mean * window)}</span>.
              </p>
            )}
          </div>
          <div className="min-w-0 space-y-1">
            {complete ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={stepBars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
                  <CartesianGrid {...GRID} vertical={false} />
                  <XAxis dataKey="k" {...AXIS} interval="preserveStartEnd" label={{ value: "k: bars before bar i (1 = the bar just before)", position: "insideBottom", offset: -2, fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                  <YAxis {...AXIS} width={48} tickFormatter={(value: number) => sixSignificant(value)} />
                  <Tooltip {...TOOLTIP} labelFormatter={(label) => `k = ${label}`} formatter={(value: number) => [sixSignificant(value), "log return r(i-k)"]} />
                  {Number.isFinite(mean) && <ReferenceLine y={mean} stroke={OKABE.purple} strokeDasharray="4 3" label={{ value: "m", fill: OKABE.purple, fontSize: 9, position: "right" }} />}
                  <Bar dataKey="value" isAnimationActive={false}>
                    {stepBars.map((row) => (
                      <Cell key={row.k} fill={row.k === step ? OKABE.yellow : row.k < step ? OKABE.sky : "#525252"} stroke={row.k === step ? "#ffffff" : undefined} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-neutral-500">The bar has fewer than {window} earlier returns, so there is no sum to step.</p>
            )}
            <p className="text-[10px] text-neutral-500">The {window} returns before the bar: terms already added are sky, the term at step k is yellow with a white outline, terms still to come are grey; the purple dashed line is their mean m.</p>
          </div>
        </div>
      </div>
    </Section>
  );
}
