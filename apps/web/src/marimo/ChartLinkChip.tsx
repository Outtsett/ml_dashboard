/** In the open notebook's header: what the Market chart is sharing with it, and
 *  what this notebook has drawn on the chart (with a way to clear it). A
 *  notebook's drawings are the overlay sets whose source is its file stem — the
 *  name `lake.dashboard.push_overlays` uses by default. */

import { useEffect, useState } from "react";
import { LineChart, X } from "lucide-react";
import { CHART_CONTEXT_EVENT, latestChartContext, type PublishedChartContext } from "@/market/lib/chartContextBridge";
import { useNotebookOverlaySets } from "@/market/lib/useNotebookOverlays";
import { logWarn } from "@/infrastructure/lib/error_logger";
import type { NotebookEntry } from "./types";

function useChartContext(): PublishedChartContext | null {
  const [context, setContext] = useState<PublishedChartContext | null>(() => latestChartContext());
  useEffect(() => {
    const onContext = (event: Event) => setContext((event as CustomEvent<PublishedChartContext>).detail);
    window.addEventListener(CHART_CONTEXT_EVENT, onContext);
    return () => window.removeEventListener(CHART_CONTEXT_EVENT, onContext);
  }, []);
  return context;
}

/** The file stem of a notebook path: `.../chart_companion.py` -> `chart_companion`. */
export function notebookStem(notebookPath: string): string {
  const file = notebookPath.split(/[\\/]/).pop() ?? notebookPath;
  return file.replace(/\.py$/, "");
}

export function ChartLinkChip({ notebook }: { notebook: NotebookEntry }) {
  const context = useChartContext();
  const sets = useNotebookOverlaySets();
  const stem = notebookStem(notebook.path);
  const mine = sets.filter((set) => set.source === stem || set.source.startsWith(`${stem}:`));
  const drawingCount = mine.reduce((sum, set) => sum + set.overlays.length, 0);

  const clear = () => {
    for (const set of mine) {
      fetch(`/api/chart/overlays/${encodeURIComponent(set.source)}`, { method: "DELETE" })
        .catch((err: unknown) => logWarn("ChartLinkChip", "could not clear the notebook's drawings", { error: String(err) }));
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground" data-testid="chart-link-chip">
      <LineChart className="h-3 w-3" aria-hidden="true" />
      {context ? (
        <span title="What the Market chart shares with notebooks that follow it (lake.dashboard.follow_chart)">
          Chart: <span className="font-mono text-foreground">{context.symbol} {context.timeframe}</span>
          {context.selectedMs !== null && " · a bar is selected"}
        </span>
      ) : (
        <span>The Market chart has not shared its view yet</span>
      )}
      {drawingCount > 0 && (
        <>
          <span>·</span>
          <span style={{ color: "#E69F00" }}>{drawingCount} drawing{drawingCount === 1 ? "" : "s"} on the chart</span>
          <button type="button" onClick={clear} className="inline-flex items-center gap-0.5 rounded px-1 hover:bg-muted" title="Remove this notebook's drawings from the Market chart">
            <X className="h-3 w-3" aria-hidden="true" /> clear
          </button>
        </>
      )}
    </span>
  );
}
