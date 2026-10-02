/**
 * The backtest under both accountings: the scorecard, one metric compared
 * across every row as bars, the cumulative return curves and the drawdown
 * beneath them. Above zero is orange, below zero is blue; each curve also has
 * its own dash pattern, so no line is told apart by colour alone.
 */

import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS, Empty, GRID, OKABE, TOOLTIP, fmt, fmtInt, fmtPercent, fmtTime, fmtUsd, toneOf } from "@/studies/kit";
import type { BacktestResult, EquityPoint, MetricsRow, RollRow } from "@shared/studies/slope-signal-backtest";
import { fmtSigned, fmtTick, indexAtOrAfter, logToUnit } from "./format";

type NumericMetric = Exclude<keyof MetricsRow, "label">;

export const METRICS: ReadonlyArray<{ key: NumericMetric; label: string; decimals: number; suffix: string }> = [
  { key: "totalReturnPercent", label: "total return", decimals: 2, suffix: "%" },
  { key: "totalReturnLog", label: "total return, log units", decimals: 4, suffix: "" },
  { key: "annualReturnPercent", label: "return per year", decimals: 2, suffix: "%" },
  { key: "annualVolatilityPercent", label: "volatility per year", decimals: 2, suffix: "%" },
  { key: "sharpeRatio", label: "Sharpe ratio (return per year over volatility per year)", decimals: 3, suffix: "" },
  { key: "maxDrawdownPercent", label: "largest drawdown", decimals: 2, suffix: "%" },
  { key: "maxDrawdownLog", label: "largest drawdown, log units", decimals: 4, suffix: "" },
  { key: "winRatePercent", label: "bars won, of bars with a non-zero return", decimals: 1, suffix: "%" },
  { key: "trades", label: "position changes", decimals: 0, suffix: "" },
  { key: "barCount", label: "bars in the backtest", decimals: 0, suffix: "" },
];

const ACCOUNTING_NAME: Record<string, string> = { corrected: "corrected accounting", notebook: "notebook accounting" };

function cell(row: MetricsRow, key: NumericMetric, decimals: number, suffix: string): string {
  const value = row[key];
  if (value === null) return "—";
  if (decimals === 0) return fmtInt(value);
  return `${fmt(value, decimals)}${suffix}`;
}

function Scorecard({ results }: { results: readonly BacktestResult[] }) {
  const columns = results.flatMap((result) => result.metrics.map((row) => ({ accounting: result.name, row })));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono tnum">
        <thead>
          <tr className="text-neutral-500">
            <th className="py-0.5 text-left font-normal">metric</th>
            {columns.map((column) => (
              <th key={`${column.accounting}-${column.row.label}`} className="py-0.5 pl-3 text-right font-normal">
                <div className="text-neutral-300">{column.row.label}</div>
                <div>{ACCOUNTING_NAME[column.accounting]}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((metric) => (
            <tr key={metric.key} className="border-t border-neutral-900">
              <td className="py-0.5 text-neutral-400">{metric.label}</td>
              {columns.map((column) => {
                const value = column.row[metric.key];
                const signed = metric.key !== "trades" && metric.key !== "barCount" && metric.key !== "annualVolatilityPercent" && metric.key !== "winRatePercent";
                return (
                  <td key={`${column.accounting}-${column.row.label}`} className="py-0.5 pl-3 text-right" style={{ color: signed && value !== null ? toneOf(value) : "#e5e5e5" }}>
                    {cell(column.row, metric.key, metric.decimals, metric.suffix)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CostTable({ results, pointValueUsd }: { results: readonly BacktestResult[]; pointValueUsd: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono tnum">
        <thead>
          <tr className="text-neutral-500">
            <th className="py-0.5 text-left font-normal">what the trading cost</th>
            {results.map((result) => (
              <th key={result.name} className="py-0.5 pl-3 text-right font-normal">{ACCOUNTING_NAME[result.name]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-neutral-900">
            <td className="py-0.5 text-neutral-400">round-trip cost charged (points)</td>
            {results.map((result) => <td key={result.name} className="py-0.5 pl-3 text-right text-neutral-200">{fmt(result.costPoints, 2)}</td>)}
          </tr>
          <tr className="border-t border-neutral-900">
            <td className="py-0.5 text-neutral-400">how it is charged</td>
            {results.map((result) => <td key={result.name} className="py-0.5 pl-3 text-right font-sans text-neutral-300">{result.costBasis}</td>)}
          </tr>
          <tr className="border-t border-neutral-900">
            <td className="py-0.5 text-neutral-400">position changes</td>
            {results.map((result) => <td key={result.name} className="py-0.5 pl-3 text-right text-neutral-200">{fmtInt(result.positionChanges)}</td>)}
          </tr>
          <tr className="border-t border-neutral-900">
            <td className="py-0.5 text-neutral-400">contract sides traded (a flip is two)</td>
            {results.map((result) => <td key={result.name} className="py-0.5 pl-3 text-right text-neutral-200">{result.sides === null ? "not counted" : fmtInt(result.sides)}</td>)}
          </tr>
          <tr className="border-t border-neutral-900">
            <td className="py-0.5 text-neutral-400">share of bars holding a position</td>
            {results.map((result) => <td key={result.name} className="py-0.5 pl-3 text-right text-neutral-200">{fmtPercent(result.exposure)}</td>)}
          </tr>
          <tr className="border-t border-neutral-900">
            <td className="py-0.5 text-neutral-400">total cost (points)</td>
            {results.map((result) => <td key={result.name} className="py-0.5 pl-3 text-right text-neutral-200">{fmt(result.totalCostPoints, 1)}</td>)}
          </tr>
          <tr className="border-t border-neutral-900">
            <td className="py-0.5 text-neutral-400">total cost (United States dollars, one contract at {fmtUsd(pointValueUsd)} a point)</td>
            {results.map((result) => <td key={result.name} className="py-0.5 pl-3 text-right text-neutral-200">{fmtUsd(result.totalCostUsd)}</td>)}
          </tr>
          <tr className="border-t border-neutral-900">
            <td className="py-0.5 text-neutral-400">bars per year used to annualise</td>
            {results.map((result) => <td key={result.name} className="py-0.5 pl-3 text-right text-neutral-200">{fmtInt(result.barsPerYear)}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function MetricBars({ results, metricKey }: { results: readonly BacktestResult[]; metricKey: string }) {
  const metric = METRICS.find((entry) => entry.key === metricKey) ?? METRICS[0]!;
  const data = results.flatMap((result) =>
    result.metrics.map((row) => ({
      name: `${row.label}, ${ACCOUNTING_NAME[result.name]}`,
      value: row[metric.key] ?? 0,
      shown: cell(row, metric.key, metric.decimals, metric.suffix),
    })),
  );
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium text-neutral-100">
        {metric.label}{metric.suffix === "%" ? " (percent)" : ""}: every row side by side <span className="font-normal text-neutral-400">(orange bars sit above zero, blue below)</span>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 30 + 30)}>
        <BarChart data={data} layout="vertical" margin={{ top: 2, right: 70, left: 4, bottom: 2 }}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" tickFormatter={(value: number) => fmt(value, metric.decimals === 0 ? 0 : 1)} {...AXIS} />
          <YAxis type="category" dataKey="name" width={250} {...AXIS} />
          <Tooltip {...TOOLTIP} formatter={(_value, _name, item) => [(item.payload as { shown: string }).shown, metric.label]} />
          <ReferenceLine x={0} stroke="#737373" />
          <Bar dataKey="value" isAnimationActive={false}>
            {data.map((row) => <Cell key={row.name} fill={toneOf(row.value)} />)}
            <LabelList dataKey="shown" position="right" fontSize={10} fill="#d4d4d4" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface CurvePoint {
  index: number;
  t: number;
  strategyNet: number;
  strategyGross: number;
  buyAndHold: number;
  notebookNet: number;
  drawdown: number;
  notebookDrawdown: number;
}

const CURVES = [
  { key: "strategyNet", label: "slope strategy after cost, corrected accounting", color: OKABE.orange, dash: undefined, accounting: "corrected" },
  { key: "strategyGross", label: "slope strategy before cost", color: OKABE.yellow, dash: "7 3", accounting: "corrected" },
  { key: "notebookNet", label: "slope strategy after cost, notebook accounting", color: OKABE.purple, dash: "2 3", accounting: "notebook" },
  { key: "buyAndHold", label: "buy and hold (back-adjusted prices when that control is on)", color: "#d4d4d4", dash: "12 3 2 3", accounting: "always" },
] as const;

function Curves({ equity, rolls, accounting, unit }: { equity: readonly EquityPoint[]; rolls: readonly RollRow[]; accounting: string; unit: string }) {
  if (equity.length === 0) return <Empty>Too few bars for a backtest.</Empty>;
  const data: CurvePoint[] = equity.map((point, index) => ({
    index,
    t: point.t,
    strategyNet: logToUnit(point.strategyNet, unit),
    strategyGross: logToUnit(point.strategyGross, unit),
    buyAndHold: logToUnit(point.buyAndHold, unit),
    notebookNet: logToUnit(point.notebookNet, unit),
    drawdown: logToUnit(point.drawdown, unit),
    notebookDrawdown: logToUnit(point.notebookDrawdown, unit),
  }));
  const last = data.length - 1;
  const shown = CURVES.filter((curve) => curve.accounting === "always" || accounting === "both" || curve.accounting === accounting);
  const unitLabel = unit === "percent" ? "percent" : "log units";
  const decimals = unit === "percent" ? 2 : 4;
  const tickOf = (index: number) => fmtTick(data[Math.min(Math.max(0, Math.round(index)), last)]?.t);
  const labelOf = (index: unknown) => {
    const point = data[Math.min(Math.max(0, Math.round(Number(index))), last)];
    return point ? `${fmtTime(point.t)} (Pacific wall clock as stamped)` : "";
  };
  const rollMarks = rolls.map((roll) => ({ roll, index: indexAtOrAfter(equity, roll.timestamp) })).filter((mark) => mark.index >= 0);
  const showCorrected = accounting !== "notebook";
  const showNotebook = accounting !== "corrected";

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-300">
        <span className="font-medium text-neutral-100">Cumulative return ({unitLabel})</span>
        {shown.map((curve) => (
          <span key={curve.key} className="flex items-center gap-1">
            <svg width="30" height="8" aria-hidden="true"><line x1="0" x2="30" y1="4" y2="4" stroke={curve.color} strokeWidth="2" strokeDasharray={curve.dash} /></svg>
            {curve.label}
          </span>
        ))}
        {rollMarks.length > 0 && (
          <span className="flex items-center gap-1"><svg width="8" height="12" aria-hidden="true"><line x1="4" x2="4" y1="0" y2="12" stroke={OKABE.sky} strokeWidth="1.5" strokeDasharray="3 2" /></svg>contract roll</span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} syncId="slope-backtest" margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="index" type="number" domain={[0, last]} tickFormatter={tickOf} tickCount={7} {...AXIS} />
          <YAxis domain={["auto", "auto"]} width={62} tickFormatter={(value: number) => fmt(value, unit === "percent" ? 1 : 3)} {...AXIS} label={{ value: `cumulative return, ${unitLabel}`, angle: -90, position: "insideLeft", fontSize: 10, fill: "#a3a3a3" }} />
          <Tooltip
            {...TOOLTIP}
            labelFormatter={labelOf}
            formatter={(value, name) => [fmtSigned(typeof value === "number" ? value : null, decimals, unit === "percent" ? "%" : ""), CURVES.find((curve) => curve.key === name)?.label ?? String(name)]}
          />
          <ReferenceLine y={0} stroke="#737373" />
          {rollMarks.map((mark) => (
            <ReferenceLine key={mark.roll.timestamp} x={mark.index} stroke={OKABE.sky} strokeDasharray="3 2" label={{ value: `${mark.roll.fromContract} to ${mark.roll.toContract}`, position: "insideTopRight", fontSize: 9, fill: OKABE.sky }} />
          ))}
          {shown.map((curve) => (
            <Line key={curve.key} dataKey={curve.key} name={curve.key} stroke={curve.color} strokeWidth={curve.key === "strategyNet" ? 2 : 1.5} strokeDasharray={curve.dash} dot={false} isAnimationActive={false} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-neutral-300">
        <span className="font-medium text-neutral-100">Drawdown of the after-cost curve ({unitLabel}): how far below its own earlier peak</span>
        {showCorrected && <span style={{ color: OKABE.blue }}>■ ▼ corrected accounting</span>}
        {showNotebook && (
          <span className="flex items-center gap-1"><svg width="30" height="8" aria-hidden="true"><line x1="0" x2="30" y1="4" y2="4" stroke={OKABE.purple} strokeWidth="2" strokeDasharray="2 3" /></svg>notebook accounting</span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={data} syncId="slope-backtest" margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="index" type="number" domain={[0, last]} tickFormatter={tickOf} tickCount={7} {...AXIS} label={{ value: "bar time, Pacific wall clock as stamped", position: "insideBottomRight", offset: -2, fontSize: 10, fill: "#a3a3a3" }} />
          <YAxis domain={["auto", 0]} width={62} tickFormatter={(value: number) => fmt(value, unit === "percent" ? 1 : 3)} {...AXIS} label={{ value: `drawdown, ${unitLabel}`, angle: -90, position: "insideLeft", fontSize: 10, fill: "#a3a3a3" }} />
          <Tooltip
            {...TOOLTIP}
            labelFormatter={labelOf}
            formatter={(value, name) => [fmtSigned(typeof value === "number" ? value : null, decimals, unit === "percent" ? "%" : ""), name === "drawdown" ? "drawdown, corrected accounting" : "drawdown, notebook accounting"]}
          />
          {showCorrected && <Area dataKey="drawdown" name="drawdown" type="linear" stroke={OKABE.blue} strokeWidth={1} fill={OKABE.blue} fillOpacity={0.45} isAnimationActive={false} />}
          {showNotebook && <Line dataKey="notebookDrawdown" name="notebookDrawdown" stroke={OKABE.purple} strokeWidth={1.5} strokeDasharray="2 3" dot={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Backtest({
  corrected, notebook, equity, rolls, accounting, unit, metricKey, pointValueUsd,
}: {
  corrected: BacktestResult | null;
  notebook: BacktestResult | null;
  equity: readonly EquityPoint[];
  rolls: readonly RollRow[];
  accounting: string;
  unit: string;
  metricKey: string;
  pointValueUsd: number;
}) {
  const results: BacktestResult[] = [];
  if (corrected && accounting !== "notebook") results.push(corrected);
  if (notebook && accounting !== "corrected") results.push(notebook);
  if (results.length === 0) return <Empty>Too few bars for a backtest: the window needs at least two bars past the slope's warm-up.</Empty>;

  return (
    <div className="space-y-4">
      {results.map((result) => (
        <p key={result.name} className="text-[11px] text-neutral-400">
          <span className="font-medium text-neutral-200">{ACCOUNTING_NAME[result.name]}:</span> {result.description}
        </p>
      ))}
      <Scorecard results={results} />
      <MetricBars results={results} metricKey={metricKey} />
      <Curves equity={equity} rolls={rolls} accounting={accounting} unit={unit} />
      <CostTable results={results} pointValueUsd={pointValueUsd} />
    </div>
  );
}
