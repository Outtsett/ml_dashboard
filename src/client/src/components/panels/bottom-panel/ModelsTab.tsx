import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Brain, TrendingUp, Zap, FolderOpen, Clock, Tag, Layers,
} from "lucide-react";
import type { MlModel } from "@/lib/types";
import type { RegimeModel } from "@/components/training/types";
import type { TradeMetrics } from "@/hooks/useTradeMetrics";

interface ModelsTabProps {
  savedModels: RegimeModel[];
  tradeMetrics: TradeMetrics;
  models: MlModel[];
}

export function ModelsTab({ savedModels, tradeMetrics, models }: ModelsTabProps) {
  return (
    <>
      {/* Quick stat pills */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
          <Brain className="h-3 w-3 text-primary" />
          <span className="text-[10px] text-muted-foreground">Models</span>
          <span className="text-xs font-bold font-mono text-foreground">{savedModels.length}</span>
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
        <Card className="lg:col-span-3 glass rounded-xl gradient-border flex flex-col">
          <CardHeader className="border-b border-white/5 py-2 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
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
                savedModels.map((model) => (
                  <div key={model.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-md bg-primary/20 flex items-center justify-center">
                        <Brain className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium text-xs">{model.id}</div>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                          <Tag className="h-2.5 w-2.5" />
                          {model.symbol} · {model.timeframe}
                          <Badge variant="outline" className="text-[8px] rounded-full px-1 py-0 border-cyan-500/30 text-cyan-400">
                            {model.modelType}
                          </Badge>
                          <Badge variant="outline" className="text-[8px] rounded-full px-1 py-0 border-amber-500/30 text-amber-400">
                            {model.n_regimes}R
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="text-right space-y-0.5">
                      {model.quality_score != null && (
                        <div className="text-xs font-mono text-emerald-400">
                          Q:{model.quality_score.toFixed(0)}
                        </div>
                      )}
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {model.n_bars.toLocaleString()} bars
                      </div>
                      <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        {new Date(model.trained_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))
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
                let metrics: Record<string, number> = {};
                try { if (model.metrics) metrics = JSON.parse(model.metrics); } catch { /* malformed JSON */ }
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
    </>
  );
}
