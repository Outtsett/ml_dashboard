import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Database, Loader2, Sparkles, TrendingUp, DollarSign, ArrowRightLeft, Tag, Eye, Play, BarChart3, ChevronsUpDown, Check } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import TradingChart, { LabelMarker } from "@/components/TradingChart";
import { getCachedBars, cacheBars, clearSymbolCache, getCacheStats } from "@/lib/indexeddb";
import { startAutoCleanup, stopAutoCleanup } from "@/lib/cacheManager";
import { LABEL_GENERATORS, type LabelGeneratorKey } from "@shared/mlTaxonomy";
import { useIndicatorData } from "@/hooks/useIndicatorData";
import { IndicatorSelector } from "@/components/IndicatorSelector";

const timeframes = [
  { label: "1m", minutes: 1 },
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1H", minutes: 60 },
  { label: "4H", minutes: 240 },
  { label: "1D", minutes: 1440 },
  { label: "1W", minutes: 10080 },
];

interface OhlcvData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function aggregateToTimeframe(data: OhlcvData[], timeframeMinutes: number): OhlcvData[] {
  if (data.length === 0) return [];
  
  const intervalMs = timeframeMinutes * 60 * 1000;
  const aggregated: Map<number, OhlcvData> = new Map();
  
  for (const candle of data) {
    const periodStart = Math.floor(candle.timestamp / intervalMs) * intervalMs;
    
    const existing = aggregated.get(periodStart);
    if (existing) {
      existing.high = Math.max(existing.high, candle.high);
      existing.low = Math.min(existing.low, candle.low);
      existing.close = candle.close;
      existing.volume += candle.volume;
    } else {
      aggregated.set(periodStart, {
        timestamp: periodStart,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
    }
  }
  
  return Array.from(aggregated.values()).sort((a, b) => a.timestamp - b.timestamp);
}

interface Rollover {
  id?: number;
  baseSymbol?: string;
  fromContract: string;
  toContract: string;
  rolloverTimestamp?: number;
  timestamp?: number;
  priceAdjustment: number;
  rolloverType?: string;
}

interface InstrumentInfo {
  symbol: string;
  name: string;
  assetType: string;
  exchange?: string;
}

export default function MarketData() {
  const [symbol, setSymbol] = useState("MNQ");
  const [assetType, setAssetType] = useState<"futures" | "forex">("futures");
  const [contract, setContract] = useState<string>("continuous"); // "continuous" or specific contract like "ESH5"
  const [timeframe, setTimeframe] = useState(1);
  const { toast } = useToast();
  const [cacheStats, setCacheStats] = useState<{ totalBars: number; symbols: number; sizeEstimate: string } | null>(null);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);

  // Indicator overlays
  const {
    catalog,
    selectedColumns,
    setSelectedColumns,
    overlays: indicatorOverlays,
    isLoading: indicatorsLoading,
  } = useIndicatorData(symbol, timeframe, assetType === "futures");

  const { data: rawInstruments } = useQuery<InstrumentInfo[]>({
    queryKey: ["/api/instruments"],
  });
  const allInstruments = Array.isArray(rawInstruments) ? rawInstruments : [];

  // Fetch all chart symbols (903 individual contracts + forex pairs)
  interface ChartSymbolInfo {
    symbol: string;
    row_count: number;
    first_bar: string;
    last_bar: string;
  }
  const { data: chartSymbols = [] } = useQuery<ChartSymbolInfo[]>({
    queryKey: ["/api/charts/symbols"],
  });

  const futuresSymbols = useMemo(() =>
    allInstruments.filter(i => i.assetType === 'futures').sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [allInstruments]
  );
  const forexSymbols = useMemo(() =>
    allInstruments.filter(i => i.assetType === 'forex').sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [allInstruments]
  );

  const activeSymbols = assetType === "futures" ? futuresSymbols : forexSymbols;

  // Get individual contracts for the selected futures root symbol
  const contractsForSymbol = useMemo(() => {
    if (assetType !== "futures" || !symbol) return [];
    // Match contracts starting with root symbol followed by month letter + year digits
    // e.g., ES → ESH0, ESH1, ESM5, etc. (exclude spreads with "-")
    const re = new RegExp(`^${symbol}[A-Z]\\d{1,2}$`);
    return chartSymbols
      .filter(s => re.test(s.symbol))
      .sort((a, b) => {
        // Sort by last_bar descending (most recent contracts first)
        return b.last_bar.localeCompare(a.last_bar);
      });
  }, [symbol, assetType, chartSymbols]);

  // The effective symbol to pass to chart queries
  const effectiveSymbol = contract === "continuous" ? symbol : contract;

  // Initialize cache auto-cleanup and fetch initial stats
  useEffect(() => {
    startAutoCleanup();
    getCacheStats().then(setCacheStats).catch(() => {});
    return () => {
      stopAutoCleanup();
    };
  }, []);

  // Refresh cache stats when symbol or timeframe changes
  useEffect(() => {
    getCacheStats().then(setCacheStats).catch(() => {});
  }, [effectiveSymbol, timeframe]);

  // Label preview state
  const [selectedGenerator, setSelectedGenerator] = useState<LabelGeneratorKey>("direction");
  const [labelPreview, setLabelPreview] = useState<LabelMarker[]>([]);
  const [showLabels, setShowLabels] = useState(false);
  const [labelParams, setLabelParams] = useState<Record<string, unknown>>({});
  
  const generatorDef = LABEL_GENERATORS[selectedGenerator];
  const defaultParams = useMemo(() => {
    const defaults: Record<string, unknown> = {};
    if (generatorDef?.params) {
      for (const param of generatorDef.params) {
        defaults[param.id] = param.default;
      }
    }
    return defaults;
  }, [generatorDef]);
  const currentParams = useMemo(() => ({ ...defaultParams, ...labelParams }), [defaultParams, labelParams]);

  const previewMutation = useMutation({
    mutationFn: async (data: { generatorType: string; symbol: string; params: Record<string, unknown>; limit: number; startTimestamp?: number; endTimestamp?: number; timeframeMinutes?: number }) => {
      const res = await fetch("/api/labels/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to preview labels");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success && data.preview) {
        const markers: LabelMarker[] = data.preview.map((row: Record<string, unknown>) => ({
          timestamp: row.timestamp as number,
          label: row.label as number | null,
          close: row.close as number,
        }));
        setLabelPreview(markers);
        setShowLabels(true);
      }
    },
    onError: () => {
      toast({
        title: "Preview Failed",
        description: "Could not generate label preview",
        variant: "destructive",
      });
    },
  });

  // Stable ref for the generate function so the effect doesn't re-fire on its own mutation object
  const generateLabelsRef = useRef<() => void>(() => {});

  const isFutures = assetType === "futures";
  const isContinuous = contract === "continuous";

  // State for visible chart data (sliding window - not all data in memory)
  const [visibleData, setVisibleData] = useState<OhlcvData[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreLeft, setHasMoreLeft] = useState(true);
  const [hasMoreRight, setHasMoreRight] = useState(false);
  
  // Keep track of visible range for sliding window
  const visibleRangeRef = useRef<{ start: number; end: number } | null>(null);
  const MAX_BARS_IN_MEMORY = 5000; // Keep max 5000 bars in memory

  // Helper to cache bars in IndexedDB
  const cacheNewBars = useCallback(async (bars: OhlcvData[]) => {
    if (bars.length === 0) return;
    const tfString = timeframe.toString();
    await cacheBars(effectiveSymbol, tfString, bars.map(b => ({
      timestamp: b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume
    })));
    // Update cache stats after caching
    getCacheStats().then(setCacheStats).catch(() => {});
  }, [effectiveSymbol, timeframe]);

  // Helper to get bars from cache
  const getBarsFromCache = useCallback(async (startTs: number, endTs: number): Promise<OhlcvData[]> => {
    const tfString = timeframe.toString();
    const cached = await getCachedBars(effectiveSymbol, tfString, startTs, endTs);
    return cached.map(b => ({
      symbol: b.symbol,
      timestamp: b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume
    }));
  }, [effectiveSymbol, timeframe]);

  const { data: parquetData, isLoading: isParquetLoading, refetch: refetchParquet } = useQuery({
    queryKey: ["/api/parquet", effectiveSymbol, "aggregated", timeframe],
    queryFn: async () => {
      const response = await fetch(`/api/parquet/${effectiveSymbol}/aggregated?timeframe=${timeframe}&limit=2000`);
      if (!response.ok) return [];
      const data = await response.json();
      setVisibleData(data);
      setHasMoreLeft(data.length > 0);
      setHasMoreRight(false);
      cacheNewBars(data);
      return data;
    },
    enabled: isFutures,
  });

  // Load more data when user scrolls to edges - with caching
  const handleLoadMore = useCallback(async (direction: 'left' | 'right', timestamp: number) => {
    if (isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      let newData: OhlcvData[] = [];

      const rangeMs = 2000 * timeframe * 60 * 1000;
      if (direction === 'left') {
        const cached = await getBarsFromCache(timestamp - rangeMs, timestamp - 1);
        if (cached.length > 100) newData = cached.slice(-2000);
      } else {
        const cached = await getBarsFromCache(timestamp + 1, timestamp + rangeMs);
        if (cached.length > 100) newData = cached.slice(0, 2000);
      }

      if (newData.length === 0) {
        // For continuous futures use continuous endpoint, for individual contracts use parquet
        let url = (isFutures && isContinuous)
          ? `/api/continuous/${effectiveSymbol}?timeframe=${timeframe}&limit=2000`
          : isFutures
            ? `/api/parquet/${effectiveSymbol}/aggregated?timeframe=${timeframe}&limit=2000`
            : `/api/ohlcv/${effectiveSymbol}?timeframe=${timeframe}&limit=2000`;

        if (direction === 'left') url += `&endTime=${timestamp - 1}`;
        else url += `&startTime=${timestamp + 1}`;

        const response = await fetch(url);
        if (!response.ok) { setIsLoadingMore(false); return; }

        const result = await response.json();
        newData = Array.isArray(result) ? result : (result.data || []);

        if (newData.length > 0) await cacheNewBars(newData);
      }

      if (newData.length === 0) {
        if (direction === 'left') setHasMoreLeft(false);
        else setHasMoreRight(false);
        setIsLoadingMore(false);
        return;
      }

      setVisibleData(prev => {
        const combined = direction === 'left'
          ? [...newData, ...prev]
          : [...prev, ...newData];

        const seen = new Set<number>();
        const deduped = combined.filter(d => {
          const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp) : d.timestamp;
          if (seen.has(ts)) return false;
          seen.add(ts);
          return true;
        }).sort((a, b) => {
          const tsA = typeof a.timestamp === 'string' ? parseInt(a.timestamp) : a.timestamp;
          const tsB = typeof b.timestamp === 'string' ? parseInt(b.timestamp) : b.timestamp;
          return tsA - tsB;
        });

        if (deduped.length > MAX_BARS_IN_MEMORY) {
          if (direction === 'left') {
            setHasMoreRight(true);
            return deduped.slice(0, MAX_BARS_IN_MEMORY);
          } else {
            setHasMoreLeft(true);
            return deduped.slice(-MAX_BARS_IN_MEMORY);
          }
        }
        return deduped;
      });

      if (newData.length < 2000) {
        if (direction === 'left') setHasMoreLeft(false);
        else setHasMoreRight(false);
      }
    } catch (error) {
      console.error('Error loading more data:', error);
    }
    setIsLoadingMore(false);
  }, [effectiveSymbol, timeframe, isLoadingMore, isFutures, isContinuous, cacheNewBars, getBarsFromCache]);

  const { data: continuousData } = useQuery({
    queryKey: ["/api/continuous", symbol, timeframe],
    queryFn: async () => {
      const response = await fetch(`/api/continuous/${symbol}?timeframe=${timeframe}&limit=500`);
      if (!response.ok) return { data: [], rollovers: [] };
      const result = await response.json();
      if (result.data && result.data.length > 0) {
        setVisibleData(result.data);
        setHasMoreLeft(true);
        setHasMoreRight(false);
      }
      return result;
    },
    enabled: isFutures && isContinuous && (!parquetData || parquetData.length === 0),
  });

  // Forex data state for infinite scroll
  const [forexVisibleData, setForexVisibleData] = useState<OhlcvData[]>([]);
  const [forexHasMoreLeft, setForexHasMoreLeft] = useState(true);
  const [forexHasMoreRight, setForexHasMoreRight] = useState(false);
  const [forexIsLoadingMore, setForexIsLoadingMore] = useState(false);

  const { data: ohlcvData, refetch: refetchForex } = useQuery({
    queryKey: ["/api/ohlcv", effectiveSymbol, timeframe],
    queryFn: async () => {
      const timeframeSec = timeframe * 60;
      const response = await fetch(`/api/ohlcv/${effectiveSymbol}?timeframe=${timeframeSec}s&limit=2000`);
      if (!response.ok) return [];
      const data = await response.json();
      setForexVisibleData(data);
      setForexHasMoreLeft(data.length >= 500);
      cacheNewBars(data);
      return data;
    },
    enabled: !isFutures,
  });

  // Load more forex data when user scrolls to edges
  const handleForexLoadMore = useCallback(async (direction: 'left' | 'right', timestamp: number) => {
    if (forexIsLoadingMore || isFutures) return;

    setForexIsLoadingMore(true);
    try {
      const tfString = timeframe.toString();
      let newData: OhlcvData[] = [];

      // First try cache (query actual bars, not metadata)
      const rangeMs = 2000 * timeframe * 60 * 1000;
      if (direction === 'left') {
        const cached = await getBarsFromCache(timestamp - rangeMs, timestamp - 1);
        if (cached.length > 100) {
          newData = cached.slice(-2000);
        }
      } else {
        const cached = await getBarsFromCache(timestamp + 1, timestamp + rangeMs);
        if (cached.length > 100) {
          newData = cached.slice(0, 2000);
        }
      }

      // Fetch from server if no sufficient cache hit
      if (newData.length === 0) {
        const timeframeSec = timeframe * 60;
        let url = `/api/ohlcv/${effectiveSymbol}?timeframe=${timeframeSec}s&limit=2000`;
        if (direction === 'left') {
          url += `&endTime=${timestamp}`;
        } else {
          url += `&startTime=${timestamp}`;
        }

        const response = await fetch(url);
        if (response.ok) {
          newData = await response.json();
          // Cache the new data
          if (newData.length > 0) {
            await cacheNewBars(newData);
          }
        }
      }

      if (newData.length > 0) {
        setForexVisibleData(prev => {
          const combined = direction === 'left'
            ? [...newData, ...prev]
            : [...prev, ...newData];

          // Deduplicate by timestamp
          const seen = new Set<number>();
          const deduped = combined.filter(d => {
            const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp) : d.timestamp;
            if (seen.has(ts)) return false;
            seen.add(ts);
            return true;
          }).sort((a, b) => {
            const tsA = typeof a.timestamp === 'string' ? parseInt(a.timestamp) : a.timestamp;
            const tsB = typeof b.timestamp === 'string' ? parseInt(b.timestamp) : b.timestamp;
            return tsA - tsB;
          });

          // Trim to max bars in memory
          if (deduped.length > MAX_BARS_IN_MEMORY) {
            if (direction === 'left') {
              setForexHasMoreRight(true); // dropped right-side bars
              return deduped.slice(0, MAX_BARS_IN_MEMORY);
            } else {
              setForexHasMoreLeft(true); // dropped left-side bars
              return deduped.slice(-MAX_BARS_IN_MEMORY);
            }
          }
          return deduped;
        });

        // Update hasMore flags based on fetch size
        if (newData.length < 2000) {
          if (direction === 'left') setForexHasMoreLeft(false);
          else setForexHasMoreRight(false);
        }
      } else {
        if (direction === 'left') setForexHasMoreLeft(false);
        else setForexHasMoreRight(false);
      }
    } finally {
      setForexIsLoadingMore(false);
    }
  }, [effectiveSymbol, timeframe, forexIsLoadingMore, isFutures, cacheNewBars, getBarsFromCache]);

  // Reset forex data when symbol or timeframe changes
  useEffect(() => {
    if (!isFutures) {
      setForexVisibleData([]);
      setForexHasMoreLeft(true);
      setForexHasMoreRight(false);
    }
  }, [symbol, timeframe, isFutures]);

  // Initialize forexVisibleData from ohlcvData when it loads
  useEffect(() => {
    if (!isFutures && ohlcvData && ohlcvData.length > 0 && forexVisibleData.length === 0) {
      setForexVisibleData(ohlcvData);
    }
  }, [isFutures, ohlcvData, forexVisibleData.length]);

  // Extract base symbol (e.g., MNQ from MNQM9 or MNQ2024)
  const baseSymbol = useMemo(() => {
    return symbol.replace(/[A-Z]\d{1,2}$/, '').replace(/\d{4}$/, '');
  }, [symbol]);

  const { data: rollovers = [] } = useQuery<Rollover[]>({
    queryKey: ["/api/parquet/rollovers", baseSymbol],
    queryFn: async () => {
      const response = await fetch(`/api/parquet/${baseSymbol}/rollovers`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.map((r: any) => ({
        ...r,
        rolloverTimestamp: r.timestamp,
        rolloverType: 'volume'
      }));
    },
    enabled: isFutures && baseSymbol.length > 0,
  });

  // Use visibleData for infinite scroll, fallback to parquetData/continuousData
  const rawData = isFutures 
    ? (visibleData.length > 0 ? visibleData : (parquetData && parquetData.length > 0 ? parquetData : (continuousData?.data || []))) 
    : (forexVisibleData.length > 0 ? forexVisibleData : (ohlcvData || []));
  
  // Both futures and forex now use server-side aggregation
  const aggregatedData = useMemo(() => {
    return rawData;
  }, [rawData]);

  // Keep the generate function ref up to date
  generateLabelsRef.current = () => {
    if (aggregatedData.length === 0 || previewMutation.isPending) return;
    const timestamps = aggregatedData.map((d: OhlcvData) => d.timestamp);
    const startTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : undefined;
    const endTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : undefined;
    previewMutation.mutate({
      generatorType: selectedGenerator,
      symbol: effectiveSymbol,
      params: currentParams,
      limit: 500,
      startTimestamp,
      endTimestamp,
      timeframeMinutes: timeframe,
    });
  };

  // Auto-generate labels when generator, symbol, timeframe, or params change (if labels are showing)
  useEffect(() => {
    if (!showLabels || aggregatedData.length === 0) return;
    // Debounce to avoid rapid re-fires when params change quickly
    const timer = setTimeout(() => {
      generateLabelsRef.current();
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGenerator, effectiveSymbol, timeframe, currentParams, showLabels, aggregatedData.length]);

  // Filter labels to only show those within the visible data range
  const visibleLabels = useMemo(() => {
    if (!showLabels || labelPreview.length === 0 || aggregatedData.length === 0) {
      return [];
    }

    // Both aggregatedData and label timestamps may be in ms or seconds — normalize both to seconds
    const sampleDataTs = aggregatedData[0].timestamp;
    const dataInMs = sampleDataTs > 1e12;

    const toSec = (ts: number) => ts > 1e12 ? Math.floor(ts / 1000) : ts;
    const timeframeSec = timeframe * 60;

    // Build a set of candle timestamps in seconds, aligned to the current timeframe
    const dataTimestamps = new Set(
      aggregatedData.map((d: OhlcvData) => {
        const sec = toSec(d.timestamp);
        return Math.floor(sec / timeframeSec) * timeframeSec;
      })
    );
    const minTs = toSec(aggregatedData[0].timestamp);
    const maxTs = toSec(aggregatedData[aggregatedData.length - 1].timestamp);

    // Only include labels that fall within the visible data range
    return labelPreview.filter(label => {
      const labelTsSec = toSec(label.timestamp);
      // Align to the chart's timeframe boundaries
      const alignedTs = Math.floor(labelTsSec / timeframeSec) * timeframeSec;

      return alignedTs >= minTs &&
        alignedTs <= maxTs &&
        dataTimestamps.has(alignedTs);
    });
  }, [labelPreview, aggregatedData, showLabels, timeframe]);

  // Compute label distribution from visible labels only
  const labelDistribution = useMemo(() => {
    const buy = visibleLabels.filter(l => l.label === 1).length;
    const sell = visibleLabels.filter(l => l.label === -1).length;
    const hold = visibleLabels.filter(l => l.label === 0).length;
    const total = visibleLabels.length;
    
    return {
      buy,
      sell,
      hold,
      total,
      buyPct: total > 0 ? ((buy / total) * 100).toFixed(1) : '0.0',
      sellPct: total > 0 ? ((sell / total) * 100).toFixed(1) : '0.0',
      holdPct: total > 0 ? ((hold / total) * 100).toFixed(1) : '0.0',
    };
  }, [visibleLabels]);

  // Check if we're using parquet data for infinite scroll (or forex visible data)
  // Enable infinite scroll for all data types with visible data
  const useInfiniteScroll = isFutures 
    ? visibleData.length > 0 
    : forexVisibleData.length > 0;

  const selectSymbol = async (sym: string, type: "futures" | "forex") => {
    // Clear old cache for this symbol to ensure fresh back-adjusted data
    await clearSymbolCache(sym);
    setSymbol(sym);
    setAssetType(type);
    setContract("continuous"); // Reset to continuous when changing root symbol
    // Reset infinite scroll state when changing symbols
    setVisibleData([]);
    setHasMoreLeft(true);
    setHasMoreRight(false);
    // Reset forex scroll state too
    setForexVisibleData([]);
    setForexHasMoreLeft(true);
  };

  return (
    <div className="space-y-4 h-[calc(100vh-6rem)] flex flex-col overflow-hidden">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500/30 to-teal-500/30 flex items-center justify-center">
              <Database className="h-5 w-5 text-violet-300" />
            </div>
            <span className="text-sm font-medium text-violet-300/80">Market Data</span>
          </div>
          <h1 className="text-4xl font-display font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">Market Data</h1>
        </div>
        <div className="flex items-center gap-3">
          {cacheStats && (
            <div 
              data-testid="cache-stats-indicator"
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 flex items-center gap-2"
            >
              <div data-testid="cache-status-dot" className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
              <span className="text-xs text-muted-foreground">Cache:</span>
              <span data-testid="text-cache-size" className="text-xs font-mono text-teal-400">{cacheStats.sizeEstimate}</span>
              <span data-testid="text-cache-bars" className="text-[10px] text-muted-foreground">({cacheStats.totalBars.toLocaleString()} bars)</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <Tabs value={assetType} onValueChange={(v) => {
          const newType = v as "futures" | "forex";
          setAssetType(newType);
          setSymbol(newType === "futures" ? "ES" : "EURUSD");
        }}>
          <TabsList className="glass rounded-xl p-1 h-auto">
            <TabsTrigger value="futures" className="rounded-lg px-4 py-1.5 text-xs data-[state=active]:bg-primary/20" data-testid="tab-futures">
              <TrendingUp className="h-3 w-3 mr-1.5" /> Futures
            </TabsTrigger>
            <TabsTrigger value="forex" className="rounded-lg px-4 py-1.5 text-xs data-[state=active]:bg-accent/20" data-testid="tab-forex">
              <DollarSign className="h-3 w-3 mr-1.5" /> Forex
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Popover open={symbolOpen} onOpenChange={setSymbolOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={symbolOpen}
              className="w-[280px] justify-between h-9 text-sm font-mono border-white/10 bg-black/30"
              data-testid="symbol-selector"
            >
              <span className="flex items-center gap-2">
                <span className="text-primary font-semibold">{symbol}</span>
                {activeSymbols.find(s => s.symbol === symbol)?.name && (
                  <span className="text-muted-foreground text-xs font-sans truncate">
                    {activeSymbols.find(s => s.symbol === symbol)?.name}
                  </span>
                )}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search symbol..." />
              <CommandList>
                <CommandEmpty>No symbol found.</CommandEmpty>
                <CommandGroup>
                  {activeSymbols.map((inst) => (
                    <CommandItem
                      key={inst.symbol}
                      value={`${inst.symbol} ${inst.name}`}
                      onSelect={() => {
                        selectSymbol(inst.symbol, assetType);
                        setSymbolOpen(false);
                      }}
                      className="flex items-center gap-2"
                    >
                      <Check className={`h-3 w-3 ${symbol === inst.symbol ? 'opacity-100' : 'opacity-0'}`} />
                      <span className="font-mono font-semibold text-xs">{inst.symbol}</span>
                      <span className="text-muted-foreground text-xs truncate">{inst.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Contract rollover dropdown — only for futures */}
        {isFutures && contractsForSymbol.length > 0 && (
          <Popover open={contractOpen} onOpenChange={setContractOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={contractOpen}
                className="w-[200px] justify-between h-9 text-sm font-mono border-white/10 bg-black/30"
                data-testid="contract-selector"
              >
                <span className="flex items-center gap-2">
                  <ArrowRightLeft className="h-3 w-3 text-amber-400" />
                  {contract === "continuous" ? "Continuous" : contract}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[280px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search contract..." />
                <CommandList>
                  <CommandEmpty>No contract found.</CommandEmpty>
                  <CommandGroup heading="View Mode">
                    <CommandItem
                      value="continuous back-adjusted"
                      onSelect={() => {
                        setContract("continuous");
                        setContractOpen(false);
                        setVisibleData([]);
                        setHasMoreLeft(true);
                        setHasMoreRight(false);
                      }}
                      className="flex items-center gap-2"
                    >
                      <Check className={`h-3 w-3 ${contract === "continuous" ? 'opacity-100' : 'opacity-0'}`} />
                      <span className="font-semibold text-xs">Continuous</span>
                      <span className="text-muted-foreground text-[10px]">Back-adjusted</span>
                    </CommandItem>
                  </CommandGroup>
                  <CommandGroup heading={`Individual Contracts (${contractsForSymbol.length})`}>
                    {contractsForSymbol.map((c) => (
                      <CommandItem
                        key={c.symbol}
                        value={c.symbol}
                        onSelect={() => {
                          setContract(c.symbol);
                          setContractOpen(false);
                          setVisibleData([]);
                          setHasMoreLeft(true);
                          setHasMoreRight(false);
                        }}
                        className="flex items-center gap-2"
                      >
                        <Check className={`h-3 w-3 ${contract === c.symbol ? 'opacity-100' : 'opacity-0'}`} />
                        <span className="font-mono font-semibold text-xs">{c.symbol}</span>
                        <span className="text-muted-foreground text-[10px] ml-auto">
                          {Number(c.row_count).toLocaleString()} bars
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Main content: Chart (65%) + Side panels (35%) */}
      <div className="flex gap-3 flex-1 min-h-0 overflow-hidden">
        {/* Chart Panel - 65% of screen */}
        <Card className="flex-[2] glass rounded-2xl gradient-border flex flex-col overflow-hidden">
          <CardHeader className="py-2 px-4 border-b border-white/5 shrink-0">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Sparkles className="h-3 w-3 text-primary" />
              {effectiveSymbol}
              {contract !== "continuous" && (
                <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400 ml-1">
                  Single Contract
                </Badge>
              )}
              <div className="flex items-center gap-1 ml-4">
                {timeframes.map((tf) => (
                  <Button
                    key={tf.label}
                    variant={timeframe === tf.minutes ? "default" : "ghost"}
                    size="sm"
                    className={`h-5 px-2 text-[10px] font-mono ${
                      timeframe === tf.minutes 
                        ? "bg-primary/20 text-primary border border-primary/30" 
                        : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                    }`}
                    onClick={() => setTimeframe(tf.minutes)}
                    data-testid={`timeframe-${tf.label}`}
                  >
                    {tf.label}
                  </Button>
                ))}
              </div>
              <IndicatorSelector
                catalog={catalog}
                selectedColumns={selectedColumns}
                onSelectionChange={setSelectedColumns}
                isLoading={indicatorsLoading}
              />
              <span className="ml-auto text-[10px] text-muted-foreground/60 flex items-center gap-2">
                {activeSymbols.find(s => s.symbol === symbol)?.name}
                {rawData.length > 0 && ` • ${aggregatedData.length.toLocaleString()} bars`}
                {isFutures && isContinuous && rollovers.length > 0 && (
                  <span className="flex items-center gap-1 text-amber-400">
                    <ArrowRightLeft className="h-3 w-3" />
                    {rollovers.length} rollovers
                  </span>
                )}
                {isLoadingMore && (
                  <span className="flex items-center gap-1 text-violet-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading...
                  </span>
                )}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-2 min-h-0">
            {aggregatedData.length > 0 ? (
              <TradingChart
                data={aggregatedData}
                symbol={effectiveSymbol}
                isFutures={isFutures}
                timeframe={timeframe}
                onLoadMore={useInfiniteScroll ? (isFutures ? handleLoadMore : handleForexLoadMore) : undefined}
                isLoadingMore={isFutures ? isLoadingMore : forexIsLoadingMore}
                hasMoreLeft={isFutures ? hasMoreLeft : forexHasMoreLeft}
                hasMoreRight={isFutures ? hasMoreRight : forexHasMoreRight}
                rollovers={isFutures && isContinuous ? rollovers : []}
                labelMarkers={showLabels ? visibleLabels : []}
                indicatorOverlays={indicatorOverlays}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                <Database className="h-12 w-12 mb-3 opacity-20" />
                <p className="font-mono text-sm">No data for {effectiveSymbol}</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Upload {isFutures ? 'futures' : 'forex'} data to see the chart</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Side Panels - 35% of screen */}
        <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-hidden">
          <Card className="glass rounded-2xl gradient-border flex flex-col overflow-hidden flex-1">
              <CardHeader className="py-2 px-4 border-b border-white/5 shrink-0">
                <CardTitle className="text-xs font-medium text-violet-400 flex items-center gap-2">
                  <Tag className="h-3 w-3" /> Label Preview
                  {showLabels && visibleLabels.length > 0 && (
                    <Badge variant="outline" className="ml-auto text-[10px] border-green-500/30 text-green-400">
                      {visibleLabels.length} labels
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2 pb-3 space-y-3 flex-1 overflow-auto">
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Generator</label>
                    <Select
                      value={selectedGenerator}
                      onValueChange={(v) => {
                        setSelectedGenerator(v as LabelGeneratorKey);
                        setLabelParams({});
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs bg-black/30 border-white/10" data-testid="select-generator">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(LABEL_GENERATORS).map(([key, gen]) => (
                          <SelectItem key={key} value={key} className="text-xs">
                            {gen.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {generatorDef?.params && generatorDef.params.length > 0 && (
                    <div className="space-y-2 p-2 rounded-lg bg-white/5">
                      <p className="text-[9px] text-muted-foreground font-medium">Parameters</p>
                      {generatorDef.params.slice(0, 3).map((param) => (
                        <div key={param.id} className="flex items-center gap-2">
                          <label className="text-[10px] text-muted-foreground flex-1">{param.name}</label>
                          <Input
                            type="number"
                            value={(currentParams[param.id] as number) ?? param.default}
                            onChange={(e) => setLabelParams(prev => ({ ...prev, [param.id]: parseFloat(e.target.value) }))}
                            className="h-6 w-20 text-[10px] bg-black/30 border-white/10"
                            data-testid={`param-${param.id}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => generateLabelsRef.current()}
                      disabled={previewMutation.isPending || aggregatedData.length === 0}
                      className="flex-1 h-7 text-[10px] bg-gradient-to-r from-violet-600 to-teal-500"
                      data-testid="button-preview-labels"
                    >
                      {previewMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <Eye className="h-3 w-3 mr-1" />
                      )}
                      Preview
                    </Button>
                    {showLabels && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowLabels(false);
                          setLabelPreview([]);
                        }}
                        className="h-7 text-[10px] border-white/10"
                        data-testid="button-clear-labels"
                      >
                        Clear
                      </Button>
                    )}
                  </div>

                  {showLabels && visibleLabels.length > 0 && (
                    <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/20 space-y-2">
                      <p className="text-[10px] text-green-400 font-medium flex items-center gap-1">
                        <BarChart3 className="h-3 w-3" />
                        Label Distribution ({labelDistribution.total} visible)
                      </p>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-green-500 rounded-full transition-all"
                              style={{ width: `${labelDistribution.buyPct}%` }}
                            />
                          </div>
                          <span className="text-green-400 text-[9px] font-mono w-16 text-right">
                            BUY {labelDistribution.buy} ({labelDistribution.buyPct}%)
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-rose-500 rounded-full transition-all"
                              style={{ width: `${labelDistribution.sellPct}%` }}
                            />
                          </div>
                          <span className="text-rose-400 text-[9px] font-mono w-16 text-right">
                            SELL {labelDistribution.sell} ({labelDistribution.sellPct}%)
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-violet-500 rounded-full transition-all"
                              style={{ width: `${labelDistribution.holdPct}%` }}
                            />
                          </div>
                          <span className="text-violet-400 text-[9px] font-mono w-16 text-right">
                            HOLD {labelDistribution.hold} ({labelDistribution.holdPct}%)
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-2 rounded-lg bg-white/5 mt-auto">
                  <p className="font-mono text-sm text-primary">{effectiveSymbol}</p>
                  <p className="text-[9px] text-muted-foreground">
                    {activeSymbols.find(s => s.symbol === symbol)?.name}
                    {contract !== "continuous" && " (Individual Contract)"}
                  </p>
                </div>
              </CardContent>
            </Card>
        </div>
      </div>
    </div>
  );
}
