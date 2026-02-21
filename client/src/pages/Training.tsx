import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, AreaChart, Area, ComposedChart, ReferenceLine } from "recharts";
import { Terminal, Pause, Square, Cpu, Brain, Sparkles, Play, AlertTriangle, TrendingUp, Zap, Layers, Settings, BarChart3, RefreshCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback } from "react";
import LossSurface3D from "@/components/LossSurface3D";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";

interface TrainingProgress {
  epoch: number;
  totalEpochs: number;
  loss: number;
  valLoss: number;
  accuracy: number;
  valAccuracy: number;
  learningRate: number;
  batchSize: number;
  status: 'training' | 'completed' | 'error' | 'stopped';
  message?: string;
  elapsedMs?: number;
  trainSize?: number;
  valSize?: number;
  stepsPerEpoch?: number;
  samplesSeen?: number;
}

interface TrainingSession {
  id: string;
  symbol: string;
  status: string;
  savedModelId?: number;
  config: {
    filters: number[];
    kernelSizes: number[];
    dropoutRate: number;
    learningRate: number;
    sequenceLength: number;
    batchSize: number;
    epochs: number;
  };
  progress: TrainingProgress[];
  startTime: number;
  source?: string;
  runtimeModelAvailable?: boolean;
}

import { MlModel, FeatureImportance, QUERY_KEYS } from "@/lib/types";

function MetricBox({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  const colorClasses: Record<string, string> = {
    green: 'text-green-400 bg-green-500/10 border-green-500/20',
    primary: 'text-primary bg-primary/10 border-primary/20',
    accent: 'text-accent bg-accent/10 border-accent/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  };
  return (
    <div className={`glass rounded-xl p-2 border ${colorClasses[color] || colorClasses.primary}`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className={`h-3 w-3 ${color === 'green' ? 'text-green-400' : color === 'accent' ? 'text-accent' : color === 'amber' ? 'text-amber-400' : 'text-primary'}`} />
        <span className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-sm font-mono font-bold">{value}</div>
    </div>
  );
}

/** Embeddable training panel – used both standalone and inside MLHub's Training tab */
export function TrainingPanel() {
  const queryClient = useQueryClient();
  const dashboard = useDashboard();
  const [activeTab, setActiveTab] = useState("training");
  // Sync symbol with unified dashboard context
  const [selectedSymbol, setSelectedSymbolLocal] = useState(dashboard.symbol);
  const setSelectedSymbol = (sym: string) => {
    setSelectedSymbolLocal(sym);
    dashboard.setSymbol(sym);
  };
  // Listen for context changes from other pages
  useEffect(() => {
    if (dashboard.symbol !== selectedSymbol) {
      setSelectedSymbolLocal(dashboard.symbol);
    }
  }, [dashboard.symbol]);

  const [epochs, setEpochs] = useState(50);
  const [batchSize, setBatchSize] = useState(32);

  // Universal pipeline config
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
  const [showConfig, setShowConfig] = useState(false);

  const [lossHistory, setLossHistory] = useState<{epoch: number, loss: number, valLoss: number, accuracy?: number}[]>([]);
  const [currentProgress, setCurrentProgress] = useState<TrainingProgress | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState<string[]>(['[INFO] Neural network initialized']);
  const [activeSessionSymbol, setActiveSessionSymbol] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  // Refs for values used inside SSE handler to avoid stale closures / unnecessary reconnections
  const activeSessionSymbolRef = useRef<string | null>(null);
  const selectedSymbolRef = useRef(selectedSymbol);
  const activeModelNameRef = useRef<string | undefined>(undefined);
  const dashboardRef = useRef(dashboard);
  dashboardRef.current = dashboard;

  // Check training status on mount to sync live state
  const { data: trainingStatus } = useQuery({
    queryKey: ['trainingStatus'],
    queryFn: async () => {
      const res = await fetch('/api/ml/train/status');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: isConnected ? 5000 : false,
    refetchOnWindowFocus: true
  });

  // Sync active session from status check
  useEffect(() => {
    if (trainingStatus?.active && trainingStatus.symbol) {
      setActiveSessionSymbol(trainingStatus.symbol);
      if (trainingStatus.progress) {
        setCurrentProgress(trainingStatus.progress);
      }
    } else {
      setActiveSessionSymbol(null);
    }
  }, [trainingStatus]);

  // Fetch instruments for symbol selection
  const { data: instruments = [] } = useQuery({
    queryKey: ['instruments'],
    queryFn: async () => {
      const res = await fetch('/api/instruments');
      return res.json();
    }
  });

  // Fetch last training session
  const { data: lastSession, refetch: refetchLastSession } = useQuery<TrainingSession | null>({
    queryKey: ['lastTrainingSession', selectedSymbol],
    queryFn: async () => {
      const res = await fetch(`/api/ml/train/last?symbol=${selectedSymbol}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data;
    },
    refetchOnWindowFocus: false
  });

  // Fetch all ML models
  const { data: mlModels = [] } = useQuery<MlModel[]>({
    queryKey: [...QUERY_KEYS.mlModels],
    queryFn: async () => {
      const res = await fetch('/api/ml/models');
      return res.json();
    }
  });

  // Get the active model name for the selected symbol
  const activeModelName = mlModels.find(m => 
    m.name.includes(selectedSymbol) && m.status === 'active'
  )?.name || `CNN-${selectedSymbol}`;

  // Fetch feature importance for active model
  const { data: featureImportance = [] } = useQuery<FeatureImportance[]>({
    queryKey: ['featureImportance', activeModelName],
    queryFn: async () => {
      const res = await fetch(`/api/ml/feature-importance/${encodeURIComponent(activeModelName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!activeModelName
  });

  // Keep refs in sync for SSE handler (avoids stale closures)
  activeSessionSymbolRef.current = activeSessionSymbol;
  selectedSymbolRef.current = selectedSymbol;
  activeModelNameRef.current = activeModelName;

  // Load last session data into UI on mount
  useEffect(() => {
    if (lastSession && lastSession.progress && lastSession.progress.length > 0) {
      const history = lastSession.progress.map(p => ({
        epoch: p.epoch,
        loss: p.loss,
        valLoss: p.valLoss,
        accuracy: p.accuracy
      }));
      setLossHistory(history);
      setCurrentProgress(lastSession.progress[lastSession.progress.length - 1]);
      setLogs(prev => [...prev, `[INFO] Loaded previous training session for ${lastSession.symbol}`]);
    }
  }, [lastSession]);

  // Connect to SSE stream for live training updates
  // Uses refs to read mutable state so the callback never needs to be recreated
  const connectToStream = useCallback(() => {
    // Don't create duplicate streams
    if (eventSourceRef.current && eventSourceRef.current.readyState !== EventSource.CLOSED) {
      return eventSourceRef.current;
    }

    const eventSource = new EventSource('/api/ml/train/stream');
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setLogs(prev => {
        if (prev[prev.length - 1] !== '[ML] Connected to training stream') {
          return [...prev, '[ML] Connected to training stream'];
        }
        return prev;
      });
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const progress: TrainingProgress = data;
        const eventSymbol = data.symbol;

        // Read current values from refs (always fresh, no stale closures)
        const currentActiveSession = activeSessionSymbolRef.current;

        // Only update UI if this event matches our session
        if (eventSymbol && currentActiveSession && eventSymbol !== currentActiveSession) {
          return;
        }

        setCurrentProgress(progress);

        // Push training context to unified dashboard so chart can highlight range
        if (progress.epoch > 0 && progress.status === 'training') {
          dashboardRef.current.setTrainingContext({
            dataStart: data.dataStart || '',
            dataEnd: data.dataEnd || '',
            epoch: progress.epoch,
            totalEpochs: progress.totalEpochs,
            loss: progress.loss,
            valLoss: progress.valLoss,
            accuracy: progress.accuracy,
            valAccuracy: progress.valAccuracy,
            status: progress.status,
            message: progress.message,
            trainSize: progress.trainSize,
            valSize: progress.valSize,
            symbol: eventSymbol || selectedSymbolRef.current || 'MNQ',
            modelName: activeModelNameRef.current,
          });

          setLossHistory(prev => {
            const exists = prev.some(p => p.epoch === progress.epoch);
            if (exists) return prev;
            return [...prev, {
              epoch: progress.epoch,
              loss: progress.loss,
              valLoss: progress.valLoss,
              accuracy: progress.accuracy
            }];
          });

          setLogs(prev => {
            const newLog = `[E${String(progress.epoch).padStart(3, '0')}] loss=${progress.loss.toFixed(4)} val=${progress.valLoss.toFixed(4)} acc=${(progress.accuracy * 100).toFixed(1)}%`;
            return [...prev.slice(-50), newLog];
          });
        }

        if (progress.status === 'completed' || progress.status === 'stopped' || progress.status === 'error') {
          setLogs(prev => [...prev.slice(-50), `[INFO] Training ${progress.status}: ${progress.message || ''}`]);
          setActiveSessionSymbol(null);
          // Clear training context from unified dashboard
          dashboardRef.current.setTrainingContext(null);
          queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.mlModels] });
          queryClient.invalidateQueries({ queryKey: ['lastTrainingSession', selectedSymbolRef.current] });
          queryClient.invalidateQueries({ queryKey: ['featureImportance', activeModelNameRef.current] });
          queryClient.invalidateQueries({ queryKey: ['trainingStatus'] });
        }
      } catch (e) {
        console.error('Error parsing SSE data:', e);
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      if (eventSource.readyState === EventSource.CLOSED) {
        setLogs(prev => [...prev.slice(-50), '[WARN] Training stream closed, reconnecting...']);
        eventSourceRef.current = null;
        setTimeout(() => {
          connectToStream();
        }, 3000);
      }
    };

    return eventSource;
  }, [queryClient]); // Only queryClient - refs handle the rest

  // Start training mutation
  const startTrainingMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = {
        symbol: selectedSymbol,
        epochs,
        batchSize,
        pipeline,
      };

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
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to start training');
      }
      return res.json();
    },
    onSuccess: () => {
      setLossHistory([]);
      setActiveSessionSymbol(selectedSymbol);
      setLogs(prev => [...prev, `[INFO] Starting training for ${selectedSymbol}...`]);
      // Stream should already be connected from mount, no need to reconnect
    },
    onError: (error: Error) => {
      setLogs(prev => [...prev, `[ERROR] ${error.message}`]);
    }
  });

  // Stop training mutation
  const stopTrainingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ml/train/stop', { method: 'POST' });
      return res.json();
    },
    onSuccess: () => {
      setLogs(prev => [...prev, '[INFO] Training stop requested']);
    }
  });

  // Connect to stream on mount, single cleanup on unmount
  useEffect(() => {
    connectToStream();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connectToStream]);

  const isTraining = currentProgress?.status === 'training' || !!activeSessionSymbol;
  const currentEpoch = currentProgress?.epoch || 0;
  const totalEpochs = currentProgress?.totalEpochs || epochs;
  const currentLoss = currentProgress?.loss || (lossHistory.length > 0 ? lossHistory[lossHistory.length - 1].loss : 1.0);
  const currentValLoss = currentProgress?.valLoss || (lossHistory.length > 0 ? lossHistory[lossHistory.length - 1].valLoss : 1.0);
  const currentAccuracy = currentProgress?.accuracy || 0.33;
  const currentLR = currentProgress?.learningRate || 0.001;
  const elapsedMs = currentProgress?.elapsedMs || 0;
  const currentBatchSize = currentProgress?.batchSize || batchSize;

  // Real training metadata from backend (only valid when receiving SSE data)
  const hasRealData = currentProgress !== null && currentProgress.epoch > 0;
  const trainSize = currentProgress?.trainSize || 0;
  const valSize = currentProgress?.valSize || 0;
  const stepsPerEpoch = currentProgress?.stepsPerEpoch || 0;

  // Calculate derived metrics (only from real loss history)
  const hasLossHistory = lossHistory.length > 0;
  const bestValLoss = hasLossHistory ? Math.min(...lossHistory.map(h => h.valLoss)) : currentValLoss;
  const bestEpoch = hasLossHistory ? lossHistory.findIndex(h => h.valLoss === bestValLoss) + 1 : currentEpoch;
  const epochsSinceBest = Math.max(0, currentEpoch - bestEpoch);
  const initialValLoss = hasLossHistory ? lossHistory[0].valLoss : 1.0;
  const improvement = hasLossHistory && initialValLoss > 0 ? ((initialValLoss - bestValLoss) / initialValLoss) * 100 : 0;
  
  // Use real samples seen from backend (show "--" if no data yet)
  const realSamplesSeen = currentProgress?.samplesSeen;
  const samplesSeenStr = realSamplesSeen !== undefined && realSamplesSeen > 0 
    ? (realSamplesSeen >= 1000 ? `${(realSamplesSeen / 1000).toFixed(0)}K` : `${realSamplesSeen}`)
    : (hasRealData && trainSize > 0 ? `${((currentEpoch * trainSize) / 1000).toFixed(0)}K` : '--');

  // ETA calculation using real elapsed time (show "--" if no data yet)
  const msPerEpoch = currentEpoch > 0 && elapsedMs > 0 ? elapsedMs / currentEpoch : 0;
  const remainingEpochs = totalEpochs - currentEpoch;
  const etaMs = msPerEpoch * remainingEpochs;
  const etaSec = Math.floor(etaMs / 1000);
  const etaMin = Math.floor(etaSec / 60);
  const etaStr = msPerEpoch > 0 
    ? (etaMin > 0 ? `${etaMin}:${String(etaSec % 60).padStart(2, '0')}` : `0:${String(etaSec).padStart(2, '0')}`)
    : '--';

  // Overfitting detection with real metrics
  const overfitGap = currentValLoss - currentLoss;
  const overfitGapPercent = currentLoss > 0 ? (overfitGap / currentLoss) * 100 : 0;
  const isOverfitting = overfitGap > 0.05 && currentEpoch > 20;
  const overfitSeverity = overfitGap > 0.15 ? "severe" : overfitGap > 0.08 ? "moderate" : "mild";
  const overfitStatus = overfitGapPercent < 0 ? "HEALTHY" : overfitGapPercent < 10 ? "HEALTHY" : overfitGapPercent < 20 ? "CAUTION" : "OVERFIT";
  const learningPhase = epochsSinceBest <= 5 ? "Learning" : epochsSinceBest <= 15 ? "Plateau" : "Stagnant";

  // Learning rate schedule data
  const lrScheduleData = Array.from({ length: totalEpochs }, (_, i) => ({
    epoch: i + 1,
    lr: 0.001 * Math.pow(0.95, Math.floor(i / 10)),
  }));

  // Parse model metrics for comparison
  const modelComparison = mlModels.map(model => {
    let metrics = { finalLoss: 0, finalValLoss: 0, finalAccuracy: 0, trainingTime: 0 };
    let hyperparams = { epochs: 0 };
    try {
      if (model.metrics) metrics = JSON.parse(model.metrics);
      if (model.hyperparameters) hyperparams = JSON.parse(model.hyperparameters);
    } catch {}
    return {
      name: model.name,
      trainLoss: metrics.finalLoss || 0,
      valLoss: metrics.finalValLoss || 0,
      accuracy: metrics.finalAccuracy || 0,
      epochs: hyperparams.epochs || 0,
      status: model.status,
      trainingTime: metrics.trainingTime || 0,
    };
  });

  // Feature categories
  const featureCategories = ['price', 'volume', 'momentum', 'volatility'];

  const futuresSymbols = instruments.filter((i: any) => i.assetType === 'futures').map((i: any) => i.symbol);

  return (
    <div className="space-y-4 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Brain className={`h-5 w-5 ${isTraining ? 'text-green-400 pulse-slow' : 'text-muted-foreground'}`} />
            <span className={`text-sm font-medium ${isTraining ? 'text-green-400' : 'text-muted-foreground'}`}>
              {isTraining ? 'Neural Network Active' : 'Neural Network Idle'}
            </span>
            <Badge variant="outline" className={`text-xs ${isConnected ? 'border-green-500/50 text-green-400' : 'border-muted-foreground/30'}`}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </Badge>
            {pipeline === 'universal' && (
              <Badge variant="outline" className="text-xs border-cyan-500/30 text-cyan-400 bg-cyan-500/10">
                Universal · {labelType === 'direction' ? `${labelNumClasses}-class` : 'Triple Barrier'}
              </Badge>
            )}
            {isOverfitting && (
              <Badge variant="outline" className="border-amber-500/50 text-amber-400 bg-amber-500/10 gap-1">
                <AlertTriangle className="h-3 w-3" /> Overfitting Detected
              </Badge>
            )}
          </div>
          <h1 className="text-4xl font-display font-bold text-foreground">Training Center</h1>
        </div>
        <div className="flex gap-3 items-center">
          {/* Symbol selector */}
          <Select value={selectedSymbol} onValueChange={setSelectedSymbol} disabled={isTraining}>
            <SelectTrigger className="w-28 h-10 rounded-xl" data-testid="select-symbol">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {futuresSymbols.map((sym: string) => (
                <SelectItem key={sym} value={sym}>{sym}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Epochs input */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Epochs:</Label>
            <Input 
              type="number" 
              value={epochs} 
              onChange={(e) => setEpochs(parseInt(e.target.value) || 50)}
              className="w-20 h-10 rounded-xl"
              disabled={isTraining}
              data-testid="input-epochs"
            />
          </div>

          {/* Config toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowConfig(!showConfig)}
            disabled={isTraining}
            className={`h-10 rounded-xl gap-1.5 ${showConfig ? 'border-primary/50 text-primary bg-primary/10' : ''}`}
          >
            <Settings className="h-4 w-4" /> Config
          </Button>

          <Badge variant="outline" className={`h-10 px-4 font-mono gap-2 text-sm rounded-full ${
            isTraining ? 'border-green-500/30 text-green-400 bg-green-500/10' : 'border-muted-foreground/30 text-muted-foreground'
          }`}>
            <Brain className={`h-4 w-4 ${isTraining ? 'pulse-slow' : ''}`} /> Epoch {currentEpoch}/{totalEpochs}
          </Badge>
          
          {!isTraining ? (
            <Button 
              onClick={() => startTrainingMutation.mutate()} 
              disabled={startTrainingMutation.isPending}
              className="h-10 rounded-xl bg-linear-to-r from-primary to-accent text-white hover:opacity-90" 
              data-testid="button-start"
            >
              {startTrainingMutation.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Start Training
            </Button>
          ) : (
            <Button 
              variant="destructive" 
              onClick={() => stopTrainingMutation.mutate()}
              disabled={stopTrainingMutation.isPending}
              className="h-10 rounded-xl" 
              data-testid="button-stop"
            >
              <Square className="mr-2 h-4 w-4" /> Stop
            </Button>
          )}
        </div>
      </div>

      {/* Pipeline Config Panel */}
      {showConfig && !isTraining && (
        <Card className="glass rounded-2xl border border-primary/20 shrink-0">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
              {/* Pipeline Type */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Pipeline</Label>
                <Select value={pipeline} onValueChange={(v) => setPipeline(v as 'universal' | 'legacy')}>
                  <SelectTrigger className="h-9 rounded-lg text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="universal">Universal (31 features)</SelectItem>
                    <SelectItem value="legacy">Legacy (5 OHLCV)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {pipeline === 'universal' && (
                <>
                  {/* Label Type */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Label Type</Label>
                    <Select value={labelType} onValueChange={(v) => setLabelType(v as 'direction' | 'triple_barrier')}>
                      <SelectTrigger className="h-9 rounded-lg text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direction">Direction</SelectItem>
                        <SelectItem value="triple_barrier">Triple Barrier</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Max Bars */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Max Bars</Label>
                    <Input
                      type="number"
                      value={maxBars}
                      onChange={(e) => setMaxBars(parseInt(e.target.value) || 100000)}
                      className="h-9 rounded-lg text-xs"
                    />
                  </div>

                  {/* Timeframe */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Timeframe</Label>
                    <Select value={String(timeframeSec)} onValueChange={(v) => setTimeframeSec(parseInt(v))}>
                      <SelectTrigger className="h-9 rounded-lg text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="60">1m</SelectItem>
                        <SelectItem value="300">5m</SelectItem>
                        <SelectItem value="900">15m</SelectItem>
                        <SelectItem value="1800">30m</SelectItem>
                        <SelectItem value="3600">1H</SelectItem>
                        <SelectItem value="14400">4H</SelectItem>
                        <SelectItem value="86400">1D</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Direction-specific params */}
                  {labelType === 'direction' && (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Horizon (bars)</Label>
                        <Input
                          type="number"
                          value={labelHorizon}
                          onChange={(e) => setLabelHorizon(parseInt(e.target.value) || 10)}
                          className="h-9 rounded-lg text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Classes</Label>
                        <Select value={String(labelNumClasses)} onValueChange={(v) => setLabelNumClasses(parseInt(v) as 2 | 3)}>
                          <SelectTrigger className="h-9 rounded-lg text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="2">2 (Up/Down)</SelectItem>
                            <SelectItem value="3">3 (Up/Neutral/Down)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}

                  {/* Triple barrier params */}
                  {labelType === 'triple_barrier' && (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">TP (ATR×)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={takeProfitATR}
                          onChange={(e) => setTakeProfitATR(parseFloat(e.target.value) || 2.0)}
                          className="h-9 rounded-lg text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">SL (ATR×)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={stopLossATR}
                          onChange={(e) => setStopLossATR(parseFloat(e.target.value) || 1.0)}
                          className="h-9 rounded-lg text-xs"
                        />
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Batch Size (always visible) */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Batch Size</Label>
                <Input
                  type="number"
                  value={batchSize}
                  onChange={(e) => setBatchSize(parseInt(e.target.value) || 32)}
                  className="h-9 rounded-lg text-xs"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <TabsList className="glass rounded-xl p-1 h-auto shrink-0 w-fit">
          <TabsTrigger value="training" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20" data-testid="tab-training">
            <Sparkles className="h-3 w-3 mr-1.5" /> Live Training
          </TabsTrigger>
          <TabsTrigger value="features" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20" data-testid="tab-features">
            <BarChart3 className="h-3 w-3 mr-1.5" /> Feature Importance
          </TabsTrigger>
          <TabsTrigger value="models" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20" data-testid="tab-models">
            <Layers className="h-3 w-3 mr-1.5" /> Model Comparison
          </TabsTrigger>
        </TabsList>

        {/* Live Training Tab */}
        <TabsContent value="training" className="flex-1 min-h-0 overflow-hidden mt-4">
          {/* Top Metrics Bar */}
          <div className="grid grid-cols-6 gap-2 mb-4 shrink-0">
            <Card className="glass rounded-xl p-3 border border-white/10">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">PROGRESS</div>
              <div className="text-2xl font-bold font-mono text-foreground">
                {currentEpoch}<span className="text-muted-foreground text-lg">/{totalEpochs}</span>
              </div>
              <Progress value={(currentEpoch / totalEpochs) * 100} className="h-1 mt-1" />
            </Card>
            <Card className="glass rounded-xl p-3 border border-primary/30">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">BEST VAL LOSS</div>
              <div className="text-2xl font-bold font-mono text-primary">{bestValLoss.toFixed(4)}</div>
              <div className="text-[9px] text-muted-foreground">@ epoch {bestEpoch}</div>
            </Card>
            <Card className="glass rounded-xl p-3 border border-green-500/30">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">IMPROVEMENT</div>
              <div className="text-2xl font-bold font-mono text-green-400">{improvement.toFixed(1)}%</div>
              <div className="text-[9px] text-muted-foreground">from initial</div>
            </Card>
            <Card className="glass rounded-xl p-3 border border-amber-500/30">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">LEARNING RATE</div>
              <div className="text-2xl font-bold font-mono text-amber-400">{currentLR.toExponential(1)}</div>
              <div className="text-[9px] text-muted-foreground">adaptive</div>
            </Card>
            <Card className="glass rounded-xl p-3 border border-cyan-500/30">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">TRAIN SIZE</div>
              <div className="text-2xl font-bold font-mono text-cyan-400">{trainSize > 0 ? trainSize.toLocaleString() : '--'}</div>
              <div className="text-[9px] text-muted-foreground">{stepsPerEpoch > 0 ? `${stepsPerEpoch} steps/epoch` : 'samples'}</div>
            </Card>
            <Card className="glass rounded-xl p-3 border border-white/10">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">ETA</div>
              <div className="text-2xl font-bold font-mono text-foreground">{etaStr}</div>
              <div className="text-[9px] text-muted-foreground">{msPerEpoch > 0 ? `${(msPerEpoch / 1000).toFixed(1)}s/epoch` : 'waiting...'}</div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100%-6rem)]">
            {/* 3D Loss Surface */}
            <Card className="glass rounded-2xl overflow-hidden flex flex-col gradient-border">
              <CardHeader className="border-b border-white/5 py-2 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-primary" /> 3D Loss Surface
                  <Badge variant="outline" className={`ml-auto border-primary/30 text-primary bg-primary/10 font-mono text-[10px] rounded-full`}>
                    {isTraining ? 'LIVE' : lossHistory.length > 0 ? 'HISTORY' : 'STATIC'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 p-0">
                <LossSurface3D 
                  currentEpoch={currentEpoch} 
                  maxEpochs={totalEpochs} 
                  currentLoss={currentLoss} 
                  currentValLoss={currentValLoss} 
                  lossHistory={lossHistory} 
                />
              </CardContent>
            </Card>

            {/* Right Column */}
            <div className="flex flex-col gap-4 min-h-0 overflow-hidden">
              {/* Loss Chart */}
              <Card className="flex-1 glass rounded-2xl flex flex-col gradient-border min-h-0">
                <CardHeader className="border-b border-white/5 py-2 px-4">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                    <TrendingUp className="h-3 w-3 text-green-400" /> Loss Convergence
                    {isOverfitting && (
                      <Badge variant="outline" className={`ml-auto text-[10px] rounded-full ${
                        overfitSeverity === 'severe' ? 'border-rose-500/50 text-rose-400 bg-rose-500/10' :
                        overfitSeverity === 'moderate' ? 'border-amber-500/50 text-amber-400 bg-amber-500/10' :
                        'border-yellow-500/50 text-yellow-400 bg-yellow-500/10'
                      }`}>
                        Gap: {(overfitGap * 100).toFixed(1)}%
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 min-h-0 p-2">
                  {lossHistory.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={lossHistory}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                        <XAxis dataKey="epoch" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} />
                        <Tooltip contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px', fontSize: '11px' }} />
                        <Legend wrapperStyle={{ fontSize: '10px' }} />
                        <Area type="monotone" dataKey="loss" stroke="hsl(260, 80%, 70%)" fill="hsla(260, 80%, 70%, 0.1)" strokeWidth={2} name="Train" />
                        <Line type="monotone" dataKey="valLoss" stroke="hsl(185, 70%, 55%)" strokeWidth={2} dot={false} name="Val" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                      Start training to see loss convergence
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Metrics Row */}
              <div className="grid grid-cols-4 gap-2 shrink-0">
                <MetricBox icon={Brain} label="Epoch" value={`${currentEpoch}`} color="green" />
                <MetricBox icon={Sparkles} label="Train Loss" value={currentLoss.toFixed(4)} color="primary" />
                <MetricBox icon={Cpu} label="Val Loss" value={currentValLoss.toFixed(4)} color="accent" />
                <MetricBox icon={Zap} label="Accuracy" value={`${(currentAccuracy * 100).toFixed(1)}%`} color="amber" />
              </div>

              {/* Overfitting Monitor */}
              <Card className="glass rounded-2xl gradient-border shrink-0">
                <CardHeader className="py-2 px-4 border-b border-white/5 flex flex-row items-center justify-between">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                    <TrendingUp className="h-3 w-3 text-primary" /> Overfitting Monitor
                  </CardTitle>
                  <Badge 
                    variant="outline" 
                    className={`text-[10px] rounded-full ${
                      overfitStatus === 'HEALTHY' ? 'border-green-500/50 text-green-400 bg-green-500/10' :
                      overfitStatus === 'CAUTION' ? 'border-amber-500/50 text-amber-400 bg-amber-500/10' :
                      'border-rose-500/50 text-rose-400 bg-rose-500/10'
                    }`}
                  >
                    {overfitStatus}
                  </Badge>
                </CardHeader>
                <CardContent className="p-3">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Val/Train Gap</div>
                      <div className={`text-xl font-bold font-mono ${
                        overfitGapPercent < 0 ? 'text-green-400' : 
                        overfitGapPercent < 10 ? 'text-cyan-400' : 
                        overfitGapPercent < 20 ? 'text-amber-400' : 'text-rose-400'
                      }`}>
                        {overfitGapPercent >= 0 ? '+' : ''}{overfitGapPercent.toFixed(1)}%
                      </div>
                      <Progress 
                        value={Math.min(Math.abs(overfitGapPercent), 50)} 
                        className={`h-1 mt-1 ${overfitGapPercent < 10 ? '[&>div]:bg-green-500' : overfitGapPercent < 20 ? '[&>div]:bg-amber-500' : '[&>div]:bg-rose-500'}`} 
                      />
                    </div>
                    <div>
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Epochs Since Best</div>
                      <div className="text-xl font-bold font-mono text-foreground">{Math.max(0, epochsSinceBest)}</div>
                      <div className="text-[9px] text-muted-foreground mt-1">{learningPhase}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Samples Seen</div>
                      <div className="text-xl font-bold font-mono text-foreground">{samplesSeenStr}</div>
                      <div className="text-[9px] text-muted-foreground mt-1">batch={currentBatchSize}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Feature Importance Tab */}
        <TabsContent value="features" className="flex-1 min-h-0 overflow-hidden mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
            <Card className="glass rounded-2xl flex flex-col gradient-border">
              <CardHeader className="border-b border-white/5">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Feature Importance Ranking - CNN-{selectedSymbol}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 pt-4">
                {featureImportance.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={featureImportance} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} domain={[0, 0.5]} />
                      <YAxis type="category" dataKey="feature" stroke="hsl(var(--muted-foreground))" fontSize={9} width={80} />
                      <Tooltip contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px' }} />
                      <Bar dataKey="importance" fill="hsl(260, 80%, 70%)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    Train a model to see feature importance
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="glass rounded-2xl flex flex-col gradient-border">
              <CardHeader className="border-b border-white/5">
                <CardTitle className="text-sm font-medium text-muted-foreground">Feature Categories</CardTitle>
              </CardHeader>
              <ScrollArea className="flex-1">
                <CardContent className="space-y-4 pt-4">
                  {featureCategories.map(cat => {
                    const features = featureImportance.filter(f => f.category === cat);
                    const totalImportance = features.reduce((acc, f) => acc + f.importance, 0);
                    if (features.length === 0) return null;
                    return (
                      <div key={cat} className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-medium capitalize">{cat}</span>
                          <span className="font-mono text-xs text-primary">{(totalImportance * 100).toFixed(1)}%</span>
                        </div>
                        <Progress value={totalImportance * 100 * 2} className="h-2" />
                        <div className="flex flex-wrap gap-1">
                          {features.map(f => (
                            <Badge key={f.feature} variant="outline" className="text-[10px] rounded-full border-white/10">
                              {f.feature}: {(f.importance * 100).toFixed(0)}%
                            </Badge>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {featureImportance.length === 0 && (
                    <div className="text-center text-muted-foreground text-sm py-8">
                      No feature importance data available. Train a model first.
                    </div>
                  )}
                </CardContent>
              </ScrollArea>
            </Card>
          </div>
        </TabsContent>

        {/* Model Comparison Tab */}
        <TabsContent value="models" className="flex-1 min-h-0 overflow-hidden mt-4">
          {modelComparison.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-full">
              {modelComparison.map((model) => (
                <Card key={model.name} className={`glass rounded-2xl flex flex-col gradient-border ${model.status === 'training' ? 'ring-1 ring-green-500/30' : ''}`} data-testid={`model-card-${model.name.replace(/\s+/g, '-').toLowerCase()}`}>
                  <CardHeader className="border-b border-white/5">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Layers className="h-4 w-4 text-primary" />
                      {model.name}
                      <Badge variant="outline" className={`ml-auto text-[10px] rounded-full ${
                        model.status === 'training' ? 'border-green-500/50 text-green-400 bg-green-500/10' : 
                        model.status === 'active' ? 'border-primary/50 text-primary bg-primary/10' : 
                        'border-muted-foreground/30'
                      }`}>
                        {model.status === 'training' ? 'Training' : model.status === 'active' ? 'Active' : 'Done'}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 pt-4 space-y-4">
                    <div className="space-y-3">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Train Loss</span>
                        <span className="font-mono text-primary">{model.trainLoss.toFixed(4)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Val Loss</span>
                        <span className="font-mono text-accent">{model.valLoss.toFixed(4)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Gap</span>
                        <span className={`font-mono ${(model.valLoss - model.trainLoss) > 0.05 ? 'text-amber-400' : 'text-green-400'}`}>
                          {((model.valLoss - model.trainLoss) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-white/5 space-y-3">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Accuracy</span>
                        <span className="font-mono font-bold text-green-400">{(model.accuracy * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Epochs</span>
                        <span className="font-mono">{model.epochs}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Time</span>
                        <span className="font-mono">{(model.trainingTime / 1000).toFixed(1)}s</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="glass rounded-2xl flex items-center justify-center h-full">
              <CardContent className="text-center text-muted-foreground">
                <Layers className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No trained models yet. Train a model to see comparisons.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Terminal Logs */}
      <Card className="h-28 shrink-0 bg-black/60 backdrop-blur-xl border border-green-500/10 rounded-2xl font-mono text-[10px] flex flex-col overflow-hidden">
        <CardHeader className="bg-green-500/5 border-b border-green-500/10 py-1.5 px-3 flex flex-row items-center gap-2">
          <Terminal className="h-3 w-3 text-green-400" />
          <span className="text-green-400 text-[10px] font-medium">Training Logs</span>
          <Badge variant="outline" className={`ml-2 text-[8px] rounded-full ${isTraining ? 'border-green-500/50 text-green-400 animate-pulse' : 'border-muted-foreground/30'}`}>
            {isTraining ? 'TRAINING' : 'IDLE'}
          </Badge>
          <div className="ml-auto flex gap-1">
            <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500/80' : 'bg-rose-500/80'}`} />
          </div>
        </CardHeader>
        <ScrollArea className="flex-1 p-2 text-green-300/70">
          {logs.map((log, i) => (
            <p key={i} className={log.includes('ERROR') ? 'text-rose-400' : log.includes('WARN') ? 'text-amber-400' : 'text-green-300/50'}>
              {log}
            </p>
          ))}
        </ScrollArea>
      </Card>
    </div>
  );
}

export default function Training() {
  return <TrainingPanel />;
}