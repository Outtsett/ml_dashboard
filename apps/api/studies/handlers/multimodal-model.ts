/**
 * Multimodal MNQ bracket model: every development trial against the
 * acceptance gate. Replaced notebooks/multimodal_model.py.
 *
 * Reads the landed record of the runner multimodal_fusion+bracket_meta_label
 * (derived_multimodal_runs_*, _labels_base_rates, _notebook_audit_*,
 * _overfitting_*) and, read-only, two plain files of the plan directory: the
 * trial ledger (family and blocks of each trial) and state.json (how many
 * looks the locked holdout has had).
 *
 * Holdout safety. This handler never reaches the gate or the holdout code. Every
 * query on a run table is bounded at the last development quarter, 2025Q2, so
 * even a table that later held a locked quarter would not show it, and the
 * selected recipe must be one of the development trials (never a gate_* recipe).
 * The acceptance gate's own record is read only as the summary rows a gate run
 * lands itself; until that look is taken there are none.
 *
 * Window. The trial table is scored on 2021Q2..2025Q2. The run tables also hold
 * the earlier quarters a trial needs to choose its policy (2020Q4, 2021Q1, and
 * back to 2011Q4 for three trials), so the detail views default to the canonical
 * window to agree with the table, and `window=all` shows every landed quarter
 * (what the notebook showed).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ident, num as numberLiteral, text } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  CANONICAL_FIRST_QUARTER,
  DEVELOPMENT_LAST_QUARTER,
  bestTrialRecipe,
  flattenSummary,
  type AblationRow,
  type AuditRow,
  type BaseRateRow,
  type CalibrationRow,
  type EdgeVerdictRow,
  type FoldRow,
  type GainRow,
  type GateRecord,
  type HoldoutStatus,
  type LedgerConfiguration,
  type MultimodalBody,
  type OverfittingSummary,
  type OverfittingTrialRow,
  type PolicyRow,
  type QuarterWindow,
  type SelectedTrialDetail,
  type TopFeatureRow,
  type TradeRow,
  type TrialRow,
} from "@shared/studies/multimodal-model";

const VIEW = {
  summary: "derived_multimodal_runs_summary",
  trades: "derived_multimodal_runs_trades",
  predictions: "derived_multimodal_runs_predictions",
  importance: "derived_multimodal_runs_importance",
  folds: "derived_multimodal_runs_folds",
  policies: "derived_multimodal_runs_policies",
  baseRates: "derived_multimodal_labels_base_rates",
  audit: "derived_multimodal_notebook_audit_notebooks",
  verdicts: "derived_multimodal_notebook_audit_edge_verdicts",
  overfittingSummary: "derived_multimodal_overfitting_summary",
  overfittingTrials: "derived_multimodal_overfitting_trials",
} as const;

const RECIPE_PATTERN = /^[A-Za-z0-9_.\-]{1,160}$/;
const HEADS = ["long_r2", "short_r2", "long_r3", "short_r3"] as const;
const SAMPLE_ROWS = 4000;
const PLAN_DIRECTORY = "docs/plans/2026-09-29-multimodal";

// ── the plan directory, read-only ──────────────────────────────────────────

function planDirectory(): string {
  return path.resolve(process.cwd(), PLAN_DIRECTORY);
}

/** family and blocks of each trial, keyed by recipe (the ledger's model_id writes "+" where the lake writes "_"). */
export function parseTrialLedger(contents: string): { configurations: Map<string, LedgerConfiguration>; lines: number } {
  const configurations = new Map<string, LedgerConfiguration>();
  let lines = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    lines += 1;
    try {
      const entry = JSON.parse(line) as { model_id?: unknown; configuration?: { family?: unknown; blocks?: unknown } };
      if (typeof entry.model_id !== "string") continue;
      const family = entry.configuration?.family;
      const blocks = entry.configuration?.blocks;
      configurations.set(entry.model_id.replace(/\+/g, "_"), {
        family: typeof family === "string" ? family : null,
        blocks: typeof blocks === "string" ? blocks : null,
      });
    } catch {
      // A malformed ledger line costs that trial its family label, nothing else.
    }
  }
  return { configurations, lines };
}

/** Only the look counters and the phase of state.json: nothing that unlocks anything. */
export function parseHoldoutStatus(contents: string | null, ledgerLines: number | null): HoldoutStatus {
  const empty: HoldoutStatus = { looks: null, lookBudget: null, forwardLooks: null, forwardLookBudget: null, phase: null, step: null, lastCheckpoint: null, ledgerLines };
  if (contents === null) return empty;
  try {
    const state = JSON.parse(contents) as {
      phase?: unknown;
      step?: unknown;
      last_checkpoint?: unknown;
      holdout?: { looks?: unknown; look_budget?: unknown };
      forward?: { looks?: unknown; look_budget?: unknown };
    };
    const numeric = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    const label = (value: unknown) => (typeof value === "string" ? value : null);
    return {
      looks: numeric(state.holdout?.looks),
      lookBudget: numeric(state.holdout?.look_budget),
      forwardLooks: numeric(state.forward?.looks),
      forwardLookBudget: numeric(state.forward?.look_budget),
      phase: label(state.phase),
      step: label(state.step),
      lastCheckpoint: label(state.last_checkpoint),
      ledgerLines,
    };
  } catch {
    return empty;
  }
}

function readPlanFile(name: string): string | null {
  try {
    return readFileSync(path.join(planDirectory(), name), "utf8");
  } catch {
    return null;
  }
}

function mnqCosts(): { pointValueUsd: number; roundTripCostPoints: number } {
  try {
    const model = JSON.parse(readFileSync(path.resolve(process.cwd(), "packages/config/cost_model.json"), "utf8")) as Record<
      string,
      { point_value?: number; total_round_trip_points?: number }
    >;
    return { pointValueUsd: model.MNQ?.point_value ?? 2, roundTripCostPoints: model.MNQ?.total_round_trip_points ?? 1.39 };
  } catch {
    return { pointValueUsd: 2, roundTripCostPoints: 1.39 };
  }
}

// ── SQL pieces (every literal is parsed, then quoted) ──────────────────────

/** The quarters a detail view reads. The upper bound is the last development quarter whatever the window. */
function quarterBounds(column: string, window: QuarterWindow): string {
  const upper = `${ident(column)} <= ${text(DEVELOPMENT_LAST_QUARTER)}`;
  return window === "canonical" ? `${ident(column)} >= ${text(CANONICAL_FIRST_QUARTER)} AND ${upper}` : upper;
}

function isGateRecipe(recipe: string): boolean {
  return recipe.startsWith("gate_");
}

async function trialRows(context: StudyContext, configurations: Map<string, LedgerConfiguration>): Promise<TrialRow[]> {
  const rows = await context.lake.query<{ recipe: string; scope: string; summary_json: string }>(
    `WITH ranked AS (
       SELECT recipe, scope, summary_json, row_number() OVER (PARTITION BY recipe ORDER BY scope) AS rank_in_recipe
       FROM ${ident(VIEW.summary)}
       WHERE scope IN ('canonical_2021q2_2025q2', 'policy_tuned_quarters') AND NOT starts_with(recipe, 'gate_')
     )
     SELECT recipe, scope, summary_json FROM ranked WHERE rank_in_recipe = 1 ORDER BY recipe`,
  );
  const trials: TrialRow[] = [];
  for (const row of rows) {
    const trial = flattenSummary(String(row.recipe), String(row.scope), String(row.summary_json), configurations.get(String(row.recipe)));
    if (trial) trials.push(trial);
    else context.notes.push(`The summary of ${row.recipe} could not be read as JSON.`);
  }
  return trials;
}

async function gateRecords(context: StudyContext): Promise<GateRecord[]> {
  const rows = await context.lake.query<{ recipe: string; scope: string; summary_json: string }>(
    `SELECT recipe, scope, summary_json FROM ${ident(VIEW.summary)} WHERE starts_with(recipe, 'gate_') ORDER BY recipe, scope`,
  );
  const records: GateRecord[] = [];
  for (const row of rows) {
    try {
      const summary = JSON.parse(String(row.summary_json)) as Record<string, unknown>;
      records.push({ recipe: String(row.recipe), scope: String(row.scope), summary });
    } catch {
      context.notes.push(`The gate record ${row.recipe} could not be read as JSON.`);
    }
  }
  return records;
}

async function selectedDetail(context: StudyContext, recipe: string, window: QuarterWindow): Promise<SelectedTrialDetail> {
  const lake = context.lake;
  const quoted = text(recipe);
  const quarterWindow = quarterBounds("quarter", window);
  const foldWindow = quarterBounds("fold", window);

  const calibrationSql = HEADS.map(
    (head) => `SELECT ${text(head)} AS head, floor(rank_in_head * 10.0 / (rows_in_head + 1))::INTEGER AS decile,
         avg(probability) AS predicted_probability,
         avg(CASE WHEN net_points > 0 THEN 1.0 ELSE 0.0 END) AS realised_win_rate,
         avg(net_points) AS mean_net_points, count(*) AS row_count
       FROM (
         SELECT probability, net_points, row_number() OVER (ORDER BY probability, decision_timestamp) AS rank_in_head, count(*) OVER () AS rows_in_head
         FROM (
           SELECT decision_timestamp, ${ident(`${head}_probability`)} AS probability, ${ident(`${head}_net_points`)} AS net_points
           FROM ${ident(VIEW.predictions)} WHERE recipe = ${quoted} AND ${quarterWindow}
         ) WHERE probability IS NOT NULL AND net_points IS NOT NULL
       ) GROUP BY 1, 2`,
  ).join("\nUNION ALL\n");

  const predictionColumns = HEADS.flatMap((head) => [`${head}_probability`, `${head}_net_points`]);
  const importanceBase = `FROM ${ident(VIEW.importance)} WHERE recipe = ${quoted} AND ${foldWindow}`;
  const gainFilter = `NOT ends_with(feature, '__token') AND gain_share IS NOT NULL AND NOT isnan(gain_share)`;

  const [trades, calibration, predictionCount, ablationRows, gain, topFeatures, gainCount, folds, policies] = await Promise.all([
    lake.query<TradeRow>(
      `SELECT session, quarter, head, forced, net_points, probability, expected_points, stop_points, target_points,
              (exit_timestamp - entry_timestamp) / 60.0 AS minutes_held
       FROM ${ident(VIEW.trades)} WHERE recipe = ${quoted} AND ${quarterWindow} ORDER BY decision_timestamp, head`,
    ),
    lake.query<CalibrationRow>(`SELECT * FROM (${calibrationSql}) ORDER BY head, decile`),
    lake.query<{ row_count: number }>(`SELECT count(*) AS row_count FROM ${ident(VIEW.predictions)} WHERE recipe = ${quoted} AND ${quarterWindow}`),
    lake.query<AblationRow>(
      `SELECT fold, head, modality, auc_full, auc_without, auc_drop
       ${importanceBase} AND auc_drop IS NOT NULL AND NOT isnan(auc_drop) ORDER BY head, modality, fold`,
    ),
    lake.query<GainRow>(
      `SELECT modality, head, sum(gain_share) / count(DISTINCT fold) AS gain_share
       ${importanceBase} AND ${gainFilter} GROUP BY 1, 2 ORDER BY head, modality`,
    ),
    lake.query<TopFeatureRow>(
      `SELECT feature, modality, avg(gain_share) AS mean_gain_share
       ${importanceBase} AND ${gainFilter} GROUP BY 1, 2 ORDER BY mean_gain_share DESC, feature LIMIT 15`,
    ),
    lake.query<{ row_count: number }>(`SELECT count(*) AS row_count ${importanceBase} AND ${gainFilter}`),
    lake.query<FoldRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEW.folds)} WHERE recipe = ${quoted} AND ${foldWindow} ORDER BY fold`),
    lake.query<PolicyRow>(
      `SELECT quarter, policy_index, threshold_points, max_trades, forced_minute, array_to_string(heads, ',') AS heads, history_net_points
       FROM ${ident(VIEW.policies)} WHERE recipe = ${quoted} AND ${quarterWindow} ORDER BY quarter`,
    ),
  ]);

  // A reproducible thin sample for the per-column graphics: every k-th row by a hash of its own key.
  const predictionTotal = Number(predictionCount[0]?.row_count ?? 0);
  const predictionStride = numberLiteral(Math.max(1, Math.ceil(predictionTotal / SAMPLE_ROWS)));
  const gainTotal = Number(gainCount[0]?.row_count ?? 0);
  const gainStride = numberLiteral(Math.max(1, Math.ceil(gainTotal / SAMPLE_ROWS)));
  const [predictionSample, gainSample] = await Promise.all([
    lake.query<Record<string, number | null>>(
      `SELECT ${predictionColumns.map(ident).join(", ")}
       FROM ${ident(VIEW.predictions)} WHERE recipe = ${quoted} AND ${quarterWindow} AND hash(decision_timestamp) % ${predictionStride} = 0`,
    ),
    lake.query<{ gain_share: number }>(
      `SELECT gain_share ${importanceBase} AND ${gainFilter} AND hash(fold, head, feature) % ${gainStride} = 0`,
    ),
  ]);

  return {
    recipe,
    window,
    trades,
    calibration,
    predictionRowCount: predictionTotal,
    predictionSample,
    ablationRows,
    gain,
    topFeatures,
    gainShareSample: gainSample,
    folds,
    policies,
  };
}

async function baseRates(context: StudyContext): Promise<BaseRateRow[]> {
  return context.lake.query<BaseRateRow>(
    `SELECT breakdown, recipe, side, reward_multiple, decision_hour, year, candidate_count, session_count, target_hit_rate, stop_rate,
            session_end_rate, win_rate, average_win_points, average_loss_points, payoff_ratio, profit_factor, expectancy_points,
            median_stop_points, median_target_points, median_minutes_held
     FROM ${ident(VIEW.baseRates)} WHERE breakdown IN ('all', 'decision_hour', 'year')
     ORDER BY recipe, breakdown, side, reward_multiple, decision_hour, year`,
  );
}

async function overfitting(context: StudyContext): Promise<{ summary: OverfittingSummary | null; trials: OverfittingTrialRow[] }> {
  const [summaryRows, trials] = await Promise.all([
    context.lake.query<{ summary_json: string }>(`SELECT summary_json FROM ${ident(VIEW.overfittingSummary)} ORDER BY recipe DESC LIMIT 1`),
    context.lake.query<OverfittingTrialRow>(`SELECT trial, daily_sharpe, annualised_sharpe, net_points FROM ${ident(VIEW.overfittingTrials)} ORDER BY daily_sharpe DESC`),
  ]);
  let summary: OverfittingSummary | null = null;
  const json = summaryRows[0]?.summary_json;
  if (typeof json === "string") {
    try {
      summary = JSON.parse(json) as OverfittingSummary;
    } catch {
      context.notes.push("The overfitting summary could not be read as JSON.");
    }
  }
  return { summary, trials };
}

/** One optional section: a failure becomes a note and an empty section, not a failed page. */
async function section<T>(context: StudyContext, label: string, fallback: T, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    context.notes.push(`${label} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
}

const query = z.object({
  /** A development trial's recipe; absent means the highest profit factor. */
  trial: z.string().regex(RECIPE_PATTERN).optional(),
  window: z.enum(["canonical", "all"]).default("canonical"),
});

const handler: StudyHandler<typeof query, MultimodalBody> = {
  slug: "multimodal-model",
  datasets: Object.values(VIEW),
  query,
  cacheSeconds: 300,
  timeoutMs: 180_000,
  async run(parsed, context) {
    const { pointValueUsd, roundTripCostPoints } = mnqCosts();
    const ledgerText = readPlanFile("trials.jsonl");
    const ledger = ledgerText === null ? { configurations: new Map<string, LedgerConfiguration>(), lines: null } : parseTrialLedger(ledgerText);
    const holdout = parseHoldoutStatus(readPlanFile("state.json"), ledger.lines);
    const empty: MultimodalBody = {
      pointValueUsd,
      roundTripCostPoints,
      trials: [],
      selectedRecipe: null,
      window: parsed.window,
      detail: null,
      baseRates: [],
      audit: [],
      edgeVerdicts: [],
      overfitting: { summary: null, trials: [] },
      gates: [],
      holdout,
    };

    const present = new Set<string>();
    for (const view of Object.values(VIEW)) if (await context.lake.hasView(view)) present.add(view);
    await missingViews(
      context,
      Object.values(VIEW).filter((view) => !present.has(view)),
    );
    if (!present.has(VIEW.summary)) return empty;

    const trials = await trialRows(context, ledger.configurations);
    const known = new Set(trials.map((trial) => trial.recipe));
    let selected = parsed.trial ?? null;
    if (selected !== null && (isGateRecipe(selected) || !known.has(selected))) {
      context.notes.push(`${selected} is not a development trial; showing the highest profit factor instead.`);
      selected = null;
    }
    selected ??= bestTrialRecipe(trials);

    const detailReady = selected !== null && present.has(VIEW.trades) && present.has(VIEW.predictions) && present.has(VIEW.importance) && present.has(VIEW.folds) && present.has(VIEW.policies);
    const [detail, rates, audit, verdicts, overfit, gates] = await Promise.all([
      detailReady ? section<SelectedTrialDetail | null>(context, "The selected trial's detail", null, () => selectedDetail(context, selected as string, parsed.window)) : Promise.resolve(null),
      present.has(VIEW.baseRates) ? section<BaseRateRow[]>(context, "The base rates", [], () => baseRates(context)) : Promise.resolve([] as BaseRateRow[]),
      present.has(VIEW.audit)
        ? section<AuditRow[]>(context, "The notebook audit", [], () =>
            context.lake.query<AuditRow>(
              `SELECT path, relevant_to_training, topic, edge_evidence, lookahead_risk, costs_included, out_of_sample, edge_summary, recommendation
               FROM ${ident(VIEW.audit)} ORDER BY edge_evidence, path`,
            ),
          )
        : Promise.resolve([] as AuditRow[]),
      present.has(VIEW.verdicts)
        ? section<EdgeVerdictRow[]>(context, "The edge verdicts", [], () =>
            context.lake.query<EdgeVerdictRow>(`SELECT path, claim, holds, reasons, corrected_numbers, usable_for_design FROM ${ident(VIEW.verdicts)} ORDER BY path`),
          )
        : Promise.resolve([] as EdgeVerdictRow[]),
      present.has(VIEW.overfittingSummary) && present.has(VIEW.overfittingTrials)
        ? section(context, "The overfitting report", { summary: null, trials: [] as OverfittingTrialRow[] }, () => overfitting(context))
        : Promise.resolve({ summary: null, trials: [] as OverfittingTrialRow[] }),
      section<GateRecord[]>(context, "The gate record", [], () => gateRecords(context)),
    ]);

    return {
      ...empty,
      trials,
      selectedRecipe: selected,
      detail,
      baseRates: rates,
      audit,
      edgeVerdicts: verdicts,
      overfitting: overfit,
      gates,
    };
  },
};

export default handler;
