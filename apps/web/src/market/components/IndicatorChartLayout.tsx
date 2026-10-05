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
import TradingChart from '@/market/components/TradingChart';
import type { TradingChartHandle, TradingChartProps } from '@/market/components/TradingChart';
import SubchartPanel from '@/market/components/SubchartPanel';
import type { SubchartPanelHandle } from '@/market/components/SubchartPanel';
import { groupSubchartIndicators } from "@/market/lib/indicator_panels";
import type { IndicatorOverlay } from "@/market/lib/useIndicatorData";
import type { LogicalRange } from 'lightweight-charts';

/**
 * A panel the chart's owner supplies rather than one the user's indicator
 * selection made — the Model Cycle run's `P(up)` and equity.
 *
 * They are panels here, not a second chart: same instance type, same range sync,
 * same scroll area, so the run's numbers line up with the indicators and can be
 * closed only by the source that owns them.
 */
export interface ExtraChartPanel {
  key: string;
  indicators: IndicatorOverlay[];
  /** False for a panel that closes with its run rather than with the user's selection. */
  closable?: boolean;
}

interface IndicatorChartLayoutProps extends Omit<TradingChartProps, 'onVisibleLogicalRangeChange' | 'showTimeAxis'> {
  /** Callback to remove indicator columns from the selection (e.g., when closing a panel). */
  onRemoveIndicators?: (columns: string[]) => void;
  /**
   * Fired whenever the main chart's visible logical range changes.
   * `onVisibleLogicalRangeChange` is owned internally (it drives subchart sync),
   * so consumers observe the range through this prop instead.
   */
  onMainRangeChange?: (range: LogicalRange) => void;
  /** Panels supplied by the owner, rendered above the user's own. */
  extraPanels?: ExtraChartPanel[];
}

const BASE_PANEL_HEIGHT = 120;

interface RenderedPanel {
  key: string;
  indicators: IndicatorOverlay[];
  closable: boolean;
}

export default function IndicatorChartLayout({
  indicatorOverlays = [],
  onRemoveIndicators,
  onMainRangeChange,
  isReplayActive,
  regimeColorMap,
  extraPanels,
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

  // One list to render: the owner's panels (the run's, which read with the
  // candles) then the user's own indicators.
  const panels = useMemo<RenderedPanel[]>(
    () => [
      ...(extraPanels ?? []).map((panel) => ({
        key: panel.key,
        indicators: panel.indicators,
        closable: panel.closable !== false,
      })),
      ...subchartPanels.map(([key, indicators]) => ({ key, indicators, closable: true })),
    ],
    [extraPanels, subchartPanels],
  );

  // Dynamic height: shrink panels when there are many, minimum 100px
  const panelHeight = useMemo(() => {
    const count = panels.length;
    if (count <= 3) return BASE_PANEL_HEIGHT;
    // Cap total subchart area at ~400px, but never go below 100px per panel
    return Math.max(100, Math.floor(400 / count));
  }, [panels.length]);

  // ---------- Time-axis sync ----------

  const syncAllSubcharts = useCallback((range: LogicalRange, exceptKey?: string) => {
    subchartRefsMap.current.forEach((handle, key) => {
      if (key !== exceptKey) {
        handle.setVisibleLogicalRange(range);
      }
    });
  }, []);

  /** Main chart changed range → notify consumer, then sync all subcharts */
  const handleMainRangeChange = useCallback(
    (range: LogicalRange) => {
      // Always report the range — the sync guard below only exists to break
      // subchart→main→subchart echo, and must not suppress the consumer.
      onMainRangeChange?.(range);
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      syncAllSubcharts(range);
      requestAnimationFrame(() => {
        isSyncingRef.current = false;
      });
    },
    [syncAllSubcharts, onMainRangeChange],
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
          showTimeAxis={panels.length === 0}
          isReplayActive={isReplayActive}
          regimeColorMap={regimeColorMap}
        />
      </div>

      {/* Subchart panels — each gets its own chart instance, scrollable when many */}
      {panels.length > 0 && (
        <div className="overflow-y-auto shrink-0" style={{ maxHeight: '50vh' }}>
          {panels.map((panel, idx) => (
            <SubchartPanel
              key={panel.key}
              ref={getSubchartRef(panel.key)}
              panelKey={panel.key}
              indicators={panel.indicators}
              height={panelHeight}
              showTimeAxis={idx === panels.length - 1}
              closable={panel.closable}
              onClose={handlePanelClose}
              onVisibleLogicalRangeChange={(range) => handleSubchartRangeChange(panel.key, range)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
