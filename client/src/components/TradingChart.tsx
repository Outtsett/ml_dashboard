import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createChart, ColorType, IChartApi, CandlestickData, Time, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import type { IndicatorOverlay } from '@/hooks/useIndicatorData';

interface OhlcvData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ContractRollover {
  id?: number;
  baseSymbol?: string;
  fromContract: string;
  toContract: string;
  rolloverTimestamp?: number;
  timestamp?: number;
  priceAdjustment: number;
  rolloverType?: string;
}

export interface LabelMarker {
  timestamp: number;
  label: number | null;
  close?: number;
}

interface TradingChartProps {
  data: OhlcvData[];
  symbol: string;
  isFutures: boolean;
  timeframe?: number;
  onLoadMore?: (direction: 'left' | 'right', timestamp: number) => void;
  isLoadingMore?: boolean;
  hasMoreLeft?: boolean;
  hasMoreRight?: boolean;
  rollovers?: ContractRollover[];
  labelMarkers?: LabelMarker[];
  indicatorOverlays?: IndicatorOverlay[];
}

const futuresTickInfo: Record<string, { tickSize: number; tickValue: number; decimals: number }> = {
  ES: { tickSize: 0.25, tickValue: 12.50, decimals: 2 },
  MES: { tickSize: 0.25, tickValue: 1.25, decimals: 2 },
  NQ: { tickSize: 0.25, tickValue: 5.00, decimals: 2 },
  MNQ: { tickSize: 0.25, tickValue: 0.50, decimals: 2 },
  RTY: { tickSize: 0.10, tickValue: 5.00, decimals: 2 },
  M2K: { tickSize: 0.10, tickValue: 0.50, decimals: 2 },
  YM: { tickSize: 1.00, tickValue: 5.00, decimals: 0 },
  MYM: { tickSize: 1.00, tickValue: 0.50, decimals: 0 },
};

const forexPipInfo: Record<string, { pipLocation: number; pipValue: number; decimals: number }> = {
  EURUSD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  GBPUSD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  AUDUSD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  NZDUSD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  USDCAD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  USDCHF: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  USDJPY: { pipLocation: 2, pipValue: 0.01, decimals: 3 },
  EURJPY: { pipLocation: 2, pipValue: 0.01, decimals: 3 },
  GBPJPY: { pipLocation: 2, pipValue: 0.01, decimals: 3 },
  AUDJPY: { pipLocation: 2, pipValue: 0.01, decimals: 3 },
  CADJPY: { pipLocation: 2, pipValue: 0.01, decimals: 3 },
  EURGBP: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  EURAUD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  EURCHF: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  AUDNZD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  GBPAUD: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
  GBPCHF: { pipLocation: 4, pipValue: 0.0001, decimals: 5 },
};

function getBaseSymbol(symbol: string): string {
  return symbol.replace(/[A-Z]\d{1,2}$/, '').replace(/\d{4}$/, '');
}

export default function TradingChart({ 
  data, 
  symbol, 
  isFutures, 
  timeframe = 1,
  onLoadMore,
  isLoadingMore = false,
  hasMoreLeft = true,
  hasMoreRight = false,
  rollovers = [],
  labelMarkers = [],
  indicatorOverlays = [],
}: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSeriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volumeSeriesRef = useRef<any>(null);
  const isInitialLoadRef = useRef<boolean>(true);
  const prevSymbolRef = useRef<string>(symbol);
  const prevTimeframeRef = useRef<number>(timeframe);
  const loadingMoreRef = useRef<boolean>(false);
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastDataHashRef = useRef<string>('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlaySeriesRef = useRef<Map<string, any>>(new Map());
  const [priceInfo, setPriceInfo] = useState<{ open: number; high: number; low: number; close: number; time: string } | null>(null);

  const baseSymbol = getBaseSymbol(symbol);
  const tickInfo = futuresTickInfo[baseSymbol];
  const pipInfo = forexPipInfo[symbol.toUpperCase()];
  
  const decimals = isFutures 
    ? (tickInfo?.decimals ?? 2) 
    : (pipInfo?.decimals ?? 5);
  
  const minMove = isFutures 
    ? (tickInfo?.tickSize ?? 0.01) 
    : (pipInfo?.pipValue ?? 0.00001);

  const processedData = useMemo(() => {
    if (data.length === 0) return { candles: [], volumes: [] };

    const candleMap = new Map<number, CandlestickData<Time>>();
    const volumeMap = new Map<number, { time: Time; value: number; color: string }>();

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp, 10) : d.timestamp;
      if (!ts || isNaN(d.open) || isNaN(d.close)) continue;
      
      const timeKey = Math.floor(ts / 1000);
      
      candleMap.set(timeKey, {
        time: timeKey as Time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      });

      if (!isNaN(d.volume)) {
        volumeMap.set(timeKey, {
          time: timeKey as Time,
          value: d.volume,
          color: d.close >= d.open ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)',
        });
      }
    }

    const candles = Array.from(candleMap.values()).sort((a, b) => (a.time as number) - (b.time as number));
    const volumes = Array.from(volumeMap.values()).sort((a, b) => (a.time as number) - (b.time as number));

    return { candles, volumes };
  }, [data]);

  const rolloverPriceLines = useMemo(() => {
    if (!isFutures || rollovers.length === 0) return [];
    
    return rollovers
      .filter(r => {
        const ts = r.rolloverTimestamp || r.timestamp || 0;
        if (ts === 0) return false;
        const rolloverTime = Math.floor(ts / 1000);
        const minTime = processedData.candles.length > 0 ? (processedData.candles[0].time as number) : 0;
        const maxTime = processedData.candles.length > 0 ? (processedData.candles[processedData.candles.length - 1].time as number) : 0;
        return rolloverTime >= minTime && rolloverTime <= maxTime;
      })
      .map(r => ({
        time: Math.floor((r.rolloverTimestamp || r.timestamp || 0) / 1000),
        from: r.fromContract,
        to: r.toContract,
        adjustment: r.priceAdjustment,
      }));
  }, [isFutures, rollovers, processedData.candles]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(255, 255, 255, 0.6)',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(139, 92, 246, 0.08)' },
        horzLines: { color: 'rgba(139, 92, 246, 0.08)' },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: 'rgba(139, 92, 246, 0.5)',
          width: 1,
          style: 2,
          labelBackgroundColor: 'rgba(139, 92, 246, 0.8)',
        },
        horzLine: {
          color: 'rgba(139, 92, 246, 0.5)',
          width: 1,
          style: 2,
          labelBackgroundColor: 'rgba(139, 92, 246, 0.8)',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(139, 92, 246, 0.2)',
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: 'rgba(139, 92, 246, 0.2)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 6,
        minBarSpacing: 0.5,
        fixLeftEdge: false,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: false,
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

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'price',
        precision: decimals,
        minMove: minMove,
      },
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(139, 92, 246, 0.3)',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    chart.subscribeCrosshairMove((param) => {
      if (param.time && candleSeriesRef.current) {
        const data = param.seriesData.get(candleSeriesRef.current) as CandlestickData<Time> | undefined;
        if (data) {
          const timeValue = param.time as number;
          const date = new Date(timeValue * 1000);
          setPriceInfo({
            open: data.open,
            high: data.high,
            low: data.low,
            close: data.close,
            time: date.toLocaleString(),
          });
        }
      }
    });

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      overlaySeriesRef.current.clear();
      chart.remove();
    };
  }, [decimals, isFutures, tickInfo, minMove]);

  useEffect(() => {
    if (!chartRef.current || !onLoadMore || data.length === 0) return;
    
    const chart = chartRef.current;
    const timeScale = chart.timeScale();
    
    const handleVisibleTimeRangeChange = () => {
      if (loadingMoreRef.current || isLoadingMore) return;
      
      const visibleRange = timeScale.getVisibleLogicalRange();
      if (!visibleRange) return;
      
      const dataLength = data.length;
      const { from, to } = visibleRange;
      
      if (from < 10 && hasMoreLeft) {
        loadingMoreRef.current = true;
        const earliestTimestamp = data[0].timestamp;
        onLoadMore('left', earliestTimestamp);
        if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current);
        loadMoreTimerRef.current = setTimeout(() => { loadingMoreRef.current = false; }, 300);
      }

      if (to > dataLength - 10 && hasMoreRight) {
        loadingMoreRef.current = true;
        const latestTimestamp = data[data.length - 1].timestamp;
        onLoadMore('right', latestTimestamp);
        if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current);
        loadMoreTimerRef.current = setTimeout(() => { loadingMoreRef.current = false; }, 300);
      }
    };
    
    timeScale.subscribeVisibleLogicalRangeChange(handleVisibleTimeRangeChange);
    
    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(handleVisibleTimeRangeChange);
      if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current);
    };
  }, [data, onLoadMore, isLoadingMore, hasMoreLeft, hasMoreRight]);

  const updateChartData = useCallback(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    if (processedData.candles.length === 0) return;

    const dataHash = `${symbol}-${timeframe}-${processedData.candles.length}-${processedData.candles[0]?.time}-${processedData.candles[processedData.candles.length - 1]?.time}`;
    
    if (dataHash === lastDataHashRef.current) return;
    lastDataHashRef.current = dataHash;

    candleSeriesRef.current.setData(processedData.candles);
    volumeSeriesRef.current.setData(processedData.volumes);

    const symbolChanged = prevSymbolRef.current !== symbol;
    const timeframeChanged = prevTimeframeRef.current !== timeframe;
    prevSymbolRef.current = symbol;
    prevTimeframeRef.current = timeframe;

    if (chartRef.current && (isInitialLoadRef.current || symbolChanged || timeframeChanged)) {
      chartRef.current.timeScale().fitContent();
      isInitialLoadRef.current = false;
    }
  }, [processedData, symbol, timeframe]);

  useEffect(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }
    
    rafIdRef.current = requestAnimationFrame(() => {
      updateChartData();
    });

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [updateChartData]);

  // Apply label markers to the chart using lightweight-charts v5 createSeriesMarkers API
  const seriesMarkersRef = useRef<any>(null);
  const prevMarkerSymbolRef = useRef<string>(symbol);

  useEffect(() => {
    if (!candleSeriesRef.current) return;
    
    // Clear markers when symbol changes to prevent stale dots
    const symbolChanged = prevMarkerSymbolRef.current !== symbol;
    if (symbolChanged) {
      prevMarkerSymbolRef.current = symbol;
      if (seriesMarkersRef.current) {
        seriesMarkersRef.current.setMarkers([]);
      }
    }

    // Get the time range of visible candles to filter markers
    const candleTimes = processedData.candles.map(d => d.time as number);
    const minTime = candleTimes.length > 0 ? candleTimes[0] : 0;
    const maxTime = candleTimes.length > 0 ? candleTimes[candleTimes.length - 1] : 0;
    const validCandleSet = new Set(candleTimes);

    // Build markers array from label data
    // Align timestamps to candle boundaries based on the active timeframe
    const timeframeSec = timeframe * 60;
    const markers = labelMarkers
      .filter(m => m.label !== null && m.label !== undefined)
      .map(m => {
        // Floor timestamp to nearest minute to align with candle data
        const timestampSec = Math.floor(m.timestamp / 1000);
        const alignedTime = Math.floor(timestampSec / timeframeSec) * timeframeSec;
        const label = Number(m.label);
        
        // Only include markers within the visible candle range AND matching a candle
        if (alignedTime < minTime || alignedTime > maxTime) {
          return null;
        }
        // Try to find a matching candle time
        if (!validCandleSet.has(alignedTime)) {
          return null;
        }
        
        if (label === 1) {
          return {
            time: alignedTime as Time,
            position: 'belowBar' as const,
            color: '#22c55e',
            shape: 'arrowUp' as const,
            text: '',
          };
        } else if (label === -1) {
          return {
            time: alignedTime as Time,
            position: 'aboveBar' as const,
            color: '#ef4444',
            shape: 'arrowDown' as const,
            text: '',
          };
        } else {
          return {
            time: alignedTime as Time,
            position: 'inBar' as const,
            color: '#6366f1',
            shape: 'circle' as const,
            text: '',
          };
        }
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => (a.time as number) - (b.time as number));
    
    // Deduplicate markers by time, keeping buy/sell signals over hold
    const markerMap = new Map<number, typeof markers[0]>();
    for (const marker of markers) {
      const existing = markerMap.get(marker.time as number);
      if (!existing || (existing.shape === 'circle' && marker.shape !== 'circle')) {
        markerMap.set(marker.time as number, marker);
      }
    }
    const dedupedMarkers = Array.from(markerMap.values())
      .sort((a, b) => (a.time as number) - (b.time as number));
    
    console.log(`[LabelMarkers] Total: ${labelMarkers.length}, Matched: ${dedupedMarkers.length}, Range: ${minTime}-${maxTime}`);

    // Create or update series markers
    if (dedupedMarkers.length > 0) {
      if (seriesMarkersRef.current) {
        seriesMarkersRef.current.setMarkers(dedupedMarkers);
      } else {
        seriesMarkersRef.current = createSeriesMarkers(candleSeriesRef.current, dedupedMarkers);
      }
    } else if (seriesMarkersRef.current) {
      seriesMarkersRef.current.setMarkers([]);
    }
  }, [labelMarkers, processedData, symbol, timeframe]);

  // Manage indicator overlay series (add/remove/update)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const currentKeys = new Set(indicatorOverlays.map(o => o.column));
    const existingKeys = Array.from(overlaySeriesRef.current.keys());

    // Remove series that are no longer selected
    for (const key of existingKeys) {
      if (!currentKeys.has(key)) {
        const series = overlaySeriesRef.current.get(key);
        if (series) {
          try { chart.removeSeries(series); } catch { /* already removed */ }
        }
        overlaySeriesRef.current.delete(key);
      }
    }

    // Subchart layout: divide bottom portion among subchart indicators
    const subchartOverlays = indicatorOverlays.filter(o => o.displayType === 'subchart');
    const subchartCount = subchartOverlays.length;
    // Subchart area: bottom 30% of chart, divided evenly
    const subchartHeight = subchartCount > 0 ? 0.3 / subchartCount : 0;

    // Add or update series
    for (let i = 0; i < indicatorOverlays.length; i++) {
      const overlay = indicatorOverlays[i];
      const existing = overlaySeriesRef.current.get(overlay.column);

      if (existing) {
        // Update data on existing series
        existing.setData(overlay.data.map(d => ({ time: d.time as Time, value: d.value })));
      } else if (overlay.displayType === 'marker') {
        // CDL pattern markers — merge with existing markers on candle series
        // Skip series creation; handled via createSeriesMarkers below
      } else {
        // Create new LineSeries
        const isSubchart = overlay.displayType === 'subchart';
        const subIdx = isSubchart ? subchartOverlays.indexOf(overlay) : -1;

        const series = chart.addSeries(LineSeries, {
          color: overlay.color,
          lineWidth: overlay.lineWidth as 1 | 2 | 3 | 4,
          priceScaleId: isSubchart ? `indicator-${overlay.column}` : 'right',
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 3,
        });

        if (isSubchart && subIdx >= 0) {
          // Position subchart indicators in the bottom 30% of the chart
          // Each subchart gets an equal slice: e.g., 1 subchart = 0.7-1.0, 2 = 0.7-0.85 + 0.85-1.0
          const sliceTop = 0.7 + subIdx * subchartHeight;
          const sliceBottom = 1.0 - (sliceTop + subchartHeight);
          series.priceScale().applyOptions({
            scaleMargins: {
              top: sliceTop,
              bottom: Math.max(sliceBottom, 0.01),
            },
          });
        }

        series.setData(overlay.data.map(d => ({ time: d.time as Time, value: d.value })));
        overlaySeriesRef.current.set(overlay.column, series);
      }
    }

    // Handle CDL markers — merge with existing label markers
    if (candleSeriesRef.current) {
      const cdlOverlays = indicatorOverlays.filter(o => o.displayType === 'marker');
      if (cdlOverlays.length > 0) {
        const candleTimes = processedData.candles.map(d => d.time as number);
        const validCandleSet = new Set(candleTimes);

        const cdlMarkers = cdlOverlays.flatMap(overlay =>
          overlay.data
            .filter(d => validCandleSet.has(d.time))
            .map(d => ({
              time: d.time as Time,
              position: (d.value > 0 ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
              color: d.value > 0 ? '#facc15' : '#f97316',
              shape: (d.value > 0 ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
              text: overlay.column.replace('CDL_', ''),
            }))
        ).sort((a, b) => (a.time as number) - (b.time as number));

        if (cdlMarkers.length > 0) {
          // Store CDL markers ref for cleanup
          if (!overlaySeriesRef.current.has('__cdl_markers__')) {
            const sm = createSeriesMarkers(candleSeriesRef.current, cdlMarkers);
            overlaySeriesRef.current.set('__cdl_markers__', sm);
          } else {
            overlaySeriesRef.current.get('__cdl_markers__').setMarkers(cdlMarkers);
          }
        }
      } else {
        // Clear CDL markers if none selected
        const cdlSm = overlaySeriesRef.current.get('__cdl_markers__');
        if (cdlSm) {
          cdlSm.setMarkers([]);
          overlaySeriesRef.current.delete('__cdl_markers__');
        }
      }
    }
  }, [indicatorOverlays, processedData.candles]);

  // Clean up markers when component unmounts
  useEffect(() => {
    return () => {
      if (seriesMarkersRef.current) {
        seriesMarkersRef.current.setMarkers([]);
      }
      seriesMarkersRef.current = null;
    };
  }, []);

  const tickOrPipLabel = isFutures 
    ? `Tick: ${tickInfo?.tickSize ?? 'N/A'} = $${tickInfo?.tickValue ?? 'N/A'}`
    : `Pip: ${pipInfo?.pipValue ?? 0.0001}`;

  return (
    <div className="relative w-full h-full">
      <div 
        ref={chartContainerRef} 
        className="w-full h-full"
        data-testid="trading-chart"
      />
      <div className="absolute top-2 left-2 flex items-center gap-4 text-[10px] font-mono bg-black/40 backdrop-blur-sm rounded-lg px-3 py-1.5">
        <span className="text-primary font-bold">{symbol}</span>
        <span className="text-muted-foreground">{tickOrPipLabel}</span>
        {priceInfo && (
          <>
            <span className="text-muted-foreground">O: <span className="text-white">{priceInfo.open.toFixed(decimals)}</span></span>
            <span className="text-muted-foreground">H: <span className="text-green-400">{priceInfo.high.toFixed(decimals)}</span></span>
            <span className="text-muted-foreground">L: <span className="text-rose-400">{priceInfo.low.toFixed(decimals)}</span></span>
            <span className="text-muted-foreground">C: <span className="text-white">{priceInfo.close.toFixed(decimals)}</span></span>
          </>
        )}
      </div>
      
      {rolloverPriceLines.length > 0 && (
        <div className="absolute top-12 left-2 flex flex-col gap-0.5 text-[8px] font-mono bg-amber-500/10 backdrop-blur-sm rounded px-1.5 py-1 border border-amber-500/20 max-w-[140px]">
          <span className="text-amber-400 font-semibold">{rolloverPriceLines.length} rollovers</span>
        </div>
      )}
      
      {labelMarkers.length > 0 && (
        <div className="absolute top-12 right-2 flex flex-col gap-0.5 text-[8px] font-mono bg-violet-500/10 backdrop-blur-sm rounded px-2 py-1.5 border border-violet-500/20">
          <span className="text-violet-400 font-semibold mb-1">Labels Preview</span>
          <div className="flex gap-2">
            <span className="text-green-400">▲ {labelMarkers.filter(m => m.label === 1).length}</span>
            <span className="text-rose-400">▼ {labelMarkers.filter(m => m.label === -1).length}</span>
            <span className="text-gray-400">● {labelMarkers.filter(m => m.label === 0).length}</span>
          </div>
        </div>
      )}
      
      <div className="absolute bottom-2 right-2 text-[9px] text-muted-foreground/50 font-mono">
        Scroll to zoom • Drag to pan
      </div>
    </div>
  );
}
