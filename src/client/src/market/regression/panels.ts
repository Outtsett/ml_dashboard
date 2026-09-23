/**
 * One regression per X variable — the model behind every panel.
 *
 * Pure: bars and aligned columns in, fitted panels out. The page runs it in a
 * deferred render so dragging the horizon slider never blocks the controls.
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
import type { SeriesFamily } from "@shared/series/types";

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

export interface PanelSettings {
  mode: ResponseMode;
  horizonBars: number;
  confidenceLevel: number;
  cookCutoff: CookCutoffRule;
  refitWithoutFlagged: boolean;
}

export interface PanelModel {
  variable: PanelVariable;
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
    return { variable, pairs, result, refit, buckets, qValue: null };
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
