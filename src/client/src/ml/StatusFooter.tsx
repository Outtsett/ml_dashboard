/**
 * StatusFooter — Bottom strip on /ml-studio.
 *
 * Surfaces the four high-level pipeline indicators that survive across stages:
 *   - Pipeline progress (X / 6 stages complete)
 *   - Active training session (if any)
 *   - Last backtest run id
 *   - Active deployment (if any)
 *
 * No chart, no large interactions — read-only summary so the user can leave
 * a stage and still see what's running.
 */

import { Activity, Brain, FlaskConical, Rocket } from "lucide-react";
import { useTrainingControl } from "@/training/lib/TrainingContext";
import { STAGE_IDS, useMLStudio, type MLStudioPipeline, type StageId } from "./MLStudioContext";

function isStageComplete(stage: StageId, p: MLStudioPipeline): boolean {
  switch (stage) {
    case "data":
      return p.dataPreview != null;
    case "features":
      return p.featurePreview != null;
    case "labels":
      return p.labelPreview != null;
    case "train":
      return p.completedModelId != null;
    case "evaluate":
      return p.lastBacktestRunId != null;
    case "promote":
      return p.activeDeployment != null;
    default:
      return false;
  }
}

interface ChipProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: "neutral" | "active" | "good" | "warn";
}

function Chip({ icon: Icon, label, value, tone }: ChipProps) {
  // `good` is orange (--data-pos), `warn` is yellow (--data-warn), `active` is
  // primary blue. Colorblind-safe: no green-vs-red, and no amber-vs-orange
  // pairing (which collapses under deuteranopia). Each chip also carries an
  // icon and a text value, so tone is never the sole channel.
  const toneClasses = {
    neutral: "border-white/10 text-muted-foreground bg-white/[0.03]",
    active: "border-primary/30 text-primary bg-primary/10",
    good: "border-[hsl(var(--data-pos)/0.35)] text-[hsl(var(--data-pos))] bg-[hsl(var(--data-pos)/0.1)]",
    warn: "border-[hsl(var(--data-warn)/0.35)] text-[hsl(var(--data-warn))] bg-[hsl(var(--data-warn)/0.1)]",
  }[tone];

  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-mono ${toneClasses}`}
    >
      <Icon className="h-3 w-3" />
      <span className="uppercase tracking-wider text-[9px] opacity-70">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

export function StatusFooter() {
  const { state } = useMLStudio();
  const training = useTrainingControl();

  const completedStages = STAGE_IDS.filter((id) => isStageComplete(id, state)).length;
  const lastRunLabel = state.lastBacktestRunId ? `#${state.lastBacktestRunId}` : "—";
  const deployment = state.activeDeployment;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 py-1.5 shrink-0 border-t border-white/5">
      <Chip
        icon={Activity}
        label="Pipeline"
        value={`${completedStages} / ${STAGE_IDS.length} stages`}
        tone={completedStages === STAGE_IDS.length ? "good" : "neutral"}
      />
      <Chip
        icon={Brain}
        label="Training"
        value={training.isTraining ? "live" : "idle"}
        tone={training.isTraining ? "active" : "neutral"}
      />
      <Chip
        icon={FlaskConical}
        label="Last run"
        value={lastRunLabel}
        tone={state.lastBacktestRunId ? "good" : "neutral"}
      />
      <Chip
        icon={Rocket}
        label="Deployment"
        value={
          deployment
            ? `${deployment.mode} · ${deployment.status} · ${deployment.predictionsEmitted} preds`
            : "none"
        }
        tone={
          deployment
            ? deployment.status === "running"
              ? "good"
              : deployment.status === "failed"
                ? "warn"
                : "active"
            : "neutral"
        }
      />
    </div>
  );
}
