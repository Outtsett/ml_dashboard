/**
 * Candlestick pattern images: one picture per TA-Lib pattern (per direction it fires in), cut from the
 * MNQ 1-minute bar where it fired whose shape is the most typical, showing only the pattern's own
 * candles. Landed by src/ml/studies/candlestick_pattern_images/build.py.
 */

export const PATTERN_IMAGES_VIEW = "derived_study_candlestick_pattern_images";

export interface PatternImage {
  pattern: string;
  direction: "bullish" | "bearish" | "neutral";
  class_name: string;
  talib_function: string;
  candle_count: number;
  firings: number;
  first_candle_timestamp: number | null;
  signal_candle_timestamp: number | null;
  contract_symbol: string | null;
  talib_value: number | null;
  distance_to_median_shape: number | null;
  candles_absolute_ohlc_json: string | null;
  image_png_base64: string | null;
}

export interface PatternImagesBody {
  images: PatternImage[];
}
