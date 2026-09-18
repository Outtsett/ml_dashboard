/**
 * LifecycleStrip — how far a catalog spec has actually got.
 *
 * Think of it as: the row of stamps on a shipping form. Each rung the model has
 * reached is stamped solid; the ones ahead are outlines. Reached-ness is carried
 * by FILL and by the words beside it, never by hue — one colour throughout.
 */

import { Link } from "wouter";
import { LIFECYCLE_STAGES, type CatalogLifecycle, type LifecycleStage } from "@shared/catalogLifecycle";

/** The rungs drawn. `unwritten` is the absence of the first one, not a rung. */
const RUNGS: { stage: LifecycleStage; label: string }[] = [
  { stage: "spec", label: "Spec" },
  { stage: "trainable", label: "Trainable" },
  { stage: "trained", label: "Trained" },
  { stage: "lens_ready", label: "Lens" },
  { stage: "deployed", label: "Deployed" },
];

const STAGE_TEXT: Record<LifecycleStage, string> = {
  unwritten: "Not written",
  spec: "Spec only",
  trainable: "Trainable",
  trained: "Trained",
  lens_ready: "Lens-ready",
  deployed: "Deployed",
};

function reached(current: LifecycleStage, rung: LifecycleStage): boolean {
  return LIFECYCLE_STAGES.indexOf(current) >= LIFECYCLE_STAGES.indexOf(rung);
}

/** "wired · 5 runs, 0 completed" — the facts behind the stage. */
export function lifecycleFacts(lifecycle: CatalogLifecycle): string {
  const facts: string[] = [];
  if (lifecycle.runnerSource) facts.push(lifecycle.runnerSource === "wired" ? "wired runner" : "generates from template");
  if (lifecycle.sessionCount > 0) {
    const runs = `${lifecycle.sessionCount} run${lifecycle.sessionCount === 1 ? "" : "s"}`;
    facts.push(`${runs}, ${lifecycle.completedSessionCount} completed`);
  }
  if (lifecycle.runningDeploymentCount > 0) {
    facts.push(`${lifecycle.runningDeploymentCount} running`);
  }
  return facts.join(" · ");
}

export function LifecycleStrip({ lifecycle }: { lifecycle: CatalogLifecycle }) {
  const facts = lifecycleFacts(lifecycle);
  return (
    <div className="flex items-center gap-2 min-w-0" data-testid="lifecycle-strip" data-stage={lifecycle.stage}>
      <div className="flex items-center gap-0.5 shrink-0" aria-hidden>
        {RUNGS.map(({ stage, label }) => (
          <span
            key={stage}
            title={label}
            className={
              reached(lifecycle.stage, stage)
                ? "h-1.5 w-4 rounded-sm bg-primary"
                : "h-1.5 w-4 rounded-sm border border-muted-foreground/40"
            }
          />
        ))}
      </div>
      <span className="text-[10px] font-mono text-foreground/80 shrink-0">{STAGE_TEXT[lifecycle.stage]}</span>
      {facts && <span className="text-[10px] font-mono text-muted-foreground truncate">{facts}</span>}
    </div>
  );
}

/** The detail-view form: every rung named, with the exits each one opens. */
export function LifecyclePanel({ lifecycle }: { lifecycle: CatalogLifecycle }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2" data-testid="lifecycle-panel">
      <div className="flex items-center gap-1">
        {RUNGS.map(({ stage, label }, i) => {
          const on = reached(lifecycle.stage, stage);
          return (
            <div key={stage} className="flex items-center gap-1">
              {i > 0 && <span className={on ? "h-px w-5 bg-primary" : "h-px w-5 bg-muted-foreground/30"} />}
              <span
                className={
                  on
                    ? "rounded px-2 py-0.5 text-[11px] font-mono bg-primary text-primary-foreground"
                    : "rounded px-2 py-0.5 text-[11px] font-mono border border-dashed border-muted-foreground/40 text-muted-foreground"
                }
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        <span>{lifecycleFacts(lifecycle) || "Nothing has been run against this spec."}</span>
        {lifecycle.lensModelId && (
          <Link
            href={`/lens?model=${encodeURIComponent(lifecycle.lensModelId)}`}
            className="text-primary hover:underline font-mono"
          >
            Open in Lens
          </Link>
        )}
      </div>
    </div>
  );
}
