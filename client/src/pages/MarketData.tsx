import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Database, Loader2, TrendingUp, DollarSign, ArrowRightLeft, ChevronsUpDown, Check, Clock, Layers, ZapOff, Play, Pause, Brain, PanelRightOpen, Flame, Square } from "lucide-react";
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
import { useLocalReplay } from "@/hooks/useLocalReplay";
import { useTrainingSync } from "@/hooks/useTrainingSync";
import { ReplayControls } from "@/components/ReplayControls";
import { TrainingSyncBanner } from "@/components/TrainingSyncBanner";
import { useRegimeTrainingContext } from "@/contexts/RegimeTrainingContext";
import { useTrainingContext } from "@/contexts/TrainingContext";
import { RegimeLegend, type RegimeInfo } from "@/components/RegimeLegend";
import { REGIME_COLORS } from "@/components/training/types";
import TrainingTerminal from "@/components/training/TrainingTerminal";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { QUERY_KEYS, type Trade } from "@/lib/types";

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

interface InstrumentInfo {
  symbol: string;
  name: string;
  assetType: string;
  exchange?: string;
}

export default function MarketData() {
  // ── Unified context: local state syncs bidirectionally with dashboard-wide context ──
  const dashboard = useDashboard();
  const regime = useRegimeTrainingContext();
  const training = useTrainingContext();
  const [symbol, setSymbolLocal] = useState(dashboard.symbol);
  const [assetType, setAssetTypeLocal] = useState<"futures" | "forex">(dashboard.assetType);
  const [contract, setContract] = useState<string | null>(null); // null = root symbol, or specific contract like "ESH5"
  const [timeframe, setTimeframeLocal] = useState(dashboard.timeframeMinutes);
  const { toast } = useToast();
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [mlPanelOpen, setMlPanelOpen] = useState(false);

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
    { label: contract ?? symbol },
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
  const effectiveSymbol = contract ?? symbol;

  // Clear any stale IndexedDB OHLCV cache from previous sessions on mount
  useEffect(() => {
    clearAllCache().catch(() => {});
  }, []);

  const isFutures = assetType === "futures";

  // ── Unified chart data state (sliding window for infinite scroll) ──
  const [visibleData, setVisibleData] = useState<OhlcvData[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreLeft, setHasMoreLeft] = useState(true);
  const [hasMoreRight, setHasMoreRight] = useState(false);
  const isLoadingMoreRef = useRef(false);
  const MAX_BARS_IN_MEMORY = 50000;

  // Adaptive fetch limit: scale down for higher timeframes
  const FETCH_LIMIT = useMemo(() => {
    if (timeframe <= 1) return 10000;
    if (timeframe <= 5) return 5000;
    if (timeframe <= 15) return 3000;
    if (timeframe <= 30) return 2000;
    if (timeframe <= 60) return 1500;
    if (timeframe <= 240) return 1000;
    if (timeframe <= 1440) return 500;
    return 250;
  }, [timeframe]);

  // Map minutes → API timeframe label (lowercase for QuestDB SAMPLE BY)
  const apiTimeframe = useMemo(() => {
    const map: Record<number, string> = { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', 1440: '1d', 10080: '1w' };
    return map[timeframe] || `${timeframe}`;
  }, [timeframe]);

  // Reset scroll state on symbol/timeframe/contract change
  useEffect(() => {
    setVisibleData([]);
    setHasMoreLeft(true);
    setHasMoreRight(false);
    isLoadingMoreRef.current = false;
  }, [effectiveSymbol, timeframe]);

  // ── Primary data: QuestDB via /api/charts/ohlcv (server handles front-month selection for futures roots) ──
  const { data: chartQueryData } = useQuery({
    queryKey: ["/api/charts/ohlcv", effectiveSymbol, apiTimeframe],
    queryFn: async () => {
      const url = `/api/charts/ohlcv?symbol=${effectiveSymbol}&timeframe=${apiTimeframe}&limit=${FETCH_LIMIT}&order=asc`;
      const response = await fetch(url);
      if (!response.ok) return [];
      const data: OhlcvData[] = await response.json();
      setVisibleData(data);
      setHasMoreLeft(false);
      setHasMoreRight(data.length >= FETCH_LIMIT);
      return data;
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev: any) => prev,
  });

  // ── Infinite scroll: load more bars when user scrolls to edges ──
  const handleLoadMore = useCallback(async (direction: 'left' | 'right', timestamp: number) => {
    if (isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      let url = `/api/charts/ohlcv?symbol=${effectiveSymbol}&timeframe=${apiTimeframe}&limit=${FETCH_LIMIT}&order=asc`;

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
        const combined = direction === 'left' ? [...newData, ...prev] : [...prev, ...newData];
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
  }, [effectiveSymbol, timeframe, apiTimeframe, FETCH_LIMIT]);

  // Use visibleData for infinite scroll, fallback to query data
  const rawData = visibleData.length > 0
    ? visibleData
    : (chartQueryData || []);
  
  // Both futures and forex use server-side aggregation — no client-side processing needed
  const chartData = rawData;

  // ── Market Replay — VCR controller over the loaded chart data ──
  const replay = useLocalReplay(chartData);

  // ── Training Sync — auto-activates replay when training starts ──
  const trainingSync = useTrainingSync(regime, symbol, replay);

  // When replay is active, the chart only sees bars up to the playhead
  const displayData = replay.active ? replay.snapshot.visibleBars : chartData;

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

  // ── Quick stats for inline analytics strip ──
  const { data: savedModelsData } = useQuery<{ models: { name: string }[] }>({
    queryKey: ['savedModels'],
    queryFn: async () => {
      const res = await fetch('/api/ml/saved-models');
      if (!res.ok) return { models: [] };
      return res.json();
    },
  });
  const modelCount = savedModelsData?.models?.length || 0;

  const { data: quickTrades = [] } = useQuery<Trade[]>({
    queryKey: ["/api/ml/trades"],
    queryFn: async () => { const res = await fetch("/api/ml/trades?limit=50"); const data = await res.json(); return Array.isArray(data) ? data : []; },
  });

  const tradeMetrics = useMemo(() => {
    const closed = quickTrades.filter((t: Trade) => t.status === 'closed');
    const winners = closed.filter((t: Trade) => (t.pnl || 0) > 0);
    const losers = closed.filter((t: Trade) => (t.pnl || 0) < 0);
    const totalPnl = closed.reduce((sum: number, t: Trade) => sum + (t.pnl || 0), 0);
    const grossWin = winners.reduce((sum: number, t: Trade) => sum + (t.pnl || 0), 0);
    const grossLoss = Math.abs(losers.reduce((sum: number, t: Trade) => sum + (t.pnl || 0), 0));
    const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
    return { totalTrades: closed.length, winRate, totalPnl, profitFactor };
  }, [quickTrades]);

  // ── Regime color map — live training OR saved model ──

  // Auto-match: find saved model for current symbol+timeframe
  const matchedModelId = useMemo(() => {
    if (regime.isTraining) return null; // live training uses SSE data
    const target = `${symbol.toUpperCase()}_${tfLabel}`;
    const match = regime.models.find(m => m.id === target);
    return match ? match.id : null;
  }, [symbol, tfLabel, regime.models, regime.isTraining]);

  // Fetch saved regime assignments when a matching model exists
  interface RegimeRow { ts: string; regime: number; regime_label: string; split: string }
  const { data: savedAssignments } = useQuery<{ rows: RegimeRow[] }>({
    queryKey: [...QUERY_KEYS.regimeAssignments(matchedModelId || ''), 'chart'],
    queryFn: async () => {
      const res = await fetch(`/api/regime/assignments/${matchedModelId}?limit=100000`);
      if (!res.ok) throw new Error('Failed to load regime assignments');
      return res.json();
    },
    enabled: !!matchedModelId && !regime.isTraining,
    staleTime: 120_000,
  });

  // Regime legend filter state
  const [selectedRegimes, setSelectedRegimes] = useState<Set<number> | null>(null);

  // Reset filter when model or symbol changes
  useEffect(() => {
    setSelectedRegimes(null);
  }, [matchedModelId, symbol, tfLabel]);

  const toggleRegime = useCallback((regimeId: number) => {
    setSelectedRegimes((prev) => {
      if (prev === null) return new Set([regimeId]);
      const next = new Set(prev);
      if (next.has(regimeId)) {
        next.delete(regimeId);
        if (next.size === 0) return null;
      } else {
        next.add(regimeId);
      }
      return next;
    });
  }, []);

  // Build regimeColorMap from live training OR saved model
  // Priority: universal training > HDP-HMM-specific training > saved model
  const regimeColorMap = useMemo(() => {
    // 1. Universal training pipeline live overlay
    const uts = training.liveRegimeTimestamps;
    const uassign = training.liveRegimeAssignments;
    if (uts.length && uassign.length && uts.length === uassign.length) {
      const map = new Map<number, number>();
      for (let i = 0; i < uts.length; i++) {
        if (selectedRegimes === null || selectedRegimes.has(uassign[i])) {
          map.set(uts[i], uassign[i]);
        }
      }
      if (map.size > 0) return map;
    }

    // 2. Legacy HDP-HMM training (RegimeTrainingContext)
    const ts = regime.liveRegimeTimestamps;
    const assignments = regime.liveRegimeAssignments;
    if (ts.length && assignments.length && ts.length === assignments.length) {
      const map = new Map<number, number>();
      for (let i = 0; i < ts.length; i++) {
        if (selectedRegimes === null || selectedRegimes.has(assignments[i])) {
          map.set(ts[i], assignments[i]);
        }
      }
      if (map.size > 0) return map;
    }

    // 3. Saved model fallback
    const rows = savedAssignments?.rows;
    if (!rows || rows.length === 0) return undefined;
    const map = new Map<number, number>();
    for (const row of rows) {
      if (selectedRegimes === null || selectedRegimes.has(row.regime)) {
        map.set(Math.floor(new Date(row.ts).getTime() / 1000), row.regime);
      }
    }
    return map.size > 0 ? map : undefined;
  }, [training.liveRegimeTimestamps, training.liveRegimeAssignments,
      regime.liveRegimeTimestamps, regime.liveRegimeAssignments,
      savedAssignments, selectedRegimes]);

  // Derive regime legend info (for legend component)
  const regimeLegendInfo = useMemo((): RegimeInfo[] => {
    // During live training, use trainingSync legend
    if (trainingSync.isActive && trainingSync.regimeLegend.length > 0) {
      const total = trainingSync.regimeLegend.reduce((s, r) => s + r.barCount, 0);
      return trainingSync.regimeLegend.map(r => ({
        id: r.id,
        label: `Regime ${r.id}`,
        count: r.barCount,
        pct: total > 0 ? (r.barCount / total) * 100 : 0,
      }));
    }

    // From saved assignments
    const rows = savedAssignments?.rows;
    if (!rows || rows.length === 0) return [];
    const counts = new Map<number, { label: string; count: number }>();
    for (const row of rows) {
      const existing = counts.get(row.regime);
      if (existing) {
        existing.count++;
      } else {
        counts.set(row.regime, {
          label: row.regime_label?.replace(/_/g, ' ') || `Regime ${row.regime}`,
          count: 1,
        });
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([id, info]) => ({
        id,
        label: info.label,
        count: info.count,
        pct: (info.count / rows.length) * 100,
      }));
  }, [trainingSync.isActive, trainingSync.regimeLegend, savedAssignments]);

  // Train/test split timestamp (epoch seconds of first test bar)
  const trainTestSplitTime = useMemo(() => {
    const rows = savedAssignments?.rows;
    if (!rows || rows.length === 0) return undefined;
    const testRow = rows.find(r => r.split === 'test');
    if (!testRow) return undefined;
    return Math.floor(new Date(testRow.ts).getTime() / 1000);
  }, [savedAssignments]);

  const { data: trainingStatus } = useQuery({
    queryKey: ['trainingStatus'],
    queryFn: async () => {
      const res = await fetch('/api/ml/train/status');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 5000,
  });
  const isTrainingActive = trainingStatus?.active === true;


  // Enable infinite scroll when we have visible data loaded
  const useInfiniteScroll = visibleData.length > 0;

  const selectSymbol = async (sym: string, type: "futures" | "forex") => {
    setSymbol(sym);
    setAssetType(type);
    setContract(null);
    setVisibleData([]);
    setHasMoreLeft(true);
    setHasMoreRight(false);
  };

  return (
    <div className="h-[calc(100vh-4.5rem)] flex flex-col overflow-hidden -m-4">
      {/* ── Toolbar: Asset / Symbol / Contract / Timeframe / Overlays ── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 shrink-0 bg-card/30 backdrop-blur-sm flex-wrap">
        <Tabs value={assetType} onValueChange={(v) => {
          const newType = v as "futures" | "forex";
          setAssetType(newType);
          setSymbol(newType === "futures" ? "ES" : "EURUSD");
        }}>
          <TabsList className="glass rounded-lg p-0.5 h-auto">
            <TabsTrigger value="futures" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-primary/20" data-testid="tab-futures">
              <TrendingUp className="h-3 w-3 mr-1" /> Futures
            </TabsTrigger>
            <TabsTrigger value="forex" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-accent/20" data-testid="tab-forex">
              <DollarSign className="h-3 w-3 mr-1" /> Forex
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Popover open={symbolOpen} onOpenChange={setSymbolOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={symbolOpen}
              className="w-[220px] justify-between h-7 text-xs font-mono border-white/10 bg-black/30"
              data-testid="symbol-selector"
            >
              <span className="flex items-center gap-2">
                <span className="text-primary font-semibold">{symbol}</span>
                {activeSymbols.find(s => s.symbol === symbol)?.name && (
                  <span className="text-muted-foreground text-[10px] font-sans truncate">
                    {activeSymbols.find(s => s.symbol === symbol)?.name}
                  </span>
                )}
              </span>
              <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
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

        {isFutures && contractsForSymbol.length > 0 && (
          <Popover open={contractOpen} onOpenChange={setContractOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={contractOpen}
                className="w-[160px] justify-between h-7 text-xs font-mono border-white/10 bg-black/30"
                data-testid="contract-selector"
              >
                <span className="flex items-center gap-1.5">
                  <ArrowRightLeft className="h-3 w-3 text-amber-400" />
                  {contract ?? "Front Month"}
                </span>
                <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[280px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search contract..." />
                <CommandList>
                  <CommandEmpty>No contract found.</CommandEmpty>
                  <CommandGroup heading="View Mode">
                    <CommandItem
                      value="front month auto"
                      onSelect={() => {
                        setContract(null);
                        setContractOpen(false);
                        setVisibleData([]);
                        setHasMoreLeft(true);
                        setHasMoreRight(false);
                      }}
                      className="flex items-center gap-2"
                    >
                      <Check className={`h-3 w-3 ${contract === null ? 'opacity-100' : 'opacity-0'}`} />
                      <span className="font-semibold text-xs">Front Month</span>
                      <span className="text-muted-foreground text-[10px]">Auto-selected</span>
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

        <div className="w-px h-5 bg-white/10" />

        {/* Timeframe chips */}
        <div className="flex items-center gap-0.5">
          {timeframes.map((tf) => (
            <Button
              key={tf.label}
              variant={timeframe === tf.minutes ? "default" : "ghost"}
              size="sm"
              className={`h-6 px-2 text-[10px] font-mono ${
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

        <div className="w-px h-5 bg-white/10" />

        {/* Indicators + Overlays */}
        <IndicatorSelector
          catalog={catalog}
          selectedColumns={selectedColumns}
          onSelectionChange={setSelectedColumns}
          isLoading={indicatorsLoading}
        />

        <div className="flex items-center gap-0.5">
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
            <Layers className="h-3 w-3" /> S/R
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
            <ZapOff className="h-3 w-3" /> ZZ
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
            <TrendingUp className="h-3 w-3" /> SW
          </Button>
          <Button
            variant={replay.active ? "default" : "ghost"}
            size="sm"
            className={`h-6 px-2 text-[10px] font-mono gap-1 ${
              replay.active
                ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                : "text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10"
            }`}
            onClick={replay.toggleReplay}
            title={replay.active ? "Exit replay mode" : "Enter replay mode"}
          >
            {replay.active ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            Replay
          </Button>
        </div>

        <div className="flex-1" />

        {/* HDP-HMM Train / Stop button */}
        {!regime.isTraining ? (
          <Button
            size="sm"
            className="h-7 px-3 text-[10px] font-mono gap-1.5 bg-linear-to-r from-orange-500 to-rose-500 text-white hover:opacity-90"
            onClick={regime.startTraining}
          >
            <Flame className="h-3.5 w-3.5" /> Train
          </Button>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            className="h-7 px-3 text-[10px] font-mono gap-1.5"
            onClick={regime.stopTraining}
          >
            <Square className="h-3.5 w-3.5" /> Stop
            {regime.progress && (
              <span className="ml-1 font-mono">{regime.progress.pct.toFixed(0)}%</span>
            )}
          </Button>
        )}

        {/* ML Tools drawer trigger */}
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-3 text-[10px] font-mono border-white/10 bg-black/30 hover:bg-primary/10 hover:text-primary gap-1.5"
          onClick={() => setMlPanelOpen(true)}
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
          ML Tools
          {isTrainingActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
        </Button>
      </div>

      {/* ── Analytics Strip: always-visible key metrics ── */}
      <div className="flex items-center gap-3 px-3 py-1 border-b border-white/5 shrink-0 text-[10px] bg-card/20">
        <span className="font-mono font-semibold text-primary text-xs">{effectiveSymbol}</span>
        {contract !== null && (
          <Badge variant="outline" className="text-[8px] border-amber-500/30 text-amber-400 py-0">
            Single Contract
          </Badge>
        )}

        <span className="text-muted-foreground font-mono">
          {displayData.length.toLocaleString()}{replay.active ? ` / ${chartData.length.toLocaleString()}` : ''} bars
        </span>

        <div className="flex-1" />

        {tradeMetrics.totalTrades > 0 && (
          <>
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5">
              <span className="text-muted-foreground">Trades</span>
              <span className="font-mono text-foreground">{tradeMetrics.totalTrades}</span>
            </div>
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5">
              <span className="text-muted-foreground">WR</span>
              <span className="font-mono text-emerald-400">{tradeMetrics.winRate.toFixed(1)}%</span>
            </div>
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5">
              <span className="text-muted-foreground">P&L</span>
              <span className={`font-mono ${tradeMetrics.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {tradeMetrics.totalPnl >= 0 ? '+' : ''}${tradeMetrics.totalPnl.toFixed(0)}
              </span>
            </div>
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5">
              <span className="text-muted-foreground">PF</span>
              <span className="font-mono text-cyan-400">
                {tradeMetrics.profitFactor === Infinity ? '∞' : tradeMetrics.profitFactor.toFixed(2)}
              </span>
            </div>
          </>
        )}

        <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5">
          <Brain className="h-3 w-3 text-primary" />
          <span className="font-mono text-foreground">{modelCount}</span>
          <span className="text-muted-foreground">models</span>
        </div>

        {matchedModelId && !regime.isTraining && (
          <Badge variant="outline" className="text-[8px] border-orange-500/30 text-orange-400 bg-orange-500/10 py-0 gap-1">
            <Layers className="h-2.5 w-2.5" />
            {matchedModelId} · {regimeLegendInfo.length}R
            {regime.models.find(m => m.id === matchedModelId)?.quality_score != null && (
              <span className="text-muted-foreground">Q:{regime.models.find(m => m.id === matchedModelId)!.quality_score!.toFixed(0)}</span>
            )}
          </Badge>
        )}

        {isTrainingActive && (
          <Badge variant="outline" className="text-[8px] border-green-500/30 text-green-400 bg-green-500/10 py-0 gap-1">
            <Brain className="h-2.5 w-2.5 animate-pulse" /> Training
          </Badge>
        )}

        {replay.active && (
          <Badge variant="outline" className="text-[8px] border-violet-500/30 text-violet-400 bg-violet-500/10 py-0 gap-1">
            <Play className="h-2.5 w-2.5" /> Replay
          </Badge>
        )}

        {isLoadingMore && (
          <Loader2 className="h-3 w-3 animate-spin text-violet-400" />
        )}
      </div>

      {/* ── Chart + Terminal: resizable vertical split ── */}
      <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0">
        {/* ── Chart panel ── */}
        <ResizablePanel defaultSize={75} minSize={30}>
          <div className="h-full flex flex-col">
            {/* Replay controls — shown during manual replay OR training-driven replay */}
            {replay.active && (
              <div className="px-3 py-1.5 border-b border-white/5 shrink-0 flex items-center gap-3">
                {trainingSync.isActive ? (
                  <TrainingSyncBanner
                    gibbsIter={trainingSync.gibbsIter}
                    gibbsTotal={trainingSync.gibbsTotal}
                    activeRegimes={trainingSync.activeRegimes}
                    regimeLegend={trainingSync.regimeLegend}
                    trainingPhase={trainingSync.trainingPhase}
                  />
                ) : null}
                <ReplayControls
                  state={replay.state}
                  speed={replay.speed}
                  snapshot={replay.snapshot}
                  onPlay={replay.play}
                  onPause={replay.pause}
                  onStepForward={replay.stepForward}
                  onStepBackward={replay.stepBackward}
                  onSeekTo={replay.seekTo}
                  onChangeSpeed={replay.changeSpeed}
                  onReset={replay.reset}
                />
              </div>
            )}

            {/* Regime legend — shown when regime colors are active */}
            {regimeLegendInfo.length > 0 && (
              <div className="px-3 py-1 border-b border-white/5 shrink-0">
                <RegimeLegend
                  regimes={regimeLegendInfo}
                  selectedRegimes={selectedRegimes}
                  onToggleRegime={toggleRegime}
                  onShowAll={() => setSelectedRegimes(null)}
                />
              </div>
            )}

            {displayData.length > 0 ? (
              <div className="flex-1 min-h-0 p-1">
                <IndicatorChartLayout
                  data={displayData}
                  symbol={effectiveSymbol}
                  isFutures={isFutures}
                  timeframe={timeframe}
                  isReplayActive={replay.active}
                  onLoadMore={!replay.active && useInfiniteScroll ? handleLoadMore : undefined}
                  isLoadingMore={isLoadingMore}
                  hasMoreLeft={!replay.active && hasMoreLeft}
                  hasMoreRight={!replay.active && hasMoreRight}
                  labelMarkers={sidebarShowLabels ? sidebarLabelMarkers : []}
                  indicatorOverlays={indicatorOverlays}
                  onRemoveIndicators={handleRemoveIndicators}
                  supportResistanceLevels={srLevels}
                  zigZagPoints={zigZagPts}
                  swingZigZagPoints={swingZZPts}
                  tradeMarkers={dashboard.overlays.tradeMarkers}
                  predictionMarkers={dashboard.overlays.predictionMarkers}
                  regimeColorMap={regimeColorMap}
                  trainTestSplitTime={trainTestSplitTime}
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <Database className="h-12 w-12 mb-3 opacity-20" />
                <p className="font-mono text-sm">No data for {effectiveSymbol}</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Upload {isFutures ? 'futures' : 'forex'} data to see the chart</p>
              </div>
            )}
          </div>
        </ResizablePanel>

        {/* ── Drag handle ── */}
        <ResizableHandle withHandle />

        {/* ── Terminal panel ── */}
        <ResizablePanel defaultSize={25} minSize={5} maxSize={60}>
          <div className="h-full px-1 pb-1">
            <TrainingTerminal
              trainLogs={regime.trainLogs}
              isTraining={regime.isTraining}
              liveMetrics={regime.liveMetrics}
              liveConvergence={regime.liveConvergence}
              selectedSymbol={regime.selectedSymbol}
              selectedTimeframe={regime.selectedTimeframe}
              showTerminal={regime.showTerminal}
              setShowTerminal={regime.setShowTerminal}
              logEndRef={regime.logEndRef}
              burnIn={regime.burnIn}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* ── ML Tools Sheet (slides from right) ── */}
      <Sheet open={mlPanelOpen} onOpenChange={setMlPanelOpen}>
        <SheetContent side="right" className="w-[380px] sm:w-[420px] sm:max-w-[420px] p-0 border-l border-white/10 bg-background/95 backdrop-blur-xl flex flex-col">
          <SheetTitle className="sr-only">ML Tools — {symbol}</SheetTitle>
          <MLWorkflowSidebar
            chartData={chartData}
            effectiveSymbol={effectiveSymbol}
            symbol={symbol}
            isFutures={isFutures}
            timeframe={timeframe}
            onLabelMarkersChange={handleLabelMarkersChange}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
