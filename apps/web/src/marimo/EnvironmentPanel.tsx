/** Every notebook environment (one `marimo run` process per group): what it is
 *  doing, how far a start has got, what it holds in memory, and when the idle
 *  rule will stop it. */

import { useEffect, useState } from "react";
import { Play, Square } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/utils/utils";
import { bytesLabel, durationLabel, startupProgress, whenLabel } from "./format";
import type { GroupEntry } from "./types";

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function idleWords(group: GroupEntry, idleStopMinutes: number): string {
  if (group.keptWarm) return "kept warm: holds a pinned notebook";
  if (group.openConnections > 0) return `${group.openConnections} notebook page${group.openConnections === 1 ? "" : "s"} open`;
  if (group.idleSeconds === null) return "";
  if (idleStopMinutes <= 0) return `idle ${durationLabel(group.idleSeconds)}`;
  const left = Math.max(0, idleStopMinutes * 60 - group.idleSeconds);
  return `idle ${durationLabel(group.idleSeconds)} · stops in ${durationLabel(left)}`;
}

export function EnvironmentPanel({
  groups,
  idleStopMinutes,
  onStart,
  onStop,
}: {
  groups: GroupEntry[];
  idleStopMinutes: number;
  onStart: (slug: string) => void;
  onStop: (slug: string) => void;
}) {
  const now = useNow(groups.some((g) => g.status === "starting"));
  const running = groups.filter((g) => g.status === "ready");
  const totalMemory = running.reduce((sum, g) => sum + (g.memoryBytes ?? 0), 0);

  return (
    <div className="shrink-0 rounded-md border border-border p-2" data-testid="environment-panel">
      <h3 className="mb-1 flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Environments</span>
        <span className="font-normal normal-case tracking-normal tnum">
          {running.length} of {groups.length} running{totalMemory > 0 ? ` · ${bytesLabel(totalMemory)}` : ""}
        </span>
      </h3>
      <ul className="space-y-1.5">
        {groups.map((group) => {
          const progress = group.status === "starting" ? startupProgress(group.startingSinceIso, group.expectedStartupSeconds, now) : 0;
          const elapsed = group.startingSinceIso ? (now - Date.parse(group.startingSinceIso)) / 1000 : 0;
          return (
            <li key={group.slug} className="text-[11px]" data-testid="environment-row" data-status={group.status}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate" title={`${group.python}\n${group.cwd}`}>
                  <span className="font-mono text-foreground">{group.label}</span>
                  <span className="ml-1 text-muted-foreground tnum">:{group.port}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className={cn("tnum", group.status === "error" ? "text-[#D55E00]" : "text-muted-foreground")}>
                    {group.status === "ready" && (group.memoryBytes ? `running · ${bytesLabel(group.memoryBytes)}` : "running")}
                    {group.status === "starting" && `starting… ${Math.round(elapsed)} s`}
                    {group.status === "stopped" && (group.stoppedForIdleAtIso ? "stopped (idle)" : "not running")}
                    {group.status === "error" && "✕ failed"}
                  </span>
                  {group.status === "ready" ? (
                    <Button size="icon" variant="ghost" className="h-5 w-5" title={`Stop ${group.label}`} onClick={() => onStop(group.slug)}>
                      <Square className="h-3 w-3" />
                    </Button>
                  ) : group.status !== "starting" ? (
                    <Button size="icon" variant="ghost" className="h-5 w-5" title={`Start ${group.label}`} onClick={() => onStart(group.slug)}>
                      <Play className="h-3 w-3" />
                    </Button>
                  ) : null}
                </span>
              </div>

              {group.status === "starting" && (
                <div className="mt-0.5 space-y-0.5">
                  <div
                    className="h-1 overflow-hidden rounded bg-muted"
                    role="progressbar"
                    aria-valuenow={Math.round(progress * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    title={group.expectedStartupSeconds ? `Last start took ${durationLabel(group.expectedStartupSeconds)}` : "First start: no earlier timing to compare against"}
                  >
                    <div className="h-full rounded bg-[#56B4E9] transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
                  </div>
                  <p className="truncate font-mono text-[9.5px] text-muted-foreground" title={group.lastOutputLine}>
                    {group.lastOutputLine ?? "launching python…"}
                  </p>
                </div>
              )}

              {group.status === "ready" && (
                <p className="text-[9.5px] text-muted-foreground tnum">{idleWords(group, idleStopMinutes)}</p>
              )}
              {group.status === "stopped" && group.stoppedForIdleAtIso && (
                <p className="text-[9.5px] text-muted-foreground">
                  stopped {whenLabel(group.stoppedForIdleAtIso)} after {idleStopMinutes} min with no notebook open
                </p>
              )}
              {group.status === "error" && group.error && (
                <p className="line-clamp-3 whitespace-pre-wrap font-mono text-[9.5px] text-[#D55E00]" title={group.error}>{group.error}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
