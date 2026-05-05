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
import {
  createChart,
  ColorType,
  type IChartApi,
  type Time,
  LineSeries,
  HistogramSeries,
  type LogicalRange,
} from 'lightweight-charts';
import type { IndicatorOverlay } from '@/hooks/useIndicatorData';
import { getPanelLabel, getReferenceLines, shouldRenderAsHistogram, getSeriesTitle, getHistogramStyle } from '@/lib/indicator_panels';
import { getHistogramColors } from '@/lib/indicator_colors';

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
  onClose: (columns: string[]) => void;
  onVisibleLogicalRangeChange?: (range: LogicalRange) => void;
}

const SubchartPanel = forwardRef<SubchartPanelHandle, SubchartPanelProps>(
  function SubchartPanel(
    { panelKey, indicators, height, showTimeAxis = false, onClose, onVisibleLogicalRangeChange },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
     
    const seriesMapRef = useRef<Map<string, any>>(new Map());
     
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
          rightOffset: 5,
          barSpacing: 6,
          minBarSpacing: 0.5,
          enableConflation: true,
          conflationThresholdFactor: 1.0,
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
        }
      }

      // Add/update each indicator line
      for (const indicator of indicators) {
        const existing = seriesMapRef.current.get(indicator.column);
        const isHisto = shouldRenderAsHistogram(indicator.column);

        const buildData = () =>
          dedupByTime(
            isHisto
              ? (() => {
                  const histoStyle = getHistogramStyle(indicator.column);
                  if (histoStyle === 'ao') {
                    // Awesome Oscillator: green when increasing, red when decreasing
                    return indicator.data.map((d, i) => ({
                      time: d.time as Time,
                      value: d.value,
                      color: i > 0 && d.value > indicator.data[i - 1]!.value
                        ? 'rgba(34, 197, 94, 0.7)'   // green (increasing)
                        : 'rgba(239, 68, 68, 0.7)',   // red (decreasing)
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
                            ? 'rgba(6, 182, 212, 0.85)'   // bright cyan (increasing positive)
                            : 'rgba(6, 182, 212, 0.4)',    // dim cyan (decreasing positive)
                        };
                      }
                      return {
                        time: d.time as Time,
                        value: d.value,
                        color: d.value < prev
                          ? 'rgba(239, 68, 68, 0.85)'   // bright red (decreasing negative)
                          : 'rgba(239, 68, 68, 0.4)',    // dim red (increasing negative)
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
          );

        if (existing) {
          existing.setData(buildData());
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
            : chart.addSeries(LineSeries, {
                color: indicator.color,
                lineWidth: indicator.lineWidth as 1 | 2 | 3 | 4,
                priceScaleId: 'right',
                lastValueVisible: true,
                priceLineVisible: false,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 2,
                title: seriesTitle,
              });

          series.setData(buildData());
          seriesMapRef.current.set(indicator.column, series);
        }
      }

      // Add reference lines once (on first series available)
      if (!priceLinesAddedRef.current && refLines.length > 0 && seriesMapRef.current.size > 0) {
        // Use the first non-histogram series, or any series
         
        let targetSeries: any = null;
        seriesMapRef.current.forEach((s, col) => {
          if (!targetSeries && !shouldRenderAsHistogram(col)) {
            targetSeries = s;
          }
        });
        if (!targetSeries) targetSeries = seriesMapRef.current.values().next().value;

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
        <button
          onClick={handleClose}
          className="absolute top-1 right-8 z-10 h-4 w-4 rounded-sm flex items-center justify-center text-muted-foreground/30 hover:text-red-400 hover:bg-red-400/10 transition-colors"
          title="Remove indicator"
        >
          <X className="h-3 w-3" />
        </button>

        {/* Chart container */}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    );
  },
);

export default SubchartPanel;
