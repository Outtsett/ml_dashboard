/**
 * In-depth metrics of the chosen run: every model and trading metric for the
 * whole run and each fold (built from the run's own record by cycle/report.py),
 * one metric charted across scopes, and the Sharpe ratio as a formula to scrub.
 */

import { Finding, Section, Stat, fmt, fmtInt } from "@/studies/kit";
import { pivotMatrix, type MatrixRow } from "@shared/studies/model-cycle-runs";
import { MetricBars } from "./charts";
import { SharpeStepper } from "./Formulas";
import type { TabProps } from "./common";
import { DataTable, type TableColumn } from "./Table";

function matrixColumns(scopes: readonly string[]): Array<TableColumn<MatrixRow>> {
  return [
    { key: "family", label: "metric_family", value: (row) => row.family },
    { key: "label", label: "metric_label", value: (row) => row.label, title: "the metric's name in words" },
    { key: "name", label: "metric_name", value: (row) => row.metricName },
    { key: "unit", label: "unit", value: (row) => row.unit },
    { key: "better", label: "better", value: (row) => row.better },
    ...scopes.map((scope): TableColumn<MatrixRow> => ({
      key: scope,
      label: scope,
      value: (row) => row.values[scope] ?? null,
      render: (row) => {
        const value = row.values[scope];
        const note = row.notes[scope];
        if (value === null || value === undefined) return <span className="text-neutral-500" title={note ?? "no value"}>— {note ? "ⓘ" : ""}</span>;
        return <span className="font-mono tnum" title={`n ${row.samples[scope] ?? "—"}`}>{Number.isInteger(value) ? fmtInt(value) : fmt(value, Math.abs(value) >= 100 ? 2 : 5)}</span>;
      },
    })),
  ];
}

export function MetricsTab({ run, controls, set }: TabProps) {
  if (run.metrics.length === 0) {
    return (
      <Section title="In-depth metrics: not landed for this run yet">
        <p className="text-xs text-neutral-400">{run.absent.metrics}</p>
      </Section>
    );
  }
  const model = pivotMatrix(run.metrics, "model");
  const trading = pivotMatrix(run.metrics, "trading");
  const all = [...trading.rows, ...model.rows];
  const chosen = all.find((row) => row.metricName === controls.metric) ?? null;
  const scopes = chosen ? (chosen.kind === "model" ? model.scopes : trading.scopes) : [];
  const nullCount = all.reduce((sum, row) => sum + Object.values(row.values).filter((value) => value === null).length, 0);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Model metrics" value={fmtInt(model.rows.length)} hint="classification, probability, calibration, baseline, price forecast, coverage" />
        <Stat label="Trading metrics" value={fmtInt(trading.rows.length)} hint="returns, risk adjusted, drawdown, trades, exposure, costs, baseline" />
        <Stat label="Scopes" value={fmtInt(Math.max(model.scopes.length, trading.scopes.length))} hint="the whole run and each fold" />
        <Stat label="Null cells" value={fmtInt(nullCount)} hint="hover a dash in the matrices for the reason" />
      </div>

      <Section
        title="In-depth metrics: every model and trading metric, the whole run and each fold"
        question="Built from the run's own record by cycle/report.py; the thirty scoreboard metrics equal the engine's. A dash carries the reason it is null on hover."
      >
        <h4 className="mb-1 text-xs font-semibold text-neutral-300">Model metrics</h4>
        <DataTable rows={model.rows} columns={matrixColumns(model.scopes)} rowKey={(row) => row.metricName} pageSize={20} />
        <h4 className="mb-1 mt-3 text-xs font-semibold text-neutral-300">Trading metrics</h4>
        <DataTable rows={trading.rows} columns={matrixColumns(trading.scopes)} rowKey={(row) => row.metricName} pageSize={25} />
      </Section>

      <Section title="One metric across the run and its folds" question="Pick a metric; orange at or above zero, blue below.">
        <label className="mb-2 flex max-w-xl flex-col gap-1 text-[10px] uppercase tracking-wider text-neutral-500">
          Metric
          <select
            value={controls.metric}
            onChange={(event) => set("metric", event.target.value)}
            className="h-7 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs normal-case tracking-normal text-neutral-200"
          >
            <option value="">Chart one metric across the run and its folds</option>
            {all.map((row) => (
              <option key={row.metricName} value={row.metricName}>{`${row.label} (${row.family})`}</option>
            ))}
          </select>
        </label>
        {chosen ? (
          <div className="space-y-1">
            <MetricBars
              unit={chosen.unit}
              rows={scopes.map((scope) => ({ scope, value: chosen.values[scope] ?? null, samples: chosen.samples[scope] ?? null, note: chosen.notes[scope] ?? null }))}
            />
            <Finding>{chosen.label}: {chosen.definition}</Finding>
            <p className="font-mono text-[11px] text-neutral-400">{chosen.formula} · better: {chosen.better} · unit: {chosen.unit}</p>
          </div>
        ) : (
          <p className="text-xs text-neutral-500">Pick a metric above to chart it across the run and its folds.</p>
        )}
      </Section>

      <Section title="The Sharpe ratio, bar by bar" question="Scrub how many bars the model has read and watch the ratio settle.">
        <SharpeStepper profits={run.barNetProfitUsd} record={run.record} controls={controls} set={set} />
      </Section>
    </div>
  );
}
