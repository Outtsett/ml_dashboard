import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Database, Loader2, Sparkles, TrendingUp, DollarSign, ArrowRightLeft, Tag, Eye, Play, BarChart3 } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import TradingChart, { LabelMarker } from "@/components/TradingChart";
import { getCachedBars, cacheBars, clearSymbolCache, getCacheStats } from "@/lib/indexeddb";
import { startAutoCleanup, stopAutoCleanup } from "@/lib/cacheManager";
import { LABEL_GENERATORS, type LabelGeneratorKey } from "@shared/mlTaxonomy";

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

export default function DataSets() {
  const [symbol, setSymbol] = useState("MNQ");
  const [assetType, setAssetType] = useState<"futures" | "forex">("futures");
  const [timeframe, setTimeframe] = useState(1);
  const { toast } = useToast();
  const [cacheStats, setCacheStats] = useState<{ totalBars: number; symbols: number; sizeEstimate: string } | null>(null);

  const { data: rawInstruments } = useQuery<InstrumentInfo[]>({
    queryKey: ["/api/instruments"],
  });
  const allInstruments = Array.isArray(rawInstruments) ? rawInstruments : [];
  const futuresSymbols = useMemo(() =>
    allInstruments.filter(i => i.assetType === 'futures').sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [allInstruments]
  );
  const forexSymbols = useMemo(() =>
    allInstruments.filter(i => i.assetType === 'forex').sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [allInstruments]
  );

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
  }, [symbol, timeframe]);

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
    mutationFn: async (data: { generatorType: string; symbol: string; params: Record<string, unknown>; limit: number; startTimestamp?: number; endTimestamp?: number }) => {
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
        toast({
          title: "Labels Generated",
          description: `${markers.length} labels previewed on chart`,
        });
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

  const isFutures = assetType === "futures";

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
    await cacheBars(symbol, tfString, bars.map(b => ({
      timestamp: b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume
    })));
    // Update cache stats after caching
    getCacheStats().then(setCacheStats).catch(() => {});
  }, [symbol, timeframe]);

  // Helper to get bars from cache
  const getBarsFromCache = useCallback(async (startTs: number, endTs: number): Promise<OhlcvData[]> => {
    const tfString = timeframe.toString();
    const cached = await getCachedBars(symbol, tfString, startTs, endTs);
    return cached.map(b => ({
      symbol: b.symbol,
      timestamp: b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume
    }));
  }, [symbol, timeframe]);

  const { data: parquetData, isLoading: isParquetLoading, refetch: refetchParquet } = useQuery({
    queryKey: ["/api/parquet", symbol, "aggregated", timeframe],
    queryFn: async () => {
      // Use server-side aggregation for the requested timeframe
      const response = await fetch(`/api/parquet/${symbol}/aggregated?timeframe=${timeframe}&limit=2000`);
      if (!response.ok) return [];
      const data = await response.json();
      // Initialize visible data with initial fetch
      setVisibleData(data);
      // Always assume there's more historical data unless we got less than requested
      setHasMoreLeft(data.length > 0);
      setHasMoreRight(false);
      // Cache the bars in IndexedDB
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
      const tfString = timeframe.toString();
      let newData: OhlcvData[] = [];
      
      // First try to get from cache (query actual bars, not metadata)
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

      // If no sufficient cache hit, fetch from server
      if (newData.length === 0) {
        // Try parquet first, fallback to continuous endpoint for futures
        let url = isFutures 
          ? `/api/continuous/${symbol}?timeframe=${timeframe}&limit=2000`
          : `/api/ohlcv/${symbol}?timeframe=${timeframe}&limit=2000`;
        
        if (direction === 'left') {
          url += `&endTime=${timestamp - 1}`;
        } else {
          url += `&startTime=${timestamp + 1}`;
        }
        
        const response = await fetch(url);
        if (!response.ok) {
          setIsLoadingMore(false);
          return;
        }
        
        const result = await response.json();
        // Handle both formats: { data: [...] } or [...]
        newData = Array.isArray(result) ? result : (result.data || []);
        
        // Cache the fetched data
        if (newData.length > 0) {
          await cacheNewBars(newData);
        }
      }
      
      if (newData.length === 0) {
        if (direction === 'left') setHasMoreLeft(false);
        else setHasMoreRight(false);
        setIsLoadingMore(false);
        return;
      }
      
      // Merge with visible data using sliding window
      setVisibleData(prev => {
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
        
        // Apply sliding window - keep only MAX_BARS_IN_MEMORY
        if (deduped.length > MAX_BARS_IN_MEMORY) {
          if (direction === 'left') {
            setHasMoreRight(true); // dropped right-side bars
            return deduped.slice(0, MAX_BARS_IN_MEMORY);
          } else {
            setHasMoreLeft(true); // dropped left-side bars
            return deduped.slice(-MAX_BARS_IN_MEMORY);
          }
        }
        
        return deduped;
      });
      
      // Update hasMore flags
      if (newData.length < 2000) {
        if (direction === 'left') setHasMoreLeft(false);
        else setHasMoreRight(false);
      }
    } catch (error) {
      console.error('Error loading more data:', error);
    }
    setIsLoadingMore(false);
  }, [symbol, timeframe, isLoadingMore, isFutures, cacheNewBars, getBarsFromCache]);

  const { data: continuousData } = useQuery({
    queryKey: ["/api/continuous", symbol, timeframe],
    queryFn: async () => {
      const response = await fetch(`/api/continuous/${symbol}?timeframe=${timeframe}&limit=500`);
      if (!response.ok) return { data: [], rollovers: [] };
      const result = await response.json();
      // Initialize visible data from continuous data
      if (result.data && result.data.length > 0) {
        setVisibleData(result.data);
        setHasMoreLeft(true);
        setHasMoreRight(false);
      }
      return result;
    },
    enabled: isFutures && (!parquetData || parquetData.length === 0),
  });

  // Forex data state for infinite scroll
  const [forexVisibleData, setForexVisibleData] = useState<OhlcvData[]>([]);
  const [forexHasMoreLeft, setForexHasMoreLeft] = useState(true);
  const [forexHasMoreRight, setForexHasMoreRight] = useState(false);
  const [forexIsLoadingMore, setForexIsLoadingMore] = useState(false);

  const { data: ohlcvData, refetch: refetchForex } = useQuery({
    queryKey: ["/api/ohlcv", symbol, timeframe],
    queryFn: async () => {
      // Use server-side aggregation with timeframe in minutes converted to seconds
      const timeframeSec = timeframe * 60;
      const response = await fetch(`/api/ohlcv/${symbol}?timeframe=${timeframeSec}s&limit=2000`);
      if (!response.ok) return [];
      const data = await response.json();
      // Initialize forex visible data
      setForexVisibleData(data);
      setForexHasMoreLeft(data.length >= 500);
      // Cache in IndexedDB
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
        let url = `/api/ohlcv/${symbol}?timeframe=${timeframeSec}s&limit=2000`;
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
  }, [symbol, timeframe, forexIsLoadingMore, isFutures, cacheNewBars, getBarsFromCache]);

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
            <span className="text-sm font-medium text-violet-300/80">Data Management</span>
          </div>
          <h1 className="text-4xl font-display font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">Data Sets</h1>
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

      <Tabs value={assetType} onValueChange={(v) => {
        setAssetType(v as "futures" | "forex");
        setSymbol(v === "futures" ? "ES" : "EURUSD");
      }} className="shrink-0">
        <TabsList className="glass rounded-xl p-1 h-auto">
          <TabsTrigger value="futures" className="rounded-lg px-4 py-1.5 text-xs data-[state=active]:bg-primary/20" data-testid="tab-futures">
            <TrendingUp className="h-3 w-3 mr-1.5" /> Futures
          </TabsTrigger>
          <TabsTrigger value="forex" className="rounded-lg px-4 py-1.5 text-xs data-[state=active]:bg-accent/20" data-testid="tab-forex">
            <DollarSign className="h-3 w-3 mr-1.5" /> Forex
          </TabsTrigger>
        </TabsList>

        <TabsContent value="futures" className="mt-2">
          <div className="flex flex-wrap gap-1.5">
            {futuresSymbols.map((f) => (
              <Button
                key={f.symbol}
                variant={symbol === f.symbol ? "default" : "outline"}
                size="sm"
                onClick={() => selectSymbol(f.symbol, "futures")}
                className={`rounded-lg text-xs font-mono h-7 px-2 ${symbol === f.symbol ? 'bg-primary text-white' : 'border-white/10'}`}
                data-testid={`button-futures-${f.symbol}`}
              >
                {f.symbol}
              </Button>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="forex" className="mt-2">
          <div className="flex flex-wrap gap-1.5">
            {forexSymbols.map((f) => (
              <Button
                key={f.symbol}
                variant={symbol === f.symbol ? "default" : "outline"}
                size="sm"
                onClick={() => selectSymbol(f.symbol, "forex")}
                className={`rounded-lg text-xs font-mono h-7 px-2 ${symbol === f.symbol ? 'bg-accent text-white' : 'border-white/10'}`}
                data-testid={`button-forex-${f.symbol}`}
              >
                {f.symbol}
              </Button>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Main content: Chart (65%) + Side panels (35%) */}
      <div className="flex gap-3 flex-1 min-h-0 overflow-hidden">
        {/* Chart Panel - 65% of screen */}
        <Card className="flex-[2] glass rounded-2xl gradient-border flex flex-col overflow-hidden">
          <CardHeader className="py-2 px-4 border-b border-white/5 shrink-0">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Sparkles className="h-3 w-3 text-primary" /> 
              {symbol}
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
              <span className="ml-auto text-[10px] text-muted-foreground/60 flex items-center gap-2">
                {isFutures 
                  ? futuresSymbols.find(f => f.symbol === symbol)?.name 
                  : forexSymbols.find(f => f.symbol === symbol)?.name}
                {rawData.length > 0 && ` • ${aggregatedData.length.toLocaleString()} bars`}
                {isFutures && rollovers.length > 0 && (
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
                symbol={symbol} 
                isFutures={isFutures}
                timeframe={timeframe}
                onLoadMore={useInfiniteScroll ? (isFutures ? handleLoadMore : handleForexLoadMore) : undefined}
                isLoadingMore={isFutures ? isLoadingMore : forexIsLoadingMore}
                hasMoreLeft={isFutures ? hasMoreLeft : forexHasMoreLeft}
                hasMoreRight={isFutures ? hasMoreRight : forexHasMoreRight}
                rollovers={isFutures ? rollovers : []}
                labelMarkers={showLabels ? visibleLabels : []}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                <Database className="h-12 w-12 mb-3 opacity-20" />
                <p className="font-mono text-sm">No data for {symbol}</p>
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
                        setLabelPreview([]);
                        setShowLabels(false);
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
                      onClick={() => {
                        // Get visible data time range to match labels with chart
                        const timestamps = aggregatedData.map((d: OhlcvData) => d.timestamp);
                        const startTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : undefined;
                        const endTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : undefined;
                        
                        previewMutation.mutate({
                          generatorType: selectedGenerator,
                          symbol,
                          params: currentParams,
                          limit: 500,
                          startTimestamp,
                          endTimestamp,
                        });
                      }}
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
                  <p className="font-mono text-sm text-primary">{symbol}</p>
                  <p className="text-[9px] text-muted-foreground">
                    {isFutures ? futuresSymbols.find(f => f.symbol === symbol)?.name : forexSymbols.find(f => f.symbol === symbol)?.name}
                  </p>
                </div>
              </CardContent>
            </Card>
        </div>
      </div>
    </div>
  );
}
