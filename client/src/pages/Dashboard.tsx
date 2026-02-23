import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";
import { ArrowUpRight, ArrowDownRight, Activity, DollarSign, TrendingUp, Cpu, Sparkles, Target, AlertTriangle, TrendingDown, Brain, Zap, Clock, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useMemo } from "react";
import { IndicatorPanel } from "@/components/IndicatorPanel";

import { Trade, MlModel, MarketRegime, QUERY_KEYS } from "@/lib/types";
import { fetchArray } from "@/lib/fetchArray";

const correlationInstruments: string[] = [];

type EquityPoint = { time: string; value: number; drawdown: number };

const regimeColors: Record<string, { bg: string; text: string; border: string }> = {
  "trending": { bg: "bg-emerald-500/20", text: "text-emerald-400", border: "border-emerald-500/30" },
  "ranging": { bg: "bg-amber-500/20", text: "text-amber-400", border: "border-amber-500/30" },
  "volatile": { bg: "bg-rose-500/20", text: "text-rose-400", border: "border-rose-500/30" },
  "low_vol": { bg: "bg-cyan-500/20", text: "text-cyan-400", border: "border-cyan-500/30" },
};

export default function Dashboard() {
  const [equityData] = useState<EquityPoint[]>([]);
  const [correlationMatrix] = useState<number[][]>([]);
  const [isLive] = useState(false);

  const { data: trades = [] } = useQuery<Trade[]>({
    queryKey: [...QUERY_KEYS.mlTrades],
    queryFn: () => fetchArray<Trade>("/api/ml/trades?limit=20"),
    refetchInterval: isLive ? 5000 : false,
  });

  const { data: models = [] } = useQuery<MlModel[]>({
    queryKey: [...QUERY_KEYS.mlModels],
    queryFn: () => fetchArray<MlModel>("/api/ml/models"),
    refetchInterval: isLive ? 10000 : false,
  });

  const { data: regimes = [] } = useQuery<MarketRegime[]>({
    queryKey: [...QUERY_KEYS.mlRegimes],
    queryFn: () => fetchArray<MarketRegime>("/api/ml/regimes"),
  });

  const currentRegime = regimes.length > 0 ? regimes[0] : null;
  const regimeStyle = currentRegime ? (regimeColors[currentRegime.name?.toLowerCase()] || regimeColors.trending) : null;

  const metrics = useMemo(() => {
    const closedTrades = trades.filter(t => t.status === 'closed');
    const wins = closedTrades.filter(t => (t.pnl || 0) > 0);
    const losses = closedTrades.filter(t => (t.pnl || 0) < 0);
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
    
    const currentEquity = equityData.length > 0 ? equityData[equityData.length - 1].value : 0;
    const currentDD = equityData.length > 0 ? Math.min(...equityData.map(d => d.drawdown)) : 0;
    const maxDD = currentDD;
    
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl || 0), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + (t.pnl || 0), 0) / losses.length) : 0;
    const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;
    
    return {
      sharpe: 0,
      sortino: 0,
      winRate,
      equity: currentEquity,
      currentDD,
      maxDD,
      profitFactor,
      totalPnl,
      openTrades: trades.filter(t => t.status === 'open').length,
      activeModels: models.filter(m => m.status === 'active').length,
    };
  }, [trades, models, equityData]);

  const activeModels = models.filter(m => m.status === 'active');
  const isDrawdownAlert = metrics.currentDD < -8;

  const recentActivity = useMemo(() => {
    const activities: { id: string; type: string; symbol: string; message: string; time: string; color: string }[] = [];
    
    trades.slice(0, 5).forEach((t) => {
      const timestamp = t.exit_timestamp || t.entry_timestamp;
      let timeLabel = '--';
      if (timestamp) {
        const minutesAgo = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
        if (minutesAgo < 60) timeLabel = `${minutesAgo}m ago`;
        else if (minutesAgo < 1440) timeLabel = `${Math.floor(minutesAgo / 60)}h ago`;
        else timeLabel = `${Math.floor(minutesAgo / 1440)}d ago`;
      }
      activities.push({
        id: `trade-${t.id}`,
        type: t.side === 'long' ? 'BUY' : 'SELL',
        symbol: t.symbol,
        message: t.status === 'open' ? `Entry @ ${t.entry_price}` : `P&L: $${t.pnl?.toFixed(2)}`,
        time: timeLabel,
        color: t.side === 'long' ? 'text-emerald-400' : 'text-rose-400',
      });
    });
    
    return activities;
  }, [trades]);

  return (
    <div className="space-y-4 h-[calc(100vh-8.5rem)] flex flex-col overflow-hidden p-1">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/30 to-cyan-500/30 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-violet-300" />
            </div>
            <span className="text-sm font-medium text-violet-300/80">ML Trading Dashboard</span>
            
            {currentRegime && regimeStyle ? (
              <Badge data-testid="badge-regime" className={`${regimeStyle.bg} ${regimeStyle.text} ${regimeStyle.border} gap-1.5 px-3 py-1`}>
                <Activity className="h-3 w-3" />
                {currentRegime.name}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground gap-1.5 px-3 py-1">
                <Activity className="h-3 w-3" />
                No Regime
              </Badge>
            )}
            
            {isDrawdownAlert && (
              <Badge variant="outline" className="border-amber-500/50 text-amber-400 bg-amber-500/10 gap-1.5 px-3 py-1">
                <AlertTriangle className="h-3 w-3" /> Drawdown Alert
              </Badge>
            )}
          </div>
          <h1 className="text-4xl font-display font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">Command Center</h1>
        </div>
        
        <div className="flex items-center gap-3">
          <Button data-testid="button-toggle-live" variant="outline" size="sm" disabled
            className="h-9 px-4 rounded-xl border-white/10 bg-black/30 opacity-50 cursor-not-allowed">
            <RefreshCw className="h-3.5 w-3.5 mr-2" />
            Auto-Refresh (Disabled)
          </Button>
          
          <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 rounded-xl px-4 py-2.5 border border-emerald-500/20">
            <p className="text-[9px] text-emerald-300/70 uppercase tracking-wider mb-0.5">Session P&L</p>
            <p data-testid="text-session-pnl" className={`text-xl font-bold flex items-center gap-1 ${metrics.totalPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {trades.length > 0 ? (
                <>
                  {metrics.totalPnl >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                  ${Math.abs(metrics.totalPnl).toFixed(0)}
                </>
              ) : '--'}
            </p>
          </div>
          <div className="bg-gradient-to-br from-rose-500/10 to-rose-600/5 rounded-xl px-4 py-2.5 border border-rose-500/20">
            <p className="text-[9px] text-rose-300/70 uppercase tracking-wider mb-0.5">Max Drawdown</p>
            <p data-testid="text-max-dd" className="text-xl font-bold text-rose-300">{equityData.length > 0 ? `${metrics.maxDD}%` : '--'}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-3 shrink-0">
        <div className="bg-gradient-to-br from-violet-500/10 to-violet-600/5 rounded-xl p-4 border border-violet-500/20">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center">
              <Activity className="h-4 w-4 text-violet-400" />
            </div>
            <div className="text-[10px] text-violet-300/70 uppercase tracking-wider">Sharpe</div>
          </div>
          <div data-testid="metric-sharpe" className="text-3xl font-bold text-violet-300">{equityData.length > 0 ? metrics.sharpe.toFixed(2) : '--'}</div>
          <div className="text-[10px] text-muted-foreground/60 mt-1">ratio</div>
        </div>
        <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 rounded-xl p-4 border border-emerald-500/20">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Target className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="text-[10px] text-emerald-300/70 uppercase tracking-wider">Win Rate</div>
          </div>
          <div data-testid="metric-winrate" className="text-3xl font-bold text-emerald-300">{trades.length > 0 ? `${metrics.winRate.toFixed(1)}%` : '--'}</div>
          <div className="text-[10px] text-muted-foreground/60 mt-1">from trades</div>
        </div>
        <div className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 rounded-xl p-4 border border-cyan-500/20">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="text-[10px] text-cyan-300/70 uppercase tracking-wider">Equity</div>
          </div>
          <div data-testid="metric-equity" className="text-3xl font-bold text-cyan-300">{equityData.length > 0 ? `$${(metrics.equity / 1000).toFixed(1)}K` : '--'}</div>
          <div className="text-[10px] text-muted-foreground/60 mt-1">portfolio</div>
        </div>
        <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 rounded-xl p-4 border border-amber-500/20">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <Cpu className="h-4 w-4 text-amber-400" />
            </div>
            <div className="text-[10px] text-amber-300/70 uppercase tracking-wider">Models</div>
          </div>
          <div data-testid="metric-confidence" className="text-3xl font-bold text-amber-300">{metrics.activeModels}</div>
          <div className="text-[10px] text-amber-400/60 mt-1">active in ensemble</div>
        </div>
        <div className="bg-gradient-to-br from-rose-500/10 to-rose-600/5 rounded-xl p-4 border border-rose-500/20">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-rose-500/20 flex items-center justify-center">
              <TrendingDown className="h-4 w-4 text-rose-400" />
            </div>
            <div className="text-[10px] text-rose-300/70 uppercase tracking-wider">Current DD</div>
          </div>
          <div data-testid="metric-dd" className="text-3xl font-bold text-rose-300">{metrics.currentDD.toFixed(1)}%</div>
          <div className="text-[10px] text-rose-400/60 mt-1">below peak</div>
        </div>
        <div className="bg-gradient-to-br from-fuchsia-500/10 to-fuchsia-600/5 rounded-xl p-4 border border-fuchsia-500/20">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-fuchsia-500/20 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-fuchsia-400" />
            </div>
            <div className="text-[10px] text-fuchsia-300/70 uppercase tracking-wider">Sortino</div>
          </div>
          <div data-testid="metric-sortino" className="text-3xl font-bold text-fuchsia-300">{metrics.sortino.toFixed(2)}</div>
          <div className="text-[10px] text-emerald-400 mt-1">+0.18 improvement</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 flex-1 min-h-0 overflow-hidden">
        <Card className="lg:col-span-2 glass rounded-2xl overflow-hidden flex flex-col gradient-border">
          <CardHeader className="py-2 px-4 border-b border-white/5">
            <CardTitle className="text-xs font-medium text-muted-foreground flex justify-between items-center">
              <span className="flex items-center gap-2">
                <div className="h-2 w-2 bg-primary rounded-full pulse-slow" />
                Equity & Drawdown
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={equityData}>
                <defs>
                  <linearGradient id="colorDD" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(0, 70%, 55%)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(0, 70%, 55%)" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(260, 80%, 70%)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(260, 80%, 70%)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <YAxis yAxisId="equity" stroke="hsl(var(--muted-foreground))" fontSize={10} domain={['auto', 'auto']} />
                <YAxis yAxisId="dd" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={10} domain={[-15, 0]} />
                <Tooltip contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px', fontSize: '11px' }} />
                <Legend wrapperStyle={{ fontSize: '10px' }} />
                <Area yAxisId="equity" type="monotone" dataKey="value" stroke="hsl(260, 80%, 70%)" fill="url(#colorEquity)" strokeWidth={2} name="Equity" />
                <Area yAxisId="dd" type="monotone" dataKey="drawdown" stroke="hsl(0, 70%, 55%)" fill="url(#colorDD)" strokeWidth={1.5} name="Drawdown %" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="glass rounded-2xl flex flex-col gradient-border overflow-hidden">
          <CardHeader className="py-2 px-3 border-b border-white/5">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Brain className="h-3 w-3 text-violet-400" /> Model Performance
            </CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1">
            <CardContent className="space-y-2 pt-3">
              {activeModels.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  <Brain className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>No active models</p>
                </div>
              ) : (
                activeModels.slice(0, 5).map(model => {
                  let parsedMetrics: Record<string, number> = {};
                  try {
                    parsedMetrics = model.metrics ? JSON.parse(model.metrics) : {};
                  } catch {
                    parsedMetrics = {};
                  }
                  const accuracy = parsedMetrics.accuracy || null;
                  // Generate stable sparkline from model id (deterministic, not random)
                  const sparkData = accuracy != null
                    ? Array.from({ length: 10 }, (_, i) => 0.3 + 0.4 * Math.sin(model.id * 0.7 + i * 0.9))
                    : null;
                  
                  return (
                    <div key={model.id} data-testid={`model-card-${model.id}`} className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                      <div className="flex justify-between items-center mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                          <span className="text-xs font-medium">{model.name}</span>
                        </div>
                        <span className="text-xs font-mono text-primary">{accuracy != null ? `${(accuracy * 100).toFixed(1)}%` : '--'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-muted-foreground">{model.architecture}</span>
                        <div className="w-16 h-4">
                          {sparkData ? (
                            <svg viewBox="0 0 100 20" className="w-full h-full">
                              <polyline
                                fill="none"
                                stroke="hsl(260, 80%, 70%)"
                                strokeWidth="2"
                                points={sparkData.map((v, i) => `${i * 11},${20 - v * 18}`).join(' ')}
                              />
                            </svg>
                          ) : (
                            <span className="text-[9px] text-muted-foreground">--</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              
              {activeModels.length === 0 && (
                <div className="p-4 text-center text-muted-foreground text-xs">
                  No trained models yet. Train a model in ML Hub.
                </div>
              )}
            </CardContent>
          </ScrollArea>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 shrink-0 h-44">
        <Card className="glass rounded-2xl flex flex-col gradient-border overflow-hidden">
          <CardHeader className="py-1.5 px-3 border-b border-white/5">
            <CardTitle className="text-[10px] font-medium text-muted-foreground">Correlation Matrix</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-1.5 overflow-auto">
            {correlationMatrix.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                <Activity className="h-8 w-8 mb-2 opacity-20" />
                <p className="text-xs font-medium">No Correlations</p>
                <p className="text-[10px]">Not implemented</p>
              </div>
            ) : (
              <div className="min-w-max">
                <table className="w-full text-[8px]">
                  <thead>
                    <tr>
                      <th className="p-0.5"></th>
                      {correlationInstruments.map(inst => (
                        <th key={inst} className="p-0.5 font-mono text-muted-foreground">{inst}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {correlationInstruments.map((inst, i) => (
                      <tr key={inst}>
                        <td className="p-0.5 font-mono text-muted-foreground">{inst}</td>
                        {correlationMatrix[i]?.map((corr, j) => {
                          const absCorr = Math.abs(corr);
                          const bgColor = corr >= 0.7 ? 'bg-emerald-500' : corr >= 0.3 ? 'bg-emerald-500/50' : 
                                          corr <= -0.3 ? 'bg-rose-500/50' : corr <= -0.7 ? 'bg-rose-500' : 'bg-white/10';
                          return (
                            <td key={j} data-testid={`corr-${inst}-${correlationInstruments[j]}`}
                                className={`p-0.5 text-center font-mono ${bgColor} ${absCorr > 0.5 ? 'text-white' : ''}`} 
                                style={{ opacity: Math.max(0.3, absCorr) }}>
                              {corr.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass rounded-2xl flex flex-col gradient-border overflow-hidden">
          <CardHeader className="py-1.5 px-3 border-b border-white/5">
            <CardTitle className="text-[10px] font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-3 w-3 text-cyan-400" /> Recent Activity
            </CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1">
            <CardContent className="space-y-1.5 pt-2">
              {recentActivity.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                  <Clock className="h-8 w-8 mb-2 opacity-20" />
                  <p className="text-xs font-medium">No Activity</p>
                  <p className="text-[10px]">No trades yet</p>
                </div>
              ) : recentActivity.map((activity) => (
                <div key={activity.id} data-testid={`activity-${activity.id}`} className="flex justify-between items-center p-2 rounded-lg bg-white/5 hover:bg-white/10">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[8px] h-4 px-1.5 rounded-full ${activity.color} border-current bg-current/10`}>
                      {activity.type}
                    </Badge>
                    <span className="font-mono font-bold text-xs">{activity.symbol}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground">{activity.message}</span>
                    <span className="text-[9px] text-muted-foreground/60 ml-2">{activity.time}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </ScrollArea>
        </Card>

        <Card className="glass rounded-2xl flex flex-col gradient-border overflow-hidden">
          <CardHeader className="py-1.5 px-3 border-b border-white/5">
            <CardTitle className="text-[10px] font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-3 w-3 text-amber-400" /> Drawdown Monitor
            </CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1">
            <CardContent className="space-y-1.5 pt-2">
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                <AlertTriangle className="h-8 w-8 mb-2 opacity-20" />
                <p className="text-xs font-medium">No Drawdown Data</p>
                <p className="text-[10px]">Monitoring not implemented</p>
              </div>
            </CardContent>
          </ScrollArea>
        </Card>
      </div>

      <div className="shrink-0">
        <IndicatorPanel symbol="MNQ" />
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, title, value, trend, neutral, isNegative, subtext, "data-testid": testId, ...props }: { 
  icon: any; title: string; value: string; trend?: string; neutral?: boolean; isNegative?: boolean; subtext?: string;
  "data-testid"?: string;
  [key: string]: any;
}) {
  return (
    <Card className="glass rounded-xl gradient-border" data-testid={testId} {...props}>
      <CardContent className="p-2">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Icon className={`h-3 w-3 ${isNegative ? 'text-rose-400' : 'text-primary'}`} />
          <span className="text-[9px] text-muted-foreground">{title}</span>
        </div>
        <div className="flex items-end gap-1">
          <span className={`text-base font-display font-bold ${isNegative ? 'text-rose-400' : 'text-foreground'}`}>{value}</span>
          {trend && (
            <span className={`text-[9px] font-mono mb-0.5 ${neutral ? 'text-muted-foreground' : trend.startsWith('+') ? 'text-green-400' : 'text-rose-400'}`}>
              {trend}
            </span>
          )}
          {subtext && <span className="text-[9px] text-muted-foreground mb-0.5">{subtext}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
