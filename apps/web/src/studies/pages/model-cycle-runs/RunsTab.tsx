/**
 * Runs: every recorded run (full record) and every recipe with folds landed,
 * with the net-profit-against-Sharpe scatter. Clicking a row opens that run in
 * the tabs beside this one.
 */

import { ColumnGrid, Finding, OKABE, Section, Stat, fmtInt } from "@/studies/kit";
import type { RecipeOption, RunRecord } from "@shared/studies/model-cycle-runs";
import { RunScatter } from "./charts";
import { stampCell, type TabProps } from "./common";
import { DataTable, recordColumns, type TableColumn } from "./Table";

const RECIPE_COLUMNS: Array<TableColumn<RecipeOption>> = [
  { key: "recipe", label: "recipe", value: (row) => row.recipe },
  { key: "status", label: "status", value: (row) => row.status },
  { key: "foldCount", label: "fold_count", value: (row) => row.foldCount },
  { key: "firstTest", label: "first_test", value: (row) => row.firstTest, render: (row) => stampCell(row.firstTest) },
  { key: "lastTest", label: "last_test", value: (row) => row.lastTest, render: (row) => stampCell(row.lastTest) },
  { key: "testBars", label: "test_bars", value: (row) => row.testBars },
];

export function RunsTab({ overview, controls, set }: TabProps) {
  const { runs, recipes } = overview;
  const foldsOnly = recipes.filter((option) => !option.hasFullRecord).length;
  const complete = runs.filter((run) => run.status === "complete").length;
  const failed = runs.filter((run) => run.status === "failed").length;
  const chosen = controls.recipe || overview.defaultRecipe || "";

  const columns = recordColumns<RunRecord>(runs, { started_at_timestamp: stampCell });

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Runs with a full record" value={fmtInt(runs.length)} hint="a runs table row: the eight-table record landed" />
        <Stat label="Recipes in the lake" value={fmtInt(recipes.length)} hint="runs plus every recipe that has folds landed" />
        <Stat label="Complete · failed" value={`${fmtInt(complete)} · ${fmtInt(failed)}`} hint="status of the full-record runs" tone={failed > 0 ? OKABE.blue : OKABE.orange} />
        <Stat label="Folds-only recipes" value={fmtInt(foldsOnly)} hint="recorded before 2026-09-27: predictions, trades and folds only" />
      </div>

      <Section
        title={`Runs: ${runs.length} with a full record, ${recipes.length} recipes in all`}
        question="The runs table, newest first. Click a row to open that run in the other tabs."
      >
        {runs.length === 0 ? (
          <p className="text-xs text-neutral-500">No run has landed a runs table yet: the next run started from the Model Cycle page will.</p>
        ) : (
          <DataTable rows={runs} columns={columns} rowKey={(row) => row.recipe} pageSize={10} selectedKey={chosen} onRowClick={(row) => set("recipe", row.recipe)} />
        )}
      </Section>

      <Section title="Every recorded run: net profit against Sharpe" question="Colour is the model, shape is the status; hover a point for its recipe, trades and accuracy.">
        <RunScatter runs={runs} />
        <Finding>
          {runs.length > 0 && runs.every((run) => run.net_profit_usd === null || run.sharpe_ratio === null)
            ? "No run has both figures yet."
            : `${runs.filter((run) => typeof run.net_profit_usd === "number" && run.net_profit_usd > 0).length} of ${runs.filter((run) => typeof run.net_profit_usd === "number").length} scored runs made money after costs.`}
        </Finding>
      </Section>

      <Section
        title="Every recipe with folds landed (the older three-table runs included)"
        question={`${foldsOnly} of ${recipes.length} recipes predate the full record: their metric tables leave exposure, and the forecast when it had no price model, null with the reason.`}
      >
        <DataTable rows={recipes} columns={RECIPE_COLUMNS} rowKey={(row) => row.recipe} pageSize={12} selectedKey={chosen} onRowClick={(row) => set("recipe", row.recipe)} />
      </Section>

      <details className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-neutral-100">Every numeric column of the runs table, graphed</summary>
        <div className="mt-2">
          <ColumnGrid rows={runs} exclude={["started_at_timestamp"]} title="runs" />
        </div>
      </details>
    </div>
  );
}
