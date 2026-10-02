/**
 * The page's control defaults (mirrored into the URL by useStudyControls).
 * SERVER_DEFAULTS are sent to the handler; the rest only re-draw what the page
 * already holds, so moving them does not refetch.
 */

import { DEFAULT_PANES, DEFAULT_SESSION_HOURS, DEFAULT_TARGET_BARS } from "@shared/studies/market-series-explorer";

export const SERVER_DEFAULTS = {
  instrument: "futures:MNQ",
  /** Indices into the daily strip; -1 means the last 90 days. */
  spanStart: -1,
  spanEnd: -1,
  targetBars: DEFAULT_TARGET_BARS,
  statisticsColumn: "log_return",
  bins: 40,
  convention: "notebook",
};

export const DEFAULTS = {
  ...SERVER_DEFAULTS,
  /** Comma-separated pane columns. */
  panes: DEFAULT_PANES.join(","),
  /** Comma-separated overlays: rolls, session. */
  overlays: "rolls",
  sessionStart: DEFAULT_SESSION_HOURS.start,
  sessionEnd: DEFAULT_SESSION_HOURS.end,
  logPrice: true,
  zscoreColumn: "return_zscore",
};

type Widen<C> = { [K in keyof C]: C[K] extends string ? string : C[K] extends number ? number : C[K] extends boolean ? boolean : C[K] };
export type Controls = Widen<typeof DEFAULTS>;
export type SetControl = <K extends keyof Controls>(key: K, value: Controls[K]) => void;

export function serverControls(controls: Controls): Record<keyof typeof SERVER_DEFAULTS, string | number> {
  return {
    instrument: controls.instrument,
    spanStart: controls.spanStart,
    spanEnd: controls.spanEnd,
    targetBars: controls.targetBars,
    statisticsColumn: controls.statisticsColumn,
    bins: controls.bins,
    convention: controls.convention,
  };
}

export function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

export function toggleInList(value: string, item: string): string {
  const items = splitList(value);
  return (items.includes(item) ? items.filter((entry) => entry !== item) : [...items, item]).join(",");
}
