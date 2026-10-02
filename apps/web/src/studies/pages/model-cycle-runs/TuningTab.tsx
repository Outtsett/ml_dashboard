/**
 * Tuning and training of the chosen run: Optuna trials per fold, validation
 * loss per epoch, the metric values the run emitted, and the bars the model
 * read.
 */

import { ColumnGrid, ControlBar, Finding, Section, SwitchControl, fmt, fmtInt } from "@/studies/kit";
import { EpochsChart, TrialsGrid } from "./charts";
import { stampCell, type TabProps } from "./common";
import { DataTable, recordColumns, type TableColumn } from "./Table";
import type { BarsSummaryRow } from "@shared/studies/model-cycle-runs";

const BARS_COLUMNS: Array<TableColumn<BarsSummaryRow>> = [
  { key: "role", label: "role", value: (row) => row.role },
  { key: "bars", label: "bars", value: (row) => row.bars },
  { key: "first_bar", label: "first_bar", value: (row) => row.first_bar, render: (row) => stampCell(row.first_bar) },
  { key: "last_bar", label: "last_bar", value: (row) => row.last_bar, render: (row) => stampCell(row.last_bar) },
  { key: "roll_adjusted_bars", label: "roll_adjusted_bars", value: (row) => row.roll_adjusted_bars },
];

export function TuningTab({ run, controls, set }: TabProps) {
  const finalFits = run.epochs.filter((row) => row.trial === null || row.trial === undefined).length;
  const best = run.trials.filter((row) => typeof row.objective_value === "number").reduce<number | null>(
    (top, row) => (top === null || (row.objective_value as number) > top ? (row.objective_value as number) : top), null,
  );
  return (
    <div className="space-y-3">
      <Section
        title={run.trials.length > 0 ? `Tuning trials: ${fmtInt(run.trials.length)}` : "Tuning trials: none landed"}
        question="Optuna searched each fold's own training span; the score is on inner validation blocks."
      >
        {run.trials.length === 0 ? (
          <p className="text-xs text-neutral-400">{run.absent.trials}</p>
        ) : (
          <>
            <TrialsGrid trials={run.trials} />
            <Finding>
              Best search score {fmt(best, 5)}. A search score is optimistic by construction: it picked the trial that scored best on the very blocks it is quoted on, so the honest number is the fold's test result, never this.
            </Finding>
            <DataTable rows={run.trials} columns={recordColumns(run.trials)} rowKey={(row) => `${row.fold_index}-${row.trial}`} pageSize={10} />
            <details className="mt-2"><summary className="cursor-pointer text-xs text-neutral-300">Every column of the trials frame</summary><div className="mt-2"><ColumnGrid rows={run.trials} title="trials" /></div></details>
          </>
        )}
      </Section>

      <Section
        title={run.epochs.length > 0 ? `Training steps: ${fmtInt(run.epochs.length)} epoch summaries` : "Training steps: none landed"}
        question="Validation loss per fold and model role. Colour is the role (orange direction, purple price), dash is the fold."
      >
        {run.epochs.length === 0 ? (
          <p className="text-xs text-neutral-400">{run.absent.epochs}</p>
        ) : (
          <>
            <ControlBar>
              <SwitchControl label="Show tuning trials (faint)" checked={controls.showTrials} onChange={(value) => set("showTrials", value)} hint="Each tuning trial trains its own model; the bold line is the final fit of the fold" />
            </ControlBar>
            <EpochsChart epochs={run.epochs} showTrials={controls.showTrials} />
            <Finding>{fmtInt(finalFits)} of {fmtInt(run.epochs.length)} epoch rows belong to a fold's final fit; the rest are tuning trials, shown when the switch is on.</Finding>
            <details><summary className="cursor-pointer text-xs text-neutral-300">Epoch table and every column of the epochs frame</summary>
              <div className="mt-2 space-y-2">
                <DataTable rows={run.epochs} columns={recordColumns(run.epochs)} rowKey={(row) => `${row.fold_index}-${row.trial}-${row.model_role}-${row.epoch}`} pageSize={12} />
                <ColumnGrid rows={run.epochs} title="epochs" />
              </div>
            </details>
          </>
        )}
      </Section>

      <Section
        title={run.metricStream.length > 0 ? `Metric stream: ${fmtInt(run.metricStream.length)} emitted values` : "Metric stream: none landed"}
        question="Every value the run emitted through the training protocol, in order."
      >
        {run.metricStream.length === 0 ? (
          <p className="text-xs text-neutral-400">{run.absent.metricStream}</p>
        ) : (
          <>
            <DataTable rows={run.metricStream} columns={recordColumns(run.metricStream)} rowKey={(_row, index) => String(index)} pageSize={12} />
            <details className="mt-2"><summary className="cursor-pointer text-xs text-neutral-300">Every column of the metric stream frame</summary><div className="mt-2"><ColumnGrid rows={run.metricStream} title="metric stream" /></div></details>
          </>
        )}
      </Section>

      <Section title="Bars the model read" question="Context bars fill each fold's train and validation spans; processed bars are the test walk. Roll-adjusted bars carry a back-adjustment at a contract roll.">
        {run.barsSummary.length === 0 ? (
          <p className="text-xs text-neutral-400">{run.absent.bars}</p>
        ) : (
          <DataTable rows={run.barsSummary} columns={BARS_COLUMNS} rowKey={(row) => row.role} />
        )}
      </Section>
    </div>
  );
}
