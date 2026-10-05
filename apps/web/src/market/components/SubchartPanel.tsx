/**
 * SubchartPanel — an independent lightweight-charts instance for a single
 * indicator group (e.g., RSI, MACD line+signal+histogram, Stochastic %K/%D).
 *
 * Each panel has:
 * - Its own Y-axis with proper scaling
 * - Reference/guide lines for well-known oscillators (RSI 30/70, etc.)
 * - A close button to deselect the indicator
 * - Time-axis sync with the main chart via imperative handle
 */

import { useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { MIN_BAR_SPACING_PX, DEFAULT_RIGHT_OFFSET } from './chartConfig';
import {
  createChart,
  ColorType,
  type IChartApi,
  type Time,
  BaselineSeries,
  LineSeries,
  HistogramSeries,
  LineType,
  type LogicalRange,
  type ISeriesApi,
  type SeriesType,
} from 'lightweight-charts';
import type { IndicatorOverlay } from "@/market/lib/useIndicatorData";
import { getPanelLabel, getReferenceLines, shouldRenderAsBaseline, shouldRenderAsHistogram, shouldRenderAsStep, getSeriesTitle, getHistogramStyle } from "@/market/lib/indicator_panels";
import { getHistogramColors } from '@/market/lib/indicator_colors';
import { CYCLE_COLORS } from '@/cycle/chartModel';
import { withAlpha } from '@/cycle/chartModel';

/** Deduplicate & sort series data by time (last-write-wins for dupes). Filters out invalid entries. */
function dedupByTime<T extends { time: Time }>(arr: T[]): T[] {
  const map = new Map<number, T>();
  for (const item of arr) {
    if (item.time == null) continue; // skip entries with missing time
    map.set(item.time as number, item);
  }
  const result: T[] = [];
  map.forEach(v => result.push(v));
  return result.sort((a, b) => (a.time as number) - (b.time as number));
}
import { X } from 'lucide-react';

export interface SubchartPanelHandle {
  setVisibleLogicalRange: (range: LogicalRange) => void;
}

interface SubchartPanelProps {
  panelKey: string;
  indicators: IndicatorOverlay[];
  height: number;
  showTimeAxis?: boolean;
  /**
   * Whether the panel offers a close button. A run's `P(up)` and equity panes
   * are not in the indicator selection, so a close button on them would remove
   * nothing and leave the panel standing.
   */
  closable?: boolean;
  onClose: (columns: string[]) => void;
  onVisibleLogicalRangeChange?: (range: LogicalRange) => void;
}

/** A drawn point, or a gap where the series has no value for that bar. */
type PanelPoint =
  | { time: Time; value: number; color?: string }
  | { time: Time };

/**
 * Whitespace for a non-finite value.
 *
 * A panel covers every bar of the chart, and a bar the producer had nothing for
 * (a bar no model was tested on) is a real absence. lightweight-charts breaks a
 * line at a whitespace point; passing the non-finite number through instead would
 * draw a value the data never took, and zero would claim a measurement.
 */
function toPoints(raw: { time: Time; value: number; color?: string }[]): PanelPoint[] {
  return raw.map((point) => (Number.isFinite(point.value) ? point : { time: point.time }));
}

const SubchartPanel = forwardRef<SubchartPanelHandle, SubchartPanelProps>(
  function SubchartPanel(
    { panelKey, indicators, height, showTimeAxis = false, closable = true, onClose, onVisibleLogicalRangeChange },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
     
    const seriesMapRef = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map());
    /**
     * What each series already holds: its point count and its first and last
     * time. An incoming set that extends exactly this is an APPEND, so only the
     * new tail is pushed. A training run rewrites every panel ten times a second
     * as bars arrive, and re-setting a whole panel's data each time is what made
     * that cost scale with the bars already drawn.
     */
    const appliedRef = useRef<Map<string, { count: number; first: Time; last: Time }>>(new Map());
     
    const priceLinesAddedRef = useRef(false);
    const isSyncingRef = useRef(false);

    const label = useMemo(() => getPanelLabel(panelKey), [panelKey]);
    const refLines = useMemo(() => getReferenceLines(panelKey), [panelKey]);

    // Stable ref for the range-change callback
    const onRangeChangeRef = useRef(onVisibleLogicalRangeChange);
    onRangeChangeRef.current = onVisibleLogicalRangeChange;

    // Expose imperative handle for time sync
    useImperativeHandle(ref, () => ({
      setVisibleLogicalRange: (range: LogicalRange) => {
        if (!chartRef.current) return;
        isSyncingRef.current = true;
        try {
          chartRef.current.timeScale().setVisibleLogicalRange(range);
        } catch {
          /* range may be out of data bounds */
        }
        requestAnimationFrame(() => {
          isSyncingRef.current = false;
        });
      },
    }), []);

    // ---- Create chart instance ----
    useEffect(() => {
      if (!containerRef.current) return;

      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: 'rgba(255, 255, 255, 0.5)',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
        },
        grid: {
          vertLines: { color: 'rgba(139, 92, 246, 0.04)' },
          horzLines: { color: 'rgba(139, 92, 246, 0.04)' },
        },
        crosshair: {
          mode: 0,
          vertLine: {
            color: 'rgba(139, 92, 246, 0.4)',
            width: 1,
            style: 2,
            labelBackgroundColor: 'rgba(139, 92, 246, 0.6)',
          },
          horzLine: {
            color: 'rgba(139, 92, 246, 0.4)',
            width: 1,
            style: 2,
            labelBackgroundColor: 'rgba(139, 92, 246, 0.6)',
          },
        },
        rightPriceScale: {
          borderColor: 'rgba(139, 92, 246, 0.12)',
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: {
          borderColor: 'rgba(139, 92, 246, 0.12)',
          timeVisible: true,
          secondsVisible: false,
          visible: showTimeAxis,
          // The main chart's logical range is pushed verbatim into this pane, and
          // lightweight-charts resolves it against THIS pane's rightOffset — so the offset has
          // to match the main chart's or the two panes frame different windows from one range.
          rightOffset: DEFAULT_RIGHT_OFFSET,
          barSpacing: 6,
          minBarSpacing: MIN_BAR_SPACING_PX, // same floor as the main chart: synced ranges must agree
          enableConflation: false,
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: true,
        },
        handleScale: {
          axisPressedMouseMove: true,
          mouseWheel: true,
          pinch: true,
        },
      });

      chartRef.current = chart;
      priceLinesAddedRef.current = false;

      // Time sync: notify parent of user-initiated range changes
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (isSyncingRef.current || !range || !onRangeChangeRef.current) return;
        onRangeChangeRef.current(range);
      });

      // Resize handling
      const handleResize = () => {
        if (containerRef.current) {
          chart.applyOptions({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
          });
        }
      };

      const ro = new ResizeObserver(handleResize);
      ro.observe(containerRef.current);
      handleResize();

      return () => {
        ro.disconnect();
        seriesMapRef.current.clear();
        appliedRef.current.clear();
        priceLinesAddedRef.current = false;
        chart.remove();
        chartRef.current = null;
      };
     
    }, []); // Deliberately stable — showTimeAxis handled via applyOptions below

    // Toggle time axis visibility without recreating the chart
    useEffect(() => {
      chartRef.current?.applyOptions({
        timeScale: { visible: showTimeAxis },
      });
    }, [showTimeAxis]);

    // ---- Update indicator data ----
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart) return;

      const currentKeys = new Set(indicators.map(i => i.column));
      const existingKeys = Array.from(seriesMapRef.current.keys());

      // Remove stale series
      for (const key of existingKeys) {
        if (!currentKeys.has(key)) {
          const s = seriesMapRef.current.get(key);
          if (s) {
            try { chart.removeSeries(s); } catch { /* already removed */ }
          }
          seriesMapRef.current.delete(key);
          appliedRef.current.delete(key);
        }
      }

      // Add/update each indicator line
      for (const indicator of indicators) {
        const existing = seriesMapRef.current.get(indicator.column);
        const isHisto = shouldRenderAsHistogram(indicator.column);
        const isBaseline = shouldRenderAsBaseline(indicator.column);

        const buildData = () =>
          toPoints(
            dedupByTime(
              isHisto
                ? (() => {
                    const histoStyle = getHistogramStyle(indicator.column);
                    if (histoStyle === 'ao') {
                      // Awesome Oscillator: orange when increasing, blue when
                      // decreasing (Okabe-Ito; the bar's height already carries sign).
                      return indicator.data.map((d, i) => ({
                        time: d.time as Time,
                        value: d.value,
                        color: i > 0 && d.value > indicator.data[i - 1]!.value
                          ? 'rgba(230, 159, 0, 0.75)'   // orange (increasing)
                          : 'rgba(0, 114, 178, 0.75)',  // blue (decreasing)
                      }));
                    }
                    if (histoStyle === 'squeeze') {
                      // Squeeze momentum: 4-color intensity
                      return indicator.data.map((d, i) => {
                        const prev = i > 0 ? indicator.data[i - 1]!.value : 0;
                        if (d.value >= 0) {
                          return {
                            time: d.time as Time,
                            value: d.value,
                            color: d.value > prev
                              ? 'rgba(230, 159, 0, 0.9)'    // strong orange (positive, strengthening)
                              : 'rgba(230, 159, 0, 0.4)',   // faint orange (positive, fading)
                          };
                        }
                        return {
                          time: d.time as Time,
                          value: d.value,
                          color: d.value < prev
                            ? 'rgba(0, 114, 178, 0.9)'    // strong blue (negative, strengthening)
                            : 'rgba(0, 114, 178, 0.4)',   // faint blue (negative, fading)
                        };
                      });
                    }
                    // Default: positive/negative coloring
                    const { positive, negative } = getHistogramColors(indicator.color);
                    return indicator.data.map(d => ({
                      time: d.time as Time,
                      value: d.value,
                      color: d.value >= 0 ? positive : negative,
                    }));
                  })()
                : indicator.data.filter(d => d.time != null).map(d => ({ time: d.time as Time, value: d.value }))
            )
          );

        const points = buildData();
        const first = points[0]?.time;
        const last = points[points.length - 1]?.time;

        if (existing) {
          const applied = appliedRef.current.get(indicator.column);
          // An append: the same first bar, the previous last bar still last-but-one,
          // and only new bars after it. Anything else (a recoloured bar, a gap
          // filled in, a shorter set) is a reset.
          const isAppend =
            applied !== undefined &&
            first !== undefined &&
            last !== undefined &&
            points.length > applied.count &&
            first === applied.first &&
            points[applied.count - 1]?.time === applied.last;

          if (isAppend) {
            for (let index = applied!.count; index < points.length; index += 1) {
              existing.update(points[index]! as never);
            }
          } else {
            existing.setData(points as never[]);
          }
        } else {
          const seriesTitle = getSeriesTitle(indicator.column);
          const series = isHisto
            ? chart.addSeries(HistogramSeries, {
                color: indicator.color,
                priceScaleId: 'right',
                lastValueVisible: false,
                priceLineVisible: false,
                title: seriesTitle,
              })
            : isBaseline
              ? chart.addSeries(BaselineSeries, {
                  baseValue: { type: 'price', price: 0 },
                  // Orange above zero, blue below: the fill is the reading, so it
                  // carries the sign and the line is only its edge.
                  topLineColor: CYCLE_COLORS.up,
                  topFillColor1: withAlpha(CYCLE_COLORS.up, 0.28),
                  topFillColor2: withAlpha(CYCLE_COLORS.up, 0.04),
                  bottomLineColor: CYCLE_COLORS.down,
                  bottomFillColor1: withAlpha(CYCLE_COLORS.down, 0.04),
                  bottomFillColor2: withAlpha(CYCLE_COLORS.down, 0.28),
                  lineWidth: 2,
                  priceScaleId: 'right',
                  lastValueVisible: true,
                  priceLineVisible: false,
                  title: seriesTitle,
                })
              : chart.addSeries(LineSeries, {
                  color: indicator.color,
                  lineWidth: indicator.lineWidth as 1 | 2 | 3 | 4,
                  // A discrete state holds until it changes; interpolating between
                  // two states draws a value the data never took.
                  lineType: shouldRenderAsStep(indicator.column)
                    ? LineType.WithSteps
                    : LineType.Simple,
                  priceScaleId: 'right',
                  lastValueVisible: true,
                  priceLineVisible: false,
                  crosshairMarkerVisible: true,
                  crosshairMarkerRadius: 2,
                  title: seriesTitle,
                });

          series.setData(points as never[]);
          seriesMapRef.current.set(indicator.column, series);
        }

        if (first !== undefined && last !== undefined) {
          appliedRef.current.set(indicator.column, { count: points.length, first, last });
        }
      }

      // Add reference lines once (on first series available)
      if (!priceLinesAddedRef.current && refLines.length > 0 && seriesMapRef.current.size > 0) {
        // Use the first non-histogram series, or any series
         
        let targetSeries: ISeriesApi<SeriesType> | undefined;
        for (const [col, s] of seriesMapRef.current) {
          if (!shouldRenderAsHistogram(col)) {
            targetSeries = s;
            break;
          }
        }
        targetSeries ??= seriesMapRef.current.values().next().value;

        if (targetSeries) {
          for (const line of refLines) {
            try {
              targetSeries.createPriceLine({
                price: line.value,
                color: line.color,
                lineWidth: 1,
                lineStyle: 2, // Dashed
                axisLabelVisible: true,
                axisLabelColor: line.color,
                title: '',
              });
            } catch {
              /* ignore */
            }
          }
          priceLinesAddedRef.current = true;
        }
      }
    }, [indicators, refLines]);

    const handleClose = useCallback(() => {
      onClose(indicators.map(i => i.column));
    }, [indicators, onClose]);

    return (
      <div
        className="relative border-t border-white/[0.06]"
        style={{ height, flexShrink: 0 }}
      >
        {/* Panel header label */}
        <div className="absolute top-1 left-2 z-10 flex items-center gap-1.5 pointer-events-none select-none">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold font-mono text-violet-400/90 bg-black/50 backdrop-blur-sm rounded px-1.5 py-0.5">
            <span>{label}</span>
            {indicators.length > 1 &&
              indicators.map(ind => (
                <span
                  key={ind.column}
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: ind.color }}
                  title={getSeriesTitle(ind.column)}
                />
              ))}
          </div>
        </div>

        {/* Close button */}
        {closable && (
          <button
            onClick={handleClose}
            className="absolute top-1 right-8 z-10 h-4 w-4 rounded-sm flex items-center justify-center text-muted-foreground/30 hover:text-[hsl(var(--data-neg))] hover:bg-[hsl(var(--data-neg)/0.1)] transition-colors"
            title="Remove indicator"
          >
            <X className="h-3 w-3" />
          </button>
        )}

        {/* Chart container */}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    );
  },
);

export default SubchartPanel;
