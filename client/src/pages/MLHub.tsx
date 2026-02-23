import React, { useState, useEffect, useMemo, memo, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Brain, TrendingUp, TrendingDown, Activity, Zap, Target,
  BarChart3, Sparkles, Layers, Eye, FolderOpen, Clock, Tag, Wand2, ArrowRight
} from "lucide-react";

import { useBreadcrumbs } from "@/hooks/useBreadcrumbs";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { PageLoader } from "@/components/LoadingSkeletons";
import { useLocation } from "wouter";

const ForecastVisualizer = lazy(() => import("@/components/ForecastVisualizer"));
import { MlModel, Trade, QUERY_KEYS } from "@/lib/types";
import { fetchArray } from "@/lib/fetchArray";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SavedModel {
  name: string;
  symbol: string;
  path: string;
  savedAt: string;
  pgModelId?: number;
  metrics?: {
    finalLoss?: number;
    finalValLoss?: number;
    finalAccuracy?: number;
    trainingTime?: number;
    epochs?: number;
    pipeline?: string;
    labelType?: string;
  };
}

// ─── TradeRow Component ─────────────────────────────────────────────────────

const TradeRow = memo(({ trade }: { trade: Trade }) => (
  <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
    <div className="flex items-center gap-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${trade.side === 'long' ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}>
        {trade.side === 'long' ? <TrendingUp className="h-4 w-4 text-emerald-400" /> : <TrendingDown className="h-4 w-4 text-rose-400" />}
      </div>
      <div className="min-w-0">
        <div className="font-medium text-sm truncate">{trade.symbol}</div>
        <div className="text-xs text-muted-foreground truncate">
          {trade.entry_price?.toFixed(2)} → {trade.exit_price?.toFixed(2) || 'open'}
        </div>
      </div>
    </div>
    <div className="text-right shrink-0">
      {trade.pnl !== null && trade.pnl !== undefined ? (
        <div className={`font-mono text-sm ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {trade.pnl >= 0 ? '+' : ''}{trade.pnl?.toFixed(2)}
        </div>
      ) : (
        <Badge className="bg-amber-500/20 text-amber-400 text-[10px]">Open</Badge>
      )}
    </div>
  </div>
));

// ─── Main Component ─────────────────────────────────────────────────────────

export default function MLHub() {
  const dashboard = useDashboard();
  const [activeTab, setActiveTab] = useState("overview");
  // Sync symbol with unified context — MLHub and MarketData share the same symbol
  const [selectedSymbol, setSelectedSymbolLocal] = useState(dashboard.symbol);
  const setSelectedSymbol = (sym: string) => {
    setSelectedSymbolLocal(sym);
    dashboard.setSymbol(sym);
  };
  // Listen for context changes from other pages (e.g., MarketData symbol change)
  useEffect(() => {
    if (dashboard.symbol !== selectedSymbol) {
      setSelectedSymbolLocal(dashboard.symbol);
    }
  }, [dashboard.symbol]);
  // Listen for cross-page tab navigation (e.g., "View on chart" → ML Hub training tab)
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab;
      if (tab) setActiveTab(tab);
    };
    window.addEventListener("mlhub-tab", handler);
    return () => window.removeEventListener("mlhub-tab", handler);
  }, []);

  const tabLabels: Record<string, string> = {
    overview: "Overview", forecast: "Forecast", trades: "Trades",
  };
  useBreadcrumbs([{ label: tabLabels[activeTab] ?? activeTab }]);

  const [, navigate] = useLocation();

  // ─── Data Queries ───────────────────────────────────────────────────────

  const { data: instruments = [] } = useQuery({
    queryKey: ['instruments'],
    queryFn: () => fetchArray('/api/instruments'),
  });

  const { data: models = [] } = useQuery<MlModel[]>({
    queryKey: [...QUERY_KEYS.mlModels],
    queryFn: () => fetchArray<MlModel>('/api/ml/models'),
  });

  const { data: savedModelsData } = useQuery<{ models: SavedModel[] }>({
    queryKey: ['savedModels'],
    queryFn: async () => {
      const res = await fetch('/api/ml/saved-models');
      if (!res.ok) return { models: [] };
      return res.json();
    }
  });
  const savedModels = savedModelsData?.models || [];

  const { data: trainingStatus } = useQuery({
    queryKey: ['trainingStatus'],
    queryFn: async () => {
      const res = await fetch('/api/ml/train/status');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: trades = [] } = useQuery<Trade[]>({
    queryKey: ["/api/ml/trades"],
    queryFn: () => fetchArray<Trade>("/api/ml/trades?limit=50"),
  });

  const { data: featureInfo } = useQuery({
    queryKey: ['universalFeatures'],
    queryFn: async () => {
      const res = await fetch('/api/ml/universal/features');
      if (!res.ok) return null;
      return res.json();
    }
  });

  // ─── Derived Metrics ────────────────────────────────────────────────────

  const tradeMetrics = useMemo(() => {
    const closed = trades.filter(t => t.status === 'closed');
    const winners = closed.filter(t => (t.pnl || 0) > 0);
    const losers = closed.filter(t => (t.pnl || 0) < 0);
    const totalPnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const grossWin = winners.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const grossLoss = Math.abs(losers.reduce((sum, t) => sum + (t.pnl || 0), 0));
    const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
    const avgWin = winners.length > 0 ? grossWin / winners.length : 0;
    const avgLoss = losers.length > 0 ? grossLoss / losers.length : 0;
    const openTrades = trades.filter(t => t.status === 'open').length;
    return { totalTrades: closed.length, winRate, totalPnl, profitFactor, avgWin, avgLoss, openTrades, winners: winners.length, losers: losers.length };
  }, [trades]);

  const isTraining = trainingStatus?.active === true;
  const futuresSymbols = instruments.filter((i: any) => i.assetType === 'futures').map((i: any) => i.symbol);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center mb-4 shrink-0 px-1">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground">ML Hub</h1>
          <p className="text-sm text-muted-foreground mt-1">Universal Trading Agent — Train, Backtest, Analyze</p>
        </div>
        <div className="flex gap-3 items-center">
          <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
            <SelectTrigger className="w-28 h-10 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {futuresSymbols.map((sym: string) => (
                <SelectItem key={sym} value={sym}>{sym}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="outline" className={`h-10 px-4 font-mono gap-2 text-sm rounded-full ${
            isTraining ? 'border-green-500/30 text-green-400 bg-green-500/10' : 'border-muted-foreground/30 text-muted-foreground'
          }`}>
            <Brain className={`h-4 w-4 ${isTraining ? 'pulse-slow' : ''}`} />
            {isTraining ? 'Training Active' : 'Idle'}
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center gap-3 shrink-0">
          <TabsList className="glass rounded-xl p-1 h-auto w-fit">
            <TabsTrigger value="overview" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20">
              <Layers className="h-3.5 w-3.5 mr-1.5" /> Overview
            </TabsTrigger>
            <TabsTrigger value="forecast" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-400">
              <Wand2 className="h-3.5 w-3.5 mr-1.5" /> Forecast
            </TabsTrigger>
            <TabsTrigger value="trades" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Trades
            </TabsTrigger>
          </TabsList>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => navigate("/")}
          >
            <ArrowRight className="h-3.5 w-3.5" /> Train / Backtest on Chart
          </Button>
        </div>

        {/* ─── Overview Tab ────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="flex-1 min-h-0 overflow-auto mt-4 space-y-4">
          {/* Quick Stats */}
          <div className="grid grid-cols-4 gap-3">
            <Card className="glass rounded-xl p-4 border border-primary/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Brain className="h-4 w-4 text-primary" />
                </div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Saved Models</div>
              </div>
              <div className="text-3xl font-bold font-mono text-foreground">{savedModels.length}</div>
            </Card>
            <Card className="glass rounded-xl p-4 border border-cyan-500/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-cyan-400" />
                </div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Features</div>
              </div>
              <div className="text-3xl font-bold font-mono text-cyan-400">{featureInfo?.count || 31}</div>
            </Card>
            <Card className="glass rounded-xl p-4 border border-emerald-500/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Trades</div>
              </div>
              <div className="text-3xl font-bold font-mono text-emerald-400">{tradeMetrics.totalTrades}</div>
            </Card>
            <Card className="glass rounded-xl p-4 border border-amber-500/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                  <Zap className="h-4 w-4 text-amber-400" />
                </div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Win Rate</div>
              </div>
              <div className="text-3xl font-bold font-mono text-amber-400">{tradeMetrics.winRate.toFixed(1)}%</div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Saved Models */}
            <Card className="lg:col-span-2 glass rounded-2xl gradient-border flex flex-col">
              <CardHeader className="border-b border-white/5 py-3 px-4">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-primary" /> Saved Models
                  <Badge variant="outline" className="ml-auto text-[10px] rounded-full border-primary/30 text-primary bg-primary/10 font-mono">
                    {savedModels.length} models
                  </Badge>
                </CardTitle>
              </CardHeader>
              <ScrollArea className="flex-1 max-h-[400px]">
                <CardContent className="p-3 space-y-2">
                  {savedModels.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Brain className="h-12 w-12 mx-auto mb-4 opacity-30" />
                      <p className="text-sm font-medium">No Saved Models</p>
                      <p className="text-xs mt-1 text-muted-foreground/60">Train a model to see it here</p>
                    </div>
                  ) : (
                    savedModels.map((model) => (
                      <div key={model.name} className="flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                            <Brain className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <div className="font-medium text-sm">{model.name}</div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                              <Tag className="h-3 w-3" />
                              {model.symbol}
                              {model.metrics?.pipeline && (
                                <Badge variant="outline" className="text-[9px] rounded-full px-1.5 py-0 border-cyan-500/30 text-cyan-400">
                                  {model.metrics.pipeline}
                                </Badge>
                              )}
                              {model.metrics?.labelType && (
                                <Badge variant="outline" className="text-[9px] rounded-full px-1.5 py-0 border-amber-500/30 text-amber-400">
                                  {model.metrics.labelType}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right space-y-1">
                          {model.metrics?.finalAccuracy != null && (
                            <div className="text-sm font-mono text-emerald-400">
                              {(model.metrics.finalAccuracy * 100).toFixed(1)}% acc
                            </div>
                          )}
                          {model.metrics?.finalValLoss != null && (
                            <div className="text-xs font-mono text-muted-foreground">
                              val: {model.metrics.finalValLoss.toFixed(4)}
                            </div>
                          )}
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {new Date(model.savedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </ScrollArea>
            </Card>

            {/* Feature Pipeline */}
            <Card className="glass rounded-2xl gradient-border flex flex-col">
              <CardHeader className="border-b border-white/5 py-3 px-4">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-cyan-400" /> Universal Features
                  <Badge variant="outline" className="ml-auto text-[10px] rounded-full border-cyan-500/30 text-cyan-400 bg-cyan-500/10 font-mono">
                    {featureInfo?.count || 31} features
                  </Badge>
                </CardTitle>
              </CardHeader>
              <ScrollArea className="flex-1 max-h-[400px]">
                <CardContent className="p-3 space-y-3">
                  {featureInfo?.categories ? (
                    Object.entries(featureInfo.categories as Record<string, string[]>)
                      .filter(([_, features]) => features.length > 0)
                      .map(([category, features]) => (
                        <div key={category}>
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="text-xs font-medium capitalize text-foreground">{category}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{features.length}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {features.map((feat: string) => (
                              <Badge key={feat} variant="outline" className="text-[9px] rounded-full border-white/10 px-1.5 py-0">
                                {feat}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-30" />
                      <p className="text-xs">Loading feature pipeline...</p>
                    </div>
                  )}
                </CardContent>
              </ScrollArea>
            </Card>
          </div>

          {/* DB Models (PostgreSQL registry) */}
          {models.length > 0 && (
            <Card className="glass rounded-2xl gradient-border">
              <CardHeader className="border-b border-white/5 py-3 px-4">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" /> Model Registry
                  <Badge variant="outline" className="ml-auto text-[10px] rounded-full border-primary/30 font-mono">
                    {models.length} registered
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                  {models.slice(0, 8).map((model) => {
                    let metrics: any = {};
                    try { if (model.metrics) metrics = JSON.parse(model.metrics); } catch {}
                    return (
                      <div key={model.id} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                        <div className="flex items-center gap-2 mb-2">
                          <Brain className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium truncate">{model.name}</span>
                          <Badge variant="outline" className={`ml-auto text-[9px] rounded-full ${
                            model.status === 'active' ? 'border-green-500/50 text-green-400 bg-green-500/10' :
                            model.status === 'training' ? 'border-amber-500/50 text-amber-400 bg-amber-500/10' :
                            'border-muted-foreground/30'
                          }`}>
                            {model.status}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          {metrics.finalAccuracy != null && (
                            <>
                              <span className="text-muted-foreground">Accuracy</span>
                              <span className="font-mono text-emerald-400 text-right">{(metrics.finalAccuracy * 100).toFixed(1)}%</span>
                            </>
                          )}
                          {metrics.finalValLoss != null && (
                            <>
                              <span className="text-muted-foreground">Val Loss</span>
                              <span className="font-mono text-right">{metrics.finalValLoss.toFixed(4)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── Forecast Tab ────────────────────────────────────────────── */}
        <TabsContent value="forecast" className="flex-1 min-h-0 overflow-auto mt-4">
          <Suspense fallback={<PageLoader />}>
            <ForecastVisualizer />
          </Suspense>
        </TabsContent>

        {/* ─── Trades Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="trades" className="flex-1 min-h-0 overflow-auto mt-4 space-y-4">
          {/* Trade Statistics */}
          <div className="grid grid-cols-6 gap-3">
            <Card className="glass rounded-xl p-4 border border-muted-foreground/10">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-muted/30 flex items-center justify-center">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</div>
              </div>
              <div className="text-3xl font-bold font-mono text-foreground">{tradeMetrics.totalTrades}</div>
            </Card>
            <Card className="glass rounded-xl p-4 border border-emerald-500/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="text-[10px] text-emerald-300/70 uppercase tracking-wider">Win Rate</div>
              </div>
              <div className="text-3xl font-bold font-mono text-emerald-400">{tradeMetrics.winRate.toFixed(1)}%</div>
            </Card>
            <Card className="glass rounded-xl p-4 border border-primary/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Zap className="h-4 w-4 text-primary" />
                </div>
                <div className="text-[10px] text-primary/70 uppercase tracking-wider">Total P&L</div>
              </div>
              <div className={`text-3xl font-bold font-mono ${tradeMetrics.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {tradeMetrics.totalPnl >= 0 ? '+' : ''}${tradeMetrics.totalPnl.toFixed(0)}
              </div>
            </Card>
            <Card className="glass rounded-xl p-4 border border-cyan-500/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                  <Target className="h-4 w-4 text-cyan-400" />
                </div>
                <div className="text-[10px] text-cyan-300/70 uppercase tracking-wider">Profit Factor</div>
              </div>
              <div className="text-3xl font-bold font-mono text-cyan-400">{tradeMetrics.profitFactor === Infinity ? '∞' : tradeMetrics.profitFactor.toFixed(2)}</div>
            </Card>
            <Card className="glass rounded-xl p-4 border border-amber-500/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                  <Activity className="h-4 w-4 text-amber-400" />
                </div>
                <div className="text-[10px] text-amber-300/70 uppercase tracking-wider">Expectancy</div>
              </div>
              <div className={`text-3xl font-bold font-mono ${tradeMetrics.totalPnl >= 0 ? 'text-amber-400' : 'text-rose-400'}`}>
                {tradeMetrics.totalTrades > 0 ? `${tradeMetrics.totalPnl >= 0 ? '+' : ''}$${(tradeMetrics.totalPnl / tradeMetrics.totalTrades).toFixed(2)}` : '--'}
              </div>
            </Card>
            <Card className="glass rounded-xl p-4 border border-rose-500/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-rose-500/20 flex items-center justify-center">
                  <TrendingDown className="h-4 w-4 text-rose-400" />
                </div>
                <div className="text-[10px] text-rose-300/70 uppercase tracking-wider">Open</div>
              </div>
              <div className="text-3xl font-bold font-mono text-rose-400">{tradeMetrics.openTrades}</div>
            </Card>
          </div>

          {/* Trade History + Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2 glass rounded-2xl gradient-border flex flex-col">
              <CardHeader className="border-b border-white/5 py-3 px-4">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-cyan-400" /> Trade History
                  <Badge variant="outline" className="ml-auto text-[10px] rounded-full border-muted-foreground/30 font-mono">
                    {trades.length} trades
                  </Badge>
                </CardTitle>
              </CardHeader>
              <ScrollArea className="flex-1 max-h-[400px]">
                <CardContent className="p-3">
                  {trades.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground">
                      <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-30" />
                      <p className="text-sm font-medium">No Trades Recorded</p>
                      <p className="text-xs mt-1 text-muted-foreground/60">Trades will appear here after signal execution</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {trades.map(trade => (
                        <TradeRow key={trade.id} trade={trade} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </ScrollArea>
            </Card>

            <Card className="glass rounded-2xl gradient-border flex flex-col">
              <CardHeader className="border-b border-white/5 py-3 px-4">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" /> Performance Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                {/* Win/Loss bars */}
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-emerald-400 font-medium">Winners</span>
                      <span className="text-muted-foreground">{tradeMetrics.winners} trades</span>
                    </div>
                    <div className="h-2.5 bg-black/40 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-linear-to-r from-emerald-600 to-emerald-400 rounded-full transition-all"
                        style={{ width: `${tradeMetrics.totalTrades > 0 ? (tradeMetrics.winners / tradeMetrics.totalTrades) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-rose-400 font-medium">Losers</span>
                      <span className="text-muted-foreground">{tradeMetrics.losers} trades</span>
                    </div>
                    <div className="h-2.5 bg-black/40 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-linear-to-r from-rose-600 to-rose-400 rounded-full transition-all"
                        style={{ width: `${tradeMetrics.totalTrades > 0 ? (tradeMetrics.losers / tradeMetrics.totalTrades) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Metrics */}
                <div className="pt-4 border-t border-white/10 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Avg Win</span>
                    <span className="text-sm font-mono text-emerald-400">+${tradeMetrics.avgWin.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Avg Loss</span>
                    <span className="text-sm font-mono text-rose-400">-${tradeMetrics.avgLoss.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Best Trade</span>
                    <span className="text-sm font-mono text-emerald-400">
                      +${trades.length > 0 ? Math.max(...trades.map(t => t.pnl || 0)).toFixed(2) : '0.00'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Worst Trade</span>
                    <span className="text-sm font-mono text-rose-400">
                      ${trades.length > 0 ? Math.min(...trades.map(t => t.pnl || 0)).toFixed(2) : '0.00'}
                    </span>
                  </div>
                </div>

                {/* Risk/Reward */}
                <div className="pt-4 border-t border-white/10">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-3">Risk/Reward Ratio</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-3 bg-black/40 rounded-full overflow-hidden flex">
                      <div className="h-full bg-emerald-500" style={{ width: `${tradeMetrics.avgLoss > 0 ? Math.min((tradeMetrics.avgWin / (tradeMetrics.avgWin + tradeMetrics.avgLoss)) * 100, 100) : 50}%` }} />
                      <div className="h-full bg-rose-500" style={{ width: `${tradeMetrics.avgWin > 0 ? Math.min((tradeMetrics.avgLoss / (tradeMetrics.avgWin + tradeMetrics.avgLoss)) * 100, 100) : 50}%` }} />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">
                      {tradeMetrics.avgLoss > 0 ? (tradeMetrics.avgWin / tradeMetrics.avgLoss).toFixed(2) : '∞'}:1
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

      </Tabs>
    </div>
  );
}
