import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Play, RotateCcw, BarChart2, Target, Orbit, Zap,
  Calculator, Loader2, AlertCircle, CheckCircle2, LineChart as LineChartIcon,
  Shuffle, Dice5, TrendingUp,
} from "lucide-react";
import { QUERY_KEYS } from "@/lib/types";
import { apiRequest } from "@/lib/query_client";
import { fetchArray } from "@/lib/fetch_array";
import { backtestApi } from "@/lib/api_service";
import { useDashboard, useSymbol, type TradeMarker } from "@/contexts/UnifiedDashboardContext";
import type { BrokerConfig, BacktestRunResult, WalkForwardResult, MonteCarloResult, BenchmarkResult } from "./types";
import { StatCard } from "@/components/ui/stat-card";
import { ConfigPanel } from "./ConfigPanel";
import { ResultsTab } from "./ResultsTab";
import { TradesTab } from "./TradesTab";
import { CostsTab } from "./CostsTab";
import { WalkForwardTab } from "./WalkForwardTab";
import { MonteCarloTab } from "./MonteCarloTab";
import { BenchmarkTab } from "./BenchmarkTab";

/** Embeddable backtest panel – used both standalone and inside MLHub's Backtest tab */     
export function BacktestPanel() {
  const queryClient = useQueryClient();
  const dashboard = useDashboard();
  const { symbol: selectedSymbol, setSymbol: setSelectedSymbol } = useSymbol();
  const [activeTab, setActiveTab] = useState("results");

  // Form state
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedBroker, setSelectedBroker] = useState<string>("");
  const [timeframe, setTimeframe] = useState("1m");
  const [splitRatio, setSplitRatio] = useState(0.8);
  const [initialCapital, setInitialCapital] = useState(10000);
  const [positionSize, setPositionSize] = useState(1);
  const [stopLossTicks, setStopLossTicks] = useState<number | undefined>(undefined);
  const [takeProfitTicks, setTakeProfitTicks] = useState<number | undefined>(undefined);      
  const [minConfidence, setMinConfidence] = useState(0.5);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Results state
  const [lastResult, setLastResult] = useState<BacktestRunResult | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [walkForwardResult, setWalkForwardResult] = useState<WalkForwardResult | null>(null); 
  const [monteCarloResult, setMonteCarloResult] = useState<MonteCarloResult | null>(null);    
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkResult | null>(null);       

  // Data queries
  const { data: models = [] } = useQuery<{ id: number; name: string; architecture: string; symbol: string }[]>({
    queryKey: [...QUERY_KEYS.mlModels],
    queryFn: () => fetchArray("/api/ml/models"),
  });

  const { data: instruments = [] } = useQuery<{ id: number; symbol: string; name: string; assetType: string }[]>({
    queryKey: ["/api/instruments"],
    queryFn: () => fetchArray("/api/instruments"),
  });

  const { data: brokers = [] } = useQuery<BrokerConfig[]>({
    queryKey: ["/api/brokers"],
    queryFn: () => fetchArray<BrokerConfig>("/api/brokers"),
  });

  const { data: previousRuns = [] } = useQuery<any[]>({
    queryKey: ["/api/backtest/runs"],
    queryFn: () => fetchArray("/api/backtest/runs?limit=20"),
  });

  // Trades for the selected run
  const { data: tradesData } = useQuery<{ trades: any[]; chartMarkers: any[]; count: number }>({
    queryKey: ["/api/backtest/trades", selectedRunId],
    queryFn: () => backtestApi.getTradesForRun(selectedRunId!) as Promise<{ trades: any[]; chartMarkers: any[]; count: number }>,
    enabled: !!selectedRunId,
  });

  // Run backtest mutation
  const runBacktest = useMutation({
    mutationFn: async () => {
      const body: any = {
        symbol: selectedSymbol,
        timeframe,
        splitRatio,
        initialCapital,
        positionSize,
        minConfidence,
      };

      if (selectedModel === '__last_trained__') {
        body.useLastTrained = true;
      } else if (selectedModel && selectedModel !== 'momentum') {
        body.modelId = parseInt(selectedModel);
      }

      if (selectedBroker) body.brokerConfigId = parseInt(selectedBroker);
      if (stopLossTicks) body.stopLossTicks = stopLossTicks;
      if (takeProfitTicks) body.takeProfitTicks = takeProfitTicks;
      if (startDate) body.start = startDate;
      if (endDate) body.end = endDate;

      const res = await apiRequest("POST", "/api/backtest/run", body);
      return res.json();
    },
    onSuccess: (data: BacktestRunResult) => {
      setLastResult(data);
      setSelectedRunId(data.run.id);
      queryClient.invalidateQueries({ queryKey: ["/api/backtest/runs"] });
      toast.success("Backtest complete", { description: `${data.metrics.totalTrades} trades, ${data.metrics.winRate.toFixed(1)}% win rate` });
      dashboard.addLog({ level: 'success', source: 'backtest', message: `Backtest completed: ${data.metrics.totalTrades} trades, ${data.metrics.winRate.toFixed(1)}% win rate` });
    },
  });

  const handleRun = useCallback(() => {
    if (!selectedSymbol) return;
    runBacktest.mutate();
  }, [selectedSymbol, runBacktest]);

  // Analysis mutations
  const runMonteCarloMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/backtest/monte-carlo", {
        backtestRunId: selectedRunId,
        numSimulations: 1000,
        confidenceLevels: [0.05, 0.25, 0.50, 0.75, 0.95],
      });
      return res.json();
    },
    onSuccess: (data) => {
      setMonteCarloResult(data);
      setActiveTab("montecarlo");
    },
  });

  const runWalkForwardMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/backtest/walk-forward", {
        backtestRunId: selectedRunId,
        trainMonths: 6,
        testMonths: 2,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setWalkForwardResult(data);
      setActiveTab("walkforward");
    },
  });

  const runBenchmarkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/backtest/benchmark", {
        backtestRunId: selectedRunId,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setBenchmarkResult(data);
      setActiveTab("benchmark");
    },
  });

  const handleReset = useCallback(() => {
    setLastResult(null);
    setSelectedRunId(null);
    setWalkForwardResult(null);
    setMonteCarloResult(null);
    setBenchmarkResult(null);
    dashboard.clearTradeMarkers('backtest');
  }, [dashboard]);

  const handleLoadRun = useCallback((run: any) => {
    setSelectedRunId(run.id);
    setLastResult({
      run,
      metrics: {
        totalTrades: run.total_trades ?? 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: run.win_rate ?? 0,
        profitFactor: run.profit_factor ?? 0,
        sharpeRatio: run.sharpe_ratio ?? 0,
        sortinoRatio: run.sortino_ratio ?? 0,
        maxDrawdown: run.max_drawdown ?? 0,
        maxDrawdownPct: 0,
        totalReturn: run.total_return ?? 0,
        totalReturnPct: run.total_return_pct ?? 0,
        avgWin: run.avg_win ?? 0,
        avgLoss: run.avg_loss ?? 0,
        largestWin: run.largest_win ?? 0,
        largestLoss: run.largest_loss ?? 0,
        avgHoldingTimeBars: 0,
        avgHoldingTimeMs: run.avg_holding_time_ms ?? 0,
        expectancy: run.expectancy ?? 0,
        totalCommissions: run.total_commissions ?? 0,
        totalSlippage: run.total_slippage ?? 0,
        totalSpreadCost: 0,
        calmarRatio: 0,
      },
      tradeCount: run.total_trades ?? 0,
      equityCurvePoints: 0,
      dataSummary: { totalBars: 0, trainBars: 0, testBars: 0, signalCount: 0 },
    });
    setActiveTab("results");
  }, []);

  // Parse equity curve from run data
  const equityCurveData = (() => {
    try {
      const curve = lastResult?.run?.equity_curve;
      if (!curve) return [];
      const parsed = typeof curve === 'string' ? JSON.parse(curve) : curve;
      return parsed.map((pt: any) => ({
        time: new Date(pt.timestamp).toLocaleDateString(),
        equity: pt.equity,
      }));
    } catch {
      return [];
    }
  })();

  const metrics = lastResult?.metrics;
  const trades = tradesData?.trades ?? [];

  // Push backtest trades as chart overlays when they load
  useEffect(() => {
    if (!tradesData?.chartMarkers?.length) return;
    const markers: TradeMarker[] = tradesData.chartMarkers.map((m: any, i: number) => ({      
      id: `bt-${selectedRunId}-${i}`,
      timestamp: m.timestamp,
      type: m.type as 'entry' | 'exit',
      side: m.side as 'long' | 'short',
      price: m.price,
      label: m.label,
      pnl: m.pnl,
      source: 'backtest' as const,
    }));
    dashboard.clearTradeMarkers('backtest');
    dashboard.addTradeMarkers(markers);
  }, [tradesData, selectedRunId]);

  return (
    <div className="space-y-4 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500/30 to-rose-500/30 flex items-center justify-center">
              <Orbit className="h-5 w-5 text-amber-300" />
            </div>
            {lastResult && (
              <Badge variant="outline" className="text-[10px] border-emerald-500/50 text-emerald-400">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Completed
              </Badge>
            )}
          </div>
          <h1 className="text-4xl font-display font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">Backtesting</h1>
        </div>
        <div className="flex gap-3">
          {lastResult && (tradesData?.chartMarkers?.length ?? 0) > 0 && (
            <Button variant="outline" onClick={() => dashboard.navigateToChart()}
              className="h-10 px-4 rounded-xl bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
            >
              <LineChartIcon className="mr-2 h-4 w-4" /> Show on Chart
            </Button>
          )}
          <Button variant="outline" onClick={handleReset}
            className="h-10 px-4 rounded-xl bg-black/30 border-white/10"
          >
            <RotateCcw className="mr-2 h-4 w-4" /> Reset
          </Button>
          <Button
            onClick={handleRun}
            disabled={!selectedSymbol || runBacktest.isPending}
            className="h-10 px-5 rounded-xl bg-gradient-to-r from-amber-600 to-rose-600 text-white font-medium disabled:opacity-50"
          >
            {runBacktest.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running...</>
            ) : (
              <><Play className="mr-2 h-4 w-4" /> Execute</>
            )}
          </Button>
        </div>
      </div>

      {runBacktest.isError && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex items-center gap-2 text-sm text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {(runBacktest.error as Error)?.message || 'Backtest failed'}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 flex-1 min-h-0 overflow-hidden">  
        {/* Configuration Sidebar */}
        <ConfigPanel
          selectedModel={selectedModel} onModelChange={setSelectedModel}
          selectedSymbol={selectedSymbol} onSymbolChange={setSelectedSymbol}
          selectedBroker={selectedBroker} onBrokerChange={setSelectedBroker}
          timeframe={timeframe} onTimeframeChange={setTimeframe}
          startDate={startDate} onStartDateChange={setStartDate}
          endDate={endDate} onEndDateChange={setEndDate}
          splitRatio={splitRatio} onSplitRatioChange={setSplitRatio}
          initialCapital={initialCapital} onInitialCapitalChange={setInitialCapital}
          positionSize={positionSize} onPositionSizeChange={setPositionSize}
          stopLossTicks={stopLossTicks} onStopLossTicksChange={setStopLossTicks}
          takeProfitTicks={takeProfitTicks} onTakeProfitTicksChange={setTakeProfitTicks}      
          minConfidence={minConfidence} onMinConfidenceChange={setMinConfidence}
          models={models} instruments={instruments} brokers={brokers}
          previousRuns={previousRuns} selectedRunId={selectedRunId} onLoadRun={handleLoadRun} 
        />

        {/* Results Area */}
        <div className="lg:col-span-4 flex flex-col gap-3 min-h-0 overflow-hidden">
          {/* Metrics Row */}
          <div className="grid grid-cols-6 gap-2 shrink-0">
            <StatCard label="Total Return" value={metrics ? `${metrics.totalReturn >= 0 ? "+" : ""}$${metrics.totalReturn.toFixed(0)}` : "--"} subValue={metrics ? `${metrics.totalReturnPct >= 0 ? "+" : ""}${metrics.totalReturnPct.toFixed(1)}%` : ""} color="emerald" icon={TrendingUp} />
            <StatCard label="Max Drawdown" value={metrics ? `$${metrics.maxDrawdown.toFixed(0)}` : "--"} color="rose" icon={Target} />
            <StatCard label="Sharpe" value={metrics ? metrics.sharpeRatio.toFixed(2) : "--"} color="violet" icon={BarChart2} />
            <StatCard label="Win Rate" value={metrics ? `${(metrics.winRate * 100).toFixed(1)}%` : "--"} subValue={metrics ? `${metrics.totalTrades} trades` : ""} color="cyan" icon={Zap} />
            <StatCard label="Profit Factor" value={metrics ? (metrics.profitFactor === Infinity ? "∞" : metrics.profitFactor.toFixed(2)) : "--"} color="amber" icon={Calculator} />
            <StatCard label="Expectancy" value={metrics ? `$${metrics.expectancy.toFixed(2)}` : "--"} color="fuchsia" icon={Orbit} />
          </div>

          {/* Data Summary */}
          {lastResult?.dataSummary && lastResult.dataSummary.totalBars > 0 && (
            <div className="flex gap-4 text-[10px] text-muted-foreground shrink-0 px-1">      
              <span>Total bars: <span className="font-mono text-foreground">{lastResult.dataSummary.totalBars.toLocaleString()}</span></span>
              <span>Train: <span className="font-mono text-primary">{lastResult.dataSummary.trainBars.toLocaleString()}</span></span>
              <span>Test: <span className="font-mono text-accent">{lastResult.dataSummary.testBars.toLocaleString()}</span></span>
              <span>Signals: <span className="font-mono text-foreground">{lastResult.dataSummary.signalCount.toLocaleString()}</span></span>
              {lastResult.run?.broker_label && (
                <span>Broker: <span className="font-mono text-amber-400">{lastResult.run.broker_label}</span></span>
              )}
            </div>
          )}

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex items-center justify-between shrink-0 gap-2">
              <TabsList className="glass rounded-xl p-1 h-auto w-fit">
                <TabsTrigger value="results" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-primary/20">
                  <BarChart2 className="h-3 w-3 mr-1.5" /> Results
                </TabsTrigger>
                <TabsTrigger value="trades" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-primary/20">
                  <Target className="h-3 w-3 mr-1.5" /> Trades {trades.length > 0 && `(${trades.length})`}
                </TabsTrigger>
                <TabsTrigger value="costs" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-primary/20">
                  <Calculator className="h-3 w-3 mr-1.5" /> Costs
                </TabsTrigger>
                <TabsTrigger value="walkforward" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-primary/20">
                  <Shuffle className="h-3 w-3 mr-1.5" /> Walk-Forward
                </TabsTrigger>
                <TabsTrigger value="montecarlo" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-primary/20">
                  <Dice5 className="h-3 w-3 mr-1.5" /> Monte Carlo
                </TabsTrigger>
                <TabsTrigger value="benchmark" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-primary/20">
                  <TrendingUp className="h-3 w-3 mr-1.5" /> Benchmark
                </TabsTrigger>
              </TabsList>

              {selectedRunId && lastResult && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => runWalkForwardMutation.mutate()}
                    disabled={runWalkForwardMutation.isPending}
                    className="h-7 px-3 rounded-lg text-[10px] bg-black/30 border-white/10 hover:bg-white/10">
                    {runWalkForwardMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Shuffle className="h-3 w-3 mr-1" />}
                    Walk-Forward
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => runMonteCarloMutation.mutate()}
                    disabled={runMonteCarloMutation.isPending}
                    className="h-7 px-3 rounded-lg text-[10px] bg-black/30 border-white/10 hover:bg-white/10">
                    {runMonteCarloMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Dice5 className="h-3 w-3 mr-1" />}
                    Monte Carlo
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => runBenchmarkMutation.mutate()}
                    disabled={runBenchmarkMutation.isPending}
                    className="h-7 px-3 rounded-lg text-[10px] bg-black/30 border-white/10 hover:bg-white/10">
                    {runBenchmarkMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <TrendingUp className="h-3 w-3 mr-1" />}
                    Benchmark
                  </Button>
                </div>
              )}
            </div>

            <TabsContent value="results" className="flex-1 min-h-0 overflow-hidden mt-3">     
              <ResultsTab
                equityCurveData={equityCurveData}
                metrics={metrics}
                initialCapital={initialCapital}
                isPending={runBacktest.isPending}
              />
            </TabsContent>

            <TabsContent value="trades" className="flex-1 min-h-0 overflow-hidden mt-3">
              <TradesTab trades={trades} isPending={runBacktest.isPending} />
            </TabsContent>

            <TabsContent value="costs" className="flex-1 min-h-0 overflow-hidden mt-3">       
              <CostsTab trades={trades} metrics={metrics} lastResult={lastResult} />
            </TabsContent>

            <TabsContent value="walkforward" className="flex-1 min-h-0 overflow-hidden mt-3"> 
              <WalkForwardTab result={walkForwardResult} isPending={runWalkForwardMutation.isPending} />
            </TabsContent>

            <TabsContent value="montecarlo" className="flex-1 min-h-0 overflow-hidden mt-3">  
              <MonteCarloTab result={monteCarloResult} isPending={runMonteCarloMutation.isPending} />
            </TabsContent>

            <TabsContent value="benchmark" className="flex-1 min-h-0 overflow-hidden mt-3">   
              <BenchmarkTab result={benchmarkResult} isPending={runBenchmarkMutation.isPending} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

export default function Backtest() {
  return <BacktestPanel />;
}

