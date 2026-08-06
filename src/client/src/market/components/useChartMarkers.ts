import { useRef, useMemo } from 'react';
import type { CandlestickData, Time } from 'lightweight-charts';
import type { TradeMarker, PredictionMarker } from '@/shared/contexts/UnifiedDashboardContext';
import { useSeriesMarkers, buildCandleTimes, snapToCandle, type ChartMarker } from './useSeriesMarkers';
import {
  CANDLE_UP_COLOR,
  CANDLE_DOWN_COLOR,
  MARKER_NEUTRAL_COLOR,
  PREDICTION_UP_FILL,
  PREDICTION_DOWN_FILL,
  PREDICTION_NEUTRAL_FILL,
} from './chartConfig';
import type { LabelMarker } from "@/market/components/types";

// ── Types ──────────────────────────────────────────────────────────────────

interface ChartMarkersOptions {
  candleSeriesRef: React.MutableRefObject<any>;
  processedCandles: CandlestickData<Time>[];
  timeframe: number;
  symbol: string;
  isFutures: boolean;
  labelMarkers: LabelMarker[];
  tradeMarkers: TradeMarker[];
  predictionMarkers: PredictionMarker[];
  trainTestSplitTime?: number;
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Computes all chart marker arrays (labels, trades, predictions,
 * train/test split) and delegates rendering to `useSeriesMarkers`.
 */
export function useChartMarkers({
  candleSeriesRef,
  processedCandles,
  timeframe,
  symbol,
  isFutures: _isFutures,
  labelMarkers,
  tradeMarkers,
  predictionMarkers,
  trainTestSplitTime,
}: ChartMarkersOptions): void {
  const timeframeSec = timeframe * 60;
  const candleTimes = useMemo(() => buildCandleTimes(processedCandles), [processedCandles]);

  // A candle series carries ONE markers plugin. Four `createSeriesMarkers`
  // calls against the same series do not layer — each new set replaces the
  // last, so the split marker (usually empty) silently erased the label,
  // trade, and prediction arrays. All four sets share one ref and are merged
  // into a single sorted array below.
  const markersSeriesRef = useRef<any>(null);

  // ── Label markers ──────────────────────────────────────────────────────

  const prevMarkerSymbolRef = useRef<string>(symbol);
  const computedLabelMarkers = useMemo((): ChartMarker[] => {
    if (prevMarkerSymbolRef.current !== symbol) {
      prevMarkerSymbolRef.current = symbol;
      return [];
    }

    const markers = labelMarkers
      .filter(m => m.label !== null && m.label !== undefined)
      .map(m => {
        const alignedTime = snapToCandle(m.timestamp, candleTimes, timeframeSec);
        if (alignedTime === null) return null;
        const label = Number(m.label);
        if (label === 1) return { time: alignedTime as Time, position: 'belowBar' as const, color: CANDLE_UP_COLOR, shape: 'arrowUp' as const, text: '' };
        if (label === -1) return { time: alignedTime as Time, position: 'aboveBar' as const, color: CANDLE_DOWN_COLOR, shape: 'arrowDown' as const, text: '' };
        return { time: alignedTime as Time, position: 'inBar' as const, color: MARKER_NEUTRAL_COLOR, shape: 'circle' as const, text: '' };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    // Dedup: keep buy/sell signals over hold
    const markerMap = new Map<number, (typeof markers)[0]>();
    for (const marker of markers) {
      const existing = markerMap.get(marker.time as number);
      if (!existing || (existing.shape === 'circle' && marker.shape !== 'circle')) {
        markerMap.set(marker.time as number, marker);
      }
    }
    return Array.from(markerMap.values()).sort((a, b) => (a.time as number) - (b.time as number));
  }, [labelMarkers, symbol, timeframeSec, candleTimes]);


  // ── Trade markers ──────────────────────────────────────────────────────

  const computedTradeMarkers = useMemo((): ChartMarker[] => {
    if (!tradeMarkers || tradeMarkers.length === 0) return [];
    return tradeMarkers
      .map(tm => {
        const alignedTime = snapToCandle(tm.timestamp, candleTimes, timeframeSec);
        if (alignedTime === null) return null;
        if (tm.type === 'entry') {
          return {
            time: alignedTime as Time,
            position: (tm.side === 'long' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
            color: tm.side === 'long' ? CANDLE_UP_COLOR : CANDLE_DOWN_COLOR,
            shape: (tm.side === 'long' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
            text: tm.label || (tm.side === 'long' ? 'BUY' : 'SELL'),
          };
        } else {
          const pnlColor = (tm.pnl ?? 0) >= 0 ? CANDLE_UP_COLOR : CANDLE_DOWN_COLOR;
          return {
            time: alignedTime as Time, position: 'aboveBar' as const, color: pnlColor,
            shape: 'square' as const,
            text: tm.pnl != null ? `${tm.pnl >= 0 ? '+' : ''}${tm.pnl.toFixed(1)}` : 'EXIT',
          };
        }
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => (a.time as number) - (b.time as number));
  }, [tradeMarkers, timeframeSec, candleTimes]);


  // ── Prediction markers ─────────────────────────────────────────────────

  const computedPredictionMarkers = useMemo((): ChartMarker[] => {
    if (!predictionMarkers || predictionMarkers.length === 0) return [];
    return predictionMarkers
      .map(pm => {
        const alignedTime = snapToCandle(pm.timestamp, candleTimes, timeframeSec);
        if (alignedTime === null) return null;
        if (pm.direction === 1) return { time: alignedTime as Time, position: 'belowBar' as const, color: PREDICTION_UP_FILL, shape: 'arrowUp' as const, text: pm.confidence ? `${(pm.confidence * 100).toFixed(0)}%` : '' };
        if (pm.direction === -1) return { time: alignedTime as Time, position: 'aboveBar' as const, color: PREDICTION_DOWN_FILL, shape: 'arrowDown' as const, text: pm.confidence ? `${(pm.confidence * 100).toFixed(0)}%` : '' };
        return { time: alignedTime as Time, position: 'inBar' as const, color: PREDICTION_NEUTRAL_FILL, shape: 'circle' as const, text: '' };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => (a.time as number) - (b.time as number));
  }, [predictionMarkers, timeframeSec, candleTimes]);



  // ── Train/test split marker ────────────────────────────────────────────

  const computedSplitMarkers = useMemo((): ChartMarker[] => {
    if (!trainTestSplitTime) return [];
    // trainTestSplitTime is already in chart seconds; snapToCandle takes ms.
    const alignedTime = snapToCandle(trainTestSplitTime * 1000, candleTimes, timeframeSec);
    if (alignedTime === null) return [];
    return [{
      time: alignedTime as Time, position: 'aboveBar' as const,
      color: 'rgba(255, 255, 255, 0.4)', shape: 'arrowDown' as const, text: 'TEST',
    }];
  }, [trainTestSplitTime, candleTimes, timeframeSec]);

  // ── One merged, time-sorted set for the single markers plugin ──────────
  //
  // lightweight-charts requires markers in ascending time order; concatenating
  // four independently-sorted arrays does not preserve that, so the merged
  // array is re-sorted before it reaches the plugin.

  const allMarkers = useMemo((): ChartMarker[] => {
    return [
      ...computedLabelMarkers,
      ...computedPredictionMarkers,
      ...computedTradeMarkers,
      ...computedSplitMarkers,
    ].sort((a, b) => (a.time as number) - (b.time as number));
  }, [computedLabelMarkers, computedPredictionMarkers, computedTradeMarkers, computedSplitMarkers]);

  useSeriesMarkers(markersSeriesRef, candleSeriesRef, allMarkers);
}
