/**
 * StageStepper — Top of /ml-studio. Renders the 6-stage linear pipeline.
 *
 * Each stage is clickable but visually communicates whether it's gated by a
 * missing prerequisite (faded + tooltip). Completion is computed from the
 * pipeline state in MLStudioContext.
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { Check, Database, Layers, Tag, Brain, FlaskConical, Rocket } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  STAGE_IDS,
  STAGE_LABELS,
  isStageComplete,
  useMLStudio,
  type StageId,
} from "./MLStudioContext";

const STAGE_ICONS: Record<StageId, LucideIcon> = {
  data: Database,
  features: Layers,
  labels: Tag,
  train: Brain,
  evaluate: FlaskConical,
  promote: Rocket,
};

export function StageStepper() {
  const { state, dispatch, gates } = useMLStudio();
  const activeStage = state.activeStage;

  return (
    <nav
      className="flex items-center gap-2 px-1 py-3 shrink-0 overflow-x-auto scrollbar-hidden"
      aria-label="ML Studio pipeline stages"
    >
      {STAGE_IDS.map((id, idx) => {
        const Icon = STAGE_ICONS[id];
        const label = STAGE_LABELS[id];
        const gate = gates[id];
        const complete = isStageComplete(id, state);
        const active = activeStage === id;
        const disabled = !gate.ready && !complete && !active;

        // Complete is orange (--data-pos), active is primary blue — the
        // colorblind-safe pair. Never green-vs-blue, which collapses for a
        // deuteranope. The Check icon carries completion independently of hue.
        const numberCircleClasses = [
          "flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-semibold transition-colors",
          complete
            ? "bg-[hsl(var(--data-pos)/0.18)] text-[hsl(var(--data-pos))] border border-[hsl(var(--data-pos)/0.35)]"
            : active
              ? "bg-primary/25 text-primary border border-primary/40"
              : disabled
                ? "bg-white/5 text-muted-foreground/40 border border-white/5"
                : "bg-white/5 text-muted-foreground border border-white/10",
        ].join(" ");

        // `stage-active` carries the accent edge bar; the raised surface and
        // glow are reinforcement. The previous treatment separated active from
        // inactive by ring opacity alone, which is close to invisible at a
        // glance across six adjacent chips.
        const buttonClasses = [
          "group flex items-center gap-2 pl-3 pr-3 py-2 rounded-lg border shrink-0 transition-all motion-quick",
          active
            ? "stage-active"
            : disabled
              ? "surface-sunken text-muted-foreground/50 cursor-not-allowed"
              : "surface-interactive",
        ].join(" ");

        const handleClick = () => {
          dispatch({ type: "setActiveStage", stage: id });
        };

        const tooltipText = !gate.ready && !complete ? gate.reason : null;

        const button = (
          <button
            key={id}
            type="button"
            onClick={handleClick}
            disabled={false /* allow skip-ahead per design — gating is informational */}
            className={buttonClasses}
            aria-current={active ? "step" : undefined}
          >
            <span className={numberCircleClasses}>
              {complete ? <Check className="h-3 w-3" /> : idx + 1}
            </span>
            <span className="flex flex-col items-start leading-tight">
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
                Stage {idx + 1}
              </span>
              <span
                className={
                  active
                    ? "text-xs font-semibold text-foreground"
                    : disabled
                      ? "text-xs font-medium text-muted-foreground/50"
                      : "text-xs font-medium text-foreground/85"
                }
              >
                <Icon className="inline h-3 w-3 mr-1 -mt-0.5" />
                {label}
              </span>
            </span>
          </button>
        );

        return (
          <div key={id} className="flex items-center gap-2 shrink-0">
            {tooltipText ? (
              <Tooltip>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent>
                  <span className="text-xs">{tooltipText}</span>
                </TooltipContent>
              </Tooltip>
            ) : (
              button
            )}
            {idx < STAGE_IDS.length - 1 && (
              <span
                className={
                  isStageComplete(id, state)
                    ? "h-px w-4 bg-[hsl(var(--data-pos)/0.45)]"
                    : "h-px w-4 bg-white/10"
                }
                aria-hidden
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
