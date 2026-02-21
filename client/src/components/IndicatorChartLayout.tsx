/**
 * IndicatorChartLayout — orchestrates the main price chart and subchart indicator panels.
 *
 * Layout:
 * ┌──────────────────────────────────────────────┐
 * │  Main chart (candles + overlays + volume)     │  flex-1
 * ├──────────────────────────────────────────────┤
 * │  Subchart Panel: RSI (14)              [×]   │  fixed height
 * ├──────────────────────────────────────────────┤
 * │  Subchart Panel: MACD (12,26,9)        [×]   │  fixed height
 * └──────────────────────────────────────────────┘
 *
 * Features:
 * - Overlay indicators render on the main price chart
 * - Each subchart indicator gets its own lightweight-charts instance with independent Y-axis
 * - Related indicators (MACD line/signal/histogram) share a panel
 * - Bidirectional time-axis synchronization between all charts
 * - Dynamic panel management (add/remove/resize)
 */

import { useRef, useMemo, useCallback } from 'react';
import TradingChart from '@/components/TradingChart';
import type { TradingChartHandle, TradingChartProps } from '@/components/TradingChart';
import SubchartPanel from '@/components/SubchartPanel';
import type { SubchartPanelHandle } from '@/components/SubchartPanel';
import { groupSubchartIndicators } from '@/lib/indicatorPanels';
import type { LogicalRange } from 'lightweight-charts';

interface IndicatorChartLayoutProps extends Omit<TradingChartProps, 'onVisibleLogicalRangeChange' | 'showTimeAxis'> {
  /** Callback to remove indicator columns from the selection (e.g., when closing a panel). */
  onRemoveIndicators?: (columns: string[]) => void;
}

const BASE_PANEL_HEIGHT = 120;

export default function IndicatorChartLayout({
  indicatorOverlays = [],
  onRemoveIndicators,
  ...chartProps
}: IndicatorChartLayoutProps) {
  const mainChartRef = useRef<TradingChartHandle>(null);
  const subchartRefsMap = useRef<Map<string, SubchartPanelHandle>>(new Map());
  const isSyncingRef = useRef(false);

  // Separate overlay/marker indicators (for main chart) from subchart indicators
  const overlayIndicators = useMemo(
    () => indicatorOverlays.filter(o => o.displayType !== 'subchart'),
    [indicatorOverlays],
  );

  const subchartPanels = useMemo(
    () => groupSubchartIndicators(indicatorOverlays),
    [indicatorOverlays],
  );

  // Dynamic height: shrink panels when there are many
  const panelHeight = useMemo(() => {
    const count = subchartPanels.length;
    if (count <= 3) return BASE_PANEL_HEIGHT;
    // Cap total subchart area at ~360px
    return Math.max(80, Math.floor(360 / count));
  }, [subchartPanels.length]);

  // ---------- Time-axis sync ----------

  const syncAllSubcharts = useCallback((range: LogicalRange, exceptKey?: string) => {
    subchartRefsMap.current.forEach((handle, key) => {
      if (key !== exceptKey) {
        handle.setVisibleLogicalRange(range);
      }
    });
  }, []);

  /** Main chart changed range → sync all subcharts */
  const handleMainRangeChange = useCallback(
    (range: LogicalRange) => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      syncAllSubcharts(range);
      requestAnimationFrame(() => {
        isSyncingRef.current = false;
      });
    },
    [syncAllSubcharts],
  );

  /** A subchart changed range → sync main chart + other subcharts */
  const handleSubchartRangeChange = useCallback(
    (panelKey: string, range: LogicalRange) => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      mainChartRef.current?.setVisibleLogicalRange(range);
      syncAllSubcharts(range, panelKey);
      requestAnimationFrame(() => {
        isSyncingRef.current = false;
      });
    },
    [syncAllSubcharts],
  );

  // ---------- Panel management ----------

  /** Remove indicator columns when the user closes a subchart panel */
  const handlePanelClose = useCallback(
    (columns: string[]) => {
      onRemoveIndicators?.(columns);
    },
    [onRemoveIndicators],
  );

  /** Create a stable ref callback for subchart panels */
  const subchartRefCallbacks = useRef<Map<string, (handle: SubchartPanelHandle | null) => void>>(
    new Map(),
  );

  const getSubchartRef = useCallback(
    (key: string) => {
      if (!subchartRefCallbacks.current.has(key)) {
        subchartRefCallbacks.current.set(key, (handle: SubchartPanelHandle | null) => {
          if (handle) {
            subchartRefsMap.current.set(key, handle);
            // Sync new panel to main chart's current visible range
            const range = mainChartRef.current?.getVisibleLogicalRange();
            if (range) {
              handle.setVisibleLogicalRange(range);
            }
          } else {
            subchartRefsMap.current.delete(key);
            subchartRefCallbacks.current.delete(key);
          }
        });
      }
      return subchartRefCallbacks.current.get(key)!;
    },
    [],
  );

  return (
    <div className="flex flex-col h-full w-full">
      {/* Main chart — takes remaining space */}
      <div className="flex-1 min-h-[180px] overflow-hidden">
        <TradingChart
          ref={mainChartRef}
          {...chartProps}
          indicatorOverlays={overlayIndicators}
          onVisibleLogicalRangeChange={handleMainRangeChange}
          showTimeAxis={subchartPanels.length === 0}
        />
      </div>

      {/* Subchart panels — each gets its own chart instance */}
      {subchartPanels.map(([key, indicators], idx) => (
        <SubchartPanel
          key={key}
          ref={getSubchartRef(key)}
          panelKey={key}
          indicators={indicators}
          height={panelHeight}
          showTimeAxis={idx === subchartPanels.length - 1}
          onClose={handlePanelClose}
          onVisibleLogicalRangeChange={(range) => handleSubchartRangeChange(key, range)}
        />
      ))}
    </div>
  );
}
