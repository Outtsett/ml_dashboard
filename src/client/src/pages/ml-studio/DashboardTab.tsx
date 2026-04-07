import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatCard } from "@/components/ui/stat-card";
import {
  Brain, TrendingUp, Target, FolderOpen, Clock, Tag,
  Activity, Shield, BarChart3, Crosshair,
} from "lucide-react";
import type { EnrichedCheckpoint, CheckpointAggregateStats } from "@/hooks/useModelCheckpoints";

// ── Metric Formatting ───────────────────────────────────────────────────────

function fmtPF(v: number | null): string {
  if (v == null) return "--";
  return v.toFixed(2);
}

function fmtSharpe(v: number | null): string {
  if (v == null) return "--";
  return v.toFixed(2);
}

function fmtPct(v: number | null): string {
  if (v == null) return "--";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtInt(v: number | null): string {
  if (v == null) return "--";
  return Math.round(v).toLocaleString();
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return "--";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

// ── Color Thresholds ────────────────────────────────────────────────────────

function pfColor(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 2.0) return "text-emerald-400";
  if (v >= 1.5) return "text-emerald-400/80";
  if (v >= 1.0) return "text-amber-400";
  return "text-rose-400";
}

function sharpeColor(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 2.0) return "text-emerald-400";
  if (v >= 1.0) return "text-emerald-400/80";
  if (v >= 0) return "text-amber-400";
  return "text-rose-400";
}

function wrColor(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 0.55) return "text-emerald-400";
  if (v >= 0.50) return "text-amber-400";
  return "text-rose-400";
}

function ddColor(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v <= 0.05) return "text-emerald-400";
  if (v <= 0.10) return "text-amber-400";
  return "text-rose-400";
}

// ── Metric Cell ─────────────────────────────────────────────────────────────

function MetricCell({ label, value, colorFn }: { label: string; value: string; colorFn: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">{label}</span>
      <span className={`text-sm font-mono font-semibold ${colorFn}`}>{value}</span>
    </div>
  );
}

// ── Props ────────────────────────────────────────────────────────────────────

interface DashboardTabProps {
  checkpoints: EnrichedCheckpoint[];
  stats: CheckpointAggregateStats;
  loading?: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────

export function DashboardTab({ checkpoints, stats, loading }: DashboardTabProps) {
  return (
    <>
      {/* Quick Stats — real performance data */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Model Checkpoints"
          value={stats.totalCheckpoints}
          subValue={`${stats.activeCheckpoints} active`}
          icon={Brain}
          color="primary"
          loading={loading}
        />
        <StatCard
          label="Best Profit Factor"
          value={stats.bestProfitFactor != null ? stats.bestProfitFactor.toFixed(2) : "--"}
          icon={TrendingUp}
          color="emerald"
          loading={loading}
        />
        <StatCard
          label="Avg Sharpe Ratio"
          value={stats.avgSharpe != null ? stats.avgSharpe.toFixed(2) : "--"}
          icon={Target}
          color="cyan"
          loading={loading}
        />
        <StatCard
          label="Total Trades"
          value={stats.totalTrades.toLocaleString()}
          subValue={stats.avgWinRate != null ? `${(stats.avgWinRate * 100).toFixed(0)}% avg WR` : undefined}
          icon={BarChart3}
          color="amber"
          loading={loading}
        />
      </div>

      {/* Model Checkpoints — performance cards */}
      <Card className="glass rounded-2xl gradient-border flex flex-col">
        <CardHeader className="border-b border-white/5 py-3 px-4">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-primary" /> Model Checkpoints
            <Badge variant="outline" className="ml-auto text-[10px] rounded-full border-primary/30 text-primary bg-primary/10 font-mono">
              {checkpoints.length} checkpoints
            </Badge>
          </CardTitle>
        </CardHeader>
        <ScrollArea className="flex-1 max-h-[600px]">
          <CardContent className="p-3 space-y-2">
            {checkpoints.length === 0 && !loading ? (
              <div className="text-center py-12 text-muted-foreground">
                <Brain className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p className="text-sm font-medium">No Model Checkpoints</p>
                <p className="text-xs mt-1 text-muted-foreground/60">Train a model from the Training tab to see performance metrics here</p>
              </div>
            ) : loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="p-4 rounded-xl bg-white/5 animate-pulse h-24" />
                ))}
              </div>
            ) : (
              checkpoints.map((cp) => (
                <div key={cp.id} className="rounded-xl bg-white/5 hover:bg-white/[0.08] transition-colors border border-white/[0.03]">
                  {/* Header row */}
                  <div className="flex items-center justify-between p-3 pb-2">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        cp.isActive ? "bg-emerald-500/20" : "bg-primary/20"
                      }`}>
                        <Brain className={`h-5 w-5 ${cp.isActive ? "text-emerald-400" : "text-primary"}`} />
                      </div>
                      <div>
                        <div className="font-medium text-sm flex items-center gap-2">
                          {cp.symbol}
                          <span className="text-muted-foreground/60 font-normal">{cp.timeframe}</span>
                          {cp.isActive === 1 && (
                            <Badge variant="outline" className="text-[9px] rounded-full px-1.5 py-0 border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                              ACTIVE
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <Tag className="h-3 w-3" />
                          <Badge variant="outline" className="text-[9px] rounded-full px-1.5 py-0 border-cyan-500/30 text-cyan-400">
                            {cp.modelType}
                          </Badge>
                          {cp.paramCount != null && (
                            <span className="font-mono text-[10px] text-muted-foreground/50">
                              {(cp.paramCount / 1e6).toFixed(1)}M params
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right space-y-1">
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {new Date(cp.createdAt).toLocaleDateString()}
                      </div>
                      {cp.trainingDurationSec != null && (
                        <div className="text-[10px] font-mono text-muted-foreground/50">
                          {fmtDuration(cp.trainingDurationSec)}
                        </div>
                      )}
                      {cp.nBarsTrain != null && (
                        <div className="text-[10px] font-mono text-muted-foreground/50">
                          {fmtInt(cp.nBarsTrain)} bars
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Performance metrics strip */}
                  <div className="px-3 pb-3 pt-1">
                    <div className="flex items-center gap-1 rounded-lg bg-black/20 border border-white/[0.04] px-3 py-2">
                      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-3 w-full">
                        <MetricCell
                          label="Profit Factor"
                          value={fmtPF(cp.perf.profitFactor)}
                          colorFn={pfColor(cp.perf.profitFactor)}
                        />
                        <MetricCell
                          label="Sharpe"
                          value={fmtSharpe(cp.perf.sharpeRatio)}
                          colorFn={sharpeColor(cp.perf.sharpeRatio)}
                        />
                        <MetricCell
                          label="Win Rate"
                          value={fmtPct(cp.perf.winRate)}
                          colorFn={wrColor(cp.perf.winRate)}
                        />
                        <MetricCell
                          label="Trades"
                          value={fmtInt(cp.perf.nTrades)}
                          colorFn="text-foreground"
                        />
                        <MetricCell
                          label="Max DD"
                          value={fmtPct(cp.perf.maxDrawdown)}
                          colorFn={ddColor(cp.perf.maxDrawdown)}
                        />
                        <MetricCell
                          label="ROC AUC"
                          value={cp.perf.rocAuc != null ? cp.perf.rocAuc.toFixed(3) : "--"}
                          colorFn={cp.perf.rocAuc != null && cp.perf.rocAuc >= 0.65 ? "text-emerald-400" : "text-muted-foreground"}
                        />
                        <MetricCell
                          label="Val Loss"
                          value={cp.perf.valLoss != null ? cp.perf.valLoss.toFixed(4) : "--"}
                          colorFn="text-foreground/80"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </ScrollArea>
      </Card>
    </>
  );
}
