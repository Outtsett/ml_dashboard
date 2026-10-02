import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  Brain, TrendingUp, Zap, FolderOpen, Clock, Tag, Layers,
} from "lucide-react";
import type { MlModel } from "@/shared/utils/types";
import type { RegimeModel } from "@/shared/utils/types";
import type { TradeMetrics } from "@/portfolio/lib/useTradeMetrics";

interface ModelsTabProps {
  savedModels: RegimeModel[];
  tradeMetrics: TradeMetrics;
  models: MlModel[];
}

function qualityColor(score: number | null | undefined): { border: string; text: string; glow: string } {
  if (score == null) return { border: 'border-l-muted-foreground/20', text: 'text-muted-foreground', glow: '' };
  if (score >= 80) return { border: 'border-l-emerald-500', text: 'text-[hsl(var(--data-pos))]', glow: 'metric-glow' };
  if (score >= 60) return { border: 'border-l-amber-500', text: 'text-amber-400', glow: '' };
  if (score >= 40) return { border: 'border-l-orange-500', text: 'text-orange-400', glow: '' };
  return { border: 'border-l-rose-500', text: 'text-[hsl(var(--data-neg))]', glow: '' };
}

export function ModelsTab({ savedModels, tradeMetrics, models }: ModelsTabProps) {
  return (
    <>
      {/* Quick stat pills */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 glow-primary transition-interactive">
          <Brain className="h-3 w-3 text-primary" />
          <span className="text-[10px] text-muted-foreground">Models</span>
          <span className="text-xs font-bold font-mono text-foreground">{savedModels.length}</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--data-pos)/0.1)] border border-[hsl(var(--data-pos)/0.2)] glow-success transition-interactive">
          <TrendingUp className="h-3 w-3 text-[hsl(var(--data-pos))]" />
          <span className="text-[10px] text-muted-foreground">Win Rate</span>
          <span className="text-xs font-bold font-mono text-[hsl(var(--data-pos))]">{tradeMetrics.winRate.toFixed(1)}%</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 glow-warning transition-interactive">
          <Zap className="h-3 w-3 text-amber-400" />
          <span className="text-[10px] text-muted-foreground">Trades</span>
          <span className="text-xs font-bold font-mono text-amber-400">{tradeMetrics.totalTrades}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Saved Models list */}
        <Card className="lg:col-span-3 glass-elevated rounded-xl gradient-accent-top flex flex-col">
          <CardHeader className="border-b border-white/[0.08] py-2 px-3">
            <CardTitle className="text-xs font-semibold text-foreground/70 flex items-center gap-2">
              <FolderOpen className="h-3.5 w-3.5 text-primary" /> Trained Models
            </CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1 max-h-[260px]">
            <CardContent className="p-2 space-y-1.5">
              {savedModels.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Brain className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-xs font-medium">No Trained Models</p>
                  <p className="text-[10px] mt-1 text-muted-foreground/60">Train a model from the Training Center</p>
                </div>
              ) : (
                savedModels.map((model) => {
                  const qc = qualityColor(model.quality_score);
                  return (
                    <div key={model.id} className={`flex items-center justify-between p-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border-l-2 ${qc.border} transition-interactive hover-lift`}>
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-md bg-primary/15 border border-primary/20 flex items-center justify-center">
                          <Brain className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <div className="font-semibold text-xs text-foreground/90">{model.id}</div>
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                            <Tag className="h-2.5 w-2.5" />
                            {model.symbol} · {model.timeframe}
                            <Badge variant="outline" className="text-[8px] rounded-full px-1.5 py-0 border-cyan-500/40 text-cyan-400 bg-cyan-500/10">
                              {model.modelType}
                            </Badge>
                            <Badge variant="outline" className="text-[8px] rounded-full px-1.5 py-0 border-amber-500/40 text-amber-400 bg-amber-500/10">
                              {model.n_regimes}R
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="text-right space-y-0.5">
                        {model.quality_score != null && (
                          <div className={`text-sm font-bold font-mono ${qc.text} ${qc.glow}`}>
                            Q:{model.quality_score.toFixed(0)}
                          </div>
                        )}
                        <div className="text-[10px] font-mono text-foreground/60">
                          {model.n_bars.toLocaleString()} bars
                        </div>
                        <div className="flex items-center gap-1 text-[9px] text-muted-foreground/70">
                          <Clock className="h-2.5 w-2.5" />
                          {new Date(model.trained_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </ScrollArea>
        </Card>
      </div>

      {/* DB Model Registry */}
      {models.length > 0 && (
        <Card className="glass-elevated rounded-xl gradient-accent-top">
          <CardHeader className="border-b border-white/[0.08] py-2 px-3">
            <CardTitle className="text-xs font-semibold text-foreground/70 flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-primary" /> Model Registry
              <Badge variant="outline" className="ml-auto text-[8px] rounded-full border-primary/30 font-mono">{models.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
              {models.slice(0, 8).map((model) => {
                let metrics: Record<string, number> = {};
                try { if (model.metrics) metrics = JSON.parse(model.metrics); } catch { /* malformed JSON */ }
                return (
                  <div key={model.id} className="p-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] transition-interactive hover-lift border border-white/[0.06]">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Brain className="h-3 w-3 text-primary" />
                      <span className="text-[10px] font-semibold truncate text-foreground/80">{model.name}</span>
                      <Badge variant="outline" className={`ml-auto text-[8px] rounded-full ${
                        model.status === 'active' ? 'border-[hsl(var(--data-pos)/0.5)] text-[hsl(var(--data-pos))] bg-[hsl(var(--data-pos)/0.1)]' :
                        model.status === 'training' ? 'border-amber-500/50 text-amber-400 bg-amber-500/10 pulse-slow' :
                        'border-muted-foreground/30 text-muted-foreground/60'
                      }`}>
                        {model.status}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                      {metrics.finalAccuracy != null && (
                        <>
                          <span className="text-muted-foreground">Acc</span>
                          <span className="font-mono text-[hsl(var(--data-pos))] text-right font-semibold">{(metrics.finalAccuracy * 100).toFixed(1)}%</span>
                        </>
                      )}
                      {metrics.finalValLoss != null && (
                        <>
                          <span className="text-muted-foreground">Val</span>
                          <span className="font-mono text-right text-foreground/70">{metrics.finalValLoss.toFixed(4)}</span>
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
    </>
  );
}
