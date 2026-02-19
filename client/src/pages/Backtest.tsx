import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Play, RotateCcw, BarChart2, Sparkles, Target, TrendingDown, Orbit, 
  TrendingUp, ArrowUpRight, ArrowDownRight, Shuffle, Layers, DollarSign, Calculator
} from "lucide-react";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, Legend, ComposedChart, Bar, ReferenceLine, ScatterChart, Scatter
} from "recharts";
import NotImplemented from "@/components/NotImplemented";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/types";

type WalkForwardFold = { fold: number; trainStart: string; trainEnd: string; testStart: string; testEnd: string; trainSharpe: number; testSharpe: number; overfit: boolean };
type TradeBreakdownEntry = { id: number; entryTime: string; exitTime: string; symbol: string; direction: string; entry: number; exit: number; pnl: number; slippage: number; commission: number; netPnl: number };
type PerformanceMetrics = { totalReturn: number; cagr: number; sharpe: number; sortino: number; calmar: number; maxDrawdown: number; avgDrawdown: number; winRate: number; profitFactor: number; avgWin: number; avgLoss: number; largestWin: number; largestLoss: number; totalTrades: number; avgTradesPerDay: number; avgHoldingTime: string; expectancy: number };
type SlippageEntry = { day: number; slippage: number; commission: number; netImpact: number };
type MonteCarloStats = { median: number; percentile5: number; percentile95: number; maxDrawdownMean: number; maxDrawdownWorst: number; winRateMean: number; profitFactorMean: number };

export default function Backtest() {
  const [activeTab, setActiveTab] = useState("results");
  const [slippageModel, setSlippageModel] = useState(true);
  const [mcEnabled, setMcEnabled] = useState(false);
  const [wfEnabled, setWfEnabled] = useState(true);

  const { data: models = [] } = useQuery<{ id: number; name: string; architecture: string }[]>({
    queryKey: [...QUERY_KEYS.mlModels],
    queryFn: async () => { const res = await fetch("/api/ml/models"); return res.json(); },
  });

  const { data: instruments = [] } = useQuery<{ id: number; symbol: string; name: string; assetType: string }[]>({
    queryKey: ["/api/instruments"],
    queryFn: async () => { const res = await fetch("/api/instruments"); return res.json(); },
  });

  const [walkForwardData] = useState<WalkForwardFold[]>([]);
  const [monteCarloData] = useState<{ time: number; [key: string]: number }[]>([]);
  const [monteCarloStats] = useState<MonteCarloStats | null>(null);
  const [tradeBreakdown] = useState<TradeBreakdownEntry[]>([]);
  const [performanceMetrics] = useState<PerformanceMetrics | null>(null);
  const [slippageData] = useState<SlippageEntry[]>([]);
  const [equityData] = useState<{ date: string; equity: number }[]>([]);

  return (
    <div className="space-y-4 h-[calc(100vh-6rem)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500/30 to-rose-500/30 flex items-center justify-center">
              <Orbit className="h-5 w-5 text-amber-300" />
            </div>
            <span className="text-sm font-medium text-amber-300/80">Strategy Testing (Not Implemented)</span>
          </div>
          <h1 className="text-4xl font-display font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">Backtesting</h1>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" disabled className="h-10 px-4 rounded-xl bg-black/30 border-white/10 opacity-50 cursor-not-allowed" data-testid="button-reset">
            <RotateCcw className="mr-2 h-4 w-4" /> Reset
          </Button>
          <Button disabled className="h-10 px-5 rounded-xl bg-gradient-to-r from-amber-600 to-rose-600 text-white opacity-50 cursor-not-allowed font-medium" data-testid="button-run">
            <Play className="mr-2 h-4 w-4" /> Execute
          </Button>
        </div>
      </div>

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
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Model</Label>
                <Select defaultValue={models[0]?.name || ""}>
                  <SelectTrigger className="h-8 rounded-lg bg-white/5 border-white/10 text-xs">
                    <SelectValue placeholder={models.length === 0 ? "No models" : "Select model"} />
                  </SelectTrigger>
                  <SelectContent>
                    {models.length === 0 ? (
                      <SelectItem value="none" disabled>No trained models</SelectItem>
                    ) : models.map(m => (
                      <SelectItem key={m.id} value={m.name}>{m.name} ({m.architecture})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Instrument</Label>
                <Select defaultValue={instruments[0]?.symbol || ""}>
                  <SelectTrigger className="h-8 rounded-lg bg-white/5 border-white/10 text-xs">
                    <SelectValue placeholder={instruments.length === 0 ? "No instruments" : "Select instrument"} />
                  </SelectTrigger>
                  <SelectContent>
                    {instruments.length === 0 ? (
                      <SelectItem value="none" disabled>No instruments</SelectItem>
                    ) : instruments.slice(0, 10).map(inst => (
                      <SelectItem key={inst.id} value={inst.symbol}>{inst.symbol} ({inst.name})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Date Range</Label>
                <div className="grid grid-cols-2 gap-1">
                  <Input type="date" className="h-7 rounded-lg bg-white/5 border-white/10 text-[10px]" placeholder="Start" />
                  <Input type="date" className="h-7 rounded-lg bg-white/5 border-white/10 text-[10px]" placeholder="End" />
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-white/5">
                <Label className="text-[10px] text-muted-foreground flex justify-between">
                  <span>Risk / Trade</span>
                  <span className="font-mono text-muted-foreground">--%</span>
                </Label>
                <Slider defaultValue={[0]} max={10} step={0.1} className="py-1" disabled />
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] text-muted-foreground flex justify-between">
                  <span>Stop Loss (Ticks)</span>
                  <span className="font-mono text-muted-foreground">--</span>
                </Label>
                <Slider defaultValue={[0]} max={50} step={1} className="py-1" disabled />
              </div>
            </CardContent>
          </Card>

          <Card className="glass rounded-2xl gradient-border">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-xs font-medium text-accent">Advanced</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-1">
              <label className="flex items-center justify-between p-2 rounded-lg bg-white/5 cursor-pointer text-xs">
                <span>Walk-Forward</span>
                <input type="checkbox" className="accent-primary w-3.5 h-3.5" checked={wfEnabled} onChange={e => setWfEnabled(e.target.checked)} data-testid="checkbox-walkforward" />
              </label>
              <label className="flex items-center justify-between p-2 rounded-lg bg-white/5 cursor-pointer text-xs">
                <span>Monte Carlo</span>
                <input type="checkbox" className="accent-primary w-3.5 h-3.5" checked={mcEnabled} onChange={e => setMcEnabled(e.target.checked)} data-testid="checkbox-montecarlo" />
              </label>
              <label className="flex items-center justify-between p-2 rounded-lg bg-white/5 cursor-pointer text-xs">
                <span>Slippage Model</span>
                <input type="checkbox" className="accent-primary w-3.5 h-3.5" checked={slippageModel} onChange={e => setSlippageModel(e.target.checked)} data-testid="checkbox-slippage" />
              </label>
            </CardContent>
          </Card>
        </div>

        {/* Results Area */}
        <div className="lg:col-span-4 flex flex-col gap-3 min-h-0 overflow-hidden">
          {/* Metrics Row */}
          <div className="grid grid-cols-6 gap-2 shrink-0">
            <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 rounded-xl p-3 border border-emerald-500/20">
              <div className="text-[10px] text-emerald-300/70 uppercase tracking-wider mb-1">Total Return</div>
              <div className="text-2xl font-bold text-emerald-300">{performanceMetrics ? `+${performanceMetrics.totalReturn}%` : '--'}</div>
            </div>
            <div className="bg-gradient-to-br from-rose-500/10 to-rose-600/5 rounded-xl p-3 border border-rose-500/20">
              <div className="text-[10px] text-rose-300/70 uppercase tracking-wider mb-1">Max Drawdown</div>
              <div className="text-2xl font-bold text-rose-300">{performanceMetrics ? `${performanceMetrics.maxDrawdown}%` : '--'}</div>
            </div>
            <div className="bg-gradient-to-br from-violet-500/10 to-violet-600/5 rounded-xl p-3 border border-violet-500/20">
              <div className="text-[10px] text-violet-300/70 uppercase tracking-wider mb-1">Sharpe</div>
              <div className="text-2xl font-bold text-violet-300">{performanceMetrics ? performanceMetrics.sharpe.toFixed(2) : '--'}</div>
            </div>
            <div className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 rounded-xl p-3 border border-cyan-500/20">
              <div className="text-[10px] text-cyan-300/70 uppercase tracking-wider mb-1">Sortino</div>
              <div className="text-2xl font-bold text-cyan-300">{performanceMetrics ? performanceMetrics.sortino.toFixed(2) : '--'}</div>
            </div>
            <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 rounded-xl p-3 border border-amber-500/20">
              <div className="text-[10px] text-amber-300/70 uppercase tracking-wider mb-1">Calmar</div>
              <div className="text-2xl font-bold text-amber-300">{performanceMetrics ? performanceMetrics.calmar.toFixed(1) : '--'}</div>
            </div>
            <div className="bg-gradient-to-br from-fuchsia-500/10 to-fuchsia-600/5 rounded-xl p-3 border border-fuchsia-500/20">
              <div className="text-[10px] text-fuchsia-300/70 uppercase tracking-wider mb-1">Win Rate</div>
              <div className="text-2xl font-bold text-fuchsia-300">{performanceMetrics ? `${performanceMetrics.winRate}%` : '--'}</div>
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <TabsList className="glass rounded-xl p-1 h-auto shrink-0 w-fit">
              <TabsTrigger value="results" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-primary/20" data-testid="tab-results">
                <BarChart2 className="h-3 w-3 mr-1.5" /> Results
              </TabsTrigger>
              <TabsTrigger value="walkforward" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-primary/20" data-testid="tab-walkforward">
                <Layers className="h-3 w-3 mr-1.5" /> Walk-Forward
              </TabsTrigger>
              <TabsTrigger value="montecarlo" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-primary/20" data-testid="tab-montecarlo">
                <Shuffle className="h-3 w-3 mr-1.5" /> Monte Carlo
              </TabsTrigger>
              <TabsTrigger value="trades" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-primary/20" data-testid="tab-trades">
                <Target className="h-3 w-3 mr-1.5" /> Trades
              </TabsTrigger>
              <TabsTrigger value="costs" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-primary/20" data-testid="tab-costs">
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
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={equityData}>
                        <defs>
                          <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(185, 70%, 55%)" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="hsl(185, 70%, 55%)" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                        <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} domain={['auto', 'auto']} />
                        <Tooltip contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px' }} />
                        <Area type="monotone" dataKey="value" stroke="hsl(185, 70%, 55%)" strokeWidth={2} fill="url(#colorEquity)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="glass rounded-2xl flex flex-col gradient-border">
                  <CardHeader className="py-2 px-4 border-b border-white/5">
                    <CardTitle className="text-xs font-medium text-muted-foreground">Performance Stats</CardTitle>
                  </CardHeader>
                  <ScrollArea className="flex-1">
                    {performanceMetrics ? (
                      <CardContent className="space-y-2 pt-3 text-xs">
                        <StatRow label="CAGR" value={`${performanceMetrics.cagr}%`} />
                        <StatRow label="Profit Factor" value={performanceMetrics.profitFactor.toFixed(2)} />
                        <StatRow label="Expectancy" value={`$${performanceMetrics.expectancy}`} />
                        <StatRow label="Avg Win" value={`$${performanceMetrics.avgWin}`} positive />
                        <StatRow label="Avg Loss" value={`$${performanceMetrics.avgLoss}`} negative />
                        <StatRow label="Largest Win" value={`$${performanceMetrics.largestWin}`} positive />
                        <StatRow label="Largest Loss" value={`$${performanceMetrics.largestLoss}`} negative />
                        <StatRow label="Total Trades" value={performanceMetrics.totalTrades.toLocaleString()} />
                        <StatRow label="Avg Holding" value={performanceMetrics.avgHoldingTime} />
                      </CardContent>
                    ) : (
                      <CardContent className="h-full flex items-center justify-center">
                        <NotImplemented feature="Performance Stats" type="data" description="Run backtest to generate stats" />
                      </CardContent>
                    )}
                  </ScrollArea>
                </Card>
              </div>
            </TabsContent>

            {/* Walk-Forward Tab */}
            <TabsContent value="walkforward" className="flex-1 min-h-0 overflow-hidden mt-3">
              <div className="grid grid-cols-2 gap-3 h-full">
                <Card className="glass rounded-2xl flex flex-col gradient-border">
                  <CardHeader className="py-2 px-4 border-b border-white/5">
                    <CardTitle className="text-xs font-medium text-muted-foreground">Walk-Forward Optimization</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 min-h-0 p-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={walkForwardData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                        <XAxis dataKey="fold" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} domain={[0, 3]} />
                        <Tooltip contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px' }} />
                        <Legend wrapperStyle={{ fontSize: '10px' }} />
                        <Bar dataKey="trainSharpe" fill="hsl(260, 80%, 70%)" name="Train Sharpe" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="testSharpe" fill="hsl(185, 70%, 55%)" name="Test Sharpe" radius={[4, 4, 0, 0]} />
                        <ReferenceLine y={1.5} stroke="hsl(45, 90%, 55%)" strokeDasharray="5 5" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="glass rounded-2xl flex flex-col gradient-border">
                  <CardHeader className="py-2 px-4 border-b border-white/5">
                    <CardTitle className="text-xs font-medium text-muted-foreground">Fold Details</CardTitle>
                  </CardHeader>
                  <ScrollArea className="flex-1">
                    <CardContent className="space-y-2 pt-3">
                      {walkForwardData.map(fold => (
                        <div key={fold.fold} className={`p-2.5 rounded-xl ${fold.overfit ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-white/5'}`} data-testid={`fold-${fold.fold}`}>
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="font-mono text-xs font-bold">Fold {fold.fold}</span>
                            {fold.overfit && <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-400">Overfit</Badge>}
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[10px]">
                            <div>
                              <span className="text-muted-foreground">Train: </span>
                              <span className="font-mono">{fold.trainStart} → {fold.trainEnd}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Test: </span>
                              <span className="font-mono">{fold.testStart} → {fold.testEnd}</span>
                            </div>
                          </div>
                          <div className="flex gap-4 mt-1.5 text-[10px]">
                            <span>Train: <span className="font-mono text-primary">{fold.trainSharpe}</span></span>
                            <span>Test: <span className="font-mono text-accent">{fold.testSharpe}</span></span>
                            <span>Decay: <span className={`font-mono ${(fold.trainSharpe - fold.testSharpe) > 0.5 ? 'text-amber-400' : 'text-green-400'}`}>
                              {((1 - fold.testSharpe / fold.trainSharpe) * 100).toFixed(0)}%
                            </span></span>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </ScrollArea>
                </Card>
              </div>
            </TabsContent>

            {/* Monte Carlo Tab */}
            <TabsContent value="montecarlo" className="flex-1 min-h-0 overflow-hidden mt-3">
              <div className="grid grid-cols-3 gap-3 h-full">
                <Card className="col-span-2 glass rounded-2xl flex flex-col gradient-border">
                  <CardHeader className="py-2 px-4 border-b border-white/5">
                    <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                      <Shuffle className="h-3 w-3 text-primary" /> Monte Carlo Simulation (50 paths)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 min-h-0 p-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={monteCarloData.filter((_, i) => i % 5 === 0)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                        <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} domain={['auto', 'auto']} />
                        <Tooltip contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px' }} />
                        {Array.from({ length: 10 }, (_, i) => (
                          <Line key={i} type="monotone" dataKey={`path${i * 5}`} stroke={`hsla(260, 70%, ${50 + i * 3}%, 0.5)`} strokeWidth={1} dot={false} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="glass rounded-2xl flex flex-col gradient-border">
                  <CardHeader className="py-2 px-4 border-b border-white/5">
                    <CardTitle className="text-xs font-medium text-muted-foreground">Distribution Stats</CardTitle>
                  </CardHeader>
                  {monteCarloStats ? (
                    <CardContent className="space-y-3 pt-3 text-xs">
                      <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                        <p className="text-muted-foreground text-[10px] mb-1">95th Percentile</p>
                        <p className="font-mono text-xl font-bold text-green-400">${monteCarloStats.percentile95.toLocaleString()}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                        <p className="text-muted-foreground text-[10px] mb-1">Median Outcome</p>
                        <p className="font-mono text-xl font-bold text-primary">${monteCarloStats.median.toLocaleString()}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                        <p className="text-muted-foreground text-[10px] mb-1">5th Percentile</p>
                        <p className="font-mono text-xl font-bold text-rose-400">${monteCarloStats.percentile5.toLocaleString()}</p>
                      </div>
                      <div className="space-y-2 pt-2 border-t border-white/5">
                        <StatRow label="Mean Max DD" value={`${monteCarloStats.maxDrawdownMean}%`} />
                        <StatRow label="Worst Max DD" value={`${monteCarloStats.maxDrawdownWorst}%`} negative />
                        <StatRow label="Mean Win Rate" value={`${monteCarloStats.winRateMean}%`} />
                        <StatRow label="Mean PF" value={monteCarloStats.profitFactorMean.toFixed(2)} />
                      </div>
                    </CardContent>
                  ) : (
                    <CardContent className="h-full flex items-center justify-center">
                      <NotImplemented feature="Monte Carlo Stats" type="data" description="Run simulation to generate stats" />
                    </CardContent>
                  )}
                </Card>
              </div>
            </TabsContent>

            {/* Trades Tab */}
            <TabsContent value="trades" className="flex-1 min-h-0 overflow-hidden mt-3">
              <Card className="h-full glass rounded-2xl flex flex-col gradient-border">
                <CardHeader className="py-2 px-4 border-b border-white/5 shrink-0">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Trade-by-Trade Breakdown</CardTitle>
                </CardHeader>
                <ScrollArea className="flex-1">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background/80 backdrop-blur-sm">
                      <tr className="border-b border-white/5 text-muted-foreground">
                        <th className="text-left py-2 px-3 font-medium">Entry</th>
                        <th className="text-left py-2 px-3 font-medium">Exit</th>
                        <th className="text-left py-2 px-3 font-medium">Symbol</th>
                        <th className="text-left py-2 px-3 font-medium">Dir</th>
                        <th className="text-right py-2 px-3 font-medium">Entry $</th>
                        <th className="text-right py-2 px-3 font-medium">Exit $</th>
                        <th className="text-right py-2 px-3 font-medium">Gross P&L</th>
                        <th className="text-right py-2 px-3 font-medium">Slippage</th>
                        <th className="text-right py-2 px-3 font-medium">Comm.</th>
                        <th className="text-right py-2 px-3 font-medium">Net P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tradeBreakdown.map(trade => (
                        <tr key={trade.id} className="border-b border-white/5 hover:bg-white/5" data-testid={`trade-row-${trade.id}`}>
                          <td className="py-2 px-3 font-mono text-muted-foreground">{trade.entryTime}</td>
                          <td className="py-2 px-3 font-mono text-muted-foreground">{trade.exitTime}</td>
                          <td className="py-2 px-3 font-mono font-bold text-primary">{trade.symbol}</td>
                          <td className="py-2 px-3">
                            <Badge variant="outline" className={`text-[9px] rounded-full ${
                              trade.direction === 'long' ? 'border-green-500/50 text-green-400' : 'border-rose-500/50 text-rose-400'
                            }`}>
                              {trade.direction === 'long' ? <TrendingUp className="h-2 w-2 mr-0.5" /> : <TrendingDown className="h-2 w-2 mr-0.5" />}
                              {trade.direction}
                            </Badge>
                          </td>
                          <td className="py-2 px-3 text-right font-mono">{trade.entry}</td>
                          <td className="py-2 px-3 text-right font-mono">{trade.exit}</td>
                          <td className={`py-2 px-3 text-right font-mono ${trade.pnl >= 0 ? 'text-green-400' : 'text-rose-400'}`}>
                            {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-amber-400">-${trade.slippage.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right font-mono text-muted-foreground">-${trade.commission.toFixed(2)}</td>
                          <td className={`py-2 px-3 text-right font-mono font-bold ${trade.netPnl >= 0 ? 'text-green-400' : 'text-rose-400'}`}>
                            {trade.netPnl >= 0 ? '+' : ''}${trade.netPnl.toFixed(2)}
                          </td>
                        </tr>
                      ))}
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
                    <CardTitle className="text-xs font-medium text-muted-foreground">Slippage & Commission Impact</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 min-h-0 p-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={slippageData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                        <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                        <Tooltip contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px' }} />
                        <Legend wrapperStyle={{ fontSize: '10px' }} />
                        <Bar dataKey="slippage" stackId="a" fill="hsl(45, 90%, 55%)" name="Slippage" />
                        <Bar dataKey="commission" stackId="a" fill="hsl(260, 80%, 70%)" name="Commission" />
                        <Line type="monotone" dataKey="netImpact" stroke="hsl(0, 70%, 55%)" strokeWidth={2} dot={false} name="Net Impact" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="glass rounded-2xl flex flex-col gradient-border">
                  <CardHeader className="py-2 px-4 border-b border-white/5">
                    <CardTitle className="text-xs font-medium text-muted-foreground">Cost Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-3">
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                      <p className="text-muted-foreground text-[10px] mb-1">Total Slippage</p>
                      <p className="font-mono text-xl font-bold text-amber-400">--</p>
                      <p className="text-[10px] text-muted-foreground">Awaiting backtest results</p>
                    </div>
                    <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                      <p className="text-muted-foreground text-[10px] mb-1">Total Commission</p>
                      <p className="font-mono text-xl font-bold text-primary">--</p>
                      <p className="text-[10px] text-muted-foreground">Awaiting backtest results</p>
                    </div>
                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                      <p className="text-muted-foreground text-[10px] mb-1">Net Cost Impact</p>
                      <p className="font-mono text-xl font-bold text-rose-400">--</p>
                      <p className="text-[10px] text-muted-foreground">Awaiting backtest results</p>
                    </div>
                    <div className="pt-2 border-t border-white/5 space-y-2">
                      <StatRow label="Avg Slippage" value="--" />
                      <StatRow label="Slippage Model" value="--" />
                      <StatRow label="Commission Model" value="--" />
                    </div>
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

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = { primary: "text-primary", accent: "text-accent", green: "text-green-400", rose: "text-rose-400" };
  return (
    <div className="glass rounded-xl p-2.5 gradient-border">
      <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-lg font-display font-bold ${colorMap[color]}`}>{value}</p>
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
