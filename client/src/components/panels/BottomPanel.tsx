import React, { useState, useMemo, useEffect, memo, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Brain, TrendingUp, TrendingDown, Activity, Zap, Target,
  BarChart3, Sparkles, Layers, FolderOpen, Clock, Tag, Wand2,
  Terminal, Trash2, ChevronUp, ChevronDown,
} from "lucide-react";

import { useDashboard, type DashboardLog } from "@/contexts/UnifiedDashboardContext";
import { PageLoader } from "@/components/LoadingSkeletons";
import type { MlModel, Trade } from "@/lib/types";
import { QUERY_KEYS } from "@/lib/types";

const ForecastVisualizer = lazy(() => import("@/components/ForecastVisualizer"));

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

// ─── TradeRow ───────────────────────────────────────────────────────────────

const TradeRow = memo(({ trade }: { trade: Trade }) => (
  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
    <div className="flex items-center gap-2.5">
      <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${trade.side === 'long' ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}>
        {trade.side === 'long' ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> : <TrendingDown className="h-3.5 w-3.5 text-rose-400" />}
      </div>
      <div className="min-w-0">
        <div className="font-medium text-xs truncate">{trade.symbol}</div>
        <div className="text-[10px] text-muted-foreground truncate">
          {trade.entry_price?.toFixed(2)} → {trade.exit_price?.toFixed(2) || 'open'}
        </div>
      </div>
    </div>
    <div className="text-right shrink-0">
      {trade.pnl !== null && trade.pnl !== undefined ? (
        <div className={`font-mono text-xs ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {trade.pnl >= 0 ? '+' : ''}{trade.pnl?.toFixed(2)}
        </div>
      ) : (
        <Badge className="bg-amber-500/20 text-amber-400 text-[9px]">Open</Badge>
      )}
    </div>
  </div>
));

// ─── Log Entry ──────────────────────────────────────────────────────────────

const logColors: Record<DashboardLog["level"], string> = {
  info: "text-blue-400",
  success: "text-emerald-400",
  warning: "text-amber-400",
  error: "text-rose-400",
};

const LogEntry = memo(({ log }: { log: DashboardLog }) => (
  <div className="flex items-start gap-2 py-1 px-2 hover:bg-white/5 rounded font-mono text-[11px]">
    <span className="text-muted-foreground/50 shrink-0 tabular-nums">
      {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false })}
    </span>
    <Badge variant="outline" className={`text-[8px] px-1 py-0 rounded shrink-0 border-transparent ${logColors[log.level]}`}>
      {log.level.toUpperCase()}
    </Badge>
    <span className="text-muted-foreground/60 shrink-0">[{log.source}]</span>
    <span className={`break-all ${logColors[log.level]}`}>{log.message}</span>
  </div>
));

// ─── Main BottomPanel Component ─────────────────────────────────────────────

interface BottomPanelProps {
  /** When true, panel is collapsed — show minimal chrome */
  isCollapsed?: boolean;
}

export function BottomPanel({ isCollapsed }: BottomPanelProps) {
  const dashboard = useDashboard();
  const [activeTab, setActiveTab] = useState("models");

  // Listen for cross-page tab navigation (e.g., context.navigateToMLHub("trades"))
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab;
      if (tab) setActiveTab(tab);
    };
    window.addEventListener("mlhub-tab", handler);
    return () => window.removeEventListener("mlhub-tab", handler);
  }, []);

  // ─── Data Queries (same as former MLHub) ──────────────────────────────

  const { data: models = [] } = useQuery<MlModel[]>({
    queryKey: [...QUERY_KEYS.mlModels],
    queryFn: async () => { const res = await fetch('/api/ml/models'); return res.json(); },
  });

  const { data: savedModelsData } = useQuery<{ models: SavedModel[] }>({
    queryKey: ['savedModels'],
    queryFn: async () => {
      const res = await fetch('/api/ml/saved-models');
      if (!res.ok) return { models: [] };
      return res.json();
    },
  });
  const savedModels = savedModelsData?.models || [];

  const { data: trades = [] } = useQuery<Trade[]>({
    queryKey: ["/api/ml/trades"],
    queryFn: async () => { const res = await fetch("/api/ml/trades?limit=50"); return res.json(); },
  });

  const { data: featureInfo } = useQuery({
    queryKey: ['universalFeatures'],
    queryFn: async () => {
      const res = await fetch('/api/ml/universal/features');
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: trainingStatus } = useQuery({
    queryKey: ['trainingStatus'],
    queryFn: async () => {
      const res = await fetch('/api/ml/train/status');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 5000,
  });

  // ─── Derived metrics ──────────────────────────────────────────────────

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
  const logs = dashboard.logs;

  if (isCollapsed) {
    return (
      <div className="h-full flex items-center justify-center px-2">
        <span className="text-[10px] text-muted-foreground/60 font-mono tracking-widest [writing-mode:vertical-lr] rotate-180">
          PANEL
        </span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center gap-2 px-3 pt-1.5 pb-1 border-b border-white/5 shrink-0">
          <TabsList className="glass rounded-lg p-0.5 h-auto w-fit">
            <TabsTrigger value="models" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-primary/20 gap-1">
              <Brain className="h-3 w-3" /> Models
              {savedModels.length > 0 && <Badge variant="outline" className="text-[8px] px-1 py-0 rounded-full ml-0.5">{savedModels.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="forecast" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-400 gap-1">
              <Wand2 className="h-3 w-3" /> Forecast
            </TabsTrigger>
            <TabsTrigger value="trades" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-primary/20 gap-1">
              <BarChart3 className="h-3 w-3" /> Trades
              {tradeMetrics.totalTrades > 0 && <Badge variant="outline" className="text-[8px] px-1 py-0 rounded-full ml-0.5">{tradeMetrics.totalTrades}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="logs" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-violet-500/15 data-[state=active]:text-violet-400 gap-1">
              <Terminal className="h-3 w-3" /> Log
              {logs.length > 0 && <Badge variant="outline" className="text-[8px] px-1 py-0 rounded-full ml-0.5">{logs.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* Status indicator */}
          <div className="ml-auto flex items-center gap-2">
            {isTraining && (
              <Badge variant="outline" className="text-[9px] px-2 py-0.5 rounded-full border-green-500/30 text-green-400 bg-green-500/10 font-mono gap-1">
                <Brain className="h-3 w-3 pulse-slow" /> Training
              </Badge>
            )}
          </div>
        </div>

        {/* ─── Models Tab ──────────────────────────────────────────────── */}
        <TabsContent value="models" className="flex-1 min-h-0 overflow-auto mt-0 p-3 space-y-3">
          {/* Quick stat pills */}
          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
              <Brain className="h-3 w-3 text-primary" />
              <span className="text-[10px] text-muted-foreground">Models</span>
              <span className="text-xs font-bold font-mono text-foreground">{savedModels.length}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <Sparkles className="h-3 w-3 text-cyan-400" />
              <span className="text-[10px] text-muted-foreground">Features</span>
              <span className="text-xs font-bold font-mono text-cyan-400">{featureInfo?.count || 31}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <TrendingUp className="h-3 w-3 text-emerald-400" />
              <span className="text-[10px] text-muted-foreground">Win Rate</span>
              <span className="text-xs font-bold font-mono text-emerald-400">{tradeMetrics.winRate.toFixed(1)}%</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <Zap className="h-3 w-3 text-amber-400" />
              <span className="text-[10px] text-muted-foreground">Trades</span>
              <span className="text-xs font-bold font-mono text-amber-400">{tradeMetrics.totalTrades}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Saved Models list */}
            <Card className="lg:col-span-2 glass rounded-xl gradient-border flex flex-col">
              <CardHeader className="border-b border-white/5 py-2 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <FolderOpen className="h-3.5 w-3.5 text-primary" /> Saved Models
                </CardTitle>
              </CardHeader>
              <ScrollArea className="flex-1 max-h-[260px]">
                <CardContent className="p-2 space-y-1.5">
                  {savedModels.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Brain className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="text-xs font-medium">No Saved Models</p>
                      <p className="text-[10px] mt-1 text-muted-foreground/60">Train a model using the sidebar</p>
                    </div>
                  ) : (
                    savedModels.map((model) => (
                      <div key={model.name} className="flex items-center justify-between p-2.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-md bg-primary/20 flex items-center justify-center">
                            <Brain className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <div className="font-medium text-xs">{model.name}</div>
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                              <Tag className="h-2.5 w-2.5" />
                              {model.symbol}
                              {model.metrics?.pipeline && (
                                <Badge variant="outline" className="text-[8px] rounded-full px-1 py-0 border-cyan-500/30 text-cyan-400">
                                  {model.metrics.pipeline}
                                </Badge>
                              )}
                              {model.metrics?.labelType && (
                                <Badge variant="outline" className="text-[8px] rounded-full px-1 py-0 border-amber-500/30 text-amber-400">
                                  {model.metrics.labelType}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right space-y-0.5">
                          {model.metrics?.finalAccuracy != null && (
                            <div className="text-xs font-mono text-emerald-400">
                              {(model.metrics.finalAccuracy * 100).toFixed(1)}% acc
                            </div>
                          )}
                          {model.metrics?.finalValLoss != null && (
                            <div className="text-[10px] font-mono text-muted-foreground">
                              val: {model.metrics.finalValLoss.toFixed(4)}
                            </div>
                          )}
                          <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                            <Clock className="h-2.5 w-2.5" />
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
            <Card className="glass rounded-xl gradient-border flex flex-col">
              <CardHeader className="border-b border-white/5 py-2 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-cyan-400" /> Features
                  <Badge variant="outline" className="ml-auto text-[8px] rounded-full border-cyan-500/30 text-cyan-400 bg-cyan-500/10 font-mono">
                    {featureInfo?.count || 31}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <ScrollArea className="flex-1 max-h-[260px]">
                <CardContent className="p-2 space-y-2">
                  {featureInfo?.categories ? (
                    Object.entries(featureInfo.categories as Record<string, string[]>)
                      .filter(([_, features]) => features.length > 0)
                      .map(([category, features]) => (
                        <div key={category}>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] font-medium capitalize text-foreground">{category}</span>
                            <span className="text-[9px] font-mono text-muted-foreground">{features.length}</span>
                          </div>
                          <div className="flex flex-wrap gap-0.5">
                            {features.map((feat: string) => (
                              <Badge key={feat} variant="outline" className="text-[8px] rounded-full border-white/10 px-1 py-0">
                                {feat}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))
                  ) : (
                    <div className="text-center py-6 text-muted-foreground">
                      <Sparkles className="h-6 w-6 mx-auto mb-2 opacity-30" />
                      <p className="text-[10px]">Loading features...</p>
                    </div>
                  )}
                </CardContent>
              </ScrollArea>
            </Card>
          </div>

          {/* DB Model Registry */}
          {models.length > 0 && (
            <Card className="glass rounded-xl gradient-border">
              <CardHeader className="border-b border-white/5 py-2 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <Layers className="h-3.5 w-3.5 text-primary" /> Model Registry
                  <Badge variant="outline" className="ml-auto text-[8px] rounded-full border-primary/30 font-mono">{models.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-2">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
                  {models.slice(0, 8).map((model) => {
                    let metrics: any = {};
                    try { if (model.metrics) metrics = JSON.parse(model.metrics); } catch {}
                    return (
                      <div key={model.id} className="p-2.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Brain className="h-3 w-3 text-primary" />
                          <span className="text-[10px] font-medium truncate">{model.name}</span>
                          <Badge variant="outline" className={`ml-auto text-[8px] rounded-full ${
                            model.status === 'active' ? 'border-green-500/50 text-green-400 bg-green-500/10' :
                            model.status === 'training' ? 'border-amber-500/50 text-amber-400 bg-amber-500/10' :
                            'border-muted-foreground/30'
                          }`}>
                            {model.status}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                          {metrics.finalAccuracy != null && (
                            <>
                              <span className="text-muted-foreground">Acc</span>
                              <span className="font-mono text-emerald-400 text-right">{(metrics.finalAccuracy * 100).toFixed(1)}%</span>
                            </>
                          )}
                          {metrics.finalValLoss != null && (
                            <>
                              <span className="text-muted-foreground">Val</span>
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
        <TabsContent value="forecast" className="flex-1 min-h-0 overflow-auto mt-0 p-3">
          <Suspense fallback={<PageLoader />}>
            <ForecastVisualizer />
          </Suspense>
        </TabsContent>

        {/* ─── Trades Tab ──────────────────────────────────────────────── */}
        <TabsContent value="trades" className="flex-1 min-h-0 overflow-auto mt-0 p-3 space-y-3">
          {/* Compact trade stat pills */}
          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-muted-foreground/10">
              <BarChart3 className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Total</span>
              <span className="text-xs font-bold font-mono">{tradeMetrics.totalTrades}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <TrendingUp className="h-3 w-3 text-emerald-400" />
              <span className="text-[10px] text-muted-foreground">Win</span>
              <span className="text-xs font-bold font-mono text-emerald-400">{tradeMetrics.winRate.toFixed(1)}%</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
              <Zap className="h-3 w-3 text-primary" />
              <span className="text-[10px] text-muted-foreground">P&L</span>
              <span className={`text-xs font-bold font-mono ${tradeMetrics.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {tradeMetrics.totalPnl >= 0 ? '+' : ''}${tradeMetrics.totalPnl.toFixed(0)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <Target className="h-3 w-3 text-cyan-400" />
              <span className="text-[10px] text-muted-foreground">PF</span>
              <span className="text-xs font-bold font-mono text-cyan-400">
                {tradeMetrics.profitFactor === Infinity ? '∞' : tradeMetrics.profitFactor.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <Activity className="h-3 w-3 text-amber-400" />
              <span className="text-[10px] text-muted-foreground">Avg W/L</span>
              <span className="text-xs font-mono">
                <span className="text-emerald-400">+{tradeMetrics.avgWin.toFixed(0)}</span>
                <span className="text-muted-foreground mx-0.5">/</span>
                <span className="text-rose-400">-{tradeMetrics.avgLoss.toFixed(0)}</span>
              </span>
            </div>
            {tradeMetrics.openTrades > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20">
                <TrendingDown className="h-3 w-3 text-rose-400" />
                <span className="text-[10px] text-muted-foreground">Open</span>
                <span className="text-xs font-bold font-mono text-rose-400">{tradeMetrics.openTrades}</span>
              </div>
            )}
          </div>

          {/* Trade list + breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card className="lg:col-span-2 glass rounded-xl gradient-border flex flex-col">
              <CardHeader className="border-b border-white/5 py-2 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <BarChart3 className="h-3.5 w-3.5 text-cyan-400" /> Trade History
                  <Badge variant="outline" className="ml-auto text-[8px] rounded-full border-muted-foreground/30 font-mono">{trades.length}</Badge>
                </CardTitle>
              </CardHeader>
              <ScrollArea className="flex-1 max-h-[250px]">
                <CardContent className="p-2">
                  {trades.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="text-xs font-medium">No Trades</p>
                      <p className="text-[10px] mt-1 text-muted-foreground/60">Trades appear after signal execution</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {trades.map(trade => <TradeRow key={trade.id} trade={trade} />)}
                    </div>
                  )}
                </CardContent>
              </ScrollArea>
            </Card>

            <Card className="glass rounded-xl gradient-border flex flex-col">
              <CardHeader className="border-b border-white/5 py-2 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5 text-primary" /> Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-3">
                {/* Win/Loss bars */}
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-emerald-400 font-medium">Winners</span>
                      <span className="text-muted-foreground">{tradeMetrics.winners}</span>
                    </div>
                    <div className="h-2 bg-black/40 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-linear-to-r from-emerald-600 to-emerald-400 rounded-full transition-all"
                        style={{ width: `${tradeMetrics.totalTrades > 0 ? (tradeMetrics.winners / tradeMetrics.totalTrades) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-rose-400 font-medium">Losers</span>
                      <span className="text-muted-foreground">{tradeMetrics.losers}</span>
                    </div>
                    <div className="h-2 bg-black/40 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-linear-to-r from-rose-600 to-rose-400 rounded-full transition-all"
                        style={{ width: `${tradeMetrics.totalTrades > 0 ? (tradeMetrics.losers / tradeMetrics.totalTrades) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Metrics */}
                <div className="pt-2.5 border-t border-white/10 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-muted-foreground">Best</span>
                    <span className="text-xs font-mono text-emerald-400">
                      +${trades.length > 0 ? Math.max(...trades.map(t => t.pnl || 0)).toFixed(2) : '0.00'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-muted-foreground">Worst</span>
                    <span className="text-xs font-mono text-rose-400">
                      ${trades.length > 0 ? Math.min(...trades.map(t => t.pnl || 0)).toFixed(2) : '0.00'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-muted-foreground">R:R</span>
                    <span className="text-xs font-mono text-muted-foreground">
                      {tradeMetrics.avgLoss > 0 ? (tradeMetrics.avgWin / tradeMetrics.avgLoss).toFixed(2) : '∞'}:1
                    </span>
                  </div>
                </div>

                {/* R:R bar */}
                <div className="pt-2.5 border-t border-white/10">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2.5 bg-black/40 rounded-full overflow-hidden flex">
                      <div className="h-full bg-emerald-500" style={{ width: `${tradeMetrics.avgLoss > 0 ? Math.min((tradeMetrics.avgWin / (tradeMetrics.avgWin + tradeMetrics.avgLoss)) * 100, 100) : 50}%` }} />
                      <div className="h-full bg-rose-500" style={{ width: `${tradeMetrics.avgWin > 0 ? Math.min((tradeMetrics.avgLoss / (tradeMetrics.avgWin + tradeMetrics.avgLoss)) * 100, 100) : 50}%` }} />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Training Log Tab ────────────────────────────────────────── */}
        <TabsContent value="logs" className="flex-1 min-h-0 overflow-hidden mt-0 flex flex-col">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 shrink-0">
            <Terminal className="h-3 w-3 text-violet-400" />
            <span className="text-[10px] text-muted-foreground font-mono">Training & System Log</span>
            <span className="text-[9px] text-muted-foreground/50 font-mono">{logs.length} entries</span>
            {logs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-5 px-2 text-[9px] text-muted-foreground hover:text-rose-400"
                onClick={() => dashboard.clearLogs()}
              >
                <Trash2 className="h-2.5 w-2.5 mr-1" /> Clear
              </Button>
            )}
          </div>
          <ScrollArea className="flex-1">
            <div className="p-1 space-y-0">
              {logs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Terminal className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <p className="text-xs font-medium">No Log Entries</p>
                  <p className="text-[10px] mt-1 text-muted-foreground/60">Training events and system messages appear here</p>
                </div>
              ) : (
                [...logs].reverse().map(log => <LogEntry key={log.id} log={log} />)
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
