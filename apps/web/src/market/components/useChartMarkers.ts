import { useRef, useMemo } from 'react';
import type { CandlestickData, Time } from 'lightweight-charts';
import type { TradeMarker, PredictionMarker } from '@/shared/contexts/UnifiedDashboardContext';
import { useSeriesMarkers, buildCandleTimes, snapToCandle, shiftByBars, type ChartMarker } from './useSeriesMarkers';
import {
  CANDLE_UP_COLOR,
  CANDLE_DOWN_COLOR,
  PREDICTION_UP_FILL,
  PREDICTION_DOWN_FILL,
  PREDICTION_NEUTRAL_FILL,
} from './chartConfig';
import { labelDomain, labelMarkerStyle } from './labelMarkerStyle';
import type { LabelMarker } from "@/market/components/types";
import { patternMarkerId } from '@/market/lib/patternHover';
import type { NotebookMarker } from '@/market/lib/useNotebookOverlays';

// ── Types ──────────────────────────────────────────────────────────────────

interface ChartMarkersOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  candleSeriesRef: React.MutableRefObject<any>;
  processedCandles: CandlestickData<Time>[];
  timeframe: number;
  symbol: string;
  isFutures: boolean;
  labelMarkers: LabelMarker[];
  tradeMarkers: TradeMarker[];
  predictionMarkers: PredictionMarker[];
  trainTestSplitTime?: number;
  /** Markers a notebook drew (useNotebookOverlays), epoch ms. */
  notebookMarkers?: NotebookMarker[];
  /**
   * Markers from another source on this chart, already in lightweight-charts
   * shape and already snapped to candle times — the Model Cycle run's trades.
   *
   * A candle series carries ONE markers plugin, so these cannot be set by a
   * second `createSeriesMarkers` call: it would replace the merged set below.
   * They arrive here instead and take their place in the same sorted array.
   */
  extraMarkers?: ChartMarker[];
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
  notebookMarkers,
  extraMarkers,
}: ChartMarkersOptions): void {
  const timeframeSec = timeframe * 60;
  const candleTimes = useMemo(() => buildCandleTimes(processedCandles), [processedCandles]);

  // A candle series carries ONE markers plugin. Four `createSeriesMarkers`
  // calls against the same series do not layer — each new set replaces the
  // last, so the split marker (usually empty) silently erased the label,
  // trade, and prediction arrays. All four sets share one ref and are merged
  // into a single sorted array below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersSeriesRef = useRef<any>(null);

  // ── Label markers ──────────────────────────────────────────────────────

  const prevMarkerSymbolRef = useRef<string>(symbol);
  const computedLabelMarkers = useMemo((): ChartMarker[] => {
    if (prevMarkerSymbolRef.current !== symbol) {
      prevMarkerSymbolRef.current = symbol;
      return [];
    }

    const present = labelMarkers
      .filter(m => m.label !== null && m.label !== undefined)
      .map(m => Number(m.label))
      .filter(v => Number.isFinite(v));

    // Derived from the values on screen, not from a generator name — see
    // labelMarkerStyle.ts for why an allowlist is what broke this.
    const domain = labelDomain(present);

    const markers = labelMarkers
      .filter(m => m.label !== null && m.label !== undefined)
      .map(m => {
        const alignedTime = snapToCandle(m.timestamp, candleTimes, timeframeSec);
        if (alignedTime === null) return null;
        const label = Number(m.label);
        if (!Number.isFinite(label)) return null;
        // A forward-looking label is computed at one bar and describes a later
        // one. Draw it on the bar it is about, so an "up" arrow sits on the
        // candle that actually rose. Stepping by INDEX, not by time: sessions
        // have gaps, so `timestamp + offset * timeframe` often names an
        // instant with no bar and would snap back onto the wrong candle.
        const outcomeTime = shiftByBars(alignedTime, m.outcomeOffset ?? 0, candleTimes);
        if (outcomeTime === null) return null;
        const style = labelMarkerStyle(label, domain);
        // A pattern arrow carries an id so lightweight-charts reports it as
        // `hoveredObjectId` when the pointer is on it — that is what opens the
        // pattern card. Other labels have nothing to open and stay anonymous.
        const id = m.pattern ? patternMarkerId(outcomeTime) : undefined;
        return { time: outcomeTime as Time, text: '', ...style, ...(id ? { id } : {}) };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    // Several labels can snap onto one bar on a coarse timeframe. Keep the
    // most informative: a directional arrow outranks the zero dot, and a
    // stronger magnitude outranks a weaker one.
    const rank = (m: (typeof markers)[0]) =>
      m.shape === 'circle' ? 0 : m.size;
    const markerMap = new Map<number, (typeof markers)[0]>();
    for (const marker of markers) {
      const existing = markerMap.get(marker.time as number);
      if (!existing || rank(marker) > rank(existing)) {
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

  // ── Notebook markers (snapped to the bar their time falls in) ──────────

  const computedNotebookMarkers = useMemo((): ChartMarker[] => {
    if (!notebookMarkers || notebookMarkers.length === 0) return [];
    const position = { above: 'aboveBar', below: 'belowBar', on: 'inBar' } as const;
    const out: ChartMarker[] = [];
    for (const marker of notebookMarkers) {
      const alignedTime = snapToCandle(marker.timeMs, candleTimes, timeframeSec);
      if (alignedTime === null) continue;
      out.push({
        time: alignedTime as Time,
        position: position[marker.position],
        color: marker.color,
        shape: marker.shape,
        text: marker.text ?? '',
      });
    }
    return out;
  }, [notebookMarkers, candleTimes, timeframeSec]);

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
      ...computedNotebookMarkers,
      ...(extraMarkers ?? []),
    ].sort((a, b) => (a.time as number) - (b.time as number));
  }, [computedLabelMarkers, computedPredictionMarkers, computedTradeMarkers, computedSplitMarkers, computedNotebookMarkers, extraMarkers]);

  useSeriesMarkers(markersSeriesRef, candleSeriesRef, allMarkers);
}
