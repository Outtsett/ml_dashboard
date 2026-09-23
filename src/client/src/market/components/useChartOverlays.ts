import { useEffect, useRef } from 'react';
import {
  LineSeries, AreaSeries,
  LineStyle, type CandlestickData, type IChartApi, type ISeriesApi, type Time,
} from 'lightweight-charts';
import { PatternLabelPrimitive, type PatternLabel } from './PatternLabelPrimitive';
import {
  selectBestMatchPerBar,
  firingKey,
  type PatternFiring,
} from '@/market/lib/bestPatternMatch';
import { chartLabelForColumn } from '@/market/lib/candlePatternCatalog';
import type { IndicatorOverlay } from "@/market/lib/useIndicatorData";
import { getPatternDisplayName } from "@/market/lib/candle_patterns";
import { getSeriesTitle } from "@/market/lib/indicator_panels";
import { colorToRgba } from '@/market/lib/indicator_colors';
import { dedupByTime, volumeScaleMargins } from './chartConfig';

/**
 * What the overlay map holds: indicator lines and band fills, nothing else.
 *
 * Contextual pattern labels used to be parked in this same map under a
 * `__cdl_markers__` key as a markers plugin, which forced every read to narrow a
 * three-way union. They now live in their own primitive (PatternLabelPrimitive),
 * so this map holds one kind of thing again.
 */
type OverlayEntry = ISeriesApi<'Line'> | ISeriesApi<'Area'>;

// ─── Band / line classification helpers ──────────────────────────────────────

/** Output keys that represent the upper boundary of a band indicator */
const UPPER_BAND_KEYS = new Set(['upper', 'senkouA']);
/** Output keys that represent the lower boundary of a band indicator */
const LOWER_BAND_KEYS = new Set(['lower', 'senkouB']);
/** Output keys for the center / middle line of a band indicator */
const MIDDLE_BAND_KEYS = new Set(['middle', 'kijun']);
/** Output keys for signal / trigger lines (subordinate) */
const SIGNAL_KEYS = new Set(['signal', 'trigger']);
/** Output keys that get low-opacity treatment */
const FAINT_KEYS = new Set(['chikou']);

/**
 * Parse an instance-based column ("instanceId::outputKey") and return the
 * outputKey, or '' for legacy column formats.
 */
function extractOutputKey(column: string): string {
  const idx = column.indexOf('::');
  if (idx === -1) return '';
  return column.slice(idx + 2);
}

/**
 * Determine the opacity multiplier for a given output key.
 * Band edges and subordinate lines are rendered at reduced opacity
 * so they don't compete visually with the main price action.
 */
function getLineOpacity(outputKey: string): number {
  if (FAINT_KEYS.has(outputKey)) return 0.5;
  if (UPPER_BAND_KEYS.has(outputKey) || LOWER_BAND_KEYS.has(outputKey)) return 0.7;
  if (SIGNAL_KEYS.has(outputKey)) return 0.8;
  return 1.0;
}

/**
 * Snap a marker timestamp to the nearest candle time.
 * Uses binary search for O(log n) lookup.
 * Returns the matched candle time, or -1 if no candle is close enough.
 *
 * @param markerTime - Marker timestamp in seconds
 * @param sortedCandleTimes - Sorted array of candle timestamps in seconds
 * @param maxGapSec - Maximum allowed gap (half a candle interval)
 */
function snapToCandle(
  markerTime: number,
  sortedCandleTimes: number[],
  maxGapSec: number,
): number {
  const len = sortedCandleTimes.length;
  if (len === 0) return -1;

  let lo = 0;
  let hi = len - 1;

  // Binary search for closest
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const midVal = sortedCandleTimes[mid]!;
    if (midVal === markerTime) return midVal;
    if (midVal < markerTime) lo = mid + 1;
    else hi = mid - 1;
  }

  // lo is the insertion point — check lo and lo-1 for closest
  let best = -1;
  let bestDist = Infinity;
  for (const idx of [lo - 1, lo]) {
    if (idx >= 0 && idx < len) {
      const dist = Math.abs(sortedCandleTimes[idx]! - markerTime);
      if (dist < bestDist) {
        bestDist = dist;
        best = sortedCandleTimes[idx]!;
      }
    }
  }

  return bestDist <= maxGapSec ? best : -1;
}

/**
 * Manages indicator overlay series on the main chart.
 * Handles adding/removing/updating LineSeries for overlay indicators,
 * and CDL pattern markers via createSeriesMarkers.
 */
export function useChartOverlays(
  chartRef: React.RefObject<IChartApi | null>,
  candleSeriesRef: React.RefObject<ISeriesApi<'Candlestick'> | null>,
  indicatorOverlays: IndicatorOverlay[],
  candles: CandlestickData<Time>[],
) {
  const overlaySeriesRef = useRef<Map<string, OverlayEntry>>(new Map());
  const patternLabelsRef = useRef<PatternLabelPrimitive | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      overlaySeriesRef.current.clear();
      patternLabelsRef.current = null;
    };
  }, []);

  // Crosshair -> hovered bar. In dense mode the pattern names are shown for the
  // bar under the cursor rather than for every bar at once, so the primitive
  // needs to know where the crosshair is.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = (param: { time?: Time }) => {
      const time = param.time === undefined ? null : (param.time as number);
      patternLabelsRef.current?.setHoveredTime(time);
    };
    chart.subscribeCrosshairMove(handler);
    return () => {
      chart.unsubscribeCrosshairMove(handler);
    };
  }, [chartRef]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const currentKeys = new Set(indicatorOverlays.map(o => o.column));
    const markerKeys = new Set(
      indicatorOverlays.filter(o => o.displayType === 'marker').map(o => o.column),
    );
    const existingKeys = Array.from(overlaySeriesRef.current.keys());

    // Remove line series that are no longer selected. Marker-type overlays are
    // skipped because they never had a LineSeries — they are drawn by the
    // pattern-label primitive.
    for (const key of existingKeys) {
      if (markerKeys.has(key)) continue;
      if (!currentKeys.has(key)) {
        const series = overlaySeriesRef.current.get(key);
        if (series) {
          try { chart.removeSeries(series); } catch { /* series already removed from chart */ }
        }
        overlaySeriesRef.current.delete(key);
      }
    }

    // Add or update overlay series
    for (const overlay of indicatorOverlays) {
      const existing = overlaySeriesRef.current.get(overlay.column);
      // One indicator must not be able to blank the chart. lightweight-charts
      // asserts on a value outside ±9.007e13 (Number.MAX_SAFE_INTEGER / 100),
      // and the assertion escapes to the error boundary, so the candles, every
      // other overlay and the whole Market page disappear behind "Something went
      // wrong" — which is exactly what a diverging HWMA did until 2026-09-15.
      // Drop the unplottable points and keep drawing the rest.
      const seriesData = dedupByTime(
        overlay.data
          .filter(d => Number.isFinite(d.value) && Math.abs(d.value) <= 9.007e13)
          .map(d => ({ time: d.time as Time, value: d.value })),
      );

      if (existing) {
        existing.setData(seriesData);
      } else if (overlay.displayType === 'marker') {
        // Contextual pattern labels — drawn by the primitive below
      } else {
        const outputKey = extractOutputKey(overlay.column);
        const isUpper = UPPER_BAND_KEYS.has(outputKey);
        const isLower = LOWER_BAND_KEYS.has(outputKey);
        const isMiddle = MIDDLE_BAND_KEYS.has(outputKey);
        const isSignal = SIGNAL_KEYS.has(outputKey);

        // Apply opacity to the line color for subordinate lines
        const opacity = getLineOpacity(outputKey);
        const effectiveColor = opacity < 1.0
          ? colorToRgba(overlay.color, opacity)
          : overlay.color;

        let series: ISeriesApi<'Line'> | ISeriesApi<'Area'>;

        if (isUpper || isLower) {
          // Band boundary lines — use AreaSeries for subtle shaded fill
          const fillColor = colorToRgba(overlay.color, 0.06);
          const transparent = 'rgba(0, 0, 0, 0)';

          series = chart.addSeries(AreaSeries, {
            lineColor: effectiveColor,
            lineWidth: overlay.lineWidth as 1 | 2 | 3 | 4,
            lineStyle: LineStyle.Solid,
            // Upper band: fill downward (topColor transparent, bottomColor shaded)
            // Lower band: fill upward (topColor shaded, bottomColor transparent)
            topColor: isUpper ? transparent : fillColor,
            bottomColor: isUpper ? fillColor : transparent,
            // For lower bands, invert so fill extends above the line
            invertFilledArea: isLower,
            priceScaleId: 'right',
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
            title: getSeriesTitle(overlay.column),
          });
        } else {
          // Regular LineSeries for middle, signal, and all other lines
          series = chart.addSeries(LineSeries, {
            color: effectiveColor,
            lineWidth: (isMiddle ? 2 : overlay.lineWidth) as 1 | 2 | 3 | 4,
            lineStyle: isSignal ? LineStyle.Dashed
                     : FAINT_KEYS.has(outputKey) ? LineStyle.Dotted
                     : LineStyle.Solid,
            priceScaleId: 'right',
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 3,
            title: getSeriesTitle(overlay.column),
          });
        }

        series.setData(seriesData);
        overlaySeriesRef.current.set(overlay.column, series);
      }
    }

    // ── Contextual pattern labels ────────────────────────────────────────
    //
    // Drawn by a series primitive, not by createSeriesMarkers. The built-in
    // marker centres its text on the bar's x coordinate, and a label such as
    // "Gravestone Doji (TA-Lib)" is roughly 150px wide against a 6px bar, so the
    // text painted straight across twenty neighbouring candles and over other
    // labels. The primitive anchors each label outside the bar's high/low and
    // pushes collisions further away, never toward the candle.
    //
    // This applies to labels that annotate a bar. Moving averages and band
    // edges are deliberately untouched above: tracing the price through the
    // candles is what they mean.
    if (candleSeriesRef.current) {
      const patternOverlays = indicatorOverlays.filter(o => o.displayType === 'marker');

      if (patternOverlays.length > 0) {
        const sortedCandleTimes = candles
          .map(d => d.time as number)
          .sort((a, b) => a - b);

        const barByTime = new Map<
          number,
          { open: number; high: number; low: number; close: number }
        >();
        for (const candle of candles) {
          barByTime.set(candle.time as number, {
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          });
        }

        // Candles are evenly spaced, so the first interval represents the rest.
        let maxGapSec = 60;
        if (sortedCandleTimes.length >= 2) {
          maxGapSec = Math.max(sortedCandleTimes[1]! - sortedCandleTimes[0]!, 60);
        }

        // Built in two passes: collect every firing with the bar's shape, then
        // let bestPatternMatch decide which single pattern each candle is
        // labelled with. Five rules routinely fire on one small-bodied bar, and
        // drawing all five is what buried the price.
        const draft: Array<PatternLabel & { patternColumn: string }> = [];
        const firings: PatternFiring[] = [];
        const seenPerTime = new Map<number, Set<string>>();

        for (const overlay of patternOverlays) {
          // Name plus what kind of claim it makes: "Morning Star (reversal)".
          const text = chartLabelForColumn(
            overlay.column,
            getPatternDisplayName(overlay.column),
          );
          for (const point of overlay.data) {
            const snapped = snapToCandle(point.time, sortedCandleTimes, maxGapSec);
            if (snapped === -1) continue;
            const bar = barByTime.get(snapped);
            if (!bar) continue;

            let seen = seenPerTime.get(snapped);
            if (!seen) { seen = new Set(); seenPerTime.set(snapped, seen); }
            if (seen.has(text)) continue;
            seen.add(text);

            // Shape as fractions of the bar's own range, so the comparison is
            // about geometry and not about price level. A zero-range bar has no
            // shape to speak of and is left at zero rather than dividing by it.
            const totalRange = bar.high - bar.low;
            const safeRange = totalRange > 0 ? totalRange : Number.NaN;
            const bodyFraction = Math.abs(bar.close - bar.open) / safeRange;
            const upperShadowFraction =
              (bar.high - Math.max(bar.open, bar.close)) / safeRange;
            const lowerShadowFraction =
              (Math.min(bar.open, bar.close) - bar.low) / safeRange;

            draft.push({
              time: snapped,
              high: bar.high,
              low: bar.low,
              text,
              direction: point.value > 0 ? 1 : -1,
              color: point.value > 0 ? '#E69F00' : '#0072B2',
              isBestMatch: false,
              patternColumn: overlay.column,
            });
            firings.push({
              time: snapped,
              patternColumn: overlay.column,
              bodyFraction: Number.isFinite(bodyFraction) ? bodyFraction : 0,
              upperShadowFraction: Number.isFinite(upperShadowFraction) ? upperShadowFraction : 0,
              lowerShadowFraction: Number.isFinite(lowerShadowFraction) ? lowerShadowFraction : 0,
            });
          }
        }

        const winners = selectBestMatchPerBar(firings);
        const labels: PatternLabel[] = draft.map(entry => ({
          time: entry.time,
          high: entry.high,
          low: entry.low,
          text: entry.text,
          direction: entry.direction,
          color: entry.color,
          isBestMatch: winners.has(firingKey(entry.time, entry.patternColumn)),
        }));

        labels.sort((a, b) => a.time - b.time);

        if (!patternLabelsRef.current) {
          const primitive = new PatternLabelPrimitive();
          // The volume histogram occupies the bottom slice of the same pane.
          primitive.reservedBottomFraction = 1 - volumeScaleMargins.top;
          candleSeriesRef.current.attachPrimitive(primitive);
          patternLabelsRef.current = primitive;
        }
        patternLabelsRef.current.setBars(
          candles.map(c => ({ time: c.time as number, high: c.high, low: c.low })),
        );
        patternLabelsRef.current.setLabels(labels);
      } else {
        patternLabelsRef.current?.setLabels([]);
      }
    }
  }, [chartRef, candleSeriesRef, indicatorOverlays, candles]);

  return overlaySeriesRef;
}
