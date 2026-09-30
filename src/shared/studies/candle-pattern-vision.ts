/**
 * Candle pattern vision: an image model (residual CNN or vision transformer) that recognises
 * TA-Lib's 61 candlestick patterns — 88 (pattern, direction) classes — from a picture of the last
 * 20 MNQ 1-minute bars. Trained by the runner candle_vision+talib_pattern_recognition
 * (src/ml/candle_vision/main.py), landed per run as derived_candle_pattern_vision_<table>
 * with recipe = the run.
 */

export const VISION_TABLES = [
  "runs", "class_metrics", "epochs", "samples", "pattern_confusion", "exemplars", "splits", "label_agreement", "synthetic_generation",
] as const;
export type VisionTable = (typeof VISION_TABLES)[number];
export const visionView = (table: VisionTable) => `derived_candle_pattern_vision_${table}`;

export interface VisionRun {
  recipe: string;
  model_id: string;
  architecture: "cnn" | "vit";
  parameters: number;
  epochs: number;
  best_epoch: number;
  batch_size: number;
  learning_rate: number;
  samples_per_epoch: number;
  train_minimum: number;
  evaluation_minimum: number;
  real_windows: number;
  synthetic_windows: number;
  classes: number;
  talib_disagreeing_bar_patterns: number;
  duration_seconds: number;
  test_real_macro_f1: number;
  test_real_macro_average_precision: number;
  test_synthetic_macro_f1: number;
  classes_measurable_on_real_test: number;
}

export interface ClassMetric {
  class_name: string;
  pattern: string;
  direction: string;
  split: "validation" | "test";
  source: "real" | "synthetic" | "all";
  windows: number;
  positives: number;
  true_positives: number;
  false_positives: number;
  false_negatives: number;
  true_negatives: number;
  threshold: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  area_under_roc_curve: number | null;
  average_precision: number | null;
}

export interface EpochRow {
  epoch: number;
  train_loss: number;
  validation_loss: number;
  validation_macro_average_precision: number;
  learning_rate: number;
  elapsed_seconds: number;
}

export interface SampleCount {
  class_name: string;
  split: "train" | "validation" | "test";
  source: "real" | "synthetic";
  windows: number;
}

export interface ConfusionCell {
  true_pattern: string;
  called_pattern: string;
  bars_with_true_pattern: number;
  model_share_percent: number;
  talib_share_percent: number;
}

export interface Exemplar {
  class_name: string;
  kind: "real hit" | "real miss" | "real false alarm" | "synthetic hit";
  score: number;
  threshold: number;
  bar_timestamp: number | null;
  talib_classes: string;
  model_classes: string;
  model_input_png_base64: string;
}

export interface SplitSpan {
  split: string;
  first_bar: number;
  last_bar: number;
  trading_days: number;
  bars: number;
}

export interface VisionBody {
  runs: VisionRun[];
  run: VisionRun | null;
  classMetrics: ClassMetric[];
  epochs: EpochRow[];
  samples: SampleCount[];
  confusion: ConfusionCell[];
  splits: SplitSpan[];
  /** exemplars of the selected class only (images are ~3 kB each) */
  exemplars: Exemplar[];
}
