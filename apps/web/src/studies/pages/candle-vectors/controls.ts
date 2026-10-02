/**
 * Every control of the notebook, with its default, kept in the URL by
 * useStudyControls. One object for the whole page so a link reproduces the
 * exact view of every tab.
 */

import type { useStudyControls } from "@/studies/kit";

export const DEFAULTS = {
  tab: "anatomy",
  // the notebook's three pickers at the top
  timeframe: "1h",
  pattern: "hammer",
  horizon: 4,
  // 1 · a window becomes 64 numbers
  occurrence: 1,
  scale: 1,
  shift: 0,
  // 2 · where each pattern sits
  projection: "the recogniser's 32 internal numbers",
  mapShown: "all",
  mapOpacity: 0.35,
  perPattern: 1200,
  mapZoom: 99,
  // 3 · pointing it out
  model: "neural network",
  evaluationSet: "1m 2025 (held out)",
  threshold: 0.5,
  // 4 · nearest past windows
  neighbourVector: "shape",
  neighbourCount: 8,
  neighbourOccurrence: 1,
  // 6 · does the neighbourhood know
  evaluationVector: "shape",
  nearest: 50,
  // 8 · every column
  logCounts: false,
  bins: 40,
  // 9 · the shape learned without labels
  shapeOccurrence: 1,
  shapeModel: "last-three-candle autoencoder",
  hidden: "0",
  vocabulary: "last-three-candle vector-quantised",
  vocabularyOrder: "most over-represented TA-Lib name",
  vocabularyCode: 0,
  emergenceCheck: "nearest-window lift",
  learnedMethod: "last-three-candle autoencoder (8)",
  learnedZoom: 99,
  // 10 · the next six candles
  nextTimeframe: "15m",
  family: "TA-Lib pattern",
  split: "discovery",
  candle: 3,
  patternSide: "",
  tail: 98,
  gridMeasure: "net_mean_ticks",
};

export type Controls = ReturnType<typeof useStudyControls<typeof DEFAULTS>>[0];
export type SetControl = <K extends keyof Controls>(key: K, value: Controls[K]) => void;
export interface TabProps { controls: Controls; set: SetControl }
