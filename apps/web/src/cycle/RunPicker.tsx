/**
 * Every Model Cycle run the server knows: the live accumulator's and every run
 * archived in the lake (`GET /api/training/cycle`). Picking one rebuilds the
 * page from its record (`openRun`), a live run reattaches to its stream.
 */
import { useEffect, useState } from "react";
import { History } from "lucide-react";

import type { CycleRunSummary } from "@shared/cycle/schema";
import { apiRequest } from "@/infrastructure/api/query_client";
import { openRun } from "@/cycle/connection";
import { useCycleStore } from "@/cycle/store";
import { useEntityStore } from "@/shared/contexts/EntityContext";

function formatStamp(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "unknown time";
  const date = new Date(milliseconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export function RunPicker({ disabled = false }: { disabled?: boolean }) {
  const currentModelId = useCycleStore((state) => state.modelId);
  const status = useCycleStore((state) => state.status);
  const { activeEntity } = useEntityStore();
  const [runs, setRuns] = useState<CycleRunSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const filteredRuns = runs.filter(run => 
    activeEntity?.type === 'model' ? run.modelId === activeEntity.id : true
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiRequest("GET", "/api/training/cycle")
      .then(async (response) => (await response.json()) as CycleRunSummary[])
      .then((list) => {
        if (!cancelled) setRuns(list);
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // refresh the list whenever a run ends or starts
  }, [status]);

  return (
    <label className="flex items-center gap-1.5 text-[11px] text-neutral-400" data-testid="run-picker">
      <History className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">Open a run</span>
      <select
        aria-label="Open a Model Cycle run"
        className="h-7 max-w-[26rem] rounded border border-white/10 bg-white/5 px-1 font-mono text-[11px] text-neutral-200"
        value={currentModelId ?? ""}
        disabled={disabled || loading}
        onChange={(event) => {
          if (event.target.value) void openRun(event.target.value);
        }}
      >
        <option value="">{loading ? "loading runs…" : `${filteredRuns.length} run${filteredRuns.length === 1 ? "" : "s"} recorded`}</option>
        {filteredRuns.map((run) => (
          <option key={run.modelId} value={run.modelId}>
            {formatStamp(run.startedAt)} · {run.symbol ?? "?"} {run.timeframe ?? ""} · {run.modelFamily ?? run.modelType} · {run.status}
            {run.tradeCount ? ` · ${run.tradeCount} trades` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
