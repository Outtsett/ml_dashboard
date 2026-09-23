/**
 * One regression per X variable — the model behind every panel.
 *
 * Pure: bars and aligned columns in, fitted panels out. It runs in a Web
 * Worker (panels.worker.ts): 49 fits over 20,000 bars measured 852 ms of
 * synchronous work, which on the main thread froze every control for that
 * long on each symbol, timeframe or setting change.
 */

import {
  benjaminiHochberg,
  buildPairs,
  fitSimpleRegression,
  quantileBuckets,
  refitWithout,
  type CookCutoffRule,
  type QuantileBuckets,
  type RegressionPairs,
  type RegressionResult,
  type ResponseMode,
} from "@shared/regression/index";
import type { RegressionVariable } from "@shared/regression/types";
import type { SeriesFamily } from "@shared/series/types";
import type { OhlcvData } from "@/market/components/types";
import { BAR_VARIABLES } from "./variables";

export interface PanelVariable {
  id: string;
  label: string;
  family: SeriesFamily;
  source: "bar" | "lake";
  /** Plain-words definition (bar variables) or the lake object it lives in. */
  detail: string;
  forwardLooking: boolean;
  priceLevel: boolean;
  containsClose: boolean;
  values: Array<number | null>;
  matchedBars: number;
  emptyReason?: string;
}

/** What a panel keeps of its variable once fitted — the values stay behind. */
export type PanelVariableSummary = Omit<PanelVariable, "values"> & {
  /** Bars the variable was aligned to. */
  barCount: number;
};

export interface PanelSettings {
  mode: ResponseMode;
  horizonBars: number;
  confidenceLevel: number;
  cookCutoff: CookCutoffRule;
  refitWithoutFlagged: boolean;
}

export interface PanelModel {
  variable: PanelVariableSummary;
  pairs: RegressionPairs;
  result: RegressionResult;
  /** The fit with every flagged point removed, when that setting is on. */
  refit: RegressionResult | null;
  buckets: QuantileBuckets | null;
  /** Benjamini-Hochberg q-value of the Newey-West slope p-value, across the panels shown. */
  qValue: number | null;
}

export interface BarClock {
  /** Bar open times, epoch ms, in bar order. */
  timestampsMilliseconds: ReadonlyArray<number>;
  /** Length of one bar at the chart's timeframe. */
  barMilliseconds: number;
}

export function computePanels(
  close: ReadonlyArray<number>,
  variables: ReadonlyArray<PanelVariable>,
  settings: PanelSettings,
  clock?: BarClock,
): PanelModel[] {
  const options = { confidenceLevel: settings.confidenceLevel, cookCutoff: settings.cookCutoff };
  const panels: PanelModel[] = variables.map((variable) => {
    const pairs = buildPairs(close, variable.values, {
      mode: settings.mode,
      horizonBars: settings.horizonBars,
      ...(clock ? { timestampsMilliseconds: clock.timestampsMilliseconds, barMilliseconds: clock.barMilliseconds } : {}),
    });
    const result = fitSimpleRegression(pairs.x, pairs.y, options);
    let refit: RegressionResult | null = null;
    if (settings.refitWithoutFlagged && result.ok) {
      const flagged = new Uint8Array(result.fit.n);
      for (let index = 0; index < result.fit.n; index += 1) {
        flagged[index] = result.fit.verticalOutlier[index] || result.fit.influential[index] ? 1 : 0;
      }
      refit = refitWithout(pairs.x, pairs.y, flagged, options);
    }
    const buckets = result.ok ? quantileBuckets(pairs.x, pairs.y, 5, settings.confidenceLevel) : null;
    const { values, ...summary } = variable;
    return { variable: { ...summary, barCount: values.length }, pairs, result, refit, buckets, qValue: null };
  });

  const tested = panels.filter((panel) => panel.result.ok);
  const qValues = benjaminiHochberg(
    tested.map((panel) => (panel.result.ok ? panel.result.fit.slopePValueNeweyWest : 1)),
  );
  tested.forEach((panel, index) => {
    panel.qValue = qValues[index] ?? null;
  });
  return panels;
}

export function responseAxisLabel(settings: Pick<PanelSettings, "mode" | "horizonBars">): string {
  if (settings.mode === "level") return "Close price (points)";
  if (settings.mode === "difference") return "Change in close from the previous bar (points)";
  return `Log return over the next ${settings.horizonBars} bar${settings.horizonBars === 1 ? "" : "s"} (basis points)`;
}

export function predictorAxisLabel(label: string, mode: ResponseMode): string {
  return mode === "difference" ? `Change in ${label}` : label;
}

export type PanelSort = "q_value" | "spearman" | "r_squared" | "catalog";

export function sortPanels(panels: ReadonlyArray<PanelModel>, sort: PanelSort): PanelModel[] {
  const copy = [...panels];
  const score = (panel: PanelModel): number => {
    if (!panel.result.ok) return Number.NEGATIVE_INFINITY;
    const fit = panel.result.fit;
    if (sort === "q_value") return -(panel.qValue ?? 1);
    if (sort === "spearman") return Math.abs(fit.spearmanCorrelation ?? 0);
    if (sort === "r_squared") return fit.rSquared ?? 0;
    return 0;
  };
  if (sort === "catalog") return copy;
  return copy.sort((left, right) => score(right) - score(left));
}

// ─── Assembling the variables ────────────────────────────────────────────────

/**
 * Identifies a bar window. Aligned lake columns carry the key of the bars they
 * were aligned to and are only ever paired with bars that have the same key —
 * an array aligned to one window, indexed against another, would pair every
 * value with the wrong bar and nothing would look wrong.
 */
export function barsKey(bars: ReadonlyArray<OhlcvData> | undefined): string {
  if (!bars || bars.length === 0) return "empty";
  return `${bars.length}:${bars[0]!.timestamp}:${bars[bars.length - 1]!.timestamp}`;
}

export interface AlignedColumn {
  id: string;
  /** One value per bar, in bar order. Null where the lake has nothing for that bar. */
  values: Array<number | null>;
  /** Bars that found a value. */
  matchedBars: number;
  emptyReason?: string;
}

export interface AlignedColumns {
  barsKey: string;
  columns: Map<string, AlignedColumn>;
}

export interface VariableFilter {
  includeForwardLooking: boolean;
  includePriceLevel: boolean;
}

export function selectLakeVariables(
  variables: ReadonlyArray<RegressionVariable>,
  filter: VariableFilter,
): RegressionVariable[] {
  return variables.filter(
    (variable) =>
      (filter.includeForwardLooking || !variable.forwardLooking) &&
      (filter.includePriceLevel || !variable.priceLevel),
  );
}

/** The bar-derived variables, then every selected lake column aligned to these bars. */
export function assemblePanelVariables(
  bars: ReadonlyArray<OhlcvData>,
  lakeVariables: ReadonlyArray<RegressionVariable>,
  columns: AlignedColumns | undefined,
): PanelVariable[] {
  if (bars.length === 0) return [];
  const variables: PanelVariable[] = BAR_VARIABLES.map((variable) => ({
    id: variable.id,
    label: variable.label,
    family: variable.family,
    source: "bar",
    detail: variable.definition,
    forwardLooking: false,
    priceLevel: false,
    containsClose: variable.containsClose,
    values: variable.compute(bars),
    matchedBars: bars.length,
  }));
  if (!columns || columns.barsKey !== barsKey(bars)) return variables;
  for (const variable of lakeVariables) {
    const aligned = columns.columns.get(variable.id);
    if (!aligned) continue;
    variables.push({
      id: variable.id,
      label: variable.bucketingNote ? `${variable.label} (${variable.bucketingNote})` : variable.label,
      family: variable.family,
      source: "lake",
      detail: `${variable.object}.${variable.column}`,
      forwardLooking: variable.forwardLooking,
      priceLevel: variable.priceLevel,
      containsClose: false,
      values: aligned.values,
      matchedBars: aligned.matchedBars,
      ...(aligned.emptyReason ? { emptyReason: aligned.emptyReason } : {}),
    });
  }
  return variables;
}

/** Every typed-array buffer in the panels, so the worker can transfer rather than copy them. */
export function panelBuffers(panels: ReadonlyArray<PanelModel>): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const add = (array: { buffer: ArrayBufferLike }) => {
    if (array.buffer instanceof ArrayBuffer) buffers.add(array.buffer);
  };
  for (const panel of panels) {
    add(panel.pairs.x);
    add(panel.pairs.y);
    add(panel.pairs.barIndex);
    for (const result of [panel.result, panel.refit]) {
      if (!result || !result.ok) continue;
      const fit = result.fit;
      for (const array of [
        fit.fitted, fit.residuals, fit.leverage, fit.studentizedInternal, fit.studentizedExternal,
        fit.cookDistance, fit.verticalOutlier, fit.influential,
      ]) add(array);
    }
  }
  return [...buffers];
}
