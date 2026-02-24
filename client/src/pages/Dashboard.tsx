import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, Activity, DollarSign, TrendingUp, Cpu, Sparkles, Target, Brain, Zap, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMemo } from "react";

import { Trade, MlModel, MarketRegime, QUERY_KEYS } from "@/lib/types";
import { fetchArray } from "@/lib/fetchArray";
import { useTradeMetrics } from "@/hooks/useTradeMetrics";

const regimeColors: Record<string, { bg: string; text: string; border: string }> = {
  "trending": { bg: "bg-emerald-500/20", text: "text-emerald-400", border: "border-emerald-500/30" },
  "ranging": { bg: "bg-amber-500/20", text: "text-amber-400", border: "border-amber-500/30" },
  "volatile": { bg: "bg-rose-500/20", text: "text-rose-400", border: "border-rose-500/30" },
  "low_vol": { bg: "bg-cyan-500/20", text: "text-cyan-400", border: "border-cyan-500/30" },
};

interface MetricDef {
  key: string;
  icon: typeof Activity;
  title: string;
  colorFrom: string;
  colorTo: string;
  borderColor: string;
  textColor: string;
  labelColor: string;
  getValue: (m: ReturnType<typeof useTradeMetrics>, models: MlModel[], trades: Trade[]) => string;
  subtext: string;
}

const metricDefs: MetricDef[] = [
  {
    key: 'sharpe', icon: Activity, title: 'Sharpe',
    colorFrom: 'from-violet-500/10', colorTo: 'to-violet-600/5', borderColor: 'border-violet-500/20',
    textColor: 'text-violet-300', labelColor: 'text-violet-300/70',
    getValue: () => '--', subtext: 'ratio',
  },
  {
    key: 'winrate', icon: Target, title: 'Win Rate',
    colorFrom: 'from-emerald-500/10', colorTo: 'to-emerald-600/5', borderColor: 'border-emerald-500/20',
    textColor: 'text-emerald-300', labelColor: 'text-emerald-300/70',
    getValue: (m, _, trades) => trades.length > 0 ? `${m.winRate.toFixed(1)}%` : '--', subtext: 'from trades',
  },
  {
    key: 'equity', icon: DollarSign, title: 'Equity',
    colorFrom: 'from-cyan-500/10', colorTo: 'to-cyan-600/5', borderColor: 'border-cyan-500/20',
    textColor: 'text-cyan-300', labelColor: 'text-cyan-300/70',
    getValue: () => '--', subtext: 'portfolio',
  },
  {
    key: 'models', icon: Cpu, title: 'Models',
    colorFrom: 'from-amber-500/10', colorTo: 'to-amber-600/5', borderColor: 'border-amber-500/20',
    textColor: 'text-amber-300', labelColor: 'text-amber-300/70',
    getValue: (_, models) => `${models.filter(m => m.status === 'active').length}`,
    subtext: 'active in ensemble',
  },
  {
    key: 'pnl', icon: TrendingUp, title: 'Total P&L',
    colorFrom: 'from-fuchsia-500/10', colorTo: 'to-fuchsia-600/5', borderColor: 'border-fuchsia-500/20',
    textColor: 'text-fuchsia-300', labelColor: 'text-fuchsia-300/70',
    getValue: (m, _, trades) => trades.length > 0 ? `$${Math.abs(m.totalPnl).toFixed(0)}` : '--',
    subtext: 'realized',
  },
  {
    key: 'trades', icon: Zap, title: 'Trades',
    colorFrom: 'from-rose-500/10', colorTo: 'to-rose-600/5', borderColor: 'border-rose-500/20',
    textColor: 'text-rose-300', labelColor: 'text-rose-300/70',
    getValue: (m) => `${m.totalTrades}`, subtext: 'closed',
  },
];

export default function Dashboard() {
  const { data: trades = [] } = useQuery<Trade[]>({
    queryKey: [...QUERY_KEYS.mlTrades],
    queryFn: () => fetchArray<Trade>("/api/ml/trades?limit=20"),
  });

  const { data: models = [] } = useQuery<MlModel[]>({
    queryKey: [...QUERY_KEYS.mlModels],
    queryFn: () => fetchArray<MlModel>("/api/ml/models"),
  });

  const { data: regimes = [] } = useQuery<MarketRegime[]>({
    queryKey: [...QUERY_KEYS.mlRegimes],
    queryFn: () => fetchArray<MarketRegime>("/api/ml/regimes"),
  });

  const metrics = useTradeMetrics(trades);
  const activeModels = models.filter(m => m.status === 'active');

  const currentRegime = regimes.length > 0 ? regimes[0] : null;
  const regimeStyle = currentRegime ? (regimeColors[currentRegime.name?.toLowerCase()] || regimeColors.trending) : null;

  const recentActivity = useMemo(() => {
    const activities: { id: string; type: string; symbol: string; message: string; time: string; color: string }[] = [];

    trades.slice(0, 5).forEach((t) => {
      const timestamp = t.exitTimestamp || t.entryTimestamp;
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
        message: t.status === 'open' ? `Entry @ ${t.entryPrice}` : `P&L: $${t.pnl?.toFixed(2)}`,
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
          </div>
          <h1 className="text-4xl font-display font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">Command Center</h1>
        </div>

        <div className="flex items-center gap-3">
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
        </div>
      </div>

      {/* Metric cards grid */}
      <div className="grid grid-cols-6 gap-3 shrink-0">
        {metricDefs.map(def => {
          const Icon = def.icon;
          return (
            <div key={def.key} className={`bg-gradient-to-br ${def.colorFrom} ${def.colorTo} rounded-xl p-4 ${def.borderColor} border`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-lg ${def.colorFrom.replace('from-', 'bg-').replace('/10', '/20')} flex items-center justify-center`}>
                  <Icon className={`h-4 w-4 ${def.textColor.replace('300', '400')}`} />
                </div>
                <div className={`text-[10px] ${def.labelColor} uppercase tracking-wider`}>{def.title}</div>
              </div>
              <div data-testid={`metric-${def.key}`} className={`text-3xl font-bold ${def.textColor}`}>
                {def.getValue(metrics, models, trades)}
              </div>
              <div className="text-[10px] text-muted-foreground/60 mt-1">{def.subtext}</div>
            </div>
          );
        })}
      </div>

      {/* Model performance + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0 overflow-hidden">
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
                  <p className="text-xs mt-1 text-muted-foreground/60">Train a model in ML Hub</p>
                </div>
              ) : (
                activeModels.slice(0, 5).map(model => {
                  let parsedMetrics: Record<string, number> = {};
                  try {
                    parsedMetrics = model.metrics ? JSON.parse(model.metrics) : {};
                  } catch { /* malformed JSON */ }
                  const accuracy = parsedMetrics.accuracy || null;
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
            </CardContent>
          </ScrollArea>
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
      </div>
    </div>
  );
}
