import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Database, Loader2, Sparkles, TrendingUp, DollarSign, ArrowRightLeft, ChevronsUpDown, Check, Clock, Layers, ZapOff } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { type LabelMarker } from "@/components/TradingChart";
import IndicatorChartLayout from "@/components/IndicatorChartLayout";
import { clearAllCache } from "@/lib/indexeddb";
import { useIndicatorData } from "@/hooks/useIndicatorData";
import { IndicatorSelector } from "@/components/IndicatorSelector";
import { useBreadcrumbs } from "@/hooks/useBreadcrumbs";
import { computeSupportResistance, computeZigZag, computeSwingZigZag } from "@/lib/chartOverlays";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { MLWorkflowSidebar } from "@/components/sidebar/MLWorkflowSidebar";
import { BottomPanel } from "@/components/panels/BottomPanel";

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
  activeContract?: string;
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
  // ── Unified context: local state syncs bidirectionally with dashboard-wide context ──
  const dashboard = useDashboard();
  const [symbol, setSymbolLocal] = useState(dashboard.symbol);
  const [assetType, setAssetTypeLocal] = useState<"futures" | "forex">(dashboard.assetType);
  const [contract, setContract] = useState<string>("continuous"); // "continuous" or specific contract like "ESH5"
  const [timeframe, setTimeframeLocal] = useState(dashboard.timeframeMinutes);
  const { toast } = useToast();
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);

  // Sync local → context when user changes symbol/tf here
  const setSymbol = useCallback((s: string) => {
    setSymbolLocal(s);
    dashboard.setSymbol(s);
  }, [dashboard]);

  const setAssetType = useCallback((t: "futures" | "forex") => {
    setAssetTypeLocal(t);
    dashboard.setAssetType(t);
  }, [dashboard]);

  const setTimeframe = useCallback((m: number) => {
    setTimeframeLocal(m);
    dashboard.setTimeframeMinutes(m);
  }, [dashboard]);

  // Sync context → local when another page changes symbol
  useEffect(() => {
    if (dashboard.symbol !== symbol) {
      setSymbolLocal(dashboard.symbol);
    }
    if (dashboard.assetType !== assetType) {
      setAssetTypeLocal(dashboard.assetType);
    }
    if (dashboard.timeframeMinutes !== timeframe) {
      setTimeframeLocal(dashboard.timeframeMinutes);
    }
  }, [dashboard.symbol, dashboard.assetType, dashboard.timeframeMinutes]);

  const tfLabel = timeframes.find(t => t.minutes === timeframe)?.label ?? `${timeframe}m`;
  useBreadcrumbs([
    { label: assetType === "futures" ? "Futures" : "Forex", icon: assetType === "futures" ? TrendingUp : DollarSign },
    { label: symbol },
    { label: contract === "continuous" ? "Continuous" : contract },
    { label: tfLabel, icon: Clock },
  ]);

  // Indicator overlays
  const {
    catalog,
    selectedColumns,
    setSelectedColumns,
    overlays: indicatorOverlays,
    isLoading: indicatorsLoading,
  } = useIndicatorData(symbol, timeframe, assetType === "futures");

  // Callback for subchart panel close buttons to remove indicator columns
  const handleRemoveIndicators = useCallback((columns: string[]) => {
    const newSelection = selectedColumns.filter(c => !columns.includes(c));
    setSelectedColumns(newSelection);
  }, [selectedColumns, setSelectedColumns]);

  // ── Chart overlay toggles (S/R + ZigZag) ──
  const [showSR, setShowSR] = useState(false);
  const [showZigZag, setShowZigZag] = useState(false);
  const [showSwingZZ, setShowSwingZZ] = useState(false);

  // ── Label markers from sidebar workflow panel ──
  const [sidebarLabelMarkers, setSidebarLabelMarkers] = useState<LabelMarker[]>([]);
  const [sidebarShowLabels, setSidebarShowLabels] = useState(false);
  const handleLabelMarkersChange = useCallback((markers: LabelMarker[], show: boolean) => {
    setSidebarLabelMarkers(markers);
    setSidebarShowLabels(show);
  }, []);

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

  // Clear any stale IndexedDB OHLCV cache from previous sessions on mount
  useEffect(() => {
    clearAllCache().catch(() => {});
  }, []);



  const isFutures = assetType === "futures";
  const isContinuous = contract === "continuous";

  // State for visible chart data (sliding window - not all data in memory)
  const [visibleData, setVisibleData] = useState<OhlcvData[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreLeft, setHasMoreLeft] = useState(true);
  const [hasMoreRight, setHasMoreRight] = useState(false);
  
  // Keep track of visible range for sliding window
  const visibleRangeRef = useRef<{ start: number; end: number } | null>(null);
  const isLoadingMoreRef = useRef(false);
  const MAX_BARS_IN_MEMORY = 50000; // Keep max 50K bars in memory (~2.5MB)
  
  // Adaptive fetch limit: scale down for higher timeframes to avoid over-fetching
  const FETCH_LIMIT = useMemo(() => {
    if (timeframe <= 1) return 10000;
    if (timeframe <= 5) return 5000;
    if (timeframe <= 15) return 3000;
    if (timeframe <= 30) return 2000;
    if (timeframe <= 60) return 1500;
    if (timeframe <= 240) return 1000;
    if (timeframe <= 1440) return 500;
    return 250; // weekly
  }, [timeframe]);

  // Reset futures infinite scroll state when symbol, timeframe, or contract changes
  useEffect(() => {
    if (isFutures) {
      setVisibleData([]);
      setHasMoreLeft(true);
      setHasMoreRight(false);
      isLoadingMoreRef.current = false;
    }
  }, [effectiveSymbol, timeframe, isFutures]);

  const { data: parquetData, isLoading: isParquetLoading, refetch: refetchParquet } = useQuery({
    queryKey: ["/api/parquet", effectiveSymbol, "aggregated", timeframe],
    queryFn: async () => {
      const response = await fetch(`/api/parquet/${effectiveSymbol}/aggregated?timeframe=${timeframe}&limit=${FETCH_LIMIT}`);
      if (!response.ok) return [];
      const data = await response.json();
      setVisibleData(data);
      setHasMoreLeft(data.length > 0);
      setHasMoreRight(false);
      return data;
    },
    enabled: isFutures,
  });

  // Load more data when user scrolls to edges (server-side LRU handles caching)
  const handleLoadMore = useCallback(async (direction: 'left' | 'right', timestamp: number) => {
    if (isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      // Always fetch from server — server-side LRU cache handles dedup
      let url = (isFutures && isContinuous)
        ? `/api/continuous/${effectiveSymbol}?timeframe=${timeframe}&limit=${FETCH_LIMIT}`
        : isFutures
          ? `/api/parquet/${effectiveSymbol}/aggregated?timeframe=${timeframe}&limit=${FETCH_LIMIT}`
          : `/api/ohlcv/${effectiveSymbol}?timeframe=${timeframe * 60}s&limit=${FETCH_LIMIT}`;

      if (direction === 'left') url += `&endTime=${timestamp - 1}`;
      else url += `&startTime=${timestamp + 1}`;

      const response = await fetch(url);
      if (!response.ok) { isLoadingMoreRef.current = false; setIsLoadingMore(false); return; }

      const result = await response.json();
      const newData: OhlcvData[] = Array.isArray(result) ? result : (result.data || []);

      if (newData.length === 0) {
        if (direction === 'left') setHasMoreLeft(false);
        else setHasMoreRight(false);
        isLoadingMoreRef.current = false;
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

      if (newData.length < FETCH_LIMIT) {
        if (direction === 'left') setHasMoreLeft(false);
        else setHasMoreRight(false);
      }
    } catch (error) {
      console.error('Error loading more data:', error);
    }
    isLoadingMoreRef.current = false;
    setIsLoadingMore(false);
  }, [effectiveSymbol, timeframe, isFutures, isContinuous, FETCH_LIMIT]);

  const { data: continuousData } = useQuery({
    queryKey: ["/api/continuous", symbol, timeframe],
    queryFn: async () => {
      const response = await fetch(`/api/continuous/${symbol}?timeframe=${timeframe}&limit=${FETCH_LIMIT}`);
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
      const response = await fetch(`/api/ohlcv/${effectiveSymbol}?timeframe=${timeframeSec}s&limit=${FETCH_LIMIT}`);
      if (!response.ok) return [];
      const data = await response.json();
      setForexVisibleData(data);
      setForexHasMoreLeft(data.length > 0);
      setForexHasMoreRight(false);
      return data;
    },
    enabled: !isFutures,
  });

  // Load more forex data when user scrolls to edges (server-side LRU handles caching)
  const forexIsLoadingMoreRef = useRef(false);

  const handleForexLoadMore = useCallback(async (direction: 'left' | 'right', timestamp: number) => {
    if (forexIsLoadingMoreRef.current || isFutures) return;
    forexIsLoadingMoreRef.current = true;
    setForexIsLoadingMore(true);
    try {
      let newData: OhlcvData[] = [];

      // Always fetch from server — server-side LRU cache handles dedup
      const timeframeSec = timeframe * 60;
      let url = `/api/ohlcv/${effectiveSymbol}?timeframe=${timeframeSec}s&limit=${FETCH_LIMIT}`;
      if (direction === 'left') {
        url += `&endTime=${timestamp}`;
      } else {
        url += `&startTime=${timestamp}`;
      }

      const response = await fetch(url);
      if (response.ok) {
        newData = await response.json();
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
        if (newData.length < FETCH_LIMIT) {
          if (direction === 'left') setForexHasMoreLeft(false);
          else setForexHasMoreRight(false);
        }
      } else {
        if (direction === 'left') setForexHasMoreLeft(false);
        else setForexHasMoreRight(false);
      }
    } finally {
      forexIsLoadingMoreRef.current = false;
      setForexIsLoadingMore(false);
    }
  }, [effectiveSymbol, timeframe, isFutures, FETCH_LIMIT]);

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
  
  // Both futures and forex use server-side aggregation — no client-side processing needed
  const chartData = rawData;

  // ── Compute chart overlays from chart data ──
  const srLevels = useMemo(() => {
    if (!showSR || chartData.length < 20) return [];
    const bars = chartData.map((d: OhlcvData) => {
      const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp, 10) : d.timestamp;
      return { time: ts > 1e12 ? Math.floor(ts / 1000) : ts, open: d.open, high: d.high, low: d.low, close: d.close };
    });
    return computeSupportResistance(bars, 5, 10);
  }, [showSR, chartData]);

  const zigZagPts = useMemo(() => {
    if (!showZigZag || chartData.length < 10) return [];
    const bars = chartData.map((d: OhlcvData) => {
      const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp, 10) : d.timestamp;
      return { time: ts > 1e12 ? Math.floor(ts / 1000) : ts, open: d.open, high: d.high, low: d.low, close: d.close };
    });
    return computeZigZag(bars, 0);
  }, [showZigZag, chartData]);

  const swingZZPts = useMemo(() => {
    if (!showSwingZZ || chartData.length < 10) return [];
    const bars = chartData.map((d: OhlcvData) => {
      const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp, 10) : d.timestamp;
      return { time: ts > 1e12 ? Math.floor(ts / 1000) : ts, open: d.open, high: d.high, low: d.low, close: d.close };
    });
    return computeSwingZigZag(bars);
  }, [showSwingZZ, chartData]);



  // Check if we're using parquet data for infinite scroll (or forex visible data)
  // Enable infinite scroll for all data types with visible data
  const useInfiniteScroll = isFutures 
    ? visibleData.length > 0 
    : forexVisibleData.length > 0;

  const selectSymbol = async (sym: string, type: "futures" | "forex") => {
    setSymbol(sym);
    setAssetType(type);
    setContract("continuous");
    // Reset infinite scroll state when changing symbols
    setVisibleData([]);
    setHasMoreLeft(true);
    setHasMoreRight(false);
    // Reset forex scroll state too
    setForexVisibleData([]);
    setForexHasMoreLeft(true);
    setForexHasMoreRight(false);
  };

  return (
    <div className="space-y-4 h-[calc(100vh-8.5rem)] flex flex-col overflow-hidden">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-linear-to-br from-violet-500/30 to-teal-500/30 flex items-center justify-center">
              <Database className="h-5 w-5 text-violet-300" />
            </div>
            <span className="text-sm font-medium text-violet-300/80">Market Data</span>
          </div>
          <h1 className="text-4xl font-display font-bold bg-linear-to-r from-white to-white/60 bg-clip-text text-transparent">Market Data</h1>
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

      {/* Main content: Vertical split — Chart area (top) + Hub panel (bottom) */}
      <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0">
        <ResizablePanel defaultSize={65} minSize={30} className="overflow-hidden">
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={70} minSize={40} className="overflow-hidden">
        {/* Chart Panel */}
        <Card className="h-full glass rounded-2xl gradient-border flex flex-col overflow-hidden">
          <CardHeader className="py-2 px-4 border-b border-white/5 shrink-0">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Sparkles className="h-3 w-3 text-primary" />
              {effectiveSymbol}
              {isFutures && isContinuous && continuousData?.data?.length > 0 && (
                <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400 ml-0.5">
                  {continuousData.data[continuousData.data.length - 1]?.activeContract || 'Continuous'}
                </Badge>
              )}
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
              {/* Chart overlay toggles */}
              <div className="flex items-center gap-0.5 ml-1">
                <Button
                  variant={showSR ? "default" : "ghost"}
                  size="sm"
                  className={`h-6 px-2 text-[10px] font-mono gap-1 ${
                    showSR
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10"
                  }`}
                  onClick={() => setShowSR(v => !v)}
                  title="Support & Resistance levels"
                >
                  <Layers className="h-3 w-3" />
                  S/R
                </Button>
                <Button
                  variant={showZigZag ? "default" : "ghost"}
                  size="sm"
                  className={`h-6 px-2 text-[10px] font-mono gap-1 ${
                    showZigZag
                      ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                      : "text-muted-foreground hover:text-yellow-400 hover:bg-yellow-500/10"
                  }`}
                  onClick={() => setShowZigZag(v => !v)}
                  title="ZigZag (ATR-filtered swings)"
                >
                  <ZapOff className="h-3 w-3" />
                  ZZ
                </Button>
                <Button
                  variant={showSwingZZ ? "default" : "ghost"}
                  size="sm"
                  className={`h-6 px-2 text-[10px] font-mono gap-1 ${
                    showSwingZZ
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "text-muted-foreground hover:text-cyan-400 hover:bg-cyan-500/10"
                  }`}
                  onClick={() => setShowSwingZZ(v => !v)}
                  title="Swing ZigZag (every high/low)"
                >
                  <TrendingUp className="h-3 w-3" />
                  SW
                </Button>
              </div>
              <span className="ml-auto text-[10px] text-muted-foreground/60 flex items-center gap-2">
                {activeSymbols.find(s => s.symbol === symbol)?.name}
                {rawData.length > 0 && ` \u2022 ${chartData.length.toLocaleString()} bars`}
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
            {chartData.length > 0 ? (
              <IndicatorChartLayout
                data={chartData}
                symbol={effectiveSymbol}
                isFutures={isFutures}
                timeframe={timeframe}
                onLoadMore={useInfiniteScroll ? (isFutures ? handleLoadMore : handleForexLoadMore) : undefined}
                isLoadingMore={isFutures ? isLoadingMore : forexIsLoadingMore}
                hasMoreLeft={isFutures ? hasMoreLeft : forexHasMoreLeft}
                hasMoreRight={isFutures ? hasMoreRight : forexHasMoreRight}
                rollovers={isFutures && isContinuous ? rollovers : []}
                labelMarkers={sidebarShowLabels ? sidebarLabelMarkers : []}
                indicatorOverlays={indicatorOverlays}
                onRemoveIndicators={handleRemoveIndicators}
                supportResistanceLevels={srLevels}
                zigZagPoints={zigZagPts}
                swingZigZagPoints={swingZZPts}
                tradeMarkers={dashboard.overlays.tradeMarkers}
                predictionMarkers={dashboard.overlays.predictionMarkers}
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
        </ResizablePanel>

        <ResizableHandle withHandle className="mx-1 opacity-50 hover:opacity-100 transition-opacity" />

        <ResizablePanel defaultSize={30} minSize={10} maxSize={50} collapsible collapsedSize={3} className="overflow-hidden">
          <MLWorkflowSidebar
            chartData={chartData}
            effectiveSymbol={effectiveSymbol}
            symbol={symbol}
            isFutures={isFutures}
            timeframe={timeframe}
            onLabelMarkersChange={handleLabelMarkersChange}
          />
        </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        <ResizableHandle withHandle className="my-0.5 opacity-50 hover:opacity-100 transition-opacity" />

        <ResizablePanel defaultSize={35} minSize={10} maxSize={60} collapsible collapsedSize={3} className="overflow-hidden">
          <BottomPanel />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
