/**
 * StudioSelectionSync — ML Studio follows the dashboard-wide symbol/timeframe.
 *
 * There used to be two selections: Market drew one pair while ML Studio trained
 * on another, and nothing said so. The dashboard selection (`SymbolContext`) is
 * now the only writer; this component is the only thing that moves the Studio
 * pipeline's pair, and it does so through the reducer's own `setSymbol` /
 * `setTimeframe` actions — the ones `pipelineForPair` guards — so the
 * cross-pair ledger clobber fixed on 2026-07-28 cannot come back through here.
 *
 * One direction only. The Data stage pickers write to the dashboard selection,
 * never to the pipeline, so there is no second writer to loop against.
 */

import { useEffect } from "react";
import { useSymbolContext } from "@/shared/contexts/SymbolContext";
import { TIMEFRAME_OPTIONS } from "@/market/lib/timeframes";
import { useMLStudio, type Timeframe } from "./MLStudioContext";

/**
 * Minutes → Studio timeframe code, or null when Studio has no such timeframe.
 * The chart's option table already carries the codes as `apiKey`, so there is
 * no second table to keep in step.
 */
export function studioTimeframeOf(minutes: number): Timeframe | null {
  return TIMEFRAME_OPTIONS.find((t) => t.minutes === minutes)?.apiKey ?? null;
}

/** Studio timeframe code → minutes. Total: every code is in the table. */
export function minutesOfStudioTimeframe(timeframe: Timeframe): number {
  return TIMEFRAME_OPTIONS.find((t) => t.apiKey === timeframe)?.minutes ?? 1;
}

export function StudioSelectionSync() {
  const { symbol, timeframeMinutes } = useSymbolContext();
  const { state, dispatch } = useMLStudio();

  useEffect(() => {
    if (symbol !== state.symbol) dispatch({ type: "setSymbol", symbol });
  }, [symbol, state.symbol, dispatch]);

  useEffect(() => {
    // A chart interval Studio cannot train on leaves the pipeline where it is.
    const timeframe = studioTimeframeOf(timeframeMinutes);
    if (timeframe && timeframe !== state.timeframe) dispatch({ type: "setTimeframe", timeframe });
  }, [timeframeMinutes, state.timeframe, dispatch]);

  return null;
}
