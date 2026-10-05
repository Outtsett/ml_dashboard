/**
 * The Model Cycle run expressed in the shapes the Market chart already consumes.
 *
 * A run used to have its own chart, which meant two implementations of the same
 * bars. Now the run is a SOURCE: `runBars` produces ordinary `OhlcvData[]` for
 * the market chart's candle pipeline, and `runPanelOverlays` produces ordinary
 * `IndicatorOverlay[]` for the market chart's subchart panels. Nothing about the
 * run's maths is re-implemented here — the series points come from `chartModel`
 * (`probabilityPointAt`, `equityPointAt`), which is where they were already
 * defined and where they are tested.
 *
 * WHY THE RUN'S BARS, NOT THE LAKE'S. The engine roll-adjusts its own prices
 * (`cycle/rolls.py`) and the lake stitches by ratio, so the two sit on different
 * price bases. A prediction, a forecast and a trade fill are all levels: drawn
 * against the lake's candles they would sit at the wrong height. The chart draws
 * the bars the model actually read, which is the Model Cycle's own invariant —
 * "what is on screen is what the model has read" — and every derived layer on
 * the page (the 151 indicators, zigzag, support/resistance) is then computed on
 * those same bars instead of on a parallel copy of them.
 *
 * TIME UNITS. `OhlcvData.timestamp` is epoch MILLISECONDS (`@shared/ohlcv`);
 * `IndicatorOverlay.data[].time` is epoch SECONDS (what every indicator
 * calculator emits, and what the candle series uses). The store's
 * `CycleBarColumns.timestamps` are already seconds, so panel points are passed
 * through and only the bar timestamps are scaled.
 */

import type { CycleBarColumns } from "@shared/cycle/schema";

import { CYCLE_COLORS, equityPointAt, probabilityPointAt, type LinePoint } from "./chartModel";
import type { IndicatorOverlay } from "@/market/lib/useIndicatorData";
import type { OhlcvData } from "@/market/components/types";

/**
 * Panel keys for the run's two series. The `run::` prefix keeps them out of the
 * indicator-column namespace (`getSubchartPanelKey` groups on `instanceId`, the
 * text before `::`), so a run panel can never be mistaken for an indicator
 * instance or removed by the indicator deselect path.
 */
export const RUN_PANEL_PROBABILITY = "run::probability";
export const RUN_PANEL_EQUITY = "run::equity";

/** The reference line the trading rule turns on: at or above 0.50 the model is long. */
export const RUN_PROBABILITY_THRESHOLD = 0.5;

/**
 * A bar the model was not tested on becomes a NON-FINITE value, which
 * `SubchartPanel` draws as a gap in the line — the reading
 * `probabilityPointAt` gives with a whitespace point. It is not a zero and not a
 * carried-forward last value: the model produced nothing there, and a line
 * across it would claim it did.
 */
function panelPoint(time: number, value: number | undefined): { time: number; value: number } {
  return { time, value: value === undefined || !Number.isFinite(value) ? Number.NaN : value };
}

/** A whitespace point (`{ time }`) is how `chartModel` says "the model produced nothing here". */
function linePointValue(point: LinePoint): number | undefined {
  return "value" in point ? point.value : undefined;
}

/**
 * The run's bars as ordinary OHLCV, ready for the market chart's candle pipeline.
 *
 * `role`, `foldIndex` and the per-bar predictions are NOT copied: they stay in
 * the store's columns, which the on-chart bands primitive reads in place. Copying
 * them here would be a second copy that could disagree with the first.
 */
export function runBars(columns: CycleBarColumns): OhlcvData[] {
  const count = columns.timestamps.length;
  const bars: OhlcvData[] = new Array(count);
  for (let index = 0; index < count; index += 1) {
    bars[index] = {
      timestamp: columns.timestamps[index]! * 1000,
      open: columns.open[index]!,
      high: columns.high[index]!,
      low: columns.low[index]!,
      close: columns.close[index]!,
      volume: columns.volume[index]!,
      // Direction by close against the previous close, the rule `useChartSeries`
      // applies to every other bar on this chart. The first bar has no
      // predecessor, so it falls back to its own body.
      is_bullish:
        index === 0
          ? columns.close[index]! >= columns.open[index]!
          : columns.close[index]! >= columns.close[index - 1]!,
    };
  }
  return bars;
}

/**
 * The run's two panes as ordinary subchart panels: `P(up)` and equity.
 *
 * Both are `subchart` display type, so they flow through the same grouping,
 * time-axis sync, panel sizing and close button as an RSI panel — there is no
 * separate pane machinery for a run.
 */
export function runPanelOverlays(columns: CycleBarColumns): IndicatorOverlay[] {
  const count = columns.timestamps.length;
  const probability: { time: number; value: number }[] = new Array(count);
  const equity: { time: number; value: number }[] = new Array(count);
  for (let index = 0; index < count; index += 1) {
    const time = columns.timestamps[index]!;
    probability[index] = panelPoint(time, linePointValue(probabilityPointAt(columns, index)));
    equity[index] = panelPoint(time, linePointValue(equityPointAt(columns, index)));
  }
  return [
    {
      column: RUN_PANEL_PROBABILITY,
      data: probability,
      color: CYCLE_COLORS.sky,
      displayType: "subchart",
      lineWidth: 2,
    },
    {
      column: RUN_PANEL_EQUITY,
      data: equity,
      color: CYCLE_COLORS.up,
      displayType: "subchart",
      lineWidth: 2,
    },
  ];
}
