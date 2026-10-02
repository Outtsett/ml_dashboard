/**
 * Every run compared: the nineteen whole-run metrics of every recipe that has
 * the metric tables, sorted by Sharpe ratio, with the Sharpe ratio against the
 * probability its true value is above zero.
 */

import { ColumnGrid, Finding, Section, Stat, fmt, fmtInt } from "@/studies/kit";
import { comparisonWide } from "@shared/studies/model-cycle-runs";
import { CompareScatter } from "./charts";
import { shortRecipe, type TabProps } from "./common";
import { DataTable, recordColumns } from "./Table";

export function CompareTab({ overview, controls, set }: TabProps) {
  const table = comparisonWide(overview.comparison);
  if (table.rows.length === 0) {
    return (
      <Section title="Every run compared: the metric tables are not in the lake yet">
        <p className="text-xs text-neutral-400">Whole-run metrics come from derived_model_cycle_runs_trading_metrics and _model_metrics (scripts/land_model_cycle_metrics.py back-fills them).</p>
      </Section>
    );
  }
  const chosen = controls.recipe || overview.defaultRecipe || "";
  const best = table.rows.find((row) => typeof row.sharpe_ratio === "number");
  const confident = table.rows.filter((row) => typeof row.probabilistic_sharpe_ratio === "number" && row.probabilistic_sharpe_ratio >= 0.95).length;
  const scored = table.rows.filter((row) => typeof row.probabilistic_sharpe_ratio === "number").length;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Runs compared" value={fmtInt(table.rows.length)} hint="recipes with whole-run metrics in the lake" />
        <Stat label="Metrics compared" value={fmtInt(table.columns.length - 1)} />
        <Stat label="Best Sharpe ratio" value={fmt(typeof best?.sharpe_ratio === "number" ? best.sharpe_ratio : null, 3)} hint={best ? String(best.recipe) : undefined} />
        <Stat label="P(true Sharpe above 0) ≥ 0.95" value={`${fmtInt(confident)} of ${fmtInt(scored)}`} hint="the probabilistic Sharpe ratio corrects for few bars, skew and kurtosis" />
      </div>
      <Section title={`Every run compared: ${table.rows.length} runs, whole-run metrics from the metric tables`} question="Sharpe ratio against the probability that the true Sharpe ratio is above zero.">
        <CompareScatter rows={table.rows} />
        <Finding>
          {best ? `The best ratio, ${fmt(best.sharpe_ratio as number, 3)}, belongs to ${shortRecipe(String(best.recipe))}` : "No run has a Sharpe ratio"}
          {typeof best?.probabilistic_sharpe_ratio === "number" ? `, whose probability of a positive true Sharpe ratio is ${fmt(best.probabilistic_sharpe_ratio, 3)}.` : "."}
        </Finding>
      </Section>
      <Section title="The wide table" question="Click a row to open that run in the other tabs.">
        <DataTable
          rows={table.rows}
          columns={recordColumns(table.rows)}
          rowKey={(row) => String(row.recipe)}
          pageSize={15}
          selectedKey={chosen}
          onRowClick={(row) => set("recipe", String(row.recipe))}
        />
      </Section>
      <details className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-neutral-100">Every numeric column of the comparison, graphed</summary>
        <div className="mt-2"><ColumnGrid rows={table.rows} title="comparison" /></div>
      </details>
    </div>
  );
}
