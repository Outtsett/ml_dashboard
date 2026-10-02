/** The page's control state: the keys the server reads, then the page-only ones. */

export type Controls = {
  /** Server: how many of the most recent bars to read. */
  bars: number;
  /** Server: comma-separated window lengths for sections 2 and 3. */
  windows: string;
  /** Server: window whose straightest and choppiest instance section 1 draws. */
  extremeWindow: number;
  /** Server: bars ahead the direction label looks. */
  horizon: number;
  /** Server: labels whose move is smaller than this many points are left out. */
  flatThreshold: number;
  /** Server: short horizon of the candlestick chart. */
  showHorizon: number;
  /** Server: candles drawn. */
  showBars: number;
  /** Server: bars of the price-and-arrows chart. */
  segmentBars: number;
  /** Server: where in the loaded bars the inspection slices start. */
  position: number;
  /** Page: which forecast target the per-fold panels show. */
  target: string;
  /** Page: ridge or gradient boosting in the interval and skill panels. */
  model: string;
};

export type Setter = <K extends keyof Controls>(key: K, value: Controls[K]) => void;

export const DEFAULT_CONTROLS: Controls = {
  bars: 400_000,
  windows: "15,60,240,1440",
  extremeWindow: 60,
  horizon: 60,
  flatThreshold: 0,
  showHorizon: 10,
  showBars: 45,
  segmentBars: 400,
  position: 0.5,
  target: "fwd_er_vs_rw",
  model: "ridge",
};

/** The controls the server parses, as the query string's key-values. */
export function serverControls(controls: Controls): Record<string, string | number> {
  return {
    bars: controls.bars,
    windows: controls.windows,
    extremeWindow: controls.extremeWindow,
    horizon: controls.horizon,
    flatThreshold: controls.flatThreshold,
    showHorizon: controls.showHorizon,
    showBars: controls.showBars,
    segmentBars: controls.segmentBars,
    position: controls.position,
  };
}
