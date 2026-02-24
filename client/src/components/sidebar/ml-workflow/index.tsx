/**
 * MLWorkflowSidebar — Tabbed workflow panel that lives beside the price chart.
 * 
 * Think of it as the "control room console" right next to the security monitors:
 * Labels → Train → Backtest → Explain, all while watching the chart.
 */
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import {
  Tag, Brain, FlaskConical, Crosshair,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { LABEL_GENERATORS, type LabelGeneratorKey } from "@shared/mlTaxonomy";
import { type LabelMarker } from "@/components/TradingChart";
import { QUERY_KEYS } from "@/lib/types";

import type {
  TrainingProgress, MlModel, BacktestRunResult, XAIResult,
  MLWorkflowSidebarProps,
} from "./types";
import { LabelsTab } from "./LabelsTab";
import { TrainTab } from "./TrainTab";
import { BacktestTab } from "./BacktestTab";
import { XAITab } from "./XAITab";

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

  const generateLabelsRef = useRef<() => void>(() => {});
  useEffect(() => {
    generateLabelsRef.current = () => {
      if (chartData.length === 0) return;
      const startTs = chartData[0]!.timestamp;
      const endTs = chartData[chartData.length - 1]!.timestamp;
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

  const visibleLabels = useMemo(() => {
    if (!showLabels || labelPreview.length === 0 || chartData.length === 0) return [];
    const start = chartData[0]!.timestamp;
    const end = chartData[chartData.length - 1]!.timestamp;
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

  const { data: instruments = [] } = useQuery({
    queryKey: ['instruments'],
    queryFn: async () => { const res = await fetch('/api/instruments'); return res.json(); },
  });
  const futuresSymbols = instruments.filter((i: any) => i.assetType === 'futures').map((i: any) => i.symbol);

  const { data: mlModels = [] } = useQuery<MlModel[]>({
    queryKey: [...QUERY_KEYS.mlModels],
    queryFn: async () => { const res = await fetch('/api/ml/models'); return res.json(); },
  });
  const activeModelName = mlModels.find(m => m.name.includes(symbol) && m.status === 'active')?.name || `CNN-${symbol}`;

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

  useEffect(() => {
    if (trainingStatus?.active && trainingStatus.symbol) {
      setActiveSessionSymbol(trainingStatus.symbol);
      if (trainingStatus.progress) setCurrentProgress(trainingStatus.progress);
    } else {
      setActiveSessionSymbol(null);
    }
  }, [trainingStatus]);

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

  useEffect(() => {
    connectToStream();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connectToStream]);

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

  const { data: btTradesData } = useQuery<{ trades: any[]; chartMarkers: any[]; count: number }>({
    queryKey: ["/api/backtest/trades", btSelectedRunId],
    queryFn: async () => {
      const res = await fetch(`/api/backtest/trades/${btSelectedRunId}`);
      return res.json();
    },
    enabled: !!btSelectedRunId,
  });

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

        {/* LABELS TAB */}
        <TabsContent value="labels" className="flex-1 overflow-auto m-0 p-0">
          <LabelsTab
            selectedGenerator={selectedGenerator}
            setSelectedGenerator={setSelectedGenerator}
            labelParams={labelParams}
            setLabelParams={setLabelParams}
            currentParams={currentParams}
            generatorDef={generatorDef}
            onGenerate={() => generateLabelsRef.current()}
            isPreviewing={previewMutation.isPending}
            chartDataLength={chartData.length}
            showLabels={showLabels}
            onClearLabels={() => {
              setShowLabels(false);
              setLabelPreview([]);
              onLabelMarkersChange([], false);
            }}
            labelDistribution={labelDistribution}
            visibleLabelsCount={visibleLabels.length}
            effectiveSymbol={effectiveSymbol}
          />
        </TabsContent>

        {/* TRAIN TAB */}
        <TabsContent value="train" className="flex-1 overflow-auto m-0 p-0">
          <TrainTab
            isTraining={isTraining}
            currentProgress={currentProgress}
            currentEpoch={currentEpoch}
            totalEpochs={totalEpochs}
            progressPct={progressPct}
            lossHistory={lossHistory}
            pipeline={pipeline}
            setPipeline={setPipeline}
            labelType={labelType}
            setLabelType={setLabelType}
            epochs={epochs}
            setEpochs={setEpochs}
            batchSize={batchSize}
            setBatchSize={setBatchSize}
            showAdvanced={showAdvanced}
            setShowAdvanced={setShowAdvanced}
            maxBars={maxBars}
            setMaxBars={setMaxBars}
            timeframeSec={timeframeSec}
            setTimeframeSec={setTimeframeSec}
            labelHorizon={labelHorizon}
            setLabelHorizon={setLabelHorizon}
            labelAtrMultiplier={labelAtrMultiplier}
            setLabelAtrMultiplier={setLabelAtrMultiplier}
            labelNumClasses={labelNumClasses}
            setLabelNumClasses={setLabelNumClasses}
            takeProfitATR={takeProfitATR}
            setTakeProfitATR={setTakeProfitATR}
            stopLossATR={stopLossATR}
            setStopLossATR={setStopLossATR}
            maxHoldingPeriod={maxHoldingPeriod}
            setMaxHoldingPeriod={setMaxHoldingPeriod}
            onStartTraining={() => startTrainingMutation.mutate()}
            isStartingTraining={startTrainingMutation.isPending}
            onStopTraining={() => stopTrainingMutation.mutate()}
            isStoppingTraining={stopTrainingMutation.isPending}
            symbol={symbol}
            activeModelName={activeModelName}
            mlModels={mlModels}
          />
        </TabsContent>

        {/* BACKTEST TAB */}
        <TabsContent value="backtest" className="flex-1 overflow-auto m-0 p-0">
          <BacktestTab
            btModel={btModel}
            setBtModel={setBtModel}
            btCapital={btCapital}
            setBtCapital={setBtCapital}
            btPositionSize={btPositionSize}
            setBtPositionSize={setBtPositionSize}
            btMinConfidence={btMinConfidence}
            setBtMinConfidence={setBtMinConfidence}
            btResult={btResult}
            btTradesData={btTradesData}
            btSelectedRunId={btSelectedRunId}
            setBtSelectedRunId={setBtSelectedRunId}
            previousRuns={previousRuns}
            onRunBacktest={() => runBacktestMutation.mutate()}
            isRunningBacktest={runBacktestMutation.isPending}
            onClearResults={() => {
              setBtResult(null);
              setBtSelectedRunId(null);
              dashboard.clearTradeMarkers('backtest');
            }}
            symbol={symbol}
            mlModels={mlModels}
          />
        </TabsContent>

        {/* XAI TAB */}
        <TabsContent value="xai" className="flex-1 overflow-auto m-0 p-0">
          <XAITab
            xaiMethod={xaiMethod}
            setXaiMethod={setXaiMethod}
            xaiResult={xaiResult}
            activeModelName={activeModelName}
          />
        </TabsContent>

      </Tabs>
    </Card>
  );
}

export default MLWorkflowSidebar;
