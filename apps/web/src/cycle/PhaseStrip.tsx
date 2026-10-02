/**
 * The cycle's stepper: Load → Tune (when the plan tuned) → for each fold,
 * Train → Validate → Test, with the live step's detail (epoch/batch, trial,
 * test bar) and an overall progress bar. Reads `useCycleStore` only.
 */
import { Fragment } from "react";
import { ArrowRight, CheckCircle2, CircleDashed, Loader2, SlidersHorizontal } from "lucide-react";

import { cn } from "@/shared/utils/utils";
import { useCycleStore } from "@/cycle/store";
import type { CycleCursor } from "@shared/cycle/schema";

const STEP_UNIT_LABEL: Record<NonNullable<CycleCursor["stepUnit"]>, string> = {
  epoch: "epoch",
  boosting_round: "boosting round",
  tree_batch: "tree batch",
  solver_pass: "solver pass",
  single_fit: "fit",
};

type StepKind = "load" | "tune" | "train" | "validate" | "test";

interface Step {
  kind: StepKind;
  foldIndex: number | null;
  label: string;
}

function buildSteps(foldCount: number, tuning: boolean): Step[] {
  const steps: Step[] = [{ kind: "load", foldIndex: null, label: "Load" }];
  if (tuning) steps.push({ kind: "tune", foldIndex: null, label: "Tune" });
  for (let fold = 0; fold < foldCount; fold += 1) {
    steps.push({ kind: "train", foldIndex: fold, label: "Train" });
    steps.push({ kind: "validate", foldIndex: fold, label: "Validate" });
    steps.push({ kind: "test", foldIndex: fold, label: "Test" });
  }
  return steps;
}

/**
 * `completedFolds` = folds that reported a fold scoreboard. A completed run
 * marks every step done; a stopped or failed one only the steps it finished —
 * it used to tick every fold, including the ones it never reached.
 */
function stepStatus(
  step: Step,
  cursor: CycleCursor | null,
  completedFolds: number,
  planLoaded: boolean,
): "done" | "active" | "pending" {
  if (!cursor) return "pending";
  const phaseOrder: StepKind[] = ["load", "tune", "train", "validate", "test"];
  const phaseKind: StepKind =
    cursor.phase === "loading"
      ? "load"
      : cursor.phase === "tuning"
        ? "tune"
        : cursor.phase === "training"
          ? "train"
          : cursor.phase === "validating"
            ? "validate"
            : cursor.phase === "testing"
              ? "test"
              : "test"; // complete/stopped/failed: everything before is done

  if (cursor.phase === "complete") return "done";
  if (cursor.phase === "stopped" || cursor.phase === "failed") {
    // Loading finished once a plan exists; tuning once any fold began.
    if (step.kind === "load") return planLoaded ? "done" : "pending";
    if (step.kind === "tune") return completedFolds > 0 || cursor.foldIndex !== null ? "done" : "pending";
    return step.foldIndex !== null && step.foldIndex < completedFolds ? "done" : "pending";
  }

  if (step.kind === "load" || step.kind === "tune") {
    if (phaseOrder.indexOf(phaseKind) > phaseOrder.indexOf(step.kind)) return "done";
    if (phaseKind === step.kind) return "active";
    return "pending";
  }

  // Per-fold steps: compare fold index first, then phase within the same fold.
  if (step.foldIndex === null) return "pending";
  // No fold yet means loading or tuning, which come before every fold.
  if (cursor.foldIndex === null) return "pending";
  if (step.foldIndex < cursor.foldIndex) return "done";
  if (step.foldIndex > cursor.foldIndex) return "pending";
  if (phaseKind === "load" || phaseKind === "tune") return "pending"; // still loading/tuning, hasn't reached this fold's steps
  const foldPhaseOrder: StepKind[] = ["train", "validate", "test"];
  const current = foldPhaseOrder.indexOf(phaseKind);
  const mine = foldPhaseOrder.indexOf(step.kind);
  if (mine < current) return "done";
  if (mine === current) return "active";
  return "pending";
}

function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

function formatBarTime(epochSeconds: number): string {
  // UTC, like the chart axis and the trades table: the lake stores futures
  // bars as Pacific wall-clock labelled UTC, so this is the stored clock.
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function PhaseStrip() {
  const plan = useCycleStore((state) => state.plan);
  const cursor = useCycleStore((state) => state.cursor);
  const completedFolds = useCycleStore((state) => state.folds.length);

  const foldCount = plan?.folds.length ?? cursor?.foldCount ?? 0;
  const steps = buildSteps(foldCount, plan?.tuning != null);

  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        {steps.map((step, index) => {
          const status = stepStatus(step, cursor, completedFolds, plan !== null);
          const isNewFold = step.kind === "train" && steps[index - 1]?.kind !== "tune" && steps[index - 1]?.kind !== "load";
          return (
            <Fragment key={`${step.kind}-${step.foldIndex ?? "x"}-${index}`}>
              {index > 0 && <ArrowRight className="h-3 w-3 shrink-0 text-neutral-600" aria-hidden="true" />}
              {isNewFold && step.foldIndex !== null && (
                <span className="mr-1 shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500">
                  fold {step.foldIndex + 1} of {foldCount}
                </span>
              )}
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-medium",
                  status === "active" && "border-[#E69F00] bg-[#E69F00]/15 text-[#E69F00]",
                  status === "done" && "border-[#009E73]/40 bg-[#009E73]/10 text-[#009E73]",
                  status === "pending" && "border-white/10 text-neutral-500",
                )}
              >
                {status === "done" && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
                {status === "active" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                {status === "pending" && <CircleDashed className="h-3 w-3" aria-hidden="true" />}
                {step.label}
              </span>
            </Fragment>
          );
        })}
        {cursor?.paused && (
          <span className="ml-2 shrink-0 rounded-full border border-[#F0E442]/50 bg-[#F0E442]/10 px-2 py-0.5 text-[10px] font-semibold text-[#F0E442]">
            PAUSED
          </span>
        )}
      </div>

      {cursor && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-400">
          {cursor.phase === "training" && cursor.epoch !== null && cursor.epochCount !== null && (
            <span className="font-mono">
              {cursor.stepUnit ? STEP_UNIT_LABEL[cursor.stepUnit] : "step"} {cursor.epoch}/{cursor.epochCount}
              {cursor.batch !== null && cursor.batchCount !== null && ` · batch ${cursor.batch}/${cursor.batchCount}`}
            </span>
          )}
          {(cursor.phase === "training" || cursor.phase === "validating") && cursor.modelRole === "price" && (
            <span className="rounded border border-[#CC79A7]/50 px-1.5 py-0.5 font-mono text-[10px] text-[#CC79A7]" data-testid="phase-model-role">
              price model
            </span>
          )}
          {cursor.phase === "tuning" && cursor.trial !== null && cursor.trialCount !== null && (
            <span className="flex items-center gap-1 font-mono">
              <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
              trial {cursor.trial + 1}/{cursor.trialCount}
            </span>
          )}
          {cursor.phase === "testing" && cursor.barIndex !== null && cursor.barCount !== null && (
            <span className="font-mono">
              bar {cursor.barIndex}/{cursor.barCount}
              {cursor.barTimestamp !== null && ` · ${formatBarTime(cursor.barTimestamp)}`}
            </span>
          )}
          <span className="font-mono">elapsed {formatElapsed(cursor.elapsedSeconds)}</span>
        </div>
      )}

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-[#E69F00] transition-[width]"
          style={{ width: `${Math.round((cursor?.overallFraction ?? 0) * 100)}%` }}
        />
      </div>
    </div>
  );
}
