import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Brain, TrendingUp, Sparkles, Zap, FolderOpen, Clock, Tag, Layers,
} from "lucide-react";
import type { MlModel, SavedModel } from "@/lib/types";

interface OverviewTabProps {
  savedModels: SavedModel[];
  featureInfo: any;
  tradeMetrics: {
    totalTrades: number;
    winRate: number;
  };
  models: MlModel[];
}

export function OverviewTab({ savedModels, featureInfo, tradeMetrics, models }: OverviewTabProps) {
  return (
    <>
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
    </>
  );
}
