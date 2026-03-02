import { useRef, useMemo } from 'react';
import type { CandlestickData, Time } from 'lightweight-charts';
import type { TradeMarker, PredictionMarker } from '@/contexts/UnifiedDashboardContext';
import { useSeriesMarkers, buildCandleTimeSet, alignTimestamp, type ChartMarker } from './useSeriesMarkers';
import type { LabelMarker } from './types';

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
  isFutures,
  labelMarkers,
  tradeMarkers,
  predictionMarkers,
  trainTestSplitTime,
}: ChartMarkersOptions): void {
  const timeframeSec = timeframe * 60;
  const validCandleSet = useMemo(() => buildCandleTimeSet(processedCandles), [processedCandles]);

  // ── Marker series refs (owned here, passed to useSeriesMarkers) ────────

  const labelMarkersSeriesRef = useRef<any>(null);
  const tradeMarkersSeriesRef = useRef<any>(null);
  const predictionMarkersSeriesRef = useRef<any>(null);
  const splitMarkerRef = useRef<any>(null);

  // ── Label markers ──────────────────────────────────────────────────────

  const prevMarkerSymbolRef = useRef<string>(symbol);
  const computedLabelMarkers = useMemo((): ChartMarker[] => {
    if (prevMarkerSymbolRef.current !== symbol) {
      prevMarkerSymbolRef.current = symbol;
      return [];
    }

    const candleTimes = processedCandles.map(d => d.time as number);
    const minTime = candleTimes.length > 0 ? candleTimes[0]! : 0;
    const maxTime = candleTimes.length > 0 ? candleTimes[candleTimes.length - 1]! : 0;

    const markers = labelMarkers
      .filter(m => m.label !== null && m.label !== undefined)
      .map(m => {
        const alignedTime = alignTimestamp(m.timestamp, timeframeSec);
        if (alignedTime < minTime || alignedTime > maxTime || !validCandleSet.has(alignedTime)) return null;
        const label = Number(m.label);
        if (label === 1) return { time: alignedTime as Time, position: 'belowBar' as const, color: '#22c55e', shape: 'arrowUp' as const, text: '' };
        if (label === -1) return { time: alignedTime as Time, position: 'aboveBar' as const, color: '#ef4444', shape: 'arrowDown' as const, text: '' };
        return { time: alignedTime as Time, position: 'inBar' as const, color: '#6366f1', shape: 'circle' as const, text: '' };
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
  }, [labelMarkers, processedCandles, symbol, timeframeSec, validCandleSet]);

  useSeriesMarkers(labelMarkersSeriesRef, candleSeriesRef, computedLabelMarkers);

  // ── Trade markers ──────────────────────────────────────────────────────

  const computedTradeMarkers = useMemo((): ChartMarker[] => {
    if (!tradeMarkers || tradeMarkers.length === 0) return [];
    return tradeMarkers
      .map(tm => {
        const alignedTime = alignTimestamp(tm.timestamp, timeframeSec);
        if (!validCandleSet.has(alignedTime)) return null;
        if (tm.type === 'entry') {
          return {
            time: alignedTime as Time,
            position: (tm.side === 'long' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
            color: tm.side === 'long' ? '#10b981' : '#f43f5e',
            shape: (tm.side === 'long' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
            text: tm.label || (tm.side === 'long' ? 'BUY' : 'SELL'),
          };
        } else {
          const pnlColor = (tm.pnl ?? 0) >= 0 ? '#10b981' : '#f43f5e';
          return {
            time: alignedTime as Time, position: 'aboveBar' as const, color: pnlColor,
            shape: 'square' as const,
            text: tm.pnl != null ? `${tm.pnl >= 0 ? '+' : ''}${tm.pnl.toFixed(1)}` : 'EXIT',
          };
        }
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => (a.time as number) - (b.time as number));
  }, [tradeMarkers, timeframeSec, validCandleSet]);

  useSeriesMarkers(tradeMarkersSeriesRef, candleSeriesRef, computedTradeMarkers);

  // ── Prediction markers ─────────────────────────────────────────────────

  const computedPredictionMarkers = useMemo((): ChartMarker[] => {
    if (!predictionMarkers || predictionMarkers.length === 0) return [];
    return predictionMarkers
      .map(pm => {
        const alignedTime = alignTimestamp(pm.timestamp, timeframeSec);
        if (!validCandleSet.has(alignedTime)) return null;
        if (pm.direction === 1) return { time: alignedTime as Time, position: 'belowBar' as const, color: 'rgba(34,197,94,0.5)', shape: 'arrowUp' as const, text: pm.confidence ? `${(pm.confidence * 100).toFixed(0)}%` : '' };
        if (pm.direction === -1) return { time: alignedTime as Time, position: 'aboveBar' as const, color: 'rgba(239,68,68,0.5)', shape: 'arrowDown' as const, text: pm.confidence ? `${(pm.confidence * 100).toFixed(0)}%` : '' };
        return { time: alignedTime as Time, position: 'inBar' as const, color: 'rgba(99,102,241,0.3)', shape: 'circle' as const, text: '' };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => (a.time as number) - (b.time as number));
  }, [predictionMarkers, timeframeSec, validCandleSet]);

  useSeriesMarkers(predictionMarkersSeriesRef, candleSeriesRef, computedPredictionMarkers);


  // ── Train/test split marker ────────────────────────────────────────────

  const computedSplitMarkers = useMemo((): ChartMarker[] => {
    if (!trainTestSplitTime || !validCandleSet.has(trainTestSplitTime)) return [];
    return [{
      time: trainTestSplitTime as Time, position: 'aboveBar' as const,
      color: 'rgba(255, 255, 255, 0.4)', shape: 'arrowDown' as const, text: 'TEST',
    }];
  }, [trainTestSplitTime, validCandleSet]);

  useSeriesMarkers(splitMarkerRef, candleSeriesRef, computedSplitMarkers);
}
