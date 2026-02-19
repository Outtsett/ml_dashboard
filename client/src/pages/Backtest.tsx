import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Play, RotateCcw, BarChart2, Sparkles, Target, TrendingDown, Orbit,
  TrendingUp, Calculator, Loader2, AlertCircle, CheckCircle2
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Bar, Legend, Line, ReferenceLine
} from "recharts";
import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/types";
import { apiRequest } from "@/lib/queryClient";
import { useBreadcrumbs } from "@/hooks/useBreadcrumbs";

// ============================================================
// TYPES
// ============================================================

interface BrokerConfig {
  id: number;
  name: string;
  broker: string;
  asset_type: string;
  commission_type: string;
  commission_per_side: number;
  typical_spread_pips: number;
  default_margin: number;
}

interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  totalReturn: number;
  totalReturnPct: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  avgHoldingTimeBars: number;
  avgHoldingTimeMs: number;
  expectancy: number;
  totalCommissions: number;
  totalSlippage: number;
  totalSpreadCost: number;
  calmarRatio: number;
}

interface BacktestRunResult {
  run: any;
  metrics: BacktestMetrics;
  tradeCount: number;
  equityCurvePoints: number;
  dataSummary: {
    totalBars: number;
    trainBars: number;
    testBars: number;
    signalCount: number;
  };
}

// ============================================================
// COMPONENT
// ============================================================

export default function Backtest() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("results");

  // Form state
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
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

  const tabLabels: Record<string, string> = { results: "Results", trades: "Trades", costs: "Costs" };
  useBreadcrumbs([
    { label: tabLabels[activeTab] ?? activeTab },
    ...(selectedSymbol ? [{ label: selectedSymbol }] : []),
  ]);

  // Results state
  const [lastResult, setLastResult] = useState<BacktestRunResult | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  // Data queries
  const { data: models = [] } = useQuery<{ id: number; name: string; architecture: string; symbol: string }[]>({
    queryKey: [...QUERY_KEYS.mlModels],
    queryFn: async () => { const res = await fetch("/api/ml/models"); return res.json(); },
  });

  const { data: instruments = [] } = useQuery<{ id: number; symbol: string; name: string; assetType: string }[]>({
    queryKey: ["/api/instruments"],
    queryFn: async () => { const res = await fetch("/api/instruments"); return res.json(); },
  });

  const { data: brokers = [] } = useQuery<BrokerConfig[]>({
    queryKey: ["/api/brokers"],
    queryFn: async () => { const res = await fetch("/api/brokers"); return res.json(); },
  });

  const { data: previousRuns = [] } = useQuery<any[]>({
    queryKey: ["/api/backtest/runs"],
    queryFn: async () => { const res = await fetch("/api/backtest/runs?limit=20"); return res.json(); },
  });

  // Trades for the selected run
  const { data: tradesData } = useQuery<{ trades: any[]; chartMarkers: any[]; count: number }>({
    queryKey: ["/api/backtest/trades", selectedRunId],
    queryFn: async () => {
      const res = await fetch(`/api/backtest/trades/${selectedRunId}`);
      return res.json();
    },
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
    },
  });

  const handleRun = useCallback(() => {
    if (!selectedSymbol) return;
    runBacktest.mutate();
  }, [selectedSymbol, runBacktest]);

  const handleReset = useCallback(() => {
    setLastResult(null);
    setSelectedRunId(null);
  }, []);

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

  return (
    <div className="space-y-4 h-[calc(100vh-8.5rem)] flex flex-col overflow-hidden">
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
        <div className="lg:col-span-1 space-y-3 overflow-y-auto pr-1">
          <Card className="glass rounded-2xl gradient-border">
            <CardHeader className="py-2 px-3 border-b border-white/5">
              <CardTitle className="text-xs font-medium text-primary flex items-center gap-2">
                <Sparkles className="h-3 w-3" /> Parameters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-3 text-xs">
              {/* Model Selection */}
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Model</Label>
                <Select value={selectedModel} onValueChange={setSelectedModel}>
                  <SelectTrigger className="h-8 rounded-lg bg-white/5 border-white/10 text-xs">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="momentum">Momentum (no ML)</SelectItem>
                    <SelectItem value="__last_trained__">Last Trained (in-memory)</SelectItem>
                    {models.map(m => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.name} ({m.architecture})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Instrument */}
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Instrument</Label>
                <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
                  <SelectTrigger className="h-8 rounded-lg bg-white/5 border-white/10 text-xs">
                    <SelectValue placeholder="Select instrument" />
                  </SelectTrigger>
                  <SelectContent>
                    {instruments.map(inst => (
                      <SelectItem key={inst.id} value={inst.symbol}>
                        {inst.symbol} — {inst.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Broker */}
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Broker Profile</Label>
                <Select value={selectedBroker} onValueChange={setSelectedBroker}>
                  <SelectTrigger className="h-8 rounded-lg bg-white/5 border-white/10 text-xs">
                    <SelectValue placeholder="Auto-detect" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (by asset type)</SelectItem>
                    {brokers.map(b => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.broker} — {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Timeframe */}
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Timeframe</Label>
                <Select value={timeframe} onValueChange={setTimeframe}>
                  <SelectTrigger className="h-8 rounded-lg bg-white/5 border-white/10 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['1m', '5m', '15m', '30m', '1H', '4H', '1D'].map(tf => (
                      <SelectItem key={tf} value={tf}>{tf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date Range */}
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Date Range (optional)</Label>
                <div className="grid grid-cols-2 gap-1">
                  <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="h-7 rounded-lg bg-white/5 border-white/10 text-[10px]" />
                  <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    className="h-7 rounded-lg bg-white/5 border-white/10 text-[10px]" />
                </div>
              </div>

              {/* Train/Test Split */}
              <div className="space-y-2 pt-2 border-t border-white/5">
                <Label className="text-[10px] text-muted-foreground flex justify-between">
                  <span>Train/Test Split</span>
                  <span className="font-mono text-primary">{(splitRatio * 100).toFixed(0)}% / {((1 - splitRatio) * 100).toFixed(0)}%</span>
                </Label>
                <Slider value={[splitRatio * 100]} min={50} max={95} step={5}
                  onValueChange={v => setSplitRatio(v[0] / 100)} className="py-1" />
              </div>

              {/* Capital & Position */}
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Initial Capital ($)</Label>
                <Input type="number" value={initialCapital} onChange={e => setInitialCapital(Number(e.target.value))}
                  className="h-7 rounded-lg bg-white/5 border-white/10 text-xs" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Position Size (lots/contracts)</Label>
                <Input type="number" value={positionSize} onChange={e => setPositionSize(Number(e.target.value))}
                  className="h-7 rounded-lg bg-white/5 border-white/10 text-xs" min={0.01} step={0.01} />
              </div>

              {/* Risk Management */}
              <div className="space-y-2 pt-2 border-t border-white/5">
                <Label className="text-[10px] text-muted-foreground flex justify-between">
                  <span>Stop Loss (Ticks)</span>
                  <span className="font-mono text-muted-foreground">{stopLossTicks ?? 'Off'}</span>
                </Label>
                <Slider value={[stopLossTicks ?? 0]} max={100} step={1}
                  onValueChange={v => setStopLossTicks(v[0] > 0 ? v[0] : undefined)} className="py-1" />
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] text-muted-foreground flex justify-between">
                  <span>Take Profit (Ticks)</span>
                  <span className="font-mono text-muted-foreground">{takeProfitTicks ?? 'Off'}</span>
                </Label>
                <Slider value={[takeProfitTicks ?? 0]} max={200} step={1}
                  onValueChange={v => setTakeProfitTicks(v[0] > 0 ? v[0] : undefined)} className="py-1" />
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] text-muted-foreground flex justify-between">
                  <span>Min Confidence</span>
                  <span className="font-mono text-primary">{(minConfidence * 100).toFixed(0)}%</span>
                </Label>
                <Slider value={[minConfidence * 100]} min={30} max={95} step={5}
                  onValueChange={v => setMinConfidence(v[0] / 100)} className="py-1" />
              </div>
            </CardContent>
          </Card>

          {/* Previous Runs */}
          {previousRuns.length > 0 && (
            <Card className="glass rounded-2xl gradient-border">
              <CardHeader className="py-2 px-3 border-b border-white/5">
                <CardTitle className="text-xs font-medium text-accent">Previous Runs</CardTitle>
              </CardHeader>
              <ScrollArea className="max-h-48">
                <CardContent className="space-y-1.5 pt-2">
                  {previousRuns.map((run: any) => (
                    <button key={run.id} onClick={() => handleLoadRun(run)}
                      className={`w-full text-left p-2 rounded-lg text-[10px] transition-colors ${
                        selectedRunId === run.id ? 'bg-primary/20 border border-primary/30' : 'bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-mono font-bold truncate">{run.name}</span>
                        <Badge variant="outline" className={`text-[8px] ${
                          run.status === 'completed' ? 'border-emerald-500/50 text-emerald-400' : 'border-amber-500/50 text-amber-400'
                        }`}>{run.status}</Badge>
                      </div>
                      <div className="flex gap-2 mt-0.5 text-muted-foreground">
                        <span>{run.symbol}</span>
                        <span>{run.total_trades ?? 0} trades</span>
                        {run.total_return_pct != null && (
                          <span className={run.total_return_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {run.total_return_pct >= 0 ? '+' : ''}{run.total_return_pct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </CardContent>
              </ScrollArea>
            </Card>
          )}
        </div>

        {/* Results Area */}
        <div className="lg:col-span-4 flex flex-col gap-3 min-h-0 overflow-hidden">
          {/* Metrics Row */}
          <div className="grid grid-cols-6 gap-2 shrink-0">
            <MetricBox label="Total Return" value={metrics ? `${metrics.totalReturn >= 0 ? '+' : ''}$${metrics.totalReturn.toFixed(0)}` : '--'}
              subValue={metrics ? `${metrics.totalReturnPct >= 0 ? '+' : ''}${metrics.totalReturnPct.toFixed(1)}%` : ''}
              color="emerald" />
            <MetricBox label="Max Drawdown" value={metrics ? `$${metrics.maxDrawdown.toFixed(0)}` : '--'} color="rose" />
            <MetricBox label="Sharpe" value={metrics ? metrics.sharpeRatio.toFixed(2) : '--'} color="violet" />
            <MetricBox label="Win Rate" value={metrics ? `${(metrics.winRate * 100).toFixed(1)}%` : '--'}
              subValue={metrics ? `${metrics.totalTrades} trades` : ''} color="cyan" />
            <MetricBox label="Profit Factor" value={metrics ? (metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)) : '--'} color="amber" />
            <MetricBox label="Expectancy" value={metrics ? `$${metrics.expectancy.toFixed(2)}` : '--'} color="fuchsia" />
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
            <TabsList className="glass rounded-xl p-1 h-auto shrink-0 w-fit">
              <TabsTrigger value="results" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-primary/20">
                <BarChart2 className="h-3 w-3 mr-1.5" /> Results
              </TabsTrigger>
              <TabsTrigger value="trades" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-primary/20">
                <Target className="h-3 w-3 mr-1.5" /> Trades {trades.length > 0 && `(${trades.length})`}
              </TabsTrigger>
              <TabsTrigger value="costs" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-primary/20">
                <Calculator className="h-3 w-3 mr-1.5" /> Costs
              </TabsTrigger>
            </TabsList>

            {/* Results Tab */}
            <TabsContent value="results" className="flex-1 min-h-0 overflow-hidden mt-3">
              <div className="grid grid-cols-3 gap-3 h-full">
                <Card className="col-span-2 glass rounded-2xl flex flex-col gradient-border">
                  <CardHeader className="py-2 px-4 border-b border-white/5">
                    <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                      <BarChart2 className="h-3 w-3 text-accent" /> Equity Curve
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 min-h-0 p-2">
                    {equityCurveData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={equityCurveData}>
                          <defs>
                            <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(185, 70%, 55%)" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="hsl(185, 70%, 55%)" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                          <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={9} interval="preserveStartEnd" />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} domain={['auto', 'auto']}
                            tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                          <Tooltip contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px', fontSize: '11px' }}
                            formatter={(v: number) => [`$${v.toFixed(2)}`, 'Equity']} />
                          <ReferenceLine y={initialCapital} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.5} />
                          <Area type="monotone" dataKey="equity" stroke="hsl(185, 70%, 55%)" strokeWidth={2} fill="url(#colorEquity)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                        {runBacktest.isPending ? (
                          <div className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Computing backtest...</div>
                        ) : (
                          'Run a backtest to see the equity curve'
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="glass rounded-2xl flex flex-col gradient-border">
                  <CardHeader className="py-2 px-4 border-b border-white/5">
                    <CardTitle className="text-xs font-medium text-muted-foreground">Performance Stats</CardTitle>
                  </CardHeader>
                  <ScrollArea className="flex-1">
                    {metrics ? (
                      <CardContent className="space-y-2 pt-3 text-xs">
                        <StatRow label="Sortino" value={metrics.sortinoRatio.toFixed(2)} />
                        <StatRow label="Calmar" value={metrics.calmarRatio.toFixed(2)} />
                        <StatRow label="Profit Factor" value={metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)} />
                        <StatRow label="Expectancy" value={`$${metrics.expectancy.toFixed(2)}`} />
                        <div className="border-t border-white/5 pt-2" />
                        <StatRow label="Avg Win" value={`$${metrics.avgWin.toFixed(2)}`} positive />
                        <StatRow label="Avg Loss" value={`$${metrics.avgLoss.toFixed(2)}`} negative />
                        <StatRow label="Largest Win" value={`$${metrics.largestWin.toFixed(2)}`} positive />
                        <StatRow label="Largest Loss" value={`$${metrics.largestLoss.toFixed(2)}`} negative />
                        <div className="border-t border-white/5 pt-2" />
                        <StatRow label="Win/Loss" value={`${metrics.winningTrades ?? '?'}/${metrics.losingTrades ?? '?'}`} />
                        <StatRow label="Avg Hold" value={`${metrics.avgHoldingTimeBars?.toFixed(0) ?? '?'} bars`} />
                        <StatRow label="Commissions" value={`$${metrics.totalCommissions.toFixed(2)}`} />
                        <StatRow label="Slippage" value={`$${metrics.totalSlippage.toFixed(2)}`} />
                        <StatRow label="Spread Cost" value={`$${metrics.totalSpreadCost.toFixed(2)}`} />
                      </CardContent>
                    ) : (
                      <CardContent className="h-full flex items-center justify-center text-sm text-muted-foreground p-6">
                        Configure parameters and click Execute
                      </CardContent>
                    )}
                  </ScrollArea>
                </Card>
              </div>
            </TabsContent>

            {/* Trades Tab */}
            <TabsContent value="trades" className="flex-1 min-h-0 overflow-hidden mt-3">
              <Card className="h-full glass rounded-2xl flex flex-col gradient-border">
                <CardHeader className="py-2 px-4 border-b border-white/5 shrink-0">
                  <CardTitle className="text-xs font-medium text-muted-foreground">
                    Trade-by-Trade Breakdown ({trades.length} trades)
                  </CardTitle>
                </CardHeader>
                <ScrollArea className="flex-1">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background/80 backdrop-blur-sm">
                      <tr className="border-b border-white/5 text-muted-foreground">
                        <th className="text-left py-2 px-3 font-medium">Entry</th>
                        <th className="text-left py-2 px-3 font-medium">Exit</th>
                        <th className="text-left py-2 px-3 font-medium">Dir</th>
                        <th className="text-right py-2 px-3 font-medium">Entry $</th>
                        <th className="text-right py-2 px-3 font-medium">Exit $</th>
                        <th className="text-right py-2 px-3 font-medium">Gross P&L</th>
                        <th className="text-right py-2 px-3 font-medium">Costs</th>
                        <th className="text-right py-2 px-3 font-medium">Net P&L</th>
                        <th className="text-left py-2 px-3 font-medium">Reason</th>
                        <th className="text-right py-2 px-3 font-medium">Bars</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map((trade: any, idx: number) => {
                        const netPnl = trade.net_pnl ?? 0;
                        const grossPnl = trade.pnl ?? 0;
                        const costs = (trade.commission ?? 0) + (trade.slippage ?? 0) + (trade.spread_cost ?? 0);
                        return (
                          <tr key={trade.id || idx} className="border-b border-white/5 hover:bg-white/5">
                            <td className="py-2 px-3 font-mono text-muted-foreground text-[10px]">
                              {new Date(Number(trade.entry_timestamp)).toLocaleString()}
                            </td>
                            <td className="py-2 px-3 font-mono text-muted-foreground text-[10px]">
                              {trade.exit_timestamp ? new Date(Number(trade.exit_timestamp)).toLocaleString() : '—'}
                            </td>
                            <td className="py-2 px-3">
                              <Badge variant="outline" className={`text-[9px] rounded-full ${
                                trade.side === 'long' ? 'border-green-500/50 text-green-400' : 'border-rose-500/50 text-rose-400'
                              }`}>
                                {trade.side === 'long' ? <TrendingUp className="h-2 w-2 mr-0.5" /> : <TrendingDown className="h-2 w-2 mr-0.5" />}
                                {trade.side}
                              </Badge>
                            </td>
                            <td className="py-2 px-3 text-right font-mono">{trade.entry_price?.toFixed(4)}</td>
                            <td className="py-2 px-3 text-right font-mono">{trade.exit_price?.toFixed(4) ?? '—'}</td>
                            <td className={`py-2 px-3 text-right font-mono ${grossPnl >= 0 ? 'text-green-400' : 'text-rose-400'}`}>
                              {grossPnl >= 0 ? '+' : ''}${grossPnl.toFixed(2)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-amber-400">
                              -${costs.toFixed(2)}
                            </td>
                            <td className={`py-2 px-3 text-right font-mono font-bold ${netPnl >= 0 ? 'text-green-400' : 'text-rose-400'}`}>
                              {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
                            </td>
                            <td className="py-2 px-3 text-[10px] text-muted-foreground">{trade.exit_reason}</td>
                            <td className="py-2 px-3 text-right font-mono text-muted-foreground">{trade.bars_held}</td>
                          </tr>
                        );
                      })}
                      {trades.length === 0 && (
                        <tr>
                          <td colSpan={10} className="py-8 text-center text-muted-foreground">
                            {runBacktest.isPending ? 'Computing...' : 'No trades to display. Run a backtest first.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </ScrollArea>
              </Card>
            </TabsContent>

            {/* Costs Tab */}
            <TabsContent value="costs" className="flex-1 min-h-0 overflow-hidden mt-3">
              <div className="grid grid-cols-2 gap-3 h-full">
                <Card className="glass rounded-2xl flex flex-col gradient-border">
                  <CardHeader className="py-2 px-4 border-b border-white/5">
                    <CardTitle className="text-xs font-medium text-muted-foreground">P&L Distribution</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 min-h-0 p-2">
                    {trades.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={trades.map((t: any, i: number) => ({
                          trade: i + 1,
                          netPnl: t.net_pnl ?? 0,
                          runningPnl: t.running_pnl ?? 0,
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                          <XAxis dataKey="trade" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                          <Tooltip contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px', fontSize: '11px' }} />
                          <Legend wrapperStyle={{ fontSize: '10px' }} />
                          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                          <Bar dataKey="netPnl" name="Trade P&L" fill="hsl(var(--primary))" />
                          <Line type="monotone" dataKey="runningPnl" name="Cumulative" stroke="hsl(185, 70%, 55%)" strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                        Run a backtest to see P&L distribution
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="glass rounded-2xl flex flex-col gradient-border">
                  <CardHeader className="py-2 px-4 border-b border-white/5">
                    <CardTitle className="text-xs font-medium text-muted-foreground">Cost Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-3">
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                      <p className="text-muted-foreground text-[10px] mb-1">Total Commissions</p>
                      <p className="font-mono text-xl font-bold text-amber-400">
                        {metrics ? `$${metrics.totalCommissions.toFixed(2)}` : '--'}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                      <p className="text-muted-foreground text-[10px] mb-1">Total Slippage</p>
                      <p className="font-mono text-xl font-bold text-primary">
                        {metrics ? `$${metrics.totalSlippage.toFixed(2)}` : '--'}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-500/20">
                      <p className="text-muted-foreground text-[10px] mb-1">Total Spread Cost</p>
                      <p className="font-mono text-xl font-bold text-violet-400">
                        {metrics ? `$${metrics.totalSpreadCost.toFixed(2)}` : '--'}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                      <p className="text-muted-foreground text-[10px] mb-1">Total Cost Impact</p>
                      <p className="font-mono text-xl font-bold text-rose-400">
                        {metrics ? `$${(metrics.totalCommissions + metrics.totalSlippage + metrics.totalSpreadCost).toFixed(2)}` : '--'}
                      </p>
                      {metrics && metrics.totalReturn !== 0 && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {((metrics.totalCommissions + metrics.totalSlippage + metrics.totalSpreadCost) / Math.abs(metrics.totalReturn) * 100).toFixed(1)}% of gross P&L
                        </p>
                      )}
                    </div>
                    {lastResult?.run?.broker_label && (
                      <div className="pt-2 border-t border-white/5 space-y-2 text-xs">
                        <StatRow label="Broker" value={lastResult.run.broker_label} />
                        <StatRow label="Profile" value={lastResult.run.broker_name} />
                        {metrics && (
                          <StatRow label="Cost/Trade" value={`$${((metrics.totalCommissions + metrics.totalSlippage + metrics.totalSpreadCost) / Math.max(metrics.totalTrades, 1)).toFixed(2)}`} />
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function MetricBox({ label, value, subValue, color }: { label: string; value: string; subValue?: string; color: string }) {
  const colorMap: Record<string, { bg: string; label: string; text: string }> = {
    emerald: { bg: 'from-emerald-500/10 to-emerald-600/5 border-emerald-500/20', label: 'text-emerald-300/70', text: 'text-emerald-300' },
    rose: { bg: 'from-rose-500/10 to-rose-600/5 border-rose-500/20', label: 'text-rose-300/70', text: 'text-rose-300' },
    violet: { bg: 'from-violet-500/10 to-violet-600/5 border-violet-500/20', label: 'text-violet-300/70', text: 'text-violet-300' },
    cyan: { bg: 'from-cyan-500/10 to-cyan-600/5 border-cyan-500/20', label: 'text-cyan-300/70', text: 'text-cyan-300' },
    amber: { bg: 'from-amber-500/10 to-amber-600/5 border-amber-500/20', label: 'text-amber-300/70', text: 'text-amber-300' },
    fuchsia: { bg: 'from-fuchsia-500/10 to-fuchsia-600/5 border-fuchsia-500/20', label: 'text-fuchsia-300/70', text: 'text-fuchsia-300' },
  };
  const c = colorMap[color] ?? colorMap.emerald;

  return (
    <div className={`bg-gradient-to-br ${c.bg} rounded-xl p-3 border`}>
      <div className={`text-[10px] ${c.label} uppercase tracking-wider mb-1`}>{label}</div>
      <div className={`text-2xl font-bold ${c.text}`}>{value}</div>
      {subValue && <div className="text-[10px] text-muted-foreground mt-0.5">{subValue}</div>}
    </div>
  );
}

function StatRow({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${positive ? 'text-green-400' : negative ? 'text-rose-400' : ''}`}>{value}</span>
    </div>
  );
}
