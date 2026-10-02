/**
 * Section 4: the landed forecasting results. Four targets, 34 causal
 * path-geometry features, ridge and gradient boosting, 5 purged walk-forward
 * folds; every number here is a row of derived_study_path_geometry_study_{targets,folds}.
 */

import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Empty, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, Stat, SwitchControl, TOOLTIP, fmt, fmtInt,
} from "@/studies/kit";
import {
  TARGET_MEANING, TARGETS, UNCORRELATED_PERSISTENCE_R_SQUARED, intervalVerdict, skillOverBaseline,
  type FoldRow, type PathGeometryBody, type TargetRow,
} from "@shared/studies/path-geometry-study";
import type { Controls, Setter } from "./controls";
import { SymlogIntervalChart, type IntervalRow } from "./charts";
import { useState } from "react";

const TARGET_COLOURS: Record<string, string> = {
  fwd_er_vs_rw: OKABE.orange,
  fwd_tbeta: OKABE.sky,
  fwd_r2: OKABE.blue,
  fwd_abs_tbeta: OKABE.purple,
};

function scientific(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return Math.abs(value) < 0.001 || Math.abs(value) >= 1000 ? value.toExponential(digits) : value.toFixed(5);
}

function yesNo(value: unknown): string {
  return value === true ? "yes" : value === false ? "no" : "—";
}

interface ModelView {
  prefix: "ridge" | "gradient_boosting";
  name: string;
}

function columnOf<Row extends object>(row: Row, key: string): number | null {
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function Results({ body, controls, set }: { body: PathGeometryBody; controls: Controls; set: Setter }) {
  const [foldPicked, setFoldPicked] = useState(1);
  const [clipCorrelation, setClipCorrelation] = useState(true);
  const { targets, folds } = body;
  if (targets.length === 0) {
    return (
      <Section title="4 · The result: four targets, all null">
        <Empty>
          The forecasting results are not in the lake yet. Land them with <span className="font-mono">packages/ml-engine/src/studies/path_geometry_study/build.py</span>, then refresh the derived views.
        </Empty>
      </Section>
    );
  }

  const model: ModelView = controls.model === "gradient_boosting" ? { prefix: "gradient_boosting", name: "gradient boosting" } : { prefix: "ridge", name: "ridge" };
  const orderedTargets = TARGETS.map((target) => targets.find((row) => row.target === target)).filter((row): row is TargetRow => row !== undefined);
  const target = orderedTargets.find((row) => row.target === controls.target) ?? orderedTargets[0] ?? (targets[0] as TargetRow);
  const targetFolds = folds.filter((row) => row.target === target.target);
  const foldCount = targetFolds.length;
  const foldNumber = Math.min(Math.max(1, foldPicked), Math.max(1, foldCount));
  const fold = targetFolds.find((row) => row.fold === foldNumber);

  const intervalRows: IntervalRow[] = orderedTargets.map((row) => {
    const low = columnOf(row, `${model.prefix}_diebold_mariano_interval_low`) ?? 0;
    const high = columnOf(row, `${model.prefix}_diebold_mariano_interval_high`) ?? 0;
    const verdict = intervalVerdict(low, high);
    return {
      key: row.target,
      label: row.target,
      low,
      high,
      mean: columnOf(row, `${model.prefix}_diebold_mariano_mean_loss_differential`),
      note: `${model.name}: interval ${verdict}; ${fmtInt(columnOf(row, `${model.prefix}_diebold_mariano_effective_sample_size`))} effective observations`,
    };
  });
  const below = intervalRows.filter((row) => row.high < 0).map((row) => row.key);
  const spanning = intervalRows.filter((row) => row.low <= 0 && row.high >= 0).map((row) => row.key);
  const above = intervalRows.filter((row) => row.low > 0).map((row) => row.key);

  const foldSkillRows = Array.from({ length: Math.max(...folds.map((row) => row.fold), 0) }, (_, index) => {
    const row: Record<string, number | null> = { fold: index + 1 };
    for (const entry of orderedTargets) {
      const match = folds.find((candidate) => candidate.target === entry.target && candidate.fold === index + 1);
      row[entry.target] = match ? columnOf(match, `${model.prefix}_skill`) : null;
    }
    return row;
  });
  const consistentTargets = orderedTargets
    .filter((entry) => {
      const rows = folds.filter((candidate) => candidate.target === entry.target);
      return rows.length > 0 && rows.every((row) => (columnOf(row, `${model.prefix}_skill`) ?? 0) > 0);
    })
    .map((entry) => entry.target);
  const falsePositives = orderedTargets
    .filter((entry) => (entry as Record<string, unknown>)[`${model.prefix}_beats_baseline_fold_level`] === true && (entry as Record<string, unknown>)[`${model.prefix}_diebold_mariano_beats_baseline`] !== true)
    .map((entry) => entry.target);
  const headToHead = targetFolds.map((row: FoldRow) => ({ fold: row.fold, ridge: row.ridge_r_squared, boosting: row.gradient_boosting_r_squared }));
  const boostingLoses = targetFolds.filter((row) => row.gradient_boosting_r_squared < row.ridge_r_squared).length;
  const persistenceRows = targetFolds.map((row) => ({
    fold: row.fold,
    persistence: row.persistence_r_squared,
    correlation: clipCorrelation ? Math.max(-0.06, Math.min(0.06, row.persistence_target_correlation)) : row.persistence_target_correlation,
    rawCorrelation: row.persistence_target_correlation,
  }));
  const persistenceMin = Math.min(...targetFolds.map((row) => row.persistence_r_squared));
  const persistenceMax = Math.max(...targetFolds.map((row) => row.persistence_r_squared));
  const correlationMin = Math.min(...targetFolds.map((row) => row.persistence_target_correlation));
  const correlationMax = Math.max(...targetFolds.map((row) => row.persistence_target_correlation));

  const modelRSquared = fold ? columnOf(fold, `${model.prefix}_r_squared`) : null;
  const computedSkill = fold && modelRSquared !== null ? skillOverBaseline(modelRSquared, fold.persistence_r_squared, fold.train_mean_r_squared) : null;
  const storedSkill = fold ? columnOf(fold, `${model.prefix}_skill`) : null;

  const rowCountRange = [Math.min(...targets.map((row) => row.training_row_count)), Math.max(...targets.map((row) => row.training_row_count))];

  return (
    <Section
      title="4 · The result: four targets, all null"
      question={`Each target is forecast ${target.horizon_bars} bars ahead from ${target.feature_count} causal path-geometry features, on ${fmtInt(rowCountRange[0])}${rowCountRange[0] === rowCountRange[1] ? "" : ` to ${fmtInt(rowCountRange[1])}`} rows across ${target.fold_count} purged walk-forward folds (purge ${fmtInt(target.purge_bars)} bars). The headline is skill against the best trivial predictor, and the authoritative interval is the bar-level Diebold-Mariano circular block bootstrap, not the ${target.fold_count}-fold spread.`}
    >
      <ControlBar>
        <SegmentControl label="Model" value={controls.model} options={[{ value: "ridge", label: "ridge" }, { value: "gradient_boosting", label: "gradient boosting" }]} onChange={(value) => set("model", value)} />
        <SegmentControl label="Target (fold panels)" value={target.target} options={orderedTargets.map((row) => ({ value: row.target, label: row.target.replace("fwd_", "") }))} onChange={(value) => set("target", value)} hint={TARGET_MEANING[target.target as keyof typeof TARGET_MEANING] ?? ""} />
      </ControlBar>
      <p className="mt-1 text-[11px] text-neutral-400">
        <span style={{ color: OKABE.orange }}>{target.target}</span>: {TARGET_MEANING[target.target as keyof typeof TARGET_MEANING] ?? "a path-geometry target"}.
      </p>

      <div className="mt-2 grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Targets beating the baseline (bar level)" value={`${orderedTargets.filter((row) => row.verdict_beats_baseline_bar_level).length} of ${orderedTargets.length}`} tone={OKABE.blue} hint="verdict.beats_baseline_bar_level: the Diebold-Mariano interval excludes zero on the good side" />
        <Stat label={`Intervals below zero (${model.name})`} value={`${below.length} of ${intervalRows.length}`} tone={below.length > 0 ? OKABE.blue : undefined} hint={below.join(", ") || "none"} />
        <Stat label="Intervals spanning zero" value={`${spanning.length} of ${intervalRows.length}`} hint={spanning.join(", ") || "none"} />
        <Stat label="Intervals above zero" value={`${above.length} of ${intervalRows.length}`} hint={above.join(", ") || "none"} />
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[11px] font-mono tnum">
          <thead>
            <tr className="text-neutral-500">
              {["target", "rows", `${model.name} R²`, "skill", "fold interval 95%", "folds > 0", "Diebold-Mariano interval 95%", "block", "effective n", "interval vs 0", "beats: fold / bar"].map((heading) => (
                <th key={heading} className="py-0.5 pr-3 text-right font-normal first:text-left">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderedTargets.map((row) => {
              const low = columnOf(row, `${model.prefix}_diebold_mariano_interval_low`);
              const high = columnOf(row, `${model.prefix}_diebold_mariano_interval_high`);
              const foldLow = columnOf(row, `${model.prefix}_skill_fold_interval_low`);
              const foldHigh = columnOf(row, `${model.prefix}_skill_fold_interval_high`);
              const foldBeats = (row as Record<string, unknown>)[`${model.prefix}_beats_baseline_fold_level`];
              const barBeats = (row as Record<string, unknown>)[`${model.prefix}_diebold_mariano_beats_baseline`];
              return (
                <tr key={row.target} className="border-t border-neutral-900">
                  <td className="py-0.5 pr-3 text-left text-neutral-100"><span style={{ color: TARGET_COLOURS[row.target] ?? OKABE.grey }}>■ </span>{row.target}</td>
                  <td className="py-0.5 pr-3 text-right text-neutral-400">{fmtInt(row.training_row_count)}</td>
                  <td className="py-0.5 pr-3 text-right">{scientific(columnOf(row, `${model.prefix}_r_squared_median`))}</td>
                  <td className="py-0.5 pr-3 text-right text-neutral-100">{scientific(columnOf(row, `${model.prefix}_skill_median`))}</td>
                  <td className="py-0.5 pr-3 text-right">[{scientific(foldLow)}, {scientific(foldHigh)}]</td>
                  <td className="py-0.5 pr-3 text-right">{columnOf(row, `${model.prefix}_folds_with_positive_skill`)}/{row.fold_count}</td>
                  <td className="py-0.5 pr-3 text-right">[{scientific(low)}, {scientific(high)}]</td>
                  <td className="py-0.5 pr-3 text-right text-neutral-400">{fmtInt(columnOf(row, `${model.prefix}_diebold_mariano_block_length`))}</td>
                  <td className="py-0.5 pr-3 text-right text-neutral-400">{fmtInt(columnOf(row, `${model.prefix}_diebold_mariano_effective_sample_size`))}</td>
                  <td className="py-0.5 pr-3 text-right">{intervalVerdict(low, high)}</td>
                  <td className="py-0.5 pr-3 text-right">{yesNo(foldBeats)} / {yesNo(barBeats)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-medium text-neutral-300">Bar-level Diebold-Mariano interval on the mean loss differential ({model.name})</p>
          <SymlogIntervalChart rows={intervalRows} xLabel="mean loss differential interval (symlog axis)" />
          <p className="text-[11px] text-neutral-400">◆ interval midpoint, | mean differential, dashed line is zero. <span style={{ color: OKABE.blue }}>blue</span> entirely below zero, <span style={{ color: OKABE.sky }}>sky</span> spans zero, <span style={{ color: OKABE.orange }}>orange</span> entirely above.</p>
          <Finding>
            {below.length > 0
              ? `${below.join(" and ")} sit entirely below zero: for ${below.length === 1 ? "that target" : "those targets"} ${model.name} is not merely uninformative, it is worse than the best trivial predictor. `
              : `No ${model.name} interval sits entirely below zero. `}
            {spanning.length > 0 ? `${spanning.join(", ")} span zero: indistinguishable from the trivial predictor. ` : ""}
            {above.length > 0 ? `${above.join(", ")} sit above zero. ` : "None sits above zero, so no target beats the trivial baseline."}
          </Finding>
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-medium text-neutral-300">Skill by fold ({model.name}), every target</p>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={foldSkillRows} margin={{ top: 6, right: 10, left: 0, bottom: 14 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="fold" {...AXIS} label={{ value: "walk-forward fold", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
              <YAxis {...AXIS} width={56} tickFormatter={(value: number) => scientific(value, 1)} />
              <Tooltip {...TOOLTIP} formatter={(value, name) => [scientific(Number(value), 3), String(name)]} labelFormatter={(label) => `fold ${label}`} />
              <Legend verticalAlign="top" height={22} wrapperStyle={{ fontSize: 10 }} />
              <ReferenceLine y={0} stroke="#d4d4d4" />
              {orderedTargets.map((row) => (
                <Bar key={row.target} dataKey={row.target} fill={TARGET_COLOURS[row.target] ?? OKABE.grey} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <Finding>
            {consistentTargets.length === 0
              ? "No target has positive skill on every fold: the sign flips from fold to fold, which is what noise looks like."
              : `${consistentTargets.join(", ")} has positive skill on every fold, so look at its bar-level interval before reading anything into it.`}
            {falsePositives.length > 0 && ` ${falsePositives.join(", ")} passes the fold-level test (${model.name}) while its bar-level interval spans zero: five anchored folds share the same regime, so the fold spread overstates certainty and the bar-level interval is the one to trust.`}
          </Finding>
        </div>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-medium text-neutral-300">{target.target}: ridge against gradient boosting, out-of-sample R² per fold</p>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={headToHead} margin={{ top: 6, right: 10, left: 0, bottom: 14 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="fold" {...AXIS} label={{ value: "walk-forward fold", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
              <YAxis {...AXIS} width={56} tickFormatter={(value: number) => scientific(value, 1)} />
              <Tooltip {...TOOLTIP} formatter={(value, name) => [scientific(Number(value), 3), String(name)]} labelFormatter={(label) => `fold ${label}`} />
              <Legend verticalAlign="top" height={22} wrapperStyle={{ fontSize: 10 }} />
              <ReferenceLine y={0} stroke="#d4d4d4" />
              <Bar dataKey="ridge" name="ridge" fill={OKABE.orange} isAnimationActive={false} />
              <Bar dataKey="boosting" name="gradient boosting" fill={OKABE.blue} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <Finding>
            Gradient boosting scores below ridge on {boostingLoses} of {foldCount} folds for {target.target}. At {fmtInt(target.training_row_count)} rows and {target.feature_count} features that is the signature of fitting noise rather than interactions.
          </Finding>
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-medium text-neutral-300">{target.target}: the persistence baseline, per fold</p>
          <ControlBar>
            <SwitchControl label="Clip correlation to ±0.06" checked={clipCorrelation} onChange={setClipCorrelation} />
          </ControlBar>
          <div className="grid grid-cols-2 gap-2">
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={persistenceRows} margin={{ top: 6, right: 6, left: 0, bottom: 14 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="fold" {...AXIS} label={{ value: "fold", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis {...AXIS} width={40} tickFormatter={(value: number) => fmt(value, 2)} />
                <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 4)} labelFormatter={(label) => `fold ${label}`} />
                <ReferenceLine y={UNCORRELATED_PERSISTENCE_R_SQUARED} stroke="#d4d4d4" strokeDasharray="6 3" />
                <Bar dataKey="persistence" name="R² of persistence" fill={OKABE.blue} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={persistenceRows} margin={{ top: 6, right: 6, left: 0, bottom: 14 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="fold" {...AXIS} label={{ value: "fold", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis domain={clipCorrelation ? [-0.06, 0.06] : ["auto", "auto"]} allowDataOverflow {...AXIS} width={44} tickFormatter={(value: number) => fmt(value, 3)} />
                <Tooltip {...TOOLTIP} formatter={(_value, _name, item) => [fmt((item.payload as { rawCorrelation: number }).rawCorrelation, 4), "corr(trailing, forward)"]} labelFormatter={(label) => `fold ${label}`} />
                <ReferenceLine y={0} stroke="#d4d4d4" />
                <Bar dataKey="correlation" name="corr(trailing, forward)" fill={OKABE.orange} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Finding>
            Persistence scores R² between {fmt(persistenceMin, 3)} and {fmt(persistenceMax, 3)} across folds. An uncorrelated predictor carrying the target&apos;s own mean and variance scores exactly −1, so this is a diagnostic reading, not a bad baseline: the correlation between the trailing and the forward value runs only {fmt(correlationMin, 3)} to {fmt(correlationMax, 3)}.
          </Finding>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <SegmentControl label={`Fold of ${target.target}`} value={foldNumber} options={targetFolds.map((row) => ({ value: row.fold, label: String(row.fold) }))} onChange={setFoldPicked} />
        <FormulaCard
          tex={"\\text{skill}=R^2(\\text{model})-\\max\\!\\big(R^2(\\text{persistence}),\\,R^2(\\text{train mean})\\big)"}
          caption={`Fold ${foldNumber} of ${target.target}, ${model.name}: the stored skill is ${scientific(storedSkill, 6)}; recomputed here ${scientific(computedSkill, 6)}. The maximum is required: scored against persistence alone, any constant would be handed a free +1.00 of skill for predicting the mean.`}
          symbols={[
            { tex: "\\text{skill}", name: "out-of-sample R² gained over the best trivial predictor", value: scientific(computedSkill, 6) },
            { tex: "R^2(\\text{model})", name: `out-of-sample R² of ${model.name} on this fold`, value: scientific(modelRSquared, 6) },
            { tex: "R^2(\\text{persistence})", name: "R² of copying the trailing value of the target", value: scientific(fold?.persistence_r_squared, 6) },
            { tex: "R^2(\\text{train mean})", name: "R² of predicting the training-slice mean", value: scientific(fold?.train_mean_r_squared, 6) },
            { tex: "n_{\\text{test}}", name: "bars scored on this fold", value: fmtInt(fold?.test_row_count) },
          ]}
        />
      </div>
      <Finding>
        {target.verdict_note}
      </Finding>
      <Finding>
        Verdict: path geometry separates a ramp from a scribble in sample (sections 1 and 2) but carries no forward information at a {target.horizon_bars}-bar horizon on 1m bars: {orderedTargets.filter((row) => !row.verdict_beats_baseline_bar_level).length} of {orderedTargets.length} targets do not beat the trivial baseline at bar level. The untested axes are horizon (240, 1440) and timeframe, where every measured edge on this instrument has historically been found.
      </Finding>
    </Section>
  );
}
