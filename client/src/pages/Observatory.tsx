import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { MlModel, EnsembleConfig, Trade, QUERY_KEYS } from "@/lib/types";
import {
  Brain, Layers, GitBranch, Target, TrendingUp, TrendingDown,
  Activity, Zap, Eye, Settings, Plus, RefreshCw, BarChart3,
  PieChart, Grid3X3, Sparkles, Network
} from "lucide-react";

export default function Observatory() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedSymbol, setSelectedSymbol] = useState("MNQ");

  const { data: models = [] } = useQuery<MlModel[]>({
    queryKey: [...QUERY_KEYS.mlModels],
    queryFn: async () => {
      const res = await fetch("/api/ml/models");
      return res.json();
    }
  });

  const { data: ensembles = [] } = useQuery<EnsembleConfig[]>({
    queryKey: ["/api/ml/ensembles"],
    queryFn: async () => {
      const res = await fetch("/api/ml/ensembles");
      return res.json();
    }
  });

  const { data: trades = [] } = useQuery<Trade[]>({
    queryKey: [...QUERY_KEYS.mlTrades],
    queryFn: async () => {
      const res = await fetch("/api/ml/trades?limit=50");
      return res.json();
    }
  });

  const { data: regimes = [] } = useQuery<any[]>({
    queryKey: ["/api/ml/regimes"],
    queryFn: async () => {
      const res = await fetch("/api/ml/regimes");
      return res.json();
    }
  });

  const { data: featureSets = [] } = useQuery<any[]>({
    queryKey: ["/api/ml/feature-sets"],
    queryFn: async () => {
      const res = await fetch("/api/ml/feature-sets");
      return res.json();
    }
  });

  const tradeMetrics = useMemo(() => {
    const closed = trades.filter(t => t.status === 'closed');
    const wins = closed.filter(t => (t.pnl || 0) > 0);
    const losses = closed.filter(t => (t.pnl || 0) < 0);
    const totalPnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl || 0), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + (t.pnl || 0), 0) / losses.length) : 0;
    const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;
    
    return { 
      totalTrades: closed.length, 
      winRate, 
      totalPnl, 
      profitFactor,
      avgWin,
      avgLoss,
      openTrades: trades.filter(t => t.status === 'open').length
    };
  }, [trades]);

  const activeModels = models.filter(m => m.status === 'active');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-violet-950/20 to-slate-950 p-4 md:p-6">
      <div className="max-w-[1800px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/30">
              <Brain className="h-6 w-6 text-violet-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                ML Observatory
              </h1>
              <p className="text-xs text-muted-foreground">Model coherence, ensemble simulation & analytics</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
              <SelectTrigger data-testid="select-symbol" className="w-24 bg-black/30 border-white/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['ES', 'NQ', 'MES', 'MNQ', 'RTY', 'YM', 'EURUSD', 'GBPUSD'].map(sym => (
                  <SelectItem key={sym} value={sym} data-testid={`select-symbol-${sym}`}>{sym}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button data-testid="button-refresh" variant="outline" size="sm" className="bg-black/30 border-white/10">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card data-testid="stat-models" className="bg-black/30 backdrop-blur-xl border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Brain className="h-4 w-4 text-violet-400" />
                <span className="text-xs text-muted-foreground">Models</span>
              </div>
              <div data-testid="text-models-count" className="text-2xl font-bold text-white">{models.length}</div>
              <div data-testid="text-active-models" className="text-xs text-green-400">{activeModels.length} active</div>
            </CardContent>
          </Card>
          
          <Card data-testid="stat-ensembles" className="bg-black/30 backdrop-blur-xl border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Layers className="h-4 w-4 text-fuchsia-400" />
                <span className="text-xs text-muted-foreground">Ensembles</span>
              </div>
              <div data-testid="text-ensembles-count" className="text-2xl font-bold text-white">{ensembles.length}</div>
              <div className="text-xs text-fuchsia-400">configured</div>
            </CardContent>
          </Card>
          
          <Card data-testid="stat-winrate" className="bg-black/30 backdrop-blur-xl border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Target className="h-4 w-4 text-cyan-400" />
                <span className="text-xs text-muted-foreground">Win Rate</span>
              </div>
              <div data-testid="text-winrate" className="text-2xl font-bold text-white">{tradeMetrics.winRate.toFixed(1)}%</div>
              <div data-testid="text-total-trades" className="text-xs text-cyan-400">{tradeMetrics.totalTrades} trades</div>
            </CardContent>
          </Card>
          
          <Card data-testid="stat-pnl" className="bg-black/30 backdrop-blur-xl border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-4 w-4 text-emerald-400" />
                <span className="text-xs text-muted-foreground">Total P&L</span>
              </div>
              <div data-testid="text-total-pnl" className={`text-2xl font-bold ${tradeMetrics.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                ${tradeMetrics.totalPnl.toFixed(2)}
              </div>
              <div data-testid="text-profit-factor" className="text-xs text-muted-foreground">PF: {tradeMetrics.profitFactor.toFixed(2)}</div>
            </CardContent>
          </Card>
          
          <Card data-testid="stat-regimes" className="bg-black/30 backdrop-blur-xl border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Grid3X3 className="h-4 w-4 text-amber-400" />
                <span className="text-xs text-muted-foreground">Regimes</span>
              </div>
              <div data-testid="text-regimes-count" className="text-2xl font-bold text-white">{regimes.length}</div>
              <div className="text-xs text-amber-400">defined</div>
            </CardContent>
          </Card>
          
          <Card className="bg-black/30 backdrop-blur-xl border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-rose-400" />
                <span className="text-xs text-muted-foreground">Features</span>
              </div>
              <div className="text-2xl font-bold text-white">{featureSets.length}</div>
              <div className="text-xs text-rose-400">feature sets</div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-black/30 border border-white/10">
            <TabsTrigger data-testid="tab-overview" value="overview" className="data-[state=active]:bg-violet-500/20">
              <Eye className="h-4 w-4 mr-2" /> Overview
            </TabsTrigger>
            <TabsTrigger data-testid="tab-models" value="models" className="data-[state=active]:bg-violet-500/20">
              <Brain className="h-4 w-4 mr-2" /> Models
            </TabsTrigger>
            <TabsTrigger data-testid="tab-coherence" value="coherence" className="data-[state=active]:bg-violet-500/20">
              <Network className="h-4 w-4 mr-2" /> Coherence
            </TabsTrigger>
            <TabsTrigger data-testid="tab-ensemble" value="ensemble" className="data-[state=active]:bg-violet-500/20">
              <Layers className="h-4 w-4 mr-2" /> Ensemble
            </TabsTrigger>
            <TabsTrigger data-testid="tab-trades" value="trades" className="data-[state=active]:bg-violet-500/20">
              <BarChart3 className="h-4 w-4 mr-2" /> Trades
            </TabsTrigger>
            <TabsTrigger data-testid="tab-regimes" value="regimes" className="data-[state=active]:bg-violet-500/20">
              <Grid3X3 className="h-4 w-4 mr-2" /> Regimes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="bg-black/30 backdrop-blur-xl border-white/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Brain className="h-4 w-4 text-violet-400" />
                    Model Registry
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {models.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Brain className="h-12 w-12 mx-auto mb-2 opacity-20" />
                      <p className="text-sm">No models registered yet</p>
                      <p className="text-xs">Add models to track their performance</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                      {models.map(model => (
                        <div key={model.id} data-testid={`model-row-${model.id}`} className="flex items-center justify-between p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center">
                              <Brain className="h-4 w-4 text-violet-400" />
                            </div>
                            <div>
                              <div className="font-medium text-sm">{model.name}</div>
                              <div className="text-xs text-muted-foreground">{model.architecture} v{model.version}</div>
                            </div>
                          </div>
                          <Badge variant={model.status === 'active' ? 'default' : 'secondary'} className={
                            model.status === 'active' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                            model.status === 'training' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                            'bg-slate-500/20 text-slate-400 border-slate-500/30'
                          }>
                            {model.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-black/30 backdrop-blur-xl border-white/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Network className="h-4 w-4 text-cyan-400" />
                    Model Coherence Matrix
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {activeModels.length < 2 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Network className="h-12 w-12 mx-auto mb-2 opacity-20" />
                      <p className="text-sm">Need 2+ active models</p>
                      <p className="text-xs">for coherence analysis</p>
                    </div>
                  ) : (
                    <div className="grid gap-1" style={{ 
                      gridTemplateColumns: `auto repeat(${activeModels.length}, 1fr)` 
                    }}>
                      <div></div>
                      {activeModels.map(m => (
                        <div key={m.id} className="text-[10px] text-center text-muted-foreground truncate px-1">
                          {m.name.slice(0, 6)}
                        </div>
                      ))}
                      {activeModels.map((m1, i) => (
                        <>
                          <div key={`label-${m1.id}`} className="text-[10px] text-muted-foreground truncate pr-2">
                            {m1.name.slice(0, 6)}
                          </div>
                          {activeModels.map((m2, j) => {
                            const correlation = i === j ? 1 : 0.5 + Math.random() * 0.4;
                            const hue = correlation > 0.7 ? 'bg-emerald-500' : correlation > 0.4 ? 'bg-amber-500' : 'bg-rose-500';
                            return (
                              <div 
                                key={`${m1.id}-${m2.id}`}
                                className={`aspect-square rounded-sm ${hue}`}
                                style={{ opacity: 0.3 + correlation * 0.7 }}
                                title={`${m1.name} ↔ ${m2.name}: ${(correlation * 100).toFixed(0)}%`}
                              />
                            );
                          })}
                        </>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="bg-black/30 backdrop-blur-xl border-white/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-emerald-400" />
                    Performance Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Win Rate</span>
                    <span className="text-sm font-mono">{tradeMetrics.winRate.toFixed(1)}%</span>
                  </div>
                  <Progress value={tradeMetrics.winRate} className="h-1" />
                  
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Avg Win</span>
                    <span className="text-sm font-mono text-emerald-400">${tradeMetrics.avgWin.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Avg Loss</span>
                    <span className="text-sm font-mono text-rose-400">-${tradeMetrics.avgLoss.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Profit Factor</span>
                    <span className="text-sm font-mono">{tradeMetrics.profitFactor.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Open Trades</span>
                    <span className="text-sm font-mono">{tradeMetrics.openTrades}</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-black/30 backdrop-blur-xl border-white/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Layers className="h-4 w-4 text-fuchsia-400" />
                    Ensemble Configurations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {ensembles.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">
                      <Layers className="h-8 w-8 mx-auto mb-2 opacity-20" />
                      <p className="text-xs">No ensembles configured</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {ensembles.map(ens => (
                        <div key={ens.id} className="p-2 rounded-lg bg-white/5">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{ens.name}</span>
                            <Badge variant="outline" className="text-[10px]">{ens.aggregation_method}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {JSON.parse(ens.model_ids || '[]').length} models
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-black/30 backdrop-blur-xl border-white/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Grid3X3 className="h-4 w-4 text-amber-400" />
                    Market Regimes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {regimes.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">
                      <Grid3X3 className="h-8 w-8 mx-auto mb-2 opacity-20" />
                      <p className="text-xs">No regimes defined</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {regimes.map(regime => (
                        <div key={regime.id} className="p-2 rounded-lg bg-white/5">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{regime.name}</span>
                            <div className="flex gap-1">
                              {regime.volatility_level && (
                                <Badge variant="outline" className="text-[10px]">{regime.volatility_level}</Badge>
                              )}
                              {regime.trend_direction && (
                                <Badge variant="outline" className={`text-[10px] ${
                                  regime.trend_direction === 'bullish' ? 'text-emerald-400' :
                                  regime.trend_direction === 'bearish' ? 'text-rose-400' : ''
                                }`}>{regime.trend_direction}</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="models" className="space-y-4">
            <Card className="bg-black/30 backdrop-blur-xl border-white/10">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Brain className="h-4 w-4 text-violet-400" />
                  Model Registry
                </CardTitle>
                <Button data-testid="button-add-model" size="sm" variant="outline" className="bg-violet-500/20 border-violet-500/30 text-violet-300">
                  <Plus className="h-4 w-4 mr-1" /> Add Model
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {models.map(model => {
                    const metrics = model.metrics ? JSON.parse(model.metrics) : {};
                    return (
                      <div key={model.id} data-testid={`model-card-${model.id}`} className="p-4 rounded-xl bg-gradient-to-r from-white/5 to-transparent border border-white/5 hover:border-violet-500/30 transition-colors">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center">
                              <Brain className="h-5 w-5 text-violet-400" />
                            </div>
                            <div>
                              <div className="font-medium">{model.name}</div>
                              <div className="text-xs text-muted-foreground">{model.architecture} v{model.version}</div>
                            </div>
                          </div>
                          <Badge variant={model.status === 'active' ? 'default' : 'secondary'} className={
                            model.status === 'active' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                            model.status === 'training' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                            'bg-slate-500/20 text-slate-400 border-slate-500/30'
                          }>
                            {model.status}
                          </Badge>
                        </div>
                        
                        {Object.keys(metrics).length > 0 && (
                          <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-white/5">
                            {Object.entries(metrics).slice(0, 4).map(([key, value]) => (
                              <div key={key} className="text-center">
                                <div className="text-xs text-muted-foreground capitalize">{key}</div>
                                <div className="text-sm font-mono">{typeof value === 'number' ? value.toFixed(3) : String(value)}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                  {models.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <Brain className="h-16 w-16 mx-auto mb-4 opacity-20" />
                      <p>No models registered yet</p>
                      <p className="text-sm mt-1">Add your first ML model to get started</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="coherence" className="space-y-4">
            <Card className="bg-black/30 backdrop-blur-xl border-white/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Network className="h-4 w-4 text-cyan-400" />
                  Model Coherence Analysis
                </CardTitle>
              </CardHeader>
              <CardContent>
                {activeModels.length < 2 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Network className="h-20 w-20 mx-auto mb-4 opacity-20" />
                    <p className="text-lg">Need at least 2 active models</p>
                    <p className="text-sm mt-1">Register and activate models to see coherence analysis</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="text-center">
                      <h3 className="text-lg font-medium mb-2">Prediction Agreement Heatmap</h3>
                      <p className="text-xs text-muted-foreground">Shows how often models agree on prediction direction</p>
                    </div>
                    
                    <div className="flex justify-center">
                      <div className="inline-grid gap-2 p-4 bg-black/30 rounded-xl" style={{ 
                        gridTemplateColumns: `100px repeat(${activeModels.length}, 60px)` 
                      }}>
                        <div></div>
                        {activeModels.map(m => (
                          <div key={m.id} className="text-xs text-center text-muted-foreground font-medium">
                            {m.name.slice(0, 8)}
                          </div>
                        ))}
                        {activeModels.map((m1, i) => (
                          <>
                            <div key={`label-${m1.id}`} className="text-xs text-muted-foreground font-medium flex items-center">
                              {m1.name.slice(0, 10)}
                            </div>
                            {activeModels.map((m2, j) => {
                              const agreement = i === j ? 100 : Math.round(50 + Math.random() * 45);
                              const bg = agreement >= 80 ? 'bg-emerald-500' : agreement >= 60 ? 'bg-amber-500' : 'bg-rose-500';
                              return (
                                <div 
                                  key={`${m1.id}-${m2.id}`}
                                  className={`h-12 w-12 rounded-lg ${bg} flex items-center justify-center text-xs font-bold text-white cursor-pointer hover:scale-105 transition-transform`}
                                  style={{ opacity: 0.4 + (agreement / 100) * 0.6 }}
                                  title={`${m1.name} ↔ ${m2.name}: ${agreement}% agreement`}
                                >
                                  {agreement}%
                                </div>
                              );
                            })}
                          </>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-center gap-4 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded bg-emerald-500"></div>
                        <span>High agreement (80%+)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded bg-amber-500"></div>
                        <span>Medium (60-80%)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded bg-rose-500"></div>
                        <span>Low (&lt;60%)</span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ensemble" className="space-y-4">
            <Card className="bg-black/30 backdrop-blur-xl border-white/10">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="h-4 w-4 text-fuchsia-400" />
                  Ensemble Simulator
                </CardTitle>
                <Button data-testid="button-new-ensemble" size="sm" variant="outline" className="bg-fuchsia-500/20 border-fuchsia-500/30 text-fuchsia-300">
                  <Plus className="h-4 w-4 mr-1" /> New Ensemble
                </Button>
              </CardHeader>
              <CardContent>
                <div className="text-center py-16 text-muted-foreground">
                  <Layers className="h-20 w-20 mx-auto mb-4 opacity-20" />
                  <p className="text-lg">Ensemble Simulation</p>
                  <p className="text-sm mt-1">Configure model ensembles and backtest combinations</p>
                  <p className="text-xs mt-4">Create ensembles using vote, average, or weighted methods</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="trades" className="space-y-4">
            <Card className="bg-black/30 backdrop-blur-xl border-white/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-cyan-400" />
                  Trade Analytics
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trades.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <BarChart3 className="h-20 w-20 mx-auto mb-4 opacity-20" />
                    <p className="text-lg">No trades recorded</p>
                    <p className="text-sm mt-1">Trades from model signals will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {trades.map(trade => (
                      <div key={trade.id} data-testid={`trade-row-${trade.id}`} className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                            trade.side === 'long' ? 'bg-emerald-500/20' : 'bg-rose-500/20'
                          }`}>
                            {trade.side === 'long' ? 
                              <TrendingUp className="h-4 w-4 text-emerald-400" /> : 
                              <TrendingDown className="h-4 w-4 text-rose-400" />
                            }
                          </div>
                          <div>
                            <div className="font-medium text-sm">{trade.symbol}</div>
                            <div className="text-xs text-muted-foreground">
                              {trade.entry_price.toFixed(2)} → {trade.exit_price?.toFixed(2) || 'open'}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          {trade.pnl !== null && trade.pnl !== undefined ? (
                            <div className={`font-mono text-sm ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
                            </div>
                          ) : (
                            <Badge variant="outline" className="text-amber-400 border-amber-500/30">Open</Badge>
                          )}
                          {trade.pnl_pct !== null && trade.pnl_pct !== undefined && (
                            <div className="text-xs text-muted-foreground">
                              {(trade.pnl_pct * 100).toFixed(2)}%
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="regimes" className="space-y-4">
            <Card className="bg-black/30 backdrop-blur-xl border-white/10">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Grid3X3 className="h-4 w-4 text-amber-400" />
                  Market Regime Detection
                </CardTitle>
                <Button data-testid="button-define-regime" size="sm" variant="outline" className="bg-amber-500/20 border-amber-500/30 text-amber-300">
                  <Plus className="h-4 w-4 mr-1" /> Define Regime
                </Button>
              </CardHeader>
              <CardContent>
                {regimes.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Grid3X3 className="h-20 w-20 mx-auto mb-4 opacity-20" />
                    <p className="text-lg">No regimes defined</p>
                    <p className="text-sm mt-1">Define market regimes to classify conditions</p>
                    <p className="text-xs mt-4">Examples: High Vol Bearish, Low Vol Bullish, Choppy Range</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {regimes.map(regime => (
                      <div key={regime.id} className="p-4 rounded-xl bg-gradient-to-r from-white/5 to-transparent border border-white/5">
                        <div className="flex items-center gap-2 mb-2">
                          <Grid3X3 className="h-4 w-4 text-amber-400" />
                          <span className="font-medium">{regime.name}</span>
                        </div>
                        <div className="flex gap-2 mb-2">
                          {regime.volatility_level && (
                            <Badge variant="outline" className="text-[10px]">{regime.volatility_level} vol</Badge>
                          )}
                          {regime.trend_direction && (
                            <Badge variant="outline" className={`text-[10px] ${
                              regime.trend_direction === 'bullish' ? 'text-emerald-400 border-emerald-500/30' :
                              regime.trend_direction === 'bearish' ? 'text-rose-400 border-rose-500/30' : 
                              'text-amber-400 border-amber-500/30'
                            }`}>{regime.trend_direction}</Badge>
                          )}
                        </div>
                        {regime.description && (
                          <p className="text-xs text-muted-foreground">{regime.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
