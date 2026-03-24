import { useEffect, useRef } from "react";
import type { MetricEvent } from "../../../hooks/useTrainingSSE";

interface TrainingLogProps {
  events: MetricEvent[];
  connected: boolean;
  maxLines?: number;
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "??:??:??";
  }
}

function formatValue(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(2);
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

/** Collapse per-epoch metric events into grouped log lines */
function buildLogLines(events: MetricEvent[]): { ts: string; epoch: number; phase: string; metrics: Record<string, number> }[] {
  const groups = new Map<string, { ts: string; epoch: number; phase: string; metrics: Record<string, number> }>();

  for (const e of events) {
    const key = `${e.phase}-${e.epoch}`;
    const existing = groups.get(key);
    if (existing) {
      existing.metrics[e.metric] = e.value;
      // Keep latest timestamp
      if (e.ts > existing.ts) existing.ts = e.ts;
    } else {
      groups.set(key, {
        ts: e.ts,
        epoch: e.epoch,
        phase: e.phase,
        metrics: { [e.metric]: e.value },
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.phase !== b.phase) return a.phase.localeCompare(b.phase);
    return a.epoch - b.epoch;
  });
}

export function TrainingLog({ events, connected, maxLines = 200 }: TrainingLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const logLines = buildLogLines(events).slice(-maxLines);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logLines.length]);

  return (
    <div className="border border-border rounded-lg bg-card/30 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <h3 className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider">
          Training Log
        </h3>
        <div className="flex items-center gap-2">
          {logLines.length > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground">
              {logLines.length} entries
            </span>
          )}
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-muted-foreground/30"}`} />
        </div>
      </div>

      <div
        ref={scrollRef}
        className="overflow-y-auto font-mono text-[11px] leading-[1.6] p-3"
        style={{ height: 200, scrollBehavior: "smooth" }}
      >
        {logLines.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground/30 text-[10px]">
            awaiting training events
          </div>
        ) : (
          logLines.map((line, i) => (
            <div key={`${line.phase}-${line.epoch}`} className="flex gap-0 hover:bg-muted/10 rounded px-1 -mx-1">
              <span className="text-muted-foreground/50 shrink-0 w-[70px]">{formatTime(line.ts)}</span>
              <span className="text-cyan-400/70 shrink-0 w-[24px]">[{line.phase}]</span>
              <span className="text-muted-foreground/70 shrink-0 w-[64px]">epoch {line.epoch}</span>
              <span className="text-foreground/80 truncate">
                {Object.entries(line.metrics).map(([k, v], j) => (
                  <span key={k}>
                    {j > 0 && <span className="text-muted-foreground/30 mx-1">|</span>}
                    <span className="text-muted-foreground/60">{k}=</span>
                    <span className={
                      k.includes("loss") && v < 0.1 ? "text-emerald-400" :
                      k.includes("loss") && v > 5 ? "text-amber-400" :
                      "text-foreground/90"
                    }>
                      {formatValue(v)}
                    </span>
                  </span>
                ))}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
