/**
 * MLWorkflowSidebar — Tabbed workflow panel that lives beside the price chart.
 * 
 * Think of it as the "control room console" right next to the security monitors:
 * Labels → Train → Backtest → Explain, all while watching the chart.
 * 
 * Tabs:
 *   1. Labels  — preview label markers on the chart
 *   2. Train   — configure & start training (SSE progress)
 *   3. Backtest — run backtest, see results on chart
 *   4. XAI     — explain model decisions (feature importance)
 */
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  Tag, Eye, BarChart3, ChevronDown, ChevronRight,
  Play, Square, Brain, Loader2, TrendingUp, AlertTriangle,
  FlaskConical, Crosshair, Sparkles, Activity, Settings, RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { LABEL_GENERATORS, type LabelGeneratorKey } from "@shared/mlTaxonomy";
import { type LabelMarker } from "@/components/TradingChart";
import { QUERY_KEYS } from "@/lib/types";


// ─── Types ───────────────────────────────────────────────────────────────────

interface TrainingProgress {
  epoch: number;
  totalEpochs: number;
  loss: number;
  valLoss: number;
  accuracy: number;
  valAccuracy?: number;
  learningRate?: number;
  elapsedMs?: number;
  batchSize?: number;
  status: string;
  message?: string;
  trainSize?: number;
  valSize?: number;
  stepsPerEpoch?: number;
  samplesSeen?: number;
  symbol?: string;
}

interface MlModel {
  id: number;
  name: string;
  architecture: string;
  symbol: string;
  status: string;
  metrics?: string;
  hyperparameters?: string;
}

interface BacktestRunResult {
  run: { id: number; [k: string]: any };
  metrics: {
    totalTrades: number;
    winRate: number;
    totalPnl: number;
    maxDrawdown: number;
    sharpeRatio: number;
    profitFactor: number;
  };
}

interface XAIResult {
  method: string;
  features: { name: string; importance: number }[];
}

interface MLWorkflowSidebarProps {
  /** Chart data for label generation (filters to visible range) */
  chartData: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[];
  /** Effective symbol for API calls (includes contract info) */
  effectiveSymbol: string;
  /** Base symbol (root, e.g. "ES") */
  symbol: string;
  /** Whether this is a futures instrument */
  isFutures: boolean;
  /** Current timeframe in minutes */
  timeframe: number;
  /** Callback to set label markers on the chart */
  onLabelMarkersChange: (markers: LabelMarker[], show: boolean) => void;
  /** Active tab from parent (optional external control) */
  activeTab?: string;
  /** Callback when tab changes */
  onTabChange?: (tab: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MLWorkflowSidebar({
  chartData,
  effectiveSymbol,
  symbol,
  isFutures,
  timeframe,
  onLabelMarkersChange,
  activeTab: externalTab,
  onTabChange,
}: MLWorkflowSidebarProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dashboard = useDashboard();
  const [internalTab, setInternalTab] = useState("labels");
  const activeTab = externalTab ?? internalTab;
  const setActiveTab = (t: string) => {
    setInternalTab(t);
    onTabChange?.(t);
  };

  // ┌──────────────────────────────────────────────────────┐
  // │  LABELS TAB STATE                                    │
  // └──────────────────────────────────────────────────────┘
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
      if (data.success && data.preview && data.preview.length > 0) {
        const markers: LabelMarker[] = data.preview
          .filter((row: Record<string, unknown>) => row.label !== null && row.label !== undefined)
          .map((row: Record<string, unknown>) => ({
            timestamp: row.timestamp as number,
            label: row.label as number | null,
            close: row.close as number,
          }));
        setLabelPreview(markers);
        setShowLabels(true);
        onLabelMarkersChange(markers, true);
      } else if (data.error && data.preview?.length === 0) {
        toast({ title: "Not Supported for Preview", description: data.error });
        setLabelPreview([]);
        setShowLabels(false);
        onLabelMarkersChange([], false);
      }
    },
    onError: () => {
      toast({ title: "Preview Failed", description: "Could not generate label preview", variant: "destructive" });
    },
  });

  // Stable ref for the generate function
  const generateLabelsRef = useRef<() => void>(() => {});
  useEffect(() => {
    generateLabelsRef.current = () => {
      if (chartData.length === 0) return;
      const startTs = chartData[0].timestamp;
      const endTs = chartData[chartData.length - 1].timestamp;
      previewMutation.mutate({
        generatorType: selectedGenerator,
        symbol: effectiveSymbol,
        params: currentParams,
        limit: 50000,
        startTimestamp: startTs,
        endTimestamp: endTs,
        timeframeMinutes: timeframe,
      });
    };
  }, [selectedGenerator, effectiveSymbol, currentParams, chartData, timeframe]);

  // Filter labels to visible chart range
  const visibleLabels = useMemo(() => {
    if (!showLabels || labelPreview.length === 0 || chartData.length === 0) return [];
    const start = chartData[0].timestamp;
    const end = chartData[chartData.length - 1].timestamp;
    return labelPreview.filter(l => l.timestamp >= start && l.timestamp <= end);
  }, [showLabels, labelPreview, chartData]);

  const labelDistribution = useMemo(() => {
    const total = visibleLabels.length;
    const buy = visibleLabels.filter(l => l.label === 1).length;
    const sell = visibleLabels.filter(l => l.label === -1 || l.label === 2).length;
    const hold = visibleLabels.filter(l => l.label === 0).length;
    return {
      total, buy, sell, hold,
      buyPct: total > 0 ? Math.round((buy / total) * 100) : 0,
      sellPct: total > 0 ? Math.round((sell / total) * 100) : 0,
      holdPct: total > 0 ? Math.round((hold / total) * 100) : 0,
    };
  }, [visibleLabels]);

  // ┌──────────────────────────────────────────────────────┐
  // │  TRAIN TAB STATE                                     │
  // └──────────────────────────────────────────────────────┘
  const [epochs, setEpochs] = useState(50);
  const [batchSize, setBatchSize] = useState(32);
  const [pipeline, setPipeline] = useState<'universal' | 'legacy'>('universal');
  const [labelType, setLabelType] = useState<'direction' | 'triple_barrier'>('direction');
  const [maxBars, setMaxBars] = useState(100000);
  const [timeframeSec, setTimeframeSec] = useState(300);
  const [labelHorizon, setLabelHorizon] = useState(10);
  const [labelAtrMultiplier, setLabelAtrMultiplier] = useState(0.5);
  const [labelNumClasses, setLabelNumClasses] = useState<2 | 3>(3);
  const [takeProfitATR, setTakeProfitATR] = useState(2.0);
  const [stopLossATR, setStopLossATR] = useState(1.0);
  const [maxHoldingPeriod, setMaxHoldingPeriod] = useState(20);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [lossHistory, setLossHistory] = useState<{ epoch: number; loss: number; valLoss: number; accuracy?: number }[]>([]);
  const [currentProgress, setCurrentProgress] = useState<TrainingProgress | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [activeSessionSymbol, setActiveSessionSymbol] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const dashboardRef = useRef(dashboard);
  dashboardRef.current = dashboard;

  // Fetch instruments for futures symbols
  const { data: instruments = [] } = useQuery({
    queryKey: ['instruments'],
    queryFn: async () => { const res = await fetch('/api/instruments'); return res.json(); },
  });
  const futuresSymbols = instruments.filter((i: any) => i.assetType === 'futures').map((i: any) => i.symbol);

  // ML models
  const { data: mlModels = [] } = useQuery<MlModel[]>({
    queryKey: [...QUERY_KEYS.mlModels],
    queryFn: async () => { const res = await fetch('/api/ml/models'); return res.json(); },
  });
  const activeModelName = mlModels.find(m => m.name.includes(symbol) && m.status === 'active')?.name || `CNN-${symbol}`;

  // Training status check
  const { data: trainingStatus } = useQuery({
    queryKey: ['trainingStatus'],
    queryFn: async () => {
      const res = await fetch('/api/ml/train/status');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: isConnected ? 5000 : false,
    refetchOnWindowFocus: true,
  });

  // Sync active session from status
  useEffect(() => {
    if (trainingStatus?.active && trainingStatus.symbol) {
      setActiveSessionSymbol(trainingStatus.symbol);
      if (trainingStatus.progress) setCurrentProgress(trainingStatus.progress);
    } else {
      setActiveSessionSymbol(null);
    }
  }, [trainingStatus]);

  // SSE connection for live training progress
  const connectToStream = useCallback(() => {
    if (eventSourceRef.current && eventSourceRef.current.readyState !== EventSource.CLOSED) {
      return eventSourceRef.current;
    }
    const eventSource = new EventSource('/api/ml/train/stream');
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => setIsConnected(true);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const progress: TrainingProgress = data;
        setCurrentProgress(progress);

        if (progress.epoch > 0 && progress.status === 'training') {
          dashboardRef.current.setTrainingContext({
            dataStart: data.dataStart || '',
            dataEnd: data.dataEnd || '',
            epoch: progress.epoch,
            totalEpochs: progress.totalEpochs,
            loss: progress.loss,
            valLoss: progress.valLoss,
            accuracy: progress.accuracy,
            valAccuracy: progress.valAccuracy ?? 0,
            status: progress.status,
            message: progress.message,
            trainSize: progress.trainSize,
            valSize: progress.valSize,
            symbol: data.symbol || symbol,
            modelName: activeModelName,
          });

          setLossHistory(prev => {
            if (prev.some(p => p.epoch === progress.epoch)) return prev;
            return [...prev, { epoch: progress.epoch, loss: progress.loss, valLoss: progress.valLoss, accuracy: progress.accuracy }];
          });
        }

        if (progress.status === 'completed' || progress.status === 'stopped' || progress.status === 'error') {
          setActiveSessionSymbol(null);
          dashboardRef.current.setTrainingContext(null);
          queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.mlModels] });
          queryClient.invalidateQueries({ queryKey: ['trainingStatus'] });
        }
      } catch (e) {
        console.error('Error parsing SSE data:', e);
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      if (eventSource.readyState === EventSource.CLOSED) {
        eventSourceRef.current = null;
        setTimeout(() => connectToStream(), 3000);
      }
    };

    return eventSource;
  }, [queryClient, symbol, activeModelName]);

  // Connect on mount, cleanup on unmount
  useEffect(() => {
    connectToStream();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connectToStream]);

  // Start training mutation
  const startTrainingMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = { symbol, epochs, batchSize, pipeline };
      if (pipeline === 'universal') {
        body.timeframeSec = timeframeSec;
        body.maxBars = maxBars;
        body.labelType = labelType;
        if (labelType === 'direction') {
          body.labelHorizon = labelHorizon;
          body.labelAtrMultiplier = labelAtrMultiplier;
          body.labelNumClasses = labelNumClasses;
        } else {
          body.takeProfitATR = takeProfitATR;
          body.stopLossATR = stopLossATR;
          body.maxHoldingPeriod = maxHoldingPeriod;
        }
      }
      const res = await fetch('/api/ml/train/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to start training');
      }
      return res.json();
    },
    onSuccess: () => {
      setLossHistory([]);
      setActiveSessionSymbol(symbol);
      dashboard.addLog({ level: 'info', source: 'training', message: `Training started for ${symbol}` });
    },
    onError: (error: Error) => {
      toast({ title: "Training Failed", description: error.message, variant: "destructive" });
    },
  });

  // Stop training mutation
  const stopTrainingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ml/train/stop', { method: 'POST' });
      return res.json();
    },
  });

  const isTraining = currentProgress?.status === 'training' || !!activeSessionSymbol;
  const currentEpoch = currentProgress?.epoch || 0;
  const totalEpochs = currentProgress?.totalEpochs || epochs;
  const progressPct = totalEpochs > 0 ? (currentEpoch / totalEpochs) * 100 : 0;

  // ┌──────────────────────────────────────────────────────┐
  // │  BACKTEST TAB STATE                                  │
  // └──────────────────────────────────────────────────────┘
  const [btModel, setBtModel] = useState<string>("");
  const [btCapital, setBtCapital] = useState(10000);
  const [btPositionSize, setBtPositionSize] = useState(1);
  const [btMinConfidence, setBtMinConfidence] = useState(0.5);
  const [btResult, setBtResult] = useState<BacktestRunResult | null>(null);
  const [btSelectedRunId, setBtSelectedRunId] = useState<number | null>(null);

  const { data: previousRuns = [] } = useQuery<any[]>({
    queryKey: ["/api/backtest/runs"],
    queryFn: async () => { const res = await fetch("/api/backtest/runs?limit=10"); return res.json(); },
  });

  // Trades for the selected run
  const { data: btTradesData } = useQuery<{ trades: any[]; chartMarkers: any[]; count: number }>({
    queryKey: ["/api/backtest/trades", btSelectedRunId],
    queryFn: async () => {
      const res = await fetch(`/api/backtest/trades/${btSelectedRunId}`);
      return res.json();
    },
    enabled: !!btSelectedRunId,
  });

  // Push backtest trades to chart overlay
  useEffect(() => {
    if (btTradesData?.chartMarkers && btTradesData.chartMarkers.length > 0) {
      const markers = btTradesData.chartMarkers.map((m: any, i: number) => ({
        id: `bt-sidebar-${i}`,
        timestamp: m.timestamp || m.time,
        type: m.type || (m.side === 'buy' ? 'entry' : 'exit') as 'entry' | 'exit',
        side: (m.side === 'buy' ? 'long' : 'short') as 'long' | 'short',
        price: m.price,
        pnl: m.pnl,
        source: 'backtest' as const,
      }));
      dashboard.clearTradeMarkers('backtest');
      dashboard.addTradeMarkers(markers);
    }
  }, [btTradesData]);

  const runBacktestMutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        symbol,
        timeframe: `${timeframe}m`,
        initialCapital: btCapital,
        positionSize: btPositionSize,
        minConfidence: btMinConfidence,
      };
      if (btModel === '__last_trained__') {
        body.useLastTrained = true;
      } else if (btModel && btModel !== 'momentum') {
        body.modelId = parseInt(btModel);
      }
      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Backtest failed');
      }
      return res.json();
    },
    onSuccess: (data: BacktestRunResult) => {
      setBtResult(data);
      setBtSelectedRunId(data.run.id);
      queryClient.invalidateQueries({ queryKey: ["/api/backtest/runs"] });
      dashboard.addLog({ level: 'success', source: 'backtest', message: `Backtest: ${data.metrics.totalTrades} trades, ${data.metrics.winRate.toFixed(1)}% WR` });
    },
    onError: (err: Error) => {
      toast({ title: "Backtest Failed", description: err.message, variant: "destructive" });
    },
  });

  // ┌──────────────────────────────────────────────────────┐
  // │  XAI TAB STATE                                       │
  // └──────────────────────────────────────────────────────┘
  const [xaiMethod, setXaiMethod] = useState("permutation");
  const { data: xaiResult } = useQuery<XAIResult>({
    queryKey: ['xai', activeModelName, xaiMethod],
    queryFn: async () => {
      const res = await fetch(`/api/ml/xai/${encodeURIComponent(activeModelName)}?method=${xaiMethod}`);
      if (!res.ok) return { method: xaiMethod, features: [] };
      return res.json();
    },
    enabled: activeTab === 'xai' && !!activeModelName,
  });

  // ┌──────────────────────────────────────────────────────┐
  // │  RENDER                                              │
  // └──────────────────────────────────────────────────────┘
  return (
    <Card className="glass rounded-2xl gradient-border flex flex-col overflow-hidden h-full">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
        {/* Tab strip */}
        <div className="border-b border-white/5 px-2 pt-1.5 shrink-0">
          <TabsList className="w-full h-7 bg-transparent gap-0 p-0">
            <TabsTrigger value="labels" className="flex-1 h-6 text-[10px] data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-400 rounded-md px-1.5 gap-1">
              <Tag className="h-3 w-3" /> Labels
            </TabsTrigger>
            <TabsTrigger value="train" className="flex-1 h-6 text-[10px] data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400 rounded-md px-1.5 gap-1">
              <Brain className={`h-3 w-3 ${isTraining ? 'pulse-slow' : ''}`} /> Train
              {isTraining && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
            </TabsTrigger>
            <TabsTrigger value="backtest" className="flex-1 h-6 text-[10px] data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-400 rounded-md px-1.5 gap-1">
              <FlaskConical className="h-3 w-3" /> Test
            </TabsTrigger>
            <TabsTrigger value="xai" className="flex-1 h-6 text-[10px] data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 rounded-md px-1.5 gap-1">
              <Crosshair className="h-3 w-3" /> XAI
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ═══════════════════════════════════════════════ */}
        {/* LABELS TAB                                      */}
        {/* ═══════════════════════════════════════════════ */}
        <TabsContent value="labels" className="flex-1 overflow-auto m-0 p-0">
          <div className="p-3 space-y-3">
            {/* Generator selector */}
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Generator</label>
              <Select
                value={selectedGenerator}
                onValueChange={(v) => {
                  setSelectedGenerator(v as LabelGeneratorKey);
                  setLabelParams({});
                }}
              >
                <SelectTrigger className="h-7 text-[10px] bg-black/30 border-white/10">
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

            {/* Params */}
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
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Preview / Clear */}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => generateLabelsRef.current()}
                disabled={previewMutation.isPending || chartData.length === 0}
                className="flex-1 h-7 text-[10px] bg-linear-to-r from-violet-600 to-teal-500"
              >
                {previewMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
                Preview
              </Button>
              {showLabels && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowLabels(false);
                    setLabelPreview([]);
                    onLabelMarkersChange([], false);
                  }}
                  className="h-7 text-[10px] border-white/10"
                >
                  Clear
                </Button>
              )}
            </div>

            {/* Label distribution */}
            {showLabels && visibleLabels.length > 0 && (
              <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/20 space-y-2">
                <p className="text-[10px] text-green-400 font-medium flex items-center gap-1">
                  <BarChart3 className="h-3 w-3" />
                  Distribution ({labelDistribution.total} visible)
                </p>
                <div className="space-y-1">
                  {[
                    { label: 'BUY', count: labelDistribution.buy, pct: labelDistribution.buyPct, color: 'green' },
                    { label: 'SELL', count: labelDistribution.sell, pct: labelDistribution.sellPct, color: 'rose' },
                    { label: 'HOLD', count: labelDistribution.hold, pct: labelDistribution.holdPct, color: 'violet' },
                  ].map(({ label, count, pct, color }) => (
                    <div key={label} className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className={`h-full bg-${color}-500 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`text-${color}-400 text-[9px] font-mono w-16 text-right`}>
                        {label} {count} ({pct}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Symbol info footer */}
            <div className="p-2 rounded-lg bg-white/5 mt-auto">
              <p className="font-mono text-sm text-primary">{effectiveSymbol}</p>
              <p className="text-[9px] text-muted-foreground">
                {chartData.length > 0 ? `${chartData.length.toLocaleString()} bars loaded` : 'No data'}
              </p>
            </div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════ */}
        {/* TRAIN TAB                                       */}
        {/* ═══════════════════════════════════════════════ */}
        <TabsContent value="train" className="flex-1 overflow-auto m-0 p-0">
          <div className="p-3 space-y-3">
            {/* Status badge */}
            <div className="flex items-center gap-2">
              <Brain className={`h-4 w-4 ${isTraining ? 'text-emerald-400 pulse-slow' : 'text-muted-foreground'}`} />
              <span className={`text-xs font-medium ${isTraining ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                {isTraining ? 'Training Active' : 'Ready'}
              </span>
              {isTraining && (
                <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400 ml-auto">
                  E{currentEpoch}/{totalEpochs}
                </Badge>
              )}
            </div>

            {/* Progress bar (visible during training) */}
            {isTraining && (
              <div className="space-y-1.5">
                <Progress value={progressPct} className="h-2" />
                <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
                  <span>Loss: {currentProgress?.loss?.toFixed(4) || '--'}</span>
                  <span>Val: {currentProgress?.valLoss?.toFixed(4) || '--'}</span>
                  <span>Acc: {currentProgress?.accuracy ? (currentProgress.accuracy * 100).toFixed(1) + '%' : '--'}</span>
                </div>
                {/* Mini loss sparkline */}
                {lossHistory.length > 1 && (
                  <div className="h-10 flex items-end gap-px">
                    {lossHistory.slice(-30).map((h, i) => {
                      const maxLoss = Math.max(...lossHistory.slice(-30).map(l => l.loss));
                      const pct = maxLoss > 0 ? (h.loss / maxLoss) * 100 : 0;
                      return (
                        <div
                          key={i}
                          className="flex-1 bg-emerald-500/40 rounded-t-[1px] min-w-[2px]"
                          style={{ height: `${Math.max(5, pct)}%` }}
                          title={`E${h.epoch}: ${h.loss.toFixed(4)}`}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Training config (only when not training) */}
            {!isTraining && (
              <div className="space-y-2.5">
                {/* Pipeline */}
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Pipeline</label>
                  <Select value={pipeline} onValueChange={(v) => setPipeline(v as any)}>
                    <SelectTrigger className="h-7 text-[10px] bg-black/30 border-white/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="universal" className="text-xs">Universal (31 features)</SelectItem>
                      <SelectItem value="legacy" className="text-xs">Legacy (5 OHLCV)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Label type */}
                {pipeline === 'universal' && (
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Label Type</label>
                    <Select value={labelType} onValueChange={(v) => setLabelType(v as any)}>
                      <SelectTrigger className="h-7 text-[10px] bg-black/30 border-white/10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direction" className="text-xs">Direction</SelectItem>
                        <SelectItem value="triple_barrier" className="text-xs">Triple Barrier</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Epochs + Batch */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Epochs</label>
                    <Input
                      type="number"
                      value={epochs}
                      onChange={e => setEpochs(parseInt(e.target.value) || 50)}
                      className="h-7 text-[10px] bg-black/30 border-white/10"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Batch</label>
                    <Input
                      type="number"
                      value={batchSize}
                      onChange={e => setBatchSize(parseInt(e.target.value) || 32)}
                      className="h-7 text-[10px] bg-black/30 border-white/10"
                    />
                  </div>
                </div>

                {/* Advanced toggle */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-6 text-[10px] text-muted-foreground hover:text-primary"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  {showAdvanced ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                  Advanced Config
                </Button>

                {showAdvanced && pipeline === 'universal' && (
                  <div className="space-y-2 p-2 rounded-lg bg-white/5 border border-white/5">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] text-muted-foreground">Max Bars</label>
                        <Input type="number" value={maxBars} onChange={e => setMaxBars(parseInt(e.target.value) || 100000)} className="h-6 text-[10px] bg-black/30 border-white/10" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-muted-foreground">TF (sec)</label>
                        <Input type="number" value={timeframeSec} onChange={e => setTimeframeSec(parseInt(e.target.value) || 300)} className="h-6 text-[10px] bg-black/30 border-white/10" />
                      </div>
                    </div>
                    {labelType === 'direction' ? (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground">Horizon</label>
                          <Input type="number" value={labelHorizon} onChange={e => setLabelHorizon(parseInt(e.target.value) || 10)} className="h-6 text-[10px] bg-black/30 border-white/10" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground">ATR Mult</label>
                          <Input type="number" step="0.1" value={labelAtrMultiplier} onChange={e => setLabelAtrMultiplier(parseFloat(e.target.value) || 0.5)} className="h-6 text-[10px] bg-black/30 border-white/10" />
                        </div>
                        <div className="space-y-1 col-span-2">
                          <label className="text-[10px] text-muted-foreground">Classes</label>
                          <Select value={String(labelNumClasses)} onValueChange={v => setLabelNumClasses(Number(v) as 2 | 3)}>
                            <SelectTrigger className="h-6 text-[10px] bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="2" className="text-xs">2 (Up/Down)</SelectItem>
                              <SelectItem value="3" className="text-xs">3 (Up/Down/Hold)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground">TP ATR</label>
                          <Input type="number" step="0.1" value={takeProfitATR} onChange={e => setTakeProfitATR(parseFloat(e.target.value) || 2.0)} className="h-6 text-[10px] bg-black/30 border-white/10" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground">SL ATR</label>
                          <Input type="number" step="0.1" value={stopLossATR} onChange={e => setStopLossATR(parseFloat(e.target.value) || 1.0)} className="h-6 text-[10px] bg-black/30 border-white/10" />
                        </div>
                        <div className="space-y-1 col-span-2">
                          <label className="text-[10px] text-muted-foreground">Max Hold</label>
                          <Input type="number" value={maxHoldingPeriod} onChange={e => setMaxHoldingPeriod(parseInt(e.target.value) || 20)} className="h-6 text-[10px] bg-black/30 border-white/10" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Train / Stop button */}
            {!isTraining ? (
              <Button
                onClick={() => startTrainingMutation.mutate()}
                disabled={startTrainingMutation.isPending}
                className="w-full h-8 text-xs bg-linear-to-r from-emerald-600 to-teal-500 hover:opacity-90"
              >
                {startTrainingMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Play className="h-3 w-3 mr-1.5" />}
                Train {symbol}
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() => stopTrainingMutation.mutate()}
                disabled={stopTrainingMutation.isPending}
                className="w-full h-8 text-xs"
              >
                <Square className="h-3 w-3 mr-1.5" /> Stop Training
              </Button>
            )}

            {/* Model info */}
            <div className="p-2 rounded-lg bg-white/5 space-y-1">
              <p className="text-[10px] text-muted-foreground">Active Model</p>
              <p className="font-mono text-xs text-primary">{activeModelName}</p>
              {mlModels.filter(m => m.name.includes(symbol)).length > 0 && (
                <p className="text-[9px] text-muted-foreground">
                  {mlModels.filter(m => m.name.includes(symbol)).length} model{mlModels.filter(m => m.name.includes(symbol)).length !== 1 ? 's' : ''} for {symbol}
                </p>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════ */}
        {/* BACKTEST TAB                                    */}
        {/* ═══════════════════════════════════════════════ */}
        <TabsContent value="backtest" className="flex-1 overflow-auto m-0 p-0">
          <div className="p-3 space-y-3">
            {/* Model selector */}
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Model</label>
              <Select value={btModel} onValueChange={setBtModel}>
                <SelectTrigger className="h-7 text-[10px] bg-black/30 border-white/10">
                  <SelectValue placeholder="Select model..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__last_trained__" className="text-xs">Last Trained</SelectItem>
                  <SelectItem value="momentum" className="text-xs">Momentum (baseline)</SelectItem>
                  {mlModels.filter(m => m.name.includes(symbol)).map(m => (
                    <SelectItem key={m.id} value={String(m.id)} className="text-xs">{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Config rows */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Capital</label>
                <Input type="number" value={btCapital} onChange={e => setBtCapital(parseInt(e.target.value) || 10000)} className="h-7 text-[10px] bg-black/30 border-white/10" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Size</label>
                <Input type="number" value={btPositionSize} onChange={e => setBtPositionSize(parseInt(e.target.value) || 1)} className="h-7 text-[10px] bg-black/30 border-white/10" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Min Confidence</label>
              <Input type="number" step="0.05" value={btMinConfidence} onChange={e => setBtMinConfidence(parseFloat(e.target.value) || 0.5)} className="h-7 text-[10px] bg-black/30 border-white/10" />
            </div>

            {/* Run backtest */}
            <Button
              onClick={() => runBacktestMutation.mutate()}
              disabled={runBacktestMutation.isPending || !symbol}
              className="w-full h-8 text-xs bg-linear-to-r from-amber-600 to-orange-500 hover:opacity-90"
            >
              {runBacktestMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <FlaskConical className="h-3 w-3 mr-1.5" />}
              Run Backtest
            </Button>

            {/* Results summary */}
            {btResult && (
              <div className="space-y-2">
                <div className="p-2 rounded-lg bg-white/5 border border-white/10 space-y-1">
                  <p className="text-[10px] text-muted-foreground font-medium">Results</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    <div className="flex justify-between">
                      <span className="text-[9px] text-muted-foreground">Trades</span>
                      <span className="text-[10px] font-mono text-foreground">{btResult.metrics.totalTrades}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[9px] text-muted-foreground">Win Rate</span>
                      <span className={`text-[10px] font-mono ${btResult.metrics.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {btResult.metrics.winRate.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[9px] text-muted-foreground">P&L</span>
                      <span className={`text-[10px] font-mono ${btResult.metrics.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        ${btResult.metrics.totalPnl.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[9px] text-muted-foreground">Sharpe</span>
                      <span className="text-[10px] font-mono text-foreground">{btResult.metrics.sharpeRatio?.toFixed(2) || '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[9px] text-muted-foreground">Max DD</span>
                      <span className="text-[10px] font-mono text-rose-400">{btResult.metrics.maxDrawdown?.toFixed(2) || '--'}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[9px] text-muted-foreground">Profit F.</span>
                      <span className="text-[10px] font-mono text-foreground">{btResult.metrics.profitFactor?.toFixed(2) || '--'}</span>
                    </div>
                  </div>
                </div>

                {/* Trades visible on chart indicator */}
                {btTradesData?.chartMarkers && btTradesData.chartMarkers.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[9px] text-amber-400">
                    <Activity className="h-3 w-3" />
                    {btTradesData.chartMarkers.length} trade markers shown on chart
                  </div>
                )}

                {/* Clear results */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-6 text-[10px] border-white/10"
                  onClick={() => {
                    setBtResult(null);
                    setBtSelectedRunId(null);
                    dashboard.clearTradeMarkers('backtest');
                  }}
                >
                  Clear Results
                </Button>
              </div>
            )}

            {/* Previous runs */}
            {previousRuns.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted-foreground font-medium">Recent Runs</p>
                <div className="space-y-1 max-h-32 overflow-auto">
                  {previousRuns.slice(0, 5).map((run: any) => (
                    <button
                      key={run.id}
                      onClick={() => setBtSelectedRunId(run.id)}
                      className={`w-full text-left p-1.5 rounded text-[9px] transition-colors ${
                        btSelectedRunId === run.id ? 'bg-amber-500/20 border border-amber-500/30' : 'bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex justify-between">
                        <span className="font-mono text-foreground">{run.symbol || symbol}</span>
                        <span className={`font-mono ${(run.totalPnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          ${(run.totalPnl || 0).toFixed(0)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════ */}
        {/* XAI TAB                                         */}
        {/* ═══════════════════════════════════════════════ */}
        <TabsContent value="xai" className="flex-1 overflow-auto m-0 p-0">
          <div className="p-3 space-y-3">
            {/* Method selector */}
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Method</label>
              <Select value={xaiMethod} onValueChange={setXaiMethod}>
                <SelectTrigger className="h-7 text-[10px] bg-black/30 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="permutation" className="text-xs">Permutation Importance</SelectItem>
                  <SelectItem value="shap" className="text-xs">SHAP</SelectItem>
                  <SelectItem value="lime" className="text-xs">LIME</SelectItem>
                  <SelectItem value="gradcam" className="text-xs">GradCAM</SelectItem>
                  <SelectItem value="saliency" className="text-xs">Saliency Maps</SelectItem>
                  <SelectItem value="integrated_gradients" className="text-xs">Integrated Gradients</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Active model */}
            <div className="p-2 rounded-lg bg-white/5">
              <p className="text-[10px] text-muted-foreground">Analyzing</p>
              <p className="font-mono text-xs text-primary">{activeModelName}</p>
            </div>

            {/* Feature importance bars */}
            {xaiResult?.features && xaiResult.features.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted-foreground font-medium">Feature Importance</p>
                <div className="space-y-1">
                  {xaiResult.features.slice(0, 15).map((f, i) => {
                    const maxImp = Math.max(...xaiResult.features.map(x => Math.abs(x.importance)));
                    const pct = maxImp > 0 ? (Math.abs(f.importance) / maxImp) * 100 : 0;
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[9px] text-muted-foreground w-20 truncate" title={f.name}>{f.name}</span>
                        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${f.importance >= 0 ? 'bg-cyan-500' : 'bg-rose-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[9px] font-mono text-foreground w-10 text-right">
                          {(f.importance * 100).toFixed(1)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Crosshair className="h-8 w-8 mb-2 opacity-20" />
                <p className="text-xs">Train a model first</p>
                <p className="text-[10px] text-muted-foreground/60">XAI analysis requires a trained model</p>
              </div>
            )}
          </div>
        </TabsContent>

      </Tabs>
    </Card>
  );
}

export default MLWorkflowSidebar;
