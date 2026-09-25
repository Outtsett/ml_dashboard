/**
 * CycleCurves — loss curves for one fold's training (`store.epochs` where
 * `trial === null`), and the Optuna tuning scatter + trial table
 * (`store.trials`) when tuning ran.
 */
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { useCycleStore } from "@/cycle/store";
import { formatRatio } from "@/cycle/format";
import type { CycleEpoch, CycleTrial } from "@shared/cycle/schema";
import { cn } from "@/shared/utils/utils";

const STEP_UNIT_LABEL: Record<NonNullable<CycleEpoch["stepUnit"]>, string> = {
  epoch: "Epoch",
  boosting_round: "Boosting round",
  tree_batch: "Tree batch",
  solver_pass: "Solver pass",
};

const OBJECTIVE_LABEL: Record<CycleTrial["objectiveName"], string> = {
  sharpe_ratio: "Sharpe ratio",
  log_loss: "Log loss",
  f1_score: "F1 score",
};

function LossCurves({ epochs }: { epochs: CycleEpoch[] }) {
  const stepUnit = epochs[0]?.stepUnit ?? "epoch";
  const bestEpoch = epochs.find((e) => e.isBest)?.epoch ?? null;
  const rows = epochs.map((e) => ({
    step: e.epoch,
    trainLoss: e.trainLoss,
    validationLoss: e.validationLoss,
    validationAccuracy: e.validationAccuracy,
    validationF1Score: e.validationF1Score,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="h-56 w-full" data-testid="curves-loss-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
            <XAxis dataKey="step" tick={{ fontSize: 10 }} label={{ value: STEP_UNIT_LABEL[stepUnit], position: "insideBottom", offset: -4, fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} label={{ value: "Loss", angle: -90, position: "insideLeft", fontSize: 10 }} />
            <Tooltip formatter={(value) => formatRatio(typeof value === "number" ? value : null)} labelFormatter={(step) => `${STEP_UNIT_LABEL[stepUnit]} ${step}`} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="trainLoss" name="Train loss" stroke="#56B4E9" strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="validationLoss" name="Validation loss" stroke="#E69F00" strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls />
            {bestEpoch !== null && (
              <ReferenceLine x={bestEpoch} stroke="#CC79A7" strokeWidth={1.5} label={{ value: `Best (${bestEpoch})`, fontSize: 10, fill: "#CC79A7", position: "top" }} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="h-40 w-full" data-testid="curves-accuracy-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
            <XAxis dataKey="step" tick={{ fontSize: 10 }} label={{ value: STEP_UNIT_LABEL[stepUnit], position: "insideBottom", offset: -4, fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} domain={[0, 1]} label={{ value: "Score", angle: -90, position: "insideLeft", fontSize: 10 }} />
            <Tooltip formatter={(value) => formatRatio(typeof value === "number" ? value : null)} labelFormatter={(step) => `${STEP_UNIT_LABEL[stepUnit]} ${step}`} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="validationAccuracy" name="Validation accuracy" stroke="#009E73" strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="validationF1Score" name="Validation F1" stroke="#CC79A7" strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TuningScatter({ trials }: { trials: CycleTrial[] }) {
  const bestTrial = trials.length > 0 ? trials[trials.length - 1]!.bestTrial : null;
  const objectiveName = trials[0]?.objectiveName ?? "sharpe_ratio";
  const complete = trials.filter((t) => t.state === "complete" && t.trial !== bestTrial);
  const best = trials.filter((t) => t.trial === bestTrial);
  const pruned = trials.filter((t) => t.state === "pruned");
  const failed = trials.filter((t) => t.state === "failed");
  const running = trials.filter((t) => t.state === "running");

  const toPoint = (t: CycleTrial) => ({ trial: t.trial, objective: t.objectiveValue });

  return (
    <div className="h-56 w-full" data-testid="curves-tuning-scatter">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
          <XAxis type="number" dataKey="trial" name="Trial number" tick={{ fontSize: 10 }} label={{ value: "Trial number", position: "insideBottom", offset: -4, fontSize: 10 }} />
          <YAxis type="number" dataKey="objective" name={OBJECTIVE_LABEL[objectiveName]} tick={{ fontSize: 10 }} label={{ value: `Objective value (${OBJECTIVE_LABEL[objectiveName]})`, angle: -90, position: "insideLeft", fontSize: 10 }} />
          <ZAxis range={[40, 40]} />
          <Tooltip formatter={(value) => formatRatio(typeof value === "number" ? value : null)} />
          <Scatter data={complete.map(toPoint)} name="Complete" fill="#56B4E9" />
          <Scatter data={running.map(toPoint)} name="Running" fill="#8A8F98" />
          <Scatter data={pruned.map(toPoint)} name="Pruned" fill="none" stroke="#8A8F98" strokeWidth={1.5} />
          <Scatter data={failed.map(toPoint)} name="Failed" fill="#D55E00" />
          <Scatter data={best.map(toPoint)} name="Best" fill="#CC79A7" shape="star" />
          <Legend wrapperStyle={{ fontSize: 10 }} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function TuningTable({ trials }: { trials: CycleTrial[] }) {
  const parameterKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const trial of trials) for (const key of Object.keys(trial.parameters)) keys.add(key);
    return Array.from(keys).sort();
  }, [trials]);
  const sorted = useMemo(() => [...trials].sort((a, b) => a.trial - b.trial), [trials]);

  return (
    <div className="max-h-56 overflow-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead className="sticky top-0 bg-card/95">
          <tr className="border-b border-border/40">
            <th className="px-2 py-1 text-left font-semibold uppercase tracking-wide text-muted-foreground">Trial</th>
            <th className="px-2 py-1 text-left font-semibold uppercase tracking-wide text-muted-foreground">State</th>
            <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide text-muted-foreground">Objective</th>
            {parameterKeys.map((key) => (
              <th key={key} className="px-2 py-1 text-right font-semibold uppercase tracking-wide text-muted-foreground">
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((trial) => (
            <tr key={trial.trial} data-testid="tuning-trial-row" className="border-b border-border/20">
              <td className="px-2 py-1 font-mono tabular-nums">{trial.trial}</td>
              <td className="px-2 py-1 capitalize">{trial.state}</td>
              <td className="px-2 py-1 text-right font-mono tabular-nums">{formatRatio(trial.objectiveValue)}</td>
              {parameterKeys.map((key) => (
                <td key={key} className="px-2 py-1 text-right font-mono tabular-nums">
                  {String(trial.parameters[key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CycleCurves() {
  const cursor = useCycleStore((s) => s.cursor);
  const epochs = useCycleStore((s) => s.epochs);
  const trials = useCycleStore((s) => s.trials);

  const trainingEpochs = useMemo(() => epochs.filter((e) => e.trial === null), [epochs]);
  const foldIndexes = useMemo(() => {
    const set = new Set<number>();
    for (const e of trainingEpochs) if (e.foldIndex !== null) set.add(e.foldIndex);
    return Array.from(set).sort((a, b) => a - b);
  }, [trainingEpochs]);

  const [selectedFold, setSelectedFold] = useState<number | null>(null);
  const activeFold = selectedFold !== null && foldIndexes.includes(selectedFold) ? selectedFold : (cursor?.foldIndex !== null && cursor?.foldIndex !== undefined && foldIndexes.includes(cursor.foldIndex) ? cursor.foldIndex : (foldIndexes[foldIndexes.length - 1] ?? null));

  const foldEpochs = useMemo(() => trainingEpochs.filter((e) => e.foldIndex === activeFold), [trainingEpochs, activeFold]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-2">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Loss curves</h3>
          {foldIndexes.length > 0 && (
            <div className="flex gap-1">
              {foldIndexes.map((index) => (
                <button
                  key={index}
                  type="button"
                  data-testid={`curves-fold-${index}`}
                  onClick={() => setSelectedFold(index)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    activeFold === index ? "border-primary bg-primary/15 text-primary-foreground" : "border-border/50 text-muted-foreground",
                  )}
                >
                  Fold {index + 1}
                </button>
              ))}
            </div>
          )}
        </div>
        {foldEpochs.length > 0 ? (
          <LossCurves epochs={foldEpochs} />
        ) : (
          <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">No training steps recorded yet for this fold.</div>
        )}
      </div>

      {trials.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Hyperparameter tuning</h3>
          <TuningScatter trials={trials} />
          <TuningTable trials={trials} />
        </div>
      )}
    </div>
  );
}
