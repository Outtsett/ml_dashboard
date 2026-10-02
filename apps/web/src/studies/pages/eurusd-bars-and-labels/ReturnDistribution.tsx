/**
 * Log return in basis points, development slice against the sealed fifth: the
 * notebook's `stats.describe_by` table with the four extra percentiles, and the
 * two distributions drawn on shared bins (as shares of each group, since a
 * fifth and four fifths are not comparable as counts).
 */

import { Area, AreaChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Empty, FormulaCard, GRID, OKABE, TOOLTIP, fmt, fmtInt, fmtPercent, type FormulaSymbol } from "@/studies/kit";
import type { ReturnStatistics, ReturnsBody } from "@shared/studies/eurusd-bars-and-labels";

const COLUMNS: Array<[string, (row: ReturnStatistics) => string]> = [
  ["count", (row) => fmtInt(row.count)],
  ["mean", (row) => fmt(row.mean, 4)],
  ["median", (row) => fmt(row.median, 4)],
  ["standard deviation", (row) => fmt(row.standardDeviation, 4)],
  ["skewness", (row) => fmt(row.skewness, 4)],
  ["excess kurtosis", (row) => fmt(row.excessKurtosis, 4)],
  ["25th percentile", (row) => fmt(row.percentile25, 4)],
  ["75th percentile", (row) => fmt(row.percentile75, 4)],
  ["minimum", (row) => fmt(row.minimum, 3)],
  ["maximum", (row) => fmt(row.maximum, 3)],
  ["dropped", (row) => fmtInt(row.droppedCount)],
  ["1st percentile", (row) => fmt(row.percentile1, 3)],
  ["5th percentile", (row) => fmt(row.percentile5, 3)],
  ["95th percentile", (row) => fmt(row.percentile95, 3)],
  ["99th percentile", (row) => fmt(row.percentile99, 3)],
];

const GROUP_LABEL = { development: "development (first 80%)", sealed: "sealed (last fifth)" } as const;
const GROUP_COLOR = { development: OKABE.blue, sealed: OKABE.orange } as const;
const GROUP_GLYPH = { development: "●", sealed: "◆" } as const;

export function ReturnStatisticsTable({ statistics }: { statistics: readonly ReturnStatistics[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-800">
      <table className="w-full min-w-[640px] text-[11px]">
        <thead className="bg-neutral-900/70 text-left text-neutral-400">
          <tr>
            <th className="px-2 py-1 font-medium">group</th>
            {COLUMNS.map(([name]) => (
              <th key={name} className="px-2 py-1 text-right font-medium">{name}</th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono tnum">
          {statistics.map((row) => (
            <tr key={row.group} className="border-t border-neutral-800">
              <td className="whitespace-nowrap px-2 py-1 font-sans text-neutral-200">
                <span style={{ color: GROUP_COLOR[row.group] }}>{GROUP_GLYPH[row.group]}</span> {GROUP_LABEL[row.group]}
              </td>
              {COLUMNS.map(([name, read]) => (
                <td key={name} className="px-2 py-1 text-right text-neutral-200">{read(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReturnHistogram({ body }: { body: ReturnsBody }) {
  if (body.histogram.length === 0) return <Empty>No returns to draw.</Empty>;
  const data = body.histogram.map((bin) => ({
    middle: (bin.lower + bin.upper) / 2,
    lower: bin.lower,
    upper: bin.upper,
    development: bin.developmentShare * 100,
    sealed: bin.sealedShare * 100,
    developmentCount: bin.developmentCount,
    sealedCount: bin.sealedCount,
  }));
  const below = body.belowRangeCount;
  const above = body.aboveRangeCount;
  return (
    <div className="space-y-1">
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 14 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="middle" type="number" domain={["dataMin", "dataMax"]} {...AXIS} tickFormatter={(value: number) => fmt(value, 1)} label={{ value: "log return (basis points)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
          <YAxis {...AXIS} tickFormatter={(value: number) => `${fmt(value, 1)}%`} />
          <ReferenceLine x={0} stroke={OKABE.grey} />
          <Tooltip
            {...TOOLTIP}
            content={({ payload }) => {
              const bin = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!bin) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{fmt(bin.lower, 2)} to {fmt(bin.upper, 2)} bp</div>
                  <div><span style={{ color: OKABE.blue }}>●</span> development {fmt(bin.development, 2)}% ({fmtInt(bin.developmentCount)} bars)</div>
                  <div><span style={{ color: OKABE.orange }}>◆</span> sealed {fmt(bin.sealed, 2)}% ({fmtInt(bin.sealedCount)} bars)</div>
                </div>
              );
            }}
          />
          <Legend formatter={(value: string) => (value === "development" ? "● development (first 80%)" : "◆ sealed (last fifth)")} wrapperStyle={{ fontSize: 11 }} />
          <Area type="stepAfter" dataKey="development" name="development" stroke={OKABE.blue} fill={OKABE.blue} fillOpacity={0.18} strokeWidth={1.6} isAnimationActive={false} />
          <Area type="stepAfter" dataKey="sealed" name="sealed" stroke={OKABE.orange} fill={OKABE.orange} fillOpacity={0.12} strokeWidth={1.6} strokeDasharray="5 3" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-neutral-500">
        Bins cover the 0.5th to 99.5th percentile of all returns ({fmt(body.histogramLower, 2)} to {fmt(body.histogramUpper, 2)} bp). Beyond it: below {fmtInt(below.development)} development and {fmtInt(below.sealed)} sealed returns, above {fmtInt(above.development)} and {fmtInt(above.sealed)}.
      </p>
    </div>
  );
}

/** One sentence comparing the two groups' spread and tails, from the landed numbers. */
export function returnComparison(statistics: readonly ReturnStatistics[]): string | null {
  const development = statistics.find((row) => row.group === "development");
  const sealed = statistics.find((row) => row.group === "sealed");
  if (!development || !sealed || development.standardDeviation === null || sealed.standardDeviation === null) return null;
  const ratio = sealed.standardDeviation / development.standardDeviation;
  const heavier = (sealed.excessKurtosis ?? 0) > (development.excessKurtosis ?? 0) ? "sealed" : "development";
  return `The sealed fifth's standard deviation is ${fmt(sealed.standardDeviation, 2)} bp against ${fmt(development.standardDeviation, 2)} bp in development (${fmtPercent(ratio - 1, 0)} ${ratio < 1 ? "narrower" : "wider"}); the ${heavier} slice has the fatter tails (excess kurtosis ${fmt(heavier === "sealed" ? sealed.excessKurtosis : development.excessKurtosis, 1)}, a Gaussian reads 0).`;
}

export function ReturnFormulas({ barCount, developmentBarCount, lastClose, previousClose, lastReturn }: { barCount: number; developmentBarCount: number; lastClose: number | null; previousClose: number | null; lastReturn: number | null }) {
  const returnSymbols: FormulaSymbol[] = [
    { tex: "r_t", name: "log return of bar t, in basis points", value: lastReturn === null ? "—" : `${fmt(lastReturn, 3)} bp` },
    { tex: "C_t", name: "close of bar t (the window's last bar)", value: lastClose === null ? "—" : lastClose.toFixed(5) },
    { tex: "C_{t-1}", name: "close of the bar before it", value: previousClose === null ? "—" : previousClose.toFixed(5) },
    { tex: "10^4", name: "basis points in one unit of log return", value: "10,000" },
  ];
  const splitSymbols: FormulaSymbol[] = [
    { tex: "n", name: "bars at this timeframe", value: fmtInt(barCount) },
    { tex: "m", name: "development bars, the first 80% in time", value: fmtInt(developmentBarCount) },
    { tex: "j", name: "index of a return (return j is the step into bar j + 1, counting from 0)", value: "0 … n − 2" },
    { tex: "0.8", name: "development fraction of the chronological split", value: "80%" },
  ];
  return (
    <div className="grid gap-2 xl:grid-cols-2">
      <FormulaCard
        tex="r_t = 10^{4}\,\bigl(\ln C_t - \ln C_{t-1}\bigr)"
        symbols={returnSymbols}
        caption="The return the lower panel of the chart draws and the two groups below are described on. The window's first bar has no return, so it draws as 0, as in the notebook."
      />
      <FormulaCard
        tex="m = \lfloor 0.8\,n \rfloor, \qquad \text{return } j \text{ is development} \iff j < m"
        symbols={splitSymbols}
        caption="The chronological 80/20 cut (forexmodel split.dev_oos_split). The last fifth is sealed: it is described here and never tuned against."
      />
    </div>
  );
}
