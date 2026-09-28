/**
 * Model Cycle in-depth metric tables, read back from the lake.
 *
 * `src/ml/cycle/report.py` builds seven tables from a run's record and lands them
 * under the run's recipe (at every fold end for a new run; back-filled by
 * `scripts/land_model_cycle_metrics.py` for older ones). The serving DuckDB exposes
 * them as `derived_model_cycle_runs_<table>`; this reads one run's rows and returns
 * them in the wire shape of `src/shared/cycle/report.ts`.
 *
 * A view over `recipe=*` sees a newly landed run on its next query, but a table name
 * the dashboard has never seen needs its view defined first: when a report view is
 * missing, the views are redefined once (at most every 60 s) before reading.
 */
import { cycleReportSchema, type CycleReport } from "@shared/cycle/report";
import { derivedViews, queryQuestDB, refreshDerivedViews } from "../infrastructure/database/questdb";
import { recipeOfModelId } from "./cycleArchive";

export const REPORT_TABLES = [
  "model_metrics", "trading_metrics", "calibration_bins", "confusion_matrix", "distributions", "drawdowns", "daily_results",
] as const;
type ReportTable = (typeof REPORT_TABLES)[number];

const VIEW_PREFIX = "derived_model_cycle_runs_";
const REFRESH_INTERVAL_MILLISECONDS = 60_000;
let lastRefresh = 0;

// lake column -> wire key where the plain camelCase would read badly
const RENAMED: Record<string, string> = {
  metric_family: "family", metric_name: "name", metric_label: "label", metric_value: "value", metric_order: "order",
};
const ORDER: Record<ReportTable, string> = {
  model_metrics: "scope DESC, fold_index NULLS FIRST, segment_kind, segment_value, metric_order",
  trading_metrics: "scope DESC, fold_index NULLS FIRST, segment_kind, segment_value, metric_order",
  calibration_bins: "scope DESC, fold_index NULLS FIRST, bin_number",
  confusion_matrix: "scope DESC, fold_index NULLS FIRST, actual_direction DESC, predicted_direction DESC",
  distributions: "scope DESC, fold_index NULLS FIRST, quantity_name, segment_value",
  drawdowns: "scope DESC, fold_index NULLS FIRST, drawdown_number",
  daily_results: "session_day",
};

function viewName(table: ReportTable): string {
  return `${VIEW_PREFIX}${table}`;
}

function hasView(name: string): boolean {
  return derivedViews().some((view) => view.viewName === name);
}

export function camelKey(column: string): string {
  if (RENAMED[column]) return RENAMED[column];
  return column.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

/** One lake row in the wire shape: camelCase keys, bigint to number, the model id dropped. */
export function wireRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    if (column === "model_id" || column === "recipe") continue;
    out[camelKey(column)] = typeof value === "bigint" ? Number(value) : value;
  }
  return out;
}

async function ensureViews(): Promise<void> {
  if (REPORT_TABLES.every((table) => hasView(viewName(table)))) return;
  if (Date.now() - lastRefresh < REFRESH_INTERVAL_MILLISECONDS) return;
  lastRefresh = Date.now();
  try {
    await refreshDerivedViews();
  } catch (error) {
    console.warn(`[cycle] could not redefine the derived views: ${String(error)}`);
  }
}

async function tableRows(table: ReportTable, recipe: string): Promise<Record<string, unknown>[]> {
  const name = viewName(table);
  if (!hasView(name)) return [];
  const literal = `'${recipe.replace(/'/g, "''")}'`;
  const rows = await queryQuestDB<Record<string, unknown>>(
    `SELECT * FROM ${name} WHERE recipe = ${literal} ORDER BY ${ORDER[table]}`, 60_000,
  );
  return rows.map(wireRow);
}

/** The run's report, or null when the lake holds none of its tables yet. */
export async function loadCycleReport(modelId: string): Promise<CycleReport | null> {
  await ensureViews();
  const recipe = recipeOfModelId(modelId);
  const loaded = await Promise.all(REPORT_TABLES.map(async (table) => [table, await tableRows(table, recipe)] as const));
  const rows = Object.fromEntries(loaded) as Record<ReportTable, Record<string, unknown>[]>;
  if (!rows.model_metrics.length && !rows.trading_metrics.length) return null;
  return cycleReportSchema.parse({
    modelId,
    modelMetrics: rows.model_metrics,
    tradingMetrics: rows.trading_metrics,
    calibrationBins: rows.calibration_bins,
    confusionMatrix: rows.confusion_matrix,
    distributions: rows.distributions,
    drawdowns: rows.drawdowns,
    dailyResults: rows.daily_results,
  });
}
