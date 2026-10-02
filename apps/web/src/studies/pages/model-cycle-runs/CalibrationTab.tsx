/**
 * Calibration and calls, session days, drawdowns and distributions of the
 * chosen run, every one drawn beside its table.
 */

import { ColumnGrid, Finding, Section, Stat, fmt, fmtInt, fmtUsd, OKABE } from "@/studies/kit";
import { scopeLabel, type ConfusionCell, type DistributionRow, type DrawdownRow } from "@shared/studies/model-cycle-runs";
import { BoxRows, ConfusionGrids, DailyChart, DrawdownGrid, ReliabilityChart } from "./charts";
import { CalibrationStepper } from "./Formulas";
import type { TabProps } from "./common";
import { DataTable, recordColumns, type TableColumn } from "./Table";

const CONFUSION_COLUMNS: Array<TableColumn<ConfusionCell>> = [
  { key: "scope", label: "scope", value: (row) => scopeLabel(row.scope, row.fold_index) },
  { key: "actual", label: "actual_direction", value: (row) => row.actual_direction },
  { key: "called", label: "predicted_direction", value: (row) => row.predicted_direction },
  { key: "count", label: "bar_count", value: (row) => row.bar_count },
  { key: "share", label: "share_of_scored_bars", value: (row) => row.share_of_scored_bars },
];

const DRAWDOWN_COLUMNS: Array<TableColumn<DrawdownRow>> = [
  { key: "scope", label: "scope", value: (row) => scopeLabel(row.scope, row.fold_index) },
  { key: "number", label: "drawdown_number", value: (row) => row.drawdown_number },
  { key: "rank", label: "depth_rank", value: (row) => row.depth_rank },
  { key: "depth", label: "depth_usd", value: (row) => row.depth_usd },
  { key: "trough", label: "bars_to_trough", value: (row) => row.bars_to_trough },
  { key: "recovery", label: "bars_to_recovery", value: (row) => row.bars_to_recovery },
  { key: "days", label: "underwater_days", value: (row) => row.underwater_days },
  { key: "recovered", label: "recovered", value: (row) => row.recovered },
];

const DISTRIBUTION_COLUMNS: Array<TableColumn<DistributionRow>> = [
  { key: "scope", label: "scope", value: (row) => scopeLabel(row.scope, row.fold_index) },
  { key: "quantity", label: "quantity_label", value: (row) => row.quantity_label },
  { key: "segment", label: "segment_value", value: (row) => row.segment_value },
  { key: "unit", label: "unit", value: (row) => row.unit },
  { key: "count", label: "count", value: (row) => row.count },
  { key: "mean", label: "mean", value: (row) => row.mean },
  { key: "median", label: "median", value: (row) => row.median },
  { key: "sd", label: "standard_deviation", value: (row) => row.standard_deviation },
  { key: "skew", label: "skewness", value: (row) => row.skewness },
  { key: "kurt", label: "kurtosis", value: (row) => row.kurtosis },
  { key: "p25", label: "percentile_25", value: (row) => row.percentile_25 },
  { key: "p75", label: "percentile_75", value: (row) => row.percentile_75 },
  { key: "min", label: "minimum", value: (row) => row.minimum },
  { key: "max", label: "maximum", value: (row) => row.maximum },
];

export function CalibrationTab({ run, controls, set }: TabProps) {
  const eceMetric = run.metrics.find((row) => row.metric_name === "expected_calibration_error" && row.scope === "run");
  const worstDay = run.daily.reduce<{ day: string; net: number } | null>((worst, row) => (worst === null || row.net_profit_usd < worst.net ? { day: row.session_day, net: row.net_profit_usd } : worst), null);
  const bestDay = run.daily.reduce<{ day: string; net: number } | null>((best, row) => (best === null || row.net_profit_usd > best.net ? { day: row.session_day, net: row.net_profit_usd } : best), null);
  const deepest = run.drawdowns.filter((row) => row.scope === "run").reduce<DrawdownRow | null>((top, row) => (top === null || row.depth_usd > top.depth_usd ? row : top), null);
  const winningDays = run.daily.filter((row) => row.net_profit_usd > 0).length;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Scored bins" value={fmtInt(run.calibration.filter((bin) => bin.scope === "run" && bin.scored_bar_count > 0).length)} hint="probability bins with scored bars, whole run" />
        <Stat label="Session days" value={fmtInt(run.daily.length)} hint="CME session days: 15:00 Pacific opens the next day" />
        <Stat label="Winning days" value={run.daily.length > 0 ? `${fmtInt(winningDays)} of ${fmtInt(run.daily.length)}` : "—"} />
        <Stat label="Deepest drawdown" value={fmtUsd(deepest?.depth_usd ?? null)} hint="whole run" tone={OKABE.blue} />
      </div>

      <Section title="Calibration and calls" question="Does P(up) mean what it says, and which way did the model call against which way the bar went?">
        {run.calibration.length === 0 ? (
          <p className="text-xs text-neutral-400">{run.absent.calibration}</p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 xl:grid-cols-2">
              <div className="min-w-0 space-y-1">
                <h4 className="text-xs font-semibold text-neutral-300">Reliability: on the dashed line, P(up) means what it says</h4>
                <ReliabilityChart bins={run.calibration} />
              </div>
              <div className="min-w-0 space-y-1">
                <h4 className="text-xs font-semibold text-neutral-300">Expected calibration error, bin by bin</h4>
                <CalibrationStepper bins={run.calibration} metricValue={eceMetric?.metric_value ?? null} controls={controls} set={set} />
              </div>
            </div>
            <h4 className="text-xs font-semibold text-neutral-300">Confusion matrix: share of scored bars, by what the model called and what the bar did</h4>
            <ConfusionGrids cells={run.confusion} />
            <DataTable rows={run.confusion} columns={CONFUSION_COLUMNS} rowKey={(row) => `${row.scope}-${row.fold_index}-${row.actual_direction}-${row.predicted_direction}`} pageSize={12} />
            <details><summary className="cursor-pointer text-xs text-neutral-300">Calibration bin table and every column of it</summary>
              <div className="mt-2 space-y-2">
                <DataTable rows={run.calibration} columns={recordColumns(run.calibration)} rowKey={(row) => `${row.scope}-${row.fold_index}-${row.bin_number}`} pageSize={12} />
                <ColumnGrid rows={run.calibration} title="calibration bins" />
              </div>
            </details>
          </div>
        )}
      </Section>

      <Section title={`Session days: ${fmtInt(run.daily.length)}`} question="Each session day's net profit (bars) and the running total (line).">
        {run.daily.length === 0 ? (
          <p className="text-xs text-neutral-400">{run.absent.daily}</p>
        ) : (
          <>
            <DailyChart days={run.daily} />
            <Finding>
              {fmtInt(winningDays)} of {fmtInt(run.daily.length)} session days made money; best {bestDay?.day} at {fmtUsd(bestDay?.net ?? null)}, worst {worstDay?.day} at {fmtUsd(worstDay?.net ?? null)}.
            </Finding>
            <DataTable rows={run.daily} columns={recordColumns(run.daily)} rowKey={(row) => `${row.session_day}-${row.fold_index}`} pageSize={12} />
            <details className="mt-2"><summary className="cursor-pointer text-xs text-neutral-300">Every column of the session-day frame</summary><div className="mt-2"><ColumnGrid rows={run.daily} title="daily results" /></div></details>
          </>
        )}
      </Section>

      <Section title={`Drawdowns: ${fmtInt(run.drawdowns.length)} episodes across the scopes`} question="Depth of each peak-to-trough episode in order, per scope.">
        {run.drawdowns.length === 0 ? (
          <p className="text-xs text-neutral-400">{run.absent.drawdowns}</p>
        ) : (
          <>
            <DrawdownGrid drawdowns={run.drawdowns} />
            <Finding>Deepest whole-run drawdown {fmtUsd(deepest?.depth_usd ?? null)}, {fmtInt(deepest?.bars_to_trough ?? null)} bars to the trough, {deepest?.recovered ? `recovered after ${fmtInt(deepest.bars_to_recovery)} bars` : "never recovered"}; {fmt(deepest?.underwater_days ?? null, 2)} days underwater.</Finding>
            <DataTable rows={run.drawdowns} columns={DRAWDOWN_COLUMNS} rowKey={(row) => `${row.scope}-${row.fold_index}-${row.drawdown_number}`} pageSize={12} />
          </>
        )}
      </Section>

      <Section title="Distributions: the eight numbers of every quantity" question="USD quantities drawn per scope; every quantity, in every unit, is in the table.">
        {run.distributions.length === 0 ? (
          <p className="text-xs text-neutral-400">{run.absent.distributions}</p>
        ) : (
          <>
            <BoxRows rows={run.distributions} />
            <DataTable rows={run.distributions} columns={DISTRIBUTION_COLUMNS} rowKey={(row) => `${row.scope}-${row.fold_index}-${row.quantity_name}-${row.segment_value}`} pageSize={15} />
          </>
        )}
      </Section>
    </div>
  );
}
