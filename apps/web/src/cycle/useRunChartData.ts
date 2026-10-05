/**
 * The run as data for the Market chart: its bars, its two panels, its trade
 * markers, and whether it is on screen at all.
 *
 * All three come out of the one store through `useSyncExternalStore`-style
 * selectors, so a page reading them here and a chart hook reading the store
 * directly are always looking at the same run — there is no second copy of the
 * run's state anywhere in the client.
 */

import { useMemo } from "react";

import type { IndicatorOverlay } from "@/market/lib/useIndicatorData";
import type { ChartMarker } from "@/market/components/useSeriesMarkers";
import {
  registerBaselineColumn,
  registerInstanceLabel,
  registerInstanceReferenceLines,
  registerSeriesTitle,
} from "@/market/lib/indicator_panels";
import {
  runBars,
  runPanelOverlays,
  RUN_PANEL_EQUITY,
  RUN_PANEL_PROBABILITY,
  RUN_PROBABILITY_THRESHOLD,
} from "./runBars";
import { runIsShown } from "./useRunOverlay";
import { buildTradeMarkers, withAlpha, CYCLE_COLORS } from "./chartModel";
import { useCycleStore } from "./store";

/**
 * Panel metadata for the run's two panes, registered once with the same registry
 * every indicator panel uses — so a run pane is named, scaled and closed by the
 * one set of rules rather than by a parallel set. Equity is a filled area against
 * zero because the area between the curve and zero is the reading; `P(up)` carries
 * the dotted 0.50 line the trading rule turns on.
 */
registerInstanceLabel(RUN_PANEL_PROBABILITY, "P(up)");
registerInstanceLabel(RUN_PANEL_EQUITY, "Equity");
registerSeriesTitle(RUN_PANEL_PROBABILITY, "P(up)");
registerSeriesTitle(RUN_PANEL_EQUITY, "Equity, USD net of costs");
registerBaselineColumn(RUN_PANEL_EQUITY);
registerInstanceReferenceLines(RUN_PANEL_PROBABILITY, [
  { value: RUN_PROBABILITY_THRESHOLD, color: withAlpha(CYCLE_COLORS.neutral, 0.7) },
]);

export interface RunChartData {
  /** True while a run is being shown on the chart. */
  active: boolean;
  /** The run's own bars, or null when no run is on screen. */
  bars: ReturnType<typeof runBars> | null;
  /** The run's `P(up)` and equity panels, as ordinary subchart panels. */
  panels: IndicatorOverlay[];
  /**
   * The run's trades as chart markers.
   *
   * Held back until the bar they sit on has been drawn: a marker on a bar the
   * chart does not have yet has no coordinate, and `buildTradeMarkers` reports
   * the earliest such timestamp so a bar arriving can bring the rest in.
   */
  markers: ChartMarker[];
}

export function useRunChartData(): RunChartData {
  const active = useCycleStore(runIsShown);
  const barsIdentity = useCycleStore((state) => state.bars);
  const barCount = useCycleStore((state) => state.barCount);
  const trades = useCycleStore((state) => state.trades);

  // Keyed on the store's own bar columns: the store replaces them when a batch
  // adds bars or resolves a label, and keeps the same object between batches, so
  // this recomputes exactly when there is something new.
  const bars = useMemo(() => (active && barCount > 0 ? runBars(barsIdentity) : null), [active, barCount, barsIdentity]);
  const panels = useMemo(() => (active && barCount > 0 ? runPanelOverlays(barsIdentity) : []), [active, barCount, barsIdentity]);

  const markers = useMemo((): ChartMarker[] => {
    if (!active || barCount === 0) return [];
    const lastTimestamp = barsIdentity.timestamps[barCount - 1] ?? null;
    // The chart draws these bars, so `buildTradeMarkers`' snap to `columns` is a
    // snap to the chart's own bar times — no second alignment step needed.
    //
    // The two marker shapes are the same fields, except that lightweight-charts
    // also allows a price-anchored position, which this chart's marker type (and
    // every other marker source on it) does not. `buildTradeMarkers` emits only
    // the bar-relative ones; anything else is skipped rather than coerced, so a
    // future change to it cannot put a marker at an unrepresentable position.
    const out: ChartMarker[] = [];
    for (const marker of buildTradeMarkers(trades, lastTimestamp, barsIdentity).markers) {
      if (marker.position !== "aboveBar" && marker.position !== "belowBar" && marker.position !== "inBar") continue;
      out.push({
        time: marker.time,
        position: marker.position,
        color: marker.color,
        shape: marker.shape,
        text: marker.text ?? "",
        ...(marker.size !== undefined ? { size: marker.size } : {}),
        ...(marker.id !== undefined ? { id: marker.id } : {}),
      });
    }
    return out;
  }, [active, barCount, barsIdentity, trades]);

  return { active, bars, panels, markers };
}
