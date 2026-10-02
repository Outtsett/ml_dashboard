/**
 * The arithmetic behind the page, typeset with every symbol defined beside it
 * and carrying the value it holds for the selection on screen; and the running
 * count of extreme bars, which is the sum in the bell-curve formula drawn over time.
 */

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, FormulaCard, GRID, Section, TOOLTIP, fmt, fmtInt, fmtTime, type FormulaSymbol } from "@/studies/kit";
import { ruleSaysOneEvery, twoSidedTail, type ClockSeries, type ExtremeBar } from "@shared/studies/tail-clocks";
import { CLOCK_STYLE, ClockKey, NEUTRAL } from "./clocks";

function perClock(series: readonly ClockSeries[], value: (entry: ClockSeries) => string): string {
  return series.map((entry) => `${CLOCK_STYLE[entry.clock].glyph} ${value(entry)}`).join("   ");
}

function scientific(value: number): string {
  return value === 0 ? "0" : value.toExponential(3);
}

function compact(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1e9) return `${fmt(value / 1e9, 2)}B`;
  if (value >= 1e6) return `${fmt(value / 1e6, 2)}M`;
  if (value >= 1e3) return `${fmt(value / 1e3, 1)}k`;
  return fmt(value, 1);
}

export function Formulas({ series, sigma, size, oneMinuteBarCount }: { series: readonly ClockSeries[]; sigma: number; size: string; oneMinuteBarCount: number | null }) {
  const activity = series.filter((entry) => entry.clock !== "time");
  const target = series[0]?.calibrationTargetBarCount ?? null;
  const tail = twoSidedTail(sigma);

  const boundary: FormulaSymbol[] = [
    { tex: "w_m", name: "weight of 1-minute bar m: its contracts (volume clock) or its contracts times its unadjusted close (dollar clock)", value: "one per bar" },
    { tex: "M", name: "one-minute bars of this root in the lake", value: fmtInt(oneMinuteBarCount) },
    { tex: "N", name: `bars the calendar cuts at ${size}; the activity clocks are calibrated to the same count`, value: fmtInt(target) },
    { tex: "\\theta", name: "threshold: contracts per bar (volume clock) or dollars per bar (dollar clock)", value: activity.length ? perClock(activity, (entry) => `${compact(entry.thresholdPerBar)} ${entry.thresholdUnit}`) : "no activity clock shown" },
    { tex: "j", name: "running index of the 1-minute bar being assigned", value: `1 to ${fmtInt(oneMinuteBarCount)}` },
  ];
  const standardise: FormulaSymbol[] = [
    { tex: "c_i", name: "close of bar i, front-month and ratio back-adjusted", value: "one per bar" },
    { tex: "r_i", name: "log return of bar i, the change in the log close from the bar before", value: "one per bar" },
    { tex: "\\bar r", name: "mean of r over the first 80% of the series", value: perClock(series, (entry) => scientific(entry.logReturnMean ?? 0)) },
    { tex: "s", name: "sample standard deviation of r (divide by n-1) over the same span", value: perClock(series, (entry) => scientific(entry.logReturnStandardDeviation ?? 0)) },
    { tex: "z_i", name: "the standardised return: how many standard deviations bar i moved", value: "mean 0, deviation 1" },
  ];
  const expectation: FormulaSymbol[] = [
    { tex: "k", name: "the gate: a bar is extreme when it moves more than k standard deviations", value: `${fmt(sigma, 1)}σ` },
    { tex: "n", name: "returns counted on this clock", value: perClock(series, (entry) => fmtInt(entry.returnCount)) },
    { tex: "\\Phi", name: "the standard normal cumulative distribution function", value: `Φ(${fmt(sigma, 1)}) = ${fmt(1 - tail / 2, 8)}` },
    { tex: "2\\,(1-\\Phi(k))", name: "chance that one bell-curve bar lands beyond k on either side", value: `${scientific(tail)}, one bar in ${fmtInt(ruleSaysOneEvery(sigma))}` },
    { tex: "\\mathbb{E}", name: "expected number of bars beyond k if returns were a bell curve", value: perClock(series, (entry) => fmt(entry.beyond.predicted, 2)) },
    { tex: "\\#\\{\\cdot\\}", name: "the observed count: how many of the n bars exceed the gate", value: perClock(series, (entry) => fmtInt(entry.beyond.observed)) },
  ];
  const kurtosis: FormulaSymbol[] = [
    { tex: "\\kappa", name: "excess kurtosis: 0 for a bell curve, larger when the tails are fat", value: perClock(series, (entry) => fmt(entry.standardised.kurtosis, 3)) },
    { tex: "\\bar z", name: "mean of the standardised returns", value: perClock(series, (entry) => scientific(entry.standardised.mean ?? 0)) },
    { tex: "n", name: "returns counted on this clock", value: perClock(series, (entry) => fmtInt(entry.returnCount)) },
    { tex: "z_i", name: "standardised return of bar i", value: "one per bar" },
    { tex: "\\gamma", name: "skewness: the third central moment over the second to the power 3/2", value: perClock(series, (entry) => fmt(entry.standardised.skewness, 3)) },
  ];

  return (
    <Section title="The arithmetic" question="Each formula with its symbols in plain words and the value each holds for this selection.">
      <div className="grid gap-3 xl:grid-cols-2">
        <FormulaCard
          tex={"\\text{bar}(j)=\\left\\lfloor \\frac{\\sum_{m=1}^{j} w_m}{\\theta} \\right\\rfloor,\\qquad \\theta=\\frac{\\sum_{m=1}^{M} w_m}{N}"}
          symbols={boundary}
          caption="Where a volume or dollar bar ends: the bar that crosses a boundary closes on that 1-minute bar, so a bar can slightly overshoot."
        />
        <FormulaCard
          tex={"z_i=\\frac{r_i-\\bar r}{s},\\qquad r_i=\\ln\\frac{c_i}{c_{i-1}}"}
          symbols={standardise}
          caption="Whole-span standardisation over the development span: descriptive, not causal."
        />
        <FormulaCard
          tex={"\\mathbb{E}\\,\\#\\{\\,|z_i|>k\\,\\}=n\\cdot 2\\,\\bigl(1-\\Phi(k)\\bigr)=n\\cdot\\operatorname{erfc}\\!\\left(\\frac{k}{\\sqrt{2}}\\right)"}
          symbols={expectation}
          caption="What the 68-95-99.7 rule predicts beyond the gate; the observed count is the sum of an indicator over every bar."
        />
        <FormulaCard
          tex={"\\kappa=\\frac{\\frac1n\\sum_{i=1}^{n}(z_i-\\bar z)^4}{\\Bigl(\\frac1n\\sum_{i=1}^{n}(z_i-\\bar z)^2\\Bigr)^{2}}-3,\\qquad \\gamma=\\frac{\\frac1n\\sum_{i=1}^{n}(z_i-\\bar z)^3}{\\Bigl(\\frac1n\\sum_{i=1}^{n}(z_i-\\bar z)^2\\Bigr)^{3/2}}"}
          symbols={kurtosis}
          caption="Population moments, as scipy computes them."
        />
      </div>
    </Section>
  );
}

/** The running count of bars beyond k through history, against an even spread of what the bell curve expects. */
export function CumulativeChart({ series, extremes, sigma }: { series: readonly ClockSeries[]; extremes: readonly ExtremeBar[]; sigma: number }) {
  if (series.length === 0) return null;
  const truncated = series.some((entry) => extremes.filter((bar) => bar.clock === entry.clock).length < entry.beyond.observed);
  if (truncated) {
    return <p className="mt-2 text-[11px] text-neutral-400">Raise the gate to see the running count: at {fmt(sigma, 1)}σ there are more extreme bars than the page keeps per clock.</p>;
  }
  const first = Math.min(...series.map((entry) => entry.firstTimestamp ?? Infinity));
  const last = Math.max(...series.map((entry) => entry.lastTimestamp ?? -Infinity));
  const reference = series[0];
  const lines = series.map((entry) => {
    const bars = extremes.filter((bar) => bar.clock === entry.clock).sort((a, b) => a.timestamp - b.timestamp);
    const points = [{ timestamp: first, count: 0 }, ...bars.map((bar, index) => ({ timestamp: bar.timestamp, count: index + 1 })), { timestamp: last, count: bars.length }];
    return { clock: entry.clock, points };
  });
  const expected = reference ? [{ timestamp: first, expected: 0 }, { timestamp: last, expected: reference.beyond.predicted }] : [];
  return (
    <div className="mt-3 space-y-1">
      <h4 className="text-[11px] font-semibold text-neutral-200">The sum, over time: extreme bars accumulating, against the bell curve's even spread</h4>
      <div className="flex flex-wrap gap-x-4 gap-y-1">{series.map((entry) => <ClockKey key={entry.clock} clock={entry.clock} />)}</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart margin={{ top: 8, right: 14, left: 4, bottom: 4 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="timestamp" type="number" domain={[first, last]} tickFormatter={(value: number) => String(new Date(value).getUTCFullYear())} {...AXIS} />
          <YAxis type="number" allowDecimals={false} width={40} {...AXIS} />
          <Tooltip {...TOOLTIP} labelFormatter={(value) => fmtTime(Number(value))} />
          {lines.map((line) => (
            <Line key={line.clock} data={line.points} dataKey="count" name={CLOCK_STYLE[line.clock].label} type="stepAfter" stroke={CLOCK_STYLE[line.clock].color} strokeDasharray={CLOCK_STYLE[line.clock].dash} strokeWidth={1.6} dot={false} isAnimationActive={false} />
          ))}
          <Line data={expected} dataKey="expected" name="the bell curve expects" type="linear" stroke={NEUTRAL} strokeDasharray="1 3" strokeWidth={1.4} dot={false} isAnimationActive={false} />
          <ReferenceLine y={0} stroke={NEUTRAL} strokeOpacity={0.4} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
