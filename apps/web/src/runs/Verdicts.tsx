/**
 * The verdict section: what is wrong with the run, the numbers that say so and
 * what to change, worst first. The rules are `@shared/runs/verdicts`.
 */
import { useState } from "react";

import { RUN_CATEGORY_LABELS, type RunVerdict, type VerdictSeverity } from "@shared/runs/types";
import { headlineOf } from "@shared/runs/verdicts";
import type { CycleRunStatus } from "@shared/cycle/schema";
import { SEVERITY_STYLE } from "@/runs/format";

const HEADLINE_COLOR = { critical: "#D55E00", warning: "#F0E442", pass: "#56B4E9", pending: "#808A99" } as const;
const FILTERS: Array<{ id: "all" | VerdictSeverity; label: string }> = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical" },
  { id: "warning", label: "Warnings" },
  { id: "pass", label: "Passes" },
];

export function Verdicts({ status, verdicts }: { status: CycleRunStatus; verdicts: RunVerdict[] }) {
  const [filter, setFilter] = useState<"all" | VerdictSeverity>("all");
  const headline = headlineOf(status, verdicts);
  const shown = filter === "all" ? verdicts : verdicts.filter((verdict) => verdict.severity === filter);
  const countOf = (id: "all" | VerdictSeverity) => (id === "all" ? verdicts.length : verdicts.filter((verdict) => verdict.severity === id).length);

  return (
    <div className="space-y-2">
      <div
        className="rounded-md border px-3 py-2 text-sm font-semibold"
        style={{ borderColor: HEADLINE_COLOR[headline.tone], color: HEADLINE_COLOR[headline.tone] }}
        data-testid="run-headline"
      >
        {headline.text}
      </div>

      {verdicts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setFilter(entry.id)}
              className={`cursor-pointer rounded border px-2 py-0.5 text-[11px] font-mono ${
                filter === entry.id ? "border-foreground/60 bg-foreground/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {entry.label} {countOf(entry.id)}
            </button>
          ))}
        </div>
      )}

      <ul className="space-y-1.5">
        {shown.map((verdict) => {
          const style = SEVERITY_STYLE[verdict.severity];
          return (
            <li key={verdict.rule} className="rounded-md border border-border bg-card/60 px-3 py-2" style={{ borderLeft: `3px solid ${style.color}` }}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-mono text-[11px] font-bold uppercase" style={{ color: style.color }}>
                  {style.glyph} {style.label}
                </span>
                <span className="font-mono text-[10px] uppercase text-muted-foreground">{RUN_CATEGORY_LABELS[verdict.category]}</span>
              </div>
              <p className="mt-0.5 text-[13px] font-semibold leading-snug text-foreground">{verdict.title}</p>
              <p className="mt-0.5 font-mono text-[11px] leading-snug text-muted-foreground">{verdict.evidence}</p>
              {verdict.action && (
                <p className="mt-1 text-[12px] leading-snug text-foreground/90">
                  <span className="font-mono text-[10px] font-bold uppercase text-[#E69F00]">Change: </span>
                  {verdict.action}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
