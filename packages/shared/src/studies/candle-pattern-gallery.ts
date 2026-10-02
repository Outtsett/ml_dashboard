/**
 * Candle pattern gallery: example bars for each of the 61 TA-Lib candlestick
 * patterns on MNQ 5-minute bars. Replaced Trading/quant/chart_cnn/pkg/gallery.py.
 *
 * Reads three views landed by packages/ml-engine/src/studies/candle_pattern_gallery/build.py
 * (the notebook's pattern_images/index.csv and summary.csv, plus the 48 bars
 * ending at every example, which all three of the notebook's views crop):
 *   derived_study_candle_pattern_gallery_summary      61 rows, one per pattern
 *   derived_study_candle_pattern_gallery_examples     1,013 rows: 914 real, 99 synthetic
 *   derived_study_candle_pattern_gallery_window_bars  48,624 rows: 48 bars per example
 *
 * Also holds the one piece of arithmetic the server and the page share: how
 * the chart-CNN's input image is drawn from 48 bars (chart_cnn render.py), so
 * the page can show the exact raster the network sees.
 */

/** chart_cnn render.py constants: 48 bars, 3 pixel columns per bar, 72 price rows, 20 volume rows. */
export const MODEL_INPUT = {
  bars: 48,
  pixelsPerBar: 3,
  pricePixels: 72,
  volumePixels: 20,
  /** Price rows + volume rows + 2 spacer rows, exactly render.py's H. */
  height: 72 + 20 + 2,
  width: 48 * 3,
} as const;

/** render_pattern.py: each pattern is drawn on a canvas five candles wide. */
export const PATTERN_CANVAS_BARS = 5;
/** gallery_patterns.py render_zoom: the last eight bars. */
export const ZOOM_BARS = 8;

export type ExampleSource = "real_mnq_5m" | "random_search_synthetic" | "textbook_synthetic";
export type PatternSide = "bullish" | "bearish";

/** One pattern of the notebook's 61-row summary table, full-word columns. */
export interface GallerySummaryRow {
  talib_function: string;
  /** How many bars the TA-Lib rule reads (1 to 5). */
  pattern_bar_count: number;
  /** Firings on MNQ 5-minute bars from 2019 to 2025, every one, not only the ones kept as examples. */
  real_hit_count: number;
  bullish_real_hit_count: number;
  bearish_real_hit_count: number;
  real_example_count: number;
  random_search_synthetic_example_count: number;
  textbook_synthetic_example_count: number;
  example_count: number;
}

/** One bar of an example's 48-bar window. bar_offset 0 is the bar the pattern fired on. */
export interface GalleryBar {
  bar_offset: number;
  is_pattern_bar: boolean;
  /** Epoch milliseconds of the lake stamp; null for a synthetic example (it has no clock). */
  bar_timestamp_ms: number | null;
  /** Absolute prices, labelled as such in the lake; shown on the chart's own scale, never inside a distance. */
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GalleryExample {
  example_id: string;
  pattern_side: PatternSide;
  is_synthetic: boolean;
  example_source: ExampleSource;
  /** Row in chart_cnn's private 5-minute resample (real examples only). */
  bar_index: number | null;
  pattern_bar_count: number;
  bar_timestamp_ms: number | null;
  /** 48 bars, oldest first; the last is the firing bar. */
  bars: GalleryBar[];
}

export interface GalleryBody {
  summary: GallerySummaryRow[];
  /** The pattern whose examples follow (the requested one, or the first that has examples). */
  pattern: string | null;
  examples: GalleryExample[];
}

export const EMPTY_BODY: GalleryBody = { summary: [], pattern: null, examples: [] };

/** One row of `window_bars` as the handler reads it. */
export interface WindowBarRow {
  example_id: string;
  bars_before_firing: number;
  is_pattern_bar: boolean;
  bar_timestamp_ms: number | null;
  absolute_open_price: number;
  absolute_high_price: number;
  absolute_low_price: number;
  absolute_close_price: number;
  volume: number;
}

/** Groups window rows (ordered by example, then position) under their example. */
export function groupWindows(rows: readonly WindowBarRow[]): Map<string, GalleryBar[]> {
  const grouped = new Map<string, GalleryBar[]>();
  for (const row of rows) {
    const bars = grouped.get(row.example_id) ?? [];
    bars.push({
      bar_offset: row.bars_before_firing,
      is_pattern_bar: row.is_pattern_bar,
      bar_timestamp_ms: row.bar_timestamp_ms,
      open: row.absolute_open_price,
      high: row.absolute_high_price,
      low: row.absolute_low_price,
      close: row.absolute_close_price,
      volume: row.volume,
    });
    grouped.set(row.example_id, bars);
  }
  return grouped;
}

/** The pixel row of a price on the model's input image (render.py's `y`): row 0 is the top. */
export function modelInputRow(price: number, windowLow: number, windowRange: number): number {
  return MODEL_INPUT.pricePixels - 1 - Math.trunc(((price - windowLow) / windowRange) * (MODEL_INPUT.pricePixels - 1));
}

/** The number of pixel rows a bar's volume fills (render.py's `vh`). */
export function modelInputVolumeRows(volume: number, windowMaximumVolume: number): number {
  return Math.trunc((volume / windowMaximumVolume) * (MODEL_INPUT.volumePixels - 1));
}

export interface ModelInputScale {
  windowLow: number;
  windowHigh: number;
  /** max(high - low, 1e-9), exactly render.py's `rng`. */
  windowRange: number;
  /** max(volume, 1e-9), exactly render.py's `vmax`. */
  windowMaximumVolume: number;
}

export function modelInputScale(bars: readonly GalleryBar[]): ModelInputScale {
  let windowLow = Infinity;
  let windowHigh = -Infinity;
  let maximumVolume = -Infinity;
  for (const bar of bars) {
    if (bar.low < windowLow) windowLow = bar.low;
    if (bar.high > windowHigh) windowHigh = bar.high;
    if (bar.volume > maximumVolume) maximumVolume = bar.volume;
  }
  return {
    windowLow,
    windowHigh,
    windowRange: Math.max(windowHigh - windowLow, 1e-9),
    windowMaximumVolume: Math.max(maximumVolume, 1e-9),
  };
}

/**
 * The chart-CNN's exact input: render.py's binary image of the last 48 bars,
 * one byte per pixel (255 lit, 0 dark), row-major, `MODEL_INPUT.height` rows of
 * `MODEL_INPUT.width`. Per bar i (x = 3 i): the high-to-low wick on column
 * x + 1, the open tick on column x, the close tick on column x + 2, and the
 * volume bar on column x + 1 rising from the bottom edge.
 */
export function renderModelInput(bars: readonly GalleryBar[]): Uint8Array {
  const { width, height, bars: barCount, pixelsPerBar } = MODEL_INPUT;
  const pixels = new Uint8Array(width * height);
  if (bars.length !== barCount) return pixels;
  const scale = modelInputScale(bars);
  const row = (price: number) => modelInputRow(price, scale.windowLow, scale.windowRange);
  for (let i = 0; i < barCount; i += 1) {
    const bar = bars[i] as GalleryBar;
    const x = i * pixelsPerBar;
    for (let y = row(bar.high); y <= row(bar.low); y += 1) pixels[y * width + x + 1] = 255;
    pixels[row(bar.open) * width + x] = 255;
    pixels[row(bar.close) * width + x + 2] = 255;
    const volumeRows = modelInputVolumeRows(bar.volume, scale.windowMaximumVolume);
    for (let y = height - 1 - volumeRows; y < height; y += 1) pixels[y * width + x + 1] = 255;
  }
  return pixels;
}

/** yyyy-mm-dd hh:mm of the lake stamp, read as written (the lake's wall clock), or a dash. */
export function formatStamp(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return "—";
  return new Date(milliseconds).toISOString().slice(0, 16).replace("T", " ");
}

export const SOURCE_LABEL: Record<ExampleSource, string> = {
  real_mnq_5m: "real",
  random_search_synthetic: "synthetic (random search)",
  textbook_synthetic: "synthetic (textbook)",
};
