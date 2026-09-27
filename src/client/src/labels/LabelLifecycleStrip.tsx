/**
 * LabelLifecycleStrip — how far a label set has actually got.
 *
 * Think of it as: the row of stamps on a shipping form, the same form the
 * model catalog uses (`ml/LifecycleStrip.tsx`). Each rung reached is stamped
 * solid; the ones ahead are outlines. `stale` and `retired` sit beside the
 * ladder as words, because they are states, not rungs. Reached-ness is carried
 * by FILL and by the words, never by hue.
 */
import { LABEL_LIFECYCLE_RUNGS, type LabelLifecycleStage, type LabelSetLifecycle } from "@shared/labels/contract";

const RUNG_LABEL: Record<LabelLifecycleStage, string> = {
  specified: "Specified",
  generated: "Generated",
  validated: "Validated",
  landed: "Landed",
  cataloged: "Cataloged",
  consumed: "Consumed",
  stale: "Stale",
  retired: "Retired",
};

export const STAGE_TEXT: Record<LabelLifecycleStage, string> = {
  specified: "Specified",
  generated: "Generated, not validated",
  validated: "Validated",
  landed: "Landed in the lake",
  cataloged: "Cataloged (derived_labels)",
  consumed: "Consumed by training",
  stale: "Stale",
  retired: "Retired",
};

/** "11,835 rows · purge 24 bars · 2 runs" — the facts behind the stage. */
export function lifecycleFacts(lifecycle: LabelSetLifecycle): string {
  const facts: string[] = [];
  if (lifecycle.rowCount > 0) facts.push(`${lifecycle.rowCount.toLocaleString()} rows`);
  if (lifecycle.purgeBars !== null) facts.push(`purge ${lifecycle.purgeBars} bars`);
  if (lifecycle.consumedBySessionCount > 0) {
    facts.push(`${lifecycle.consumedBySessionCount} run${lifecycle.consumedBySessionCount === 1 ? "" : "s"}`);
  }
  if (lifecycle.validationPassed === false) facts.push("validation failed");
  return facts.join(" · ");
}

export function LabelLifecycleStrip({ lifecycle }: { lifecycle: LabelSetLifecycle }) {
  const reached = new Set(lifecycle.reached);
  const terminal = lifecycle.stage === "stale" || lifecycle.stage === "retired";
  return (
    <div className="flex items-center gap-2 min-w-0" data-testid="label-lifecycle-strip" data-stage={lifecycle.stage}>
      <div className="flex items-center gap-0.5 shrink-0" aria-hidden>
        {LABEL_LIFECYCLE_RUNGS.map((rung) => (
          <span
            key={rung}
            title={RUNG_LABEL[rung]}
            className={
              reached.has(rung)
                ? terminal
                  ? "h-1.5 w-4 rounded-sm bg-muted-foreground/60"
                  : "h-1.5 w-4 rounded-sm bg-primary"
                : "h-1.5 w-4 rounded-sm border border-muted-foreground/40"
            }
          />
        ))}
      </div>
      <span className={`text-[10px] font-mono shrink-0 ${terminal ? "text-amber-300" : "text-foreground/80"}`}>
        {STAGE_TEXT[lifecycle.stage]}
      </span>
      <span className="text-[10px] font-mono text-muted-foreground truncate">{lifecycleFacts(lifecycle)}</span>
    </div>
  );
}

/** The detail form: every rung named, with what each one means for this set. */
export function LabelLifecyclePanel({ lifecycle }: { lifecycle: LabelSetLifecycle }) {
  const reached = new Set(lifecycle.reached);
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2" data-testid="label-lifecycle-panel">
      <div className="flex items-center gap-1 flex-wrap">
        {LABEL_LIFECYCLE_RUNGS.map((rung, i) => {
          const on = reached.has(rung);
          return (
            <div key={rung} className="flex items-center gap-1">
              {i > 0 && <span className={on ? "h-px w-4 bg-primary" : "h-px w-4 bg-muted-foreground/30"} />}
              <span
                className={
                  on
                    ? "rounded px-2 py-0.5 text-[11px] font-mono bg-primary text-primary-foreground"
                    : "rounded px-2 py-0.5 text-[11px] font-mono border border-dashed border-muted-foreground/40 text-muted-foreground"
                }
              >
                {RUNG_LABEL[rung]}
              </span>
            </div>
          );
        })}
        {(lifecycle.stage === "stale" || lifecycle.stage === "retired") && (
          <span className="ml-2 rounded px-2 py-0.5 text-[11px] font-mono border border-amber-400/50 text-amber-300">
            {RUNG_LABEL[lifecycle.stage]}
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground space-y-1">
        <div>{lifecycleFacts(lifecycle) || "Nothing has been generated for this recipe yet."}</div>
        {lifecycle.staleReason && <div className="text-amber-300">{lifecycle.staleReason}</div>}
        {lifecycle.servingView && (
          <div className="font-mono">
            SELECT * FROM {lifecycle.servingView} WHERE recipe = '{lifecycle.recipe}'
          </div>
        )}
      </div>
    </div>
  );
}
