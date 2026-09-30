/**
 * What notebooks have asked the Market chart to draw, for the symbol and
 * timeframe on screen. Read from `/api/chart/stream` through the tab's shared
 * connection (openEventStream), so it costs no connection of its own.
 *
 * Lines become ordinary indicator overlays (on the price scale, or in their own
 * pane); markers join the chart's one markers plugin; levels, zones and vertical
 * lines are drawn by notebookDrawings.ts.
 */

import { useMemo, useSyncExternalStore } from "react";
import type { ChartView, Overlay, OverlaySet } from "@shared/chartLink";
import { openEventStream } from "@/infrastructure/lib/sharedEventSource";
import { logWarn } from "@/infrastructure/lib/error_logger";
import { registerInstanceLabel, registerSeriesTitle } from "./indicator_panels";
import type { IndicatorOverlay } from "./useIndicatorData";

/** Okabe-Ito, in the order a notebook's uncoloured overlays take them. */
const PALETTE = ["#E69F00", "#0072B2", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442"];

export interface NotebookMarker {
  timeMs: number;
  position: "above" | "below" | "on";
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  color: string;
  text?: string;
}

export interface NotebookLevel {
  key: string;
  price: number;
  color: string;
  label: string;
  style: "solid" | "dashed" | "dotted";
}

export interface NotebookZone {
  startMs: number;
  endMs: number;
  color: string;
  label: string;
}

export interface NotebookVerticalLine {
  timeMs: number;
  color: string;
  label: string;
}

export interface NotebookDrawings {
  levels: NotebookLevel[];
  zones: NotebookZone[];
  verticalLines: NotebookVerticalLine[];
}

export interface NotebookOverlayView {
  lines: IndicatorOverlay[];
  markers: NotebookMarker[];
  drawings: NotebookDrawings;
  /** Every set received, all symbols — for the notebook tab's "drawn on the chart" chip. */
  sets: OverlaySet[];
}

const EMPTY: NotebookOverlayView = { lines: [], markers: [], drawings: { levels: [], zones: [], verticalLines: [] }, sets: [] };

function colourOf(overlay: Overlay, index: number): string {
  return overlay.color ?? PALETTE[index % PALETTE.length]!;
}

/** Pure: the sets for this symbol and timeframe, turned into what the chart draws. Exported for tests. */
export function selectNotebookOverlays(sets: OverlaySet[], symbol: string, timeframe: string): NotebookOverlayView {
  const view: NotebookOverlayView = { lines: [], markers: [], drawings: { levels: [], zones: [], verticalLines: [] }, sets };
  const wantedSymbol = symbol.toUpperCase();
  let colourIndex = 0;
  for (const set of sets) {
    if (set.symbol.toUpperCase() !== wantedSymbol || set.timeframe !== timeframe) continue;
    for (const overlay of set.overlays) {
      const colour = colourOf(overlay, colourIndex++);
      const label = overlay.label ?? overlay.id;
      if (overlay.kind === "line") {
        const pane = overlay.pane === "pane";
        // A pane line gets its own pane (the part before "::" names it); a
        // price line sits on the candles. The chart shows the overlay's LABEL
        // (registered as the series title, and as the pane's label), never
        // the column id.
        const paneKey = `notebook_${set.source}_${overlay.id}`;
        const column = pane ? `${paneKey}::${label}` : `notebook:${set.source}:${overlay.id}`;
        registerSeriesTitle(column, label);
        if (pane) registerInstanceLabel(paneKey, label);
        view.lines.push({
          column,
          data: overlay.points
            .map((point) => ({ time: Math.floor(point.time / 1000), value: point.value }))
            .sort((a, b) => a.time - b.time),
          color: colour,
          displayType: pane ? "subchart" : "overlay",
          lineWidth: 2,
        });
      } else if (overlay.kind === "marker") {
        for (const marker of overlay.markers) {
          view.markers.push({ timeMs: marker.time, position: marker.position, shape: marker.shape, color: colour, text: marker.text });
        }
      } else if (overlay.kind === "level") {
        view.drawings.levels.push({ key: `${set.source}:${overlay.id}`, price: overlay.price, color: colour, label, style: overlay.style });
      } else if (overlay.kind === "zone") {
        for (const zone of overlay.zones) {
          view.drawings.zones.push({ startMs: Math.min(zone.start, zone.end), endMs: Math.max(zone.start, zone.end), color: colour, label: zone.text ?? label });
        }
      } else {
        for (const time of overlay.times) view.drawings.verticalLines.push({ timeMs: time, color: colour, label });
      }
    }
  }
  view.markers.sort((a, b) => a.timeMs - b.timeMs);
  return view;
}

// One subscription per page, shared by every reader (the chart and the notebook
// tab's chip), opened with the first reader and closed with the last.
let sharedSets: OverlaySet[] = [];
const readers = new Set<() => void>();
let sharedSource: EventSource | null = null;
const viewHandlers = new Set<(view: ChartView) => void>();
const scrollHandlers = new Set<(view: ChartView) => void>();

/** The page that owns the bars registers for view requests (POST /api/chart/view): "latest" means
 *  load the newest window (the chart may be anchored on an older one), then scroll; a range scrolls. */
export function subscribeChartView(handler: (view: ChartView) => void): () => void {
  viewHandlers.add(handler);
  return () => {
    viewHandlers.delete(handler);
  };
}

/** The chart registers to move its time scale when the page asks (after any reload). */
export function subscribeChartScroll(handler: (view: ChartView) => void): () => void {
  scrollHandlers.add(handler);
  return () => {
    scrollHandlers.delete(handler);
  };
}

export function requestChartScroll(view: ChartView): void {
  for (const handler of scrollHandlers) handler(view);
}

function subscribe(onChange: () => void): () => void {
  readers.add(onChange);
  // No EventSource (a test page, an embedded view): no drawings, never a crash.
  if (!sharedSource && typeof EventSource !== "undefined") {
    sharedSource = openEventStream("/api/chart/stream");
    sharedSource.addEventListener("overlays", (event: Event) => {
      try {
        sharedSets = JSON.parse((event as MessageEvent).data) as OverlaySet[];
      } catch (err) {
        logWarn("useNotebookOverlays", "unreadable overlays event", { error: String(err) });
        return;
      }
      for (const reader of readers) reader();
    });
    sharedSource.addEventListener("view", (event: Event) => {
      try {
        const view = JSON.parse((event as MessageEvent).data) as ChartView;
        for (const handler of viewHandlers) handler(view);
      } catch (err) {
        logWarn("useNotebookOverlays", "unreadable view event", { error: String(err) });
      }
    });
  }
  return () => {
    readers.delete(onChange);
    if (readers.size === 0 && sharedSource) {
      sharedSource.close();
      sharedSource = null;
      sharedSets = [];
    }
  };
}

export function useNotebookOverlaySets(): OverlaySet[] {
  return useSyncExternalStore(subscribe, () => sharedSets, () => sharedSets);
}

export function useNotebookOverlays(symbol: string, timeframe: string): NotebookOverlayView {
  const sets = useNotebookOverlaySets();
  // One view per change of its inputs: the chart re-creates its price lines
  // whenever the drawings object changes identity.
  return useMemo(() => (sets.length === 0 ? EMPTY : selectNotebookOverlays(sets, symbol, timeframe)), [sets, symbol, timeframe]);
}
