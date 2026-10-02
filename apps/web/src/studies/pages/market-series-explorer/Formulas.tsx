/**
 * The formulas behind the series, each as an object to operate: step the
 * index of a sum and watch the term join the running total.
 *   ZscoreStepper  the causal z-score: a 100-bar trailing mean and deviation
 *   RollStepper    the ratio back-adjustment: a sum of roll jumps, newest first
 *   ShapeCard      the per-bar shape features at the last drawn bar
 *   MomentsCard    skewness and kurtosis under the chosen convention
 */

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, FormulaCard, GRID, OKABE, SegmentControl, SliderControl, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import { ZSCORE_CLIP, type DistributionSummary, type RollEvent, type StatisticsConvention, type WindowRow, type ZscoreExample } from "@shared/studies/market-series-explorer";
import { clock } from "./layout";

function num(value: number | null | undefined, digits = 6): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "unknown" : Number(value.toPrecision(digits)).toString();
}

// ---------------------------------------------------------------------------
// Causal z-score
// ---------------------------------------------------------------------------

const SOURCE_LABEL: Record<ZscoreExample["source"], string> = {
  log_return: "log return",
  log_range: "log range",
  log_volume: "log volume",
};

export function ZscoreStepper({ examples, column, onColumn, drawnZscore }: { examples: readonly ZscoreExample[]; column: string; onColumn: (column: string) => void; drawnZscore: Record<string, number | null> }) {
  const example = examples.find((item) => item.column === column) ?? examples[0];
  const [step, setStep] = useState(100);
  if (!example) return <p className="text-xs text-neutral-500">No bars drawn, so there is no window to step through.</p>;
  const values = example.windowValues;
  if (values.length === 0) {
    return <p className="text-xs text-neutral-400">The trailing window of {example.windowLength} is not full at the last drawn bar, so its z-score is unknown there (a warmup bar is never shown as a value).</p>;
  }
  const n = values.length;
  const i = Math.min(Math.max(step, 1), n);
  const mean = example.windowMean ?? 0;
  let runningSum = 0;
  let squares = 0;
  const data = values.map((value, index) => {
    runningSum += value;
    squares += (value - mean) ** 2;
    const counted = index + 1 <= i;
    return { index: index + 1, counted: counted ? value : null, pending: counted ? null : value, runningMean: runningSum / (index + 1), squares };
  });
  const sumAtStep = data[i - 1] ? data[i - 1]!.runningMean * i : 0;
  const squaresAtStep = data[i - 1]?.squares ?? 0;
  const raw = example.windowStandardDeviation && example.windowStandardDeviation > 0 && example.observation !== null ? (example.observation - mean) / example.windowStandardDeviation : null;
  const stored = drawnZscore[example.column] ?? null;

  return (
    <div className="space-y-2">
      <SegmentControl
        label="Which z-score"
        value={example.column}
        options={examples.map((item) => ({ value: item.column, label: SOURCE_LABEL[item.source] }))}
        onChange={(next) => onColumn(next)}
        hint="Return, range and volume each get their own causal z-score"
      />
      <FormulaCard
        tex={String.raw`z_t=\operatorname{clip}\!\left(\frac{x_t-\mu_t}{\sigma_t},\,-c,\,c\right),\quad \mu_t=\frac1n\sum_{i=1}^{n}x_{t-n+i},\quad \sigma_t=\sqrt{\frac1n\sum_{i=1}^{n}\bigl(x_{t-n+i}-\mu_t\bigr)^{2}}`}
        caption={`Read at the last drawn bar, ${clock(example.timestamp)}. Only bars at or before t enter: nothing looks ahead.`}
        symbols={[
          { tex: "z_t", name: `the ${SOURCE_LABEL[example.source]} z-score at bar t (standard deviations)`, value: num(example.zscore) },
          { tex: "x_t", name: `the ${SOURCE_LABEL[example.source]} of bar t`, value: num(example.observation) },
          { tex: String.raw`\mu_t`, name: "mean of the trailing window", value: num(example.windowMean) },
          { tex: String.raw`\sigma_t`, name: "population standard deviation of the window (divide by n)", value: num(example.windowStandardDeviation) },
          { tex: "n", name: "window length in bars", value: fmtInt(example.windowLength) },
          { tex: "i", name: "index of the window bar being added (1 = oldest)", value: `${i} of ${n}` },
          { tex: "c", name: "clip bound on the z-score", value: String(ZSCORE_CLIP) },
        ]}
      />
      <SliderControl label="Step i (terms of the sum counted)" value={i} min={1} max={n} onChange={setStep} format={(value) => `${value} of ${n}`} />
      <div className="grid gap-2 xl:grid-cols-[1fr_15rem]">
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={data} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="index" {...AXIS} interval={9} label={{ value: "window bar i (oldest first)", position: "insideBottom", offset: -2, fill: "#9a9a9a", fontSize: 10 }} height={32} />
            <YAxis {...AXIS} tickFormatter={(value: number) => num(value, 2)} width={56} />
            <Tooltip {...TOOLTIP} formatter={(value) => num(Number(value), 5)} labelFormatter={(label) => `bar i = ${label}`} />
            <Bar dataKey="counted" name="counted in the sum" fill={OKABE.orange} isAnimationActive={false} />
            <Bar dataKey="pending" name="not yet counted" fill="#6b6b6b" fillOpacity={0.45} isAnimationActive={false} />
            <Line dataKey="runningMean" name="running mean" stroke={OKABE.sky} strokeWidth={1.6} dot={false} isAnimationActive={false} strokeDasharray="5 3" />
            <ReferenceLine x={i} stroke={OKABE.blue} strokeWidth={1.5} label={{ value: `i = ${i}`, fill: OKABE.blue, fontSize: 10, position: "top" }} />
          </ComposedChart>
        </ResponsiveContainer>
        <dl className="space-y-1 self-start rounded-md border border-neutral-800 bg-neutral-900/40 p-2 text-[11px]">
          <div className="flex justify-between gap-2"><dt className="text-neutral-400">term x at i</dt><dd className="font-mono tnum text-neutral-100">{num(values[i - 1])}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-neutral-400">running total</dt><dd className="font-mono tnum text-neutral-100">{num(sumAtStep)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-neutral-400">running mean</dt><dd className="font-mono tnum text-neutral-100">{num(sumAtStep / i)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-neutral-400">squared deviations so far</dt><dd className="font-mono tnum text-neutral-100">{num(squaresAtStep)}</dd></div>
          <div className="mt-1 border-t border-neutral-800 pt-1" />
          <div className="flex justify-between gap-2"><dt className="text-neutral-400">after all n: mean</dt><dd className="font-mono tnum text-neutral-100">{num(example.windowMean)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-neutral-400">standard deviation</dt><dd className="font-mono tnum text-neutral-100">{num(example.windowStandardDeviation)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-neutral-400">unclipped z</dt><dd className="font-mono tnum text-neutral-100">{num(raw)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-neutral-400">clipped z</dt><dd className="font-mono tnum text-neutral-100">{num(example.zscore)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-neutral-400">column in the table</dt><dd className="font-mono tnum text-neutral-100">{num(stored)}</dd></div>
        </dl>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ratio back-adjustment
// ---------------------------------------------------------------------------

export function RollStepper({ rolls, cumulativeAdjustmentFactor }: { rolls: readonly RollEvent[]; cumulativeAdjustmentFactor: number }) {
  const known = rolls.filter((roll) => roll.logJump !== null);
  const [step, setStep] = useState(known.length);
  if (known.length === 0) {
    return <p className="text-xs text-neutral-400">This instrument has no contract rolls (a forex pair is one continuous quote stream), so the adjustment factor is 1 on every bar and nothing is adjusted.</p>;
  }
  const count = known.length;
  const counted = Math.min(Math.max(step, 0), count);
  // Newest roll first: bars older than the oldest counted roll carry exp(sum of the counted jumps).
  let total = 0;
  const data = known.map((roll, position) => {
    const newestFirst = count - position;
    const isCounted = newestFirst <= counted;
    const factorBefore = Math.exp(known.slice(position).reduce((sum, item) => sum + (item.logJump as number), 0));
    return {
      position,
      label: clock(roll.timestamp, false),
      counted: isCounted ? roll.logJump : null,
      pending: isCounted ? null : roll.logJump,
      factorBefore,
    };
  });
  for (const roll of known.slice(count - counted)) total += roll.logJump as number;
  const latestCounted = counted > 0 ? known[count - counted] : undefined;

  return (
    <div className="space-y-2">
      <FormulaCard
        tex={String.raw`a_t=\exp\!\Bigl(\sum_{s>t}\ln\frac{c^{\mathrm{new}}_s}{c^{\mathrm{old}}_s}\Bigr),\qquad \tilde c_t=a_t\,c_t`}
        caption="Bars are multiplied by the product of every later roll's price ratio, so the newest bar is untouched and history lines up behind it."
        symbols={[
          { tex: "a_t", name: "adjustment factor a bar older than the counted rolls carries", value: num(Math.exp(total), 8) },
          { tex: "s", name: "a roll day after bar t, counted newest first", value: latestCounted ? clock(latestCounted.timestamp, false) : "none counted" },
          { tex: String.raw`c^{\mathrm{new}}_s/c^{\mathrm{old}}_s`, name: "new contract's close over the old contract's, on roll day s", value: latestCounted ? num(latestCounted.priceRatio, 8) : "unknown" },
          { tex: String.raw`\ln(c^{\mathrm{new}}_s/c^{\mathrm{old}}_s)`, name: "the roll jump an unadjusted series would show (natural log)", value: latestCounted ? num(latestCounted.logJump, 6) : "unknown" },
          { tex: String.raw`\sum`, name: "running total of the counted jumps", value: `${num(total, 6)} over ${counted} of ${count} rolls` },
          { tex: String.raw`\tilde c_t`, name: "the roll-adjusted close; the level error an unadjusted oldest bar carries is a_t - 1", value: `${fmt((Math.exp(total) - 1) * 100, 2)} percent of level` },
        ]}
      />
      <SliderControl label="Step (rolls counted, newest first)" value={counted} min={0} max={count} onChange={setStep} format={(value) => `${value} of ${count}`} />
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 6, right: 40, left: 4, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" height={24} />
          <YAxis yAxisId="jump" {...AXIS} width={52} tickFormatter={(value: number) => num(value, 2)} />
          <YAxis yAxisId="factor" orientation="right" {...AXIS} width={44} domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => num(value, 4)} />
          <Tooltip {...TOOLTIP} formatter={(value, name) => [num(Number(value), 6), String(name)]} />
          <Bar yAxisId="jump" dataKey="counted" name="jump counted (log)" fill={OKABE.orange} isAnimationActive={false} />
          <Bar yAxisId="jump" dataKey="pending" name="jump not yet counted (log)" fill="#6b6b6b" fillOpacity={0.45} isAnimationActive={false} />
          <Line yAxisId="factor" dataKey="factorBefore" name="factor on bars before this roll" stroke={OKABE.sky} strokeWidth={1.6} dot={{ r: 2.5 }} isAnimationActive={false} type="stepAfter" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-neutral-400">
        With every roll counted the factor is <span className="font-mono text-neutral-200">{num(cumulativeAdjustmentFactor, 8)}</span>, the adjustment the oldest bar carries.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar shape features
// ---------------------------------------------------------------------------

export function ShapeCard({ row }: { row: WindowRow | undefined }) {
  if (!row) return null;
  const { open, high, low, close } = row;
  const range = high - low;
  const v = (name: string) => num(typeof row[name] === "number" ? (row[name] as number) : null, 5);
  return (
    <FormulaCard
      tex={String.raw`b=\frac{c-o}{h-l},\quad u=\frac{h-\max(o,c)}{h-l},\quad \ell=\frac{\min(o,c)-l}{h-l},\quad r_t=\ln\frac{c_t}{c_{t-1}}`}
      caption={`The scale-free shape of one bar, read at the last drawn bar (${clock(row.timestamp)}). Each divides by the bar's own range, so a 25,000-point index and a 1.1 currency pair look alike.`}
      symbols={[
        { tex: "o", name: "open (roll-adjusted, price points)", value: num(open, 8) },
        { tex: "h", name: "high (price points)", value: num(high, 8) },
        { tex: "l", name: "low (price points)", value: num(low, 8) },
        { tex: "c", name: "close (price points)", value: num(close, 8) },
        { tex: "h-l", name: "the bar's range (price points)", value: num(range, 8) },
        { tex: "b", name: "body_normalized: signed body as a share of the range", value: v("body_normalized") },
        { tex: "u", name: "upper_wick_normalized", value: v("upper_wick_normalized") },
        { tex: String.raw`\ell`, name: "lower_wick_normalized", value: v("lower_wick_normalized") },
        { tex: "r_t", name: "log_return: natural log of this close over the previous close", value: v("log_return") },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Skewness and kurtosis
// ---------------------------------------------------------------------------

export function MomentsCard({ convention, brushed, column }: { convention: StatisticsConvention; brushed: DistributionSummary | undefined; column: string }) {
  const tex = convention === "notebook"
    ? String.raw`g_1=\frac{m_3}{m_2^{3/2}},\quad g_2=\frac{m_4}{m_2^{2}}-3,\quad m_k=\frac1n\sum_{i=1}^{n}\bigl(x_i-\bar x\bigr)^{k},\quad s=\sqrt{\frac{1}{n-1}\sum_{i=1}^{n}\bigl(x_i-\bar x\bigr)^{2}}`
    : String.raw`G_1=\frac{\sqrt{n(n-1)}}{n-2}\,g_1,\quad G_2=\frac{n-1}{(n-2)(n-3)}\bigl((n+1)\,g_2+6\bigr),\quad g_k\text{ as in the notebook convention}`;
  return (
    <FormulaCard
      tex={tex}
      caption={convention === "notebook" ? "The notebook's (polars) conventions: no small-sample correction, quartiles by nearest rank." : "The dashboard's sample-adjusted conventions, quartiles interpolated linearly."}
      symbols={[
        { tex: "n", name: `known values of ${column} inside the brushed span`, value: fmtInt(brushed?.count ?? 0) },
        { tex: String.raw`\bar x`, name: "their mean", value: num(brushed?.mean) },
        { tex: "s", name: "sample standard deviation (divide by n - 1)", value: num(brushed?.standardDeviation) },
        { tex: convention === "notebook" ? "g_1" : "G_1", name: "skewness: positive means a longer right tail", value: num(brushed?.skewness) },
        { tex: convention === "notebook" ? "g_2" : "G_2", name: "excess kurtosis: fat tails relative to a normal distribution (0)", value: num(brushed?.kurtosis) },
      ]}
    />
  );
}
