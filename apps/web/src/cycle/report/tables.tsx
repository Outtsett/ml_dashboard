/**
 * The tables of the Model Cycle Metrics tab. Every table renders rows exactly as
 * the server sends them (packages/shared/src/cycle/report.ts); a metric's meaning,
 * formula, sample and — when it is undefined — the reason, sit in the cell's
 * tooltip. Okabe-Ito only: orange / sky for gain / loss, never red / green, and
 * every colour is doubled by a sign, a glyph or a label.
 */
import { Fragment } from "react";

import type {
  ReportCalibrationBin,
  ReportConfusionCell,
  ReportDailyRow,
  ReportDistributionRow,
  ReportDrawdownRow,
  ReportMetricRow,
} from "@shared/cycle/report";
import { formatCount, formatPercent, formatTime, formatUsd, formatUsdMagnitude, UNDEFINED_METRIC_TEXT } from "@/cycle/format";
import { cn } from "@/shared/utils/utils";

import { BETTER_GLYPH, FAMILY_TITLES, foldLabel, formatReportValue, metricTooltip, profitTone } from "./format";

const ORANGE = "#E69F00";
const SKY = "#56B4E9";

const CELL = "whitespace-nowrap px-2 py-1 text-right font-mono text-[11px] tabular-nums";
const HEAD = "sticky top-0 z-10 whitespace-nowrap bg-card/95 px-2 py-1 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

export type Scope = { scope: "run" | "fold"; foldIndex: number | null };

function sameScope(row: { scope: string; foldIndex: number | null }, scope: Scope): boolean {
  return row.scope === scope.scope && row.foldIndex === scope.foldIndex;
}

function MetricValue({ row }: { row: ReportMetricRow | undefined }) {
  if (!row) return <span className="text-muted-foreground">{UNDEFINED_METRIC_TEXT}</span>;
  const tone = profitTone(row);
  return (
    <span
      title={metricTooltip(row)}
      className={cn(row.value === null && "text-muted-foreground", tone === "up" && "text-(--color-data-pos)", tone === "down" && "text-(--color-data-neg)")}
    >
      {formatReportValue(row.unit, row.value, row.better)}
    </span>
  );
}

/** Metrics down the side, the run and every fold across: one family per block. */
export function MetricMatrix({ rows, testId }: { rows: ReportMetricRow[]; testId: string }) {
  const overall = rows.filter((row) => row.segmentKind === "all");
  const folds = [...new Set(overall.filter((row) => row.scope === "fold").map((row) => row.foldIndex as number))].sort((a, b) => a - b);
  const columns: Scope[] = [{ scope: "run", foldIndex: null }, ...folds.map((foldIndex) => ({ scope: "fold" as const, foldIndex }))];
  const byKey = new Map(overall.map((row) => [`${row.name}|${row.scope}|${row.foldIndex}`, row]));
  const names: ReportMetricRow[] = [];
  const seen = new Set<string>();
  for (const row of [...overall].sort((a, b) => a.order - b.order)) {
    if (!seen.has(row.name)) {
      seen.add(row.name);
      names.push(row);
    }
  }
  const families: Array<{ family: string; rows: ReportMetricRow[] }> = [];
  for (const row of names) {
    const last = families[families.length - 1];
    if (last && last.family === row.family) last.rows.push(row);
    else families.push({ family: row.family, rows: [row] });
  }
  return (
    <div className="overflow-x-auto" data-testid={testId}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={cn(HEAD, "text-left")}>Metric</th>
            {columns.map((column) => (
              <th key={foldLabel(column.foldIndex)} className={HEAD}>{foldLabel(column.foldIndex)}</th>
            ))}
            <th className={HEAD} title="How many bars, trades or forecasts the run's value rests on">Sample</th>
          </tr>
        </thead>
        <tbody>
          {families.map(({ family, rows: familyRows }) => (
            <Fragment key={family}>
              <tr>
                <td colSpan={columns.length + 2} data-testid={`${testId}-family-${family}`} className="bg-white/[0.03] px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-300">
                  {FAMILY_TITLES[family] ?? family}
                </td>
              </tr>
              {familyRows.map((named) => {
                const run = byKey.get(`${named.name}|run|null`);
                return (
                  <tr key={named.name} className="border-b border-white/5" data-testid={`${testId}-row-${named.name}`}>
                    <td className="px-2 py-1 text-left text-[11px] text-neutral-200" title={metricTooltip(named)}>
                      {named.label}
                      {BETTER_GLYPH[named.better] && (
                        <span className="ml-1 text-[9px] text-muted-foreground" aria-label={named.better.replace(/_/g, " ") + " is better"}>
                          {BETTER_GLYPH[named.better]}
                        </span>
                      )}
                    </td>
                    {columns.map((column) => (
                      <td key={foldLabel(column.foldIndex)} className={CELL} data-testid={`${testId}-${named.name}-${column.foldIndex ?? "run"}`}>
                        <MetricValue row={byKey.get(`${named.name}|${column.scope}|${column.foldIndex}`)} />
                      </td>
                    ))}
                    <td className={cn(CELL, "text-muted-foreground")}>{run?.sampleCount === null || run === undefined ? "" : formatCount(run.sampleCount)}</td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One scope's rows of one segment kind: segments down the side, the named metrics across. */
export function SegmentTable({ rows, scope, kind, names, testId }: {
  rows: ReportMetricRow[]; scope: Scope; kind: string; names: readonly string[]; testId: string;
}) {
  const selected = rows.filter((row) => row.segmentKind === kind && sameScope(row, scope));
  const segments = [...new Set(selected.map((row) => row.segmentValue))];
  const byKey = new Map(selected.map((row) => [`${row.segmentValue}|${row.name}`, row]));
  const headers = names.map((name) => selected.find((row) => row.name === name)).filter((row): row is ReportMetricRow => row !== undefined);
  if (!segments.length) return <p className="px-2 py-2 text-[11px] text-muted-foreground">No rows for this scope.</p>;
  return (
    <div className="overflow-x-auto" data-testid={testId}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={cn(HEAD, "text-left")}>Segment</th>
            {headers.map((row) => (
              <th key={row.name} className={HEAD} title={metricTooltip(row)}>{row.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {segments.map((segment) => (
            <tr key={segment} className="border-b border-white/5">
              <td className="px-2 py-1 text-left text-[11px] text-neutral-200">{segment}</td>
              {headers.map((header) => (
                <td key={header.name} className={CELL} data-testid={`${testId}-${segment}-${header.name}`}>
                  <MetricValue row={byKey.get(`${segment}|${header.name}`)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ConfusionTable({ cells, scope }: { cells: ReportConfusionCell[]; scope: Scope }) {
  const selected = cells.filter((cell) => sameScope(cell, scope));
  const find = (actual: string, predicted: string) => selected.find((cell) => cell.actualDirection === actual && cell.predictedDirection === predicted);
  return (
    <table className="border-collapse" data-testid="report-confusion">
      <thead>
        <tr>
          <th className={cn(HEAD, "text-left")}>Actual \ called</th>
          <th className={HEAD}>Called up ▲</th>
          <th className={HEAD}>Called down ▼</th>
        </tr>
      </thead>
      <tbody>
        {(["up", "down"] as const).map((actual) => (
          <tr key={actual} className="border-b border-white/5">
            <td className="px-2 py-1 text-left text-[11px] text-neutral-200">Went {actual} {actual === "up" ? "▲" : "▼"}</td>
            {(["up", "down"] as const).map((predicted) => {
              const cell = find(actual, predicted);
              const right = actual === predicted;
              return (
                <td key={predicted} className={cn(CELL, right ? "font-semibold text-neutral-100" : "text-neutral-400")}
                  title={right ? "Called correctly" : "Called wrongly"} data-testid={`report-confusion-${actual}-${predicted}`}>
                  {cell ? `${formatCount(cell.barCount)} (${formatPercent(cell.shareOfScoredBars)})` : UNDEFINED_METRIC_TEXT}
                  <span className="ml-1 text-[9px] text-muted-foreground">{right ? "✓" : "✗"}</span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Forecast versus observed per probability bin, with both drawn on one 0..1 line. */
export function CalibrationTable({ bins, scope }: { bins: ReportCalibrationBin[]; scope: Scope }) {
  const selected = bins.filter((bin) => sameScope(bin, scope));
  return (
    <div className="overflow-x-auto" data-testid="report-calibration">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={cn(HEAD, "text-left")}>P(up) bin</th>
            <th className={HEAD}>Bars</th>
            <th className={HEAD}>Mean P(up)</th>
            <th className={HEAD}>Went up</th>
            <th className={HEAD}>Gap</th>
            <th className={cn(HEAD, "text-left")}>
              <span style={{ color: SKY }}>│ forecast</span> <span style={{ color: ORANGE }}>● observed</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {selected.map((bin) => (
            <tr key={bin.binNumber} className="border-b border-white/5">
              <td className="px-2 py-1 text-left font-mono text-[11px] text-neutral-200">{bin.probabilityLower.toFixed(1)}–{bin.probabilityUpper.toFixed(1)}</td>
              <td className={CELL}>{formatCount(bin.scoredBarCount)}</td>
              <td className={CELL}>{bin.meanProbabilityUp === null ? UNDEFINED_METRIC_TEXT : bin.meanProbabilityUp.toFixed(3)}</td>
              <td className={CELL}>{formatPercent(bin.observedUpFraction)}</td>
              <td className={CELL}>{bin.calibrationGap === null ? UNDEFINED_METRIC_TEXT : `${bin.calibrationGap > 0 ? "+" : ""}${(bin.calibrationGap * 100).toFixed(1)} pts`}</td>
              <td className="px-2 py-1">
                {bin.scoredBarCount > 0 && bin.meanProbabilityUp !== null && bin.observedUpFraction !== null && (
                  <svg width="120" height="12" role="img" aria-label={`forecast ${bin.meanProbabilityUp.toFixed(2)}, observed ${bin.observedUpFraction.toFixed(2)}`}>
                    <line x1="0" x2="120" y1="6" y2="6" stroke="rgba(255,255,255,0.15)" />
                    <line x1={bin.meanProbabilityUp * 120} x2={bin.meanProbabilityUp * 120} y1="1" y2="11" stroke={SKY} strokeWidth="2" />
                    <circle cx={bin.observedUpFraction * 120} cy="6" r="3" fill={ORANGE} />
                  </svg>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// quantities whose every value is a size (how deep, how much): shown unsigned
const SIZE_QUANTITIES = new Set(["drawdown_depth_usd"]);

/** One number of a distribution row; a spread or a size is unsigned, a profit keeps its sign. */
function formatQuantity(unit: ReportDistributionRow["unit"], value: number | null, size = false): string {
  if (value === null) return UNDEFINED_METRIC_TEXT;
  if (unit === "usd") return size ? formatUsdMagnitude(value) : formatUsd(value);
  if (unit === "probability") return value.toFixed(3);
  if (unit === "points") return value.toFixed(2);
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
}

/** A row's spread drawn on its own scale: whisker minimum..maximum, box 25th..75th, median tick. */
function BoxPlot({ row }: { row: ReportDistributionRow }) {
  const { minimum, maximum, percentile25, percentile75, median } = row;
  if (minimum === null || maximum === null || percentile25 === null || percentile75 === null || median === null || maximum <= minimum) return null;
  const x = (value: number) => ((value - minimum) / (maximum - minimum)) * 116 + 2;
  const zero = minimum < 0 && maximum > 0 ? x(0) : null;
  return (
    <svg width="120" height="14" role="img" aria-label={`from ${minimum} to ${maximum}, middle half ${percentile25} to ${percentile75}, median ${median}`}>
      {zero !== null && <line x1={zero} x2={zero} y1="0" y2="14" stroke="rgba(255,255,255,0.25)" strokeDasharray="2 2" />}
      <line x1={x(minimum)} x2={x(maximum)} y1="7" y2="7" stroke="rgba(255,255,255,0.35)" />
      <rect x={x(percentile25)} y="3" width={Math.max(1, x(percentile75) - x(percentile25))} height="8" fill={SKY} fillOpacity="0.45" stroke={SKY} />
      <line x1={x(median)} x2={x(median)} y1="2" y2="12" stroke="#F0E442" strokeWidth="2" />
    </svg>
  );
}

export function DistributionTable({ rows, scope }: { rows: ReportDistributionRow[]; scope: Scope }) {
  const selected = rows.filter((row) => sameScope(row, scope));
  const headers = ["Count", "Mean", "Median", "Std dev", "Skewness", "Kurtosis", "25th", "75th", "Min", "Max"];
  return (
    <div className="overflow-x-auto" data-testid="report-distributions">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={cn(HEAD, "text-left")}>Quantity</th>
            {headers.map((header) => (
              <th key={header} className={HEAD} title={header === "Kurtosis" ? "Excess kurtosis: 0 for a normal distribution" : header === "Std dev" ? "Standard deviation" : undefined}>{header}</th>
            ))}
            <th className={cn(HEAD, "text-left")} title="Whisker: minimum to maximum; box: 25th to 75th percentile; yellow tick: median; dashed: zero">Shape</th>
          </tr>
        </thead>
        <tbody>
          {selected.map((row) => (
            <tr key={`${row.quantityName}|${row.segmentValue}`} className="border-b border-white/5" data-testid={`report-distribution-${row.quantityName}-${row.segmentValue}`}>
              <td className="whitespace-nowrap px-2 py-1 text-left text-[11px] text-neutral-200">
                {row.quantityLabel} <span className="text-muted-foreground">· {row.segmentValue}</span>
              </td>
              <td className={CELL}>{formatCount(row.count)}</td>
              {[row.mean, row.median].map((value, index) => (
                <td key={index} className={CELL}>{formatQuantity(row.unit, value, SIZE_QUANTITIES.has(row.quantityName))}</td>
              ))}
              <td className={CELL}>{formatQuantity(row.unit, row.standardDeviation, true)}</td>
              <td className={CELL}>{row.skewness === null ? UNDEFINED_METRIC_TEXT : row.skewness.toFixed(2)}</td>
              <td className={CELL}>{row.kurtosis === null ? UNDEFINED_METRIC_TEXT : row.kurtosis.toFixed(2)}</td>
              {[row.percentile25, row.percentile75, row.minimum, row.maximum].map((value, index) => (
                <td key={index} className={CELL}>{formatQuantity(row.unit, value, SIZE_QUANTITIES.has(row.quantityName))}</td>
              ))}
              <td className="px-2 py-1"><BoxPlot row={row} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const DRAWDOWNS_SHOWN = 10;

export function DrawdownTable({ rows, scope }: { rows: ReportDrawdownRow[]; scope: Scope }) {
  const selected = rows.filter((row) => sameScope(row, scope)).sort((a, b) => a.depthRank - b.depthRank);
  if (!selected.length) return <p className="px-2 py-2 text-[11px] text-muted-foreground">The equity never fell below a previous peak in this scope.</p>;
  return (
    <div className="overflow-x-auto" data-testid="report-drawdowns">
      <p className="px-2 pb-1 text-[10px] text-muted-foreground">
        The {Math.min(DRAWDOWNS_SHOWN, selected.length)} deepest of {selected.length} drawdowns. Times are the lake's stored clock.
      </p>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {["Rank", "Depth", "Peak", "Trough", "Recovered", "Bars to trough", "Bars to recover", "Under water"].map((header) => (
              <th key={header} className={HEAD}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {selected.slice(0, DRAWDOWNS_SHOWN).map((row) => (
            <tr key={row.drawdownNumber} className="border-b border-white/5">
              <td className={CELL}>{row.depthRank}</td>
              <td className={CELL}>{formatUsdMagnitude(row.depthUsd)}</td>
              <td className={CELL}>{formatTime(row.peakTimestamp)}</td>
              <td className={CELL}>{formatTime(row.troughTimestamp)}</td>
              <td className={CELL}>{row.recoveryTimestamp === null ? "not recovered" : formatTime(row.recoveryTimestamp)}</td>
              <td className={CELL}>{formatCount(row.barsToTrough)}</td>
              <td className={CELL}>{row.barsToRecovery === null ? UNDEFINED_METRIC_TEXT : formatCount(row.barsToRecovery)}</td>
              <td className={CELL}>{formatCount(row.underwaterBars)} bars{row.underwaterDays === null ? "" : ` · ${row.underwaterDays.toFixed(1)} d`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DailyTable({ rows }: { rows: ReportDailyRow[] }) {
  if (!rows.length) return <p className="px-2 py-2 text-[11px] text-muted-foreground">No session days yet.</p>;
  const largest = Math.max(...rows.map((row) => Math.abs(row.netProfitUsd)), 1e-9);
  const rule = rows[0]?.sessionDayRule;
  return (
    <div className="overflow-x-auto" data-testid="report-daily">
      {rule && <p className="px-2 pb-1 text-[10px] text-muted-foreground" data-testid="report-daily-rule">Days dated by {rule}.</p>}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {["Session day", "Fold", "Bars", "Net profit", "", "Cumulative", "Trades", "Winners", "Cost", "Accuracy", "Worst intraday drawdown"].map((header, index) => (
              <th key={`${header}-${index}`} className={cn(HEAD, index === 0 && "text-left")}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const width = (Math.abs(row.netProfitUsd) / largest) * 50;
            const up = row.netProfitUsd >= 0;
            return (
              <tr key={row.sessionDay} className="border-b border-white/5" data-testid={`report-day-${row.sessionDay}`}>
                <td className="px-2 py-1 text-left font-mono text-[11px] text-neutral-200">{row.sessionDay}</td>
                <td className={CELL}>{row.foldIndex === null ? UNDEFINED_METRIC_TEXT : row.foldIndex + 1}</td>
                <td className={CELL}>{formatCount(row.barCount)}</td>
                <td className={cn(CELL, up ? "text-(--color-data-pos)" : "text-(--color-data-neg)")}>{formatUsd(row.netProfitUsd)}</td>
                <td className="px-2 py-1">
                  <svg width="104" height="10" role="img" aria-label={`${up ? "gain" : "loss"} of ${formatUsdMagnitude(row.netProfitUsd)}`}>
                    <line x1="52" x2="52" y1="0" y2="10" stroke="rgba(255,255,255,0.3)" />
                    <rect x={up ? 52 : 52 - width} y="2" width={width} height="6" fill={up ? ORANGE : SKY} />
                  </svg>
                </td>
                <td className={CELL}>{formatUsd(row.cumulativeNetProfitUsd)}</td>
                <td className={CELL}>{formatCount(row.tradeCount)}</td>
                <td className={CELL}>{formatCount(row.winningTradeCount)}</td>
                <td className={CELL}>{formatUsdMagnitude(row.totalCostUsd)}</td>
                <td className={CELL}>{formatPercent(row.accuracy)}</td>
                <td className={CELL}>{formatUsdMagnitude(row.intradayMaximumDrawdownUsd)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const SESSION_NOTE =
  "Session day: CME Globex sessions open at 15:00 Pacific and belong to the next calendar day; the lake stores futures times as Pacific wall clock.";
