/** The small signs on a notebook: whether it still runs, whether git has it,
 *  and which lake data it reads. Every sign is a shape AND a word, never a
 *  colour alone (Okabe-Ito, deuteranopia-safe). */

import { cn } from "@/shared/utils/utils";
import { durationLabel, healthView, whenLabel, type HealthView } from "./format";
import type { DatasetReference, GitState, HealthRecord } from "./types";

const HEALTH_LOOK: Record<HealthView, { symbol: string; word: string; color: string }> = {
  passes: { symbol: "✓", word: "runs", color: "#0072B2" },
  fails: { symbol: "✕", word: "fails", color: "#D55E00" },
  checking: { symbol: "◌", word: "checking", color: "#56B4E9" },
  queued: { symbol: "…", word: "queued", color: "#56B4E9" },
  changed: { symbol: "↻", word: "changed since check", color: "#E69F00" },
  unchecked: { symbol: "?", word: "not checked", color: "" },
};

export const HEALTH_FILTER_WORDS: Array<{ view: HealthView; word: string }> = (
  ["fails", "passes", "changed", "unchecked"] as HealthView[]
).map((view) => ({ view, word: `${HEALTH_LOOK[view].symbol} ${HEALTH_LOOK[view].word}` }));

export function healthTooltip(health: HealthRecord | null, modifiedAtIso: string): string {
  const view = healthView(health, modifiedAtIso);
  if (!health || view === "unchecked") return "Not checked yet. A check runs every cell with marimo export, in the notebook's own environment.";
  if (view === "queued") return "Waiting for a free slot (two checks run at a time).";
  if (view === "checking") return `Running every cell since ${whenLabel(health.checkedAtIso)}.`;
  const verdict = health.status === "passed" ? "Every cell ran" : "Some cells failed";
  const alongside = health.ranAlongside ? ` (beside ${health.ranAlongside} other check${health.ranAlongside === 1 ? "" : "s"}, so slower than alone)` : "";
  const when = `${verdict} on ${whenLabel(health.checkedAtIso)}${health.durationSeconds !== null ? ` in ${durationLabel(health.durationSeconds)}${alongside}` : ""}.`;
  const stale = view === "changed" ? " The file has been edited since, so this result is about an older version." : "";
  return `${when}${stale}${health.error ? `\n\n${health.error}` : ""}`;
}

export function HealthBadge({ health, modifiedAtIso, compact = false }: { health: HealthRecord | null; modifiedAtIso: string; compact?: boolean }) {
  const view = healthView(health, modifiedAtIso);
  const look = HEALTH_LOOK[view];
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[10px] tnum", !look.color && "text-muted-foreground")}
      style={look.color ? { color: look.color } : undefined}
      title={healthTooltip(health, modifiedAtIso)}
      data-testid="health-badge"
      data-health={view}
    >
      <span aria-hidden="true" className={cn(view === "checking" && "animate-spin inline-block")}>{look.symbol}</span>
      {!compact && <span>{look.word}</span>}
    </span>
  );
}

const GIT_LOOK: Partial<Record<GitState, { symbol: string; word: string; title: string }>> = {
  modified: { symbol: "●", word: "edited", title: "Changes git has not recorded yet: the file differs from the last commit." },
  untracked: { symbol: "○", word: "new", title: "Never committed: git does not track this file yet." },
  not_in_git: { symbol: "◇", word: "no git", title: "This folder is not inside a git repository." },
};

export function GitMarker({ state }: { state: GitState }) {
  const look = GIT_LOOK[state];
  if (!look) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[10px]"
      style={{ color: state === "not_in_git" ? undefined : "#E69F00" }}
      title={look.title}
      data-testid="git-marker"
      data-git={state}
    >
      <span aria-hidden="true">{look.symbol}</span>
      <span className={cn(state === "not_in_git" && "text-muted-foreground")}>{look.word}</span>
    </span>
  );
}

const KIND_SHORT: Record<DatasetReference["kind"], string> = {
  "lake view": "view",
  "lake dataset": "dataset",
  "Iceberg table": "Iceberg",
  "serving table": "table",
  "lake loader": "loader",
  "DuckDB file": "file",
};

export function DatasetChips({
  datasets,
  active,
  onSelect,
  limit = 4,
}: {
  datasets: DatasetReference[];
  active: string | null;
  onSelect: (name: string) => void;
  limit?: number;
}) {
  if (datasets.length === 0) return null;
  const shown = datasets.slice(0, limit);
  return (
    <span className="flex flex-wrap gap-1" data-testid="dataset-chips">
      {shown.map((dataset) => (
        <button
          key={`${dataset.kind}:${dataset.name}`}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(dataset.name);
          }}
          className={cn(
            "max-w-[16rem] truncate rounded border px-1 font-mono text-[9.5px] leading-4 transition-colors",
            active === dataset.name ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:border-primary/60 hover:text-foreground",
          )}
          title={`${dataset.kind}: ${dataset.name}\nShow every notebook that reads it`}
        >
          <span className="opacity-60">{KIND_SHORT[dataset.kind]} </span>
          {dataset.name}
        </button>
      ))}
      {datasets.length > limit && (
        <span className="text-[9.5px] text-muted-foreground" title={datasets.slice(limit).map((d) => d.name).join("\n")}>
          +{datasets.length - limit} more
        </span>
      )}
    </span>
  );
}
