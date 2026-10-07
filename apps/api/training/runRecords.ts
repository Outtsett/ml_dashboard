/**
 * The dashboard's entity rows for a Model Cycle run, written as the run
 * reports itself: `cycle_plan` → the run, its settings, its features and its
 * base parameters; `cycle_parameters` → what a fold fitted with; the end →
 * status and the verdicts. The run's measured series stay in the lake; these
 * rows are what the pages ask ABOUT a run, and they survive a restart.
 *
 * Every write is idempotent (insert-or-replace on the row's natural key), so
 * a replayed event or a rebuilt snapshot writes the same rows again.
 */
import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "../infrastructure/database/sqlite";
import type { CycleParameters, CyclePlan, CycleRunStatus, CycleSnapshot } from "@shared/cycle/schema";
import { configurationOf, buildRunView } from "@shared/runs/view";
import { runName, runPurpose } from "@shared/runs/naming";
import type { RunParameterValue } from "@shared/runs/types";

const { cycleRuns, cycleRunConfigurations, cycleRunSettings, cycleRunFeatures, cycleRunVerdicts } = schema;

type ValueType = "number" | "string" | "boolean" | "null";

function typed(value: RunParameterValue): { text: string | null; type: ValueType } {
  if (value === null || value === undefined) return { text: null, type: "null" };
  if (typeof value === "number") return { text: String(value), type: "number" };
  if (typeof value === "boolean") return { text: value ? "true" : "false", type: "boolean" };
  return { text: value, type: "string" };
}

/** A stored value back in its type. */
export function untyped(text: string | null, type: string): RunParameterValue {
  if (text === null || type === "null") return null;
  if (type === "number") return Number(text);
  if (type === "boolean") return text === "true";
  return text;
}

function modelKeyOf(modelType: string): string {
  return modelType.replace(/\+walk_forward_cycle$/, "");
}

/** The next version for this model on this series: one more than the highest recorded. */
export function nextVersion(modelKey: string, symbol: string, timeframe: string): number {
  const latest = db
    .select({ version: cycleRuns.version })
    .from(cycleRuns)
    .where(and(eq(cycleRuns.modelKey, modelKey), eq(cycleRuns.symbol, symbol), eq(cycleRuns.timeframe, timeframe)))
    .orderBy(desc(cycleRuns.version))
    .limit(1)
    .all();
  return (latest[0]?.version ?? 0) + 1;
}

/** On `cycle_plan`: the run row, its settings, its features and its base parameters. */
export function recordPlan(runId: string, modelType: string, plan: CyclePlan, startedAt: number, parentRunId: string | null): void {
  const modelKey = modelKeyOf(modelType);
  const existing = db.select({ version: cycleRuns.version, parentRunId: cycleRuns.parentRunId }).from(cycleRuns).where(eq(cycleRuns.runId, runId)).all()[0];
  const version = existing?.version ?? nextVersion(modelKey, plan.symbol, plan.timeframe);
  const configuration = configurationOf({ plan, parameters: [] });
  if (!configuration) return;
  const purpose = runPurpose({
    modelLabel: plan.modelLabel,
    symbol: plan.symbol,
    timeframe: plan.timeframe,
    directionMode: plan.directionMode ?? null,
    hasPriceModel: plan.hasPriceModel ?? null,
    labelHorizonBars: plan.labelHorizonBars,
    tuningObjective: plan.tuning?.objective ?? null,
    tuningTrialCount: plan.tuning?.trialCount ?? 0,
  });
  const source = plan.tuning && (plan.tuning.mode ?? "tuned") === "tuned" ? "manual" : "reviewed_defaults";
  db.transaction((tx) => {
    tx.insert(cycleRuns)
      .values({
        runId,
        modelKey,
        modelType,
        modelLabel: plan.modelLabel,
        symbol: plan.symbol,
        timeframe: plan.timeframe,
        name: runName(runId),
        version,
        purpose,
        status: "running",
        error: null,
        startedAt,
        finishedAt: null,
        parentRunId: parentRunId ?? existing?.parentRunId ?? null,
        dataStart: plan.dataStart,
        dataEnd: plan.dataEnd,
        barCount: plan.barCount,
        foldCount: plan.folds.length,
      })
      .onConflictDoUpdate({
        target: cycleRuns.runId,
        set: { modelLabel: plan.modelLabel, purpose, dataStart: plan.dataStart, dataEnd: plan.dataEnd, barCount: plan.barCount, foldCount: plan.folds.length },
      })
      .run();
    tx.delete(cycleRunSettings).where(eq(cycleRunSettings.runId, runId)).run();
    for (const [name, value] of Object.entries(configuration.settings)) {
      const { text, type } = typed(value);
      tx.insert(cycleRunSettings).values({ runId, settingName: name, settingValue: text, valueType: type }).run();
    }
    for (const [name, value] of Object.entries(configuration.costModel)) {
      const { text, type } = typed(value);
      tx.insert(cycleRunSettings).values({ runId, settingName: `cost_${name}`, settingValue: text, valueType: type }).run();
    }
    tx.delete(cycleRunFeatures).where(eq(cycleRunFeatures.runId, runId)).run();
    configuration.featureNames.forEach((featureName, position) => {
      tx.insert(cycleRunFeatures).values({ runId, position, featureName }).run();
    });
    tx.delete(cycleRunConfigurations).where(and(eq(cycleRunConfigurations.runId, runId), eq(cycleRunConfigurations.scope, "base"))).run();
    for (const [name, value] of Object.entries(configuration.parameters)) {
      const { text, type } = typed(value);
      tx.insert(cycleRunConfigurations).values({ runId, scope: "base", foldIndex: null, parameterName: name, parameterValue: text, valueType: type, source }).run();
    }
  });
}

/** On `cycle_parameters`: what one fold fitted with. */
export function recordFoldParameters(runId: string, parameters: CycleParameters): void {
  const foldIndex = parameters.foldIndex ?? 0;
  db.transaction((tx) => {
    tx.delete(cycleRunConfigurations)
      .where(and(eq(cycleRunConfigurations.runId, runId), eq(cycleRunConfigurations.scope, "fold"), eq(cycleRunConfigurations.foldIndex, foldIndex)))
      .run();
    for (const [name, value] of Object.entries(parameters.parameters)) {
      const { text, type } = typed(value);
      tx.insert(cycleRunConfigurations)
        .values({ runId, scope: "fold", foldIndex, parameterName: name, parameterValue: text, valueType: type, source: parameters.source })
        .run();
    }
  });
}

/** At the end: the status, and the verdict rules that fired on the final numbers. */
export function recordFinish(snapshot: CycleSnapshot, status: CycleRunStatus, error: string | null, finishedAt: number): void {
  const exists = db.select({ runId: cycleRuns.runId }).from(cycleRuns).where(eq(cycleRuns.runId, snapshot.modelId)).all().length > 0;
  if (!exists) return;
  const view = buildRunView({ ...snapshot, status, error, finishedAt }, null, null);
  db.transaction((tx) => {
    tx.update(cycleRuns).set({ status, error, finishedAt }).where(eq(cycleRuns.runId, snapshot.modelId)).run();
    tx.delete(cycleRunVerdicts).where(eq(cycleRunVerdicts.runId, snapshot.modelId)).run();
    for (const verdict of view.verdicts) {
      tx.insert(cycleRunVerdicts)
        .values({ runId: snapshot.modelId, rule: verdict.rule, severity: verdict.severity, category: verdict.category, title: verdict.title, evidence: verdict.evidence, action: verdict.action })
        .run();
    }
  });
}

/** The recorded settings that are launch flags again (`CYCLE_FLAGS` in `cycle/main.py`), by the name the flag takes. */
const SETTING_TO_FLAG: Record<string, string> = {
  fold_count: "fold_limit",
  label_horizon_bars: "label_horizon_bars",
  label_threshold_ticks: "label_threshold_ticks",
  label_gap_multiple: "label_gap_multiple",
  embargo_bars: "embargo_bars",
  long_only: "long_only",
  holding_bars: "holding_bars",
  stop_loss_ticks: "stop_loss_ticks",
  take_profit_ticks: "take_profit_ticks",
  contracts: "contracts",
  tuning_mode: "tuning_mode",
  tuning_objective: "tuning_objective",
  tuning_trial_count: "tuning_budget_trials",
  tuning_budget_seconds: "tuning_budget_seconds",
  tuning_inner_fold_count: "tuning_folds",
  tuning_pinned: "tuning_pinned_parameters",
};

/** A recorded run's base parameters and its launch settings, for relaunching it. */
export function baseParametersOf(runId: string): { modelKey: string; symbol: string; timeframe: string; dataStart: number; dataEnd: number; parameters: Record<string, RunParameterValue> } | null {
  const run = db.select().from(cycleRuns).where(eq(cycleRuns.runId, runId)).all()[0];
  if (!run) return null;
  const rows = db
    .select()
    .from(cycleRunConfigurations)
    .where(and(eq(cycleRunConfigurations.runId, runId), eq(cycleRunConfigurations.scope, "base")))
    .all();
  const parameters: Record<string, RunParameterValue> = {};
  const settings = db.select().from(cycleRunSettings).where(eq(cycleRunSettings.runId, runId)).all();
  for (const row of settings) {
    const flag = SETTING_TO_FLAG[row.settingName];
    if (!flag) continue;
    const value = untyped(row.settingValue, row.valueType);
    if (value === null || value === "") continue;
    parameters[flag] = value;
  }
  // the model's own hyperparameters after the settings, so a name clash resolves to the model's value
  for (const row of rows) parameters[row.parameterName] = untyped(row.parameterValue, row.valueType);
  return { modelKey: run.modelKey, symbol: run.symbol, timeframe: run.timeframe, dataStart: run.dataStart, dataEnd: run.dataEnd, parameters };
}

/** The run row (name, version, lineage) for the view. */
export function runRowOf(runId: string): schema.CycleRunRow | null {
  return db.select().from(cycleRuns).where(eq(cycleRuns.runId, runId)).all()[0] ?? null;
}

/** Record a run's parent before its plan arrives (the launch knows it first). */
export function recordLineage(runId: string, parentRunId: string): void {
  pendingParents.set(runId, parentRunId);
}
const pendingParents = new Map<string, string>();
export function takePendingParent(runId: string): string | null {
  const parent = pendingParents.get(runId) ?? null;
  pendingParents.delete(runId);
  return parent;
}
