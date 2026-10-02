/**
 * The two shape numbers of the eight-number summary, operated: skewness G1 and
 * excess kurtosis G2 are sums of powers of each observation's z-score. Pick a
 * column of the raw table, step the index i, and watch term i join the running
 * sum; every symbol carries the value it holds right now.
 */

import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { kurtosisFromScores, skewnessFromScores, zScoreWalk } from "@shared/studies/data-lifecycle-audit";
import { AXIS, ControlBar, FormulaCard, GRID, OKABE, SelectControl, SliderControl, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import { compact } from "./style";

export function SkewnessWalk({ columnName, columnNames, values, step, onColumn, onStep }: {
  columnName: string;
  columnNames: readonly string[];
  /** The selected column's values, in row order. */
  values: readonly number[];
  step: number;
  onColumn: (name: string) => void;
  onStep: (step: number) => void;
}) {
  if (columnNames.length === 0) {
    return <p className="text-xs text-neutral-500">This raw table has no numeric column, so there are no shape numbers to walk through.</p>;
  }
  const finite = values.filter((value) => Number.isFinite(value));
  const walk = zScoreWalk(finite);
  const count = walk?.count ?? 0;
  const index = Math.min(Math.max(1, step), Math.max(1, count));
  const cubes = walk ? walk.scores.map((z) => z ** 3) : [];
  const fourths = walk ? walk.scores.map((z) => z ** 4) : [];
  const runningCube = cubes.slice(0, index).reduce((total, term) => total + term, 0);
  const runningFourth = fourths.slice(0, index).reduce((total, term) => total + term, 0);
  const fullCube = cubes.reduce((total, term) => total + term, 0);
  const fullFourth = fourths.reduce((total, term) => total + term, 0);
  const skewness = walk ? skewnessFromScores(walk) : null;
  const kurtosis = walk ? kurtosisFromScores(walk) : null;
  const current = walk ? { x: finite[index - 1] as number, z: walk.scores[index - 1] as number } : null;

  const chartData = (terms: number[]) => {
    let total = 0;
    return terms.map((term, position) => {
      total += term;
      return { i: position + 1, term, running: total, included: position < index };
    });
  };
  const cubeData = chartData(cubes);
  const fourthData = chartData(fourths);

  const common = (power: 3 | 4) => [
    { tex: "n", name: "number of observations (rows with a value)", value: fmtInt(count) },
    { tex: "i", name: "the observation being added to the sum", value: `${fmtInt(index)}` },
    { tex: "x_i", name: `value of ${columnName.replace(/_/g, " ")} in row i`, value: compact(current?.x) },
    { tex: "\\bar{x}", name: "mean of the column", value: compact(walk?.mean) },
    { tex: "s", name: "sample standard deviation of the column", value: compact(walk?.standardDeviation) },
    { tex: "z_i", name: "how many standard deviations row i sits from the mean", value: fmt(current?.z, 4) },
    { tex: `z_i^{${power}}`, name: `term ${index} of the sum`, value: fmt(current ? current.z ** power : null, 4) },
  ];

  return (
    <div className="min-w-0 space-y-3">
      <ControlBar>
        <SelectControl label="Raw column" value={columnName} options={columnNames.map((name) => ({ value: name, label: name }))} onChange={onColumn} />
        <SliderControl label="Index i" value={index} min={1} max={Math.max(1, count)} onChange={onStep} hint="Step through the observations in row order" />
      </ControlBar>
      {walk === null ? (
        <p className="text-xs text-neutral-500">Fewer than two values in this column, so its z-scores are undefined.</p>
      ) : (
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <FormulaCard
              tex={"G_1=\\frac{n}{(n-1)(n-2)}\\sum_{i=1}^{n} z_i^{3},\\qquad z_i=\\frac{x_i-\\bar{x}}{s}"}
              caption={`Skewness: which tail is longer. Through row ${fmtInt(index)} the running sum is ${fmt(runningCube, 4)} of ${fmt(fullCube, 4)}.`}
              symbols={[
                { tex: "G_1", name: "skewness (sample-adjusted); positive means a longer right tail", value: fmt(skewness, 4) },
                ...common(3),
                { tex: "\\textstyle\\sum_{j\\le i} z_j^{3}", name: "running sum through row i", value: fmt(runningCube, 4) },
                { tex: "\\textstyle\\sum_{i=1}^{n} z_i^{3}", name: "the whole sum", value: fmt(fullCube, 4) },
              ]}
            />
            <TermChart data={cubeData} index={index} label="z³ of each row" />
          </div>
          <div className="min-w-0 space-y-2">
            <FormulaCard
              tex={"G_2=\\frac{n(n+1)}{(n-1)(n-2)(n-3)}\\sum_{i=1}^{n} z_i^{4}-\\frac{3(n-1)^2}{(n-2)(n-3)}"}
              caption={`Excess kurtosis: how heavy the tails are against a normal curve (0). Through row ${fmtInt(index)} the running sum is ${fmt(runningFourth, 4)} of ${fmt(fullFourth, 4)}.`}
              symbols={[
                { tex: "G_2", name: "excess kurtosis (sample-adjusted); positive means fatter tails than a normal curve", value: fmt(kurtosis, 4) },
                ...common(4),
                { tex: "\\textstyle\\sum_{j\\le i} z_j^{4}", name: "running sum through row i", value: fmt(runningFourth, 4) },
                { tex: "\\textstyle\\sum_{i=1}^{n} z_i^{4}", name: "the whole sum", value: fmt(fullFourth, 4) },
              ]}
            />
            <TermChart data={fourthData} index={index} label="z⁴ of each row" />
          </div>
        </div>
      )}
    </div>
  );
}

function TermChart({ data, index, label }: { data: Array<{ i: number; term: number; running: number; included: boolean }>; index: number; label: string }) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="i" type="number" domain={[1, "dataMax"]} {...AXIS} height={18} />
          <YAxis yAxisId="term" {...AXIS} width={36} tickFormatter={(value: number) => compact(value)} />
          <YAxis yAxisId="running" orientation="right" {...AXIS} width={40} tickFormatter={(value: number) => compact(value)} />
          <Tooltip {...TOOLTIP} formatter={(value, name) => [fmt(Number(value), 4), String(name)]} labelFormatter={(value) => `row i = ${value}`} />
          <ReferenceLine yAxisId="term" x={index} stroke={OKABE.purple} strokeWidth={1.5} />
          <Bar yAxisId="term" dataKey="term" name={label} isAnimationActive={false}>
            {data.map((row) => (
              <Cell key={row.i} fill={row.included ? OKABE.orange : "#525252"} />
            ))}
          </Bar>
          <Line yAxisId="running" dataKey="running" name="running sum" stroke={OKABE.blue} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-neutral-500">
        <span style={{ color: OKABE.orange }}>■ terms already added (rows 1 to {index})</span> · <span className="text-neutral-400">■ terms still to come</span> ·{" "}
        <span style={{ color: OKABE.blue }}>— running sum (right axis)</span>
      </p>
    </div>
  );
}
