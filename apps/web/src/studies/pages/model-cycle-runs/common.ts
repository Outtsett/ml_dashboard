/**
 * Controls, data hooks and small helpers shared by the tabs. Every control
 * lives in the URL (useStudyControls), so any view of the page is a link.
 */

import { fmtTime, OKABE, useStudyQuery, type useStudyControls } from "@/studies/kit";
import type { ModelCycleRunsBody, OverviewBody, RunBody } from "@shared/studies/model-cycle-runs";

export const SLUG = "model-cycle-runs";

export const DEFAULTS = {
  tab: "runs",
  /** Empty = the newest run that has predictions (the server's default). */
  recipe: "",
  bins: 40,
  /** One metric to chart across the run and its folds ("" = none chosen). */
  metric: "",
  showTrials: false,
  /** Bars read so far for the running Sharpe stepper (0 = every bar). */
  sharpeBars: 0,
  /** Bin reached by the expected-calibration-error stepper (0 = all of them). */
  calibrationBin: 0,
};

type Tuple = ReturnType<typeof useStudyControls<typeof DEFAULTS>>;
export type Controls = Tuple[0];
export type SetControl = Tuple[1];

export function useOverview() {
  return useStudyQuery<ModelCycleRunsBody>(SLUG, { part: "overview" });
}

export function useRun(recipe: string, bins: number, enabled: boolean) {
  return useStudyQuery<ModelCycleRunsBody>(SLUG, { part: "run", recipe, bins }, { enabled });
}

/** Epoch seconds (the lake's wall-clock stamp) as "YYYY-MM-DD HH:MM". */
export function stamp(seconds: number | null | undefined): string {
  return seconds === null || seconds === undefined ? "—" : fmtTime(seconds * 1000);
}

export function stampCell(value: unknown): string {
  return typeof value === "number" ? stamp(value) : "—";
}

/** Colours for up to eight named series, in Okabe-Ito order; always paired with a shape or label. */
export const PALETTE = [OKABE.orange, OKABE.blue, OKABE.sky, OKABE.green, OKABE.purple, OKABE.yellow, OKABE.vermillion, OKABE.grey];

export type ScatterShape = "circle" | "diamond" | "square" | "triangle" | "star" | "cross" | "wye";
export const SHAPES: ScatterShape[] = ["circle", "diamond", "square", "triangle", "star", "cross", "wye"];
export const SHAPE_GLYPH: Record<ScatterShape, string> = { circle: "●", diamond: "◆", square: "■", triangle: "▲", star: "★", cross: "✚", wye: "Y" };

/** Recipe name shortened for a chart axis or a tooltip headline. */
export function shortRecipe(recipe: string): string {
  return recipe.replace(/^MNQ_5m_/, "").replace("_walk_forward_cycle", "");
}

/** What every tab receives. `run` is the chosen recipe's body (empty until it loads). */
export interface TabProps {
  controls: Controls;
  set: SetControl;
  overview: OverviewBody;
  run: RunBody;
  /** The recipe the run panels show. */
  recipe: string;
}
