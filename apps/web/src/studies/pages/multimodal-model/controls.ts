/**
 * Every control of the page with its default, kept in the URL by
 * useStudyControls: one object for all tabs, so a link reproduces the view.
 * `trial` and `window` also go to the server (they choose which run's rows
 * are read); the rest re-draw what the page already holds.
 */

import type { useStudyControls } from "@/studies/kit";

export const DEFAULTS = {
  tab: "scoreboard",
  /** A development trial's recipe; empty means the highest profit factor, as the notebook's dropdown did. */
  trial: "",
  /** canonical = 2021Q2..2025Q2, the window the trial table is scored on; all = every landed development quarter. */
  window: "canonical",
  // scoreboard: the what-if behind gates G3 and G4
  whatIfWinRate: 0.4,
  whatIfPayoff: 3,
  scoreboardSort: "trial",
  scoreboardDescending: false,
  // trial detail
  bins: 60,
  // calibration
  calibrationHead: "long_r2",
  rank: 50,
  // base rates
  baseRecipe: "bracket_atr1_r2_r3_v1",
  breakdown: "decision_hour",
  // audit record
  evidence: "all",
  relevantOnly: false,
  search: "",
  auditPage: 1,
};

export type Controls = ReturnType<typeof useStudyControls<typeof DEFAULTS>>[0];
export type SetControl = <K extends keyof Controls>(key: K, value: Controls[K]) => void;
export interface TabProps {
  controls: Controls;
  set: SetControl;
}
